// 다시보기 채팅 입력창(일반 다시보기·멀티뷰 공용 bindComposer) 높이.
//
// 크롬은 빈 입력창의 scrollHeight 에 안내 문구까지 넣어 잰다. 채팅창이 좁아 안내 문구가 접히면
// 빈 입력창이 40·60px 로 커졌다(광고 중 잠금 문구는 길어 보통 폭에서도). 비어 있으면 한 줄로
// 두고, 글자가 있을 때만 내용에 맞춘다. 글자가 있는 채로 폭이 바뀌면 다시 맞춘다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-rlc-h-"));
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
    // 일반 다시보기 시작 코드는 이 빈 페이지에서도 돌지만, 다시보기 주소가 아니라 아무것도 붙이지 않는다.
    await ev(readFileSync(path.join(ROOT, "src/replayLocalChat.js"), "utf8"));
    const r = await ev(`(async () => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(readFileSync(path.join(ROOT, "src/replayLocalChat.css"), "utf8"))};
      document.head.append(style);
      document.body.innerHTML = '<aside id="vod-aside" style="width:110px"><form class="cheese-replay-local-chat-composer">' +
        '<div class="cheese-replay-local-chat-input-container"><textarea class="cheese-replay-local-chat-input" rows="1" placeholder="다시보기 채팅 입력"></textarea></div>' +
        '<button type="submit">채팅</button></form></aside>';
      const form = document.querySelector('form'), input = document.querySelector('textarea'), button = document.querySelector('button');
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      CheeseReplayLocalChat.bindComposer({ form, input, button, onSend() {} });
      const h = () => Math.round(input.getBoundingClientRect().height);
      const out = { placeholderWouldWrap: input.scrollWidth < 140 };
      out.empty = h();
      CheeseReplayLocalChat.setComposerBlocked(form, true);
      out.blocked = h();
      CheeseReplayLocalChat.setComposerBlocked(form, false);
      input.value = '여러 줄이 되도록 꽤 긴 다시보기 채팅을 입력해 봅니다';
      input.dispatchEvent(new Event('input'));
      out.typed = h();
      document.getElementById('vod-aside').style.width = '600px';
      await frame();
      out.widened = h();
      document.getElementById('vod-aside').style.width = '110px';
      await frame();
      out.narrowed = h();
      input.value = '';
      input.dispatchEvent(new Event('input'));
      out.cleared = h();
      return out;
    })()`);
    check(r.placeholderWouldWrap && r.empty === 20, "좁은 채팅창에서도 빈 입력창은 한 줄(안내 문구가 접혀도 커지지 않는다)");
    check(r.blocked === 20, "광고 중 잠금 문구(긴 안내)여도 한 줄");
    check(r.typed > 20 && r.typed <= 60, "글을 쓰면 줄 수만큼 커진다(최대 60px)");
    check(r.widened === 20 && r.narrowed === r.typed, "글이 있는 채로 폭이 바뀌면 높이를 다시 맞춘다");
    check(r.cleared === 20, "지우면 다시 한 줄");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  // 채팅창 너비 조절의 입력창 높이 보정(40px !important)은 치지직 입력창만 대상으로 한다.
  // 다시보기 채팅창에는 우리 입력창만 있어 안내 문구('채팅')로 잘못 잡혀 40px 로 고정됐다.
  const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
  const native = content.match(/const NATIVE_CHAT_TEXTAREA =\s*"([^"]+)";/)?.[1] || "";
  check(native.includes(":not(.cheese-replay-local-chat-input)") && native.includes(":not(.mv-vod-chat-compose-input)") &&
    /function normalizeChatInputHeight\(aside\) \{\s*if \(!\(aside instanceof HTMLElement\)\) return;\s*const textarea = findNativeChatTextarea\(aside\);/.test(content) &&
    content.includes("aside.querySelector(NATIVE_CHAT_TEXTAREA) : null;") &&
    !/aside\.querySelector\("textarea(\[[^"]*)?"\)/.test(content.slice(content.indexOf("function normalizeChatInputHeight"), content.indexOf("function applyChatLayout"))),
    "채팅창 너비 조절의 입력창 높이 보정은 다시보기 채팅 입력창을 건드리지 않는다");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
