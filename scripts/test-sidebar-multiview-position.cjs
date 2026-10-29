// 사이드바 맨 위 메뉴 순서 + 멀티뷰 바로가기 위치(서비스 바로가기 안 / 맨 위 메뉴).
// 치지직 항목(li)은 옮기지 않고 CSS(세로 flex + order)로 보이는 순서만 바꾼다. 실제 DOM(헤드리스 Chrome)에서
// 보이는 순서(위치)·조기 주입 규칙과의 일치·멀티뷰 항목 넣기·기본 순서일 때 규칙 없음을 본다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const early = readFileSync(path.join(ROOT, "src/sidebarEarlyHide.js"), "utf8");
const sliceFn = (source, name, indent = "  ") => {
  const at = source.indexOf(`\n${indent}function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf(`\n${indent}}\n`, at) + indent.length + 2);
};
const sliceConst = (source, name, indent = "  ", end = ";\n") => {
  const at = source.indexOf(`${indent}const ${name} =`);
  assert.ok(at >= 0, name);
  return source.slice(at, source.indexOf(end, at) + end.length);
};

// 2026-10-30 실측 구조: nav._section_ > ul._list_(display:block) > li._item_ > a[href]
// 아이콘·글자 래퍼 클래스 이름은 _icon_/_text_ 가 아니다(실측: 예전 방식으로는 아무 클래스도 못 옮겼다).
const topItem = (href, label) =>
  `<li class="_item_t"><a class="_menu_t" href="${href}"><span class="_box_t"><i class="_glyph_t"><svg class="_svg_t" width="24" height="24" fill="currentColor"><path d="M0 0h24v24H0z"></path></svg></i></span>` +
  `<span class="_label_t">${label}</span><span class="_badge_t"></span></a></li>`;
const TOP =
  `<nav class="_section_t"><ul class="_list_t">` +
  [["/lives", "전체 방송"], ["/clips", "인기 클립"], ["/category", "카테고리"], ["/schedule", "편성표"],
    ["/following", "팔로잉"], ["/cheezefarm", "치즈팜"], ["/newthing", "새 메뉴"]].map(([h, l]) => topItem(h, l)).join("") +
  `</ul></nav>`;
const SERVICES =
  `<nav class="_section_s"><strong class="_title_s">서비스 바로가기</strong><ul class="_list_s">` +
  `<li class="_item_s"><a class="_link_s" href="https://game.naver.com"><span class="_icon_s"><svg width="20" height="20"></svg></span><span class="_text_s">게임</span></a></li></ul></nav>`;

const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

check(/rules\.push\(\n\s*\.\.\.sidebarTopMenuOrderRules\(\n\s*sidebarTopMenuOrder,\n\s*sidebarMultiviewPosition === "top" && !featureFlags\.sbMultiview,/.test(content),
  "사이드바 숨김 CSS 에 순서 규칙을 함께 넣는다");
check(/if \(!featureFlagsLoaded\) return;/.test(sliceFn(content, "loadSidebarMultiviewPosition")),
  "기능 설정을 읽기 전에는 숨김 CSS 를 다시 쓰지 않는다(조기 숨김이 풀리는 깜빡임 방지)");
check(/keepMultiviewInServices = f\.sbMultiview !== true && data\[MV_POSITION_KEY\] !== "top";/.test(early),
  "조기 숨김: 맨 위 메뉴로 옮겼으면 서비스 바로가기를 통째로 숨긴다");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-sbmv-"));
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
    await ev(`(() => {
      window.chrome = { runtime: { getURL: (p) => "chrome-extension://x/" + p, sendMessage: () => Promise.resolve() }, extension: {} };
      window.featureFlags = { sidebar: false, sbMultiview: false };
      window.sidebarMultiviewPosition = "services";
      const SIDEBAR_MULTIVIEW_ID = "cheese-sidebar-multiview";
      const MULTIVIEW_ICON_SVG = '<svg width="20" height="20"></svg>';
      ${sliceConst(content, "SIDEBAR_TOP_MENU_IDS")}
      ${sliceConst(content, "normalizeSidebarTopMenuOrder", "  ", "\n  };\n")}
      ${["getSidebarNavLabel", "findSidebarServicesNav", "ensureSidebarMultiview", "findSidebarMultiviewPlace", "sidebarTopMenuOrderRules"].map((n) => sliceFn(content, n)).join("\n")}
      const earlyRules = (() => {
        ${sliceConst(early, "TOP_MENU_IDS")}
        ${sliceFn(early, "topMenuOrderRules")}
        return topMenuOrderRules;
      })();
      const style = document.createElement("style");
      document.head.append(style);
      window.api = { ensureSidebarMultiview, normalizeSidebarTopMenuOrder, sidebarTopMenuOrderRules, earlyRules, style };
      return true;
    })()`);
    // position: services | top, order: 저장값, which: "content" | "early"
    const run = (position, order, which = "content") => ev(`(() => {
      document.body.innerHTML = '<aside id="sidebar">' + ${JSON.stringify(TOP)} + ${JSON.stringify(SERVICES)} + '</aside>';
      sidebarMultiviewPosition = ${JSON.stringify(position)};
      api.ensureSidebarMultiview();
      const first = document.getElementById("cheese-sidebar-multiview");
      api.ensureSidebarMultiview(); // 제자리면 다시 만들지 않는다
      const inTop = ${JSON.stringify(position)} === "top";
      const rules = ${JSON.stringify(which)} === "early"
        ? api.earlyRules(${JSON.stringify(order)}, inTop)
        : api.sidebarTopMenuOrderRules(api.normalizeSidebarTopMenuOrder(${JSON.stringify(order)}), inTop);
      api.style.textContent = rules.join("\\n");
      const list = document.querySelector("ul._list_t");
      const visual = [...list.children]
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((li) => li.id === "cheese-sidebar-multiview" ? "MV" : li.querySelector("a").getAttribute("href").slice(1));
      const item = document.getElementById("cheese-sidebar-multiview");
      return { visual: visual.join(), rules: rules.length, same: first === item,
        inServices: Boolean(item.closest("ul._list_s")), display: getComputedStyle(list).display,
        li: item.className, a: item.querySelector("a").className, svg: item.querySelector("svg").getAttribute("width"),
        shape: (() => { const a = item.querySelector("a").cloneNode(true); a.querySelectorAll("svg").forEach((svg) => { svg.textContent = "…"; }); return a.innerHTML; })() };
    })()`);

    const base = await run("services", null);
    check(base.inServices && base.rules === 0 && base.display === "block" && base.visual === "lives,clips,category,schedule,following,cheezefarm,newthing",
      "기본: 멀티뷰는 서비스 바로가기, 맨 위 메뉴는 규칙 없이 치지직 그대로 " + JSON.stringify(base));
    check(base.same, "제자리면 그대로 둔다(멱등)");
    const top = await run("top", null);
    check(!top.inServices && top.rules === 0 && top.visual === "lives,clips,category,schedule,following,cheezefarm,newthing,MV",
      "맨 위 메뉴 + 기본 순서: 맨 끝에 붙이고 규칙은 넣지 않는다 " + JSON.stringify(top));
    check(top.li === "_item_t" && top.a === "_menu_t" &&
      /^<span class="_box_t"><i class="_glyph_t"><svg width="24" height="24"[^>]*class="_svg_t"[^>]*>…<\/svg><\/i><\/span><span class="_label_t">멀티뷰<\/span>$/.test(top.shape),
      "맨 위 메뉴 항목의 구조(겹친 래퍼·svg 크기·클래스, 글자 자리)를 이름과 상관없이 따른다 " + top.shape);
    for (const which of ["content", "early"]) {
      const custom = await run("top", ["multiview", "following", "lives"], which);
      check(custom.display === "flex" && custom.visual === "MV,following,lives,clips,category,schedule,cheezefarm,newthing",
        `${which}: 고른 순서대로, 빠진 항목은 기본 순서로 뒤에, 모르는 새 메뉴는 맨 뒤 ` + JSON.stringify(custom));
      const middle = await run("top", ["lives", "clips", "multiview"], which);
      check(middle.visual === "lives,clips,MV,category,schedule,following,cheezefarm,newthing", `${which}: 멀티뷰를 메뉴 사이에`);
      const nativeOnly = await run("services", ["cheezefarm", "multiview", "lives"], which);
      check(nativeOnly.inServices && nativeOnly.visual === "cheezefarm,lives,clips,category,schedule,following,newthing",
        `${which}: 멀티뷰가 서비스 바로가기에 있어도 치지직 항목 순서는 바꾼다(저장된 멀티뷰 자리는 무시)`);
      const sameAsBase = await run("services", ["lives", "multiview", "clips"], which);
      check(sameAsBase.rules === 0, `${which}: 멀티뷰를 빼면 기본 순서와 같을 때 규칙 없음`);
    }
    const bogus = await run("top", ["x", "lives", "lives", 3]);
    check(bogus.rules === 0, "모르는 값·중복은 빼고 읽는다");
    const hidden = await ev(`(() => {
      featureFlags.sbMultiview = true;
      api.ensureSidebarMultiview();
      featureFlags.sbMultiview = false;
      return Boolean(document.getElementById("cheese-sidebar-multiview"));
    })()`);
    check(!hidden, "멀티뷰 바로가기 숨김이면 뺀다");
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
