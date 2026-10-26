// 전용 팔로잉 그룹 영역 접기: 구분 모양이 '상자' 여도 그룹들이 접힌다.
//
// 펼친 사이드바의 상자 모양 규칙(html[data-cheese-cf-group-style="box"] #sidebar… #cheese-custom-follow
// .cheese-cf-group-body {display:grid})은 id 가 들어 있어 접기 규칙(.cheese-cf-groups.is-collapsed
// .cheese-cf-group-body {display:none})보다 우선순위가 높았다. 그래서 상자 모양에서 그룹 영역을 접으면 더보기
// 막대만 사라지고 그룹들은 그대로 보였다. 실제 content.css 로 세 모양 × 펼침/접힘을 잰다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const css = readFileSync(path.join(__dirname, "..", "src/content.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-cf-box-"));
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
    const shown = (style, collapsed, sidebarExpanded = true) => ev(`(() => {
      document.head.querySelector('style')?.remove();
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      document.documentElement.dataset.cheeseCfGroupStyle = ${JSON.stringify(style)};
      document.body.innerHTML = '<aside id="sidebar" class="${sidebarExpanded ? "_is_expanded_x" : ""}"><nav><div id="cheese-custom-follow">' +
        '<div class="cheese-cf-groups${collapsed ? " is-collapsed" : ""}"><div class="cheese-cf-group-toolbar">그룹</div>' +
        '<div class="cheese-cf-area-more-bar" id="more"><button>더보기</button></div>' +
        '<div class="cheese-cf-group-body" id="body"><section class="cheese-cf-group">그룹 A</section><section class="cheese-cf-group">그룹 B</section></div>' +
        '</div></div></nav></aside>';
      const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
      return { body: vis('body'), more: vis('more') };
    })()`);
    for (const style of ["line", "box", "divider"]) {
      const open = await shown(style, false);
      const closed = await shown(style, true);
      check(open.body && open.more, `${style}: 펼치면 그룹과 더보기가 보인다 ${JSON.stringify(open)}`);
      check(!closed.body && !closed.more, `${style}: 접으면 그룹과 더보기가 모두 숨는다 ${JSON.stringify(closed)}`);
    }
    const narrow = await shown("box", true, false);
    check(!narrow.body, "접힌 사이드바(상자)에서도 접힌 그룹 영역은 숨는다");
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
