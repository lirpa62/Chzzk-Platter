// 채팅 강화 — 시간 표시 + 가려진 채팅 복원 (MAIN world)
// 배지 모아 챗(badge-moa-chat) 로직 이식. (1) 각 채팅 앞에 회색 시간 표시,
// (2) 클린봇/블라인드로 가려진 메시지를 원문으로 복원. 둘 다 치지직 React 내부
// 데이터(chatMessage)에서 읽으므로 MAIN world가 필요하다(__reactProps$/__reactFiber$는
// 격리 월드에서 안 보임). 마커는 우리 고유 클래스 — moa의 chzzk-badge-moa-* 와 분리.
// 설정은 content.js(격리)가 cheese-feature-flags postMessage로 전달한다.
(async () => {
  "use strict";

  async function masterEnabled() {
    const root = document.documentElement;
    for (let i = 0; i < 100; i += 1) {
      if (root?.dataset.cheesePlatterMasterReady === "1") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return !root?.hasAttribute("data-cheese-platter-disabled");
  }
  if (!(await masterEnabled())) return;

  let showChatTimestamp = false;
  let chatTimestampFormat = "24h";
  let restoreBlindedChat = false;

  // 다시보기 채팅은 이미 블라인드 처리된 기록만 내려와 React props에도 원문이 없다.
  // 복원을 시도해도 성공할 수 없고, 빠른 탐색 중 재사용되는 행을 계속 분석하면 채팅
  // 로딩과 메인 스레드에 부담만 준다. 설정값은 유지하되 라이브에서만 유효하게 취급한다.
  function getHostPagePathname() {
    try {
      if (window.top?.location?.origin === location.origin) {
        return window.top.location.pathname;
      }
    } catch {
      // 교차 출처 상위 프레임이면 현재 경로/리퍼러로 판정한다.
    }
    if (/^\/(?:live|video)\//.test(location.pathname)) {
      return location.pathname;
    }
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === location.origin) return referrer.pathname;
    } catch {}
    return location.pathname;
  }

  function isVodChatPage(pathname = getHostPagePathname()) {
    if (/^\/video\/\d+(?:\/|$)/.test(pathname)) return true;
    if (/^\/live\/[0-9a-f]{32}(?:\/|$)/i.test(pathname)) return false;
    return Boolean(document.querySelector("aside#vod-aside"));
  }

  let currentHostPath = getHostPagePathname();
  let vodChatPage = isVodChatPage(currentHostPath);

  function isBlindRestoreActive() {
    // 다시보기에서도 동작시킨다. 블라인드 처리 메시지는 원문이 기록에 남지 않아 대부분
    // 복원되지 않지만, 클린봇 메시지는 원문이 그대로 내려와 복원이 가능하다.
    // 복원할 원문이 없는 행은 restoreUnavailableRows 로 한 번만 표시하고 재시도를
    // 멈추므로(무한 재처리 없음), 켜 두어도 부하가 늘지 않는다.
    //
    // ⚠ 관리자 전용 채팅에서는 복원만 끈다. 예전엔 이 상태에서 옵저버를 통째로
    // 멈췄는데, 오프라인 채널 입장 시에도 이 공지가 떠 있어 '시간 표시'까지 함께
    // 죽었다(제보). 무한 재시도를 막으려던 목적은 복원 쪽에만 해당한다.
    return restoreBlindedChat && !isAdminOnlyChatActive();
  }

  let chatRowObserver = null;
  let observedChatContainers = []; // 현재 감시 중인 채팅 컨테이너(교체 감지용)
  let retryTimer = 0;
  const rowRetryState = new WeakMap();
  const ROW_RETRY_DELAYS = [50, 150, 350, 700];
  const CHAT_ROW_SELECTOR =
    "[class*='live_chatting_list_item'], [class*='vod_chatting_item'], [class*='_item_']";
  const CHAT_MESSAGE_SELECTOR = "[class*='_chatting_message_']";
  const OWNED_CHAT_NODE_SELECTOR =
    ".cheese-chat-time, .cheese-blind-restored-text, .cheese-blind-emoji";
  const pendingChatRows = new Set();
  const PENDING_CHAT_ROW_MAX = 240;
  const ROW_BATCH_MAX = 40;
  const ROW_BATCH_BUDGET_MS = 6;
  const CHAT_SCROLL_SETTLE_MS = 180;
  const CHAT_SCROLL_INTENT_MS = 700;
  let rowBatchFrame = 0;
  let rowBatchResumeTimer = 0;
  let chatScrollActiveUntil = 0;
  let chatScrollIntentUntil = 0;

  // 가려진 채팅 복원용 상태.
  const BLIND_PLACEHOLDER_TEXTS = [
    "메시지가 블라인드 처리되었습니다.",
    "클린봇이 부적절한 표현을 감지했습니다.",
  ];
  const ADMIN_ONLY_CHAT_TITLE = "관리자 전용 채팅이 활성화 되었습니다.";
  // 관리자 전용 공지는 고정 배너가 아니라 채팅 리스트의 한 행(_item_)이라, 이후 채팅이
  // 쌓이거나 가상 스크롤이 돌면 리스트에서 밀려나 사라진다. 그때마다 감지가 풀려 복원
  // 재시도가 되살아나므로, 한 번 보이면 래치해 두고 경로 이동에서만 해제한다.
  let adminOnlyChatLatched = false;
  // 행 → { placeholder, nickname }: OFF 시 원래 가림 문구로 되돌리기 위함.
  const restoredRowInfo = new WeakMap();
  // 치지직 React가 같은 행을 원래 상태로 계속 되돌리는 경우 확장과 렌더러가 서로
  // DOM을 다시 쓰는 루프가 생기지 않도록, 같은 메시지에는 복원 쓰기를 제한한다.
  let restoreWriteState = new WeakMap();
  const RESTORE_WRITE_MAX = 3;
  // 라이브에서도 진입 전에 이미 가려져 원문을 구할 수 없는 행이 있다. 이 행들을 표시해
  // 두지 않으면 processRow의 done 마커가 매 스윕 무효화되고(복원이 영영 pending),
  // 행마다 React fiber 탐색(최대 60단계)이 반복된다.
  let restoreUnavailableRows = new WeakSet();
  // 원문 캐시(uid|messageTime → {text, emojis}). 치지직이 블라인드 처리 시 그 행의
  // React chatMessage.content 를 비워버리면, 가려진 뒤 읽으면 원문이 없어 복원이 안 된다
  // (같은 유저의 여러 메시지 중 일부만 복원되던 문제). 그래서 행이 아직 안 가려진 동안
  // 미리 원문을 캐시해 두고, 복원 시 props 에 원문이 없으면 이 캐시에서 꺼낸다.
  const originalMsgCache = new Map();
  const ORIGINAL_CACHE_MAX = 800; // 오래된 항목은 순서대로 버려 메모리 상한 유지

  function chatCacheKey(chatMessage) {
    if (!chatMessage || typeof chatMessage !== "object") return "";
    const uid =
      chatMessage.userId ||
      chatMessage.uid ||
      chatMessage.userIdHash ||
      chatMessage.senderId ||
      "";
    const t = readChatEpochMs(chatMessage);
    if (!uid || !t) return "";
    return `${uid}|${t}`;
  }

  function cacheOriginalMessage(chatMessage) {
    const key = chatCacheKey(chatMessage);
    if (!key || originalMsgCache.has(key)) return;
    const original = readChatOriginal(chatMessage);
    if (!original || !original.text) return;
    originalMsgCache.set(key, original);
    if (originalMsgCache.size > ORIGINAL_CACHE_MAX) {
      // 가장 오래된 항목 하나 제거(Map 은 삽입 순서 유지).
      const firstKey = originalMsgCache.keys().next().value;
      if (firstKey !== undefined) originalMsgCache.delete(firstKey);
    }
  }

  // ── React 내부 접근 ──────────────────────────────────────────────────────
  function getReactProps(node) {
    if (node == null) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
    return key ? node[key] : null;
  }

  function getReactFiber(node) {
    if (node == null) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  // 채팅 행 노드에서 React props의 chatMessage 객체를 얻는다.
  function getChatMessage(row) {
    const props = getReactProps(row);
    const direct =
      props && props.children && props.children.props
        ? props.children.props.chatMessage
        : null;
    if (direct && typeof direct === "object") return direct;
    // 폴백: fiber 서브트리에서 chatMessage를 가진 props 탐색
    let fiber = getReactFiber(row);
    let guard = 0;
    while (fiber != null && guard < 60) {
      const mp = fiber.memoizedProps;
      if (mp) {
        if (mp.chatMessage && typeof mp.chatMessage === "object") {
          return mp.chatMessage;
        }
        if (
          mp.children &&
          mp.children.props &&
          mp.children.props.chatMessage &&
          typeof mp.children.props.chatMessage === "object"
        ) {
          return mp.children.props.chatMessage;
        }
      }
      fiber = fiber.child;
      guard += 1;
    }
    return null;
  }

  // 실제 전송 시각(epoch ms)을 찾는다. playerMessageTime(영상 경과)은 제외.
  function readChatEpochMs(chatMessage) {
    if (!chatMessage || typeof chatMessage !== "object") return null;
    const candidates = [
      chatMessage.time,
      chatMessage.messageTime,
      chatMessage.createTime,
      chatMessage.ctime,
      chatMessage.regTime,
      chatMessage.msgTime,
    ];
    for (const value of candidates) {
      const n = Number(value);
      // 2001년 이후(ms)만 타당한 실제 시각으로 인정
      if (Number.isFinite(n) && n > 1e12) return n;
    }
    return null;
  }

  function parseJsonSafe(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  // chatMessage에서 원문 텍스트와 이모티콘 맵을 읽는다(객체/JSON 문자열 모두).
  // 채팅 content 를 문자열로 정규화한다. 보통 문자열이지만, 관리자 전용 전환 타이밍과의
  // 레이스 등으로 content 가 세그먼트 '객체 배열'로 올 때가 있다. 그대로 String() 하면
  // "[object Object],[object Object]..." 가 되므로, 배열이면 각 세그먼트에서 텍스트를
  // 뽑아 잇는다(객체는 text/value/content/message/msg 순, 문자열 요소는 그대로).
  function normalizeChatContent(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((seg) => {
          if (typeof seg === "string") return seg;
          if (seg && typeof seg === "object") {
            const t =
              seg.text ?? seg.value ?? seg.content ?? seg.message ?? seg.msg;
            return typeof t === "string" ? t : "";
          }
          return "";
        })
        .join("");
    }
    if (typeof content === "object") {
      const t =
        content.text ??
        content.value ??
        content.content ??
        content.message ??
        content.msg;
      return typeof t === "string" ? t : "";
    }
    return String(content);
  }

  function isBlindPlaceholderText(value) {
    const text = String(value || "").trim();
    return BLIND_PLACEHOLDER_TEXTS.includes(text);
  }

  // 공지 행 구조: div._item_ > div._container_ > div._inner_ > p._title_ + p._description_
  // 제목 p 에만 클래스가 붙어 있어 p[class*='_title_'] 로 좁힌다(채팅 행 전체를 훑지 않음).
  const ADMIN_ONLY_TITLE_SELECTOR = "p[class*='_title_']";

  function containsAdminOnlyChatNotice(node) {
    const element =
      node instanceof Element
        ? node
        : node?.parentElement instanceof Element
          ? node.parentElement
          : null;
    if (!element) return false;
    const candidates = element.matches(ADMIN_ONLY_TITLE_SELECTOR)
      ? [element]
      : element.querySelectorAll(ADMIN_ONLY_TITLE_SELECTOR);
    return [...candidates].some(
      (candidate) =>
        String(candidate.textContent || "").trim() === ADMIN_ONLY_CHAT_TITLE,
    );
  }

  function isAdminOnlyChatActive() {
    // 한 번 감지되면 유지한다(공지 행이 스크롤로 사라져도 상태는 그대로이므로).
    if (adminOnlyChatLatched) return true;
    const aside =
      document.querySelector("aside#aside-chatting") ||
      document.querySelector("aside#vod-aside");
    if (aside && containsAdminOnlyChatNotice(aside)) {
      adminOnlyChatLatched = true;
    }
    return adminOnlyChatLatched;
  }

  function readChatOriginal(chatMessage) {
    if (!chatMessage || typeof chatMessage !== "object") return null;
    const msgTypeCode =
      chatMessage.msgTypeCode || chatMessage.messageTypeCode || 1;
    if (msgTypeCode === 30 || msgTypeCode === 11 || msgTypeCode === 12) {
      return null; // 시스템/구독 합성 메시지 제외
    }
    const text =
      normalizeChatContent(chatMessage.content) ||
      normalizeChatContent(chatMessage.msg);
    // React props 자체가 이미 가림 문구로 교체된 경우에는 원문으로 취급하지 않는다.
    // 이 값을 다시 DOM에 쓰면 치지직 렌더와 확장이 같은 문구를 반복 교체할 수 있다.
    if (!text || isBlindPlaceholderText(text)) return null;
    let extras = chatMessage.extras;
    if (typeof extras === "string") extras = parseJsonSafe(extras);
    const emojis =
      extras && typeof extras.emojis === "object" && extras.emojis
        ? extras.emojis
        : {};
    return { text, emojis };
  }

  // ── 시간 span 삽입/제거 ───────────────────────────────────────────────────
  function normalizeChatTimestampFormat(value) {
    return value === "12h-en" || value === "12h-ko" ? value : "24h";
  }

  function formatChatTimestamp(epochMs) {
    const date = new Date(epochMs);
    const hour24 = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    if (chatTimestampFormat === "24h") {
      return `${String(hour24).padStart(2, "0")}:${minutes}`;
    }
    const hour12 = hour24 % 12 || 12;
    if (chatTimestampFormat === "12h-ko") {
      return `${hour24 < 12 ? "오전" : "오후"} ${hour12}:${minutes}`;
    }
    return `${hour24 < 12 ? "AM" : "PM"} ${hour12}:${minutes}`;
  }

  // 닉네임 앞에 회색 시간 span을 삽입한다. 이미 있으면 현재 설정 형식으로 갱신한다.
  function applyTimestamp(row, epochMs) {
    const existing = row.querySelector(":scope .cheese-chat-time");
    if (existing) {
      const epochText = String(epochMs);
      const formatted = formatChatTimestamp(epochMs);
      if (existing.dataset.chatEpochMs !== epochText) {
        existing.dataset.chatEpochMs = epochText;
      }
      if (existing.textContent !== formatted) {
        existing.textContent = formatted;
      }
      return true;
    }
    const nicknameBtn =
      row.querySelector("button[class*='_nickname_']") ||
      row.querySelector("[class*='_nickname_']");
    if (!nicknameBtn || !nicknameBtn.parentNode) return false;
    const span = document.createElement("span");
    span.className = "cheese-chat-time";
    span.dataset.chatEpochMs = String(epochMs);
    span.textContent = formatChatTimestamp(epochMs);
    nicknameBtn.parentNode.insertBefore(span, nicknameBtn);
    return true;
  }

  function removeAllTimestamps() {
    document
      .querySelectorAll(".cheese-chat-time")
      .forEach((el) => el.remove());
  }

  // badge-moa-chat이 시간 표시 기능을 켰으면 우리는 양보(중복 방지).
  // 신버전 moa는 <html>에 enabled 클래스를 붙여 채팅이 없어도 즉시 감지된다.
  // 구버전 호환: 삽입된 시간 span 마커도 폴백으로 본다.
  function moaShowingTime() {
    return (
      document.documentElement.classList.contains(
        "chzzk-badge-moa-chat-timestamp-enabled",
      ) || !!document.querySelector(".chzzk-badge-moa-chat-time")
    );
  }

  // ── 가려진 채팅 복원 ──────────────────────────────────────────────────────
  // badge-moa-chat이 복원 기능을 켰으면 양보. 신버전 moa는 <html>에 enabled
  // 클래스를 붙여 가려진 채팅이 올라오기 전에도 감지된다(구버전: 복원 마커 폴백).
  function moaRestoring() {
    return (
      document.documentElement.classList.contains(
        "chzzk-badge-moa-restore-blind-enabled",
      ) || !!document.querySelector(".chzzk-badge-moa-blind-restored-text")
    );
  }

  // 메시지 텍스트 span = _chatting_message_ 하위 _text_ 중 _nickname_ 버튼 밖의 것.
  function getRowMessageSpan(row) {
    const message = row.querySelector("[class*='_chatting_message_']") || row;
    const candidates = message.querySelectorAll("[class*='_text_']");
    for (const span of candidates) {
      if (!span.closest("[class*='_nickname_']")) return span;
    }
    return null;
  }

  function getRowNickname(row) {
    const node = row.querySelector(
      "[class*='_nickname_'] [class*='_text_']",
    );
    return node ? String(node.textContent || "").trim() : "";
  }

  function isHiddenRow(row) {
    return (
      row.matches("[class*='_is_hidden_']") ||
      !!row.querySelector("[class*='_is_hidden_']")
    );
  }

  function getRestorablePlaceholder(row) {
    if (!isHiddenRow(row)) return "";
    const span = getRowMessageSpan(row);
    if (!(span instanceof HTMLElement)) return "";
    const current = String(span.textContent || "").trim();
    if (isBlindPlaceholderText(current)) return current;
    const restored = restoredRowInfo.get(row);
    const originalPlaceholder = String(restored?.placeholder || "").trim();
    if (
      span.classList.contains("cheese-blind-restored-text") &&
      isBlindPlaceholderText(originalPlaceholder)
    ) {
      return originalPlaceholder;
    }
    return "";
  }

  function canWriteRestore(row, chatMessage, placeholder) {
    const signature = [
      chatCacheKey(chatMessage),
      getRowNickname(row),
      placeholder,
    ].join("|");
    const previous = restoreWriteState.get(row);
    const state =
      previous?.signature === signature
        ? previous
        : { signature, attempts: 0 };
    if (state.attempts >= RESTORE_WRITE_MAX) return false;
    state.attempts += 1;
    restoreWriteState.set(row, state);
    return true;
  }

  function getBlindRestoreLabel(placeholder) {
    const text = String(placeholder || "");
    if (text.includes("클린봇")) return "(클린봇)";
    if (text.includes("블라인드")) return "(블라인드)";
    return "";
  }

  // {:emojiKey:} 토큰을 텍스트 노드 + <img>로 조립.
  function buildRestoredMessageFragment(text, emojiMap) {
    const fragment = document.createDocumentFragment();
    // text 는 보통 문자열이지만, 방어적으로 정규화(배열/객체 → 텍스트)해 절대
    // "[object Object]" 가 표시되지 않게 한다.
    const messageText =
      typeof text === "string" ? text : normalizeChatContent(text);
    if (!messageText) return fragment;
    const hasEmojis =
      emojiMap &&
      typeof emojiMap === "object" &&
      Object.keys(emojiMap).length > 0;
    if (!hasEmojis) {
      fragment.appendChild(document.createTextNode(messageText));
      return fragment;
    }
    const tokenPattern = /\{:([^:}]+):\}/g;
    let lastIndex = 0;
    let match = null;
    while ((match = tokenPattern.exec(messageText)) !== null) {
      const key = String(match[1] || "").trim();
      const url = emojiMap[key];
      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(messageText.slice(lastIndex, match.index)),
        );
      }
      if (typeof url === "string" && url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.className = "cheese-blind-emoji";
        img.width = 24;
        img.height = 24;
        img.loading = "lazy";
        img.decoding = "async";
        img.draggable = false;
        fragment.appendChild(img);
      } else {
        fragment.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = tokenPattern.lastIndex;
    }
    if (lastIndex < messageText.length) {
      fragment.appendChild(
        document.createTextNode(messageText.slice(lastIndex)),
      );
    }
    return fragment;
  }

  // 가려진 행을 원문(텍스트+이모티콘)으로 복원.
  function applyRestore(row, original) {
    const span = getRowMessageSpan(row);
    if (!(span instanceof HTMLElement)) return;
    if (!restoredRowInfo.has(row)) {
      restoredRowInfo.set(row, {
        placeholder: String(span.textContent || ""),
        nickname: getRowNickname(row),
      });
    }
    const info = restoredRowInfo.get(row);
    const label = getBlindRestoreLabel(info?.placeholder || span.textContent);
    const fragment = buildRestoredMessageFragment(
      original.text,
      original.emojis,
    );
    if (label) fragment.appendChild(document.createTextNode(` ${label}`));
    span.textContent = "";
    span.appendChild(fragment);
    span.classList.add("cheese-blind-restored-text");
  }

  // OFF: 복원된 행을 원래 가림 문구로 되돌린다.
  function revertAllRestores() {
    document
      .querySelectorAll(".cheese-blind-restored-text")
      .forEach((span) => {
        const row = span.closest("[class*='_item_']");
        const info = row ? restoredRowInfo.get(row) : null;
        span.textContent = info ? info.placeholder : span.textContent;
        span.classList.remove("cheese-blind-restored-text");
        if (row) restoredRowInfo.delete(row);
      });
  }

  function findChatRowForNode(node) {
    const element =
      node instanceof Element
        ? node
        : node?.parentElement instanceof Element
          ? node.parentElement
          : null;
    if (!element) return null;

    if (
      element.matches(CHAT_ROW_SELECTOR) &&
      element.querySelector(CHAT_MESSAGE_SELECTOR)
    ) {
      return element;
    }
    const message =
      (element.matches(CHAT_MESSAGE_SELECTOR) && element) ||
      element.closest(CHAT_MESSAGE_SELECTOR);
    const row = message?.closest(CHAT_ROW_SELECTOR);
    return row instanceof HTMLElement ? row : null;
  }

  function collectChatRows(root) {
    const rows = new Set();
    if (!(root instanceof Element)) return rows;
    const direct = findChatRowForNode(root);
    if (direct) rows.add(direct);
    root.querySelectorAll(CHAT_MESSAGE_SELECTOR).forEach((message) => {
      const row = message.closest(CHAT_ROW_SELECTOR);
      if (row instanceof HTMLElement) rows.add(row);
    });
    return rows;
  }

  function clearPendingChatRows() {
    pendingChatRows.clear();
    if (rowBatchFrame) {
      cancelAnimationFrame(rowBatchFrame);
      rowBatchFrame = 0;
    }
    if (rowBatchResumeTimer) {
      clearTimeout(rowBatchResumeTimer);
      rowBatchResumeTimer = 0;
    }
  }

  function schedulePendingChatRows() {
    if (
      pendingChatRows.size === 0 ||
      rowBatchFrame ||
      rowBatchResumeTimer ||
      document.hidden ||
      !anyChatEnhanceOn()
    ) {
      return;
    }

    const scrollWait = chatScrollActiveUntil - performance.now();
    if (scrollWait > 0) {
      rowBatchResumeTimer = window.setTimeout(() => {
        rowBatchResumeTimer = 0;
        schedulePendingChatRows();
      }, Math.ceil(scrollWait));
      return;
    }

    rowBatchFrame = requestAnimationFrame(flushPendingChatRows);
  }

  function flushPendingChatRows() {
    rowBatchFrame = 0;
    if (document.hidden || !anyChatEnhanceOn()) {
      pendingChatRows.clear();
      return;
    }
    if (performance.now() < chatScrollActiveUntil) {
      schedulePendingChatRows();
      return;
    }

    const startedAt = performance.now();
    const moaTimeActive = moaShowingTime();
    const moaRestoreActive = moaRestoring();
    let processed = 0;
    let scanned = 0;
    for (const row of pendingChatRows) {
      pendingChatRows.delete(row);
      scanned += 1;
      if (row.isConnected) {
        processRow(row, moaTimeActive, moaRestoreActive);
        processed += 1;
      }
      if (
        processed >= ROW_BATCH_MAX ||
        scanned >= ROW_BATCH_MAX * 4 ||
        performance.now() - startedAt >= ROW_BATCH_BUDGET_MS
      ) {
        break;
      }
    }
    if (pendingChatRows.size > 0) {
      schedulePendingChatRows();
    }
  }

  function queueChatRow(row, invalidate = false) {
    if (
      !(row instanceof HTMLElement) ||
      !row.isConnected ||
      !anyChatEnhanceOn() ||
      document.hidden
    ) {
      return;
    }
    if (invalidate) delete row.dataset.cheeseRowDone;
    pendingChatRows.add(row);
    // 긴 가상 스크롤 중 화면에서 이미 사라진 행을 계속 붙잡아 두지 않는다. 최신 행만
    // 남겨도 정지 후 현재 DOM을 처리하는 데 충분하며, 임시 메모리 증가도 제한된다.
    if (pendingChatRows.size > PENDING_CHAT_ROW_MAX) {
      pendingChatRows.delete(pendingChatRows.values().next().value);
    }
    schedulePendingChatRows();
  }

  function getChatAsideFromEvent(event) {
    const target =
      event.target instanceof Element
        ? event.target
        : document.activeElement instanceof Element
          ? document.activeElement
          : null;
    return target?.closest("aside#aside-chatting, aside#vod-aside") || null;
  }

  function deferChatRowProcessing() {
    chatScrollActiveUntil = performance.now() + CHAT_SCROLL_SETTLE_MS;
    if (rowBatchFrame) {
      cancelAnimationFrame(rowBatchFrame);
      rowBatchFrame = 0;
    }
    schedulePendingChatRows();
  }

  function markChatScrollIntent(event) {
    if (!getChatAsideFromEvent(event)) return;
    chatScrollIntentUntil = performance.now() + CHAT_SCROLL_INTENT_MS;
    deferChatRowProcessing();
  }

  // 과거 채팅을 탐색하면 치지직이 가상 목록의 행을 계속 교체한다. 이때 시간 표시와
  // 블라인드 복원을 매 프레임 실행하면 저사양 환경에서 영상 디코딩까지 밀릴 수 있다.
  // 휠·터치·스크롤바 입력 중에는 행을 큐에만 모으고, 입력이 잠시 멈춘 뒤 최신 DOM을
  // 묶어서 처리한다. 새 채팅 도착에 따른 자동 스크롤은 입력 의도가 없어 보류하지 않는다.
  ["wheel", "touchmove", "pointerdown"].forEach((type) => {
    document.addEventListener(type, markChatScrollIntent, {
      capture: true,
      passive: true,
    });
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(
          event.key,
        )
      ) {
        markChatScrollIntent(event);
      }
    },
    true,
  );
  document.addEventListener(
    "scroll",
    (event) => {
      if (
        performance.now() >= chatScrollIntentUntil ||
        !getChatAsideFromEvent(event)
      ) {
        return;
      }
      deferChatRowProcessing();
    },
    { capture: true, passive: true },
  );

  function isOwnedChatNode(node) {
    if (node instanceof Element) {
      return (
        node.matches(OWNED_CHAT_NODE_SELECTOR) ||
        !!node.closest(OWNED_CHAT_NODE_SELECTOR)
      );
    }
    return (
      node?.parentElement instanceof Element &&
      !!node.parentElement.closest(OWNED_CHAT_NODE_SELECTOR)
    );
  }

  function isExtensionOnlyMutation(mutation) {
    if (isOwnedChatNode(mutation.target)) return true;
    let changedCount = 0;
    for (const node of mutation.addedNodes) {
      changedCount += 1;
      if (!isOwnedChatNode(node)) return false;
    }
    for (const node of mutation.removedNodes) {
      changedCount += 1;
      if (!isOwnedChatNode(node)) return false;
    }
    return changedCount > 0;
  }

  // 채팅 행 하나 처리: 시간 삽입 + 가림 복원.
  function processRow(
    row,
    moaTimeActive = moaShowingTime(),
    moaRestoreActive = moaRestoring(),
  ) {
    if (!(row instanceof HTMLElement)) return false;
    const restoreActive = isBlindRestoreActive() && !moaRestoreActive;
    // 스윕 재방문 최적화: 이미 처리 완료로 표시된 행은 React fiber/props 접근 없이 즉시
    // 반환한다. 예전엔 컨테이너 재부착(헬스체크) 때마다 전체 행을 fiber 접근 포함으로
    // 재처리해(수백 행 × 반복) 채팅 폭주 방송에서 큰 메인스레드 부하였다(프로파일 실측
    // ~500ms/스윕). 예외는 React 재렌더로 시간 요소가 사라졌거나, 처리 후 새로
    // 가려졌는데 아직 미복원인 행뿐이다. 해당 행만 아래 일반 경로로 재처리한다.
    if (row.dataset.cheeseRowDone === "1") {
      const restorablePlaceholder = restoreActive
        ? getRestorablePlaceholder(row)
        : "";
      const doneSpan = restoreActive ? getRowMessageSpan(row) : null;
      const restoredSpan =
        doneSpan?.classList.contains("cheese-blind-restored-text") === true;
      const restoredSpanStale =
        restoredSpan &&
        (!restorablePlaceholder ||
          BLIND_PLACEHOLDER_TEXTS.includes(
            String(doneSpan.textContent || "").trim(),
          ));
      const timestampMissing =
        showChatTimestamp &&
        !moaTimeActive &&
        !row.querySelector(":scope .cheese-chat-time");
      // 원문을 구할 수 없다고 이미 판명된 행은 계속 pending 으로 두지 않는다(무한 재처리).
      const restorePending =
        Boolean(restorablePlaceholder) &&
        !restoredSpan &&
        !restoreUnavailableRows.has(row);
      if (!timestampMissing && !restorePending && !restoredSpanStale) {
        clearRowRetry(row);
        return true;
      }
      if (restoredSpanStale) {
        doneSpan.classList.remove("cheese-blind-restored-text");
        restoredRowInfo.delete(row);
      }
      delete row.dataset.cheeseRowDone;
    }
    if (!row.querySelector("[class*='_chatting_message_']")) {
      scheduleRowRetry(row);
      return false;
    }
    const chatMessage = getChatMessage(row);
    if (!chatMessage) {
      scheduleRowRetry(row);
      return false;
    }

    const restoredInfo = restoredRowInfo.get(row);
    if (restoredInfo && getRowNickname(row) !== restoredInfo.nickname) {
      restoredRowInfo.delete(row);
      getRowMessageSpan(row)?.classList.remove(
        "cheese-blind-restored-text",
      );
    }

    let done = true;
    if (showChatTimestamp && !moaTimeActive) {
      const epoch = readChatEpochMs(chatMessage);
      if (!epoch || !applyTimestamp(row, epoch)) {
        done = false;
      }
    }

    const hidden = isHiddenRow(row);
    // 복원 기능이 켜져 있으면, 아직 안 가려진 행의 원문을 미리 캐시해 둔다(가려진 뒤엔
    // props 의 원문이 비워질 수 있어 늦다).
    if (restoreActive && !hidden) {
      cacheOriginalMessage(chatMessage);
    }

    const restorablePlaceholder = restoreActive
      ? getRestorablePlaceholder(row)
      : "";
    if (restorablePlaceholder) {
      const span = getRowMessageSpan(row);
      if (span && !span.classList.contains("cheese-blind-restored-text")) {
        // props 에 원문이 있으면 그걸, 없으면(치지직이 비웠으면) 캐시에서 꺼낸다.
        const original =
          readChatOriginal(chatMessage) ||
          originalMsgCache.get(chatCacheKey(chatMessage)) ||
          null;
        if (!original) {
          // 진입 전에 이미 가려지는 등 원문이 아예 없는 경우에는 다시 시도하지 않는다.
          restoreUnavailableRows.add(row);
        } else if (canWriteRestore(row, chatMessage, restorablePlaceholder)) {
          applyRestore(row, original);
        } else {
          // React와의 반복 쓰기 제한을 모두 사용한 행도 더 이상 pending으로 두지 않는다.
          restoreUnavailableRows.add(row);
        }
      }
    }
    if (done) {
      row.dataset.cheeseRowDone = "1";
      clearRowRetry(row);
    } else {
      delete row.dataset.cheeseRowDone;
      scheduleRowRetry(row);
    }
    return done;
  }

  function scheduleRowRetry(row) {
    if (
      !(row instanceof HTMLElement) ||
      !row.isConnected ||
      !anyChatEnhanceOn()
    ) {
      return;
    }
    const state = rowRetryState.get(row) || { attempt: 0, timer: 0 };
    if (state.timer || state.attempt >= ROW_RETRY_DELAYS.length) return;
    const delay = ROW_RETRY_DELAYS[state.attempt];
    state.attempt += 1;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      if (!row.isConnected || !anyChatEnhanceOn()) {
        rowRetryState.delete(row);
        return;
      }
      queueChatRow(row, true);
    }, delay);
    rowRetryState.set(row, state);
  }

  function clearRowRetry(row) {
    const state = rowRetryState.get(row);
    if (state?.timer) clearTimeout(state.timer);
    rowRetryState.delete(row);
  }

  // 처리 완료 마커 일괄 해제: 기능이 (재)활성화될 때 호출해, 꺼진 동안 처리 없이
  // 마킹만 된 행들이 다음 스윕에서 다시 처리되게 한다.
  function clearRowDoneMarkers() {
    document
      .querySelectorAll("[data-cheese-row-done]")
      .forEach((el) => delete el.dataset.cheeseRowDone);
  }

  // ── 채팅 리스트 감시 ──────────────────────────────────────────────────────
  function findChatListContainers() {
    const containers = [];
    const live = document.querySelector(
      "aside#aside-chatting [class*='live_chatting_list_container'], aside#aside-chatting [role='log']",
    );
    if (live) containers.push(live);
    const vod = document.querySelector(
      "aside#vod-aside [class*='vod_chatting_list_container'], aside#vod-aside [role='log']",
    );
    if (vod) containers.push(vod);
    if (containers.length === 0) {
      const aside =
        document.querySelector("aside#aside-chatting") ||
        document.querySelector("aside#vod-aside");
      if (aside) containers.push(aside);
    }
    return containers;
  }

  // 이미 떠 있는 행들을 한 번 훑어 시간 삽입.
  function sweepExistingRows(containers = findChatListContainers()) {
    containers.forEach((container) => {
      collectChatRows(container).forEach((row) => queueChatRow(row, true));
    });
  }

  function anyChatEnhanceOn() {
    return showChatTimestamp || isBlindRestoreActive();
  }

  function ensureChatRowObserver() {
    // ⚠ 관리자 전용 채팅이어도 옵저버를 멈추지 않는다. 시간 표시는 계속 필요하고,
    // 복원만 isBlindRestoreActive() 에서 꺼진다(오프라인 채널에서 시간 표시가
    // 사라지던 원인).
    if (!anyChatEnhanceOn()) return;
    const containers = findChatListContainers();
    if (containers.length === 0) {
      if (chatRowObserver) {
        chatRowObserver.disconnect();
        chatRowObserver = null;
      }
      observedChatContainers = [];
      clearPendingChatRows();
      scheduleRetry();
      return;
    }
    clearRetry();
    if (chatRowObserver) chatRowObserver.disconnect();
    chatRowObserver = new MutationObserver((mutations) => {
      if (document.hidden || !anyChatEnhanceOn()) return;
      // ⚠ 관리자 전용 공지 검사는 노드마다 querySelectorAll + textContent 를 돈다.
      // 과거 채팅 탐색 중에는 가상 목록이 행을 대량 교체하므로, 이 검사까지 매 변이마다
      // 돌리면 저사양에서 영상 디코딩을 밀어낸다. 공지는 '새 채팅으로 도착'하는 것이라
      // 스크롤 입력 중에는 건너뛰고, 입력이 멎은 뒤 처리 경로에서 다시 확인한다.
      if (
        performance.now() >= chatScrollActiveUntil &&
        mutations.some(
          (mutation) =>
            [...mutation.addedNodes].some(containsAdminOnlyChatNotice),
        )
      ) {
        // 공지 행이 곧 스크롤로 밀려나도 상태가 풀리지 않게 래치만 한다.
        // ⚠ 여기서 옵저버를 멈추면 시간 표시까지 죽는다(오프라인 채널 제보 원인).
        // 복원은 isBlindRestoreActive() 가 이 래치를 보고 알아서 꺼진다.
        adminOnlyChatLatched = true;
      }
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        const invalidate = !isExtensionOnlyMutation(mutation);
        const targetRow = findChatRowForNode(mutation.target);
        if (targetRow) queueChatRow(targetRow, invalidate);
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          collectChatRows(node).forEach((row) =>
            queueChatRow(row, invalidate),
          );
        });
      }
    });
    containers.forEach((c) =>
      chatRowObserver.observe(c, { childList: true, subtree: true }),
    );
    observedChatContainers = containers;
    sweepExistingRows();
  }

  // 감시 중인 컨테이너가 모두 아직 문서에 연결돼 있는지(교체되지 않았는지).
  // 현재 찾아지는 컨테이너 집합과 달라졌으면(개수 변화 포함) 건강하지 않다고 본다.
  function isChatObserverHealthy() {
    if (!chatRowObserver || observedChatContainers.length === 0) return false;
    if (observedChatContainers.some((c) => !c.isConnected)) return false;
    const current = findChatListContainers();
    if (current.length !== observedChatContainers.length) return false;
    return current.every((c) => observedChatContainers.includes(c));
  }

  function scheduleRetry() {
    // 관리자 전용이어도 재시도를 막지 않는다(시간 표시는 계속 붙어야 한다).
    if (!anyChatEnhanceOn() || document.hidden || retryTimer) {
      return;
    }
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      ensureChatRowObserver();
    }, 500);
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
  }

  function stopChatRowObserver() {
    if (chatRowObserver) {
      chatRowObserver.disconnect();
      chatRowObserver = null;
    }
    observedChatContainers = [];
    clearRetry();
    clearPendingChatRows();
  }

  // ── 설정 적용 ─────────────────────────────────────────────────────────────
  function setShowChatTimestamp(next) {
    next = next === true;
    if (next === showChatTimestamp) {
      if (next && !isChatObserverHealthy()) ensureChatRowObserver();
      return;
    }
    showChatTimestamp = next;
    if (next) {
      clearRowDoneMarkers(); // 꺼진 동안 done 마킹된 행들도 다시 처리(시간 부착)
      if (isChatObserverHealthy()) sweepExistingRows(observedChatContainers);
      else ensureChatRowObserver();
    } else {
      removeAllTimestamps();
      if (!anyChatEnhanceOn()) stopChatRowObserver();
    }
  }

  function setChatTimestampFormat(next) {
    const normalized = normalizeChatTimestampFormat(next);
    if (normalized === chatTimestampFormat) return;
    chatTimestampFormat = normalized;
    let needsSweep = false;
    document.querySelectorAll(".cheese-chat-time").forEach((span) => {
      const epochMs = Number(span.dataset.chatEpochMs);
      if (Number.isFinite(epochMs) && epochMs > 1e12) {
        span.textContent = formatChatTimestamp(epochMs);
      } else {
        span.remove();
        needsSweep = true;
      }
    });
    if (needsSweep && showChatTimestamp && !moaShowingTime()) {
      clearRowDoneMarkers();
      if (isChatObserverHealthy()) sweepExistingRows(observedChatContainers);
      else ensureChatRowObserver();
    }
  }

  function setRestoreBlindedChat(next) {
    next = next === true;
    if (next === restoreBlindedChat) {
      if (isBlindRestoreActive() && !isChatObserverHealthy()) {
        ensureChatRowObserver();
      } else if (!anyChatEnhanceOn()) {
        stopChatRowObserver();
      }
      return;
    }
    restoreBlindedChat = next;
    if (isBlindRestoreActive()) {
      clearRowDoneMarkers(); // 꺼진 동안 done 마킹된 행들도 다시 처리(캐시/복원)
      restoreUnavailableRows = new WeakSet(); // 다시 켜면 한 번은 재시도
      if (isChatObserverHealthy()) sweepExistingRows(observedChatContainers);
      else ensureChatRowObserver();
    } else {
      revertAllRestores();
      originalMsgCache.clear();
      restoreWriteState = new WeakMap();
      restoreUnavailableRows = new WeakSet();
      if (!anyChatEnhanceOn()) stopChatRowObserver();
    }
  }

  // content.js(격리)가 보내는 기능 플래그 수신.
  let flagsReceived = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-feature-flags") return;
    flagsReceived = true;
    stopFlagRequestRetry();
    const f = e.data.flags || {};
    setChatTimestampFormat(e.data.chatTimeFormat);
    // 체크=표시(true)면 각 기능 ON. (data-feature지만 '숨김'이 아니라 '켬' 의미)
    setShowChatTimestamp(f.chatShowTime === true);
    setRestoreBlindedChat(f.chatRestoreBlind === true);
  });
  // 로드 직후 현재 플래그 요청. content.js(격리 월드)와 로드 순서가 보장되지 않아
  // 첫 요청이 유실될 수 있으므로, 플래그를 받을 때까지 짧게 재시도한다(서로의 첫
  // 메시지를 놓치는 경쟁 방지 — 설정이 켜져 있어도 가끔 적용 안 되던 원인).
  let flagRequestTimer = 0;
  let flagRequestTries = 0;
  function requestFlagsOnce() {
    window.postMessage(
      { source: "cheese-feature-flags-request" },
      location.origin,
    );
  }
  function stopFlagRequestRetry() {
    if (flagRequestTimer) {
      clearInterval(flagRequestTimer);
      flagRequestTimer = 0;
    }
  }
  requestFlagsOnce();
  flagRequestTimer = window.setInterval(() => {
    flagRequestTries += 1;
    if (flagsReceived || flagRequestTries > 20) {
      stopFlagRequestRetry();
      return;
    }
    requestFlagsOnce();
  }, 300);

  // moa의 enabled 클래스가 <html>에서 켜졌다/꺼졌다 하면 양보 상태를 재평가한다.
  // moa가 켜지면 우리가 적용한 시간/복원을 거두고, 꺼지면 다시 적용한다.
  let prevMoaTime = moaShowingTime();
  let prevMoaRestore = moaRestoring();
  const moaWatcher = new MutationObserver(() => {
    const nowTime = moaShowingTime();
    const nowRestore = moaRestoring();
    if (nowTime !== prevMoaTime) {
      prevMoaTime = nowTime;
      if (nowTime) removeAllTimestamps(); // moa가 시간 표시 시작 → 우리 것 제거(양보)
      else if (showChatTimestamp) ensureChatRowObserver(); // moa 꺼짐 → 우리가 다시
    }
    if (nowRestore !== prevMoaRestore) {
      prevMoaRestore = nowRestore;
      if (nowRestore) revertAllRestores(); // moa가 복원 시작 → 우리 복원 되돌림(양보)
      else if (isBlindRestoreActive()) ensureChatRowObserver(); // moa 꺼짐 → 우리가 다시
    }
  });
  moaWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearPendingChatRows();
      return;
    }
    if (!anyChatEnhanceOn()) return;
    if (isChatObserverHealthy()) sweepExistingRows(observedChatContainers);
    else ensureChatRowObserver();
  });

  // SPA 네비게이션(라이브↔다시보기↔채널)으로 채팅 컨테이너가 바뀌면 재부착.
  // 추가로, 경로 변화 없이 React 재렌더로 채팅 컨테이너가 교체(detach)된 경우에도
  // 감시 컨테이너가 죽으면(observer가 죽은 노드를 봄) 재부착한다 — 설정이 켜져
  // 있어도 가끔 시간/복원이 안 나타나던 또 다른 원인.
  let lastPath = currentHostPath;
  // 2초 주기 + 백그라운드 탭 스킵. 재부착 시 스윕은 processRow 의 done 마커 덕에 이미
  // 처리된 행을 fiber 접근 없이 건너뛰므로(위 참조) 저렴하다.
  setInterval(() => {
    if (document.hidden) return; // 보이지 않는 탭은 다시 보일 때 다음 주기에 복구
    const nextPath = getHostPagePathname();
    const nextVodChatPage = isVodChatPage(nextPath);
    // ⚠ 경로 변화 검사가 관리자 전용 검사보다 먼저다. 순서가 반대면 래치가 걸린 뒤
    // 다른 방송으로 이동해도 아래 리셋에 도달하지 못해 복원이 영영 안 살아난다.
    if (nextPath !== lastPath || nextVodChatPage !== vodChatPage) {
      lastPath = nextPath;
      currentHostPath = nextPath;
      vodChatPage = nextVodChatPage;
      stopChatRowObserver();
      removeAllTimestamps();
      revertAllRestores();
      originalMsgCache.clear();
      restoreWriteState = new WeakMap();
      restoreUnavailableRows = new WeakSet();
      adminOnlyChatLatched = false; // 새 페이지에서는 다시 판정
      clearPendingChatRows();
      if (isBlindRestoreActive()) clearRowDoneMarkers();
      if (anyChatEnhanceOn()) ensureChatRowObserver();
      return;
    }
    if (!anyChatEnhanceOn()) return;
    // 감시 중인 컨테이너가 더 이상 문서에 없으면(교체됨) 새 컨테이너에 재부착.
    if (!isChatObserverHealthy()) ensureChatRowObserver();
  }, 2000);
})();
