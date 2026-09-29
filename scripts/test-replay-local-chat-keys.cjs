const assert = require("node:assert/strict");
const fs = require("node:fs");
const { URL } = require("node:url");
const vm = require("node:vm");

const source = fs.readFileSync("src/replayLocalChat.js", "utf8");
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
    fire(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
  };
}
const documentTarget = target();
const context = {
  URL,
  location: { origin: "chrome-extension://test", pathname: "/multiviewWatch.html" },
  getComputedStyle: () => ({ flexDirection: "column" }),
  document: documentTarget,
};
context.globalThis = context;
vm.runInNewContext(source, context);

let focused = false;
const input = Object.assign(target(), {
  value: "",
  style: {},
  scrollHeight: 20,
  setAttribute() {},
  closest: () => null,
  focus: () => { focused = true; },
  blur: () => { focused = false; },
});
const form = Object.assign(target(), { isConnected: true, closest: () => null });
const button = { disabled: true };
const sent = [];
const dispose = context.CheeseReplayLocalChat.bindComposer({
  form, input, button, onSend: (text) => sent.push(text),
});

const key = (fields) => {
  const event = {
    key: "", code: "", repeat: false, altKey: false, ctrlKey: false, metaKey: false,
    shiftKey: false, isComposing: false, target: { closest: () => null },
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...fields,
  };
  return event;
};

// J 단축키: 영문·한글 입력 상태 모두.
let event = key({ key: "j", code: "KeyJ" });
documentTarget.fire("keydown", event);
check(focused && event.prevented, "영문 상태의 J 로 입력창에 들어간다");
input.blur();
event = key({ key: "ㅓ", code: "KeyJ" });
documentTarget.fire("keydown", event);
check(focused && event.prevented, "한글 상태(key=ㅓ)의 J 로도 입력창에 들어간다");
input.blur();
event = key({ key: "Process", code: "KeyJ" });
documentTarget.fire("keydown", event);
check(focused, "IME 처리 중(key=Process)이어도 물리 키로 판정한다");
input.blur();
event = key({ key: "ㅓ", code: "KeyJ", ctrlKey: true });
documentTarget.fire("keydown", event);
check(!focused && !event.prevented, "조합키와 함께 누르면 가로채지 않는다");
event = key({ key: "ㅓ", code: "KeyJ", target: { closest: () => ({}) } });
documentTarget.fire("keydown", event);
check(!focused && !event.prevented, "다른 입력칸에 쓰는 중이면 가로채지 않는다");

// ESC 로 입력창 포커스 해제.
input.focus();
event = key({ key: "Escape", code: "Escape", isComposing: true });
input.fire("keydown", event);
check(focused && !event.prevented, "한글 조합 중의 ESC 는 조합 종료에 맡긴다");
event = key({ key: "Escape", code: "Escape" });
input.fire("keydown", event);
check(!focused && event.prevented && event.stopPropagation && event.stopped,
  "ESC 로 입력창에서 빠져나오고 치지직 단축키로 넘기지 않는다");

// Enter 전송은 그대로.
input.value = "안녕";
event = key({ key: "Enter", code: "Enter" });
input.fire("keydown", event);
check(sent.join() === "안녕" && input.value === "", "Enter 전송은 그대로 동작한다");

dispose();
input.blur();
documentTarget.fire("keydown", key({ key: "ㅓ", code: "KeyJ" }));
check(!focused, "해제하면 단축키도 떨어진다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
