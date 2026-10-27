// 채널 인증 마크(파트너·챌린저) 판단을 src/verifiedMark.js 한곳에 모은다.
//
// 2026-11-01 부터 파트너 마크 외에 챌린저 마크가 생기며 응답에 verifiedMarkType 이 붙었다. 값은 아직 모르므로
// TYPE_KINDS 는 비워 두고 지금처럼 verifiedMark 만 본다(동작 그대로). 데이터를 만드는 곳은 verifiedMarkType 을
// 함께 옮기고(있을 때만 — 저장 모양 그대로), 그리는 곳은 kind() 를 data-cheese-mark 로 단다.
// 실측 후 TYPE_KINDS 만 채우면 따라가는지, 타입 값을 넣은 복사본으로 미리 확인한다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helperSource = read("src/verifiedMark.js");
const content = read("src/content.js");
const background = read("src/background.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const load = (source) => {
  const ctx = vm.createContext({});
  vm.runInContext(source, ctx);
  return ctx.CheeseVerifiedMark;
};

// ── 판단 함수: 지금은 동작 그대로 ──
const VM = load(helperSource);
check(VM.kind({ verifiedMark: true }) === "partner" && VM.kind({ verifiedMark: true, verifiedMarkType: null }) === "partner" &&
  VM.kind({ verifiedMark: false }) === "" && VM.kind(null, undefined) === "",
  "verifiedMark:true 는 파트너, 아니면 마크 없음(도입 전 실측: 파트너 = true + null)");
check(VM.kind({ verifiedMark: true, verifiedMarkType: "CHALLENGER" }) === "partner" && VM.kind({ verifiedMark: false, verifiedMarkType: "CHALLENGER" }) === "",
  "타입 값은 아직 해석하지 않는다(실측 전) — 화면은 지금과 같다");
check(JSON.stringify(VM.fields({ verifiedMark: true })) === '{"verifiedMark":true}' &&
  JSON.stringify(VM.fields({ verifiedMark: "yes" }, null)) === '{"verifiedMark":false}' &&
  JSON.stringify(VM.fields(null, { verifiedMark: true, verifiedMarkType: "X" })) === '{"verifiedMark":true,"verifiedMarkType":"X"}',
  "fields: 여러 출처 중 하나라도 true 면 true, 타입은 있을 때만(저장 모양 그대로)");
check(VM.typeOf({ verifiedMarkType: "" }, { verifiedMarkType: "A" }, { verifiedMarkType: "B" }) === "A" && VM.typeOf({ verifiedMarkType: 3 }) === null &&
  VM.typeOf({ verifiedMarkType: "x".repeat(99) }).length === 40,
  "typeOf: 처음 나오는 문자열, 길이 제한");
check(VM.icon("partner").endsWith("icon_official_mark.png") && VM.icon("challenger").endsWith("icon_challenger_mark.png") && VM.icon("") === "" &&
  VM.label("partner") === "파트너" && VM.label("challenger") === "챌린저",
  "아이콘·이름");

// 배경은 같은 모양의 함수를 따로 둔다
{
  const at = background.indexOf("function verifiedMarkFields(");
  const ctx = vm.createContext({});
  vm.runInContext(background.slice(at, background.indexOf("\n}\n", at) + 3) + "\nthis.f = verifiedMarkFields;", ctx);
  const cases = [[{ verifiedMark: true }], [null, { verifiedMark: true, verifiedMarkType: "T" }], [{ verifiedMark: 1 }], [{ verifiedMarkType: "" }]];
  check(cases.every((args) => JSON.stringify(ctx.f(...args)) === JSON.stringify(VM.fields(...args))), "배경 verifiedMarkFields 는 공용 fields 와 같은 결과");
}

// ── 데이터를 만드는 곳: verifiedMark 만 떼어 옮기던 곳이 남지 않았다 ──
const DATA_FILES = ["src/content.js", "src/background.js", "src/chatRecap.js", "src/multiviewSources.js", "src/multiviewWatch.js",
  "src/logPowerPrediction.js", "src/logPowerStats.js", "src/inboxLogPower.js", "src/inboxCommunity.js", "src/settings.js"];
const leftovers = DATA_FILES.flatMap((file) => (read(file).match(/^\s*verifiedMark:\s*[\w?.]+\.verifiedMark(?: === true)?,$/gm) || []).map((l) => `${file}: ${l.trim()}`));
check(leftovers.length === 0, `verifiedMark 만 옮기던 줄이 없다(타입도 함께) ${JSON.stringify(leftovers)}`);

