const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const source = readFileSync("src/audioMixer.js", "utf8");
const content = readFileSync("src/content.js", "utf8");
const clampStart = source.indexOf("  function clampGain(g) {");
const clampEnd = source.indexOf("  function gainToNorm(g)", clampStart);
const start = source.indexOf("  function updateGainRange(rawMin, rawMax, rawStep) {");
const end = source.indexOf("  // 게인 슬라이더 마크업", start);
assert(clampStart >= 0 && clampEnd > clampStart, "gain clamp helper is missing");
assert(start >= 0 && end > start, "gain range update functions are missing");

const context = {
  GAIN_MIN: 0.5,
  GAIN_MAX: 2,
  GAIN_STEP: 0.05,
  gainRangeReceived: false,
  state: { gain: 0.15 },
  applyState() {},
  syncMasterGain() {},
  syncMixerButtonLabel() {},
};
vm.runInNewContext(
  `${source.slice(clampStart, clampEnd)}\n${source.slice(start, end)}\nthis.apply = applyLoadedGainRange;`,
  context,
);

assert.equal(
  context.apply({
    mixerGainRangeLoaded: false,
    mixerGainMin: 0.5,
    mixerGainMax: 2,
    mixerGainStep: 5,
  }),
  false,
  "temporary pre-load range must be ignored",
);
assert.equal(context.gainRangeReceived, false);
assert.equal(context.state.gain, 0.15, "saved gain must survive the early message");

assert.equal(
  context.apply({
    mixerGainRangeLoaded: true,
    mixerGainMin: 0,
    mixerGainMax: 2,
    mixerGainStep: 5,
  }),
  true,
  "loaded range must be accepted",
);
assert.equal(context.gainRangeReceived, true);
assert.equal(context.GAIN_MIN, 0);
assert.equal(
  context.state.gain,
  0.15,
  "loaded 0-200% range must preserve 15% gain",
);

assert.match(
  content,
  /mixerGainRangeLoaded:\s*featureFlagsLoaded/,
  "content bridge must report the global gain range load state explicitly",
);
const featureFlagsStart = content.indexOf("function applyFeatureFlags(value)");
const flagsLoadedAt = content.indexOf("featureFlagsLoaded = true;", featureFlagsStart);
const flagsBroadcastAt = content.indexOf("broadcastFeatureFlags();", flagsLoadedAt);
const loadSettingsStart = content.indexOf("async function loadFeatureFlags()");
const gainLoadedAt = content.indexOf(
  "mixerGainMin = normalizeGainMin(data?.[MIXER_GAIN_MIN_KEY]);",
  loadSettingsStart,
);
const flagsAppliedAt = content.indexOf("applyFeatureFlags(data?.[FEATURE_HIDDEN_KEY]);", gainLoadedAt);
assert(
  featureFlagsStart >= 0 && flagsLoadedAt > featureFlagsStart &&
    flagsBroadcastAt > flagsLoadedAt && gainLoadedAt >= loadSettingsStart &&
    flagsAppliedAt > gainLoadedAt,
  "the explicit range-ready signal must follow persisted mixer range loading",
);

console.log("오디오 믹서 게인 범위 로딩 경합 검증 통과");
