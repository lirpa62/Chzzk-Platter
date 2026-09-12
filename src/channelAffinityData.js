// '내 활동순' 지표 수집. 네 지표를 모아 channelAffinity.js 가 쓸 형태로 만든다.
//
// ⚠ 목록은 사이드바에서 자주 다시 그려진다. 여기서 API 를 매번 부르면 안 된다.
//   - 통나무파워·내 채팅·구독: 로컬 저장소만 읽는다(요청 0).
//   - 후원: API 가 월 단위라 요청이 필요하다 → 결과를 캐시하고 주기적으로만 갱신.
(() => {
  "use strict";

  const API_BASE = "https://api.chzzk.naver.com";
  const HASH_RE = /^[0-9a-f]{32}$/i;

  const LOG_POWER_KEY = "cheeseLogPowerLog";
  const RECAP_PREFIX = "chatRecap:";
  const DONATION_CACHE_KEY = "cheeseAffinityDonationCache";
  // 후원 캐시 수명. 짧으면 API 를 자주 부르고, 길면 최근 후원이 늦게 반영된다.
  const DONATION_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
  const HISTORY_SIZE = 50;
  const HISTORY_MAX_PAGES = 20; // 월당 상한(안전장치)

  const json = async (url) => {
    const res = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json())?.content;
  };

  // ── 통나무파워: 채널별 적립 합계 ──────────────────────────────────────────
  // logPowerStats.js 와 같은 저장소를 읽는다(요청 없음).
  async function collectLogPower(storage, accountId) {
    const out = new Map();
    try {
      const rows = (await storage.get(LOG_POWER_KEY))?.[LOG_POWER_KEY];
      if (!Array.isArray(rows)) return out;
      for (const row of rows) {
        const channelId = String(row?.channelId || "").toLowerCase();
        if (!HASH_RE.test(channelId)) continue;
        // ⚠ 계정 구분값이 없는 옛 기록은 포함한다. 대부분 단일 계정이라
        //   빼면 과거 내역이 통째로 사라진다(logPowerStats.js 와 같은 판단).
        const rowAccount = String(row?.accountId || "").toLowerCase();
        if (accountId && rowAccount && rowAccount !== accountId) continue;
        const amount = Number(row?.amount) || 0;
        if (amount <= 0) continue;
        out.set(channelId, (out.get(channelId) || 0) + amount);
      }
    } catch {
      // 못 읽으면 이 지표만 비운다.
    }
    return out;
  }

  // ── 내 채팅 수: 리캡 저장 키에서 센다 ────────────────────────────────────
  // ⚠ 본문을 열지 않는다. 키가 chatRecap:<account>:<channel>:<YYYY-MM> 이라
  //   키 목록만으로 '그 채널에 몇 달치 기록이 있는지'를 알 수 있다.
  //   정확한 메시지 수는 아니지만 채널 간 비교에는 충분하고 비용이 0 에 가깝다.
  async function collectChatMonths(storage, accountId, parseKey) {
    const out = new Map();
    if (!accountId || typeof parseKey !== "function") return out;
    try {
      const all = await storage.get(null);
      for (const key of Object.keys(all || {})) {
        const parsed = parseKey(key, RECAP_PREFIX);
        if (!parsed || parsed.accountId !== accountId) continue;
        // part 는 같은 달의 이어진 조각이라 한 번만 센다.
        if (parsed.part) continue;
        out.set(parsed.channelId, (out.get(parsed.channelId) || 0) + 1);
      }
    } catch {
      // 저장소를 못 읽으면 이 지표만 비운다.
    }
    return out;
  }

  // ── 구독 개월: 현재 + 만료를 합쳐 채널당 최대값 ──────────────────────────
  // ⚠ totalMonth 만 쓴다. otherPlatformMonth/twitchMonth 가 여기 포함되는지
  //   확인되지 않아, 합치면 이관 이력이 있는 채널만 두 배가 될 위험이 있다.
  // ⚠ 재구독으로 두 목록에 같은 채널이 나올 수 있어 최대값을 쓴다.
  async function collectSubscribeMonths() {
    const out = new Map();
    const add = (rows) => {
      for (const row of Array.isArray(rows) ? rows : []) {
        const channelId = String(row?.channelId || "").toLowerCase();
        if (!HASH_RE.test(channelId)) continue;
        const months = Number(row?.totalMonth) || 0;
        if (months <= 0) continue;
        out.set(channelId, Math.max(out.get(channelId) || 0, months));
      }
    };
    for (const path of [
      "/commercial/v1/subscribe/channels?page=0&size=100",
      "/commercial/v1/subscribe/channels/expired?page=0&size=100",
    ]) {
      try {
        const content = await json(`${API_BASE}${path}`);
        add(Array.isArray(content) ? content : content?.data);
      } catch {
        // 한쪽이 실패해도 다른 쪽 결과는 쓴다.
      }
    }
    return out;
  }

  // ── 후원 횟수: 최근 N개월 ────────────────────────────────────────────────
  // ⚠ purchase/history 는 searchYear/searchMonth 를 받는 월 단위 API 다.
  //   전체 이력을 긁으면 가입 개월 수만큼 요청이 필요해(3년이면 36회+) 목록을
  //   그릴 때마다 돌릴 수 없다. 최근 N개월만 보고 결과를 캐시한다.
  async function fetchDonationCounts(months) {
    const out = new Map();
    const now = new Date();
    for (let i = 0; i < months; i += 1) {
      const target = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = target.getFullYear();
      const month = target.getMonth() + 1;
      for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
        let content = null;
        try {
          const query = new URLSearchParams({
            page: String(page),
            size: String(HISTORY_SIZE),
            searchYear: String(year),
            searchMonth: String(month),
          });
          // eslint-disable-next-line no-await-in-loop
          content = await json(
            `${API_BASE}/commercial/v1/product/purchase/history?${query}`,
          );
        } catch {
          break; // 그 달은 포기하고 다음 달로
        }
        const rows = content?.data;
        if (!Array.isArray(rows) || !rows.length) break;
        for (const row of rows) {
          const channelId = String(row?.channelId || "").toLowerCase();
          if (!HASH_RE.test(channelId)) continue;
          // ⚠ 금액은 세지 않는다. 횟수만 쓴다.
          out.set(channelId, (out.get(channelId) || 0) + 1);
        }
        const totalPages = Number(content?.totalPages) || 0;
        if (totalPages && page + 1 >= totalPages) break;
        if (rows.length < HISTORY_SIZE) break;
      }
    }
    return out;
  }

  async function collectDonations(storage, accountId, months, { force } = {}) {
    const cacheKey = `${DONATION_CACHE_KEY}:${accountId || "unknown"}`;
    if (!force) {
      try {
        const cached = (await storage.get(cacheKey))?.[cacheKey];
        if (cached?.at && Date.now() - cached.at < DONATION_TTL_MS) {
          return new Map(Object.entries(cached.counts || {}));
        }
      } catch {
        // 캐시를 못 읽으면 새로 모은다.
      }
    }
    const counts = await fetchDonationCounts(months);
    try {
      await storage.set({
        [cacheKey]: { at: Date.now(), counts: Object.fromEntries(counts) },
      });
    } catch {
      // 저장 실패해도 이번 결과는 쓴다.
    }
    return counts;
  }

  // 네 지표를 { channelId: {logPower, donation, chat, subscribe} } 로 합친다.
  // options.skip 에 든 지표는 아예 수집하지 않는다(예: 채팅 기록 미사용).
  async function collectMetrics(storage, accountId, options = {}) {
    const skip = new Set(options.skip || []);
    const months = Number(options.donationMonths) || 3;
    const [logPower, chat, subscribe, donation] = await Promise.all([
      skip.has("logPower") ? new Map() : collectLogPower(storage, accountId),
      skip.has("chat")
        ? new Map()
        : collectChatMonths(storage, accountId, options.parseKey),
      skip.has("subscribe") ? new Map() : collectSubscribeMonths(),
      skip.has("donation")
        ? new Map()
        : collectDonations(storage, accountId, months, options),
    ]);
    const out = {};
    const put = (map, key) => {
      for (const [channelId, value] of map) {
        (out[channelId] ||= {})[key] = value;
      }
    };
    put(logPower, "logPower");
    put(donation, "donation");
    put(chat, "chat");
    put(subscribe, "subscribe");
    return out;
  }

  globalThis.CheeseChannelAffinityData = Object.freeze({
    DONATION_TTL_MS,
    collectLogPower,
    collectChatMonths,
    collectSubscribeMonths,
    fetchDonationCounts,
    collectDonations,
    collectMetrics,
  });
})();
