// 펼친 사이드바 너비 조절(240~360px, 창 폭 1200px 이상, 넓히기만).
//
// 실측(진단): 펼친 폭 240px 는 사이드바 자신의 규칙(_is_expanded_ { width: 240px }) 하나에서
// 나오고 안쪽은 모두 따라온다. 그래서 사이드바 폭만 덮어쓴다. 끄는 동안엔 사이드바 폭만 바꾸고
// 놓을 때 밀어내기 여백·채팅 최대 폭·화면 채우기를 한 번에 다시 맞춘다.
// 실제 브라우저에서 손잡이를 마우스로 끌어 잰다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");
const sliceFn = (name) => {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  return SRC.slice(at, SRC.indexOf("\n  }\n", at) + 4);
};
const section = SRC.slice(
  SRC.indexOf("  // ── 사이드바 너비 조절(펼친 상태에서 넓히기만)"),
  SRC.indexOf("  // ── 헤더 자동 숨김(상단 호버존에서 슬라이드 표시)"),
);
if (!/function applySidebarResize\(/.test(section)) throw Error("사이드바 너비 조절 구간을 찾지 못했다");

const PAGE = `
<style>
  body { margin: 0; }
  aside#sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 82px; background: #eee; }
  aside#sidebar._is_expanded_1b725_12 { width: 240px; }
  aside#sidebar ul { margin: 0; padding: 0; }
  aside#sidebar li { height: 40px; }
  div#layout-body { padding-left: 82px; }
</style>
<aside id="sidebar" class="_container_1b725_2 _is_expanded_1b725_12"><ul><li>채널</li></ul></aside>
<div id="layout-body"><main>본문</main></div>`;

const HARNESS = `
  window.calls = { chat: 0, fill: 0, fab: 0 };
  window.saved = [];
  window.featureFlags = { sidebar: false, sidebarRight: false, sidebarPush: true, sidebarResize: true };
  window.chrome = { storage: { local: { set: (v) => window.saved.push(v) } } };
  var IS_MULTIVIEW_FRAME = false;
  var SIDEBAR_PUSH_STYLE_ID = "cheese-sidebar-push-style";
  function applyChatLayout() { calls.chat += 1; }
  function applyFillScreen() { calls.fill += 1; }
  function scheduleSearchSectionTopFabSync() { calls.fab += 1; }
  // 사이드바 호버 UI(팔로잉 미리보기·채널 툴팁) 흉내.
  window.followPreviewState = { pinned: false, open: false };
  window.followChannelTooltipState = { hoverTimer: 0, hoverAnchor: null, visible: false };
  function closeFollowPreview() { followPreviewState.open = false; }
  function hideFollowChannelTooltip() { followChannelTooltipState.visible = false; }
  window.hovers = 0;
  ${sliceFn("isSidebarExpanded")}
  ${sliceFn("applySidebarPush")}
  ${section}
  window.api = { applySidebarResize, clampSidebarWidth, isSidebarResizeLocked, get width() { return sidebarWidthValue; }, set width(v) { sidebarWidthValue = v; } };
`;

const dir = mkdtempSync(join(tmpdir(), "cheese-sb-resize-"));
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buf = "";
let seq = 0;
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
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
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let failed = 0;
  const ok = (condition, label) => {
    console.log(`${condition ? "  PASS" : "  FAIL"} ${label}`);
    if (!condition) failed += 1;
  };
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const viewport = (width) => call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const mouse = (type, x, y, extra = {}) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra }, sessionId);
    const state = () => ev(`(() => {
      const sb = document.getElementById("sidebar");
      const handle = sb.querySelector(".cheese-sidebar-width-resizer");
      const hr = handle?.getBoundingClientRect();
      return {
        width: Math.round(sb.getBoundingClientRect().width),
        handle: handle && getComputedStyle(handle).display !== "none" ? { left: Math.round(hr.left), right: Math.round(hr.right) } : null,
        padL: getComputedStyle(document.getElementById("layout-body")).paddingLeft,
        padR: getComputedStyle(document.getElementById("layout-body")).paddingRight,
        saved: window.saved.map((v) => v.cheeseSidebarWidth),
        calls: { ...window.calls },
        styleExists: !!document.getElementById("cheese-sidebar-resize-style"),
      };
    })()`);
    const load = async () => {
      await ev(`document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); true`);
      await ev(`(() => { const s = document.createElement("script"); s.textContent = ${JSON.stringify(HARNESS)}; document.head.append(s); api.applySidebarResize(); applySidebarPush(); return true; })()`);
    };
    // 손잡이 가운데를 잡고 dx 만큼 끈다.
    const drag = async (dx, { release = true, y = 300 } = {}) => {
      const s = await state();
      const x = (s.handle.left + s.handle.right) / 2;
      await mouse("mousePressed", x, y);
      for (let i = 1; i <= 5; i++) {
        await mouse("mouseMoved", x + (dx * i) / 5, y);
        await sleep(20);
      }
      await sleep(40);
      const during = await state();
      if (release) await mouse("mouseReleased", x + dx, y);
      return during;
    };

    await viewport(1600);
    await load();
    await sleep(300); // 밀어내기 여백 전환(0.2s)
    let s = await state();
    ok(s.width === 240 && s.handle && s.handle.right === 240, `켜면 펼친 사이드바 오른쪽 가장자리에 손잡이(폭 ${s.width}, 손잡이 ${JSON.stringify(s.handle)})`);
    ok(s.padL === "240px", `밀어내기 여백은 기본 폭(${s.padL})`);

    const during = await drag(80);
    ok(during.width === 320, `끄는 동안 사이드바가 손을 따라온다(${during.width})`);
    ok(during.padL === "240px" && during.calls.fill === 0, `끄는 동안엔 본문을 다시 배치하지 않는다(여백 ${during.padL}, 화면 채우기 ${during.calls.fill}회)`);
    await sleep(350);
    s = await state();
    ok(s.width === 320 && s.padL === "320px", `놓으면 밀어내기 여백이 새 폭으로(${s.padL})`);
    ok(s.calls.chat === 1 && s.calls.fill === 1, `놓은 뒤 채팅 최대 폭·화면 채우기를 한 번씩 다시 맞춘다(${JSON.stringify(s.calls)})`);
    ok(s.saved.at(-1) === 320, `폭을 저장한다(${s.saved})`);

    await drag(400);
    await sleep(350);
    ok((await state()).width === 360, "최대 360px");
    await drag(-500);
    await sleep(350);
    ok((await state()).width === 240, "기본 폭(240px)보다 좁아지지 않는다");

    // 조절하는 동안엔 사이드바 미리보기·툴팁을 닫고, 커서가 지나가는 항목·본문에 호버가 가지 않는다.
    await ev(`followPreviewState.open = true; followChannelTooltipState.visible = true;
      for (const el of document.querySelectorAll("aside#sidebar li, main")) el.addEventListener("mouseover", () => { window.hovers += 1; });
      true`);
    await drag(100, { y: 20, release: false });
    let lock = await ev(`({ preview: followPreviewState.open, tooltip: followChannelTooltipState.visible, locked: api.isSidebarResizeLocked(),
      li: getComputedStyle(document.querySelector("aside#sidebar li")).pointerEvents, main: getComputedStyle(document.querySelector("main")).pointerEvents })`);
    ok(!lock.preview && !lock.tooltip, `잡는 순간 떠 있던 미리보기·채널 툴팁을 닫는다(${JSON.stringify(lock)})`);
    ok(lock.locked && lock.li === "none" && lock.main === "none", "끄는 동안엔 사이드바 항목·본문에 호버가 가지 않는다");
    await mouse("mouseMoved", 140, 20); // 사이드바 항목 위로 되돌아온다
    await sleep(40);
    await mouse("mouseReleased", 140, 20);
    ok(await ev("window.hovers") === 0, `끄는 동안 지나간 항목·본문에 mouseover 0회(${await ev("window.hovers")})`);
    ok(await ev("api.isSidebarResizeLocked()"), "놓은 직후 잠깐은 미리보기를 열지 않는다");
    await sleep(400);
    lock = await ev(`({ locked: api.isSidebarResizeLocked(), li: getComputedStyle(document.querySelector("aside#sidebar li")).pointerEvents })`);
    ok(!lock.locked && lock.li !== "none", "0.35초 뒤에는 다시 열린다");
    await ev(`followPreviewState.open = true; followPreviewState.pinned = true; true`);
    await drag(20);
    await sleep(350);
    ok(await ev("followPreviewState.open"), "고정한 미리보기는 닫지 않는다");
    await ev(`followPreviewState.pinned = false; true`);

    // 누르기만 하고 놓으면 저장하지 않는다.
    const savedBefore = (await state()).saved.length;
    await drag(0);
    await sleep(100);
    ok((await state()).saved.length === savedBefore, "끌지 않고 놓으면 저장하지 않는다");

    // 더블클릭: 기본 폭으로(저장값 0 = 치지직 기본).
    await drag(60);
    await sleep(350);
    s = await state();
    const hx = (s.handle.left + s.handle.right) / 2;
    await mouse("mousePressed", hx, 300, { clickCount: 1 });
    await mouse("mouseReleased", hx, 300, { clickCount: 1 });
    await mouse("mousePressed", hx, 300, { clickCount: 2 });
    await mouse("mouseReleased", hx, 300, { clickCount: 2 });
    await sleep(350);
    s = await state();
    ok(s.width === 240 && s.saved.at(-1) === 0, `더블클릭하면 기본 폭으로(${s.width}, 저장 ${s.saved.at(-1)})`);

    // 접힘(아이콘 폭)은 건드리지 않는다.
    await ev(`api.width = 320; api.applySidebarResize(); document.getElementById("sidebar").classList.remove("_is_expanded_1b725_12"); true`);
    s = await state();
    ok(s.width === 82 && !s.handle, `접힘에서는 폭·손잡이 없음(${s.width})`);
    await ev(`document.getElementById("sidebar").classList.add("_is_expanded_1b725_12"); true`);

    // 창 폭 1199px 이하: 치지직 기본 그대로.
    await viewport(1199);
    s = await state();
    ok(s.width === 240 && !s.handle, `창 폭 1199px 에서는 조절하지 않는다(${s.width})`);
    await viewport(1600);
    ok((await state()).width === 320, "창 폭 1200px 이상으로 돌아오면 저장한 폭");

    // 오른쪽 배치: 손잡이가 왼쪽 가장자리, 왼쪽으로 끌면 넓어진다.
    await load();
    await ev(`featureFlags.sidebarRight = true; api.width = 0;
      const sb = document.getElementById("sidebar"); sb.style.left = "auto"; sb.style.right = "0";
      document.getElementById("layout-body").style.paddingLeft = "0"; api.applySidebarResize(); applySidebarPush(); true`);
    s = await state();
    ok(s.handle && s.handle.left === 1600 - 240, `오른쪽 배치: 손잡이가 왼쪽 가장자리(${JSON.stringify(s.handle)})`);
    await drag(-70);
    await sleep(350);
    s = await state();
    ok(s.width === 310 && s.padR === "310px", `오른쪽 배치: 왼쪽으로 끌면 넓어지고 오른쪽 여백이 따라온다(${s.width}, ${s.padR})`);

    // 실제 호버 처리(팔로잉 미리보기·채널 툴팁)가 잠금을 본다.
    for (const name of ["onFollowPreviewMouseOver", "onFollowChannelMouseOver"]) {
      ok(/if \(isSidebarResizeLocked\(\)\) return;/.test(sliceFn(name)), `${name} 은 사이드바 너비 조절 중이면 열지 않는다`);
    }

    // 기능 끄기·사이드바 숨김: 손잡이와 스타일을 걷는다.
    await ev(`featureFlags.sidebarResize = false; api.applySidebarResize(); true`);
    s = await state();
    ok(!s.handle && !s.styleExists && s.width === 240, `끄면 손잡이·스타일을 걷고 기본 폭(${s.width})`);
    await ev(`featureFlags.sidebarResize = true; featureFlags.sidebar = true; api.applySidebarResize(); true`);
    s = await state();
    ok(!s.handle && !s.styleExists, "사이드바 숨김이면 동작하지 않는다");
  } catch (error) {
    console.error(error);
    failed += 1;
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  if (failed) {
    console.log(`FAIL ${failed}`);
    process.exit(1);
  }
  console.log("전부 통과");
})();
