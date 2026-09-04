(async function initializeChzzkCafeNow() {
  try {
    const data = await chrome.storage.local.get("cheeseMasterEnabled");
    if (data?.cheeseMasterEnabled === false) return;
  } catch {}
  const api = globalThis.CheeseCafeClipApi;
  if (!api) return;

  // ⚠ 글쓰기·수정 화면에서는 링크를 플레이어로 바꾸지 않는다. 작성 중인 본문의 DOM 을
  // 건드리면 에디터 상태가 어긋나고, 인라인 재생이 글쓰기를 방해한다.
  // (all_frames 라 에디터 iframe 안에서도 이 스크립트가 돈다.)
  function isWriteUrl(url) {
    return (
      /\/articles\/write/i.test(url) || // /ca-fe/cafes/{id}/articles/write
      // ⚠ 수정 화면의 실제 경로는 /modify 다(제보로 확인:
      //    /ca-fe/cafes/31342874/articles/8/modify). 예전엔 /edit 만 막고 있어
      //    수정 화면에서 본문이 사라지는 문제가 남아 있었다. 둘 다 막는다.
      /\/articles\/\d+\/(?:edit|modify)/i.test(url) ||
      /ArticleWrite|ArticleUpdate|ArticleModify/i.test(url) // 구 에디터
    );
  }
  function isCafeWritePage() {
    if (isWriteUrl(`${location.pathname}${location.search}`)) return true;
    // 에디터가 iframe 안에서 뜨면 프레임 URL 에는 write 경로가 없을 수 있다.
    // 같은 출처면 상위 프레임 주소로, 아니면 referrer 로 한 번 더 확인한다.
    try {
      const top = window.top;
      if (top && top !== window && top.location.href) {
        if (isWriteUrl(top.location.href)) return true;
      }
    } catch {
      // 교차 출처 상위 프레임 — referrer 로 폴백한다.
    }
    return isWriteUrl(document.referrer || "");
  }
  if (isCafeWritePage()) return;

  const OGLINK_SELECTOR = "div.se-component.se-oglink";
  const OGLINK_THUMBNAIL_SELECTOR = ".se-oglink-thumbnail";
  const OGLINK_TITLE_SELECTOR = ".se-oglink-title";
  const CANDIDATE_SELECTOR =
    "a[href], [data-url], [data-link-url], [data-href]";
  const PLAYER_CONTAINER_SELECTOR =
    ".cheese-cafe-standalone, .cheese-cafe-oglink";
  const TEXT_COMPONENT_SELECTOR = "div.se-component.se-text";
  const TEXT_PARAGRAPH_SELECTOR = ".se-text-paragraph";
  const PLAYER_SELECTOR = "[data-cheese-cafe-player]";
  const STANDALONE_PLAYER_SELECTOR = "[data-cheese-cafe-standalone]";
  const CHZZK_ICON_URL = "https://chzzk.naver.com/favicon.ico";
  const CAFE_NOW_KEY = "cheeseCafeNow";
  const CAFE_NOW_AUTOPLAY_KEY = "cheeseCafeNowAutoplay";
  const CAFE_NOW_AUTOPLAY_MUTED_KEY = "cheeseCafeNowAutoplayMuted";
  const CAFE_CLIP_PLAYBACK_MESSAGE = "cheese-platter-cafe-clip-playback";
  const AUTOPLAY_START_RATIO = 0.55;
  const AUTOPLAY_KEEP_RATIO = 0.2;
  const AUTOPLAY_SWITCH_MARGIN = 0.15;
  const AUTOPLAY_RELEASE_DELAY_MS = 30000;

  const OBSERVED_ATTRIBUTES = [
    "href",
    "data-url",
    "data-link-url",
    "data-href",
  ];

  let scanQueued = false;
  let autoplayEvaluationQueued = false;
  let cafeAutoplayEnabled = false;
  let cafeAutoplayMuted = true;
  let autoplayObserver = null;
  let activeAutoplayPlayer = null;
  let autoplayVisibilityListenerBound = false;
  let playbackMessageListenerBound = false;
  // 사용자가 클립 플레이어를 한 번이라도 직접 조작했는지. embed 가 보내는 activated
  // 신호를 받아 두어 진단·향후 폴백에 쓴다.
  let clipOriginActivated = false;
  const pendingRoots = new Set();
  const metadataRequests = new Map();
  const metadataCache = new Map();
  const thumbnailDimensionRequests = new Map();
  const oglinkStates = new WeakMap();
  const autoplayVisibility = new Map();
  const autoplayReleaseTimers = new WeakMap();
  // 중복 링크 정리 대기 키(스캔 1회당 한 번에 처리).
  const pendingCleanupKeys = new Set();

  // ⚠ 위 세 Map(metadataRequests·metadataCache·thumbnailDimensionRequests)은 키가
  //   mediaKey·이미지 URL 이라 WeakMap 으로 못 바꾼다. 상한이 없으면 글이 많은 게시판을
  //   길게 스크롤할수록 계속 쌓인다(응답 객체·Promise 를 붙잡는다). 원본 확장과 같은
  //   방식으로 LRU 상한을 둔다.
  // Map 은 삽입 순서를 지키므로 가장 오래된 항목부터 덜어내면 LRU 가 된다.
  const CACHE_LIMIT = 200;
  function setWithLimit(cache, key, value) {
    cache.delete(key);
    cache.set(key, value);

    while (cache.size > CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }

    return value;
  }

  function getCandidateValues(element) {
    const values = OBSERVED_ATTRIBUTES.map((attribute) =>
      element.getAttribute(attribute),
    );

    if (element instanceof HTMLAnchorElement) {
      values.push(element.href);
    }

    return values.filter(Boolean);
  }

  function getCandidateMedia(element) {
    for (const value of getCandidateValues(element)) {
      const media = api.extractMedia(value);
      if (media) {
        return {
          media,
          mediaKey: api.getMediaKey(media),
          mediaUrl: getMediaUrl(element, media),
        };
      }
    }

    return null;
  }

  function getMediaUrl(element, media) {
    for (const value of getCandidateValues(element)) {
      if (!api.isSameMedia(api.extractMedia(value), media)) continue;

      try {
        const url = new URL(value);
        if (url.hostname === "chzzk.naver.com") return url.href;
      } catch {
        // Use the canonical media URL for encoded redirect URLs.
      }
    }

    return api.getMediaUrl(media);
  }

  function normalizeVisibleText(value) {
    return String(value || "")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getPlayerMedia(player) {
    if (!(player instanceof HTMLElement)) return null;
    const type = String(player.dataset.cheeseCafeMediaType || "");
    const id = String(player.dataset.cheeseCafeMediaId || "");
    return type && id ? { type, id } : null;
  }

  function postPlayerCommand(frame, action) {
    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        source: CAFE_CLIP_PLAYBACK_MESSAGE,
        action,
        muted: cafeAutoplayMuted,
      },
      "https://chzzk.naver.com",
    );
  }

  // 우리 클립이 재생을 시작하면 같은 문서의 다른 재생 중인 영상(네이버 카페 자체 동영상
  // 등)을 멈춘다. 우리 자동재생 관리자는 우리 플레이어만 추적하므로, 이게 없으면 카페
  // 동영상과 클립 소리가 겹쳐 들린다. 크로스 오리진 iframe 내부는 건드릴 수 없어
  // 같은 문서의 <video> 만 대상으로 한다.
  function pauseOtherDocumentVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (!(video instanceof HTMLVideoElement) || video.paused) return;
      if (video.closest(PLAYER_SELECTOR)) return; // 우리 플레이어는 제외
      try {
        video.pause();
      } catch {}
    });
  }

  // 다른 클립 플레이어 정지. iframe 내부는 크로스 오리진이라 postMessage 로만 멈춘다.
  function pauseOtherClipPlayers(exceptPlayer) {
    document.querySelectorAll(PLAYER_SELECTOR).forEach((player) => {
      if (player === exceptPlayer || !(player instanceof HTMLElement)) return;
      const frame = player.querySelector(
        ":scope iframe.cheese-cafe-player__frame",
      );
      if (!(frame instanceof HTMLIFrameElement)) return;
      postPlayerCommand(frame, "pause");
      player.dataset.cheeseCafeAutoplayMode = "idle";
      if (activeAutoplayPlayer === player) activeAutoplayPlayer = null;
    });
  }

  function createPlayerFrame(player, media, options = {}) {
    const frame = document.createElement("iframe");
    frame.className = "cheese-cafe-player__frame";
    frame.src = api.getEmbedUrl(media, {
      autoPlay: options.autoPlay === true,
      // 음소거 여부는 사용자 설정을 그대로 따른다. 다만 브라우저 자동재생 정책상
      // 사용자 제스처 전에는 소리 있는 재생이 거부되므로, 그때는 embed 쪽
      // (cafeClipPlayback.js)이 음소거 자동재생으로 전환하고 이후 사용자가 플레이어를
      // 조작하면 소리를 켠다.
      muted: options.autoPlay === true && cafeAutoplayMuted,
    });
    frame.title = "CHZZK Player";
    frame.frameBorder = "0";
    frame.loading = options.autoPlay === true ? "eager" : "lazy";
    frame.allow = "autoplay; clipboard-write; web-share";
    frame.allowFullscreen = true;
    frame.addEventListener("load", () => {
      if (!cafeAutoplayEnabled || !frame.isConnected) return;
      const action =
        player.dataset.cheeseCafeAutoplayMode === "active" ? "play" : "pause";
      postPlayerCommand(frame, action);
    });
    return frame;
  }

  function mountPlayerFrame(player, options = {}) {
    if (!(player instanceof HTMLElement)) return null;
    const currentFrame = player.querySelector(
      ":scope iframe.cheese-cafe-player__frame",
    );
    if (currentFrame instanceof HTMLIFrameElement) return currentFrame;

    const frameWrap = player.querySelector(
      ":scope .cheese-cafe-player__frame-wrap",
    );
    const media = getPlayerMedia(player);
    if (!(frameWrap instanceof HTMLElement) || !media) return null;

    const autoPlay = options.autoPlay === true;
    const frame = createPlayerFrame(player, media, { autoPlay });
    player.dataset.cheeseCafeEmbedLoaded = "true";
    player.dataset.cheeseCafeAutoplayInitialized = autoPlay ? "true" : "false";
    frameWrap.append(frame);
    return frame;
  }

  function clearAutoplayRelease(player) {
    const timer = autoplayReleaseTimers.get(player);
    if (timer) clearTimeout(timer);
    autoplayReleaseTimers.delete(player);
  }

  // ⚠ iframe 요소를 클로저에 붙잡지 않는다. 이 타이머는 플레이어가 화면에 보이는
  //   동안 30초마다 스스로 다시 예약되는데, 예전에는 처음 받은 frame 을 그대로
  //   넘겨 재예약했다. 그 사이 프레임이 교체되면(setPlayerAutoplay → 재마운트)
  //   떨어져 나간 옛 iframe 이 타이머 클로저에 남아 회수되지 않는다. 발화 시점에
  //   현재 프레임을 다시 찾는다.
  function currentPlayerFrame(player) {
    const frame = player.querySelector(
      ":scope iframe.cheese-cafe-player__frame",
    );
    return frame instanceof HTMLIFrameElement ? frame : null;
  }

  function scheduleAutoplayRelease(player) {
    clearAutoplayRelease(player);
    const timer = window.setTimeout(() => {
      autoplayReleaseTimers.delete(player);
      if (
        !cafeAutoplayEnabled ||
        !player.isConnected ||
        player.dataset.cheeseCafeAutoplayMode !== "idle"
      ) {
        return;
      }

      if ((autoplayVisibility.get(player) || 0) > 0) {
        scheduleAutoplayRelease(player);
        return;
      }

      // 제거 전에 정리 신호를 보낸다 — iframe 이 떨어져 나가면 pagehide 가 안 올 수 있어
      // embed 쪽 타이머·리스너가 남는다.
      const frame = currentPlayerFrame(player);
      if (frame?.isConnected) {
        postPlayerCommand(frame, "release");
        frame.remove();
      }
      player.dataset.cheeseCafeAutoplayInitialized = "false";
      player.dataset.cheeseCafeEmbedLoaded = "false";
    }, AUTOPLAY_RELEASE_DELAY_MS);
    autoplayReleaseTimers.set(player, timer);
  }

  function ensurePlayerEmbedLoaded(player) {
    if (!(player instanceof HTMLElement)) return;
    if (player.dataset.cheeseCafeEmbedLoaded === "true") return;
    mountPlayerFrame(player);
  }

  function setPlayerAutoplay(player, active) {
    if (!(player instanceof HTMLElement)) return;
    // 사용자가 직접 멈춘 플레이어는 다시 자동재생하지 않는다(스크롤로 재진입해도).
    if (active && player.dataset.cheeseCafeUserPaused === "true") return;

    const mode = active ? "active" : "idle";
    if (player.dataset.cheeseCafeAutoplayMode === mode) return;
    player.dataset.cheeseCafeAutoplayMode = mode;
    if (!active) {
      const frame = currentPlayerFrame(player);
      if (frame && player.dataset.cheeseCafeAutoplayInitialized === "true") {
        postPlayerCommand(frame, "pause");
        scheduleAutoplayRelease(player);
      }
      return;
    }

    clearAutoplayRelease(player);
    const currentFrame = player.querySelector(
      ":scope iframe.cheese-cafe-player__frame",
    );
    if (
      currentFrame instanceof HTMLIFrameElement &&
      player.dataset.cheeseCafeAutoplayInitialized === "true"
    ) {
      postPlayerCommand(currentFrame, "play");
      return;
    }

    // Navigating an already connected iframe adds entries to the browser's
    // joint session history. Mount a fresh iframe with its final URL instead.
    if (currentFrame instanceof HTMLIFrameElement) {
      postPlayerCommand(currentFrame, "release"); // localStorage 원복 유도
    }
    currentFrame?.remove();
    player.dataset.cheeseCafeEmbedLoaded = "false";
    player.dataset.cheeseCafeAutoplayInitialized = "false";
    mountPlayerFrame(player, { autoPlay: true });
  }

  function cleanupAutoplayPlayers() {
    for (const player of autoplayVisibility.keys()) {
      if (player.isConnected) continue;
      clearAutoplayRelease(player);
      autoplayObserver?.unobserve(player);
      autoplayVisibility.delete(player);
      if (activeAutoplayPlayer === player) activeAutoplayPlayer = null;
    }
  }

  function evaluateAutoplayPlayer() {
    autoplayEvaluationQueued = false;
    if (!cafeAutoplayEnabled) return;

    cleanupAutoplayPlayers();
    if (document.hidden) {
      if (activeAutoplayPlayer) setPlayerAutoplay(activeAutoplayPlayer, false);
      activeAutoplayPlayer = null;
      return;
    }

    let candidate = null;
    let candidateRatio = 0;
    for (const [player, ratio] of autoplayVisibility) {
      if (ratio < AUTOPLAY_START_RATIO || ratio <= candidateRatio) continue;
      candidate = player;
      candidateRatio = ratio;
    }

    const activeRatio = activeAutoplayPlayer
      ? autoplayVisibility.get(activeAutoplayPlayer) || 0
      : 0;
    const keepActive =
      activeAutoplayPlayer?.isConnected &&
      activeRatio >= AUTOPLAY_KEEP_RATIO &&
      (!candidate ||
        candidate === activeAutoplayPlayer ||
        candidateRatio < activeRatio + AUTOPLAY_SWITCH_MARGIN);
    if (keepActive) {
      for (const [player, ratio] of autoplayVisibility) {
        if (player !== activeAutoplayPlayer && ratio > 0) {
          ensurePlayerEmbedLoaded(player);
        }
      }
      return;
    }

    if (activeAutoplayPlayer && activeAutoplayPlayer !== candidate) {
      setPlayerAutoplay(activeAutoplayPlayer, false);
    }
    activeAutoplayPlayer = candidate;
    if (candidate) setPlayerAutoplay(candidate, true);
    for (const [player, ratio] of autoplayVisibility) {
      if (player !== candidate && ratio > 0) ensurePlayerEmbedLoaded(player);
    }
  }

  function scheduleAutoplayEvaluation() {
    if (!cafeAutoplayEnabled || autoplayEvaluationQueued) return;
    autoplayEvaluationQueued = true;
    requestAnimationFrame(evaluateAutoplayPlayer);
  }

  function ensureAutoplayObserver() {
    if (
      !cafeAutoplayEnabled ||
      autoplayObserver ||
      typeof IntersectionObserver !== "function"
    ) {
      return;
    }
    autoplayObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          autoplayVisibility.set(
            entry.target,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        });
        scheduleAutoplayEvaluation();
      },
      { threshold: [0, AUTOPLAY_KEEP_RATIO, AUTOPLAY_START_RATIO, 0.75, 1] },
    );
  }

  function registerAutoplayPlayer(player) {
    if (!cafeAutoplayEnabled || !(player instanceof HTMLElement)) return;
    ensureAutoplayObserver();
    if (!autoplayObserver || autoplayVisibility.has(player)) return;
    autoplayVisibility.set(player, 0);
    autoplayObserver.observe(player);
  }

  // embed(cafeClipPlayback.js)가 보내는 재생 상태 알림 처리.
  //  - user-paused: 사용자가 직접 멈춤 → 자동재생 대상에서 제외
  //  - playing: 재생 시작 → 카페의 다른 재생 중인 영상 정지(소리 겹침 방지)
  //  - activated: 사용자가 클립을 직접 조작함 → 이후 클립은 소리 있게 시작
  function handlePlaybackMessage(event) {
    const name = event.data?.event;
    if (
      event.data?.source !== CAFE_CLIP_PLAYBACK_MESSAGE ||
      (name !== "user-paused" && name !== "playing" && name !== "activated")
    ) {
      return;
    }
    try {
      if (new URL(event.origin).hostname !== "chzzk.naver.com") return;
    } catch {
      return;
    }

    if (name === "activated") {
      clipOriginActivated = true;
      return;
    }

    const frames = document.querySelectorAll(
      "iframe.cheese-cafe-player__frame",
    );
    for (const frame of frames) {
      if (frame.contentWindow !== event.source) continue;
      const player = frame.closest(PLAYER_SELECTOR);
      if (!(player instanceof HTMLElement)) return;

      if (name === "playing") {
        // 이 클립이 재생 중이므로 다른 클립·카페 동영상을 멈춘다.
        pauseOtherDocumentVideos();
        pauseOtherClipPlayers(player);
        // 사용자가 직접 재생을 눌렀다면 이전 '직접 멈춤' 표시는 해제한다.
        delete player.dataset.cheeseCafeUserPaused;
        return;
      }

      player.dataset.cheeseCafeUserPaused = "true";
      player.dataset.cheeseCafeAutoplayMode = "idle";
      if (activeAutoplayPlayer === player) activeAutoplayPlayer = null;
      clearAutoplayRelease(player);
      return;
    }
  }

  function startAutoplayManager() {
    if (!cafeAutoplayEnabled) return;
    ensureAutoplayObserver();
    if (!playbackMessageListenerBound) {
      window.addEventListener("message", handlePlaybackMessage);
      playbackMessageListenerBound = true;
    }
    document.querySelectorAll(PLAYER_SELECTOR).forEach(registerAutoplayPlayer);
    if (!autoplayVisibilityListenerBound) {
      document.addEventListener("visibilitychange", scheduleAutoplayEvaluation);
      autoplayVisibilityListenerBound = true;
    }
    scheduleAutoplayEvaluation();
  }

  function stopAutoplayManager() {
    if (activeAutoplayPlayer) {
      setPlayerAutoplay(activeAutoplayPlayer, false);
    }
    activeAutoplayPlayer = null;
    autoplayObserver?.disconnect();
    autoplayObserver = null;
    document.querySelectorAll(PLAYER_SELECTOR).forEach((player) => {
      clearAutoplayRelease(player);
      ensurePlayerEmbedLoaded(player);
    });
    autoplayVisibility.clear();
    if (autoplayVisibilityListenerBound) {
      document.removeEventListener(
        "visibilitychange",
        scheduleAutoplayEvaluation,
      );
      autoplayVisibilityListenerBound = false;
    }
    if (playbackMessageListenerBound) {
      window.removeEventListener("message", handlePlaybackMessage);
      playbackMessageListenerBound = false;
    }
  }

  function setCafeAutoplayEnabled(enabled) {
    const nextEnabled = enabled === true;
    const changed = cafeAutoplayEnabled !== nextEnabled;
    cafeAutoplayEnabled = nextEnabled;
    if (!started) return;
    if (nextEnabled) {
      startAutoplayManager();
    } else if (changed || autoplayObserver || activeAutoplayPlayer) {
      stopAutoplayManager();
    }
  }

  function setCafeAutoplayMuted(muted) {
    cafeAutoplayMuted = muted !== false;
    if (started && activeAutoplayPlayer) {
      const frame = activeAutoplayPlayer.querySelector(
        ":scope iframe.cheese-cafe-player__frame",
      );
      postPlayerCommand(frame, "play");
    }
  }

  function createPlayer(media) {
    const mediaKey = api.getMediaKey(media);
    const wrapper = document.createElement("div");
    wrapper.className = "cheese-cafe-player";
    wrapper.dataset.cheeseCafePlayer = mediaKey;
    wrapper.dataset.cheeseCafeMediaType = media.type;
    wrapper.dataset.cheeseCafeMediaId = media.id;

    const frameWrap = document.createElement("div");
    frameWrap.className = "cheese-cafe-player__frame-wrap";

    const deferInitialLoad =
      cafeAutoplayEnabled && typeof IntersectionObserver === "function";
    wrapper.dataset.cheeseCafeEmbedLoaded = "false";
    wrapper.dataset.cheeseCafeAutoplayMode = "idle";
    wrapper.dataset.cheeseCafeAutoplayInitialized = "false";
    wrapper.append(frameWrap);
    if (!deferInitialLoad) mountPlayerFrame(wrapper);
    queueMicrotask(() => {
      if (wrapper.isConnected) registerAutoplayPlayer(wrapper);
    });

    return wrapper;
  }

  function getMetadataDimension(metadata, key) {
    const value = Number(metadata?.[key]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function getMetadataDimensions(metadata) {
    const width = getMetadataDimension(metadata, "width");
    const height = getMetadataDimension(metadata, "height");
    return width && height ? { width, height } : null;
  }

  function getPlayers(root) {
    const players = [];
    if (root instanceof Element && root.matches(PLAYER_SELECTOR)) {
      players.push(root);
    }
    if (root instanceof Document || root instanceof Element) {
      players.push(...root.querySelectorAll(PLAYER_SELECTOR));
    }

    return players;
  }

  function applyPlayerOrientation(root, dimensions) {
    if (!dimensions) return;

    const isPortrait = dimensions.height > dimensions.width;
    const orientation = isPortrait ? "portrait" : "landscape";
    getPlayers(root).forEach((player) => {
      if (!player.isConnected) return;
      player.classList.toggle("cheese-cafe-player--portrait", isPortrait);
      player.dataset.cheeseCafeOrientation = orientation;

      const container = player.closest(PLAYER_CONTAINER_SELECTOR);
      if (container) {
        container.classList.toggle("cheese-cafe-portrait", isPortrait);
        container.dataset.cheeseCafeOrientation = orientation;
      }
    });
  }

  function loadThumbnailDimensions(thumbnailImageUrl) {
    if (!thumbnailImageUrl) return Promise.resolve(null);
    if (!thumbnailDimensionRequests.has(thumbnailImageUrl)) {
      setWithLimit(
        thumbnailDimensionRequests,
        thumbnailImageUrl,
        new Promise((resolve) => {
          const image = new Image();
          image.decoding = "async";
          image.referrerPolicy = "no-referrer";
          image.onload = () => {
            const width = getMetadataDimension(image, "naturalWidth");
            const height = getMetadataDimension(image, "naturalHeight");
            resolve(width && height ? { width, height } : null);
          };
          image.onerror = () => resolve(null);
          image.src = thumbnailImageUrl;
        }),
      );
    }

    return thumbnailDimensionRequests.get(thumbnailImageUrl);
  }

  function updatePlayerLayout(root, metadata) {
    if (!metadata) return;

    const metadataDimensions = getMetadataDimensions(metadata);
    if (metadataDimensions) {
      applyPlayerOrientation(root, metadataDimensions);
      return;
    }

    if (!metadata.thumbnailImageUrl) return;
    loadThumbnailDimensions(metadata.thumbnailImageUrl).then(
      (thumbnailDimensions) => {
        applyPlayerOrientation(root, thumbnailDimensions);
      },
    );
  }

  function findOglinkThumbnail(oglink) {
    const thumbnail = oglink.querySelector(OGLINK_THUMBNAIL_SELECTOR);
    if (thumbnail) return thumbnail;

    return [...oglink.querySelectorAll("img")].find(
      (image) => !image.closest(".se-oglink-info"),
    );
  }

  function replaceOrInsertOglinkPlayer(oglink, media, thumbnail) {
    // 우리 플레이어 또는 원본 확장(data-chzzk-cafe-now-player)이 이미 이 오글링크에
    // 있으면 건드리지 않는다 — 원본이 늦게 부팅해 같은 오글링크를 처리한 경우에도
    // title 을 서로 덮어쓰는 핑퐁을 막는다.
    if (
      oglink.querySelector(
        "[data-cheese-cafe-player], [data-chzzk-cafe-now-player]",
      )
    )
      return;

    const player = createPlayer(media);
    // 삽입 직전 다시 한 번 확인(레이스 방어).
    if (
      oglink.querySelector(
        "[data-cheese-cafe-player], [data-chzzk-cafe-now-player]",
      )
    )
      return;
    if (thumbnail) {
      thumbnail.replaceWith(player);
      return;
    }

    const info = oglink.querySelector(".se-oglink-info");
    if (info) {
      info.before(player);
      return;
    }

    const container = oglink.querySelector(
      ".se-module-oglink, .se-oglink-container, .se-section-oglink",
    );
    if (container) container.prepend(player);
  }

  function getStandaloneClip(component) {
    const links = [...component.querySelectorAll(CANDIDATE_SELECTOR)]
      .filter((element) => !element.closest(STANDALONE_PLAYER_SELECTOR))
      .map((element) => ({
        element,
        candidate: getCandidateMedia(element),
      }))
      .filter(({ candidate }) => candidate);
    if (links.length !== 1) return null;

    const { element, candidate } = links[0];

    const paragraph =
      element.closest(".se-text-paragraph") || element.parentElement;
    const visibleText = normalizeVisibleText(
      paragraph?.innerText || paragraph?.textContent,
    );
    const linkText = normalizeVisibleText(element.textContent);
    const canonicalText = normalizeVisibleText(
      api.getMediaUrl(candidate.media),
    );
    const mediaUrlText = normalizeVisibleText(candidate.mediaUrl);
    if (
      visibleText !== linkText &&
      visibleText !== canonicalText &&
      visibleText !== mediaUrlText
    ) {
      return null;
    }

    const componentText = normalizeVisibleText(
      component.innerText || component.textContent,
    );

    return {
      media: candidate.media,
      mediaKey: candidate.mediaKey,
      mediaUrl: candidate.mediaUrl,
      target:
        componentText === visibleText ? component : paragraph || component,
    };
  }

  // ⚠ 여기서 바로 지우지 않고 키만 모아 둔다(원본 확장과 같은 방식). 예전에는 클립
  //   하나를 변환할 때마다 문서 전체를 두 번씩(standalone 표식 + 본문 문단) 훑어서,
  //   한 글에 클립이 N 개면 문서 전체 질의가 2N 번 돌았다. 스캔이 끝날 때 한 번만
  //   훑도록 모아 처리한다.
  function removeStandaloneClipComponents(mediaKey) {
    pendingCleanupKeys.add(mediaKey);
  }

  function flushStandaloneClipCleanup() {
    if (!pendingCleanupKeys.size) return;

    const mediaKeys = new Set(pendingCleanupKeys);
    pendingCleanupKeys.clear();

    mediaKeys.forEach((mediaKey) => {
      document
        .querySelectorAll(`[data-cheese-cafe-standalone="${mediaKey}"]`)
        .forEach((component) => component.remove());
    });

    // 한 se-text 컴포넌트 안에 `본문 문단 + 링크 전용 문단`이 함께 있을 수 있다.
    // getStandaloneClip(component)는 이때 링크 문단을 target으로 돌려주는데, 예전 코드는
    // target을 무시하고 component 전체를 지워 위쪽 본문까지 사라지게 했다. DOM을 지우기
    // 전에 실제 target만 수집하고, 부모·자식이 함께 잡힌 경우에는 가장 바깥 target만 지운다.
    const targets = new Set();
    document
      .querySelectorAll(
        `${TEXT_COMPONENT_SELECTOR}, ${TEXT_PARAGRAPH_SELECTOR}`,
      )
      .forEach((container) => {
        if (!container.isConnected) return;
        const standalone = getStandaloneClip(container);
        if (
          standalone &&
          mediaKeys.has(standalone.mediaKey) &&
          standalone.target instanceof Element
        ) {
          targets.add(standalone.target);
        }
      });

    const removals = [...targets].filter(
      (target) =>
        ![...targets].some(
          (other) => other !== target && other.contains(target),
        ),
    );
    removals.forEach((target) => target.remove());
  }

  function hasOglinkForMedia(mediaKey) {
    return [...document.querySelectorAll(OGLINK_SELECTOR)].some(
      (oglink) =>
        !oglink.closest(STANDALONE_PLAYER_SELECTOR) &&
        [...oglink.querySelectorAll(CANDIDATE_SELECTOR)].some(
          (candidate) => getCandidateMedia(candidate)?.mediaKey === mediaKey,
        ),
    );
  }

  function updateStandaloneTitle(card, mediaInfo) {
    const title = card.querySelector(OGLINK_TITLE_SELECTOR);
    if (!title) return;
    const cachedMetadata = metadataCache.get(mediaInfo.mediaKey) || null;

    renderOglinkTitle(title, mediaInfo.mediaUrl, cachedMetadata);
    updatePlayerLayout(card, cachedMetadata);

    if (card.dataset.cheeseCafeMetadataRequested === "true") return;
    card.dataset.cheeseCafeMetadataRequested = "true";

    requestMediaMetadata(mediaInfo.media).then((metadata) => {
      if (!metadata || !card.isConnected) return;

      setWithLimit(metadataCache, mediaInfo.mediaKey, metadata);

      const currentTitle = card.querySelector(OGLINK_TITLE_SELECTOR);
      if (currentTitle) {
        renderOglinkTitle(currentTitle, mediaInfo.mediaUrl, metadata);
      }
      updatePlayerLayout(card, metadata);
    });
  }

  function createComponentId() {
    if (globalThis.crypto?.randomUUID) {
      return `SE-${globalThis.crypto.randomUUID()}`;
    }

    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2);
    return `SE-${timestamp}-${random}`;
  }

  function createModuleData(componentId, mediaUrl) {
    return JSON.stringify({
      type: "v2_oglink",
      id: componentId,
      data: {
        link: mediaUrl,
        isVideo: "false",
      },
    });
  }

  function createStandalonePlayer(mediaInfo) {
    const componentId = createComponentId();
    const moduleData = createModuleData(componentId, mediaInfo.mediaUrl);

    const component = document.createElement("div");
    component.className =
      "se-component se-oglink se-l-large_image __se-component cheese-cafe-standalone";
    component.id = componentId;
    component.dataset.cheeseCafeStandalone = mediaInfo.mediaKey;

    const content = document.createElement("div");
    content.className = "se-component-content";

    const section = document.createElement("div");
    section.className =
      "se-section se-section-oglink se-l-large_image se-section-align-";

    const module = document.createElement("div");
    module.className = "se-module se-module-oglink";

    const info = document.createElement("a");
    info.href = mediaInfo.mediaUrl;
    info.className = "se-oglink-info __se_link";
    info.target = "_blank";
    info.dataset.linktype = "oglink";
    info.dataset.linkdata = JSON.stringify({
      id: componentId,
      link: mediaInfo.mediaUrl,
    });

    const infoContainer = document.createElement("div");
    infoContainer.className = "se-oglink-info-container";

    const title = document.createElement("strong");
    title.className = "se-oglink-title";
    title.textContent = `${mediaInfo.mediaUrl} - CHZZK`;

    const script = document.createElement("script");
    script.type = "text/data";
    script.className = "__se_module_data";
    script.dataset.module = moduleData;
    script.dataset.moduleV2 = moduleData;

    infoContainer.append(title);
    info.append(infoContainer);
    module.append(createPlayer(mediaInfo.media), info);
    section.append(module);
    content.append(section);
    component.append(content, script);
    updateStandaloneTitle(component, mediaInfo);

    return component;
  }

  function replaceStandaloneClipComponent(component) {
    if (!component.isConnected) return;
    if (component.closest(STANDALONE_PLAYER_SELECTOR)) return;

    const mediaInfo = getStandaloneClip(component);
    if (!mediaInfo) return;

    if (hasOglinkForMedia(mediaInfo.mediaKey)) {
      mediaInfo.target.remove();
      return;
    }

    mediaInfo.target.replaceWith(createStandalonePlayer(mediaInfo));
  }

  function findStandaloneClipContainers(root) {
    const containers = new Set();

    if (root instanceof Element) {
      if (root.closest(STANDALONE_PLAYER_SELECTOR)) return containers;

      const closestTextComponent = root.closest(TEXT_COMPONENT_SELECTOR);
      const closestParagraph = root.closest(TEXT_PARAGRAPH_SELECTOR);
      if (closestTextComponent) containers.add(closestTextComponent);
      if (closestParagraph) containers.add(closestParagraph);
    }

    root.querySelectorAll(TEXT_COMPONENT_SELECTOR).forEach((component) => {
      containers.add(component);
    });

    root.querySelectorAll(TEXT_PARAGRAPH_SELECTOR).forEach((paragraph) => {
      containers.add(paragraph);
    });

    return containers;
  }

  function getFallbackTitle(title) {
    if (title.dataset.cheeseCafeFallbackTitle) {
      return title.dataset.cheeseCafeFallbackTitle;
    }

    const fallbackTitle = (title.textContent || "")
      .replace(/\s*-\s*CHZZK\s*$/i, "")
      .trim();

    title.dataset.cheeseCafeFallbackTitle = fallbackTitle;
    return fallbackTitle;
  }

  function renderOglinkTitle(title, clipUrl, metadata) {
    // 원본 확장이 이미 이 제목을 렌더했으면 건드리지 않는다(서로 덮어쓰는 핑퐁 방지).
    if (
      title.dataset.chzzkCafeNowTitle != null ||
      title.classList.contains("chzzk-cafe-now-title")
    ) {
      return;
    }
    const fallbackTitle = getFallbackTitle(title);
    const streamerName = metadata?.streamerName || "";
    const clipTitle = metadata?.title || fallbackTitle;
    const label = streamerName ? `${streamerName} - ${clipTitle}` : clipTitle;
    const renderKey = `${label}\n${clipUrl}`;
    if (title.dataset.cheeseCafeTitle === renderKey) return;

    const icon = document.createElement("img");
    icon.className = "cheese-cafe-title__icon";
    icon.src = CHZZK_ICON_URL;
    icon.alt = "";

    const text = document.createElement("span");
    text.className = "cheese-cafe-title__text";
    text.textContent = label;

    const labelWrapper = document.createElement("div");
    labelWrapper.className = "cheese-cafe-title__label";
    labelWrapper.append(icon, text);

    const url = document.createElement("span");
    url.className = "cheese-cafe-title__url";
    url.textContent = ` (${clipUrl})`;

    title.classList.add("cheese-cafe-title");
    title.dataset.cheeseCafeTitle = renderKey;
    title.replaceChildren(labelWrapper, url);
  }

  function requestMediaMetadata(media) {
    const mediaKey = api.getMediaKey(media);
    if (!metadataRequests.has(mediaKey)) {
      const request = new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "CHZZK_CAFE_NOW_GET_CLIP_METADATA",
            mediaType: media.type,
            mediaId: media.id,
            clipId: media.type === "clip" ? media.id : "",
          },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }

            resolve(response?.metadata || null);
          },
        );
      });

      setWithLimit(metadataRequests, mediaKey, request);
    }

    return metadataRequests.get(mediaKey);
  }

  function updateOglinkTitle(oglink, state) {
    const title = oglink.querySelector(OGLINK_TITLE_SELECTOR);
    if (!title) return;
    const cachedMetadata = metadataCache.get(state.mediaKey) || null;

    renderOglinkTitle(title, state.mediaUrl, cachedMetadata);
    updatePlayerLayout(oglink, cachedMetadata);
    if (state.metadataRequested) return;

    state.metadataRequested = true;
    requestMediaMetadata(state.media).then((metadata) => {
      if (!metadata || !oglink.isConnected) return;

      setWithLimit(metadataCache, state.mediaKey, metadata);

      const currentTitle = oglink.querySelector(OGLINK_TITLE_SELECTOR);
      if (currentTitle)
        renderOglinkTitle(currentTitle, state.mediaUrl, metadata);
      updatePlayerLayout(oglink, metadata);
    });
  }

  function replaceOglinkThumbnail(oglink) {
    if (!oglink.isConnected) return;
    if (oglink.dataset.cheeseCafeStandalone) return;

    const thumbnail = findOglinkThumbnail(oglink);
    for (const candidate of oglink.querySelectorAll(CANDIDATE_SELECTOR)) {
      const mediaInfo = getCandidateMedia(candidate);
      if (!mediaInfo) continue;

      // 이미 이 미디어로 변환을 끝낸 카드는 다시 훑지 않는다. 스캔은 초기 렌더
      // 동안 여러 번(타이머 재시도 + 변경 감지) 도는데, 매번 문서 전체를 훑으면
      // 클립 수에 제곱으로 비용이 늘어난다(원본 확장과 같은 가드).
      if (oglink.dataset.cheeseCafeMediaKey === mediaInfo.mediaKey) return;

      let state = oglinkStates.get(oglink);
      if (!state || state.mediaKey !== mediaInfo.mediaKey) {
        state = {
          media: mediaInfo.media,
          mediaKey: mediaInfo.mediaKey,
          mediaUrl: mediaInfo.mediaUrl,
          metadataRequested: false,
        };
        oglinkStates.set(oglink, state);
      }

      oglink
        .querySelectorAll(".se-oglink-summary, .se-oglink-url")
        .forEach((element) => element.remove());

      oglink.classList.add("cheese-cafe-oglink");
      oglink.dataset.cheeseCafeMediaKey = mediaInfo.mediaKey;
      removeStandaloneClipComponents(mediaInfo.mediaKey);
      updateOglinkTitle(oglink, state);

      replaceOrInsertOglinkPlayer(oglink, mediaInfo.media, thumbnail);

      return;
    }
  }

  function scan(root) {
    if (!(root instanceof Document || root instanceof Element)) return;
    // ⚠ 카페는 SPA 라 '글 보기 → 수정'으로 넘어가도 스크립트가 다시 로드되지 않는다.
    //    로드 시점의 판정만 믿으면 수정 화면에서 본문이 사라진다(제보) → 매번 확인.
    if (isCafeWritePage()) return;

    if (root instanceof Element) {
      const closestOglink = root.closest(OGLINK_SELECTOR);
      if (closestOglink) replaceOglinkThumbnail(closestOglink);
    }

    root.querySelectorAll(OGLINK_SELECTOR).forEach(replaceOglinkThumbnail);

    // 중복 링크 정리는 남은 링크를 플레이어로 바꾸기 전에 끝내야 한다. 순서가
    // 뒤바뀌면 오글링크가 이미 있는 클립이 플레이어로 한 번 더 만들어진다.
    flushStandaloneClipCleanup();

    findStandaloneClipContainers(root).forEach(replaceStandaloneClipComponent);
  }

  function flushScans() {
    scanQueued = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();

    if (roots.includes(document)) {
      scan(document);
      return;
    }

    roots.forEach(scan);
  }

  function queueScan(root) {
    pendingRoots.add(root);
    if (scanQueued) return;

    scanQueued = true;
    queueMicrotask(flushScans);
  }

  function onMutations(mutations) {
    let removedPlayer = false;
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        queueScan(mutation.target);
        return;
      }

      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) queueScan(node);
      });
      if (
        cafeAutoplayEnabled &&
        [...mutation.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches(PLAYER_SELECTOR) ||
              Boolean(node.querySelector(PLAYER_SELECTOR))),
        )
      ) {
        removedPlayer = true;
      }
    });
    if (removedPlayer) scheduleAutoplayEvaluation();
  }

  function start() {
    queueScan(document);
    startAutoplayManager();

    const observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: OBSERVED_ATTRIBUTES,
      childList: true,
      subtree: true,
    });

    // Dense early retries so the player swaps in quickly once the SPA fills
    // the post body. The MutationObserver above handles most cases; these are
    // a safety net for mutations it might miss during the initial render burst.
    [50, 150, 400, 800, 1500, 3000].forEach((delay) => {
      setTimeout(() => {
        if (document.documentElement) queueScan(document);
      }, delay);
    });
  }

  // 원본 '치즈 카페 나우' 확장이 함께 설치돼 동작 중인지 감지한다. 우리는 고유
  // 마커(data-cheese-cafe-*)로 격리됐지만, 원본은 data-chzzk-cafe-now-* 마커와
  // globalThis.ChzzkCafeNow 전역을 쓴다. 둘이 동시에 같은 카페 오글링크를 처리하면
  // 서로의 title 변경을 감지해 무한 렌더 핑퐁 → 페이지가 멈춘다. 원본이 감지되면
  // 우리는 완전히 양보한다(부팅 안 함).
  function isOriginalCafeNowPresent() {
    try {
      if (globalThis.ChzzkCafeNow) return true; // 원본 clip-url 전역
      if (
        document.querySelector(
          "[data-chzzk-cafe-now-player], [data-chzzk-cafe-now-standalone], .chzzk-cafe-now-player",
        )
      ) {
        return true; // 원본이 이미 삽입한 플레이어
      }
    } catch {}
    return false;
  }

  // 설정 토글(cheeseCafeNow, 기본 ON)이 켜져 있을 때만 동작한다. 카페는 iframe 구조라
  // all_frames 로 여러 프레임에서 이 스크립트가 돌지만, storage 는 확장 전역이라 각
  // 프레임이 같은 값을 읽는다. 토글을 끄면 새로고침 시 실행 안 함(동적 해제는 복잡해서
  // 새 링크 스캔만 멈추게 게이트한다).
  let started = false;
  function bootIfEnabled() {
    if (started) return;
    if (isOriginalCafeNowPresent()) return; // 원본 확장이 있으면 양보
    started = true;
    if (document.documentElement) {
      start();
    } else {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    }
  }
  try {
    chrome.storage?.local?.get(
      [CAFE_NOW_KEY, CAFE_NOW_AUTOPLAY_KEY, CAFE_NOW_AUTOPLAY_MUTED_KEY],
      (data) => {
        if (chrome.runtime?.lastError) {
          bootIfEnabled(); // storage 접근 실패 시 기본 동작(ON)
          return;
        }
        cafeAutoplayEnabled = data?.[CAFE_NOW_AUTOPLAY_KEY] === true;
        cafeAutoplayMuted = data?.[CAFE_NOW_AUTOPLAY_MUTED_KEY] !== false;
        if (data?.[CAFE_NOW_KEY] !== false) bootIfEnabled(); // 미설정/true=ON
      },
    );
  } catch {
    bootIfEnabled();
  }

  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[CAFE_NOW_AUTOPLAY_KEY]) {
        setCafeAutoplayEnabled(
          changes[CAFE_NOW_AUTOPLAY_KEY].newValue === true,
        );
      }
      if (changes[CAFE_NOW_AUTOPLAY_MUTED_KEY]) {
        setCafeAutoplayMuted(
          changes[CAFE_NOW_AUTOPLAY_MUTED_KEY].newValue !== false,
        );
      }
    });
  } catch {}
})();
