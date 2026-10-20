// 채팅 프로필 팝오버 다듬기(content.js enhanceChatProfilePopover).
//
// 1) '…부터 팔로우' 날짜 옆 '(N일 전)': 치지직 글자는 그대로 두고 속성 + ::after 로만 덧붙인다.
// 2) 자주 쓰지 않는 메뉴 접기: 관리 기능은 위에, '기타 기능 N개' 머리 아래로 접는다(상태 기억).
// 3) 채팅창 옆에 띄우기: 일반 라이브 화면에서 가로 위치만 채팅창 바깥으로, 자리가 없으면 그대로.
// 마크업은 치지직 프로필 팝오버(역할 클래스 _information_/_history_/_list_/_item_)를 줄였다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const contentCss = read("src/content.css");
const settingsHtml = read("settings.html");
const settings = read("src/settings.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `${start} 를 찾지 못했다`);
  const stop = source.indexOf(end, at);
  assert.ok(stop > at, `${end} 를 찾지 못했다`);
  return source.slice(at, stop);
};
const sliceFn = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

const MODULE = between(content, "  // ── 채팅 프로필 팝오버 다듬기", "  // 헤더 전담 옵저버")
  // about:blank 에서는 주소를 바꿀 수 없어 경로만 바꿔 끼운다.
  .replace("location.pathname", "window.__path");
const CSS = between(contentCss, "/* 채팅 프로필 팝오버 다듬기", "/* 채팅 너비 조절 또는 왼쪽 배치 시: 프로필") +
  between(contentCss, "html.cheese-chat-left-position aside#aside-chatting [role=\"alertdialog\"],\nhtml.cheese-chat-left-position aside#vod-aside [role=\"alertdialog\"],\nhtml.cheese-chat-left-position\n", "/* 채팅 헤더 '더보기 메뉴'");

const POPOVER_HEAD = `
<div class="_container_jao35_20" role="alertdialog" aria-modal="true" id="pop">
  <div class="_contents_jao35_54" id="popup_contents">
    <button type="button" class="_information_y6scg_12">검우치</button>
    <div class="_history_y6scg_23"><div class="_row_y6scg_186"><span class="_cell_xwsra_155" id="follow">1개월 구독중 · 2026년 9월 23일 부터 팔로우</span></div></div>
    <div class="_area_y6scg_50"><div class="_list_y6scg_60" id="list">`;
