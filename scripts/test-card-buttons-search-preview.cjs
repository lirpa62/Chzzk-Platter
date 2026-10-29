// 카드 버튼(다시보기 보관함·재생목록·클립 별표): 통합검색에도 달고, 미리보기 재생에 덮이지 않게.
//
// - 통합검색(/search)의 동영상·클립 카드에는 버튼이 없었다. 카드 버튼을 다는 페이지 판정에 통합검색이 빠져
//   있었다(보관함 패널을 두는 목록만 봤다). 클립은 우리가 그리는 카드의 표지 링크(빈 a)에 단다.
// - /videos 는 썸네일에 마우스를 올리면 링크 안에 미리보기 플레이어 상자(position:absolute; z-index:5)를 끼워
//   넣는다(실측). 버튼 z-index 가 2~3 이라 덮여서 사라진 것처럼 보였다. 버튼을 6 으로 올린다.
// - 통합검색 동영상 카드는 위쪽 배지('N회 시청된 라이브' 등)가 길어 오른쪽 위 버튼과 겹쳐, 왼쪽 아래에 둔다.
// - 통합검색 클립 카드는 목록을 그린 즉시 버튼을 단다(유휴 패스를 기다리면 한참 뒤에 붙었다).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/content.css"), "utf8");
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

check(/function isVideoVaultCardPage\(\) \{\s*return isVideoVaultListPage\(\) \|\| isIntegratedSearchCardPage\(\);/.test(content) &&
  /return location\.pathname === "\/search";/.test(sliceFn("isIntegratedSearchCardPage")),
  "다시보기 카드 버튼 페이지에 통합검색(/search)을 넣는다");
check(/if \(!isVideoVaultCardPage\(\)\) return \[\];/.test(sliceFn("videoVaultCardLinks")) &&
  /!isVideoVaultCardPage\(\)\) \{\s*clearVideoVaultCardDecorations/.test(sliceFn("ensureVideoVaultCardButtons")) &&
  /if \(isVideoVaultCardPage\(\)\) \{\s*for \(const link of videoVaultCardLinks\(\)\)/.test(sliceFn("ensurePlaylistCardButtons")),
  "보관함 버튼·재생목록 버튼 모두 같은 판정을 쓴다");
check(/markCardButtonsPlacement\(link\);/.test(sliceFn("ensureVideoVaultCardButtons")) &&
  /markCardButtonsPlacement\(link\);/.test(sliceFn("ensurePlaylistCardButtons")),
  "보관함·재생목록 버튼 모두 통합검색 동영상 카드에 왼쪽 아래 표시를 남긴다");
check(!/isIntegratedSearchCardPage|isVideoVaultCardPage/.test(sliceFn("findVideoVaultHost")),
  "보관함 패널(목록 위 버튼)은 통합검색에 두지 않는다");
check(/location\.pathname === "\/search"/.test(sliceFn("isClipCardListPage")) &&
  !sliceFn("clipVaultCardLinks").includes("cheese-search-integrated-clips-list"),
  "클립 별표·재생목록 버튼은 치지직 검색 클립 카드에 단다(지운 통합검색 클립 보강 목록은 찾지 않는다)");

const zOf = (selector) => {
  const at = css.indexOf(selector + " {");
  assert.ok(at >= 0, selector);
  const block = css.slice(at, css.indexOf("}", at));
  return Number((block.match(/z-index:\s*(\d+)/) || [])[1]);
};
for (const sel of [".cheese-video-vault-archive", ".cheese-clip-vault-star", ".cheese-playlist-card-add", ".cheese-clip-vault-like-badge"]) {
  const z = sel === ".cheese-video-vault-archive"
    ? Number((css.slice(css.indexOf(".cheese-video-vault-del,\n.cheese-video-vault-archive {")).match(/z-index:\s*(\d+)/) || [])[1])
    : zOf(sel);
  check(z > 5, `${sel} z-index ${z} > 치지직 미리보기 5`);
}

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-card-btn-"));
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
    const top = await ev(`(() => {
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      document.body.innerHTML = '<a href="/video/1" data-cheese-video-vault="1" data-cheese-playlist-card="1" style="position:relative;display:block;width:320px;height:180px;z-index:0;background:#333">' +
        '<div id="preview" style="position:absolute;inset:0;z-index:5;background:#000"></div>' +
        '<button class="cheese-playlist-card-add" id="pl">+</button>' +
        '<button class="cheese-video-vault-archive" id="vault" style="position:absolute;top:8px;right:8px">v</button></a>';
      const hit = (id) => { const r = document.getElementById(id).getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el?.id || el?.tagName; };
      return { pl: hit('pl'), vault: hit('vault') };
    })()`);
    check(top.pl === "pl" && top.vault === "vault", `미리보기 상자(z 5)가 떠도 버튼이 맨 위 ${JSON.stringify(top)}`);
    // 통합검색 동영상 카드: 위쪽 긴 배지와 겹치지 않게 왼쪽 아래.
    const place = await ev(`(() => {
      document.body.innerHTML = '<a href="/video/2" data-cheese-video-vault="1" data-cheese-playlist-card="1" data-cheese-card-buttons="bottom-left" style="position:relative;display:block;width:320px;height:180px">' +
        '<div id="badge" style="position:absolute;top:8px;left:8px;right:8px;height:24px">다시보기 1.2만회 시청된 라이브</div>' +
        '<button class="cheese-video-vault-archive" id="vault">v</button><button class="cheese-playlist-card-add" id="pl">+</button></a>';
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const card = r('pl').top - document.querySelector('a').getBoundingClientRect().top;
      const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      const a = document.querySelector('a').getBoundingClientRect();
      return { vault: [r('vault').left - a.left, a.bottom - r('vault').bottom], pl: [r('pl').left - a.left, a.bottom - r('pl').bottom], hitBadge: overlap(r('vault'), r('badge')) || overlap(r('pl'), r('badge')), plRightOfVault: r('pl').left >= r('vault').right, top: card };
    })()`);
    check(!place.hitBadge && place.vault[0] === 8 && place.plRightOfVault && place.top > 100,
      `통합검색 동영상 카드는 왼쪽 아래(배지와 겹치지 않음, 재생목록은 보관함 오른쪽) ${JSON.stringify(place)}`);

    // 치지직 새 검색 화면(2026-10-29 실측 구조): 클립 카드는 section#search-panel-… > ul > li > a._link_,
    // 동영상 카드는 통합 탭이 작은 가로형(_horizontal_), 동영상 탭이 큰 세로형(_vertical_).
    const real = await ev(`(() => {
      const CLIP_VAULT_PANEL_ID = "cheese-clip-vault-panel";
      const isIntegratedSearchCardPage = () => true;
      const CARD_BUTTONS_PLACE_ATTR = "data-cheese-card-buttons";
      // about:blank 은 origin 이 없어 주소 해석 함수 대신 같은 뜻의 간단한 것을 쓴다(선택자·자리 판단을 본다).
      const clipUidFromHref = (href) => (String(href || "").match(/^\\/clips\\/([^/?#]+)/) || [])[1] || "";
      const videoNoFromHref = (href) => (String(href || "").match(/^\\/video\\/(\\d+)/) || [])[1] || "";
      ${["clipVaultCardLinks", "markCardButtonsPlacement"].map(sliceFn).join("\n")}
      document.body.innerHTML =
        '<section id="search-panel-recommend"><section><ul class="_list_1sxyy_1"><li><a class="_link_1sxyy_18" href="/clips/n8cgu2JFZp"><div class="_container_2rytm_6 _is_vertical_2rytm_25"><strong class="_title_2rytm_104">클립</strong></div></a></li></ul>' +
        '<ul class="_list_anvim_53"><li class="_item_anvim_72"><div class="_container_195e3_2 _horizontal_195e3_14 _is_search_195e3_230"><a class="_thumbnail_195e3_10" href="/video/15840761" id="small"></a></div></li></ul></section></section>' +
        '<section id="search-panel-clip"><section><ul class="_list_1sxyy_1"><li><a class="_link_1sxyy_18" href="/clips/AbC_12-xyz"></a></li></ul></section></section>' +
        '<section id="search-panel-video"><section><ul class="_list_anvim_53 _is_dense_anvim_69"><li class="_item_anvim_72"><div class="_container_195e3_2 _vertical_195e3_20 _is_search_195e3_230"><a class="_thumbnail_195e3_10" href="/video/14268083" id="big"></a></div></li></ul></section></section>';
      const clips = clipVaultCardLinks().map((a) => a.getAttribute("href"));
      markCardButtonsPlacement(document.getElementById("small"));
      markCardButtonsPlacement(document.getElementById("big"));
      return { clips, small: document.getElementById("small").getAttribute(CARD_BUTTONS_PLACE_ATTR), big: document.getElementById("big").getAttribute(CARD_BUTTONS_PLACE_ATTR) };
    })()`);
    check(JSON.stringify(real.clips) === JSON.stringify(["/clips/n8cgu2JFZp", "/clips/AbC_12-xyz"]),
      `치지직 검색 통합·클립 탭의 클립 카드에 별표·재생목록 버튼을 단다 ${JSON.stringify(real.clips)}`);
    check(real.small === "bottom-left" && real.big === null,
      `검색 동영상 카드: 통합 탭의 작은 가로형은 왼쪽 아래, 동영상 탭의 큰 카드는 원래 자리(오른쪽 위) ${JSON.stringify(real)}`);
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
