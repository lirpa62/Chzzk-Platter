const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const popupScript = fs.readFileSync(
  path.join(root, "src/multiviewChatPopup.js"),
  "utf8",
);
const parentScript = fs.readFileSync(
  path.join(root, "src/multiviewWatch.js"),
  "utf8",
);
const tooltipScript = fs.readFileSync(
  path.join(root, "src/multiviewTooltip.js"),
  "utf8",
);
const contentScript = fs.readFileSync(
  path.join(root, "src/content.js"),
  "utf8",
);
const watchHtml = fs.readFileSync(
  path.join(root, "multiviewWatch.html"),
  "utf8",
);
const setupHtml = fs.readFileSync(path.join(root, "multiview.html"), "utf8");
const popupHtml = fs.readFileSync(
  path.join(root, "multiviewChatPopup.html"),
  "utf8",
);
const styles = fs.readFileSync(path.join(root, "src/multiview.css"), "utf8");
const popupStyles = fs.readFileSync(
  path.join(root, "src/multiviewChatPopup.css"),
  "utf8",
);
const chromeBuild = fs.readFileSync(
  path.join(root, "scripts/build-chrome-package.sh"),
  "utf8",
);
const firefoxBuild = fs.readFileSync(
  path.join(root, "scripts/build-firefox-package.sh"),
  "utf8",
);

const CHANNEL_ID = "0123456789abcdef0123456789abcdef";
const SESSION_ID = "abcdef0123456789abcdef0123456789";
const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      hidden: false,
      textContent: "",
      dataset: {},
      src: "",
      contentWindow: { sent: [], postMessage(data, origin) { this.sent.push({ data, origin }); } },
      listeners: {},
      addEventListener(type, callback) {
        this.listeners[type] = callback;
      },
    });
  }
  return elements.get(id);
};

class FakeBroadcastChannel {
  static last;
  constructor(name) {
    this.name = name;
    this.sent = [];
    FakeBroadcastChannel.last = this;
  }
  postMessage(message) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
  }
}

const windowListeners = {};
const document = {
  title: "",
  documentElement: { dataset: {} },
  getElementById: element,
};
const window = {
  addEventListener(type, callback) {
    windowListeners[type] = callback;
  },
};
vm.runInNewContext(popupScript, {
  document,
  window,
  location: { search: `?session=${SESSION_ID}` },
  URL,
  URLSearchParams,
  BroadcastChannel: FakeBroadcastChannel,
});

const bus = FakeBroadcastChannel.last;
const frame = element("mvChatPopupFrame");
assert.equal(bus.name, `cheese-multiview-chat-${SESSION_ID}`);
assert.equal(bus.sent[0].type, "POPUP_READY");
bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "SET_THEME",
    dark: true,
  },
});
assert.equal(document.documentElement.dataset.theme, "dark");
assert.equal(frame.contentWindow.sent.length, 0, "iframe 준비 전에 테마를 보내면 안 된다");

bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "LOAD_CHAT",
    channelId: "not-a-channel",
    channelName: "invalid",
    generation: 1,
    retry: false,
  },
});
assert.equal(frame.src, "", "잘못된 channelId가 URL에 사용되면 안 된다");

bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "LOAD_CHAT",
    channelId: CHANNEL_ID,
    channelName: "테스트 채널",
    generation: 7,
    retry: true,
  },
});
const chatUrl = new URL(frame.src);
assert.equal(chatUrl.origin, "https://chzzk.naver.com");
assert.equal(chatUrl.pathname, `/live/${CHANNEL_ID}/chat`);
assert.equal(chatUrl.searchParams.get("cheeseMultiChat"), "1");
assert.equal(chatUrl.searchParams.get("cheeseMultiChatGeneration"), "7");
assert.equal(chatUrl.searchParams.get("cheeseRetry"), "7");
assert.equal(document.title, "테스트 채널 채팅 - 치즈 플래터");

bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "CHAT_STATUS",
    status: "ready",
    channelId: CHANNEL_ID,
    generation: 7,
  },
});
assert.equal(element("mvChatPopupOverlay").hidden, true);
assert.equal(element("mvChatPopupStatus").textContent, "연결됨");
assert.equal(element("mvChatPopupStatus").dataset.state, "ready");

bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "CHAT_STATUS",
    status: "loading",
    channelId: CHANNEL_ID,
    generation: 7,
  },
});
assert.equal(element("mvChatPopupStatus").dataset.state, "loading");
assert.equal(element("mvChatPopupStatus").textContent, "채팅 연결 중…");

bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "CHAT_STATUS",
    status: "error",
    message: "채팅을 불러오지 못했습니다.",
    channelId: CHANNEL_ID,
    generation: 7,
  },
});
assert.equal(element("mvChatPopupStatus").dataset.state, "error");
assert.equal(element("mvChatPopupRetry").hidden, false);

