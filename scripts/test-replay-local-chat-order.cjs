const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

const source = fs.readFileSync("src/replayLocalChat.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const context = {
  URL,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: () => ({ flexDirection: "column" }),
};
context.globalThis = context;
vm.runInNewContext(source, context);
const { placeLocalRows } = context.CheeseReplayLocalChat;
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// 목록 순서만 다루는 최소 DOM.
function makeList() {
  const list = { children: [] };
  const sync = () => {
    list.children.forEach((node, index) => {
      node.parentElement = list;
      node.nextSibling = list.children[index + 1] || null;
      node.previousSibling = list.children[index - 1] || null;
    });
    list.firstChild = list.children[0] || null;
  };
  list.insertBefore = (node, ref) => {
    const current = list.children.indexOf(node);
    if (current >= 0) list.children.splice(current, 1);
    const index = ref ? list.children.indexOf(ref) : list.children.length;
    assert.ok(index >= 0, "기준 노드가 목록에 없다");
    list.children.splice(index, 0, node);
    sync();
  };
  list.append = (...nodes) => nodes.forEach((node) => list.insertBefore(node, null));
  return list;
}
const native = (name, at) => ({ name, at, native: true, parentElement: null, nextSibling: null });
const local = (name) => ({ name, native: false, parentElement: null, nextSibling: null });
const names = (list) => list.children.map((node) => node.name).join(",");
const place = (list, entries, bottom, timeOf = (row) => row.at ?? null, reversed = false) =>
  placeLocalRows({ list, entries, isNative: (el) => el.native === true, timeOf, end: bottom, reversed });

// ── 치지직 실측 구조: DOM 이 최신 → 과거 순, 0번이 _list_bottom_(화면은 column-reverse) ──
{
  const list = makeList();
  const bottom = { name: "bottom" };
  // 실측값(ms → 초): 184.221, 183.092, 175.931, 175.386, 174.4
  list.append(bottom, native("n184", 184.221), native("n183", 183.092),
    native("n175b", 175.931), native("n175a", 175.386), native("n174", 174.4));
  const mine = local("mine");
  place(list, [{ row: mine, at: 184.6 }], bottom, undefined, true);
  check(names(list) === "bottom,mine,n184,n183,n175b,n175a,n174",
    "최신이 먼저인 목록에서도 입력 직후에는 가장 최신 채팅 옆(화면 최하단)에 둔다");
  // 새 채팅은 DOM 앞쪽(기준점 바로 뒤)에 붙는다 → 로컬 줄은 그 자리에 남아 위로 밀린다.
  list.insertBefore(native("n186", 186.0), list.children[1]);
  list.insertBefore(native("n188", 188.5), list.children[1]);
  place(list, [{ row: mine, at: 184.6 }], bottom, undefined, true);
  check(names(list) === "bottom,n188,n186,mine,n184,n183,n175b,n175a,n174",
    "새 채팅이 붙으면 로컬 줄이 함께 위로 올라간다(맨 위로 가지 않는다)");
}
{
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(bottom, native("n30", 30), native("n15", 15), native("n10", 10));
  const first = local("first");
  const second = local("second");
  const early = local("early");
  place(list, [{ row: early, at: 5 }, { row: first, at: 15 }, { row: second, at: 15 }],
    bottom, undefined, true);
  check(names(list) === "bottom,n30,second,first,n15,n10,early",
    "최신이 먼저인 목록: 같은 시각은 치지직 채팅보다 최신, 로컬끼리 순서 유지, 가장 과거는 맨 위");
  place(list, [{ row: early, at: 5 }, { row: first, at: 15 }, { row: second, at: 15 }],
    bottom, undefined, true);
  check(names(list) === "bottom,n30,second,first,n15,n10,early",
    "최신이 먼저인 목록: 다시 맞춰도 흔들리지 않는다");
}
{
  // 스타일 힌트와 실제 순서가 달라도 읽은 시각을 따른다.
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(bottom, native("n20", 20), native("n10", 10));
  const mine = local("mine");
  place(list, [{ row: mine, at: 15 }], bottom, undefined, false);
  check(names(list) === "bottom,n20,mine,n10", "순서는 스타일보다 읽은 시각으로 판단한다");
}
{
  // 치지직 줄이 없을 때: 최신이 먼저인 목록이면 기준점 옆, 나중 입력이 더 아래.
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(bottom);
  const one = local("one");
  const two = local("two");
  place(list, [{ row: one, at: 1 }, { row: two, at: 2 }], bottom, undefined, true);
  check(names(list) === "bottom,two,one", "채팅이 없으면 기준점 옆에 최신 순으로 둔다");
}

