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
  // 고른 구성을 주소에 담기엔 길다. 세션 저장소로 넘기고 이 id 로 읽는다.
  // ⚠ 고정 키를 쓰면 멀티뷰 탭을 두 개 열었을 때 서로 구성을 덮어쓴다. 탭마다
  //   다른 id 를 주소로 받아 그 키만 읽는다.
  const HANDOFF_PREFIX = "cheeseMultiviewSetup";
  const MULTIVIEW_MESSAGE = "cheese-platter-multiview";
  const CHZZK_ORIGIN = "https://chzzk.naver.com";
  const HASH_RE = /^[0-9a-f]{32}$/i;
  // 프레임이 준비됐다고 알려 오기를 기다리는 시간. 넘으면 다시 불러오기 안내를 띄운다.
  const FRAME_READY_TIMEOUT_MS = 20000;
  // 4개 이상일 때만 아주 짧게 시차를 준다. 동시에 6개를 붙이면 초기 요청이 몰린다.
  const FRAME_STAGGER_MS = 100;
  const FRAME_STAGGER_MIN_COUNT = 4;

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
    handoffId: "",
    chosen: [],
    layoutId: "",
    mainId: "",
    chatChannelId: "",
    chatSide: "",
    mainHighQuality: true,
  };

  // 프레임 '처음 주소'. 여기 담는 건 시작 상태일 뿐이고, 이후 변경은 postMessage 로
  // 보낸다(주소를 다시 넣으면 방송이 처음부터 로드된다).
  function frameUrl(channel, isMain, mainHighQuality) {
    const url = new URL(`/live/${channel.channelId}`, CHZZK_ORIGIN);
    url.searchParams.set("cheeseMulti", "1");
    url.searchParams.set("cheeseMultiMain", isMain ? "1" : "0");
    // 메인만 소리, 나머지는 음소거로 시작한다.
    url.searchParams.set("cheeseMultiMuted", isMain ? "0" : "1");
    // 화질: 보조는 480p 상한. 메인을 높은 화질로 고른 경우엔 상한을 걸지 않는다
    // (프레임 쪽이 사용자의 최대 화질 설정을 따른다).
    //
    // ⚠ 360p 는 넣지 않는다. 치지직 화질 목록에 실제로 있는지 이 코드만으로
    //   확인할 수 없어, 없는 값을 상한으로 주면 '이하 중 최고' 규칙이 가장 낮은
    //   트랙으로 떨어뜨린다. 480p 가 확인된 값이라 채널 수와 무관하게 이것만 쓴다.
    if (!(isMain && mainHighQuality)) {
      url.searchParams.set("cheeseMultiQuality", "480");
    }
    return url.toString();
  }

  // 프레임에 상태를 지시한다. src 를 건드리지 않으므로 방송이 다시 로드되지 않는다.
  function postState(channelId, isMain) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_MESSAGE,
          type: "SET_MULTIVIEW_STATE",
          channelId,
          muted: !isMain,
          quality: isMain && state.mainHighQuality ? "high" : "480",
        },
        CHZZK_ORIGIN,
      );
    } catch {}
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

  // 프레임 상태 관리. 준비 신호가 제때 안 오면 '다시 불러오기' 를 띄운다.
  const frameTimers = new Map(); // channelId -> timeout id

  function setCellStatus(channelId, status, message) {
    const cell = cells.get(channelId);
    if (!cell) return;
    const overlay = cell.querySelector(".mv-cell-status");
    if (!overlay) return;
    cell.dataset.status = status;
    if (status === "ready") {
      overlay.hidden = true;
      overlay.innerHTML = "";
      return;
    }
    overlay.hidden = false;
    if (status === "loading") {
      overlay.innerHTML =
        '<span class="mv-cell-status-text">불러오는 중…</span>';
      return;
    }
    // 실패: 사용자가 직접 눌렀을 때만 다시 불러온다(자동 반복 금지).
    overlay.innerHTML =
      `<span class="mv-cell-status-text">${esc(message || "플레이어를 불러오지 못했습니다.")}</span>` +
      `<button type="button" class="mv-cell-retry" data-mv-retry="${esc(channelId)}">다시 불러오기</button>`;
  }

  function armReadyTimeout(channelId) {
    clearTimeout(frameTimers.get(channelId));
    frameTimers.set(
      channelId,
      setTimeout(() => {
        // 아직 준비 신호를 못 받았을 때만 실패로 본다.
        if (cells.get(channelId)?.dataset.status !== "ready") {
          setCellStatus(channelId, "error", "플레이어를 불러오지 못했습니다.");
        }
      }, FRAME_READY_TIMEOUT_MS),
    );
  }

  // 소리 켜기가 막혔을 때의 안내(자동재생 정책). 사용자가 누르면 다시 지시한다.
  function showAudioNotice(channelId) {
    const cell = cells.get(channelId);
    if (!cell || channelId !== state.mainId) return;
    if (cell.querySelector("[data-mv-unmute]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mv-cell-unmute";
    button.dataset.mvUnmute = channelId;
    button.textContent = "소리를 켜려면 클릭";
    cell.appendChild(button);
  }

  function clearAudioNotice(channelId) {
    cells.get(channelId)?.querySelector("[data-mv-unmute]")?.remove();
  }

  // 사용자가 명시적으로 눌렀을 때만 해당 프레임을 다시 불러온다.
  function reloadFrame(channelId) {
    const channel = state.chosen.find((c) => c.channelId === channelId);
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!channel || !frame) return;
    setCellStatus(channelId, "loading");
    frame.src = frameUrl(
      channel,
      channelId === state.mainId,
      state.mainHighQuality,
    );
    armReadyTimeout(channelId);
  }

  function ensureCells() {
    const frames = $("mvFrames");
    const ordered = orderedChannels();
    // 4개 이상이면 아주 짧은 시차를 준다. 6개를 한 번에 붙이면 초기 요청이 몰려
    // CPU·네트워크가 튄다. 2~3개는 체감될 만큼 느려지지 않도록 시차를 두지 않는다.
    const stagger =
      ordered.length >= FRAME_STAGGER_MIN_COUNT ? FRAME_STAGGER_MS : 0;
    ordered.forEach((channel, index) => {
      if (cells.has(channel.channelId)) return;
      const isMain = channel.channelId === state.mainId;
      const cell = document.createElement("div");
      cell.className = "mv-cell";
      cell.dataset.channelId = channel.channelId;
      cell.dataset.status = "loading";
      // 칸이 이미 16:9 면(정확 배치) 상자는 칸을 그대로 꽉 채운다. 아닌 배치에서는
      // 상자가 16:9 를 지키고 남는 자리가 여백으로 남는다.
      const box = document.createElement("div");
      box.className = "mv-cell-inner";
      const frame = document.createElement("iframe");
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.title = `${channel.channelName} 방송`;
      frame.referrerPolicy = "origin";
      box.appendChild(frame);

      const overlay = document.createElement("div");
      overlay.className = "mv-cell-status";

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
      cell.appendChild(overlay);
      cell.appendChild(promote);
      cells.set(channel.channelId, cell);
      frames.appendChild(cell);
      setCellStatus(channel.channelId, "loading");

      const src = frameUrl(channel, isMain, state.mainHighQuality);
      const delay = stagger * index;
      if (delay) setTimeout(() => (frame.src = src), delay);
      else frame.src = src;
      armReadyTimeout(channel.channelId);
    });
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

  // 메인 변경: 소리·화질 지시만 바꾼다.
  // ⚠ iframe src 를 절대 다시 넣지 않는다. 넣으면 치지직 페이지가 통째로 다시 로드돼
  //   방송이 처음부터 시작된다. 상태만 postMessage 로 보내고 프레임은 그대로 둔다.
  function setMain(channelId) {
    if (channelId === state.mainId || !cells.has(channelId)) return;
    const before = state.mainId;
    state.mainId = channelId;
    if (before) postState(before, false);
    postState(channelId, true);
    clearAudioNotice(channelId);
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

  function showEmpty() {
    $("mvStage").hidden = true;
    $("mvTopbar").hidden = true;
    $("mvWatchEmpty").hidden = false;
  }

  function render(setup) {
    state.chosen = setup.chosen;
    state.layoutId = setup.layoutId;
    state.mainId = setup.chosen[0].channelId;
    state.chatChannelId = setup.chosen[0].channelId;
    state.chatSide = setup.chatSide;
    state.mainHighQuality = setup.mainHighQuality;

    ensureCells();
    applyLayout();
    applyChat(state.chatChannelId);
    $("mvTopbar").hidden = false;
  }

  // 세션에서 읽은 구성을 그대로 믿지 않는다. 형태가 어긋나면 고칠 수 있는 건 고치고,
  // 못 고치면 null 을 돌려 빈 화면 안내를 띄운다.
  function validateSetup(raw) {
    if (!raw || typeof raw !== "object") return null;
    const seen = new Set();
    const chosen = (Array.isArray(raw.chosen) ? raw.chosen : [])
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        channelId: String(c.channelId || "").toLowerCase(),
        channelName: String(c.channelName ?? ""),
        channelImageUrl: String(c.channelImageUrl ?? ""),
      }))
      .filter((c) => {
        if (!HASH_RE.test(c.channelId) || seen.has(c.channelId)) return false;
        seen.add(c.channelId);
        return true;
      })
      .slice(0, 6);
    if (chosen.length < 2) return null;

    // 배치는 '지금 채널 수에 허용되는 것' 중에서만 고른다. 어긋나면 첫 배치로.
    const allowed = LAYOUTS.layoutsFor(chosen.length);
    if (!allowed.length) return null;
    const layout = allowed.find((l) => l.id === raw.layoutId) || allowed[0];
    // 채팅 자리도 그 배치가 허용하는 값만.
    const chatSide = layout.chat?.includes(raw.chatSide)
      ? raw.chatSide
      : layout.chat?.[0] || "right";
    return {
      chosen,
      layoutId: layout.id,
      chatSide,
      mainHighQuality: raw.mainHighQuality !== false,
    };
  }

  async function backToSetup() {
    // 지금 구성을 그대로 되돌려 준다. 고르기 화면이 이 id 를 읽어 선택을 복원한다.
    if (state.handoffId) {
      try {
        await chrome.storage.session.set({
          [`${HANDOFF_PREFIX}:${state.handoffId}`]: {
            chosen: state.chosen,
            layoutId: state.layoutId,
            chatSide: state.chatSide,
            mainHighQuality: state.mainHighQuality,
          },
        });
      } catch {}
    }
    // ⚠ src 를 비워 프레임을 확실히 내린다. 그냥 이동하면 재생·소켓이 잠깐 더 산다.
    for (const frame of document.querySelectorAll("iframe")) {
      frame.src = "about:blank";
    }
    const url = new URL(chrome.runtime.getURL(SETUP_PAGE));
    if (state.handoffId) url.searchParams.set("setup", state.handoffId);
    location.href = url.toString();
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest?.("#mvBack")) {
      void backToSetup();
      return;
    }
    const retry = target.closest?.("[data-mv-retry]");
    if (retry) {
      // 사용자가 직접 누른 경우에만 다시 불러온다(자동 반복 없음).
      reloadFrame(retry.dataset.mvRetry);
      return;
    }
    const unmute = target.closest?.("[data-mv-unmute]");
    if (unmute) {
      const id = unmute.dataset.mvUnmute;
      clearAudioNotice(id);
      postState(id, id === state.mainId);
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
      // ⚠ 채팅 접기 = UI 만 숨김. iframe 은 그대로 살아 있어 채팅 연결도 유지된다.
      //   src 를 비우면 다시 펼 때 채팅이 재연결돼 그동안의 대화를 놓친다.
      //   연결까지 끊는 '채팅 끄기' 가 필요하면 별도 동작으로 나눈다.
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

  // 프레임이 보내는 상태 신호. 치지직 출처에서 온 것만 받는다.
  window.addEventListener("message", (event) => {
    if (event.origin !== CHZZK_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== MULTIVIEW_MESSAGE) return;
    const channelId = String(data.channelId || "").toLowerCase();
    if (!HASH_RE.test(channelId) || !cells.has(channelId)) return;
    if (data.type === "FRAME_READY") {
      clearTimeout(frameTimers.get(channelId));
      frameTimers.delete(channelId);
      setCellStatus(channelId, "ready");
      return;
    }
    if (data.type === "AUDIO_INTERACTION_REQUIRED") {
      showAudioNotice(channelId);
    }
  });

  (async () => {
    // 주소로 받은 id 에 해당하는 구성만 읽는다(탭마다 다르다).
    const handoffId = new URLSearchParams(location.search).get("setup") || "";
    if (!/^[A-Za-z0-9-]{1,64}$/.test(handoffId)) {
      showEmpty();
      return;
    }
    const key = `${HANDOFF_PREFIX}:${handoffId}`;
    let stored = null;
    try {
      const d = await chrome.storage.session.get(key);
      stored = d?.[key] || null;
    } catch {}
    const setup = validateSetup(stored);
    if (!setup) {
      showEmpty();
      return;
    }
    state.handoffId = handoffId;
    render(setup);
  })();
})();
