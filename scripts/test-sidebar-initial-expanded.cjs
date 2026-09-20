// 처음부터 펼쳐진 사이드바에서 본문 밀어내기가 적용되는지.
//
// 증상: 사이드바를 펼친 채로 홈에 들어가면 콘텐츠가 사이드바 아래에 깔린다.
//       접었다 다시 펴면 정상으로 돌아온다.
//
// 원인(실행으로 확인): 펼침 애니메이션 도중에는 폭이 아이콘 폭(80px 이하)이라
//   applySidebarPush 가 스타일을 비우고 끝낸다. 접힘↔펼침 '전환' 에서는
//   handleSidebarExpandTransition 이 scheduleSidebarPushSettle 로 80ms 간격
//   재측정을 걸어 최종 폭을 잡지만, 처음부터 펼쳐져 있으면 전환이 아니라서
//   (sidebarWasExpanded 를 현재 상태로 초기화한다) 그 재측정이 걸리지 않았다.
//   그래서 본문 패딩이 영영 붙지 않았다.
//
// ⚠ 판정 함수만 떼어 보면 안 잡힌다. 폭이 80 → 240 으로 '변하는' 타이밍이
//   핵심이라 실제 브라우저에서 잰다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");

function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

// ensureSidebarObserver 의 '부착 마지막 부분'(밀어내기 적용 구간)을 원본에서 떼어 온다.
function attachTail() {
  const fn = SRC.slice(
    SRC.indexOf("  function ensureSidebarObserver() {"),
    SRC.indexOf("  // ── 헤더 미니 네비 주입/유지"),
  );
  const at = fn.indexOf("    applySidebarPush();");
  if (at < 0) throw Error("부착 시점의 밀어내기 적용을 찾지 못했다");
  const tail = fn.slice(at, fn.lastIndexOf("}"));
  if (!/applySidebarPush\(\)/.test(tail)) {
    throw Error("떼어 낸 구간이 밀어내기 적용부가 아니다");
  }
  return tail;
}

