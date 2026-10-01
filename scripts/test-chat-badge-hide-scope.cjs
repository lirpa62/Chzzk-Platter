const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const css = readFileSync("src/content.css", "utf8");
const badgeRule = css.match(
  /html\.cheese-chat-badge-hide-on\s+:is\(aside#aside-chatting, aside#vod-aside\)[\s\S]*?display: none !important;\s*}/,
)?.[0];

assert.ok(badgeRule, "badge hide rule must exist");
assert.match(
  badgeRule,
  /:not\(\.cheese-chat-nick-shown\)\s+:is\(button\[class\*="_nickname_"\], button\[class\*="_profile_button_"\]\)\s*> \[class\*="_container_"\]\s*> \[class\*="_wrapper_"\]/,
  "chat rows must only hide badge wrappers inside nickname buttons, not mission card wrappers",
);
assert.match(
  badgeRule,
  /button\[class\*="_button_chatting_"\]:not\(\.cheese-chat-nick-shown\)/,
  "floating chat badges must remain covered",
);

console.log("채팅 배지 숨김 범위 검증 통과");
