// 멀티뷰 라이브 싱크 진단 기록과 내보내기 요약.
((root) => {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_RECORDS = 10000;
  const LIMIT_KEYS = Object.freeze([
    "sampleMs",
    "staleMs",
    "settlingMs",
    "stickySec",
    "seekThresholdSec",
    "seekCooldownMs",
    "maxSeekSec",
    "commandTimeoutMs",
    "commandRetryMs",
    "userRateEpsilon",
    "rateStartSec",
    "rateStopSec",
    "congestionEdgeSec",
    "congestionCount",
    "congestionEnterMs",
    "congestionExitMs",
  ]);

  function createRecorder(maxRecords = MAX_RECORDS) {
    const limit = Number.isSafeInteger(maxRecords) && maxRecords > 0
      ? maxRecords : MAX_RECORDS;
    const slots = new Array(limit);
    let start = 0;
    let size = 0;

    return {
      maxRecords: limit,
      get size() { return size; },
      add(record) {
        if (!record || typeof record !== "object") return false;
        if (size < limit) {
          slots[(start + size) % limit] = record;
          size += 1;
        } else {
          slots[start] = record;
          start = (start + 1) % limit;
        }
        return true;
      },
      clear() {
        slots.fill(undefined);
        start = 0;
        size = 0;
      },
      toArray() {
        return Array.from({ length: size }, (_, index) =>
          slots[(start + index) % limit]);
      },
    };
  }

  const finiteValues = (values) => values.filter(Number.isFinite);

  function percentile(values, ratio) {
    const sorted = finiteValues(values).sort((a, b) => a - b);
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const position = Math.max(0, Math.min(1, ratio)) * (sorted.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  }

  const rounded = (value) => Number.isFinite(value)
    ? Math.round(value * 1000) / 1000 : null;

  function distribution(values, percentiles = false) {
    const list = finiteValues(values);
    if (!list.length) return null;
    const total = list.reduce((sum, value) => sum + value, 0);
    const result = {
      avg: rounded(total / list.length),
      median: rounded(percentile(list, 0.5)),
      min: rounded(Math.min(...list)),
      max: rounded(Math.max(...list)),
    };
    if (percentiles) {
      result.p90 = rounded(percentile(list, 0.9));
      result.p95 = rounded(percentile(list, 0.95));
    }
    return result;
  }

  function channelSummary(channelId, entry) {
    const rateSamples = entry.playbackRates.length;
    return {
      channelId,
      channelName: entry.channelName,
      sampleCount: entry.sampleCount,
      nativeDelaySec: distribution(entry.nativeDelays),
      edgeLagSec: (() => {
        const stats = distribution(entry.edgeLags);
        return stats ? { avg: stats.avg, max: stats.max } : null;
      })(),
      nonDefaultPlaybackRateRatio: rateSamples
        ? rounded(entry.nonDefaultRateSamples / rateSamples) : null,
      seekCommandCount: entry.seekCommands,
      rateCommandCount: entry.rateCommands,
      failureReasons: { ...entry.failureReasons },
      absoluteSyncErrorSec: distribution(entry.absoluteErrors, true),
    };
  }

  function summarize(records, options = {}) {
    const list = Array.isArray(records) ? records : [];
    const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : 0;
    const endedAt = Number.isFinite(options.endedAt) ? options.endedAt : startedAt;
    const channels = new Map();
    const ensureChannel = (record) => {
      const id = typeof record.channelId === "string" ? record.channelId : "";
      if (!id) return null;
      if (!channels.has(id)) {
        channels.set(id, {
          channelName: "",
          sampleCount: 0,
          nativeDelays: [],
          edgeLags: [],
          playbackRates: [],
          nonDefaultRateSamples: 0,
          absoluteErrors: [],
          seekCommands: 0,
          rateCommands: 0,
          failureReasons: {},
        });
      }
      const entry = channels.get(id);
      if (typeof record.channelName === "string" && record.channelName) {
        entry.channelName = record.channelName;
      }
      return entry;
    };
    let sampleCount = 0;
    let commandCount = 0;
    let commandSuccessCount = 0;
    let commandFailureCount = 0;
    let commandTimeoutCount = 0;
    let congestionEntryCount = 0;
    let referenceChangeCount = 0;

    for (const record of list) {
      if (!record || typeof record !== "object") continue;
      const entry = ensureChannel(record);
      if (record.type === "sample") {
        sampleCount += 1;
        if (!entry) continue;
        entry.sampleCount += 1;
        if (Number.isFinite(record.nativeDelaySec)) entry.nativeDelays.push(record.nativeDelaySec);
        if (Number.isFinite(record.edgeLagSec)) entry.edgeLags.push(record.edgeLagSec);
        if (Number.isFinite(record.playbackRate)) {
          entry.playbackRates.push(record.playbackRate);
          if (Math.abs(record.playbackRate - 1) > 0.0001) entry.nonDefaultRateSamples += 1;
        }
        if (Number.isFinite(record.syncErrorSec)) {
          entry.absoluteErrors.push(Math.abs(record.syncErrorSec));
        }
      } else if (record.type === "command") {
        commandCount += 1;
        if (!entry) continue;
        if (record.command === "seek") entry.seekCommands += 1;
        if (record.command === "rate") entry.rateCommands += 1;
      } else if (record.type === "command-result") {
        if (record.applied) commandSuccessCount += 1;
        else {
          commandFailureCount += 1;
          if (entry) {
            const reason = typeof record.reason === "string" && record.reason
              ? record.reason : "unknown";
            entry.failureReasons[reason] = (entry.failureReasons[reason] || 0) + 1;
          }
        }
      } else if (record.type === "command-timeout") {
        commandTimeoutCount += 1;
        if (entry) entry.failureReasons.timeout = (entry.failureReasons.timeout || 0) + 1;
      } else if (record.type === "congestion-change" && record.active) {
        congestionEntryCount += 1;
      } else if (record.type === "reference-change") {
        referenceChangeCount += 1;
      }
    }

    return {
      durationMs: Math.max(0, endedAt - startedAt),
      channelCount: Number.isSafeInteger(options.channelCount)
        ? options.channelCount : channels.size,
      sampleCount,
      commandCount,
      commandSuccessCount,
      commandFailureCount,
      commandTimeoutCount,
      congestionEntryCount,
      referenceChangeCount,
      channels: [...channels.entries()].map(([id, entry]) => channelSummary(id, entry)),
    };
  }

  function configFromLimits(limits) {
    const config = {};
    for (const key of LIMIT_KEYS) {
      if (Number.isFinite(limits?.[key])) config[key] = limits[key];
    }
    return config;
  }

  function createExport({ records, startedAt, exportedAt, channelCount, limits }) {
    const list = Array.isArray(records) ? records : [];
    const end = Number.isFinite(exportedAt) ? exportedAt : Date.now();
    const start = Number.isFinite(startedAt) ? startedAt : end;
    return {
      schemaVersion: SCHEMA_VERSION,
      startedAt: start,
      exportedAt: end,
      channelCount: Number.isSafeInteger(channelCount) ? channelCount : 0,
      config: configFromLimits(limits),
      summary: summarize(list, { startedAt: start, endedAt: end, channelCount }),
      records: list,
    };
  }

  function formatDuration(durationMs) {
    const total = Math.max(0, Math.floor((Number(durationMs) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  const metricText = (value) => Number.isFinite(value) ? value.toFixed(2) : "-";

  function formatSummary(summary) {
    const lines = [
      "CHZZK Platter 멀티뷰 싱크 진단",
      `측정 시간: ${formatDuration(summary?.durationMs)}`,
      `채널 수: ${summary?.channelCount || 0}`,
      `샘플: ${summary?.sampleCount || 0}`,
      `명령: ${summary?.commandCount || 0} (성공 ${summary?.commandSuccessCount || 0}, 실패 ${summary?.commandFailureCount || 0}, timeout ${summary?.commandTimeoutCount || 0})`,
      `연결 지연 진입: ${summary?.congestionEntryCount || 0}`,
      `기준 변경: ${summary?.referenceChangeCount || 0}`,
    ];
    for (const channel of summary?.channels || []) {
      const name = channel.channelName || channel.channelId;
      const delay = channel.nativeDelaySec;
      const error = channel.absoluteSyncErrorSec;
      lines.push(
        "",
        `[${name}]`,
        `지연 평균/중앙/최소/최대: ${metricText(delay?.avg)} / ${metricText(delay?.median)} / ${metricText(delay?.min)} / ${metricText(delay?.max)}초`,
        `엣지 평균/최대: ${metricText(channel.edgeLagSec?.avg)} / ${metricText(channel.edgeLagSec?.max)}초`,
        `1.0x 외 배속 비율: ${Number.isFinite(channel.nonDefaultPlaybackRateRatio) ? (channel.nonDefaultPlaybackRateRatio * 100).toFixed(1) : "-"}%`,
        `seek/rate 명령: ${channel.seekCommandCount} / ${channel.rateCommandCount}`,
        `|오차| 중앙/p90/p95/최대: ${metricText(error?.median)} / ${metricText(error?.p90)} / ${metricText(error?.p95)} / ${metricText(error?.max)}초`,
      );
    }
    return lines.join("\n");
  }

  const api = { SCHEMA_VERSION, MAX_RECORDS, createRecorder, percentile, summarize,
    configFromLimits, createExport, formatDuration, formatSummary };
  root.CheeseMultiviewDiagnostics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
