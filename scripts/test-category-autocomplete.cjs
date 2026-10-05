// 카테고리 이름 자동완성(categoryAutocomplete.js).
//
// 라이브 제외 필터는 카테고리 표시 이름과 정확히 같아야 숨긴다('GTA5' 로는 'Grand Theft Auto V'
// 가 숨겨지지 않는다). 치지직 카테고리 자동완성 API 로 이름을 골라 넣게 한다. 검색어의
// @카테고리 도 같은 목록으로 완성한다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const A = require(path.join(ROOT, "src/categoryAutocomplete.js"));
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const FIXTURE = {
  code: 200,
  content: {
    results: [
      { categoryType: "GAME", categoryId: "Grand_Theft_Auto_V", categoryValue: "Grand Theft Auto V" },
      { categoryType: "ETC", categoryId: "talk", categoryValue: "talk" },
      { categoryType: "GAME", categoryId: "x", categoryValue: "  " },
    ],
  },
};

(async () => {
  // ── 입력에서 완성할 부분 ──
  const token = (mode, value, caret = value.length) => A.tokenAt(mode, value, caret);
  check(JSON.stringify(token("filter", "GTA, 명조")) === '{"keyword":"명조","start":5,"end":7}' &&
    token("filter", "#태그") === null && token("filter", "a, ") === null,
    "제외 필터: 쉼표 뒤 마지막 항목만, '#' 태그는 제외");
  check(JSON.stringify(token("query", "제목 @gr")) === '{"keyword":"gr","start":3,"end":6}' &&
    JSON.stringify(token("query", '@"Grand The')) === '{"keyword":"Grand The","start":0,"end":11}' &&
    JSON.stringify(token("query", '@"gr"', 4)) === '{"keyword":"gr","start":0,"end":5}' &&
    token("query", '@"Grand" x') === null && token("query", "abc") === null,
    "검색어: 커서 앞 @카테고리·@\"…(닫는 따옴표까지 바꿈), 끝난 @\"…\" 는 제외");
  check(A.replacement("query", 'A "B"') === '@"A B"' && A.replacement("filter", "명조:워더링 웨이브") === "명조:워더링 웨이브",
    "검색어는 @\"이름\" 으로, 제외 필터는 이름 그대로 넣는다");

  // ── API 호출·캐시 ──
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => FIXTURE };
  };
  const results = await A.fetchCategories(" grand ");
  await A.fetchCategories("GRAND");
  check(calls.length === 1 &&
    calls[0].url === "https://api.chzzk.naver.com/manage/v1/auto-complete/categories?keyword=grand&size=20" &&
    calls[0].init.credentials === "omit",
    "치지직 자동완성 API 를 size 20 으로 부르고(최대 50), 같은 검색어는 캐시를 쓴다");
  check(JSON.stringify(results) === JSON.stringify([
    { type: "GAME", id: "Grand_Theft_Auto_V", value: "Grand Theft Auto V" },
    { type: "ETC", id: "talk", value: "talk" },
  ]), "결과: 종류·id·표시 이름, 이름이 빈 항목은 뺀다");
  check((await A.fetchCategories("  ")).length === 0 && calls.length === 1, "빈 검색어는 부르지 않는다(API 가 400)");

  // ── 연결 ──
  const manifest = JSON.parse(read("manifest.json"));
  const contentJs = manifest.content_scripts.find((entry) => entry.js.includes("src/content.js")).js;
  check(contentJs.indexOf("src/categoryAutocomplete.js") >= 0 &&
    contentJs.indexOf("src/categoryAutocomplete.js") < contentJs.indexOf("src/content.js"),
    "치지직 페이지: content.js 보다 먼저 싣는다");
  check(manifest.web_accessible_resources.some((entry) => entry.resources.includes("src/categoryAutocomplete.js")),
    "페이지 안 팝업(iframe)에서도 쓸 수 있다");
  for (const [file, before] of [["settings.html", "src/settings.js"], ["popup.html", "src/popup.js"]]) {
    const html = read(file);
    const at = html.indexOf('<script src="src/categoryAutocomplete.js"></script>');
    check(at >= 0 && at < html.indexOf(`<script src="${before}"></script>`), `${file}: ${before} 보다 먼저 싣는다`);
  }
  const settings = read("src/settings.js");
  const popup = read("src/popup.js");
  const content = read("src/content.js");
  check(/CheeseCategoryAutocomplete\?\.attach\(liveTagInput, \{ mode: "filter" \}\)/.test(settings),
    "설정: 라이브 제외 필터 입력창");
  check(/CheeseCategoryAutocomplete\?\.attach\(input, \{ mode: "filter" \}\)/.test(content) &&
    /overlay\.__cheeseDetachCategoryAutocomplete\?\.\(\);\s*overlay\.remove\(\);/.test(content),
    "페이지 안 '제외 필터 추가' 창: 붙이고, 창을 닫을 때 뗀다");
  check(/CheeseCategoryAutocomplete\?\.attach\(elements\.query, \{ mode: "query" \}\)/.test(popup) &&
    /if \(config\.inputPlaceholder\.includes\("@카테고리"\)\) \{\s*globalThis\.CheeseCategoryAutocomplete\?\.attach\(/.test(content),
    "검색창(팝업·페이지 안): @카테고리 를 쓰는 검색창에만");

  // ── 브라우저에서 실제 동작 ──
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-cat-ac-"));
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
    for (let end; (end = buf.indexOf("\0")) >= 0;) {
      const raw = buf.slice(0, end);
      buf = buf.slice(end + 1);
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
    await ev(`(()=>{
      window.fetch = async (url) => { window.__urls = (window.__urls||[]).concat(url);
        return { ok: true, json: async () => (${JSON.stringify(FIXTURE)}) }; };
      document.body.innerHTML = '<form id="f"><input id="filter"></form><input id="query">';
      window.__submits = 0; window.__inputs = 0; window.__keys = 0; window.__outerKeys = 0;
      document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); window.__submits++; });
      return true; })()`);
    await ev(read("src/categoryAutocomplete.js"));
    const result = await ev(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const out = {};
      const filter = document.getElementById('filter');
      CheeseCategoryAutocomplete.attach(filter, { mode: 'filter' });
      filter.addEventListener('input', () => window.__inputs++);
      filter.addEventListener('keydown', () => window.__keys++);
      document.addEventListener('keydown', () => window.__outerKeys++);
      filter.focus();
      filter.value = '명조, gra';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
      out.beforeDebounce = !!document.querySelector('.cheese-cat-ac');
      await wait(300);
      const list = document.querySelector('.cheese-cat-ac');
      out.open = !!list && !list.hidden && filter.getAttribute('aria-expanded') === 'true';
      out.items = [...(list?.querySelectorAll('li') || [])].map((li) => li.textContent);
      out.below = list ? Math.round(list.getBoundingClientRect().top - filter.getBoundingClientRect().bottom) : null;
      key(filter, 'ArrowDown');
      out.active = filter.getAttribute('aria-activedescendant') === list.children[0].id &&
        list.children[0].getAttribute('aria-selected') === 'true';
      key(filter, 'ArrowUp');
      out.backToInput = !filter.hasAttribute('aria-activedescendant');
      key(filter, 'ArrowUp');
      out.wrapLast = list.children[1].getAttribute('aria-selected') === 'true';
      key(filter, 'ArrowDown'); key(filter, 'ArrowDown');
      const inputsBefore = window.__inputs;
      key(filter, 'Enter');
      out.value = filter.value;
      out.inputEvents = window.__inputs - inputsBefore;
      out.keyBlocked = window.__keys === 0 && window.__outerKeys === 0;
      out.closed = !document.querySelector('.cheese-cat-ac') && filter.getAttribute('aria-expanded') === 'false';
      await wait(300);
      out.stayClosed = !document.querySelector('.cheese-cat-ac');
      // 목록이 닫혀 있으면 Enter 는 원래대로(폼 제출 등) 간다.
      key(filter, 'Enter');
      out.enterPassThrough = window.__keys === 1;
      // Esc: 목록만 닫고, 바깥(창 닫기)으로 가지 않는다.
      filter.value = 'gra';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      const outerBefore = window.__outerKeys;
      key(filter, 'Escape');
      out.escClosed = !document.querySelector('.cheese-cat-ac') && window.__outerKeys === outerBefore;
      // 태그('#')는 찾지 않는다.
      const urlsBefore = window.__urls.length;
      filter.value = '#gra';
      filter.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      out.tagSkipped = window.__urls.length === urlsBefore && !document.querySelector('.cheese-cat-ac');
      // 검색어 @카테고리
      const query = document.getElementById('query');
      CheeseCategoryAutocomplete.attach(query, { mode: 'query' });
      query.focus();
      query.value = '제목 @gra';
      query.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      document.querySelector('.cheese-cat-ac li').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      document.querySelector('.cheese-cat-ac li').click();
      out.query = query.value;
      out.queryCaret = query.selectionStart;
      // 포커스가 빠지면 닫힌다.
      query.value = '@gra';
      query.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(300);
      const opened = !!document.querySelector('.cheese-cat-ac');
      query.blur();
      await wait(200);
      out.blurClosed = opened && !document.querySelector('.cheese-cat-ac');
      out.lists = document.querySelectorAll('.cheese-cat-ac').length;
      return out;
    })()`);
    check(result.beforeDebounce === false && result.open && JSON.stringify(result.items) === '["Grand Theft Auto V게임","talk기타"]' &&
      result.below === 4, "입력을 멈추면 입력창 바로 아래에 이름·종류 목록을 띄운다");
    check(result.active && result.backToInput && result.wrapLast, "방향키로 고르고, 처음·끝에서 입력창을 거쳐 돈다");
    check(result.value === "명조, Grand Theft Auto V" && result.inputEvents === 1 && result.keyBlocked && result.closed &&
      result.stayClosed, "Enter: 마지막 항목만 바꾸고 input 이벤트를 한 번 보낸다. 그 키는 폼·창으로 가지 않고 목록은 다시 열리지 않는다");
    check(result.enterPassThrough, "목록이 닫혀 있으면 Enter 는 원래대로 간다(추가·검색)");
    check(result.escClosed, "Esc: 목록만 닫는다(창은 그대로)");
    check(result.tagSkipped, "'#' 로 시작하면(태그) 찾지 않는다");
    check(result.query === '제목 @"Grand Theft Auto V" ' && result.queryCaret === result.query.length,
      "검색어: 클릭으로 @\"이름\" 을 넣고 커서를 뒤로 옮긴다");
    check(result.blurClosed && result.lists === 0, "포커스가 빠지면 닫고, 닫힌 목록은 DOM 에 남기지 않는다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
