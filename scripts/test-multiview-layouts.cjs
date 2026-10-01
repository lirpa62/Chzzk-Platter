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
  const used = new Set(areas.match(/[a-e]|m/g) || []);
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

console.log("\n[채널 수] 2~6개 모두 배치가 있다");
for (let n = 2; n <= 6; n += 1) {
  const list = L.layoutsFor(n);
  ok(list.length > 0, `${n}개: ${list.map((x) => x.label).join(", ")}`);
}
ok(L.layoutsFor(7).length === 0, "7개는 지원하지 않는다(보조 최대 5개)");
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
  [3, ["top-2-single-0", "top-2-single-1", "top-2-single-2", "bottom-2-single-0", "bottom-2-single-1", "bottom-2-single-2"]],
  [4, ["top-2-chat-top", "bottom-2-chat-top"]],
  [5, ["grid-2x3-5", "top-4", "bottom-4", "grid-2x2-chat-top", "right-3-chat-top", "left-3-chat-top", "top-3-chat-top", "bottom-3-chat-top"]],
  [6, ["grid-2x3-6", "top-5", "bottom-5", "right-4-chat-top", "left-4-chat-top", "top-4-chat-top", "bottom-4-chat-top"]],
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
  "right-2-chat-top", "left-2-chat-top", "left-2-bottom-1-1"]) {
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
    "bottom-2-single-0": "right", "bottom-2-single-2": "left",
    "right-2-bottom-1-0": "right", "right-2-bottom-1-2": "left",
    "left-2-bottom-1-0": "right", "left-2-bottom-1-2": "left",
  };
  // 빈 칸이 한 칸뿐이라 바깥이 기본이고 '빈 칸' 은 골라야 쓰는 배치.
  const outsideDefault = ["grid-3x2-5", "grid-2x3-5", "right2-bottom2", "left2-bottom2"];
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
  ok(/const inset = LAYOUTS\.usesChatInset\(layout, side\);\s*const tracks = inset \? null : LAYOUTS\.solveTracks\(layout\);/.test(watch),
    "시청 화면: '빈 칸' 이면 격자 안 채팅으로 그리고 16:9 트랙을 끈다");
  ok(/if \(!LAYOUTS\.chatSidesFor\(layout\)\.includes\(side\)\) return;/.test(watch) &&
    /const sides = LAYOUTS\.chatSidesFor\(layout\);\s*\$\("mvSidePanel"\)/.test(watch) &&
    /\[LAYOUTS\.CHAT_INSET_SIDE\]: "빈 칸"/.test(watch),
    "시청 화면: 채팅 위치 패널에 '빈 칸' 이 나오고 같은 규칙으로 검증한다");
  ok((watch.match(/LAYOUTS\.chatSideForSwitch\(/g) || []).length === 2 &&
    (setup.match(/LAYOUTS\.chatSideForSwitch\(/g) || []).length === 2,
    "배치를 바꾸는 모든 곳(직접 고르기·채널 수 변경)이 같은 규칙을 쓴다");
  ok((watch.match(/LAYOUTS\.previewGrid\(l\)/g) || []).length === 1 &&
    (setup.match(/LAYOUTS\.previewGrid\(l\)/g) || []).length === 1,
    "고르기 화면과 시청 화면 미리보기가 같은 계산을 쓴다");
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
  const restore = slice("function restoreChatSize(", "function bindChatResize(");
  const bind = slice("function bindChatTopResize(", "// ── 빠른 채널 관리");
  ok(/saved\.topH = size;/.test(apply), "손으로 정한 높이를 저장한다");
  ok(/setChatTopSize\(Math\.round\(Number\(saved\.topH\)\)\)/.test(restore) &&
    !/applyChatTopSize\(/.test(restore),
    "복원은 지금 화면 높이로 잘라 다시 저장하지 않는다(상한은 CSS 가 지킨다)");
  ok(/addEventListener\("dblclick"/.test(bind) && /delete saved\.topH;/.test(bind) &&
    /removeProperty\("--mv-chat-top-h"\)/.test(bind),
    "더블클릭하면 저장값을 지우고 자동(16:9) 높이로 돌아간다");
  const grid = L.chatTopStageGrid(L.layoutById("main-chat-top"), "right");
  ok(/var\(--mv-chat-top-h, calc\(min\(var\(--mv-chat-w, 370px\), 60vw\) \* 9 \/ 16\)\)/.test(grid.rows) &&
    /calc\(100% - 160px\)/.test(grid.rows),
    "자동 높이는 채팅 폭의 16:9, 아래 영역에 160px 를 남긴다");
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
