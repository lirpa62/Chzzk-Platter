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
  const HASH_RE = /^[0-9a-f]{32}$/i;

  const $ = (id) => document.getElementById(id);
  const state = {
    source: "following",
    chosen: [], // [{channelId, channelName, channelImageUrl, liveTitle, viewers}]
    layoutId: "",
    chatChannelId: "",
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

  async function getJson(url) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json())?.content ?? null;
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
  });

  async function loadFollowing() {
    const c = await getJson(`${API}/service/v1/channels/followings/live`);
    const rows = Array.isArray(c?.data) ? c.data : [];
    return rows.map((r) => normalize(r?.channel, r)).filter((r) => r.channelId);
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

  // 전용 팔로잉: 즐겨찾기·그룹에 넣어 둔 채널만 추린 뒤 라이브 정보를 붙인다.
  async function loadCustom() {
    let favorites = [];
    let groups = [];
    try {
      const d = await chrome.storage.local.get([
        "cheeseFollowFavorites",
        "cheeseFollowCustomGroups",
      ]);
      favorites = Array.isArray(d?.cheeseFollowFavorites)
        ? d.cheeseFollowFavorites
        : [];
      groups = Array.isArray(d?.cheeseFollowCustomGroups)
        ? d.cheeseFollowCustomGroups
        : [];
    } catch {}
    const wanted = new Set(
      [...favorites, ...groups.flatMap((g) => g?.channelIds || [])]
        .map((v) => String(v).toLowerCase())
        .filter((v) => HASH_RE.test(v)),
    );
    if (!wanted.size) return [];
    const live = await loadFollowing();
    return live.filter((r) => wanted.has(r.channelId));
  }

  async function listFor(source, keyword = "") {
    const key = source === "search" ? `search:${keyword}` : source;
    if (state.listCache.has(key)) return state.listCache.get(key);
    const loader =
      source === "following"
        ? loadFollowing
        : source === "custom"
          ? loadCustom
          : source === "all"
            ? loadAll
            : () => search(keyword);
    const rows = await loader();
    state.listCache.set(key, rows);
    return rows;
  }

  async function renderList() {
    const box = $("mvChannelList");
    box.setAttribute("aria-busy", "true");
    box.innerHTML = '<p class="mv-empty">불러오는 중…</p>';
    let rows = [];
    try {
      rows = await listFor(state.source, $("mvSearch").value);
    } catch (error) {
      box.removeAttribute("aria-busy");
      box.innerHTML = `<p class="mv-empty">목록을 불러오지 못했습니다. (${esc(error.message)})</p>`;
      return;
    }
    box.removeAttribute("aria-busy");
    if (!rows.length) {
      box.innerHTML =
        state.source === "search"
          ? '<p class="mv-empty">검색어를 입력하세요.</p>'
          : '<p class="mv-empty">지금 방송 중인 채널이 없습니다.</p>';
      return;
    }
    const picked = new Set(state.chosen.map((c) => c.channelId));
    box.innerHTML = rows
      .map((r) => {
        const on = picked.has(r.channelId);
        const full = state.chosen.length >= MAX_CHANNELS && !on;
        return (
          `<button type="button" class="mv-channel${on ? " is-on" : ""}" ` +
          `data-mv-pick="${esc(r.channelId)}"${full ? " disabled" : ""}>` +
          `<img class="mv-channel-avatar" src="${esc(thumb(r.channelImageUrl))}" alt="" loading="lazy">` +
          `<span class="mv-channel-body">` +
          `<span class="mv-channel-name">${esc(r.channelName)}</span>` +
          `<span class="mv-channel-title">${esc(r.liveTitle || r.category)}</span>` +
          `</span>` +
          `<span class="mv-channel-viewers">${fmt(r.viewers)}</span>` +
          `</button>`
        );
      })
      .join("");
    box.__rows = rows;
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
  // 프레임에 줄 URL. 팝업 플레이어와 같은 방식으로 쿼리에 지시를 담는다.
  function frameUrl(channel, isMain) {
    const url = new URL(`/live/${channel.channelId}`, "https://chzzk.naver.com");
    url.searchParams.set("cheeseMulti", "1");
    url.searchParams.set("cheeseMultiMain", isMain ? "1" : "0");
    // 메인만 소리, 나머지는 음소거로 시작한다.
    url.searchParams.set("cheeseMultiMuted", isMain ? "0" : "1");
    // 화질: 기본 480p. 메인만 높은 화질을 쓰도록 선택했으면 메인은 지정하지 않는다
    // (프레임 쪽이 최대 화질 설정을 따른다).
    if (!(isMain && state.mainHighQuality)) {
      url.searchParams.set("cheeseMultiQuality", "480");
    }
    return url.toString();
  }

  function start() {
    const layout = LAYOUTS.layoutById(state.layoutId);
    if (!layout || state.chosen.length < 2) return;
    state.chatChannelId = state.chosen[0].channelId;

    const frames = $("mvFrames");
    frames.style.gridTemplateColumns = layout.columns;
    frames.style.gridTemplateRows = layout.rows;
    frames.style.gridTemplateAreas = layout.areas.join(" ");
    frames.innerHTML = "";
    state.chosen.forEach((channel, index) => {
      const slot = LAYOUTS.SLOTS[index];
      const cell = document.createElement("div");
      cell.className = "mv-cell" + (index === 0 ? " is-main" : "");
      cell.style.gridArea = slot;
      cell.dataset.channelId = channel.channelId;
      const frame = document.createElement("iframe");
      frame.src = frameUrl(channel, index === 0);
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.title = `${channel.channelName} 방송`;
      frame.referrerPolicy = "origin";
      cell.appendChild(frame);
      frames.appendChild(cell);
    });

    const { direction, side } = LAYOUTS.stageStyle(layout, state.chatSide);
    state.chatSide = side;
    const stage = $("mvStage");
    stage.style.flexDirection = direction;
    stage.dataset.chatSide = side;

    const select = $("mvChatChannel");
    select.innerHTML = state.chosen
      .map(
        (c, i) =>
          `<option value="${esc(c.channelId)}">${esc(c.channelName)}${i === 0 ? " (메인)" : ""}</option>`,
      )
      .join("");
    applyChat(state.chatChannelId);

    $("mvSetup").hidden = true;
    stage.hidden = false;
  }

  function applyChat(channelId) {
    state.chatChannelId = channelId;
    const url = new URL(`/live/${channelId}`, "https://chzzk.naver.com");
    url.searchParams.set("cheeseMultiChat", "1");
    // 채팅 칸도 /live/ 페이지를 통째로 띄우므로 영상·소리가 같이 산다. 소리는 메인
    // 칸에서 이미 나오니 여기는 반드시 음소거하고, 화질도 가장 낮게 묶는다.
    url.searchParams.set("cheeseMultiMuted", "1");
    url.searchParams.set("cheeseMultiQuality", "144");
    $("mvChatFrame").src = url.toString();
  }

  function backToSetup() {
    // ⚠ src 를 비워 프레임을 확실히 내린다. hidden 만으로는 재생·소켓이 계속 돈다.
    for (const frame of document.querySelectorAll("#mvFrames iframe")) {
      frame.src = "about:blank";
    }
    $("mvChatFrame").src = "about:blank";
    $("mvFrames").innerHTML = "";
    $("mvStage").hidden = true;
    $("mvSetup").hidden = false;
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
    if (event.target.closest?.("#mvStart")) start();
    if (event.target.closest?.("#mvBack")) backToSetup();
    if (event.target.closest?.("#mvChatToggle")) {
      const stage = $("mvStage");
      const folded = stage.classList.toggle("is-chat-folded");
      $("mvChatToggle").textContent = folded ? "펼치기" : "접기";
    }
  });

  $("mvChatChannel")?.addEventListener("change", (event) => {
    applyChat(event.target.value);
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
