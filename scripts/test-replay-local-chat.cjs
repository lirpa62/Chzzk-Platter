const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

const source = fs.readFileSync("src/replayLocalChat.js", "utf8");
const context = {
  URL,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: (element) => element.computedStyle || { flexDirection: "column" },
};
context.globalThis = context;
vm.runInNewContext(source, context);

const session = context.CheeseReplayLocalChat.createSession();
assert.equal(session.add("영상 미선택", 0), null);
assert.equal(session.setVideo("123456"), true);
assert.equal(session.setVideo("123456"), false);

const earlier = session.add("먼저 쓴 메시지", 8);
const later = session.add("나중 메시지", 12.5);
assert.equal(earlier.nickname, "나");
assert.equal(earlier.local, true);
assert.deepEqual(Array.from(session.visible(10), (item) => item.id), [earlier.id]);
assert.deepEqual(Array.from(session.visible(12.5), (item) => item.id), [earlier.id, later.id]);
assert.equal(session.setIdentity({
  nickname: "리르파",
  profileImageUrl: "https://nng-phinf.pstatic.net/profile.png",
  loggedIn: true,
  subscribing: true,
  lastBadgeImageUrl: "https://nng-phinf.pstatic.net/glive/subscription/badge.png",
}), true);
assert.equal(session.visible(12.5)[0].nickname, "리르파", "identity updates existing local messages");
assert.equal(session.getIdentity().profileImageUrl,
  "https://nng-phinf.pstatic.net/profile.png?type=f160_160_na");
const profileMessage = session.add("프로필 적용 확인", 13);
assert.equal(profileMessage.nickname, "리르파");
assert.equal(profileMessage.badges[0].position, "before");
assert.equal(profileMessage.subscriptionBadgeUrl,
  "https://nng-phinf.pstatic.net/glive/subscription/badge.png");
assert.equal(session.add("   ", 13), null);
assert.equal(session.add("시간 없음", NaN), null);
assert.equal(session.add("x".repeat(context.CheeseReplayLocalChat.MAX_MESSAGE_LENGTH + 1), 14), null);

for (let index = 0; index < context.CheeseReplayLocalChat.MAX_MESSAGES + 5; index += 1) {
  session.add(`메시지 ${index}`, 20 + index);
}
assert.equal(session.snapshot().count, context.CheeseReplayLocalChat.MAX_MESSAGES);
assert.equal(session.visible(1000).length, context.CheeseReplayLocalChat.MAX_MESSAGES);
assert.equal(session.setVideo("654321"), true);
assert.equal(session.snapshot().count, 0, "영상이 바뀌면 이전 로컬 채팅을 비운다");
assert.equal(session.getIdentity().nickname, "나", "identity resets between videos");

const makeScrollCase = ({ flexDirection, top, rowTop }) => {
  const list = {
    isConnected: true,
    scrollTop: top,
    scrollHeight: 1000,
    clientHeight: 400,
    computedStyle: { flexDirection },
    getBoundingClientRect: () => ({ top: 0 }),
  };
  const row = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: rowTop, height: 20 }),
  };
  context.CheeseReplayLocalChat.revealRowAtPosition(list, row);
  return list.scrollTop;
};
assert.equal(makeScrollCase({ flexDirection: "column-reverse", top: 0, rowTop: 50 }), -140,
  "역방향 목록은 음수 scrollTop을 사용해 현재 시점 행을 보이게 한다");
assert.equal(makeScrollCase({ flexDirection: "column", top: 0, rowTop: 350 }), 160,
  "일반 목록은 양수 scrollTop 범위를 유지한다");

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const regularReplayScript = manifest.content_scripts.find((entry) =>
  entry.js?.includes("src/replayLocalChat.js"));
assert.deepEqual(Array.from(regularReplayScript.matches), ["https://chzzk.naver.com/video/*"]);
assert.equal(regularReplayScript.all_frames, false);
assert.ok(regularReplayScript.css.includes("src/replayLocalChat.css"));
assert.match(source, /cheese-replay-local-chat-input-container/);
assert.match(source, /cheese-replay-local-chat-tools/);
assert.match(source, /cheese-replay-local-chat-indicator/);
assert.doesNotMatch(source, /contentEditable\s*=|createElement\("pre"\)|input\.hidden\s*=/,
  "the composer keeps one textarea while focused");
assert.match(source, /container\?\.classList\.add\("is-active"\)/);
assert.match(source, /function revealRowAtPosition\(list, row\)/);
assert.match(source, /const reverse = getComputedStyle\(list\)\.flexDirection === "column-reverse"/);
assert.match(source, /const minScrollTop = replayScrollReversed \? -maxScrollTop : 0/);
// 한글 입력 상태에서는 key 가 "ㅓ" 라 물리 키(code)로도 판정한다(test-replay-local-chat-keys.cjs).
assert.match(source, /event\.code === "KeyJ" \|\| String\(event\.key \|\| ""\)\.toLowerCase\(\) === "j"/);
assert.doesNotMatch(source, /nearBottom|activeList\.scrollTop\s*=\s*activeList\.scrollHeight/,
  "native replay chat insertion does not force-scroll the list");
