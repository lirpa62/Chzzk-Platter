// 실시간 따라잡기: 채널별 자동 설정(전체 설정보다 먼저)과, 따라잡은 직후 버퍼링이 나면
// 그 방송에서만 시작·목표 지연을 늦추는 적응형 기준.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const mixer = read("src/audioMixer.js");
const content = read("src/content.js");
const settingsHtml = read("settings.html");
const settingsJs = read("src/settings.js");

const A = "a".repeat(32);
const B = "b".repeat(32);
const block = mixer.slice(mixer.indexOf("  let syncAdaptBoost = 0;"), mixer.indexOf("  function loadAutoSync() {"));
assert.ok(block.length > 100, "적응형·채널별 구간을 찾지 못했다");
const fnSrc = (name) => {
  const at = mixer.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return mixer.slice(at, mixer.indexOf("\n  }\n", at) + 4);
};

function makeCtx() {
  const posted = [];
  const ctx = {
    SYNC_ADAPT_STEP_S: 0.5, SYNC_ADAPT_MAX_S: 2, SYNC_ADAPT_WATCH_MS: 10000,
    SYNC_JUMP_LATENCY_S: 12, SYNC_STARVED_AHEAD_S: 1, SYNC_SKIP_KEEP_S: 1, SYNC_SKIP_MIN_S: 0.3, ourSeekUntil: 0,
    syncCfg: { enable: 3, target: 2 },
    currentPageKey: `live:${A}`,
    autoSyncEnabled: false,
    BRIDGE_ORIGIN: "https://chzzk.naver.com",
    updates: 0,
    window: { postMessage: (m) => posted.push(m) },
    posted,
    Date,
  };
  ctx.updateSyncButtonState = () => { ctx.updates += 1; };
  vm.createContext(ctx);
  vm.runInContext(
    block +
      "\nthis.api={syncEnableS,syncTargetS,resetSyncAdapt,raiseSyncAdapt,onSyncWaiting,syncBufferAhead,channelAutoSyncMode," +
      "autoSyncActive,applyAutoSyncChannels,setChannelAutoSync,get boost(){return syncAdaptBoost},set watch(v){syncAdaptWatch=v},get watch(){return syncAdaptWatch}};",
    ctx,
  );
  return ctx;
}

// ── 적응형 기준 ──────────────────────────────────────────────────────
{
  const ctx = makeCtx();
  const { api } = ctx;
  assert.equal(api.syncEnableS(), 3);
  assert.equal(api.syncTargetS(), 2);
  const video = {};
  // 목표 도달 직후 버퍼링 → 0.5초 늦춘다(시작·목표 함께).
  api.watch = { video, until: Date.now() + 10000 };
  api.onSyncWaiting({ currentTarget: video });
  assert.equal(api.boost, 0.5);
  assert.equal(api.syncEnableS(), 3.5);
  assert.equal(api.syncTargetS(), 2.5);
  assert.equal(api.watch, null, "한 번 늘리면 감시를 끝낸다");
  // 감시 밖의 버퍼링은 따라잡기 탓이 아니다.
  api.onSyncWaiting({ currentTarget: video });
  assert.equal(api.boost, 0.5);
  api.watch = { video, until: Date.now() - 1 };
  api.onSyncWaiting({ currentTarget: video });
  assert.equal(api.boost, 0.5, "감시 시간이 지난 버퍼링은 세지 않는다");
  api.watch = { video, until: Date.now() + 10000 };
  api.onSyncWaiting({ currentTarget: {} });
  assert.equal(api.boost, 0.5, "다른 video 의 버퍼링은 세지 않는다");
  // 상한 2초.
  for (let i = 0; i < 10; i += 1) api.raiseSyncAdapt();
  assert.equal(api.boost, 2);
  assert.equal(api.syncEnableS(), 5);
  assert.equal(api.syncTargetS(), 4);
  api.resetSyncAdapt();
  assert.equal(api.boost, 0);
  // 목표는 시작보다 최소 0.5초 작다.
  ctx.syncCfg = { enable: 3, target: 2.8 };
  assert.equal(api.syncTargetS(), 2.5);
  // 앞쪽 버퍼.
  const ranges = (list) => ({ length: list.length, start: (i) => list[i][0], end: (i) => list[i][1] });
  assert.equal(api.syncBufferAhead({ currentTime: 10, buffered: ranges([[0, 5], [9, 11.5]]) }), 1.5);
  assert.ok(Number.isNaN(api.syncBufferAhead({ currentTime: 20, buffered: ranges([[0, 5]]) })));
}

// ── 채널별 자동 따라잡기 ──────────────────────────────────────────────
{
  const ctx = makeCtx();
  const { api } = ctx;
  assert.equal(api.channelAutoSyncMode(), "inherit");
  assert.equal(api.autoSyncActive(), false, "채널 설정이 없으면 전체 설정");
  ctx.autoSyncEnabled = true;
  assert.equal(api.autoSyncActive(), true);
  api.applyAutoSyncChannels({ [A]: false, [B]: true, bad: true, ["c".repeat(32)]: "yes" });
  assert.equal(api.autoSyncActive(), false, "이 채널은 항상 끄기가 전체 켜짐보다 먼저");
  ctx.autoSyncEnabled = false;
  ctx.currentPageKey = `live:${B}`;
  assert.equal(api.autoSyncActive(), true, "이 채널은 항상 켜기가 전체 꺼짐보다 먼저");
  ctx.currentPageKey = "video:123";
  assert.equal(api.channelAutoSyncMode(), "inherit", "다시보기는 채널 설정 대상이 아니다");
  ctx.currentPageKey = `live:${A}`;
  api.setChannelAutoSync("on");
  assert.equal(api.autoSyncActive(), true);
  assert.deepEqual({ ...ctx.posted.at(-1) }, { source: "cheese-audio-mixer", type: "save-auto-sync-channel", channelId: A, mode: "on" });
  api.setChannelAutoSync("inherit");
  assert.equal(api.channelAutoSyncMode(), "inherit");
  assert.equal(ctx.posted.at(-1).mode, "inherit");
}

