const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const watch = read("src/multiviewWatch.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// 렌더링 순서를 흉내 내서 스크롤 결과를 확인한다(두 화면이 같은 규칙).
function render(list, { html, initialized, localRow = null }) {
  const nearBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 32;
  const previousScrollTop = list.scrollTop;
  list.scrollHeight += html; // 새 채팅이 붙어 내용이 길어진다
  if (localRow) return "reveal";
  if (!initialized) {
    list.scrollTop = list.scrollHeight;
    return "initial";
  }
  list.scrollTop = nearBottom ? list.scrollHeight : previousScrollTop;
  return "follow";
}
{
  const list = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
  render(list, { html: 40, initialized: true });
  check(list.scrollTop === 1040, "맨 아래를 보던 중이면 재생에 따라 붙는 채팅을 따라간다");
  list.scrollTop = 200;
  render(list, { html: 40, initialized: true });
  check(list.scrollTop === 200, "위로 올려 과거를 보는 중이면 위치를 둔다");
}

for (const [source, label] of [[watch, "시청 페이지"]]) {
  check(/const nearBottom = list\.scrollHeight - list\.clientHeight - list\.scrollTop < 32;\s*const previousScrollTop = list\.scrollTop;/.test(source) &&
    /list\.scrollTop = nearBottom \? list\.scrollHeight : previousScrollTop;/.test(source),
    `${label}: 새 채팅을 그리기 전 맨 아래 여부를 재고, 맨 아래였으면 따라간다`);
}
check(/revealRowAtPosition\(list, pendingLocalRow\)/.test(watch),
  "입력한 로컬 채팅 보여 주기는 그대로 둔다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
