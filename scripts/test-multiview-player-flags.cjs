// Exercise the content-script settings, visibility, and feature-flag functions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/content.css"), "utf8");
const mixerSource = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
const filterSource = fs.readFileSync(path.join(root, "src/videoFilter.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  }\n", start);
  assert(start >= 0 && end > start, `${name} source missing`);
  return source.slice(start, end + 4);
}

const settingsStart = source.indexOf('  const MULTIVIEW_BTN_MIXER_KEY =');
const settingsEnd = source.indexOf('  let popupPlayerOn = false;', settingsStart);
const hideStart = source.indexOf('  const PLAYER_HIDE_ONLY_FLAGS = [');
const hideEnd = source.indexOf('];', hideStart);
assert(settingsStart >= 0 && settingsEnd > settingsStart);
assert(hideStart >= 0 && hideEnd > hideStart);
const settingsSource = source.slice(settingsStart, settingsEnd);
const hideSource = source.slice(hideStart, hideEnd + 2);
const effectiveSource = functionSource("getEffectiveFeatureFlags");
const seekSource = functionSource("getEffectiveLiveSeekBar");
const allHidden = {
  audioMixer: true, videoFilter: true, liveSync: true,
  streamStats: true, screenshotButton: true, liveRewind: true,
};
const buttons = [
  ["audioMixer", "cheeseMultiviewBtnMixer", "cheese-multiview-btn-mixer"],
  ["videoFilter", "cheeseMultiviewBtnFilter", "cheese-multiview-btn-filter"],
  ["liveSync", "cheeseMultiviewBtnSync", "cheese-multiview-btn-sync"],
  ["streamStats", "cheeseMultiviewBtnStats", "cheese-multiview-btn-stats"],
  ["screenshotButton", "cheeseMultiviewBtnScreenshot", "cheese-multiview-btn-screenshot"],
];

function frame(options = {}) {
  const classes = new Set();
  const classList = {
    add(name) { classes.add(name); },
    toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
    contains(name) { return classes.has(name); },
  };
  const context = vm.createContext({
    document: { documentElement: { classList } },
    featureFlags: { ...options.flags },
    IS_MULTIVIEW_CHAT_FRAME: options.chat === true,
    IS_MULTIVIEW_FRAME: options.multiview === true,
    IS_POPUP_PLAYER_FRAME: options.popup === true || options.multiview === true || options.chat === true,
    popupPlayerDisableHidden: options.popupDisableHidden === true,
    popupPlayerBtnMixer: options.popupMixer === true,
    popupPlayerBtnFilter: options.popupFilter === true,
    popupPlayerBtnSync: false,
    popupPlayerBtnStats: false,
    popupPlayerBtnScreenshot: false,
    popupPlayerBtnRewind: false,
    popupPlayerBtnForward: false,
    playerDisableHidden: true,
    liveSeekBar: true,
    popupPlayerSeekBar: false,
  });
  vm.runInContext(`${settingsSource}\n${hideSource}\n${options.effectiveSource || effectiveSource}\n${seekSource}`, context);
  return {
    classes,
    read(data) { context.__settings = data; vm.runInContext('readMultiviewSettings(__settings)', context); },
    apply() { vm.runInContext('applyMultiviewPlayerButtonClasses()', context); },
    flags() { return vm.runInContext('getEffectiveFeatureFlags()', context); },
    seek() { return vm.runInContext('getEffectiveLiveSeekBar()', context); },
    setGlobalFlags(flags) { context.featureFlags = { ...flags }; },
  };
}