const message = windowListeners.message;
const readyPayload = {
  source: "cheese-platter-multiview",
  type: "CHAT_FRAME_READY",
  channelId: CHANNEL_ID,
  generation: 7,
};
message({
  origin: "https://example.com",
  source: frame.contentWindow,
  data: readyPayload,
});
message({
  origin: "https://chzzk.naver.com",
  source: {},
  data: readyPayload,
});
assert.equal(bus.sent.filter((row) => row.type === "CHAT_FRAME_READY").length, 0);
message({
  origin: "https://chzzk.naver.com",
  source: frame.contentWindow,
  data: { ...readyPayload, generation: 6 },
});
assert.equal(bus.sent.filter((row) => row.type === "CHAT_FRAME_READY").length, 0);
message({
  origin: "https://chzzk.naver.com",
  source: frame.contentWindow,
  data: readyPayload,
});
assert.equal(bus.sent.at(-1).type, "CHAT_FRAME_READY");
assert.equal(bus.sent.at(-1).generation, 7);
assert.equal(frame.contentWindow.sent.length, 1, "준비된 iframe에 보관한 테마를 보내야 한다");
assert.equal(frame.contentWindow.sent[0].origin, "https://chzzk.naver.com");
assert.equal(frame.contentWindow.sent[0].data.dark, true);
bus.onmessage({
  data: {
    source: "cheese-platter-multiview-chat-popup",
    sessionId: SESSION_ID,
    type: "SET_THEME",
    dark: true,
  },
});
assert.equal(document.documentElement.dataset.theme, "dark");
assert.equal(frame.contentWindow.sent.at(-1).origin, "https://chzzk.naver.com");
assert.equal(frame.contentWindow.sent.at(-1).data.type, "SET_MULTIVIEW_CHAT_VIEW");

element("mvChatPopupRetry").listeners.click();
element("mvChatPopupReturn").listeners.click();
assert.equal(bus.sent.at(-2).type, "RETRY_CHAT");
assert.equal(bus.sent.at(-1).type, "RETURN_TO_PAGE");
windowListeners.beforeunload();
assert.equal(bus.sent.at(-1).type, "POPUP_CLOSED");
assert.equal(bus.closed, true);

assert.match(watchHtml, /id="mvChatPopout"/);
assert.match(watchHtml, /id="mvChatPopupReturn"/);
assert.ok(
  watchHtml.indexOf('id="mvChatPanel"') <
    watchHtml.indexOf('id="mvChatFollow"') &&
    watchHtml.indexOf('id="mvChatFollow"') <
      watchHtml.indexOf('id="mvChatExpand"'),
  "메인 따라가기 버튼은 상단바 채팅 버튼 오른쪽에 있어야 한다",
);
assert.ok(
  watchHtml.indexOf('id="mvChatFollow"') < watchHtml.indexOf('class="mv-chat-head"'),
  "메인 따라가기 버튼은 채팅 헤더가 아니라 상단바에 있어야 한다",
);
assert.match(watchHtml, /id="mvChatFollow"[^>]*data-tooltip="메인 채널을 바꾸면 채팅도 같이 바꾼다"/);
assert.match(watchHtml, /id="mvChatPopout"[^>]*data-tooltip=/);
assert.match(watchHtml, /새 창에서 채팅을 다시 연결합니다\. 기존 채팅 화면은 이동되지 않습니다\./);
assert.doesNotMatch(watchHtml, /id="mvChatFollow"[^>]*\stitle=/);
assert.doesNotMatch(watchHtml, /id="mvChatPopout"[^>]*\stitle=/);
assert.match(watchHtml, /class="mv-chat-popup-status-live"[^>]*role="status"/);
assert.match(watchHtml, /id="mvChatPopupReturn"\s+data-tooltip=/);
assert.doesNotMatch(setupHtml, /\stitle=/);
assert.doesNotMatch(watchHtml.replace(/title="채팅"/, ""), /\stitle=/);
assert.match(setupHtml, /src="src\/multiviewTooltip\.js"/);
assert.match(watchHtml, /src="src\/multiviewTooltip\.js"/);
assert.match(tooltipScript, /pointerover/);
assert.match(tooltipScript, /focusin/);
assert.match(tooltipScript, /getBoundingClientRect/);
assert.match(popupHtml, /id="mvChatPopupFrame"/);
assert.doesNotMatch(popupHtml, /id="mvChatPopupReturn"[^>]*\stitle=/);
assert.match(popupHtml, /id="mvChatPopupReturn"[^>]*data-tooltip=/);
assert.match(parentScript, /CHAT_POPUP_PAGE/);
assert.match(parentScript, /window\.open\(/);
assert.match(parentScript, /\.src = "about:blank"/);
assert.match(parentScript, /data\.channelId !== state\.chatChannelId/);
assert.match(parentScript, /data\.generation !== chatGeneration/);
assert.match(parentScript, /function restoreInlineChat/);
assert.match(parentScript, /loadChat\(state\.chatChannelId\)/);
assert.match(contentScript, /cheeseMultiChatGeneration/);
assert.match(styles, /\.mv-stage\.is-chat-popped-out \.mv-chat-body/);
assert.match(styles, /\.mv-tooltip\s*\{/);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] \.mv-chat-title-wrap/);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] #mvChatPopoutFeedback\s*\{\s*order: 1/s);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] #mvChatPopout\s*\{\s*margin-left: auto;\s*order: 2/s);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] #mvChatToggle\s*\{\s*order: 3/s);
assert.match(popupStyles, /#mvChatPopupStatus\[data-state="ready"\]::before/);
assert.match(popupStyles, /#mvChatPopupStatus\[data-state="loading"\]/);
assert.match(popupStyles, /#mvChatPopupStatus\[data-state="error"\]::before/);
assert.match(popupStyles, /\.mv-chat-popup-return\[data-tooltip\]:hover::after/);
assert.match(popupStyles, /#mvChatPopupReturn:hover\s*\{\s*background: #8055d1/s);
assert.match(chromeBuild, /copy_path "multiviewChatPopup\.html"/);
assert.match(firefoxBuild, /copy_path "multiviewChatPopup\.html"/);

console.log("multiview chat popup tests passed");
