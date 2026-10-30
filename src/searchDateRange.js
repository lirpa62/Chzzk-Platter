// 치지직 검색과 같은 '기간 직접 선택' 달력(다시보기·클립 검색 공용: 재생목록 페이지, 멀티뷰 고르기·시청 화면).
//
// 치지직 검색 화면의 달력과 같은 구성: 머리(연도 버튼·이전/다음 달·닫기), 날짜 표(일요일 빨강, 오늘, 앞뒤 달과
// 오늘 뒤는 누를 수 없음), 연도 보기(2023년 12월 서비스 시작부터 이번 달까지), 시작일·종료일, 초기화·적용.
// 첫 클릭은 시작일, 두 번째는 종료일(앞 날짜를 누르면 둘을 바꾼다), 세 번째부터는 다시 시작일.
// 날짜는 KST "YYYY-MM-DD" 로 다룬다(검색 API 가 KST 시각을 받는다).
(() => {
  "use strict";
  if (globalThis.CheeseSearchDateRange) return;

  const MIN_DAY = "2023-12-01";
  const DAY_MS = 86400000;
  const STYLE_ID = "cheese-date-range-style";
  let openPanel = null;

  const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const parts = (key) => key.split("-").map(Number);
  const keyOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  // 표시: "26년 9월 1일"
  function longLabel(key) {
    if (!isDay(key)) return "";
    const [y, m, d] = parts(key);
    return `${String(y).slice(2)}년 ${m}월 ${d}일`;
  }
  // 짧은 표시: "26.09.01~26.10.29"
  function shortRange(start, end) {
    const short = (key) => key.slice(2).replace(/-/g, ".");
    return isDay(start) && isDay(end) ? (start === end ? short(start) : `${short(start)}~${short(end)}`) : "";
  }

  // 기간 → API 의 startDate·endDate(KST "YYYY-MM-DD HH:mm:ss"). 고른 날짜는 그날 0시~끝(오늘이면 지금까지).
  function kstDateTime(ms) {
    return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }
  const PRESET_DAYS = Object.freeze({ DAY: 1, WEEK: 7, MONTH: 30, HALF_YEAR: 182 });
  function apiRange(period, start, end, now = Date.now()) {
    if (PRESET_DAYS[period]) return { startDate: kstDateTime(now - PRESET_DAYS[period] * DAY_MS), endDate: kstDateTime(now) };
    if (period === "CUSTOM" && isDay(start) && isDay(end)) {
      const today = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
      return { startDate: `${start} 00:00:00`, endDate: end >= today ? kstDateTime(now) : `${end} 23:59:59` };
    }
    return null;
  }

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    // ⚠ 멀티뷰 시청 화면은 치지직 페이지 위에 세워지고(multiviewHostBoot.js), 새로 붙는 style 을 치지직 것으로
    //   보고 media="not all" 로 끈다. 표시가 없으면 달력 스타일까지 꺼져 달력이 페이지 아래에 맨 글자로 붙었다.
    style.setAttribute("data-cheese-multiview-own", "1");
    style.textContent = `
.cheese-date-range{position:fixed;z-index:2147483000;box-sizing:border-box;width:300px;max-width:calc(100vw - 16px);
  background:var(--popup-surface,#22252a);color:var(--popup-text,#e9ecef);border:1px solid var(--popup-border,#34383d);
  border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.35);font:13px/1.3 inherit;font-family:inherit;overflow:hidden}
.cheese-date-range[hidden]{display:none}
.cheese-date-range button{font:inherit;color:inherit}
.cheese-dr-head{display:flex;align-items:center;gap:8px;padding:10px 10px 8px;border-bottom:1px solid var(--popup-border,#34383d)}
.cheese-dr-year{padding:4px 8px;border:1px solid var(--popup-border,#34383d);border-radius:7px;background:none;cursor:pointer;font-weight:800;font-size:12px}
.cheese-dr-year[aria-expanded="true"]{border-color:var(--popup-brand,#00c37a)}
.cheese-dr-month{flex:1;display:flex;align-items:center;justify-content:center;gap:10px}
.cheese-dr-month strong{min-width:42px;text-align:center;font-size:16px}
.cheese-dr-nav,.cheese-dr-close{display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:none;cursor:pointer}
.cheese-dr-nav:disabled{opacity:.3;cursor:default}
.cheese-dr-nav:not(:disabled):hover,.cheese-dr-close:hover{background:var(--popup-soft-bg,rgba(255,255,255,.08))}
.cheese-dr-body{height:252px;overflow-y:auto;padding:8px 10px}
.cheese-dr-week,.cheese-dr-grid{display:grid;grid-template-columns:repeat(7,1fr)}
.cheese-dr-week span{padding:4px 0 6px;text-align:center;font-size:12px;color:var(--popup-muted,#a1a5ab)}
.cheese-dr-week span:first-child,.cheese-dr-cell.is-sun{color:#e5484d}
.cheese-dr-cell{position:relative;height:34px;padding:0;border:0;background:none;cursor:pointer;font-weight:700}
.cheese-dr-cell:disabled{opacity:.35;cursor:default;font-weight:500}
.cheese-dr-cell.in-range{background:rgba(0,195,122,.12)}
.cheese-dr-cell.is-start,.cheese-dr-cell.is-end{background:rgba(0,195,122,.12)}
.cheese-dr-cell.is-start span,.cheese-dr-cell.is-end span{display:inline-grid;place-items:center;min-width:28px;height:28px;border-radius:8px;
  background:var(--popup-brand,#00c37a);color:#fff}
.cheese-dr-cell.is-start{border-radius:8px 0 0 8px}.cheese-dr-cell.is-end{border-radius:0 8px 8px 0}
.cheese-dr-cell.is-start.is-end{border-radius:8px}
.cheese-dr-cell.is-today:not(.is-start):not(.is-end) span{display:inline-grid;place-items:center;min-width:30px;height:28px;border-radius:8px;
  border:1px solid rgba(0,195,122,.45);color:var(--popup-brand,#00c37a);font-size:11px}
.cheese-dr-cell>span[aria-hidden]{position:relative;z-index:1}
.cheese-dr-cell:not(:disabled):not(.is-start):not(.is-end):hover::before{content:"";position:absolute;inset:2px 3px;border-radius:8px;
  background:rgba(128,128,128,.16)}
.cheese-dr-years h3{margin:6px 0 8px;font-size:15px}
.cheese-dr-months{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px}
.cheese-dr-months button{height:30px;border:1px solid var(--popup-border,#34383d);border-radius:8px;background:none;cursor:pointer;font-weight:700;font-size:12px}
.cheese-dr-months button:disabled{opacity:.35;cursor:default;font-weight:500}
.cheese-dr-months button.is-current{border-color:var(--popup-brand,#00c37a);color:var(--popup-brand,#00c37a)}
.cheese-dr-period{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px 4px;border-top:1px solid var(--popup-border,#34383d)}
.cheese-dr-period span{display:block;color:var(--popup-muted,#a1a5ab);font-size:11px}
.cheese-dr-period strong{display:block;margin-top:3px;font-size:13px}
.cheese-dr-period strong.is-empty{color:var(--popup-muted,#a1a5ab);font-weight:500}
.cheese-dr-foot{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 12px 12px}
.cheese-dr-foot button{height:34px;border:0;border-radius:8px;cursor:pointer;font-weight:800}
.cheese-dr-reset{background:var(--popup-soft-bg,rgba(255,255,255,.08))}
.cheese-dr-apply{background:var(--popup-brand,#00c37a);color:#fff!important}
.cheese-dr-foot button:disabled{opacity:.45;cursor:default}
`;
    (doc.head || doc.documentElement).append(style);
  }

  const ARROW = (prev) =>
    `<svg width="8" height="14" viewBox="0 0 10 20" aria-hidden="true" style="${prev ? "transform:scaleX(-1)" : ""}"><path fill="currentColor" fill-rule="evenodd" d="M1.98 3.23a1.08 1.08 0 0 0 0 1.53L7.22 10l-5.24 5.23a1.08 1.08 0 1 0 1.54 1.54l6-6a1.08 1.08 0 0 0 0-1.54l-6-6a1.08 1.08 0 0 0-1.54 0Z" clip-rule="evenodd"/></svg>`;
  const CLOSE = `<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M16.6 4.933A1.083 1.083 0 1 0 15.066 3.4L10 8.468 4.933 3.4A1.083 1.083 0 0 0 3.4 4.933L8.468 10 3.4 15.067A1.083 1.083 0 1 0 4.933 16.6L10 11.532l5.067 5.067a1.083 1.083 0 1 0 1.532-1.532L11.532 10l5.067-5.067Z"/></svg>`;

  function close() {
    if (!openPanel) return;
    openPanel.cleanup();
    openPanel.el.remove();
    openPanel = null;
  }

  // anchor 아래(자리가 없으면 위)에 띄운다. onApply(start, end) — 둘 다 "YYYY-MM-DD".
  // within: 달력을 이 요소 안에서만 보인다(멀티뷰 시청 화면의 채널 관리 패널). 없으면 화면 전체.
  function open(anchor, { start = "", end = "", within = null, onApply = () => {}, onClose = () => {} } = {}) {
    close();
    const doc = anchor?.ownerDocument || document;
    ensureStyle(doc);
    const max = kstToday();
    const state = {
      start: isDay(start) && start >= MIN_DAY && start <= max ? start : "",
      end: isDay(end) && end >= MIN_DAY && end <= max ? end : "",
      view: "month",
    };
    if (state.start && state.end && state.end < state.start) [state.start, state.end] = [state.end, state.start];
    const focus = parts(state.end || state.start || max);
    state.y = focus[0];
    state.m = focus[1];
    const el = doc.createElement("div");
    el.className = "cheese-date-range";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "기간 직접 선택");
    doc.body.append(el);

    const monthKey = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
    const minMonth = MIN_DAY.slice(0, 7);
    const maxMonth = max.slice(0, 7);

    function render() {
      const [maxY] = parts(max);
      const canPrev = monthKey(state.y, state.m) > minMonth;
      const canNext = monthKey(state.y, state.m) < maxMonth;
      let body = "";
      if (state.view === "years") {
        for (let y = 2023; y <= maxY; y += 1) {
          body += `<section class="cheese-dr-years" data-dr-year-block="${y}"><h3>${y}년</h3><div class="cheese-dr-months">`;
          for (let m = 1; m <= 12; m += 1) {
            const key = monthKey(y, m);
            const disabled = key < minMonth || key > maxMonth;
            const current = y === state.y && m === state.m;
            body += `<button type="button" data-dr-month="${key}"${disabled ? " disabled" : ""}${current ? ' class="is-current" aria-current="true"' : ""}>${m}월</button>`;
          }
          body += `</div></section>`;
        }
      } else {
        const first = new Date(Date.UTC(state.y, state.m - 1, 1));
        const startAt = first.getTime() - first.getUTCDay() * DAY_MS;
        body = `<div class="cheese-dr-week" aria-hidden="true">${"일월화수목금토".split("").map((w) => `<span>${w}</span>`).join("")}</div><div class="cheese-dr-grid" role="grid">`;
        for (let i = 0; i < 42; i += 1) {
          const at = new Date(startAt + i * DAY_MS);
          const key = at.toISOString().slice(0, 10);
          const inMonth = at.getUTCMonth() === state.m - 1;
          if (!inMonth && i >= 35) break; // 다음 달만 남은 마지막 줄은 그리지 않는다
          const disabled = !inMonth || key > max || key < MIN_DAY;
          const cls = ["cheese-dr-cell"];
          if (at.getUTCDay() === 0) cls.push("is-sun");
          if (key === max) cls.push("is-today");
          if (key === state.start) cls.push("is-start");
          if (key === (state.end || (state.start && !state.end ? state.start : ""))) cls.push("is-end");
          if (state.start && state.end && key > state.start && key < state.end) cls.push("in-range");
          const [, m, d] = parts(key);
          body += `<button type="button" class="${cls.join(" ")}" data-dr-day="${key}"${disabled ? " disabled" : ""} aria-pressed="${String(key === state.start || key === state.end)}">` +
            `<span aria-hidden="true">${key === max ? "오늘" : d}</span><span class="blind" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${parts(key)[0]}년 ${m}월 ${d}일</span></button>`;
        }
        body += `</div>`;
      }
      el.innerHTML =
        `<div class="cheese-dr-head"><button type="button" class="cheese-dr-year" data-dr-years aria-expanded="${String(state.view === "years")}">${state.y}년</button>` +
        `<div class="cheese-dr-month"><button type="button" class="cheese-dr-nav" data-dr-prev${canPrev ? "" : " disabled"} aria-label="이전 달">${ARROW(true)}</button>` +
        `<strong>${state.m}월</strong><button type="button" class="cheese-dr-nav" data-dr-next${canNext ? "" : " disabled"} aria-label="다음 달">${ARROW(false)}</button></div>` +
        `<button type="button" class="cheese-dr-close" data-dr-close aria-label="달력 닫기">${CLOSE}</button></div>` +
        `<div class="cheese-dr-body">${body}</div>` +
        `<div class="cheese-dr-period"><div><span>시작일</span><strong class="${state.start ? "" : "is-empty"}" data-dr-start-label>${state.start ? longLabel(state.start) : "선택해 주세요"}</strong></div>` +
        `<div><span>종료일</span><strong class="${state.end ? "" : "is-empty"}" data-dr-end-label>${state.end ? longLabel(state.end) : "선택해 주세요"}</strong></div></div>` +
        `<div class="cheese-dr-foot"><button type="button" class="cheese-dr-reset" data-dr-reset${state.start ? "" : " disabled"}>초기화</button>` +
        `<button type="button" class="cheese-dr-apply" data-dr-apply${state.start ? "" : " disabled"}>적용</button></div>`;
      if (state.view === "years") {
        el.querySelector(`[data-dr-year-block="${state.y}"]`)?.scrollIntoView({ block: "start" });
      }
    }

    // 아래 → 위 → (둘 다 모자라면) 경계 맨 위에 붙이고 넘치는 만큼 달력 안에서 스크롤.
    // ⚠ 채널 관리 패널(높이 400px 안팎)에서 열면 아래로 패널 밖까지 내려와 시청 화면을 덮었다.
    function position() {
      const r = anchor.getBoundingClientRect();
      const win = doc.defaultView;
      const box = within?.isConnected
        ? within.getBoundingClientRect()
        : { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
      const minLeft = box.left + 8;
      const maxRight = box.right - 8;
      const minTop = box.top + 8;
      const maxBottom = box.bottom - 8;
      el.style.maxHeight = "";
      el.style.overflowY = "";
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(minLeft, Math.min(r.right - w, maxRight - w));
      let top;
      if (r.bottom + 6 + h <= maxBottom) top = r.bottom + 6;
      else if (r.top - 6 - h >= minTop) top = r.top - 6 - h;
      else {
        top = minTop;
        if (h > maxBottom - minTop) {
          el.style.maxHeight = `${Math.max(160, Math.floor(maxBottom - minTop))}px`;
          el.style.overflowY = "auto";
        }
      }
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
    }

    el.addEventListener("click", (event) => {
      event.stopPropagation();
      const t = event.target;
      if (t.closest("[data-dr-close]")) return finish(false);
      if (t.closest("[data-dr-years]")) {
        state.view = state.view === "years" ? "month" : "years";
        return render();
      }
      const step = t.closest("[data-dr-prev]") ? -1 : t.closest("[data-dr-next]") ? 1 : 0;
      if (step) {
        const at = new Date(Date.UTC(state.y, state.m - 1 + step, 1));
        state.y = at.getUTCFullYear();
        state.m = at.getUTCMonth() + 1;
        state.view = "month";
        return render();
      }
      const month = t.closest("[data-dr-month]");
      if (month && !month.disabled) {
        [state.y, state.m] = parts(`${month.dataset.drMonth}-01`);
        state.view = "month";
        return render();
      }
      const day = t.closest("[data-dr-day]");
      if (day && !day.disabled) {
        const key = day.dataset.drDay;
        if (!state.start || state.end) {
          state.start = key;
          state.end = "";
        } else if (key < state.start) {
          state.end = state.start;
          state.start = key;
        } else {
          state.end = key;
        }
        return render();
      }
      if (t.closest("[data-dr-reset]")) {
        state.start = "";
        state.end = "";
        return render();
      }
      if (t.closest("[data-dr-apply]") && state.start) {
        onApply(state.start, state.end || state.start);
        return finish(true);
      }
    });
    // 눌러도 바깥 입력칸의 포커스를 빼앗지 않는다(재생목록 검색칸 등).
    el.addEventListener("mousedown", (event) => event.preventDefault());

    const onOutside = (event) => {
      if (!el.contains(event.target) && !anchor.contains(event.target)) finish(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      }
    };
    const onScroll = (event) => {
      if (!el.contains(event.target)) position();
    };
    doc.addEventListener("pointerdown", onOutside, true);
    doc.addEventListener("keydown", onKey, true);
    doc.defaultView.addEventListener("resize", position);
    doc.addEventListener("scroll", onScroll, true);
    function finish(applied) {
      close();
      onClose(applied);
    }
    openPanel = {
      el,
      cleanup() {
        doc.removeEventListener("pointerdown", onOutside, true);
        doc.removeEventListener("keydown", onKey, true);
        doc.defaultView.removeEventListener("resize", position);
        doc.removeEventListener("scroll", onScroll, true);
      },
    };
    render();
    position();
    return el;
  }

  globalThis.CheeseSearchDateRange = Object.freeze({
    open,
    close,
    apiRange,
    shortRange,
    longLabel,
    kstToday,
    isDay,
    MIN_DAY,
    PRESET_DAYS,
    get isOpen() { return Boolean(openPanel); },
  });
})();
