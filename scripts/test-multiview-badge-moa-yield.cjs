// 배지 모아 챗(별도 확장)과 겹칠 때 멀티뷰 배지 채팅이 양보하는지 검증.
//
// 치지직 페이지 위 멀티뷰가 되면서 배지 모아 챗도 채팅 칸(/live/<id>/chat)에 들어온다.
// 같은 기능(배지 알림 버튼·모아보기·채팅 하이라이트)이 두 겹이 되므로, 채팅 칸이 뜬 뒤
// 판정 시간 동안 그 확장의 .chzzk-badge-moa-root 를 확인해 있으면 우리 것을 끈다. 판정이
// 나면 감시를 멈춘다(계속 돌지 않는다).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/multiviewBadgeChat.js"), "utf8");
const from = source.indexOf("  const BADGE_MOA_ROOT = ");
const to = source.indexOf("})();", from);
assert.ok(from > 0 && to > from, "양보 판정 구간을 찾지 못했다");
const block = source.slice(from, to);
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

function run() {
  let now = 1_000_000;
  let moaPresent = false;
  let created = 0;
  let disposed = 0;
  let tick = null;
  let stopped = false;
  const win = {
    document: { querySelector: (selector) => (selector === ".chzzk-badge-moa-root" && moaPresent ? {} : null) },
    setInterval: (fn) => { tick = fn; stopped = false; return 1; },
    clearInterval: () => { stopped = true; },
    addEventListener: () => {},
  };
  const ctx = {
    win,
    Date: { now: () => now },
    createRoleHighlighter: () => { created += 1; return () => { disposed += 1; }; },
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return {
    get created() { return created; },
    get disposed() { return disposed; },
    get stopped() { return stopped; },
    // 타이머가 멈췄으면 더 불리지 않는다(실제 setInterval 과 같게).
    step(ms, present) { now += ms; moaPresent = present; if (!stopped) tick(); },
  };
}

{
  // 배지 모아 챗이 없는 경우: 2초 뒤 켜고, 20초 판정 뒤 감시를 멈춘다.
  const s = run();
  s.step(1000, false);
  check(s.created === 0, "처음에는 바로 켜지 않는다(그 확장이 뜨기 전 버튼이 깜빡이지 않게)");
  s.step(1000, false);
  check(s.created === 1, "2초 동안 배지 모아 챗이 없으면 우리 배지 채팅을 켠다");
  for (let i = 0; i < 17; i++) s.step(1000, false);
  check(!s.stopped, "판정 시간(20초) 동안은 계속 확인한다");
  s.step(1000, false);
  check(s.stopped && s.created === 1 && s.disposed === 0,
    "20초 동안 없으면 우리 것을 두고 감시를 멈춘다(계속 돌지 않는다)");
  s.step(1000, true);
  check(s.disposed === 0, "판정이 끝난 뒤에는 다시 확인하지 않는다");
}
{
  // 배지 모아 챗이 늦게 뜬 경우: 판정 시간 안이면 양보하고 멈춘다.
  const s = run();
  for (let i = 0; i < 5; i++) s.step(1000, false);
  check(s.created === 1, "그 사이에는 우리 것이 켜져 있다");
  s.step(1000, true);
  check(s.disposed === 1 && s.stopped, "판정 시간 안에 배지 모아 챗이 뜨면 우리 것을 끄고 감시를 멈춘다");
}
{
  // 처음부터 있는 경우: 켜지도 않고 바로 멈춘다.
  const s = run();
  s.step(1000, true);
  check(s.created === 0 && s.disposed === 0 && s.stopped,
    "처음부터 배지 모아 챗이 있으면 우리 것을 켜지 않고 바로 감시를 멈춘다");
}
check(/const params = multiviewFrameParams\(\);\s*if \(\s*params\.get\("cheeseMultiChat"\) !== "1"/.test(source),
  "멀티뷰 채팅 칸에서만 동작한다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
