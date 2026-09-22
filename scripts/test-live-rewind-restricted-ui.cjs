// 제한 방송인데도 되감기 바/버튼이 그대로 남던 MAIN world 연결 버그.
//
// 원인 1(메시지 필드 위치): content.js 는 liveRewindRestricted 를 메시지
//   '최상위' 로 보내는데, audioMixer.js 수신부는 e.data.flags 안에서 읽었다.
//   그래서 값이 늘 undefined → 제한이 한 번도 걸리지 않았다.
//
// 원인 2(안정 판정 불일치): isTickStable 의 되감기 바 조건이
//   liveSeekBarOn && !hasChzzkTimemachine() 뿐이라, 제한 방송에서
//   ensureSeekBar 는 바를 지우는데 stable 판정은 '있어야 한다' 고 봤다.
//   tick 이 영원히 불안정으로 남는다.
//
// 원인 3(되감기 버튼 판정 불일치): 같은 이유로 버튼 쪽도 사용자 설정만 봤다.
//
// ⚠ 앞으로 버튼·따라잡기는 제한 대상이 아니다(현재로 돌아오는 기능).
//   정책이 그쪽까지 끄지 않는지 함께 고정한다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const MIXER = readFileSync(
  join(__dirname, "..", "src", "audioMixer.js"),
  "utf8",
);
const CONTENT = readFileSync(
  join(__dirname, "..", "src", "content.js"),
  "utf8",
);

let failed = 0;
const ok = (c, l) => {
  console.log((c ? "  PASS " : "  FAIL ") + l);
  if (!c) failed += 1;
};

