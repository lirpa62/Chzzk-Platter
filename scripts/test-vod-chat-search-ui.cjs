// 다시보기 채팅 검색 UI(구간 요약 팝오버 안의 검색 화면).
//
// 검색 엔진은 test-vod-chat-search.cjs 가 맡는다. 여기서는 화면과 수명주기만 본다.
//  - 머리말의 돋보기 → 검색 화면, 뒤로 → 활성도 화면
//  - 준비 전에는 입력칸을 잠그고 진행률을 보여 준다
//  - 결과 200건 제한과 '처음 200개 표시' 문구
//  - 강조는 mark 요소로 만들고 원문을 HTML 로 합치지 않는다
//  - 머리말 아이콘이 찌그러지지 않는다(방장·매니저 아이콘 회귀 재발 방지)
//
// ⚠ 화면 함수는 content.js 에서 그대로 떼어내 쓴다(문구를 여기 베껴 두면 원본과
//   어긋난다). 아래 sliceFn 이 원본에서 함수 본문을 잘라 온다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");
const CSS = readFileSync(join(__dirname, "..", "src", "content.css"), "utf8");

// content.js 에서 `function 이름(` 부터 같은 들여쓰기의 닫는 중괄호까지 잘라 온다.
function sliceFn(name) {
  let at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) at = SRC.indexOf(`  async function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < 0) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

// 검색 입력칸 포커스 리스너를 원본에서 통째로 떼어 온다.
// ⚠ 등록 방식(어디에, 캡처인지 버블인지)까지 그대로 실려야 의미가 있다.
function focusListenerSource() {
  // 헬퍼부터 click 리스너 끝까지 한 덩어리로 가져온다.
  // ⚠ pointerdown 하나만 가져오면, click 에서 포커스를 되돌리는 처리가 빠진 채
  //   통과한다. 실제 증상은 click 에서 포커스를 빼앗기는 것이었다.
  // ⚠ 헬퍼를 빠뜨리면 리스너 안에서 ReferenceError 가 나고, 복구가 조용히
  //   동작하지 않은 채 '실패' 로만 보인다(실제로 그렇게 헤맸다).
  const at = SRC.indexOf("  // 사용자가 스스로 옮겨 간 '글을 쓰는 곳' 인지.");
  if (at < 0) throw Error("isTextEntryElement 를 찾지 못했다");
  if (SRC.indexOf("  function watchVodSearchFocus(input) {", at) < 0) {
    throw Error("watchVodSearchFocus 를 찾지 못했다");
  }
  if (SRC.indexOf("  function focusVodSearchInput(event) {", at) < 0) {
    throw Error("focusVodSearchInput 을 찾지 못했다");
  }
  const clickAt = SRC.indexOf('  document.addEventListener(\n    "click",', at);
  if (clickAt < 0) throw Error("입력칸 click 리스너를 찾지 못했다");
  const end = SRC.indexOf("\n  );\n", clickAt);
  if (end < 0) throw Error("click 리스너 끝을 찾지 못했다");
  const src = SRC.slice(at, end + 5);
  if (!/cheese-vod-search-input/.test(src)) {
    throw Error("찾은 리스너가 검색 입력칸용이 아니다");
  }
  if (!/"pointerdown"/.test(src) || !/"click"/.test(src)) {
    throw Error("pointerdown·click 리스너가 모두 있어야 한다");
  }
  return src;
}

const dir = mkdtempSync(join(tmpdir(), "cheese-vsui-"));
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
    { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  // 실제 CSS 와 실제 화면 함수를 올린다.
  await ev(`(()=>{
    const st=document.createElement('style');
    st.textContent=${JSON.stringify(CSS)};
    document.head.appendChild(st);
    return true;})()`);

  await ev(`(()=>{
    window.VOD_CHAT_SEARCH_MAX_MESSAGES = 300000;
    window.VOD_CHAT_SEARCH_LIMIT = 200;
    window.vodChatSearchState = {
      videoNo:"1", messages:null, collecting:false, loading:false,
      progress:0, failed:false, truncated:"",
    };
    window.vodChatSearchView = {
      open:false, query:"", lastQuery:null, result:null, timer:0, token:0,
    };
    ${sliceFn("formatSeconds")}
    ${sliceFn("searchVodChatMessages")}
    ${sliceFn("appendVodSearchHighlighted")}
    ${sliceFn("vodChatSearchTruncatedNotice")}
    ${sliceFn("renderVodChatSearchBody")}
    ${sliceFn("renderVodChatSearchOutput")}
    ${sliceFn("renderChatPeakPanelHead")}
    window.formatSeconds = formatSeconds;
    window.searchVodChatMessages = searchVodChatMessages;
    window.appendVodSearchHighlighted = appendVodSearchHighlighted;
    window.renderVodChatSearchBody = renderVodChatSearchBody;
    window.renderChatPeakPanelHead = renderChatPeakPanelHead;
    // ⚠ 포커스 리스너는 손으로 흉내내지 않고 원본을 그대로 올린다. 예전 테스트가
    //   손으로 옮겨 적는 바람에, 원본이 캡처 단계를 못 막는 자리에 붙어 있어도
    //   통과해 버렸다.
    ${focusListenerSource()}
    // 팝오버 껍데기(실제 클래스 그대로).
    document.body.innerHTML =
      '<div class="cheese-search-comment-panel cheese-chat-peak-popover" style="width:320px">'+
      '<div class="cheese-search-comment-panel-head"></div>'+
      '<div class="cheese-peak-body"></div></div>';
    window.panel = document.querySelector('.cheese-chat-peak-popover');
    return true;})()`);

  console.log("[A] 머리말에 검색 버튼이 있다");
  {
    const r = await ev(`(()=>{
      vodChatSearchView.open=false;
      renderChatPeakPanelHead(panel);
      const btn=panel.querySelector('[data-peak-search]');
      return {has:!!btn, label:btn?.getAttribute('aria-label'),
        title:btn?.getAttribute('title'),
        icon:!!btn?.querySelector('svg.lucide-search'),
        rescan:!!panel.querySelector('[data-peak-rescan]'),
        heading:panel.querySelector('strong').textContent};})()`);
    ok(r.has, "돋보기 버튼이 있다");
    ok(r.label === "다시보기 채팅 검색", `aria-label (${r.label})`);
    ok(r.title === "다시보기 채팅 검색", `title (${r.title})`);
    ok(r.icon, "lucide search 아이콘을 쓴다");
    ok(r.rescan, "기존 '다시 수집' 버튼이 그대로 있다");
    ok(r.heading === "구간 요약", "기본 화면은 활성도(구간 요약)다");
  }

  console.log("\n[20] 머리말 아이콘이 찌그러지지 않는다");
  {
    // ⚠ 방장·매니저 아이콘이 8x16·2.4x16 까지 줄었던 회귀를 다시 만들지 않는다.
    //
    // 실측으로 나눈 두 경우:
    //  - 패널만 좁아지는 것으로는 안 줄어든다. 밀리는 쪽은 flex:1 인 제목이고
    //    actions 는 flex:none 이라, 폭 70px 까지 내려도 16/16/18 을 지켰다.
    //  - 진짜 원인은 '폭 28px 로 고정된 버튼 안에 글자가 함께 드는' 경우다.
    //    이때 SVG 의 기본 flex-shrink 가 1 이라 아이콘부터 0 까지 찌그러진다
    //    (fix 를 빼고 재면 16 → 0).
    const r = await ev(`(()=>{
      vodChatSearchView.open=false;
      renderChatPeakPanelHead(panel);
      const head=panel.querySelector('.cheese-search-comment-panel-head');
      const meas=()=>[...head.querySelectorAll('button')].map(btn=>{
        const svg=btn.querySelector('svg').getBoundingClientRect();
        return Math.round(svg.width*10)/10;});
      const wide=meas();
      panel.style.width='150px';
      const narrow=meas();
      // 방장·매니저에서 실제로 터졌던 모양: 폭이 28px 로 고정된 버튼 안에
      // 진행률 글자가 함께 든다. ⚠ 여기서 width 를 auto 로 풀면 안 된다 —
      // 그 경우는 원래 안 줄어들어서 검사가 헛돈다(실측으로 확인했다).
      head.querySelectorAll('button').forEach((btn)=>{
        btn.appendChild(document.createTextNode('100%'));});
      const withText=meas();
      panel.style.width='320px';
      return {wide,narrow,withText};})()`);
    ok(r.wide.length === 3, `버튼 3개(다시 수집·검색·닫기) (${r.wide.length})`);
    ok(
      r.narrow.every((w) => w >= 15),
      `좁은 폭(150px)에서도 아이콘 유지 (${r.narrow.join("/")})`,
    );
    // ⚠ 여기가 핵심이다. 글자가 같이 들어가면 flex:0 0 auto 없이는 찌그러진다.
    ok(
      r.withText.every((w) => w >= 15),
      `버튼 안에 글자가 붙어도 아이콘 유지 (${r.withText.join("/")})`,
    );
  }

  console.log("\n[B/R] 검색 화면 ↔ 활성도 화면 전환");
  {
    const r = await ev(`(()=>{
      vodChatSearchView.open=true;
      renderChatPeakPanelHead(panel);
      const searching={heading:panel.querySelector('strong').textContent,
        back:!!panel.querySelector('[data-peak-search-back]'),
        rescan:!!panel.querySelector('[data-peak-rescan]'),
        close:!!panel.querySelector('[data-peak-close]')};
      vodChatSearchView.open=false;
      renderChatPeakPanelHead(panel);
      const backHome={heading:panel.querySelector('strong').textContent,
        back:!!panel.querySelector('[data-peak-search-back]'),
        rescan:!!panel.querySelector('[data-peak-rescan]')};
      return {searching,backHome};})()`);
    ok(r.searching.heading === "다시보기 채팅 검색", "검색 화면 제목");
    ok(r.searching.back, "뒤로 버튼이 생긴다");
    ok(!r.searching.rescan, "검색 화면에서는 '다시 수집' 을 감춘다");
    ok(r.searching.close, "닫기는 계속 있다");
    ok(r.backHome.heading === "구간 요약", "뒤로 → 활성도 제목 복귀");
    ok(!r.backHome.back, "뒤로 → 뒤로 버튼이 사라진다");
    ok(r.backHome.rescan, "뒤로 → '다시 수집' 이 돌아온다");
  }

  console.log("\n[C] 아직 안 모았으면 입력칸이 잠기고 진행률이 보인다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=null;
      vodChatSearchState.loading=true;
      vodChatSearchState.progress=0.43;
      vodChatSearchState.failed=false;
      renderVodChatSearchBody(panel);
      const input=panel.querySelector('.cheese-vod-search-input');
      return {disabled:input.disabled,
        status:panel.querySelector('.cheese-vod-search-status').textContent};})()`);
    ok(r.disabled, "준비 전에는 입력칸이 잠긴다");
    ok(r.status.includes("43%"), `진행률을 보여 준다 (${r.status})`);
    ok(r.status.includes("준비하는 중"), "준비 중임을 알린다");
  }

  console.log("\n[4/5] 기존 순회를 기다리는 동안의 안내");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=null;
      vodChatSearchState.loading=false;
      vodChatSearchState.failed=false;
      renderVodChatSearchBody(panel);
      return panel.querySelector('.cheese-vod-search-status').textContent;})()`);
    ok(r.includes("확인하는 중"), `기다리는 중임을 알린다 (${r})`);
    ok(!r.includes("실패") && !r.includes("못"), "실패처럼 보이지 않는다");
  }

  console.log("\n[D] 다 모으면 입력칸이 열린다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[{t:1000,text:'둥그레 왔다'}];
      vodChatSearchState.loading=false;
      vodChatSearchState.progress=1;
      vodChatSearchView.query='';
      vodChatSearchView.result=null;
      renderVodChatSearchBody(panel);
      const input=panel.querySelector('.cheese-vod-search-input');
      return {disabled:input.disabled, type:input.type,
        ph:input.placeholder, auto:input.getAttribute('autocomplete'),
        status:panel.querySelector('.cheese-vod-search-status').textContent};})()`);
    ok(!r.disabled, "준비가 끝나면 입력할 수 있다");
    ok(r.type === "search", `type=search (${r.type})`);
    ok(r.ph === "다시보기 채팅 검색", `placeholder (${r.ph})`);
    ok(r.auto === "off", "자동완성을 끈다");
    ok(r.status.includes("검색어를 입력"), "빈 검색어 안내");
  }

  console.log("\n[L] 결과가 없으면 검색어와 함께 알린다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[{t:1000,text:'안녕'}];
      vodChatSearchView.query='둥그레';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'둥그레',200);
      renderVodChatSearchBody(panel);
      return {status:panel.querySelector('.cheese-vod-search-status').textContent,
        rows:panel.querySelectorAll('.cheese-vod-search-list li').length};})()`);
    ok(r.status.includes("둥그레"), `검색어를 알린다 (${r.status})`);
    ok(r.status.includes("일치하는 채팅이 없습니다"), "없다고 알린다");
    ok(r.rows === 0, "결과 줄이 없다");
  }

  console.log("\n[G/H/O] 결과 줄과 강조");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[
        {t:5523000,text:'오늘 둥그레 왔네'},
        {t:6000000,text:'Hello DungGre world'},
      ];
      vodChatSearchView.query='둥그레';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'둥그레',200);
      renderVodChatSearchBody(panel);
      const li=panel.querySelector('.cheese-vod-search-list li');
      const btn=li.querySelector('button');
      const marks=[...btn.querySelectorAll('mark')].map(m=>m.textContent);
      return {time:btn.querySelector('time').textContent,
        seek:btn.dataset.vodSearchSeek, tag:btn.tagName,
        text:btn.querySelector('.cheese-vod-search-text').textContent,
        marks, title:btn.querySelector('.cheese-vod-search-text').title};})()`);
    ok(r.time === "1:32:03", `시각을 기존 형식으로 (${r.time})`);
    ok(r.seek === "5523", `초 단위 이동값 (${r.seek})`);
    ok(r.tag === "BUTTON", "줄이 실제 button 이라 키보드로 쓸 수 있다");
    ok(r.text === "오늘 둥그레 왔네", `본문 그대로 (${r.text})`);
    ok(r.marks.length === 1 && r.marks[0] === "둥그레", "검색어만 강조한다");
    ok(r.title === "오늘 둥그레 왔네", "전체 내용을 title 로 보여 준다");
  }

  console.log("\n[H] 영문 대소문자를 가리지 않고 원문 그대로 강조한다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[{t:0,text:'Hello DUNGGRE and dunggre'}];
      vodChatSearchView.query='dunggre';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'dunggre',200);
      renderVodChatSearchBody(panel);
      const t=panel.querySelector('.cheese-vod-search-text');
      return {marks:[...t.querySelectorAll('mark')].map(m=>m.textContent),
        text:t.textContent};})()`);
    ok(r.marks.length === 2, `두 군데 모두 강조 (${r.marks.length})`);
    ok(r.marks[0] === "DUNGGRE", `원문 대문자를 유지 (${r.marks[0]})`);
    ok(r.marks[1] === "dunggre", `원문 소문자를 유지 (${r.marks[1]})`);
    ok(r.text === "Hello DUNGGRE and dunggre", "본문이 손상되지 않는다");
  }

  console.log("\n[N] 악의적인 HTML 이 살아나지 않는다");
  {
    const r = await ev(`(()=>{
      window.__xss=0;
      const raw='<img src=x onerror="window.__xss=1"><script>window.__xss=2<\\/script> 둥그레';
      vodChatSearchState.messages=[{t:0,text:raw}];
      vodChatSearchView.query='둥그레';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'둥그레',200);
      renderVodChatSearchBody(panel);
      const t=panel.querySelector('.cheese-vod-search-text');
      return {xss:window.__xss, img:t.querySelectorAll('img').length,
        script:t.querySelectorAll('script').length,
        text:t.textContent, marks:t.querySelectorAll('mark').length};})()`);
    ok(r.xss === 0, "스크립트가 실행되지 않았다");
    ok(r.img === 0 && r.script === 0, "태그가 요소로 만들어지지 않았다");
    ok(r.text.includes("<img"), "글자 그대로 보여 준다");
    ok(r.marks === 1, "그래도 검색어 강조는 된다");
  }

  console.log("\n[N-2] 검색어에 든 HTML 도 글자로만 들어간다");
  {
    const r = await ev(`(()=>{
      window.__xss2=0;
      vodChatSearchState.messages=[{t:0,text:'평범한 채팅'}];
      vodChatSearchView.query='<img src=x onerror="window.__xss2=1">';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,vodChatSearchView.query,200);
      renderVodChatSearchBody(panel);
      const s=panel.querySelector('.cheese-vod-search-status');
      return {xss:window.__xss2, img:s.querySelectorAll('img').length,
        text:s.textContent};})()`);
    ok(r.xss === 0, "스크립트가 실행되지 않았다");
    ok(r.img === 0, "검색어의 태그가 요소가 되지 않는다");
    ok(r.text.includes("<img"), "검색어를 글자로 되돌려 준다");
  }

  console.log("\n[M] 200건 초과");
  {
    const r = await ev(`(()=>{
      const list=[];
      for(let i=0;i<201;i+=1) list.push({t:i*1000,text:'둥그레 '+i});
      vodChatSearchState.messages=list;
      vodChatSearchView.query='둥그레';
      vodChatSearchView.result=searchVodChatMessages(list,'둥그레',200);
      renderVodChatSearchBody(panel);
      return {total:vodChatSearchView.result.total,
        rows:panel.querySelectorAll('.cheese-vod-search-list li').length,
        status:panel.querySelector('.cheese-vod-search-status').textContent};})()`);
    ok(r.total === 201, `전체 개수는 201 (${r.total})`);
    ok(r.rows === 200, `화면에는 200줄만 (${r.rows})`);
    ok(r.status.includes("201"), "전체 개수를 알린다");
    ok(r.status.includes("처음 200개 표시"), `제한을 알린다 (${r.status})`);
  }

  console.log("\n[결과 개수] 200건 이하면 제한 문구를 붙이지 않는다");
  {
    const r = await ev(`(()=>{
      const list=[];
      for(let i=0;i<38;i+=1) list.push({t:i*1000,text:'둥그레'});
      vodChatSearchState.messages=list;
      vodChatSearchView.query='둥그레';
      vodChatSearchView.result=searchVodChatMessages(list,'둥그레',200);
      renderVodChatSearchBody(panel);
      return panel.querySelector('.cheese-vod-search-status').textContent;})()`);
    ok(r.trim() === "검색 결과 38개", `'검색 결과 38개' (${r.trim()})`);
  }

  console.log("\n[T] 상한에 걸리면 조용히 넘어가지 않는다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[{t:0,text:'둥그레'}];
      vodChatSearchState.truncated='message';
      vodChatSearchView.query='둥그레';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'둥그레',200);
      renderVodChatSearchBody(panel);
      const msg=panel.querySelector('.cheese-vod-search-notice')?.textContent||'';
      vodChatSearchState.truncated='page';
      renderVodChatSearchBody(panel);
      const page=panel.querySelector('.cheese-vod-search-notice')?.textContent||'';
      vodChatSearchState.truncated='';
      renderVodChatSearchBody(panel);
      const none=panel.querySelector('.cheese-vod-search-notice');
      return {msg,page,none:!!none};})()`);
    ok(r.msg.includes("300,000"), `메시지 상한을 알린다 (${r.msg})`);
    ok(r.msg.includes("까지만 검색"), "전체가 아님을 분명히 한다");
    ok(r.page.includes("까지만 검색"), `페이지 상한도 알린다 (${r.page})`);
    ok(
      !/index|page|cap|truncat/i.test(r.msg + r.page),
      "개발자 용어를 쓰지 않는다",
    );
    ok(!r.none, "상한에 안 걸리면 안내를 띄우지 않는다");
  }

  console.log("\n[16] 실패하면 다시 시도 버튼을 준다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=null;
      vodChatSearchState.failed=true;
      vodChatSearchState.loading=false;
      renderVodChatSearchBody(panel);
      const retry=panel.querySelector('[data-vod-search-retry]');
      return {status:panel.querySelector('.cheese-vod-search-status').textContent,
        retry:!!retry, label:retry?.textContent,
        input:panel.querySelector('.cheese-vod-search-input').disabled};})()`);
    ok(r.status.includes("불러오지 못했습니다"), `실패를 알린다 (${r.status})`);
    ok(r.retry, "다시 시도 버튼이 있다");
    ok(r.label === "다시 시도", `버튼 문구 (${r.label})`);
    ok(r.input, "실패 상태에서는 입력칸이 잠긴다");
  }

  console.log("\n[17] 덜 모은 것으로는 검색시키지 않는다");
  {
    // messages 가 배열이 아니면 어떤 경우에도 입력칸이 열리지 않는다.
    const r = await ev(`(()=>{
      const out=[];
      for(const st of [{loading:true,failed:false},{loading:false,failed:false},
                       {loading:false,failed:true}]){
        vodChatSearchState.messages=null;
        vodChatSearchState.loading=st.loading;
        vodChatSearchState.failed=st.failed;
        renderVodChatSearchBody(panel);
        out.push(panel.querySelector('.cheese-vod-search-input').disabled);
      }
      return out;})()`);
    ok(r.every(Boolean), "원문이 없으면 어떤 상태에서도 입력칸이 잠긴다");
  }

  console.log("\n[22] 200줄을 그리는 데 걸리는 시간");
  {
    const r = await ev(`(()=>{
      const list=[];
      for(let i=0;i<300000;i+=1)
        list.push({t:i*100,text:i%7===0?'둥그레 왔다 '+i:'ㅋㅋㅋㅋ '+i});
      vodChatSearchState.messages=list;
      vodChatSearchState.truncated='';
      vodChatSearchView.query='둥그레';
      const t0=performance.now();
      const res=searchVodChatMessages(list,'둥그레',200);
      const searchMs=performance.now()-t0;
      vodChatSearchView.result=res;
      const t1=performance.now();
      renderVodChatSearchBody(panel);
      const renderMs=performance.now()-t1;
      const rows=panel.querySelectorAll('.cheese-vod-search-list li').length;
      vodChatSearchState.messages=null;
      return {total:res.total,rows,
        searchMs:Math.round(searchMs*10)/10,
        renderMs:Math.round(renderMs*10)/10};})()`);
    console.log(
      `  30만건: 검색 ${r.searchMs}ms · 200줄 렌더 ${r.renderMs}ms · 결과 ${r.total.toLocaleString()}건`,
    );
    ok(r.rows === 200, `200줄만 그린다 (${r.rows})`);
    ok(r.searchMs < 200, `검색이 충분히 빠르다 (${r.searchMs}ms)`);
    ok(r.renderMs < 200, `렌더가 충분히 빠르다 (${r.renderMs}ms)`);
  }

  console.log(
    "\n[포커스] 플레이어가 눌림을 가로채도 한 번 눌러 입력할 수 있다",
  );
  {
    // ⚠ 증상: 한 번 클릭으로는 입력이 안 되고, 좌클릭을 꾹 누르고 있어야 글자가
    //   들어갔다. 이 팝오버는 치지직 플레이어 컨트롤 안에 붙는데, 플레이어가
    //   눌림 이벤트를 두 가지 방식으로 가로챈다. 실측 결과:
    //     preventDefault(mousedown)   → 포커스 기본 동작만 취소. 버블 리스너는 돈다
    //     stopPropagation(캡처 단계)  → 우리 리스너가 아예 실행되지 않는다
    //     click 에서 포커스 가져가기   → 실제 원인. 아래 trace 그대로다.
    //         mouseup  포커스: INPUT
    //         click    포커스: DIV.pzp   ← 여기서 빼앗긴다
    //   앞선 수정들은 앞의 둘만 막았다. 셋을 모두 검사한다.
    //   ⚠ 진짜 마우스 이벤트를 보내야 한다. input.focus() 를 직접 부르거나
    //     리스너를 손으로 흉내내면 이 버그가 재현되지 않는다.
    const modes = [
      ["preventDefault(mousedown)", "pd"],
      ["stopPropagation(캡처)", "stop"],
      ["click 에서 포커스 뺏김", "steal"],
    ];
    for (const [label, mode] of modes) {
      const box = await ev(`(()=>{
        // 방해 리스너를 매번 새로 건다.
        // ⚠ 실제 팝오버는 position:absolute; bottom:calc(100%+10px) 이라 컨테이너
        //   '위' 로 떠서 화면 밖(top 음수)에 놓인다. 그러면 좌표로 보낸 클릭이
        //   입력칸에 닿지 않아 검사가 헛돈다(실측: top=-52). 여기서는 위치만
        //   화면 안으로 돌려놓는다 — 포커스 동작과는 무관한 값이다.
        document.body.innerHTML=
          '<div id="cheese-player">'+
          '<div class="cheese-search-comment-timestamp-panel cheese-chat-peak-popover" '+
          'style="width:320px;position:static">'+
          '<div class="cheese-search-comment-panel-head"></div>'+
          '<div class="cheese-peak-body"></div></div></div>';
        window.panel=document.querySelector('.cheese-chat-peak-popover');
        vodChatSearchState.messages=[{t:0,text:'둥그레'}];
        vodChatSearchState.loading=false; vodChatSearchState.failed=false;
        vodChatSearchState.truncated='';
        vodChatSearchView.query=''; vodChatSearchView.result=null;
        vodChatSearchView.lastQuery=null;
        renderVodChatSearchBody(panel);
        const player=document.getElementById('cheese-player');
        if('${mode}'==='pd'){
          player.addEventListener('mousedown',(e)=>{e.preventDefault();});
        } else if('${mode}'==='stop'){
          player.addEventListener('pointerdown',(e)=>{e.stopPropagation();},true);
          player.addEventListener('mousedown',(e)=>{e.preventDefault();});
        } else {
          // 실제 치지직: mousedown 기본 동작을 막고, click 버블 끝에서 플레이어
          // 루트로 포커스를 가져간다(단축키를 받기 위해서다).
          // ⚠ document 에 남겨 두면 다음 검사까지 따라다닌다. 한 번만 돌고
          //   스스로 떨어지게 한다.
          player.setAttribute('tabindex','-1');
          player.addEventListener('mousedown',(e)=>{e.preventDefault();});
          const steal=()=>{
            document.querySelector('.cheese-vod-search-input')?.blur();
            player.focus();
            document.removeEventListener('click',steal);};
          document.addEventListener('click',steal);
        }
        document.activeElement?.blur?.();
        const r=panel.querySelector('.cheese-vod-search-input').getBoundingClientRect();
        return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
      // 진짜 한 번 클릭(누르고 곧바로 뗀다).
      for (const type of ["mousePressed", "mouseReleased"]) {
        await call(
          "Input.dispatchMouseEvent",
          { type, x: box.x, y: box.y, button: "left", clickCount: 1 },
          sessionId,
        );
        await new Promise((r) => setTimeout(r, 20));
      }
      // ⚠ click 에서 빼앗긴 포커스는 그 차례가 끝난 뒤에 되돌린다. 바로 재면
      //   되돌리기 전을 재게 되므로 한 번 쉬었다 확인한다(사용자가 글자를 치는
      //   시점은 어차피 그 뒤다).
      await new Promise((r) => setTimeout(r, 20));
      const focused = await ev(
        `document.activeElement===panel.querySelector('.cheese-vod-search-input')`,
      );
      ok(focused, `${label} → 한 번 클릭으로 포커스가 잡힌다`);
      await call("Input.insertText", { text: "둥" }, sessionId);
      await new Promise((r) => setTimeout(r, 20));
      const typed = await ev(
        `panel.querySelector('.cheese-vod-search-input').value`,
      );
      ok(
        typed === "둥",
        `${label} → 클릭 직후 바로 입력된다 (${JSON.stringify(typed)})`,
      );
    }
  }

  console.log("\n[한글 IME] 조합 중에 결과가 갱신돼도 자모가 합쳐진다");
  {
    // ⚠ 증상: 자음·모음이 합쳐지지 않고 낱자로만 들어갔다. 원인은 검색할 때마다
    //   입력칸이 든 껍데기를 통째로 다시 만들어, 조합 중인 입력칸이 DOM 에서
    //   떨어졌다 붙은 것이다(IME 조합 버퍼가 끊긴다).
    //   여기서는 CDP 로 '진짜 IME 조합' 을 넣는다. input.value 를 직접 넣는
    //   방식으로는 이 버그를 절대 재현할 수 없다.
    await ev(`(()=>{
      vodChatSearchState.messages=[{t:0,text:'둥그레 왔다'}];
      vodChatSearchState.loading=false; vodChatSearchState.failed=false;
      vodChatSearchState.truncated='';
      vodChatSearchView.query=''; vodChatSearchView.result=null;
      vodChatSearchView.lastQuery=null;
      panel.querySelector('.cheese-peak-body').textContent='';
      renderVodChatSearchBody(panel);
      const input=panel.querySelector('.cheese-vod-search-input');
      // 실제 코드와 같은 자리에서 재렌더가 끼어들게 한다.
      input.addEventListener('input',()=>{
        vodChatSearchView.query=input.value;
        vodChatSearchView.lastQuery=null;
        vodChatSearchView.result=vodChatSearchView.query
          ? searchVodChatMessages(vodChatSearchState.messages,vodChatSearchView.query,200)
          : null;
        renderVodChatSearchBody(panel);});
      input.focus();
      return true;})()`);
    // ㄷ → 두 → 둥 → 확정
    for (const step of ["ㄷ", "두", "둥"]) {
      await call(
        "Input.imeSetComposition",
        { text: step, selectionStart: step.length, selectionEnd: step.length },
        sessionId,
      );
      await new Promise((r) => setTimeout(r, 30));
    }
    await call("Input.insertText", { text: "둥" }, sessionId);
    await new Promise((r) => setTimeout(r, 30));
    const r = await ev(`(()=>{
      const i=panel.querySelector('.cheese-vod-search-input');
      return {value:i.value, focused:document.activeElement===i,
        rows:panel.querySelectorAll('.cheese-vod-search-list li').length};})()`);
    ok(r.value === "둥", `자모가 합쳐진다 (${JSON.stringify(r.value)})`);
    ok(r.focused, "조합 내내 포커스가 입력칸에 남는다");
    ok(r.rows === 1, `조합된 글자로 검색된다 (${r.rows}건)`);
  }

  console.log("\n[연속 검색] 한 번 검색한 뒤에도 이어서 칠 수 있다");
  {
    // ⚠ 증상: 검색할 때마다 본문을 다시 그리며 입력칸을 새로 만들어, 포커스와
    //   커서가 사라져 두 번째 검색어를 칠 수 없었다.
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[
        {t:1000,text:'둥그레 왔다'},{t:2000,text:'안녕하세요'}];
      vodChatSearchState.loading=false; vodChatSearchState.failed=false;
      vodChatSearchView.query=''; vodChatSearchView.result=null;
      vodChatSearchView.lastQuery=null;
      renderVodChatSearchBody(panel);
      const first=panel.querySelector('.cheese-vod-search-input');
      first.focus();
      // 1차 검색
      vodChatSearchView.query='둥그레';
      first.value='둥그레';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'둥그레',200);
      renderVodChatSearchBody(panel);
      const afterFirst=panel.querySelector('.cheese-vod-search-input');
      const keptNode = afterFirst===first;
      const keptFocus = document.activeElement===afterFirst;
      // 2차 검색어를 이어서 친다(사용자가 실제로 하는 동작).
      afterFirst.value='안녕';
      vodChatSearchView.query='안녕';
      vodChatSearchView.result=searchVodChatMessages(
        vodChatSearchState.messages,'안녕',200);
      renderVodChatSearchBody(panel);
      const afterSecond=panel.querySelector('.cheese-vod-search-input');
      return {keptNode, keptFocus,
        focusAfterSecond: document.activeElement===afterSecond,
        valueAfterSecond: afterSecond.value,
        disabled: afterSecond.disabled,
        rows: panel.querySelectorAll('.cheese-vod-search-list li').length,
        status: panel.querySelector('.cheese-vod-search-status').textContent};})()`);
    ok(r.keptNode, "검색해도 입력칸을 새로 만들지 않는다(같은 요소를 유지)");
    ok(r.keptFocus, "1차 검색 뒤에도 포커스가 입력칸에 남는다");
    ok(r.focusAfterSecond, "2차 검색 뒤에도 포커스가 남는다");
    ok(
      r.valueAfterSecond === "안녕",
      `친 글자가 남는다 (${r.valueAfterSecond})`,
    );
    ok(!r.disabled, "입력칸이 잠기지 않는다");
    ok(r.rows === 1 && r.status.includes("1개"), "2차 검색 결과가 나온다");
  }

  console.log("\n[커서] 가운데를 고쳐도 커서가 끝으로 튀지 않는다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=[{t:0,text:'둥그레'}];
      vodChatSearchView.query='둥그레'; vodChatSearchView.lastQuery=null;
      vodChatSearchView.result=null;
      renderVodChatSearchBody(panel);
      const input=panel.querySelector('.cheese-vod-search-input');
      input.focus(); input.value='둥그레'; input.setSelectionRange(1,1);
      renderVodChatSearchBody(panel);
      const after=panel.querySelector('.cheese-vod-search-input');
      return {start:after.selectionStart,end:after.selectionEnd};})()`);
    ok(r.start === 1 && r.end === 1, `커서 위치가 유지된다 (${r.start})`);
  }

  console.log("\n[준비 안내] 왜 다시 받는지 알려 준다");
  {
    const r = await ev(`(()=>{
      vodChatSearchState.messages=null;
      vodChatSearchState.loading=true;
      vodChatSearchState.progress=0.2;
      vodChatSearchState.failed=false;
      renderVodChatSearchBody(panel);
      const note=panel.querySelector('.cheese-vod-search-note');
      const ready=(()=>{vodChatSearchState.messages=[{t:0,text:'x'}];
        vodChatSearchState.loading=false;
        renderVodChatSearchBody(panel);
        return !!panel.querySelector('.cheese-vod-search-note');})();
      return {text:note?.textContent||'', shownWhenReady:ready};})()`);
    ok(r.text.includes("저장하지 않아"), `이유를 밝힌다 (${r.text})`);
    ok(r.text.includes("다시 받지 않습니다"), "이 탭에서는 한 번뿐임을 알린다");
    ok(!r.shownWhenReady, "준비가 끝나면 안내를 치운다");
  }

  console.log("\n[E/S] 기존 순회가 돌고 있으면 기다렸다가 한 번만 모은다");
  {
    // ⚠ 문구 검사만으로는 부족하다(`if (false && running)` 같은 사보타주가
    //   그대로 통과했다). 실제 함수를 스텁 위에서 돌려 본다.
    const r = await ev(`(async()=>{
      const log=[];
      let scanRunning=null, resolveScan=null;
      window.getCurrentVideoNo=()=>window.__video;
      window.__video='1';
      window.vodChatScanCoordinator={videoNo:'',promise:null};
      // 공유 순회 스텁: 동시에 두 번 돌면 바로 들킨다.
      let active=0;
      window.collectVodChatDataShared=async(videoNo,duration,onProgress)=>{
        active+=1; log.push('scan:start');
        if(active>1) log.push('DUPLICATE');
        await new Promise(r=>setTimeout(r,10));
        onProgress?.(1);
        // 검색이 opt-in 으로 켜져 있으면 원문을 넘긴다(실제 순회와 같은 규칙).
        if(vodChatSearchState.collecting && vodChatSearchState.videoNo===videoNo){
          vodChatSearchState.messages=[{t:0,text:'둥그레'}];
          vodChatSearchState.collecting=false;
          vodChatSearchState.loading=false;
        }
        active-=1; log.push('scan:done');
        return {complete:true};
      };
      ${sliceFn("ensureVodChatSearchMessages")}

      // 활성도 순회가 이미 돌고 있는 상황을 만든다.
      vodChatSearchState.videoNo='1';
      vodChatSearchState.messages=null;
      vodChatSearchState.loading=false;
      vodChatSearchState.collecting=false;
      scanRunning=new Promise(res=>{resolveScan=res;});
      window.vodChatScanCoordinator={videoNo:'1',promise:scanRunning};
      log.push('activity:running');

      const p=ensureVodChatSearchMessages('1',100,()=>{});
      // 기다리는 동안에는 검색용 수집이 시작되면 안 된다.
      await new Promise(r=>setTimeout(r,5));
      const startedWhileWaiting = vodChatSearchState.loading;
      log.push('waiting:loading='+startedWhileWaiting);

      // 활성도 순회가 끝난다.
      window.vodChatScanCoordinator={videoNo:'',promise:null};
      resolveScan();
      const out=await p;
      return {log, startedWhileWaiting, got:Array.isArray(out)?out.length:null};})()`);
    ok(!r.startedWhileWaiting, "기다리는 동안 검색용 수집을 시작하지 않는다");
    ok(
      !r.log.includes("DUPLICATE"),
      "같은 영상을 동시에 두 번 순회하지 않는다",
    );
    ok(
      r.log.filter((x) => x === "scan:start").length === 1,
      `순회는 한 번만 돈다 (${r.log.filter((x) => x === "scan:start").length}회)`,
    );
    ok(r.got === 1, `기다린 뒤 자동으로 원문을 받는다 (${r.got}건)`);
  }

  console.log("\n[Q] 기다리는 사이 영상이 바뀌면 새로 시작하지 않는다");
  {
    const r = await ev(`(async()=>{
      let started=0;
      window.__video='1';
      window.getCurrentVideoNo=()=>window.__video;
      window.collectVodChatDataShared=async()=>{started+=1;return {complete:true};};
      let resolveScan;
      const scan=new Promise(res=>{resolveScan=res;});
      window.vodChatScanCoordinator={videoNo:'1',promise:scan};
      vodChatSearchState.videoNo='1';
      vodChatSearchState.messages=null;
      vodChatSearchState.loading=false;
      ${sliceFn("ensureVodChatSearchMessages")}
      const p=ensureVodChatSearchMessages('1',100,()=>{});
      // 기다리는 사이 다른 영상으로 이동.
      window.__video='2';
      window.vodChatScanCoordinator={videoNo:'',promise:null};
      resolveScan();
      const out=await p;
      return {started,out};})()`);
    ok(
      r.started === 0,
      `영상이 바뀌면 수집을 시작하지 않는다 (${r.started}회)`,
    );
    ok(r.out === null, "지난 영상의 결과를 돌려주지 않는다");
  }

  // ── 소스 확인(브라우저 밖) ───────────────────────────────────────────────
  console.log("\n[소스] 수명주기 규칙이 코드에 들어 있다");
  {
    ok(
      /if \(vodChatSearchView\.timer\) clearTimeout/.test(SRC),
      "입력에 debounce 를 건다",
    );
    // ⚠ 위 [포커스] 검사는 실제 코드와 '같은 모양' 의 처리를 붙여 재현한 것이다.
    //   원본에 진짜로 들어가 있는지는 여기서 따로 확인한다.
    // ⚠ 팝오버에 달면 안 된다. 플레이어가 캡처 단계에서 전파를 끊으면 아예 돌지
    //   않는다(실측). document 의 캡처 단계여야 플레이어보다 먼저 잡는다.
    ok(
      /document\.addEventListener\(\s*"pointerdown",[\s\S]{0,600}?\n    true,\n  \);/.test(
        SRC,
      ),
      "포커스 처리를 document 캡처 단계에서 잡는다",
    );
    ok(
      /input\.focus\(\{ preventScroll: true \}\)/.test(SRC),
      "플레이어가 기본 동작을 막아도 포커스를 잡는다",
    );
    ok(
      /VOD_CHAT_SEARCH_DEBOUNCE_MS = 2\d\d/.test(SRC),
      "debounce 가 180~250ms 대다",
    );
    ok(/event\.key !== "Enter"/.test(SRC), "Enter 로 바로 검색한다");
    // [E] 기존 순회가 돌고 있으면 기다렸다가 시작한다.
    const ensure = SRC.slice(
      SRC.indexOf("async function ensureVodChatSearchMessages"),
      SRC.indexOf("// ── 검색 화면"),
    );
    ok(
      /const running =\s*\n?\s*vodChatScanCoordinator\.videoNo === videoNo/.test(
        ensure,
      ),
      "돌고 있는 순회를 알아본다",
    );
    ok(/await running;/.test(ensure), "그 순회가 끝나기를 기다린다");
    ok(
      ensure.indexOf("await running;") <
        ensure.indexOf("vodChatSearchState.collecting = true"),
      "기다린 뒤에 검색용 수집을 시작한다(동시에 돌지 않는다)",
    );
    ok(
      /if \(getCurrentVideoNo\(\) !== videoNo\) return null;/.test(ensure),
      "기다린 뒤 영상이 바뀌었으면 시작하지 않는다",
    );
    ok(
      /if \(vodChatSearchState\.loading\) return null;/.test(ensure),
      "기다리는 사이 다른 호출이 시작했으면 겹치지 않는다",
    );
    // [P] 이동은 기존 helper 를 쓴다.
    ok(
      /seekVideoToCommentTimestamp\(\s*Number\(searchSeek\.dataset\.vodSearchSeek\) \|\| 0,?\s*\)/.test(
        SRC,
      ),
      "결과 클릭은 기존 이동 helper 를 쓴다",
    );
    ok(
      !/video\.currentTime =/.test(
        SRC.slice(
          SRC.indexOf("// ── 검색 화면"),
          SRC.indexOf("function collectVodChatDataShared"),
        ),
      ),
      "검색 코드가 직접 재생 위치를 건드리지 않는다",
    );
    // [12] seek 뒤에 패널을 닫지 않는다.
    const click = SRC.slice(
      SRC.indexOf("const searchSeek = target.closest"),
      SRC.indexOf("const searchSeek = target.closest") + 400,
    );
    ok(
      !/closeChatPeakPopover/.test(click),
      "결과를 눌러도 패널을 닫지 않는다(연달아 누를 수 있다)",
    );
    // [Q] 영상이 바뀌면 화면 상태까지 비운다.
    ok(
      /resetVodChatSearchView\(\)/.test(SRC),
      "영상이 바뀌면 검색 화면 상태도 비운다",
    );
    // [16] 재시도가 다른 기능을 초기화하지 않는다.
    const retry = SRC.slice(
      SRC.indexOf('if (target.closest("[data-vod-search-retry]"))'),
      SRC.indexOf('if (target.closest("[data-vod-search-retry]"))') + 420,
    );
    ok(
      !/chatGraphState|roleChatState|titleChange/.test(retry),
      "다시 시도가 활성도·방장 채팅·제목 기록을 건드리지 않는다",
    );
    // [14] 상한을 조용히 완료로 처리하지 않는다.
    ok(
      /searchTruncated = "message"/.test(SRC),
      "메시지 상한에 걸린 것을 기록한다",
    );
    ok(/searchTruncated = "page"/.test(SRC), "페이지 상한도 구분해 기록한다");
    ok(
      /const usable = complete \|\| searchTruncated === "page";/.test(SRC),
      "페이지 상한은 실패가 아니라 '일부' 로 다룬다",
    );
    // [30] 새 플레이어 버튼을 만들지 않았다.
    ok(
      !/ensureVodChatSearchButton|cheese-vod-search-player-button/.test(SRC),
      "새 플레이어 컨트롤 버튼을 만들지 않았다",
    );
    // [U/V] 저장하지 않는다.
    const view = SRC.slice(
      SRC.indexOf("// ── 검색 화면"),
      SRC.indexOf("function collectVodChatDataShared"),
    );
    ok(!/chrome\.storage/.test(view), "검색 화면이 저장소를 쓰지 않는다");
    ok(
      !/nickname|userIdHash|userId/.test(view),
      "검색 화면이 닉네임·UID 를 다루지 않는다",
    );
  }

  console.log("\n[21] 새 CSS 가 치지직 해시 클래스에 기대지 않는다");
  {
    // ⚠ 파일 끝까지 자르면 뒤에 오는 남의 규칙까지 함께 검사하게 된다.
    //   내가 넣은 블록(다음 주석 구분선 전까지)만 본다.
    const from = CSS.indexOf("/* ── 다시보기 채팅 검색");
    const next = CSS.indexOf("/* ──", from + 10);
    const block = CSS.slice(from, next > 0 ? next : CSS.length);
    ok(/\.cheese-vod-search/.test(block), "기존 접두사를 따른다");
    ok(!/_[a-z]+_[a-z0-9]{5}/.test(block), "치지직 해시 클래스를 쓰지 않는다");
    ok(
      /\.cheese-search-comment-panel-head button > svg\s*\{\s*flex: 0 0 auto;/.test(
        CSS,
      ),
      "머리말 아이콘이 줄어들지 않게 고정한다",
    );
    // 지우기(X) — 크롬 기본 아이콘은 어두운 패널에서 거의 안 보인다(실측:
    // 흐린 남색). 기본 아이콘을 끄고 흰색으로 직접 그린다.
    const clear = CSS.slice(
      CSS.indexOf(".cheese-vod-search-input::-webkit-search-cancel-button"),
      CSS.indexOf(".cheese-vod-search-note"),
    );
    ok(/appearance: none/.test(clear), "크롬 기본 지우기 아이콘을 끈다");
    ok(
      /background-color: rgba\(255, 255, 255/.test(clear),
      "지우기 아이콘을 흰색 계열로 그린다",
    );
    ok(/mask:/.test(clear), "아이콘 모양을 직접 지정한다");
    ok(/:hover/.test(clear), "가리키면 더 또렷해진다");
    // ⚠ 전역 svg 규칙을 바꾸지 않는다.
    ok(!/^svg \{/m.test(block), "전역 svg 규칙을 건드리지 않는다");
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

// ⚠ 크롬이 프로필 폴더를 아직 쥐고 있으면 지우다 ENOTEMPTY 로 터진다. 임시
//   폴더가 남는 것은 결과와 무관하므로 실패로 만들지 않는다.
function cleanup() {
  try {
    b.kill();
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}
