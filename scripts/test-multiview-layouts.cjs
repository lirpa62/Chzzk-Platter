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
ok(
  L.stageStyle(right, "right").side === "left",
  "허용하지 않는 자리를 주면 기본값으로 되돌린다",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
