// 라이브 제외 필터 항목별 켜기/끄기 — 전체 방송·팔로잉 따로.
//
// 항목을 지우지 않고 끌 수 있고, 전체 방송(/lives)과 팔로잉(/following 전체·라이브 탭)을 항목마다
// 따로 켜고 끈다. 꺼 둔 항목은 정규화한 키로 따로 저장한다:
//   cheeseLiveTagFiltersDisabled          = 전체 방송에서 끈 항목(예전부터 있던 키 — 예전 버전도 읽는다)
//   cheeseLiveTagFiltersFollowingDisabled = 팔로잉에서 끈 항목
// 팔로잉 키가 없으면(예전 버전에서 꺼 둔 항목은 두 곳 모두 꺼져 있었다) 전체 방송 키를 그대로 옮긴다.
// 창 머리의 열 스위치는 그 곳의 항목을 모두 켜고 끈다. 꺼 둔 항목을 다시 추가하면 두 곳 모두 켠다.
// 페이지 안 창(content.js)은 실제 브라우저에서 원본 구간을 그대로 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 90000).unref();

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const settings = read("src/settings.js");
const settingsHtml = read("settings.html");
const contentCss = read("src/content.css");
const settingsCss = read("src/settings.css");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const section = content.slice(
  content.indexOf("  // ── 전체 방송·팔로잉 라이브 제외 필터"),
  content.indexOf("  function normalizeCustomFollowTags("),
);

// ── 설정 페이지(같은 키·같은 규칙) ──
check(/const LIVE_TAG_FILTERS_FOLLOWING_DISABLED_KEY = "cheeseLiveTagFiltersFollowingDisabled";/.test(settings) &&
  /"cheeseLiveTagFiltersFollowingDisabled",/.test(settings.slice(0, settings.indexOf("];"))) &&
  /key === "cheeseLiveTagFiltersDisabled" \|\| key === "cheeseLiveTagFiltersFollowingDisabled"/.test(settings),
  "설정: 같은 키, 설정 저장 목록·내보내기/불러오기에 포함");
check(/data-live-tag-scope="\$\{scope\}"/.test(settings) && /toggle\("lives", onLives\)\}\$\{toggle\("following", onFollowing\)\}/.test(settings) &&
  /data-live-tag-scope-all="lives"/.test(settingsHtml) && /data-live-tag-scope-all="following"/.test(settingsHtml),
  "설정: 행마다 전체 방송·팔로잉 스위치, 열 머리 '모두' 스위치");
check(/const disabled = settingsLiveTagDisabledFor\(toggle\.dataset\.liveTagScope\);/.test(settings) &&
  /\[LIVE_TAG_FILTERS_FOLLOWING_DISABLED_KEY\]: \[\.\.\.settingsLiveTagFollowingDisabled\]/.test(settings) &&
  /hasFollowing \? data\[LIVE_TAG_FILTERS_FOLLOWING_DISABLED_KEY\] : \[\.\.\.settingsLiveTagDisabled\]/.test(settings) &&
  /changes\[LIVE_TAG_FILTERS_FOLLOWING_DISABLED_KEY\]\)/.test(settings),
  "설정: 곳마다 켜고 끄기·저장·예전 키 옮기기·변경 감지");
check(/imported\[LIVE_TAG_FILTERS_FOLLOWING_DISABLED_KEY\] === undefined &&\s*imported\[LIVE_TAG_FILTERS_DISABLED_KEY\] !== undefined/.test(settings),
  "설정: 팔로잉 키가 없는 예전 백업을 불러오면 꺼 둔 항목을 팔로잉에도 그대로");

// ── 스타일 ──
for (const [css, prefix] of [[contentCss, "cheese-live-tag-filter"], [settingsCss, "settings-live-tag"]]) {
  check(new RegExp(`\\.${prefix}-row\\.is-off > label:first-child span \\{\\s*opacity: 0\\.45;`).test(css) &&
    new RegExp(`\\.${prefix}-row > label\\.${prefix}-toggle \\{\\s*flex: none;[^}]*width: 56px;`).test(css) &&
    new RegExp(`\\.${prefix}-column \\{[^}]*width: 56px;`).test(css) &&
    new RegExp(`\\.${prefix}-toggle input:checked \\+ i::after \\{\\s*transform: translateX\\(12px\\);`).test(css),
    `${prefix}: 두 곳 모두 끈 항목은 흐리게, 스위치 열과 열 머리는 같은 폭`);
}

