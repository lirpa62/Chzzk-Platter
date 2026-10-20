// 채널 재생목록 미리보기(content.js '채널 재생목록 미리보기'): 채널 재생목록 탭(/{채널}/play-list)의 재생목록 카드에
// 마우스를 올리면 /service/v1/playlists/{seq} 의 다시보기 목록을 팝오버로 보이고, 항목을 누르면 치지직 재생목록 재생
// (/video/{no}?playlistSeq=)으로 그 영상부터, '내 재생목록으로 복사'는 나만의 재생목록에 새 목록으로 담는다.
// 카드 마크업은 실제 치지직 재생목록 탭(2026-10) 그대로, API 응답은 실측 모양 그대로.
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
assert.ok(start > 0 && end > start, "재생목록 구간을 찾지 못했다");
const section = content.slice(start, end);
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
check(/ensureChzzkPlaylistPreview\(\); \/\/ 채널 재생목록 탭/.test(content) && /"chzzkPlaylistPreview",/.test(content),
  "init 패스에서 한 번 바인딩하고, 설정 기본값은 켬");
const settingsHtml = read("settings.html");
// 재생목록 옵션이 많아 다시보기 탭에서 떼어 바로 아래 '재생목록' 탭으로 옮겼다.
const tabs = [...settingsHtml.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
const playlistGroups = [...settingsHtml.matchAll(/data-panel="playlist"\s+aria-label="([^"]+)"/g)].map((m) => m[1]);
const vodGroups = [...settingsHtml.matchAll(/data-panel="vod"\s+aria-label="([^"]+)"/g)].map((m) => m[1]);
check(tabs[tabs.indexOf("vod") + 1] === "playlist" && playlistGroups.join("|") === "재생목록|나만의 재생목록" &&
  !vodGroups.some((name) => name.includes("재생목록")) && /data-feature="chzzkPlaylistPreview"/.test(settingsHtml),
  `설정: 다시보기 탭 바로 아래 '재생목록' 탭에 '재생목록'(미리보기 켜기/끄기)·'나만의 재생목록' 그룹 ${JSON.stringify({ playlistGroups, vodGroups })}`);
check(/\["playlist", "#openPlaylist"\]/.test(read("src/settingsUi.js")) && !/\["vod", "#openPlaylist"\]/.test(read("src/settingsUi.js")),
  "설정 왼쪽 재생목록 탭 목차 끝에 '재생목록 열기' 바로가기");

const CHANNEL = "32fb866e323242b770cdc790f991a6f6";
const PLAYLIST = {
  code: 200,
  content: {
    playlistSeq: 260,
    name: "✧༺♥༻ ASMR ༺♥༻✧",
    videoCount: 3,
    videos: [
      { videoNo: 12250674, videoTitle: "진짜 잠드시라고 하는 ASMR", thumbnailImageUrl: "https://nng-phinf.pstatic.net/a.jpg?type=o500x280_blur", duration: 7947, readCount: 4503, publishDate: "2026-03-16 01:15:21", watchTimeline: null },
      { videoNo: 12240966, videoTitle: "짧은 ASMR", thumbnailImageUrl: "https://nng-phinf.pstatic.net/b.jpg", duration: 169, readCount: 2126, publishDate: "2026-03-15 16:31:32", watchTimeline: 100 },
      { videoNo: 10943737, videoTitle: "<img src=x onerror=alert(1)> 일진 asmr", thumbnailImageUrl: "javascript:alert(1)", duration: 23899, readCount: 9329, publishDate: "2025-12-28 01:12:39", watchTimeline: null },
    ],
  },
};
const CARD = (seq, title) =>
  `<li class="_item_snf40_1" style="width:320px;display:inline-block;vertical-align:top;margin:20px"><a class="_card_x35it_1" href="/video/8728539?playlistSeq=${seq}">` +
  `<div class="_wrapper_x35it_7"><div class="_thumbnail_x35it_35" style="height:180px;background:#ccc"><span class="_badge_x35it_82"><span class="blind">동영상 </span>13개</span></div></div>` +
  `<strong class="_title_x35it_105">${title}</strong><p class="_update_x35it_120">최근 업데이트됨</p></a></li>`;

const BOOT = `
(() => {
  const L = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const S = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  window.__listeners = [];
  window.__spa = [];
  window.__fetches = [];
  window.fetch = async (url) => {
    window.__fetches.push(String(url));
    const seq = String(url).match(/playlists\\/(\\d+)$/)?.[1];
    if (seq === "260") return { ok: true, json: async () => (${JSON.stringify(PLAYLIST)}) };
    return { ok: false, json: async () => null };
  };
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
    const featureFlags = { playlist: true, chzzkPlaylistPreview: true };
    window.__flags = featureFlags;
    const CLIP_PAGE_AUTOPLAY_PARAM = "cheesePlatterAutoplay";
    const AD_MARKER_SEL = ".fake-ad";
    const isAdPlaying = () => false;
    const isChzzkDarkTheme = () => document.documentElement.classList.contains("theme_dark");
    const findHeaderInboxButton = () => null;
    const seekVideoToCommentTimestamp = () => {};
    const spaNavigate = (href) => window.__spa.push(href);
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
    window.api = { ensureChzzkPlaylistPreview };
    ensureChzzkPlaylistPreview();
  };
})();
`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta property="og:title" content="치즈 채널 - CHZZK"><style>${read("src/content.css")}</style>` +
    `<script>${read("src/playlistStore.js")}</script></head><body style="margin:0">` +
    `<ul style="list-style:none;padding:0;margin:0;width:1200px">${CARD(260, "✧༺♥༻ ASMR ༺♥༻✧")}${CARD(999, "불러오기 실패 목록")}</ul>` +
    `<p id="plain" style="margin:40px">아무것도 아닌 곳</p><script>window.__boot()</script></body></html>`);
});

const dir = mkdtempSync(path.join(tmpdir(), "cheese-chzzk-playlist-"));
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
      throw new Error(`기다림 실패: ${label}`);
    };
    const mouse = (type, x, y, buttons = 0) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 }, sessionId);
    await call("Page.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT }, sessionId);
    await call("Page.navigate", { url: `${origin}/${CHANNEL}/play-list` }, sessionId);
    await until("!!window.api", "준비");
    const cardBox = (i) => ev(`(() => { const r = document.querySelectorAll('a[href*="playlistSeq="]')[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60, right: r.right, top: r.top }; })()`);

    // 올리자마자는 안 뜨고(잠깐 머물러야), 머물면 목록 팝오버
    const c0 = await cardBox(0);
    await mouse("mouseMoved", c0.x, c0.y);
    await wait(120);
    check(await ev("!document.getElementById('cheese-chzzk-playlist-popover')"), "카드를 스치기만 하면 띄우지 않는다(잠깐 머물러야)");
    await until("document.querySelectorAll('#cheese-chzzk-playlist-popover [data-chzzk-playlist=\"go\"]').length === 3", "목록 팝오버");
    const pop = await ev(`(() => { const p = document.getElementById('cheese-chzzk-playlist-popover'); const r = p.getBoundingClientRect();
      return { name: p.querySelector('.cheese-chzzk-playlist-head strong').textContent, meta: p.querySelector('.cheese-chzzk-playlist-head small').textContent,
        titles: [...p.querySelectorAll('.cheese-chzzk-playlist-text b')].map((b) => b.textContent),
        info: p.querySelector('.cheese-chzzk-playlist-text small').textContent, durations: [...p.querySelectorAll('.cheese-chzzk-playlist-thumb span')].map((s) => s.textContent),
        imgs: p.querySelectorAll('.cheese-chzzk-playlist-thumb img').length, injected: !!p.querySelector('img[src="x"]'), watched: !!p.querySelectorAll('.cheese-chzzk-playlist-thumb')[1].querySelector('i'),
        left: Math.round(r.left), top: Math.round(r.top), fetches: window.__fetches.length }; })()`);
    check(pop.name === "✧༺♥༻ ASMR ༺♥༻✧" && pop.meta === "3개 · 총 8:53:35" && pop.titles.length === 3 && pop.info === "조회수 4,503회 · 2026.03.16" &&
      JSON.stringify(pop.durations) === JSON.stringify(["2:12:27", "2:49", "6:38:19"]) && pop.watched,
      `카드에 머물면 그 재생목록의 다시보기 목록(썸네일·길이·제목·조회수·날짜·본 만큼)을 보인다 ${JSON.stringify(pop)}`);
    check(pop.imgs === 2 && !pop.injected && pop.titles[2].startsWith("<img"), "제목은 글자로만, https 가 아닌 썸네일은 버린다");
    check(pop.left >= c0.right && pop.top === Math.round(c0.top), `카드 오른쪽, 카드 위쪽에 맞춰 붙인다 ${JSON.stringify({ left: pop.left, top: pop.top, card: c0 })}`);

    // 카드에서 팝오버로 옮겨 가도 남고, 항목을 누르면 치지직 재생목록 재생으로 그 영상부터
    const item = await ev("(() => { const r = document.querySelectorAll('#cheese-chzzk-playlist-popover [data-chzzk-playlist=\"go\"]')[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await mouse("mouseMoved", c0.right - 2, c0.y);
    await mouse("mouseMoved", item.x, item.y);
    await wait(350);
    check(await ev("!!document.getElementById('cheese-chzzk-playlist-popover')"), "카드에서 팝오버로 옮겨 가도 팝오버는 남는다");
    await mouse("mousePressed", item.x, item.y, 1);
    await mouse("mouseReleased", item.x, item.y, 0);
    await until("window.__spa.length === 1", "항목 재생");
    check(await ev("window.__spa[0] === '/video/12240966?playlistSeq=260' && !document.getElementById('cheese-chzzk-playlist-popover')"),
      "항목을 누르면 치지직 재생목록 재생(/video/{no}?playlistSeq=)으로 그 영상부터, 팝오버는 닫는다");

    // 다시 올리면 받아 둔 목록으로(다시 묻지 않음), 처음부터 재생·내 재생목록으로 복사
    await mouse("mouseMoved", 700, 800);
    await mouse("mouseMoved", c0.x, c0.y);
    await until("!!document.querySelector('#cheese-chzzk-playlist-popover [data-chzzk-playlist=\"copy\"]')", "다시 열기");
    check(await ev("window.__fetches.length") === 1, "한 번 받은 재생목록은 다시 묻지 않는다");
    await ev("document.querySelector('#cheese-chzzk-playlist-popover [data-chzzk-playlist=\"copy\"]').click(); true");
    await until("(JSON.parse(localStorage.getItem('fakeLocal') || '{}').cheesePlaylists?.lists || []).length === 1", "복사");
    const copied = await ev("JSON.parse(localStorage.getItem('fakeLocal')).cheesePlaylists.lists[0]");
    check(copied.name === "✧༺♥༻ ASMR ༺♥༻✧" && copied.items.length === 3 && copied.items.map((i) => i.videoNo).join() === "12250674,12240966,10943737" &&
      copied.items[0].title === "진짜 잠드시라고 하는 ASMR" && copied.items[0].duration === 7947 && copied.items[0].channelId === CHANNEL &&
      copied.items[0].channelName === "치즈 채널" && copied.items[2].thumb === "",
      `'내 재생목록으로 복사'는 같은 이름의 나만의 재생목록을 만들어 영상들을 담는다(채널 정보 포함) ${JSON.stringify(copied.items[0])}`);
    check(await ev("document.getElementById('cheese-playlist-toast')?.textContent.includes('3개를 담았습니다') && document.querySelector('[data-chzzk-playlist=\"copy\"]').textContent === '복사함'"),
      "복사하면 알림과 함께 버튼이 '복사함'으로 바뀐다");
    await ev("document.querySelector('#cheese-chzzk-playlist-popover [data-chzzk-playlist=\"play\"]').click(); true");
    check(await ev("window.__spa.at(-1) === '/video/12250674?playlistSeq=260'"), "'처음부터 재생'은 첫 영상부터 치지직 재생목록 재생");

    // 못 받으면 안내, 벗어나면 닫힘, Esc
    const c1 = await cardBox(1);
    await mouse("mouseMoved", c1.x, c1.y);
    await until("document.querySelector('#cheese-chzzk-playlist-popover .cheese-chzzk-playlist-status')?.textContent === '목록을 불러오지 못했습니다.'", "실패 안내");
    check(true, "목록을 못 받으면 안내한다");
    await mouse("mouseMoved", 700, 800);
    await until("!document.getElementById('cheese-chzzk-playlist-popover')", "벗어나 닫힘");
    check(true, "카드·팝오버 밖으로 나가면 닫힌다");
    await mouse("mouseMoved", c0.x, c0.y);
    await until("!!document.getElementById('cheese-chzzk-playlist-popover')", "다시");
    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
    check(await ev("!document.getElementById('cheese-chzzk-playlist-popover')"), "Esc 로 닫는다");

    // 설정을 끄면 안 뜬다
    await mouse("mouseMoved", 700, 800);
    await ev("window.__flags.chzzkPlaylistPreview = false; true");
    await mouse("mouseMoved", c0.x, c0.y);
    await wait(700);
    check(await ev("!document.getElementById('cheese-chzzk-playlist-popover')"), "설정 '채널 재생목록 미리보기'를 끄면 띄우지 않는다");
    await ev("window.__flags.chzzkPlaylistPreview = true; true");

    // 재생목록 탭이 아닌 곳(다시보기 화면의 재생목록 링크 등)에서는 안 뜬다
    await mouse("mouseMoved", 700, 800);
    await ev(`history.pushState({}, '', '/video/8728539?playlistSeq=260'); true`);
    await mouse("mouseMoved", c0.x, c0.y);
    await wait(700);
    check(await ev("!document.getElementById('cheese-chzzk-playlist-popover')"), "채널 재생목록 탭이 아니면 띄우지 않는다");
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
