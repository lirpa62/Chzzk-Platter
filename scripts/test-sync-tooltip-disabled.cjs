// 따라잡기를 끝내 버튼이 잠기면 툴팁이 보이지 않던 문제.
//
// ⚠ 성공 기준은 '툴팁 DOM 이 있다' 가 아니라 '실제로 눈에 보인다' 다. 그래서
//   진짜 마우스를 움직이고 computed style 과 실제 크기까지 잰다.
//
// 앞선 두 판단이 모두 부족했다.
//   1차: ":disabled 에서 pointer-events 를 막지 않으니 hover 된다" → 틀렸다.
//        JS 이벤트는 오지만 CSS :hover 자체가 걸리지 않는다.
//   2차: is-tip-open 클래스로 띄웠지만 치지직이 !important 로 숨기면 졌다.
//        (실측: display:none·opacity/visibility·hover 전용까지는 이겼다)
//
// 그래서 여기서는 치지직이 !important 로 숨기는 최악의 경우를 가정하고 잰다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "cheese-t3-"));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, l) => {
  console.log((c ? "  PASS " : "  FAIL ") + l);
  if (!c) failed++;
};
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
    { width: 900, height: 600, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const mixer = readFileSync("src/audioMixer.js", "utf8");
  // 위임 로직만 떼어내 그대로 실행한다(원본과 같은 코드).
  const from = mixer.indexOf("  const SYNC_TIP_OPEN_CLASS =");
  const to = mixer.indexOf("  // ── 라이브·다시보기 되감기/앞으로");
  const logic = mixer.slice(from, to);
  const ours = readFileSync("src/audioMixer.css", "utf8");
  await ev(
    `(()=>{
    const a=document.createElement('style');
    // 치지직이 !important 로 숨기는 최악의 경우를 가정한다.
    a.textContent='.pzp-button__tooltip{position:absolute;bottom:100%;'+
      'opacity:0!important;visibility:hidden!important}'+
      '.pzp-button{position:relative}';
    document.head.appendChild(a);
    const o=document.createElement('style'); o.textContent=` +
      JSON.stringify(ours) +
      `;
    document.head.appendChild(o);
    document.body.innerHTML=
      '<div style="padding:40px">'+
      '<button class="cheese-live-sync-button pzp-button" disabled '+
      'style="width:60px;height:40px">'+
      '<span class="pzp-button__tooltip">지연 2.8초 · 따라잡기 불필요</span>'+
      '<span class="pzp-ui-icon" style="display:block;width:20px;height:20px;'+
      'margin:10px auto">I</span></button></div>';
    const SYNC_BUTTON_CLASS='cheese-live-sync-button';
    ` +
      logic +
      `
    bindSyncTooltipHover();
    window.tipState=()=>{const t=document.querySelector('.pzp-button__tooltip');
      const cs=getComputedStyle(t); const r=t.getBoundingClientRect();
      return {opacity:cs.opacity,visibility:cs.visibility,display:cs.display,
        w:Math.round(r.width),h:Math.round(r.height),
        open:document.querySelector('.cheese-live-sync-button')
          .classList.contains('is-tip-open')};};
    return true;})()`,
  );
  const seen = () => ev("window.tipState()");
  const at = async (sel) =>
    ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)})
    .getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  const move = async (x, y) => {
    await call(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x, y },
      sessionId,
    );
    await sleep(120);
  };

  console.log("[초기] 아무 데도 없을 때는 숨어 있다");
  let st = await seen();
  ok(
    Number(st.opacity) === 0 || st.visibility === "hidden",
    `숨김 (opacity=${st.opacity})`,
  );

  console.log("\n[B] disabled 버튼 위로 올리면 눈에 보인다");
  const btn = await at(".cheese-live-sync-button");
  await move(5, 5);
  await move(btn.x, btn.y);
  st = await seen();
  ok(st.open, "is-tip-open 이 붙는다");
  const visible =
    st.display !== "none" &&
    st.visibility !== "hidden" &&
    Number(st.opacity) > 0 &&
    st.w > 0 &&
    st.h > 0;
  ok(
    visible,
    `실제로 보인다 (opacity=${st.opacity} vis=${st.visibility} ${st.w}x${st.h})`,
  );

  console.log("\n[아이콘 경계] 버튼 안에서 움직여도 유지된다");
  const icon = await at(".pzp-ui-icon");
  await move(icon.x, icon.y);
  st = await seen();
  ok(st.open, "아이콘 위로 옮겨도 닫히지 않는다");

  console.log("\n[E] 버튼 밖으로 나가면 닫힌다");
  await move(5, 5);
  st = await seen();
  ok(!st.open, "is-tip-open 이 떨어진다");
  ok(Number(st.opacity) === 0 || st.visibility === "hidden", "다시 숨는다");

  console.log("\n[F] 창 포커스를 잃으면 잔상이 남지 않는다");
  await move(btn.x, btn.y);
  ok((await seen()).open, "다시 열어 둔다");
  await ev("window.dispatchEvent(new Event('blur'))");
  await sleep(80);
  ok(!(await seen()).open, "blur 에서 정리된다");
  await move(btn.x, btn.y);
  await ev(`(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));return true;})()`);
  await sleep(80);
  ok(!(await seen()).open, "탭이 가려져도 정리된다");

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
