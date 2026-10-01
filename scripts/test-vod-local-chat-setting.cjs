const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const source = read("src/replayLocalChat.js");
const content = read("src/content.js");
const settingsHtml = read("settings.html");
const settingsJs = read("src/settings.js");
const watch = read("src/multiviewWatch.js");
const css = read("src/multiview.css");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// ── 설정 화면 ───────────────────────────────────────────────────────────
const vodPanelItem = settingsHtml.slice(
  settingsHtml.lastIndexOf('data-panel="vod"', settingsHtml.indexOf('data-feature="vodLocalChat"')),
  settingsHtml.indexOf('data-feature="vodLocalChat"'),
);
check(settingsHtml.includes('data-feature="vodLocalChat"') && vodPanelItem.includes("다시보기 채팅 입력"),
  "설정 - 다시보기 탭에 '다시보기 채팅 입력' 스위치가 있다");
const defaultChecked = settingsJs.match(/const DEFAULT_CHECKED = new Set\(\[([\s\S]*?)\]\);/)[1];
check(!defaultChecked.includes('"vodLocalChat"'), "설정 스위치는 기본 끔");
const defaultTrue = content.match(/const FEATURE_DEFAULT_TRUE = new Set\(\[([\s\S]*?)\]\);/)[1];
check(!defaultTrue.includes('"vodLocalChat"') && /vodLocalChat: false,/.test(content),
  "content.js 도 기본 끔으로 읽는다");
check(/vodLocalChatEnabled: featureFlagsLoaded \? featureFlags\.vodLocalChat === true : null,/.test(content),
  "명시적으로 켠 경우에만 켜고, 저장값을 읽기 전에는 null 로 보낸다(깜빡임 방지)");

