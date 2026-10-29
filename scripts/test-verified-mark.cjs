// 채널 인증 마크(파트너·챌린저·공식) 판단을 src/verifiedMark.js 한곳에 모은다.
//
// 2026-11 개편(실측): 응답 verifiedMarkType 이 "PARTNER" | "CHALLENGER" | "OFFICIAL" 이고 치지직 화면은 이 값으로만
// 마크를 그린다(화면 스크립트의 Oee·kee 표). 아이콘도 바뀌어 초록 파트너 마크는 icon_partner_mark.png, 예전 파트너 주소
// icon_official_mark.png 는 파란 '공식' 마크가 됐다. 타입이 없는 예전 저장값(verifiedMark:true 만)은 파트너로 본다.
// 데이터를 만드는 곳은 verifiedMarkType 을 함께 옮기고(있을 때만 — 저장 모양 그대로), 그리는 곳은 kind() 를
// data-cheese-mark 로 단다.
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

// ── 판단 함수 ──
const VM = load(helperSource);
check(VM.kind({ verifiedMark: true, verifiedMarkType: "PARTNER" }) === "partner" && VM.kind({ verifiedMark: true, verifiedMarkType: "CHALLENGER" }) === "challenger" &&
  VM.kind({ verifiedMarkType: "OFFICIAL" }) === "official" && VM.kind({ verifiedMarkType: "challenger" }) === "challenger",
  "verifiedMarkType 으로 종류(치지직 화면과 같은 표, verifiedMark 가 없어도 타입만으로)");
check(VM.kind({ verifiedMark: true }) === "partner" && VM.kind({ verifiedMark: true, verifiedMarkType: null }) === "partner" &&
  VM.kind({ verifiedMark: true, verifiedMarkType: "UNKNOWN" }) === "partner" &&
  VM.kind({ verifiedMark: false }) === "" && VM.kind({ verifiedMarkType: "UNKNOWN" }) === "" && VM.kind(null, undefined) === "",
  "타입이 없는 예전 저장값(verifiedMark:true)은 파트너, 마크가 없으면 없음");
check(VM.hasMark({ verifiedMarkType: "CHALLENGER" }) && !VM.hasMark({ verifiedMarkType: "X" }) &&
  JSON.stringify(VM.fields({ verifiedMarkType: "OFFICIAL" })) === '{"verifiedMark":true,"verifiedMarkType":"OFFICIAL"}',
  "아는 타입이면 마크가 있는 것으로(저장값 verifiedMark 도 true)");
check(JSON.stringify(VM.fields({ verifiedMark: true })) === '{"verifiedMark":true}' &&
  JSON.stringify(VM.fields({ verifiedMark: "yes" }, null)) === '{"verifiedMark":false}' &&
  JSON.stringify(VM.fields(null, { verifiedMark: true, verifiedMarkType: "X" })) === '{"verifiedMark":true,"verifiedMarkType":"X"}',
  "fields: 여러 출처 중 하나라도 true 면 true, 타입은 있을 때만(저장 모양 그대로)");
check(VM.typeOf({ verifiedMarkType: "" }, { verifiedMarkType: "A" }, { verifiedMarkType: "B" }) === "A" && VM.typeOf({ verifiedMarkType: 3 }) === null &&
  VM.typeOf({ verifiedMarkType: "x".repeat(99) }).length === 40,
  "typeOf: 처음 나오는 문자열, 길이 제한");
check(VM.icon("partner").endsWith("/icon_partner_mark.png") && VM.icon("challenger").endsWith("/icon_challenger_mark.png") &&
  VM.icon("official").endsWith("/icon_official_mark.png") && VM.icon("") === "" &&
  VM.label("partner") === "파트너" && VM.label("challenger") === "챌린저" && VM.label("official") === "공식",
  "아이콘·이름(파트너 초록 = icon_partner_mark, 공식 파랑 = icon_official_mark)");

