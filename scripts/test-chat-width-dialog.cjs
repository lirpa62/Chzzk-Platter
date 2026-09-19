// 채팅창 너비 조절 ON + 한 번도 끌지 않은 상태에서 후원 창이 좁아지는 문제.
//
// ⚠ 첫 가설(리사이저가 aside 를 position:relative 로 만들어 기준 상자가 바뀐다)은
//   틀렸다. 실측 결과 outer/inner 모두 position:static, offsetParent 는 BODY 로
//   drag 전후가 같았다.
//
// 실제 원인: [role="alertdialog"] 에 폭을 강제하는 규칙이 있고, 그 값이
// var(--cheese-chat-profile-popup-width, 208px) 다. 이 변수는 '끌었을 때' 와
// '왼쪽 배치일 때' 만 설정되므로, 오른쪽 배치 + 끌기 0회면 208px 기본값이 그대로
// 적용된다. 이 규칙은 프로필 팝오버용으로 쓰였는데 후원 창도 같은 role 이라
// 함께 눌린 것이다.
//
// 고침: 너비를 강제하지 않는 경우에도 지금 채팅 폭으로 런타임 변수만 맞춘다
// (사용자 설정 cheeseChatWidth 에는 저장하지 않는다).
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "cheese-d2-"));
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
  await ev(`(()=>{const st=document.createElement('style');
    st.textContent=${JSON.stringify(readFileSync("src/content.css", "utf8"))};
    document.head.appendChild(st);return true;})()`);
  const measure = async (dragged) =>
    ev(`(()=>{
    const root=document.documentElement;
    root.className='cheese-chat-width-resize-enabled';
    if(${dragged}){
      root.style.setProperty('--cheese-chat-resized-width','420px');
      root.style.setProperty('--cheese-chat-profile-popup-width','400px');
      root.style.setProperty('--cheese-chat-popover-width','404px');
    } else {
      root.style.removeProperty('--cheese-chat-resized-width');
      root.style.removeProperty('--cheese-chat-profile-popup-width');
      root.style.removeProperty('--cheese-chat-popover-width');
    }
    // 사용자가 준 실제 구조.
    document.body.innerHTML=
      '<aside id="aside-chatting" style="width:353px">'+
      '<div class="_layer_1mkoo_2" role="dialog">'+
      '<div class="_container_jao35_20 _container_1mkoo_12" role="alertdialog" aria-modal="true">'+
      '<div id="popup_contents">후원</div></div></div></aside>';
    const outer=document.querySelector('[role="dialog"]');
    const inner=document.querySelector('[role="alertdialog"]');
    const g=(el)=>{const cs=getComputedStyle(el);const r=el.getBoundingClientRect();
      return {w:Math.round(r.width),width:cs.width,maxWidth:cs.maxWidth,
        minWidth:cs.minWidth,position:cs.position,
        offsetParent:el.offsetParent?el.offsetParent.tagName+'#'+(el.offsetParent.id||''):null};};
    return {outer:g(outer),inner:g(inner),
      varProfile:getComputedStyle(root).getPropertyValue('--cheese-chat-profile-popup-width').trim()||'(없음)'};
  })()`);
  const before = await measure(false);
  const after = await measure(true);
  const show = (t, o) => {
    console.log(`\n[${t}]`);
    console.log("  변수 --profile-popup-width:", o.varProfile);
    console.log(
      "  outer role=dialog   :",
      o.outer.w + "px",
      "width=" + o.outer.width,
      "pos=" + o.outer.position,
      "offsetParent=" + o.outer.offsetParent,
    );
    console.log(
      "  inner alertdialog   :",
      o.inner.w + "px",
      "width=" + o.inner.width,
      "maxW=" + o.inner.maxWidth,
      "pos=" + o.inner.position,
      "offsetParent=" + o.inner.offsetParent,
    );
  };
  show("drag 전 (변수 없음)", before);
  show("drag 후 (변수 있음)", after);

  let failed = 0;
  const ok = (c, l) => {
    console.log((c ? "  PASS " : "  FAIL ") + l);
    if (!c) failed += 1;
  };
  console.log("\n[증상] 변수가 없으면 208px 기본값으로 눌린다");
  ok(before.inner.w === 208, `변수 없음 → ${before.inner.w}px`);
  ok(after.inner.w === 400, `변수 있음 → ${after.inner.w}px`);

  console.log("\n[기준 상자는 원인이 아니다] drag 전후가 같다");
  ok(
    before.inner.offsetParent === after.inner.offsetParent,
    `offsetParent 동일 (${before.inner.offsetParent})`,
  );
  ok(
    before.inner.position === after.inner.position,
    `position 동일 (${before.inner.position})`,
  );

  console.log("\n[소스] 끌지 않아도 런타임 변수를 맞춘다");
  {
    const src = readFileSync("src/content.js", "utf8");
    const fn = src.slice(
      src.indexOf("const saved = chatWidthValue >= CHAT_MIN_WIDTH"),
      src.indexOf("function ensureChatResizer"),
    );
    ok(
      /if \(applied > 0\) syncChatPopupWidthVars\(applied\);/.test(fn),
      "저장값이 없어도 현재 폭으로 변수를 맞춘다",
    );
    // ⚠ 사용자 설정과 런타임 표시 상태를 섞지 않는다.
    ok(
      !/chrome\.storage[^;]*cheeseChatWidth/.test(fn),
      "그 경로에서 사용자 설정을 저장하지 않는다",
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
