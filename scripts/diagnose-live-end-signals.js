// 방송이 실제로 끝날 때 어떤 신호가 '먼저' 오는지 기록한다.
//
// 왜 필요한가
//   라이브 멈춤 자동 복구는 8초(STALL_MIN_MS) 동안 멈춤이 이어지면 되돌린다.
//   종료 판정은 지금 두 가지뿐이다.
//     - video.ended
//     - 종료 화면 문구('다음 라이브를 기대해주세요')가 보이는지
//   둘 중 어느 것도 8초 안에 나타나지 않으면, 방송이 끝났는데도 복구가 한 번
//   나갈 수 있다. 실제로 그 창이 얼마나 되는지 재야 고칠 수 있다.
//
// ⚠ 추측으로 selector 나 문구를 더하지 않기 위한 스니펫이다. 값만 읽는다.
//
// 쓰는 법
//  1. 곧 끝날 것 같은 라이브 방송을 연다(끝나기 몇 분 전이면 좋다).
//  2. F12 → Console. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  3. 그대로 두고 방송이 끝나기를 기다린다.
//  4. 종료 화면이 뜬 뒤 30초쯤 지나면 [live-end-summary] 가 출력된다.
//     (수동으로 보고 싶으면 아무 때나 window.__cheeseLiveEndReport() 를 부른다)
//  5. 출력 전체를 그대로 보내 준다.
(() => {
  "use strict";

  if (!location.pathname.startsWith("/live/")) {
    console.log(
      "%c[치즈 플래터] 라이브 페이지에서 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(0);
  const marks = []; // { t, what }
  const seen = new Set();
  const once = (what) => {
    if (seen.has(what)) return;
    seen.add(what);
    marks.push({ t: at(), what });
    console.log(`[live-end] ${at()}ms  ${what}`);
  };

  const END_TEXTS = ["다음 라이브를 기대해주세요"];
  // audioMixer.js / content.js 와 같은 선택자.
  function endScreenVisible() {
    try {
      const els = document.querySelectorAll(
        'main [class*="_player_"] p, #layout-body [class*="_player_"] p,' +
          ' main [class*="_player_"] [class*="_text_"],' +
          ' #layout-body [class*="_player_"] [class*="_text_"]',
      );
      for (const el of els) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect?.();
        if (!r || r.width <= 0 || r.height <= 0) continue;
        if (END_TEXTS.some((m) => String(el.textContent || "").includes(m))) {
          return true;
        }
      }
    } catch {}
    return false;
  }

  const video = document.querySelector("video");
  if (!video) {
    console.log(
      "%c[치즈 플래터] video 를 찾지 못했습니다. 재생이 시작된 뒤 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  // ── video 이벤트(가장 이른 신호 후보) ──────────────────────────────────
  const VIDEO_EVENTS = [
    "ended",
    "emptied",
    "error",
    "abort",
    "stalled",
    "waiting",
    "suspend",
    "pause",
  ];
  const onVideo = (e) => once(`video:${e.type}`);
  for (const type of VIDEO_EVENTS) video.addEventListener(type, onVideo);

  // ── 1초마다 상태를 본다(멈춤 감시와 같은 주기) ─────────────────────────
  const samples = [];
  let lastTime = -1;
  let stalledSince = 0;
  const tick = () => {
    const ct = video.currentTime;
    let bufEnd = null;
    try {
      if (video.buffered?.length) {
        bufEnd = +video.buffered.end(video.buffered.length - 1).toFixed(2);
      }
    } catch {}
    // audioMixer.js 의 looksStalled 와 같은 규칙.
    const stalled =
      !video.paused &&
      !video.ended &&
      video.readyState < 3 &&
      Number.isFinite(bufEnd) &&
      (ct > bufEnd || video.seeking === true);
    if (stalled && !stalledSince) stalledSince = at();
    if (!stalled) stalledSince = 0;

    if (video.ended) once("video.ended=true");
    if (endScreenVisible()) once("종료 화면 보임");
    if (video.networkState === 0) once("networkState=EMPTY(0)");
    if (video.networkState === 3) once("networkState=NO_SOURCE(3)");
    if (video.readyState === 0) once("readyState=0");
    if (stalledSince) once("멈춤으로 보이기 시작");
    // 멈춤이 8초를 넘으면 실제 기능은 여기서 되돌린다.
    if (stalledSince && at() - stalledSince >= 8000) {
      once("⚠ 8초 경과 — 실제 기능이라면 여기서 복구가 나간다");
    }
    // 시간이 흐르면 멈춤 아님.
    if (lastTime >= 0 && Math.abs(ct - lastTime) > 0.05) stalledSince = 0;
    lastTime = ct;

    samples.push({
      t: at(),
      ct: +ct.toFixed(2),
      bufEnd,
      ready: video.readyState,
      net: video.networkState,
      paused: video.paused,
      ended: video.ended,
      seeking: video.seeking,
      endScreen: endScreenVisible(),
    });
    if (samples.length > 600) samples.shift(); // 10분치만
  };
  const timer = setInterval(tick, 1000);
  tick();

  // 종료 화면이 뜨면 30초 뒤 자동 보고.
  let reportTimer = 0;
  const watchEnd = setInterval(() => {
    if (!reportTimer && (endScreenVisible() || video.ended)) {
      reportTimer = setTimeout(report, 30000);
      console.log("[live-end] 종료 감지 — 30초 뒤 요약을 출력합니다…");
    }
  }, 1000);

  function report() {
    clearInterval(timer);
    clearInterval(watchEnd);
    for (const type of VIDEO_EVENTS) video.removeEventListener(type, onVideo);
    const first = (what) => marks.find((m) => m.what === what)?.t ?? null;
    const endScreenAt = first("종료 화면 보임");
    const endedAt = first("video.ended=true");
    const stallAt = first("멈춤으로 보이기 시작");
    // ⚠ 이 값이 핵심이다. 멈춤이 시작되고 8초 안에 종료 신호가 왔는가?
    const earliestEnd = [endedAt, endScreenAt, first("networkState=EMPTY(0)")]
      .filter((v) => v !== null)
      .sort((a, b) => a - b)[0];
    console.log("%c[live-end-summary]", "font-weight:bold;color:#00c07f", {
      멈춤_시작ms: stallAt,
      video_ended_ms: endedAt,
      종료화면_ms: endScreenAt,
      networkState_EMPTY_ms: first("networkState=EMPTY(0)"),
      가장_이른_종료신호_ms: earliestEnd ?? null,
      // 이 값이 8000 보다 크면 그 사이에 복구가 한 번 나간다.
      멈춤부터_종료신호까지_ms:
        stallAt !== null && earliestEnd !== undefined
          ? earliestEnd - stallAt
          : null,
      복구가_나갔을까: marks.some((m) => m.what.startsWith("⚠ 8초")),
    });
    console.log("[live-end-marks]");
    console.table(marks);
    console.log("[live-end-samples] 마지막 40초");
    console.table(samples.slice(-40));
    console.log("위 세 출력을 그대로 보내 주세요.");
  }
  window.__cheeseLiveEndReport = report;

  console.log(
    "%c[치즈 플래터] 방송 종료 신호 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(
    "방송이 끝날 때까지 이 탭을 그대로 두세요.\n" +
      "종료가 감지되면 30초 뒤 자동으로 요약이 나옵니다.\n" +
      "바로 보고 싶으면 window.__cheeseLiveEndReport() 를 실행하세요.",
  );
})();
