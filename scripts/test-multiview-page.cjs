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
      // 팔로잉은 following-lives 를 쓴다(liveInfo 에 방송 썸네일까지 들어 있다).
      if(p.endsWith('/following-lives'))return {followingList:channels.map(c=>({
        channelId:c.channelId,channel:c,streamer:{openLive:true},
        liveInfo:{liveTitle:c.liveTitle,concurrentUserCount:c.concurrentUserCount,
          liveCategoryValue:'게임',
          liveImageUrl:'https://example.invalid/'+c.channelId+'/image_{type}.jpg'}}))};
      // 검색 결과 채널의 방송 정보는 live-detail 로 하나씩 받는다.
      const detail=p.match(/\\/channels\\/([0-9a-f]{32})\\/live-detail$/);
      if(detail){
        const c=channels.find(x=>x.channelId===detail[1]);
        if(!c)return {status:'CLOSE'};
        return {status:'OPEN',channel:c,liveTitle:c.liveTitle,
          concurrentUserCount:c.concurrentUserCount,liveCategoryValue:'게임',
          liveImageUrl:'https://example.invalid/'+c.channelId+'/image_{type}.jpg'};
      }
      // 채널 검색은 search/channels 를 쓴다(방송 정보는 없고 openLive 만 있다).
      if(p.endsWith('/search/channels'))return {data:channels.map(c=>({
        channel:{...c,openLive:true}}))};
      if(p.endsWith('/subscribe/channels'))return {data:[]};
      return {data:channels.map(c=>({channel:c,liveTitle:c.liveTitle,
        concurrentUserCount:c.concurrentUserCount,liveCategoryValue:'게임'}))};
    };
  `);
  const style = readFileSync("src/multiview.css", "utf8");
  await evaluate(
    `{const s=document.createElement('style');s.textContent=${JSON.stringify(style)};document.head.append(s);}`,
  );
  await evaluate(readFileSync("src/multiviewSources.js", "utf8"));
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
    "목록을 불러오는 동안 스켈레톤 카드를 보여 준다",
    `const box=document.getElementById('mvChannelList');
     // 느린 응답을 흉내 내 로딩 중 상태를 붙잡는다.
     const realSend=chrome.runtime.sendMessage;
     let release;
     const gate=new Promise(r=>{release=r;});
     chrome.runtime.sendMessage=async(msg)=>{await gate;return realSend(msg);};
     document.querySelector('[data-mv-source="all"]').click();
     await wait(50);
     const skeletons=box.querySelectorAll('.mv-card.is-skeleton');
     check(skeletons.length>0,'스켈레톤 카드가 없다');
     check(box.getAttribute('aria-busy')==='true','aria-busy 가 아니다');
     check(!box.textContent.includes('불러오는 중'),'아직 문구를 쓰고 있다');
     // 스켈레톤도 실제 카드와 같은 골격이어야 자리가 안 밀린다.
     check(skeletons[0].querySelector('.mv-card-thumb'),'스켈레톤에 썸네일 자리가 없다');
     release();
     chrome.runtime.sendMessage=realSend;
     await wait(400);
     check(box.querySelectorAll('.mv-card.is-skeleton').length===0,
       '다 불러왔는데 스켈레톤이 남았다');
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);`,
  );

  await test(
    "팔로잉 채널 목록이 렌더된다",
    `const items=document.querySelectorAll('#mvChannelList .mv-card');
     check(items.length===4,'채널 4개가 아니라 '+items.length+'개');`,
  );

  await test(
    "팔로잉·검색 카드에 방송 썸네일이 들어간다",
    `// ⚠ 프로필 이미지로 대체된 카드(is-fallback)가 아니라 방송 스냅샷이어야 한다.
     for(const src of ['following','search']){
       document.querySelector('[data-mv-source="'+src+'"]').click();
       if(src==='search'){
         const box=document.getElementById('mvSearch');
         box.value='테스트';
         box.dispatchEvent(new Event('input',{bubbles:true}));
       }
       await wait(500);
       const cards=[...document.querySelectorAll('#mvChannelList .mv-card')];
       check(cards.length>0, src+' 목록이 비어 있다');
       const fallback=cards.filter(c=>c.querySelector('.mv-card-thumb.is-fallback'));
       check(fallback.length===0,
         src+' 카드 '+fallback.length+'개가 프로필 이미지로 대체됐다(방송 썸네일 없음)');
       const img=cards[0].querySelector('.mv-card-thumb img');
       check(img && !img.getAttribute('src').includes('{type}'),
         src+' 썸네일 {type} 이 치환되지 않았다');
     }
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);`,
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
    "채널을 고르고 풀 때 목록을 다시 그리지 않는다",
    `// ⚠ 예전에는 고를 때마다 renderList() 가 돌아 목록이 통째로 새로 그려졌다
     //   (API 재호출 + 깜빡임). 카드 노드가 그대로 살아 있어야 한다.
     // 앞선 검사에서 이미 고른 채널이 있을 수 있다. 안 고른 카드로 시작한다.
     const first=[...document.querySelectorAll('#mvChannelList .mv-card')]
       .find(c=>!c.classList.contains('is-on'))
       || document.querySelector('#mvChannelList .mv-card');
     const before=document.querySelectorAll('#mvChannelList .mv-card').length;
     let apiCalls=0;
     const realSend=chrome.runtime.sendMessage;
     chrome.runtime.sendMessage=(msg)=>{apiCalls++;return realSend(msg);};
     first.click();
     await wait(150);
     // 같은 노드가 문서에 그대로 남아 있어야 한다(다시 그리면 떨어져 나간다).
     check(first.isConnected,'카드 노드가 교체됐다(목록을 다시 그렸다)');
     check(document.querySelectorAll('#mvChannelList .mv-card').length===before,
       '카드 개수가 달라졌다');
     check(first.classList.contains('is-on'),'고른 표시가 안 붙었다');
     check(first.querySelector('.mv-card-picked'),'선택됨 표시가 없다');
     check(apiCalls===0,'고르는데 API 를 다시 불렀다('+apiCalls+'회)');
     // 다시 눌러 해제해도 마찬가지.
     first.click();
     await wait(150);
     check(first.isConnected,'해제 때 목록을 다시 그렸다');
     check(!first.classList.contains('is-on'),'해제 표시가 안 됐다');
     check(!first.querySelector('.mv-card-picked'),'선택됨 표시가 남았다');
     check(apiCalls===0,'해제하는데 API 를 불렀다');
     chrome.runtime.sendMessage=realSend;`,
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
    // ⚠ 부모가 event.source 와 iframe.contentWindow 를 '같은 객체인지' 로 비교하므로
    //   접근할 때마다 새 객체를 주면 안 된다. iframe 마다 하나를 만들어 재사용한다.
    const frameWindows=new WeakMap();
    Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{
      get(){
        if(!frameWindows.has(this)){
          const self=this;
          frameWindows.set(this,{postMessage:(data,origin)=>{
            window.sentMessages.push(
              {channelId:self.closest('.mv-cell')?.dataset.channelId,data,origin});
          }});
        }
        return frameWindows.get(this);
      },
    });
    window.sessionStore={'cheeseMultiviewSetup:${handoffId}':${JSON.stringify(setup)}};
    // 빠른 바꾸기의 후보 목록도 중계로 받는다(고르기 화면과 같은 경로).
    const quickChannels=[
      {channelId:'aaaa0000000000000000000000000001',channelName:'채널하나'},
      {channelId:'aaaa0000000000000000000000000002',channelName:'채널둘'},
      {channelId:'aaaa0000000000000000000000000003',channelName:'채널셋'},
      {channelId:'aaaa0000000000000000000000000004',channelName:'채널넷'},
    ];
    window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,
      sendMessage:async(msg)=>{
        if(msg?.type!=='MULTIVIEW_API')return {ok:false};
        return {ok:true,content:{followingList:quickChannels.map(c=>({
          channelId:c.channelId,channel:c,streamer:{openLive:true},
          liveInfo:{liveTitle:'방송',concurrentUserCount:1}}))}};
      }},
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
  await evaluate(readFileSync("src/multiviewSources.js", "utf8"));
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
    `// 영상 프레임만 센다. 채팅 프레임은 '메인 따라가기' 로 같이 바뀌는 게 정상이다.
     const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     window.sentMessages.length=0;
     const cells=[...document.querySelectorAll('.mv-cell')];
     const sub=cells.find(c=>!c.classList.contains('is-main'));
     const subId=sub.dataset.channelId;
     const prevMain=document.querySelector('.mv-cell.is-main').dataset.channelId;
     sub.querySelector('[data-mv-promote]').click();
     await wait(100);
     // 핵심: 방송이 다시 로드되면 안 된다.
     check(videoSrcs().length===before,
       '메인 변경으로 영상 프레임이 다시 걸렸다('+(videoSrcs().length-before)+'개)');
     // 채팅은 메인을 따라가야 한다.
     const chat=[...window.frameSrcs].reverse().find(s=>s.includes('cheeseMultiChat=1'));
     check(chat.includes(subId),'채팅이 새 메인을 따라가지 않았다');
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
    "프레임 준비 신호를 받으면 바로 덮개가 걷힌다",
    `const cell=document.querySelector('.mv-cell');
     const id=cell.dataset.channelId;
     const win=cell.querySelector('iframe').contentWindow;
     const send=(o,d,src)=>{
       const e=new MessageEvent('message',{origin:o,data:d});
       Object.defineProperty(e,'source',{value:src===undefined?win:src});
       window.dispatchEvent(e);
     };
     const READY={source:'cheese-platter-multiview',type:'FRAME_READY',channelId:id};
     check(cell.dataset.status==='loading','처음 상태가 loading 이 아니다');
     check(!cell.querySelector('.mv-cell-status').hidden,'로딩 덮개가 없다');
     // 치지직 출처에서 온 것만 받아야 한다.
     send('https://evil.invalid',READY);
     check(cell.dataset.status==='loading','다른 출처 신호를 받아들였다');
     // ⚠ 그 칸의 프레임에서 온 것만 받아야 한다(남의 channelId 사칭 차단).
     send('https://chzzk.naver.com',READY,window);
     check(cell.dataset.status==='loading','다른 창이 보낸 신호를 받아들였다');
     // 모르는 타입도 무시한다.
     send('https://chzzk.naver.com',
       {source:'cheese-platter-multiview',type:'EVAL',channelId:id});
     check(cell.dataset.status==='loading','모르는 타입을 처리했다');
     // 제대로 된 신호 — 화면 정리를 기다리지 않고 바로 볼 수 있어야 한다.
     // ⚠ 예전에는 채팅 접기·넓은 화면까지 기다리다가, 치지직 DOM 이 늦게 뜨면
     //   '화면 정리를 완료하지 못했습니다' 가 됐다. 늦는 건 오류가 아니다.
     window.sentMessages.length=0;
     send('https://chzzk.naver.com',READY);
     check(cell.dataset.status==='ready',
       '준비 신호를 받고도 ready 가 아니다: '+cell.dataset.status);
     check(cell.querySelector('.mv-cell-status').hidden,'덮개가 안 숨겨졌다');
     // 소리·화질 상태는 여전히 다시 내려 줘야 한다(그 전 지시는 유실 가능).
     const resync=window.sentMessages.filter(m=>m.data?.type==='SET_MULTIVIEW_STATE'
       && m.data.channelId===id);
     check(resync.length===1,'준비 후 상태 재전송이 없다('+resync.length+'회)');
     const isMain=cell.classList.contains('is-main');
     check(resync[0].data.muted===!isMain,'재전송한 음소거 상태가 현재와 다르다');`,
  );

  await test(
    "화면 다시 적용은 덮개를 씌우지 않고 신호만 보낸다",
    `const cell=document.querySelector('.mv-cell');
     const id=cell.dataset.channelId;
     check(cell.dataset.status==='ready','시작 상태가 ready 가 아니다');
     window.sentMessages.length=0;
     // 오류 덮개가 없을 때도 쓸 수 있도록 직접 신호 경로를 확인한다.
     const before=window.frameSrcs.length;
     document.dispatchEvent(new MouseEvent('click',{bubbles:true}));
     // 실제 버튼은 오류 상태에서만 보이므로, 신호 함수가 하는 일을 확인한다.
     const btn=document.createElement('button');
     btn.dataset.mvReapply=id;
     document.getElementById('mvFrames').appendChild(btn);
     btn.click();
     await wait(100);
     const cmd=window.sentMessages.filter(m=>m.data?.type==='RECONCILE_MULTIVIEW_UI'
       && m.data.channelId===id);
     check(cmd.length===1,'다시 맞추라는 신호가 없다('+cmd.length+'회)');
     check(cmd[0].origin==='https://chzzk.naver.com','대상 origin 이 치지직이 아니다');
     // ⚠ 상태를 건드리지 않는다(기다리는 상태로 들어가지 않는다).
     check(cell.dataset.status==='ready','상태가 바뀌었다: '+cell.dataset.status);
     check(window.frameSrcs.length===before,'프레임이 다시 걸렸다');
     btn.remove();`,
  );

  await test(
    "방송 종료 신호를 받으면 칸을 지우지 않고 안내만 띄운다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     const cells=[...document.querySelectorAll('.mv-cell')];
     const target=cells.find(c=>!c.classList.contains('is-main')) || cells[0];
     const id=target.dataset.channelId;
     const mainBefore=document.querySelector('.mv-cell.is-main').dataset.channelId;
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'FRAME_ENDED',channelId:id}});
      Object.defineProperty(e,'source',
        {value:target.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     await wait(100);
     check(target.isConnected,'종료됐다고 칸을 지웠다');
     check(target.dataset.status==='ended','상태가 ended 가 아니다');
     const text=target.querySelector('.mv-cell-status-text').textContent;
     check(text.includes('종료'),'종료 안내 문구가 아니다: '+text);
     // 끝난 방송은 다시 불러와도 같은 종료 화면이다. 그래서 '다시 불러오기' 와
     // '화면 다시 적용' 은 두지 않고, 할 수 있는 두 가지만 남긴다.
     check(target.querySelector('[data-mv-replace]'),'다른 채널 선택 버튼이 없다');
     check(target.querySelector('[data-mv-recheck]'),'방송 다시 확인 버튼이 없다');
     check(!target.querySelector('[data-mv-retry]'),
       '종료 칸에 다시 불러오기가 남아 있다');
     check(!target.querySelector('[data-mv-reapply]'),
       '종료 칸에 화면 다시 적용이 남아 있다');
     check(document.querySelector('.mv-cell.is-main').dataset.channelId===mainBefore,
       '메인이 자동으로 바뀌었다');
     check(videoSrcs().length===before,'종료 신호로 프레임이 다시 걸렸다');
     check(document.querySelectorAll('.mv-cell').length===cells.length,
       '다른 칸이 영향을 받았다');`,
  );

  await test(
    "칸을 끌어 자리를 바꿔도 프레임을 다시 걸지 않는다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     const cells=[...document.querySelectorAll('.mv-cell')];
     check(cells.length>=2,'칸이 2개 미만이다');
     const mainCell=document.querySelector('.mv-cell.is-main');
     const other=cells.find(c=>c!==mainCell);
     const mainId=mainCell.dataset.channelId, otherId=other.dataset.channelId;
     // 손잡이가 있어야 드래그를 시작할 수 있다(iframe 위에서는 못 잡는다).
     const grip=other.querySelector('.mv-cell-grip');
     check(grip && grip.draggable,'자리 바꾸기 손잡이가 없다');
     const dt={effectAllowed:'',setDragImage(){},};
     const fire=(el,type,extra)=>{const e=new Event(type,{bubbles:true,cancelable:true});
       e.dataTransfer=dt; Object.assign(e,extra||{}); el.dispatchEvent(e); return e;};
     fire(grip,'dragstart');
     check(document.getElementById('mvFrames').classList.contains('is-dragging'),
       '드래그 중 표시가 안 붙었다');
     fire(mainCell,'dragover');
     fire(mainCell,'drop');
     fire(grip,'dragend');
     await wait(150);
     // 메인 자리로 끌었으니 메인이 바뀌어야 한다.
     check(document.querySelector('.mv-cell.is-main').dataset.channelId===otherId,
       '메인 자리로 끌었는데 메인이 안 바뀌었다');
     // 그래도 영상은 다시 걸리지 않는다.
     check(videoSrcs().length===before,
       '자리를 바꿨는데 영상이 다시 걸렸다('+(videoSrcs().length-before)+'개)');
     check(!document.getElementById('mvFrames').classList.contains('is-dragging'),
       'dragend 뒤에도 드래그 표시가 남았다');
     check(!document.querySelector('.mv-cell.is-drop-target'),'드롭 표시가 남았다');
     // 되돌린다(칸 안 '메인으로' 버튼을 쓴다).
     document.querySelector('.mv-cell[data-channel-id="'+mainId+'"] [data-mv-promote]')
       ?.click();
     await wait(100);`,
  );

  await test(
    "채팅 칸에 테마를 알린다",
    `// 채팅 프레임은 교차 출처라 부모가 직접 만질 수 없다. 지시를 보내야 한다.
     window.sentMessages.length=0;
     // 프레임이 준비됐다고 알려 오면 지금 테마를 보낸다.
     const chatReady=()=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type:'CHAT_FRAME_READY'}});
       Object.defineProperty(e,'source',
         {value:document.getElementById('mvChatFrame').contentWindow});
       window.dispatchEvent(e);
     };
     chatReady();
     await wait(100);
     let msgs=window.sentMessages.filter(m=>m.data?.type==='SET_MULTIVIEW_CHAT_VIEW');
     check(msgs.length>=1,'준비 신호를 받고도 테마를 안 보냈다');
     check(msgs[0].origin==='https://chzzk.naver.com','대상 origin 이 치지직이 아니다');
     check(typeof msgs[0].data.dark==='boolean','dark 가 boolean 이 아니다');
     // 테마를 바꾸면 다시 보내야 한다.
     window.sentMessages.length=0;
     const was=document.documentElement.dataset.theme;
     document.documentElement.dataset.theme = was==='dark' ? 'light' : 'dark';
     await wait(100);
     msgs=window.sentMessages.filter(m=>m.data?.type==='SET_MULTIVIEW_CHAT_VIEW');
     check(msgs.length>=1,'테마를 바꿨는데 채팅 칸에 안 알렸다');
     check(msgs[msgs.length-1].data.dark===(was!=='dark'),
       '알린 테마가 화면과 다르다');
     document.documentElement.dataset.theme=was;`,
  );

  await test(
    "채팅 준비 전에는 덮개를 보이고 준비되면 걷는다",
    `const box=document.getElementById('mvChatStatus');
     const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     // 채널을 바꾸면 '연결 중' 이 뜬다.
     document.querySelector('[data-mv-pop-toggle="chat"]').click();
     const other=[...document.querySelectorAll('[data-mv-set-chat]')]
       .find(o=>!o.classList.contains('is-on'));
     other.click();
     await wait(100);
     check(!box.hidden,'채팅 연결 중 덮개가 없다');
     check(box.textContent.includes('연결'),'연결 중 문구가 아니다');
     // 준비 신호가 오면 걷힌다.
     const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
       data:{source:'cheese-platter-multiview',type:'CHAT_FRAME_READY'}});
     Object.defineProperty(e,'source',
       {value:document.getElementById('mvChatFrame').contentWindow});
     window.dispatchEvent(e);
     await wait(50);
     check(box.hidden,'준비됐는데 덮개가 남았다');
     // 채팅을 다시 걸어도 영상은 그대로다.
     check(videoSrcs().length===before,'채팅 때문에 영상이 다시 걸렸다');`,
  );

  await test(
    "채팅 크기를 바꿔도 영상이 다시 걸리지 않는다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     const handle=document.getElementById('mvChatResize');
     check(handle,'크기 조절 손잡이가 없다');
     const stage=document.getElementById('mvStage');
     // 오른쪽 채팅으로 두고 키보드로 넓혀 본다.
     document.querySelector('[data-mv-pop-toggle="side"]').click();
     document.querySelector('[data-mv-set-side="right"]').click();
     await wait(100);
     const w0=document.getElementById('mvChat').getBoundingClientRect().width;
     for(let i=0;i<3;i++)
       handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
     await wait(100);
     const w1=document.getElementById('mvChat').getBoundingClientRect().width;
     check(w1!==w0,'채팅 크기가 바뀌지 않았다('+w0+' → '+w1+')');
     check(stage.style.getPropertyValue('--mv-chat-w'),'크기 변수가 설정되지 않았다');
     check(videoSrcs().length===before,'채팅 크기를 바꿨는데 영상이 다시 걸렸다');`,
  );

  await test(
    "종료된 칸을 다른 채널로 바꿔도 나머지는 그대로다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const cells=[...document.querySelectorAll('.mv-cell')];
     const target=cells.find(c=>!c.classList.contains('is-main'))||cells[0];
     const oldId=target.dataset.channelId;
     const others=cells.filter(c=>c!==target).map(c=>c.dataset.channelId);
     const countBefore=cells.length;
     const layoutBefore=document.getElementById('mvLayoutValue').textContent;
     // 종료 → 다른 채널 선택
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'FRAME_ENDED',channelId:oldId}});
      Object.defineProperty(e,'source',{value:target.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     await wait(50);
     check(target.dataset.status==='ended','종료 상태가 아니다');
     target.querySelector('[data-mv-replace]').click();
     await wait(500);
     const quick=document.getElementById('mvQuick');
     check(!quick.hidden,'교체 모드로 Quick 이 열리지 않았다');
     check(document.getElementById('mvQuickHint').textContent.includes('대신'),
       '교체 안내 문구가 없다');
     const card=quick.querySelector('[data-mv-quick-add]:not([disabled])');
     check(card,'교체할 후보가 없다');
     const newId=card.dataset.mvQuickAdd;
     const before=videoSrcs().length;
     card.click();
     await wait(300);
     // 새 칸 하나만 생기고 나머지는 건드리지 않는다.
     check(videoSrcs().length===before+1,
       '교체 때 새 칸 하나만 생겨야 한다(생긴 수 '+(videoSrcs().length-before)+')');
     check(!document.querySelector('.mv-cell[data-channel-id="'+oldId+'"]'),
       '옛 칸이 남아 있다');
     check(document.querySelector('.mv-cell[data-channel-id="'+newId+'"]'),
       '새 칸이 없다');
     check(document.querySelectorAll('.mv-cell').length===countBefore,
       '채널 수가 달라졌다');
     for(const id of others)
       check(document.querySelector('.mv-cell[data-channel-id="'+id+'"]'),
         '다른 칸 '+id.slice(0,6)+' 이 사라졌다');
     check(document.getElementById('mvLayoutValue').textContent===layoutBefore,
       '배치가 바뀌었다');`,
  );

  await test(
    "칸의 제거 버튼은 최소 2개일 때 잠긴다",
    `const closes=[...document.querySelectorAll('.mv-cell-close')];
     check(closes.length===document.querySelectorAll('.mv-cell').length,
       '칸마다 제거 버튼이 있어야 한다');
     const n=document.querySelectorAll('.mv-cell').length;
     if(n>2){
       check(!closes[0].disabled,'3개 이상인데 제거가 잠겨 있다');
     }
     // 2개가 될 때까지 뺀다.
     let guard=0;
     while(document.querySelectorAll('.mv-cell').length>2 && guard++<6){
       document.querySelector('.mv-cell-close:not([disabled])')?.click();
       await wait(150);
     }
     check(document.querySelectorAll('.mv-cell').length===2,'2개로 줄지 않았다');
     const locked=[...document.querySelectorAll('.mv-cell-close')];
     check(locked.every(b=>b.disabled),'2개인데 제거가 잠기지 않았다');
     check(locked[0].title.includes('최소 2개'),'왜 잠겼는지 알려 주지 않는다');`,
  );

  await test(
    "칸마다 16:9 상자가 만들어진다",
    `// 실제 비율·레터박스 측정은 test-multiview-aspect.cjs 가 18개 배치 전부를
     // 다룬다. 여기서는 구조만 확인한다.
     const boxes=[...document.querySelectorAll('.mv-cell-inner')];
     check(boxes.length===2,'칸이 2개가 아니라 '+boxes.length+'개');
     check(boxes.every(b=>b.querySelector('iframe')),'상자 안에 프레임이 없다');`,
  );

  await test(
    "Quick 칩 본문은 교체 모드, × 는 제거로 나뉜다",
    `// 앞 테스트가 열어 뒀을 수 있다. 토글이 아니라 '열린 상태' 를 만든다.
     if(document.getElementById('mvQuick').hidden)document.getElementById('mvBack').click();
     await wait(300);
     check(!document.getElementById('mvQuick').hidden,'Quick 이 열리지 않았다');
     const chips=[...document.querySelectorAll('.mv-quick-item')];
     check(chips.length>=2,'칩이 2개 미만이다');
     // × 는 제거만 한다(교체 모드가 켜지면 안 된다).
     const drop=chips[0].querySelector('[data-mv-quick-drop]');
     check(drop,'× 버튼이 없다');
     check(chips[0].querySelector('[data-mv-quick-replace]'),'칩 본문 버튼이 없다');
     check(!drop.closest('[data-mv-quick-replace]'),'× 가 칩 본문 버튼 안에 있다');
     // 칩 본문을 누르면 교체 모드로 들어간다.
     chips[1].querySelector('[data-mv-quick-replace]').click();
     await wait(100);
     check(document.getElementById('mvQuickHint').textContent.includes('대신'),
       '칩 클릭으로 교체 모드에 들어가지 않았다');
     check(document.getElementById('mvQuickCancelReplace'),'교체 취소 버튼이 없다');
     window.__hidBefore=document.getElementById('mvQuick').hidden;`,
  );

  await test(
    "칩에서 시작한 교체를 취소하면 Quick 은 열린 채로 남는다",
    `check(window.__hidBefore===false,'교체 모드 진입 시점에 이미 닫혀 있었다');
     document.getElementById('mvQuickCancelReplace').click();
     await wait(100);
     check(!document.getElementById('mvQuick').hidden,'Quick 이 닫혔다');
     check(!document.getElementById('mvQuickCancelReplace'),'취소 버튼이 남아 있다');
     check(!document.getElementById('mvQuickHint').textContent.includes('대신'),
       '교체 모드가 풀리지 않았다');`,
  );

  await test(
    "종료 덮개에서 시작한 교체를 취소하면 Quick 까지 닫힌다",
    `document.getElementById('mvQuickClose').click();
     await wait(50);
     const cells=[...document.querySelectorAll('.mv-cell')];
     const target=cells.find(c=>!c.classList.contains('is-main'))||cells[0];
     const id=target.dataset.channelId;
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'FRAME_ENDED',channelId:id}});
      Object.defineProperty(e,'source',{value:target.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     await wait(100);
     target.querySelector('[data-mv-replace]').click();
     await wait(300);
     check(!document.getElementById('mvQuick').hidden,'Quick 이 열리지 않았다');
     document.getElementById('mvQuickCancelReplace').click();
     await wait(100);
     // 덮개에서 왔으니 원래 보고 있던 화면으로 돌려놓는다.
     check(document.getElementById('mvQuick').hidden,'Quick 이 닫히지 않았다');`,
  );

  await test(
    "볼륨 조작이 iframe 을 다시 걸지 않고 지시만 보낸다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     // 프레임으로 나가는 지시를 엿본다.
     window.sentMsgs=[];
     for(const f of document.querySelectorAll('.mv-cell iframe')){
       if(!f.contentWindow.__patched){
         f.contentWindow.__patched=true;
         f.contentWindow.postMessage=(m)=>window.sentMsgs.push(m);
       }
     }
     document.getElementById('mvVolumeBtn').click();
     await wait(100);
     const pop=document.getElementById('mvVolumePop');
     check(!pop.hidden,'볼륨 팝오버가 열리지 않았다');
     const master=pop.querySelector('[data-mv-vol-master]');
     check(master,'전체 볼륨 슬라이더가 없다');
     master.value='50';
     master.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(100);
     check(videoSrcs().length===before,'볼륨 조작으로 프레임이 다시 걸렸다');
     const vol=window.sentMsgs.filter(m=>m.type==='SET_MULTIVIEW_STATE');
     check(vol.length>0,'볼륨 지시가 나가지 않았다');
     check(vol.every(m=>typeof m.volume==='number'&&m.volume>=0&&m.volume<=1),
       'volume 값이 0~1 범위가 아니다');
     // 전체 50% 이므로 메인(채널볼륨 100%)은 0.5 여야 한다.
     check(vol.some(m=>Math.abs(m.volume-0.5)<0.001),
       '전체 볼륨이 곱해지지 않았다: '+JSON.stringify(vol.map(m=>m.volume)));`,
  );

  await test(
    "보조 채널 볼륨을 올리면 '메인 채널만 소리' 가 풀린다",
    `const pop=document.getElementById('mvVolumePop');
     const focus=document.getElementById('mvVolFocus');
     check(focus&&focus.checked,'처음에는 메인만 소리가 켜져 있어야 한다');
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const auxRange=[...pop.querySelectorAll('[data-mv-vol-channel]')]
       .find(r=>r.dataset.mvVolChannel!==mainId);
     check(auxRange,'보조 채널 슬라이더가 없다');
     window.sentMsgs=[];
     auxRange.value='30';
     auxRange.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(100);
     check(!document.getElementById('mvVolFocus').checked,
       '보조 소리를 올렸는데 메인만 소리가 유지된다');
     const aux=window.sentMsgs.filter(m=>m.channelId!==mainId&&m.type==='SET_MULTIVIEW_STATE');
     check(aux.some(m=>m.muted===false),'보조 채널 음소거가 풀리지 않았다');`,
  );

  await test(
    "자동재생 차단을 볼륨 버튼이 알린다",
    `const mainCell=document.querySelector('.mv-cell.is-main');
     const id=mainCell.dataset.channelId;
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'AUDIO_INTERACTION_REQUIRED',channelId:id}});
      Object.defineProperty(e,'source',{value:mainCell.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     await wait(100);
     check(document.getElementById('mvVolumeBtn').classList.contains('is-warn'),
       '볼륨 버튼에 차단 표시가 없다');
     check(document.getElementById('mvVolEnable'),'소리 활성화 버튼이 없다');
     // 자동재생 해제는 사용자 조작 안에서 끝나야 확실하다. 칸 위 버튼도 남긴다.
     check(mainCell.querySelector('[data-mv-unmute]'),'칸 위 대비 버튼이 사라졌다');
     // ⚠ 누른 것만으로 경고를 지우지 않는다. 실제로 소리가 나기 시작했다는
     //    신호(AUDIO_INTERACTION_RESOLVED)를 받아야 지운다. 성공 전에 UI 만
     //    정상으로 바꾸면 안 들리는데 괜찮아 보인다.
     document.getElementById('mvVolEnable').click();
     await wait(100);
     check(document.getElementById('mvVolumeBtn').classList.contains('is-warn'),
       '성공 확인 전에 경고를 지웠다');
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'AUDIO_INTERACTION_RESOLVED',channelId:id}});
      Object.defineProperty(e,'source',{value:mainCell.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     await wait(100);
     check(!document.getElementById('mvVolumeBtn').classList.contains('is-warn'),
       '해제 신호를 받고도 경고가 남아 있다');
     check(!mainCell.querySelector('[data-mv-unmute]'),'칸 위 안내가 남아 있다');`,
  );

  await test(
    "통계 패널은 열려 있을 때만 물어보고 닫으면 멈춘다",
    `window.statsAsks=0;
     for(const f of document.querySelectorAll('.mv-cell iframe')){
       f.contentWindow.postMessage=(m)=>{
         if(m&&m.type==='REQUEST_MULTIVIEW_STATS')window.statsAsks++;
       };
     }
     document.getElementById('mvStatsBtn').click();
     await wait(100);
     check(!document.getElementById('mvStatsPop').hidden,'통계 팝오버가 안 열렸다');
     check(window.statsAsks>0,'열었는데 통계를 묻지 않았다');
     // 답이 오기 전에는 옛 숫자 대신 '대기 중' 이어야 한다.
     check(document.getElementById('mvStatsPop').textContent.includes('대기 중'),
       '응답 전에 대기 중 표시가 없다');
     // 답을 하나 보내면 그 값이 표에 뜬다.
     const cell=document.querySelector('.mv-cell');
     const id=cell.dataset.channelId;
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'MULTIVIEW_STATS',channelId:id,
              stats:{latencySec:2.1,width:1920,height:1080,fps:60,bitrateKbps:7800}}});
      Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     await wait(1200);
     const text=document.getElementById('mvStatsPop').textContent;
     check(text.includes('1920×1080'),'해상도가 표에 없다: '+text);
     check(text.includes('7.8 Mbps'),'비트레이트가 표에 없다: '+text);
     // 버튼으로 닫으면 더 묻지 않는다.
     document.getElementById('mvStatsBtn').click();
     await wait(100);
     const asked=window.statsAsks;
     await wait(1500);
     check(window.statsAsks===asked,
       '닫았는데도 계속 물어본다('+asked+'→'+window.statsAsks+')');
     // Esc 나 다른 팝오버로 닫았을 때도 멈춰야 한다(버튼 경로만 막으면 샌다).
     document.getElementById('mvStatsBtn').click();
     await wait(1200);
     check(window.statsAsks>asked,'다시 열었는데 묻지 않는다');
     document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
     await wait(100);
     const afterEsc=window.statsAsks;
     await wait(1500);
     check(window.statsAsks===afterEsc,
       'Esc 로 닫았는데 계속 물어본다('+afterEsc+'→'+window.statsAsks+')');`,
  );

  await test(
    "보조끼리 자리를 바꾸면 아무 지시도 나가지 않는다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     window.sentMsgs=[];
     for(const f of document.querySelectorAll('.mv-cell iframe')){
       f.contentWindow.postMessage=(m)=>window.sentMsgs.push(m);
     }
     const cells=[...document.querySelectorAll('.mv-cell')];
     const aux=cells.filter(c=>!c.classList.contains('is-main'));
     if(aux.length>=2){
       const a=aux[0].dataset.channelId,b=aux[1].dataset.channelId;
       const dt={effectAllowed:'',setDragImage(){},};
       const grip=aux[0].querySelector('.mv-cell-grip');
       grip.dispatchEvent(new MouseEvent('dragstart',{bubbles:true}));
       // dragstart 는 dataTransfer 가 필요하다. 직접 이벤트를 만들어 준다.
       const ds=new Event('dragstart',{bubbles:true});ds.dataTransfer=dt;
       Object.defineProperty(ds,'target',{value:grip});
       const drop=new Event('drop',{bubbles:true});drop.dataTransfer=dt;
       aux[0].querySelector('.mv-cell-grip').dispatchEvent(ds);
       aux[1].dispatchEvent(drop);
       await wait(200);
       check(videoSrcs().length===before,'보조끼리 바꿨는데 프레임이 다시 걸렸다');
     }`,
  );

  await test(
    "비트레이트는 kbps 로 받아 한 번만 Mbps 로 바꾼다",
    `document.getElementById('mvStatsBtn').click();
     await wait(100);
     const cell=document.querySelector('.mv-cell');
     const id=cell.dataset.channelId;
     const send=(stats)=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type:'MULTIVIEW_STATS',channelId:id,stats}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     // 1500 kbps → 1.5 Mbps (두 번 나누면 0.0 Mbps 가 된다)
     send({latencySec:3.2,width:854,height:480,fps:30,bitrateKbps:1500});
     await wait(1200);
     let text=document.getElementById('mvStatsPop').textContent;
     check(text.includes('1.5 Mbps'),'1500kbps 가 1.5 Mbps 로 안 나온다: '+text);
     check(!text.includes('0.0 Mbps'),'비트레이트를 두 번 나눴다: '+text);
     // 1000 미만은 kbps 그대로 보여 준다.
     send({latencySec:3.2,width:854,height:480,fps:30,bitrateKbps:800});
     await wait(1200);
     text=document.getElementById('mvStatsPop').textContent;
     check(text.includes('800 kbps'),'800kbps 표시가 없다: '+text);
     // 값이 없으면 추정하지 않고 '-' 로 둔다.
     send({latencySec:3.2,width:854,height:480,fps:30,bitrateKbps:null});
     await wait(1200);
     text=document.getElementById('mvStatsPop').textContent;
     check(!text.includes('Mbps')||text.includes('-'),'비트레이트가 없을 때 추정했다');`,
  );

  await test(
    "통합 스트림 정보는 다섯 열만 보여 준다",
    `const pop=document.getElementById('mvStatsPop');
     const heads=[...pop.querySelectorAll('thead th')].map(th=>th.textContent.trim());
     check(heads.join(',')==='채널,지연,해상도,FPS,비트레이트',
       '표 머리글이 다르다: '+heads.join(','));
     // 화질 진단용으로 잠깐 뒀던 열은 남지 않아야 한다.
     check(!pop.textContent.includes('≤480p'),'정책 열이 남아 있다');
     check(!pop.querySelector('.mv-stats-broken'),'정책 깨짐 표시가 남아 있다');
     // 종료·오류 줄의 colspan 도 열 수에 맞아야 한다(채널 뒤 데이터 열 4개).
     const state=pop.querySelector('.mv-stats-state');
     if(state)check(state.getAttribute('colspan')==='4',
       'colspan 이 열 수와 안 맞는다: '+state.getAttribute('colspan'));
     // 실제 화질은 해상도 열로 확인할 수 있어야 한다.
     check(pop.textContent.includes('1920×1080')||pop.textContent.includes('854×480'),
       '해상도가 표에 없다');`,
  );

  await test(
    "이상한 통계 값은 걸러서 화면에 넣지 않는다",
    `const cell=document.querySelector('.mv-cell');
     const id=cell.dataset.channelId;
     const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
       data:{source:'cheese-platter-multiview',type:'MULTIVIEW_STATS',channelId:id,
             stats:{latencySec:'<img src=x onerror=alert(1)>',width:{},height:[],
                    fps:'abc',bitrateKbps:'1,500 kbps'}}});
     Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
     window.dispatchEvent(e);
     await wait(1200);
     const pop=document.getElementById('mvStatsPop');
     check(!pop.querySelector('img'),'문자열이 태그로 들어갔다');
     check(!pop.textContent.includes('onerror'),'문자열이 그대로 새어 나왔다');
     // 숫자가 아닌 값은 '-' 로 떨어져야 한다(추정하지 않는다).
     check(!pop.textContent.includes('abc'),'숫자가 아닌 FPS 가 그대로 나왔다');
     check(!pop.textContent.includes('1,500'),'숫자가 아닌 비트레이트가 나왔다');
     document.getElementById('mvStatsBtn').click();
     await wait(100);`,
  );

  await test(
    "통계 폴링 중에 탭 복귀해도 요청이 겹치지 않는다",
    `// 패널을 연 상태(1초 폴링)에서 복귀하면 진단 probe 를 따로 만들지 않아야 한다.
     window.statsAsks=0;
     for(const f of document.querySelectorAll('.mv-cell iframe')){
       f.contentWindow.postMessage=(m)=>{
         if(m&&m.type==='REQUEST_MULTIVIEW_STATS')window.statsAsks++;
       };
     }
     document.getElementById('mvStatsBtn').click();
     await wait(2500);
     const frames=document.querySelectorAll('.mv-cell iframe').length;
     const base=window.statsAsks;
     document.dispatchEvent(new Event('visibilitychange'));
     await wait(2500);
     const added=window.statsAsks-base;
     // 2.5초 동안 폴링만 돌면 대략 2~3회다. probe 까지 겹치면 그보다 훨씬 많아진다.
     check(added<=frames*4,
       '복귀 때 요청이 겹쳤다(프레임당 '+(added/frames).toFixed(1)+'회)');
     document.getElementById('mvStatsBtn').click();
     await wait(100);`,
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
