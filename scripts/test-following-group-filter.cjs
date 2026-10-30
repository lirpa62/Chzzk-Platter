// 팔로잉 화면 그룹 필터: 탭 아래 전용 팔로잉 그룹·즐겨찾기 칩, 고르면 그 그룹 채널 카드만.
// 치지직 목록을 새로 그리지 않고 제외 필터와 같은 숨김(다음 묶음 관찰 지점 포함)을 쓴다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

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
const sliceConst = (name) => {
  const at = content.indexOf(`  const ${name} =`);
  assert.ok(at >= 0, name);
  return content.slice(at, content.indexOf(";\n", at) + 2);
};

const A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32), D = "d".repeat(32);
const liveCard = (id, extra = "") => `<li class="_item_x">${extra}<div class="_container_x"><a href="/live/${id}" class="_thumbnail_x">썸네일</a><a href="/${id}">채널</a></div></li>`;
const FIXTURE = `
<div id="layout-body"><main>
  <div class="_filter_x"><div role="tablist"><button role="tab" id="ALL" style="font-family: Pretendard, serif">전체</button><button role="tab" id="LIVE" aria-selected="true">라이브</button></div></div>
  <ul id="lives">${liveCard(A)}${liveCard(B, '<div style="position:absolute;left:0"></div>')}${liveCard(C)}${liveCard(D)}</ul>
  <ul id="videos"><li><a href="/video/111">영상</a><a href="/${A}">채널A</a></li><li><a href="/video/222">영상</a><a href="/${B}">채널B</a></li><li><a href="/video/333">영상(채널 없음)</a></li></ul>
  <div id="channels"><div class="_wrapper_x"><a href="/${A}"><img alt=""></a><a href="/${A}">이름A</a></div><div class="_wrapper_x"><a href="/${C}"><img alt=""></a><a href="/${C}">이름C</a></div></div>
</main></div>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-fgf-"));
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
    const result = await ev(`(() => {
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      document.body.innerHTML = ${JSON.stringify(FIXTURE)};
      const IS_TOP_FRAME = true;
      const location = { pathname: '/following', search: '?tab=LIVE' };
      const featureFlags = { sbFollowCustom: true, sbFollowFavEnabled: true, sbFollowGroupEnabled: true };
      const customFollowFavorites = new Set(['${C}']);
      let customFollowGroups = [{ id: 'g1', name: '모임', icon: 'folder', color: '#ff0000', channelIds: ['${A}', '${B}'] },
        { id: 'empty', name: '빈', icon: 'folder', color: '#00ff00', channelIds: [] }];
      const sanitizeCustomFollowGroupColor = (c) => c;
      const escapeAttribute = (v) => String(v).replace(/"/g, '&quot;');
      const escapeHtml = (v) => String(v).replace(/</g, '&lt;');
      const customFollowLucideIcon = () => '<svg></svg>';
      const activeLiveTagFilters = () => [];
      const getLiveTagFilterPageKind = () => 'following';
      const liveTagFilters = [];
      let liveTagFilterPaginationFrame = 0;
      const liveTagFilterPaginationNotified = new WeakSet();
      const normalizeLiveTagFilter = (v) => v;
      const getLiveFilterValuesFromNode = () => [];
      const chrome = { storage: { local: { set() {} } } };
      ${sliceConst("LIVE_TAG_FILTER_HIDDEN_CLASS")}
      ${sliceConst("LIVE_TAG_FILTER_PAGINATION_CLASS")}
      ${sliceConst("LIVE_TAG_FILTER_ANCHOR_LIST_CLASS")}
      ${sliceConst("FOLLOWING_GROUP_BAR_CLASS")}
      ${sliceConst("FOLLOWING_CARD_LINK")}
      ${sliceConst("FOLLOWING_CARD_HREF")}
      let followingGroupFilterOn = true;
      let followingGroupFilterSelected = '';
      // 채널 탭 정렬·상태 필터는 test-following-channel-view.cjs 가 본다(여기는 라이브 탭).
      let followingChannelToolsOn = true;
      let followingChannelCountText = '';
      const isFollowingChannelPage = () => false;
      const applyFollowingChannelView = () => {};
      ${["isFollowingPage", "followingGroupFilterChoices", "followingGroupSelectedIds", "followingGroupFilterChannelIds", "followingCardChannelId",
        "findFollowingFilterCards", "findLiveTagFilterTablist", "ensureFollowingGroupBar", "setFollowingGroupFilter",
        "clearHiddenLiveTagFilterCards", "hideLiveTagFilterCard", "isLivePaginationSentinel",
        "preserveLiveTagFilterPaginationAnchors", "scheduleLiveTagFilterPaginationCheck", "applyLiveTagFilters"].map(sliceFn).join("\n")}
      // 숨김 클래스가 없는 카드의 이름(라이브=채널 글자, 다시보기·채널=링크 글자).
      const label = (card) => card.querySelector('a[href^="/live/"]')?.getAttribute('href').slice(6, 7) ||
        [...card.querySelectorAll('a')].at(-1).textContent;
      const shown = () => [...findFollowingFilterCards(document.querySelector('#layout-body'))]
        .filter((card) => !card.classList.contains(LIVE_TAG_FILTER_HIDDEN_CLASS)).map(label);
      const out = {};
      ensureFollowingGroupBar();
      const bar = document.querySelector('.cheese-following-group-bar');
      out.bar = bar && bar.previousElementSibling.classList.contains('_filter_x') ?
        [...bar.querySelectorAll('[data-cf-follow-filter]')].map((b) => b.dataset.cfFollowFilter + ':' + b.getAttribute('aria-pressed')).join(',') : null;
      out.font = bar.style.fontFamily;
      out.cards = findFollowingFilterCards(document.querySelector('#layout-body')).size;
      setFollowingGroupFilter('custom:g1');
      out.g1 = shown();
      out.anchor = document.querySelector('#lives li:nth-child(2)').className + '|' +
        [...document.querySelectorAll('.cheese-live-tag-filter-pagination-anchor')].map((li) => li.querySelector('a[href^="/live/"]')?.getAttribute('href').slice(6, 7)).join(',');
      out.pressed = document.querySelector('[data-cf-follow-filter="custom:g1"]').getAttribute('aria-pressed');
      setFollowingGroupFilter('fav');
      out.fav = shown();
      out.favAnchor = document.querySelector('#lives li:nth-child(2)').classList.contains('cheese-live-tag-filter-pagination-anchor');
      setFollowingGroupFilter('');
      out.all = shown();
      setFollowingGroupFilter('custom:g1');
      customFollowGroups = [];
      ensureFollowingGroupBar();
      applyLiveTagFilters();
      out.removed = followingGroupFilterSelected + '|' + shown().length;
      return out;
    })()`);
    assert.equal(result.bar, ":true,fav:false,custom:g1:false", "탭 막대 바로 아래 칩: 전체·즐겨찾기·그룹(빈 그룹 제외) " + result.bar);
    assert.ok(/Pretendard/.test(result.font), "칩 막대 글꼴은 치지직 탭 버튼과 같게: " + result.font);
    assert.equal(result.cards, 9, "라이브·동영상(li)·채널(li 아닌 목록) 카드를 모두 찾는다");
    assert.deepEqual(result.g1.sort(), ["a", "b", "영상(채널 없음)", "이름A", "채널A", "채널B"].sort(),
      "그룹 채널 카드만 보이고, 채널을 알 수 없는 카드는 그대로: " + JSON.stringify(result.g1));
    assert.equal(result.favAnchor, true, "숨긴 카드가 다음 묶음 감지 지점을 품고 있으면 1px 관찰 지점으로 남긴다");
    assert.equal(result.pressed, "true");
    assert.deepEqual(result.fav.sort(), ["c", "영상(채널 없음)", "이름C"].sort(), "즐겨찾기: " + JSON.stringify(result.fav));
    assert.equal(result.all.length, 9, "전체: 모두 보인다 " + JSON.stringify(result.all));
    assert.equal(result.removed.split("|")[0], "", "고른 그룹이 사라지면 전체로");
    assert.equal(Number(result.removed.split("|")[1]), 9, "그룹이 사라지면 다시 모두 보인다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  assert.ok(content.includes("ensureFollowingGroupBar(); // 팔로잉 화면 그룹 필터 칩"), "틱에서 칩 막대를 맞춘다");
  assert.ok(content.includes("const groupIds = followingGroupFilterChannelIds();"), "제외 필터와 같은 적용 경로");
  assert.ok(settingsHtml.includes("data-following-group-filter") &&
    settingsJs.includes('["[data-following-group-filter]", "cheeseFollowingGroupFilter", true],'), "설정 스위치(기본 켬)");
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
