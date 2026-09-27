(() => {
  const ROLE_ORDER = ["streamer", "manager", "operator", "partner"];
  const ROLE_SET = new Set(ROLE_ORDER);

  function classifyBadgeRole(signals) {
    const text = (Array.isArray(signals) ? signals : [signals])
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
    if (/\/icon\/streamer(?:\.png)?|스트리머|방장|채널 주인|(?:^|[^a-z])broadcaster(?:$|[^a-z])/.test(text))
      return "streamer";
    if (/\/icon\/manager\.png|채널 관리자|채팅 운영자|(?:^|[^a-z])manager(?:$|[^a-z])/.test(text))
      return "manager";
    if (/\/icon\/owner\.png|네이버 게임 운영자|치지직 운영자|(?:^|[^a-z])operator(?:$|[^a-z])/.test(text))
      return "operator";
    if (/파트너|인증 마크|icon_official_mark|verified_mark|(?:^|[^a-z])partner(?:$|[^a-z])/.test(text))
      return "partner";
    return "";
  }

  function roleSignals(row) {
    const identity = row.querySelector(
      'button[class*="_nickname_"], button[class*="_profile_button_"], button[class*="_name_"]',
    );
    if (!identity) return [];
    const signals = [];
    // 빌드에 따라 역할 배지가 닉네임 버튼 밖에 붙는다(원본도 항목 전체의 img 를 본다).
    // 메시지 본문의 이모티콘은 역할 판정에 섞이지 않게 뺀다.
    row.querySelectorAll("img").forEach((image) => {
      if (identity.contains(image) ||
          image.closest('[class*="_chatting_message_"] > [class*="_text_"]')) return;
      signals.push(image.getAttribute("src"), image.getAttribute("alt"), image.getAttribute("title"));
    });
    identity.querySelectorAll(
      'img, [aria-label], [title], [class*="verified"], [class*="partner"], ' +
      '[class*="streamer"], [class*="manager"], [class*="operator"], ' +
      '[class*="owner"], [class*="official"], [data-role], [data-badge-type]',
    ).forEach((node) => {
      signals.push(
        node.getAttribute("src"),
        node.getAttribute("alt"),
        node.getAttribute("title"),
        node.getAttribute("aria-label"),
        node.getAttribute("class"),
        node.getAttribute("data-role"),
        node.getAttribute("data-badge-type"),
      );
    });
    row.querySelectorAll(".blind").forEach((node) => signals.push(node.textContent));
    return signals;
  }

  function isSpecialMessageRow(row) {
    return Boolean(row.querySelector(
      '[class*="_is_donation_"], [class*="_is_subscription_"], [class*="_is_mission_"]',
    ));
  }

  function normalizeCapturedMessage(message) {
    if (!message || typeof message !== "object" || !ROLE_SET.has(message.role))
      return null;
    const nickname = String(message.nickname || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const text = String(message.text || "").replace(/\s+/g, " ").trim().slice(0, 700);
    if (!nickname && !text) return null;
    const normalized = { role: message.role, nickname, text };
    if (Array.isArray(message.badges)) {
      normalized.badges = message.badges.filter((badge) =>
        badge && /^https:\/\//i.test(badge.src || "") &&
        (badge.position === "before" || badge.position === "after"),
      ).slice(0, 12).map((badge) => ({
        src: String(badge.src).slice(0, 2048),
        alt: String(badge.alt || "").slice(0, 80),
        position: badge.position,
      }));
    }
    if (typeof message.timeText === "string")
      normalized.timeText = message.timeText.trim().slice(0, 24);
    if (typeof message.nicknameColor === "string")
      normalized.nicknameColor = message.nicknameColor.slice(0, 80);
    if (typeof message.messageColor === "string")
      normalized.messageColor = message.messageColor.slice(0, 80);
    if (message.special === true) normalized.special = true;
    return normalized;
  }

  // 원본(배지 모아보기)과 같은 박자: 닉네임 순환 2.4초, 새 채팅 강조 1.4초,
  // 팝업 펼침 0.32초·접힘 0.28초.
  const PILL_CYCLE_INTERVAL_MS = 2400;
  const PILL_ATTENTION_DURATION_MS = 1400;
  const POPOVER_OPEN_MS = 320;
  const POPOVER_CLOSE_MS = 280;
  const ROLE_BADGES = Object.freeze({
    streamer: ["방장", "https://ssl.pstatic.net/static/nng/glive/icon/streamer.png"],
    manager: ["매니저", "https://ssl.pstatic.net/static/nng/glive/icon/manager.png"],
    operator: ["치지직 운영자", "https://ssl.pstatic.net/static/nng/glive/icon/owner.png"],
    partner: ["파트너", "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png"],
  });
  // 알림 버튼 강조색 우선순위(원본과 같다): 방장 > 운영자 > 매니저 > 파트너.
  const PILL_ROLE_PRIORITY = ["streamer", "operator", "manager", "partner"];
  const CHAT_FONT_SCALE_STEPS = Object.freeze([100, 125, 150, 175]);

  function createFontScaleControls({
    doc = globalThis.document,
    classPrefix = "mv-badge-chat",
    initial = 100,
    onChange = () => {},
  } = {}) {
    if (!doc?.createElement) return null;
    let index = Math.max(0, CHAT_FONT_SCALE_STEPS.indexOf(initial));
    const root = doc.createElement("div");
    root.className = `${classPrefix}-font-scale`;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "배지 채팅 글자 크기 조절");

    const createButton = (direction, label, symbol) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `${classPrefix}-font-scale-${direction}`;
      button.setAttribute("aria-label", label);
      button.textContent = symbol;
      return button;
    };
    const down = createButton("down", "글자 크기 줄이기", "−");
    const value = doc.createElement("span");
    value.className = `${classPrefix}-font-scale-value`;
    value.setAttribute("aria-live", "off");
    const up = createButton("up", "글자 크기 키우기", "+");
    root.append(down, value, up);

    const update = () => {
      const percent = CHAT_FONT_SCALE_STEPS[index];
      value.textContent = `${percent}%`;
      down.disabled = index === 0;
      up.disabled = index === CHAT_FONT_SCALE_STEPS.length - 1;
      onChange(percent);
    };
    down.addEventListener("click", () => {
      index = Math.max(0, index - 1);
      update();
    });
    up.addEventListener("click", () => {
      index = Math.min(CHAT_FONT_SCALE_STEPS.length - 1, index + 1);
      update();
    });
    update();
    return { element: root, steps: CHAT_FONT_SCALE_STEPS };
  }

  // 읽지 않은 채팅을 닉네임별로 묶는다. 가장 최근에 말한 사람이 앞에 온다.
  function collectPillActors(messages) {
    const actors = new Map();
    messages.forEach((message, order) => {
      const nickname = String(message.nickname || "알 수 없음");
      let actor = actors.get(nickname);
      if (!actor) {
        actor = { nickname, count: 0, roles: new Set(), last: 0 };
        actors.set(nickname, actor);
      }
      actor.count += 1;
      actor.last = order;
      (message.roles || [message.role]).forEach((role) => {
        if (ROLE_SET.has(role)) actor.roles.add(role);
      });
    });
    return [...actors.values()].sort((left, right) => right.last - left.last);
  }

  // 알림 버튼 표시. 여러 명이면 순환하고, 새 채팅이 오면 맨 앞 사람을 잠시 고정한 채
  // 역할색으로 빛난다. 라이브 채팅 프레임과 다시보기 피드가 함께 쓴다.
  function createBadgePill({ trigger, badges, label, count, classPrefix }) {
    const doc = trigger.ownerDocument;
    const view = doc.defaultView;
    let actors = [];
    let compact = false;
    let glow = true;
    let index = 0;
    let signature = "";
    let cycleTimer = 0;
    let attentionTimer = 0;
    let lockUntil = 0;
    let paintedKey = "";

    function stopCycle() {
      if (cycleTimer) view.clearInterval(cycleTimer);
      cycleTimer = 0;
    }

    function clearAttention() {
      view.clearTimeout(attentionTimer);
      attentionTimer = 0;
      lockUntil = 0;
      trigger.classList.remove("is-attention");
    }

    function roleImage(role, className = "") {
      const [alt, src] = ROLE_BADGES[role];
      const image = doc.createElement("img");
      image.src = src;
      image.alt = alt;
      image.width = 16;
      image.height = 16;
      image.decoding = "async";
      if (className) image.className = className;
      return image;
    }

    function paint() {
      const locked = Date.now() < lockUntil;
      const actor = actors.length ? actors[locked ? 0 : index % actors.length] : null;
      const unseen = actors.reduce((sum, item) => sum + item.count, 0);
      const role = actor ? PILL_ROLE_PRIORITY.find((item) => actor.roles.has(item)) || "" : "";
      trigger.classList.toggle("is-compact", compact);
      trigger.classList.toggle("is-empty", !actor);
      trigger.classList.toggle("has-unseen", unseen > 0);
      trigger.classList.toggle("is-rotating", !compact && actors.length > 1 && !locked);
      ROLE_ORDER.forEach((item) => trigger.classList.toggle(`is-role-${item}`, item === role));
      // 다시보기는 재생 틱마다 부른다. 보이는 내용이 같으면 배지 img 를 다시 만들지 않는다.
      const key = compact
        ? `c:${unseen}`
        : actor ? `a:${actor.nickname}:${actor.count}:${[...actor.roles].join(",")}` : "e";
      if (key === paintedKey) return;
      paintedKey = key;
      badges.replaceChildren();
      label.replaceChildren();
      let shown = 0;
      let text = "새 채팅 없음";
      if (compact) {
        shown = unseen;
        if (unseen) text = `읽지 않은 배지 채팅 ${unseen}개, 모아보기 열기`;
      } else if (actor) {
        shown = actor.count;
        ROLE_ORDER.filter((item) => item !== "partner" && actor.roles.has(item))
          .forEach((item) => badges.append(roleImage(item)));
        const name = doc.createElement("span");
        name.className = `${classPrefix}-name`;
        name.textContent = actor.nickname;
        label.append(name);
        if (actor.roles.has("partner"))
          label.append(roleImage("partner", `${classPrefix}-partner-mark`));
        text = `${actor.nickname} 배지 채팅 ${actor.count}개 모아보기`;
      } else {
        label.textContent = "새 채팅 없음";
      }
      count.textContent = shown > 99 ? "99+" : shown ? String(shown) : "";
      count.hidden = shown <= 0;
      trigger.setAttribute("aria-label", text);
      trigger.title = text;
    }

    function render(next) {
      actors = next.actors || [];
      compact = next.compact === true;
      glow = next.glow !== false;
      if (!glow || !actors.length) clearAttention();
      const nextSignature = actors
        .map((actor) => `${actor.nickname}:${actor.count}:${actor.last}`)
        .join("\u001f");
      if (nextSignature !== signature) {
        signature = nextSignature;
        index = 0;
      }
      if (compact || actors.length <= 1) {
        stopCycle();
      } else if (!cycleTimer) {
        cycleTimer = view.setInterval(() => {
          if (Date.now() < lockUntil || actors.length <= 1) return;
          index = (index + 1) % actors.length;
          paint();
        }, PILL_CYCLE_INTERVAL_MS);
      }
      paint();
    }

    function attention() {
      if (!glow || !actors.length) return;
      lockUntil = Date.now() + PILL_ATTENTION_DURATION_MS;
      index = 0;
      view.clearTimeout(attentionTimer);
      trigger.classList.remove("is-attention");
      void trigger.offsetWidth;
      trigger.classList.add("is-attention");
      attentionTimer = view.setTimeout(() => {
        attentionTimer = 0;
        lockUntil = 0;
        trigger.classList.remove("is-attention");
        paint();
      }, PILL_ATTENTION_DURATION_MS);
      paint();
    }

    function dispose() {
      stopCycle();
      clearAttention();
    }

    return { render, attention, clearAttention, dispose };
  }

  // 팝업 펼침·접힘 애니메이션. 접히는 동안에는 inert 로 클릭을 막고, 끝나면 숨긴다.
  function createPopoverMotion(popover) {
    const view = popover.ownerDocument.defaultView;
    let timer = 0;
    const reducedMotion = () =>
      view.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    function open() {
      view.clearTimeout(timer);
      popover.classList.remove("is-opening", "is-closing");
      popover.inert = false;
      popover.hidden = false;
      if (reducedMotion()) return;
      void popover.offsetWidth;
      popover.classList.add("is-opening");
      timer = view.setTimeout(() => popover.classList.remove("is-opening"), POPOVER_OPEN_MS);
    }

    function close(immediate = false) {
      view.clearTimeout(timer);
      popover.classList.remove("is-opening");
      if (immediate || popover.hidden || reducedMotion()) {
        popover.classList.remove("is-closing");
        popover.inert = false;
        popover.hidden = true;
        return;
      }
      popover.classList.add("is-closing");
      popover.inert = true;
      timer = view.setTimeout(() => {
        popover.classList.remove("is-closing");
        popover.inert = false;
        popover.hidden = true;
      }, POPOVER_CLOSE_MS);
    }

    return { open, close, dispose: () => view.clearTimeout(timer) };
  }

  function rowMessage(row) {
    const identity = row.querySelector(
      'button[class*="_nickname_"], button[class*="_profile_button_"], button[class*="_name_"]',
    );
    const nicknameNode = identity?.querySelector('[class*="_nickname_"]');
    const nickname = nicknameNode?.textContent ||
      identity?.textContent || "";
    const messageContainer = row.querySelector('[class*="_chatting_message_"]');
    const content = Array.from(messageContainer?.children || [])
      .find((child) => child.matches('[class*="_text_"]'));
    let text = content?.textContent || "";
    if (!text && messageContainer) {
      text = messageContainer.innerText || messageContainer.textContent || "";
      if (nickname) text = text.replace(nickname, "");
    }
    if (!text && !messageContainer) {
      text = row.innerText || row.textContent || "";
      if (nickname) text = text.replace(nickname, "");
    }
    const badges = [];
    identity?.querySelectorAll("img").forEach((image) => {
      const src = image.currentSrc || image.src || "";
      if (!/^https:\/\//i.test(src)) return;
      const beforeNickname = nicknameNode &&
        (image.compareDocumentPosition(nicknameNode) & win.Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      badges.push({
        src,
        alt: image.alt || image.title || "",
        position: beforeNickname ? "before" : "after",
      });
    });
    const getColor = (element) => {
      if (!element) return "";
      const color = win.getComputedStyle(element).color;
      return color && color !== "canvastext" ? color : "";
    };
    const timeNode = row.querySelector("[data-chat-epoch-ms], .cheese-chat-time, time");
    const special = isSpecialMessageRow(row);
    return normalizeCapturedMessage({
      role: "partner",
      nickname,
      text,
      badges,
      timeText: timeNode?.textContent || "",
      nicknameColor: getColor(nicknameNode),
      messageColor: getColor(content),
      special,
    });
  }

  function createRoleHighlighter(win) {
    const document = win.document;
    const rowSelector =
      '[class*="live_chatting_list_item"], [class*="vod_chatting_item"], [class*="_item_"]';
    // 항목은 메시지(_chatting_message_)에서 가장 가까운 _item_ 조상으로 정한다.
    // 닉네임 버튼 안쪽에도 _item_ 이 붙은 요소가 있어 거기서 closest 하면 엉뚱한
    // 요소에 하이라이트가 걸린다(원본의 isNewChatItem 과 같은 기준).
    const messageSelector =
      '[class*="_chatting_message_"], [class*="chatting_message_container"]';
    let aside = null;
    let listObserver = null;
    let parentObserver = null;
    let discoveryObserver = null;
    let pendingRows = new Set();
    let renderFrame = 0;
    let disposed = false;
    let sentRows = new WeakMap();
    let roleMessages = [];
    let popoverAnchor = null;
    let popoverTrigger = null;
    let popoverHeading = null;
    let popoverHeadingParent = null;
    let popoverBadges = null;
    let popoverLabel = null;
    let popoverCount = null;
    let popoverCompactIcon = null;
    let popoverClose = null;
    let popover = null;
    let popoverList = null;
    let popoverEmpty = null;
    let popoverResize = null;
    let popoverFontScalePercent = 100;
    let pill = null;
    let popoverMotion = null;
    let popoverOpen = false;
    let dismissListenersAttached = false;
    let lastSeenSequence = 0;
    let nextMessageSequence = 0;
    let popoverHeight = 320;
    let resizeStart = null;
    let storageChangeListener = null;
    let badgeSettingsRevision = 0;
    const badgeSettings = {
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
    };
    const BADGE_SETTING_KEYS = [
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
    ];

    function applyBadgeSettings(values = {}) {
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePillButton"))
        badgeSettings.hidePillButton = values.cheeseMultiviewBadgeChatHidePillButton === true;
      else if (Object.hasOwn(values, "cheeseMultiviewBadgeChatButton"))
        badgeSettings.hidePillButton = values.cheeseMultiviewBadgeChatButton === false;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHideEmptyButton"))
        badgeSettings.hideEmptyButton = values.cheeseMultiviewBadgeChatHideEmptyButton === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHideChatBackground"))
        badgeSettings.hideChatBackground = values.cheeseMultiviewBadgeChatHideChatBackground === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHideChatBorder"))
        badgeSettings.hideChatBorder = values.cheeseMultiviewBadgeChatHideChatBorder === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePopupBackground"))
        badgeSettings.hidePopupBackground = values.cheeseMultiviewBadgeChatHidePopupBackground === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePopupBorder"))
        badgeSettings.hidePopupBorder = values.cheeseMultiviewBadgeChatHidePopupBorder === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatHidePopupTime"))
        badgeSettings.hidePopupTime = values.cheeseMultiviewBadgeChatHidePopupTime === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatRoleBadgesOnly"))
        badgeSettings.roleBadgesOnly = values.cheeseMultiviewBadgeChatRoleBadgesOnly === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatKeepPopupOpen"))
        badgeSettings.keepPopupOpen = values.cheeseMultiviewBadgeChatKeepPopupOpen === true;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatPillGlowEnabled"))
        badgeSettings.pillGlowEnabled = values.cheeseMultiviewBadgeChatPillGlowEnabled !== false;
      if (Object.hasOwn(values, "cheeseMultiviewBadgeChatCompactPill"))
        badgeSettings.compactPill = values.cheeseMultiviewBadgeChatCompactPill === true;
      if (badgeSettings.hidePillButton) badgeSettings.keepPopupOpen = false;
      document.documentElement.classList.toggle("cheese-mv-badge-no-chat-bg", badgeSettings.hideChatBackground);
      document.documentElement.classList.toggle("cheese-mv-badge-no-chat-border", badgeSettings.hideChatBorder);
      updatePopoverCount();
      updatePopoverSettings();
      if (popoverOpen) renderPopoverMessages();
      else if (badgeSettings.keepPopupOpen && roleMessages.length) openPopover();
    }

    function updatePopoverSettings() {
      if (popoverTrigger) popoverTrigger.hidden = badgeSettings.hidePillButton ||
        (badgeSettings.hideEmptyButton && !hasUnreadMessages());
      if (popoverClose) popoverClose.disabled = badgeSettings.keepPopupOpen;
      if (popover) popover.classList.toggle("is-locked-open", badgeSettings.keepPopupOpen);
      if (badgeSettings.hidePillButton && popoverOpen) closePopover(true);
    }

    function triggerAttention() {
      if (!badgeSettings.pillGlowEnabled || badgeSettings.keepPopupOpen || popoverOpen) return;
      pill?.attention();
    }

    function hasUnreadMessages() {
      return roleMessages.some((message) => message.sequence > lastSeenSequence);
    }

    const style = document.createElement("style");
    style.id = "cheese-multiview-badge-chat-style";
    style.textContent =
      `aside#aside-chatting [data-cheese-mv-badge-role] > [class*="_container_"] {` +
      `border: 1px solid transparent !important; border-radius: 8px !important;` +
      `transition: border-color .18s ease, background-color .18s ease !important;}` +
      `aside#aside-chatting [data-cheese-mv-badge-role="manager"]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `background: linear-gradient(90deg, rgba(94,157,255,.18), rgba(94,157,255,.05)) !important;` +
      `border-color: rgba(94,157,255,.55) !important;}` +
      `aside#aside-chatting [data-cheese-mv-badge-role="partner"]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `background: linear-gradient(90deg, rgba(34,197,94,.2), rgba(34,197,94,.06)) !important;` +
      `border-color: rgba(34,197,94,.58) !important;}` +
      `aside#aside-chatting [data-cheese-mv-badge-role="streamer"]:not([data-cheese-mv-badge-special]) > [class*="_container_"],` +
      `aside#aside-chatting [data-cheese-mv-badge-role="operator"]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `background: linear-gradient(90deg, rgba(255,105,125,.2), rgba(255,105,125,.06)) !important;` +
      `border-color: rgba(255,105,125,.58) !important;}` +
      `aside#aside-chatting [data-cheese-mv-badge-role="operator"]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `background: linear-gradient(90deg, rgba(0,199,155,.2), rgba(0,199,155,.06)) !important;` +
      `border-color: rgba(0,199,155,.58) !important;}` +
      `html.cheese-mv-badge-no-chat-bg aside#aside-chatting [data-cheese-mv-badge-role]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `background: transparent !important;}` +
      `html.cheese-mv-badge-no-chat-border aside#aside-chatting [data-cheese-mv-badge-role]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `border-color: transparent !important;}` +
      `aside#aside-chatting [data-cheese-mv-badge-role="partner"]:not([data-cheese-mv-badge-special]) :is([class*="_nickname_"], [class*="_text_"]) {` +
      `color: var(--cheese-mv-badge-partner-text) !important;}` +
      `:root { --cheese-mv-badge-partner-text: #4ade80; }` +
      `html[data-theme="light"] { --cheese-mv-badge-partner-text: #15803d; }` +
      `html[data-theme="light"] aside#aside-chatting [data-cheese-mv-badge-role="streamer"]:not([data-cheese-mv-badge-special]) > [class*="_container_"] {` +
      `background: linear-gradient(90deg, rgba(255,166,84,.14), rgba(255,166,84,.035)) !important;` +
      `border-color: rgba(255,166,84,.44) !important;}` +
      `.cheese-mv-badge-chat-heading { position:relative !important; }` +
      `.cheese-mv-badge-chat-anchor { align-items:center; display:inline-flex; position:absolute;` +
      `left:10px; top:50%; transform:translateY(-50%); z-index:2; }` +
      `.cheese-mv-badge-chat-trigger { --pill-bg:rgba(255,148,183,.24);` +
      `--pill-text-color:inherit; --pill-border-color:rgba(255,255,255,.32);` +
      `--pill-hover-bg:rgba(255,170,198,.3); --pill-shadow:0 4px 14px rgba(31,38,135,.25),` +
      `inset 0 12px 14px -8px rgba(255,255,255,.34);` +
      `--pill-hover-shadow:0 6px 18px rgba(31,38,135,.3), inset 0 14px 16px -8px rgba(255,255,255,.42);` +
      `--pill-count-bg:rgba(255,255,255,.2); --pill-count-color:inherit;` +
      `--pill-count-border:rgba(255,255,255,.28); --pill-backdrop:blur(12px) saturate(120%);` +
      `--pill-roll-color:rgba(255,235,244,.95); --pill-glow-ring-color:rgba(255,255,255,.24);` +
      `align-items:center; background:var(--pill-bg);` +
      `-webkit-backdrop-filter:var(--pill-backdrop); backdrop-filter:var(--pill-backdrop);` +
      `border:1px solid var(--pill-border-color); border-radius:999px; box-shadow:var(--pill-shadow);` +
      `color:var(--pill-text-color); cursor:pointer; display:inline-flex; position:relative;` +
      `font-family:Escoredream,-apple-system,` +
      `BlinkMacSystemFont,"Malgun Gothic",sans-serif; font-size:11px; font-weight:600; gap:3px; height:32px;` +
      `isolation:isolate; line-height:1; max-width:min(210px,calc(100vw - 80px)); padding:0 6px;` +
      `transition:border-color .2s ease,background-color .2s ease,` +
      `box-shadow .2s ease,transform .2s ease; white-space:nowrap;}` +
      `.cheese-mv-badge-chat-trigger:hover,.cheese-mv-badge-chat-trigger:focus-visible,` +
      `.cheese-mv-badge-chat-trigger[aria-expanded="true"] { background:var(--pill-hover-bg);` +
      `border-color:rgba(255,255,255,.45); box-shadow:var(--pill-hover-shadow);}` +
      `.cheese-mv-badge-chat-trigger > * { position:relative; z-index:2;}` +
      `.cheese-mv-badge-chat-trigger::before { background:radial-gradient(circle at center,` +
      `color-mix(in srgb,var(--pill-roll-color) 70%,white 30%) 0%,var(--pill-roll-color) 36%,` +
      `color-mix(in srgb,var(--pill-roll-color) 40%,transparent 60%) 62%,transparent 100%);` +
      `border-radius:inherit; content:""; filter:blur(8px); inset:-7px; opacity:0; pointer-events:none;` +
      `position:absolute; transform:scale(.96); z-index:0;}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger::before { background:radial-gradient(circle at center,` +
      `color-mix(in srgb,var(--pill-roll-color) 55%,white 45%) 0%,var(--pill-roll-color) 32%,` +
      `color-mix(in srgb,var(--pill-roll-color) 25%,transparent 75%) 58%,transparent 100%); filter:blur(5px); inset:-5px;}` +
      `.cheese-mv-badge-chat-trigger.is-attention { animation:cheese-mv-badge-glow-pulse 1.45s ease-in-out infinite;` +
      `box-shadow:var(--pill-hover-shadow),0 0 0 1px var(--pill-glow-ring-color);}` +
      `.cheese-mv-badge-chat-trigger.is-attention::before { animation:cheese-mv-badge-glow-aura 1.45s ease-in-out infinite; opacity:1;}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-attention { animation-name:cheese-mv-badge-glow-pulse-dark;}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-attention::before { animation-name:cheese-mv-badge-glow-aura-dark;}` +
      `.cheese-mv-badge-chat-trigger.is-rotating > :is(.cheese-mv-badge-chat-badges,.cheese-mv-badge-chat-label,.cheese-mv-badge-chat-count) {` +
      `animation:cheese-mv-badge-pill-fade 2.4s ease-in-out infinite;}` +
      `.cheese-mv-badge-chat-trigger.is-role-manager:not(.is-empty) { --pill-roll-color:rgba(120,190,255,.96); --pill-glow-ring-color:rgba(110,177,255,.38);}` +
      `.cheese-mv-badge-chat-trigger.is-role-partner:not(.is-empty) { --pill-roll-color:rgba(255,194,86,.96); --pill-glow-ring-color:rgba(255,194,86,.4);}` +
      `.cheese-mv-badge-chat-trigger.is-role-streamer:not(.is-empty) { --pill-roll-color:rgba(255,166,84,.96); --pill-glow-ring-color:rgba(255,166,84,.42);}` +
      `.cheese-mv-badge-chat-trigger.is-role-operator:not(.is-empty) { --pill-roll-color:rgba(0,215,168,.94); --pill-glow-ring-color:rgba(0,215,168,.38);}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-role-manager:not(.is-empty) { --pill-glow-ring-color:rgba(138,198,255,.46);}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-role-partner:not(.is-empty) { --pill-glow-ring-color:rgba(255,205,110,.48);}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-role-streamer:not(.is-empty) { --pill-glow-ring-color:rgba(255,184,112,.5);}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-role-operator:not(.is-empty) { --pill-glow-ring-color:rgba(74,226,187,.45);}` +
      `@keyframes cheese-mv-badge-glow-pulse {` +
      `0%,100% { box-shadow:var(--pill-hover-shadow),0 0 0 1px var(--pill-glow-ring-color),0 0 0 rgba(255,120,170,0); }` +
      `42% { box-shadow:var(--pill-hover-shadow),0 0 0 1px color-mix(in srgb,var(--pill-glow-ring-color) 82%,white 18%),` +
      `0 0 14px 2px color-mix(in srgb,var(--pill-roll-color) 45%,transparent 55%),` +
      `0 0 30px 8px color-mix(in srgb,var(--pill-roll-color) 30%,transparent 70%); }}` +
      `@keyframes cheese-mv-badge-glow-pulse-dark {` +
      `0%,100% { box-shadow:var(--pill-hover-shadow),0 0 0 1px var(--pill-glow-ring-color),0 0 0 rgba(255,120,170,0); }` +
      `42% { box-shadow:var(--pill-hover-shadow),0 0 0 1px color-mix(in srgb,var(--pill-glow-ring-color) 82%,white 18%),` +
      `0 0 8px 1px color-mix(in srgb,var(--pill-roll-color) 30%,transparent 70%),` +
      `0 0 18px 4px color-mix(in srgb,var(--pill-roll-color) 18%,transparent 82%); }}` +
      `@keyframes cheese-mv-badge-glow-aura { 0% { opacity:.2; transform:scale(.95); }` +
      `45% { opacity:.56; transform:scale(1.02); } 100% { opacity:.24; transform:scale(.97); }}` +
      `@keyframes cheese-mv-badge-glow-aura-dark { 0% { opacity:.12; transform:scale(.95); }` +
      `45% { opacity:.36; transform:scale(1.01); } 100% { opacity:.14; transform:scale(.97); }}` +
      `@keyframes cheese-mv-badge-pill-fade { 0%,100% { opacity:.38; } 18%,78% { opacity:1; }}` +
      `.cheese-mv-badge-chat-trigger.is-empty { justify-content:center;}` +
      `.cheese-mv-badge-chat-trigger.is-empty .cheese-mv-badge-chat-badges { display:none;}` +
      `.cheese-mv-badge-chat-trigger.is-compact { justify-content:center; min-width:32px; overflow:visible; padding:0; width:32px;}` +
      `.cheese-mv-badge-chat-trigger.is-compact .cheese-mv-badge-chat-badges,` +
      `.cheese-mv-badge-chat-trigger.is-compact .cheese-mv-badge-chat-label { display:none;}` +
      `.cheese-mv-badge-chat-compact-icon { display:none; flex:none; height:18px; width:18px;}` +
      `.cheese-mv-badge-chat-trigger.is-compact .cheese-mv-badge-chat-compact-icon { display:block;}` +
      `.cheese-mv-badge-chat-trigger.is-compact .cheese-mv-badge-chat-count { background:#e83969;` +
      `border-color:rgba(255,255,255,.72); box-shadow:0 2px 5px rgba(30,12,20,.28); color:#fff; font-size:9px;` +
      `height:17px; min-width:17px; padding:0 4px; position:absolute; right:-7px; top:-5px; z-index:3;}` +
      `@media (prefers-reduced-motion:reduce) { .cheese-mv-badge-chat-trigger.is-attention,` +
      `.cheese-mv-badge-chat-trigger.is-attention::before,` +
      `.cheese-mv-badge-chat-trigger.is-rotating > *,` +
      `.cheese-mv-badge-chat-popover:is(.is-opening,.is-closing) { animation:none !important; }}` +
      `.cheese-mv-badge-chat-trigger.is-empty { --pill-bg:linear-gradient(135deg,rgba(255,255,255,.76),` +
      `rgba(233,242,255,.42)); --pill-text-color:#3e4c66; --pill-border-color:rgba(120,138,173,.35);` +
      `--pill-hover-bg:linear-gradient(135deg,rgba(255,255,255,.84),rgba(239,246,255,.52));` +
      `--pill-shadow:0 10px 26px rgba(64,85,128,.2),inset 0 14px 16px -9px rgba(255,255,255,.9);` +
      `--pill-hover-shadow:0 12px 30px rgba(64,85,128,.26),inset 0 16px 18px -10px rgba(255,255,255,.96);` +
      `--pill-count-bg:rgba(232,240,255,.95); --pill-count-color:#3b557a; --pill-count-border:rgba(150,171,214,.52);}` +
      `.cheese-mv-badge-chat-trigger:focus-visible { outline:2px solid #8b6ce8; outline-offset:2px;}` +
      `.cheese-mv-badge-chat-trigger:active { transform:translateY(1px) scale(.995);}` +
      `.cheese-mv-badge-chat-trigger[hidden] { display:none !important;}` +
      `html[data-theme="light"] .cheese-mv-badge-chat-trigger:not(.is-empty) {` +
      `--pill-bg:linear-gradient(135deg,rgba(255,255,255,.58),rgba(255,215,232,.34));` +
      `--pill-text-color:#5a3243; --pill-border-color:rgba(255,255,255,.74);` +
      `--pill-hover-bg:linear-gradient(135deg,rgba(255,255,255,.66),rgba(255,221,237,.42));` +
      `--pill-shadow:0 10px 28px rgba(92,50,73,.2),inset 0 14px 16px -9px rgba(255,255,255,.96);` +
      `--pill-hover-shadow:0 12px 30px rgba(92,50,73,.26),inset 0 16px 18px -10px #fff;` +
      `--pill-count-bg:rgba(255,255,255,.7); --pill-count-color:#5a3243; --pill-count-border:rgba(255,255,255,.82);}` +
      `html:not(.theme_dark) .cheese-mv-badge-chat-trigger:not(.is-empty) {` +
      `--pill-bg:linear-gradient(135deg,rgba(255,255,255,.58),rgba(255,215,232,.34));` +
      `--pill-text-color:#5a3243; --pill-border-color:rgba(255,255,255,.74);` +
      `--pill-hover-bg:linear-gradient(135deg,rgba(255,255,255,.66),rgba(255,221,237,.42));` +
      `--pill-shadow:0 10px 28px rgba(92,50,73,.2),inset 0 14px 16px -9px rgba(255,255,255,.96);` +
      `--pill-hover-shadow:0 12px 30px rgba(92,50,73,.26),inset 0 16px 18px -10px #fff;` +
      `--pill-count-bg:rgba(255,255,255,.7); --pill-count-color:#5a3243; --pill-count-border:rgba(255,255,255,.82);}` +
      `html[data-theme="dark"] .cheese-mv-badge-chat-trigger.is-empty { --pill-bg:rgba(87,103,136,.26);` +
      `--pill-text-color:#dfe6f9; --pill-border-color:rgba(201,213,245,.28);` +
      `--pill-hover-bg:rgba(99,116,152,.34); --pill-count-bg:rgba(204,220,255,.2);` +
      `--pill-count-color:#e9efff; --pill-count-border:rgba(214,226,255,.3);}` +
      `html.theme_dark .cheese-mv-badge-chat-trigger.is-empty { --pill-bg:rgba(87,103,136,.26);` +
      `--pill-text-color:#dfe6f9; --pill-border-color:rgba(201,213,245,.28);` +
      `--pill-hover-bg:rgba(99,116,152,.34); --pill-count-bg:rgba(204,220,255,.2);` +
      `--pill-count-color:#e9efff; --pill-count-border:rgba(214,226,255,.3);}` +
      `.cheese-mv-badge-chat-badges { align-items:center; display:inline-flex; flex:none; gap:2px;}` +
      `.cheese-mv-badge-chat-badges img { display:block; height:16px; object-fit:contain; width:16px;}` +
      `.cheese-mv-badge-chat-label { max-width:min(180px,30vw); overflow:hidden; text-overflow:ellipsis;` +
      `align-items:center; display:inline-flex; gap:2px; min-width:0;}` +
      `.cheese-mv-badge-chat-name { height:20px; line-height:22px; min-width:0; overflow:hidden;` +
      `text-overflow:ellipsis; white-space:nowrap;}` +
      `.cheese-mv-badge-chat-partner-mark { display:block; flex:none; height:14px; object-fit:contain; width:14px;}` +
      `.cheese-mv-badge-chat-trigger.has-unseen:not(.is-compact) .cheese-mv-badge-chat-count {` +
      `background:rgba(255,74,124,.76); border-color:rgba(255,255,255,.42); color:#fff;}` +
      `html:not(.theme_dark) .cheese-mv-badge-chat-trigger.has-unseen:not(.is-compact) .cheese-mv-badge-chat-count {` +
      `background:rgba(209,49,98,.86); border-color:rgba(255,255,255,.58);}` +
      `.cheese-mv-badge-chat-count { align-items:center; background:var(--pill-count-bg);` +
      `border:1px solid var(--pill-count-border); border-radius:999px; color:var(--pill-count-color);` +
      `display:inline-flex; font-size:10px; font-variant-numeric:tabular-nums; font-weight:700;` +
      `height:18px; justify-content:center; min-width:fit-content; padding:0 6px;}` +
      `.cheese-mv-badge-chat-count[hidden] { display:none !important;}` +
      `.cheese-mv-badge-chat-popover { background:#141517; border:1px solid #34383d; border-radius:10px;` +
      `box-shadow:0 18px 30px rgba(0,0,0,.35); color:#e8eaed; display:flex; flex-direction:column;` +
      `box-sizing:border-box; height:min(320px,65vh); max-height:calc(100vh - 16px); min-height:120px; overflow:hidden; position:fixed;` +
      `width:min(360px,calc(100vw - 16px));` +
      `z-index:2147483000;}` +
      `.cheese-mv-badge-chat-popover[hidden] { display:none !important; }` +
      `.cheese-mv-badge-chat-popover { --cheese-mv-badge-flow-shift:-8px; transform-origin:top center;}` +
      `.cheese-mv-badge-chat-popover.is-above { --cheese-mv-badge-flow-shift:8px; transform-origin:bottom center;}` +
      `.cheese-mv-badge-chat-popover.is-opening { animation:cheese-mv-badge-flow-down .32s cubic-bezier(.16,1,.3,1);}` +
      `.cheese-mv-badge-chat-popover.is-closing { animation:cheese-mv-badge-flow-up .28s cubic-bezier(.4,0,1,1) forwards;}` +
      `@keyframes cheese-mv-badge-flow-down { 0% { opacity:0; transform:translateY(var(--cheese-mv-badge-flow-shift)) scaleY(.08); }` +
      `70% { opacity:1; } 100% { opacity:1; transform:translateY(0) scaleY(1); }}` +
      `@keyframes cheese-mv-badge-flow-up { 0% { opacity:1; transform:translateY(0) scaleY(1); }` +
      `100% { opacity:0; transform:translateY(var(--cheese-mv-badge-flow-shift)) scaleY(.08); }}` +
      `.cheese-mv-badge-chat-popover-head { align-items:center; border-bottom:1px solid #34383d; display:flex;` +
      `flex:none; gap:4px; justify-content:space-between; min-height:36px; padding:4px 8px 4px 12px;}` +
      `.cheese-mv-badge-chat-popover-head strong { color:inherit; font-size:12px; font-weight:700;` +
      `margin-right:auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}` +
      `.cheese-mv-badge-chat-font-scale { align-items:center; display:flex; flex:none; gap:3px;}` +
      `.cheese-mv-badge-chat-font-scale button { align-items:center; background:transparent; border:0;` +
      `border-radius:4px; color:inherit; cursor:pointer; display:inline-flex; font:inherit; font-size:13px;` +
      `height:24px; justify-content:center; padding:0; width:24px;}` +
      `.cheese-mv-badge-chat-font-scale button:hover:not(:disabled) { background:rgba(139,108,232,.2);}` +
      `.cheese-mv-badge-chat-font-scale button:focus-visible { outline:2px solid #8b6ce8; outline-offset:1px;}` +
      `.cheese-mv-badge-chat-font-scale button:disabled { cursor:default; opacity:.4;}` +
      `.cheese-mv-badge-chat-font-scale-value { font-size:10px; font-variant-numeric:tabular-nums;` +
      `min-width:34px; text-align:center;}` +
      `.cheese-mv-badge-chat-close { align-items:center; background:transparent; border:0; border-radius:5px;` +
      `color:#9aa1a9; cursor:pointer; display:inline-flex; height:26px; justify-content:center; padding:0; width:26px;}` +
      `.cheese-mv-badge-chat-close:hover { background:rgba(139,108,232,.2); color:#e8eaed;}` +
      `.cheese-mv-badge-chat-popover.is-locked-open .cheese-mv-badge-chat-close { cursor:not-allowed; opacity:.45;}` +
      `.cheese-mv-badge-chat-list { display:flex; flex:1 1 auto; flex-direction:column; gap:3px; min-height:0;` +
      `overflow-x:hidden; overflow-y:auto; padding:8px; scrollbar-width:thin;}` +
      `.cheese-mv-badge-chat-list { font-size:calc(12px * var(--mv-badge-chat-font-scale, 1));}` +
      `.cheese-mv-badge-chat-inline { align-items:baseline; display:flex; flex-wrap:wrap; gap:0 4px;}` +
      // 닉네임이 기준선에 참여해야 메시지 글자와 줄이 맞는다. 배지 묶음만 가운데 정렬한다
      // (전부 center 면 기준선이 배지 img 아래 끝으로 잡혀 닉네임이 위로 뜬다).
      `.cheese-mv-badge-chat-identity { align-items:baseline; display:inline-flex; flex-wrap:wrap; gap:0 4px;}` +
      `.cheese-mv-badge-chat-badge-group { align-items:center; align-self:center; display:inline-flex; gap:4px;}` +
      `.cheese-mv-badge-chat-badge-group img { display:block; height:calc(18px * var(--mv-badge-chat-font-scale, 1));` +
      `object-fit:contain; width:calc(18px * var(--mv-badge-chat-font-scale, 1));}` +
      `.cheese-mv-badge-chat-time { color:#9aa1a9; font-size:.84em; white-space:nowrap;}` +
      `.cheese-mv-badge-chat-empty { color:#9aa1a9; display:grid; flex:1 1 auto; min-height:60px;` +
      `place-content:center; text-align:center;}` +
      `.cheese-mv-badge-chat-empty[hidden] { display:none; }` +
      `.cheese-mv-badge-chat-resize { background:transparent; cursor:ns-resize; flex:none; height:10px; touch-action:none;}` +
      `.cheese-mv-badge-chat-resize::after { background:#626b78; border-radius:999px; content:""; display:block;` +
      `height:3px; margin:3px auto 0; width:32px;}` +
      `.cheese-mv-badge-chat-row { border:1px solid transparent; border-radius:8px; flex:none; line-height:1.45;` +
      `overflow-wrap:anywhere; padding:4px 7px;}` +
      `.cheese-mv-badge-chat-row.is-message-bg-hidden:not(.is-special) { background:transparent !important;}` +
      `.cheese-mv-badge-chat-row.is-message-border-hidden { border-color:transparent !important;}` +
      `.cheese-mv-badge-chat-row.is-badge-streamer:not(.is-special) { background:linear-gradient(90deg,rgba(255,105,125,.2),rgba(255,105,125,.06));` +
      `border-color:rgba(255,105,125,.58);}` +
      `.cheese-mv-badge-chat-row.is-badge-manager:not(.is-special) { background:linear-gradient(90deg,rgba(94,157,255,.18),rgba(94,157,255,.05));` +
      `border-color:rgba(94,157,255,.55);}` +
      `.cheese-mv-badge-chat-row.is-badge-operator:not(.is-special) { background:linear-gradient(90deg,rgba(0,199,155,.2),rgba(0,199,155,.06));` +
      `border-color:rgba(0,199,155,.58);}` +
      `.cheese-mv-badge-chat-row.is-badge-partner:not(.is-special) { background:linear-gradient(90deg,rgba(34,197,94,.2),rgba(34,197,94,.06));` +
      `border-color:rgba(34,197,94,.58);}` +
      `.cheese-mv-badge-chat-row.is-badge-partner:not(.is-special) strong { color:#4ade80;}` +
      `html[data-theme="light"] .cheese-mv-badge-chat-popover { background:rgba(255,255,255,.98); border-color:rgba(186,197,220,.56); color:#202224;}` +
      `html[data-theme="light"] .cheese-mv-badge-chat-popover-head { border-color:rgba(186,197,220,.56);}` +
      `html[data-theme="light"] .cheese-mv-badge-chat-close { color:#626b78;}` +
      `html[data-theme="light"] .cheese-mv-badge-chat-row.is-badge-streamer:not(.is-special) {` +
      `background:linear-gradient(90deg,rgba(255,166,84,.14),rgba(255,166,84,.035)); border-color:rgba(255,166,84,.44);}` +
      `html[data-theme="light"] .cheese-mv-badge-chat-row.is-badge-partner:not(.is-special) strong { color:#15803d;}`;
    (document.head || document.documentElement).appendChild(style);

    // 바닥 근처를 보던 중이거나 막 연 경우만 바닥에 붙인다. 위로 올려 읽는 중에는
    // 새 채팅이 와도 위치를 빼앗지 않는다(원본의 scrollListToBottom 과 같은 기준).
    function renderPopoverMessages(pinToBottom = false) {
      if (!popoverList) return;
      const nearBottom = popoverList.scrollHeight - popoverList.scrollTop -
        popoverList.clientHeight < 24;
      const previousScrollTop = popoverList.scrollTop;
      const fragment = document.createDocumentFragment();
      roleMessages.forEach((message) => {
        const row = document.createElement("article");
        row.className = `cheese-mv-badge-chat-row is-badge-${message.role}`;
        if (message.special) row.classList.add("is-special");
        if (badgeSettings.hidePopupBackground && !message.special)
          row.classList.add("is-message-bg-hidden");
        if (badgeSettings.hidePopupBorder) row.classList.add("is-message-border-hidden");
        const inline = document.createElement("span");
        inline.className = "cheese-mv-badge-chat-inline";
        if (!badgeSettings.hidePopupTime && message.timeText) {
          const time = document.createElement("time");
          time.className = "cheese-mv-badge-chat-time";
          time.textContent = message.timeText;
          inline.append(time);
        }
        const identity = document.createElement("span");
        identity.className = "cheese-mv-badge-chat-identity";
        const appendBadges = (position) => {
          const badges = (message.badges || []).filter((badge) =>
            badge.position === position && (!badgeSettings.roleBadgesOnly ||
              ROLE_ORDER.includes(classifyBadgeRole([badge.src, badge.alt]))),
          );
          if (!badges.length) return;
          const group = document.createElement("span");
          group.className = "cheese-mv-badge-chat-badge-group";
          badges.forEach((badge) => {
            const image = document.createElement("img");
            image.src = badge.src;
            image.alt = badge.alt;
            image.width = 18;
            image.height = 18;
            image.decoding = "async";
            group.append(image);
          });
          identity.append(group);
        };
        appendBadges("before");
        const nickname = document.createElement("strong");
        nickname.textContent = message.nickname || "알 수 없음";
        if (message.nicknameColor) nickname.style.color = message.nicknameColor;
        identity.append(nickname);
        appendBadges("after");
        inline.append(identity);
        if (message.text) {
          const text = document.createElement("span");
          text.className = "cheese-mv-badge-chat-message";
          text.textContent = message.text;
          if (message.messageColor) text.style.color = message.messageColor;
          inline.append(text);
        }
        row.append(inline);
        fragment.append(row);
      });
      popoverList.replaceChildren(fragment);
      if (popoverEmpty) popoverEmpty.hidden = roleMessages.length > 0;
      if (pinToBottom || nearBottom) {
        popoverList.scrollTop = popoverList.scrollHeight;
        // 펼침 애니메이션·배지 이미지로 높이가 늦게 정해지는 경우를 한 번 더 맞춘다.
        win.requestAnimationFrame(() => {
          if (popoverList) popoverList.scrollTop = popoverList.scrollHeight;
        });
      } else {
        popoverList.scrollTop = previousScrollTop;
      }
    }

    function updatePopoverCount() {
      if (!pill) return;
      pill.render({
        actors: collectPillActors(
          roleMessages.filter((message) => message.sequence > lastSeenSequence),
        ),
        compact: badgeSettings.compactPill,
        glow: badgeSettings.pillGlowEnabled,
      });
      updatePopoverSettings();
    }

    function positionPopover() {
      if (!popoverOpen || !popoverTrigger || !popover) return;
      const anchorRect = popoverTrigger.getBoundingClientRect();
      const asideRect = aside?.getBoundingClientRect();
      const margin = 8;
      const width = Math.max(0, Math.min(
        asideRect?.width || win.innerWidth - margin * 2,
        win.innerWidth - margin * 2,
      ));
      popover.style.width = `${width}px`;
      const maxHeight = Math.max(120, Math.min(720, win.innerHeight - margin * 2));
      popoverHeight = Math.min(popoverHeight, maxHeight);
      popover.style.height = `${popoverHeight}px`;
      if (popoverResize) popoverResize.setAttribute("aria-valuenow", String(Math.round(popoverHeight)));
      // ⚠ 펼침 애니메이션 중에는 scaleY 가 걸려 getBoundingClientRect 높이가 줄어든다.
      //   변형이 없는 레이아웃 크기로 자리를 잡는다.
      const panelRect = { width: popover.offsetWidth, height: popover.offsetHeight };
      const maxLeft = Math.max(margin, win.innerWidth - panelRect.width - margin);
      const left = Math.min(maxLeft, Math.max(margin, asideRect?.left ?? anchorRect.left));
      let top = anchorRect.bottom + 6;
      const above = top + panelRect.height > win.innerHeight - margin;
      if (above) top = anchorRect.top - panelRect.height - 6;
      top = Math.min(
        Math.max(margin, win.innerHeight - panelRect.height - margin),
        Math.max(margin, top),
      );
      popover.classList.toggle("is-above", above);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }

    function closePopover(force = false) {
      if (!force && badgeSettings.keepPopupOpen && !badgeSettings.hidePillButton) return;
      const wasOpen = popoverOpen;
      popoverOpen = false;
      if (popover) popoverMotion?.close(force || !wasOpen);
      popoverTrigger?.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", handleOutsidePointer, true);
      document.removeEventListener("keydown", handlePopoverKeydown, true);
      document.removeEventListener("scroll", positionPopover, true);
      win.removeEventListener("resize", positionPopover);
      dismissListenersAttached = false;
    }

    function handleOutsidePointer(event) {
      if (badgeSettings.keepPopupOpen) return;
      if (!popoverAnchor?.contains(event.target) && !popover?.contains(event.target))
        closePopover();
    }

    function handlePopoverKeydown(event) {
      if (badgeSettings.keepPopupOpen) return;
      if (event.key === "Escape") {
        closePopover();
        popoverTrigger?.focus();
      }
    }

    function openPopover() {
      if (!popover || !popoverTrigger || badgeSettings.hidePillButton) return;
      pill?.clearAttention();
      popoverOpen = true;
      lastSeenSequence = nextMessageSequence;
      updatePopoverCount();
      popoverMotion.open();
      popoverTrigger.setAttribute("aria-expanded", "true");
      positionPopover();
      renderPopoverMessages(true);
      if (!dismissListenersAttached) {
        document.addEventListener("pointerdown", handleOutsidePointer, true);
        document.addEventListener("keydown", handlePopoverKeydown, true);
        document.addEventListener("scroll", positionPopover, true);
        win.addEventListener("resize", positionPopover);
        dismissListenersAttached = true;
      }
    }

    function removePopover() {
      closePopover(true);
      pill?.dispose();
      popoverMotion?.dispose();
      pill = null;
      popoverMotion = null;
      popoverHeadingParent?.classList.remove("cheese-mv-badge-chat-heading");
      popoverAnchor?.remove();
      popover?.remove();
      popoverAnchor = null;
      popoverTrigger = null;
      popoverHeading = null;
      popoverHeadingParent = null;
      popoverBadges = null;
      popoverLabel = null;
      popoverCount = null;
      popoverCompactIcon = null;
      popoverClose = null;
      popover = null;
      popoverList = null;
      popoverEmpty = null;
      popoverResize = null;
    }

    function ensurePopover() {
      if (!aside) return;
      if (popoverAnchor?.isConnected && popoverHeading?.isConnected) return;
      if (popoverAnchor || popover) removePopover();
      const heading = Array.from(aside.querySelectorAll("h2"))
        .find((node) => node.textContent.trim() === "채팅");
      if (!heading?.parentElement || !document.body) return;

      popoverAnchor = document.createElement("span");
      popoverAnchor.className = "cheese-mv-badge-chat-anchor";
      popoverTrigger = document.createElement("button");
      popoverTrigger.type = "button";
      popoverTrigger.className = "cheese-mv-badge-chat-trigger";
      popoverTrigger.setAttribute("aria-expanded", "false");
      popoverTrigger.setAttribute("aria-haspopup", "dialog");
      popoverTrigger.setAttribute("aria-label", "배지 채팅 모아보기");
      popoverBadges = document.createElement("span");
      popoverBadges.className = "cheese-mv-badge-chat-badges";
      popoverBadges.setAttribute("aria-hidden", "true");
      const triggerText = document.createElement("span");
      triggerText.className = "cheese-mv-badge-chat-label";
      triggerText.textContent = "배지 채팅";
      popoverLabel = triggerText;
      popoverCompactIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      popoverCompactIcon.classList.add("cheese-mv-badge-chat-compact-icon");
      popoverCompactIcon.setAttribute("viewBox", "0 0 24 24");
      popoverCompactIcon.setAttribute("fill", "currentColor");
      popoverCompactIcon.setAttribute("aria-hidden", "true");
      const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      iconPath.setAttribute("d", "M5.25 4.5h13.5A2.25 2.25 0 0 1 21 6.75v7.5a2.25 2.25 0 0 1-2.25 2.25H10l-4.4 3.3a.75.75 0 0 1-1.2-.6v-2.83a2.25 2.25 0 0 1-1.4-2.12v-7.5A2.25 2.25 0 0 1 5.25 4.5Z");
      popoverCompactIcon.append(iconPath);
      popoverCount = document.createElement("span");
      popoverCount.className = "cheese-mv-badge-chat-count";
      popoverCount.hidden = true;
      popoverTrigger.append(popoverBadges, popoverCompactIcon, triggerText, popoverCount);
      popoverAnchor.append(popoverTrigger);
      popoverHeading = heading;
      popoverHeadingParent = heading.parentElement;
      popoverHeadingParent.classList.add("cheese-mv-badge-chat-heading");
      popoverHeadingParent.insertBefore(popoverAnchor, heading);

      popover = document.createElement("section");
      popover.className = "cheese-mv-badge-chat-popover";
      popover.setAttribute("role", "dialog");
      popover.setAttribute("aria-label", "배지 채팅 모아보기");
      popover.hidden = true;
      popover.style.setProperty("--mv-badge-chat-font-scale", String(popoverFontScalePercent / 100));
      const header = document.createElement("header");
      header.className = "cheese-mv-badge-chat-popover-head";
      const title = document.createElement("strong");
      title.textContent = "배지 채팅 모아보기";
      const fontScaleControls = createFontScaleControls({
        doc: document,
        classPrefix: "cheese-mv-badge-chat",
        initial: popoverFontScalePercent,
        onChange: (percent) => {
          popoverFontScalePercent = percent;
          popover?.style.setProperty("--mv-badge-chat-font-scale", String(percent / 100));
        },
      });
      const closeButton = document.createElement("button");
      popoverClose = closeButton;
      closeButton.type = "button";
      closeButton.className = "cheese-mv-badge-chat-close";
      closeButton.setAttribute("aria-label", "배지 채팅 팝오버 닫기");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "m18 6-12 12M6 6l12 12");
      svg.append(path);
      closeButton.append(svg);
      header.append(title, fontScaleControls?.element, closeButton);
      popoverEmpty = document.createElement("div");
      popoverEmpty.className = "cheese-mv-badge-chat-empty";
      popoverEmpty.textContent = "배지 채팅 없음";
      popoverList = document.createElement("div");
      popoverList.className = "cheese-mv-badge-chat-list";
      popoverList.setAttribute("role", "log");
      popoverList.setAttribute("aria-live", "off");
      popoverResize = document.createElement("div");
      popoverResize.className = "cheese-mv-badge-chat-resize";
      popoverResize.setAttribute("role", "separator");
      popoverResize.setAttribute("aria-orientation", "horizontal");
      popoverResize.setAttribute("aria-label", "배지 채팅 팝오버 높이 조절");
      popoverResize.setAttribute("aria-valuemin", "120");
      popoverResize.setAttribute("aria-valuemax", "720");
      popoverResize.setAttribute("aria-valuenow", String(popoverHeight));
      popoverResize.tabIndex = 0;
      popover.append(header, popoverEmpty, popoverList, popoverResize);
      document.body.append(popover);
      pill = createBadgePill({
        trigger: popoverTrigger,
        badges: popoverBadges,
        label: popoverLabel,
        count: popoverCount,
        classPrefix: "cheese-mv-badge-chat",
      });
      popoverMotion = createPopoverMotion(popover);
      popoverTrigger.addEventListener("click", (event) => {
        event.stopPropagation();
        if (popoverOpen) {
          if (!badgeSettings.keepPopupOpen) closePopover();
          return;
        }
        openPopover();
      });
      closeButton.addEventListener("click", () => closePopover());
      popoverResize.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        resizeStart = {
          y: event.clientY,
          height: popoverHeight,
          top: Number.parseFloat(popover.style.top) || 8,
          pointerId: event.pointerId,
        };
        popoverResize.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      popoverResize.addEventListener("pointermove", (event) => {
        if (!resizeStart || resizeStart.pointerId !== event.pointerId) return;
        const maxHeight = Math.max(120, Math.min(720, win.innerHeight - resizeStart.top - 8));
        popoverHeight = Math.max(120, Math.min(maxHeight, resizeStart.height + event.clientY - resizeStart.y));
        popover.style.height = `${popoverHeight}px`;
        popoverResize.setAttribute("aria-valuenow", String(Math.round(popoverHeight)));
      });
      const stopResize = (event) => {
        if (resizeStart?.pointerId === event.pointerId) resizeStart = null;
      };
      popoverResize.addEventListener("pointerup", stopResize);
      popoverResize.addEventListener("pointercancel", stopResize);
      popoverResize.addEventListener("lostpointercapture", stopResize);
      popoverResize.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const maxHeight = Math.max(120, Math.min(720, win.innerHeight - 16));
        const delta = event.key === "ArrowUp" ? 24 : -24;
        popoverHeight = Math.max(120, Math.min(maxHeight, popoverHeight + delta));
        positionPopover();
      });
      updatePopoverCount();
      updatePopoverSettings();
      renderPopoverMessages();
      if (badgeSettings.keepPopupOpen && !badgeSettings.hidePillButton && roleMessages.length)
        openPopover();
    }

    function appendRoleMessage(role, message, row, roles) {
      const normalizedRoles = [...new Set(roles)].filter((item) => ROLE_SET.has(item));
      const signature = `${role}\u001f${normalizedRoles.join(",")}\u001f${message.nickname}\u001f${message.text}`;
      if (!signature || sentRows.get(row) === signature) return;
      sentRows.set(row, signature);
      roleMessages.push({ ...message, role, roles: normalizedRoles, sequence: ++nextMessageSequence });
      if (roleMessages.length > 150) roleMessages.splice(0, roleMessages.length - 150);
      if (popoverOpen) lastSeenSequence = nextMessageSequence;
      updatePopoverCount();
      if (popoverOpen) renderPopoverMessages();
      else if (badgeSettings.keepPopupOpen && !badgeSettings.hidePillButton) openPopover();
      else triggerAttention();
    }

    function addRow(node, includeDescendants = false) {
      const element = node instanceof win.Element ? node : node?.parentElement;
      if (!element || !aside) return;
      const queue = (message) => {
        const row = message.closest(rowSelector);
        if (row && aside.contains(row)) pendingRows.add(row);
      };
      const ownMessage = element.closest(messageSelector);
      if (ownMessage) queue(ownMessage);
      else if (element.matches(rowSelector)) {
        const inner = element.querySelector(messageSelector);
        if (inner) queue(inner);
      }
      if (includeDescendants) element.querySelectorAll?.(messageSelector).forEach(queue);
      if (pendingRows.size && !renderFrame) renderFrame = win.requestAnimationFrame(flushRows);
    }

    function flushRows() {
      renderFrame = 0;
      const rows = pendingRows;
      pendingRows = new Set();
      rows.forEach((row) => {
        if (!row.isConnected) return;
        const special = isSpecialMessageRow(row);
        row.toggleAttribute("data-cheese-mv-badge-special", special);
        const signals = roleSignals(row);
        const roles = [...new Set(signals.map(classifyBadgeRole).filter(Boolean))];
        const role = ROLE_ORDER.find((candidate) => roles.includes(candidate)) ||
          classifyBadgeRole(signals);
        if (role) {
          if (row.getAttribute("data-cheese-mv-badge-role") !== role)
            row.setAttribute("data-cheese-mv-badge-role", role);
          const captured = rowMessage(row);
          if (captured) appendRoleMessage(role, captured, row, roles.length ? roles : [role]);
        } else {
          row.removeAttribute("data-cheese-mv-badge-role");
        }
      });
    }

    function watchForAside() {
      if (discoveryObserver || !document.documentElement) return;
      discoveryObserver = new win.MutationObserver(attachAside);
      discoveryObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    function attachAside() {
      if (disposed) return;
      const next = document.querySelector("aside#aside-chatting");
      if (next === aside) {
        ensurePopover();
        if (!next) watchForAside();
        return;
      }
      listObserver?.disconnect();
      parentObserver?.disconnect();
      removePopover();
      roleMessages = [];
      lastSeenSequence = 0;
      nextMessageSequence = 0;
      sentRows = new WeakMap();
      aside = next;
      if (!aside) {
        watchForAside();
        return;
      }
      discoveryObserver?.disconnect();
      discoveryObserver = null;
      listObserver = new win.MutationObserver((mutations) => {
        ensurePopover();
        mutations.forEach((mutation) => {
          addRow(mutation.target);
          mutation.addedNodes.forEach((node) => addRow(node, true));
        });
      });
      listObserver.observe(aside, {
        attributes: true,
        attributeFilter: ["src", "alt", "title", "aria-label", "class"],
        characterData: true,
        childList: true,
        subtree: true,
      });
      if (aside.parentElement) {
        parentObserver = new win.MutationObserver(attachAside);
        parentObserver.observe(aside.parentElement, { childList: true });
      }
      ensurePopover();
      addRow(aside, true);
    }

    const storage = globalThis.chrome?.storage;

    function dispose() {
      disposed = true;
      listObserver?.disconnect();
      parentObserver?.disconnect();
      discoveryObserver?.disconnect();
      if (renderFrame) win.cancelAnimationFrame(renderFrame);
      pendingRows.clear();
      removePopover();
      if (storageChangeListener) storage?.onChanged?.removeListener(storageChangeListener);
      style.remove();
      win.removeEventListener("pagehide", dispose);
    }

    attachAside();
    const settingsRevision = badgeSettingsRevision;
    storage?.local?.get(BADGE_SETTING_KEYS).then((values) => {
      if (settingsRevision === badgeSettingsRevision) applyBadgeSettings(values);
    }).catch(() => {});
    if (storage?.onChanged) {
      storageChangeListener = (changes, areaName) => {
        if (areaName !== "local") return;
        badgeSettingsRevision += 1;
        const values = {};
        BADGE_SETTING_KEYS.forEach((key) => {
          if (changes[key]) values[key] = changes[key].newValue;
        });
        if (Object.keys(values).length) applyBadgeSettings(values);
      };
      storage.onChanged.addListener(storageChangeListener);
    }
    win.addEventListener("pagehide", dispose, { once: true });
    return dispose;
  }

  const api = Object.freeze({
    classifyBadgeRole,
    normalizeCapturedMessage,
    collectPillActors,
    createBadgePill,
    createFontScaleControls,
    createPopoverMotion,
    createRoleHighlighter,
  });
  globalThis.CheeseMultiviewBadgeChat = api;
  if (typeof module === "object" && module.exports) module.exports = api;

  const win = globalThis.window;
  if (!win || win === win.top || win.location.origin !== "https://chzzk.naver.com") return;
  const params = new URLSearchParams(win.location.search);
  if (params.get("cheeseMultiChat") !== "1" ||
      !/^\/live\/[0-9a-f]{32}\/chat\/?$/i.test(win.location.pathname)) return;
  createRoleHighlighter(win);
})();
