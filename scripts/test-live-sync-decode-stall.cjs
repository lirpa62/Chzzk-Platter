// 실시간 따라잡기: 배속 중 멈춤의 원인을 나누고, 우클릭 메뉴에서 시작·목표 지연을 바로 바꾼다.
//
// 실측(Windows, 1080p60, 하드웨어 디코딩 불가 PC): 1.5배속 따라잡기 중 앞쪽 버퍼가 4초 남았는데 멈춤(waiting)이
// 나고, 플레이어가 뒤로 옮겨 지연이 6.3초 → 8.3초로 되돌아갔다(누를 때마다 제자리). 1.61.0 의 적응형 기준이
// 이 멈춤까지 '목표가 너무 바짝' 으로 보고 시작·목표를 늦춰, 몇 번 만에 시작 지연이 설정보다 2초 커졌다.
//   - 버퍼가 실제로 바닥(1초 미만)일 때만 기준을 늦춘다
//   - 버퍼가 남았는데 배속 중 멈추면 그 방송은 '받아 둔 구간 안에서 건너뛰기' 로 따라잡는다(디코딩·요청 없음)
//   - 라이브로 바로 옮기는 기준(12초)은 시작 지연이 크면 그만큼 늦춘다(시작 12초 이상에서 자동이 영영 안 켜졌다)
//   - 커스텀 목표 지연 상한 10 → 20초, 우클릭 메뉴에서 시작·목표를 0.5초씩 바로 조절(커스텀으로 저장)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const mixer = read("src/audioMixer.js");
const content = read("src/content.js");
const settingsJs = read("src/settings.js");
const settingsHtml = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const fnSrc = (name) => {
  const at = mixer.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return mixer.slice(at, mixer.indexOf("\n  }\n", at) + 4);
};
const block = mixer.slice(mixer.indexOf("  let syncAdaptBoost = 0;"), mixer.indexOf("  function loadAutoSync() {"));
const ranges = (list) => ({ length: list.length, start: (i) => list[i][0], end: (i) => list[i][1] });

