// 치즈 플래터 - 나만의 재생목록 저장 구조(content.js·playlist.html 공용, 순수 함수 + 저장 헬퍼).
//
// 저장 키 cheesePlaylists = { v: 1, lists: [{ id, name, items, createdAt, updatedAt }] }
// 항목 = { id, type: "video"|"clip", videoNo|clipUID, start, title, thumb, channelId,
//          channelName, duration, adult, addedAt, verifiedMark?, verifiedMarkType? }
//   - verifiedMark 는 채널 인증 마크(파트너 등)를 확인했을 때만 둔다(없으면 '아직 모름' → 화면이 채널 정보로 채운다).
//   - start 는 다시보기만(초). 치지직 공유 주소의 ?currentTime= 과 같은 뜻이다.
//   - 같은 영상을 다른 시작 시간으로 여러 번 담을 수 있게 항목마다 id 를 따로 준다.
// 계정 구분은 하지 않는다(나누는 건 내보내기·불러오기로 한다).
(() => {
  "use strict";

  const KEY = "cheesePlaylists";
  const VERSION = 1;
  const LIMITS = Object.freeze({ lists: 200, items: 1000, name: 60, title: 200 });
  const ORIGIN = "https://chzzk.naver.com";
  const FILE_FORMAT = "cheese-platter-playlist";
  const CODE_PREFIX = "CPL1:";
  // 공유 코드 한도: 붙여 넣은 글이 터무니없이 크면 풀기 전에 거절한다.
  const CODE_MAX_LENGTH = 200000;
  // 풀어낸 크기 한도. 항목 1000개(약 30KB)의 수십 배라 정상 코드는 닿지 않는다. 작게 압축된 코드가
  // 풀면 수백 MB 가 되도록 꾸민 것(압축 폭탄)은 다 풀기 전에 끊는다.
  const CODE_MAX_INFLATED = 1024 * 1024;
  const MAX_START = 60 * 60 * 72; // 72시간

  const HASH_RE = /^[0-9a-f]{32}$/;
  const VIDEO_NO_RE = /^\d{1,12}$/;
  const CLIP_UID_RE = /^[A-Za-z0-9_-]{4,64}$/;
  const ID_RE = /^[a-z0-9]{6,32}$/;

  function newId() {
    const bytes = new Uint8Array(9);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
  }

  // 이름·제목에서 제어 문자와 글자 방향을 뒤집는 문자(U+202A~202E, U+2066~2069 등)를 뺀다
  // (공유받은 목록 이름이 화면에서 다른 글자처럼 보이게 꾸미는 것을 막는다).
  // eslint-disable-next-line no-control-regex
  const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
  const text = (value, max) => String(value ?? "").replace(UNSAFE_TEXT_RE, "").replace(/\s+/g, " ").trim().slice(0, max);
  // 썸네일은 치지직·네이버 이미지 서버만 받는다. 아무 https 주소나 받으면 공유받은 파일의 썸네일이
  // 남의 서버에서 불려 와, 목록을 연 사람의 IP·열람 시각이 그 서버에 남는다.
  const THUMB_HOST_RE = /(?:^|\.)(?:pstatic\.net|naver\.net|naver\.com)$|^livecloud-thumb\.akamaized\.net$/;
  const httpsUrl = (value) => {
    const raw = String(value || "").trim();
    if (!/^https:\/\/[^\s"'<>\\]+$/.test(raw) || raw.length > 1000) return "";
    try {
      const url = new URL(raw);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && THUMB_HOST_RE.test(url.hostname) ? url.href : "";
    } catch {
      return "";
    }
  };
  const seconds = (value, max = MAX_START) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };

  function itemKey(item) {
    if (item?.type === "video") return `video:${item.videoNo}`;
    if (item?.type === "clip") return `clip:${item.clipUID}`;
    return "";
  }

  // 조회수·올린 날짜(받은 때 기준 — 목록에 보이기만 한다). 날짜는 ms, 초 단위·"2025-08-13 12:00:00"(한국 시각)도 받는다.
  function views(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 1e12) : 0;
  }
  function dateMs(value) {
    let at = Number(value);
    if (!(at > 0)) {
      const raw = String(value ?? "").trim();
      if (!raw) return 0;
      at = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}+09:00`);
    } else if (at < 1e12) {
      at *= 1000;
    }
    return Number.isFinite(at) && at > 0 && at < Date.now() + 86400000 ? Math.floor(at) : 0;
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== "object") return null;
    const type = raw.type === "clip" ? "clip" : raw.type === "video" ? "video" : "";
    const base = {
      id: ID_RE.test(String(raw.id || "")) ? String(raw.id) : newId(),
      type,
      title: text(raw.title, LIMITS.title),
      thumb: httpsUrl(raw.thumb),
      channelId: HASH_RE.test(String(raw.channelId || "").toLowerCase()) ? String(raw.channelId).toLowerCase() : "",
      channelName: text(raw.channelName, LIMITS.name),
      duration: seconds(raw.duration, 60 * 60 * 72),
      adult: raw.adult === true,
      addedAt: Number.isFinite(Number(raw.addedAt)) && Number(raw.addedAt) > 0 ? Number(raw.addedAt) : Date.now(),
    };
    // 없으면 키를 두지 않는다(예전 항목·파일과 모양이 같게).
    if (views(raw.views)) base.views = views(raw.views);
    if (dateMs(raw.date)) base.date = dateMs(raw.date);
    if (typeof raw.verifiedMark === "boolean") base.verifiedMark = raw.verifiedMark;
    if (typeof raw.verifiedMarkType === "string" && raw.verifiedMarkType) base.verifiedMarkType = raw.verifiedMarkType.slice(0, 40);
    if (type === "video") {
      const videoNo = String(raw.videoNo ?? "").trim();
      if (!VIDEO_NO_RE.test(videoNo)) return null;
      return { ...base, videoNo, start: seconds(raw.start) };
    }
    if (type === "clip") {
      const clipUID = String(raw.clipUID ?? "").trim();
      if (!CLIP_UID_RE.test(clipUID)) return null;
      return { ...base, clipUID };
    }
    return null;
  }

  function normalizeList(raw) {
    if (!raw || typeof raw !== "object") return null;
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map(normalizeItem)
      .filter(Boolean)
      .slice(0, LIMITS.items);
    // 같은 목록 안에서 항목 id 가 겹치면(손으로 고친 파일 등) 새로 준다.
    const ids = new Set();
    for (const item of items) {
      if (ids.has(item.id)) item.id = newId();
      ids.add(item.id);
    }
    const now = Date.now();
    return {
      id: ID_RE.test(String(raw.id || "")) ? String(raw.id) : newId(),
      name: text(raw.name, LIMITS.name) || "이름 없는 재생목록",
      items,
      createdAt: Number(raw.createdAt) > 0 ? Number(raw.createdAt) : now,
      updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : now,
    };
  }

  function normalize(raw) {
    const lists = (Array.isArray(raw?.lists) ? raw.lists : [])
      .map(normalizeList)
      .filter(Boolean)
      .slice(0, LIMITS.lists);
    const ids = new Set();
    for (const list of lists) {
      if (ids.has(list.id)) list.id = newId();
      ids.add(list.id);
    }
    return { v: VERSION, lists };
  }

  const findList = (state, listId) => state.lists.find((list) => list.id === listId) || null;

  // ── 목록 조작(새 상태를 돌려준다. 받은 상태는 건드리지 않는다) ──
  function withList(state, listId, change) {
    let found = null;
    const lists = state.lists.map((list) => {
      if (list.id !== listId) return list;
      found = { ...change(list), updatedAt: Date.now() };
      return found;
    });
    return { state: { ...state, lists }, list: found };
  }

  function uniqueName(state, wanted, suffix = "") {
    const base = text(wanted, LIMITS.name) || "새 재생목록";
    const names = new Set(state.lists.map((list) => list.name));
    let name = suffix ? `${base} ${suffix}`.slice(0, LIMITS.name) : base;
    for (let n = 2; names.has(name); n += 1) {
      name = `${base.slice(0, LIMITS.name - 6)} ${suffix ? `${suffix} ` : ""}${n}`.trim();
    }
    return name;
  }

  function createList(state, name) {
    if (state.lists.length >= LIMITS.lists) return { state, list: null, error: "list-limit" };
    const now = Date.now();
    const list = { id: newId(), name: uniqueName(state, name), items: [], createdAt: now, updatedAt: now };
    return { state: { ...state, lists: [...state.lists, list] }, list };
  }

  function renameList(state, listId, name) {
    const next = text(name, LIMITS.name);
    if (!next) return { state, list: findList(state, listId) };
    return withList(state, listId, (list) => ({ ...list, name: next }));
  }

  function deleteList(state, listId) {
    return { state: { ...state, lists: state.lists.filter((list) => list.id !== listId) } };
  }

  function moveList(state, from, to) {
    const lists = [...state.lists];
    if (from < 0 || from >= lists.length || to < 0 || to >= lists.length || from === to) return { state };
    const [moved] = lists.splice(from, 1);
    lists.splice(to, 0, moved);
    return { state: { ...state, lists } };
  }

  // 한도를 넘는 것은 담지 않고 개수만 알린다. 중복은 막지 않는다(시작 시간이 다를 수 있다).
  function addItems(state, listId, rawItems, { index } = {}) {
    const items = (Array.isArray(rawItems) ? rawItems : [rawItems])
      .map((raw) => normalizeItem({ ...raw, id: undefined, addedAt: Date.now() }))
      .filter(Boolean);
    let added = [];
    let skipped = 0;
    const result = withList(state, listId, (list) => {
      const room = Math.max(0, LIMITS.items - list.items.length);
      added = items.slice(0, room);
      skipped = items.length - added.length;
      const next = [...list.items];
      const at = Number.isInteger(index) ? Math.max(0, Math.min(index, next.length)) : next.length;
      next.splice(at, 0, ...added);
      return { ...list, items: next };
    });
    return { ...result, added, skipped };
  }

  function removeItems(state, listId, itemIds) {
    const ids = new Set(Array.isArray(itemIds) ? itemIds : [itemIds]);
    return withList(state, listId, (list) => ({ ...list, items: list.items.filter((item) => !ids.has(item.id)) }));
  }

  function moveItem(state, listId, from, to) {
    const list = findList(state, listId);
    if (!list || from === to || from < 0 || to < 0 || from >= list.items.length || to >= list.items.length) {
      return { state, list };
    }
    return withList(state, listId, (current) => {
      const items = [...current.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...current, items };
    });
  }

  function setStart(state, listId, itemId, start) {
    return withList(state, listId, (list) => ({
      ...list,
      items: list.items.map((item) => (item.id === itemId && item.type === "video" ? { ...item, start: seconds(start) } : item)),
    }));
  }

  // 같은 영상·클립을 담은 모든 항목에 받은 정보(제목·썸네일 등)를 채운다.
  function applyMeta(state, key, meta) {
    let changed = false;
    const lists = state.lists.map((list) => {
      let touched = false;
      const items = list.items.map((item) => {
        if (itemKey(item) !== key) return item;
        const next = normalizeItem({
          ...item,
          title: meta.title || item.title,
          thumb: meta.thumb || item.thumb,
          channelId: meta.channelId || item.channelId,
          channelName: meta.channelName || item.channelName,
          duration: meta.duration || item.duration,
          adult: meta.adult === true || item.adult,
          views: views(meta.views) || item.views,
          date: dateMs(meta.date) || item.date,
          verifiedMark: typeof meta.verifiedMark === "boolean" ? meta.verifiedMark : item.verifiedMark,
          verifiedMarkType: meta.verifiedMarkType || item.verifiedMarkType,
        });
        if (JSON.stringify(next) === JSON.stringify(item)) return item;
        touched = true;
        return next;
      });
      if (!touched) return list;
      changed = true;
      return { ...list, items };
    });
    return { state: changed ? { ...state, lists } : state, changed };
  }

  // 채널 인증 마크를 아직 모르는 항목(예전에 담은 것)에 채널 정보로 채운다. 그 채널 항목 전부에.
  function applyChannelMark(state, channelId, mark) {
    if (!HASH_RE.test(String(channelId || "")) || typeof mark?.verifiedMark !== "boolean") return { state, changed: false };
    let changed = false;
    const lists = state.lists.map((list) => {
      let touched = false;
      const items = list.items.map((item) => {
        if (item.channelId !== channelId || typeof item.verifiedMark === "boolean") return item;
        touched = true;
        return normalizeItem({ ...item, verifiedMark: mark.verifiedMark, verifiedMarkType: mark.verifiedMarkType });
      });
      if (!touched) return list;
      changed = true;
      return { ...list, items };
    });
    return { state: changed ? { ...state, lists } : state, changed };
  }

  function listContains(list, key) {
    return Boolean(list?.items.some((item) => itemKey(item) === key));
  }

  function totalDuration(list) {
    return (list?.items || []).reduce((sum, item) => sum + Math.max(0, (item.duration || 0) - (item.start || 0)), 0);
  }

  // ── 주소 ──
  // 치지직 다시보기·클립 주소에서 항목 키를 읽는다. 다른 주소면 null.
  function parseChzzkUrl(value) {
    let url;
    try {
      url = new URL(String(value || "").trim());
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !/^(?:m\.)?chzzk\.naver\.com$/.test(url.hostname)) return null;
    const video = url.pathname.match(/^\/video\/(\d{1,12})\/?$/);
    if (video) {
      return { type: "video", videoNo: video[1], start: seconds(url.searchParams.get("currentTime")) };
    }
    const clip = url.pathname.match(/^\/(?:embed\/)?clips?\/([A-Za-z0-9_-]{4,64})\/?$/);
    if (clip) return { type: "clip", clipUID: clip[1] };
    return null;
  }

  function itemUrl(item, { withStart = true } = {}) {
    if (item?.type === "video") {
      const start = withStart ? seconds(item.start) : 0;
      return `${ORIGIN}/video/${item.videoNo}${start ? `?currentTime=${start}` : ""}`;
    }
    if (item?.type === "clip") return `${ORIGIN}/clips/${encodeURIComponent(item.clipUID)}`;
    return "";
  }

  // 지금 주소가 이 항목인지(시작 시간은 보지 않는다).
  function matchesLocation(item, pathname) {
    const path = String(pathname || "");
    if (item?.type === "video") return new RegExp(`^/video/${item.videoNo}/?$`).test(path);
    if (item?.type === "clip") {
      const match = path.match(/^\/clips\/([^/?#]+)/);
      return Boolean(match) && decodeURIComponent(match[1]) === item.clipUID;
    }
    return false;
  }

  // ── 시간 표기 ──
  function formatClock(total) {
    const s = Math.max(0, Math.floor(Number(total) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  // "1:23:45" / "83:20" / "5025" / "1시간 2분 3초" → 초. 못 읽으면 null.
  function parseClock(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    // 치지직 다시보기 주소를 붙여 넣으면 그 위치(?currentTime=, ?t=)
    const fromUrl = raw.match(/[?&](?:currentTime|t)=(\d+)(?:&|#|$)/);
    if (fromUrl && /^https?:\/\//i.test(raw)) return seconds(fromUrl[1]);
    // 1h2m3s · 1h 30m · 90s
    const latin = raw.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i);
    if (latin && latin.slice(1).some(Boolean)) {
      const [h, m, s] = latin.slice(1).map((n) => Number(n || 0));
      return seconds(h * 3600 + m * 60 + s);
    }
    if (/^\d+$/.test(raw)) return seconds(raw);
    const colon = raw.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (colon) {
      const parts = colon.slice(1).filter((part) => part !== undefined).map(Number);
      if (parts.slice(1).some((n) => n >= 60)) return null;
      return seconds(parts.reduce((sum, n) => sum * 60 + n, 0));
    }
    const korean = raw.match(/^(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?\s*(?:(\d+)\s*초)?$/);
    if (korean && korean.slice(1).some(Boolean)) {
      const [h, m, s] = korean.slice(1).map((n) => Number(n || 0));
      return seconds(h * 3600 + m * 60 + s);
    }
    return null;
  }

  // ── 내보내기·불러오기 ──
  // 불러올 때 남기는 것: 종류·번호·시작 시간뿐.
  function importedItem(raw) {
    if (raw?.type === "video") return { type: "video", videoNo: String(raw.videoNo ?? ""), start: raw.start };
    if (raw?.type === "clip") return { type: "clip", clipUID: String(raw.clipUID ?? "") };
    return null;
  }

  const EXPORT_FIELDS = ["type", "videoNo", "clipUID", "start", "title", "thumb", "channelId", "channelName", "duration", "adult"];

  function exportFile(state, listIds) {
    const pick = listIds ? new Set(listIds) : null;
    return {
      format: FILE_FORMAT,
      v: VERSION,
      exportedAt: new Date().toISOString(),
      lists: state.lists
        .filter((list) => !pick || pick.has(list.id))
        .map((list) => ({
          name: list.name,
          items: list.items.map((item) => Object.fromEntries(
            EXPORT_FIELDS.filter((field) => item[field] !== undefined && item[field] !== "" && item[field] !== 0 && item[field] !== false)
              .map((field) => [field, item[field]]),
          )),
        })),
    };
  }

  // 파일 내용 → 새 id 를 붙인 목록들. 형식이 틀리면 Error.
  function parseFile(json) {
    let data = json;
    if (typeof json === "string") {
      if (json.length > 20 * 1024 * 1024) throw new Error("파일이 너무 큽니다.");
      try {
        data = JSON.parse(json);
      } catch {
        throw new Error("JSON 파일이 아닙니다.");
      }
    }
    if (data?.format !== FILE_FORMAT) throw new Error("치즈 플래터 재생목록 파일이 아닙니다.");
    if (Number(data.v) > VERSION) throw new Error("더 새 버전에서 만든 파일입니다. 치즈 플래터를 업데이트해 주세요.");
    // ⚠ 파일 안의 제목·썸네일·채널 이름은 믿지 않는다(손으로 고친 파일이면 남의 서버 이미지나 거짓 제목이
    //   들어 있을 수 있다). 종류·번호·시작 시간만 남기고, 나머지는 불러온 뒤 치지직에서 다시 받는다.
    const lists = (Array.isArray(data.lists) ? data.lists : [])
      .slice(0, LIMITS.lists)
      .map((list) => normalizeList({ name: list?.name, items: (Array.isArray(list?.items) ? list.items : []).slice(0, LIMITS.items).map(importedItem) }))
      .filter(Boolean);
    if (!lists.length) throw new Error("파일에 재생목록이 없습니다.");
    return lists.map((list) => ({ ...list, id: newId() }));
  }

  const toBase64Url = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const fromBase64Url = (value) => {
    const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  };
  async function pipeBytes(bytes, stream, maxBytes = Infinity) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("too-large");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }

  // 공유 코드: 목록 하나를 짧은 글자로. 제목 등은 빼고 영상 번호·클립 id·시작 시간만 담는다
  // (불러오는 쪽이 제목·썸네일을 다시 받는다).
  async function encodeShareCode(list) {
    const payload = [1, list.name, list.items.map((item) =>
      item.type === "video"
        ? (item.start ? [0, item.videoNo, item.start] : [0, item.videoNo])
        : [1, item.clipUID])];
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return CODE_PREFIX + toBase64Url(await pipeBytes(bytes, new CompressionStream("deflate-raw")));
  }

  async function decodeShareCode(value) {
    const raw = String(value || "").replace(/\s+/g, "");
    const start = raw.indexOf(CODE_PREFIX);
    if (start < 0) throw new Error("공유 코드는 CPL1: 로 시작합니다.");
    const body = raw.slice(start + CODE_PREFIX.length);
    if (!body || body.length > CODE_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(body)) throw new Error("공유 코드가 올바르지 않습니다.");
    let payload;
    try {
      const bytes = await pipeBytes(fromBase64Url(body), new DecompressionStream("deflate-raw"), CODE_MAX_INFLATED);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("공유 코드를 풀 수 없습니다. 끝까지 복사됐는지 확인해 주세요.");
    }
    if (!Array.isArray(payload) || payload[0] !== 1 || !Array.isArray(payload[2])) throw new Error("공유 코드 형식이 다릅니다.");
    const items = payload[2].map((entry) => {
      if (!Array.isArray(entry)) return null;
      if (entry[0] === 0) return normalizeItem({ type: "video", videoNo: String(entry[1] ?? ""), start: entry[2] });
      if (entry[0] === 1) return normalizeItem({ type: "clip", clipUID: String(entry[1] ?? "") });
      return null;
    }).filter(Boolean);
    const list = normalizeList({ name: payload[1], items });
    return { ...list, id: newId() };
  }

  // 불러온 목록들을 붙인다. 같은 이름이 있으면 '(가져옴)'을 붙인다.
  function addImportedLists(state, lists) {
    let next = state;
    const added = [];
    for (const raw of lists) {
      if (next.lists.length >= LIMITS.lists) break;
      const taken = next.lists.some((list) => list.name === raw.name);
      const list = { ...raw, id: newId(), name: taken ? uniqueName(next, raw.name, "(가져옴)") : raw.name, updatedAt: Date.now() };
      next = { ...next, lists: [...next.lists, list] };
      added.push(list);
    }
    return { state: next, added, skipped: lists.length - added.length };
  }

  // ── 저장(chrome.storage.local, 한 키) ──
  async function load(storage = globalThis.chrome?.storage?.local) {
    try {
      const data = await storage.get(KEY);
      return normalize(data?.[KEY]);
    } catch {
      return normalize(null);
    }
  }

  // 읽기-바꾸기-쓰기. 바꾸기 직전에 새로 읽어 다른 탭이 쓴 것을 덮지 않는다.
  async function update(mutate, storage = globalThis.chrome?.storage?.local) {
    const current = await load(storage);
    const result = mutate(current) || {};
    const next = result.state || current;
    if (next !== current) await storage.set({ [KEY]: next });
    return { ...result, state: next };
  }

  const api = Object.freeze({
    KEY,
    VERSION,
    LIMITS,
    FILE_FORMAT,
    CODE_PREFIX,
    newId,
    itemKey,
    normalizeItem,
    normalizeList,
    normalize,
    findList,
    createList,
    renameList,
    deleteList,
    moveList,
    addItems,
    removeItems,
    moveItem,
    setStart,
    applyMeta,
    applyChannelMark,
    listContains,
    totalDuration,
    parseChzzkUrl,
    itemUrl,
    matchesLocation,
    formatClock,
    parseClock,
    exportFile,
    parseFile,
    encodeShareCode,
    decodeShareCode,
    addImportedLists,
    load,
    update,
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheesePlaylistStore = api;
})();
