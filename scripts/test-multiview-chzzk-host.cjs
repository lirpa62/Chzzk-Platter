// 치지직 페이지(/lives) 위 멀티뷰 검증.
//
// 치지직이 응답 헤더 frame-ancestors 로 다른 출처(확장 페이지 포함)의 iframe 표시를 막아,
// 멀티뷰 시청 화면을 치지직 페이지 위 전용 팝업 창에 그린다. 여기서는
//   1) 칸 쪽: iframe 이름으로 받은 설정과 세션 토큰 판정(content.js)
//   2) 부모 쪽: 칸 설정을 주소가 아니라 이름으로 넘기고 토큰을 붙이는지(multiviewWatch.js)
//   3) 배경: 멀티뷰 탭만, 자기가 연 창과 치지직·고르기 화면 주소만 다루는지(background.js)
//   4) 화면 세우기: 치지직 스타일을 끄고 body 를 시청 화면으로 바꾸는지(헤드리스 크롬)
// 를 확인한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
const between = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `구간을 찾지 못했다: ${from.slice(0, 40)}`);
  return source.slice(start, end);
};

// ── 1) 칸 쪽(content.js) ──────────────────────────────────────────────────
const content = read("src/content.js");
const paramsSource = between(content, "  const MULTIVIEW_NAME_PREFIX", "  const IS_MULTIVIEW_FRAME =");
const tokenSource = between(content, "  const MULTIVIEW_HOSTED_ON_CHZZK", "\n\n  // ⚠ 메인 변경 때 프레임을");
function frameContext({ search = "", name = "", top = false, pathname = "/live/" + "b".repeat(32), store = {} }) {
  const win = { name };
  win.top = top ? win : {};
  win.parent = top ? win : {};
  const ctx = {
    window: win,
    location: { search, pathname },
    sessionStorage: { getItem: (key) => (Object.hasOwn(store, key) ? store[key] : null) },
    URLSearchParams,
    chrome: { runtime: { getURL: (p) => `chrome-extension://ext/${p}` } },
  };
  vm.createContext(ctx);
  vm.runInContext(paramsSource + tokenSource +
    "\nthis.out={MULTIVIEW_PARAMS,MULTIVIEW_PARENT_ORIGIN,MULTIVIEW_TOKEN,isMultiviewParentMessage};", ctx);
  return { ...ctx.out, win };
}
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";
const hostedName = "cheese-multiview:" + JSON.stringify({
  cheeseMulti: "1", cheeseMultiMain: "0", cheeseMultiHost: "chzzk", cheeseMultiToken: TOKEN,
  notOurs: "x",
});
{
  // ⚠ 치지직 스크립트가 칸의 window.name 을 비운다(실측). 같은 탭·같은 출처 sessionStorage 로 받는다.
  const path = "/live/" + "b".repeat(32);
  const frame = frameContext({ name: "", pathname: path,
    store: { ["cheese-multiview-frame:" + path]: hostedName.slice("cheese-multiview:".length) } });
  check(frame.MULTIVIEW_PARAMS.get("cheeseMulti") === "1" &&
    frame.MULTIVIEW_PARAMS.get("cheeseMultiMain") === "0",
    "칸은 window.name 이 비어도 sessionStorage 의 칸 주소 키로 설정을 읽는다");
  const other = frameContext({ pathname: "/live/" + "c".repeat(32),
    store: { ["cheese-multiview-frame:" + path]: hostedName.slice("cheese-multiview:".length) } });
  check(other.MULTIVIEW_PARAMS.get("cheeseMulti") === null, "다른 칸 주소의 설정은 읽지 않는다");
  const named = frameContext({ name: hostedName });
  check(named.MULTIVIEW_PARAMS.get("cheeseMultiMain") === "0", "iframe 이름(예전 방식)도 읽는다");
  check(frame.MULTIVIEW_PARAMS.get("notOurs") === null, "cheeseMulti 가 아닌 이름 값은 받지 않는다");
  check(frame.MULTIVIEW_PARENT_ORIGIN === "https://chzzk.naver.com",
    "치지직 페이지 위 칸은 부모 출처를 치지직으로 본다");
  const parentMessage = (data, origin = "https://chzzk.naver.com", source = frame.win.parent) =>
    frame.isMultiviewParentMessage({ source, origin, data });
  check(parentMessage({ token: TOKEN }), "토큰이 맞는 부모 메시지는 받는다");
  check(!parentMessage({ token: "wrong-token-wrong-token" }), "토큰이 다른 메시지는 받지 않는다");
  check(!parentMessage({}), "토큰이 없는 메시지(치지직 스크립트 등)는 받지 않는다");
  check(!parentMessage({ token: TOKEN }, "https://evil.example"), "다른 출처는 받지 않는다");
  check(!parentMessage({ token: TOKEN }, "https://chzzk.naver.com", {}), "부모가 아닌 창은 받지 않는다");
}
{
  const legacy = frameContext({ search: "?cheeseMulti=1&cheeseMultiMain=1" });
  check(legacy.MULTIVIEW_PARAMS.get("cheeseMultiMain") === "1", "예전 방식(주소 쿼리)도 읽는다");
  check(legacy.MULTIVIEW_PARENT_ORIGIN === "chrome-extension://ext" && legacy.MULTIVIEW_TOKEN === "",
    "확장 페이지 부모는 확장 출처로 보고 토큰을 요구하지 않는다");
  check(legacy.isMultiviewParentMessage({ source: legacy.win.parent, origin: "chrome-extension://ext", data: {} }),
    "확장 페이지 부모 메시지는 출처로 받는다");
}
{
  const topPath = "/live/" + "b".repeat(32);
  const topTab = frameContext({ name: hostedName, top: true, pathname: topPath,
    store: { ["cheese-multiview-frame:" + topPath]: hostedName.slice("cheese-multiview:".length) } });
  check(topTab.MULTIVIEW_PARAMS.get("cheeseMulti") === null,
    "최상위 탭은 창 이름·세션 저장소를 칸 설정으로 믿지 않는다");
}
{
  const badToken = frameContext({
    name: "cheese-multiview:" + JSON.stringify({ cheeseMultiHost: "chzzk", cheeseMultiToken: "short" }),
  });
  check(badToken.MULTIVIEW_TOKEN === "" &&
    !badToken.isMultiviewParentMessage({ source: badToken.win.parent, origin: "https://chzzk.naver.com", data: { token: "short" } }),
    "형식이 틀린 토큰이면 어떤 메시지도 받지 않는다");
}
check(/\.\.\.\(MULTIVIEW_TOKEN \? \{ token: MULTIVIEW_TOKEN \} : \{\}\),\s*\},\s*\/\/ ⚠ "\*" 로 보내지 않는다/.test(content),
  "칸이 부모에 보내는 메시지에 토큰을 붙인다");
