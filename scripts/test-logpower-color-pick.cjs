// 통나무파워 내역: 채널 색을 직접 고르면 테마 버튼을 누르지 않아도 저장·반영된다. 페이지 글꼴은 Pretendard.
//
// 색 고르기 준비(Coloris 설정·change 를 받아 저장하고 차트 다시 그리기)가 toggleTheme 안에 있어, 테마 버튼을 한 번
// 누르기 전에는 직접 고른 색이 저장되지 않았다('프로필에서 색 추출' 뒤에 고쳐도 반영 안 됨). 누를 때마다 리스너도
// 하나씩 늘었다. 또 logPowerStats.css 의 body { font-family: inherit } 가 popup.css 의 Pretendard 를 덮었다(채팅
// 리캡도 같은 파일을 쓴다). 실제 logPowerStats.html 을 헤드리스로 띄워 본다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const src = fs.readFileSync(path.join(ROOT, "src/logPowerStats.js"), "utf8");
const at = src.indexOf("\n  function toggleTheme() {");
check(!/addEventListener\("change"/.test(src.slice(at, src.indexOf("\n  }\n", at))), "테마 전환 함수는 리스너를 붙이지 않는다");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheese-lps-color-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "";
  let seq = 0;
  const pending = new Map();
  browser.stdio[4].on("data", (chunk) => {
    buf += chunk;
    for (let i; (i = buf.indexOf("\0")) >= 0;) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const until = async (expression, label, tries = 60) => {
      for (let i = 0; i < tries; i++) {
        if (await ev(expression).catch(() => false)) return;
        await wait(80);
      }
      throw new Error(`기다림 실패: ${label} ${await ev("JSON.stringify(window.__errors || [])")}`);
    };
    const now = Date.now();
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
      window.__local = { cheeseLogPowerLog: [
        { id: 'a1', at: ${now - 3600000}, channelId: '${"a".repeat(32)}', channelName: '채널가', amount: 100, fiveMinAmount: 0, type: 'WATCH_1HOUR' },
        { id: 'b1', at: ${now - 7200000}, channelId: '${"b".repeat(32)}', channelName: '채널나', amount: 50, fiveMinAmount: 0, type: 'WATCH_1HOUR' },
      ] };
      const listeners = [];
      window.chrome = {
        storage: {
          local: {
            get: async (keys) => { const list = keys == null ? Object.keys(window.__local) : Array.isArray(keys) ? keys : [keys];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in window.__local).map((k) => [k, window.__local[k]])))); },
            set: async (values) => { Object.assign(window.__local, JSON.parse(JSON.stringify(values))); },
            remove: async () => {},
          },
          onChanged: { addListener: (fn) => listeners.push(fn) },
        },
        runtime: { getURL: (f) => f, lastError: null, sendMessage: (m, cb) => { const r = { ok: false }; cb && cb(r); return Promise.resolve(r); }, onMessage: { addListener() {} } },
      };
    ` }, sessionId);
    await call("Page.navigate", { url: `file://${path.join(ROOT, "logPowerStats.html")}` }, sessionId);
    await until("document.querySelectorAll('#lpsColorList [data-color-for]').length >= 1", "채널 색 목록");
    const font = await ev(`({ body: getComputedStyle(document.body).fontFamily, button: getComputedStyle(document.querySelector('button')).fontFamily })`);
    check(/^Pretendard/.test(font.body) && /^Pretendard/.test(font.button), `통나무파워 내역 글꼴은 Pretendard(버튼도) ${JSON.stringify(font)}`);
    // 테마 버튼을 누르지 않고 색을 고른다(Coloris 는 고른 뒤 change 를 보낸다)
    const name = await ev("document.querySelector('#lpsColorList [data-color-for]').dataset.colorFor");
    await ev(`(() => { const i = document.querySelector('#lpsColorList [data-color-for]'); i.value = '#123456'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await wait(150);
    const saved = await ev(`({ color: (window.__local.cheeseLogPowerChartColors || {})[${JSON.stringify(name)}], custom: window.__local.cheeseLogPowerChartColorsCustom || [] })`);
    check(saved.color === "#123456" && saved.custom.includes(name), `테마 버튼을 누르지 않아도 직접 고른 색을 저장한다 ${JSON.stringify(saved)}`);
    // 테마를 두 번 바꿔도 한 번만 저장(리스너가 늘지 않는다)
    let sets = 0;
    await ev(`(() => { const set = chrome.storage.local.set; window.__sets = 0; chrome.storage.local.set = async (v) => { if ('cheeseLogPowerChartColors' in v) window.__sets++; return set(v); }; return true; })()`);
    await ev("document.getElementById('lpsTheme').click(); document.getElementById('lpsTheme').click(); true");
    await ev(`(() => { const i = document.querySelector('#lpsColorList [data-color-for]'); i.value = '#654321'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await wait(150);
    sets = await ev("window.__sets");
    check(sets === 1 && (await ev(`window.__local.cheeseLogPowerChartColors[${JSON.stringify(name)}]`)) === "#654321",
      `테마를 바꿔도 색 고르기는 한 번만 처리한다(리스너가 늘지 않음) 저장 ${sets}회`);
    check((await ev("JSON.stringify(window.__errors)")) === "[]", "오류 없음");
  } finally {
    browser.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
