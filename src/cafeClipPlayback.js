(function controlCafeClipPlayback() {
  const params = new URLSearchParams(location.search);
  if (params.get("extension") !== "ChzzkCafeNow") return;

  const MESSAGE_SOURCE = "cheese-platter-cafe-clip-playback";
  const OBSERVER_TIMEOUT_MS = 10000;
  let desiredAction = null;
  let desiredMuted = true;
  let playPending = false;
  let commandVersion = 0;
  let attemptedVideo = null;
  let attemptedVersion = -1;
  let observer = null;
  let observerTimeout = 0;
  let observerExpired = false;
  let applyQueued = false;
  let iframeInteracted = false;
  let unmuteRetryTimers = [];

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
    const muted = desiredMuted || !canPlayUnmuted();
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

  function applyPlaybackCommand() {
    if (!desiredAction) return true;
    const video = document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return false;

    if (desiredAction === "pause") {
      if (!video.paused) video.pause();
      attemptedVideo = null;
      attemptedVersion = -1;
      return true;
    }

    applyDesiredMute(video);
    if (
      !video.paused ||
      playPending ||
      (attemptedVideo === video && attemptedVersion === commandVersion)
    ) {
      return true;
    }

    attemptedVideo = video;
    attemptedVersion = commandVersion;
    playPending = true;
    try {
      const result = video.play();
      if (result && typeof result.then === "function") {
        result.then(
          () => {
            playPending = false;
          },
          () => {
            playPending = false;
            // 소리 있는 재생이 거부됐다면(활성화 만료 등) 음소거로 되돌려 재시도한다.
            // 이게 없으면 아예 재생되지 않아 자동재생이 멈춘 것처럼 보인다.
            if (video.muted) return;
            video.muted = true;
            video.defaultMuted = true;
            try {
              video.play()?.catch?.(() => {});
            } catch {}
          },
        );
      } else {
        playPending = false;
      }
    } catch {
      playPending = false;
    }
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

    desiredAction = event.data.action === "play" ? "play" : "pause";
    desiredMuted = event.data.muted !== false;
    if (desiredMuted) clearUnmuteRetries();
    commandVersion += 1;
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
      attemptedVideo = event.target;
      attemptedVersion = commandVersion;
    }
  }

  function releaseControl() {
    desiredAction = null;
    attemptedVideo = null;
    attemptedVersion = -1;
    clearUnmuteRetries();
    stopObserver();
  }

  function handleUserActivation(event) {
    if (!event.isTrusted) return;
    const first = !iframeInteracted;
    iframeInteracted = true;
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
    if (!(iframeInteracted || hasUserActivation())) return;

    releaseControl();
    notifyParent("user-paused");
  }

  document.addEventListener("play", handleDocumentPlay, true);
  document.addEventListener("pause", handleDocumentPause, true);
  document.addEventListener("pointerdown", handleUserActivation, true);
  document.addEventListener("keydown", handleUserActivation, true);
  document.addEventListener("touchstart", handleUserActivation, true);
  window.addEventListener(
    "pagehide",
    () => {
      stopObserver();
      clearUnmuteRetries();
      document.removeEventListener("play", handleDocumentPlay, true);
      document.removeEventListener("pause", handleDocumentPause, true);
      document.removeEventListener("pointerdown", handleUserActivation, true);
      document.removeEventListener("keydown", handleUserActivation, true);
      document.removeEventListener("touchstart", handleUserActivation, true);
      attemptedVideo = null;
      attemptedVersion = -1;
      playPending = false;
      observerExpired = true;
    },
    { once: true },
  );
})();
