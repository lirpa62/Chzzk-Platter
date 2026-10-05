// 팔로잉 전체 탭 '라이브' 더보기 자동 펼치기(설정 > 라이브 탐색, 기본 OFF).
//
// 치지직은 화면 폭에 맞는 개수만 보여 주고(실측 1352px 6개, 1969px 10개), 섹션 아래
// '더보기'(aria-expanded=false)를 누르면 더 펼친다('접기' 없음, 프로그램 클릭도 동작).
// 라이브가 적으면 한 번에 끝나 버튼이 사라지고, 많으면 최대 두 번 누른 뒤 같은 버튼이
// '전체보기'(라이브 탭으로 이동)로 바뀐다 — 그 버튼은 누르지 않는다(2026-10-05 실측).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const settings = read("src/settings.js");
const html = read("settings.html");
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

// 받은 DOM 을 줄인 구조: 헤더(제목·개수·전체보기) + 카드 목록 + 아래 '더보기'.
const FIXTURE = `
<section class="_container_180fh_2">
  <div class="_header_180fh_6"><strong class="_title_180fh_14">라이브</strong><em class="_count_180fh_19">12</em>
    <button type="button" class="_button_180fh_25" id="all">전체보기</button></div>
  <ul class="_list_180fh_39">${'<li class="_item_180fh_53"><div data-nlog-area="following_live.item"></div></li>'.repeat(6)}</ul>
  <div class="_container_f0ab_1"><button class="_button_f0ab_13" type="button" aria-expanded="false" id="more">
    <span class="blind">라이브</span>더보기</button></div>
</section>
<section><div class="_header_x"><strong>다시보기</strong></div><ul><li></li></ul>
  <div><button type="button" aria-expanded="false" id="other">더보기</button></div></section>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-fl-expand-"));
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
    const result = await ev(`(() => {
      const out = {};
      let clicks = [];
      const setup = () => {
        document.body.innerHTML = ${JSON.stringify(FIXTURE)};
        // 치지직처럼 누르면 나머지 카드를 붙이고 버튼을 없앤다.
        document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          clicks.push(b.id);
          if (b.id === 'more') {
            const ul = b.closest('section').querySelector('ul');
            for (let i = 0; i < 6; i++) ul.insertAdjacentHTML('beforeend', '<li><div data-nlog-area="following_live.item"></div></li>');
            b.parentElement.remove();
          }
        }));
      };
      const location = { pathname: '/following' };
      let followingLiveAutoExpand = false;
      const IS_TOP_FRAME = true;
      const followingLiveExpandClicked = new WeakMap();
      const FOLLOWING_LIVE_EXPAND_MAX_CLICKS = 3;
      ${sliceFn("expandFollowingLiveSection")}
      setup();
      expandFollowingLiveSection();
      out.off = clicks.length;
      followingLiveAutoExpand = true;
      expandFollowingLiveSection();
      out.on = clicks.join(',');
      out.cards = document.querySelectorAll('section ul')[0].children.length;
      out.buttonGone = !document.getElementById('more');
      expandFollowingLiveSection();
      out.afterExpanded = clicks.length;
      // 버튼이 남아 있어도(반응 없음) 같은 버튼은 다시 누르지 않는다.
      clicks = [];
      setup();
      const stuck = document.getElementById('more');
      stuck.replaceWith(stuck.cloneNode(true));
      document.getElementById('more').addEventListener('click', () => clicks.push('more'));
      expandFollowingLiveSection();
      expandFollowingLiveSection();
      out.sameButtonOnce = clicks.length;
      // 다시 그려 새 버튼이 생기면 또 누른다.
      clicks = [];
      setup();
      expandFollowingLiveSection();
      out.newButton = clicks.join(',');
      // 라이브가 많을 때: 같은 버튼이 두 번 펼친 뒤 '전체보기'로 바뀐다.
      clicks = [];
      document.body.innerHTML = ${JSON.stringify(FIXTURE)};
      const many = document.getElementById('more');
      let rounds = 0;
      many.addEventListener('click', () => {
        clicks.push(many.textContent.includes('전체보기') ? 'all' : 'more');
        rounds += 1;
        const ul = many.closest('section').querySelector('ul');
        if (rounds <= 2) for (let i = 0; i < 10; i++) ul.insertAdjacentHTML('beforeend', '<li><div data-nlog-area="following_live.item"></div></li>');
        if (rounds === 2) many.innerHTML = '<span class="blind">라이브</span>전체보기';
      });
      for (let i = 0; i < 5; i++) expandFollowingLiveSection();
      out.many = clicks.join(',');
      // 처음부터 '전체보기' 인 아래 버튼도 누르지 않는다.
      clicks = [];
      setup();
      document.getElementById('more').innerHTML = '<span class="blind">라이브</span>전체보기';
      expandFollowingLiveSection();
      out.allButton = clicks.length;
      // 다른 페이지에서는 누르지 않는다.
      clicks = [];
      setup();
      location.pathname = '/lives';
      expandFollowingLiveSection();
      out.otherPage = clicks.length;
      return out;
    })()`);
    check(result.off === 0, "옵션이 꺼져 있으면 누르지 않는다");
    check(result.on === "more" && result.cards === 12 && result.buttonGone,
      "켜져 있으면 '라이브' 섹션 아래 더보기만 누른다(헤더 '전체보기'·다른 섹션 더보기는 아님)");
    check(result.afterExpanded === 1, "펼쳐진 뒤에는 누를 것이 없다");
    check(result.sameButtonOnce === 1, "카드가 늘지 않으면(반응 없음) 같은 버튼을 다시 누르지 않는다");
    check(result.many === "more,more", "라이브가 많으면 펼쳐질 때마다 다시 누르고, '전체보기'로 바뀌면 멈춘다");
    check(result.allButton === 0, "아래 버튼이 '전체보기'면 누르지 않는다(라이브 탭으로 이동하지 않는다)");
    check(result.newButton === "more", "다시 그려 새 버튼이 생기면 다시 누른다");
    check(result.otherPage === 0, "팔로잉 페이지가 아니면 누르지 않는다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // ── 연결 ──
  check(/const FOLLOWING_LIVE_AUTO_EXPAND_KEY = "cheeseFollowingLiveAutoExpand";/.test(content) &&
    /LIVE_TAG_FILTERS_DISABLED_KEY,\s*FOLLOWING_LIVE_AUTO_EXPAND_KEY,\s*LIVE_TAG_FILTER_BUTTON_KEY,/.test(content) &&
    /followingLiveAutoExpand = data\?\.\[FOLLOWING_LIVE_AUTO_EXPAND_KEY\] === true;/.test(content) &&
    /!changes\[FOLLOWING_LIVE_AUTO_EXPAND_KEY\] &&/.test(content) &&
    /LIVE_TAG_FILTERS_DISABLED_KEY,\s*FOLLOWING_LIVE_AUTO_EXPAND_KEY,\s*LIVE_VIEWER_COUNT_POSITION_KEY,/.test(content),
    "치지직 페이지: 읽기·미리 받기·변경 감지(켜면 바로 펼친다)");
  check(/applyLiveTagFilters\(\); \/\/ 새로 렌더된 라이브 카드에도 제외 필터 즉시 적용\s*expandFollowingLiveSection\(\);/.test(content),
    "페이지가 바뀔 때마다(목록을 다시 그려도) 확인한다");
  check(/\["\[data-following-live-auto-expand\]", "cheeseFollowingLiveAutoExpand", false\]/.test(settings) &&
    /SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseFollowingLiveAutoExpand"/.test(settings),
    "설정: 기본 꺼짐, 미리 읽기 목록에 있다(다시 열어도 저장한 값)");
  const filterButton = html.indexOf("data-live-tag-filter-button");
  const toggle = html.indexOf("data-following-live-auto-expand");
  check(toggle > filterButton && toggle < html.indexOf("data-live-viewer-count-position\n") &&
    /팔로잉 라이브 자동 펼치기/.test(html.slice(filterButton, toggle)),
    "설정 > 라이브 탐색: '제외 필터 버튼 표시' 다음");
  check(!/라이브 중인 채널을 모두/.test(html) && /'전체보기'로 바뀌면 그 버튼은 누르지 않습니다/.test(html),
    "설명: '모두' 대신 펼친다, '전체보기'는 누르지 않는다고 적는다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
