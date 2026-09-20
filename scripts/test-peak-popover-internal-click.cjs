// 구간 요약 팝오버가 '안을 눌렀는데' 닫히는 회귀.
//
// 증상: 머리말의 검색 아이콘을 누르면 검색 화면으로 바뀌지 않고 팝오버가 닫힌다.
//
// 공통 원인: 검색 버튼의 click 처리가 머리말을 innerHTML 로 통째로 갈아끼운다.
// 그래서 이벤트가 document 까지 올라올 무렵 눌린 버튼은 이미 DOM 에서 떨어져
// 나가 있고, target.closest() 는 null 이 된다.
//
//   head 교체 전 connected=true → 교체 후 connected=false
//   target.closest(.panel)=null      ← 여기서 '바깥' 으로 오판
//   composedPath.includes(panel)=true ← 경로에는 남아 있다
//
// 닫는 경로가 둘이었다. 처음에는 첫 번째만 고쳐서 실제 치지직에서는 그대로였다.
//
//  1) 구간 요약 자신의 바깥 클릭 판정 — composedPath 로 고침.
//  2) 댓글 타임스탬프 패널의 document 리스너 — 이쪽이 실제 범인이었다.
//     구간 요약 팝오버가 댓글 타임스탬프와 '같은 겉껍데기 클래스' 를 쓰는데
//     그 패널의 삭제 선택자에서 빠져 있어, 검색을 누르면 함께 지워졌다.
//     실제 trace: 팝오버만 떨어짐(조상·컨트롤은 그대로), 숨김이 아니라 detach.
//
// ⚠ fixture 가 지켜야 할 두 가지. 하나라도 빠지면 진짜 버그를 놓친다.
//   - 누른 버튼이 handler 안에서 DOM 에서 제거될 것
//   - 팝오버가 '실제 클래스 조합' 을 쓰고, 두 document 리스너가 모두 있을 것
//   (예전 fixture 는 둘째를 빠뜨려서 통과해 버렸다.)
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");