// 증상 재현: 입력한 뒤 새 채팅이 붙으면 로컬 줄이 함께 위로 올라가야 한다.
{
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(native("a", 10), native("b", 20), bottom);
  const mine = local("mine");
  place(list, [{ row: mine, at: 21 }], bottom);
  check(names(list) === "a,b,mine,bottom", "입력 직후에는 마지막 채팅 뒤에 둔다");
  list.insertBefore(native("c", 22), bottom);
  list.insertBefore(native("d", 25), bottom);
  place(list, [{ row: mine, at: 21 }], bottom);
  check(names(list) === "a,b,mine,c,d,bottom",
    "새 채팅이 붙어도 맨 아래로 끌려가지 않고 제자리에 남는다");
}

// 같은 시각의 치지직 채팅 뒤, 로컬끼리는 입력 순서.
{
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(native("a", 10), native("b", 15), native("c", 30), bottom);
  const first = local("first");
  const second = local("second");
  place(list, [{ row: first, at: 15 }, { row: second, at: 15 }], bottom);
  check(names(list) === "a,b,first,second,c,bottom",
    "같은 시각이면 치지직 채팅 뒤, 로컬끼리는 순서를 지킨다");
  place(list, [{ row: first, at: 15 }, { row: second, at: 15 }], bottom);
  check(names(list) === "a,b,first,second,c,bottom", "다시 맞춰도 순서가 흔들리지 않는다");
}

// 치지직 채팅이 모두 더 뒤면 맨 위, 시각을 못 읽는 줄은 건너뛴다.
{
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(native("a", 40), native("x", null), native("b", 50), bottom);
  const early = local("early");
  const mid = local("mid");
  place(list, [{ row: early, at: 5 }, { row: mid, at: 45 }], bottom);
  check(names(list) === "early,a,mid,x,b,bottom",
    "앞선 채팅이 없으면 맨 위에 두고, 시각을 못 읽는 줄은 판단에서 뺀다(아는 시각 바로 뒤)");
}

// 치지직 채팅 시각을 하나도 못 읽으면 예전처럼 끝에 둔다.
{
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(native("a", null), native("b", null), bottom);
  const mine = local("mine");
  place(list, [{ row: mine, at: 3 }], bottom);
  check(names(list) === "a,b,mine,bottom", "시각을 못 읽으면 끝에 둔다");
}

// 채팅이 여러 번 쌓이는 동안의 흐름(여러 로컬 줄).
{
  const list = makeList();
  const bottom = { name: "bottom" };
  list.append(native("a", 1), bottom);
  const one = local("one");
  const two = local("two");
  const entries = [{ row: one, at: 2 }];
  place(list, entries, bottom);
  list.insertBefore(native("b", 3), bottom);
  entries.push({ row: two, at: 4 });
  place(list, entries, bottom);
  list.insertBefore(native("c", 5), bottom);
  place(list, entries, bottom);
  check(names(list) === "a,one,b,two,c,bottom", "여러 번 입력해도 각자 시각 자리에 남는다");
}

// 치지직 React props 를 읽으려면 MAIN world 여야 한다.
const entry = manifest.content_scripts.find((item) => item.js?.includes("src/replayLocalChat.js"));
check(entry?.world === "MAIN", "다시보기 로컬 채팅은 MAIN world 에서 돈다");
check(/chatMessage\.playerMessageTime|playerMessageTime/.test(source) &&
  /__reactProps\$/.test(source) && /__reactFiber\$/.test(source),
  "치지직 채팅 줄의 재생 시각(playerMessageTime)을 읽는다");
check(!/for \(const message of \[\.\.\.visible\]\.reverse\(\)\)/.test(source),
  "로컬 줄을 늘 목록 끝에 다시 끼우던 경로가 없다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
