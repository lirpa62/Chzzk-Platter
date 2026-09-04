// 치즈 플래터 - 채팅 리캡 월별 다중 청크 저장소
// 기본 키는 기존 형식을 유지하고, 5,000건을 넘는 오래된 기록만 :part:N에 둔다.
(() => {
  "use strict";

  const DEFAULT_CHUNK_MAX = 5000;
  const PART_SUFFIX = ":part:";
  const VOD_TITLE_CHANGE_PREFIX = "cheeseVodTitleChangesV1:";
  const VOD_TITLE_CHANGE_MATCH_WINDOW_MS = 60 * 1000;
  const VOD_TITLE_CHANGE_MAX = 500;
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
      .match(/^([0-9a-f]{32}):([0-9a-f]{32}):(\d{4}-\d{2})(?::part:(\d+))?$/i);
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
      unique.map((baseKey) => [baseKey, monthItemsFromValues(baseKey, values)]),
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

  function vodIdentityKey(item) {
    const videoNo = String(item?.n || "");
    const identity = String(item?.i || "");
    return /^\d+$/.test(videoNo) && identity ? `${videoNo}|${identity}` : "";
  }

  // ⚠ 후원 키(donationKeyOf)를 이 키에 넣으면 안 된다. 같은 메시지라도 '후원 정보가
  //   붙기 전/후'로 키가 달라져, 재수집 때 서로 다른 행으로 쌓인다(제보: 이미 가져온
  //   다시보기를 다시 모으면서 같은 채팅이 중복 표시). 영상+재생위치+본문이면 같은
  //   메시지로 보고, 후원 정보는 병합 쪽에서 채워 넣는다.
  //   인자는 호출부 호환을 위해 남겨 두되 키에는 반영하지 않는다.
  function vodFallbackKey(item) {
    const videoNo = String(item?.n || "");
    const offset = Number(item?.v);
    if (!/^\d+$/.test(videoNo) || !Number.isFinite(offset)) return "";
    return JSON.stringify([videoNo, Math.round(offset), String(item?.m || "")]);
  }

  // 예전 버전은 다시보기 메시지를 절대 시각(t)으로만 구분했다. API 재조회 때
  // t가 조금 달라지면 같은 영상·재생 위치의 메시지가 새 행으로 쌓였으므로,
  // 메시지 ID(i)를 우선하고 없는 레거시 행만 영상+초 단위 위치+본문으로 합친다.
  function compactVodRows(sourceItems, donationKeyOf = () => "") {
    const items = [];
    const identities = new Map();
    const fallbacks = new Map();
    let changed = false;

    for (const item of sourceItems || []) {
      const identity = vodIdentityKey(item);
      const fallback = vodFallbackKey(item, donationKeyOf);
      let index = identity ? identities.get(identity) : undefined;
      if (index === undefined && fallback) {
        const fallbackIndex = fallbacks.get(fallback);
        if (
          fallbackIndex !== undefined &&
          (!identity || !String(items[fallbackIndex]?.i || ""))
        ) {
          index = fallbackIndex;
        }
      }

      if (index === undefined) {
        index = items.length;
        items.push(item);
        if (identity) identities.set(identity, index);
        if (fallback && !fallbacks.has(fallback)) {
          fallbacks.set(fallback, index);
        }
        continue;
      }

      const current = items[index];
      const next = { ...current };
      if (!next.i && item?.i) next.i = item.i;
      if (!next.n && item?.n) next.n = item.n;
      if (next.v === undefined && item?.v !== undefined) next.v = item.v;
      if (!next.m && item?.m) next.m = item.m;
      if (
        item?.d &&
        (!next.d || (item.d.src === "history" && next.d?.src !== "history"))
      ) {
        // ⚠ 미션은 확정 시각으로 덮어쓰면 안 된다. purchase/history 의 시각은
        //   성공·실패·거절이 확정된 순간이라 내가 후원한 시점과 다르다(제보).
        //   대기 때 잡아 둔 시각(src:"mission")이 있으면 그쪽을 유지하고,
        //   종류·금액만 확정본으로 갱신한다.
        const keepPendingTime = next.d?.src === "mission";
        next.d = keepPendingTime ? { ...item.d, src: "mission" } : item.d;
        if (
          !keepPendingTime &&
          item.d.src === "history" &&
          Number(item?.t) > 0
        ) {
          next.t = item.t;
        }
      }
      items[index] = next;
      const nextIdentity = vodIdentityKey(next);
      if (nextIdentity) identities.set(nextIdentity, index);
      changed = true;
    }
    return { items, changed };
  }

  function mergeVodRow(current, incoming) {
    const next = { ...current };
    if (Number(incoming?.t) > 0) next.t = incoming.t;
    if (incoming?.m !== undefined) next.m = incoming.m;
    if (incoming?.n) next.n = incoming.n;
    if (incoming?.v !== undefined) next.v = incoming.v;
    if (incoming?.i) next.i = incoming.i;
    if (
      incoming?.d &&
      (!next.d ||
        incoming.d.src === "history" ||
        next.d?.src !== "history")
    ) {
      const keepPendingTime = next.d?.src === "mission";
      next.d = keepPendingTime
        ? { ...incoming.d, src: "mission" }
        : incoming.d;
      if (keepPendingTime && Number(current?.t) > 0) next.t = current.t;
    }
    return next;
  }

  function takeUnused(indexes, used) {
    for (const index of indexes || []) {
      if (used.has(index)) continue;
      used.add(index);
      return index;
    }
    return undefined;
  }

  // 끝까지 읽은 한 다시보기는 기존 행에 단순 추가하지 않고 수집 결과와 일대일로
  // 맞춘다. API 재조회 때 합성 메시지 ID나 절대 시각이 달라져도 같은 영상 위치의
  // 행이 계속 쌓이지 않으며, 같은 초에 같은 문구를 실제로 여러 번 보낸 경우에는
  // 이번 응답에 들어 있는 개수만큼 각각 보존한다.
  function reconcileCompleteVodRows(
    sourceItems,
    incomingRows,
    videoNo,
    donationKeyOf = () => "",
  ) {
    const targetVideoNo = String(videoNo || "");
    if (!/^\d+$/.test(targetVideoNo)) {
      return { items: (sourceItems || []).slice(), changed: false, added: 0 };
    }

    const compactedIncoming = compactVodRows(incomingRows, donationKeyOf);
    const incoming = compactedIncoming.items.filter(
      (item) => String(item?.n || "") === targetVideoNo,
    );
    const items = (sourceItems || []).map((item) => ({ ...item }));
    const targetIndexes = [];
    const identityIndexes = new Map();
    const fallbackIndexes = new Map();
    const unlinkedBySecond = new Map();

    const addIndex = (map, key, index) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(index);
    };

    items.forEach((item, index) => {
      if (String(item?.n || "") === targetVideoNo) {
        targetIndexes.push(index);
        addIndex(identityIndexes, vodIdentityKey(item), index);
        addIndex(fallbackIndexes, vodFallbackKey(item, donationKeyOf), index);
      } else if (!item?.n) {
        const second = Math.floor((Number(item?.t) || 0) / 1000);
        if (second > 0) addIndex(unlinkedBySecond, second, index);
      }
    });

    const used = new Set();
    let added = 0;
    for (const row of incoming) {
      let index = takeUnused(identityIndexes.get(vodIdentityKey(row)), used);
      if (index === undefined) {
        index = takeUnused(
          fallbackIndexes.get(vodFallbackKey(row, donationKeyOf)),
          used,
        );
      }
      if (index === undefined) {
        const rowTime = Number(row?.t) || 0;
        const rowDonation = String(donationKeyOf(row?.d) || "");
        const rowSecond = Math.floor(rowTime / 1000);
        const nearby = [];
        for (let second = rowSecond - 5; second <= rowSecond + 5; second += 1) {
          nearby.push(...(unlinkedBySecond.get(second) || []));
        }
        const matches = nearby
          .filter((candidate) => !used.has(candidate))
          .map((candidate) => {
            const item = items[candidate];
            const itemDonation = String(donationKeyOf(item?.d) || "");
            const delta = Math.abs((Number(item?.t) || 0) - rowTime);
            const textCompatible =
              !item?.m || !row?.m || String(item.m) === String(row.m);
            const donationCompatible =
              rowDonation === itemDonation || !rowDonation || !itemDonation;
            return { candidate, delta, textCompatible, donationCompatible };
          })
          .filter(
            ({ delta, textCompatible, donationCompatible }) =>
              delta <= 5000 && textCompatible && donationCompatible,
          )
          .sort((a, b) => a.delta - b.delta);
        if (
          matches.length &&
          (!matches[1] || matches[1].delta > matches[0].delta)
        ) {
          index = matches[0].candidate;
          used.add(index);
        }
      }
      if (index === undefined) {
        items.push({ ...row });
        added += 1;
      } else {
        items[index] = mergeVodRow(items[index], row);
      }
    }

    const targetSet = new Set(targetIndexes);
    const reconciled = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!targetSet.has(index) || used.has(index)) {
        reconciled.push(item);
        continue;
      }
      // 결제 내역·미션은 채팅 API에서 빠질 수 있으므로 기록 자체는 보존하되,
      // 잘못된 다시보기 연결만 떼어 다음 수집 때 다시 대조할 수 있게 한다.
      if (item?.d) {
        const { n, v, i, ...unlinked } = item;
        reconciled.push(unlinked);
      }
    }

    return {
      items: reconciled,
      changed:
        compactedIncoming.changed ||
        incoming.length > 0 ||
        targetIndexes.length > 0,
      added,
    };
  }

  function vodTitleChangeKey(videoNo) {
    const value = String(videoNo || "");
    return /^\d+$/.test(value) ? `${VOD_TITLE_CHANGE_PREFIX}${value}` : "";
  }

  function normalizeVodTitleText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
  }

  function normalizeVodTitleChanges(value) {
    const source = Array.isArray(value)
      ? value
      : Array.isArray(value?.items)
        ? value.items
        : [];
    const seen = new Set();
    return source
      .map((item) => {
        const v = Math.max(0, Math.round(Number(item?.v)));
        const t = Math.max(0, Math.round(Number(item?.t) || 0));
        const title = normalizeVodTitleText(item?.title);
        return Number.isFinite(v) && title ? { v, t, title } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.v - b.v || a.t - b.t)
      .filter((item) => {
        const key = `${item.v}|${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(-VOD_TITLE_CHANGE_MAX);
  }

  function parseVodChatProfile(message) {
    const raw = message?.profile;
    if (raw && typeof raw === "object") return raw;
    if (typeof raw !== "string" || !raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function isVodTitleChangeAuthor(message) {
    const profile = parseVodChatProfile(message);
    const role = String(
      message?.userRoleCode ||
        message?.userRole ||
        profile?.userRoleCode ||
        profile?.userRole ||
        "",
    ).toLowerCase();
    return role.includes("streamer") || role.includes("manager");
  }

  function vodTitleChangeEntry(message, kind, title) {
    const playerMessageTime = Number(message?.playerMessageTime);
    if (!Number.isFinite(playerMessageTime) || playerMessageTime < 0) {
      return null;
    }
    return {
      kind,
      vMs: Math.round(playerMessageTime),
      t: Math.max(0, Math.round(Number(message?.messageTime) || 0)),
      title: normalizeVodTitleText(title),
    };
  }

  // 방장·매니저의 명령과 치지직의 성공 안내가 모두 확인된 경우만 제목 변경으로
  // 확정한다. 메시지는 API 페이지 순서와 무관하게 마지막에 재생 위치순으로 맞춘다.
  function createVodTitleChangeTracker() {
    const entries = [];
    return Object.freeze({
      add(message) {
        const text = String(message?.content || "").trim();
        if (!text) return;
        const command = text.match(
          /^!(?:방제변경|방재변경|방송제목변경|제목변경)\s+([\s\S]+)$/,
        );
        if (command && isVodTitleChangeAuthor(message)) {
          const entry = vodTitleChangeEntry(message, "command", command[1]);
          if (entry?.title) entries.push(entry);
          return;
        }
        const response = text.match(
          /^방송\s*제목이\s*변경되었습니다\s*:\s*([\s\S]+)$/,
        );
        if (response) {
          const entry = vodTitleChangeEntry(message, "response", response[1]);
          if (entry?.title) entries.push(entry);
        }
      },
      finish() {
        const ordered = entries
          .slice()
          .sort((a, b) => a.vMs - b.vMs || a.t - b.t);
        const commands = ordered.filter((entry) => entry.kind === "command");
        const responses = ordered.filter((entry) => entry.kind === "response");
        const used = new Set();
        const changes = [];
        for (const entry of responses) {
          for (let index = commands.length - 1; index >= 0; index -= 1) {
            if (used.has(index)) continue;
            const command = commands[index];
            const delta = entry.vMs - command.vMs;
            if (delta < 0 || delta > VOD_TITLE_CHANGE_MATCH_WINDOW_MS) {
              continue;
            }
            if (command.title !== entry.title) continue;
            used.add(index);
            changes.push({
              v: Math.round(entry.vMs / 1000),
              t: entry.t,
              title: entry.title,
            });
            break;
          }
        }
        return normalizeVodTitleChanges(changes);
      },
    });
  }

  async function loadVodTitleChanges(storage, videoNo) {
    const key = vodTitleChangeKey(videoNo);
    if (!key) return { complete: false, items: [] };
    const value = (await storage.get(key))?.[key];
    return {
      complete: value?.complete === true,
      items: normalizeVodTitleChanges(value),
    };
  }

  async function saveVodTitleChanges(storage, videoNo, items) {
    const key = vodTitleChangeKey(videoNo);
    if (!key) return false;
    await storage.set({
      [key]: {
        v: 1,
        at: Date.now(),
        complete: true,
        items: normalizeVodTitleChanges(items),
      },
    });
    return true;
  }

  async function writeMerged(
    storage,
    state,
    sourceItems,
    chunkMax = DEFAULT_CHUNK_MAX,
  ) {
    const max = Math.max(
      100,
      Math.floor(Number(chunkMax) || DEFAULT_CHUNK_MAX),
    );
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
          Array.from({ length: state.parts - nextParts }, (_, index) =>
            partKey(baseKey, nextParts + index + 1),
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
    compactVodRows,
    reconcileCompleteVodRows,
    createVodTitleChangeTracker,
    loadVodTitleChanges,
    normalizeVodTitleChanges,
    saveVodTitleChanges,
    vodTitleChangeKey,
    vodFallbackKey,
    vodIdentityKey,
    writeMerged,
  });
})();
