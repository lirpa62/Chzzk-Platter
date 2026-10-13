// 치즈 플래터 - 시청 시간 기록 저장 형식(내용 스크립트·시청 시간 화면 공용).
//
// 하루마다 키를 나눈다.
//   cheeseWatchTime:2026-10-07 → { "a1b2c3d4e5|<채널 id>|l": 초, ... }
//   계정(로그인: 계정 해시 앞 10자, 비로그인: "-") | 채널 id | 종류
//   종류: l 라이브, v 다시보기, r 라디오(소리만)
// ⚠ 달 단위로 묶지 않는다. 저장할 때마다 바뀐 키의 값 전체가 열린 치지직 탭·칸마다
//   전달되는데(storage.onChanged), 한 달 치는 수십 KB 가 된다. 하루 치는 1KB 안팎이다.
// ⚠ 배경 스크립트는 이 형식을 모른다. 내용 스크립트가 만든 키에 초를 더하기만 한다
//   (CHEESE_WATCH_TIME_ADD) — 배경에서 이 파일을 불러오는 방법이 크롬(서비스 워커)과
//   파이어폭스(배경 페이지)에서 달라 둘 다 맞추지 않아도 되게 했다.
(() => {
  "use strict";

  const SHARD_PREFIX = "cheeseWatchTime:";
  // 기록한 날짜 목록(배경이 쓸 때 함께 고친다). 저장소 전체를 읽지 않으려고 둔다.
  const DAYS_KEY = "cheeseWatchTimeDays";
  const ENABLED_KEY = "cheeseWatchTime";
  const MODES = Object.freeze({ live: "l", vod: "v", radio: "r" });
  const MODE_NAMES = Object.freeze({ l: "live", v: "vod", r: "radio" });
  const MODE_LABELS = Object.freeze({ live: "라이브", vod: "다시보기", radio: "라디오" });
  const GUEST = "-";
  const CHANNEL_RE = /^[0-9a-f]{32}$/;

  const pad = (n) => String(n).padStart(2, "0");

  // 로컬 날짜(사용자 기준 하루) "YYYY-MM-DD".
  function dateOf(at) {
    const d = new Date(Number(at) || Date.now());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function shardKey(date) {
    return `${SHARD_PREFIX}${date}`;
  }

  function accountKey(accountId) {
    const id = String(accountId || "").toLowerCase().replace(/[^0-9a-z]/g, "");
    return id ? id.slice(0, 10) : GUEST;
  }

  // 기록 한 줄 → { shard, key }. 잘못된 값이면 null.
  function bucket({ at, accountId, channelId, mode }) {
    const channel = String(channelId || "").toLowerCase();
    const code = MODES[mode];
    if (!CHANNEL_RE.test(channel) || !code) return null;
    return { shard: shardKey(dateOf(at)), key: `${accountKey(accountId)}|${channel}|${code}` };
  }

  function parseKey(date, key) {
    const [account, channelId, code] = String(key).split("|");
    const mode = MODE_NAMES[code];
    if (!account || !CHANNEL_RE.test(channelId || "") || !mode) return null;
    return { date, account, login: account !== GUEST, channelId, mode };
  }

  // 저장소 전체(get(null))에서 날짜 키만 고른다 → { "2026-10-07": {...} }
  function pickShards(all) {
    const out = {};
    for (const [key, value] of Object.entries(all || {})) {
      if (!key.startsWith(SHARD_PREFIX) || !value || typeof value !== "object") continue;
      const date = key.slice(SHARD_PREFIX.length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out[date] = value;
    }
    return out;
  }

  // 기간 안의 날짜 키만 읽는다 → { "2026-10-07": {...} }. get 은 chrome.storage.local.get.
  async function loadShards(get, { from = "", to = "" } = {}) {
    const index = await get(DAYS_KEY);
    const days = (Array.isArray(index?.[DAYS_KEY]) ? index[DAYS_KEY] : [])
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && (!from || date >= from) && (!to || date <= to));
    const out = {};
    for (let i = 0; i < days.length; i += 120) {
      const keys = days.slice(i, i + 120).map(shardKey);
      const data = await get(keys);
      for (const key of keys) {
        const shard = data?.[key];
        if (shard && typeof shard === "object") out[key.slice(SHARD_PREFIX.length)] = shard;
      }
    }
    return out;
  }

  function emptyTotals() {
    return { total: 0, live: 0, vod: 0, radio: 0, login: 0, guest: 0 };
  }

  function addTo(totals, row, seconds) {
    totals.total += seconds;
    totals[row.mode] += seconds;
    totals[row.login ? "login" : "guest"] += seconds;
  }

  // 모아 보기. filter:
  //   from/to: "YYYY-MM-DD"(포함), 비우면 끝없음
  //   login: "all" | "login" | "guest"
  //   modes: 볼 종류 배열(기본 셋 다)
  //   channelId: 한 채널만
  function aggregate(shards, filter = {}) {
    const modes = new Set(filter.modes?.length ? filter.modes : ["live", "vod", "radio"]);
    const login = filter.login === "login" || filter.login === "guest" ? filter.login : "all";
    const result = { ...emptyTotals(), byChannel: {}, byDay: {} };
    for (const [date, shard] of Object.entries(shards || {})) {
      if (filter.from && date < filter.from) continue;
      if (filter.to && date > filter.to) continue;
      for (const [key, raw] of Object.entries(shard || {})) {
        const seconds = Number(raw);
        if (!(seconds > 0)) continue;
        const row = parseKey(date, key);
        if (!row || !modes.has(row.mode)) continue;
        if (login === "login" && !row.login) continue;
        if (login === "guest" && row.login) continue;
        if (filter.channelId && row.channelId !== filter.channelId) continue;
        addTo(result, row, seconds);
        addTo((result.byChannel[row.channelId] ||= emptyTotals()), row, seconds);
        addTo((result.byDay[row.date] ||= emptyTotals()), row, seconds);
      }
    }
    return result;
  }

  // 초 → "12시간 3분" / "45분" / "30초"
  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return m ? `${h.toLocaleString("ko-KR")}시간 ${m}분` : `${h.toLocaleString("ko-KR")}시간`;
    if (m) return `${m}분`;
    return `${s}초`;
  }

  globalThis.CheeseWatchTimeStore = Object.freeze({
    SHARD_PREFIX,
    DAYS_KEY,
    loadShards,
    ENABLED_KEY,
    MODES,
    MODE_LABELS,
    GUEST,
    dateOf,
    shardKey,
    accountKey,
    bucket,
    parseKey,
    pickShards,
    aggregate,
    formatDuration,
  });
})();
