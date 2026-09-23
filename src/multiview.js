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
  const LIVE_LOAD_THRESHOLD_PX = 400;
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
    livePager: null,
    searchPager: null,
    searchKeyword: "",
    currentSections: [],
    sortBySource: { following: "viewers", custom: "custom", all: "viewers", search: "viewers" },
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

  // ⚠ 확장 페이지에서 치지직 API 를 직접 fetch 하면 Origin 이 chrome-extension://
  //   으로 붙어 403 "Invalid CORS request" 가 돌아온다(팔로잉·전체·검색 모두).
  //   서비스 워커의 fetch 는 Origin 을 붙이지 않으므로 배경 스크립트에 중계시킨다.

  // ── 채널 목록 ──────────────────────────────────────────────────────────
  // 채널 목록은 공용 로더를 쓴다(주소·응답 해석을 고르기/시청 두 곳에 두지 않는다).
  const SOURCES = globalThis.CheeseMultiviewSources;
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

  function setupLivePager() {
    const sortType = SOURCES.serverSortType("all", state.sortBySource.all);
    if (!state.livePager || state.livePager.sortType !== sortType) {
      state.livePager = SOURCES.createLivePager({ ttlMs: LIST_TTL_MS, sortType });
    }
    return state.livePager;
  }

  function setupSearchPager(keyword) {
    const query = String(keyword || "").trim();
    if (!state.searchPager || state.searchKeyword !== query) {
      state.searchKeyword = query;
      state.searchPager = SOURCES.createSearchPager(query);
    }
    return state.searchPager;
  }

  async function listFor(source, keyword = "") {
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

  function paintList(source = state.source, keyword = $("mvSearch").value) {
    const box = $("mvChannelList");
    let sections = state.currentSections;
    renderFolders(source === "custom" ? sections : []);
    const sort = $("mvSort");
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
    const mode = state.sortBySource[source] === "custom" && !hasCustom
      ? "viewers" : state.sortBySource[source] || "viewers";
    sort.value = mode;
    sort.disabled = false;
    sortPicker.sync();
    if (source === "custom" && state.folder) {
      sections = sections.filter((section) => section.id === state.folder);
    }
    sections = SOURCES.sortSections(sections, mode,
      source === "all" || source === "following" ||
      (source === "custom" && (mode === "recent" || mode === "oldest")));
    if (!sections.length) {
      box.innerHTML = source === "search"
        ? `<p class="mv-empty">${keyword.trim() ? "찾는 채널이나 태그의 방송이 없습니다." : "채널 이름 또는 태그로 찾아보세요."}</p>`
        : '<p class="mv-empty">지금 방송 중인 채널이 없습니다.</p>';
      box.__rows = [];
      return;
    }
    const picked = new Set(state.chosen.map((c) => c.channelId));
    box.innerHTML = sections.map((section) => {
      const cards = section.rows.map((row) => card(row, picked)).join("");
      const head = section.label
        ? `<div class="mv-section-head"><span class="mv-section-name">${esc(section.label)}</span>` +
          `<span class="mv-section-count">${fmt(section.rows.length)}</span></div>`
        : "";
      return `<section class="mv-section">${head}<div class="mv-cards">${cards}</div></section>`;
    }).join("");
    box.__rows = sections.flatMap((section) => section.rows);
    if (source === "all" || source === "search") {
      const pager = source === "all" ? state.livePager : state.searchPager;
      if (pager?.error) setPagedLoading(source, false, true);
      else requestAnimationFrame(maybeLoadMorePaged);
    }
  }

  async function renderList() {
    const requestId = ++listRequestId;
    // 요청 시점의 값을 붙잡는다(기다리는 동안 사용자가 탭·검색어를 바꿀 수 있다).
    const source = state.source;
    const keyword = $("mvSearch").value;
    const box = $("mvChannelList");
    box.setAttribute("aria-busy", "true");
    box.innerHTML = skeletonCards();
    $("mvSort").disabled = true;
    sortPicker.sync();
    let sections = [];
    try {
      sections = await listFor(source, keyword);
    } catch (error) {
      if (requestId !== listRequestId) return;
      box.removeAttribute("aria-busy");
      box.innerHTML = `<p class="mv-empty">목록을 불러오지 못했습니다. (${esc(error.message)})</p>`;
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
    const tags = Array.isArray(r.tags) ? r.tags : [];
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
      `<span class="mv-card-live">LIVE</span>` +
      `<span class="mv-card-viewers">${fmt(r.viewers)}명</span>` +
      (r.adult ? `<span class="mv-card-sr-only">19 연령 제한</span>` : "") +
      (on ? `<span class="mv-card-picked"><svg width="22" height="22" viewBox="0 0 24 24" ` +
        `fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>` +
        `<span>선택됨</span></span>` : "") +
      `</span>` +
      `<span class="mv-card-body">` +
      `<img class="mv-card-avatar" src="${esc(safeImageUrl(SOURCES.profileThumb(r.channelImageUrl)))}" alt="" loading="lazy" decoding="async">` +
      `<span class="mv-card-text">` +
      `<span class="mv-card-title">${esc(r.liveTitle || "제목 없음")}</span>` +
      `<span class="mv-card-name">${esc(r.channelName)}</span>` +
      ((r.category || tags.length)
        ? `<span class="mv-card-meta">` +
          (r.category ? `<span class="mv-card-category-chip">${esc(r.category)}</span>` : "") +
          tags.map((tag) => `<span class="mv-card-tag-chip">${esc(tag)}</span>`).join("") +
          `</span>`
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
    status.textContent = failed ? "다음 목록 다시 불러오기" : "다음 방송을 불러오는 중...";
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
    const sorted = SOURCES.sortRows(rows, state.sortBySource[source], source === "all");
    const existing = new Map([...cards.querySelectorAll("[data-mv-pick]")]
      .map((node) => [node.dataset.mvPick, node]));
    const picked = new Set(state.chosen.map((channel) => channel.channelId));
    let next = null;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      const row = sorted[index];
      let node = existing.get(row.channelId);
      if (!node) {
        const template = document.createElement("template");
        template.innerHTML = card(row, picked);
        node = template.content.firstElementChild;
        cards.insertBefore(node, next);
      }
      next = node;
    }
    box.__rows = sorted;
    requestAnimationFrame(maybeLoadMorePaged);
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
    $("mvChosenCount").textContent = `${state.chosen.length} / ${MAX_CHANNELS}`;
    list.innerHTML = state.chosen
      .map(
        (c, i) =>
          `<li class="mv-chosen-item" draggable="true" data-mv-chosen="${esc(c.channelId)}">` +
          `<span class="mv-chosen-rank">${i === 0 ? "메인" : i}</span>` +
          `<img src="${esc(safeImageUrl(SOURCES.profileThumb(c.channelImageUrl)))}" alt="" loading="lazy" decoding="async">` +
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
      paintList();
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
    const retry = event.target.closest?.("[data-mv-paged-retry]");
    if (retry) {
      if (retry.dataset.mvPagedRetry === "search") void loadMoreSearch();
      else void loadMoreLive();
    }
  });

  $("mvChannelList")?.addEventListener("scroll", maybeLoadMorePaged, { passive: true });

  $("mvSort")?.addEventListener("change", (event) => {
    const source = state.source;
    const previousType = SOURCES.serverSortType(source, state.sortBySource[source]);
    state.sortBySource[state.source] = event.target.value;
    $("mvChannelList").scrollTop = 0;
    if (previousType !== SOURCES.serverSortType(source, event.target.value)) {
      void renderList();
    } else {
      paintList();
    }
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