function makeCtx(cfg = { enable: 3, target: 2 }) {
  const ctx = {
    SYNC_ADAPT_STEP_S: 0.5, SYNC_ADAPT_MAX_S: 2, SYNC_ADAPT_WATCH_MS: 10000, SYNC_MENU_QUIET_MS: 8000, SYNC_ADAPT_DECAY_MS: 300000, SYNC_JUMP_LATENCY_S: 12,
    SYNC_STARVED_AHEAD_S: 1, SYNC_SKIP_KEEP_S: 1, SYNC_SKIP_MIN_S: 0.3,
    syncCfg: cfg, currentPageKey: "", autoSyncEnabled: false, BRIDGE_ORIGIN: "x", ourSeekUntil: 0,
    window: { postMessage: () => {} }, Date, updateSyncButtonState: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(block + "\nthis.api={onSyncWaiting,isSyncBufferStarved,skipWithinBuffer,syncJumpLatencyS,raiseSyncAdapt," +
    "get boost(){return syncAdaptBoost},set watch(v){syncAdaptWatch=v}};", ctx);
  return ctx;
}

// 1) 목표 도달 직후 멈춤: 버퍼가 남았으면 기준을 늦추지 않는다.
{
  const { api } = makeCtx();
  const healthy = { currentTime: 10, buffered: ranges([[5, 14]]) };
  api.watch = { video: healthy, until: Date.now() + 10000 };
  api.onSyncWaiting({ currentTarget: healthy });
  check(api.boost === 0, "목표 도달 직후 멈춤이라도 버퍼가 4초 남았으면 기준을 늦추지 않는다");
  const starved = { currentTime: 10, buffered: ranges([[5, 10.4]]) };
  api.watch = { video: starved, until: Date.now() + 10000 };
  api.onSyncWaiting({ currentTarget: starved });
  check(api.boost === 0.5, "버퍼가 바닥(1초 미만)이면 예전처럼 0.5초 늦춘다");
}

// 2) 버퍼 안 건너뛰기
{
  const ctx = makeCtx();
  const { api } = ctx;
  const video = { currentTime: 100, buffered: ranges([[90, 104.28]]) };
  check(api.skipWithinBuffer(video, 6.3) === true && Math.abs(video.currentTime - 103.28) < 1e-9 && ctx.ourSeekUntil > Date.now(),
    `건너뛰기: 목표(2초)까지 4.3초 중 남길 버퍼 1초를 빼고 3.28초 앞으로(우리 seek 로 표시) → ${video.currentTime}`);
  const small = { currentTime: 100, buffered: ranges([[90, 101.2]]) };
  check(api.skipWithinBuffer(small, 6) === false && small.currentTime === 100, "건너뛸 수 있는 양이 0.3초 미만이면 옮기지 않는다");
  const near = { currentTime: 100, buffered: ranges([[90, 110]]) };
  check(api.skipWithinBuffer(near, 2.2) === false, "목표까지 0.3초 미만이면 옮기지 않는다");
}

// 3) 라이브로 바로 옮기는 기준
{
  check(makeCtx({ enable: 3, target: 2 }).api.syncJumpLatencyS() === 12, "기본 민감도는 12초 그대로");
  check(makeCtx({ enable: 13, target: 11 }).api.syncJumpLatencyS() === 17, "시작 지연 13초면 17초부터 바로 옮긴다(자동이 발동할 구간이 생긴다)");
}

// 4) 따라잡는 중 멈춤: 버퍼가 남았으면 건너뛰기로, 바닥이면 늦추기
{
  const loopSrc = fnSrc("startSyncCatchUp");
  function run({ ahead, skipMode = false }) {
    const listeners = {};
    const video = { paused: false, seeking: false, readyState: 4, isConnected: true, playbackRate: 1,
      addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: (t) => { delete listeners[t]; } };
    const state = { raised: 0, skipped: 0, rate: false };
    const ctx = {
      SYNC_MODE: "rate", SYNC_RATE: 1.5, SYNC_PROGRESS_EPS_S: 0.3, SYNC_NO_PROGRESS_MS: 4000, SYNC_MAX_DURATION_MS: 30000,
      SYNC_CATCH_UP_CHECK_MS: 250, SYNC_MIN_BUFFER_AHEAD_S: 0.5, SYNC_ADAPT_WATCH_MS: 10000,
      syncCfg: { enable: 3, target: 2 }, syncCatchUp: null, syncIntendedRate: 0, syncSkipMode: skipMode,
      findCorePlayer: () => ({}), findVideo: () => video, findPlayer: () => null,
      getLiveLatencySeconds: () => 8.4,
      setPlaybackRate: (_c, v, r) => { v.playbackRate = r; state.rate = true; },
      syncBufferAhead: () => ahead, syncTargetS: () => 2, syncJumpLatencyS: () => 12,
      isSyncBufferStarved: () => ahead < 1,
      skipWithinBuffer: () => { state.skipped += 1; return true; },
      raiseSyncAdapt: () => { state.raised += 1; },
      updateSyncButtonState: () => {}, keepControlsVisible: () => {}, setSyncTooltip: () => {}, jumpToLiveEdge: () => {},
      document: { hidden: true, querySelector: () => null },
      window: { setTimeout: () => 1 }, Date,
    };
    ctx.stopSyncCatchUp = () => { ctx.syncCatchUp = null; };
    vm.createContext(ctx);
    vm.runInContext("var syncAdaptWatch=null;" + loopSrc + "\nthis.start=startSyncCatchUp;", ctx);
    ctx.start();
    if (listeners.waiting) listeners.waiting();
    return { ...state, skipMode: ctx.syncSkipMode, stopped: ctx.syncCatchUp === null };
  }
  const decode = run({ ahead: 4.28 });
  check(decode.rate && decode.stopped && decode.skipMode === true && decode.raised === 0,
    `배속 중 멈춤 + 버퍼 4.28초: 멈추고 이 방송은 건너뛰기로, 기준은 그대로 ${JSON.stringify(decode)}`);
  const starved = run({ ahead: 0.4 });
  check(starved.stopped && starved.skipMode === false && starved.raised === 1,
    `배속 중 멈춤 + 버퍼 0.4초: 기준을 늦춘다 ${JSON.stringify(starved)}`);
  const skipping = run({ ahead: 4, skipMode: true });
  check(skipping.skipped === 1 && skipping.rate === false, "건너뛰기 방송에서는 배속을 걸지 않고 건너뛴다");
}
check(/function armFreshLiveEntry\(\) \{\s*resetSyncAdapt\(\);\s*syncSkipMode = false;/.test(mixer), "새 방송에 들어가면 건너뛰기 모드를 푼다");
check(/syncCatchUp\.video\?\.removeEventListener\("waiting", syncCatchUp\.onWaiting\)/.test(fnSrc("stopSyncCatchUp")),
  "따라잡기가 끝나면 멈춤 감시를 뗀다");
check(/배속 중 끊겨 이 방송은 받아 둔 구간 안에서 건너뛰어 따라잡습니다/.test(mixer), "우클릭 메뉴에 건너뛰기 중임을 알린다");

// 5) 우클릭 메뉴 조절
{
  const posted = [];
  const applied = [];
  const ctx = {
    SYNC_ADJUST_STEP_S: 0.5, SYNC_CUSTOM_TARGET_MAX_S: 20, SYNC_CUSTOM_ENABLE_MAX_S: 30, SYNC_PRESETS: { normal: { enable: 3, target: 2 } },
    syncCfg: { enable: 3, target: 2 }, BRIDGE_ORIGIN: "x", SYNC_BUTTON_CLASS: "b", SYNC_MENU_ID: "m",
    window: { postMessage: (m) => posted.push(m) },
    document: { querySelector: () => null, getElementById: () => null },
  };
  ctx.applySyncPreset = (key, cfg) => { applied.push([key, cfg]); ctx.syncCfg = cfg; };
  ctx.openSyncMenu = () => {};
  vm.createContext(ctx);
  vm.runInContext(fnSrc("normalizeSyncCustom") + fnSrc("adjustSyncCustom") + "\nthis.adjust=adjustSyncCustom;this.norm=normalizeSyncCustom;", ctx);
  ctx.adjust("target", 0.5);
  check(JSON.stringify(applied.at(-1)) === '["custom",{"enable":3,"target":2.5}]' &&
    posted.at(-1).type === "save-sync-custom" && posted.at(-1).custom.target === 2.5,
    `목표 +0.5 → 커스텀 {3, 2.5} 로 적용·저장 ${JSON.stringify(applied.at(-1))}`);
  ctx.adjust("target", 0.5);
  check(ctx.syncCfg.enable === 3.5 && ctx.syncCfg.target === 3, "목표가 시작에 닿으면 시작을 함께 민다(시작 > 목표 0.5초 유지)");
  ctx.adjust("enable", -0.5);
  ctx.adjust("enable", -0.5);
  check(ctx.syncCfg.enable === 2.5 && ctx.syncCfg.target === 2, `시작을 줄이면 목표도 함께 내린다 ${JSON.stringify(ctx.syncCfg)}`);
  ctx.syncCfg = { enable: 30, target: 20 };
  ctx.adjust("target", 0.5);
  check(ctx.syncCfg.target === 20, "목표는 20초까지");
  check(JSON.stringify(ctx.norm({ enable: 25, target: 15 })) === '{"enable":25,"target":15}', "커스텀 목표 15초도 받아들인다(예전 상한 10초)");
}
check(/if \(data\.type === "save-sync-custom"\) \{[\s\S]{0,400}?target > 20 \|\| enable < 2 \|\| enable > 30 \|\| enable <= target[\s\S]{0,200}?\[SYNC_PRESET_KEY\]: "custom", \[SYNC_CUSTOM_KEY\]: \{ enable, target \}/.test(content),
  "격리 월드가 값을 확인해 민감도를 커스텀으로 저장한다");
check(/id="syncCustomTarget"\s+min="1"\s+max="20"/.test(settingsHtml) && /목표 1~20초/.test(settingsHtml) &&
  /syncCustomTarget\?\.value,\s*1,\s*20,/.test(settingsJs) && /clamp\(c\.target, 1, 20,/.test(settingsJs),
  "설정 화면 커스텀 목표 상한도 20초");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
