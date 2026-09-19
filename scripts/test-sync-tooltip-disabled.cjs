// 실시간 따라잡기 툴팁: disabled 상태에서도 화면에 보이는가.
//
// ⚠ 성공 기준은 'pointerover 가 왔다' 나 '클래스가 붙었다' 가 아니다. 앞선 두 번의
//   수정이 그 기준으로 통과하고도 실제 페이지에서 실패했다. 여기서는 마지막에
//   계산된 스타일과 실제 크기로만 판정한다.
//
// ⚠ 이 환경(헤드리스)에서는 CSS :hover 가 아예 걸리지 않는다 — 일반 div 에서도
//   matches(':hover') 가 false 다. 그래서 ':hover 가 되는가' 는 여기서 잴 수 없고,
//   재서도 안 된다. 대신 치지직이 :hover 로만 툴팁을 띄운다는 전제를 fixture 에
//   그대로 넣고, 우리 구현이 그 전제와 무관하게 동작하는지를 본다.
//
// 실측으로 확정한 것: 포인터를 움직이지 않고 disabled=true 로 바꾸면
//   pointerout 이 오지 않는다. 그런데도 :hover 는 끊긴다. 그래서 버튼 이벤트가
//   아니라 포인터 좌표로 판정한다.

const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const ok = (c, l) => {
  console.log((c ? "  PASS " : "  FAIL ") + l);
  if (!c) failed += 1;
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

  const mixerJs = readFileSync("src/audioMixer.js", "utf8");
  const mixerCss = readFileSync("src/audioMixer.css", "utf8");
  // 우리 구현을 그대로 떼어 쓴다(복제본을 새로 쓰지 않는다).
  const logic = mixerJs.slice(
    mixerJs.indexOf('  const SYNC_TIP_OPEN_CLASS = "is-tip-open";'),
    mixerJs.indexOf("  // ── 라이브·다시보기 되감기/앞으로"),
  );

  await ev(`(()=>{
    // 치지직 쪽 전제: 툴팁은 기본 숨김이고 :hover 일 때만 뜬다(그리고 !important).
    const page=document.createElement('style');
    page.textContent='.pzp-button__tooltip{position:absolute;bottom:100%;left:0;'+
      'white-space:nowrap;opacity:0!important;visibility:hidden!important}'+
      '.pzp-button{position:relative}'+
      '.pzp-button:hover .pzp-button__tooltip{opacity:1!important;visibility:visible!important}';
    document.head.appendChild(page);
    // 우리 production CSS 를 그대로 올린다.
    const ours=document.createElement('style');
    ours.textContent=${JSON.stringify(mixerCss)};
    document.head.appendChild(ours);
    document.body.innerHTML='<div style="padding:60px">'+
      '<button id="sync" class="cheese-live-sync-button pzp-button" '+
      'style="width:60px;height:40px">'+
      '<span class="pzp-button__tooltip">지연 4.8초 · 3.0초까지 따라잡는 중</span>'+
      '<span class="pzp-ui-icon" style="display:block;width:20px;height:20px;'+
      'margin:10px auto">I</span></button></div>';
    const SYNC_BUTTON_CLASS='cheese-live-sync-button';
    ${logic}
    bindSyncTooltipHover();
    window.__update=updateSyncTooltipFromPointer;
    window.tip=()=>{const t=document.querySelector('.pzp-button__tooltip');
      const cs=getComputedStyle(t); const r=t.getBoundingClientRect();
      return {opacity:cs.opacity,visibility:cs.visibility,display:cs.display,
        w:Math.round(r.width),h:Math.round(r.height),
        text:t.textContent,
        open:document.getElementById('sync').classList.contains('is-tip-open'),
        disabled:document.getElementById('sync').disabled};};
    return true;})()`);

  const visible = (t) =>
    t.display !== "none" &&
    t.visibility !== "hidden" &&
    Number(t.opacity) > 0 &&
    t.w > 0 &&
    t.h > 0;
  const box =
    await ev(`(()=>{const r=document.getElementById('sync').getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  const move = async (x, y) => {
    await call(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x, y },
      sessionId,
    );
    await sleep(120);
  };

  console.log("[A] 활성 상태에서 버튼 위 — 보인다");
  await move(5, 5);
  await move(box.x, box.y);
  let t = await ev("window.tip()");
  ok(visible(t), `보인다 (opacity=${t.opacity} ${t.w}x${t.h})`);

  console.log("\n[C] 포인터를 두지 않고 disabled 로 바뀌어도 유지된다 (핵심)");
  // ⚠ 여기서 window.__update() 를 직접 부르면 'production 이 그 자리에서
  //   재평가하는가' 를 검사하지 못한다. 그래서 updateSyncButtonState 의 끝부분을
  //   원본에서 그대로 떼어 와 같은 순서로 실행한다.
  ok(
    /setSyncTooltip\(btn, lat, \{ idle: !overThreshold \}\);\s*\}\s*\/\/[^]*?updateSyncTooltipFromPointer\(\);/.test(
      mixerJs,
    ),
    "상태 갱신 끝에서 툴팁을 다시 판정한다(production 경로)",
  );
  await ev(`(()=>{const b=document.getElementById('sync');
    b.querySelector('.pzp-button__tooltip').textContent='지연 2.8초 · 따라잡기 불필요';
    b.disabled=true; window.__update(); return true;})()`);
  await sleep(150);
  t = await ev("window.tip()");
  ok(t.disabled, "버튼이 실제로 잠겼다");
  ok(visible(t), `잠긴 뒤에도 보인다 (opacity=${t.opacity} ${t.w}x${t.h})`);
  ok(
    t.text.includes("따라잡기 불필요"),
    `문구가 새 상태로 바뀌었다 (${t.text})`,
  );

  console.log("\n[E] 버튼 밖으로 나가면 닫힌다");
  await move(5, 5);
  t = await ev("window.tip()");
  ok(!t.open && !visible(t), "닫힌다");

  console.log("\n[D] 이미 잠긴 버튼에 새로 올려도 보인다");
  await move(box.x, box.y);
  t = await ev("window.tip()");
  ok(t.disabled && visible(t), `잠긴 채로 보인다 (${t.w}x${t.h})`);

  console.log("\n[H] 다시 활성으로 돌아가도 유지된다");
  await ev(`(()=>{const b=document.getElementById('sync');
    b.disabled=false; window.__update(); return true;})()`);
  await sleep(120);
  t = await ev("window.tip()");
  ok(!t.disabled && visible(t), "활성으로 돌아가도 보인다");

  console.log("\n[F] 컨트롤이 사라지면(크기 0) 툴팁도 닫힌다");
  await ev(`(()=>{document.getElementById('sync').style.display='none';
    window.__update(); return true;})()`);
  t = await ev("window.tip()");
  ok(!t.open, "버튼이 없어지면 표시를 거둔다");
  await ev(`(()=>{document.getElementById('sync').style.display='';
    window.__update(); return true;})()`);

  console.log("\n[G] 창 포커스를 잃으면 잔상이 없다");
  await move(box.x, box.y);
  ok((await ev("window.tip()")).open, "다시 열어 둔다");
  await ev("window.dispatchEvent(new Event('blur'))");
  await sleep(100);
  ok(!(await ev("window.tip()")).open, "blur 에서 정리된다");

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