// ⚠ 로직을 손으로 베끼면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(src, name) {
  let at = src.indexOf(`  function ${name}(`);
  if (at < 0) at = src.indexOf(`  async function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = src.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return src.slice(at, end + 4);
}

const SHOULD_BAR = sliceFn(MIXER, "shouldShowLiveSeekBar");
const SHOULD_REWIND = sliceFn(MIXER, "shouldShowLiveRewindButton");

// 수신부에서 liveRewindRestricted 를 읽는 줄(원본 그대로).
const RECV_LINE = (() => {
  const m = MIXER.match(/^\s*liveRewindRestricted = .*$/m);
  if (!m) throw Error("수신 대입문을 찾지 못했다");
  return m[0].trim();
})();

console.log("[원인 1] 메시지 최상위에서 읽는다");
{
  // sender 가 어디에 넣는지 먼저 확인(추측하지 않는다).
  const senderLine = CONTENT.match(/^\s*liveRewindRestricted: .*$/m);
  ok(!!senderLine, "content.js 가 값을 보낸다");
  // flags 객체(getEffectiveFeatureFlags) 안이 아니라 메시지 본문에 있다.
  const flagsFn = sliceFn(CONTENT, "getEffectiveFeatureFlags");
  ok(
    !/liveRewindRestricted/.test(flagsFn),
    "flags 객체 안에 넣지 않는다(최상위로 보낸다)",
  );
  // ⚠ 예전 버그: f(=e.data.flags) 에서 읽었다.
  ok(
    /e\.data\.liveRewindRestricted === true/.test(RECV_LINE),
    `수신부가 최상위에서 읽는다 (${RECV_LINE})`,
  );
  ok(
    !/\bf\.liveRewindRestricted\b/.test(MIXER),
    "flags 안에서 읽는 코드가 남아 있지 않다",
  );

  // 실제 payload 모양으로 대입문을 돌려 본다.
  const run = (data) => {
    const fn = new Function(
      "e",
      "let liveRewindRestricted = false;\n" +
        "const f = e.data.flags || {};\n" +
        RECV_LINE +
        "\nreturn liveRewindRestricted;",
    );
    return fn({ data });
  };
  ok(
    run({
      source: "cheese-feature-flags",
      flags: { liveRewind: false },
      liveSeekBar: true,
      liveRewindRestricted: true,
    }) === true,
    "실제 sender payload 로 true 가 된다",
  );
  // 최상위가 canonical — flags 안의 값에 속지 않는다.
  ok(
    run({
      flags: { liveRewindRestricted: false },
      liveRewindRestricted: true,
    }) === true,
    "최상위 값이 우선한다",
  );
  ok(
    run({
      flags: { liveRewindRestricted: true },
      liveRewindRestricted: false,
    }) === false,
    "flags 안의 값은 쓰지 않는다",
  );
  ok(run({ flags: {} }) === false, "값이 없으면 false(기존 동작)");
}

console.log("\n[원인 2·3] 표시 판정과 안정 판정이 같은 조건을 쓴다");
{
  const mk = (state) => {
    const fn = new Function(
      "S",
      SHOULD_BAR.replace(
        /\b(liveSeekBarOn|liveRewindRestricted|isLiveSeekPage|hasChzzkTimemachine|featureFlags)\b/g,
        "S.$1",
      ) +
        SHOULD_REWIND.replace(
          /\b(liveSeekBarOn|liveRewindRestricted|isLiveSeekPage|hasChzzkTimemachine|featureFlags)\b/g,
          "S.$1",
        ) +
        "\nreturn { shouldShowLiveSeekBar, shouldShowLiveRewindButton };",
    );
    return fn({
      liveSeekBarOn: true,
      liveRewindRestricted: false,
      isLiveSeekPage: () => true,
      hasChzzkTimemachine: () => false,
      featureFlags: { liveRewind: false },
      ...state,
    });
  };

  ok(mk({}).shouldShowLiveSeekBar() === true, "일반 방송: 바를 띄운다");
  ok(
    mk({ liveRewindRestricted: true }).shouldShowLiveSeekBar() === false,
    "제한 방송: 바를 띄우지 않는다",
  );
  ok(
    mk({ liveSeekBarOn: false }).shouldShowLiveSeekBar() === false,
    "사용자가 끄면 띄우지 않는다",
  );
  ok(
    mk({ hasChzzkTimemachine: () => true }).shouldShowLiveSeekBar() === false,
    "치지직 타임머신 방송에서는 띄우지 않는다",
  );
  ok(
    mk({ isLiveSeekPage: () => false }).shouldShowLiveSeekBar() === false,
    "라이브 페이지가 아니면 띄우지 않는다",
  );

  ok(mk({}).shouldShowLiveRewindButton() === true, "일반 방송: 되감기 버튼");
  ok(
    mk({ liveRewindRestricted: true }).shouldShowLiveRewindButton() === false,
    "제한 방송: 되감기 버튼 없음",
  );
  ok(
    mk({ featureFlags: { liveRewind: true } }).shouldShowLiveRewindButton() ===
      false,
    "사용자가 숨기면 버튼 없음",
  );

  // ⚠ 두 판정이 같은 helper 를 쓰는지 소스로 고정(다시 갈라지지 않게).
  const stable = sliceFn(MIXER, "isTickStable");
  ok(
    /shouldShowLiveSeekBar\(\) !== has\(SEEK_BAR_CLASS\)/.test(stable),
    "안정 판정이 바 helper 를 쓴다",
  );
  ok(
    !/liveSeekBarOn && !hasChzzkTimemachine\(\)/.test(stable),
    "예전의 별도 조건이 남아 있지 않다",
  );
  ok(
    /shouldShowLiveRewindButton\(\) !== has\(REWIND_BUTTON_CLASS\)/.test(
      stable,
    ),
    "안정 판정이 되감기 버튼 helper 를 쓴다",
  );
  // 앞으로 버튼은 정책과 무관해야 한다.
  ok(
    /!featureFlags\.liveRewind !== has\(FORWARD_BUTTON_CLASS\)/.test(stable),
    "앞으로 버튼은 사용자 설정만 본다",
  );
  const ensureBar = sliceFn(MIXER, "ensureSeekBar");
  ok(
    /if \(!shouldShowLiveSeekBar\(\)\)/.test(ensureBar),
    "ensureSeekBar 도 같은 helper 를 쓴다",
  );
  const applyBar = sliceFn(MIXER, "applyLiveSeekBar");
  ok(
    /shouldShowLiveSeekBar\(\)/.test(applyBar),
    "applyLiveSeekBar 도 같은 helper 를 쓴다",
  );
}

console.log("\n[동작] 되감기만 막고 앞으로·따라잡기는 둔다");
{
  const seekBy = sliceFn(MIXER, "seekBy");
  ok(
    /if \(!forward && w\.mode === "live" && liveRewindRestricted\) return;/.test(
      seekBy,
    ),
    "seekBy 는 과거 이동만 막는다",
  );
  const barSeek = sliceFn(MIXER, "seekBarSeekTo");
  ok(
    /back && w\.mode === "live" && liveRewindRestricted/.test(barSeek),
    "바 드래그도 과거 이동만 막는다",
  );
  // ⚠ back 은 '현재 재생 위치' 기준이어야 한다(라이브 엣지 기준이 아니다).
  ok(
    /const back = target < w\.video\.currentTime;/.test(barSeek),
    "back 판정은 현재 재생 위치 기준이다",
  );
  // 따라잡기는 정책을 보지 않는다.
  const syncFn = MIXER.slice(
    MIXER.indexOf("function ensureSyncButton"),
    MIXER.indexOf("function ensureSyncButton") + 1200,
  );
  ok(
    !/liveRewindRestricted/.test(syncFn),
    "따라잡기 버튼은 정책 영향을 받지 않는다",
  );
  // 제한이 걸렸다고 라이브 엣지로 밀어내지 않는다.
  // ⚠ '정책 근처에 currentTime 대입이 있는가' 로 보면 안 된다. 가드가 return
  //   한 뒤 이어지는 정상 seek 대입까지 잡힌다(실제로 오탐했다). 가드가
  //   'return' 으로 끝나는지, 엣지로 점프시키는 코드가 없는지를 본다.
  // seek 실행 지점의 가드만 본다(수신부의 전환 감지 블록은 대상이 아니다).
  const seekGuards = (seekBy + barSeek)
    .split("\n")
    .filter((l) => /liveRewindRestricted/.test(l) && /if \(/.test(l));
  ok(seekGuards.length === 2, `seek 가드가 두 곳이다 (${seekGuards.length})`);
  ok(
    seekGuards.every((l) => /return;$/.test(l.trim())),
    "정책 가드는 되돌려보내지 않고 그냥 중단한다",
  );
  ok(
    !/liveRewindRestricted[^\n]*\n[^\n]*jumpToLiveEdge/.test(MIXER),
    "제한 때문에 라이브 엣지로 점프시키지 않는다",
  );
  // VOD 는 영향 없음.
  ok(
    !/vodSeekButtons[\s\S]{0,80}liveRewindRestricted/.test(MIXER),
    "VOD 버튼 판정에 정책을 넣지 않는다",
  );
}

console.log("\n[전환] 값이 바뀌면 즉시 다시 맞춘다");
{
  const recvBlock = MIXER.slice(
    MIXER.indexOf("const previousLiveRewindRestricted"),
    MIXER.indexOf("const previousLiveRewindRestricted") + 400,
  );
  ok(
    /previousLiveRewindRestricted !== liveRewindRestricted/.test(recvBlock),
    "이전 값과 비교한다",
  );
  ok(
    /forceFullTick = true/.test(recvBlock),
    "바뀌면 다음 tick 을 전체로 돌린다(즉시 수렴)",
  );
  // ⚠ 전용 폴링/옵저버를 새로 만들지 않는다.
  ok(
    !/setInterval[\s\S]{0,120}liveRewindRestricted/.test(MIXER),
    "정책 전용 폴링을 만들지 않는다",
  );
}

// ── 실제 브라우저에서 UI 수렴까지 확인 ──────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "cheese-rr-"));
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
  await ev(`document.readyState`);
  await new Promise((r) => setTimeout(r, 200));

  // 실제 helper + 안정 판정 일부를 올려 '표시 ↔ 안정' 이 맞물리는지 본다.
  await ev(`(()=>{
    document.documentElement.innerHTML='<head></head><body></body>';
    document.body.innerHTML='<div class="pzp-pc" id="P">'+
      '<div class="cheese-live-seek-bar" id="BAR"></div>'+
      '<button class="cheese-live-rewind-button" id="RW"></button>'+
      '<button class="cheese-live-forward-button" id="FW"></button></div>';
    window.S={liveSeekBarOn:true, liveRewindRestricted:false,
      featureFlags:{liveRewind:false},
      isLiveSeekPage:()=>true, hasChzzkTimemachine:()=>false};
    ${SHOULD_BAR.replace(/\b(liveSeekBarOn|liveRewindRestricted|isLiveSeekPage|hasChzzkTimemachine|featureFlags)\b/g, "S.$1")}
    ${SHOULD_REWIND.replace(/\b(liveSeekBarOn|liveRewindRestricted|isLiveSeekPage|hasChzzkTimemachine|featureFlags)\b/g, "S.$1")}
    const P=document.getElementById('P');
    const has=(c)=>!!P.querySelector('.'+c);
    // 실제 ensure/stable 의 핵심 관계만 재현한다.
    window.applyUi=()=>{
      const bar=document.getElementById('BAR');
      if(!shouldShowLiveSeekBar()){ if(bar) bar.remove(); }
      else if(!has('cheese-live-seek-bar')){
        const n=document.createElement('div'); n.id='BAR';
        n.className='cheese-live-seek-bar'; P.appendChild(n);
      }
      const rw=document.getElementById('RW');
      if(!shouldShowLiveRewindButton()){ if(rw) rw.remove(); }
      else if(!has('cheese-live-rewind-button')){
        const n=document.createElement('button'); n.id='RW';
        n.className='cheese-live-rewind-button'; P.appendChild(n);
      }
      // 앞으로 버튼은 사용자 설정만 본다.
      const fw=document.getElementById('FW');
      if(S.featureFlags.liveRewind){ if(fw) fw.remove(); }
      else if(!has('cheese-live-forward-button')){
        const n=document.createElement('button'); n.id='FW';
        n.className='cheese-live-forward-button'; P.appendChild(n);
      }
    };
    window.stable=()=>
      shouldShowLiveSeekBar()===has('cheese-live-seek-bar') &&
      shouldShowLiveRewindButton()===has('cheese-live-rewind-button') &&
      (!S.featureFlags.liveRewind)===has('cheese-live-forward-button');
    window.snap=()=>({bar:has('cheese-live-seek-bar'),
      rewind:has('cheese-live-rewind-button'),
      forward:has('cheese-live-forward-button'), stable:window.stable()});
    return true;})()`);

  console.log("\n[UI] 제한 전에는 바·되감기·앞으로가 모두 있다");
  await ev(`applyUi()`);
  let s = await ev(`snap()`);
  ok(s.bar && s.rewind && s.forward, `초기 상태 ${JSON.stringify(s)}`);
  ok(s.stable === true, "안정 상태로 인정된다");

  console.log("\n[UI] restricted=true 를 받으면 즉시 사라진다");
  await ev(`S.liveRewindRestricted=true; applyUi();`);
  s = await ev(`snap()`);
  ok(s.bar === false, "되감기 바가 사라진다");
  ok(s.rewind === false, "되감기 버튼이 사라진다");
  ok(s.forward === true, "앞으로 버튼은 남는다");
  ok(s.stable === true, "제한 상태도 '안정' 으로 인정된다");

  console.log("\n[UI] tick 을 반복해도 다시 생기지 않는다");
  for (let i = 0; i < 10; i += 1) await ev(`applyUi()`);
  s = await ev(`snap()`);
  ok(
    s.bar === false && s.rewind === false,
    `10회 후에도 없음 ${JSON.stringify(s)}`,
  );
  ok(s.forward === true, "앞으로 버튼은 계속 있다");
  // ⚠ 여기가 false 로 남으면 tick 이 영원히 full 로 돈다(원인 2·3).
  ok(s.stable === true, "isTickStable 이 true 에 도달한다");

  console.log("\n[UI] restricted=false 로 돌아오면 복구된다");
  await ev(`S.liveRewindRestricted=false; applyUi();`);
  s = await ev(`snap()`);
  ok(s.bar === true, "되감기 바가 복구된다");
  ok(s.rewind === true, "되감기 버튼이 복구된다");
  ok(s.stable === true, "다시 안정 상태");

  console.log("\n[UI] 사용자 설정 OFF 는 정책과 별개로 유지된다");
  await ev(`S.featureFlags={liveRewind:true}; applyUi();`);
  s = await ev(`snap()`);
  ok(s.rewind === false && s.forward === false, "설정 OFF 면 둘 다 없다");
  ok(s.bar === true, "바는 바 설정만 따른다");
  ok(s.stable === true, "안정 상태");
  await ev(
    `S.featureFlags={liveRewind:false}; S.liveSeekBarOn=false; applyUi();`,
  );
  s = await ev(`snap()`);
  ok(s.bar === false, "바 설정 OFF 면 바만 사라진다");
  ok(s.rewind === true && s.forward === true, "버튼은 남는다");

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  await call("Target.closeTarget", { targetId });
  cleanup();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
