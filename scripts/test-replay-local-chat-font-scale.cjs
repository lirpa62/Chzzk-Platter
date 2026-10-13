// 다시보기 채팅 입력으로 쓴 로컬 채팅 줄의 글자 크기.
//
// 로컬 줄은 치지직 줄의 클래스(_chatting_message_·_scale_NNN_)가 없어 채팅 폰트 크기 조절과
// 치지직 채팅 글자 크기 설정을 따르지 않았다. 둘 다 CSS 변수로 받아 글자·줄높이·배지를 맞춘다.
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
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-rlc-fs-"));
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
    await ev(`(() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(readFileSync(path.join(ROOT, "src/replayLocalChat.css"), "utf8") +
        readFileSync(path.join(ROOT, "src/content.css"), "utf8").match(/\n\.cheese-chat-time \{[^}]*\}/)[0])};
      document.head.append(style);
      document.body.innerHTML = '<aside id="vod-aside"><div class="_item_ vod_chatting_item cheese-replay-local-chat-message" id="row">' +
        '<div class="cheese-replay-local-chat-content"><span class="cheese-chat-time" id="time">12:00</span>' +
        '<span class="cheese-replay-local-chat-identity"><span class="cheese-replay-local-chat-badges"><img class="cheese-replay-local-chat-badge" id="badge" width="18" height="18"></span>' +
        '<span class="cheese-replay-local-chat-nickname"><span class="cheese-replay-local-chat-nickname-text" id="nick">리르파</span></span></span>' +
        '<span class="cheese-replay-local-chat-text" id="text">안녕</span></div></div></aside>';
    })()`);
    const measure = () => ev(`(() => {
      const css = (id) => getComputedStyle(document.getElementById(id));
      // 실제 글자(첫 글자)가 상자 위에서 몇 px 아래에 그려지는지.
      const box = document.querySelector('.cheese-replay-local-chat-content').getBoundingClientRect();
      const top = (id) => { const n = document.getElementById(id).firstChild; const r = document.createRange();
        r.setStart(n, 0); r.setEnd(n, 1); return r.getClientRects()[0].top - box.top; };
      return { font: css('text').fontSize, line: css('text').lineHeight, time: css('time').fontSize,
        badge: css('badge').width, glyph: { time: top('time'), nick: top('nick'), text: top('text') } };
    })()`);
    const root = (code) => ev(`(() => { const r = document.documentElement; ${code} })()`);

    const base = await measure();
    console.log("  기본 배율 글자 위치", JSON.stringify(base.glyph));
    check(base.font === "14px" && base.line === "20px" && base.badge === "18px", "기본: 치지직 줄과 같은 14px / 20px, 배지 18px");

    await ev(`(() => { const row = document.getElementById('row');
      row.style.setProperty('--cheese-replay-local-chat-native-scale', '1.5'); row.classList.add('is-native-scaled'); })()`);
    const native = await measure();
    check(native.font === "21px" && native.line === "30px" && native.badge === "27px",
      "치지직 채팅 글자 크기(옆 줄 _scale_150_)를 따른다");

    await root(`r.classList.add('cheese-chat-font-scale-enabled'); r.style.setProperty('--cheese-chat-font-scale', '1.25');`);
    const ours = await measure();
    check(ours.font === "17.5px" && ours.line === "24.5px" && ours.badge === "22.5px" &&
      Math.abs(parseFloat(ours.time) - 17.5 * 0.85) < 0.01,
      "채팅 폰트 크기 조절이 켜져 있으면 그 배율(14px × 배율, 줄높이 × 1.4)을 따르고 시간도 함께 커진다");

    // 배율이 걸리면 치지직 줄처럼 닉네임·메시지를 세로 가운데로 맞춘다. 실측(1.3배): 치지직 줄은
    // 시간 10.5 / 닉네임 10.9 로 거의 같은 높이인데, 로컬 줄은 시간 8 / 닉네임·메시지 5.5 로
    // 시간만 2.5px 처졌다.
    await root(`r.style.setProperty('--cheese-chat-font-scale', '1.3');`);
    for (const [label, m] of [["채팅 폰트 크기 조절 1.3배", await measure()], ["치지직 글자 크기 1.5배", native]]) {
      check(Math.abs(m.glyph.time - m.glyph.nick) < 1.5 && Math.abs(m.glyph.text - m.glyph.nick) < 1,
        `${label}: 시간·닉네임·메시지 글자가 같은 높이에 온다 ${JSON.stringify(m.glyph)}`);
    }

    await root(`r.classList.remove('cheese-chat-font-scale-enabled'); r.classList.add('chzzk-badge-moa-chat-font-scale-enabled'); r.style.setProperty('--chzzk-badge-moa-chat-font-scale', '0.8');`);
    const moa = await measure();
    check(Math.abs(parseFloat(moa.font) - 11.2) < 0.01 && Math.abs(parseFloat(moa.badge) - 14.4) < 0.01,
      "배지 모아 챗이 글자 크기를 맡고 있으면 그 배율을 따른다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  const source = readFileSync(path.join(ROOT, "src/replayLocalChat.js"), "utf8");
  check(/function readNativeScale\(list\) \{[\s\S]{0,200}:not\(\[\$\{LOCAL_ROW_ATTR\}\]\) \[class\*='_chatting_message_'\][\s\S]{0,300}scale_\(\\d\+\)/.test(source) &&
    /applyLocalTimes\(visible\);\s*syncNativeScale\(\);/.test(source),
    "로컬 줄을 맞출 때마다 옆 치지직 줄의 글자 배율을 옮긴다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
