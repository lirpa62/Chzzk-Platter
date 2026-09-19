// 방장·매니저 채팅 수집 버튼의 아이콘 크기.
//
// 제보: 이어받기(A→B→A)로 수집이 재개될 때 헤더의 회전 아이콘이 매우 작아진다.
//
// 실측으로 확정한 원인: 버튼은 inline-flex 이고 그 안에 SVG 와 진행률 글자가
// 나란히 놓인다. SVG 의 기본 flex-shrink 는 1 이라, 버튼 폭이 28px 로 고정된
// 상태에서 진행률 글자가 들어가면 아이콘부터 찌그러진다.
//   '43%'  → 8x16
//   '100%' → 2.4x16
// 버튼이 넓어지는 것은 is-loading 클래스가 붙어야 하는데, 그 클래스는 패널을
// 다시 그릴 때만 붙었다. 이어받기는 그리기 전에 진행률이 먼저 들어온다.
//
// ⚠ production CSS 와 content.js 의 실제 마크업을 그대로 쓴다. 간이 CSS 를
//   새로 지어내면 이런 문제를 못 잡는다(앞선 작업에서 실제로 두 번 놓쳤다).

const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const dir = mkdtempSync(join(tmpdir(), "cheese-rcp-"));
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
// 회전 애니메이션 때문에 경계 상자가 커질 수 있다. 줄어드는 것만 문제다.
const MIN = 15.5;

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
    { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  const css = readFileSync("src/content.css", "utf8");
  const js = readFileSync("src/content.js", "utf8");
  // 실제 마크업을 content.js 에서 떼어 온다.
  // ⚠ 첫 번째 panel-head 를 그냥 집으면 안 된다 — 같은 클래스를 여러 패널이
  //   쓰고 있어서 10만 자가 넘는 엉뚱한 구간이 딸려 온다(실제로 그랬다).
  //   방장·매니저 패널의 머리말만 정확히 집는다.
  const anchorAt = js.indexOf("<strong>방장·매니저 채팅</strong>");
  if (anchorAt < 0) throw Error("방장·매니저 패널 마크업을 찾지 못했다");
  const from = js.lastIndexOf(
    '<div class="cheese-search-comment-panel-head">',
    anchorAt,
  );
  const to = js.indexOf("</div>", js.indexOf("data-role-chat-close", anchorAt));
  if (from < 0 || to < 0) throw Error("방장·매니저 머리말 범위를 찾지 못했다");
  const markup = js.slice(from, to) + "</div></div>";

  await ev(`(()=>{
    const st=document.createElement('style');
    st.textContent=${JSON.stringify(css)};
    document.head.appendChild(st);
    document.body.innerHTML='<div class="cheese-search-comment-panel" '+
      'style="width:320px">'+${JSON.stringify(markup)}+'</div>';
    window.set=(pct,loading)=>{
      const btn=document.querySelector('[data-role-chat-collect]');
      btn.classList.toggle('is-loading',loading);
      btn.querySelector('.cheese-recap-role-collect-progress')
        .textContent=pct;
    };
    window.rects=()=>{
      const btn=document.querySelector('[data-role-chat-collect]');
      const svg=btn.querySelector('svg');
      const r=(el)=>{const x=el.getBoundingClientRect();
        return {w:+x.width.toFixed(1),h:+x.height.toFixed(1)};};
      return {btn:r(btn),svg:r(svg),shrink:getComputedStyle(svg).flexShrink};
    };
    return true;})()`);

  console.log("[기본] 수집 전에는 28x28 버튼에 16x16 아이콘");
  {
    await ev(`window.set('',false)`);
    const r = await ev("window.rects()");
    ok(r.svg.w >= MIN && r.svg.h >= MIN, `아이콘 ${r.svg.w}x${r.svg.h}`);
    ok(r.shrink === "0", `아이콘이 줄어들지 않게 돼 있다 (shrink=${r.shrink})`);
  }

  console.log("\n[수집 중] 진행률이 바뀌어도 아이콘 크기는 그대로");
  for (const pct of ["0%", "1%", "9%", "10%", "43%", "99%", "100%"]) {
    await ev(`window.set(${JSON.stringify(pct)},true)`);
    const r = await ev("window.rects()");
    ok(
      r.svg.w >= MIN && r.svg.h >= MIN,
      `${pct.padEnd(4)} → 아이콘 ${r.svg.w}x${r.svg.h} (버튼 ${r.btn.w})`,
    );
  }

  console.log("\n[이어받기] 폭이 아직 28px 인데 진행률만 들어온 순간 (핵심)");
  // ⚠ 이것이 제보 상황이다. is-loading 이 아직 안 붙어 버튼이 28px 인 채로
  //   진행률 글자가 먼저 들어오면 예전에는 아이콘이 8x16, 2.4x16 까지 줄었다.
  for (const pct of ["43%", "100%"]) {
    await ev(`window.set(${JSON.stringify(pct)},false)`);
    const r = await ev("window.rects()");
    ok(
      r.svg.w >= MIN && r.svg.h >= MIN,
      `${pct.padEnd(4)} → 아이콘 ${r.svg.w}x${r.svg.h} (버튼 ${r.btn.w})`,
    );
  }

  console.log("\n[좁은 패널] 폭이 좁아져도 아이콘은 그대로");
  for (const w of [320, 240, 200, 170, 150]) {
    await ev(`(()=>{document.querySelector('.cheese-search-comment-panel')
      .style.width='${w}px';
      document.querySelector('.cheese-search-comment-panel-head strong')
        .textContent='방장·매니저 채팅 아주 긴 제목이 들어간 경우';
      return true;})()`);
    await ev(`window.set('43%',true)`);
    const r = await ev("window.rects()");
    ok(
      r.svg.w >= MIN && r.svg.h >= MIN,
      `${w}px → 아이콘 ${r.svg.w}x${r.svg.h}`,
    );
  }

  console.log("\n[소스] 진행률 글자와 is-loading 을 함께 건다");
  {
    ok(
      /\.cheese-recap-role-collect > svg \{\s*flex: 0 0 auto;/.test(css),
      "아이콘에 줄어들지 않는 규칙이 있다",
    );
    const cb = js.slice(
      js.indexOf(
        'const button = document.querySelector("[data-role-chat-collect]");',
      ),
      js.indexOf("const status = document.querySelector("),
    );
    ok(
      /button\.classList\.add\("is-loading"\)/.test(cb),
      "진행률을 쓸 때 is-loading 도 함께 붙인다",
    );
  }

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