const POPOVER_TAIL = "</div></div></div></div>";

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-profile-enhance-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "";
  let seq = 0;
  const pending = new Map();
  browser.stdio[4].on("data", (chunk) => {
    buf += chunk;
    for (let at; (at = buf.indexOf("\0")) >= 0;) {
      const raw = buf.slice(0, at);
      buf = buf.slice(at + 1);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      const job = pending.get(msg.id);
      if (!job) continue;
      pending.delete(msg.id);
      msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
    }
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await ev(`(() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(CSS)} +
        // 실측(2026-10-20/21) 조상 사슬: body(넘침 숨김) > _glive(clip) > SECTION(transform) >
        // _container_8lqsk_(넘침 숨김) > aside > 팝오버(absolute 또는 fixed, z 1001).
        // transform 이 있으니 fixed 도 화면이 아니라 SECTION 기준으로 선다. SECTION 은 일부러 화면에서 민다.
        ' body{margin:0;overflow:hidden} ._glive{position:fixed;inset:0;overflow:clip}' +
        ' #sec{position:absolute;top:40px;left:30px;right:0;bottom:0;transform:translateX(0)}' +
        ' ._container_8lqsk_1{position:absolute;inset:0;overflow:hidden}' +
        ' aside#aside-chatting{position:absolute;top:0;right:0;width:353px;height:860px;background:#222}' +
        ' aside#aside-chatting [role="alertdialog"]{position:absolute;top:300px;right:10px;width:333px;background:#fff;z-index:1001}' +
        ' html.native-fixed aside#aside-chatting [role="alertdialog"]{position:fixed}' +
        ' ._list_y6scg_60{display:block} ._item_y6scg_70{display:flex;width:100%;height:36px;border:0}';
      document.head.append(style);
      window.__path = '/live/abc';
      window.__stored = [];
      window.chrome = { storage: { local: { set: (v) => window.__stored.push(v) } } };
      const IS_MULTIVIEW_FRAME = false;
      const CHAT_DOM_WATCH_OFF = false;
      const CHAT_BLOCK_ITEM_CLASS = 'cheese-chat-block-item';
      ${sliceFn(content, "isStandaloneChatPopup")}
      ${sliceFn(content, "isChatProfilePopover")}
      ${sliceFn(content, "findChatProfilePopover")}
      ${sliceFn(content, "findChatProfileMenuList")}
      const syncChatProfileBlockButtonFeature = () => {};
      let chatBlockObserver = null;
      let chatProfileBlockButtonOn = false;
      const scheduleChatBlockButton = () => {};
      const disableChatBlockObserver = () => {};
      ${sliceFn(content, "ensureChatBlockObserver")}
      window.observe = ensureChatBlockObserver;
      ${MODULE}
      window.enhance = enhanceChatProfilePopover;
      window.daysText = chatProfileFollowDaysText;
      window.setOpts = (o) => {
        if ('follow' in o) chatProfileFollowDaysOn = o.follow;
        if ('fold' in o) chatProfileMenuFoldOn = o.fold;
        if ('folded' in o) chatProfileMenuFolded = o.folded;
        if ('side' in o) chatProfileSideOn = o.side;
      };
      window.render = (items) => {
        document.body.innerHTML = '<div class="_glive"><section id="sec"><div class="_container_8lqsk_1"><aside id="aside-chatting">' +
          ${JSON.stringify(POPOVER_HEAD)} +
          items.map((label, i) => '<button type="button" class="_item_y6scg_70" id="item' + i + '"><span>' + label + '</span></button>').join('') +
          ${JSON.stringify(POPOVER_TAIL)} + '</aside></div></section></div>';
      };
    })()`);

    // 1) 날짜 계산: 달력 날짜 기준.
    const days = await ev(`[
      daysText('2026년 9월 23일 부터 팔로우', new Date(2026, 9, 20, 0, 30)),
      daysText('2026년 10월 20일 부터 팔로우', new Date(2026, 9, 20, 23, 0)),
      daysText('2026년 10월 19일 부터 팔로우', new Date(2026, 9, 20, 0, 1)),
      daysText('2023년 1월 1일 부터 팔로우', new Date(2026, 9, 20)),
      daysText('2026.09.23 부터 팔로우', new Date(2026, 9, 20)),
      daysText('2026년 2월 31일 부터 팔로우', new Date(2026, 9, 20)),
      daysText('1개월 구독중', new Date(2026, 9, 20)),
    ]`);
    check(days[0] === "27일 전" && days[1] === "오늘" && days[2] === "1일 전" && days[3] === "1,388일 전" &&
      days[4] === "27일 전" && days[5] === "" && days[6] === "",
      `팔로우 'N일 전'은 시각과 무관하게 달력 날짜로 센다(오늘·어제·천 단위·점 표기·없는 날짜) ${JSON.stringify(days)}`);

    await ev(`setOpts({ follow: true, fold: false, side: false }); render(['메시지 상단 고정', '구독권 선물하기', '메시지 신고', '사용자 차단']); enhance()`);
    const follow = await ev(`(() => {
      const el = document.getElementById('follow');
      const marked = [...document.querySelectorAll('[data-cheese-follow-days]')].map((n) => n.id || n.className);
      return { marked, after: getComputedStyle(el, '::after').content, text: el.textContent };
    })()`);
    check(follow.marked.length === 1 && follow.marked[0] === "follow" && /일 전\)"$/.test(follow.after) &&
      follow.text === "1개월 구독중 · 2026년 9월 23일 부터 팔로우",
      `날짜를 품은 가장 안쪽 요소 하나에만 '(N일 전)'을 덧붙이고 치지직 글자는 그대로 ${JSON.stringify(follow)}`);
    await ev(`setOpts({ follow: false }); enhance()`);
    check(await ev(`document.querySelectorAll('[data-cheese-follow-days]').length`) === 0, "끄면 '(N일 전)'을 걷어 낸다");

    // 2) 메뉴 접기.
    const fold = () => ev(`(() => {
      const list = document.getElementById('list');
      const visible = [...list.children].filter((el) => getComputedStyle(el).display !== 'none')
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((el) => el.textContent.trim());
      const toggle = list.querySelector('.cheese-chat-profile-fold-toggle');
      return { visible, expanded: toggle?.getAttribute('aria-expanded') ?? null, toggleClass: toggle?.className ?? null };
    })()`);
    await ev(`setOpts({ fold: true, folded: true }); enhance()`);
    const folded = await fold();
    check(JSON.stringify(folded.visible) === JSON.stringify(["메시지 상단 고정", "기타 기능 3개"]) &&
      folded.expanded === "false" && folded.toggleClass.includes("_item_y6scg_70"),
      `접힘: 관리 기능은 위에 남고 나머지는 '기타 기능 3개' 아래로 접힌다(머리는 치지직 항목 모양) ${JSON.stringify(folded)}`);
    await ev(`document.querySelector('.cheese-chat-profile-fold-toggle').click()`);
    const opened = await fold();
    check(JSON.stringify(opened.visible) === JSON.stringify(["메시지 상단 고정", "기타 기능 3개", "구독권 선물하기", "메시지 신고", "사용자 차단"]) &&
      opened.expanded === "true" && JSON.stringify(await ev("window.__stored")) === JSON.stringify([{ cheeseChatProfileMenuFolded: false }]),
      `머리를 누르면 펼쳐 머리 아래에 차례로 보이고 상태를 저장한다 ${JSON.stringify(opened)}`);
    // 치즈 플래터 차단 버튼이 나중에 붙어도 접히는 쪽으로 간다.
    await ev(`(() => { const b = document.createElement('button'); b.className = '_item_y6scg_70 cheese-chat-block-item';
      b.textContent = '치즈 플래터 차단'; document.getElementById('list').appendChild(b); setOpts({ folded: true }); enhance(); })()`);
    const withBlock = await fold();
    check(JSON.stringify(withBlock.visible) === JSON.stringify(["메시지 상단 고정", "기타 기능 4개"]),
      `나중에 붙은 '치즈 플래터 차단'도 접는다 ${JSON.stringify(withBlock)}`);
    await ev(`enhance(); enhance()`);
    check(await ev(`document.querySelectorAll('.cheese-chat-profile-fold-toggle').length`) === 1, "여러 번 돌아도 머리는 하나");
    // 시청자 팝업처럼 관리 기능이 없어도 머리만 남긴다.
    await ev(`render(['구독권 선물하기', '메시지 신고', '사용자 차단']); enhance()`);
    const viewer = await fold();
    check(JSON.stringify(viewer.visible) === JSON.stringify(["기타 기능 3개"]), `관리 기능이 없는 팝업은 머리만 보인다 ${JSON.stringify(viewer)}`);
    await ev(`setOpts({ fold: false }); enhance()`);
    const off = await ev(`(() => { const list = document.getElementById('list');
      return { toggle: !!list.querySelector('.cheese-chat-profile-fold-toggle'), attrs: list.querySelectorAll('[data-cheese-profile-low]').length + (list.hasAttribute('data-cheese-profile-fold') ? 1 : 0) }; })()`);
    check(!off.toggle && off.attrs === 0, `끄면 머리와 표식을 모두 걷어 낸다 ${JSON.stringify(off)}`);
    // 접을 항목이 없는 팝업은 손대지 않는다.
    await ev(`setOpts({ fold: true }); render(['메시지 상단 고정']); enhance()`);
    check(await ev(`!document.querySelector('.cheese-chat-profile-fold-toggle')`), "접을 항목이 없으면 머리를 만들지 않는다");

    // 3) 채팅창 옆에 띄우기.
    const rect = () => ev(`(() => { const r = document.getElementById('pop').getBoundingClientRect();
      const a = document.getElementById('aside-chatting').getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), asideLeft: Math.round(a.left), asideRight: Math.round(a.right), side: document.getElementById('pop').hasAttribute('data-cheese-profile-side') }; })()`);
    for (const mode of ["absolute", "fixed"]) {
      await ev(`document.documentElement.classList.toggle('native-fixed', ${mode === "fixed"});
        setOpts({ fold: false, side: false }); render(['메시지 신고']); enhance()`);
      const native = await rect();
      await ev(`setOpts({ side: true }); enhance()`);
      const side = await rect();
      const visible = await ev(`(() => { const r = document.getElementById('pop').getBoundingClientRect();
        return document.getElementById('pop').contains(document.elementFromPoint(r.left + 24, r.top + 24)); })()`);
      check(native.left >= native.asideLeft && side.side && side.right === side.asideLeft - 8 && side.top === native.top && visible,
        `옆에 띄우기(치지직 ${mode}, 조상 transform): 기준 상자만큼 보정해 채팅창 왼쪽 바깥 8px 에 보이고 세로는 그대로 ${JSON.stringify({ native, side })}`);
      await ev(`enhance(); enhance()`);
      const again = await rect();
      check(again.left === side.left && again.top === side.top, `다시 돌아도 같은 자리(보정이 쌓이지 않는다) ${JSON.stringify(again)}`);
    }
    await ev(`document.documentElement.classList.remove('native-fixed')`);
    // 실제 흐름: 치지직이 팝오버를 넣으면 옵저버 콜백에서 바로 옮겨, 첫 화면부터 바깥에 있어야 한다.
    const firstFrame = await ev(`new Promise((resolve) => {
      setOpts({ side: true }); render(['메시지 신고']);
      const pop = document.getElementById('pop'); pop.remove();
      observe();
      document.querySelector('aside#aside-chatting').appendChild(pop);
      requestAnimationFrame(() => { const r = pop.getBoundingClientRect();
        resolve({ side: pop.hasAttribute('data-cheese-profile-side'), right: Math.round(r.right),
          asideLeft: Math.round(document.getElementById('aside-chatting').getBoundingClientRect().left) }); });
    })`);
    check(firstFrame.side && firstFrame.right === firstFrame.asideLeft - 8,
      `팝오버가 들어온 첫 화면부터 채팅창 바깥에 있다(원래 자리에 한 번 그려지지 않는다) ${JSON.stringify(firstFrame)}`);
    // 실측(2026-10-21): 치지직은 메뉴만 있는 채로 먼저 띄우고(정보 영역 없음, 높이 152) 약 0.2초 뒤 정보를 채우며
    // 인라인 top 을 다시 잡는다(168 → 436). 메뉴만 있을 때부터 옮기고, 다시 잡은 세로 위치를 따라간다.
    const early = await ev(`new Promise((resolve) => {
      setOpts({ side: true }); render(['구독권 선물하기', '메시지 신고', '사용자 차단']);
      const pop = document.getElementById('pop'); pop.remove();
      const info = pop.querySelector('._information_y6scg_12'); info.remove();
      document.querySelector('aside#aside-chatting').appendChild(pop);
      requestAnimationFrame(() => {
        const first = pop.getBoundingClientRect();
        const out = { side: pop.hasAttribute('data-cheese-profile-side'), right: Math.round(first.right), top: Math.round(first.top),
          asideLeft: Math.round(document.getElementById('aside-chatting').getBoundingClientRect().left) };
        pop.querySelector('#popup_contents').prepend(info);
        pop.style.top = '420px';
        requestAnimationFrame(() => { const r = pop.getBoundingClientRect();
          out.later = { side: pop.hasAttribute('data-cheese-profile-side'), right: Math.round(r.right), top: Math.round(r.top) };
          pop.removeAttribute('data-cheese-profile-side'); out.nativeTop = Math.round(pop.getBoundingClientRect().top);
          resolve(out); });
      });
    })`);
    check(early.side && early.right === early.asideLeft - 8 && early.top === 340,
      `프로필 정보가 오기 전(메뉴만 있을 때)부터 채팅창 바깥에 뜬다 ${JSON.stringify(early)}`);
    check(early.later.side && early.later.right === early.asideLeft - 8 && early.later.top === early.nativeTop && early.nativeTop === 460,
      `치지직이 정보를 채우며 세로 위치를 다시 잡으면 바깥 자리에서 그 높이를 따라간다 ${JSON.stringify(early)}`);
    // 메뉴 문구가 없는 다른 다이얼로그(이모티콘 등)는 옮기지 않는다.
    const other = await ev(`new Promise((resolve) => {
      render(['😀', '😂']);
      const pop = document.getElementById('pop'); pop.remove(); pop.querySelector('._information_y6scg_12').remove();
      document.querySelector('aside#aside-chatting').appendChild(pop);
      requestAnimationFrame(() => resolve(pop.hasAttribute('data-cheese-profile-side')));
    })`);
    check(other === false, "프로필 메뉴 문구가 없는 다른 다이얼로그는 옮기지 않는다");
    // 치지직 팝오버에 위치 전환 효과가 있어도 미끄러져 오지 않는다.
    const slide = await ev(`(() => {
      const style = document.createElement('style'); style.id = 'slide';
      style.textContent = 'aside#aside-chatting [role="alertdialog"]{transition:left 1s, top 1s, right 1s, opacity 1s}';
      document.head.append(style);
      setOpts({ side: false }); render(['메시지 신고']); enhance();
      document.getElementById('pop').getBoundingClientRect();
      setOpts({ side: true }); enhance();
      const r = document.getElementById('pop').getBoundingClientRect();
      const out = { side: document.getElementById('pop').hasAttribute('data-cheese-profile-side'), right: Math.round(r.right),
        asideLeft: Math.round(document.getElementById('aside-chatting').getBoundingClientRect().left),
        transition: getComputedStyle(document.getElementById('pop')).transitionProperty };
      style.remove();
      return out;
    })()`);
    check(slide.side && slide.right === slide.asideLeft - 8 && slide.transition === "opacity",
      `치지직 위치 전환 효과가 있어도 바로 바깥 자리에 선다(나타나는 효과만 남김) ${JSON.stringify(slide)}`);
    await ev(`(() => { document.documentElement.classList.add('cheese-chat-left-position');
      const a = document.getElementById('aside-chatting'); a.style.right = 'auto'; a.style.left = '0px'; enhance(); })()`);
    const leftChat = await rect();
    check(leftChat.side && leftChat.left === leftChat.asideRight + 8,
      `채팅창 왼쪽 배치면 오른쪽 바깥에 띄운다(왼쪽 배치 left:8px 규칙을 이긴다) ${JSON.stringify(leftChat)}`);
    await ev(`(() => { document.documentElement.classList.remove('cheese-chat-left-position');
      const a = document.getElementById('aside-chatting'); a.style.left = ''; a.style.right = '0px'; a.style.width = '1200px'; enhance(); })()`);
    const noRoom = await rect();
    check(!noRoom.side, `옆에 자리가 없으면 원래 자리에 둔다 ${JSON.stringify(noRoom)}`);
    await ev(`document.getElementById('aside-chatting').style.width = ''; window.__path = '/live/abc/chat'; enhance()`);
    check(!(await rect()).side, "독립 채팅 팝업에서는 옮기지 않는다");
    await ev(`window.__path = '/video/123'; enhance()`);
    check(!(await rect()).side, "라이브 화면이 아니면 옮기지 않는다");
    await ev(`window.__path = '/live/abc'; enhance()`);
    check((await rect()).side, "일반 라이브 화면으로 돌아오면 다시 옮긴다");
    // 다른 것이 위를 덮어 보이지 않으면 원래 자리로 돌린다.
    await ev(`(() => { const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647'; cover.id = 'cover'; document.body.append(cover); enhance(); })()`);
    check(!(await rect()).side, "옮긴 자리가 가려 보이지 않으면 원래 자리로 돌린다");
    await ev(`document.getElementById('cover').remove(); setOpts({ side: false }); enhance()`);
    check(!(await rect()).side, "끄면 원래 자리");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // 설정 화면·연결.
  check(['data-chat-profile-follow-days', 'data-chat-profile-menu-fold', 'data-chat-profile-side'].every((attr) => settingsHtml.includes(attr)) &&
    settings.includes('["[data-chat-profile-follow-days]", "cheeseChatProfileFollowDays", false]') &&
    /let chatProfileFollowDaysOn = false;/.test(content) &&
    content.includes("chatProfileFollowDaysOn = data?.[CHAT_PROFILE_FOLLOW_DAYS_KEY] === true;") &&
    content.includes("chatProfileFollowDaysOn = changes[CHAT_PROFILE_FOLLOW_DAYS_KEY].newValue === true;") &&
    settings.includes('["[data-chat-profile-menu-fold]", "cheeseChatProfileMenuFold", false]') &&
    settings.includes('["[data-chat-profile-side]", "cheeseChatProfileSide", false]'),
    "설정: 'N일 전'·메뉴 접기·옆에 띄우기 모두 기본 끔");
  check(["cheeseChatProfileFollowDays", "cheeseChatProfileMenuFold", "cheeseChatProfileMenuFolded", "cheeseChatProfileSide"]
    .every((key) => settings.slice(0, 20000).includes(`"${key}",`)), "설정 백업에 네 키가 들어간다");
  check(/if \(!touchesDialog\) return;\s*scheduleChatBlockButton\(\);[\s\S]{0,200}?if \(chatProfileEnhanceActive\(\)\) enhanceChatProfilePopover\(\);/.test(content),
    "프로필 팝오버 발견은 차단 버튼 옵저버를 함께 쓰고, 다듬기는 그리기 전(옵저버 콜백 안)에 바로 한다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
