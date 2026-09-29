// 멀티뷰 채팅 칸의 업적 배지 ID 표시 (MAIN world).
// 치지직 채팅창은 업적 배지(치지직 컵·치스티벌 등)를 이미지로 그리지 않는다. 배지 ID 는
// 채팅 메시지 데이터(profile.streamingProperty.activatedAchievementBadgeIds)에만 있고,
// 배지 모아 챗도 이 ID 로 매핑 표(achievementBadgeMap.js)에서 이미지를 찾는다.
// React 데이터는 격리 월드(multiviewBadgeChat.js)에서 보이지 않으므로, 여기서 채팅 줄에
// 배지 ID 를 속성으로 남기고 격리 월드가 그 속성을 읽는다.
((root) => {
  "use strict";

  const ATTR = "data-cheese-achievement-badge-id";
  // multiviewBadgeChat.js 의 하이라이터와 같은 기준으로 줄을 정한다(같은 요소에 표시).
  const MESSAGE_SELECTOR =
    '[class*="_chatting_message_"], [class*="chatting_message_container"]';
  const ROW_SELECTOR =
    '[class*="live_chatting_list_item"], [class*="vod_chatting_item"], [class*="_item_"]';
  const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

  function reactValue(node, prefix) {
    const key = Object.keys(node).find((name) => name.startsWith(prefix));
    return key ? node[key] : null;
  }

  // 줄 자신의 props 또는 자식 방향 fiber 에서만 찾는다(chatTimestamp.js 와 같다).
  // ⚠ 부모 방향으로 올라가면 이웃 줄·목록 단위의 다른 메시지를 잡을 수 있다.
  function chatMessageOf(element) {
    const direct = reactValue(element, "__reactProps$")?.children?.props?.chatMessage;
    if (direct && typeof direct === "object") return direct;
    let fiber = reactValue(element, "__reactFiber$");
    for (let guard = 0; fiber && guard < 60; guard += 1) {
      const props = fiber.memoizedProps;
      const message = props?.chatMessage || props?.children?.props?.chatMessage;
      if (message && typeof message === "object") return message;
      fiber = fiber.child;
    }
    return null;
  }

  // 배지 모아 챗의 getFirstActivatedAchievementBadgeId 와 같다(첫 번째 활성 배지 하나).
  function achievementBadgeId(chatMessage) {
    let profile = chatMessage?.profile;
    if (typeof profile === "string") {
      try {
        profile = JSON.parse(profile);
      } catch {
        profile = null;
      }
    }
    const ids = profile?.streamingProperty?.activatedAchievementBadgeIds;
    const id = String(Array.isArray(ids) ? ids[0] || "" : "").trim();
    return ID_RE.test(id) ? id : "";
  }

  function stampRow(row) {
    let id = "";
    try {
      id = achievementBadgeId(chatMessageOf(row));
    } catch {}
    if (id) {
      if (row.getAttribute(ATTR) !== id) row.setAttribute(ATTR, id);
    } else if (row.hasAttribute(ATTR)) {
      row.removeAttribute(ATTR);
    }
  }

  function stampWithin(node) {
    if (!(node instanceof Element)) return;
    const messages = node.matches(MESSAGE_SELECTOR)
      ? [node]
      : [...node.querySelectorAll(MESSAGE_SELECTOR)];
    const own = node.closest?.(MESSAGE_SELECTOR);
    if (own) messages.push(own);
    for (const message of messages) {
      const row = message.closest(ROW_SELECTOR);
      if (row) stampRow(row);
    }
  }

  const api = { ATTR, achievementBadgeId, chatMessageOf, stampRow };
  root.CheeseMultiviewAchievementBridge = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  const win = root.window;
  if (!win || win === win.top || win.location?.origin !== "https://chzzk.naver.com") return;
  const params = new URLSearchParams(win.location.search);
  if (
    params.get("cheeseMultiChat") !== "1" ||
    !/^\/live\/[0-9a-f]{32}\/chat\/?$/i.test(win.location.pathname)
  )
    return;

  // 하이라이터는 다음 애니메이션 프레임에 줄을 읽는다. 이 콜백은 그보다 먼저 돌아
  // 대부분 캡처 전에 표시된다. 늦으면 하이라이터가 속성 변화를 보고 다시 읽는다.
  const observer = new win.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(stampWithin);
    }
  });
  const start = () => {
    const target = win.document.body || win.document.documentElement;
    if (!target) return;
    observer.observe(target, { childList: true, subtree: true });
    stampWithin(target);
  };
  if (win.document.body) start();
  else win.addEventListener("DOMContentLoaded", start, { once: true });
  win.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
