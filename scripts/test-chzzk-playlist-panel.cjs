// 치지직 재생목록 패널(content.js '치지직 재생목록 패널'): 재생목록으로 보는 다시보기(/video/{no}?playlistSeq=)에서
// 채팅창 안 재생목록(section[aria-labelledby="vod-play-list-title"])을 숨기고 나만의 재생목록 패널 모양의 떠 있는 패널로 보인다.
//   - 원본이 접혀 있으면 숨긴 채로 한 번 펼쳐 목록·조작을 그리게 한다(원본은 접힌 상태에서 목록이 없다)
//   - 내용은 원본 DOM 을 읽고(이름·현재/전체·다음·연속/랜덤 상태·항목), 누르기는 원본을 대신 누른다
//   - 접으면 재생바(설정으로 끄면 제목+조작 한 줄), 최소화는 사이드바/헤더 버튼(마우스를 올리면 재생바 카드)
//   - ×는 이 재생목록 동안 채팅창 안으로 되돌림 → 원래 자리 제목 옆 '패널로 보기' 버튼으로 다시 띄움, 설정을 끄면 원래대로
// 원본 마크업은 실제 치지직(2026-10) 그대로이고, 치지직(React)이 하던 일(펼치기·누르기·재생 중 표시)은 작은 대역이 한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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
const section = content.slice(start, end);
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
check(/ensureChzzkPlaylistPanel\(\); \/\/ 재생목록으로 보는 다시보기/.test(content) && /"chzzkPlaylistPanel",/.test(content) &&
  /data-feature="chzzkPlaylistPanel"/.test(read("settings.html")), "init 패스마다 맞추고, 설정 '다시보기 재생목록 패널'(기본 켬)");

const ITEMS = [
  { no: 8728539, title: "싱드컵... ㅠㅠ\n림왈디... ㅠㅠ", time: "09:32:29", views: "7,035", date: "2025.08.13" },
  { no: 8821438, title: "어쩔건데너누군데", time: "07:57:02", views: "1,819", date: "2025.08.18", gauge: 99 },
  { no: 10756506, title: "안녕하세요훌뗙", time: "08:09:21", views: "917", date: "2025.12.16" },
];
const blind = (t) => `<span class="blind">${t}</span>`;
const SVG = '<svg width="9" height="10" aria-hidden="true"><path d="M0 0"/></svg>';
const itemHtml = (item, index, playing) =>
  `<li class="_item_y7zpe_130${playing ? " _is_playing_y7zpe_135" : ""}">` +
  (playing ? `<span class="_playing_rr2i6_1">${SVG}${blind("재생 중")}</span>` : `<span class="_index_rr2i6_1">${index + 1}</span>`) +
  `<div class="_container_4ij0q_2 _horizontal_4ij0q_14 _is_play_list_4ij0q_259"><a class="_thumbnail_4ij0q_10" href="/video/${item.no}?playlistSeq=249">` +
  `<img src="https://nng-phinf.pstatic.net/${item.no}.jpg?type=o853x480_blur_j" class="_image_4ij0q_295"><span class="_time_4ij0q_170">${item.time}</span>` +
  (item.gauge ? `<div class="_progress_4ij0q_43"><div class="_guage_4ij0q_46" style="width: ${item.gauge}%;"></div></div>` : "") +
  `${blind("동영상 엔드로 이동")}</a><div class="_wrapper_4ij0q_20"><div class="_area_4ij0q_49"><a class="_title_4ij0q_40" href="/video/${item.no}?playlistSeq=249">${item.title}${blind("동영상 엔드로 이동")}</a>` +
  `<div class="_information_4ij0q_278"><span class="_item_4ij0q_17">${SVG}${blind("조회수")}${item.views}</span><span class="_item_4ij0q_17">${item.date}</span></div></div></div></div></li>`;

