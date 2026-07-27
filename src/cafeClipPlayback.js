(function controlCafeClipPlayback() {
  const params = new URLSearchParams(location.search);
  if (params.get("extension") !== "ChzzkCafeNow") return;

  const initialAutoplay = params.get("autoplay") === "1";

  // ⚠ 한때 localStorage('embed-player-volume-muted')를 document_start 에 바꿔 소리 있는
  // 자동재생을 시도했지만, 임베드 플레이어는 이 값을 자동재생 음소거 결정에 쓰지 않는다
  // (사용자 활성화가 있는 프레임에서도 play() 가 거부됐고, 값만 잠깐 바뀌었다가 폴백에
  // 의해 되돌아갔다). 효과 없이 사용자의 치지직 origin 설정만 건드리므로 제거했다.
  // 소리는 아래 canPlayUnmuted()/scheduleUnmuteRetries() 경로 — 즉 사용자가 플레이어를
  // 한 번 조작한 뒤 켜지는 방식으로만 처리한다(브라우저 자동재생 정책상 이게 한계).

  const MESSAGE_SOURCE = "cheese-platter-cafe-clip-playback";
  const OBSERVER_TIMEOUT_MS = 15000;
  const PLAY_RETRY_INTERVAL_MS = 250;
  const PLAY_RETRY_TIMEOUT_MS = 15000;
  let desiredAction = initialAutoplay ? "play" : null;
  let desiredMuted = params.get("muted") !== "0";
  let playPending = false;
  let commandVersion = 0;
  let observer = null;
  let observerTimeout = 0;
  let observerExpired = false;
  let applyQueued = false;
  let iframeInteracted = false;
  let lastInteractionAt = 0; // iframe 내부 마지막 실제 조작 시각(사용자 pause 판별용)
  let unmuteRetryTimers = [];
  let playRetryTimer = 0;
  let playRetryUntil = initialAutoplay
    ? Date.now() + PLAY_RETRY_TIMEOUT_MS
    : 0;
  let autoplayUnmuteBlocked = false;

  function isCafeOrigin(origin) {
    try {
      const hostname = new URL(origin).hostname;
      return (
        hostname === "cafe.naver.com" ||
        hostname.endsWith(".cafe.naver.com")
      );
    } catch {
      return false;
    }
  }

  function hasUserActivation() {
    return navigator.userActivation?.hasBeenActive === true;
  }

  // 부모가 muted=0 으로 띄웠다는 것은, 이 origin 에 이미 사용자 활성화가 있어 소리 있는
  // 재생이 허용된다고 판단했다는 뜻이다. navigator.userActivation 은 문서 단위라 새로
  // 만든 iframe 에서는 항상 false 여서, 이 값만 보면 매번 다시 음소거됐다.
  const startedUnmuted = params.get("muted") === "0";

  function canPlayUnmuted() {
    return startedUnmuted || iframeInteracted || hasUserActivation();
  }

  function applyDesiredMute(video) {
    const muted =
      desiredMuted ||
      !canPlayUnmuted() ||
      (autoplayUnmuteBlocked && !iframeInteracted && !hasUserActivation());
    video.muted = muted;
    video.defaultMuted = muted;
  }

  function clearUnmuteRetries() {
    unmuteRetryTimers.forEach(clearTimeout);
    unmuteRetryTimers = [];
  }

  function unmuteAfterUserActivation() {
    if (desiredAction !== "play" || desiredMuted) return;
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return;

    autoplayUnmuteBlocked = false;
    video.muted = false;
    video.defaultMuted = false;
    if (video.paused) {
      try {
        const result = video.play();
        result?.catch?.(() => {});
      } catch {}
    }
  }

  function scheduleUnmuteRetries() {
    clearUnmuteRetries();
    unmuteAfterUserActivation();
    [0, 80, 250].forEach((delay) => {
      unmuteRetryTimers.push(
        window.setTimeout(unmuteAfterUserActivation, delay),
      );
    });
  }

  function clearPlayRetryTimer() {
    if (playRetryTimer) {
      clearTimeout(playRetryTimer);
      playRetryTimer = 0;
    }
  }

  function resetPlayRetry() {
    clearPlayRetryTimer();
    playRetryUntil = 0;
  }

  function schedulePlayRetry(version) {
    if (
      desiredAction !== "play" ||
      version !== commandVersion ||
      Date.now() >= playRetryUntil ||
      playRetryTimer
    ) {
      return;
    }

    playRetryTimer = window.setTimeout(() => {
      playRetryTimer = 0;
      if (
        desiredAction !== "play" ||
        version !== commandVersion ||
        Date.now() >= playRetryUntil
      ) {
        return;
      }
      queueApplyPlaybackCommand();
    }, PLAY_RETRY_INTERVAL_MS);
  }

  function attemptVideoPlay(video, version, allowMutedFallback) {
    if (desiredAction !== "play" || version !== commandVersion) return;
    playPending = true;

    let result;
    try {
      result = video.play();
    } catch {
      playPending = false;
      schedulePlayRetry(version);
      return;
    }

    if (!result || typeof result.then !== "function") {
      playPending = false;
      clearPlayRetryTimer();
      return;
    }

    result.then(
      () => {
        if (version !== commandVersion) return;
        playPending = false;
        clearPlayRetryTimer();
      },
      () => {
        if (version !== commandVersion || desiredAction !== "play") return;
        playPending = false;

        if (allowMutedFallback && !video.muted) {
          autoplayUnmuteBlocked = true;
          video.muted = true;
          video.defaultMuted = true;
          attemptVideoPlay(video, version, false);
          return;
        }
        schedulePlayRetry(version);
      },
    );
  }

  function applyPlaybackCommand() {
    if (!desiredAction) return true;
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return false;

    if (desiredAction === "pause") {
      resetPlayRetry();
      playPending = false;
      if (!video.paused) video.pause();
      return true;
    }

    applyDesiredMute(video);
    if (!video.paused) {
      playPending = false;
      clearPlayRetryTimer();
      return true;
    }
    if (playPending) {
      return true;
    }

    attemptVideoPlay(video, commandVersion, true);
    return true;
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    if (observerTimeout) {
      clearTimeout(observerTimeout);
      observerTimeout = 0;
    }
  }

  function ensureObserver() {
    if (observer || observerExpired || !document.documentElement) return;
    observer = new MutationObserver(queueApplyPlaybackCommand);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    observerTimeout = window.setTimeout(() => {
      observerExpired = true;
      stopObserver();
    }, OBSERVER_TIMEOUT_MS);
  }

  function queueApplyPlaybackCommand() {
    if (applyQueued) return;
    applyQueued = true;
    queueMicrotask(() => {
      applyQueued = false;
      if (applyPlaybackCommand()) stopObserver();
      else ensureObserver();
    });
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      !isCafeOrigin(event.origin) ||
      event.data?.source !== MESSAGE_SOURCE
    ) {
      return;
    }

    // 부모가 iframe 을 제거하기 직전에 보내는 정리 신호. iframe 이 그냥 떨어져 나가면
    // pagehide 가 안 오는 경우가 있어(Chromium), 타이머·리스너가 남을 수 있다.
    if (event.data.action === "release") {
      releaseControl();
      return;
    }
    desiredAction = event.data.action === "play" ? "play" : "pause";
    desiredMuted = event.data.muted !== false;
    if (desiredMuted) clearUnmuteRetries();
    commandVersion += 1;
    playPending = false;
    resetPlayRetry();
    if (desiredAction === "play") {
      playRetryUntil = Date.now() + PLAY_RETRY_TIMEOUT_MS;
    }
    observerExpired = false;
    stopObserver();
    queueApplyPlaybackCommand();
  });

  function notifyParent(name) {
    try {
      window.parent?.postMessage(
        { source: MESSAGE_SOURCE, event: name },
        "*",
      );
    } catch {}
  }

  function handleDocumentPlay(event) {
    if (!(event.target instanceof HTMLVideoElement)) return;
    if (desiredAction === "pause") {
      event.target.pause();
      return;
    }
    // 재생이 시작됐음을 부모에 알려, 카페의 다른 재생 중인 영상을 멈추게 한다.
    // 자동재생·수동재생 모두 해당된다(소리 겹침은 원인과 무관하게 거슬린다).
    notifyParent("playing");
    if (desiredAction === "play") {
      applyDesiredMute(event.target);
    }
  }

  function releaseControl() {
    desiredAction = null;
    playPending = false;
    resetPlayRetry();
    clearUnmuteRetries();
    stopObserver();
  }

  function handleUserActivation(event) {
    if (!event.isTrusted) return;
    const first = !iframeInteracted;
    iframeInteracted = true;
    lastInteractionAt = Date.now();
    // 이 origin(chzzk)에 사용자 활성화가 생겼음을 부모에 알린다. 부모는 이후 마운트하는
    // iframe 을 처음부터 소리 있게 시작시킬 수 있다(활성화는 origin 단위로 유지되므로).
    if (first) notifyParent("activated");
    if (desiredAction === "pause") {
      // An explicit interaction hands control back to the native player.
      releaseControl();
      return;
    }
    if (desiredAction !== "play" || desiredMuted) return;
    scheduleUnmuteRetries();
  }

  // 사용자가 직접 일시정지하면 자동재생 제어를 놓는다. 이게 없으면 스크롤로 시야에서
  // 벗어났다 돌아올 때 부모가 다시 "play" 를 보내 사용자가 멈춘 영상이 재생됐다.
  // 부모에게도 알려, 그 플레이어를 자동재생 대상에서 제외하게 한다.
  function handleDocumentPause(event) {
    if (!(event.target instanceof HTMLVideoElement)) return;
    if (desiredAction !== "play") return;
    // 우리가 건 play() 가 아직 진행 중이거나 재생 종료로 인한 pause 는 무시한다.
    if (playPending || event.target.ended) return;
    // ⚠ 'iframe 안에서 실제로 조작했는지'만 본다. 예전엔 hasUserActivation() 도 함께
    // 봤는데, 이 값은 문서 단위라 카페 페이지를 한 번이라도 클릭했으면 true 가 된다.
    // 그러면 부모가 보낸 pause(다른 클립 재생 시 정지)까지 '사용자가 멈춤'으로 오인해
    // 그 플레이어가 자동재생 대상에서 영구 제외됐다(자동재생이 안 되던 원인).
    const userPaused =
      iframeInteracted && Date.now() - lastInteractionAt <= 300;
    if (userPaused) {
      releaseControl();
      notifyParent("user-paused");
      return;
    }

    // 소스 교체나 플레이어 초기화 도중 발생한 pause 는 사용자의 일시정지가 아니다.
    // 자동재생 대상이 화면에 남아 있다면 제한 시간 안에서 다시 재생을 시도한다.
    if (!playRetryUntil) {
      playRetryUntil = Date.now() + PLAY_RETRY_TIMEOUT_MS;
    }
    schedulePlayRetry(commandVersion);
  }

  document.addEventListener("play", handleDocumentPlay, true);
  document.addEventListener("pause", handleDocumentPause, true);
  document.addEventListener("pointerdown", handleUserActivation, true);
  document.addEventListener("keydown", handleUserActivation, true);
  document.addEventListener("touchstart", handleUserActivation, true);
  if (initialAutoplay) {
    queueApplyPlaybackCommand();
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        if (desiredAction !== "play") return;
        observerExpired = false;
        if (Date.now() >= playRetryUntil) {
          playRetryUntil = Date.now() + PLAY_RETRY_TIMEOUT_MS;
        }
        queueApplyPlaybackCommand();
      },
      { once: true },
    );
  }
  window.addEventListener(
    "pagehide",
    () => {
      stopObserver();
      resetPlayRetry();
      clearUnmuteRetries();
      document.removeEventListener("play", handleDocumentPlay, true);
      document.removeEventListener("pause", handleDocumentPause, true);
      document.removeEventListener("pointerdown", handleUserActivation, true);
      document.removeEventListener("keydown", handleUserActivation, true);
      document.removeEventListener("touchstart", handleUserActivation, true);
      playPending = false;
      observerExpired = true;
    },
    { once: true },
  );
})();
