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
    // 메인을 바꾸면 채팅도 따라 바꿀지(기본 켜짐).
    chatFollowsMain: true,
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

  // 채팅 칸에 지금 테마를 알린다. 프레임이 준비됐다고 알려 올 때와 테마를 바꿀 때
  // 보낸다(교차 출처라 부모가 그 안의 html 을 직접 만질 수 없다).
  function postChatView() {
    const frame = $("mvChatFrame");
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_MESSAGE,
          type: "SET_MULTIVIEW_CHAT_VIEW",
          dark: document.documentElement.dataset.theme === "dark",
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  // 테마 단추는 multiviewTheme.js 가 다룬다. 바뀌면 채팅 칸에도 알린다.
  new MutationObserver(postChatView).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

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
      // 자리 바꾸기는 칸 머리의 손잡이로만 시작한다(영상 위 드래그와 겹치지 않게).
      cell.draggable = false;
      // 칸이 이미 16:9 면(정확 배치) 상자는 칸을 그대로 꽉 채운다. 아닌 배치에서는
      // 상자가 16:9 를 지키고 남는 자리가 여백으로 남는다.
      const box = document.createElement("div");
      box.className = "mv-cell-inner";
      const frame = document.createElement("iframe");
      // 이 프레임에 허용할 기능. 대상 출처를 명시(*)해 치지직 안에서도 살아 있게 한다.
      // ⚠ 채팅 접기·넓은 화면은 이것과 무관하다. 그 둘은 프레임 안에서 치지직의
      //   버튼을 누르는 방식이라 DOM 준비 시점 문제이지 권한 문제가 아니다.
      frame.allow =
        "autoplay *; fullscreen *; encrypted-media *; picture-in-picture *";
      frame.title = `${channel.channelName} 방송`;
      frame.referrerPolicy = "origin";
      box.appendChild(frame);

      const overlay = document.createElement("div");
      overlay.className = "mv-cell-status";

      // 자리 바꾸기 손잡이.
      // ⚠ iframe 은 교차 출처라 그 위에서 시작한 드래그 이벤트가 부모로 오지 않는다.
      //   그래서 칸 위에 얹은 이 손잡이에서만 드래그를 시작한다.
      const grip = document.createElement("div");
      grip.className = "mv-cell-grip";
      grip.draggable = true;
      grip.title = "끌어서 자리 바꾸기";
      grip.setAttribute("aria-label", `${channel.channelName} 자리 바꾸기`);
      grip.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" ' +
        'aria-hidden="true"><circle cx="9" cy="6" r="1.6"></circle>' +
        '<circle cx="15" cy="6" r="1.6"></circle>' +
        '<circle cx="9" cy="12" r="1.6"></circle>' +
        '<circle cx="15" cy="12" r="1.6"></circle>' +
        '<circle cx="9" cy="18" r="1.6"></circle>' +
        '<circle cx="15" cy="18" r="1.6"></circle></svg>';

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
      cell.appendChild(grip);
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
  //
  // ⚠ 그래도 '메인만 고화질' 을 켜 두면 전환이 느리게 느껴진다. 480p ↔ 고화질로
  //   해상도가 바뀌면 치지직 플레이어가 스트림을 다시 잡기 때문이다(재로드가 아니라
  //   화질 전환 자체의 비용). 화질을 그대로 두면 음소거만 바뀌어 즉시 전환된다.
  function setMain(channelId) {
    if (channelId === state.mainId || !cells.has(channelId)) return;
    const before = state.mainId;
    state.mainId = channelId;
    if (before) postState(before, false);
    postState(channelId, true);
    clearAudioNotice(channelId);
    // 메인을 따라가도록 해 뒀으면 채팅도 같이 옮긴다.
    if (state.chatFollowsMain) applyChat(channelId);
    applyLayout();
  }

  function setLayout(layoutId) {
    if (!LAYOUTS.layoutById(layoutId) || layoutId === state.layoutId) return;
    state.layoutId = layoutId;
    applyLayout();
  }

  function setChatSide(side) {
    if (!LAYOUTS.CHAT_SIDES.includes(side)) return;
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
    // 채팅 위치는 배치와 무관하게 셋 다 고를 수 있다.
    $("mvSidePanel").innerHTML = LAYOUTS.CHAT_SIDES.map((side) =>
      optionRow(
        side,
        SIDE_LABEL[side] || side,
        side === state.chatSide,
        "data-mv-set-side",
      ),
    ).join("");
    // 배치는 지금 채널 수에 맞는 것만. 이름만으로는 모양이 안 그려지므로 작은
    // 미리보기를 함께 둔다(고르기 화면과 같은 트랙 계산을 쓴다).
    $("mvLayoutPanel").innerHTML = LAYOUTS.layoutsFor(state.chosen.length)
      .map((l) => {
        const on = l.id === state.layoutId;
        const tracks = LAYOUTS.solveTracks(l);
        const columns = tracks ? tracks.columns : l.columns;
        const rows = tracks ? tracks.rows : l.rows;
        return (
          `<button type="button" role="option" aria-selected="${on}"` +
          ` class="mv-pop-option mv-pop-option-layout${on ? " is-on" : ""}"` +
          ` data-mv-set-layout="${esc(l.id)}">` +
          `<span class="mv-layout-preview" style="grid-template-columns:${esc(columns)};` +
          `grid-template-rows:${esc(rows)};` +
          `aspect-ratio:${tracks ? esc(String(tracks.ratio)) : "16/9"};` +
          `grid-template-areas:${esc(l.areas.join(" "))}">` +
          LAYOUTS.SLOTS.slice(0, l.aux + 1)
            .map(
              (slot) =>
                `<i style="grid-area:${slot}"${slot === "m" ? ' class="is-main"' : ""}></i>`,
            )
            .join("") +
          `</span><span class="mv-pop-option-label">${esc(l.label)}</span></button>`
        );
      })
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
    restoreChatSize();
    bindChatResize();
    bindCellDrag();
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
    // 채팅 자리는 셋 중 하나면 된다(배치가 제한하지 않는다).
    const chatSide = LAYOUTS.CHAT_SIDES.includes(raw.chatSide)
      ? raw.chatSide
      : layout.chat?.[0] || "right";
    return {
      chosen,
      layoutId: layout.id,
      chatSide,
      mainHighQuality: raw.mainHighQuality !== false,
    };
  }

  // ── 칸 끌어서 자리 바꾸기 ─────────────────────────────────────────────────
  // 두 칸의 순서를 맞바꾼다. applyLayout 이 gridArea 만 다시 매기므로 프레임은
  // 그대로 살아 있다(다시 만들면 방송이 처음부터 로드된다).
  //
  // ⚠ 맨 앞이 메인이다. 메인 자리로 끌어다 놓으면 그 채널이 메인이 되며, 그때만
  //   소리·화질 지시를 다시 보낸다.
  function swapCells(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const order = orderedChannels();
    const from = order.findIndex((c) => c.channelId === fromId);
    const to = order.findIndex((c) => c.channelId === toId);
    if (from < 0 || to < 0) return;
    [order[from], order[to]] = [order[to], order[from]];
    state.chosen = order;
    const nextMain = order[0].channelId;
    if (nextMain !== state.mainId) setMain(nextMain);
    else applyLayout();
  }

  function bindCellDrag() {
    const frames = $("mvFrames");
    if (!frames || frames.dataset.dragBound === "1") return;
    frames.dataset.dragBound = "1";
    let dragId = "";

    frames.addEventListener("dragstart", (event) => {
      // 손잡이에서 시작한 것만 받는다.
      if (!event.target.closest?.(".mv-cell-grip")) return;
      const cell = event.target.closest?.(".mv-cell");
      if (!cell) return;
      dragId = cell.dataset.channelId || "";
      event.dataTransfer.effectAllowed = "move";
      // ⚠ iframe 위에서 시작한 드래그는 기본 이미지가 비어 보인다. 칸을 지정한다.
      event.dataTransfer.setDragImage?.(cell, 20, 20);
      cell.classList.add("is-dragging");
      // 끄는 동안만 프레임이 포인터를 먹지 않게 한다(위 CSS 주석 참고).
      frames.classList.add("is-dragging");
    });
    frames.addEventListener("dragover", (event) => {
      if (!dragId) return;
      const over = event.target.closest?.(".mv-cell");
      if (!over || over.dataset.channelId === dragId) return;
      event.preventDefault();
      over.classList.add("is-drop-target");
    });
    frames.addEventListener("dragleave", (event) => {
      event.target.closest?.(".mv-cell")?.classList.remove("is-drop-target");
    });
    frames.addEventListener("drop", (event) => {
      const over = event.target.closest?.(".mv-cell");
      if (!dragId || !over) return;
      event.preventDefault();
      swapCells(dragId, over.dataset.channelId);
      dragId = "";
    });
    // ⚠ 엉뚱한 곳에 놓거나 취소해도 여기로는 반드시 온다. 표시를 확실히 지운다.
    frames.addEventListener("dragend", () => {
      dragId = "";
      frames.classList.remove("is-dragging");
      for (const cell of frames.querySelectorAll(".mv-cell")) {
        cell.classList.remove("is-dragging", "is-drop-target");
      }
    });
  }

  // ── 채팅 크기 조절 ───────────────────────────────────────────────────────
  // ⚠ 끄는 동안 프레임은 그대로다. 칸 크기만 다시 계산되고 16:9 는 CSS 가 지킨다.
  // ⚠ 치지직 채팅 컨테이너는 min-width:353px 이다(실측). 프레임 쪽에서 그 제한을
  //   풀어 주므로 여기서는 읽기 편한 최소치만 지킨다.
  const CHAT_MIN = 260;
  const CHAT_MAX_RATIO = 0.6; // 화면의 60% 를 넘지 않게
  const CHAT_SIZE_KEY = "cheeseMultiviewChatSize";

  function applyChatSize(px) {
    const stage = $("mvStage");
    const vertical = state.chatSide === "bottom" || state.chatSide === "top";
    const limit =
      (vertical ? stage.clientHeight : stage.clientWidth) * CHAT_MAX_RATIO;
    const size = Math.round(
      Math.max(CHAT_MIN, Math.min(px, Math.max(CHAT_MIN, limit))),
    );
    stage.style.setProperty(
      vertical ? "--mv-chat-h" : "--mv-chat-w",
      `${size}px`,
    );
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_SIZE_KEY) || "{}");
      saved[vertical ? "h" : "w"] = size;
      localStorage.setItem(CHAT_SIZE_KEY, JSON.stringify(saved));
    } catch {}
  }

  function restoreChatSize() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAT_SIZE_KEY) || "{}");
      const stage = $("mvStage");
      if (Number(saved.w) > 0) {
        stage.style.setProperty("--mv-chat-w", `${Number(saved.w)}px`);
      }
      if (Number(saved.h) > 0) {
        stage.style.setProperty("--mv-chat-h", `${Number(saved.h)}px`);
      }
    } catch {}
  }

  function bindChatResize() {
    const handle = $("mvChatResize");
    if (!handle) return;
    let dragging = false;

    const sizeFromPointer = (event) => {
      const rect = $("mvChat").getBoundingClientRect();
      // 손잡이 반대쪽 모서리에서 포인터까지가 새 크기다. 채팅이 어느 쪽에 있든
      // 이 계산이면 맞는다(오른쪽이면 오른 모서리 기준, 왼쪽이면 왼 모서리 기준).
      switch (state.chatSide) {
        case "left":
          return event.clientX - rect.left;
        case "bottom":
          return rect.bottom - event.clientY;
        case "top":
          return event.clientY - rect.top;
        default:
          return rect.right - event.clientX;
      }
    };

    handle.addEventListener("pointerdown", (event) => {
      dragging = true;
      handle.classList.add("is-dragging");
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      applyChatSize(sizeFromPointer(event));
    });
    const stop = (event) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("is-dragging");
      handle.releasePointerCapture?.(event.pointerId);
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);

    // 키보드로도 조절할 수 있게 한다(손잡이에 초점이 있을 때).
    handle.addEventListener("keydown", (event) => {
      const vertical = state.chatSide === "bottom" || state.chatSide === "top";
      const dec = vertical ? "ArrowUp" : "ArrowLeft";
      const inc = vertical ? "ArrowDown" : "ArrowRight";
      if (event.key !== dec && event.key !== inc) return;
      const rect = $("mvChat").getBoundingClientRect();
      const now = vertical ? rect.height : rect.width;
      applyChatSize(now + (event.key === inc ? 20 : -20));
      event.preventDefault();
    });
  }

  // ── 빠른 채널 바꾸기 ─────────────────────────────────────────────────────
  // 격자 위아래 남는 자리에 띄운다. 고르기 화면까지 가지 않고 빼기·바꾸기를 한다.
  //
  // ⚠ 채널을 빼도 남은 칸은 다시 만들지 않는다(만들면 방송이 처음부터 로드된다).
  //   빠진 칸만 지우고 배치를 새 채널 수에 맞는 것으로 바꾼다.
  let quickCandidates = null;

  function openQuick() {
    $("mvQuick").hidden = false;
    renderQuick();
    void loadQuickCandidates();
  }

  function closeQuick() {
    $("mvQuick").hidden = true;
  }

  function renderQuick() {
    const min = 2;
    $("mvQuickHint").textContent = `${state.chosen.length} / 6`;
    $("mvQuickCurrent").innerHTML = state.chosen
      .map((c) => {
        const isMain = c.channelId === state.mainId;
        return (
          `<li class="mv-quick-item${isMain ? " is-main" : ""}">` +
          `<span class="mv-quick-name">${esc(c.channelName)}</span>` +
          (isMain ? `<span class="mv-quick-tag">메인</span>` : "") +
          `<button type="button" class="mv-quick-drop" data-mv-quick-drop="${esc(c.channelId)}"` +
          `${state.chosen.length <= min ? " disabled" : ""}` +
          ` aria-label="${esc(c.channelName)} 빼기">×</button></li>`
        );
      })
      .join("");

    const box = $("mvQuickAdd");
    if (quickCandidates === null) {
      box.innerHTML = '<p class="mv-quick-empty">불러오는 중…</p>';
      return;
    }
    const have = new Set(state.chosen.map((c) => c.channelId));
    const rest = quickCandidates.filter((r) => !have.has(r.channelId));
    if (!rest.length) {
      box.innerHTML = '<p class="mv-quick-empty">추가할 채널이 없습니다.</p>';
      return;
    }
    const full = state.chosen.length >= 6;
    box.innerHTML = rest
      .slice(0, 24)
      .map(
        (r) =>
          `<button type="button" class="mv-quick-pick" data-mv-quick-add="${esc(r.channelId)}"` +
          `${full ? " disabled" : ""} title="${esc(r.channelName)}">` +
          `<span class="mv-quick-name">${esc(r.channelName)}</span></button>`,
      )
      .join("");
  }

  // 후보는 팔로잉 목록에서 가져온다(고르기 화면과 같은 중계 경로).
  async function loadQuickCandidates() {
    if (quickCandidates !== null) return;
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "MULTIVIEW_API",
        url: "https://api.chzzk.naver.com/service/v1/channels/following-lives?sortType=POPULAR",
      });
      const c = reply?.ok ? reply.content : null;
      const rows = Array.isArray(c?.followingList)
        ? c.followingList
        : Array.isArray(c?.data)
          ? c.data
          : [];
      quickCandidates = rows
        .map((r) => ({
          channelId: String(
            r?.channelId || r?.channel?.channelId || "",
          ).toLowerCase(),
          channelName: String(r?.channel?.channelName || "").trim(),
        }))
        .filter((r) => HASH_RE.test(r.channelId) && r.channelName);
    } catch {
      quickCandidates = [];
    }
    renderQuick();
  }

  // 채널 빼기: 그 칸만 지우고 남은 칸은 그대로 둔다.
  function dropChannel(channelId) {
    if (state.chosen.length <= 2) return;
    const cell = cells.get(channelId);
    if (!cell) return;
    // 이 칸의 프레임만 확실히 내린다.
    const frame = cell.querySelector("iframe");
    if (frame) frame.src = "about:blank";
    cell.remove();
    cells.delete(channelId);
    clearTimeout(frameTimers.get(channelId));
    frameTimers.delete(channelId);
    state.chosen = state.chosen.filter((c) => c.channelId !== channelId);

    // 메인이 빠졌으면 남은 첫 채널을 메인으로 올린다.
    if (state.mainId === channelId) {
      state.mainId = state.chosen[0]?.channelId || "";
      if (state.mainId) postState(state.mainId, true);
      if (state.chatFollowsMain && state.mainId) applyChat(state.mainId);
    }
    if (state.chatChannelId === channelId && state.mainId) {
      applyChat(state.mainId);
    }
    fitLayoutToCount();
    renderQuick();
  }

  // 채널 더하기: 새 칸만 만든다(기존 칸은 건드리지 않는다).
  function addChannel(channelId) {
    if (state.chosen.length >= 6) return;
    const found = quickCandidates?.find((r) => r.channelId === channelId);
    if (!found || cells.has(channelId)) return;
    state.chosen = [...state.chosen, { ...found, channelImageUrl: "" }];
    fitLayoutToCount();
    ensureCells(); // 새로 들어온 채널의 칸만 만든다
    applyLayout();
    renderQuick();
  }

  // 채널 수가 바뀌면 그 수에 맞는 배치로 갈아탄다(지금 배치를 쓸 수 없으면 첫 배치).
  function fitLayoutToCount() {
    const allowed = LAYOUTS.layoutsFor(state.chosen.length);
    if (!allowed.length) return;
    if (!allowed.some((l) => l.id === state.layoutId)) {
      state.layoutId = allowed[0].id;
    }
    applyLayout();
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
      // 먼저 빠른 바꾸기를 연다. 전체를 다시 고르려면 그 안의 단추로 간다.
      if ($("mvQuick").hidden) openQuick();
      else closeQuick();
      return;
    }
    if (target.closest?.("#mvQuickClose")) {
      closeQuick();
      return;
    }
    if (target.closest?.("#mvQuickAll")) {
      void backToSetup();
      return;
    }
    const drop = target.closest?.("[data-mv-quick-drop]");
    if (drop) {
      dropChannel(drop.dataset.mvQuickDrop);
      return;
    }
    const add = target.closest?.("[data-mv-quick-add]");
    if (add) {
      addChannel(add.dataset.mvQuickAdd);
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
    if (target.closest?.("#mvChatFollow")) {
      state.chatFollowsMain = !state.chatFollowsMain;
      const button = $("mvChatFollow");
      button.setAttribute("aria-pressed", String(state.chatFollowsMain));
      // 켠 순간 이미 어긋나 있으면 바로 맞춰 준다.
      if (state.chatFollowsMain) applyChat(state.mainId);
      renderTopbar();
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
    if (event.key !== "Escape") return;
    closePopovers(null);
    closeQuick();
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

  // 채팅 칸이 준비되면 테마를 보낸다(채널을 바꿔 새로 뜰 때마다 온다).
  window.addEventListener("message", (event) => {
    if (event.origin !== CHZZK_ORIGIN) return;
    const data = event.data;
    if (data?.source !== MULTIVIEW_MESSAGE) return;
    if (data.type !== "CHAT_FRAME_READY") return;
    postChatView();
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
