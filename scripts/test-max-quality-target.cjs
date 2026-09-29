const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
let content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
let mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
let settings = fs.readFileSync(path.join(root, "src/settings.js"), "utf8");

const sabotages = {
  S1: ["content", 'let maxQualityTarget = "highest"', 'let maxQualityTarget = "720"'],
  S2: ["content", 'maxQualityTarget === "720" ? 720 : 0', 'maxQualityTarget === "720" ? 0 : 0'],
  S3: ["content", 'maxQualityTarget === "720" ? 720 : 0', 'maxQualityTarget === "highest" ? 720 : 0'],
  S4: ["mixer", 'if (document.hidden &&\n        !["cap-480", "cap-720"].includes(multiviewQualityPolicy) &&\n        !(initialQualityPending && initialQualityCap > 0)) return;', 'if (document.hidden && false) return;'],
  S5: ["mixer", 'if (document.hidden &&\n        !["cap-480", "cap-720"].includes(multiviewQualityPolicy) &&\n        !(initialQualityPending && initialQualityCap > 0)) return;', 'if (document.hidden) return;'],
  S6: ["content", 'if (IS_POPUP_PLAYER_FRAME || !maxQualityAuto) return 0;', 'if (!maxQualityAuto) return 0;'],
  S7: ["content", 'function resolveMaxQualityCap() {\n    if (IS_MULTIVIEW_FRAME) {', 'function resolveMaxQualityCap() {\n    if (false) {'],
  S8: ["mixer", '? maxQualityUserTouchedPage === currentPageKey : true', '? false : true'],
  S9: ["mixer", 'multiviewPolicyActive || oneShotQualityActive || maxQualityRespectManual', 'multiviewPolicyActive || oneShotQualityActive || true'],
  S10: ["mixer", 'if (qualityTargetCap > 0 && h > qualityTargetCap) continue;', 'if (qualityTargetCap > 0 && h !== qualityTargetCap) continue;'],
  S11: ["mixer", 'if (maxQualityCap !== maxQualityCapPrev || multiviewPolicyChanged ||\n        multiviewInitialQualityChanged || multiviewLifecycleChanged) {\n      maxQualitySetHeight = 0;', 'if (maxQualityCap !== maxQualityCapPrev || multiviewPolicyChanged ||\n        multiviewInitialQualityChanged || multiviewLifecycleChanged) {\n      maxQualitySetHeight = 1080;'],
  S12: ["settings", 'maxQualityTargetTrigger.disabled = !enabled', 'maxQualityTargetTrigger.disabled = false'],
};
const sabotage = process.env.QUALITY_TARGET_TEST_MUTATION;
if (sabotage) {
  const [file, original, mutated] = sabotages[sabotage] || [];
  assert.ok(file && original && mutated, `unknown sabotage ${sabotage}`);
  const source = { content, mixer, settings }[file];
  assert.ok(source.includes(original), `${sabotage} injection point missing`);
  if (file === "content") content = content.replace(original, mutated);
  if (file === "mixer") mixer = mixer.replace(original, mutated);
  if (file === "settings") settings = settings.replace(original, mutated);
}

const capStart = content.indexOf("  function resolveMaxQualityCap() {");
const capEnd = content.indexOf("\n  function broadcastFeatureFlags()", capStart);
assert.ok(capStart >= 0 && capEnd > capStart, "content quality cap resolver missing");
const capSource = content.slice(capStart, capEnd);
const capFor = new Function(
  "IS_MULTIVIEW_FRAME", "multiviewQualityPolicy", "IS_POPUP_PLAYER_FRAME",
  "maxQualityAuto", "maxQualityTarget", "multiviewInitialQuality",
  `${capSource}\nreturn resolveMaxQualityCap();`,
);

