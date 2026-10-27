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
  // 고를 수 있는 최대 채널 수: 기본 9, 10칸 이상 내 배치가 있으면 그 칸 수까지(16 한도).
  const maxChannels = () => LAYOUTS.maxChannels();
  // 목록 캐시 수명. 제목·시청자 수·방송 여부가 바뀌므로 오래 들고 있으면 안 된다.
  // 검색은 입력마다 달라지므로 캐시하지 않는다.
  const LIST_TTL_MS = 20000;
  const LIVE_LOAD_THRESHOLD_PX = 400;
  const SETUP_SORT_STORAGE_KEY = "cheeseMultiviewSetupSortBySource";
  const REMEMBER_SETUP_SORT_KEY = "cheeseMultiviewRememberSetupSort";
  // 시청 화면에서 마지막으로 고른 채팅 자리(multiviewWatch.js 가 저장한다). 시작할 때 그 배치에서 되면 쓴다.
  const CHAT_SIDE_PREF_KEY = "cheeseMultiviewChatSide";
  let chatSidePref = "";
  // 내 배치(사용자가 만든 배치). multiviewLayouts.js normalizeCustomLayout 모양의 목록.
  const CUSTOM_LAYOUTS_KEY = "cheeseMultiviewCustomLayouts";
  let customLayouts = [];
  function applyCustomLayouts(list) {
    customLayouts = (Array.isArray(list) ? list : []).map(LAYOUTS.normalizeCustomLayout).filter(Boolean)
      .slice(0, LAYOUTS.CUSTOM_MAX);
    LAYOUTS.setCustomLayouts(customLayouts, { keepId: state.layoutId });
    if (typeof syncCustomManageButton === "function") syncCustomManageButton();
  }
  // 기본 배치 설정(사용/숨김·채널 수별 기본 배치). 모양은 multiviewLayouts normalizeLayoutPrefs.
  const LAYOUT_PREFS_KEY = LAYOUTS.LAYOUT_PREFS_KEY;
  function applyLayoutPrefs(raw) {
    LAYOUTS.setLayoutPrefs(raw);
    if ($("mvLayoutGrid")) renderLayouts();
    if (typeof renderLayoutPrefs === "function" && $("mvLayoutPrefsDialog")?.open) renderLayoutPrefs();
  }
  const SETUP_OPTIONS_STORAGE_KEY = "cheeseMultiviewSetupOptions";
  const CHAT_SIZE_STORAGE_KEY = "cheeseMultiviewChatSize";
  // 고른 구성을 시청 화면으로 넘길 때 쓰는 세션 저장소 키의 앞부분.
  // ⚠ 탭마다 다른 id 를 붙인다. 고정 키를 쓰면 멀티뷰를 두 탭에서 열었을 때
  //   서로 구성을 덮어쓴다.
  const HANDOFF_PREFIX = "cheeseMultiviewSetup";
  const HASH_RE = /^[0-9a-f]{32}$/i;
  const SLOT_RE = /^(?:[0-9a-f]{32}|video:\d+)$/i;

  const $ = (id) => document.getElementById(id);
  // 전용 팔로잉에서 지금 보고 있는 구역(빈 문자열이면 전체).
  const state = {
    handoffId: "",
    folder: "",
    source: "following",
    chosen: [], // [{channelId, channelName, channelImageUrl, liveTitle, viewers}]
    layoutId: "",
    chatSide: "",
    mainHighQuality: false,
    startWithoutChat: false,
    startMainMuted: false,
    startMainVolume: 1,
    listCache: new Map(),
    livePager: null,
    searchPager: null,
    searchKeyword: "",
    searchPagerKey: "",
    // 검색 탭: "channel"(채널·태그) | "title"(방송 제목) | "category"(카테고리 이름으로 찾기)
    searchMode: "channel",
    // 카테고리·태그 필터({ kind, ... } — multiviewSources.normalizeSearchFilter). 있으면 그 라이브를 보인다.
    searchFilter: null,
    videoSource: "following",
    videoChannel: null,
    videoPagers: new Map(),
    videoSearchPager: null,
    videoSearchKeyword: "",
    videoRerankPager: null,
    videoRerankKeyword: "",
    currentSections: [],
    sortBySource: { following: "viewers", custom: "custom", all: "viewers", search: "viewers" },
    videoChannelView: "search",
  };
  let rememberSetupSort = true;

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

  function normalizeStartMainVolume(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 1;
    return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
  }

  function paintStartMainVolume() {
    const percent = Math.round(state.startMainVolume * 100);
    const range = $("mvStartMainVolumeRange");
    const number = $("mvStartMainVolumeNumber");
    if (range) range.value = String(percent);
    if (number) number.value = String(percent);
  }

  function setStartMainVolumePercent(value) {
    if (typeof value === "string" && value.trim() === "") return false;
    const percent = Number(value);
    if (!Number.isFinite(percent)) return false;
    state.startMainVolume = Math.round(Math.min(100, Math.max(0, percent))) / 100;
    paintStartMainVolume();
    return true;
  }

  function syncStartMainVolumeVisibility() {
    const control = $("mvStartMainVolumeControl");
    if (control) control.hidden = state.startMainMuted;
  }

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

  // ⚠ 확장 페이지에서 치지직 API 를 직접 fetch 하면 Origin 이 chrome-extension://
  //   으로 붙어 403 "Invalid CORS request" 가 돌아온다(팔로잉·전체·검색 모두).
  //   서비스 워커의 fetch 는 Origin 을 붙이지 않으므로 배경 스크립트에 중계시킨다.

  // ── 채널 목록 ──────────────────────────────────────────────────────────
  // 채널 목록은 공용 로더를 쓴다(주소·응답 해석을 고르기/시청 두 곳에 두지 않는다).
  const SOURCES = globalThis.CheeseMultiviewSources;
  const videoRerankControls = globalThis.CheeseMultiviewVideoSearchControls.attach(
    $("mvVideoRerankControls"),
    "setup",
    onSetupVideoRerankChange,
  );
  const sortPicker = globalThis.CheeseMultiviewSort.attach("mvSort");
  const getJson = (url) => SOURCES.getJson(url);
  const normalize = (channel, live) => SOURCES.normalize(channel, live);
  const loadFollowing = (sortType) => SOURCES.loadFollowing(sortType);

  // 전용 팔로잉: 사이드바와 같은 구분(즐겨찾기 → 각 그룹 → 나머지 팔로잉)으로
  // 나눠 돌려준다. 라이브 정보는 팔로잉 목록에서 가져오므로 방송 중인 채널만 남는다.
  //
  // ⚠ 선호도(affinity) 구역은 넣지 않는다. 시청 이력 지표를 따로 모아 점수를
  //   매기는 별도 계산이라 이 화면에서 재현할 수 없다.
  // 전용 팔로잉 구역은 공용 로더가 맡는다(Quick 패널과 같은 목록을 보게 한다).
  const loadCustomSections = (sortType) => SOURCES.loadCustomSections(sortType);

  function restoreSortBySource(saved) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
    for (const source of Object.keys(state.sortBySource)) {
      const mode = saved[source];
      if (SOURCES.SORT_OPTIONS.some((option) => option.id === mode)) {
        state.sortBySource[source] = mode;
      }
    }
  }

  function saveSortBySource() {
    if (!rememberSetupSort || !chrome.storage?.local) return;
    void chrome.storage.local
      .set({ [SETUP_SORT_STORAGE_KEY]: { ...state.sortBySource } })
      .catch(() => {});
  }

  let setupOptionsSaveTimer = 0;
  function saveSetupOptions() {
    clearTimeout(setupOptionsSaveTimer);
    setupOptionsSaveTimer = 0;
    if (!chrome.storage?.local) return;
    void chrome.storage.local
      .set({
        [SETUP_OPTIONS_STORAGE_KEY]: {
          mainHighQuality: state.mainHighQuality,
          startWithoutChat: state.startWithoutChat,
          startMainMuted: state.startMainMuted,
          // ⚠ 예전에는 시작 음량을 빼고 저장해, 다음에 열면 늘 100% 로 돌아왔다.
          startMainVolume: state.startMainVolume,
        },
      })
      .catch(() => {});
  }

  // 슬라이더를 끄는 동안 input 이 연달아 온다. 저장은 묶어서 한 번 한다.
  function scheduleSetupOptionsSave() {
    clearTimeout(setupOptionsSaveTimer);
    setupOptionsSaveTimer = window.setTimeout(saveSetupOptions, 300);
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[LAYOUT_PREFS_KEY]) applyLayoutPrefs(changes[LAYOUT_PREFS_KEY].newValue);
  });
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[CUSTOM_LAYOUTS_KEY]) {
      applyCustomLayouts(changes[CUSTOM_LAYOUTS_KEY].newValue);
      // 고를 수 있는 채널 수(내 배치 칸 수)가 바뀌었을 수 있다.
      renderChosen();
      syncPicked();
    }
  });
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes[REMEMBER_SETUP_SORT_KEY]) return;
    rememberSetupSort = changes[REMEMBER_SETUP_SORT_KEY].newValue !== false;
    if (!rememberSetupSort) {
      void chrome.storage.local
        .remove?.(SETUP_SORT_STORAGE_KEY)
        .catch(() => {});
    }
  });

  function setupLivePager() {
    const sortType = SOURCES.serverSortType("all", state.sortBySource.all);
    if (!state.livePager || state.livePager.sortType !== sortType) {
      state.livePager = SOURCES.createLivePager({ ttlMs: LIST_TTL_MS, sortType });
    }
    return state.livePager;
  }

  // 검색 탭의 목록: 필터가 있으면 그 카테고리·태그 라이브, 아니면 검색 종류에 따라
  // 채널·태그 검색 또는 카테고리 목록. 셋 다 같은 pager 모양이라 그리기·더 불러오기는 그대로다.
  function setupSearchPager(keyword) {
    const query = String(keyword || "").trim();
    const key = state.searchFilter
      ? `filter:${SOURCES.searchFilterKey(state.searchFilter)}`
      : `${state.searchMode}:${query}`;
    if (!state.searchPager || state.searchPagerKey !== key) {
      state.searchPagerKey = key;
      state.searchKeyword = query;
      state.searchPager = state.searchFilter
        ? SOURCES.createFilterPager(state.searchFilter)
        : state.searchMode === "category"
          ? SOURCES.createCategorySearchPager(query)
          : state.searchMode === "title"
            ? SOURCES.createTitleSearchPager(query)
            : SOURCES.createSearchPager(query);
    }
    return state.searchPager;
  }

  const SEARCH_MODES = new Set(["channel", "title", "category"]);
  const SEARCH_PLACEHOLDERS = { channel: "채널 이름 또는 태그로 찾기", title: "방송 제목으로 찾기", category: "카테고리 이름으로 찾기" };
  const isCategoryListView = () => state.source === "search" && !state.searchFilter && state.searchMode === "category";

  // 검색 종류 전환·필터 표시·검색창 안내를 지금 상태에 맞춘다.
  function syncSearchTools(source = state.source) {
    const search = source === "search";
    const modeBox = $("mvSearchMode");
    if (modeBox) {
      modeBox.hidden = !search;
      for (const button of modeBox.querySelectorAll("[data-mv-search-mode]"))
        button.setAttribute("aria-pressed", String(button.dataset.mvSearchMode === state.searchMode));
    }
    const input = $("mvSearch");
    if (input) {
      input.hidden = !search;
      input.placeholder = SEARCH_PLACEHOLDERS[state.searchMode] || SEARCH_PLACEHOLDERS.channel;
    }
    const pill = $("mvSearchFilter");
    if (pill) {
      const html = search && state.searchFilter ? SOURCES.searchFilterPillHtml(state.searchFilter, esc) : "";
      pill.hidden = !html;
      if (pill.innerHTML !== html) pill.innerHTML = html;
    }
  }

  // 카드의 카테고리·태그 칩, 카테고리 카드 → 검색 탭에서 그 라이브를 본다.
  function applySearchFilter(filter) {
    const next = SOURCES.normalizeSearchFilter(filter);
    if (!next) return;
    state.searchFilter = next;
    // 검색 종류 버튼도 필터에 맞춘다(태그 → 채널·태그, 카테고리 → 카테고리).
    state.searchMode = next.kind === "category" ? "category" : "channel";
    state.source = "search";
    state.folder = "";
    $("mvFolders").hidden = true;
    for (const b of document.querySelectorAll("[data-mv-source]"))
      b.setAttribute("aria-pressed", String(b.dataset.mvSource === "search"));
    $("mvChannelList").scrollTop = 0;
    void renderList();
  }

  function setupVideoPager() {
    if (state.videoChannel) {
      const key = `channel:${state.videoChannel.channelId}`;
      if (!state.videoPagers.has(key)) {
        state.videoPagers.set(key, SOURCES.createChannelVideoPager(state.videoChannel));
      }
      return state.videoPagers.get(key);
    }
    const key = state.videoSource;
    if (!state.videoPagers.has(key)) {
      const pager = key === "following"
        ? SOURCES.createFollowingVideoPager()
        : key === "favorites"
          ? SOURCES.createVideoVaultFavoritesPager()
          : SOURCES.createAllVideoPager(key === "latest" ? "LATEST" : "POPULAR");
      state.videoPagers.set(key, pager);
    }
    return state.videoPagers.get(key);
  }

  function setupVideoSearchPager(keyword) {
    const query = String(keyword || "").trim();
    if (!state.videoSearchPager || state.videoSearchKeyword !== query) {
      state.videoSearchKeyword = query;
      state.videoSearchPager = SOURCES.createChannelSearchPager(query);
    }
    return state.videoSearchPager;
  }

  function setupVideoRerankPager(keyword) {
    const query = String(keyword || "").trim();
    if (!state.videoRerankPager || state.videoRerankKeyword !== query) {
      state.videoRerankKeyword = query;
      state.videoRerankPager = SOURCES.createVideoSearchPager(query);
      videoRerankControls.setPager(state.videoRerankPager);
    }
    return state.videoRerankPager;
  }

  function videoSearchKeyword() {
    return state.videoSource === "channel-search"
      ? $("mvVideoChannelSearchInput").value
      : state.videoSource === "platter-search"
        ? $("mvVideoRerankSearchInput").value
        : $("mvSearch").value;
  }

  function isVideoChannelSearchView() {
    return state.videoSource === "channel-search" &&
      (!state.videoChannel || state.videoChannelView === "search");
  }

  async function listFor(source, keyword = "") {
    if (source === "videos") {
      if (isVideoChannelSearchView()) {
        const pager = setupVideoSearchPager(keyword);
        await pager.loadFirst();
        if (pager.error && !pager.rows.length) throw pager.error;
        return pager.rows.length ? [{ id: source, label: "", rows: pager.rows }] : [];
      }
      if (state.videoChannel) {
        const pager = setupVideoPager();
        await pager.loadFirst();
        if (pager.error && !pager.rows.length) throw pager.error;
        return pager.rows.length ? [{ id: source, label: "", rows: pager.rows }] : [];
      }
      if (state.videoSource === "platter-search") {
        const pager = setupVideoRerankPager(keyword);
        await pager.loadFirst();
        if (pager.error && !pager.rows.length) throw pager.error;
        return pager.rows.length ? [{ id: source, label: "", rows: pager.rows }] : [];
      }
      const pager = setupVideoPager();
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows.length ? [{ id: source, label: "", rows: pager.rows }] : [];
    }
    const sortType = SOURCES.serverSortType(source, state.sortBySource[source]);
    const key = source === "search" ? `search:${keyword}`
      : source === "following" || source === "custom" ? `${source}:${sortType}` : source;
    // 전체 라이브는 pager 자체가 rows/cursor/done/TTL을 함께 보관한다. 첫 페이지
    // 배열만 listCache에 따로 넣으면 탭을 다시 열 때 이미 붙인 다음 페이지가
    // 사라지므로 이 source는 pager를 유일한 캐시로 사용한다.
    if (source === "all") {
      const pager = setupLivePager();
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows.length ? [{ id: source, label: "", rows: pager.rows }] : [];
    }
    if (source === "search") {
      const pager = setupSearchPager(keyword);
      await pager.loadFirst();
      if (pager.error && !pager.rows.length) throw pager.error;
      return pager.rows.length ? [{ id: source, label: "", rows: pager.rows }] : [];
    }
    const cached = state.listCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let sections;
    if (source === "custom") {
      sections = await loadCustomSections(sortType);
    } else {
      const rows =
        source === "following"
          ? await loadFollowing(sortType)
          : [];
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

  function paintList(source = state.source, keyword = source === "videos" ? videoSearchKeyword() : $("mvSearch").value) {
    const box = $("mvChannelList");
    let sections = state.currentSections;
    const isVideoList = source === "videos";
    const isChannelSearch = isVideoList && isVideoChannelSearchView();
    const isRerankSearch = isVideoList && !state.videoChannel && state.videoSource === "platter-search";
    renderFolders(source === "custom" ? sections : []);
    $("mvVideoSources").hidden = !isVideoList;
    for (const button of document.querySelectorAll("[data-mv-video-source]")) {
      const selected = button.dataset.mvVideoSource === state.videoSource &&
        (button.dataset.mvVideoSource !== "channel-search" || state.videoChannelView === "search");
      button.setAttribute("aria-pressed", String(selected));
    }
    const backToChannels = document.querySelector("[data-mv-video-channel-back]");
    if (backToChannels) {
      backToChannels.hidden = state.videoSource !== "channel-search" || !state.videoChannel;
      backToChannels.setAttribute("aria-pressed", String(
        state.videoSource === "channel-search" && Boolean(state.videoChannel) && state.videoChannelView === "selected",
      ));
    }
    syncSearchTools(source);
    $("mvVideoChannelSearch").hidden = !isChannelSearch;
    $("mvVideoRerankSearch").hidden = !isRerankSearch;
    videoRerankControls.setPager(isRerankSearch ? state.videoRerankPager : null);
    box.hidden = isChannelSearch;
    const sort = $("mvSort");
    const categoryList = source === "search" && isCategoryListView();
    $("mvSort").closest(".mv-sort-row").hidden = isVideoList || categoryList;
    const hasCustom = source === "custom" && SOURCES.hasCustomOrder(sections, state.folder);
    if (!sort.options.length) {
      sort.innerHTML = SOURCES.SORT_OPTIONS.map((option) =>
        `<option value="${option.id}">${option.label}</option>`).join("");
    }
    const custom = sort.querySelector('[value="custom"]');
    custom.hidden = !hasCustom;
    custom.disabled = !hasCustom;
    const oldest = sort.querySelector('[value="oldest"]');
    oldest.textContent = source === "all" ? "오래된순 (불러온 방송)" : "오래된순";
    // 카테고리 목록은 이름이 맞는 순서(받은 순서) 그대로 둔다.
    const mode = isVideoList || categoryList
      ? "custom"
      : state.sortBySource[source] === "custom" && !hasCustom
      ? "viewers" : state.sortBySource[source] || "viewers";
    sort.value = mode;
    sort.disabled = false;
    sortPicker.sync();
    if (isChannelSearch) {
      renderVideoChannelSuggestions(setupVideoSearchPager(keyword), keyword);
      box.innerHTML = "";
      box.__rows = [];
      return;
    }
    if (source === "custom" && state.folder) {
      sections = sections.filter((section) => section.id === state.folder);
    }
    sections = SOURCES.sortSections(sections, mode,
      isVideoList || categoryList ||
      source === "all" || source === "following" ||
      (source === "custom" && (mode === "recent" || mode === "oldest")));
    if (!sections.length) {
      box.innerHTML = isVideoList
        ? `<p class="mv-empty">${esc(videoEmptyMessage(isChannelSearch, keyword))}</p>`
        : source === "search"
        ? `<p class="mv-empty">${esc(searchEmptyMessage(keyword))}</p>`
        : '<p class="mv-empty">지금 방송 중인 채널이 없습니다.</p>';
      box.__rows = [];
      if (isVideoList) requestAnimationFrame(maybeLoadMorePaged);
      return;
    }
    const picked = new Set(state.chosen.map((c) => c.channelId));
    box.innerHTML = sections.map((section) => {
      const cards = section.rows.map((row) => row.mediaType === "channel"
        ? videoChannelCard(row)
        : row.mediaType === "category"
          ? SOURCES.categoryCardHtml(row, esc)
          : card(row, picked)).join("");
      const head = section.label
        ? `<div class="mv-section-head"><span class="mv-section-name">${esc(section.label)}</span>` +
          `<span class="mv-section-count">${fmt(section.rows.length)}</span></div>`
        : "";
      return `<section class="mv-section">${head}<div class="mv-cards${categoryList ? " is-categories" : ""}">${cards}</div></section>`;
    }).join("");
    box.__rows = sections.flatMap((section) => section.rows);
    if (source === "all" || source === "search" || isVideoList) {
      const pager = source === "all" ? state.livePager
        : source === "search" ? state.searchPager
        : isRerankSearch ? setupVideoRerankPager(keyword)
          : setupVideoPager();
      if (pager?.error) setPagedLoading(source, false, true);
      else requestAnimationFrame(maybeLoadMorePaged);
    }
  }

  function searchEmptyMessage(keyword) {
    const filter = state.searchFilter;
    if (filter) return filter.kind === "category" ? "이 카테고리로 지금 방송 중인 채널이 없습니다." : "이 태그로 지금 방송 중인 채널이 없습니다.";
    if (state.searchMode === "category") return keyword.trim() ? "찾는 카테고리가 없습니다." : "카테고리 이름으로 찾아보세요.";
    if (state.searchMode === "title") return keyword.trim() ? "제목에 검색어가 든 방송이 없습니다." : "방송 제목으로 찾아보세요.";
    return keyword.trim() ? "찾는 채널이나 태그의 방송이 없습니다." : "채널 이름 또는 태그로 찾아보세요.";
  }

  function videoEmptyMessage(channelSearch, keyword) {
    if (channelSearch) return keyword.trim() ? "다시보기를 찾을 채널이 없습니다." : "채널명을 검색해 다시보기를 찾아보세요.";
    if (state.videoSource === "platter-search") return keyword.trim() ? "다시보기 검색 결과가 없습니다." : "검색어를 입력해 다시보기를 찾아보세요.";
    if (state.videoChannel) return "채널에 공개된 다시보기가 없습니다.";
    if (state.videoSource === "favorites") return "보관함에 즐겨찾기한 다시보기가 없습니다.";
    if (state.videoSource === "following") return "팔로잉 채널의 다시보기가 없습니다.";
    return "다시보기를 불러오지 못했습니다.";
  }

  function videoChannelCard(channel) {
    return `<button type="button" class="mv-video-channel-option" role="option" data-mv-video-channel="${esc(channel.channelId)}">` +
      SOURCES.profileImg(channel.channelImageUrl) +
      `<span class="mv-video-channel-option-name">${esc(channel.channelName || "채널")}</span>` +
      (CheeseVerifiedMark.kind(channel) ? `<span class="mv-card-verified" data-cheese-mark="${CheeseVerifiedMark.kind(channel)}" role="img" aria-label="${CheeseVerifiedMark.label(CheeseVerifiedMark.kind(channel))} 채널"></span>` : "") +
      `</button>`;
  }

  function renderVideoChannelSuggestions(pager, keyword) {
    const input = $("mvVideoChannelSearchInput");
    const popover = $("mvVideoChannelPopover");
    const query = String(keyword || "").trim();
    const visible = Boolean(query) && isVideoChannelSearchView();
    input.setAttribute("aria-expanded", String(visible));
    popover.hidden = !visible;
    if (!visible) {
      popover.innerHTML = "";
      return;
    }
    if (pager?.loading && !pager.rows.length) {
      popover.innerHTML = '<div class="mv-video-channel-empty" aria-busy="true">채널을 찾는 중…</div>';
      return;
    }
    if (pager?.error && !pager.rows.length) {
      popover.innerHTML = `<div class="mv-video-channel-empty">채널을 불러오지 못했습니다. (${esc(pager.error.message || "요청 실패")})</div>`;
      return;
    }
    if (!pager?.rows.length) {
      popover.innerHTML = '<div class="mv-video-channel-empty">검색된 채널이 없습니다.</div>';
      return;
    }
    popover.innerHTML = pager.rows.map(videoChannelCard).join("") +
      (pager.error ? '<button type="button" class="mv-video-channel-more" data-mv-paged-retry="videos">다음 채널 다시 불러오기</button>' :
        pager.loading ? '<div class="mv-video-channel-empty">더 불러오는 중…</div>' : "");
  }

  async function renderList() {
    const requestId = ++listRequestId;
    // 요청 시점의 값을 붙잡는다(기다리는 동안 사용자가 탭·검색어를 바꿀 수 있다).
    const source = state.source;
    const keyword = source === "videos" ? videoSearchKeyword() : $("mvSearch").value;
    const box = $("mvChannelList");
    const channelSearch = source === "videos" && isVideoChannelSearchView();
    box.hidden = channelSearch;
    box.setAttribute("aria-busy", "true");
    box.innerHTML = skeletonCards(8, source);
    if (channelSearch) {
      const query = keyword.trim();
      const popover = $("mvVideoChannelPopover");
      popover.hidden = !query;
      popover.innerHTML = query ? '<div class="mv-video-channel-empty" aria-busy="true">채널을 찾는 중…</div>' : "";
      $("mvVideoChannelSearchInput").setAttribute("aria-expanded", String(Boolean(query)));
    }
    $("mvSort").disabled = true;
    sortPicker.sync();
    let sections = [];
    try {
      sections = await listFor(source, keyword);
    } catch (error) {
      if (requestId !== listRequestId) return;
      box.removeAttribute("aria-busy");
      const loginRequired = (source === "following" || source === "custom" ||
        (source === "videos" && state.videoSource === "following")) &&
        SOURCES.isLoginRequiredError(error);
      box.innerHTML = loginRequired
        ? '<p class="mv-empty">팔로잉 목록을 보려면 치지직에 로그인해 주세요.</p>'
        : `<p class="mv-empty">목록을 불러오지 못했습니다. (${esc(error.message)})</p>`;
      if (channelSearch) renderVideoChannelSuggestions(setupVideoSearchPager(keyword), keyword);
      $("mvSort").disabled = false;
      sortPicker.sync();
      return;
    }
    if (requestId !== listRequestId) return; // 더 최신 요청이 있다 → 버린다
    box.removeAttribute("aria-busy");
    state.currentSections = sections;
    paintList(source, keyword);
  }

  // 불러오는 동안 보여 줄 빈 카드. 실제 카드와 같은 모양이라 다 불러왔을 때
  // 자리가 밀리지 않는다.
  function skeletonCards(count = 8, source = "") {
    const customFollowing = source === "custom";
    const one = customFollowing
      ? '<div class="mv-card is-skeleton is-custom-following-skeleton" aria-hidden="true">' +
        '<span class="mv-card-thumb"></span>' +
        '<span class="mv-card-body">' +
        '<span class="mv-card-avatar"></span>' +
        '<span class="mv-card-text">' +
        '<span class="mv-skeleton-line"></span>' +
        '<span class="mv-skeleton-line is-short"></span>' +
        "</span></span></div>"
      : '<div class="mv-card is-skeleton" aria-hidden="true">' +
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
    const full = state.chosen.length >= maxChannels() && !on;
    const tags = Array.isArray(r.tags) ? r.tags : [];
    const isVideo = r.mediaType === "video";
    const watchTimelinePercent = isVideo ? SOURCES.getWatchTimelinePercent(r) : null;
    // 방송 스냅샷이 없으면(응답에 따라 빈 경우가 있다) 채널 이미지로 대신 채운다.
    // 빈 상자만 남으면 카드가 깨져 보인다.
    const thumbUrl =
      safeImageUrl(r.liveImageUrl) ||
      safeImageUrl(SOURCES.profileThumb(r.channelImageUrl, 240));
    return (
      `<button type="button" class="mv-card${on ? " is-on" : ""}${full ? " is-limit" : ""}" ` +
      `data-mv-pick="${esc(r.channelId)}"${full ? " disabled" : ""}>` +
      `<span class="mv-card-thumb${r.liveImageUrl ? "" : " is-fallback"}${r.adult ? " is-adult" : ""}">` +
      (thumbUrl
        ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy">`
        : `<span class="mv-card-thumb-empty"></span>`) +
      (isVideo
        ? `<span class="mv-card-badge-row${on ? " has-picked" : ""}">` +
          `<span class="mv-card-live is-replay">${r.videoType === "UPLOAD" ? "업로드" : "다시보기"}</span>` +
          (r.livePv > 0
            ? `<span class="mv-card-live-pv">${SOURCES.formatCompactCount(r.livePv)}회 시청된 라이브</span>`
            : "") +
          `</span>`
        : `<span class="mv-card-live">LIVE</span><span class="mv-card-viewers">${fmt(r.viewers)}명</span>`) +
      (isVideo && r.duration > 0
        ? `<span class="mv-card-duration">${SOURCES.formatVideoDuration(r.duration)}</span>`
        : "") +
      (watchTimelinePercent !== null
        ? `<span class="mv-card-watch-timeline" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, watchTimelinePercent)).toFixed(2)}%"></span></span>`
        : "") +
      (r.adult ? `<span class="mv-card-sr-only">19 연령 제한</span>` : "") +
      (on ? `<span class="mv-card-picked"><svg width="22" height="22" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>` +
        `<span>선택됨</span></span>` : "") +
      `</span>` +
      `<span class="mv-card-body">` +
      SOURCES.profileImg(r.channelImageUrl, 'class="mv-card-avatar"') +
      `<span class="mv-card-text">` +
      `<span class="mv-card-title">${esc(r.liveTitle || "제목 없음")}</span>` +
      `<span class="mv-card-name-row"><span class="mv-card-name">${esc(r.channelName)}</span>` +
      (CheeseVerifiedMark.kind(r) ? `<span class="mv-card-verified" data-cheese-mark="${CheeseVerifiedMark.kind(r)}" role="img" aria-label="인증 채널"></span>` : "") +
      `</span>` +
      (isVideo
        ? `<span class="mv-card-video-info">조회수 ${fmt(r.viewers)}회${r.openedAt ? ` · ${esc(SOURCES.formatVideoDate(r.openedAt))}` : ""}</span>`
        : "") +
      ((r.category || tags.length)
        ? `<span class="mv-card-meta">${SOURCES.cardFilterChipsHtml(r, esc)}</span>`
        : "") +
      `</span></span></button>`
    );
  }

  function setPagedLoading(source, loading, failed = false) {
    const section = $("mvChannelList")?.querySelector(".mv-section");
    if (!section) return;
    section.querySelector(".mv-live-more")?.remove();
    if (!loading && !failed) return;
    const status = document.createElement(failed ? "button" : "div");
    if (failed) status.type = "button";
    status.className = "mv-live-more";
    status.textContent = failed ? "다음 목록 다시 불러오기" : source === "videos" ? "다시보기를 불러오는 중..." : "다음 방송을 불러오는 중...";
    if (failed) status.dataset.mvPagedRetry = source;
    section.appendChild(status);
  }

  function insertSortedPageRows(source, rows) {
    state.currentSections = [{ id: source, label: "", rows }];
    const box = $("mvChannelList");
    const cards = box.querySelector(".mv-section .mv-cards");
    if (!cards) {
      paintList();
      return;
    }
    const sorted = source === "videos"
      ? rows
      : SOURCES.sortRows(rows, state.sortBySource[source], source === "all");
    const existing = new Map([...cards.querySelectorAll("[data-mv-pick]")]
      .map((node) => [node.dataset.mvPick, node]));
    const picked = new Set(state.chosen.map((channel) => channel.channelId));
    const visibleIds = new Set(sorted.map((row) => row.channelId));
    existing.forEach((node, id) => {
      if (!visibleIds.has(id)) node.remove();
    });
    let next = null;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const row = sorted[index];
      let node = existing.get(row.channelId);
      if (!node) {
        const template = document.createElement("template");
        template.innerHTML = row.mediaType === "channel" ? videoChannelCard(row) : card(row, picked);
        node = template.content.firstElementChild;
      }
      if (node.parentElement !== cards || node.nextElementSibling !== next)
        cards.insertBefore(node, next);
      next = node;
    }
    box.__rows = sorted;
    requestAnimationFrame(maybeLoadMorePaged);
  }

  function onSetupVideoRerankChange({ pager, poolChanged, updatePager }) {
    if (poolChanged) {
      state.videoRerankPager = null;
      state.videoRerankKeyword = "";
      if (state.source === "videos" && state.videoSource === "platter-search") void renderList();
      return;
    }
    if (updatePager === false) return;
    if (state.source === "videos" && state.videoSource === "platter-search" &&
      pager && pager === state.videoRerankPager) {
      insertSortedPageRows("videos", pager.rows);
    }
  }

  async function loadMoreLive() {
    if (state.source !== "all") return;
    const pager = setupLivePager();
    if (pager.loading || pager.done) return;
    setPagedLoading("all", true);
    await pager.loadNext();
    if (state.source !== "all" || pager !== state.livePager) return;
    setPagedLoading("all", false, Boolean(pager.error));
    if (pager.error) return;
    insertSortedPageRows("all", pager.rows);
  }

  function maybeLoadMoreLive() {
    const box = $("mvChannelList");
    if (!box || state.source !== "all") return;
    const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (remaining <= LIVE_LOAD_THRESHOLD_PX) void loadMoreLive();
  }

  async function loadMoreSearch() {
    if (state.source !== "search") return;
    const pager = state.searchPager;
    if (!pager || pager.loading || pager.done) return;
    setPagedLoading("search", true);
    await pager.loadNext();
    if (state.source !== "search" || pager !== state.searchPager) return;
    setPagedLoading("search", false, Boolean(pager.error));
    if (pager.error) return;
    insertSortedPageRows("search", pager.rows);
  }

  function maybeLoadMorePaged() {
    if (state.source === "videos") {
      if (isVideoChannelSearchView()) return;
      const box = $("mvChannelList");
      if (!box) return;
      const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
      if (remaining <= LIVE_LOAD_THRESHOLD_PX) void loadMoreVideos();
      return;
    }
    if (state.source === "all") {
      maybeLoadMoreLive();
      return;
    }
    if (state.source !== "search") return;
    const box = $("mvChannelList");
    if (!box) return;
    const remaining = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (remaining <= LIVE_LOAD_THRESHOLD_PX) void loadMoreSearch();
  }

  // ── 고른 채널 ──────────────────────────────────────────────────────────
  function renderChosen() {
    const list = $("mvChosenList");
    $("mvChosenCount").textContent = `${state.chosen.length} / ${maxChannels()}`;
    // 10채널 이상(내 배치만): 부담 안내.
    const many = $("mvManyChannelsNote");
    if (many) many.hidden = state.chosen.length <= LAYOUTS.MAX_CHANNELS_BUILTIN;
    const clearButton = $("mvChosenClear");
    if (clearButton) clearButton.disabled = state.chosen.length === 0;
    list.innerHTML = state.chosen
      .map(
        (c, i) =>
          `<li class="mv-chosen-item" draggable="true" data-mv-chosen="${esc(c.channelId)}">` +
          `<span class="mv-chosen-rank">${i === 0 ? "메인" : i}</span>` +
          SOURCES.profileImg(c.channelImageUrl) +
          `<span class="mv-chosen-name">${esc(c.channelName)}</span>` +
          `<button type="button" class="mv-chosen-remove" data-mv-remove="${esc(c.channelId)}" ` +
          `aria-label="${esc(c.channelName)} 빼기">` +
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
          `stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"></path></svg>` +
          `</button></li>`,
      )
      .join("");
    renderLayouts();
    $("mvStart").disabled = state.chosen.length < 2;
  }

  // 채널 수가 바뀌어 배치를 자동으로 바꾼 기록(되돌리면 원래 배치로). 이 화면이 열려 있는 동안만.
  const layoutCountBack = new Map();

  // 세로 화면: 창 높이가 너비보다 크다(세로로 돌린 모니터 등). 방향이 바뀌면 배치 목록만
  // 다시 그린다(고른 배치는 그대로).
  const portraitQuery = window.matchMedia?.("(orientation: portrait)");
  function isPortraitWindow() {
    // 시작 중 먼저 불려도 되게 매번 창에 묻는다.
    return window.matchMedia?.("(orientation: portrait)")?.matches === true;
  }
  portraitQuery?.addEventListener?.("change", () => {
    if ($("mvLayoutGrid")) renderLayouts();
  });

  function renderLayouts() {
    const box = $("mvLayoutGrid");
    // 세로 화면(창이 세로로 길다)이면 '세로 화면' 묶음을 맨 위에 둔다(시청 화면과 같다).
    const portrait = isPortraitWindow();
    const list = LAYOUTS.layoutsFor(state.chosen.length, { portrait, keepId: state.layoutId });
    if (!list.length) {
      box.innerHTML = state.chosen.length > LAYOUTS.MAX_CHANNELS_BUILTIN
        ? `<p class="mv-hint">채널 ${state.chosen.length}개짜리 내 배치가 없습니다. '+ 내 배치 만들기'로 칸 ${state.chosen.length}개인 배치를 만들어 주세요.</p>`
        : '<p class="mv-hint">채널을 2개 이상 고르면 배치를 정할 수 있습니다.</p>';
      // 배치는 지우지 않는다. 다시 2개가 되면 쓰던 2채널 배치로 돌아온다.
      return;
    }
    // 채널 수가 바뀌면 그 수에서 지금과 비슷한 배치로 간다(LAYOUTS.layoutForCount).
    const next = LAYOUTS.layoutForCount(state.layoutId, state.chosen.length, state.chatSide, layoutCountBack,
      { portrait });
    if (next) {
      state.layoutId = next.layoutId;
      state.chatSide = next.chatSide;
    }
    let lastGroup = "";
    box.innerHTML = list
      .map((l) => {
        const group = l.custom ? "내 배치" : portrait ? (LAYOUTS.isPortraitGroup(l) ? "세로 화면" : "가로 화면") : "";
        const heading = group && group !== lastGroup
          ? `<div class="mv-layout-group-label" role="presentation">${group}</div>` : "";
        lastGroup = group;
        // ⚠ 미리보기도 시청 화면과 같은 트랙 계산을 써야 한다. l.columns 를 그대로
        //   쓰면 '오른쪽 1' 이 3:1 로 보이지만 실제로는 모든 칸을 16:9 로 맞추느라
        //   1:1 이 되어, 고르기 전후의 모양이 달라진다.
        const preview = LAYOUTS.previewGrid(l);
        return heading + (
          `<button type="button" class="mv-layout${l.id === state.layoutId ? " is-on" : ""}" ` +
          `data-mv-layout="${esc(l.id)}" role="radio" ` +
          `aria-checked="${l.id === state.layoutId}">` +
          `<span class="mv-layout-preview" style="grid-template-columns:${esc(preview.columns)};` +
          `grid-template-rows:${esc(preview.rows)};` +
          `aspect-ratio:${esc(preview.ratio)};` +
          `grid-template-areas:${esc(preview.areas)}">` +
          LAYOUTS.SLOTS.slice(0, l.aux + 1)
            .map(
              (s) =>
                `<i style="grid-area:${s}"${s === "m" ? ' class="is-main"' : ""}></i>`,
            )
            .join("") +
          (preview.chat ? '<i class="is-chat" style="grid-area:x" aria-hidden="true"></i>' : "") +
          (preview.handle ? '<i class="is-chat-handle" style="grid-area:z" aria-hidden="true"></i>' : "") +
          `</span><span class="mv-layout-label">${esc(l.label)}</span></button>`
        );
      })
      .join("")
      // 내 배치 카드에는 수정 버튼을 겹쳐 둔다(버튼 안에 버튼을 둘 수 없다).
      .replace(/<button type="button" class="mv-layout( is-on)?" data-mv-layout="(custom-[a-z0-9]+)"[\s\S]*?<\/button>/g, (card, _on, id) =>
        `<div class="mv-layout-custom">${card}<button type="button" class="mv-layout-edit mv-custom-tooltip" data-mv-custom-edit="${id}" ` +
        `aria-label="내 배치 수정" data-tooltip="수정"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
        `stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/></svg></button></div>`);
  }

  // ── 내 배치 편집기 ─────────────────────────────────────────────────────
  // 빈 칸을 끌어 화면 칸을 만든다(처음 만든 칸이 메인 m, 다음부터 a·b·…). 칸을 누르면 골라서
  // 메인으로 바꾸거나 지운다. 저장값 모양은 multiviewLayouts.js normalizeCustomLayout 참고.
  // draw: 끌어서 만들 칸 — "video"(화면 칸) | "chat"(격자 안 채팅 칸, 4개까지).
  // outsideChat: 바깥 채팅 자리(오른쪽·왼쪽·아래). 격자 안 채팅 칸이 하나라도 있으면 그쪽이 채팅이다.
  // chatTopVideos: 채팅 막대(오른쪽·왼쪽) 위에 얹는 영상 수(0~2) — 기본 '채팅 위' 배치와 같다.
  const editor = { id: "", cells: [], outsideChat: "right", chatTopVideos: 0, draw: "video", selected: "", drag: null, deleteArmed: false };
  const CHAT_CELLS = LAYOUTS.CHAT_CELLS;
  const SLOT_LABEL = (slot) => (slot === "m" ? "메인" : CHAT_CELLS.includes(slot) ? `채팅 ${CHAT_CELLS.indexOf(slot) + 1}`
    : String(LAYOUTS.SLOTS.indexOf(slot)));
  const usedChatCells = (cells = editor.cells) => CHAT_CELLS.filter((name) => cells.some((row) => row.includes(name)));
  const usedSlots = (cells = editor.cells) => LAYOUTS.SLOTS.filter((slot) => cells.some((row) => row.includes(slot)));
  const editorChat = () => (usedChatCells().length ? "inset" : editor.outsideChat);
  const chatTopAllowed = () => !usedChatCells().length && (editor.outsideChat === "right" || editor.outsideChat === "left");
  // 다음에 만들 칸 이름(만든 순서 m, a, b…). 다 썼으면 "".
  function nextCustomSlot() {
    const used = usedSlots();
    // 채팅 위 영상도 칸 이름을 쓴다(격자 칸 뒤 이름) — 합쳐 16을 넘지 않게.
    return used.length + editor.chatTopVideos < LAYOUTS.SLOTS.length ? LAYOUTS.SLOTS[used.length] : "";
  }
  const blankCells = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill("."));

  function openCustomLayoutEditor(id = "") {
    const existing = id ? customLayouts.find((c) => c.id === id) : null;
    editor.id = existing ? existing.id : "";
    editor.cells = existing ? existing.cells.map((row) => [...row]) : blankCells(2, 4);
    editor.outsideChat = existing && existing.chat !== "inset" ? existing.chat : "right";
    editor.chatTopVideos = existing?.chatTopVideos || 0;
    editor.draw = "video";
    editor.selected = "";
    editor.drag = null;
    editor.deleteArmed = false;
    $("mvCustomLayoutTitle").textContent = existing ? "내 배치 수정" : "내 배치 만들기";
    $("mvCustomLayoutName").value = existing ? existing.name : "";
    const del = $("mvCustomLayoutDelete");
    del.hidden = !existing;
    del.classList.remove("is-confirm");
    del.textContent = "삭제";
    renderCustomEditor();
    $("mvCustomLayoutDialog").showModal();
  }

  // 사용한 칸 이름을 만든 순서(m, a, b…)로 다시 붙인다(지우거나 격자를 줄인 뒤).
  function relabelCustomCells(cells) {
    const present = LAYOUTS.SLOTS.filter((slot) => cells.some((row) => row.includes(slot)));
    const map = new Map(present.map((slot, index) => [slot, LAYOUTS.SLOTS[index]]));
    // 채팅 칸도 채팅 1·2·…로 차례를 다시 맞춘다.
    usedChatCells(cells).forEach((name, index) => map.set(name, CHAT_CELLS[index]));
    return cells.map((row) => row.map((cell) => (cell === "." ? "." : map.get(cell) || ".")));
  }

  function slotBox(cells, slot) {
    let box = null;
    cells.forEach((row, r) => row.forEach((cell, c) => {
      if (cell !== slot) return;
      box = box ? { r0: Math.min(box.r0, r), r1: Math.max(box.r1, r), c0: Math.min(box.c0, c), c1: Math.max(box.c1, c) }
        : { r0: r, r1: r, c0: c, c1: c };
    }));
    return box;
  }

  function customDraft() {
    return LAYOUTS.normalizeCustomLayout({
      id: editor.id || "custom-draft0",
      name: $("mvCustomLayoutName").value,
      cells: editor.cells,
      chat: editorChat(),
      chatTopVideos: chatTopAllowed() ? editor.chatTopVideos : 0,
    });
  }

  function renderCustomEditor() {
    const cells = editor.cells;
    const rows = cells.length;
    const cols = cells[0].length;
    $("mvCustomCols").textContent = String(cols);
    $("mvCustomRows").textContent = String(rows);
    const grid = $("mvCustomGrid");
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    grid.style.aspectRatio = `${cols * 16} / ${rows * 9}`;
    grid.style.width = `min(100%, ${Math.round((340 * cols * 16) / (rows * 9))}px)`;
    let html = "";
    for (let r = 0; r < rows; r += 1)
      for (let c = 0; c < cols; c += 1)
        html += `<div class="mv-custom-cell" style="grid-area:${r + 1} / ${c + 1}"></div>`;
    const drag = editor.drag;
    for (const slot of [...LAYOUTS.SLOTS, ...CHAT_CELLS]) {
      const box = slotBox(cells, slot);
      if (!box) continue;
      const selected = slot === editor.selected;
      const moving = drag && drag.moved && drag.slot === slot;
      html += `<div class="mv-custom-slot${slot === "m" ? " is-main" : ""}${CHAT_CELLS.includes(slot) ? " is-chat" : ""}${selected ? " is-selected" : ""}${moving ? " is-moving" : ""}" ` +
        `data-mv-custom-slot="${slot}" style="grid-area:${box.r0 + 1} / ${box.c0 + 1} / ${box.r1 + 2} / ${box.c1 + 2}">` +
        `<span>${SLOT_LABEL(slot)}</span>` +
        (selected ? ["nw", "ne", "sw", "se"].map((corner) =>
          `<span class="mv-custom-handle is-${corner}" data-mv-custom-handle="${corner}" aria-hidden="true"></span>`).join("") : "") +
        `</div>`;
    }
    if (drag?.moved && drag.box) {
      const box = drag.box;
      html += `<div class="mv-custom-pick${drag.valid ? "" : " is-invalid"}" style="grid-area:${box.r0 + 1} / ${box.c0 + 1} / ${box.r1 + 2} / ${box.c1 + 2}">` +
        `<span>${box.c1 - box.c0 + 1}×${box.r1 - box.r0 + 1}</span></div>`;
    }
    grid.innerHTML = html;
    const dialog = $("mvCustomLayoutDialog");
    dialog.querySelector('[data-mv-custom-tool="main"]').disabled = !editor.selected || editor.selected === "m" || CHAT_CELLS.includes(editor.selected);
    dialog.querySelector('[data-mv-custom-tool="remove"]').disabled = !editor.selected;
    const chatCount = usedChatCells().length;
    if (!chatTopAllowed()) editor.chatTopVideos = 0;
    // 그리기: 채팅 위 영상을 쓰면 격자 안 채팅은 못 쓴다(채팅은 바깥 막대 하나).
    if (editor.draw === "chat" && (editor.chatTopVideos > 0 || chatCount >= CHAT_CELLS.length)) editor.draw = "video";
    for (const button of dialog.querySelectorAll("[data-mv-custom-draw]")) {
      const chat = button.dataset.mvCustomDraw === "chat";
      button.setAttribute("aria-pressed", String(button.dataset.mvCustomDraw === editor.draw));
      if (chat) {
        button.disabled = editor.chatTopVideos > 0 || chatCount >= CHAT_CELLS.length;
        button.textContent = chatCount ? `채팅 칸 (${chatCount}/${CHAT_CELLS.length})` : "채팅 칸";
        button.dataset.tooltip = editor.chatTopVideos > 0
          ? "채팅 위 영상을 쓰는 동안은 격자 안 채팅을 만들 수 없습니다"
          : "격자 안에 채팅 칸을 끌어 만듭니다(4개까지)";
      }
    }
    const chatSide = editorChat();
    $("mvCustomStage").dataset.chat = chatSide;
    for (const button of dialog.querySelectorAll("[data-mv-custom-chat]")) {
      button.setAttribute("aria-pressed", String(!chatCount && button.dataset.mvCustomChat === editor.outsideChat));
      button.disabled = chatCount > 0;
    }
    // 채팅 막대 위 영상(오른쪽·왼쪽 채팅일 때만). 이름은 격자 칸 다음 번호.
    const coreCount = usedSlots().length;
    const top = $("mvCustomChatTop");
    top.innerHTML = Array.from({ length: editor.chatTopVideos }, (_, i) =>
      `<span class="mv-custom-chattop-video"><span>${coreCount + i}</span>` +
      `<button type="button" class="mv-custom-chattop-remove" data-mv-custom-chattop-remove="${i}" aria-label="채팅 위 영상 빼기">×</button></span>`).join("");
    const add = dialog.querySelector("[data-mv-custom-chattop-add]");
    add.hidden = !chatTopAllowed();
    add.disabled = editor.chatTopVideos >= 2 || coreCount + editor.chatTopVideos >= LAYOUTS.SLOTS.length;
    const check = LAYOUTS.checkCustomCells(cells, { minSlots: chatTopAllowed() && editor.chatTopVideos ? 1 : 2 });
    const status = $("mvCustomLayoutStatus");
    const draft = check.ok ? customDraft() : null;
    const total = (check.slots || 0) + (chatTopAllowed() ? editor.chatTopVideos : 0);
    let text = check.reason || "";
    if (draft) {
      const def = LAYOUTS.customLayoutDef(draft);
      const fits = def.chatTop || LAYOUTS.solveTracks(def);
      text = `채널 ${total}개 배치입니다. 채널을 ${total}개 고르면 배치 목록의 '내 배치'에 나옵니다.` +
        (fits ? "" : " 칸 모양에 따라 영상 둘레에 여백이 생길 수 있습니다.") +
        (total > LAYOUTS.MAX_CHANNELS_BUILTIN ? " 채널이 많을수록 PC·네트워크 부담이 크게 늘어나 버벅일 수 있습니다." : "") +
        (chatCount > 1 ? ` 채팅 ${chatCount}개 — 칸마다 채팅할 채널을 시청 화면에서 고릅니다.` : "");
    } else if (!editor.cells.some((row) => row.some((cell) => cell !== "."))) {
      text = "빈 칸을 끌어 첫 화면 칸(메인)을 만드세요.";
    }
    status.textContent = text;
    status.classList.toggle("is-error", !draft && check.slots >= 1 && !/만드세요/.test(check.reason || ""));
    $("mvCustomLayoutSave").disabled = !draft;
  }

  function dragBox(drag) {
    return { r0: Math.min(drag.r0, drag.r), r1: Math.max(drag.r0, drag.r), c0: Math.min(drag.c0, drag.c), c1: Math.max(drag.c0, drag.c) };
  }

  // 누른 자리의 칸(행·열). 칸 위에 겹친 화면 칸 요소가 있어 좌표로 구한다.
  function customCellAt(event) {
    const grid = $("mvCustomGrid");
    const rect = grid.getBoundingClientRect();
    const rows = editor.cells.length;
    const cols = editor.cells[0].length;
    const c = Math.floor(((event.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((event.clientY - rect.top) / rect.height) * rows);
    return { r: Math.min(rows - 1, Math.max(0, r)), c: Math.min(cols - 1, Math.max(0, c)) };
  }

  // 격자 조작(포인터 하나):
  //   빈 칸에서 끌기 → 새 칸(create) · 칸을 제자리에서 누르기 → 고르기 · 칸을 끌기 → 같은 크기로 옮기기(move)
  //   고른 칸의 모서리 손잡이 끌기 → 반대쪽 모서리를 두고 크기 바꾸기(resize)
  //   옮기기·크기는 놓을 자리가 비었거나 자기 칸일 때만 된다(아니면 빨갛게 보이고 놓아도 그대로).
  function boxFits(box, own) {
    const cells = editor.cells;
    if (box.r0 < 0 || box.c0 < 0 || box.r1 >= cells.length || box.c1 >= cells[0].length) return false;
    for (let r = box.r0; r <= box.r1; r += 1)
      for (let c = box.c0; c <= box.c1; c += 1)
        if (cells[r][c] !== "." && cells[r][c] !== own) return false;
    return true;
  }
  function placeSlot(slot, box) {
    editor.cells = editor.cells.map((row, r) => row.map((cell, c) => {
      const inside = r >= box.r0 && r <= box.r1 && c >= box.c0 && c <= box.c1;
      if (inside) return slot;
      return cell === slot ? "." : cell;
    }));
  }
  $("mvCustomGrid")?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const { r, c } = customCellAt(event);
    const handle = target?.closest("[data-mv-custom-handle]");
    let drag = null;
    if (handle && editor.selected) {
      const box = slotBox(editor.cells, editor.selected);
      const corner = handle.dataset.mvCustomHandle;
      drag = { mode: "resize", slot: editor.selected, anchorR: corner.startsWith("n") ? box.r1 : box.r0,
        anchorC: corner.endsWith("w") ? box.c1 : box.c0, r, c, moved: false };
    } else if (editor.cells[r][c] !== ".") {
      const slot = editor.cells[r][c];
      drag = { mode: "move", slot, startR: r, startC: c, origin: slotBox(editor.cells, slot), r, c, moved: false };
    } else {
      editor.selected = "";
      drag = { mode: "create", r0: r, c0: c, r, c, moved: true };
    }
    event.preventDefault();
    drag.pointerId = event.pointerId;
    drag.valid = true;
    drag.box = drag.mode === "move" ? drag.origin : dragBox(drag);
    editor.drag = drag;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    renderCustomEditor();
  });
  $("mvCustomGrid")?.addEventListener("pointermove", (event) => {
    const drag = editor.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { r, c } = customCellAt(event);
    if (r === drag.r && c === drag.c) return;
    drag.r = r;
    drag.c = c;
    drag.moved = true;
    if (drag.mode === "move") {
      const { origin } = drag;
      const rows = editor.cells.length;
      const cols = editor.cells[0].length;
      // 격자 밖으로 나가지 않게 이동량을 자른다.
      const dr = Math.min(rows - 1 - origin.r1, Math.max(-origin.r0, r - drag.startR));
      const dc = Math.min(cols - 1 - origin.c1, Math.max(-origin.c0, c - drag.startC));
      drag.box = { r0: origin.r0 + dr, r1: origin.r1 + dr, c0: origin.c0 + dc, c1: origin.c1 + dc };
      drag.valid = boxFits(drag.box, drag.slot);
    } else if (drag.mode === "resize") {
      drag.box = { r0: Math.min(drag.anchorR, r), r1: Math.max(drag.anchorR, r), c0: Math.min(drag.anchorC, c), c1: Math.max(drag.anchorC, c) };
      drag.valid = boxFits(drag.box, drag.slot);
    } else {
      drag.box = dragBox(drag);
      drag.valid = boxFits(drag.box, null);
    }
    renderCustomEditor();
  });
  const finishCustomDrag = (event) => {
    const drag = editor.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    editor.drag = null;
    const done = event.type === "pointerup";
    if (drag.mode === "move" && !drag.moved) {
      editor.selected = editor.selected === drag.slot ? "" : drag.slot;
    } else if ((drag.mode === "move" || drag.mode === "resize") && done && drag.valid) {
      placeSlot(drag.slot, drag.box);
      editor.selected = drag.slot;
    } else if (drag.mode === "create" && done && drag.valid) {
      // '채팅 칸' 그리기면 이번에 끈 곳이 채팅 칸(채팅 1·2·…)이다.
      const chats = usedChatCells();
      const chatCell = editor.draw === "chat" && chats.length < CHAT_CELLS.length && editor.chatTopVideos === 0;
      const next = chatCell ? CHAT_CELLS[chats.length] : nextCustomSlot();
      if (next) {
        placeSlot(next, drag.box);
        if (chatCell) editor.selected = next;
      }
    }
    renderCustomEditor();
  };
  $("mvCustomGrid")?.addEventListener("pointerup", finishCustomDrag);
  $("mvCustomGrid")?.addEventListener("pointercancel", finishCustomDrag);

  $("mvCustomLayoutDialog")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const size = target.closest("[data-mv-custom-size]");
    if (size) {
      const [axis, delta] = size.dataset.mvCustomSize.split(":");
      const rows = editor.cells.length + (axis === "rows" ? Number(delta) : 0);
      const cols = editor.cells[0].length + (axis === "cols" ? Number(delta) : 0);
      if (rows < 1 || cols < 1 || rows > LAYOUTS.CUSTOM_GRID_MAX || cols > LAYOUTS.CUSTOM_GRID_MAX) return;
      // 줄이면 잘린 칸은 남은 부분만(직사각형 그대로), 통째로 사라진 칸은 이름을 다시 붙인다.
      const next = blankCells(rows, cols);
      for (let r = 0; r < rows; r += 1)
        for (let c = 0; c < cols; c += 1) next[r][c] = editor.cells[r]?.[c] ?? ".";
      editor.cells = relabelCustomCells(next);
      editor.selected = "";
      renderCustomEditor();
      return;
    }
    const draw = target.closest("[data-mv-custom-draw]");
    if (draw && !draw.disabled) {
      editor.draw = draw.dataset.mvCustomDraw === "chat" ? "chat" : "video";
      renderCustomEditor();
      return;
    }
    if (target.closest("[data-mv-custom-chattop-add]")) {
      if (chatTopAllowed() && editor.chatTopVideos < 2 && usedSlots().length + editor.chatTopVideos < LAYOUTS.SLOTS.length) {
        editor.chatTopVideos += 1;
        renderCustomEditor();
      }
      return;
    }
    if (target.closest("[data-mv-custom-chattop-remove]")) {
      editor.chatTopVideos = Math.max(0, editor.chatTopVideos - 1);
      renderCustomEditor();
      return;
    }
    const tool = target.closest("[data-mv-custom-tool]")?.dataset.mvCustomTool;
    if (tool === "clear") {
      editor.cells = blankCells(editor.cells.length, editor.cells[0].length);
      editor.chatTopVideos = 0;
      editor.selected = "";
      renderCustomEditor();
      return;
    }
    if (tool === "remove" && editor.selected) {
      const gone = editor.selected;
      editor.cells = relabelCustomCells(editor.cells.map((row) => row.map((cell) => (cell === gone ? "." : cell))));
      editor.selected = "";
      renderCustomEditor();
      return;
    }
    if (tool === "main" && editor.selected && editor.selected !== "m") {
      const other = editor.selected;
      editor.cells = editor.cells.map((row) => row.map((cell) => (cell === "m" ? other : cell === other ? "m" : cell)));
      editor.selected = "m";
      renderCustomEditor();
      return;
    }
    const chat = target.closest("[data-mv-custom-chat]");
    if (chat && !chat.disabled) {
      // 바깥 채팅 자리. 아래면 채팅 위 영상은 없다.
      editor.outsideChat = chat.dataset.mvCustomChat;
      renderCustomEditor();
      return;
    }
    if (target.closest("[data-mv-custom-close]")) {
      $("mvCustomLayoutDialog").close();
      return;
    }
    if (target.closest("#mvCustomLayoutDelete")) {
      const button = $("mvCustomLayoutDelete");
      // 실수로 지우지 않게 한 번 더 누르게 한다.
      if (!editor.deleteArmed) {
        editor.deleteArmed = true;
        button.classList.add("is-confirm");
        button.textContent = "한 번 더 누르면 삭제";
        return;
      }
      void saveCustomLayouts(customLayouts.filter((c) => c.id !== editor.id));
      $("mvCustomLayoutDialog").close();
      return;
    }
    if (target.closest("#mvCustomLayoutSave")) {
      const draft = customDraft();
      if (!draft) return;
      const id = editor.id || LAYOUTS.newCustomLayoutId();
      const saved = { ...draft, id };
      const list = editor.id
        ? customLayouts.map((c) => (c.id === id ? saved : c))
        : [...customLayouts, saved];
      if (!editor.id && customLayouts.length >= LAYOUTS.CUSTOM_MAX) {
        const status = $("mvCustomLayoutStatus");
        status.textContent = `내 배치는 ${LAYOUTS.CUSTOM_MAX}개까지 저장할 수 있습니다. 쓰지 않는 배치를 지워 주세요.`;
        status.classList.add("is-error");
        return;
      }
      void saveCustomLayouts(list, saved);
      $("mvCustomLayoutDialog").close();
    }
  });
  $("mvCustomLayoutName")?.addEventListener("input", () => renderCustomEditor());

  // ── 기본 배치 설정 ──
  // 채널 수 탭마다 그 수의 배치(기본 제공 + 내 배치)를 카드로 보인다. 카드마다 '사용'(목록에
  // 보이기)과 '기본'(그 채널 수가 되면 먼저 고르기). 바꾸는 즉시 저장한다(두 화면이 함께 따른다).
  // ⚠ 한 채널 수의 기본 제공 배치를 모두 숨길 수는 없다(마지막 하나는 남긴다). 내 배치는 숨기지
  //   않는다(내 배치 관리에서 지운다).
  let layoutPrefsCount = 2;
  function layoutPrefsCounts() {
    const counts = new Set();
    for (let n = 2; n <= LAYOUTS.MAX_CHANNELS_BUILTIN; n += 1) counts.add(n);
    for (const custom of customLayouts) counts.add(LAYOUTS.customLayoutDef(custom).aux + 1);
    return [...counts].filter((n) => LAYOUTS.layoutsFor(n, { all: true }).length).sort((a, b) => a - b);
  }
  async function saveLayoutPrefs(next) {
    const prefs = LAYOUTS.setLayoutPrefs(next);
    renderLayoutPrefs();
    renderLayouts();
    try {
      await chrome.storage?.local?.set({ [LAYOUT_PREFS_KEY]: prefs });
    } catch {}
  }
  function renderLayoutPrefs() {
    const counts = layoutPrefsCounts();
    if (!counts.includes(layoutPrefsCount)) layoutPrefsCount = counts[0] || 2;
    const prefs = LAYOUTS.getLayoutPrefs();
    const hidden = new Set(prefs.hidden);
    $("mvLayoutPrefsCounts").innerHTML = counts.map((n) =>
      `<button type="button" role="tab" data-mv-layout-prefs-count="${n}" aria-selected="${n === layoutPrefsCount}" ` +
      `aria-pressed="${n === layoutPrefsCount}">${n}개</button>`).join("");
    const list = LAYOUTS.layoutsFor(layoutPrefsCount, { all: true });
    const builtinShown = list.filter((l) => !l.custom && !hidden.has(l.id)).length;
    const def = LAYOUTS.defaultLayoutFor(layoutPrefsCount);
    const hiddenCount = list.filter((l) => hidden.has(l.id)).length;
    $("mvLayoutPrefsSummary").innerHTML =
      `<span>채널 ${layoutPrefsCount}개 · 기본 배치: <b>${def ? esc(def.label) : "자동(비슷한 배치)"}</b>` +
      `${hiddenCount ? ` · 숨김 ${hiddenCount}개` : ""}</span>` +
      (def ? `<button type="button" class="mv-dialog-button" data-mv-layout-prefs-auto>자동으로</button>` : "");
    $("mvLayoutPrefsGrid").innerHTML = list.map((l) => {
      const off = hidden.has(l.id);
      const isDefault = def?.id === l.id;
      const lockLast = !l.custom && !off && builtinShown <= 1;
      const tags = [l.custom ? "내 배치" : "", l.portrait ? "세로" : ""].filter(Boolean)
        .map((tag) => `<em>${tag}</em>`).join("");
      return `<div class="mv-layout-prefs-card${off ? " is-off" : ""}${isDefault ? " is-default" : ""}">` +
        layoutPreviewHtml(l) +
        `<span class="mv-layout-prefs-label">${esc(l.label)}${tags}</span>` +
        `<span class="mv-layout-prefs-actions">` +
        (l.custom
          ? `<span class="mv-layout-prefs-fixed">항상 사용</span>`
          : `<button type="button" class="mv-layout-prefs-toggle" data-mv-layout-prefs-toggle="${esc(l.id)}" aria-pressed="${!off}"` +
            `${lockLast ? ' disabled title="마지막 하나는 숨길 수 없습니다"' : ""}>${off ? "숨김" : "사용"}</button>`) +
        `<button type="button" class="mv-layout-prefs-default" data-mv-layout-prefs-default="${esc(l.id)}" aria-pressed="${isDefault}" ` +
        `aria-label="${esc(l.label)} 기본 배치로">${isDefault ? "★ 기본" : "☆ 기본"}</button>` +
        `</span></div>`;
    }).join("");
  }
  function openLayoutPrefs() {
    if (state.chosen.length >= 2) layoutPrefsCount = state.chosen.length;
    renderLayoutPrefs();
    $("mvLayoutPrefsDialog").showModal();
  }
  $("mvLayoutPrefsOpen")?.addEventListener("click", openLayoutPrefs);
  $("mvLayoutPrefsDialog")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-mv-layout-prefs-close]")) {
      $("mvLayoutPrefsDialog").close();
      return;
    }
    const prefs = LAYOUTS.getLayoutPrefs();
    const count = target.closest("[data-mv-layout-prefs-count]");
    if (count) {
      layoutPrefsCount = Number(count.dataset.mvLayoutPrefsCount) || 2;
      renderLayoutPrefs();
      return;
    }
    if (target.closest("[data-mv-layout-prefs-auto]")) {
      delete prefs.defaults[layoutPrefsCount];
      void saveLayoutPrefs(prefs);
      return;
    }
    if (target.closest("[data-mv-layout-prefs-reset]")) {
      const ids = new Set(LAYOUTS.layoutsFor(layoutPrefsCount, { all: true }).map((l) => l.id));
      prefs.hidden = prefs.hidden.filter((id) => !ids.has(id));
      delete prefs.defaults[layoutPrefsCount];
      void saveLayoutPrefs(prefs);
      return;
    }
    const toggle = target.closest("[data-mv-layout-prefs-toggle]");
    if (toggle && !toggle.disabled) {
      const id = toggle.dataset.mvLayoutPrefsToggle;
      if (prefs.hidden.includes(id)) {
        prefs.hidden = prefs.hidden.filter((h) => h !== id);
      } else {
        prefs.hidden.push(id);
        // 기본 배치를 숨기면 기본도 푼다.
        if (prefs.defaults[layoutPrefsCount] === id) delete prefs.defaults[layoutPrefsCount];
      }
      void saveLayoutPrefs(prefs);
      return;
    }
    const star = target.closest("[data-mv-layout-prefs-default]");
    if (star) {
      const id = star.dataset.mvLayoutPrefsDefault;
      if (prefs.defaults[layoutPrefsCount] === id) delete prefs.defaults[layoutPrefsCount];
      else {
        prefs.defaults[layoutPrefsCount] = id;
        // 숨긴 배치를 기본으로 고르면 다시 보이게 한다.
        prefs.hidden = prefs.hidden.filter((h) => h !== id);
      }
      void saveLayoutPrefs(prefs);
    }
  });

  // ── 내 배치 관리(칸 수와 상관없이 전체) ──
  // 배치 목록에는 고른 채널 수와 칸 수가 같은 배치만 나와, 다른 칸 수의 배치는 여기서 고친다.
  let manageDeleteArmed = "";
  function layoutPreviewHtml(def) {
    const preview = LAYOUTS.previewGrid(def);
    return `<span class="mv-layout-preview" style="grid-template-columns:${esc(preview.columns)};` +
      `grid-template-rows:${esc(preview.rows)};aspect-ratio:${esc(preview.ratio)};grid-template-areas:${esc(preview.areas)}">` +
      LAYOUTS.SLOTS.slice(0, def.aux + 1).map((slot) => `<i style="grid-area:${slot}"${slot === "m" ? ' class="is-main"' : ""}></i>`).join("") +
      (preview.chat ? '<i class="is-chat" style="grid-area:x" aria-hidden="true"></i>' : "") +
      `</span>`;
  }
  function renderCustomManage() {
    const list = $("mvCustomManageList");
    if (!list) return;
    const items = customLayouts
      .map((custom) => ({ custom, def: LAYOUTS.customLayoutDef(custom) }))
      .sort((a, b) => a.def.aux - b.def.aux || a.custom.name.localeCompare(b.custom.name, "ko"));
    $("mvCustomManageEmpty").hidden = items.length > 0;
    list.innerHTML = items.map(({ custom, def }) =>
      `<li class="mv-custom-manage-item">${layoutPreviewHtml(def)}` +
      `<span class="mv-custom-manage-text"><b>${esc(custom.name)}</b><small>채널 ${def.aux + 1}개 · ${custom.cols}×${custom.rows}</small></span>` +
      `<span class="mv-custom-manage-actions">` +
      `<button type="button" class="mv-dialog-button" data-mv-custom-manage-edit="${esc(custom.id)}">수정</button>` +
      `<button type="button" class="mv-dialog-button" data-mv-custom-manage-copy="${esc(custom.id)}">복제</button>` +
      `<button type="button" class="mv-dialog-button is-danger${manageDeleteArmed === custom.id ? " is-confirm" : ""}" data-mv-custom-manage-delete="${esc(custom.id)}">` +
      `${manageDeleteArmed === custom.id ? "한 번 더 누르면 삭제" : "삭제"}</button></span></li>`).join("");
  }
  function openCustomManage() {
    manageDeleteArmed = "";
    renderCustomManage();
    $("mvCustomManageDialog").showModal();
  }
  function syncCustomManageButton() {
    const button = $("mvCustomLayoutManage");
    if (button) button.hidden = customLayouts.length === 0;
  }
  $("mvCustomManageDialog")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-mv-custom-manage-close]")) {
      $("mvCustomManageDialog").close();
      return;
    }
    if (target.closest("[data-mv-custom-manage-new]")) {
      $("mvCustomManageDialog").close();
      openCustomLayoutEditor();
      return;
    }
    const edit = target.closest("[data-mv-custom-manage-edit]");
    if (edit) {
      $("mvCustomManageDialog").close();
      openCustomLayoutEditor(edit.dataset.mvCustomManageEdit);
      return;
    }
    const copy = target.closest("[data-mv-custom-manage-copy]");
    if (copy) {
      const source = customLayouts.find((c) => c.id === copy.dataset.mvCustomManageCopy);
      if (!source) return;
      if (customLayouts.length >= LAYOUTS.CUSTOM_MAX) return;
      const clone = { ...source, id: LAYOUTS.newCustomLayoutId(), name: `${source.name} 복사본`.slice(0, 30),
        cells: source.cells.map((row) => [...row]) };
      void saveCustomLayouts([...customLayouts, clone]).then(renderCustomManage);
      return;
    }
    const del = target.closest("[data-mv-custom-manage-delete]");
    if (del) {
      const id = del.dataset.mvCustomManageDelete;
      // 실수로 지우지 않게 한 번 더 누르게 한다.
      if (manageDeleteArmed !== id) {
        manageDeleteArmed = id;
        renderCustomManage();
        return;
      }
      manageDeleteArmed = "";
      void saveCustomLayouts(customLayouts.filter((c) => c.id !== id)).then(renderCustomManage);
    }
  });

  // 저장하고 목록에 바로 건다. picked: 방금 저장한 배치 — 고른 채널 수와 맞으면 그 배치를 고른다.
  async function saveCustomLayouts(list, picked = null) {
    applyCustomLayouts(list);
    if (picked) {
      const def = LAYOUTS.layoutById(picked.id);
      if (def && def.aux === state.chosen.length - 1) {
        state.layoutId = def.id;
        state.chatSide = LAYOUTS.chatSidesFor(def)[0];
      }
    }
    renderChosen();
    syncPicked();
    syncCustomManageButton();
    try {
      await chrome.storage?.local?.set({ [CUSTOM_LAYOUTS_KEY]: customLayouts });
    } catch {}
  }

  function pick(channelId) {
    const rows = $("mvChannelList").__rows || [];
    const row = rows.find((r) => r.channelId === channelId);
    if (!row) return;
    const at = state.chosen.findIndex((c) => c.channelId === channelId);
    if (at >= 0) state.chosen.splice(at, 1);
    else if (state.chosen.length < maxChannels()) state.chosen.push(row);
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
    const full = state.chosen.length >= maxChannels();
    for (const card of document.querySelectorAll("#mvChannelList .mv-card")) {
      const id = card.dataset.mvPick;
      if (!id) continue;
      const on = picked.has(id);
      card.classList.toggle("is-on", on);
      card.disabled = full && !on;
      card.classList.toggle("is-limit", full && !on);
      const mark = card.querySelector(".mv-card-picked");
      if (on && !mark) {
        const span = document.createElement("span");
        span.className = "mv-card-picked";
        span.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="3" stroke-linecap="round" ' +
          'stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>' +
          '<span>선택됨</span>';
        card.querySelector(".mv-card-thumb")?.appendChild(span);
      } else if (!on && mark) {
        mark.remove();
      }
    }
  }

  // 시크릿 창에서 열었는지(?incognito=1). 시크릿 탭에서는 이 화면(확장 페이지)이 열리지 않아
  // (ERR_BLOCKED_BY_CLIENT) 사이드바·설정 팝업의 '멀티뷰' 가 일반 창에 열고 표시를 붙인다. 시청 화면
  // (치지직 페이지)은 시크릿 창에 연다. 파이어폭스는 사설 창에 이 화면을 띄우므로 그 경우도 시크릿으로 본다.
  const OPEN_INCOGNITO = new URLSearchParams(location.search).get("incognito") === "1" ||
    chrome.extension?.inIncognitoContext === true;
  {
    const note = document.getElementById("mvIncognitoNote");
    if (note) note.hidden = !OPEN_INCOGNITO;
  }

  // ── 실행 ───────────────────────────────────────────────────────────────
  // 고른 구성을 세션 저장소로 넘기고 시청 화면을 연다(기본 배치 9채널·내 배치 16채널까지, 탭은 여러 개).
  // 그 탭에서 고치는 중이면 그 탭을, '기존 멀티뷰 바꾸기' 면 고른 탭을 새 구성으로 다시 열고, 아니면 새 탭.
  // 주소에 담기엔 채널 목록이 길어 세션 저장소를 쓴다.
  async function start() {
    const layout = LAYOUTS.layoutById(state.layoutId);
    if (!layout || state.chosen.length < 2) return;
    const { side } = LAYOUTS.stageStyle(layout, LAYOUTS.preferredChatSide(layout, chatSidePref, state.chatSide));
    const setup = {
      chosen: state.chosen,
      layoutId: state.layoutId,
      chatSide: side,
      mainHighQuality: state.mainHighQuality,
      chatEnabled: !state.startWithoutChat,
      startMainMuted: state.startMainMuted,
      startMainVolume: state.startMainVolume,
      // 내 배치면 그 모양을 함께 넘긴다(시청 화면이 저장값과 관계없이 같은 모양을 그린다).
      ...(layout.custom && layout.source ? { customLayout: layout.source } : {}),
    };
    // 같은 구성의 멀티뷰가 이미 실행 중이면 다시 불러오지 않는다(방송이 처음부터 다시 로드된다).
    // ⚠ 새 구성을 저장하기 전에 비교한다. '고르기 화면 열기' 로 들어와 같은 id 를 쓰면 저장이
    //   실행 중인 구성을 덮어써 비교 대상이 사라진다.
    // 멀티뷰 탭은 여러 개 열 수 있다. 그 탭의 '고르기 화면 열기' 로 들어와 고치는 중(editing)이면 그 탭을
    // 새 구성으로 다시 열고, 아니면 새 탭 — 실행 중인 멀티뷰가 있으면 먼저 부담·겹치는 채널을 알린다.
    const runningList = await runningMultiviews();
    const editing = state.handoffId ? runningList.find((r) => r.setupId === state.handoffId) || null : null;
    // 일반 창·시크릿 창 멀티뷰는 따로 본다(시크릿에서 시작했는데 일반 창 멀티뷰로 옮기지 않는다).
    const same = (editing ? [editing] : runningList.filter((r) => r.incognito === OPEN_INCOGNITO))
      .find((r) => sameRunningSetup(r.setup, setup));
    if (same) {
      if (await askRunningMultiview() !== "move") return;
      const moved = await chrome.runtime
        .sendMessage({ type: "MULTIVIEW_HOST_FOCUS", tabId: same.tabId })
        .catch(() => null);
      if (moved?.ok) return;
      // 그 사이 탭이 닫혔다. 평소처럼 새로 연다.
    }
    const others = runningList.filter((r) => r !== editing);
    const elsewhere = new Map();
    for (const r of others) {
      for (const c of Array.isArray(r.setup?.chosen) ? r.setup.chosen : []) {
        const id = String(c?.channelId || "");
        if (id && !elsewhere.has(id)) elsewhere.set(id, String(c?.channelName || ""));
      }
    }
    const duplicates = setup.chosen.filter((c) => elsewhere.has(c.channelId))
      .map((c) => c.channelName || elsewhere.get(c.channelId) || c.channelId);
    const addingTab = !editing && runningList.length > 0;
    // 일반 창 멀티뷰와 시크릿 창 멀티뷰는 서로 바꾸지 않는다(배경도 모드가 다르면 새로 연다).
    const sameMode = runningList.length === 1 && runningList[0].incognito === OPEN_INCOGNITO;
    let reuseTabId = null;
    if (addingTab || duplicates.length) {
      const answer = await askMultiTab({ duplicates, addingTab, canReplace: addingTab && sameMode });
      if (answer === "cancel") return;
      if (answer === "replace") reuseTabId = runningList[0].tabId;
    }
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
    // ⚠ 치지직이 다른 출처(확장 페이지)의 iframe 표시를 막아, 시청 화면은 치지직 페이지
    //   위 전용 팝업 창에 띄운다(배경 스크립트가 열고 화면을 넣는다).
    let theme = "light";
    try {
      theme = localStorage.getItem("cheeseSearchTheme") === "dark" ? "dark" : "light";
    } catch {}
    let opened = null;
    try {
      opened = await chrome.runtime.sendMessage({
        type: "MULTIVIEW_OPEN_HOST",
        setupId: handoffId,
        theme,
        ...(Number.isInteger(reuseTabId) ? { reuseTabId } : {}),
        ...(OPEN_INCOGNITO ? { incognito: true } : {}),
      });
    } catch {}
    if (!opened?.ok) {
      alert(opened?.reason === "incognito-not-allowed"
        ? "시크릿 창에 멀티뷰를 열 수 없습니다. 확장 프로그램 관리에서 치즈 플래터의 '시크릿 모드에서 허용'을 켜 주세요."
        : "멀티뷰 창을 열지 못했습니다." + (opened?.reason ? ` (${opened.reason})` : ""));
    }
  }

  // 실행 중인 멀티뷰 탭들과 각 탭의 지금 구성(시청 화면이 바뀔 때마다 저장한다). [{ tabId, setupId, setup }]
  async function runningMultiviews() {
    try {
      const reply = await chrome.runtime.sendMessage({ type: "MULTIVIEW_HOST_FIND" });
      const hosts = reply?.ok
        ? Array.isArray(reply.hosts) ? reply.hosts : reply.host ? [reply.host] : []
        : [];
      const list = [];
      for (const host of hosts) {
        if (!host?.setupId) continue;
        const key = `${HANDOFF_PREFIX}:${host.setupId}`;
        const setup = (await chrome.storage.session.get(key))?.[key];
        if (setup) list.push({ tabId: host.tabId, setupId: host.setupId, incognito: host.incognito === true, setup });
      }
      return list;
    } catch {
      return [];
    }
  }

  // 멀티뷰 탭 추가·겹치는 채널 안내. "open"(새 탭으로 열기·계속) | "replace"(기존 멀티뷰 바꾸기) | "cancel".
  function askMultiTab({ duplicates, addingTab, canReplace }) {
    const dialog = document.getElementById("mvMultiTabDialog");
    if (!dialog?.showModal) return Promise.resolve("open");
    $("mvMultiTabTitle").textContent = addingTab ? "멀티뷰 탭 추가" : "이미 시청 중인 채널";
    const dup = $("mvMultiTabDup");
    dup.hidden = !duplicates.length;
    dup.textContent = duplicates.length
      ? `다른 멀티뷰 탭에서 이미 시청 중인 채널이 있습니다: ${duplicates.join(", ")}. ` +
        "같은 채널을 두 곳에서 재생하면 소리가 겹치고 시청자 수가 중복으로 잡힐 수 있습니다."
      : "";
    $("mvMultiTabLoad").hidden = !addingTab;
    $("mvMultiTabReplace").hidden = !canReplace;
    $("mvMultiTabOpen").textContent = addingTab ? "새 탭으로 열기" : "그래도 열기";
    return new Promise((resolve) => {
      dialog.returnValue = "";
      dialog.addEventListener(
        "close",
        () => resolve(["open", "replace"].includes(dialog.returnValue) ? dialog.returnValue : "cancel"),
        { once: true },
      );
      dialog.showModal();
    });
  }

  // 같은 구성: 같은 채널들, 같은 메인(첫 칸), 같은 배치. 시작 옵션만 바뀌었으면 다시
  // 불러와 적용해야 하므로 같은 구성으로 보지 않는다. 메인이 아닌 칸의 순서는 보지 않는다.
  function sameRunningSetup(running, next) {
    const ids = (setup) =>
      Array.isArray(setup?.chosen) ? setup.chosen.map((c) => String(c?.channelId || "")) : [];
    const a = ids(running);
    const b = ids(next);
    if (!a.length || a.length !== b.length || a[0] !== b[0]) return false;
    const rest = new Set(a);
    return b.every((id) => rest.has(id)) &&
      String(running?.layoutId || "") === String(next?.layoutId || "") &&
      String(running?.chatSide || "") === String(next?.chatSide || "") &&
      (running?.mainHighQuality === true) === (next?.mainHighQuality === true) &&
      (running?.chatEnabled !== false) === (next?.chatEnabled !== false) &&
      (running?.startMainMuted === true) === (next?.startMainMuted === true) &&
      normalizeStartMainVolume(running?.startMainVolume) ===
        normalizeStartMainVolume(next?.startMainVolume);
  }

  // 확인 창. "move"(멀티뷰 이동) 또는 "cancel"(취소·Esc).
  function askRunningMultiview() {
    const dialog = document.getElementById("mvRunningDialog");
    if (!dialog?.showModal) return Promise.resolve("cancel");
    return new Promise((resolve) => {
      dialog.returnValue = "";
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "move" ? "move" : "cancel"),
        { once: true },
      );
      dialog.showModal();
    });
  }

  // ── 이벤트 ─────────────────────────────────────────────────────────────
  document.addEventListener("click", (event) => {
    // 카드의 카테고리·태그 칩(카드 고르기보다 먼저), 카테고리 카드, 필터 해제, 검색 종류.
    const chipFilter = event.target.closest?.("#mvChannelList") ? SOURCES.searchFilterFromChip(event.target) : null;
    if (chipFilter) {
      event.preventDefault();
      event.stopPropagation();
      applySearchFilter(chipFilter);
      return;
    }
    const categoryFilter = event.target.closest?.("#mvChannelList") ? SOURCES.categoryFromCard(event.target) : null;
    if (categoryFilter) {
      applySearchFilter(categoryFilter);
      return;
    }
    if (event.target.closest?.("#mvSearchFilter [data-mv-filter-clear]")) {
      state.searchFilter = null;
      $("mvChannelList").scrollTop = 0;
      void renderList();
      $("mvSearch")?.focus();
      return;
    }
    const searchMode = event.target.closest?.("[data-mv-search-mode]");
    if (searchMode) {
      const mode = SEARCH_MODES.has(searchMode.dataset.mvSearchMode) ? searchMode.dataset.mvSearchMode : "channel";
      if (mode !== state.searchMode || state.searchFilter) {
        state.searchMode = mode;
        state.searchFilter = null;
        $("mvChannelList").scrollTop = 0;
        void renderList();
      }
      $("mvSearch")?.focus();
      return;
    }
    const noteButton = event.target.closest?.("[data-mv-option-note]");
    if (noteButton) {
      const note = $(noteButton.dataset.mvOptionNote);
      if (note) {
        note.hidden = !note.hidden;
        noteButton.setAttribute("aria-expanded", String(!note.hidden));
      }
      return;
    }
    const folder = event.target.closest?.("[data-mv-folder]");
    if (folder) {
      state.folder = folder.dataset.mvFolder;
      paintList();
      return;
    }
    const source = event.target.closest?.("[data-mv-source]");
    if (source) {
      state.source = source.dataset.mvSource;
      state.folder = ""; // 탭을 바꾸면 구역 선택을 푼다
      if (state.source === "videos") {
        state.videoChannel = null;
        state.videoChannelView = "search";
      }
      $("mvFolders").hidden = state.source !== "custom";
      for (const b of document.querySelectorAll("[data-mv-source]")) {
        b.setAttribute("aria-pressed", String(b === source));
      }
      syncSearchTools();
      void renderList();
      return;
    }
    const videoSource = event.target.closest?.("[data-mv-video-source]");
    if (videoSource) {
      const nextVideoSource = videoSource.dataset.mvVideoSource;
      if (nextVideoSource !== "channel-search" || state.videoSource !== "channel-search") {
        state.videoChannel = null;
      }
      state.videoSource = nextVideoSource;
      if (nextVideoSource === "channel-search") state.videoChannelView = "search";
      $("mvChannelList").scrollTop = 0;
      if (state.videoSource === "channel-search") {
        $("mvVideoChannelSearch").hidden = false;
        $("mvVideoChannelSearchInput").focus();
      } else if (state.videoSource === "platter-search") {
        $("mvVideoRerankSearch").hidden = false;
        $("mvVideoRerankSearchInput").focus();
      }
      void renderList();
      return;
    }
    if (event.target.closest?.("[data-mv-video-channel-back]")) {
      state.videoChannelView = "selected";
      $("mvChannelList").scrollTop = 0;
      void renderList();
      return;
    }
    const videoChannel = event.target.closest?.("[data-mv-video-channel]");
    if (videoChannel) {
      const row = state.videoSearchPager?.rows.find((item) => item.channelId === videoChannel.dataset.mvVideoChannel);
      if (row) {
        state.videoChannel = row;
        state.videoChannelView = "selected";
        state.videoPagers.delete(`channel:${row.channelId}`);
        $("mvChannelList").scrollTop = 0;
        void renderList();
      }
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
    if (event.target.closest?.("#mvChosenClear")) {
      state.chosen = [];
      renderChosen();
      syncPicked();
      return;
    }
    const channel = event.target.closest?.("[data-mv-pick]");
    if (channel) {
      pick(channel.dataset.mvPick);
      return;
    }
    if (event.target.closest?.("#mvCustomLayoutNew")) {
      openCustomLayoutEditor();
      return;
    }
    if (event.target.closest?.("#mvCustomLayoutManage")) {
      openCustomManage();
      return;
    }
    const customEdit = event.target.closest?.("[data-mv-custom-edit]");
    if (customEdit) {
      openCustomLayoutEditor(customEdit.dataset.mvCustomEdit);
      return;
    }
    const layout = event.target.closest?.("[data-mv-layout]");
    if (layout) {
      state.layoutId = layout.dataset.mvLayout;
      const picked = LAYOUTS.layoutById(state.layoutId);
      if (picked) state.chatSide = LAYOUTS.chatSideForSwitch(picked, state.chatSide);
      renderLayouts();
      return;
    }
    if (event.target.closest?.("#mvStart")) void start();
    const retry = event.target.closest?.("[data-mv-paged-retry]");
    if (retry) {
      if (retry.dataset.mvPagedRetry === "videos") void loadMoreVideos();
      else if (retry.dataset.mvPagedRetry === "search") void loadMoreSearch();
      else void loadMoreLive();
    }
  });

  $("mvChannelList")?.addEventListener("scroll", maybeLoadMorePaged, { passive: true });

  $("mvSort")?.addEventListener("change", (event) => {
    const source = state.source;
    const previousType = SOURCES.serverSortType(source, state.sortBySource[source]);
    state.sortBySource[state.source] = event.target.value;
    saveSortBySource();
    $("mvChannelList").scrollTop = 0;
    if (previousType !== SOURCES.serverSortType(source, event.target.value)) {
      void renderList();
    } else {
      paintList();
    }
  });

  let searchTimer = 0;
  $("mvSearch")?.addEventListener("input", () => {
    // 새로 찾으면 카테고리·태그 필터는 푼다.
    if (state.searchFilter) {
      state.searchFilter = null;
      syncSearchTools();
    }
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void renderList(), 300);
  });

  let videoChannelSearchTimer = 0;
  $("mvVideoChannelSearchInput")?.addEventListener("input", () => {
    $("mvVideoChannelPopover").scrollTop = 0;
    clearTimeout(videoChannelSearchTimer);
    videoChannelSearchTimer = window.setTimeout(() => void renderList(), 300);
  });
  let videoRerankSearchTimer = 0;
  $("mvVideoRerankSearchInput")?.addEventListener("input", () => {
    clearTimeout(videoRerankSearchTimer);
    videoRerankSearchTimer = window.setTimeout(() => void renderList(), 300);
  });

  async function loadMoreVideos() {
    if (state.source !== "videos") return;
    const isChannelSearch = isVideoChannelSearchView();
    const isRerankSearch = !state.videoChannel && state.videoSource === "platter-search";
    const keyword = videoSearchKeyword();
    const pager = isChannelSearch ? setupVideoSearchPager(keyword)
      : isRerankSearch ? setupVideoRerankPager(keyword) : setupVideoPager();
    if (!pager || pager.loading || pager.done) return;
    if (isChannelSearch) {
      await pager.loadNext();
      if (state.source !== "videos" || pager !== setupVideoSearchPager(keyword)) return;
      renderVideoChannelSuggestions(pager, keyword);
      return;
    }
    setPagedLoading("videos", true);
    await pager.loadNext();
    if (state.source !== "videos" || pager !== (isRerankSearch ? setupVideoRerankPager(keyword) : setupVideoPager())) return;
    setPagedLoading("videos", false, Boolean(pager.error));
    if (pager.error) return;
    insertSortedPageRows("videos", pager.rows);
  }

  $("mvVideoChannelPopover")?.addEventListener("scroll", () => {
    const popover = $("mvVideoChannelPopover");
    if (popover.scrollHeight - popover.scrollTop - popover.clientHeight < 80)
      void loadMoreVideos();
  }, { passive: true });

  $("mvMainHighQuality")?.addEventListener("change", (event) => {
    state.mainHighQuality = event.target.checked;
    saveSetupOptions();
  });
  $("mvStartWithoutChat")?.addEventListener("change", (event) => {
    state.startWithoutChat = event.target.checked;
    saveSetupOptions();
  });
  $("mvStartMainMuted")?.addEventListener("change", (event) => {
    state.startMainMuted = event.target.checked;
    saveSetupOptions();
    syncStartMainVolumeVisibility();
  });
  $("mvStartMainVolumeRange")?.addEventListener("input", (event) => {
    if (setStartMainVolumePercent(event.target.value)) scheduleSetupOptionsSave();
  });
  $("mvStartMainVolumeRange")?.addEventListener("change", (event) => {
    if (setStartMainVolumePercent(event.target.value)) saveSetupOptions();
  });
  $("mvStartMainVolumeNumber")?.addEventListener("input", (event) => {
    if (event.target.value !== "" && setStartMainVolumePercent(event.target.value))
      scheduleSetupOptionsSave();
  });
  $("mvStartMainVolumeNumber")?.addEventListener("change", (event) => {
    if (setStartMainVolumePercent(event.target.value)) saveSetupOptions();
    else paintStartMainVolume();
  });
  // 저장을 묶어 둔 사이에 탭을 닫아도 마지막 값을 남긴다.
  window.addEventListener("pagehide", () => {
    if (setupOptionsSaveTimer) saveSetupOptions();
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
    try {
      const saved = await chrome.storage?.local?.get([
        SETUP_SORT_STORAGE_KEY,
        REMEMBER_SETUP_SORT_KEY,
        SETUP_OPTIONS_STORAGE_KEY,
        CHAT_SIZE_STORAGE_KEY,
        CHAT_SIDE_PREF_KEY,
        CUSTOM_LAYOUTS_KEY,
        LAYOUT_PREFS_KEY,
      ]);
      chatSidePref = typeof saved?.[CHAT_SIDE_PREF_KEY] === "string" ? saved[CHAT_SIDE_PREF_KEY] : "";
      applyCustomLayouts(saved?.[CUSTOM_LAYOUTS_KEY]);
      LAYOUTS.setLayoutPrefs(saved?.[LAYOUT_PREFS_KEY]);
      if (!saved?.[CHAT_SIZE_STORAGE_KEY]) {
        try {
          const legacy = JSON.parse(localStorage.getItem(CHAT_SIZE_STORAGE_KEY) || "null");
          if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
            const size = {};
            for (const key of ["w", "h", "topH"]) {
              const n = Number(legacy[key]);
              if (Number.isFinite(n) && n >= (key === "topH" ? 100 : 260)) {
                size[key] = Math.min(4000, Math.round(n));
              }
            }
            if (Object.keys(size).length) {
              await chrome.storage.local.set({ [CHAT_SIZE_STORAGE_KEY]: size });
            }
          }
        } catch {}
      }
      rememberSetupSort = saved?.[REMEMBER_SETUP_SORT_KEY] !== false;
      if (rememberSetupSort) {
        restoreSortBySource(saved?.[SETUP_SORT_STORAGE_KEY]);
      } else {
        await chrome.storage?.local?.remove?.(SETUP_SORT_STORAGE_KEY);
      }
      const setupOptions = saved?.[SETUP_OPTIONS_STORAGE_KEY];
      state.mainHighQuality = setupOptions?.mainHighQuality === true;
      state.startWithoutChat = setupOptions?.startWithoutChat === true;
      state.startMainMuted = setupOptions?.startMainMuted === true;
      // 저장값이 없으면(예전 버전에서 저장한 경우 포함) 100%.
      state.startMainVolume = normalizeStartMainVolume(setupOptions?.startMainVolume);
      paintStartMainVolume();
      const qualityBox = $("mvMainHighQuality");
      const chatBox = $("mvStartWithoutChat");
      const mutedBox = $("mvStartMainMuted");
      if (qualityBox) qualityBox.checked = state.mainHighQuality;
      if (chatBox) chatBox.checked = state.startWithoutChat;
      if (mutedBox) mutedBox.checked = state.startMainMuted;
      syncStartMainVolumeVisibility();
    } catch {}
    // '채널 다시 고르기' 로 돌아온 경우: 주소의 setup id 로 이전 구성을 복원한다.
    const handoffId = new URLSearchParams(location.search).get("setup") || "";
    if (/^[A-Za-z0-9-]{1,64}$/.test(handoffId)) {
      state.handoffId = handoffId;
      try {
        const key = `${HANDOFF_PREFIX}:${handoffId}`;
        const stored = (await chrome.storage.session.get(key))?.[key];
        const chosen = (Array.isArray(stored?.chosen) ? stored.chosen : [])
          .filter((c) => c && (HASH_RE.test(String(c.channelId || "")) ||
            (c.mediaType === "video" && SLOT_RE.test(String(c.channelId || "")) &&
              String(c.channelId) === `video:${c.videoNo}`)))
          .slice(0, LAYOUTS.MAX_CHANNELS_CUSTOM);
        if (chosen.length) {
          state.chosen = chosen;
          // 시청 화면이 쓰던 내 배치(그사이 지웠어도 이 구성은 그 모양으로 고친다).
          if (stored.customLayout) LAYOUTS.registerCustomLayout(stored.customLayout);
          if (stored.layoutId) state.layoutId = String(stored.layoutId);
          if (stored.chatSide) state.chatSide = String(stored.chatSide);
          state.mainHighQuality = stored.mainHighQuality === true;
          const box = $("mvMainHighQuality");
          if (box) box.checked = state.mainHighQuality;
          state.startWithoutChat = stored.chatEnabled === false;
          const chatBox = $("mvStartWithoutChat");
          if (chatBox) chatBox.checked = state.startWithoutChat;
          state.startMainMuted = stored.startMainMuted === true;
          const mutedBox = $("mvStartMainMuted");
          if (mutedBox) mutedBox.checked = state.startMainMuted;
          state.startMainVolume = normalizeStartMainVolume(stored.startMainVolume);
          paintStartMainVolume();
          syncStartMainVolumeVisibility();
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
