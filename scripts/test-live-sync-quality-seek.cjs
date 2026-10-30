// 실시간 따라잡기
//  - 화질을 바꾸면 플레이어가 스트림을 다시 받으며 seek 가 생기고 지연이 늘거나(NaN) 잴 수 없어, 사용자 되감기로 잡혀
//    자동 따라잡기가 60초 쉬었다 → 위치를 옮기려는 조작(플레이어 누름·방향키) 직후의 seek 만 사용자 되감기로 본다.
//  - 화질·설정 메뉴를 누른 직후의 버퍼링은 기준 늦추기에 세지 않는다.
//  - '버퍼링 시 기준 늦추기' 설정(기본 켬)과 5분마다 0.5초씩 되돌리기.
// 게인 막대 위 휠, 사이드바 멀티뷰 위치 설정의 연결도 함께 본다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const mixer = read("src/audioMixer.js");
const content = read("src/content.js");
const settingsHtml = read("settings.html");
const settingsJs = read("src/settings.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const fnSrc = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};
const constValue = (name) => {
  const match = mixer.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, name);
  return vm.runInNewContext(match[1]);
};

// ── 되감기 판정: 조작 직후의 seek 만 ─────────────────────────────────────
{
  const ctx = vm.createContext({
    Date,
    SYNC_BACK_SEEK_MIN_S: constValue("SYNC_BACK_SEEK_MIN_S"),
    SYNC_USER_SEEK_PAUSE_MS: constValue("SYNC_USER_SEEK_PAUSE_MS"),
    SYNC_SHORT_REWIND_PAUSE_MS: constValue("SYNC_SHORT_REWIND_PAUSE_MS"),
    SYNC_SEEK_GESTURE_WINDOW_MS: constValue("SYNC_SEEK_GESTURE_WINDOW_MS"),
    latency: [],
  });
  vm.runInContext(
    "var ourSeekUntil=0,rewindButtonSeekUntil=0,lastUserSeekAt=0,autoCatchUpPauseUntil=0,preSeekLatency=NaN,lastSeekGestureAt=0;" +
      "function getLiveLatencySeconds(){return latency.shift();}" +
      fnSrc(mixer, "onUserSeeking") +
      fnSrc(mixer, "onUserSeeked") +
      "\nthis.seek=(before,after,{gestureAgo=null,shortRewind=false}={})=>{autoCatchUpPauseUntil=0;" +
      "lastSeekGestureAt=gestureAgo==null?0:Date.now()-gestureAgo;rewindButtonSeekUntil=shortRewind?Date.now()+1000:0;" +
      "latency=[before,after];onUserSeeking();onUserSeeked();return autoCatchUpPauseUntil-Date.now();};",
    ctx,
  );
  check(ctx.seek(4, 9) <= 0, "조작 없이 지연이 5초 늘어난 seek(화질 변경 재로딩)는 자동 따라잡기를 멈추지 않는다");
  check(ctx.seek(4, NaN) <= 0, "조작 없이 지연을 잴 수 없는 seek 도 멈추지 않는다");
  check(ctx.seek(4, 9, { gestureAgo: 5000 }) <= 0, "조작한 지 2.5초가 지난 seek 는 사용자 되감기가 아니다");
  check(ctx.seek(4, 9, { gestureAgo: 300 }) > 50000, "재생바를 누른 직후 과거로 옮기면 60초 멈춘다");
  check(ctx.seek(4, NaN, { gestureAgo: 300 }) > 50000, "조작 직후 잴 수 없으면 예전처럼 보수적으로 멈춘다");
  check(ctx.seek(9, 4, { gestureAgo: 300 }) <= 0, "조작 직후라도 앞으로(라이브 쪽) 옮기면 멈추지 않는다");
  const short = ctx.seek(4, 9, { shortRewind: true });
  check(short > 0 && short <= 10000, "되감기 버튼은 조작 기록과 상관없이 짧게 멈춘다");
}

