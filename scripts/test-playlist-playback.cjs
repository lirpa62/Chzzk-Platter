// 재생목록 재생(content.js '나만의 재생목록: 재생' 구간): 배경이 들고 있는 탭 세션을 읽어 패널을 띄우고,
// 지금 항목이 끝나면 다음으로 옮긴다.
//   - 본 영상 ended 만(짧은 미리보기·광고 제외), 클립은 m.naver.com 프레임의 끝 알림
//   - 다시보기→다시보기는 SPA, 클립이 끼면 전체 이동(클립은 자동재생 요청 붙임)
//   - 시작 시간이 안 먹었으면 한 번만 옮김, 마지막이면 끝 안내(반복이면 처음으로)
//   - 목록 밖 영상으로 가면 일시정지 + 돌아가기, 목록 안 다른 항목으로 가면 따라감
//   - 패널 닫기 = 세션 끝, 재생하던 목록을 지우면 패널도 사라짐
// 로컬 HTTP 서버가 어느 경로든 같은 빈 화면을 주고, 문서마다 구간 코드를 다시 실어 전체 이동까지 재현한다.
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
}, 120000).unref();

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
check(/ensurePlaylistPlayback\(\); \/\/ 재생목록 재생 중인 탭/.test(content), "init 패스마다 재생 세션을 맞춘다");
const background = read("src/background.js");
const settingsSource = read("src/settings.js");
check(/function bindPlaylistTarget[\s\S]{0,400}button\.classList\.toggle\("is-active", on\)/.test(settingsSource) &&
  /bindPlaylistTarget\("\[data-playlist-library-target\]"/.test(settingsSource) && /bindPlaylistTarget\("\[data-playlist-minimize-target\]"/.test(settingsSource),
  "설정: 재생목록 버튼 위치·패널 최소화 버튼 위치를 따로 두고, 고른 쪽에 선택 표시(.is-active)를 단다");
check(/const order = shuffle \? items\.map/.test(background) && /typeof patch\.shuffle === "boolean"/.test(background) &&
  /patch\.order\.every\(\(id\) => typeof id === "string" && \/\^\[a-z0-9\]\{6,32\}\$\/\.test\(id\)\)/.test(background),
  "배경: 섞어서 재생은 순서를 섞어 첫 항목부터, 세션의 섞은 순서는 모양을 확인하고 받는다");
check(/clips\/\$\{item\.clipUID\}\?cheesePlatterAutoplay=1/.test(background) && /chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{\n  void mutatePlaylistSessions/.test(background),
  "배경: 클립은 자동재생 요청을 붙여 열고, 탭이 닫히면 세션을 지운다");

// 문서마다 다시 싣는 대역 + 구간. 저장소·배경 세션은 localStorage 에 두어 전체 이동 뒤에도 남는다.
const BOOT = `
(() => {
  const L = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const S = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  window.__listeners = [];
  window.__spa = L("__spa", []);
  window.__seeks = [];
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
    runtime: {
      lastError: null,
      getURL: (file) => "chrome-extension://test/" + file,
      sendMessage: (message, cb) => {
        let reply = { ok: true };
        if (message.type === "PLAYLIST_SESSION") {
          let session = L("fakeSession", null);
          if (message.op === "clear") session = null;
          else if (message.op === "set" && session) session = { ...session, ...message.session };
          S("fakeSession", session);
          reply = { ok: true, session };
        }
        if (message.type === "PLAYLIST_META") {
          window.__metaAsked = (window.__metaAsked || []).concat([message.items.map((i) => i.videoNo || i.clipUID)]);
          // 첫 목록에만 답한다(뒤의 목록 항목 제목은 그대로 두고 확인한다).
          const first = !localStorage.getItem("__metaAnswered");
          localStorage.setItem("__metaAnswered", "1");
          reply = { ok: true, results: message.items.map((i) => (first && i.videoNo === "103" ? { title: "넷째", views: 42, date: "2025-01-02 10:00:00" } : null)) };
        }
        if (message.type === "PLAYLIST_PLAY") {
          localStorage.setItem("__played", JSON.stringify({ listId: message.listId, index: message.index, inTab: message.inTab, shuffle: message.shuffle }));
        }
        setTimeout(() => cb && cb(reply), 0);
      },
    },
  };
  window.__boot = () => {
    const IS_TOP_FRAME = true;
    const IS_POPUP_PLAYER_FRAME = false;
    const featureFlags = { playlist: true };
    window.__flags = featureFlags;
    const CLIP_PAGE_AUTOPLAY_PARAM = "cheesePlatterAutoplay";
    const AD_MARKER_SEL = ".fake-ad";
    const isAdPlaying = () => window.__ad === true;
    const findHeaderInboxButton = (header) => header?.querySelector("[data-inbox]") || null;
    const isChzzkDarkTheme = () => document.documentElement.classList.contains("theme_dark");
    const seekVideoToCommentTimestamp = (s) => window.__seeks.push(s);
    const spaNavigate = (href) => {
      window.__spa.push(href); localStorage.setItem("__spa", JSON.stringify(window.__spa));
      history.pushState({}, "", href); window.dispatchEvent(new PopStateEvent("popstate"));
    };
    const VIDEO_VAULT_PAGE_BUTTON_CLASS = "x"; const CLIP_VAULT_PANEL_ID = "x";
    const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const clipVaultXSvg = () => "";
    const getVideoVaultDetailVideoNo = () => ""; const getVideoVaultDetailButtonContext = () => null;
    const readVideoVaultDetailPageMeta = () => null; const isVideoVaultListPage = () => false; const isClipCardListPage = () => false;
    const videoNoFromHref = () => ""; const clipUidFromHref = () => ""; const videoVaultCardLinks = () => []; const clipVaultCardLinks = () => [];
    const readVideoCardMeta = () => null; const readClipCardMeta = () => null; const clipDetailMeta = (uid) => ({ uid });
    const currentClipDetailUid = () => location.pathname.match(/^\\/clips\\/([^/?#]+)/)?.[1] || "";
    ${section}
    window.api = { ensurePlaylistPlayback, playlistPlayback };
    const tick = () => ensurePlaylistPlayback();
    window.addEventListener("popstate", tick);
    setInterval(tick, 120);
    tick();
  };
})();
`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><style>${read("src/content.css")}</style><script>${read("src/playlistStore.js")}</script></head>` +
    `<body><aside id="sidebar" style="position:fixed;left:0;top:60px;width:200px"><nav><ul class="_list_side"><li class="_item_side"><a class="_link_side" href="/lives"><span class="_icon_side"></span><span class="_text_side">전체 방송</span></a></li></ul></nav></aside><header id="header" style="display:flex;gap:8px"><div class="_item_head"><button class="_btn_inbox" data-inbox>수신함</button></div></header><aside id="aside-chatting" style="position:fixed;right:0;top:0;width:340px;height:100vh"></aside><main id="app"></main>` +
    `<script>window.__boot()</script></body></html>`);
});

const dir = mkdtempSync(path.join(tmpdir(), "cheese-playlist-play-"));
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
    const until = async (expression, label, tries = 80) => {
      for (let i = 0; i < tries; i++) {
        if (await ev(expression).catch(() => false)) return;
        await wait(60);
      }
      throw new Error(`기다림 실패: ${label} — ${await ev("location.pathname + ' | ' + (document.getElementById('cheese-playlist-panel')?.textContent || '(패널 없음)') + ' | ' + localStorage.getItem('fakeSession')").catch(() => "?")}`);
    };
    await call("Page.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT }, sessionId);
    await call("Page.navigate", { url: `${origin}/video/101` }, sessionId);
    await until("!!window.CheesePlaylistStore", "첫 화면");
    // 목록·세션을 심는다.
    await ev(`(() => {
      const S = CheesePlaylistStore;
      let st = S.createList(S.normalize(null), "몰아보기");
      const id = st.list.id;
      st = S.addItems(st.state, id, [
        { type: "video", videoNo: "101", title: "첫 다시보기", duration: 3600, views: 1234, date: Date.UTC(2025, 7, 13, 3) },
        { type: "video", videoNo: "102", title: "둘째(10분부터)", start: 600, duration: 3600 },
        { type: "clip", clipUID: "clipCCC1", title: "셋째 클립", duration: 30 },
        { type: "video", videoNo: "103", title: "넷째", duration: 3600, adult: true, thumb: "https://livecloud-thumb.akamaized.net/103.jpg" },
      ]);
      localStorage.setItem("fakeLocal", JSON.stringify({ [S.KEY]: st.state }));
      localStorage.setItem("fakeSession", JSON.stringify({ listId: id, index: 0, itemId: st.state.lists[0].items[0].id, repeat: false, paused: false }));
      localStorage.setItem("__spa", "[]");
      return true;
    })()`);
    await call("Page.reload", {}, sessionId);
    await until("document.querySelector('#cheese-playlist-panel .cheese-playlist-panel-title span')?.textContent === '1/4'", "패널");
    const first = await ev(`(() => { const p = document.getElementById('cheese-playlist-panel'); const r = p.getBoundingClientRect();
      return { current: p.querySelector('.is-current b').textContent, prevDisabled: p.querySelector('[data-pl-panel="prev"]').disabled,
        right: Math.round(innerWidth - r.right), top: Math.round(r.top), items: p.querySelectorAll('.cheese-playlist-panel-items li').length }; })()`);
    check(first.current === "첫 다시보기" && first.prevDisabled && first.items === 4 && first.right === 16 && first.top === 72,
      `재생 중인 탭: 패널(현재 항목 강조·첫 항목이면 이전 꺼짐)을 기본으로 화면 오른쪽 위(헤더 아래)에 띄운다 ${JSON.stringify(first)}`);

    // 목록 줄: 조회수·날짜(치지직 재생목록과 같은 표기). 없는 항목은 재생하는 목록만 한 번 받아 채운다.
    await until("document.querySelectorAll('#cheese-playlist-panel .cheese-playlist-panel-stats').length === 2", "조회수·날짜 채우기");
    const stats = await ev(`(() => ({ stats: [...document.querySelectorAll('#cheese-playlist-panel .cheese-playlist-panel-stats')].map((s) => s.textContent),
      asked: window.__metaAsked, stored: JSON.parse(localStorage.getItem('fakeLocal')).cheesePlaylists.lists[0].items[3] }))()`);
    check(JSON.stringify(stats.stats) === JSON.stringify(["▷ 1,234 · 2025.08.13", "▷ 42 · 2025.01.02"]) &&
      JSON.stringify(stats.asked) === JSON.stringify([["102", "clipCCC1", "103"]]) && stats.stored.views === 42 && stats.stored.date > 0,
      `목록 줄에 조회수·날짜, 없는 항목만 한 번 받아 저장 ${JSON.stringify(stats)}`);
    const adultThumb = await ev(`(() => { const t = document.querySelectorAll('#cheese-playlist-panel .cheese-playlist-panel-thumb')[3];
      return { img: t.querySelector('img')?.getAttribute('src'), adult: t.classList.contains('is-adult'), mark: getComputedStyle(t, '::before').backgroundImage.includes('age_restriction'),
        durationOnTop: Number(getComputedStyle(t.querySelector('.cheese-playlist-panel-duration')).zIndex) > Number(getComputedStyle(t, '::before').zIndex) }; })()`);
    check(adultThumb.img === "https://livecloud-thumb.akamaized.net/103.jpg" && adultThumb.adult && adultThumb.mark && adultThumb.durationOnTop,
      `19세 항목도 썸네일을 그대로 보이고 연령 제한 표시를 덮는다(길이는 그 위) ${JSON.stringify(adultThumb)}`);

    // 목록 줄: 썸네일 자리·길이, 머리: 총 길이·가운데 정렬
    const look = await ev(`(() => { const p = document.getElementById('cheese-playlist-panel');
      return { durations: [...p.querySelectorAll('.cheese-playlist-panel-duration')].map((d) => d.textContent),
        thumbs: p.querySelectorAll('.cheese-playlist-panel-thumb').length, clipThumb: !!p.querySelector('.cheese-playlist-panel-thumb.is-clip'),
        total: p.querySelector('.cheese-playlist-panel-title small')?.textContent, align: getComputedStyle(p.querySelector('.cheese-playlist-panel-title')).alignItems }; })()`);
    check(JSON.stringify(look.durations) === JSON.stringify(["1:00:00", "1:00:00", "0:30", "1:00:00"]) && look.thumbs === 4 && look.clipThumb &&
      look.total === "2:50:30" && look.align === "center",
      `패널 목록에 썸네일·길이, 머리에 총 길이(시작 시간 뒤만), 제목 줄은 가운데 정렬 ${JSON.stringify(look)}`);

    // 치지직 라이트/다크를 따른다
    if (process.env.PLAYLIST_SHOT) {
      for (const theme of ["light", "dark"]) {
        await ev(`document.documentElement.classList.toggle('theme_dark', ${theme === "dark"}); document.body.style.background = '${theme === "dark" ? "#141517" : "#fff"}'; true`);
        await wait(300);
        const r = await ev("(() => { const b = document.getElementById('cheese-playlist-panel').getBoundingClientRect(); return { x: b.left - 10, y: b.top - 10, width: b.width + 20, height: b.height + 20 }; })()");
        const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(process.env.PLAYLIST_SHOT, `playlist-panel-${theme}.png`), Buffer.from(shot.data, "base64"));
      }
      await ev("document.documentElement.classList.remove('theme_dark'); document.body.style.background = ''; true");
      await wait(300);
    }
    const bg = () => ev("getComputedStyle(document.getElementById('cheese-playlist-panel')).backgroundColor");
    const light = await bg();
    await ev("document.documentElement.classList.add('theme_dark'); true");
    await until("document.getElementById('cheese-playlist-panel').classList.contains('is-dark')", "다크");
    const dark = await bg();
    await ev("document.documentElement.classList.remove('theme_dark'); true");
    await until("!document.getElementById('cheese-playlist-panel').classList.contains('is-dark')", "라이트");
    check(light !== dark && light.startsWith("rgba(255, 255, 255") && dark.startsWith("rgba(20, 21, 23"),
      `치지직 라이트/다크 테마에 맞춰 패널 색이 바뀐다 ${light} → ${dark}`);

    // 머리를 끌어 옮기기(제목에서 끌어도 접히지 않는다), 아래 양쪽 모서리로 크기 조절, 다시 열어도 그 자리
    const shotPanel = async (name, id = "cheese-playlist-panel") => {
      if (!process.env.PLAYLIST_SHOT) return;
      await wait(250);
      const r = await ev("(() => { const b = document.getElementById('" + id + "').getBoundingClientRect(); return { x: b.left - 10, y: b.top - 10, width: b.width + 20, height: b.height + 20 }; })()");
      const shot = await call("Page.captureScreenshot", id === "cheese-playlist-panel" ? { format: "png", clip: { ...r, scale: 1 } } : { format: "png" }, sessionId);
      fs.writeFileSync(path.join(process.env.PLAYLIST_SHOT, `playlist-${name}.png`), Buffer.from(shot.data, "base64"));
    };
    const mouse = (type, x, y, buttons = 1) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 }, sessionId);
    const drag = async (x, y, dx, dy) => {
      await mouse("mousePressed", x, y);
      await mouse("mouseMoved", x + dx / 2, y + dy / 2);
      await mouse("mouseMoved", x + dx, y + dy);
      await mouse("mouseReleased", x + dx, y + dy, 0);
      await wait(80);
    };
    const box = () => ev("(() => { const r = document.getElementById('cheese-playlist-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()");
    await ev(`(() => { const t = document.createElement('p'); t.id = 'pageText'; t.textContent = '치지직 페이지 글자 '.repeat(40);
      t.style.cssText = 'position:absolute;left:0;top:300px;width:1300px;font-size:20px'; document.body.append(t); return true; })()`);
    const b0 = await box();
    const title = await ev("(() => { const r = document.querySelector('.cheese-playlist-panel-title strong').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()");
    await drag(title.x, title.y, -300, 120);
    const b1 = await box();
    check(await ev("String(getSelection()).length === 0 && !document.documentElement.classList.contains('cheese-playlist-panel-dragging')"),
      "패널을 끌어 페이지 글자 위를 지나가도 글자가 선택되지 않는다");
    check(b1.l === b0.l - 300 && b1.t === b0.t + 120 && await ev("!document.getElementById('cheese-playlist-panel').classList.contains('is-collapsed')"),
      `제목(머리)을 끌면 옮겨지고, 끈 뒤에는 접히지 않는다 ${JSON.stringify([b0, b1])}`);
    const grip = (side) => ev(`(() => { const r = document.querySelector('.cheese-playlist-panel-resize.is-${side}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const gripLook = await ev(`(() => { const g = document.querySelector('.cheese-playlist-panel-resize.is-left');
      return { opacity: getComputedStyle(g).opacity, arc: g.querySelector('path')?.getAttribute('d'), flip: getComputedStyle(g).transform }; })()`);
    check(gripLook.opacity === "0" && gripLook.arc === "M21 9a12 12 0 0 1-12 12" && gripLook.flip.startsWith("matrix(-1"),
      `크기 손잡이는 미리보기 창과 같은 호 아이콘(왼쪽은 뒤집음), 평소엔 숨김 ${JSON.stringify(gripLook)}`);
    const right = await grip("right");
    await mouse("mouseMoved", right.x, right.y, 0);
    await wait(200);
    check(await ev("getComputedStyle(document.querySelector('.cheese-playlist-panel-resize.is-right')).opacity === '1'"), "손잡이 자리에 마우스를 올리면 보인다");
    await drag(right.x, right.y, 80, 60);
    const b2 = await box();
    check(b2.l === b1.l && b2.w === b1.w + 80 && b2.h === b1.h + 60, `오른쪽 아래 모서리로 폭·높이를 늘린다 ${JSON.stringify([b1, b2])}`);
    const left = await grip("left");
    await drag(left.x, left.y, -50, 30);
    const b3 = await box();
    check(b3.l === b2.l - 50 && b3.w === b2.w + 50 && b3.h === b2.h + 30 && b3.l + b3.w === b2.l + b2.w,
      `왼쪽 아래 모서리는 오른쪽 끝을 고정한 채 왼쪽으로 넓힌다 ${JSON.stringify([b2, b3])}`);
    const saved = await ev("JSON.parse(localStorage.getItem('fakeLocal')).cheesePlaylistPanelRect");
    check(saved.left === b3.l && saved.top === b3.t && saved.width === b3.w && saved.height === b3.h, `위치·크기를 저장한다 ${JSON.stringify(saved)}`);
    await call("Page.reload", {}, sessionId);
    await until("!!document.getElementById('cheese-playlist-panel')?.style.left", "다시 열기");
    const b4 = await box();
    check(JSON.stringify(b4) === JSON.stringify(b3), `다시 열어도(다른 탭·새로고침) 저장한 위치·크기 ${JSON.stringify(b4)}`);
    await call("Emulation.setDeviceMetricsOverride", { width: 700, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId);
    await wait(150);
    const small = await ev("(() => { const r = document.getElementById('cheese-playlist-panel').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0; })()");
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    check(small, "창이 줄면 패널이 창 밖으로 나가지 않게 맞춘다");

    // 짧은 영상·광고의 끝은 무시
    const ignored = await ev(`(async () => {
      const make = (dur) => { const v = document.createElement('video'); Object.defineProperty(v, 'duration', { value: dur, configurable: true }); document.getElementById('app').append(v); return v; };
      make(10).dispatchEvent(new Event('ended'));
      window.__ad = true; make(3600).dispatchEvent(new Event('ended')); window.__ad = false;
      const ad = document.createElement('div'); ad.className = 'fake-ad'; document.getElementById('app').append(ad);
      const inAd = document.createElement('video'); Object.defineProperty(inAd, 'duration', { value: 3600 }); ad.append(inAd); inAd.dispatchEvent(new Event('ended'));
      await new Promise((r) => setTimeout(r, 300));
      return location.pathname; })()`);
    check(ignored === "/video/101", "짧은 미리보기 영상·광고 중·광고 영역 영상의 끝으로는 넘어가지 않는다");

    // 본 영상 끝 → SPA 로 다음(시작 시간 붙임)
    await ev(`(() => { document.getElementById('app').innerHTML = ''; const v = document.createElement('video');
      Object.defineProperty(v, 'duration', { value: 3600, configurable: true }); document.getElementById('app').append(v);
      v.dispatchEvent(new Event('ended')); return true; })()`);
    await until("location.pathname === '/video/102' && document.querySelector('#cheese-playlist-panel .cheese-playlist-panel-title span')?.textContent === '2/4'", "다음 항목");
    const spa = await ev("({ spa: window.__spa, session: JSON.parse(localStorage.getItem('fakeSession')).index })");
    check(JSON.stringify(spa.spa) === JSON.stringify(["/video/102?currentTime=600"]) && spa.session === 1,
      `다시보기 끝 → 다음 다시보기는 SPA 로, 시작 시간(currentTime)을 붙여 옮기고 세션 순번을 올린다 ${JSON.stringify(spa)}`);

    // 시작 시간이 안 먹었으면 한 번만 옮긴다
    await ev(`(() => { const v = document.querySelector('#app video'); Object.defineProperty(v, 'readyState', { value: 1, configurable: true });
      Object.defineProperty(v, 'currentTime', { value: 0, configurable: true, writable: true }); return true; })()`);
    await until("window.__seeks.length > 0", "시작 보정");
    await wait(400);
    check(JSON.stringify(await ev("window.__seeks")) === "[600]", "이동 뒤 위치가 시작 시간과 크게 다르면 한 번만 시작 시간으로 옮긴다");

    // 다시보기 끝 → 클립(전체 이동, 자동재생 요청)
    await ev(`(() => { const v = document.querySelector('#app video'); v.dispatchEvent(new Event('ended')); return true; })()`);
    await until("location.pathname === '/clips/clipCCC1' && document.querySelector('#cheese-playlist-panel .cheese-playlist-panel-title span')?.textContent === '3/4'", "클립으로");
    check(await ev("location.search === '?cheesePlatterAutoplay=1' && JSON.parse(localStorage.getItem('__spa')).length === 1"),
      "클립으로 갈 때는 전체 이동하고 클립 자동재생 요청을 붙인다");

    // 클립 끝(프레임 알림) → 다음 다시보기(전체 이동). 다른 출처 메시지는 무시.
    await ev(`(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { type: 'cheese-playlist-clip-ended' } })); return true; })()`);
    await wait(300);
    check(await ev("location.pathname === '/clips/clipCCC1'"), "m.naver.com 이 아닌 곳의 끝 알림은 무시한다");
    await ev(`(() => { window.dispatchEvent(new MessageEvent('message', { origin: 'https://m.naver.com', data: { type: 'cheese-playlist-clip-ended' } })); return true; })()`);
    await until("location.pathname === '/video/103' && document.querySelector('#cheese-playlist-panel .cheese-playlist-panel-title span')?.textContent === '4/4'", "클립 끝");
    check(true, "클립 프레임이 끝을 알리면 다음 항목으로 넘어간다(클립 → 다시보기는 전체 이동)");

    // 마지막: 반복이 꺼져 있으면 끝 안내
    await ev(`(() => { const v = document.createElement('video'); Object.defineProperty(v, 'duration', { value: 3600 }); document.getElementById('app').append(v); v.dispatchEvent(new Event('ended')); return true; })()`);
    await until("!!document.querySelector('.cheese-playlist-panel-notice [data-pl-panel=\"restart\"]')", "끝 안내");
    check(await ev("location.pathname === '/video/103' && document.querySelector('[data-pl-panel=\"next\"]').disabled"),
      "마지막 항목이 끝나면 넘어가지 않고 '처음부터 다시'를 보인다");
    // 반복을 켜면 다음 = 처음
    await ev("document.querySelector('[data-pl-panel=\"repeat\"]').click(); true");
    await until("document.querySelector('[data-pl-panel=\"repeat\"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-pl-panel=\"next\"]').disabled", "반복");
    await ev("document.querySelector('[data-pl-panel=\"next\"]').click(); true");
    await until("location.pathname === '/video/101' && JSON.parse(localStorage.getItem('fakeSession')).repeat === true", "반복 처음");
    check(true, "목록 반복을 켜면 마지막 다음은 처음 항목(반복 설정은 세션에 남는다)");

    // 목록 밖으로 → 일시정지 + 돌아가기
    await ev("history.pushState({}, '', '/video/999'); dispatchEvent(new PopStateEvent('popstate')); true");
    await until("!!document.querySelector('.cheese-playlist-panel-notice [data-pl-panel=\"resume\"]')", "일시정지");
    check(await ev("JSON.parse(localStorage.getItem('fakeSession')).paused === true"), "목록에 없는 영상으로 가면 세션을 일시정지하고 '돌아가기'를 보인다");
    await ev("document.querySelector('[data-pl-panel=\"resume\"]').click(); true");
    await until("location.pathname === '/video/101' && !document.querySelector('.cheese-playlist-panel-notice')", "돌아가기");
    check(true, "'재생목록으로 돌아가기'는 하던 항목으로 옮긴다");

    // 목록 안 다른 항목으로 직접 가면 따라간다
    await ev("history.pushState({}, '', '/video/103'); dispatchEvent(new PopStateEvent('popstate')); true");
    await until("document.querySelector('#cheese-playlist-panel .cheese-playlist-panel-title span')?.textContent === '4/4'", "따라감");
    check(await ev("JSON.parse(localStorage.getItem('fakeSession')).paused === false && !document.querySelector('.cheese-playlist-panel-notice')"),
      "목록 안 다른 항목으로 직접 가면 그 항목을 현재로 삼는다(일시정지 아님)");

    // 섞어 재생: 켜면 지금 항목이 맨 앞, 다음은 섞인 순서대로
    await ev("document.querySelector('[data-pl-panel=\"shuffle\"]').click(); true");
    await until("JSON.parse(localStorage.getItem('fakeSession')).shuffle === true", "셔플 켬");
    const shuffled = await ev(`(() => { const st = JSON.parse(localStorage.getItem('fakeSession')); const items = JSON.parse(localStorage.getItem('fakeLocal')).cheesePlaylists.lists[0].items;
      return { order: st.order, current: st.itemId, ids: items.map((i) => i.id), paths: Object.fromEntries(items.map((i) => [i.id, i.type === 'clip' ? '/clips/' + i.clipUID : '/video/' + i.videoNo])) }; })()`);
    check(shuffled.order.length === 4 && shuffled.order[0] === shuffled.current && [...shuffled.order].sort().join() === [...shuffled.ids].sort().join() &&
      await ev("document.querySelector('[data-pl-panel=\"shuffle\"]').getAttribute('aria-pressed') === 'true'"),
      "섞어 재생을 켜면 지금 항목을 맨 앞에 두고 나머지를 섞은 순서를 세션에 둔다");
    await ev("document.querySelector('[data-pl-panel=\"next\"]').click(); true");
    await until(`location.pathname === ${JSON.stringify("")} + ${JSON.stringify(shuffled.paths)}[${JSON.stringify(shuffled.order[1])}]`, "셔플 다음");
    check(true, "다음은 섞인 순서의 다음 항목으로 간다");
    await ev("document.querySelector('[data-pl-panel=\"shuffle\"]').click(); true");
    await until("JSON.parse(localStorage.getItem('fakeSession')).shuffle === false", "셔플 끔");
    await ev(`history.pushState({}, '', '/video/103'); dispatchEvent(new PopStateEvent('popstate')); true`);
    await until("document.querySelector('#cheese-playlist-panel .cheese-playlist-panel-title span')?.textContent === '4/4'", "되돌림");

    // 접기 → 항목 목록 숨김, 세션에 기억
    await ev("document.querySelector('.cheese-playlist-panel-title').click(); true");
    await until("document.getElementById('cheese-playlist-panel').classList.contains('is-collapsed') && !document.querySelector('.cheese-playlist-panel-items')", "접기");
    check(await ev("JSON.parse(localStorage.getItem('fakeSession')).collapsed === true"), "제목을 누르면 접히고(목록 숨김), 접힘을 세션에 기억한다");

    // 좁게 줄여도 제목 줄 글자가 버튼과 겹치거나 버튼 밖으로 나가지 않는다
    await ev(`(async () => { await chrome.storage.local.set({ cheesePlaylistPanelRect: { left: 600, top: 100, width: 240, height: 400 } }); return true; })()`);
    await ev("document.querySelector('.cheese-playlist-mini [data-pl-panel=\"toggle\"]').click(); true");
    await until("JSON.parse(localStorage.getItem('fakeSession')).collapsed === false", "펼치기");
    await call("Page.reload", {}, sessionId);
    await until("document.getElementById('cheese-playlist-panel')?.style.width === '240px' && !!document.querySelector('.cheese-playlist-panel-title')", "좁은 패널");
    const narrow = await ev(`(() => { const t = document.querySelector('.cheese-playlist-panel-title'); const r = t.getBoundingClientRect();
      const next = t.nextElementSibling.getBoundingClientRect();
      const inside = [...t.children].every((c) => c.getBoundingClientRect().right <= r.right + 0.5);
      return { gap: Math.round(next.left - r.right), inside, overflow: getComputedStyle(t).overflow, controls: document.querySelectorAll('.cheese-playlist-panel-controls button').length }; })()`);
    await shotPanel("narrow");
    check(narrow.gap >= 0 && narrow.overflow === "hidden" && narrow.controls === 5,
      `240px 로 줄여도 제목이 옆 버튼과 겹치지 않고(제목 안에서 잘림), 조작 버튼은 다음 줄에 ${JSON.stringify(narrow)}`);

    // 접힌 재생바: 넓으면 한 줄(표지·제목 | 조작+재생 위치 | 펼치기·닫기), 이 화면의 다시보기면 재생 위치·재생/일시정지
    await ev(`(async () => { await chrome.storage.local.set({ cheesePlaylistPanelRect: { left: 300, top: 100, width: 640, height: 400 } }); return true; })()`);
    await ev("document.querySelector('[data-pl-panel=\"toggle\"]').click(); true");
    await call("Page.reload", {}, sessionId);
    await until("!!document.querySelector('.cheese-playlist-mini')", "재생바");
    await ev(`(() => { const v = document.createElement('video'); v.id = 'mainV';
      let t = 600, paused = false; Object.defineProperty(v, 'duration', { value: 3600 }); Object.defineProperty(v, 'readyState', { value: 4 });
      Object.defineProperty(v, 'currentTime', { get: () => t, set: (x) => { t = x; } }); Object.defineProperty(v, 'paused', { get: () => paused });
      v.play = () => { paused = false; return Promise.resolve(); }; v.pause = () => { paused = true; };
      document.getElementById('app').append(v); return true; })()`);
    await until("document.getElementById('cheese-playlist-panel').classList.contains('has-media') && document.querySelector('[data-pl-time]').textContent === '10:00'", "재생 위치");
    const mini = await ev(`(() => { const q = (s) => document.querySelector(s).getBoundingClientRect();
      const text = q('.cheese-playlist-mini-text'), center = q('.cheese-playlist-mini-center'), art = q('.cheese-playlist-mini-art'), actions = q('.cheese-playlist-mini-actions');
      return { oneRow: Math.abs(text.top + text.height / 2 - (center.top + center.height / 2)) < 12 && center.left > text.right - 1 && actions.left >= center.right - 1,
        art: art.width > 0, bar: document.querySelector('.cheese-playlist-mini-bar i').style.width, dur: document.querySelector('[data-pl-duration]').textContent,
        play: document.querySelector('.cheese-playlist-mini [data-pl-panel="play"]').getAttribute('aria-label') }; })()`);
    await shotPanel("mini-wide");
    check(mini.oneRow && mini.art && mini.bar === "16.67%" && mini.dur === "1:00:00" && mini.play === "일시정지",
      `넓게 접으면 음악 앱 같은 한 줄 재생바(표지·제목, 조작+재생 위치, 펼치기·닫기) ${JSON.stringify(mini)}`);
    await ev("document.querySelector('.cheese-playlist-mini [data-pl-panel=\"play\"]').click(); true");
    check(await ev("document.getElementById('mainV').paused === true && document.querySelector('.cheese-playlist-mini [data-pl-panel=\"play\"]').getAttribute('aria-label') === '재생'"),
      "재생바의 재생/일시정지는 다시보기 영상을 멈추고 다시 튼다");
    const barBox = await ev("(() => { const r = document.querySelector('.cheese-playlist-mini-bar').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 }; })()");
    await mouse("mousePressed", barBox.x, barBox.y);
    await mouse("mouseReleased", barBox.x, barBox.y, 0);
    await wait(100);
    check(Math.abs(await ev("document.getElementById('mainV').currentTime") - 1800) < 40, "재생 위치 막대를 누르면 그 자리로 옮긴다(끌기로 잡지 않는다)");
    await ev(`(async () => { await chrome.storage.local.set({ cheesePlaylistPanelRect: { left: 300, top: 100, width: 380, height: 400 } }); return true; })()`);
    await call("Page.reload", {}, sessionId);
    await until("!!document.querySelector('.cheese-playlist-mini')", "중간 폭");
    const mid = await ev(`(() => { const q = (s) => document.querySelector(s).getBoundingClientRect();
      return q('.cheese-playlist-mini-center').top > q('.cheese-playlist-mini-text').bottom - 1 && q('.cheese-playlist-mini-art').width > 0; })()`);
    await ev(`(() => { const v = document.createElement('video'); Object.defineProperty(v, 'duration', { value: 3600 }); Object.defineProperty(v, 'currentTime', { value: 1234 }); Object.defineProperty(v, 'paused', { value: true }); document.getElementById('app').append(v); return true; })()`);
    await shotPanel("mini-mid");
    check(mid, "중간 폭이면 제목 줄 아래에 조작·재생 위치를 둔다");
    await ev("document.querySelector('.cheese-playlist-mini [data-pl-panel=\"toggle\"]').click(); true");
    await until("!!document.querySelector('.cheese-playlist-panel-items')", "펼침");

    // 재생하던 목록을 지우면 패널도 사라진다
    await ev(`(async () => { await CheesePlaylistStore.update((s) => CheesePlaylistStore.deleteList(s, s.lists[0].id)); return true; })()`);
    await until("!document.getElementById('cheese-playlist-panel') && localStorage.getItem('fakeSession') === 'null'", "목록 삭제");
    check(true, "재생하던 목록이 지워지면 세션을 끝내고 패널을 치운다");

    // 닫기 = 세션 끝
    await ev(`(() => {
      const S = CheesePlaylistStore; let st = S.createList(S.normalize(null), "다시"); st = S.addItems(st.state, st.list.id, [{ type: "video", videoNo: "103", duration: 100 }]);
      localStorage.setItem("fakeLocal", JSON.stringify({ [S.KEY]: st.state }));
      localStorage.setItem("fakeSession", JSON.stringify({ listId: st.list.id, index: 0, itemId: st.state.lists[0].items[0].id }));
      return true; })()`);
    await call("Page.reload", {}, sessionId);
    await until("!!document.getElementById('cheese-playlist-panel')", "다시 패널");

    // 접은 패널을 재생바로 보기 설정: 끄면 제목 줄과 조작 줄만
    await ev("document.querySelector('[data-pl-panel=\"toggle\"]').click(); true");
    await until("!!document.querySelector('.cheese-playlist-mini')", "재생바");
    await ev("chrome.storage.local.set({ cheesePlaylistMiniPlayer: false }); true");
    await until("!document.querySelector('.cheese-playlist-mini') && !!document.querySelector('.cheese-playlist-panel-title')", "재생바 끔");
    const compact = async () => ev(`(() => { const head = document.querySelector('.cheese-playlist-panel-head'); const t = head.querySelector('.cheese-playlist-panel-title').getBoundingClientRect();
      const c = head.querySelector('.cheese-playlist-panel-controls.is-inline'); const visible = [...c.querySelectorAll('button')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.dataset.plPanel);
      return { oneRow: !!c && Math.abs(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2 - (t.top + t.height / 2)) < 4 && !document.querySelector('.cheese-playlist-panel-controls:not(.is-inline)'),
        visible, items: !!document.querySelector('.cheese-playlist-panel-items'), width: Math.round(document.getElementById('cheese-playlist-panel').getBoundingClientRect().width) }; })()`);
    const c1 = await compact();
    check(c1.oneRow && !c1.items && c1.width <= 400 && JSON.stringify(c1.visible) === JSON.stringify(["prev", "next"]),
      `재생바를 끄면 접은 패널은 제목과 조작이 한 줄, 좁으면(${c1.width}px) 재생/일시정지·섞기·반복은 숨긴다 ${JSON.stringify(c1)}`);
    await ev(`(async () => { await chrome.storage.local.set({ cheesePlaylistPanelRect: { left: 300, top: 100, width: 640, height: 400 } }); return true; })()`);
    await call("Page.reload", {}, sessionId);
    await until("!!document.querySelector('.cheese-playlist-panel-controls.is-inline')", "넓은 한 줄");
    const c2 = await compact();
    await shotPanel("compact-wide");
    check(c2.oneRow && JSON.stringify(c2.visible) === JSON.stringify(["shuffle", "prev", "play", "next", "repeat"]),
      `넓으면(640px) 한 줄에 조작 버튼이 모두 보인다 ${JSON.stringify(c2)}`);
    await ev("chrome.storage.local.set({ cheesePlaylistMiniPlayer: true }); true");
    await until("!!document.querySelector('.cheese-playlist-mini')", "재생바 켬");
    check(true, "다시 켜면 바로 재생바로 돌아간다");

    // 최소화 버튼(따로) → 헤더(수신함 왼쪽)에 다시 열기 버튼
    check(await ev("JSON.stringify([...document.querySelectorAll('.cheese-playlist-mini-actions [data-pl-panel]')].map((b) => b.dataset.plPanel)) === JSON.stringify(['toggle', 'minimize', 'stop'])"),
      "패널에 접기·최소화·재생 끝내기 버튼이 따로 있다");
    await ev("document.querySelector('#cheese-playlist-panel [data-pl-panel=\"minimize\"]').click(); true");
    await until("!document.getElementById('cheese-playlist-panel') && !!document.getElementById('cheese-playlist-header-button')", "최소화");
    const headerButton = await ev(`(() => { const b = document.getElementById('cheese-playlist-header-button'); const item = b.parentElement;
      return { cls: b.className, itemCls: item.className, beforeInbox: item.nextElementSibling?.querySelector('[data-inbox]') !== null, title: b.title,
        label: b.getAttribute('aria-label'), session: JSON.parse(localStorage.getItem('fakeSession')) }; })()`);
    check(headerButton.cls === "_btn_inbox" && headerButton.itemCls === "_item_head cheese-playlist-header-item" && headerButton.beforeInbox && !headerButton.title &&
      headerButton.label === "재생목록 패널 다시 열기 — 다시 1/1" && headerButton.session.minimized === true,
      `최소화하면 패널을 숨기고 헤더(수신함 왼쪽)에 수신함 모양 버튼, 재생 세션은 이어진다 ${JSON.stringify(headerButton)}`);

    // 마우스를 올리면 재생바 카드(조작 가능), 벗어나면 닫힘
    const hb = await ev("(() => { const r = document.getElementById('cheese-playlist-header-button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom }; })()");
    await mouse("mouseMoved", hb.x, hb.y, 0);
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-mini')", "미리보기 카드");
    const card = await ev(`(() => { const c = document.getElementById('cheese-playlist-hover-card'); const r = c.getBoundingClientRect();
      return { below: r.top >= ${hb.bottom} && r.top - ${hb.bottom} < 20, title: c.querySelector('.cheese-playlist-mini-text b').textContent,
        controls: c.querySelectorAll('.cheese-playlist-mini-controls button').length, restore: !!c.querySelector('[data-pl-panel="restore"]'),
        art: getComputedStyle(c.querySelector('.cheese-playlist-mini-art')).display !== 'none',
        fits: c.querySelector('.cheese-playlist-mini').getBoundingClientRect().bottom <= r.bottom + 0.5 && r.bottom <= innerHeight, h: Math.round(r.height), top: Math.round(r.top) }; })()`);
    await shotPanel("hover-card", "cheese-playlist-hover-card");
    check(card.below && card.fits && card.title === "다시보기 103" && card.controls === 5 && card.restore && card.art,
      `최소화 버튼에 마우스를 올리면 버튼 아래에 재생바 카드(표지·제목·조작·패널 열기) ${JSON.stringify(card)}`);
    const cardRepeat = await ev("(() => { const b = document.querySelector('#cheese-playlist-hover-card [data-pl-panel=\"repeat\"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
    await mouse("mouseMoved", cardRepeat.x, cardRepeat.y, 0);
    await wait(300);
    check(await ev("!!document.getElementById('cheese-playlist-hover-card')"), "카드 위로 옮겨 가도 카드는 남는다");
    await mouse("mousePressed", cardRepeat.x, cardRepeat.y);
    await mouse("mouseReleased", cardRepeat.x, cardRepeat.y, 0);
    await until("JSON.parse(localStorage.getItem('fakeSession')).repeat === true && document.querySelector('#cheese-playlist-hover-card [data-pl-panel=\"repeat\"]')?.getAttribute('aria-pressed') === 'true'", "카드 조작");
    check(true, "카드 안 조작 버튼(반복 등)이 동작하고 카드에 바로 반영된다");
    const listToggle = async () => {
      const b = await ev("(() => { const r = document.querySelector('#cheese-playlist-hover-card [data-pl-panel=\"hover-list\"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
      await mouse("mouseMoved", b.x, b.y, 0);
      await mouse("mousePressed", b.x, b.y);
      await mouse("mouseReleased", b.x, b.y, 0);
      await wait(400);
      return ev(`(() => { const c = document.getElementById('cheese-playlist-hover-card'); const w = c.querySelector('.cheese-playlist-hover-list');
        return { open: w.classList.contains('is-open'), expanded: c.querySelector('[data-pl-panel="hover-list"]').getAttribute('aria-expanded'),
          listH: Math.round(w.getBoundingClientRect().height), items: c.querySelectorAll('.cheese-playlist-hover-list li').length,
          current: !!c.querySelector('.cheese-playlist-hover-list .is-current') }; })()`);
    };
    const closedH = await ev("Math.round(document.querySelector('#cheese-playlist-hover-card .cheese-playlist-hover-list').getBoundingClientRect().height)");
    const opened = await listToggle();
    await shotPanel("hover-card-open", "cheese-playlist-hover-card");
    check(closedH <= 1 && opened.open && opened.expanded === "true" && opened.listH > 40 && opened.items === 1 && opened.current,
      `카드의 '목록' 버튼으로 항목 목록을 펼친다(현재 항목 표시) ${JSON.stringify({ closedH, ...opened })}`);
    const closed = await listToggle();
    check(!closed.open && closed.expanded === "false" && closed.listH <= 1, `다시 누르면 목록을 접는다 ${JSON.stringify(closed)}`);
    await mouse("mouseMoved", 5, 880, 0);
    await until("!document.getElementById('cheese-playlist-hover-card')", "카드 닫힘");
    check(true, "버튼·카드 밖으로 나가면 카드가 닫힌다");

    // 최소화 위치를 사이드바로
    await ev("chrome.storage.local.set({ cheesePlaylistMinimizeTarget: 'sidebar' }); true");
    await until("!!document.getElementById('cheese-playlist-sidebar-item') && !document.getElementById('cheese-playlist-header-button')", "사이드바");
    const side = await ev(`(() => { const li = document.getElementById('cheese-playlist-sidebar-item'); const a = li.querySelector('a');
      return { li: li.className, a: a.className, icon: a.firstElementChild.className, text: a.lastElementChild.className + '|' + a.lastElementChild.textContent, last: li.parentElement.lastElementChild === li }; })()`);
    check(side.li === "_item_side" && side.a === "_link_side" && side.icon === "_icon_side" && side.text === "_text_side|재생목록" && side.last,
      `설정에서 최소화 위치를 사이드바로 바꾸면 맨 위 메뉴 끝에 같은 모양 항목으로 옮긴다 ${JSON.stringify(side)}`);
    const sb = await ev("(() => { const r = document.querySelector('#cheese-playlist-sidebar-item a').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right }; })()");
    await mouse("mouseMoved", sb.x, sb.y, 0);
    await until("!!document.getElementById('cheese-playlist-hover-card')", "사이드바 카드");
    check(await ev(`document.getElementById('cheese-playlist-hover-card').getBoundingClientRect().left >= ${sb.right}`), "사이드바 항목이면 카드는 오른쪽에 뜬다");
    await call("Page.reload", {}, sessionId);
    await until("!!document.getElementById('cheese-playlist-sidebar-item')", "최소화 유지");
    check(await ev("!document.getElementById('cheese-playlist-panel')"), "다른 페이지로 가도(새로고침) 최소화 그대로");
    await ev("document.querySelector('#cheese-playlist-sidebar-item a').click(); true");
    await until("!!document.getElementById('cheese-playlist-panel') && !document.getElementById('cheese-playlist-sidebar-item') && JSON.parse(localStorage.getItem('fakeSession')).minimized === false", "다시 열기");
    check(true, "최소화 버튼(사이드바 항목)을 누르면 패널을 다시 열고 버튼은 사라진다");
    await ev("chrome.storage.local.set({ cheesePlaylistMinimizeTarget: 'header' }); true");

    // 닫기(×)는 바로 재생 끝내기
    await ev("document.querySelector('#cheese-playlist-panel [data-pl-panel=\"stop\"]').click(); true");
    await until("!document.getElementById('cheese-playlist-panel') && localStorage.getItem('fakeSession') === 'null'", "닫기");
    check(await ev("!document.getElementById('cheese-playlist-sidebar-item') && document.getElementById('cheese-playlist-header-button')?.dataset.plMode === 'library'"),
      "닫기(×)는 바로 재생을 끝낸다(패널 없음, 같은 자리 버튼은 '나만의 재생목록' 으로 바뀐다)");

    // 재생 중이 아니면 같은 자리 버튼에서 내 재생목록을 골라 재생
    await ev(`(async () => { const S = CheesePlaylistStore; const data = (await chrome.storage.local.get(S.KEY))[S.KEY];
      let st = S.createList(data, "둘째 목록"); st = S.addItems(st.state, st.list.id, [{ type: "video", videoNo: "201", duration: 60 }, { type: "video", videoNo: "202", duration: 60 }]);
      await chrome.storage.local.set({ [S.KEY]: st.state }); return true; })()`);
    await until("document.getElementById('cheese-playlist-header-button')?.getAttribute('aria-label') === '나만의 재생목록'", "목록 버튼");
    const lb = await ev("(() => { const r = document.getElementById('cheese-playlist-header-button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await mouse("mouseMoved", lb.x, lb.y, 0);
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-library')", "목록 카드");
    await shotPanel("library-card", "cheese-playlist-hover-card");
    const library = await ev(`(() => { const c = document.getElementById('cheese-playlist-hover-card');
      return { names: [...c.querySelectorAll('.cheese-playlist-library-text b')].map((b) => b.textContent), counts: [...c.querySelectorAll('.cheese-playlist-library-thumb span')].map((x) => x.textContent),
        shuffle: c.querySelectorAll('[data-pl-panel="play-shuffle"]').length,
        playButtons: c.querySelectorAll('.cheese-playlist-library-actions [data-pl-panel="play-list"]').length,
        toggles: c.querySelectorAll('[data-pl-panel="library-toggle"]').length, manage: !!c.querySelector('[data-pl-panel="manage"]'), head: c.querySelector('.cheese-playlist-library-head small').textContent }; })()`);
    check(JSON.stringify(library.names) === JSON.stringify(["다시", "둘째 목록"]) && JSON.stringify(library.counts) === JSON.stringify(["1개", "2개"]) &&
      library.shuffle === 1 && library.playButtons === 2 && library.toggles === 2 && library.manage && library.head === "2개",
      `재생 중이 아니면 같은 자리 버튼에 마우스를 올려 내 재생목록(표지·개수·이름)을 보고, 2개 이상이면 섞어서 재생 버튼 ${JSON.stringify(library)}`);
    // 목록 펼치기 → 항목을 골라 그 항목부터 재생, 다시 누르면 접기
    const toggleAt = async (i) => {
      const t = await ev(`(() => { const r = document.querySelectorAll('#cheese-playlist-hover-card [data-pl-panel="library-toggle"]')[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await mouse("mouseMoved", t.x, t.y, 0);
      await mouse("mousePressed", t.x, t.y);
      await mouse("mouseReleased", t.x, t.y, 0);
      await wait(350);
      return ev(`(() => { const e = document.querySelectorAll('#cheese-playlist-hover-card .cheese-playlist-library-entry')[${i}];
        return { open: e.classList.contains('is-open'), h: Math.round(e.querySelector('.cheese-playlist-library-items').getBoundingClientRect().height),
          items: e.querySelectorAll('[data-pl-panel="play-item"]').length, expanded: e.querySelector('[data-pl-panel="library-toggle"]').getAttribute('aria-expanded') }; })()`);
    };
    const libOpened = await toggleAt(1);
    check(libOpened.open && libOpened.h > 60 && libOpened.items === 2 && libOpened.expanded === "true", `목록 옆 펼치기 버튼으로 그 목록의 항목을 펼친다 ${JSON.stringify(libOpened)}`);
    await shotPanel("library-card-open", "cheese-playlist-hover-card");
    const shut = await toggleAt(1);
    check(!shut.open && shut.h === 0 && shut.expanded === "false", `다시 누르면 접는다 ${JSON.stringify(shut)}`);
    await toggleAt(1);
    const itemBtn = await ev("(() => { const r = document.querySelectorAll('#cheese-playlist-hover-card .cheese-playlist-library-entry')[1].querySelectorAll('[data-pl-panel=\"play-item\"]')[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await mouse("mouseMoved", itemBtn.x, itemBtn.y, 0);
    await mouse("mousePressed", itemBtn.x, itemBtn.y);
    await mouse("mouseReleased", itemBtn.x, itemBtn.y, 0);
    await until("JSON.parse(localStorage.getItem('__played') || '{}').index === 1", "항목부터 재생");
    check(await ev("JSON.parse(localStorage.getItem('__played')).shuffle === false"), "펼친 항목을 누르면 그 항목부터 이 탭에서 재생한다");
    await ev("localStorage.removeItem('__played'); true");
    await mouse("mouseMoved", lb.x, lb.y, 0);
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-library')", "목록 카드 다시");
    check(await ev("document.querySelectorAll('#cheese-playlist-hover-card .cheese-playlist-library-entry')[1].classList.contains('is-open')"), "펼친 상태는 다시 열어도 그대로");
    const pick = await ev("(() => { const r = document.querySelectorAll('#cheese-playlist-hover-card .cheese-playlist-library-play')[1].getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()");
    await mouse("mouseMoved", pick.x, pick.y, 0);
    await mouse("mousePressed", pick.x, pick.y);
    await mouse("mouseReleased", pick.x, pick.y, 0);
    await until("!!localStorage.getItem('__played')", "목록 재생");
    const played = await ev("JSON.parse(localStorage.getItem('__played'))");
    check(played.inTab === true && played.index === 0 && played.shuffle === false && played.listId &&
      await ev("!document.getElementById('cheese-playlist-hover-card')"),
      `목록을 누르면 이 탭에서 처음부터 재생을 요청하고 카드를 닫는다 ${JSON.stringify(played)}`);
    await ev("document.getElementById('cheese-playlist-header-button').click(); true");
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-library')", "누르기로 열기");
    await ev("document.querySelector('#cheese-playlist-hover-card [data-pl-panel=\"play-shuffle\"]').click(); true");
    await until("JSON.parse(localStorage.getItem('__played')).shuffle === true", "섞어서");
    check(true, "버튼을 눌러도 목록 카드가 열리고, 섞기 버튼은 섞어서 재생을 요청한다");
    // 호버: 잠깐(250ms) 머물러야 연다 — 지나가다 열리지 않게
    await mouse("mouseMoved", 700, 500, 0);
    await wait(300);
    await mouse("mouseMoved", lb.x, lb.y, 0);
    await wait(80);
    const early = await ev("!document.getElementById('cheese-playlist-hover-card')");
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-library')", "머물면 열기");
    check(early, "호버(기본): 버튼에 잠깐 머물러야 목록 카드를 연다");
    await mouse("mouseMoved", 700, 500, 0);
    await until("!document.getElementById('cheese-playlist-hover-card')", "떠나면 닫기");
    // 설정 '카드 열기: 클릭' — 올려도 안 열리고, 눌러야 열리며, 떠나도 안 닫힌다(바깥 클릭·Esc 로 닫기)
    await ev("chrome.storage.local.set({ cheesePlaylistLibraryOpen: 'click' }); true");
    await wait(100);
    await mouse("mouseMoved", lb.x, lb.y, 0);
    await wait(500);
    check(await ev("!document.getElementById('cheese-playlist-hover-card')"), "클릭 설정: 마우스를 올려도 카드를 열지 않는다");
    await mouse("mousePressed", lb.x, lb.y);
    await mouse("mouseReleased", lb.x, lb.y, 0);
    await until("!!document.querySelector('#cheese-playlist-hover-card .cheese-playlist-library')", "클릭으로 열기");
    await mouse("mouseMoved", 700, 500, 0);
    await wait(500);
    check(await ev("!!document.getElementById('cheese-playlist-hover-card')"), "클릭 설정: 누르면 열고, 마우스가 떠나도 닫지 않는다");
    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
    check(await ev("!document.getElementById('cheese-playlist-hover-card')"), "클릭 설정: Esc 로 닫는다");
    await mouse("mouseMoved", lb.x, lb.y, 0);
    await mouse("mousePressed", lb.x, lb.y);
    await mouse("mouseReleased", lb.x, lb.y, 0);
    await until("!!document.getElementById('cheese-playlist-hover-card')", "다시 열기");
    await mouse("mousePressed", lb.x, lb.y);
    await mouse("mouseReleased", lb.x, lb.y, 0);
    check(await ev("!document.getElementById('cheese-playlist-hover-card')"), "클릭 설정: 버튼을 다시 누르면 닫는다");
    await mouse("mousePressed", lb.x, lb.y);
    await mouse("mouseReleased", lb.x, lb.y, 0);
    await until("!!document.getElementById('cheese-playlist-hover-card')", "또 열기");
    await mouse("mouseMoved", 700, 500, 0);
    await mouse("mousePressed", 700, 500);
    await mouse("mouseReleased", 700, 500, 0);
    check(await ev("!document.getElementById('cheese-playlist-hover-card')"), "클릭 설정: 바깥을 누르면 닫는다");
    await ev("chrome.storage.local.set({ cheesePlaylistLibraryOpen: 'hover' }); true");
    // 재생목록 버튼 위치는 패널 최소화 버튼 위치와 따로 정한다
    await ev("chrome.storage.local.set({ cheesePlaylistMinimizeTarget: 'sidebar' }); true");
    await wait(300);
    check(await ev("!!document.getElementById('cheese-playlist-header-button') && !document.getElementById('cheese-playlist-sidebar-item')"),
      "패널 최소화 버튼 위치를 바꿔도 재생목록 버튼(재생 중이 아닐 때)은 자기 위치(헤더) 그대로");
    await ev("chrome.storage.local.set({ cheesePlaylistLibraryTarget: 'sidebar' }); true");
    await until("document.querySelector('#cheese-playlist-sidebar-item a')?.dataset.plMode === 'library' && !document.getElementById('cheese-playlist-header-button')", "재생목록 버튼 사이드바");
    check(true, "재생목록 버튼 위치를 사이드바로 바꾸면 사이드바로 옮긴다");
    await ev("window.__flags.playlist = false; chrome.storage.local.set({ x: 1 }); true");
    await wait(300);
    check(await ev("!!document.getElementById('cheese-playlist-sidebar-item')"), "재생목록 버튼은 담기 버튼 설정과 상관없다");
    await ev("window.__flags.playlist = true; chrome.storage.local.set({ cheesePlaylistLibraryButton: false }); true");
    await until("!document.getElementById('cheese-playlist-sidebar-item') && !document.getElementById('cheese-playlist-header-button')", "재생목록 버튼 끔");
    check(true, "설정에서 재생목록 버튼을 끄면 재생 중이 아닐 때 버튼이 없다");
    await ev("chrome.storage.local.set({ cheesePlaylistLibraryButton: true, cheesePlaylistLibraryTarget: 'header', cheesePlaylistMinimizeTarget: 'header' }); true");
  } finally {
    server.close();
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    // 크롬이 끝나며 프로필 폴더에 늦게 쓰는 경우가 있어(ENOTEMPTY) 정리 실패는 테스트 실패로 보지 않는다.
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
