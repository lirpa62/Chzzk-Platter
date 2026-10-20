// 종료로 알린 멀티뷰 라이브 칸이 방송 재개 뒤 '방송이 종료되었습니다.' 덮개에 갇히지 않는지,
// 치지직 PIP 로 같은 방송에 돌아왔을 때 자동 넓은 화면을 다시 거는지 검증.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const content = read("src/content.js");
const watch = read("src/multiviewWatch.js");
const mixer = read("src/audioMixer.js");

// ── 프레임: 종료 알림 → 재생이 실제로 이어지면 FRAME_ENDED_CANCEL ──────────────
const from = content.indexOf("    const notifyMultiviewEnded = (byVideo) => {");
const to = content.indexOf("    // ⚠ 라이브는 장비 재정비로 송출이 잠깐 끊겨도 video 가 ended 된다.");
assert.ok(from > 0 && to > from, "프레임 종료·재개 구간을 찾지 못했다");

class FakeMedia {}
function makeFrame(pathname = "/live/" + "a".repeat(32)) {
  const sent = [];
  const timers = new Map();
  let nextTimer = 1;
  const ctx = {
    HTMLMediaElement: FakeMedia,
    location: { pathname },
    sent,
    endScreen: false,
    ad: false,
    notifyParent: (type) => sent.push(type),
    isAdPlaying: () => ctx.ad,
    isReliveEndScreenVisible: () => ctx.endScreen,
    checkEnded: () => {},
    setInterval: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
    clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(
    "let endedNotified=false, endedByVideo=false, endedTimer=0, endedMutationCheckTimer=0, currentVideo=null;\n" +
      content.slice(from, to) +
      "\nthis.api={notifyMultiviewEnded,setVideo:(v)=>{currentVideo=v;},ended:()=>endedNotified};",
    ctx,
  );
  const tick = () => { for (const fn of [...timers.values()]) fn(); };
  return { ctx, sent, timers, tick };
}
const playingVideo = (time = 10) => Object.assign(new FakeMedia(), {
  isConnected: true, paused: false, ended: false, readyState: 4, currentTime: time,
});

{
  const { ctx, sent, timers, tick } = makeFrame();
  ctx.api.notifyMultiviewEnded(false);
  assert.deepEqual(sent, ["FRAME_ENDED"]);
  assert.equal(timers.size, 1, "종료 뒤 재개 감시를 건다");
  // 종료 화면이 보이는 동안은 재생 중이어도 되돌리지 않는다.
  const video = playingVideo(10);
  ctx.api.setVideo(video);
  ctx.endScreen = true;
  tick(); video.currentTime = 12; tick();
  assert.deepEqual(sent, ["FRAME_ENDED"], "종료 화면이 보이면 재개로 보지 않는다");
  // 광고는 재개가 아니다.
  ctx.endScreen = false;
  ctx.ad = true;
  tick(); video.currentTime = 14; tick();
  assert.deepEqual(sent, ["FRAME_ENDED"], "광고 재생은 재개로 보지 않는다");
  // 시간이 흐르지 않는 마지막 화면은 재개가 아니다.
  ctx.ad = false;
  tick(); tick();
  assert.deepEqual(sent, ["FRAME_ENDED"], "멈춘 화면은 재개로 보지 않는다");
  // 종료 화면이 사라지고 시간이 흐르면 한 번만 되돌린다.
  video.currentTime = 15;
  tick();
  assert.deepEqual(sent, ["FRAME_ENDED", "FRAME_ENDED_CANCEL"], "방송이 다시 이어지면 종료를 거둔다");
  assert.equal(ctx.api.ended(), false);
  video.currentTime = 20;
  tick();
  assert.deepEqual(sent, ["FRAME_ENDED", "FRAME_ENDED_CANCEL"], "되돌린 뒤엔 감시를 멈춘다");
  // 다시 끝나면 다시 알린다.
  ctx.api.notifyMultiviewEnded(false);
  assert.equal(sent.at(-1), "FRAME_ENDED");
}
{
  const { ctx, sent, timers } = makeFrame("/video/123");
  ctx.api.notifyMultiviewEnded(true);
  assert.equal(timers.size, 0, "다시보기 칸은 재개 감시를 걸지 않는다");
  assert.deepEqual(sent, ["FRAME_ENDED"]);
}
// 재정비 안내로 되돌릴 때도 재개 감시를 멈춘다.
assert.match(content, /isLiveRestartGuideVisible\(\)\) \{\n\s*stopLiveResumeWatch\(\);\n\s*endedNotified = false;/);

// ── 부모: 종료 칸 처리 ───────────────────────────────────────────────
// 라이브 칸에 FRAME_READY 가 다시 오면 새로 뜬 프레임으로 본다(다시보기 종료는 그대로).
assert.match(watch, /if \(currentStatus\(channelId\) === "ended" && isVideoSlot\(channelId\)\) return;/);
// 자동 확인: 보이는 동안만, 종료 20초 뒤부터, OPEN·closeDate 없음일 때 그 칸만, 10분에 3번까지.
{
  const block = watch.slice(watch.indexOf("  async function autoRecheckEnded() {"), watch.indexOf("  function armReadyTimeout(channelId) {"));
  assert.ok(block.includes("if (document.hidden || endedRechecking) return;"));
  assert.ok(block.includes("< ENDED_RECHECK_MIN_AGE_MS) continue;"));
  assert.ok(block.includes("if (recent.length >= ENDED_AUTO_RELOAD_LIMIT) continue;"));
  assert.ok(/detail\?\.status === "OPEN" && !detail\.closeDate\) \{\n\s*recent\.push\(Date\.now\(\)\);\n\s*reloadFrame\(channelId\);/.test(block));
  assert.ok(/const ENDED_AUTO_RELOAD_LIMIT = 3;/.test(watch) && /const ENDED_RECHECK_MS = 30000;/.test(watch));
  assert.ok(/updateSyncPolling\(\);\n\s*updateEndedRecheck\(\);/.test(watch), "상태가 바뀔 때마다 자동 확인을 켜고 끈다");
}

// ── 자동 넓은 화면: PIP 로 남았다가 같은 방송으로 돌아오면 다시 적용 ──────────
{
  const keep = mixer.indexOf("      if (keepGraph) {\n        wideScreenPipReturnPending = true;");
  const consume = mixer.indexOf("    if (wideScreenPipReturnPending) {\n      wideScreenPipReturnPending = false;\n      // 다른 방송으로 갔으면 아래 '새 미디어' 리셋이 같은 일을 한다.\n      if (pageKey === currentPageKey) resetWideScreenAttempt();\n    }\n    if (pageKey !== currentPageKey) {");
  assert.ok(keep > 0, "PIP 로 남을 때 돌아오면 다시 적용하도록 표시한다");
  assert.ok(consume > keep, "돌아왔을 때 같은 방송이면 넓은 화면 시도를 다시 연다");
  assert.ok(/if \(wideScreenPipReturnPending\) return false;/.test(mixer), "표시가 남아 있으면 가벼운 tick 으로 건너뛰지 않는다");
  assert.ok(mixer.includes("if (!isViewModeButtonReady(btn) || btn.closest(\"[class*='_type_pip_'], .pzp-pc--pip\")) {"),
    "PIP 안의 버튼은 누르지 않고 제자리로 올 때까지 기다린다");
}

console.log("전부 통과");
