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
    verifiedMark:
      channel?.verifiedMark === true || entry?.verifiedMark === true,
    liveTitle: String(live?.liveTitle || "").trim(),
    category: String(live?.liveCategoryValue || "").trim(),
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
    API,
    HASH_RE,
    getJson,
    isLoginRequiredError,
    profileThumb,
    SORT_OPTIONS,
    serverSortType,
    sortRows,
    sortSections,
    hasCustomOrder,
    normalize,
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
    searchLive,
    loadCustomFollowing,
    loadCustomSections,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewSources = api;
})();
