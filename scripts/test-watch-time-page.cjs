// 시청 시간 기록 화면(watchTime.html): 요약·날짜별·채널별·채널 상세·걸러 보기·지우기.
// 확장 저장소와 치지직 채널 API 는 가짜로 둔다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const A = "a".repeat(32);
const B = "b".repeat(32);
const pad = (n) => String(n).padStart(2, "0");
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const STORAGE = {
  cheeseWatchTime: true,
  cheeseWatchTimeDays: [day(-40), day(-2), day(0)],
  [`cheeseWatchTime:${day(-40)}`]: { [`-|${B}|l`]: 7200 },
  [`cheeseWatchTime:${day(-2)}`]: { [`abcdef0123|${A}|l`]: 3600, [`-|${A}|v`]: 1200 },
  [`cheeseWatchTime:${day(0)}`]: { [`abcdef0123|${A}|r`]: 600, [`-|${B}|l`]: 1800 },
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-wt-page-"));
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
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Page.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__local = ${JSON.stringify(STORAGE)};
      window.__sent = [];
      window.__fetches = 0;
      window.confirm = () => true;
      window.chrome = {
        storage: {
          local: {
            get: async (keys) => {
              const list = Array.isArray(keys) ? keys : [keys];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in window.__local).map((k) => [k, window.__local[k]]))));
            },
            set: async (values) => Object.assign(window.__local, values),
          },
          onChanged: { addListener() {} },
        },
        runtime: { sendMessage: (message, cb) => { window.__sent.push(message); cb && cb(); }, lastError: null,
          getURL: (file) => 'chrome-extension://test/' + file },
      };
      window.fetch = async (url) => {
        window.__fetches++;
        const id = String(url).split('/').pop();
        return { ok: true, json: async () => ({ content: { channelName: id[0] === 'a' ? '채널A' : '채널B',
          channelImageUrl: 'https://nng-phinf.pstatic.net/profile/' + id[0] + '.png', verifiedMark: id[0] === 'a' } }) };
      };
    ` }, sessionId);
    const open = async (query = "") => {
      await call("Page.navigate", { url: `file://${path.join(ROOT, "watchTime.html")}${query}` }, sessionId);
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (await ev("document.querySelectorAll('#wtChannelRows tr').length > 0 && document.querySelector('#wtChannelRows tr').textContent.includes('채널')").catch(() => false)) break;
      }
    };
    const view = () => ev(`({
      total: document.getElementById('wtTotal').textContent,
      split: document.getElementById('wtTotalSplit').textContent,
      channels: document.getElementById('wtChannels').textContent,
      top: (document.querySelector('#wtTop .wt-name') || document.getElementById('wtTop')).textContent,
      rows: [...document.querySelectorAll('#wtChannelRows tr')].map((tr) => tr.querySelector('.wt-name').textContent.trim() + ' ' + tr.children[2].querySelector('b').textContent),
      bars: document.querySelectorAll('#wtChart .wt-bar').length,
      detail: !document.getElementById('wtDetail').hidden ? document.querySelector('#wtDetailTitle .wt-name').textContent : '',
      detailSplit: [...document.querySelectorAll('#wtDetailSplit tr')].map((tr) => [...tr.children].map((c) => c.textContent).join('/')),
      disabled: !document.getElementById('wtDisabled').hidden,
    })`);

    await open();
    const first = await view();
    check(first.total === "2시간" && first.channels === "2개" && first.top === "채널A" &&
      JSON.stringify(first.rows) === JSON.stringify(["채널A 1시간 30분", "채널B 30분"]) && first.bars === 30 && !first.disabled,
      `기본 30일: 합계·채널 수·순위(채널 이름은 치지직에서 채움)·날짜 막대 30개 ${JSON.stringify(first)}`);
    check(first.split === "로그인 1시간 10분 · 비로그인 50분", "로그인·비로그인을 나눠 보인다");

    check(await ev(`window.__fetches === 2 && window.__local.cheeseWatchTimeChannels['${A}'].name === '채널A'`),
      "채널 이름은 채널마다 한 번 물어 저장해 둔다");
    const marks = await ev(`({
      row: [...document.querySelectorAll('#wtChannelRows tr')].map((tr) => !!tr.querySelector('.wt-channel-cell .wt-mark')),
      top: !!document.querySelector('#wtTop .wt-mark'),
      img: document.querySelector('#wtChannelRows tr .wt-channel-cell img')?.getAttribute('src'),
      topSize: getComputedStyle(document.querySelector('#wtTop .wt-name')).fontSize,
    })`);
    check(JSON.stringify(marks.row) === "[true,false]" && marks.top && marks.topSize === "20px",
      `파트너(인증 마크) 채널은 이름 옆에 마크(목록·가장 많이 본 채널) ${JSON.stringify(marks)}`);
    check(marks.img === "https://nng-phinf.pstatic.net/profile/a.png?type=f120_120_na",
      "프로필 사진은 작은 썸네일로 받는다(원본을 받지 않는다)");
    await ev(`document.querySelector('[data-range="all"]').click()`);
    const all = await view();
    check(all.total === "4시간" && all.rows[0] === "채널B 2시간 30분", `전체 기간 ${JSON.stringify(all.rows)}`);
    await ev(`document.querySelector('[data-login="guest"]').click()`);
    const guest = await view();
    check(guest.total === "2시간 50분" && JSON.stringify(guest.rows) === JSON.stringify(["채널B 2시간 30분", "채널A 20분"]),
      `비로그인만 ${JSON.stringify(guest)}`);
    await ev(`document.querySelector('[data-login="all"]').click(); document.querySelector('#wtModes [data-mode="live"]').click()`);
    const noLive = await view();
    check(noLive.total === "30분" && JSON.stringify(noLive.rows) === JSON.stringify(["채널A 30분"]), `라이브 빼고 ${JSON.stringify(noLive)}`);
    await ev(`document.querySelector('#wtModes [data-mode="live"]').click(); document.querySelector('[data-range="today"]').click()`);
    check((await view()).bars === 1 && (await view()).total === "40분", "오늘");

    check(await ev("window.__fetches") === 2, "걸러 보기를 바꿔도 이름을 다시 묻지 않는다");
    await ev(`document.querySelector('[data-range="all"]').click(); document.querySelector('#wtChannelRows tr[data-channel="${A}"]').click()`);
    const detail = await view();
    const detailExtra = await ev(`({
      mark: !!document.querySelector('#wtDetailTitle .wt-mark'),
      bars: document.querySelectorAll('#wtDetailChart .wt-bar').length,
      filled: document.querySelectorAll('#wtDetailChart .wt-bar-fill i').length,
    })`);
    check(detailExtra.mark && detailExtra.bars > 0 && detailExtra.filled > 0,
      `채널 상세에도 날짜별 그래프와 인증 마크 ${JSON.stringify(detailExtra)}`);
    check(detail.detail === "채널A" && detail.detailSplit[0] === "라이브/1시간/-/1시간" &&
      detail.detailSplit[1] === "다시보기/-/20분/20분" && detail.detailSplit[2] === "라디오/10분/-/10분" &&
      detail.detailSplit[3] === "합계/1시간 10분/20분/1시간 30분",
      `채널을 누르면 로그인·비로그인 × 라이브·다시보기·라디오 상세(없는 칸은 -) ${JSON.stringify(detail.detailSplit)}`);
    await ev(`document.getElementById('wtDetailDelete').click()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    check(await ev(`JSON.stringify(window.__sent.at(-1))`) === JSON.stringify({ type: "CHEESE_WATCH_TIME_DELETE", channelId: A }),
      "채널 기록 지우기는 배경에 맡긴다(쓰기와 같은 줄)");

    await open(`?channel=${B}`);
    const linked = await view();
    check(linked.detail === "채널B" && linked.total === "4시간", "'사용 중인 프로필'의 통계 단추(?channel=)는 그 채널 상세를 전체 기간으로 연다");

    // 그래프는 막대만(꺾은선은 가시성이 낮아 뺐다). 모양 고르기·Chart.js 도 없다.
    check(await ev(`!document.querySelector('[data-chart-type], #wtChartNote, script[src*="chart.min.js"], #wtChart canvas')`),
      "꺾은선·그래프 모양 고르기가 없다(막대만)");

    // 가장 많이 본 채널: 이름 앞에 프로필 사진.
    const topAvatar = await ev(`(() => { const img = document.querySelector('#wtTop img.wt-avatar');
      return { src: img?.getAttribute('src'), before: !!img && img.compareDocumentPosition(document.querySelector('#wtTop .wt-name')) === Node.DOCUMENT_POSITION_FOLLOWING }; })()`);
    check(/\?type=f120_120_na$/.test(topAvatar.src || "") && topAvatar.before, `가장 많이 본 채널 이름 앞에 프로필 사진 ${JSON.stringify(topAvatar)}`);

    // 막대 툴팁: 브라우저 title 대신 페이지 툴팁(날짜·합계·종류별).
    const tip = await ev(`(async () => {
      const bars = [...document.querySelectorAll('#wtChart .wt-bar')];
      const bar = bars.find((el) => Number(el.dataset.tipTotal) > 0);
      bar.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      const el = document.getElementById('wtChartTip');
      const box = el.getBoundingClientRect();
      const fill = bar.querySelector('.wt-bar-fill').getBoundingClientRect();
      const out = { titles: bars.filter((b) => b.hasAttribute('title')).length, shown: !el.hidden,
        head: el.querySelector('strong')?.textContent, total: el.querySelector('.wt-chart-tip-total')?.textContent,
        modes: [...el.querySelectorAll('li')].map((li) => li.textContent), dots: el.querySelectorAll('li .wt-dot').length,
        near: Math.abs((box.left + box.width / 2) - (fill.left + fill.width / 2)) < 2 || box.left <= 8 };
      document.getElementById('wtChart').dispatchEvent(new PointerEvent('pointerleave'));
      out.hiddenAfter = el.hidden;
      return out;
    })()`);
    check(tip.titles === 0 && tip.shown && /^\d{4}-\d{2}-\d{2}/.test(tip.head || "") && tip.total && tip.modes.length > 0 &&
      tip.dots === tip.modes.length && tip.near && tip.hiddenAfter,
      `막대에 올리면 페이지 툴팁(날짜·합계·종류별 색 점), 벗어나면 닫힘 ${JSON.stringify(tip)}`);

    // 채널 상세: 누른 행 근처에 떠 있는 창. 바깥을 누르거나 Esc 로 닫는다.
    const floating = await ev(`(async () => {
      document.querySelector('#wtChannelRows tr[data-channel="${A}"]').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // 목록은 다시 그려지므로 누른 뒤 행을 다시 찾는다.
      const row = document.querySelector('#wtChannelRows tr[data-channel="${A}"]');
      const panel = document.getElementById('wtDetail');
      const r = row.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const out = { shown: !panel.hidden, position: getComputedStyle(panel).position, side: panel.dataset.side,
        gap: Math.round(panel.dataset.side === 'above' ? r.top - p.bottom : p.top - r.bottom),
        inView: p.left >= 0 && p.right <= document.documentElement.clientWidth,
        selected: row.classList.contains('is-selected'),
        outsideGrid: !document.querySelector('.wt-columns').contains(panel) };
      document.getElementById('wtTotal').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      out.closedOutside = panel.hidden;
      document.querySelector('#wtChannelRows tr[data-channel="${A}"]').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.closedEsc = panel.hidden;
      out.focusBack = document.activeElement?.dataset?.channel === '${A}';
      return out;
    })()`);
    check(floating.shown && floating.position === "absolute" && floating.outsideGrid && floating.selected &&
      floating.gap >= 0 && floating.gap <= 12 && floating.inView,
      `채널을 누르면 그 행 바로 옆(아래/위)에 떠 있는 상세 창 ${JSON.stringify(floating)}`);
    check(floating.closedOutside && floating.closedEsc && floating.focusBack,
      "상세 창은 바깥을 누르거나 Esc 로 닫고, Esc 면 그 행으로 포커스를 돌려준다");
    if (process.env.WATCH_TIME_SHOTS) {
      for (const theme of ["light", "dark"]) {
        await ev(`(() => { document.documentElement.dataset.theme = '${theme}';
          document.querySelector('#wtChannelRows tr[data-channel="${A}"]').click();
          const bar = [...document.querySelectorAll('#wtChart .wt-bar')].find((el) => Number(el.dataset.tipTotal) > 0);
          bar.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return true; })()`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const shot = await call("Page.captureScreenshot", { format: "png" }, sessionId);
        writeFileSync(path.join(process.env.WATCH_TIME_SHOTS, `watch-time-floating-${theme}.png`), Buffer.from(shot.data, "base64"));
        await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      }
    }

    // 직접 기간: 공용 달력으로 고른다.
    await ev(`document.querySelector('[data-range="custom"]').click()`);
    const picker = await ev(`(async () => {
      const from = document.querySelector('[data-wt-picker="from"]');
      from.querySelector('[data-wt-picker-toggle]').click();
      const opened = !from.querySelector('.popup-calendar').hidden && from.querySelectorAll('.popup-calendar-day').length === 42;
      const target = '${day(-2)}';
      // 달력은 시작일(약 30일 전)이 있는 달을 먼저 보인다. 목표 날짜 쪽으로 넘긴다
      // (예전엔 '이전 달' 만 눌러, 이틀 전이 그 달력 42칸 밖이 되는 날에 실패했다).
      let guard = 0;
      while (!from.querySelector('.popup-calendar-day[data-date="' + target + '"]') && guard++ < 3) {
        const shown = [...from.querySelectorAll('.popup-calendar-day[data-date]')].map((el) => el.dataset.date).sort();
        from.querySelector(target > shown.at(-1) ? '[data-wt-calendar="next"]' : '[data-wt-calendar="prev"]').click();
      }
      from.querySelector('.popup-calendar-day[data-date="' + target + '"]').click();
      return { opened, closed: from.querySelector('.popup-calendar').hidden,
        label: from.querySelector('[data-date-label]').textContent, total: document.getElementById('wtTotal').textContent,
        native: document.querySelectorAll('input[type="date"]').length };
    })()`);
    check(picker.opened && picker.closed && picker.label === day(-2) && picker.total === "2시간" && picker.native === 0,
      `직접 기간은 다른 화면과 같은 달력으로 고른다(브라우저 기본 날짜 입력 없음) ${JSON.stringify(picker)}`);

    // 좁은 창: 막대를 주·달로 묶고 날짜 글자가 겹치지 않는다.
    await ev(`document.querySelector('[data-range="all"]').click()`);
    const chartAt = async (width) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return ev(`(() => {
        const chart = document.getElementById('wtChart');
        const labels = [...chart.querySelectorAll('.wt-bar:not(.is-quiet) .wt-bar-label')].map((el) => el.getBoundingClientRect());
        let overlap = 0;
        for (let i = 1; i < labels.length; i++) if (labels[i].left < labels[i - 1].right + 2) overlap++;
        return { unit: chart.dataset.unit, bars: chart.querySelectorAll('.wt-bar').length, overlap,
          scroll: chart.scrollWidth > chart.clientWidth + 1 };
      })()`);
    };
    const wide = await chartAt(1280);
    const narrow = await chartAt(480);
    check(wide.unit === "day" && narrow.unit === "week" && narrow.bars < wide.bars &&
      !wide.overlap && !narrow.overlap && !wide.scroll && !narrow.scroll,
      `창을 줄이면 막대를 주 단위로 묶고 날짜 글자가 겹치지 않는다 ${JSON.stringify({ wide, narrow })}`);
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const busy = await ev(`(async () => {
      const button = document.getElementById('wtRefresh');
      const width = button.getBoundingClientRect().width;
      button.click();
      const during = { dots: button.querySelectorAll('.wt-dots i').length, busy: button.getAttribute('aria-busy'),
        disabled: button.disabled, width: Math.abs(button.getBoundingClientRect().width - width) < 1 };
      button.click(); // 처리 중 다시 눌러도 한 번만
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { during, after: button.textContent.trim(), done: !button.disabled && !button.hasAttribute('aria-busy') };
    })()`);
    check(busy.during.dots === 3 && busy.during.busy === "true" && busy.during.disabled && busy.during.width &&
      busy.after === "새로고침" && busy.done,
      `새로고침을 누르면 버튼 폭 그대로 3-dot pulse 를 보이고, 끝나면 돌아온다 ${JSON.stringify(busy)}`);

    for (const theme of ["light", "dark"]) {
      await ev(`document.documentElement.dataset.theme = '${theme}'`);
      const shot = await call("Page.captureScreenshot", { format: "png" }, sessionId);
      if (process.env.WATCH_TIME_SHOTS) writeFileSync(path.join(process.env.WATCH_TIME_SHOTS, `watch-time-${theme}.png`), Buffer.from(shot.data, "base64"));
    }
    const overflow = await ev(`document.documentElement.scrollWidth <= innerWidth`);
    check(overflow, "가로로 넘치지 않는다");
    check(await ev(`(() => { const c = document.getElementById('wtChart'); return c.scrollWidth <= c.clientWidth + 1; })()`),
      "날짜별 그래프는 막대가 많아도 가로 스크롤 없이 들어간다");
    await call("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    check(await ev(`document.documentElement.scrollWidth <= innerWidth + 1`), "좁은 창(420px)에서도 가로로 넘치지 않는다");

    // ── '사용 중인 프로필' 팝업의 이 채널 시청 시간 줄(content.js) ──
    const content = require("node:fs").readFileSync(path.join(ROOT, "src/content.js"), "utf8");
    const store = require("node:fs").readFileSync(path.join(ROOT, "src/watchTimeStore.js"), "utf8");
    const sliceFn = (name) => {
      const at = content.indexOf(`\n  function ${name}(`);
      return content.slice(at, content.indexOf("\n  }\n", at) + 4);
    };
    const between = (start, end) => content.slice(content.indexOf(start), content.indexOf(end, content.indexOf(start)));
    await call("Page.navigate", { url: "about:blank" }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const dialog = await ev(`(async () => {
      ${store}
      document.body.innerHTML = '<div role="alertdialog"><div class="_title_x">사용 중인 프로필</div><div id="popup_contents">' +
        '<div class="_box_x"><div class="_row_x">구독</div><div class="_row_x">팔로우</div><div class="_power_wrapper_x">파워</div></div></div></div>';
      window.__opened = '';
      window.open = (url) => { window.__opened = url; };
      const WATCH_TIME_STORE = globalThis.CheeseWatchTimeStore;
      let watchTimeOn = true;
      const RECAP_DIALOG_ROW_CLASS = "cheese-recap-profile-row";
      const RECAP_VIEW_CLASS = "cheese-recap-dialog-view";
      const currentLiveChannelId = () => '${A}';
      ${sliceFn("escapeHtml")}
      ${sliceFn("findProfileDialog")}
      ${sliceFn("restoreProfileDialog")}
      ${between("  const WATCH_TIME_ROW_CLASS", "  // 프로필 버튼을 누르면 치지직이 팝업을 그린다 → 그 직후 줄을 끼워 넣는다(내 채팅 줄과 같다).")}
      await ensureWatchTimeProfileRow();
      const row = document.querySelector('.cheese-watch-time-profile-row');
      const out = { text: row?.textContent.replace(/\\s+/g, ' ').trim(), beforePower: row?.nextElementSibling?.className,
        sameClass: row?.classList.contains('_row_x') };
      row.querySelector('[data-watch-time-more]').click();
      const view = document.querySelector('.cheese-watch-time-view');
      out.title = view.querySelector('strong').textContent;
      out.rows = [...view.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent).join('/'));
      out.days = [...view.querySelectorAll('.cheese-watch-time-days li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim());
      out.hiddenOriginal = document.querySelector('._box_x').hidden;
      view.querySelector('[data-watch-time-open]').click();
      out.opened = window.__opened;
      view.querySelector('[data-watch-time-back]').click();
      out.restored = !document.querySelector('._box_x').hidden && !document.querySelector('.cheese-watch-time-view');
      return out;
    })()`);
    check(dialog.text === "이 채널 시청 시간 1시간 30분 보기" && dialog.sameClass && /_power_wrapper_/.test(dialog.beforePower),
      `프로필 팝업: 통나무파워 앞에 치지직 줄과 같은 모양으로 이 채널 시청 시간 ${JSON.stringify(dialog)}`);
    check(dialog.title === "시청 시간 1시간 30분" &&
      dialog.rows.join("|") === "라이브/1시간/-/1시간|다시보기/-/20분/20분|라디오/10분/-/10분|합계/1시간 10분/20분/1시간 30분",
      `보기: 로그인·비로그인 × 라이브·다시보기·라디오 ${JSON.stringify(dialog.rows)}`);
    check(dialog.days.length === 2 && dialog.hiddenOriginal && dialog.restored &&
      dialog.opened.endsWith(`watchTime.html?channel=${A}`),
      `보기: 최근 기록, 통계 단추는 이 채널로 통계 화면을 연다, 뒤로가기는 원래 팝업으로 ${JSON.stringify(dialog)}`);

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
