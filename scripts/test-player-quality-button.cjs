// 플레이어 '화질 바꾸기' 버튼: 지금 화질을 라벨로 보이고, 누르면 목록에서 바로 고른다.
// 바꾸는 경로는 멀티뷰 화질 패널과 같은 함수(applyPlayerQualityChoice)를 쓴다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const mixer = read("src/audioMixer.js");
const content = read("src/content.js");
const settingsJs = read("src/settings.js");
const settingsHtml = read("settings.html");
const fnSrc = (name) => {
  const at = mixer.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return mixer.slice(at, mixer.indexOf("\n  }\n", at) + 4);
};

// ── 고르기: 사용자 선택으로 기록하고, 고정 중이면 고정 화질만 ─────────────────
function makeCtx(snapshot, { cap = 0, auto = false, respect = false } = {}) {
  const clicks = [];
  const ctx = {
    snapshot,
    playerQualitySnapshot: () => ctx.snapshot,
    findVideo: () => ({}),
    clickMultiviewQualityMenuItem: (v) => { clicks.push(v); return true; },
    currentPageKey: "live:x",
    maxQualityOwnClickUntil: 0, maxQualityUserTouchedPage: null, maxQualitySetHeight: 0,
    maxQualityMenuClickAt: 0, maxQualityRespectedPage: null,
    multiviewQualityManualOverride: false, multiviewInitialQualityApplied: false,
    multiviewInitialGlobalPending: true, multiviewQualityPolicy: "none",
    maxQualityCap: cap, maxQualityAuto: auto, maxQualityRespectManual: respect,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc("applyPlayerQualityChoice") + fnSrc("qualityButtonText") +
    "\nthis.apply=applyPlayerQualityChoice;this.text=qualityButtonText;", ctx);
  return { ctx, clicks };
}
const choices = [
  { value: "auto", label: "자동", selected: false },
  { value: "1080", label: "1080p", selected: true },
  { value: "720", label: "720p", selected: false },
];
{
  const { ctx, clicks } = makeCtx({ ready: true, locked: false, choices }, { auto: true, respect: true });
  assert.equal(ctx.text(ctx.snapshot), "1080p");
  assert.equal(ctx.apply("720"), null);
  assert.deepEqual(clicks, ["720"]);
  assert.equal(ctx.maxQualityUserTouchedPage, "live:x", "직접 고른 것으로 기록한다");
  assert.equal(ctx.maxQualitySetHeight, 720);
  assert.equal(ctx.maxQualityRespectedPage, "live:x", "수동 변경 존중이면 이 방송은 다시 올리지 않는다");
  assert.equal(ctx.multiviewQualityManualOverride, false, "멀티뷰 상태는 건드리지 않는다");
  assert.equal(ctx.apply("480"), "unavailable");
  ctx.snapshot = { ready: false, choices: [] };
  assert.equal(ctx.apply("720"), "not-ready");
  assert.equal(ctx.text(ctx.snapshot), "화질");
  assert.equal(ctx.text({ choices: [{ value: "auto", label: "자동", selected: true }] }), "자동");
}
{
  const { ctx, clicks } = makeCtx({ ready: true, locked: true, lockedQuality: "1080", choices }, { auto: true });
  assert.equal(ctx.apply("720"), "quality-locked", "최대 화질 고정(존중 끔)이면 다른 화질은 막는다");
  assert.equal(clicks.length, 0);
  assert.equal(ctx.apply("1080"), null);
}
{
  const { ctx } = makeCtx({ ready: true, locked: false, choices });
  ctx.multiviewQualityPolicy = "cap-720";
  assert.equal(ctx.apply("720", { multiview: true }), null);
  assert.equal(ctx.multiviewQualityManualOverride, true);
  assert.equal(ctx.multiviewInitialGlobalPending, false);
  assert.equal(ctx.maxQualityRespectedPage, "live:x", "멀티뷰는 예전과 같은 기준을 지킨다");
}

// ── 연결 ────────────────────────────────────────────────────────────
assert.ok(mixer.includes('const reason = applyPlayerQualityChoice(data.quality, { multiview: true });'),
  "멀티뷰 화질 패널도 같은 함수를 쓴다");
assert.ok(mixer.includes("    ensureQualityButton();"), "tick 이 버튼을 맞춘다");
assert.ok(mixer.includes("featureFlags.qualityButton\n        ? has(QUALITY_BUTTON_CLASS)"), "안정 판정에 버튼 유무");
assert.ok(mixer.includes("quality: [QUALITY_BUTTON_CLASS],"), "버튼 순서·위치 대상");
assert.ok(mixer.includes("featureFlags.qualityButton = f.qualityButton !== false;"), "플래그가 없으면 숨김");
assert.ok(/"speedButton",\n\s*\/\/[^\n]*\n\s*"qualityButton",\n\s*\]\);/.test(content), "기본 숨김(원하는 사람만 켠다)");
assert.ok((content.match(/flags\.qualityButton = true;/g) || []).length === 2, "멀티뷰·팝업에서는 두지 않는다");
for (const src of [content, settingsJs]) {
  assert.ok(/"streamStats",\n\s*"quality",\n\s*\];/.test(src), "버튼 목록에 quality");
}
assert.ok(settingsJs.includes('quality: "화질 바꾸기",'));
assert.ok(/"speedButton",\n\s*"qualityButton",\n\s*\]\);/.test(settingsJs), "설정 화면 기본 숨김 목록");
assert.ok(settingsHtml.includes('data-feature="qualityButton"') && settingsHtml.includes('data-new-feature="quality-button"'));

console.log("전부 통과");