// ── 일반 다시보기(MAIN world) ───────────────────────────────────────────
check(/let enabled = false;/.test(source) &&
  /function syncPage\(\) \{\s*if \(!enabled\) return;/.test(source),
  "일반 다시보기는 설정을 받기 전·꺼짐일 때 입력창을 붙이지 않는다");
check(/if \(typeof value !== "boolean"\) return;/.test(source) &&
  /event\.data\?\.source !== "cheese-feature-flags"/.test(source),
  "content.js 기능 플래그의 불리언 값만 받는다");
check(/function setEnabled\(next\) \{[\s\S]*?if \(enabled\) syncPage\(\);\s*else detach\(\);/.test(source),
  "켜면 다시 붙이고 끄면 입력창·로컬 줄·감시를 뗀다");
check(/const pageObserver = new MutationObserver\(\(\) => \{\s*if \(!enabled\) return;/.test(source),
  "꺼져 있으면 문서 감시 콜백도 바로 끝난다");
check(/cheese-feature-flags-request/.test(source) && /flagRequestTries > 20/.test(source),
  "플래그 요청은 제한된 횟수만 다시 보낸다");

// ── 확장 페이지용 설정 구독 ─────────────────────────────────────────────
async function runWatch(stored, change, api = "watchEnabledSetting") {
  const listeners = [];
  const chrome = {
    storage: {
      local: { get: async () => (stored === undefined ? {} : { cheeseFeatureHidden: stored }) },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
  };
  const context = {
    URL, chrome, Promise,
    location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
    getComputedStyle: () => ({ flexDirection: "column" }),
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const seen = [];
  const stop = context.CheeseReplayLocalChat[api]((value) => seen.push(value));
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (change) {
    listeners.forEach((fn) => fn({ cheeseFeatureHidden: { newValue: change } }, "local"));
    listeners.forEach((fn) => fn({ other: { newValue: 1 } }, "local"));
  }
  stop();
  return { seen, listeners };
}

(async () => {
  check((await runWatch(undefined)).seen.join() === "false", "저장값이 없으면 끔");
  check((await runWatch({ vodLocalChat: false })).seen.join() === "false", "끈 값은 꺼짐");
  check((await runWatch({ vodLocalChat: true })).seen.join() === "true", "켠 값은 켜짐");
  check((await runWatch(undefined, null, "watchHideToolsSetting")).seen.join() === "false",
    "전송 버튼 숨김은 저장값이 없으면 보인다");
  const hide = await runWatch({ chatHideSendButton: false }, { chatHideSendButton: true },
    "watchHideToolsSetting");
  check(hide.seen.join() === "false,true", "채팅 탭 전송 버튼 숨김을 켜면 바로 알린다");
  const toggled = await runWatch({ vodLocalChat: true }, { vodLocalChat: false });
  check(toggled.seen.join() === "true,false", "설정을 바꾸면 바로 알리고 관계없는 변경은 무시한다");
  check(toggled.listeners.length === 0, "구독을 해제하면 리스너가 남지 않는다");
  {
    const context = {
      URL, location: { origin: "https://chzzk.naver.com", pathname: "/" },
      getComputedStyle: () => ({ flexDirection: "column" }),
      window: { addEventListener() {}, postMessage() {}, setInterval: () => 1 },
      document: { addEventListener() {}, documentElement: {} },
      MutationObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: () => 0,
      setInterval: () => 1,
    };
    context.globalThis = context;
    vm.runInNewContext(source, context);
    let called = false;
    context.CheeseReplayLocalChat.watchEnabledSetting(() => { called = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    check(!called, "치지직 페이지(chrome.storage 없음)에서는 아무 일도 하지 않는다");
  }

  // ── 멀티뷰 시청·분리 채팅 ─────────────────────────────────────────────
  check(/let vodLocalChatEnabled = false;\s*if \(vodLocalChatForm\) vodLocalChatForm\.hidden = true;/.test(watch) &&
    /watchEnabledSetting\(\(enabled\) => \{[\s\S]*?vodLocalChatForm\.hidden = !enabled;[\s\S]*?renderVodChat\(\);/.test(watch),
    "멀티뷰 시청: 설정을 읽기 전엔 숨기고, 바뀌면 입력창과 채팅을 다시 그린다");
  check(/const local = vodLocalChatEnabled\s*\?\s*vodLocalChatSession\.visible/.test(watch),
    "멀티뷰 시청: 꺼지면 입력한 로컬 채팅도 감춘다(분리 채팅에도 같은 목록이 간다)");
  check(/onSend: \(text\) => \{\s*if \(!vodLocalChatEnabled\) return;/.test(watch),
    "멀티뷰 시청: 꺼져 있으면 입력을 받지 않는다");
  check(/\.mv-vod-chat-compose\[hidden\] \{\s*display: none;/.test(css),
    "display:flex 가 hidden 을 덮지 않는다");

  // ── 채팅 탭 '채팅 전송 버튼 숨김' 연동 ──────────────────────────────────
  const replayCss = read("src/replayLocalChat.css");
  check(/html\.cheese-chat-hide-send-button\s+aside#vod-aside\s+\.cheese-replay-local-chat-tools \{\s*display: none;/.test(replayCss),
    "일반 다시보기: 전송 버튼 숨김이 켜지면 도구 줄을 숨긴다");
  check(/"cheese-chat-hide-send-button",\s*featureFlags\.chatHideSendButton === true,/.test(content),
    "일반 다시보기: content.js 가 <html> 에 전송 버튼 숨김 클래스를 붙인다");
  check(/html\.mv-hide-chat-send-button \.mv-vod-chat-compose-tools \{\s*display: none;/.test(css),
    "멀티뷰: 전송 버튼 숨김이 켜지면 도구 줄을 숨긴다");
  const toggle = /watchHideToolsSetting\(\(hide\) => \{\s*document\.documentElement\.classList\.toggle\("mv-hide-chat-send-button", hide\);/;
  check(toggle.test(watch),
    "멀티뷰 시청 페이지가 같은 설정을 따른다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
