// 사이드바 레이아웃·스크롤 진단 스니펫
//
// 제보 세 가지를 코드만으로는 재현하지 못했다. 이 스니펫으로 실제 환경의 값을
// 받아야 원인을 좁힐 수 있다.
//   A. 펼친 채 새로고침하면 사이드바가 헤더(e스포츠·엔터+·검색)를 덮는다
//   B. 접었다 펴면 휠 스크롤이 안 된다
//   C. 건드리지 않았는데 접힌 상태로 시작한다
//
// 쓰는 법
//  1. 치지직 홈에서 문제가 보이는 상태로 둔다.
//  2. F12 → Console.
//  3. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  4. 출력 전체를 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 화면을 바꾸거나 설정을 건드리지 않는다.
(() => {
  "use strict";

  const out = [];
  const log = (label, value) => out.push(`${label}: ${value}`);
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : "-");
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: num(r.left), r: num(r.right), t: num(r.top), w: num(r.width) };
  };
  const show = (r) => (r ? `left=${r.l} right=${r.r} width=${r.w}` : "(없음)");
  // 가로로 겹치는가(세로는 헤더가 한 줄이라 가로만 본다).
  const overlapX = (a, b) => (a && b ? !(a.r <= b.l || a.l >= b.r) : false);

  // ── 화면 ────────────────────────────────────────────────────────────────
  log("주소", location.pathname);
  log(
    "뷰포트",
    `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
  );
  log(
    "화면",
    `${screen.width}x${screen.height} avail=${screen.availWidth}x${screen.availHeight}`,
  );

  // ── 사이드바 ────────────────────────────────────────────────────────────
  const sidebar = document.getElementById("sidebar");
  log("사이드바 있음", String(!!sidebar));
  if (sidebar) {
    const cs = getComputedStyle(sidebar);
    log("사이드바 클래스", sidebar.className.slice(0, 160));
    log(
      "펼침 판정(_is_expanded_)",
      String(/(^|\s|_)is_expanded(_|\s|$)/.test(sidebar.className)),
    );
    log("사이드바 rect", show(rect(sidebar)));
    log(
      "사이드바 style",
      `position=${cs.position} width=${cs.width} transform=${cs.transform} z=${cs.zIndex}`,
    );
  }

  // ── 헤더 겹침(Issue A) ──────────────────────────────────────────────────
  const header = document.getElementById("header");
  const sbRect = rect(sidebar);
  log("헤더 rect", show(rect(header)));
  const targets = [];
  for (const a of document.querySelectorAll("#header a, #header nav a")) {
    const t = (a.textContent || "").trim();
    if (/e스포츠|엔터|게임|카테고리/.test(t)) targets.push([t, a]);
  }
  const searchForm = document.querySelector("#header form[role='search']");
  if (searchForm)
    targets.push(["검색", searchForm.parentElement || searchForm]);
  for (const [name, el] of targets) {
    const r = rect(el);
    log(`헤더 '${name}'`, `${show(r)} 사이드바와겹침=${overlapX(sbRect, r)}`);
  }
  // 우리가 넣은 헤더 관련 규칙이 지금 걸려 있는지.
  log(
    "라운지 클래스",
    String(document.documentElement.classList.contains("cheese-lounge-on")),
  );
  if (searchForm) {
    const wrap = searchForm.parentElement;
    if (wrap) log("검색 래퍼 computed left", getComputedStyle(wrap).left);
  }
  const pushStyle = document.getElementById("cheese-sidebar-push-style");
  log(
    "밀어내기 스타일",
    pushStyle ? pushStyle.textContent.slice(0, 120) || "(빈 값)" : "(없음)",
  );
  const body = document.getElementById("layout-body");
  if (body) {
    const cs = getComputedStyle(body);
    log(
      "layout-body",
      `${show(rect(body))} padding-left=${cs.paddingLeft} padding-right=${cs.paddingRight}`,
    );
  }

  // ── 스크롤(Issue B) ─────────────────────────────────────────────────────
  const se = document.scrollingElement;
  log(
    "스크롤 주인",
    se
      ? `${se.tagName}#${se.id || ""} scrollTop=${num(se.scrollTop)} scrollH=${num(se.scrollHeight)} clientH=${num(se.clientHeight)}`
      : "(없음)",
  );
  log("스크롤 여지", se ? String(se.scrollHeight > se.clientHeight + 1) : "-");
  for (const [name, el] of [
    ["html", document.documentElement],
    ["body", document.body],
    ["layout-body", body],
  ]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    log(
      `${name} style`,
      `overflow=${cs.overflow}/${cs.overflowY} position=${cs.position} ` +
        `height=${cs.height} touch-action=${cs.touchAction} ` +
        `overscroll=${cs.overscrollBehavior}`,
    );
    const inline = el.getAttribute("style");
    if (inline) log(`${name} inline`, inline.slice(0, 160));
  }

  console.log(
    "%c[치즈 플래터] 사이드바 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(out.join("\n"));

  // 휠이 실제로 먹는지: 막는 리스너가 있으면 여기서 드러난다.
  console.log("이제 페이지에서 휠을 한 번 굴려 주세요(3초 지켜봅니다)…");
  let wheelSeen = 0;
  let defaultPrevented = 0;
  let topBefore = se ? se.scrollTop : 0;
  const onWheel = (e) => {
    wheelSeen += 1;
    // 다른 리스너가 막았는지는 다음 프레임에 확인한다.
    requestAnimationFrame(() => {
      if (e.defaultPrevented) defaultPrevented += 1;
    });
  };
  window.addEventListener("wheel", onWheel, { passive: true });
  setTimeout(() => {
    window.removeEventListener("wheel", onWheel);
    const topAfter = se ? se.scrollTop : 0;
    console.log(
      [
        `휠 이벤트 ${wheelSeen}건`,
        `그중 누군가 막은 것 ${defaultPrevented}건`,
        `scrollTop ${num(topBefore)} → ${num(topAfter)}`,
        wheelSeen === 0
          ? "→ 휠 이벤트 자체가 안 왔습니다(입력이 다른 곳으로 갔을 수 있음)"
          : topBefore === topAfter
            ? "→ 휠은 오는데 스크롤이 안 움직였습니다(잠김)"
            : "→ 스크롤은 정상입니다",
      ].join("\n"),
    );
  }, 3000);
})();
