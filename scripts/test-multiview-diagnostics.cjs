const assert = require("node:assert/strict");
const DIAG = require("../src/multiviewDiagnostics.js");

const test = (name, run) => {
  run();
  console.log(`  PASS ${name}`);
};

test("레코드 상한을 넘으면 가장 오래된 항목부터 버린다", () => {
  const recorder = DIAG.createRecorder(3);
  for (let sequence = 1; sequence <= 5; sequence += 1) recorder.add({ sequence });
  assert.equal(recorder.size, 3);
  assert.deepEqual(recorder.toArray().map((record) => record.sequence), [3, 4, 5]);
  recorder.clear();
  assert.equal(recorder.size, 0);
});

const records = [
  { type: "sample", timestamp: 1000, channelId: "a", channelName: "A",
    nativeDelaySec: 5, edgeLagSec: 0.2, playbackRate: 1, syncErrorSec: 0 },
  { type: "sample", timestamp: 1000, channelId: "b", channelName: "B",
    nativeDelaySec: 3, edgeLagSec: 0.5, playbackRate: 0.95, syncErrorSec: 2 },
  { type: "sample", timestamp: 2000, channelId: "b", channelName: "B",
    nativeDelaySec: 4, edgeLagSec: 1, playbackRate: 1, syncErrorSec: 1 },
  { type: "sample", timestamp: 3000, channelId: "b", channelName: "B",
    nativeDelaySec: 5, edgeLagSec: 1.5, playbackRate: 1, syncErrorSec: 0 },
  { type: "command", timestamp: 1200, channelId: "b", command: "seek" },
  { type: "command", timestamp: 1500, channelId: "b", command: "rate" },
  { type: "command-result", timestamp: 1600, channelId: "b", applied: true },
  { type: "command-result", timestamp: 1700, channelId: "b", applied: false, reason: "ad" },
  { type: "command-timeout", timestamp: 1800, channelId: "b" },
  { type: "reference-change", timestamp: 1900, fromChannelId: "a", toChannelId: "b" },
  { type: "congestion-change", timestamp: 2000, active: true },
  { type: "congestion-change", timestamp: 2500, active: false },
];

test("요약은 분포, 오차 백분위, 명령 결과를 계산한다", () => {
  const summary = DIAG.summarize(records, { startedAt: 1000, endedAt: 5000, channelCount: 2 });
  assert.equal(summary.durationMs, 4000);
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.commandCount, 2);
  assert.equal(summary.commandSuccessCount, 1);
  assert.equal(summary.commandFailureCount, 1);
  assert.equal(summary.commandTimeoutCount, 1);
  assert.equal(summary.congestionEntryCount, 1);
  assert.equal(summary.referenceChangeCount, 1);
  const channel = summary.channels.find((entry) => entry.channelId === "b");
  assert.deepEqual(channel.nativeDelaySec, { avg: 4, median: 4, min: 3, max: 5 });
  assert.deepEqual(channel.edgeLagSec, { avg: 1, max: 1.5 });
  assert.equal(channel.nonDefaultPlaybackRateRatio, 0.333);
  assert.equal(channel.seekCommandCount, 1);
  assert.equal(channel.rateCommandCount, 1);
  assert.deepEqual(channel.failureReasons, { ad: 1, timeout: 1 });
  assert.deepEqual(channel.absoluteSyncErrorSec,
    { avg: 1, median: 1, min: 0, max: 2, p90: 1.8, p95: 1.9 });
});

test("내보내기는 현재 임계값과 schemaVersion을 포함한다", () => {
  const limits = { sampleMs: 1000, settlingMs: 4000, stickySec: 0.5, ignored: 9 };
  const payload = DIAG.createExport({ records, startedAt: 1000, exportedAt: 5000,
    channelCount: 2, limits });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.channelCount, 2);
  assert.deepEqual(payload.config, { sampleMs: 1000, settlingMs: 4000, stickySec: 0.5 });
  assert.equal(payload.records, records);
  assert.match(DIAG.formatSummary(payload.summary), /\|오차\| 중앙\/p90\/p95\/최대/);
});

console.log("\n멀티뷰 싱크 진단 계산 통과");