// ── 페이지 안 창·숨기기(실제 브라우저) ──
const CARDS = [
  { id: "a", tag: "GTA5" },
  { id: "b", tag: "노래" },
  { id: "c", tag: "저챗" },
];
const BOOT = `
(() => {
  window.__store = {};
  window.__listeners = [];
  window.chrome = { storage: {
    local: {
      get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, structuredClone(window.__store[k])])),
      set: async (values) => {
        const changes = {};
        for (const [k, v] of Object.entries(values)) { window.__store[k] = structuredClone(v); changes[k] = { newValue: structuredClone(v) }; }
        window.__listeners.forEach((fn) => fn(changes, "local"));
      },
    },
    onChanged: { addListener: (fn) => window.__listeners.push(fn) },
  } };
  window.__boot = () => {
    const IS_TOP_FRAME = true;
    const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const lockModalScroll = () => {}; const unlockModalScroll = () => {};
    const getBootData = (keys) => chrome.storage.local.get(keys);
    // 팔로잉 화면 그룹 필터는 이 구역 밖에 있다(전용 팔로잉 그룹 상태를 쓴다). 여기선 고른 그룹 없음.
    const followingGroupFilterChannelIds = () => null;
    ${section}
    window.api = { loadLiveTagFilters, applyLiveTagFilters, openLiveTagFilterModal, state: () => ({
      lives: [...liveTagFiltersDisabled], following: [...liveTagFiltersFollowingDisabled] }) };
  };
})();
`;
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>${contentCss}</style></head><body>
  <div class="_filter_x"><div role="tablist"><button role="tab" id="POPULAR">인기</button><button role="tab" id="LATEST">최신</button><button role="tab" id="ALL">전체</button><button role="tab" id="LIVE">라이브</button></div></div>
  <main id="layout-body"><ul>${CARDS.map((c) =>
    `<li data-card="${c.id}"><a href="/live/${c.id.repeat(32)}">방송 ${c.id}</a><a href="/lives?tags=${encodeURIComponent(c.tag)}">${c.tag}</a></li>`).join("")}</ul></main>
