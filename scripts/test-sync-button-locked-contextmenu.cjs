// 실시간 따라잡기 버튼: 지연이 작아 누를 수 없을 때도 우클릭으로 자동 따라잡기 메뉴가 열려야 한다.
//
// 예전에는 disabled 속성으로 잠갔다. 브라우저는 disabled 버튼에 mousedown·mouseup 을 보내지 않아
// (Windows 는 우클릭 메뉴가 mouseup 에서 열린다) 지연이 작을 때 우클릭 메뉴가 열리지 않았다.
// 지금은 aria-disabled 로 표시만 하고 좌클릭·단축키는 JS 에서 막는다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const mixer = readFileSync(path.join(ROOT, "src/audioMixer.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/audioMixer.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

// 소스: 따라잡기 버튼은 disabled 속성을 쓰지 않는다.
const syncSites = [
  sliceFn(mixer, "createSyncButton"),
  sliceFn(mixer, "updateSyncButtonState"),
];
check(syncSites.every((code) => !/btn\.disabled\s*=/.test(code)) &&
  syncSites.every((code) => /setSyncButtonLocked\(btn, /.test(code)),
  "따라잡기 버튼은 disabled 대신 setSyncButtonLocked(aria-disabled)로 잠근다");
check(/const btn = e\.target\.closest\?\.\(`\.\$\{SYNC_BUTTON_CLASS\}`\);\s*if \(!btn\) return;\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*if \(isSyncButtonLocked\(btn\)\) return;/.test(mixer),
  "좌클릭은 잠긴 상태면 아무것도 하지 않는다");
check(/const btn = document\.querySelector\(`\.\$\{SYNC_BUTTON_CLASS\}`\);\s*if \(isSyncButtonLocked\(btn\)\) return;/.test(mixer),
  "단축키(Shift+F)도 잠긴 상태면 아무것도 하지 않는다");
check(!/live-sync-button[^{]*:disabled/.test(css) &&
  /\.cheese-live-sync-button\[aria-disabled="true"\] \.pzp-ui-icon__svg \{\s*opacity: 0\.35;/.test(css),
  "잠긴 모습(흐린 아이콘)은 aria-disabled 로 그린다");
check(!/function onSyncContextMenu\(e\) \{[\s\S]{0,300}?(disabled|isSyncButtonLocked)/.test(mixer),
  "우클릭 메뉴는 잠김과 상관없이 연다");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-sync-locked-"));
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
    const rightClick = async (x, y) => {
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1 }, sessionId);
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1 }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 100));
    };
    await ev(`(() => {
      ${sliceFn(mixer, "setSyncButtonLocked")}
      ${sliceFn(mixer, "isSyncButtonLocked")}
      document.body.innerHTML = '<button type="button" id="locked" style="position:absolute;left:20px;top:20px;width:40px;height:40px"></button>' +
        '<button type="button" id="old" disabled style="position:absolute;left:100px;top:20px;width:40px;height:40px"></button>';
      setSyncButtonLocked(document.getElementById('locked'), true);
      window.lockedState = isSyncButtonLocked(document.getElementById('locked'));
      window.log = [];
      for (const type of ['mousedown', 'mouseup', 'contextmenu']) {
        document.addEventListener(type, (e) => { if (e.button === 2) log.push(e.target.id + ':' + type); }, true);
      }
      return true;
    })()`);
    await rightClick(40, 40);
    await rightClick(120, 40);
    const result = await ev(`({ log, locked: lockedState, disabled: document.getElementById('locked').disabled })`);
    check(result.locked && !result.disabled, `잠금은 aria-disabled 표시뿐이다 ${JSON.stringify(result)}`);
    check(["locked:mousedown", "locked:mouseup", "locked:contextmenu"].every((entry) => result.log.includes(entry)),
      `잠긴 버튼에도 우클릭의 mousedown·mouseup·contextmenu 가 모두 온다(Windows 우클릭 메뉴 경로 포함) ${JSON.stringify(result.log)}`);
    check(!result.log.includes("old:mousedown") && !result.log.includes("old:mouseup"),
      `대조: disabled 버튼에는 mousedown·mouseup 이 오지 않는다(예전 증상의 원인) ${JSON.stringify(result.log)}`);
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