check((content.match(/if \(!isMultiviewParentMessage\(event\)\) return;/g) || []).length === 3,
  "부모 지시를 받는 세 곳 모두 출처+토큰으로 판정한다");
for (const file of ["src/audioMixer.js", "src/chatTimestamp.js", "src/subscribeBadge.js",
  "src/multiviewAchievementBridge.js", "src/multiviewBadgeChat.js"]) {
  check(/"cheese-multiview-frame:" \+ (?:window|win)\.location\.pathname\.replace/.test(read(file)),
    `${file} 도 세션 저장소의 칸 설정을 읽는다`);
}

// 칸 설정(cheeseMulti*)을 읽는 칸 쪽 파일은 모두 세션 저장소 경로를 거쳐야 한다(주소 쿼리만
// 보던 파일은 치지직 페이지 위 멀티뷰에서 켜지지 않는다). 부모·고르기·설정 화면은 제외.
{
  const parentSide = new Set(["multiviewWatch.js", "multiview.js", "settings.js", "multiviewChatPopup.js"]);
  const offenders = fs.readdirSync(path.join(root, "src"))
    .filter((file) => file.endsWith(".js") && !file.endsWith(".min.js") && !parentSide.has(file))
    .filter((file) => /\.get\(\s*["'`]cheeseMulti(?!view)/.test(read(`src/${file}`)))
    .filter((file) => !read(`src/${file}`).includes("cheese-multiview-frame:"));
  check(offenders.length === 0,
    "칸 설정을 읽는 칸 쪽 파일은 모두 세션 저장소에서도 읽는다" + (offenders.length ? `: ${offenders.join(", ")}` : ""));
}

// ── 2) 부모 쪽(multiviewWatch.js) ─────────────────────────────────────────
const watch = read("src/multiviewWatch.js");
const watchHostSource = between(watch, "  const HOSTED_ON_CHZZK", "\n  // 탭·창 API.");
const watchTrustSource = between(watch, "  function isTrustedFrameMessage", "\n  // 칸 설정(cheeseMulti*)은");
const watchLoadSource = between(watch, "  function loadFrame(frame, src)", "\n  // 프레임이 준비됐다고 알려 오기를");
function watchContext(origin) {
  const store = {};
  const ctx = {
    sessionStorage: { setItem: (key, value) => { store[key] = String(value); } },
    store,
    location: { origin },
    URL,
    crypto: require("node:crypto").webcrypto,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    CHZZK_ORIGIN: "https://chzzk.naver.com",
  };
  vm.createContext(ctx);
  vm.runInContext(watchHostSource + watchTrustSource + watchLoadSource +
    "\nthis.out={HOSTED_ON_CHZZK,FRAME_TOKEN,FRAME_TOKEN_FIELD,isTrustedFrameMessage,loadFrame,store};", ctx);
  return ctx.out;
}
{
  const hosted = watchContext("https://chzzk.naver.com");
  check(hosted.HOSTED_ON_CHZZK && /^[A-Za-z0-9_-]{24}$/.test(hosted.FRAME_TOKEN),
    "치지직 페이지 위 시청 화면은 세션 토큰을 만든다");
  const frame = { name: "", src: "" };
  hosted.loadFrame(frame, "https://chzzk.naver.com/live/" + "a".repeat(32) +
    "?cheeseMulti=1&cheeseMultiMain=1&cheeseRetry=2");
  check(frame.src === "https://chzzk.naver.com/live/" + "a".repeat(32),
    "칸 주소에는 설정 쿼리를 붙이지 않는다(서버 접속 기록에 남지 않는다)");
  const config = JSON.parse(frame.name.slice("cheese-multiview:".length));
  check(config.cheeseMulti === "1" && config.cheeseMultiMain === "1" && config.cheeseRetry === "2",
    "칸 설정은 iframe 이름으로 넘긴다");
  check(config.cheeseMultiHost === "chzzk" && config.cheeseMultiToken === hosted.FRAME_TOKEN,
    "치지직 페이지 위 칸에는 부모 표시와 세션 토큰을 넘긴다");
  const stored = JSON.parse(hosted.store["cheese-multiview-frame:/live/" + "a".repeat(32)] || "null");
  check(stored?.cheeseMulti === "1" && stored?.cheeseMultiToken === hosted.FRAME_TOKEN,
    "칸 주소 키로 세션 저장소에 설정을 써 둔다(칸 window.name 은 치지직이 비운다)");
  check(hosted.isTrustedFrameMessage({ origin: "https://chzzk.naver.com", data: { token: hosted.FRAME_TOKEN } }) &&
    !hosted.isTrustedFrameMessage({ origin: "https://chzzk.naver.com", data: {} }),
    "부모는 토큰이 맞는 칸 메시지만 받는다");
  const other = watchContext("https://chzzk.naver.com");
  check(other.FRAME_TOKEN !== hosted.FRAME_TOKEN, "토큰은 화면마다 새로 만든다");
}
{
  const legacy = watchContext("chrome-extension://ext");
  check(!legacy.HOSTED_ON_CHZZK && legacy.FRAME_TOKEN === "" &&
    legacy.isTrustedFrameMessage({ origin: "https://chzzk.naver.com", data: {} }),
    "확장 페이지에서는 예전처럼 출처로 받는다");
}
check((watch.match(/source: MULTIVIEW_MESSAGE, \.\.\.FRAME_TOKEN_FIELD,/g) || []).length >= 10,
  "칸에 보내는 지시마다 토큰을 붙인다");
check(!/\.src = (?:url\.toString\(\)|src|frameUrl\()/.test(watch.replace(watchLoadSource, "")),
  "칸·채팅 칸 주소는 loadFrame 으로만 건다");
check(/const handoffId = HOSTED_ON_CHZZK\s*\? String\(globalThis\.__cheeseMultiviewHost\?\.setupId \|\| ""\)/.test(watch),
  "치지직 페이지 위에서는 배경이 넘긴 구성 id 로 시작한다");
check(!/chrome\.windows\.(?:create|remove|update)\(/.test(watch.replace(/const EXT = HOSTED_ON_CHZZK[\s\S]*?\n {6}\};/, "")),
  "창 API 는 EXT 를 거친다(치지직 페이지 위에서는 배경에 맡긴다)");

// ── 3) 배경(background.js) ────────────────────────────────────────────────
const background = read("src/background.js");
const bgSource = between(background, "// ── 멀티뷰(치지직 페이지 위)", "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {");
function backgroundContext() {
  const session = {};
  const calls = [];
  const listeners = {};
  let nextWindow = 100;
  let nextTab = 5000;
  const tabUrls = {};
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://ext/${p}` },
    storage: {
      session: {
        setAccessLevel: (value) => calls.push(["setAccessLevel", value]),
        get: async (key) => ({ [key]: session[key] }),
        set: async (values) => Object.assign(session, JSON.parse(JSON.stringify(values))),
      },
    },
    windows: {
      create: async (options) => {
        calls.push(["windows.create", options]);
        const id = nextWindow++;
        return { id, tabs: [{ id: id + 1000 }] };
      },
      remove: async (id) => calls.push(["windows.remove", id]),
      update: async (id, options) => calls.push(["windows.update", id, options]),
      onRemoved: { addListener: (fn) => (listeners.windowRemoved = fn) },
    },
    tabs: {
      get: async (tabId) => ({ id: tabId, status: "loading",
        url: tabUrls[tabId] || "https://chzzk.naver.com/lives", windowId: tabId - 1000 }),
      update: async (tabId, options) => calls.push(["tabs.update", tabId, options]),
      query: async () => [],
      create: async (options) => {
        calls.push(["tabs.create", options]);
        const id = nextTab++;
        return { id, windowId: options.windowId ?? 1, index: options.index ?? 0 };
      },
      sendMessage: async (tabId, message) => calls.push(["tabs.sendMessage", tabId, message]),
      onUpdated: { addListener: (fn) => (listeners.updated = fn) },
      onRemoved: { addListener: (fn) => (listeners.removed = fn) },
    },
    scripting: { executeScript: async (options) => { calls.push(["executeScript", options]); return [{ result: true }]; } },
  };
  const ctx = { chrome, fetch: async () => ({ text: async () => "<html></html>" }), Number, Array, Object, String, JSON, Error, URL };
  vm.createContext(ctx);
  vm.runInContext(bgSource + "\nthis.out={openMultiviewHost,handleMultiviewHostApi,readMultiviewHosts};", ctx);
  return { ...ctx.out, calls, listeners, session, tabUrls };
}
(async () => {
  const bg = backgroundContext();
  check(bg.calls.some(([name, value]) => name === "setAccessLevel" &&
    value.accessLevel === "TRUSTED_AND_UNTRUSTED_CONTEXTS"),
    "시청 화면(content script)이 세션 저장소의 구성을 읽을 수 있게 한다");
  const opened = await bg.openMultiviewHost("setup-1", "dark", { windowId: 3, index: 4 });
  const create = bg.calls.find(([name]) => name === "tabs.create")[1];
  check(create.url === "https://chzzk.naver.com/lives" && create.active === true &&
    create.windowId === 3 && create.index === 5,
    "멀티뷰는 고르기 화면 옆 새 탭에 치지직 라이브 탐색 페이지로 연다(팝업 창은 안 보이는 일이 있었다)");
  check(!bg.calls.some(([name]) => name === "windows.create"), "멀티뷰 자체는 팝업 창으로 열지 않는다");
  const hosts = await bg.readMultiviewHosts();
  check(hosts[opened.tabId]?.setupId === "setup-1" && hosts[opened.tabId]?.theme === "dark",
    "멀티뷰 탭과 그 구성을 기억한다");
  const sender = { tab: { id: opened.tabId } };
  const api = (op, args, from = sender) => bg.handleMultiviewHostApi({ op, args }, from);
  await assert.rejects(api("windows.create", { url: "https://chzzk.naver.com/live/x/chat" }, { tab: { id: 1 } }),
    /not-multiview-host/);
  checks.push("멀티뷰 탭이 아니면 창 조작을 거절한다");
  await assert.rejects(api("windows.create", { url: "https://evil.example/" }), /invalid-url/);
  checks.push("치지직이 아닌 주소로는 창을 열지 않는다");
  const chatWindow = await api("windows.create", { url: "https://chzzk.naver.com/live/x/chat", width: 420, height: 760 });
  check(Number.isInteger(chatWindow.id) && chatWindow.tabs[0].id === chatWindow.id + 1000,
    "치지직 채팅 독립 창을 열어 준다");
  await api("windows.focus", { windowId: chatWindow.id });
  await assert.rejects(api("windows.remove", { windowId: 9999 }), /not-owned/);
  checks.push("자기가 연 창이 아니면 닫지 않는다");
  await api("tabs.update", { tabId: chatWindow.id + 1000, url: "https://chzzk.naver.com/live/y/chat" });
  check(bg.calls.some(([name, id, options]) => name === "tabs.update" && id === chatWindow.id + 1000 &&
    options.url.endsWith("/live/y/chat")), "자기가 연 채팅 창의 채널을 바꿀 수 있다");
  await assert.rejects(api("setup.open", { href: "https://chzzk.naver.com/" }), /invalid-url/);
  await api("setup.open", { href: "chrome-extension://ext/multiview.html?setup=setup-1" });
  check(bg.calls.some(([name, options]) => name === "tabs.create" &&
    options.url === "chrome-extension://ext/multiview.html?setup=setup-1"),
    "고르기 화면은 확장 주소로만 연다");
  bg.listeners.windowRemoved(chatWindow.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(bg.calls.some(([name, tabId, message]) => name === "tabs.sendMessage" && tabId === opened.tabId &&
    message.type === "MULTIVIEW_HOST_WINDOW_REMOVED" && message.windowId === chatWindow.id),
    "채팅 창이 닫히면 그 멀티뷰 탭에 알린다");
  bg.listeners.updated(opened.tabId, { status: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const scripts = bg.calls.filter(([name]) => name === "executeScript").map(([, options]) => options);
  check(scripts[0]?.files?.[0] === "src/multiviewHostBoot.js" && scripts.at(-1)?.files?.at(-1) === "src/multiviewWatch.js",
    "로드가 끝나면 화면을 세우고 시청 스크립트를 넣는다");
  check(!scripts.at(-1).files.includes("src/multiviewSync.js"),
    "치지직 페이지 content script 로 이미 있는 스크립트는 다시 넣지 않는다");
  // 일반 탭이라 사용자가 다른 치지직 페이지로 가면 그 위에는 멀티뷰를 세우지 않는다.
  const injectedBefore = bg.calls.filter(([name]) => name === "executeScript").length;
  bg.tabUrls[opened.tabId] = "https://chzzk.naver.com/live/" + "a".repeat(32);
  bg.listeners.updated(opened.tabId, { status: "complete" });
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  check(bg.calls.filter(([name]) => name === "executeScript").length === injectedBefore,
    "멀티뷰 탭이 /lives 를 떠나면 그 페이지에는 멀티뷰를 세우지 않는다");
  check(!(await bg.readMultiviewHosts())[opened.tabId], "그 탭은 멀티뷰 탭 기록에서 지운다");
  check(/message\.type === "MULTIVIEW_OPEN_HOST"[\s\S]{0,200}startsWith\(chrome\.runtime\.getURL\(""\)\)/.test(background),
    "멀티뷰 창 열기는 우리 확장 페이지만 부탁할 수 있다");

  // ── 4) 화면 세우기(헤드리스 크롬) ──────────────────────────────────────────
  await bootInBrowser();
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function bootInBrowser() {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-host-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buffer = "";
  let seq = 0;
  const pending = new Map();
  browser.stdio[4].on("data", (chunk) => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf("\0")) >= 0;) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      const job = pending.get(msg.id);
      if (!job) continue;
      pending.delete(msg.id);
      if (msg.error) job.reject(Error(JSON.stringify(msg.error)));
      else job.resolve(msg.result);
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
    const evaluate = async (expression) => {
      const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails).slice(0, 600));
      return result.result.value;
    };
    await call("Network.enable", {}, sessionId);
    await call("Network.setBlockedURLs", { urls: ["http://*", "https://*", "chrome-extension://*"] }, sessionId);
    // 치지직 페이지를 흉내 낸다(앱 루트 + 치지직 스타일).
    await evaluate(`
      document.head.innerHTML='<link rel="stylesheet" href="https://chzzk.example/app.css"><style id="chzzk-style">body{background:rgb(255,0,0)}</style>';
      document.body.innerHTML='<div id="root">치지직 앱</div>';
      window.chzzkRoot=document.getElementById('root');
      window.chrome={runtime:{getURL:p=>'chrome-extension://ext/'+p}};
      true`);
    await evaluate(read("src/multiviewHostBoot.js"));
    const mounted = await evaluate(`CheeseMultiviewHostBoot.mount(${JSON.stringify(read("multiviewWatch.html"))},
      {setupId:'setup-1',theme:'dark'})`);
    check(mounted === true, "시청 화면을 세운다");
    const state = await evaluate(`(()=>({
      foreignMuted:[...document.querySelectorAll('link,style')].filter(el=>!el.hasAttribute('data-cheese-multiview-own'))
        .every(el=>el.media==='not all'),
      ownLinks:[...document.querySelectorAll('link[data-cheese-multiview-own]')].map(el=>el.href),
      rootGone:!document.contains(window.chzzkRoot),
      topbar:!!document.getElementById('mvTopbar'),
      frames:!!document.getElementById('mvFrames'),
      scripts:document.body.querySelectorAll('script').length,
      theme:document.documentElement.dataset.theme,
      hostAttr:document.documentElement.hasAttribute('data-cheese-multiview-host'),
      host:{...globalThis.__cheeseMultiviewHost},
      frozen:Object.isFrozen(globalThis.__cheeseMultiviewHost),
      bodyClass:document.body.className,
    }))()`);
    check(state.foreignMuted, "치지직 스타일은 지우지 않고 끈다");
    check(state.ownLinks.length === 2 && state.ownLinks.every((href) => href.startsWith("chrome-extension://ext/src/")),
      "시청 화면 스타일은 확장 자원으로 붙인다");
    check(state.rootGone && state.topbar && state.frames && state.scripts === 0,
      "치지직 앱 화면을 시청 화면 마크업으로 바꾸고 스크립트 태그는 넣지 않는다");
    check(state.bodyClass === "mv-watch-body", "시청 화면 body 클래스를 그대로 쓴다");
    check(state.theme === "dark" && state.hostAttr, "고르기 화면이 넘긴 테마와 멀티뷰 표시를 건다");
    check(state.host.setupId === "setup-1" && state.frozen, "시청 스크립트가 읽을 구성 id 를 고정해 둔다");
    const later = await evaluate(`(async()=>{
      const style=document.createElement('style');style.textContent='body{color:red}';document.head.appendChild(style);
      const own=document.createElement('link');own.rel='stylesheet';own.setAttribute('data-cheese-multiview-own','1');
      document.head.appendChild(own);
      await new Promise(r=>setTimeout(r,0));
      return {foreign:style.media,own:own.media,again:CheeseMultiviewHostBoot.mount('<html></html>',{setupId:'x'})};
    })()`);
    check(later.foreign === "not all" && later.own === "", "나중에 붙는 치지직 스타일도 끄고 우리 것은 둔다");
    check(later.again === false, "같은 문서에 두 번 세우지 않는다");
  } finally {
    browser.kill("SIGTERM");
    await new Promise((resolve) => browser.once("close", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}
