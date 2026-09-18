// 치즈 플래터 - 멀티뷰
// 확장 페이지 안에서 치지직 /live/ 를 iframe 으로 띄운다.
// ⚠ m3u8 을 직접 재생하지 않는다. 중간광고·그리드를 우회하는 셈이 되어 제재
//   사유가 될 수 있다. 치지직 페이지를 그대로 띄워 광고·집계를 정상 동작시킨다.
// ⚠ 교차 출처라 부모에서 프레임 내부 DOM 을 만질 수 없다. 채팅 접기·넓은 화면·
//   화질·음소거는 URL 쿼리로 신호를 주고 프레임 쪽 content.js 가 수행한다
//   (팝업 플레이어의 ?cheesePopup=1 과 같은 방식).
(() => {
  "use strict";

  const API = "https://api.chzzk.naver.com";
  const LAYOUTS = globalThis.CheeseMultiviewLayouts;
  const MAX_CHANNELS = 6; // 메인 1 + 보조 5
  // 목록 캐시 수명. 제목·시청자 수·방송 여부가 바뀌므로 오래 들고 있으면 안 된다.
  // 검색은 입력마다 달라지므로 캐시하지 않는다.
  const LIST_TTL_MS = 20000;
  const WATCH_PAGE = "multiviewWatch.html";
  // 고른 구성을 시청 화면으로 넘길 때 쓰는 세션 저장소 키의 앞부분.
  // ⚠ 탭마다 다른 id 를 붙인다. 고정 키를 쓰면 멀티뷰를 두 탭에서 열었을 때
  //   서로 구성을 덮어쓴다.
  const HANDOFF_PREFIX = "cheeseMultiviewSetup";
  const HASH_RE = /^[0-9a-f]{32}$/i;

  const $ = (id) => document.getElementById(id);
  // 전용 팔로잉에서 지금 보고 있는 구역(빈 문자열이면 전체).
  const state = {
    handoffId: "",
    folder: "",
    source: "following",
    chosen: [], // [{channelId, channelName, channelImageUrl, liveTitle, viewers}]
    layoutId: "",
    chatSide: "",
    mainHighQuality: true,
    listCache: new Map(),
  };

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");

  // 구역 아이콘(lucide). 그룹은 사용자가 고른 아이콘이 따로 있지만 여기서는
  // 폴더 하나로 통일한다(아이콘 집합을 통째로 들고 오지 않기 위해).
  const FOLDER_ICONS = {
    star: '<path d="M11.5 3.2a.6.6 0 0 1 1 0l2.2 4.5 5 .7a.6.6 0 0 1 .3 1l-3.6 3.5.9 4.9a.6.6 0 0 1-.9.6L12 16.1l-4.4 2.3a.6.6 0 0 1-.9-.6l.9-4.9L4 9.4a.6.6 0 0 1 .3-1l5-.7z"></path>',
    folder:
      '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path>',
    heart:
      '<path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 12 5.4 5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7Z"></path>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.9"></path><path d="M16 3.1a4 4 0 0 1 0 7.8"></path>',
  };
  const folderIcon = (name) =>
    '<svg class="mv-folder-icon" width="18" height="18" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    (FOLDER_ICONS[name] || FOLDER_ICONS.folder) +
    "</svg>";

  // 구역 폴더(전용 팔로잉 전용). 통나무파워 탐색기 폴더 카드와 같은 모양.
  function renderFolders(sections) {
    const box = $("mvFolders");
    if (state.source !== "custom" || !sections.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const total = sections.reduce((n, sec) => n + sec.rows.length, 0);
    const card = (id, label, icon, count) =>
      `<button type="button" class="mv-folder${state.folder === id ? " is-on" : ""}" ` +
      `data-mv-folder="${esc(id)}" aria-pressed="${state.folder === id}">` +
      folderIcon(icon) +
      `<span class="mv-folder-name">${esc(label)}</span>` +
      `<span class="mv-folder-count">${fmt(count)}</span></button>`;
    box.innerHTML =
      card("", "전체", "users", total) +
      sections
        .map((sec) => card(sec.id, sec.label, sec.icon, sec.rows.length))
        .join("");
    box.hidden = false;
  }

  function newHandoffId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    // randomUUID 가 없을 때의 대비(충돌만 피하면 된다).
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // 이미지 주소는 API 가 준 문자열이다. esc() 는 따옴표 탈출만 막고 스킴은 못 막으므로
  // http(s) 가 아니면 아예 쓰지 않는다(javascript:, data: 등이 src 로 들어가는 것 차단).
  function safeImageUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw, location.href);
      return parsed.protocol === "https:" || parsed.protocol === "http:"
        ? parsed.toString()
        : "";
    } catch {
      return "";
    }
  }

  // 프로필 원본은 수백 KB 다. 목록에 수십 개를 그리므로 리사이즈본을 쓴다.
  // ⚠ 프로필 리사이즈는 f120_120_na 와 f240_240_na 만 있다(실측: 360·480·600 은 404).
  const thumb = (url, size = "120") => {
    const s = String(url || "");
    if (!s) return "";
    if (/[?&]type=/.test(s)) return s;
    const kind = size === "240" ? "f240_240_na" : "f120_120_na";
    return `${s}${s.includes("?") ? "&" : "?"}type=${kind}`;
  };

  // ⚠ 확장 페이지에서 치지직 API 를 직접 fetch 하면 Origin 이 chrome-extension://
  //   으로 붙어 403 "Invalid CORS request" 가 돌아온다(팔로잉·전체·검색 모두).
  //   서비스 워커의 fetch 는 Origin 을 붙이지 않으므로 배경 스크립트에 중계시킨다.

  // ── 채널 목록 ──────────────────────────────────────────────────────────
  // 채널 목록은 공용 로더를 쓴다(주소·응답 해석을 고르기/시청 두 곳에 두지 않는다).
  const SOURCES = globalThis.CheeseMultiviewSources;
  const getJson = (url) => SOURCES.getJson(url);
  const normalize = (channel, live) => SOURCES.normalize(channel, live);
  const loadFollowing = () => SOURCES.loadFollowing();
  const loadAll = () => SOURCES.loadLive();
  const search = (keyword) => SOURCES.searchLive(keyword);

  // 전용 팔로잉: 사이드바와 같은 구분(즐겨찾기 → 각 그룹 → 나머지 팔로잉)으로
  // 나눠 돌려준다. 라이브 정보는 팔로잉 목록에서 가져오므로 방송 중인 채널만 남는다.
  //
  // ⚠ 선호도(affinity) 구역은 넣지 않는다. 시청 이력 지표를 따로 모아 점수를
  //   매기는 별도 계산이라 이 화면에서 재현할 수 없다.
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

  async function listFor(source, keyword = "") {
    const key = source === "search" ? `search:${keyword}` : source;
    const cached = state.listCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let sections;
    if (source === "custom") {
      sections = await loadCustomSections();
    } else {
      const rows =
        source === "following"
          ? await loadFollowing()
          : source === "all"
            ? await loadAll()
            : await search(keyword);
      sections = rows.length ? [{ id: source, label: "", rows }] : [];
    }
    if (source !== "search") {
      state.listCache.set(key, {
        value: sections,
        expiresAt: Date.now() + LIST_TTL_MS,
      });
    }
    return sections;
  }

  // ⚠ 요청은 순서대로 보내도 응답은 뒤섞여 온다("에"→"에리"→"에리스" 를 빠르게
  //   치면 먼저 보낸 "에" 응답이 나중에 도착해 최신 결과를 덮을 수 있다).
  //   요청마다 번호를 매겨 마지막 요청의 응답만 그린다.
  let listRequestId = 0;

  async function renderList() {
    const requestId = ++listRequestId;
    // 요청 시점의 값을 붙잡는다(기다리는 동안 사용자가 탭·검색어를 바꿀 수 있다).
    const source = state.source;
    const keyword = $("mvSearch").value;
    const box = $("mvChannelList");
    box.setAttribute("aria-busy", "true");
    box.innerHTML = skeletonCards();
    let sections = [];
    try {
      sections = await listFor(source, keyword);
    } catch (error) {
      if (requestId !== listRequestId) return;
      box.removeAttribute("aria-busy");
      box.innerHTML = `<p class="mv-empty">목록을 불러오지 못했습니다. (${esc(error.message)})</p>`;
      return;
    }
    if (requestId !== listRequestId) return; // 더 최신 요청이 있다 → 버린다
    box.removeAttribute("aria-busy");
    // 구역 폴더는 전체 구역을 기준으로 그린다(고른 구역과 무관하게 개수를 보여 준다).
    renderFolders(source === "custom" ? sections : []);
    // 구역을 골랐으면 그 구역만 남긴다.
    if (source === "custom" && state.folder) {
      sections = sections.filter((sec) => sec.id === state.folder);
    }
    if (!sections.length) {
      box.innerHTML =
        source === "search"
          ? '<p class="mv-empty">검색어를 입력하세요.</p>'
          : '<p class="mv-empty">지금 방송 중인 채널이 없습니다.</p>';
      box.__rows = [];
      return;
    }
    const picked = new Set(state.chosen.map((c) => c.channelId));
    box.innerHTML = sections
      .map((section) => {
        const cards = section.rows.map((r) => card(r, picked)).join("");
        // 구역이 하나뿐이고 이름이 없으면(팔로잉·전체·검색) 머리말을 빼고 카드만 둔다.
        const head = section.label
          ? `<div class="mv-section-head">` +
            `<span class="mv-section-name">${esc(section.label)}</span>` +
            `<span class="mv-section-count">${fmt(section.rows.length)}</span>` +
            `</div>`
          : "";
        return `<section class="mv-section">${head}<div class="mv-cards">${cards}</div></section>`;
      })
      .join("");
    // 고르기 로직은 평평한 목록을 쓴다.
    box.__rows = sections.flatMap((s) => s.rows);
  }

  // 불러오는 동안 보여 줄 빈 카드. 실제 카드와 같은 모양이라 다 불러왔을 때
  // 자리가 밀리지 않는다.
  function skeletonCards(count = 8) {
    const one =
      '<div class="mv-card is-skeleton" aria-hidden="true">' +
      '<span class="mv-card-thumb"><span class="mv-skeleton-box"></span></span>' +
      '<span class="mv-card-body">' +
      '<span class="mv-skeleton-avatar"></span>' +
      '<span class="mv-card-text">' +
      '<span class="mv-skeleton-line"></span>' +
      '<span class="mv-skeleton-line is-short"></span>' +
      "</span></span></div>";
    return `<section class="mv-section"><div class="mv-cards">${one.repeat(count)}</div></section>`;
  }

  // 라이브 방송 카드(썸네일 + 프로필 + 제목 + 시청자 수).
  function card(r, picked) {
    const on = picked.has(r.channelId);
    const full = state.chosen.length >= MAX_CHANNELS && !on;
    // 방송 스냅샷이 없으면(응답에 따라 빈 경우가 있다) 채널 이미지로 대신 채운다.
    // 빈 상자만 남으면 카드가 깨져 보인다.
    const thumbUrl =
      safeImageUrl(r.liveImageUrl) ||
      safeImageUrl(thumb(r.channelImageUrl, "240"));
    return (
      `<button type="button" class="mv-card${on ? " is-on" : ""}" ` +
      `data-mv-pick="${esc(r.channelId)}"${full ? " disabled" : ""}>` +
      `<span class="mv-card-thumb${r.liveImageUrl ? "" : " is-fallback"}">` +
      (thumbUrl
        ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy">`
        : `<span class="mv-card-thumb-empty"></span>`) +
      `<span class="mv-card-viewers">${fmt(r.viewers)}명</span>` +
      // 성인 방송 표시. 치지직의 기존 인증 흐름을 그대로 쓰고 여기서는 알리기만 한다.
      (r.adult ? `<span class="mv-card-adult">19+</span>` : "") +
      (on ? `<span class="mv-card-picked">선택됨</span>` : "") +
      `</span>` +
      `<span class="mv-card-body">` +
      `<img class="mv-card-avatar" src="${esc(safeImageUrl(thumb(r.channelImageUrl)))}" alt="" loading="lazy">` +
      `<span class="mv-card-text">` +
      `<span class="mv-card-title">${esc(r.liveTitle || "제목 없음")}</span>` +
      `<span class="mv-card-name">${esc(r.channelName)}</span>` +
      (r.category
        ? `<span class="mv-card-category">${esc(r.category)}</span>`
        : "") +
      `</span></span></button>`
    );
  }

  // ── 고른 채널 ──────────────────────────────────────────────────────────
  function renderChosen() {
    const list = $("mvChosenList");
    $("mvChosenCount").textContent = `${state.chosen.length} / ${MAX_CHANNELS}`;
    list.innerHTML = state.chosen
      .map(
        (c, i) =>
          `<li class="mv-chosen-item" draggable="true" data-mv-chosen="${esc(c.channelId)}">` +
          `<span class="mv-chosen-rank">${i === 0 ? "메인" : i}</span>` +
          `<img src="${esc(safeImageUrl(thumb(c.channelImageUrl)))}" alt="" loading="lazy">` +
          `<span class="mv-chosen-name">${esc(c.channelName)}</span>` +
          `<button type="button" class="mv-chosen-remove" data-mv-remove="${esc(c.channelId)}" ` +
          `aria-label="${esc(c.channelName)} 빼기">×</button></li>`,
      )
      .join("");
    renderLayouts();
    $("mvStart").disabled = state.chosen.length < 2;
  }

  function renderLayouts() {
    const box = $("mvLayoutGrid");
    const list = LAYOUTS.layoutsFor(state.chosen.length);
    if (!list.length) {
      box.innerHTML =
        '<p class="mv-hint">채널을 2개 이상 고르면 배치를 정할 수 있습니다.</p>';
      state.layoutId = "";
      return;
    }
    if (!list.some((l) => l.id === state.layoutId)) state.layoutId = list[0].id;
    box.innerHTML = list
      .map((l) => {
        // ⚠ 미리보기도 시청 화면과 같은 트랙 계산을 써야 한다. l.columns 를 그대로
        //   쓰면 '오른쪽 1' 이 3:1 로 보이지만 실제로는 모든 칸을 16:9 로 맞추느라
        //   1:1 이 되어, 고르기 전후의 모양이 달라진다.
        const tracks = LAYOUTS.solveTracks(l);
        const columns = tracks ? tracks.columns : l.columns;
        const rows = tracks ? tracks.rows : l.rows;
        return (
          `<button type="button" class="mv-layout${l.id === state.layoutId ? " is-on" : ""}" ` +
          `data-mv-layout="${esc(l.id)}" role="radio" ` +
          `aria-checked="${l.id === state.layoutId}">` +
          `<span class="mv-layout-preview" style="grid-template-columns:${esc(columns)};` +
          `grid-template-rows:${esc(rows)};` +
          `aspect-ratio:${tracks ? esc(String(tracks.ratio)) : "16/9"};` +
          `grid-template-areas:${esc(l.areas.join(" "))}">` +
          LAYOUTS.SLOTS.slice(0, l.aux + 1)
            .map(
              (s) =>
                `<i style="grid-area:${s}"${s === "m" ? ' class="is-main"' : ""}></i>`,
            )
            .join("") +
          `</span><span class="mv-layout-label">${esc(l.label)}</span></button>`
        );
      })
      .join("");
  }

  function pick(channelId) {
    const rows = $("mvChannelList").__rows || [];
    const row = rows.find((r) => r.channelId === channelId);
    if (!row) return;
    const at = state.chosen.findIndex((c) => c.channelId === channelId);
    if (at >= 0) state.chosen.splice(at, 1);
    else if (state.chosen.length < MAX_CHANNELS) state.chosen.push(row);
    renderChosen();
    syncPicked();
  }

  // 고른 표시만 제자리에서 갱신한다.
  //
  // ⚠ 예전에는 고를 때마다 renderList() 를 다시 불렀다. 그러면 목록을 통째로 다시
  //   그리고 API 까지 다시 타서, 고르고 해제할 때마다 화면이 깜빡였다. 선택 여부는
  //   카드의 표시 상태일 뿐이므로 클래스·속성만 바꾼다.
  function syncPicked() {
    const picked = new Set(state.chosen.map((c) => c.channelId));
    const full = state.chosen.length >= MAX_CHANNELS;
    for (const card of document.querySelectorAll("#mvChannelList .mv-card")) {
      const id = card.dataset.mvPick;
      if (!id) continue;
      const on = picked.has(id);
      card.classList.toggle("is-on", on);
      card.disabled = full && !on;
      const mark = card.querySelector(".mv-card-picked");
      if (on && !mark) {
        const span = document.createElement("span");
        span.className = "mv-card-picked";
        span.textContent = "선택됨";
        card.querySelector(".mv-card-thumb")?.appendChild(span);
      } else if (!on && mark) {
        mark.remove();
      }
    }
  }

  // ── 실행 ───────────────────────────────────────────────────────────────
  // 고른 구성을 세션 저장소로 넘기고 시청 화면을 새 탭에서 연다. 주소에 담기엔
  // 채널 목록이 길어 세션 저장소를 쓴다.
  async function start() {
    const layout = LAYOUTS.layoutById(state.layoutId);
    if (!layout || state.chosen.length < 2) return;
    const { side } = LAYOUTS.stageStyle(layout, state.chatSide);
    const setup = {
      chosen: state.chosen,
      layoutId: state.layoutId,
      chatSide: side,
      mainHighQuality: state.mainHighQuality,
    };
    // 기존 멀티뷰를 고치는 중이면 그 id 를 이어 쓰고, 새로 시작하면 새 id 를 만든다.
    const handoffId = state.handoffId || newHandoffId();
    try {
      await chrome.storage.session.set({
        [`${HANDOFF_PREFIX}:${handoffId}`]: setup,
      });
    } catch (error) {
      alert("시청 화면으로 넘기지 못했습니다: " + (error?.message || error));
      return;
    }
    const url = new URL(chrome.runtime.getURL(WATCH_PAGE));
    url.searchParams.set("setup", handoffId);
    const href = url.toString();
    if (chrome.tabs?.create) chrome.tabs.create({ url: href });
    else window.open(href, "_blank", "noopener");
  }

  // ── 이벤트 ─────────────────────────────────────────────────────────────
  document.addEventListener("click", (event) => {
    const folder = event.target.closest?.("[data-mv-folder]");
    if (folder) {
      state.folder = folder.dataset.mvFolder;
      void renderList();
      return;
    }
    const source = event.target.closest?.("[data-mv-source]");
    if (source) {
      state.source = source.dataset.mvSource;
      state.folder = ""; // 탭을 바꾸면 구역 선택을 푼다
      $("mvFolders").hidden = state.source !== "custom";
      for (const b of document.querySelectorAll("[data-mv-source]")) {
        b.setAttribute("aria-pressed", String(b === source));
      }
      $("mvSearch").hidden = state.source !== "search";
      void renderList();
      return;
    }
    const remove = event.target.closest?.("[data-mv-remove]");
    if (remove) {
      state.chosen = state.chosen.filter(
        (c) => c.channelId !== remove.dataset.mvRemove,
      );
      renderChosen();
      syncPicked(); // 목록을 다시 그리지 않는다(깜빡임 방지)
      return;
    }
    const channel = event.target.closest?.("[data-mv-pick]");
    if (channel) {
      pick(channel.dataset.mvPick);
      return;
    }
    const layout = event.target.closest?.("[data-mv-layout]");
    if (layout) {
      state.layoutId = layout.dataset.mvLayout;
      renderLayouts();
      return;
    }
    if (event.target.closest?.("#mvStart")) void start();
  });

  let searchTimer = 0;
  $("mvSearch")?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void renderList(), 300);
  });

  $("mvMainHighQuality")?.addEventListener("change", (event) => {
    state.mainHighQuality = event.target.checked;
  });

  // 고른 채널 순서 바꾸기(맨 위가 메인).
  let dragId = "";
  document.addEventListener("dragstart", (event) => {
    const item = event.target.closest?.("[data-mv-chosen]");
    if (!item) return;
    dragId = item.dataset.mvChosen;
    event.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", (event) => {
    if (!dragId || !event.target.closest?.("#mvChosenList")) return;
    event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    const target = event.target.closest?.("[data-mv-chosen]");
    if (!dragId || !target) return;
    event.preventDefault();
    const from = state.chosen.findIndex((c) => c.channelId === dragId);
    const to = state.chosen.findIndex(
      (c) => c.channelId === target.dataset.mvChosen,
    );
    dragId = "";
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = state.chosen.splice(from, 1);
    state.chosen.splice(to, 0, moved);
    // 순서만 바뀐다. 목록은 그대로 두어 깜빡이지 않게 한다.
    renderChosen();
  });
  // ⚠ 엉뚱한 곳에 놓거나 취소해도 여기로는 반드시 온다. 여기서 비우지 않으면
  //   다음 클릭이 이전 드래그 상태로 처리될 수 있다.
  document.addEventListener("dragend", () => {
    dragId = "";
  });

  // 시작
  (async () => {
    // '채널 다시 고르기' 로 돌아온 경우: 주소의 setup id 로 이전 구성을 복원한다.
    const handoffId = new URLSearchParams(location.search).get("setup") || "";
    if (/^[A-Za-z0-9-]{1,64}$/.test(handoffId)) {
      state.handoffId = handoffId;
      try {
        const key = `${HANDOFF_PREFIX}:${handoffId}`;
        const stored = (await chrome.storage.session.get(key))?.[key];
        const chosen = (Array.isArray(stored?.chosen) ? stored.chosen : [])
          .filter((c) => c && HASH_RE.test(String(c.channelId || "")))
          .slice(0, MAX_CHANNELS);
        if (chosen.length) {
          state.chosen = chosen;
          if (stored.layoutId) state.layoutId = String(stored.layoutId);
          if (stored.chatSide) state.chatSide = String(stored.chatSide);
          state.mainHighQuality = stored.mainHighQuality !== false;
          const box = $("mvMainHighQuality");
          if (box) box.checked = state.mainHighQuality;
        }
      } catch {}
    }
    document
      .querySelector('[data-mv-source="following"]')
      ?.setAttribute("aria-pressed", "true");
    renderChosen();
    await renderList();
  })();
})();
