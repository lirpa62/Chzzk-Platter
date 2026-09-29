// 멀티뷰 채팅 분리 창. 채팅 페이지 URL은 여기서 고정 경로로만 만든다.
(() => {
  "use strict";

  const SOURCE = "cheese-platter-multiview-chat-popup";
  const MULTIVIEW_SOURCE = "cheese-platter-multiview";
  const CHZZK_ORIGIN = "https://chzzk.naver.com";
  const CHANNEL_ID_RE = /^[0-9a-f]{32}$/i;
  const VIDEO_ID_RE = /^video:(\d+)$/;
  const SESSION_ID_RE = /^[0-9a-f]{32}$/;
  const $ = (id) => document.getElementById(id);
  const sessionId = new URLSearchParams(location.search).get("session") || "";

  if (!SESSION_ID_RE.test(sessionId) || typeof BroadcastChannel !== "function") {
    $("mvChatPopupMessage").textContent = "멀티뷰에서 채팅 팝업을 다시 열어 주세요.";
    return;
  }

  const channel = new BroadcastChannel(`cheese-multiview-chat-${sessionId}`);
  const frame = $("mvChatPopupFrame");
  let currentChannelId = "";
  let currentVodVideoNo = "";
  let vodChatScrollInitialized = false;
  let currentMediaType = "live";
  let currentGeneration = -1;
  let chatFrameReady = false;
  let currentThemeDark = document.documentElement.dataset.theme === "dark";
  const vodList = $("mvChatPopupVodList");
  // 지난 채팅을 보고 있을 때 오른쪽 아래에 뜨는 '최신 채팅으로' 버튼(시청 페이지와 같다).
  const vodChatLatest = globalThis.CheeseReplayLocalChat?.bindLatestButton({
    list: vodList,
    button: $("mvChatPopupVodLatest"),
  });
  const vodScaleSteps = [100, 125, 150, 175];
  let vodScalePercent = 100;
  // 설정의 '다시보기 채팅 입력'. 읽기 전에는 숨긴다. 로컬 채팅 줄은 시청 페이지가
  // 설정을 보고 빼서 보내므로 여기서는 입력창만 맞춘다.
  const vodComposeForm = $("mvChatPopupVodCompose");
  let vodLocalChatEnabled = false;
  if (vodComposeForm) vodComposeForm.hidden = true;
  globalThis.CheeseReplayLocalChat?.watchEnabledSetting((enabled) => {
    vodLocalChatEnabled = enabled;
    if (vodComposeForm) vodComposeForm.hidden = !enabled;
  });
  // 설정 - 채팅 '채팅 전송 버튼 숨김'을 로컬 채팅 입력 도구 줄에도 적용한다.
  globalThis.CheeseReplayLocalChat?.watchHideToolsSetting((hide) => {
    document.documentElement.classList.toggle("mv-hide-chat-send-button", hide);
  });
  // 나의 로컬 채팅 줄 강조의 테두리선·배경색 숨김(시청 페이지와 같은 설정).
  globalThis.CheeseReplayLocalChat?.watchStyleClasses();
  globalThis.CheeseReplayLocalChat?.bindComposer({
    form: vodComposeForm,
    input: $("mvChatPopupVodComposeInput"),
    button: $("mvChatPopupVodComposeSend"),
    onSend: (text) => {
      if (!vodLocalChatEnabled || currentMediaType !== "video" || !currentVodVideoNo) return;
      send("VOD_LOCAL_CHAT_SEND", {
        channelId: currentChannelId,
        videoNo: currentVodVideoNo,
        generation: currentGeneration,
        text,
      });
    },
  });
  const badgeAnchor = $("mvChatPopupBadgeAnchor");
  const badgeTrigger = $("mvChatPopupBadgeTrigger");
  const badgePopover = $("mvChatPopupBadgePopover");
  const badgeList = $("mvChatPopupBadgeList");
  const badgeEmpty = $("mvChatPopupBadgeEmpty");
  const badgeResize = $("mvChatPopupBadgeResize");
  const badgeClose = $("mvChatPopupBadgeClose");
  const badgeSeenIds = new Set();
  let vodLocalChatIds = new Set();
  let badgeItems = [];
  let badgeSettings = {
    hidePillButton: false,
    hideEmptyButton: false,
    keepPopupOpen: false,
    compactPill: false,
    pillGlowEnabled: true,
    displayStyle: "inline",
  };
  let badgePopoverOpen = false;
  let badgePopoverHeight = 320;
  let badgeResizeStart = null;
  let badgePill = null;
  let badgeMotion = null;
  let badgeResizeObserver = null;
  let badgeRenderSignature = "";
  const badgeScaleControls = globalThis.CheeseMultiviewBadgeChat?.createFontScaleControls({
    doc: document,
    classPrefix: "mv-badge-chat",
    onChange: (percent) => {
      badgePopover?.style.setProperty("--mv-badge-chat-font-scale", String(percent / 100));
      badgePopover?.style.setProperty("--mv-vod-chat-scale", String(percent / 100));
    },
  });
  const badgeHeader = badgePopover?.querySelector(".mv-badge-chat-popover-head");
  if (badgeHeader && badgeScaleControls)
    badgeHeader.insertBefore(badgeScaleControls.element, badgeClose);
  if (badgeTrigger && globalThis.CheeseMultiviewBadgeChat) {
    badgePill = globalThis.CheeseMultiviewBadgeChat.createBadgePill({
      trigger: badgeTrigger,
      badges: $("mvChatPopupBadgeBadges"),
      label: $("mvChatPopupBadgeLabel"),
      count: $("mvChatPopupBadgeCount"),
      classPrefix: "mv-badge-chat",
    });
    badgeMotion = globalThis.CheeseMultiviewBadgeChat.createPopoverMotion(badgePopover);
  }

  function reflectVodScale() {
    const scale = String(vodScalePercent / 100);
    $("mvChatPopupVod")?.style.setProperty("--mv-vod-chat-scale", scale);
    vodList?.style.setProperty("--mv-vod-chat-scale", scale);
    $("mvChatPopupVodScaleValue").textContent = `${vodScalePercent}%`;
    $("mvChatPopupVodScaleDown").disabled = vodScalePercent <= 100;
    $("mvChatPopupVodScaleUp").disabled = vodScalePercent >= 175;
  }

  function stepVodScale(direction) {
    const index = vodScaleSteps.indexOf(vodScalePercent);
    vodScalePercent = vodScaleSteps[Math.max(0, Math.min(vodScaleSteps.length - 1, index + direction))];
    reflectVodScale();
  }

  function positionBadgePopover() {
    if (!badgePopoverOpen || !badgeTrigger || !badgePopover) return;
    const anchor = badgeTrigger.getBoundingClientRect();
    const viewport = $("mvChatPopupView").getBoundingClientRect();
    const margin = 8;
    const width = Math.max(0, Math.min(viewport.width, window.innerWidth - margin * 2));
    const maxHeight = Math.max(120, Math.min(720, window.innerHeight - margin * 2));
    badgePopoverHeight = Math.min(badgePopoverHeight, maxHeight);
    badgePopover.style.width = `${width}px`;
    badgePopover.style.height = `${badgePopoverHeight}px`;
    const left = Math.max(margin, Math.min(
      window.innerWidth - width - margin,
      Math.max(viewport.left, Math.min(anchor.left, viewport.right - width)),
    ));
    let top = anchor.bottom + 6;
    const above = top + badgePopover.offsetHeight > window.innerHeight - margin;
    if (above) top = anchor.top - badgePopover.offsetHeight - 6;
    top = Math.max(margin, Math.min(window.innerHeight - badgePopover.offsetHeight - margin, top));
    badgePopover.classList.toggle("is-above", above);
    badgePopover.style.left = `${left}px`;
    badgePopover.style.top = `${top}px`;
    badgeResize?.setAttribute("aria-valuenow", String(Math.round(badgePopoverHeight)));
  }

  function closeBadgePopover(force = false) {
    if (!force && badgeSettings.keepPopupOpen && !badgeSettings.hidePillButton) return;
    const wasOpen = badgePopoverOpen;
    badgePopoverOpen = false;
    badgeMotion?.close(force || !wasOpen);
    badgeTrigger?.setAttribute("aria-expanded", "false");
    badgeResizeObserver?.disconnect();
    badgeResizeObserver = null;
    document.removeEventListener("scroll", positionBadgePopover, true);
    window.removeEventListener("resize", positionBadgePopover);
  }

  function openBadgePopover(open) {
    if (!open) {
      closeBadgePopover();
      return;
    }
    if (badgeSettings.hidePillButton) return;
    badgePill?.clearAttention();
    badgePopoverOpen = true;
    badgeItems.forEach((item) => badgeSeenIds.add(item.id));
    badgeMotion?.open();
    badgeTrigger?.setAttribute("aria-expanded", "true");
    renderPopupBadgeChat(null);
    // 새로 열 때는 가장 최근 채팅(맨 아래)에서 시작한다.
    badgeList.scrollTop = badgeList.scrollHeight;
    positionBadgePopover();
    if (window.ResizeObserver) {
      badgeResizeObserver = new window.ResizeObserver(positionBadgePopover);
      badgeResizeObserver.observe($("mvChatPopupView"));
    }
    document.addEventListener("scroll", positionBadgePopover, true);
    window.addEventListener("resize", positionBadgePopover);
  }

  function renderPopupBadgeChat(data, hasNew = false) {
    if (data && typeof data === "object") {
      const allowedRoles = new Set(["streamer", "manager", "operator", "partner"]);
      let totalHtmlLength = 0;
      const sourceItems = Array.isArray(data.items) ? data.items.slice(-150) : [];
      badgeItems = sourceItems.slice().reverse().filter((item) => {
        if (!item || typeof item.id !== "string" || item.id.length > 160 ||
            typeof item.nickname !== "string" || item.nickname.length > 80 ||
            typeof item.html !== "string" || item.html.length > 20000 ||
            !Array.isArray(item.roles) || item.roles.length > 8 ||
            !item.roles.every((role) => allowedRoles.has(role)) ||
            totalHtmlLength + item.html.length > 800000) return false;
        totalHtmlLength += item.html.length;
        return true;
      }).reverse();
      const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
      badgeSettings = {
        hidePillButton: settings.hidePillButton === true,
        hideEmptyButton: settings.hideEmptyButton === true,
        keepPopupOpen: settings.keepPopupOpen === true,
        compactPill: settings.compactPill === true,
        pillGlowEnabled: settings.pillGlowEnabled !== false,
        displayStyle: settings.displayStyle === "block" ? "block" : "inline",
      };
      badgeList.classList.toggle("is-block", badgeSettings.displayStyle === "block");
      if (badgeSettings.hidePillButton) badgeSettings.keepPopupOpen = false;
    }
    if (badgePopoverOpen) badgeItems.forEach((item) => badgeSeenIds.add(item.id));
    while (badgeSeenIds.size > 2000) badgeSeenIds.delete(badgeSeenIds.values().next().value);
    const unread = badgeItems.filter((item) => !badgeSeenIds.has(item.id));
    const actors = globalThis.CheeseMultiviewBadgeChat?.collectPillActors(unread) || [];
    badgePill?.render({
      actors,
      compact: badgeSettings.compactPill,
      glow: badgeSettings.pillGlowEnabled,
    });
    if (badgeTrigger) {
      badgeTrigger.hidden = badgeSettings.hidePillButton ||
        (badgeSettings.hideEmptyButton && !actors.length);
      badgePopover.classList.toggle("is-locked-open", badgeSettings.keepPopupOpen);
      badgeClose.disabled = badgeSettings.keepPopupOpen;
    }
    if (badgeSettings.hidePillButton && badgePopoverOpen) closeBadgePopover(true);
    if (badgeSettings.keepPopupOpen && badgeItems.length && !badgePopoverOpen)
      openBadgePopover(true);
    if (hasNew && !badgePopoverOpen) badgePill?.attention();
    const signature = badgeItems.map((item) => `${item.id}:${item.html}`).join("\u001f");
    if (signature !== badgeRenderSignature) {
      badgeRenderSignature = signature;
      badgeEmpty.hidden = badgeItems.length > 0;
      // 과거 → 최신(위 → 아래). 맨 아래 근처를 보던 중이면 새 채팅을 따라간다.
      const nearBottom = badgeList.scrollHeight - badgeList.scrollTop - badgeList.clientHeight < 32;
      badgeList.innerHTML = badgeItems.slice().reverse().map((item) => item.html).join("");
      if (nearBottom) badgeList.scrollTop = badgeList.scrollHeight;
    }
  }

  $("mvChatPopupVodScaleDown").addEventListener("click", () => stepVodScale(-1));
  $("mvChatPopupVodScaleUp").addEventListener("click", () => stepVodScale(1));
  badgeTrigger?.addEventListener("click", () => {
    if (badgeSettings.keepPopupOpen && badgePopoverOpen) return;
    openBadgePopover(!badgePopoverOpen);
  });
  badgeClose?.addEventListener("click", () => closeBadgePopover());
  document.addEventListener("pointerdown", (event) => {
    if (badgePopoverOpen && !badgeSettings.keepPopupOpen && !badgeAnchor?.contains(event.target))
      closeBadgePopover();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && badgePopoverOpen && !badgeSettings.keepPopupOpen)
      closeBadgePopover();
  });

  badgeResize?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    badgeResizeStart = { y: event.clientY, height: badgePopoverHeight, pointerId: event.pointerId };
    badgeResize.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  badgeResize?.addEventListener("pointermove", (event) => {
    if (!badgeResizeStart || badgeResizeStart.pointerId !== event.pointerId) return;
    const maxHeight = Math.max(120, Math.min(720, window.innerHeight - 16));
    badgePopoverHeight = Math.max(120, Math.min(maxHeight,
      badgeResizeStart.height + event.clientY - badgeResizeStart.y));
    badgePopover.style.height = `${badgePopoverHeight}px`;
    badgeResize.setAttribute("aria-valuenow", String(Math.round(badgePopoverHeight)));
  });
  const stopBadgeResize = (event) => {
    if (badgeResizeStart?.pointerId === event.pointerId) badgeResizeStart = null;
  };
  badgeResize?.addEventListener("pointerup", stopBadgeResize);
  badgeResize?.addEventListener("pointercancel", stopBadgeResize);
  badgeResize?.addEventListener("lostpointercapture", stopBadgeResize);
  badgeResize?.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    badgePopoverHeight = Math.max(120, Math.min(720,
      badgePopoverHeight + (event.key === "ArrowUp" ? 24 : -24)));
    positionBadgePopover();
  });

  function send(type, detail = {}) {
    channel.postMessage({ source: SOURCE, sessionId, type, ...detail });
  }

  function applyTheme(dark) {
    currentThemeDark = dark;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    if (!chatFrameReady) return;
    try {
      frame.contentWindow.postMessage(
        {
          source: MULTIVIEW_SOURCE,
          type: "SET_MULTIVIEW_CHAT_VIEW",
          dark,
        },
        CHZZK_ORIGIN,
      );
    } catch {}
  }

  function setStatus(status, message = "") {
    const overlay = $("mvChatPopupOverlay");
    const retry = $("mvChatPopupRetry");
    const statusLabel = $("mvChatPopupStatus");
    const text = status === "ready"
      ? "연결됨"
      : status === "unavailable"
        ? message || "다시보기 채팅은 멀티뷰에서 지원하지 않습니다."
      : status === "empty"
        ? message || "현재 재생 구간에 채팅이 없습니다."
      : status === "error"
        ? message || "채팅을 불러오지 못했습니다."
        : "채팅 연결 중…";
    statusLabel.textContent = text;
    statusLabel.dataset.state = status;
    overlay.dataset.state = status;
    $("mvChatPopupMessage").textContent = text;
    overlay.hidden = status === "ready";
    retry.hidden = status !== "error";
  }

  function showVodChat(data) {
    const match = VIDEO_ID_RE.exec(data.channelId || "");
    if (!match || match[1] !== data.videoNo || !/^\d+$/.test(data.videoNo || "") ||
        !Number.isSafeInteger(data.generation) || data.generation < currentGeneration ||
        typeof data.channelName !== "string" || data.channelName.length > 120 ||
        typeof data.html !== "string" || data.html.length > 800000 ||
        !["loading", "ready", "empty", "error"].includes(data.status)) return;

    const changedSource = currentMediaType !== "video" || currentChannelId !== data.channelId ||
      currentGeneration !== data.generation;
    if (changedSource) {
      badgeSeenIds.clear();
      badgeRenderSignature = "";
      vodChatScrollInitialized = false;
      vodLocalChatIds.clear();
    }
    currentMediaType = "video";
    currentChannelId = data.channelId;
    currentVodVideoNo = data.videoNo;
    currentGeneration = data.generation;
    globalThis.CheeseReplayLocalChat?.applyAvatar(
      $("mvChatPopupVodComposeAvatar"), data.identity,
    );
    chatFrameReady = false;
    if (changedSource) frame.src = "about:blank";
    frame.hidden = true;
    $("mvChatPopupVod").hidden = false;
    const list = $("mvChatPopupVodList");
    // 맨 아래 근처를 보던 중이면 재생에 따라 붙는 새 채팅을 따라간다(시청 페이지와 같다).
    const nearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
    const previousScrollTop = list.scrollTop;
    list.innerHTML = data.html;
    const localRows = [...(list.querySelectorAll?.(".mv-vod-chat-row.is-local") || [])];
    const nextLocalIds = new Set(localRows.map((row) => row.dataset.chatId).filter(Boolean));
    const newLocalRow = localRows.find((row) =>
      row.dataset.chatId && !vodLocalChatIds.has(row.dataset.chatId));
    if (newLocalRow) {
      globalThis.CheeseReplayLocalChat?.revealRowAtPosition(list, newLocalRow);
      vodChatScrollInitialized = true;
    } else if (!vodChatScrollInitialized && data.html) {
      list.scrollTop = list.scrollHeight;
      vodChatScrollInitialized = true;
    } else {
      list.scrollTop = nearBottom ? list.scrollHeight : previousScrollTop;
    }
    vodChatLatest?.update();
    vodLocalChatIds = nextLocalIds;
    renderPopupBadgeChat(data.badgeChat, data.badgeChat?.hasNew === true);
    reflectVodScale();
    if (badgePopoverOpen) positionBadgePopover();
    if (typeof data.dark === "boolean") applyTheme(data.dark);

    const name = data.channelName.trim() || "채널";
    $("mvChatPopupTitle").textContent = `${name} 다시보기 채팅`;
    document.title = `${name} 다시보기 채팅 - 치즈 플래터`;
    const status = data.status === "ready" && data.html ? "ready"
      : data.status === "error" ? "error"
        : data.status === "empty" ? "empty" : "loading";
    const message = typeof data.message === "string" ? data.message.slice(0, 180) : "";
    setStatus(status, message);
    if (data.html && status !== "error") $("mvChatPopupOverlay").hidden = true;
  }

  function loadChat(data) {
    if (
      !CHANNEL_ID_RE.test(data.channelId || "") ||
      !Number.isSafeInteger(data.generation) ||
      data.generation < 0 ||
      typeof data.retry !== "boolean" ||
      typeof data.channelName !== "string" ||
      data.channelName.length > 120
    ) return;

    currentMediaType = "live";
    currentChannelId = data.channelId.toLowerCase();
    currentVodVideoNo = "";
    currentGeneration = data.generation;
    chatFrameReady = false;
    $("mvChatPopupVod").hidden = true;
    closeBadgePopover(true);
    badgeSeenIds.clear();
    badgeItems = [];
    badgeRenderSignature = "";
    renderPopupBadgeChat({ items: [], settings: {} });
    frame.hidden = false;
    const name = data.channelName.trim() || "채팅";
    $("mvChatPopupTitle").textContent = `${name} 채팅`;
    document.title = `${name} 채팅 - 치즈 플래터`;
    setStatus("loading");

    const url = new URL(`/live/${currentChannelId}/chat`, CHZZK_ORIGIN);
    url.searchParams.set("cheeseMultiChat", "1");
    url.searchParams.set("cheeseMultiChatGeneration", String(currentGeneration));
    if (data.retry) url.searchParams.set("cheeseRetry", String(currentGeneration));
    frame.src = url.toString();
  }

  function showUnavailable(data) {
    if (!Number.isSafeInteger(data.generation) || data.generation < currentGeneration) return;
    currentChannelId = "";
    currentVodVideoNo = "";
    currentMediaType = "unavailable";
    currentGeneration = data.generation;
    chatFrameReady = false;
    frame.src = "about:blank";
    frame.hidden = false;
    $("mvChatPopupVod").hidden = true;
    closeBadgePopover(true);
    badgeSeenIds.clear();
    badgeItems = [];
    badgeRenderSignature = "";
    renderPopupBadgeChat({ items: [], settings: {} });
    const message = typeof data.message === "string"
      ? data.message.slice(0, 180)
      : "다시보기 채팅은 멀티뷰에서 지원하지 않습니다.";
    $("mvChatPopupTitle").textContent = "다시보기 채팅 미지원";
    document.title = "다시보기 채팅 미지원 - 치즈 플래터";
    setStatus("unavailable", message);
  }

  channel.onmessage = (event) => {
    const data = event.data;
    if (data?.source !== SOURCE || data.sessionId !== sessionId) return;
    if (data.type === "LOAD_CHAT") {
      loadChat(data);
      return;
    }
    if (data.type === "VOD_CHAT_UPDATE") {
      showVodChat(data);
      return;
    }
    if (data.type === "CHAT_UNAVAILABLE") {
      showUnavailable(data);
      return;
    }
    if (data.type === "SET_THEME" && typeof data.dark === "boolean") {
      applyTheme(data.dark);
      return;
    }
    if (
      data.type === "CHAT_STATUS" &&
      data.channelId === currentChannelId &&
      data.generation === currentGeneration &&
      ["loading", "ready", "error", "unavailable"].includes(data.status)
    ) {
      setStatus(data.status, typeof data.message === "string" ? data.message.slice(0, 180) : "");
    }
  };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.origin !== CHZZK_ORIGIN ||
      event.source !== frame.contentWindow ||
      data?.source !== MULTIVIEW_SOURCE ||
      data.type !== "CHAT_FRAME_READY" ||
      data.channelId !== currentChannelId ||
      data.generation !== currentGeneration
    ) return;
    chatFrameReady = true;
    applyTheme(currentThemeDark);
    send("CHAT_FRAME_READY", {
      channelId: data.channelId,
      generation: data.generation,
    });
  });

  $("mvChatPopupRetry").addEventListener("click", () => send("RETRY_CHAT"));
  $("mvChatPopupReturn").addEventListener("click", () => send("RETURN_TO_PAGE"));
  window.addEventListener("beforeunload", () => {
    badgePill?.dispose();
    badgeMotion?.dispose();
    send("POPUP_CLOSED");
    channel.close();
  }, { once: true });

  send("POPUP_READY");
})();
