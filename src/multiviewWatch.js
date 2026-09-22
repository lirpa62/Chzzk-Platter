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
  const SYNC = globalThis.CheeseMultiviewSync;
  const DIAGNOSTICS = globalThis.CheeseMultiviewDiagnostics;
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
    sync: {
      mode: "off",
      referenceChannelId: null,
      manualOffsets: {},
      congested: false,
      diagnosticsEnabled: false,
    },
  };

  // 채널별 소리 설정. muteTouched는 보조 채널의 초기 음소거와 직접 조작을 구분한다.
  // ⚠ focus mode 를 껐다 켜도 사용자가 맞춰 둔 volume 은 지우지 않는다. 껐을 때
  //   이전 믹스를 그대로 되찾을 수 있어야 한다.
  const channelAudio = new Map();

  function audioOf(channelId) {
    let entry = channelAudio.get(channelId);
    if (!entry) {
      entry = { volume: 1, muted: channelId !== state.mainId, muteTouched: false };
      channelAudio.set(channelId, entry);
    }
    return entry;
  }

  // focus mode는 보조 채널만 강제로 끈다. 메인의 직접 음소거는 유지한다.
  function effectiveMuted(channelId) {
    if (state.audioFocusMode && channelId !== state.mainId) return true;
    return audioOf(channelId).muted;
  }

  function isSyncAudioProtected(channelId) {
    return effectiveMuted(channelId) === false;
  }

  // 실제로 내보낼 크기 = 전체 볼륨 × 채널 볼륨.
  function effectiveVolume(channelId) {
    const v = state.masterVolume * audioOf(channelId).volume;
    return Math.min(1, Math.max(0, v));
  }

  // 프레임 '처음 주소'. 여기 담는 건 시작 상태일 뿐이고, 이후 변경은 postMessage 로
  // 보낸다(주소를 다시 넣으면 방송이 처음부터 로드된다).
  // 칸마다 마지막으로 지시한 화질. 화질이 실제로 바뀌었는지 판정하는 데 쓴다.
  // ⚠ frameUrl 이 처음 만들 때부터 기록하므로 그보다 먼저 선언해 둔다.
  const lastQuality = new Map();
  // 화질 전환이 시작된 시각(channelId → ms). 그동안의 지연 0 은 믿지 않는다.
  const qualityTransitions = new Map();
  // 전환 상태를 무한정 들고 있지 않는다. 이 시간이 지나면 값이 0 이어도 그대로
  // 보여 준다(플레이어가 계속 0 을 주는 경우까지 '전환 중' 으로 덮지 않는다).
  const QUALITY_TRANSITION_MAX_MS = 5000;

  function frameUrl(channel, isMain, mainHighQuality) {
    const qualityPolicy = isMain && mainHighQuality ? "highest" : "cap-480";
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
    url.searchParams.set("cheeseMultiQualityPolicy", qualityPolicy);
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
  function postState(channelId, isMain, options = {}) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    const quality = isMain && state.mainHighQuality ? "high" : "480";
    const qualityPolicy = quality === "high" ? "highest" : "cap-480";
    const before = lastQuality.get(channelId);
    if (before !== quality) {
      lastQuality.set(channelId, quality);
      // ⚠ 전환 직후에는 플레이어가 스트림을 다시 잡느라 _getLiveLatency() 가
      //   잠깐 0 을 돌려준다(실측으로 확인된 과도 상태다). 그 0 을 '지연 0.0초'
      //   로 보여 주면 실제로 라이브 엣지에 붙은 것처럼 읽힌다. 그래서 전환이
      //   시작된 시각을 적어 두고, 그 사이의 0 만 '전환 중' 으로 다룬다.
      //   처음 지시(before 가 없을 때)는 전환이 아니라 시작이다.
      if (before !== undefined) {
        qualityTransitions.set(channelId, Date.now());
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
          qualityPolicy,
          // ⚠ 화질이 '그대로' 여도 칸에게 다시 확인시켜야 하는 때가 있다.
          //   프레임이 막 준비됐을 때가 그렇다 — 주소로 받은 상한과 지금 지시가
          //   같아 '바뀐 것 없음' 으로 지나가면, 플레이어가 아직 로딩 국면이라
          //   상한을 못 걸었던 칸이 그대로 고화질로 남는다.
          reconcileQuality: options.reconcileQuality === true,
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
    if (status === "loading" || status === "error" || status === "ended" || status === "ui-error") {
      clearChannelSync(channelId);
      if (status !== "loading") clearChannelMixer(channelId);
    }
    if (status === "ready" && frameStates.get(channelId) !== "ready") {
      syncReadyAt.set(channelId, Date.now());
    }
    frameStates.set(channelId, status);
    renderSync();
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
    promoteMainAudio(channelId);
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

  function promoteMainAudio(channelId) {
    const audio = audioOf(channelId);
    if (audio.muted && !audio.muteTouched) audio.muted = false;
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
  const mixerStates = new Map();
  const mixerPending = new Map();
  const mixerErrors = new Map();
  const mixerConfirm = new Set();
  const mixerGainDrafts = new Map();
  // 믹서 설정을 펼쳐 둔 채널(기본은 접힘 — 채널이 많을 때 목록이 길어진다).
  const mixerOpen = new Set();
  const mixerGainTimers = new Map();
  let mixerCommandSeq = 0;
  let mixerDragId = "";

  function requestMixerState(channelId) {
    if (currentStatus(channelId) !== "ready") return;
    const frame = cells.get(channelId)?.querySelector("iframe");
    frame?.contentWindow?.postMessage({ source: MULTIVIEW_MESSAGE,
      type: "MIXER_GET_STATE", channelId }, CHZZK_ORIGIN);
  }

  function sendMixerCommand(channelId, type, values = {}) {
    if (currentStatus(channelId) !== "ready") return false;
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return false;
    const key = `${channelId}:${type}`;
    const previous = mixerPending.get(key);
    if (previous) clearTimeout(previous.timer);
    const commandId = ++mixerCommandSeq;
    const timer = window.setTimeout(() => {
      if (mixerPending.get(key)?.commandId !== commandId) return;
      mixerPending.delete(key);
      mixerErrors.set(channelId, "응답이 없습니다. 다시 시도해 주세요.");
      if (type === "MIXER_FLUSH_GAIN") {
        mixerDragId = "";
        mixerGainDrafts.delete(channelId);
      }
      if (mixerDragId !== channelId) renderVolume();
    }, 4000);
    mixerPending.set(key, { commandId, timer });
    frame.contentWindow.postMessage({ source: MULTIVIEW_MESSAGE,
      type, channelId, commandId, ...values }, CHZZK_ORIGIN);
    return true;
  }

  function clearChannelMixer(channelId) {
    mixerStates.delete(channelId);
    mixerErrors.delete(channelId);
    mixerConfirm.delete(channelId);
    mixerGainDrafts.delete(channelId);
    clearTimeout(mixerGainTimers.get(channelId));
    mixerGainTimers.delete(channelId);
    for (const [key, pending] of mixerPending) {
      if (!key.startsWith(`${channelId}:`)) continue;
      clearTimeout(pending.timer);
      mixerPending.delete(key);
    }
    if (mixerDragId === channelId) mixerDragId = "";
  }

  function normalizeMixerSnapshot(raw) {
    if (!raw || typeof raw !== "object" || !Number.isSafeInteger(raw.revision) ||
        raw.revision < 0 || typeof raw.ready !== "boolean" ||
        typeof raw.enabled !== "boolean" || typeof raw.graphConflict !== "boolean" ||
        typeof raw.preset !== "string" || raw.preset.length > 128 ||
        typeof raw.presetDirty !== "boolean" ||
        !Number.isFinite(raw.gain) || !Number.isFinite(raw.gainMin) ||
        !Number.isFinite(raw.gainMax) || !Number.isFinite(raw.gainStep) ||
        raw.gainMin < 0 || raw.gainMax > 4 || raw.gainMin >= raw.gainMax ||
        raw.gainStep <= 0 || raw.gainStep > 1 || !Array.isArray(raw.presets) ||
        raw.presets.length > 100) return null;
    const presets = [];
    for (const item of raw.presets) {
      if (!item || typeof item.id !== "string" || !item.id || item.id.length > 128 ||
          typeof item.label !== "string" || item.label.length > 80 ||
          !["builtin", "custom"].includes(item.kind)) return null;
      presets.push({ id: item.id, label: item.label, kind: item.kind });
    }
    return { ready: raw.ready, enabled: raw.enabled,
      graphConflict: raw.graphConflict, preset: raw.preset,
      presetDirty: raw.presetDirty, gain: raw.gain,
      gainMin: raw.gainMin, gainMax: raw.gainMax, gainStep: raw.gainStep,
      presets, revision: raw.revision };
  }

  function acceptMixerSnapshot(channelId, raw) {
    const next = normalizeMixerSnapshot(raw);
    if (!next || next.revision < (mixerStates.get(channelId)?.revision ?? -1)) return false;
    mixerStates.set(channelId, next);
    if (mixerDragId !== channelId) renderVolume();
    return true;
  }

  const pct = (v) => `${Math.round(v * 100)}%`;

  // 볼륨 아이콘(lucide volume-x / volume-1 / volume-2). 폴더 아이콘과 같은 방식으로
  // 필요한 path 만 인라인으로 둔다(외부 lucide 런타임을 들이지 않는다).
  const VOLUME_ICONS = {
    x:
      '<path d="M11 4.7a.8.8 0 0 0-1.3-.6L6 7.3H3a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h3l3.7 3.2a.8.8 0 0 0 1.3-.6z"></path>' +
      '<line x1="22" y1="9" x2="16" y2="15"></line>' +
      '<line x1="16" y1="9" x2="22" y2="15"></line>',
    low:
      '<path d="M11 4.7a.8.8 0 0 0-1.3-.6L6 7.3H3a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h3l3.7 3.2a.8.8 0 0 0 1.3-.6z"></path>' +
      '<path d="M16 9a5 5 0 0 1 0 6"></path>',
    high:
      '<path d="M11 4.7a.8.8 0 0 0-1.3-.6L6 7.3H3a1 1 0 0 0-1 1v7.4a1 1 0 0 0 1 1h3l3.7 3.2a.8.8 0 0 0 1.3-.6z"></path>' +
      '<path d="M16 9a5 5 0 0 1 0 6"></path>' +
      '<path d="M19.4 5.6a10 10 0 0 1 0 12.8"></path>',
  };
  const volumeIcon = (kind) =>
    '<svg class="mv-vol-icon" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    (VOLUME_ICONS[kind] || VOLUME_ICONS.x) +
    "</svg>";

  // 음소거 버튼 하나만 지금 상태에 맞춘다.
  //
  // ⚠ 슬라이더를 끄는 동안 renderVolume() 으로 패널을 통째로 다시 그리면, 지금
  //   잡고 있는 <input type="range"> 가 새 요소로 교체돼 드래그가 끊긴다. 그래서
  //   바뀐 버튼의 아이콘과 라벨만 갈아 끼운다.
  function syncVolumeButton(channelId) {
    const button = document.querySelector(
      `[data-mv-vol-mute="${CSS.escape(channelId)}"]`,
    );
    if (!button) return;
    const muted = effectiveMuted(channelId);
    button.innerHTML = volumeIcon(volumeIconKind(channelId));
    button.setAttribute("aria-pressed", String(muted));
    const label = muted ? "음소거 해제" : "음소거";
    button.setAttribute("aria-label", `${channelName(channelId)} ${label}`);
    button.title = label;
  }

  // 전체 볼륨은 모든 칸의 실제 출력에 곱해지므로 버튼도 모두 다시 맞춘다.
  function syncAllVolumeButtons() {
    for (const c of state.chosen) syncVolumeButton(c.channelId);
  }

  // 실제로 나오는 소리를 기준으로 아이콘을 고른다(전체 볼륨까지 곱해진 값).
  function volumeIconKind(channelId) {
    if (effectiveMuted(channelId)) return "x";
    const v = effectiveVolume(channelId);
    if (!(v > 0)) return "x";
    return v > 0.5 ? "high" : "low";
  }

  // 접기/펼치기 버튼은 '실제 조작 UI 가 있을 때' 만 둔다. 상태 안내 문구
  // (사용 불가·확인 중·충돌)는 접을 것이 없으므로 그대로 보여 준다.
  function hasMixerControls(channelId) {
    const status = currentStatus(channelId);
    if (status === "ended" || status === "error") return false;
    const mixer = mixerStates.get(channelId);
    return !!mixer?.ready && !mixer.graphConflict;
  }

  function mixerControlsMarkup(channelId) {
    const id = esc(channelId);
    const mixer = mixerStates.get(channelId);
    const status = currentStatus(channelId);
    if (status === "ended" || status === "error") {
      return '<p class="mv-mixer-status">오디오 믹서 사용 불가</p>';
    }
    if (!mixer?.ready) {
      return '<p class="mv-mixer-status">오디오 믹서 상태 확인 중…</p>';
    }
    if (mixer.graphConflict) {
      return '<p class="mv-mixer-status">다른 확장 프로그램과 오디오 그래프가 충돌해 사용할 수 없습니다.</p>';
    }
    const options = (kind) => mixer.presets.filter((item) => item.kind === kind)
      .map((item) => `<option value="${esc(item.id)}"${!mixer.presetDirty && item.id === mixer.preset ? " selected" : ""}>${esc(item.label)}</option>`).join("");
    const selected = mixer.presets.some((item) => item.id === mixer.preset);
    const draft = mixerGainDrafts.get(channelId);
    const gain = Number.isFinite(draft) ? draft : mixer.gain;
    const error = mixerErrors.get(channelId);
    const open = mixerOpen.has(channelId);
    return `<div class="mv-mixer-controls"${open ? "" : " hidden"}>` +
      `<label class="mv-mixer-power">오디오 믹서 <input type="checkbox" data-mv-mixer-enabled="${id}"${mixer.enabled ? " checked" : ""}></label>` +
      `<label class="mv-mixer-preset">프리셋 <select data-mv-mixer-preset="${id}" aria-label="${esc(channelName(channelId))} 오디오 믹서 프리셋">` +
      ((mixer.presetDirty || !selected) ? '<option value="" selected disabled>사용자 조정</option>' : "") +
      `<optgroup label="기본 프리셋">${options("builtin")}</optgroup>` +
      (mixer.presets.some((item) => item.kind === "custom")
        ? `<optgroup label="커스텀">${options("custom")}</optgroup>` : "") +
      `</select></label>` +
      `<label class="mv-mixer-gain">게인 <input type="range" data-mv-mixer-gain="${id}" data-gain-step="${mixer.gainStep}" min="${mixer.gainMin}" max="${mixer.gainMax}" step="any" value="${gain}" aria-label="${esc(channelName(channelId))} 오디오 믹서 게인"><output>${Math.round(gain * 100)}%</output></label>` +
      (mixerConfirm.has(channelId) ? `<div class="mv-mixer-confirm">이 채널은 '항상 켜기' 상태입니다. 끄면 이 채널을 항상 켜기 대상에서 제외합니다. <button type="button" data-mv-mixer-confirm="${id}">끄기</button><button type="button" data-mv-mixer-cancel="${id}">취소</button></div>` : "") +
      (error ? `<p class="mv-mixer-error">${esc(error)}</p>` : "") +
      `</div>`;
  }

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
          `<div class="mv-vol-channel" data-mv-vol-row="${id}">` +
          `<div class="mv-vol-row${forcedOff ? " is-off" : ""}">` +
          // ⚠ 이름과 '메인' 배지를 나눈다. 한 덩어리에 overflow:hidden 을 두면
          //   이름이 길 때 배지까지 함께 잘려 역할이 안 보인다.
          `<span class="mv-vol-name">` +
          `<span class="mv-vol-name-text" title="${esc(c.channelName)}">` +
          `${esc(c.channelName)}</span>` +
          (isMain ? `<span class="mv-main-badge">메인</span>` : "") +
          `</span>` +
          `<button type="button" class="mv-vol-mute" data-mv-vol-mute="${id}"` +
          ` aria-pressed="${muted}"` +
          ` aria-label="${esc(c.channelName)} ${muted ? "음소거 해제" : "음소거"}"` +
          ` title="${muted ? "음소거 해제" : "음소거"}"` +
          `${forcedOff ? " disabled" : ""}>` +
          `${volumeIcon(volumeIconKind(c.channelId))}</button>` +
          `<input type="range" class="mv-vol-range" min="0" max="100" step="1"` +
          ` value="${Math.round(audio.volume * 100)}"` +
          ` data-mv-vol-channel="${id}"` +
          ` aria-label="${esc(c.channelName)} 볼륨"` +
          `${forcedOff ? " disabled" : ""}>` +
          `<span class="mv-vol-pct">${pct(audio.volume)}</span>` +
          (hasMixerControls(c.channelId)
            ? `<button type="button" class="mv-vol-mixer-toggle"` +
              ` data-mv-mixer-toggle="${id}"` +
              ` aria-expanded="${mixerOpen.has(c.channelId)}"` +
              ` aria-label="${esc(c.channelName)} 오디오 믹서 설정"` +
              ` title="오디오 믹서 설정">` +
              `<svg viewBox="0 0 24 24" width="14" height="14" fill="none"` +
              ` stroke="currentColor" stroke-width="2.4" stroke-linecap="round"` +
              ` stroke-linejoin="round" aria-hidden="true">` +
              `<path d="m6 9 6 6 6-6"></path></svg></button>`
            : "") +
          `</div>` + mixerControlsMarkup(c.channelId) + `</div>`
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
      `<span>메인만 듣기</span></label>` +
      `<p class="mv-vol-focus-note">` +
      `켜면 보조 채널만 음소거합니다. 메인 채널의 음소거와 볼륨은 계속 조절할 수 있습니다.</p>` +
      `<div class="mv-vol-list">${rows}</div>`;
  }

  // ── 멀티뷰 라이브 싱크 ──────────────────────────────────────────────────
  const syncStats = new Map();
  const syncReadyAt = new Map();
  const syncGeneration = new Map();
  const syncSeekAt = new Map();
  const syncRates = new Map();
  const pendingSyncCommands = new Map();
  const syncRetryAt = new Map();
  const syncDiagnostics = DIAGNOSTICS.createRecorder();
  let syncCommandSeq = 0;
  let syncCongestion = { active: false, since: 0 };
  let syncTimer = 0;
  let syncNotice = "";
  let syncDiagnosticsStartedAt = 0;
  let syncDiagnosticsNotice = "";

  function syncChannelName(channelId) {
    return state.chosen.find((channel) => channel.channelId === channelId)?.channelName || "";
  }

  function recordSyncDiagnostic(type, fields = {}, timestamp) {
    if (!state.sync.diagnosticsEnabled) return false;
    const at = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (!syncDiagnosticsStartedAt) syncDiagnosticsStartedAt = at;
    return syncDiagnostics.add({
      type,
      timestamp: at,
      elapsedMs: Math.max(0, at - syncDiagnosticsStartedAt),
      ...fields,
    });
  }

  function diagnosticDesiredValue(value) {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (!value || typeof value !== "object") return null;
    const safe = {};
    for (const key of ["currentTime", "manual", "offset", "commitOffset"]) {
      if (typeof value[key] === "boolean" || Number.isFinite(value[key])) safe[key] = value[key];
    }
    return safe;
  }

  function recordSyncSample(channelId, stats, timestamp) {
    if (!state.sync.diagnosticsEnabled) return;
    const referenceChannelId = state.sync.referenceChannelId;
    const referenceStats = referenceChannelId === channelId
      ? stats : syncStats.get(referenceChannelId);
    const manualOffset = state.sync.manualOffsets[channelId] || 0;
    const targetDelaySec = SYNC.targetDelay(referenceStats, manualOffset);
    const syncErrorSec = targetDelaySec !== null && stats.nativeDelaySec !== null
      ? targetDelaySec - stats.nativeDelaySec : null;
    const readyAt = syncReadyAt.get(channelId);
    recordSyncDiagnostic("sample", {
      channelId,
      channelName: syncChannelName(channelId),
      generation: stats.generation,
      frameStatus: currentStatus(channelId),
      syncMode: state.sync.mode,
      referenceChannelId,
      nativeDelaySec: stats.nativeDelaySec,
      bufferAheadSec: stats.bufferAheadSec,
      edgeLagSec: stats.edgeLagSec,
      playbackRate: stats.playbackRate,
      syncRateOwned: stats.syncRateOwned,
      userRateOverride: stats.userRateOverride,
      audioProtected: isSyncAudioProtected(channelId),
      manualOffset,
      targetDelaySec,
      syncErrorSec,
      settling: Number.isFinite(readyAt) && timestamp - readyAt < SYNC.LIMITS.settlingMs,
      congested: state.sync.congested,
    }, timestamp);
  }

  function recordReferenceChange(fromChannelId, toChannelId, cause, timestamp = Date.now()) {
    if (!state.sync.diagnosticsEnabled || fromChannelId === toChannelId) return;
    recordSyncDiagnostic("reference-change", {
      fromChannelId: fromChannelId || null,
      toChannelId: toChannelId || null,
      cause,
      fromDelaySec: syncStats.get(fromChannelId)?.nativeDelaySec ?? null,
      toDelaySec: syncStats.get(toChannelId)?.nativeDelaySec ?? null,
    }, timestamp);
  }

  function recordCongestionChange(active, ids, timestamp) {
    if (!state.sync.diagnosticsEnabled) return;
    const edgeLagByChannel = {};
    const affectedChannels = [];
    for (const id of ids) {
      const edgeLag = syncStats.get(id)?.edgeLagSec;
      edgeLagByChannel[id] = Number.isFinite(edgeLag) ? edgeLag : null;
      if (Number.isFinite(edgeLag) && edgeLag >= SYNC.LIMITS.congestionEdgeSec) {
        affectedChannels.push(id);
      }
    }
    recordSyncDiagnostic("congestion-change", {
      active,
      affectedChannels,
      edgeLagByChannel,
    }, timestamp);
  }

  function diagnosticsPayload(exportedAt = Date.now()) {
    const startedAt = syncDiagnosticsStartedAt || exportedAt;
    return DIAGNOSTICS.createExport({
      records: syncDiagnostics.toArray(),
      startedAt,
      exportedAt,
      channelCount: state.chosen.length,
      limits: SYNC.LIMITS,
    });
  }

  async function copySyncDiagnosticsSummary() {
    if (!syncDiagnostics.size) return;
    const text = DIAGNOSTICS.formatSummary(diagnosticsPayload().summary);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand?.("copy")) throw new Error("copy failed");
        textarea.remove();
      }
      syncDiagnosticsNotice = "진단 요약을 복사했습니다.";
    } catch {
      syncDiagnosticsNotice = "진단 요약을 복사하지 못했습니다.";
    }
    renderSync(true);
  }

  function diagnosticsFilename(timestamp) {
    const date = new Date(timestamp);
    const part = (value) => String(value).padStart(2, "0");
    return `chzzk-multiview-sync-diagnostics-${date.getFullYear()}` +
      `${part(date.getMonth() + 1)}${part(date.getDate())}-` +
      `${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}.json`;
  }

  function exportSyncDiagnostics() {
    if (!syncDiagnostics.size) return;
    const exportedAt = Date.now();
    const blob = new Blob([JSON.stringify(diagnosticsPayload(exportedAt), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = diagnosticsFilename(exportedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    syncDiagnosticsNotice = "진단 JSON을 저장했습니다.";
    renderSync(true);
  }

  function clearSyncDiagnostics() {
    syncDiagnostics.clear();
    syncDiagnosticsStartedAt = Date.now();
    syncDiagnosticsNotice = "진단 기록을 초기화했습니다.";
    renderSync(true);
  }

  function setSyncDiagnosticsEnabled(enabled) {
    state.sync.diagnosticsEnabled = enabled === true;
    if (state.sync.diagnosticsEnabled && !syncDiagnosticsStartedAt) {
      syncDiagnosticsStartedAt = Date.now();
    }
    syncDiagnosticsNotice = "";
    updateSyncPolling();
    renderSync(true);
  }

  document.addEventListener("click", (event) => {
    const path = event.composedPath?.() || [];
    if (!path.some((node) => node?.id === "mvSyncPop")) return;
    const control = path.find((node) => typeof node?.id === "string" &&
      node.id.startsWith("mvSyncDiagnostics"));
    if (!control) return;
    if (control.id === "mvSyncDiagnostics") {
      queueMicrotask(() => setSyncDiagnosticsEnabled(control.checked));
      return;
    }
    if (control.id === "mvSyncDiagnosticsCopy") {
      document.activeElement?.blur?.();
      void copySyncDiagnosticsSummary();
      return;
    }
    if (control.id === "mvSyncDiagnosticsExport") {
      document.activeElement?.blur?.();
      exportSyncDiagnostics();
      return;
    }
    if (control.id === "mvSyncDiagnosticsClear") {
      document.activeElement?.blur?.();
      clearSyncDiagnostics();
    }
  }, true);

  function sendSync(channelId, type, extra = {}) {
    if (currentStatus(channelId) !== "ready") return false;
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return false;
    try {
      frame.contentWindow.postMessage({ source: MULTIVIEW_MESSAGE, type, channelId, ...extra }, CHZZK_ORIGIN);
      return true;
    } catch { return false; }
  }

  function pendingSync(channelId, command) {
    return [...pendingSyncCommands.values()].find((entry) =>
      entry.channelId === channelId && entry.command === command);
  }

  function cancelPendingSync(channelId) {
    for (const [id, entry] of pendingSyncCommands) {
      if (entry.channelId !== channelId) continue;
      clearTimeout(entry.timeout);
      pendingSyncCommands.delete(id);
    }
  }

  function sendSyncCommand(channelId, command, type, extra = {}, desiredValue = null) {
    if (pendingSync(channelId, command) || Date.now() < (syncRetryAt.get(`${channelId}:${command}`) || 0)) return false;
    const commandId = ++syncCommandSeq;
    const entry = { commandId, channelId, command, sentAt: Date.now(), desiredValue,
      generation: syncGeneration.get(channelId) ?? null, timeout: 0 };
    if (!sendSync(channelId, type, { ...extra, commandId })) return false;
    recordSyncDiagnostic("command", {
      channelId,
      channelName: syncChannelName(channelId),
      commandId,
      command,
      desiredValue: diagnosticDesiredValue(desiredValue),
      generation: entry.generation,
      referenceChannelId: state.sync.referenceChannelId,
      manualOffset: state.sync.manualOffsets[channelId] || 0,
    }, entry.sentAt);
    entry.timeout = window.setTimeout(() => {
      if (pendingSyncCommands.get(commandId) !== entry) return;
      pendingSyncCommands.delete(commandId);
      const timedOutAt = Date.now();
      syncRetryAt.set(`${channelId}:${command}`, timedOutAt + SYNC.LIMITS.commandRetryMs);
      recordSyncDiagnostic("command-timeout", {
        channelId,
        channelName: syncChannelName(channelId),
        commandId,
        command,
        generation: entry.generation,
        waitedMs: Math.max(0, timedOutAt - entry.sentAt),
      }, timedOutAt);
      if (command === "nudge" || (command === "seek" && extra.manual)) {
        syncNotice = "보정 응답이 없어 적용하지 못했습니다.";
        renderSync();
      }
    }, SYNC.LIMITS.commandTimeoutMs);
    pendingSyncCommands.set(commandId, entry);
    return true;
  }

  function finishSyncCommand(channelId, data) {
    if (!Number.isSafeInteger(data.commandId) || data.commandId <= 0 ||
        !["seek", "nudge", "rate", "reset-rate"].includes(data.command) ||
        typeof data.applied !== "boolean" ||
        !(data.reason === null || (typeof data.reason === "string" &&
          ["no-video", "paused", "not-ready", "seeking", "ad", "range", "cooldown",
            "user-rate", "too-far", "invalid-state", "exception"].includes(data.reason))) ||
        !Number.isInteger(data.generation) || data.generation < 0 || data.generation > 1000000 ||
        (data.actualCurrentTime !== null &&
          (!Number.isFinite(data.actualCurrentTime) || data.actualCurrentTime < 0)) ||
        (data.actualPlaybackRate !== null &&
          (!Number.isFinite(data.actualPlaybackRate) || data.actualPlaybackRate < 0.5 ||
            data.actualPlaybackRate > 2))) return;
    const entry = pendingSyncCommands.get(data.commandId);
    if (!entry || entry.channelId !== channelId || entry.command !== data.command ||
        entry.generation !== data.generation) return;
    if (data.applied && entry.command === "rate" &&
        (!Number.isFinite(data.actualPlaybackRate) ||
          Math.abs(data.actualPlaybackRate - entry.desiredValue) > SYNC.LIMITS.userRateEpsilon)) return;
    const receivedAt = Date.now();
    recordSyncDiagnostic("command-result", {
      channelId,
      channelName: syncChannelName(channelId),
      commandId: data.commandId,
      command: data.command,
      applied: data.applied,
      reason: data.reason,
      actualCurrentTime: data.actualCurrentTime,
      actualPlaybackRate: data.actualPlaybackRate,
      generation: data.generation,
      roundTripMs: Math.max(0, receivedAt - entry.sentAt),
    }, receivedAt);
    clearTimeout(entry.timeout);
    pendingSyncCommands.delete(data.commandId);
    const retryKey = `${channelId}:${entry.command}`;
    if (!data.applied) {
      syncRetryAt.set(retryKey, Date.now() + SYNC.LIMITS.commandRetryMs);
      if (entry.command === "nudge" || (entry.command === "seek" && entry.desiredValue?.manual)) {
        syncNotice = `보정을 적용하지 못했습니다 (${data.reason || "상태 확인 필요"}).`;
      }
    } else {
      syncRetryAt.delete(retryKey);
      if (entry.command === "seek" || entry.command === "nudge") syncSeekAt.set(channelId, Date.now());
      if (entry.command === "nudge") {
        state.sync.manualOffsets[channelId] = entry.desiredValue.offset;
        syncNotice = "수동 보정을 적용했습니다.";
      }
      if (entry.command === "seek" && entry.desiredValue?.commitOffset) {
        state.sync.manualOffsets[channelId] = entry.desiredValue.offset;
        syncNotice = "보정값을 초기화했습니다.";
      }
      if (entry.command === "rate") {
        syncRates.set(channelId, data.actualPlaybackRate);
        if (state.sync.mode !== "auto") resetSyncRate(channelId);
      }
      if (entry.command === "reset-rate") {
        syncRates.delete(channelId);
        const stats = syncStats.get(channelId);
        if (stats) syncStats.set(channelId, {
          ...stats,
          playbackRate: data.actualPlaybackRate,
          syncRateOwned: false,
          userRateOverride: false,
        });
      }
    }
    updateSyncPolling();
    renderSync();
  }

  function resetSyncRate(channelId) {
    const pendingRate = pendingSync(channelId, "rate");
    const frameOwnsRate = syncStats.get(channelId)?.syncRateOwned === true;
    if (!syncRates.has(channelId) && !pendingRate && !frameOwnsRate) return;
    if (pendingRate) {
      clearTimeout(pendingRate.timeout);
      pendingSyncCommands.delete(pendingRate.commandId);
    }
    sendSyncCommand(channelId, "reset-rate", "RESET_SYNC_RATE");
  }

  function resetAllSyncRates() {
    for (const id of state.chosen.map((c) => c.channelId)) resetSyncRate(id);
  }

  function clearChannelSync(channelId, removeOffset = false) {
    resetSyncRate(channelId);
    cancelPendingSync(channelId);
    syncStats.delete(channelId);
    syncReadyAt.delete(channelId);
    syncGeneration.delete(channelId);
    syncSeekAt.delete(channelId);
    for (const command of ["seek", "nudge", "rate", "reset-rate"]) syncRetryAt.delete(`${channelId}:${command}`);
    syncRates.delete(channelId);
    if (removeOffset) delete state.sync.manualOffsets[channelId];
    if (state.sync.referenceChannelId === channelId) {
      state.sync.referenceChannelId = null;
    }
  }

  function syncEligibleIds(now = Date.now(), settled = false) {
    return state.chosen.map((c) => c.channelId).filter((id) =>
      currentStatus(id) === "ready" &&
      SYNC.eligible(syncStats.get(id), syncReadyAt.get(id), now, settled));
  }

  function selectSyncReference(now = Date.now()) {
    const ids = syncEligibleIds(now);
    const current = state.sync.referenceChannelId;
    if (state.sync.mode !== "auto" && current && ids.includes(current)) return current;
    const next = SYNC.reference(ids, syncStats, syncReadyAt, current, now);
    if (next && next !== current) {
      recordReferenceChange(current, next, state.sync.mode === "auto" ? "auto" : "manual", now);
      state.sync.manualOffsets = SYNC.rebaseOffsets(state.sync.manualOffsets, next,
        state.chosen.map((c) => c.channelId));
      state.sync.referenceChannelId = next;
      for (const c of state.chosen) cancelPendingSync(c.channelId);
      resetAllSyncRates();
    }
    return next;
  }

  function requestSyncStats() {
    for (const id of state.chosen.map((c) => c.channelId)) {
      if (currentStatus(id) === "ready") sendSync(id, "REQUEST_FRAME_SYNC_STATS");
    }
  }

  function syncPanelOpen() {
    return $("mvSyncPop")?.hidden === false;
  }

  function updateSyncPolling() {
    const frameOwnsRate = state.chosen.some((c) =>
      syncStats.get(c.channelId)?.syncRateOwned === true);
    const needed = !document.hidden && (syncPanelOpen() || state.sync.mode === "auto" ||
      pendingSyncCommands.size > 0 || syncRates.size > 0 || frameOwnsRate ||
      state.sync.diagnosticsEnabled);
    if (!needed && syncTimer) {
      clearInterval(syncTimer);
      syncTimer = 0;
    }
    if (needed && !syncTimer) {
      requestSyncStats();
      syncTimer = window.setInterval(syncTick, SYNC.LIMITS.sampleMs);
    }
  }

  function setSyncRate(id, rate) {
    if (rate === 1) {
      resetSyncRate(id);
      return;
    }
    if (pendingSync(id, "reset-rate")) return;
    if (syncRates.get(id) === rate) return;
    sendSyncCommand(id, "rate", "APPLY_SYNC_RATE", { rate }, rate);
  }

  function alignSync(ids = null, manual = false, offsetOverrides = null,
    allowAudioProtectedSeek = false) {
    const now = Date.now();
    const ref = selectSyncReference(now);
    if (!ref || now - (syncReadyAt.get(ref) || now) < SYNC.LIMITS.settlingMs) {
      syncNotice = "기준 채널의 재생 정보가 준비되지 않았습니다.";
      renderSync();
      return;
    }
    const refStats = syncStats.get(ref);
    let changed = 0;
    let partial = 0;
    let protectedCount = 0;
    for (const id of ids || syncEligibleIds(now)) {
      if (id === ref || !SYNC.eligible(syncStats.get(id), syncReadyAt.get(id), now)) continue;
      if (isSyncAudioProtected(id) && !allowAudioProtectedSeek) {
        protectedCount += 1;
        continue;
      }
      if (now - (syncSeekAt.get(id) || 0) < (manual ? 250 : SYNC.LIMITS.seekCooldownMs)) continue;
      const requestedOffset = offsetOverrides && Object.hasOwn(offsetOverrides, id)
        ? offsetOverrides[id] : state.sync.manualOffsets[id] || 0;
      const delay = SYNC.targetDelay(refStats, requestedOffset);
      const target = SYNC.seekTarget(syncStats.get(id), delay, manual ? 0.05 : SYNC.LIMITS.seekThresholdSec);
      if (target === null) {
        if (offsetOverrides && Math.abs(syncStats.get(id).nativeDelaySec - delay) < 0.05) {
          state.sync.manualOffsets[id] = requestedOffset;
        }
        continue;
      }
      const withinOneSeek = Math.abs(syncStats.get(id).nativeDelaySec - delay) <= SYNC.LIMITS.maxSeekSec;
      if (sendSyncCommand(id, "seek", "APPLY_SYNC_SEEK",
        { currentTime: target, deltaSec: target - syncStats.get(id).currentTime, manual },
        { currentTime: target, manual, offset: requestedOffset,
          commitOffset: !!offsetOverrides && withinOneSeek })) {
        changed += 1;
        if (offsetOverrides && !withinOneSeek) partial += 1;
      }
    }
    syncNotice = partial ? "한 번에 최대 4초만 이동합니다. 남은 차이는 다시 보정해 주세요." :
      changed ? `${changed}개 채널에 보정을 요청했습니다.` :
        protectedCount ? "소리가 켜진 채널은 자동 이동하지 않았습니다." :
        "보정 가능한 차이가 없거나 잠시 기다려야 합니다.";
    renderSync();
  }

  function syncTick() {
    if (document.hidden) {
      resetAllSyncRates();
      return;
    }
    const now = Date.now();
    requestSyncStats();
    if (state.sync.mode !== "auto") resetAllSyncRates();
    const ids = syncEligibleIds(now);
    if (!state.sync.referenceChannelId) selectSyncReference(now);
    const settledIds = syncEligibleIds(now, true);
    const fresh = new Map(settledIds.map((id) => [id, syncStats.get(id)]));
    const previousCongestion = syncCongestion.active;
    syncCongestion = SYNC.congestion(syncCongestion, fresh, settledIds, now);
    if (syncCongestion.active !== previousCongestion) {
      recordCongestionChange(syncCongestion.active, settledIds, now);
    }
    state.sync.congested = syncCongestion.active;
    if (state.sync.mode === "auto") {
      const ref = selectSyncReference(now);
      const refStats = ref && syncStats.get(ref);
      for (const c of state.chosen) {
        const id = c.channelId;
        if (!refStats || !settledIds.includes(ref) || id === ref || !ids.includes(id) ||
            now - (syncReadyAt.get(id) || now) < SYNC.LIMITS.settlingMs ||
            state.sync.congested ||
            syncStats.get(id).userRateOverride ||
            (syncStats.get(id).playbackRate !== null &&
              Math.abs(syncStats.get(id).playbackRate - 1) > SYNC.LIMITS.userRateEpsilon &&
              !syncStats.get(id).syncRateOwned)) {
          resetSyncRate(id);
          continue;
        }
        const delay = SYNC.targetDelay(refStats, state.sync.manualOffsets[id] || 0);
        const error = delay - syncStats.get(id).nativeDelaySec;
        if (Math.abs(error) >= SYNC.LIMITS.seekThresholdSec &&
            now - (syncSeekAt.get(id) || 0) >= SYNC.LIMITS.seekCooldownMs) {
          const target = SYNC.seekTarget(syncStats.get(id), delay);
          // 자동 모드에서 기준보다 뒤처진 채널은 seek로 앞당기지 않는다.
          if (!isSyncAudioProtected(id) && target !== null &&
              target < syncStats.get(id).currentTime) {
            sendSyncCommand(id, "seek", "APPLY_SYNC_SEEK",
              { currentTime: target, deltaSec: target - syncStats.get(id).currentTime },
              { currentTime: target, manual: false });
          }
        }
        setSyncRate(id, SYNC.rateFor(error, syncStats.get(id).syncRateOwned));
      }
    }
    renderSync();
    updateSyncPolling();
  }

  function fmtSyncSeconds(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)}초` : "-";
  }

  function renderSync(force = false) {
    const value = $("mvSyncValue");
    if (value) value.textContent = state.sync.mode === "auto" ? "자동" :
      state.sync.mode === "manual" ? "수동" : "꺼짐";
    const panel = $("mvSyncPop");
    if (!panel || (panel.hidden && !force)) return;
    if (!force && panel.contains(document.activeElement) && document.activeElement !== panel) return;
    const now = Date.now();
    const ref = state.sync.referenceChannelId;
    const diagnosticsElapsed = syncDiagnosticsStartedAt
      ? Math.max(0, now - syncDiagnosticsStartedAt) : 0;
    const diagnosticsStatus = state.sync.diagnosticsEnabled
      ? `기록 중 · ${DIAGNOSTICS.formatDuration(diagnosticsElapsed)} · ${syncDiagnostics.size.toLocaleString()}개 기록`
      : syncDiagnostics.size
        ? `기록 안 함 · ${syncDiagnostics.size.toLocaleString()}개 보관`
        : "기록 안 함";
    const rows = state.chosen.map((c) => {
      const id = c.channelId;
      const status = currentStatus(id);
      const st = syncStats.get(id);
      const fresh = status === "ready" && st && now - st.receivedAt <= SYNC.LIMITS.staleMs;
      const ready = fresh && SYNC.eligible(st, syncReadyAt.get(id), now);
      const settling = ready && now - syncReadyAt.get(id) < SYNC.LIMITS.settlingMs;
      const label = status === "ended" ? "종료" : status === "error" || status === "ui-error" ? "오류" :
        !fresh ? "측정 대기" : st.paused ? "일시정지" : st.readyState < 2 ? "재생 준비 중" :
        !ready ? "측정 불가" : settling ? "안정화 중" :
        state.sync.congested ? "연결 지연" : id === ref ? "기준" :
        st.userRateOverride ||
        (Math.abs((st.playbackRate || 1) - 1) > SYNC.LIMITS.userRateEpsilon && !st.syncRateOwned)
          ? "수동 속도" : st.syncRateOwned ? "자동 보정 중" : "준비됨";
      const offset = state.sync.manualOffsets[id] || 0;
      const nudgePending = !!pendingSync(id, "nudge") ||
        !!pendingSync(id, "seek")?.desiredValue?.commitOffset;
      return `<div class="mv-sync-row">` +
        `<div class="mv-sync-row-head"><strong title="${esc(c.channelName)}">${esc(c.channelName)}</strong>` +
        `<span>${esc(label)}</span></div>` +
        `<div class="mv-sync-metrics"><span>지연 ${fmtSyncSeconds(st?.nativeDelaySec)}</span>` +
        `<span>버퍼 ${fmtSyncSeconds(st?.bufferAheadSec)}</span>` +
        `<span>엣지 ${fmtSyncSeconds(st?.edgeLagSec)}</span>` +
        `<span>속도 ${Number.isFinite(st?.playbackRate) ? st.playbackRate.toFixed(2) + "×" : "-"}</span></div>` +
        `<div class="mv-sync-controls">` +
        `<button type="button" data-mv-sync-ref="${id}" ${!ready || id === ref ? "disabled" : ""}>기준</button>` +
        `<button type="button" data-mv-sync-offset="${id}" data-step="-0.5" ${!ready || !ref || id === ref || nudgePending ? "disabled" : ""}>-0.5</button>` +
        `<button type="button" data-mv-sync-offset="${id}" data-step="-0.1" ${!ready || !ref || id === ref || nudgePending ? "disabled" : ""}>-0.1</button>` +
        `<output>${offset >= 0 ? "+" : ""}${offset.toFixed(1)}초${nudgePending ? " · 적용 중" : ""}</output>` +
        `<button type="button" data-mv-sync-offset="${id}" data-step="0.1" ${!ready || !ref || id === ref || nudgePending ? "disabled" : ""}>+0.1</button>` +
        `<button type="button" data-mv-sync-offset="${id}" data-step="0.5" ${!ready || !ref || id === ref || nudgePending ? "disabled" : ""}>+0.5</button>` +
        `<button type="button" data-mv-sync-clear="${id}" ${!offset || nudgePending ? "disabled" : ""} aria-label="${esc(c.channelName)} 보정 초기화" title="보정 초기화">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
        `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>` +
        `</div></div>`;
    }).join("");
    panel.innerHTML = `<div class="mv-sync-actions">` +
      `<label><input type="checkbox" id="mvSyncAuto" ${state.sync.mode === "auto" ? "checked" : ""}> 자동 싱크</label>` +
      `<button type="button" id="mvSyncAlign">느린 채널에 맞추기</button>` +
      `<button type="button" id="mvSyncClear">보정 초기화</button></div>` +
      (state.sync.congested ? `<p class="mv-sync-warning">여러 방송의 연결이 지연되고 있습니다. 자동 보정을 잠시 멈춥니다.</p>` : "") +
      (syncNotice ? `<p class="mv-sync-notice" role="status">${esc(syncNotice)}</p>` : "") +
      `<div class="mv-sync-list">${rows}</div>` +
      `<section class="mv-sync-diagnostics" aria-label="싱크 진단">` +
      `<div class="mv-sync-diagnostics-head"><strong>진단</strong>` +
      `<label><input type="checkbox" id="mvSyncDiagnostics"` +
      `${state.sync.diagnosticsEnabled ? " checked" : ""}> 싱크 진단 기록</label></div>` +
      `<p class="mv-sync-diagnostics-status">${esc(diagnosticsStatus)}</p>` +
      `<div class="mv-sync-diagnostics-actions">` +
      `<button type="button" id="mvSyncDiagnosticsCopy"${syncDiagnostics.size ? "" : " disabled"}>요약 복사</button>` +
      `<button type="button" id="mvSyncDiagnosticsExport"${syncDiagnostics.size ? "" : " disabled"}>JSON 내보내기</button>` +
      `<button type="button" id="mvSyncDiagnosticsClear"${syncDiagnostics.size ? "" : " disabled"}>초기화</button>` +
      `</div>` +
      (syncDiagnosticsNotice
        ? `<p class="mv-sync-diagnostics-notice" role="status">${esc(syncDiagnosticsNotice)}</p>` : "") +
      `</section>`;
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

  // 이 칸의 지연을 어떻게 보여 줄지 정한다.
  //
  // ⚠ 지연 0 을 전역으로 '이상한 값' 으로 치지 않는다. 화질을 막 바꾼 칸에서만
  //   과도 상태로 본다. 화질이 바뀌지 않은 칸은 0 이 와도 그대로 보여 준다.
  function latencyText(channelId, latencySec) {
    const startedAt = qualityTransitions.get(channelId);
    if (startedAt !== undefined) {
      // 쓸 수 있는 값이 왔으면 전환이 끝난 것이다. 바로 숫자로 돌아간다.
      if (Number.isFinite(latencySec) && latencySec > 0) {
        qualityTransitions.delete(channelId);
      } else if (Date.now() - startedAt > QUALITY_TRANSITION_MAX_MS) {
        // 너무 오래 0 이면 더는 전환 탓으로 두지 않는다(그대로 보여 준다).
        qualityTransitions.delete(channelId);
      } else {
        return "전환 중";
      }
    }
    return fmtLatency(latencySec);
  }
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
          `<td>${latencyText(c.channelId, st.latencySec)}</td>` +
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
      `<tbody>${rows}</tbody></table>`;
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
    updateSyncPolling();
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
    if (name === "volume" && open) {
      renderVolume();
      for (const channel of state.chosen) requestMixerState(channel.channelId);
    }
    if (name === "stats") {
      if (open) startStatsPolling();
      else stopStatsPolling();
    }
    if (name === "sync") {
      if (open) renderSync();
      updateSyncPolling();
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

  // ── 빠른 채널 관리 ───────────────────────────────────────────────────────
  // 격자 위아래 남는 자리에 띄운다. 고르기 화면까지 가지 않고 빼기·바꾸기를 한다.
  //
  // ⚠ 채널을 빼도 남은 칸은 다시 만들지 않는다(만들면 방송이 처음부터 로드된다).
  //   빠진 칸만 지우고 배치를 새 채널 수에 맞는 것으로 바꾼다.
  let quickCandidates = null;
  const quickSize = { width: null, height: null };
  const quickResizeMinWidth = 420;
  const quickResizeMinHeight = 260;

  function clampQuickSize() {
    const panel = $("mvQuick");
    const stage = $("mvFramesFit");
    if (!panel || !stage || panel.hidden) return;
    const bounds = stage.getBoundingClientRect();
    const maxWidth = Math.max(1, bounds.width - 16);
    const maxHeight = Math.max(1, bounds.height - 16);
    if (quickSize.width !== null) {
      quickSize.width = Math.min(maxWidth, Math.max(Math.min(quickResizeMinWidth, maxWidth), quickSize.width));
      panel.style.width = `${quickSize.width}px`;
    }
    if (quickSize.height !== null) {
      quickSize.height = Math.min(maxHeight, Math.max(Math.min(quickResizeMinHeight, maxHeight), quickSize.height));
      panel.style.height = `${quickSize.height}px`;
    }
  }

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
    clampQuickSize();
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
    clearChannelSync(oldChannelId, true);
    clearChannelMixer(oldChannelId);
    if (oldFrame) oldFrame.src = "about:blank";
    oldCell?.remove();
    cells.delete(oldChannelId);
    clearTimeout(frameTimers.get(oldChannelId));
    frameTimers.delete(oldChannelId);
    frameStates.delete(oldChannelId);
    // 칸이 사라지면 그 칸의 화질 기록도 버린다. 남겨 두면 나중에 같은 채널을 다시
    // 넣었을 때 옛 화질과 비교해 엉뚱하게 '전환 중' 이 뜬다.
    lastQuality.delete(oldChannelId);
    qualityTransitions.delete(oldChannelId);

    // 자리를 그대로 두고 갈아 끼운다(채널 수가 같아 배치도 그대로 쓸 수 있다).
    const next = {
      channelId: id,
      channelName: String(newChannel.channelName || ""),
      channelImageUrl: String(newChannel.channelImageUrl || ""),
    };
    state.chosen = state.chosen.map((c, i) => (i === index ? next : c));
    renderSync();
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
  let quickLivePager = null;
  let quickSource = "following";
  let quickKeyword = "";
  let quickSections = []; // 전용 팔로잉 구역(폴더)
  let quickFolder = ""; // 고른 폴더(빈 문자열이면 전체)
  // ⚠ 요청은 순서대로 보내도 응답은 뒤섞여 온다. 마지막 요청의 응답만 그린다.
  let quickRequestId = 0;

  function getQuickLivePager() {
    if (!quickLivePager) {
      quickLivePager = SOURCES.createLivePager({ ttlMs: QUICK_TTL_MS });
    }
    return quickLivePager;
  }

  // 목록을 가져온다. 전용 팔로잉만 구역(폴더) 배열이고 나머지는 평평한 목록이다.
  // ⚠ 캐시 키를 구분한다. 같은 키에 평평한 목록과 구역 배열을 섞어 담으면 안 된다.
  async function quickRows(source, keyword) {
    const key =
      source === "search"
        ? `search:${keyword}`
        : source === "custom"
          ? "custom:sections"
          : source;
    if (source === "live") {
      const pager = getQuickLivePager();
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows;
    }
    const cached = quickCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!SOURCES) return source === "custom" ? [] : [];
    const value =
      source === "following"
        ? await SOURCES.loadFollowing()
        : source === "custom"
          ? await SOURCES.loadCustomSections()
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
    if (box) box.scrollTop = 0;
  }

  // 지금 폴더에 해당하는 후보만 남긴다(전체면 그대로).
  function quickVisibleRows() {
    if (!quickCandidates) return [];
    if (quickSource !== "custom" || !quickFolder) return quickCandidates;
    const section = quickSections.find((sec) => sec.id === quickFolder);
    return section ? section.rows || [] : [];
  }

  function quickCard(r, full) {
    const thumb = safeImageUrl(r.liveImageUrl);
    const avatar = safeImageUrl(r.channelImageUrl);
    const tags = Array.isArray(r.tags) ? r.tags : [];
    return (
      `<button type="button" class="mv-quick-card" data-mv-quick-add="${esc(r.channelId)}"` +
      `${full ? " disabled" : ""} title="${esc(r.channelName)}">` +
      `<span class="mv-quick-card-thumb${thumb ? "" : " is-fallback"}${r.adult ? " is-adult" : ""}">` +
      (thumb
        ? `<img src="${esc(thumb)}" alt="" loading="lazy">`
        : `<span class="mv-quick-card-empty"></span>`) +
      (r.adult ? `<span class="mv-card-sr-only">19 연령 제한</span>` : "") +
      `</span>` +
      `<span class="mv-quick-card-body">` +
      (avatar
        ? `<img class="mv-quick-card-avatar" src="${esc(avatar)}" alt="" loading="lazy">`
        : `<span class="mv-quick-card-avatar is-empty"></span>`) +
      `<span class="mv-quick-card-text">` +
      `<span class="mv-quick-card-title">${esc(r.liveTitle || "제목 없음")}</span>` +
      `<span class="mv-quick-card-name">${esc(r.channelName)}</span>` +
      `</span></span>` +
      ((r.category || tags.length) ? `<span class="mv-card-meta mv-quick-card-meta">` +
        (r.category ? `<span class="mv-card-category-chip">${esc(r.category)}</span>` : "") +
        tags.map((tag) => `<span class="mv-card-tag-chip">${esc(tag)}</span>`).join("") +
        `</span>` : "") +
      `</button>`
    );
  }

  function quickSkeletonCards(count = 4) {
    return (`<div class="mv-quick-card is-skeleton" aria-hidden="true">` +
      `<span class="mv-quick-card-thumb"></span>` +
      `<span class="mv-quick-card-body"><span class="mv-quick-card-avatar"></span>` +
      `<span class="mv-quick-card-text"><span class="mv-skeleton-line"></span>` +
      `<span class="mv-skeleton-line is-short"></span></span></span></div>`).repeat(count);
  }

  function syncQuickLiveRetry() {
    const box = $("mvQuickAdd");
    if (!box) return;
    box.querySelector(".mv-quick-retry")?.remove();
    if (quickSource === "live" && quickLivePager?.error && quickCandidates?.length) {
      box.insertAdjacentHTML("beforeend",
        '<button type="button" class="mv-quick-retry" data-mv-quick-retry="1">다음 목록 다시 불러오기</button>');
    }
  }

  async function loadMoreQuickLive() {
    if (quickSource !== "live" || $("mvQuick")?.hidden) return;
    const pager = getQuickLivePager();
    if (pager.loading || pager.done) return;
    const box = $("mvQuickAdd");
    box?.querySelector(".mv-quick-retry")?.remove();
    const beforeIds = new Set(
      [...(box?.querySelectorAll?.("[data-mv-quick-add]") || [])]
        .map((node) => node.dataset.mvQuickAdd),
    );
    box?.classList.add("is-loading-more");
    await pager.loadNext();
    box?.classList.remove("is-loading-more");
    if (quickSource !== "live" || pager !== quickLivePager) return;
    if (pager.error) {
      syncQuickLiveRetry();
      return;
    }
    quickCandidates = pager.rows;
    const have = new Set(state.chosen.map((c) => c.channelId));
    const full = !quickReplaceId && state.chosen.length >= 6;
    const added = quickCandidates.filter((row) =>
      !have.has(row.channelId) && !beforeIds.has(row.channelId));
    if (added.length) box?.insertAdjacentHTML("beforeend", added.map((row) => quickCard(row, full)).join(""));
  }

  function maybeLoadMoreQuickLive() {
    const box = $("mvQuickAdd");
    if (!box || $("mvQuick")?.hidden || quickSource !== "live" ||
        !quickLivePager || quickLivePager.error) return;
    // 격자는 위아래로 스크롤한다(예전 가로 캐러셀 기준을 세로로 바꿨다).
    const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (remaining <= Math.max(220, box.clientHeight * 0.75))
      void loadMoreQuickLive();
  }

  // 후보가 없을 때의 안내는 목록 종류마다 다르다.
  function quickEmptyMessage() {
    if (quickSource === "search") {
      return quickKeyword.trim()
        ? "찾는 채널이나 태그의 방송이 없습니다."
        : "채널 이름 또는 태그로 찾아보세요.";
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
    const previousScrollTop = box.scrollTop;
    if (quickCandidates === null) {
      box.setAttribute("aria-busy", "true");
      box.innerHTML = quickSkeletonCards();
      return;
    }
    box.removeAttribute("aria-busy");
    // 이미 보고 있는 채널은 후보에서 뺀다. 교체 대상 자신도 뺀다 — 같은 채널로
    // 갈아 끼우는 것은 replaceChannel 이 거르므로 눌러도 아무 일이 없다.
    const have = new Set(state.chosen.map((c) => c.channelId));
    const rest = quickVisibleRows().filter((r) => !have.has(r.channelId));
    if (!rest.length) {
      box.innerHTML = `<p class="mv-quick-empty">${esc(quickEmptyMessage())}</p>`;
      return;
    }
    // 교체 모드가 아니고 자리가 다 찼으면 더 담을 수 없다.
    const full = !quickReplaceId && state.chosen.length >= 6;
    box.innerHTML = rest.map((r) => quickCard(r, full)).join("");
    syncQuickLiveRetry();
    box.scrollTop = Math.min(
      previousScrollTop,
      Math.max(0, box.scrollHeight - box.clientHeight),
    );
    requestAnimationFrame(maybeLoadMoreQuickLive);
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
    clearChannelSync(channelId, true);
    clearChannelMixer(channelId);
    if (frame) frame.src = "about:blank";
    cell.remove();
    cells.delete(channelId);
    clearTimeout(frameTimers.get(channelId));
    frameTimers.delete(channelId);
    frameStates.delete(channelId);
    lastQuality.delete(channelId);
    qualityTransitions.delete(channelId);
    state.chosen = state.chosen.filter((c) => c.channelId !== channelId);
    renderSync();

    // 메인이 빠졌으면 남은 첫 채널을 메인으로 올린다.
    if (state.mainId === channelId) {
      state.mainId = state.chosen[0]?.channelId || "";
      if (state.mainId) {
        promoteMainAudio(state.mainId);
        postState(state.mainId, true);
      }
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

  // 지금 구성을 고르기 화면이 읽을 수 있게 넘겨 둔다(그 화면이 이 id 로 복원한다).
  async function saveHandoff() {
    if (!state.handoffId) return;
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

  function setupUrl() {
    const url = new URL(chrome.runtime.getURL(SETUP_PAGE));
    if (state.handoffId) url.searchParams.set("setup", state.handoffId);
    return url.toString();
  }

  // '고르기 화면 열기': 보던 방송은 그대로 두고 고르기 화면만 연다.
  //
  // ⚠ 이 탭을 고르기 화면으로 바꾸지 않는다. 그러면 칸이 전부 내려가 다시
  //   불러와야 한다. 이미 열어 둔 고르기 탭이 있으면 그리로 보내고, 없으면 새 탭을
  //   연다(같은 화면을 여러 개 띄우지 않는다).
  async function openSetupTab() {
    await saveHandoff();
    const href = setupUrl();
    try {
      // 우리 확장의 고르기 화면만 찾는다(주소 앞부분이 확장 고유 출처다).
      const base = chrome.runtime.getURL(SETUP_PAGE);
      const tabs = await chrome.tabs.query({ url: `${base}*` });
      const found = tabs.find((tab) => Number.isInteger(tab.id));
      if (found) {
        // 이미 열려 있던 탭은 지금 구성으로 맞춘 뒤 그 탭으로 옮겨 간다.
        await chrome.tabs.update(found.id, { url: href, active: true });
        if (Number.isInteger(found.windowId)) {
          await chrome.windows?.update?.(found.windowId, { focused: true });
        }
        return;
      }
      await chrome.tabs.create({ url: href });
    } catch {
      // 탭 API 를 쓸 수 없으면 새 창으로라도 연다(이 탭은 그대로 둔다).
      window.open(href, "_blank", "noopener");
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    const syncRef = target.closest?.("[data-mv-sync-ref]");
    if (syncRef) {
      const id = syncRef.dataset.mvSyncRef;
      if (!syncEligibleIds().includes(id)) return;
      recordReferenceChange(state.sync.referenceChannelId, id, "manual");
      state.sync.manualOffsets = SYNC.rebaseOffsets(state.sync.manualOffsets, id,
        state.chosen.map((c) => c.channelId));
      state.sync.referenceChannelId = id;
      state.sync.mode = "manual";
      for (const c of state.chosen) cancelPendingSync(c.channelId);
      resetAllSyncRates();
      updateSyncPolling();
      document.activeElement?.blur?.();
      alignSync(null, true);
      return;
    }
    const syncOffset = target.closest?.("[data-mv-sync-offset]");
    if (syncOffset) {
      const id = syncOffset.dataset.mvSyncOffset;
      const step = Number(syncOffset.dataset.step);
      if (!syncEligibleIds().includes(id) || id === state.sync.referenceChannelId ||
          ![-0.5, -0.1, 0.1, 0.5].includes(step)) return;
      const before = state.sync.manualOffsets[id] || 0;
      const next = Math.round((before + step) * 10) / 10;
      if (Math.abs(next) > 10 && Math.abs(next) > Math.abs(before)) return;
      if (next === before) return;
      const st = syncStats.get(id);
      const target = st.currentTime + before - next;
      if (target < st.seekableStart + 0.05 || target > st.seekableEnd - 0.05) {
        syncNotice = "현재 재생 가능한 구간 밖입니다.";
      } else if (Date.now() - (syncSeekAt.get(id) || 0) < 250 || pendingSync(id, "nudge")) {
        syncNotice = "잠시 후 다시 조절해 주세요.";
      } else {
        syncNotice = sendSyncCommand(id, "nudge", "APPLY_SYNC_NUDGE",
          { deltaSec: before - next }, { offset: next })
          ? "수동 보정을 적용 중입니다." : "잠시 후 다시 조절해 주세요.";
      }
      document.activeElement?.blur?.();
      renderSync();
      return;
    }
    const syncClear = target.closest?.("[data-mv-sync-clear]");
    if (syncClear) {
      const id = syncClear.dataset.mvSyncClear;
      if (!cells.has(id) || pendingSync(id, "nudge")) return;
      document.activeElement?.blur?.();
      alignSync([id], true, { [id]: 0 }, true);
      return;
    }
    if (target.closest?.("#mvSyncAlign")) {
      document.activeElement?.blur?.();
      requestSyncStats();
      window.setTimeout(() => {
        const next = SYNC.reference(syncEligibleIds(), syncStats, syncReadyAt,
          state.sync.referenceChannelId);
        if (next && next !== state.sync.referenceChannelId) {
          recordReferenceChange(state.sync.referenceChannelId, next, "manual");
          state.sync.manualOffsets = SYNC.rebaseOffsets(state.sync.manualOffsets, next,
            state.chosen.map((c) => c.channelId));
          state.sync.referenceChannelId = next;
          for (const c of state.chosen) cancelPendingSync(c.channelId);
          resetAllSyncRates();
        }
        alignSync();
      }, 400);
      return;
    }
    if (target.closest?.("#mvSyncClear")) {
      document.activeElement?.blur?.();
      alignSync(null, true, Object.fromEntries(state.chosen.map((c) => [c.channelId, 0])));
      return;
    }
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
      // 보던 방송은 그대로 두고 고르기 화면만 연다(이 탭을 떠나지 않는다).
      void openSetupTab();
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
    if (target.closest?.("[data-mv-quick-retry]")) {
      void loadMoreQuickLive();
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
      audio.muteTouched = true;
      // 음소거를 풀었는데 크기가 0 이면 아무 소리도 안 난다. 들리게 올려 준다.
      if (!audio.muted && audio.volume === 0) audio.volume = 1;
      postState(id, id === state.mainId);
      if (effectiveMuted(id)) clearAudioNotice(id);
      renderVolume();
      return;
    }
    const mixerToggle = target.closest?.("[data-mv-mixer-toggle]");
    if (mixerToggle) {
      const id = mixerToggle.dataset.mvMixerToggle;
      if (mixerOpen.has(id)) mixerOpen.delete(id);
      else mixerOpen.add(id);
      renderVolume();
      return;
    }
    const mixerConfirmButton = target.closest?.("[data-mv-mixer-confirm]");
    if (mixerConfirmButton) {
      const id = mixerConfirmButton.dataset.mvMixerConfirm;
      sendMixerCommand(id, "MIXER_SET_ENABLED", { enabled: false, confirmed: true });
      return;
    }
    const mixerCancelButton = target.closest?.("[data-mv-mixer-cancel]");
    if (mixerCancelButton) {
      mixerConfirm.delete(mixerCancelButton.dataset.mvMixerCancel);
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

  $("mvQuickAdd")?.addEventListener("scroll", maybeLoadMoreQuickLive, { passive: true });
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      clampQuickSize();
      maybeLoadMoreQuickLive();
    });
    observer.observe($("mvQuickAdd"));
    observer.observe($("mvFramesFit"));
  } else {
    window.addEventListener("resize", () => {
      clampQuickSize();
      maybeLoadMoreQuickLive();
    }, { passive: true });
  }

  const quickResize = $("mvQuickResize");
  let quickDrag = null;
  quickResize?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const bounds = $("mvQuick").getBoundingClientRect();
    quickDrag = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
    quickResize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  quickResize?.addEventListener("pointermove", (event) => {
    if (!quickDrag || !quickResize.hasPointerCapture(event.pointerId)) return;
    quickSize.width = quickDrag.width + (event.clientX - quickDrag.x) * 2;
    quickSize.height = quickDrag.height + event.clientY - quickDrag.y;
    clampQuickSize();
  });
  const finishQuickResize = () => { quickDrag = null; };
  quickResize?.addEventListener("pointerup", finishQuickResize);
  quickResize?.addEventListener("pointercancel", finishQuickResize);
  quickResize?.addEventListener("lostpointercapture", finishQuickResize);
  quickResize?.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 50 : 20;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const bounds = $("mvQuick").getBoundingClientRect();
    quickSize.width = (quickSize.width ?? bounds.width) +
      (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0);
    quickSize.height = (quickSize.height ?? bounds.height) +
      (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0);
    clampQuickSize();
    event.preventDefault();
  });

  function queueMixerGain(channelId, gain) {
    mixerGainDrafts.set(channelId, gain);
    if (mixerGainTimers.has(channelId)) return;
    mixerGainTimers.set(channelId, window.setTimeout(() => {
      mixerGainTimers.delete(channelId);
      sendMixerCommand(channelId, "MIXER_SET_GAIN", { gain: mixerGainDrafts.get(channelId) });
    }, 80));
  }

  document.addEventListener("pointerdown", (event) => {
    const gain = event.target.closest?.("[data-mv-mixer-gain]");
    if (gain) mixerDragId = gain.dataset.mvMixerGain;
  });
  document.addEventListener("pointercancel", (event) => {
    if (event.target.closest?.("[data-mv-mixer-gain]")) mixerDragId = "";
  });

  // 볼륨 슬라이더. input 마다 전체를 다시 그리면 끌 때 끊기므로, 끄는 동안에는
  // 숫자만 바꾸고 프레임에 값을 내려 준다(전체 다시 그리기는 하지 않는다).
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
    const mixerId = el.dataset.mvMixerGain;
    if (mixerId) {
      const gain = Number(el.value);
      const mixer = mixerStates.get(mixerId);
      if (!mixer || !Number.isFinite(gain) || gain < mixer.gainMin || gain > mixer.gainMax) return;
      mixerDragId = mixerId;
      el.closest(".mv-mixer-gain")?.querySelector("output")?.replaceChildren(`${Math.round(gain * 100)}%`);
      queueMixerGain(mixerId, gain);
      return;
    }
    const next = Math.min(1, Math.max(0, Number(el.value) / 100));
    if (!Number.isFinite(next)) return;

    if (el.dataset.mvVolMaster) {
      state.masterVolume = next;
      el.parentElement
        ?.querySelector(".mv-vol-pct")
        ?.replaceChildren(pct(next));
      postAllAudio();
      // 전체 볼륨은 모든 칸의 실제 출력을 바꾼다 → 아이콘도 전부 다시 맞춘다.
      syncAllVolumeButtons();
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
      audio.muteTouched = true;
      postAllAudio();
      renderVolume();
      return;
    }
    if (next > 0 && audio.muted) {
      audio.muted = false;
      audio.muteTouched = true;
    }
    postState(channelId, channelId === state.mainId);
    // 끄는 동안에도 아이콘이 바로 따라오게 한다(50% 아래는 volume-1, 0 은 x).
    syncVolumeButton(channelId);
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target?.dataset?.mvMixerEnabled) {
      sendMixerCommand(target.dataset.mvMixerEnabled, "MIXER_SET_ENABLED", {
        enabled: target.checked === true,
      });
      target.checked = !target.checked;
      return;
    }
    if (target?.dataset?.mvMixerPreset) {
      const id = target.dataset.mvMixerPreset;
      if (target.value) sendMixerCommand(id, "MIXER_SET_PRESET", { presetId: target.value });
      const mixer = mixerStates.get(id);
      target.value = mixer?.presetDirty ? "" : mixer?.preset || "";
      return;
    }
    if (target?.dataset?.mvMixerGain) {
      const id = target.dataset.mvMixerGain;
      clearTimeout(mixerGainTimers.get(id));
      mixerGainTimers.delete(id);
      const gain = Number(target.value);
      if (Number.isFinite(gain)) {
        mixerGainDrafts.set(id, gain);
        sendMixerCommand(id, "MIXER_SET_GAIN", { gain });
        sendMixerCommand(id, "MIXER_FLUSH_GAIN");
      }
      return;
    }
    if (event.target?.id === "mvSyncAuto") {
      state.sync.mode = event.target.checked ? "auto" : "manual";
      if (state.sync.mode !== "auto") resetAllSyncRates();
      syncNotice = "";
      updateSyncPolling();
      event.target.blur();
      renderSync();
      return;
    }
    if (event.target?.id !== "mvVolFocus") return;
    state.audioFocusMode = event.target.checked === true;
    // ⚠ 채널별 volume 값은 그대로 둔다. focus mode 를 껐을 때 이전 믹스를
    //   그대로 되찾을 수 있어야 한다. 바뀌는 것은 '지금 소리를 내는가' 뿐이다.
    postAllAudio();
    for (const channel of state.chosen) {
      if (effectiveMuted(channel.channelId)) clearAudioNotice(channel.channelId);
    }
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
    "FRAME_SYNC_STATS",
    "FRAME_SYNC_COMMAND_RESULT",
    "FRAME_MIXER_STATE",
    "FRAME_MIXER_COMMAND_RESULT",
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
      if (currentStatus(channelId) === "ready") {
        clearChannelSync(channelId);
        syncReadyAt.set(channelId, Date.now());
      }
      clearTimeout(frameTimers.get(channelId));
      frameTimers.delete(channelId);
      // ⚠ 여기서 덮개를 걷지 않는다. FRAME_READY 는 '지시를 받을 수 있게 됨' 일 뿐
      //   화면 정리(채팅 접기·넓은 화면)는 아직 끝나지 않았다.
      if (currentStatus(channelId) === "ended") return; // 종료된 칸은 그대로 둔다
      // ⚠ 프레임이 준비되기 전에 보낸 지시는 (리스너가 붙기 전이라) 유실됐을 수 있다.
      //   주소의 쿼리는 '처음 상태' 일 뿐이고 최종 기준은 지금 부모 상태다.
      // ⚠ 이때만 화질 재확인을 함께 요청한다. 볼륨 조작 같은 평상시 지시에서는
      //   요청하지 않는다(화질 재적용을 불필요하게 반복하지 않는다).
      postState(channelId, channelId === state.mainId, {
        reconcileQuality: true,
      });
      // ⚠ 여기서 바로 덮개를 걷는다. 화면 정리(채팅 접기·넓은 화면)는 프레임이
      //   스스로 목표 상태로 맞춰 가는 일이라, 그걸 기다리면 DOM 이 늦게 뜬 것까지
      //   실패로 보인다(그래서 재적용을 두세 번 눌러야 했다).
      setCellStatus(channelId, "ready");
      requestMixerState(channelId);
      return;
    }
    if (data.type === "FRAME_ENDED") {
      // 방송 종료. 칸을 지우거나 다른 채널을 자동으로 메인으로 올리지 않는다.
      clearTimeout(frameTimers.get(channelId));
      frameTimers.delete(channelId);
      setCellStatus(channelId, "ended");
      return;
    }
    if (data.type === "FRAME_MIXER_STATE") {
      if (currentStatus(channelId) === "ready") acceptMixerSnapshot(channelId, data.state);
      return;
    }
    if (data.type === "FRAME_MIXER_COMMAND_RESULT") {
      if (currentStatus(channelId) !== "ready" || typeof data.command !== "string" ||
          !Number.isSafeInteger(data.commandId)) return;
      const key = `${channelId}:${data.command}`;
      const pending = mixerPending.get(key);
      if (!pending || pending.commandId !== data.commandId) return;
      clearTimeout(pending.timer);
      mixerPending.delete(key);
      if (data.command === "MIXER_FLUSH_GAIN") {
        mixerDragId = "";
        mixerGainDrafts.delete(channelId);
      }
      if (data.applied === true) {
        if (data.command !== "MIXER_FLUSH_GAIN") {
          mixerErrors.delete(channelId);
          mixerConfirm.delete(channelId);
        }
      } else if (data.reason === "confirmation-required") {
        mixerConfirm.add(channelId);
      } else {
        const messages = {
          "not-ready": "오디오 믹서가 아직 준비되지 않았습니다.",
          "no-video": "재생 영상을 찾지 못했습니다.",
          "graph-conflict": "오디오 그래프 충돌로 믹서를 켤 수 없습니다.",
          "interaction-required": "플레이어에서 한 번 상호작용한 뒤 다시 시도해 주세요.",
          "invalid-preset": "프리셋을 적용하지 못했습니다.",
          "invalid-gain": "게인 값을 적용하지 못했습니다.",
        };
        mixerErrors.set(channelId, messages[data.reason] || "오디오 믹서 명령을 적용하지 못했습니다.");
      }
      if (!acceptMixerSnapshot(channelId, data.state) && mixerDragId !== channelId) renderVolume();
      return;
    }
    if (data.type === "FRAME_SYNC_COMMAND_RESULT") {
      if (currentStatus(channelId) === "ready") finishSyncCommand(channelId, data);
      return;
    }
    if (data.type === "FRAME_SYNC_STATS") {
      if (currentStatus(channelId) !== "ready") return;
      const stats = SYNC.normalize(data.stats);
      if (!stats) return;
      const previousGeneration = syncGeneration.get(channelId);
      if (stats.generation !== null && previousGeneration !== undefined &&
          stats.generation < previousGeneration) return;
      if (stats.generation !== null && previousGeneration !== stats.generation) {
        requestMixerState(channelId);
        const generationAt = stats.receivedAt;
        recordSyncDiagnostic("generation-change", {
          channelId,
          channelName: syncChannelName(channelId),
          from: previousGeneration ?? null,
          to: stats.generation,
        }, generationAt);
        recordSyncDiagnostic("settling-start", {
          channelId,
          channelName: syncChannelName(channelId),
          generation: stats.generation,
          cause: previousGeneration === undefined ? "first-video" : "video-replaced",
        }, generationAt);
        cancelPendingSync(channelId);
        for (const command of ["seek", "nudge", "rate", "reset-rate"]) {
          syncRetryAt.delete(`${channelId}:${command}`);
        }
        syncRates.delete(channelId);
        syncReadyAt.set(channelId, Date.now());
        syncSeekAt.delete(channelId);
        if (syncCongestion.active) {
          recordCongestionChange(false, syncEligibleIds(), generationAt);
        }
        syncCongestion = { active: false, since: 0 };
        state.sync.congested = false;
      }
      if (stats.generation !== null) syncGeneration.set(channelId, stats.generation);
      const pendingRate = pendingSync(channelId, "rate");
      const pendingReset = pendingSync(channelId, "reset-rate");
      if (!pendingRate && !pendingReset) {
        const parentOwnedRate = syncRates.has(channelId);
        if (stats.syncRateOwned && Number.isFinite(stats.playbackRate)) {
          syncRates.set(channelId, stats.playbackRate);
          if (!parentOwnedRate) {
            recordSyncDiagnostic("rate-reconciled", {
              channelId,
              channelName: syncChannelName(channelId),
              playbackRate: stats.playbackRate,
              direction: "frame-to-parent",
            }, stats.receivedAt);
          }
        } else if (!stats.syncRateOwned) {
          syncRates.delete(channelId);
          if (parentOwnedRate) {
            recordSyncDiagnostic("rate-reconciled", {
              channelId,
              channelName: syncChannelName(channelId),
              playbackRate: stats.playbackRate,
              direction: "frame-cleared-parent",
            }, stats.receivedAt);
          }
        }
      }
      syncStats.set(channelId, stats);
      recordSyncSample(channelId, stats, stats.receivedAt);
      if (state.sync.mode !== "auto" && stats.syncRateOwned) resetSyncRate(channelId);
      updateSyncPolling();
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
        },
        updatedAt: Date.now(),
      });
      return;
    }
    if (data.type === "AUDIO_INTERACTION_RESOLVED") {
      // 칸이 '실제로 들리는 상태' 라고 알려 왔다. 그때만 경고를 거둔다.
      clearAudioNotice(channelId);
      return;
    }
    if (data.type === "AUDIO_INTERACTION_REQUIRED") {
      if (effectiveMuted(channelId)) return;
      // 자동재생이 막혔다. 볼륨 버튼에 표시를 띄워 어디서든 풀 수 있게 한다.
      audioBlocked.add(channelId);
      renderVolume();
      // 메인은 화면에서 바로 풀 수 있게 기존 안내도 함께 띄운다.
      // ⚠ 볼륨 팝오버만 남기지 않는다. 자동재생 해제는 사용자 조작 안에서
      //   이뤄져야 확실한데, 칸 위 버튼이 가장 짧은 경로다.
      if (channelId === state.mainId) showAudioNotice(channelId);
    }
  });

  window.addEventListener("pagehide", () => {
    resetAllSyncRates();
    for (const c of state.chosen) cancelPendingSync(c.channelId);
    syncStats.clear();
    syncRates.clear();
    syncSeekAt.clear();
    syncGeneration.clear();
    syncReadyAt.clear();
    syncRetryAt.clear();
    syncCongestion = { active: false, since: 0 };
    state.sync.congested = false;
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = 0;
  });
  window.addEventListener("pageshow", updateSyncPolling);
  document.addEventListener("visibilitychange", () => {
    const changedAt = Date.now();
    recordSyncDiagnostic("visibility", { hidden: document.hidden }, changedAt);
    if (document.hidden) {
      syncStats.clear();
      resetAllSyncRates();
      for (const c of state.chosen) cancelPendingSync(c.channelId);
    } else {
      const now = Date.now();
      for (const c of state.chosen) {
        if (currentStatus(c.channelId) !== "ready") continue;
        syncReadyAt.set(c.channelId, now);
        recordSyncDiagnostic("settling-start", {
          channelId: c.channelId,
          channelName: c.channelName || "",
          generation: syncGeneration.get(c.channelId) ?? null,
          cause: "tab-visible",
        }, changedAt);
      }
      if (syncCongestion.active) recordCongestionChange(false, syncEligibleIds(), changedAt);
      syncCongestion = { active: false, since: 0 };
      state.sync.congested = false;
    }
    updateSyncPolling();
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