assert.match(source, /function scheduleReplayScrollLock\(\)/);
assert.match(source, /function keepReplayListPosition\(\)/);
assert.match(source, /function findScrollElement\(list, aside\)/);
assert.match(source, /replayScrollTop = replayScrollElement\?\.scrollTop/);
assert.match(source, /revealRowAtPosition\(replayScrollElement \|\| activeList, pendingRow\)/);
assert.match(source, /USER_STATUS_URL = "https:\/\/comm-api\.game\.naver\.com\/nng_main\/v1\/user\/getUserStatus"/);
assert.match(source, /commercial\/v1\/subscribe\/channels\//);
const watchHtml = fs.readFileSync("multiviewWatch.html", "utf8");
for (const html of [watchHtml]) {
  assert.match(html, /mv-vod-chat-compose-input-container/);
  assert.match(html, /mv-vod-chat-compose-tools/);
  assert.match(html, /이 기기에만 표시/);
  assert.doesNotMatch(html, /mv-vod-chat-compose-row/);
}
const localChatCss = fs.readFileSync("src/replayLocalChat.css", "utf8");
// 치지직 다시보기 채팅 줄(_chatting_message_)과 같은 여백(실측 4px 6px).
assert.match(localChatCss, /\.cheese-replay-local-chat-content \{[^}]*padding: 4px 6px;/s);
assert.match(localChatCss, /\.cheese-replay-local-chat-badge\s*\{[^}]*border-radius: 0;[^}]*height: 18px;[^}]*width: 18px/s);
assert.match(localChatCss, /\.cheese-replay-local-chat-input\s*\{[^}]*height: 20px;[^}]*padding: 0;/s);
assert.match(localChatCss, /\.cheese-replay-local-chat-input:focus::placeholder/);
assert.match(localChatCss, /--cheese-replay-local-chat-surface-neutral-base: #e1e1e5/);
assert.match(localChatCss, /--cheese-replay-local-chat-surface-neutral-base: #2e3033/);
assert.match(localChatCss, /--cheese-replay-local-chat-surface-brand-strongest: #1bb373/);
assert.match(localChatCss, /--cheese-replay-local-chat-surface-brand-strongest: #00ffa3/);
assert.doesNotMatch(localChatCss, /--sem-color-/,
  "local replay chat colors do not inherit page theme token values");
assert.doesNotMatch(source, /XMLHttpRequest|runtime\.sendMessage|send_chat_or_donate/,
  "로컬 채팅 메시지는 실제 채팅 전송 경로를 사용하지 않는다");
assert.doesNotMatch(source, /chrome\.storage|localStorage|sessionStorage/,
  "로컬 채팅은 저장소에 기록하지 않는다");

const watch = fs.readFileSync("src/multiviewWatch.js", "utf8");
assert.match(watch, /vodLocalChatSession\.visible\(snapshot\.currentTime, 120\)/);
assert.match(watch, /vodChatScrollInitialized/);
assert.match(watch, /pendingVodLocalRevealId/);
assert.match(watch, /data-chat-id="\$\{esc\(message\.id\)\}"/);
assert.match(watch, /message\.local[\s\S]{0,60}vodChatSession\.broadcastTimeAt\(message\.at\)/);
// 재생에 따라 붙는 채팅은 맨 아래를 보던 중일 때만 따라간다(지난 채팅을 보는 중이면 위치 유지).
// 입력한 로컬 채팅 보여 주기(pendingVodLocalRevealId·newLocalRow)는 그대로다.
assert.match(watch, /list\.scrollTop = nearBottom \? list\.scrollHeight : previousScrollTop;/);

console.log("Replay local chat session, bounds, video isolation and local-only transport checks passed.");

async function testIdentityLoading() {
  const requested = [];
  const identityContext = {
    URL,
    location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
    fetch: async (url) => {
      requested.push(String(url));
      const content = String(url).includes("getUserStatus")
        ? {
            loggedIn: true,
            nickname: "리르파",
            profileImageUrl: "https://nng-phinf.pstatic.net/profile.png",
          }
        : String(url).includes("/service/v2/videos/")
          ? { channel: { channelId: "6bd0bb97d31365e7834d8113bb01d889" } }
          : String(url).endsWith("6bd0bb97d31365e7834d8113bb01d889")
            ? { subscribing: true, info: { lastBadgeImageUrl: "https://nng-phinf.pstatic.net/sub.png" } }
            : { subscribing: false, info: { lastBadgeImageUrl: "https://nng-phinf.pstatic.net/old.png" } };
      return { ok: true, json: async () => ({ code: 200, content }) };
    },
  };
  identityContext.globalThis = identityContext;
  vm.runInNewContext(source, identityContext);
  const api = identityContext.CheeseReplayLocalChat;
  const subscribed = await api.loadIdentity("123456");
  assert.equal(subscribed.nickname, "리르파");
  assert.equal(subscribed.loggedIn, true);
  assert.equal(subscribed.subscribing, true);
  assert.equal(subscribed.subscriptionBadgeUrl, "https://nng-phinf.pstatic.net/sub.png");
  assert.ok(requested.includes("https://api.chzzk.naver.com/service/v2/videos/123456"));
  assert.ok(requested.includes("https://api.chzzk.naver.com/commercial/v1/subscribe/channels/6bd0bb97d31365e7834d8113bb01d889"));
  const notSubscribed = await api.loadIdentity("123456", "1b0561f3051c10a24b9d8ec9a6cb3374");
  assert.equal(notSubscribed.subscribing, false);
  assert.equal(notSubscribed.subscriptionBadgeUrl, "");
  assert.ok(requested.every((url) => [
    "https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus",
    "https://api.chzzk.naver.com/service/v2/videos/123456",
  ].includes(url) ||
    /^https:\/\/api\.chzzk\.naver\.com\/commercial\/v1\/subscribe\/channels\/[0-9a-f]{32}$/i.test(url)));
}

testIdentityLoading().then(() => {
  console.log("Replay identity profile, video channel lookup and subscription badge fixtures passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