// ── 불러오는 곳: 쓰는 스크립트보다 먼저 ──
const users = (file) => file !== "src/verifiedMark.js" && fs.existsSync(path.join(root, file)) && /CheeseVerifiedMark\./.test(read(file));
const manifest = JSON.parse(read("manifest.json"));
for (const entry of manifest.content_scripts) {
  const js = entry.js || [];
  const firstUser = js.findIndex(users);
  if (firstUser < 0) continue;
  check(entry.world !== "MAIN" && js.indexOf("src/verifiedMark.js") >= 0 && js.indexOf("src/verifiedMark.js") < firstUser,
    `content script ${js.find(users)} 앞에 verifiedMark.js(격리 world)`);
}
check(!manifest.content_scripts.some((e) => e.world === "MAIN" && (e.js || []).includes("src/verifiedMark.js")), "치지직 페이지(MAIN)에는 싣지 않는다");
check(manifest.web_accessible_resources.some((r) => r.resources.includes("src/verifiedMark.js")), "웹 접근 자원(팝업 iframe 등)");
for (const page of fs.readdirSync(root).filter((f) => f.endsWith(".html"))) {
  const scripts = [...read(page).matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const firstUser = scripts.findIndex(users);
  if (firstUser < 0) continue;
  check(scripts.indexOf("src/verifiedMark.js") >= 0 && scripts.indexOf("src/verifiedMark.js") < firstUser, `${page}: 쓰는 스크립트보다 먼저 싣는다`);
}

// ── CSS: 마크를 배경으로 그리는 스타일시트마다 챌린저 덮어쓰기 ──
for (const css of fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".css"))) {
  const text = read(`src/${css}`);
  if (!/icon_official_mark|icon_official\.|\.lps-mark\b/.test(text)) continue;
  check(/:not\(img\)\[data-cheese-mark="challenger"\]\s*\{\s*background-image: url\("https:\/\/ssl\.pstatic\.net\/static\/nng\/glive\/image\/icon_challenger_mark\.png"\) !important;/.test(text),
    `${css}: data-cheese-mark="challenger" 면 챌린저 아이콘`);
}

// ── 실측 후 TYPE_KINDS 만 채우면 따라간다(복사본으로 미리 확인) ──
const patched = load(helperSource.replace("const TYPE_KINDS = Object.freeze({});", 'const TYPE_KINDS = Object.freeze({ CHALLENGER: "challenger", PARTNER: "partner" });'));
check(patched.kind({ verifiedMark: true, verifiedMarkType: "challenger" }) === "challenger" && patched.kind({ verifiedMark: true, verifiedMarkType: "PARTNER" }) === "partner" &&
  patched.kind({ verifiedMark: true, verifiedMarkType: "UNKNOWN" }) === "partner",
  "타입 표를 채우면 그 종류, 모르는 값은 예전처럼 파트너");
{
  const fn = (name) => {
    const at = content.indexOf(`\n  function ${name}(`);
    return content.slice(at, content.indexOf("\n  }\n", at) + 4);
  };
  const ctx = vm.createContext({ CheeseVerifiedMark: patched });
  vm.runInContext(["escapeHtml", "escapeAttribute", "createHeaderFollowTooltipHtml"].map(fn).join("\n") + "\nthis.tip = createHeaderFollowTooltipHtml;", ctx);
  const html = ctx.tip({ channelName: "가", verifiedMark: true, verifiedMarkType: "CHALLENGER", achievementBadgeUrls: [] }, "/live/x");
  const plain = ctx.tip({ channelName: "가", verifiedMark: true, achievementBadgeUrls: [] }, "/live/x");
  check(/data-cheese-mark="challenger"/.test(html) && /data-cheese-mark="partner"/.test(plain), "팔로우 툴팁: 종류를 data-cheese-mark 로 단다");
}
{
  const ctx = vm.createContext({ CheeseVerifiedMark: patched, console });
  vm.runInContext(read("src/achievementBadgeMap.js"), ctx);
  vm.runInContext(read("src/multiviewVodChat.js"), ctx);
  const msg = ctx.CheeseMultiviewVodChat.normalizeMessage({
    userIdHash: "u1", content: "안녕", messageTime: 1, playerMessageTime: 1, messageTypeCode: 1,
    profile: JSON.stringify({ nickname: "챌린저", verifiedMark: true, verifiedMarkType: "CHALLENGER" }),
  }, {});
  check(msg.badges.some((b) => /icon_challenger_mark/.test(b.url) && b.label === "챌린저") && !(msg.roles || []).includes("partner"),
    `다시보기 채팅: 챌린저는 챌린저 아이콘, 파트너 역할(모아보기)에는 넣지 않는다 ${JSON.stringify(msg.badges)}`);
}

// ── 실제 content.css: 챌린저면 배경만 바뀐다 ──
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheese-mark-"));
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
    const r = await call("Runtime.evaluate", {
      expression: `(() => {
        const st = document.createElement('style'); st.textContent = ${JSON.stringify(read("src/content.css"))}; document.head.append(st);
        document.body.innerHTML = '<i class="cheese-video-vault-official" id="p" data-cheese-mark="partner"></i><i class="cheese-video-vault-official" id="c" data-cheese-mark="challenger"></i>';
        const bg = (id) => getComputedStyle(document.getElementById(id));
        return { p: bg('p').backgroundImage, c: bg('c').backgroundImage, pw: bg('p').width, cw: bg('c').width };
      })()`,
      returnByValue: true,
    }, sessionId);
    const v = r.result.value;
    check(/icon_official_mark/.test(v.p) && /icon_challenger_mark/.test(v.c) && v.pw === v.cw,
      `content.css: 같은 자리·크기에 아이콘만 바뀐다 ${JSON.stringify(v)}`);
  } finally {
    browser.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
