// 멀티뷰 '화면 정리를 완료하지 못했습니다' 진단 스니펫
//
// 쓰는 법
//  1. 멀티뷰 시청 탭을 연다(안내가 뜬 상태 그대로 두면 된다).
//  2. F12 → Console 을 연다.
//  3. 콘솔 상단의 프레임 선택 상자에서 top 이 아니라 멀티뷰 칸 하나
//     (chzzk.naver.com/live/... 로 시작하는 것)를 고른다.
//  4. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  5. 출력 전체를 그대로 붙여 준다.
//
// ⚠ 콘솔은 MAIN world 다. content.js(격리 월드)의 변수는 직접 못 본다. 그래서
//   여기서는 '눈에 보이는 결과' 만 확인한다 — DOM 상태, 실제로 오가는 메시지,
//   접기/넓은 화면이 지금 어떤지.
(() => {
  "use strict";

  const out = [];
  const log = (label, value) => out.push(`${label}: ${value}`);

  // ── 이 프레임이 멀티뷰 칸이 맞는지 ──────────────────────────────────────
  const params = new URLSearchParams(location.search);
  log("주소", location.href.slice(0, 120));
  log("cheeseMulti", params.get("cheeseMulti"));
  log("cheeseMultiMain", params.get("cheeseMultiMain"));
  log("최상위 프레임인가", String(window.top === window));
  log("readyState", document.readyState);

  // ── 채팅 접기 상태 ──────────────────────────────────────────────────────
  const aside = document.querySelector("aside#aside-chatting");
  const folded =
    !!aside && [...aside.classList].some((c) => c.startsWith("_is_folded_"));
  const foldBtnLabel = document.querySelector('button[aria-label="채팅 접기"]');
  const foldBtnFolded = document.querySelector(
    'button[class*="_folded_button_"]',
  );
  let foldBtnText = null;
  for (const btn of document.querySelectorAll("button")) {
    if ((btn.textContent || "").trim() === "채팅 (J)") foldBtnText = btn;
  }
  log("채팅 aside 있음", String(!!aside));
  log("지금 접힘", String(folded));
  log(
    "접기 버튼",
    `label=${!!foldBtnLabel} folded=${!!foldBtnFolded} text=${!!foldBtnText}`,
  );
  log("aside 클래스", (aside?.className || "(없음)").slice(0, 120));
  // 우리 마스킹 클래스가 남아 있으면 재교정이 아직 도는 중이라는 뜻이다.
  log(
    "마스킹 클래스",
    document.documentElement.className
      .split(/\s+/)
      .filter((c) => c.startsWith("cheese-chat-fold"))
      .join(",") || "(없음)",
  );

  // ── 넓은 화면 상태 ──────────────────────────────────────────────────────
  const vm =
    document.querySelector(".pzp-pc__viewmode-button") ||
    document.querySelector(".pzp-pc-viewmode-button") ||
    document.querySelector(".pzp-viewmode-button") ||
    document.querySelector(
      "button[aria-label='넓은 화면'], button[aria-label='좁은 화면']",
    );
  const playerBox = document.querySelector(
    "div#layout-body #live_player_layout, div#layout-body #player_layout",
  );
  const wideOn =
    !!playerBox?.closest?.('[class*="_is_large_"]') ||
    (!!vm &&
      (vm.hasAttribute("checked") ||
        vm.getAttribute("aria-label") === "좁은 화면"));
  log("viewmode 버튼 있음", String(!!vm));
  log("viewmode aria-label", vm?.getAttribute("aria-label") ?? "(없음)");
  log("지금 넓은 화면", String(wideOn));
  log("video 있음", String(!!document.querySelector("video")));

  // ── 우리 확장이 이 프레임에 붙었는지 ────────────────────────────────────
  // content.js 가 붙인 루트 클래스로 간접 확인한다(격리 월드 변수는 못 본다).
  const rootClasses = document.documentElement.className
    .split(/\s+/)
    .filter((c) => c.startsWith("cheese-"));
  log("cheese 루트 클래스", rootClasses.join(",") || "(없음 — 주입 안 됨?)");

  // ── 오가는 메시지 엿보기 ────────────────────────────────────────────────
  // 부모 지시(APPLY_MULTIVIEW_UI)와 MAIN world 신호를 잠시 기록한다.
  const seen = [];
  const onMessage = (event) => {
    const d = event.data;
    if (!d || typeof d !== "object") return;
    const src = String(d.source || "");
    if (!src.startsWith("cheese")) return;
    seen.push(`${src}/${d.type || ""} from=${event.origin || "(same)"}`);
  };
  window.addEventListener("message", onMessage);

  console.log(
    "%c[치즈 플래터] 멀티뷰 진단 — 지금 상태",
    "font-weight:bold;color:#00c07f",
  );
  console.log(out.join("\n"));

  // 부모에게 화면 정리를 다시 시켜 보고, 그 사이 무슨 메시지가 오가는지 본다.
  console.log("10초 동안 메시지를 지켜봅니다. 그동안 그대로 두세요…");
  setTimeout(() => {
    window.removeEventListener("message", onMessage);
    const after = {
      접힘: (() => {
        const a = document.querySelector("aside#aside-chatting");
        return !!a && [...a.classList].some((c) => c.startsWith("_is_folded_"));
      })(),
      넓은화면: (() => {
        const b =
          document.querySelector(".pzp-pc__viewmode-button") ||
          document.querySelector(
            "button[aria-label='넓은 화면'], button[aria-label='좁은 화면']",
          );
        const box = document.querySelector(
          "div#layout-body #live_player_layout, div#layout-body #player_layout",
        );
        return (
          !!box?.closest?.('[class*="_is_large_"]') ||
          (!!b &&
            (b.hasAttribute("checked") ||
              b.getAttribute("aria-label") === "좁은 화면"))
        );
      })(),
    };
    console.log(
      "%c[치즈 플래터] 10초 뒤 상태",
      "font-weight:bold;color:#00c07f",
    );
    console.log(
      [
        `10초 뒤 접힘: ${after.접힘}`,
        `10초 뒤 넓은 화면: ${after.넓은화면}`,
        `그동안 오간 cheese 메시지 ${seen.length}건:`,
        ...(seen.length ? seen.map((s) => `  - ${s}`) : ["  (없음)"]),
      ].join("\n"),
    );
  }, 10000);
})();
