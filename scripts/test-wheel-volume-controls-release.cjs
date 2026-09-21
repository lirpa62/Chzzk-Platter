// 휠로 볼륨을 조절한 직후 빠르게 플레이어 밖으로 나가면 하단 컨트롤과
// 되감기 바가 계속 떠 있던 문제.
//
// 원인(실행으로 재현): 휠 볼륨은 컨트롤을 약 850ms 잡아 둔다
// (keepControlsVisible). 그동안 치지직이 컨트롤을 숨기려 하면 우리
// MutationObserver 가 클래스를 즉시 되살린다. 그런데
// releaseControlsVisible 은 holder 를 지우고 observer 만 끊을 뿐,
// '우리가 되살려 놓은' pzp-pc--controls 클래스는 그대로 둔다.
// 그 시점엔 포인터가 이미 플레이어 밖이라 새 leave 가 오지 않아 클래스가
// 영구히 남고, 되감기 바는 그 클래스를 그대로 따라가므로 같이 남는다.
//
// 고침: 휠 holder 가 살아 있는 동안 포인터가 플레이어를 완전히 벗어나면
// 휠 holder 만 조기 해제하고, 다른 유지 사유가 없고 우리가 되살린
// 클래스일 때만 정리한다.
//
// ⚠ 되감기 바는 원인이 아니다(컨트롤 클래스를 그대로 따라갈 뿐). 바에
//   별도 타이머를 넣는 우회 수정은 하지 않는다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "audioMixer.js"), "utf8");

// ⚠ 로직을 손으로 베끼면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

const PIECES = [
  sliceFn("keepControlsVisible"),
  sliceFn("releaseControlsVisible"),
  sliceFn("releaseNativeWheelControls"),
  sliceFn("onNativeWheelPointerOut"),
  sliceFn("keepNativeWheelControlsVisible"),
].join("\n");

// 구조만 확인한다(내용을 확인하면 규칙이 느슨해졌을 때 검사 전에 throw 되어
// 사보타주가 '실패 0건' 으로 보인다).
if (!/controlsHolders/.test(PIECES) || !/pointerout/.test(PIECES)) {
  throw Error("떼어 낸 구간이 컨트롤 유지 경로가 아니다");
}

