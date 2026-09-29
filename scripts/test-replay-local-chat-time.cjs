const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

process.env.TZ = "Asia/Seoul";
const source = fs.readFileSync("src/replayLocalChat.js", "utf8");
const context = {
  URL, Date,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: () => ({ flexDirection: "column" }),
};
context.globalThis = context;
vm.runInNewContext(source, context);
const api = context.CheeseReplayLocalChat;
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// 실측 행: time=1790498905221, playerMessageTime=184221 → 방송 시작 1790498721000.
const row = (chatMessage, via = "props") => via === "props"
  ? { "__reactProps$abc": { children: { props: { chatMessage } } } }
  : { "__reactFiber$abc": { memoizedProps: {}, child: { memoizedProps: { chatMessage } } } };
check(api.nativeRowEpochBase(row({ time: 1790498905221, playerMessageTime: 184221 })) === 1790498721000,
  "치지직 채팅 줄에서 방송 시작 시각을 구한다(전송 시각 − 영상 경과)");
check(api.nativeRowEpochBase(row({ time: 1790498905221, playerMessageTime: 184221 }, "fiber")) === 1790498721000,
  "props 가 없으면 fiber 에서 찾는다");
check(api.nativeRowEpochBase(row({ playerMessageTime: 184221 })) === null &&
  api.nativeRowEpochBase(row({ time: 1790498905221 })) === null &&
  api.nativeRowEpochBase({}) === null,
  "필요한 값이 없으면 계산하지 않는다");

// 로컬 채팅(재생 184.6초) → 실측 채팅과 같은 17:48.
const base = 1790498721000;
check(api.formatChatClock(base + 184.6 * 1000, "24h") === "17:48", "24시간 형식은 치지직 채팅 시각과 같다");
check(api.formatChatClock(base + 184.6 * 1000, "12h-ko") === "오후 5:48", "12시간(한국어) 형식");
check(api.formatChatClock(base + 184.6 * 1000, "12h-en") === "PM 5:48", "12시간(영문) 형식");
check(api.formatChatClock(new Date(2026, 0, 1, 0, 5).getTime(), "12h-ko") === "오전 12:05",
  "자정은 12시로 표시한다");

// 연결 상태.
check(/chatShowTime = showTime;[\s\S]*?scheduleReconcile\(\);/.test(source) &&
  /event\.data\.flags\?\.chatShowTime === true/.test(source),
  "설정 - 채팅 '채팅 시간 표시'를 받아 바로 다시 그린다");
check(/applyLocalTimes\(visible\);/.test(source), "로컬 줄을 놓을 때마다 시간을 맞춘다");
check(/span\.className = "cheese-chat-time";\s*identity\.parentNode\.insertBefore\(span, identity\);/.test(source),
  "치지직 채팅과 같은 클래스·위치(배지를 포함한 닉네임 묶음 앞)로 붙인다");
check(/chzzk-badge-moa-chat-timestamp-enabled/.test(source), "배지 모아 챗이 시간을 표시 중이면 양보한다");
check(/session\.setVideo\(videoNo\);\s*epochBase = null;/.test(source), "영상이 바뀌면 방송 시작 시각을 다시 구한다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
