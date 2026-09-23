const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../src/multiviewSync.js");

const now = 100000;
const stats = (delay, edge = 0, receivedAt = now) => ({
  currentTime: 100,
  nativeDelaySec: delay,
  bufferAheadSec: 4,
  edgeLagSec: edge,
  seekableStart: 80,
  seekableEnd: 110,
  playbackRate: 1,
  syncRateOwned: false,
  userRateOverride: false,
  paused: false,
  readyState: 4,
  receivedAt,
});

for (const count of [2, 4, 6]) {
  const ids = Array.from({ length: count }, (_, i) => `channel-${i}`);
  const values = new Map(ids.map((id, i) => [id, stats(i + 1)]));
  const ready = new Map(ids.map((id) => [id, now - 5000]));
  assert.equal(S.reference(ids, values, ready, null, now), ids.at(-1));
  assert.equal(values.size, count);
}

const video = {
  currentTime: 100,
  playbackRate: 1,
  paused: false,
  readyState: 4,
  seekable: { length: 1, start: () => 80, end: () => 110 },
  buffered: { length: 1, end: () => 107 },
};
assert.deepEqual(
  [S.sample(video, now).nativeDelaySec, S.sample(video, now).bufferAheadSec,
    S.sample(video, now).edgeLagSec],
  [10, 7, 3],
);
assert.equal(S.sample({ ...video, seekable: { length: 0 }, buffered: { length: 0 } }).nativeDelaySec, null);
assert.equal(S.sample({ ...video, currentTime: 90000,
  seekable: { length: 1, start: () => 89900, end: () => 90005 } }).nativeDelaySec, 5);
assert.equal(S.normalize({ ...S.sample(video, now), generation: 1 }).syncRateOwned, false);
assert.equal(S.normalize({ ...stats(5), currentTime: 90000,
  seekableStart: 89900, seekableEnd: 90005 }).nativeDelaySec, 5);
assert.equal(S.normalize({ ...stats(10), currentTime: Infinity }).currentTime, null);
assert.equal(S.normalize({ ...stats(3) }), null, "inconsistent native delay is rejected");
assert.equal(S.normalize({ ...stats(3), seekableStart: 120, seekableEnd: 110 }), null);
assert.equal(S.normalize(null), null);
assert.equal(S.eligible(stats(2, 0, now - 4000), now - 5000, now), false);
assert.equal(S.eligible({ ...stats(2), paused: true }, now - 5000, now), false);

const values = new Map([["a", stats(3)], ["b", stats(3.3)], ["c", stats(4)]]);
const ready = new Map([["a", now - 5000], ["b", now - 5000], ["c", now - 1000]]);
assert.equal(S.reference(["a", "b", "c"], values, ready, "a", now), "a", "sticky reference");
ready.set("c", now - 5000);
assert.equal(S.reference(["a", "b", "c"], values, ready, "a", now), "c", "settled slowest");
assert.deepEqual(S.rebaseOffsets({ a: 0, b: 0.4, c: -0.2 }, "b", ["a", "b", "c"]),
  { a: -0.4, b: 0, c: -0.6 });
assert.deepEqual(S.rebaseOffsets({ b: 0.4 }, "b", ["a", "b", "c"]),
  { a: -0.4, b: 0, c: -0.4 });
assert.deepEqual(S.rebaseOffsets({ b: 0.4, stale: 3 }, "b", ["a", "b", "c"]),
  { a: -0.4, b: 0, c: -0.4 });
assert.equal(S.targetDelay(stats(3), 0.5), 3.5);
assert.equal(S.seekTarget(stats(2), 3), 99, "faster stream moves backward");
assert.equal(S.seekTarget(stats(3), 2), 101, "manual catch-up can move forward");
assert.equal(S.seekTarget(stats(1), 6), 96, "5-second error is clamped backward");
assert.equal(S.seekTarget(stats(1), 11), 96, "10-second error is clamped backward");
assert.equal(S.seekTarget(stats(6), 1), 104, "5-second error is clamped forward");
assert.equal(S.seekTarget(stats(2), 2.1), null, "small auto error ignored");
assert.ok(S.seekTarget(stats(2), 2.1, 0.05) < 100, "manual 0.1s accepted");
assert.equal(S.seekTarget({ ...stats(2), seekableStart: 99.5 }, 3), null);
assert.equal(S.rateFor(0.8, false), 0.99);
assert.equal(S.rateFor(-0.8, false), 1.01);
assert.equal(S.rateFor(0.3, false), 1);
assert.equal(S.rateFor(0.3, true), 0.99);
assert.equal(S.rateFor(0.1, true), 1);
assert.equal(S.rateFor(S.LIMITS.rateStartSec, false), 0.99);
assert.equal(S.rateFor(S.LIMITS.rateStopSec, true), 1);
assert.deepEqual(S.rateOwnership(true, 0.99, 0.99),
  { owned: true, userOverride: false });
