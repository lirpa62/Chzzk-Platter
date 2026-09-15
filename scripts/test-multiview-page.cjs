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
    window.sessionStore={};window.openedTabs=[];
    window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,
      // 목록 API 는 배경 스크립트가 중계한다(확장 페이지 직접 fetch 는 CORS 로 막힘).
      sendMessage:async(msg)=>{
        if(msg?.type!=='MULTIVIEW_API')return {ok:false,reason:'unknown'};
        return {ok:true,content:window.__apiContent(msg.url)};
      }},
      storage:{local:{get:async()=>({
          // 전용 팔로잉은 즐겨찾기·그룹에 든 채널만 추린다.
          cheeseFollowFavorites:['aaaa0000000000000000000000000001'],
          cheeseFollowCustomGroups:[
            {id:'g1',name:'친구',channelIds:['aaaa0000000000000000000000000002']},
            {id:'g2',name:'게임',channelIds:['aaaa0000000000000000000000000003']},
          ],
          cheeseFollowGroupOrder:['g2','g1'],
        }),set:async()=>{},remove:async()=>{}},
        session:{get:async(k)=>({[k]:window.sessionStore[k]}),
          set:async(o)=>{Object.assign(window.sessionStore,o);}},
        onChanged:{addListener:()=>{}}},
      tabs:{create:(o)=>{window.openedTabs.push(o.url);}}};
    // 치지직 API 스텁: 팔로잉 3채널.
    const channels=[
      {channelId:'aaaa0000000000000000000000000001',channelName:'채널하나',
        channelImageUrl:'',liveTitle:'방송1',concurrentUserCount:100},
      {channelId:'aaaa0000000000000000000000000002',channelName:'채널둘',
        channelImageUrl:'',liveTitle:'방송2',concurrentUserCount:200},
      {channelId:'aaaa0000000000000000000000000003',channelName:'채널셋',
        channelImageUrl:'',liveTitle:'방송3',concurrentUserCount:300},
      {channelId:'aaaa0000000000000000000000000004',channelName:'채널넷',
        channelImageUrl:'',liveTitle:'방송4',concurrentUserCount:400},
    ];
    // 실제 응답 모양을 따른다: 팔로잉은 followingList(+liveInfo/streamer),
    // 전체는 data, 검색은 data[].{live,channel}.
    window.__apiContent=(url)=>{
      const p=new URL(url).pathname;
      if(p.endsWith('/followings/live'))return {followingList:channels.map(c=>({
        channelId:c.channelId,channel:c,streamer:{openLive:true},
        liveInfo:{liveTitle:c.liveTitle,concurrentUserCount:c.concurrentUserCount,
          liveCategoryValue:'게임',
          liveImageUrl:'https://example.invalid/'+c.channelId+'/image_{type}.jpg'}}))};
      if(p.endsWith('/search/lives'))return {data:channels.map(c=>({channel:c,
        live:{liveTitle:c.liveTitle,concurrentUserCount:c.concurrentUserCount,
          liveCategoryValue:'게임'}}))};
      return {data:channels.map(c=>({channel:c,liveTitle:c.liveTitle,
        concurrentUserCount:c.concurrentUserCount,liveCategoryValue:'게임'}))};
    };
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
    `const items=document.querySelectorAll('#mvChannelList .mv-card');
     check(items.length===4,'채널 4개가 아니라 '+items.length+'개');`,
  );

  await test(
    "카드에 썸네일·시청자 수·제목이 함께 나온다",
    `const card=document.querySelector('#mvChannelList .mv-card');
     check(card.querySelector('.mv-card-thumb img'),'썸네일이 없다');
     const src=card.querySelector('.mv-card-thumb img').getAttribute('src');
     check(!src.includes('{type}'),'썸네일 {type} 이 치환되지 않았다: '+src);
     check(card.querySelector('.mv-card-viewers'),'시청자 수가 없다');
     check(card.querySelector('.mv-card-title').textContent.trim(),'제목이 비었다');
     check(card.querySelector('.mv-card-name').textContent.trim(),'채널명이 비었다');`,
  );

  await test(
    "전용 팔로잉은 즐겨찾기·그룹·나머지로 구분되고 그룹 순서를 따른다",
    `document.querySelector('[data-mv-source="custom"]').click();
     await wait(400);
     const heads=[...document.querySelectorAll('#mvChannelList .mv-section-name')]
       .map(el=>el.textContent);
     check(heads[0]==='즐겨찾기','첫 구역이 즐겨찾기가 아니다: '+heads.join(','));
     // cheeseFollowGroupOrder 가 ['g2','g1'] 이므로 게임(g2)이 친구(g1)보다 먼저다.
     check(heads.indexOf('게임')<heads.indexOf('친구'),
       '그룹 순서가 저장된 순서를 안 따른다: '+heads.join(','));
     check(heads.includes('팔로잉'),'나머지 팔로잉 구역이 없다: '+heads.join(','));
     // 같은 채널이 두 구역에 중복으로 들어가면 안 된다.
     const ids=[...document.querySelectorAll('#mvChannelList .mv-card')]
       .map(el=>el.dataset.mvPick);
     check(new Set(ids).size===ids.length,'같은 채널이 여러 구역에 중복됐다');
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);`,
  );

  await test(
    "전용 팔로잉에서만 구역 폴더가 나오고 고르면 그 구역만 남는다",
    `const folders=document.getElementById('mvFolders');
     // 팔로잉 탭에서는 폴더가 없어야 한다.
     check(folders.hidden,'팔로잉 탭인데 구역 폴더가 보인다');
     document.querySelector('[data-mv-source="custom"]').click();
     await wait(400);
     check(!folders.hidden,'전용 팔로잉인데 구역 폴더가 없다');
     const names=[...folders.querySelectorAll('.mv-folder-name')].map(e=>e.textContent);
     check(names[0]==='전체','첫 폴더가 전체가 아니다: '+names.join(','));
     check(names.includes('즐겨찾기')&&names.includes('게임')&&names.includes('팔로잉'),
       '구역 폴더가 빠졌다: '+names.join(','));
     // 구역을 고르면 그 구역만 남는다.
     const 게임=[...folders.querySelectorAll('.mv-folder')]
       .find(f=>f.querySelector('.mv-folder-name').textContent==='게임');
     게임.click();
     await wait(300);
     const heads=[...document.querySelectorAll('#mvChannelList .mv-section-name')]
       .map(e=>e.textContent);
     check(heads.length===1&&heads[0]==='게임',
       '고른 구역만 남지 않았다: '+heads.join(','));
     // ⚠ 폴더를 고르면 목록을 다시 그리므로 버튼 노드가 새로 생긴다. 다시 찾는다.
     const 게임2=[...folders.querySelectorAll('.mv-folder')]
       .find(f=>f.querySelector('.mv-folder-name').textContent==='게임');
     check(게임2.getAttribute('aria-pressed')==='true','고른 폴더 표시가 없다');
     // 전체로 되돌린다.
     folders.querySelector('[data-mv-folder=""]').click();
     await wait(300);
     check(document.querySelectorAll('#mvChannelList .mv-section-name').length>1,
       '전체로 돌아오지 않았다');
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);
     check(folders.hidden,'팔로잉으로 돌아왔는데 폴더가 남았다');`,
  );

  await test(
    "채널을 고르면 고른 목록과 개수가 갱신된다",
    // ⚠ 한 번 고를 때마다 목록을 다시 그리므로(선택 표시 갱신), 이전에 받아둔
    //   버튼 노드는 DOM 에서 떨어져 클릭이 먹지 않는다. 매번 다시 찾는다.
    `const at=i=>document.querySelectorAll('#mvChannelList .mv-card')[i];
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
    "세 목록(팔로잉·전용 팔로잉·검색)이 모두 채널을 불러온다",
    `for(const src of ['following','custom','search']){
       document.querySelector('[data-mv-source="'+src+'"]').click();
       if(src==='search'){
         const box=document.getElementById('mvSearch');
         box.value='테스트';
         box.dispatchEvent(new Event('input',{bubbles:true}));
       }
       await wait(400);
       const n=document.querySelectorAll('#mvChannelList .mv-card').length;
       check(n>0, src+' 목록이 비어 있다');
     }
     // 다시 팔로잉으로 돌려놓는다.
     document.querySelector('[data-mv-source="following"]').click();
     await wait(200);`,
  );

  await test(
    "배치 미리보기가 버튼 밖으로 삐져나가지 않는다",
    `// ⚠ 가로로 긴 배치(오른쪽 1 은 3.56:1)는 width:100% + aspect-ratio 로 두면
     //   버튼 폭을 넘어 밖으로 나간다(실측: 87px 버튼 안에 149px).
     for(const btn of document.querySelectorAll('#mvLayoutGrid .mv-layout')){
       const br=btn.getBoundingClientRect();
       const pv=btn.querySelector('.mv-layout-preview').getBoundingClientRect();
       check(pv.right<=br.right+1 && pv.left>=br.left-1 && pv.bottom<=br.bottom+1,
         btn.dataset.mvLayout+' 미리보기가 버튼 밖으로 나갔다: 버튼 '+
         Math.round(br.width)+'x'+Math.round(br.height)+' / 미리보기 '+
         Math.round(pv.width)+'x'+Math.round(pv.height));
     }`,
  );

  await test(
    "배치 미리보기가 실제 적용될 트랙 계산을 그대로 쓴다",
    `const L=window.CheeseMultiviewLayouts;
     const previews=[...document.querySelectorAll('#mvLayoutGrid .mv-layout')];
     check(previews.length>0,'미리보기가 없다');
     for(const p of previews){
       const id=p.dataset.mvLayout;
       const layout=L.layoutById(id);
       const tracks=L.solveTracks(layout);
       const box=p.querySelector('.mv-layout-preview');
       const want=tracks?tracks.columns:layout.columns;
       // 브라우저가 fr 값을 반올림해 다시 쓰므로(1.777778fr → 1.77778fr) 숫자로 비교한다.
       const nums=(v)=>String(v).trim().split(/\\s+/).map(x=>parseFloat(x));
       const got=nums(box.style.gridTemplateColumns), exp=nums(want);
       check(got.length===exp.length &&
         got.every((n,i)=>Math.abs(n-exp[i])<0.001),
         id+' 미리보기 열이 실제와 다르다: '+box.style.gridTemplateColumns+' vs '+want);
       // 행도 반영돼야 한다(예전에는 열만 썼다).
       check(box.style.gridTemplateRows,id+' 미리보기에 행이 없다');
     }`,
  );

  await test(
    "시작하면 구성을 넘기고 시청 화면을 새 탭으로 연다",
    `document.getElementById('mvStart').click();
     await wait(200);
     // 고정 키가 아니라 탭마다 다른 id 로 저장돼야 한다.
     const keys=Object.keys(window.sessionStore)
       .filter(k=>k.startsWith('cheeseMultiviewSetup:'));
     check(keys.length===1,'세션 키가 1개가 아니라 '+keys.length+'개');
     check(!window.sessionStore['cheeseMultiviewSetup'],
       '고정 키에 저장됐다(탭끼리 덮어쓴다)');
     const setup=window.sessionStore[keys[0]];
     check(setup.chosen.length===2,'넘긴 채널이 2개가 아니다');
     check(setup.layoutId,'배치가 비어 있다');
     check(window.openedTabs.length===1,'새 탭이 열리지 않았다');
     const opened=window.openedTabs[0];
     check(opened.includes('multiviewWatch.html'),'연 주소가 시청 화면이 아니다: '+opened);
     // 주소의 setup id 와 저장 키가 맞아야 시청 화면이 그 구성을 찾는다.
     const id=new URL(opened).searchParams.get('setup');
     check(id && keys[0]==='cheeseMultiviewSetup:'+id,
       '주소의 setup id 와 저장 키가 다르다: '+opened+' / '+keys[0]);
     window.__handoffId=id;`,
  );

  assert.deepEqual(await evaluate("errors"), [], "고르기 화면 조작 중 오류");
  checks.push("고르기 화면 조작 중 오류가 없다");

  // ── 시청 화면 ────────────────────────────────────────────────────────
  // 넘겨받은 구성으로 실제 프레임을 만드는지 확인한다.
  const handoffId = await evaluate("window.__handoffId");
  const setup = await evaluate(
    "window.sessionStore['cheeseMultiviewSetup:'+window.__handoffId]",
  );
  await evaluate(
    "document.documentElement.innerHTML = " +
      JSON.stringify(readFileSync("multiviewWatch.html", "utf8")),
  );
  await evaluate(`
    document.querySelectorAll('script,link').forEach(el=>el.remove());
    window.errors=[];
    addEventListener('error',e=>errors.push(e.message));
    addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    window.frameSrcs=[];
    Object.defineProperty(HTMLIFrameElement.prototype,'src',{
      set(v){window.frameSrcs.push(v);this.setAttribute('data-test-src',v);},
      get(){return this.getAttribute('data-test-src')||'';},
    });
    // 프레임으로 나가는 지시를 기록한다(교차 출처라 실제로는 못 가므로 흉내).
    window.sentMessages=[];
    Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{
      get(){const self=this;return {postMessage:(data,origin)=>{
        window.sentMessages.push({channelId:self.closest('.mv-cell')?.dataset.channelId,data,origin});
      }};},
    });
    window.sessionStore={'cheeseMultiviewSetup:${handoffId}':${JSON.stringify(setup)}};
    window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},
      storage:{session:{
        get:async(k)=>({[k]:window.sessionStore[k]}),
        set:async(o)=>{Object.assign(window.sessionStore,o);},
      }}};
    // 시청 화면은 location.search 의 setup id 를 읽는다. about:blank 문서는
    // search 를 가질 수 없고 location 도 재정의할 수 없어, 빈 search 로 만든
    // URLSearchParams 만 이 값으로 바꿔치기한다(테스트 전용 흉내).
    const RealUSP=window.URLSearchParams;
    window.URLSearchParams=function(init){
      return new RealUSP(init===''||init===undefined?'setup=${handoffId}':init);
    };
    window.URLSearchParams.prototype=RealUSP.prototype;
    window.check=(v,m)=>{if(!v)throw Error(m)};
    window.wait=ms=>new Promise(r=>setTimeout(r,ms));
    window.closeAll=()=>{document.body.click();};
  `);
  await evaluate(
    `{const s=document.createElement('style');s.textContent=${JSON.stringify(style)};document.head.append(s);}`,
  );
  await evaluate(readFileSync("src/multiviewLayouts.js", "utf8"));
  await evaluate(readFileSync("src/multiviewWatch.js", "utf8"));
  await evaluate("new Promise(r=>setTimeout(r,300))");

  await test(
    "시청 화면이 프레임을 만들고 메인만 소리가 켜진다",
    `const srcs=window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     check(srcs.length===2,'멀티뷰 프레임이 2개가 아니라 '+srcs.length+'개');
     const mains=srcs.filter(s=>s.includes('cheeseMultiMain=1'));
     check(mains.length===1,'메인 프레임이 1개가 아니라 '+mains.length+'개');
     check(mains[0].includes('cheeseMultiMuted=0'),'메인이 음소거로 시작한다');
     const subs=srcs.filter(s=>s.includes('cheeseMultiMain=0'));
     check(subs.every(s=>s.includes('cheeseMultiMuted=1')),'보조가 음소거가 아니다');`,
  );

  await test(
    "메인 고화질 선택 시 메인에는 화질 상한이 붙지 않는다",
    `const srcs=window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const main=srcs.find(s=>s.includes('cheeseMultiMain=1'));
     const sub=srcs.find(s=>s.includes('cheeseMultiMain=0'));
     check(!main.includes('cheeseMultiQuality'),'메인에 화질 상한이 붙었다');
     check(sub.includes('cheeseMultiQuality=480'),'보조에 480 상한이 없다');`,
  );

  await test(
    "채팅은 전용 채팅 주소를 쓴다",
    `const chat=window.frameSrcs.find(s=>s.includes('cheeseMultiChat=1'));
     check(chat,'채팅 프레임이 없다');
     check(/\\/live\\/[0-9a-f]{32}\\/chat/.test(chat),
       '채팅 주소가 /live/<id>/chat 이 아니다: '+chat);
     check(!chat.includes('cheeseMultiQuality'),
       '채팅 전용 페이지에는 화질 지시가 필요 없다');`,
  );

  await test(
    "닫아 둔 팝오버는 실제로 화면에서 사라진다",
    `// ⚠ .mv-pop-panel 이 display:flex/grid 를 지정하므로 hidden 속성만으로는
     //   숨겨지지 않았다(computed display 가 flex/grid 로 남아 전부 펼쳐져 보였다).
     for(const id of ['mvMainPanel','mvChatPanel','mvSidePanel','mvLayoutPanel']){
       const el=document.getElementById(id);
       check(el.hidden,id+' 이 처음부터 열려 있다');
       check(getComputedStyle(el).display==='none',
         id+' 이 hidden 인데 화면에 보인다(display: '+getComputedStyle(el).display+')');
     }`,
  );

  await test(
    "최상단 막대가 현재 상태를 보여 준다",
    `check(!document.getElementById('mvTopbar').hidden,'막대가 숨겨져 있다');
     const main=document.getElementById('mvMainValue').textContent;
     check(main && main!=='-','메인 채널 이름이 비어 있다: '+main);
     check(document.getElementById('mvLayoutValue').textContent!=='-','배치 이름이 비어 있다');
     check(document.getElementById('mvSideValue').textContent!=='-','채팅 위치가 비어 있다');`,
  );

  await test(
    "팝오버를 열면 고른 채널이 모두 나오고 바깥을 누르면 닫힌다",
    `document.querySelector('[data-mv-pop-toggle="main"]').click();
     const panel=document.getElementById('mvMainPanel');
     check(!panel.hidden,'팝오버가 열리지 않았다');
     check(panel.querySelectorAll('[data-mv-set-main]').length===2,
       '메인 후보가 2개가 아니다');
     check(panel.querySelectorAll('.mv-pop-option.is-on').length===1,
       '현재 선택 표시가 1개가 아니다');
     document.body.click();
     check(panel.hidden,'바깥 클릭으로 닫히지 않았다');`,
  );

  await test(
    "팝오버는 버튼을 눌러야만 열리고 그 밖을 누르면 닫힌다",
    `closeAll();
     const panel=document.getElementById('mvMainPanel');
     // 1) 버튼이 아닌 곳을 눌러서 열리면 안 된다.
     document.getElementById('mvTopbar').click();
     check(panel.hidden,'막대를 눌렀는데 팝오버가 열렸다');
     document.querySelector('[data-mv-pop="main"]').click();
     check(panel.hidden,'래퍼를 눌렀는데 팝오버가 열렸다');
     // 2) 버튼 안의 글자(span)를 눌러도 열려야 한다.
     document.querySelector('[data-mv-pop-toggle="main"] .mv-pop-value').click();
     check(!panel.hidden,'버튼 안 글자를 눌렀는데 안 열렸다');
     // 3) 열린 상태에서 '팝오버 래퍼의 버튼 바깥'을 누르면 닫혀야 한다.
     //    (예전 규칙은 .mv-pop 전체를 바깥으로 안 쳐서 닫히지 않았다.)
     document.querySelector('[data-mv-pop="side"]').click();
     check(panel.hidden,'다른 팝오버 래퍼를 눌렀는데 안 닫혔다');
     // 4) 패널 안의 빈 곳을 누르면 닫히지 않아야 한다(항목을 고르는 중).
     document.querySelector('[data-mv-pop-toggle="main"]').click();
     check(!panel.hidden,'다시 열리지 않았다');
     panel.click();
     check(!panel.hidden,'패널 안을 눌렀는데 닫혔다');
     // 5) 버튼을 다시 누르면 닫힌다.
     document.querySelector('[data-mv-pop-toggle="main"]').click();
     check(panel.hidden,'다시 눌렀는데 안 닫혔다');`,
  );

  await test(
    "메인을 바꿔도 프레임을 다시 걸지 않고 상태 메시지만 보낸다",
    `const before=window.frameSrcs.length;
     window.sentMessages.length=0;
     const cells=[...document.querySelectorAll('.mv-cell')];
     const sub=cells.find(c=>!c.classList.contains('is-main'));
     const subId=sub.dataset.channelId;
     const prevMain=document.querySelector('.mv-cell.is-main').dataset.channelId;
     sub.querySelector('[data-mv-promote]').click();
     await wait(100);
     // 핵심: 방송이 다시 로드되면 안 된다.
     check(window.frameSrcs.length===before,
       '메인 변경으로 프레임이 다시 걸렸다('+(window.frameSrcs.length-before)+'개)');
     // 대신 두 칸에 상태 지시가 가야 한다.
     const msgs=window.sentMessages.filter(m=>m.data?.type==='SET_MULTIVIEW_STATE');
     check(msgs.length===2,'상태 메시지가 2개가 아니라 '+msgs.length+'개');
     const toNew=msgs.find(m=>m.data.channelId===subId);
     const toOld=msgs.find(m=>m.data.channelId===prevMain);
     check(toNew && toNew.data.muted===false,'새 메인에 소리 켜기 지시가 없다');
     check(toNew.data.quality==='high','새 메인 화질 지시가 high 가 아니다');
     check(toOld && toOld.data.muted===true,'이전 메인에 음소거 지시가 없다');
     check(toOld.data.quality==='480','이전 메인 화질 지시가 480 이 아니다');
     // 보내는 대상 origin 을 치지직으로 한정해야 한다.
     check(msgs.every(m=>m.origin==='https://chzzk.naver.com'),
       '메시지 대상 origin 이 치지직이 아니다');
     const nowMain=document.querySelector('.mv-cell.is-main');
     check(nowMain.dataset.channelId===subId,'메인 표시가 옮겨가지 않았다');`,
  );

  await test(
    "배치를 바꿔도 프레임을 다시 걸지 않는다",
    `const before=window.frameSrcs.length;
     document.querySelector('[data-mv-pop-toggle="layout"]').click();
     const opts=[...document.querySelectorAll('[data-mv-set-layout]')];
     const other=opts.find(o=>!o.classList.contains('is-on'));
     check(other,'고를 다른 배치가 없다');
     const wanted=other.dataset.mvSetLayout;
     other.click();
     await wait(100);
     check(window.frameSrcs.length===before,
       '배치 변경으로 방송이 다시 로드됐다');
     check(document.getElementById('mvLayoutValue').textContent!=='-','배치 이름이 갱신 안 됨');
     // 새 배치에서도 칸이 모두 자리를 받았는지.
     const placed=[...document.querySelectorAll('.mv-cell')]
       .filter(c=>c.style.gridArea);
     check(placed.length===2,'자리를 못 받은 칸이 있다');`,
  );

  await test(
    "채팅 채널을 바꾸면 그 채널의 채팅 주소로 갈아탄다",
    `document.querySelector('[data-mv-pop-toggle="chat"]').click();
     const opts=[...document.querySelectorAll('[data-mv-set-chat]')];
     const other=opts.find(o=>!o.classList.contains('is-on'));
     const wanted=other.dataset.mvSetChat;
     other.click();
     await wait(100);
     const chat=[...window.frameSrcs].reverse().find(s=>s.includes('cheeseMultiChat=1'));
     check(chat.includes(wanted),'채팅이 고른 채널로 안 바뀌었다');
     check(document.getElementById('mvChatValue').textContent!=='-','채팅 표시가 비었다');`,
  );

  await test(
    "프레임 준비 신호를 받으면 로딩 덮개가 걷힌다",
    `const cell=document.querySelector('.mv-cell');
     const id=cell.dataset.channelId;
     check(cell.dataset.status==='loading','처음 상태가 loading 이 아니다');
     check(!cell.querySelector('.mv-cell-status').hidden,'로딩 덮개가 없다');
     // 치지직 출처에서 온 준비 신호만 받아야 한다.
     window.dispatchEvent(new MessageEvent('message',{
       origin:'https://evil.invalid',
       data:{source:'cheese-platter-multiview',type:'FRAME_READY',channelId:id}}));
     check(cell.dataset.status==='loading','다른 출처 신호를 받아들였다');
     window.dispatchEvent(new MessageEvent('message',{
       origin:'https://chzzk.naver.com',
       data:{source:'cheese-platter-multiview',type:'FRAME_READY',channelId:id}}));
     check(cell.dataset.status==='ready','준비 신호를 받고도 덮개가 남았다');
     check(cell.querySelector('.mv-cell-status').hidden,'덮개가 안 숨겨졌다');`,
  );

  await test(
    "칸마다 16:9 상자가 만들어진다",
    `// 실제 비율·레터박스 측정은 test-multiview-aspect.cjs 가 18개 배치 전부를
     // 다룬다. 여기서는 구조만 확인한다.
     const boxes=[...document.querySelectorAll('.mv-cell-inner')];
     check(boxes.length===2,'칸이 2개가 아니라 '+boxes.length+'개');
     check(boxes.every(b=>b.querySelector('iframe')),'상자 안에 프레임이 없다');`,
  );

  assert.deepEqual(await evaluate("errors"), [], "시청 화면 조작 중 오류");
  checks.push("시청 화면 조작 중 오류가 없다");

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
