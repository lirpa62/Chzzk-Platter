// 팝업 '채팅 없이 시작' 안정화 구간에서 사용자가 채팅을 펼쳐도 다시 접히던 문제.
//
// 원인: 초기 접기 루프(applyPopupPlayerInitialChatFold)에는 사용자 조작 감지가
//   없었다. 기존 감지(ensureChatFoldUserClickListener)는 '채팅 접힘 유지'
//   기능(chatFoldPersistOn, 기본 OFF)이 켜졌을 때만 document 에 붙는다.
//   팝업의 '채팅 없이 시작' 은 그 기능과 무관하게 동작하므로, 안정화 구간
//   (최대 15초 / 최대 16회) 동안 사용자가 펼쳐도 계속 다시 접었다.
//
// 고침: 팝업 안정화 구간 전용 감지를 두고, 사용자의 클릭(isTrusted)이나
//   KeyJ 가 오면 남은 안정화를 끝내고 다시 접지 않는다.
//
// ⚠ 우리 프로그램적 click 은 isTrusted=false 다. 이걸 구분하지 못하면 우리가
//   접은 것을 사용자 조작으로 오인해 첫 접기부터 중단된다. 두 경우를 모두 검사.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");

// ⚠ 손으로 베낀 루프를 검사하면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(name, sig = "(") {
  const at = SRC.indexOf(`  function ${name}${sig}`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

const PIECES = [
  sliceFn("ensurePopupPlayerChatFoldUserWatch"),
  sliceFn("finishPopupPlayerInitialChatFold"),
  sliceFn("schedulePopupPlayerInitialChatFold"),
  sliceFn("isChatFoldToggleButton"),
  sliceFn("applyPopupPlayerInitialChatFold"),
].join("\n");

if (!/popupPlayerChatFoldUserOverride/.test(PIECES)) {
  throw Error("떼어 낸 구간에 사용자 조작 가드가 없다");
}

const dir = mkdtempSync(join(tmpdir(), "cheese-pcf-"));
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

let failed = 0;
const ok = (c, l) => {
  console.log((c ? "  PASS " : "  FAIL ") + l);
  if (!c) failed += 1;
};
const cleanup = () => {
  try {
    b.kill();
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
};

(async () => {
  const { targetId } = await call("Target.createTarget", {
    url: "https://chzzk.naver.com/live/test",
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
    if (r.exceptionDetails)
      throw Error("EXC " + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  // 치지직 라이브 페이지를 흉내 낸다. 접기 버튼과 채팅 aside.
  const setup = async ({ adPlaying = false } = {}) =>
    ev(`(()=>{
      document.documentElement.innerHTML='<head></head><body></body>';
      document.body.innerHTML=
        '<aside id="aside-chatting" class="_chat_"></aside>'+
        '<button id="foldBtn" aria-label="채팅 접기">접기</button>';
      window.__clicks=0; window.__folded=false; window.__done=0;
      const aside=document.getElementById('aside-chatting');
      const btn=document.getElementById('foldBtn');
      // 버튼을 누르면 접힘/펼침이 토글된다(치지직과 같은 클래스 규칙).
      btn.addEventListener('click',()=>{
        window.__clicks++;
        window.__folded=!window.__folded;
        aside.className = window.__folded ? '_is_folded_x' : '_chat_';
      });
      // 런타임 의존값
      window.POPUP_PLAYER_START_WITHOUT_CHAT_FRAME=true;
      window.POPUP_PLAYER_FRAME_STATUS_SOURCE='cheese-popup-status';
      window.popupPlayerChatFoldAttempts=0;
      window.popupPlayerChatFoldDone=false;
      window.popupPlayerChatFoldWaitStartedAt=0;
      window.popupPlayerChatFoldEnforceStartedAt=0;
      window.popupPlayerChatFoldTimer=0;
      window.popupPlayerChatFoldUserOverride=false;
      window.popupPlayerChatFoldUserWatchBound=false;
      window.POPUP_PLAYER_CHAT_FOLD_READY_TIMEOUT_MS=30000;
      // 테스트를 빠르게: 안정화 구간을 짧게 잡는다(정책은 원본 그대로).
      window.POPUP_PLAYER_CHAT_FOLD_ENFORCE_MS=400;
      window.POPUP_PLAYER_CHAT_FOLD_MAX_ENFORCE_MS=1200;
      window.POPUP_PLAYER_CHAT_FOLD_RETRY_MS=60;
      window.POPUP_PLAYER_CHAT_FOLD_MAX_ATTEMPTS=16;
      window.__ad=${adPlaying};
      window.isAdPlaying=()=>window.__ad;
      window.isChatFolded=()=>window.__folded;
      window.isPopupPlayerChatFolded=()=>window.__folded;
      window.getPopupPlayerChatFoldButton=()=>document.getElementById('foldBtn');
      window.notifyPopupPlayerInitialChatFoldReady=()=>{window.__done++;};
      ${PIECES}
      window.applyPopupPlayerInitialChatFold=applyPopupPlayerInitialChatFold;
      return true;})()`);

  const state = () =>
    ev(`({clicks:window.__clicks,folded:window.__folded,done:window.__done,
        override:window.popupPlayerChatFoldUserOverride,
        doneFlag:window.popupPlayerChatFoldDone})`);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ⚠ 첫 setup 이 페이지 로드 완료 전에 실행되면 네비게이션이 document 를 덮어써
  //   주입한 상태가 사라진다(실제로 [A] 만 undefined 로 실패했다). 한 번 기다린다.
  await ev(`document.readyState`);
  await wait(300);

  console.log("[A] 기본 — 펼쳐져 있으면 접는다");
  {
    await setup();
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(900);
    const s = await state();
    ok(s.folded === true, `접혔다 (folded=${s.folded})`);
    ok(s.clicks === 1, `click 1회 (clicks=${s.clicks})`);
    ok(s.doneFlag === true, "안정화가 끝났다");
    ok(s.done === 1, "부모에 완료를 한 번 알린다");
  }

  console.log("\n[B] 우리 click 은 사용자 조작으로 오인하지 않는다");
  {
    // ⚠ 이게 깨지면 첫 접기에서 바로 중단되어 기능이 죽는다.
    await setup();
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(900);
    const s = await state();
    ok(s.override === false, `사용자 조작으로 잡히지 않는다 (${s.override})`);
    ok(s.folded === true, "정상적으로 접혔다");
  }

  console.log("\n[C] 이미 접혀 있으면 click 하지 않는다");
  {
    await setup();
    await ev(`(()=>{window.__folded=true;
      document.getElementById('aside-chatting').className='_is_folded_x';return true;})()`);
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(900);
    const s = await state();
    ok(s.clicks === 0, `click 0회 (clicks=${s.clicks})`);
    ok(s.doneFlag === true, "그대로 완료된다");
  }

  console.log("\n[D] 사용자가 실제로 펼치면 다시 접지 않는다");
  {
    await setup();
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(150); // 우리가 접은 뒤
    const before = await state();
    ok(before.folded === true, "먼저 접혔다");
    // 실제 사용자 클릭(CDP 입력 → isTrusted=true)
    const box =
      await ev(`(()=>{const r=document.getElementById('foldBtn').getBoundingClientRect();
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await call(
        "Input.dispatchMouseEvent",
        { type, x: box.x, y: box.y, button: "left", clickCount: 1 },
        sessionId,
      );
    }
    await wait(900);
    const s = await state();
    ok(s.override === true, "사용자 조작으로 잡힌다");
    ok(s.folded === false, `펼친 상태가 유지된다 (folded=${s.folded})`);
    // ⚠ 고치기 전에는 여기서 우리가 다시 접어 clicks 가 계속 늘었다.
    ok(s.clicks === 2, `추가 접기 click 이 없다 (clicks=${s.clicks})`);
    ok(s.doneFlag === true, "안정화를 즉시 끝낸다");
  }

  console.log("\n[E] 사용자 KeyJ 로 펼쳐도 다시 접지 않는다");
  {
    await setup();
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(150);
    // 실제 키 입력(isTrusted=true). 치지직처럼 J 로 토글되게 해 둔다.
    await ev(`document.addEventListener('keydown',(e)=>{
      if(e.code==='KeyJ'&&e.isTrusted){document.getElementById('foldBtn').click();}});`);
    for (const type of ["keyDown", "keyUp"]) {
      await call(
        "Input.dispatchKeyEvent",
        { type, code: "KeyJ", key: "j", windowsVirtualKeyCode: 74 },
        sessionId,
      );
    }
    await wait(900);
    const s = await state();
    ok(s.override === true, "KeyJ 가 사용자 조작으로 잡힌다");
    ok(s.folded === false, `펼친 상태가 유지된다 (folded=${s.folded})`);
    ok(s.doneFlag === true, "안정화를 끝낸다");
  }

  console.log("\n[F] 한글 입력 상태의 KeyJ(입력창) 는 무시한다");
  {
    await setup();
    await ev(`(()=>{const i=document.createElement('input');i.id='chatInput';
      document.body.appendChild(i);i.focus();return true;})()`);
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(150);
    for (const type of ["keyDown", "keyUp"]) {
      await call(
        "Input.dispatchKeyEvent",
        { type, code: "KeyJ", key: "ㅓ", windowsVirtualKeyCode: 74 },
        sessionId,
      );
    }
    await wait(500);
    const s = await state();
    ok(s.override === false, "입력창에서의 J 는 조작으로 보지 않는다");
  }

  console.log("\n[G] 광고 중에는 click 을 반복하지 않는다");
  {
    await setup({ adPlaying: true });
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(700);
    const during = await state();
    ok(during.clicks === 0, `광고 중 click 0회 (clicks=${during.clicks})`);
    ok(during.doneFlag === false, "광고 중에는 완료 처리하지 않는다");
    // 광고가 끝나면 접는다.
    await ev(`window.__ad=false`);
    await wait(900);
    const after = await state();
    ok(after.folded === true, "광고 종료 후 접힌다");
    ok(after.clicks === 1, `click 1회 (clicks=${after.clicks})`);
  }

  console.log("\n[H] 버튼이 끝내 안 뜨면 타임아웃으로 완료 처리한다");
  {
    // ⚠ 오버레이가 영원히 '준비 중' 으로 남지 않아야 한다.
    await setup();
    await ev(`(()=>{document.getElementById('foldBtn').remove();
      window.getPopupPlayerChatFoldButton=()=>null;
      window.POPUP_PLAYER_CHAT_FOLD_READY_TIMEOUT_MS=400;return true;})()`);
    await ev(`applyPopupPlayerInitialChatFold()`);
    await wait(1200);
    const s = await state();
    ok(s.doneFlag === true, "타임아웃 후 완료된다");
    ok(s.done === 1, "부모에 완료를 알린다(오버레이 해제)");
  }

  console.log("\n[소스] 가드가 루프 안에 실제로 있다");
  {
    const loop = sliceFn("applyPopupPlayerInitialChatFold");
    ok(
      /if \(popupPlayerChatFoldUserOverride\)/.test(loop),
      "루프가 사용자 조작을 먼저 확인한다",
    );
    ok(/ensurePopupPlayerChatFoldUserWatch\(\)/.test(loop), "감지를 붙인다");
    const watch = sliceFn("ensurePopupPlayerChatFoldUserWatch");
    ok(/e\.isTrusted/.test(watch), "isTrusted 로 우리 click 과 구분한다");
    ok(/KeyJ/.test(watch), "KeyJ 단축키도 본다");
    // ⚠ 기존 '채팅 접힘 유지' 기능 플래그에 묶이면 기본 OFF 라 안 붙는다.
    ok(!/chatFoldPersistOn/.test(watch), "다른 기능 플래그에 묶이지 않는다");
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  await call("Target.closeTarget", { targetId });
  cleanup();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