assert.deepEqual(S.rateOwnership(true, 0.99, 1.5),
  { owned: false, userOverride: true });
assert.deepEqual(S.rateOwnership(false, 1, 1),
  { owned: false, userOverride: false });
assert.deepEqual(S.rateOwnership(false, 1, 1 + S.LIMITS.userRateEpsilon + 0.001),
  { owned: false, userOverride: true });

const congested = new Map([["a", stats(2, 3)], ["b", stats(2, 3)], ["c", stats(2, 3)]]);
let state = S.congestion({ active: false, since: 0 }, congested, ["a", "b", "c"], now);
assert.equal(state.active, false);
state = S.congestion(state, congested, ["a", "b"], now + 4000);
assert.equal(state.active, false, "settling third channel cannot trigger congestion");
state = S.congestion(state, congested, ["a", "b", "c"], now + 4001);
assert.equal(state.active, false, "congestion timer starts after settling");
state = S.congestion(state, congested, ["a", "b", "c"], now + 8001);
assert.equal(state.active, true);
congested.get("c").edgeLagSec = 0;
state = S.congestion(state, congested, ["a", "b", "c"], now + 8100);
assert.equal(state.active, true);
state = S.congestion(state, congested, ["a", "b", "c"], now + 13200);
assert.equal(state.active, false);

const watch = fs.readFileSync(path.join(__dirname, "../src/multiviewWatch.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");
assert.match(watch, /event\.origin !== CHZZK_ORIGIN/);
assert.match(watch, /event\.source !== frame\.contentWindow/);
assert.match(content, /event\.origin !== MULTIVIEW_PARENT_ORIGIN/);
assert.match(content, /event\.source !== window\.parent/);
assert.match(watch, /syncTimer = window\.setInterval\(syncTick, SYNC\.LIMITS\.sampleMs\)/);
assert.match(watch, /function clearRemovedChannel\(channelId\)[\s\S]*?clearChannelSync\(channelId, true\)/);
assert.match(watch, /clearRemovedChannel\(oldChannelId\)/);
assert.match(watch, /clearRemovedChannel\(channelId\)/);
assert.match(watch, /syncCongestion = SYNC\.congestion\(syncCongestion, fresh, settledIds, now\)/);
assert.match(content, /APPLY_SYNC_SEEK: "seek"/);
assert.match(content, /APPLY_SYNC_NUDGE: "nudge"/);
assert.match(content, /RESET_SYNC_RATE: "reset-rate"/);

const autoCorrection = (audioProtected, current, targetDelay) => {
  const target = S.seekTarget(current, targetDelay);
  const error = targetDelay - current.nativeDelaySec;
  return {
    seek: !audioProtected && target !== null && target < current.currentTime,
    rate: S.rateFor(error, current.syncRateOwned),
  };
};
const fast = stats(2);
assert.deepEqual(autoCorrection(true, fast, 3), { seek: false, rate: 0.97 },
  "audible channel uses rate-only correction");
assert.deepEqual(autoCorrection(false, fast, 3), { seek: true, rate: 0.97 },
  "muted channel keeps seek and rate correction");
assert.equal(autoCorrection(true, stats(4), 3).seek, false,
  "all unmuted channels are protected regardless of main role");
assert.equal(autoCorrection(false, stats(2), 3).seek, true,
  "muting a channel makes it seek-eligible again");
assert.match(watch, /function isSyncAudioProtected\(channelId\)[\s\S]*?effectiveMuted\(channelId\) === false/);
assert.match(watch, /!isSyncAudioProtected\(id\) && target !== null/);
assert.match(watch, /setSyncRate\(id, SYNC\.rateFor/);
assert.match(watch, /alignSync\(\[id\], true, \{ \[id\]: 0 \}, true\)/,
  "per-channel manual reset remains allowed");
assert.match(watch, /audioProtected: isSyncAudioProtected\(channelId\)/,
  "diagnostic samples include audio protection context");
console.log("멀티뷰 싱크 계산·수명주기·메시지 검증 통과");
