const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const source = readFileSync("src/audioMixer.js", "utf8");
const start = source.indexOf("  function applyMixerPowerUserIntent(");
const end = source.indexOf("  function ensureEnabledGraph()", start);
assert(start >= 0 && end > start, "shared mixer power handler is missing");

function fixture(overrides = {}) {
  const saves = [];
  const changes = [];
  const context = {
    stateLoaded: true,
    mixerAlwaysOn: false,
    mixerDefaultOn: false,
    mixerDefaultOffThisPage: false,
    graphConflict: false,
    state: { enabled: false, userDisabled: false },
    audio: { connected: true, ctx: { state: "running" } },
    findVideo: () => ({}),
    setEnabled(value) { context.state.enabled = value; changes.push(value); },
    saveState(options) { saves.push(options); },
    ...overrides,
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.apply = applyMixerPowerUserIntent;`, context);
  return { context, changes, saves };
}

{
  const { context, changes } = fixture({ mixerAlwaysOn: true,
    state: { enabled: true, userDisabled: false } });
  assert.equal(context.apply(false), "confirmation-required");
  assert.deepEqual(changes, []);
  assert.equal(context.state.enabled, true);
  assert.equal(context.apply(false, true), null);
  assert.equal(context.state.userDisabled, true);
  assert.equal(context.state.enabled, false);
}

{
  const { context } = fixture({ mixerDefaultOn: true,
    state: { enabled: true, userDisabled: false } });
  assert.equal(context.apply(false), null);
  assert.equal(context.mixerDefaultOffThisPage, true);
  assert.equal(context.state.userDisabled, false);
  assert.equal(context.apply(true), null);
  assert.equal(context.mixerDefaultOffThisPage, false);
}

{
  const { context, changes } = fixture({ findVideo: () => null });
  assert.equal(context.apply(true), "no-video");
  assert.deepEqual(changes, []);
  assert.equal(context.state.userDisabled, false);
}

console.log("멀티뷰 믹서 전원 의도 검증 통과");
