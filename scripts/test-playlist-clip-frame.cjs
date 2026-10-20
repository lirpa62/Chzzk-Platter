// 클립 재생 프레임(m.naver.com/shorts, clipButtonHide.js)의 재생목록 몫.
//   - 상위가 보낸 상태(on·uid·inList)대로 좋아요 버튼 위에 '재생목록' 버튼(치지직 버튼 모양 harvest)
//   - 누르면 버튼 위치·채널 정보를 상위에 보낸다(상위가 팝오버를 띄운다)
//   - 재생목록 재생 중(playing)이면 지금 클립의 끝(ended 또는 끝→처음 되감기)을 상위에 알린다
// 실제 clipButtonHide.js 를 헤드리스 Chrome 에서 돌린다(상위 = 같은 창, postMessage 를 엿본다).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 60000).unref();

const source = fs.readFileSync(path.join(__dirname, "..", "src", "clipButtonHide.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const FIXTURE = `
  <div data-testid="ContentCardPlayer" id="card" style="position:absolute;top:0;left:0;width:400px;height:800px">
    <video id="v"></video>
    <a class="ProfileView-module__channel__x" href="https://chzzk.naver.com/${"e".repeat(32)}"><strong class="ProfileView-module__name__x">프레임채널</strong></a>
    <div class="tools">
      <div class="ToolButtonView-module__box__x"><button class="ToolButtonView-module__button__x type_like">
        <span class="ToolButtonView-module__icon_wrap__x"><svg class="ToolButtonView-module__icon__x"></svg></span>
        <span class="ToolButtonView-module__text__x">좋아요</span></button></div>
    </div>
  </div>
  <video id="other"></video>`;

const dir = mkdtempSync(path.join(tmpdir(), "cheese-playlist-frame-"));
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
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await call("Emulation.setDeviceMetricsOverride", { width: 400, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await ev(`(async () => {
      document.body.innerHTML = ${JSON.stringify(FIXTURE)};
      window.__posted = [];
      window.postMessage = (message, origin) => window.__posted.push({ message, origin });
      window.chrome = { storage: { local: { get: (k, cb) => { const v = {}; if (cb) cb(v); return Promise.resolve(v); } }, onChanged: { addListener() {} } } };
      const s = document.createElement("script"); s.textContent = ${JSON.stringify(source)}; document.head.append(s);
      await new Promise((r) => setTimeout(r, 50));
      return true;
    })()`);
    const send = (data) => ev(`(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://chzzk.naver.com', data: ${JSON.stringify({ type: "cheese-playlist-clip-state", ...data })} })); return true; })()`);
    const posted = (type) => ev(`window.__posted.filter((p) => p.message?.type === ${JSON.stringify(type)})`);

    check(await ev("!document.querySelector('.cheese-clip-playlist-btn')"), "상위가 알려 주기 전에는 버튼이 없다(uid 를 모른다)");
    await send({ on: true, uid: "clipU1", inList: false, playing: false });
    const button = await ev(`(() => {
      const b = document.querySelector('.cheese-clip-playlist-btn');
      const slot = b?.closest('.cheese-clip-playlist-btn-slot');
      return b && { label: b.getAttribute('aria-label'), beforeLike: slot.nextElementSibling?.querySelector('.type_like') !== null,
        cls: b.className, wrap: b.querySelector('span')?.className, text: b.querySelector('.ToolButtonView-module__text__x')?.textContent };
    })()`);
    check(button && button.label === "재생목록에 담기" && button.beforeLike && !button.cls.includes("type_like") &&
      button.wrap === "ToolButtonView-module__icon_wrap__x" && button.text === "재생목록",
    `상위가 켜 주면 좋아요 버튼 위에 같은 모양(치지직 클래스 harvest)으로 버튼을 단다 ${JSON.stringify(button)}`);

    await ev("document.querySelector('.cheese-clip-playlist-btn').click(); true");
    const added = await posted("cheese-playlist-clip-add");
    check(added.length === 1 && added[0].origin === "https://chzzk.naver.com" && added[0].message.channelName === "프레임채널" &&
      added[0].message.channelId === "e".repeat(32) && Number.isFinite(added[0].message.rect.left) && added[0].message.rect.width > 0,
    `누르면 버튼 위치·채널 정보를 치지직 상위에만 보낸다 ${JSON.stringify(added[0]?.message)}`);

    await send({ on: true, uid: "clipU1", inList: true, playing: false });
    check(await ev("document.querySelector('.cheese-clip-playlist-btn').getAttribute('aria-label') === '재생목록에 담김' && document.querySelector('.cheese-clip-playlist-btn svg').style.color !== ''"),
      "담긴 클립이면 버튼이 담김 표시로 바뀐다");
    await ev("window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: 'cheese-playlist-clip-state', on: false } })); true");
    check(await ev("!!document.querySelector('.cheese-clip-playlist-btn')"), "치지직이 아닌 출처의 상태 메시지는 무시한다");
    await send({ on: false, uid: "", inList: false, playing: false });
    check(await ev("!document.querySelector('.cheese-clip-playlist-btn-slot')"), "상위가 끄면(설정 끔) 버튼을 치운다");

    // 끝 알림: 재생 중이 아니면 보내지 않는다
    const setTime = (id, t, d = 30) => ev(`(() => { const v = document.getElementById('${id}'); Object.defineProperty(v, 'duration', { value: ${d}, configurable: true });
      Object.defineProperty(v, 'currentTime', { value: ${t}, configurable: true }); v.dispatchEvent(new Event('timeupdate')); return true; })()`);
    await ev("document.getElementById('v').dispatchEvent(new Event('ended')); true");
    check((await posted("cheese-playlist-clip-ended")).length === 0, "재생목록 재생 중이 아니면 끝을 알리지 않는다");

    await send({ on: false, uid: "", inList: false, playing: true });
    await setTime("other", 29.5);
    await setTime("other", 0.1);
    check((await posted("cheese-playlist-clip-ended")).length === 0, "가운데 카드가 아닌(미리 불러 둔) 영상은 보지 않는다");
    await setTime("v", 12);
    await setTime("v", 29.4);
    await setTime("v", 0.2);
    check((await posted("cheese-playlist-clip-ended")).length === 1, "반복 재생이라 ended 가 없어도 끝→처음 되감기를 끝으로 알린다");
    await ev("document.getElementById('v').dispatchEvent(new Event('ended')); true");
    check((await posted("cheese-playlist-clip-ended")).length === 1, "같은 끝을 겹쳐 두 번 알리지 않는다(3초)");
    await wait(3100);
    await setTime("v", 10);
    await setTime("v", 3);
    check((await posted("cheese-playlist-clip-ended")).length === 1, "중간에서 뒤로 감은 건 끝이 아니다");
    await ev("document.getElementById('v').dispatchEvent(new Event('ended')); true");
    const ended = await posted("cheese-playlist-clip-ended");
    check(ended.length === 2 && ended.every((p) => p.origin === "https://chzzk.naver.com"), "ended 도 끝으로 알린다(치지직 상위에만)");
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
