// 치즈 플래터 - 멀티뷰 시청 화면
// 채널 고르기(multiview.html)에서 넘긴 구성을 받아 실제로 방송을 띄운다.
//
// ⚠ m3u8 을 직접 재생하지 않는다. 중간광고·그리드를 우회하는 셈이 되어 제재
//   사유가 될 수 있다. 치지직 페이지를 그대로 띄워 광고·집계를 정상 동작시킨다.
// ⚠ 교차 출처라 부모에서 프레임 내부 DOM 을 만질 수 없다. 채팅 접기·넓은 화면·
//   화질·음소거는 URL 쿼리로 신호를 주고 프레임 쪽 content.js 가 수행한다.
(() => {
  "use strict";

  const LAYOUTS = globalThis.CheeseMultiviewLayouts;
  const SETUP_PAGE = "multiview.html";
  // 고른 구성을 주소에 담기엔 길다. 세션 저장소로 넘기고 이 키로 읽는다.
  const HANDOFF_KEY = "cheeseMultiviewSetup";

  const $ = (id) => document.getElementById(id);
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

  const state = {
    chosen: [],
    layoutId: "",
    mainId: "",
    chatChannelId: "",
    chatSide: "",
    mainHighQuality: true,
  };

  // 프레임에 줄 URL. 팝업 플레이어와 같은 방식으로 쿼리에 지시를 담는다.
  function frameUrl(channel, isMain, mainHighQuality) {
    const url = new URL(
      `/live/${channel.channelId}`,
      "https://chzzk.naver.com",
    );
    url.searchParams.set("cheeseMulti", "1");
    url.searchParams.set("cheeseMultiMain", isMain ? "1" : "0");
    // 메인만 소리, 나머지는 음소거로 시작한다.
    url.searchParams.set("cheeseMultiMuted", isMain ? "0" : "1");
    // 화질: 기본 480p. 메인만 높은 화질을 쓰도록 골랐으면 메인은 지정하지 않는다
    // (프레임 쪽이 최대 화질 설정을 따른다).
    if (!(isMain && mainHighQuality)) {
      url.searchParams.set("cheeseMultiQuality", "480");
    }
    return url.toString();
  }

  function applyChat(channelId) {
    if (state.chatChannelId === channelId && $("mvChatFrame").src) return;
    state.chatChannelId = channelId;
    // 채팅 전용 페이지를 쓴다(/live/<id>/chat). 영상이 없는 화면이라 소리·화질을
    // 따로 억제할 필요가 없고, 라이브 페이지를 통째로 띄우는 것보다 훨씬 가볍다.
    const url = new URL(`/live/${channelId}/chat`, "https://chzzk.naver.com");
    url.searchParams.set("cheeseMultiChat", "1");
    $("mvChatFrame").src = url.toString();
  }

  // 칸(iframe)은 채널마다 하나씩 만들어 두고 배치가 바뀌어도 '자리'만 옮긴다.
  // ⚠ 다시 만들면 src 가 새로 걸려 방송이 처음부터 다시 로드된다. 메인 변경·배치
  //   변경은 화면을 재배치할 뿐이므로 기존 프레임을 그대로 살려 둔다.
  const cells = new Map(); // channelId -> .mv-cell 요소

  function ensureCells() {
    const frames = $("mvFrames");
    for (const channel of state.chosen) {
      if (cells.has(channel.channelId)) continue;
      const cell = document.createElement("div");
      cell.className = "mv-cell";
      cell.dataset.channelId = channel.channelId;
      // 칸이 이미 16:9 면(정확 배치) 상자는 칸을 그대로 꽉 채운다. 아닌 배치에서는
      // 상자가 16:9 를 지키고 남는 자리가 여백으로 남는다.
      const box = document.createElement("div");
      box.className = "mv-cell-inner";
      const frame = document.createElement("iframe");
      frame.src = frameUrl(
        channel,
        channel.channelId === state.mainId,
        state.mainHighQuality,
      );
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.title = `${channel.channelName} 방송`;
      frame.referrerPolicy = "origin";
      box.appendChild(frame);
      // 칸 안에서 바로 메인으로 올리는 버튼.
      const promote = document.createElement("button");
      promote.type = "button";
      promote.className = "mv-cell-main";
      promote.dataset.mvPromote = channel.channelId;
      promote.title = "이 채널을 메인으로";
      promote.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        '<rect width="18" height="18" x="3" y="3" rx="2"></rect>' +
        '<path d="M3 9h18"></path><path d="M9 21V9"></path></svg>' +
        "<span>메인으로</span>";
      cell.appendChild(box);
      cell.appendChild(promote);
      cells.set(channel.channelId, cell);
      frames.appendChild(cell);
    }
  }

  // 메인이 맨 앞에 오도록 정렬한 순서. 슬롯은 이 순서대로 붙인다.
  function orderedChannels() {
    const main = state.chosen.find((c) => c.channelId === state.mainId);
    const rest = state.chosen.filter((c) => c.channelId !== state.mainId);
    return main ? [main, ...rest] : state.chosen.slice();
  }

  function applyLayout() {
    const layout = LAYOUTS.layoutById(state.layoutId);
    if (!layout) return;
    const frames = $("mvFrames");
    // 레터박스를 없애려면 칸 자체가 16:9 여야 한다. 그렇게 되는 트랙 크기를 풀어
    // 쓰고, 격자 전체도 그때 필요한 가로:세로로 묶는다(남는 자리는 격자 바깥에서
    // 한 번만 생긴다). 해가 없는 배치(오른쪽+아래 등)는 기존 fr 값으로 돌아간다.
    const tracks = LAYOUTS.solveTracks(layout);
    frames.style.gridTemplateColumns = tracks ? tracks.columns : layout.columns;
    frames.style.gridTemplateRows = tracks ? tracks.rows : layout.rows;
    frames.style.gridTemplateAreas = layout.areas.join(" ");
    frames.style.setProperty("--mv-ratio", tracks ? String(tracks.ratio) : "");
    frames.classList.toggle("is-exact", Boolean(tracks));

    orderedChannels().forEach((channel, index) => {
      const cell = cells.get(channel.channelId);
      if (!cell) return;
      cell.style.gridArea = LAYOUTS.SLOTS[index];
      cell.classList.toggle("is-main", index === 0);
    });

    const { direction, side } = LAYOUTS.stageStyle(layout, state.chatSide);
    state.chatSide = side;
    const stage = $("mvStage");
    stage.style.flexDirection = direction;
    stage.dataset.chatSide = side;
    renderTopbar();
  }

  // 메인 변경: 소리와 화질 지시가 달라지므로 해당 두 프레임만 다시 건다.
  // ⚠ 나머지 프레임은 손대지 않는다(건드리면 방송이 다시 로드된다).
  function setMain(channelId) {
    if (channelId === state.mainId) return;
    const before = state.mainId;
    state.mainId = channelId;
    for (const id of [before, channelId]) {
      const channel = state.chosen.find((c) => c.channelId === id);
      const frame = cells.get(id)?.querySelector("iframe");
      if (!channel || !frame) continue;
      frame.src = frameUrl(channel, id === channelId, state.mainHighQuality);
    }
    applyLayout();
  }

  function setLayout(layoutId) {
    if (!LAYOUTS.layoutById(layoutId) || layoutId === state.layoutId) return;
    state.layoutId = layoutId;
    applyLayout();
  }

  function setChatSide(side) {
    const layout = LAYOUTS.layoutById(state.layoutId);
    if (!layout?.chat?.includes(side)) return;
    state.chatSide = side;
    applyLayout();
  }

  // ── 최상단 조작 막대 ───────────────────────────────────────────────────
  const SIDE_LABEL = {
    right: "오른쪽",
    left: "왼쪽",
    bottom: "아래",
    top: "위",
  };

  function channelName(id) {
    return state.chosen.find((c) => c.channelId === id)?.channelName || "-";
  }

  function optionRow(value, label, on, attr) {
    return (
      `<button type="button" role="option" aria-selected="${on}"` +
      ` class="mv-pop-option${on ? " is-on" : ""}" ${attr}="${esc(value)}">` +
      `${esc(label)}</button>`
    );
  }

  function renderTopbar() {
    const layout = LAYOUTS.layoutById(state.layoutId);
    $("mvMainValue").textContent = channelName(state.mainId);
    $("mvChatValue").textContent = channelName(state.chatChannelId);
    $("mvSideValue").textContent = SIDE_LABEL[state.chatSide] || "-";
    $("mvLayoutValue").textContent = layout?.label || "-";
    $("mvChatTitle").textContent = channelName(state.chatChannelId) + " 채팅";

    $("mvMainPanel").innerHTML = state.chosen
      .map((c) =>
        optionRow(
          c.channelId,
          c.channelName,
          c.channelId === state.mainId,
          "data-mv-set-main",
        ),
      )
      .join("");
    $("mvChatPanel").innerHTML = state.chosen
      .map((c) =>
        optionRow(
          c.channelId,
          c.channelName,
          c.channelId === state.chatChannelId,
          "data-mv-set-chat",
        ),
      )
      .join("");
    // 채팅 위치는 배치가 허용하는 자리만 보여 준다.
    $("mvSidePanel").innerHTML = (layout?.chat || [])
      .map((side) =>
        optionRow(
          side,
          SIDE_LABEL[side] || side,
          side === state.chatSide,
          "data-mv-set-side",
        ),
      )
      .join("");
    // 배치는 지금 채널 수에 맞는 것만.
    $("mvLayoutPanel").innerHTML = LAYOUTS.layoutsFor(state.chosen.length)
      .map((l) =>
        optionRow(l.id, l.label, l.id === state.layoutId, "data-mv-set-layout"),
      )
      .join("");
  }

  function closePopovers(except) {
    for (const pop of document.querySelectorAll("[data-mv-pop]")) {
      const name = pop.dataset.mvPop;
      if (name === except) continue;
      pop
        .querySelector("[data-mv-pop-toggle]")
        ?.setAttribute("aria-expanded", "false");
      const panel = pop.querySelector(".mv-pop-panel");
      if (panel) panel.hidden = true;
    }
  }

  function togglePopover(name) {
    const pop = document.querySelector(`[data-mv-pop="${name}"]`);
    if (!pop) return;
    const button = pop.querySelector("[data-mv-pop-toggle]");
    const panel = pop.querySelector(".mv-pop-panel");
    const open = panel.hidden;
    closePopovers(open ? name : null);
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function render(setup) {
    const layout = LAYOUTS.layoutById(setup.layoutId);
    if (!layout || !Array.isArray(setup.chosen) || setup.chosen.length < 2) {
      $("mvStage").hidden = true;
      $("mvWatchEmpty").hidden = false;
      return;
    }
    state.chosen = setup.chosen;
    state.layoutId = setup.layoutId;
    state.mainId = setup.chosen[0].channelId;
    state.chatChannelId = setup.chosen[0].channelId;
    state.chatSide = setup.chatSide || "";
    state.mainHighQuality = setup.mainHighQuality !== false;

    ensureCells();
    applyLayout();
    applyChat(state.chatChannelId);
    $("mvTopbar").hidden = false;
  }

  function backToSetup() {
    // ⚠ src 를 비워 프레임을 확실히 내린다. 그냥 이동하면 재생·소켓이 잠깐 더 산다.
    for (const frame of document.querySelectorAll("iframe")) {
      frame.src = "about:blank";
    }
    location.href = chrome.runtime.getURL(SETUP_PAGE);
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest?.("#mvBack")) {
      backToSetup();
      return;
    }
    // ⚠ 팝오버는 버튼(.mv-pop-button)을 눌렀을 때만 연다. 패널 안이나 그 주변을
    //   눌러서 열리면 안 된다.
    const toggle = target.closest?.(".mv-pop-button[data-mv-pop-toggle]");
    if (toggle) {
      togglePopover(toggle.dataset.mvPopToggle);
      return;
    }
    const setMainEl = target.closest?.("[data-mv-set-main]");
    if (setMainEl) {
      setMain(setMainEl.dataset.mvSetMain);
      closePopovers(null);
      return;
    }
    const promote = target.closest?.("[data-mv-promote]");
    if (promote) {
      setMain(promote.dataset.mvPromote);
      return;
    }
    const setChatEl = target.closest?.("[data-mv-set-chat]");
    if (setChatEl) {
      applyChat(setChatEl.dataset.mvSetChat);
      renderTopbar();
      closePopovers(null);
      return;
    }
    const setSideEl = target.closest?.("[data-mv-set-side]");
    if (setSideEl) {
      setChatSide(setSideEl.dataset.mvSetSide);
      closePopovers(null);
      return;
    }
    const setLayoutEl = target.closest?.("[data-mv-set-layout]");
    if (setLayoutEl) {
      setLayout(setLayoutEl.dataset.mvSetLayout);
      closePopovers(null);
      return;
    }
    if (target.closest?.("#mvChatToggle")) {
      const stage = $("mvStage");
      const folded = stage.classList.toggle("is-chat-folded");
      const button = $("mvChatToggle");
      button.textContent = folded ? "펴기" : "접기";
      button.setAttribute("aria-label", folded ? "채팅 펴기" : "채팅 접기");
      return;
    }
    // 패널 안의 빈 곳을 누른 게 아니면(=바깥) 열린 팝오버를 닫는다.
    if (!target.closest?.(".mv-pop-panel")) closePopovers(null);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopovers(null);
  });

  (async () => {
    let setup = null;
    try {
      const d = await chrome.storage.session.get(HANDOFF_KEY);
      setup = d?.[HANDOFF_KEY] || null;
    } catch {}
    if (!setup) {
      $("mvStage").hidden = true;
      $("mvWatchEmpty").hidden = false;
      return;
    }
    render(setup);
  })();
})();
