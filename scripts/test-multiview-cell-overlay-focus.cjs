// 멀티뷰 칸 위 단추 묶음(오른쪽 위 도구 모음, 왼쪽 위 손잡이·'메인으로')이 보이는 조건.
//
// 칸에 마우스를 올리면 보이고 치우면 사라진다. 예전에는 :focus-within 이라 마우스로 누른
// 단추(크게 보기·원래 크기로 등)에 포커스가 남아 마우스를 치워도 계속 보였다. 이제는 키보드로
// 옮겨 온 포커스(:focus-visible)일 때만 남는다. 실제 입력(CDP)으로 확인한다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const css = readFileSync(path.join(__dirname, "../src/multiview.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-focus-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "";
  let seq = 0;
  const pending = new Map();
  browser.stdio[4].on("data", (chunk) => {
    buf += chunk;
    for (let at; (at = buf.indexOf("\0")) >= 0;) {
      const raw = buf.slice(0, at);
      buf = buf.slice(at + 1);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      const job = pending.get(msg.id);
      if (!job) continue;
      pending.delete(msg.id);
      msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
    }
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const mouse = (type, x, y) => call("Input.dispatchMouseEvent",
      { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }, sessionId);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await call("Emulation.setDeviceMetricsOverride", { width: 900, height: 400, deviceScaleFactor: 1, mobile: false }, sessionId);
    await ev(`(() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)} + 'body{margin:0;background:#111}';
      document.head.append(style);
      document.body.innerHTML = '<div style="display:flex;gap:20px;padding:20px">' +
        '<div class="mv-cell" id="c1" style="width:400px;height:225px"><div class="mv-cell-inner"></div>' +
        '<div class="mv-cell-tools"><button class="mv-cell-expand" id="expand">x</button><button class="mv-cell-change">변경</button><button class="mv-cell-close">×</button></div>' +
        '<div class="mv-cell-lead"><div class="mv-cell-grip">g</div><button class="mv-cell-main" id="main">메인으로</button></div></div>' +
        '<div class="mv-cell" id="c2" style="width:400px;height:225px"><div class="mv-cell-inner"></div></div></div>';
    })()`);
    const opacity = () => ev(`({ tools: getComputedStyle(document.querySelector('#c1 .mv-cell-tools')).opacity,
      lead: getComputedStyle(document.querySelector('#c1 .mv-cell-lead')).opacity, focused: document.activeElement?.id || '' })`);
    const box = await ev(`(() => { const r = document.getElementById('expand').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);

    await mouse("mouseMoved", 200, 150);
    await wait(200);
    const hovered = await opacity();
    check(hovered.tools === "1" && hovered.lead === "1", "칸에 마우스를 올리면 보인다");

    await mouse("mouseMoved", box.x, box.y);
    await mouse("mousePressed", box.x, box.y);
    await mouse("mouseReleased", box.x, box.y);
    await mouse("mouseMoved", 650, 150); // 옆 칸으로 옮긴다
    await wait(250);
    const afterClick = await opacity();
    check(afterClick.focused === "expand" && afterClick.tools === "0" && afterClick.lead === "0",
      "마우스로 단추를 누른 뒤 치우면 사라진다(누른 단추에 포커스가 남아 있어도)");

    await ev(`document.activeElement?.blur()`);
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
    await wait(250);
    // blur 해도 Tab 시작점은 방금 누른 단추라 다음 단추(변경)로 간다. 도구 모음 안이면 된다.
    const keyboard = { ...(await opacity()), inTools: await ev(`!!document.activeElement?.closest('#c1 .mv-cell-tools')`) };
    check(keyboard.inTools && keyboard.tools === "1",
      "키보드(Tab)로 단추에 오면 마우스가 없어도 보인다");
    await ev(`document.getElementById('main').focus({ focusVisible: true })`);
    await wait(250);
    const leadKeyboard = await ev(`({ lead: getComputedStyle(document.querySelector('#c1 .mv-cell-lead')).opacity,
      main: getComputedStyle(document.getElementById('main')).pointerEvents })`);
    check(leadKeyboard.lead === "1" && leadKeyboard.main === "auto",
      "키보드로 '메인으로'에 오면 왼쪽 위 묶음이 보이고 누를 수 있다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  check(!/\.mv-cell-(tools|lead):focus-within/.test(css), "칸 위 단추 묶음에 :focus-within 을 쓰지 않는다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
