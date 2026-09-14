#!/usr/bin/env node
"use strict";
// 전용 팔로잉 목록의 호버 툴팁이 숨겨진 뒤에도 클릭 영역을 남기지 않는지 확인한다.
// 남으면 그 자리를 누를 때 직전에 호버했던 채널 방송으로 이동한다.
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.css"),
  "utf8",
);

let fails = 0;
const ok = (cond, message) => {
  console.log((cond ? "  PASS " : "  FAIL ") + message);
  if (!cond) fails++;
};

const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, " "),
  body: m[2],
}));

console.log("[컨테이너] 숨은 상태에서는 클릭을 받지 않는다");
const container = rules.find(
  (r) => r.selector === ".cheese-follow-channel-tooltip",
);
ok(Boolean(container), "기본 규칙을 찾았다");
ok(
  /pointer-events:\s*none/.test(container?.body || ""),
  "컨테이너는 pointer-events: none 이다",
);
ok(/opacity:\s*0/.test(container?.body || ""), "기본 opacity 는 0 이다");

console.log("[내부] 보이는 동안에만 클릭을 받는다");
const inner = rules.filter((r) =>
  /#cheese-follow-channel-tooltip[^,]*\.cheese-header-follow-tooltip\b/.test(
    r.selector,
  ),
);
const withAuto = inner.filter((r) => /pointer-events:\s*auto/.test(r.body));
ok(withAuto.length > 0, "내부에 pointer-events: auto 규칙이 있다");
ok(
  withAuto.every((r) => r.selector.includes(".is-visible")),
  "그 규칙은 모두 .is-visible 아래에만 있다 " +
    `(${withAuto.map((r) => r.selector).join(" / ")})`,
);
ok(
  !inner.some(
    (r) =>
      !r.selector.includes(".is-visible") &&
      /pointer-events:\s*auto\s*!important/.test(r.body),
  ),
  "표시 상태와 무관한 !important 로 클릭을 되살리지 않는다",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
