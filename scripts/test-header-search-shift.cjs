// 라운지 소식이 켜진 1200~1265px 폭에서 검색창을 왼쪽으로 옮길 때 주제 탭과 겹치지 않는다.
// 예전: content.css 가 left: calc(50% - 40px) 로 무조건 40px 옮겼다. 1200px 폭 피벗 모니터에서
// 전체화면(창 테두리가 없어 폭이 딱 1200px)일 때만 이 구간에 들어와, 주제 탭 끝('엔터+', 약 387px)과
// 검색창 시작(약 410px) 사이 23px 여백을 넘어 검색창이 탭 위로 올라갔다. 창 모드는 1200px 미만이라 멀쩡했다.
// 지금: fitHeaderSearchShift 가 왼쪽 여유를 재서 그만큼만(최대 40px) 옮긴다.
// 실제 content.css 와 content.js 의 함수를 헤드리스 Chrome 에서 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 60000).unref();

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src", "content.css"), "utf8");
const source = fs.readFileSync(path.join(root, "src", "content.js"), "utf8");
const fnStart = source.indexOf("  const HEADER_SEARCH_SHIFT_MAX_PX = 40;");
const fnEnd = source.indexOf("\n  }\n", source.indexOf("  function fitHeaderSearchShift(")) + 4;
assert.ok(fnStart > 0 && fnEnd > fnStart, "fitHeaderSearchShift 를 찾지 못했다");
const fn = source.slice(fnStart, fnEnd);

const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
check(/fitHeaderSearchShift\(header, searchForm\);\n\n    const studioAnchor/.test(source),
  "헤더 맞춤(fitHeaderNavToAvailableSpace)이 겹침 계산 전에 검색창 자리를 먼저 정한다");
check(!/left: calc\(50% - 40px\)/.test(css), "40px 고정 이동 규칙은 남아 있지 않다");

// 치지직 헤더 흉내: 왼쪽(햄버거·로고·주제 탭), 가운데 고정 검색창(left:50% + translateX), 오른쪽 버튼들.
// 실측 위치(1200px): 주제 탭 끝 ≈ 387px, 검색창 시작 ≈ 410px(폭 ≈ 380px).
const NATIVE_CSS = `
  body { margin: 0; }
  header#header { position: relative; height: 60px; display: flex; align-items: center; justify-content: space-between; }
  ._section_left { display: flex; align-items: center; gap: 10px; padding-left: 16px; }
  ._section_left nav { display: flex; }
  ._section_left nav a { display: inline-block; height: 24px; }
  ._search_container { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: 380px; }
  ._search_container form { display: block; height: 40px; }
  ._section_right { display: flex; gap: 8px; padding-right: 16px; }
  ._section_right button { width: 32px; height: 32px; }
`;
const header = (tabsWidth) => `<header id="header">
  <div class="_section_left"><button style="width:30px;height:30px">≡</button><a href="/" style="display:inline-block;width:60px;height:24px">치지직</a>
    <div class="_container_topic"><nav aria-label="주제 탭"><a style="width:${tabsWidth}px">게임 e스포츠 스포츠 엔터+</a></nav></div></div>
  <div class="_search_container"><form role="search"><input></form></div>
  <div class="_section_right"><button></button><button></button><button id="cheese-lounge-button"></button><button></button><button></button></div>
</header>`;

const dir = mkdtempSync(path.join(tmpdir(), "cheese-header-search-"));
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let buf = "";
let seq = 0;
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buf += chunk;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
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

(async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const run = async ({ width, tabsWidth, lounge }) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId);
      return ev(`(() => {
        if (!window.__ready) {
          for (const text of [${JSON.stringify(NATIVE_CSS)}, ${JSON.stringify(css)}]) {
            const st = document.createElement("style"); st.textContent = text; document.head.append(st);
          }
          window.__ready = true;
        }
        const HEADER_NAV_SEARCH_GAP_PX = 12;
        const HEADER_FOLLOW_CONTAINER_ID = "cheese-header-follow";
        ${fn}
        window.fitHeaderSearchShift = fitHeaderSearchShift;
        document.documentElement.className = ${JSON.stringify(lounge ? "cheese-lounge-on" : "")};
        document.body.innerHTML = ${JSON.stringify(header(tabsWidth))};
        const header = document.getElementById("header");
        const form = header.querySelector('form[role="search"]');
        fitHeaderSearchShift(header, form);
        const tabs = header.querySelector('nav[aria-label="주제 탭"]').getBoundingClientRect();
        const search = form.getBoundingClientRect();
        return { shift: header.style.getPropertyValue("--cheese-header-search-shift"),
          tabsRight: Math.round(tabs.right), searchLeft: Math.round(search.left), gap: Math.round(search.left - tabs.right) };
      })()`);
    };

    // 제보 화면: 1200px, 주제 탭 끝 ≈ 387px → 원래 여백 23px.
    const tight = await run({ width: 1200, tabsWidth: 261, lounge: true });
    check(tight.tabsRight === 387 && tight.gap >= 12 && tight.gap <= 13,
      `1200px(피벗 모니터 전체화면): 여유만큼만 옮겨 주제 탭과 겹치지 않는다(간격 12px 유지) ${JSON.stringify(tight)}`);
    const roomy = await run({ width: 1200, tabsWidth: 150, lounge: true });
    check(roomy.shift === "40px", `왼쪽이 넉넉하면 예전처럼 40px 옮긴다 ${JSON.stringify(roomy)}`);
    const none = await run({ width: 1200, tabsWidth: 280, lounge: true });
    check(none.shift === "" && none.gap > 0, `여유가 없으면 옮기지 않는다 ${JSON.stringify(none)}`);
    const wide = await run({ width: 1300, tabsWidth: 150, lounge: true });
    check(wide.shift === "", `1265px 보다 넓으면 옮기지 않는다 ${JSON.stringify(wide)}`);
    const off = await run({ width: 1200, tabsWidth: 150, lounge: false });
    check(off.shift === "", `라운지 소식이 꺼져 있으면 옮기지 않는다 ${JSON.stringify(off)}`);
    // 주제 탭 숨김(headerTopicTabs)이면 로고까지가 기준.
    const hiddenTabs = await ev(`(() => {
      document.documentElement.className = "cheese-lounge-on";
      const header = document.getElementById("header");
      header.querySelector('nav[aria-label="주제 탭"]').style.display = "none";
      fitHeaderSearchShift(header, header.querySelector('form[role="search"]'));
      return header.style.getPropertyValue("--cheese-header-search-shift");
    })()`);
    check(hiddenTabs === "40px", `주제 탭을 숨겼으면 로고까지가 기준이라 40px 옮긴다 ${hiddenTabs}`);
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
