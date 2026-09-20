// 방송 종료 시 멈춤 복구가 나가지 않는지 — '진짜 함수' 로 확인한다.
//
// ⚠ 기존 test-live-stall-recovery.cjs 는 상태 기계를 복제해 검사한다. 그래서
//   종료 화면 선택자가 실제 DOM 과 어긋나도 통과한다. 여기서는 audioMixer.js 의
//   liveEndScreenVisible / liveLooksEnded / recoverFromStall 을 원본 그대로
//   떼어 와 실제 DOM 위에서 돌린다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "audioMixer.js"), "utf8");

function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}
function sliceConst(decl) {
  const at = SRC.indexOf(decl);
  if (at < 0) throw Error(`상수를 찾지 못했다: ${decl}`);
  return SRC.slice(at, SRC.indexOf(";\n", at) + 1);
}

const dir = mkdtempSync(join(tmpdir(), "cheese-end-"));
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
    { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  // 원본 함수를 그대로 올린다(문구·선택자·순서까지 실린다).
  await ev(`(()=>{
    window.ourSeekUntil = 0;
    ${sliceConst("  const STALL_END_TEXTS =")}
    ${sliceConst("  const STALL_BUFFER_BACK_S =")}
    let stallFixes = 0, stallLastFixAt = 0;
    ${sliceFn("liveEndScreenVisible")}
    ${sliceFn("liveLooksEnded")}
    ${sliceFn("looksStalled")}
    ${sliceFn("recoverFromStall")}
    window.liveEndScreenVisible = liveEndScreenVisible;
    window.liveLooksEnded = liveLooksEnded;
    window.looksStalled = looksStalled;
    window.recoverFromStall = recoverFromStall;
    // 멈춘 라이브 흉내: ended 는 false 인데 버퍼 끝을 넘어서 있다.
    window.makeStalledVideo = () => ({
      paused:false, ended:false, readyState:2, currentTime:100, seeking:false,
      buffered:{ length:1, start:()=>10, end:()=>99 },
    });
    return true;})()`);

  const PLAYER = (inner) =>
    `<main><div class="_player_abc">${inner}</div></main>`;

  console.log("[C/16] 종료 화면만 떠 있고 video.ended=false — 되돌리지 않는다");
  {
    // ⚠ 이 상황이 실제로 보고된 것이다. 멈춤 신호와 완전히 같지만 방송은 끝났다.
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<p>다음 라이브를 기대해주세요!</p>"))};
      const v=makeStalledVideo();
      return {stalled:looksStalled(v), ended:liveLooksEnded(v),
        recovered:recoverFromStall(v), moved:v.currentTime!==100};})()`);
    ok(r.stalled === true, "멈춤 신호와 똑같이 생겼다(기존 판정으로는 멈춤)");
    ok(r.ended === true, "그래도 종료로 본다(종료 화면)");
    ok(r.recovered === false, "되돌리지 않는다");
    ok(r.moved === false, "재생 위치를 건드리지 않는다");
  }

  console.log("\n[B/15] video.ended=true — 종료 화면이 없어도 되돌리지 않는다");
  {
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const v=makeStalledVideo(); v.ended=true;
      return {ended:liveLooksEnded(v), recovered:recoverFromStall(v),
        moved:v.currentTime!==100};})()`);
    ok(r.ended === true, "ended 하나만으로도 종료로 본다");
    ok(r.recovered === false && r.moved === false, "되돌리지 않는다");
  }

  console.log("\n[A/18] 진짜 멈춤 — 기존 복구는 그대로 동작한다");
  {
    // ⚠ 종료 오탐을 막느라 기능 자체가 죽으면 실패다.
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const v=makeStalledVideo();
      const okRecover=recoverFromStall(v);
      return {ended:liveLooksEnded(v), recovered:okRecover,
        target:+v.currentTime.toFixed(2)};})()`);
    ok(r.ended === false, "종료가 아니다");
    ok(r.recovered === true, "되돌린다");
    ok(r.target === 97.5, `버퍼 안쪽으로 옮긴다 (${r.target})`);
  }

  console.log("\n[실측] 소스가 사라지면 종료 화면을 기다리지 않는다");
  {
    // ⚠ 실제 방송 종료를 재어 보니 종료 화면이 아주 늦게 떴다.
    //     끊김(waiting)        398637ms
    //     ended               410704ms  (+12.1초)
    //     networkState=EMPTY  411001ms  (+12.4초)
    //     종료 화면            442001ms  (+43.4초, ended 보다 31초 뒤)
    //   ended 와 종료 화면 사이가 8초(STALL_MIN_MS)보다 훨씬 길다. 그 사이에
    //   멈춤으로 보이면 되돌리기가 나갈 수 있어 EMPTY 를 함께 본다.
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const v=makeStalledVideo(); v.networkState=0;  // 소스 없음
      return {ended:liveLooksEnded(v), recovered:recoverFromStall(v),
        moved:v.currentTime!==100};})()`);
    ok(r.ended === true, "소스가 사라졌으면 종료로 본다(종료 화면 전이라도)");
    ok(r.recovered === false && r.moved === false, "되돌리지 않는다");
  }

  console.log("\n[실측] 정상 재생 중에는 소스 신호로 오판하지 않는다");
  {
    // NETWORK_IDLE(1)·LOADING(2) 은 정상이다. 여기서 종료로 보면 기능이 죽는다.
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const out={};
      for(const n of [1,2,3]){
        const v=makeStalledVideo(); v.networkState=n;
        out[n]={ended:liveLooksEnded(v), recovered:recoverFromStall(v)};
      }
      return out;})()`);
    ok(r["1"].ended === false && r["1"].recovered === true, "IDLE(1) 은 정상");
    ok(
      r["2"].ended === false && r["2"].recovered === true,
      "LOADING(2) 도 정상",
    );
    ok(
      r["3"].ended === false && r["3"].recovered === true,
      "NO_SOURCE(3) 만으로는 종료로 보지 않는다(로드 실패와 구분 못 함)",
    );
  }

  console.log("\n[실측] 갓 만든 video 와 겹치지 않는다");
  {
    // 새 video 도 networkState=0 이지만 buffered 가 비어 '멈춤' 자체가 아니다.
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const fresh={paused:false, ended:false, readyState:0, currentTime:0,
        seeking:false, networkState:0, buffered:{length:0}};
      return {stalled:looksStalled(fresh), recovered:recoverFromStall(fresh)};})()`);
    ok(r.stalled === false, "버퍼가 없으면 애초에 멈춤이 아니다");
    ok(r.recovered === false, "되돌릴 것도 없다");
  }

  console.log("\n[9] '종료' 가 든 다른 문구를 종료로 보지 않는다");
  {
    const r = await ev(`(()=>{
      const out={};
      for(const [k,t] of [["예정","방송 종료 예정입니다"],
                          ["버튼","종료"],["안내","곧 종료됩니다"]]){
        document.body.innerHTML=${JSON.stringify(PLAYER("<p>__T__</p>"))}.replace("__T__",t);
        out[k]=liveEndScreenVisible();
      }
      return out;})()`);
    ok(r.예정 === false, "'방송 종료 예정입니다' 는 종료가 아니다");
    ok(r.버튼 === false, "'종료' 만으로는 종료가 아니다");
    ok(r.안내 === false, "'곧 종료됩니다' 도 종료가 아니다");
  }

  console.log("\n[10] 보이지 않는 종료 문구는 종료로 보지 않는다");
  {
    const r = await ev(`(()=>{
      document.body.innerHTML='<main><div class="_player_a" style="display:none">'+
        '<p>다음 라이브를 기대해주세요!</p></div></main>';
      return liveEndScreenVisible();})()`);
    ok(r === false, "숨은 템플릿을 종료로 오해하지 않는다");
  }

  console.log("\n[G/13] 종료 화면이 사라지면 다시 복구가 동작한다");
  {
    // 같은 채널 재방송(뱅온)·다른 채널로 이동 모두 '종료 화면이 사라진' 상태다.
    // ⚠ 종료를 영구 latch 로 들고 있으면 여기서 막힌다.
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<p>다음 라이브를 기대해주세요!</p>"))};
      const before=liveLooksEnded(makeStalledVideo());
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const v=makeStalledVideo();
      return {before, after:liveLooksEnded(v), recovered:recoverFromStall(v)};})()`);
    ok(r.before === true, "종료 화면일 때는 종료");
    ok(r.after === false, "화면이 사라지면 더는 종료가 아니다");
    ok(r.recovered === true, "새 방송에서는 복구가 다시 동작한다");
  }

  console.log("\n[19/20] 일시정지·seek 처리는 그대로");
  {
    const r = await ev(`(()=>{
      document.body.innerHTML=${JSON.stringify(PLAYER("<video></video>"))};
      const paused=makeStalledVideo(); paused.paused=true;
      const seeking=makeStalledVideo(); seeking.seeking=true; seeking.currentTime=50;
      return {paused:looksStalled(paused), seeking:looksStalled(seeking)};})()`);
    ok(r.paused === false, "사용자가 멈춘 것은 복구 대상이 아니다");
    ok(r.seeking === true, "seek 이 안 끝나는 것은 기존대로 멈춤으로 본다");
  }

  console.log("\n[6] 되돌리기 직전에도 종료를 한 번 더 확인한다");
  {
    // 판정과 실행 사이(최대 한 틱)에 종료 화면이 뜰 수 있다.
    const fn = sliceFn("recoverFromStall");
    ok(
      /if \(liveLooksEnded\(video\)\) return false;/.test(fn),
      "recoverFromStall 안에 방어 판정이 있다",
    );
    ok(
      fn.indexOf("liveLooksEnded") < fn.indexOf("video.currentTime ="),
      "재생 위치를 바꾸기 전에 확인한다",
    );
    // ⚠ 값싼 DOM 판정이어야 한다. 네트워크를 다시 부르면 안 된다.
    ok(!/fetch\(|XMLHttpRequest/.test(fn), "여기서 네트워크를 부르지 않는다");
  }

  console.log("\n[2/29] 종료 문구를 한 곳에서만 정한다");
  {
    const content = readFileSync(
      join(__dirname, "..", "src", "content.js"),
      "utf8",
    );
    const mine = sliceConst("  const STALL_END_TEXTS =");
    ok(
      /다음 라이브를 기대해주세요/.test(mine),
      "기존 종료 화면 문구를 그대로 쓴다",
    );
    ok(
      /RELIVE_END_TEXTS = \["다음 라이브를 기대해주세요"\]/.test(content),
      "content.js 의 원본 문구와 같다(어긋나면 함께 고쳐야 한다)",
    );
    // 새 polling 을 만들지 않았는지.
    const tick = sliceFn("stallTick");
    ok(
      !/fetch\(|live-status/.test(tick),
      "멈춤 감시가 API 를 부르지 않는다(새 폴링 없음)",
    );
  }

  console.log("\n[5] 종료 확인이 멈춤 누적보다 먼저다");
  {
    const tick = sliceFn("stallTick");
    ok(
      tick.indexOf("liveLooksEnded") < tick.indexOf("looksStalled"),
      "종료를 먼저 보고 손을 뗀다",
    );
    ok(
      tick.indexOf("liveLooksEnded") < tick.indexOf("stallSince = now"),
      "멈춤을 쌓기 전에 확인한다",
    );
    ok(
      /if \(liveLooksEnded\(video\)\) \{\s*\n\s*resetStallWatch\(\);/.test(
        tick,
      ),
      "종료를 보면 쌓아 둔 상태를 비운다",
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