const dir = mkdtempSync(join(tmpdir(), "cheese-wv-"));
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
    url: "data:text/html,<body></body>",
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await ev(`document.readyState`);
  await wait(250);

  // 실제 플레이어 구조 + 되감기 바(컨트롤 클래스를 그대로 따라간다).
  const setup = ({ withBar = true, seekBarOn = true } = {}) =>
    ev(`(()=>{
      document.documentElement.innerHTML='<head></head><body></body>';
      document.body.innerHTML=
        '<div class="pzp-pc pzp-pc--controls" id="P" style="width:600px;height:340px">'+
        '<div class="pzp-pc__video" id="VW"><video id="V"></video></div>'+
        ${withBar ? `'<div class="cheese-live-seek-bar is-visible" id="BAR"></div>'` : `''`}+
        '</div><div id="OUT">바깥</div>';
      window.VOLUME_TOOLTIP_HIDE_MS=700;
      window.NATIVE_WHEEL_CONTROLS_HOLDER="native-wheel-volume";
      window.CONTROLS_CLASS="pzp-pc--controls";
      window.nativeWheelControlsReleaseTimer=0;
      window.nativeWheelControlsPlayer=null;
      window.controlsObserver=null; window.controlsRoot=null;
      window.controlsHolders=new Set();
      window.controlsRestoredByUs=new WeakMap();
      window.seekBarHovered=false; window.seekBarDragging=false;
      window.findPlayer=()=>document.getElementById('P');
      window.eventTargetElement=(t)=>t instanceof Element?t:null;
      window.playerOfEventTarget=(t)=>{const el=window.eventTargetElement(t);
        return el?el.closest('.pzp-pc'):null;};
      ${PIECES}
      window.keepControlsVisible=keepControlsVisible;
      window.releaseControlsVisible=releaseControlsVisible;
      window.keepNativeWheelControlsVisible=keepNativeWheelControlsVisible;
      // 되감기 바는 컨트롤 클래스를 그대로 따라간다(실제 syncVisible 규칙).
      const P=document.getElementById('P'), BAR=document.getElementById('BAR');
      if (BAR && ${seekBarOn}) {
        new MutationObserver(()=>{
          BAR.classList.toggle('is-visible', window.seekBarDragging || P.classList.contains('pzp-pc--controls'));
        }).observe(P,{attributes:true,attributeFilter:['class']});
      }
      return true;})()`);

  const state = () =>
    ev(`(()=>{const P=document.getElementById('P'),BAR=document.getElementById('BAR');
      return {controls:P.classList.contains('pzp-pc--controls'),
        bar: BAR? BAR.classList.contains('is-visible') : null,
        holders:[...window.controlsHolders],
        obs: !!window.controlsObserver,
        watching: !!window.nativeWheelControlsPlayer};})()`);

  const wheel = (sel = "#V") =>
    ev(`keepNativeWheelControlsVisible(document.querySelector('${sel}'))`);
  // 치지직이 컨트롤을 숨기려는 동작.
  const chzzkHide = () =>
    ev(`document.getElementById('P').classList.remove('pzp-pc--controls')`);
  // 포인터가 플레이어 밖으로 나감.
  const leave = (toId = "OUT") =>
    ev(`(()=>{document.getElementById('P').dispatchEvent(new PointerEvent('pointerout',
      {bubbles:true, relatedTarget:document.getElementById('${toId}')})); return true;})()`);

  console.log("[재현·핵심] 휠 → 빠른 이탈 — 컨트롤·바가 남지 않는다");
  {
    await setup();
    await wheel();
    const afterWheel = await state();
    ok(afterWheel.controls === true, "휠 중에는 컨트롤 유지");
    ok(
      afterWheel.holders.includes("native-wheel-volume"),
      "휠 holder 가 잡힌다",
    );
    await wait(100);
    await chzzkHide(); // 치지직이 숨기려 함 → observer 가 되살린다
    await wait(30);
    await leave();
    await wait(1200); // 850ms holder 해제 시점을 충분히 지난다
    const fin = await state();
    // ⚠ 고치기 전에는 여기서 controls=true, bar=true 로 남았다.
    ok(fin.controls === false, `컨트롤이 사라진다 (controls=${fin.controls})`);
    ok(fin.bar === false, `되감기 바도 사라진다 (bar=${fin.bar})`);
    ok(fin.holders.length === 0, "holder 가 비었다");
    ok(fin.obs === false, "observer 가 끊겼다");
  }

  console.log("\n[아주 빠른 이탈] 휠 직후 즉시 나가도 정상");
  {
    await setup();
    await wheel();
    await chzzkHide();
    await leave();
    await wait(1200);
    const fin = await state();
    ok(fin.controls === false, `컨트롤이 사라진다 (${fin.controls})`);
    ok(fin.bar === false, "되감기 바도 사라진다");
  }

  console.log("\n[이탈 없음] 포인터가 안에 있으면 850ms 동안 유지된다");
  {
    await setup();
    await wheel();
    await wait(400);
    const mid = await state();
    ok(mid.controls === true, "400ms 시점에도 유지된다");
    ok(mid.holders.includes("native-wheel-volume"), "holder 유지");
    await wait(800);
    const fin = await state();
    ok(fin.holders.length === 0, "850ms 뒤 holder 해제");
    // ⚠ 포인터가 안에 있으면 클래스를 건드리지 않는다(치지직 자동 숨김에 맡긴다).
    ok(fin.controls === true, "클래스는 강제로 지우지 않는다");
    ok(fin.watching === false, "이탈 감시를 정리한다");
  }

  console.log("\n[자식 간 이동] 플레이어 내부 이동으로는 풀리지 않는다");
  {
    await setup();
    await wheel();
    await wait(50);
    // video → 플레이어 안의 다른 요소로 이동
    await ev(`(()=>{document.getElementById('P').dispatchEvent(new PointerEvent('pointerout',
      {bubbles:true, relatedTarget:document.getElementById('VW')})); return true;})()`);
    await wait(60);
    const s = await state();
    ok(
      s.holders.includes("native-wheel-volume"),
      "내부 이동에는 holder 가 유지된다",
    );
    ok(s.controls === true, "컨트롤도 유지된다");
  }

  console.log("\n[다른 사유 공존] 믹서/스트림/따라잡기 holder 는 지키다");
  {
    for (const other of ["panel", "stats", "sync"]) {
      await setup();
      await ev(`keepControlsVisible(document.getElementById('P'), '${other}')`);
      await wheel();
      await chzzkHide();
      await leave();
      await wait(1200);
      const fin = await state();
      ok(
        fin.holders.length === 1 && fin.holders[0] === other,
        `${other} holder 만 남는다 (${JSON.stringify(fin.holders)})`,
      );
      // ⚠ 다른 사유가 컨트롤을 원하고 있으면 클래스를 지우면 안 된다.
      ok(fin.controls === true, `${other} 중에는 컨트롤이 유지된다`);
    }
  }

  console.log("\n[바 호버] 되감기 바에 마우스가 있으면 유지된다");
  {
    await setup();
    await wheel();
    await ev(`window.seekBarHovered=true`);
    await chzzkHide();
    await leave();
    await wait(1200);
    const fin = await state();
    ok(fin.controls === true, "바 호버 중에는 컨트롤이 유지된다");
    ok(
      (await ev(`window.seekBarHovered`)) === true,
      "seekBarHovered 를 건드리지 않는다",
    );
  }

  console.log("\n[드래그 중] 바를 잡고 있으면 유지된다");
  {
    await setup();
    await wheel();
    await ev(`window.seekBarDragging=true`);
    await chzzkHide();
    await leave();
    await wait(1200);
    ok((await state()).controls === true, "드래그 중에는 유지된다");
  }

  console.log("\n[연속 휠] 마지막 입력 기준으로 갱신된다");
  {
    await setup();
    await wheel();
    await wait(300);
    await wheel();
    await wait(300);
    await wheel();
    const mid = await state();
    ok(mid.holders.includes("native-wheel-volume"), "연속 휠 중 유지");
    await wait(400);
    // 첫 휠 기준 850ms 는 지났지만 마지막 휠 기준으론 아직이다.
    ok(
      (await state()).holders.includes("native-wheel-volume"),
      "이전 타이머가 먼저 풀지 않는다",
    );
    await wait(700);
    ok((await state()).holders.length === 0, "마지막 휠 기준으로 해제된다");
  }

  console.log("\n[연속 휠 후 이탈] 중간 타이머가 꼬이지 않는다");
  {
    await setup();
    await wheel();
    await wait(300);
    await wheel();
    await wait(300);
    await wheel();
    await wait(100);
    await chzzkHide();
    await leave();
    await wait(1200);
    const fin = await state();
    ok(fin.controls === false, "정상적으로 해제된다");
    ok(fin.holders.length === 0, "holder 가 비었다");
  }

  console.log("\n[되감기 바 없음] 바가 없어도 컨트롤이 고정되지 않는다");
  {
    // ⚠ 수정이 바 DOM 존재에 의존하면 안 된다(VOD·타임머신 방송).
    await setup({ withBar: false });
    await wheel();
    await chzzkHide();
    await leave();
    await wait(1200);
    const fin = await state();
    ok(fin.controls === false, `바가 없어도 해제된다 (${fin.controls})`);
  }

  console.log("\n[바 옵션 OFF] 바 동기화가 없어도 동일");
  {
    await setup({ seekBarOn: false });
    await wheel();
    await chzzkHide();
    await leave();
    await wait(1200);
    ok((await state()).controls === false, "해제된다");
  }

  console.log("\n[원래 켜져 있던 컨트롤] 우리가 되살린 게 아니면 두다");
  {
    // 치지직이 숨기려 한 적이 없으면(우리가 되살린 적 없음) 클래스를 지우지 않는다.
    await setup();
    await wheel();
    await leave(); // 치지직 숨김 시도 없이 바로 이탈
    await wait(200);
    const fin = await state();
    ok(fin.controls === true, `되살린 적 없으면 그대로 둔다 (${fin.controls})`);
    ok(fin.holders.length === 0, "holder 는 해제된다");
  }

  console.log("\n[이탈 후 재진입] 다음 hover 가 정상 동작한다");
  {
    await setup();
    await wheel();
    await chzzkHide();
    await leave();
    await wait(1200);
    ok((await state()).controls === false, "먼저 정상 해제");
    // 치지직이 다시 표시(hover)
    await ev(`document.getElementById('P').classList.add('pzp-pc--controls')`);
    await wait(50);
    const back = await state();
    ok(back.controls === true, "재진입 시 컨트롤이 정상 표시된다");
    ok(back.bar === true, "되감기 바도 다시 보인다");
  }

  console.log("\n[플레이어 교체] 이전 플레이어에 상태가 남지 않는다");
  {
    await setup();
    await wheel();
    await wait(50);
    // SPA 전환처럼 플레이어를 교체한다.
    await ev(`(()=>{const old=document.getElementById('P');
      old.id='OLD';
      const np=document.createElement('div');
      np.className='pzp-pc pzp-pc--controls'; np.id='P';
      np.innerHTML='<div class="pzp-pc__video"><video id="V2"></video></div>';
      document.body.appendChild(np); return true;})()`);
    await ev(`keepNativeWheelControlsVisible(document.querySelector('#V2'))`);
    await wait(50);
    const s = await ev(`(()=>({
      watchingNew: window.nativeWheelControlsPlayer === document.getElementById('P'),
      oldHasClass: document.getElementById('OLD').classList.contains('pzp-pc--controls')
    }))()`);
    ok(s.watchingNew === true, "새 플레이어를 감시한다");
    // 이전 플레이어 클래스를 함부로 건드리지 않는다.
    ok(s.oldHasClass === true, "이전 플레이어를 임의로 바꾸지 않는다");
  }

  console.log("\n[소스] 우회 수정을 쓰지 않았다");
  {
    const rel = sliceFn("releaseNativeWheelControls");
    ok(
      /controlsHolders\.has\(NATIVE_WHEEL_CONTROLS_HOLDER\)/.test(rel),
      "휠 holder 가 있을 때만 동작한다",
    );
    ok(
      /if \(controlsHolders\.size > 0\) return;/.test(rel),
      "다른 사유가 남으면 클래스를 건드리지 않는다",
    );
    ok(
      /controlsRestoredByUs\.get\(player\)/.test(rel),
      "우리가 되살린 클래스일 때만 정리한다",
    );
    ok(
      /seekBarHovered \|\| seekBarDragging/.test(rel),
      "바 호버·드래그 중에는 유지한다",
    );
    // ⚠ 금지된 우회들.
    ok(
      !/controlsHolders\.clear\(\)/.test(SRC),
      "holder 를 통째로 비우지 않는다",
    );
    const out = sliceFn("onNativeWheelPointerOut");
    ok(
      /player\.contains\(to\)/.test(out),
      "플레이어 내부 이동과 실제 이탈을 구분한다",
    );
    // 되감기 바에 별도 타이머를 넣지 않았다.
    ok(
      !/seekBarHideTimer|barHideTimeout/.test(SRC),
      "되감기 바에 별도 숨김 타이머를 넣지 않는다",
    );
    // 휠 경로는 document 전역 감시를 쓰지 않는다(해당 플레이어에만 붙인다).
    // ⚠ 바 드래그의 mousemove 는 mousedown~mouseup 동안만 붙는 기존 코드라
    //   여기 검사 대상이 아니다. 휠 경로만 본다.
    const wheelPaths = [
      sliceFn("keepNativeWheelControlsVisible"),
      sliceFn("releaseNativeWheelControls"),
      sliceFn("onNativeWheelPointerOut"),
    ].join("\n");
    ok(
      !/document\.addEventListener/.test(wheelPaths),
      "휠 경로가 document 전역 리스너를 만들지 않는다",
    );
    ok(
      /player\.addEventListener\("pointerout"/.test(wheelPaths),
      "해당 플레이어에만 이탈 감시를 붙인다",
    );
    ok(
      /removeEventListener\("pointerout"/.test(wheelPaths),
      "감시를 정리한다(영구 리스너가 남지 않는다)",
    );
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
