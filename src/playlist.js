// 치즈 플래터 - 나만의 재생목록 편집 화면(playlist.html).
// 저장 구조는 playlistStore.js, 재생은 배경(PLAYLIST_PLAY)이 치지직 탭을 열어 한다.
(() => {
  "use strict";

  const S = globalThis.CheesePlaylistStore;
  const RM = globalThis.CheeseRecordManage;
  const THEME_KEY = "cheeseSearchTheme";
  const SELECTED_KEY = "cheesePlaylistSelected";
  const META_BATCH = 50;
  // 정보 받기는 묶음 사이를 띄운다. 불러온 파일이 아무리 커도 치지직에 한꺼번에 요청이 몰리지 않게.
  const META_BATCH_GAP_MS = 1200;
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const state = {
    data: S.normalize(null),
    listId: "",
    selected: new Set(),
    metaPending: new Set(),
    metaFailed: new Set(),
    renderQueued: false,
  };

  const ICON = {
    grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/></svg>',
    remove: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  };

  const currentList = () => S.findList(state.data, state.listId);

  // ── 시작 시간 입력칸 ── ↑↓·휠로 커서가 있는 자리(시·분·초)를 1씩(Shift 10씩) 올리고 내린다.
  // 1:23:45 · 83:45 · 5025(초) · 1h2m3s · 1시간 2분 · 치지직 주소(?currentTime=)를 모두 읽는다. Esc 는 되돌린다.
  const CLOCK_INPUT_TIP = "조절판 숫자를 누르면 그 자리를 바로 적기 · ▲▼(누르고 있으면 계속)·↑↓·휠: 시·분·초를 1씩, Shift 는 10씩 · 1:23:45, 83:45, 1h2m, 1시간 2분, 치지직 주소도 됩니다 · Esc 되돌리기";
  // "1:23:45" 에서 커서가 1 → 3600, 23 → 60, 45 → 1. 콜론이 없으면(초·빈칸) 1.
  function clockUnitAt(value, caret) {
    const parts = String(value).split(":");
    if (parts.length < 2 || parts.length > 3) return 1;
    let end = 0;
    for (let i = 0; i < parts.length; i += 1) {
      end += parts[i].length;
      if (caret <= end) return 60 ** (parts.length - 1 - i);
      end += 1;
    }
    return 1;
  }
  function clockMax(input) {
    const max = Number(input.dataset.clockMax);
    return input.dataset.clockMax && Number.isFinite(max) ? max : Infinity;
  }
  // 칸에 커서가 있는 동안은 늘 시·분·초 세 자리(0:05:30)로 보여 자리를 고르기 쉽게 한다. 벗어나면 5:30.
  function formatClockFull(total) {
    const s = Math.max(0, Math.floor(Number(total) || 0));
    const pad = (n) => String(n).padStart(2, "0");
    return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  // 세 자리 표기에서 단위(3600·60·1) 자리의 [시작, 끝]
  function clockSegmentRange(text, unit) {
    const parts = text.split(":");
    const index = parts.length - 1 - Math.round(Math.log(unit) / Math.log(60));
    let start = 0;
    for (let i = 0; i < index; i += 1) start += parts[i].length + 1;
    return [start, start + (parts[index] || "").length];
  }
  // 값을 넣고(길이 안으로) 같은 단위 자리 끝에 커서를 둔다(분을 올리다 1시간을 넘겨도 분 자리 그대로).
  // 조절판 숫자로 자리를 고른 중이면 그 자리를 다시 고른다.
  function setClockValue(input, value, unit) {
    const next = Math.min(clockMax(input), Math.max(0, value));
    const text = document.activeElement === input ? formatClockFull(next) : S.formatClock(next);
    input.value = text;
    if (document.activeElement === input) {
      const [start, end] = clockSegmentRange(text, clockEdit?.input === input ? clockEdit.unit : unit);
      if (clockEdit?.input === input) {
        clockEdit.buffer = "";
        input.setSelectionRange(start, end);
      } else {
        input.setSelectionRange(end, end);
      }
    }
    input.dataset.clockDirty = "1";
    input.setAttribute("aria-invalid", "false");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function stepClockInput(input, direction, big) {
    const current = S.parseClock(input.value);
    if (current == null) return false;
    const unit = clockUnitAt(input.value.trim(), input.selectionStart ?? input.value.length);
    setClockValue(input, current + direction * unit * (big ? 10 : 1), unit);
    return true;
  }

  // ── 조절판 ── 칸에 커서가 있으면 아래에 시·분·초 ▲▼ 를 띄운다(누르고 있으면 계속). 평소 줄은 그대로다.
  // 버튼은 포커스를 가져가지 않아(mousedown 기본 동작 막기) 칸에 커서가 남고, 칸을 벗어날 때 저장한다.
  const CLOCK_UNITS = [["시", 3600], ["분", 60], ["초", 1]];
  const CHEVRON = (up) =>
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"}"/></svg>`;
  let clockPanel = null;
  let clockPanelInput = null;
  let clockRepeatTimer = 0;
  function ensureClockPanel() {
    if (clockPanel) return clockPanel;
    clockPanel = document.createElement("div");
    clockPanel.className = "pl-clock-panel";
    clockPanel.id = "plClockPanel";
    clockPanel.setAttribute("role", "group");
    clockPanel.setAttribute("aria-label", "시작 시간 조절");
    clockPanel.hidden = true;
    clockPanel.innerHTML =
      `<div class="pl-clock-cols">` +
      CLOCK_UNITS.map(([label, unit], index) =>
        (index ? `<span class="pl-clock-sep" aria-hidden="true">:</span>` : "") +
        `<div class="pl-clock-col" data-clock-unit="${unit}">` +
        `<button type="button" tabindex="-1" data-clock-step="1" aria-label="${label} 올리기">${CHEVRON(true)}</button>` +
        `<output data-clock-part="${unit}" title="눌러서 ${label} 바로 적기">0</output><small>${label}</small>` +
        `<button type="button" tabindex="-1" data-clock-step="-1" aria-label="${label} 내리기">${CHEVRON(false)}</button>` +
        `</div>`).join("") +
      `</div>` +
      `<div class="pl-clock-foot"><button type="button" tabindex="-1" data-clock-zero>처음부터</button><span data-clock-length></span></div>`;
    document.body.append(clockPanel);
    // 눌러도 칸의 커서를 빼앗지 않는다.
    clockPanel.addEventListener("mousedown", (event) => event.preventDefault());
    clockPanel.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-clock-step]");
      if (!button || !clockPanelInput || event.button !== 0) return;
      const unit = Number(button.closest("[data-clock-unit]").dataset.clockUnit) * (event.shiftKey ? 10 : 1);
      const direction = Number(button.dataset.clockStep);
      const run = () => {
        if (!clockPanelInput) return stopClockRepeat();
        const current = S.parseClock(clockPanelInput.value) ?? 0;
        setClockValue(clockPanelInput, current + direction * unit, Math.min(unit, 3600));
      };
      stopClockRepeat();
      run();
      // 누르고 있으면 잠깐 뒤부터 빠르게 이어 간다.
      clockRepeatTimer = setTimeout(function repeat() {
        run();
        clockRepeatTimer = setTimeout(repeat, 70);
      }, 420);
      button.setPointerCapture?.(event.pointerId);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) clockPanel.addEventListener(type, stopClockRepeat);
    // 열 위에서 휠을 굴리면 그 단위로.
    clockPanel.addEventListener("wheel", (event) => {
      const col = event.target.closest("[data-clock-unit]");
      if (!col || !clockPanelInput || !event.deltaY) return;
      event.preventDefault();
      const unit = Number(col.dataset.clockUnit);
      const current = S.parseClock(clockPanelInput.value) ?? 0;
      setClockValue(clockPanelInput, current + (event.deltaY < 0 ? 1 : -1) * unit * (event.shiftKey ? 10 : 1), unit);
    }, { passive: false });
    clockPanel.addEventListener("click", (event) => {
      if (!clockPanelInput) return;
      if (event.target.closest("[data-clock-zero]")) setClockValue(clockPanelInput, 0, 1);
      // 숫자를 누르면 칸에서 그 자리를 골라 바로 숫자로 적게 한다(커서는 칸에 그대로).
      const part = event.target.closest("[data-clock-part]");
      if (part) selectClockSegment(clockPanelInput, Number(part.dataset.clockPart));
    });
    window.addEventListener("resize", () => clockPanelInput && positionClockPanel());
    document.addEventListener("scroll", () => clockPanelInput && positionClockPanel(), true);
    return clockPanel;
  }
  // ── 자리 골라 적기 ── 조절판 숫자를 누르면 그 자리(시·분·초)를 칸에서 고른다. 숫자를 치면 그 자리만 바뀌고
  // 두 자리를 채우면(분·초는 6~9 한 자리여도) 다음 자리로 넘어간다. ←→·Tab 으로 자리를 옮기고, 다른 키나
  // 칸을 직접 누르면 보통 입력으로 돌아간다.
  let clockEdit = null; // { input, unit, buffer }
  function markClockColumn(unit) {
    clockPanel?.querySelectorAll("[data-clock-unit]").forEach((col) => {
      col.classList.toggle("is-active", Number(col.dataset.clockUnit) === unit);
    });
  }
  function endClockEdit() {
    clockEdit = null;
    markClockColumn(0);
  }
  function selectClockSegment(input, unit) {
    const value = S.parseClock(input.value) ?? S.parseClock(input.dataset.clockOriginal) ?? 0;
    const text = formatClockFull(value);
    if (input.value !== text) {
      input.value = text;
      input.setAttribute("aria-invalid", "false");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const [start, end] = clockSegmentRange(text, unit);
    input.setSelectionRange(start, end);
    clockEdit = { input, unit, buffer: "" };
    markClockColumn(unit);
  }
  function setClockSegment(input, unit, part) {
    const total = S.parseClock(input.value) ?? 0;
    const parts = { 3600: Math.floor(total / 3600), 60: Math.floor((total % 3600) / 60), 1: total % 60 };
    parts[unit] = unit === 3600 ? part : Math.min(59, part);
    const next = Math.min(clockMax(input), parts[3600] * 3600 + parts[60] * 60 + parts[1]);
    input.value = formatClockFull(next);
    input.dataset.clockDirty = "1";
    input.setAttribute("aria-invalid", "false");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function typeClockDigit(digit) {
    const { input, unit } = clockEdit;
    const buffer = (clockEdit.buffer + digit).slice(-2);
    setClockSegment(input, unit, Number(buffer));
    const done = buffer.length >= 2 || (unit !== 3600 && Number(digit) > 5);
    selectClockSegment(input, done && unit > 1 ? unit / 60 : unit);
    if (!done) clockEdit.buffer = buffer; // 같은 자리에 이어 적는 중
  }
  // 자리 고르기 중 키: true 를 돌려주면 처리한 것.
  function clockEditKey(event, input) {
    if (clockEdit?.input !== input) return false;
    const { unit } = clockEdit;
    if (/^\d$/.test(event.key)) {
      typeClockDigit(event.key);
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setClockSegment(input, unit, 0);
      selectClockSegment(input, unit);
      return true;
    }
    const forward = event.key === "ArrowRight" || (event.key === "Tab" && !event.shiftKey);
    const backward = event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey);
    if (forward && unit > 1) {
      selectClockSegment(input, unit / 60);
      return true;
    }
    if (backward && unit < 3600) {
      selectClockSegment(input, unit * 60);
      return true;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") return false; // 아래에서 그 자리 단위로 올리고 내린다
    endClockEdit();
    return false;
  }

  function stopClockRepeat() {
    clearTimeout(clockRepeatTimer);
    clockRepeatTimer = 0;
  }
  function updateClockPanel() {
    if (!clockPanel || !clockPanelInput) return;
    const value = S.parseClock(clockPanelInput.value);
    const total = value ?? 0;
    const parts = { 3600: Math.floor(total / 3600), 60: Math.floor((total % 3600) / 60), 1: total % 60 };
    clockPanel.classList.toggle("is-invalid", value == null);
    for (const output of clockPanel.querySelectorAll("[data-clock-part]")) {
      const unit = Number(output.dataset.clockPart);
      output.textContent = value == null ? "--" : unit === 3600 ? String(parts[unit]) : String(parts[unit]).padStart(2, "0");
    }
    const max = clockMax(clockPanelInput);
    clockPanel.querySelector("[data-clock-length]").textContent = Number.isFinite(max) ? `영상 길이 ${S.formatClock(max + 1)}` : "";
    for (const button of clockPanel.querySelectorAll("[data-clock-step]")) {
      const up = button.dataset.clockStep === "1";
      button.disabled = value != null && (up ? total >= max : total <= 0);
    }
  }
  function positionClockPanel() {
    const rect = clockPanelInput.getBoundingClientRect();
    if (!rect.width) return hideClockPanel();
    const width = clockPanel.offsetWidth;
    const height = clockPanel.offsetHeight;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? rect.top - height - 6 : below;
    clockPanel.style.left = `${Math.round(left)}px`;
    clockPanel.style.top = `${Math.round(Math.max(8, top))}px`;
  }
  function showClockPanel(input) {
    ensureClockPanel();
    clockPanelInput = input;
    clockPanel.hidden = false;
    updateClockPanel();
    positionClockPanel();
  }
  function hideClockPanel() {
    stopClockRepeat();
    endClockEdit();
    clockPanelInput = null;
    if (clockPanel) clockPanel.hidden = true;
  }

  function bindClockInputs(root, selector) {
    root.addEventListener("focusin", (event) => {
      const input = event.target.closest?.(selector);
      if (!input) return;
      input.dataset.clockOriginal = input.value;
      // 적힌 값은 세 자리로(빈칸은 그대로 — 자리표시자 0:00:00)
      const value = input.value.trim() ? S.parseClock(input.value) : null;
      if (value != null) input.value = formatClockFull(value);
      showClockPanel(input);
    });
    root.addEventListener("input", (event) => {
      if (event.target === clockPanelInput) updateClockPanel();
    });
    // 칸을 직접 누르면 자리 고르기를 끝내고 보통 입력으로.
    root.addEventListener("mousedown", (event) => {
      if (event.target.closest?.(selector) && clockEdit) endClockEdit();
    });
    root.addEventListener("keydown", (event) => {
      const input = event.target.closest?.(selector);
      if (!input || event.altKey || event.ctrlKey || event.metaKey) return; // Alt+↑/↓ 는 순서 바꾸기
      if (clockEditKey(event, input)) {
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (stepClockInput(input, event.key === "ArrowUp" ? 1 : -1, event.shiftKey)) event.preventDefault();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        input.value = input.dataset.clockOriginal ?? input.value;
        delete input.dataset.clockDirty;
        input.setAttribute("aria-invalid", "false");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.blur();
      }
    });
    // 휠은 칸에 커서가 있을 때만(목록을 스크롤하다 지나가며 값이 바뀌지 않게).
    root.addEventListener("wheel", (event) => {
      const input = event.target.closest?.(selector);
      if (!input || document.activeElement !== input || !event.deltaY) return;
      if (stepClockInput(input, event.deltaY < 0 ? 1 : -1, event.shiftKey)) event.preventDefault();
    }, { passive: false });
    // ↑↓·휠로 바꾼 값은 브라우저 change 가 오지 않으므로 칸을 벗어날 때 직접 알린다.
    root.addEventListener("focusout", (event) => {
      const input = event.target.closest?.(selector);
      if (input && input === clockPanelInput) hideClockPanel();
      // 벗어나면 평소 표기(5:30)로
      const value = input?.value.trim() ? S.parseClock(input.value) : null;
      if (value != null && input.getAttribute("aria-invalid") !== "true") input.value = S.formatClock(value);
      if (!input?.dataset.clockDirty) return;
      delete input.dataset.clockDirty;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // ── 저장 ──
  async function mutate(change) {
    const result = await S.update(change);
    state.data = result.state;
    render();
    return result;
  }

  async function reload() {
    state.data = await S.load();
    if (!S.findList(state.data, state.listId)) {
      let saved = "";
      try {
        saved = localStorage.getItem(SELECTED_KEY) || "";
      } catch {}
      state.listId = (S.findList(state.data, saved) || state.data.lists[0])?.id || "";
    }
    render();
    void fillMissingMeta();
  }

  function selectList(listId) {
    if (state.listId !== listId) {
      state.selected.clear();
      $("plUrlStatus").textContent = "";
    }
    state.listId = listId;
    try {
      localStorage.setItem(SELECTED_KEY, listId);
    } catch {}
    render();
    void fillMissingMeta();
  }

  // ── 그리기 ──
  // 항목의 입력칸(시작 시간)을 고치는 중에는 다시 그리지 않는다(글자가 날아간다). 끝나면 그린다.
  function render() {
    const active = document.activeElement;
    if (active?.closest?.("#plItems") && active.matches("input[data-start]")) {
      state.renderQueued = true;
      return;
    }
    state.renderQueued = false;
    renderNav();
    renderDetail();
    renderResults(); // 고른 목록이 바뀌면 검색 결과의 '담김' 표시도 바뀐다
  }

  // 수정 시각을 '최근 업데이트됨'·'3일 전 업데이트'처럼(치지직 재생목록 카드와 같은 말투).
  function updatedText(time) {
    const days = Math.floor((Date.now() - Number(time || 0)) / 86400000);
    if (!time || days < 1) return "최근 업데이트됨";
    if (days < 30) return `${days}일 전 업데이트`;
    if (days < 365) return `${Math.floor(days / 30)}개월 전 업데이트`;
    return `${Math.floor(days / 365)}년 전 업데이트`;
  }

  const NAV_COUNT_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/><path d="m16 12 5 3-5 3v-6Z"/></svg>';

  // 치지직 채널 재생목록 카드처럼: 첫 항목 썸네일(뒤에 겹친 판), 오른쪽 아래 개수, 아래 이름·업데이트.
  function renderNav() {
    const nav = $("plListNav");
    nav.innerHTML = state.data.lists.map((list) => {
      // 표지는 썸네일이 있는 첫 항목. 19세면 연령 제한 표시를 덮는다(목록 줄·검색 결과 카드와 같다).
      const cover = list.items.find((item) => item.thumb);
      const total = S.totalDuration(list);
      const meta = [updatedText(list.updatedAt), total ? S.formatClock(total) : ""].filter(Boolean).join(" · ");
      return (
        `<li><button type="button" role="option" data-list-id="${esc(list.id)}" aria-selected="${list.id === state.listId}">` +
        `<span class="pl-nav-thumb">` +
        (cover ? `<img src="${esc(cover.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` +
          (cover.adult ? `<i class="pl-nav-adult" aria-hidden="true"></i>` : "") : `<span class="pl-nav-empty">${ICON.play}</span>`) +
        `<span class="pl-nav-count">${NAV_COUNT_ICON}${list.items.length.toLocaleString("ko-KR")}개</span></span>` +
        `<strong>${esc(list.name)}</strong><small>${esc(meta)}</small></button></li>`
      );
    }).join("");
    $("plNoLists").hidden = state.data.lists.length > 0;
  }

  function itemTitle(item) {
    if (item.title) return item.title;
    const key = S.itemKey(item);
    if (state.metaFailed.has(key)) return item.type === "video" ? `다시보기 ${item.videoNo} (정보 없음)` : "클립 (정보 없음)";
    return "정보를 불러오는 중…";
  }

  // 종류 배지(썸네일 왼쪽 위 — 멀티뷰 카드의 다시보기·업로드 배지와 같은 자리·색 계열).
  function kindBadgeHtml(clip) {
    return `<span class="pl-badge${clip ? " is-clip" : ""}">${clip ? "클립" : "다시보기"}</span>`;
  }
  function verifiedHtml(source) {
    const markKind = CheeseVerifiedMark.kind(source);
    return markKind
      ? `<span class="pl-card-verified" data-cheese-mark="${markKind}" role="img" aria-label="${CheeseVerifiedMark.label(markKind)} 채널"></span>`
      : "";
  }

  function itemHtml(item, index) {
    const url = S.itemUrl(item);
    const selected = state.selected.has(item.id);
    // 19세 영상도 썸네일은 그대로 두고 연령 제한 표시를 덮는다(검색 결과 카드와 같다).
    const thumb = item.thumb ? `<img src="${esc(item.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
    const duration = item.duration ? `<span class="pl-duration">${esc(S.formatClock(item.duration))}</span>` : "";
    const start = item.type === "video"
      ? `<label class="pl-start">시작 <input type="text" inputmode="numeric" data-start data-clock-max="${item.duration > 0 ? item.duration - 1 : ""}" value="${item.start ? esc(S.formatClock(item.start)) : ""}" placeholder="0:00:00" aria-label="${index + 1}번 시작 시간" title="${esc(CLOCK_INPUT_TIP)}"></label>`
      : "";
    return (
      `<li class="pl-item${selected ? " is-selected" : ""}" data-item-id="${esc(item.id)}">` +
      `<input type="checkbox" data-check aria-label="${index + 1}번 선택"${selected ? " checked" : ""}>` +
      `<button type="button" class="pl-handle" data-handle aria-label="${index + 1}번 순서 바꾸기 (Alt+↑/↓)" title="끌어서 순서 바꾸기">${ICON.grip}</button>` +
      `<span class="pl-index">${index + 1}</span>` +
      // ⚠ aria-hidden 을 두면 마우스로 누를 때 포커스가 숨긴 링크에 가서 경고가 난다. Tab 순서에서만 빼고 이름을 준다.
      `<a class="pl-thumb${item.adult ? " is-adult" : ""}" href="${esc(url)}" target="_blank" rel="noopener" tabindex="-1" aria-label="${esc(`${itemTitle(item)} 썸네일`)}">${thumb}${kindBadgeHtml(item.type === "clip")}${duration}</a>` +
      `<div class="pl-item-body">` +
      `<a class="pl-item-title" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(item.title)}">${esc(itemTitle(item))}</a>` +
      `<div class="pl-item-sub"><span class="pl-sr-only">${item.type === "clip" ? "클립" : "다시보기"}</span>` +
      (item.channelName ? `<span class="pl-item-channel"><span class="pl-item-channel-name">${esc(item.channelName)}</span>${verifiedHtml(item)}</span>` : "") +
      start +
      `</div></div>` +
      `<div class="pl-item-actions">` +
      `<button type="button" class="pl-icon-only" data-play aria-label="${index + 1}번부터 재생" title="여기부터 재생">${ICON.play}</button>` +
      `<button type="button" class="pl-icon-only is-danger" data-remove aria-label="${index + 1}번 삭제" title="삭제">${ICON.remove}</button>` +
      `</div></li>`
    );
  }

  function renderDetail() {
    const list = currentList();
    $("plDetail").hidden = !list;
    $("plAdd").hidden = !list;
    if (!list) return;
    const name = $("plName");
    if (document.activeElement !== name) name.value = list.name;
    const videos = list.items.filter((item) => item.type === "video").length;
    const clips = list.items.length - videos;
    const total = S.totalDuration(list);
    const updated = new Date(list.updatedAt);
    const pad = (n) => String(n).padStart(2, "0");
    $("plMeta").textContent = [
      `다시보기 ${videos} · 클립 ${clips}`,
      total ? `총 ${S.formatClock(total)}` : "",
      `수정 ${updated.getFullYear()}.${pad(updated.getMonth() + 1)}.${pad(updated.getDate())}`,
    ].filter(Boolean).join(" · ");
    $("plPlay").disabled = list.items.length === 0;
    $("plShuffle").disabled = list.items.length < 2;
    $("plExport").disabled = list.items.length === 0;
    for (const id of [...state.selected]) if (!list.items.some((item) => item.id === id)) state.selected.delete(id);
    $("plItems").innerHTML = list.items.map(itemHtml).join("");
    $("plNoItems").hidden = list.items.length > 0;
    syncSelectBar();
  }

  function syncSelectBar() {
    const count = state.selected.size;
    $("plSelectBar").hidden = count === 0;
    $("plSelectCount").textContent = `${count}개 선택`;
  }

  let toastTimer = 0;
  function toast(message, action) {
    const el = $("plToast");
    el.innerHTML = esc(message) + (action ? ` <button type="button" data-toast-action>${esc(action.label)}</button>` : "");
    el.hidden = false;
    el.querySelector("[data-toast-action]")?.addEventListener("click", () => {
      el.hidden = true;
      action.run();
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, action ? 6000 : 2600);
  }

  // ── 정보 채우기(제목·썸네일·채널·길이) ──
  // 지금 연 목록만 채운다(다른 목록은 열 때). 한 번에 하나만 돌고, 묶음 사이를 띄운다.
  let metaRunning = false;
  let metaAgain = false;
  async function fillMissingMeta() {
    if (metaRunning) {
      metaAgain = true; // 도는 중에 목록을 바꿨으면 끝난 뒤 새 목록을 마저 채운다
      return;
    }
    metaRunning = true;
    try {
      do {
        metaAgain = false;
        await fillMissingMetaOnce();
      } while (metaAgain);
      await fillListChannelMarks();
    } finally {
      metaRunning = false;
    }
  }

  async function fillMissingMetaOnce() {
    const wanted = new Map();
    const list = currentList();
    if (!list) return;
    {
      for (const item of list.items) {
        const key = S.itemKey(item);
        if ((item.title && item.date) || state.metaPending.has(key) || state.metaFailed.has(key) || wanted.has(key)) continue;
        wanted.set(key, item.type === "video" ? { type: "video", videoNo: item.videoNo } : { type: "clip", clipUID: item.clipUID });
      }
    }
    const entries = [...wanted.entries()];
    for (let i = 0; i < entries.length; i += META_BATCH) {
      if (i) await new Promise((resolve) => setTimeout(resolve, META_BATCH_GAP_MS));
      const batch = entries.slice(i, i + META_BATCH);
      batch.forEach(([key]) => state.metaPending.add(key));
      let reply = null;
      try {
        reply = await chrome.runtime.sendMessage({ type: "PLAYLIST_META", items: batch.map(([, item]) => item) });
      } catch {}
      const results = Array.isArray(reply?.results) ? reply.results : [];
      await mutate((current) => {
        let next = current;
        batch.forEach(([key], index) => {
          state.metaPending.delete(key);
          const meta = results[index];
          if (!meta?.title) {
            state.metaFailed.add(key);
            return;
          }
          next = S.applyMeta(next, key, meta).state;
        });
        return { state: next };
      });
    }
  }

  // ── 재생 ──
  async function play(index, { shuffle = false } = {}) {
    const list = currentList();
    if (!list?.items.length) return;
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: "PLAYLIST_PLAY", listId: list.id, index, shuffle });
    } catch {}
    if (!reply?.ok) toast(reply?.reason || "재생을 시작하지 못했습니다.");
  }

  // ── 내보내기 ──
  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const safeFileName = (name) => String(name || "재생목록").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60);

  async function copyText(textValue) {
    try {
      await navigator.clipboard.writeText(textValue);
      return true;
    } catch {
      return false;
    }
  }

  function openDialog(html, className = "") {
    const overlay = document.createElement("div");
    overlay.className = `crm-overlay pl-dialog ${className}`.trim();
    overlay.innerHTML = `<div class="crm-dialog" role="dialog" aria-modal="true">${html}</div>`;
    const previous = document.activeElement;
    const close = () => {
      overlay.remove();
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-dialog-close]")) close();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    document.body.append(overlay);
    return { overlay, close };
  }

  async function exportCode() {
    const list = currentList();
    if (!list?.items.length) return;
    const code = await S.encodeShareCode(list);
    const copied = await copyText(code);
    const { overlay } = openDialog(
      `<h2>공유 코드</h2>` +
      `<p class="crm-message">${copied ? "클립보드에 복사했습니다. " : ""}받는 사람은 재생목록 화면의 '불러오기'에 붙여 넣으면 됩니다. ` +
      `제목·썸네일은 불러올 때 다시 받아 옵니다.</p>` +
      `<textarea class="pl-textarea" rows="5" readonly aria-label="공유 코드">${esc(code)}</textarea>` +
      `<div class="crm-actions"><span class="crm-spacer"></span>` +
      `<button type="button" class="crm-button" data-dialog-close>닫기</button>` +
      `<button type="button" class="crm-button is-primary" data-copy>복사</button></div>`,
    );
    const area = overlay.querySelector("textarea");
    area.focus();
    area.select();
    overlay.querySelector("[data-copy]").addEventListener("click", async () => {
      area.select();
      toast((await copyText(code)) ? "복사했습니다." : "복사하지 못했습니다. 직접 선택해 복사해 주세요.");
    });
  }

  function exportFile(all) {
    const list = currentList();
    if (!all && !list) return;
    const data = S.exportFile(state.data, all ? null : [list.id]);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadJson(data, all ? `치즈플래터_재생목록_전체_${stamp}.json` : `치즈플래터_재생목록_${safeFileName(list.name)}.json`);
  }

  // ── 불러오기 ──
  async function importLists(lists) {
    const result = await mutate((current) => S.addImportedLists(current, lists));
    if (result.added.length) selectList(result.added[0].id);
    const items = result.added.reduce((sum, list) => sum + list.items.length, 0);
    toast(`${result.added.length}개 목록(${items}개 항목)을 불러왔습니다.${result.skipped ? ` ${result.skipped}개는 목록 한도로 건너뜀.` : ""}`);
    void fillMissingMeta();
    return result;
  }

  function openImport() {
    const { overlay, close } = openDialog(
      `<h2>재생목록 불러오기</h2>` +
      `<div class="pl-tabs" role="tablist" aria-label="불러올 형식">` +
      `<button type="button" role="tab" data-import-tab="code" aria-selected="true">공유 코드</button>` +
      `<button type="button" role="tab" data-import-tab="file" aria-selected="false">파일</button></div>` +
      `<div class="pl-tab-body" data-import-body="code">` +
      `<textarea class="pl-textarea" rows="5" placeholder="CPL1:..." aria-label="공유 코드"></textarea></div>` +
      `<div class="pl-tab-body" data-import-body="file" hidden>` +
      `<p class="crm-message">치즈 플래터에서 '파일로 저장'한 .json 파일을 고릅니다. 파일 안의 목록은 모두 새 목록으로 추가됩니다.</p>` +
      `<button type="button" class="crm-button" data-pick-file>파일 고르기</button></div>` +
      `<p class="pl-status is-error" data-import-error role="alert"></p>` +
      `<div class="crm-actions"><span class="crm-spacer"></span>` +
      `<button type="button" class="crm-button" data-dialog-close>취소</button>` +
      `<button type="button" class="crm-button is-primary" data-import-run>불러오기</button></div>`,
    );
    const error = overlay.querySelector("[data-import-error]");
    const area = overlay.querySelector("textarea");
    area.focus();
    overlay.addEventListener("click", async (event) => {
      const tab = event.target.closest("[data-import-tab]");
      if (tab) {
        const key = tab.dataset.importTab;
        overlay.querySelectorAll("[data-import-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === tab)));
        overlay.querySelectorAll("[data-import-body]").forEach((b) => {
          b.hidden = b.dataset.importBody !== key;
        });
        overlay.querySelector("[data-import-run]").hidden = key !== "code";
        return;
      }
      if (event.target.closest("[data-pick-file]")) {
        const input = $("plFileInput");
        input.value = "";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const lists = S.parseFile(await file.text());
            close();
            await importLists(lists);
          } catch (err) {
            error.textContent = err.message;
          }
        };
        input.click();
        return;
      }
      if (event.target.closest("[data-import-run]")) {
        try {
          const list = await S.decodeShareCode(area.value);
          close();
          await importLists([list]);
        } catch (err) {
          error.textContent = err.message;
        }
      }
    });
  }

  // ── 주소로 추가 ──
  async function addFromUrls() {
    const list = currentList();
    if (!list) return;
    const lines = $("plUrls").value.split(/\s+/).map((line) => line.trim()).filter(Boolean);
    const status = $("plUrlStatus");
    status.classList.remove("is-error");
    if (!lines.length) {
      status.textContent = "주소를 넣어 주세요.";
      status.classList.add("is-error");
      return;
    }
    const items = [];
    const bad = [];
    for (const line of lines) {
      const item = S.parseChzzkUrl(line);
      const meta = item ? urlMeta.get(S.itemKey(item)) : null;
      if (item) items.push(meta && typeof meta === "object" ? { ...meta, ...item } : item);
      else bad.push(line);
    }
    if (!items.length) {
      status.textContent = "치지직 다시보기·클립 주소가 아닙니다.";
      status.classList.add("is-error");
      return;
    }
    const result = await mutate((current) => S.addItems(current, list.id, items));
    $("plUrls").value = bad.join("\n");
    status.textContent = [
      `${result.added.length}개 추가`,
      bad.length ? `${bad.length}줄은 치지직 주소가 아니라 남겨 둠` : "",
      result.skipped ? `${result.skipped}개는 한도(${S.LIMITS.items}개)로 건너뜀` : "",
    ].filter(Boolean).join(" · ");
    if (bad.length) status.classList.add("is-error");
    renderUrlPreview();
    void fillMissingMeta();
  }

  // ── 주소 탭 미리보기 ──
  // 넣은 주소마다 썸네일·채널·제목·길이를 보이고, 다시보기는 시작 시간(시:분:초)을 고치면 그 줄 주소의
  // currentTime 을 바꿔 쓴다(주소 칸이 원본이다).
  const urlMeta = new Map(); // key → 정보 | null(못 찾음) | "loading"
  let urlPreviewTimer = 0;
  function urlRows() {
    return $("plUrls").value.split("\n").map((raw, line) => {
      const text = raw.trim();
      return { line, text, item: text ? S.parseChzzkUrl(text) : null };
    }).filter((row) => row.text);
  }
  function scheduleUrlPreview() {
    clearTimeout(urlPreviewTimer);
    urlPreviewTimer = setTimeout(renderUrlPreview, 300);
  }
  function urlPreviewHtml(row) {
    const { item } = row;
    if (!item) return `<li class="pl-url-bad">치지직 다시보기·클립 주소가 아닙니다: ${esc(row.text)}</li>`;
    const meta = urlMeta.get(S.itemKey(item));
    const info = meta && typeof meta === "object" ? meta : {};
    const clip = item.type === "clip";
    const title = info.title || (meta === "loading" || meta === undefined ? "불러오는 중…" : "정보를 찾지 못했습니다. 주소를 확인해 주세요.");
    const thumb = info.thumb ? `<img src="${esc(info.thumb)}" alt="" referrerpolicy="no-referrer">` : "";
    const start = clip ? "" :
      `<span class="pl-url-start"><label class="pl-start">시작 <input type="text" inputmode="numeric" data-url-start data-clock-max="${info.duration > 0 ? info.duration - 1 : ""}" value="${item.start ? esc(S.formatClock(item.start)) : ""}" ` +
      `placeholder="0:00:00" aria-label="시작 시간(시:분:초)" title="${esc(CLOCK_INPUT_TIP)}"></label><small data-url-time>${item.start ? `currentTime=${item.start}` : "처음부터"}</small></span>`;
    return (
      `<li class="pl-url-card${clip ? " is-clip" : ""}${meta === null ? " is-missing" : ""}" data-line="${row.line}">` +
      `<span class="pl-card-thumb${info.adult ? " is-adult" : ""}"${clip ? ` data-uid="${esc(item.clipUID)}"` : ""}>${thumb}${kindBadgeHtml(clip)}` +
      (info.duration ? `<span class="pl-card-duration">${esc(S.formatClock(info.duration))}</span>` : "") + `</span>` +
      `<span class="pl-url-body"><span class="pl-card-title">${esc(title)}</span>` +
      (info.channelName
        ? `<span class="pl-card-name-row">${profileHtml(info.channelImageUrl)}<span class="pl-card-name">${esc(info.channelName)}</span>` +
          verifiedHtml(info) + `</span>`
        : "") +
      (start ? `<span class="pl-url-kind">${start}</span>` : "") +
      `</span></li>`
    );
  }
  async function renderUrlPreview() {
    const rows = urlRows();
    const box = $("plUrlPreview");
    // 시작 시간을 고치는 중에는 다시 그리지 않는다(칸을 벗어나면 focusout 에서 그린다).
    if (document.activeElement?.closest?.("#plUrlPreview")) return;
    box.innerHTML = rows.map(urlPreviewHtml).join("");
    box.hidden = rows.length === 0;
    box.querySelectorAll(".pl-card-thumb[data-uid]").forEach((thumb) => {
      if (clipOrientation.has(thumb.dataset.uid)) applyClipOrientation(thumb, clipOrientation.get(thumb.dataset.uid));
    });
    const wanted = new Map();
    for (const { item } of rows) {
      const key = item && S.itemKey(item);
      if (key && !urlMeta.has(key) && !wanted.has(key)) wanted.set(key, item.type === "video" ? { type: "video", videoNo: item.videoNo } : { type: "clip", clipUID: item.clipUID });
    }
    const batch = [...wanted.entries()].slice(0, META_BATCH);
    if (!batch.length) return;
    batch.forEach(([key]) => urlMeta.set(key, "loading"));
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: "PLAYLIST_META", items: batch.map(([, item]) => item) });
    } catch {}
    batch.forEach(([key], index) => urlMeta.set(key, reply?.results?.[index]?.title ? reply.results[index] : null));
    renderUrlPreview();
  }
  // 시작 시간 칸 → 그 줄 주소의 currentTime 을 바꿔 쓴다(0 이면 지운다).
  function rewriteUrlStart(input) {
    const card = input.closest("[data-line]");
    const value = S.parseClock(input.value);
    input.setAttribute("aria-invalid", String(value == null));
    if (value == null || !card) return;
    const lines = $("plUrls").value.split("\n");
    const line = Number(card.dataset.line);
    try {
      const url = new URL(lines[line].trim());
      if (value) url.searchParams.set("currentTime", String(value));
      else url.searchParams.delete("currentTime");
      lines[line] = url.href;
      $("plUrls").value = lines.join("\n");
    } catch {}
  }

  // ── 순서 바꾸기(끌기) ──
  let drag = null;
  function itemIndex(li) {
    return [...$("plItems").children].indexOf(li);
  }
  // 놓을 자리는 줄에 그림자를 주지 않고, 줄 사이에 따로 그린 구분선으로 보인다.
  function dropDivider() {
    let line = document.getElementById("plDropDivider");
    if (!line) {
      line = document.createElement("div");
      line.id = "plDropDivider";
      line.className = "pl-drop-divider";
      line.setAttribute("aria-hidden", "true");
      line.hidden = true;
      $("plDetail").append(line);
    }
    return line;
  }
  function clearDropMarks() {
    dropDivider().hidden = true;
  }
  function showDropDivider(y) {
    const line = dropDivider();
    const box = $("plDetail").getBoundingClientRect();
    const list = $("plItems").getBoundingClientRect();
    line.style.top = `${Math.round(y - box.top)}px`;
    line.style.left = `${Math.round(list.left - box.left)}px`;
    line.style.width = `${Math.round(list.width)}px`;
    line.hidden = false;
  }
  function onHandlePointerDown(event) {
    const handle = event.target.closest("[data-handle]");
    if (!handle || event.button !== 0) return;
    const li = handle.closest(".pl-item");
    event.preventDefault();
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {}
    drag = { li, handle, from: itemIndex(li), to: itemIndex(li), pointerId: event.pointerId };
    li.classList.add("is-dragging");
  }
  function onHandlePointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // 끄는 줄을 뺀 나머지 중 가운데가 손가락보다 위인 줄 수 = 빼고 다시 넣을 자리.
    const others = [...$("plItems").children].filter((row) => row !== drag.li);
    const to = others.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2 < event.clientY;
    }).length;
    drag.to = to;
    if (to === drag.from) {
      clearDropMarks();
      return;
    }
    // 줄 사이 틈(4px)의 가운데에 선을 긋는다.
    const y = to > drag.from
      ? others[to - 1].getBoundingClientRect().bottom + 2
      : others[to].getBoundingClientRect().top - 2;
    showDropDivider(y);
  }
  async function onHandlePointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { li, from, to } = drag;
    drag = null;
    li.classList.remove("is-dragging");
    clearDropMarks();
    if (from === to) return;
    await moveTo(from, to);
  }
  async function moveTo(from, to, focusHandle = false) {
    const list = currentList();
    if (!list) return;
    await mutate((current) => S.moveItem(current, list.id, from, to));
    if (focusHandle) $("plItems").children[to]?.querySelector("[data-handle]")?.focus();
  }

  // ── 이벤트 ──
  $("plListNav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-list-id]");
    if (button) selectList(button.dataset.listId);
  });
  $("plNewList").addEventListener("click", async () => {
    const result = await mutate((current) => S.createList(current, "새 재생목록"));
    if (!result.list) {
      toast(`재생목록은 ${S.LIMITS.lists}개까지 만들 수 있습니다.`);
      return;
    }
    selectList(result.list.id);
    $("plName").focus();
    $("plName").select();
  });

  const commitName = async () => {
    const list = currentList();
    const value = $("plName").value.trim();
    if (!list) return;
    if (!value || value === list.name) {
      $("plName").value = list.name;
      return;
    }
    await mutate((current) => S.renameList(current, list.id, value));
  };
  $("plName").addEventListener("change", commitName);
  $("plName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("plName").blur();
    } else if (event.key === "Escape") {
      $("plName").value = currentList()?.name || "";
      $("plName").blur();
    }
  });

  $("plPlay").addEventListener("click", () => void play(0));
  $("plShuffle").addEventListener("click", () => void play(0, { shuffle: true }));
  $("plDeleteList").addEventListener("click", async () => {
    const list = currentList();
    if (!list) return;
    const ok = await RM.confirm({
      title: "재생목록을 삭제할까요?",
      message: `'${list.name}'(${list.items.length}개 항목)을 지웁니다. 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
    });
    if (!ok) return;
    await mutate((current) => S.deleteList(current, list.id));
    state.listId = state.data.lists[0]?.id || "";
    render();
  });

  const exportMenu = $("plExportMenu");
  const setExportMenu = (open) => {
    exportMenu.hidden = !open;
    $("plExport").setAttribute("aria-expanded", String(open));
    if (open) exportMenu.querySelector("button")?.focus();
  };
  $("plExport").addEventListener("click", () => setExportMenu(exportMenu.hidden));
  exportMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-export]");
    if (!button) return;
    setExportMenu(false);
    if (button.dataset.export === "code") void exportCode();
    else exportFile(button.dataset.export === "all");
  });
  document.addEventListener("pointerdown", (event) => {
    if (!exportMenu.hidden && !event.target.closest(".pl-menu-wrap")) setExportMenu(false);
  });
  exportMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setExportMenu(false);
      $("plExport").focus();
    }
  });

  $("plImport").addEventListener("click", openImport);
  $("plAddUrls").addEventListener("click", () => void addFromUrls());
  $("plUrls").addEventListener("input", scheduleUrlPreview);
  $("plUrlPreview").addEventListener("load", onResultImageLoad, true);
  bindClockInputs($("plUrlPreview"), "input[data-url-start]");
  $("plUrlPreview").addEventListener("input", (event) => {
    const input = event.target.closest?.("[data-url-start]");
    if (!input) return;
    const value = S.parseClock(input.value);
    input.setAttribute("aria-invalid", String(value == null));
    const hint = input.closest(".pl-url-start")?.querySelector("[data-url-time]");
    if (hint) hint.textContent = value == null ? "1:23:45 처럼 적어 주세요" : value ? `currentTime=${value}` : "처음부터";
  });
  $("plUrlPreview").addEventListener("change", (event) => {
    const input = event.target.closest?.("[data-url-start]");
    if (input) rewriteUrlStart(input);
  });
  $("plUrlPreview").addEventListener("keydown", (event) => {
    const input = event.target.closest?.("[data-url-start]");
    if (!input || event.key !== "Enter") return;
    event.preventDefault();
    rewriteUrlStart(input);
    input.blur();
  });
  $("plUrlPreview").addEventListener("focusout", () => setTimeout(renderUrlPreview, 0));
  $("plUrls").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void addFromUrls();
    }
  });

  const items = $("plItems");
  // 썸네일을 못 받으면(지워진 영상 등) 깨진 그림 대신 빈 칸으로 둔다.
  items.addEventListener("error", (event) => {
    if (event.target instanceof HTMLImageElement) event.target.remove();
  }, true);
  items.addEventListener("pointerdown", onHandlePointerDown);
  items.addEventListener("pointermove", onHandlePointerMove);
  items.addEventListener("pointerup", (event) => void onHandlePointerUp(event));
  items.addEventListener("pointercancel", (event) => void onHandlePointerUp(event));
  items.addEventListener("click", async (event) => {
    const li = event.target.closest(".pl-item");
    if (!li) return;
    const list = currentList();
    if (!list) return;
    const index = itemIndex(li);
    if (event.target.closest("[data-play]")) {
      void play(index);
      return;
    }
    if (event.target.closest("[data-remove]")) {
      const removed = list.items[index];
      await mutate((current) => S.removeItems(current, list.id, [removed.id]));
      toast("삭제했습니다.", {
        label: "되돌리기",
        run: () => void mutate((current) => S.addItems(current, list.id, [removed], { index })),
      });
    }
  });
  items.addEventListener("change", async (event) => {
    const li = event.target.closest(".pl-item");
    const list = currentList();
    if (!li || !list) return;
    const id = li.dataset.itemId;
    if (event.target.matches("[data-check]")) {
      if (event.target.checked) state.selected.add(id);
      else state.selected.delete(id);
      li.classList.toggle("is-selected", event.target.checked);
      syncSelectBar();
      return;
    }
    if (event.target.matches("[data-start]")) {
      const input = event.target;
      const value = S.parseClock(input.value);
      const item = list.items.find((entry) => entry.id === id);
      const tooLate = value != null && item?.duration > 0 && value >= item.duration;
      input.setAttribute("aria-invalid", String(value == null || tooLate));
      input.title = value == null ? "1:23:45 처럼 적어 주세요." : tooLate ? "영상 길이보다 깁니다." : "";
      if (value == null || tooLate) return;
      input.blur();
      await mutate((current) => S.setStart(current, list.id, id, value));
    }
  });
  bindClockInputs(items, "input[data-start]");
  // 적는 동안 바로 알려 준다(저장은 Enter·칸을 벗어날 때).
  items.addEventListener("input", (event) => {
    const input = event.target.closest?.("input[data-start]");
    if (!input) return;
    const value = S.parseClock(input.value);
    const tooLate = value != null && value > clockMax(input);
    input.setAttribute("aria-invalid", String(value == null || tooLate));
  });
  items.addEventListener("focusout", () => {
    // 시작 시간 입력 중에 미뤄 둔 그리기를 마저 한다.
    setTimeout(() => {
      if (state.renderQueued) render();
    }, 0);
  });
  items.addEventListener("keydown", (event) => {
    if (event.target.matches("[data-start]") && event.key === "Enter") {
      event.preventDefault();
      event.target.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const handle = event.target.closest("[data-handle]");
    const moveKey = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!moveKey || (!handle && !event.altKey)) return;
    const li = event.target.closest(".pl-item");
    const list = currentList();
    if (!li || !list) return;
    const from = itemIndex(li);
    const to = from + moveKey;
    if (to < 0 || to >= list.items.length) return;
    event.preventDefault();
    void moveTo(from, to, true);
  });

  $("plSelectNone").addEventListener("click", () => {
    state.selected.clear();
    render();
  });
  $("plDeleteSelected").addEventListener("click", async () => {
    const list = currentList();
    if (!list || !state.selected.size) return;
    const count = state.selected.size;
    const ok = await RM.confirm({ title: `${count}개 항목을 삭제할까요?`, message: `'${list.name}'에서 고른 항목을 지웁니다.`, confirmLabel: "삭제" });
    if (!ok) return;
    const ids = [...state.selected];
    state.selected.clear();
    await mutate((current) => S.removeItems(current, list.id, ids));
  });

  // ── 추가: 다시보기·클립 탭 ──
  // 다시보기 목록은 멀티뷰 고르기 화면과 같은 소스(multiviewSources.js 의 pager)를 쓴다. 치지직 API 는
  // 확장 페이지에서 직접 부르면 CORS 로 막혀 배경 중계(MULTIVIEW_API)로 받는다.
  const SOURCES = globalThis.CheeseMultiviewSources;
  const CLIP_PAGE_SIZE = 30;
  const add = {
    tab: "url",
    videoSource: "following",
    videoQuery: "",
    videoChannel: null,
    videoPager: null,
    videoItems: [],
    videoToken: 0,
    clipSource: "vault",
    clipChannel: null,
    clipOrder: "RECENT",
    clipItems: [],
    clipCursor: null,
    clipNext: "", // 인기 클립 이어 받기 값(응답이 준다)
    clipPeriod: "WITHIN_1_DAY",
    clipRank: "RECOMMEND",
    clipToken: 0,
    clipLoaded: false,
    videoBusy: false,
    videoHasMore: false,
    clipBusy: false,
  };

  // ── 무한 스크롤 ── 결과 목록(자체 스크롤) 끝 가까이 내리면 다음 쪽을 받는다.
  // 받은 결과가 적어 스크롤이 생기지 않아도 이어 받는다. 숨은 탭에서는 받지 않는다.
  const MORE_THRESHOLD_PX = 240;
  function nearListEnd(el) {
    return el.offsetParent !== null && el.scrollTop + el.clientHeight >= el.scrollHeight - MORE_THRESHOLD_PX;
  }
  function maybeLoadMoreVideos() {
    if (add.videoBusy || !add.videoHasMore || !nearListEnd($("plVideoResults"))) return;
    void loadVideos(false);
  }
  function clipHasMore() {
    if (add.clipSource === "channel") return Boolean(add.clipChannel && add.clipCursor);
    if (add.clipSource === "popular") return Boolean(add.clipNext);
    return false;
  }
  function maybeLoadMoreClips() {
    if (add.clipBusy || !clipHasMore() || !nearListEnd($("plClipResults"))) return;
    void loadClips(false);
  }

  function setAddTab(tab) {
    add.tab = tab;
    document.querySelectorAll("[data-add-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.addTab === tab)));
    document.querySelectorAll("[data-add-body]").forEach((body) => {
      body.hidden = body.dataset.addBody !== tab;
    });
    if (tab === "video" && !add.videoPager) void loadVideos(true);
    if (tab === "clip" && !add.clipLoaded) void loadClips(true);
    if (tab === "video") maybeLoadMoreVideos();
    if (tab === "clip") maybeLoadMoreClips();
  }

  function setSegment(root, attr, value) {
    root.querySelectorAll(`[${attr}]`).forEach((button) => button.setAttribute("aria-checked", String(button.getAttribute(attr) === value)));
  }

  // 멀티뷰 고르기 화면과 같은 카드. 카드를 누르면 지금 목록에 담기/빼기(토글)다.
  const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  function profileHtml(url) {
    return SOURCES?.profileImg ? SOURCES.profileImg(url, 'class="pl-card-avatar"') : "";
  }

  // 조회수 · 날짜(멀티뷰 카드와 같은 표기).
  function resultInfo(item) {
    const views = Number(item.views);
    return [
      Number.isFinite(views) && views > 0 ? `조회수 ${SOURCES?.formatCompactCount ? SOURCES.formatCompactCount(views) : views}회` : "",
      item.date && SOURCES?.formatVideoDate ? SOURCES.formatVideoDate(item.date) : "",
    ].filter(Boolean).join(" · ");
  }
  // 클립 날짜는 "2024-05-01 12:00:00"(한국 시각) 같은 글자로 온다.
  function clipDate(value) {
    if (Number(value) > 0) return Number(value);
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}+09:00`);
    return Number.isFinite(at) ? at : 0;
  }

  function resultsHtml(items) {
    const list = currentList();
    return items.map((item, index) => {
      const inList = S.listContains(list, S.itemKey(item));
      const thumb = item.thumb ? `<img src="${esc(item.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
      const label = `${item.title || "제목 없음"} — ${inList ? "담김, 누르면 뺍니다" : "누르면 담습니다"}`;
      return (
        `<li><button type="button" class="pl-card${item.type === "clip" ? " is-clip" : ""}${inList ? " is-on" : ""}" data-result="${index}" ` +
        `aria-pressed="${inList}" aria-label="${esc(label)}">` +
        `<span class="pl-card-thumb${item.adult ? " is-adult" : ""}"${item.type === "clip" ? ` data-uid="${esc(item.clipUID)}"` : ""}>${thumb}` +
        (item.duration ? `<span class="pl-card-duration">${esc(S.formatClock(item.duration))}</span>` : "") +
        (inList ? `<span class="pl-card-picked">${CHECK_SVG}<span>담김</span></span>` : "") +
        `</span>` +
        `<span class="pl-card-body">${profileHtml(item.channelImageUrl)}<span class="pl-card-text">` +
        `<span class="pl-card-title" title="${esc(item.title)}">${esc(item.title || "제목 없음")}</span>` +
        `<span class="pl-card-name-row"><span class="pl-card-name">${esc(item.channelName || "")}</span>` +
        verifiedHtml(item) +
        `</span>` + (resultInfo(item) ? `<span class="pl-card-info">${esc(resultInfo(item))}</span>` : "") +
        `</span></span></button></li>`
      );
    }).join("");
  }

  // 다시보기 결과 목록형/그리드형(기억). 클립은 세로 썸네일이라 그리드만 쓴다.
  const RESULT_VIEW_KEY = "cheesePlaylistResultView";
  const resultView = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RESULT_VIEW_KEY) || "{}");
      return { video: saved.video === "list" ? "list" : "grid" };
    } catch {
      return { video: "grid" };
    }
  })();
  function applyResultView() {
    $("plVideoResults").classList.toggle("is-list", resultView.video === "list");
    setSegment($("plVideoView"), "data-result-view", resultView.video);
    maybeLoadMoreVideos(); // 목록형은 줄이 낮아 끝이 가까워질 수 있다
  }

  // 클립 썸네일은 세로·가로가 섞여 있다. 클립 검색과 같이 가로 썸네일은 자르지 않고 가운데에 두고
  // 뒤를 같은 이미지의 흐린 판(type=o280x500_blur)으로 채운다. 판정은 이미지를 불러온 뒤 한 번(클립별 기억).
  const clipOrientation = new Map();
  const SAFE_CSS_URL_RE = /^https:\/\/[^\s"'()\\]+$/;
  function blurThumbUrl(url) {
    try {
      const next = new URL(url);
      next.searchParams.set("type", "o280x500_blur");
      return next.href;
    } catch {
      return "";
    }
  }
  function applyClipOrientation(thumb, landscape) {
    thumb.classList.toggle("is-landscape", landscape);
    const img = thumb.querySelector("img");
    const blur = landscape && img ? blurThumbUrl(img.getAttribute("src")) : "";
    thumb.style.backgroundImage = blur && SAFE_CSS_URL_RE.test(blur) ? `url("${blur}")` : "";
  }
  function onResultImageLoad(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const thumb = img.closest(".is-clip .pl-card-thumb[data-uid]");
    if (!thumb || !img.naturalWidth) return;
    const landscape = img.naturalWidth > img.naturalHeight;
    clipOrientation.set(thumb.dataset.uid, landscape);
    applyClipOrientation(thumb, landscape);
  }

  // 보관함 항목은 채널 프로필·파트너 표시가 빠진 경우가 있다(카드가 아닌 곳에서 담았거나 클립 보관함).
  // 채널 정보로 한 채널에 한 번만 채운다.
  const channelInfo = new Map(); // channelId → { image, verified, name } | null(실패) | Promise
  function needsChannelInfo(item) {
    return /^[0-9a-f]{32}$/.test(item.channelId || "") && (!item.channelImageUrl || item.verifiedMark === undefined);
  }
  function fillChannelInfo() {
    if (!SOURCES?.getJson) return;
    const ids = new Set([...add.videoItems, ...add.clipItems].filter(needsChannelInfo).map((item) => item.channelId));
    for (const id of ids) {
      if (channelInfo.has(id)) continue;
      requestChannelInfo(id).then(() => scheduleResultsRender());
    }
  }
  // 채널 정보 한 번 받기(받는 중이면 같은 약속을 돌려준다). 실패하면 null.
  function requestChannelInfo(id) {
    const cached = channelInfo.get(id);
    if (cached !== undefined) return Promise.resolve(cached);
    const job = SOURCES.getJson(`${SOURCES.API}/service/v1/channels/${id}`)
      .then((content) => {
        const info = content ? { image: String(content.channelImageUrl || ""), verified: CheeseVerifiedMark.hasMark(content), verifiedMarkType: CheeseVerifiedMark.typeOf(content), name: String(content.channelName || "") } : null;
        channelInfo.set(id, info);
        return info;
      })
      .catch(() => {
        channelInfo.set(id, null);
        return null;
      });
    channelInfo.set(id, job);
    return job;
  }
  // 예전에 담아 인증 마크를 모르는 항목: 채널 정보로 한 채널에 한 번 확인해 저장한다(다음부터는 묻지 않는다).
  const channelMarkAsked = new Set();
  async function fillListChannelMarks() {
    const list = currentList();
    if (!list || !SOURCES?.getJson) return;
    const ids = [...new Set(list.items
      .filter((item) => typeof item.verifiedMark !== "boolean" && /^[0-9a-f]{32}$/.test(item.channelId || ""))
      .map((item) => item.channelId))].filter((id) => !channelMarkAsked.has(id));
    if (!ids.length) return;
    ids.forEach((id) => channelMarkAsked.add(id));
    const found = [];
    for (let i = 0; i < ids.length; i += 4) {
      const infos = await Promise.all(ids.slice(i, i + 4).map(requestChannelInfo));
      infos.forEach((info, index) => {
        if (info) found.push([ids[i + index], { verifiedMark: info.verified === true, verifiedMarkType: info.verifiedMarkType }]);
      });
    }
    if (!found.length) return;
    await mutate((current) => {
      let next = current;
      for (const [id, mark] of found) next = S.applyChannelMark(next, id, mark).state;
      return { state: next };
    });
  }

  function withChannelInfo(item) {
    const info = channelInfo.get(item.channelId);
    if (!info || typeof info.then === "function") return item;
    return {
      ...item,
      channelImageUrl: item.channelImageUrl || info.image,
      verifiedMark: item.verifiedMark === true || info.verified,
      verifiedMarkType: CheeseVerifiedMark.typeOf(item, info),
      channelName: item.channelName || info.name,
    };
  }
  let resultsRenderQueued = false;
  function scheduleResultsRender() {
    if (resultsRenderQueued) return;
    resultsRenderQueued = true;
    requestAnimationFrame(() => {
      resultsRenderQueued = false;
      renderResults();
    });
  }

  function renderResults() {
    // 이미 받아 둔 채널 정보(다른 탭에서 받은 것 포함)는 그릴 때마다 채운다.
    add.videoItems = add.videoItems.map(withChannelInfo);
    add.clipItems = add.clipItems.map(withChannelInfo);
    $("plVideoResults").innerHTML = resultsHtml(add.videoItems);
    $("plClipResults").innerHTML = resultsHtml(add.clipItems);
    $("plClipResults").querySelectorAll(".pl-card-thumb[data-uid]").forEach((thumb) => {
      if (clipOrientation.has(thumb.dataset.uid)) applyClipOrientation(thumb, clipOrientation.get(thumb.dataset.uid));
    });
    fillChannelInfo();
  }

  function loadErrorText(error) {
    return SOURCES?.isLoginRequiredError?.(error)
      ? "로그인이 필요한 목록입니다. 치지직에 로그인해 주세요."
      : "불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  }

  // ── 다시보기 ──
  function videoItemFromRow(row) {
    return {
      type: "video",
      videoNo: row.videoNo,
      title: row.liveTitle,
      thumb: row.liveImageUrl,
      channelId: row.ownerChannelId,
      channelName: row.channelName,
      duration: row.duration,
      adult: row.adult === true,
      views: row.viewers,
      date: row.openedAt,
      channelImageUrl: row.channelImageUrl,
      // 다시보기 보관함은 파트너 표시를 저장하지 않은 항목이 있다 → 모르면 채널 정보로 채운다.
      verifiedMarkType: CheeseVerifiedMark.typeOf(row),
      verifiedMark: row.verifiedMark === true ? true : add.videoSource === "vault" && !add.videoQuery && !add.videoChannel ? undefined : false,
    };
  }

  function makeVideoPager() {
    if (add.videoChannel) return SOURCES.createChannelVideoPager(add.videoChannel);
    if (add.videoQuery) return SOURCES.createVideoSearchPager(add.videoQuery);
    if (add.videoSource === "vault") return SOURCES.createVideoVaultFavoritesPager();
    if (add.videoSource === "popular") return SOURCES.createAllVideoPager("POPULAR");
    if (add.videoSource === "latest") return SOURCES.createAllVideoPager("LATEST");
    return SOURCES.createFollowingVideoPager();
  }

  async function loadVideos(first) {
    if (!SOURCES) return;
    const token = ++add.videoToken;
    if (first) {
      add.videoPager = makeVideoPager();
      add.videoItems = [];
      renderResults();
      syncVideoScope();
    }
    const status = $("plVideoStatus");
    status.classList.remove("is-error");
    status.textContent = "불러오는 중…";
    add.videoBusy = true;
    add.videoHasMore = false;
    let snap;
    try {
      snap = first ? await add.videoPager.loadFirst(true) : await add.videoPager.loadNext();
    } finally {
      if (token === add.videoToken) add.videoBusy = false;
    }
    if (token !== add.videoToken) return;
    // 검색 결과는 재정렬 pager 가 고른 정렬(추천·인기·최신…)대로 온다.
    add.videoItems = add.videoPager.rows.map(videoItemFromRow).filter((item) => item.videoNo);
    renderResults();
    if (snap.error) {
      status.textContent = loadErrorText(snap.error);
      status.classList.add("is-error");
    } else {
      status.textContent = add.videoItems.length ? `${add.videoItems.length}개` : add.videoSource === "vault" && !add.videoQuery && !add.videoChannel ? "다시보기 보관함이 비어 있습니다." : "결과가 없습니다.";
    }
    add.videoHasMore = !snap.done && !snap.error;
    maybeLoadMoreVideos();
  }

  // ── 클립 ──
  function clipItemFromRow(row, channel = null) {
    return {
      type: "clip",
      clipUID: String(row.clipUID || row.uid || ""),
      title: String(row.clipTitle || row.title || ""),
      thumb: String(row.thumbnailImageUrl || row.thumb || ""),
      channelId: String(row.ownerChannelId || row.channelId || channel?.channelId || ""),
      channelName: String(row.ownerChannel?.channelName || row.channelName || channel?.channelName || ""),
      duration: Number(row.duration) || 0,
      adult: row.adult === true,
      views: Number(row.readCount ?? row.playCount) || 0,
      date: clipDate(row.createdDate || row.publishDate || row.createdAt),
      channelImageUrl: String(row.ownerChannel?.channelImageUrl || row.channelImageUrl || channel?.channelImageUrl || ""),
      verifiedMarkType: CheeseVerifiedMark.typeOf(row.ownerChannel, row, channel),
      verifiedMark: row.ownerChannel?.verifiedMark === true || row.verifiedMark === true || channel?.verifiedMark === true
        ? true
        : channel || row.ownerChannel ? false : undefined, // 클립 보관함 항목은 파트너 표시를 모른다
    };
  }

  async function loadClipVault() {
    const active = await chrome.storage.local.get("cheeseClipVaultActiveAccount");
    const accountId = String(active?.cheeseClipVaultActiveAccount || "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(accountId)) return [];
    const key = `cheeseClipVault:${accountId}`;
    const stored = await chrome.storage.local.get(key);
    const fav = Array.isArray(stored?.[key]?.fav) ? stored[key].fav : [];
    return fav.map((row) => clipItemFromRow(row)).filter((item) => item.clipUID);
  }

  async function fetchChannelClips(channel, cursor) {
    const url = new URL(`${SOURCES.API}/service/v1/channels/${channel.channelId}/clips`);
    url.searchParams.set("clipUID", cursor?.clipUID || "");
    url.searchParams.set("readCount", cursor?.readCount != null ? String(cursor.readCount) : "");
    url.searchParams.set("filterType", "ALL");
    url.searchParams.set("orderType", add.clipOrder);
    url.searchParams.set("size", String(CLIP_PAGE_SIZE));
    const content = await SOURCES.getJson(url.toString());
    const rows = Array.isArray(content?.data) ? content.data : [];
    const next = content?.page?.next;
    return {
      items: rows.map((row) => clipItemFromRow(row, channel)).filter((item) => item.clipUID),
      cursor: next?.clipUID ? { clipUID: String(next.clipUID), readCount: next.readCount ?? "" } : null,
    };
  }

  // 치지직 '인기 클립'(/clips): 실시간·주간 × 추천순·인기순. 30개씩, next 로 이어 받는다.
  const POPULAR_CLIP_NEXT_MAX = 20000; // 이어 받기 값은 쪽마다 길어진다(배경 허용 한도와 같다)
  async function fetchPopularClips(next) {
    const url = new URL(`${SOURCES.API}/service/v1/home/recommended/clips`);
    url.searchParams.set("next", next || "");
    url.searchParams.set("filterType", add.clipPeriod);
    url.searchParams.set("orderType", add.clipRank);
    const content = await SOURCES.getJson(url.toString());
    const rows = Array.isArray(content?.data) ? content.data : [];
    const following = String(content?.page?.next?.next || "");
    return {
      items: rows.map((row) => clipItemFromRow(row)).filter((item) => item.clipUID),
      next: /^[A-Za-z0-9_-]+$/.test(following) && following.length <= POPULAR_CLIP_NEXT_MAX ? following : "",
    };
  }

  async function loadClips(first) {
    if (!SOURCES) return;
    add.clipLoaded = true;
    const token = ++add.clipToken;
    const status = $("plClipStatus");
    status.classList.remove("is-error");
    if (first) {
      add.clipItems = [];
      add.clipCursor = null;
      add.clipNext = "";
      renderResults();
      $("plClipResults").scrollTop = 0;
    }
    if (add.clipSource === "popular") {
      status.textContent = "불러오는 중…";
      add.clipBusy = true;
      try {
        const page = await fetchPopularClips(first ? "" : add.clipNext).finally(() => {
          if (token === add.clipToken) add.clipBusy = false;
        });
        if (token !== add.clipToken) return;
        const seen = new Set(add.clipItems.map((item) => item.clipUID));
        add.clipItems = [...add.clipItems, ...page.items.filter((item) => !seen.has(item.clipUID))];
        add.clipNext = page.next;
        renderResults();
        status.textContent = add.clipItems.length ? `${add.clipItems.length}개` : "클립이 없습니다.";
        maybeLoadMoreClips();
      } catch (error) {
        if (token !== add.clipToken) return;
        status.textContent = loadErrorText(error);
        status.classList.add("is-error");
      }
      return;
    }
    if (add.clipSource === "vault") {
      const items = await loadClipVault().catch(() => []);
      if (token !== add.clipToken) return;
      add.clipItems = items;
      renderResults();
      status.textContent = items.length ? `${items.length}개` : "클립 보관함(즐겨찾기)이 비어 있습니다.";
      return;
    }
    if (!add.clipChannel) {
      status.textContent = "채널을 찾아 고르면 그 채널의 클립이 나옵니다.";
      return;
    }
    status.textContent = "불러오는 중…";
    add.clipBusy = true;
    try {
      const page = await fetchChannelClips(add.clipChannel, first ? null : add.clipCursor).finally(() => {
        if (token === add.clipToken) add.clipBusy = false;
      });
      if (token !== add.clipToken) return;
      const seen = new Set(add.clipItems.map((item) => item.clipUID));
      add.clipItems = [...add.clipItems, ...page.items.filter((item) => !seen.has(item.clipUID))];
      add.clipCursor = page.cursor;
      renderResults();
      status.textContent = add.clipItems.length ? `${add.clipItems.length}개` : "클립이 없습니다.";
      maybeLoadMoreClips();
    } catch (error) {
      if (token !== add.clipToken) return;
      status.textContent = loadErrorText(error);
      status.classList.add("is-error");
    }
  }

  let clipChannelSearchToken = 0;
  let clipChannelSearchTimer = 0;
  async function searchClipChannels(keyword) {
    const token = ++clipChannelSearchToken;
    const box = $("plClipChannels");
    const status = $("plClipStatus");
    status.classList.remove("is-error");
    status.textContent = "채널 찾는 중…";
    try {
      const page = await SOURCES.searchChannelsPage(keyword, 0);
      if (token !== clipChannelSearchToken) return;
      add.channelRows = page.rows;
      box.innerHTML = page.rows.map((row, index) =>
        `<li><button type="button" data-channel="${index}">` +
        // 프로필이 없으면 기본 프로필(다시보기 채널 찾기와 같다)
        SOURCES.profileImg(row.channelImageUrl, 'referrerpolicy="no-referrer"') +
        `<span class="pl-channel-name"><span>${esc(row.channelName)}</span>${verifiedHtml(row)}</span></button></li>`).join("");
      box.hidden = false;
      status.textContent = page.rows.length ? "클립을 볼 채널을 고르세요." : "채널을 찾지 못했습니다.";
    } catch (error) {
      if (token !== clipChannelSearchToken) return;
      status.textContent = loadErrorText(error);
      status.classList.add("is-error");
    }
  }

  // 카드 토글: 담겨 있으면 이 목록에서 같은 영상·클립을 모두 빼고, 아니면 담는다.
  async function toggleResult(items, index) {
    const list = currentList();
    const item = items[index];
    if (!list || !item) return;
    const key = S.itemKey(item);
    if (S.listContains(list, key)) {
      await mutate((current) => {
        const target = S.findList(current, list.id);
        const ids = (target?.items || []).filter((entry) => S.itemKey(entry) === key).map((entry) => entry.id);
        return S.removeItems(current, list.id, ids);
      });
      toast(`'${list.name}'에서 뺐습니다.`);
      return;
    }
    const result = await mutate((current) => S.addItems(current, list.id, [item]));
    if (result.skipped) {
      toast(`한 목록에는 ${S.LIMITS.items}개까지 담을 수 있습니다.`);
      return;
    }
    toast(`'${list.name}'에 담았습니다.`);
    void fillMissingMeta();
  }

  $("plVideoView").addEventListener("click", (event) => {
    const button = event.target.closest("[data-result-view]");
    if (!button) return;
    resultView.video = button.dataset.resultView;
    try {
      localStorage.setItem(RESULT_VIEW_KEY, JSON.stringify(resultView));
    } catch {}
    applyResultView();
  });
  $("plClipResults").addEventListener("load", onResultImageLoad, true);
  applyResultView();

  $("plAddTabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-add-tab]");
    if (tab) setAddTab(tab.dataset.addTab);
  });
  $("plVideoSource").addEventListener("click", (event) => {
    const button = event.target.closest("[data-video-source]");
    if (!button) return;
    add.videoSource = button.dataset.videoSource;
    add.videoQuery = "";
    add.videoChannel = null;
    hideChannelSuggest();
    $("plVideoSearch").querySelector("input").value = "";
    setSegment($("plVideoSource"), "data-video-source", add.videoSource);
    void loadVideos(true);
  });
  $("plVideoSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    hideChannelSuggest();
    add.videoQuery = $("plVideoSearch").querySelector("input").value.trim();
    add.videoChannel = null;
    setSegment($("plVideoSource"), "data-video-source", add.videoQuery ? "" : add.videoSource);
    void loadVideos(true);
  });

  // 지금 보는 범위(검색어 / 채널)를 보이고 지울 수 있게. 검색어일 때만 치즈 플래터 재정렬(정렬·설정)을 붙인다.
  const rerankControls = SOURCES && globalThis.CheeseMultiviewVideoSearchControls
    ? globalThis.CheeseMultiviewVideoSearchControls.attach($("plVideoRerank"), "setup", ({ pager, poolChanged, updatePager }) => {
      if (poolChanged) {
        if (add.videoQuery && !add.videoChannel) void loadVideos(true);
        return;
      }
      if (updatePager === false || !pager || pager !== add.videoPager) return;
      add.videoItems = pager.rows.map(videoItemFromRow).filter((item) => item.videoNo);
      renderResults();
    })
    : null;
  function syncVideoScope() {
    const searching = Boolean(add.videoQuery) && !add.videoChannel;
    const scope = add.videoChannel ? `채널: ${add.videoChannel.channelName || "채널"} 다시보기` : searching ? `검색: "${add.videoQuery}"` : "";
    $("plVideoScope").hidden = !scope;
    $("plVideoScopeText").textContent = scope;
    $("plVideoRerank").hidden = !searching;
    rerankControls?.setPager(searching ? add.videoPager : null);
  }
  $("plVideoScopeClear").addEventListener("click", () => {
    add.videoQuery = "";
    add.videoChannel = null;
    $("plVideoSearch").querySelector("input").value = "";
    setSegment($("plVideoSource"), "data-video-source", add.videoSource);
    void loadVideos(true);
  });

  // 입력하면 채널을 제안한다(멀티뷰 고르기 화면과 같다). 고르면 그 채널의 다시보기를 본다.
  let channelSuggestTimer = 0;
  let channelSuggestToken = 0;
  let channelSuggestRows = [];
  function hideChannelSuggest() {
    clearTimeout(channelSuggestTimer);
    channelSuggestToken += 1;
    $("plVideoChannelPopover").hidden = true;
    $("plVideoSearch").querySelector("input").setAttribute("aria-expanded", "false");
  }
  async function showChannelSuggest(query) {
    const token = ++channelSuggestToken;
    const popover = $("plVideoChannelPopover");
    popover.hidden = false;
    $("plVideoSearch").querySelector("input").setAttribute("aria-expanded", "true");
    popover.innerHTML = '<div class="mv-video-channel-empty" aria-busy="true">채널을 찾는 중…</div>';
    let rows = [];
    try {
      rows = (await SOURCES.searchChannelsPage(query, 0)).rows.slice(0, 8);
    } catch {}
    if (token !== channelSuggestToken) return;
    channelSuggestRows = rows;
    // 검색어로 다시보기 찾기는 옆 '검색' 버튼·Enter 로 한다(제안 목록에는 채널만). 채널이 없으면 닫는다.
    if (!rows.length) {
      hideChannelSuggest();
      return;
    }
    popover.innerHTML =
      rows.map((row, index) =>
        `<button type="button" class="mv-video-channel-option" role="option" data-pl-channel="${index}">` +
        SOURCES.profileImg(row.channelImageUrl) +
        `<span class="mv-video-channel-option-name">${esc(row.channelName || "채널")}</span>` +
        (CheeseVerifiedMark.kind(row) ? `<span class="mv-card-verified pl-card-verified" data-cheese-mark="${CheeseVerifiedMark.kind(row)}" role="img" aria-label="${CheeseVerifiedMark.label(CheeseVerifiedMark.kind(row))} 채널"></span>` : "") +
        `</button>`).join("");
  }
  const videoSearchInput = $("plVideoSearch").querySelector("input");
  videoSearchInput.addEventListener("input", () => {
    clearTimeout(channelSuggestTimer);
    const query = videoSearchInput.value.trim();
    if (!query) {
      hideChannelSuggest();
      return;
    }
    channelSuggestTimer = setTimeout(() => void showChannelSuggest(query), 250);
  });
  videoSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideChannelSuggest();
  });
  $("plVideoChannelPopover").addEventListener("click", (event) => {
    const row = channelSuggestRows[Number(event.target.closest("[data-pl-channel]")?.dataset.plChannel)];
    if (!row) return;
    hideChannelSuggest();
    add.videoChannel = row;
    add.videoQuery = "";
    videoSearchInput.value = "";
    setSegment($("plVideoSource"), "data-video-source", "");
    void loadVideos(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest?.(".pl-video-search-wrap")) hideChannelSuggest();
  });
  $("plVideoResults").addEventListener("scroll", maybeLoadMoreVideos, { passive: true });
  $("plVideoResults").addEventListener("click", (event) => {
    const button = event.target.closest("[data-result]");
    if (button) void toggleResult(add.videoItems, Number(button.dataset.result));
  });
  $("plClipSource").addEventListener("click", (event) => {
    const button = event.target.closest("[data-clip-source]");
    if (!button) return;
    add.clipSource = button.dataset.clipSource;
    setSegment($("plClipSource"), "data-clip-source", add.clipSource);
    const channelMode = add.clipSource === "channel";
    $("plClipPopular").hidden = add.clipSource !== "popular";
    $("plClipChannelSearch").hidden = !channelMode;
    $("plClipChannels").hidden = !channelMode || !$("plClipChannels").children.length || Boolean(add.clipChannel);
    $("plClipChannelHead").hidden = !channelMode || !add.clipChannel;
    if (channelMode) $("plClipChannelSearch").querySelector("input").focus();
    void loadClips(true);
  });
  // 다시보기 검색처럼 적으면 바로 찾는다(잠깐 멈추면). Enter·찾기는 기다리지 않고 바로.
  function startClipChannelSearch(keyword) {
    clearTimeout(clipChannelSearchTimer);
    add.clipChannel = null;
    add.clipCursor = null;
    add.clipToken += 1; // 고른 채널의 클립을 받던 중이면 버린다
    $("plClipChannelHead").hidden = true;
    add.clipItems = [];
    renderResults();
    if (!keyword) {
      clipChannelSearchToken += 1;
      $("plClipChannels").hidden = true;
      $("plClipChannels").innerHTML = "";
      $("plClipStatus").classList.remove("is-error");
      $("plClipStatus").textContent = "채널을 찾아 고르면 그 채널의 클립이 나옵니다.";
      return;
    }
    void searchClipChannels(keyword);
  }
  $("plClipChannelSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    startClipChannelSearch($("plClipChannelSearch").querySelector("input").value.trim());
  });
  $("plClipChannelSearch").querySelector("input").addEventListener("input", (event) => {
    clearTimeout(clipChannelSearchTimer);
    const keyword = event.target.value.trim();
    clipChannelSearchTimer = setTimeout(() => startClipChannelSearch(keyword), keyword ? 250 : 0);
  });
  $("plClipChannels").addEventListener("click", (event) => {
    const button = event.target.closest("[data-channel]");
    const row = add.channelRows?.[Number(button?.dataset.channel)];
    if (!row) return;
    add.clipChannel = row;
    $("plClipChannels").hidden = true;
    const head = $("plClipChannelHead");
    head.hidden = false;
    head.querySelector("strong").innerHTML = `<span>${esc(row.channelName)}</span>${verifiedHtml(row)}`;
    void loadClips(true);
  });
  // 인기 클립 기간·정렬(마지막에 고른 값 기억)
  const CLIP_POPULAR_KEY = "cheesePlaylistClipPopular";
  try {
    const saved = JSON.parse(localStorage.getItem(CLIP_POPULAR_KEY) || "{}");
    if (saved.period === "WITHIN_7_DAYS") add.clipPeriod = saved.period;
    if (saved.rank === "POPULAR") add.clipRank = saved.rank;
  } catch {}
  setSegment($("plClipPeriod"), "data-clip-period", add.clipPeriod);
  setSegment($("plClipRank"), "data-clip-rank", add.clipRank);
  function pickPopularClips(changes) {
    Object.assign(add, changes);
    setSegment($("plClipPeriod"), "data-clip-period", add.clipPeriod);
    setSegment($("plClipRank"), "data-clip-rank", add.clipRank);
    try {
      localStorage.setItem(CLIP_POPULAR_KEY, JSON.stringify({ period: add.clipPeriod, rank: add.clipRank }));
    } catch {}
    void loadClips(true);
  }
  $("plClipPeriod").addEventListener("click", (event) => {
    const button = event.target.closest("[data-clip-period]");
    if (button && button.dataset.clipPeriod !== add.clipPeriod) pickPopularClips({ clipPeriod: button.dataset.clipPeriod });
  });
  $("plClipRank").addEventListener("click", (event) => {
    const button = event.target.closest("[data-clip-rank]");
    if (button && button.dataset.clipRank !== add.clipRank) pickPopularClips({ clipRank: button.dataset.clipRank });
  });
  $("plClipOrder").addEventListener("click", (event) => {
    const button = event.target.closest("[data-clip-order]");
    if (!button) return;
    add.clipOrder = button.dataset.clipOrder;
    setSegment($("plClipOrder"), "data-clip-order", add.clipOrder);
    void loadClips(true);
  });
  $("plClipResults").addEventListener("scroll", maybeLoadMoreClips, { passive: true });
  $("plClipResults").addEventListener("click", (event) => {
    const button = event.target.closest("[data-result]");
    if (button) void toggleResult(add.clipItems, Number(button.dataset.result));
  });

  // 다른 탭(치지직에서 담기 등)이 바꾸면 따라간다.
  let reloadTimer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[S.KEY]) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reload(), 120);
  });

  function paintThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    $("plTheme").innerHTML = dark ? ICON.sun : ICON.moon;
    $("plTheme").title = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
  }
  $("plTheme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    paintThemeButton();
    // 채널 이미지가 없어 넣어 둔 기본 프로필(채널 찾기·결과 카드)도 테마에 맞는 것으로 바꾼다(멀티뷰와 같다).
    const url = SOURCES?.defaultProfileUrl?.(next);
    if (url) {
      document.querySelectorAll("img[data-mv-default-profile]").forEach((img) => {
        if (img.getAttribute("src") !== url) img.setAttribute("src", url);
      });
    }
  });

  const requested = new URLSearchParams(location.search).get("list") || "";
  if (requested) state.listId = requested;
  paintThemeButton();
  void reload();
})();
