// 멀티뷰 시청 화면 상단 막대(mvTopbar)가 창 폭에 따라 단계별로 줄어든다.
//
// 예전에는 900px 에서 한 번만 줄여, 1000~1300px 에서 버튼 글자가 줄지 못해 이웃 버튼과
// 겹치고('채팅' 값 위로 '메인 따라가기') '채널 관리'가 두 줄로 꺾였다. 이제
// 1480px 라벨→아이콘, 1180px 값 없는 버튼은 아이콘만, 960px 배치도 아이콘만, 720px 이하만
// 줄바꿈. 실제 마크업·CSS 를 스크립트 없이 띄워 잰다(통나무파워·채팅 펴기까지 모두 보이게).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const html = readFileSync(path.join(ROOT, "multiviewWatch.html"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-topbar-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files",
      "--remote-debugging-pipe", `--user-data-dir=${dir}`],
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
      const r = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Emulation.setScriptExecutionDisabled", { value: true }, sessionId);
    await call("Page.enable", {}, sessionId);
    await call("Page.navigate", { url: "file://" + path.join(ROOT, "multiviewWatch.html") }, sessionId);
    for (let i = 0; i < 50 && await ev("document.readyState") !== "complete"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await ev(`(() => {
      document.documentElement.dataset.theme = 'dark';
      document.getElementById('mvTopbar').hidden = false;
      const set = (id, v) => { document.getElementById(id).textContent = v; };
      set('mvMainValue', '얍얍_게임방송채널'); set('mvChatValue', '얍얍_게임방송채널');
      set('mvSideValue', '오른쪽'); set('mvLayoutValue', '그리드 2·3 + 채팅 위 1');
      set('mvVolumeValue', '60%'); set('mvStatsValue', '6채널'); set('mvQualityValue', '6채널');
      set('mvSyncValue', '꺼짐');
      document.getElementById('mvLogPower').hidden = false;
      set('mvLogPowerName', '얍얍_게임방송채널'); set('mvLogPowerAmount', '32.3만'); set('mvLogPowerState', '42:10');
      document.getElementById('mvChatExpand').hidden = false;
    })()`);
    const measure = async (width) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
      return ev(`(() => {
        const bar = document.getElementById('mvTopbar');
        const box = bar.getBoundingClientRect();
        const name = (el) => el.id || el.dataset.mvPop || el.className.split(' ')[0];
        const items = [...bar.children].filter((el) => !el.hidden && getComputedStyle(el).display !== 'none');
        const rects = items.map((el) => [name(el), el.getBoundingClientRect()]);
        const overlap = [];
        for (let i = 1; i < rects.length; i++) {
          if (Math.abs(rects[i][1].top - rects[i - 1][1].top) < 20 && rects[i][1].left < rects[i - 1][1].right - 0.5)
            overlap.push(rects[i - 1][0] + '/' + rects[i][0]);
        }
        const outside = rects.filter(([, r]) => r.right > box.right + 0.5 || r.left < box.left - 0.5).map(([n]) => n);
        const crammed = [...bar.querySelectorAll('.mv-pop-button, .mv-chat-follow, .mv-topbar-back, .mv-logpower')]
          .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1).map(name);
        const folded = [...bar.querySelectorAll('button')]
          .filter((el) => el.offsetParent && el.getBoundingClientRect().height > 34).map(name);
        const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
        return {
          height: Math.round(box.height), overlap, outside, crammed, folded,
          label: shown('[data-mv-pop="main"] .mv-pop-label'), icon: shown('[data-mv-pop="main"] .mv-pop-icon'),
          statsValue: shown('#mvStatsValue'), layoutValue: shown('#mvLayoutValue'),
          backText: shown('#mvBack .mv-topbar-text'), followText: shown('#mvChatFollow .mv-topbar-text'),
          // 통나무파워 칩·아이콘만 남은 버튼도 다른 버튼과 같은 높이.
          heights: [...new Set(['[data-mv-pop-toggle="main"]', '[data-mv-pop-toggle="stats"]', '#mvLogPower', '#mvBack', '#mvChatFollow']
            .map((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().height)))],
          lpName: shown('#mvLogPowerName'), volumeValue: document.getElementById('mvVolumeValue').scrollWidth <=
            document.getElementById('mvVolumeValue').clientWidth + 1,
        };
      })()`);
    };
    const tidy = (m) => !m.overlap.length && !m.outside.length && !m.crammed.length && !m.folded.length &&
      m.heights.length === 1 && m.heights[0] === 28;

    for (const width of [1920, 1600, 1481]) {
      const m = await measure(width);
      check(tidy(m) && m.height === 45 && m.label && !m.icon && m.backText && m.lpName,
        `${width}px: 라벨을 모두 보이고 한 줄 ${JSON.stringify(m)}`);
    }
    for (const width of [1480, 1300, 1181]) {
      const m = await measure(width);
      check(tidy(m) && m.height === 45 && !m.label && m.icon && m.statsValue && m.backText && !m.lpName,
        `${width}px: 라벨 대신 아이콘(통나무파워는 채널 이름 접음), 한 줄 ${JSON.stringify(m)}`);
    }
    for (const width of [1180, 1000, 961]) {
      const m = await measure(width);
      check(tidy(m) && m.height === 45 && !m.statsValue && m.layoutValue && !m.backText && !m.followText,
        `${width}px: 스트림 정보·화질·채팅 위치·메인 따라가기·채널 관리는 아이콘만, 한 줄 ${JSON.stringify(m)}`);
    }
    for (const width of [960, 800, 721]) {
      const m = await measure(width);
      check(tidy(m) && m.height === 45 && !m.layoutValue && m.volumeValue,
        `${width}px: 배치도 아이콘만, 짧은 값(볼륨 60%)은 자르지 않는다, 한 줄 ${JSON.stringify(m)}`);
    }
    for (const width of [720, 480, 390]) {
      const m = await measure(width);
      check(tidy(m) && m.height > 45, `${width}px: 그래도 모자라면 줄을 바꾼다(겹치지 않게) ${JSON.stringify(m)}`);
    }
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // 아이콘만 남을 때 이름·툴팁.
  for (const [key, label] of [["main", "메인 채널"], ["chat", "채팅"], ["side", "채팅 위치"], ["layout", "배치"],
    ["stats", "스트림 정보"], ["quality", "채널별 화질"], ["sync", "싱크"]]) {
    const at = html.indexOf(`data-mv-pop-toggle="${key}"`);
    const button = html.slice(at, html.indexOf("</button>", at));
    check(button.includes(`data-tooltip="${label}"`) && button.includes("data-tooltip-icon-only") &&
      button.includes(`<span class="mv-pop-label" data-tooltip-label>${label}</span>`) && button.includes('class="mv-pop-icon"'),
      `${label}: 라벨이 숨으면(아이콘만) 툴팁으로 라벨을 보인다`);
  }
  check(/id="mvChatFollow"[^>]*aria-label="메인 따라가기"/.test(html) &&
    /id="mvBack"\s*aria-label="채널 관리" data-tooltip="채널 관리" data-tooltip-icon-only/.test(html),
    "'메인 따라가기'·'채널 관리'는 아이콘만 남아도 이름이 있다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
