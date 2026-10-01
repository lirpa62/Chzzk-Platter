const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const source = read("src/replayLocalChat.js");
const replayCss = read("src/replayLocalChat.css");
const mvCss = read("src/multiview.css");
const content = read("src/content.js");
const settingsHtml = read("settings.html");
const settingsUi = read("src/settingsUi.js");
const watch = read("src/multiviewWatch.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// ── 전송·ESC 뒤 플레이어 포커스 ─────────────────────────────────────────
function target() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) =>
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn)),
    fire(type, event) { for (const fn of listeners.get(type) || []) fn(event); },
  };
}
const context = {
  URL,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: () => ({ flexDirection: "column" }),
  document: target(),
};
context.globalThis = context;
vm.runInNewContext(source, context);
const input = Object.assign(target(), {
  value: "", style: {}, scrollHeight: 20, setAttribute() {}, closest: () => null,
  focus() {}, blur() {},
});
const form = Object.assign(target(), { isConnected: true, closest: () => null });
let exits = 0;
context.CheeseReplayLocalChat.bindComposer({
  form, input, button: {}, onSend() {}, onExit: () => { exits += 1; },
});
const ev = (fields) => ({ preventDefault() {}, stopPropagation() {}, isComposing: false,
  shiftKey: false, ...fields });
