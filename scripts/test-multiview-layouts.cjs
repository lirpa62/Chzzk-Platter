#!/usr/bin/env node
"use strict";
// 멀티뷰 배치 정의의 일관성을 확인한다. 배치가 어긋나면 화면이 겹치거나 빈다.
const assert = require("node:assert/strict");
const path = require("node:path");
const L = require(path.join(__dirname, "..", "src", "multiviewLayouts.js"));

let fails = 0;
const ok = (cond, message) => {
  console.log((cond ? "  PASS " : "  FAIL ") + message);
  if (!cond) fails++;
};

console.log("[배치] 슬롯과 격자가 맞는다");
function rectangular(areas) {
  const grid = areas.map((row) => row.replace(/"/g, "").trim().split(/\s+/));
  if (new Set(grid.map((row) => row.length)).size !== 1) return false;
  for (const slot of new Set(grid.flat())) {
    if (slot === ".") continue;
    const cells = [];
    grid.forEach((row, ri) => row.forEach((value, ci) => {
      if (value === slot) cells.push([ri, ci]);
    }));
    const rows = cells.map(([row]) => row);
    const cols = cells.map(([, col]) => col);
    const expected = (Math.max(...rows) - Math.min(...rows) + 1) *
      (Math.max(...cols) - Math.min(...cols) + 1);
    if (cells.length !== expected) return false;
  }
  return true;
}
for (const layout of L.LAYOUTS) {
  const areas = layout.areas.join(" ");
  const used = new Set(areas.match(/[a-h]|m/g) || []);
  const need = L.SLOTS.slice(0, layout.aux + 1);
  const missing = need.filter((s) => !used.has(s));
  const extra = [...used].filter((s) => !need.includes(s));
  const cols = layout.areas.map(
    (r) => r.replace(/"/g, "").trim().split(/\s+/).length,
  );
  ok(
    !missing.length && !extra.length && new Set(cols).size === 1,
    `${layout.id}: 슬롯 ${need.join("")} · 열 수 일정`,
  );
  ok(rectangular(layout.areas), `${layout.id}: CSS Grid 영역이 직사각형이다`);
}

console.log("\n[채팅 자리] 보조 화면 반대편에 둔다");
for (const layout of L.LAYOUTS) {
  ok(
    Array.isArray(layout.chat) && layout.chat.length > 0,
    `${layout.id}: 채팅 자리 ${layout.chat.join("/")}`,
  );
  // 보조가 오른쪽이면 채팅은 오른쪽이 아니어야 한다(그 반대도).
  // 빈 칸 채팅 배치는 바깥 자리로 빈 칸이 붙은 쪽을 먼저 권한다(그쪽이 비어 있다).
  if (!layout.chatTop && !layout.chatInsetOption && layout.id.startsWith("right")) {
    ok(!layout.chat.includes("right"), `${layout.id}: 채팅이 오른쪽이 아니다`);
  }
  if (!layout.chatTop && !layout.chatInsetOption && layout.id.startsWith("left")) {
    ok(!layout.chat.includes("left"), `${layout.id}: 채팅이 왼쪽이 아니다`);
  }
}

console.log("\n[채널 수] 2~9개 모두 배치가 있다");
for (let n = 2; n <= 9; n += 1) {
  const list = L.layoutsFor(n);
  ok(list.length > 0, `${n}개: ${list.map((x) => x.label).join(", ")}`);
}
ok(L.layoutsFor(10).length === 0, "10개는 지원하지 않는다(보조 최대 8개)");
ok(L.SLOTS.length === 9 && !L.SLOTS.some((slot) => ["x", "y", "z"].includes(slot)),
  "슬롯 9개, 채팅·손잡이 자리(x·y·z)와 겹치지 않는다");
ok(L.layoutsFor(1).length === 0, "1개는 멀티뷰가 아니다");

console.log("\n[stageStyle] 채팅 위치에 따라 방향이 바뀐다");
const right = L.layoutById("right-1");
ok(
  L.stageStyle(right, "left").direction === "row-reverse",
  "왼쪽 채팅 → row-reverse",
);
ok(L.stageStyle(right, "bottom").direction === "column", "아래 채팅 → column");
// 채팅이 격자 안에 있는 배치는 해당 칸의 좌/우 자리만 고를 수 있다.
for (const layout of L.LAYOUTS) {
  for (const side of L.CHAT_SIDES) {
    ok(
      L.stageStyle(layout, side).side === (layout.chatInset ? layout.chat[0] :
        layout.chatTop && side === "bottom" ? "right" : side),
      `${layout.id}: 채팅 ${side} 위치가 유효하게 적용된다`,
    );
  }
}
ok(
  L.CHAT_SIDES.includes(L.stageStyle(right, "top").side),
  "제공하지 않는 자리는 기본값으로 되돌린다",
);

console.log("\n[대칭] 오른쪽 배치에는 왼쪽 짝이 있어야 한다");
// 6채널에 왼쪽 5 가 빠져 있었다(오른쪽 5 만 있었다).
for (const layout of L.LAYOUTS) {
  if (!layout.id.startsWith("right-")) continue;
  const mirror = "left-" + layout.id.slice("right-".length);
  ok(!!L.layoutById(mirror), `${layout.id} 의 짝 ${mirror} 이 있다`);
}
for (const n of [2, 3, 4, 5, 6]) {
  const ids = L.layoutsFor(n).map((l) => l.id);
  ok(ids.length >= 2, `${n}채널 배치 ${ids.length}개: ${ids.join(", ")}`);
}

console.log("\n[추가 배치] 요청한 채널 수별 변형이 모두 있다");
for (const [count, ids] of [
  [2, ["main-chat-top", "right-1-0", "left-1-0", "bottom-1-0", "bottom-1-2"]],
  [3, ["top-2-single-0", "top-2-single-1", "top-2-single-2", "bottom-2-single-1",
    "main-top-chat-top", "main-bottom-chat-top",
    "tl-1-right-2", "tr-1-left-2"]],
  [4, ["top-2-chat-top", "bottom-2-chat-top"]],
  [5, ["grid-2x3-5", "top-4", "bottom-4", "grid-2x2-chat-top", "right-3-chat-top", "left-3-chat-top", "top-3-chat-top", "bottom-3-chat-top"]],
  [6, ["grid-2x3-6", "top-5", "bottom-5", "right-4-chat-top", "left-4-chat-top", "top-4-chat-top", "bottom-4-chat-top",
    "grid-2-3-chat-top", "grid-3-2-chat-top"]],
]) {
  const available = new Set(L.layoutsFor(count).map((layout) => layout.id));
  for (const id of ids) ok(available.has(id), `${count}채널: ${id}`);
}
for (const side of ["right", "left"]) {
  for (const pos of [0, 2]) {
    ok(!!L.layoutById(`${side}-2-bottom-1-${pos}`), `4채널: ${side} 2 + bottom 1 (${pos})`);
  }
}
for (const id of ["right-1-1", "right-1-2", "left-1-1", "left-1-2",
  "bottom-1-1", "top-1-0", "top-1-1", "top-1-2",
  "right-2-top-1-0", "right-2-top-1-1", "right-2-top-1-2",
  "right-2-bottom-1-1", "left-2-top-1-0", "left-2-top-1-1", "left-2-top-1-2",
  "right-2-chat-top", "left-2-chat-top", "left-2-bottom-1-1",
  "bottom-2-single-0", "bottom-2-single-2", "grid-2x3-bottom-1-2"]) {
  ok(L.layoutById(id) === null, `${id}: 삭제된 배치`);
}

console.log("\n[채팅 위 영상] 채팅 위치만 뒤집고 프레임 슬롯은 유지한다");
for (const layout of L.LAYOUTS.filter((item) => item.chatTop)) {
  const rightGrid = L.chatTopStageGrid(layout, "right");
  const leftGrid = L.chatTopStageGrid(layout, "left");
  const hiddenGrid = L.chatTopStageGrid(layout, "right", true);
  ok(rectangular(rightGrid.areas.split(/(?<=")\s+(?=")/)), `${layout.id}: 오른쪽 채팅 Grid가 유효하다`);
  ok(rectangular(leftGrid.areas.split(/(?<=")\s+(?=")/)), `${layout.id}: 왼쪽 채팅 Grid가 유효하다`);
  ok(rectangular(hiddenGrid.areas.split(/(?<=")\s+(?=")/)), `${layout.id}: 접힌 채팅 Grid가 유효하다`);
  ok(rightGrid.areas.includes(" z ") && leftGrid.areas.includes(" z "), `${layout.id}: 리사이저 열`);
  ok(rightGrid.areas.includes(" x") && leftGrid.areas.includes('"x '), `${layout.id}: 좌우 채팅 열`);
  ok(!hiddenGrid.areas.includes(" x"), `${layout.id}: 채팅 접으면 마지막 영상이 열을 채운다`);
  ok(rightGrid.areas.includes(" y"), `${layout.id}: 영상과 채팅 사이 높이 조절 행`);
  ok(!hiddenGrid.areas.includes(" y"), `${layout.id}: 채팅 접으면 높이 조절 행도 사라진다`);
  ok(rightGrid.columns.includes("min(var(--mv-chat-w, 370px), 60%)"), `${layout.id}: 채팅 너비와 화면 상한 사용`);
}
console.log("\n[빈 칸 채팅] 빈 칸이 직사각형 하나로 남는 배치");
{
  // 빈 칸이 기본이고 바깥(좌/우/아래)도 고를 수 있는 배치. 값은 바깥을 고를 때 먼저 권하는
  // 쪽(빈 칸이 붙은 가장자리).
  const insetDefault = {
    "right-1-0": "right", "left-1-0": "left",
    "bottom-1-0": "right", "bottom-1-2": "left",
    "top-2-single-0": "right", "top-2-single-2": "left",

    "right-2-bottom-1-0": "right", "right-2-bottom-1-2": "left",
    "left-2-bottom-1-0": "right", "left-2-bottom-1-2": "left",
    "tl-1-right-2": "left", "tr-1-left-2": "right",
    // 빈 칸이 한 칸 남는 5채널 배치도 빈 칸이 기본이다.
    "right2-bottom2": "left", "left2-bottom2": "right", "grid-3x2-5": "right", "grid-2x3-5": "right",
    // 7·8채널 그리드.
    "grid-3x2-bottom-1-0": "right", "grid-3x2-bottom-1-2": "left",
    "grid-2x3-bottom-1-0": "right", "grid-3x3-8": "right",
  };
  // 바깥이 기본이고 '빈 칸' 은 골라야 쓰는 배치(지금은 없다).
  const outsideDefault = [];
  ok(JSON.stringify(L.LAYOUTS.filter((layout) => layout.chatInsetOption).map((layout) => layout.id).sort()) ===
    JSON.stringify([...Object.keys(insetDefault), ...outsideDefault].sort()),
    "빈 칸 채팅을 쓸 수 있는 배치는 위 두 목록뿐이다");
  for (const layout of L.LAYOUTS.filter((item) => item.chatInsetOption)) {
    const id = layout.id;
    const sides = L.chatSidesFor(layout);
    ok(["right", "left", "bottom", L.CHAT_INSET_SIDE].every((side) => sides.includes(side)) &&
      sides.length === 4, `${id}: 빈 칸·오른쪽·왼쪽·아래를 모두 고를 수 있다`);
    for (const side of ["right", "left", "bottom"]) {
      ok(L.stageStyle(layout, side).side === side && !L.usesChatInset(layout, side),
        `${id}: 바깥 ${side} 를 고르면 격자 밖에 둔다`);
    }
    ok(L.stageStyle(layout, L.CHAT_INSET_SIDE).side === L.CHAT_INSET_SIDE &&
      L.usesChatInset(layout, L.CHAT_INSET_SIDE), `${id}: '빈 칸' 을 고르면 격자 안에 둔다`);
    const grid = L.chatInsetStageGrid(layout);
    const hidden = L.chatInsetStageGrid(layout, true);
    const rows = grid.areas.split(/(?<=")\s+(?=")/);
    ok(rectangular(rows) && grid.areas.includes("x") && !grid.areas.includes("."),
      `${id}: 빈 칸 전체가 채팅 자리다 (${grid.areas})`);
    ok(hidden.areas === layout.areas.join(" ") && !layout.areas.join(" ").includes("x"),
      `${id}: 바깥 채팅·접기에서는 원래 격자(빈 칸) 그대로다`);
  }
  for (const [id, outside] of Object.entries(insetDefault)) {
    const layout = L.layoutById(id);
    const sides = L.chatSidesFor(layout);
    ok(sides[0] === L.CHAT_INSET_SIDE && sides[1] === outside,
      `${id}: 기본은 빈 칸, 바깥은 ${outside} 를 먼저 권한다`);
    ok(L.stageStyle(layout, "").side === L.CHAT_INSET_SIDE, `${id}: 처음 열면 빈 칸에 채팅`);
    ok(L.chatSideForSwitch(layout, "bottom") === L.CHAT_INSET_SIDE,
      `${id}: 다른 배치에서 바꿔 오면 빈 칸으로 간다`);
    const preview = L.previewGrid(layout);
    ok(preview.chat && preview.areas.includes("x"), `${id}: 미리보기에 빈 칸 채팅을 그린다`);
  }
  for (const id of outsideDefault) {
    const layout = L.layoutById(id);
    const sides = L.chatSidesFor(layout);
    ok(sides[0] === layout.chat[0] && sides[0] !== L.CHAT_INSET_SIDE &&
      L.stageStyle(layout, "").side === layout.chat[0], `${id}: 기본값은 기존처럼 바깥 채팅`);
    ok(L.chatSideForSwitch(layout, "bottom") === "bottom" &&
      L.chatSideForSwitch(layout, L.CHAT_INSET_SIDE) === L.CHAT_INSET_SIDE,
      `${id}: 바꿔 오면 지금 자리를 쓸 수 있으면 그대로 둔다`);
    const preview = L.previewGrid(layout);
    ok(!preview.chat && !preview.areas.includes("x"), `${id}: 미리보기는 바깥 채팅 모양`);
  }
  // 빈 칸이 양쪽으로 갈라진 가운데 배치는 바깥 채팅만 쓴다.
  for (const id of ["top-2-single-1", "bottom-2-single-1"]) {
    ok(!L.chatSidesFor(L.layoutById(id)).includes(L.CHAT_INSET_SIDE), `${id}: 빈 칸이 갈라져 바깥 채팅만`);
  }
  for (const layout of L.LAYOUTS.filter((item) => !item.chatInsetOption)) {
    ok(!L.chatSidesFor(layout).includes(L.CHAT_INSET_SIDE) &&
      L.stageStyle(layout, L.CHAT_INSET_SIDE).side !== L.CHAT_INSET_SIDE,
      `${layout.id}: '빈 칸' 을 고를 수 없다`);
    ok(L.chatSideForSwitch(layout, L.CHAT_INSET_SIDE) === L.chatSidesFor(layout)[0],
      `${layout.id}: 빈 칸 배치에서 바꿔 오면 이 배치의 기본 자리로`);
  }
  const watch = require("node:fs").readFileSync(
    path.join(__dirname, "..", "src", "multiviewWatch.js"), "utf8");
  const setup = require("node:fs").readFileSync(
    path.join(__dirname, "..", "src", "multiview.js"), "utf8");
  ok(/const inset = LAYOUTS\.usesChatInset\(layout, side\);[\s\S]{0,1200}applyGridTemplates\(layout, side, inset, hideChat\);/.test(watch) &&
    /function applyGridTemplates\(layout, side, inset, hideChat\) \{[\s\S]{0,200}const tracks = inset \? null : LAYOUTS\.solveTracks\(layout\);/.test(watch),
    "시청 화면: '빈 칸' 이면 격자 안 채팅으로 그리고 16:9 트랙을 끈다");
  ok(/if \(!LAYOUTS\.chatSidesFor\(layout\)\.includes\(side\)\) return;/.test(watch) &&
    /const sides = LAYOUTS\.chatSidesFor\(layout\);\s*\$\("mvSidePanel"\)/.test(watch) &&
    /\[LAYOUTS\.CHAT_INSET_SIDE\]: "빈 칸"/.test(watch),
    "시청 화면: 채팅 위치 패널에 '빈 칸' 이 나오고 같은 규칙으로 검증한다");
  ok((watch.match(/LAYOUTS\.chatSideForSwitch\(/g) || []).length === 1 &&
    (setup.match(/LAYOUTS\.chatSideForSwitch\(/g) || []).length === 1 &&
    // 세로 화면이면 세로 배치끼리 잇도록 방향을 함께 넘긴다.
    (watch.match(/LAYOUTS\.layoutForCount\(state\.layoutId, state\.chosen\.length, state\.chatSide, layoutCountBack,\s*\{ portrait/g) || []).length === 1 &&
    (setup.match(/LAYOUTS\.layoutForCount\(state\.layoutId, state\.chosen\.length, state\.chatSide, layoutCountBack,\s*\{ portrait/g) || []).length === 1 &&
    !/state\.layoutId = list\[0\]\.id|state\.layoutId = allowed\[0\]\.id|state\.layoutId = ""/.test(watch + setup),
    "배치를 바꾸는 모든 곳이 같은 규칙을 쓴다(직접 고르기 chatSideForSwitch, 채널 수 변경 layoutForCount)");
  ok((watch.match(/LAYOUTS\.previewGrid\(l\)/g) || []).length === 1 &&
    (setup.match(/LAYOUTS\.previewGrid\(l\)/g) || []).length === 1,
    "고르기 화면과 시청 화면 미리보기가 같은 계산을 쓴다");
}

console.log("\n[3채널] 위 한쪽 메인 + 반대쪽 보조 2 + 메인 아래 채팅");
for (const [id, label, areas] of [
  ["tl-1-right-2", "오른쪽 2 · 메인 위", '"m a" "x b"'],
  ["tr-1-left-2", "왼쪽 2 · 메인 위", '"a m" "b x"'],
]) {
  const layout = L.layoutById(id);
  ok(layout?.label === label && layout.aux === 2, `${id}: 3채널 '${label}'`);
  ok(L.chatInsetStageGrid(layout).areas === areas, `${id}: 메인 아래 칸이 채팅 자리(${areas})`);
  ok(L.stageStyle(layout, "").side === L.CHAT_INSET_SIDE && L.previewGrid(layout).chat,
    `${id}: 처음부터 채팅이 그 칸에 있고 미리보기에도 그린다`);
}

console.log("\n[이름·순서] 보조가 있는 쪽으로 묶어 오른쪽 → 왼쪽 → 아래 → 위 → 그리드 → 채팅 위 1");
{
  const expected = {
    2: ["오른쪽 1", "오른쪽 1 · 위", "왼쪽 1", "왼쪽 1 · 위", "아래 1", "아래 1 · 왼쪽", "아래 1 · 오른쪽",
      "위 1", "메인 + 채팅 위 1"],
    3: ["오른쪽 2", "오른쪽 2 · 메인 위", "왼쪽 2", "왼쪽 2 · 메인 위", "아래 2", "아래 2 · 메인 가운데",
      "위 2", "위 2 · 메인 왼쪽", "위 2 · 메인 가운데", "위 2 · 메인 오른쪽",
      "메인 위 + 채팅 위 1", "메인 아래 + 채팅 위 1"],
    4: ["오른쪽 3", "오른쪽 2 + 아래 1 · 왼쪽", "오른쪽 2 + 아래 1 · 오른쪽", "왼쪽 3",
      "왼쪽 2 + 아래 1 · 왼쪽", "왼쪽 2 + 아래 1 · 오른쪽", "아래 3", "위 3", "그리드 2×2",
      "아래 2 + 채팅 위 1", "위 2 + 채팅 위 1", "아래 1 + 채팅 위 2"],
    5: ["오른쪽 2 + 아래 2", "오른쪽 2×2", "오른쪽 4", "왼쪽 2 + 아래 2", "왼쪽 2×2", "왼쪽 4", "아래 4",
      "위 4", "그리드 3×2", "그리드 2×3", "그리드 2·3", "그리드 3·2", "오른쪽 3 + 채팅 위 1", "왼쪽 3 + 채팅 위 1", "아래 3 + 채팅 위 1",
      "위 3 + 채팅 위 1", "그리드 2×2 + 채팅 위 1",
      "오른쪽 2 + 채팅 위 2", "왼쪽 2 + 채팅 위 2", "아래 2 + 채팅 위 2", "위 2 + 채팅 위 2"],
    6: ["오른쪽 2 + 아래 3", "오른쪽 5", "왼쪽 2 + 아래 3", "왼쪽 5", "아래 5", "위 5", "그리드 3×2",
      "그리드 2×3", "오른쪽 4 + 채팅 위 1", "왼쪽 4 + 채팅 위 1", "아래 4 + 채팅 위 1", "위 4 + 채팅 위 1",
      "그리드 2·3 + 채팅 위 1", "그리드 3·2 + 채팅 위 1",
      "오른쪽 3 + 채팅 위 2", "왼쪽 3 + 채팅 위 2", "아래 3 + 채팅 위 2", "위 3 + 채팅 위 2", "그리드 2×2 + 채팅 위 2"],
    7: ["그리드 3×2 + 아래 1 · 왼쪽", "그리드 3×2 + 아래 1 · 오른쪽", "그리드 2×3 + 아래 1 · 왼쪽",
      "그리드 3·3 + 채팅 위 1", "그리드 3×2 + 채팅 위 1", "그리드 2·3 + 채팅 위 2", "그리드 3·2 + 채팅 위 2"],
    8: ["그리드 3×3", "그리드 2×4", "그리드 3·3 + 채팅 위 2"],
    9: ["그리드 3×3"],
  };
  for (const [count, labels] of Object.entries(expected)) {
    const got = L.layoutsFor(Number(count)).map((layout) => layout.label);
    ok(JSON.stringify(got) === JSON.stringify(labels), `${count}채널 순서·이름: ${got.join(" | ")}`);
  }
  // 채널 수가 바뀔 때 고르는 기본 배치(각 목록의 첫 배치)는 그대로다.
  ok(["right-1", "right-2", "right-3", "right2-bottom2", "right2-bottom3"]
    .every((id, i) => L.layoutsFor(i + 2)[0].id === id), "채널 수별 기본 배치는 바뀌지 않았다");
  ok(L.LAYOUTS.every((layout) => !/\S\+|\+\S/.test(layout.label)), "'+' 앞뒤 띄어쓰기를 맞춘다");
  // 카드 폭 78~100px 에서 18자·20자 이름 모두 두 줄이다(실측). 세 줄이 되지 않게 20자까지.
  ok(L.LAYOUTS.every((layout) => [...layout.label].length <= 20),
    `이름은 20자 이하(가장 긴 이름: ${L.LAYOUTS.map((l) => l.label).sort((a, b) => [...b].length - [...a].length)[0]})`);
  const src = require("node:fs").readFileSync(path.join(__dirname, "..", "src", "multiviewLayouts.js"), "utf8");
  const order = [...src.slice(src.indexOf("const LAYOUT_ORDER = ["), src.indexOf("];", src.indexOf("const LAYOUT_ORDER = ["))).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  ok(L.LAYOUTS.every((layout) => order.includes(layout.id)) && order.every((id) => L.layoutById(id)),
    "모든 배치가 순서표에 있고, 순서표에 없는 배치 id 는 없다");
  // '채팅 위 1' 은 따로 붙는 채팅 열이라 미리보기에 손잡이를 그려 빈 칸 채팅과 구분한다.
  for (const layout of L.LAYOUTS.filter((item) => item.chatTop)) {
    const p = L.previewGrid(layout);
    const rows = p.areas.split(/(?<=")\s+(?=")/);
    ok(p.handle && p.chat && rectangular(rows) && rows.every((row) => / z [^ "]+"$/.test(row)) &&
      p.columns === `${layout.coreColumns} 2px 1fr`, `${layout.id}: 미리보기에 채팅 열 손잡이(z)`);
  }
  ok(L.LAYOUTS.filter((item) => item.chatInsetOption).every((layout) => !L.previewGrid(layout).handle),
    "빈 칸 채팅 배치 미리보기에는 손잡이가 없다");
  // 이름에는 채팅 위치를 쓰지 않고 미리보기 채팅 칸에 '채팅' 을 적는다(좁으면 쓰지 않는다).
  ok(L.LAYOUTS.every((layout) => !/채팅 (아래|왼쪽|오른쪽)/.test(layout.label)), "이름에 채팅 위치를 쓰지 않는다");
  const css = require("node:fs").readFileSync(path.join(__dirname, "..", "src", "multiview.css"), "utf8");
  ok(/\.mv-layout-preview i\.is-chat \{[^}]*container-type: inline-size;/.test(css) &&
    /@container \(min-width: 20px\) \{\s*\.mv-layout-preview i\.is-chat::after \{\s*content: "채팅";/.test(css),
    "미리보기 채팅 칸에 '채팅' 을 적고, 칸이 좁으면 쓰지 않는다");
}

console.log("\n[3채널 채팅 위 1] 왼쪽 열을 메인·보조 1 이 위아래로 나누고 채팅 열 위에 보조 2");
for (const [id, label, areas] of [
  ["main-top-chat-top", "메인 위 + 채팅 위 1", '"m b" "a x"'],
  ["main-bottom-chat-top", "메인 아래 + 채팅 위 1", '"a b" "m x"'],
]) {
  const layout = L.layoutById(id);
  ok(layout?.label === label && layout.aux === 2 && layout.chatTop && layout.areas.join(" ") === areas &&
    layout.rows === "1fr 1fr", `${id}: '${label}' (${areas}, 메인·보조 1 같은 크기)`);
  const [upper, lower] = id === "main-top-chat-top" ? ["m", "a"] : ["a", "m"];
  const right = L.chatTopStageGrid(layout, "right");
  const left = L.chatTopStageGrid(layout, "left");
  const hidden = L.chatTopStageGrid(layout, "right", true);
  ok(right.areas === `"${upper} z b" "${upper} z y" "${upper} z x" "${lower} z x"` &&
    left.areas === `"b z ${upper}" "y z ${upper}" "x z ${upper}" "x z ${lower}"`,
    `${id}: 왼쪽 열은 반씩, 채팅 열은 위 영상·손잡이·채팅으로 나눈다(좌우 대칭)`);
  ok(/^minmax\(0, min\(var\(--mv-chat-top-h.*calc\(50% - 8px\)\)\) 6px minmax\(0, calc\(50% - .* - 8px\)\) minmax\(0, 1fr\)$/.test(right.rows),
    `${id}: 채팅 위 영상 높이는 조절하되 절반을 넘지 않는다`);
  ok(hidden.areas === `"${upper} z b" "${lower} z b"` && hidden.rows === "1fr 1fr",
    `${id}: 채팅을 숨기면 보조 2 가 채팅 열 전체를 쓴다`);
}

console.log("\n[채팅 위 1 · 줄 나눔] 격자 줄은 배치 비율대로, 채팅 위 영상은 첫 줄 안에서만");
for (const [id, share, areas] of [
  ["grid-2x2-chat-top", "50%", '"m a z d" "m a z y" "m a z x" "b c z x"'],
  ["grid-2-3-chat-top", "33.3333%", '"m a z e" "m a z y" "m a z x" "m c z x" "b c z x" "b d z x"'],
  ["grid-3-2-chat-top", "33.3333%", '"a m z e" "a m z y" "a m z x" "c m z x" "c b z x" "d b z x"'],
]) {
  const layout = L.layoutById(id);
  const grid = L.chatTopStageGrid(layout, "right");
  ok(layout?.chatTopSplit && grid.areas === areas && grid.rows.includes(`calc(${share} - 8px)`) &&
    grid.rows.endsWith(layout.rows.split(" ").slice(1).map((v) => `minmax(0, ${v})`).join(" ")),
    `${id}: 첫 줄(${share}) 안에서 위 영상·손잡이·채팅을 나눈다`);
  ok(L.chatTopStageGrid(layout, "right", true).rows === layout.rows, `${id}: 채팅을 숨기면 배치 비율 그대로`);
}
{
  // 6채널 그리드: 메인·보조 1 은 반씩(2+1 / 1+2), 보조 3 은 3등분(2 / 1+1 / 2).
  const spans = (id) => {
    const { spans: s } = L.slotSpans(L.layoutById(id));
    const fr = L.layoutById(id).rows.split(" ").map(parseFloat);
    return Object.fromEntries(Object.entries(s).map(([slot, sp]) =>
      [slot, fr.slice(sp.r0, sp.r1 + 1).reduce((a, b) => a + b, 0)]));
  };
  const a = spans("grid-2-3-chat-top");
  const b = spans("grid-3-2-chat-top");
  ok(a.m === 3 && a.b === 3 && a.a === 2 && a.c === 2 && a.d === 2 && a.e === 2,
    "그리드 2·3: 왼쪽 열 메인·보조 1 반씩, 오른쪽 열 보조 3 등분");
  ok(b.m === 3 && b.b === 3 && b.a === 2 && b.c === 2 && b.d === 2,
    "그리드 3·2: 왼쪽 열 보조 3 등분, 오른쪽 열 메인·보조 1 반씩");
}

console.log("\n[채팅 위 2] 채팅 열 위에 영상 둘, 격자 줄과 경계를 맞춘다");
{
  const twos = L.LAYOUTS.filter((layout) => layout.chatTopVideos === 2);
  ok(JSON.stringify(twos.map((layout) => `${layout.aux + 1}:${layout.label}`)) === JSON.stringify([
    "4:아래 1 + 채팅 위 2",
    "5:오른쪽 2 + 채팅 위 2", "5:왼쪽 2 + 채팅 위 2", "5:아래 2 + 채팅 위 2", "5:위 2 + 채팅 위 2",
    "6:오른쪽 3 + 채팅 위 2", "6:왼쪽 3 + 채팅 위 2", "6:아래 3 + 채팅 위 2", "6:위 3 + 채팅 위 2",
    "6:그리드 2×2 + 채팅 위 2",
    "7:그리드 2·3 + 채팅 위 2", "7:그리드 3·2 + 채팅 위 2",
    "8:그리드 3·3 + 채팅 위 2",
  ]), `채팅 위 2 배치: ${twos.map((layout) => layout.label).join(", ")}`);
  const chatCol = (areas, left) => areas.split(/(?<=")\s+(?=")/).map((row) => {
    const cells = row.replace(/"/g, "").trim().split(/\s+/);
    return left ? cells[0] : cells[cells.length - 1];
  });
  for (const layout of twos) {
    const [f, g] = L.SLOTS.slice(layout.aux - 1, layout.aux + 1);
    const right = L.chatTopStageGrid(layout, "right");
    const left = L.chatTopStageGrid(layout, "left");
    const hidden = L.chatTopStageGrid(layout, "right", true);
    // 괄호 밖 공백으로 줄 크기를 나눈다(calc·min·var 가 겹겹이 들어 있다).
    const rowsOf = (grid) => {
      const out = [];
      let depth = 0;
      let token = "";
      for (const ch of grid.rows) {
        if (ch === " " && depth === 0) { if (token) out.push(token); token = ""; continue; }
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        token += ch;
      }
      if (token) out.push(token);
      return out;
    };
    const col = chatCol(right.areas).join(" ");
    ok([right, left, hidden].every((grid) => rectangular(grid.areas.split(/(?<=")\s+(?=")/))) &&
      rowsOf(right).length === right.areas.split(/(?<=")\s+(?=")/).length &&
      rowsOf(hidden).length === hidden.areas.split(/(?<=")\s+(?=")/).length &&
      new RegExp(`^${f} ${g}( ${g})? y( x)+$`).test(col) &&
      chatCol(left.areas, true).join(" ") === col,
      `${layout.id}: 채팅 열 [${f}][${g}][손잡이][채팅], 좌우 대칭, 줄 수 일치 (${col})`);
    ok(new RegExp(`^${f}( ${f})* ${g}( ${g})*$`).test(chatCol(hidden.areas).join(" ")) &&
      !/[xy]/.test(hidden.areas), `${layout.id}: 채팅을 숨기면 영상 둘이 채팅 열을 나눠 쓴다`);
    // 미리보기는 채팅 열을 [영상 1/4][영상 1/4][채팅 1/2] 로 그린다.
    const fr = layout.rows.split(" ").map(parseFloat);
    const share = (slot) => chatCol(layout.areas.join(" ")).reduce((sum, edge, i) => sum + (edge === slot ? fr[i] : 0), 0) / 12;
    ok(Math.abs(share(f) - 0.25) < 1e-6 && Math.abs(share(g) - 0.25) < 1e-6 && Math.abs(share("x") - 0.5) < 1e-6,
      `${layout.id}: 미리보기 채팅 열 1/4·1/4·1/2`);
  }
  // 첫 줄이 40% 이상이면 영상 둘을 첫 줄 안에, 아니면 둘째 영상이 첫 줄 경계를 넘는다.
  const within = L.chatTopStageGrid(L.layoutById("bottom-1-chat-top-2"), "right");
  ok(within.areas === '"m z b" "m z c" "m z y" "m z x" "a z x"' &&
    within.rows.startsWith("minmax(0, min(var(--mv-chat-top-h, ") && within.rows.includes("calc((75% - 12px) / 2)"),
    "아래 1: 첫 줄(75%) 안에 영상 둘·손잡이, 영상 높이는 (첫 줄 − 12px) / 2 까지");
  const straddle = L.chatTopStageGrid(L.layoutById("grid-3-3-chat-top-2"), "right");
  ok(straddle.areas === '"m a z f" "m a z g" "b c z g" "b c z y" "b c z x" "d e z x"' &&
    straddle.rows.startsWith("minmax(0, clamp(calc(33.3333% / 2), var(--mv-chat-top-h, ") &&
    straddle.rows.includes("min(calc(33.3333% - 8px), calc((66.6667% - 12px) / 2))"),
    "그리드 3·3: 둘째 영상이 첫 줄 경계를 넘고, 영상 높이는 첫 줄 절반~min(첫 줄, 두 줄 절반)");
  const top2 = L.chatTopStageGrid(L.layoutById("top-2-chat-top-2"), "right");
  ok(top2.areas === '"a b z c" "a b z d" "m m z d" "m m z y" "m m z x"' && top2.rows.endsWith("6px minmax(0, 1fr)"),
    "위 2: 줄이 둘뿐이면 채팅이 남은 높이를 모두 쓴다");
  const watch = require("node:fs").readFileSync(path.join(__dirname, "..", "src", "multiviewWatch.js"), "utf8");
  ok(/const videos = LAYOUTS\.layoutById\(state\.layoutId\)\?\.chatTopVideos \|\| 1;/.test(watch) &&
    (watch.match(/applyChatTopSize\(chatTopSizeAt\(/g) || []).length === 2,
    "손잡이를 끌거나 키로 옮기면 영상 한 개 높이로 바꿔 저장한다(끌기·키보드)");
}

console.log("\n[채널 수 변경] 지금과 비슷한 배치로 간다");
{
  const N = L.COUNT_NEIGHBORS;
  const count = (id) => L.layoutById(id).aux + 1;
  ok(L.LAYOUTS.every((layout) => N[layout.id]) && Object.keys(N).every((id) => L.layoutById(id)),
    "모든 배치가 대응표에 있고, 없는 배치 id 는 없다");
  ok(L.LAYOUTS.every((layout) => {
    const [down, up] = N[layout.id];
    const n = layout.aux + 1;
    return (n === 2 ? down === null : count(down) === n - 1) && (n === 9 ? up === null : count(up) === n + 1);
  }), "−1 은 한 채널 적은 배치, +1 은 한 채널 많은 배치(2채널 −, 9채널 + 없음)");
  const step = (id, n) => L.layoutForCount(id, n, "right")?.layoutId;
  for (const [from, n, to] of [
    ["left-3", 5, "left-4"], ["left-3", 3, "left-2"],
    ["right-1-0", 3, "tl-1-right-2"], ["left-1-0", 3, "tr-1-left-2"],
    ["grid-2x2", 3, "tl-1-right-2"], ["tl-1-right-2", 4, "grid-2x2"],
    ["grid-2x2-chat-top", 6, "grid-2-3-chat-top"], ["grid-3-2-chat-top", 5, "grid-2x2-chat-top"],
    // 5채널 그리드 2·3 / 3·2: 다섯 칸을 그대로 두고 늘리면 채팅 위에 올린다.
    ["grid-2-3", 6, "grid-2-3-chat-top"], ["grid-3-2", 6, "grid-3-2-chat-top"],
    ["grid-2-3", 4, "grid-2x2"], ["grid-3-2", 4, "grid-2x2"],
    ["right-3-chat-top", 4, "bottom-2-chat-top"], ["left-3-chat-top", 4, "top-2-chat-top"],
    ["right2-bottom2", 4, "right-2-bottom-1-0"], ["left2-bottom2", 4, "left-2-bottom-1-2"],
    ["right-2x2", 6, "right2-bottom3"], ["main-chat-top", 3, "main-top-chat-top"],
    ["bottom-2-chat-top", 3, "main-top-chat-top"],
    // 두 칸 이상 바뀌면 한 칸씩 따라간다.
    ["left-1", 5, "left-4"], ["top-5", 2, "top-1"],
    // 7~9채널(승인한 표).
    ["grid-3x2", 7, "grid-3x2-chat-top"], ["grid-2x3-6", 7, "grid-3-3-chat-top"],
    ["left-5", 7, "grid-3x2-bottom-1-2"], ["right2-bottom3", 7, "grid-3x2-bottom-1-0"],
    ["grid-3-3-chat-top", 6, "grid-2-3-chat-top"], ["grid-3-3-chat-top", 8, "grid-3-3-chat-top-2"],
    ["grid-3x3-8", 7, "grid-3x2-bottom-1-0"], ["grid-2x4", 7, "grid-2x3-bottom-1-0"],
    ["grid-3x3", 8, "grid-3x3-8"], ["grid-2x3-bottom-1-0", 9, "grid-3x3"],
    // 채팅 위 2(승인한 표): 줄이면 채팅 열 영상 하나를 뺀다.
    ["bottom-2-chat-top-2", 4, "bottom-2-chat-top"], ["grid-2-3-chat-top-2", 6, "grid-2-3-chat-top"],
    ["right-2-chat-top-2", 4, "bottom-1-chat-top-2"], ["bottom-1-chat-top-2", 3, "main-top-chat-top"],
    ["right-3-chat-top-2", 7, "grid-2-3-chat-top-2"], ["left-3-chat-top-2", 7, "grid-3-2-chat-top-2"],
    ["top-3-chat-top-2", 7, "grid-3x2-chat-top"], ["grid-2x2-chat-top-2", 8, "grid-3-3-chat-top-2"],
  ]) ok(step(from, n) === to, `${from} → ${n}채널: ${to}`);
  ok(L.layoutForCount("left-3", 4, "right") === null, "채널 수가 같으면 바꾸지 않는다");
  ok(step("없는배치", 3) === "right-2" && step("", 4) === "right-3", "지금 배치를 모르면 첫 배치");
  ok(L.layoutForCount("left-3", 1, "right") === null, "배치가 없는 채널 수면 그대로 둔다");

  // 채팅 자리: 쓸 수 있으면 그대로, 빈 칸이 기본인 배치로 가면 빈 칸.
  ok(L.layoutForCount("left-3", 5, "bottom").chatSide === "bottom", "새 배치가 허용하면 채팅 자리를 유지한다");
  ok(L.layoutForCount("left-3", 5, "inset").chatSide === "right", "허용하지 않으면 새 배치의 기본 자리");
  ok(L.layoutForCount("grid-2x2", 5, "left").chatSide === "inset", "빈 칸이 기본인 배치로 가면 빈 칸");

  // 되돌아가기: 자동으로 바뀐 배치를 그대로 둔 채 채널 수를 되돌리면 원래 배치·채팅 자리로.
  const back = new Map();
  const down = L.layoutForCount("right-2x2", 4, "bottom", back);
  ok(down.layoutId === "right-3", "오른쪽 2×2 → 4채널: 오른쪽 3");
  const up = L.layoutForCount(down.layoutId, 5, down.chatSide, back);
  ok(up.layoutId === "right-2x2" && up.chatSide === "bottom", "다시 5채널: 표의 '오른쪽 4' 가 아니라 원래 '오른쪽 2×2'·채팅 자리로");
  const again = L.layoutForCount(up.layoutId, 4, up.chatSide, back);
  ok(again.layoutId === "right-3", "되돌아간 뒤 다시 빼도 같은 배치");
  ok(L.layoutForCount("right-3", 5, "left").layoutId === "right-4", "기록이 없으면 표를 따른다");
  const chain = new Map();
  const a4 = L.layoutForCount("grid-3x2", 5, "right", chain);
  const a3 = L.layoutForCount(a4.layoutId, 4, a4.chatSide, chain);
  const b4 = L.layoutForCount(a3.layoutId, 5, a3.chatSide, chain);
  const b5 = L.layoutForCount(b4.layoutId, 6, b4.chatSide, chain);
  ok(a4.layoutId === "grid-3x2-5" && a3.layoutId === "grid-2x2" && b4.layoutId === "grid-3x2-5" &&
    b5.layoutId === "grid-3x2", "여러 번 줄였다 늘려도 거꾸로 같은 길로 돌아온다");
}

console.log("\n[layoutById] 없는 id 는 null");
ok(L.layoutById("없는배치") === null, "모르는 id 는 null 을 돌려준다");
ok(L.layoutById(right.id) === right, "id 로 같은 배치를 찾는다");

console.log("\n[solveTracks] 모든 칸이 16:9 가 되는 트랙을 푼다");
// 레터박스를 없애려면 칸 자체가 16:9 여야 한다. 지금은 모든 배치에 해가 있다 —
// 해가 없던 L자 배치(오른쪽/왼쪽+아래·위)는 빼고, 전체 폭 띠를 쓰는 배치는
// 메인이 보조 열 수만큼 행을 차지하게 고쳤다.
const NO_SOLUTION = new Set();
for (const layout of L.LAYOUTS) {
  const tracks = L.solveTracks(layout);
  if (NO_SOLUTION.has(layout.id)) {
    ok(tracks === null, `${layout.id}: 해가 없어 null`);
    continue;
  }
  if (!tracks) {
    ok(layout.flexible === true, `${layout.id}: 자유 배치는 칸 안에서 16:9 유지`);
    continue;
  }
  // 푼 트랙대로 놓았을 때 각 칸이 실제로 16:9 인지 직접 계산해 확인한다.
  const widths = tracks.columns.split(/\s+/).map((v) => parseFloat(v));
  const rowCount = tracks.rows.split(/\s+/).length;
  const { spans } = L.slotSpans(layout);
  let allSquare = true;
  for (const span of Object.values(spans)) {
    let w = 0;
    for (let c = span.c0; c <= span.c1; c += 1) w += widths[c];
    const h = span.r1 - span.r0 + 1;
    if (Math.abs(w / h - 16 / 9) > 1e-6) allSquare = false;
  }
  ok(
    allSquare,
    `${layout.id}: 모든 칸이 16:9 (전체 ${tracks.ratio.toFixed(3)})`,
  );
  ok(rowCount === layout.areas.length, `${layout.id}: 행 수가 areas 와 맞는다`);
}

console.log("[채팅 위 영상 높이] 저장·복원");
{
  const watch = require("node:fs").readFileSync(
    path.join(__dirname, "..", "src", "multiviewWatch.js"), "utf8");
  const slice = (from, to) => watch.slice(watch.indexOf(from), watch.indexOf(to, watch.indexOf(from)));
  const apply = slice("function applyChatTopSize(", "function restoreChatSize(");
  const restore = slice("function restoreChatSize(", "function bindChatResize(") +
    slice("function applyRestoredChatSize(", "function applyChatSize(");
  const bind = slice("function bindChatTopResize(", "// ── 빠른 채널 관리");
  ok(/chatSizeState\.topH = size;\s*persistChatSize\(\);/.test(apply), "손으로 정한 높이를 저장한다");
  ok(/if \(size\.topH\) setChatTopSize\(size\.topH\);/.test(restore) &&
    !/applyChatTopSize\(/.test(restore),
    "복원은 지금 화면 높이로 잘라 다시 저장하지 않는다(상한은 CSS 가 지킨다)");
  ok(/addEventListener\("dblclick"/.test(bind) && /delete chatSizeState\.topH;\s*persistChatSize\(true\);/.test(bind) &&
    /removeProperty\("--mv-chat-top-h"\)/.test(bind),
    "더블클릭하면 저장값을 지우고 자동(16:9) 높이로 돌아간다");
  const grid = L.chatTopStageGrid(L.layoutById("main-chat-top"), "right");
  ok(/var\(--mv-chat-top-h, calc\(min\(var\(--mv-chat-w, 370px\), 60vw\) \* 9 \/ 16\)\)/.test(grid.rows) &&
    /calc\(100% - 160px\)/.test(grid.rows),
    "자동 높이는 채팅 폭의 16:9, 아래 영역에 160px 를 남긴다");
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