// 치지직(React) 대역: 펼치기/접기, 연속·랜덤 재생 토글, 항목 누르면 그 영상을 재생 중으로(주소도 바꾼다).
const FAKE_CHZZK = `
(() => {
  const ITEMS = ${JSON.stringify(ITEMS)};
  const state = { expanded: false, playing: 0, continuous: false, random: false, name: "✧༺♥༻ 이상형 월드컵 ༺♥༻✧" };
  window.__clicked = [];
  const itemHtml = ${itemHtml.toString().replace(/blind\(/g, "B(").replace(/SVG/g, "S")};
  const B = (t) => '<span class="blind">' + t + '</span>';
  const S = '<svg width="9" height="10" aria-hidden="true"><path d="M0 0"/></svg>';
  function render() {
    const sec = document.querySelector('section[aria-labelledby="vod-play-list-title"]');
    const next = state.random ? ITEMS[2] : ITEMS[state.playing + 1];
    sec.className = "_container_y7zpe_2" + (state.expanded ? " _is_expanded_y7zpe_9" : "");
    sec.innerHTML = '<div class="_inner_y7zpe_17"><div class="_header_y7zpe_29"><h2 id="vod-play-list-title" class="_title_y7zpe_35">' +
      (state.expanded ? state.name : "✧༺♥༻ 이상형 월드컵 ༺♥…") + '<span class="_count_y7zpe_44"><span class="_current_y7zpe_63">' + (state.playing + 1) + '</span>/13</span></h2>' +
      '<button type="button" class="_toggle_y7zpe_67" aria-expanded="' + state.expanded + '">' + S + B(state.expanded ? "재생목록 접기" : "재생목록 펼치기") + '</button></div>' +
      '<p class="_description_y7zpe_82">다음: ' + (next ? next.title : "") + '</p>' +
      (state.expanded ? '<div class="_control_y7zpe_104"><button class="_button_y7zpe_112" type="button" aria-pressed="' + state.continuous + '">' + S + B("연속 재생") + '</button>' +
        '<button class="_button_y7zpe_112" type="button" aria-pressed="' + state.random + '">' + S + B("랜덤 재생") + '</button></div>' : "") +
      '</div>' + (state.expanded ? '<ul class="_list_y7zpe_123">' + ITEMS.map((item, i) => itemHtml(item, i, i === state.playing)).join("") + '</ul>' : "");
  }
  document.addEventListener("click", (event) => {
    const sec = event.target.closest?.('section[aria-labelledby="vod-play-list-title"]');
    if (!sec) return;
    const toggle = event.target.closest("button[aria-expanded]");
    const control = event.target.closest("._control_y7zpe_104 button");
    const link = event.target.closest('a[href*="/video/"]');
    if (toggle) { state.expanded = !state.expanded; window.__clicked.push("toggle"); }
    else if (control) { const key = control.textContent.includes("연속") ? "continuous" : "random"; state[key] = !state[key]; window.__clicked.push(key); }
    else if (link) { event.preventDefault(); const no = Number(link.getAttribute("href").match(/video\\/(\\d+)/)[1]); state.playing = ITEMS.findIndex((i) => i.no === no);
      history.pushState({}, "", link.getAttribute("href")); window.__clicked.push(link.getAttribute("href")); }
    else return;
    render();
  });
  window.__fakeRender = render;
  window.__fakeState = state;
})();
`;

