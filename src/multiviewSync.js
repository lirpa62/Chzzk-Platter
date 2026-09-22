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

  function reference(ids, stats, readyAt, current, now = Date.now()) {
    let candidates = ids.filter((id) => eligible(stats.get(id), readyAt.get(id), now, true));
    if (!candidates.length) {
      candidates = ids.filter((id) => eligible(stats.get(id), readyAt.get(id), now));
    }
    if (!candidates.length) return null;
    const slowest = candidates.reduce((a, b) =>
      stats.get(a).nativeDelaySec >= stats.get(b).nativeDelaySec ? a : b);
    if (candidates.includes(current) &&
      stats.get(slowest).nativeDelaySec - stats.get(current).nativeDelaySec <= LIMITS.stickySec
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
    if (!referenceStats || referenceStats.nativeDelaySec === null) return null;
    return Math.max(0, referenceStats.nativeDelaySec + (finite(offset, -600, 600) || 0));
  }

  function seekTarget(stats, delay, threshold = LIMITS.seekThresholdSec) {
    if (!stats || delay === null || !eligible(stats, stats.receivedAt, stats.receivedAt)) return null;
    const delta = stats.nativeDelaySec - delay;
    if (Math.abs(delta) < threshold) return null;
    const next = stats.currentTime + Math.max(-LIMITS.maxSeekSec, Math.min(LIMITS.maxSeekSec, delta));
    return next >= stats.seekableStart + 0.05 && next <= stats.seekableEnd - 0.05
      ? next : null;
  }

  function rateFor(error, active) {
    const magnitude = Math.abs(error);
    if (magnitude <= LIMITS.rateStopSec || (!active && magnitude < LIMITS.rateStartSec)) return 1;
    const amount = magnitude >= 2 ? 0.05 : magnitude >= 1 ? 0.03 : 0.01;
    return error > 0 ? 1 - amount : 1 + amount;
  }

  function rateOwnership(owned, target, actual) {
    if (owned && Math.abs(actual - target) <= LIMITS.userRateEpsilon) {
      return { owned: true, userOverride: false };
    }
    return { owned: false, userOverride: Math.abs(actual - 1) > LIMITS.userRateEpsilon };
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

  const api = { LIMITS, sample, normalize, eligible, reference, rebaseOffsets,
    targetDelay, seekTarget, rateFor, rateOwnership, congestion };
  root.CheeseMultiviewSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
