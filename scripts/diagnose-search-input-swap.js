// 검색 입력칸이 클릭 도중에 교체되는지 확인한다.
//
// 앞선 두 진단을 합치면 그림이 이렇다.
//
//  첫 진단(클릭만):    pointerdown → mousedown   (mouseup/click 없음), 포커스 true
//  이번 진단(클릭만):  pointerup → mouseup → click (pointerdown/mousedown 없음), 포커스 false
//  꾹 누른 채 입력:    keydown → beforeinput → input 정상, 글자도 들어감
//
// 두 진단이 서로 다른 '반쪽' 만 봤다는 뜻이다. 각 진단은 시작할 때 그 순간의
// 입력칸을 붙잡는데, 클릭 도중에 입력칸이 새것으로 바뀌면
//   - 앞부분(pointerdown/mousedown)은 옛 입력칸이 받고
//   - 뒷부분(mouseup/click)은 새 입력칸이 받는다
// 그래서 한쪽 진단에는 앞부분만, 다른 쪽에는 뒷부분만 찍힌다.
// 꾹 누르고 있으면 그 사이 교체가 끝나서 입력이 되는 것도 들어맞는다.
//
// 이 스니펫은 입력칸을 '고정해서' 보지 않고, 교체 자체를 관찰한다.
//  - 클릭 전후로 입력칸 노드가 같은 것인지
//  - 언제, 어느 조상이 다시 그려지는지
//  - 그때 포커스가 어디로 가는지
//
// 쓰는 법
//  1. 구간 요약 → 돋보기까지 눌러 검색 입력칸이 보이게 둔다.
//  2. F12 → Console 에 이 파일을 통째로 붙여 넣고 실행한다.
//  3. 입력칸을 '한 번' 클릭하고 글자를 쳐 본다.
//  4. 3초 뒤 [swap-summary] 와 [swap-trace] 를 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 화면을 바꾸지 않는다.
(() => {
  "use strict";

  const SEL = ".cheese-vod-search-input";
  const first = document.querySelector(SEL);
  if (!first) {
    console.log(
      "%c[치즈 플래터] 검색 입력칸이 없습니다. 구간 요약 → 돋보기까지 연 뒤 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(1);
  const trace = [];
  const log = (row) => trace.push({ t: at(), ...row });
  const desc = (el) => {
    if (!el) return "(없음)";
    const cls = (el.className || "").toString().trim().split(/\s+/)[0] || "";
    return `${el.tagName}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}`;
  };

  // 노드에 번호를 붙여 '같은 것인지' 를 눈으로 구분한다.
  let serial = 0;
  const idOf = (el) => {
    if (!el) return "-";
    if (!el.__cheeseSerial) el.__cheeseSerial = ++serial;
    return `#${el.__cheeseSerial}`;
  };
  idOf(first);

  let swaps = 0;
  const panel = first.closest(".cheese-chat-peak-popover");

  // ── 입력칸이 바뀌는 순간을 잡는다 ──────────────────────────────────────
  const mo = new MutationObserver((records) => {
    const now = document.querySelector(SEL);
    if (now && now !== first && !now.__cheeseSeen) {
      now.__cheeseSeen = true;
      swaps += 1;
      // 어느 노드가 교체됐는지 요약한다.
      const where = [];
      for (const rec of records) {
        if (rec.type !== "childList") continue;
        if (rec.addedNodes.length || rec.removedNodes.length) {
          where.push(desc(rec.target));
        }
      }
      log({
        label: "⚠ 입력칸이 새것으로 바뀜",
        old: idOf(first),
        new: idOf(now),
        연결됨_옛것: first.isConnected,
        바뀐_자리: [...new Set(where)].slice(0, 3).join(", ") || "(불명)",
        포커스: desc(document.activeElement),
      });
    }
  });
  mo.observe(panel || document.body, { childList: true, subtree: true });

  // ── 이벤트는 '현재' 입력칸 기준으로 본다(고정하지 않는다) ─────────────
  const types = [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "keydown",
    "input",
  ];
  const onAny = (e) => {
    const t = e.target;
    if (!(t instanceof Element) || !t.matches?.(SEL)) return;
    log({
      label: e.type,
      노드: idOf(t),
      같은_노드인가: t === first,
      포커스: desc(document.activeElement),
      값: t.value,
    });
  };
  for (const type of types) document.addEventListener(type, onAny, true);

  console.log(
    "%c[치즈 플래터] 검색 입력칸 교체 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(
    `시작 시점 입력칸: ${idOf(first)}\n` +
      "이제 입력칸을 '한 번' 클릭하고 글자를 쳐 주세요. 3초 뒤 결과가 나옵니다…",
  );

  setTimeout(() => {
    mo.disconnect();
    for (const type of types) document.removeEventListener(type, onAny, true);
    const now = document.querySelector(SEL);
    console.log("%c[swap-summary]", "font-weight:bold;color:#00c07f", {
      // ⚠ 이 값이 핵심이다. 1 이상이면 클릭 도중에 입력칸이 교체된 것이다.
      입력칸_교체_횟수: swaps,
      시작_노드: idOf(first),
      현재_노드: idOf(now),
      같은_노드인가: now === first,
      옛_노드가_아직_붙어있나: first.isConnected,
      현재_입력값: now ? now.value : "(없음)",
      포커스: desc(document.activeElement),
      포커스가_입력칸인가: now ? document.activeElement === now : false,
    });
    console.log("[swap-trace]");
    console.table(trace);
    console.log("위 두 출력을 그대로 보내 주세요.");
  }, 3000);
})();
