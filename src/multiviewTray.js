// 치즈 플래터 - 멀티뷰 담아두기(트레이)
//
// 치지직을 보다가 마음에 드는 방송을 바로 멀티뷰 후보로 담는다. 기존 고르기 화면을
// 대체하지 않고 '또 하나의 진입 경로' 다.
//
// ⚠ 최상위 페이지에서만 동작한다. 멀티뷰 안의 치지직 iframe 마다 트레이가 생기면
//   안 된다(6개면 6번 생긴다).
// ⚠ 사이트 CSS 와 섞이지 않도록 Shadow DOM 안에 그린다.
(() => {
  "use strict";

  if (window.self !== window.top) return; // iframe 안에서는 동작하지 않는다
  // 멀티뷰가 띄운 프레임이거나 팝업 플레이어면 트레이를 만들지 않는다.
  const params = new URLSearchParams(location.search);
  if (params.get("cheeseMulti") === "1") return;
  if (params.get("cheeseMultiChat") === "1") return;
  if (params.get("cheesePopup") === "1") return;

  const MAX = 6;
  const MIN = 2;
  const HASH_RE = /^[0-9a-f]{32}$/i;
  const TRAY_ID = "cheese-multiview-tray";
  const ADD_ATTR = "data-cheese-mv-add";

  let staged = [];
  let collapsed = false;
  let root = null; // shadow root
  let toastTimer = 0;

  // ── 배경 스크립트와 주고받기 ────────────────────────────────────────────
  // 정본은 배경이 들고 있다. 여러 탭이 같은 목록을 보도록 하기 위해서다.
  async function send(op, extra) {
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "MULTIVIEW_STAGED",
        op,
        ...extra,
      });
      if (reply?.ok) return { items: reply.items || [] };
      return { error: reply?.reason || "실패" };
    } catch (error) {
      return { error: String(error?.message || error) };
    }
  }

  // ── 채널 정보 얻기 ──────────────────────────────────────────────────────
  // ⚠ DOM 구조로 id 를 추측하지 않는다. /live/<32자리 hex> 주소에서만 뽑는다.
  function channelIdFromHref(href) {
    if (!href) return "";
    try {
      const path = new URL(href, location.origin).pathname;
      const m = path.match(/^\/live\/([0-9a-f]{32})/i);
      return m ? m[1].toLowerCase() : "";
    } catch {
      return "";
    }
  }

  function channelFromCard(anchor) {
    const channelId = channelIdFromHref(anchor.getAttribute("href"));
    if (!channelId) return null;
    // 카드 안의 이미지·글자에서 이름을 찾는다. 못 찾으면 빈 이름으로 담고
    // 트레이에서 채널 번호 일부를 보여 준다(추측해서 잘못된 이름을 넣지 않는다).
    const card = anchor.closest("li, article, div") || anchor;
    const img = card.querySelector('img[src*="nng-phinf"], img[alt]');
    const nameEl = card.querySelector('[class*="_name"], [class*="_nickname"]');
    return {
      channelId,
      channelName: (nameEl?.textContent || img?.alt || "").trim().slice(0, 60),
      channelImageUrl: img?.getAttribute("src") || "",
    };
  }

  // 지금 보고 있는 방송(라이브 페이지).
  function currentPageChannel() {
    const channelId = channelIdFromHref(location.pathname);
    if (!channelId) return null;
    return {
      channelId,
      channelName: (document.title || "").split("|")[0].trim().slice(0, 60),
      channelImageUrl: "",
    };
  }

  // ── 담기 ────────────────────────────────────────────────────────────────
  async function addChannel(channel) {
    if (!channel || !HASH_RE.test(channel.channelId)) return;
    if (staged.some((c) => c.channelId === channel.channelId)) {
      toast("이미 담은 채널입니다.");
      return;
    }
    const { items, error } = await send("ADD", { item: channel });
    if (error === "full") {
      toast(`멀티뷰는 최대 ${MAX}개까지 담을 수 있습니다.`);
      return;
    }
    if (error) {
      toast("담지 못했습니다.");
      return;
    }
    staged = items;
    render();
    toast(`${channel.channelName || "채널"} 담음`);
  }

  // ── 트레이 UI ───────────────────────────────────────────────────────────
  function ensureTray() {
    if (root) return root;
    const host = document.createElement("div");
    host.id = TRAY_ID;
    // 사이트 레이아웃에 끼어들지 않게 고정 위치로 띄운다.
    host.style.cssText =
      "position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483000;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: inherit; }
      .wrap {
        background: #17191c; border: 1px solid #34383d; border-right: 0;
        border-radius: 10px 0 0 10px; color: #e9ecef; display: flex;
        flex-direction: column; font-size: 12px; gap: 6px; max-height: 70vh;
        padding: 8px; width: 210px;
        font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif;
      }
      .wrap.collapsed { width: auto; padding: 6px; }
      .head { align-items: center; display: flex; gap: 6px; }
      .title { font-weight: 700; }
      .count { color: #9aa1a9; margin-left: auto; }
      button {
        background: none; border: 1px solid #34383d; border-radius: 6px;
        color: inherit; cursor: pointer; font: inherit; font-size: 11px;
        padding: 3px 7px;
      }
      button:hover:not(:disabled) { border-color: #00ffa3; color: #00ffa3; }
      button:disabled { cursor: default; opacity: 0.4; }
      .list { display: flex; flex-direction: column; gap: 4px; margin: 0;
        overflow-y: auto; padding: 0; list-style: none; }
      .item { align-items: center; background: #1e2125; border-radius: 6px;
        display: flex; gap: 5px; padding: 4px 5px; }
      .item .name { flex: 1 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .item.dragging { opacity: 0.5; }
      .grip { cursor: grab; color: #9aa1a9; }
      .move { padding: 1px 4px; }
      .run { background: #00ffa3; border: 0; color: #05170f; font-weight: 700;
        padding: 6px; }
      .empty { color: #9aa1a9; padding: 6px 2px; }
      .toast { background: #000; border-radius: 6px; color: #fff; font-size: 11px;
        padding: 5px 8px; }
    </style><div class="wrap" part="wrap"></div>`;
    (document.body || document.documentElement).appendChild(host);
    bindTrayEvents();
    return root;
  }

  function render() {
    const shadow = ensureTray();
    const wrap = shadow.querySelector(".wrap");
    wrap.classList.toggle("collapsed", collapsed);
    if (collapsed) {
      wrap.innerHTML =
        `<button type="button" data-act="expand" title="멀티뷰 담아두기 펴기"` +
        ` aria-label="멀티뷰 담아두기 펴기">⊞ ${staged.length}</button>`;
      return;
    }
    const rows = staged.length
      ? staged
          .map(
            (c, i) =>
              `<li class="item" draggable="true" data-id="${esc(c.channelId)}">` +
              `<span class="grip" aria-hidden="true">⋮⋮</span>` +
              `<span class="name" title="${esc(c.channelName)}">${esc(
                c.channelName || c.channelId.slice(0, 8),
              )}</span>` +
              `<button type="button" class="move" data-act="up" data-id="${esc(c.channelId)}"` +
              `${i === 0 ? " disabled" : ""} aria-label="위로">▲</button>` +
              `<button type="button" class="move" data-act="down" data-id="${esc(c.channelId)}"` +
              `${i === staged.length - 1 ? " disabled" : ""} aria-label="아래로">▼</button>` +
              `<button type="button" class="move" data-act="remove" data-id="${esc(c.channelId)}"` +
              ` aria-label="빼기">×</button></li>`,
          )
          .join("")
      : '<li class="empty">방송 카드의 ⊞ 를 눌러 담으세요.</li>';
    wrap.innerHTML =
      `<div class="head"><span class="title">멀티뷰</span>` +
      `<span class="count">${staged.length} / ${MAX}</span>` +
      `<button type="button" data-act="collapse" aria-label="접기">−</button></div>` +
      `<ul class="list">${rows}</ul>` +
      `<button type="button" class="run" data-act="run"${
        staged.length < MIN ? " disabled" : ""
      }>멀티뷰 실행</button>` +
      `<button type="button" data-act="setup"${
        staged.length < MIN ? " disabled" : ""
      }>고르기 화면에서 열기</button>` +
      (staged.length
        ? `<button type="button" data-act="clear">모두 비우기</button>`
        : "");
  }

  function toast(text) {
    const shadow = ensureTray();
    const wrap = shadow.querySelector(".wrap");
    if (!wrap || collapsed) return;
    let box = wrap.querySelector(".toast");
    if (!box) {
      box = document.createElement("div");
      box.className = "toast";
      wrap.appendChild(box);
    }
    box.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.remove(), 2200);
  }

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  // ── 트레이 조작 ─────────────────────────────────────────────────────────
  function bindTrayEvents() {
    let dragId = "";
    root.addEventListener("click", async (event) => {
      const button = event.target.closest?.("button[data-act]");
      if (!button) return;
      const act = button.dataset.act;
      const id = button.dataset.id;
      if (act === "collapse" || act === "expand") {
        collapsed = act === "collapse";
        render();
        return;
      }
      if (act === "remove") {
        const { items } = await send("REMOVE", { channelId: id });
        if (items) staged = items;
        render();
        return;
      }
      if (act === "clear") {
        const { items } = await send("CLEAR");
        if (items) staged = items;
        render();
        return;
      }
      if (act === "up" || act === "down") {
        // 끌기 말고도 순서를 바꿀 수 있게 한다(키보드로도 누를 수 있다).
        const from = staged.findIndex((c) => c.channelId === id);
        const to = act === "up" ? from - 1 : from + 1;
        if (from < 0 || to < 0 || to >= staged.length) return;
        const order = staged.map((c) => c.channelId);
        [order[from], order[to]] = [order[to], order[from]];
        const { items } = await send("REORDER", { order });
        if (items) staged = items;
        render();
        return;
      }
      if (act === "run" || act === "setup") {
        void startMultiview(act === "setup");
      }
    });

    // 끌어서 순서 바꾸기(위/아래 단추와 같은 결과).
    root.addEventListener("dragstart", (event) => {
      const item = event.target.closest?.(".item");
      if (!item) return;
      dragId = item.dataset.id || "";
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    root.addEventListener("dragover", (event) => {
      if (dragId && event.target.closest?.(".item")) event.preventDefault();
    });
    root.addEventListener("drop", async (event) => {
      const over = event.target.closest?.(".item");
      if (!dragId || !over) return;
      event.preventDefault();
      const order = staged.map((c) => c.channelId);
      const from = order.indexOf(dragId);
      const to = order.indexOf(over.dataset.id);
      dragId = "";
      if (from < 0 || to < 0 || from === to) return;
      order.splice(to, 0, ...order.splice(from, 1));
      const { items } = await send("REORDER", { order });
      if (items) staged = items;
      render();
    });
    // ⚠ 엉뚱한 곳에 놓거나 취소해도 여기로는 반드시 온다.
    root.addEventListener("dragend", () => {
      dragId = "";
      for (const el of root.querySelectorAll(".item.dragging")) {
        el.classList.remove("dragging");
      }
    });
  }

  // ── 실행 ────────────────────────────────────────────────────────────────
  // 기존 고르기 화면과 같은 넘김 구조(세션 키 + 주소의 setup id)를 그대로 쓴다.
  async function startMultiview(openSetup) {
    if (staged.length < MIN) return;
    const handoffId =
      crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const setup = {
      chosen: staged.slice(0, MAX),
      // 배치·채팅 자리는 받는 쪽 검증이 채널 수에 맞게 정해 준다.
      layoutId: "",
      chatSide: "",
      mainHighQuality: true,
    };
    try {
      await chrome.storage.session.set({
        [`cheeseMultiviewSetup:${handoffId}`]: setup,
      });
    } catch {
      toast("멀티뷰를 열지 못했습니다.");
      return;
    }
    const page = openSetup ? "multiview.html" : "multiviewWatch.html";
    const url = `${chrome.runtime.getURL(page)}?setup=${handoffId}`;
    window.open(url, "_blank", "noopener");
  }

  // ── 카드에 담기 버튼 붙이기 ─────────────────────────────────────────────
  // ⚠ 카드마다 노드를 만들지 않는다. 문서에 위임해 두고 hover 한 카드에만 하나를
  //   옮겨 붙인다(카드가 수십 개여도 버튼은 하나다).
  let addButton = null;
  function ensureAddButton() {
    if (addButton) return addButton;
    addButton = document.createElement("button");
    addButton.type = "button";
    addButton.setAttribute(ADD_ATTR, "1");
    addButton.title = "멀티뷰에 추가";
    addButton.setAttribute("aria-label", "멀티뷰에 추가");
    addButton.textContent = "⊞";
    addButton.style.cssText =
      "position:absolute;left:6px;top:6px;z-index:20;width:24px;height:24px;" +
      "border:1px solid rgba(255,255,255,.3);border-radius:6px;" +
      "background:rgba(0,0,0,.66);color:#fff;cursor:pointer;font-size:13px;" +
      "line-height:1;padding:0;";
    addButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const anchor = addButton.__anchor;
      if (anchor) void addChannel(channelFromCard(anchor));
    });
    return addButton;
  }

  document.addEventListener(
    "pointerover",
    (event) => {
      const anchor = event.target?.closest?.('a[href*="/live/"]');
      if (!anchor) return;
      if (!channelIdFromHref(anchor.getAttribute("href"))) return;
      const holder = anchor.closest("li, article, div") || anchor;
      if (getComputedStyle(holder).position === "static") {
        holder.style.position = "relative";
      }
      const button = ensureAddButton();
      button.__anchor = anchor;
      if (button.parentElement !== holder) holder.appendChild(button);
    },
    true,
  );

  // ── 시작 ────────────────────────────────────────────────────────────────
  (async () => {
    const { items } = await send("GET");
    staged = items || [];
    render();
  })();

  // 다른 탭에서 목록이 바뀌면 따라 그린다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session" || !changes.cheeseMultiviewStaged) return;
    const next = changes.cheeseMultiviewStaged.newValue;
    staged = Array.isArray(next) ? next : [];
    render();
  });

  // 라이브 페이지에서는 지금 보는 방송을 바로 담을 수 있게 한다.
  const pageChannel = currentPageChannel();
  if (pageChannel) {
    document.addEventListener("keydown", (event) => {
      // Alt+M: 지금 보는 방송 담기(키보드만으로도 담을 수 있게).
      if (!event.altKey || event.code !== "KeyM") return;
      if (!event.isTrusted) return;
      void addChannel(currentPageChannel());
    });
  }
})();
