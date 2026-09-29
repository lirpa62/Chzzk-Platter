const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const bridge = require("../src/multiviewAchievementBridge.js");
require("../src/achievementBadgeMap.js");
const badgeChat = require("../src/multiviewBadgeChat.js");
const manifest = JSON.parse(read("manifest.json"));
const badgeSource = read("src/multiviewBadgeChat.js");
const bridgeSource = read("src/multiviewAchievementBridge.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// ── 메시지 데이터에서 배지 ID(배지 모아 챗과 같은 규칙) ──────────────────
const profile = { streamingProperty: { activatedAchievementBadgeIds: ["2025chzzkcup_1", "fco_teammaster"] } };
check(bridge.achievementBadgeId({ profile }) === "2025chzzkcup_1",
  "활성 업적 배지 중 첫 번째 하나를 쓴다");
check(bridge.achievementBadgeId({ profile: JSON.stringify(profile) }) === "2025chzzkcup_1",
  "profile 이 JSON 문자열이어도 읽는다");
check(bridge.achievementBadgeId({ profile: { streamingProperty: {} } }) === "" &&
  bridge.achievementBadgeId({ profile: "{깨진" }) === "" &&
  bridge.achievementBadgeId(null) === "",
  "배지가 없거나 데이터가 깨지면 비운다");
check(bridge.achievementBadgeId({ profile: { streamingProperty: {
  activatedAchievementBadgeIds: ['"><img src=x>'] } } }) === "",
  "이상한 ID 는 속성으로 남기지 않는다");

// React props / fiber 양쪽에서 메시지를 찾는다(자식 방향만).
const message = { profile };
check(bridge.chatMessageOf({ "__reactProps$x": { children: { props: { chatMessage: message } } } }) === message,
  "줄 props 에서 메시지를 찾는다");
check(bridge.chatMessageOf({ "__reactFiber$x": { memoizedProps: {}, child: { memoizedProps: { chatMessage: message } } } }) === message,
  "props 가 없으면 자식 fiber 에서 찾는다");
check(bridge.chatMessageOf({ "__reactFiber$x": { memoizedProps: {}, return: { memoizedProps: { chatMessage: message } } } }) === null,
  "부모 방향(이웃 줄)으로는 올라가지 않는다");

// 줄에 속성을 남기고 지운다.
const attrs = new Map();
const row = {
  "__reactProps$x": { children: { props: { chatMessage: message } } },
  getAttribute: (name) => attrs.get(name) ?? null,
  setAttribute: (name, value) => attrs.set(name, value),
  hasAttribute: (name) => attrs.has(name),
  removeAttribute: (name) => attrs.delete(name),
};
bridge.stampRow(row);
check(attrs.get(bridge.ATTR) === "2025chzzkcup_1", "채팅 줄에 업적 배지 ID 를 남긴다");
row["__reactProps$x"] = { children: { props: { chatMessage: { profile: {} } } } };
bridge.stampRow(row);
check(!attrs.has(bridge.ATTR), "배지가 없는 메시지로 바뀌면 속성을 지운다");

// ── ID → 매핑 표 이미지 ─────────────────────────────────────────────────
const mapped = badgeChat.achievementBadgeFromId("2025chzzkcup_1");
check(mapped?.src === globalThis.CheeseAchievementBadgeMap["2025chzzkcup_1"] &&
  mapped.position === "after" && mapped.alt === "",
  "ID 로 매핑 표의 이미지를 닉네임 뒤 배지로 만든다");
check(badgeChat.achievementBadgeFromId("CHISTIVAL_OVERCOOKED")?.src ===
  globalThis.CheeseAchievementBadgeMap.chistival_overcooked, "대소문자가 달라도 찾는다(원본과 같다)");
check(badgeChat.achievementBadgeFromId("unknown_badge") === null &&
  badgeChat.achievementBadgeFromId("") === null, "매핑 표에 없는 ID 는 무시한다");

// ── 연결 ────────────────────────────────────────────────────────────────
check(/const achievementId =\s*row\.getAttribute\?\.\(ACHIEVEMENT_ID_ATTR\)/.test(badgeSource) &&
  /const achievement = achievementBadgeFromId\(achievementId\) \|\| achievementBadges\[0\] \|\| null;/.test(badgeSource),
  "하이라이터가 줄의 배지 ID 로 닉네임 뒤 배지를 채운다");
check(/"data-cheese-history-id",\s*\/\/[^\n]*\n\s*ACHIEVEMENT_ID_ATTR,/.test(badgeSource),
  "배지 ID 가 캡처 뒤에 붙어도 다시 읽는다(속성 감시)");
check(/'\[class\*="live_chatting_list_item"\], \[class\*="vod_chatting_item"\], \[class\*="_item_"\]'/.test(bridgeSource) &&
  /const rowSelector =\s*'\[class\*="live_chatting_list_item"\], \[class\*="vod_chatting_item"\], \[class\*="_item_"\]'/.test(badgeSource),
  "다리와 하이라이터가 같은 기준으로 줄을 정한다");
const entry = manifest.content_scripts.find((item) => item.js?.includes("src/multiviewAchievementBridge.js"));
check(entry?.world === "MAIN" && entry.all_frames === true &&
  entry.matches.includes("https://chzzk.naver.com/live/*"),
  "React 데이터를 읽도록 MAIN world, 채팅 칸 iframe 에서 돈다");
check(/win === win\.top/.test(bridgeSource) &&
  /params\.get\("cheeseMultiChat"\) !== "1"/.test(bridgeSource) &&
  /\\\/chat\\\/\?\$\/i\.test\(win\.location\.pathname\)/.test(bridgeSource),
  "멀티뷰 채팅 칸(/live/<id>/chat?cheeseMultiChat=1)에서만 감시한다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
