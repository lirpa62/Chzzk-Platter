// 치즈 플래터 - 채팅 리캡 월별 다중 청크 저장소
// 기본 키는 기존 형식을 유지하고, 5,000건을 넘는 오래된 기록만 :part:N에 둔다.
(() => {
  "use strict";

  const DEFAULT_CHUNK_MAX = 5000;
  const PART_SUFFIX = ":part:";
  const ACCOUNT_RE = /^[0-9a-f]{32}$/i;
  const MONTH_RE = /^\d{4}-\d{2}$/;

  const normalizePartCount = (value) => {
    const count = Math.floor(Number(value?.parts) || 0);
    return Math.max(0, Math.min(10000, count));
  };

  const partKey = (baseKey, index) => `${baseKey}${PART_SUFFIX}${index}`;

  function partKeys(baseKey, count) {
    return Array.from({ length: count }, (_, index) =>
      partKey(baseKey, index + 1),
    );
  }

  function itemsOf(value) {
    return Array.isArray(value?.items) ? value.items : [];
  }

  function parseKey(key, prefix = "chatRecap:") {
    const source = String(key || "");
    if (!source.startsWith(prefix)) return null;
    const match = source
      .slice(prefix.length)
      .match(
        /^([0-9a-f]{32}):([0-9a-f]{32}):(\d{4}-\d{2})(?::part:(\d+))?$/i,
      );
    if (!match || !ACCOUNT_RE.test(match[1]) || !ACCOUNT_RE.test(match[2])) {
      return null;
    }
    const month = match[3];
    if (!MONTH_RE.test(month)) return null;
    return {
      accountId: match[1].toLowerCase(),
      channelId: match[2].toLowerCase(),
      month,
      part: match[4] ? Number(match[4]) : 0,
    };
  }

  async function getBatched(storage, keys, batchSize = 24) {
    const out = {};
    for (let index = 0; index < keys.length; index += batchSize) {
      Object.assign(
        out,
        (await storage.get(keys.slice(index, index + batchSize))) || {},
      );
    }
    return out;
  }

  function monthItemsFromValues(baseKey, values) {
    const base = values?.[baseKey];
    const count = normalizePartCount(base);
    const items = [];
    for (const key of partKeys(baseKey, count)) {
      items.push(...itemsOf(values?.[key]));
    }
    items.push(...itemsOf(base));
    return items;
  }

  async function loadMonths(storage, baseKeys, batchSize = 24) {
    const unique = [...new Set((baseKeys || []).map(String).filter(Boolean))];
    if (!unique.length) return new Map();
    const values = await getBatched(storage, unique, batchSize);
    const extraKeys = [];
    for (const baseKey of unique) {
      extraKeys.push(...partKeys(baseKey, normalizePartCount(values[baseKey])));
    }
    if (extraKeys.length) {
      Object.assign(values, await getBatched(storage, extraKeys, batchSize));
    }
    return new Map(
      unique.map((baseKey) => [
        baseKey,
        monthItemsFromValues(baseKey, values),
      ]),
    );
  }

  async function loadMonth(storage, baseKey) {
    const months = await loadMonths(storage, [baseKey]);
    return months.get(baseKey) || [];
  }

  async function readForMerge(storage, baseKey, incomingRows) {
    const stored = (await storage.get(baseKey)) || {};
    const base = stored[baseKey];
    const baseItems = itemsOf(base).slice();
    const parts = normalizePartCount(base);
    let incomingMin = 0;
    for (const item of incomingRows || []) {
      const time = Number(item?.t) || 0;
      if (time > 0 && (!incomingMin || time < incomingMin)) incomingMin = time;
    }
    const baseFirst = Number(baseItems[0]?.t) || 0;
    // 오래된 다시보기 가져오기는 보관 파트와도 중복될 수 있으므로 그때만 전부 읽는다.
    const full =
      parts > 0 &&
      (!baseItems.length ||
        !incomingMin ||
        !baseFirst ||
        incomingMin <= baseFirst);
    if (!full) return { baseKey, items: baseItems, parts, full: false };
    return {
      baseKey,
      items: await loadMonth(storage, baseKey),
      parts,
      full: true,
    };
  }

  const sortItems = (items) =>
    items.sort((a, b) => (Number(a?.t) || 0) - (Number(b?.t) || 0));

  async function writeMerged(
    storage,
    state,
    sourceItems,
    chunkMax = DEFAULT_CHUNK_MAX,
  ) {
    const max = Math.max(100, Math.floor(Number(chunkMax) || DEFAULT_CHUNK_MAX));
    const baseKey = state.baseKey;
    const items = sortItems(sourceItems.slice());
    const now = Date.now();
    const writes = {};
    let nextParts = state.parts;

    if (state.full) {
      const baseItems = items.slice(-max);
      const archived = items.slice(0, Math.max(0, items.length - max));
      nextParts = Math.ceil(archived.length / max);
      for (let index = 0; index < nextParts; index += 1) {
        writes[partKey(baseKey, index + 1)] = {
          v: 2,
          at: now,
          items: archived.slice(index * max, (index + 1) * max),
        };
      }
      writes[baseKey] = { v: 2, at: now, parts: nextParts, items: baseItems };
      await storage.set(writes);
      if (state.parts > nextParts) {
        await storage.remove(
          Array.from(
            { length: state.parts - nextParts },
            (_, index) => partKey(baseKey, nextParts + index + 1),
          ),
        );
      }
      return;
    }

    const baseItems = items.slice(-max);
    const overflow = items.slice(0, Math.max(0, items.length - max));
    if (overflow.length) {
      let archived = overflow;
      let startPart = 1;
      if (state.parts > 0) {
        startPart = state.parts;
        const latestKey = partKey(baseKey, state.parts);
        const latest = (await storage.get(latestKey))?.[latestKey];
        archived = sortItems([...itemsOf(latest), ...overflow]);
      }
      const chunks = Math.ceil(archived.length / max);
      for (let index = 0; index < chunks; index += 1) {
        writes[partKey(baseKey, startPart + index)] = {
          v: 2,
          at: now,
          items: archived.slice(index * max, (index + 1) * max),
        };
      }
      nextParts = startPart + chunks - 1;
    }
    writes[baseKey] = { v: 2, at: now, parts: nextParts, items: baseItems };
    await storage.set(writes);
  }

  globalThis.CheeseChatRecapStore = Object.freeze({
    DEFAULT_CHUNK_MAX,
    loadMonth,
    loadMonths,
    monthItemsFromValues,
    parseKey,
    readForMerge,
    writeMerged,
  });
})();
