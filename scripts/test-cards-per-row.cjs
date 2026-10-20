// 한 줄당 방송 개수: 치지직 목록(ul flex-wrap, 가로 간격 14px)의 카드 li 폭만 CSS 로 바꾼다.
// 2026-10-20 실측: /lives·/following?tab=LIVE|VIDEO 모두 ul(flex, wrap, gap 30px 14px), li 420px × 3(1287px).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/content.css"), "utf8");
const settingsHtml = readFileSync(path.join(ROOT, "settings.html"), "utf8");
const settingsJs = readFileSync(path.join(ROOT, "src/settings.js"), "utf8");
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};

// 대상 페이지
{
  const page = (pathname, search = "") => {
    const ctx = { IS_TOP_FRAME: true, location: { pathname, search }, URLSearchParams };
    vm.createContext(ctx);
    vm.runInContext(sliceFn("cardsPerRowPage") + "\nthis.r=cardsPerRowPage();", ctx);
    return ctx.r;
  };
  assert.equal(page("/lives"), true);
  assert.equal(page("/videos"), true, "전체 동영상도(빠지면 SPA 로 넘어온 값이 잠깐 걸렸다가 풀렸다)");
  assert.equal(page("/following", "?tab=LIVE"), true);
  assert.equal(page("/following", "?tab=VIDEO"), true);
  assert.equal(page("/following", "?tab=ALL"), false, "팔로잉 전체 탭은 치지직이 칸 수에 맞춰 개수를 정해 두어 뺀다");
  assert.equal(page("/following"), false);
  assert.equal(page("/category/GAME/OVERWATCH/lives"), true);
  assert.equal(page("/category/GAME/OVERWATCH/videos"), true);
  assert.equal(page("/"), false);
}

