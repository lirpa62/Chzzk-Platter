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
  // 검색 결과 중 방송 정보를 확인할 최대 채널 수(채널마다 요청이 하나씩 생긴다).
  const SEARCH_DETAIL_MAX = 12;

  async function getJson(url) {
    const reply = await chrome.runtime.sendMessage({
      type: "MULTIVIEW_API",
      url,
    });
    if (!reply?.ok) throw new Error(reply?.reason || "요청 실패");
    return reply.content ?? null;
  }

  // 응답 모양이 제각각이라 한 곳에서 같은 형태로 맞춘다.
  const normalize = (channel, live) => ({
    channelId: String(channel?.channelId || "").toLowerCase(),
    channelName: String(channel?.channelName || "").trim(),
    channelImageUrl: String(channel?.channelImageUrl || ""),
    liveTitle: String(live?.liveTitle || "").trim(),
    category: String(live?.liveCategoryValue || "").trim(),
    viewers: Number(live?.concurrentUserCount) || 0,
    adult: live?.adult === true,
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
  async function loadFollowing() {
    const c = await getJson(
      `${API}/service/v1/channels/following-lives?sortType=POPULAR`,
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
      .map((r) =>
        normalize(
          {
            ...(r?.channel || {}),
            channelId: r?.channelId || r?.channel?.channelId,
          },
          r?.liveInfo || r?.live || r,
        ),
      )
      .filter((r) => r.channelId);
  }

  // 인기 상위 목록('전체' 가 아니다 — 탭 이름도 '라이브' 로 둔다).
  async function loadLive() {
    const c = await getJson(`${API}/service/v1/lives?size=40`);
    const rows = Array.isArray(c?.data) ? c.data : [];
    return rows.map((r) => normalize(r?.channel, r)).filter((r) => r.channelId);
  }

  // ⚠ 채널 검색은 search/channels 를 쓴다. search/lives 는 지금 방송 중인 채널
  //   이름을 정확히 넣어도 0건이 온다(실측) — 방송 제목만 훑는 것으로 보인다.
  //   대신 이 응답에는 방송 정보가 없어 live-detail 로 채운다.
  async function searchLive(keyword) {
    if (!String(keyword || "").trim()) return [];
    const c = await getJson(
      `${API}/service/v1/search/channels?keyword=${encodeURIComponent(keyword)}&offset=0&size=30`,
    );
    const rows = Array.isArray(c?.data) ? c.data : [];
    const channels = rows
      .map((r) => r?.channel)
      .filter((ch) => ch?.channelId && ch.openLive === true)
      .slice(0, SEARCH_DETAIL_MAX);
    if (!channels.length) return [];
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
    return detailed.filter(Boolean);
  }

  // 전용 팔로잉을 사이드바와 같은 구분(즐겨찾기 → 그룹 → 구독 → 태그 → 친밀도 →
  // 나머지 팔로잉)으로 나눠 돌려준다.
  //
  // ⚠ 고르기 화면과 시청 화면(Quick)이 반드시 같은 목록을 봐야 한다. 예전에는
  //   Quick 만 '즐겨찾기 + 그룹 channelIds' 합집합을 따로 읽어, 구독·태그·친밀도·
  //   나머지 팔로잉이 통째로 빠지고 두 키가 모두 없으면 아예 비어 보였다.
  async function loadCustomSections() {
    let favorites = [];
    let groups = [];
    let groupOrder = [];
    let flags = {};
    try {
      const d = await chrome.storage.local.get([
        "cheeseFollowFavorites",
        "cheeseFollowCustomGroups",
        "cheeseFollowGroupOrder",
        "cheeseFeatureHidden",
      ]);
      flags = d?.cheeseFeatureHidden || {};
      favorites = Array.isArray(d?.cheeseFollowFavorites)
        ? d.cheeseFollowFavorites
        : [];
      groups = Array.isArray(d?.cheeseFollowCustomGroups)
        ? d.cheeseFollowCustomGroups
        : [];
      groupOrder = Array.isArray(d?.cheeseFollowGroupOrder)
        ? d.cheeseFollowGroupOrder
        : [];
    } catch {}

    const live = await loadFollowing();
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

    const favRows = take(idsOf(favorites));
    if (favRows.length) {
      sections.push({
        id: "fav",
        label: "즐겨찾기",
        icon: "star",
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
    normalize,
    loadFollowing,
    loadLive,
    searchLive,
    loadCustomFollowing,
    loadCustomSections,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewSources = api;
})();
