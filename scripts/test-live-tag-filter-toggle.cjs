// 라이브 제외 필터 항목별 켜기/끄기.
//
// 항목을 지우지 않고 끌 수 있다. 꺼 둔 항목은 정규화한 키로 따로 저장한다
// (cheeseLiveTagFiltersDisabled). 목록 키는 그대로라 예전 버전도 목록을 읽는다.
// 꺼 둔 항목은 숨기기·버튼 개수에서 빠지고, 다시 추가하면 켜진다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const settings = read("src/settings.js");
const contentCss = read("src/content.css");
const settingsCss = read("src/settings.css");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (source, name, from = 0) => {
  const at = source.indexOf(`\n  function ${name}(`, from);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

// ── 정리 규칙(content.js 를 그대로 실행) ──
{
  const base = content.indexOf("// ── 전체 방송·팔로잉 라이브 제외 필터");
  const ctx = vm.createContext({ liveTagFilters: [], liveTagFiltersDisabled: new Set() });
  vm.runInContext(["normalizeLiveTagFilter", "sanitizeLiveTagFilters", "sanitizeLiveTagFiltersDisabled",
    "activeLiveTagFilters"].map((name) => sliceFn(content, name, base)).join("\n") +
    "\nthis.api = { normalizeLiveTagFilter, sanitizeLiveTagFiltersDisabled, activeLiveTagFilters };", ctx);
  vm.runInContext(`liveTagFilters = ["Grand Theft Auto V", "명조:워더링 웨이브", "#노래"];`, ctx);
  const disabled = ctx.api.sanitizeLiveTagFiltersDisabled(["grand theft auto v", "없는 항목", "", null]);
  check(JSON.stringify([...disabled]) === '["grand theft auto v"]',
    "꺼 둔 키는 정규화해 받고, 목록에 없는 키는 버린다");
  vm.runInContext(`liveTagFiltersDisabled = new Set(["grand theft auto v"]);`, ctx);
  check(JSON.stringify(ctx.api.activeLiveTagFilters()) === '["명조:워더링 웨이브","#노래"]',
    "꺼 둔 항목은 숨기기에 쓰지 않는다");
}

// ── 페이지 안 창(content.js) ──
check(/const LIVE_TAG_FILTERS_DISABLED_KEY = "cheeseLiveTagFiltersDisabled";/.test(content),
  "꺼 둔 항목은 별도 키(목록 키는 그대로)");
{
  const apply = sliceFn(content, "applyLiveTagFilters");
  check(/const active = activeLiveTagFilters\(\);\s*if \(!kind \|\| !active\.length\) return;\s*const filterSet = new Set\(active\.map\(normalizeLiveTagFilter\)\);/.test(apply),
    "숨기기: 켜진 항목만, 모두 꺼져 있으면 아무것도 숨기지 않는다");
  check(/const count = activeLiveTagFilters\(\)\.length;/.test(sliceFn(content, "updateLiveTagFilterButton")),
    "'제외 필터 추가' 버튼 개수는 켜진 항목 수");
  const render = sliceFn(content, "renderLiveTagFilterModal");
  check(/class="cheese-live-tag-filter-row\$\{on \? "" : " is-off"\}"/.test(render) &&
    /role="switch" data-live-tag-filter-toggle="\$\{index\}" \$\{\s*on \? "checked" : ""\s*\}/.test(render),
    "창의 행마다 스위치, 꺼 둔 행은 is-off");
  const save = sliceFn(content, "saveLiveTagFilters");
  check(/liveTagFiltersDisabled = sanitizeLiveTagFiltersDisabled\(\[\.\.\.liveTagFiltersDisabled\]\);/.test(save) &&
    /\[LIVE_TAG_FILTERS_DISABLED_KEY\]: \[\.\.\.liveTagFiltersDisabled\]/.test(save),
    "저장할 때 지운 항목의 꺼짐 기록도 정리해 함께 저장한다");
  check(/const toggle = event\.target\.closest\?\.\("\[data-live-tag-filter-toggle\]"\);\s*if \(toggle\) \{\s*const tag = liveTagFilters\[Number\(toggle\.dataset\.liveTagFilterToggle\)\];\s*if \(tag\) setLiveTagFilterEnabled\(tag, toggle\.checked\);/.test(content),
    "스위치를 바꾸면 그 항목만 켜고 끈다");
  check(/added\.forEach\(\(tag\) => liveTagFiltersDisabled\.delete\(normalizeLiveTagFilter\(tag\)\)\);\s*saveLiveTagFilters\(\[\.\.\.liveTagFilters, \.\.\.added\]\);/.test(content),
    "꺼 둔 항목을 다시 추가하면 켠다");
  check(/LIVE_TAG_FILTERS_KEY,\s*LIVE_TAG_FILTERS_DISABLED_KEY,(?:\s*[A-Z_]+,)?\s*LIVE_TAG_FILTER_BUTTON_KEY,/.test(content) &&
    /LIVE_TAG_FILTERS_KEY,\s*LIVE_TAG_FILTERS_DISABLED_KEY,(?:\s*[A-Z_]+,)?\s*LIVE_VIEWER_COUNT_POSITION_KEY,/.test(content) &&
    /!changes\[LIVE_TAG_FILTERS_DISABLED_KEY\] &&/.test(content),
    "읽기·미리 받기·변경 감지(설정에서 바꾸면 페이지에 바로 반영)");
}

// ── 설정 페이지 ──
check(/const LIVE_TAG_FILTERS_DISABLED_KEY = "cheeseLiveTagFiltersDisabled";/.test(settings) &&
  /let settingsLiveTagDisabled = new Set\(\);/.test(settings), "설정: 같은 키");
check(/role="switch" data-live-tag-toggle="\$\{index\}"/.test(settings) &&
  /class="settings-live-tag-row\$\{on \? "" : " is-off"\}"/.test(settings),
  "설정: 행마다 스위치");
check(/if \(toggle\.checked\) settingsLiveTagDisabled\.delete\(key\);\s*else settingsLiveTagDisabled\.add\(key\);\s*saveSettingsLiveTagFilters\(settingsLiveTagFilters\);/.test(settings) &&
  /\[LIVE_TAG_FILTERS_DISABLED_KEY\]: \[\.\.\.settingsLiveTagDisabled\]/.test(settings) &&
  /added\.forEach\(\(tag\) => settingsLiveTagDisabled\.delete\(normalizeLiveTagFilter\(tag\)\)\);/.test(settings) &&
  /if \(changes\[LIVE_TAG_FILTERS_KEY\] \|\| changes\[LIVE_TAG_FILTERS_DISABLED_KEY\]\)/.test(settings),
  "설정: 켜고 끄기·저장·다시 추가하면 켜기·변경 감지");

// ── 스타일 ──
for (const [css, prefix] of [[contentCss, "cheese-live-tag-filter"], [settingsCss, "settings-live-tag"]]) {
  check(new RegExp(`\\.${prefix}-row\\.is-off > label:first-child span \\{\\s*opacity: 0\\.45;`).test(css) &&
    new RegExp(`\\.${prefix}-row > label\\.${prefix}-toggle \\{\\s*flex: none;`).test(css) &&
    new RegExp(`\\.${prefix}-toggle input:checked \\+ i::after \\{\\s*transform: translateX\\(12px\\);`).test(css),
    `${prefix}: 꺼 둔 항목은 흐리게, 스위치는 행 이름 칸을 늘리지 않는다`);
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
