// 치지직 클립 페이지에서 실제로 보이는 쇼츠 iframe 하나만 미디어 도구의 활성
// 프레임으로 지정한다. 화면 밖에 미리 로드된 iframe의 필터와 오디오 그래프가 함께
// 실행되는 것을 막기 위한 상위 프레임 전용 조정기다.
(function () {
  "use strict";

  if (window !== window.top || window.__cheeseClipFrameCoordinatorLoaded) {
    return;
  }
  window.__cheeseClipFrameCoordinatorLoaded = true;

  const MESSAGE_SOURCE = "cheese-platter-clip-frame-activity";
  const FRAME_SELECTOR = 'iframe[src*="m.naver.com/shorts"]';
  const CHECK_INTERVAL_MS = 1000;
  const MIN_SYNC_INTERVAL_MS = 100;
  const MIN_TRANSITION_INTERVAL_MS = 80;
  const activeStates = new WeakMap();
  // src 속성이 m.naver.com이어도 최초 탐색 전 iframe 문서는 잠시 부모 origin을
  // 상속한다. 실제 m.naver.com 콘텐츠 스크립트가 ready를 보낸 프레임만 전송한다.
  const readyFrames = new WeakSet();
  const observedFrames = new Set();
  const forcedSources = new Set();
  let activeFrame = null;
  let syncRaf = 0;
  let syncDelayTimer = 0;
  let lastSyncAt = 0;
  let lastTransitionAt = 0;
  let checkTimer = 0;
  let mutationObserver = null;
  let intersectionObserver = null;

  function currentAccountId() {
    try {
      const value = String(localStorage.getItem("userStatus.idhash") || "")
        .trim()
        .toLowerCase();
      return /^[0-9a-f]{32}$/.test(value) ? value : "";
    } catch {
      return "";
    }
  }

  function isClipPage() {
    return /^\/clips(?:\/|$)/.test(location.pathname);
  }

  function getAllFrames() {
    return Array.from(document.querySelectorAll(FRAME_SELECTOR)).filter(
      (frame) => frame instanceof HTMLIFrameElement && frame.isConnected,
    );
  }

  function isTreeVisible(frame) {
    let node = frame;
    while (node instanceof Element) {
      const style = getComputedStyle(node);
      if (
        node.getAttribute("aria-hidden") === "true" ||
        node.hasAttribute("inert") ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      node = node.parentElement;
    }
    return true;
  }

  function getFrameScore(frame) {
    const rect = frame.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(rect.right, innerWidth) - Math.max(rect.left, 0),
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0),
    );
    const area = width * height;
    if (!area || !isTreeVisible(frame)) return 0;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(
      centerX - innerWidth / 2,
      centerY - innerHeight / 2,
    );
    let score = area / (1 + distance / 300);
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (hit === frame) score *= 1.25;
    return score;
  }

  function postFrameState(frame, active, force = false) {
    if (!readyFrames.has(frame)) return;
    const accountId = currentAccountId();
    const signature = `${active}:${accountId}`;
    if (!force && activeStates.get(frame) === signature) return;
    activeStates.set(frame, signature);
    try {
      frame.contentWindow?.postMessage(
        { source: MESSAGE_SOURCE, active, accountId },
        "https://m.naver.com",
      );
    } catch {}
  }

  function syncObservedFrames(frames) {
    if (!intersectionObserver) return;
    const current = new Set(frames);
    for (const frame of observedFrames) {
      if (current.has(frame)) continue;
      intersectionObserver.unobserve(frame);
      observedFrames.delete(frame);
    }
    for (const frame of frames) {
      if (observedFrames.has(frame)) continue;
      observedFrames.add(frame);
      intersectionObserver.observe(frame);
    }
  }

  function syncFrameActivity() {
    syncRaf = 0;
    lastSyncAt = performance.now();
    const allFrames = getAllFrames();
    const frames = isClipPage() ? allFrames : [];
    syncObservedFrames(frames);
    const scored = frames
      .map((frame) => ({ frame, score: getFrameScore(frame) }))
      .sort((a, b) => b.score - a.score);
    let nextFrame = scored[0]?.score > 0 ? scored[0].frame : null;
    const currentScore =
      scored.find(({ frame }) => frame === activeFrame)?.score || 0;
    const bestScore = scored[0]?.score || 0;
    if (
      activeFrame?.isConnected &&
      currentScore > 0 &&
      currentScore >= bestScore * 0.8
    ) {
      nextFrame = activeFrame;
    }
    activeFrame = nextFrame;

    for (const frame of allFrames) {
      const source = frame.contentWindow;
      const force = source && forcedSources.has(source);
      postFrameState(frame, frame === activeFrame, force);
    }
    forcedSources.clear();
  }

  function scheduleFrameActivitySync(forceSource = null) {
    const hasForceSource =
      forceSource && typeof forceSource.postMessage === "function";
    if (hasForceSource) forcedSources.add(forceSource);
    if (document.hidden) {
      if (hasForceSource || !lastSyncAt || !activeFrame?.isConnected) {
        if (syncRaf) cancelAnimationFrame(syncRaf);
        if (syncDelayTimer) clearTimeout(syncDelayTimer);
        syncRaf = 0;
        syncDelayTimer = 0;
        syncFrameActivity();
      }
      return;
    }
    if (syncRaf || syncDelayTimer) return;
    const wait = MIN_SYNC_INTERVAL_MS - (performance.now() - lastSyncAt);
    if (wait > 0) {
      syncDelayTimer = window.setTimeout(() => {
        syncDelayTimer = 0;
        scheduleFrameActivitySync();
      }, wait);
      return;
    }
    syncRaf = requestAnimationFrame(syncFrameActivity);
  }

  function handleFrameReady(event) {
    if (
      event.origin !== "https://m.naver.com" ||
      event.data?.source !== MESSAGE_SOURCE ||
      event.data?.event !== "ready"
    ) {
      return;
    }
    const readyFrame = getAllFrames().find(
      (frame) => frame.contentWindow === event.source,
    );
    if (!readyFrame) return;
    readyFrames.add(readyFrame);
    // 같은 iframe이 새 쇼츠 문서로 이동해 ready를 다시 보낸 경우에도 현재 상태를
    // 반드시 한 번 더 내려보낸다.
    activeStates.delete(readyFrame);
    scheduleFrameActivitySync(event.source);
  }

  function handlePageScroll() {
    const now = performance.now();
    if (
      activeFrame?.isConnected &&
      readyFrames.has(activeFrame) &&
      now - lastTransitionAt >= MIN_TRANSITION_INTERVAL_MS
    ) {
      lastTransitionAt = now;
      try {
        activeFrame.contentWindow?.postMessage(
          { source: MESSAGE_SOURCE, event: "transition-start" },
          "https://m.naver.com",
        );
      } catch {}
    }
    scheduleFrameActivitySync();
  }

  intersectionObserver = new IntersectionObserver(
    () => scheduleFrameActivitySync(),
    { threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] },
  );
  mutationObserver = new MutationObserver((mutations) => {
    if (
      mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches(FRAME_SELECTOR) ||
              node.querySelector(FRAME_SELECTOR)),
        ),
      )
    ) {
      scheduleFrameActivitySync();
    }
  });
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("message", handleFrameReady);
  window.addEventListener("scroll", handlePageScroll, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", scheduleFrameActivitySync);
  document.addEventListener("visibilitychange", () => {
    if (syncRaf) cancelAnimationFrame(syncRaf);
    if (syncDelayTimer) clearTimeout(syncDelayTimer);
    syncRaf = 0;
    syncDelayTimer = 0;
    syncFrameActivity();
  });
  checkTimer = window.setInterval(
    scheduleFrameActivitySync,
    CHECK_INTERVAL_MS,
  );

  window.addEventListener("pagehide", (event) => {
    // bfcache 이동은 브라우저가 작업을 동결하므로 연결을 유지한다.
    if (event.persisted) return;
    if (syncRaf) cancelAnimationFrame(syncRaf);
    if (syncDelayTimer) clearTimeout(syncDelayTimer);
    if (checkTimer) clearInterval(checkTimer);
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    syncRaf = 0;
    syncDelayTimer = 0;
    checkTimer = 0;
    mutationObserver = null;
    intersectionObserver = null;
    observedFrames.clear();
    forcedSources.clear();
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) scheduleFrameActivitySync();
  });

  scheduleFrameActivitySync();
})();
