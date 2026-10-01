(() => {
  "use strict";

  const MAX_MESSAGE_LENGTH = 300;
  const MAX_MESSAGES = 200;
  const LOCAL_ROW_ATTR = "data-cheese-replay-local-chat";
  const ROW_SELECTOR = "[class*='_item_']";
  const COMPOSER_DISPOSE = Symbol("replayLocalChatDispose");
  // 입력 잠금(광고·채팅 불러오는 중). form[COMPOSER_SET_BLOCKED](true|false)
  const COMPOSER_SET_BLOCKED = Symbol("replayLocalChatSetBlocked");
  const BLOCKED_PLACEHOLDER = "채팅을 불러오는 동안에는 입력할 수 없습니다";
  const CHANNEL_ID_RE = /^[0-9a-f]{32}$/i;
  const SAFE_IMAGE_HOST_RE = /(?:^|\.)pstatic\.net$/i;
  const USER_STATUS_URL = "https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus";
  const VIDEO_API_BASE = "https://api.chzzk.naver.com/service/v2/videos/";
  const SUBSCRIBE_API_BASE = "https://api.chzzk.naver.com/commercial/v1/subscribe/channels/";
  let userStatusRequest = null;
  const videoChannelRequests = new Map();
  const subscriptionRequests = new Map();

  function safeImageUrl(value, addProfileSize = false) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || !SAFE_IMAGE_HOST_RE.test(url.hostname) ||
          url.username || url.password || (url.port && url.port !== "443")) return "";
      if (addProfileSize && !url.searchParams.has("type"))
        url.searchParams.set("type", "f160_160_na");
      return url.href;
    } catch {
      return "";
    }
  }

  function normalizeIdentity(value = {}) {
    const nickname = String(value?.nickname || "").trim().slice(0, 80) || "나";
    const subscribing = value?.subscribing === true;
    return Object.freeze({
      nickname,
      profileImageUrl: safeImageUrl(value?.profileImageUrl, true),
      loggedIn: value?.loggedIn === true,
      subscribing,
      subscriptionBadgeUrl: subscribing
        ? safeImageUrl(value?.subscriptionBadgeUrl || value?.lastBadgeImageUrl)
        : "",
    });
  }

  async function requestJson(url) {
    try {
      if (typeof fetch !== "function") return null;
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.content && typeof payload.content === "object" ? payload : null;
    } catch {
      return null;
    }
  }

  function loadUserStatus() {
    if (!userStatusRequest) {
      userStatusRequest = requestJson(USER_STATUS_URL).then((payload) => {
        if (!payload) userStatusRequest = null;
        return payload?.content || null;
      });
    }
    return userStatusRequest;
  }

  function resolveVideoChannelId(videoNo) {
    const video = String(videoNo || "");
    if (!/^\d+$/.test(video)) return Promise.resolve("");
    if (!videoChannelRequests.has(video)) {
      const request = requestJson(`${VIDEO_API_BASE}${encodeURIComponent(video)}`)
        .then((payload) => {
          const channelId = String(payload?.content?.channel?.channelId || "").toLowerCase();
          if (!CHANNEL_ID_RE.test(channelId)) {
            videoChannelRequests.delete(video);
            return "";
          }
          return channelId;
        });
      videoChannelRequests.set(video, request);
    }
    return videoChannelRequests.get(video);
  }

  function loadSubscription(channelId) {
    const id = String(channelId || "").toLowerCase();
    if (!CHANNEL_ID_RE.test(id)) return Promise.resolve(null);
    if (!subscriptionRequests.has(id)) {
      const request = requestJson(`${SUBSCRIBE_API_BASE}${encodeURIComponent(id)}`)
        .then((payload) => {
          if (!payload) subscriptionRequests.delete(id);
          return payload?.content || null;
        });
      subscriptionRequests.set(id, request);
    }
    return subscriptionRequests.get(id);
  }

  async function loadIdentity(videoNo, knownChannelId = "") {
    const [profile, resolvedChannelId] = await Promise.all([
      loadUserStatus(),
      CHANNEL_ID_RE.test(String(knownChannelId || ""))
        ? Promise.resolve(String(knownChannelId).toLowerCase())
        : resolveVideoChannelId(videoNo),
    ]);
    if (!profile) return normalizeIdentity();
    let subscription = null;
    if (profile.loggedIn === true && resolvedChannelId)
      subscription = await loadSubscription(resolvedChannelId);
    return normalizeIdentity({
      nickname: profile.nickname,
      profileImageUrl: profile.profileImageUrl,
      loggedIn: profile.loggedIn,
      subscribing: subscription?.subscribing === true,
      lastBadgeImageUrl: subscription?.info?.lastBadgeImageUrl,
    });
  }

  function applyAvatar(element, value) {
    if (!element) return;
    const identity = normalizeIdentity(value);
    const url = identity.profileImageUrl;
    let image = element.querySelector("img");
    if (!url) {
      if (image) element.replaceChildren();
      if (!element.textContent.trim()) element.textContent = "나";
      return;
    }
    if (!image) {
      image = document.createElement("img");
      image.alt = "";
      image.draggable = false;
      element.replaceChildren(image);
    }
    if (image.src !== url) image.src = url;
  }

  function createSession() {
    let videoNo = "";
    let sequence = 0;
    let messages = [];
    let identity = normalizeIdentity();
    let identityRevision = 0;

    function setVideo(nextVideoNo) {
      const next = /^\d+$/.test(String(nextVideoNo || ""))
        ? String(nextVideoNo)
        : "";
      if (next === videoNo) return false;
      videoNo = next;
      sequence = 0;
      messages = [];
      identity = normalizeIdentity();
      identityRevision += 1;
      return true;
    }

    function setIdentity(value) {
      const next = normalizeIdentity(value);
      if (next.nickname === identity.nickname &&
          next.profileImageUrl === identity.profileImageUrl &&
          next.loggedIn === identity.loggedIn &&
          next.subscribing === identity.subscribing &&
          next.subscriptionBadgeUrl === identity.subscriptionBadgeUrl) return false;
      identity = next;
      identityRevision += 1;
      const badges = identity.subscriptionBadgeUrl
        ? [{ position: "before", url: identity.subscriptionBadgeUrl, label: "구독 배지" }]
        : [];
      messages = messages.map((message) => Object.freeze({
        ...message,
        nickname: identity.nickname,
        profileImageUrl: identity.profileImageUrl,
        subscriptionBadgeUrl: identity.subscriptionBadgeUrl,
        badges,
      }));
      return true;
    }

    function add(text, at) {
      const value = String(text ?? "").trim();
      const time = Number(at);
      if (!videoNo || !value || value.length > MAX_MESSAGE_LENGTH ||
          !Number.isFinite(time) || time < 0) {
        return null;
      }
      const messageSequence = ++sequence;
      const message = Object.freeze({
        id: `cheese-local:${videoNo}:${messageSequence}`,
        sequence: messageSequence,
        videoNo,
        at: time,
        nickname: identity.nickname,
        profileImageUrl: identity.profileImageUrl,
        subscriptionBadgeUrl: identity.subscriptionBadgeUrl,
        badges: identity.subscriptionBadgeUrl
          ? [{ position: "before", url: identity.subscriptionBadgeUrl, label: "구독 배지" }]
          : [],
        text: value,
        local: true,
      });
      messages.push(message);
      if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
      return message;
    }

    function visible(at, limit = MAX_MESSAGES) {
      const time = Number(at);
      if (!Number.isFinite(time)) return [];
      return messages
        .filter((message) => message.at <= time + 0.25)
        .slice(-Math.max(1, Math.floor(Number(limit) || MAX_MESSAGES)));
    }

    function clear() {
      messages = [];
      sequence = 0;
    }

    return Object.freeze({
      setVideo,
      setIdentity,
      add,
      visible,
      clear,
      getIdentity: () => identity,
      snapshot: () => Object.freeze({ videoNo, count: messages.length, identityRevision }),
    });
  }

  // onExit: ESC 로 빠져나오거나 '채팅' 버튼으로 보낸 뒤 포커스를 넘길 곳(선택).
  //   Enter 전송은 이어서 입력하도록 입력창에 그대로 둔다.
  function bindComposer({ form, input, button, onSend, onExit }) {
    if (!form || !input || !button || typeof onSend !== "function") return () => {};
    const container = input.closest(
      ".cheese-replay-local-chat-input-container, .mv-vod-chat-compose-input-container",
    );
    const resizeInput = () => {
      input.style.height = "auto";
      const height = Math.max(20, Math.min(input.scrollHeight, 60));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > 60 ? "auto" : "hidden";
    };
    let blocked = false;
    const placeholder = input.placeholder;
    const update = () => {
      const value = input.value;
      button.disabled = blocked || !value.trim() || value.length > MAX_MESSAGE_LENGTH;
      input.setAttribute("aria-invalid", String(value.length > MAX_MESSAGE_LENGTH));
      resizeInput();
    };
    const submit = (event) => {
      event?.preventDefault();
      if (blocked) return;
      const value = input.value.trim();
      if (!value || value.length > MAX_MESSAGE_LENGTH) return;
      onSend(value);
      input.value = "";
      update();
      // 버튼 클릭(폼 submit 이벤트)일 때만 넘긴다. Enter 는 이벤트 없이 부른다.
      if (event?.type === "submit" && typeof onExit === "function") onExit();
    };
    const onKeydown = (event) => {
      // ESC 로 입력창에서 빠져나온다. 한글 조합 중 첫 ESC 는 조합 종료에 쓰이므로 건너뛴다.
      if (event.key === "Escape") {
        if (event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        input.blur();
        if (typeof onExit === "function") onExit();
        return;
      }
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      submit();
    };
    const onFocus = () => container?.classList.add("is-active");
    const onBlur = () => container?.classList.remove("is-active");
    // ⚠ 한글 입력 상태에서는 J 키의 event.key 가 "ㅓ" 다. 물리 키(event.code)로도 판정한다.
    const isShortcutKey = (event) =>
      event.code === "KeyJ" || String(event.key || "").toLowerCase() === "j";
    const onShortcut = (event) => {
      if (!isShortcutKey(event) || event.repeat || event.altKey ||
          event.ctrlKey || event.metaKey || event.shiftKey ||
          event.target?.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox']") ||
          !form.isConnected || form.closest("[hidden]") || blocked) return;
      event.preventDefault();
      event.stopPropagation();
      input.focus();
    };
    // 입력 중이던 글자는 지우지 않는다(잠금이 풀리면 이어서 보낼 수 있다).
    form[COMPOSER_SET_BLOCKED] = (next) => {
      const value = next === true;
      if (value === blocked) return;
      blocked = value;
      if (blocked && document.activeElement === input) input.blur();
      input.disabled = blocked;
      input.placeholder = blocked ? BLOCKED_PLACEHOLDER : placeholder;
      container?.classList.toggle("is-blocked", blocked);
      update();
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", onKeydown);
    input.addEventListener("focus", onFocus);
    input.addEventListener("blur", onBlur);
    form.addEventListener("submit", submit);
    document.addEventListener("keydown", onShortcut, true);
    update();
    return () => {
      input.removeEventListener("input", update);
      input.removeEventListener("keydown", onKeydown);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      form.removeEventListener("submit", submit);
      document.removeEventListener("keydown", onShortcut, true);
      container?.classList.remove("is-active");
      delete form[COMPOSER_SET_BLOCKED];
    };
  }

  function revealRowAtPosition(list, row) {
    if (!list?.isConnected || !row?.isConnected) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowTop = list.scrollTop + rowRect.top - listRect.top;
    const target = rowTop - Math.max(0, (list.clientHeight - rowRect.height) / 2);
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const reverse = getComputedStyle(list).flexDirection === "column-reverse";
    const minScroll = reverse ? -maxScroll : 0;
    const maxScrollTop = reverse ? 0 : maxScroll;
    list.scrollTop = Math.max(minScroll, Math.min(target, maxScrollTop));
  }

  // 치지직 다시보기 채팅 줄의 재생 시각(초). React props 의 chatMessage.playerMessageTime(ms)
  // 을 읽는다(chatTimestamp.js 와 같은 경로, MAIN world 전용). 못 읽으면 null.
  // ⚠ 요소를 키로 캐시하지 않는다. 목록이 요소를 다른 메시지에 재사용하면 옛 시각이 남는다.
  function reactValue(node, prefix) {
    const key = Object.keys(node).find((name) => name.startsWith(prefix));
    return key ? node[key] : null;
  }

  function rowChatMessage(row) {
    const direct = reactValue(row, "__reactProps$")?.children?.props?.chatMessage;
    if (direct && typeof direct === "object") return direct;
    let fiber = reactValue(row, "__reactFiber$");
    for (let guard = 0; fiber && guard < 60; guard += 1) {
      const props = fiber.memoizedProps;
      const message = props?.chatMessage || props?.children?.props?.chatMessage;
      if (message && typeof message === "object") return message;
      fiber = fiber.child;
    }
    return null;
  }

  // 이 다시보기의 방송 시작 시각(epoch ms). 치지직 채팅 줄의 실제 전송 시각(time)에서
  // 영상 경과(playerMessageTime)를 빼면 나온다(실측: time=1790498905221,
  // playerMessageTime=184221). 로컬 채팅의 재생 시각을 실제 방송 시각으로 바꾸는 데 쓴다.
  function nativeRowEpochBase(row) {
    try {
      const message = rowChatMessage(row);
      const sentAt = Number(message?.time ?? message?.messageTime);
      const played = Number(message?.playerMessageTime);
      if (!Number.isFinite(sentAt) || sentAt < 1e12 ||
          !Number.isFinite(played) || played < 0 || played > 604800000) return null;
      return sentAt - played;
    } catch {
      return null;
    }
  }

  // chatTimestamp.js 의 시간 형식과 같다(24h | 12h-en | 12h-ko).
  function formatChatClock(epochMs, format) {
    const date = new Date(epochMs);
    const hour24 = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    if (format !== "12h-en" && format !== "12h-ko") {
      return `${String(hour24).padStart(2, "0")}:${minutes}`;
    }
    const hour12 = hour24 % 12 || 12;
    if (format === "12h-ko") return `${hour24 < 12 ? "오전" : "오후"} ${hour12}:${minutes}`;
    return `${hour24 < 12 ? "AM" : "PM"} ${hour12}:${minutes}`;
  }

  function nativeRowTime(row) {
    try {
      const ms = Number(rowChatMessage(row)?.playerMessageTime);
      return Number.isFinite(ms) && ms >= 0 && ms <= 604800000 ? ms / 1000 : null;
    } catch {
      return null;
    }
  }

  // 로컬 채팅 줄을 치지직 채팅 사이 제자리에 둔다. 같은 시각이면 치지직 채팅 뒤에 둔다
  // (보고 나서 입력했으므로). 새 채팅이 아래에 붙으면 로컬 줄도 함께 위로 밀려 올라간다.
  // entries 는 시각 오름차순 [{ row, at }]. 치지직 줄의 시각을 하나도 못 읽으면 최신 쪽에 둔다.
  // ⚠ 치지직 다시보기 목록은 DOM 이 최신 → 과거 순이다(0번 _list_bottom_, 화면은
  //   column-reverse, 실측). DOM 을 과거 → 최신으로 가정하면 로컬 줄이 맨 위로 간다.
  //   순서는 읽은 시각으로 판단하고, 판단할 수 없을 때만 reversed(스타일)를 쓴다.
  function placeLocalRows({ list, entries, isNative, timeOf, end = null, reversed = false }) {
    const natives = [...list.children].filter(isNative);
    const times = new Map();
    const time = (row) => {
      if (!times.has(row)) times.set(row, timeOf(row));
      return times.get(row);
    };
    const knownRows = natives.filter((row) => time(row) !== null);
    const newestFirst = knownRows.length >= 2
      ? time(knownRows[0]) > time(knownRows[knownRows.length - 1])
      : reversed;
    // 과거 → 최신 순서로 본 치지직 줄.
    const chrono = newestFirst ? [...natives].reverse() : natives;
    const chronoKnown = newestFirst ? [...knownRows].reverse() : knownRows;
    const placed = new Set();
    const put = (row, ref) => {
      if (ref !== row && (row.parentElement !== list || row.nextSibling !== ref)) {
        list.insertBefore(row, ref);
      }
      placed.add(row);
    };
    for (const { row, at } of entries) {
      let anchor = null; // 이 시각 이전(같음 포함)의 가장 최신 치지직 줄
      for (let index = chronoKnown.length - 1; index >= 0; index -= 1) {
        if (time(chronoKnown[index]) <= at) {
          anchor = chronoKnown[index];
          break;
        }
      }
      // 시각을 하나도 못 읽으면 가장 최신 줄 뒤(예전 동작: 최신 쪽 끝).
      if (!chronoKnown.length) anchor = chrono[chrono.length - 1] || null;
      if (anchor) {
        // 시간상 anchor 바로 뒤, 먼저 놓은 로컬 줄들보다 뒤.
        if (newestFirst) {
          let ref = anchor;
          while (ref.previousSibling && placed.has(ref.previousSibling)) ref = ref.previousSibling;
          put(row, ref);
        } else {
          let ref = anchor.nextSibling;
          while (ref && placed.has(ref)) ref = ref.nextSibling;
          put(row, ref);
        }
        continue;
      }
      if (chrono.length) {
        // 모든 치지직 줄보다 과거: 가장 오래된 줄 앞(시간상), 먼저 놓은 로컬 줄 뒤.
        const oldest = chrono[0];
        put(row, newestFirst ? oldest.nextSibling : oldest);
        continue;
      }
      // 치지직 줄이 없다: 최신 쪽 끝(기준점 _list_bottom_ 옆).
      if (newestFirst) {
        // 나중 로컬 줄이 더 최신이므로 기준점 바로 옆(먼저 놓은 줄보다 앞)에 둔다.
        put(row, end ? end.nextSibling : list.firstChild);
      } else {
        put(row, end);
      }
    }
  }

  // 멀티뷰 다시보기 채팅창의 '최신 채팅으로' 버튼(시청 페이지·분리 채팅 팝업 공용).
  // 위로 올려 지난 채팅을 보고 있으면 나타나고, 누르면 맨 아래로 이동한다.
  // 기준(32px)은 새 채팅 따라가기 기준과 같다 — 버튼이 보이는 동안에는 따라가지 않는다.
  // ⚠ 부드러운 스크롤로 옮기면 이동 중에 붙은 새 채팅을 따라가지 못해 즉시 옮긴다.
  const LATEST_BUTTON_THRESHOLD = 32;
  function bindLatestButton({ list, button }) {
    if (!list || !button) return { update() {}, dispose() {} };
    const atBottom = () =>
      list.scrollHeight - list.clientHeight - list.scrollTop < LATEST_BUTTON_THRESHOLD;
    const update = () => {
      const hidden = atBottom();
      if (button.hidden !== hidden) button.hidden = hidden;
    };
    const onClick = () => {
      list.scrollTop = list.scrollHeight;
      update();
    };
    list.addEventListener("scroll", update, { passive: true });
    button.addEventListener("click", onClick);
    update();
    return {
      update,
      dispose() {
        list.removeEventListener("scroll", update);
        button.removeEventListener("click", onClick);
      },
    };
  }

  // 확장 페이지(멀티뷰 시청·분리 채팅)용 설정 구독. 설정 화면의 기능 플래그
  // (cheeseFeatureHidden)를 읽고 바뀔 때마다 알린다. 설정값만 읽고 로컬 채팅 내용은
  // 어디에도 저장하지 않는다. 치지직 페이지(MAIN world)에는 확장 저장소가 없어 아무 일도
  // 하지 않는다 — 그쪽은 content.js 가 보내는 기능 플래그와 <html> 클래스를 따른다.
  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  function watchFeatureSetting(read, onChange) {
    const storage = globalThis.chrome?.storage;
    if (!storage?.local || typeof onChange !== "function") return () => {};
    let current = null;
    const emit = (next) => {
      if (next === current) return;
      current = next;
      onChange(next);
    };
    Promise.resolve()
      .then(() => storage.local.get(FEATURE_HIDDEN_KEY))
      .then((data) => emit(read(data?.[FEATURE_HIDDEN_KEY])))
      // 읽지 못하면 저장값이 없는 것과 같게 본다(각 설정의 기본값).
      .catch(() => emit(read(undefined)));
    const listener = (changes, area) => {
      if (area !== "local" || !changes[FEATURE_HIDDEN_KEY]) return;
      emit(read(changes[FEATURE_HIDDEN_KEY].newValue));
    };
    storage.onChanged?.addListener(listener);
    return () => storage.onChanged?.removeListener(listener);
  }

  // 설정 - 다시보기 '다시보기 채팅 입력'(체크=켬, 기본 끔).
  function watchEnabledSetting(onChange) {
    return watchFeatureSetting((flags) => flags?.vodLocalChat === true, onChange);
  }

  // 설정 - 채팅 '채팅 전송 버튼 숨김'. 켜지면 로컬 채팅 입력의 도구 줄(안내·전송 버튼)도
  // 숨긴다. Enter 로 입력하는 동작은 그대로다.
  function watchHideToolsSetting(onChange) {
    return watchFeatureSetting((flags) => flags?.chatHideSendButton === true, onChange);
  }

  // 설정 - 다시보기 '다시보기 채팅 입력'의 하위 옵션(테두리선·배경색 숨김)을 <html>
  // 클래스로 건다. 일반 다시보기는 content.js 가 같은 클래스를 붙인다.
  function watchStyleClasses(root = globalThis.document?.documentElement) {
    if (!root?.classList) return () => {};
    const stops = [
      watchFeatureSetting(
        (flags) => flags?.vodLocalChatHideBorder === true,
        (hide) => root.classList.toggle("cheese-vod-local-chat-hide-border", hide),
      ),
      watchFeatureSetting(
        (flags) => flags?.vodLocalChatHideBackground === true,
        (hide) => root.classList.toggle("cheese-vod-local-chat-hide-bg", hide),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }

  // 치지직 다시보기 플레이어는 .pzp-pc(tabindex=0)에 포커스가 있어야 ←/→ 로 5초씩
  // 이동한다(실측). 입력창에서 빠져나오면 body 로 가 방향키가 먹지 않았다.
  function focusRegularPlayer() {
    const player = document.querySelector(".pzp.pzp-pc, .pzp-pc");
    if (player instanceof HTMLElement) player.focus({ preventScroll: true });
  }

  function createRegularComposer(onSend, currentIdentity) {
    const form = document.createElement("form");
    form.className = "cheese-replay-local-chat-composer";
    form.setAttribute("aria-label", "다시보기 로컬 채팅 입력");
    const inputContainer = document.createElement("div");
    inputContainer.className = "cheese-replay-local-chat-input-container";
    const avatar = document.createElement("span");
    avatar.className = "cheese-replay-local-chat-avatar";
    avatar.setAttribute("aria-hidden", "true");
    applyAvatar(avatar, currentIdentity);
    const input = document.createElement("textarea");
    input.className = "cheese-replay-local-chat-input";
    input.maxLength = MAX_MESSAGE_LENGTH;
    input.rows = 1;
    input.placeholder = "다시보기 채팅 입력";
    input.setAttribute("aria-label", "다시보기 로컬 채팅 입력");
    inputContainer.append(avatar, input);

    const tools = document.createElement("div");
    tools.className = "cheese-replay-local-chat-tools";
    const indicator = document.createElement("span");
    indicator.className = "cheese-replay-local-chat-indicator";
    indicator.setAttribute("aria-label", "이 기기에만 표시되며 실제 채팅으로 전송되지 않습니다");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M5.25 4.5h13.5A2.25 2.25 0 0 1 21 6.75v7.5a2.25 2.25 0 0 1-2.25 2.25H10l-4.4 3.3a.75.75 0 0 1-1.2-.6v-2.83a2.25 2.25 0 0 1-1.4-2.12v-7.5A2.25 2.25 0 0 1 5.25 4.5Z");
    icon.append(path);
    const indicatorText = document.createElement("span");
    indicatorText.textContent = "이 기기에만 표시";
    indicator.append(icon, indicatorText);
    const button = document.createElement("button");
    button.className = "cheese-replay-local-chat-send";
    button.type = "submit";
    button.textContent = "채팅";
    tools.append(indicator, button);
    form.append(inputContainer, tools);
    form[COMPOSER_DISPOSE] = bindComposer({
      form, input, button, onSend, onExit: focusRegularPlayer,
    });
    return form;
  }

  function createNativeMessage(message) {
    const row = document.createElement("div");
    row.className = "_item_ vod_chatting_item cheese-replay-local-chat-message";
    row.setAttribute(LOCAL_ROW_ATTR, "true");
    row.dataset.localChatId = message.id;

    // 치지직 다시보기 채팅 줄과 같은 구성이다(실측):
    //   _item_ > _chatting_message_ > [시간] _nickname_(배지 묶음 + 닉네임) _text_
    const content = document.createElement("div");
    content.className = "cheese-replay-local-chat-content";
    const identity = document.createElement("span");
    identity.className = "cheese-replay-local-chat-identity";
    if (message.subscriptionBadgeUrl) {
      const badges = document.createElement("span");
      badges.className = "cheese-replay-local-chat-badges";
      const badge = document.createElement("img");
      badge.className = "cheese-replay-local-chat-badge";
      badge.src = message.subscriptionBadgeUrl;
      badge.alt = "구독 배지";
      badge.width = 18;
      badge.height = 18;
      badge.loading = "lazy";
      badge.decoding = "async";
      badges.append(badge);
      identity.append(badges);
    }
    const nickname = document.createElement("span");
    nickname.className = "cheese-replay-local-chat-nickname";
    const nicknameText = document.createElement("span");
    nicknameText.className = "cheese-replay-local-chat-nickname-text";
    nicknameText.textContent = message.nickname;
    nickname.append(nicknameText);
    identity.append(nickname);

    const text = document.createElement("span");
    text.className = "cheese-replay-local-chat-text";
    text.textContent = message.text;
    content.append(identity, text);
    row.append(content);
    return row;
  }

  function startRegularVod() {
    if (location.origin !== "https://chzzk.naver.com") return;
    // 멀티뷰를 띄운 치지직 페이지(/lives)에서는 라이브러리로만 쓴다.
    if (document.documentElement?.hasAttribute?.("data-cheese-multiview-host")) return;
    const session = createSession();
    let activeVideoNo = "";
    let activeAside = null;
    let activeList = null;
    let composer = null;
    let listObserver = null;
    let scheduled = false;
    let identityRequestId = 0;
    let pendingRevealMessageId = "";
    let replayScrollLocked = false;
    let replayScrollTop = 0;
    let replayScrollLockTimer = 0;
    let replaySeekLockTimer = 0;
    let replayUserScrollUntil = 0;
    let scrollList = null;
    let replayScrollElement = null;
    let replayScrollReversed = false;
    const rowElements = new Map();

    function clearReplayScrollLockTimer() {
      if (replayScrollLockTimer) clearTimeout(replayScrollLockTimer);
      replayScrollLockTimer = 0;
    }

    function noteReplayUserScroll(event) {
      if (event?.type === "keydown" &&
          !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
        return;
      replayUserScrollUntil = Date.now() + 700;
    }

    function keepReplayListPosition() {
      if (!activeList?.isConnected || !replayScrollElement?.isConnected) return;
      if (!replayScrollLocked || Date.now() < replayUserScrollUntil) {
        replayScrollTop = replayScrollElement.scrollTop;
        return;
      }
      const maxScrollTop = Math.max(
        0,
        replayScrollElement.scrollHeight - replayScrollElement.clientHeight,
      );
      const minScrollTop = replayScrollReversed ? -maxScrollTop : 0;
      const maxScroll = replayScrollReversed ? 0 : maxScrollTop;
      const target = Math.max(minScrollTop, Math.min(replayScrollTop, maxScroll));
      if (Math.abs(replayScrollElement.scrollTop - target) > 1)
        replayScrollElement.scrollTop = target;
    }

    function scheduleReplayScrollLock() {
      if (replayScrollLocked || !activeList?.querySelector(ROW_SELECTOR)) return;
      clearReplayScrollLockTimer();
      replayScrollLockTimer = window.setTimeout(() => {
        replayScrollLockTimer = 0;
        if (!activeList?.isConnected || !activeList.querySelector(ROW_SELECTOR)) return;
        replayScrollLocked = true;
        replayScrollTop = replayScrollElement?.scrollTop || 0;
      }, 500);
    }

    function onReplayListScroll() {
      keepReplayListPosition();
    }

    function findScrollElement(list, aside) {
      let candidate = list;
      for (let element = list; element && aside.contains(element); element = element.parentElement) {
        const style = getComputedStyle(element);
        if (/(auto|scroll|overlay)/.test(style.overflowY)) {
          candidate = element;
          break;
        }
        if (element === aside) break;
      }
      return candidate;
    }

    function setReplayScrollList(list) {
      const nextScrollElement = list ? findScrollElement(list, activeAside) : null;
      if (scrollList === list && replayScrollElement === nextScrollElement) return;
      if (scrollList) {
        replayScrollElement?.removeEventListener("scroll", onReplayListScroll);
        replayScrollElement?.removeEventListener("wheel", noteReplayUserScroll);
        replayScrollElement?.removeEventListener("touchmove", noteReplayUserScroll);
        replayScrollElement?.removeEventListener("pointerdown", noteReplayUserScroll);
        replayScrollElement?.removeEventListener("keydown", noteReplayUserScroll);
      }
      scrollList = list;
      replayScrollElement = nextScrollElement;
      replayScrollReversed = replayScrollElement
        ? getComputedStyle(replayScrollElement).flexDirection === "column-reverse"
        : false;
      replayScrollLocked = false;
      replayScrollTop = replayScrollElement?.scrollTop || 0;
      clearReplayScrollLockTimer();
      if (!replayScrollElement) return;
      replayScrollElement.addEventListener("scroll", onReplayListScroll, { passive: true });
      replayScrollElement.addEventListener("wheel", noteReplayUserScroll, { passive: true });
      replayScrollElement.addEventListener("touchmove", noteReplayUserScroll, { passive: true });
      replayScrollElement.addEventListener("pointerdown", noteReplayUserScroll, { passive: true });
      replayScrollElement.addEventListener("keydown", noteReplayUserScroll);
    }

    function resetReplayScrollForSeek() {
      replayScrollLocked = false;
      clearReplayScrollLockTimer();
      if (replaySeekLockTimer) clearTimeout(replaySeekLockTimer);
      replaySeekLockTimer = window.setTimeout(() => {
        replaySeekLockTimer = 0;
        if (!activeList?.isConnected || !activeList.querySelector(ROW_SELECTOR)) return;
        replayScrollLocked = true;
        replayScrollTop = replayScrollElement?.scrollTop || 0;
      }, 1200);
    }

    function loadPageIdentity(videoNo) {
      const requestId = ++identityRequestId;
      const identity = session.getIdentity();
      applyAvatar(composer?.querySelector(".cheese-replay-local-chat-avatar"), identity);
      if (!videoNo) return;
      void loadIdentity(videoNo).then((nextIdentity) => {
        if (requestId !== identityRequestId || activeVideoNo !== videoNo) return;
        if (session.setIdentity(nextIdentity)) {
          applyAvatar(composer?.querySelector(".cheese-replay-local-chat-avatar"), nextIdentity);
          removeRows();
          scheduleReconcile();
        }
      });
    }

    function routeVideoNo() {
      const match = /^\/video\/(\d+)(?:\/|$)/.exec(location.pathname);
      return match?.[1] || "";
    }

    function findList(aside) {
      const content = aside?.querySelector("[class*='_content_']");
      return content?.querySelector(":scope > [class*='_list_']") ||
        aside?.querySelector("[class*='vod_chatting_list_container'], [role='log']");
    }

    function currentTime() {
      const video = document.querySelector("video.webplayer-internal-video, video[class*='webplayer-internal-video']");
      return Number.isFinite(video?.currentTime) ? Math.max(0, video.currentTime) : 0;
    }

    function removeRows() {
      rowElements.forEach((row) => row.remove());
      rowElements.clear();
    }

    // 설정 - 채팅 '채팅 시간 표시'를 나의 로컬 채팅에도 적용한다. 치지직 채팅 줄과 같은
    // 클래스(.cheese-chat-time)와 위치(닉네임 앞)를 써서 모양을 맞춘다.
    // ⚠ 배지 모아 챗이 시간을 표시 중이면 chatTimestamp.js 처럼 양보한다.
    let chatShowTime = false;
    let chatTimeFormat = "24h";
    let epochBase = null; // 이 다시보기의 방송 시작 시각(epoch ms)

    function findEpochBase() {
      if (epochBase !== null || !activeList) return epochBase;
      for (const element of activeList.children) {
        if (!element.matches(ROW_SELECTOR) || element.hasAttribute(LOCAL_ROW_ATTR)) continue;
        const base = nativeRowEpochBase(element);
        if (base !== null) {
          epochBase = base;
          break;
        }
      }
      return epochBase;
    }

    function applyLocalTimes(messages) {
      const show = chatShowTime &&
        !document.documentElement.classList.contains("chzzk-badge-moa-chat-timestamp-enabled");
      const base = show && messages.length ? findEpochBase() : null;
      for (const message of messages) {
        const row = rowElements.get(message.id);
        if (!row) continue;
        let span = row.querySelector(".cheese-chat-time");
        if (base === null) {
          span?.remove();
          continue;
        }
        const text = formatChatClock(base + message.at * 1000, chatTimeFormat);
        if (!span) {
          // 치지직 줄처럼 닉네임 묶음(배지 포함) 앞에 둔다.
          const identity = row.querySelector(".cheese-replay-local-chat-identity");
          if (!identity?.parentNode) continue;
          span = document.createElement("span");
          span.className = "cheese-chat-time";
          identity.parentNode.insertBefore(span, identity);
        }
        if (span.textContent !== text) span.textContent = text;
      }
    }

    function reconcileRows() {
      if (!activeList?.isConnected) return;
      const time = currentTime();
      const visible = session.visible(time).sort((a, b) => a.at - b.at ||
        a.sequence - b.sequence);
      const visibleIds = new Set(visible.map((message) => message.id));
      for (const [id, row] of rowElements) {
        if (!visibleIds.has(id)) {
          row.remove();
          rowElements.delete(id);
        }
      }
      const bottom = activeList.querySelector(":scope > [class*='_list_bottom_']");
      // ⚠ 예전에는 로컬 줄을 늘 목록 끝(_list_bottom_ 앞)에 다시 끼웠다. 새 채팅이 붙을
      //   때마다 로컬 줄이 맨 아래로 끌려가 다른 채팅과 함께 올라가지 않았다.
      placeLocalRows({
        list: activeList,
        entries: visible.map((message) => {
          let row = rowElements.get(message.id);
          if (!row) {
            row = createNativeMessage(message);
            rowElements.set(message.id, row);
          }
          return { row, at: message.at };
        }),
        isNative: (element) =>
          element.matches(ROW_SELECTOR) && !element.hasAttribute(LOCAL_ROW_ATTR),
        timeOf: nativeRowTime,
        end: bottom?.parentElement === activeList ? bottom : null,
        reversed: getComputedStyle(activeList).flexDirection === "column-reverse",
      });
      applyLocalTimes(visible);
      const pendingRow = rowElements.get(pendingRevealMessageId);
      if (pendingRow?.parentElement === activeList) {
        clearReplayScrollLockTimer();
        revealRowAtPosition(replayScrollElement || activeList, pendingRow);
        pendingRevealMessageId = "";
        replayScrollLocked = true;
        replayScrollTop = replayScrollElement?.scrollTop || 0;
      }
    }

    function scheduleReconcile() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        reconcileRows();
      });
    }

    function attachAside(aside) {
      const list = findList(aside);
      if (!list) return false;
      if (activeAside !== aside || activeList !== list) {
        listObserver?.disconnect();
        activeAside = aside;
        activeList = list;
        setReplayScrollList(list);
        composer?.[COMPOSER_DISPOSE]?.();
        composer?.remove();
        composer = createRegularComposer((text) => {
          const message = session.add(text, currentTime());
          if (message) {
            pendingRevealMessageId = message.id;
            scheduleReconcile();
          }
        }, session.getIdentity());
        const container = aside.querySelector(":scope > [class*='_container_']") || aside;
        if (!container.querySelector(".live_chatting_area")) container.append(composer);
        // 광고 중에 새로 붙는 경우도 있다. 붙이자마자 한 번 맞춘다.
        updateComposerAvailability();
        listObserver = new MutationObserver((records) => {
          if (records.some((record) => [...record.addedNodes, ...record.removedNodes]
            .some((node) => node instanceof Element &&
              (!node.hasAttribute(LOCAL_ROW_ATTR) &&
                (node.matches(ROW_SELECTOR) || node.querySelector(ROW_SELECTOR)))))) {
            if (replayScrollLocked) keepReplayListPosition();
            else scheduleReplayScrollLock();
            scheduleReconcile();
          }
        });
        listObserver.observe(list, { childList: true, subtree: true });
        scheduleReplayScrollLock();
        removeRows();
      }
      return true;
    }

    // 입력창·로컬 줄·감시를 모두 뗀다. 세션(입력한 메시지)은 남겨 다시 켜면 되살린다.
    function detach() {
      removeRows();
      composer?.[COMPOSER_DISPOSE]?.();
      composer?.remove();
      composer = null;
      activeAside = null;
      activeList = null;
      listObserver?.disconnect();
      listObserver = null;
      setReplayScrollList(null);
    }

    // 설정(다시보기 채팅 입력). content.js 가 저장값을 읽기 전에는 붙이지 않는다.
    // ⚠ 기본값으로 먼저 붙이면 끈 사용자에게 입력창이 잠깐 보였다 사라진다.
    let enabled = false;
    function setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) syncPage();
      else detach();
    }

    function syncPage() {
      if (!enabled) return;
      const videoNo = routeVideoNo();
      if (!videoNo) {
        if (activeVideoNo) {
          session.setVideo("");
          activeVideoNo = "";
          detach();
          identityRequestId += 1;
        }
        return;
      }
      if (videoNo !== activeVideoNo) {
        activeVideoNo = videoNo;
        pendingRevealMessageId = "";
        replayScrollLocked = false;
        clearReplayScrollLockTimer();
        session.setVideo(videoNo);
        epochBase = null;
        removeRows();
        loadPageIdentity(videoNo);
      }
      const aside = document.querySelector("aside#vod-aside");
      if (!aside || !attachAside(aside)) return;
      scheduleReconcile();
    }

    // 광고 중(또는 채팅을 불러오는 중)에는 치지직 채팅창에 로딩 표시가 뜬다(실측:
    // _wrapper_ > _loading_image_ + '열심히 불러오는 중..'). 그동안 입력을 잠근다.
    // ⚠ 문서 변화마다 찾지 않고 0.2초에 한 번으로 묶는다(채팅이 몰려도 부하가 늘지 않게).
    let availabilityTimer = 0;
    function updateComposerAvailability() {
      const loading = !!activeAside?.isConnected &&
        !!activeAside.querySelector("[class*='_loading_image_']");
      composer?.[COMPOSER_SET_BLOCKED]?.(loading);
    }
    function scheduleAvailabilityCheck() {
      if (availabilityTimer) return;
      availabilityTimer = window.setTimeout(() => {
        availabilityTimer = 0;
        updateComposerAvailability();
      }, 200);
    }

    const pageObserver = new MutationObserver(() => {
      if (!enabled) return;
      scheduleAvailabilityCheck();
      if (!activeAside?.isConnected || !activeList?.isConnected ||
          routeVideoNo() !== activeVideoNo) syncPage();
    });
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", syncPage);
    window.addEventListener("pageshow", syncPage);
    window.addEventListener("pagehide", () => {
      pageObserver.disconnect();
      if (availabilityTimer) clearTimeout(availabilityTimer);
      listObserver?.disconnect();
      setReplayScrollList(null);
      clearReplayScrollLockTimer();
      if (replaySeekLockTimer) clearTimeout(replaySeekLockTimer);
      session.clear();
      removeRows();
      composer?.[COMPOSER_DISPOSE]?.();
    }, { once: true });
    document.addEventListener("seeking", () => {
      resetReplayScrollForSeek();
      scheduleReconcile();
    }, true);
    document.addEventListener("seeked", resetReplayScrollForSeek, true);
    document.addEventListener("seeked", scheduleReconcile, true);
    document.addEventListener("timeupdate", scheduleReconcile, true);

    // content.js(격리 월드)가 보내는 기능 플래그. null 은 '아직 저장값을 못 읽음'.
    let flagsReceived = false;
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.source !== "cheese-feature-flags") return;
      const showTime = event.data.flags?.chatShowTime === true;
      const timeFormat = String(event.data.chatTimeFormat || "24h");
      if (showTime !== chatShowTime || timeFormat !== chatTimeFormat) {
        chatShowTime = showTime;
        chatTimeFormat = timeFormat;
        scheduleReconcile();
      }
      const value = event.data.vodLocalChatEnabled;
      if (typeof value !== "boolean") return;
      flagsReceived = true;
      setEnabled(value);
    });
    // 로드 순서가 보장되지 않아 첫 요청이 유실될 수 있다. 받을 때까지 짧게 다시 묻는다.
    // ⚠ targetOrigin 은 "*" — 수신부가 source 로 같은 창인지 검증한다(chatTimestamp.js 와 같다).
    let flagRequestTries = 0;
    const requestFlags = () => window.postMessage({ source: "cheese-feature-flags-request" }, "*");
    requestFlags();
    const flagRequestTimer = window.setInterval(() => {
      flagRequestTries += 1;
      if (flagsReceived || flagRequestTries > 20) {
        clearInterval(flagRequestTimer);
        return;
      }
      requestFlags();
    }, 300);
  }

  globalThis.CheeseReplayLocalChat = Object.freeze({
    MAX_MESSAGE_LENGTH,
    MAX_MESSAGES,
    createSession,
    bindComposer,
    revealRowAtPosition,
    placeLocalRows,
    nativeRowEpochBase,
    formatChatClock,
    watchEnabledSetting,
    watchHideToolsSetting,
    watchStyleClasses,
    bindLatestButton,
    setComposerBlocked: (form, blocked) => form?.[COMPOSER_SET_BLOCKED]?.(blocked),
    normalizeIdentity,
    applyAvatar,
    loadIdentity,
  });

  startRegularVod();
})();