// ── 따라잡기 루프: 버퍼 바닥이면 멈추고 늦춘다, 목표에 닿으면 버퍼링 감시 ──────
{
  const loopSrc = fnSrc("startSyncCatchUp");
  function run({ lat, ahead }) {
    const timers = [];
    const video = { paused: false, seeking: false, readyState: 4, isConnected: true, playbackRate: 1,
      addEventListener: () => {}, removeEventListener: () => {} };
    const state = { stops: 0, raised: 0, watch: null };
    const ctx = {
      SYNC_MODE: "rate", SYNC_JUMP_LATENCY_S: 12, SYNC_RATE: 1.5, SYNC_PROGRESS_EPS_S: 0.3,
      SYNC_NO_PROGRESS_MS: 4000, SYNC_MAX_DURATION_MS: 30000, SYNC_CATCH_UP_CHECK_MS: 250,
      SYNC_MIN_BUFFER_AHEAD_S: 0.5, SYNC_ADAPT_WATCH_MS: 10000,
      syncCfg: { enable: 3, target: 2 }, syncCatchUp: null, syncIntendedRate: 0,
      findCorePlayer: () => ({}), findVideo: () => video, findPlayer: () => null,
      getLiveLatencySeconds: () => lat.shift(),
      setPlaybackRate: (_c, v, r) => { v.playbackRate = r; },
      syncBufferAhead: () => ahead,
      syncTargetS: () => 2,
      raiseSyncAdapt: () => { state.raised += 1; },
      updateSyncButtonState: () => {}, keepControlsVisible: () => {}, setSyncTooltip: () => {},
      jumpToLiveEdge: () => {},
      syncJumpLatencyS: () => 12, syncSkipMode: false, skipWithinBuffer: () => true,
      isSyncBufferStarved: () => ahead < 1,
      document: { hidden: true, querySelector: () => null },
      window: { setTimeout: (fn) => { timers.push(fn); return timers.length; } },
      Date,
    };
    ctx.stopSyncCatchUp = () => { state.stops += 1; ctx.syncCatchUp = null; };
    vm.createContext(ctx);
    vm.runInContext(
      "var syncAdaptWatch=null;" + loopSrc + "\nthis.start=startSyncCatchUp;this.getWatch=()=>syncAdaptWatch;",
      ctx,
    );
    ctx.start();
    while (timers.length && ctx.syncCatchUp) timers.shift()();
    state.watch = ctx.getWatch();
    return state;
  }
  const starving = run({ lat: [4, 3.5], ahead: 0.3 });
  assert.equal(starving.stops, 1);
  assert.equal(starving.raised, 1, "버퍼가 바닥나면 멈추고 이 방송의 기준을 늦춘다");
  assert.equal(starving.watch, null);
  const reached = run({ lat: [4, 3, 1.9], ahead: 2 });
  assert.equal(reached.stops, 1);
  assert.equal(reached.raised, 0);
  assert.ok(reached.watch && reached.watch.until > Date.now(), "목표에 닿으면 그 직후 버퍼링을 지켜본다");
}

// ── 연결 ────────────────────────────────────────────────────────────
assert.ok(mixer.includes('syncSeekVideo.addEventListener("waiting", onSyncWaiting);'), "버퍼링(waiting)을 듣는다");
assert.match(mixer, /function armFreshLiveEntry\(\) \{\n\s*resetSyncAdapt\(\);/, "새 방송에 들어가면 늦춘 기준을 되돌린다");
assert.match(mixer, /syncAutoCooldownMs = SYNC_AUTO_COOLDOWN_BASE_MS;\n\s*resetSyncAdapt\(\);/, "민감도를 바꾸면 되돌린다");
assert.match(mixer, /const autoOn = autoSyncActive\(\);/);
assert.match(mixer, /if \(autoOn && autoEligible && canAutoCatchUp\(\)\) \{/);
assert.match(mixer, /lat >= syncEnableS\(\) &&\n\s*lat < syncJumpLatencyS\(\);/, "자동은 늦춘 기준으로 판단한다");
assert.ok(mixer.includes("const overThreshold = Number.isFinite(lat) && lat >= syncCfg.enable;"), "수동 버튼은 원래 기준 그대로");
assert.ok(mixer.includes('data-sync-channel="${mode}"'), "우클릭 메뉴에 이 채널 설정");
assert.match(mixer, /if \(channelAutoSyncMode\(\) === "on"\) \{\n\s*setChannelAutoSync\(autoSyncEnabled \? "off" : "inherit"\);/, "이 채널만 켜 둔 경우 정지 버튼은 그 채널 설정만 푼다");
assert.ok(content.includes('const AUDIO_MIXER_AUTO_SYNC_CHANNELS_KEY = "cheeseAutoSyncChannels";'));
assert.ok(content.includes('if (data.type === "save-auto-sync-channel") {') && content.includes('type: "auto-sync-channels-loaded",'));
assert.ok(settingsHtml.includes("data-auto-sync-channels-list") && settingsJs.includes('const AUTO_SYNC_CHANNELS_KEY = "cheeseAutoSyncChannels";'),
  "설정 화면에 채널별 목록(해제 가능)");

console.log("전부 통과");