const card = (id, cls = "") => `<li class="_item_x ${cls}"><a href="/live/${id.repeat(32)}">방송</a></li>`;
const FIXTURE = `<style>
  ._list_x { display:flex; flex-wrap:wrap; gap:30px 14px; width:1287px; margin:0; padding:0; list-style:none; }
  ._item_x { width:419px; flex:none; height:40px; }
</style>
<div id="layout-body"><ul class="_list_x">${["a", "b", "c", "d", "e", "f"].map((id) => card(id)).join("")}${card("g", "cheese-live-tag-filter-hidden cheese-live-tag-filter-pagination-anchor")}</ul>
<ul class="_list_y"><li class="_item_x"><a href="/other">다른 목록</a></li></ul>
<ul class="_list_x" id="sentinelList">${Array.from({ length: 30 }, (_, i) => `<li class="_item_x">${i === 20 ? '<div style="position: absolute; left: 0px;"></div>' : ""}<a href="/video/${i + 1}">영상</a></li>`).join("")}</ul>
<section><ul class="_list_x" id="followList">${Array.from({ length: 30 }, (_, i) => `<li class="_item_x"><a href="/video/${i + 1}">영상</a></li>`).join("")}</ul><div id="followSentinel"></div></section>
<ul class="_list_x" id="videosList">${Array.from({ length: 30 }, (_, i) => `<li class="_item_x"><a href="/video/${i + 1}">영상</a>${i === 29 ? '<div id="videosSentinel"></div>' : ""}</li>`).join("")}</ul></div>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-cpr-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "", seq = 0;
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
    const measure = (n) => ev(`(() => {
      const root = document.documentElement;
      document.querySelectorAll('ul._list_x').forEach((ul) => { if (ul.querySelector(':scope > li a[href^="/live/"], :scope > li a[href^="/video/"]')) ul.dataset.cheeseCardsList = ''; });
      if (${n}) { root.dataset.cheeseCardsPerRow = '${n}'; root.style.setProperty('--cheese-cards-per-row', '${n}'); }
      else { delete root.dataset.cheeseCardsPerRow; root.style.removeProperty('--cheese-cards-per-row'); }
      const items = [...document.querySelector('._list_x').children];
      const shown = items.filter((li) => !li.classList.contains('cheese-live-tag-filter-hidden'));
      const rows = new Set(shown.map((li) => Math.round(li.getBoundingClientRect().top)));
      const firstRow = shown.filter((li) => Math.round(li.getBoundingClientRect().top) === Math.round(shown[0].getBoundingClientRect().top)).length;
      return { w: Math.round(shown[0].getBoundingClientRect().width * 10) / 10, firstRow, rows: rows.size,
        anchorW: items.at(-1).getBoundingClientRect().width,
        other: Math.round(document.querySelector('._list_y > li').getBoundingClientRect().width) };
    })()`);
    await ev(`(() => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      document.body.innerHTML = ${JSON.stringify(FIXTURE)}; return true; })()`);
    const auto = await measure(0);
    assert.ok(auto.w === 419 && auto.firstRow === 3, "자동: 치지직 그대로 " + JSON.stringify(auto));
    const five = await measure(5);
    assert.ok(Math.abs(five.w - (1287 - 4 * 14) / 5) < 0.5 && five.firstRow === 5 && five.rows === 2,
      "5개: 간격을 빼고 똑같이 나눈다 " + JSON.stringify(five));
    assert.equal(five.anchorW, 1, "숨긴 카드의 1px 관찰 지점은 그대로");
    assert.equal(five.other, 419, "라이브·다시보기 카드가 없는 다른 목록은 건드리지 않는다(표시 없는 목록)");
    // 다음 묶음 감지 지점(목록마다 다른 세 모양): 한 줄 4개 이상이면 화면 두 개 앞으로,
    // 지금 화면 위보다는 올리지 않는다. 목록이 늘면 제자리로 돌렸다가 다시 올린다.
    const lead = await ev(`(async () => {
      const IS_TOP_FRAME = true;
      let cardsPerRow = 7;
      ${["isLivePaginationSentinel", "isBlankSentinelCandidate", "cardsPerRowSentinelCandidates", "clearSentinelLead",
        "markCardsPerRowLists", "leadCardsPerRowSentinels"].map(sliceFn).join("\n")}
      const CARDS_PER_ROW_LEAD_SCREENS = 2;
      const CARDS_PER_ROW_TAIL = 12;
      const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
      const root = document.documentElement;
      root.dataset.cheeseCardsPerRow = '7'; root.style.setProperty('--cheese-cards-per-row', '7');
      document.body.style.paddingTop = (innerHeight * 4) + 'px';
      const lives = document.querySelector('#sentinelList div[style*="absolute"]');
      const follow = document.getElementById('followSentinel');
      const videos = document.getElementById('videosSentinel');
      const tops = () => [lives, follow, videos].map((el) => el.getBoundingClientRect().top);
      const before = tops();
      leadCardsPerRowSentinels();
      const zero = [lives, follow, videos].map((el) => el.style.getPropertyValue('--cheese-sentinel-lead'));
      await frames();
      const moved = tops().map((t, i) => Math.round(before[i] - t));
      // 목록이 늘면(같은 요소가 남는 팔로잉 모양) 제자리로 돌렸다가 다시 올린다.
      const followList = document.getElementById('followList');
      followList.insertAdjacentHTML('beforeend', '<li class="_item_x"><a href="/video/99">새 영상</a></li>');
      leadCardsPerRowSentinels();
      const reset = follow.style.getPropertyValue('--cheese-sentinel-lead');
      await frames();
      const again = follow.style.getPropertyValue('--cheese-sentinel-lead');
      // 감지 지점이 화면 가까이 있으면 화면 맨 위에서 멈춘다.
      window.scrollTo(0, follow.getBoundingClientRect().top + scrollY - innerHeight / 2 + 2 * innerHeight);
      followList.insertAdjacentHTML('beforeend', '<li class="_item_x"><a href="/video/100">새 영상</a></li>');
      leadCardsPerRowSentinels();
      await frames();
      const clamped = Math.round(follow.getBoundingClientRect().top);
      // 3개 이하로 바꾸면 모두 걷는다.
      cardsPerRow = 3; leadCardsPerRowSentinels();
      const cleared = document.querySelectorAll('[data-cheese-sentinel-lead]').length;
      window.scrollTo(0, 0); document.body.style.paddingTop = '';
      return { moved, screens: Math.round(innerHeight * 2), zero, reset, again, clamped, cleared };
    })()`);
    assert.deepEqual(lead.zero, ["0px", "0px", "0px"], "처음엔 제자리로 표시 " + JSON.stringify(lead));
    assert.deepEqual(lead.moved, [lead.screens, lead.screens, lead.screens],
      "세 모양(/lives·팔로잉 동영상·/videos) 모두 화면 두 개 앞으로 " + JSON.stringify(lead));
    assert.ok(lead.reset === "0px" && lead.again === `${lead.screens}px`, "목록이 늘면 제자리로 돌렸다가 다시 올린다 " + JSON.stringify(lead));
    assert.ok(lead.clamped >= 0 && lead.clamped <= 2, "지금 화면 위보다는 올리지 않는다 " + JSON.stringify(lead));
    assert.equal(lead.cleared, 0, "3개 이하로 바꾸면 모두 걷는다");
    // 화면 밖 카드는 배치 계산을 건너뛰고(content-visibility), 끝쪽 12개는 늘 그린다.
    const cv = await ev(`(() => {
      ${sliceFn("markCardsPerRowLists")}
      const CARDS_PER_ROW_TAIL = 12;
      markCardsPerRowLists();
      const items = [...document.getElementById('followList').children];
      return { first: getComputedStyle(items[0]).contentVisibility, lastKept: getComputedStyle(items.at(-1)).contentVisibility,
        twelfth: getComputedStyle(items.at(-12)).contentVisibility, thirteenth: getComputedStyle(items.at(-13)).contentVisibility };
    })()`);
    assert.deepEqual(cv, { first: "auto", lastKept: "visible", twelfth: "visible", thirteenth: "auto" },
      "화면 밖 카드는 건너뛰고 끝쪽 12개(감지 지점)는 늘 그린다 " + JSON.stringify(cv));
    // 카드가 붙으면 끝쪽 표시를 옮긴다.
    const moved = await ev(`(() => {
      ${sliceFn("markCardsPerRowLists")}
      const CARDS_PER_ROW_TAIL = 12;
      const list = document.getElementById('followList');
      list.insertAdjacentHTML('beforeend', Array.from({ length: 5 }, (_, i) => '<li class="_item_x"><a href="/video/' + (500 + i) + '">새</a></li>').join(''));
      markCardsPerRowLists();
      const items = [...list.children];
      return { tail: items.filter((li) => li.dataset.cheeseCardTail !== undefined).length,
        lastTagged: items.at(-1).dataset.cheeseCardTail !== undefined, oldUntagged: items.at(-13).dataset.cheeseCardTail === undefined };
    })()`);
    assert.deepEqual(moved, { tail: 12, lastTagged: true, oldUntagged: true }, "카드가 붙으면 끝쪽 표시를 옮긴다 " + JSON.stringify(moved));
    const two = await measure(2);
    assert.ok(two.firstRow === 2 && Math.abs(two.w - (1287 - 14) / 2) < 0.5, "2개 " + JSON.stringify(two));
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  assert.ok(content.includes("applyCardsPerRow(); // 한 줄당 방송 개수"), "틱에서 페이지마다 켜고 끈다");
  assert.ok(!css.includes(":not(:nth-last-child(-n + 12))"), "끝쪽 카드는 :nth-last-child 로 고르지 않는다(붙을 때마다 전체 다시 계산)");
  assert.ok(!/cheese-cards-per-row[\s\S]{0,200}:has\(/.test(css.slice(css.indexOf("html[data-cheese-cards-per-row]"), css.indexOf("html[data-cheese-cards-per-row]") + 600)),
    "카드 폭 규칙에 :has() 를 쓰지 않는다(카드가 붙을 때마다 다시 따져 멈춤)");
  assert.ok(settingsHtml.includes("data-cards-per-row") && settingsJs.includes('"cheeseCardsPerRow",\n    ["0", "2", "3", "4", "5", "6", "7"],'),
    "설정: 자동 + 2~7");
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
