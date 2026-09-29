const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const content = read("src/content.js");
const chat = read("src/chatTimestamp.js");
const badge = read("src/subscribeBadge.js");
const watch = read("src/multiviewWatch.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// 영상 칸과 채팅 칸은 쿼리로 구분된다. 채팅 칸에는 cheeseMulti=1 이 없어야 한다.
check(/new URL\(`\/live\/\$\{liveChannelId\}\/chat`, CHZZK_ORIGIN\);\s*url\.searchParams\.set\("cheeseMultiChat", "1"\);/.test(watch),
  "채팅 칸은 cheeseMultiChat=1 만 받는다");
const chatFrameUrl = watch.slice(watch.indexOf("new URL(`/live/${liveChannelId}/chat`"),
  watch.indexOf('$("mvChatFrame").src = url.toString();'));
check(!/"cheeseMulti"/.test(chatFrameUrl), "채팅 칸 주소에 영상 칸 표시(cheeseMulti)를 붙이지 않는다");

// content.js: 기준은 한 곳.
check(/const CHAT_DOM_WATCH_OFF = IS_MULTIVIEW_FRAME;/.test(content),
  "영상 칸 판정은 IS_MULTIVIEW_FRAME 하나로 정한다(채팅 칸 제외)");
check(/function anyChatTweakOn\(\) \{\s*if \(CHAT_DOM_WATCH_OFF\) return false;/.test(content),
  "영상 칸에서는 채팅 정리 감시(너비 측정 포함)를 붙이지 않는다");
check(/function ensureChatMsgObserver\(\) \{\s*if \(\s*CHAT_DOM_WATCH_OFF \|\|/.test(content),
  "영상 칸에서는 채팅 차단 감시를 붙이지 않는다");
check(/function ensureChatBlockObserver\(\) \{\s*if \(!chatProfileBlockButtonOn \|\| CHAT_DOM_WATCH_OFF\)/.test(content),
  "영상 칸에서는 프로필 차단 버튼 감시를 붙이지 않는다");
// 영상 칸이 계속 해야 하는 채팅창 일은 그대로 남는다.
check(/function ensureMultiviewChatFold\((?:force = false)?\) \{[\s\S]*?getLiveChatAside\(\)/.test(content),
  "채팅 접기 유지는 영상 칸에서 계속 동작한다");

// 별도 스크립트: 영상 칸이면 시작하지 않는다.
const guard = /if \(\s*window\.top !== window &&\s*new URLSearchParams\(location\.search\)\.get\("cheeseMulti"\) === "1"\s*\)\s*return;/;
check(guard.test(chat), "chatTimestamp.js 는 영상 칸에서 시작하지 않는다");
check(guard.test(badge), "subscribeBadge.js 는 영상 칸에서 시작하지 않는다");
check(chat.search(guard) < chat.indexOf("new MutationObserver") &&
  chat.search(guard) < chat.indexOf("function scheduleRetry"),
  "chatTimestamp.js 는 감시·재시도를 만들기 전에 멈춘다");
check(badge.search(guard) < badge.indexOf("__cheeseSubscribeBadgeLoaded"),
  "subscribeBadge.js 는 로드 표식 전에 멈춘다");

// 가드 조건 자체를 주소별로 확인한다.
const skip = (search, top) =>
  !top && new URLSearchParams(search).get("cheeseMulti") === "1";
check(skip("?cheeseMulti=1&cheeseMultiMain=0", false), "영상 칸(iframe)은 건너뛴다");
check(!skip("?cheeseMultiChat=1&cheeseMultiChatGeneration=3", false), "채팅 칸은 그대로 동작한다");
check(!skip("?cheesePopup=1", false), "팝업 플레이어는 그대로 동작한다");
check(!skip("?cheeseMulti=1", true), "최상위 탭은 그대로 동작한다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