// ── 조작 분류(플레이어 누름·방향키) ─────────────────────────────────────
{
  const el = (matches) => {
    const node = { closest: (sel) => (matches.some((m) => sel.split(",").some((part) => part.trim() === m)) ? node : null) };
    return node;
  };
  const ctx = vm.createContext({ Date, Element: Object, lastSeekGestureAt: 0, lastPlayerMenuAt: 0 });
  vm.runInContext(
    "var lastSeekGestureAt=0,lastPlayerMenuAt=0,seekPointerHeld=false;" +
      fnSrc(mixer, "onSyncGesturePointer") +
      fnSrc(mixer, "onSyncGesturePointerUp") +
      fnSrc(mixer, "onSyncGestureKey") +
      "\nthis.pointer=(t)=>{lastSeekGestureAt=0;lastPlayerMenuAt=0;onSyncGesturePointer({target:t});return{seek:lastSeekGestureAt>0,menu:lastPlayerMenuAt>0};};" +
      "this.key=(key,t)=>{lastSeekGestureAt=0;onSyncGestureKey({key,target:t});return lastSeekGestureAt>0;};",
    ctx,
  );
  const progress = el([".pzp-pc"]);
  check(JSON.stringify(ctx.pointer(progress)) === '{"seek":true,"menu":false}', "플레이어 재생바 누름은 위치 조작");
  check(JSON.stringify(ctx.pointer(el([".pzp-pc", '[class*="setting"]']))) === '{"seek":false,"menu":true}', "설정·화질 메뉴 누름은 메뉴 조작(위치 조작 아님)");
  check(JSON.stringify(ctx.pointer(el([".pzp-pc", "#cheese-quality-menu"]))) === '{"seek":false,"menu":true}', "확장 화질 메뉴도 메뉴 조작");
  check(JSON.stringify(ctx.pointer(el([".pzp-pc", "[data-master-gain]"]))) === '{"seek":false,"menu":false}', "게인·음량 막대는 어느 쪽도 아니다");
  check(JSON.stringify(ctx.pointer(el([]))) === '{"seek":false,"menu":false}', "플레이어 밖은 세지 않는다");
  vm.runInContext("this.drag=()=>{seekPointerHeld=false;onSyncGesturePointer({target:this.bar});lastSeekGestureAt=0;onSyncGesturePointerUp();const a=lastSeekGestureAt>0;" +
    "lastSeekGestureAt=0;onSyncGesturePointerUp();return a&&lastSeekGestureAt===0;};", Object.assign(ctx, { bar: progress }));
  check(ctx.drag(), "재생바를 오래 끌다 뗀 순간도 위치 조작(한 번만)");
  check(ctx.key("ArrowLeft", el([])) && ctx.key("End", el([])), "방향키·End 는 위치 조작");
  check(!ctx.key("ArrowLeft", el(["input"])) && !ctx.key("a", el([])), "입력칸 안 방향키·다른 키는 세지 않는다");
}

