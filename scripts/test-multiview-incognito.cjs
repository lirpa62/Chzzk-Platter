// 시크릿 창에서 멀티뷰: 고르기 화면은 일반 창, 시청 화면은 시크릿 창.
//
// 고르기 화면은 확장 페이지라 시크릿 탭에서는 열리지 않는다(실측: 시크릿 탭 사이드바 링크·주소 붙여넣기 모두
// ERR_BLOCKED_BY_CLIENT). 시크릿 창의 설정 팝업 '멀티뷰' 는 크롬이 일반 창에 열지만 시크릿에서 왔다는 표시가
// 없어 시청 화면도 일반 창(일반 로그인)에 열렸다.
//   - 시크릿 탭 사이드바 '멀티뷰' 는 링크 대신 배경(MULTIVIEW_OPEN_SETUP)이 일반 창에 ?incognito=1 로 연다
//   - 시크릿 창 설정 팝업 '멀티뷰' 도 ?incognito=1 을 붙인다
//   - 시작하면 배경이 시청 화면(치지직 /lives)을 열린 시크릿 창(초점 있는 것 먼저)에, 없으면 새 시크릿 창에 연다
//   - '시크릿 모드에서 허용' 이 꺼져 있으면 열지 않고 이유를 돌려준다
//   - 일반·시크릿 멀티뷰는 '같은 구성'·'기존 멀티뷰 바꾸기' 대상으로 섞지 않는다
//   - 시크릿 멀티뷰가 여는 채팅 창도 시크릿, '고르기 화면 열기' 는 일반 창에 ?incognito=1 을 붙여 연다
// 함께: 배경 fetch 는 일반 창 쿠키로 나가므로 일반 계정을 바꾸거나 보여 주는 요청(통나무파워, 내가 만든 클립
// 목록·삭제, 팔로잉 좋아요 가져오기)은 시크릿 탭에서 받지 않고 통나무파워 상태도 보내지 않는다
// (실측: 비로그인 시크릿 멀티뷰에 일반 창 계정의 '0 적립 중' 이 떴다).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

