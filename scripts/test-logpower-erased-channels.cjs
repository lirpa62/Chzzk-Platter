// 통나무파워 지우개로 숨긴 채널(hiddenChannels)을 내역 페이지에서도 뺀다.
//
// 상위 보유 팝업·전용 팔로잉은 이미 숨긴 채널을 뺐지만, 내역 페이지(logPowerStats.js)는 이 목록을
// 읽지 않아 상위 10 막대와 기록에 숨긴 채널이 그대로 나왔다. 지금은 보유량(상위 10)과 기록(카드·
// 내역·차트) 모두에서 빼고, 실제로 빠진 채널이 있으면 합계·추이·순위에 오차가 있을 수 있다고 알린다.
// 화면에서만 거른다 — 저장된 기록(cheeseLogPowerLog)은 그대로다.
//
// 실제 logPowerStats.html 을 헤드리스로 열고 chrome.storage·보유량 API 만 가짜로 넣는다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const vm = require("node:vm");
const inbox = require("node:fs").readFileSync(path.join(ROOT, "src/inboxLogPower.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const now = Date.now();
const LOG = [
  { id: "a1", at: now - 3600e3, channelId: "chA", channelName: "보이는채널", amount: 120, claimType: "WATCH_1_HOUR" },
  { id: "h1", at: now - 1800e3, channelId: "chHidden", channelName: "은퇴한채널", amount: 300, claimType: "WATCH_1_HOUR" },
  { id: "b1", at: now - 900e3, channelId: "chB", channelName: "다른채널", amount: 80, claimType: "WATCH_1_HOUR" },
];
const BALANCES = [
  { channelId: "chHidden", channelName: "은퇴한채널", amount: 90000 },
  { channelId: "chA", channelName: "보이는채널", amount: 5000 },
  { channelId: "chB", channelName: "다른채널", amount: 3000 },
];

const STUB = `
  (() => {
    const store = ${JSON.stringify({ cheeseLogPowerLog: LOG, hiddenChannels: ["chHidden"] })};
    const listeners = [];
    const pick = (keys) => {
      if (keys == null) return { ...store };
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in store ? store[k] : d]));
    };
    const local = {
      get(keys, cb) { const r = pick(keys); if (cb) { cb(r); return; } return Promise.resolve(r); },
      set(obj, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
        listeners.forEach((fn) => fn(changes, "local"));
        if (cb) cb(); return Promise.resolve();
      },
      remove(keys, cb) { [].concat(keys).forEach((k) => delete store[k]); if (cb) cb(); return Promise.resolve(); },
    };
    window.__store = store;
    window.chrome = {
      storage: { local, session: local, onChanged: { addListener: (fn) => listeners.push(fn), removeListener() {} } },
      runtime: { sendMessage: (m, cb) => { cb && cb({ ok: true }); return Promise.resolve({ ok: true }); }, lastError: null, getURL: (p) => p, onMessage: { addListener() {} } },
    };
    const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    window.fetch = (url) => {
      url = String(url);
      if (url.includes("log-power/balances")) return json({ content: { data: ${JSON.stringify(BALANCES)} } });
      if (url.includes("user/getUserStatus")) return json({ content: { userIdHash: "" } });
      return json({ content: null });
    };
  })();
`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-lp-erased-"));
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
    await call("Page.enable", {}, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: STUB }, sessionId);
    await call("Page.navigate", { url: `file://${path.join(ROOT, "logPowerStats.html")}` }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const snapshot = () => ev(`new Promise((resolve) => setTimeout(() => {
      const note = document.getElementById('lpsErasedNote');
      const body = document.body.innerText;
      resolve({
        noteShown: note ? !note.hidden : null,
        note: note?.textContent || '',
        hiddenInPage: (body.match(/은퇴한채널/g) || []).length,
        visibleInPage: /보이는채널/.test(body) && /다른채널/.test(body),
        storedLog: window.__store.cheeseLogPowerLog.length,
        // 캔버스 차트는 글자로 안 잡히므로 Chart.js 라벨·데이터셋 이름을 직접 본다.
        chartLabels: [...document.querySelectorAll('canvas')].flatMap((canvas) => {
          const chart = window.Chart?.getChart?.(canvas);
          if (!chart) return [];
          return [...(chart.data.labels || []).map(String), ...(chart.data.datasets || []).map((d) => String(d.label || ''))];
        }),
      });
    }, 1500))`);
    const first = await snapshot();
    check(first.chartLabels.length > 0 && !first.chartLabels.some((l) => l.includes("은퇴한채널")) &&
      first.chartLabels.some((l) => l.includes("보이는채널")),
      `상위 10 막대·추이 차트에도 숨긴 채널이 없다 ${JSON.stringify(first.chartLabels)}`);
    check(first.hiddenInPage === 0 && first.visibleInPage,
      `숨긴 채널은 상위 10·기록·차트 어디에도 나오지 않고 나머지 채널은 그대로 ${JSON.stringify(first)}`);
    check(first.noteShown === true && /숨긴 채널 1개/.test(first.note) && /오차/.test(first.note),
      `숨긴 채널이 빠졌다는 것과 오차 가능성을 알린다 ${JSON.stringify(first.note)}`);
    check(first.storedLog === 3, "저장된 기록은 지우지 않는다(화면에서만 거름)");

    // 지우개에서 복구하면 열린 페이지에 바로 다시 나온다.
    await ev(`chrome.storage.local.set({ hiddenChannels: [] }), true`);
    const restored = await snapshot();
    check(restored.chartLabels.some((l) => l.includes("은퇴한채널")), "복구하면 차트에도 다시 나온다");
    check(restored.hiddenInPage > 0 && restored.noteShown === false,
      `지우개에서 복구하면 바로 다시 보이고 안내는 사라진다 ${JSON.stringify(restored)}`);

    // 다시 숨기면 바로 빠진다.
    await ev(`chrome.storage.local.set({ hiddenChannels: ['chHidden'] }), true`);
    const hiddenAgain = await snapshot();
    check(hiddenAgain.hiddenInPage === 0 && hiddenAgain.noteShown === true, "다시 숨기면 바로 빠진다");

    // 숨긴 목록에 있어도 내역·보유량에 없는 채널이면 안내하지 않는다.
    await ev(`chrome.storage.local.set({ hiddenChannels: ['chNotHere'] }), true`);
    const unrelated = await snapshot();
    check(unrelated.noteShown === false, "실제로 빠진 채널이 없으면 안내하지 않는다");
    // 치지직 수신함 > 통나무파워 탭도 같은 기준(원본 함수를 떼어 돌린다).
    const sliceFn = (name) => {
      const at = inbox.indexOf(`\n  function ${name}(`);
      assert.ok(at >= 0, `${name} 를 찾지 못했다`);
      return inbox.slice(at, inbox.indexOf("\n  }\n", at) + 4);
    };
    const ctx = vm.createContext({});
    vm.runInContext(`
      let entries = []; let erasedChannels = new Set(); let accountEntries = []; let erasedRemovedCount = 0;
      ${sliceFn("readErasedChannels")}${sliceFn("setAccountEntries")}${sliceFn("erasedNoteHtml")}
      this.run = (list, erased) => { readErasedChannels(erased); setAccountEntries(list);
        return { names: entries.map((e) => e.channelName), note: erasedNoteHtml(), kept: accountEntries.length }; };
    `, ctx);
    const inboxHidden = ctx.run(JSON.parse(JSON.stringify(LOG)), ["chHidden"]);
    check(JSON.stringify(inboxHidden.names) === JSON.stringify(["보이는채널", "다른채널"]) && /숨긴 채널 1개/.test(inboxHidden.note) &&
      /오차/.test(inboxHidden.note) && inboxHidden.kept === 3,
      `수신함 통나무파워 탭: 숨긴 채널 기록을 빼고 오차 안내, 원본 목록은 유지 ${JSON.stringify(inboxHidden)}`);
    const inboxNone = ctx.run(JSON.parse(JSON.stringify(LOG)), ["chNotHere"]);
    check(inboxNone.names.length === 3 && inboxNone.note === "", "수신함: 실제로 빠진 채널이 없으면 안내하지 않는다");
    check(/if \(changes\[ERASED_CHANNELS_KEY\] && !changes\[LOG_KEY\]\) \{[\s\S]*?setAccountEntries\(accountEntries\);[\s\S]*?renderSection\(\);/.test(inbox) &&
      /\|\$\{erasedRemovedCount\}`;/.test(inbox),
      "수신함: 지우개에서 숨기거나 복구하면 열린 탭에 바로 다시 그린다");
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
