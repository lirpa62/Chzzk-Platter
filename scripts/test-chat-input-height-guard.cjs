// 좁은 채팅(채팅 너비 조절)에서 입력창 포커스 아웃 때 입력 영역이 잠깐 커지지 않는지.
//
// 2026-10-04 실측(262px 채팅): 치지직은 포커스가 빠질 때마다 textarea 를 새로 끼우고 빈 칸인데도
// 인라인 height:60px !important 를 준다. 우리 보정이 채팅 정리 주기(최소 300ms)를 기다려 그동안
// 입력 영역이 133→153px 로 커졌다가 돌아왔다. 이제 교체를 본 그 자리(그리기 전)에서 바로 맞춘다.
// content.js 의 실제 함수를 떼어 와 헤드리스 크롬에서 돌린다.
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "chat-input-h-"));
const browser = spawn(
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
let buffer = "",
  seq = 0;
const pending = new Map();
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\0")) >= 0;) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const msg = JSON.parse(raw),
      job = pending.get(msg.id);
    if (!job) continue;
    pending.delete(msg.id);
    msg.error
      ? job.reject(Error(JSON.stringify(msg.error)))
      : job.resolve(msg.result);
  }
});
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });

const assert = require("node:assert/strict");
const checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const content = readFileSync(join(ROOT, "src/content.js"), "utf8");
const sliceFn = (name) => {
  const at = content.indexOf(`  function ${name}(`);
  assert.ok(at > 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const guardAt = content.indexOf("  let chatInputHeightObserver = null;");
const guardSrc = content.slice(guardAt, content.indexOf("  function resetChatAsideWidth(", guardAt));

(async () => {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (m, p) => call(m, p, sessionId);
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await ev(`(()=>{
    document.documentElement.classList.add('cheese-chat-width-resize-enabled');
    document.body.innerHTML='<aside id="aside-chatting"><div class="_list_"></div><div class="_area_"><div class="_container_"></div></div></aside>';
    // 멀티뷰 칸 여부·다시보기 번호·채팅 접힘(content.js 와 같은 판정). 아래에서 바꿔 본다.
    window.__mv={frame:false,videoNo:''};
    Object.defineProperty(window,'IS_MULTIVIEW_FRAME',{get:()=>window.__mv.frame});
    Object.defineProperty(window,'multiviewVideoNo',{get:()=>window.__mv.videoNo});
    ${sliceFn("isChatFolded")}
    function getLiveChatAside(){return document.querySelector('aside#aside-chatting');}
    window.__errors=[]; window.addEventListener('error',e=>window.__errors.push(e.message));
    ${content.slice(content.indexOf("  const NATIVE_CHAT_TEXTAREA ="), content.indexOf("  function normalizeChatInputHeight("))}
    ${sliceFn("normalizeChatInputHeight")}
    ${guardSrc}
    window.__guard=guardChatInputHeight;
    // 치지직 채팅 옵저버 자리(content.js 의 chatObserver 처럼 childList 를 보고 guard 를 부른다).
    new MutationObserver(()=>guardChatInputHeight()).observe(document.querySelector('aside'),{childList:true,subtree:true});
    window.chzzkSwap=(height)=>{ // 치지직: 새 textarea 를 만들어 60px !important 로 끼운다(한 작업 안)
      const t=document.createElement('textarea');
      t.placeholder='채팅을 입력해주세요 (J)'; t.rows=2;
      t.style.setProperty('height',height,'important');
      const box=document.querySelector('._container_'); box.replaceChildren(t); return t;
    };
    window.nextFrameHeight=()=>new Promise(r=>requestAnimationFrame(()=>r(getComputedStyle(document.querySelector('textarea')).height)));
  })()`);

  // 방송 입장: 입력창이 이미 들어와 있는 상태에서 옵저버가 붙는다.
  await ev(`(()=>{const t=document.createElement('textarea');t.placeholder='채팅을 입력해주세요 (J)';t.style.setProperty('height','60px','important');document.querySelector('._container_').append(t);})()`);
  await ev(`window.__guard()`);
  check(await ev(`document.querySelector('textarea').style.height`) === "40px", "입장 직후 이미 들어와 있는 입력창도 바로 40px");

  // 포커스 아웃: 치지직이 입력창을 60px 로 갈아 끼운다 → 다음 프레임(그리기 전)에 이미 40px.
  for (let i = 0; i < 3; i++) {
    const h = await ev(`(async()=>{ chzzkSwap('60px'); return nextFrameHeight(); })()`);
    check(h === "40px", `포커스 아웃 ${i + 1}회차: 새 입력창이 그려지기 전에 40px(60px 프레임 없음)`);
  }

  // 같은 입력창에 치지직이 나중에 높이를 다시 넣어도 바로 되돌린다.
  const later = await ev(`(async()=>{ const t=document.querySelector('textarea');
    await new Promise(r=>setTimeout(r,50)); t.style.setProperty('height','60px','important'); return nextFrameHeight(); })()`);
  check(later === "40px", "같은 입력창의 높이 재설정도 그리기 전에 되돌린다");

  // 입력 중(포커스)이거나 글이 있으면 치지직이 키우는 것을 막지 않는다.
  const typing = await ev(`(async()=>{ const t=document.querySelector('textarea'); t.focus(); t.value='여러 줄';
    t.style.setProperty('height','60px','important'); return nextFrameHeight(); })()`);
  check(typing === "60px", "입력 중에는 치지직의 높이 조절을 그대로 둔다");

  // 채팅 너비 조절이 꺼져 있으면 손대지 않는다.
  const off = await ev(`(async()=>{ document.activeElement.blur(); document.querySelector('textarea').value='';
    document.documentElement.classList.remove('cheese-chat-width-resize-enabled');
    chzzkSwap('60px'); return nextFrameHeight(); })()`);
  check(off === "60px", "채팅 너비 조절을 쓰지 않으면(기본 폭) 손대지 않는다");

  // 멀티뷰 라이브 칸: 채팅 폭 조절은 꺼져 있지만, 광고로 펼쳐진 채팅의 입력창이 좁아
  // 안내 문구가 접히면 치지직이 80px 까지 키운다(2026-10-05 실측). 펼쳐진 동안 40px.
  const mvOpen = await ev(`(async()=>{ window.__mv.frame=true; chzzkSwap('80px'); return nextFrameHeight(); })()`);
  check(mvOpen === "40px", "멀티뷰 라이브 칸: 광고로 펼쳐진 채팅의 빈 입력창은 40px");
  const mvFolded = await ev(`(async()=>{ document.querySelector('aside').classList.add('_is_folded_x1');
    chzzkSwap('80px'); return nextFrameHeight(); })()`);
  check(mvFolded === "80px", "멀티뷰 칸에서 채팅이 접혀 있으면 손대지 않는다");
  const mvVod = await ev(`(async()=>{ document.querySelector('aside').classList.remove('_is_folded_x1');
    window.__mv.videoNo='123'; chzzkSwap('80px'); return nextFrameHeight(); })()`);
  check(mvVod === "80px", "멀티뷰 다시보기 칸은 손대지 않는다");
  check(JSON.stringify(await ev(`window.__errors`)) === "[]", "감시 중 오류가 없다");
  await ev(`window.__mv.frame=false; window.__mv.videoNo='';`);
  check(/function watchMultiviewAdChatInput\(\) \{\s*if \(isMultiviewReplay\(\)\) return;[\s\S]{0,400}adChatInputObserver = new MutationObserver\(\(\) => guardChatInputHeight\(\)\);\s*adChatInputObserver\.observe\(aside, \{\s*attributes: true,\s*attributeFilter: \["class"\],\s*childList: true,\s*subtree: true,/.test(content) &&
    /multiviewReconcileTimer = 0;\s*watchMultiviewAdChatInput\(\);/.test(content) &&
    /bootTimer = window\.setInterval\(\(\) => \{\s*watchMultiviewAdChatInput\(\);/.test(content),
    "멀티뷰 라이브 칸은 채팅창(aside)만 따로 지켜본다(펼침·입력창 교체), 칸 화면 정리 때 붙인다");

  check(/isChatStreamMutation\(mutation\),?\s*\)\s*\) \{\s*return;\s*\}\s*\/\/[^\n]*\n\s*guardChatInputHeight\(\);\s*scheduleChatTweak\(\);/.test(content) &&
    /chatObservedTargets = targets;\s*guardChatInputHeight\(\);/.test(content),
    "채팅 옵저버가 정리 주기보다 먼저, 그리고 붙는 즉시 입력창을 맞춘다");
  check((content.match(/chatInputHeightObserver\?\.disconnect\(\);/g) || []).length >= 3,
    "채팅 기능을 끄면 입력창 감시도 푼다");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})()
  .catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(() => { browser.kill("SIGTERM"); try { rmSync(dir, { recursive: true, force: true }); } catch {} });
