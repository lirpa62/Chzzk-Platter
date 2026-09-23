// 싱크 패널 버튼을 눌러도 DOM 이 통째로 다시 만들어지지 않는지.
//
// 증상: 기준·±0.1·±0.5·초기화를 누를 때마다 패널이 깜빡였다.
//
// 원인: 누를 때마다 renderSync 가 panel.innerHTML 을 새로 썼다. 포커스를
//   되돌려 줘도 누른 버튼과 행이 전부 새 Element 로 바뀌므로, 커서 아래에서
//   DOM 이 교체돼 깜빡임으로 보인다.
//
// 고침: 값만 바뀌는 조작에서는 기존 Element 를 그대로 두고 글자·상태만 고친다
//   (patchSyncPanel). 구조가 바뀌면 그때만 전체 렌더로 내려간다.
//
// ⚠ '문자열이 있다' 식 소스 검사로는 이 문제를 증명할 수 없다. 실제 브라우저에서
//   Element 동일성(===)을 본다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(
  join(__dirname, "..", "src", "multiviewWatch.js"),
  "utf8",
);
const CSS = readFileSync(join(__dirname, "..", "src", "multiview.css"), "utf8");
const POPUP = readFileSync(join(__dirname, "..", "src", "popup.css"), "utf8");
const SYNC_SRC = readFileSync(
  join(__dirname, "..", "src", "multiviewSync.js"),
  "utf8",
);

// ⚠ 렌더 로직을 손으로 베끼면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

const PIECES = [
  "getSyncRowViewState",
  "syncNudgePending",
  "setSyncButtonState",
  "syncScopeIds",
  "inSyncScope",
  "syncRateText",
  "syncGroupTooSmall",
  "syncEligibleIds",
  "syncActiveIds",
  "patchSyncPanel",
  "refreshSyncPanel",
  "renderSync",
  "pendingSync",
  "sendSyncCommand",
  "finishSyncCommand",
]
  .map(sliceFn)
  .join("\n");

if (!/panel\.innerHTML/.test(PIECES) || !/patchSyncPanel/.test(PIECES)) {
  throw Error("떼어 낸 구간이 싱크 렌더 경로가 아니다");
}

// 클릭 처리도 원본을 그대로 쓴다. document 위임 리스너 안에서 싱크 행 버튼
// (기준·±·개별 초기화)을 다루는 구간만 떼어 와 같은 모양의 리스너에 넣는다.
const HANDLER = (() => {
  const from = SRC.indexOf(
    '    const syncRef = target.closest?.("[data-mv-sync-ref]");',
  );
  const to = SRC.indexOf(
    '    const syncScopeBtn = target.closest?.("[data-mv-sync-scope]");',
  );
  if (from < 0 || to < from) throw Error("싱크 버튼 클릭 구간을 찾지 못했다");
  return SRC.slice(from, to);
})();
for (const want of [
  "[data-mv-sync-ref]",
  "[data-mv-sync-offset]",
  "[data-mv-sync-clear]",
]) {
  if (!HANDLER.includes(want)) throw Error(`클릭 구간에 ${want} 처리가 없다`);
}

