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
    // 전체 볼륨(0~1). 채널별 볼륨 위에 곱해지는 값이다.
    masterVolume: 1,
    // '메인 채널만 소리'(기본 켜짐). 기존 정책과 같다.
    audioFocusMode: true,
  };

  // 채널별 소리 설정. { volume: 0~1, muted: boolean }
  // ⚠ focus mode 를 껐다 켜도 사용자가 맞춰 둔 volume 은 지우지 않는다. 껐을 때
  //   이전 믹스를 그대로 되찾을 수 있어야 한다.
  const channelAudio = new Map();

  function audioOf(channelId) {
    let entry = channelAudio.get(channelId);
    if (!entry) {
      entry = { volume: 1, muted: channelId !== state.mainId };
      channelAudio.set(channelId, entry);
    }
    return entry;
  }

  // 이 채널이 지금 실제로 소리를 내야 하는가.
  // focus mode 가 켜져 있으면 메인만 낸다(채널별 muted 는 건드리지 않고 덮어쓴다).
  function effectiveMuted(channelId) {
    if (state.audioFocusMode) return channelId !== state.mainId;
    return audioOf(channelId).muted;
  }

  // 실제로 내보낼 크기 = 전체 볼륨 × 채널 볼륨.
  function effectiveVolume(channelId) {
    const v = state.masterVolume * audioOf(channelId).volume;
    return Math.min(1, Math.max(0, v));
  }

  // 프레임 '처음 주소'. 여기 담는 건 시작 상태일 뿐이고, 이후 변경은 postMessage 로
  // 보낸다(주소를 다시 넣으면 방송이 처음부터 로드된다).
  // 칸마다 마지막으로 지시한 화질. 통계 표의 '정책' 열과 진단 기록에 쓴다.
  // ⚠ frameUrl 이 처음 만들 때부터 기록하므로 그보다 먼저 선언해 둔다.
  const lastQuality = new Map();

  function frameUrl(channel, isMain, mainHighQuality) {
    // 처음 주소에 담는 화질도 '우리가 지시한 정책' 이다. 여기서 기록해 두어야
    // 통계 표의 정책 열이 첫 화면부터 맞는다(postState 는 프레임이 준비된 뒤에야
    // 불린다).
    lastQuality.set(
      channel.channelId,
      isMain && mainHighQuality ? "high" : "480",
    );
    const url = new URL(`/live/${channel.channelId}`, CHZZK_ORIGIN);
    url.searchParams.set("cheeseMulti", "1");
    url.searchParams.set("cheeseMultiMain", isMain ? "1" : "0");
    // 메인만 소리, 나머지는 음소거로 시작한다.
    url.searchParams.set("cheeseMultiMuted", isMain ? "0" : "1");
    // 화질은 '지금 이 칸의 역할' 로 정한다(시작할 때만이 아니다). 메인이면 상한을
    // 걸지 않고, 보조면 480p 상한을 건다. 메인이 바뀌면 두 칸 모두 다시 지시한다.
    // 채널별로 화질을 기억해 두지 않는다 — 역할이 기준이다.
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
  //
  // ⚠ isMain 은 '화질' 만 정한다. 음소거·크기는 소리 설정에서 계산한다 —
  //   focus mode 를 끄면 보조 채널도 소리를 낼 수 있어야 하기 때문이다.
  function postState(channelId, isMain) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    const quality = isMain && state.mainHighQuality ? "high" : "480";
    const before = lastQuality.get(channelId);
    if (before !== quality) {
      lastQuality.set(channelId, quality);
      // 화질 전환은 트랙을 새로 받는 일이라 버퍼링의 첫 번째 의심 대상이다.
      // 이 기록과 프레임 쪽 waiting 기록의 시각을 맞춰 보면 알 수 있다.
      if (before !== undefined) {
        traceLog(
          "mv-quality",
          `${channelName(channelId)} ${before} → ${quality}`,
        );
      }
    }
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_MESSAGE,
          type: "SET_MULTIVIEW_STATE",
          channelId,
          muted: effectiveMuted(channelId),
          volume: effectiveVolume(channelId),
          quality,
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  // 모든 칸에 지금 소리 설정을 다시 내려 준다(화질은 건드리지 않는다).
  function postAllAudio() {
    for (const c of state.chosen) {
      postState(c.channelId, c.channelId === state.mainId);
    }
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

  // 채팅 준비 감시.
  // ⚠ iframe.onload 만으로는 '준비됨' 을 알 수 없다. 치지직 채팅은 SPA 라 껍데기만
  //   먼저 뜬다. 그래서 프레임이 보내는 CHAT_FRAME_READY 를 기준으로 삼는다.
  // ⚠ 채널을 빠르게 바꾸면 이전 프레임의 늦은 신호·시간 초과가 지금 상태를 덮을 수
  //   있다. 세대 번호로 그때 것만 받는다.
  const CHAT_READY_TIMEOUT_MS = 12000;
  let chatGeneration = 0;
  let chatAutoRetried = false;
  let chatReadyTimer = 0;

  function setChatStatus(status, message) {
    const box = $("mvChatStatus");
    if (!box) return;
    if (status === "ready") {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    if (status === "loading") {
      box.innerHTML = '<span class="mv-cell-status-text">채팅 연결 중…</span>';
      return;
    }
    box.innerHTML =
      `<span class="mv-cell-status-text">${esc(message || "채팅을 불러오지 못했습니다.")}</span>` +
      '<button type="button" class="mv-cell-retry" id="mvChatRetry">다시 연결</button>';
  }

  function loadChat(channelId, { retry = false } = {}) {
    const generation = ++chatGeneration;
    if (!retry) chatAutoRetried = false;
    state.chatChannelId = channelId;
    setChatStatus("loading");
    // 채팅 전용 페이지를 쓴다(/live/<id>/chat). 영상이 없는 화면이라 소리·화질을
    // 따로 억제할 필요가 없고, 라이브 페이지를 통째로 띄우는 것보다 훨씬 가볍다.
    const url = new URL(`/live/${channelId}/chat`, CHZZK_ORIGIN);
    url.searchParams.set("cheeseMultiChat", "1");
    // 다시 연결할 때 같은 주소면 브라우저가 무시할 수 있어 값을 하나 바꾼다.
    if (retry) url.searchParams.set("cheeseRetry", String(generation));
    $("mvChatFrame").src = url.toString();

    clearTimeout(chatReadyTimer);
    chatReadyTimer = setTimeout(() => {
      if (generation !== chatGeneration) return; // 이미 다른 채널로 넘어갔다
      if (!chatAutoRetried) {
        // 자동 재연결은 딱 한 번만 한다(무한 재시도 금지).
        chatAutoRetried = true;
        loadChat(channelId, { retry: true });
        return;
      }
      setChatStatus("error");
    }, CHAT_READY_TIMEOUT_MS);
    return generation;
  }

  function applyChat(channelId) {
    if (state.chatChannelId === channelId && $("mvChatFrame").src) return;
    loadChat(channelId);
  }

  // 칸(iframe)은 채널마다 하나씩 만들어 두고 배치가 바뀌어도 '자리'만 옮긴다.
  // ⚠ 다시 만들면 src 가 새로 걸려 방송이 처음부터 다시 로드된다. 메인 변경·배치
  //   변경은 화면을 재배치할 뿐이므로 기존 프레임을 그대로 살려 둔다.
  const cells = new Map(); // channelId -> .mv-cell 요소

  // 프레임 상태 관리. 준비 신호가 제때 안 오면 '다시 불러오기' 를 띄운다.
  const frameTimers = new Map(); // channelId -> timeout id
  // ⚠ 칸 상태의 정본. DOM 의 dataset 과 따로 놀지 않게 setCellStatus 에서만 바꾼다.
  const frameStates = new Map(); // channelId -> "loading" | "ready" | "error" | "ended"

  const currentStatus = (channelId) => frameStates.get(channelId) || "";

  // 해당 칸에만 '지금 화면을 다시 맞춰라' 고 알린다.
  // ⚠ 답을 기다리지 않는다. 화면 정리는 프레임이 스스로 목표 상태로 수렴시키는
  //   일이라 성공/실패로 끝나지 않는다. 부모는 성공 여부를 판정하지 않는다.
  function requestMultiviewUiReconcile(channelId) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_MESSAGE,
          type: "RECONCILE_MULTIVIEW_UI",
          channelId,
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  // 칸 상태를 바꾸는 유일한 통로. 여기서 타일 덮개와 Quick 목록을 함께 갱신해
  // 두 곳이 다른 상태를 보여 주지 않게 한다.
  function setCellStatus(channelId, status, message) {
    frameStates.set(channelId, status);
    const cell = cells.get(channelId);
    if (cell) {
      cell.dataset.status = status;
      const overlay = cell.querySelector(".mv-cell-status");
      if (overlay) renderCellOverlay(overlay, channelId, status, message);
    }
    // Quick 패널이 닫혀 있어도 상태는 위에서 이미 갱신됐다. 열려 있을 때만 다시 그린다.
    if (!$("mvQuick")?.hidden) renderQuick();
  }

  function renderCellOverlay(overlay, channelId, status, message) {
    if (status === "ready") {
      overlay.hidden = true;
      overlay.innerHTML = "";
      return;
    }
    overlay.hidden = false;
    // 기다리는 중인 두 단계는 안내만 보여 준다(누를 것이 없다).
    if (status === "loading") {
      overlay.innerHTML =
        '<span class="mv-cell-status-text">플레이어 불러오는 중…</span>';
      return;
    }
    // ⚠ 두 실패 상태는 뜻이 다르므로 문구가 다르다.
    //   error = 플레이어 자체를 못 불러옴 / ended = 방송이 끝남
    //   화면 정리(채팅 접기·넓은 화면)는 실패 상태로 두지 않는다. 늦게 되는 것일 뿐
    //   이라 프레임이 계속 맞춰 간다.
    const text =
      message ||
      (status === "ended"
        ? "방송이 종료되었습니다."
        : "플레이어를 불러오지 못했습니다.");
    const id = esc(channelId);
    // ⚠ 상태마다 할 수 있는 일이 다르다. 할 수 없는 일은 버튼으로 두지 않는다.
    //   ended = 방송이 끝났다 → 다시 불러와도 같은 종료 화면이고, 화면 정리는 뜻이
    //           없다. 다른 채널로 바꾸거나, 다시 켜졌는지 확인하는 것만 남는다.
    //   error = 플레이어를 못 불러왔다 → 다시 불러오기가 가장 먼저다.
    const actions =
      status === "ended"
        ? `<button type="button" class="mv-cell-retry is-primary" data-mv-replace="${id}">다른 채널 선택</button>` +
          `<button type="button" class="mv-cell-retry" data-mv-recheck="${id}">방송 다시 확인</button>`
        : `<button type="button" class="mv-cell-retry is-primary" data-mv-retry="${id}">다시 불러오기</button>` +
          `<button type="button" class="mv-cell-retry" data-mv-replace="${id}">다른 채널 선택</button>`;
    overlay.innerHTML =
      `<span class="mv-cell-status-text">${esc(text)}</span>` +
      `<span class="mv-cell-status-actions">${actions}</span>`;
  }

  // '방송 다시 확인': 지금 다시 켜졌을 때만 프레임을 새로 불러온다.
  // ⚠ 확인만으로 프레임을 건드리지 않는다. 아직 꺼져 있으면 안내만 바꾼다.
  async function recheckLive(channelId) {
    const cell = cells.get(channelId);
    const overlay = cell?.querySelector(".mv-cell-status");
    const button = overlay?.querySelector("[data-mv-recheck]");
    if (button) {
      button.disabled = true;
      button.textContent = "확인 중…";
    }
    let open = false;
    try {
      // ⚠ 확장 페이지에서 직접 부르면 Origin 때문에 막힌다. 공용 로더가 배경
      //   중계를 거치게 해 둔다(getJson 은 content 를 이미 벗겨서 준다).
      const detail = HASH_RE.test(channelId)
        ? await SOURCES?.getJson(
            `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`,
          )
        : null;
      open = detail?.status === "OPEN";
    } catch {
      open = false;
    }
    if (currentStatus(channelId) !== "ended") return; // 그 사이 상태가 바뀌었다
    if (open) {
      reloadFrame(channelId);
      return;
    }
    setCellStatus(channelId, "ended", "아직 방송이 꺼져 있습니다.");
  }

  function armReadyTimeout(channelId) {
    clearTimeout(frameTimers.get(channelId));
    frameTimers.set(
      channelId,
      setTimeout(() => {
        // 아직 준비 신호를 못 받았을 때만 실패로 본다.
        // ⚠ 이미 준비됐거나 방송이 끝난 칸은 건드리지 않는다(종료를 실패로 덮지 않는다).
        const now = currentStatus(channelId);
        if (now !== "ready" && now !== "ended") {
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
    if (audioBlocked.delete(channelId)) renderVolume();
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

      // 칸 도구 모음(자리 바꾸기 손잡이 + 제거). 한 곳에 모아 영상을 덜 가린다.
      const tools = document.createElement("div");
      tools.className = "mv-cell-tools";

      // 이 채널만 멀티뷰에서 뺀다(멀티뷰 전체를 닫는 것이 아니다).
      const close = document.createElement("button");
      close.type = "button";
      close.className = "mv-cell-close";
      close.dataset.mvClose = channel.channelId;
      close.textContent = "×";
      close.setAttribute(
        "aria-label",
        `${channel.channelName} 멀티뷰에서 제거`,
      );

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
      // ⚠ 손잡이만 draggable 이다. 제거 단추가 드래그 시작점이 되면 안 된다.
      tools.appendChild(grip);
      tools.appendChild(close);
      cell.appendChild(box);
      cell.appendChild(overlay);
      cell.appendChild(tools);
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
      // 2개뿐이면 뺄 수 없다. 왜 안 되는지 알 수 있게 잠그고 이유를 적는다.
      const close = cell.querySelector(".mv-cell-close");
      if (close) {
        const locked = state.chosen.length <= 2;
        close.disabled = locked;
        close.title = locked
          ? "멀티뷰는 최소 2개 채널이 필요합니다."
          : "멀티뷰에서 제거";
      }
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
    // ⚠ chosen[0] 이 곧 메인이라는 약속을 지킨다. 안 맞추면 '채널 다시 고르기' 로
    //   돌아갔을 때 예전 메인이 다시 첫 번째로 보인다.
    const main = state.chosen.find((c) => c.channelId === channelId);
    if (main) {
      state.chosen = [
        main,
        ...state.chosen.filter((c) => c.channelId !== channelId),
      ];
    }
    if (before) postState(before, false);
    postState(channelId, true);
    // 이전 메인에 남아 있던 '소리를 켜려면 클릭' 도 함께 지운다.
    if (before) clearAudioNotice(before);
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

  // ── 볼륨 팝오버 ─────────────────────────────────────────────────────────
  // 자동재생이 막힌 채널. 여기 들어 있으면 볼륨 버튼에 표시를 띄운다.
  const audioBlocked = new Set();

  const pct = (v) => `${Math.round(v * 100)}%`;

  function renderVolume() {
    const value = $("mvVolumeValue");
    const button = $("mvVolumeBtn");
    if (value) {
      value.textContent = state.audioFocusMode
        ? `메인 ${pct(state.masterVolume)}`
        : `전체 ${pct(state.masterVolume)}`;
    }
    // 자동재생이 막혔으면 버튼에 표시를 남긴다(색만이 아니라 글자로도 알린다).
    const blocked = audioBlocked.size > 0;
    button?.classList.toggle("is-warn", blocked);
    if (button) {
      button.setAttribute(
        "aria-label",
        blocked ? "볼륨 - 소리가 차단됨" : "볼륨",
      );
    }

    const panel = $("mvVolumePop");
    if (!panel || panel.hidden) return;
    const rows = state.chosen
      .map((c) => {
        const id = esc(c.channelId);
        const audio = audioOf(c.channelId);
        const isMain = c.channelId === state.mainId;
        // focus mode 에서는 메인만 소리가 난다. 보조 슬라이더는 잠근다.
        const forcedOff = state.audioFocusMode && !isMain;
        const muted = effectiveMuted(c.channelId);
        return (
          `<div class="mv-vol-row${forcedOff ? " is-off" : ""}">` +
          `<span class="mv-vol-name">${esc(c.channelName)}` +
          (isMain ? `<span class="mv-quick-tag">메인</span>` : "") +
          `</span>` +
          `<button type="button" class="mv-vol-mute" data-mv-vol-mute="${id}"` +
          ` aria-pressed="${muted}"` +
          ` aria-label="${esc(c.channelName)} ${muted ? "음소거 해제" : "음소거"}"` +
          `${forcedOff ? " disabled" : ""}>${muted ? "🔇" : "🔊"}</button>` +
          `<input type="range" class="mv-vol-range" min="0" max="100" step="1"` +
          ` value="${Math.round(audio.volume * 100)}"` +
          ` data-mv-vol-channel="${id}"` +
          ` aria-label="${esc(c.channelName)} 볼륨"` +
          `${forcedOff ? " disabled" : ""}>` +
          `<span class="mv-vol-pct">${pct(audio.volume)}</span>` +
          `</div>`
        );
      })
      .join("");

    // 자동재생이 막혔을 때만 안내를 띄운다. 누르는 순간이 곧 사용자 조작이라
    // 그 자리에서 소리 켜기를 다시 시도할 수 있다.
    const blockedNames = state.chosen
      .filter((c) => audioBlocked.has(c.channelId))
      .map((c) => c.channelName);
    const notice = blockedNames.length
      ? `<div class="mv-vol-notice">` +
        `<p>${esc(
          blockedNames.length > 1
            ? `${blockedNames.join(", ")} 채널의 소리 재생이 차단되었습니다.`
            : `브라우저가 ${blockedNames[0]}의 소리 재생을 차단했습니다.`,
        )}</p>` +
        `<button type="button" class="mv-vol-enable" id="mvVolEnable">소리 활성화</button>` +
        `</div>`
      : "";

    panel.innerHTML =
      notice +
      `<div class="mv-vol-row is-master">` +
      `<span class="mv-vol-name">전체 볼륨</span>` +
      `<input type="range" class="mv-vol-range" min="0" max="100" step="1"` +
      ` value="${Math.round(state.masterVolume * 100)}"` +
      ` data-mv-vol-master="1" aria-label="멀티뷰 전체 볼륨">` +
      `<span class="mv-vol-pct">${pct(state.masterVolume)}</span>` +
      `</div>` +
      `<label class="mv-vol-focus">` +
      `<input type="checkbox" id="mvVolFocus"${state.audioFocusMode ? " checked" : ""}>` +
      `<span>메인 채널만 소리</span></label>` +
      `<div class="mv-vol-list">${rows}</div>`;
  }

  // ── 진단 기록 ───────────────────────────────────────────────────────────
  // ⚠ 기록만 한다. 여기서 다시 불러오거나 seek 하지 않는다.
  //   켜는 법: 콘솔에서 localStorage.cheeseMultiviewTrace = "1" 후 새로고침.
  let mvTrace = false;
  try {
    mvTrace = localStorage.getItem("cheeseMultiviewTrace") === "1";
  } catch {}

  const traceLog = (tag, text) => {
    if (!mvTrace) return;
    console.log(`[${tag}] ${text}`);
  };

  // 칸마다 FRAME_READY 를 몇 번 받았는지. Alt+Tab 으로 프레임이 다시 초기화되는지
  // 가리는 데 쓴다 — 사용자가 다시 불러오기·교체를 하지 않았는데 #2 가 찍히면
  // 그 프레임 document 가 다시 만들어졌다는 뜻이다.
  // ⚠ 진단 기록에만 쓴다. 이 값으로 무엇을 자동으로 고치지 않는다.
  const frameReadyCounts = new Map();

  // 탭을 떠났다 돌아온 시각. 복귀 직후의 지연 변화를 보기 위한 것이다.
  let lastVisibleAt = 0;
  function traceLatency(channelId) {
    if (!mvTrace || !lastVisibleAt) return;
    const since = Date.now() - lastVisibleAt;
    if (since > 10000) return; // 복귀 후 10초까지만 본다
    const st = statsByChannel.get(channelId)?.stats;
    if (!st) return;
    traceLog(
      "mv-life",
      `복귀 +${(since / 1000).toFixed(1)}s ${channelName(channelId)} ` +
        `지연=${st.latencySec == null ? "-" : st.latencySec.toFixed(1)}s ` +
        `paused=${st.paused} readyState=${st.readyState}`,
    );
  }

  // 복귀 직후 지연이 어떻게 회복되는지 보려면 정해진 시점의 통계가 필요하다.
  // ⚠ 통계 패널이 이미 1초마다 묻고 있으면 여기서 또 묻지 않는다. 두 곳이 같이
  //   돌면 같은 시각의 통계가 두 번 들어와 로그가 겹쳐 보인다(중복의 진짜 원인).
  const RETURN_PROBE_DELAYS = [200, 1000, 2000, 3000, 5000, 8000];
  let returnProbeTimers = [];

  function cancelReturnProbe() {
    for (const id of returnProbeTimers) clearTimeout(id);
    returnProbeTimers = [];
  }

  function scheduleReturnProbe() {
    cancelReturnProbe();
    if (statsTimer) return; // 이미 통계 폴링이 돌고 있다 → 따로 묻지 않는다
    returnProbeTimers = RETURN_PROBE_DELAYS.map((delay) =>
      window.setTimeout(() => {
        requestStats();
      }, delay),
    );
  }

  if (mvTrace) {
    // ⚠ 부모는 visibilitychange 에서 아무것도 '고치지' 않는다. 기록만 남긴다.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        traceLog("mv-life", "부모 숨김");
        cancelReturnProbe(); // 다음 복귀 주기와 겹치지 않게 예약을 비운다
        return;
      }
      lastVisibleAt = Date.now();
      traceLog(
        "mv-life",
        `부모 복귀 (버려졌었나=${document.wasDiscarded === true})`,
      );
      scheduleReturnProbe();
    });
  }

  // ── 통합 스트림 정보 ────────────────────────────────────────────────────
  // ⚠ 부모는 통계를 계산하지 않는다. 교차 출처 iframe 안의 플레이어는 부모가
  //   들여다볼 수 없다. 각 칸에 물어보고 받은 값만 보여 준다.
  const STATS_POLL_MS = 1000;
  // 이 횟수만큼 답이 없으면 '대기 중' 으로 바꾼다(옛 숫자를 계속 보여 주지 않는다).
  const STATS_STALE_TICKS = 3;
  const statsByChannel = new Map(); // channelId → { stats, updatedAt }
  let statsTimer = 0;

  function startStatsPolling() {
    // 폴링이 시작되면 복귀 진단 예약은 중복이 된다. 먼저 비운다.
    cancelReturnProbe();
    renderStats();
    requestStats();
    if (statsTimer) return;
    statsTimer = window.setInterval(() => {
      requestStats();
      renderStats();
    }, STATS_POLL_MS);
  }

  function stopStatsPolling() {
    if (!statsTimer) return;
    clearInterval(statsTimer);
    statsTimer = 0;
  }

  function requestStats() {
    for (const c of state.chosen) {
      // 끝났거나 실패한 칸에는 물어볼 것이 없다.
      const status = currentStatus(c.channelId);
      if (status === "ended" || status === "error") continue;
      const frame = cells.get(c.channelId)?.querySelector("iframe");
      if (!frame?.contentWindow) continue;
      try {
        frame.contentWindow.postMessage(
          {
            source: MULTIVIEW_MESSAGE,
            type: "REQUEST_MULTIVIEW_STATS",
            channelId: c.channelId,
          },
          CHZZK_ORIGIN,
        );
      } catch {}
    }
  }

  const fmtLatency = (v) => (Number.isFinite(v) ? `${v.toFixed(1)}초` : "-");
  const fmtRes = (w, h) => (w && h ? `${w}×${h}` : "-");
  const fmtFps = (v) =>
    Number.isFinite(v) && v > 0 ? String(Math.round(v)) : "-";
  // 값은 kbps 로 온다(프레임에서 toKbps 를 거친다). 여기서 한 번만 Mbps 로 바꾼다.
  const fmtBitrate = (v) => {
    if (!Number.isFinite(v) || v <= 0) return "-";
    return v >= 1000
      ? `${(v / 1000).toFixed(1)} Mbps`
      : `${Math.round(v)} kbps`;
  };

  function renderStats() {
    const panel = $("mvStatsPop");
    if (!panel || panel.hidden) return;
    const now = Date.now();
    const rows = state.chosen
      .map((c) => {
        const status = currentStatus(c.channelId);
        const name = `<td class="mv-stats-name">${esc(c.channelName)}</td>`;
        if (status === "ended" || status === "error") {
          const label = status === "ended" ? "방송 종료" : "오류";
          return `<tr>${name}<td colspan="4" class="mv-stats-state">${label}</td></tr>`;
        }
        const entry = statsByChannel.get(c.channelId);
        // 오래된 값은 최신인 척하지 않는다.
        const fresh =
          entry && now - entry.updatedAt < STATS_POLL_MS * STATS_STALE_TICKS;
        if (!fresh) {
          return `<tr>${name}<td colspan="4" class="mv-stats-state">대기 중</td></tr>`;
        }
        const st = entry.stats;
        // 실제 화질은 해상도 열(width×height)로 충분히 보인다. 따로 열을 두지 않는다.
        return (
          `<tr>${name}` +
          `<td>${fmtLatency(st.latencySec)}</td>` +
          `<td>${fmtRes(st.width, st.height)}</td>` +
          `<td>${fmtFps(st.fps)}</td>` +
          `<td>${fmtBitrate(st.bitrateKbps)}</td></tr>`
        );
      })
      .join("");
    panel.innerHTML =
      `<table class="mv-stats-table">` +
      `<thead><tr><th>채널</th><th>지연</th><th>해상도</th>` +
      `<th>FPS</th><th>비트레이트</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      `<p class="mv-stats-note">지연은 플레이어가 알려 주는 값이다(스트림 정보 패널과 같은 기준).</p>`;
  }

  function closePopovers(except) {
    for (const pop of document.querySelectorAll("[data-mv-pop]")) {
      const name = pop.dataset.mvPop;
      if (name === except) continue;
      // 통계 패널이 닫히면 6칸에 계속 물어볼 이유가 없다.
      if (name === "stats") stopStatsPolling();
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
    // 볼륨·통계는 열려 있는 동안만 내용을 유지한다. 통계는 닫히면 폴링도 멈춘다.
    if (name === "volume" && open) renderVolume();
    if (name === "stats") {
      if (open) startStatsPolling();
      else stopStatsPolling();
    }
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
    // ⚠ 자리 바꾸기 자체는 iframe 주소를 건드리지 않는다. 다만 첫 자리가 바뀌면
    //   메인이 함께 바뀌고, 그때 음소거·화질 지시가 나간다. 버퍼링이 보인다면
    //   자리 이동이 아니라 이 화질 전환을 먼저 의심해야 한다.
    if (nextMain !== state.mainId) {
      traceLog(
        "mv-drag",
        `자리 교체 + 메인 변경 ${channelName(state.mainId)} → ${channelName(nextMain)}`,
      );
      setMain(nextMain);
    } else {
      traceLog("mv-drag", "자리 교체만(메인 그대로, 지시 없음)");
      applyLayout();
    }
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

  // replaceChannelId 를 주면 '교체 모드' 로 연다(고른 채널이 그 자리를 대신한다).
  let quickReplaceId = "";
  // 교체 모드로 들어온 길. 취소했을 때 어디로 돌아갈지가 이것으로 갈린다.
  //   "quick-chip"    = Quick 안에서 칩을 눌러 시작 → 취소하면 Quick 에 남는다
  //   "ended-overlay" = 종료 덮개에서 시작 → 취소하면 Quick 까지 닫는다
  let quickReplaceOrigin = "";
  function openQuick({ replaceChannelId = "", origin = "" } = {}) {
    quickReplaceId = cells.has(replaceChannelId) ? replaceChannelId : "";
    quickReplaceOrigin = quickReplaceId ? origin : "";
    $("mvQuick").hidden = false;
    renderQuick();
    void loadQuickCandidates();
  }

  // 교체 모드를 푼다. 들어온 길에 따라 Quick 을 닫을지가 달라진다.
  function cancelReplace() {
    const origin = quickReplaceOrigin;
    quickReplaceId = "";
    quickReplaceOrigin = "";
    // 종료 덮개에서 왔다면 사용자는 원래 Quick 을 보고 있지 않았다. 되돌려 놓는다.
    if (origin === "ended-overlay") {
      closeQuick();
      return;
    }
    renderQuick();
  }

  // 한 자리만 다른 채널로 바꾼다.
  //
  // ⚠ '빼고 다시 넣기' 로 하면 그 사이 메인·채팅·배치가 다시 계산돼 다른 칸까지
  //   흔들린다. 그래서 자리를 지키며 그 칸만 갈아 끼운다.
  function replaceChannel(oldChannelId, newChannel) {
    const index = state.chosen.findIndex((c) => c.channelId === oldChannelId);
    if (index < 0 || !newChannel) return;
    const id = String(newChannel.channelId || "").toLowerCase();
    if (!HASH_RE.test(id)) return;
    // 이미 보고 있는 채널이면 넣지 않는다(같은 채널이 두 칸에 뜨지 않게).
    if (state.chosen.some((c) => c.channelId === id)) return;

    const wasMain = state.mainId === oldChannelId;
    const wasChat = state.chatChannelId === oldChannelId;

    // 옛 칸 정리: 그 프레임만 내린다.
    const oldCell = cells.get(oldChannelId);
    const oldFrame = oldCell?.querySelector("iframe");
    if (oldFrame) oldFrame.src = "about:blank";
    oldCell?.remove();
    cells.delete(oldChannelId);
    clearTimeout(frameTimers.get(oldChannelId));
    frameTimers.delete(oldChannelId);
    frameStates.delete(oldChannelId);
    // 칸이 사라지면 센 것도 버린다. 안 그러면 뺐다가 다시 넣은 채널이 #2 로 보여
    // '프레임이 다시 만들어졌다' 는 신호와 섞인다.
    frameReadyCounts.delete(oldChannelId);

    // 자리를 그대로 두고 갈아 끼운다(채널 수가 같아 배치도 그대로 쓸 수 있다).
    const next = {
      channelId: id,
      channelName: String(newChannel.channelName || ""),
      channelImageUrl: String(newChannel.channelImageUrl || ""),
    };
    state.chosen = state.chosen.map((c, i) => (i === index ? next : c));
    if (wasMain) state.mainId = id;

    ensureCells(); // 새 채널 칸만 만든다
    applyLayout();
    // 채팅이 그 채널을 보고 있었으면 새 채널로 넘긴다.
    if (wasChat || (state.chatFollowsMain && wasMain)) applyChat(id);
    renderQuick();
  }

  function closeQuick() {
    $("mvQuick").hidden = true;
  }

  // 상태를 사람이 읽을 수 있는 짧은 말로. 색만으로 구분하지 않는다(글자를 함께 둔다).
  const STATUS_BADGE = {
    ended: "종료",
    error: "오류",
  };

  function renderQuick() {
    const min = 2;
    const hint = $("mvQuickHint");
    hint.textContent = quickReplaceId
      ? `${channelName(quickReplaceId)} 대신 볼 채널을 고르세요.`
      : `${state.chosen.length} / 6`;
    // 교체 모드는 취소할 수 있어야 한다. 버튼은 머리말의 동작 묶음 안에 둔다
    // (안내 문구 옆에 끼어들어 줄이 밀리지 않게).
    const cancel = $("mvQuickCancelReplace");
    if (quickReplaceId && !cancel) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "mvQuickCancelReplace";
      button.className = "mv-quick-cancel";
      button.textContent = "교체 취소";
      const actions = $("mvQuickHeadActions");
      if (actions) actions.prepend(button);
      else hint.after(button);
    } else if (!quickReplaceId && cancel) {
      cancel.remove();
    }
    $("mvQuickCurrent").innerHTML = state.chosen
      .map((c) => {
        const isMain = c.channelId === state.mainId;
        const status = currentStatus(c.channelId);
        const badge = STATUS_BADGE[status] || "";
        const locked = state.chosen.length <= min;
        const id = esc(c.channelId);
        // ⚠ 칩 본문과 × 를 각각 버튼으로 나눈다. 한 덩어리로 두고 클릭 위치로
        //   갈라내면 × 를 눌렀을 때 교체 모드까지 함께 켜진다.
        return (
          `<li class="mv-quick-item${isMain ? " is-main" : ""}` +
          `${quickReplaceId === c.channelId ? " is-replacing" : ""}"` +
          `${badge ? ` data-state="${esc(status)}"` : ""}>` +
          `<button type="button" class="mv-quick-select" data-mv-quick-replace="${id}"` +
          ` aria-pressed="${quickReplaceId === c.channelId}"` +
          ` title="${esc(c.channelName)} 를 다른 채널로 바꾸기">` +
          `<span class="mv-quick-name">${esc(c.channelName)}</span>` +
          (isMain ? `<span class="mv-quick-tag">메인</span>` : "") +
          (badge
            ? `<span class="mv-quick-state" data-state="${esc(status)}">${esc(badge)}</span>`
            : "") +
          `</button>` +
          `<button type="button" class="mv-quick-drop" data-mv-quick-drop="${id}"` +
          `${locked ? " disabled" : ""}` +
          ` title="${locked ? "멀티뷰는 최소 2개 채널이 필요합니다." : "멀티뷰에서 제거"}"` +
          ` aria-label="${esc(c.channelName)} 빼기">×</button></li>`
        );
      })
      .join("");

    renderQuickCandidates();
  }

  // ── 후보 목록 ───────────────────────────────────────────────────────────
  // 고르기 화면과 같은 로더를 쓴다(주소·응답 해석을 두 곳에 두지 않는다).
  const SOURCES = globalThis.CheeseMultiviewSources;
  const QUICK_TTL_MS = 20000; // 제목·시청자 수가 바뀌므로 오래 들고 있지 않는다
  const quickCache = new Map(); // key -> {value, expiresAt}
  let quickSource = "following";
  let quickKeyword = "";
  let quickSections = []; // 전용 팔로잉 구역(폴더)
  let quickFolder = ""; // 고른 폴더(빈 문자열이면 전체)
  // ⚠ 요청은 순서대로 보내도 응답은 뒤섞여 온다. 마지막 요청의 응답만 그린다.
  let quickRequestId = 0;

  // 목록을 가져온다. 전용 팔로잉만 구역(폴더) 배열이고 나머지는 평평한 목록이다.
  // ⚠ 캐시 키를 구분한다. 같은 키에 평평한 목록과 구역 배열을 섞어 담으면 안 된다.
  async function quickRows(source, keyword) {
    const key =
      source === "search"
        ? `search:${keyword}`
        : source === "custom"
          ? "custom:sections"
          : source;
    const cached = quickCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!SOURCES) return source === "custom" ? [] : [];
    const value =
      source === "following"
        ? await SOURCES.loadFollowing()
        : source === "custom"
          ? await SOURCES.loadCustomSections()
          : source === "live"
            ? await SOURCES.loadLive()
            : await SOURCES.searchLive(keyword);
    // 검색은 입력마다 달라 캐시하지 않는다.
    if (source !== "search") {
      quickCache.set(key, { value, expiresAt: Date.now() + QUICK_TTL_MS });
    }
    return value;
  }

  async function loadQuickCandidates() {
    const requestId = ++quickRequestId;
    const source = quickSource;
    const keyword = quickKeyword;
    quickCandidates = null; // 불러오는 중
    renderQuickCandidates();
    let result = [];
    try {
      result = await quickRows(source, keyword);
    } catch {
      result = [];
    }
    if (requestId !== quickRequestId) return; // 더 최신 요청이 있다 → 버린다
    if (source === "custom") {
      quickSections = Array.isArray(result) ? result : [];
      quickCandidates = flattenQuickSections(quickSections);
    } else {
      quickSections = [];
      quickCandidates = Array.isArray(result) ? result : [];
    }
    renderQuickCandidates();
  }

  // 구역을 하나로 펼친다(같은 채널이 두 구역에 있으면 한 번만).
  function flattenQuickSections(sections) {
    const seen = new Set();
    const rows = [];
    for (const section of sections) {
      for (const row of section.rows || []) {
        if (seen.has(row.channelId)) continue;
        seen.add(row.channelId);
        rows.push(row);
      }
    }
    return rows;
  }

  // 구역 아이콘(lucide). 고르기 화면과 같은 모양을 쓴다.
  const QUICK_FOLDER_ICONS = {
    star: '<path d="M11.5 3.2a.6.6 0 0 1 1 0l2.2 4.5 5 .7a.6.6 0 0 1 .3 1l-3.6 3.5.9 4.9a.6.6 0 0 1-.9.6L12 16.1l-4.4 2.3a.6.6 0 0 1-.9-.6l.9-4.9L4 9.4a.6.6 0 0 1 .3-1l5-.7z"></path>',
    folder:
      '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>',
    heart:
      '<path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 12 5.4 5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7Z"></path>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.9"></path><path d="M16 3.1a4 4 0 0 1 0 7.8"></path>',
  };
  const quickFolderIcon = (name) =>
    '<svg class="mv-quick-folder-icon" width="16" height="16" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    (QUICK_FOLDER_ICONS[name] || QUICK_FOLDER_ICONS.folder) +
    "</svg>";

  // 전용 팔로잉 구역 폴더. 다른 목록에서는 숨긴다.
  function renderQuickFolders() {
    const box = $("mvQuickFolders");
    if (!box) return;
    if (quickSource !== "custom" || !quickSections.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const total = quickCandidates ? quickCandidates.length : 0;
    const card = (id, label, icon, count) =>
      `<button type="button" class="mv-quick-folder${quickFolder === id ? " is-on" : ""}" ` +
      `data-mv-quick-folder="${esc(id)}" aria-pressed="${quickFolder === id}">` +
      quickFolderIcon(icon) +
      `<span class="mv-quick-folder-name">${esc(label)}</span>` +
      `<span class="mv-quick-folder-count">${count}</span></button>`;
    box.innerHTML =
      card("", "전체", "users", total) +
      quickSections
        .map((sec) =>
          card(sec.id, sec.label, sec.icon, (sec.rows || []).length),
        )
        .join("");
    box.hidden = false;
  }

  // 탭을 바꾸면 세로·가로 스크롤을 모두 처음으로 돌린다.
  function resetQuickScroll() {
    const body = document.querySelector(".mv-quick-body");
    if (body) body.scrollTop = 0;
    const box = $("mvQuickAdd");
    if (box) box.scrollLeft = 0;
  }

  // 지금 폴더에 해당하는 후보만 남긴다(전체면 그대로).
  function quickVisibleRows() {
    if (!quickCandidates) return [];
    if (quickSource !== "custom" || !quickFolder) return quickCandidates;
    const section = quickSections.find((sec) => sec.id === quickFolder);
    return section ? section.rows || [] : [];
  }

  // 목록이 넘칠 때만 좌우 화살표를 보여준다.
  function syncQuickRailNav() {
    const box = $("mvQuickAdd");
    const rail = box?.closest?.(".mv-quick-rail");
    if (!box || !rail) return;
    const overflow = box.scrollWidth > box.clientWidth + 1;
    for (const nav of rail.querySelectorAll("[data-mv-quick-scroll]")) {
      nav.hidden = !overflow;
    }
  }

  // 후보가 없을 때의 안내는 목록 종류마다 다르다.
  function quickEmptyMessage() {
    if (quickSource === "search") {
      return quickKeyword.trim()
        ? "찾는 채널이 없습니다."
        : "채널 이름으로 찾아보세요.";
    }
    if (quickSource === "custom") {
      if (!quickSections.length) return "전용 팔로잉 구역이 아직 없습니다.";
      if (quickFolder) return "이 구역에 지금 방송 중인 채널이 없습니다.";
      return "지금 방송 중인 전용 팔로잉 채널이 없습니다.";
    }
    if (quickSource === "following") {
      return "지금 방송 중인 팔로잉 채널이 없습니다.";
    }
    return "추가할 채널이 없습니다.";
  }

  function renderQuickCandidates() {
    const tabs = $("mvQuickTabs");
    if (tabs) {
      for (const button of tabs.querySelectorAll("[data-mv-quick-source]")) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.mvQuickSource === quickSource),
        );
      }
    }
    const searchBox = $("mvQuickSearch");
    if (searchBox) searchBox.hidden = quickSource !== "search";
    renderQuickFolders();

    const box = $("mvQuickAdd");
    if (!box) return;
    if (quickCandidates === null) {
      box.innerHTML = '<p class="mv-quick-empty">불러오는 중…</p>';
      syncQuickRailNav();
      return;
    }
    // 이미 보고 있는 채널은 후보에서 뺀다. 교체 대상 자신도 뺀다 — 같은 채널로
    // 갈아 끼우는 것은 replaceChannel 이 거르므로 눌러도 아무 일이 없다.
    const have = new Set(state.chosen.map((c) => c.channelId));
    const rest = quickVisibleRows().filter((r) => !have.has(r.channelId));
    if (!rest.length) {
      box.innerHTML = `<p class="mv-quick-empty">${esc(quickEmptyMessage())}</p>`;
      syncQuickRailNav();
      return;
    }
    // 교체 모드가 아니고 자리가 다 찼으면 더 담을 수 없다.
    const full = !quickReplaceId && state.chosen.length >= 6;
    box.innerHTML = rest
      .slice(0, 30)
      .map((r) => {
        const thumb = safeImageUrl(r.liveImageUrl);
        const avatar = safeImageUrl(r.channelImageUrl);
        return (
          `<button type="button" class="mv-quick-card" data-mv-quick-add="${esc(r.channelId)}"` +
          `${full ? " disabled" : ""} title="${esc(r.channelName)}">` +
          `<span class="mv-quick-card-thumb${thumb ? "" : " is-fallback"}">` +
          (thumb
            ? `<img src="${esc(thumb)}" alt="" loading="lazy">`
            : `<span class="mv-quick-card-empty"></span>`) +
          (r.adult ? `<span class="mv-quick-card-adult">19+</span>` : "") +
          `</span>` +
          `<span class="mv-quick-card-body">` +
          (avatar
            ? `<img class="mv-quick-card-avatar" src="${esc(avatar)}" alt="" loading="lazy">`
            : `<span class="mv-quick-card-avatar is-empty"></span>`) +
          `<span class="mv-quick-card-text">` +
          `<span class="mv-quick-card-title">${esc(r.liveTitle || "제목 없음")}</span>` +
          `<span class="mv-quick-card-name">${esc(r.channelName)}</span>` +
          `</span></span>` +
          `</button>`
        );
      })
      .join("");
    syncQuickRailNav();
  }

  // 이미지 주소는 API 가 준 문자열이다. http(s) 가 아니면 쓰지 않는다.
  function safeImageUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw, location.href);
      return parsed.protocol === "https:" || parsed.protocol === "http:"
        ? parsed.toString()
        : "";
    } catch {
      return "";
    }
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
    frameStates.delete(channelId);
    frameReadyCounts.delete(channelId);
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
    if (target.closest?.("#mvChatRetry")) {
      // 사용자가 직접 누른 경우에만 다시 연결한다(영상 프레임은 건드리지 않는다).
      chatAutoRetried = false;
      loadChat(state.chatChannelId, { retry: true });
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
    const chip = target.closest?.("[data-mv-quick-replace]");
    if (chip) {
      const id = chip.dataset.mvQuickReplace;
      // 같은 칩을 다시 누르면 교체 모드를 끈다(누른 것을 되돌릴 방법이 있어야 한다).
      if (quickReplaceId === id) cancelReplace();
      else {
        quickReplaceId = cells.has(id) ? id : "";
        quickReplaceOrigin = quickReplaceId ? "quick-chip" : "";
        renderQuick();
      }
      return;
    }
    const sourceTab = target.closest?.("[data-mv-quick-source]");
    if (sourceTab) {
      quickSource = sourceTab.dataset.mvQuickSource;
      quickFolder = ""; // 목록 종류를 바꾸면 구역 선택을 푼다
      // 앞 탭에서 내려 둔 스크롤이 남으면 새 탭이 엉뚱한 위치에서 시작한다.
      resetQuickScroll();
      void loadQuickCandidates();
      return;
    }
    const folder = target.closest?.("[data-mv-quick-folder]");
    if (folder) {
      // 구역 전환은 이미 받아 둔 목록을 거르기만 한다(다시 불러오지 않는다).
      quickFolder = folder.dataset.mvQuickFolder;
      renderQuickCandidates();
      return;
    }
    const scroll = target.closest?.("[data-mv-quick-scroll]");
    if (scroll) {
      const box = $("mvQuickAdd");
      const dir = Number(scroll.dataset.mvQuickScroll) || 1;
      box?.scrollBy({ left: dir * box.clientWidth * 0.8, behavior: "smooth" });
      return;
    }
    if (target.closest?.("#mvQuickCancelReplace")) {
      cancelReplace();
      return;
    }
    const add = target.closest?.("[data-mv-quick-add]");
    if (add) {
      const id = add.dataset.mvQuickAdd;
      const picked = quickCandidates?.find((r) => r.channelId === id);
      if (quickReplaceId) {
        // 교체 모드: 그 자리만 갈아 끼운다.
        replaceChannel(quickReplaceId, picked || { channelId: id });
        quickReplaceId = "";
        quickReplaceOrigin = "";
        renderQuick();
        return;
      }
      addChannel(id);
      return;
    }
    const retry = target.closest?.("[data-mv-retry]");
    if (retry) {
      // 사용자가 직접 누른 경우에만 다시 불러온다(자동 반복 없음).
      reloadFrame(retry.dataset.mvRetry);
      return;
    }
    const reapply = target.closest?.("[data-mv-reapply]");
    if (reapply) {
      // ⚠ 프레임을 다시 로드하지 않고, 덮개로 덮지도 않는다. 그 칸에 '지금 다시
      //   맞춰라' 고만 알린다(결과를 기다리는 상태로 들어가지 않는다).
      requestMultiviewUiReconcile(reapply.dataset.mvReapply);
      return;
    }
    const recheck = target.closest?.("[data-mv-recheck]");
    if (recheck) {
      void recheckLive(recheck.dataset.mvRecheck);
      return;
    }
    const replace = target.closest?.("[data-mv-replace]");
    if (replace) {
      openQuick({
        replaceChannelId: replace.dataset.mvReplace,
        origin: "ended-overlay",
      });
      return;
    }
    const close = target.closest?.("[data-mv-close]");
    if (close) {
      // 기존 경로를 그대로 쓴다(삭제 로직을 새로 만들지 않는다).
      dropChannel(close.dataset.mvClose);
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
    const volMute = target.closest?.("[data-mv-vol-mute]");
    if (volMute) {
      const id = volMute.dataset.mvVolMute;
      const audio = audioOf(id);
      audio.muted = !audio.muted;
      // 음소거를 풀었는데 크기가 0 이면 아무 소리도 안 난다. 들리게 올려 준다.
      if (!audio.muted && audio.volume === 0) audio.volume = 1;
      postState(id, id === state.mainId);
      renderVolume();
      return;
    }
    if (target.closest?.("#mvVolEnable")) {
      // ⚠ 이 클릭 자체가 사용자 조작이다. 같은 처리 안에서 바로 지시를 내려야
      //   브라우저가 자동재생 허용으로 쳐 준다(비동기로 미루면 놓친다).
      // ⚠ 여기서 경고를 미리 지우지 않는다. 실제로 소리가 나기 시작하면 칸이
      //   AUDIO_INTERACTION_RESOLVED 를 보내 주고, 그때 지운다. 성공을 확인하기
      //   전에 UI 만 정상으로 바꾸면 안 들리는데 괜찮아 보이는 상태가 된다.
      for (const id of [...audioBlocked]) {
        postState(id, id === state.mainId);
      }
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

  let quickSearchTimer = 0;
  $("mvQuickSearch")?.addEventListener("input", (event) => {
    quickKeyword = event.target.value;
    clearTimeout(quickSearchTimer);
    quickSearchTimer = window.setTimeout(() => void loadQuickCandidates(), 300);
  });

  // 볼륨 슬라이더. input 마다 전체를 다시 그리면 끌 때 끊기므로, 끄는 동안에는
  // 숫자만 바꾸고 프레임에 값을 내려 준다(전체 다시 그리기는 하지 않는다).
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
    const next = Math.min(1, Math.max(0, Number(el.value) / 100));
    if (!Number.isFinite(next)) return;

    if (el.dataset.mvVolMaster) {
      state.masterVolume = next;
      el.parentElement
        ?.querySelector(".mv-vol-pct")
        ?.replaceChildren(pct(next));
      postAllAudio();
      // 버튼의 숫자만 갱신한다(패널을 다시 그리지 않는다).
      const value = $("mvVolumeValue");
      if (value) {
        value.textContent = state.audioFocusMode
          ? `메인 ${pct(next)}`
          : `전체 ${pct(next)}`;
      }
      return;
    }

    const channelId = el.dataset.mvVolChannel;
    if (!channelId || !cells.has(channelId)) return;
    const audio = audioOf(channelId);
    audio.volume = next;
    el.parentElement?.querySelector(".mv-vol-pct")?.replaceChildren(pct(next));
    // 보조 채널 소리를 올렸다는 건 여러 방송을 같이 듣고 싶다는 뜻이다.
    // '메인 채널만 소리' 를 끄고 그 채널의 음소거도 함께 푼다.
    if (state.audioFocusMode && channelId !== state.mainId && next > 0) {
      state.audioFocusMode = false;
      audio.muted = false;
      postAllAudio();
      renderVolume();
      return;
    }
    if (next > 0 && audio.muted) audio.muted = false;
    postState(channelId, channelId === state.mainId);
  });

  document.addEventListener("change", (event) => {
    if (event.target?.id !== "mvVolFocus") return;
    state.audioFocusMode = event.target.checked === true;
    // ⚠ 채널별 volume 값은 그대로 둔다. focus mode 를 껐을 때 이전 믹스를
    //   그대로 되찾을 수 있어야 한다. 바뀌는 것은 '지금 소리를 내는가' 뿐이다.
    postAllAudio();
    renderVolume();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closePopovers(null);
    closeQuick();
  });

  // 프레임이 보내는 상태 신호.
  // 검증 순서: 형태 → 출처 → 이름 → 타입 → 채널 → 그 채널의 프레임에서 왔는지.
  const FRAME_MESSAGE_TYPES = new Set([
    "FRAME_READY",
    "FRAME_ENDED",
    "AUDIO_INTERACTION_REQUIRED",
    "AUDIO_INTERACTION_RESOLVED",
    "MULTIVIEW_STATS",
  ]);
  window.addEventListener("message", (event) => {
    if (event.origin !== CHZZK_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== MULTIVIEW_MESSAGE) return;
    if (!FRAME_MESSAGE_TYPES.has(data.type)) return;
    const channelId = String(data.channelId || "").toLowerCase();
    if (!HASH_RE.test(channelId) || !cells.has(channelId)) return;
    // ⚠ 정말 그 칸의 프레임이 보낸 것인지 확인한다. 다른 프레임이 남의 channelId 로
    //   보내는 것을 막는다.
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame || event.source !== frame.contentWindow) return;

    if (data.type === "FRAME_READY") {
      const count = (frameReadyCounts.get(channelId) || 0) + 1;
      frameReadyCounts.set(channelId, count);
      traceLog("mv-frame", `${channelName(channelId)} FRAME_READY #${count}`);
      clearTimeout(frameTimers.get(channelId));
      frameTimers.delete(channelId);
      // ⚠ 여기서 덮개를 걷지 않는다. FRAME_READY 는 '지시를 받을 수 있게 됨' 일 뿐
      //   화면 정리(채팅 접기·넓은 화면)는 아직 끝나지 않았다.
      if (currentStatus(channelId) === "ended") return; // 종료된 칸은 그대로 둔다
      // ⚠ 프레임이 준비되기 전에 보낸 지시는 (리스너가 붙기 전이라) 유실됐을 수 있다.
      //   주소의 쿼리는 '처음 상태' 일 뿐이고 최종 기준은 지금 부모 상태다.
      postState(channelId, channelId === state.mainId);
      // ⚠ 여기서 바로 덮개를 걷는다. 화면 정리(채팅 접기·넓은 화면)는 프레임이
      //   스스로 목표 상태로 맞춰 가는 일이라, 그걸 기다리면 DOM 이 늦게 뜬 것까지
      //   실패로 보인다(그래서 재적용을 두세 번 눌러야 했다).
      setCellStatus(channelId, "ready");
      return;
    }
    if (data.type === "FRAME_ENDED") {
      // 방송 종료. 칸을 지우거나 다른 채널을 자동으로 메인으로 올리지 않는다.
      clearTimeout(frameTimers.get(channelId));
      frameTimers.delete(channelId);
      setCellStatus(channelId, "ended");
      return;
    }
    if (data.type === "MULTIVIEW_STATS") {
      const raw = data.stats;
      if (!raw || typeof raw !== "object") return;
      // 숫자로 쓸 수 있는 값만 받는다. 이상하면 null 로 둔다(추정하지 않는다).
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
      statsByChannel.set(channelId, {
        stats: {
          latencySec: num(raw.latencySec),
          width: num(raw.width),
          height: num(raw.height),
          fps: num(raw.fps),
          bitrateKbps: num(raw.bitrateKbps),
          paused: raw.paused === true,
          readyState: num(raw.readyState),
          networkState: num(raw.networkState),
          currentTime: num(raw.currentTime),
          seekableEnd: num(raw.seekableEnd),
        },
        updatedAt: Date.now(),
      });
      traceLatency(channelId);
      return;
    }
    if (data.type === "AUDIO_INTERACTION_RESOLVED") {
      // 칸이 '실제로 들리는 상태' 라고 알려 왔다. 그때만 경고를 거둔다.
      clearAudioNotice(channelId);
      return;
    }
    if (data.type === "AUDIO_INTERACTION_REQUIRED") {
      // 자동재생이 막혔다. 볼륨 버튼에 표시를 띄워 어디서든 풀 수 있게 한다.
      audioBlocked.add(channelId);
      renderVolume();
      // 메인은 화면에서 바로 풀 수 있게 기존 안내도 함께 띄운다.
      // ⚠ 볼륨 팝오버만 남기지 않는다. 자동재생 해제는 사용자 조작 안에서
      //   이뤄져야 확실한데, 칸 위 버튼이 가장 짧은 경로다.
      if (channelId === state.mainId) showAudioNotice(channelId);
    }
  });

  // 채팅 칸이 준비되면 덮개를 걷고 테마를 보낸다(채널을 바꿔 새로 뜰 때마다 온다).
  window.addEventListener("message", (event) => {
    if (event.origin !== CHZZK_ORIGIN) return;
    const data = event.data;
    if (data?.source !== MULTIVIEW_MESSAGE) return;
    if (data.type !== "CHAT_FRAME_READY") return;
    // ⚠ 정말 채팅 프레임이 보낸 것인지 확인한다.
    const frame = $("mvChatFrame");
    if (!frame || event.source !== frame.contentWindow) return;
    clearTimeout(chatReadyTimer);
    setChatStatus("ready");
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
