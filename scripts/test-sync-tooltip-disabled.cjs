// 따라잡기를 끝내 버튼이 잠기면 툴팁이 뜨지 않던 문제.
//
// ⚠ 앞선 판단(":disabled 에서 pointer-events 를 막지 않으니 hover 된다")은
//   충분하지 않았다. pointer-events 는 살아 있어 JS 이벤트는 오지만, CSS :hover
//   자체가 disabled 버튼에 걸리지 않는다. 치지직 툴팁은 :hover 로 뜨므로 결국
//   보이지 않았다.
//
// 여기서 재는 것:
//   1. disabled 버튼에서 mouseenter/pointerover 는 오는가 (온다)
//   2. :hover 가 걸리는가 (안 걸린다 — 이것이 원인)
//   3. 우리 클래스(is-tip-open)로는 툴팁이 뜨는가 (뜬다 — 이것이 고침)
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "cheese-tip-"));
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
    { width: 800, height: 600, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const css = require("node:fs").readFileSync("src/audioMixer.css", "utf8");
  await ev(
    `(()=>{
    const st=document.createElement('style');
    st.textContent=${JSON.stringify("")}+${JSON.stringify("")};
    st.textContent=` +
      JSON.stringify(css) +
      `+
      '.pzp-button__tooltip{display:none}';
    document.head.appendChild(st);
    document.body.innerHTML=
      '<span id="host" style="display:inline-block;padding:4px">'+
      '<button id="btn" class="cheese-live-sync-button" disabled '+
      'style="width:60px;height:40px">B'+
      '<span class="pzp-button__tooltip">지연 2.8초</span></button></span>';
    window.log={btnEnter:0,btnOver:0,hostEnter:0,hostOver:0};
    const btn=document.getElementById('btn'), host=document.getElementById('host');
    btn.addEventListener('mouseenter',()=>window.log.btnEnter++);
    btn.addEventListener('pointerover',()=>window.log.btnOver++);
    host.addEventListener('mouseenter',()=>window.log.hostEnter++);
    host.addEventListener('pointerover',()=>window.log.hostOver++);
    return true;})()`,
  );
  // 버튼 한가운데로 마우스를 옮긴다.
  const box =
    await ev(`(()=>{const r=document.getElementById('btn').getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await call(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: 5, y: 5 },
    sessionId,
  );
  await call(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: box.x, y: box.y },
    sessionId,
  );
  await new Promise((r) => setTimeout(r, 200));
  const out = await ev(`(()=>({log:window.log,
    btnHover:document.getElementById('btn').matches(':hover'),
    hostHover:document.getElementById('host').matches(':hover'),
    elemAtPoint:(document.elementFromPoint(${box.x},${box.y})||{}).id||null,
    tipBefore:getComputedStyle(document.querySelector('.pzp-button__tooltip')).display,
    tipAfter:(()=>{document.getElementById('btn').classList.add('is-tip-open');
      return getComputedStyle(document.querySelector('.pzp-button__tooltip')).display;})()}))()`);
  console.log("마우스를 disabled 버튼 위로 옮긴 뒤:");
  console.log("  버튼 mouseenter :", out.log.btnEnter);
  console.log("  버튼 pointerover:", out.log.btnOver);
  console.log("  래퍼 mouseenter :", out.log.hostEnter);
  console.log("  래퍼 pointerover:", out.log.hostOver);
  console.log("  button:hover    :", out.btnHover);
  console.log("  wrapper:hover   :", out.hostHover);
  console.log("  그 좌표의 요소  :", out.elemAtPoint);
  console.log("  툴팁 display(클래스 전):", out.tipBefore);
  console.log("  툴팁 display(클래스 후):", out.tipAfter);

  let failed = 0;
  const ok = (c, l) => {
    console.log((c ? "  PASS " : "  FAIL ") + l);
    if (!c) failed += 1;
  };
  console.log("");
  ok(out.log.btnOver > 0, "disabled 버튼도 pointer 이벤트는 받는다");
  ok(out.btnHover === false, "그러나 :hover 는 걸리지 않는다(원인)");
  ok(out.tipBefore === "none", "클래스 전에는 툴팁이 숨어 있다");
  ok(out.tipAfter === "block", "클래스가 붙으면 툴팁이 보인다(고침)");

  console.log("\n[소스] disabled 를 없애지 않고 클래스로 띄운다");
  {
    const mixer = require("node:fs").readFileSync("src/audioMixer.js", "utf8");
    ok(/function bindSyncTooltipHover/.test(mixer), "포인터로 클래스를 켠다");
    ok(/btn\.disabled = true;/.test(mixer), "disabled 의미를 그대로 둔다");
    ok(
      !/aria-disabled/.test(mixer),
      "가짜 disabled(aria-disabled)로 바꾸지 않는다",
    );
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  process.exitCode = failed ? 1 : 0;
})()
  .catch((e) => console.error("FAIL", e.message))
  .finally(() => {
    b.kill("SIGTERM");
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
