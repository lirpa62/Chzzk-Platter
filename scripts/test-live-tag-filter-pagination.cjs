// 라이브 목록 제외 필터를 켜면 스크롤해도 다음 채널을 불러오지 않던 문제.
//
// 치지직 라이브 목록(실측 2026-10-09, flex 목록 카드 40개)은 끝에서 10번째 카드의 첫 자식으로
// 빈 <div style="position:absolute; left:0"> 를 두고, 그 div 가 화면에 들어오면 다음 묶음을
// 부른다. 그 카드가 제외 대상이면 display:none 이라 div 가 화면에 들어오지 않아 멈췄다
// (실측: 숨긴 카드 0,1,2,4,7,10,11,13,23,29,30,31,32,38 — 감지 지점이 든 30번이 숨김).
// 예전 보정은 마지막 카드만 1px 로 남겼고, 그 자리도 flex 목록의 맨 위였다.
// 실제 IntersectionObserver 로 확인한다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const contentCss = readFileSync(path.join(ROOT, "src/content.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const css = contentCss.slice(
  contentCss.indexOf(".cheese-live-tag-filter-hidden,\n"),
  contentCss.indexOf("}", contentCss.indexOf(".cheese-live-tag-filter-hidden.cheese-live-tag-filter-pagination-anchor,")) + 1,
);
const HIDDEN = [0, 1, 2, 4, 7, 10, 11, 13, 23, 29, 30, 31, 32, 38];

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-ltf-page-"));
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
    await call("Emulation.setDeviceMetricsOverride", { width: 1300, height: 958, deviceScaleFactor: 1, mobile: false }, sessionId);
    // 측정한 모양: flex 줄바꿈 목록, 한 줄 3장(411×306).
    const run = (fix) => ev(`(async () => {
      document.head.innerHTML = '<style>' + ${JSON.stringify(css)} +
        'body{margin:0} ul{display:flex;flex-wrap:wrap;gap:12px;width:1260px;margin:0;padding:0} li{list-style:none;width:411px;height:306px;background:#ddd}</style>';
      let html = '<div style="height:200px"></div><ul>';
      for (let i = 0; i < 40; i++) {
        html += '<li>' + (i === 30 ? '<div style="position: absolute; left: 0px;"></div>' : '') +
          '<a href="/live/' + i + '">카드 ' + i + '</a></li>';
      }
      document.body.innerHTML = html + '</ul><div style="height:40px"></div>';
      const LIVE_TAG_FILTER_HIDDEN_CLASS = "cheese-live-tag-filter-hidden";
      const LIVE_TAG_FILTER_PAGINATION_CLASS = "cheese-live-tag-filter-pagination-anchor";
      const LIVE_TAG_FILTER_ANCHOR_LIST_CLASS = "cheese-live-tag-filter-anchor-list";
      ${sliceFn("isLiveTagFilterCardHidden")}
      ${sliceFn("hideLiveTagFilterCard")}
      ${sliceFn("isLivePaginationSentinel")}
      ${sliceFn("preserveLiveTagFilterPaginationAnchors")}
      const cards = [...document.querySelectorAll('li')];
      const hidden = new Set(${JSON.stringify(HIDDEN)}.map((i) => cards[i]));
      hidden.forEach(hideLiveTagFilterCard);
      if (${fix}) preserveLiveTagFilterPaginationAnchors(hidden);
      scrollTo(0, document.documentElement.scrollHeight);
      const sentinel = cards[30].firstElementChild;
      const seen = await new Promise((resolve) => {
        const io = new IntersectionObserver((entries) => { io.disconnect(); resolve(entries[0].isIntersecting); });
        io.observe(sentinel);
      });
      const ul = document.querySelector('ul').getBoundingClientRect();
      const anchor = cards[30].getBoundingClientRect();
      const visible = cards.filter((c) => !hidden.has(c));
      return {
        seen,
        anchored: cards[30].classList.contains(LIVE_TAG_FILTER_PAGINATION_CLASS),
        others: cards.filter((c) => c !== cards[30] && c.classList.contains(LIVE_TAG_FILTER_PAGINATION_CLASS)).length,
        ulBottom: Math.round(ul.bottom), anchorBottom: Math.round(anchor.bottom), anchorTop: Math.round(anchor.top),
        ulHeight: Math.round(ul.height),
        lastVisibleBottom: Math.round(visible.at(-1).getBoundingClientRect().bottom),
        firstVisibleLeft: Math.round(visible[0].getBoundingClientRect().left),
      };
    })()`);
    const before = await run(false);
    check(before.seen === false, `수정 전 재현: 감지 지점이 든 카드를 숨기면 맨 아래로 내려도 감지 지점이 안 보인다 ${JSON.stringify(before)}`);
    const after = await run(true);
    check(after.seen === true && after.anchored,
      `감지 지점이 든 숨긴 카드는 1px 관찰 지점으로 남아, 맨 아래로 내리면 감지된다 ${JSON.stringify(after)}`);
    check(after.anchorBottom === after.ulBottom, "관찰 지점은 목록 맨 아래에 있다(flex 목록 맨 위가 아니다)");
    check(after.ulHeight === before.ulHeight && after.lastVisibleBottom === before.lastVisibleBottom &&
      after.firstVisibleLeft === before.firstVisibleLeft,
      "관찰 지점은 레이아웃을 바꾸지 않는다(목록 높이·보이는 카드 자리 그대로)");
    check(after.others === 0, "마지막 카드가 보이면 감지 지점이 든 카드만 남긴다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  check(/document\s*\.querySelectorAll\(`\.\$\{LIVE_TAG_FILTER_ANCHOR_LIST_CLASS\}`\)\s*\.forEach\(\(list\) => list\.classList\.remove\(LIVE_TAG_FILTER_ANCHOR_LIST_CLASS\)\);/.test(content),
    "필터를 다시 적용하거나 끄면 목록 기준점도 지운다");

  // 가짜 scroll: 같은 관찰 지점이면 다시 보내지 않는다. 미리보기는 가짜 scroll 을 무시한다.
  // (팔로잉 LIVE 실측: 미리보기 열림 → 0.3초 뒤 #document/html/body scroll → 닫힘.)
  {
    const vm = require("node:vm");
    const sent = [];
    const target = () => ({ dispatchEvent: (event) => sent.push(event.type) });
    const card = { isConnected: true, parentElement: null };
    const ctx = {
      window: target(), document: Object.assign(target(), { documentElement: target(), body: target() }),
      Event: class { constructor(type) { this.type = type; } },
      requestAnimationFrame: (fn) => { fn(); return 0; }, // 바로 돌린다(돌고 나면 대기 표시도 풀린다)
      getComputedStyle: () => ({ overflowY: "visible" }),
      getLiveTagFilterPageKind: () => "following",
      liveTagFilters: ["게임"],
    };
    vm.runInNewContext(`
      let liveTagFilterPaginationFrame = 0;
      ${content.slice(content.indexOf("  const liveTagFilterPaginationNotified"), content.indexOf("\n", content.indexOf("  const liveTagFilterPaginationNotified")))}
      ${sliceFn("scheduleLiveTagFilterPaginationCheck")}
      this.run = scheduleLiveTagFilterPaginationCheck;`, vm.createContext(ctx));
    ctx.run(card);
    const first = sent.length;
    ctx.run(card);
    ctx.run(card);
    check(first === 4 && sent.length === 4, `같은 관찰 지점에는 가짜 scroll 을 한 번만 보낸다(${first} → ${sent.length})`);
    ctx.run({ isConnected: true, parentElement: null });
    check(sent.length === 8, "관찰 지점이 바뀌면(새 묶음) 다시 보낸다");
  }
  check(/function onFollowPreviewScroll\(e\) \{[\s\S]{0,400}if \(!e\.isTrusted\) return;\s*const t = e\.target;/.test(content),
    "카드·사이드바 미리보기는 스크립트가 보낸 scroll 에 닫히지 않는다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
