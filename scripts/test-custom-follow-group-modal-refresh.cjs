// 전용 팔로잉 그룹 창: 열 때 팔로잉 목록을 다시 받아, 방금 팔로우한 채널도 검색된다.
//
// 그룹 창(추가·수정)은 이미 받아 둔 팔로잉 목록에서 채널을 고른다. 치지직은 SPA 라 페이지를 옮기며 새로 팔로우한
// 채널은 다음 자동 새로고침(간격 설정이 꺼져 있으면 F5) 전까지 목록에 없어, 그룹 창에서 검색되지 않았다.
// 이제 그룹 창을 열거나 그룹 추가·수정으로 들어갈 때 한 번 다시 받는다(10초 안에 다시 받았으면 건너뜀). 받으면
// commitCustomFollowItems 가 열린 그룹 창의 채널 목록도 다시 그린다.
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

const ctx = vm.createContext({ Date });
vm.runInContext(`
  let customFollowLoading = false;
  let customFollowFullRefreshAt = 0;
  const CUSTOM_FOLLOW_MODAL_REFRESH_GAP_MS = 10000;
  let canRefresh = true;
  const canRefreshCustomFollowList = () => canRefresh;
  this.refreshes = 0;
  const refreshCustomFollowList = async () => { this.refreshes += 1; };
  ${fnSrc("refreshCustomFollowListForGroupModal")}
  this.open = refreshCustomFollowListForGroupModal;
  this.set = (o) => { if ("loading" in o) customFollowLoading = o.loading; if ("at" in o) customFollowFullRefreshAt = o.at; if ("can" in o) canRefresh = o.can; };
`, ctx);

ctx.open();
check(ctx.refreshes === 1, "그룹 창을 열면 팔로잉 목록을 다시 받는다");
ctx.set({ at: Date.now() - 3000 });
ctx.open();
check(ctx.refreshes === 1, "10초 안에 다 받았으면 다시 받지 않는다(창을 여닫는 사이 반복 요청 방지)");
ctx.set({ at: Date.now() - 11000, loading: true });
ctx.open();
check(ctx.refreshes === 1, "이미 받는 중이면 겹치지 않는다");
ctx.set({ loading: false, can: false });
ctx.open();
check(ctx.refreshes === 1, "전용 팔로잉이 꺼져 있거나 숨은 탭이면 받지 않는다");
ctx.set({ can: true });
ctx.open();
check(ctx.refreshes === 2, "10초가 지났으면 다시 받는다");

check(/customFollowGroupModalState = \{ view: "list", message: "" \};\s*refreshCustomFollowListForGroupModal\(\);/.test(fnSrc("openCustomFollowGroupModal")),
  "그룹 관리 창을 열 때");
check(/function editCustomFollowGroupFromModal\(group = null\) \{\s*refreshCustomFollowListForGroupModal\(\);/.test(content),
  "그룹 추가·수정으로 들어갈 때");
check(/commitCustomFollowItems\(nextItems\);\s*customFollowFullRefreshAt = Date\.now\(\);/.test(content),
  "전체 팔로잉을 다 받으면 시각을 남긴다");
check(/if \(customFollowGroupModalState\?\.view === "editor"\) \{\s*renderCustomFollowGroupModalChannels\(\);/.test(fnSrc("commitCustomFollowItems")),
  "다시 받은 목록은 열린 그룹 창 채널 목록에 바로 반영된다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
