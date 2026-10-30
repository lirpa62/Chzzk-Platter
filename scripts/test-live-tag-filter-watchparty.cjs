// 라이브 제외 필터: 같이보기 칩('같이보기', 'WORLDS2026' 같은 같이보기 태그)도 거른다.
//
// 같이보기 방송 카드에는 초록 칩 '같이보기'(/watchparty/all)와 같이보기 태그(/watchparty/{번호})가 붙는다
// (실측: API 의 watchPartyNo·watchPartyTag 로 그리며 tags 배열에는 없다). 제외 필터는 tags= 링크·카테고리 링크·
// _tag_ span 만 훑어 이 칩을 놓쳤다. 드롭스 칩은 링크가 /category/…/lives#drops 라 우연히 걸렸다.
// 실측 마크업으로 카드를 만들어 content.js 의 선택자·값 추출을 헤드리스에서 돌린다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const content = readFileSync(path.join(__dirname, "..", "src/content.js"), "utf8");
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
const apply = sliceFn("applyLiveTagFiltersNow");
const selector = apply.match(/scope\.querySelectorAll\(\s*'([^']+)'/)[1];
check(selector.includes('a[href*="/watchparty/"]'), "제외 필터가 같이보기 링크(/watchparty/)도 훑는다");

const card = (tags) => '<li><a href="/live/x">LIVE</a><div>' + tags + '</div></li>';
const chip = (href, cls, text) => `<a class="_item_tag_4ij0q_724" href="${href}"><span class="_category_4ij0q_58 ${cls}">${text}</span></a>`;
const markup = '<ul>' +
  card(chip("/watchparty/all", "_highlight_4ij0q_65", "같이보기") + chip("/watchparty/554", "_highlight_4ij0q_65", "WORLDS2026") + chip("/lives?tags=울프", "_tag_4ij0q_62", "울프")) +
  card(chip("/category/GAME/Call_of_Duty/lives#drops", "_highlight_4ij0q_65", "드롭스") + chip("/lives?tags=인챈트", "_tag_4ij0q_62", "인챈트")) +
  card(chip("/lives?tags=다른", "_tag_4ij0q_62", "다른")) +
  '</ul>';

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-wp-filter-"));
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
    const hidden = async (filters) => ev(`(() => {
      ${sliceFn("normalizeLiveTagFilter")}
      ${sliceFn("getLiveFilterValuesFromNode")}
      document.body.innerHTML = ${JSON.stringify(markup)};
      const set = new Set(${JSON.stringify(filters)}.map(normalizeLiveTagFilter));
      const out = new Set();
      for (const node of document.querySelectorAll(${JSON.stringify(selector)})) {
        if (!getLiveFilterValuesFromNode(node).some((v) => set.has(v))) continue;
        const li = node.closest("li");
        if (li?.querySelector('a[href^="/live/"]')) out.add([...li.parentElement.children].indexOf(li));
      }
      return [...out].sort();
    })()`);
    check(JSON.stringify(await hidden(["같이보기"])) === "[0]", "'같이보기' 를 넣으면 같이보기 방송이 숨는다");
    check(JSON.stringify(await hidden(["WORLDS2026"])) === "[0]", "같이보기 태그(WORLDS2026)도 거른다");
    check(JSON.stringify(await hidden(["#worlds2026".toUpperCase()])) === "[0]", "# 이 붙어도 같은 태그로 본다");
    check(JSON.stringify(await hidden(["드롭스"])) === "[1]", "드롭스는 예전처럼 거른다");
    check(JSON.stringify(await hidden(["울프", "다른"])) === "[0,2]", "일반 태그도 그대로");
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