</body></html>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-ltf-toggle-"));
  const browser = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
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
  const http = require("node:http");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
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
    await call("Page.enable", {}, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: BOOT }, sessionId);
    await call("Page.navigate", { url: `${origin}/lives` }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const hidden = () => ev("[...document.querySelectorAll('[data-card]')].filter((li) => li.classList.contains('cheese-live-tag-filter-hidden')).map((li) => li.dataset.card).join(',')");
    const go = (url) => ev(`history.pushState({}, '', ${JSON.stringify(url)}); window.api.applyLiveTagFilters(); true`);

    // 예전 버전에서 꺼 둔 항목(노래) — 팔로잉 키가 없다 → 두 곳 모두 꺼진 채로 옮긴다
    await ev(`window.__store = { cheeseLiveTagFilters: ["GTA5", "노래", "저챗"], cheeseLiveTagFiltersDisabled: ["노래"], cheeseLiveTagFilterButton: true };
      window.__boot(); window.api.loadLiveTagFilters()`);
    const migrated = await ev("({ state: window.api.state(), stored: window.__store.cheeseLiveTagFiltersFollowingDisabled })");
    check(JSON.stringify(migrated.state) === '{"lives":["노래"],"following":["노래"]}' && JSON.stringify(migrated.stored) === '["노래"]',
      `팔로잉 키가 없으면 예전에 꺼 둔 항목을 팔로잉에도 꺼진 채로 옮기고 저장한다 ${JSON.stringify(migrated)}`);
    check(await hidden() === "a,c", "전체 방송: 켜진 항목(GTA5·저챗)만 숨긴다");

    // 창: 행마다 두 스위치 + 열 머리
    await ev("window.api.openLiveTagFilterModal(document.body); true");
    const modal = await ev(`(() => { const m = document.getElementById('cheese-live-tag-filter-modal');
      const row = m.querySelectorAll('.cheese-live-tag-filter-row')[1];
      const sw = [...row.querySelectorAll('[data-live-tag-filter-toggle]')];
      const cols = [...m.querySelectorAll('[data-live-tag-filter-scope-all]')];
      const colBox = m.querySelectorAll('.cheese-live-tag-filter-column')[1].getBoundingClientRect();
      const swBox = sw[1].closest('label').getBoundingClientRect();
      return { scopes: sw.map((s) => s.dataset.liveTagFilterScope), checked: sw.map((s) => s.checked), off: row.classList.contains('is-off'),
        labels: [...m.querySelectorAll('.cheese-live-tag-filter-column > span:first-child')].map((s) => s.textContent),
        colChecked: cols.map((c) => c.checked), colMixed: cols.map((c) => c.getAttribute('aria-checked')),
        aligned: Math.abs((colBox.left + colBox.width / 2) - (swBox.left + swBox.width / 2)) < 1.5,
        scrollbar: m.querySelector('.cheese-live-tag-filter-list').offsetWidth - m.querySelector('.cheese-live-tag-filter-list').clientWidth }; })()`);
    check(JSON.stringify(modal.scopes) === '["lives","following"]' && JSON.stringify(modal.checked) === "[false,false]" && modal.off &&
      JSON.stringify(modal.labels) === '["전체 방송","팔로잉"]',
      `행마다 '전체 방송'·'팔로잉' 스위치, 두 곳 모두 끈 행은 흐리게 ${JSON.stringify(modal)}`);
    check(JSON.stringify(modal.colChecked) === "[false,false]" && JSON.stringify(modal.colMixed) === '["mixed","mixed"]' && modal.aligned,
      `열 머리 스위치는 일부만 켜져 있으면 mixed, 아래 스위치 열과 가운데가 맞는다 ${JSON.stringify(modal)}`);

    if (process.env.LTF_SHOT) {
      const box = await ev("(() => { const b = document.querySelector('.cheese-live-tag-filter-dialog').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()");
      const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 } }, sessionId);
      fs.writeFileSync(path.join(process.env.LTF_SHOT, "live-tag-filter-modal.png"), Buffer.from(shot.data, "base64"));
    }
    // 팔로잉에서만 GTA5 끄기
    await ev(`(() => { const s = document.querySelectorAll('.cheese-live-tag-filter-row')[0].querySelector('[data-live-tag-filter-scope="following"]');
      s.click(); return true; })()`);
    check(JSON.stringify(await ev("window.__store.cheeseLiveTagFiltersFollowingDisabled")) === '["노래","gta5"]' &&
      JSON.stringify(await ev("window.__store.cheeseLiveTagFiltersDisabled")) === '["노래"]',
      "팔로잉 스위치는 팔로잉 키만 바꾼다");
    check(await hidden() === "a,c", "전체 방송 화면은 그대로");
    await go("/following?tab=ALL");
    check(await hidden() === "c", "팔로잉 화면은 팔로잉에서 켜진 항목(저챗)만 숨긴다");

    // 열 머리: 일부만 켜져 있으면 먼저 모두 켜기, 다시 누르면 모두 끄기 → 팔로잉에서는 아무것도 숨기지 않는다
    await ev("document.querySelector('[data-live-tag-filter-scope-all=\"following\"]').click(); true");
    check(await hidden() === "a,b,c" && JSON.stringify(await ev("window.__store.cheeseLiveTagFiltersFollowingDisabled")) === "[]" &&
      await ev("document.querySelector('[data-live-tag-filter-scope-all=\"following\"]').getAttribute('aria-checked')") === "true",
      "열 머리 스위치: 일부만 켜져 있으면 눌러서 모두 켜기");
    await ev("document.querySelector('[data-live-tag-filter-scope-all=\"following\"]').click(); true");
    check(await hidden() === "" && JSON.stringify(await ev("window.__store.cheeseLiveTagFiltersFollowingDisabled.length")) === "3",
      "열 머리 '팔로잉' 스위치를 끄면 팔로잉의 항목을 모두 끈다(팔로잉에서는 필터가 작동하지 않는다)");
    await go("/lives");
    check(await hidden() === "a,c", "그래도 전체 방송은 그대로 숨긴다");
    await ev("document.querySelector('[data-live-tag-filter-scope-all=\"following\"]').click(); true");
    check(JSON.stringify(await ev("window.__store.cheeseLiveTagFiltersFollowingDisabled")) === "[]" &&
      await ev("document.querySelector('[data-live-tag-filter-scope-all=\"following\"]').checked"),
      "다시 누르면 팔로잉 모두 켜기");

    // 꺼 둔 항목을 다시 추가하면 두 곳 모두 켠다
    await ev(`(() => { const input = document.querySelector('[data-live-tag-filter-input]'); input.value = '노래';
      document.querySelector('[data-live-tag-filter-form]').requestSubmit(); return true; })()`);
    check(JSON.stringify(await ev("window.api.state()")) === '{"lives":[],"following":[]}', "꺼 둔 항목을 다시 추가하면 두 곳 모두 켠다");

    // 다른 곳(설정 페이지)에서 바꾸면 바로 반영
    await ev("chrome.storage.local.set({ cheeseLiveTagFiltersFollowingDisabled: ['저챗'] }); true");
    await go("/following?tab=LIVE");
    check(await hidden() === "a,b", "설정 페이지에서 바꾼 팔로잉 키도 바로 반영");
  } finally {
    server.close();
    await new Promise((resolve) => {
      browser.once("exit", resolve);
      browser.kill();
    });
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
