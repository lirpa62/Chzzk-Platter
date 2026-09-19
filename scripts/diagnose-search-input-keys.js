// 검색 입력칸에 포커스는 있는데 글자가 들어가지 않는 문제.
//
// 앞선 진단으로 확정된 것(focus-trace):
//   입력칸이_포커스를_가졌나: true      ← 포커스는 정상
//   keydown  key:'f'  onInput:true      ← 키도 입력칸까지 도달
//   입력값: ""                          ← 그런데 글자가 안 들어간다
//   받은_눌림_이벤트: pointerdown → mousedown  ← mouseup/click 이 안 왔다
//
// 즉 문제는 포커스가 아니라 '키 입력이 막히는 것' 이다. 누군가 keydown 에
// preventDefault() 를 하거나, beforeinput/input 단계에서 막고 있다.
//
// 이 스니펫은 그 지점을 특정한다.
//  - keydown 이 어느 단계에서 defaultPrevented 가 되는지(캡처/대상/버블)
//  - beforeinput·input 이 오기는 하는지
//  - preventDefault 를 부른 쪽의 호출 스택
//  - mouseup/click 이 왜 안 오는지(같은 방식으로 확인)
//
// 쓰는 법
//  1. 구간 요약 → 돋보기까지 눌러 검색 입력칸이 보이게 둔다.
//  2. F12 → Console 에 이 파일을 통째로 붙여 넣고 실행한다.
//  3. 입력칸을 한 번 클릭한 뒤 'f' 를 몇 번 쳐 본다.
//  4. 3초 뒤 [key-summary] 와 [key-trace] 를 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 가로챈 것은 끝나면 되돌린다.
(() => {
  "use strict";

  const input = document.querySelector(".cheese-vod-search-input");
  if (!input) {
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
  const caller = () => {
    const lines = (new Error().stack || "").split("\n").slice(3, 7);
    return lines
      .map((l) => l.trim().replace(/^at\s+/, ""))
      .filter(Boolean)
      .join(" ← ")
      .slice(0, 240);
  };

  // ── preventDefault 를 누가 부르는지 ────────────────────────────────────
  const origPD = Event.prototype.preventDefault;
  const origSP = Event.prototype.stopPropagation;
  const origSIP = Event.prototype.stopImmediatePropagation;
  const WATCH = new Set([
    "keydown",
    "keypress",
    "beforeinput",
    "input",
    "mouseup",
    "click",
    "pointerup",
  ]);
  Event.prototype.preventDefault = function (...a) {
    if (WATCH.has(this.type) && (this.target === input || !this.target)) {
      log({
        label: `preventDefault(${this.type})`,
        phase: this.eventPhase,
        by: caller(),
      });
    }
    return origPD.apply(this, a);
  };
  Event.prototype.stopImmediatePropagation = function (...a) {
    if (WATCH.has(this.type) && this.target === input) {
      log({
        label: `stopImmediatePropagation(${this.type})`,
        phase: this.eventPhase,
        by: caller(),
      });
    }
    return origSIP.apply(this, a);
  };
  Event.prototype.stopPropagation = function (...a) {
    if (WATCH.has(this.type) && this.target === input) {
      log({
        label: `stopPropagation(${this.type})`,
        phase: this.eventPhase,
        by: caller(),
      });
    }
    return origSP.apply(this, a);
  };

  // ── 단계별로 상태를 찍는다 ─────────────────────────────────────────────
  const marks = [];
  const watch = (type) => {
    // 캡처(가장 먼저)와 버블(가장 나중) 양쪽에서 본다.
    document.addEventListener(
      type,
      (e) => {
        if (e.target !== input) return;
        marks.push(type);
        log({
          label: `${type} 캡처`,
          key: e.key || e.data || "",
          defaultPrevented: e.defaultPrevented,
          value: input.value,
        });
      },
      true,
    );
    document.addEventListener(type, (e) => {
      if (e.target !== input) return;
      log({
        label: `${type} 버블`,
        key: e.key || e.data || "",
        // ⚠ 여기서 true 면, 캡처~버블 사이의 누군가가 막은 것이다.
        defaultPrevented: e.defaultPrevented,
        value: input.value,
      });
    });
  };
  for (const type of [
    "keydown",
    "beforeinput",
    "input",
    "pointerup",
    "mouseup",
    "click",
  ]) {
    watch(type);
  }

  // 입력칸 자체에 직접 건 리스너도 본다(문서 리스너가 잘려도 이건 온다).
  const onDirect = (e) =>
    log({
      label: `${e.type}(입력칸 직접)`,
      key: e.key || e.data || "",
      defaultPrevented: e.defaultPrevented,
      value: input.value,
    });
  for (const type of ["keydown", "beforeinput", "input"]) {
    input.addEventListener(type, onDirect);
  }

  console.log(
    "%c[치즈 플래터] 검색 입력칸 키 입력 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(
    "입력칸을 한 번 클릭한 뒤 'f' 를 몇 번 쳐 주세요. 3초 뒤 결과가 나옵니다…",
  );

  setTimeout(() => {
    Event.prototype.preventDefault = origPD;
    Event.prototype.stopPropagation = origSP;
    Event.prototype.stopImmediatePropagation = origSIP;
    for (const type of ["keydown", "beforeinput", "input"]) {
      input.removeEventListener(type, onDirect);
    }

    const blocked = trace.find((r) => /^preventDefault\(key/.test(r.label));
    const anyInput = trace.some((r) => r.label.startsWith("input"));
    const anyBefore = trace.some((r) => r.label.startsWith("beforeinput"));
    console.log("%c[key-summary]", "font-weight:bold;color:#00c07f", {
      입력값: input.value,
      포커스: document.activeElement === input,
      받은_이벤트: [...new Set(marks)].join(" → ") || "(없음)",
      beforeinput_왔나: anyBefore,
      input_왔나: anyInput,
      // ⚠ 이 둘이 핵심이다.
      키를_막은_곳: blocked
        ? `${blocked.label} (phase=${blocked.phase})`
        : "(없음)",
      막은_쪽: blocked?.by || "(없음)",
    });
    console.log("[key-trace]");
    console.table(trace);
    console.log("위 두 출력을 그대로 보내 주세요.");
  }, 3000);
})();
