// 라이브 탐색 카드 호버 미리보기의 위치.
//
// 브라우저 창을 화면 절반(Win+←)으로 쓰면 카드가 한 줄에 3장이라 가운데 카드는 양옆에
// 카드 한 장 폭밖에 없다. 좌우에만 두면 그 폭으로 줄어 아주 작았다. '자동'은 좌우에 저장
// 크기가 안 들어가면 위·아래 중 크게 보이는 쪽을 쓰고, '위 우선'·'아래 우선'을 새로 둔다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const content = read("src/content.js");
const settings = read("src/settings.js");
const html = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const ctx = { FOLLOW_PREVIEW_MIN_W: 200 };
vm.runInNewContext(`${sliceFn("chooseCardPreviewPlacement")}\nthis.choose = chooseCardPreviewPlacement;`, vm.createContext(ctx));
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const base = { vw: 960, vh: 1000, desiredWidth: 480, extraHeight: 44, sidebarRight: false };

// 화면 절반 창, 한 줄 3장(카드 300px). 가운데 카드.
const middle = rect(330, 300, 300, 200);
const auto = ctx.choose({ ...base, rect: middle, position: "auto" });
check(auto.side === "below" && auto.width === 480,
  `자동: 가운데 카드는 좌우가 좁아(312px) 아래에 저장 크기 그대로 ${JSON.stringify(auto)}`);
const nearBottom = ctx.choose({ ...base, rect: rect(330, 650, 300, 200), position: "auto" });
check(nearBottom.side === "above" && nearBottom.width === 480, `자동: 아래가 좁으면 위 ${JSON.stringify(nearBottom)}`);
const edgeCard = ctx.choose({ ...base, rect: rect(20, 300, 300, 200), position: "auto" });
check(edgeCard.side === "right" && edgeCard.width === 480, `자동: 좌우에 들어가면 예전처럼 좌우 ${JSON.stringify(edgeCard)}`);
const sidebarRight = ctx.choose({ ...base, rect: rect(640, 300, 300, 200), position: "auto", sidebarRight: true });
check(sidebarRight.side === "left", "자동: 사이드바가 오른쪽이면 왼쪽을 먼저 본다(예전과 같다)");
const cramped = ctx.choose({ ...base, vh: 500, rect: rect(330, 150, 300, 200), position: "auto" });
check(cramped.side === "right" && cramped.width === 312,
  `자동: 어디에도 안 들어가면 가장 크게 보이는 쪽(좌우 312 > 위·아래) ${JSON.stringify(cramped)}`);

const top = ctx.choose({ ...base, rect: rect(330, 600, 300, 200), position: "top" });
check(top.side === "above" && top.width === 480, `위 우선 ${JSON.stringify(top)}`);
const topNotFull = ctx.choose({ ...base, rect: middle, position: "top" });
check(topNotFull.side === "below" && topNotFull.width === 480,
  `위 우선: 위에 저장 크기가 안 들어가면(423px) 아래에 그대로 ${JSON.stringify(topNotFull)}`);
const topFallback = ctx.choose({ ...base, rect: rect(330, 60, 300, 200), position: "top" });
check(topFallback.side === "below", "위 우선: 위가 좁으면 아래");
const bottom = ctx.choose({ ...base, rect: middle, position: "bottom" });
check(bottom.side === "below", "아래 우선");
const wide = ctx.choose({ ...base, vw: 1920, vh: 400, rect: rect(330, 100, 300, 200), position: "top" });
check(wide.side === "right" && wide.width === 480, `위 우선: 위·아래 모두 안 되면 좌우 ${JSON.stringify(wide)}`);
const tiny = ctx.choose({ ...base, vw: 400, vh: 300, rect: rect(50, 50, 300, 200), position: "auto" });
check(tiny.width === 200, "아무리 좁아도 최소 크기(200px)는 지킨다");

check(/if \(anchorKind === "card" && !\["left", "right"\]\.includes\(cardLivePreviewPosition\)\) \{\s*const placement = chooseCardPreviewPlacement\(/.test(content) &&
  /\/\/ 여기는 '왼쪽 우선'·'오른쪽 우선'만 온다\(좌우 안에서만 고른다\)\.\s*const preferredLeft = cardLivePreviewPosition === "left";/.test(content),
  "왼쪽·오른쪽 우선은 예전처럼 좌우 안에서만 고른다");
check(/left = r\.left \+ r\.width \/ 2 - w \/ 2;\s*top = placement\.side === "below" \? r\.bottom \+ GAP : r\.top - GAP - totalH;/.test(content),
  "위·아래는 카드 가운데에 맞춰 카드 바로 위·아래에 둔다");
check(["auto", "left", "right", "top", "bottom"].every((v) => html.includes(`data-card-live-preview-position="${v}"`)) &&
  /\["left", "right", "top", "bottom"\]\.includes\(value\) \? value : "auto"/.test(settings) &&
  /\["left", "right", "top", "bottom"\]\.includes\(value\) \? value : "auto"/.test(content),
  "설정: 자동 / 왼쪽 우선 / 오른쪽 우선 / 위 우선 / 아래 우선");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
