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
  const WATCH_PAGE = "multiviewWatch.html";
  // 고른 구성을 시청 화면으로 넘길 때 쓰는 세션 저장소 키.
  const HANDOFF_KEY = "cheeseMultiviewSetup";
  const HASH_RE = /^[0-9a-f]{32}$/i;

  const $ = (id) => document.getElementById(id);
  const state = {
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

  // 프로필 원본은 수백 KB 다. 목록에 수십 개를 그리므로 리사이즈본을 쓴다.
  const thumb = (url) => {
    const s = String(url || "");
    if (!s) return "";
    if (/[?&]type=/.test(s)) return s;
    return `${s}${s.includes("?") ? "&" : "?"}type=f120_120_na`;
  };

  // ⚠ 확장 페이지에서 치지직 API 를 직접 fetch 하면 Origin 이 chrome-extension://
  //   으로 붙어 403 "Invalid CORS request" 가 돌아온다(팔로잉·전체·검색 모두).
  //   서비스 워커의 fetch 는 Origin 을 붙이지 않으므로 배경 스크립트에 중계시킨다.
  async function getJson(url) {
    const reply = await chrome.runtime.sendMessage({
      type: "MULTIVIEW_API",
      url,
    });
    if (!reply?.ok) throw new Error(reply?.reason || "요청 실패");
    return reply.content ?? null;
  }

  // ── 채널 목록 ──────────────────────────────────────────────────────────
  const normalize = (channel, live) => ({
    channelId: String(channel?.channelId || "").toLowerCase(),
    channelName: String(channel?.channelName || "").trim(),
    channelImageUrl: String(channel?.channelImageUrl || ""),
    liveTitle: String(live?.liveTitle || "").trim(),
    category: String(live?.liveCategoryValue || "").trim(),
    viewers: Number(live?.concurrentUserCount) || 0,
    adult: live?.adult === true,
    // 라이브 스냅샷. {type} 자리에 해상도를 넣어야 실제 이미지가 나온다.
    liveImageUrl: String(live?.liveImageUrl || "").replace("{type}", "480"),
  });

  // ⚠ 팔로잉 응답은 `content.followingList` 다(`content.data` 가 아니다). 항목도
  //   모양이 달라 채널 정보는 최상위·`channel`, 방송 정보는 `liveInfo` 에 있다.
  //   오프라인 채널도 함께 내려오므로 `streamer.openLive` 로 걸러야 한다.
  async function loadFollowing() {
    const c = await getJson(`${API}/service/v1/channels/followings/live`);
    const rows = Array.isArray(c?.followingList) ? c.followingList : [];
    return rows
      .filter((r) => r?.streamer?.openLive === true)
      .map((r) =>
        normalize(
          {
            ...(r?.channel || {}),
            channelId: r?.channelId || r?.channel?.channelId,
          },
          r?.liveInfo,
        ),
      )
      .filter((r) => r.channelId);
  }

  async function loadAll() {
    const c = await getJson(`${API}/service/v1/lives?size=40`);
    const rows = Array.isArray(c?.data) ? c.data : [];
    return rows.map((r) => normalize(r?.channel, r)).filter((r) => r.channelId);
  }

  async function search(keyword) {
    if (!keyword.trim()) return [];
    const c = await getJson(
      `${API}/service/v1/search/lives?keyword=${encodeURIComponent(keyword)}&offset=0&size=30`,
    );
    const rows = Array.isArray(c?.data) ? c.data : [];
    // 검색 응답은 {channel, live} 로 한 겹 더 감싸여 있다.
    return rows
      .map((r) => normalize(r?.channel, r?.live))
      .filter((r) => r.channelId);
  }

  // 전용 팔로잉: 사이드바와 같은 구분(즐겨찾기 → 각 그룹 → 나머지 팔로잉)으로
  // 나눠 돌려준다. 라이브 정보는 팔로잉 목록에서 가져오므로 방송 중인 채널만 남는다.
  //
  // ⚠ 선호도(affinity) 구역은 넣지 않는다. 시청 이력 지표를 따로 모아 점수를
  //   매기는 별도 계산이라 이 화면에서 재현할 수 없다.
  async function loadCustomSections() {
    let favorites = [];
    let groups = [];
    let groupOrder = [];
    try {
      const d = await chrome.storage.local.get([
        "cheeseFollowFavorites",
        "cheeseFollowCustomGroups",
        "cheeseFollowGroupOrder",
      ]);
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
  async function listFor(source, keyword = "") {
    const key = source === "search" ? `search:${keyword}` : source;
    if (state.listCache.has(key)) return state.listCache.get(key);
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
    state.listCache.set(key, sections);
    return sections;
  }

  async function renderList() {
    const box = $("mvChannelList");
    box.setAttribute("aria-busy", "true");
    box.innerHTML = '<p class="mv-empty">불러오는 중…</p>';
    let sections = [];
    try {
      sections = await listFor(state.source, $("mvSearch").value);
    } catch (error) {
      box.removeAttribute("aria-busy");
      box.innerHTML = `<p class="mv-empty">목록을 불러오지 못했습니다. (${esc(error.message)})</p>`;
      return;
    }
    box.removeAttribute("aria-busy");
    if (!sections.length) {
      box.innerHTML =
        state.source === "search"
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

  // 라이브 방송 카드(썸네일 + 프로필 + 제목 + 시청자 수).
  function card(r, picked) {
    const on = picked.has(r.channelId);
    const full = state.chosen.length >= MAX_CHANNELS && !on;
    const thumbUrl = r.liveImageUrl || "";
    return (
      `<button type="button" class="mv-card${on ? " is-on" : ""}" ` +
      `data-mv-pick="${esc(r.channelId)}"${full ? " disabled" : ""}>` +
      `<span class="mv-card-thumb">` +
      (thumbUrl
        ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy">`
        : `<span class="mv-card-thumb-empty"></span>`) +
      `<span class="mv-card-viewers">${fmt(r.viewers)}명</span>` +
      (on ? `<span class="mv-card-picked">선택됨</span>` : "") +
      `</span>` +
      `<span class="mv-card-body">` +
      `<img class="mv-card-avatar" src="${esc(thumb(r.channelImageUrl))}" alt="" loading="lazy">` +
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
          `<img src="${esc(thumb(c.channelImageUrl))}" alt="" loading="lazy">` +
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
      .map(
        (l) =>
          `<button type="button" class="mv-layout${l.id === state.layoutId ? " is-on" : ""}" ` +
          `data-mv-layout="${esc(l.id)}" role="radio" ` +
          `aria-checked="${l.id === state.layoutId}">` +
          `<span class="mv-layout-preview" style="grid-template-columns:${esc(l.columns)};` +
          `grid-template-areas:${esc(l.areas.join(" "))}">` +
          LAYOUTS.SLOTS.slice(0, l.aux + 1)
            .map(
              (s) =>
                `<i style="grid-area:${s}"${s === "m" ? ' class="is-main"' : ""}></i>`,
            )
            .join("") +
          `</span><span class="mv-layout-label">${esc(l.label)}</span></button>`,
      )
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
    renderList();
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
    try {
      await chrome.storage.session.set({ [HANDOFF_KEY]: setup });
    } catch (error) {
      alert("시청 화면으로 넘기지 못했습니다: " + (error?.message || error));
      return;
    }
    const url = chrome.runtime.getURL(WATCH_PAGE);
    if (chrome.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, "_blank", "noopener");
  }

  // ── 이벤트 ─────────────────────────────────────────────────────────────
  document.addEventListener("click", (event) => {
    const source = event.target.closest?.("[data-mv-source]");
    if (source) {
      state.source = source.dataset.mvSource;
      for (const b of document.querySelectorAll("[data-mv-source]")) {
        b.setAttribute("aria-selected", String(b === source));
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
      void renderList();
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
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = state.chosen.splice(from, 1);
    state.chosen.splice(to, 0, moved);
    dragId = "";
    renderChosen();
    void renderList();
  });

  // 시작
  document
    .querySelector('[data-mv-source="following"]')
    ?.setAttribute("aria-selected", "true");
  renderChosen();
  void renderList();
})();