assert.match(content, /let maxQualityTarget = "highest"/);
assert.match(content, /value === "720" \? "720" : "highest"/);
const normalizeSource = content.match(
  /const normalizeMaxQualityTarget = \(value\) =>\s*value === "720" \? "720" : "highest";/,
)?.[0];
assert.ok(normalizeSource);
const normalization = {};
vm.runInNewContext(`${normalizeSource}\nthis.normalize = normalizeMaxQualityTarget;`, normalization);
for (const [input, expected] of [
  [undefined, "highest"], [null, "highest"], ["invalid", "highest"],
  [720, "highest"], ["720", "720"],
]) {
  assert.equal(normalization.normalize(input), expected);
}
assert.match(settings, /"cheeseMaxQualityTarget"/);
assert.match(settings, /maxQualityTargetTrigger\.disabled = !enabled/);
assert.match(content, /MAX_QUALITY_KEY,\s*MAX_QUALITY_TARGET_KEY,\s*MAX_QUALITY_RESPECT_KEY/);
assert.match(content, /if \(changes\[MAX_QUALITY_TARGET_KEY\]\) \{\s*maxQualityTarget = normalizeMaxQualityTarget/);
assert.match(content, /changes\[MAX_QUALITY_KEY\] \|\|\s*changes\[MAX_QUALITY_TARGET_KEY\] \|\|/);
assert.match(content, /maxQualityCap: resolveMaxQualityCap\(\)/);
assert.equal(capFor(false, "none", false, true, "highest", "none"), 0);
assert.equal(capFor(false, "none", false, true, "720", "none"), 720);
assert.equal(capFor(false, "none", false, false, "720", "none"), 0);
assert.equal(capFor(false, "none", true, true, "720", "none"), 0);
assert.equal(capFor(true, "highest", false, true, "720", "none"), 0);
assert.equal(capFor(true, "cap-480", false, false, "720", "none"), 480);
assert.equal(capFor(true, "native", false, true, "720", "cap-480"), 720);

const start = mixer.indexOf("  function applyMaxQuality() {");
const end = mixer.indexOf("\n  // 화질 전환 뒤", start);
assert.ok(start >= 0 && end > start, "applyMaxQuality source missing");
const applySource = mixer.slice(start, end);
const menuStart = mixer.indexOf("  function findQualityMenuTarget(cap = 0) {");
const menuEnd = mixer.indexOf("\n  // 화질 메뉴에서 '목표 화질", menuStart);
assert.ok(menuStart >= 0 && menuEnd > menuStart, "quality menu selector missing");
const menuSource = mixer.slice(menuStart, menuEnd);

function runQuality({ heights, selected, cap, policy = "none", hidden = false,
  respect = true, setHeight = 0, touched = false, audioOnly = false,
  menuClick = false, pageKey = "live:fixture", initialQuality = "none",
  initialApplied = true, auto = policy !== "cap-480" }) {
  const tracks = heights.map((height) => ({ height, selected: height === selected }));
  const video = { paused: false, readyState: 4, currentTime: 30,
    videoWidth: 1920, videoHeight: 1080 };
  let catchups = 0;
  let suspensions = 0;
  const menuClickCount = { value: 0 };
  const deferred = [];
  const context = {
    document: { hidden }, Date, window: { setTimeout: (callback) => {
      deferred.push(callback);
      return deferred.length;
    } }, maxQualityAuto: auto,
    maxQualityCap: cap, multiviewQualityPolicy: policy,
    multiviewInitialQuality: initialQuality,
    multiviewInitialQualityApplied: initialApplied,
    multiviewInitialGlobalPending: false,
    maxQualitySuspendedForAudioOnly: false, maxQualityResumeAfterAudioOnlyAt: 0,
    maxQualitySetHeight: setHeight, maxQualityRespectedPage: null,
    maxQualityUserTouchedPage: touched ? pageKey : null,
    maxQualityRespectManual: respect, maxQualityMenuClickAt: 0,
    maxQualityOwnClickUntil: 0, currentPageKey: pageKey,
    findVideo: () => video,
    findPlayer: () => ({ classList: { contains: () => false } }),
    findCorePlayer: () => ({ videoTracks: tracks }),
    coreIsAudioOnly: () => audioOnly,
    suspendMaxQualityForAudioOnly: () => { suspensions += 1; },
    trackIsAbr: () => false,
    trackIsAudioOnly: () => false,
    trackHeight: (track) => track.height,
    trackSelected: (track) => track.selected,
    isMaxQualityMenuChecked: () => false,
    clickMaxQualityMenuItem: () => { menuClickCount.value += 1; return menuClick; },
    scheduleMaxQualityLiveEdgeCatchup: () => { catchups += 1; },
  };
  vm.runInNewContext(`${applySource}\nthis.applyMaxQuality = applyMaxQuality; applyMaxQuality();`, context);
  return { tracks, context, catchups, suspensions, menuClickCount, deferred };
}

for (const [heights, expected] of [
  [[1080, 720, 480], 720],
  [[1080, 540, 480], 540],
  [[720, 480], 720],
  [[480, 360], 480],
  [[1080], 1080],
]) {
  const { tracks, context, catchups } = runQuality({ heights, selected: heights[0], cap: 720 });
  assert.equal(context.maxQualitySetHeight, expected);
  assert.equal(tracks.find((track) => track.height === expected).selected, true);
  if (expected !== heights[0]) assert.equal(catchups, 1);
  const items = heights.map((height) => ({ height }));
  const menuContext = {
    document: { querySelector: () => ({ querySelectorAll: () => items }) },
    qualityItemHeight: (item) => item.height,
  };
  vm.runInNewContext(`${menuSource}\nthis.menuTarget = findQualityMenuTarget(720);`, menuContext);
  assert.equal(menuContext.menuTarget.height, expected);
}
assert.equal(runQuality({ heights: [1080, 720], selected: 720, cap: 0 })
  .context.maxQualitySetHeight, 1080);

for (const [policy, cap, expected] of [
  ["none", 720, 0], ["none", 0, 0], ["cap-480", 480, 0],
]) {
  const result = runQuality({ heights: [1080, 720, 480], selected: 1080,
    cap, policy, hidden: true });
  assert.equal(result.context.maxQualitySetHeight, expected);
  if (policy === "cap-480") {
    assert.equal(result.tracks.find((track) => track.height === 480).selected, false,
      "멀티뷰 메뉴 조작이 불가능할 때 내부 트랙을 직접 선택하지 않는다");
  }
}
const menuApplied = runQuality({ heights: [1080, 720, 480], selected: 1080,
  cap: 480, policy: "cap-480", hidden: true, menuClick: true });
assert.equal(menuApplied.context.maxQualitySetHeight, 480,
  "멀티뷰 화질 메뉴 경로가 성공하면 목표 화질을 기록한다");

const initialOnly = runQuality({ heights: [1080, 720, 480], selected: 1080,
  cap: 0, policy: "native", auto: false, initialQuality: "cap-480",
  initialApplied: false, menuClick: true });
assert.equal(initialOnly.context.maxQualitySetHeight, 480);
assert.equal(initialOnly.context.multiviewInitialQualityApplied, true,
  "초기 목표에 도달하면 1회 적용 상태를 기록한다");
assert.equal(initialOnly.deferred.length, 0,
  "전역 최대 화질 자동 고정이 꺼져 있으면 초기 목표 뒤 재적용 예약이 없다");
initialOnly.tracks.forEach((track) => { track.selected = track.height === 720; });
initialOnly.context.maxQualityAuto = true;
initialOnly.context.multiviewInitialGlobalPending = true;
initialOnly.context.maxQualityUserTouchedPage = "live:fixture";
initialOnly.context.applyMaxQuality();
assert.equal(initialOnly.context.maxQualityRespectedPage, "live:fixture",
  "초기 적용 뒤의 수동 화질을 전역 수동 존중 설정으로 유지한다");
assert.equal(initialOnly.menuClickCount.value, 1,
  "수동 화질 변경 후 시작 목표를 다시 강제하지 않는다");

const manualBeforeInitial = runQuality({ heights: [1080, 720, 480], selected: 720,
  cap: 0, policy: "native", auto: false, initialQuality: "cap-480",
  initialApplied: false, touched: true, menuClick: true });
assert.equal(manualBeforeInitial.context.multiviewInitialQualityApplied, true);
assert.equal(manualBeforeInitial.menuClickCount.value, 0,
  "사용자가 초기 목표 전에 직접 화질을 골랐으면 초기 목표를 생략한다");

const globalAfterInitial = runQuality({ heights: [1080, 720, 480], selected: 1080,
  cap: 720, policy: "native", auto: true, initialQuality: "cap-480",
  initialApplied: false, menuClick: true });
assert.equal(globalAfterInitial.context.maxQualitySetHeight, 480,
  "전역 720p 고정보다 먼저 480p 시작 목표를 적용한다");
assert.equal(globalAfterInitial.context.multiviewInitialGlobalPending, true,
  "전역 고정 후속 적용을 안정화 이벤트에서 재시도하도록 유지한다");
assert.equal(globalAfterInitial.deferred.length, 1,
  "시작 목표 뒤 전역 자동 고정을 이어서 적용한다");
globalAfterInitial.tracks.forEach((track) => { track.selected = track.height === 480; });
globalAfterInitial.deferred[0]();
assert.equal(globalAfterInitial.context.maxQualitySetHeight, 720,
  "초기 목표 완료 뒤 전역 720p 정책을 적용한다");
assert.equal(globalAfterInitial.context.multiviewInitialGlobalPending, false);

const manual = runQuality({ heights: [1080, 720, 480], selected: 1080,
  cap: 720, setHeight: 720, touched: true });
assert.equal(manual.context.maxQualityRespectedPage, "live:fixture");
assert.equal(manual.tracks.find((track) => track.height === 720).selected, false);
const ignored = runQuality({ heights: [1080, 720, 480], selected: 1080,
  cap: 720, setHeight: 720, touched: true, respect: false });
assert.equal(ignored.context.maxQualityRespectedPage, null);
assert.equal(ignored.tracks.find((track) => track.height === 720).selected, true);
const lowered = runQuality({ heights: [1080, 720, 480], selected: 480,
  cap: 720, setHeight: 720, touched: true });
assert.equal(lowered.context.maxQualityRespectedPage, "live:fixture");
const drift = runQuality({ heights: [1080, 720, 480], selected: 1080,
  cap: 720, setHeight: 720, touched: false });
assert.equal(drift.context.maxQualityRespectedPage, null);
assert.equal(drift.tracks.find((track) => track.height === 720).selected, true);
const radio = runQuality({ heights: [1080, 720], selected: 1080,
  cap: 720, audioOnly: true });
assert.equal(radio.suspensions, 1);
assert.equal(radio.context.maxQualitySetHeight, 0);
const vod = runQuality({ heights: [1080, 720], selected: 1080,
  cap: 720, pageKey: "vod:fixture" });
assert.equal(vod.context.maxQualitySetHeight, 720);
assert.equal(vod.catchups, 0);

assert.match(mixer, /if \(maxQualityCap !== maxQualityCapPrev \|\| multiviewPolicyChanged \|\|\s*multiviewInitialQualityChanged \|\| multiviewLifecycleChanged\) \{\s*maxQualitySetHeight = 0;/);
assert.match(mixer, /const multiviewPolicyActive = \["highest", "cap-480", "cap-720"\]\.includes\(multiviewQualityPolicy\)/);
if (!sabotage) {
  for (const id of Object.keys(sabotages)) {
    const result = spawnSync(process.execPath, [__filename], {
      cwd: root,
      env: { ...process.env, QUALITY_TARGET_TEST_MUTATION: id },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, `${id} was not caught by the tests`);
  }
  console.log("maximum quality target: behavior checks and 12 sabotage cases passed");
}
