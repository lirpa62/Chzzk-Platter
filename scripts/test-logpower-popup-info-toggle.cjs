// 통나무파워 상위 보유 팝업: 표시 기준 안내를 (i)로 접는다.
//
// 'TOP N 합계' 아래에 '상위 N개 채널만 표시합니다.'(표시 개수 안내)와 세 줄 안내(100 파워 이상만,
// 비활성 회색, 표시 개수 설정)가 늘 보여 길었다. 표시 개수 안내는 'TOP N 합계' 이름과 겹친다.
// 둘 다 'TOP N 합계' 옆 (i)를 누르면 합계 줄 아래에 펼친다(기본 접힘). 목록이 스크롤 상자라
// 떠 있는 툴팁은 잘리므로 흐름 안에서 펼친다.
// content.js 의 팝업 틀(table.innerHTML)과 (i) 처리 코드를 떼어 실제 content.css 로 헤드리스에서 돌린다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const css = read("src/content.css");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const tplStart = content.indexOf("          table.innerHTML =\n");
assert.ok(tplStart >= 0, "팝업 틀을 찾지 못했다");
const template = content.slice(tplStart, content.indexOf("`;\n", tplStart) + 2);
const toggleStart = content.indexOf("          const infoToggle = table.querySelector(");
assert.ok(toggleStart >= 0, "(i) 처리 코드를 찾지 못했다");
const toggleCode = content.slice(toggleStart, content.indexOf("\n          });\n", toggleStart) + 15);
const renderNotice = /if \(notice\) \{\s*notice\.textContent =\s*sorted\.length > currentLimit\s*\? `상위 \$\{currentLimit\}개 채널만 표시합니다\.`/.test(content);
check(renderNotice, "표시 개수 안내 문구는 그대로 그린다(펼친 안내 첫 줄)");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-lp-info-"));
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
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => {
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      const logPowerPopupIcon = () => '';
      const currentLimit = 10; const totalPower = 12345; const limitedTotal = () => 9999;
      const LOGPOWER_PAGE_URL = 'about:blank';
      document.body.innerHTML = '<div class="cheese-logpower-popup-layer"><div class="cheese-logpower-popup-container" id="box" style="width:340px"></div></div>';
      const table = document.createElement('div');
      table.className = 'cheese-logpower-popup-table';
      ${template}
      document.getElementById('box').append(table);
      const notice = table.querySelector('.cheese-logpower-popup-notice');
      notice.textContent = '상위 10개 채널만 표시합니다.';
      ${toggleCode}
      window.state = () => {
        const btn = table.querySelector('.cheese-logpower-popup-info-toggle');
        const info = table.querySelector('.cheese-logpower-popup-info');
        const r = btn.getBoundingClientRect();
        const label = table.querySelector('.cheese-logpower-popup-top-label').getBoundingClientRect();
        return { expanded: btn.getAttribute('aria-expanded'), shown: info.getBoundingClientRect().height > 0, text: info.innerText,
          btn: { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }, beside: Math.abs((r.top + r.bottom) / 2 - (label.top + label.bottom) / 2) < 4 && r.left >= label.right - 1,
          rowsAfter: !!info.nextElementSibling && info.compareDocumentPosition(table.querySelector('.cheese-logpower-popup-rows')) === Node.DOCUMENT_POSITION_FOLLOWING };
      };
      return true;
    })()`);
    const closed = await ev("state()");
    check(closed.expanded === "false" && !closed.shown, `기본은 접혀 안내가 보이지 않는다 ${JSON.stringify(closed)}`);
    check(closed.beside, `(i)는 'TOP N 합계' 이름 바로 옆에 있다 ${JSON.stringify(closed.btn)}`);
    const click = async ({ x, y }) => {
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
    };
    await click(closed.btn);
    const open = await ev("state()");
    check(open.expanded === "true" && open.shown &&
      /^상위 10개 채널만 표시합니다\.\n100 파워 이상 보유한 채널만 표시합니다\.\n비활성화된 채널은 회색으로 표시됩니다\.\n표시 개수는 설정의 통나무파워 탭에서 조절할 수 있습니다\.$/.test(open.text),
      `(i)를 누르면 표시 개수 안내와 세 줄 안내를 펼친다 ${JSON.stringify(open.text)}`);
    check(open.rowsAfter, "펼친 안내는 목록 위(합계 줄 아래)에 놓인다");
    await click(open.btn);
    const again = await ev("state()");
    check(again.expanded === "false" && !again.shown, "다시 누르면 접힌다");
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
