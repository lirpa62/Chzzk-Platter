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

const deadline = setTimeout(() => browser.kill("SIGTERM"), 90000);
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
        channelImageUrl:'',liveTitle:'방송1',concurrentUserCount:100,
        tags:['태그1','태그2','태그3','태그4']},
      {channelId:'aaaa0000000000000000000000000002',channelName:'채널둘',
        channelImageUrl:'',liveTitle:'방송2',concurrentUserCount:200},
      {channelId:'aaaa0000000000000000000000000003',channelName:'채널셋',
        channelImageUrl:'',liveTitle:'방송3',concurrentUserCount:300},
      {channelId:'aaaa0000000000000000000000000004',channelName:'채널넷',
        channelImageUrl:'',liveTitle:'방송4',concurrentUserCount:400},
    ];
    // 실제 응답 모양을 따른다: 팔로잉은 followingList(+liveInfo/streamer),
    // 전체는 data, 검색은 data[].{live,channel}.
    window.__livePageCalls=0;
    window.__apiContent=(url)=>{
      const parsed=new URL(url),p=parsed.pathname;
      // 팔로잉은 following-lives 를 쓴다(liveInfo 에 방송 썸네일까지 들어 있다).
      if(p.endsWith('/following-lives'))return {followingList:channels.map(c=>({
        channelId:c.channelId,channel:c,streamer:{openLive:true},
        adult:c.channelId.endsWith('1'),
        liveInfo:{liveTitle:c.liveTitle,concurrentUserCount:c.concurrentUserCount,
          liveCategoryValue:'게임',
          tags:c.tags||[],
          liveImageUrl:'https://example.invalid/'+c.channelId+'/image_{type}.jpg'}}))};
      // 검색 결과 채널의 방송 정보는 live-detail 로 하나씩 받는다.
      const detail=p.match(/\\/channels\\/([0-9a-f]{32})\\/live-detail$/);
      if(detail){
        const c=channels.find(x=>x.channelId===detail[1]);
        if(!c)return {status:'CLOSE'};
        return {status:'OPEN',channel:c,liveTitle:c.liveTitle,
          adult:c.channelId.endsWith('1')?'true':false,
          concurrentUserCount:c.concurrentUserCount,liveCategoryValue:'게임',
          liveImageUrl:'https://example.invalid/'+c.channelId+'/image_{type}.jpg'};
      }
      // 채널 검색은 search/channels 를 쓴다(방송 정보는 없고 openLive 만 있다).
      if(p.endsWith('/search/channels'))return {data:channels.map(c=>({
        channel:{...c,openLive:true}}))};
      if(p.endsWith('/subscribe/channels'))return {data:[]};
      if(p.endsWith('/service/v1/lives')){
        window.__livePageCalls++;
        const second=parsed.searchParams.has('liveId');
        const data=second
          ? Array.from({length:3},(_,i)=>({channel:{channelId:(100+i).toString(16).padStart(32,'0'),
              channelName:'추가'+i},liveTitle:'추가 방송'+i,concurrentUserCount:10-i,
              liveCategoryValue:'추가',tags:['둘째']}))
          : Array.from({length:40},(_,i)=>{const c=channels[i]||{
              channelId:(10+i).toString(16).padStart(32,'0'),channelName:'라이브'+i};
              return {channel:c,liveTitle:c.liveTitle||'방송'+i,
                adult:i===0,
                concurrentUserCount:c.concurrentUserCount||100-i,
                liveCategoryValue:'게임',tags:c.tags||['태그']};});
        return {data,page:{next:second?null:{concurrentUserCount:61,liveId:9001}}};
      }
      return {data:channels.map(c=>({channel:c,liveTitle:c.liveTitle,
        concurrentUserCount:c.concurrentUserCount,liveCategoryValue:'게임',tags:c.tags||[]}))};
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
    "채널이 없을 때 배치 안내가 grid 전체 너비를 쓴다",
    `const hint=document.querySelector('#mvLayoutGrid > .mv-hint');
     check(hint,'빈 배치 안내가 없다');
     check(getComputedStyle(hint).gridColumnEnd==='-1','빈 안내가 마지막 열까지 차지하지 않는다');`,
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
       check(cards[0].querySelector('.mv-card-thumb.is-adult .mv-card-sr-only')?.textContent==='19 연령 제한',
         src+' 첫 카드에 연령 제한 오버레이가 없다');
     }
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);`,
  );

  await test(
    "카드에 LIVE·시청자·제목·카테고리·태그가 함께 나온다",
    `const card=document.querySelector('#mvChannelList .mv-card');
     check(card.querySelector('.mv-card-thumb img'),'썸네일이 없다');
     const src=card.querySelector('.mv-card-thumb img').getAttribute('src');
     check(!src.includes('{type}'),'썸네일 {type} 이 치환되지 않았다: '+src);
     check(card.querySelector('.mv-card-viewers'),'시청자 수가 없다');
     check(card.querySelector('.mv-card-live')?.textContent==='LIVE','LIVE 배지가 없다');
     check(card.querySelector('.mv-card-thumb.is-adult .mv-card-sr-only')?.textContent==='19 연령 제한',
       '연령 제한 오버레이가 없다');
     check(card.querySelector('.mv-card-title').textContent.trim(),'제목이 비었다');
     check(card.querySelector('.mv-card-name').textContent.trim(),'채널명이 비었다');
     check(card.querySelector('.mv-card-category-chip'),'카테고리가 없다');
     check(card.querySelectorAll('.mv-card-tag-chip').length===4,'태그 4개가 모두 보이지 않는다');
     check(!card.querySelector('.mv-card-tag-more'),'+N 표시가 남았다');`,
  );

  await test(
    "고르기 화면은 고정 최대 폭 없이 뷰포트를 활용한다",
    `const setup=document.querySelector('.mv-setup');
     const style=getComputedStyle(setup);
     check(style.maxWidth==='none','고르기 화면에 최대 폭이 남아 있다');
     check(Math.abs(setup.getBoundingClientRect().width-innerWidth)<1,
       '고르기 화면이 뷰포트 폭을 채우지 않는다');`,
  );

  for (const width of [1280, 1440, 1920]) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate("new Promise(r=>requestAnimationFrame(()=>r()))");
    await test(
      `${width}px에서 방송 카드 폭이 220~280px 범위를 유지한다`,
      `const widths=[...document.querySelectorAll('#mvChannelList .mv-card')]
         .map(card=>card.getBoundingClientRect().width);
       check(widths.length>0,'측정할 카드가 없다');
       check(widths.every(width=>width>=218&&width<=282),
         '카드 폭 범위 이상: '+widths.map(Math.round).join(','));`,
    );
  }
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await test(
    "라이브 탭은 아래쪽에서 다음 페이지를 기존 카드 뒤에 붙인다",
    `document.querySelector('[data-mv-source="all"]').click();
     await wait(400);
     const box=document.getElementById('mvChannelList');
     check(box.querySelectorAll('.mv-card').length===40,'첫 페이지가 40개가 아니다');
     const first=box.querySelector('.mv-card');
     box.scrollTop=box.scrollHeight;
     box.dispatchEvent(new Event('scroll'));
     await wait(400);
     check(box.querySelectorAll('.mv-card').length===43,'둘째 페이지가 append되지 않았다');
     check(first.isConnected,'다음 페이지 로드 중 기존 카드를 다시 그렸다');
     check(window.__livePageCalls===2,'라이브 API 호출 수 이상: '+window.__livePageCalls);
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);
     document.querySelector('[data-mv-source="all"]').click();
     await wait(300);
     check(box.querySelectorAll('.mv-card').length===43,
       '탭을 다시 열자 불러온 페이지가 사라졌다');
     check(window.__livePageCalls===2,'유효한 pager를 두고 다시 요청했다');
     document.querySelector('[data-mv-source="following"]').click();
     await wait(300);`,
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
     const oneHint=document.querySelector('#mvLayoutGrid > .mv-hint');
     check(oneHint&&getComputedStyle(oneHint).gridColumnEnd==='-1',
       '1개 선택 상태의 배치 안내가 전체 너비가 아니다');
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
     check(first.querySelector('.mv-card-picked svg'),'선택 overlay의 check가 없다');
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
    "6개를 채워도 선택한 카드는 유지되고 미선택 카드만 잠긴다",
    `document.querySelector('[data-mv-source="all"]').click();
     await wait(300);
     const box=document.getElementById('mvChannelList');
     const extras=[...box.querySelectorAll('.mv-card:not(.is-on)')].slice(0,4)
       .map(card=>card.dataset.mvPick);
     check(extras.length===4,'추가할 카드가 부족하다');
     for(const id of extras)box.querySelector('[data-mv-pick="'+id+'"]').click();
     check(document.getElementById('mvChosenCount').textContent.includes('6 / 6'),
       '6개 선택 상태가 아니다');
     for(const id of extras){
       const card=box.querySelector('[data-mv-pick="'+id+'"]');
       check(card.classList.contains('is-on')&&!card.disabled&&
         card.querySelector('.mv-card-picked'),'선택된 카드가 잠겼거나 overlay가 없다');
     }
     const unpicked=box.querySelector('.mv-card:not(.is-on)');
     check(unpicked?.disabled&&unpicked.classList.contains('is-limit')&&
       !unpicked.querySelector('.mv-card-picked'),
       '미선택 카드의 6/6 제한 표시가 올바르지 않다');
     for(const id of extras)box.querySelector('[data-mv-pick="'+id+'"]').click();
     check(document.getElementById('mvChosenCount').textContent.includes('2 / 6'),
       '추가한 카드 해제 후 2개로 돌아오지 않았다');
     document.querySelector('[data-mv-source="following"]').click();
     await wait(250);`,
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
      {channelId:'aaaa0000000000000000000000000001',channelName:'채널하나',tags:['하나','둘','셋','넷']},
      {channelId:'aaaa0000000000000000000000000002',channelName:'채널둘'},
      {channelId:'aaaa0000000000000000000000000003',channelName:'채널셋'},
      {channelId:'aaaa0000000000000000000000000004',channelName:'채널넷'},
    ];
    window.__quickLiveCalls=0;
    window.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p,
      sendMessage:async(msg)=>{
        if(msg?.type!=='MULTIVIEW_API')return {ok:false};
        const parsed=new URL(msg.url);
        if(parsed.pathname.endsWith('/service/v1/lives')){
          window.__quickLiveCalls++;
          const second=parsed.searchParams.has('liveId');
          if(second&&window.__failQuickNext){
            window.__failQuickNext=false;
            return {ok:false,reason:'temporary'};
          }
          const start=second?300:200,count=second?5:40;
          return {ok:true,content:{data:Array.from({length:count},(_,i)=>({
            channel:{channelId:(start+i).toString(16).padStart(32,'0'),
              channelName:'퀵'+(start+i)},liveTitle:'퀵 방송 '+(start+i),
            concurrentUserCount:1000-i,liveCategoryValue:'게임',
            adult:i===0,
            tags:i===0?['하나','둘','셋','넷']:['테스트']})),
            page:{next:second?null:{concurrentUserCount:961,liveId:7777}}}};
        }
        return {ok:true,content:{followingList:quickChannels.map(c=>({
          channelId:c.channelId,channel:c,streamer:{openLive:true},
          liveInfo:{liveTitle:'방송',concurrentUserCount:1,
            liveCategoryValue:'게임',tags:c.tags||[]}}))}};
      }},
      storage:{session:{
        get:async(k)=>({[k]:window.sessionStore[k]}),
        set:async(o)=>{Object.assign(window.sessionStore,o);},
      }},
      // '고르기 화면 열기' 는 열린 탭을 찾아 그리로 보내거나 새 탭을 연다.
      // 어떤 탭이 열려 있는지는 테스트가 window.fakeTabs 로 정한다.
      tabs:{
        create:async(o)=>{window.openedTabs.push(o.url);},
        query:async(q)=>{
          window.tabQueries.push(q.url);
          let base=String(q.url||'');
          if(base.endsWith('*'))base=base.slice(0,-1);
          return (window.fakeTabs||[])
            .filter((t)=>String(t.url||'').startsWith(base));
        },
        update:async(id,o)=>{window.tabUpdates.push(Object.assign({id},o));},
      },
      windows:{
        update:async(id,o)=>{window.windowUpdates.push(Object.assign({id},o));},
      }};
    window.openedTabs=[];window.tabQueries=[];
    window.tabUpdates=[];window.windowUpdates=[];window.fakeTabs=[];
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
  await evaluate(readFileSync("src/multiviewSync.js", "utf8"));
  await evaluate(readFileSync("src/multiviewDiagnostics.js", "utf8"));
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
     const mainUrl=new URL(main),subUrl=new URL(sub);
     check(mainUrl.searchParams.get('cheeseMultiQualityPolicy')==='highest',
       '메인의 명시적 최고 화질 정책이 없다');
     check(!mainUrl.searchParams.has('cheeseMultiQuality'),'메인에 화질 상한이 붙었다');
     check(subUrl.searchParams.get('cheeseMultiQualityPolicy')==='cap-480',
       '보조의 명시적 480 상한 정책이 없다');
     check(subUrl.searchParams.get('cheeseMultiQuality')==='480','보조에 480 상한이 없다');`,
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
    "채널 관리 Quick 라이브 목록은 가로 끝에서 다음 페이지를 붙인다",
    `check(document.getElementById('mvBack').textContent.includes('채널 관리'),
       '상단 진입 문구가 채널 관리가 아니다');
     document.getElementById('mvBack').click();
     await wait(300);
     const quick=document.getElementById('mvQuick');
     const rail=document.getElementById('mvQuickAdd');
     check(!quick.hidden,'채널 관리 패널이 열리지 않았다');
     check(quick.querySelector('.mv-quick-head strong')?.textContent.includes('채널 관리'),
       'Quick 제목이 채널 관리가 아니다');
     quick.querySelector('[data-mv-quick-source="live"]').click();
     check(rail.querySelector('.mv-quick-card.is-skeleton'),
       'Quick 탭 전환 직후 카드 스켈레톤이 없다');
     check(rail.getAttribute('aria-busy')==='true','Quick 로딩 상태가 전달되지 않는다');
     await wait(400);
     check(!rail.querySelector('.mv-quick-card.is-skeleton'),
       'Quick 목록 로드 후 스켈레톤이 남았다');
     const firstCount=rail.querySelectorAll('[data-mv-quick-add]').length;
     check(firstCount===40,
       'Quick 첫 페이지가 40개가 아니다: '+firstCount+' / 호출 '+window.__quickLiveCalls+
       ' / 폭 '+rail.clientWidth+':'+rail.scrollWidth);
     const first=rail.querySelector('[data-mv-quick-add]');
     window.__failQuickNext=true;
     rail.scrollLeft=rail.scrollWidth;
     rail.dispatchEvent(new Event('scroll'));
     await wait(400);
     check(rail.querySelectorAll('[data-mv-quick-add]').length===40,
       '실패한 다음 페이지 때문에 기존 Quick 카드가 사라졌다');
     const retry=rail.querySelector('[data-mv-quick-retry]');
     check(retry,'Quick 다음 페이지 재시도 버튼이 없다');
     retry.click();
     await wait(400);
     check(rail.querySelectorAll('[data-mv-quick-add]').length===45,
       'Quick 둘째 페이지가 append되지 않았다');
     check(first.isConnected,'Quick 다음 페이지 로드 중 기존 카드를 다시 그렸다');
     check(window.__quickLiveCalls===3,
       'Quick 라이브 API 호출 수 이상: '+window.__quickLiveCalls);
     quick.querySelector('[data-mv-quick-source="following"]').click();
     await wait(250);
     document.getElementById('mvQuickClose').click();
     check(quick.hidden,'채널 관리 패널이 닫히지 않았다');`,
  );

  await test(
    "싱크 패널은 세션 안에서만 켜지고 프레임을 다시 걸지 않는다",
    `const before=window.frameSrcs.length;
     document.getElementById('mvSyncBtn').click();
     const panel=document.getElementById('mvSyncPop');
     check(!panel.hidden,'싱크 패널이 열리지 않았다');
     check(panel.querySelectorAll('.mv-sync-row').length===2,'채널별 상태가 없다');
     const auto=panel.querySelector('#mvSyncAuto');
     auto.click();
     check(document.getElementById('mvSyncValue').textContent==='자동','자동 모드가 표시되지 않는다');
     panel.querySelector('#mvSyncAuto').click();
     document.body.click();
     check(panel.hidden,'싱크 패널이 닫히지 않았다');
     check(window.frameSrcs.length===before,'싱크 조작으로 프레임을 다시 걸었다');`,
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
    "직접 음소거한 채널은 메인을 바꿨다가 돌아와도 음소거를 유지한다",
    `const initial=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const other=document.querySelector('.mv-cell:not(.is-main)').dataset.channelId;
     const before=window.frameSrcs.filter(s=>s.includes('cheeseMulti=1')).length;
     document.getElementById('mvVolumeBtn').click();
     document.querySelector('[data-mv-vol-mute="'+initial+'"]').click();
     document.body.click();
     document.querySelector('.mv-cell[data-channel-id="'+other+'"] [data-mv-promote]').click();
     document.querySelector('.mv-cell[data-channel-id="'+initial+'"] [data-mv-promote]').click();
     const latest=[...window.sentMessages].reverse().find(m=>m.data.type==='SET_MULTIVIEW_STATE' &&
       m.data.channelId===initial);
     check(latest?.data.muted===true,'사용자 음소거가 메인 승격 중 풀렸다');
     document.getElementById('mvVolumeBtn').click();
     document.querySelector('[data-mv-vol-mute="'+initial+'"]').click();
     document.body.click();
     check(window.frameSrcs.filter(s=>s.includes('cheeseMulti=1')).length===before,
       '메인 왕복 변경으로 영상 프레임을 다시 걸었다');`,
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
    "메인만 듣기에서도 메인 음소거를 전환하고 보조 오디오는 잠근다",
    `const before=window.frameSrcs.length;
     const panel=document.getElementById('mvVolumePop');
     document.getElementById('mvVolumeBtn').click();
     check(!panel.hidden,'볼륨 패널이 열리지 않았다');
     const main=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const aux=document.querySelector('.mv-cell:not(.is-main)').dataset.channelId;
     check(!panel.querySelector('[data-mv-vol-mute="'+main+'"]').disabled,'메인 음소거가 잠겼다');
     check(panel.querySelector('[data-mv-vol-mute="'+aux+'"]').disabled,'보조 음소거가 열려 있다');
     window.sentMessages.length=0;
     panel.querySelector('[data-mv-vol-mute="'+main+'"]').click();
     check(window.sentMessages.some(m=>m.data.type==='SET_MULTIVIEW_STATE' &&
       m.data.channelId===main && m.data.muted===true),'메인 mute 지시가 없다');
     check(document.querySelector('[data-mv-vol-mute="'+main+'"]').getAttribute('aria-pressed')==='true',
       '메인 음소거 표시가 없다');
     panel.querySelector('[data-mv-vol-mute="'+main+'"]').click();
     check(window.sentMessages.some(m=>m.data.type==='SET_MULTIVIEW_STATE' &&
       m.data.channelId===main && m.data.muted===false),'메인 unmute 지시가 없다');
     check(window.frameSrcs.length===before,'음소거가 프레임을 다시 걸었다');
     document.body.click();`,
  );

  await test(
    "Quick 카드에는 모든 태그가 보이고 크기 조절값은 닫았다 열어도 유지된다",
    `const before=window.frameSrcs.length;
     document.getElementById('mvBack').click();
     document.querySelector('[data-mv-quick-source="live"]').click();
     await wait(350);
     const quick=document.getElementById('mvQuick');
     const card=quick.querySelector('[data-mv-quick-add]');
     check(card?.querySelectorAll('.mv-card-tag-chip').length===4,'Quick 태그 4개가 보이지 않는다');
     check(card.querySelector('.mv-quick-card-thumb.is-adult .mv-card-sr-only')?.textContent==='19 연령 제한',
       'Quick 카드에 연령 제한 오버레이가 없다');
     check(card.querySelector('.mv-card-category-chip')?.textContent==='게임','Quick 카테고리가 없다');
     for(const width of [450,650,900]){
       quick.style.width=width+'px';
       const cardWidth=card.getBoundingClientRect().width;
       const thumb=card.querySelector('.mv-quick-card-thumb').getBoundingClientRect();
       check(cardWidth>=149 && cardWidth<=206,'Quick 카드 폭이 비정상이다: '+width+' / '+cardWidth);
       check(Math.abs(thumb.width/thumb.height-16/9)<.05,'Quick 썸네일 비율이 깨졌다');
     }
     quick.style.width='';
     const handle=document.getElementById('mvQuickResize');
     check(handle && handle.tabIndex===0,'크기 조절 핸들이 없다');
     const old=quick.getBoundingClientRect();
     handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
     const resized=quick.getBoundingClientRect();
     check(resized.height>old.height,'세로 크기가 늘지 않았다');
     document.getElementById('mvQuickClose').click();
     document.getElementById('mvBack').click();
     check(Math.abs(quick.getBoundingClientRect().height-resized.height)<2,
       'Quick 크기가 다시 열 때 초기화됐다');
     check(window.frameSrcs.length===before,'Quick 크기 조절로 프레임을 다시 걸었다');
     document.getElementById('mvQuickClose').click();`,
  );

  await test(
    "Quick 포인터 드래그는 패널만 조절하고 영상을 유지한다",
    `document.getElementById('mvBack').click();
     const panel=document.getElementById('mvQuick');
     const handle=document.getElementById('mvQuickResize');
     const before=panel.getBoundingClientRect(),srcs=window.frameSrcs.length;
     let captured=-1;
     handle.setPointerCapture=id=>{captured=id};
     handle.hasPointerCapture=id=>captured===id;
     handle.dispatchEvent(new PointerEvent('pointerdown',{
       bubbles:true,button:0,pointerId:7,clientX:100,clientY:100}));
     handle.dispatchEvent(new PointerEvent('pointermove',{
       bubbles:true,pointerId:7,clientX:155,clientY:145}));
     handle.dispatchEvent(new PointerEvent('pointerup',{
       bubbles:true,pointerId:7,clientX:155,clientY:145}));
     const after=panel.getBoundingClientRect();
     check(after.width>before.width+20,'가로 드래그가 적용되지 않았다');
     check(after.height>before.height+20,'세로 드래그가 적용되지 않았다');
     check(window.frameSrcs.length===srcs,'크기 조절로 프레임을 다시 걸었다');
     document.getElementById('mvQuickClose').click();`,
  );

  await test(
    "믹서 상태는 해당 프레임에서만 받고 명령 후 응답값으로 확정한다",
    `const cell=document.querySelector('.mv-cell[data-status="ready"]');
     check(cell,'ready 프레임이 없다');
     const id=cell.dataset.channelId,win=cell.querySelector('iframe').contentWindow;
     const send=(data,origin='https://chzzk.naver.com',source=win)=>{
       const e=new MessageEvent('message',{origin,data});
       Object.defineProperty(e,'source',{value:source});window.dispatchEvent(e);
     };
     const state={ready:true,enabled:false,graphConflict:false,preset:'default',
       presetDirty:false,gain:1,gainMin:.25,gainMax:3,gainStep:.1,revision:1,
       presets:[{id:'default',label:'기본',kind:'builtin'},
         {id:'custom-a',label:'내 프리셋',kind:'custom'}]};
     const msg={source:'cheese-platter-multiview',type:'FRAME_MIXER_STATE',channelId:id,state};
     document.getElementById('mvVolumeBtn').click();
     check(window.sentMessages.some(m=>m.data.type==='MIXER_GET_STATE' && m.data.channelId===id),
       '패널을 열 때 믹서 상태를 요청하지 않았다');
     send(msg,'https://evil.invalid');send(msg,'https://chzzk.naver.com',window);
     check(!document.querySelector('[data-mv-mixer-gain="'+id+'"]'),'잘못된 출처를 수용했다');
     send(msg);
     const gain=document.querySelector('[data-mv-mixer-gain="'+id+'"]');
     check(gain && gain.min==='0.25' && gain.max==='3' && gain.dataset.gainStep==='0.1',
       '믹서 게인 범위가 MAIN snapshot과 다르다');
     const select=document.querySelector('[data-mv-mixer-preset="'+id+'"]');
     check(select.querySelector('option[value="custom-a"]'),'커스텀 프리셋이 없다');
     const before=window.frameSrcs.length;
     document.querySelector('[data-mv-mixer-enabled="'+id+'"]').click();
     const cmd=[...window.sentMessages].reverse().find(m=>m.data.type==='MIXER_SET_ENABLED' && m.data.channelId===id);
     check(cmd?.data.enabled===true,'믹서 ON 명령이 없다');
     check(!document.querySelector('[data-mv-mixer-enabled="'+id+'"]').checked,
       'MAIN 응답 전에 ON으로 확정했다');
     send({source:msg.source,type:'FRAME_MIXER_COMMAND_RESULT',channelId:id,
       command:'MIXER_SET_ENABLED',commandId:cmd.data.commandId,applied:true,
       state:{...state,enabled:true,revision:2}});
     check(document.querySelector('[data-mv-mixer-enabled="'+id+'"]').checked,
       'MAIN 응답의 ON 상태가 반영되지 않았다');
     const preset=document.querySelector('[data-mv-mixer-preset="'+id+'"]');
     preset.value='custom-a';preset.dispatchEvent(new Event('change',{bubbles:true}));
     const presetCmd=[...window.sentMessages].reverse().find(m=>m.data.type==='MIXER_SET_PRESET' && m.data.channelId===id);
     check(presetCmd?.data.presetId==='custom-a','커스텀 프리셋 명령이 없다');
     send({source:msg.source,type:'FRAME_MIXER_COMMAND_RESULT',channelId:id,
       command:'MIXER_SET_PRESET',commandId:presetCmd.data.commandId,applied:true,
       state:{...state,enabled:true,preset:'custom-a',revision:3}});
     check(document.querySelector('[data-mv-mixer-preset="'+id+'"]').value==='custom-a',
       '커스텀 프리셋 응답이 반영되지 않았다');
     const slider=document.querySelector('[data-mv-mixer-gain="'+id+'"]');
     slider.value='1.25';slider.dispatchEvent(new Event('input',{bubbles:true}));
     check(slider.isConnected,'게인 입력 중 패널을 다시 그렸다');
     slider.dispatchEvent(new Event('change',{bubbles:true}));
     const gainCmd=[...window.sentMessages].reverse().find(m=>m.data.type==='MIXER_SET_GAIN' && m.data.channelId===id);
     check(gainCmd?.data.gain===1.25,'최종 게인 명령이 없다');
     const flushCmd=[...window.sentMessages].reverse().find(m=>m.data.type==='MIXER_FLUSH_GAIN' && m.data.channelId===id);
     check(flushCmd,
       '게인 저장 확정 명령이 없다');
     send({source:msg.source,type:'FRAME_MIXER_COMMAND_RESULT',channelId:id,
       command:'MIXER_SET_GAIN',commandId:gainCmd.data.commandId,applied:true,
       state:{...state,enabled:true,preset:'custom-a',gain:1.3,revision:4}});
     send({source:msg.source,type:'FRAME_MIXER_COMMAND_RESULT',channelId:id,
       command:'MIXER_FLUSH_GAIN',commandId:flushCmd.data.commandId,applied:true,
       state:{...state,enabled:true,preset:'custom-a',gain:1.3,revision:4}});
     check(document.querySelector('[data-mv-mixer-gain="'+id+'"]').closest('label').querySelector('output').textContent==='130%',
       'MAIN이 보정한 게인값으로 갱신되지 않았다');
     document.querySelector('[data-mv-mixer-enabled="'+id+'"]').click();
     const offCmd=[...window.sentMessages].reverse().find(m=>m.data.type==='MIXER_SET_ENABLED' &&
       m.data.channelId===id && m.data.enabled===false);
     check(offCmd && offCmd.data.confirmed!==true,'첫 OFF 명령이 이미 확인 처리됐다');
     send({source:msg.source,type:'FRAME_MIXER_COMMAND_RESULT',channelId:id,
       command:'MIXER_SET_ENABLED',commandId:offCmd.data.commandId,applied:false,
       reason:'confirmation-required',state:{...state,enabled:true,preset:'custom-a',gain:1.3,revision:4}});
     check(document.querySelector('[data-mv-mixer-enabled="'+id+'"]').checked,
       '확인 전에 믹서가 꺼진 것처럼 표시됐다');
     const confirm=document.querySelector('[data-mv-mixer-confirm="'+id+'"]');
     check(confirm,'항상 켜기 해제 확인 UI가 없다');confirm.click();
     const confirmed=[...window.sentMessages].reverse().find(m=>m.data.type==='MIXER_SET_ENABLED' &&
       m.data.channelId===id && m.data.confirmed===true);
     check(confirmed?.data.enabled===false,'명시적인 확인 OFF 명령이 없다');
     send({source:msg.source,type:'FRAME_MIXER_COMMAND_RESULT',channelId:id,
       command:'MIXER_SET_ENABLED',commandId:confirmed.data.commandId,applied:true,
       state:{...state,enabled:false,preset:'custom-a',gain:1.3,revision:5}});
     check(!document.querySelector('[data-mv-mixer-enabled="'+id+'"]').checked,
       '확인 후 OFF 상태가 반영되지 않았다');
     check(window.frameSrcs.length===before,'믹서 명령이 프레임을 다시 걸었다');
     document.body.click();`,
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
    "소리가 나는 빠른 메인은 자동 seek 없이 rate만 보정한다",
    `const cells=[...document.querySelectorAll('.mv-cell')];
     const [slow,fast]=cells;
     if(!fast.classList.contains('is-main')){
       fast.querySelector('[data-mv-promote]').click();
       await wait(100);
     }
     const realNow=Date.now;
     let clock=realNow()+10000;
     Date.now=()=>clock;
     const post=(cell,type,stats)=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type,
           channelId:cell.dataset.channelId,...(stats?{stats}:{})}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     post(slow,'FRAME_READY');post(fast,'FRAME_READY');
     const raw=(delay)=>({currentTime:100,playbackRate:1,paused:false,readyState:4,
       syncRateOwned:false,userRateOverride:false,nativeDelaySec:delay,
       bufferAheadSec:2,edgeLagSec:delay-2,seekableStart:80,
       seekableEnd:100+delay,generation:1});
     post(slow,'FRAME_SYNC_STATS',raw(5));
     post(fast,'FRAME_SYNC_STATS',raw(3));
     clock+=4100;
     post(slow,'FRAME_SYNC_STATS',raw(5));
     post(fast,'FRAME_SYNC_STATS',raw(3));
     window.sentMessages.length=0;
     document.getElementById('mvSyncBtn').click();
     document.getElementById('mvSyncPop').querySelector('#mvSyncAuto').click();
     await wait(1200);
     const fastId=fast.dataset.channelId;
     check(!window.sentMessages.some(m=>m.data?.type==='APPLY_SYNC_SEEK'&&
       m.data.channelId===fastId),'소리가 나는 메인에 자동 seek가 나갔다');
     check(window.sentMessages.some(m=>m.data?.type==='APPLY_SYNC_RATE'&&
       m.data.channelId===fastId),'메인에 rate 보정이 나가지 않았다');
     document.getElementById('mvSyncPop').querySelector('#mvSyncAuto').click();
     document.body.click();
     Date.now=realNow;`,
  );

  await test(
    "싱크 통계는 해당 프레임에서만 받고 수동 기준·보정을 적용한다",
    `const cells=[...document.querySelectorAll('.mv-cell')];
     const [a,b]=cells;
     const aId=a.dataset.channelId,bId=b.dataset.channelId;
     const realNow=Date.now;
     let clock=realNow();
     Date.now=()=>clock;
     const send=(cell,type,stats,origin='https://chzzk.naver.com',src)=>{
       const e=new MessageEvent('message',{origin,data:{source:'cheese-platter-multiview',
         type,channelId:cell.dataset.channelId,stats}});
       Object.defineProperty(e,'source',{value:src||cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     const ack=(cell,cmd,applied=true,origin='https://chzzk.naver.com',src,
       channelId=cell.dataset.channelId)=>{
       const e=new MessageEvent('message',{origin,data:{source:'cheese-platter-multiview',
         type:'FRAME_SYNC_COMMAND_RESULT',channelId,commandId:cmd.data.commandId,
         command:cmd.data.type==='APPLY_SYNC_NUDGE'?'nudge':
           cmd.data.type==='APPLY_SYNC_SEEK'?'seek':
           cmd.data.type==='APPLY_SYNC_RATE'?'rate':'reset-rate',
         applied,reason:applied?null:'ad',generation:1,
         actualCurrentTime:100,actualPlaybackRate:cmd.data.rate||1}});
       Object.defineProperty(e,'source',{value:src||cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     const last=(type,id)=>[...window.sentMessages].reverse()
       .find(m=>m.data?.type===type&&m.data.channelId===id);
     send(a,'FRAME_READY');
     send(b,'FRAME_READY');
     clock+=5000;
     document.getElementById('mvSyncBtn').click();
     const panel=document.getElementById('mvSyncPop');
     const raw=(delay)=>({currentTime:100,playbackRate:1,paused:false,readyState:4,
       syncRateOwned:false,userRateOverride:false,
       nativeDelaySec:delay,bufferAheadSec:2,edgeLagSec:delay-2,
       seekableStart:80,seekableEnd:100+delay,generation:1});
     send(a,'FRAME_SYNC_STATS',raw(5),'https://evil.invalid');
     send(b,'FRAME_SYNC_STATS',raw(3),'https://chzzk.naver.com',window);
     check(!panel.textContent.includes('5.0초')&&!panel.textContent.includes('3.0초'),
       '다른 출처/창의 통계를 받아들였다');
     send(a,'FRAME_SYNC_STATS',raw(5));
     send(b,'FRAME_SYNC_STATS',raw(3));
     clock+=4100;
     send(a,'FRAME_SYNC_STATS',raw(5));
     send(b,'FRAME_SYNC_STATS',raw(3));
     await wait(1100);
     check(panel.textContent.includes('5.0초')&&panel.textContent.includes('3.0초'),
       '정상 프레임 통계가 표시되지 않는다');
     const before=window.frameSrcs.length;
     window.sentMessages.length=0;
     const ref=[...panel.querySelectorAll('[data-mv-sync-ref]')]
       .find(el=>el.dataset.mvSyncRef===bId);
     ref.click();
     check(document.getElementById('mvSyncValue').textContent==='수동',
       '기준 지정 후 수동 모드가 아니다');
     check(window.sentMessages.some(m=>m.data?.type==='APPLY_SYNC_SEEK'&&
       m.data.channelId===aId&&m.data.currentTime>100),
       '수동 기준으로 맞추는 seek가 없다');
     ack(a,last('APPLY_SYNC_SEEK',aId));
     clock+=300;
     const offset=[...panel.querySelectorAll('[data-mv-sync-offset]')]
       .find(el=>el.dataset.mvSyncOffset===aId&&el.dataset.step==='0.5');
     offset.click();
     check(!panel.textContent.includes('+0.5초'),'ACK 전에 수동 오프셋이 확정됐다');
     check(window.sentMessages.some(m=>m.data?.type==='APPLY_SYNC_NUDGE'&&
       m.data.channelId===aId&&m.data.deltaSec===-0.5),
       '프레임 현재 위치 기준 수동 보정 명령이 없다');
     const nudge=last('APPLY_SYNC_NUDGE',aId);
     ack(a,nudge,true,'https://evil.invalid');
     ack(a,nudge,true,'https://chzzk.naver.com',window);
     ack(a,nudge,true,'https://chzzk.naver.com',undefined,bId);
     ack(a,{data:{...nudge.data,commandId:nudge.data.commandId+999}},true);
     check(!panel.textContent.includes('+0.5초'),'잘못된 ACK를 받아들였다');
     ack(a,nudge);
     check(panel.textContent.includes('+0.5초'),'성공 ACK 뒤 오프셋이 바뀌지 않았다');
     ack(a,nudge,false);
     check(panel.textContent.includes('+0.5초'),'오래된 ACK가 상태를 바꿨다');
     clock+=300;
     const rejected=[...panel.querySelectorAll('[data-mv-sync-offset]')]
       .find(el=>el.dataset.mvSyncOffset===aId&&el.dataset.step==='0.5');
     rejected.click();
     const rejectedCommand=last('APPLY_SYNC_NUDGE',aId);
     check(rejectedCommand.data.commandId!==nudge.data.commandId,'새 명령 ID가 없다');
     ack(a,rejectedCommand,false);
     check(panel.textContent.includes('+0.5초')&&!panel.textContent.includes('+1.0초'),
       '실패한 수동 보정이 확정됐다');
     clock+=1600;
     panel.querySelector('#mvSyncAlign').click();
     await wait(500);
     check([...panel.querySelectorAll('.mv-sync-row')].some(row=>
       row.querySelector('[data-mv-sync-ref]')?.dataset.mvSyncRef===aId&&
       row.querySelector('.mv-sync-row-head')?.textContent.includes('기준')),
       '느린 채널이 정렬 기준으로 선택되지 않았다');
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     await wait(1200);
     check(window.sentMessages.some(m=>m.data?.type==='APPLY_SYNC_RATE'),
       '자동 모드의 재생속도 보정 명령이 없다');
     const rate=window.sentMessages.find(m=>m.data?.type==='APPLY_SYNC_RATE');
     ack(cells.find(c=>c.dataset.channelId===rate.data.channelId),rate);
     panel.querySelector('#mvSyncAuto').click();
     check(window.sentMessages.some(m=>m.data?.type==='RESET_SYNC_RATE'),
       '자동 모드를 끈 뒤 재생속도 원복 명령이 없다');
     check(window.frameSrcs.length===before,'싱크 명령이 프레임을 다시 불러왔다');
     document.body.click();
     Date.now=realNow;`,
  );

  await test(
    "실패 ACK·세대 교체·탭 복귀는 자동 보정 상태를 잘못 확정하지 않는다",
    `const cells=[...document.querySelectorAll('.mv-cell')];
     const [a,b]=cells;
     const aId=a.dataset.channelId,bId=b.dataset.channelId;
     if(!a.classList.contains('is-main')){
       a.querySelector('[data-mv-promote]').click();
       await wait(100);
     }
     const realNow=Date.now;
     let clock=realNow()+40000;
     Date.now=()=>clock;
     const post=(cell,type,extra={},origin='https://chzzk.naver.com',source)=>{
       const e=new MessageEvent('message',{origin,data:{source:'cheese-platter-multiview',
         type,channelId:cell.dataset.channelId,...extra}});
       Object.defineProperty(e,'source',{value:source||cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     const raw=(delay,generation)=>({currentTime:100,playbackRate:1,paused:false,readyState:4,
       syncRateOwned:false,userRateOverride:false,nativeDelaySec:delay,bufferAheadSec:2,
       edgeLagSec:delay-2,seekableStart:80,seekableEnd:100+delay,generation});
     const sample=(generation)=>{post(a,'FRAME_SYNC_STATS',{stats:raw(5,generation)});
       post(b,'FRAME_SYNC_STATS',{stats:raw(3,generation)});};
     const commands=(type)=>window.sentMessages.filter(m=>m.data?.type===type&&
       m.data.channelId===bId);
     const reply=(command,applied)=>post(b,'FRAME_SYNC_COMMAND_RESULT',{
       commandId:command.data.commandId,
       command:command.data.type==='APPLY_SYNC_SEEK'?'seek':
         command.data.type==='APPLY_SYNC_RATE'?'rate':'reset-rate',
       applied,reason:applied?null:'ad',generation:2,
       actualCurrentTime:100,actualPlaybackRate:command.data.rate||1});
     const panel=document.getElementById('mvSyncPop');
     document.getElementById('mvSyncBtn').click();
     sample(2);
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     await wait(1100);
     check(commands('APPLY_SYNC_SEEK').length===0&&commands('APPLY_SYNC_RATE').length===0,
       '첫 generation 직후 자동 보정이 실행됐다');
     clock+=4100;sample(2);
     await wait(1100);
     const failedSeek=commands('APPLY_SYNC_SEEK').at(-1);
     const failedRate=commands('APPLY_SYNC_RATE').at(-1);
     check(failedSeek&&failedRate,'안정화 뒤 자동 명령이 없다');
     reply(failedSeek,false);
     reply(failedRate,false);
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     check(commands('RESET_SYNC_RATE').length===0,
       '실패한 rate를 extension 소유로 취급했다');
     clock+=1600;sample(2);
     panel.querySelector('#mvSyncAuto').click();
     await wait(1100);
     const retrySeek=commands('APPLY_SYNC_SEEK').at(-1);
     const retryRate=commands('APPLY_SYNC_RATE').at(-1);
     check(retrySeek&&retryRate,'실패 후 30초 이내 재시도하지 않았다');
     reply(retrySeek,true);
     reply(retryRate,true);
     window.sentMessages.length=0;
     clock+=1600;sample(2);
     await wait(1100);
     check(commands('APPLY_SYNC_SEEK').length===0,
       '성공한 seek의 30초 쿨다운이 적용되지 않았다');
     panel.querySelector('#mvSyncAuto').click();
     check(commands('RESET_SYNC_RATE').length===1,
       '성공한 rate ownership이 기록되지 않았다');
     const hiddenDescriptor=Object.getOwnPropertyDescriptor(document,'hidden');
     let hidden=true;
     Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
     document.dispatchEvent(new Event('visibilitychange'));
     hidden=false;
     clock+=40000;
     document.dispatchEvent(new Event('visibilitychange'));
     sample(2);
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     await wait(1100);
     check(commands('APPLY_SYNC_RATE').length===0,
       '탭 복귀 직후 자동 속도 보정이 실행됐다');
     clock+=4100;sample(2);
     await wait(1100);
     const oldSeek=commands('APPLY_SYNC_SEEK').at(-1);
     check(oldSeek,'탭 복귀 안정화 이후 seek가 없다');
     sample(3);
     reply(oldSeek,true);
     clock+=4100;sample(3);
     window.sentMessages.length=0;
     await wait(1100);
     check(commands('APPLY_SYNC_SEEK').length>0,
       '세대 교체 뒤 오래된 ACK가 쿨다운을 시작했다');
     panel.querySelector('#mvSyncAuto').click();
     document.body.click();
     if(hiddenDescriptor)Object.defineProperty(document,'hidden',hiddenDescriptor);
     else delete document.hidden;
     Date.now=realNow;`,
  );

  await test(
    "rate ACK 유실은 stats로 복구하고 사용자 배속과 구분한다",
    `const cells=[...document.querySelectorAll('.mv-cell')];
     const [a,b]=cells;
     const aId=a.dataset.channelId,bId=b.dataset.channelId;
     const realNow=Date.now;
     let clock=realNow()+90000;
     Date.now=()=>clock;
     const post=(cell,type,extra={})=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type,
           channelId:cell.dataset.channelId,...extra}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     const raw=(delay,generation,rate=1,owned=false,user=false)=>({
       currentTime:100,playbackRate:rate,paused:false,readyState:4,
       syncRateOwned:owned,userRateOverride:user,nativeDelaySec:delay,
       bufferAheadSec:2,edgeLagSec:0,seekableStart:80,seekableEnd:100+delay,
       generation});
     const sample=(rate=1,owned=false,user=false,generation=20)=>{
       post(a,'FRAME_SYNC_STATS',{stats:raw(5,generation)});
       post(b,'FRAME_SYNC_STATS',{stats:raw(3,generation,rate,owned,user)});
     };
     const commands=(type)=>window.sentMessages.filter(m=>
       m.data?.type===type&&m.data.channelId===bId);
     const ack=(command,applied=true,generation=20,rate=1)=>post(b,
       'FRAME_SYNC_COMMAND_RESULT',{commandId:command.data.commandId,
         command:command.data.type==='APPLY_SYNC_RATE'?'rate':'reset-rate',
         applied,reason:applied?null:'ad',generation,actualCurrentTime:100,
         actualPlaybackRate:rate});
     post(a,'FRAME_READY');post(b,'FRAME_READY');
     sample();clock+=4100;sample();
     document.getElementById('mvSyncBtn').click();
     const panel=document.getElementById('mvSyncPop');

     // APPLY_SYNC_RATE는 적용됐지만 ACK가 유실된 상황이다.
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     await wait(1100);
     const lostRate=commands('APPLY_SYNC_RATE').at(-1);
     check(lostRate,'ACK 유실 대상으로 쓸 rate 명령이 없다');
     // pending 중간 stats는 ACK/timeout보다 먼저 ownership을 확정하지 않는다.
     sample(1,false,false);
     await wait(2200);
     sample(lostRate.data.rate,true,false);
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     const recoveredReset=commands('RESET_SYNC_RATE').at(-1);
     check(recoveredReset,'stats로 ownership을 복구한 뒤 reset을 보내지 않았다');
     // reset pending 중 owned stats가 와도 reset을 중복 발행하지 않는다.
     sample(lostRate.data.rate,true,false);
     await wait(1100);
     check(commands('RESET_SYNC_RATE').length===1,
       'reset pending 중 stats가 중복 reset을 만들었다');
     // frame에서는 reset됐지만 ACK만 유실된 경우 timeout 뒤 stats로 정리한다.
     sample(1,false,false);
     await wait(1200);
     sample(1,false,false);
     clock+=1600;
     await wait(1100);
     check(commands('RESET_SYNC_RATE').length===1,
       'reset 성공 stats 뒤 불필요한 reset을 재시도했다');

     // ACK도 없고 실제 적용도 안 된 경우 ownership을 만들지 않는다.
     clock+=5000;sample();
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     await wait(1100);
     check(commands('APPLY_SYNC_RATE').length===1,'두 번째 rate 명령이 없다');
     await wait(2200);
     sample(1,false,false);
     window.sentMessages.length=0;
     panel.querySelector('#mvSyncAuto').click();
     check(commands('RESET_SYNC_RATE').length===0,
       '적용되지 않은 rate를 ownership으로 복구했다');

     // 사용자 1.5x와 낮은 generation의 늦은 stats도 ownership이 아니다.
     sample(1.5,false,true,21);
     post(b,'FRAME_SYNC_STATS',{stats:raw(3,20,0.95,true,false)});
     window.sentMessages.length=0;
     await wait(1100);
     check(commands('RESET_SYNC_RATE').length===0,
       '사용자 배속 또는 이전 generation을 sync ownership으로 오인했다');

     // reset도 실제로 실패했다면 timeout/backoff 뒤 stats를 근거로 재시도한다.
     window.sentMessages.length=0;
     sample(0.95,true,false,22);
     const failedReset=commands('RESET_SYNC_RATE').at(-1);
     check(failedReset,'frame ownership을 원복하는 reset이 없다');
     sample(0.95,true,false,22);
     check(commands('RESET_SYNC_RATE').length===1,
       'reset pending 중 명령을 중복 전송했다');
     await wait(2200);
     sample(0.95,true,false,22);
     check(commands('RESET_SYNC_RATE').length===1,
       'reset timeout 직후 backoff 없이 재시도했다');
     clock+=1600;
     sample(0.95,true,false,22);
     check(commands('RESET_SYNC_RATE').length===2,
       'reset 실패 상태를 backoff 뒤 재시도하지 않았다');
     ack(commands('RESET_SYNC_RATE').at(-1),true,22,1);
     document.body.click();
     Date.now=realNow;`,
  );

  await test(
    "방송 종료 신호를 받으면 칸을 지우지 않고 안내만 띄운다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     const cells=[...document.querySelectorAll('.mv-cell')];
     const target=cells.find(c=>!c.classList.contains('is-main')) || cells[0];
     const id=target.dataset.channelId;
     const mainBefore=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const main=cells.find(c=>c!==target);
     const post=(cell,type,extra={})=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type,
           channelId:cell.dataset.channelId,...extra}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     post(main,'FRAME_READY');post(target,'FRAME_READY');
     const raw=(delay)=>({currentTime:100,playbackRate:1,paused:false,readyState:4,
       syncRateOwned:false,userRateOverride:false,nativeDelaySec:delay,
       bufferAheadSec:2,edgeLagSec:0,seekableStart:80,seekableEnd:100+delay,
       generation:4});
     post(main,'FRAME_SYNC_STATS',{stats:raw(5)});
     post(target,'FRAME_SYNC_STATS',{stats:raw(3)});
     document.getElementById('mvSyncBtn').click();
     const panel=document.getElementById('mvSyncPop');
     panel.querySelector('[data-mv-sync-ref="'+main.dataset.channelId+'"]').click();
     const row=()=>[...panel.querySelectorAll('.mv-sync-row')].find(r=>
       r.querySelector('[data-mv-sync-ref]')?.dataset.mvSyncRef===id);
     const beforeOffset=row().querySelector('output').textContent;
     const nudge=[...row().querySelectorAll('[data-mv-sync-offset]')]
       .find(el=>el.dataset.step==='0.5');
     nudge.click();
     const pending=[...window.sentMessages].reverse().find(m=>
       m.data?.type==='APPLY_SYNC_NUDGE'&&m.data.channelId===id);
     check(pending,'종료 전 보류 중인 보정 명령이 없다');
     {const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
        data:{source:'cheese-platter-multiview',type:'FRAME_ENDED',channelId:id}});
      Object.defineProperty(e,'source',
        {value:target.querySelector('iframe').contentWindow});
      window.dispatchEvent(e);}
     post(target,'FRAME_SYNC_COMMAND_RESULT',{
       commandId:pending.data.commandId,command:'nudge',applied:true,reason:null,
       actualCurrentTime:99.5,actualPlaybackRate:1,generation:4});
     check(row().querySelector('output').textContent===beforeOffset,
       '종료된 프레임의 늦은 ACK가 오프셋을 바꿨다');
     document.body.click();
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
     // 표 아래 설명 문구는 없앴다(표만 보여 준다).
     check(!pop.querySelector('.mv-stats-note'),'하단 안내 요소가 남아 있다');
     check(!pop.textContent.includes('지연은 플레이어가'),'하단 안내 문구가 남아 있다');
     // 표 말고 다른 자식이 남아 빈 여백을 만들지 않아야 한다.
     check(pop.children.length===1&&pop.firstElementChild.tagName==='TABLE',
       '패널에 표 말고 다른 요소가 있다: '+
       [...pop.children].map(e=>e.tagName).join(','));
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

  await test(
    "볼륨 아이콘은 실제 출력 크기에 따라 세 가지로 바뀐다",
    `document.getElementById('mvVolumeBtn').click();
     await wait(150);
     const pop=document.getElementById('mvVolumePop');
     check(!pop.hidden,'볼륨 팝오버가 열리지 않았다');
     // emoji 를 쓰지 않는다(SVG 로 통일).
     check(!/🔇|🔊/.test(pop.textContent),'emoji 가 남아 있다');
     check(pop.querySelector('.mv-vol-icon'),'볼륨 아이콘 SVG 가 없다');
     const kindOf=(btn)=>{
       const svg=btn.querySelector('.mv-vol-icon');
       const lines=svg.querySelectorAll('line').length;
       const paths=svg.querySelectorAll('path').length;
       if(lines===2)return 'x';        // volume-x 는 X 표시가 선 2개
       return paths>=3?'high':'low';   // volume-2 는 호가 2개
     };
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     // 앞 테스트가 메인과 소리 포커스를 바꿔 뒀을 수 있다. 현재 메인을 기준으로 맞춘다.
     {const focus=pop.querySelector('#mvVolFocus');
      if(!focus.checked){focus.checked=true;
        focus.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);}}
     {const m=pop.querySelector('[data-mv-vol-master]');
      m.value='100';m.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(100);
      document.getElementById('mvVolumeBtn').click();
      document.getElementById('mvVolumeBtn').click();
      await wait(150);}
     const pop0=document.getElementById('mvVolumePop');
     const mainBtn=pop0.querySelector('[data-mv-vol-mute="'+mainId+'"]');
     check(mainBtn,'메인 음소거 버튼이 없다');
     // 메인 100% → volume-2
     check(kindOf(mainBtn)==='high','메인이 volume-2 가 아니다: '+kindOf(mainBtn));
     // 음소거된 채널은 크기와 상관없이 volume-x 여야 한다. '메인만 듣기' 를 켜서
     // 보조를 확실히 음소거 상태로 만든 뒤 확인한다.
     {const f=document.getElementById('mvVolFocus');
      if(!f.checked){f.checked=true;f.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(150);}}
     const popA=document.getElementById('mvVolumePop');
     const auxBtn=[...popA.querySelectorAll('[data-mv-vol-mute]')]
       .find(b=>b.dataset.mvVolMute!==mainId);
     if(auxBtn)check(kindOf(auxBtn)==='x',
       '음소거된 보조가 volume-x 가 아니다: '+kindOf(auxBtn));
     // 전체 볼륨을 30% 로 내리면 메인은 volume-1 이 된다(실제 출력 기준).
     const master=document.getElementById('mvVolumePop')
       .querySelector('[data-mv-vol-master]');
     master.value='30';
     master.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(100);
     document.getElementById('mvVolumeBtn').click();
     document.getElementById('mvVolumeBtn').click();
     await wait(150);
     const pop2=document.getElementById('mvVolumePop');
     const mainBtn2=pop2.querySelector('[data-mv-vol-mute="'+mainId+'"]');
     check(kindOf(mainBtn2)==='low',
       '전체 30% 인데 volume-1 이 아니다: '+kindOf(mainBtn2));
     // 0% 면 volume-x.
     const master2=pop2.querySelector('[data-mv-vol-master]');
     master2.value='0';
     master2.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(100);
     document.getElementById('mvVolumeBtn').click();
     document.getElementById('mvVolumeBtn').click();
     await wait(150);
     const pop3=document.getElementById('mvVolumePop');
     check(kindOf(pop3.querySelector('[data-mv-vol-mute="'+mainId+'"]'))==='x',
       '전체 0% 인데 volume-x 가 아니다');
     // 되돌려 둔다(뒤 테스트에 영향 없게).
     const m3=pop3.querySelector('[data-mv-vol-master]');
     m3.value='100';
     m3.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(100);`,
  );

  await test(
    "긴 닉네임이어도 메인 배지는 잘리지 않는다",
    `const pop=document.getElementById('mvVolumePop');
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     // 아주 긴 이름으로 바꿔 다시 그린다.
     const long='A'.repeat(60);
     const row=pop.querySelector('[data-mv-vol-mute="'+mainId+'"]')
       .closest('.mv-vol-row');
     const text=row.querySelector('.mv-vol-name-text');
     check(text,'이름 텍스트 요소가 없다');
     text.textContent=long;
     await wait(50);
     const badge=row.querySelector('.mv-main-badge');
     check(badge,'메인 배지가 없다');
     // 배지가 실제로 보이고 폭이 남아 있어야 한다.
     const br=badge.getBoundingClientRect();
     check(br.width>0&&br.height>0,'메인 배지가 보이지 않는다');
     // 자르는 것은 이름 텍스트 쪽이어야 한다.
     const style=getComputedStyle(text);
     check(style.overflow==='hidden','이름 텍스트가 잘리도록 돼 있지 않다');
     const nameStyle=getComputedStyle(row.querySelector('.mv-vol-name'));
     check(nameStyle.overflow!=='hidden',
       '이름 묶음에 overflow:hidden 이 있어 배지까지 잘린다');
     // 배지가 행 밖으로 밀려나지 않아야 한다.
     const rr=row.getBoundingClientRect();
     check(br.right<=rr.right+1,
       '메인 배지가 행 밖으로 밀렸다: '+br.right+' > '+rr.right);`,
  );

  await test(
    "메인만 듣기를 꺼도 보조가 저절로 켜지지 않는다",
    `const pop=document.getElementById('mvVolumePop');
     check(pop.textContent.includes('메인만 듣기'),'문구가 바뀌지 않았다');
     check(!pop.textContent.includes('메인 채널만 소리'),'옛 문구가 남아 있다');
     check(pop.querySelector('.mv-vol-focus-note'),'설명 문구가 없다');
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     for(const f of document.querySelectorAll('.mv-cell iframe')){
       f.contentWindow.postMessage=(m)=>window.sentMsgs.push(m);
     }
     // ⚠ '껐을 때 모두 켜지지 않는다' 를 제대로 보려면 보조가 저마다 음소거 상태
     //    여야 한다. 앞 테스트가 만든 믹스를 지우고 다시 음소거로 맞춘다.
     //    켜져 있는 동안에는 보조 버튼이 잠겨 있으므로 먼저 끄고 정리한다.
     {const f=document.getElementById('mvVolFocus');
      if(f.checked){f.checked=false;
        f.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);}}
     const popF=document.getElementById('mvVolumePop');
     for(const btn of popF.querySelectorAll('[data-mv-vol-mute]')){
       if(btn.dataset.mvVolMute===mainId)continue;
       if(btn.getAttribute('aria-pressed')==='false'&&!btn.disabled)btn.click();
     }
     await wait(150);
     {const f=document.getElementById('mvVolFocus');
      f.checked=true;f.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(150);}
     window.sentMsgs=[];
     const focus2=document.getElementById('mvVolFocus');
     focus2.checked=false;
     focus2.dispatchEvent(new Event('change',{bubbles:true}));
     await wait(150);
     // 끈 직후 보조가 전부 소리를 내면 6채널이 한꺼번에 울린다. 그러면 안 된다.
     const aux=window.sentMsgs.filter(m=>m.type==='SET_MULTIVIEW_STATE'
       &&m.channelId!==mainId);
     check(aux.length>0,'보조에 지시가 나가지 않았다');
     check(aux.every(m=>m.muted===true),
       '메인만 듣기를 껐더니 보조가 저절로 켜졌다: '
       +JSON.stringify(aux.map(m=>m.muted)));
     // 다시 켜 둔다.
     {const f=document.getElementById('mvVolFocus');
      f.checked=true;f.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(100);}
     document.getElementById('mvVolumeBtn').click();
     await wait(100);`,
  );

  await test(
    "슬라이더를 끄는 동안 아이콘이 바로 따라오고 드래그가 끊기지 않는다",
    `const pop=document.getElementById('mvVolumePop');
     if(pop.hidden){document.getElementById('mvVolumeBtn').click();await wait(150);}
     const p=document.getElementById('mvVolumePop');
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const kindOf=(cid)=>{
       const svg=p.querySelector('[data-mv-vol-mute="'+cid+'"] .mv-vol-icon');
       if(!svg)return '?';
       if(svg.querySelectorAll('line').length===2)return 'x';
       return svg.querySelectorAll('path').length>=3?'high':'low';
     };
     // 메인만 듣기를 꺼서 채널 슬라이더를 쓸 수 있게 한다.
     {const f=document.getElementById('mvVolFocus');
      if(f.checked){f.checked=false;
        f.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);}}
     const p2=document.getElementById('mvVolumePop');
     const master=p2.querySelector('[data-mv-vol-master]');
     master.value='100';master.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(80);
     const range=p2.querySelector('[data-mv-vol-channel="'+mainId+'"]');
     check(range,'메인 채널 슬라이더가 없다');
     // 끄는 동안 같은 요소가 유지돼야 한다(교체되면 드래그가 끊긴다).
     const before=range;
     const steps=[['100','high'],['51','high'],['50','low'],['10','low'],
                  ['1','low'],['0','x']];
     for(const [v,want] of steps){
       range.value=v;
       range.dispatchEvent(new Event('input',{bubbles:true}));
       await wait(60);
       const got=kindOf(mainId);
       check(got===want,v+'% 에서 '+want+' 여야 하는데 '+got);
       // 퍼센트 글자도 즉시 따라와야 한다.
       const pctText=range.parentElement.querySelector('.mv-vol-pct').textContent;
       check(pctText===v+'%',v+'% 표시가 안 맞는다: '+pctText);
     }
     check(document.body.contains(before)&&before===
       document.getElementById('mvVolumePop')
         .querySelector('[data-mv-vol-channel="'+mainId+'"]'),
       '끄는 동안 슬라이더 요소가 교체됐다(드래그가 끊긴다)');
     range.value='100';range.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(80);`,
  );

  await test(
    "전체 볼륨을 내리면 실제 출력 기준으로 아이콘이 바뀐다",
    `const p=document.getElementById('mvVolumePop');
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const kindOf=(cid)=>{
       const svg=document.getElementById('mvVolumePop')
         .querySelector('[data-mv-vol-mute="'+cid+'"] .mv-vol-icon');
       if(!svg)return '?';
       if(svg.querySelectorAll('line').length===2)return 'x';
       return svg.querySelectorAll('path').length>=3?'high':'low';
     };
     const master=p.querySelector('[data-mv-vol-master]');
     // 채널은 100% 인 상태에서 전체만 움직인다.
     for(const [v,want] of [['100','high'],['50','low'],['1','low'],['0','x']]){
       master.value=v;
       master.dispatchEvent(new Event('input',{bubbles:true}));
       await wait(60);
       const got=kindOf(mainId);
       check(got===want,'전체 '+v+'% 에서 '+want+' 여야 하는데 '+got);
     }
     master.value='100';master.dispatchEvent(new Event('input',{bubbles:true}));
     await wait(80);
     // 다시 메인만 듣기를 켜 둔다.
     {const f=document.getElementById('mvVolFocus');
      if(!f.checked){f.checked=true;
        f.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);}}`,
  );

  await test(
    "화질 전환 중의 지연 0 은 '전환 중' 으로 보여 준다",
    `// ⚠ 앞 테스트들을 거치며 칸이 종료·오류 상태가 됐을 수 있다. 그러면 통계
     //   줄이 아예 안 그려져 검사가 헛돈다. 먼저 모두 준비 상태로 되돌린다.
     for(const cell of document.querySelectorAll('.mv-cell')){
       if(cell.dataset.status==='ready')continue;
       // 종료 칸에는 '다시 불러오기' 가 없다(끝난 방송이라 뜻이 없다). 그때는
       // 교체 대신 프레임 상태만 되돌려 통계 줄이 그려지게 한다.
       cell.querySelector('[data-mv-retry]')?.click();
       await wait(80);
       if(cell.dataset.status==='ended'){
         // 종료 → 로딩으로 되돌리는 공개 경로가 없으므로 교체로 새 칸을 만든다.
         cell.querySelector('[data-mv-replace]')?.click();
         await wait(400);
         const card=document.querySelector(
           '#mvQuickAdd [data-mv-quick-add]:not([disabled])');
         if(card){card.click();await wait(300);}
         document.getElementById('mvQuickClose')?.click();
         await wait(100);
         continue;
       }
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type:'FRAME_READY',
               channelId:cell.dataset.channelId}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
       await wait(80);
     }
     // 교체로 새로 생긴 칸에도 준비 신호를 보낸다.
     for(const cell of document.querySelectorAll('.mv-cell')){
       if(cell.dataset.status==='ready')continue;
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type:'FRAME_READY',
               channelId:cell.dataset.channelId}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
       await wait(80);
     }
     const notReady=[...document.querySelectorAll('.mv-cell')]
       .filter(c=>c.dataset.status!=='ready').length;
     check(notReady===0,'준비 상태로 되돌리지 못한 칸이 '+notReady+'개');
     // 통계 패널을 연다.
     if(document.getElementById('mvStatsPop').hidden){
       document.getElementById('mvStatsBtn').click();await wait(150);}
     const cells=[...document.querySelectorAll('.mv-cell')];
     const mainId=document.querySelector('.mv-cell.is-main').dataset.channelId;
     const other=cells.find(c=>c.dataset.channelId!==mainId);
     check(other,'보조 칸이 없다');
     const otherId=other.dataset.channelId;
     const send=(cid,lat)=>{
       const cell=cells.find(c=>c.dataset.channelId===cid);
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type:'MULTIVIEW_STATS',channelId:cid,
               stats:{latencySec:lat,width:1920,height:1080,fps:60,bitrateKbps:8000}}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     // 화질이 바뀌지 않은 칸은 0 이 와도 그대로 보여 준다(전역 무효 처리 금지).
     send(mainId,0);
     await wait(1200);
     let text=document.getElementById('mvStatsPop').textContent;
     check(text.includes('0.0초'),
       '전환 중이 아닌 칸의 0 을 숨겼다: '+text.slice(0,160));
     // 이제 메인을 바꾼다 → 두 칸의 화질이 실제로 전환된다.
     window.__setMainAt=Date.now();
     other.querySelector('[data-mv-promote]')?.click();
     await wait(200);
     check(document.querySelector('.mv-cell.is-main').dataset.channelId===otherId,
       '메인이 바뀌지 않았다');
     // 전환 직후 플레이어가 잠깐 0 을 돌려주는 상황.
     send(mainId,0);
     send(otherId,0);
     await wait(1200);
     text=document.getElementById('mvStatsPop').textContent;
     check(text.includes('전환 중'),'전환 중 표시가 없다: '+text.slice(0,200));
     check(!text.includes('0.0초'),'전환 중인데 0.0초를 보여 줬다');
     // 정상값이 오면 즉시 숫자로 돌아간다.
     send(mainId,4.1);
     send(otherId,2.3);
     await wait(1200);
     text=document.getElementById('mvStatsPop').textContent;
     check(text.includes('4.1초')&&text.includes('2.3초'),
       '정상값이 왔는데 숫자로 안 바뀐다: '+text.slice(0,200));
     check(!text.includes('전환 중'),'정상값이 왔는데 전환 중이 남아 있다');
     document.getElementById('mvStatsBtn').click();
     await wait(100);`,
  );

  await test(
    "고르기 화면 열기는 보던 방송을 내리지 않는다",
    `const videoSrcs=()=>window.frameSrcs.filter(s=>s.includes('cheeseMulti=1'));
     const before=videoSrcs().length;
     const cellsBefore=document.querySelectorAll('.mv-cell').length;
     if(document.getElementById('mvQuick').hidden){
       document.getElementById('mvBack').click();await wait(200);}
     // ① 열린 고르기 탭이 없으면 새 탭으로 연다.
     window.fakeTabs=[];window.openedTabs=[];window.tabUpdates=[];
     document.getElementById('mvQuickAll').click();
     await wait(600);
     check(window.openedTabs.length===1,
       '새 탭을 열지 않았다(열린 수 '+window.openedTabs.length+')');
     check(window.openedTabs[0].includes('multiview.html'),
       '연 주소가 고르기 화면이 아니다: '+window.openedTabs[0]);
     check(window.tabUpdates.length===0,'없는 탭을 갱신하려 했다');
     // ⚠ 핵심: 이 탭은 그대로 있어야 한다(칸이 내려가면 다시 불러와야 한다).
     // ⚠ 이 탭을 고르기 화면으로 바꿔 버리면 CDP 가 'target navigated' 로 끊겨
     //   스위트 자체가 실패한다(실측). 그래서 이동 여부는 그쪽이 잡아 주고,
     //   여기서는 프레임이 살아 있는지를 본다 — 채팅 칸까지 그대로여야 한다.
     const blanked=[...document.querySelectorAll('iframe')]
       .filter(f=>f.getAttribute('data-test-src')==='about:blank').length;
     check(blanked===0,'이 탭을 떠나며 프레임을 내렸다(내린 수 '+blanked+')');
     check(videoSrcs().length===before,'프레임이 다시 걸렸다');
     check(document.querySelectorAll('.mv-cell').length===cellsBefore,
       '칸 수가 바뀌었다');
     check([...document.querySelectorAll('.mv-cell iframe')]
       .every(f=>f.getAttribute('data-test-src')!=='about:blank'),
       '칸의 프레임을 내려 버렸다');`,
  );

  await test(
    "이미 열린 고르기 탭이 있으면 그 탭으로 보낸다",
    `window.openedTabs=[];window.tabUpdates=[];window.windowUpdates=[];
     // 이미 열려 있는 고르기 탭을 하나 둔다.
     window.fakeTabs=[{id:77,windowId:5,
       url:'chrome-extension://test/multiview.html?setup=old'}];
     document.getElementById('mvQuickAll').click();
     await wait(300);
     check(window.openedTabs.length===0,
       '이미 열려 있는데 새 탭을 또 열었다');
     check(window.tabUpdates.length===1,'그 탭으로 보내지 않았다');
     check(window.tabUpdates[0].id===77,'다른 탭을 건드렸다');
     check(window.tabUpdates[0].active===true,'그 탭을 앞으로 가져오지 않았다');
     check(window.tabUpdates[0].url.includes('multiview.html'),
       '보낸 주소가 고르기 화면이 아니다');
     // 그 탭이 다른 창에 있으면 창도 앞으로 가져온다.
     check(window.windowUpdates.some(w=>w.id===5&&w.focused===true),
       '그 탭이 있는 창을 앞으로 가져오지 않았다');
     // 찾을 때 우리 확장의 고르기 화면만 본다.
     check(window.tabQueries.some(u=>u.includes('multiview.html')),
       '고르기 화면 주소로 찾지 않았다');`,
  );

  await command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 720,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await test(
    "좁은 화면에서도 싱크 패널이 화면 안에 들어온다",
    `document.getElementById('mvSyncBtn').click();
     const panel=document.getElementById('mvSyncPop');
     const rect=panel.getBoundingClientRect();
     check(!panel.hidden,'싱크 패널이 열리지 않았다');
     check(rect.left>=0&&rect.right<=innerWidth+1,
       '싱크 패널이 좌우로 벗어났다: '+JSON.stringify(rect.toJSON()));
     check(rect.top>=0&&rect.bottom<=innerHeight+1,
       '싱크 패널이 위아래로 벗어났다: '+JSON.stringify(rect.toJSON()));
     document.body.click();`,
  );

  await test(
    "채널 교체와 제거는 보류 중인 싱크 명령을 버린다",
    `const post=(cell,type,extra={})=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type,
           channelId:cell.dataset.channelId,...extra}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     const raw=(delay,generation)=>({currentTime:100,playbackRate:1,paused:false,
       readyState:4,syncRateOwned:false,userRateOverride:false,
       nativeDelaySec:delay,bufferAheadSec:2,edgeLagSec:0,
       seekableStart:80,seekableEnd:100+delay,generation});
     const [other,target]=[...document.querySelectorAll('.mv-cell')];
     post(other,'FRAME_READY');post(target,'FRAME_READY');
     post(other,'FRAME_SYNC_STATS',{stats:raw(5,10)});
     post(target,'FRAME_SYNC_STATS',{stats:raw(3,10)});
     document.getElementById('mvSyncBtn').click();
     let panel=document.getElementById('mvSyncPop');
     panel.querySelector('[data-mv-sync-ref="'+other.dataset.channelId+'"]').click();
     panel.querySelector('[data-mv-sync-offset="'+target.dataset.channelId+'"][data-step="0.5"]').click();
     const pending=[...window.sentMessages].reverse().find(m=>
       m.data?.type==='APPLY_SYNC_NUDGE'&&m.data.channelId===target.dataset.channelId);
     check(pending,'교체 전 보류 명령이 없다');
     document.getElementById('mvBack').click();
     await wait(500);
     const quick=document.getElementById('mvQuick');
     quick.querySelector('[data-mv-quick-replace="'+target.dataset.channelId+'"]').click();
     const replacement=quick.querySelector('[data-mv-quick-add]:not([disabled])');
     check(replacement,'교체 후보가 없다');
     replacement.click();
     post(target,'FRAME_SYNC_COMMAND_RESULT',{commandId:pending.data.commandId,
       command:'nudge',applied:true,reason:null,actualCurrentTime:99.5,
       actualPlaybackRate:1,generation:10});
     check(!document.querySelector('.mv-cell[data-channel-id="'+target.dataset.channelId+'"]'),
       '교체 전 채널이 남았다');
     const extra=quick.querySelector('[data-mv-quick-add]:not([disabled])');
     check(extra,'추가 후보가 없다');
     extra.click();
     await wait(100);
     const third=document.querySelector('.mv-cell[data-channel-id="'+extra.dataset.mvQuickAdd+'"]');
     check(third&&document.querySelectorAll('.mv-cell').length===3,'세 번째 채널이 추가되지 않았다');
     post(third,'FRAME_READY');
     post(other,'FRAME_SYNC_STATS',{stats:raw(5,10)});
     post(third,'FRAME_SYNC_STATS',{stats:raw(3,1)});
     if(!quick.hidden)document.body.click();
     document.getElementById('mvSyncBtn').click();
     panel=document.getElementById('mvSyncPop');
     panel.querySelector('[data-mv-sync-offset="'+third.dataset.channelId+'"][data-step="0.5"]').click();
     const dropPending=[...window.sentMessages].reverse().find(m=>
       m.data?.type==='APPLY_SYNC_NUDGE'&&m.data.channelId===third.dataset.channelId);
     check(dropPending,'제거 전 보류 명령이 없다');
     document.getElementById('mvBack').click();
     quick.querySelector('[data-mv-quick-drop="'+third.dataset.channelId+'"]').click();
     post(third,'FRAME_SYNC_COMMAND_RESULT',{commandId:dropPending.data.commandId,
       command:'nudge',applied:true,reason:null,actualCurrentTime:99.5,
       actualPlaybackRate:1,generation:1});
     check(!document.querySelector('.mv-cell[data-channel-id="'+third.dataset.channelId+'"]')&&
       document.querySelectorAll('.mv-cell').length===2,
       '제거된 채널의 보류 명령이 정리되지 않았다');
     document.body.click();`,
  );

  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await test(
    "싱크 진단은 세션 메모리에서 기록·요약·내보내기·초기화된다",
    `const realNow=Date.now;
     let clock=realNow()+180000;
     Date.now=()=>clock;
     const post=(cell,type,extra={})=>{
       const e=new MessageEvent('message',{origin:'https://chzzk.naver.com',
         data:{source:'cheese-platter-multiview',type,
           channelId:cell.dataset.channelId,...extra}});
       Object.defineProperty(e,'source',{value:cell.querySelector('iframe').contentWindow});
       window.dispatchEvent(e);
     };
     const raw=(delay,generation,edge=0,rate=1,owned=false,user=false)=>({
       currentTime:100,playbackRate:rate,paused:false,readyState:4,
       syncRateOwned:owned,userRateOverride:user,nativeDelaySec:delay,
       bufferAheadSec:2,edgeLagSec:edge,seekableStart:80,
       seekableEnd:100+delay,generation});
     const samples=(cells,generation,edge=0)=>cells.forEach((cell,index)=>
       post(cell,'FRAME_SYNC_STATS',{stats:raw(5-index,generation,edge)}));
     let cells=[...document.querySelectorAll('.mv-cell')];
     cells.forEach(cell=>post(cell,'FRAME_READY'));
     document.getElementById('mvSyncBtn').click();
     let panel=document.getElementById('mvSyncPop');
     check(!panel.querySelector('#mvSyncDiagnostics').checked,
       '진단이 기본으로 켜져 있다');
     samples(cells,50);
     check(panel.querySelector('#mvSyncDiagnosticsCopy').disabled,
       '진단 OFF인데 stats가 기록됐다');

     panel.querySelector('#mvSyncDiagnostics').click();
     window.sentMessages.length=0;
     document.getElementById('mvSyncBtn').click();
     await wait(1100);
     check(window.sentMessages.some(message=>message.data?.type==='REQUEST_FRAME_SYNC_STATS'),
       '진단 중 패널을 닫으면 통계 폴링이 멈춘다');
     document.getElementById('mvSyncBtn').click();
     panel=document.getElementById('mvSyncPop');

     // congestion 검증을 위해 세 번째 채널을 추가한다.
     document.getElementById('mvBack').click();
     await wait(400);
     const quick=document.getElementById('mvQuick');
     const add=quick.querySelector('[data-mv-quick-add]:not([disabled])');
     check(add,'진단용 세 번째 채널 후보가 없다');
     const addedId=add.dataset.mvQuickAdd;
     add.click();
     await wait(100);
     const added=document.querySelector('.mv-cell[data-channel-id="'+addedId+'"]');
     check(added,'진단용 세 번째 채널이 추가되지 않았다');
     post(added,'FRAME_READY');
     if(!quick.hidden)document.body.click();
     document.getElementById('mvSyncBtn').click();
     cells=[...document.querySelectorAll('.mv-cell')];
     samples(cells,51);
     clock+=4100;
     samples(cells,51);
     await wait(1100);
     panel=document.getElementById('mvSyncPop');
     check(panel.querySelector('.mv-sync-diagnostics-status').textContent.includes('기록 중'),
       '진단 기록 상태가 표시되지 않는다');
     check(!panel.querySelector('#mvSyncDiagnosticsCopy').disabled,
       '기록이 있는데 진단 동작이 비활성화됐다');

     // 수동 기준 변경으로 command/result를 만들고 다음 명령은 timeout시킨다.
     window.sentMessages.length=0;
     const reference=panel.querySelector('[data-mv-sync-ref]:not([disabled])');
     check(reference,'바꿀 수 있는 싱크 기준이 없다');
     reference.click();
     let commands=window.sentMessages.filter(message=>
       message.data?.type==='APPLY_SYNC_SEEK');
     check(commands.length>0,'ACK할 seek 명령이 없다');
     for(const command of commands){
       const cell=cells.find(item=>item.dataset.channelId===command.data.channelId);
       post(cell,'FRAME_SYNC_COMMAND_RESULT',{commandId:command.data.commandId,
         command:'seek',applied:true,reason:null,generation:51,
         actualCurrentTime:100,actualPlaybackRate:1});
     }
     clock+=300;
     window.sentMessages.length=0;
     panel=document.getElementById('mvSyncPop');
     const timeoutReference=panel.querySelector('[data-mv-sync-ref]:not([disabled])');
     check(timeoutReference,'timeout 명령을 만들 다음 기준이 없다');
     timeoutReference.click();
     check(window.sentMessages.some(message=>message.data?.type==='APPLY_SYNC_SEEK'),
       'timeout시킬 seek 명령이 없다');
     await wait(2200);

     // 세 채널의 edge lag가 임계값을 넘는 상태를 유지했다가 해제한다.
     clock+=1000;samples(cells,51,3);await wait(1100);
     clock+=4100;samples(cells,51,3);await wait(1100);
     clock+=1000;samples(cells,51,3);await wait(1100);
     samples(cells,51,0);await wait(1100);
     clock+=5100;samples(cells,51,0);await wait(1100);

     // 탭 복귀와 새 generation의 settling 기록을 만든다.
     const hiddenDescriptor=Object.getOwnPropertyDescriptor(document,'hidden');
     let hidden=true;
     Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
     document.dispatchEvent(new Event('visibilitychange'));
     hidden=false;clock+=100;
     document.dispatchEvent(new Event('visibilitychange'));
     samples(cells,52);
     if(hiddenDescriptor)Object.defineProperty(document,'hidden',hiddenDescriptor);
     else delete document.hidden;
     await wait(100);

     // 저장된 Blob을 읽어 schema와 이벤트를 확인한다.
     const realCreate=URL.createObjectURL;
     const realRevoke=URL.revokeObjectURL;
     const realAnchorClick=HTMLAnchorElement.prototype.click;
     window.__diagBlobs=[];window.__diagDownload='';
     URL.createObjectURL=(blob)=>{window.__diagBlobs.push(blob);return 'blob:diagnostics';};
     URL.revokeObjectURL=()=>{};
     HTMLAnchorElement.prototype.click=function(){window.__diagDownload=this.download;};
     panel=document.getElementById('mvSyncPop');
     panel.querySelector('#mvSyncDiagnosticsExport').click();
     await wait(50);
     const payload=JSON.parse(await window.__diagBlobs.at(-1).text());
     const types=payload.records.map(record=>record.type);
     for(const type of ['sample','command','command-result','command-timeout',
       'reference-change','congestion-change','generation-change','settling-start','visibility']){
       check(types.includes(type),'진단 이벤트가 없다: '+type);
     }
     check(payload.schemaVersion===1,'진단 schemaVersion이 없다');
     check(payload.config.sampleMs===1000&&payload.config.settlingMs===4000&&
       payload.config.seekCooldownMs===30000,'현재 싱크 임계값이 export되지 않았다');
     check(payload.records.every(record=>!('cookie' in record)&&!('chat' in record)&&
       !('url' in record)),'민감하거나 불필요한 필드가 기록됐다');
     check(payload.records.some(record=>record.type==='command-result'&&
       Number.isFinite(record.roundTripMs)),'ACK RTT가 기록되지 않았다');
     check(payload.records.filter(record=>record.type==='congestion-change'&&record.active).length===1,
       'congestion 진입 이벤트가 중복됐다');
     check(payload.records.filter(record=>record.type==='congestion-change'&&!record.active).length===1,
       'congestion 해제 이벤트가 중복되거나 없다');
     check(payload.summary.channels.some(channel=>
       Number.isFinite(channel.absoluteSyncErrorSec?.p90)),
       '싱크 오차 p90 요약이 없다');
     check(/^chzzk-multiview-sync-diagnostics-[0-9]{8}-[0-9]{6}[.]json$/.test(window.__diagDownload),
       '진단 파일명이 올바르지 않다: '+window.__diagDownload);

     const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
     window.__diagCopied='';
     Object.defineProperty(navigator,'clipboard',{configurable:true,
       value:{writeText:async text=>{window.__diagCopied=text;}}});
     panel=document.getElementById('mvSyncPop');
     panel.querySelector('#mvSyncDiagnosticsCopy').click();
     await wait(50);
     check(window.__diagCopied.includes('멀티뷰 싱크 진단')&&
       window.__diagCopied.includes('|오차| 중앙/p90/p95/최대'),
       '진단 요약을 복사하지 못했다');

     // OFF 뒤에는 샘플을 보내도 기록 수가 늘지 않는다.
     panel=document.getElementById('mvSyncPop');
     const diagnosticsToggle=panel.querySelector('#mvSyncDiagnostics');
     diagnosticsToggle.click();
     await wait(20);
     panel=document.getElementById('mvSyncPop');
     const offChecked=panel.querySelector('#mvSyncDiagnostics').checked;
     const offStatus=panel.querySelector('.mv-sync-diagnostics-status').textContent;
     check(!offChecked&&offStatus.includes('기록 안 함'),
       '진단 OFF 전환이 반영되지 않았다 (checked: '+offChecked+
       ', 상태: '+offStatus+')');
     const beforeOff=payload.records.length;
     samples(cells,52);
     window.__diagBlobs=[];
     panel=document.getElementById('mvSyncPop');
     panel.querySelector('#mvSyncDiagnosticsExport').click();
     await wait(50);
     const afterOff=JSON.parse(await window.__diagBlobs.at(-1).text());
     check(afterOff.records.length===beforeOff,
       '진단 OFF 뒤에도 record가 추가됐다');

     const syncModeBefore=document.getElementById('mvSyncValue').textContent;
     const offsetsBefore=[...panel.querySelectorAll('.mv-sync-controls output')]
       .map(output=>output.textContent).join('|');
     const clearButton=panel.querySelector('#mvSyncDiagnosticsClear');
     check(clearButton&&!clearButton.disabled,'초기화 버튼을 누를 수 없다');
     clearButton.click();
     await wait(50);
     panel=document.getElementById('mvSyncPop');
     const copyDisabled=panel.querySelector('#mvSyncDiagnosticsCopy').disabled;
     const clearedStatus=panel.querySelector('.mv-sync-diagnostics-status').textContent;
     check(copyDisabled&&clearedStatus.includes('기록 안 함'),
       '진단 초기화가 records를 비우지 않았다 (복사 비활성화: '+copyDisabled+
       ', 상태: '+clearedStatus+')');
     check(document.getElementById('mvSyncValue').textContent===syncModeBefore&&
       [...panel.querySelectorAll('.mv-sync-controls output')]
         .map(output=>output.textContent).join('|')===offsetsBefore,
       '진단 초기화가 실제 싱크 상태를 바꿨다');

     URL.createObjectURL=realCreate;URL.revokeObjectURL=realRevoke;
     HTMLAnchorElement.prototype.click=realAnchorClick;
     if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);
     else delete navigator.clipboard;
     document.body.click();Date.now=realNow;`,
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
