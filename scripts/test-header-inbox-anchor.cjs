// 헤더 수신함 버튼 찾기(재생목록·라운지 소식·수신함 커뮤니티 점의 기준).
// 2026-10-31 실측: 헤더 한 상자에 [캐시 링크, (우리)재생목록, 수신함, (우리)라운지, 링크, 버튼]. 읽지 않은 알림이 있으면
// 수신함 버튼에 .blind "New"·svg mask 가 있고, 읽으면 둘 다 사라져 이름 없는 버튼이 된다. 예전엔 그때 '캐시 링크와 같은
// 묶음의 첫 버튼' 규칙이 우리 재생목록 버튼을 집어 라운지 소식이 수신함 앞으로 옮겨 갔다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const content = readFileSync(path.join(__dirname, "..", "src/content.js"), "utf8");
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const header = (unread) => `<header id="header"><div class="_container_h"><div class="_section_h"><div class="_box_h">
  <div class="_item_h"><a class="_container_b" href="https://game.naver.com/profile#cash">캐시</a></div>
  <div class="_item_h cheese-playlist-header-item"><button id="cheese-playlist-header-button" class="_container_b"><span class="blind">나만의 재생목록</span></button></div>
  <div class="_item_h"><button class="_container_b" id="inbox">${unread ? '<svg><mask id="m"></mask></svg><span class="blind">New</span>' : "<svg></svg>"}</button></div>
  <div class="_item_h cheese-lounge-header-item"><button id="cheese-lounge-button" class="_container_b">라운지</button></div>
  <div class="_item_h"><a class="_container_b" href="#cheat_key">치트키</a></div>
  <div class="_item_h"><button class="_container_b" id="profile"><img></button></div>
</div></div></div></header>`;

const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
check(/const isOurs = \(button\) =>/.test(sliceFn("findHeaderInboxButton")), "확장이 넣은 버튼은 후보에서 뺀다");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-inbox-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "", seq = 0;
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
    const result = await ev(`(() => {
      const IS_CHZZK_STUDIO = false;
      const LOUNGE_BUTTON_ID = "cheese-lounge-button";
      ${sliceFn("isInsideProfilePopover")}
      ${sliceFn("findHeaderInboxButton")}
      const found = () => findHeaderInboxButton(document.getElementById('header'))?.id || null;
      const out = {};
      document.body.innerHTML = ${JSON.stringify(header(true))};
      out.unread = found();
      // 같은 버튼에서 'New'·mask 가 사라짐(치지직이 버튼은 두고 안쪽만 다시 그린다)
      document.getElementById('inbox').innerHTML = '<svg></svg>';
      out.afterRead = found();
      // 처음부터 읽은 상태(표시 없음)
      document.body.innerHTML = ${JSON.stringify(header(false))};
      out.freshRead = found();
      return out;
    })()`);
    check(result.unread === "inbox", "읽지 않은 알림('New'·mask)이 있으면 그 버튼 " + JSON.stringify(result));
    check(result.afterRead === "inbox", "알림을 읽어 'New'·mask 가 사라져도 같은 수신함 버튼(재생목록 버튼을 집지 않는다)");
    check(result.freshRead === "inbox", "처음부터 표시가 없어도 캐시 링크 묶음에서 확장 버튼을 건너뛰고 수신함을 찾는다");
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
