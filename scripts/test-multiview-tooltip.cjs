const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(
  path.join(__dirname, "../src/multiviewTooltip.js"),
  "utf8",
);
const listeners = new Map();
const windowListeners = new Map();

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.style = {};
    this.hidden = false;
    this.isConnected = true;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  closest(selector) {
    return selector === "[data-tooltip]" && this.hasAttribute("data-tooltip")
      ? this
      : null;
  }

  matches(selector) {
    return selector.startsWith("button,");
  }

  contains(node) {
    return node === this;
  }

  getBoundingClientRect() {
    return { left: 100, right: 140, top: 100, bottom: 120, width: 40, height: 20 };
  }
}

const tooltip = new FakeElement();
tooltip.getBoundingClientRect = () => ({ width: 80, height: 24 });
const document = {
  body: { appendChild() {} },
  documentElement: { clientWidth: 1000, clientHeight: 800 },
  createElement: () => tooltip,
  getElementById: () => null,
  addEventListener(type, callback) {
    listeners.set(type, callback);
  },
};
const window = {
  addEventListener(type, callback) {
    windowListeners.set(type, callback);
  },
};

vm.runInNewContext(script, {
  Element: FakeElement,
  document,
  window,
  getComputedStyle: () => ({ display: "inline" }),
  MutationObserver: class {
    observe() {}
  },
});

const button = new FakeElement({ "data-tooltip": "모든 방송에서 인기 정렬" });
listeners.get("pointerover")({ target: button, relatedTarget: null });
assert.equal(tooltip.hidden, false, "포인터 진입 시 툴팁을 표시한다");

listeners.get("focusin")({ target: button });
listeners.get("pointerup")({ target: button });
assert.equal(tooltip.hidden, true, "포인터를 놓으면 툴팁을 닫는다");
listeners.get("click")({ target: button });
assert.equal(tooltip.hidden, true, "클릭하면 포커스가 남아도 툴팁을 닫는다");
windowListeners.get("resize")();
assert.equal(tooltip.hidden, true, "목록 갱신 중 위치 계산이 발생해도 툴팁을 다시 열지 않는다");

listeners.get("pointerout")({ target: button, relatedTarget: {} });
listeners.get("pointerover")({ target: button, relatedTarget: null });
assert.equal(tooltip.hidden, false, "버튼을 벗어난 뒤 다시 진입하면 툴팁을 표시한다");

console.log("multiview tooltip tests passed");
