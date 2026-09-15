// 멀티뷰 두 화면의 라이트/다크 전환.
//
// 첫 페인트 전 적용은 themeInit.js 가 하고, 버튼 전환은 multiviewTheme.js 가 맡는다.
// 저장 키(cheeseSearchTheme)는 다른 확장 페이지와 같아 설정 화면에서 고른 테마가
// 그대로 이어진다.
const { spawn } = require("child_process");
const fs = require("fs");
const dir = fs.mkdtempSync("/tmp/th2-");
const b = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    "--user-data-dir=" + dir,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buf = "",
  seq = 0;
const pend = new Map();
b.stdio[4].on("data", (c) => {
  buf += c;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const r = buf.slice(0, e);
    buf = buf.slice(e + 1);
    if (!r) continue;
    const m = JSON.parse(r),
      j = pend.get(m.id);
    if (!j) continue;
    pend.delete(m.id);
    m.error ? j.reject(Error(JSON.stringify(m.error))) : j.resolve(m.result);
  }
});
const call = (me, p = {}, s) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { resolve: res, reject: rej });
    b.stdio[3].write(
      JSON.stringify({ id, method: me, params: p, sessionId: s }) + "\0",
    );
  });
(async () => {
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const ev = async (x) => {
    const r = await call(
      "Runtime.evaluate",
      { expression: x, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  let bad = 0;
  for (const page of ["multiview.html", "multiviewWatch.html"]) {
    await ev(
      "document.documentElement.innerHTML=" +
        JSON.stringify(fs.readFileSync(page, "utf8")),
    );
    await ev("document.querySelectorAll('script,link').forEach(e=>e.remove())");
    for (const f of ["src/popup.css", "src/multiview.css"]) {
      const css = fs.readFileSync(f, "utf8");
      await ev(
        `{const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.append(s);}`,
      );
    }
    // about:blank 에서는 localStorage 접근이 막힐 수 있다. 테마 스크립트가 try 로
    // 감싸므로 그대로 둔다(저장이 안 될 뿐 전환은 동작해야 한다).
    await ev("void 0");
    await ev(fs.readFileSync("src/multiviewTheme.js", "utf8"));
    const out = await ev(`(()=>{
    const btn=document.getElementById("mvTheme");
    const seen=[];
    const snap=()=>{const cs=getComputedStyle(document.body);
      return {theme:document.documentElement.dataset.theme,
        bg:cs.backgroundColor,
        sun:getComputedStyle(btn.querySelector(".mv-theme-sun")).display,
        moon:getComputedStyle(btn.querySelector(".mv-theme-moon")).display,
        pressed:btn.getAttribute("aria-pressed")};};
    seen.push(snap());
    btn.click(); seen.push(snap());
    btn.click(); seen.push(snap());
    return JSON.stringify(seen);})()`);
    const parsed = JSON.parse(out);
    console.log("=== " + page + " ===");
    for (const s of parsed) console.log("  ", JSON.stringify(s));
    // 검사: 테마가 실제로 바뀌고 아이콘이 하나만 보여야 한다
    if (
      parsed[0].theme !== "light" ||
      parsed[1].theme !== "dark" ||
      parsed[2].theme !== "light"
    ) {
      console.log("  ⚠ 테마 전환 실패");
      bad++;
    }
    for (const s of parsed) {
      if ((s.sun === "none") === (s.moon === "none")) {
        console.log("  ⚠ 아이콘이 둘 다 보이거나 둘 다 숨겨짐");
        bad++;
      }
    }
    if (parsed[0].bg === parsed[1].bg) {
      console.log("  ⚠ 배경색이 안 바뀜");
      bad++;
    }
  }
  console.log(bad ? bad + "건 문제" : "테마 전환 정상");
  process.exitCode = bad ? 1 : 0;
})()
  .catch((e) => {
    console.error("FAIL", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    b.kill("SIGTERM");
  });