const BOOT = `
(() => {
  const L = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const S = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  window.__listeners = [];
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, L("fakeLocal", {})[key] ?? null])),
        set: async (values) => {
          const local = L("fakeLocal", {});
          const changes = {};
          for (const [k, v] of Object.entries(values)) { local[k] = v; changes[k] = { newValue: JSON.parse(JSON.stringify(v)) }; }
          S("fakeLocal", local);
          window.__listeners.forEach((fn) => fn(changes, "local"));
        },
      },
      onChanged: { addListener: (fn) => window.__listeners.push(fn) },
    },
    runtime: { lastError: null, getURL: (f) => "chrome-extension://test/" + f, sendMessage: (m, cb) => setTimeout(() => cb && cb({ ok: true, session: null }), 0) },
  };
  window.__boot = () => {
    const IS_TOP_FRAME = true;
    const IS_POPUP_PLAYER_FRAME = false;
    const featureFlags = { playlist: true, chzzkPlaylistPreview: true, chzzkPlaylistPanel: true };
    window.__flags = featureFlags;
    const CLIP_PAGE_AUTOPLAY_PARAM = "cheesePlatterAutoplay";
    const AD_MARKER_SEL = ".fake-ad";
    const isAdPlaying = () => false;
    const isChzzkDarkTheme = () => document.documentElement.classList.contains("theme_dark");
    const findHeaderInboxButton = () => null;
    const seekVideoToCommentTimestamp = () => {};
    const spaNavigate = () => {};
    const formatSeconds = (s) => String(s);
    const VIDEO_VAULT_PAGE_BUTTON_CLASS = "x"; const CLIP_VAULT_PANEL_ID = "x";
    const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const clipVaultXSvg = () => "";
    const getVideoVaultDetailVideoNo = () => ""; const getVideoVaultDetailButtonContext = () => null;
    const readVideoVaultDetailPageMeta = () => null; const isVideoVaultListPage = () => false; const isClipCardListPage = () => false;
    const videoNoFromHref = () => ""; const clipUidFromHref = () => ""; const videoVaultCardLinks = () => []; const clipVaultCardLinks = () => [];
    const readVideoCardMeta = () => null; const readClipCardMeta = () => null; const clipDetailMeta = (uid) => ({ uid });
    const currentClipDetailUid = () => "";
    ${section}
    window.api = { ensureChzzkPlaylistPanel };
    setInterval(ensureChzzkPlaylistPanel, 150);
    ensureChzzkPlaylistPanel();
  };
})();
`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><style>${read("src/content.css")}</style><script>${read("src/playlistStore.js")}</script></head>` +
    `<body style="margin:0"><nav id="sidebar"><ul class="_list_side_1"><li class="_item_side_2"><a class="_link_side_3" href="/lives"><span class="_icon_side_4"></span><span class="_text_side_5">전체 방송</span></a></li></ul></nav>` +
    `<aside id="vod-aside" style="position:fixed;right:0;top:0;width:360px;height:100vh">` +
    `<section class="_container_y7zpe_2" aria-labelledby="vod-play-list-title"></section><div id="chat">채팅</div></aside>` +
    `<script>${FAKE_CHZZK}window.__fakeRender();</script><script>window.__boot()</script></body></html>`);
});

const dir = mkdtempSync(path.join(tmpdir(), "cheese-chzzk-panel-"));
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
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
      for (let i = 0; i < 80; i++) {
        if (await ev(expression).catch(() => false)) return;
        await wait(50);
      }
      throw new Error(`기다림 실패: ${label} — ${await ev("document.getElementById('cheese-chzzk-playlist-panel')?.textContent || '(패널 없음)'").catch(() => "?")}`);
    };
    const click = (selector) => ev(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return true; })()`);
    await call("Page.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT }, sessionId);
    await call("Page.navigate", { url: `${origin}/video/8728539?playlistSeq=249` }, sessionId);
    await until("!!document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-items')", "패널");

    const first = await ev(`(() => { const p = document.getElementById('cheese-chzzk-playlist-panel'); const r = p.getBoundingClientRect();
      const native = document.querySelector('section[aria-labelledby="vod-play-list-title"]');
      return { clicked: window.__clicked.slice(), nativeShown: getComputedStyle(native).display !== 'none', name: p.querySelector('.cheese-playlist-panel-title strong').textContent,
        pos: p.querySelector('.cheese-playlist-panel-title span').textContent, total: p.querySelector('.cheese-playlist-panel-title small').textContent,
        next: p.querySelector('.cheese-playlist-panel-next').textContent, titles: [...p.querySelectorAll('.cheese-playlist-panel-text b')].map((b) => b.textContent),
        subs: [...p.querySelectorAll('.cheese-playlist-panel-text small')].map((s) => s.textContent), times: [...p.querySelectorAll('.cheese-playlist-panel-duration')].map((s) => s.textContent),
        current: p.querySelector('.is-current .cheese-playlist-panel-text b').textContent, watched: !!p.querySelectorAll('.cheese-playlist-panel-thumb')[1].querySelector('.cheese-playlist-panel-watched'),
        imgs: p.querySelectorAll('.cheese-playlist-panel-thumb').length, right: Math.round(innerWidth - r.right), top: Math.round(r.top) }; })()`);
    if (process.env.PLAYLIST_SHOT) {
      for (const theme of ["light", "dark"]) {
        await ev(`document.documentElement.classList.toggle('theme_dark', ${theme === "dark"}); document.body.style.background = '${theme === "dark" ? "#141517" : "#fff"}'; window.api.ensureChzzkPlaylistPanel(); true`);
        await wait(300);
        const r = await ev("(() => { const b = document.getElementById('cheese-chzzk-playlist-panel').getBoundingClientRect(); return { x: b.left - 10, y: b.top - 10, width: b.width + 20, height: b.height + 20 }; })()");
        const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(process.env.PLAYLIST_SHOT, `chzzk-panel-${theme}.png`), Buffer.from(shot.data, "base64"));
      }
      await ev("document.documentElement.classList.remove('theme_dark'); document.body.style.background = ''; true");
    }
    check(JSON.stringify(first.clicked) === '["toggle"]' && !first.nativeShown,
      `채팅창 안 원본은 숨기고, 접혀 있던 원본은 목록을 그리게 한 번만 펼친다 ${JSON.stringify(first.clicked)}`);
    check(first.name === "✧༺♥༻ 이상형 월드컵 ༺♥༻✧" && first.pos === "1/13" && first.total === "25:38:52" && first.next === "다음: 어쩔건데너누군데",
      `패널 머리: 전체 이름(원본이 접혀 줄인 이름이 아니라)·현재/전체·총 길이·다음 영상 ${JSON.stringify(first)}`);
    check(JSON.stringify(first.titles) === JSON.stringify(["싱드컵... ㅠㅠ 림왈디... ㅠㅠ", "어쩔건데너누군데", "안녕하세요훌뗙"]) &&
      first.subs[0] === "▷ 7,035 · 2025.08.13" && JSON.stringify(first.times) === JSON.stringify(ITEMS.map((i) => i.time)) &&
      first.current === "싱드컵... ㅠㅠ 림왈디... ㅠㅠ" && first.watched && first.imgs === 3,
      "항목: 썸네일·길이·제목·조회수·날짜·본 만큼, 재생 중 항목 표시(원본 그대로)");
    check(first.right === 16 && first.top === 72, `기본 자리는 나만의 재생목록 패널과 같은 오른쪽 위 ${JSON.stringify({ right: first.right, top: first.top })}`);

    // 항목 → 원본 링크를 대신 눌러 치지직이 옮긴다
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"go\"][data-index=\"1\"]");
    await until("document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-title span')?.textContent === '2/13'", "항목 이동");
    check(await ev("window.__clicked.at(-1) === '/video/8821438?playlistSeq=249' && document.querySelector('#cheese-chzzk-playlist-panel .is-current .cheese-playlist-panel-text b').textContent === '어쩔건데너누군데'"),
      "항목을 누르면 원본 링크를 대신 눌러 치지직이 그 영상으로 옮기고, 패널은 원본을 따라 바뀐다");
    // 이전
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"prev\"]");
    await until("document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-title span')?.textContent === '1/13'", "이전");
    check(true, "이전 버튼은 앞 영상으로");
    // 연속·랜덤 재생 → 원본 버튼
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"continuous\"]");
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"random\"]");
    await until("document.querySelector('#cheese-chzzk-playlist-panel [data-pl-panel=\"random\"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#cheese-chzzk-playlist-panel [data-pl-panel=\"continuous\"]')?.getAttribute('aria-pressed') === 'true'", "연속·랜덤");
    check(await ev("window.__fakeState.continuous && window.__fakeState.random && document.querySelector('.cheese-playlist-panel-next').textContent === '다음: 안녕하세요훌뗙'"),
      "연속 재생·랜덤 재생은 치지직 원본 버튼을 눌러 켜고, 상태·다음 영상은 원본을 따른다");
    // 랜덤이면 '다음' 은 치지직이 정한 다음 영상
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"next\"]");
    await until("document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-title span')?.textContent === '3/13'", "랜덤 다음");
    check(true, "랜덤 재생이면 다음 버튼은 치지직이 정한 '다음:' 영상으로 간다");

    // 접으면 재생바(재생 위치·재생/일시정지는 이 화면의 다시보기)
    await ev(`(() => { const v = document.createElement('video'); let t = 120, paused = true; Object.defineProperty(v, 'duration', { value: 3600 });
      Object.defineProperty(v, 'currentTime', { get: () => t, set: (x) => { t = x; } }); Object.defineProperty(v, 'paused', { get: () => paused });
      v.play = () => { paused = false; return Promise.resolve(); }; v.pause = () => { paused = true; }; v.id = 'mainV'; document.body.append(v); return true; })()`);
    await click("#cheese-chzzk-playlist-panel .cheese-playlist-panel-title");
    await until("!!document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-mini') && document.querySelector('#cheese-chzzk-playlist-panel [data-pl-time]')?.textContent === '2:00'", "재생바");
    check(await ev("document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-mini-text b').textContent === '안녕하세요훌뗙' && JSON.parse(localStorage.getItem('fakeLocal')).cheeseChzzkPlaylistPanelCollapsed === true"),
      "접으면 재생바(지금 영상 제목·재생 위치), 접힘은 기억한다");
    await click("#cheese-chzzk-playlist-panel .cheese-playlist-mini [data-pl-panel=\"play\"]");
    check(await ev("document.getElementById('mainV').paused === false"), "재생바의 재생/일시정지는 다시보기 영상을 조작한다");
    await click("#cheese-chzzk-playlist-panel .cheese-playlist-mini [data-pl-panel=\"toggle\"]");
    await until("!!document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-items')", "펼침");

    // 설정 '접은 패널을 재생바로 보기'를 끄면 접은 패널은 제목+조작 한 줄
    await ev("chrome.storage.local.set({ cheeseChzzkPlaylistMiniPlayer: false }); true");
    await click("#cheese-chzzk-playlist-panel .cheese-playlist-panel-title");
    await until("document.getElementById('cheese-chzzk-playlist-panel')?.classList.contains('is-compact') && !document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-mini') && !!document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-controls.is-inline')", "재생바 끔");
    check(true, "설정 '접은 패널을 재생바로 보기'(치지직 재생목록, 따로 저장)를 끄면 접은 패널은 제목과 조작 한 줄");
    await ev("chrome.storage.local.set({ cheeseChzzkPlaylistMiniPlayer: true }); true");
    await click("#cheese-chzzk-playlist-panel .cheese-playlist-panel-title");
    await until("!!document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-items')", "다시 펼침");

    // 최소화 → 설정한 자리(사이드바)의 버튼, 마우스를 올리면 재생바 카드, 누르면 다시 패널
    await ev("chrome.storage.local.set({ cheeseChzzkPlaylistMinimizeTarget: 'sidebar' }); true");
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"minimize\"]");
    await until("!document.getElementById('cheese-chzzk-playlist-panel') && !!document.querySelector('#sidebar #cheese-chzzk-playlist-sidebar-item a')", "최소화");
    const minimized = await ev(`(() => { const li = document.getElementById('cheese-chzzk-playlist-sidebar-item'); const a = li.querySelector('a');
      return { cls: li.className + '|' + a.className, text: a.textContent, label: a.getAttribute('aria-label'), hidden: getComputedStyle(document.querySelector('section[aria-labelledby="vod-play-list-title"]')).display === 'none' }; })()`);
    check(minimized.cls === "_item_side_2|_link_side_3" && minimized.text === "채널 재생목록" && minimized.label.includes("이상형 월드컵") && minimized.hidden,
      `최소화하면 패널 대신 설정한 자리(사이드바 원본 항목 모양)의 버튼, 원본은 계속 숨김 ${JSON.stringify(minimized)}`);
    await ev("document.querySelector('#cheese-chzzk-playlist-sidebar-item a').dispatchEvent(new PointerEvent('pointerenter')); true");
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-mini') && document.querySelector('#cheese-playlist-hover-card [data-pl-time]')?.textContent === '2:00'", "카드");
    check(await ev("document.querySelector('#cheese-playlist-hover-card .cheese-playlist-mini-text b').textContent === '안녕하세요훌뗙' && document.querySelectorAll('#cheese-playlist-hover-card .cheese-playlist-hover-list li').length === 3"),
      "버튼에 마우스를 올리면 재생바 카드(지금 영상·재생 위치) + 펼칠 수 있는 목록");
    await click("#cheese-playlist-hover-card [data-pl-panel=\"hover-list\"]");
    check(await ev("document.querySelector('#cheese-playlist-hover-card .cheese-playlist-hover-list').classList.contains('is-open')"), "카드의 목록 펼치기");
    await click("#cheese-playlist-hover-card [data-pl-panel=\"go\"][data-index=\"0\"]");
    await until("window.__clicked.at(-1) === '/video/8728539?playlistSeq=249' && document.querySelector('#cheese-playlist-hover-card .cheese-playlist-mini-text b')?.textContent.startsWith('싱드컵')", "카드에서 항목");
    check(true, "카드의 항목을 누르면 원본 링크를 대신 눌러 옮기고, 최소화는 그대로");
    await click("#cheese-playlist-hover-card [data-pl-panel=\"restore\"]");
    await until("!!document.querySelector('#cheese-chzzk-playlist-panel .cheese-playlist-panel-items') && !document.getElementById('cheese-chzzk-playlist-sidebar-item') && !document.getElementById('cheese-playlist-hover-card')", "다시 열기");
    check(true, "카드의 '패널 열기'로 다시 패널, 버튼과 카드는 치운다");

    // × → 이 재생목록 동안 채팅창 안으로 되돌린다
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"stop\"]");
    await until("!document.getElementById('cheese-chzzk-playlist-panel') && getComputedStyle(document.querySelector('section[aria-labelledby=\"vod-play-list-title\"]')).display !== 'none'", "되돌리기");
    await wait(400);
    check(await ev("!document.getElementById('cheese-chzzk-playlist-panel')"), "×를 누르면 이 재생목록 동안은 채팅창 안 원래 자리로 되돌린다");
    // 원래 자리 제목 줄(펼치기 버튼 왼쪽)의 '패널로 보기' → 다시 패널
    await until("document.getElementById('cheese-chzzk-playlist-reopen')?.nextElementSibling?.matches('button[aria-expanded]')", "패널로 보기 버튼");
    await click("#cheese-chzzk-playlist-reopen");
    await until("!!document.getElementById('cheese-chzzk-playlist-panel') && !document.getElementById('cheese-chzzk-playlist-reopen') && getComputedStyle(document.querySelector('section[aria-labelledby=\"vod-play-list-title\"]')).display === 'none'", "다시 패널로");
    check(true, "되돌린 뒤에는 원래 자리 제목 옆 '패널로 보기' 버튼으로 다시 떠 있는 패널로 띄운다");
    await click("#cheese-chzzk-playlist-panel [data-pl-panel=\"stop\"]");
    await until("!document.getElementById('cheese-chzzk-playlist-panel')", "다시 되돌리기");
    await ev(`history.pushState({}, '', '/video/8728539?playlistSeq=300'); true`);
    await until("!!document.getElementById('cheese-chzzk-playlist-panel')", "다른 재생목록");
    check(true, "다른 재생목록으로 가면 다시 패널로 분리한다");

    // 설정을 끄면 원래대로, 재생목록이 아닌 다시보기에서는 없음
    await ev("window.__flags.chzzkPlaylistPanel = false; true");
    await until("!document.getElementById('cheese-chzzk-playlist-panel') && !document.documentElement.classList.contains('cheese-chzzk-playlist-detached')", "설정 끔");
    check(true, "설정 '다시보기 재생목록 패널'을 끄면 채팅창 안 원래 재생목록 그대로");
    await ev("window.__flags.chzzkPlaylistPanel = true; history.pushState({}, '', '/video/8728539'); true");
    await wait(400);
    check(await ev("!document.getElementById('cheese-chzzk-playlist-panel')"), "재생목록으로 보는 게 아니면(playlistSeq 없음) 패널을 만들지 않는다");
  } finally {
    server.close();
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
