// 멀티뷰 세로 화면(창 높이 > 너비, 세로로 돌린 모니터) 배치.
//
// 세로 화면이면 배치 목록 맨 위에 '세로 화면' 묶음(세로 전용 14개, 사용자 승인 표)을
// 두고 나머지를 잇는다. 방향이 바뀌어도 쓰던 배치는 그대로 두고 목록만 바꾼다. 세로 화면에서
// 채널 수를 바꾸면 세로 배치끼리 잇는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../src/multiviewLayouts.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const watch = read("src/multiviewWatch.js");
const setup = read("src/multiview.js");
const css = read("src/multiview.css");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const ids = (list) => list.map((layout) => layout.id);

const PORTRAIT_ONLY = ["portrait-2", "portrait-3", "portrait-2-bottom-2", "portrait-4",
  "portrait-main-2x2", "portrait-2-bottom-3", "portrait-3-bottom-2",
  "portrait-2-grid-2x2", "portrait-3-bottom-3", "portrait-4-bottom-2",
  "portrait-main-2x3", "portrait-3-grid-2x2", "portrait-2-grid-2x3", "portrait-main-2x4"];
check(PORTRAIT_ONLY.every((id) => L.layoutById(id)?.portrait === true &&
  L.chatSidesFor(L.layoutById(id))[0] === "bottom"),
  "세로 전용 배치 14개, 채팅은 아래가 기본");
check(JSON.stringify(PORTRAIT_ONLY.map((id) => L.layoutById(id).label)) ===
  JSON.stringify(["세로 2단", "세로 3단", "세로 2단 + 아래 2", "세로 4단",
    "세로 메인 + 그리드 2×2", "세로 2단 + 아래 3", "세로 3단 + 아래 2",
    "세로 2단 + 그리드 2×2", "세로 3단 + 아래 3", "세로 4단 + 아래 2",
    "세로 메인 + 그리드 2×3", "세로 3단 + 그리드 2×2", "세로 2단 + 그리드 2×3", "세로 메인 + 그리드 2×4"]),
  "이름(승인한 표와 같다)");
check(L.LAYOUTS.filter((layout) => layout.portraitFit).length === 0,
  "세로 화면 묶음은 세로 전용 배치만(그리드 2×4 등 가로 배치는 뺐다)");