// ── 기준 늦추기: 메뉴 직후 버퍼링 무시, 설정 끄기, 5분마다 되돌리기 ─────────────
{
  const block = mixer.slice(mixer.indexOf("  let syncAdaptBoost = 0;"), mixer.indexOf("  function loadAutoSync() {"));
  const now = { t: 1_000_000 };
  const FakeDate = { now: () => now.t };
  const ctx = vm.createContext({
    Date: FakeDate,
    SYNC_ADAPT_STEP_S: constValue("SYNC_ADAPT_STEP_S"),
    SYNC_ADAPT_MAX_S: constValue("SYNC_ADAPT_MAX_S"),
    SYNC_ADAPT_DECAY_MS: constValue("SYNC_ADAPT_DECAY_MS"),
    SYNC_MENU_QUIET_MS: constValue("SYNC_MENU_QUIET_MS"),
    SYNC_STARVED_AHEAD_S: 1,
    syncCfg: { enable: 3, target: 2 },
    updateSyncButtonState: () => {},
  });
  vm.runInContext(
    block +
      "\nthis.api={raise:raiseSyncAdapt,decay:decaySyncAdapt,reset:resetSyncAdapt,onSyncWaiting," +
      "get boost(){return syncAdaptBoost},set watch(v){syncAdaptWatch=v},get watch(){return syncAdaptWatch}," +
      "set on(v){syncAdaptOn=v},set menuAt(v){lastPlayerMenuAt=v}};",
    ctx,
  );
  const { api } = ctx;
  const video = { buffered: { length: 0 }, currentTime: 0 };
  api.menuAt = now.t - 2000;
  api.watch = { video, until: now.t + 10000 };
  api.onSyncWaiting({ currentTarget: video });
  check(api.boost === 0 && api.watch === null, "화질·설정 메뉴를 누른 직후의 버퍼링은 기준을 늦추지 않는다");
  api.menuAt = now.t - 20000;
  api.watch = { video, until: now.t + 10000 };
  api.onSyncWaiting({ currentTarget: video });
  check(api.boost === 0.5, "메뉴와 상관없는 버퍼링은 예전처럼 늦춘다");
  api.raise();
  check(api.boost === 1, "1초까지 늦춤");
  now.t += 4 * 60 * 1000;
  api.decay();
  check(api.boost === 1, "5분이 안 되면 그대로");
  now.t += 61 * 1000;
  api.decay();
  check(api.boost === 0.5, "5분 동안 버퍼링이 없으면 0.5초 되돌린다");
  api.decay();
  check(api.boost === 0.5, "되돌린 뒤 다시 5분을 센다");
  now.t += 5 * 60 * 1000;
  api.decay();
  check(api.boost === 0, "다시 5분 뒤 원래 기준");
  api.on = false;
  api.raise();
  check(api.boost === 0, "설정을 끄면 늦추지 않는다");
}
{
  const tuning = fnSrc(mixer, "applySyncTuning");
  check(/function applySyncTuning\(rate, cooldownEnabled, cooldownCustom, mode, adaptive\)/.test(tuning), "따라잡기 설정에 늦추기 on/off 를 받는다");
  check(/if \(!adaptOn && syncAdaptOn\) resetSyncAdapt\(\);/.test(tuning), "끄면 지금 늦춘 값도 되돌린다");
  check(/e\.data\.syncMode,\n\s*e\.data\.syncAdaptive,/.test(mixer), "격리 월드 값 전달");
  check(/decaySyncAdapt\(\);\n\s*const lat = getLiveLatencySeconds\(\);/.test(mixer), "버튼 상태 갱신마다 되돌리기 확인");
  check(/function ensureSeekListener\(\) \{\n\s*bindSyncGestures\(\);/.test(mixer), "조작 기록 리스너를 붙인다");
  check(content.includes('const SYNC_ADAPTIVE_KEY = "cheeseSyncAdaptive";') && /syncAdaptive, \/\/ 버퍼링 시 기준 자동 늦추기/.test(content) &&
    content.includes("changes[SYNC_ADAPTIVE_KEY] ||"), "content: 읽기·변경 감지·MAIN 으로 전달");
  check(settingsHtml.includes('data-sync-adaptive="on"') && settingsJs.includes('const SYNC_ADAPTIVE_KEY = "cheeseSyncAdaptive";') &&
    settingsJs.includes('    "cheeseSyncAdaptive",'), "설정 화면 사용/끔 + 백업 키");
}

// ── 게인 막대 위 휠 ────────────────────────────────────────────────────
check(/const gainBar = e\.target\.closest\?\.\(`\.\$\{CONTROL_CLASS\} \[data-master-gain\]`\);/.test(mixer) &&
  mixer.includes('if (gainBar || mixerWheelAction === "gain") nudgeGain(direction);'),
  "게인 막대 위 휠은 휠 동작 설정과 상관없이 게인(버튼 휠과 같은 단계)");

// ── 사이드바 멀티뷰 위치·맨 위 메뉴 순서(화면 동작은 test-sidebar-multiview-position.cjs) ──────────
check(settingsJs.includes('    "cheeseSidebarMultiviewPosition",') && settingsJs.includes('    "cheeseSidebarTopMenuOrder",') &&
  settingsHtml.includes('data-sidebar-multiview-position-value="top"') && settingsHtml.includes("data-sidebar-top-menu-order"),
  "설정 화면 위치(서비스 바로가기 안/맨 위 메뉴)·순서 목록 + 백업 키");
check(/sidebarMultiviewPosition === "services";/.test(content), "맨 위 메뉴로 옮기면 서비스 바로가기 숨김에 멀티뷰만 남기지 않는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