(async () => {
  for (const [flag, setting, className] of buttons) {
    assert(css.includes(`html.cheese-multiview-frame:not(.${className})`), `${className} CSS missing`);
    for (const hidden of [false, true]) {
      for (const visible of [false, true]) {
        const cell = frame({ multiview: true, flags: { ...allHidden, [flag]: hidden } });
        cell.read({ [setting]: visible });
        cell.apply();
        assert.equal(cell.flags()[flag], false, `${flag}: global=${hidden}, button=${visible}`);
        assert.equal(cell.classes.has(className), visible, `${className}: button=${visible}`);
      }
    }
  }
  console.log("PASS mixer/filter/sync/stats/screenshot independence and visibility matrix");

  for (const [flag, setting] of buttons) {
    const cell = frame({ multiview: true, flags: allHidden, popupDisableHidden: true });
    cell.read({ cheeseMultiviewDisableHidden: true, [setting]: false });
    assert.equal(cell.flags()[flag], true, `${flag}: hidden multiview shortcut remained enabled`);
    cell.read({ cheeseMultiviewDisableHidden: true, [setting]: true });
    assert.equal(cell.flags()[flag], false, `${flag}: visible multiview control was disabled`);
  }
  const independent = frame({ multiview: true, flags: allHidden, popupDisableHidden: true });
  independent.read({ cheeseMultiviewBtnMixer: false });
  assert.equal(independent.flags().audioMixer, false);
  const rewindHidden = frame({ multiview: true, flags: allHidden });
  rewindHidden.read({ cheeseMultiviewDisableHidden: true, cheeseMultiviewSeekBar: true });
  assert.equal(rewindHidden.flags().liveRewind, true);
  assert.equal(rewindHidden.seek(), true);
  console.log("PASS multiview hidden-shortcut policy and seekbar independence");

  const pair = frame({ multiview: true, flags: allHidden });
  pair.read({ cheeseMultiviewBtnRewind: true, cheeseMultiviewBtnForward: false });
  pair.apply();
  assert.equal(pair.flags().liveRewind, false);
  assert(pair.classes.has("cheese-multiview-btn-rewind"));
  assert(!pair.classes.has("cheese-multiview-btn-forward"));
  pair.read({ cheeseMultiviewBtnRewind: false, cheeseMultiviewBtnForward: false,
    cheeseMultiviewSeekBar: true });
  pair.apply();
  assert.equal(pair.flags().liveRewind, false);
  assert.equal(pair.seek(), true);
  assert(!pair.classes.has("cheese-multiview-btn-rewind"));
  console.log("PASS rewind/forward pair and independent seek bar");

  const unsupported = frame({ multiview: true, flags: { ...allHidden, tabMute: true, speedButton: true } });
  assert.equal(unsupported.flags().tabMute, true);
  assert.equal(unsupported.flags().speedButton, true);
  const chat = frame({ chat: true, flags: allHidden });
  chat.apply();
  assert.equal(chat.flags().audioMixer, true);
  assert.equal(chat.flags().videoFilter, true);
  assert(!chat.classes.has("cheese-multiview-frame"));
  const normal = frame({ flags: allHidden });
  assert.equal(normal.flags().audioMixer, true);
  const popup = frame({ popup: true, popupDisableHidden: true, popupMixer: false,
    flags: allHidden });
  assert.equal(popup.flags().audioMixer, true);
  console.log("PASS unsupported flags, chat, normal, and popup isolation");

  for (const delay of [500, 2000]) {
    const cell = frame({ multiview: true, flags: allHidden });
    assert.equal(cell.flags().audioMixer, false, "preload flags must not hide mixer");
    await new Promise((resolve) => setTimeout(resolve, delay));
    cell.read({ cheeseMultiviewBtnMixer: true });
    cell.apply();
    assert.equal(cell.flags().audioMixer, false);
    assert(cell.classes.has("cheese-multiview-btn-mixer"));
  }
  const loadAt = source.indexOf("readMultiviewSettings(data);");
  const loadBlock = source.slice(loadAt, loadAt + 600);
  const classAt = loadBlock.indexOf("applyMultiviewPlayerButtonClasses();");
  const readyAt = loadBlock.indexOf("multiviewSettingsLoaded = true;");
  const broadcastAt = loadBlock.indexOf("if (IS_POPUP_PLAYER_FRAME) broadcastFeatureFlags();");
  assert(loadAt >= 0 && classAt > 0 && readyAt > classAt && broadcastAt > readyAt);
  assert(/settingsLoaded: IS_MULTIVIEW_FRAME\s*\? featureFlagsLoaded && multiviewSettingsLoaded/.test(source));
  console.log("PASS delayed settings and post-load broadcast wiring");

  const mixerReceiver = mixerSource.match(/featureFlags\.audioMixer = f\.audioMixer === true;/)?.[0];
  const filterReceiver = filterSource.match(/featureFlags\.videoFilter = e\.data\.flags\?\.videoFilter === true;/)?.[0];
  assert(mixerReceiver && filterReceiver, "MAIN-world feature receivers missing");
  const mixerRuntime = { featureFlags: { audioMixer: true }, f: { audioMixer: false } };
  vm.runInNewContext(mixerReceiver, mixerRuntime);
  assert.equal(mixerRuntime.featureFlags.audioMixer, false);
  const filterRuntime = { featureFlags: { videoFilter: true }, e: { data: { flags: { videoFilter: false } } } };
  vm.runInNewContext(filterReceiver, filterRuntime);
  assert.equal(filterRuntime.featureFlags.videoFilter, false);
  assert(/forceFullTick = true;\s*if \(typeof tick === "function"\) tick\(\);/.test(mixerSource));
  assert(/if \(typeof tick === "function"\) tick\(\);/.test(filterSource));
  assert(/if \(featureFlags\.audioMixer\) \{\s*closePanel\(\);\s*removeButton\(\);\s*teardownGraph\(\);\s*\} else \{\s*ensureButton\(\);/.test(mixerSource));
  assert(/if \(featureFlags\.videoFilter\) \{\s*closePanel\(\);\s*removeButton\(\);\s*clearFilter\(\);\s*\} else \{\s*ensureButton\(\);/.test(filterSource));
  console.log("PASS MAIN-world mixer/filter flag receiver and re-enable path");

  const hot = frame({ multiview: true, flags: allHidden });
  hot.read({ cheeseMultiviewBtnMixer: false });
  hot.apply();
  assert.equal(hot.flags().audioMixer, false);
  hot.read({ cheeseMultiviewBtnMixer: true });
  hot.apply();
  assert(hot.classes.has("cheese-multiview-btn-mixer"));
  hot.read({ cheeseMultiviewBtnMixer: false });
  hot.apply();
  assert(!hot.classes.has("cheese-multiview-btn-mixer"));
  assert.equal(hot.flags().audioMixer, false);
  hot.read({ cheeseMultiviewBtnMixer: true });
  hot.apply();
  hot.setGlobalFlags({ audioMixer: false, videoFilter: false });
  assert.equal(hot.flags().audioMixer, false);
  hot.setGlobalFlags(allHidden);
  assert.equal(hot.flags().audioMixer, false);
  assert(hot.classes.has("cheese-multiview-btn-mixer"));
  assert(/MULTIVIEW_SETTING_KEYS\.some\(\(key\) => changes\[key\]\)/.test(source));
  assert(/applyMultiviewPlayerButtonClasses\(\);\s*if \(IS_MULTIVIEW_FRAME\) broadcastFeatureFlags\(\);/.test(source));
  assert(css.includes('html.cheese-popup-player-frame:not(.cheese-multiview-frame)'));
  console.log("PASS hot multiview/global changes and popup CSS isolation");

  for (const count of [2, 4, 6]) {
    const cells = Array.from({ length: count }, () => frame({ multiview: true, flags: allHidden }));
    cells.forEach((cell, index) => {
      cell.read({ cheeseMultiviewBtnMixer: index % 2 === 0 });
      cell.apply();
    });
    cells.forEach((cell, index) => {
      assert.equal(cell.flags().audioMixer, false);
      assert.equal(cell.classes.has("cheese-multiview-btn-mixer"), index % 2 === 0);
    });
  }
  console.log("PASS independent 2/4/6 frame state");

  const sabotages = [
    ["early multiview return", effectiveSource.replace("if (IS_MULTIVIEW_FRAME) {", "if (IS_MULTIVIEW_FRAME) return flags;\n    if (false) {")],
    ["mixer override removed", effectiveSource.replace("flags.audioMixer = hidden(multiviewBtnMixer);", "")],
    ["filter override removed", effectiveSource.replace("flags.videoFilter = hidden(multiviewBtnFilter);", "")],
    ["chat branch removed", effectiveSource.replace("if (IS_MULTIVIEW_CHAT_FRAME) return flags;", "")],
    ["popup branch used", effectiveSource.replace("if (IS_MULTIVIEW_FRAME) {", "if (false) {")],
  ];
  for (const [label, broken] of sabotages) {
    let detected = false;
    if (label === "chat branch removed") {
      // Both predicates true is invalid in production but exposes lost branch precedence.
      const cell = frame({ chat: true, multiview: true, flags: allHidden, effectiveSource: broken });
      detected = cell.flags().audioMixer !== true;
    } else if (label === "popup branch used") {
      const cell = frame({ multiview: true, popupDisableHidden: true,
        flags: allHidden, effectiveSource: broken });
      detected = cell.flags().audioMixer !== false;
    } else {
      const cell = frame({ multiview: true, flags: allHidden, effectiveSource: broken });
      detected = label === "filter override removed"
        ? cell.flags().videoFilter !== false : cell.flags().audioMixer !== false;
    }
    assert(detected, `${label} sabotage was not detected`);
  }
  console.log("PASS five source-mutation sabotage checks");
})().catch((error) => { console.error(error); process.exitCode = 1; });
