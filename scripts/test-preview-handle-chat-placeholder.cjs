// 작은 화면 조정 두 가지(헤드리스 크롬 + 실제 content.css).
// 1) 사이드바 라이브 미리보기의 크기 조절 핸들은 영상 위에 커서가 있거나 끄는 중에만 보인다.
// 2) '채팅 입력창 안내 문구 숨김' 옵션을 켜면 '채팅을 입력해주세요 (J)' 문구가 보이지 않는다.
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "preview-handle-"));
const browser = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buffer = "",
  seq = 0;
const pending = new Map();
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\0")) >= 0;) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const msg = JSON.parse(raw),
      job = pending.get(msg.id);
    if (!job) continue;
    pending.delete(msg.id);
    msg.error
      ? job.reject(Error(JSON.stringify(msg.error)))
      : job.resolve(msg.result);
  }
});
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });

const assert = require("node:assert/strict");
const checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };

(async () => {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (m, p) => call(m, p, sessionId);
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await cmd("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  const css = readFileSync(join(ROOT, "src/content.css"), "utf8");
  await ev(`(()=>{
    const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);
    document.body.style.margin='0';
    document.body.insertAdjacentHTML('beforeend',
      '<div id="cheese-follow-preview" style="position:fixed;left:300px;top:100px;width:320px">'+
      '<div class="cheese-follow-preview-header" style="height:40px"></div>'+
      '<div class="cheese-follow-preview-body" style="position:relative;height:180px;background:#000">'+
      '<span class="cheese-follow-preview-resize"></span></div></div>'+
      '<aside id="aside-chatting"><textarea placeholder="채팅을 입력해주세요 (J)"></textarea></aside>');
  })()`);
  const opacity = () => ev(`getComputedStyle(document.querySelector('.cheese-follow-preview-resize')).opacity`);
  const move = (x, y) => cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  await move(50, 50); await settle();
  check(await opacity() === "0", "평소에는 크기 조절 핸들이 보이지 않는다(영상을 가리지 않는다)");
  await move(450, 200); await settle();
  check(await opacity() === "1", "영상 위에 커서를 올리면 핸들이 보인다");
  await move(450, 120); await settle();
  check(await opacity() === "0", "제목 줄(영상 밖)에서는 보이지 않는다");
  await ev(`document.getElementById('cheese-follow-preview').classList.add('is-resizing')`);
  await move(50, 50); await settle();
  check(await opacity() === "1", "끄는 동안에는 커서가 영상 밖으로 나가도 보인다");
  check(await ev(`getComputedStyle(document.querySelector('.cheese-follow-preview-resize')).pointerEvents`) !== "none",
    "숨겨져 있어도 그 자리를 끌면 크기가 바뀐다");

  const placeholder = () => ev(`getComputedStyle(document.querySelector('textarea'),'::placeholder').color`);
  check(await placeholder() !== "rgba(0, 0, 0, 0)", "옵션이 꺼져 있으면 안내 문구가 그대로 보인다");
  const heightOff = await ev(`document.querySelector('textarea').getBoundingClientRect().height`);
  await ev(`document.documentElement.classList.add('cheese-chat-hide-input-placeholder')`);
  check(await placeholder() === "rgba(0, 0, 0, 0)", "옵션을 켜면 '채팅을 입력해주세요 (J)' 문구가 보이지 않는다");
  check(await ev(`document.querySelector('textarea').getBoundingClientRect().height`) === heightOff,
    "입력창 크기·자리는 그대로다");

  const content = readFileSync(join(ROOT, "src/content.js"), "utf8");
  const settingsHtml = readFileSync(join(ROOT, "settings.html"), "utf8");
  check(/chatHideInputPlaceholder: false,/.test(content) &&
    /"cheese-chat-hide-input-placeholder",\s*featureFlags\.chatHideInputPlaceholder === true,/.test(content) &&
    /채팅 입력창 안내 문구 숨김[\s\S]{0,600}data-feature="chatHideInputPlaceholder"/.test(settingsHtml),
    "설정(기본 꺼짐)을 바꾸면 바로 반영된다");
  check(/el\.classList\.add\("is-resizing"\);/.test(content) && /el\.classList\.remove\("is-resizing"\);/.test(content),
    "미리보기 크기 조절을 시작·끝낼 때 상태를 표시한다");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})()
  .catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(() => { browser.kill("SIGTERM"); try { rmSync(dir, { recursive: true, force: true }); } catch {} });
