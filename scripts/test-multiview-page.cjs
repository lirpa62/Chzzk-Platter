// 멀티뷰 페이지 런타임 검증(헤드리스 크롬 + CDP).
//
// 정적 검토로는 세 파일(multiview.html / multiviewLayouts.js / multiview.js)
// 사이의 배선 오류를 못 잡는다. 실제로 페이지를 띄워 채널을 고르고 시작까지
// 진행한 뒤, 프레임 URL 에 붙는 쿼리(메인/음소거/화질)를 확인한다.
//
// 네트워크는 전부 차단하고 fetch 를 스텁으로 대체한다(치지직 API 호출 금지).

const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");

const dir = mkdtempSync(join(tmpdir(), "cheese-multiview-"));
const browser = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buffer = "",
  seq = 0,
  stderr = "";
const pending = new Map();
browser.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
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
    if (msg.error) job.reject(Error(JSON.stringify(msg.error)));
    else job.resolve(msg.result);
  }
});
browser.on("close", () => {
  for (const job of pending.values())
    job.reject(Error("browser closed: " + stderr));
  pending.clear();
});
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });
}

const deadline = setTimeout(() => browser.kill("SIGTERM"), 45000);
const checks = [];
(async () => {
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const command = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await command("Network.enable");
  await command("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await evaluate(
    "document.documentElement.innerHTML = " +
      JSON.stringify(readFileSync("multiview.html", "utf8")),
  );
  // 스크립트·스타일 태그는 직접 평가로 넣으므로 제거(파일 URL 로딩 불가).
  await evaluate(`
    document.querySelectorAll('script,link').forEach(el=>el.remove());
    window.errors=[];
    addEventListener('error',e=>errors.push(e.message));
    addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    // iframe 이 실제 네트워크를 타지 않도록 src 대입을 가로채 기록만 한다.
    window.frameSrcs=[];
    const setSrc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src').set;
    Object.defineProperty(HTMLIFrameElement.prototype,'src',{
      set(v){window.frameSrcs.push(v);this.setAttribute('data-test-src',v);},
      get(){return this.getAttribute('data-test-src')||'';},
    });
    window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},
      storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}},
        onChanged:{addListener:()=>{}}}};
    // 치지직 API 스텁: 팔로잉 3채널.
    const channels=[
      {channelId:'aaaa0000000000000000000000000001',channelName:'채널하나',
        channelImageUrl:'',liveTitle:'방송1',concurrentUserCount:100},
      {channelId:'aaaa0000000000000000000000000002',channelName:'채널둘',
        channelImageUrl:'',liveTitle:'방송2',concurrentUserCount:200},
      {channelId:'aaaa0000000000000000000000000003',channelName:'채널셋',
        channelImageUrl:'',liveTitle:'방송3',concurrentUserCount:300},
    ];
    window.fetch=async(url)=>({ok:true,status:200,json:async()=>({code:200,
      content:{data:channels.map(c=>({channel:c,liveTitle:c.liveTitle,
        concurrentUserCount:c.concurrentUserCount,liveCategoryValue:'게임'})),
        followingList:channels.map(c=>({channel:c,streamer:{openLive:true},
          liveInfo:{liveTitle:c.liveTitle,concurrentUserCount:c.concurrentUserCount}})),
        totalCount:channels.length}})});
  `);
  const style = readFileSync("src/multiview.css", "utf8");
  await evaluate(
    `{const s=document.createElement('style');s.textContent=${JSON.stringify(style)};document.head.append(s);}`,
  );
  await evaluate(readFileSync("src/multiviewLayouts.js", "utf8"));
  await evaluate(readFileSync("src/multiview.js", "utf8"));
  await evaluate("new Promise(r=>setTimeout(r,300))");

  // 검증식 안에서 await 를 쓸 수 있도록 async IIFE 로 감싼다.
  const test = async (name, expression) => {
    await evaluate(`(async()=>{${expression}})()`);
    checks.push(name);
  };
  await evaluate(
    `window.check=(v,m)=>{if(!v)throw Error(m)};` +
      `window.wait=ms=>new Promise(r=>setTimeout(r,ms));`,
  );

  assert.deepEqual(await evaluate("errors"), [], "페이지 로드 중 오류 발생");
  checks.push("페이지가 오류 없이 로드된다");

  await test(
    "배치 정의가 전역으로 노출된다",
    `check(window.CheeseMultiviewLayouts,'CheeseMultiviewLayouts 없음');
     check(CheeseMultiviewLayouts.layoutsFor(2).length>0,'2채널 배치 없음');`,
  );

  await test(
    "팔로잉 채널 목록이 렌더된다",
    `const items=document.querySelectorAll('#mvChannelList .mv-channel');
     check(items.length===3,'채널 3개가 아니라 '+items.length+'개');`,
  );

  await test(
    "채널을 고르면 고른 목록과 개수가 갱신된다",
    // ⚠ 한 번 고를 때마다 목록을 다시 그리므로(선택 표시 갱신), 이전에 받아둔
    //   버튼 노드는 DOM 에서 떨어져 클릭이 먹지 않는다. 매번 다시 찾는다.
    `const at=i=>document.querySelectorAll('#mvChannelList .mv-channel')[i];
     at(0).click();
     await wait(50);
     at(1).click();
     await wait(50);
     check(document.querySelectorAll('#mvChosenList .mv-chosen-item').length===2,
       '고른 채널이 2개가 아니라 '+
       document.querySelectorAll('#mvChosenList .mv-chosen-item').length+'개');
     check(/2\\s*\\/\\s*6/.test(document.getElementById('mvChosenCount').textContent),
       '개수 표시 이상: '+document.getElementById('mvChosenCount').textContent);`,
  );

  await test(
    "2채널을 고르면 시작 버튼이 열리고 배치가 제시된다",
    `check(!document.getElementById('mvStart').disabled,'시작 버튼이 잠겨 있다');
     check(document.querySelectorAll('#mvLayoutGrid .mv-layout').length>0,'배치 없음');`,
  );

  await test(
    "시작하면 프레임이 생기고 메인만 소리가 켜진다",
    `document.getElementById('mvStart').click();
     await wait(200);
     check(document.getElementById('mvStage').hidden===false,'스테이지가 안 보임');
     const srcs=window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     check(srcs.length===2,'멀티뷰 프레임이 2개가 아니라 '+srcs.length+'개');
     const mains=srcs.filter(s=>s.includes('cheeseMultiMain=1'));
     check(mains.length===1,'메인 프레임이 1개가 아니라 '+mains.length+'개');
     check(mains[0].includes('cheeseMultiMuted=0'),'메인이 음소거로 시작한다');
     const subs=srcs.filter(s=>s.includes('cheeseMultiMain=0'));
     check(subs.every(s=>s.includes('cheeseMultiMuted=1')),'보조가 음소거가 아니다');`,
  );

  await test(
    "메인 고화질 체크 시 메인에는 화질 상한이 붙지 않는다",
    `const srcs=window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const main=srcs.find(s=>s.includes('cheeseMultiMain=1'));
     const sub=srcs.find(s=>s.includes('cheeseMultiMain=0'));
     check(!main.includes('cheeseMultiQuality'),'메인에 화질 상한이 붙었다');
     check(sub.includes('cheeseMultiQuality=480'),'보조에 480 상한이 없다');`,
  );

  await test(
    "채널 다시 고르기로 돌아가면 프레임이 정리된다",
    `document.getElementById('mvBack').click();
     await wait(100);
     check(document.getElementById('mvSetup').hidden===false,'설정 화면이 안 보임');
     check(document.querySelectorAll('#mvFrames iframe').length===0,'프레임이 남아 있다');`,
  );

  assert.deepEqual(await evaluate("errors"), [], "조작 중 오류 발생");
  checks.push("조작 중 오류가 없다");

  for (const name of checks) console.log(`  PASS ${name}`);
  console.log("\n전부 통과");
})()
  .catch((error) => {
    for (const name of checks) console.log(`  PASS ${name}`);
    console.error("\nFAIL " + (error?.message || error));
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(deadline);
    browser.kill("SIGTERM");
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
