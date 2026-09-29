const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const live = read("src/multiviewBadgeChat.js");
const watch = read("src/multiviewWatch.js");
const popup = read("src/multiviewChatPopup.js");
const css = read("src/multiview.css");
const settingsHtml = read("settings.html");
const settingsJs = read("src/settings.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// ── 순서: 과거 → 최신(위 → 아래) ────────────────────────────────────────
check(/roleMessages\.forEach\(\(message\) => \{/.test(live) &&
  /popoverList\.scrollTop = popoverList\.scrollHeight;/.test(live) &&
  /`\.cheese-mv-badge-chat-list \{ display:flex; flex:1 1 auto; flex-direction:column;/.test(live),
  "라이브: 쌓인 순서(과거→최신)로 그리고 맨 아래(최신)를 따라간다");
const vodRender = watch.slice(watch.indexOf("function renderVodBadgeChat("),
  watch.indexOf("function openVodBadgeChatPopover("));
check(/vodBadgeChatList\.innerHTML = vodBadgeChatPopupItems\s*\.map/.test(vodRender) &&
  !/vodBadgeChatPopupItems\.slice\(\)\.reverse\(\)/.test(vodRender),
  "다시보기: 최신을 먼저 뒤집어 넣지 않는다(과거→최신)");
check(/const nearBottom = vodBadgeChatList\.scrollHeight - vodBadgeChatList\.scrollTop -\s*vodBadgeChatList\.clientHeight < 32;/.test(vodRender) &&
  /if \(nearBottom\) vodBadgeChatList\.scrollTop = vodBadgeChatList\.scrollHeight;/.test(vodRender),
  "다시보기: 맨 아래를 보던 중에만 새 채팅을 따라가고, 과거를 보는 중이면 위치를 둔다");
check(/if \(vodBadgeChatList\) vodBadgeChatList\.scrollTop = vodBadgeChatList\.scrollHeight;/.test(watch),
  "다시보기: 새로 열면 최신(맨 아래)에서 시작한다");
check(/\.filter\(\(item\) => \{[\s\S]*?\}\)\.reverse\(\);/.test(popup) &&
  /badgeList\.innerHTML = badgeItems\.slice\(\)\.reverse\(\)/.test(popup) &&
  /if \(nearBottom\) badgeList\.scrollTop = badgeList\.scrollHeight;/.test(popup) &&
  /badgeList\.scrollTop = badgeList\.scrollHeight;/.test(popup) &&
  !/badgeList\.scrollTop = 0;/.test(popup),
  "분리 채팅 팝업: 과거→최신으로 그리고 맨 위가 아니라 최신(맨 아래)으로 스크롤한다");
check(/\.mv-badge-chat-list \{[^}]*flex-direction: column;/.test(css) && !/column-reverse/.test(css),
  "목록은 위→아래 방향이다");

// ── 라이브: 한 번에 읽은 줄을 오래된 순으로 ─────────────────────────────
{
  const badgeChat = require("../src/multiviewBadgeChat.js");
  const names = (rows) => rows.map((row) => row.name).join(",");
  // 치지직 실측 구조: DOM 은 최신 → 과거, 화면은 뒤집혀 과거가 위.
  const visual = [
    { name: "new", getBoundingClientRect: () => ({ top: 300, width: 10, height: 20 }) },
    { name: "mid", getBoundingClientRect: () => ({ top: 200, width: 10, height: 20 }) },
    { name: "old", getBoundingClientRect: () => ({ top: 100, width: 10, height: 20 }) },
  ];
  check(names(badgeChat.orderRowsOldestFirst(new Set(visual))) === "old,mid,new",
    "라이브: DOM 이 최신→과거여도 화면 위치로 오래된 순(위→아래)으로 넣는다");
  // 화면 위치를 잴 수 없으면 DOM 순서 + 목록 방향으로 판단.
  const parent = { reversed: true };
  const hidden = ["new", "mid", "old"].map((name, index) => ({
    name, index, parentElement: parent,
    getBoundingClientRect: () => ({ top: 0, width: 0, height: 0 }),
    compareDocumentPosition(other) { return other.index > this.index ? 4 : 2; },
  }));
  const view = {
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    getComputedStyle: (element) => ({ flexDirection: element.reversed ? "column-reverse" : "column" }),
  };
  check(names(badgeChat.orderRowsOldestFirst([hidden[2], hidden[0], hidden[1]], view)) === "old,mid,new",
    "라이브: 위치를 못 재면 DOM 순서와 column-reverse 로 오래된 순을 정한다");
  parent.reversed = false;
  check(names(badgeChat.orderRowsOldestFirst([hidden[2], hidden[0], hidden[1]], view)) === "new,mid,old",
    "라이브: 보통 방향 목록이면 DOM 순서를 그대로 쓴다");
  check(/const rows = orderRowsOldestFirst\(pendingRows, win\);/.test(live),
    "라이브: 줄을 넣기 전에 오래된 순으로 정렬한다");
}

// ── 다시보기: 목록이 위에서부터 채워진다 ────────────────────────────────
check(/\.mv-badge-chat-list \.mv-vod-chat-row:first-child \{\s*margin-top: 0;\s*\}/.test(css) &&
  css.indexOf(".mv-badge-chat-list .mv-vod-chat-row:first-child") >
    css.indexOf(".mv-vod-chat-row:first-child {"),
  "다시보기: 채팅창의 아래 붙이기(margin-top:auto)가 모아보기에 따라 들어오지 않는다");

// ── 설정 화면: 분리 채팅 방식과 같은 배치 ───────────────────────────────
{
  const settingsCss = read("src/settings.css");
  check(/\.settings-item:has\(\[data-multiview-chat-popout-mode\]\),\s*\.settings-item:has\(\[data-multiview-badge-chat-display-style\]\),/.test(settingsCss) &&
    /\.settings-segmented\[data-multiview-chat-popout-mode\],\s*\.settings-segmented\[data-multiview-badge-chat-display-style\],/.test(settingsCss),
    "보기 방식 선택이 분리 채팅 방식과 같은 배치(세로 배치·전체 폭)를 쓴다");
}

// ── 한줄보기 / 블록보기 설정 ───────────────────────────────────────────
check(/data-multiview-badge-chat-display-style/.test(settingsHtml) &&
  /data-mv-badge-chat-display-value="inline"[\s\S]*?한줄보기/.test(settingsHtml) &&
  /data-mv-badge-chat-display-value="block"[\s\S]*?블록보기/.test(settingsHtml),
  "설정 - 멀티뷰 - 모아보기 팝업에 한줄보기·블록보기 선택이 있다");
const popupSection = settingsHtml.slice(settingsHtml.indexOf('aria-label="모아보기 팝업"'),
  settingsHtml.indexOf('aria-label="채팅창 표시"'));
check(popupSection.includes("data-multiview-badge-chat-display-style"), "모아보기 팝업 묶음 안에 둔다");
check(/"cheeseMultiviewBadgeChatDisplayStyle",/.test(settingsJs.slice(0, 20000)) &&
  /if \(key === "cheeseMultiviewBadgeChatDisplayStyle"\) \{\s*return value === "block" \|\| value === "inline" \? value : undefined;/.test(settingsJs),
  "설정 내보내기·불러오기에 들어가고, 알 수 없는 값은 버린다");
check(/cachedStorageSet\(\{ \[displayKey\]: style \}\);/.test(settingsJs) &&
  /if \(stored\?\.\[displayKey\] === "block"\) style = "block";/.test(settingsJs),
  "선택하면 저장하고, 저장값이 없으면 한줄보기(기존 모양)");
for (const [source, label] of [[live, "라이브"], [watch, "다시보기 시청 페이지"]]) {
  check(/"cheeseMultiviewBadgeChatDisplayStyle",/.test(source) &&
    /cheeseMultiviewBadgeChatDisplayStyle === "block" \? "block" : "inline"/.test(source),
    `${label}: 설정을 읽고 바뀌면 반영한다`);
}
check(/popoverList\?\.classList\.toggle\("is-block", badgeSettings\.displayStyle === "block"\);/.test(live) &&
  /vodBadgeChatList\?\.classList\.toggle\("is-block", vodBadgeChatSettings\.displayStyle === "block"\);/.test(watch) &&
  /displayStyle: vodBadgeChatSettings\.displayStyle,/.test(watch) &&
  /badgeList\.classList\.toggle\("is-block", badgeSettings\.displayStyle === "block"\);/.test(popup),
  "라이브·시청 페이지·분리 채팅 팝업 모두 목록에 is-block 을 건다");
check(/\.cheese-mv-badge-chat-list\.is-block \.cheese-mv-badge-chat-row:not\(\.is-special\) \.cheese-mv-badge-chat-inline \{`\s*\+\s*`align-items:center; display:grid; gap:6px; grid-template-columns:minmax\(0,1fr\) auto;\}/.test(live) &&
  /\.cheese-mv-badge-chat-message \{`\s*\+\s*`grid-column:1 \/ -1; grid-row:2;/.test(live),
  "라이브 블록보기: 첫 줄 닉네임·시간, 둘째 줄 채팅(원본과 같다)");
check(/\.mv-badge-chat-list\.is-block\s+\.mv-vod-chat-row:not\(\.is-special\)\s+\.mv-vod-chat-inline \{\s*align-items: center;\s*display: grid;/.test(css) &&
  /\.mv-badge-chat-list\.is-block\s+\.mv-vod-chat-row:not\(\.is-special\)\s+\.mv-vod-chat-message \{\s*grid-column: 1 \/ -1;\s*grid-row: 2;/.test(css),
  "다시보기 블록보기: 같은 배치, 후원·미션 같은 특수 카드는 건드리지 않는다");

// 설정 가져오기: 시작 음량이 빠지지 않는다(지난 수정의 누락 보완).
check(/startMainMuted: value\.startMainMuted === true,[\s\S]{0,200}startMainVolume:\s*typeof value\.startMainVolume === "number"/.test(settingsJs),
  "설정 가져오기에서 멀티뷰 시작 음량을 버리지 않는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