// 배경은 같은 모양의 함수를 따로 둔다
{
  const at = background.indexOf("function verifiedMarkFields(");
  const ctx = vm.createContext({});
  vm.runInContext(background.slice(at, background.indexOf("\n}\n", at) + 3) + "\nthis.f = verifiedMarkFields;", ctx);
  const cases = [[{ verifiedMark: true }], [null, { verifiedMark: true, verifiedMarkType: "T" }], [{ verifiedMark: 1 }], [{ verifiedMarkType: "" }],
    [{ verifiedMarkType: "CHALLENGER" }], [{ verifiedMark: false, verifiedMarkType: "PARTNER" }]];
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

// ── CSS: 마크를 배경으로 그리는 스타일시트마다 종류별 덮어쓰기, 기본 배경은 새 파트너 마크 ──
const ruleFor = (kind, file) => new RegExp(`:not\\(img\\)\\[data-cheese-mark="${kind}"\\]\\s*\\{\\s*background-image: url\\("https://ssl\\.pstatic\\.net/static/nng/glive/image/${file}\\.png"\\) !important;`);
for (const css of fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".css"))) {
  const text = read(`src/${css}`);
  if (!/icon_partner_mark|icon_official|\.lps-mark\b/.test(text)) continue;
  check(ruleFor("partner", "icon_partner_mark").test(text) && ruleFor("challenger", "icon_challenger_mark").test(text) && ruleFor("official", "icon_official_mark").test(text),
    `${css}: data-cheese-mark 파트너·챌린저·공식 아이콘`);
  const outside = text.replace(/:not\(img\)\[data-cheese-mark="official"\][^}]*\}/, "");
  check(!/icon_official_mark|icon_official\.0fac5d40/.test(outside), `${css}: 기본 마크 배경에 예전 주소(이제 파란 공식 마크·404)를 쓰지 않는다`);
}
const jsOld = ["src/multiviewVodChat.js", "src/multiviewWatch.js", "src/multiviewBadgeChat.js", "src/content.js", "src/popup.js"]
  .filter((file) => /["'`]https:\/\/ssl\.pstatic\.net\/static\/nng\/glive\/image\/icon_official_mark\.png/.test(read(file)));
check(jsOld.length === 0, `스크립트에 예전 파트너 주소가 남지 않았다 ${JSON.stringify(jsOld)}`);

// ── 그리는 곳이 종류를 따라간다 ──
const patched = VM;
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

{
  // 배지 모아보기 역할: 숨김 글자 '인증 마크'·예전 주소(이제 공식 마크)로는 파트너라고 보지 않는다
  const badge = require(path.join(root, "src/multiviewBadgeChat.js"));
  const role = badge.classifyBadgeRole;
  check(role(["_mark_ab1 _is_partner_cd2", "인증 마크"]) === "partner" && role(["https://ssl.pstatic.net/static/nng/glive/image/icon_partner_mark.png"]) === "partner" &&
    role(["_mark_ab1 _is_challenger_cd2", "인증 마크"]) === "" && role(["_is_official_x", "인증 마크"]) === "" &&
    role(["https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png"]) === "",
    "배지 모아보기: 파트너는 is_partner·새 파트너 그림으로만(챌린저·공식은 파트너 역할 아님)");
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
        document.body.innerHTML = '<i class="cheese-video-vault-official" id="p" data-cheese-mark="partner"></i><i class="cheese-video-vault-official" id="c" data-cheese-mark="challenger"></i>' +
          '<i class="cheese-video-vault-official" id="o" data-cheese-mark="official"></i><i class="cheese-video-vault-official" id="n"></i>';
        const bg = (id) => getComputedStyle(document.getElementById(id));
        ${(() => { const at = content.indexOf("\n  function readDomVerifiedMark("); return content.slice(at, content.indexOf("\n  }\n", at) + 4); })()}
        const card = (cls) => { const a = document.createElement('a'); a.innerHTML = '<span>이름</span>' + (cls === null ? '' : '<i class="' + cls + '"><span class="blind">인증 마크</span></i>'); return a; };
        const dom = [card('_mark_1 _is_challenger_2'), card('_mark_1 _is_official_2'), card('_mark_1 _is_partner_2'), card('_mark_1'), card(null)].map(readDomVerifiedMark);
        return { dom, p: bg('p').backgroundImage, c: bg('c').backgroundImage, o: bg('o').backgroundImage, n: bg('n').backgroundImage, pw: bg('p').width, cw: bg('c').width };
      })()`,
      returnByValue: true,
    }, sessionId);
    const v = r.result.value;
    check(/icon_partner_mark/.test(v.p) && /icon_partner_mark/.test(v.n) && /icon_challenger_mark/.test(v.c) && /icon_official_mark/.test(v.o) && v.pw === v.cw,
      `content.css: 같은 자리·크기에 아이콘만 바뀐다 ${JSON.stringify(v)}`);
    check(JSON.stringify(v.dom) === JSON.stringify([
      { verifiedMark: true, verifiedMarkType: "CHALLENGER" }, { verifiedMark: true, verifiedMarkType: "OFFICIAL" },
      { verifiedMark: true, verifiedMarkType: "PARTNER" }, { verifiedMark: true }, { verifiedMark: false }]),
      `치지직 카드에서 읽은 마크: 숨김 글자는 같아 클래스(is_challenger 등)로 종류를 가른다 ${JSON.stringify(v.dom)}`);
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
