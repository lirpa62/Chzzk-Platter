// 통나무파워 상위 보유 팝업: '팝업 높이를 표시 개수에 맞추기'(기본 꺼짐).
//
// 예전에는 목록 높이가 240px(5명 남짓)로 고정이라 표시 개수를 늘려도 스크롤해야 했다. 옵션을 켜면
// 보이는 줄 수만큼(최대 10명) 목록을 늘리고, 그보다 많으면 10명 높이에서 스크롤한다. 끄면 그대로다.
// 실제 content.css 와 content.js 의 fitLogPowerPopupRows 를 헤드리스 Chrome 에서 돌린다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const css = read("src/content.css");
const settings = read("src/settings.js");
const html = read("settings.html");
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

check(settings.includes('["[data-logpower-popup-auto-height]", "cheeseLogPowerPopupAutoHeight", false]') &&
  /data-logpower-popup-auto-height/.test(html) && /"cheeseLogPowerPopupAutoHeight",/.test(settings),
  "설정 > 통나무파워: '팝업 높이를 표시 개수에 맞추기' 기본 꺼짐, 백업·미리 읽기 목록에 있다");
check(/getStoredLogPowerPopupAutoHeight\(\),\s*\]\)\s*\.then\(\(\[data, initialLimit, hiddenChannels, initialAutoHeight\]\)/.test(content) &&
  /rowsBox\.innerHTML = renderRows\(rows\);\s*fitLogPowerPopupRows\(rowsBox, autoHeight\);/.test(content) &&
  /changes\[LOGPOWER_POPUP_AUTO_HEIGHT_KEY\]/.test(content),
  "팝업을 열 때 설정을 읽고, 그릴 때마다 높이를 맞추며, 열린 동안 설정이 바뀌면 바로 반영한다");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-lp-popup-"));
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
      const LOGPOWER_POPUP_AUTO_HEIGHT_MAX_ROWS = 10;
      ${sliceFn(content, "fitLogPowerPopupRows")}
      window.fit = fitLogPowerPopupRows;
      // 채팅 영역(높이 800px) 안에 뜨는 팝업 구조를 그대로 둔다.
      document.body.innerHTML = '<div style="position:relative;width:360px;height:800px"><div class="cheese-logpower-popup-layer"><div class="cheese-logpower-popup-container"><div class="cheese-logpower-popup-table"><div class="cheese-logpower-popup-rows" id="rows"></div></div></div></div></div>';
      window.measure = (count, auto) => {
        const rows = document.getElementById('rows');
        rows.innerHTML = Array.from({ length: count }, (_, i) =>
          '<div class="cheese-logpower-popup-row"><div class="cheese-logpower-popup-row-left"><img style="width:28px;height:28px"><span>채널' + i + '</span></div><span>1,000</span></div>').join('');
        fit(rows, auto);
        const box = rows.getBoundingClientRect();
        const visible = [...rows.children].filter((row) => row.getBoundingClientRect().bottom <= box.bottom + 0.5).length;
        return { height: Math.round(box.height), visible, scrolls: rows.scrollHeight > rows.clientHeight + 1 };
      };
      return true;
    })()`);
    const off12 = await ev("measure(12, false)");
    check(off12.height === 240 && off12.scrolls, `꺼짐: 지금처럼 240px 에서 스크롤 ${JSON.stringify(off12)}`);
    const on7 = await ev("measure(7, true)");
    check(on7.visible === 7 && !on7.scrolls, `켬 + 7명: 스크롤 없이 7명이 다 보인다 ${JSON.stringify(on7)}`);
    const on10 = await ev("measure(10, true)");
    check(on10.visible === 10 && !on10.scrolls, `켬 + 10명: 스크롤 없이 10명 ${JSON.stringify(on10)}`);
    const on12 = await ev("measure(12, true)");
    check(on12.visible === 10 && on12.scrolls, `켬 + 12명: 10명까지 보이고 나머지는 스크롤 ${JSON.stringify(on12)}`);
    const on5 = await ev("measure(5, true)");
    check(on5.height <= 240 && !on5.scrolls, `켬 + 5명 이하: 기본 높이 그대로 ${JSON.stringify(on5)}`);
    const offAgain = await ev("measure(12, false)");
    check(offAgain.height === 240, "다시 끄면 기본 높이로 돌아간다");
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
