// 치즈 플래터 - 멀티뷰 채널 목록 공용 로더
//
// 고르기 화면(multiview.js)과 시청 화면의 Quick 패널(multiviewWatch.js)이 같은
// 목록을 쓴다. API 주소와 응답 해석을 두 곳에 두면 한쪽만 고쳐져 어긋나므로 여기에
// 모은다.
//
// ⚠ 치지직 API 는 확장 페이지에서 직접 부르면 Origin 때문에 막힌다. 반드시 배경
//   스크립트 중계(MULTIVIEW_API)를 거친다. 허용 경로는 배경이 정하며 여기서
//   넓히지 않는다.
(() => {
  "use strict";

  const API = "https://api.chzzk.naver.com";
  const HASH_RE = /^[0-9a-f]{32}$/i;
  const LIVE_PAGE_SIZE = 40;
  const LIVE_CURSOR_KEYS = Object.freeze(["concurrentUserCount", "liveId"]);
  const LIVE_CACHE_TTL_MS = 20000;
  // 검색 결과 중 방송 정보를 확인할 최대 채널 수(채널마다 요청이 하나씩 생긴다).
  const SEARCH_DETAIL_MAX = 12;
  const SEARCH_PAGE_SIZE = 30;
  const VIDEO_PAGE_SIZE = 50;
  const VIDEO_CURSOR_MAX = 10000000000000000000n;
  const VIDEO_CURSOR_FIELDS = Object.freeze([
    "nextNo",
    "videoNo",
    "readCount",
    "livePv",
    "publishDateAt",
    "offset",
  ]);
  // 다시보기 검색(멀티뷰·재생목록): 치지직 검색 화면과 같은 v2 API 로 정렬·길이 필터를 서버가 한다(2026-10-29 실측).
  //   GET /service/v2/search/videos?keyword&offset&size(≤50)&sort&playTime → data[].{video, channel}, page.next.offset
  //   예전에는 v1 으로 최대 200개를 받아 브라우저에서 다시 정렬했다(통합검색 재정렬과 설정 공유) — 1.64.0 에서 걷어냈다.
  // 고른 정렬·길이는 화면 상태로 기억한다(설정 백업에는 넣지 않는다).
  const VIDEO_SEARCH_OPTIONS_KEY = "cheeseVideoSearchOptions";
  const VIDEO_SEARCH_SORTS = Object.freeze([
    { value: "RELEVANCE_DESC", label: "관련순" },
    { value: "DATE_DESC", label: "최신순" },
    { value: "PLAY_COUNT_DESC", label: "재생수순" },
  ]);
  const VIDEO_SEARCH_PLAY_TIMES = Object.freeze([
    { value: "ALL", label: "전체 길이" },
    { value: "UNDER_3_MINUTES", label: "3분 미만" },
    { value: "MINUTES_3_TO_20", label: "3~20분" },
    { value: "MINUTES_20_TO_60", label: "20~60분" },
    { value: "HOURS_1_TO_3", label: "1~3시간" },
    { value: "OVER_3_HOURS", label: "3시간 이상" },
  ]);
  // 기간: 치지직 검색과 같은 프리셋 + 직접 선택(달력, src/searchDateRange.js). API 는 startDate·endDate(KST).
  const VIDEO_SEARCH_PERIODS = Object.freeze([
    { value: "ALL", label: "전체 기간" },
    { value: "DAY", label: "1일" },
    { value: "WEEK", label: "1주" },
    { value: "MONTH", label: "1개월" },
    { value: "HALF_YEAR", label: "6개월" },
    { value: "CUSTOM", label: "직접 선택" },
  ]);
  const VIDEO_SEARCH_DEFAULTS = Object.freeze({ sort: "RELEVANCE_DESC", playTime: "ALL", period: "ALL" });
  const isDayKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  function normalizeVideoSearchOptions(value = {}) {
    const options = {
      sort: VIDEO_SEARCH_SORTS.some((option) => option.value === value?.sort) ? value.sort : VIDEO_SEARCH_DEFAULTS.sort,
      playTime: VIDEO_SEARCH_PLAY_TIMES.some((option) => option.value === value?.playTime) ? value.playTime : VIDEO_SEARCH_DEFAULTS.playTime,
      period: VIDEO_SEARCH_PERIODS.some((option) => option.value === value?.period) ? value.period : VIDEO_SEARCH_DEFAULTS.period,
    };
    // 직접 선택은 시작·끝 날짜가 있어야 한다(없으면 전체 기간)
    if (options.period === "CUSTOM") {
      if (isDayKey(value?.start) && isDayKey(value?.end) && value.start <= value.end) {
        options.start = value.start;
        options.end = value.end;
      } else {
        options.period = "ALL";
      }
    }
    return options;
  }

  async function loadVideoSearchSettings() {
    try {
      const saved = await chrome.storage.local.get(VIDEO_SEARCH_OPTIONS_KEY);
      return normalizeVideoSearchOptions(saved?.[VIDEO_SEARCH_OPTIONS_KEY]);
    } catch {
      return { ...VIDEO_SEARCH_DEFAULTS };
    }
  }

  async function saveVideoSearchSettings(patch = {}) {
    const next = normalizeVideoSearchOptions({ ...await loadVideoSearchSettings(), ...patch });
    try {
      await chrome.storage.local.set({ [VIDEO_SEARCH_OPTIONS_KEY]: next });
    } catch {}
    return next;
  }

  // 정렬·길이 고르기(치지직 검색 화면과 같은 값). 고르면 처음부터 다시 받는다.
  function videoSearchControlsMarkup(scope) {
    const prefix = scope === "quick" ? "quick" : "setup";
    const picker = (kind, label, options) =>
      `<div class="cheese-search-sort-picker" data-video-search-picker="${kind}">` +
      `<button type="button" class="cheese-search-control cheese-search-sort-trigger" data-video-search-trigger="${kind}" aria-haspopup="listbox" aria-expanded="false" aria-label="${label}"><span data-video-search-label="${kind}">${options[0].label}</span></button>` +
      `<div class="cheese-search-sort-menu" role="listbox" aria-label="${label}" hidden>` +
      options.map((option) => `<button type="button" role="option" aria-selected="false" data-video-search-${kind}="${option.value}">${option.label}</button>`).join("") +
      `</div></div>`;
    return `<div class="mv-video-rerank-controls" data-mv-video-rerank-controls="${prefix}">` +
      picker("sort", "검색 결과 정렬", VIDEO_SEARCH_SORTS) +
      picker("time", "영상 길이", VIDEO_SEARCH_PLAY_TIMES) +
      picker("period", "기간", VIDEO_SEARCH_PERIODS) +
      `</div>`;
  }

  const VIDEO_VAULT_KEY = "cheeseVideoVault:";
  const FOLLOWING_SORT_TYPES = Object.freeze({
    viewers: "POPULAR",
    "viewers-asc": "UNPOPULAR",
    recent: "LATEST",
    oldest: "OLDEST",
    recommended: "RECOMMEND",
  });
  const LIVE_SORT_TYPES = Object.freeze({
    viewers: "POPULAR",
    "viewers-asc": "UNPOPULAR",
    recent: "LATEST",
    recommended: "RECOMMEND",
  });
  const SORT_OPTIONS = Object.freeze([
    { id: "viewers", label: "시청자순" },
    { id: "viewers-asc", label: "시청자역순" },
    { id: "name-asc", label: "채널명 오름차순" },
    { id: "name-desc", label: "채널명 내림차순" },
    { id: "recent", label: "최신순" },
    { id: "oldest", label: "오래된순" },
    { id: "recommended", label: "추천순" },
    { id: "custom", label: "커스텀 순서" },
  ]);

  async function getJson(url) {
    const reply = await chrome.runtime.sendMessage({
      type: "MULTIVIEW_API",
      url,
    });
    if (!reply?.ok) throw new Error(reply?.reason || "요청 실패");
    return reply.content ?? null;
  }

  const isLoginRequiredError = (error) => error?.message === "HTTP 401";

  const isAdult = (value) =>
    value === true || String(value).toLowerCase() === "true";

  function serverSortType(source, mode) {
    if (source === "custom") {
      return mode === "recent" || mode === "oldest"
        ? FOLLOWING_SORT_TYPES[mode]
        : "POPULAR";
    }
    const types =
      source === "following"
        ? FOLLOWING_SORT_TYPES
        : source === "all" || source === "live"
          ? LIVE_SORT_TYPES
          : null;
    return types?.[mode] || (types ? "POPULAR" : null);
  }

  function liveOpenedAt(value) {
    if (typeof value !== "string" || !value.trim()) return 0;
    const parsed = Date.parse(value.trim().replace(" ", "T"));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCompactCount(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 10000) {
      const compact = Math.floor(number / 1000) / 10;
      return `${compact.toLocaleString("ko-KR")}만`;
    }
    return Math.floor(number).toLocaleString("ko-KR");
  }

  function formatVideoDuration(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function formatRelativeTime(value, now = Date.now()) {
    let timestamp = Number(value) || 0;
    if (timestamp > 0 && timestamp < 1000000000000) timestamp *= 1000;
    if (!timestamp) return "";
    const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (seconds < 60) return "방금 전";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
    if (seconds < 30 * 86400) return `${Math.floor(seconds / 86400)}일 전`;
    if (seconds < 365 * 86400) return `${Math.floor(seconds / (30 * 86400))}개월 전`;
    return `${Math.floor(seconds / (365 * 86400))}년 전`;
  }

  function formatVideoDate(value, now = Date.now()) {
    let timestamp = Number(value) || 0;
    if (timestamp > 0 && timestamp < 1000000000000) timestamp *= 1000;
    if (!timestamp) return "";
    if (Math.max(0, now - timestamp) < 86400000) {
      return formatRelativeTime(timestamp, now);
    }
    const date = new Date(timestamp);
    return `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  }

  function getWatchTimelinePercent(video) {
    if (video?.watchTimeline == null) return null;
    const durationSeconds = Number(video?.duration || 0);
    if (!durationSeconds) return null;
    const watchedSeconds = normalizeWatchTimelineSeconds(
      video.watchTimeline,
      durationSeconds,
    );
    return watchedSeconds === null ? null : (watchedSeconds / durationSeconds) * 100;
  }

  function normalizeWatchTimelineSeconds(value, durationSeconds) {
    if (typeof value === "number") return normalizeWatchTimelineNumber(value, durationSeconds);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d+(?::\d+){1,2}$/.test(trimmed)) {
        return trimmed.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
      }
      const numeric = Number(trimmed);
      return Number.isFinite(numeric)
        ? normalizeWatchTimelineNumber(numeric, durationSeconds)
        : null;
    }
    if (value && typeof value === "object") {
      for (const key of [
        "watchTime", "watchTimeSec", "watchTimeline", "lastWatchTime",
        "currentTime", "currentTimestamp", "playTime", "position", "seconds", "time",
      ]) {
        if (value[key] == null) continue;
        const normalized = normalizeWatchTimelineSeconds(value[key], durationSeconds);
        if (normalized !== null) return normalized;
      }
    }
    return null;
  }

  function normalizeWatchTimelineNumber(value, durationSeconds) {
    if (!Number.isFinite(value) || value < 0) return null;
    if (value <= 1) return value * durationSeconds;
    if (value > durationSeconds && value / 1000 <= durationSeconds * 1.1) {
      return value / 1000;
    }
    return value;
  }

  function sortRows(rows, mode = "viewers", preserveServerOrder = false) {
    if (!Array.isArray(rows)) return [];
    if (mode === "custom") return [...rows];
    const matchingServerSort =
      preserveServerOrder &&
      rows.length > 0 &&
      rows.every((row) => {
        const types =
          row.serverSource === "following"
            ? FOLLOWING_SORT_TYPES
            : row.serverSource === "all"
              ? LIVE_SORT_TYPES
              : null;
        return types?.[mode] && row.serverSortType === types[mode];
      });
    if (matchingServerSort) {
      return rows[0].serverSource === "following"
        ? [...rows].sort((a, b) => a.recommendationRank - b.recommendationRank)
        : [...rows];
    }
    const byName = (a, b) =>
      String(a.channelName || "").localeCompare(
        String(b.channelName || ""),
        "ko",
        { numeric: true },
      );
    return [...rows].sort((a, b) => {
      if (mode === "name-asc") return byName(a, b);
      if (mode === "name-desc") return byName(b, a);
      if (mode === "recent" || mode === "oldest") {
        const left = Number(a.openedAt) || 0;
        const right = Number(b.openedAt) || 0;
        if (!left || !right) return (right > 0) - (left > 0);
        return (
          (mode === "recent" ? right - left : left - right) || byName(a, b)
        );
      }
      if (mode === "recommended") {
        const left = Number.isFinite(a.recommendationRank)
          ? a.recommendationRank
          : Infinity;
        const right = Number.isFinite(b.recommendationRank)
          ? b.recommendationRank
          : Infinity;
        return left - right;
      }
      if (mode === "viewers-asc") {
        return (
          (Number(a.viewers) || 0) - (Number(b.viewers) || 0) || byName(a, b)
        );
      }
      return (
        (Number(b.viewers) || 0) - (Number(a.viewers) || 0) || byName(a, b)
      );
    });
  }

  function sortSections(sections, mode, preserveServerOrder = false) {
    return sections.map((section) => ({
      ...section,
      rows: sortRows(section.rows, mode, preserveServerOrder),
    }));
  }

  function hasCustomOrder(sections, folder = "") {
    return sections.some(
      (section) => (!folder || section.id === folder) && section.customOrder,
    );
  }

  // 채널 이미지가 없을 때 치지직이 쓰는 기본 프로필(다시보기 검색 팝업과 같은 주소).
  const DEFAULT_PROFILE_URLS = Object.freeze({
    light: "https://ssl.pstatic.net/static/nng/glive/image/default_profile_light.png",
    dark: "https://ssl.pstatic.net/static/nng/glive/image/default_profile_dark.png",
  });

  function defaultProfileUrl(theme) {
    return theme === "dark" ? DEFAULT_PROFILE_URLS.dark : DEFAULT_PROFILE_URLS.light;
  }

  // 채널 프로필 <img>. 이미지가 없으면 지금 테마의 기본 프로필을 넣고 표시해 둔다
  // (테마를 바꾸면 multiviewTheme 이 표시된 것만 바꿔 끼운다. 목록을 다시 그리지 않는다).
  function profileImg(imageUrl, attrs = "", size = 60) {
    const thumb = profileThumb(imageUrl, size);
    const theme = globalThis.document?.documentElement?.dataset?.theme;
    const src = thumb || defaultProfileUrl(theme);
    const safe = src.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return `<img${attrs ? ` ${attrs}` : ""} src="${safe}"` +
      `${thumb ? "" : " data-mv-default-profile"} alt="" loading="lazy" decoding="async">`;
  }

  function profileThumb(imageUrl, size = 60) {
    const raw = String(imageUrl || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      url.searchParams.set("type", size === 240 ? "f240_240_na" : "f60_60_na");
      return url.toString();
    } catch {
      return "";
    }
  }

  // 응답 모양이 제각각이라 한 곳에서 같은 형태로 맞춘다.
  const normalize = (channel, live, entry = null) => ({
    channelId: String(channel?.channelId || "").toLowerCase(),
    channelName: String(channel?.channelName || "").trim(),
    channelImageUrl: String(channel?.channelImageUrl || ""),
    ...CheeseVerifiedMark.fields(channel, entry),
    liveTitle: String(live?.liveTitle || "").trim(),
    category: String(live?.liveCategoryValue || "").trim(),
    // 카테고리 칩을 누르면 그 카테고리 라이브를 부른다(categories/{type}/{id}/lives).
    categoryType: String(live?.categoryType || "").trim(),
    categoryId: String(live?.liveCategory || "").trim(),
    viewers: Number(live?.concurrentUserCount) || 0,
    openedAt: liveOpenedAt(live?.openDate),
    adult:
      isAdult(live?.adult) || isAdult(entry?.adult) || isAdult(channel?.adult),
    // 라이브 스냅샷. {type} 자리에 해상도를 넣어야 실제 이미지가 나온다.
    // ⚠ liveImageUrl 이 비어 있는 응답이 있다(팔로잉 목록의 liveInfo 등).
    //   기존 통합검색 코드와 같은 순서로 defaultThumbnailImageUrl 을 대신 쓴다.
    liveImageUrl: String(
      live?.liveImageUrl || live?.defaultThumbnailImageUrl || "",
    ).replace("{type}", "480"),
    // 자동 태그 그룹에 쓴다. 응답마다 키 이름이 달라 사이드바와 같은 순서로 본다.
    tags: (Array.isArray(live?.tags)
      ? live.tags
      : Array.isArray(live?.liveTagList)
        ? live.liveTagList
        : Array.isArray(live?.tagList)
          ? live.tagList
          : []
    )
      .map((t) => String(t || "").trim())
      .filter(Boolean),
  });

  function responseRows(content) {
    const candidates = [
      content?.data,
      content?.videoList,
      content?.followingList,
      content?.followingVideoList,
      content?.list,
    ];
    for (const value of candidates) {
      if (Array.isArray(value)) return value;
      if (Array.isArray(value?.data)) return value.data;
      if (Array.isArray(value?.videoList)) return value.videoList;
    }
    return [];
  }

  function normalizeVideo(entry, fallbackChannel = null) {
    const video = entry?.video || entry?.videoInfo || entry?.vod || entry || {};
    const channel = {
      ...(fallbackChannel || {}),
      ...(entry?.channel || entry?.channelInfo || entry?.owner || {}),
    };
    const videoNo = String(video?.videoNo || video?.videoId || entry?.videoNo || "");
    const ownerChannelId = String(
      channel?.channelId || entry?.channelId || video?.channelId || "",
    ).toLowerCase();
    if (!/^\d+$/.test(videoNo)) return null;
    const thumbnail = String(
      video?.thumbnailImageUrl || video?.thumbnailUrl || video?.thumbnail ||
      video?.defaultThumbnailImageUrl || video?.liveImageUrl || "",
    ).replace("{type}", "480");
    const tags = Array.isArray(video?.tags)
      ? video.tags
      : Array.isArray(video?.tagList)
        ? video.tagList
        : Array.isArray(entry?.tags)
          ? entry.tags
          : [];
    return {
      channelId: `video:${videoNo}`,
      mediaType: "video",
      videoNo,
      ownerChannelId: HASH_RE.test(ownerChannelId) ? ownerChannelId : "",
      channelName: String(channel?.channelName || entry?.channelName || "").trim(),
      channelImageUrl: String(channel?.channelImageUrl || entry?.channelImageUrl || ""),
      ...CheeseVerifiedMark.fields(channel, entry),
      liveTitle: String(video?.videoTitle || video?.title || entry?.videoTitle || "").trim(),
      liveImageUrl: thumbnail,
      category: String(video?.videoCategoryValue || video?.categoryName || video?.category || "").trim(),
      categoryType: String(video?.categoryType || "").trim(),
      categoryId: String(video?.videoCategory || "").trim(),
      tags: tags.map((tag) => String(tag?.name || tag || "").trim()).filter(Boolean),
      viewers: Number(video?.readCount ?? video?.viewCount ?? entry?.readCount) || 0,
      livePv: Number(video?.livePv ?? entry?.livePv) || 0,
      openedAt: Number(video?.publishDateAt || entry?.publishDateAt) ||
        liveOpenedAt(video?.publishDateAt || video?.createdDate || entry?.publishDateAt),
      adult: isAdult(video?.adult) || isAdult(video?.adultFlag) || isAdult(entry?.adult),
      duration: Number(video?.duration) || 0,
      watchTimeline: video?.watchTimeline ?? entry?.watchTimeline ?? null,
      videoType: String(video?.videoType || entry?.videoType || "REPLAY").toUpperCase(),
    };
  }

  function normalizeVideoCursor(value) {
    if (value == null || value === "") return "";
    const raw = String(value);
    if (!/^\d{1,20}$/.test(raw)) return "";
    try {
      return BigInt(raw) <= VIDEO_CURSOR_MAX ? raw : "";
    } catch {
      return "";
    }
  }

  function normalizeAllVideoCursor(value) {
    if (value == null || value === "") return "";
    if (typeof value === "string" || typeof value === "number")
      return normalizeVideoCursor(value);
    if (typeof value !== "object" || Array.isArray(value)) return "";
    if (Object.keys(value).some((key) => !VIDEO_CURSOR_FIELDS.includes(key))) return "";
    const cursor = {};
    for (const key of VIDEO_CURSOR_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const raw = value[key];
      if ((typeof raw !== "string" && typeof raw !== "number") || !/^\d{1,20}$/.test(String(raw)))
        return "";
      if (key === "offset" && Number(raw) > 10000) return "";
      const normalized = normalizeVideoCursor(raw);
      if (!normalized) return "";
      cursor[key] = normalized;
    }
    if (!Object.keys(cursor).length) return "";
    return JSON.stringify(cursor);
  }

  function nextVideoCursor(content) {
    const candidates = [
      content?.page?.next,
      content?.page?.nextNo,
      content?.nextNo,
      content?.data?.page?.next,
      content?.data?.page?.nextNo,
      content?.data?.nextNo,
    ];
    for (const candidate of candidates) {
      const cursor = normalizeAllVideoCursor(candidate);
      if (cursor) return cursor;
    }
    return "";
  }

  function normalizeVideoPage(content, fallbackChannel = null) {
    const rows = responseRows(content)
      .map((entry) => normalizeVideo(entry, fallbackChannel))
      .filter(Boolean);
    return { rows, next: nextVideoCursor(content) || null };
  }

  function nextFollowingVideoCursor(content) {
    const candidates = [
      content?.page?.next?.nextNo,
      content?.page?.next,
      content?.page?.nextNo,
      content?.nextNo,
      content?.data?.page?.next?.nextNo,
      content?.data?.page?.nextNo,
      content?.data?.nextNo,
    ];
    for (const candidate of candidates) {
      const cursor = normalizeVideoCursor(candidate);
      if (cursor) return cursor;
    }
    return "";
  }

  async function loadFollowingVideosPage(nextNo = "") {
    const cursor = normalizeVideoCursor(nextNo);
    const url = new URL(`${API}/service/v2/home/following/videos`);
    url.searchParams.set("size", String(VIDEO_PAGE_SIZE));
    url.searchParams.set("nextNo", cursor);
    const content = await getJson(url.toString());
    const page = normalizeVideoPage(content);
    return { ...page, next: nextFollowingVideoCursor(content) || null };
  }

  async function loadAllVideosPage(sortType = "POPULAR", cursorValue = "") {
    if (!["POPULAR", "LATEST"].includes(sortType)) throw new Error("invalid-sort");
    const url = new URL(`${API}/service/v1/home/videos`);
    url.searchParams.set("size", String(VIDEO_PAGE_SIZE));
    url.searchParams.set("sortType", sortType);
    let cursor = String(cursorValue || "");
    if (cursor.startsWith("{")) {
      try {
        cursor = normalizeAllVideoCursor(JSON.parse(cursor));
      } catch {
        cursor = "";
      }
    } else {
      cursor = normalizeVideoCursor(cursor);
    }
    if (cursor.startsWith("{")) {
      const parsed = JSON.parse(cursor);
      for (const key of VIDEO_CURSOR_FIELDS) {
        if (parsed[key] !== undefined) url.searchParams.set(key, parsed[key]);
      }
    } else if (cursor) {
      url.searchParams.set("nextNo", cursor);
    }
    return normalizeVideoPage(await getJson(url.toString()));
  }

  async function loadChannelVideosPage(channel, page = 0) {
    const fallback = typeof channel === "object" && channel ? channel : { channelId: channel };
    const id = String(fallback.channelId || "").toLowerCase();
    const pageNumber = Number(page);
    if (!HASH_RE.test(id) || !Number.isSafeInteger(pageNumber) || pageNumber < 0 || pageNumber > 10000)
      throw new Error("invalid-channel");
    const url = new URL(`${API}/service/v1/channels/${id}/videos`);
    url.searchParams.set("sortType", "LATEST");
    url.searchParams.set("pagingType", "PAGE");
    url.searchParams.set("page", String(pageNumber));
    url.searchParams.set("size", String(VIDEO_PAGE_SIZE));
    url.searchParams.set("publishDateAt", "");
    url.searchParams.set("videoType", "");
    const content = await getJson(url.toString());
    const serverRows = responseRows(content);
    const result = normalizeVideoPage(content, fallback);
    const totalPages = Number(content?.totalPages ?? content?.totalPage);
    const hasNext = Number.isFinite(totalPages)
      ? pageNumber + 1 < totalPages
      : serverRows.length === VIDEO_PAGE_SIZE;
    return { ...result, next: hasNext ? pageNumber + 1 : null };
  }

  async function searchChannelsPage(keyword, offset = 0) {
    const query = String(keyword || "").trim();
    const start = Number(offset);
    if (!query || !Number.isSafeInteger(start) || start < 0 || start > 10000)
      return { rows: [], next: null };
    const url = new URL(`${API}/service/v1/search/channels`);
    url.searchParams.set("keyword", query);
    url.searchParams.set("offset", String(start));
    url.searchParams.set("size", String(SEARCH_PAGE_SIZE));
    const content = await getJson(url.toString());
    const entries = Array.isArray(content?.data) ? content.data : [];
    const rows = entries.map((entry) => {
      const channel = entry?.channel || entry;
      const id = String(channel?.channelId || "").toLowerCase();
      if (!HASH_RE.test(id)) return null;
      return {
        channelId: id,
        channelName: String(channel?.channelName || "").trim(),
        channelImageUrl: String(channel?.channelImageUrl || ""),
        ...CheeseVerifiedMark.fields(channel),
        mediaType: "channel",
      };
    }).filter(Boolean);
    return { rows, next: entries.length === SEARCH_PAGE_SIZE ? start + SEARCH_PAGE_SIZE : null };
  }

  async function searchVideosPage(keyword, offset = 0, options = VIDEO_SEARCH_DEFAULTS) {
    const query = String(keyword || "").trim();
    const start = Number(offset);
    if (!query || query.length > 100 || !Number.isSafeInteger(start) || start < 0 || start > 10000)
      return { rows: [], next: null };
    const { sort, playTime, period, start: from, end: to } = normalizeVideoSearchOptions(options);
    const url = new URL(`${API}/service/v2/search/videos`);
    url.searchParams.set("keyword", query);
    url.searchParams.set("offset", String(start));
    url.searchParams.set("playTime", playTime);
    url.searchParams.set("size", String(VIDEO_PAGE_SIZE));
    url.searchParams.set("sort", sort);
    const range = globalThis.CheeseSearchDateRange?.apiRange(period, from, to);
    if (range) {
      url.searchParams.set("startDate", range.startDate);
      url.searchParams.set("endDate", range.endDate);
    }
    const content = await getJson(url.toString());
    const entries = responseRows(content);
    const rows = entries.map((entry) => normalizeVideo(entry)).filter(Boolean);
    const nextOffset = Number(content?.page?.next?.offset);
    return {
      rows,
      next: entries.length && Number.isSafeInteger(nextOffset) && nextOffset > start && nextOffset <= 10000 ? nextOffset : null,
    };
  }


  async function loadVideoVaultFavorites() {
    try {
      const active = await chrome.storage.local.get("cheeseVideoVaultActiveAccount");
      const accountId = String(active?.cheeseVideoVaultActiveAccount || "").toLowerCase();
      if (!HASH_RE.test(accountId)) return [];
      const key = `${VIDEO_VAULT_KEY}${accountId}`;
      const stored = await chrome.storage.local.get(key);
      const favorites = Array.isArray(stored?.[key])
        ? stored[key]
        : [];
      return favorites.map((item) => normalizeVideo({
        ...item,
        video: {
          ...item,
          videoNo: item?.videoNo,
          videoTitle: item?.title,
          thumbnailImageUrl: item?.thumb,
          readCount: item?.readCount,
          publishDateAt: item?.publishDateAt,
          videoCategoryValue: item?.videoCategoryValue || item?.videoCategory,
          videoType: "REPLAY",
        },
        channel: {
          channelId: item?.channelId,
          channelName: item?.channelName,
          channelImageUrl: item?.channelImageUrl,
          ...CheeseVerifiedMark.fields(item),
        },
      })).filter(Boolean);
    } catch {
      return [];
    }
  }

  function createVideoPager(fetchPage, sortRows = null) {
    let rows = [];
    let next = "";
    let done = false;
    let loading = false;
    let error = null;
    let pending = null;
    const merge = (incoming, base = []) => {
      const seen = new Set();
      return [...base, ...(Array.isArray(incoming) ? incoming : [])].filter((row) => {
        const isChannel = row?.mediaType === "channel";
        const rawId = isChannel ? row?.channelId : row?.videoNo;
        const id = String(rawId || "").toLowerCase();
        if (
          (isChannel ? !HASH_RE.test(id) : !/^\d+$/.test(id)) ||
          seen.has(id)
        ) return false;
        seen.add(id);
        return true;
      });
    };
    const snapshot = () => ({ rows: [...rows], next, done, loading, error });
    const load = (replace) => {
      if (pending) return pending;
      loading = true;
      error = null;
      const cursor = replace ? "" : next;
      pending = Promise.resolve().then(() => fetchPage(cursor)).then((page) => {
        rows = merge(page?.rows, replace ? [] : rows);
        if (typeof sortRows === "function") rows = sortRows(rows);
        const candidate = page?.next == null ? "" : String(page.next);
        next = candidate && candidate !== String(cursor) ? candidate : "";
        done = !next;
      }).catch((reason) => {
        error = reason;
      }).finally(() => {
        loading = false;
        pending = null;
      }).then(snapshot);
      return pending;
    };
    return {
      get rows() { return [...rows]; },
      get next() { return next; },
      get done() { return done; },
      get loading() { return loading; },
      get error() { return error; },
      snapshot,
      resort() {
        if (typeof sortRows === "function") rows = sortRows(rows);
        return snapshot();
      },
      loadFirst(force = false) {
        if (!force && (rows.length || done || loading)) return loading ? pending : Promise.resolve(snapshot());
        return load(true);
      },
      loadNext() { return done || !next ? Promise.resolve(snapshot()) : load(false); },
    };
  }

  function createFollowingVideoPager() {
    return createVideoPager((cursor) => loadFollowingVideosPage(cursor));
  }

  function createAllVideoPager(sortType = "POPULAR") {
    return createVideoPager((cursor) => loadAllVideosPage(sortType, cursor));
  }

  function createChannelVideoPager(channel) {
    let page = 0;
    return createVideoPager(async (cursor) => {
      page = cursor === "" ? 0 : Number(cursor);
      return loadChannelVideosPage(channel, page);
    });
  }

  function createVideoVaultFavoritesPager() {
    let favorites = null;
    return createVideoPager(async (cursor) => {
      if (!favorites) favorites = await loadVideoVaultFavorites();
      const offset = cursor === "" ? 0 : Number(cursor);
      const rows = favorites.slice(offset, offset + VIDEO_PAGE_SIZE);
      const nextOffset = offset + rows.length;
      return {
        rows,
        next: nextOffset < favorites.length ? String(nextOffset) : null,
      };
    });
  }

  function createChannelSearchPager(keyword) {
    const query = String(keyword || "").trim();
    return createVideoPager((cursor) => searchChannelsPage(query, cursor === "" ? 0 : Number(cursor)));
  }

  // 검색어 다시보기: 서버 정렬·길이 필터(options 가 없으면 기억한 값). 고르기를 바꾸면 새 pager 를 만든다.
  function createVideoSearchPager(keyword, options = null) {
    const query = String(keyword || "").trim();
    let chosen = options ? normalizeVideoSearchOptions(options) : null;
    const pager = createVideoPager(async (cursor) => {
      if (!chosen) chosen = await loadVideoSearchSettings();
      const offset = cursor === "" ? 0 : Number(cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) return { rows: [], next: null };
      const page = await searchVideosPage(query, offset, chosen);
      return { rows: page.rows, next: page.next == null ? null : String(page.next) };
    });
    Object.defineProperty(pager, "options", { get: () => ({ ...(chosen || VIDEO_SEARCH_DEFAULTS) }) });
    return pager;
  }


  // ⚠ following-lives 를 쓴다. followings/live 의 liveInfo 에는 방송 썸네일이 없어
  //   프로필 이미지만 보였다. 이쪽은 liveInfo.liveImageUrl 까지 함께 내려온다.
  //   오프라인 채널도 함께 오므로 방송 중인 것만 남긴다.
  async function loadFollowing(sortType = "POPULAR") {
    if (!Object.values(FOLLOWING_SORT_TYPES).includes(sortType))
      throw new Error("invalid-sort");
    const c = await getJson(
      `${API}/service/v1/channels/following-lives?sortType=${sortType}`,
    );
    // 응답 모양이 버전마다 달라 둘 다 본다.
    const rows = Array.isArray(c?.followingList)
      ? c.followingList
      : Array.isArray(c?.data)
        ? c.data
        : [];
    return rows
      .filter(
        (r) =>
          r?.streamer?.openLive === true ||
          r?.liveInfo?.liveTitle ||
          r?.openLive === true,
      )
      .map((r, index) => ({
        ...normalize(
          {
            ...(r?.channel || {}),
            channelId: r?.channelId || r?.channel?.channelId,
          },
          r?.liveInfo || r?.live || r,
          r,
        ),
        recommendationRank: index,
        serverSortType: sortType,
        serverSource: "following",
      }))
      .filter((r) => r.channelId);
  }

  function normalizeLiveCursor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const cursor = {};
    for (const key of LIVE_CURSOR_KEYS) {
      const raw = value[key];
      if (raw === undefined || raw === null || raw === "") return null;
      if (typeof raw !== "string" && typeof raw !== "number") return null;
      cursor[key] = String(raw);
    }
    return cursor;
  }

  function livePageUrl(cursor = null, sortType = "POPULAR") {
    if (!Object.values(LIVE_SORT_TYPES).includes(sortType))
      throw new Error("invalid-sort");
    const url = new URL(`${API}/service/v1/lives`);
    url.searchParams.set("size", String(LIVE_PAGE_SIZE));
    url.searchParams.set("sortType", sortType);
    const safeCursor = normalizeLiveCursor(cursor);
    if (safeCursor) {
      for (const key of LIVE_CURSOR_KEYS)
        url.searchParams.set(key, safeCursor[key]);
    }
    return url.toString();
  }

  async function loadLivePage(
    cursor = null,
    fetchJson = getJson,
    sortType = "POPULAR",
  ) {
    const c = await fetchJson(livePageUrl(cursor, sortType));
    const rows = Array.isArray(c?.data) ? c.data : [];
    return {
      rows: rows
        .map((r) => ({
          ...normalize(r?.channel, r),
          serverSortType: sortType,
          serverSource: "all",
        }))
        .filter((r) => r.channelId),
      next: normalizeLiveCursor(c?.page?.next),
    };
  }

  function createLivePager(options = {}) {
    const sortType = options.sortType || "POPULAR";
    const fetchPage =
      typeof options.fetchPage === "function"
        ? options.fetchPage
        : (cursor) => loadLivePage(cursor, getJson, sortType);
    const now = typeof options.now === "function" ? options.now : Date.now;
    const ttlMs =
      Number.isFinite(options.ttlMs) && options.ttlMs > 0
        ? options.ttlMs
        : LIVE_CACHE_TTL_MS;
    let rows = [];
    let next = null;
    let loading = false;
    let done = false;
    let error = null;
    let expiresAt = 0;
    let generation = 0;
    let pending = null;

    const snapshot = () => ({
      rows: [...rows],
      next: next ? { ...next } : null,
      loading,
      done,
      error,
      expiresAt,
      generation,
    });

    const mergeRows = (base, incoming) => {
      const seen = new Set();
      const merged = [];
      for (const row of [
        ...base,
        ...(Array.isArray(incoming) ? incoming : []),
      ]) {
        const id = String(row?.channelId || "").toLowerCase();
        if (!HASH_RE.test(id) || seen.has(id)) continue;
        seen.add(id);
        merged.push({ ...row, channelId: id });
      }
      return merged;
    };

    const request = (cursor, replace) => {
      const requestGeneration = ++generation;
      loading = true;
      error = null;
      let response;
      try {
        response = fetchPage(cursor ? { ...cursor } : null);
      } catch (reason) {
        response = Promise.reject(reason);
      }
      const task = Promise.resolve(response)
        .then((page) => {
          if (requestGeneration !== generation) return;
          rows = mergeRows(replace ? [] : rows, page?.rows);
          next = normalizeLiveCursor(page?.next);
          if (
            cursor &&
            next &&
            LIVE_CURSOR_KEYS.every((key) => next[key] === cursor[key])
          ) {
            next = null;
          }
          done = next === null;
          expiresAt = now() + ttlMs;
        })
        .catch((reason) => {
          if (requestGeneration === generation) error = reason;
        })
        .finally(() => {
          if (requestGeneration === generation) {
            loading = false;
            pending = null;
          }
        })
        .then(snapshot);
      pending = task;
      return task;
    };

    return {
      get rows() {
        return [...rows];
      },
      get next() {
        return next ? { ...next } : null;
      },
      get loading() {
        return loading;
      },
      get done() {
        return done;
      },
      get error() {
        return error;
      },
      get expiresAt() {
        return expiresAt;
      },
      get generation() {
        return generation;
      },
      get sortType() {
        return sortType;
      },
      snapshot,
      isExpired() {
        return expiresAt > 0 && expiresAt <= now();
      },
      loadFirst(force = false) {
        if (!force && loading && pending) return pending;
        if (!force && expiresAt > now()) return Promise.resolve(snapshot());
        return request(null, true);
      },
      loadNext() {
        if (loading && pending) return pending;
        if (done) return Promise.resolve(snapshot());
        if (!next) return request(null, true);
        return request(next, false);
      },
      invalidate() {
        generation += 1;
        loading = false;
        pending = null;
        expiresAt = 0;
      },
    };
  }

  // 첫 페이지만 필요로 하던 기존 호출부를 위한 호환 함수.
  async function loadLive() {
    const page = await loadLivePage();
    return page.rows;
  }

  // ⚠ 채널 검색은 search/channels 를 쓴다. search/lives 는 지금 방송 중인 채널
  //   이름을 정확히 넣어도 0건이 온다(실측) — 방송 제목만 훑는 것으로 보인다.
  //   대신 이 응답에는 방송 정보가 없어 live-detail 로 채운다.
  function normalizeSearchCursor(value) {
    const offset = Number(value?.offset);
    const detailOffset = Number(value?.detailOffset);
    return {
      offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
      detailOffset:
        Number.isSafeInteger(detailOffset) && detailOffset >= 0
          ? detailOffset
          : 0,
    };
  }

  async function searchLiveChannelsPage(keyword, cursor = null) {
    const { offset, detailOffset } = normalizeSearchCursor(cursor);
    const c = await getJson(
      `${API}/service/v1/search/channels?keyword=${encodeURIComponent(keyword)}&offset=${offset}&size=${SEARCH_PAGE_SIZE}`,
    );
    const rows = Array.isArray(c?.data) ? c.data : [];
    const liveChannels = rows
      .map((r) => r?.channel)
      .filter((ch) => ch?.channelId && ch.openLive === true);
    const channels = liveChannels.slice(
      detailOffset,
      detailOffset + SEARCH_DETAIL_MAX,
    );
    const detailed = await Promise.all(
      channels.map(async (ch) => {
        try {
          const d = await getJson(
            `${API}/service/v3/channels/${ch.channelId}/live-detail`,
          );
          if (d?.status !== "OPEN") return null; // 실제로 열려 있을 때만
          return normalize({ ...ch, ...(d.channel || {}) }, d);
        } catch {
          return null;
        }
      }),
    );
    const nextDetailOffset = detailOffset + SEARCH_DETAIL_MAX;
    const next =
      nextDetailOffset < liveChannels.length
        ? { offset, detailOffset: nextDetailOffset }
        : rows.length === SEARCH_PAGE_SIZE
          ? { offset: offset + SEARCH_PAGE_SIZE, detailOffset: 0 }
          : null;
    return { rows: detailed.filter(Boolean), next };
  }

  async function searchLiveChannels(keyword) {
    return (await searchLiveChannelsPage(keyword)).rows;
  }

  async function searchLiveTags(keyword) {
    const tag = String(keyword || "")
      .trim()
      .replace(/^#/, "")
      .trim();
    if (!tag) return [];
    const url = new URL(`${API}/service/v1/tag/lives`);
    url.searchParams.set("size", "20");
    url.searchParams.set("sortType", "POPULAR");
    url.searchParams.set("tags", tag);
    const c = await getJson(url.toString());
    const rows = Array.isArray(c?.data) ? c.data : [];
    return rows
      .filter(
        (row) =>
          HASH_RE.test(String(row?.channel?.channelId || "")) &&
          typeof row?.liveTitle === "string",
      )
      .map((row) => normalize(row.channel, row));
  }

  function mergeSearchRows(channels, tags) {
    const merged = [];
    const index = new Map();
    for (const row of [...channels, ...tags]) {
      const id = String(row?.channelId || "").toLowerCase();
      if (!HASH_RE.test(id)) continue;
      const previous = index.get(id);
      if (!previous) {
        const entry = { ...row, channelId: id };
        index.set(id, entry);
        merged.push(entry);
        continue;
      }
      for (const field of [
        "channelName",
        "channelImageUrl",
        "liveTitle",
        "category",
        "liveImageUrl",
      ]) {
        if (!previous[field] && row[field]) previous[field] = row[field];
      }
      if (!previous.viewers && row.viewers) previous.viewers = row.viewers;
      if (!previous.openedAt && row.openedAt) previous.openedAt = row.openedAt;
      if (!previous.adult && row.adult) previous.adult = true;
      if (
        (!Array.isArray(previous.tags) || !previous.tags.length) &&
        row.tags?.length
      ) {
        previous.tags = [...row.tags];
      }
    }
    return merged;
  }

  async function searchLivePage(keyword, cursor = null) {
    const query = String(keyword || "").trim();
    if (!query) return { rows: [], next: null };
    const normalizedCursor = normalizeSearchCursor(cursor);
    const includeTags =
      normalizedCursor.offset === 0 && normalizedCursor.detailOffset === 0;
    const results = await Promise.allSettled([
      searchLiveChannelsPage(query, normalizedCursor),
      includeTags ? searchLiveTags(query) : Promise.resolve([]),
    ]);
    if (results.every((result) => result.status === "rejected")) {
      throw new Error("검색 요청 실패");
    }
    const channelPage =
      results[0].status === "fulfilled"
        ? results[0].value
        : { rows: [], next: null };
    return {
      rows: mergeSearchRows(
        Array.isArray(channelPage?.rows) ? channelPage.rows : [],
        results[1].status === "fulfilled" ? results[1].value : [],
      ),
      next: channelPage?.next || null,
    };
  }

  function createSearchPager(keyword) {
    const query = String(keyword || "").trim();
    let rows = [];
    let next = query ? { offset: 0, detailOffset: 0 } : null;
    let loading = false;
    let done = !query;
    let error = null;
    let generation = 0;
    let pending = null;

    const snapshot = () => ({
      rows: [...rows],
      next: next ? { ...next } : null,
      loading,
      done,
      error,
      generation,
    });

    const request = async (cursor, replace) => {
      const requestGeneration = ++generation;
      loading = true;
      error = null;
      const before = replace ? [] : rows;
      try {
        let current = cursor;
        let merged = before;
        do {
          const page = await searchLivePage(query, current);
          if (requestGeneration !== generation) return snapshot();
          const previousLength = merged.length;
          merged = mergeSearchRows(merged, page.rows);
          current = page.next;
          // 빈 검색 페이지나 앞선 결과와만 겹친 페이지는 사용자가 빈 목록을 보지
          // 않도록, 새 결과가 나올 때까지 다음 검증된 offset을 이어서 읽는다.
          if (merged.length > previousLength || !current) break;
        } while (current);
        rows = merged;
        next = current;
        done = next === null;
      } catch (reason) {
        if (requestGeneration === generation) error = reason;
      } finally {
        if (requestGeneration === generation) {
          loading = false;
          pending = null;
        }
      }
      return snapshot();
    };

    return {
      get rows() {
        return [...rows];
      },
      get next() {
        return next ? { ...next } : null;
      },
      get loading() {
        return loading;
      },
      get done() {
        return done;
      },
      get error() {
        return error;
      },
      get generation() {
        return generation;
      },
      snapshot,
      loadFirst(force = false) {
        if (loading && pending) return pending;
        if (!force && rows.length) return Promise.resolve(snapshot());
        if (!query) return Promise.resolve(snapshot());
        pending = request({ offset: 0, detailOffset: 0 }, true);
        return pending;
      },
      loadNext() {
        if (loading && pending) return pending;
        if (done || !next) return Promise.resolve(snapshot());
        pending = request(next, false);
        return pending;
      },
      invalidate() {
        generation += 1;
        loading = false;
        pending = null;
      },
    };
  }

  async function searchLive(keyword) {
    return (await searchLivePage(keyword)).rows;
  }


  // ── 카테고리·태그로 찾기 ──────────────────────────────────────────────
  // 카드의 카테고리·태그 칩을 누르거나 '카테고리' 검색에서 카테고리를 고르면 그 라이브를
  // 시청자순으로 보인다(치지직 카테고리·태그 화면과 같은 목록, 2026-10-18 실측).
  //   카테고리: GET /service/v2/categories/{GAME|SPORTS|ETC}/{categoryId}/lives?size=&concurrentUserCount=&liveId=
  //   태그:     GET /service/v1/tag/lives?size=&sortType=POPULAR&tags=&concurrentUserCount=&liveId=
  //   둘 다 content.page.next = { concurrentUserCount, liveId } 로 다음 묶음을 잇는다.
  //   카테고리 찾기: GET /manage/v1/auto-complete/categories?keyword=&size=(≤50) — 표시 이름 부분 일치.
  const CATEGORY_TYPES = new Set(["GAME", "SPORTS", "ETC"]);
  const CATEGORY_ID_RE = /^[^/?#\s]{1,120}$/;
  const FILTER_PAGE_SIZE = 30;
  const CATEGORY_SEARCH_SIZE = 50;

  // { kind: "category", categoryType, categoryId, label } | { kind: "tag", tag, label } | null
  function normalizeSearchFilter(raw) {
    if (raw?.kind === "category") {
      const categoryType = String(raw.categoryType || "").toUpperCase();
      const categoryId = String(raw.categoryId || "").trim();
      if (!CATEGORY_TYPES.has(categoryType) || !CATEGORY_ID_RE.test(categoryId)) return null;
      return { kind: "category", categoryType, categoryId, label: String(raw.label || categoryId).trim().slice(0, 100) };
    }
    if (raw?.kind === "tag") {
      const tag = String(raw.tag || "").trim().replace(/^#/, "").trim().slice(0, 80);
      return tag ? { kind: "tag", tag, label: tag } : null;
    }
    return null;
  }

  function searchFilterKey(filter) {
    const f = normalizeSearchFilter(filter);
    if (!f) return "";
    return f.kind === "category" ? `category:${f.categoryType}:${f.categoryId}` : `tag:${f.tag.toLocaleLowerCase("ko-KR")}`;
  }

  // 카드의 칩 → 필터(카테고리는 종류·id 를 아는 카드만).
  function searchFilterFromRow(row, kind, tag = "") {
    if (kind === "category") {
      return normalizeSearchFilter({ kind, categoryType: row?.categoryType, categoryId: row?.categoryId, label: row?.category });
    }
    return normalizeSearchFilter({ kind: "tag", tag });
  }

  // 카드의 카테고리·태그 칩. 누를 수 있는 칩에는 data-mv-filter-* 를 단다(카드 버튼 안이라
  // 버튼 대신 span — 누르기는 카드 클릭보다 먼저 받아 처리한다).
  function cardFilterChipsHtml(row, esc) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    const category = String(row?.category || "");
    const categoryFilter = category ? searchFilterFromRow(row, "category") : null;
    return (
      (category
        ? categoryFilter
          ? `<span class="mv-card-category-chip is-filter" data-mv-filter-kind="category" data-mv-filter-type="${esc(categoryFilter.categoryType)}" ` +
            `data-mv-filter-id="${esc(categoryFilter.categoryId)}" data-mv-filter-label="${esc(category)}" title="${esc(`${category} 방송 보기`)}">${esc(category)}</span>`
          : `<span class="mv-card-category-chip">${esc(category)}</span>`
        : "") +
      tags.map((tag) =>
        `<span class="mv-card-tag-chip is-filter" data-mv-filter-kind="tag" data-mv-filter-tag="${esc(tag)}" title="${esc(`#${tag} 방송 보기`)}">${esc(tag)}</span>`).join("")
    );
  }

  // 누른 칩 → 필터. 칩이 아니면 null.
  function searchFilterFromChip(target) {
    const chip = target?.closest?.("[data-mv-filter-kind]");
    if (!chip) return null;
    return chip.dataset.mvFilterKind === "category"
      ? normalizeSearchFilter({ kind: "category", categoryType: chip.dataset.mvFilterType, categoryId: chip.dataset.mvFilterId, label: chip.dataset.mvFilterLabel })
      : normalizeSearchFilter({ kind: "tag", tag: chip.dataset.mvFilterTag });
  }

  function normalizeFilterCursor(value) {
    const count = Number(value?.concurrentUserCount);
    const liveId = Number(value?.liveId);
    return Number.isSafeInteger(count) && count >= 0 && Number.isSafeInteger(liveId) && liveId > 0
      ? { concurrentUserCount: count, liveId }
      : null;
  }

  function filterLivesUrl(filter, cursor = null) {
    const url = filter.kind === "category"
      ? new URL(`${API}/service/v2/categories/${encodeURIComponent(filter.categoryType)}/${encodeURIComponent(filter.categoryId)}/lives`)
      : new URL(`${API}/service/v1/tag/lives`);
    url.searchParams.set("size", String(FILTER_PAGE_SIZE));
    if (filter.kind === "tag") {
      url.searchParams.set("sortType", "POPULAR");
      url.searchParams.set("tags", filter.tag);
    }
    const next = normalizeFilterCursor(cursor);
    if (next) {
      url.searchParams.set("concurrentUserCount", String(next.concurrentUserCount));
      url.searchParams.set("liveId", String(next.liveId));
    }
    return url.toString();
  }

  async function loadFilterLivesPage(filter, cursor = null) {
    const f = normalizeSearchFilter(filter);
    if (!f) return { rows: [], next: null };
    const c = await getJson(filterLivesUrl(f, cursor));
    const rows = Array.isArray(c?.data) ? c.data : Array.isArray(c?.liveInfoResponseList) ? c.liveInfoResponseList : [];
    return {
      rows: rows
        .filter((row) => HASH_RE.test(String(row?.channel?.channelId || "").toLowerCase()) && typeof row?.liveTitle === "string")
        .map((row) => normalize(row.channel, row)),
      next: rows.length ? normalizeFilterCursor(c?.page?.next) : null,
    };
  }

  // 검색 pager 와 같은 모양(rows·next·loading·done·error·generation·snapshot·loadFirst·loadNext·invalidate).
  function createCursorPager(fetchPage, firstCursor = null) {
    let rows = [];
    let next = firstCursor;
    let loading = false;
    let done = false;
    let error = null;
    let generation = 0;
    let pending = null;
    let started = false;
    const snapshot = () => ({ rows: [...rows], next, loading, done, error, generation });
    const request = async (cursor, replace) => {
      const requestGeneration = ++generation;
      loading = true;
      error = null;
      try {
        const page = await fetchPage(cursor);
        if (requestGeneration !== generation) return snapshot();
        const seen = new Set(replace ? [] : rows.map((row) => row.channelId));
        const fresh = (page.rows || []).filter((row) => row.channelId && !seen.has(row.channelId) && seen.add(row.channelId));
        rows = replace ? fresh : [...rows, ...fresh];
        next = page.next || null;
        done = next === null;
        started = true;
      } catch (reason) {
        if (requestGeneration === generation) error = reason;
      } finally {
        if (requestGeneration === generation) {
          loading = false;
          pending = null;
        }
      }
      return snapshot();
    };
    return {
      get rows() { return [...rows]; },
      get next() { return next; },
      get loading() { return loading; },
      get done() { return done; },
      get error() { return error; },
      get generation() { return generation; },
      snapshot,
      loadFirst(force = false) {
        if (loading && pending) return pending;
        if (!force && started && !error) return Promise.resolve(snapshot());
        pending = request(firstCursor, true);
        return pending;
      },
      loadNext() {
        if (loading && pending) return pending;
        if (done || !started) return Promise.resolve(snapshot());
        pending = request(next, false);
        return pending;
      },
      invalidate() {
        generation += 1;
        loading = false;
        pending = null;
      },
    };
  }

  function createFilterPager(filter) {
    const f = normalizeSearchFilter(filter);
    const pager = createCursorPager((cursor) => loadFilterLivesPage(f, cursor));
    pager.filter = f;
    return pager;
  }

  // '카테고리' 검색: 이름이 맞는 카테고리 목록(카드로 보이고, 누르면 그 카테고리 라이브).
  // 행은 mediaType "category" 이고 channelId 자리에 "category:{type}:{id}" 를 둔다(목록 키).
  async function searchCategories(keyword) {
    const query = String(keyword || "").trim().slice(0, 50);
    if (!query) return [];
    const url = new URL(`${API}/manage/v1/auto-complete/categories`);
    url.searchParams.set("keyword", query);
    url.searchParams.set("size", String(CATEGORY_SEARCH_SIZE));
    const c = await getJson(url.toString());
    const results = Array.isArray(c?.results) ? c.results : Array.isArray(c?.data) ? c.data : [];
    return results.map((item) => {
      const filter = normalizeSearchFilter({ kind: "category", categoryType: item?.categoryType, categoryId: item?.categoryId, label: item?.categoryValue });
      if (!filter) return null;
      return {
        mediaType: "category",
        channelId: searchFilterKey(filter),
        filter,
        channelName: filter.label,
        liveTitle: filter.label,
        categoryType: filter.categoryType,
        posterImageUrl: String(item?.posterImageUrl || ""),
        tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 4) : [],
        viewers: 0,
      };
    }).filter(Boolean);
  }

  // '방제' 검색: 방송 제목에 검색어가 든 라이브(search/lives — 채널 이름은 찾지 않는다, 2026-10-19 실측).
  //   GET /service/v1/search/lives?keyword=&offset=&size= → data[].{live, channel}, page.next = { offset }
  async function searchLiveTitlesPage(keyword, cursor = null) {
    const query = String(keyword || "").trim().slice(0, 100);
    const offset = Number.isSafeInteger(Number(cursor?.offset)) && Number(cursor.offset) >= 0 ? Number(cursor.offset) : 0;
    if (!query) return { rows: [], next: null };
    const url = new URL(`${API}/service/v1/search/lives`);
    url.searchParams.set("keyword", query);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("size", String(FILTER_PAGE_SIZE));
    const c = await getJson(url.toString());
    const data = Array.isArray(c?.data) ? c.data : [];
    const rows = data
      .filter((entry) => HASH_RE.test(String(entry?.channel?.channelId || "").toLowerCase()) && typeof entry?.live?.liveTitle === "string")
      .map((entry) => normalize(entry.channel, entry.live));
    const nextOffset = Number(c?.page?.next?.offset);
    return {
      rows,
      next: data.length && Number.isSafeInteger(nextOffset) && nextOffset > offset && nextOffset <= 10000 ? { offset: nextOffset } : null,
    };
  }

  function createTitleSearchPager(keyword) {
    const query = String(keyword || "").trim();
    return createCursorPager((cursor) => searchLiveTitlesPage(query, cursor), { offset: 0 });
  }

  function createCategorySearchPager(keyword) {
    const query = String(keyword || "").trim();
    return createCursorPager(async () => ({ rows: query ? await searchCategories(query) : [], next: null }));
  }

  const CATEGORY_TYPE_LABELS = { GAME: "게임", SPORTS: "스포츠", ETC: "기타" };
  // 카테고리 카드(포스터 + 이름 + 종류). 누르면 data-mv-category-pick 으로 그 카테고리 라이브.
  function categoryCardHtml(row, esc, className = "mv-category-card") {
    const poster = /^https:\/\//.test(row.posterImageUrl || "") ? row.posterImageUrl : "";
    return (
      `<button type="button" class="${className}" data-mv-category-pick="${esc(row.channelId)}" ` +
      `data-mv-filter-type="${esc(row.filter.categoryType)}" data-mv-filter-id="${esc(row.filter.categoryId)}" data-mv-filter-label="${esc(row.filter.label)}">` +
      `<span class="mv-category-card-poster">${poster ? `<img src="${esc(poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>` +
      `<span class="mv-category-card-name">${esc(row.filter.label)}</span>` +
      `<span class="mv-category-card-type">${esc(CATEGORY_TYPE_LABELS[row.filter.categoryType] || "")}</span>` +
      `</button>`
    );
  }

  function categoryFromCard(target) {
    const card = target?.closest?.("[data-mv-category-pick]");
    if (!card) return null;
    return normalizeSearchFilter({ kind: "category", categoryType: card.dataset.mvFilterType, categoryId: card.dataset.mvFilterId, label: card.dataset.mvFilterLabel });
  }

  // 검색 탭 위의 필터 표시('카테고리: 이름 ×' / '#태그 ×').
  function searchFilterPillHtml(filter, esc) {
    const f = normalizeSearchFilter(filter);
    if (!f) return "";
    const label = f.kind === "category" ? `카테고리 · ${f.label}` : `태그 · #${f.tag}`;
    return `<span class="mv-search-filter-label">${esc(label)}</span>` +
      `<button type="button" class="mv-search-filter-clear" data-mv-filter-clear aria-label="${esc(`${label} 필터 해제`)}" title="필터 해제">` +
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`;
  }

  // 전용 팔로잉을 사이드바와 같은 구분(즐겨찾기 → 그룹 → 구독 → 태그 → 친밀도 →
  // 나머지 팔로잉)으로 나눠 돌려준다.
  //
  // ⚠ 고르기 화면과 시청 화면(Quick)이 반드시 같은 목록을 봐야 한다. 예전에는
  //   Quick 만 '즐겨찾기 + 그룹 channelIds' 합집합을 따로 읽어, 구독·태그·친밀도·
  //   나머지 팔로잉이 통째로 빠지고 두 키가 모두 없으면 아예 비어 보였다.
  async function loadCustomSections(sortType = "POPULAR") {
    let favorites = [];
    let favoriteOrder = [];
    let groups = [];
    let groupOrder = [];
    let flags = {};
    try {
      const d = await chrome.storage.local.get([
        "cheeseFollowFavorites",
        "cheeseFollowFavOrder",
        "cheeseFollowCustomGroups",
        "cheeseFollowGroupOrder",
        "cheeseFeatureHidden",
      ]);
      flags = d?.cheeseFeatureHidden || {};
      favorites = Array.isArray(d?.cheeseFollowFavorites)
        ? d.cheeseFollowFavorites
        : [];
      favoriteOrder = Array.isArray(d?.cheeseFollowFavOrder)
        ? d.cheeseFollowFavOrder
        : [];
      groups = Array.isArray(d?.cheeseFollowCustomGroups)
        ? d.cheeseFollowCustomGroups
        : [];
      groupOrder = Array.isArray(d?.cheeseFollowGroupOrder)
        ? d.cheeseFollowGroupOrder
        : [];
    } catch {}

    const live = await loadFollowing(sortType);
    const byId = new Map(live.map((r) => [r.channelId, r]));
    const idsOf = (list) =>
      (Array.isArray(list) ? list : [])
        .map((v) => String(v || "").toLowerCase())
        .filter((v) => HASH_RE.test(v));

    const sections = [];
    const used = new Set();
    const take = (ids) => {
      const rows = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (!row || used.has(id)) continue;
        used.add(id);
        rows.push(row);
      }
      return rows;
    };

    const favoriteIds = idsOf(favorites);
    const orderedFavorites = idsOf(favoriteOrder).filter((id) =>
      favoriteIds.includes(id),
    );
    const favRows = take([...orderedFavorites, ...favoriteIds]);
    if (favRows.length) {
      sections.push({
        id: "fav",
        label: "즐겨찾기",
        icon: "star",
        customOrder: orderedFavorites.length > 0,
        rows: favRows,
      });
    }

    // 사용자가 정한 그룹 순서를 따른다(없으면 저장된 차례대로).
    const order = groupOrder.filter((id) => groups.some((g) => g?.id === id));
    const ordered = [
      ...order.map((id) => groups.find((g) => g?.id === id)),
      ...groups.filter((g) => g?.id && !order.includes(g.id)),
    ].filter(Boolean);
    for (const group of ordered) {
      const rows = take(idsOf(group.channelIds));
      if (!rows.length) continue;
      sections.push({
        id: `group:${group.id}`,
        label: String(group.name || "그룹"),
        icon: group.icon || "folder",
        color: group.color || "",
        customOrder: group.manualOrder === true,
        rows,
      });
    }

    // 자동 '구독' 그룹. 사이드바의 sbFollowGroupSubscribe 와 같은 조건에서만 만든다.
    if (
      flags.sbFollowGroupEnabled === true &&
      flags.sbFollowGroupSubscribe === true
    ) {
      const subscribed = await loadSubscribedIds();
      const rows = take([...subscribed]);
      if (rows.length) {
        sections.push({
          id: "auto:subscription",
          label: "구독",
          icon: "star",
          rows,
        });
      }
    }

    // 자동 태그 그룹. 같은 태그를 가진 채널을 묶는다(사이드바와 같은 규칙).
    if (
      flags.sbFollowGroupEnabled === true &&
      flags.sbFollowGroupTags === true
    ) {
      const byTag = new Map();
      for (const row of live) {
        if (used.has(row.channelId)) continue;
        for (const tag of row.tags || []) {
          const key = tag.toLowerCase();
          if (!byTag.has(key)) byTag.set(key, { name: tag, rows: [] });
          byTag.get(key).rows.push(row);
        }
      }
      // 두 채널 이상 묶이는 태그만, 많이 묶인 순으로 최대 20개.
      const tagGroups = [...byTag.entries()]
        .filter(([, v]) => v.rows.length >= 2)
        .sort((a, b) => b[1].rows.length - a[1].rows.length)
        .slice(0, 20);
      for (const [key, entry] of tagGroups) {
        const rows = take(entry.rows.map((r) => r.channelId));
        if (rows.length) {
          sections.push({
            id: `tag:${key}`,
            label: `#${entry.name}`,
            icon: "folder",
            rows,
          });
        }
      }
    }

    // 친밀도(내 활동순). 사이드바의 '내 활동순' 과 같은 점수 계산을 쓰되, 여기서는
    // 저장소에 있는 지표(통나무파워·내 채팅)만 쓴다.
    // ⚠ 구독 개월·후원 횟수는 치지직 API 를 직접 불러야 하는데 확장 페이지에서는
    //   CORS 로 막힌다. 그래서 그 둘은 빼고 점수를 낸다 — 사이드바 순서와 완전히
    //   같지는 않다.
    const affinityRows = await loadAffinitySection(live, used);
    if (affinityRows.length) {
      sections.push({
        id: "affinity",
        label: "친밀도",
        icon: "heart",
        customOrder: true,
        rows: affinityRows,
      });
    }

    // 어느 구역에도 안 들어간 나머지 팔로잉.
    const rest = live.filter((r) => !used.has(r.channelId));
    if (rest.length) {
      sections.push({
        id: "rest",
        label: "팔로잉",
        icon: "users",
        rows: rest,
      });
    }
    return sections;
  }

  // 모든 목록을 '구역 배열' 로 통일한다. 전용 팔로잉만 여러 구역이고 나머지는 하나다.
  // 구독 중인 채널 id. 자동 '구독' 그룹에 쓴다.
  async function loadSubscribedIds() {
    const out = new Set();
    try {
      const c = await getJson(
        `${API}/commercial/v1/subscribe/channels?page=0&size=100`,
      );
      for (const row of Array.isArray(c?.data) ? c.data : []) {
        const id = String(
          row?.channel?.channelId || row?.channelId || "",
        ).toLowerCase();
        if (HASH_RE.test(id)) out.add(id);
      }
    } catch {}
    return out;
  }

  // 친밀도 구역. 저장소 지표만으로 점수를 내 상위 채널을 고른다.
  const AFFINITY_MAX = 12;
  async function loadAffinitySection(live, used) {
    const API_ = globalThis.CheeseChannelAffinity;
    const DATA_ = globalThis.CheeseChannelAffinityData;
    if (!API_ || !DATA_) return [];
    try {
      const d = await chrome.storage.local.get("cheeseFollowAffinityOn");
      if (d?.cheeseFollowAffinityOn !== true) return []; // 기본 OFF
    } catch {
      return [];
    }
    try {
      const accountId = await currentAccountId();
      const metrics = await DATA_.collectMetrics(
        chrome.storage.local,
        accountId,
        {
          // 이 둘은 치지직 API 를 직접 불러야 해서 확장 페이지에서는 막힌다.
          skip: ["subscribe", "donation"],
          parseKey: globalThis.CheeseChatRecapStore?.parseKey,
        },
      );
      const scored = API_.scoreChannels(metrics, {});
      if (!Array.isArray(scored) || !scored.length) return [];
      const rank = new Map(
        scored.map((row, i) => [String(row.channelId).toLowerCase(), i]),
      );
      return live
        .filter((r) => !used.has(r.channelId) && rank.has(r.channelId))
        .sort((a, b) => rank.get(a.channelId) - rank.get(b.channelId))
        .slice(0, AFFINITY_MAX)
        .map((r) => {
          used.add(r.channelId);
          return r;
        });
    } catch {
      return [];
    }
  }

  // 채팅 기록 키에 쓰인 계정 id. 없으면 빈 문자열(그러면 '내 채팅' 지표만 빠진다).
  async function currentAccountId() {
    try {
      const all = await chrome.storage.local.get(null);
      for (const key of Object.keys(all || {})) {
        const m = key.match(/^chatRecap:([0-9a-f]{32}):/i);
        if (m) return m[1].toLowerCase();
      }
    } catch {}
    return "";
  }

  // 구역을 하나로 펼친 목록(폴더가 필요 없는 곳에서 쓴다).
  async function loadCustomFollowing() {
    const sections = await loadCustomSections();
    const seen = new Set();
    const rows = [];
    for (const section of sections) {
      for (const row of section.rows || []) {
        if (seen.has(row.channelId)) continue;
        seen.add(row.channelId);
        rows.push(row);
      }
    }
    return rows;
  }

  const api = {
    VIDEO_SEARCH_DEFAULTS,
    VIDEO_SEARCH_SORTS,
    VIDEO_SEARCH_PLAY_TIMES,
    VIDEO_SEARCH_PERIODS,
    normalizeVideoSearchOptions,
    videoSearchControlsMarkup,
    formatCompactCount,
    formatVideoDuration,
    formatRelativeTime,
    formatVideoDate,
    getWatchTimelinePercent,
    loadVideoSearchSettings,
    saveVideoSearchSettings,
    API,
    HASH_RE,
    getJson,
    isLoginRequiredError,
    profileThumb,
    defaultProfileUrl,
    profileImg,
    SORT_OPTIONS,
    serverSortType,
    sortRows,
    sortSections,
    hasCustomOrder,
    normalize,
    normalizeVideo,
    normalizeVideoPage,
    normalizeLiveCursor,
    livePageUrl,
    loadLivePage,
    createLivePager,
    loadFollowing,
    loadLive,
    searchLiveChannels,
    searchLiveChannelsPage,
    searchLiveTags,
    mergeSearchRows,
    searchLivePage,
    createSearchPager,
    normalizeSearchFilter,
    searchFilterKey,
    searchFilterFromRow,
    searchFilterFromChip,
    cardFilterChipsHtml,
    loadFilterLivesPage,
    createFilterPager,
    searchCategories,
    createCategorySearchPager,
    searchLiveTitlesPage,
    createTitleSearchPager,
    categoryCardHtml,
    categoryFromCard,
    searchFilterPillHtml,
    searchLive,
    loadCustomFollowing,
    loadCustomSections,
    loadFollowingVideosPage,
    loadAllVideosPage,
    loadChannelVideosPage,
    searchChannelsPage,
    searchVideosPage,
    loadVideoVaultFavorites,
    createVideoPager,
    createFollowingVideoPager,
    createAllVideoPager,
    createChannelVideoPager,
    createVideoVaultFavoritesPager,
    createChannelSearchPager,
    createVideoSearchPager,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewSources = api;
})();
