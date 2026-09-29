const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const html = readFileSync("settings.html", "utf8");
const content = readFileSync("src/content.js", "utf8");
const settings = readFileSync("src/settings.js", "utf8");

assert.match(html, /채팅 전송 버튼 숨김[\s\S]*?data-feature="chatHideSendButton"/);
assert.match(content, /chatHideSendButton:\s*false/);
assert.match(content, /"cheese-chat-hide-send-button"[\s\S]*?featureFlags\.chatHideSendButton === true/);
assert.match(
  content,
  /html\.cheese-chat-hide-send-button:not\(\.cheese-multiview-frame\) aside#aside-chatting button#send_chat_or_donate \{ display: none !important; \}/,
);
assert.ok(
  !content.includes("not(.cheese-multiview-chat-frame)"),
  "multiview live chat frame must inherit the send-button hiding rule",
);
assert.match(settings, /const inputs = Array\.from\(document\.querySelectorAll\("\[data-feature\]"\)\)/);
assert.match(settings, /flags\[input\.dataset\.feature\] = CheeseSettingsUi\.storedFromChecked\(input\)/);
assert.match(settings, /SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseFeatureHidden"/);
assert.match(settings, /SETTINGS_TRANSFER_KEYS = new Set\(SETTINGS_STORAGE_KEYS\)/);

console.log("일반·멀티뷰 라이브 채팅 전송 버튼 설정 검증 통과");
