// 설정 > 전용 팔로잉 목록: '자동 펼치기' 묶음(자동 갱신 주기 위)에 팔로잉·즐겨찾기·그룹 자동 펼치기를 한자리에.
//
// '전용 팔로잉 목록 자동 펼치기' 를 켜면 즐겨찾기도 펼쳐질 거라 기대했는데, 즐겨찾기·그룹 자동 펼치기는 아래쪽
// '즐겨찾기 사용'·'그룹 사용' 의 세 번째 하위 옵션(└)이라 찾기 어려웠다. 세 옵션을 나란히 두고(하위 옵션 아님),
// 즐겨찾기·그룹을 쓰지 않으면 해당 줄만 잠근다. 저장값·동작은 그대로다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const html = read("settings.html");
const settingsUi = read("src/settingsUi.js");
const settings = read("src/settings.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const at = (feature) => html.indexOf(`data-feature="${feature}"`);
const main = at("sbFollowCustomAutoExpand");
const fav = at("sbFollowFavAutoExpand");
const group = at("sbFollowGroupAutoExpand");
const between = (a, b) => html.slice(a, b);
check(main > 0 && main < fav && fav < group && (between(main, group).match(/<li class="settings-item">/g) || []).length === 2,
  "팔로잉 → 즐겨찾기 → 그룹 자동 펼치기가 바로 이어진 세 줄");
const titleAt = (title) => html.search(new RegExp(`settings-group-title[^>]*>\\s*${title}\\s*</h2>`));
const expandTitle = titleAt("자동 펼치기");
const refreshTitle = titleAt("자동 갱신 주기");
check(expandTitle > 0 && expandTitle < main && group < refreshTitle && !/settings-group-title/.test(between(main, refreshTitle)),
  "전용 팔로잉 목록 탭의 '자동 펼치기' 묶음에 세 줄만 있고, 바로 다음이 '자동 갱신 주기'");
check(html.lastIndexOf('data-panel="', expandTitle) === html.lastIndexOf('data-panel="customfollow"', expandTitle),
  "전용 팔로잉 목록 탭 안");
check(/>팔로잉 목록 자동 펼치기<\/span/.test(html) && /data-settings-search-aliases="전용 팔로잉 목록 자동 펼치기"/.test(html),
  "맨 위 줄 이름은 '팔로잉 목록 자동 펼치기'(예전 이름으로도 검색)");
check(/>즐겨찾기 자동 펼치기<\/span>/.test(html) && />그룹 자동 펼치기<\/span>/.test(html) && !/└ (즐겨찾기|그룹) 자동 펼치기/.test(html),
  "즐겨찾기·그룹 자동 펼치기는 하위 옵션(└)이 아니다");
check(!/sbFollowFavAutoExpand|sbFollowGroupAutoExpand/.test(settingsUi.slice(settingsUi.indexOf("const FAMILIES"), settingsUi.indexOf("];", settingsUi.indexOf("const FAMILIES")))),
  "하위 옵션 관계(FAMILIES)에서 빠져 '즐겨찾기 사용' 펼치기 묶음에 숨지 않는다");

// 잠금
const fnAt = settings.indexOf("\n  function reflectFollowAutoExpandLocks(");
const fnSrc = settings.slice(fnAt, settings.indexOf("\n  }\n", fnAt) + 4);
const row = () => {
  const classes = new Set();
  return { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) } };
};
const inputs = {};
for (const key of ["sbFollowFavEnabled", "sbFollowGroupEnabled", "sbFollowFavAutoExpand", "sbFollowGroupAutoExpand"]) {
  const r = row();
  inputs[key] = { checked: false, disabled: false, row: r, closest: () => r };
}
const ctx = vm.createContext({
  document: { querySelector: (sel) => inputs[(sel.match(/data-feature="([^"]+)"/) || [])[1]] || null },
});
vm.runInContext(fnSrc + "\nthis.run = reflectFollowAutoExpandLocks;", ctx);
inputs.sbFollowFavEnabled.checked = false;
inputs.sbFollowGroupEnabled.checked = true;
ctx.run();
check(inputs.sbFollowFavAutoExpand.disabled && inputs.sbFollowFavAutoExpand.row.classList.has("is-locked") &&
  !inputs.sbFollowGroupAutoExpand.disabled && !inputs.sbFollowGroupAutoExpand.row.classList.has("is-locked"),
  "즐겨찾기 사용이 꺼지면 즐겨찾기 자동 펼치기만 잠근다");
inputs.sbFollowFavEnabled.checked = true;
inputs.sbFollowGroupEnabled.checked = false;
ctx.run();
check(!inputs.sbFollowFavAutoExpand.disabled && inputs.sbFollowGroupAutoExpand.disabled, "다시 켜면 풀고, 그룹 사용이 꺼지면 그룹 줄을 잠근다");
check(/reflectLogPowerTimerAutoNote\(\);\s*reflectFollowAutoExpandLocks\(\);/.test(settings) &&
  /\["sbFollowFavEnabled", "sbFollowGroupEnabled"\]\.forEach\(\(key\) => \{\s*document\s*\.querySelector\(`\[data-feature="\$\{key\}"\]`\)\s*\?\.addEventListener\("change", reflectFollowAutoExpandLocks\);/.test(settings),
  "기능 토글을 읽은 뒤와 즐겨찾기·그룹 사용을 바꿀 때 잠금을 맞춘다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
