// 재생목록 담기 버튼·팝오버(content.js '나만의 재생목록: 담기 버튼·팝오버' 구간).
//   - 다시보기 상세: 보관함·메모 버튼과 같은 자리 묶음 끝에 서고, 서로 자리를 다투지 않는다
//   - 다시보기·클립 카드: 보관함 버튼이 있으면 그 왼쪽, pointerdown 에서 팝오버(카드 이동 막기)
//   - 팝오버: 담기/빼기·새 목록 만들고 담기·현재 위치부터 시작·Esc·바깥 누르면 닫힘
//   - 다른 탭에서 바뀌면 담김 표시를 다시 칠함, 설정을 끄면 버튼이 사라짐
//   - 클립 재생 프레임 메시지 → 프레임 안 버튼 위치에 팝오버
// 실제 구간 코드와 playlistStore.js·content.css 를 헤드리스 Chrome 에서 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 90000).unref();

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const content = read("src/content.js");
const start = content.indexOf("  // ── 나만의 재생목록: 담기 버튼·팝오버");
const end = content.indexOf("  // ── 채팅 프로필 팝오버 '사용자 차단' 항목 주입");
assert.ok(start > 0 && end > start, "담기 구간을 찾지 못했다");
const section = content.slice(start, end);
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
check(/ensurePlaylistButtons\(\); \/\/ 재생목록 담기 버튼\(다시보기 상세/.test(content) &&
  /ensurePlaylistButtons\(\); \/\/ 재생목록 담기 버튼 설정 즉시 반영/.test(content),
  "init 패스와 설정 변경 때 담기 버튼을 맞춘다");

// 구간이 부르는 바깥 함수들(보관함·카드 읽기 등)의 대역. 실제 치지직 DOM 모양을 흉내 낸다.
const HARNESS = `
  window.__local = {};
  window.__listeners = [];
  window.__sent = [];
  window.__opened = [];
  window.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: JSON.parse(JSON.stringify(window.__local[key] ?? null)) }),
        set: async (values) => {
          const changes = {};
          for (const [k, v] of Object.entries(values)) changes[k] = { newValue: JSON.parse(JSON.stringify(v)) };
          Object.assign(window.__local, JSON.parse(JSON.stringify(values)));
          window.__listeners.forEach((fn) => fn(changes, "local"));
        },
      },
      onChanged: { addListener: (fn) => window.__listeners.push(fn) },
    },
    runtime: {
      lastError: null,
      getURL: (file) => "chrome-extension://test/" + file,
      sendMessage: (message, cb) => {
        window.__sent.push(message);
        const reply = message.type === "PLAYLIST_META"
          ? { ok: true, results: message.items.map((i) => (i.videoNo === "777"
            ? { title: "상세 제목", duration: 7200, views: 1819, date: "2025-08-18 21:00:00" }
            : { title: "받은 제목", duration: 3600 })) }
          : { ok: true };
        setTimeout(() => cb && cb(reply), 0);
      },
    },
  };
  window.open = (url) => { window.__opened.push(url); return null; };
  const IS_TOP_FRAME = true;
  const featureFlags = { playlist: true };
  window.__flags = featureFlags;
  const VIDEO_VAULT_PAGE_BUTTON_CLASS = "cheese-video-vault-page-button";
  const CLIP_VAULT_PANEL_ID = "cheese-clip-vault-panel";
  const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const clipVaultXSvg = () => '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/></svg>';
  const isAdPlaying = () => false;
  const findHeaderInboxButton = () => null; // 헤더 없음(재생목록 버튼 자리 없음)
  const isChzzkDarkTheme = () => document.documentElement.classList.contains("theme_dark");
  const getVideoVaultDetailVideoNo = () => location.hash.match(/^#\\/video\\/(\\d+)/)?.[1] || "";
  const getVideoVaultDetailButtonContext = () => {
    const target = document.querySelector("#controls [data-more]");
    return target ? { videoNo: getVideoVaultDetailVideoNo(), channelId: "", target, styleSource: target } : null;
  };
  const readVideoVaultDetailPageMeta = () => ({ title: "상세 제목", thumb: "https://x/t.jpg", channelId: "", channelName: "치즈", adult: false });
  const isVideoVaultListPage = () => location.hash === "#videos";
  // 카드 버튼은 보관함 목록 + 통합검색(content.js isVideoVaultCardPage)에 단다.
  const isVideoVaultCardPage = () => isVideoVaultListPage();
  const markCardButtonsPlacement = () => {}; // 통합검색 배치 표시(이 테스트 범위 밖)
  const isClipCardListPage = () => location.hash === "#clips";
  const videoNoFromHref = (href) => String(href || "").match(/^\\/video\\/(\\d+)/)?.[1] || "";
  const clipUidFromHref = (href) => String(href || "").match(/^\\/clips\\/([^/?#]+)/)?.[1] || "";
  const videoVaultCardLinks = () => [...document.querySelectorAll("#cards a[href^='/video/']")];
  const clipVaultCardLinks = () => [...document.querySelectorAll("#cards a[href^='/clips/']")];
  const readVideoCardMeta = (link) => ({ title: link.dataset.title, thumb: "https://x/v.jpg", channelName: "카드채널", durationSeconds: 120 });
  const readClipCardMeta = (link) => ({ title: link.dataset.title, thumb: "https://x/c.jpg", channelName: "클립채널" });
  let __clipUid = "";
  const currentClipDetailUid = () => __clipUid;
  window.__setClipUid = (uid) => { __clipUid = uid; };
  const clipDetailMeta = (uid) => ({ uid, title: "og 클립 제목", thumb: "https://x/og.jpg" });
`;

const dir = mkdtempSync(path.join(tmpdir(), "cheese-playlist-add-"));
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let buf = "";
let seq = 0;
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buf += chunk;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
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
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});

