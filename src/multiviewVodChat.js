// 멀티뷰에서 선택한 다시보기의 재생 시점 채팅을 페이지 단위로 가져온다.
(() => {
  "use strict";

  const PAGE_SIZE = 50;
  const LOOKAHEAD_MS = 12000;
  const SEEK_HISTORY_MS = 45000;
  const MAX_BUFFER_MESSAGES = 2000;
  const MAX_PAGES_PER_PUMP = 2;
  const MAX_MESSAGE_TEXT_LENGTH = 2000;
  const MAX_NICKNAME_LENGTH = 100;
  const MAX_BADGES = 12;
  const MAX_FALLBACK_COLOR_VIDEOS = 6;
  const DEFAULT_NICKNAME_COLORS = Object.freeze([
    "#2269d0", "#4659cf", "#842eaa", "#5ca314", "#b44ba2",
    "#b44ba2", "#6433c2", "#2a9b12", "#0b9f82", "#9836b8",
    "#de355c", "#10a391", "#e84e2d", "#d73181", "#219fc7",
  ]);
  const SAFE_IMAGE_URL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:pstatic\.net|naver\.com|navercdn\.com)\//i;
  const nicknameColorCodes = new Map();
  let nicknameColorCodeRevision = 0;
  const ROLE_BADGE_URLS = Object.freeze({
    streamer: "https://ssl.pstatic.net/static/nng/glive/icon/streamer.png",
    manager: "https://ssl.pstatic.net/static/nng/glive/icon/manager.png",
    operator: "https://ssl.pstatic.net/static/nng/glive/icon/owner.png",
    partner: "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png",
  });
  const ACHIEVEMENT_BADGE_URLS = globalThis.CheeseAchievementBadgeMap || {};

  function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string" || !value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  function safeImageUrl(value) {
    const url = String(value || "").trim();
    return SAFE_IMAGE_URL.test(url) ? url : "";
  }

  function collectBadges({ profile, user, userProfile, message, extras, streamingProperty, role }) {
    const seen = new Set();
    const badges = [];
    let beforeCount = 0;
    let afterCount = 0;
    const add = (candidate, label, position = "before") => {
      if (!candidate) return;
      const data = typeof candidate === "string" ? { imageUrl: candidate } : candidate;
      if (typeof data !== "object") return;
      const nested = data.badge && typeof data.badge === "object" ? data.badge : data;
      const url = safeImageUrl(
        nested.imageUrl || nested.badgeImageUrl || nested.iconUrl || nested.url || nested.image,
      );
      const positionCount = position === "after" ? afterCount : beforeCount;
      const positionLimit = position === "after" ? 2 : MAX_BADGES - 2;
      if (!url || seen.has(url) || badges.length >= MAX_BADGES || positionCount >= positionLimit) return;
      seen.add(url);
      if (position === "after") afterCount += 1;
      else beforeCount += 1;
      badges.push({
        url,
        position,
        label: String(label || nested.name || nested.badgeName || nested.title || nested.badgeId || "채팅 배지")
          .trim().slice(0, 40),
      });
    };
    const roleBadge = profile.badge || userProfile.badge || user.badge || message.badge;
    if (role) {
      add(roleBadge || ROLE_BADGE_URLS[role], role === "streamer" ? "방장" :
        role === "manager" ? "매니저" : role === "operator" ? "치지직 운영자" : "역할 배지");
    } else add(roleBadge, "역할 배지");
    const activityBadges = [
      ...(Array.isArray(profile.activityBadges) ? profile.activityBadges : []),
      ...(Array.isArray(userProfile.activityBadges) ? userProfile.activityBadges : []),
      ...(Array.isArray(user.activityBadges) ? user.activityBadges : []),
      ...(Array.isArray(streamingProperty.activityBadges) ? streamingProperty.activityBadges : []),
    ];
    for (const badge of activityBadges) add(badge, badge?.badge?.badgeId || badge?.badgeId || "활동 배지");
    add(profile.activityBadge || userProfile.activityBadge || user.activityBadge, "활동 배지");
    add(streamingProperty.subscription?.badge || profile.subscription?.badge || profile.subscriptionBadge,
      "구독 배지");
    for (const badge of [
      ...(Array.isArray(profile.viewerBadges) ? profile.viewerBadges : []),
      ...(Array.isArray(userProfile.viewerBadges) ? userProfile.viewerBadges : []),
      ...(Array.isArray(user.viewerBadges) ? user.viewerBadges : []),
    ]) add(badge, badge?.badge?.badgeId || "시청자 배지");
    for (const badge of [
      ...(Array.isArray(profile.badges) ? profile.badges : []),
      ...(Array.isArray(userProfile.badges) ? userProfile.badges : []),
      ...(Array.isArray(user.badges) ? user.badges : []),
      ...(Array.isArray(message.badges) ? message.badges : []),
      ...(Array.isArray(extras.badges) ? extras.badges : []),
    ]) add(badge, badge?.name || badge?.badgeName || "채팅 배지");

    const verified = profile.verifiedMark === true || userProfile.verifiedMark === true ||
      user.verifiedMark === true || message.verifiedMark === true;
    if (verified) add(ROLE_BADGE_URLS.partner, "파트너", "after");
    const activatedIds = Array.isArray(streamingProperty.activatedAchievementBadgeIds)
      ? streamingProperty.activatedAchievementBadgeIds
      : [];
    const achievementId = String(activatedIds[0] || "").trim();
    const achievementUrl = ACHIEVEMENT_BADGE_URLS[achievementId] ||
      ACHIEVEMENT_BADGE_URLS[achievementId.toLowerCase()];
    if (achievementUrl) add(achievementUrl, "업적 배지", "after");
    return badges;
  }

  function normalizeColorValue(value) {
    if (Array.isArray(value) && value.length >= 3) {
      value = { r: value[0], g: value[1], b: value[2] };
    }
    if (value && typeof value === "object") {
      const channels = [value.r ?? value.red ?? value.R, value.g ?? value.green ?? value.G,
        value.b ?? value.blue ?? value.B].map(Number);
      if (channels.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255))
        return `rgb(${channels.join(", ")})`;
      return "";
    }
    const raw = String(value || "").trim();
    if (!raw || raw.toUpperCase() === "CC000") return "";
    const color = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
    const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i);
    if (!rgb || rgb.slice(1, 4).some((part) => Number(part) > 255)) return "";
    const channels = rgb.slice(1, 4).map(Number).join(", ");
    return rgb[4] === undefined
      ? `rgb(${channels})`
      : `rgba(${channels}, ${Number(rgb[4])})`;
  }

  function setNicknameColorCodes(payload) {
    const next = new Map();
    const visited = new Set();
    const codeKeys = ["code", "colorCodeId", "nicknameColorCode", "id", "key", "colorCode"];
    const colorKeys = ["hexColor", "colorHexCode", "hexColorCode", "colorCodeHex",
      "colorCodeValue", "colorHex", "colorValue", "color", "hex", "rgb", "rgbColor",
      "colorRgb", "cssColor", "value"];
    const gradientDirections = {
      RIGHT: "to right",
      LEFT: "to left",
      TOP: "to top",
      BOTTOM: "to bottom",
      TOP_RIGHT: "to top right",
      TOP_LEFT: "to top left",
      BOTTOM_RIGHT: "to bottom right",
      BOTTOM_LEFT: "to bottom left",
    };
    const colorRecord = (value) => {
      const light = normalizeColorValue(value?.lightRgbValue);
      const dark = normalizeColorValue(value?.darkRgbValue);
      const effectType = String(value?.effectType || "").trim().toUpperCase();
      const effectValue = parseObject(value?.effectValue);
      const direction = gradientDirections[String(effectValue.direction || "RIGHT").toUpperCase()];
      if (light || dark) return {
        light: light || dark,
        dark: dark || light,
        effectType,
        lightBackground: normalizeColorValue(effectValue.lightRgbBackgroundValue),
        darkBackground: normalizeColorValue(effectValue.darkRgbBackgroundValue),
        lightEnd: normalizeColorValue(effectValue.lightRgbEndValue),
        darkEnd: normalizeColorValue(effectValue.darkRgbEndValue),
        direction: direction || "to right",
      };
      for (const key of colorKeys) {
        const color = normalizeColorValue(value?.[key]);
        if (color) return { light: color, dark: color, effectType: "" };
      }
      const colorCodeValue = normalizeColorValue(value?.colorCode);
      if (colorCodeValue) return { light: colorCodeValue, dark: colorCodeValue, effectType: "" };
      const color = normalizeColorValue(value);
      return color ? { light: color, dark: color, effectType: "" } : null;
    };
    const visit = (value, depth = 0, fallbackCode = "") => {
      if (!value || typeof value !== "object" || depth > 6 || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        const arrayColor = fallbackCode ? normalizeColorValue(value) : "";
        if (arrayColor) next.set(fallbackCode.toUpperCase(), {
          light: arrayColor, dark: arrayColor, effectType: "",
        });
        else for (const item of value.slice(0, 500)) visit(item, depth + 1, fallbackCode);
        return;
      }
      let code = fallbackCode;
      for (const key of codeKeys) {
        if ((typeof value[key] === "string" && value[key].trim()) ||
            (typeof value[key] === "number" && Number.isSafeInteger(value[key]))) {
          code = String(value[key]).trim();
          break;
        }
      }
      const colors = colorRecord(value);
      if (code && colors) next.set(code.toUpperCase(), colors);
      for (const [key, item] of Object.entries(value)) {
        if (key.toLowerCase() === "effectvalue") continue;
        if (typeof item === "string") {
          const mapped = normalizeColorValue(item);
          if (mapped && key.trim())
            next.set(key.trim().toUpperCase(), { light: mapped, dark: mapped, effectType: "" });
        } else {
          const structuralKey = ["content", "data", "items", "codes", "codelist", "list", "nicknamecolorcodes"]
            .includes(key.toLowerCase());
          visit(item, depth + 1, structuralKey ? "" : key);
        }
      }
    };
    visit(payload);
    if (!next.size) return false;
    nicknameColorCodes.clear();
    for (const [code, color] of next) nicknameColorCodes.set(code, color);
    nicknameColorCodeRevision += 1;
    return true;
  }

  function resolveNicknameColor(value, theme = "light") {
    const raw = String(value || "").trim();
    if (!raw || raw.toUpperCase() === "CC000") return "";
    const direct = normalizeColorValue(raw);
    if (direct) return direct;
    const mapped = nicknameColorCodes.get(raw.toUpperCase());
    if (typeof mapped === "string") return mapped;
    if (!mapped) return "";
    return theme === "dark" ? mapped.dark || mapped.light || "" : mapped.light || mapped.dark || "";
  }

  function resolveNicknameStyle(value, theme = "light") {
    const raw = String(value || "").trim();
    if (!raw || raw.toUpperCase() === "CC000") return "";
    const direct = normalizeColorValue(raw);
    if (direct) return `color:${direct};`;
    const mapped = nicknameColorCodes.get(raw.toUpperCase());
    if (!mapped) return "";
    const dark = theme === "dark";
    const color = dark ? mapped.dark || mapped.light : mapped.light || mapped.dark;
    if (!color) return "";
    if (mapped.effectType === "HIGHLIGHT") {
      const background = dark ? mapped.darkBackground : mapped.lightBackground;
      return `color:${color};${background ? `background-color:${background};border-radius:3px;padding:0 2px;` : ""}`;
    }
    if (mapped.effectType === "GRADATION") {
      const end = dark ? mapped.darkEnd || mapped.lightEnd : mapped.lightEnd || mapped.darkEnd;
      if (end) return `background-image:linear-gradient(${mapped.direction}, ${color}, ${end});background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;`;
    }
    return `color:${color};`;
  }

  function getNicknameColorCode(...sources) {
    for (const source of sources) {
      const value = typeof source === "string" || typeof source === "number"
        ? source
        : source?.colorCode ?? source?.code ?? source?.value;
      const code = String(value ?? "").trim();
      if (code) return code;
    }
    return "";
  }

  function formatBroadcastTime(timestamp, format = "24h", includeDate = false) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const hour = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    let time;
    if (format === "12h-ko" || format === "12h-en") {
      const marker = format === "12h-ko" ? (hour < 12 ? "오전" : "오후") : (hour < 12 ? "AM" : "PM");
      time = `${marker} ${hour % 12 || 12}:${minutes}`;
    } else {
      time = `${String(hour).padStart(2, "0")}:${minutes}`;
    }
    if (!includeDate) return time;
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.` +
      `${String(date.getDate()).padStart(2, "0")} ${time}`;
  }

  function normalizeEmojis(extras) {
    const source = extras.emojis;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const result = {};
    for (const [rawKey, rawValue] of Object.entries(source)) {
      const key = String(rawKey || "").replace(/^\{|\}$/g, "").replace(/^:|:$/g, "");
      const value = typeof rawValue === "string"
        ? rawValue
        : rawValue?.imageUrl || rawValue?.emojiImageUrl || rawValue?.url;
      const url = safeImageUrl(value);
      if (key && url) result[key] = url;
    }
    return result;
  }

  function donationTone(amount) {
    const value = Math.max(0, Number(amount) || 0);
    if (value >= 1000000) return "brick";
    if (value >= 500000) return "camel";
    if (value >= 100000) return "green";
    if (value >= 10000) return "cyan";
    if (value > 0) return "violet";
    return "neutral";
  }

  function normalizeDonation(type, extras) {
    if (type === 11) {
      return {
        kind: "subscription",
        month: Math.max(0, Number(extras.month) || 0),
        tier: Math.max(0, Number(extras.tierNo) || 0),
        tierName: String(extras.tierName || "").slice(0, 60),
      };
    }
    if (type === 12) {
      const receiver = parseObject(extras.receiver);
      const receiverProfile = parseObject(
        extras.receiverProfile || receiver.profile || receiver.userProfile,
      );
      return {
        kind: "gift",
        tier: Math.max(0, Number(extras.giftTierNo) || 0),
        tierName: String(extras.giftTierName || "").slice(0, 60),
        quantity: Math.max(1, Number(extras.quantity) || 1),
        receiverNickname: String(
          extras.receiverNickname || extras.receiverName || receiver.nickname || receiver.name ||
          receiverProfile.nickname || "",
        ).trim().slice(0, MAX_NICKNAME_LENGTH),
      };
    }
    if (type !== 10) return null;
    const donationType = String(extras.donationType || "CHAT").toUpperCase();
    const mission = donationType.startsWith("MISSION");
    const amount = Math.max(0, Number(extras.payAmount) || 0);
    return {
      kind: mission ? "mission" : donationType === "VIDEO" ? "video" :
        donationType === "PARTY" ? "party" : "donation",
      donationType,
      amount,
      tone: donationTone(amount),
      partyName: String(extras.partyName || "").slice(0, 80),
      missionTitle: String(extras.missionTitle || extras.missionName || extras.title || "").slice(0, 160),
      missionDonationType: String(extras.missionDonationType || "").slice(0, 40),
    };
  }

  function normalizeMessage(message, options = {}) {
    if (!message || typeof message !== "object") return null;
    const extras = parseObject(message.extras);
    const profile = parseObject(message.profile);
    const user = parseObject(message.user);
    const userProfile = parseObject(user.profile);
    const streamingProperties = [
      profile.streamingProperty,
      userProfile.streamingProperty,
      user.streamingProperty,
      message.streamingProperty,
    ].map(parseObject);
    const streamingProperty = streamingProperties.find((property) => Object.keys(property).length) || {};
    const nicknameColorCode = getNicknameColorCode(
      ...streamingProperties.map((property) => property.nicknameColor),
      profile.nicknameColor,
      userProfile.nicknameColor,
      user.nicknameColor,
      message.nicknameColor,
    );
    if (message.privateUserBlock === true || user.privateUserBlock === true ||
        extras.privateUserBlock === true) return null;
    const at = Number(message.playerMessageTime);
    if (!Number.isFinite(at) || at < 0) return null;
    const text = String(message.content ?? message.message ?? "").trim()
      .slice(0, MAX_MESSAGE_TEXT_LENGTH);
    const type = Number(message.messageTypeCode ?? message.msgTypeCode) || 1;
    const donation = normalizeDonation(type, extras);
    if (!text && !donation) return null;
    const anonymous = extras.isAnonymous === true ||
      String(message.uid || message.userIdHash || user.userIdHash || "").toLowerCase() === "anonymous";
    const nickname = String(
      profile.nickname || user.nickname || message.nickname || message.userNickname ||
      message.userName || userProfile.nickname || (anonymous && donation ? "익명의 후원자" : ""),
    ).trim().slice(0, MAX_NICKNAME_LENGTH);
    const rawRole = String(
      message.userRoleCode || message.userRole || user.userRoleCode || user.userRole ||
      userProfile.userRoleCode ||
      profile.userRoleCode || profile.userRole || "",
    ).toLowerCase();
    const roles = [];
    if (rawRole.includes("streamer") || rawRole.includes("broadcaster") || rawRole.includes("owner")) roles.push("streamer");
    else if (rawRole.includes("operator") || rawRole.includes("admin") || rawRole.includes("staff")) roles.push("operator");
    else if (rawRole.includes("manager")) roles.push("manager");
    if (profile.verifiedMark === true || user.verifiedMark === true ||
        userProfile.verifiedMark === true ||
        message.verifiedMark === true) roles.push("partner");
    const titleColor = roles.includes("streamer") || roles.includes("manager") || roles.includes("operator")
      ? [profile.title, userProfile.title, user.title, message.title]
        .map((title) => normalizeColorValue(parseObject(title).color))
        .find(Boolean) || ""
      : "";
    const nicknameFallbackColor = nicknameColorCode.toUpperCase() === "CC000" && !donation &&
      typeof options.getFallbackNicknameColor === "function"
      ? normalizeColorValue(options.getFallbackNicknameColor(nickname || "알 수 없음"))
      : "";
    const nicknameMessageColor = !donation &&
      (roles.includes("streamer") || roles.includes("manager"))
      ? titleColor
      : "";
    const messageTime = Number(message.messageTime);
    const id = String(
      message.messageId || message.messageNo || message.msgId ||
      `${at}|${message.messageTime || ""}|${message.messageTypeCode || ""}|${text}`,
    ).slice(0, 300);
    return {
      id,
      at: at / 1000,
      nickname: nickname || "알 수 없음",
      text,
      type,
      roles,
      badges: collectBadges({ profile, user, userProfile, message, extras, streamingProperty,
        role: roles.find((role) => role !== "partner") || "" }),
      nicknameColorCode,
      nicknameColor: resolveNicknameColor(nicknameColorCode),
      nicknameTitleColor: titleColor,
      nicknameFallbackColor,
      nicknameMessageColor,
      emojis: normalizeEmojis(extras),
      donation,
      broadcastAt: Number.isFinite(messageTime) && messageTime > 0
        ? (messageTime < 1e12 ? messageTime * 1000 : messageTime)
        : 0,
    };
  }

  function createSession({ fetchImpl, onChange } = {}) {
    const request = typeof fetchImpl === "function"
      ? fetchImpl
      : globalThis.fetch.bind(globalThis);
    let videoNo = "";
    let generation = 0;
    let cursor = 0;
    let loadedThrough = 0;
    let currentTime = 0;
    let lastPlaybackTime = null;
    let pendingSeek = false;
    let active = false;
    let fetching = false;
    let noMore = false;
    let status = "idle";
    let error = "";
    let controller = null;
    let lastRequestAt = 0;
    let messages = [];
    const seen = new Set();
    const fallbackNicknameColorStates = new Map();
    let activeFallbackNicknameColorState = { colors: new Map(), nextIndex: 0 };

    function activateFallbackNicknameColors(nextVideoNo) {
      const id = String(nextVideoNo || "");
      let colorState = fallbackNicknameColorStates.get(id);
      if (!colorState) colorState = { colors: new Map(), nextIndex: 0 };
      fallbackNicknameColorStates.delete(id);
      fallbackNicknameColorStates.set(id, colorState);
      while (fallbackNicknameColorStates.size > MAX_FALLBACK_COLOR_VIDEOS) {
        const oldestVideoNo = fallbackNicknameColorStates.keys().next().value;
        fallbackNicknameColorStates.delete(oldestVideoNo);
      }
      activeFallbackNicknameColorState = colorState;
    }

    function getFallbackNicknameColor(nickname) {
      const key = String(nickname || "").trim() || "알 수 없음";
      const { colors } = activeFallbackNicknameColorState;
      if (colors.has(key) || !DEFAULT_NICKNAME_COLORS.length)
        return colors.get(key) || "";
      const color = DEFAULT_NICKNAME_COLORS[
        activeFallbackNicknameColorState.nextIndex % DEFAULT_NICKNAME_COLORS.length
      ];
      activeFallbackNicknameColorState.nextIndex += 1;
      colors.set(key, color);
      return color;
    }

    function emit() {
      try {
        onChange?.(snapshot());
      } catch {}
    }

    function snapshot() {
      return {
        videoNo,
        generation,
        status,
        error,
        currentTime,
        loadedThrough: loadedThrough / 1000,
        fetching,
        count: messages.length,
      };
    }

    function broadcastTimeAt(seconds = currentTime) {
      const target = Number(seconds);
      if (!Number.isFinite(target) || !messages.length) return 0;
      let nearest = null;
      let distance = Infinity;
      for (const item of messages) {
        if (!item.broadcastAt) continue;
        const nextDistance = Math.abs(item.at - target);
        if (nextDistance < distance) {
          nearest = item;
          distance = nextDistance;
        }
      }
      return nearest
        ? Math.round(nearest.broadcastAt + (target - nearest.at) * 1000)
        : 0;
    }

    function hasBroadcastTimes() {
      return messages.some((item) => item.broadcastAt > 0);
    }

    function stop() {
      active = false;
      generation += 1;
      controller?.abort();
      controller = null;
      videoNo = "";
      cursor = 0;
      loadedThrough = 0;
      currentTime = 0;
      lastPlaybackTime = null;
      pendingSeek = false;
      fetching = false;
      noMore = false;
      status = "idle";
      error = "";
      messages = [];
      seen.clear();
      emit();
    }

    function beginAt(seconds) {
      controller?.abort();
      controller = typeof AbortController === "function" ? new AbortController() : null;
      generation += 1;
      cursor = Math.max(0, Math.floor((seconds * 1000) - SEEK_HISTORY_MS));
      loadedThrough = cursor;
      currentTime = seconds;
      lastPlaybackTime = seconds;
      pendingSeek = false;
      fetching = false;
      noMore = false;
      status = "loading";
      error = "";
      messages = [];
      seen.clear();
      emit();
      void pump();
    }

    function start(nextVideoNo, seconds = 0) {
      const id = String(nextVideoNo || "");
      const at = Number(seconds);
      if (!/^\d+$/.test(id) || !Number.isFinite(at) || at < 0) return false;
      activateFallbackNicknameColors(id);
      active = true;
      videoNo = id;
      beginAt(at);
      return true;
    }

    function updatePlayback(seconds, options = {}) {
      const at = Number(seconds);
      if (!active || !Number.isFinite(at) || at < 0) return;
      currentTime = at;
      if (options.seeking === true) {
        pendingSeek = true;
        lastPlaybackTime = at;
        emit();
        return;
      }
      const delta = lastPlaybackTime === null ? 0 : at - lastPlaybackTime;
      if (pendingSeek || delta < -1.5 || delta > 30) {
        beginAt(at);
        return;
      }
      pendingSeek = false;
      lastPlaybackTime = at;
      trimBuffer();
      emit();
      void pump();
    }

    function trimBuffer() {
      if (messages.length <= MAX_BUFFER_MESSAGES) return;
      messages = messages.slice(-MAX_BUFFER_MESSAGES);
      seen.clear();
      for (const item of messages) seen.add(item.id);
    }

    async function waitBeforeNextRequest(signal) {
      const wait = Math.max(0, 200 - (Date.now() - lastRequestAt));
      if (!wait || !signal) return;
      await new Promise((resolve, reject) => {
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        const timer = setTimeout(() => {
          cleanup();
          resolve();
        }, wait);
        const onAbort = () => {
          clearTimeout(timer);
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }

    async function pump() {
      if (!active || fetching || noMore || status === "error") return;
      fetching = true;
      const requestGeneration = generation;
      if (!controller) controller = typeof AbortController === "function" ? new AbortController() : null;
      const signal = controller?.signal;
      emit();
      try {
        for (let page = 0; page < MAX_PAGES_PER_PUMP; page += 1) {
          if (!active || requestGeneration !== generation) return;
          if (loadedThrough > (currentTime * 1000) + LOOKAHEAD_MS) break;
          await waitBeforeNextRequest(signal);
          const pageCursor = cursor;
          const url = new URL(
            `https://api.chzzk.naver.com/service/v1/videos/${videoNo}/chats`,
          );
          url.searchParams.set("playerMessageTime", String(pageCursor));
          url.searchParams.set("previousVideoChatSize", String(PAGE_SIZE));
          lastRequestAt = Date.now();
          const response = await request(url.toString(), {
            credentials: "include",
            headers: { accept: "application/json" },
            ...(signal ? { signal } : {}),
          });
          if (!active || requestGeneration !== generation) return;
          if (response.status === 400) {
            noMore = true;
            status = messages.length ? "ready" : "empty";
            emit();
            return;
          }
          if (!response.ok) {
            const reason = response.status === 401
              ? "로그인 후 다시보기 채팅을 불러올 수 있습니다."
              : response.status === 429
                ? "요청이 많습니다. 잠시 후 다시 시도해 주세요."
                : `채팅을 불러오지 못했습니다. (HTTP ${response.status})`;
            throw Object.assign(new Error(reason), { status: response.status });
          }
          const payload = await response.json();
          if (!active || requestGeneration !== generation) return;
          const content = payload?.content;
          const rows = Array.isArray(content?.videoChats)
            ? content.videoChats
            : Array.isArray(content?.previousVideoChats)
              ? content.previousVideoChats
              : [];
          if (!rows.length) {
            noMore = true;
            status = messages.length ? "ready" : "empty";
            emit();
            return;
          }
          for (const raw of rows) {
            const item = normalizeMessage(raw, {
              getFallbackNicknameColor,
            });
            if (!item || seen.has(item.id)) continue;
            seen.add(item.id);
            messages.push(item);
          }
          messages.sort((a, b) => a.at - b.at);
          const next = Number(content?.nextPlayerMessageTime);
          if (!Number.isFinite(next) || next <= pageCursor) {
            noMore = true;
            loadedThrough = Math.max(
              loadedThrough,
              ...rows.map((item) => Number(item?.playerMessageTime) || 0),
            );
          } else {
            cursor = next;
            loadedThrough = Math.max(loadedThrough, next);
          }
          trimBuffer();
          status = "ready";
          error = "";
          emit();
          if (noMore) return;
        }
      } catch (cause) {
        if (!active || requestGeneration !== generation || cause?.name === "AbortError") return;
        error = cause?.message || "다시보기 채팅을 불러오지 못했습니다.";
        status = "error";
        emit();
      } finally {
        if (requestGeneration === generation) {
          fetching = false;
          emit();
        }
      }
    }

    function visible(seconds = currentTime, limit = 100) {
      const at = Number(seconds);
      if (!Number.isFinite(at)) return [];
      return messages
        .filter((item) => item.at <= at + 0.25)
        .slice(-Math.max(1, Math.floor(limit)));
    }

    function retry() {
      if (!active) return false;
      beginAt(currentTime);
      return true;
    }

    return { start, updatePlayback, visible, snapshot, broadcastTimeAt, hasBroadcastTimes, retry, stop };
  }

  globalThis.CheeseMultiviewVodChat = Object.freeze({
    createSession,
    normalizeMessage,
    formatBroadcastTime,
    setNicknameColorCodes,
    resolveNicknameColor,
    resolveNicknameStyle,
    get nicknameColorCodeRevision() { return nicknameColorCodeRevision; },
  });
})();
