// 라이브 멈춤 자동 복구 상태 기계 검증.
//
// 증상: 방송이 끝났는데도 "재생이 멈춰 있어 되돌렸습니다" 가 뜨고 되감기를 한다.
//
// 원인: 치지직 라이브는 방송이 끝나도 video.ended 가 서지 않는다. 대신
// readyState 가 낮은 채 currentTime 이 버퍼 끝을 넘어선 상태로 남는데, 이것은
// '멈춤' 과 신호가 완전히 같다. 그래서 종료된 방송에서 복구가 발동했다.
//
// ⚠ 이 파일은 audioMixer.js 의 stallTick 규칙을 '복제' 한다. 원본을 고치면 여기도
//   함께 고쳐야 한다(브라우저 DOM 에 묶여 있어 Node 에서 그대로 못 부른다).

const fs = require("fs");
const path = require("path");

const STALL_CHECK_MS = 1000;
const STALL_MIN_MS = 8000;
const STALL_MAX_FIX = 3;

let failed = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failed += 1;
  }
};

// audioMixer.js 와 같은 규칙.
function makeWatcher() {
  let stallSince = 0;
  let stallLastTime = -1;
  let stallFixes = 0;
  let stallLastFixAt = 0;
  const recoveries = [];

  const reset = () => {
    stallSince = 0;
    stallLastTime = -1;
    stallFixes = 0;
  };

  const looksStalled = (v) => {
    if (!v || v.paused || v.ended) return false;
    if (v.readyState >= 3) return false;
    const end = v.bufferedEnd;
    if (!Number.isFinite(end)) return false;
    return v.currentTime > end || v.seeking === true;
  };

  // 종료 판정: ended 하나만 보지 않고 종료 화면까지 본다.
  const looksEnded = (v) => v.ended === true || v.endScreen === true;

  return {
    get fixes() {
      return stallFixes;
    },
    recoveries,
    tick(now, video, { onLive = true } = {}) {
      if (!onLive) {
        reset();
        return;
      }
      if (!video) {
        reset();
        return;
      }
      if (looksEnded(video)) {
        reset();
        return;
      }
      const ct = video.currentTime;
      if (stallLastTime >= 0 && Math.abs(ct - stallLastTime) > 0.05) {
        reset();
        stallLastTime = ct;
        return;
      }
      stallLastTime = ct;
      if (!looksStalled(video)) {
        reset();
        return;
      }
      if (!stallSince) stallSince = now;
      if (now - stallSince < STALL_MIN_MS) return;
      if (stallFixes >= STALL_MAX_FIX) return;
      if (now - stallLastFixAt < STALL_MIN_MS) return;
      stallFixes += 1;
      stallLastFixAt = now;
      recoveries.push(now);
    },
  };
}

// 멈춘 라이브(방송 중). readyState 낮고 재생 위치가 버퍼 끝을 넘어섰다.
const stalledVideo = (over = {}) => ({
  paused: false,
  ended: false,
  endScreen: false,
  readyState: 2,
  currentTime: 100,
  bufferedEnd: 99,
  seeking: false,
  ...over,
});

const run = (w, video, ticks, opts) => {
  for (let i = 1; i <= ticks; i += 1) w.tick(i * STALL_CHECK_MS, video, opts);
};

console.log("[A] 정상 라이브 멈춤 — 기존 자동 복구는 그대로 동작한다");
{
  const w = makeWatcher();
  run(w, stalledVideo(), 15);
  ok(w.recoveries.length >= 1, `멈춤이 지속되면 되돌린다(${w.fixes}회)`);
  ok(w.fixes <= STALL_MAX_FIX, "정해진 횟수를 넘지 않는다");
}

console.log("\n[B] 방송 종료 — 복구가 아예 일어나지 않는다");
{
  // ⚠ 종료된 방송의 video 는 '멈춤' 과 신호가 같다. 종료 화면으로만 가려낸다.
  const w = makeWatcher();
  run(w, stalledVideo({ endScreen: true }), 30);
  ok(w.recoveries.length === 0, "종료 화면이 떠 있으면 되돌리지 않는다");

  const w2 = makeWatcher();
  run(w2, stalledVideo({ ended: true }), 30);
  ok(w2.recoveries.length === 0, "video.ended 여도 되돌리지 않는다");
}

console.log("\n[C] 종료 직전 멈춤 — 쌓아 둔 시도까지 취소한다");
{
  const w = makeWatcher();
  const video = stalledVideo();
  // 종료 직전까지 멈춤이 쌓인다(아직 임계 미만).
  run(w, video, 7);
  ok(w.recoveries.length === 0, "아직 임계 전이라 시도하지 않았다");
  // 방송이 끝난다.
  video.endScreen = true;
  for (let i = 8; i <= 40; i += 1) w.tick(i * STALL_CHECK_MS, video);
  ok(w.recoveries.length === 0, "종료되면 쌓아 둔 멈춤이 발동하지 않는다");
}

console.log("\n[D] 종료 후 다른 방송으로 이동 — 새 방송에서는 정상 동작");
{
  const w = makeWatcher();
  const ended = stalledVideo({ endScreen: true });
  run(w, ended, 20);
  ok(w.recoveries.length === 0, "종료된 방송에서는 아무것도 하지 않았다");
  // 같은 SPA 에서 다른 방송으로 이동(종료 화면이 사라지고 새 재생이 시작).
  const next = stalledVideo();
  for (let i = 21; i <= 60; i += 1) w.tick(i * STALL_CHECK_MS, next);
  ok(w.recoveries.length >= 1, "새 방송에서는 다시 멈춤 복구가 동작한다");
}

console.log("\n[E] 화질 변경·광고로 잠깐 끊김 — 종료로 오판하지 않는다");
{
  const w = makeWatcher();
  const video = stalledVideo();
  // 잠깐 멈췄다가(임계 미만) 재생이 다시 진행된다.
  run(w, video, 5);
  video.currentTime = 105; // 시간이 흐르기 시작
  video.readyState = 4;
  video.bufferedEnd = 110;
  for (let i = 6; i <= 20; i += 1) w.tick(i * STALL_CHECK_MS, video);
  ok(w.recoveries.length === 0, "잠깐의 끊김은 되돌리지 않는다");
  ok(w.fixes === 0, "종료로도, 멈춤으로도 보지 않는다");
}

console.log("\n[라이브 아님] 다시보기·다른 페이지에서는 동작하지 않는다");
{
  const w = makeWatcher();
  run(w, stalledVideo(), 30, { onLive: false });
  ok(w.recoveries.length === 0, "라이브 페이지가 아니면 아무것도 하지 않는다");
}

console.log("\n[소스 확인] 종료 판정이 실제로 들어가 있다");
{
  const mixer = fs.readFileSync(
    path.join(__dirname, "..", "src", "audioMixer.js"),
    "utf8",
  );
  ok(/function liveLooksEnded/.test(mixer), "종료 판정 함수가 있다");
  ok(
    /다음 라이브를 기대해주세요/.test(mixer),
    "종료 화면 문구로 확인한다(ended 하나만 보지 않는다)",
  );
  const tick = mixer.slice(
    mixer.indexOf("function stallTick"),
    mixer.indexOf("function startStallWatch"),
  );
  ok(
    /liveLooksEnded\(video\)/.test(tick),
    "멈춤 판정보다 먼저 종료를 확인한다",
  );
  // 종료 확인이 멈춤 누적보다 앞에 있어야 예약된 시도까지 취소된다.
  ok(
    tick.indexOf("liveLooksEnded") < tick.indexOf("looksStalled"),
    "종료 확인이 멈춤 누적보다 앞에 있다",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
