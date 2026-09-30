// 자동 싱크 칸에서 치지직 플레이어 자체 따라잡기(1.03×)를 멈추고, 풀리면 되돌리는지 검증.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const mixer = read("src/audioMixer.js");
const content = read("src/content.js");
const watch = read("src/multiviewWatch.js");
const SYNC = require("../src/multiviewSync.js");

const from = mixer.indexOf("  let multiviewSyncCore = null;");
const to = mixer.indexOf("  window.addEventListener(\"message\", (event) => {\n    if (!isMultiviewLiveSlot()");
assert.ok(from > 0 && to > from, "MAIN 쪽 따라잡기 멈춤 구간을 찾지 못했다");

class FakeMedia { constructor() { this.playbackRate = 1; } }
function makeContext(slotId) {
  const video = new FakeMedia();
  const config = { maxLiveSyncPlaybackRate: 1.03 };
  const mc = { _hls: { config }, _video: video, _catchUpController: { _isCatchUpMode: false },
    _lastFrag: { _programDateTime: 1.7e12, start: 10, cc: 0 } };
  const core = { srcObject: { _player: { player: { _mediaController: mc } } } };
  const timers = [];
  const ctx = {
    multiviewSlotId: slotId,
    HTMLMediaElement: FakeMedia,
    findCorePlayer: () => core,
    findVideo: () => video,
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: () => {},
    window: { addEventListener() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(mixer.slice(from, to) +
    "\nthis.api={setMultiviewCatchUpHold,multiviewSyncAnchor};", ctx);
  return { ctx, video, config, mc, timers };
}

{
  const { ctx, video, config, mc, timers } = makeContext("a".repeat(32));
  // 플레이어가 이미 따라잡기 중(1.03×)이면 켜는 순간 1× 로 돌리고 설정을 1 로 둔다.
  mc._catchUpController._isCatchUpMode = true;
  video.playbackRate = 1.03;
  ctx.api.setMultiviewCatchUpHold(true);
  assert.equal(config.maxLiveSyncPlaybackRate, 1);
  assert.equal(video.playbackRate, 1);
  assert.equal(timers.length, 1, "재연결로 hls 가 바뀌어도 다시 거는 주기 확인이 있다");
  // 싱크가 건 배속(1.04 등)은 건드리지 않는다.
  mc._catchUpController._isCatchUpMode = false;
  video.playbackRate = 1.04;
  timers[0]();
  assert.equal(video.playbackRate, 1.04);
  // hls 가 새로 만들어지면 새 설정도 1 로 두고, 풀 때 그 설정의 원래 값으로 돌린다.
  const next = { maxLiveSyncPlaybackRate: 1.03 };
  mc._hls = { config: next };
  timers[0]();
  assert.equal(next.maxLiveSyncPlaybackRate, 1);
  ctx.api.setMultiviewCatchUpHold(false);
  assert.equal(next.maxLiveSyncPlaybackRate, 1.03, "자동 싱크가 풀리면 원래 따라잡기 배속으로 돌린다");
  assert.deepEqual({ ...ctx.api.multiviewSyncAnchor() }, { pdt: 1.7e12, start: 10, cc: 0 },
    "송출 시각 기준점 읽기는 그대로 된다");
}
{
  const { ctx, config } = makeContext("video:123");
  ctx.api.setMultiviewCatchUpHold(true);
  assert.equal(config.maxLiveSyncPlaybackRate, 1.03, "다시보기 칸은 건드리지 않는다");
  assert.equal(ctx.api.multiviewSyncAnchor(), null);
}

// 싱크 배속은 플레이어 따라잡기 배속(1.03)과 겹치지 않는다.
for (const error of [-0.8, -1.2, -1.9, -3, 0.8, 1.2, 3]) {
  assert.notEqual(SYNC.rateFor(error, true), 1.03, `rateFor(${error}) 가 1.03 이다`);
}
assert.equal(SYNC.rateFor(-1.2, true), 1.04);
assert.equal(SYNC.rateFor(1.2, true), 0.97);

// 전달 경로: 부모 → content(격리) → MAIN.
assert.match(content, /data\.type === "SET_PLAYER_CATCH_UP_HOLD"[\s\S]*?source: "cheese-multiview-catchup-hold"/);
assert.match(content, /if \(!multiviewLiveChannelId \|\| typeof data\.hold !== "boolean"\) return;/);
assert.match(mixer, /data\?\.source !== "cheese-multiview-catchup-hold" \|\| data\.channelId !== multiviewSlotId/);
// 부모: 자동 싱크 대상(2칸 이상) 라이브 칸만, 바뀔 때만 보낸다. 프레임이 새로 뜨면 다시 보낸다.
assert.match(watch, /function autoSyncedChannelIds\(\)[\s\S]*?live\.length >= 2/);
assert.match(watch, /function updatePlayerCatchUpHold\(\)[\s\S]*?\(playerCatchUpHold\.get\(id\) \?\? false\) === hold[\s\S]*?"SET_PLAYER_CATCH_UP_HOLD"/);
assert.match(watch, /function updateSyncPolling\(\) \{\s*updatePlayerCatchUpHold\(\);/);
assert.match(watch, /requestSyncStats\(\);\s*updatePlayerCatchUpHold\(\);/);
assert.match(watch, /data\.type === "FRAME_READY"\) \{[\s\S]{0,120}playerCatchUpHold\.delete\(channelId\)/);

console.log("멀티뷰 플레이어 자체 따라잡기 멈춤 검증 통과");
