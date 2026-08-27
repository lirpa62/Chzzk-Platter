(() => {
  "use strict";

  if (
    location.hostname !== "game.naver.com" ||
    location.pathname !== "/notify"
  ) {
    return;
  }

  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  const MASTER_ENABLED_KEY = "cheeseMasterEnabled";
  const CACHE_KEY = "cheeseInboxCommunityCache";
  const CACHE_VERSION = 4;
  const READ_KEY = "cheeseInboxCommunityReadMap";
  const OPEN_NEW_TAB_KEY = "cheeseInboxCommunityOpenNewTab";
  const IMAGE_MESSAGE_SOURCE = "cheese-inbox-community-image";
  const STATE_MESSAGE_SOURCE = "cheese-inbox-community-state";
  const TAB_ID = "cheese-inbox-community-tab";
  const SECTION_ID = "cheese-inbox-community-section";
  const DEFAULT_PROFILE_LIGHT =
    "https://ssl.pstatic.net/static/nng/glive/image/default_profile_light.png";
  const DEFAULT_PROFILE_DARK =
    "https://ssl.pstatic.net/static/nng/glive/image/default_profile_dark.png";

  let enabled = false;
  let dotHidden = false;
  let active = false;
  let cache = { items: [], updatedAt: 0, loading: false, error: false };
  let readMap = {};
  let readStateExists = false;
  let observer = null;
  let ensureTimer = 0;
  let lastRenderSignature = "";
  let cacheRevision = 0;
  let openInNewTab = false;
  let lastPostedUnread = null;
  let unreadRetryTimer = 0;
  const expandedIds = new Set();

  const isDark = new URLSearchParams(location.search).get("theme") === "dark";

  function normalizeAttachment(raw) {
    const type = String(raw?.type || "").toUpperCase();
    const url = String(raw?.url || "").trim();
    if ((type !== "PHOTO" && type !== "STICKER") || !url) return null;
    try {
      if (new URL(url).protocol !== "https:") return null;
    } catch {
      return null;
    }
    const width = Number(raw?.width);
    const height = Number(raw?.height);
    return {
      type,
      url,
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0,
    };
  }

  // 카운트는 음수·소수·문자열이 섞여 올 수 있다. 0 초과 정수만 통과시키고 나머지는 0.
  function toCount(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function normalizeItem(raw) {
    const channelId = String(raw?.channelId || "").trim();
    const commentId = String(raw?.commentId || "").trim();
    const createdDate = String(raw?.createdDate || "").trim();
    if (
      !/^[0-9a-f]{32}$/i.test(channelId) ||
      !commentId ||
      !/^\d{14}$/.test(createdDate)
    ) {
      return null;
    }
    const attachments = (Array.isArray(raw?.attachments) ? raw.attachments : [])
      .map(normalizeAttachment)
      .filter(Boolean)
      .slice(0, 10);
    const content = String(raw?.content || raw?.excerpt || "")
      .trim()
      .slice(0, 50000);
    return {
      id: `${channelId}:${commentId}`,
      channelId,
      channelName: String(raw?.channelName || "").trim() || "채널",
      channelImageUrl: String(raw?.channelImageUrl || "").trim(),
      commentId,
      excerpt: String(raw?.excerpt || content)
        .trim()
        .slice(0, 240),
      content,
      createdDate,
      attachments,
      hasAttachment: attachments.length > 0 || raw?.hasAttachment === true,
      verifiedMark: raw?.verifiedMark === true,
      buffCount: toCount(raw?.buffCount),
      childObjectCount: toCount(raw?.childObjectCount),
      link: `https://chzzk.naver.com/${channelId}/community/detail/${encodeURIComponent(commentId)}`,
    };
  }

  function normalizeCache(raw) {
    if (Number(raw?.version) !== CACHE_VERSION) {
      return {
        items: [],
        updatedAt: 0,
        loading: true,
        error: false,
      };
    }
    const seen = new Set();
    const items = (Array.isArray(raw?.items) ? raw.items : [])
      .map(normalizeItem)
      .filter(Boolean)
      .sort((a, b) => b.createdDate.localeCompare(a.createdDate))
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    return {
      items,
      updatedAt: Number(raw?.updatedAt) || 0,
      loading: raw?.loading === true,
      error: raw?.error === true,
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatPostDate(value) {
    const raw = String(value || "");
    if (!/^\d{14}$/.test(raw)) return "";
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const hour = raw.slice(8, 10);
    const minute = raw.slice(10, 12);
    const currentYear = String(new Date().getFullYear());
    return `${year === currentYear ? "" : `${year}.`}${month}.${day} ${hour}:${minute}`;
  }

  // "YYYYMMDDHHmmss" → epoch ms. 그룹 경계 계산에만 쓴다.
  function parseCreatedDate(value) {
    const raw = String(value || "");
    if (!/^\d{14}$/.test(raw)) return 0;
    return +new Date(
      Number(raw.slice(0, 4)),
      Number(raw.slice(4, 6)) - 1,
      Number(raw.slice(6, 8)),
      Number(raw.slice(8, 10)),
      Number(raw.slice(10, 12)),
      Number(raw.slice(12, 14)),
    );
  }

  // 치지직 수신함은 항목을 시간대로 묶고 <strong class="_timestamp_…"> 머리글을 단다.
  // 클래스 해시는 배포마다 바뀌므로 접두사로 실물에서 걷어 온다(실패 시 자체 CSS).
  function harvestTimestampClass() {
    const el = document.querySelector(
      "#root [class*='_timestamp_'], #root strong[class*='timestamp']",
    );
    return el?.className || "";
  }

  // 머리글 글꼴을 수신함 탭과 맞춘다. 폰트는 클래스를 걷어 와도 따라오지 않는
  // 경우가 있어(탭 전용 규칙) 계산된 font-family 를 읽어 변수로 넘긴다.
  function harvestTabFont(section) {
    if (!section) return;
    // 우리가 주입한 탭이 아니라 치지직 원본 탭에서 읽는다(순환 방지).
    const tab = document.querySelector(
      "#root [role='tab']:not(#cheese-inbox-community-tab)",
    );
    if (!tab) return;
    const font = getComputedStyle(tab).fontFamily;
    if (font) section.style.setProperty("--cheese-inbox-tab-font", font);
  }

  const GROUPS = [
    ["오늘", (at, p) => at >= p.today],
    ["최근 일주일", (at, p) => at >= p.week7],
    ["최근 한달", (at, p) => at >= p.month30],
    ["이전 활동", () => true],
  ];

  function groupItems(list) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const p = {
      today: +today,
      week7: +today - 6 * 86400000, // 오늘 포함 7일
      month30: +today - 29 * 86400000, // 오늘 포함 30일
    };
    const out = GROUPS.map(([label]) => ({ label, items: [] }));
    for (const it of list) {
      const at = parseCreatedDate(it.createdDate);
      const idx = GROUPS.findIndex(([, test]) => test(at, p));
      out[idx === -1 ? out.length - 1 : idx].items.push(it);
    }
    return out.filter((g) => g.items.length);
  }

  function formatCheckedAt(value) {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function getLatestByChannel() {
    const latest = new Map();
    cache.items.forEach((item) => {
      if (!latest.has(item.channelId))
        latest.set(item.channelId, item.commentId);
    });
    return latest;
  }

  function hasUnread() {
    if (!readStateExists) return false;
    for (const [channelId, commentId] of getLatestByChannel()) {
      if (readMap[channelId] !== commentId) return true;
    }
    return false;
  }

  async function markCurrentRead() {
    if (!cache.items.length) return;
    const next = {};
    getLatestByChannel().forEach((commentId, channelId) => {
      next[channelId] = commentId;
    });
    readMap = next;
    readStateExists = true;
    syncUnreadDot();
    try {
      await chrome.storage.local.set({ [READ_KEY]: next });
    } catch {}
  }

  function getNativeNodes() {
    const tabList = document.querySelector("#root [role='tablist']");
    if (!tabList) return {};
    const nativeTab = tabList.querySelector("button[role='tab']");
    let nativeSection = tabList.nextElementSibling;
    if (nativeSection?.tagName !== "SECTION") {
      nativeSection = tabList.parentElement?.querySelector(":scope > section");
    }
    return { tabList, nativeTab, nativeSection };
  }

  function postParentUnread(unread, { force = false, retry = true } = {}) {
    if (window.top === window) return;
    const next = unread === true;
    if (!force && lastPostedUnread === next) return;
    lastPostedUnread = next;
    window.top.postMessage(
      {
        source: STATE_MESSAGE_SOURCE,
        type: "unread",
        unread: next,
      },
      "https://chzzk.naver.com",
    );
    if (!retry) return;
    if (unreadRetryTimer) clearTimeout(unreadRetryTimer);
    unreadRetryTimer = window.setTimeout(() => {
      unreadRetryTimer = 0;
      postParentUnread(next, { force: true, retry: false });
    }, 500);
  }

  function syncUnreadDot() {
    const unread = enabled && !dotHidden && hasUnread();
    document.getElementById(TAB_ID)?.classList.toggle("has-new", unread);
    postParentUnread(unread);
  }

  function applyActiveState() {
    const { tabList, nativeSection } = getNativeNodes();
    const customTab = document.getElementById(TAB_ID);
    const customSection = document.getElementById(SECTION_ID);
    if (!tabList || !customTab || !customSection) return;

    document.documentElement.classList.toggle(
      "cheese-inbox-community-active",
      active,
    );
    customTab.setAttribute("aria-selected", String(active));
    tabList.querySelectorAll("button[role='tab']").forEach((tab) => {
      if (tab !== customTab && active)
        tab.setAttribute("aria-selected", "false");
    });
    nativeSection?.classList.toggle(
      "cheese-inbox-community-native-hidden",
      active,
    );
    customSection.classList.toggle("is-active", active);
    customSection.setAttribute("aria-hidden", String(!active));
    if (active && hasUnread()) void markCurrentRead();
  }

  function createAttachmentIcon() {
    return (
      '<svg class="cheese-inbox-community-attachment-icon" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'role="img" aria-label="이미지 또는 스티커 첨부">' +
      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/>' +
      '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
    );
  }

  function createChevronIcon() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
    );
  }

  function createRefreshIcon(loading = false) {
    if (loading) {
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
      );
    }
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.219 6.48L3 16"/>' +
      '<path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.219-6.48L21 8"/><path d="M21 3v5h-5"/></svg>'
    );
  }

  function renderAttachments(item) {
    if (!item.attachments.length) return "";
    return `<div class="cheese-inbox-community-attachments">${item.attachments
      .map((attachment) => {
        const ratio =
          attachment.width && attachment.height
            ? ` style="aspect-ratio:${attachment.width}/${attachment.height}"`
            : "";
        const image = `<img class="${attachment.type === "STICKER" ? "is-sticker" : "is-photo"}" data-src="${escapeHtml(
          attachment.url,
        )}" alt="${attachment.type === "STICKER" ? "스티커" : "첨부 이미지"}" loading="lazy"${ratio}>`;
        if (attachment.type === "STICKER") return image;
        return `<button type="button" class="cheese-inbox-community-photo-button" data-community-photo data-image-url="${escapeHtml(
          attachment.url,
        )}" aria-label="첨부 이미지 확대 보기" title="이미지 확대">${image}</button>`;
      })
      .join("")}</div>`;
  }

  // lucide arrow-big-up / message-circle
  function createBuffIcon() {
    return (
      '<svg class="cheese-inbox-community-stat-icon" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' +
      '<path d="M9 18v-6H5a1 1 0 0 1-.7-1.7l7-7a1 1 0 0 1 1.4 0l7 7A1 1 0 0 1 19 12h-4v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1Z"/></svg>'
    );
  }

  function createCommentIcon() {
    return (
      '<svg class="cheese-inbox-community-stat-icon" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' +
      '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>'
    );
  }

  // 버프 수·댓글 수를 날짜 위에 한 줄로. 0 이면 그 항목은 아예 그리지 않는다
  // (0 만 잔뜩 붙으면 목록이 지저분해진다). 둘 다 0 이면 줄 자체를 생략한다.
  function renderCommunityStats(item) {
    const buff = item.buffCount || 0;
    const replies = item.childObjectCount || 0;
    if (!buff && !replies) return "";
    const parts = [];
    if (buff) {
      parts.push(
        `<span class="cheese-inbox-community-stat">${createBuffIcon()}` +
          `<span class="cheese-inbox-community-a11y">버프 </span>${formatCount(buff)}</span>`,
      );
    }
    if (replies) {
      parts.push(
        `<span class="cheese-inbox-community-stat">${createCommentIcon()}` +
          `<span class="cheese-inbox-community-a11y">댓글 </span>${formatCount(replies)}</span>`,
      );
    }
    return `<span class="cheese-inbox-community-stats">${parts.join("")}</span>`;
  }

  function formatCount(n) {
    return Number(n).toLocaleString("ko-KR");
  }

  function renderCommunityItem(item, fallback) {
    const expanded = expandedIds.has(item.id);
    const target = openInNewTab ? "_blank" : "_top";
    const detailsText = item.content || item.excerpt;
    return `<li class="${expanded ? "is-expanded" : ""}" data-community-id="${escapeHtml(item.id)}">
      <div class="cheese-inbox-community-row">
        <a class="cheese-inbox-community-message-link" href="${escapeHtml(item.link)}" target="${target}" rel="noopener noreferrer">
          <span class="cheese-inbox-community-profile"><img src="${escapeHtml(
            item.channelImageUrl || fallback,
          )}" data-fallback="${escapeHtml(fallback)}" alt="" width="52" height="52"></span>
          <span class="cheese-inbox-community-copy">
            <strong>${escapeHtml(item.channelName)}${
              item.verifiedMark
                ? '<i class="cheese-inbox-community-official-mark" aria-hidden="true"></i><span class="cheese-inbox-community-a11y">인증 마크</span>'
                : ""
            }</strong>
            <span>${escapeHtml(item.excerpt || "새 커뮤니티 소식")}</span>
            ${renderCommunityStats(item)}
            <small>${escapeHtml(formatPostDate(item.createdDate))}${
              item.hasAttachment ? createAttachmentIcon() : ""
            }</small>
          </span>
        </a>
        <button type="button" class="cheese-inbox-community-expand" data-community-expand aria-expanded="${String(
          expanded,
        )}" aria-label="${expanded ? "커뮤니티 글 접기" : "커뮤니티 글 펼치기"}">${createChevronIcon()}</button>
      </div>
      <div class="cheese-inbox-community-details"${expanded ? "" : " hidden"}>
        ${detailsText ? `<p>${escapeHtml(detailsText)}</p>` : ""}
        ${renderAttachments(item)}
        ${
          !detailsText && !item.attachments.length
            ? "<p>상세 내용은 다음 소식 갱신 후 확인할 수 있습니다.</p>"
            : ""
        }
      </div>
    </li>`;
  }

  function loadDetailImages(root) {
    root?.querySelectorAll("img[data-src]").forEach((image) => {
      const source = image.dataset.src;
      if (!source) return;
      image.removeAttribute("data-src");
      image.src = source;
      image.addEventListener(
        "error",
        () => {
          image.hidden = true;
        },
        { once: true },
      );
    });
  }

  function onCommunitySectionClick(event) {
    const refreshButton = event.target.closest("[data-community-refresh]");
    if (refreshButton) {
      event.preventDefault();
      event.stopPropagation();
      if (refreshButton.disabled || window.top === window) return;
      refreshButton.disabled = true;
      refreshButton.classList.add("is-loading");
      refreshButton.setAttribute("aria-label", "커뮤니티 소식 확인 중");
      refreshButton.innerHTML = createRefreshIcon(true);
      window.top.postMessage(
        {
          source: STATE_MESSAGE_SOURCE,
          type: "refresh",
        },
        "https://chzzk.naver.com",
      );
      window.setTimeout(() => {
        if (cache.loading) return;
        lastRenderSignature = "";
        renderSection();
      }, 3000);
      return;
    }

    const button = event.target.closest("[data-community-expand]");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const item = button.closest("[data-community-id]");
      const details = item?.querySelector(".cheese-inbox-community-details");
      if (!item || !details) return;
      const nextExpanded = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(nextExpanded));
      button.setAttribute(
        "aria-label",
        nextExpanded ? "커뮤니티 글 접기" : "커뮤니티 글 펼치기",
      );
      item.classList.toggle("is-expanded", nextExpanded);
      details.hidden = !nextExpanded;
      if (nextExpanded) {
        expandedIds.add(item.dataset.communityId);
        loadDetailImages(details);
      } else {
        expandedIds.delete(item.dataset.communityId);
      }
      return;
    }

    const photoButton = event.target.closest("[data-community-photo]");
    if (!photoButton) return;
    event.preventDefault();
    event.stopPropagation();
    const imageUrl = normalizeAttachment({
      type: "PHOTO",
      url: photoButton.dataset.imageUrl,
    })?.url;
    if (!imageUrl || window.top === window) return;
    window.top.postMessage(
      {
        source: IMAGE_MESSAGE_SOURCE,
        type: "open",
        url: imageUrl,
      },
      "https://chzzk.naver.com",
    );
  }

  function renderSection() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    const signature = `${cacheRevision}:${isDark ? "dark" : "light"}:${openInNewTab ? "new" : "same"}`;
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;

    let body = "";
    if (!cache.items.length && cache.loading) {
      body = `<div class="cheese-inbox-community-skeleton" aria-label="커뮤니티 소식 불러오는 중">${Array.from(
        { length: 5 },
        () => "<span><i></i><b></b><em></em></span>",
      ).join("")}</div>`;
    } else if (!cache.items.length) {
      body = `<div class="cheese-inbox-community-empty"><strong>${
        cache.error
          ? "커뮤니티 소식을 불러오지 못했습니다."
          : "최근 커뮤니티 소식이 없습니다."
      }</strong><span>${
        cache.error
          ? "다음 새 글 확인 주기에 다시 시도합니다."
          : "알림을 켠 팔로잉 채널의 스트리머 글이 여기에 표시됩니다."
      }</span></div>`;
    } else {
      const fallback = isDark ? DEFAULT_PROFILE_DARK : DEFAULT_PROFILE_LIGHT;
      const validIds = new Set(cache.items.map((item) => item.id));
      expandedIds.forEach((id) => {
        if (!validIds.has(id)) expandedIds.delete(id);
      });
      // 치지직 수신함과 같은 시간대 머리글로 묶는다.
      const tsClass = harvestTimestampClass();
      const headClass = tsClass
        ? `${tsClass} cheese-inbox-community-timestamp`
        : "cheese-inbox-community-timestamp";
      // ⚠ 예전에는 <ul> 하나가 스크롤 컨테이너(flex:1 + overflow-y:auto)였다.
      //    그룹마다 <ul> 을 나누면 목록이 제각기 스크롤되므로, 바깥에 스크롤
      //    래퍼를 하나 두고 그 안에서 머리글+목록을 반복한다.
      body =
        `<div class="cheese-inbox-community-scroll">` +
        groupItems(cache.items)
          .map(
            (g) =>
              `<strong class="${escapeHtml(headClass)}">${escapeHtml(g.label)}</strong>` +
              `<ul class="cheese-inbox-community-list">${g.items
                .map((item) => renderCommunityItem(item, fallback))
                .join("")}</ul>`,
          )
          .join("") +
        `</div>`;
    }

    const checkedAt = formatCheckedAt(cache.updatedAt);
    const statusText = cache.loading
      ? "새 소식을 확인하고 있습니다."
      : cache.error && cache.items.length
        ? "일부 소식을 갱신하지 못했습니다."
        : checkedAt
          ? `${checkedAt} 확인`
          : "";
    section.innerHTML = `${body}<div class="cheese-inbox-community-status">
      <span aria-live="polite">${escapeHtml(statusText)}</span>
      <button type="button" data-community-refresh class="${cache.loading ? "is-loading" : ""}" aria-label="${cache.loading ? "커뮤니티 소식 확인 중" : "커뮤니티 소식 새로고침"}" title="${cache.loading ? "확인 중" : "새로고침"}"${cache.loading ? " disabled" : ""}>${createRefreshIcon(cache.loading)}</button>
    </div>`;
    harvestTabFont(section);
    section.querySelectorAll("img[data-fallback]").forEach((image) => {
      image.addEventListener(
        "error",
        () => {
          if (image.src !== image.dataset.fallback) {
            image.src = image.dataset.fallback;
          }
        },
        { once: true },
      );
    });
    section
      .querySelectorAll(".is-expanded .cheese-inbox-community-details")
      .forEach(loadDetailImages);
  }

  function ensureUi() {
    if (!enabled) {
      cleanupUi();
      return;
    }
    const { tabList, nativeTab, nativeSection } = getNativeNodes();
    if (!tabList || !nativeTab || !nativeSection) return;

    let tab = document.getElementById(TAB_ID);
    if (!tab || !tabList.contains(tab)) {
      const item = document.createElement("li");
      item.className = nativeTab.parentElement?.className || "";
      item.setAttribute("role", "presentation");
      tab = document.createElement("button");
      tab.id = TAB_ID;
      tab.type = "button";
      tab.className = nativeTab.className;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.textContent = "커뮤니티 소식";
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        active = true;
        applyActiveState();
      });
      item.appendChild(tab);
      tabList.appendChild(item);
    }

    let section = document.getElementById(SECTION_ID);
    if (!section || section.parentElement !== nativeSection.parentElement) {
      section?.remove();
      section = document.createElement("section");
      section.id = SECTION_ID;
      section.className =
        `${nativeSection.className} cheese-inbox-community-section${
          isDark ? " is-dark" : ""
        }`.trim();
      section.setAttribute("role", "tabpanel");
      section.setAttribute("aria-labelledby", TAB_ID);
      section.setAttribute("aria-hidden", "true");
      section.addEventListener("click", onCommunitySectionClick);
      nativeSection.insertAdjacentElement("afterend", section);
      lastRenderSignature = "";
    }
    renderSection();
    applyActiveState();
    syncUnreadDot();
  }

  function cleanupUi() {
    active = false;
    document.documentElement.classList.remove("cheese-inbox-community-active");
    document.getElementById(TAB_ID)?.parentElement?.remove();
    document.getElementById(SECTION_ID)?.remove();
    expandedIds.clear();
    document
      .querySelectorAll(".cheese-inbox-community-native-hidden")
      .forEach((node) =>
        node.classList.remove("cheese-inbox-community-native-hidden"),
      );
    lastRenderSignature = "";
    postParentUnread(false);
  }

  function scheduleEnsure() {
    if (ensureTimer) return;
    ensureTimer = window.setTimeout(() => {
      ensureTimer = 0;
      ensureUi();
    }, 80);
  }

  function onNativeTabClick(event) {
    const tab = event.target.closest("button[role='tab']");
    if (!tab || tab.id === TAB_ID || !tab.closest("[role='tablist']")) return;
    active = false;
    applyActiveState();
  }

  async function loadState() {
    try {
      const data = await chrome.storage.local.get([
        MASTER_ENABLED_KEY,
        FEATURE_HIDDEN_KEY,
        CACHE_KEY,
        READ_KEY,
        OPEN_NEW_TAB_KEY,
      ]);
      const hidden = data?.[FEATURE_HIDDEN_KEY];
      enabled =
        data?.[MASTER_ENABLED_KEY] !== false &&
        hidden?.inboxCommunityNews === false;
      dotHidden = hidden?.inboxCommunityNewsDot === true;
      cache = normalizeCache(data?.[CACHE_KEY]);
      cacheRevision += 1;
      openInNewTab = data?.[OPEN_NEW_TAB_KEY] === true;
      const storedRead = data?.[READ_KEY];
      readStateExists = storedRead != null && typeof storedRead === "object";
      readMap = readStateExists ? { ...storedRead } : {};
      if (enabled && !readStateExists && cache.items.length) {
        await markCurrentRead();
      }
    } catch {
      enabled = false;
      dotHidden = false;
    }
    ensureUi();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[MASTER_ENABLED_KEY] || changes[FEATURE_HIDDEN_KEY]) {
      void loadState();
      return;
    }
    if (changes[CACHE_KEY]) {
      cache = normalizeCache(changes[CACHE_KEY].newValue);
      cacheRevision += 1;
      if (!readStateExists && cache.items.length) {
        void markCurrentRead();
      } else if (active && hasUnread()) {
        void markCurrentRead();
      }
      renderSection();
      syncUnreadDot();
    }
    if (changes[READ_KEY]) {
      const next = changes[READ_KEY].newValue;
      readStateExists = next != null && typeof next === "object";
      readMap = readStateExists ? { ...next } : {};
      syncUnreadDot();
    }
    if (changes[OPEN_NEW_TAB_KEY]) {
      openInNewTab = changes[OPEN_NEW_TAB_KEY].newValue === true;
      lastRenderSignature = "";
      renderSection();
    }
  });

  document.addEventListener("click", onNativeTabClick, true);
  observer = new MutationObserver(scheduleEnsure);
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true });
    void loadState();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
