// 멀티뷰 채널 관리: 라이브 썸네일은 같은 주소에서 내용만 바뀌어 브라우저 캐시의 옛 화면이 보였다.
// 패널을 열 때 주소에 시각 표시를 붙여 새로 받고, 30초 안에 다시 열면 같은 주소(캐시)를 쓴다.
// 열어 둔 동안의 자동 갱신에서는 바꾸지 않는다(깜빡임). 다시보기 썸네일은 그대로.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/multiviewWatch.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(start >= 0 && end > start, `${name} 를 찾지 못했다`);
  return source.slice(start, end + 4);
};

let now = 1_800_000_000_000;
const ctx = { Date: { now: () => now }, URL, location: { href: "https://chzzk.naver.com/lives" } };
vm.runInNewContext(
  `const QUICK_THUMB_FRESH_MS = 30000;\nlet quickThumbToken = 0;\n` +
  [sliceFn("safeImageUrl"), sliceFn("refreshQuickThumbToken"), sliceFn("quickThumbUrl")].join("\n") +
  "\nglobalThis.api = { refreshQuickThumbToken, quickThumbUrl };",
  Object.assign(ctx, { globalThis: ctx }),
);
const { refreshQuickThumbToken: open, quickThumbUrl: url } = ctx.api;
const live = { liveImageUrl: "https://livecloud-thumb.akamaized.net/a/image_480.jpg" };
const video = { mediaType: "video", liveImageUrl: "https://video-phinf.pstatic.net/b.jpg" };

open();
const first = url(live);
check(/image_480\.jpg\?cheeseT=\d+$/.test(first), `열면 라이브 썸네일 주소에 시각 표시를 붙인다 ${first}`);
check(url(video) === video.liveImageUrl, "다시보기 썸네일은 그대로");
now += 20_000;
open();
check(url(live) === first, "30초 안에 다시 열면 같은 주소(브라우저 캐시를 쓴다)");
now += 15_000;
check(url(live) === first, "열어 둔 동안(자동 갱신)에는 주소를 바꾸지 않는다");
open();
check(url(live) !== first && /cheeseT=\d+$/.test(url(live)), "30초가 지나 다시 열면 새로 받는다");
const withQuery = { liveImageUrl: "https://example.invalid/c.jpg?x=1" };
check(/\?x=1&cheeseT=\d+$/.test(url(withQuery)), "원래 쿼리가 있으면 이어 붙인다");

check(/refreshQuickThumbToken\(\);[^\n]*\n\s*renderQuick\(\);/.test(source), "패널을 열 때(그리기 전에) 표시를 새로 정한다");
check(/const thumb = quickThumbUrl\(r\);/.test(source), "채널 관리 카드가 이 주소를 쓴다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
