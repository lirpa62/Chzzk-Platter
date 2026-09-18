// 채팅창 너비 조절을 한 번도 하지 않은 상태에서 후원 창이 좁아지는 문제.
//
// 증상: 너비 조절 ON + drag 0회 → '후원하기' 를 누르면 다이얼로그 내부가
// 채팅 폭만큼 좁은 칸으로 눌린다. 한 번이라도 직접 조절하면 정상.
//
// 원인: 리사이저 손잡이를 붙이면서 aside 를 position:relative 로 만들었다.
// 그러면 그 안에서 position:absolute 로 뜨는 후원 alertdialog 의 기준 상자가
// 뷰포트에서 채팅 칸으로 바뀌어 폭이 채팅 폭으로 줄어든다.
// (position:fixed 는 영향이 없다. 이 파일에서 둘 다 재 본다.)
//
// 고침: 실제로 너비를 강제할 때만 기준 상자를 세운다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "cheese-dlg-"));
const b = spawn(
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
const pend = new Map();
b.stdio[4].on("data", (c) => {
  buf += c;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
    if (!raw) continue;
    const m = JSON.parse(raw),
      j = pend.get(m.id);
    if (!j) continue;
    pend.delete(m.id);
    m.error ? j.reject(Error(JSON.stringify(m.error))) : j.resolve(m.result);
  }
});
const call = (m, p = {}, s) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { resolve: res, reject: rej });
    b.stdio[3].write(
      JSON.stringify({ id, method: m, params: p, sessionId: s }) + "\0",
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
  const ev = async (e) => {
    const r = await call(
      "Runtime.evaluate",
      { expression: e, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await call(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const measure = async (pos) =>
    ev(`(()=>{
      document.body.innerHTML=
        '<div id="wrap" style="display:flex"><main style="flex:1"></main>'+
        '<aside id="chat" style="width:353px">'+
        '<div id="dlg" role="alertdialog" '+
        'style="position:${pos};left:0;right:0;width:100%"></div>'+
        '</aside></div>';
      const aside=document.getElementById('chat');
      const dlg=document.getElementById('dlg');
      const w=()=>Math.round(dlg.getBoundingClientRect().width);
      const base=w();
      aside.style.position='relative';
      const withRelative=w();
      aside.style.removeProperty('position');
      const after=w();
      return {base, withRelative, after, viewport: window.innerWidth};
    })()`);

  let failed = 0;
  const ok = (cond, label) => {
    console.log((cond ? "  PASS " : "  FAIL ") + label);
    if (!cond) failed += 1;
  };

  console.log("[기준 상자] aside 를 relative 로 만들면 후원 창이 좁아진다");
  {
    const abs = await measure("absolute");
    ok(
      abs.base === abs.viewport,
      `건드리기 전에는 뷰포트 폭이다 (${abs.base})`,
    );
    // ⚠ 이것이 증상이다. 이 줄이 통과해야 아래 '고침' 이 의미가 있다.
    ok(
      abs.withRelative < abs.base,
      `relative 면 채팅 폭으로 좁아진다 (${abs.withRelative})`,
    );
    ok(
      abs.after === abs.viewport,
      `기준을 되돌리면 다시 넓어진다 (${abs.after})`,
    );
  }

  console.log("\n[fixed 는 무관] 같은 조작이어도 fixed 다이얼로그는 영향 없다");
  {
    const fix = await measure("fixed");
    ok(
      fix.base === fix.withRelative && fix.withRelative === fix.after,
      `fixed 는 폭이 그대로다 (${fix.base}/${fix.withRelative}/${fix.after})`,
    );
  }

  console.log("\n[소스] 너비를 강제할 때만 기준 상자를 세운다");
  {
    const fs = require("node:fs");
    const path = require("node:path");
    const content = fs.readFileSync(
      path.join(__dirname, "..", "src", "content.js"),
      "utf8",
    );
    const fn = content.slice(
      content.indexOf("function ensureChatResizer"),
      content.indexOf("function bindChatResizer"),
    );
    ok(
      /needsAnchor && getComputedStyle\(aside\)\.position === "static"/.test(
        fn,
      ),
      "조절값이 있을 때만 relative 로 만든다",
    );
    ok(
      /chatWidthValue >= CHAT_MIN_WIDTH/.test(fn),
      "조절 여부를 저장된 값으로 판단한다",
    );
    ok(
      /removeProperty\("position"\)/.test(fn),
      "조절값이 없으면 세워 둔 기준을 되돌린다",
    );
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  process.exitCode = failed ? 1 : 0;
})()
  .catch((e) => {
    console.error("FAIL", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    b.kill("SIGTERM");
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
