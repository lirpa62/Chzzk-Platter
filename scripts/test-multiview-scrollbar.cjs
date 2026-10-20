// 멀티뷰 두 화면(고르기·시청)에 빈 스크롤바가 늘 보이던 문제.
//
// popup.css 의 html { overflow-y: scroll; scrollbar-gutter: stable } 은 길게 스크롤하는 설정 화면용인데,
// 공통 색 변수 때문에 popup.css 를 함께 부르는 멀티뷰 화면에도 걸렸다. 멀티뷰는 페이지 전체가 스크롤되지
// 않아(고르기는 목록 안에서만, 시청은 body overflow:hidden) 빈 막대 자리만 차지했다.
// multiview.css 가 넘칠 때만 생기게 되돌린다(불러오는 순서와 관계없이). 설정 화면은 그대로.
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
const popupCss = readFileSync(path.join(ROOT, "src/popup.css"), "utf8");
const multiviewCss = readFileSync(path.join(ROOT, "src/multiview.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-scrollbar-"));
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
      const r = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const measure = (sheets, bodyClass = "") => ev(`(() => {
      document.head.querySelectorAll('style').forEach((s) => s.remove());
      for (const css of ${JSON.stringify(sheets)}) { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }
      document.body.className = ${JSON.stringify(bodyClass)};
      document.body.innerHTML = '<div style="height:50px">짧은 내용</div>';
      const st = getComputedStyle(document.documentElement);
      return { overflowY: st.overflowY, gutter: st.scrollbarGutter };
    })()`);

    const settingsOnly = await measure([popupCss]);
    check(settingsOnly.overflowY === "scroll" && settingsOnly.gutter.startsWith("stable"),
      `설정 화면(popup.css 만)은 그대로 스크롤바 자리를 고정한다 ${JSON.stringify(settingsOnly)}`);
    const setupOrder = await measure([popupCss, multiviewCss]);
    check(setupOrder.overflowY === "auto" && setupOrder.gutter === "auto",
      `멀티뷰 화면(popup.css → multiview.css)은 넘칠 때만 스크롤바 ${JSON.stringify(setupOrder)}`);
    const reversed = await measure([multiviewCss, popupCss], "mv-watch-body");
    check(reversed.overflowY === "auto" && reversed.gutter === "auto",
      `불러오는 순서가 바뀌어도(치지직 페이지 위 시청 화면) 멀티뷰 규칙이 이긴다 ${JSON.stringify(reversed)}`);
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
