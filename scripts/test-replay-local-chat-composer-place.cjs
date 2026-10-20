// 다시보기 채팅 입력창(우리 것)은 채팅 목록 아래(헤더·목록과 같은 세로 줄 맨 끝)에 붙는다.
// 실측: 치지직이 aside 와 _container_ 사이에 감싸는 층(_stack_, position:absolute)을 넣어
// 'aside 바로 아래 _container_' 를 못 찾고 aside 에 붙어, 입력창이 헤더 자리에 겹쳐 보였다.
// 원본 함수(findList·composerContainer)를 실제 브라우저 DOM 에서 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "replayLocalChat.js"), "utf8");
const sliceFn = (name) => {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf("\n    }\n", start);
  assert.ok(start >= 0 && end > start, `${name} 를 찾지 못했다`);
  return source.slice(start, end + 6);
};
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
check(/const container = composerContainer\(aside\);\s*if \(!container\.querySelector\("\.live_chatting_area"\)\) container\.append\(composer\);/.test(source),
  "입력창을 붙일 자리는 composerContainer 가 정한다");

const NEW = `<aside id="vod-aside"><div class="_stack_vozox_26" style="position:absolute;inset:0;display:flex;flex-direction:column">
  <div class="_container_61avy_2" style="display:flex;flex-direction:column;height:100%">
    <div class="_header_61avy_9"><span class="_content_hd_1">헤더 안 _content_</span></div>
    <div class="_content_61avy_60" style="flex:1"><div class="_list_61avy_70"></div></div>
  </div></div></aside>`;
const OLD = `<aside id="vod-aside"><div class="_container_abc_2"><div class="_header_abc_9"></div>
  <div class="_content_abc_60"><div class="_list_abc_70"></div></div></div></aside>`;

const dir = mkdtempSync(path.join(tmpdir(), "cheese-composer-"));
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let buf = "";
let seq = 0;
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buf += chunk;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
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
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});

(async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const place = (html) => ev(`(() => {
      ${sliceFn("findList")}
      ${sliceFn("composerContainer")}
      document.body.innerHTML = ${JSON.stringify(html)};
      const aside = document.getElementById("vod-aside");
      const container = composerContainer(aside);
      const form = document.createElement("form");
      form.className = "cheese-replay-local-chat-composer";
      form.style.height = "40px";
      container.append(form);
      const header = aside.querySelector("[class*='_header_']").getBoundingClientRect();
      const content = aside.querySelector("[class*='_content_'] > [class*='_list_']").parentElement.getBoundingClientRect();
      const box = form.getBoundingClientRect();
      return { parent: container.className.split(" ")[0], afterList: box.top >= content.bottom - 1, belowHeader: box.top >= header.bottom };
    })()`);
    const now = await place(NEW);
    check(now.parent === "_container_61avy_2" && now.afterList && now.belowHeader,
      `바뀐 구조(aside > _stack_ > _container_): 목록 아래에 붙는다(헤더에 겹치지 않는다) ${JSON.stringify(now)}`);
    const before = await place(OLD);
    check(before.parent === "_container_abc_2" && before.afterList, `예전 구조도 그대로 ${JSON.stringify(before)}`);
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
