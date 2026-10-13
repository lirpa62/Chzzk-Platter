// 채팅 시간 글자 크기(설정 '└ 시간 글자 크기', 메시지 글자 대비 70~130%, 기본 85%).
// 채팅 폰트 크기 배율을 바꾸면 고른 비율대로 함께 커지고 작아진다. 실제 브라우저에서
// 우리 CSS 를 그대로 넣고 시간 글자의 계산된 크기를 잰다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const vm = require("node:vm");

const root = join(__dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const CSS = ["src/content.css", "src/chatFontScale.css", "src/replayLocalChat.css"].map(read).join("\n");
const SRC = read("src/content.js");
const SETTINGS = read("src/settings.js");
const HTML = read("settings.html");

let failed = 0;
const ok = (condition, label) => {
  console.log(`${condition ? "  PASS" : "  FAIL"} ${label}`);
  if (!condition) failed += 1;
};

// 저장값 정리: 70~130, 5 단위, 없거나 이상하면 85.
{
  const start = SRC.indexOf("  const CHAT_TIME_SIZE_KEY =");
  const end = SRC.indexOf("  function applyChatTimeSize()", start);
  const ctx = {};
  vm.runInNewContext(`${SRC.slice(start, end)}\nglobalThis.n = normalizeChatTimeSize;`, Object.assign(ctx, { globalThis: ctx }));
  const cases = [[undefined, 85], [null, 85], ["", 85], ["abc", 85], [100, 100], [62, 70], [200, 130], [92, 90], [93, 95]];
  ok(cases.every(([v, want]) => ctx.n(v) === want), `저장값 정리(70~130, 5 단위, 기본 85): ${cases.map(([v]) => ctx.n(v)).join(",")}`);
}

const PAGE = `
<aside id="aside-chatting">
  <div class="_item_8lqsk_7"><div class="_container_w9pvh_1"><div class="_chatting_message_w9pvh_21" style="font-size:14px">
    <span class="cheese-chat-time" id="live">13:19</span><span class="_text_w9pvh_1">메시지</span>
  </div></div></div>
</aside>
<aside id="vod-aside" style="--cheese-replay-local-chat-scale: 1">
  <div class="cheese-replay-local-chat-content"><span class="cheese-chat-time" id="local">1:02:03</span></div>
</aside>`;

const dir = mkdtempSync(join(tmpdir(), "cheese-time-size-"));
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buf = "";
let seq = 0;
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buf += chunk;
  for (let end; (end = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, end);
    buf = buf.slice(end + 1);
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
    await ev(`document.open(); document.write(${JSON.stringify(PAGE)}); document.close();
      const st = document.createElement("style"); st.textContent = ${JSON.stringify(CSS)}; document.head.append(st); true`);
    // size: 시간 글자 비율(없으면 기본), scale: 채팅 폰트 크기 배율(없으면 조절 안 함), local: 다시보기 내 채팅 배율.
    const measure = ({ size, scale, local = 1 }) => ev(`(() => {
      const root = document.documentElement;
      ${size == null ? `root.style.removeProperty("--cheese-chat-time-size");` : `root.style.setProperty("--cheese-chat-time-size", "${size}");`}
      root.classList.toggle("cheese-chat-font-scale-enabled", ${scale != null});
      root.style.setProperty("--cheese-chat-font-scale", "${scale ?? 1}");
      document.getElementById("vod-aside").style.setProperty("--cheese-replay-local-chat-scale", "${local}");
      const px = (id) => Math.round(parseFloat(getComputedStyle(document.getElementById(id)).fontSize) * 100) / 100;
      return { live: px("live"), local: px("local") };
    })()`);

    let m = await measure({});
    ok(m.live === 11.9 && m.local === 11.9, `기본은 지금과 같다(메시지 14px 의 85% = 11.9px) ${JSON.stringify(m)}`);
    m = await measure({ size: 1 });
    ok(m.live === 14 && m.local === 14, `100% 로 고르면 메시지와 같다 ${JSON.stringify(m)}`);
    m = await measure({ size: 1.3 });
    ok(m.live === 18.2, `130% ${JSON.stringify(m)}`);
    m = await measure({ size: 1.1, scale: 1.5 });
    ok(m.live === 23.1, `채팅 폰트 크기 150% 에서는 고른 비율대로 함께 커진다(14 × 1.1 × 1.5 = 23.1px) ${JSON.stringify(m)}`);
    m = await measure({ scale: 1.5 });
    ok(m.live === 17.85, `비율을 고르지 않으면 폰트 크기 조절은 예전과 같다(14 × 0.85 × 1.5) ${JSON.stringify(m)}`);
    m = await measure({ size: 1.2, local: 1.25 });
    ok(m.local === 21, `다시보기 내 채팅 줄도 고른 비율 × 배율(14 × 1.2 × 1.25 = 21px) ${JSON.stringify(m)}`);
  } catch (error) {
    console.error(error);
    failed += 1;
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // 설정: '채팅 시간 표시' 하위, 슬라이더+숫자+기본값, 시간 표시가 꺼지면 잠금, 미리 읽기 목록.
  const timeRow = HTML.indexOf("data-chat-time-size-item");
  ok(timeRow > HTML.indexOf('data-feature="chatShowTime"') && timeRow < HTML.indexOf("data-chat-time-color-item"),
    "설정: '채팅 시간 표시' 하위(형식 다음, 색상 앞)에 둔다");
  ok(/type="range"\s+min="70"\s+max="130"\s+step="5"\s+data-chat-time-size\b/.test(HTML) &&
    /data-chat-time-size-num/.test(HTML) && /data-chat-time-size-reset/.test(HTML),
    "설정: 70~130% 슬라이더·숫자 입력·기본값 버튼");
  ok(/"\[data-chat-time-size\]", "\[data-chat-time-size-num\]", "\[data-chat-time-size-reset\]"\]\) \{\s*const el = document\.querySelector\(sel\);\s*if \(el\) el\.disabled = disabled;/.test(SETTINGS),
    "설정: 채팅 시간 표시가 꺼지면 함께 잠근다");
  ok(/"cheeseChatTimeSize",/.test(SETTINGS), "설정: 미리 읽기·내보내기 목록에 있다");
  ok(/\['\[data-feature="chatShowTime"\]', '[^']*\[data-chat-time-size\]/.test(read("src/settingsUi.js")),
    "설정: '채팅 시간 표시'의 하위로 등록(검색 경로·잠금)");

  if (failed) {
    console.log(`FAIL ${failed}`);
    process.exit(1);
  }
  console.log("전부 통과");
})();
