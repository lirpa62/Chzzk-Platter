// 사이드바 멀티뷰 바로가기: '서비스 바로가기' 숨김과 별개로 남기고, 따로 숨길 수 있다.
//
// 멀티뷰 바로가기는 '서비스 바로가기' 섹션 안에 넣는데, 그 섹션을 숨기면 함께 사라져 멀티뷰로 들어갈
// 길이 없었다(설정 화면 머리 버튼뿐).
//   - 서비스 바로가기 숨김: 치지직 항목·제목만 숨기고 멀티뷰 바로가기는 남긴다(섹션에 mv-only 표시)
//   - 설정 > 사이드바 > 항목별 숨김 '멀티뷰'(sbMultiview, 기본 표시)로 따로 숨긴다. 둘 다 숨기면 섹션째 숨김
//   - document_start 조기 숨김(sidebarEarlyHide.js)도 같은 기준이라 깜빡이지 않는다
// 실제 CSS 규칙(content.js·sidebarEarlyHide.js)을 헤드리스에 넣어 보이는 것을 확인한다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const early = read("src/sidebarEarlyHide.js");
const html = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

check(/sbMultiview: false, \/\/ /.test(content), "멀티뷰 바로가기 숨김(sbMultiview) 기본은 표시");
check(/data-feature="sbServices"[\s\S]{0,200}?data-new-feature="sidebar-multiview"[\s\S]{0,800}?data-feature="sbMultiview"/.test(html),
  "설정 > 사이드바 항목별 숨김에 '서비스 바로가기' 다음 '멀티뷰' 항목이 있다");
check(/if \(featureFlags\.sidebar \|\| featureFlags\.sbMultiview\) \{/.test(content) &&
  !/featureFlags\.sidebar \|\| featureFlags\.sbServices\) \{\s*existing\?\.remove\(\)/.test(content),
  "멀티뷰 바로가기는 사이드바 전체 숨김·멀티뷰 숨김일 때만 뺀다(서비스 바로가기 숨김과 무관)");
check(/const multiviewOnly = featureFlags\.sbServices && !featureFlags\.sbMultiview;\s*nav\.classList\.toggle\(SIDEBAR_SERVICES_MV_ONLY_CLASS, multiviewOnly\);\s*hidden = featureFlags\.sbServices && !multiviewOnly;/.test(content),
  "서비스 바로가기 숨김이면 멀티뷰가 보일 때 mv-only, 멀티뷰도 숨기면 섹션째 숨긴다");
check(/kw === "서비스바로가기" && keepMultiviewInServices \? MV_ONLY_CLASS : HIDE_CLASS/.test(early) &&
  /keepMultiviewInServices = f\.sbMultiview !== true;/.test(early),
  "조기 숨김도 같은 기준(멀티뷰가 보이면 mv-only)");

// content.js 의 규칙 문자열을 꺼내 실제로 그려 본다.
const ruleStart = content.indexOf("`aside#sidebar nav.${SIDEBAR_SERVICES_MV_ONLY_CLASS} > :not(");
const ruleEnd = content.indexOf("{ display: none !important; }`", ruleStart);
assert.ok(ruleStart > 0 && ruleEnd > ruleStart, "규칙을 찾지 못했다");
const contentRule = Function("SIDEBAR_SERVICES_MV_ONLY_CLASS", "return " +
  content.slice(ruleStart, ruleEnd + "{ display: none !important; }`".length))("cheese-sb-services-mv-only");
const earlyStart = early.indexOf("`aside#sidebar nav.${MV_ONLY_CLASS}>");
const earlyEnd = early.indexOf("{display:none!important}`", earlyStart);
const earlyRule = Function("MV_ONLY_CLASS", "return " +
  early.slice(earlyStart, earlyEnd + "{display:none!important}`".length))("cheese-sb-services-mv-only");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-sb-mv-"));
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
    const measure = (rule) => ev(`(() => {
      document.head.querySelector('style')?.remove();
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(rule)}; document.head.append(st);
      document.body.innerHTML = '<aside id="sidebar"><nav class="_section_x cheese-sb-services-mv-only" aria-label="서비스 바로가기">' +
        '<strong class="_title_x" id="title">서비스 바로가기</strong>' +
        '<div class="_wrap_x"><ul class="_list_x"><li id="game"><a href="#">게임</a></li><li id="esports"><a href="#">e스포츠</a></li>' +
        '<li id="cheese-sidebar-multiview"><a href="#">멀티뷰</a></li></ul></div>' +
        '<div class="_more_x" id="more">더보기</div></nav></aside>';
      const shown = (id) => document.getElementById(id).getBoundingClientRect().height > 0;
      return { title: shown('title'), game: shown('game'), esports: shown('esports'), more: shown('more'), mv: shown('cheese-sidebar-multiview') };
    })()`);
    for (const [name, rule] of [["content.js", contentRule], ["조기 숨김", earlyRule]]) {
      const r = await measure(rule);
      check(r.mv && !r.title && !r.game && !r.esports && !r.more,
        `${name}: 서비스 바로가기를 숨겨도 멀티뷰만 보인다(제목·치지직 항목·다른 갈래는 숨김) ${JSON.stringify(r)}`);
    }
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
