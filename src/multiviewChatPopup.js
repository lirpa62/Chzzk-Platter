// 멀티뷰 채팅 분리 창. 채팅 페이지 URL은 여기서 고정 경로로만 만든다.
(() => {
  "use strict";

  const SOURCE = "cheese-platter-multiview-chat-popup";
  const MULTIVIEW_SOURCE = "cheese-platter-multiview";
  const CHZZK_ORIGIN = "https://chzzk.naver.com";
  const CHANNEL_ID_RE = /^[0-9a-f]{32}$/i;
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
  let currentGeneration = -1;
  let chatFrameReady = false;
  let currentThemeDark = document.documentElement.dataset.theme === "dark";

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
      : status === "error"
        ? message || "채팅을 불러오지 못했습니다."
        : "채팅 연결 중…";
    statusLabel.textContent = text;
    statusLabel.dataset.state = status;
    $("mvChatPopupMessage").textContent = text;
    overlay.hidden = status === "ready";
    retry.hidden = status !== "error";
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

    currentChannelId = data.channelId.toLowerCase();
    currentGeneration = data.generation;
    chatFrameReady = false;
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

  channel.onmessage = (event) => {
    const data = event.data;
    if (data?.source !== SOURCE || data.sessionId !== sessionId) return;
    if (data.type === "LOAD_CHAT") {
      loadChat(data);
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
      ["loading", "ready", "error"].includes(data.status)
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
    send("POPUP_CLOSED");
    channel.close();
  }, { once: true });

  send("POPUP_READY");
})();
