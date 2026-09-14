#!/usr/bin/env node
"use strict";
// 채팅 리캡 페이지가 프로필 원본 대신 리사이즈 썸네일을 쓰는지 확인한다.
// 원본은 수백 KB라 채널이 많으면 눈에 띄게 늦게 뜬다.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "chatRecap.js"),
  "utf8",
);

let fails = 0;
const ok = (cond, message) => {
  console.log((cond ? "  PASS " : "  FAIL ") + message);
  if (!cond) fails++;
};

console.log("[헬퍼] 리사이즈 파라미터를 붙인다");
const start = src.indexOf("  function profileThumb(imageUrl) {");
ok(start > -1, "profileThumb 헬퍼가 있다");
const fn = new Function(
  `${src.slice(start, src.indexOf("\n  }\n", start) + 4)}\n return profileThumb;`,
)();
ok(
  fn("https://x/p.png") === "https://x/p.png?type=f120_120_na",
  "쿼리가 없으면 ? 로 붙인다",
);
ok(
  fn("https://x/p.png?a=1") === "https://x/p.png?a=1&type=f120_120_na",
  "쿼리가 있으면 & 로 붙인다",
);
ok(
  fn("https://x/p.png?type=f240_240_na") === "https://x/p.png?type=f240_240_na",
  "이미 크기가 지정된 URL 은 건드리지 않는다",
);
ok(fn("") === "" && fn(null) === "", "빈 값은 빈 문자열");
ok(
  fn("https://x/p.png") === "https://x/p.png?type=f120_120_na",
  "사이드바·모달과 같은 크기를 써 캐시를 재사용한다",
);

console.log("[적용] 프로필을 넣는 곳마다 헬퍼를 쓴다");
// 프로필 이미지를 지정하는 자리에서 원본 URL 을 그대로 쓰지 않는지 본다.
const rawAssign = [
  /\bimg\.src = info\.imageUrl\b/,
  /\bavatar\.src = info\.imageUrl\b/,
  /\bavatar\.src = cached\.imageUrl\b/,
  /\bimg0\.src = c\.imageUrl\b/,
  /handle\.src = channel\.imageUrl\b/,
];
for (const pattern of rawAssign) {
  ok(!pattern.test(src), `원본을 그대로 쓰지 않는다: ${pattern.source}`);
}
const uses = (src.match(/profileThumb\(/g) || []).length;
ok(uses >= 9, `헬퍼를 여러 곳에서 쓴다 (정의 1 + 호출 ${uses - 1})`);

console.log("[그래프] 관계도 노드도 썸네일을 쓴다");
ok(
  /profileThumb\(info\.imageUrl\) \|\|/.test(src) &&
    /profileThumb\(model\.profileInfo\.get\(node\.id\)\?\.imageUrl\)/.test(src),
  "채널 관계도 노드 이미지에도 적용한다",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
