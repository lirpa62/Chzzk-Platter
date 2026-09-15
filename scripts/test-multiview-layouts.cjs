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
}

console.log("\n[채팅 자리] 보조 화면 반대편에 둔다");
for (const layout of L.LAYOUTS) {
  ok(
    Array.isArray(layout.chat) && layout.chat.length > 0,
    `${layout.id}: 채팅 자리 ${layout.chat.join("/")}`,
  );
  // 보조가 오른쪽이면 채팅은 오른쪽이 아니어야 한다(그 반대도).
  if (layout.id.startsWith("right")) {
    ok(!layout.chat.includes("right"), `${layout.id}: 채팅이 오른쪽이 아니다`);
  }
  if (layout.id.startsWith("left")) {
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
// 채팅 자리는 배치와 무관하게 셋 다 고를 수 있다(어디에 둘지는 취향이다).
for (const layout of L.LAYOUTS) {
  for (const side of L.CHAT_SIDES) {
    ok(
      L.stageStyle(layout, side).side === side,
      `${layout.id}: 채팅 ${side} 를 그대로 쓴다`,
    );
  }
}
ok(
  L.CHAT_SIDES.includes(L.stageStyle(right, "top").side),
  "제공하지 않는 자리는 기본값으로 되돌린다",
);

console.log("\n[layoutById] 없는 id 는 null");
ok(L.layoutById("없는배치") === null, "모르는 id 는 null 을 돌려준다");
ok(L.layoutById(right.id) === right, "id 로 같은 배치를 찾는다");

console.log("\n[solveTracks] 모든 칸이 16:9 가 되는 트랙을 푼다");
// 레터박스를 없애려면 칸 자체가 16:9 여야 한다. 해가 있는 배치는 트랙을 돌려주고,
// 해가 없는 배치(전체 폭 띠 + 16:9 메인)는 null 을 돌려줘야 한다.
const NO_SOLUTION = new Set([
  "right-bottom",
  "left-bottom",
  "right-top",
  "left-top",
]);
for (const layout of L.LAYOUTS) {
  const tracks = L.solveTracks(layout);
  if (NO_SOLUTION.has(layout.id)) {
    ok(tracks === null, `${layout.id}: 해가 없어 null`);
    continue;
  }
  if (!tracks) {
    ok(false, `${layout.id}: 트랙을 풀지 못했다`);
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

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
