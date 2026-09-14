#!/usr/bin/env node
"use strict";
// 결제 내역(API) 기준 후원·구독 시각 보정 검증.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);
const i = src.indexOf("  // 결제 내역(purchaseDate)은 초가 00 으로");
const j = src.indexOf("  function createRecapHistoryMatcher(items)");
const k =
  src.indexOf("\n  }\n", src.indexOf("return candidates[best.index];")) + 4;
const block = src.slice(i, j) + src.slice(j, k);

const sandbox = {
  normalizeRecapMatchText: (v) =>
    String(v || "")
      .replace(/\s+/g, " ")
      .trim(),
};
const fn = new Function(
  ...Object.keys(sandbox),
  `${block}\n return { recapHistoryMatchScore, createRecapHistoryMatcher };`,
);
const API = fn(...Object.values(sandbox));

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "  PASS " : "  FAIL ") + m);
  if (!c) fails++;
};
const H = (t, m, d) => ({ t, m, d: { ...d, src: "history" } });
const DON = { kind: "DONATION", type: "CHAT", amount: 1000 };

console.log("[후원] purchaseDate 초 절삭(37초 차)");
let mt = API.createRecapHistoryMatcher([
  H(1_000_000_000_000, "감사합니다", DON),
]);
ok(
  !!mt.match(1_000_000_037_000, "감사합니다", { ...DON, src: "chat" }),
  "37초 차이여도 금액·본문이 같으면 결제 내역과 연결된다",
);

console.log("[후원] 금액이 다르면 연결하지 않는다");
mt = API.createRecapHistoryMatcher([H(1_000_000_000_000, "감사합니다", DON)]);
ok(
  !mt.match(1_000_000_037_000, "감사합니다", {
    ...DON,
    amount: 5000,
    src: "chat",
  }),
  "금액 불일치는 거른다",
);

console.log("[후원] 본문이 다르면 연결하지 않는다");
mt = API.createRecapHistoryMatcher([H(1_000_000_000_000, "감사합니다", DON)]);
ok(
  !mt.match(1_000_000_037_000, "수고하세요", { ...DON, src: "chat" }),
  "본문 불일치는 거른다",
);

console.log("[후원] 2분 차는 거른다(창 밖)");
mt = API.createRecapHistoryMatcher([H(1_000_000_000_000, "감사합니다", DON)]);
ok(
  !mt.match(1_000_000_120_000, "감사합니다", { ...DON, src: "chat" }),
  "90초를 넘으면 연결하지 않는다",
);

console.log("[후원] 같은 금액·본문 2건이 비슷한 거리면 확정하지 않는다");
mt = API.createRecapHistoryMatcher([
  H(1_000_000_000_000, "감사합니다", DON),
  H(1_000_000_000_500, "감사합니다", DON),
]);
ok(
  !mt.match(1_000_000_000_250, "감사합니다", { ...DON, src: "chat" }),
  "동점 후보가 가까우면 버린다(오연결 방지)",
);

console.log("[후원] 한 내역은 한 번만 소비된다");
mt = API.createRecapHistoryMatcher([H(1_000_000_000_000, "감사합니다", DON)]);
const first = mt.match(1_000_000_001_000, "감사합니다", {
  ...DON,
  src: "chat",
});
const second = mt.match(1_000_000_002_000, "감사합니다", {
  ...DON,
  src: "chat",
});
ok(!!first && !second, "두 번째 채팅은 같은 내역을 다시 쓰지 않는다");

console.log("[구독] 티어가 맞으면 분 단위 허용");
const SUB = { kind: "SUBSCRIPTION", tier: 1, month: 3 };
mt = API.createRecapHistoryMatcher([H(1_000_000_000_000, "", SUB)]);
ok(
  !!mt.match(1_000_000_040_000, "", { ...SUB, src: "chat" }),
  "티어·개월이 맞으면 40초 차도 연결",
);

console.log("[구독] 티어·개월 정보가 없으면 750ms 로 좁게");
mt = API.createRecapHistoryMatcher([
  H(1_000_000_000_000, "", { kind: "SUBSCRIPTION" }),
]);
ok(
  !mt.match(1_000_000_040_000, "", { kind: "SUBSCRIPTION", src: "chat" }),
  "확인할 정보가 없으면 넓히지 않는다",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
