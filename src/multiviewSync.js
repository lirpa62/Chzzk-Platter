// 멀티뷰 프레임의 라이브 지연 계측과 세션별 보정 판단.
((root) => {
  "use strict";

  const LIMITS = Object.freeze({
    sampleMs: 1000,
    staleMs: 3500,
    settlingMs: 4000,
    stickySec: 0.5,
    seekThresholdSec: 0.7,
    seekCooldownMs: 30000,
    maxSeekSec: 4,
    commandTimeoutMs: 2000,
    commandRetryMs: 1500,
    userRateEpsilon: 0.02,
    rateStartSec: 0.7,
    rateStopSec: 0.15,
    congestionEdgeSec: 2,
    congestionCount: 3,
    congestionEnterMs: 4000,
    congestionExitMs: 5000,
  });

  const finite = (value, min = 0, max = 1000000000) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      ? value
      : null;

  function rangeEnd(ranges) {
    try {
      return ranges?.length ? finite(ranges.end(ranges.length - 1)) : null;
    } catch {
      return null;
    }
  }

  function sample(video, now = Date.now(), rateState = {}) {
    if (!video) return null;
    const currentTime = finite(video.currentTime);
    const seekableEnd = rangeEnd(video.seekable);
    const bufferedEnd = rangeEnd(video.buffered);
    const gap = (end) =>
      currentTime === null || end === null ? null : finite(Math.max(0, end - currentTime));
    return {
      currentTime,
      playbackRate: finite(video.playbackRate, 0.5, 2),
      syncRateOwned: rateState.syncRateOwned === true,
      userRateOverride: rateState.userRateOverride === true,
      paused: video.paused === true,
      readyState: Number.isInteger(video.readyState) ? video.readyState : 0,
      nativeDelaySec: gap(seekableEnd),
      bufferAheadSec: gap(bufferedEnd),
      edgeLagSec:
        seekableEnd === null || bufferedEnd === null
          ? null
          : finite(Math.max(0, seekableEnd - bufferedEnd)),
      seekableStart: (() => {
        try { return video.seekable?.length ? finite(video.seekable.start(0)) : null; }
        catch { return null; }
      })(),
      seekableEnd,
      sampledAt: now,
    };
  }

  function normalize(raw, receivedAt = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.paused !== "boolean") return null;
    if (typeof raw.syncRateOwned !== "boolean" || typeof raw.userRateOverride !== "boolean") return null;
    const seekableStart = finite(raw.seekableStart);
    const seekableEnd = finite(raw.seekableEnd);
    const currentTime = finite(raw.currentTime);
    const nativeDelaySec = finite(raw.nativeDelaySec, 0, 86400);
    const bufferAheadSec = finite(raw.bufferAheadSec, 0, 86400);
    const edgeLagSec = finite(raw.edgeLagSec, 0, 86400);
    // 지금 화면 장면의 실제 송출 시각 기준 지연(PROGRAM-DATE-TIME). 내 PC 시계와 치지직
    // 시계의 차이만큼 음수일 수도 있지만 채널끼리는 같은 차이라 비교에 쓸 수 있다.
    const absoluteDelaySec = typeof raw.absoluteDelaySec === "number" &&
      Number.isFinite(raw.absoluteDelaySec) && raw.absoluteDelaySec >= -60 &&
      raw.absoluteDelaySec <= 86400 ? raw.absoluteDelaySec : null;
    if (seekableStart !== null && seekableEnd !== null && seekableStart > seekableEnd) return null;
    if (currentTime !== null && seekableEnd !== null && currentTime > seekableEnd + 1) return null;
    if (currentTime !== null && seekableEnd !== null && nativeDelaySec !== null &&
        Math.abs(nativeDelaySec - Math.max(0, seekableEnd - currentTime)) > 1) return null;
    return {
      currentTime,
      playbackRate: finite(raw.playbackRate, 0.5, 2),
      paused: raw.paused === true,
      syncRateOwned: raw.syncRateOwned,
      userRateOverride: raw.userRateOverride,
      readyState: Number.isInteger(raw.readyState) && raw.readyState >= 0 && raw.readyState <= 4
        ? raw.readyState : 0,
      nativeDelaySec,
      absoluteDelaySec,
      bufferAheadSec,
      edgeLagSec,
      seekableStart,
      seekableEnd,
      generation: Number.isInteger(raw.generation) && raw.generation >= 0 && raw.generation <= 1000000
        ? raw.generation : null,
      receivedAt,
    };
  }

  function eligible(stats, readyAt, now = Date.now(), settling = false) {
    return !!stats && now - stats.receivedAt <= LIMITS.staleMs &&
      (!settling || (Number.isFinite(readyAt) && now - readyAt >= LIMITS.settlingMs)) &&
      !stats.paused && stats.readyState >= 2 &&
      stats.nativeDelaySec !== null && stats.currentTime !== null &&
      stats.seekableStart !== null && stats.seekableEnd !== null;
  }

  // 채널끼리 맞출 때 쓰는 지연. 각 방송의 라이브 끝까지 거리(nativeDelaySec)는 방송마다
  // 라이브 끝 자체가 실제 시각보다 늦는 정도가 달라, 그 값을 같게 맞추면 지연이 짧게 잰
  // 채널이 오히려 뒤처졌다(실측 0.2초). 모든 채널에 실제 송출 시각 기준 지연이 있으면
  // 그것으로 맞추고(alignDelays 가 정한다), 없으면 예전 값으로 맞춘다.
  function alignDelay(stats) {
    if (!stats) return null;
    return typeof stats.alignDelaySec === "number" ? stats.alignDelaySec : stats.nativeDelaySec;
  }

  // 맞출 기준을 채널 묶음 전체에 한 번에 정한다. 섞어 쓰면 두 기준의 차이만큼 어긋난다.
  function alignDelays(statsList) {
    const list = (statsList || []).filter(Boolean);
    const absolute = list.length > 0 && list.every((stats) => stats.absoluteDelaySec !== null &&
      stats.absoluteDelaySec !== undefined);
    for (const stats of list) {
      stats.alignDelaySec = absolute ? stats.absoluteDelaySec : stats.nativeDelaySec;
    }
    return absolute ? "absolute" : "native";
  }

  function reference(ids, stats, readyAt, current, now = Date.now()) {
    let candidates = ids.filter((id) => eligible(stats.get(id), readyAt.get(id), now, true));
    if (!candidates.length) {
      candidates = ids.filter((id) => eligible(stats.get(id), readyAt.get(id), now));
    }
    if (!candidates.length) return null;
    const slowest = candidates.reduce((a, b) =>
      alignDelay(stats.get(a)) >= alignDelay(stats.get(b)) ? a : b);
    if (candidates.includes(current) &&
      alignDelay(stats.get(slowest)) - alignDelay(stats.get(current)) <= LIMITS.stickySec
    ) return current;
    return slowest;
  }

  function rebaseOffsets(offsets, nextReference, channelIds) {
    const base = finite(offsets[nextReference] || 0, -600, 600) || 0;
    const updated = {};
    for (const id of channelIds) {
      const value = offsets[id];
      updated[id] = id === nextReference ? 0 :
        Math.round(((finite(value, -600, 600) || 0) - base) * 10) / 10;
    }
    return updated;
  }

  function targetDelay(referenceStats, offset = 0) {
    const base = alignDelay(referenceStats);
    if (base === null || base === undefined) return null;
    const delay = base + (finite(offset, -600, 600) || 0);
    // 실제 지연 기준이면 시계 차이로 음수일 수 있어 0 으로 자르지 않는다.
    const absoluteMode = typeof referenceStats.absoluteDelaySec === "number" &&
      referenceStats.alignDelaySec === referenceStats.absoluteDelaySec;
    return absoluteMode ? delay : Math.max(0, delay);
  }

  function seekTarget(stats, delay, threshold = LIMITS.seekThresholdSec) {
    if (!stats || delay === null || !eligible(stats, stats.receivedAt, stats.receivedAt)) return null;
    // 두 지연 모두 재생 위치와 1:1 로 움직이므로, 차이만큼 옮기면 목표에 닿는다.
    const delta = alignDelay(stats) - delay;
    if (Math.abs(delta) < threshold) return null;
    const next = stats.currentTime + Math.max(-LIMITS.maxSeekSec, Math.min(LIMITS.maxSeekSec, delta));
    return next >= stats.seekableStart + 0.05 && next <= stats.seekableEnd - 0.05
      ? next : null;
  }

  function rateFor(error, active) {
    const magnitude = Math.abs(error);
    if (magnitude <= LIMITS.rateStopSec || (!active && magnitude < LIMITS.rateStartSec)) return 1;
    const amount = magnitude >= 2 ? 0.05 : magnitude >= 1 ? 0.03 : 0.01;
    // ⚠ 빠르게는 1.03 을 쓰지 않는다. 치지직 플레이어의 자체 따라잡기 배속이 정확히
    //   1.03 이라, 그 값이면 플레이어가 자기 따라잡기로 알고 버퍼가 줄면 1× 로 되돌린다.
    return error > 0 ? 1 - amount : 1 + (amount === 0.03 ? 0.04 : amount);
  }

  // 치지직 플레이어 자체 따라잡기 배속(버퍼 4초 초과 → 1.03×, 2초 이하 → 1×).
  // ⚠ 사용자 배속으로 치면 지연 6~7초(버퍼 4초 안팎) 칸이 '배속 사용 중' 과 아님을
  //   오가고, 그동안 따라잡기·자동 싱크에서도 빠진다. 치지직 배속 메뉴에는 없는 값이다.
  const PLAYER_CATCH_UP_RATE = 1.03;

  function isUserRate(rate) {
    if (typeof rate !== "number" || !Number.isFinite(rate)) return false;
    return Math.abs(rate - 1) > LIMITS.userRateEpsilon &&
      Math.abs(rate - PLAYER_CATCH_UP_RATE) > 0.005;
  }

  function rateOwnership(owned, target, actual) {
    if (owned && Math.abs(actual - target) <= LIMITS.userRateEpsilon) {
      return { owned: true, userOverride: false };
    }
    return { owned: false, userOverride: isUserRate(actual) };
  }

  function congestion(previous, stats, ids, now = Date.now()) {
    const bad = ids.filter((id) => (stats.get(id)?.edgeLagSec || 0) >= LIMITS.congestionEdgeSec).length;
    const wanted = bad >= LIMITS.congestionCount;
    if (wanted === previous.active) return { active: previous.active, since: 0 };
    const since = previous.since || now;
    const threshold = wanted ? LIMITS.congestionEnterMs : LIMITS.congestionExitMs;
    return now - since >= threshold
      ? { active: wanted, since: 0 }
      : { active: previous.active, since };
  }

  // 칸별 라이브 따라잡기. 디코딩이 실시간을 못 따라가면(소프트웨어 디코딩 + 여러 칸)
  // 버퍼는 쌓이는데 재생 위치가 밀려 지연이 계속 늘어난다. 배속은 CPU 를 더 쓰므로
  // 상한을 넘은 칸만 라이브 쪽으로 한 번에 옮긴다.
  const CATCH_UP = Object.freeze({
    // 기본 상한. 설정(cheeseMultiviewLiveCatchUpLimit)으로 minLimitSec~limitSec 사이를 고른다.
    limitSec: 8,
    minLimitSec: 2,
    targetSec: 3,
    // 상한이 낮을 때의 목표 하한. 라이브 끝에 너무 붙이면 버퍼가 없어 멈칫한다.
    minTargetSec: 1.5,
    // 한 번 튄 값으로는 움직이지 않는다(탭 복귀 직후는 예외).
    confirmMs: 2000,
    // 옮긴 뒤에도 안 줄면(명령 실패, 플레이어 재초기화) 연달아 보내지 않는다.
    cooldownMs: 15000,
    // 지연 증가와 재생 위치의 역행이 함께 있어야 되감기로 본다. 자동 싱크 seek(최대
    // maxSeekSec)와 재생 밀림(초당 1초 미만)으로는 나오지 않는 크기다.
    rewindJumpSec: LIMITS.maxSeekSec + 0.5,
    // 되감기 판정에 쓰는 이전 샘플의 최대 간격.
    rewindSampleGapMs: 3000,
    // 우리가 옮긴 직후의 지연 변화는 되감기 판정에서 뺀다.
    ownSeekQuietMs: 3000,
  });

  // 지연 증가만으로는 되감기를 알 수 없다. 재생이 멈춘 사이 라이브 끝만
  // 앞으로 가도 같은 증가가 생기므로, 실제 재생 위치가 뒤로 이동했는지도 본다.
  function isRewind(previous, stats, quietUntil = 0) {
    if (!previous || !stats) return false;
    if (previous.generation !== stats.generation) return false;
    if (stats.receivedAt < quietUntil) return false;
    if (stats.receivedAt - previous.receivedAt > CATCH_UP.rewindSampleGapMs) return false;
    if (previous.nativeDelaySec === null || stats.nativeDelaySec === null) return false;
    if (!Number.isFinite(previous.currentTime) || !Number.isFinite(stats.currentTime) ||
        previous.currentTime - stats.currentTime < 0.5) return false;
    if (Number.isFinite(previous.seekableEnd) && Number.isFinite(stats.seekableEnd) &&
        stats.seekableEnd < previous.seekableEnd - 1) return false;
    return stats.nativeDelaySec - previous.nativeDelaySec >= CATCH_UP.rewindJumpSec;
  }

  // 함께 움직일 칸들(자동 싱크 그룹 또는 단독 칸)의 목표 지연.
  // 가장 느린 칸이 상한을 넘으면 모두 같은 양만큼 앞당겨 서로의 간격을 유지한다.
  // 가장 빠른 칸이 목표에 오도록 옮긴다(어느 칸도 목표보다 앞으로 보내지 않는다).
  // ⚠ 간격이 큰 묶음은 느린 칸이 다시 상한 근처에 남는다. 상한 - 2초에서 자른다.
  // 설정값 → 상한(초). 정수 minLimitSec~limitSec, 알 수 없는 값은 기본 상한.
  function catchUpLimit(value) {
    if (value == null || value === "") return CATCH_UP.limitSec;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return CATCH_UP.limitSec;
    return Math.min(CATCH_UP.limitSec, Math.max(CATCH_UP.minLimitSec, n));
  }

  // 상한에 맞는 목표 지연. 상한 4초 이상은 기본 목표(3초), 그 아래는 상한보다 1초 앞
  // (하한 minTargetSec). 옮긴 직후 다시 상한을 넘지 않을 여유를 둔다.
  function catchUpTarget(limit) {
    const cap = catchUpLimit(limit);
    return Math.max(CATCH_UP.minTargetSec, Math.min(CATCH_UP.targetSec, cap - 1));
  }

  // members: [{ id, delaySec }] → [{ id, targetDelaySec }]
  function catchUpTargets(members, limit = CATCH_UP.limitSec, target = catchUpTarget(limit)) {
    const valid = (members || []).filter((m) => finite(m?.delaySec, 0, 86400) !== null);
    if (!valid.length) return [];
    const delays = valid.map((m) => m.delaySec);
    if (Math.max(...delays) < limit) return [];
    const fastest = Math.min(...delays);
    const ceiling = Math.max(target, limit - 2);
    return valid
      .map((m) => ({
        id: m.id,
        delaySec: m.delaySec,
        targetDelaySec: Math.round(
          Math.min(ceiling, target + (m.delaySec - fastest)) * 10) / 10,
      }))
      .filter((m) => m.delaySec - m.targetDelaySec >= 0.5)
      .map(({ id, targetDelaySec }) => ({ id, targetDelaySec }));
  }

  const api = { LIMITS, CATCH_UP, sample, normalize, eligible, alignDelay, alignDelays,
    reference, rebaseOffsets,
    targetDelay, seekTarget, rateFor, isUserRate, rateOwnership, congestion, isRewind,
    catchUpLimit, catchUpTarget, catchUpTargets };
  root.CheeseMultiviewSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
