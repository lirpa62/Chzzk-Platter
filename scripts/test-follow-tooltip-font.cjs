#!/usr/bin/env node
"use strict";
// 라이브 툴팁의 이름·카테고리 폰트를 치지직 요소에서 harvest 하는지 확인한다.
// 클래스 해시는 배포마다 바뀌므로 역할 부분만 부분 일치로 찾아야 한다.
const fs = require("node:fs");
const path = require("node:path");
const js = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.css"),
  "utf8",
);

let fails = 0;
const ok = (cond, message) => {
  console.log((cond ? "  PASS " : "  FAIL ") + message);
  if (!cond) fails++;
};

console.log("[harvest] 해시에 흔들리지 않는 선택자를 쓴다");
const start = js.indexOf("  function harvestFollowTooltipFonts() {");
ok(start > -1, "harvestFollowTooltipFonts 가 있다");
const fn = js.slice(start, js.indexOf("\n  }\n", start) + 4);
ok(
  /\[class\*='_container_'\]\[class\*='_font_bold_'\]/.test(fn),
  "_container_ + _font_bold_ 를 부분 일치로 찾는다",
);
ok(
  !/_container_vgt54|_font_bold_vgt54/.test(fn),
  "해시가 박힌 클래스명을 직접 쓰지 않는다",
);
ok(
  /getComputedStyle\(fontSource\)\.fontFamily/.test(fn),
  "선언 대신 computed font-family 를 그대로 읽는다",
);
ok(/주제 탭/.test(fn), "출처가 없는 화면을 위해 예전 경로를 폴백으로 남긴다");
for (const v of ["--cheese-fct-name-font", "--cheese-fct-cat-font"]) {
  ok(fn.includes(v), `${v} 를 설정한다`);
  ok(new RegExp(`font-family: var\\(${v}`).test(css), `${v} 를 CSS 에서 쓴다`);
}

console.log("[제목] 말줄임으로 자르지 않는다");
const titleRule = css.slice(
  css.indexOf(
    "#cheese-follow-channel-tooltip .cheese-header-follow-tooltip-title {",
  ),
);
const block = titleRule.slice(0, titleRule.indexOf("}"));
ok(
  !/text-overflow:\s*ellipsis/.test(block),
  "방송 제목에 text-overflow: ellipsis 를 두지 않는다",
);
ok(/-webkit-line-clamp:\s*2/.test(block), "두 줄까지 보여 준다");

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
