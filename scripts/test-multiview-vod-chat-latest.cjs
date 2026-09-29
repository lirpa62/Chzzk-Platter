const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { URL } = require("node:url");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("src/replayLocalChat.js");
const watch = read("src/multiviewWatch.js");
const popup = read("src/multiviewChatPopup.js");
const watchHtml = read("multiviewWatch.html");
const popupHtml = read("multiviewChatPopup.html");
const css = read("src/multiview.css");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

const context = {
  URL,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: () => ({ flexDirection: "column" }),
};
context.globalThis = context;
vm.runInNewContext(source, context);

function target(extra) {
  const listeners = new Map();
  return Object.assign({
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    fire: (type) => listeners.get(type)?.(),
    has: (type) => listeners.has(type),
  }, extra);
}
const list = target({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
const button = target({ hidden: false });
const control = context.CheeseReplayLocalChat.bindLatestButton({ list, button });
check(button.hidden === true, "맨 아래에서는 버튼을 숨긴다");
list.scrollTop = 300;
list.fire("scroll");
check(button.hidden === false, "위로 올려 지난 채팅을 보면 오른쪽 아래에 버튼이 뜬다");
list.scrollTop = 580;
list.fire("scroll");
check(button.hidden === true, "맨 아래 근처(32px 이내)로 돌아오면 다시 숨긴다(따라가기 기준과 같다)");
list.scrollTop = 100;
list.fire("scroll");
list.scrollHeight = 1400; // 지난 채팅을 보는 동안 새 채팅이 붙었다
control.update();
check(button.hidden === false, "새 채팅이 붙어도 지난 채팅을 보는 중이면 버튼을 유지한다");
button.fire("click");
check(list.scrollTop === 1400 && button.hidden === true, "누르면 즉시 맨 아래(최신)로 이동하고 버튼을 숨긴다");
control.dispose();
check(!list.has("scroll") && !button.has("click"), "해제하면 리스너가 남지 않는다");
check(context.CheeseReplayLocalChat.bindLatestButton({}).update() === undefined,
  "요소가 없으면 아무 일도 하지 않는다");

// 마크업·스타일·연결.
check(/<div class="mv-vod-chat-list-wrap">\s*<div class="mv-vod-chat-list" id="mvVodChatList"[^>]*><\/div>\s*<button type="button" class="mv-vod-chat-latest[^"]*" id="mvVodChatLatest"[\s\S]*?aria-label="최신 채팅으로 이동"[\s\S]*?hidden>/.test(watchHtml),
  "시청 페이지: 목록 옆에 '최신 채팅으로' 버튼(처음엔 숨김)");
check(/<div class="mv-vod-chat-list-wrap">\s*<div class="mv-vod-chat-list" id="mvChatPopupVodList"[^>]*><\/div>\s*<button type="button" class="mv-vod-chat-latest" id="mvChatPopupVodLatest"[\s\S]*?hidden>/.test(popupHtml),
  "분리 채팅 팝업: 같은 버튼");
check(/\.mv-vod-chat-list-wrap \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*position: relative;/s.test(css) &&
  /\.mv-vod-chat-latest \{[^}]*border-radius: 50%;[^}]*bottom: 12px;[^}]*position: absolute;[^}]*right: 12px;/s.test(css) &&
  /\.mv-vod-chat-latest\[hidden\] \{\s*display: none;/.test(css),
  "버튼은 목록 오른쪽 아래에 떠 있는 둥근 FAB 이고, 숨김이 display 에 덮이지 않는다");
check(/bindLatestButton\(\{\s*list: \$\("mvVodChatList"\),\s*button: \$\("mvVodChatLatest"\),/.test(watch) &&
  /vodChatLatest\.update\(\);\s*vodChatRenderSignature = signature;/.test(watch),
  "시청 페이지: 채팅을 새로 그릴 때마다 버튼 표시를 맞춘다");
check(/bindLatestButton\(\{\s*list: vodList,\s*button: \$\("mvChatPopupVodLatest"\),/.test(popup) &&
  /vodChatLatest\?\.update\(\);\s*vodLocalChatIds = nextLocalIds;/.test(popup),
  "분리 채팅 팝업: 채팅을 새로 그릴 때마다 버튼 표시를 맞춘다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
