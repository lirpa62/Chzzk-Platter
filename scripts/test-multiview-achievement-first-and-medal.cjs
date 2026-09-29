const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
require("../src/achievementBadgeMap.js");
require("../src/multiviewVodChat.js");
const badgeChat = require("../src/multiviewBadgeChat.js");
const MAP = globalThis.CheeseAchievementBadgeMap;
const vod = globalThis.CheeseMultiviewVodChat;
const css = read("src/multiview.css");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// ── 다시보기 채팅(채팅창·모아보기 공용): 첫 번째 업적 배지만 ─────────────
const message = (ids, where = "streamingProperty") => vod.normalizeMessage({
  userIdHash: "u1", content: "안녕", messageTime: 1790498905221, playerMessageTime: 184221,
  messageTypeCode: 1,
  profile: JSON.stringify(where === "streamingProperty"
    ? { nickname: "테스트", streamingProperty: { activatedAchievementBadgeIds: ids } }
    : { nickname: "테스트", activatedAchievementBadgeIds: ids }),
}, {});
const achievementUrls = (msg) => msg.badges.filter((badge) => badge.label === "업적 배지").map((b) => b.url);
let msg = message(["2025chzzkcup_2", "2025chzzkcup_1", "fco_teammaster"]);
check(achievementUrls(msg).length === 1 && achievementUrls(msg)[0] === MAP["2025chzzkcup_2"],
  "다시보기: 활성화된 업적 배지가 여럿이어도 첫 번째 하나만 붙인다");
msg = message(["unknown_badge", "2025chzzkcup_1"]);
check(achievementUrls(msg).length === 0,
  "다시보기: 첫 번째가 매핑 표에 없으면 다음 것으로 넘어가지 않는다(원본과 같다)");
msg = message(["2025chzzkcup_3"], "profile");
check(achievementUrls(msg)[0] === MAP["2025chzzkcup_3"], "다시보기: streamingProperty 가 없으면 profile 의 첫 번째를 쓴다");

// ── 라이브 모아보기: 합쳐진 배지에서도 업적 배지는 하나만 그린다 ──────────
const split = badgeChat.splitDisplayBadges({
  roles: ["manager"],
  badges: [
    { src: MAP["2025chzzkcup_1"], alt: "", position: "after" },
    { src: MAP["fco_teammaster"], alt: "", position: "after" },
    { src: "https://ssl.pstatic.net/static/nng/glive/badge/cheatkey_24m.png", alt: "", position: "after" },
  ],
});
check(split.after.filter((b) => Object.values(MAP).includes(b.src)).length === 1 &&
  split.after[0].src === MAP["2025chzzkcup_1"] &&
  split.after.some((b) => /cheatkey_24m/.test(b.src)),
  "라이브 모아보기: 업적 배지는 첫 번째 하나만, 다른 활동 배지는 그대로");
const source = read("src/multiviewBadgeChat.js");
check(/const achievement = achievementBadgeFromId\(achievementId\) \|\| achievementBadges\[0\] \|\| null;/.test(source) &&
  /badges\.splice\(index, 1\); \/\/ 두 번째 이후 업적 배지는 뺀다/.test(source),
  "라이브: 메시지 데이터의 첫 번째 배지 ID 를 우선하고 나머지 업적 배지는 뺀다");

// ── 구독 카드 메달(치지직과 같다) ──────────────────────────────────────
check(/\.mv-vod-chat-card\.is-subscription::before \{[^}]*silver_medal_image\.png[^}]*content: "";[^}]*height: 64px;[^}]*position: absolute;[^}]*right: 0;[^}]*top: -12px;[^}]*width: 96px;/s.test(css),
  "구독 카드: 1티어는 오른쪽 위에 은메달(96×64, 위로 12px)");
check(/\.mv-vod-chat-card\.is-subscription\.is-tier-2::before \{\s*background-image: url\("https:\/\/ssl\.pstatic\.net\/static\/nng\/glive\/chatting\/gold_medal_image\.png"\);/.test(css),
  "구독 카드: 2티어는 금메달");
check(/\.mv-vod-chat-card\.is-subscription \{\s*position: relative;/.test(css),
  "메달이 카드 기준으로 자리 잡는다");
const watch = read("src/multiviewWatch.js");
check(/const tierClass = info\.tier === 1 \|\| info\.tier === 2 \? ` is-tier-\$\{info\.tier\}` : "";\s*return `<div class="mv-vod-chat-card is-subscription\$\{tierClass\}">/.test(watch),
  "구독 카드는 티어(tierNo)를 is-tier-1/2 로 표시한다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
