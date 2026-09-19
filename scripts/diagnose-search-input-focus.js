// 검색 입력칸이 한 번 클릭으로 포커스를 못 받는 문제 — 포커스를 누가 되가져가나.
//
// 지금까지 확인된 것
//  - 우리 캡처 리스너는 실제로 돈다(콘솔 로그 `pd cheese-vod-search-input 1`).
//  - 그런데도 클릭 한 번으로는 입력이 안 된다.
//    → focus() 는 불리는데, 그 뒤 누군가 포커스를 가져간다는 뜻이다.
//
// 이 스니펫은 '언제, 무엇이' 가져가는지 기록한다. focus/blur 를 가로채 호출한
// 쪽의 스택까지 남기므로, 치지직 코드인지 우리 코드인지 바로 갈린다.
//
// 쓰는 법
//  1. 다시보기에서 '채팅 활성도' 버튼을 우클릭해 구간 요약을 연다.
//  2. 머리말의 돋보기를 눌러 검색 화면으로 들어간다(입력칸이 보이는 상태).
//  3. F12 → Console. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  4. 안내가 뜨면 입력칸을 '한 번' 클릭하고, 이어서 아무 글자나 쳐 본다.
//  5. 3초 뒤 출력되는 [focus-summary] 와 [focus-trace] 를 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 화면이나 설정을 바꾸지 않는다(가로챈 것은 끝나면 되돌린다).
(() => {
  "use strict";

  const SEL = ".cheese-vod-search-input";
  const input = document.querySelector(SEL);
  if (!input) {
    console.log(
      "%c[치즈 플래터] 검색 입력칸이 보이지 않습니다. 구간 요약 → 돋보기(검색)까지 연 뒤 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(1);
  const trace = [];
  const desc = (el) => {
    if (!el) return "(없음)";
    const cls = (el.className || "").toString().trim().split(/\s+/)[0] || "";
    return `${el.tagName}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
  };
  // 호출한 쪽을 한 줄로. 우리 코드인지 치지직인지 구분하는 데 쓴다.
  const caller = () => {
    const lines = (new Error().stack || "").split("\n").slice(3, 6);
    return lines
      .map((l) => l.trim().replace(/^at\s+/, ""))
      .filter(Boolean)
      .join(" ← ")
      .slice(0, 220);
  };
  const log = (label, extra) =>
    trace.push({
      t: at(),
      label,
      active: desc(document.activeElement),
      ...extra,
    });

  // ── focus/blur 를 가로채 '누가 불렀는지' 를 남긴다 ──────────────────────
  const origFocus = HTMLElement.prototype.focus;
  const origBlur = HTMLElement.prototype.blur;
  HTMLElement.prototype.focus = function (...args) {
    if (
      this === input ||
      this.contains?.(input) ||
      document.activeElement === input
    ) {
      log("focus() 호출됨", { target: desc(this), by: caller() });
    }
    return origFocus.apply(this, args);
  };
  HTMLElement.prototype.blur = function (...args) {
    if (this === input)
      log("blur() 호출됨", { target: desc(this), by: caller() });
    return origBlur.apply(this, args);
  };

  // ── 이벤트 순서 ────────────────────────────────────────────────────────
  const onAny = (e) => {
    if (e.type === "focusout" || e.type === "blur") {
      log(`${e.type}(입력칸)`, { to: desc(e.relatedTarget) });
    } else if (e.type === "focusin" || e.type === "focus") {
      log(`${e.type}(입력칸)`, { from: desc(e.relatedTarget) });
    }
  };
  for (const type of ["focus", "blur", "focusin", "focusout"]) {
    input.addEventListener(type, onAny, true);
  }

  // 눌림 계열을 캡처로 훑어 순서를 남긴다. defaultPrevented 도 함께 본다.
  const seen = [];
  const onPointer = (e) => {
    const onInput = e.target === input;
    if (!onInput) return;
    seen.push(e.type);
    log(e.type, {
      phase: e.eventPhase, // 1=캡처 2=대상 3=버블
      defaultPrevented: e.defaultPrevented,
    });
    // 이 이벤트 뒤에 포커스가 어떻게 되는지.
    queueMicrotask(() => log(`  └ ${e.type} 직후(micro)`, {}));
  };
  const types = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  for (const type of types) document.addEventListener(type, onPointer, true);

  // 실제로 글자가 들어가는지.
  const onKey = (e) =>
    log("keydown", { key: e.key, onInput: e.target === input });
  document.addEventListener("keydown", onKey, true);

  console.log(
    "%c[치즈 플래터] 검색 입력칸 포커스 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(
    `입력칸: ${desc(input)} (disabled=${input.disabled})\n` +
      `조상: ${(() => {
        const out = [];
        let cur = input.parentElement;
        for (let i = 0; cur && i < 6; i += 1) {
          out.push(desc(cur));
          cur = cur.parentElement;
        }
        return out.join(" ← ");
      })()}\n\n` +
      "이제 입력칸을 '한 번' 클릭하고, 이어서 아무 글자나 쳐 주세요. 3초 뒤 결과가 나옵니다…",
  );

  setTimeout(() => {
    // 가로챈 것을 되돌린다.
    HTMLElement.prototype.focus = origFocus;
    HTMLElement.prototype.blur = origBlur;
    for (const type of types)
      document.removeEventListener(type, onPointer, true);
    document.removeEventListener("keydown", onKey, true);
    for (const type of ["focus", "blur", "focusin", "focusout"]) {
      input.removeEventListener(type, onAny, true);
    }

    const stolen = trace.find(
      (r) => r.label === "blur() 호출됨" || r.label === "focusout(입력칸)",
    );
    console.log("%c[focus-summary]", "font-weight:bold;color:#00c07f", {
      최종_activeElement: desc(document.activeElement),
      입력칸이_포커스를_가졌나: document.activeElement === input,
      입력값: input.value,
      받은_눌림_이벤트: seen.join(" → ") || "(없음)",
      포커스를_잃은_지점: stolen
        ? `${stolen.t}ms ${stolen.label}`
        : "(잃지 않음)",
      // ⚠ 이 값이 핵심이다. 우리 코드면 content.js 가, 치지직이면 다른 파일이 찍힌다.
      포커스를_가져간_쪽: stolen?.by || stolen?.to || "(없음)",
    });
    console.log("[focus-trace]");
    console.table(trace);
    console.log("위 두 출력을 그대로 보내 주세요.");
  }, 3000);
})();