// content.js 에서 함수 본문을 그대로 떼어 온다(문구를 베껴 두면 원본과 어긋난다).
function sliceFn(name) {
  let at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) at = SRC.indexOf(`  async function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < 0) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

// content.js 의 COMMENT_TIMESTAMP_PANEL_SELECTOR 를 실제 값으로 만들어 온다.
// ⚠ 여기 문자열을 손으로 베껴 두면 원본이 바뀌어도 테스트가 계속 통과한다.
function commentSelector() {
  const pick = (name) => {
    const m = SRC.match(new RegExp(`const ${name} = "([^"]+)"`));
    if (!m) throw Error(`상수를 찾지 못했다: ${name}`);
    return m[1];
  };
  const body = SRC.match(
    /const COMMENT_TIMESTAMP_PANEL_SELECTOR =\s*([\s\S]*?);\n/,
  );
  if (!body) throw Error("COMMENT_TIMESTAMP_PANEL_SELECTOR 를 찾지 못했다");
  return body[1]
    .replace(/`/g, "")
    .replace(/\s*\+\s*/g, "")
    .replace(/\$\{(\w+)\}/g, (_, n) => pick(n))
    .trim();
}

// handleCommentTimestampDocumentClick 이 '패널 안인가' 를 어떻게 보는지 그대로
// 가져온다. composedPath 든 target.closest 든 원본이 쓰는 방식이 그대로 실린다.
function commentInsideCheckBody() {
  const fn = SRC.slice(
    SRC.indexOf("function handleCommentTimestampDocumentClick"),
    SRC.indexOf("function handleCommentTimestampKeydown"),
  );
  if (!fn) throw Error("handleCommentTimestampDocumentClick 을 찾지 못했다");
  // 새 방식: 경로로 본다.
  const viaPath = fn.match(
    /if \(eventPathContains\(event, `\.\$\{VIDEO_COMMENT_PANEL_CLASS\}`\)\) return;/,
  );
  if (viaPath) {
    return `return eventPathContains(event, '.${"cheese-search-comment-timestamp-panel"}');`;
  }
  // 예전 방식: 떨어져 나간 target 에 기댄다.
  const viaClosest = fn.match(
    /const panel = event\.target\.closest\(`\.\$\{VIDEO_COMMENT_PANEL_CLASS\}`\);/,
  );
  if (viaClosest) {
    return `return !!event.target.closest?.('.cheese-search-comment-timestamp-panel');`;
  }
  throw Error("패널 안/바깥 판정 방식을 알아내지 못했다");
}

const dir = mkdtempSync(join(tmpdir(), "cheese-peak-"));
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

  // 실제 판정 함수와 실제 머리말 렌더를 그대로 올린다.
  await ev(`(()=>{
    window.CHAT_PEAK_POPOVER_CLASS='cheese-chat-peak-popover';
    window.CHAT_GRAPH_BUTTON_CLASS='cheese-chat-graph-button';
    window.vodChatSearchView={open:false,query:'',lastQuery:null,result:null,timer:0,token:0};
    // 댓글 타임스탬프가 '자기 것만' 지우는 선택자 — 실제 소스에서 그대로 가져온다.
    window.COMMENT_SELECTOR=${JSON.stringify(commentSelector())};
    window.commentInsideCheck=(event)=>{ ${commentInsideCheckBody()} };
    ${sliceFn("eventPathContains")}
    ${sliceFn("renderChatPeakPanelHead")}
    window.eventPathContains=eventPathContains;
    window.renderChatPeakPanelHead=renderChatPeakPanelHead;

    // 실제 구조와 같은 껍데기 + 실제 document 리스너와 같은 판정.
    window.setup=()=>{
      // ⚠ 실제 팝오버가 쓰는 클래스를 그대로 써야 한다. 구간 요약 팝오버는
      //   댓글 타임스탬프 패널과 '같은 겉껍데기 클래스'를 공유하는데, 예전
      //   fixture 가 이걸 빼먹어서 남의 close 경로에 지워지는 진짜 버그를
      //   구조적으로 재현하지 못했다.
      document.body.innerHTML=
        '<div id="host">'+
        '<button class="cheese-chat-graph-button">활성도</button>'+
        '<div class="cheese-search-comment-timestamp-panel cheese-chat-peak-popover" id="panel">'+
        '<div class="cheese-search-comment-panel-head"></div>'+
        '<div class="cheese-peak-body"></div></div></div>'+
        '<div id="outside">바깥</div>';
      window.panel=document.getElementById('panel');
      window.closeReasons=[];
      window.closePeak=(why)=>{window.closeReasons.push(why);
        document.querySelectorAll('.cheese-chat-peak-popover').forEach(e=>e.remove());};
      vodChatSearchView.open=false;
      renderChatPeakPanelHead(panel);

      // 팝오버 내부 handler — 실제 코드처럼 머리말을 통째로 갈아끼운다.
      panel.addEventListener('click',(e)=>{
        const t=e.target;
        if(!(t instanceof Element))return;
        if(t.closest('[data-peak-close]')){closePeak('close-button');return;}
        if(t.closest('[data-peak-search]')){
          window.detachedOnSearch = (()=>{ // 교체 '후' 연결 상태를 남긴다
            vodChatSearchView.open=true;
            renderChatPeakPanelHead(panel);
            panel.querySelector('.cheese-peak-body').innerHTML=
              '<div class="cheese-vod-search"><input type="search" class="cheese-vod-search-input"></div>';
            return !t.isConnected;})();
          return;}
        if(t.closest('[data-peak-search-back]')){
          vodChatSearchView.open=false;
          renderChatPeakPanelHead(panel);
          panel.querySelector('.cheese-peak-body').innerHTML='<div class="cheese-peak-section">구간</div>';
          return;}
      });

      // document 바깥 판정 — 실제 리스너와 같은 규칙.
      window.docHandler=(event)=>{
        if(!document.querySelector('.cheese-chat-peak-popover'))return;
        const target=event.target;
        if(!(target instanceof Element))return;
        if(eventPathContains(event,'.cheese-chat-peak-popover'))return;
        if(eventPathContains(event,'.cheese-chat-graph-button'))return;
        closePeak('outside-click');
      };
      // ⚠ 두 번째 close 경로. 댓글 타임스탬프 패널의 document 리스너는 같은
      //   겉껍데기 클래스를 지우므로, 여기서 빠지면 구간 요약 팝오버가 함께
      //   사라진다. 실제 코드의 판정·선택자를 그대로 쓴다.
      window.commentHandler=(event)=>{
        // ⚠ 안/바깥 판정은 실제 소스에서 떼어 온 것을 쓴다. 여기에 판정을 손으로
        //   적어 두면, 원본이 예전 방식으로 되돌아가도 테스트가 통과해 버린다.
        if(window.commentInsideCheck(event))return;
        const removed=document.querySelector(window.COMMENT_SELECTOR);
        if(removed){ window.closeReasons.push('comment-timestamp-close');
          removed.remove(); }
      };
      document.addEventListener('click',window.docHandler);
      document.addEventListener('click',window.commentHandler);
      return true;};
    window.teardown=()=>{
      document.removeEventListener('click',window.docHandler);
      document.removeEventListener('click',window.commentHandler);};
    window.alive=()=>!!document.getElementById('panel');
    return true;})()`);

  console.log("[측정] 검색 클릭 시 눌린 버튼이 실제로 DOM 에서 떨어지는가");
  {
    const r = await ev(`(()=>{setup();
      const btn=panel.querySelector('[data-peak-search]');
      const before=btn.isConnected;
      btn.click();
      const out={before, detached:window.detachedOnSearch, alive:alive(),
        reasons:window.closeReasons.slice()};
      teardown(); return out;})()`);
    ok(r.before === true, "누르기 전에는 버튼이 붙어 있다");
    // ⚠ 이게 false 면 fixture 가 실제 상황을 재현하지 못한 것이다.
    ok(
      r.detached === true,
      "handler 안에서 머리말이 갈아끼워져 버튼이 떨어져 나간다(재현 성립)",
    );
    ok(
      r.alive === true,
      `팝오버가 살아 있다 (닫힌 이유: ${r.reasons.join(",") || "없음"})`,
    );
    ok(r.reasons.length === 0, "바깥 클릭으로 오판하지 않는다");
  }

  console.log(
    "\n[2차 경로] 댓글 타임스탬프 close 가 구간 요약을 지우지 않는다",
  );
  {
    // ⚠ 실제 치지직에서 팝오버를 지운 것은 바깥 클릭 판정이 아니라 이쪽이었다.
    //   구간 요약 팝오버가 댓글 타임스탬프와 같은 겉껍데기 클래스를 쓰는데,
    //   그 패널의 삭제 선택자에서 빠져 있어 함께 지워졌다.
    const r = await ev(`(()=>{setup();
      const sel=window.COMMENT_SELECTOR;
      const matchesPeak=panel.matches(sel);
      panel.querySelector('[data-peak-search]').click();
      const out={matchesPeak, alive:alive(), reasons:window.closeReasons.slice(),
        searchUi:!!panel.isConnected&&!!document.querySelector('.cheese-vod-search-input')};
      teardown(); return out;})()`);
    ok(
      r.matchesPeak === false,
      "구간 요약 팝오버가 댓글 타임스탬프 삭제 대상에서 빠져 있다",
    );
    ok(
      !r.reasons.includes("comment-timestamp-close"),
      `댓글 타임스탬프 close 가 돌지 않는다 (${r.reasons.join(",") || "없음"})`,
    );
    ok(r.alive, "두 리스너가 모두 있어도 팝오버가 살아 있다");
    ok(r.searchUi, "검색 화면으로 전환된다");
  }

  console.log("\n[A] 검색 클릭 → 팝오버 유지 + 검색 화면 전환");
  {
    const r = await ev(`(()=>{setup();
      panel.querySelector('[data-peak-search]').click();
      const out={alive:alive(),
        title:panel.querySelector('strong')?.textContent,
        back:!!panel.querySelector('[data-peak-search-back]'),
        input:!!panel.querySelector('.cheese-vod-search-input'),
        rescan:!!panel.querySelector('[data-peak-rescan]'),
        close:!!panel.querySelector('[data-peak-close]')};
      teardown(); return out;})()`);
    ok(r.alive, "팝오버가 닫히지 않는다");
    ok(r.title === "채팅 키워드 검색", `제목 전환 (${r.title})`);
    ok(r.back, "뒤로 버튼이 보인다");
    ok(r.input, "검색 입력칸이 보인다");
    ok(!r.rescan, "'다시 수집' 은 감춘다");
    ok(r.close, "닫기 버튼은 그대로 있다");
  }

  console.log("\n[C/13] 뒤로 클릭 → 구간 요약 복귀 + 팝오버 유지");
  {
    // ⚠ 뒤로 버튼도 머리말을 갈아끼우므로 같은 문제가 날 수 있다.
    const r = await ev(`(()=>{setup();
      panel.querySelector('[data-peak-search]').click();
      const back=panel.querySelector('[data-peak-search-back]');
      back.click();
      const out={alive:alive(), detached:!back.isConnected,
        title:panel.querySelector('strong')?.textContent,
        rescan:!!panel.querySelector('[data-peak-rescan]'),
        search:!!panel.querySelector('[data-peak-search]'),
        reasons:window.closeReasons.slice()};
      teardown(); return out;})()`);
    ok(
      r.detached === true,
      "뒤로 버튼도 자기 처리 중에 떨어져 나간다(재현 성립)",
    );
    ok(
      r.alive,
      `뒤로 눌러도 팝오버가 유지된다 (${r.reasons.join(",") || "닫힘 없음"})`,
    );
    ok(r.title === "구간 요약", `구간 요약으로 복귀 (${r.title})`);
    ok(r.rescan && r.search, "'다시 수집'·검색 버튼이 돌아온다");
  }

  console.log("\n[D/E/11] 검색 화면 내부 클릭은 팝오버를 닫지 않는다");
  {
    const r = await ev(`(()=>{setup();
      panel.querySelector('[data-peak-search]').click();
      const out={};
      const input=panel.querySelector('.cheese-vod-search-input');
      input.click(); out.input=alive();
      input.focus(); input.value='둥그레'; input.click(); out.typing=alive();
      // 결과 영역 빈 공간
      panel.querySelector('.cheese-peak-body').click(); out.body=alive();
      // 팝오버 자체(스크롤바 근처 등)
      panel.click(); out.panel=alive();
      out.reasons=window.closeReasons.slice();
      teardown(); return out;})()`);
    ok(r.input, "입력칸 클릭 → 유지");
    ok(r.typing, "입력 중 클릭 → 유지");
    ok(r.body, "결과 영역 빈 공간 클릭 → 유지");
    ok(r.panel, "팝오버 여백 클릭 → 유지");
  }

  console.log("\n[F/12] 결과 줄 클릭 → 이동하되 팝오버 유지");
  {
    const r = await ev(`(()=>{setup();
      panel.querySelector('[data-peak-search]').click();
      // 결과 줄을 실제 구조처럼 넣는다.
      panel.querySelector('.cheese-peak-body').innerHTML=
        '<ul class="cheese-vod-search-list"><li>'+
        '<button data-vod-search-seek="5523"><time>1:32:03</time>'+
        '<span class="cheese-vod-search-text">둥그레</span></button></li></ul>';
      let seeked=null;
      panel.addEventListener('click',(e)=>{
        const s=e.target.closest?.('[data-vod-search-seek]');
        if(s) seeked=Number(s.dataset.vodSearchSeek);});
      panel.querySelector('[data-vod-search-seek]').click();
      const first={alive:alive(),seeked};
      // 연속으로 한 번 더.
      panel.querySelector('[data-vod-search-seek]')?.click();
      const out={first,second:{alive:alive()},reasons:window.closeReasons.slice()};
      teardown(); return out;})()`);
    ok(r.first.seeked === 5523, `정확한 시각으로 이동 (${r.first.seeked})`);
    ok(r.first.alive, "결과를 눌러도 팝오버가 유지된다");
    ok(r.second.alive, "연속으로 눌러도 유지된다");
  }

  console.log("\n[I/15] X 닫기는 반드시 닫힌다");
  {
    const r = await ev(`(()=>{setup();
      panel.querySelector('[data-peak-close]').click();
      const out={alive:alive(),reasons:window.closeReasons.slice()};
      teardown(); return out;})()`);
    ok(!r.alive, "닫기 버튼으로 닫힌다");
    ok(
      r.reasons.includes("close-button"),
      `명시적 닫기 handler 가 닫았다 (${r.reasons.join(",")})`,
    );
  }

  console.log("\n[J/16] 진짜 바깥 클릭은 기존대로 닫힌다");
  {
    const r = await ev(`(()=>{
      const out={};
      for(const sel of ['#outside','body']){
        setup();
        document.querySelector(sel).click();
        out[sel]={alive:alive(),reasons:window.closeReasons.slice()};
        teardown();}
      return out;})()`);
    ok(!r["#outside"].alive, "팝오버 밖 요소 클릭 → 닫힘");
    ok(
      r["#outside"].reasons.includes("outside-click"),
      "바깥 클릭으로 판정한다",
    );
    ok(!r["body"].alive, "페이지 여백 클릭 → 닫힘");
  }

  console.log("\n[M] 검색 화면으로 바꾼 뒤의 바깥 클릭도 정상히 닫힌다");
  {
    // ⚠ 고침이 '무조건 열어 두는' 쪽으로 기울지 않았는지 본다.
    const r = await ev(`(()=>{setup();
      panel.querySelector('[data-peak-search]').click();
      document.getElementById('outside').click();
      const out={alive:alive(),reasons:window.closeReasons.slice()};
      teardown(); return out;})()`);
    ok(!r.alive, "DOM 이 갈아끼워진 뒤에도 바깥 클릭은 닫는다");
    ok(r.reasons.includes("outside-click"), "바깥으로 올바로 판정한다");
  }

  console.log("\n[K/17] 활성도 버튼(여는 버튼) 클릭은 바깥으로 보지 않는다");
  {
    const r = await ev(`(()=>{setup();
      document.querySelector('.cheese-chat-graph-button').click();
      const out={alive:alive(),reasons:window.closeReasons.slice()};
      teardown(); return out;})()`);
    ok(r.alive, "여는 버튼 클릭을 바깥 클릭으로 닫지 않는다(기존 동작 유지)");
  }

  // ── 소스 확인 ────────────────────────────────────────────────────────────
  console.log("\n[소스] 판정 방식과 범위");
  {
    ok(
      /function eventPathContains\(event, selector\)/.test(SRC),
      "경로 기반 판정 함수가 있다",
    );
    const listener = SRC.slice(
      SRC.indexOf("// 팝오버 바깥을 누르거나 Esc 면 닫는다"),
      SRC.indexOf('if (event.key === "Escape") closeChatPeakPopover();'),
    );
    ok(
      /eventPathContains\(event, `\.\$\{CHAT_PEAK_POPOVER_CLASS\}`\)/.test(
        listener,
      ),
      "바깥 판정이 경로를 본다",
    );
    // ⚠ 예전 방식이 남아 있으면 같은 버그가 다시 난다.
    ok(
      !/target\.closest\(`\.\$\{CHAT_PEAK_POPOVER_CLASS\}`\)/.test(listener),
      "떨어져 나간 target 에 기대는 판정이 남아 있지 않다",
    );
    // §6 — 내부 버튼에 stopPropagation 을 뿌리지 않았다.
    const inner = SRC.slice(
      SRC.indexOf('if (target.closest("[data-peak-search]"))'),
      SRC.indexOf('if (target.closest("[data-peak-search]")') + 900,
    );
    ok(
      !/stopPropagation/.test(inner),
      "내부 버튼에서 이벤트 전파를 막지 않는다",
    );
    // 닫기·Esc 는 그대로 살아 있어야 한다.
    ok(
      /if \(event\.key === "Escape"\) closeChatPeakPopover\(\);/.test(SRC),
      "Esc 로 닫는 경로는 그대로다",
    );
    ok(
      /if \(target\.closest\("\[data-peak-close\]"\)\) \{\s*closeChatPeakPopover\(\);/.test(
        SRC,
      ),
      "닫기 버튼은 여전히 명시적으로 닫는다",
    );
    // 수집 로직을 건드리지 않았다.
    ok(
      !/vodChatSearchState\s*=\s*\{/.test(
        SRC.slice(SRC.indexOf("function eventPathContains")),
      ),
      "검색 데이터 상태를 건드리지 않았다",
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

// ⚠ 크롬이 프로필 폴더를 아직 쥐고 있으면 ENOTEMPTY 로 터진다. 결과와 무관하다.
function cleanup() {
  try {
    b.kill();
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}
