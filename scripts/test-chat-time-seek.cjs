// 다시보기 채팅 시간 클릭 이동(설정 - 채팅 시간 표시 > 시간을 누르면 그 장면으로 이동).
//
// 다시보기 채팅의 시간 글자에 그 채팅을 쓴 영상 위치(playerMessageTime)를 적어 두고, 누르면
// 고른 초만큼 앞으로 옮긴다. 기본은 꺼짐. 내 다시보기 채팅 줄도 같다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const ts = read("src/chatTimestamp.js");
const content = read("src/content.js");
const contentCss = read("src/content.css");
const local = read("src/replayLocalChat.js");
const html = read("settings.html");
const settingsUi = read("src/settingsUi.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const seekCode = ts.slice(ts.indexOf("  function setChatTimePlayerMs("), ts.indexOf("  function removeAllTimestamps("));
const seekCss = contentCss.slice(
  contentCss.indexOf("/* 다시보기 채팅 시간 클릭 이동"),
  contentCss.indexOf("html.cheese-chat-time-custom-color .cheese-chat-time {"),
);

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-time-seek-"));
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
      style.textContent = ${JSON.stringify(seekCss)};
      document.head.append(style);
      document.body.innerHTML =
        '<div id="player_layout"><video></video></div>' +
        '<aside id="vod-aside"><div class="_item_" id="row"><div class="_chatting_message_">' +
        '<span class="cheese-chat-time" id="time">20:01:15</span><button class="_nickname_">닉</button><span>ㅋㅋ</span></div></div>' +
        '<div class="cheese-replay-local-chat-message"><span class="cheese-chat-time" id="local" data-chat-player-ms="65000">20:00:00</span></div></aside>' +
        '<aside id="aside-chatting"><span class="cheese-chat-time" id="live" data-chat-player-ms="1000">20:00</span></aside>';
      const video = document.querySelector('video');
      window.__seek = null; window.__plays = 0; window.__rowClicks = 0;
      Object.defineProperty(video, 'currentTime', { get: () => 0, set: (v) => { window.__seek = v; } });
      video.play = () => { window.__plays++; return Promise.resolve(); };
      document.getElementById('row').addEventListener('click', () => window.__rowClicks++);
      ((location) => {
        ${seekCode}
        window.setChatTimePlayerMs = setChatTimePlayerMs;
        window.setChatTimeSeek = setChatTimeSeek;
      })({ pathname: '/video/1234' });
      // 다시보기 채팅 줄: 1:02:05(3725초)에 쓴 채팅.
      setChatTimePlayerMs(document.getElementById('time'), 3725000);
    })()`);
    const click = (id) => ev(`(() => { window.__seek = null; window.__rowClicks = 0;
      const el = document.getElementById(${JSON.stringify(id)});
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.click();
      return { seek: window.__seek, rowClicks: window.__rowClicks, title: el.title,
        cursor: getComputedStyle(el).cursor };
    })()`);

    const off = await click("time");
    check(off.seek === null && off.rowClicks === 1 && off.title === "" && off.cursor !== "pointer",
      `꺼져 있으면(기본) 아무 일도 없고 치지직 클릭도 그대로 ${JSON.stringify(off)}`);

    await ev(`document.documentElement.classList.add('cheese-chat-time-seek'); setChatTimeSeek(true, 3)`);
    const on = await click("time");
    check(on.seek === 3722 && on.rowClicks === 0 && on.cursor === "pointer",
      `켜면 그 채팅 시점보다 3초 앞으로 옮기고, 치지직 행 클릭으로 넘기지 않는다 ${JSON.stringify(on)}`);
    check(on.title === "영상 1:02:02로 이동", `마우스를 올리면 옮길 영상 위치를 알린다(표시 시간은 실제 시각) ${on.title}`);
    check(await ev("window.__plays") === 1, "옮긴 뒤 재생한다(댓글 타임스탬프와 같다)");

    await ev("setChatTimeSeek(true, 0)");
    check((await click("time")).seek === 3725, "이동 위치 '채팅 시점'은 그대로 옮긴다");
    await ev("setChatTimeSeek(true, 10)");
    check((await click("local")).seek === 55, "내 다시보기 채팅 줄도 옮긴다(10초 앞)");
    await ev("setChatTimeSeek(true, 99)");
    check((await click("time")).seek === 3722, "모르는 값이면 기본 3초");
    check((await click("live")).seek === null, "라이브 채팅창의 시간은 대상이 아니다");

    await ev("setChatTimePlayerMs(document.getElementById('time'), 2000); setChatTimeSeek(true, 5)");
    check((await click("time")).seek === 0, "영상 처음보다 앞으로는 가지 않는다");

    await ev("setChatTimeSeek(false, 3)");
    const offAgain = await ev(`({ title: document.getElementById('time').title })`);
    const clickedOff = await click("time");
    check(offAgain.title === "" && clickedOff.seek === null && clickedOff.rowClicks === 1,
      "끄면 안내를 걷고 다시 아무 일도 하지 않는다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  check(/const playerMs = location\.pathname\.startsWith\("\/video\/"\)\s*\? readVodPlayerMessageTime\(chatMessage\)\s*: null;\s*if \(!epoch \|\| !applyTimestamp\(row, epoch, playerMs\)\)/.test(ts),
    "다시보기 채팅 줄을 처리할 때 그 채팅의 영상 위치를 시간 글자에 적는다");
  check(/setChatTimeSeek\(f\.chatShowTime === true && f\.chatTimeSeek === true, e\.data\.chatTimeSeekOffset\);/.test(ts) &&
    /chatTimeSeekOffset, \/\/ 다시보기 채팅 시간 클릭 이동/.test(content) && /chatTimeSeek: false,/.test(content),
    "시간 표시가 켜져 있을 때만, 기본 꺼짐으로 동작하고 이동 위치를 함께 받는다");
  check(/const playerMs = String\(Math\.round\(message\.at \* 1000\)\);/.test(local),
    "내 다시보기 채팅 줄 시간에도 영상 위치를 적는다");
  check(["0", "3", "5", "10"].every((v) => html.includes(`data-chat-time-seek-offset-value="${v}"`)) &&
    settingsUi.includes(`['[data-feature="chatTimeSeek"]', "[data-chat-time-seek-offset]"]`) &&
    /\[data-chat-time-color-enabled\], \[data-feature="chatTimeSeek"\]/.test(settingsUi),
    "설정: 채팅 시간 표시 > 시간 클릭 이동 > 이동 위치(채팅 시점/3/5/10초 앞) 하위 옵션");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
