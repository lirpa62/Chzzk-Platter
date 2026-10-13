// 치지직 페이지 위 멀티뷰의 테마.
//
// 받침 페이지(/lives)의 <html> 은 치지직 것이라, 숨겨 둔 치지직 앱도 data-theme 에 자기 테마를
// 쓴다(다크 "theme_dark", 라이트 "light"). 다른 탭에서 치지직을 라이트로 바꾸면 멀티뷰도
// 라이트가 됐고, 다크로 바꾸면 "theme_dark" 를 다크로 보지 못해 그대로였다. 다시보기를 보던
// 중 다크가 라이트로 돌아가는 일도 같은 덮어쓰기다. 멀티뷰 테마는 멀티뷰 테마 단추로만 바뀐다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const themeJs = readFileSync(path.join(ROOT, "src/multiviewTheme.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/multiview.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-theme-"));
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
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const state = `new Promise((resolve) => setTimeout(() => resolve({
      theme: document.documentElement.dataset.theme,
      pressed: document.getElementById('mvTheme').getAttribute('aria-pressed'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }), 0))`;
    // 치지직 페이지 위(받침 /lives): 고르기 화면이 다크를 넘겼다.
    await ev(`(() => {
      document.documentElement.setAttribute('data-cheese-multiview-host', '1');
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)};
      document.head.append(style);
      document.body.innerHTML = '<button id="mvTheme"></button>';
      globalThis.__cheeseMultiviewHost = Object.freeze({ setupId: 'x', theme: 'dark' });
      ${themeJs}
    })()`);
    check((await ev(state)).theme === "dark", "고르기 화면이 넘긴 테마(다크)로 시작한다");

    // 숨은 치지직 앱이 라이트로 바꾼다(다른 탭에서 라이트로 바꿈·다시보기 중 되돌림).
    await ev(`document.documentElement.style.colorScheme = 'light'; document.documentElement.dataset.theme = 'light'`);
    const afterChzzkLight = await ev(state);
    check(afterChzzkLight.theme === "dark" && afterChzzkLight.pressed === "true" && afterChzzkLight.scheme === "dark",
      `치지직이 라이트를 써도 멀티뷰는 다크 그대로(스크롤바 색도) ${JSON.stringify(afterChzzkLight)}`);

    // 멀티뷰 단추로 라이트로 바꾼 뒤 치지직이 다크("theme_dark")를 쓴다.
    await ev(`document.getElementById('mvTheme').click()`);
    check((await ev(state)).theme === "light", "멀티뷰 테마 단추로는 바뀐다");
    await ev(`document.documentElement.style.colorScheme = 'dark'; document.documentElement.dataset.theme = 'theme_dark'`);
    const afterChzzkDark = await ev(state);
    check(afterChzzkDark.theme === "light" && afterChzzkDark.scheme === "light",
      `치지직이 "theme_dark" 를 써도 멀티뷰는 라이트 그대로 ${JSON.stringify(afterChzzkDark)}`);

    // 서로 덮어쓰기가 이어져도 멈추지 않는다.
    const fight = await ev(`new Promise((resolve) => {
      let writes = 0;
      const mo = new MutationObserver(() => {
        if (document.documentElement.dataset.theme !== 'theme_dark' && writes < 200) {
          writes++;
          document.documentElement.dataset.theme = 'theme_dark';
        }
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      document.documentElement.dataset.theme = 'theme_dark';
      setTimeout(() => { mo.disconnect(); resolve(writes); }, 50);
    })`);
    check(fight <= 25, `치지직이 되돌림에 다시 반응해도 1초에 20번 넘게 되돌리지 않는다(치지직 쓰기 ${fight}번)`);
    await tick();
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  check(/if \(globalThis\.__cheeseMultiviewHost\) \{/.test(themeJs),
    "확장 페이지(멀티뷰 고르기 등)에서는 지키지 않는다(치지직 앱이 없다)");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
