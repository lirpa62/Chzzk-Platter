// 브랜드색 배경 위 글자색을 테마별로 실측한다.
//
// --popup-brand 는 테마마다 다르다(라이트 #00c73c / 다크 #00d864). 라이트의 진한
// 초록 위에 거의 검은 글자(#05170f)를 올리면 대비가 모자라 잘 안 읽혔다. 그래서
// 기본은 흰 글자, 다크에서만 어두운 글자로 되돌린다.
//
// ⚠ 계산된 색은 변수 정의(popup.css)와 규칙 순서가 함께 맞아야 나오는 값이라
//   눈으로는 확인이 어렵다. 실제 브라우저에서 getComputedStyle 로 잰다.
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const dir = mkdtempSync(join(tmpdir(), "cheese-theme-"));
const browser = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buf = "",
  seq = 0;
const pending = new Map();
browser.stdio[4].on("data", (c) => {
  buf += c;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
    if (!raw) continue;
    const m = JSON.parse(raw),
      j = pending.get(m.id);
    if (!j) continue;
    pending.delete(m.id);
    m.error ? j.reject(Error(JSON.stringify(m.error))) : j.resolve(m.result);
  }
});
function call(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { resolve: res, reject: rej });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });
}

(async () => {
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const evaluate = async (expression) => {
    const r = await call(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const popup = readFileSync("src/popup.css", "utf8");
  const mv = readFileSync("src/multiview.css", "utf8");
  await evaluate(`
    document.head.innerHTML='<style>'+${JSON.stringify(popup)}+${JSON.stringify(mv)}+'</style>';
    document.body.innerHTML=
      '<button class="mv-start">시작</button>'+
      '<span class="mv-main-badge">메인</span>'+
      '<span class="mv-quick-tag">메인</span>'+
      '<span class="mv-card-picked">선택됨</span>'+
      '<ul><li class="mv-chosen-item"><span class="mv-chosen-rank">메인</span></li></ul>'+
      '<button class="mv-cell-retry is-primary">다시</button>'+
      '<button class="mv-vol-enable">소리</button>';
  `);

  let fails = 0;
  const ok = (c, l) => {
    console.log((c ? "  PASS " : "  FAIL ") + l);
    if (!c) fails++;
  };
  const read = async (theme) => {
    await evaluate(
      theme === "dark"
        ? `document.documentElement.setAttribute('data-theme','dark')`
        : `document.documentElement.removeAttribute('data-theme')`,
    );
    return evaluate(`(()=>{
      const sels=['.mv-start','.mv-main-badge','.mv-quick-tag','.mv-card-picked',
        '.mv-chosen-rank','.mv-cell-retry.is-primary','.mv-vol-enable'];
      const out={};
      for(const s of sels){const el=document.querySelector(s);
        const cs=getComputedStyle(el);out[s]={color:cs.color,bg:cs.backgroundColor};}
      return out;
    })()`);
  };

  console.log("[라이트 모드] 브랜드색 배경 위 글자는 흰색이어야 한다");
  const light = await read("light");
  for (const [sel, v] of Object.entries(light)) {
    ok(
      v.color === "rgb(255, 255, 255)",
      `${sel} 흰 글자 (${v.color} on ${v.bg})`,
    );
  }

  console.log("\n[다크 모드] 지금까지의 어두운 글자를 그대로 쓴다");
  const dark = await read("dark");
  for (const [sel, v] of Object.entries(dark)) {
    ok(
      v.color === "rgb(5, 23, 15)",
      `${sel} 어두운 글자 (${v.color} on ${v.bg})`,
    );
  }
  ok(
    dark[".mv-start"].bg !== light[".mv-start"].bg,
    "배경색은 테마마다 다르다",
  );

  console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
  process.exitCode = fails ? 1 : 0;
})()
  .catch((e) => {
    console.error("FAIL " + (e?.message || e));
    process.exitCode = 1;
  })
  .finally(() => {
    browser.kill("SIGTERM");
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