// ── 진입(content.js)·고르기 화면(multiview.js) ─────────────────────────────
const content = read("src/content.js");
check(/link\.href = chrome\.runtime\.getURL\("multiview\.html"\);/.test(content) &&
  /if \(chrome\.extension\?\.inIncognitoContext\) \{[\s\S]{0,300}?event\.preventDefault\(\);\s*chrome\.runtime\.sendMessage\(\{ type: "MULTIVIEW_OPEN_SETUP" \}\)/.test(content),
  "시크릿 탭의 사이드바 '멀티뷰' 는 링크로 가지 않고 배경에 열어 달라고 한다(시크릿 탭에선 확장 페이지가 막힌다)");
const picker = read("src/multiview.js");
check(/const OPEN_INCOGNITO = new URLSearchParams\(location\.search\)\.get\("incognito"\) === "1" \|\|/.test(picker) &&
  /\.\.\.\(OPEN_INCOGNITO \? \{ incognito: true \} : \{\}\),/.test(picker),
  "고르기 화면은 주소의 incognito=1 을 읽어 시청 화면 열기 요청에 담는다");
const settingsJs = read("src/settings.js");
check(/incognito = \(await chrome\.windows\?\.getCurrent\?\.\(\)\)\?\.incognito === true;/.test(settingsJs) &&
  /chrome\.runtime\.getURL\(incognito \? "multiview\.html\?incognito=1" : "multiview\.html"\)/.test(settingsJs),
  "시크릿 창에서 연 설정 팝업의 '멀티뷰' 도 ?incognito=1 을 붙인다");
check(/chrome\.extension\?\.inIncognitoContext === true;/.test(picker),
  "고르기 화면이 사설 창에 열려 있으면(파이어폭스) 주소와 상관없이 시크릿으로 본다");
check(/runningList\.filter\(\(r\) => r\.incognito === OPEN_INCOGNITO\)/.test(picker) &&
  /const sameMode = runningList\.length === 1 && runningList\[0\]\.incognito === OPEN_INCOGNITO;/.test(picker) &&
  /canReplace: addingTab && sameMode/.test(picker),
  "고르기 화면은 같은 구성 확인·'기존 멀티뷰 바꾸기' 를 같은 모드(일반/시크릿) 멀티뷰로만 한다");
check(/reason === "incognito-not-allowed"/.test(picker) && /'시크릿 모드에서 허용'을 켜 주세요/.test(picker),
  "시크릿 접근이 꺼져 있으면 켜는 방법을 알린다");
const html = read("multiview.html");
check(/id="mvIncognitoNote" hidden/.test(html) && /note\.hidden = !OPEN_INCOGNITO;/.test(picker),
  "시크릿에서 열면 시청 화면이 시크릿 창에 열린다고 안내한다");

// ── 배경(background.js) ───────────────────────────────────────────────────
const background = read("src/background.js");
const bgSource = between(background, "// ── 멀티뷰(치지직 페이지 위)", "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {");
check(/const incognito = message\.incognito === true \|\| sender\?\.tab\?\.incognito === true;\s*openMultiviewHost\(setupId, message\.theme, sender\?\.tab, reuseTabId, incognito\)/.test(background),
  "배경은 고르기 화면 요청의 incognito 를 시청 화면 열기에 넘긴다");

check(/if \(message\.type === "MULTIVIEW_OPEN_SETUP"\) \{\s*if \(!\/\^https:\\\/\\\/chzzk\\\.naver\\\.com\\\/\/\.test\(String\(sender\?\.url \|\| ""\)\)\) return false;/.test(background) &&
  /sender\?\.tab\?\.incognito \? `\$\{MULTIVIEW_SETUP_PAGE\}\?incognito=1` : MULTIVIEW_SETUP_PAGE/.test(background) &&
  /\? openExtensionPageInNormalWindow\(url\)/.test(background),
  "배경은 치지직 탭의 요청만 받아, 시크릿이면 일반 창에 ?incognito=1 로 고르기 화면을 연다");
const blocked = between(background, "const INCOGNITO_BLOCKED_MESSAGES = new Set([", "]);");
check(["START_LOG_POWER_WATCH_REWARD_TRACKING", "GET_LOG_POWER_WATCH_REWARD_STATUS", "CHEESE_LOG_POWER_CLAIMED",
  "GET_LOG_POWER_BALANCES", "LP_AWAITING", "LP_RECONCILE", "LP_WRITE"].every((type) => blocked.includes(`"${type}"`)) &&
  /if \(sender\?\.tab\?\.incognito === true && INCOGNITO_BLOCKED_MESSAGES\.has\(message\.type\)\) \{\s*sendResponse\?\.\(\{\s*ok: false,\s*success: false,\s*status: null,\s*reason: "incognito",\s*error: INCOGNITO_BLOCKED_ERROR,\s*\}\);\s*return false;/.test(background),
  "시크릿 탭의 통나무파워 요청(적립 추적·상태·기록·보유 목록)은 처리하지 않는다");
check(["CHEESE_SEARCH_FETCH_MAKE_CLIPS", "CHEESE_SEARCH_DELETE_MAKE_CLIP", "CHEESE_CLIP_VAULT_IMPORT_FOLLOWING_LIKES",
  "CHEESE_CLIP_VAULT_RETRY_FOLLOWING_LIKES"].every((type) => blocked.includes(`"${type}"`)),
  "일반 계정을 바꾸거나 보여 주는 요청(내가 만든 클립 목록·삭제, 팔로잉 좋아요 가져오기)도 시크릿 탭에선 받지 않는다");
check(!["MULTIVIEW_API", "CHEESE_SEARCH_FETCH_VIDEOS", "CHEESE_SEARCH_FETCH_CLIPS", "PLAYLIST_META",
  "CHEESE_CLIP_VAULT_GET_METADATA"].some((type) => blocked.includes(`"${type}"`)),
  "공개 정보 요청(멀티뷰 목록·검색·재생목록·클립 정보)은 막지 않는다");
check(/if \(t\.id != null && t\.id !== exceptTabId && !t\.incognito\)/.test(between(background, "function lpBroadcast(", "\n}\n")),
  "통나무파워 상태 알림은 시크릿 탭에 보내지 않는다");

function backgroundContext({ allowed = true, windows = [] } = {}) {
  const session = {};
  const calls = [];
  let nextWindow = 100;
  let nextTab = 5000;
  const tabs = {};
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://ext/${p}` },
    extension: { isAllowedIncognitoAccess: async () => allowed },
    storage: {
      session: {
        setAccessLevel: () => {},
        get: async (key) => (Array.isArray(key) ? Object.fromEntries(key.map((k) => [k, session[k]])) : { [key]: session[key] }),
        set: async (values) => Object.assign(session, JSON.parse(JSON.stringify(values))),
        remove: async (key) => { delete session[key]; },
      },
    },
    windows: {
      getAll: async () => windows,
      create: async (options) => {
        calls.push(["windows.create", options]);
        const id = nextWindow++;
        const tabId = id + 1000;
        tabs[tabId] = { id: tabId, windowId: id, incognito: !!options.incognito, url: options.url };
        return { id, incognito: !!options.incognito, tabs: [{ id: tabId, windowId: id }] };
      },
      remove: async () => {},
      update: async (id, options) => calls.push(["windows.update", id, options]),
      onRemoved: { addListener: () => {} },
    },
    tabs: {
      get: async (tabId) => {
        const tab = tabs[tabId];
        if (!tab) throw new Error("No tab with id");
        return { ...tab, status: "loading", url: tab.url || "https://chzzk.naver.com/lives" };
      },
      reload: async (tabId) => calls.push(["tabs.reload", tabId]),
      update: async (tabId, options) => calls.push(["tabs.update", tabId, options]),
      query: async () => [],
      create: async (options) => {
        calls.push(["tabs.create", options]);
        const id = nextTab++;
        const win = windows.find((w) => w.id === options.windowId);
        tabs[id] = { id, windowId: options.windowId ?? 1, incognito: !!win?.incognito, url: options.url };
        return { id, windowId: tabs[id].windowId, index: options.index ?? 0 };
      },
      sendMessage: async () => {},
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    },
    scripting: { executeScript: async () => [{ result: true }] },
  };
  const ctx = { chrome, fetch: async () => ({ text: async () => "<html></html>" }), Number, Array, Object, String, JSON, Error, URL };
  vm.createContext(ctx);
  vm.runInContext(bgSource + "\nthis.out={openMultiviewHost,handleMultiviewHostApi,runningMultiviewHosts};", ctx);
  return { ...ctx.out, calls, tabs };
}

const pickerTab = { id: 10, windowId: 1, index: 2, incognito: false };
const normalWin = { id: 1, incognito: false, focused: true };

(async () => {
  // 1) 열린 시크릿 창이 있으면 그 창(초점 있는 것 먼저)에 새 탭.
  {
    const bg = backgroundContext({ windows: [normalWin, { id: 7, incognito: true, focused: false }, { id: 8, incognito: true, focused: true }] });
    const opened = await bg.openMultiviewHost("setup-i", "dark", pickerTab, null, true);
    const create = bg.calls.find(([name]) => name === "tabs.create")?.[1];
    check(create?.url === "https://chzzk.naver.com/lives" && create.windowId === 8 && !("index" in create),
      `시청 화면은 열린 시크릿 창 중 초점 있는 창에 연다 ${JSON.stringify(create)}`);
    check(bg.calls.some(([name, id, options]) => name === "windows.update" && id === 8 && options.focused),
      "그 시크릿 창을 앞으로 가져온다");
    const running = await bg.runningMultiviewHosts();
    check(running.length === 1 && running[0].tabId === opened.tabId && running[0].incognito === true,
      "실행 중 목록에 시크릿 여부를 담는다(고르기 화면이 모드별로 나눠 본다)");

    // 시크릿 멀티뷰의 채팅 창·고르기 화면 열기
    const sender = { tab: { id: opened.tabId, incognito: true } };
    await bg.handleMultiviewHostApi({ op: "windows.create", args: { url: "https://chzzk.naver.com/live/x/chat" } }, sender);
    const chatWin = bg.calls.filter(([name]) => name === "windows.create").at(-1)?.[1];
    check(chatWin?.incognito === true && chatWin.type === "popup", "시크릿 멀티뷰가 여는 채팅 창도 시크릿");
    await bg.handleMultiviewHostApi({ op: "setup.open", args: { href: "chrome-extension://ext/multiview.html?setup=setup-i" } }, sender);
    const setupTab = bg.calls.filter(([name]) => name === "tabs.create").at(-1)?.[1];
    check(setupTab?.windowId === 1 && setupTab.url === "chrome-extension://ext/multiview.html?setup=setup-i&incognito=1",
      `'고르기 화면 열기' 는 일반 창에 ?incognito=1 을 붙여 연다(시크릿 탭엔 확장 페이지가 안 뜬다) ${JSON.stringify(setupTab)}`);

    // 일반 창에서 시작한 '기존 멀티뷰 바꾸기' 는 시크릿 멀티뷰를 바꾸지 않는다.
    const before = bg.calls.length;
    const normal = await bg.openMultiviewHost("setup-n", "light", pickerTab, opened.tabId, false);
    check(!normal.reused && normal.tabId !== opened.tabId &&
      !bg.calls.slice(before).some(([name, id]) => name === "tabs.reload" && id === opened.tabId),
      "모드가 다르면 '기존 멀티뷰 바꾸기' 대상이어도 새로 연다");
    const normalCreate = bg.calls.slice(before).find(([name]) => name === "tabs.create")?.[1];
    check(normalCreate?.windowId === 1 && normalCreate.index === 3, "일반 시작은 예전처럼 고르기 화면 옆 탭");
    // 같은 구성(그 탭에서 고치는 중)은 모드와 상관없이 그 탭을 다시 연다.
    const again = await bg.openMultiviewHost("setup-i", "dark", pickerTab, null, true);
    check(again.reused && again.tabId === opened.tabId, "같은 구성은 그 시크릿 탭을 다시 연다");
    // 같은 모드의 '기존 멀티뷰 바꾸기' 는 그대로 동작한다.
    const replaced = await bg.openMultiviewHost("setup-j", "dark", pickerTab, opened.tabId, true);
    check(replaced.reused && replaced.tabId === opened.tabId, "같은 모드면 '기존 멀티뷰 바꾸기' 로 그 탭을 바꾼다");
  }
  // 2) 시크릿 창이 없으면 새 시크릿 창.
  {
    const bg = backgroundContext({ windows: [normalWin] });
    const opened = await bg.openMultiviewHost("setup-w", "dark", pickerTab, null, true);
    const win = bg.calls.find(([name]) => name === "windows.create")?.[1];
    check(win?.incognito === true && win.url === "https://chzzk.naver.com/lives" && win.focused === true &&
      !bg.calls.some(([name]) => name === "tabs.create") && opened.tabId === bg.tabs[opened.tabId]?.id,
      `열린 시크릿 창이 없으면 새 시크릿 창에 연다 ${JSON.stringify(win)}`);
  }
  // 3) 시크릿 접근이 꺼져 있으면 열지 않는다.
  {
    const bg = backgroundContext({ allowed: false, windows: [normalWin] });
    await assert.rejects(bg.openMultiviewHost("setup-x", "dark", pickerTab, null, true), /incognito-not-allowed/);
    check(!bg.calls.some(([name]) => name === "tabs.create" || name === "windows.create"),
      "'시크릿 모드에서 허용' 이 꺼져 있으면 아무 창도 열지 않고 이유를 돌려준다");
  }
  // 4) 고르기 화면이 이미 사설 창에 있으면(파이어폭스) 그 옆에 연다.
  {
    const bg = backgroundContext({ windows: [{ id: 9, incognito: true, focused: true }] });
    await bg.openMultiviewHost("setup-f", "dark", { id: 11, windowId: 9, index: 0, incognito: true }, null, true);
    const create = bg.calls.find(([name]) => name === "tabs.create")?.[1];
    check(create?.windowId === 9 && create.index === 1, "고르기 화면이 사설 창에 있으면 그 옆 탭에 연다");
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