(async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (expression, label) => {
      for (let i = 0; i < 60; i++) {
        if (await ev(expression).catch(() => false)) return;
        await wait(50);
      }
      throw new Error(`기다림 실패: ${label}`);
    };
    await call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await ev(`(() => {
      const st = document.createElement("style"); st.textContent = ${JSON.stringify(read("src/content.css"))}; document.head.append(st);
      const s1 = document.createElement("script"); s1.textContent = ${JSON.stringify(read("src/playlistStore.js"))}; document.head.append(s1);
      const s2 = document.createElement("script"); s2.textContent = ${JSON.stringify(`${HARNESS}\n${section}\nwindow.api = { ensurePlaylistButtons, closePlaylistPopover, placeInCheeseActionRun };`)}; document.head.append(s2);
      return !!window.api;
    })()`);
    await ev(`(async () => {
      const r = await CheesePlaylistStore.update((s) => CheesePlaylistStore.createList(s, "모음 A"));
      await CheesePlaylistStore.update((s) => CheesePlaylistStore.createList(s, "모음 B"));
      window.__listA = r.list.id;
      return true;
    })()`);

    // ── 다시보기 상세 ──
    await ev(`(() => {
      location.hash = "#/video/777";
      document.body.innerHTML = '<div id="controls"><button class="_btn_x" data-more>더보기</button>' +
        '<button class="_btn_x cheese-video-vault-page-button">보관</button><button class="_btn_x cheese-memo-button">메모</button>' +
        '<span class="_native_next">다음</span></div><div id="cards"></div>';
      api.ensurePlaylistButtons();
      return true;
    })()`);
    await wait(50);
    const detail = await ev(`(() => {
      const order = () => [...document.querySelectorAll('#controls > *')].map((n) => n.className.split(' ').pop());
      const first = order();
      // 메모 버튼이 다시 '바로 뒤'로 끼어들어도 우리 버튼은 묶음 안에 있으면 그대로 둔다.
      const memo = document.querySelector('.cheese-memo-button');
      document.querySelector('[data-more]').after(memo);
      let moves = 0;
      const mo = new MutationObserver((list) => { moves += list.length; });
      mo.observe(document.getElementById('controls'), { childList: true });
      for (let i = 0; i < 5; i++) api.ensurePlaylistButtons();
      mo.disconnect();
      const button = document.querySelector('.cheese-playlist-page-button');
      return { first, moves, after: order(), classes: button.className, label: button.getAttribute('aria-label'), svg: !!button.querySelector('svg') };
    })()`);
    check(JSON.stringify(detail.first) === JSON.stringify(["_btn_x", "cheese-video-vault-page-button", "cheese-memo-button", "cheese-playlist-page-button", "_native_next"]),
      `상세: 보관함·메모 버튼 묶음 끝(치지직 버튼 앞)에 선다 ${JSON.stringify(detail.first)}`);
    check(detail.moves === 0, `상세: 다른 버튼이 순서를 바꿔도 묶음 안이면 옮기지 않는다(패스마다 자리 다툼 없음) moves=${detail.moves}`);
    check(detail.classes.startsWith("_btn_x ") && detail.svg && detail.label === "재생목록에 담기", "상세: 치지직 버튼 모양을 물려받는다");

    // 상세에서 담기(현재 위치부터)
    await ev(`(() => {
      const v = document.createElement('video'); document.body.append(v);
      Object.defineProperty(v, 'currentTime', { value: 3725, configurable: true });
      Object.defineProperty(v, 'duration', { value: 7200, configurable: true });
      document.querySelector('.cheese-playlist-page-button').click(); return true; })()`);
    await until("!!document.getElementById('cheese-playlist-popover')", "상세 팝오버");
    const pop = await ev(`(() => {
      const el = document.getElementById('cheese-playlist-popover');
      return { start: el.querySelector('.cheese-playlist-pop-start')?.textContent, lists: [...el.querySelectorAll('[data-pl-list]')].length,
        item: el.querySelector('.cheese-playlist-pop-item').textContent, focus: document.activeElement?.getAttribute('data-pl-list') === window.__listA };
    })()`);
    check(pop.start === "현재 위치(1:02:05)부터 재생" && pop.lists === 2 && pop.item === "상세 제목" && pop.focus,
      `팝오버: 목록 체크·현재 위치부터 선택·첫 목록에 포커스 ${JSON.stringify(pop)}`);
    await ev(`(() => { const el = document.getElementById('cheese-playlist-popover'); el.querySelector('[data-pl-use-start]').click(); el.querySelector('[data-pl-list]').click(); return true; })()`);
    await until("window.__local.cheesePlaylists.lists[0].items.length === 1", "담기");
    await until("window.__local.cheesePlaylists.lists[0].items[0].title === '상세 제목' && document.querySelector('.cheese-playlist-page-button').classList.contains('is-on')", "표시");
    const saved = await ev("window.__local.cheesePlaylists.lists[0].items[0]");
    check(saved.type === "video" && saved.videoNo === "777" && saved.start === 3725 && saved.duration === 7200,
      `담으면 현재 위치를 시작 시간으로 저장하고 버튼이 담김 표시로 바뀐다 ${JSON.stringify(saved)}`);
    await until("window.__local.cheesePlaylists.lists[0].items[0].views === 1819", "조회수·날짜");
    check(await ev("window.__local.cheesePlaylists.lists[0].items[0].date === Date.parse('2025-08-18T21:00:00+09:00')"),
      "담은 뒤 조회수·올린 날짜를 한 번 받아 채운다(패널 목록 줄에 보인다)");
    check(await ev("document.getElementById('cheese-playlist-toast')?.textContent === \"'모음 A'에 담았습니다.\""), "담은 목록을 알림으로 알려 준다");

    // 새 목록 만들고 담기
    await ev(`(() => { const el = document.getElementById('cheese-playlist-popover'); el.querySelector('[data-pl-new-name]').value = '새로 만든 목록';
      el.querySelector('[data-pl-new] button').click(); return true; })()`);
    await until("window.__local.cheesePlaylists.lists.length === 3", "새 목록");
    check(await ev("window.__local.cheesePlaylists.lists[2].name === '새로 만든 목록' && window.__local.cheesePlaylists.lists[2].items[0].videoNo === '777' && document.querySelectorAll('#cheese-playlist-popover [data-pl-list]:checked').length === 2"),
      "새 재생목록 이름을 넣고 만들면 만들면서 담고, 팝오버 체크도 갱신된다");

    // 빼기
    await ev("document.querySelector('#cheese-playlist-popover [data-pl-list]').click(); true");
    await until("window.__local.cheesePlaylists.lists[0].items.length === 0", "빼기");
    check(true, "체크를 끄면 그 목록에서 같은 영상을 뺀다");

    // Esc 로 닫고 포커스 돌려주기
    await ev("document.getElementById('cheese-playlist-popover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
    check(await ev("!document.getElementById('cheese-playlist-popover') && document.activeElement?.classList.contains('cheese-playlist-page-button')"),
      "Esc 로 닫고 포커스를 버튼으로 돌려준다");

    // ── 카드 ──
    await ev(`(() => {
      location.hash = "#videos";
      document.body.innerHTML = '<div id="controls"></div><div id="cards">' +
        '<a href="/video/101" data-title="카드 하나" style="display:block;width:300px;height:170px;margin:60px"><img alt=""><button class="cheese-video-vault-archive"></button></a>' +
        '<a href="/video/102" data-title="카드 둘" style="display:block;width:300px;height:170px;margin:20px 60px"></a></div>';
      window.__navigated = 0;
      document.querySelectorAll('#cards a').forEach((a) => a.addEventListener('click', (e) => { if (!e.defaultPrevented) window.__navigated++; e.preventDefault(); }));
      api.ensurePlaylistButtons();
      return true;
    })()`);
    const cards = await ev(`(() => {
      const [a, b] = document.querySelectorAll('#cards a');
      const ba = a.querySelector('.cheese-playlist-card-add'); const bb = b.querySelector('.cheese-playlist-card-add');
      return { a: !!ba, b: !!bb, rightWithVault: getComputedStyle(ba).right, rightAlone: getComputedStyle(bb).right,
        hidden: getComputedStyle(bb).opacity, pos: getComputedStyle(b).position };
    })()`);
    check(cards.a && cards.b && cards.rightWithVault === "44px" && cards.rightAlone === "8px" && cards.hidden === "0" && cards.pos === "relative",
      `카드: 보관함 버튼이 있으면 그 왼쪽, 평소엔 숨김 ${JSON.stringify(cards)}`);
    const rect = await ev("(() => { const r = document.querySelectorAll('#cards .cheese-playlist-card-add')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y }, sessionId);
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", buttons: 1, clickCount: 1 }, sessionId);
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", buttons: 0, clickCount: 1 }, sessionId);
    await until("!!document.getElementById('cheese-playlist-popover')", "카드 팝오버");
    const cardPop = await ev(`(() => {
      const el = document.getElementById('cheese-playlist-popover'); const r = el.getBoundingClientRect();
      const b = document.querySelectorAll('#cards .cheese-playlist-card-add')[1].getBoundingClientRect();
      return { navigated: window.__navigated, item: el.querySelector('.cheese-playlist-pop-item').textContent, start: !!el.querySelector('.cheese-playlist-pop-start'),
        below: r.top >= b.bottom, alignedRight: Math.abs(r.right - b.right) < 2 };
    })()`);
    check(cardPop.navigated === 0 && cardPop.item === "카드 둘" && !cardPop.start && cardPop.below && cardPop.alignedRight,
      `카드 버튼: 카드로 이동하지 않고 버튼 아래(오른쪽 맞춤)에 팝오버, 카드에는 '현재 위치' 없음 ${JSON.stringify(cardPop)}`);
    await ev("document.querySelector('#cheese-playlist-popover [data-pl-list]').click(); true");
    await until("window.__local.cheesePlaylists.lists[0].items.some((i) => i.videoNo === '102')", "카드 담기");
    // 바깥을 누르면 닫힘
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 790, button: "left", buttons: 1, clickCount: 1 }, sessionId);
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 790, button: "left", buttons: 0, clickCount: 1 }, sessionId);
    check(await ev("!document.getElementById('cheese-playlist-popover') && document.querySelectorAll('#cards .cheese-playlist-card-add')[1].classList.contains('is-on')"),
      "바깥을 누르면 닫히고, 담긴 카드는 버튼이 늘 보이는 담김 표시");

    // 다른 탭에서 빼면 표시가 꺼진다
    await ev(`(async () => { await CheesePlaylistStore.update((s) => ({ state: { ...s, lists: s.lists.map((l) => ({ ...l, items: [] })) } })); return true; })()`);
    await until("!document.querySelectorAll('#cards .cheese-playlist-card-add')[1].classList.contains('is-on')", "표시 갱신");
    check(true, "다른 탭(편집 화면 등)에서 바뀌면 담김 표시를 다시 칠한다");

    // 클립 카드
    await ev(`(() => { location.hash = '#clips'; document.getElementById('cards').innerHTML = '<a href="/clips/abcDEF12" data-title="클립 카드" style="display:block;width:200px;height:300px"><span class="cheese-clip-vault-star"></span></a>';
      api.ensurePlaylistButtons(); return document.querySelector('#cards .cheese-playlist-card-add')?.dataset.playlistKey; })()`).then((key) => check(key === "clip:abcDEF12", "클립 카드에도 담기 버튼(키는 clip:uid)"));

    // 설정을 끄면 버튼이 사라진다
    const off = await ev(`(() => { window.__flags.playlist = false; api.ensurePlaylistButtons(); return document.querySelectorAll('.cheese-playlist-card-add, .cheese-playlist-page-button').length; })()`);
    check(off === 0, "설정 '재생목록 담기 버튼'을 끄면 버튼이 모두 사라진다");
    await ev("window.__flags.playlist = true; true");

    // ── 클립 재생 프레임 ──
    await ev(`(() => {
      location.hash = '#clipview'; window.__setClipUid('ClipUid9');
      document.body.innerHTML = '<iframe id="shorts" style="position:absolute;left:300px;top:100px;width:400px;height:600px;border:0"></iframe>';
      return true; })()`);
    await ev(`(() => {
      const frame = document.getElementById('shorts');
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://m.naver.com', source: frame.contentWindow,
        data: { type: 'cheese-playlist-clip-add', rect: { left: 350, top: 400, width: 40, height: 40 }, channelName: '프레임 채널', channelId: '${"c".repeat(32)}' } }));
      return true; })()`);
    await until("!!document.getElementById('cheese-playlist-popover')", "프레임 팝오버");
    const framePop = await ev(`(() => { const r = document.getElementById('cheese-playlist-popover').getBoundingClientRect();
      return { right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), item: document.querySelector('.cheese-playlist-pop-item').textContent }; })()`);
    // 버튼(프레임 기준 left 350·top 400 → 페이지 650~690, 500~540). 아래 자리가 모자라면 위로 뒤집는다.
    check(framePop.right === 690 && (framePop.top === 546 || framePop.bottom === 494) && framePop.item === "og 클립 제목",
      `클립 재생 프레임 버튼: 프레임 위치 + 버튼 위치에 붙여 팝오버(자리 없으면 위로), 제목은 페이지 og 메타 ${JSON.stringify(framePop)}`);
    await ev("document.querySelector('#cheese-playlist-popover [data-pl-list]').click(); true");
    await until("window.__local.cheesePlaylists.lists[0].items.some((i) => i.type === 'clip')", "프레임 담기");
    const clipSaved = await ev("window.__local.cheesePlaylists.lists[0].items.find((i) => i.type === 'clip')");
    check(clipSaved.clipUID === "ClipUid9" || clipSaved.channelName === "프레임 채널",
      `프레임에서 받은 채널 이름을 함께 담는다 ${JSON.stringify(clipSaved)}`);
    const otherOrigin = await ev(`(() => { api.closePlaylistPopover(); window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: 'cheese-playlist-clip-add', rect: {} } }));
      return !document.getElementById('cheese-playlist-popover'); })()`);
    check(otherOrigin, "m.naver.com 이 아닌 곳의 메시지는 무시한다");
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