const dir = mkdtempSync(join(tmpdir(), "cheese-sb-"));
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
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await call(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  // 실제 함수를 원본 그대로 올린다.
  const setup = (flags, expanded, width) => `(()=>{
    document.documentElement.innerHTML='<head></head><body></body>';
    document.body.innerHTML=
      '<aside id="sidebar"${expanded ? ' class="_is_expanded_"' : ""}></aside>'+
      '<div id="layout-body"></div>';
    const st=document.createElement('style');
    st.id='fixture-style';
    st.textContent='aside#sidebar{position:fixed;left:0;top:0;height:100vh;width:${width}px}';
    document.head.appendChild(st);
    window.SIDEBAR_PUSH_STYLE_ID='cheese-sidebar-push-style';
    window.featureFlags=${JSON.stringify(flags)};
    let sidebarPushSettleTimer=0;
    ${sliceFn("isSidebarExpanded")}
    ${sliceFn("applySidebarPush")}
    ${sliceFn("scheduleSidebarPushSettle")}
    window.scheduleSearchSectionTopFabSync=()=>{};
    window.applySidebarPush=applySidebarPush;
    window.scheduleSidebarPushSettle=scheduleSidebarPushSettle;
    window.isSidebarExpanded=isSidebarExpanded;
    // ⚠ 부착 순서를 손으로 적지 않고 원본에서 떼어 온다. 손으로 적으면 원본에서
    //   재측정이 빠져도 이 검사가 통과해 버린다(실제로 그랬다).
    window.attach=()=>{ ${attachTail()} };
    window.grow=(w)=>{document.getElementById('fixture-style').textContent=
      'aside#sidebar{position:fixed;left:0;top:0;height:100vh;width:'+w+'px}';};
    window.pushCss=()=>{const s=document.getElementById('cheese-sidebar-push-style');
      return s? (s.textContent||'') : '';};
    return true;})()`;

  const PUSH_ON = { sidebar: false, sidebarRight: false, sidebarPush: true };

  console.log("[A] 처음부터 펼쳐진 상태 — 최종 폭이 반영된다");
  {
    // 부착 시점엔 애니메이션 중이라 80px, 곧 240px 이 된다.
    await ev(setup(PUSH_ON, true, 80));
    await ev(`attach()`);
    const atAttach = await ev(`pushCss()`);
    ok(
      !atAttach.includes("px !important"),
      "부착 순간에는 아직 붙지 않는다(폭이 아이콘 폭)",
    );
    await ev(`grow(240)`);
    await new Promise((r) => setTimeout(r, 500));
    const settled = await ev(`pushCss()`);
    ok(
      settled.includes("padding-left: 240px"),
      `재측정으로 최종 폭이 붙는다 (${settled.slice(0, 60)})`,
    );
  }

  console.log("\n[A-2] 부착 시점에 이미 최종 폭이면 바로 붙는다");
  {
    await ev(setup(PUSH_ON, true, 240));
    await ev(`attach()`);
    const css = await ev(`pushCss()`);
    ok(css.includes("padding-left: 240px"), "즉시 반영된다");
  }

  console.log("\n[접힘] 접힌 채로 들어오면 아무것도 붙이지 않는다");
  {
    await ev(setup(PUSH_ON, false, 80));
    await ev(`attach()`);
    await new Promise((r) => setTimeout(r, 450));
    const css = await ev(`pushCss()`);
    ok(css === "", "접힘 상태에는 패딩을 넣지 않는다");
  }

  console.log("\n[밀어내기 OFF] 옵션이 꺼져 있으면 건드리지 않는다");
  {
    await ev(
      setup(
        { sidebar: false, sidebarRight: false, sidebarPush: false },
        true,
        240,
      ),
    );
    await ev(`attach()`);
    await new Promise((r) => setTimeout(r, 450));
    const css = await ev(`pushCss()`);
    ok(css === "", "sidebarPush OFF 면 레이아웃을 바꾸지 않는다");
  }

  console.log("\n[오른쪽 배치] 오른쪽 패딩으로 붙는다");
  {
    await ev(
      setup(
        { sidebar: false, sidebarRight: true, sidebarPush: true },
        true,
        80,
      ),
    );
    await ev(`attach()`);
    await ev(`grow(240)`);
    await new Promise((r) => setTimeout(r, 500));
    const css = await ev(`pushCss()`);
    ok(
      css.includes("padding-right: 240px"),
      `오른쪽 배치에서도 최종 폭이 붙는다 (${css.slice(0, 60)})`,
    );
  }

  console.log("\n[사이드바 숨김] 숨김 옵션이면 아무것도 하지 않는다");
  {
    await ev(
      setup(
        { sidebar: true, sidebarRight: false, sidebarPush: true },
        true,
        240,
      ),
    );
    await ev(`attach()`);
    await new Promise((r) => setTimeout(r, 450));
    const css = await ev(`pushCss()`);
    ok(css === "", "사이드바를 숨기면 밀어내기도 하지 않는다");
  }

  console.log("\n[소스] 부착 시점에 재측정을 건다");
  {
    const observer = SRC.slice(
      SRC.indexOf("  function ensureSidebarObserver() {"),
      SRC.indexOf("  // ── 헤더 미니 네비 주입/유지"),
    );
    ok(
      /if \(isSidebarExpanded\(sidebar\)\) scheduleSidebarPushSettle\(\);/.test(
        observer,
      ),
      "이미 펼쳐진 경우에만 재측정을 예약한다",
    );
    // ⚠ 접힘 상태에까지 걸면 불필요한 타이머가 매 부착마다 돈다.
    ok(
      !/^\s*scheduleSidebarPushSettle\(\);\s*$/m.test(
        observer.slice(observer.indexOf("applySidebarPush();")),
      ),
      "조건 없이 걸지 않는다",
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
