// 치지직 스튜디오(studio.chzzk.naver.com)는 같은 header#header 구조라, 치지직 헤더용 버튼(헤더 바로가기·팔로우 목록·
// 재생목록·라운지 소식·수신함 점)과 헤더 자동 숨김이 스튜디오 헤더에도 붙었다. 스튜디오에서는 헤더를 건드리지 않는다.
// 재생목록·라운지·수신함 점은 '수신함 버튼'(findHeaderInboxButton)을 기준으로 붙으므로 그 함수가 스튜디오에서 null 을 준다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = fs.readFileSync(path.join(__dirname, "..", "src/content.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const fnSrc = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};

check(/const IS_CHZZK_STUDIO = location\.hostname === "studio\.chzzk\.naver\.com";/.test(content), "스튜디오 판별");
check(/if \(!header \|\| IS_CHZZK_STUDIO\) return;/.test(fnSrc("ensureHeaderNav")), "헤더 바로가기를 붙이지 않는다");
check(/if \(!header \|\| IS_CHZZK_STUDIO\) return;/.test(fnSrc("ensureHeaderFollowNav")), "헤더 팔로우 목록을 붙이지 않는다");
check(/const on = featureFlags\.headerAutoHide && !IS_CHZZK_STUDIO;/.test(fnSrc("applyHeaderAutoHide")), "헤더 자동 숨김을 켜지 않는다");

// 수신함 버튼 찾기: 스튜디오 헤더(실측 구조)에서는 null, 치지직이면 notice_icon
const studioHeader = {
  querySelectorAll: () => [{ id: "notice_icon", getAttribute: () => null, closest: () => null, querySelector: () => null, textContent: "수신함" }],
};
for (const studio of [true, false]) {
  const ctx = vm.createContext({ document: { getElementById: () => studioHeader }, LOUNGE_BUTTON_ID: "cheese-lounge-button", IS_CHZZK_STUDIO: studio });
  vm.runInContext(fnSrc("findHeaderInboxButton") + "\nthis.find = findHeaderInboxButton;", ctx);
  let found = null;
  try { found = ctx.find(studioHeader); } catch { found = "error"; }
  if (studio) check(found === null, "스튜디오: 수신함 버튼을 찾지 않아 재생목록·라운지 소식·수신함 점이 붙지 않는다");
}
check(/function findHeaderInboxButton\(header = document\.getElementById\("header"\)\) \{\s*if \(IS_CHZZK_STUDIO\) return null;/.test(content),
  "수신함 버튼 찾기는 스튜디오에서 맨 먼저 null");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