const dir = mkdtempSync(join(tmpdir(), "cheese-sd-"));
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
      throw Error("EXC " + JSON.stringify(r.exceptionDetails).slice(0, 700));
    return r.result.value;
  };
  await ev(`document.readyState`);
  await new Promise((r) => setTimeout(r, 200));

  // 실제 렌더 함수를 그대로 올리고, 바깥 의존값만 넣어 준다.
  await ev(`(()=>{
    document.documentElement.innerHTML='<head></head><body></body>';
    for (const css of [${JSON.stringify(POPUP)}, ${JSON.stringify(CSS)}]) {
      const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s);
    }
    document.body.innerHTML='<div class="mv-pop-panel mv-sync-pop" id="mvSyncPop"></div>'+
      '<span id="mvSyncValue"></span>';

    ${SYNC_SRC}
    const SYNC = globalThis.CheeseMultiviewSync;

    const NOW = 1000000;
    let clock = NOW;
    window.__setClock=(v)=>{clock=v;};
    Date.now = () => clock;

    const ids=['a','b','c'];
    window.state={
      chosen: ids.map((id)=>({channelId:id, channelName:'채널'+id})),
      sync:{ mode:'manual', scope:'all', selectedChannelIds:[],
        referenceChannelId:null, manualOffsets:{a:0,b:0,c:0},
        congested:false, diagnosticsEnabled:false },
    };
    const mkStats=(delay)=>({currentTime:100, playbackRate:1, paused:false,
      readyState:4, syncRateOwned:false, userRateOverride:false,
      nativeDelaySec:delay, bufferAheadSec:4, edgeLagSec:1,
      seekableStart:80, seekableEnd:130, generation:1, receivedAt:clock});
    window.syncStats=new Map(ids.map((id,i)=>[id, mkStats(5-i*0.7)]));
    window.syncReadyAt=new Map(ids.map((id)=>[id, NOW-30000]));
    window.refreshStats=()=>{
      for (const [id,st] of syncStats) syncStats.set(id,{...st, receivedAt:clock});
    };

    // 명령 경로는 원본 함수를 그대로 쓴다(pendingSync·sendSyncCommand·finishSyncCommand).
    window.pendingSyncCommands=new Map();
    window.syncCommandSeq=0;
    window.syncGeneration=new Map([['a',1],['b',1],['c',1]]);
    window.syncRetryAt=new Map();
    window.syncSeekAt=new Map();
    window.syncRates=new Map();
    window.sentSync=[];
    window.sendSync=(id,type,extra)=>{sentSync.push({id,type,extra}); return true;};
    window.recordSyncDiagnostic=()=>{};
    window.diagnosticDesiredValue=(v)=>v;
    window.syncChannelName=(id)=>'채널'+id;
    window.resetSyncRate=()=>{};
    window.updateSyncPolling=()=>{};
    window.currentStatus=()=>'ready';
    window.channelName=(id)=>'채널'+id;
    window.esc=(v)=>String(v).replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    window.fmtSyncSeconds=(v)=>Number.isFinite(v)?v.toFixed(1)+'초':'-';
    window.syncNotice='';
    window.syncDiagnostics=new Map();
    window.syncDiagnosticsStartedAt=0;
    window.syncDiagnosticsNotice='';
    window.DIAGNOSTICS={formatDuration:()=>'0초'};
    window.$=(id)=>document.getElementById(id);
    // 클릭 구간이 부르는 바깥 함수. 기록만 하거나 명령 경로로 넘긴다.
    window.cells=new Map(ids.map((id)=>[id,{}]));
    window.refChanges=[];
    window.recordReferenceChange=(from,to,why)=>{refChanges.push({from,to,why});};
    window.cancelPendingSync=(id)=>{
      for (const [k,e] of pendingSyncCommands) {
        if (e.channelId===id) { clearTimeout(e.timeout); pendingSyncCommands.delete(k); }
      }
    };
    window.resetAllSyncRates=()=>{};
    // ⚠ alignSync(자동 정렬 계획)는 이 테스트 대상이 아니다. 개별 초기화가 보내는
    //   것과 같은 seek(commitOffset) 명령만 원본 sendSyncCommand 로 보낸다.
    window.alignCalls=[];
    window.alignSync=(targetIds,manual,overrides,commit)=>{
      alignCalls.push({targetIds,manual,overrides,commit});
      if (!targetIds || !overrides) return;
      for (const id of targetIds) {
        const st=syncStats.get(id), before=state.sync.manualOffsets[id]||0;
        const t=st.currentTime+before-overrides[id];
        sendSyncCommand(id,'seek','APPLY_SYNC_SEEK',{currentTime:t,manual:true},
          {currentTime:t,manual:true,offset:overrides[id],commitOffset:!!commit});
      }
    };

    ${PIECES}
    window.renderSync=renderSync;
    window.patchSyncPanel=patchSyncPanel;
    window.refreshSyncPanel=refreshSyncPanel;
    window.sendSyncCommand=sendSyncCommand;
    window.finishSyncCommand=finishSyncCommand;
    window.getSyncRowViewState=getSyncRowViewState;
    document.addEventListener('click',(event)=>{
      const target=event.target;
      ${HANDLER}
    });
    return true;})()`);

  await ev(`renderSync(true)`);

  const snap = () =>
    ev(`(()=>{
      const p=document.getElementById('mvSyncPop');
      window.__rows=[...p.querySelectorAll('[data-mv-sync-row]')];
      window.__btns=window.__rows.map(r=>[...r.querySelectorAll('button,output')]);
      return {rows:window.__rows.length, btns:window.__btns.flat().length};})()`);

  const same = () =>
    ev(`(()=>{
      const p=document.getElementById('mvSyncPop');
      const rows=[...p.querySelectorAll('[data-mv-sync-row]')];
      const btns=rows.map(r=>[...r.querySelectorAll('button,output')]);
      const rowsSame = rows.length===window.__rows.length &&
        rows.every((r,i)=>r===window.__rows[i]);
      const btnsSame = btns.length===window.__btns.length &&
        btns.every((g,i)=>g.length===window.__btns[i].length &&
          g.every((el,j)=>el===window.__btns[i][j]));
      return {rowsSame, btnsSame};})()`);

  console.log("[초기] 행과 컨트롤이 그려진다");
  {
    const s = await snap();
    ok(s.rows === 3, `행 3개 (${s.rows})`);
    ok(s.btns > 0, `컨트롤이 있다 (${s.btns})`);
    // 그려진 버튼의 실제 문구: ± 는 재생 위치 이동이고, 배속 표현이 없다.
    const labels =
      await ev(`[...document.querySelectorAll('[data-mv-sync-row="a"] [data-mv-sync-offset]')]
      .map(b=>({step:b.dataset.step, title:b.title, aria:b.getAttribute('aria-label')}))`);
    const want = {
      "-0.5": "재생 위치를 0.5초 앞으로 이동(라이브 쪽)",
      "-0.1": "재생 위치를 0.1초 앞으로 이동(라이브 쪽)",
      0.1: "재생 위치를 0.1초 뒤로 이동(과거 쪽)",
      0.5: "재생 위치를 0.5초 뒤로 이동(과거 쪽)",
    };
    ok(
      labels.length === 4 && labels.every((l) => l.title === want[l.step]),
      `± title 이 재생 위치 방향과 맞다 (${JSON.stringify(labels.map((l) => l.title))})`,
    );
    ok(
      labels.every(
        (l) => l.aria === `채널a ${want[l.step].replace(/\(.*\)$/, "")}`,
      ),
      `± aria-label 이 채널명 + 재생 위치 이동이다 (${labels[0]?.aria})`,
    );
    ok(
      labels.every(
        (l) => !/빠르게 재생|느리게 재생|재생 속도/.test(l.title + l.aria),
      ),
      "± 버튼에 배속 표현이 없다",
    );
  }

  console.log("\n[제자리 갱신] 값이 바뀌어도 Element 가 그대로다");
  {
    await ev(`state.sync.manualOffsets.b = 0.3; refreshSyncPanel();`);
    const r = await same();
    ok(r.rowsSame, "행 Element 가 유지된다");
    ok(r.btnsSame, "버튼·output Element 가 유지된다");
    const out = await ev(
      `document.querySelector('[data-mv-sync-row="b"] [data-mv-sync-output]').textContent`,
    );
    ok(out.includes("+0.3"), `보정값이 갱신된다 (${out})`);
  }

  console.log("\n[첫 클릭] 안내 문구가 처음 생겨도 Element 가 그대로다");
  {
    // ⚠ 버튼 처리는 syncNotice 를 세운 뒤 refreshSyncPanel 을 부른다. 안내가
    //   없던 자리에 새로 생기면 제자리 갱신이 포기되고 전체 렌더로 내려갔다.
    //   그래서 가장 흔한 '첫 클릭' 이 여전히 DOM 을 통째로 바꿨다.
    await snap();
    await ev(
      `syncNotice='수동 보정을 적용 중입니다.'; ` +
        `state.sync.manualOffsets.b = 0.4; refreshSyncPanel('[data-mv-sync-offset="b"][data-step="0.1"]');`,
    );
    const r = await same();
    ok(r.rowsSame, "안내가 새로 생겨도 행 Element 가 유지된다");
    ok(r.btnsSame, "안내가 새로 생겨도 버튼 Element 가 유지된다");
    const shown =
      await ev(`(()=>{const n=document.querySelector('#mvSyncPop .mv-sync-notice');
      return n && !n.hidden ? n.textContent : null;})()`);
    ok(shown === "수동 보정을 적용 중입니다.", `안내가 보인다 (${shown})`);
    // 안내가 사라지는 경우도 같다.
    await ev(`syncNotice=''; refreshSyncPanel();`);
    const r2 = await same();
    ok(r2.rowsSame && r2.btnsSame, "안내가 사라져도 Element 가 유지된다");
    // 속성만 보지 않고 실제로 화면에서 빠지는지(계산된 display)를 본다.
    const gone =
      await ev(`(()=>{const n=document.querySelector('#mvSyncPop .mv-sync-notice');
      return !n || getComputedStyle(n).display === 'none';})()`);
    ok(gone === true, "비운 안내가 화면에서 사라진다");
  }

  console.log("\n[기준 변경] 행을 새로 만들지 않고 표시만 옮긴다");
  {
    await ev(`state.sync.referenceChannelId='b'; refreshSyncPanel();`);
    const r = await same();
    ok(r.rowsSame, "기준이 바뀌어도 행 Element 가 유지된다");
    ok(r.btnsSame, "기준이 바뀌어도 버튼 Element 가 유지된다");
    const cls = await ev(`(()=>{
      const rows=[...document.querySelectorAll('[data-mv-sync-row]')];
      return rows.map(r=>[r.dataset.mvSyncRow, r.classList.contains('is-reference')]);})()`);
    ok(
      JSON.stringify(cls) ===
        JSON.stringify([
          ["a", false],
          ["b", true],
          ["c", false],
        ]),
      `기준 표시가 b 로 옮겨간다 (${JSON.stringify(cls)})`,
    );
    const refState =
      await ev(`(()=>{const b=document.querySelector('[data-mv-sync-ref="b"]');
      return {disabled:b.disabled, aria:b.getAttribute('aria-disabled')};})()`);
    // ⚠ 진짜 disabled 로 두면 방금 누른 기준 버튼에서 포커스가 body 로 빠진다.
    ok(
      refState.aria === "true" && refState.disabled === false,
      `기준 채널의 기준 버튼은 aria-disabled 로 잠긴다 (${JSON.stringify(refState)})`,
    );
  }

  // 브라우저는 포커스된 버튼이 disabled 가 되면 다음 프레임쯤 포커스를 body 로
  // 옮긴다. 바로 읽으면 이 현상을 놓치므로 두 프레임을 기다린 뒤에 본다.
  const frames = () =>
    ev(
      `new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`,
    );

  console.log("\n[기준 클릭] 누른 기준 버튼에 포커스가 남고 스크롤도 그대로다");
  {
    await snap();
    // 패널을 스크롤되게 만들어 scrollTop 이 보존되는지도 본다.
    await ev(`(()=>{const p=document.getElementById('mvSyncPop');
      p.style.maxHeight='120px'; p.style.overflow='auto'; p.scrollTop=40; return p.scrollTop;})()`);
    // 마우스 클릭처럼 스크롤 없이 포커스를 준다(.focus() 기본값은 버튼을 화면
    // 안으로 끌어와 scrollTop 을 바꾼다 — 갱신과 무관한 움직임이다).
    await ev(
      `document.querySelector('[data-mv-sync-ref="c"]').focus({preventScroll:true})`,
    );
    const top0 = await ev(`document.getElementById('mvSyncPop').scrollTop`);
    // 기준 b 에서 c 로 옮기면 보정값이 c 기준으로 다시 계산되어야 한다.
    const plan = await ev(`(()=>{
      state.sync.manualOffsets={a:0.2,b:0,c:-0.3}; refreshSyncPanel();
      const want=globalThis.CheeseMultiviewSync.rebaseOffsets(
        {...state.sync.manualOffsets},'c',state.chosen.map((c)=>c.channelId));
      document.querySelector('[data-mv-sync-ref="c"]').click();
      return {ref:state.sync.referenceChannelId, got:{...state.sync.manualOffsets}, want,
        outA:document.querySelector('[data-mv-sync-row="a"] [data-mv-sync-output]').textContent,
        cls:[...document.querySelectorAll('[data-mv-sync-row]')]
          .map((r)=>r.classList.contains('is-reference'))};})()`);
    ok(plan.ref === "c", `기준이 c 로 바뀐다 (${plan.ref})`);
    ok(
      JSON.stringify(plan.got) === JSON.stringify(plan.want) &&
        plan.got.c === 0,
      `보정값이 새 기준으로 다시 계산된다 (${JSON.stringify(plan.got)})`,
    );
    ok(
      plan.outA.startsWith(
        `${plan.got.a >= 0 ? "+" : ""}${plan.got.a.toFixed(1)}초`,
      ),
      `다른 행 출력도 새 보정값이다 (${plan.outA})`,
    );
    ok(
      JSON.stringify(plan.cls) === JSON.stringify([false, false, true]),
      `예전 기준(b)의 표시가 빠지고 c 로 옮겨간다 (${JSON.stringify(plan.cls)})`,
    );
    await frames();
    const f = await ev(`(()=>{const a=document.activeElement;
      return {ref:a?.dataset?.mvSyncRef ?? null, tag:a?.tagName,
        same:a===window.__btns[2].find(el=>el.dataset.mvSyncRef==='c')};})()`);
    ok(
      f.ref === "c" && f.same,
      `누른 기준 버튼 그 Element 에 포커스가 남는다 (${JSON.stringify(f)})`,
    );
    const top1 = await ev(`document.getElementById('mvSyncPop').scrollTop`);
    ok(
      top0 > 0 && top1 === top0,
      `패널 scrollTop 이 그대로다 (${top0} → ${top1})`,
    );
    const r = await same();
    ok(r.rowsSame && r.btnsSame, "기준을 바꿔도 행·버튼 Element 가 그대로다");
    // 이미 기준인 버튼(aria-disabled)을 다시 눌러도 아무 일도 하지 않는다.
    const again =
      await ev(`(()=>{const n=refChanges.length, m=alignCalls.length;
      document.querySelector('[data-mv-sync-ref="c"]').click();
      return {ref:refChanges.length-n, align:alignCalls.length-m};})()`);
    ok(
      again.ref === 0 && again.align === 0,
      `이미 기준인 채널을 다시 눌러도 처리하지 않는다 (${JSON.stringify(again)})`,
    );
    await ev(`(()=>{const p=document.getElementById('mvSyncPop');
      p.style.maxHeight=''; p.style.overflow='';
      document.querySelector('[data-mv-sync-ref="b"]').click();})()`);
  }

  // 버튼에 포커스를 주고 실제로 누른다(원본 클릭 구간이 처리한다).
  const clickNudge = (id, step) =>
    ev(`(()=>{
      const btn=document.querySelector('[data-mv-sync-offset="${id}"][data-step="${step}"]');
      btn.focus({preventScroll:true});
      const before=state.sync.manualOffsets['${id}']||0;
      const next=Math.round((before+(${step}))*10)/10;
      const n=sentSync.length;
      btn.click();
      const cmd=sentSync.slice(n).find((m)=>m.id==='${id}');
      const entry=[...pendingSyncCommands.values()]
        .find(e=>e.channelId==='${id}' && e.command==='nudge');
      return {sent:!!cmd, deltaSec:cmd?.extra?.deltaSec ?? null,
        commandId: entry?.commandId ?? null, next};})()`);

  const rowState = (id) =>
    ev(`(()=>{
      const row=document.querySelector('[data-mv-sync-row="${id}"]');
      return {
        output: row.querySelector('[data-mv-sync-output]').textContent,
        offsetsDisabled: [...row.querySelectorAll('[data-mv-sync-offset]')].map(b=>b.disabled),
        offsetsBusy: [...row.querySelectorAll('[data-mv-sync-offset]')]
          .map(b=>b.getAttribute('aria-disabled')==='true'),
        notice: (()=>{const n=document.querySelector('#mvSyncPop .mv-sync-notice');
          return n && getComputedStyle(n).display!=='none' ? n.textContent : '';})(),
        focusStep: document.activeElement?.dataset?.step ?? null,
        offset: state.sync.manualOffsets['${id}']||0,
      };})()`);

  console.log("\n[응답 성공] 적용 중 → 확정, Element·포커스 유지");
  {
    await snap();
    const c = await clickNudge("c", "-0.1");
    ok(c.sent && c.commandId, `명령이 나갔다 (commandId=${c.commandId})`);
    let st = await rowState("c");
    ok(st.output.includes("적용 중"), `보내는 즉시 '적용 중' (${st.output})`);
    ok(
      st.offsetsBusy.every(Boolean),
      "보류 중에는 ± 버튼이 aria-disabled 로 잠긴다",
    );
    ok(
      st.offsetsDisabled.every((d) => !d),
      "보류 중에도 진짜 disabled 는 걸지 않는다(포커스가 body 로 빠진다)",
    );
    await frames();
    st = await rowState("c");
    ok(
      st.focusStep === "-0.1",
      `두 프레임 뒤에도 누른 버튼에 포커스가 남는다 (${st.focusStep})`,
    );
    // 보류 중에 다른 ± 를 눌러도 새 명령이 나가지 않는다(aria-disabled 는 클릭을 막지 않는다).
    const extra = await ev(`(()=>{const n=sentSync.length;
      document.querySelector('[data-mv-sync-offset="c"][data-step="-0.5"]').click();
      return sentSync.length-n;})()`);
    ok(extra === 0, `보류 중 다시 눌러도 명령이 더 나가지 않는다 (${extra})`);
    let r = await same();
    ok(r.rowsSame && r.btnsSame, "클릭 직후 행·버튼 Element 가 그대로다");

    await ev(`finishSyncCommand('c',{commandId:${c.commandId},command:'nudge',applied:true,
      reason:null,generation:1,actualCurrentTime:100.1,actualPlaybackRate:1})`);
    st = await rowState("c");
    ok(
      st.offset === c.next,
      `성공 응답에서만 보정값이 확정된다 (${st.offset})`,
    );
    ok(!st.output.includes("적용 중"), `'적용 중' 이 풀린다 (${st.output})`);
    ok(
      st.offsetsDisabled.every((d) => !d) && st.offsetsBusy.every((d) => !d),
      "± 버튼이 다시 열린다",
    );
    ok(
      st.notice === "수동 보정을 적용했습니다.",
      `안내가 바뀐다 (${st.notice})`,
    );
    ok(st.focusStep === "-0.1", "응답 뒤에도 포커스가 그대로다");
    r = await same();
    ok(
      r.rowsSame && r.btnsSame,
      "응답 처리 뒤에도 행·버튼 Element 가 그대로다",
    );
  }

  console.log("\n[응답 실패] 보정값은 그대로, 버튼은 다시 열린다");
  {
    await ev(`__setClock(Date.now()+400); refreshStats();`);
    const before = (await rowState("c")).offset;
    const c = await clickNudge("c", "-0.1");
    ok(c.sent, "명령이 나갔다");
    await ev(`finishSyncCommand('c',{commandId:${c.commandId},command:'nudge',applied:false,
      reason:'range',generation:1,actualCurrentTime:100,actualPlaybackRate:1})`);
    const st = await rowState("c");
    ok(
      st.offset === before,
      `실패하면 보정값을 바꾸지 않는다 (${before} → ${st.offset})`,
    );
    ok(!st.output.includes("적용 중"), "'적용 중' 이 풀린다");
    ok(
      st.offsetsDisabled.every((d) => !d),
      "± 버튼이 다시 열린다",
    );
    ok(/적용하지 못했습니다/.test(st.notice), `실패 안내 (${st.notice})`);
    const r = await same();
    ok(
      r.rowsSame && r.btnsSame,
      "실패 처리 뒤에도 행·버튼 Element 가 그대로다",
    );
  }

  console.log("\n[응답 없음] 타임아웃에도 '적용 중' 이 남지 않는다");
  {
    // 실패 뒤 재시도 대기(commandRetryMs)를 넘긴다.
    await ev(`__setClock(Date.now()+2000); refreshStats();`);
    const before = (await rowState("c")).offset;
    const c = await clickNudge("c", "0.1");
    ok(c.sent, "명령이 나갔다");
    ok(
      (await rowState("c")).output.includes("적용 중"),
      "보내는 즉시 '적용 중'",
    );
    // 실제 타이머(commandTimeoutMs=2초)가 돌게 둔다. 포커스는 버튼에 남아 있다.
    await new Promise((r) => setTimeout(r, 2300));
    const st = await rowState("c");
    ok(
      st.focusStep === "0.1",
      `타임아웃까지 포커스가 버튼에 있다 (${st.focusStep})`,
    );
    // ⚠ 예전에는 여기서 renderSync() 를 불렀는데, 포커스가 패널 안에 있어
    //   가드가 렌더를 건너뛰었다. '적용 중' 이 영영 풀리지 않았다.
    ok(
      !st.output.includes("적용 중"),
      `타임아웃 뒤 '적용 중' 이 풀린다 (${st.output})`,
    );
    ok(st.offset === before, "타임아웃은 보정값을 바꾸지 않는다");
    ok(
      st.offsetsDisabled.every((d) => !d),
      "± 버튼이 다시 열린다",
    );
    ok(/응답이 없어/.test(st.notice), `타임아웃 안내 (${st.notice})`);
    const r = await same();
    ok(r.rowsSame && r.btnsSame, "타임아웃 뒤에도 행·버튼 Element 가 그대로다");
  }

  console.log("\n[포커스·스크롤] 조작 중에도 흔들리지 않는다");
  {
    await ev(
      `document.querySelector('[data-mv-sync-offset="c"][data-step="-0.1"]').focus()`,
    );
    const before = await ev(`document.activeElement?.dataset?.step ?? ''`);
    await ev(`state.sync.manualOffsets.c = -0.1; refreshSyncPanel();`);
    const after = await ev(`document.activeElement?.dataset?.step ?? ''`);
    ok(
      before === "-0.1" && after === "-0.1",
      `포커스가 그대로다 (${before} → ${after})`,
    );
    const r = await same();
    ok(r.rowsSame && r.btnsSame, "포커스 유지 중에도 Element 가 그대로다");
  }

  console.log("\n[연타] 실제 클릭 → 응답을 되풀이해도 교체·포커스 이동이 없다");
  {
    // 각 단계의 실제 seek 방향도 본다. 핸들러는 deltaSec = before - next 를
    // 보내고, 받는 쪽은 currentTime + deltaSec 로 옮긴다.
    // −(앞으로)는 +deltaSec(라이브 쪽), +(뒤로)는 −deltaSec(과거 쪽)이어야 한다.
    await ev(`(()=>{const p=document.getElementById('mvSyncPop');
      p.style.maxHeight='120px'; p.style.overflow='auto'; p.scrollTop=30;})()`);
    await snap();
    const top0 = await ev(`document.getElementById('mvSyncPop').scrollTop`);
    const seq = ["-0.1", "-0.5", "0.1", "0.5", "-0.1", "0.1"];
    // 앞 구간의 타임아웃이 남긴 재시도 대기(commandRetryMs)를 넘긴다.
    let clock = (await ev(`Date.now()`)) + 2000;
    const dirs = [];
    let lost = null;
    for (const step of seq) {
      clock += 400; // 성공 직후 250ms 재조작 대기를 넘긴다
      await ev(`__setClock(${clock}); refreshStats();`);
      const c = await clickNudge("c", step);
      if (!c.sent || !c.commandId) {
        lost = `${step}: 명령이 나가지 않았다`;
        break;
      }
      dirs.push([step, Math.round(c.deltaSec * 10) / 10]);
      await frames();
      const focused = await ev(
        `document.activeElement?.dataset?.step ?? document.activeElement?.tagName`,
      );
      if (focused !== step) {
        lost = `${step}: 포커스가 ${focused} 로 옮겨갔다`;
        break;
      }
      await ev(`finishSyncCommand('c',{commandId:${c.commandId},command:'nudge',applied:true,
        reason:null,generation:1,actualCurrentTime:100,actualPlaybackRate:1})`);
    }
    ok(!lost, `연타 중 명령·포커스가 유지된다 (${lost || "ok"})`);
    ok(
      JSON.stringify(dirs) ===
        JSON.stringify([
          ["-0.1", 0.1],
          ["-0.5", 0.5],
          ["0.1", -0.1],
          ["0.5", -0.5],
          ["-0.1", 0.1],
          ["0.1", -0.1],
        ]),
      `버튼 방향과 실제 이동 방향이 맞다 (${JSON.stringify(dirs)})`,
    );
    const r = await same();
    ok(r.rowsSame, "연타 후에도 행 Element 가 그대로다");
    ok(r.btnsSame, "연타 후에도 버튼 Element 가 그대로다");
    const top1 = await ev(`document.getElementById('mvSyncPop').scrollTop`);
    ok(
      top0 > 0 && top1 === top0,
      `연타 후에도 scrollTop 이 그대로다 (${top0} → ${top1})`,
    );
    await ev(`(()=>{const p=document.getElementById('mvSyncPop');
      p.style.maxHeight=''; p.style.overflow='';})()`);
  }

  console.log("\n[개별 초기화] 누른 버튼이 0 이 된 뒤에도 포커스가 남는다");
  {
    // ⚠ 초기화가 성공하면 보정값이 0 이 되어 '되돌릴 것이 없는' 상태가 된다.
    //   이때 진짜 disabled 를 걸면 방금 누른 버튼에서 포커스가 body 로 빠진다.
    await ev(`__setClock(Date.now()+2000); refreshStats();
      state.sync.manualOffsets.c = 0.3; refreshSyncPanel();`);
    await snap();
    const c = await ev(`(()=>{
      const btn=document.querySelector('[data-mv-sync-clear="c"]');
      btn.focus({preventScroll:true});
      btn.click();
      const entry=[...pendingSyncCommands.values()]
        .find(e=>e.channelId==='c' && e.command==='seek');
      return {commandId: entry?.commandId ?? null,
        commit: entry?.desiredValue?.commitOffset ?? null};})()`);
    ok(
      c.commandId && c.commit === true,
      `초기화 명령이 나갔다 (${JSON.stringify(c)})`,
    );
    const clearState = () =>
      ev(`(()=>{const b=document.querySelector('[data-mv-sync-clear="c"]');
        return {disabled:b.disabled, aria:b.getAttribute('aria-disabled'),
          focused:document.activeElement===b};})()`);
    let st = await clearState();
    ok(
      st.aria === "true" && !st.disabled,
      `보류 중 초기화 버튼은 aria-disabled (${JSON.stringify(st)})`,
    );
    // 초기화(seek) 보류 중에 ± 를 누르면 두 보정이 겹친다. 보내지 않아야 한다.
    const overlap = await ev(`(()=>{const n=sentSync.length;
      document.querySelector('[data-mv-sync-offset="c"][data-step="-0.1"]').click();
      return sentSync.length-n;})()`);
    ok(
      overlap === 0,
      `초기화 보류 중 ± 를 눌러도 명령이 나가지 않는다 (${overlap})`,
    );
    await ev(
      `document.querySelector('[data-mv-sync-clear="c"]').focus({preventScroll:true})`,
    );
    await ev(`finishSyncCommand('c',{commandId:${c.commandId},command:'seek',applied:true,
      reason:null,generation:1,actualCurrentTime:100.3,actualPlaybackRate:1})`);
    await frames();
    st = await clearState();
    const off = await ev(`state.sync.manualOffsets.c`);
    ok(off === 0, `성공 응답으로 보정값이 0 이 된다 (${off})`);
    ok(
      st.aria === "true" && !st.disabled,
      `0 이 된 초기화 버튼도 aria-disabled (${JSON.stringify(st)})`,
    );
    ok(st.focused, "두 프레임 뒤에도 초기화 버튼에 포커스가 남는다");
    const r = await same();
    ok(r.rowsSame && r.btnsSame, "초기화 뒤에도 행·버튼 Element 가 그대로다");
    // 0 인 초기화 버튼(aria-disabled)을 다시 눌러도 명령을 보내지 않는다.
    const extra = await ev(`(()=>{const n=sentSync.length;
      document.querySelector('[data-mv-sync-clear="c"]').click();
      return sentSync.length-n;})()`);
    ok(
      extra === 0,
      `0 인 초기화를 다시 눌러도 명령이 나가지 않는다 (${extra})`,
    );
  }

  console.log("\n[구조 변화] 채널이 바뀌면 제자리 갱신을 포기한다");
  {
    // ⚠ 행 수가 달라지면 제자리로는 못 맞춘다. 그때는 전체 렌더에 맡겨야 한다.
    const patched = await ev(
      `(()=>{ state.chosen = state.chosen.slice(0,2); return patchSyncPanel(); })()`,
    );
    ok(
      patched === false,
      "구조가 바뀌면 false 를 돌려준다(전체 렌더로 내려간다)",
    );
    await ev(`renderSync(true)`);
    const s = await snap();
    ok(s.rows === 2, `전체 렌더로 2행이 된다 (${s.rows})`);
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
