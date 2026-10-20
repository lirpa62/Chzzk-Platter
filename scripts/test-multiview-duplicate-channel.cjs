// 멀티뷰 탭 여러 개(2026-10-19): 채널 관리에서 다른 멀티뷰 탭이 보고 있는 채널을 넣으려 하면 먼저 묻는다.
// 같은 채널을 두 곳에서 재생하면 소리가 겹치고 시청자 수가 중복으로 잡힌다. 다른 탭 목록은 배경이 안다
// (치지직 페이지 위 시청 화면 → MULTIVIEW_HOST_API others.channels). 원본 함수를 그대로 떼어 브라우저에서 돌린다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 60000).unref();

const ROOT = path.join(__dirname, "..");
const watch = readFileSync(path.join(ROOT, "src/multiviewWatch.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/multiview.css"), "utf8");
const fn = (name) => {
  const at = watch.indexOf(`  ${name.startsWith("async") ? name : `function ${name}`}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return watch.slice(at, watch.indexOf("\n  }\n", at) + 4);
};
const CODE = fn("async function confirmElsewhereChannel") + fn("askElsewhereChannel");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-dup-"));
  const browser = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
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
    await ev(`(() => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      window.HOSTED_ON_CHZZK = true;
      window.__apiCalls = [];
      window.__others = [{ channelId: 'c1', channelName: '채널하나' }];
      window.hostApi = async (op) => { __apiCalls.push(op); if (window.__apiFail) throw new Error('x'); return window.__others; };
      window.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      (0, eval)(${JSON.stringify(CODE)} + '; window.confirmElsewhereChannel = confirmElsewhereChannel;');
      return true;
    })()`);
    // 겹치지 않는 채널은 묻지 않는다
    check(await ev("confirmElsewhereChannel({ channelId: 'c2' })") === true &&
      await ev("!document.getElementById('mvElsewhereDialog') && __apiCalls.join() === 'others.channels'"),
      "다른 멀티뷰 탭에 없는 채널은 묻지 않고 넣는다(배경에 others.channels 로 묻는다)");
    // 겹치면 확인 창 — 그래도 추가
    await ev("window.__p = confirmElsewhereChannel({ channelId: 'c1' }); true");
    await new Promise((r) => setTimeout(r, 50));
    const shown = await ev(`(() => { const d = document.getElementById('mvElsewhereDialog');
      return { open: !!d?.open, text: d?.textContent || '', buttons: [...(d?.querySelectorAll('button') || [])].map((b) => b.textContent) }; })()`);
    check(shown.open && shown.text.includes("채널하나 채널은 다른 멀티뷰 탭에서 이미 시청 중입니다") &&
      shown.text.includes("소리가 겹치고 시청자 수가 중복") && shown.buttons.join() === "취소,그래도 추가",
      `겹치면 '이미 시청 중인 채널' 확인 창 ${JSON.stringify(shown)}`);
    await ev("document.querySelector('#mvElsewhereDialog button[value=\"add\"]').click(); true");
    check(await ev("window.__p") === true && await ev("!document.getElementById('mvElsewhereDialog')"), "'그래도 추가'면 넣는다(창은 치운다)");
    // 취소
    await ev("window.__p = confirmElsewhereChannel({ channelId: 'c1', channelName: '내가 고른 이름' }); true");
    await new Promise((r) => setTimeout(r, 50));
    check(await ev("document.getElementById('mvElsewhereDialog').textContent.includes('내가 고른 이름')"), "후보의 채널 이름을 먼저 쓴다");
    await ev("document.querySelector('#mvElsewhereDialog button[value=\"cancel\"]').click(); true");
    check(await ev("window.__p") === false, "취소면 넣지 않는다");
    // 물어볼 수 없으면 그냥 넣는다(확장 페이지 시청 화면·배경 응답 실패)
    await ev("window.__apiFail = true; true");
    check(await ev("confirmElsewhereChannel({ channelId: 'c1' })") === true, "배경에 묻지 못하면 막지 않는다");
    await ev("window.__apiFail = false; window.HOSTED_ON_CHZZK = false; __apiCalls.length = 0; true");
    check(await ev("confirmElsewhereChannel({ channelId: 'c1' })") === true && await ev("__apiCalls.length === 0"),
      "치지직 페이지 위가 아니면(다른 탭 목록을 모른다) 묻지 않는다");
    check(/if \(!HOSTED_ON_CHZZK\) run\(\);\s*else void confirmElsewhereChannel\(picked \|\| \{ channelId: id \}\)\.then\(\(ok\) => ok && run\(\)\);/.test(watch),
      "채널 관리의 추가·교체가 이 확인을 거친다");
  } finally {
    await new Promise((resolve) => {
      browser.once("exit", resolve);
      browser.kill();
    });
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
