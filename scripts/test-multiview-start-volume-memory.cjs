const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/multiview.js"), "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
const sliceFn = (name) => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(start >= 0 && end > start, `${name} 를 찾지 못했다`);
  return source.slice(start, end + 4);
};

// 저장 함수를 원본 그대로 돌려 저장되는 값을 확인한다.
const writes = [];
const timers = [];
const ctx = {
  state: { mainHighQuality: true, startWithoutChat: false, startMainMuted: false, startMainVolume: 0.37 },
  SETUP_OPTIONS_STORAGE_KEY: "cheeseMultiviewSetupOptions",
  chrome: { storage: { local: { set: (value) => { writes.push(value); return Promise.resolve(); } } } },
  window: { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } },
  clearTimeout: () => {},
};
vm.runInNewContext(
  `let setupOptionsSaveTimer = 0;\n${sliceFn("saveSetupOptions")}\n${sliceFn("scheduleSetupOptionsSave")}\n` +
  "globalThis.api = { saveSetupOptions, scheduleSetupOptionsSave };",
  Object.assign(ctx, { globalThis: ctx }),
);
ctx.api.saveSetupOptions();
check(writes.at(-1).cheeseMultiviewSetupOptions.startMainVolume === 0.37,
  "시작 음량을 다른 시작 옵션과 함께 저장한다");
ctx.api.scheduleSetupOptionsSave();
ctx.api.scheduleSetupOptionsSave();
check(timers.length === 2 && timers.every((t) => t.ms === 300) && writes.length === 1,
  "슬라이더를 끄는 동안에는 바로 쓰지 않고 묶는다");
timers.at(-1).fn();
check(writes.length === 2, "묶어 둔 저장은 마지막에 한 번 쓴다");

// 정규화: 저장값이 없거나 이상하면 100%, 0% 는 그대로.
const normalize = vm.runInNewContext(`${sliceFn("normalizeStartMainVolume")}; normalizeStartMainVolume`);
check(normalize(undefined) === 1 && normalize("0.5") === 1 && normalize(NaN) === 1,
  "저장값이 없거나(예전 버전) 숫자가 아니면 100%");
check(normalize(0) === 0 && normalize(0.374) === 0.37 && normalize(2) === 1,
  "0% 는 그대로 두고 범위를 벗어나면 자른다");

// 연결.
check(/state\.startMainVolume = normalizeStartMainVolume\(setupOptions\?\.startMainVolume\);\s*paintStartMainVolume\(\);/.test(source),
  "선택 화면을 열면 저장된 시작 음량을 되살린다");
check(/"mvStartMainVolumeRange"\)\?\.addEventListener\("input", \(event\) => \{\s*if \(setStartMainVolumePercent\(event\.target\.value\)\) scheduleSetupOptionsSave\(\);/.test(source) &&
  /"mvStartMainVolumeRange"\)\?\.addEventListener\("change", \(event\) => \{\s*if \(setStartMainVolumePercent\(event\.target\.value\)\) saveSetupOptions\(\);/.test(source),
  "슬라이더: 끄는 동안 묶어 저장하고, 놓으면 바로 저장한다");
check(/"mvStartMainVolumeNumber"\)\?\.addEventListener\("change", \(event\) => \{\s*if \(setStartMainVolumePercent\(event\.target\.value\)\) saveSetupOptions\(\);\s*else paintStartMainVolume\(\);/.test(source),
  "숫자 입력: 확정하면 저장하고, 잘못된 값이면 되돌린다");
check(/addEventListener\("pagehide", \(\) => \{\s*if \(setupOptionsSaveTimer\) saveSetupOptions\(\);/.test(source),
  "저장을 묶어 둔 사이에 탭을 닫아도 마지막 값을 남긴다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
