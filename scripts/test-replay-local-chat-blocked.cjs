const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

const source = fs.readFileSync("src/replayLocalChat.js", "utf8");
const css = fs.readFileSync("src/replayLocalChat.css", "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

function target() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) =>
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== fn)),
    fire(type, event) { for (const fn of listeners.get(type) || []) fn(event); },
  };
}
const documentTarget = Object.assign(target(), { activeElement: null });
const context = {
  URL,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: () => ({ flexDirection: "column" }),
  document: documentTarget,
};
context.globalThis = context;
vm.runInNewContext(source, context);
const api = context.CheeseReplayLocalChat;

const classes = new Set();
const container = { classList: {
  add: (name) => classes.add(name),
  remove: (name) => classes.delete(name),
  toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
} };
const input = Object.assign(target(), {
  value: "", placeholder: "다시보기 채팅 입력", disabled: false, style: {}, scrollHeight: 20,
  setAttribute() {}, closest: () => container,
  focus() { documentTarget.activeElement = input; },
  blur() { documentTarget.activeElement = null; },
});
const form = Object.assign(target(), { isConnected: true, closest: () => null });
const button = { disabled: true };
const sent = [];
api.bindComposer({ form, input, button, onSend: (text) => sent.push(text) });
const ev = (fields) => ({ preventDefault() {}, stopPropagation() {}, isComposing: false,
  shiftKey: false, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
  target: { closest: () => null }, ...fields });

input.focus();
input.value = "광고 전에 쓰던 글";
input.fire("input", {});
check(button.disabled === false, "평소에는 보낼 수 있다");

api.setComposerBlocked(form, true);
check(input.disabled === true && button.disabled === true, "로딩 표시가 있으면 입력창·버튼을 잠근다");
check(documentTarget.activeElement === null, "입력 중이었다면 포커스를 뺀다");
check(input.placeholder === "채팅을 불러오는 동안에는 입력할 수 없습니다" && classes.has("is-blocked"),
  "잠긴 이유를 입력창에 보여 준다");
check(input.value === "광고 전에 쓰던 글", "쓰던 글은 지우지 않는다");
form.fire("submit", ev({ type: "submit" }));
input.fire("keydown", ev({ key: "Enter" }));
check(sent.length === 0, "잠긴 동안에는 버튼·Enter 로 보내지지 않는다");
documentTarget.fire("keydown", ev({ key: "ㅓ", code: "KeyJ" }));
check(documentTarget.activeElement === null, "잠긴 동안에는 J 단축키도 무시한다");

api.setComposerBlocked(form, false);
check(input.disabled === false && button.disabled === false &&
  input.placeholder === "다시보기 채팅 입력" && !classes.has("is-blocked"),
  "로딩 표시가 사라지면 원래대로 돌아온다");
input.fire("keydown", ev({ key: "Enter" }));
check(sent.join() === "광고 전에 쓰던 글", "풀린 뒤에는 쓰던 글을 그대로 보낼 수 있다");

// 연결 상태.
check(/activeAside\.querySelector\("\[class\*='_loading_image_'\]"\)/.test(source),
  "치지직 채팅창의 로딩 표시(_loading_image_)로 판정한다");
check(/const pageObserver = new MutationObserver\(\(\) => \{\s*if \(!enabled\) return;\s*scheduleAvailabilityCheck\(\);/.test(source) &&
  /availabilityTimer = window\.setTimeout\(\(\) => \{[\s\S]*?\}, 200\);/.test(source),
  "문서가 바뀔 때 0.2초에 한 번으로 묶어 확인한다");
check(/container\.append\(composer\);[\s\S]{0,120}updateComposerAvailability\(\);/.test(source),
  "광고 중에 입력창이 새로 붙어도 바로 잠근다");
check(/\.cheese-replay-local-chat-input-container\.is-blocked \{[^}]*opacity: 0\.6;/.test(css),
  "잠긴 입력창은 흐리게 보인다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
