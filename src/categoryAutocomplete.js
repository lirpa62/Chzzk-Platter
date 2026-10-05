// 치즈 플래터 - 카테고리 이름 자동완성.
//
// 치지직 카테고리 자동완성 API(로그인 불필요, chzzk.naver.com 에 CORS 허용)로 입력 중인
// 글자가 들어간 카테고리를 찾아 목록으로 보여 준다. 카테고리 이름을 정확히 입력해야 하는
// 곳(라이브 제외 필터, 검색어의 @카테고리)에 붙인다.
//
// ⚠ 이 API 는 카테고리 표시 이름(categoryValue)으로만 찾는다. 'gta5' 같은 별칭은 찾지 못하고
//   ('Grand' 로는 찾는다), size 는 50 을 넘으면 400 이다(2026-10-05 실측).
// 설정 페이지·팝업(확장 페이지)과 치지직 페이지(content script)에서 함께 쓴다.
(() => {
  "use strict";

  const API = "https://api.chzzk.naver.com/manage/v1/auto-complete/categories";
  const SIZE = 20;
  const DEBOUNCE_MS = 180;
  const CACHE_MS = 5 * 60 * 1000;
  const CACHE_MAX = 100;
  const TYPE_LABELS = { GAME: "게임", SPORTS: "스포츠", ETC: "기타" };
  const STYLE_ID = "cheese-cat-ac-style";
  const cache = new Map();
  let listSeq = 0;

  // 카테고리 후보. [{ type, id, value }] — value 가 치지직이 표시하는 이름이다.
  async function fetchCategories(keyword, signal) {
    const key = String(keyword || "").trim().toLocaleLowerCase("ko-KR");
    if (!key) return [];
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const url = `${API}?keyword=${encodeURIComponent(keyword.trim())}&size=${SIZE}`;
    const response = await fetch(url, { signal, credentials: "omit" });
    if (!response.ok) throw new Error(`category autocomplete ${response.status}`);
    const data = await response.json();
    const value = (Array.isArray(data?.content?.results) ? data.content.results : [])
      .map((item) => ({
        type: String(item?.categoryType || ""),
        id: String(item?.categoryId || ""),
        value: String(item?.categoryValue || "").trim(),
      }))
      .filter((item) => item.value);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }

  // 입력값과 커서에서 지금 완성할 부분을 찾는다. 없으면 null.
  // filter: 쉼표로 나눈 마지막 항목('#' 으로 시작하면 태그라 제외).
  // query: 커서 앞의 @카테고리(@"이름 일부 도 받는다).
  function tokenAt(mode, value, caret) {
    const before = value.slice(0, caret);
    if (mode === "query") {
      const match = /@(?:"([^"]*)|([^\s"#@|()]*))$/.exec(before);
      if (!match) return null;
      const keyword = (match[1] ?? match[2] ?? "").trim();
      let end = caret;
      if (match[1] !== undefined && value[end] === '"') end += 1; // 닫는 따옴표까지 바꾼다
      return keyword ? { keyword, start: match.index, end } : null;
    }
    const start = Math.max(before.lastIndexOf(",") + 1, before.lastIndexOf("\n") + 1);
    const raw = before.slice(start);
    const keyword = raw.trim();
    if (!keyword || keyword.startsWith("#")) return null;
    return { keyword, start: start + (raw.length - raw.trimStart().length), end: caret };
  }

  function replacement(mode, value) {
    return mode === "query" ? `@"${value.replace(/"/g, "")}"` : value;
  }

  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.cheese-cat-ac{position:fixed;z-index:2147483000;margin:0;padding:4px;list-style:none;box-sizing:border-box;
  max-height:min(280px,40vh);overflow-y:auto;border-radius:10px;font-family:inherit;font-size:13px;line-height:1.35;
  background:#fff;color:#1f2328;border:1px solid #d6dae0;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.cheese-cat-ac.is-dark{background:#1f2125;color:#e8eaed;border-color:#3a3f45;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.cheese-cat-ac[hidden]{display:none}
.cheese-cat-ac li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}
.cheese-cat-ac li[aria-selected="true"]{background:rgba(0,200,130,.16)}
.cheese-cat-ac.is-dark li[aria-selected="true"]{background:rgba(0,255,163,.16)}
.cheese-cat-ac-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cheese-cat-ac-type{flex:none;font-size:11px;opacity:.6}`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // 글자색이 밝으면 어두운 배경 화면이다.
  function isDarkInput(input) {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(input).color);
    if (!match) return false;
    const [r, g, b] = match.slice(1).map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }

  // input 에 자동완성을 붙인다. mode: "filter"(라이브 제외 필터) | "query"(검색어 @카테고리).
  // 고르면 그 부분을 카테고리 이름으로 바꾸고 input 이벤트를 보낸다(목록이 바로 갱신되게).
  // 반환: 떼어 내는 함수.
  function attach(input, { mode = "filter" } = {}) {
    if (!input || input.dataset.cheeseCatAc === "1") return () => {};
    input.dataset.cheeseCatAc = "1";
    const doc = input.ownerDocument;
    ensureStyle(doc);
    const list = doc.createElement("ul");
    const listId = `cheese-cat-ac-${++listSeq}`;
    list.id = listId;
    list.className = "cheese-cat-ac";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "카테고리 자동완성");
    list.hidden = true;
    // 목록과 화면 리스너는 열려 있는 동안만 둔다. 입력창이 DOM 에서 빠지면(검색창을 다시
    // 그리면) 남는 것이 없다.
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listId);

    let items = [];
    let active = -1;
    let token = null;
    let timer = 0;
    let controller = null;
    let picking = false;

    const onViewportChange = () => {
      if (!list.hidden) place();
    };
    function open() {
      if (!list.isConnected) doc.body.appendChild(list);
      list.hidden = false;
      doc.defaultView.addEventListener("resize", onViewportChange);
      doc.addEventListener("scroll", onViewportChange, true);
    }
    function close() {
      list.hidden = true;
      list.remove();
      doc.defaultView.removeEventListener("resize", onViewportChange);
      doc.removeEventListener("scroll", onViewportChange, true);
      items = [];
      active = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function place() {
      const rect = input.getBoundingClientRect();
      const view = doc.defaultView;
      list.style.left = `${Math.max(4, rect.left)}px`;
      list.style.width = `${Math.max(220, rect.width)}px`;
      const below = view.innerHeight - rect.bottom;
      if (below < 160 && rect.top > below) {
        list.style.top = "";
        list.style.bottom = `${view.innerHeight - rect.top + 4}px`;
      } else {
        list.style.bottom = "";
        list.style.top = `${rect.bottom + 4}px`;
      }
    }

    function setActive(index) {
      active = index;
      [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
      const li = list.children[active];
      if (li) {
        input.setAttribute("aria-activedescendant", li.id);
        li.scrollIntoView({ block: "nearest" });
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function render(results) {
      items = results;
      list.textContent = "";
      results.forEach((item, index) => {
        const li = doc.createElement("li");
        li.id = `${listId}-${index}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const name = doc.createElement("span");
        name.className = "cheese-cat-ac-name";
        name.textContent = item.value;
        const type = doc.createElement("span");
        type.className = "cheese-cat-ac-type";
        type.textContent = TYPE_LABELS[item.type] || "";
        li.append(name, type);
        // 누르는 동안 입력창 포커스가 빠지지 않게 한다(blur 로 목록이 먼저 닫힌다).
        li.addEventListener("mousedown", (event) => event.preventDefault());
        li.addEventListener("click", () => pick(index));
        list.appendChild(li);
      });
      if (!results.length || doc.activeElement !== input) {
        close();
        return;
      }
      list.classList.toggle("is-dark", isDarkInput(input));
      open();
      place();
      input.setAttribute("aria-expanded", "true");
      setActive(-1);
    }

    function pick(index) {
      const item = items[index];
      if (!item || !token) return;
      const value = input.value;
      const text = replacement(mode, item.value);
      const tail = value.slice(token.end);
      const spacer = mode === "query" && !/^\s/.test(tail) ? " " : "";
      input.value = value.slice(0, token.start) + text + spacer + tail;
      const caret = token.start + text.length + spacer.length;
      input.setSelectionRange?.(caret, caret);
      close();
      token = null;
      // 고른 결과로 목록·검색을 갱신하되, 이 input 이벤트로 자동완성이 다시 열리지 않게 한다.
      picking = true;
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } finally {
        picking = false;
      }
      input.focus();
    }

    function update() {
      clearTimeout(timer);
      controller?.abort();
      token = tokenAt(mode, input.value, input.selectionStart ?? input.value.length);
      if (!token) {
        close();
        return;
      }
      const current = token;
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const results = await fetchCategories(current.keyword, controller.signal);
          if (token === current) render(results);
        } catch {
          if (token === current) close();
        }
      }, DEBOUNCE_MS);
    }

    function onKeydown(event) {
      if (list.hidden || event.isComposing || event.keyCode === 229) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // -1(입력창) → 0 … 끝 → -1 로 돈다.
        let next = active + (event.key === "ArrowDown" ? 1 : -1);
        if (next >= items.length) next = -1;
        else if (next < -1) next = items.length - 1;
        setActive(next);
      } else if (event.key === "Enter" && active >= 0) {
        pick(active);
      } else if (event.key === "Escape") {
        close();
      } else {
        return;
      }
      // 목록이 키를 쓴 경우: 검색 실행·폼 제출·창 닫기로 이어지지 않게 한다.
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const onInput = () => {
      if (!picking) update();
    };
    const onBlur = () => setTimeout(() => {
      if (doc.activeElement !== input) close();
    }, 120);
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown, true);
    input.addEventListener("blur", onBlur);

    return () => {
      clearTimeout(timer);
      controller?.abort();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown, true);
      input.removeEventListener("blur", onBlur);
      close();
      delete input.dataset.cheeseCatAc;
    };
  }

  const api = { fetchCategories, tokenAt, replacement, attach, API, SIZE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseCategoryAutocomplete = api;
})();