// 전체 폭 줄은 열 수만큼(2열이면 2fr, 3열이면 3fr), 나눈 줄은 1fr 이라 모든 칸이 16:9 가 될 수 있다.
for (const id of PORTRAIT_ONLY.filter((id) => L.layoutById(id).columns !== "1fr")) {
  const layout = L.layoutById(id);
  const rows = layout.rows.split(" ");
  const cols = layout.areas[0].replace(/"/g, "").trim().split(/\s+/).length;
  check(layout.areas.every((row, i) => {
    const cells = row.replace(/"/g, "").trim().split(/\s+/);
    return rows[i] === (new Set(cells).size === 1 ? `${cols}fr` : "1fr");
  }), `${layout.label}: 전체 폭 줄은 ${cols}fr, 나눈 줄은 1fr`);
}

check(PORTRAIT_ONLY.every((id) => L.solveTracks(L.layoutById(id)) === null),
  "세로 전용 배치는 칸 안에서 16:9 로 맞춘다(격자 비율을 풀면 줄 사이 간격만큼 어긋났다, 4단 1.786)");

const expectedGroup = {
  2: ["portrait-2"],
  3: ["portrait-3"],
  4: ["portrait-2-bottom-2", "portrait-4"],
  5: ["portrait-main-2x2", "portrait-2-bottom-3", "portrait-3-bottom-2"],
  6: ["portrait-2-grid-2x2", "portrait-3-bottom-3", "portrait-4-bottom-2"],
  7: ["portrait-main-2x3", "portrait-3-grid-2x2"],
  8: ["portrait-2-grid-2x3"],
  9: ["portrait-main-2x4"],
};
for (const [count, group] of Object.entries(expectedGroup)) {
  const portrait = L.layoutsFor(Number(count), { portrait: true });
  const landscape = L.layoutsFor(Number(count));
  check(JSON.stringify(ids(portrait).slice(0, group.length)) === JSON.stringify(group) &&
    portrait.slice(0, group.length).every(L.isPortraitGroup) &&
    !portrait.slice(group.length).some(L.isPortraitGroup) &&
    portrait.length === L.layoutsFor(Number(count), { all: true }).length,
    `${count}채널 세로 화면: '세로 화면' 묶음이 맨 위, 나머지(가로)는 그 아래 ${ids(portrait).slice(0, group.length + 1)}`);
  check(!landscape.some((layout) => layout.portrait), `${count}채널 가로 화면: 세로 전용 배치는 목록에 없다`);
}
check(ids(L.layoutsFor(3, { keepId: "portrait-3" })).includes("portrait-3"),
  "가로 화면이라도 쓰고 있는 세로 전용 배치는 목록에 남긴다(방향이 바뀌어도 그대로)");
check(L.layoutsFor(2)[0].id === "right-1" && L.layoutsFor(5)[0].id === "right2-bottom2",
  "가로 화면의 목록·기본 배치는 그대로");

// 채널 수를 바꿀 때: 세로 화면이면 세로 배치끼리 잇는다.
const walk = (start, from, to, portrait) => {
  const path = [start];
  let current = start;
  for (let count = from + 1; count <= to; count++) {
    current = L.layoutForCount(current, count, "bottom", null, { portrait }).layoutId;
    path.push(current);
  }
  return path;
};
check(JSON.stringify(walk("portrait-2", 2, 9, true)) === JSON.stringify(["portrait-2", "portrait-3", "portrait-4",
  "portrait-main-2x2", "portrait-2-grid-2x2", "portrait-main-2x3", "portrait-2-grid-2x3", "portrait-main-2x4"]),
  "세로 화면에서 2→9채널로 늘리면 세로 배치끼리 이어진다");
const down = ["portrait-main-2x4"];
for (let count = 8; count >= 2; count--) {
  down.push(L.layoutForCount(down.at(-1), count, "bottom", null, { portrait: true }).layoutId);
}
check(JSON.stringify(down) === JSON.stringify(["portrait-main-2x4", "portrait-2-grid-2x3", "portrait-main-2x3", "portrait-2-grid-2x2",
  "portrait-main-2x2", "portrait-2-bottom-2", "portrait-3", "portrait-2"]), `줄여도 세로 배치끼리 ${down}`);
check(L.layoutForCount("portrait-3", 4, "bottom", null, { portrait: false }).layoutId === "portrait-4",
  "가로 화면이어도 세로 전용 배치를 쓰는 중이면 세로 배치로 잇는다");
check(!L.layoutById(L.layoutForCount("right-2", 4, "right", null, { portrait: false }).layoutId).portrait &&
  L.layoutForCount("grid-2x2", 5, "right", null, { portrait: false }).layoutId === "grid-3x2-5",
  "가로 화면의 가로 배치는 예전처럼 잇는다(세로 전용으로 넘어가지 않는다)");
check(L.layoutForCount("right-3", 5, "bottom", null, { portrait: true }).layoutId === "right-4" &&
  L.layoutForCount("grid-2x4", 9, "bottom", null, { portrait: true }).layoutId === "grid-3x3",
  "세로 화면에서도 가로 배치를 쓰는 중이면 가로 배치끼리 잇는다");
// 새로 넣은 배치끼리의 이음(나란히 놓인 칸 수가 같은 쪽으로).
for (const [from, count, to] of [["portrait-2-bottom-2", 5, "portrait-2-bottom-3"], ["portrait-2-bottom-3", 6, "portrait-3-bottom-3"],
  ["portrait-3-bottom-2", 6, "portrait-4-bottom-2"], ["portrait-3-bottom-3", 7, "portrait-3-grid-2x2"],
  ["portrait-4-bottom-2", 7, "portrait-3-grid-2x2"], ["portrait-3-grid-2x2", 8, "portrait-2-grid-2x3"],
  ["portrait-3-grid-2x2", 6, "portrait-3-bottom-3"], ["portrait-3-bottom-2", 4, "portrait-2-bottom-2"]]) {
  check(L.layoutForCount(from, count, "bottom", null, { portrait: true }).layoutId === to, `${from} → ${count}채널: ${to}`);
}

// 화면 연결.
for (const [name, src] of [["시청 화면", watch], ["고르기 화면", setup]]) {
  check(/window\.matchMedia\?\.\("\(orientation: portrait\)"\)/.test(src) &&
    /addEventListener\?\.\("change", \(\) => \{[\s\S]{0,200}render(Topbar|Layouts)\(\);/.test(src),
    `${name}: 창 방향(세로/가로)을 알아보고, 바뀌면 배치 목록만 다시 그린다`);
  check(/LAYOUTS\.layoutsFor\(state\.chosen\.length, \{ portrait, keepId: state\.layoutId \}\)/.test(src) &&
    /LAYOUTS\.isPortraitGroup\(l\) \? "세로 화면" : "가로 화면"/.test(src) &&
    /mv-layout-group-label/.test(src),
    `${name}: 세로 화면이면 '세로 화면'·'가로 화면' 머리말로 나눈다`);
}
check(/LAYOUTS\.layoutsFor\(chosen\.length, \{ all: true \}\)/.test(watch),
  "시청 화면: 저장한 배치를 복원할 때는 방향과 상관없이 받는다(쓰던 세로 배치가 첫 배치로 바뀌지 않는다)");
check(/\.mv-layout-group-label \{[^}]*grid-column: 1 \/ -1;/.test(css), "머리말은 배치 목록 한 줄을 다 쓴다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
