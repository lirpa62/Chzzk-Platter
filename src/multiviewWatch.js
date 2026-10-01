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
  // 치지직 페이지(/lives) 위에서 도는지. 치지직이 다른 출처(확장 페이지)의 iframe 표시를
  // 막아서, 멀티뷰 화면을 치지직 페이지 위에 그리고 칸을 같은 출처 iframe 으로 띄운다.
  const HOSTED_ON_CHZZK = location.origin === CHZZK_ORIGIN;
  // ⚠ 같은 출처에서는 치지직 스크립트도 칸과 메시지를 주고받을 수 있다. 이 화면이 칸마다
  //   넘긴 세션 토큰이 맞는 메시지만 서로 믿는다.
  const FRAME_TOKEN = (() => {
    if (!HOSTED_ON_CHZZK) return "";
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  })();
  const FRAME_TOKEN_FIELD = FRAME_TOKEN ? { token: FRAME_TOKEN } : {};
  const FRAME_NAME_PREFIX = "cheese-multiview:";
  const FRAME_STORE_PREFIX = "cheese-multiview-frame:";
  // 탭·창 API. 확장 페이지에서는 바로 부르고, 치지직 페이지 위에서는 배경 스크립트에
  // 맡긴다(content script 에는 chrome.tabs·chrome.windows 가 없다).
  function hostApi(op, args) {
    return chrome.runtime.sendMessage({ type: "MULTIVIEW_HOST_API", op, args }).then((res) => {
      if (!res?.ok) throw new Error(res?.reason || "host-api-failed");
      return res.value;
    });
  }
  const EXT = HOSTED_ON_CHZZK
    ? {
        createWindow: (options) => hostApi("windows.create", options),
        removeWindow: (windowId) => hostApi("windows.remove", { windowId }),
        focusWindow: (windowId) => hostApi("windows.focus", { windowId }),
        updateTabUrl: (tabId, url) => hostApi("tabs.update", { tabId, url }),
        onWindowRemoved: (listener) => chrome.runtime.onMessage.addListener((message) => {
          if (message?.type === "MULTIVIEW_HOST_WINDOW_REMOVED" &&
              Number.isInteger(message.windowId)) listener(message.windowId);
        }),
      }
    : {
        createWindow: (options) => chrome.windows.create(options),
        removeWindow: (windowId) => chrome.windows.remove(windowId),
        focusWindow: (windowId) => chrome.windows.update(windowId, { focused: true }),
        updateTabUrl: (tabId, url) => chrome.tabs.update(tabId, { url }),
        onWindowRemoved: (listener) => chrome.windows.onRemoved.addListener(listener),
      };

  function isTrustedFrameMessage(event) {
    if (event.origin !== CHZZK_ORIGIN) return false;
    return !FRAME_TOKEN || event.data?.token === FRAME_TOKEN;
  }

  // 칸 설정(cheeseMulti*)은 주소 쿼리가 아니라 iframe 이름으로 넘긴다. 쿼리는 칸을 열 때마다
  // 치지직 서버 접속 기록에 남는다. 칸 안 스크립트는 window.name 에서 읽는다.
  function loadFrame(frame, src) {
    const url = new URL(src, CHZZK_ORIGIN);
    const config = {};
    for (const [key, value] of [...url.searchParams]) {
      if (!key.startsWith("cheeseMulti") && key !== "cheeseRetry") continue;
      config[key] = value;
      url.searchParams.delete(key);
    }
    if (FRAME_TOKEN) {
      config.cheeseMultiHost = "chzzk";
      config.cheeseMultiToken = FRAME_TOKEN;
      // ⚠ 치지직 스크립트가 칸의 window.name 을 비워(실측) 이름으로는 전달되지 않는다.
      //   이 화면과 칸은 같은 탭·같은 출처라 sessionStorage 를 함께 쓴다. 칸 주소를 키로
      //   써 두면 칸이 자기 주소로 읽는다. 서버로는 가지 않는다.
      try {
        sessionStorage.setItem(
          FRAME_STORE_PREFIX + url.pathname.replace(/\/+$/, ""),
          JSON.stringify(config),
        );
      } catch {}
    }
    // 확장 페이지(예전 방식)에서는 iframe 이름으로 넘긴다. 주소를 걸기 전에 바꾼다.
    frame.name = FRAME_NAME_PREFIX + JSON.stringify(config);
    frame.src = url.toString();
  }
  const HASH_RE = /^[0-9a-f]{32}$/i;
  const SLOT_RE = /^(?:[0-9a-f]{32}|video:\d+)$/i;
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
  const fmtCount = (value) => Number(value || 0).toLocaleString("ko-KR");

  const state = {
    handoffId: "",
    chosen: [],
    layoutId: "",
    mainId: "",
    chatChannelId: "",
    chatSide: "",
    chatEnabled: true,
    mainHighQuality: false,
    startMainMuted: false,
    startMainVolume: 1,
    // 메인을 바꾸면 채팅도 따라 바꿀지(기본 켜짐).
    chatFollowsMain: true,
    // 전체 볼륨(0~1). 채널별 볼륨 위에 곱해지는 값이다.
    masterVolume: 1,
    masterMuted: false,
    // '메인 채널만 소리'(기본 켜짐). 기존 정책과 같다.
    audioFocusMode: true,
    sync: {
      mode: "off",
      referenceChannelId: null,
      manualOffsets: {},
      congested: false,
      diagnosticsEnabled: false,
      // 싱크 그룹 범위. "all" 은 지금까지와 같은 의미(모든 채널이 한 그룹),
      // "selected" 는 사용자가 고른 채널만 한 그룹이다. 그룹은 언제나 하나다.
      scope: "all",
      groups: [],
      // scope="selected" 에서 고른 채널. 처음 전환할 때 현재 채널로 채운다.
      selectedChannelIds: [],
      // 선택을 한 번이라도 만들었는지(재진입 때 이전 선택을 되살리려고 둔다).
      selectionInitialized: false,
    },
  };

  // 채널별 소리 설정. muteTouched는 보조 채널의 초기 음소거와 직접 조작을 구분한다.
  // ⚠ focus mode 를 껐다 켜도 사용자가 맞춰 둔 volume 은 지우지 않는다. 껐을 때
  //   이전 믹스를 그대로 되찾을 수 있어야 한다.
  const channelAudio = new Map();

  function audioOf(channelId) {
    let entry = channelAudio.get(channelId);
    if (!entry) {
      entry = {
        volume: state.startMainVolume,
        muted: channelId !== state.mainId,
        muteTouched: false,
      };
      channelAudio.set(channelId, entry);
    }
    return entry;
  }

  // 전체 음소거와 focus mode를 적용한 뒤 채널별 음소거를 반영한다.
  function effectiveMuted(channelId) {
    if (state.masterMuted) return true;
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

  // 계속 적용되는 화질 정책. 어느 칸도 상한을 두지 않고 각 화면의 치지직 화질 선택을
  // 따른다(README: '메인 고화질 · 보조 480p로 시작'은 최초 재생 화질만 정한다).
  // ⚠ 예전에는 옵션을 끄면 오히려 보조 라이브에 480p, 다시보기에 720p 상한이 계속
  //   걸렸다. 시작 목표는 아래 initialQualityForChannel 이 따로 정한다.
  function qualityForChannel(channel, isMain, mainHighQuality) {
    return { quality: "native", qualityPolicy: "native" };
  }

  // iframe 을 처음 만들 때만 쓰는 시작 화질 목표.
  // - 라이브: 옵션을 켰을 때만 메인 최고화질, 보조 480p 이하.
  // - 다시보기: 옵션과 무관하게 메인 최대 화질, 보조 720p 이하(README).
  function initialQualityForChannel(channel, isMain, mainHighQuality) {
    if (channel.mediaType === "video") return isMain ? "highest" : "cap-720";
    if (!mainHighQuality) return "";
    return isMain ? "highest" : "cap-480";
  }

  function frameUrl(channel, isMain, mainHighQuality) {
    const isVideo = channel.mediaType === "video";
    const { quality, qualityPolicy } = qualityForChannel(channel, isMain, mainHighQuality);
    const initialQuality = initialQualityForChannel(channel, isMain, mainHighQuality);
    // 처음 주소에 담는 화질도 '우리가 지시한 정책' 이다. 여기서 기록해 두어야
    // 통계 표의 정책 열이 첫 화면부터 맞는다(postState 는 프레임이 준비된 뒤에야
    // 불린다).
    lastQuality.set(
      channel.channelId,
      quality,
    );
    const url = new URL(
      isVideo ? `/video/${channel.videoNo}` : `/live/${channel.ownerChannelId || channel.channelId}`,
      CHZZK_ORIGIN,
    );
    url.searchParams.set("cheeseMulti", "1");
    if (isVideo) {
      url.searchParams.set("cheeseMultiChannelId", channel.channelId);
      // 다시보기 칸의 채널 id. 칸 안 믹서가 스트리머별 설정을 불러오는 키다. 넘기지 않으면
      // 믹서가 영상 API 로 따로 알아내야 해 설정 로드가 늦거나, 실패하면 기본값으로 동작한다.
      if (HASH_RE.test(String(channel.ownerChannelId || "")))
        url.searchParams.set("cheeseMultiOwnerChannelId", channel.ownerChannelId);
    }
    url.searchParams.set("cheeseMultiMain", isMain ? "1" : "0");
    // 첫 프레임의 음소거 상태도 현재 채널별 오디오 상태와 일치시킨다.
    url.searchParams.set("cheeseMultiMuted", effectiveMuted(channel.channelId) ? "1" : "0");
    // 첫 영상이 붙는 순간부터 시작 음량을 적용한다. FRAME_READY 메시지만 기다리면
    // 부모 상태가 도착하기 전까지 플레이어 기본 음량으로 잠깐 재생될 수 있다.
    url.searchParams.set("cheeseMultiVolume", String(effectiveVolume(channel.channelId)));
    url.searchParams.set("cheeseMultiQualityPolicy", qualityPolicy);
    if (initialQuality) url.searchParams.set("cheeseMultiInitialQuality", initialQuality);
    // 시작 목표(cheeseMultiInitialQuality)만 한 번 적용하고, 이후에는 치지직 화질 선택을
    // 따른다. 채널별로 화질을 기억해 두지 않는다.
    if (quality !== "high" && quality !== "native") {
      url.searchParams.set("cheeseMultiQuality", quality);
    }
    return url.toString();
  }

  // 프레임에 상태를 지시한다. src 를 건드리지 않으므로 방송이 다시 로드되지 않는다.
  //
  // ⚠ isMain 은 '화질' 만 정한다. 음소거·크기는 소리 설정에서 계산한다 —
  //   focus mode 를 끄면 보조 채널도 소리를 낼 수 있어야 하기 때문이다.
  // 메인이 바뀔 때마다 늘리는 역할 표시. 칸은 이 값이 바뀌면 새 역할의 시작 화질을 다시 건다.
  let qualityRoleToken = 0;

  function postState(channelId, isMain, options = {}) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    const channel = state.chosen.find((item) => item.channelId === channelId);
    const { quality, qualityPolicy } = qualityForChannel(
      channel || { mediaType: "live" },
      isMain,
      state.mainHighQuality,
    );
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
          source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
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
          // 메인 변경: '메인 고화질 · 보조 480p로 시작' 이 켜져 있으면 바뀐 두 칸에 새 역할의
          // 시작 화질을 한 번 다시 건다(이후에는 사용자 선택을 따른다).
          ...(options.roleToken
            ? {
                qualityRoleToken: options.roleToken,
                initialQuality: initialQualityForChannel(
                  channel || { mediaType: "live" },
                  isMain,
                  state.mainHighQuality,
                ) || "none",
              }
            : {}),
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

  // 칸 안의 치지직 플레이어에서 사용자가 직접 음소거를 켜거나 끈 경우(FRAME_USER_MUTE).
  // ⚠ 예전에는 프레임이 볼륨 값만 알려, 플레이어에서 음소거를 풀어도 볼륨 패널은 계속
  //   음소거로 보였다. 부모 상태를 실제 소리에 맞춘다.
  function adoptFrameUserMute(channelId, muted) {
    if (effectiveMuted(channelId) === muted) return;
    const audio = audioOf(channelId);
    audio.muteTouched = true;
    if (muted) {
      audio.muted = true;
      postState(channelId, channelId === state.mainId);
      clearAudioNotice(channelId);
      renderVolume();
      syncAllVolumeButtons();
      return;
    }
    if (state.masterMuted) {
      // 전체 음소거를 풀되 다른 칸은 지금처럼 조용히 둔다(갑자기 소리가 나지 않게).
      for (const c of state.chosen) {
        if (c.channelId !== channelId) audioOf(c.channelId).muted = true;
      }
      state.masterMuted = false;
    }
    // 보조 칸을 켰다는 건 여러 방송을 같이 듣겠다는 뜻이다. 볼륨 슬라이더를 올릴 때와
    // 같이 '메인만 듣기' 를 끈다.
    if (state.audioFocusMode && channelId !== state.mainId) state.audioFocusMode = false;
    audio.muted = false;
    if (audio.volume === 0) audio.volume = 1;
    postAllAudio();
    renderVolume();
    syncAllVolumeButtons();
  }

  // 채팅 칸에 지금 테마를 알린다. 프레임이 준비됐다고 알려 올 때와 테마를 바꿀 때
  // 보낸다(교차 출처라 부모가 그 안의 html 을 직접 만질 수 없다).
  function postChatView() {
    if (detachedChat) return;
    const frame = $("mvChatFrame");
    if (!chatFrameReady || !frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
          type: "SET_MULTIVIEW_CHAT_VIEW",
          dark: document.documentElement.dataset.theme === "dark",
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  // 테마 단추는 multiviewTheme.js 가 다룬다. 바뀌면 채팅 칸에도 알린다.
  new MutationObserver(() => {
    postChatView();
    renderVodChat();
  }).observe(document.documentElement, {
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
  let chatFrameReady = false;
  let detachedChat = null;
  let nativeChatOpening = false;
  let chatPopoutFeedbackTimer = 0;
  let vodChatSourceId = "";
  let vodChatRenderSignature = "";
  let vodChatScrollInitialized = false;
  let pendingVodLocalRevealId = "";
  let vodChatTimeMode = "broadcast";
  let vodChatShowTime = false;
  let vodChatTimeFormat = "24h";
  let vodChatScalePercent = 100;
  let vodChatEmojiMap = Object.create(null);
  let vodChatEmojiMapPromise = null;
  let vodChatEmojiRevision = 0;
  let vodNicknameColorsPromise = null;
  let vodLocalIdentityRequestId = 0;
  const BADGE_CHAT_ROLES = new Set(["streamer", "manager", "operator", "partner"]);
  const BADGE_CHAT_ROLE_BADGES = Object.freeze({
    streamer: ["방장", "https://ssl.pstatic.net/static/nng/glive/icon/streamer.png"],
    manager: ["매니저", "https://ssl.pstatic.net/static/nng/glive/icon/manager.png"],
    operator: ["치지직 운영자", "https://ssl.pstatic.net/static/nng/glive/icon/owner.png"],
    partner: ["파트너", "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png"],
  });
  const BADGE_CHAT_ROLE_BADGE_URLS = new Set(
    Object.values(BADGE_CHAT_ROLE_BADGES).map(([, url]) => url),
  );
  const BADGE_CHAT_ROLE_BADGE_LABELS = new Set([
    "방장", "매니저", "치지직 운영자", "파트너", "역할 배지",
  ]);
  const BADGE_CHAT_LIMIT = 150;
  let vodBadgeChatOpen = false;
  let vodBadgeChatResizeObserver = null;
  let vodBadgeChatSignature = "reset";
  let vodBadgeChatHeight = 320;
  let vodBadgeChatResizeStart = null;
  let vodBadgeChatLatestId = "";
  let vodBadgeChatLastPlaybackTime = null;
  let vodBadgeChatHasBaseline = false;
  let vodBadgeChatPopupItems = [];
  const vodBadgeChatSeenIds = new Set();
  let vodBadgeChatSettingsRevision = 0;
  const MULTIVIEW_BADGE_CHAT_SETTINGS = [
    "cheeseMultiviewBadgeChatButton",
    "cheeseMultiviewBadgeChatHideEmptyButton",
    "cheeseMultiviewBadgeChatHideChatBackground",
    "cheeseMultiviewBadgeChatHideChatBorder",
    "cheeseMultiviewBadgeChatHidePopupBackground",
    "cheeseMultiviewBadgeChatHidePopupBorder",
    "cheeseMultiviewBadgeChatHidePopupTime",
    "cheeseMultiviewBadgeChatRoleBadgesOnly",
    "cheeseMultiviewBadgeChatKeepPopupOpen",
    "cheeseMultiviewBadgeChatPillGlowEnabled",
    "cheeseMultiviewBadgeChatCompactPill",
    "cheeseMultiviewBadgeChatHidePillButton",
    "cheeseMultiviewBadgeChatDisplayStyle",
  ];
  const vodBadgeChatSettings = {
    hidePillButton: false,
    hideEmptyButton: false,
    hideChatBackground: false,
    hideChatBorder: false,
    hidePopupBackground: false,
    hidePopupBorder: false,
    hidePopupTime: false,
    roleBadgesOnly: false,
    keepPopupOpen: false,
    pillGlowEnabled: true,
    compactPill: false,
    // 한줄보기(inline) | 블록보기(block). 배지 모아 챗의 보기 방식과 같다.
    displayStyle: "inline",
  };
  const vodChatSession = globalThis.CheeseMultiviewVodChat.createSession({
    onChange: renderVodChat,
  });
  const vodLocalChatSession = globalThis.CheeseReplayLocalChat.createSession();
  const vodLocalChatAvatar = $("mvVodChatComposeAvatar");
  const vodLocalChatForm = $("mvVodChatCompose");
  // 지난 채팅을 보고 있을 때 오른쪽 아래에 뜨는 '최신 채팅으로' 버튼.
  const vodChatLatest = globalThis.CheeseReplayLocalChat.bindLatestButton({
    list: $("mvVodChatList"),
    button: $("mvVodChatLatest"),
  });
  // 설정의 '다시보기 채팅 입력'. 저장값을 읽기 전에는 숨겨 둔다(끈 사용자에게 깜빡임 방지).
  // 끄면 입력창과 이미 입력한 로컬 채팅을 모두 감춘다(입력 내용은 남겨 다시 켜면 보인다).
  let vodLocalChatEnabled = false;
  if (vodLocalChatForm) vodLocalChatForm.hidden = true;
  globalThis.CheeseReplayLocalChat.watchEnabledSetting((enabled) => {
    vodLocalChatEnabled = enabled;
    if (vodLocalChatForm) vodLocalChatForm.hidden = !enabled;
    if (!enabled) pendingVodLocalRevealId = "";
    renderVodChat();
  });
  // 설정 - 채팅 '채팅 전송 버튼 숨김'을 로컬 채팅 입력 도구 줄에도 적용한다.
  globalThis.CheeseReplayLocalChat.watchHideToolsSetting((hide) => {
    document.documentElement.classList.toggle("mv-hide-chat-send-button", hide);
  });
  // 나의 로컬 채팅 줄 강조의 테두리선·배경색 숨김.
  globalThis.CheeseReplayLocalChat.watchStyleClasses();
  globalThis.CheeseReplayLocalChat.bindComposer({
    form: vodLocalChatForm,
    input: $("mvVodChatComposeInput"),
    button: $("mvVodChatComposeSend"),
    onSend: (text) => {
      if (!vodLocalChatEnabled) return;
      const playback = vodChatSession.snapshot();
      if (!playback.videoNo || playback.videoNo !== vodLocalChatSession.snapshot().videoNo) return;
      const message = vodLocalChatSession.add(text, playback.currentTime);
      if (message) {
        pendingVodLocalRevealId = message.id;
        renderVodChat();
      }
    },
  });
  const vodBadgeChatAnchor = $("mvVodBadgeChatAnchor");
  const vodBadgeChatTrigger = $("mvVodBadgeChatTrigger");
  const vodBadgeChatPopover = $("mvVodBadgeChatPopover");
  const vodBadgeChatList = $("mvVodBadgeChatList");
  const vodBadgeChatLabel = $("mvVodBadgeChatLabel");
  const vodBadgeChatBadges = $("mvVodBadgeChatBadges");
  const vodBadgeChatCount = $("mvVodBadgeChatCount");
  // 알림 버튼 순환·강조와 팝업 펼침 애니메이션은 라이브 채팅 프레임과 같은 코드를 쓴다.
  const vodBadgeChatPill = vodBadgeChatTrigger && globalThis.CheeseMultiviewBadgeChat
    ? globalThis.CheeseMultiviewBadgeChat.createBadgePill({
      trigger: vodBadgeChatTrigger,
      badges: vodBadgeChatBadges,
      label: vodBadgeChatLabel,
      count: vodBadgeChatCount,
      classPrefix: "mv-badge-chat",
    })
    : null;
  const vodBadgeChatMotion = vodBadgeChatPopover && globalThis.CheeseMultiviewBadgeChat
    ? globalThis.CheeseMultiviewBadgeChat.createPopoverMotion(vodBadgeChatPopover)
    : null;
  const vodBadgeChatFontScaleControls = globalThis.CheeseMultiviewBadgeChat?.createFontScaleControls({
    doc: document,
    classPrefix: "mv-badge-chat",
    onChange: (percent) => {
      const scale = String(percent / 100);
      vodBadgeChatPopover?.style.setProperty("--mv-badge-chat-font-scale", scale);
      vodBadgeChatPopover?.style.setProperty("--mv-vod-chat-scale", scale);
    },
  });
  const vodBadgeChatHeader = vodBadgeChatPopover?.querySelector(".mv-badge-chat-popover-head");
  const vodBadgeChatCloseButton = $("mvVodBadgeChatClose");
  if (vodBadgeChatHeader && vodBadgeChatFontScaleControls)
    vodBadgeChatHeader.insertBefore(vodBadgeChatFontScaleControls.element, vodBadgeChatCloseButton);

  function closeVodBadgeChatPopover(force = false) {
    if (!force && vodBadgeChatSettings.keepPopupOpen && !vodBadgeChatSettings.hidePillButton) return;
    const wasOpen = vodBadgeChatOpen;
    vodBadgeChatOpen = false;
    vodBadgeChatMotion?.close(force || !wasOpen);
    vodBadgeChatTrigger?.setAttribute("aria-expanded", "false");
    vodBadgeChatResizeObserver?.disconnect();
    vodBadgeChatResizeObserver = null;
    document.removeEventListener("scroll", positionVodBadgeChatPopover, true);
    window.removeEventListener("resize", positionVodBadgeChatPopover);
  }

  function positionVodBadgeChatPopover() {
    if (!vodBadgeChatOpen || !vodBadgeChatTrigger || !vodBadgeChatPopover) return;
    const anchor = vodBadgeChatTrigger.getBoundingClientRect();
    const margin = 8;
    const chatPanel = vodBadgeChatAnchor?.closest(".mv-chat");
    const chatBounds = chatPanel?.getBoundingClientRect();
    const width = Math.max(0, Math.min(
      chatBounds?.width || 370,
      window.innerWidth - margin * 2,
    ));
    vodBadgeChatPopover.style.width = `${width}px`;
    const maxHeight = Math.max(120, Math.min(720, window.innerHeight - margin * 2));
    vodBadgeChatHeight = Math.min(vodBadgeChatHeight, maxHeight);
    vodBadgeChatPopover.style.height = `${vodBadgeChatHeight}px`;
    // ⚠ 펼침 애니메이션(scaleY) 중에도 맞는 높이를 쓰도록 변형 없는 레이아웃 크기를 읽는다.
    const panel = { height: vodBadgeChatPopover.offsetHeight };
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const left = Math.min(maxLeft, Math.max(margin, chatBounds?.left ?? anchor.left));
    let top = anchor.bottom + 6;
    const above = top + panel.height > window.innerHeight - margin;
    if (above) top = anchor.top - panel.height - 6;
    top = Math.min(
      Math.max(margin, window.innerHeight - panel.height - margin),
      Math.max(margin, top),
    );
    vodBadgeChatPopover.classList.toggle("is-above", above);
    vodBadgeChatPopover.style.left = `${left}px`;
    vodBadgeChatPopover.style.top = `${top}px`;
    const resize = $("mvVodBadgeChatResize");
    if (resize) resize.setAttribute("aria-valuenow", String(Math.round(vodBadgeChatHeight)));
  }

  function renderVodBadgeChat(visible) {
    const entries = visible.filter((message) =>
      Array.isArray(message.roles) && message.roles.some((role) => BADGE_CHAT_ROLES.has(role)),
    ).slice(-BADGE_CHAT_LIMIT);
    if (vodBadgeChatOpen) {
      entries.forEach((message) => vodBadgeChatSeenIds.add(message.id));
      while (vodBadgeChatSeenIds.size > 2000)
        vodBadgeChatSeenIds.delete(vodBadgeChatSeenIds.values().next().value);
    }
    const unreadEntries = entries.filter((message) => !vodBadgeChatSeenIds.has(message.id));
    const actors = globalThis.CheeseMultiviewBadgeChat?.collectPillActors(unreadEntries) || [];
    vodBadgeChatPill?.render({
      actors,
      compact: vodBadgeChatSettings.compactPill,
      glow: vodBadgeChatSettings.pillGlowEnabled,
    });
    if (vodBadgeChatTrigger) {
      vodBadgeChatTrigger.hidden = vodBadgeChatSettings.hidePillButton ||
        (vodBadgeChatSettings.hideEmptyButton && !actors.length);
    }
    const playbackTime = vodChatSession.snapshot().currentTime;
    const latestId = entries.at(-1)?.id || "";
    const movedForward = vodBadgeChatLastPlaybackTime === null || playbackTime >= vodBadgeChatLastPlaybackTime;
    const hasNewVisibleChat = vodBadgeChatHasBaseline && movedForward && latestId && latestId !== vodBadgeChatLatestId;
    vodBadgeChatLatestId = latestId;
    vodBadgeChatLastPlaybackTime = playbackTime;
    vodBadgeChatHasBaseline = true;
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const signature = `${vodChatTimeMode}:${vodChatShowTime}:${vodChatTimeFormat}:` +
      `${vodBadgeChatSettings.hidePopupBackground}:${vodBadgeChatSettings.hidePopupBorder}:` +
      `${vodBadgeChatSettings.hidePopupTime}:${vodBadgeChatSettings.roleBadgesOnly}:` +
      `${vodChatEmojiRevision}:${theme}:` +
      entries.map((message) => message.id).join("\u001f");
    if (hasNewVisibleChat && !vodBadgeChatOpen && !vodBadgeChatSettings.keepPopupOpen)
      vodBadgeChatPill?.attention();
    if (vodBadgeChatSettings.keepPopupOpen && !vodBadgeChatSettings.hidePillButton && entries.length && !vodBadgeChatOpen) {
      openVodBadgeChatPopover(true);
      return;
    }
    if (signature === vodBadgeChatSignature) return;
    vodBadgeChatSignature = signature;
    const empty = $("mvVodBadgeChatEmpty");
    if (empty) empty.hidden = entries.length > 0;
    if (!vodBadgeChatList) return;
    // 과거 → 최신(위 → 아래). 맨 아래 근처를 보던 중이면 새 채팅을 따라간다.
    const nearBottom = vodBadgeChatList.scrollHeight - vodBadgeChatList.scrollTop -
      vodBadgeChatList.clientHeight < 32;
    vodBadgeChatPopupItems = entries.map((message) => ({
      id: String(message.id),
      nickname: String(message.nickname || "알 수 없음"),
      roles: message.roles.filter((role) => BADGE_CHAT_ROLES.has(role)),
      html: renderVodChatRow(message, vodChatTimeMode, !vodBadgeChatSettings.hidePopupTime, {
        hideBackground: vodBadgeChatSettings.hidePopupBackground,
        hideBorder: vodBadgeChatSettings.hidePopupBorder,
        roleBadgesOnly: vodBadgeChatSettings.roleBadgesOnly,
      }),
    }));
    vodBadgeChatList.innerHTML = vodBadgeChatPopupItems
      .map((item) => item.html)
      .join("");
    if (nearBottom) vodBadgeChatList.scrollTop = vodBadgeChatList.scrollHeight;
  }

  function openVodBadgeChatPopover(open) {
    if (!open) {
      closeVodBadgeChatPopover();
      return;
    }
    if (vodBadgeChatSettings.hidePillButton) return;
    vodBadgeChatPill?.clearAttention();
    vodBadgeChatOpen = open;
    vodBadgeChatMotion?.open();
    vodBadgeChatTrigger?.setAttribute("aria-expanded", String(open));
    if (open) {
      const snapshot = vodChatSession.snapshot();
      vodChatSession.visible(snapshot.currentTime, 120)
        .filter((message) => Array.isArray(message.roles) && message.roles.some((role) => BADGE_CHAT_ROLES.has(role)))
        .forEach((message) => vodBadgeChatSeenIds.add(message.id));
      vodBadgeChatSignature = "reset";
      positionVodBadgeChatPopover();
      renderVodBadgeChat(vodChatSession.visible(snapshot.currentTime, 120));
      // 새로 열 때는 가장 최근 채팅(맨 아래)에서 시작한다.
      if (vodBadgeChatList) vodBadgeChatList.scrollTop = vodBadgeChatList.scrollHeight;
      const chatPanel = vodBadgeChatAnchor?.closest(".mv-chat");
      if (chatPanel && window.ResizeObserver) {
        vodBadgeChatResizeObserver = new window.ResizeObserver(positionVodBadgeChatPopover);
        vodBadgeChatResizeObserver.observe(chatPanel);
      }
      document.addEventListener("scroll", positionVodBadgeChatPopover, true);
      window.addEventListener("resize", positionVodBadgeChatPopover);
    }
  }

  function applyMultiviewBadgeChatSettings(values = {}) {
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePillButton"))
      vodBadgeChatSettings.hidePillButton = values.cheeseMultiviewBadgeChatHidePillButton === true;
    else if (Object.hasOwn(values, "cheeseMultiviewBadgeChatButton"))
      vodBadgeChatSettings.hidePillButton = values.cheeseMultiviewBadgeChatButton === false;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHideEmptyButton"))
      vodBadgeChatSettings.hideEmptyButton = values.cheeseMultiviewBadgeChatHideEmptyButton === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHideChatBackground"))
      vodBadgeChatSettings.hideChatBackground = values.cheeseMultiviewBadgeChatHideChatBackground === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHideChatBorder"))
      vodBadgeChatSettings.hideChatBorder = values.cheeseMultiviewBadgeChatHideChatBorder === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePopupBackground"))
      vodBadgeChatSettings.hidePopupBackground = values.cheeseMultiviewBadgeChatHidePopupBackground === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePopupBorder"))
      vodBadgeChatSettings.hidePopupBorder = values.cheeseMultiviewBadgeChatHidePopupBorder === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePopupTime"))
      vodBadgeChatSettings.hidePopupTime = values.cheeseMultiviewBadgeChatHidePopupTime === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatRoleBadgesOnly"))
      vodBadgeChatSettings.roleBadgesOnly = values.cheeseMultiviewBadgeChatRoleBadgesOnly === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatKeepPopupOpen"))
      vodBadgeChatSettings.keepPopupOpen = values.cheeseMultiviewBadgeChatKeepPopupOpen === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatPillGlowEnabled"))
      vodBadgeChatSettings.pillGlowEnabled = values.cheeseMultiviewBadgeChatPillGlowEnabled !== false;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatCompactPill"))
      vodBadgeChatSettings.compactPill = values.cheeseMultiviewBadgeChatCompactPill === true;
    if (Object.hasOwn(values, "cheeseMultiviewBadgeChatDisplayStyle"))
      vodBadgeChatSettings.displayStyle =
        values.cheeseMultiviewBadgeChatDisplayStyle === "block" ? "block" : "inline";
    vodBadgeChatList?.classList.toggle("is-block", vodBadgeChatSettings.displayStyle === "block");
    if (vodBadgeChatSettings.hidePillButton) vodBadgeChatSettings.keepPopupOpen = false;
    const closeButton = $("mvVodBadgeChatClose");
    if (closeButton) closeButton.disabled = vodBadgeChatSettings.keepPopupOpen;
    vodBadgeChatPopover?.classList.toggle("is-locked-open", vodBadgeChatSettings.keepPopupOpen);
    document.documentElement.classList.toggle("cheese-mv-badge-no-chat-bg", vodBadgeChatSettings.hideChatBackground);
    document.documentElement.classList.toggle("cheese-mv-badge-no-chat-border", vodBadgeChatSettings.hideChatBorder);
    if (vodBadgeChatSettings.hidePillButton) closeVodBadgeChatPopover(true);
    vodBadgeChatSignature = "reset";
    renderVodChat();
  }

  const initialVodBadgeChatSettingsRevision = vodBadgeChatSettingsRevision;
  chrome.storage.local.get(MULTIVIEW_BADGE_CHAT_SETTINGS)
    .then((values) => {
      if (initialVodBadgeChatSettingsRevision === vodBadgeChatSettingsRevision)
        applyMultiviewBadgeChatSettings(values);
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const values = {};
    MULTIVIEW_BADGE_CHAT_SETTINGS.forEach((key) => {
      if (changes[key]) values[key] = changes[key].newValue;
    });
    if (Object.keys(values).length) {
      vodBadgeChatSettingsRevision += 1;
      applyMultiviewBadgeChatSettings(values);
    }
  });

  const vodBadgeChatResize = $("mvVodBadgeChatResize");
  vodBadgeChatResize?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    vodBadgeChatResizeStart = {
      y: event.clientY,
      height: vodBadgeChatHeight,
      top: Number.parseFloat(vodBadgeChatPopover.style.top) || 8,
      pointerId: event.pointerId,
    };
    vodBadgeChatResize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  vodBadgeChatResize?.addEventListener("pointermove", (event) => {
    if (!vodBadgeChatResizeStart || vodBadgeChatResizeStart.pointerId !== event.pointerId) return;
    const maxHeight = Math.max(120, Math.min(720, window.innerHeight - vodBadgeChatResizeStart.top - 8));
    vodBadgeChatHeight = Math.max(120, Math.min(maxHeight,
      vodBadgeChatResizeStart.height + event.clientY - vodBadgeChatResizeStart.y));
    vodBadgeChatPopover.style.height = `${vodBadgeChatHeight}px`;
    vodBadgeChatResize.setAttribute("aria-valuenow", String(Math.round(vodBadgeChatHeight)));
  });
  const stopVodBadgeChatResize = (event) => {
    if (vodBadgeChatResizeStart?.pointerId === event.pointerId) vodBadgeChatResizeStart = null;
  };
  vodBadgeChatResize?.addEventListener("pointerup", stopVodBadgeChatResize);
  vodBadgeChatResize?.addEventListener("pointercancel", stopVodBadgeChatResize);
  vodBadgeChatResize?.addEventListener("lostpointercapture", stopVodBadgeChatResize);
  vodBadgeChatResize?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const maxHeight = Math.max(120, Math.min(720, window.innerHeight - 16));
    vodBadgeChatHeight = Math.max(120, Math.min(maxHeight,
      vodBadgeChatHeight + (event.key === "ArrowUp" ? 24 : -24)));
    positionVodBadgeChatPopover();
  });

  vodBadgeChatTrigger?.addEventListener("click", () => {
    if (vodBadgeChatSettings.keepPopupOpen && vodBadgeChatOpen) return;
    openVodBadgeChatPopover(!vodBadgeChatOpen);
  });
  $("mvVodBadgeChatClose")?.addEventListener("click", () => closeVodBadgeChatPopover());
  document.addEventListener("pointerdown", (event) => {
    if (vodBadgeChatOpen && !vodBadgeChatSettings.keepPopupOpen && !vodBadgeChatAnchor?.contains(event.target))
      closeVodBadgeChatPopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && vodBadgeChatOpen && !vodBadgeChatSettings.keepPopupOpen)
      closeVodBadgeChatPopover();
  });
  const vodChatTimeModeButton = $("mvVodChatTimeMode");
  vodChatTimeModeButton?.addEventListener("click", () => {
    vodChatTimeMode = vodChatTimeMode === "playback" ? "broadcast" : "playback";
    renderVodChat();
  });
  const vodChatScaleDownButton = $("mvVodChatScaleDown");
  const vodChatScaleUpButton = $("mvVodChatScaleUp");
  const vodChatScaleValue = $("mvVodChatScaleValue");
  const VOD_CHAT_SCALE_STEPS = Object.freeze([100, 125, 150, 175]);
  function reflectVodChatScale() {
    const feed = $("mvVodChatFeed");
    feed?.style.setProperty("--mv-vod-chat-scale", String(vodChatScalePercent / 100));
    if (vodChatScaleValue) vodChatScaleValue.textContent = `${vodChatScalePercent}%`;
    if (vodChatScaleDownButton) vodChatScaleDownButton.disabled = vodChatScalePercent <= 100;
    if (vodChatScaleUpButton) vodChatScaleUpButton.disabled = vodChatScalePercent >= 175;
  }
  function stepVodChatScale(direction) {
    const currentIndex = VOD_CHAT_SCALE_STEPS.indexOf(vodChatScalePercent);
    const nextIndex = Math.max(0, Math.min(VOD_CHAT_SCALE_STEPS.length - 1, currentIndex + direction));
    vodChatScalePercent = VOD_CHAT_SCALE_STEPS[nextIndex];
    reflectVodChatScale();
  }
  vodChatScaleDownButton?.addEventListener("click", () => {
    stepVodChatScale(-1);
  });
  vodChatScaleUpButton?.addEventListener("click", () => {
    stepVodChatScale(1);
  });
  reflectVodChatScale();

  const VOD_CHAT_DISPLAY_SETTINGS = ["cheeseFeatureHidden", "cheeseChatTimeFormat"];
  function applyVodChatDisplaySettings(values = {}) {
    if (Object.hasOwn(values, "cheeseFeatureHidden")) {
      vodChatShowTime = values.cheeseFeatureHidden?.chatShowTime === true;
    }
    if (Object.hasOwn(values, "cheeseChatTimeFormat")) {
      vodChatTimeFormat = values.cheeseChatTimeFormat === "12h-en" ||
        values.cheeseChatTimeFormat === "12h-ko" ? values.cheeseChatTimeFormat : "24h";
    }
    renderVodChat();
  }
  chrome.storage.local.get(VOD_CHAT_DISPLAY_SETTINGS)
    .then(applyVodChatDisplaySettings)
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const values = {};
    for (const key of VOD_CHAT_DISPLAY_SETTINGS) {
      if (changes[key]) values[key] = changes[key].newValue;
    }
    if (Object.keys(values).length) applyVodChatDisplaySettings(values);
  });

  // 채팅 분리는 치지직 채팅창(독립 창)으로만 연다. ⚠ 예전의 '치즈 플래터 팝업'(확장 페이지)은
  //   치지직이 다른 출처의 iframe 표시를 막아 치지직 채팅을 띄울 수 없게 되어 없앴다.
  //   다시보기 채팅은 이 화면이 그리는 것이라 분리하지 않는다.
  function reflectChatPopoutButton() {
    const button = $("mvChatPopout");
    if (!button) return;
    const isVideo = isVideoChatSource(state.chatChannelId);
    button.dataset.tooltip = isVideo
      ? "다시보기 채팅은 분리할 수 없습니다."
      : "치지직 채팅창을 엽니다. 다른 채팅 확장 프로그램을 사용할 수 있습니다.";
    button.setAttribute("aria-label", isVideo ? "다시보기 채팅 분리(지원하지 않음)" : "치지직 채팅창으로 분리");
  }

  function updateChatPopupStatus(status, message = "") {
    const box = $("mvChatPopupStatus");
    if (!box) return;
    const text = status === "ready"
      ? "치지직 채팅창에서 표시 중"
      : status === "error"
        ? message || "채팅 연결 실패"
        : "치지직 채팅창 연결 중…";
    box.textContent = text;
    const returnButton = $("mvChatPopupReturn");
    if (returnButton) returnButton.dataset.tooltip = text;
  }

  function showChatPopoutFeedback(message) {
    const box = $("mvChatPopoutFeedback");
    if (!box) return;
    clearTimeout(chatPopoutFeedbackTimer);
    box.textContent = message;
    box.hidden = false;
    chatPopoutFeedbackTimer = setTimeout(() => {
      box.hidden = true;
      box.textContent = "";
    }, 5000);
  }

  function startChatReadyTimer(generation) {
    clearTimeout(chatReadyTimer);
    chatReadyTimer = setTimeout(() => {
      if (generation !== chatGeneration) return;
      if (!chatAutoRetried) {
        chatAutoRetried = true;
        loadChat(state.chatChannelId, { retry: true });
        return;
      }
      setChatStatus("error");
    }, CHAT_READY_TIMEOUT_MS);
  }

  function setChatStatus(status, message) {
    const box = $("mvChatStatus");
    if (detachedChat) updateChatPopupStatus(status, message);
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
    if (status === "unavailable") {
      box.innerHTML = `<span class="mv-cell-status-text">${esc(message || "다시보기 채팅은 멀티뷰에서 지원하지 않습니다.")}</span>`;
      return;
    }
    box.innerHTML =
      `<span class="mv-cell-status-text">${esc(message || "채팅을 불러오지 못했습니다.")}</span>` +
      '<button type="button" class="mv-cell-retry" id="mvChatRetry">다시 연결</button>';
  }

  function postVodChatControl(channelId, enabled, generation = chatGeneration) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow || !isVideoChatSource(channelId)) return false;
    try {
      frame.contentWindow.postMessage({
        source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
        type: "SET_MULTIVIEW_VOD_CHAT",
        channelId,
        enabled,
        chatGeneration: generation,
      }, CHZZK_ORIGIN);
      return true;
    } catch {
      return false;
    }
  }

  function stopVodChat() {
    vodLocalIdentityRequestId += 1;
    if (vodChatSourceId) {
      postVodChatControl(vodChatSourceId, false);
    }
    vodChatSourceId = "";
    vodChatRenderSignature = "";
    vodChatScrollInitialized = false;
    pendingVodLocalRevealId = "";
    vodChatSession.stop();
    vodLocalChatSession.setVideo("");
    globalThis.CheeseReplayLocalChat.applyAvatar(
      vodLocalChatAvatar, vodLocalChatSession.getIdentity(),
    );
    $("mvVodChatFeed").hidden = true;
    $("mvChatFrame").hidden = false;
  }

  function loadVodNicknameColorCodes() {
    if (vodNicknameColorsPromise) return vodNicknameColorsPromise;
    const url = `${globalThis.CheeseMultiviewSources.API}/service/v2/nickname/color/codes`;
    vodNicknameColorsPromise = globalThis.CheeseMultiviewSources.getJson(url)
      .then((content) => {
        if (globalThis.CheeseMultiviewVodChat.setNicknameColorCodes(content)) {
          vodChatRenderSignature = "";
          renderVodChat();
        }
      })
      .catch(() => {
        vodNicknameColorsPromise = null;
      });
    return vodNicknameColorsPromise;
  }

  function formatVodChatTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = value % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function formatVodBroadcastTime(timestamp, includeDate = false) {
    return globalThis.CheeseMultiviewVodChat.formatBroadcastTime(
      timestamp, vodChatTimeFormat, includeDate,
    );
  }

  function loadVodChatEmojiMap() {
    if (vodChatEmojiMapPromise) return vodChatEmojiMapPromise;
    vodChatEmojiMapPromise = (async () => {
      const key = "chatRecapEmojis";
      const [accountResponse, stored] = await Promise.all([
        fetch("https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus", {
          credentials: "include",
          headers: { accept: "application/json" },
        }).catch(() => null),
        chrome.storage.local.get(key).catch(() => ({})),
      ]);
      if (!accountResponse?.ok) return;
      const accountId = String((await accountResponse.json())?.content?.userIdHash || "")
        .trim().toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(accountId)) return;
      const root = stored?.[key];
      const source = root && typeof root === "object" ? root[accountId] : null;
      if (!source || typeof source !== "object") return;
      const next = Object.create(null);
      for (const [emojiId, rawUrl] of Object.entries(source)) {
        const url = String(rawUrl || "").trim();
        if (/^https:\/\/(?:[a-z0-9-]+\.)*(?:pstatic\.net|naver\.com|navercdn\.com)\//i.test(url)) {
          next[emojiId] = url;
        }
      }
      vodChatEmojiMap = next;
      vodChatEmojiRevision += 1;
    })().catch(() => {
      vodChatEmojiMapPromise = null;
    });
    return vodChatEmojiMapPromise;
  }

  function renderVodChatText(message) {
    const raw = String(message.text || "");
    const supplied = message.emojis && typeof message.emojis === "object"
      ? message.emojis
      : {};
    const pattern = /\{:([^:}]+):\}/g;
    let output = "";
    let last = 0;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      output += esc(raw.slice(last, match.index));
      const emojiId = String(match[1] || "").trim();
      const rawUrl = supplied[emojiId] || supplied[`:${emojiId}:`] || vodChatEmojiMap[emojiId];
      const url = String(rawUrl || "");
      if (/^https:\/\/(?:[a-z0-9-]+\.)*(?:pstatic\.net|naver\.com|navercdn\.com)\//i.test(url)) {
        output += `<img class="mv-vod-chat-emoji" src="${esc(url)}" alt="${esc(emojiId)}" width="22" height="22" loading="lazy" decoding="async" draggable="false">`;
      } else {
        output += esc(emojiId);
      }
      last = pattern.lastIndex;
    }
    return output + esc(raw.slice(last));
  }

  function renderVodChatSpecialCard(message, identity) {
    const info = message.donation;
    if (!info) return "";
    const cheeseIcon = '<span class="mv-vod-chat-cheese-icon" aria-hidden="true"></span>';
    const header = (suffix = "") =>
      `<div class="mv-vod-chat-special-head">${identity}${suffix ? `<strong>${esc(suffix)}</strong>` : ""}</div>`;
    if (info.kind === "subscription") {
      const period = info.month ? `<strong>${fmtCount(info.month)}개월</strong> 동안` : "";
      const tierClass = info.tier === 1 || info.tier === 2 ? ` is-tier-${info.tier}` : "";
      return `<div class="mv-vod-chat-card is-subscription${tierClass}">${header("님이")}` +
        `<div class="mv-vod-chat-special-copy">${period} 구독 중이에요 🎉</div>` +
        (message.text ? `<div class="mv-vod-chat-special-detail">${renderVodChatText(message)}</div>` : "") +
        `</div>`;
    }
    if (info.kind === "gift") {
      const tierName = esc(info.tierName || "구독권");
      const tierClass = info.tier === 1 || info.tier === 2 ? ` is-tier-${info.tier}` : "";
      if (info.receiverNickname) {
        return `<div class="mv-vod-chat-card is-gift is-personal-gift${tierClass}">${header("님이")}` +
          `<div class="mv-vod-chat-special-copy"><strong>${esc(info.receiverNickname)}</strong>님에게 ` +
          `<strong>${tierName} 구독권</strong>을 선물했습니다.</div>` +
          `</div>`;
      }
      const quantity = Math.max(1, Number(info.quantity) || 1);
      return `<div class="mv-vod-chat-card is-gift is-channel-gift${tierClass}">${header("님이")}` +
        `<div class="mv-vod-chat-special-copy"><strong>${tierName} 구독권 ${fmtCount(quantity)}개</strong>를 채널에 선물하였습니다.</div>` +
        `</div>`;
    }
    if (info.kind === "mission") {
      const isParticipation = [info.missionDonationType, info.donationType]
        .some((type) => /(?:^|_)PARTICIPATION$/i.test(type));
      const title = info.missionTitle || message.text;
      const renderedTitle = info.missionTitle ? esc(title) : renderVodChatText(message);
      const amount = info.amount > 0
        ? `<span class="mv-vod-chat-mission-amount">${cheeseIcon}<strong>${fmtCount(info.amount)}</strong></span>`
        : "";
      if (isParticipation) {
        return `<div class="mv-vod-chat-card is-mission is-participation">` +
          `${header("님이")}` +
          (title ? `<div class="mv-vod-chat-mission-prize-title"><strong>${renderedTitle}</strong> 미션에</div>` : "") +
          (amount ? `<div class="mv-vod-chat-mission-prize-amount">${amount}<span>추가했습니다.</span></div>` : "") +
          `</div>`;
      }
      const targetIcon = '<svg class="mv-vod-chat-mission-target" width="12" height="13" viewBox="0 0 12 13" fill="none" aria-hidden="true"><path d="M10.5492 6.72944C10.5492 9.24234 8.51211 11.2794 5.99922 11.2794C3.48632 11.2794 1.44922 9.24234 1.44922 6.72944C1.44922 4.21655 3.48632 2.17944 5.99922 2.17944" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.59941 6.72939C8.59941 8.16534 7.43535 9.32939 5.99941 9.32939C4.56347 9.32939 3.39941 8.16534 3.39941 6.72939C3.39941 5.29345 4.56347 4.12939 5.99941 4.12939" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.13992 3.61327L7.82386 2.66515C7.8005 2.59507 7.81874 2.51782 7.87097 2.46559L9.18141 1.15523C9.29503 1.04161 9.48961 1.10647 9.51233 1.26554L9.71507 2.68476C9.72732 2.77056 9.79474 2.83797 9.88054 2.85022L11.2996 3.05285C11.4587 3.07556 11.5236 3.27014 11.41 3.38377L10.0995 4.69426C10.0473 4.74648 9.97006 4.76472 9.9 4.74138L8.77057 4.36504L6.51403 6.74034C6.3286 6.93554 6.02003 6.94345 5.82483 6.75801C5.62963 6.57257 5.62172 6.264 5.80716 6.06881L8.13992 3.61327Z" fill="currentColor"/></svg>';
      const timer = info.missionTimeSeconds > 0
        ? `<span class="mv-vod-chat-mission-timer"><svg width="16" height="16" viewBox="0 0 13 14" fill="none" aria-hidden="true"><path fill="currentColor" d="M10.479 10.338a5.174 5.174 0 1 0-7.899 0l-1.096 1.096a.438.438 0 0 0 .618.619L3.2 10.956a5.14 5.14 0 0 0 6.661 0l1.097 1.097a.415.415 0 0 0 .31.128.43.43 0 0 0 .308-.128.437.437 0 0 0 0-.619l-1.096-1.096ZM8.29 8.774a.583.583 0 0 1-.822 0L5.946 7.252V4.3a.583.583 0 1 1 1.167 0v2.468L8.28 7.934a.583.583 0 0 1 .011.84ZM11.6 3.058a.46.46 0 0 1-.31-.129L9.943 1.576a.432.432 0 0 1 0-.618.437.437 0 0 1 .618 0l1.377 1.33a.438.438 0 0 1 0 .618.461.461 0 0 1-.338.152Zm-10.162 0a.437.437 0 0 1-.31-.747L2.482.958a.437.437 0 1 1 .619.618L1.746 2.929a.438.438 0 0 1-.309.129Z"/></svg><span>${String(Math.floor(info.missionTimeSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(info.missionTimeSeconds / 60) % 60).padStart(2, "0")}:${String(info.missionTimeSeconds % 60).padStart(2, "0")}</span></span>`
        : "";
      return `<div class="mv-vod-chat-card is-mission">` +
        `<div class="mv-vod-chat-special-head"><span class="mv-vod-chat-mission-label">${targetIcon}미션</span>${identity}</div>` +
        (title ? `<div class="mv-vod-chat-mission-title">${renderedTitle}</div>` : "") +
        `<div class="mv-vod-chat-mission-footer">${amount}` +
        timer +
        `</div></div>`;
    }
    const tone = info.tone || "neutral";
    const amount = info.amount > 0
      ? `<div class="mv-vod-chat-special-amount">${cheeseIcon} ${fmtCount(info.amount)}</div>`
      : "";
    const content = renderVodChatText(message);
    const videoLabel = info.kind === "video" && content
      ? '<strong class="mv-vod-chat-video-label">[영상 후원]</strong>'
      : "";
    const specialHeader = info.kind === "video"
      ? `<div class="mv-vod-chat-special-head">${identity}${videoLabel}</div>`
      : header();
    const party = info.kind === "party" && content && info.partyName
      ? ` · ${esc(info.partyName)}`
      : "";
    return `<div class="mv-vod-chat-card is-${info.kind} is-tone-${tone}">${specialHeader}` +
      `<div class="mv-vod-chat-special-copy">${content}${party}</div>${amount}</div>`;
  }

  function renderVodChatRow(message, timeMode, showTime = vodChatShowTime, options = {}) {
    const broadcastAt = message.broadcastAt || (message.local
      ? vodChatSession.broadcastTimeAt(message.at)
      : 0);
    const rowTime = showTime
      ? timeMode === "broadcast" && broadcastAt
        ? formatVodBroadcastTime(broadcastAt)
        : formatVodChatTime(message.at)
      : "";
    const badges = Array.isArray(message.badges) ? message.badges : [];
    const role = ["streamer", "manager", "operator", "partner"]
      .find((candidate) => message.roles?.includes(candidate));
    const roleClass = role ? ` is-badge-${role}` : "";
    const popupClasses = `${options.hideBackground ? " is-message-bg-hidden" : ""}` +
      `${options.hideBorder ? " is-message-border-hidden" : ""}`;
    const renderBadges = (position) => {
      const images = badges
        .filter((badge) => badge.position === position && (!options.roleBadgesOnly ||
          BADGE_CHAT_ROLE_BADGE_URLS.has(badge.url) || BADGE_CHAT_ROLE_BADGE_LABELS.has(badge.label)))
        .map((badge) => `<img class="mv-vod-chat-profile-badge" src="${esc(badge.url)}" alt="${esc(position === "after" ? "" : badge.label)}" width="16" height="16" loading="lazy" decoding="async">`)
        .join("");
      return images ? `<span class="mv-vod-chat-profile-badge-group is-${position}">${images}</span>` : "";
    };
    const time = rowTime ? `<time>${rowTime}</time>` : "";
    const nicknameTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const nicknameStyleValue = message.donation
      ? ""
      : message.nicknameTitleColor
        ? `color:${message.nicknameTitleColor};`
        : globalThis.CheeseMultiviewVodChat.resolveNicknameStyle(
          message.nicknameFallbackColor || message.nicknameColorCode || message.nicknameColor,
          nicknameTheme,
        );
    const nicknameStyle = nicknameStyleValue
      ? ` style="${esc(nicknameStyleValue)}"`
      : "";
    const roleMessageColor = !message.donation &&
      (message.roles?.includes("streamer") || message.roles?.includes("manager"))
      ? message.nicknameMessageColor || globalThis.CheeseMultiviewVodChat.resolveNicknameColor(
        message.nicknameFallbackColor || message.nicknameColorCode || message.nicknameColor,
        nicknameTheme,
      )
      : "";
    const badgeMarkup = { before: renderBadges("before"), after: renderBadges("after") };
    const identity = `<span class="mv-vod-chat-identity">${badgeMarkup.before}` +
      `<strong${nicknameStyle}>${esc(message.nickname)}</strong>${badgeMarkup.after}</span>`;
    if (message.donation) {
      const tone = message.donation.tone ? ` is-tone-${message.donation.tone}` : "";
      return `<article class="mv-vod-chat-row is-special${tone}${roleClass}${popupClasses}" data-chat-time="${message.at}">` +
        renderVodChatSpecialCard(message, identity) + `</article>`;
    }
    const localClass = message.local ? " is-local" : "";
    return `<article class="mv-vod-chat-row${roleClass}${localClass}${popupClasses}" data-chat-id="${esc(message.id)}" data-chat-time="${message.at}">` +
      `<div class="mv-vod-chat-inline">${time}${identity}` +
      (message.text ? `<span class="mv-vod-chat-message"${roleMessageColor
        ? ` style="color:${esc(roleMessageColor)}"` : ""}>${renderVodChatText(message)}</span>` : "") +
      `</div></article>`;
  }

  function renderVodChat() {
    if (!isVideoChatSource(state.chatChannelId) ||
        state.chatChannelId !== vodChatSourceId) return;
    const snapshot = vodChatSession.snapshot();
    const list = $("mvVodChatList");
    const statusBox = $("mvChatStatus");
    const meta = $("mvVodChatMeta");
    if (!list || !statusBox || !meta) return;
    const broadcastAt = vodChatSession.broadcastTimeAt(snapshot.currentTime);
    const clock = $("mvVodChatClock");
    if (clock) {
      clock.textContent = vodChatTimeMode === "broadcast" && broadcastAt
        ? `${formatVodBroadcastTime(broadcastAt, true)} · 실제 방송 시각`
        : `${formatVodChatTime(snapshot.currentTime)} · 재생 시간`;
    }
    if (vodChatTimeModeButton) {
      const canShowBroadcastTime = vodChatSession.hasBroadcastTimes();
      if (!canShowBroadcastTime && snapshot.complete) vodChatTimeMode = "playback";
      vodChatTimeModeButton.disabled = !canShowBroadcastTime;
      vodChatTimeModeButton.textContent = vodChatTimeMode === "broadcast" ? "방송 시각" : "재생 시간";
      vodChatTimeModeButton.setAttribute("aria-pressed", String(vodChatTimeMode === "broadcast"));
      vodChatTimeModeButton.setAttribute("aria-label", vodChatTimeMode === "broadcast"
        ? "재생 시간으로 전환"
        : "실제 방송 시각으로 전환");
    }
    const archived = vodChatSession.visible(snapshot.currentTime, 120);
    const local = vodLocalChatEnabled
      ? vodLocalChatSession.visible(snapshot.currentTime, 120)
      : [];
    const visible = [...archived, ...local]
      .sort((a, b) => a.at - b.at || Number(a.local) - Number(b.local))
      .slice(-120);
    const nicknameColorTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const localIdentityRevision = vodLocalChatSession.snapshot().identityRevision;
    const signature = `${snapshot.status}:${snapshot.error}:` +
      `${vodChatTimeMode}:${vodChatShowTime}:${vodChatTimeFormat}:${vodChatEmojiRevision}:${nicknameColorTheme}:` +
      `${localIdentityRevision}:` +
      `${globalThis.CheeseMultiviewVodChat.nicknameColorCodeRevision}:` +
      `${visible.map((message) => message.id).join("\u001f")}`;
    if (signature !== vodChatRenderSignature) {
      // 맨 아래 근처를 보던 중이면 재생에 따라 붙는 새 채팅을 따라간다. 위로 올려 과거를
      // 보는 중이면 위치를 둔다.
      // ⚠ 로컬 채팅 입력 보여 주기를 넣으면서 이 따라가기가 빠져, 채팅은 붙는데 창이
      //   스크롤되지 않았다.
      const nearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
      const previousScrollTop = list.scrollTop;
      list.innerHTML = visible
        .map((message) => renderVodChatRow(message, vodChatTimeMode))
        .join("");
      const pendingLocalRow = pendingVodLocalRevealId
        ? [...list.querySelectorAll(".mv-vod-chat-row.is-local")]
          .find((row) => row.dataset.chatId === pendingVodLocalRevealId)
        : null;
      if (pendingLocalRow) {
        globalThis.CheeseReplayLocalChat.revealRowAtPosition(list, pendingLocalRow);
        pendingVodLocalRevealId = "";
        vodChatScrollInitialized = true;
      } else if (!vodChatScrollInitialized && visible.length) {
        list.scrollTop = list.scrollHeight;
        vodChatScrollInitialized = true;
      } else {
        list.scrollTop = nearBottom ? list.scrollHeight : previousScrollTop;
      }
      // 새 채팅이 붙어도 스크롤 이벤트가 나지 않을 수 있어 여기서 다시 맞춘다.
      vodChatLatest.update();
      vodChatRenderSignature = signature;
    }
    renderVodBadgeChat(visible);

    if (snapshot.status === "error" && !local.length) {
      statusBox.hidden = false;
      statusBox.innerHTML = `<span class="mv-cell-status-text">${esc(snapshot.error || "채팅을 불러오지 못했습니다.")}</span>` +
        '<button type="button" class="mv-cell-retry" id="mvChatRetry">다시 시도</button>';
    } else if (snapshot.status === "empty" && !visible.length) {
      statusBox.hidden = false;
      statusBox.innerHTML = '<span class="mv-cell-status-text">이 구간에 표시할 채팅이 없습니다.</span>';
    } else if (snapshot.status === "idle" && !visible.length) {
      statusBox.hidden = false;
      statusBox.innerHTML = '<span class="mv-cell-status-text">다시보기 채팅을 준비하는 중…</span>';
    } else if (!visible.length && snapshot.status !== "empty" &&
        snapshot.loadedThrough <= snapshot.currentTime) {
      statusBox.hidden = false;
      statusBox.innerHTML = '<span class="mv-cell-status-text">재생 시점 채팅을 불러오는 중…</span>';
    } else if (!visible.length && snapshot.status === "ready") {
      statusBox.hidden = false;
      statusBox.innerHTML = '<span class="mv-cell-status-text">현재 재생 구간에 채팅이 없습니다.</span>';
    } else {
      statusBox.hidden = true;
      statusBox.innerHTML = "";
    }
  }

  function updateVodChatPlayback(data) {
    if (data.channelId !== state.chatChannelId ||
        data.channelId !== vodChatSourceId ||
        data.chatGeneration !== chatGeneration) return;
    const channel = state.chosen.find((item) => item.channelId === data.channelId);
    if (!channel?.videoNo) return;
    const current = vodChatSession.snapshot();
    if (current.videoNo !== channel.videoNo) {
      vodChatSession.start(channel.videoNo, data.currentTime);
    } else {
      vodChatSession.updatePlayback(data.currentTime, {
        seeking: data.seeking === true,
        paused: data.paused === true,
      });
    }
  }

  function loadChat(channelId, { retry = false } = {}) {
    const generation = ++chatGeneration;
    closeVodBadgeChatPopover(true);
    vodBadgeChatSignature = "reset";
    vodBadgeChatSeenIds.clear();
    // 채널을 바꾸면 이전 채널 닉네임 순환·강조를 멈춘다(라이브로 바뀌면 피드가 숨겨진다).
    vodBadgeChatPill?.render({
      actors: [],
      compact: vodBadgeChatSettings.compactPill,
      glow: vodBadgeChatSettings.pillGlowEnabled,
    });
    vodBadgeChatLatestId = "";
    vodBadgeChatLastPlaybackTime = null;
    vodBadgeChatHasBaseline = false;
    if (!retry) chatAutoRetried = false;
    const source = resolveChatSource(channelId);
    const selectedId = source?.id || "";
    state.chatChannelId = selectedId;
    chatFrameReady = false;
    if (source?.type === "video") {
      clearTimeout(chatReadyTimer);
      if (detachedChat) restoreInlineChat(true, false);
      stopVodChat();
      $("mvChatFrame").src = "about:blank";
      $("mvChatFrame").hidden = true;
      $("mvVodChatFeed").hidden = false;
      vodChatSourceId = selectedId;
      vodChatRenderSignature = "";
      const videoChannel = state.chosen.find((item) => item.channelId === selectedId);
      vodLocalChatSession.setVideo(videoChannel?.videoNo || "");
      globalThis.CheeseReplayLocalChat.applyAvatar(
        vodLocalChatAvatar, vodLocalChatSession.getIdentity(),
      );
      if (videoChannel?.videoNo) {
        vodChatSession.start(videoChannel.videoNo, 0);
        const identityRequestId = ++vodLocalIdentityRequestId;
        void globalThis.CheeseReplayLocalChat.loadIdentity(
          videoChannel.videoNo, videoChannel.ownerChannelId,
        ).then((identity) => {
          if (identityRequestId !== vodLocalIdentityRequestId ||
              vodChatSourceId !== selectedId ||
              vodChatSession.snapshot().videoNo !== videoChannel.videoNo) return;
          if (vodLocalChatSession.setIdentity(identity)) {
            globalThis.CheeseReplayLocalChat.applyAvatar(vodLocalChatAvatar, identity);
            vodChatRenderSignature = "";
            renderVodChat();
          }
        });
      }
      void loadVodChatEmojiMap().then(renderVodChat);
      void loadVodNicknameColorCodes();
      renderVodChat();
      if (currentStatus(selectedId) === "ready")
        postVodChatControl(selectedId, true, generation);
      renderTopbar();
      return generation;
    }
    stopVodChat();
    $("mvChatFrame").hidden = false;
    const liveChannelId = source?.id || "";
    if (!liveChannelId) {
      clearTimeout(chatReadyTimer);
      if (detachedChat) restoreInlineChat(true, false);
      $("mvChatFrame").src = "about:blank";
      setChatStatus("error", "채팅을 표시할 채널을 선택해 주세요.");
      renderTopbar();
      return generation;
    }
    if (detachedChat) {
      clearTimeout(chatReadyTimer);
      if (retry || detachedChat.channelId !== channelId) {
        const popup = detachedChat;
        popup.channelId = channelId;
        const url = new URL(`/live/${liveChannelId}/chat`, CHZZK_ORIGIN).toString();
        popup.navigation = (popup.navigation || Promise.resolve()).then(() => {
          if (detachedChat !== popup) return;
          return EXT.updateTabUrl(popup.tabId, url);
        }).catch(() => {
          if (detachedChat !== popup) return;
          showChatPopoutFeedback("치지직 채팅창을 전환하지 못해 이 화면으로 돌아왔습니다.");
          restoreInlineChat();
        });
      }
      setChatStatus("ready");
      return generation;
    }
    setChatStatus("loading");
    // 채팅 전용 페이지를 쓴다(/live/<id>/chat). 영상이 없는 화면이라 소리·화질을
    // 따로 억제할 필요가 없고, 라이브 페이지를 통째로 띄우는 것보다 훨씬 가볍다.
    const url = new URL(`/live/${liveChannelId}/chat`, CHZZK_ORIGIN);
    url.searchParams.set("cheeseMultiChat", "1");
    url.searchParams.set("cheeseMultiChatGeneration", String(generation));
    // 다시 연결할 때 같은 주소면 브라우저가 무시할 수 있어 값을 하나 바꾼다.
    if (retry) url.searchParams.set("cheeseRetry", String(generation));
    loadFrame($("mvChatFrame"), url.toString());

    startChatReadyTimer(generation);
    return generation;
  }

  function applyChat(channelId) {
    const inlineFrame = $("mvChatFrame");
    const source = resolveChatSource(channelId);
    if (!source) {
      loadChat("");
      return;
    }
    if (state.chatChannelId === source.id) {
      if (source.type === "video") {
        const video = state.chosen.find((item) => item.channelId === source.id);
        const vodSnapshot = vodChatSession.snapshot();
        if (vodChatSourceId === source.id && video?.videoNo &&
            vodSnapshot.videoNo === video.videoNo && !$("mvVodChatFeed").hidden) return;
      }
      if (source.type === "live" &&
          (detachedChat || (inlineFrame?.src && !inlineFrame.src.endsWith("about:blank"))))
        return;
    }
    loadChat(source.id);
  }

  function restoreInlineChat(closePopup = true, reloadChat = !isVideoChatSource(state.chatChannelId)) {
    const popup = detachedChat;
    if (!popup) return;
    detachedChat = null;
    clearTimeout(chatReadyTimer);
    $("mvStage").classList.remove("is-chat-popped-out");
    applyLayout();
    $("mvChatPopupControl").hidden = true;
    $("mvChatPopout").hidden = false;
    if (closePopup) EXT.removeWindow(popup.windowId).catch(() => {});
    if (reloadChat) loadChat(state.chatChannelId);
    else if (isVideoChatSource(state.chatChannelId)) renderVodChat();
  }

  function focusDetachedChat() {
    if (detachedChat) EXT.focusWindow(detachedChat.windowId).catch(() => {});
  }

  async function openNativeChatPopup() {
    if (detachedChat) {
      focusDetachedChat();
      return;
    }
    if (nativeChatOpening) return;
    const channelId = state.chatChannelId;
    if (!HASH_RE.test(channelId || "")) return;
    const url = new URL(`/live/${channelId}/chat`, CHZZK_ORIGIN);
    nativeChatOpening = true;
    let popupWindow;
    try {
      popupWindow = await EXT.createWindow({
        url: url.toString(),
        type: "popup",
        width: 420,
        height: 760,
      });
    } catch {
      showChatPopoutFeedback("치지직 채팅창을 열지 못했습니다.");
    } finally {
      nativeChatOpening = false;
    }
    const tabId = popupWindow?.tabs?.[0]?.id;
    if (!Number.isInteger(popupWindow?.id) || !Number.isInteger(tabId)) {
      if (Number.isInteger(popupWindow?.id)) EXT.removeWindow(popupWindow.id).catch(() => {});
      if (popupWindow) showChatPopoutFeedback("치지직 채팅창을 연결하지 못했습니다.");
      return;
    }
    detachedChat = {
      windowId: popupWindow.id,
      tabId,
      channelId,
    };
    closeChatSelector();
    $("mvStage").classList.add("is-chat-popped-out");
    applyLayout();
    $("mvChatPopupControl").hidden = false;
    $("mvChatPopout").hidden = true;
    $("mvChatFrame").src = "about:blank";
    loadChat(state.chatChannelId);
  }

  EXT.onWindowRemoved((windowId) => {
    if (detachedChat && detachedChat.windowId === windowId) {
      restoreInlineChat(false);
    }
  });

  function openChatPopout() {
    if (isVideoChatSource(state.chatChannelId)) {
      showChatPopoutFeedback("다시보기 채팅은 분리할 수 없습니다.");
      return;
    }
    openNativeChatPopup();
  }

  // 칸(iframe)은 채널마다 하나씩 만들어 두고 배치가 바뀌어도 '자리'만 옮긴다.
  // ⚠ 다시 만들면 src 가 새로 걸려 방송이 처음부터 다시 로드된다. 메인 변경·배치
  //   변경은 화면을 재배치할 뿐이므로 기존 프레임을 그대로 살려 둔다.
  const cells = new Map(); // channelId -> .mv-cell 요소

  // 프레임 상태 관리. 준비 신호가 제때 안 오면 '다시 불러오기' 를 띄운다.
  const frameTimers = new Map(); // channelId -> timeout id
  const frameLoadTimers = new Map(); // channelId -> staggered load timeout
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
          source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
          type: "RECONCILE_MULTIVIEW_UI",
          channelId,
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  function requestMultiviewWideApply(channelId) {
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
          type: "APPLY_MULTIVIEW_WIDE",
          channelId,
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  // 칸 상태를 바꾸는 유일한 통로. 여기서 타일 덮개와 Quick 목록을 함께 갱신해
  // 두 곳이 다른 상태를 보여 주지 않게 한다.
  function setCellStatus(channelId, status, message) {
    if (
      status === "loading" ||
      status === "error" ||
      status === "ended" ||
      status === "ui-error"
    ) {
      clearChannelSync(channelId);
      if (status !== "loading") clearChannelMixer(channelId);
      if (status === "ended" || status === "error")
        clearQualityChannelActivity(channelId);
    }
    if (status === "ready" && frameStates.get(channelId) !== "ready") {
      syncReadyAt.set(channelId, Date.now());
    }
    frameStates.set(channelId, status);
    refreshSyncPanel();
    // 라이브 따라잡기는 싱크 패널이 닫혀 있어도 측정이 필요하다.
    updateSyncPolling();
    const cell = cells.get(channelId);
    if (cell) {
      cell.dataset.status = status;
      const overlay = cell.querySelector(".mv-cell-status");
      if (overlay) renderCellOverlay(overlay, channelId, status, message);
      renderCellWidePrompt(channelId);
    }
    // Quick 패널이 닫혀 있어도 상태는 위에서 이미 갱신됐다. 열려 있을 때만 다시 그린다.
    if (!$("mvQuick")?.hidden) renderQuick();
    updateQualityPolling();
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
    const video = isVideoSlot(channelId);
    const text =
      message ||
      (status === "ended"
        ? video ? "다시보기 재생이 끝났습니다." : "방송이 종료되었습니다."
        : "플레이어를 불러오지 못했습니다.");
    const id = esc(channelId);
    // ⚠ 상태마다 할 수 있는 일이 다르다. 할 수 없는 일은 버튼으로 두지 않는다.
    //   ended = 방송이 끝났다 → 다시 불러와도 같은 종료 화면이고, 화면 정리는 뜻이
    //           없다. 다른 채널로 바꾸거나, 다시 켜졌는지 확인하는 것만 남는다.
    //   error = 플레이어를 못 불러왔다 → 다시 불러오기가 가장 먼저다.
    const actions =
      status === "ended"
        ? `<button type="button" class="mv-cell-retry is-primary" data-mv-replace="${id}">${video ? "다른 영상 선택" : "다른 채널 선택"}</button>` +
          (video ? "" : `<button type="button" class="mv-cell-retry" data-mv-recheck="${id}">방송 다시 확인</button>`)
        : `<button type="button" class="mv-cell-retry is-primary" data-mv-retry="${id}">다시 불러오기</button>` +
          `<button type="button" class="mv-cell-retry" data-mv-replace="${id}">다른 채널 선택</button>`;
    overlay.innerHTML =
      (status === "ended"
        ? `<strong class="mv-cell-status-channel">${esc(channelName(channelId))}</strong>`
        : "") +
      `<span class="mv-cell-status-text">${esc(text)}</span>` +
      `<span class="mv-cell-status-actions">${actions}</span>`;
  }

  function renderCellWidePrompt(channelId) {
    const cell = cells.get(channelId);
    const prompt = cell?.querySelector(".mv-cell-wide-prompt");
    if (!prompt) return;
    prompt.hidden = currentStatus(channelId) !== "ready" ||
      cell.dataset.widePromptPending !== "true" || cell.dataset.wideScreenOn === "true";
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
    clearTimeout(frameLoadTimers.get(channelId));
    frameLoadTimers.delete(channelId);
    setCellStatus(channelId, "loading");
    loadFrame(frame, frameUrl(
      channel,
      channelId === state.mainId,
      state.mainHighQuality,
    ));
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

      const widePrompt = document.createElement("div");
      widePrompt.className = "mv-cell-wide-prompt";
      widePrompt.hidden = true;
      widePrompt.innerHTML =
        '<span aria-live="polite">화면 맞춤 지연</span>' +
        `<button type="button" data-mv-wide-apply="${esc(channel.channelId)}" ` +
        `aria-label="${esc(channel.channelName)} 넓은 화면·채팅 접기 다시 적용" ` +
        'class="mv-custom-tooltip" data-tooltip="넓은 화면과 채팅 접기를 다시 맞춥니다.&#10;넓은 화면이 늦으면 플레이어에서 T를 누르세요">' +
        '다시 적용 <kbd>T</kbd></button>';

      // 칸 도구 모음(자리 바꾸기 손잡이 + 제거). 한 곳에 모아 영상을 덜 가린다.
      const tools = document.createElement("div");
      tools.className = "mv-cell-tools";

      // 이 채널만 멀티뷰에서 뺀다(멀티뷰 전체를 닫는 것이 아니다).
      const close = document.createElement("button");
      close.type = "button";
      close.className = "mv-cell-close mv-custom-tooltip";
      close.dataset.mvClose = channel.channelId;
      close.textContent = "×";
      close.setAttribute(
        "aria-label",
        `${channel.channelName} 멀티뷰에서 제거`,
      );

      const change = document.createElement("button");
      change.type = "button";
      change.className = "mv-cell-change mv-custom-tooltip";
      change.dataset.mvReplace = channel.channelId;
      change.textContent = "변경";
      change.dataset.tooltip = `${channel.channelName} 채널 변경`;
      change.setAttribute("aria-label", `${channel.channelName} 채널 변경`);

      // 자리 바꾸기 손잡이.
      // ⚠ iframe 은 교차 출처라 그 위에서 시작한 드래그 이벤트가 부모로 오지 않는다.
      //   그래서 칸 위에 얹은 이 손잡이에서만 드래그를 시작한다.
      const grip = document.createElement("div");
      grip.className = "mv-cell-grip mv-custom-tooltip";
      grip.draggable = true;
      grip.dataset.tooltip = "끌어서 자리 바꾸기";
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
      promote.className = "mv-cell-main mv-custom-tooltip";
      promote.dataset.mvPromote = channel.channelId;
      promote.dataset.tooltip = "이 채널을 메인으로";
      promote.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        '<rect width="18" height="18" x="3" y="3" rx="2"></rect>' +
        '<path d="M3 9h18"></path><path d="M9 21V9"></path></svg>' +
        "<span>메인으로</span>";
      // ⚠ 손잡이만 draggable 이다. 제거 단추가 드래그 시작점이 되면 안 된다.
      tools.appendChild(grip);
      tools.appendChild(change);
      tools.appendChild(close);
      cell.appendChild(box);
      cell.appendChild(overlay);
      cell.appendChild(widePrompt);
      cell.appendChild(tools);
      cell.appendChild(promote);
      cells.set(channel.channelId, cell);
      frames.appendChild(cell);
      setCellStatus(channel.channelId, "loading");

      const src = frameUrl(channel, isMain, state.mainHighQuality);
      const delay = stagger * index;
      if (delay) {
        const timer = setTimeout(() => {
          frameLoadTimers.delete(channel.channelId);
          if (
            cells.get(channel.channelId) !== cell ||
            !frame.isConnected ||
            !state.chosen.some((item) => item.channelId === channel.channelId)
          )
            return;
          loadFrame(frame, src);
          armReadyTimeout(channel.channelId);
        }, delay);
        frameLoadTimers.set(channel.channelId, timer);
      } else loadFrame(frame, src);
      if (!delay) armReadyTimeout(channel.channelId);
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
    const stage = $("mvStage");
    const { direction, side } = LAYOUTS.stageStyle(layout, state.chatSide);
    state.chatSide = side;
    // 레터박스를 없애려면 칸 자체가 16:9 여야 한다. 그렇게 되는 트랙 크기를 풀어
    // 쓰고, 격자 전체도 그때 필요한 가로:세로로 묶는다(남는 자리는 격자 바깥에서
    // 한 번만 생긴다). 해가 없는 배치(오른쪽+아래 등)는 기존 fr 값으로 돌아간다.
    // 빈 칸 채팅은 칸이 스테이지를 채우므로 16:9 트랙을 쓰지 않는다.
    const inset = LAYOUTS.usesChatInset(layout, side);
    const tracks = inset ? null : LAYOUTS.solveTracks(layout);
    stage.classList.toggle("is-chat-top-layout", layout.chatTop === true);
    stage.classList.toggle("is-chat-inset-layout", inset);
    if (layout.chatTop || inset) {
      const hideChat = stage.classList.contains("is-chat-folded") ||
        stage.classList.contains("is-chat-popped-out");
      const grid = layout.chatTop
        ? LAYOUTS.chatTopStageGrid(layout, side, hideChat)
        : LAYOUTS.chatInsetStageGrid(layout, hideChat);
      stage.style.gridTemplateColumns = grid.columns;
      stage.style.gridTemplateRows = grid.rows;
      stage.style.gridTemplateAreas = grid.areas;
      frames.style.gridTemplateColumns = "";
      frames.style.gridTemplateRows = "";
      frames.style.gridTemplateAreas = "";
    } else {
      stage.style.gridTemplateColumns = "";
      stage.style.gridTemplateRows = "";
      stage.style.gridTemplateAreas = "";
      frames.style.gridTemplateColumns = tracks ? tracks.columns : layout.columns;
      frames.style.gridTemplateRows = tracks ? tracks.rows : layout.rows;
      frames.style.gridTemplateAreas = layout.areas.join(" ");
    }
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
        close.dataset.tooltip = locked
          ? "멀티뷰는 최소 2개 채널이 필요합니다."
          : "멀티뷰에서 제거";
      }
    });

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
    // ⚠ 예전에는 시작 화질을 칸을 처음 띄울 때만 정해, 메인을 바꿔도 새 메인이 고화질로,
    //   이전 메인이 480p 로 바뀌지 않았다.
    const roleToken = ++qualityRoleToken;
    if (before) postState(before, false, { roleToken });
    postState(channelId, true, { roleToken });
    // 이전 메인에 남아 있던 '소리를 켜려면 클릭' 도 함께 지운다.
    if (before) clearAudioNotice(before);
    clearAudioNotice(channelId);
    // 메인을 따라가도록 해 뒀으면 채팅도 같이 옮긴다.
    const chatId = chatSourceId(channelId);
    if (state.chatFollowsMain) {
      if (state.chatEnabled) applyChat(chatId);
      else {
        state.chatChannelId = chatId;
        renderTopbar();
      }
    }
    applyLayout();
  }

  function promoteMainAudio(channelId) {
    const audio = audioOf(channelId);
    if (audio.muted && !audio.muteTouched) audio.muted = false;
  }

  function setLayout(layoutId) {
    const layout = LAYOUTS.layoutById(layoutId);
    if (!layout || layoutId === state.layoutId) return;
    state.layoutId = layoutId;
    state.chatSide = LAYOUTS.chatSideForSwitch(layout, state.chatSide);
    applyLayout();
  }

  function setChatSide(side) {
    const layout = LAYOUTS.layoutById(state.layoutId);
    if (!LAYOUTS.chatSidesFor(layout).includes(side)) return;
    state.chatSide = side;
    applyLayout();
  }

  // ── 최상단 조작 막대 ───────────────────────────────────────────────────
  const SIDE_LABEL = {
    right: "오른쪽",
    left: "왼쪽",
    bottom: "아래",
    top: "위",
    [LAYOUTS.CHAT_INSET_SIDE]: "빈 칸",
  };

  function channelName(id) {
    return state.chosen.find((c) => c.channelId === id || c.ownerChannelId === id)?.channelName || "-";
  }

  function ownerChannelId(slotId) {
    const channel = state.chosen.find((item) => item.channelId === slotId);
    if (channel?.mediaType === "video") return "";
    return channel?.ownerChannelId || channel?.channelId || "";
  }

  function chatSourceId(slotId) {
    const channel = state.chosen.find((item) => item.channelId === slotId);
    if (channel?.mediaType === "video") return channel.channelId;
    return channel?.ownerChannelId || channel?.channelId || "";
  }

  function isVideoChatSource(sourceId) {
    return /^video:\d+$/.test(String(sourceId || "")) &&
      state.chosen.some((item) => item.channelId === sourceId && item.mediaType === "video");
  }

  function resolveChatSource(sourceId) {
    const id = String(sourceId || "").toLowerCase();
    if (isVideoChatSource(id)) return { id, type: "video" };
    if (!HASH_RE.test(id)) return null;
    const channel = state.chosen.find((item) =>
      item.mediaType !== "video" && ownerChannelId(item.channelId) === id,
    );
    return channel ? { id, type: "live", channel } : null;
  }

  function chatSourceLabel(sourceId) {
    const channel = state.chosen.find((item) =>
      item.channelId === sourceId || ownerChannelId(item.channelId) === sourceId,
    );
    if (!channel) return "채팅";
    return channel.mediaType === "video"
      ? `${channel.channelName} 다시보기 채팅`
      : `${channel.channelName} 채팅`;
  }

  function availableChatChannels() {
    const channels = new Map();
    for (const channel of state.chosen) {
      const id = chatSourceId(channel.channelId);
      if (id && !channels.has(id)) {
        channels.set(id, channel.mediaType === "video"
          ? `${channel.channelName} · 다시보기`
          : channel.channelName);
      }
    }
    return [...channels];
  }

  function isVideoSlot(slotId) {
    return state.chosen.some((item) => item.channelId === slotId && item.mediaType === "video");
  }

  function optionRow(value, label, on, attr) {
    return (
      `<button type="button" role="option" aria-selected="${on}"` +
      ` class="mv-pop-option${on ? " is-on" : ""}" ${attr}="${esc(value)}">` +
      `${esc(label)}</button>`
    );
  }

  function closeChatSelector() {
    $("mvChatTitleList").hidden = true;
    $("mvChatTitle").setAttribute("aria-expanded", "false");
  }

  function renderChatTitle() {
    const label = $("mvChatTitle")?.querySelector(".mv-chat-title-label");
    if (label) label.textContent = state.chatEnabled && state.chatChannelId
      ? chatSourceLabel(state.chatChannelId)
      : "채팅 없음";
  }

  function toggleChatSelector() {
    const list = $("mvChatTitleList");
    if (!list.hidden) return closeChatSelector();
    closePopovers(null);
    closeQuick();
    const chatChannels = availableChatChannels();
    if (!chatChannels.length) return;
    list.innerHTML = chatChannels
      .map(([id, name]) =>
        optionRow(id, name, id === state.chatChannelId, "data-mv-set-chat"),
      )
      .join("");
    list.hidden = false;
    $("mvChatTitle").setAttribute("aria-expanded", "true");
  }

  function renderTopbar() {
    const layout = LAYOUTS.layoutById(state.layoutId);
    $("mvMainValue").textContent = channelName(state.mainId);
    $("mvChatValue").textContent = !state.chatEnabled
      ? "사용 안 함"
      : state.chatChannelId
      ? channelName(state.chatChannelId)
      : "미지원";
    $("mvSideValue").textContent = SIDE_LABEL[state.chatSide] || "-";
    $("mvLayoutValue").textContent = layout?.label || "-";
    renderChatTitle();
    $("mvChatTitle").disabled = availableChatChannels().length === 0;
    reflectChatPopoutButton();
    if (!detachedChat) $("mvChatPopout").hidden = !resolveChatSource(state.chatChannelId);
    if (!$("mvChatTitleList").hidden) {
      $("mvChatTitleList").innerHTML = availableChatChannels()
        .map(([channelId, name]) =>
          optionRow(
            channelId,
            name,
            channelId === state.chatChannelId,
            "data-mv-set-chat",
          ),
        )
        .join("");
    }

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
          chatSourceId(c.channelId),
          c.mediaType === "video" ? `${c.channelName} · 다시보기` : c.channelName,
          chatSourceId(c.channelId) === state.chatChannelId,
          "data-mv-set-chat",
        ),
      )
      .join("");
    // 배치마다 고를 수 있는 자리가 다르다(chatSidesFor). 순서는 늘 같게 둔다.
    const sides = LAYOUTS.chatSidesFor(layout);
    $("mvSidePanel").innerHTML = [...LAYOUTS.CHAT_SIDES, LAYOUTS.CHAT_INSET_SIDE]
      .filter((side) => sides.includes(side))
      .map((side) =>
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
        const preview = LAYOUTS.previewGrid(l);
        return (
          `<button type="button" role="option" aria-selected="${on}"` +
          ` class="mv-pop-option mv-pop-option-layout${on ? " is-on" : ""}"` +
          ` data-mv-set-layout="${esc(l.id)}">` +
          `<span class="mv-layout-preview" style="grid-template-columns:${esc(preview.columns)};` +
          `grid-template-rows:${esc(preview.rows)};` +
          `aspect-ratio:${esc(preview.ratio)};` +
          `grid-template-areas:${esc(preview.areas)}">` +
          LAYOUTS.SLOTS.slice(0, l.aux + 1)
            .map(
              (slot) =>
                `<i style="grid-area:${slot}"${slot === "m" ? ' class="is-main"' : ""}></i>`,
            )
            .join("") +
          (preview.chat ? '<i class="is-chat" style="grid-area:x" aria-hidden="true"></i>' : "") +
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
  let mixerPresetPickerId = "";
  let groupAssignmentPickerId = "";
  let mixerCommandSeq = 0;
  let mixerDragId = "";

  function requestMixerState(channelId) {
    if (currentStatus(channelId) !== "ready") return;
    const frame = cells.get(channelId)?.querySelector("iframe");
    frame?.contentWindow?.postMessage(
      { source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD, type: "MIXER_GET_STATE", channelId },
      CHZZK_ORIGIN,
    );
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
    frame.contentWindow.postMessage(
      { source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD, type, channelId, commandId, ...values },
      CHZZK_ORIGIN,
    );
    return true;
  }

  function clearChannelMixer(channelId) {
    if (mixerPresetPickerId === channelId) closeMixerPresetPicker();
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
    mixerOpen.delete(channelId);
  }

  function clearRemovedChannel(channelId) {
    clearTimeout(frameLoadTimers.get(channelId));
    frameLoadTimers.delete(channelId);
    channelAudio.delete(channelId);
    audioBlocked.delete(channelId);
    statsByChannel.delete(channelId);
    qualityByChannel.delete(channelId);
    const qualityRequest = qualityRequestByChannel.get(channelId);
    if (qualityRequest?.timer) clearTimeout(qualityRequest.timer);
    qualityRequestByChannel.delete(channelId);
    const qualityCommand = qualityPending.get(channelId);
    if (qualityCommand?.timer) clearTimeout(qualityCommand.timer);
    qualityPending.delete(channelId);
    qualityFeedback.delete(channelId);
    clearChannelMixer(channelId);
    clearChannelSync(channelId, true);
  }

  function normalizeMixerSnapshot(raw) {
    if (
      !raw ||
      typeof raw !== "object" ||
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 0 ||
      typeof raw.ready !== "boolean" ||
      typeof raw.enabled !== "boolean" ||
      typeof raw.graphConflict !== "boolean" ||
      typeof raw.preset !== "string" ||
      raw.preset.length > 128 ||
      typeof raw.presetDirty !== "boolean" ||
      !Number.isFinite(raw.gain) ||
      !Number.isFinite(raw.gainMin) ||
      !Number.isFinite(raw.gainMax) ||
      !Number.isFinite(raw.gainStep) ||
      raw.gainMin < 0 ||
      raw.gainMax > 4 ||
      raw.gainMin >= raw.gainMax ||
      raw.gainStep <= 0 ||
      raw.gainStep > 1 ||
      !Array.isArray(raw.presets) ||
      raw.presets.length > 100
    )
      return null;
    const presets = [];
    for (const item of raw.presets) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 128 ||
        typeof item.label !== "string" ||
        item.label.length > 80 ||
        !["builtin", "custom"].includes(item.kind)
      )
        return null;
      presets.push({ id: item.id, label: item.label, kind: item.kind });
    }
    return {
      ready: raw.ready,
      enabled: raw.enabled,
      graphConflict: raw.graphConflict,
      preset: raw.preset,
      presetDirty: raw.presetDirty,
      gain: raw.gain,
      gainMin: raw.gainMin,
      gainMax: raw.gainMax,
      gainStep: raw.gainStep,
      presets,
      revision: raw.revision,
    };
  }

  function acceptMixerSnapshot(channelId, raw) {
    const next = normalizeMixerSnapshot(raw);
    if (!next || next.revision < (mixerStates.get(channelId)?.revision ?? -1))
      return false;
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
    button.dataset.tooltip = label;
  }

  function volumeButtonState() {
    if (state.masterMuted) return { value: "전체 음소거", muted: true };
    if (state.audioFocusMode) {
      if (!state.mainId || effectiveMuted(state.mainId))
        return { value: "메인 음소거", muted: true };
      return { value: `메인 ${pct(state.masterVolume)}`, muted: false };
    }
    const mutedCount = state.chosen.filter((channel) => audioOf(channel.channelId).muted).length;
    if (mutedCount === state.chosen.length && mutedCount > 0)
      return { value: "모두 음소거", muted: true };
    if (mutedCount > 0) return { value: "일부 음소거", muted: true };
    return { value: `전체 ${pct(state.masterVolume)}`, muted: false };
  }

  function syncVolumePanelButton() {
    const button = $("mvVolumeBtn");
    const value = $("mvVolumeValue");
    const icon = $("mvVolumeStatusIcon");
    if (!button) return;
    const status = volumeButtonState();
    if (value) value.textContent = status.value;
    button.classList.toggle("is-muted", status.muted);
    const blocked = audioBlocked.size > 0;
    button.setAttribute("aria-label", blocked
      ? `볼륨 조절, 소리가 차단됨, ${status.value}`
      : `볼륨 조절, ${status.value}`);
    button.dataset.tooltip = blocked
      ? `소리가 차단됨 · ${status.value}`
      : `볼륨 · ${status.value}`;
    if (icon) {
      const quiet = status.muted || state.masterVolume <= 0;
      const kind = quiet ? "x" : state.masterVolume > 0.5 ? "high" : "low";
      icon.innerHTML = volumeIcon(kind);
      icon.classList.toggle("is-muted", quiet);
    }
  }

  // 전체 볼륨은 모든 칸의 실제 출력에 곱해지므로 아이콘과 상단 상태를 맞춘다.
  function syncAllVolumeButtons() {
    for (const c of state.chosen) syncVolumeButton(c.channelId);
    syncVolumePanelButton();
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
    const selectedPreset = mixer.presets.find(
      (item) => item.id === mixer.preset,
    );
    const presetLabel =
      !mixer.presetDirty && selectedPreset
        ? selectedPreset.label
        : "사용자 조정";
    const draft = mixerGainDrafts.get(channelId);
    const gain = Number.isFinite(draft) ? draft : mixer.gain;
    const error = mixerErrors.get(channelId);
    const open = mixerOpen.has(channelId);
    return (
      `<div class="mv-mixer-controls"${open ? "" : " hidden"}>` +
      `<label class="mv-mixer-power">오디오 믹서 <input type="checkbox" data-mv-mixer-enabled="${id}"${mixer.enabled ? " checked" : ""}></label>` +
      `<span class="mv-mixer-preset">프리셋 <span class="mv-mixer-preset-picker">` +
      `<button type="button" class="mv-mixer-preset-trigger" data-mv-mixer-preset-toggle="${id}" ` +
      `aria-haspopup="listbox" aria-expanded="${mixerPresetPickerId === channelId}" ` +
      `aria-label="${esc(channelName(channelId))} 오디오 믹서 프리셋">` +
      `<span>${esc(presetLabel)}</span>` +
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>` +
      `</button></span></span>` +
      `<label class="mv-mixer-gain">게인 <input type="range" data-mv-mixer-gain="${id}" data-gain-step="${mixer.gainStep}" min="${mixer.gainMin}" max="${mixer.gainMax}" step="any" value="${gain}" aria-label="${esc(channelName(channelId))} 오디오 믹서 게인"><output>${Math.round(gain * 100)}%</output></label>` +
      (mixerConfirm.has(channelId)
        ? `<div class="mv-mixer-confirm">이 채널은 '항상 켜기' 상태입니다. 끄면 이 채널을 항상 켜기 대상에서 제외합니다. <button type="button" data-mv-mixer-confirm="${id}">끄기</button><button type="button" data-mv-mixer-cancel="${id}">취소</button></div>`
        : "") +
      (error ? `<p class="mv-mixer-error">${esc(error)}</p>` : "") +
      `</div>`
    );
  }

  function closeMixerPresetPicker() {
    mixerPresetPickerId = "";
    document.getElementById("mvMixerPresetList")?.remove();
    document
      .querySelectorAll("[data-mv-mixer-preset-toggle]")
      .forEach((trigger) => {
        trigger.setAttribute("aria-expanded", "false");
      });
  }

  function positionMixerPresetPicker() {
    const id = mixerPresetPickerId;
    const list = document.getElementById("mvMixerPresetList");
    const trigger = document.querySelector(
      `[data-mv-mixer-preset-toggle="${CSS.escape(id)}"]`,
    );
    if (!id || !list || !trigger) return closeMixerPresetPicker();
    const rect = trigger.getBoundingClientRect();
    const padding = 12;
    const maxHeight = Math.min(
      280,
      Math.max(120, window.innerHeight - padding * 2),
    );
    list.style.minWidth = `${Math.round(rect.width)}px`;
    list.style.maxHeight = `${maxHeight}px`;
    const listHeight = Math.min(list.scrollHeight, maxHeight);
    const below = window.innerHeight - rect.bottom - padding;
    const above = rect.top - padding;
    const top =
      below >= Math.min(140, listHeight) || below >= above
        ? rect.bottom + 4
        : Math.max(padding, rect.top - listHeight - 4);
    list.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - rect.width - padding))}px`;
    list.style.top = `${Math.round(top)}px`;
  }

  function openMixerPresetPicker(channelId) {
    const mixer = mixerStates.get(channelId);
    if (!mixer?.ready || mixer.graphConflict) return;
    if (mixerPresetPickerId === channelId) {
      closeMixerPresetPicker();
      return;
    }
    closeMixerPresetPicker();
    mixerPresetPickerId = channelId;
    const selected = !mixer.presetDirty ? mixer.preset : "";
    const options = (kind) =>
      mixer.presets
        .filter((item) => item.kind === kind)
        .map(
          (item) =>
            `<button type="button" role="option" data-mv-mixer-preset-option="${esc(channelId)}" ` +
            `data-preset-id="${esc(item.id)}" aria-selected="${item.id === selected}">${esc(item.label)}</button>`,
        )
        .join("");
    const custom = options("custom");
    const list = document.createElement("div");
    list.id = "mvMixerPresetList";
    list.className = "mv-mixer-preset-list";
    list.setAttribute("role", "listbox");
    list.setAttribute(
      "aria-label",
      `${channelName(channelId)} 오디오 믹서 프리셋`,
    );
    list.innerHTML =
      (mixer.presetDirty
        ? '<p class="mv-mixer-preset-group">현재 선택</p><button type="button" role="option" aria-selected="true" disabled>사용자 조정</button>'
        : "") +
      `<p class="mv-mixer-preset-group">기본 프리셋</p>${options("builtin")}` +
      (custom
        ? `<p class="mv-mixer-preset-group">커스텀 프리셋</p>${custom}`
        : "");
    document.body.appendChild(list);
    document
      .querySelector(`[data-mv-mixer-preset-toggle="${CSS.escape(channelId)}"]`)
      ?.setAttribute("aria-expanded", "true");
    positionMixerPresetPicker();
  }

  function renderVolume() {
    const button = $("mvVolumeBtn");
    syncVolumePanelButton();
    // 자동재생이 막혔으면 버튼에 표시를 남긴다(색만이 아니라 글자로도 알린다).
    const blocked = audioBlocked.size > 0;
    button?.classList.toggle("is-warn", blocked);

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
          `<span class="mv-vol-name-text mv-custom-tooltip" data-tooltip="${esc(c.channelName)}">` +
          `${esc(c.channelName)}</span>` +
          (isMain ? `<span class="mv-main-badge">메인</span>` : "") +
          `</span>` +
          `<button type="button" class="mv-vol-mute mv-custom-tooltip" data-mv-vol-mute="${id}"` +
          ` aria-pressed="${muted}"` +
          ` aria-label="${esc(c.channelName)} ${muted ? "음소거 해제" : "음소거"}"` +
          ` data-tooltip="${muted ? "음소거 해제" : "음소거"}"` +
          `${forcedOff ? " disabled" : ""}>` +
          `${volumeIcon(volumeIconKind(c.channelId))}</button>` +
          `<input type="range" class="mv-vol-range" min="0" max="100" step="1"` +
          ` value="${Math.round(audio.volume * 100)}"` +
          ` data-mv-vol-channel="${id}"` +
          ` aria-label="${esc(c.channelName)} 볼륨"` +
          `${forcedOff ? " disabled" : ""}>` +
          `<span class="mv-vol-pct">${pct(audio.volume)}</span>` +
          (hasMixerControls(c.channelId)
            ? `<button type="button" class="mv-vol-mixer-toggle mv-custom-tooltip"` +
              ` data-mv-mixer-toggle="${id}"` +
              ` aria-expanded="${mixerOpen.has(c.channelId)}"` +
              ` aria-label="${esc(c.channelName)} 오디오 믹서 설정"` +
              ` data-tooltip="오디오 믹서 설정">` +
              `<svg viewBox="0 0 24 24" width="14" height="14" fill="none"` +
              ` stroke="currentColor" stroke-width="2.4" stroke-linecap="round"` +
              ` stroke-linejoin="round" aria-hidden="true">` +
              `<path d="m6 9 6 6 6-6"></path></svg></button>`
            : "") +
          `</div>` +
          mixerControlsMarkup(c.channelId) +
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
      `<button type="button" class="mv-vol-mute mv-custom-tooltip" data-mv-vol-master-mute` +
      ` aria-pressed="${state.masterMuted}"` +
      ` aria-label="전체 볼륨 ${state.masterMuted ? "음소거 해제" : "음소거"}"` +
      ` data-tooltip="${state.masterMuted ? "전체 음소거 해제" : "전체 음소거"}">` +
      `${volumeIcon(state.masterMuted ? "x" : "high")}</button>` +
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
  const freshSyncChannels = new Set();

  // ── 칸별 라이브 따라잡기 ─────────────────────────────────────────────────
  // 지연이 상한(설정 2~8초, 기본 CATCH_UP.limitSec)을 넘은 라이브 칸을 라이브 쪽으로 옮긴다.
  // ⚠ 여러 칸을 소프트웨어로 디코딩하면 버퍼는 쌓이는데 재생 위치가 초당
  //   0.06~0.09초씩 밀린다(엣지 지연 ≈ 0). 배속은 디코딩 부하를 더 키워 쓰지 않는다.
  // ⚠ 자동 싱크로 묶인 칸은 함께 옮긴다. 한 칸만 옮기면 싱크가 가장 느린 칸에
  //   맞추려고 그 칸을 다시 과거로 되돌린다.
  const LIVE_CATCH_UP_KEY = "cheeseMultiviewLiveCatchUp";
  const LIVE_CATCH_UP_LIMIT_KEY = "cheeseMultiviewLiveCatchUpLimit";
  const MAIN_BORDER_KEY = "cheeseMultiviewMainBorder";
  let liveCatchUpEnabled = true;
  let liveCatchUpLimitSec = SYNC.CATCH_UP.limitSec;
  const catchUpOverSince = new Map(); // channelId → 상한을 처음 넘은 시각
  const catchUpLastAt = new Map(); // channelId → 마지막 따라잡기 명령 시각
  // 사용자가 되감은 칸. 지연이 상한 아래로 돌아오거나 영상이 바뀔 때까지 두고 본다.
  const catchUpHeld = new Set();
  // 탭 복귀 뒤 첫 판단. 가려진 동안 밀린 지연은 확인 시간·쿨다운 없이 바로 옮긴다.
  const catchUpUrgent = new Set();
  const catchUpQuietUntil = new Map(); // 우리가 옮긴 직후라 되감기 판정에서 뺄 시각

  function applyLiveCatchUpSetting(enabled) {
    liveCatchUpEnabled = enabled;
    if (!enabled) resetLiveCatchUp();
    updateSyncPolling();
    renderStats();
  }

  // 상한이 바뀌면 이전 상한으로 센 확인 시간은 버린다(되감기 보류·쿨다운은 그대로).
  function applyLiveCatchUpLimit(value) {
    const next = SYNC.catchUpLimit(value);
    if (next === liveCatchUpLimitSec) return;
    liveCatchUpLimitSec = next;
    catchUpOverSince.clear();
    renderStats();
  }

  void chrome.storage?.local
    ?.get([LIVE_CATCH_UP_KEY, LIVE_CATCH_UP_LIMIT_KEY])
    ?.then((data) => {
      applyLiveCatchUpLimit(data[LIVE_CATCH_UP_LIMIT_KEY]);
      applyLiveCatchUpSetting(data[LIVE_CATCH_UP_KEY] !== false);
    })
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[LIVE_CATCH_UP_LIMIT_KEY])
      applyLiveCatchUpLimit(changes[LIVE_CATCH_UP_LIMIT_KEY].newValue);
    if (changes[LIVE_CATCH_UP_KEY])
      applyLiveCatchUpSetting(changes[LIVE_CATCH_UP_KEY].newValue !== false);
  });

  function applyMainBorderSetting(enabled) {
    document.body.classList.toggle("mv-main-border-hidden", !enabled);
  }

  void chrome.storage?.local
    ?.get(MAIN_BORDER_KEY)
    ?.then((data) => applyMainBorderSetting(data[MAIN_BORDER_KEY] !== false))
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes[MAIN_BORDER_KEY]) return;
    applyMainBorderSetting(changes[MAIN_BORDER_KEY].newValue !== false);
  });

  function resetLiveCatchUp(channelId = null) {
    if (channelId === null) {
      catchUpOverSince.clear();
      catchUpLastAt.clear();
      catchUpHeld.clear();
      catchUpUrgent.clear();
      catchUpQuietUntil.clear();
      return;
    }
    catchUpOverSince.delete(channelId);
    catchUpLastAt.delete(channelId);
    catchUpHeld.delete(channelId);
    catchUpUrgent.delete(channelId);
    catchUpQuietUntil.delete(channelId);
  }

  function liveCatchUpWanted() {
    return (
      liveCatchUpEnabled &&
      state.chosen.some(
        (c) => c.mediaType !== "video" && currentStatus(c.channelId) === "ready",
      )
    );
  }

  // 새 샘플마다 되감기를 살핀다. 사용자가 타임머신으로 과거를 보는 칸은 끌어오지 않는다.
  function observeCatchUpSample(channelId, previous, stats) {
    if (!liveCatchUpEnabled) return;
    if (previous && previous.generation !== stats.generation) {
      catchUpHeld.delete(channelId);
      catchUpOverSince.delete(channelId);
    }
    const quietUntil = Math.max(
      catchUpQuietUntil.get(channelId) || 0,
      syncSeekAt.has(channelId)
        ? syncSeekAt.get(channelId) + SYNC.CATCH_UP.ownSeekQuietMs
        : 0,
    );
    // 우리가 보낸 싱크 seek/nudge 는 사용자의 되감기가 아니다. ACK 전후
    // 어느 시점에 측정값이 와도 보류하지 않는다.
    if (!pendingSync(channelId, "seek") && !pendingSync(channelId, "nudge") &&
        SYNC.isRewind(previous, stats, quietUntil)) {
      if (catchUpHeld.has(channelId)) return;
      catchUpHeld.add(channelId);
      catchUpOverSince.delete(channelId);
      recordSyncDiagnostic(
        "catch-up-hold",
        {
          channelId,
          channelName: syncChannelName(channelId),
          fromDelaySec: previous.nativeDelaySec,
          toDelaySec: stats.nativeDelaySec,
        },
        stats.receivedAt,
      );
      return;
    }
    if (
      catchUpHeld.has(channelId) &&
      stats.nativeDelaySec !== null &&
      stats.nativeDelaySec < liveCatchUpLimitSec
    ) {
      catchUpHeld.delete(channelId);
      recordSyncDiagnostic(
        "catch-up-release",
        {
          channelId,
          channelName: syncChannelName(channelId),
          delaySec: stats.nativeDelaySec,
        },
        stats.receivedAt,
      );
    }
  }

  // 함께 옮길 칸 묶음. 자동 싱크 중인 범위(또는 그룹)는 한 묶음, 나머지는 한 칸씩.
  function catchUpClusters() {
    const live = state.chosen
      .filter((c) => c.mediaType !== "video")
      .map((c) => c.channelId);
    const synced =
      state.sync.scope === "groups"
        ? state.sync.groups
            .filter((group) => group.mode === "auto")
            .map((group) => group.channelIds)
        : state.sync.mode === "auto"
          ? [syncScopeIds()]
          : [];
    const clusters = [];
    const taken = new Set();
    for (const ids of synced) {
      const members = ids.filter((id) => live.includes(id) && !taken.has(id));
      members.forEach((id) => taken.add(id));
      if (members.length) clusters.push(members);
    }
    for (const id of live) if (!taken.has(id)) clusters.push([id]);
    return clusters;
  }

  function catchUpCandidate(id, now) {
    const st = syncStats.get(id);
    return (
      currentStatus(id) === "ready" &&
      !catchUpHeld.has(id) &&
      SYNC.eligible(st, syncReadyAt.get(id), now, true) &&
      // 플레이어 재초기화 중에는 버퍼 없이 지연만 크게 나온다(실측 31초). 옮기지 않는다.
      st.bufferAheadSec !== null &&
      !st.userRateOverride &&
      !pendingSync(id, "catch-up")
    );
  }

  function tickLiveCatchUp(now) {
    if (!liveCatchUpEnabled) return;
    const { confirmMs, cooldownMs, ownSeekQuietMs } = SYNC.CATCH_UP;
    const limitSec = liveCatchUpLimitSec;
    for (const cluster of catchUpClusters()) {
      // 자동 싱크는 되감은 칸도 기준으로 삼는다. 나머지만 앞으로 보내면
      // 싱크가 다시 그 칸에 맞춰 뒤로 당기므로 묶음 전체를 보류한다.
      if (cluster.length > 1 && cluster.some((id) => catchUpHeld.has(id))) {
        for (const id of cluster) catchUpOverSince.delete(id);
        continue;
      }
      const members = cluster.filter((id) => catchUpCandidate(id, now));
      let due = false;
      for (const id of cluster) {
        const delay = members.includes(id)
          ? syncStats.get(id).nativeDelaySec
          : null;
        if (delay === null || delay < limitSec) {
          catchUpOverSince.delete(id);
          continue;
        }
        if (!catchUpOverSince.has(id)) catchUpOverSince.set(id, now);
        const urgent = catchUpUrgent.has(id);
        const confirmed = now - catchUpOverSince.get(id) >= confirmMs;
        const cooled =
          !catchUpLastAt.has(id) || now - catchUpLastAt.get(id) >= cooldownMs;
        if (urgent || (confirmed && cooled)) due = true;
      }
      // 탭 복귀 특례는 측정이 된 첫 판단에서 한 번만 쓴다.
      for (const id of members) catchUpUrgent.delete(id);
      if (!due) continue;
      const targets = SYNC.catchUpTargets(
        members.map((id) => ({ id, delaySec: syncStats.get(id).nativeDelaySec })),
        limitSec,
      );
      for (const { id, targetDelaySec } of targets) {
        const delaySec = syncStats.get(id).nativeDelaySec;
        if (
          sendSyncCommand(
            id,
            "catch-up",
            "APPLY_LIVE_CATCH_UP",
            { targetDelaySec },
            { targetDelaySec, delaySec },
          )
        ) {
          catchUpLastAt.set(id, now);
          catchUpOverSince.delete(id);
          catchUpQuietUntil.set(id, now + ownSeekQuietMs);
        }
      }
    }
  }

  // 싱크가 맞출 기준 지연을 채널 전체에 한 번에 정한다(모두 실제 지연이 있을 때만 그것).
  // ⚠ 싱크 계산(자동·수동·그룹) 직전마다 부른다. 측정값은 매초 새 객체로 바뀐다.
  function applySyncAlignDelays(now = Date.now()) {
    return SYNC.alignDelays(
      syncEligibleIds(now).map((id) => syncStats.get(id)),
    );
  }

  function syncGroupForChannel(channelId) {
    return (
      state.sync.groups.find((group) => group.channelIds.includes(channelId)) ||
      null
    );
  }

  function ensureSyncGroups() {
    if (state.sync.groups.length) return;
    state.sync.groups = ["a", "b"].map((id) => ({
      id,
      channelIds:
        id === "a" && state.sync.selectionInitialized
          ? state.sync.selectedChannelIds.filter((channelId) =>
              cells.has(channelId),
            )
          : [],
      mode: "off",
      referenceChannelId: null,
      manualOffsets: {},
      congested: false,
      congestionState: { active: false, since: 0 },
    }));
  }

  function releaseGroupChannel(group, channelId) {
    group.channelIds = group.channelIds.filter((id) => id !== channelId);
    delete group.manualOffsets[channelId];
    if (group.referenceChannelId === channelId) group.referenceChannelId = null;
    if (group.channelIds.length < 2) {
      group.mode = "off";
      group.channelIds.forEach(resetSyncRate);
    }
    resetSyncRate(channelId);
    cancelPendingSync(channelId);
  }

  function clearSyncGroup(group) {
    const channelIds = [...group.channelIds];
    group.channelIds = [];
    group.mode = "off";
    group.referenceChannelId = null;
    group.manualOffsets = {};
    group.congested = false;
    group.congestionState = { active: false, since: 0 };
    for (const id of channelIds) {
      cancelPendingSync(id);
      resetSyncRate(id);
    }
  }

  function assignSyncGroup(channelId, groupId) {
    if (!cells.has(channelId)) return;
    const next = state.sync.groups.find((group) => group.id === groupId);
    const current = syncGroupForChannel(channelId);
    if (current === next) return;
    if (current) releaseGroupChannel(current, channelId);
    if (next) {
      next.channelIds.push(channelId);
      next.manualOffsets[channelId] = 0;
    }
    renderSync(true);
    updateSyncPolling();
  }

  function rebaseGroupOffsets(group, nextReference) {
    const next = SYNC.rebaseOffsets(
      group.manualOffsets,
      nextReference,
      group.channelIds,
    );
    for (const id of group.channelIds) {
      if (freshSyncChannels.has(id)) next[id] = 0;
    }
    group.manualOffsets = next;
    group.referenceChannelId = nextReference;
  }
  const syncDiagnostics = DIAGNOSTICS.createRecorder();
  const playerCatchUpHold = new Map(); // channelId -> 마지막으로 보낸 자체 따라잡기 멈춤
  let syncCommandSeq = 0;
  let syncCongestion = { active: false, since: 0 };
  let syncTimer = 0;
  let syncNotice = "";
  let syncDiagnosticsStartedAt = 0;
  // 기록 상태: idle(시작 전) · recording · paused · stopped.
  // ⚠ 예전에는 체크박스로 끄고 켜기만 해, 다시 켜도 처음 시작 시각부터 시간이
  //   이어서 흘렀다. 멈춘 동안(일시정지·정지)은 측정 시간에 넣지 않는다.
  let syncDiagnosticsPhase = "idle";
  let syncDiagnosticsHaltedAt = 0;
  let syncDiagnosticsPausedMs = 0;
  let syncDiagnosticsNotice = "";
  let syncDiagnosticsUi = false;
  void chrome.storage?.local
    ?.get("cheeseMultiviewSyncDiagnosticsUi")
    ?.then((data) => {
      syncDiagnosticsUi = data.cheeseMultiviewSyncDiagnosticsUi === true;
      refreshSyncPanel();
    })
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes.cheeseMultiviewSyncDiagnosticsUi) return;
    syncDiagnosticsUi =
      changes.cheeseMultiviewSyncDiagnosticsUi.newValue === true;
    if (!syncDiagnosticsUi) stopSyncDiagnostics();
    refreshSyncPanel();
  });

  function syncChannelName(channelId) {
    return (
      state.chosen.find((channel) => channel.channelId === channelId)
        ?.channelName || ""
    );
  }

  function recordSyncDiagnostic(type, fields = {}, timestamp) {
    if (!state.sync.diagnosticsEnabled) return false;
    const at = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (!syncDiagnosticsStartedAt) syncDiagnosticsStartedAt = at;
    return syncDiagnostics.add({
      type,
      timestamp: at,
      elapsedMs: Math.max(0, at - syncDiagnosticsStartedAt - syncDiagnosticsPausedMs),
      ...fields,
    });
  }

  function diagnosticDesiredValue(value) {
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return value;
    if (!value || typeof value !== "object") return null;
    const safe = {};
    for (const key of [
      "currentTime",
      "manual",
      "offset",
      "commitOffset",
      "targetDelaySec",
      "delaySec",
    ]) {
      if (typeof value[key] === "boolean" || Number.isFinite(value[key]))
        safe[key] = value[key];
    }
    return safe;
  }

  function recordSyncSample(channelId, stats, timestamp) {
    if (!state.sync.diagnosticsEnabled) return;
    const group =
      state.sync.scope === "groups" ? syncGroupForChannel(channelId) : null;
    const context = state.sync.scope === "groups" ? group : state.sync;
    const referenceChannelId = context?.referenceChannelId || null;
    const referenceStats =
      referenceChannelId === channelId
        ? stats
        : syncStats.get(referenceChannelId);
    const manualOffset = context?.manualOffsets[channelId] || 0;
    const targetDelaySec = SYNC.targetDelay(referenceStats, manualOffset);
    const syncErrorSec =
      targetDelaySec !== null && SYNC.alignDelay(stats) !== null
        ? targetDelaySec - SYNC.alignDelay(stats)
        : null;
    const readyAt = syncReadyAt.get(channelId);
    recordSyncDiagnostic(
      "sample",
      {
        channelId,
        channelName: syncChannelName(channelId),
        generation: stats.generation,
        frameStatus: currentStatus(channelId),
        syncMode: context?.mode || "off",
        // 범위 정보는 추가 필드로만 남긴다(기존 소비자 형식은 그대로).
        syncScope: state.sync.scope,
        groupId: group?.id || null,
        inSyncScope: group ? true : inSyncScope(channelId),
        referenceChannelId,
        nativeDelaySec: stats.nativeDelaySec,
        // 실제 송출 시각 기준 지연과, 싱크가 맞출 때 쓴 지연(둘 중 하나).
        absoluteDelaySec: stats.absoluteDelaySec ?? null,
        alignDelaySec: SYNC.alignDelay(stats),
        bufferAheadSec: stats.bufferAheadSec,
        edgeLagSec: stats.edgeLagSec,
        playbackRate: stats.playbackRate,
        syncRateOwned: stats.syncRateOwned,
        userRateOverride: stats.userRateOverride,
        audioProtected: isSyncAudioProtected(channelId),
        manualOffset,
        targetDelaySec,
        syncErrorSec,
        settling:
          Number.isFinite(readyAt) &&
          timestamp - readyAt < SYNC.LIMITS.settlingMs,
        congested: context?.congested || false,
      },
      timestamp,
    );
  }

  function recordReferenceChange(
    fromChannelId,
    toChannelId,
    cause,
    timestamp = Date.now(),
    groupId = null,
  ) {
    if (!state.sync.diagnosticsEnabled || fromChannelId === toChannelId) return;
    recordSyncDiagnostic(
      "reference-change",
      {
        fromChannelId: fromChannelId || null,
        toChannelId: toChannelId || null,
        groupId,
        cause,
        fromDelaySec: syncStats.get(fromChannelId)?.nativeDelaySec ?? null,
        toDelaySec: syncStats.get(toChannelId)?.nativeDelaySec ?? null,
      },
      timestamp,
    );
  }

  function recordCongestionChange(active, ids, timestamp, groupId = null) {
    if (!state.sync.diagnosticsEnabled) return;
    const edgeLagByChannel = {};
    const affectedChannels = [];
    for (const id of ids) {
      const edgeLag = syncStats.get(id)?.edgeLagSec;
      edgeLagByChannel[id] = Number.isFinite(edgeLag) ? edgeLag : null;
      if (
        Number.isFinite(edgeLag) &&
        edgeLag >= SYNC.LIMITS.congestionEdgeSec
      ) {
        affectedChannels.push(id);
      }
    }
    recordSyncDiagnostic(
      "congestion-change",
      {
        active,
        groupId,
        affectedChannels,
        edgeLagByChannel,
      },
      timestamp,
    );
  }

  // 실제로 기록한 시간(멈춘 동안은 빼고, 멈춘 뒤로는 흐르지 않는다).
  function syncDiagnosticsElapsed(now = Date.now()) {
    if (!syncDiagnosticsStartedAt) return 0;
    const end = syncDiagnosticsHaltedAt || now;
    return Math.max(0, end - syncDiagnosticsStartedAt - syncDiagnosticsPausedMs);
  }

  function syncDiagnosticsStatusText(now = Date.now()) {
    const count = syncDiagnostics.size.toLocaleString();
    const elapsed = DIAGNOSTICS.formatDuration(syncDiagnosticsElapsed(now));
    if (syncDiagnosticsPhase === "recording") return `기록 중 · ${elapsed} · ${count}개 기록`;
    if (syncDiagnosticsPhase === "paused") return `일시정지 · ${elapsed} · ${count}개 기록`;
    if (syncDiagnosticsPhase === "stopped") return `정지됨 · ${elapsed} · ${count}개 보관`;
    return syncDiagnostics.size ? `기록 안 함 · ${count}개 보관` : "기록 안 함";
  }

  function diagnosticsPayload(exportedAt = Date.now()) {
    const startedAt = syncDiagnosticsStartedAt || exportedAt;
    return DIAGNOSTICS.createExport({
      records: syncDiagnostics.toArray(),
      startedAt,
      exportedAt,
      durationMs: syncDiagnosticsElapsed(exportedAt),
      channelCount: state.chosen.length,
      limits: SYNC.LIMITS,
    });
  }

  async function copySyncDiagnosticsSummary() {
    if (!syncDiagnostics.size) return;
    const text = DIAGNOSTICS.formatSummary(diagnosticsPayload().summary);
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(text);
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
    refreshSyncPanel();
  }

  function diagnosticsFilename(timestamp) {
    const date = new Date(timestamp);
    const part = (value) => String(value).padStart(2, "0");
    return (
      `chzzk-multiview-sync-diagnostics-${date.getFullYear()}` +
      `${part(date.getMonth() + 1)}${part(date.getDate())}-` +
      `${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}.json`
    );
  }

  function exportSyncDiagnostics() {
    if (!syncDiagnostics.size) return;
    const exportedAt = Date.now();
    const blob = new Blob(
      [JSON.stringify(diagnosticsPayload(exportedAt), null, 2)],
      {
        type: "application/json",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = diagnosticsFilename(exportedAt);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    syncDiagnosticsNotice = "진단 JSON을 저장했습니다.";
    refreshSyncPanel();
  }

  function resetSyncDiagnosticsClock(now = 0) {
    syncDiagnosticsStartedAt = now;
    syncDiagnosticsHaltedAt = 0;
    syncDiagnosticsPausedMs = 0;
  }

  function setSyncDiagnosticsPhase(phase) {
    syncDiagnosticsPhase = phase;
    state.sync.diagnosticsEnabled = phase === "recording";
    updateSyncPolling();
    refreshSyncPanel();
  }

  function clearSyncDiagnostics() {
    syncDiagnostics.clear();
    // 기록 중이면 새로 잰다. 멈춰 있으면 시작 전 상태로 돌린다.
    if (syncDiagnosticsPhase === "recording") resetSyncDiagnosticsClock(Date.now());
    else {
      resetSyncDiagnosticsClock();
      syncDiagnosticsPhase = "idle";
    }
    syncDiagnosticsNotice = "진단 기록을 초기화했습니다.";
    refreshSyncPanel();
  }

  // 시작: 일시정지였으면 이어서, 정지·시작 전이면 새 기록으로 시작한다.
  function startSyncDiagnostics() {
    const now = Date.now();
    if (syncDiagnosticsPhase === "recording") return;
    if (syncDiagnosticsPhase === "paused") {
      syncDiagnosticsPausedMs += Math.max(0, now - syncDiagnosticsHaltedAt);
      syncDiagnosticsHaltedAt = 0;
    } else {
      syncDiagnostics.clear();
      resetSyncDiagnosticsClock(now);
    }
    syncDiagnosticsNotice = "";
    setSyncDiagnosticsPhase("recording");
  }

  function pauseSyncDiagnostics() {
    if (syncDiagnosticsPhase !== "recording") return;
    syncDiagnosticsHaltedAt = Date.now();
    syncDiagnosticsNotice = "";
    setSyncDiagnosticsPhase("paused");
  }

  // 정지: 기록은 남겨 두고(복사·내보내기용) 시간은 멈춘다.
  function stopSyncDiagnostics() {
    if (syncDiagnosticsPhase !== "recording" && syncDiagnosticsPhase !== "paused") return;
    if (syncDiagnosticsPhase === "recording") syncDiagnosticsHaltedAt = Date.now();
    syncDiagnosticsNotice = "";
    setSyncDiagnosticsPhase("stopped");
  }

  // 진단 기록 조작 버튼(lucide play / pause / square).
  const SYNC_DIAGNOSTICS_ICONS = {
    Start: '<polygon points="6 3 20 12 6 21 6 3"/>',
    Pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    Stop: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  };

  function syncDiagnosticsControlState(action) {
    const phase = syncDiagnosticsPhase;
    if (action === "Start") {
      return {
        disabled: phase === "recording",
        label: phase === "paused"
          ? "기록 이어서 하기"
          : phase === "stopped" && syncDiagnostics.size
            ? "새로 기록 시작(이전 기록은 지워집니다)"
            : "기록 시작",
      };
    }
    if (action === "Pause") return { disabled: phase !== "recording", label: "기록 일시정지" };
    return { disabled: phase !== "recording" && phase !== "paused", label: "기록 정지" };
  }

  function syncDiagnosticsControlsHtml() {
    return (
      `<div class="mv-sync-diagnostics-controls" role="group" aria-label="진단 기록">` +
      ["Start", "Pause", "Stop"].map((action) => {
        const view = syncDiagnosticsControlState(action);
        return (
          `<button type="button" id="mvSyncDiagnostics${action}" class="mv-custom-tooltip" ` +
          `data-tooltip="${esc(view.label)}" aria-label="${esc(view.label)}"` +
          `${view.disabled ? " disabled" : ""}>` +
          `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
          `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `${SYNC_DIAGNOSTICS_ICONS[action]}</svg></button>`
        );
      }).join("") +
      `</div>`
    );
  }

  // 전체 렌더 없이 진단 영역의 글자·버튼 상태만 맞춘다.
  function patchSyncDiagnostics(diagnostics, now = Date.now()) {
    const setText = (el, value) => {
      if (el && el.textContent !== value) el.textContent = value;
    };
    diagnostics.hidden = !syncDiagnosticsUi;
    setText(diagnostics.querySelector(".mv-sync-diagnostics-status"), syncDiagnosticsStatusText(now));
    diagnostics.dataset.phase = syncDiagnosticsPhase;
    for (const action of ["Start", "Pause", "Stop"]) {
      const button = diagnostics.querySelector(`#mvSyncDiagnostics${action}`);
      if (!button) continue;
      const view = syncDiagnosticsControlState(action);
      if (button.disabled !== view.disabled) button.disabled = view.disabled;
      if (button.dataset.tooltip !== view.label) {
        button.dataset.tooltip = view.label;
        button.setAttribute("aria-label", view.label);
      }
    }
    for (const action of ["Copy", "Export", "Clear"]) {
      const button = diagnostics.querySelector(`#mvSyncDiagnostics${action}`);
      const disabled = syncDiagnostics.size === 0;
      if (button && button.disabled !== disabled) button.disabled = disabled;
    }
    const notice = diagnostics.querySelector(".mv-sync-diagnostics-notice");
    if (!notice) return false;
    setText(notice, syncDiagnosticsNotice);
    const hidden = !syncDiagnosticsNotice;
    if (notice.hidden !== hidden) notice.hidden = hidden;
    return true;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (event.button != null && event.button !== 0) return;
      const target = event.target;
      const quickPanel = $("mvQuick");
      if (
        quickPanel &&
        !quickPanel.hidden &&
        !target.closest?.("#mvQuick, #mvBack, .mv-sort-options")
      )
        closeQuick();
    },
    true,
  );
  window.addEventListener("blur", () => {
    const quickPanel = $("mvQuick");
    if (
      quickPanel &&
      !quickPanel.hidden &&
      document.activeElement?.tagName === "IFRAME"
    ) {
      closeQuick();
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      const path = event.composedPath?.() || [];
      if (!path.some((node) => node?.id === "mvSyncPop")) return;
      const control = path.find(
        (node) =>
          typeof node?.id === "string" &&
          node.id.startsWith("mvSyncDiagnostics"),
      );
      if (!control) return;
      if (control.disabled) return;
      const phaseAction = {
        mvSyncDiagnosticsStart: startSyncDiagnostics,
        mvSyncDiagnosticsPause: pauseSyncDiagnostics,
        mvSyncDiagnosticsStop: stopSyncDiagnostics,
      }[control.id];
      if (phaseAction) {
        queueMicrotask(phaseAction);
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
    },
    true,
  );

  function sendSync(channelId, type, extra = {}) {
    if (isVideoSlot(channelId)) return false;
    if (currentStatus(channelId) !== "ready") return false;
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return false;
    try {
      frame.contentWindow.postMessage(
        { source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD, type, channelId, ...extra },
        CHZZK_ORIGIN,
      );
      return true;
    } catch {
      return false;
    }
  }

  function pendingSync(channelId, command) {
    return [...pendingSyncCommands.values()].find(
      (entry) => entry.channelId === channelId && entry.command === command,
    );
  }

  function cancelPendingSync(channelId) {
    for (const [id, entry] of pendingSyncCommands) {
      if (entry.channelId !== channelId) continue;
      clearTimeout(entry.timeout);
      pendingSyncCommands.delete(id);
    }
  }

  function sendSyncCommand(
    channelId,
    command,
    type,
    extra = {},
    desiredValue = null,
  ) {
    if (
      pendingSync(channelId, command) ||
      Date.now() < (syncRetryAt.get(`${channelId}:${command}`) || 0)
    )
      return false;
    const commandId = ++syncCommandSeq;
    const entry = {
      commandId,
      channelId,
      command,
      sentAt: Date.now(),
      desiredValue,
      generation: syncGeneration.get(channelId) ?? null,
      timeout: 0,
      groupId:
        state.sync.scope === "groups"
          ? syncGroupForChannel(channelId)?.id || null
          : null,
    };
    if (!sendSync(channelId, type, { ...extra, commandId })) return false;
    const context = entry.groupId
      ? state.sync.groups.find((group) => group.id === entry.groupId)
      : state.sync;
    recordSyncDiagnostic(
      "command",
      {
        channelId,
        channelName: syncChannelName(channelId),
        commandId,
        command,
        desiredValue: diagnosticDesiredValue(desiredValue),
        generation: entry.generation,
        groupId: entry.groupId,
        referenceChannelId: context?.referenceChannelId || null,
        manualOffset: context?.manualOffsets[channelId] || 0,
      },
      entry.sentAt,
    );
    entry.timeout = window.setTimeout(() => {
      if (pendingSyncCommands.get(commandId) !== entry) return;
      pendingSyncCommands.delete(commandId);
      const timedOutAt = Date.now();
      syncRetryAt.set(
        `${channelId}:${command}`,
        timedOutAt + SYNC.LIMITS.commandRetryMs,
      );
      recordSyncDiagnostic(
        "command-timeout",
        {
          channelId,
          channelName: syncChannelName(channelId),
          commandId,
          command,
          generation: entry.generation,
          waitedMs: Math.max(0, timedOutAt - entry.sentAt),
        },
        timedOutAt,
      );
      if (command === "nudge" || (command === "seek" && extra.manual)) {
        syncNotice = "보정 응답이 없어 적용하지 못했습니다.";
        // ⚠ 방금 누른 버튼에 포커스가 남아 있으면 renderSync 는 건너뛴다.
        //   그러면 '적용 중' 이 풀리지 않는다. 응답 경로와 같이 제자리 갱신한다.
        refreshSyncPanel();
      }
    }, SYNC.LIMITS.commandTimeoutMs);
    pendingSyncCommands.set(commandId, entry);
    return true;
  }

  function finishSyncCommand(channelId, data) {
    if (
      !Number.isSafeInteger(data.commandId) ||
      data.commandId <= 0 ||
      !["seek", "nudge", "rate", "reset-rate", "catch-up"].includes(
        data.command,
      ) ||
      typeof data.applied !== "boolean" ||
      !(
        data.reason === null ||
        (typeof data.reason === "string" &&
          [
            "no-video",
            "paused",
            "not-ready",
            "seeking",
            "ad",
            "range",
            "cooldown",
            "user-rate",
            "too-far",
            "invalid-state",
            "exception",
          ].includes(data.reason))
      ) ||
      !Number.isInteger(data.generation) ||
      data.generation < 0 ||
      data.generation > 1000000 ||
      (data.actualCurrentTime !== null &&
        (!Number.isFinite(data.actualCurrentTime) ||
          data.actualCurrentTime < 0)) ||
      (data.actualPlaybackRate !== null &&
        (!Number.isFinite(data.actualPlaybackRate) ||
          data.actualPlaybackRate < 0.5 ||
          data.actualPlaybackRate > 2))
    )
      return;
    const entry = pendingSyncCommands.get(data.commandId);
    if (
      !entry ||
      entry.channelId !== channelId ||
      entry.command !== data.command ||
      entry.generation !== data.generation
    )
      return;
    const group =
      entry.groupId &&
      state.sync.groups.find((item) => item.id === entry.groupId);
    if (entry.groupId && (!group || !group.channelIds.includes(channelId)))
      return;
    const context = group || state.sync;
    if (
      data.applied &&
      entry.command === "rate" &&
      (!Number.isFinite(data.actualPlaybackRate) ||
        Math.abs(data.actualPlaybackRate - entry.desiredValue) >
          SYNC.LIMITS.userRateEpsilon)
    )
      return;
    const receivedAt = Date.now();
    recordSyncDiagnostic(
      "command-result",
      {
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
      },
      receivedAt,
    );
    clearTimeout(entry.timeout);
    pendingSyncCommands.delete(data.commandId);
    const retryKey = `${channelId}:${entry.command}`;
    if (!data.applied) {
      syncRetryAt.set(retryKey, Date.now() + SYNC.LIMITS.commandRetryMs);
      if (
        entry.command === "nudge" ||
        (entry.command === "seek" && entry.desiredValue?.manual)
      ) {
        syncNotice = `보정을 적용하지 못했습니다 (${data.reason || "상태 확인 필요"}).`;
      }
    } else {
      syncRetryAt.delete(retryKey);
      // 따라잡기도 seek 이다. 자동 싱크가 곧바로 과거로 되돌리지 않게 같은 쿨다운을 건다.
      if (
        entry.command === "seek" ||
        entry.command === "nudge" ||
        entry.command === "catch-up"
      )
        syncSeekAt.set(channelId, Date.now());
      if (entry.command === "nudge") {
        context.manualOffsets[channelId] = entry.desiredValue.offset;
        freshSyncChannels.delete(channelId);
        syncNotice = "수동 보정을 적용했습니다.";
      }
      if (entry.command === "seek" && entry.desiredValue?.commitOffset) {
        context.manualOffsets[channelId] = entry.desiredValue.offset;
        freshSyncChannels.delete(channelId);
        syncNotice = "보정값을 초기화했습니다.";
      }
      if (entry.command === "rate") {
        syncRates.set(channelId, data.actualPlaybackRate);
        if (context.mode !== "auto") resetSyncRate(channelId);
      }
      if (entry.command === "reset-rate") {
        syncRates.delete(channelId);
        const stats = syncStats.get(channelId);
        if (stats)
          syncStats.set(channelId, {
            ...stats,
            playbackRate: data.actualPlaybackRate,
            syncRateOwned: false,
            userRateOverride: false,
          });
      }
    }
    updateSyncPolling();
    // ⚠ 응답/타임아웃으로 값이 바뀌었는데, 사용자가 패널 버튼에 포커스를 두고
    //   있으면 renderSync 의 가드가 전체 렌더를 건너뛴다. 그러면 '적용 중' 이
    //   그대로 남는다. 제자리 갱신은 그 가드를 타지 않으므로 먼저 시도한다.
    refreshSyncPanel();
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
    if (removeOffset) {
      state.sync.selectedChannelIds = state.sync.selectedChannelIds.filter(
        (id) => id !== channelId,
      );
      freshSyncChannels.delete(channelId);
      const group = syncGroupForChannel(channelId);
      if (group) releaseGroupChannel(group, channelId);
    }
    resetSyncRate(channelId);
    cancelPendingSync(channelId);
    syncStats.delete(channelId);
    syncReadyAt.delete(channelId);
    syncGeneration.delete(channelId);
    syncSeekAt.delete(channelId);
    for (const command of ["seek", "nudge", "rate", "reset-rate", "catch-up"])
      syncRetryAt.delete(`${channelId}:${command}`);
    syncRates.delete(channelId);
    resetLiveCatchUp(channelId);
    if (removeOffset) delete state.sync.manualOffsets[channelId];
    if (state.sync.referenceChannelId === channelId) {
      state.sync.referenceChannelId = null;
    }
  }

  function rebaseSyncOffsets(
    nextReference,
    ids = state.chosen.map((c) => c.channelId),
  ) {
    const next = SYNC.rebaseOffsets(
      state.sync.manualOffsets,
      nextReference,
      ids,
    );
    for (const id of ids) {
      if (freshSyncChannels.has(id)) next[id] = 0;
    }
    state.sync.manualOffsets = next;
  }

  // ── 싱크 범위 ────────────────────────────────────────────────────────────
  // 보정 대상(active sync group)을 한 곳에서만 정한다. 여러 함수가 각자
  // scope 분기를 두면 '측정은 되는데 보정만 빠지는' 경로가 생기기 쉽다.
  // ⚠ 측정(stats 수집)은 범위와 무관하게 모든 ready 채널에서 계속한다.
  //   제외 채널도 패널에서 지연을 볼 수 있어야 한다.
  // 재생 속도 표시. 0.97× 는 '3% 느리게 재생 중' 이라는 뜻이지 위치를 옮긴
  // 양이 아니다. 배속이라는 것과 방향(느리게/빠르게)을 글자로 함께 보여 준다.
  // ⚠ 부동소수점 오차로 방향이 뒤집히지 않게 기존 userRateEpsilon 을 그대로 쓴다.
  function syncRateText(stats) {
    const rate = stats?.playbackRate;
    if (!Number.isFinite(rate)) return { text: "재생 속도 -", hint: "" };
    // ⚠ 방향은 '화면에 보이는 숫자' 로 정한다. userRateEpsilon(0.02)으로 판정하면
    //   자동 보정이 만드는 0.99×/1.01× 가 '기본' 으로 표시돼, 같은 줄의 '자동 보정
    //   중' 과 모순된다. 표시값과 판정값이 어긋나지 않게 같은 수에서 계산한다.
    //   (userRateEpsilon 은 rate 소유권 판정용으로 그대로 둔다.)
    const formatted = rate.toFixed(2);
    const shown = Number(formatted);
    const dir = shown < 1 ? "느리게" : shown > 1 ? "빠르게" : "기본";
    const text = `재생 속도 ${formatted}× · ${dir}`;
    // 자동 보정인지 사용자가 직접 바꾼 배속인지 구분해 설명한다.
    const owned =
      stats?.syncRateOwned === true && stats?.userRateOverride !== true;
    const hint =
      dir === "기본"
        ? "현재 영상을 기본 속도로 재생 중입니다."
        : owned
          ? `자동 싱크가 재생 속도를 ${dir} 조절하고 있습니다.`
          : `현재 영상을 ${dir} 재생 중입니다.`;
    return { text, hint };
  }

  function syncReadyLabel(mode, stats) {
    if (mode === "off") return "싱크 꺼짐";
    const userRate = stats.userRateOverride ||
      (SYNC.isUserRate(stats.playbackRate) && !stats.syncRateOwned);
    if (userRate)
      return mode === "auto" ? "사용자 배속 · 자동 제외" : "사용자 배속";
    if (mode === "auto")
      return stats.syncRateOwned ? "자동 보정 중" : "자동 감시 중";
    return "수동 조절 가능";
  }

  // 한 행의 표시 상태. 전체 렌더와 부분 갱신이 같은 계산을 쓰게 한 곳에 둔다.
  // ⚠ 두 곳에서 따로 계산하면 부분 갱신만 stale 해지는 경로가 생긴다.
  function getSyncRowViewState(channelId, now = Date.now()) {
    const ref = state.sync.referenceChannelId;
    const status = currentStatus(channelId);
    const st = syncStats.get(channelId);
    const fresh =
      status === "ready" && st && now - st.receivedAt <= SYNC.LIMITS.staleMs;
    const ready = fresh && SYNC.eligible(st, syncReadyAt.get(channelId), now);
    const settling =
      ready && now - syncReadyAt.get(channelId) < SYNC.LIMITS.settlingMs;
    const label =
      status === "ended"
        ? "종료"
        : status === "error" || status === "ui-error"
          ? "오류"
          : !fresh
            ? "측정 대기"
            : st.paused
              ? "일시정지"
              : st.readyState < 2
                ? "재생 준비 중"
                : !ready
                  ? "측정 불가"
                  : settling
                    ? "안정화 중"
                    : state.sync.mode === "off"
                      ? "싱크 꺼짐"
                    : state.sync.congested
                      ? "연결 지연"
                      : channelId === ref
                        ? "기준"
                        : syncReadyLabel(state.sync.mode, st);
    const picking = state.sync.scope === "selected";
    const picked = inSyncScope(channelId);
    const nudgePending = syncNudgePending(channelId);
    // 범위 밖 채널은 보정 대상이 아니다. 측정값은 그대로 보여 준다.
    const locked = picking && !picked;
    const controlsOff = state.sync.mode === "off";
    const isReference = channelId === ref;
    const offset = state.sync.manualOffsets[channelId] || 0;
    return {
      st,
      ref,
      ready,
      label,
      picking,
      picked,
      nudgePending,
      locked,
      isReference,
      offset,
      rateInfo: syncRateText(st),
      // 버튼 상태. 누른 결과로 막히는 경우(보류 중, 이미 기준, 초기화 뒤 0)는 disabled 대신
      // aria-disabled 로 둔다. 포커스된 버튼이 disabled 가 되면 브라우저가 다음
      // 프레임에 포커스를 body 로 옮긴다(실측). 그러면 키보드 위치가 사라지고,
      // renderSync 의 포커스 가드도 풀려 다음 tick 에 패널이 통째로 다시 그려진다.
      // 실제 동작은 핸들러가 같은 상태를 보고 막는다.
      refDisabled: locked || controlsOff || !ready,
      refBusy: isReference,
      offDisabled: locked || controlsOff || !ready || !ref || isReference,
      offBusy: nudgePending,
      clearDisabled: locked || controlsOff,
      clearBusy: nudgePending || !offset,
    };
  }

  function getGroupRowViewState(group, channelId, now = Date.now()) {
    const st = syncStats.get(channelId);
    const fresh =
      currentStatus(channelId) === "ready" &&
      st &&
      now - st.receivedAt <= SYNC.LIMITS.staleMs;
    const ready = fresh && SYNC.eligible(st, syncReadyAt.get(channelId), now);
    const offset = group.manualOffsets[channelId] || 0;
    const pending = syncNudgePending(channelId);
    return {
      st,
      offset,
      pending,
      ready,
      reference: group.referenceChannelId === channelId,
      status:
        currentStatus(channelId) === "ended"
          ? "종료"
          : currentStatus(channelId) === "error"
            ? "오류"
            : !fresh
              ? "측정 대기"
              : st.paused
                ? "일시정지"
                : !ready
                  ? "측정 불가"
                  : group.mode === "off"
                    ? "싱크 꺼짐"
                  : group.congested
                    ? "연결 지연"
                    : group.referenceChannelId === channelId
                      ? "기준"
                      : syncReadyLabel(group.mode, st),
      rate: syncRateText(st),
    };
  }

  function closeGroupAssignmentPicker() {
    const picker = $("mvGroupAssignmentList");
    picker?.remove();
    document
      .querySelectorAll("[data-mv-group-assignment-toggle]")
      .forEach((trigger) => {
        trigger.setAttribute("aria-expanded", "false");
      });
    groupAssignmentPickerId = "";
  }

  function positionGroupAssignmentPicker() {
    const picker = $("mvGroupAssignmentList");
    const trigger = document.querySelector(
      `[data-mv-group-assignment-toggle="${CSS.escape(groupAssignmentPickerId)}"]`,
    );
    if (!picker || !trigger || !groupAssignmentPickerId) {
      closeGroupAssignmentPicker();
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const padding = 8;
    const maxHeight = Math.min(
      240,
      Math.max(100, window.innerHeight - padding * 2),
    );
    picker.style.maxHeight = `${maxHeight}px`;
    picker.style.minWidth = `${Math.max(110, Math.round(rect.width))}px`;
    const height = Math.min(picker.scrollHeight, maxHeight);
    const below = window.innerHeight - rect.bottom - padding;
    const top =
      below >= height || below >= rect.top - padding
        ? rect.bottom + 4
        : Math.max(padding, rect.top - height - 4);
    const left = Math.max(
      padding,
      Math.min(rect.left, window.innerWidth - rect.width - padding),
    );
    picker.style.left = `${Math.round(left)}px`;
    picker.style.top = `${Math.round(top)}px`;
  }

  function toggleGroupAssignmentPicker(channelId) {
    if (groupAssignmentPickerId === channelId) {
      closeGroupAssignmentPicker();
      return;
    }
    closeGroupAssignmentPicker();
    closeMixerPresetPicker();
    closeChatSelector();
    closeQuick();
    groupAssignmentPickerId = channelId;
    const current = syncGroupForChannel(channelId)?.id || "";
    const options = [
      { id: "", label: "그룹 없음" },
      ...state.sync.groups.map((group) => ({
        id: group.id,
        label: `그룹 ${group.id.toUpperCase()}`,
      })),
    ];
    const picker = document.createElement("div");
    picker.id = "mvGroupAssignmentList";
    picker.className = "mv-pop-panel mv-group-assignment-list";
    picker.setAttribute("role", "listbox");
    picker.setAttribute("aria-label", `${channelName(channelId)} 싱크 그룹`);
    picker.innerHTML = options
      .map(
        (option) =>
          `<button type="button" role="option" class="mv-pop-option${option.id === current ? " is-on" : ""}" ` +
          `data-mv-group-assign-option="${esc(channelId)}" data-group-id="${esc(option.id)}" ` +
          `aria-selected="${option.id === current}">${esc(option.label)}</button>`,
      )
      .join("");
    picker.addEventListener("keydown", (event) => {
      const options = [...picker.querySelectorAll('[role="option"]')];
      if (event.key === "Escape") {
        closeGroupAssignmentPicker();
        document
          .querySelector(
            `[data-mv-group-assignment-toggle="${CSS.escape(channelId)}"]`,
          )
          ?.focus();
        event.preventDefault();
        return;
      }
      if (!options.length || !["ArrowDown", "ArrowUp"].includes(event.key))
        return;
      const index = options.indexOf(document.activeElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      options[(index + direction + options.length) % options.length]?.focus();
      event.preventDefault();
    });
    picker.hidden = false;
    document.body.appendChild(picker);
    document
      .querySelector(
        `[data-mv-group-assignment-toggle="${CSS.escape(channelId)}"]`,
      )
      ?.setAttribute("aria-expanded", "true");
    positionGroupAssignmentPicker();
    picker
      .querySelector(`[aria-selected="true"]`)
      ?.focus({ preventScroll: true });
  }

  function patchGroupPanel(now = Date.now()) {
    const panel = $("mvSyncPop");
    if (!panel || panel.hidden) return false;
    const setText = (element, value) => {
      if (element && element.textContent !== value) element.textContent = value;
    };
    const rows = [...panel.querySelectorAll("[data-mv-group-row]")];
    const expected = state.sync.groups.flatMap((group) => group.channelIds);
    if (
      rows.length !== expected.length ||
      rows.some((row, index) => row.dataset.mvGroupRow !== expected[index])
    )
      return false;
    setText($("mvSyncValue"), "그룹");
    for (const group of state.sync.groups) {
      const section = panel.querySelector(`[data-mv-group="${group.id}"]`);
      if (!section) return false;
      const auto = section.querySelector("[data-mv-group-auto]");
      const checked = group.mode === "auto";
      const disabled = group.channelIds.length < 2;
      if (auto.checked !== checked) auto.checked = checked;
      if (auto.disabled !== disabled) auto.disabled = disabled;
      const align = section.querySelector("[data-mv-group-align]");
      if (align.disabled !== disabled) align.disabled = disabled;
      const warning = section.querySelector(".mv-sync-warning");
      const warningVisible = group.congested || group.channelIds.length < 2;
      const warningHidden = !warningVisible;
      if (warning.hidden !== warningHidden) warning.hidden = warningHidden;
      setText(
        warning,
        group.channelIds.length < 2
          ? "싱크할 채널을 2개 이상 배정해 주세요."
          : "연결 지연으로 이 그룹의 자동 보정을 잠시 멈춥니다.",
      );
      setText(
        section.querySelector(".mv-group-reference"),
        group.referenceChannelId
          ? `기준: ${channelName(group.referenceChannelId)}`
          : "기준 대기",
      );
      for (const id of group.channelIds) {
        const row = section.querySelector(
          `[data-mv-group-row="${CSS.escape(id)}"]`,
        );
        const view = getGroupRowViewState(group, id, now);
        row.classList.toggle("is-reference", view.reference);
        setText(row.querySelector("[data-mv-sync-status]"), view.status);
        for (const [kind, value] of [
          ["delay", `지연 ${fmtSyncSeconds(view.st?.nativeDelaySec)}`],
          ["buffer", `버퍼 ${fmtSyncSeconds(view.st?.bufferAheadSec)}`],
          ["edge", `엣지 ${fmtSyncSeconds(view.st?.edgeLagSec)}`],
          ["rate", view.rate.text],
        ])
          setText(row.querySelector(`[data-mv-sync-metric="${kind}"]`), value);
        const rate = row.querySelector('[data-mv-sync-metric="rate"]');
        if (rate.dataset.tooltip !== view.rate.hint)
          rate.dataset.tooltip = view.rate.hint;
        const off = `${view.offset >= 0 ? "+" : ""}${view.offset.toFixed(1)}초`;
        const output = row.querySelector("[data-mv-sync-output]");
        setText(output, off);
        if (output.getAttribute("aria-busy") !== String(view.pending))
          output.setAttribute("aria-busy", String(view.pending));
        const outputLabel = `${channelName(id)} 시간 위치 보정 ${off}`;
        if (output.getAttribute("aria-label") !== outputLabel) {
          output.setAttribute("aria-label", outputLabel);
        }
        setSyncButtonState(
          row.querySelector("[data-mv-sync-ref]"),
          !view.ready,
          view.reference,
        );
        for (const button of row.querySelectorAll("[data-mv-sync-offset]")) {
          setSyncButtonState(
            button,
            !view.ready || !group.referenceChannelId || view.reference,
            view.pending,
          );
        }
        setSyncButtonState(
          row.querySelector("[data-mv-sync-clear]"),
          false,
          view.pending || !view.offset,
        );
      }
    }
    const notice = panel.querySelector(".mv-sync-notice");
    if (!notice) return false;
    setText(notice, syncNotice);
    const noticeHidden = !syncNotice;
    if (notice.hidden !== noticeHidden) notice.hidden = noticeHidden;
    const diagnostics = panel.querySelector(".mv-sync-diagnostics");
    if (diagnostics) patchSyncDiagnostics(diagnostics, now);
    return true;
  }

  function renderGroupSync() {
    closeGroupAssignmentPicker();
    const panel = $("mvSyncPop");
    const assignments = state.chosen
      .map((channel) => {
        const current = syncGroupForChannel(channel.channelId)?.id || "";
        const label = current ? `그룹 ${current.toUpperCase()}` : "그룹 없음";
        return (
          `<div class="mv-group-assignment"><span>${esc(channel.channelName)}</span>` +
          `<div class="mv-group-assignment-picker"><button type="button" ` +
          `class="mv-pop-button mv-group-assignment-trigger" ` +
          `data-mv-group-assignment-toggle="${esc(channel.channelId)}" ` +
          `aria-haspopup="listbox" aria-expanded="false" aria-controls="mvGroupAssignmentList" ` +
          `aria-label="${esc(channel.channelName)} 싱크 그룹">` +
          `<span class="mv-pop-value">${esc(label)}</span>` +
          `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
          `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<path d="m6 9 6 6 6-6"></path></svg></button></div></div>`
        );
      })
      .join("");
    const sections = state.sync.groups
      .map((group) => {
        const rows = group.channelIds
          .map((id) => {
            const view = getGroupRowViewState(group, id);
            const off = `${view.offset >= 0 ? "+" : ""}${view.offset.toFixed(1)}초`;
            const step = (value) =>
              `<button type="button" data-mv-sync-offset="${esc(id)}" data-step="${value}"` +
              `${!view.ready || !group.referenceChannelId || view.reference ? " disabled" : ""}>${value > 0 ? "+" : ""}${value}</button>`;
            return (
              `<div class="mv-sync-row${view.reference ? " is-reference" : ""}" data-mv-group-row="${esc(id)}">` +
              `<div class="mv-sync-row-head"><strong>${esc(channelName(id))}</strong>` +
              `<span data-mv-sync-status>${view.status}</span>` +
              `<button type="button" class="mv-sync-remove-reference" data-mv-group-remove="${esc(id)}" ` +
              `aria-label="${esc(channelName(id))} 그룹에서 제거"><svg viewBox="0 0 24 24" width="16" height="16" ` +
              `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
              `stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path>` +
              `</svg></button></div>` +
              `<div class="mv-sync-metrics">` +
              `<span data-mv-sync-metric="delay">지연 ${fmtSyncSeconds(view.st?.nativeDelaySec)}</span>` +
              `<span data-mv-sync-metric="buffer">버퍼 ${fmtSyncSeconds(view.st?.bufferAheadSec)}</span>` +
              `<span data-mv-sync-metric="edge">엣지 ${fmtSyncSeconds(view.st?.edgeLagSec)}</span>` +
              `<span class="mv-custom-tooltip" data-mv-sync-metric="rate" data-tooltip="${esc(view.rate.hint)}">${esc(view.rate.text)}</span></div>` +
              `<div class="mv-sync-controls"><button type="button" data-mv-sync-ref="${esc(id)}"` +
              `${view.ready ? "" : " disabled"}>기준</button>` +
              step(-0.5) +
              step(-0.1) +
              `<output data-mv-sync-output aria-busy="${view.pending}" aria-label="${esc(channelName(id))} 시간 위치 보정 ${off}">${off}</output>` +
              step(0.1) +
              step(0.5) +
              `<button type="button" class="mv-custom-tooltip" data-mv-sync-clear="${esc(id)}" data-tooltip="보정 초기화">↺</button></div></div>`
            );
          })
          .join("");
        return (
          `<section class="mv-sync-group" data-mv-group="${group.id}">` +
          `<div class="mv-sync-group-head"><strong>그룹 ${group.id.toUpperCase()}</strong>` +
          `<span class="mv-group-reference"></span>` +
          `<button type="button" class="mv-sync-group-reset mv-custom-tooltip" data-mv-group-reset="${group.id}" ` +
          `aria-label="그룹 ${group.id.toUpperCase()} 비우기" data-tooltip="그룹 비우기">` +
          `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ` +
          `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>` +
          `</svg><span>비우기</span></button></div>` +
          `<div class="mv-sync-actions"><label><input type="checkbox" data-mv-group-auto="${group.id}"> 자동 싱크</label>` +
          `<button type="button" data-mv-group-align="${group.id}">느린 채널에 맞추기</button>` +
          `<button type="button" data-mv-group-clear="${group.id}">보정 초기화</button></div>` +
          `<p class="mv-sync-warning" hidden></p><div class="mv-sync-list">${rows}</div></section>`
        );
      })
      .join("");
    panel.innerHTML =
      `<div class="mv-sync-scope" role="group" aria-label="싱크 범위">` +
      `<button type="button" data-mv-sync-scope="all" aria-pressed="false">전체</button>` +
      `<button type="button" data-mv-sync-scope="selected" aria-pressed="false">선택</button>` +
      `<button type="button" data-mv-sync-scope="groups" aria-pressed="true">그룹</button>` +
      `<button type="button" class="mv-group-reset-all" data-mv-group-reset-all>` +
      `그룹 전체 비우기</button></div>` +
      `<div class="mv-group-assignments">${assignments}</div>${sections}` +
      (state.sync.groups.length < 3
        ? `<button type="button" class="mv-group-add" data-mv-group-add>그룹 추가</button>`
        : "") +
      `<p class="mv-sync-notice" role="status" hidden></p>` +
      `<section class="mv-sync-diagnostics" aria-label="싱크 진단" data-phase="${syncDiagnosticsPhase}" hidden>` +
      `<div class="mv-sync-diagnostics-head"><strong>싱크 진단 기록</strong>` +
      `${syncDiagnosticsControlsHtml()}</div>` +
      `<p class="mv-sync-diagnostics-status">${esc(syncDiagnosticsStatusText())}</p>` +
      `<div class="mv-sync-diagnostics-actions">` +
      `<button type="button" id="mvSyncDiagnosticsCopy" disabled>요약 복사</button>` +
      `<button type="button" id="mvSyncDiagnosticsExport" disabled>JSON 내보내기</button>` +
      `<button type="button" id="mvSyncDiagnosticsClear" disabled>초기화</button></div>` +
      `<p class="mv-sync-diagnostics-notice" role="status" hidden></p></section>`;
    patchGroupPanel();
  }

  // 위치 보정(±·개별 초기화)이 아직 응답을 기다리는 중인지.
  function syncNudgePending(channelId) {
    return (
      !!pendingSync(channelId, "nudge") ||
      !!pendingSync(channelId, "seek")?.desiredValue?.commitOffset
    );
  }

  // disabled(진짜 막힘)와 aria-disabled(잠시 막힘)를 한 번에 맞춘다.
  function setSyncButtonState(btn, disabled, busy) {
    if (!btn) return;
    if (btn.disabled !== disabled) btn.disabled = disabled;
    const aria = !disabled && busy ? "true" : null;
    if (btn.getAttribute("aria-disabled") !== aria) {
      if (aria) btn.setAttribute("aria-disabled", aria);
      else btn.removeAttribute("aria-disabled");
    }
  }

  function syncScopeIds() {
    const chosen = state.chosen.filter((c) => c.mediaType !== "video").map((c) => c.channelId);
    if (state.sync.scope === "groups") return [];
    if (state.sync.scope !== "selected") return chosen;
    const selected = new Set(state.sync.selectedChannelIds);
    return chosen.filter((id) => selected.has(id));
  }

  function inSyncScope(channelId) {
    if (isVideoSlot(channelId)) return false;
    if (state.sync.scope === "groups") return false;
    if (state.sync.scope !== "selected") return true;
    return state.sync.selectedChannelIds.includes(channelId);
  }

  // 실제로 보정할 수 있는 채널(범위 ∩ eligible).
  function syncActiveIds(now = Date.now(), settled = false) {
    const scope = new Set(syncScopeIds());
    return syncEligibleIds(now, settled).filter((id) => scope.has(id));
  }

  // 선택 모드에서 그룹이 성립하려면 최소 2채널이 필요하다.
  function syncGroupTooSmall() {
    return state.sync.scope === "selected" && syncScopeIds().length < 2;
  }

  // 범위에서 빠진 채널은 우리가 잡고 있던 것만 놓는다. 재생 자체는 건드리지
  // 않는다(속도만 1× 로 되돌리고 보류 중인 명령을 취소한다).
  function releaseSyncOwnership(ids) {
    for (const id of ids) {
      resetSyncRate(id);
      cancelPendingSync(id);
    }
  }

  // 선택 그룹이 2채널 미만이면 자동 싱크를 실제로 끝낸다(UI 만 막지 않는다).
  // ⚠ 판정은 syncGroupTooSmall 이 한다 — '사용자가 고른 수' 기준이라
  //   한 채널이 잠시 stale/loading 인 것만으로는 꺼지지 않는다.
  function stopAutoSyncIfGroupTooSmall() {
    if (state.sync.mode !== "auto" || !syncGroupTooSmall()) return false;
    state.sync.mode = "off";
    resetAllSyncRates();
    for (const c of state.chosen) cancelPendingSync(c.channelId);
    // ⚠ 혼잡 상태를 직접 비운다. SYNC.congestion 은 해제에도 5초 hysteresis 가
    //   있어, 빈 그룹으로 한 번 불러도 active 가 남을 수 있다(since=0 이면 이번
    //   호출에서 since 만 잡히고 active 는 유지된다 — 실측). 이건 혼잡이 풀린 게
    //   아니라 싱크 세션 자체가 끝난 경우라 이전 상태를 물려줄 이유가 없다.
    //   일반 혼잡 진입/해제의 hysteresis 정책은 그대로 둔다.
    if (syncCongestion.active) {
      recordCongestionChange(false, syncScopeIds(), Date.now());
    }
    state.sync.congested = false;
    syncCongestion = { active: false, since: 0 };
    syncNotice = "싱크할 채널을 2개 이상 선택해 주세요.";
    updateSyncPolling();
    return true;
  }

  // 이미 떠 있는 싱크 패널의 값만 제자리에서 고친다.
  // ⚠ panel.innerHTML 로 다시 그리면 누른 버튼과 행이 통째로 새 Element 로
  //   바뀐다. 포커스를 되돌려 줘도 커서 아래에서 DOM 이 교체되므로 연타할 때
  //   깜빡임으로 보인다. 여기서는 기존 Element 를 그대로 두고 글자·상태만 고친다.
  // 구조가 바뀌는 경우(패널 열기, 범위 전환, 채널 추가/제거/교체)는 기존
  //   renderSync 의 전체 렌더를 그대로 쓴다.
  function patchSyncPanel(now = Date.now()) {
    const panel = $("mvSyncPop");
    if (!panel || panel.hidden) return false;
    if (state.sync.scope === "groups") return patchGroupPanel(now);
    const rows = [...panel.querySelectorAll("[data-mv-sync-row]")];
    // 행 수나 채널이 달라졌으면 구조가 바뀐 것이다 — 전체 렌더에 맡긴다.
    const ids = state.chosen.map((c) => c.channelId);
    if (rows.length !== ids.length) return false;
    if (rows.some((row, i) => row.dataset.mvSyncRow !== ids[i])) return false;
    const picking = state.sync.scope === "selected";
    if (
      rows.some((row) => !!row.querySelector("[data-mv-sync-pick]") !== picking)
    )
      return false;
    const setText = (el, value) => {
      if (el && el.textContent !== value) el.textContent = value;
    };
    const mode = state.sync.mode;
    setText(
      $("mvSyncValue"),
      mode === "auto" ? "자동" : mode === "manual" ? "수동" : "꺼짐",
    );
    const scopeIds = syncScopeIds();
    setText(
      panel.querySelector(".mv-sync-scope-count"),
      picking ? `선택 ${scopeIds.length}/${ids.length}` : "전체",
    );
    const tooSmall = syncGroupTooSmall();
    const modes = panel.querySelectorAll("[data-mv-sync-mode]");
    const align = panel.querySelector("#mvSyncAlign");
    const clear = panel.querySelector("#mvSyncClear");
    if (modes.length !== 3) return false;
    for (const button of modes) {
      const pressed = String(button.dataset.mvSyncMode === mode);
      if (button.getAttribute("aria-pressed") !== pressed)
        button.setAttribute("aria-pressed", pressed);
      const disabled = tooSmall && button.dataset.mvSyncMode !== "off";
      if (button.disabled !== disabled) button.disabled = disabled;
    }
    if (align) align.disabled = tooSmall || mode === "off";
    if (clear) clear.disabled = tooSmall || mode === "off";
    for (const [kind, visible, value] of [
      ["group", tooSmall, "싱크할 채널을 2개 이상 선택해 주세요."],
      [
        "congestion",
        state.sync.congested,
        "여러 방송의 연결이 지연되고 있습니다. 자동 보정을 잠시 멈춥니다.",
      ],
    ]) {
      const warning = panel.querySelector(`[data-mv-sync-warning="${kind}"]`);
      if (!warning) return false;
      setText(warning, value);
      warning.hidden = !visible;
    }

    for (const row of rows) {
      const id = row.dataset.mvSyncRow;
      const v = getSyncRowViewState(id, now);
      row.classList.toggle("is-excluded", v.locked);
      row.classList.toggle("is-reference", v.isReference);
      const selected = row.querySelector("[data-mv-sync-pick]");
      if (selected) selected.checked = v.picked;
      setText(
        row.querySelector("[data-mv-sync-status]"),
        v.locked ? "제외됨" : v.label,
      );
      setText(
        row.querySelector('[data-mv-sync-metric="delay"]'),
        `지연 ${fmtSyncSeconds(v.st?.nativeDelaySec)}`,
      );
      setText(
        row.querySelector('[data-mv-sync-metric="buffer"]'),
        `버퍼 ${fmtSyncSeconds(v.st?.bufferAheadSec)}`,
      );
      setText(
        row.querySelector('[data-mv-sync-metric="edge"]'),
        `엣지 ${fmtSyncSeconds(v.st?.edgeLagSec)}`,
      );
      const rateEl = row.querySelector('[data-mv-sync-metric="rate"]');
      setText(rateEl, v.rateInfo.text);
      if (rateEl && rateEl.dataset.tooltip !== v.rateInfo.hint)
        rateEl.dataset.tooltip = v.rateInfo.hint;

      const offText = `${v.offset >= 0 ? "+" : ""}${v.offset.toFixed(1)}초`;
      const output = row.querySelector("[data-mv-sync-output]");
      setText(output, offText);
      if (output) {
        if (output.getAttribute("aria-busy") !== String(v.nudgePending))
          output.setAttribute("aria-busy", String(v.nudgePending));
        const label = `${channelName(id)} 시간 위치 보정 ${offText}`;
        if (output.getAttribute("aria-label") !== label) {
          output.setAttribute("aria-label", label);
        }
      }

      setSyncButtonState(
        row.querySelector("[data-mv-sync-ref]"),
        v.refDisabled,
        v.refBusy,
      );
      for (const btn of row.querySelectorAll("[data-mv-sync-offset]")) {
        setSyncButtonState(btn, v.offDisabled, v.offBusy);
      }
      setSyncButtonState(
        row.querySelector("[data-mv-sync-clear]"),
        v.clearDisabled,
        v.clearBusy,
      );
    }

    // 안내 자리는 전체 렌더가 늘 만들어 둔다. 여기서는 글자와 숨김만 바꾼다.
    const notice = panel.querySelector(".mv-sync-notice");
    if (!notice) return false; // 예전 구조로 그려진 패널이면 전체 렌더에 맡긴다
    if (notice.textContent !== syncNotice) notice.textContent = syncNotice;
    notice.hidden = !syncNotice;
    const diagnostics = panel.querySelector(".mv-sync-diagnostics");
    if (!diagnostics) return false;
    return patchSyncDiagnostics(diagnostics, now);
  }

  // 싱크 패널의 값만 바뀌었을 때 쓴다. 제자리 갱신이 되면 그걸로 끝내고,
  // 구조가 달라져 제자리 갱신이 불가능할 때만 전체 렌더로 내려간다.
  // ⚠ 전체 렌더는 누른 버튼까지 새 Element 로 바꾼다. 그 경우에만 포커스를
  //   되돌려 준다(제자리 갱신에서는 포커스가 애초에 움직이지 않는다).
  function refreshSyncPanel(focusSelector) {
    const panel = $("mvSyncPop");
    if (!panel || panel.hidden) {
      const value = $("mvSyncValue");
      if (value)
        value.textContent =
          state.sync.scope === "groups"
            ? "그룹"
            : state.sync.mode === "auto"
              ? "자동"
              : state.sync.mode === "manual"
                ? "수동"
                : "꺼짐";
      return;
    }
    if (patchSyncPanel()) return;
    const wasInside =
      !!panel && !panel.hidden && panel.contains(document.activeElement);
    renderSync(true);
    if (!wasInside || !focusSelector || !panel || panel.hidden) return;
    panel.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function setSyncMode(next) {
    if (!["off", "auto", "manual"].includes(next) ||
        (next !== "off" && syncGroupTooSmall())) return;
    const mode = next === "auto" && state.sync.mode === "auto" ? "off" : next;
    if (mode === state.sync.mode) return;
    state.sync.mode = mode;
    if (mode !== "auto") resetAllSyncRates();
    syncNotice = "";
    updateSyncPolling();
    refreshSyncPanel();
  }

  function setSyncScope(next) {
    const before = new Set(syncScopeIds());
    const leavingGroups = state.sync.scope === "groups";
    state.sync.scope = ["all", "selected", "groups"].includes(next)
      ? next
      : "all";
    if (state.sync.scope === "groups") ensureSyncGroups();
    if (state.sync.scope === "selected" && !state.sync.selectionInitialized) {
      // 최초 전환: 지금 보고 있는 채널을 모두 선택해 둔다. 이후 재진입에서는
      // 사용자가 만들어 둔 선택을 그대로 되살린다.
      state.sync.selectedChannelIds = state.chosen.map((c) => c.channelId);
      state.sync.selectionInitialized = true;
    }
    const after = new Set(syncScopeIds());
    releaseSyncOwnership([...before].filter((id) => !after.has(id)));
    if (leavingGroups && state.sync.scope !== "groups") {
      releaseSyncOwnership(state.chosen.map((c) => c.channelId));
    }
    // 기준은 '그룹 안에 있고 그룹이 성립할 때' 만 유지한다.
    if (
      state.sync.referenceChannelId &&
      (!after.has(state.sync.referenceChannelId) || syncGroupTooSmall())
    ) {
      state.sync.referenceChannelId = null;
    }
    syncNotice = "";
    if (!stopAutoSyncIfGroupTooSmall()) updateSyncPolling();
    renderSync(true);
  }

  function setSyncSelected(channelId, selected) {
    const list = state.sync.selectedChannelIds.filter((id) => id !== channelId);
    if (selected) list.push(channelId);
    state.sync.selectedChannelIds = list;
    state.sync.selectionInitialized = true;
    if (!selected) {
      // 빠진 채널이 자동 보정 중이었다면 그 소유권을 즉시 놓는다.
      releaseSyncOwnership([channelId]);
      if (state.sync.referenceChannelId === channelId)
        state.sync.referenceChannelId = null;
    }
    syncNotice = "";
    // 그룹이 1개로 줄었으면 다음 tick 을 기다리지 않고 지금 끝낸다.
    const ended = stopAutoSyncIfGroupTooSmall();
    if (!ended) updateSyncPolling();
    // ⚠ 기준 재선택은 그룹이 성립할 때만 한다. 2→1 로 줄어 세션이 끝나는
    //   순간에 남은 한 채널을 기준으로 잡으면, 그 채널 기준으로 보정값
    //   전체가 rebase 돼 사용자가 맞춰 둔 값이 바뀐다(실측: reference 가
    //   단일 채널도 고르고, rebaseOffsets 는 chosen 전체를 다시 계산한다).
    if (!selected && !state.sync.referenceChannelId && !syncGroupTooSmall()) {
      selectSyncReference();
    }
    refreshSyncPanel(`[data-mv-sync-pick="${CSS.escape(channelId)}"]`);
  }

  function syncEligibleIds(now = Date.now(), settled = false) {
    return state.chosen
      .filter((c) => c.mediaType !== "video")
      .map((c) => c.channelId)
      .filter(
        (id) =>
          currentStatus(id) === "ready" &&
          SYNC.eligible(syncStats.get(id), syncReadyAt.get(id), now, settled),
      );
  }

  function selectSyncReference(now = Date.now()) {
    applySyncAlignDelays(now);
    // 기준 채널은 반드시 현재 싱크 그룹 안에서 고른다. 다만 offset rebase 는
    // 아래에서 chosen 전체를 대상으로 한다 — 제외 채널의 상대 보정값을
    // 잃지 않기 위해서다.
    const ids = syncActiveIds(now);
    const current = state.sync.referenceChannelId;
    if (state.sync.mode !== "auto" && current && ids.includes(current))
      return current;
    const next = SYNC.reference(ids, syncStats, syncReadyAt, current, now);
    if (next && next !== current) {
      recordReferenceChange(
        current,
        next,
        state.sync.mode === "auto" ? "auto" : "manual",
        now,
      );
      rebaseSyncOffsets(next);
      state.sync.referenceChannelId = next;
      for (const c of state.chosen) cancelPendingSync(c.channelId);
      resetAllSyncRates();
    }
    // 그룹 안에 쓸 수 있는 채널이 없으면 기준을 비운다. 범위 밖 채널이
    // 기준으로 남아 있으면 그 채널 기준으로 보정이 계산된다.
    if (!next && current && !inSyncScope(current)) {
      state.sync.referenceChannelId = null;
    }
    return next;
  }

  function requestSyncStats() {
    for (const id of state.chosen.filter((c) => c.mediaType !== "video").map((c) => c.channelId)) {
      if (currentStatus(id) === "ready")
        sendSync(id, "REQUEST_FRAME_SYNC_STATS");
    }
  }

  function syncPanelOpen() {
    return $("mvSyncPop")?.hidden === false;
  }

  function updateSyncPolling() {
    updatePlayerCatchUpHold();
    const frameOwnsRate = state.chosen.some(
      (c) => syncStats.get(c.channelId)?.syncRateOwned === true,
    );
    const auto =
      state.sync.scope === "groups"
        ? state.sync.groups.some((group) => group.mode === "auto")
        : state.sync.mode === "auto";
    const needed =
      !document.hidden &&
      (syncPanelOpen() ||
        auto ||
        pendingSyncCommands.size > 0 ||
        syncRates.size > 0 ||
        frameOwnsRate ||
        state.sync.diagnosticsEnabled ||
        liveCatchUpWanted());
    if (!needed && syncTimer) {
      clearInterval(syncTimer);
      syncTimer = 0;
    }
    if (needed && !syncTimer) {
      requestSyncStats();
      syncTimer = window.setInterval(syncTick, SYNC.LIMITS.sampleMs);
    }
  }

  // 자동 싱크가 맞추는 라이브 칸. 이 칸들은 치지직 플레이어의 자체 따라잡기(1.03×)를
  // 멈춘다. 그렇지 않으면 싱크가 뒤로 맞춘 칸을 플레이어가 다시 앞으로 당긴다.
  function autoSyncedChannelIds() {
    const lists =
      state.sync.scope === "groups"
        ? state.sync.groups
            .filter((group) => group.mode === "auto")
            .map((group) => group.channelIds)
        : state.sync.mode === "auto"
          ? [syncScopeIds()]
          : [];
    const ids = new Set();
    for (const list of lists) {
      const live = list.filter((id) => !isVideoSlot(id));
      if (live.length >= 2) live.forEach((id) => ids.add(id));
    }
    return ids;
  }

  function updatePlayerCatchUpHold() {
    const held = autoSyncedChannelIds();
    for (const c of state.chosen) {
      const id = c.channelId;
      if (isVideoSlot(id) || currentStatus(id) !== "ready") continue;
      const hold = held.has(id);
      if ((playerCatchUpHold.get(id) ?? false) === hold) continue;
      if (sendSync(id, "SET_PLAYER_CATCH_UP_HOLD", { hold })) playerCatchUpHold.set(id, hold);
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

  function alignSync(
    ids = null,
    manual = false,
    offsetOverrides = null,
    allowAudioProtectedSeek = false,
  ) {
    const now = Date.now();
    const ref = selectSyncReference(now);
    if (!ref || now - (syncReadyAt.get(ref) || now) < SYNC.LIMITS.settlingMs) {
      syncNotice = "기준 채널의 재생 정보가 준비되지 않았습니다.";
      refreshSyncPanel();
      return;
    }
    const refStats = syncStats.get(ref);
    let changed = 0;
    let partial = 0;
    let protectedCount = 0;
    for (const id of ids || syncActiveIds(now)) {
      if (
        id === ref ||
        !SYNC.eligible(syncStats.get(id), syncReadyAt.get(id), now)
      )
        continue;
      if (isSyncAudioProtected(id) && !allowAudioProtectedSeek) {
        protectedCount += 1;
        continue;
      }
      if (
        now - (syncSeekAt.get(id) || 0) <
        (manual ? 250 : SYNC.LIMITS.seekCooldownMs)
      )
        continue;
      const requestedOffset =
        offsetOverrides && Object.hasOwn(offsetOverrides, id)
          ? offsetOverrides[id]
          : state.sync.manualOffsets[id] || 0;
      const delay = SYNC.targetDelay(refStats, requestedOffset);
      const target = SYNC.seekTarget(
        syncStats.get(id),
        delay,
        manual ? 0.05 : SYNC.LIMITS.seekThresholdSec,
      );
      if (target === null) {
        if (
          offsetOverrides &&
          Math.abs(SYNC.alignDelay(syncStats.get(id)) - delay) < 0.05
        ) {
          state.sync.manualOffsets[id] = requestedOffset;
        }
        continue;
      }
      const withinOneSeek =
        Math.abs(SYNC.alignDelay(syncStats.get(id)) - delay) <=
        SYNC.LIMITS.maxSeekSec;
      if (
        sendSyncCommand(
          id,
          "seek",
          "APPLY_SYNC_SEEK",
          {
            currentTime: target,
            deltaSec: target - syncStats.get(id).currentTime,
            manual,
          },
          {
            currentTime: target,
            manual,
            offset: requestedOffset,
            commitOffset: !!offsetOverrides && withinOneSeek,
          },
        )
      ) {
        changed += 1;
        if (offsetOverrides && !withinOneSeek) partial += 1;
      }
    }
    syncNotice = partial
      ? "한 번에 최대 4초만 이동합니다. 남은 차이는 다시 보정해 주세요."
      : changed
        ? `${changed}개 채널에 보정을 요청했습니다.`
        : protectedCount
          ? "소리가 켜진 채널은 자동 이동하지 않았습니다."
          : "보정 가능한 차이가 없거나 잠시 기다려야 합니다.";
    refreshSyncPanel();
  }

  function groupEligibleIds(group, now, settled = false) {
    return group.channelIds.filter(
      (id) =>
        currentStatus(id) === "ready" &&
        SYNC.eligible(syncStats.get(id), syncReadyAt.get(id), now, settled),
    );
  }

  function selectGroupReference(group, now = Date.now()) {
    applySyncAlignDelays(now);
    const ids = groupEligibleIds(group, now);
    const current = group.referenceChannelId;
    if (group.mode !== "auto" && current && ids.includes(current))
      return current;
    const next = SYNC.reference(ids, syncStats, syncReadyAt, current, now);
    if (next && next !== current) {
      rebaseGroupOffsets(group, next);
      recordReferenceChange(
        current,
        next,
        group.mode === "auto" ? "auto" : "manual",
        now,
        group.id,
      );
      for (const id of group.channelIds) cancelPendingSync(id);
    } else if (!next && current && !group.channelIds.includes(current)) {
      group.referenceChannelId = null;
    }
    return next;
  }

  function tickSyncGroups(now) {
    for (const group of state.sync.groups) {
      if (group.channelIds.length < 2) group.mode = "off";
      const ids = groupEligibleIds(group, now, true);
      const fresh = new Map(ids.map((id) => [id, syncStats.get(id)]));
      const wasCongested = group.congested;
      group.congestionState = SYNC.congestion(
        group.congestionState,
        fresh,
        ids,
        now,
      );
      group.congested = group.congestionState.active;
      if (wasCongested !== group.congested) {
        recordCongestionChange(group.congested, ids, now, group.id);
      }
      const ref = selectGroupReference(group, now);
      const refStats = ref && syncStats.get(ref);
      for (const id of group.channelIds) {
        const st = syncStats.get(id);
        if (
          group.mode !== "auto" ||
          group.congested ||
          !refStats ||
          !ids.includes(ref) ||
          id === ref ||
          !ids.includes(id) ||
          st.userRateOverride ||
          (SYNC.isUserRate(st.playbackRate) && !st.syncRateOwned)
        ) {
          resetSyncRate(id);
          continue;
        }
        const delay = SYNC.targetDelay(refStats, group.manualOffsets[id] || 0);
        const error = delay - SYNC.alignDelay(st);
        if (
          Math.abs(error) >= SYNC.LIMITS.seekThresholdSec &&
          now - (syncSeekAt.get(id) || 0) >= SYNC.LIMITS.seekCooldownMs
        ) {
          const target = SYNC.seekTarget(st, delay);
          if (
            !isSyncAudioProtected(id) &&
            target !== null &&
            target < st.currentTime
          ) {
            sendSyncCommand(
              id,
              "seek",
              "APPLY_SYNC_SEEK",
              { currentTime: target, deltaSec: target - st.currentTime },
              { currentTime: target, manual: false },
            );
          }
        }
        setSyncRate(id, SYNC.rateFor(error, st.syncRateOwned));
      }
    }
  }

  function alignSyncGroup(
    group,
    ids = group.channelIds,
    offsets = null,
    allowAudioProtectedSeek = false,
  ) {
    const now = Date.now();
    const ref = selectGroupReference(group, now);
    if (!ref || now - (syncReadyAt.get(ref) || now) < SYNC.LIMITS.settlingMs) {
      syncNotice = `그룹 ${group.id.toUpperCase()}의 기준 채널이 준비되지 않았습니다.`;
      refreshSyncPanel();
      return;
    }
    const refStats = syncStats.get(ref);
    for (const id of ids) {
      const st = syncStats.get(id);
      if (
        id === ref ||
        !SYNC.eligible(st, syncReadyAt.get(id), now) ||
        (isSyncAudioProtected(id) && !allowAudioProtectedSeek) ||
        now - (syncSeekAt.get(id) || 0) < 250
      )
        continue;
      const offset =
        offsets && Object.hasOwn(offsets, id)
          ? offsets[id]
          : group.manualOffsets[id] || 0;
      const delay = SYNC.targetDelay(refStats, offset);
      const target = SYNC.seekTarget(st, delay, 0.05);
      if (target === null) {
        if (offsets && Math.abs(SYNC.alignDelay(st) - delay) < 0.05) {
          group.manualOffsets[id] = offset;
        }
        continue;
      }
      sendSyncCommand(
        id,
        "seek",
        "APPLY_SYNC_SEEK",
        {
          currentTime: target,
          deltaSec: target - st.currentTime,
          manual: true,
        },
        {
          currentTime: target,
          manual: true,
          offset,
          commitOffset:
            !!offsets &&
            Math.abs(SYNC.alignDelay(st) - delay) <= SYNC.LIMITS.maxSeekSec,
        },
      );
    }
    syncNotice = `그룹 ${group.id.toUpperCase()}에 보정을 요청했습니다.`;
    refreshSyncPanel();
  }

  function handleGroupSyncClick(target) {
    if (state.sync.scope !== "groups") return false;
    if (target.closest?.("[data-mv-group-reset-all]")) {
      state.sync.groups.forEach(clearSyncGroup);
      syncNotice = "모든 그룹의 채널 배정을 비웠습니다.";
      updateSyncPolling();
      renderSync(true);
      return true;
    }
    const groupReset = target.closest?.("[data-mv-group-reset]");
    if (groupReset) {
      const group = state.sync.groups.find(
        (item) => item.id === groupReset.dataset.mvGroupReset,
      );
      if (group) {
        clearSyncGroup(group);
        syncNotice = `그룹 ${group.id.toUpperCase()}의 채널 배정을 비웠습니다.`;
        updateSyncPolling();
        refreshSyncPanel(`[data-mv-group-reset="${CSS.escape(group.id)}"]`);
      }
      return true;
    }
    const remove = target.closest?.("[data-mv-group-remove]");
    if (remove) {
      const id = remove.dataset.mvGroupRemove;
      const group = syncGroupForChannel(id);
      if (group) {
        releaseGroupChannel(group, id);
        syncNotice = `${channelName(id)} 채널을 그룹 ${group.id.toUpperCase()}에서 제거했습니다.`;
        updateSyncPolling();
        renderSync(true);
      }
      return true;
    }
    if (target.closest?.("[data-mv-group-add]")) {
      if (state.sync.groups.length < 3) {
        const id = "abc"[state.sync.groups.length];
        state.sync.groups.push({
          id,
          channelIds: [],
          mode: "off",
          referenceChannelId: null,
          manualOffsets: {},
          congested: false,
          congestionState: { active: false, since: 0 },
        });
        renderSync(true);
      }
      return true;
    }
    const auto = target.closest?.("[data-mv-group-auto]");
    if (auto) {
      const group = state.sync.groups.find(
        (item) => item.id === auto.dataset.mvGroupAuto,
      );
      if (group) {
        group.mode =
          auto.checked && group.channelIds.length >= 2 ? "auto" : "off";
        if (group.mode !== "auto") group.channelIds.forEach(resetSyncRate);
        updateSyncPolling();
        refreshSyncPanel();
      }
      return true;
    }
    const align = target.closest?.("[data-mv-group-align]");
    if (align) {
      const group = state.sync.groups.find(
        (item) => item.id === align.dataset.mvGroupAlign,
      );
      if (group) alignSyncGroup(group);
      return true;
    }
    const clear = target.closest?.("[data-mv-group-clear]");
    if (clear) {
      const group = state.sync.groups.find(
        (item) => item.id === clear.dataset.mvGroupClear,
      );
      if (group)
        alignSyncGroup(
          group,
          group.channelIds,
          Object.fromEntries(group.channelIds.map((id) => [id, 0])),
          true,
        );
      return true;
    }
    const ref = target.closest?.("[data-mv-sync-ref]");
    if (ref) {
      const id = ref.dataset.mvSyncRef;
      const group = syncGroupForChannel(id);
      if (
        group &&
        group.referenceChannelId !== id &&
        groupEligibleIds(group, Date.now()).includes(id)
      ) {
        recordReferenceChange(
          group.referenceChannelId,
          id,
          "manual",
          Date.now(),
          group.id,
        );
        rebaseGroupOffsets(group, id);
        group.mode = "manual";
        group.channelIds.forEach((channelId) => {
          cancelPendingSync(channelId);
          resetSyncRate(channelId);
        });
        alignSyncGroup(group);
      }
      refreshSyncPanel();
      return true;
    }
    const offset = target.closest?.("[data-mv-sync-offset]");
    if (offset) {
      const id = offset.dataset.mvSyncOffset;
      const group = syncGroupForChannel(id);
      const step = Number(offset.dataset.step);
      if (
        !group ||
        syncNudgePending(id) ||
        ![-0.5, -0.1, 0.1, 0.5].includes(step) ||
        !groupEligibleIds(group, Date.now()).includes(id) ||
        group.referenceChannelId === id
      )
        return true;
      const before = group.manualOffsets[id] || 0;
      const next = Math.round((before + step) * 10) / 10;
      const st = syncStats.get(id);
      const targetTime = st.currentTime + before - next;
      if (
        Math.abs(next) <= 10 &&
        targetTime >= st.seekableStart + 0.05 &&
        targetTime <= st.seekableEnd - 0.05 &&
        Date.now() - (syncSeekAt.get(id) || 0) >= 250
      ) {
        sendSyncCommand(
          id,
          "nudge",
          "APPLY_SYNC_NUDGE",
          { deltaSec: before - next },
          { offset: next },
        );
      }
      refreshSyncPanel();
      return true;
    }
    const reset = target.closest?.("[data-mv-sync-clear]");
    if (reset) {
      const id = reset.dataset.mvSyncClear;
      const group = syncGroupForChannel(id);
      if (group && !syncNudgePending(id) && group.manualOffsets[id]) {
        alignSyncGroup(group, [id], { [id]: 0 }, true);
      }
      return true;
    }
    return false;
  }

  function syncTick() {
    if (document.hidden) {
      resetAllSyncRates();
      return;
    }
    const now = Date.now();
    requestSyncStats();
    updatePlayerCatchUpHold();
    applySyncAlignDelays(now);
    // 직전 틱까지 받은 측정값으로 판단한다(싱크 보정과 같은 기준).
    tickLiveCatchUp(now);
    if (state.sync.scope === "groups") {
      tickSyncGroups(now);
      refreshSyncPanel();
      updateSyncPolling();
      return;
    }
    if (stopAutoSyncIfGroupTooSmall()) {
      refreshSyncPanel();
      return;
    }
    if (state.sync.mode !== "auto") resetAllSyncRates();
    // ⚠ 보정 대상만 범위로 좁힌다. stats 수집(requestSyncStats)은 위에서
    //   이미 모든 ready 채널에 대해 끝났다.
    const ids = syncActiveIds(now);
    if (!state.sync.referenceChannelId) selectSyncReference(now);
    const settledIds = syncActiveIds(now, true);
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
        // 범위 밖 채널은 우리가 잡고 있던 속도만 풀고 더 건드리지 않는다.
        if (!inSyncScope(id)) {
          resetSyncRate(id);
          continue;
        }
        if (
          !refStats ||
          !settledIds.includes(ref) ||
          id === ref ||
          !ids.includes(id) ||
          now - (syncReadyAt.get(id) || now) < SYNC.LIMITS.settlingMs ||
          state.sync.congested ||
          syncStats.get(id).userRateOverride ||
          (SYNC.isUserRate(syncStats.get(id).playbackRate) &&
            !syncStats.get(id).syncRateOwned)
        ) {
          resetSyncRate(id);
          continue;
        }
        const delay = SYNC.targetDelay(
          refStats,
          state.sync.manualOffsets[id] || 0,
        );
        const error = delay - SYNC.alignDelay(syncStats.get(id));
        if (
          Math.abs(error) >= SYNC.LIMITS.seekThresholdSec &&
          now - (syncSeekAt.get(id) || 0) >= SYNC.LIMITS.seekCooldownMs
        ) {
          const target = SYNC.seekTarget(syncStats.get(id), delay);
          // 자동 모드에서 기준보다 뒤처진 채널은 seek로 앞당기지 않는다.
          if (
            !isSyncAudioProtected(id) &&
            target !== null &&
            target < syncStats.get(id).currentTime
          ) {
            sendSyncCommand(
              id,
              "seek",
              "APPLY_SYNC_SEEK",
              {
                currentTime: target,
                deltaSec: target - syncStats.get(id).currentTime,
              },
              { currentTime: target, manual: false },
            );
          }
        }
        setSyncRate(id, SYNC.rateFor(error, syncStats.get(id).syncRateOwned));
      }
    }
    refreshSyncPanel();
    updateSyncPolling();
  }

  function fmtSyncSeconds(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)}초` : "-";
  }

  function renderSync(force = false) {
    const value = $("mvSyncValue");
    if (value)
      value.textContent =
        state.sync.scope === "groups"
          ? "그룹"
          : state.sync.mode === "auto"
            ? "자동"
            : state.sync.mode === "manual"
              ? "수동"
              : "꺼짐";
    const panel = $("mvSyncPop");
    if (!panel || (panel.hidden && !force)) return;
    if (
      !force &&
      panel.contains(document.activeElement) &&
      document.activeElement !== panel
    )
      return;
    if (state.sync.scope === "groups") return renderGroupSync();
    const now = Date.now();
    const ref = state.sync.referenceChannelId;
    const diagnosticsStatus = syncDiagnosticsStatusText(now);
    const rows = state.chosen
      .map((c) => {
        const id = c.channelId;
        const v = getSyncRowViewState(id, now);
        const offText = `${v.offset >= 0 ? "+" : ""}${v.offset.toFixed(1)}초`;
        const btnAttrs = (disabled, busy) =>
          disabled ? "disabled" : busy ? 'aria-disabled="true"' : "";
        // 방향 설명은 '재생 위치' 이동이다. 배속(재생 속도)과 섞이면 안 된다.
        const stepBtn = (step, text, dir, side) =>
          `<button type="button" class="mv-custom-tooltip" data-mv-sync-offset="${id}" data-step="${step}" ` +
          `data-tooltip="재생 위치를 ${dir} 이동(${side})" ` +
          `aria-label="${esc(c.channelName)} 재생 위치를 ${dir} 이동" ` +
          `${btnAttrs(v.offDisabled, v.offBusy)}>${text}</button>`;
        return (
          `<div class="mv-sync-row${v.locked ? " is-excluded" : ""}` +
          `${v.isReference ? " is-reference" : ""}" data-mv-sync-row="${id}">` +
          `<div class="mv-sync-row-head">` +
          (v.picking
            ? `<label class="mv-sync-pick"><input type="checkbox" data-mv-sync-pick="${id}"` +
              `${v.picked ? " checked" : ""} aria-label="${esc(c.channelName)} 싱크 대상">` +
              `<strong>${esc(c.channelName)}</strong></label>`
            : `<strong>${esc(c.channelName)}</strong>`) +
          `<span data-mv-sync-status>${esc(v.locked ? "제외됨" : v.label)}</span></div>` +
          `<div class="mv-sync-metrics">` +
          `<span data-mv-sync-metric="delay">지연 ${fmtSyncSeconds(v.st?.nativeDelaySec)}</span>` +
          `<span data-mv-sync-metric="buffer">버퍼 ${fmtSyncSeconds(v.st?.bufferAheadSec)}</span>` +
          `<span data-mv-sync-metric="edge">엣지 ${fmtSyncSeconds(v.st?.edgeLagSec)}</span>` +
          `<span class="mv-custom-tooltip" data-mv-sync-metric="rate" data-tooltip="${esc(v.rateInfo.hint)}">` +
          `${esc(v.rateInfo.text)}</span></div>` +
          `<div class="mv-sync-controls">` +
          `<button type="button" class="mv-custom-tooltip" data-mv-sync-ref="${id}" ` +
          `data-tooltip="이 채널의 라이브 지연을 기준으로 다른 채널을 맞춥니다" ` +
          `aria-label="${esc(c.channelName)}을 기준 채널로" ` +
          `${btnAttrs(v.refDisabled, v.refBusy)}>기준</button>` +
          stepBtn("-0.5", "-0.5", "0.5초 앞으로", "라이브 쪽") +
          stepBtn("-0.1", "-0.1", "0.1초 앞으로", "라이브 쪽") +
          `<output class="mv-custom-tooltip" data-mv-sync-output aria-label="${esc(c.channelName)} 시간 위치 보정 ` +
          `${offText}" aria-busy="${v.nudgePending}" data-tooltip="시간 위치 보정(재생 속도와 별개)">` +
          `${offText}</output>` +
          stepBtn("0.1", "+0.1", "0.1초 뒤로", "과거 쪽") +
          stepBtn("0.5", "+0.5", "0.5초 뒤로", "과거 쪽") +
          `<button type="button" class="mv-custom-tooltip" data-mv-sync-clear="${id}" ` +
          `${btnAttrs(v.clearDisabled, v.clearBusy)} ` +
          `aria-label="${esc(c.channelName)} 보정 초기화" data-tooltip="보정 초기화">` +
          `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>` +
          `</div></div>`
        );
      })
      .join("");
    const picking = state.sync.scope === "selected";
    const scopeIds = syncScopeIds();
    const tooSmall = syncGroupTooSmall();
    panel.innerHTML =
      `<div class="mv-sync-scope" role="group" aria-label="싱크 범위">` +
      `<button type="button" data-mv-sync-scope="all"` +
      ` aria-pressed="${!picking}">전체</button>` +
      `<button type="button" data-mv-sync-scope="selected"` +
      ` aria-pressed="${picking}">선택</button>` +
      `<button type="button" data-mv-sync-scope="groups" aria-pressed="false">그룹</button>` +
      `<span class="mv-sync-scope-count">${
        picking ? `선택 ${scopeIds.length}/${state.chosen.length}` : "전체"
      }</span></div>` +
      `<div class="mv-sync-actions">` +
      `<div class="mv-sync-mode" role="group" aria-label="싱크 모드">` +
      [["off", "꺼짐", "mvSyncOff", "싱크 조작을 중지합니다"],
        ["auto", "자동", "mvSyncAuto", "재생 위치와 속도를 계속 자동 보정합니다"],
        ["manual", "수동", "mvSyncManual", "기준 채널과 위치를 직접 조절합니다"]]
        .map(([mode, label, id, hint]) =>
          `<button type="button" id="${id}" data-mv-sync-mode="${mode}" ` +
          `class="mv-custom-tooltip" data-tooltip="${hint}" ` +
          `aria-pressed="${state.sync.mode === mode}"` +
          `${tooSmall && mode !== "off" ? " disabled" : ""}>${label}</button>`
        ).join("") + `</div>` +
      `<button type="button" id="mvSyncAlign"${tooSmall || state.sync.mode === "off" ? " disabled" : ""}>느린 채널에 맞추기</button>` +
      `<button type="button" id="mvSyncClear"${tooSmall || state.sync.mode === "off" ? " disabled" : ""}>보정 초기화</button></div>` +
      `<p class="mv-sync-warning" data-mv-sync-warning="group"${tooSmall ? "" : " hidden"}>싱크할 채널을 2개 이상 선택해 주세요.</p>` +
      `<p class="mv-sync-warning" data-mv-sync-warning="congestion"${state.sync.congested ? "" : " hidden"}>여러 방송의 연결이 지연되고 있습니다. 자동 보정을 잠시 멈춥니다.</p>` +
      // 안내 자리는 늘 만들어 두고 비었을 때만 숨긴다. 없던 자리에 새로 끼워
      // 넣으면 그건 구조 변화라 제자리 갱신이 불가능해진다(첫 클릭이 그 경우다).
      `<p class="mv-sync-notice" role="status"${syncNotice ? "" : " hidden"}>` +
      `${esc(syncNotice)}</p>` +
      `<div class="mv-sync-list">${rows}</div>` +
      `<p class="mv-sync-note">재생 속도는 현재 영상의 배속입니다. 1.00×보다 낮으면 느리게, 높으면 빠르게 재생해 싱크를 맞춥니다.<br />채널별 −/+ 보정은 배속이 아니라 재생 위치를 옮깁니다. −는 라이브 쪽(앞으로), +는 과거 쪽(뒤로) 이동합니다.</p>` +
      `<section class="mv-sync-diagnostics" aria-label="싱크 진단" data-phase="${syncDiagnosticsPhase}"${syncDiagnosticsUi ? "" : " hidden"}>` +
      `<div class="mv-sync-diagnostics-head"><strong>싱크 진단 기록</strong>` +
      `${syncDiagnosticsControlsHtml()}</div>` +
      `<p class="mv-sync-diagnostics-status">${esc(diagnosticsStatus)}</p>` +
      `<div class="mv-sync-diagnostics-actions">` +
      `<button type="button" id="mvSyncDiagnosticsCopy"${syncDiagnostics.size ? "" : " disabled"}>요약 복사</button>` +
      `<button type="button" id="mvSyncDiagnosticsExport"${syncDiagnostics.size ? "" : " disabled"}>JSON 내보내기</button>` +
      `<button type="button" id="mvSyncDiagnosticsClear"${syncDiagnostics.size ? "" : " disabled"}>초기화</button>` +
      `</div>` +
      `<p class="mv-sync-diagnostics-notice" role="status"${syncDiagnosticsNotice ? "" : " hidden"}>${esc(syncDiagnosticsNotice)}</p>` +
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

  // 화질 목록은 각 iframe의 MAIN world가 치지직 플레이어에서 직접 수집한다.
  // 부모는 검증된 응답을 잠시 보관하고, 패널이 열려 있는 동안만 갱신을 요청한다.
  const qualityByChannel = new Map();
  const qualityRequestByChannel = new Map();
  const qualityPending = new Map();
  const qualityFeedback = new Map();
  let qualityRequestSeq = 0;
  let qualityCommandSeq = 0;
  let qualityTimer = 0;
  // 마지막으로 그린 화질 패널. 폴링(1.6초)과 칸별 응답마다 불리므로, 내용이 같으면
  // DOM 을 건드리지 않는다.
  // ⚠ 예전에는 매번 innerHTML 을 통째로 바꿔, 버튼을 누르는 사이 요소가 교체되면 클릭이
  //   무시될 수 있었고 포커스·호버도 계속 풀렸다.
  let qualityPanelHtml = "";

  function clearQualityChannelActivity(channelId) {
    const request = qualityRequestByChannel.get(channelId);
    if (request?.timer) clearTimeout(request.timer);
    qualityRequestByChannel.delete(channelId);
    const pending = qualityPending.get(channelId);
    if (pending?.timer) clearTimeout(pending.timer);
    qualityPending.delete(channelId);
    qualityByChannel.delete(channelId);
    qualityFeedback.delete(channelId);
  }

  function hasQualityPollingChannel() {
    return state.chosen.some(
      (channel) => !["ended", "error"].includes(currentStatus(channel.channelId)),
    );
  }

  function requestChannelQuality(channelId) {
    if (["ended", "error"].includes(currentStatus(channelId))) return;
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow) return;
    const previous = qualityRequestByChannel.get(channelId);
    if (previous) return;
    qualityRequestSeq = qualityRequestSeq >= Number.MAX_SAFE_INTEGER ? 1 : qualityRequestSeq + 1;
    const requestId = qualityRequestSeq;
    const timer = window.setTimeout(() => {
      if (qualityRequestByChannel.get(channelId)?.requestId !== requestId) return;
      qualityRequestByChannel.delete(channelId);
      if (!qualityByChannel.has(channelId)) {
        qualityFeedback.set(channelId, { text: "화질 정보를 불러오지 못했습니다.", error: true });
      }
      renderQuality();
    }, 4500);
    qualityRequestByChannel.set(channelId, { requestId, timer });
    try {
      frame.contentWindow.postMessage({
        source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
        type: "REQUEST_MULTIVIEW_QUALITY",
        channelId,
        requestId,
      }, CHZZK_ORIGIN);
    } catch {
      clearTimeout(timer);
      qualityRequestByChannel.delete(channelId);
    }
  }

  function requestAllChannelQualities() {
    for (const channel of state.chosen) requestChannelQuality(channel.channelId);
    renderQuality();
  }

  function startQualityPolling() {
    renderQuality();
    requestAllChannelQualities();
    if (qualityTimer || !hasQualityPollingChannel()) return;
    qualityTimer = window.setInterval(() => {
      if (!hasQualityPollingChannel()) {
        stopQualityPolling();
        renderQuality();
        return;
      }
      requestAllChannelQualities();
      renderQuality();
    }, 1600);
  }

  function stopQualityPolling() {
    if (qualityTimer) clearInterval(qualityTimer);
    qualityTimer = 0;
  }

  function updateQualityPolling() {
    const panel = $("mvQualityPop");
    if (!panel || panel.hidden || !hasQualityPollingChannel()) {
      stopQualityPolling();
      renderQuality();
      return;
    }
    startQualityPolling();
  }

  function renderQuality() {
    const panel = $("mvQualityPop");
    if (!panel || panel.hidden) return;
    const busy = state.chosen.some((channel) => qualityRequestByChannel.has(channel.channelId) ||
      qualityPending.has(channel.channelId));
    if (panel.getAttribute("aria-busy") !== String(busy))
      panel.setAttribute("aria-busy", String(busy));
    const valueText = `${state.chosen.length}채널`;
    const valueElement = $("mvQualityValue");
    if (valueElement && valueElement.textContent !== valueText) valueElement.textContent = valueText;
    const html = !state.chosen.length
      ? '<div class="mv-quality-empty">선택된 채널이 없습니다.</div>'
      : state.chosen.map((channel) => {
      const id = channel.channelId;
      const status = currentStatus(id);
      const entry = qualityByChannel.get(id);
      const pending = qualityPending.has(id);
      const feedback = qualityFeedback.get(id);
      const selected = entry?.choices.find((choice) => choice.value === entry.selected);
      const current = status === "ended" ? "방송 종료"
        : status === "error" ? "플레이어 오류"
          : entry?.ready
            ? `${selected?.label || "확인 중"}${entry.output ? ` · ${entry.output}` : ""}`
            : qualityRequestByChannel.has(id) ? "화질 정보 확인 중" : "준비 중";
      const choices = entry?.ready && status === "ready" ? entry.choices.map((choice) =>
        `<button type="button" class="mv-quality-option" data-mv-quality-channel="${esc(id)}"` +
        ` data-mv-quality-value="${esc(choice.value)}" aria-pressed="${String(choice.value === entry.selected)}"` +
        `${pending || status !== "ready" || (entry.locked && choice.value !== entry.lockedQuality) ? " disabled" : ""}>${esc(choice.label)}</button>`
      ).join("") : "";
      const message = feedback?.text || (pending ? "화질 변경 중…" :
        status === "ended" ? "방송이 종료되었습니다." :
          status === "error" ? "플레이어를 사용할 수 없습니다." :
            entry?.locked ? "최대 화질 자동 고정이 적용 중입니다." :
          status === "ready" && entry?.ready ? "" : "화질 목록을 준비하고 있습니다.");
      return `<section class="mv-quality-channel" data-channel-id="${esc(id)}">` +
        `<div class="mv-quality-head"><strong class="mv-quality-name" title="${esc(channel.channelName)}">${esc(channel.channelName)}</strong>` +
        `<span class="mv-quality-current">${esc(current)}</span></div>` +
        (choices ? `<div class="mv-quality-options" role="group" aria-label="${esc(channel.channelName)} 화질">${choices}</div>` : "") +
        `<div class="mv-quality-feedback${feedback?.error ? " is-error" : ""}" role="status">${esc(message)}</div>` +
        `</section>`;
    }).join("");
    // 다른 곳에서 패널을 비웠을 수 있으니 실제로 비어 있으면 다시 그린다.
    if (html === qualityPanelHtml && panel.childElementCount) return;
    qualityPanelHtml = html;
    panel.innerHTML = html;
  }

  function setChannelQuality(channelId, quality) {
    const entry = qualityByChannel.get(channelId);
    if (!entry?.ready || !entry.choices.some((choice) => choice.value === quality) ||
        qualityPending.has(channelId)) return;
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame?.contentWindow || currentStatus(channelId) !== "ready") return;
    qualityCommandSeq = qualityCommandSeq >= Number.MAX_SAFE_INTEGER ? 1 : qualityCommandSeq + 1;
    const commandId = qualityCommandSeq;
    const timer = window.setTimeout(() => {
      if (qualityPending.get(channelId)?.commandId !== commandId) return;
      qualityPending.delete(channelId);
      qualityFeedback.set(channelId, { text: "화질 변경 응답이 없습니다. 다시 시도해 주세요.", error: true });
      renderQuality();
    }, 6000);
    qualityPending.set(channelId, { commandId, quality, timer });
    qualityFeedback.delete(channelId);
    renderQuality();
    try {
      frame.contentWindow.postMessage({
        source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
        type: "SET_MULTIVIEW_QUALITY",
        channelId,
        commandId,
        quality,
      }, CHZZK_ORIGIN);
    } catch {
      clearTimeout(timer);
      qualityPending.delete(channelId);
      qualityFeedback.set(channelId, { text: "화질 변경 명령을 보내지 못했습니다.", error: true });
      renderQuality();
    }
  }

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
            source: MULTIVIEW_MESSAGE, ...FRAME_TOKEN_FIELD,
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

  function catchUpStatus(channel, now) {
    if (channel.mediaType === "video") return "해당 없음";
    if (!liveCatchUpEnabled) return "꺼짐";
    const id = channel.channelId;
    if (currentStatus(id) !== "ready") return "재생 대기";
    const cluster = catchUpClusters().find((ids) => ids.includes(id)) || [id];
    if (catchUpHeld.has(id)) return "되감기 보류";
    if (cluster.some((member) => catchUpHeld.has(member))) return "그룹 보류";
    if (pendingSync(id, "catch-up")) return "따라잡는 중";
    const stats = syncStats.get(id);
    if (!stats || now - stats.receivedAt > SYNC.LIMITS.staleMs) return "측정 대기";
    if (stats.paused) return "일시정지";
    if (stats.userRateOverride) return "배속 사용 중";
    if (!SYNC.eligible(stats, syncReadyAt.get(id), now, true)) return "재생 대기";
    if (stats.bufferAheadSec === null) return "버퍼 확인 중";
    if (stats.nativeDelaySec < liveCatchUpLimitSec) return "보정 불필요";
    const since = catchUpOverSince.get(id);
    if (since === undefined || now - since < SYNC.CATCH_UP.confirmMs) return "지연 확인 중";
    const last = catchUpLastAt.get(id);
    if (last !== undefined && now - last < SYNC.CATCH_UP.cooldownMs) return "재시도 대기";
    return "보정 대기";
  }

  function renderStats() {
    const panel = $("mvStatsPop");
    if (!panel || panel.hidden) return;
    const toggle = $("mvStatsCatchUp");
    if (toggle) toggle.checked = liveCatchUpEnabled;
    const toggleLabel = $("mvStatsCatchUpLabel");
    if (toggleLabel)
      toggleLabel.textContent = `자동 따라잡기 · ${liveCatchUpLimitSec}초 이상`;
    const body = $("mvStatsRows");
    if (!body) return;
    const now = Date.now();
    const rows = state.chosen
      .map((c) => {
        const status = currentStatus(c.channelId);
        const name = `<td class="mv-stats-name">${esc(c.channelName)}</td>`;
        if (status === "ended" || status === "error") {
          const label = status === "ended" ? "방송 종료" : "오류";
          return `<tr>${name}<td colspan="5" class="mv-stats-state">${label}</td></tr>`;
        }
        const catchUp = `<td class="mv-stats-catch-up-state">${catchUpStatus(c, now)}</td>`;
        const entry = statsByChannel.get(c.channelId);
        // 오래된 값은 최신인 척하지 않는다.
        const fresh =
          entry && now - entry.updatedAt < STATS_POLL_MS * STATS_STALE_TICKS;
        if (!fresh) {
          return `<tr>${name}<td class="mv-stats-state">대기 중</td>${catchUp}` +
            `<td colspan="3" class="mv-stats-state">대기 중</td></tr>`;
        }
        const st = entry.stats;
        // 실제 화질은 해상도 열(width×height)로 충분히 보인다. 따로 열을 두지 않는다.
        return (
          `<tr>${name}` +
          `<td>${latencyText(c.channelId, st.latencySec)}</td>` +
          catchUp +
          `<td>${fmtRes(st.width, st.height)}</td>` +
          `<td>${fmtFps(st.fps)}</td>` +
          `<td>${fmtBitrate(st.bitrateKbps)}</td></tr>`
        );
      })
      .join("");
    if (body.innerHTML !== rows) body.innerHTML = rows;
  }

  function positionStatsPanel() {
    const panel = $("mvStatsPop");
    if (!panel || panel.hidden) return;
    panel.style.left = "0px";
    const viewportRight = window.visualViewport
      ? window.visualViewport.offsetLeft + window.visualViewport.width
      : window.innerWidth;
    const overflow = panel.getBoundingClientRect().right - viewportRight + 8;
    if (overflow > 0) panel.style.left = `${-overflow}px`;
  }

  function closePopovers(except) {
    closeMixerPresetPicker();
    closeGroupAssignmentPicker();
    closeChatSelector();
    for (const pop of document.querySelectorAll("[data-mv-pop]")) {
      const name = pop.dataset.mvPop;
      if (name === except) continue;
      // 통계 패널이 닫히면 6칸에 계속 물어볼 이유가 없다.
      if (name === "stats") stopStatsPolling();
      if (name === "quality") stopQualityPolling();
      if (name === "volume" && !pop.querySelector(".mv-pop-panel")?.hidden) {
        mixerOpen.clear();
        mixerConfirm.clear();
        closeMixerPresetPicker();
      }
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
    // 새로 여는 팝오버는 채널 관리와 겹치지 않게 한다(숨기기만 하므로 교체
    // 작업·검색어·크기 같은 Quick 상태는 그대로 남는다).
    if (open) closeQuick();
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    // 볼륨·통계는 열려 있는 동안만 내용을 유지한다. 통계는 닫히면 폴링도 멈춘다.
    if (name === "volume" && open) {
      renderVolume();
      for (const channel of state.chosen) requestMixerState(channel.channelId);
    }
    if (name === "stats") {
      if (open) {
        startStatsPolling();
        positionStatsPanel();
      }
      else stopStatsPolling();
    }
    if (name === "quality") {
      if (open) startQualityPolling();
      else stopQualityPolling();
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
    state.chatChannelId = chatSourceId(setup.chosen[0].channelId);
    state.chatSide = setup.chatSide;
    state.chatEnabled = setup.chatEnabled;
    state.mainHighQuality = setup.mainHighQuality;
    state.startMainMuted = setup.startMainMuted;
    state.startMainVolume = setup.startMainVolume;
    if (!channelAudio.has(state.mainId)) {
      channelAudio.set(state.mainId, {
        volume: state.startMainVolume,
        muted: state.startMainMuted,
        muteTouched: false,
      });
    }
    $("mvStage").classList.toggle("is-chat-folded", !state.chatEnabled);
    $("mvChatToggle").setAttribute("aria-expanded", String(state.chatEnabled));
    $("mvChatExpand").hidden = state.chatEnabled;

    ensureCells();
    applyLayout();
    if (state.chatEnabled) applyChat(state.chatChannelId);
    restoreChatSize();
    bindChatResize();
    bindChatTopResize();
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
      .map((c) => {
        const mediaType = c.mediaType === "video" ? "video" : "live";
        const videoNo = String(c.videoNo || "");
        const ownerId = String(c.ownerChannelId || (mediaType === "live" ? c.channelId : "")).toLowerCase();
        return {
          ...c,
          mediaType,
          channelId: mediaType === "video" ? `video:${videoNo}` : String(c.channelId || "").toLowerCase(),
          ownerChannelId: HASH_RE.test(ownerId) ? ownerId : "",
          videoNo: mediaType === "video" && /^\d+$/.test(videoNo) ? videoNo : "",
          channelName: String(c.channelName ?? ""),
          channelImageUrl: String(c.channelImageUrl ?? ""),
        };
      })
      .filter((c) => {
        if (!SLOT_RE.test(c.channelId) || (c.mediaType === "video" && !c.videoNo) || seen.has(c.channelId)) return false;
        seen.add(c.channelId);
        return true;
      })
      .slice(0, 6);
    if (chosen.length < 2) return null;

    // 배치는 '지금 채널 수에 허용되는 것' 중에서만 고른다. 어긋나면 첫 배치로.
    const allowed = LAYOUTS.layoutsFor(chosen.length);
    if (!allowed.length) return null;
    const layout = allowed.find((l) => l.id === raw.layoutId) || allowed[0];
    // 채팅 위 영상 배치는 좌/우만 가능하므로 저장된 아래쪽 위치도 정규화한다.
    const chatSide = LAYOUTS.stageStyle(layout, raw.chatSide).side;
    return {
      chosen,
      layoutId: layout.id,
      chatSide,
      chatEnabled: raw.chatEnabled !== false,
      mainHighQuality: raw.mainHighQuality === true,
      startMainMuted: raw.startMainMuted === true,
      startMainVolume: typeof raw.startMainVolume === "number" && Number.isFinite(raw.startMainVolume)
        ? Math.round(Math.min(1, Math.max(0, raw.startMainVolume)) * 100) / 100
        : 1,
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
  let chatSizeState = {};
  let chatSizeEdited = false;
  let chatSizeSaveTimer = 0;
  let chatSizeWrite = Promise.resolve();

  function validChatSize(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const size = {};
    for (const key of ["w", "h", "topH"]) {
      const n = Number(value[key]);
      if (Number.isFinite(n) && n >= (key === "topH" ? 100 : 260)) {
        size[key] = Math.min(4000, Math.round(n));
      }
    }
    return size;
  }

  function persistChatSize(immediate = false) {
    chatSizeEdited = true;
    try { localStorage.setItem(CHAT_SIZE_KEY, JSON.stringify(chatSizeState)); } catch {}
    clearTimeout(chatSizeSaveTimer);
    const write = () => {
      chatSizeSaveTimer = 0;
      const snapshot = { ...chatSizeState };
      chatSizeWrite = chatSizeWrite.catch(() => {}).then(() =>
        chrome.storage.local.set({ [CHAT_SIZE_KEY]: snapshot }),
      );
    };
    if (immediate) write();
    else chatSizeSaveTimer = setTimeout(write, 150);
  }

  function applyRestoredChatSize(size) {
    const stage = $("mvStage");
    if (size.w) stage.style.setProperty("--mv-chat-w", `${size.w}px`);
    else stage.style.removeProperty("--mv-chat-w");
    if (size.h) stage.style.setProperty("--mv-chat-h", `${size.h}px`);
    else stage.style.removeProperty("--mv-chat-h");
    if (size.topH) setChatTopSize(size.topH);
    else {
      stage.style.removeProperty("--mv-chat-top-h");
      $("mvChatTopResize")?.removeAttribute("aria-valuenow");
    }
  }

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
    chatSizeState[vertical ? "h" : "w"] = size;
    persistChatSize();
  }

  // 채팅 위 영상 높이. 손으로 정하기 전에는 채팅 폭의 16:9 높이를 쓴다(multiviewLayouts).
  // ⚠ 화면 높이에 맞춘 상한은 CSS(calc(100% - 160px))가 지킨다. 복원할 때 지금 높이로
  //   잘라 저장하면 작은 창에서 한 번 연 뒤로 사용자가 정한 높이가 줄어든 채 남는다.
  function setChatTopSize(size) {
    const stage = $("mvStage");
    stage.style.setProperty("--mv-chat-top-h", `${size}px`);
    const handle = $("mvChatTopResize");
    handle?.setAttribute("aria-valuemax", String(Math.max(100, stage.clientHeight - 160)));
    handle?.setAttribute("aria-valuenow", String(size));
  }

  function applyChatTopSize(px) {
    const stage = $("mvStage");
    const max = Math.max(100, stage.clientHeight - 160);
    const size = Math.round(Math.max(100, Math.min(px, max)));
    setChatTopSize(size);
    chatSizeState.topH = size;
    persistChatSize();
  }

  function restoreChatSize() {
    let legacy = {};
    try {
      legacy = validChatSize(JSON.parse(localStorage.getItem(CHAT_SIZE_KEY) || "{}"));
    } catch {}
    chatSizeState = legacy;
    applyRestoredChatSize(legacy);
    void chrome.storage?.local?.get(CHAT_SIZE_KEY).then((data) => {
      if (chatSizeEdited) return;
      const stored = validChatSize(data?.[CHAT_SIZE_KEY]);
      chatSizeState = Object.keys(stored).length ? stored : legacy;
      applyRestoredChatSize(chatSizeState);
      try { localStorage.setItem(CHAT_SIZE_KEY, JSON.stringify(chatSizeState)); } catch {}
      if (!Object.keys(stored).length && Object.keys(legacy).length) persistChatSize(true);
    }).catch(() => {});
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
      persistChatSize(true);
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

  function bindChatTopResize() {
    const handle = $("mvChatTopResize");
    if (!handle) return;
    let dragging = false;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = true;
      handle.classList.add("is-dragging");
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      applyChatTopSize(event.clientY - $("mvStage").getBoundingClientRect().top);
    });
    const stop = (event) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("is-dragging");
      handle.releasePointerCapture?.(event.pointerId);
      persistChatSize(true);
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      // 손잡이 위치에는 행 간격이 섞여 있다. 빼지 않으면 누를 때마다 그만큼 밀린다.
      const stage = $("mvStage");
      const gap = parseFloat(getComputedStyle(stage).rowGap) || 0;
      const top = handle.getBoundingClientRect().top - stage.getBoundingClientRect().top - gap;
      applyChatTopSize(top + (event.key === "ArrowDown" ? 20 : -20));
      event.preventDefault();
    });
    // 더블클릭: 손으로 정한 높이를 지우고 채팅 폭의 16:9 높이로 돌아간다.
    handle.addEventListener("dblclick", () => {
      $("mvStage").style.removeProperty("--mv-chat-top-h");
      handle.removeAttribute("aria-valuenow");
      delete chatSizeState.topH;
      persistChatSize(true);
    });
  }

  // ── 빠른 채널 관리 ───────────────────────────────────────────────────────
  // 격자 위아래 남는 자리에 띄운다. 고르기 화면까지 가지 않고 빼기·바꾸기를 한다.
  //
  // ⚠ 채널을 빼도 남은 칸은 다시 만들지 않는다(만들면 방송이 처음부터 로드된다).
  //   빠진 칸만 지우고 배치를 새 채널 수에 맞는 것으로 바꾼다.
  let quickCandidates = null;
  let quickLoadError = null;
  const quickSize = { width: null, height: null };
  const quickPosition = { left: null, top: null };
  const quickResizeMinWidth = 420;
  const quickResizeMinHeight = 260;

  function quickStage() {
    return $("mvStage").matches(".is-chat-top-layout, .is-chat-inset-layout")
      ? $("mvStage")
      : $("mvFramesFit");
  }

  function clampQuickSize() {
    const panel = $("mvQuick");
    const stage = quickStage();
    if (!panel || !stage || panel.hidden) return;
    const bounds = stage.getBoundingClientRect();
    const maxWidth = Math.max(1, bounds.width - 16);
    const maxHeight = Math.max(1, bounds.height - 16);
    if (quickSize.width !== null) {
      quickSize.width = Math.min(
        maxWidth,
        Math.max(Math.min(quickResizeMinWidth, maxWidth), quickSize.width),
      );
      panel.style.width = `${quickSize.width}px`;
    }
    if (quickSize.height !== null) {
      quickSize.height = Math.min(
        maxHeight,
        Math.max(Math.min(quickResizeMinHeight, maxHeight), quickSize.height),
      );
      panel.style.height = `${quickSize.height}px`;
    }
    if (quickPosition.left !== null) {
      const width = panel.getBoundingClientRect().width;
      const height = panel.getBoundingClientRect().height;
      quickPosition.left = Math.max(
        0,
        Math.min(bounds.width - width, quickPosition.left),
      );
      quickPosition.top = Math.max(
        0,
        Math.min(bounds.height - height, quickPosition.top),
      );
      panel.style.left = `${quickPosition.left}px`;
      panel.style.top = `${quickPosition.top}px`;
      panel.style.transform = "none";
    }
  }

  function saveQuickGeometry() {
    const panel = $("mvQuick");
    if (!panel || !chrome.storage?.local) return;
    const bounds = panel.getBoundingClientRect();
    void chrome.storage.local
      .set({
        cheeseMultiviewQuickPosition: {
          left: quickPosition.left,
          top: quickPosition.top,
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        },
      })
      .catch(() => {});
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
    // 헤더 팝오버와 채널 관리는 동시에 떠 있지 않는다(둘 다 화면 위를 덮는다).
    // ⚠ closeQuick 은 숨기기만 하므로 여기서 불러도 되돌아오지 않는다(재귀 없음).
    closePopovers(null);
    if (!replaceChannelId && !quickRememberState) {
      quickSource = "following";
      quickKeyword = "";
      quickVideoChannelKeyword = "";
      quickVideoRerankSearchKeyword = "";
      quickFolder = "";
      quickSearchPager = null;
      quickSearchKeyword = "";
      $("mvQuickSearch").value = "";
      $("mvQuickVideoChannelSearchInput").value = "";
      $("mvQuickVideoRerankSearchInput").value = "";
      resetQuickScroll();
    }
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
    if (!SLOT_RE.test(id) || (newChannel.mediaType === "video" && !/^video:\d+$/.test(id))) return;
    // 이미 보고 있는 채널이면 넣지 않는다(같은 채널이 두 칸에 뜨지 않게).
    if (state.chosen.some((c) => c.channelId === id)) return;

    const wasMain = state.mainId === oldChannelId;
    const oldChatId = chatSourceId(oldChannelId);
    const wasChat = Boolean(oldChatId) && state.chatChannelId === oldChatId;

    // 옛 칸 정리: 그 프레임만 내린다.
    const oldCell = cells.get(oldChannelId);
    const oldFrame = oldCell?.querySelector("iframe");
    // 선택 범위의 체크 상태만 자리를 따라간다. 그룹 소속은 방송 채널에 속하므로
    // 새 채널에는 넘기지 않는다.
    const inheritSelected =
      inSyncScope(oldChannelId) && state.sync.scope === "selected";
    clearRemovedChannel(oldChannelId);
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
      ...newChannel,
      channelId: id,
      mediaType: newChannel.mediaType === "video" ? "video" : "live",
      ownerChannelId: String(newChannel.ownerChannelId || (newChannel.mediaType === "video" ? "" : id)).toLowerCase(),
      videoNo: String(newChannel.videoNo || ""),
      channelName: String(newChannel.channelName || ""),
      channelImageUrl: String(newChannel.channelImageUrl || ""),
    };
    state.chosen = state.chosen.map((c, i) => (i === index ? next : c));
    freshSyncChannels.add(id);
    state.sync.manualOffsets[id] = 0;
    if (inheritSelected && !state.sync.selectedChannelIds.includes(id)) {
      state.sync.selectedChannelIds = [...state.sync.selectedChannelIds, id];
    }
    renderSync(true);
    if (wasMain) state.mainId = id;

    ensureCells(); // 새 채널 칸만 만든다
    applyLayout();
    renderVolume();
    // 채팅이 그 채널을 보고 있었으면 새 채널로 넘긴다.
    if (wasChat || (state.chatFollowsMain && wasMain)) {
      const chatId = chatSourceId(id);
      applyChat(chatId);
    }
    renderQuick();
  }

  function closeQuick() {
    if (quickRememberState) saveQuickState();
    quickSortPicker.close();
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
    if (quickReplaceId) hint.dataset.tooltip = hint.textContent;
    else delete hint.dataset.tooltip;
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
          `<button type="button" class="mv-quick-select mv-custom-tooltip" data-mv-quick-replace="${id}"` +
          ` aria-pressed="${quickReplaceId === c.channelId}"` +
          ` data-tooltip="${esc(c.channelName)} 를 다른 채널로 바꾸기">` +
          `<span class="mv-quick-name">${esc(c.channelName)}</span>` +
          (isMain ? `<span class="mv-quick-tag">메인</span>` : "") +
          (badge
            ? `<span class="mv-quick-state" data-state="${esc(status)}">${esc(badge)}</span>`
            : "") +
          `</button>` +
          `<button type="button" class="mv-quick-drop mv-custom-tooltip" data-mv-quick-drop="${id}"` +
          `${locked ? " disabled" : ""}` +
          ` data-tooltip="${locked ? "멀티뷰는 최소 2개 채널이 필요합니다." : "멀티뷰에서 제거"}"` +
          ` aria-label="${esc(c.channelName)} 빼기">` +
          `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
          `stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"></path></svg>` +
          `</button></li>`
        );
      })
      .join("");

    renderQuickCandidates();
  }

  // ── 후보 목록 ───────────────────────────────────────────────────────────
  // 고르기 화면과 같은 로더를 쓴다(주소·응답 해석을 두 곳에 두지 않는다).
  const SOURCES = globalThis.CheeseMultiviewSources;
  const quickVideoRerankControls = globalThis.CheeseMultiviewVideoSearchControls.attach(
    $("mvQuickVideoRerankControls"),
    "quick",
    onQuickVideoRerankChange,
  );
  const quickSortPicker = globalThis.CheeseMultiviewSort.attach("mvQuickSort");
  const QUICK_TTL_MS = 20000; // 제목·시청자 수가 바뀌므로 오래 들고 있지 않는다
  const quickCache = new Map(); // key -> {value, expiresAt}
  let quickLivePager = null;
  let quickSearchPager = null;
  let quickSearchKeyword = "";
  let quickVideoSource = "following";
  let quickVideoChannel = null;
  let quickVideoChannelView = "search";
  const quickVideoPagers = new Map();
  let quickVideoSearchPager = null;
  let quickVideoSearchKeyword = "";
  let quickVideoRerankPager = null;
  let quickVideoRerankPagerKeyword = "";
  let quickVideoChannelKeyword = "";
  let quickVideoRerankSearchKeyword = "";
  let quickSource = "following";
  let quickKeyword = "";
  let quickSections = []; // 전용 팔로잉 구역(폴더)
  let quickFolder = ""; // 고른 폴더(빈 문자열이면 전체)
  let quickRememberState = false;
  const quickSortBySource = {
    following: "viewers",
    custom: "custom",
    live: "viewers",
    search: "viewers",
  };

  function saveQuickState() {
    if (!quickRememberState || !chrome.storage?.local) return;
    void chrome.storage.local
      .set({
        cheeseMultiviewQuickState: {
          source: quickSource,
          videoSource: quickVideoSource,
          videoChannel: quickVideoChannel ? {
            channelId: quickVideoChannel.channelId,
            channelName: quickVideoChannel.channelName,
            channelImageUrl: quickVideoChannel.channelImageUrl,
            verifiedMark: quickVideoChannel.verifiedMark === true,
          } : null,
          videoChannelView: quickVideoChannelView,
          keyword: quickKeyword,
          videoKeyword: quickVideoSource === "channel-search"
            ? quickVideoChannelKeyword
            : quickVideoSource === "platter-search"
              ? quickVideoRerankSearchKeyword
              : "",
          videoChannelSearchKeyword: quickVideoChannelKeyword,
          videoRerankSearchKeyword: quickVideoRerankSearchKeyword,
          folder: quickFolder,
          sortBySource: quickSortBySource,
        },
      })
      .catch(() => {});
  }

  void chrome.storage?.local
    ?.get([
      "cheeseMultiviewRememberQuickState",
      "cheeseMultiviewQuickState",
      "cheeseMultiviewQuickPosition",
    ])
    ?.then((data) => {
      quickRememberState = data.cheeseMultiviewRememberQuickState === true;
      if (quickRememberState) {
        const saved = data.cheeseMultiviewQuickState;
        if (
          saved &&
          ["following", "custom", "live", "search", "videos"].includes(saved.source)
        ) {
          quickSource = saved.source;
          if (["following", "popular", "latest", "favorites", "channel-search", "platter-search"].includes(saved.videoSource))
            quickVideoSource = saved.videoSource;
          const savedVideoChannel = saved.videoChannel;
          if (savedVideoChannel && /^[0-9a-f]{32}$/i.test(String(savedVideoChannel.channelId || "")))
            quickVideoChannel = savedVideoChannel;
          quickVideoChannelView = quickVideoChannel && saved.videoChannelView === "selected"
            ? "selected" : "search";
          quickKeyword =
            typeof saved.keyword === "string"
              ? saved.keyword.slice(0, 100)
              : "";
          const legacyVideoKeyword = typeof saved.videoKeyword === "string"
            ? saved.videoKeyword.slice(0, 100)
            : "";
          quickVideoChannelKeyword = typeof saved.videoChannelSearchKeyword === "string"
            ? saved.videoChannelSearchKeyword.slice(0, 100)
            : saved.videoSource === "channel-search" ? legacyVideoKeyword : "";
          quickVideoRerankSearchKeyword = typeof saved.videoRerankSearchKeyword === "string"
            ? saved.videoRerankSearchKeyword.slice(0, 100)
            : saved.videoSource === "platter-search" ? legacyVideoKeyword : "";
          quickFolder =
            typeof saved.folder === "string" ? saved.folder.slice(0, 128) : "";
          for (const source of Object.keys(quickSortBySource)) {
            const mode = saved.sortBySource?.[source];
            if (SOURCES.SORT_OPTIONS.some((option) => option.id === mode)) {
              quickSortBySource[source] = mode;
            }
          }
          $("mvQuickSearch").value = quickKeyword;
          $("mvQuickVideoChannelSearchInput").value = quickVideoChannelKeyword;
          $("mvQuickVideoRerankSearchInput").value = quickVideoRerankSearchKeyword;
        }
      }
      const savedPosition = data.cheeseMultiviewQuickPosition;
      if (
        Number.isFinite(savedPosition?.left) &&
        Number.isFinite(savedPosition?.top)
      ) {
        quickPosition.left = savedPosition.left;
        quickPosition.top = savedPosition.top;
      }
      if (Number.isFinite(savedPosition?.width)) {
        quickSize.width = Math.max(
          1,
          Math.min(4000, Math.round(savedPosition.width)),
        );
      }
      if (Number.isFinite(savedPosition?.height)) {
        quickSize.height = Math.max(
          1,
          Math.min(4000, Math.round(savedPosition.height)),
        );
      }
    })
    .catch(() => {});
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.cheeseMultiviewRememberQuickState) {
      quickRememberState =
        changes.cheeseMultiviewRememberQuickState.newValue === true;
      if (quickRememberState) saveQuickState();
    }
  });
  // ⚠ 요청은 순서대로 보내도 응답은 뒤섞여 온다. 마지막 요청의 응답만 그린다.
  let quickRequestId = 0;

  function getQuickLivePager() {
    const sortType = SOURCES.serverSortType("live", quickSortBySource.live);
    if (!quickLivePager || quickLivePager.sortType !== sortType) {
      quickLivePager = SOURCES.createLivePager({
        ttlMs: QUICK_TTL_MS,
        sortType,
      });
    }
    return quickLivePager;
  }

  function getQuickSearchPager(keyword) {
    const query = String(keyword || "").trim();
    if (!quickSearchPager || quickSearchKeyword !== query) {
      quickSearchKeyword = query;
      quickSearchPager = SOURCES.createSearchPager(query);
    }
    return quickSearchPager;
  }

  function getQuickVideoPager() {
    if (quickVideoChannel) {
      const key = `channel:${quickVideoChannel.channelId}`;
      if (!quickVideoPagers.has(key))
        quickVideoPagers.set(key, SOURCES.createChannelVideoPager(quickVideoChannel));
      return quickVideoPagers.get(key);
    }
      const key = quickVideoSource;
      if (!quickVideoPagers.has(key)) {
        if (key === "following") quickVideoPagers.set(key, SOURCES.createFollowingVideoPager());
        else if (key === "favorites") quickVideoPagers.set(key, SOURCES.createVideoVaultFavoritesPager());
        else if (key === "popular" || key === "latest")
        quickVideoPagers.set(key, SOURCES.createAllVideoPager(key === "latest" ? "LATEST" : "POPULAR"));
    }
    return quickVideoPagers.get(key) || null;
  }

  function isQuickVideoChannelSearchView() {
    return quickVideoSource === "channel-search" &&
      (!quickVideoChannel || quickVideoChannelView === "search");
  }

  function getQuickVideoSearchPager(keyword) {
    const query = String(keyword || "").trim();
    if (!quickVideoSearchPager || quickVideoSearchKeyword !== query) {
      quickVideoSearchKeyword = query;
      quickVideoSearchPager = SOURCES.createChannelSearchPager(query);
    }
    return quickVideoSearchPager;
  }

  function getQuickVideoRerankPager(keyword) {
    const query = String(keyword || "").trim();
    if (!quickVideoRerankPager || quickVideoRerankPagerKeyword !== query) {
      quickVideoRerankPagerKeyword = query;
      quickVideoRerankPager = SOURCES.createVideoSearchPager(query);
      quickVideoRerankControls.setPager(quickVideoRerankPager);
    }
    return quickVideoRerankPager;
  }

  // 목록을 가져온다. 전용 팔로잉만 구역(폴더) 배열이고 나머지는 평평한 목록이다.
  // ⚠ 캐시 키를 구분한다. 같은 키에 평평한 목록과 구역 배열을 섞어 담으면 안 된다.
  async function quickRows(source, keyword) {
    if (source === "videos") {
      if (isQuickVideoChannelSearchView()) {
        const pager = getQuickVideoSearchPager(keyword);
        await pager.loadFirst();
        if (pager.error && !pager.rows.length) throw pager.error;
        return pager.rows;
      }
      if (quickVideoChannel) {
        const pager = getQuickVideoPager();
        await pager.loadFirst();
        if (pager.error && !pager.rows.length) throw pager.error;
        return pager.rows;
      }
      if (quickVideoSource === "platter-search") {
        const pager = getQuickVideoRerankPager(keyword);
        await pager.loadFirst();
        if (pager.error && !pager.rows.length) throw pager.error;
        return pager.rows;
      }
      const pager = getQuickVideoPager();
      if (!pager) return [];
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows;
    }
    const sortType = SOURCES.serverSortType(source, quickSortBySource[source]);
    const key =
      source === "search"
        ? `search:${keyword}`
        : source === "custom"
          ? `custom:sections:${sortType}`
          : source === "following"
            ? `following:${sortType}`
            : source;
    if (source === "live") {
      const pager = getQuickLivePager();
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows;
    }
    if (source === "search") {
      const pager = getQuickSearchPager(keyword);
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows;
    }
    const cached = quickCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!SOURCES) return source === "custom" ? [] : [];
    const value =
      source === "following"
        ? await SOURCES.loadFollowing(sortType)
        : source === "custom"
          ? await SOURCES.loadCustomSections(sortType)
          : [];
    // 검색은 입력마다 달라 캐시하지 않는다.
    if (source !== "search") {
      quickCache.set(key, { value, expiresAt: Date.now() + QUICK_TTL_MS });
    }
    return value;
  }

  async function loadQuickCandidates() {
    const requestId = ++quickRequestId;
    const source = quickSource;
    const keyword = source === "videos"
      ? isQuickVideoChannelSearchView()
        ? quickVideoChannelKeyword
        : quickVideoSource === "platter-search"
          ? quickVideoRerankSearchKeyword
          : ""
      : quickKeyword;
    quickCandidates = null; // 불러오는 중
    quickLoadError = null;
    renderQuickCandidates();
    let result = [];
    let error = null;
    try {
      result = await quickRows(source, keyword);
    } catch (caught) {
      error = caught;
    }
    if (requestId !== quickRequestId) return; // 더 최신 요청이 있다 → 버린다
    quickLoadError = error;
    if (source === "custom") {
      quickSections = Array.isArray(result) ? result : [];
      if (
        quickFolder &&
        !quickSections.some((section) => section.id === quickFolder)
      ) {
        quickFolder = "";
        saveQuickState();
      }
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
    const tags = Array.isArray(r.tags) ? r.tags : [];
    const isVideo = r.mediaType === "video";
    const watchTimelinePercent = isVideo ? SOURCES.getWatchTimelinePercent(r) : null;
    return (
      `<button type="button" class="mv-quick-card" data-mv-quick-add="${esc(r.channelId)}"` +
      `${full ? " disabled" : ""}>` +
      `<span class="mv-quick-card-thumb${thumb ? "" : " is-fallback"}${r.adult ? " is-adult" : ""}">` +
      (thumb
        ? `<img src="${esc(thumb)}" alt="" loading="lazy">`
        : `<span class="mv-quick-card-empty"></span>`) +
      (isVideo
        ? `<span class="mv-card-badge-row${state.chosen.some((c) => c.channelId === r.channelId) ? " has-picked" : ""}">` +
          `<span class="mv-card-live is-replay">${r.videoType === "UPLOAD" ? "업로드" : "다시보기"}</span>` +
          (r.livePv > 0
            ? `<span class="mv-card-live-pv">${SOURCES.formatCompactCount(r.livePv)}회 시청된 라이브</span>`
            : "") +
          `</span>`
        : `<span class="mv-card-live">LIVE</span><span class="mv-card-viewers">${fmtCount(r.viewers)}명</span>`) +
      (isVideo && r.duration > 0
        ? `<span class="mv-card-duration">${SOURCES.formatVideoDuration(r.duration)}</span>`
        : "") +
      (watchTimelinePercent !== null
        ? `<span class="mv-quick-card-watch-timeline" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, watchTimelinePercent)).toFixed(2)}%"></span></span>`
        : "") +
      (r.adult ? `<span class="mv-card-sr-only">19 연령 제한</span>` : "") +
      `</span>` +
      `<span class="mv-quick-card-body">` +
      SOURCES.profileImg(r.channelImageUrl, 'class="mv-quick-card-avatar"') +
      `<span class="mv-quick-card-text">` +
      `<span class="mv-quick-card-title">${esc(r.liveTitle || "제목 없음")}</span>` +
      `<span class="mv-quick-card-name-row"><span class="mv-quick-card-name">${esc(r.channelName)}</span>` +
      (r.verifiedMark
        ? `<span class="mv-card-verified" role="img" aria-label="인증 채널"></span>`
        : "") +
      `</span>` +
      (isVideo
        ? `<span class="mv-quick-card-video-info">조회수 ${fmtCount(r.viewers)}회${r.openedAt ? ` · ${esc(SOURCES.formatVideoDate(r.openedAt))}` : ""}</span>`
        : "") +
      `</span></span>` +
      (r.category || tags.length
        ? `<span class="mv-card-meta mv-quick-card-meta">` +
          (r.category
            ? `<span class="mv-card-category-chip">${esc(r.category)}</span>`
            : "") +
          tags
            .map((tag) => `<span class="mv-card-tag-chip">${esc(tag)}</span>`)
            .join("") +
          `</span>`
        : "") +
      `</button>`
    );
  }

  function quickVideoChannelCard(channel) {
    return `<button type="button" class="mv-video-channel-option" role="option" data-mv-quick-video-channel="${esc(channel.channelId)}">` +
      SOURCES.profileImg(channel.channelImageUrl) +
      `<span class="mv-video-channel-option-name">${esc(channel.channelName || "채널")}</span>` +
      (channel.verifiedMark ? `<span class="mv-card-verified" role="img" aria-label="파트너 채널"></span>` : "") +
      `</button>`;
  }

  function quickSkeletonCards(count = 4) {
    return (
      `<div class="mv-quick-card is-skeleton" aria-hidden="true">` +
      `<span class="mv-quick-card-thumb"></span>` +
      `<span class="mv-quick-card-body"><span class="mv-quick-card-avatar"></span>` +
      `<span class="mv-quick-card-text"><span class="mv-skeleton-line"></span>` +
      `<span class="mv-skeleton-line is-short"></span></span></span></div>`
    ).repeat(count);
  }

  function quickPagerForSource(source = quickSource) {
    if (source === "live") return quickLivePager;
    if (source === "search") return quickSearchPager;
    if (source === "videos") {
      if (isQuickVideoChannelSearchView()) return quickVideoSearchPager;
      if (!quickVideoChannel && quickVideoSource === "platter-search") return quickVideoRerankPager;
      return getQuickVideoPager();
    }
    return null;
  }

  function renderQuickVideoChannelSuggestions(pager, keyword) {
    const input = $("mvQuickVideoChannelSearchInput");
    const popover = $("mvQuickVideoChannelPopover");
    const query = String(keyword || "").trim();
    const visible = Boolean(query) && quickSource === "videos" && isQuickVideoChannelSearchView();
    input.setAttribute("aria-expanded", String(visible));
    popover.hidden = !visible;
    if (!visible) {
      popover.innerHTML = "";
      return;
    }
    if (quickCandidates === null) {
      popover.setAttribute("aria-busy", "true");
      popover.innerHTML = '<div class="mv-video-channel-empty">채널을 찾는 중…</div>'.repeat(3);
      return;
    }
    popover.removeAttribute("aria-busy");
    if ((pager?.error || quickLoadError) && !quickCandidates.length) {
      popover.innerHTML = `<div class="mv-video-channel-empty">채널을 불러오지 못했습니다. (${esc((pager?.error || quickLoadError).message || "요청 실패")})</div>`;
      return;
    }
    if (!quickCandidates.length) {
      popover.innerHTML = '<div class="mv-video-channel-empty">검색된 채널이 없습니다.</div>';
      return;
    }
    popover.innerHTML = quickCandidates.map(quickVideoChannelCard).join("") +
      (pager?.error ? '<button type="button" class="mv-video-channel-more" data-mv-quick-retry="1">다음 채널 다시 불러오기</button>' :
        pager?.loading ? '<div class="mv-video-channel-empty">더 불러오는 중…</div>' : "");
  }

  function syncQuickPagedRetry() {
    const box = $("mvQuickAdd");
    if (!box) return;
    box.querySelector(".mv-quick-retry")?.remove();
    const pager = quickPagerForSource();
    if (pager?.error && quickCandidates?.length) {
      box.insertAdjacentHTML(
        "beforeend",
        '<button type="button" class="mv-quick-retry" data-mv-quick-retry="1">다음 목록 다시 불러오기</button>',
      );
    }
  }

  async function loadMoreQuickCandidates() {
    if (
      (quickSource !== "live" && quickSource !== "search" && quickSource !== "videos") ||
      $("mvQuick")?.hidden
    )
      return;
    const source = quickSource;
    const pager = quickPagerForSource(source);
    if (!pager || pager.loading || pager.done) return;
    const box = $("mvQuickAdd");
    box?.querySelector(".mv-quick-retry")?.remove();
    box?.classList.add("is-loading-more");
    await pager.loadNext();
    box?.classList.remove("is-loading-more");
    if (quickSource !== source || pager !== quickPagerForSource(source)) return;
    if (pager.error) {
      syncQuickPagedRetry();
      if (source === "videos" && isQuickVideoChannelSearchView())
        renderQuickCandidates();
      return;
    }
    quickCandidates = pager.rows;
    if (source === "videos" && isQuickVideoChannelSearchView()) {
      renderQuickCandidates();
      return;
    }
    const existing = new Map(
      [...box.querySelectorAll("[data-mv-quick-add]")].map((node) => [
        node.dataset.mvQuickAdd,
        node,
      ]),
    );
    if (!existing.size) {
      renderQuickCandidates();
      return;
    }
    const have = new Set(state.chosen.map((channel) => channel.channelId));
    const mode = $("mvQuickSort").value;
    const rows = (source === "videos" ? quickVisibleRows() : SOURCES.sortRows(
      quickVisibleRows(),
      mode,
      source === "live" ||
        source === "following" ||
        (source === "custom" && (mode === "recent" || mode === "oldest")),
    )).filter((row) => row.mediaType === "channel" || !have.has(row.channelId));
    const full = !quickReplaceId && state.chosen.length >= 6;
    let next = null;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      let node = existing.get(row.channelId);
      if (!node) {
        const template = document.createElement("template");
        template.innerHTML = row.mediaType === "channel"
          ? quickVideoChannelCard(row)
          : quickCard(row, full);
        node = template.content.firstElementChild;
        box.insertBefore(node, next);
      }
      next = node;
    }
    requestAnimationFrame(maybeLoadMoreQuickCandidates);
  }

  function maybeLoadMoreQuickCandidates() {
    if (quickSource === "videos" && isQuickVideoChannelSearchView()) {
      const popover = $("mvQuickVideoChannelPopover");
      const pager = quickPagerForSource();
      if (!popover || popover.hidden || $("mvQuick")?.hidden || !pager || pager.error) return;
      if (popover.scrollHeight - popover.scrollTop - popover.clientHeight < 80)
        void loadMoreQuickCandidates();
      return;
    }
    const box = $("mvQuickAdd");
    const pager = quickPagerForSource();
    if (!box || $("mvQuick")?.hidden || !pager || pager.error) return;
    // 격자는 위아래로 스크롤한다(예전 가로 캐러셀 기준을 세로로 바꿨다).
    const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (remaining <= Math.max(220, box.clientHeight * 0.75))
      void loadMoreQuickCandidates();
  }

  // 후보가 없을 때의 안내는 목록 종류마다 다르다.
  function quickEmptyMessage() {
    if (quickSource === "videos") {
      if (isQuickVideoChannelSearchView())
        return quickVideoChannelKeyword.trim() ? "다시보기를 찾을 채널이 없습니다." : "채널명을 검색해 다시보기를 찾아보세요.";
      if (!quickVideoChannel && quickVideoSource === "platter-search")
        return quickVideoRerankSearchKeyword.trim() ? "다시보기 검색 결과가 없습니다." : "검색어를 입력해 다시보기를 찾아보세요.";
      if (quickVideoChannel) return "채널에 공개된 다시보기가 없습니다.";
      if (quickVideoSource === "favorites") return "보관함에 즐겨찾기한 다시보기가 없습니다.";
      if (quickVideoSource === "following") return "팔로잉 채널의 다시보기가 없습니다.";
      return "다시보기가 없습니다.";
    }
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
    const videoChannelSearch = quickSource === "videos" && isQuickVideoChannelSearchView();
    const videoRerankSearch = quickSource === "videos" && !quickVideoChannel && quickVideoSource === "platter-search";
    if (searchBox) searchBox.hidden = quickSource !== "search";
    $("mvQuickVideoChannelSearch").hidden = !videoChannelSearch;
    $("mvQuickVideoRerankSearch").hidden = !videoRerankSearch;
    quickVideoRerankControls.setPager(videoRerankSearch ? quickVideoRerankPager : null);
    const videoSources = $("mvQuickVideoSources");
    if (videoSources) {
      videoSources.hidden = quickSource !== "videos";
      for (const button of videoSources.querySelectorAll("[data-mv-quick-video-source]"))
        button.setAttribute("aria-pressed", String(button.dataset.mvQuickVideoSource === quickVideoSource &&
          (button.dataset.mvQuickVideoSource !== "channel-search" || quickVideoChannelView === "search")));
      const back = videoSources.querySelector("[data-mv-quick-video-channel-back]");
      if (back) {
        back.hidden = quickVideoSource !== "channel-search" || !quickVideoChannel;
        back.setAttribute("aria-pressed", String(
          quickVideoSource === "channel-search" && Boolean(quickVideoChannel) && quickVideoChannelView === "selected",
        ));
      }
    }
    renderQuickFolders();
    const sort = $("mvQuickSort");
    sort.closest(".mv-sort-row").hidden = quickSource === "videos";
    const hasCustom =
      quickSource === "custom" &&
      SOURCES.hasCustomOrder(quickSections, quickFolder);
    if (!sort.options.length) {
      sort.innerHTML = SOURCES.SORT_OPTIONS.map(
        (option) => `<option value="${option.id}">${option.label}</option>`,
      ).join("");
    }
    const custom = sort.querySelector('[value="custom"]');
    custom.hidden = !hasCustom;
    custom.disabled = !hasCustom;
    const oldest = sort.querySelector('[value="oldest"]');
    oldest.textContent =
      quickSource === "live" ? "오래된순 (불러온 방송)" : "오래된순";
    const mode =
      quickSource === "videos"
        ? "custom"
        : quickSortBySource[quickSource] === "custom" && !hasCustom
        ? "viewers"
        : quickSortBySource[quickSource];
    sort.value = mode;
    sort.disabled = quickCandidates === null || quickSource === "videos";
    quickSortPicker.sync();

    const box = $("mvQuickAdd");
    if (!box) return;
    const rail = box.closest(".mv-quick-rail");
    if (rail) rail.hidden = videoChannelSearch;
    const previousScrollTop = box.scrollTop;
    if (quickCandidates === null) {
      box.setAttribute("aria-busy", "true");
      box.innerHTML = quickSkeletonCards();
      if (videoChannelSearch) renderQuickVideoChannelSuggestions(quickVideoSearchPager, quickVideoChannelKeyword);
      return;
    }
    box.removeAttribute("aria-busy");
    if (videoChannelSearch) {
      box.innerHTML = "";
      renderQuickVideoChannelSuggestions(getQuickVideoSearchPager(quickVideoChannelKeyword), quickVideoChannelKeyword);
      return;
    }
    // 이미 보고 있는 채널은 후보에서 뺀다. 교체 대상 자신도 뺀다 — 같은 채널로
    // 갈아 끼우는 것은 replaceChannel 이 거르므로 눌러도 아무 일이 없다.
    const have = new Set(state.chosen.map((c) => c.channelId));
    const rest = (quickSource === "videos" ? quickVisibleRows() : SOURCES.sortRows(
      quickVisibleRows(),
      mode,
      quickSource === "live" ||
        quickSource === "following" ||
        (quickSource === "custom" && (mode === "recent" || mode === "oldest")),
    )).filter((r) => r.mediaType === "channel" || !have.has(r.channelId));
    if (!rest.length) {
      const loginRequired = (quickSource === "following" || quickSource === "custom" ||
        (quickSource === "videos" && quickVideoSource === "following")) &&
        SOURCES.isLoginRequiredError(quickLoadError);
      const message = loginRequired
        ? "팔로잉 목록을 보려면 치지직에 로그인해 주세요."
        : quickLoadError
          ? `목록을 불러오지 못했습니다. (${quickLoadError.message || "요청 실패"})`
          : quickEmptyMessage();
      box.innerHTML = `<p class="mv-quick-empty">${esc(message)}</p>`;
      return;
    }
    // 교체 모드가 아니고 자리가 다 찼으면 더 담을 수 없다.
    const full = !quickReplaceId && state.chosen.length >= 6;
    box.innerHTML = rest.map((r) => r.mediaType === "channel"
      ? quickVideoChannelCard(r)
      : quickCard(r, full)).join("");
    syncQuickPagedRetry();
    box.scrollTop = Math.min(
      previousScrollTop,
      Math.max(0, box.scrollHeight - box.clientHeight),
    );
    requestAnimationFrame(maybeLoadMoreQuickCandidates);
  }

  function onQuickVideoRerankChange({ pager, poolChanged, updatePager }) {
    if (poolChanged) {
      quickVideoRerankPager = null;
      quickVideoRerankPagerKeyword = "";
      if (quickSource === "videos" && quickVideoSource === "platter-search") void loadQuickCandidates();
      return;
    }
    if (updatePager === false) return;
    if (quickSource === "videos" && quickVideoSource === "platter-search" &&
      pager && pager === quickVideoRerankPager) {
      quickCandidates = pager.rows;
      renderQuickCandidates();
    }
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
    const removedChatId = chatSourceId(channelId);
    // 이 칸의 프레임만 확실히 내린다.
    const frame = cell.querySelector("iframe");
    clearRemovedChannel(channelId);
    if (frame) frame.src = "about:blank";
    cell.remove();
    cells.delete(channelId);
    clearTimeout(frameTimers.get(channelId));
    frameTimers.delete(channelId);
    frameStates.delete(channelId);
    lastQuality.delete(channelId);
    qualityTransitions.delete(channelId);
    state.chosen = state.chosen.filter((c) => c.channelId !== channelId);
    renderVolume();
    // 채널을 빼서 선택 그룹이 1개가 됐을 수도 있다.
    stopAutoSyncIfGroupTooSmall();
    renderSync(true);

    // 메인이 빠졌으면 남은 첫 채널을 메인으로 올린다.
    if (state.mainId === channelId) {
      state.mainId = state.chosen[0]?.channelId || "";
      if (state.mainId) {
        promoteMainAudio(state.mainId);
        postState(state.mainId, true);
      }
      if (state.chatFollowsMain) {
        const chatId = chatSourceId(state.mainId);
        applyChat(chatId);
      }
    }
    if (removedChatId && state.chatChannelId === removedChatId && state.mainId) {
      const chatId = chatSourceId(state.mainId);
      applyChat(chatId);
    }
    fitLayoutToCount();
    renderQuick();
  }

  // 채널 더하기: 새 칸만 만든다(기존 칸은 건드리지 않는다).
  function addChannel(channelId) {
    if (state.chosen.length >= 6) return;
    const found = quickCandidates?.find((r) => r.channelId === channelId);
    if (!found || cells.has(channelId)) return;
    state.chosen = [...state.chosen, { ...found }];
    freshSyncChannels.add(channelId);
    state.sync.manualOffsets[channelId] = 0;
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
      state.chatSide = LAYOUTS.chatSideForSwitch(allowed[0], state.chatSide);
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
          chatEnabled: state.chatEnabled,
          mainHighQuality: state.mainHighQuality,
          startMainMuted: state.startMainMuted,
          startMainVolume: state.startMainVolume,
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
    if (HOSTED_ON_CHZZK) {
      try {
        await hostApi("setup.open", { href });
      } catch {
        window.open(href, "_blank", "noopener");
      }
      return;
    }
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
    const groupAssignmentOption = target.closest?.(
      "[data-mv-group-assign-option]",
    );
    if (groupAssignmentOption) {
      const channelId = groupAssignmentOption.dataset.mvGroupAssignOption;
      const groupId = groupAssignmentOption.dataset.groupId || "";
      closeGroupAssignmentPicker();
      assignSyncGroup(channelId, groupId);
      return;
    }
    const groupAssignmentToggle = target.closest?.(
      "[data-mv-group-assignment-toggle]",
    );
    if (groupAssignmentToggle) {
      toggleGroupAssignmentPicker(
        groupAssignmentToggle.dataset.mvGroupAssignmentToggle,
      );
      return;
    }
    if (groupAssignmentPickerId && !target.closest?.("#mvGroupAssignmentList"))
      closeGroupAssignmentPicker();
    if (handleGroupSyncClick(target)) return;
    const syncMode = target.closest?.("[data-mv-sync-mode]");
    if (syncMode && state.sync.scope !== "groups") {
      setSyncMode(syncMode.dataset.mvSyncMode);
      return;
    }
    const syncRef = target.closest?.("[data-mv-sync-ref]");
    if (syncRef) {
      if (state.sync.mode === "off") return;
      const id = syncRef.dataset.mvSyncRef;
      // 이미 기준인 채널은 다시 처리하지 않는다(버튼은 포커스 유지를 위해
      // disabled 대신 aria-disabled 로 둔다).
      if (
        !syncEligibleIds().includes(id) ||
        id === state.sync.referenceChannelId
      )
        return;
      recordReferenceChange(state.sync.referenceChannelId, id, "manual");
      rebaseSyncOffsets(id);
      state.sync.referenceChannelId = id;
      state.sync.mode = "manual";
      for (const c of state.chosen) cancelPendingSync(c.channelId);
      resetAllSyncRates();
      updateSyncPolling();
      alignSync(null, true);
      refreshSyncPanel(`[data-mv-sync-ref="${CSS.escape(id)}"]`);
      return;
    }
    const syncOffset = target.closest?.("[data-mv-sync-offset]");
    if (syncOffset) {
      if (state.sync.mode === "off") return;
      const id = syncOffset.dataset.mvSyncOffset;
      // 보류 중에는 새 보정을 받지 않는다(버튼은 aria-disabled 로 잠겨 있다).
      if (syncNudgePending(id)) return;
      const step = Number(syncOffset.dataset.step);
      if (
        !syncEligibleIds().includes(id) ||
        id === state.sync.referenceChannelId ||
        ![-0.5, -0.1, 0.1, 0.5].includes(step)
      )
        return;
      const before = state.sync.manualOffsets[id] || 0;
      const next = Math.round((before + step) * 10) / 10;
      if (Math.abs(next) > 10 && Math.abs(next) > Math.abs(before)) return;
      if (next === before) return;
      const st = syncStats.get(id);
      const target = st.currentTime + before - next;
      if (target < st.seekableStart + 0.05 || target > st.seekableEnd - 0.05) {
        syncNotice = "현재 재생 가능한 구간 밖입니다.";
      } else if (
        Date.now() - (syncSeekAt.get(id) || 0) < 250 ||
        pendingSync(id, "nudge")
      ) {
        syncNotice = "잠시 후 다시 조절해 주세요.";
      } else {
        syncNotice = sendSyncCommand(
          id,
          "nudge",
          "APPLY_SYNC_NUDGE",
          { deltaSec: before - next },
          { offset: next },
        )
          ? "수동 보정을 적용 중입니다."
          : "잠시 후 다시 조절해 주세요.";
      }
      refreshSyncPanel(
        `[data-mv-sync-offset="${CSS.escape(id)}"][data-step="${syncOffset.dataset.step}"]`,
      );
      return;
    }
    const syncClear = target.closest?.("[data-mv-sync-clear]");
    if (syncClear) {
      if (state.sync.mode === "off") return;
      const id = syncClear.dataset.mvSyncClear;
      // 되돌릴 보정이 없거나 보류 중이면 막는다(버튼은 aria-disabled 로 잠겨 있다).
      if (
        !cells.has(id) ||
        syncNudgePending(id) ||
        !(state.sync.manualOffsets[id] || 0)
      )
        return;
      alignSync([id], true, { [id]: 0 }, true);
      refreshSyncPanel(`[data-mv-sync-clear="${CSS.escape(id)}"]`);
      return;
    }
    const syncScopeBtn = target.closest?.("[data-mv-sync-scope]");
    if (syncScopeBtn) {
      const next = syncScopeBtn.dataset.mvSyncScope;
      if (next !== state.sync.scope) setSyncScope(next);
      return;
    }
    if (target.closest?.("#mvSyncAlign")) {
      if (state.sync.mode === "off") return;
      document.activeElement?.blur?.();
      requestSyncStats();
      window.setTimeout(() => {
        const next = SYNC.reference(
          syncActiveIds(),
          syncStats,
          syncReadyAt,
          state.sync.referenceChannelId,
        );
        if (next && next !== state.sync.referenceChannelId) {
          recordReferenceChange(state.sync.referenceChannelId, next, "manual");
          rebaseSyncOffsets(next);
          state.sync.referenceChannelId = next;
          for (const c of state.chosen) cancelPendingSync(c.channelId);
          resetAllSyncRates();
        }
        alignSync(syncActiveIds());
      }, 400);
      return;
    }
    if (target.closest?.("#mvSyncClear")) {
      if (state.sync.mode === "off") return;
      document.activeElement?.blur?.();
      // 현재 범위의 채널만 0 으로 맞춘다. 범위 밖 채널의 보정값은 건드리지 않는다.
      const scopeIds = syncScopeIds();
      alignSync(
        syncActiveIds(),
        true,
        Object.fromEntries(scopeIds.map((id) => [id, 0])),
      );
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
      if (isVideoChatSource(state.chatChannelId)) {
        if (!vodChatSession.retry())
          postVodChatControl(state.chatChannelId, true, chatGeneration);
        renderVodChat();
      } else {
        loadChat(state.chatChannelId, { retry: true });
      }
      return;
    }
    if (target.closest?.("#mvChatPopout")) {
      openChatPopout();
      return;
    }
    if (target.closest?.("#mvChatPopupReturn")) {
      restoreInlineChat();
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
      const wasVideos = quickSource === "videos";
      quickSource = sourceTab.dataset.mvQuickSource;
      if (quickSource === "videos" && !wasVideos) {
        quickVideoChannel = null;
        quickVideoChannelView = "search";
      }
      quickFolder = ""; // 목록 종류를 바꾸면 구역 선택을 푼다
      // 앞 탭에서 내려 둔 스크롤이 남으면 새 탭이 엉뚱한 위치에서 시작한다.
      resetQuickScroll();
      saveQuickState();
      void loadQuickCandidates();
      return;
    }
    const videoSourceTab = target.closest?.("[data-mv-quick-video-source]");
    if (videoSourceTab) {
      const nextVideoSource = videoSourceTab.dataset.mvQuickVideoSource;
      if (nextVideoSource !== "channel-search" || quickVideoSource !== "channel-search") {
        quickVideoChannel = null;
        quickVideoChannelView = "search";
      }
      quickVideoSource = nextVideoSource;
      if (nextVideoSource === "channel-search") quickVideoChannelView = "search";
      resetQuickScroll();
      saveQuickState();
      if (quickVideoSource === "channel-search") {
        $("mvQuickVideoChannelSearch").hidden = false;
        $("mvQuickVideoChannelSearchInput").focus();
      } else if (quickVideoSource === "platter-search") {
        $("mvQuickVideoRerankSearch").hidden = false;
        $("mvQuickVideoRerankSearchInput").focus();
      }
      void loadQuickCandidates();
      return;
    }
    if (target.closest?.("[data-mv-quick-video-channel-back]")) {
      quickVideoChannelView = "selected";
      resetQuickScroll();
      saveQuickState();
      void loadQuickCandidates();
      return;
    }
    const videoChannelCard = target.closest?.("[data-mv-quick-video-channel]");
    if (videoChannelCard) {
      const channel = quickCandidates?.find((row) => row.channelId === videoChannelCard.dataset.mvQuickVideoChannel);
      if (channel) {
        quickVideoChannel = channel;
        quickVideoChannelView = "selected";
        quickVideoPagers.delete(`channel:${channel.channelId}`);
        resetQuickScroll();
        saveQuickState();
        void loadQuickCandidates();
      }
      return;
    }
    const folder = target.closest?.("[data-mv-quick-folder]");
    if (folder) {
      // 구역 전환은 이미 받아 둔 목록을 거르기만 한다(다시 불러오지 않는다).
      quickFolder = folder.dataset.mvQuickFolder;
      saveQuickState();
      renderQuickCandidates();
      return;
    }
    if (target.closest?.("[data-mv-quick-retry]")) {
      void loadMoreQuickCandidates();
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
    const wideApply = target.closest?.("[data-mv-wide-apply]");
    if (wideApply) {
      const channelId = wideApply.dataset.mvWideApply;
      requestMultiviewWideApply(channelId);
      try {
        cells.get(channelId)?.querySelector("iframe")?.contentWindow?.focus();
      } catch {}
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
    const qualityOption = target.closest?.("[data-mv-quality-channel][data-mv-quality-value]");
    if (qualityOption) {
      setChannelQuality(
        qualityOption.dataset.mvQualityChannel,
        qualityOption.dataset.mvQualityValue,
      );
      return;
    }
    if (target.closest?.("#mvChatTitle")) {
      toggleChatSelector();
      return;
    }
    const masterMute = target.closest?.("[data-mv-vol-master-mute]");
    if (masterMute) {
      state.masterMuted = !state.masterMuted;
      postAllAudio();
      if (state.masterMuted) {
        for (const channel of state.chosen) clearAudioNotice(channel.channelId);
      }
      renderVolume();
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
    const mixerPresetToggle = target.closest?.("[data-mv-mixer-preset-toggle]");
    if (mixerPresetToggle) {
      openMixerPresetPicker(mixerPresetToggle.dataset.mvMixerPresetToggle);
      return;
    }
    const mixerPresetOption = target.closest?.("[data-mv-mixer-preset-option]");
    if (mixerPresetOption && !mixerPresetOption.disabled) {
      const channelId = mixerPresetOption.dataset.mvMixerPresetOption;
      const presetId = mixerPresetOption.dataset.presetId;
      closeMixerPresetPicker();
      if (channelId && presetId) {
        sendMixerCommand(channelId, "MIXER_SET_PRESET", { presetId });
      }
      return;
    }
    const mixerConfirmButton = target.closest?.("[data-mv-mixer-confirm]");
    if (mixerConfirmButton) {
      const id = mixerConfirmButton.dataset.mvMixerConfirm;
      sendMixerCommand(id, "MIXER_SET_ENABLED", {
        enabled: false,
        confirmed: true,
      });
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
      if (!state.chatEnabled) {
        state.chatEnabled = true;
        $("mvStage").classList.remove("is-chat-folded");
        applyLayout();
        $("mvChatToggle").setAttribute("aria-expanded", "true");
        $("mvChatExpand").hidden = true;
      }
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
      if (state.chatFollowsMain) {
        const chatId = chatSourceId(state.mainId);
        if (state.chatEnabled) applyChat(chatId);
        else {
          state.chatChannelId = chatId;
          renderTopbar();
        }
      }
      renderTopbar();
      return;
    }
    if (target.closest?.("#mvChatToggle, #mvChatExpand")) {
      // ⚠ 채팅 접기 = UI 만 숨김. iframe 은 그대로 살아 있어 채팅 연결도 유지된다.
      //   src 를 비우면 다시 펼 때 채팅이 재연결돼 그동안의 대화를 놓친다.
      //   연결까지 끊는 '채팅 끄기' 가 필요하면 별도 동작으로 나눈다.
      const stage = $("mvStage");
      const folded = stage.classList.toggle("is-chat-folded");
      applyLayout();
      if (!folded && !state.chatEnabled) {
        state.chatEnabled = true;
        applyChat(state.chatChannelId);
        renderTopbar();
      }
      const button = $("mvChatToggle");
      if (folded) closeChatSelector();
      button.setAttribute("aria-expanded", String(!folded));
      const expand = $("mvChatExpand");
      expand.hidden = !folded;
      (folded ? expand : button).focus();
      return;
    }
    // 패널 안의 빈 곳을 누른 게 아니면(=바깥) 열린 팝오버를 닫는다.
    if (!target.closest?.(".mv-pop-panel")) closePopovers(null);
  });

  window.addEventListener("resize", closeGroupAssignmentPicker);
  window.addEventListener("resize", positionStatsPanel);
  $("mvSyncPop")?.addEventListener("scroll", closeGroupAssignmentPicker, {
    passive: true,
  });

  $("mvChatTitleWrap")?.addEventListener("keydown", (event) => {
    const list = $("mvChatTitleList");
    if (event.key === "Escape" && !list.hidden) {
      closeChatSelector();
      $("mvChatTitle").focus();
      event.preventDefault();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    if (list.hidden) toggleChatSelector();
    const options = [...list.querySelectorAll("[role='option']")];
    const index = options.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    options[(next + options.length) % options.length]?.focus();
    event.preventDefault();
  });

  let quickSearchTimer = 0;
  $("mvQuickSearch")?.addEventListener("input", (event) => {
    quickKeyword = event.target.value;
    clearTimeout(quickSearchTimer);
    quickSearchTimer = window.setTimeout(() => void loadQuickCandidates(), 300);
  });
  let quickVideoSearchTimer = 0;
  const onQuickVideoChannelSearchInput = (event) => {
    quickVideoChannelKeyword = event.target.value;
    $("mvQuickVideoChannelPopover").scrollTop = 0;
    clearTimeout(quickVideoSearchTimer);
    quickVideoSearchTimer = window.setTimeout(() => void loadQuickCandidates(), 300);
  };
  const onQuickVideoRerankSearchInput = (event) => {
    quickVideoRerankSearchKeyword = event.target.value;
    clearTimeout(quickVideoSearchTimer);
    quickVideoSearchTimer = window.setTimeout(() => void loadQuickCandidates(), 300);
  };
  $("mvQuickVideoChannelSearchInput")?.addEventListener("input", onQuickVideoChannelSearchInput);
  $("mvQuickVideoRerankSearchInput")?.addEventListener("input", onQuickVideoRerankSearchInput);
  $("mvQuickSort")?.addEventListener("change", (event) => {
    const previousType = SOURCES.serverSortType(
      quickSource,
      quickSortBySource[quickSource],
    );
    quickSortBySource[quickSource] = event.target.value;
    $("mvQuickAdd").scrollTop = 0;
    saveQuickState();
    if (
      previousType !== SOURCES.serverSortType(quickSource, event.target.value)
    ) {
      void loadQuickCandidates();
    } else {
      renderQuickCandidates();
    }
  });

  $("mvQuickAdd")?.addEventListener("scroll", maybeLoadMoreQuickCandidates, {
    passive: true,
  });
  $("mvQuickVideoChannelPopover")?.addEventListener("scroll", maybeLoadMoreQuickCandidates, {
    passive: true,
  });
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      clampQuickSize();
      maybeLoadMoreQuickCandidates();
      positionMixerPresetPicker();
    });
    observer.observe($("mvQuickAdd"));
    observer.observe($("mvFramesFit"));
    observer.observe($("mvStage"));
  } else {
    window.addEventListener(
      "resize",
      () => {
        clampQuickSize();
        maybeLoadMoreQuickCandidates();
        positionMixerPresetPicker();
      },
      { passive: true },
    );
  }

  const quickResize = $("mvQuickResize");
  const quickHead = $("mvQuick")?.querySelector(".mv-quick-head");
  let quickMove = null;
  quickHead?.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      event.target.closest("button, input, a, [role='tab']")
    )
      return;
    const stage = quickStage().getBoundingClientRect();
    const panel = $("mvQuick").getBoundingClientRect();
    quickPosition.left = panel.left - stage.left;
    quickPosition.top = panel.top - stage.top;
    quickMove = {
      x: event.clientX,
      y: event.clientY,
      left: quickPosition.left,
      top: quickPosition.top,
    };
    quickHead.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  quickHead?.addEventListener("pointermove", (event) => {
    if (!quickMove || !quickHead.hasPointerCapture(event.pointerId)) return;
    quickPosition.left = quickMove.left + event.clientX - quickMove.x;
    quickPosition.top = quickMove.top + event.clientY - quickMove.y;
    clampQuickSize();
  });
  const finishQuickMove = () => {
    if (!quickMove) return;
    quickMove = null;
    saveQuickGeometry();
  };
  quickHead?.addEventListener("pointerup", finishQuickMove);
  quickHead?.addEventListener("pointercancel", finishQuickMove);
  quickHead?.addEventListener("lostpointercapture", finishQuickMove);
  let quickDrag = null;
  quickResize?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const bounds = $("mvQuick").getBoundingClientRect();
    quickDrag = {
      x: event.clientX,
      y: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
    quickResize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  quickResize?.addEventListener("pointermove", (event) => {
    if (!quickDrag || !quickResize.hasPointerCapture(event.pointerId)) return;
    quickSize.width =
      quickDrag.width +
      (event.clientX - quickDrag.x) * (quickPosition.left === null ? 2 : 1);
    quickSize.height = quickDrag.height + event.clientY - quickDrag.y;
    clampQuickSize();
  });
  const finishQuickResize = () => {
    if (!quickDrag) return;
    quickDrag = null;
    saveQuickGeometry();
  };
  quickResize?.addEventListener("pointerup", finishQuickResize);
  quickResize?.addEventListener("pointercancel", finishQuickResize);
  quickResize?.addEventListener("lostpointercapture", finishQuickResize);
  quickResize?.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 50 : 20;
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    const bounds = $("mvQuick").getBoundingClientRect();
    quickSize.width =
      (quickSize.width ?? bounds.width) +
      (event.key === "ArrowRight"
        ? step
        : event.key === "ArrowLeft"
          ? -step
          : 0);
    quickSize.height =
      (quickSize.height ?? bounds.height) +
      (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0);
    clampQuickSize();
    saveQuickGeometry();
    event.preventDefault();
  });

  function queueMixerGain(channelId, gain) {
    mixerGainDrafts.set(channelId, gain);
    if (mixerGainTimers.has(channelId)) return;
    mixerGainTimers.set(
      channelId,
      window.setTimeout(() => {
        mixerGainTimers.delete(channelId);
        sendMixerCommand(channelId, "MIXER_SET_GAIN", {
          gain: mixerGainDrafts.get(channelId),
        });
      }, 80),
    );
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
      if (
        !mixer ||
        !Number.isFinite(gain) ||
        gain < mixer.gainMin ||
        gain > mixer.gainMax
      )
        return;
      mixerDragId = mixerId;
      el.closest(".mv-mixer-gain")
        ?.querySelector("output")
        ?.replaceChildren(`${Math.round(gain * 100)}%`);
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
      // 전체 볼륨은 모든 칸의 실제 출력을 바꾼다 → 채널과 상단 아이콘을 맞춘다.
      syncAllVolumeButtons();
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
    syncVolumePanelButton();
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target?.id === "mvStatsCatchUp") {
      const previous = liveCatchUpEnabled;
      applyLiveCatchUpSetting(target.checked === true);
      void chrome.storage.local.set({ [LIVE_CATCH_UP_KEY]: liveCatchUpEnabled })
        .catch(() => applyLiveCatchUpSetting(previous));
      return;
    }
    if (target?.dataset?.mvMixerEnabled) {
      sendMixerCommand(target.dataset.mvMixerEnabled, "MIXER_SET_ENABLED", {
        enabled: target.checked === true,
      });
      target.checked = !target.checked;
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
    const syncPick = event.target?.closest?.("[data-mv-sync-pick]");
    if (syncPick) {
      setSyncSelected(syncPick.dataset.mvSyncPick, syncPick.checked === true);
      return;
    }
    if (event.target?.id !== "mvVolFocus") return;
    state.audioFocusMode = event.target.checked === true;
    // ⚠ 채널별 volume 값은 그대로 둔다. focus mode 를 껐을 때 이전 믹스를
    //   그대로 되찾을 수 있어야 한다. 바뀌는 것은 '지금 소리를 내는가' 뿐이다.
    postAllAudio();
    for (const channel of state.chosen) {
      if (effectiveMuted(channel.channelId))
        clearAudioNotice(channel.channelId);
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
    "FRAME_ENDED_CANCEL",
    "AUDIO_INTERACTION_REQUIRED",
    "AUDIO_INTERACTION_RESOLVED",
    "MULTIVIEW_STATS",
    "FRAME_SYNC_STATS",
    "FRAME_SYNC_COMMAND_RESULT",
    "FRAME_MIXER_STATE",
    "FRAME_MIXER_COMMAND_RESULT",
    "FRAME_AUDIO_STATE",
    "FRAME_USER_MUTE",
    "FRAME_QUALITY_STATE",
    "FRAME_QUALITY_COMMAND_RESULT",
    "FRAME_VOD_CHAT_PLAYBACK",
    "FRAME_AD_STATUS",
  ]);
  window.addEventListener("message", (event) => {
    if (!isTrustedFrameMessage(event)) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== MULTIVIEW_MESSAGE) return;
    if (!FRAME_MESSAGE_TYPES.has(data.type)) return;
    const channelId = String(data.channelId || "").toLowerCase();
    if (!SLOT_RE.test(channelId) || !cells.has(channelId)) return;
    // ⚠ 정말 그 칸의 프레임이 보낸 것인지 확인한다. 다른 프레임이 남의 channelId 로
    //   보내는 것을 막는다.
    const frame = cells.get(channelId)?.querySelector("iframe");
    if (!frame || event.source !== frame.contentWindow) return;

    if (data.type === "FRAME_AD_STATUS") {
      if (
        typeof data.adPlaying !== "boolean" ||
        typeof data.wideScreenOn !== "boolean"
      ) return;
      const cell = cells.get(channelId);
      if (!cell) return;
      cell.dataset.adPlaying = String(data.adPlaying);
      cell.dataset.wideScreenOn = String(data.wideScreenOn);
      if (data.wideScreenOn) {
        cell.dataset.widePromptPending = "false";
      } else if (data.adPlaying) {
        cell.dataset.widePromptPending = "true";
      }
      renderCellWidePrompt(channelId);
      return;
    }

    if (data.type === "FRAME_QUALITY_STATE") {
      if (!Number.isSafeInteger(data.requestId) || data.requestId <= 0 ||
          qualityRequestByChannel.get(channelId)?.requestId !== data.requestId) return;
      const pendingRequest = qualityRequestByChannel.get(channelId);
      if (pendingRequest?.timer) clearTimeout(pendingRequest.timer);
      qualityRequestByChannel.delete(channelId);
      const raw = data.state;
      if (!raw || typeof raw !== "object" || typeof raw.ready !== "boolean" ||
          !Array.isArray(raw.choices) || raw.choices.length > 24) return;
      const choices = [];
      const seen = new Set();
      for (const item of raw.choices) {
        if (!item || typeof item !== "object" || typeof item.value !== "string" ||
            typeof item.label !== "string" || item.label.length > 20) continue;
        const validValue = item.value === "auto" ||
          (/^\d{3,4}$/.test(item.value) && Number(item.value) >= 144 && Number(item.value) <= 4320);
        if (!validValue || seen.has(item.value)) continue;
        seen.add(item.value);
        choices.push({
          value: item.value,
          label: item.value === "auto" ? "자동" : `${Number(item.value)}p`,
          selected: item.selected === true,
        });
      }
      const selected = typeof raw.selected === "string" && seen.has(raw.selected)
        ? raw.selected : "";
      const lockedQuality = typeof raw.lockedQuality === "string" && seen.has(raw.lockedQuality)
        ? raw.lockedQuality : "";
      const output = typeof raw.output === "string" &&
        /^\d{1,4}×\d{1,4}$/.test(raw.output) ? raw.output : "";
      qualityByChannel.set(channelId, {
        ready: raw.ready && choices.length > 0,
        selected,
        output,
        locked: raw.locked === true && Boolean(lockedQuality),
        lockedQuality,
        choices,
      });
      if (raw.ready && !qualityPending.has(channelId)) qualityFeedback.delete(channelId);
      renderQuality();
      return;
    }

    if (data.type === "FRAME_QUALITY_COMMAND_RESULT") {
      if (!Number.isSafeInteger(data.commandId) || data.commandId <= 0 ||
          typeof data.quality !== "string" || typeof data.applied !== "boolean") return;
      const pending = qualityPending.get(channelId);
      if (!pending || pending.commandId !== data.commandId || pending.quality !== data.quality) return;
      clearTimeout(pending.timer);
      qualityPending.delete(channelId);
      if (data.applied) {
        qualityTransitions.set(channelId, Date.now());
        qualityFeedback.set(channelId, { text: "화질 변경을 요청했습니다.", error: false });
      } else {
        const messages = {
          "not-ready": "플레이어 화질 정보가 아직 준비되지 않았습니다.",
          unavailable: "현재 방송에서 사용할 수 없는 화질입니다.",
          "menu-unavailable": "화질 메뉴가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
          "quality-locked": "최대 화질 자동 고정 설정으로 변경할 수 없는 화질입니다.",
          "invalid-quality": "화질을 적용할 수 없습니다.",
          "no-video": "재생 영상을 찾지 못했습니다.",
        };
        qualityFeedback.set(channelId, {
          text: messages[data.reason] || "화질을 적용하지 못했습니다.",
          error: true,
        });
      }
      renderQuality();
      if (data.applied && !$("mvQualityPop").hidden) requestChannelQuality(channelId);
      return;
    }

    if (data.type === "FRAME_READY") {
      // 프레임이 새로 떴으면 따라잡기 멈춤 지시를 다시 보낸다.
      playerCatchUpHold.delete(channelId);
      if (currentStatus(channelId) === "ready" && !isVideoSlot(channelId)) {
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
      if (channelId === state.chatChannelId && isVideoChatSource(channelId))
        postVodChatControl(channelId, true, chatGeneration);
      return;
    }
    if (data.type === "FRAME_VOD_CHAT_PLAYBACK") {
      if (currentStatus(channelId) === "ready" &&
          typeof data.currentTime === "number" && Number.isFinite(data.currentTime) &&
          data.currentTime >= 0 && data.currentTime <= 1000000000 &&
          Number.isSafeInteger(data.chatGeneration)) {
        updateVodChatPlayback(data);
      }
      return;
    }
    if (data.type === "FRAME_ENDED") {
      // 방송 종료. 칸을 지우거나 다른 채널을 자동으로 메인으로 올리지 않는다.
      clearTimeout(frameTimers.get(channelId));
      frameTimers.delete(channelId);
      setCellStatus(channelId, "ended");
      return;
    }
    if (data.type === "FRAME_ENDED_CANCEL") {
      // 장비 재정비 안내였다(방송은 이어진다). 라이브 칸만 되돌린다.
      if (isVideoSlot(channelId) || currentStatus(channelId) !== "ended") return;
      setCellStatus(channelId, "ready");
      requestMixerState(channelId);
      return;
    }
    if (data.type === "FRAME_USER_MUTE") {
      if (currentStatus(channelId) !== "ready" || typeof data.muted !== "boolean") return;
      adoptFrameUserMute(channelId, data.muted);
      return;
    }
    if (data.type === "FRAME_AUDIO_STATE") {
      if (
        currentStatus(channelId) !== "ready" ||
        typeof data.volume !== "number" ||
        !Number.isFinite(data.volume) ||
        data.volume < 0 ||
        data.volume > 1
      ) return;
      const audio = audioOf(channelId);
      const expectedVolume = effectiveVolume(channelId);
      // 부모의 지시가 iframe에 반영되며 발생한 volumechange는 되돌려 받지 않는다.
      if (Math.abs(data.volume - expectedVolume) <= 0.005) return;
      // 전체 볼륨이 0이면 iframe의 출력값만으로 채널별 값을 역산할 수 없다.
      if (state.masterVolume <= 0) {
        postState(channelId, channelId === state.mainId);
        return;
      }
      audio.volume = Math.min(1, Math.max(0, data.volume / state.masterVolume));
      const slider = [...document.querySelectorAll("[data-mv-vol-channel]")].find(
        (element) => element.dataset.mvVolChannel === channelId,
      );
      if (slider) {
        slider.value = String(Math.round(audio.volume * 100));
        slider.parentElement?.querySelector(".mv-vol-pct")?.replaceChildren(pct(audio.volume));
      }
      syncVolumeButton(channelId);
      syncVolumePanelButton();
      // 채널값이 100%를 넘어 역산된 경우에는 기존 전체×채널 상한을 다시 적용한다.
      if (data.volume / state.masterVolume > 1) {
        postState(channelId, channelId === state.mainId);
      }
      return;
    }
    if (data.type === "FRAME_MIXER_STATE") {
      if (currentStatus(channelId) === "ready")
        acceptMixerSnapshot(channelId, data.state);
      return;
    }
    if (data.type === "FRAME_MIXER_COMMAND_RESULT") {
      if (
        currentStatus(channelId) !== "ready" ||
        typeof data.command !== "string" ||
        !Number.isSafeInteger(data.commandId)
      )
        return;
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
          "interaction-required":
            "플레이어에서 한 번 상호작용한 뒤 다시 시도해 주세요.",
          "invalid-preset": "프리셋을 적용하지 못했습니다.",
          "invalid-gain": "게인 값을 적용하지 못했습니다.",
        };
        mixerErrors.set(
          channelId,
          messages[data.reason] || "오디오 믹서 명령을 적용하지 못했습니다.",
        );
      }
      if (
        !acceptMixerSnapshot(channelId, data.state) &&
        mixerDragId !== channelId
      )
        renderVolume();
      return;
    }
    if (data.type === "FRAME_SYNC_COMMAND_RESULT") {
      if (currentStatus(channelId) === "ready")
        finishSyncCommand(channelId, data);
      return;
    }
    if (data.type === "FRAME_SYNC_STATS") {
      if (isVideoSlot(channelId)) return;
      if (currentStatus(channelId) !== "ready") return;
      const stats = SYNC.normalize(data.stats);
      if (!stats) return;
      const previousGeneration = syncGeneration.get(channelId);
      if (
        stats.generation !== null &&
        previousGeneration !== undefined &&
        stats.generation < previousGeneration
      )
        return;
      if (
        stats.generation !== null &&
        previousGeneration !== stats.generation
      ) {
        requestMixerState(channelId);
        const generationAt = stats.receivedAt;
        recordSyncDiagnostic(
          "generation-change",
          {
            channelId,
            channelName: syncChannelName(channelId),
            from: previousGeneration ?? null,
            to: stats.generation,
          },
          generationAt,
        );
        recordSyncDiagnostic(
          "settling-start",
          {
            channelId,
            channelName: syncChannelName(channelId),
            generation: stats.generation,
            cause:
              previousGeneration === undefined
                ? "first-video"
                : "video-replaced",
          },
          generationAt,
        );
        cancelPendingSync(channelId);
        for (const command of [
          "seek",
          "nudge",
          "rate",
          "reset-rate",
          "catch-up",
        ]) {
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
      if (stats.generation !== null)
        syncGeneration.set(channelId, stats.generation);
      const pendingRate = pendingSync(channelId, "rate");
      const pendingReset = pendingSync(channelId, "reset-rate");
      if (!pendingRate && !pendingReset) {
        const parentOwnedRate = syncRates.has(channelId);
        if (stats.syncRateOwned && Number.isFinite(stats.playbackRate)) {
          syncRates.set(channelId, stats.playbackRate);
          if (!parentOwnedRate) {
            recordSyncDiagnostic(
              "rate-reconciled",
              {
                channelId,
                channelName: syncChannelName(channelId),
                playbackRate: stats.playbackRate,
                direction: "frame-to-parent",
              },
              stats.receivedAt,
            );
          }
        } else if (!stats.syncRateOwned) {
          syncRates.delete(channelId);
          if (parentOwnedRate) {
            recordSyncDiagnostic(
              "rate-reconciled",
              {
                channelId,
                channelName: syncChannelName(channelId),
                playbackRate: stats.playbackRate,
                direction: "frame-cleared-parent",
              },
              stats.receivedAt,
            );
          }
        }
      }
      const previousStats = syncStats.get(channelId);
      syncStats.set(channelId, stats);
      // 새 측정값도 곧바로 같은 정렬 기준(송출 시각/가장자리)을 갖게 한다.
      applySyncAlignDelays(stats.receivedAt);
      observeCatchUpSample(channelId, previousStats, stats);
      recordSyncSample(channelId, stats, stats.receivedAt);
      const activeSyncMode =
        state.sync.scope === "groups"
          ? syncGroupForChannel(channelId)?.mode
          : state.sync.mode;
      if (activeSyncMode !== "auto" && stats.syncRateOwned)
        resetSyncRate(channelId);
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
    resetLiveCatchUp();
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
      catchUpOverSince.clear();
    } else {
      const now = Date.now();
      for (const c of state.chosen) {
        if (currentStatus(c.channelId) !== "ready") continue;
        syncReadyAt.set(c.channelId, now);
        // 가려진 동안 Chrome 이 음소거 칸의 재생을 늦춰 지연이 30초대로 튄다(실측).
        // 치지직이 스스로 복귀하는 경우가 많아 안정화(settlingMs) 뒤 남은 지연만 옮긴다.
        if (c.mediaType !== "video") catchUpUrgent.add(c.channelId);
        recordSyncDiagnostic(
          "settling-start",
          {
            channelId: c.channelId,
            channelName: c.channelName || "",
            generation: syncGeneration.get(c.channelId) ?? null,
            cause: "tab-visible",
          },
          changedAt,
        );
      }
      if (syncCongestion.active)
        recordCongestionChange(false, syncEligibleIds(), changedAt);
      syncCongestion = { active: false, since: 0 };
      state.sync.congested = false;
    }
    updateSyncPolling();
  });

  // 채팅 칸이 준비되면 덮개를 걷고 테마를 보낸다(채널을 바꿔 새로 뜰 때마다 온다).
  window.addEventListener("message", (event) => {
    if (!isTrustedFrameMessage(event)) return;
    const data = event.data;
    if (data?.source !== MULTIVIEW_MESSAGE) return;
    // ⚠ 정말 채팅 프레임이 보낸 것인지 확인한다.
    const frame = $("mvChatFrame");
    if (
      !frame ||
      event.source !== frame.contentWindow ||
      data.channelId !== state.chatChannelId ||
      data.generation !== chatGeneration
    ) return;
    if (data.type !== "CHAT_FRAME_READY") return;
    chatFrameReady = true;
    clearTimeout(chatReadyTimer);
    setChatStatus("ready");
    postChatView();
  });

  (async () => {
    // 주소로 받은 id 에 해당하는 구성만 읽는다(탭마다 다르다).
    const handoffId = HOSTED_ON_CHZZK
      ? String(globalThis.__cheeseMultiviewHost?.setupId || "")
      : new URLSearchParams(location.search).get("setup") || "";
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
