// 접힌 사이드바에서 전용 팔로잉 프로필이 과도하게 커지는 문제.
//
// 조건: 프로필 모서리 ON + 전용 팔로잉 목록 ON + 사이드바 접힘.
//
// 원인: 프로필 모서리 규칙이 img 에 max-height:100% 를 주는데, 이 값은 래퍼에
// '정해진 높이' 가 있을 때만 듣는다. 전용 팔로잉 아바타의 래퍼는 치지직에서
// harvest 한 _profile_ 클래스를 쓰므로, 접힘 상태에서 그 클래스의 크기 규칙이
// 걸리지 않으면 높이가 정해지지 않는다. 그러면 원본 이미지 높이가 그대로 남아
// 30x453 처럼 세로로 길어지고, 좁은 접힘 레일에서 좌우가 잘려 보인다.
//
// ⚠ 개발 환경에서 재현되지 않는 이유도 같다. 네이티브 클래스가 접힘 상태에서
//   크기를 제대로 정해 주면 증상이 나오지 않는다. harvest 결과와 치지직 CSS 에
//   따라 갈린다.
//
// 고침: 접힘 + 전용 팔로잉 아바타 래퍼에만 폭 기준 정사각을 준다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "cheese-av-"));
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
  const css = readFileSync("src/content.css", "utf8");
  // content.css 를 한 번만 주입한다(프로필 모서리 규칙이 여기 들어 있다).
  await ev(`(()=>{
    const st=document.createElement('style');
    st.textContent=${JSON.stringify(readFileSync("src/content.css", "utf8"))};
    document.head.appendChild(st);
    return true;
  })()`);

  const probe = async (label, { collapsed, wrapperHasSize }) => {
    const r = await ev(`(()=>{
      document.documentElement.className='cheese-channel-profile-radius-enabled';
      const expanded=${collapsed ? "''" : "'_is_expanded_x'"};
      const size=${wrapperHasSize ? "'width:30px;height:30px'" : "'width:30px'"};
      document.body.innerHTML=
        '<div id="sidebar" class="'+expanded+'" style="width:48px">'+
        '<div id="cheese-custom-follow">'+
        '<div id="av" class="_profile_abc123 cheese-channel-profile-radius-target" '+
        'style="'+size+'">'+
        '<img id="im" width="480" height="480" '+
        'src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">'+
        '</div></div></div>';
      const im=document.getElementById('im');
      const cs=getComputedStyle(im);
      const r=im.getBoundingClientRect();
      return {w:Math.round(r.width),h:Math.round(r.height),
        ar:cs.aspectRatio,hh:cs.height,mh:cs.maxHeight};
    })()`);
    return r;
  };

  let failed = 0;
  const ok = (cond, label) => {
    console.log((cond ? "  PASS " : "  FAIL ") + label);
    if (!cond) failed += 1;
  };

  console.log("[접힘 · 래퍼 높이 없음] 세로로 늘어나지 않는다");
  {
    const r = await probe("collapsed", {
      collapsed: true,
      wrapperHasSize: false,
    });
    ok(
      r.h <= r.w + 1,
      `가로세로가 같다 (${r.w}x${r.h}) ar=${r.ar} h=${r.hh} maxH=${r.mh}`,
    );
    ok(r.w <= 30 + 1, `래퍼 폭을 넘지 않는다 (${r.w})`);
  }

  console.log("\n[접힘 · 래퍼 크기 정상] 네이티브 크기를 해치지 않는다");
  {
    const r = await probe("sized", { collapsed: true, wrapperHasSize: true });
    ok(r.w <= 30 + 1 && r.h <= 30 + 1, `래퍼 안에 들어온다 (${r.w}x${r.h})`);
  }

  console.log("\n[펼침] 펼친 상태에는 이 규칙이 걸리지 않는다");
  {
    const r = await probe("expanded", {
      collapsed: false,
      wrapperHasSize: true,
    });
    ok(r.w <= 30 + 1 && r.h <= 30 + 1, `기존대로 래퍼 안이다 (${r.w}x${r.h})`);
  }

  console.log("\n[소스] 모서리 규칙은 모서리만 바꾼다");
  {
    const css = readFileSync("src/content.css", "utf8");
    const block = css.slice(
      css.indexOf('#sidebar:not([class*="_is_expanded_"])'),
      css.indexOf('#sidebar:not([class*="_is_expanded_"])') + 400,
    );
    ok(/aspect-ratio: 1 \/ 1/.test(block), "래퍼에 정사각을 준다");
    ok(
      /#cheese-custom-follow/.test(block),
      "전용 팔로잉 목록 안으로 범위를 좁힌다",
    );
    ok(
      !/width:\s*\d+px|height:\s*\d+px/.test(block),
      "고정 px 로 크기를 못 박지 않는다",
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