input.value = "엔터";
input.fire("keydown", ev({ key: "Enter" }));
check(exits === 0, "Enter 전송은 이어서 입력하도록 입력창에 남는다");
input.value = "버튼";
form.fire("submit", ev({ type: "submit" }));
check(exits === 1, "'채팅' 버튼으로 보내면 플레이어로 포커스를 넘긴다");
input.fire("keydown", ev({ key: "Escape" }));
check(exits === 2, "ESC 로 빠져나오면 플레이어로 포커스를 넘긴다");
form.fire("submit", ev({ type: "submit" }));
check(exits === 2, "빈 입력으로 버튼을 누르면 아무 일도 하지 않는다");
check(/function focusRegularPlayer\(\) \{\s*const player = document\.querySelector\("\.pzp\.pzp-pc, \.pzp-pc"\);[\s\S]*?player\.focus\(\{ preventScroll: true \}\);/.test(source) &&
  /onExit: focusRegularPlayer/.test(source),
  "일반 다시보기는 방향키를 받는 .pzp-pc(tabindex=0)로 포커스를 옮긴다(실측)");

// ── 일반 다시보기 줄 구성(치지직 채팅 줄과 같게) ─────────────────────────
check(/badges\.className = "cheese-replay-local-chat-badges";[\s\S]*?badge\.width = 18;\s*badge\.height = 18;/.test(source),
  "배지는 묶음 안에 18px 로 둔다");
check(/nicknameText\.className = "cheese-replay-local-chat-nickname-text";/.test(source),
  "닉네임은 말줄임용 안쪽 span 을 둔다");
const rule = (selector) => {
  const start = replayCss.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} 규칙이 없다`);
  return replayCss.slice(start, replayCss.indexOf("}", start));
};
const contentRule = rule("aside#vod-aside .cheese-replay-local-chat-content");
check(/padding: 4px 6px;/.test(contentRule) && /line-height: 20px;/.test(contentRule) &&
  /word-break: break-all;/.test(contentRule) && /overflow: hidden;/.test(contentRule),
  "메시지 상자: 여백 4px 6px · 줄 높이 20px · 단어 끊기가 치지직과 같다");
check(/margin-bottom: 3px;/.test(rule("aside#vod-aside .cheese-replay-local-chat-message")),
  "줄 간격 3px 이 치지직과 같다");
const identityRule = rule("aside#vod-aside .cheese-replay-local-chat-identity");
check(/margin: -2px 4px -2px 0;/.test(identityRule) && /padding: 2px 4px 2px 2px;/.test(identityRule) &&
  /vertical-align: top;/.test(identityRule), "닉네임 묶음 여백이 치지직과 같다");
check(/gap: 4px;/.test(rule("aside#vod-aside .cheese-replay-local-chat-badges")) &&
  /margin-right: 4px;/.test(rule("aside#vod-aside .cheese-replay-local-chat-badges")),
  "배지 묶음 간격이 치지직과 같다");
check(/font-weight: 500;/.test(rule("aside#vod-aside .cheese-replay-local-chat-nickname")) &&
  /margin-left: 1px;/.test(rule("aside#vod-aside .cheese-replay-local-chat-badges + .cheese-replay-local-chat-nickname")),
  "닉네임 굵기·배지 뒤 간격이 치지직과 같다");
check(/text-overflow: ellipsis;/.test(rule("aside#vod-aside .cheese-replay-local-chat-nickname-text")),
  "긴 닉네임은 한 줄 말줄임");

// ── 보라 강조와 숨김 옵션 ───────────────────────────────────────────────
const gradient = (prefix) => new RegExp(
  `background: var\\(--${prefix}-highlight-base\\)\\s*linear-gradient\\(\\s*45deg,\\s*` +
  `rgba\\(var\\(--${prefix}-gradient-start-rgb\\), 0\\.2\\),\\s*` +
  `rgba\\(var\\(--${prefix}-gradient-end-rgb\\), 0\\.14902\\)\\s*\\);`);
check(gradient("cheese-replay-local-chat").test(contentRule) &&
  /box-shadow: inset 0 0 0 1px var\(--cheese-replay-local-chat-highlight-border\);/.test(contentRule),
  "일반 다시보기: 응원 채팅 그라데이션 배경과 보라 테두리선(자리 차지 없는 inset)");
for (const [css, prefix, label] of [
  [replayCss, "cheese-replay-local-chat", "일반 다시보기"],
  [mvCss, "mv-vod-local-chat", "멀티뷰"],
]) {
  check(css.includes(`--${prefix}-highlight-base: #fff;`) &&
    css.includes(`--${prefix}-highlight-base: #141517;`) &&
    css.includes(`--${prefix}-gradient-start-rgb: 87, 65, 255;`) &&
    css.includes(`--${prefix}-gradient-end-rgb: 26, 175, 255;`),
    `${label}: 그라데이션 색(바탕 #fff/#141517, 87,65,255 → 26,175,255)`);
}
check(/--cheese-replay-local-chat-highlight-border: rgba\(124, 58, 237/.test(replayCss) &&
  /--cheese-replay-local-chat-highlight-border: rgba\(167, 139, 250/.test(replayCss),
  "일반 다시보기: 라이트·다크 보라 색을 따로 둔다");
check(/html\.cheese-vod-local-chat-hide-border aside#vod-aside \.cheese-replay-local-chat-content \{\s*box-shadow: none;/.test(replayCss) &&
  /html\.cheese-vod-local-chat-hide-bg aside#vod-aside \.cheese-replay-local-chat-content \{\s*background: transparent;/.test(replayCss),
  "일반 다시보기: 테두리선·배경색을 각각 숨긴다");
check(/"cheese-vod-local-chat-hide-border",\s*featureFlags\.vodLocalChatHideBorder === true,/.test(content) &&
  /"cheese-vod-local-chat-hide-bg",\s*featureFlags\.vodLocalChatHideBackground === true,/.test(content) &&
  /vodLocalChatHideBorder: false,/.test(content) && /vodLocalChatHideBackground: false,/.test(content),
  "일반 다시보기: content.js 가 숨김 클래스를 붙인다(기본 끔)");
check(gradient("mv-vod-local-chat").test(mvCss) &&
  /\.mv-vod-chat-row\.is-local \{[\s\S]*?border-color: var\(--mv-vod-local-chat-highlight-border\);/.test(mvCss) &&
  /html\[data-theme="dark"\]\s*\.mv-vod-chat-feed\s*\.mv-vod-chat-row\.is-local/.test(mvCss),
  "멀티뷰: 나의 채팅 줄에 그라데이션 배경·보라 테두리선(다크 따로)");
check(/html\.cheese-vod-local-chat-hide-border\s*\.mv-vod-chat-feed\s*\.mv-vod-chat-row\.is-local \{\s*border-color: transparent;/.test(mvCss) &&
  /html\.cheese-vod-local-chat-hide-bg\s*\.mv-vod-chat-feed\s*\.mv-vod-chat-row\.is-local \{\s*background: transparent;/.test(mvCss),
  "멀티뷰: 테두리선·배경색을 각각 숨긴다");
check(/CheeseReplayLocalChat\.watchStyleClasses\(\);/.test(watch),
  "멀티뷰 시청 페이지가 같은 설정을 따른다");

// 설정 화면: '다시보기 채팅 입력'의 하위 옵션.
const parent = settingsHtml.indexOf('data-feature="vodLocalChat"');
const border = settingsHtml.indexOf('data-feature="vodLocalChatHideBorder"');
const bg = settingsHtml.indexOf('data-feature="vodLocalChatHideBackground"');
check(parent > 0 && border > parent && bg > border &&
  settingsHtml.slice(parent, bg).includes("└ 테두리선 숨김") &&
  settingsHtml.slice(border, bg + 400).includes("└ 배경색 숨김"),
  "설정 - 다시보기: '다시보기 채팅 입력' 아래에 테두리선·배경색 숨김");
check(settingsUi.includes(`['[data-feature="vodLocalChat"]', '[data-feature="vodLocalChatHideBorder"], [data-feature="vodLocalChatHideBackground"]']`),
  "부모를 끄면 하위 옵션이 잠긴다");

(async () => {
  // 확장 페이지: 저장값으로 <html> 클래스를 건다.
  const listeners = [];
  const classes = new Set();
  const root = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
  const ctx = {
    URL, Promise,
    chrome: { storage: {
      local: { get: async () => ({ cheeseFeatureHidden: { vodLocalChatHideBorder: true } }) },
      onChanged: { addListener: (fn) => listeners.push(fn), removeListener() {} },
    } },
    location: { origin: "chrome-extension://test", pathname: "/x" },
    getComputedStyle: () => ({ flexDirection: "column" }),
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(source, ctx);
  ctx.CheeseReplayLocalChat.watchStyleClasses(root);
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(classes.has("cheese-vod-local-chat-hide-border") && !classes.has("cheese-vod-local-chat-hide-bg"),
    "확장 페이지: 저장값대로 숨김 클래스를 건다");
  listeners.forEach((fn) => fn({ cheeseFeatureHidden: {
    newValue: { vodLocalChatHideBorder: false, vodLocalChatHideBackground: true },
  } }, "local"));
  check(!classes.has("cheese-vod-local-chat-hide-border") && classes.has("cheese-vod-local-chat-hide-bg"),
    "확장 페이지: 설정을 바꾸면 바로 반영한다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
