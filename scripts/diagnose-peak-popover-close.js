// 구간 요약 팝오버가 '검색' 클릭 때 사라지는 경로 진단 스니펫.
//
// 앞선 수정(composedPath 기반 바깥 판정)은 fixture 에서만 확인됐다. 실제
// 치지직에서는 여전히 닫히므로, 팝오버가 사라지는 '두 번째 경로' 를 찾는다.
//
// 이 스니펫이 갈라내려는 것(가장 중요한 구분):
//   A. 우리 close 함수가 불렸다            → 팝오버만 remove, 조상은 그대로
//   B. 조상(플레이어 컨트롤)이 통째로 교체됐다 → 우리 코드 밖에서 detach
//   C. 실제로는 붙어 있는데 숨겨졌다        → display/visibility/rect 문제
//
// ⚠ 콘솔은 MAIN world 라 확장(ISOLATED)의 내부 변수는 읽지 못한다. 그래서
//   DOM 수명주기만 관찰한다 — 위 A/B/C 를 가르는 데는 이것으로 충분하다.
//
// 쓰는 법
//  1. 다시보기에서 '채팅 활성도' 버튼을 우클릭해 구간 요약 팝오버를 연다.
//  2. F12 → Console. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  3. 안내가 뜨면 머리말의 돋보기(검색)를 한 번 누른다.
//  4. 3초 뒤 출력되는 [peak-summary] 전체를 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 화면을 바꾸거나 설정을 건드리지 않는다.
(() => {
  "use strict";

  const PANEL = ".cheese-chat-peak-popover";
  const BUTTON = ".cheese-chat-graph-button";
  const CONTROLS = ".pzp-pc__bottom-buttons-right";

  const panel = document.querySelector(PANEL);
  if (!panel) {
    console.log(
      "%c[치즈 플래터] 팝오버가 열려 있지 않습니다. '채팅 활성도' 버튼을 우클릭해 구간 요약을 먼저 연 뒤 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(1);
  const trace = [];
  const log = (label, data) => trace.push({ t: at(), label, ...data });

  const idOf = (el) => {
    if (!el) return "(없음)";
    const cls = (el.className || "").toString().trim().split(/\s+/)[0] || "";
    return `${el.tagName}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
  };

  // 조상 사슬을 기록해 둔다. 나중에 '어느 노드가 통째로 바뀌었는지' 를 본다.
  const chainOf = (el) => {
    const out = [];
    let cur = el;
    for (let i = 0; cur && i < 8; i += 1) {
      out.push({ node: cur, desc: idOf(cur) });
      cur = cur.parentElement;
    }
    return out;
  };

  const before = {
    panel,
    chain: chainOf(panel),
    controls: document.querySelector(CONTROLS),
    button: document.querySelector(BUTTON),
    video: document.querySelector("video"),
  };

  // 팝오버가 실제로 떨어졌는지 / 숨겨졌는지 구분해서 찍는다.
  // 조상 중에 팝오버를 '보이지 않게' 만드는 노드가 있는지 찾는다.
  // ⚠ 팝오버는 컨트롤 바 안에 position:absolute 로 붙어 있다. 치지직이 마우스
  //   비활성 시 컨트롤을 숨기면(.pzp-pc--controls 제거) 팝오버는 DOM 에 붙어
  //   있는 채로 화면에서만 사라진다 — '닫힘' 과 구분되지 않는다.
  const hidingAncestor = () => {
    let cur = panel.parentElement;
    for (let i = 0; cur && i < 8; i += 1) {
      const cs = getComputedStyle(cur);
      if (
        cs.display === "none" ||
        cs.visibility === "hidden" ||
        Number(cs.opacity) === 0
      ) {
        return `${idOf(cur)} (display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity})`;
      }
      cur = cur.parentElement;
    }
    return "(없음)";
  };

  const snap = (label) => {
    const cs = panel.isConnected ? getComputedStyle(panel) : null;
    const r = panel.isConnected ? panel.getBoundingClientRect() : null;
    const controlsNow = document.querySelector(CONTROLS);
    log(label, {
      panelConnected: panel.isConnected,
      display: cs ? cs.display : "-",
      visibility: cs ? cs.visibility : "-",
      opacity: cs ? cs.opacity : "-",
      rect: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "-",
      // 붙어 있는데 안 보이는 경우, 어느 조상이 숨겼는지.
      hiddenBy: panel.isConnected ? hidingAncestor() : "-",
      // 컨트롤 바가 '표시' 상태인지(치지직은 이 클래스로 컨트롤을 보였다 숨긴다).
      controlsShown: !!document
        .querySelector(".pzp-pc")
        ?.classList.contains("pzp-pc--controls"),
      // 조상 중 어디서 끊겼는지: 연결이 살아 있는 가장 가까운 조상
      firstDeadAncestor:
        before.chain.find((x) => !x.node.isConnected)?.desc || "(없음)",
      // 컨트롤 컨테이너가 '같은 노드' 인지(교체되면 다른 노드가 된다)
      controlsSameNode: controlsNow === before.controls,
      controlsConnected: !!before.controls?.isConnected,
      buttonSameNode: document.querySelector(BUTTON) === before.button,
      // 팝오버가 DOM 어디엔가 남아 있는지(새로 그려졌을 수도 있다)
      anyPanelInDom: !!document.querySelector(PANEL),
      anyPanelIsSame: document.querySelector(PANEL) === panel,
      activeElement: idOf(document.activeElement),
    });
  };

  snap("클릭 전");

  // 팝오버/컨트롤이 언제 떨어지는지 본다. caller 는 알 수 없지만, '우리 팝오버만
  // 빠졌는지' 와 '컨트롤 subtree 가 통째로 바뀌었는지' 는 여기서 갈린다.
  let detachedAt = null;
  const playerRoot =
    before.controls?.closest(".pzp-pc") ||
    before.controls?.parentElement ||
    document.body;
  const mo = new MutationObserver((records) => {
    if (detachedAt === null && !panel.isConnected) {
      detachedAt = at();
      // 이 변이에서 무엇이 제거됐는지 요약한다.
      const removers = [];
      for (const rec of records) {
        for (const n of rec.removedNodes) {
          if (!(n instanceof Element)) continue;
          const hitPanel = n === panel || n.contains?.(panel);
          const hitControls =
            n === before.controls || n.contains?.(before.controls);
          if (hitPanel || hitControls) {
            removers.push({
              removed: idOf(n),
              from: idOf(rec.target),
              tookPanel: hitPanel,
              tookControls: hitControls,
            });
          }
        }
      }
      log("팝오버 떨어짐", {
        detachedAt,
        // ⚠ 이 줄이 핵심이다.
        //   removed=팝오버 자신  → 우리 close 함수(또는 팝오버만 제거)
        //   removed=조상/컨트롤  → 치지직이 컨트롤을 다시 그리며 함께 날림
        removedBy: removers.length ? removers : "(팝오버만 조용히 빠짐)",
      });
    }
  });
  mo.observe(playerRoot, { childList: true, subtree: true });

  // 이벤트 순서. 캡처/버블 양쪽에서 경로를 본다.
  const onCapture = (e) => {
    const tgt = e.target;
    if (!(tgt instanceof Element)) return;
    if (!tgt.closest?.(`${PANEL},${BUTTON}`)) return;
    log("document 캡처 click", {
      target: idOf(tgt),
      targetConnected: tgt.isConnected,
      pathHasPanel: e.composedPath().includes(panel),
    });
  };
  const onBubble = (e) => {
    const tgt = e.target;
    if (!(tgt instanceof Element)) return;
    const path = e.composedPath();
    // 검색 버튼을 눌렀는지(이미 떨어졌을 수 있어 경로로 본다).
    const pressedSearch = path.some(
      (n) => n instanceof Element && n.matches?.("[data-peak-search]"),
    );
    if (!pressedSearch && !path.includes(panel)) return;
    log("document 버블 click", {
      pressedSearch,
      target: idOf(tgt),
      // 앞선 수정이 기대는 값들.
      targetConnected: tgt.isConnected,
      legacyClosest: !!tgt.closest?.(PANEL), // 예전 판정(false 면 예전엔 닫혔다)
      pathHasPanel: path.includes(panel), // 새 판정(true 여야 유지)
      panelConnected: panel.isConnected,
    });
    // 클릭 직후의 여러 시점을 찍는다.
    queueMicrotask(() => snap("microtask"));
    requestAnimationFrame(() => {
      snap("rAF #1");
      requestAnimationFrame(() => snap("rAF #2"));
    });
    setTimeout(() => snap("setTimeout 0"), 0);
    setTimeout(() => snap("setTimeout 50"), 50);
    setTimeout(() => snap("setTimeout 300"), 300);
  };
  document.addEventListener("click", onCapture, true);
  document.addEventListener("click", onBubble, false);

  console.log(
    "%c[치즈 플래터] 구간 요약 팝오버 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(
    `팝오버 mount 위치: ${idOf(panel.parentElement)}\n` +
      `조상 사슬: ${before.chain.map((x) => x.desc).join(" ← ")}\n\n` +
      "이제 머리말의 돋보기(검색)를 한 번 눌러 주세요. 3초 뒤 결과가 나옵니다…",
  );

  setTimeout(() => {
    document.removeEventListener("click", onCapture, true);
    document.removeEventListener("click", onBubble, false);
    mo.disconnect();

    const last = trace[trace.length - 1] || {};
    const summary = {
      // 1) 최신 코드가 도는가: 팝오버가 유지됐다면 새 판정이 동작한 것이다.
      팝오버_최종_연결: panel.isConnected,
      떨어진_시각ms: detachedAt,
      // 2) A/B/C 구분
      분류: !panel.isConnected
        ? "A/B — DOM 에서 떨어짐(아래 removedBy 로 A 와 B 를 가른다)"
        : last.display === "none" || last.visibility === "hidden"
          ? "C — 붙어 있는데 숨겨짐"
          : last.rect === "0x0"
            ? "C — 붙어 있는데 크기가 0"
            : "유지됨(닫히지 않음)",
      숨긴_조상: panel.isConnected ? hidingAncestor() : "-",
      컨트롤_표시중: !!document
        .querySelector(".pzp-pc")
        ?.classList.contains("pzp-pc--controls"),
      컨트롤_같은_노드: document.querySelector(CONTROLS) === before.controls,
      버튼_같은_노드: document.querySelector(BUTTON) === before.button,
      새_팝오버가_다시_생겼나: !!document.querySelector(PANEL),
      검색화면_전환됨: !!document.querySelector(".cheese-vod-search-input"),
    };
    console.log("%c[peak-summary]", "font-weight:bold;color:#00c07f", summary);
    console.log("[peak-trace]");
    console.table(trace);
    console.log(
      "위 [peak-summary] 와 [peak-trace] 표 전체를 복사해 보내 주세요.",
    );
  }, 3000);
})();
