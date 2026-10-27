// 사이드바 '편성표' 미리보기 팝오버(설정 › 사이드바, 기본 꺼짐).
//
// 사이드바 '편성표'에 마우스를 0.5초 올리면 편성표 페이지와 같은 공개 API 로 지금 시각 근처부터의 일정을
// 팝오버로 보여 준다. 필터 칩(전체 + API 필터, 마지막 필터 기억), 날짜 구분, LIVE 표시, 경기 대진,
// 끝 가까이 내리면 다음 30개(무한 스크롤), 항목을 누르면 그 채널 라이브로 이동. 링크·팝오버 밖으로 나가거나 Esc 면 닫힌다.
// 불러오는 동안은 스켈레톤을 보이고, 팝오버 높이는 고정이라 필터를 바꿔도 들썩이지 않는다.
// 머리줄 날짜 버튼(목록 맨 위 날짜를 따라감)을 누르면 달력: 일정 있는 날(program-schedule-days)만 누를 수 있고,
// 누르면 그날 묶음이 생길 때까지 이어 받은 뒤 그 위치로 부드럽게 스크롤한다.
// content.js 의 모듈을 떼어 실제 content.css 와 함께 헤드리스 크롬에 넣고, CDP 로 진짜 마우스를 움직인다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
const css = read("src/content.css");
const content = read("src/content.js");
const settingsJs = read("src/settings.js");
const settingsHtml = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const fnSrc = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const modStart = content.indexOf("  // ── 사이드바 편성표 미리보기");
const modEnd = content.indexOf("  // ── 사이드바 멀티뷰 진입 버튼");
assert.ok(modStart > 0 && modEnd > modStart, "모듈 위치");
const moduleSrc = content.slice(modStart, modEnd);

// 설정
check(/\["\[data-sidebar-schedule-popover\]", "cheeseSidebarSchedulePopover", false\]/.test(settingsJs) &&
  /"cheeseSidebarSchedulePopover",/.test(settingsJs.slice(settingsJs.indexOf("SETTINGS_STORAGE_KEYS"))) &&
  /data-new-feature="sidebar-schedule-popover"[\s\S]{0,2000}?data-sidebar-schedule-popover/.test(settingsHtml),
  "설정 › 사이드바 '편성표 미리보기'(기본 꺼짐, NEW, 백업 포함)");
check(settingsHtml.indexOf('data-feature="sidebarResize"') < settingsHtml.indexOf("data-sidebar-schedule-popover"),
  "사이드바 묶음 끝(폭 조절 아래)");
check(/SCHEDULE_POPOVER_OPEN_DELAY_MS = 500;/.test(moduleSrc) && /applySchedulePopoverSetting\(data\?\.\[SCHEDULE_POPOVER_KEY\] === true\)/.test(moduleSrc),
  "호버 지연 0.5초, 저장값이 true 일 때만 켠다");

const NOW = Date.UTC(2026, 9, 27, 3, 0, 0); // KST 10-27 12:00
const CH = (n) => n.repeat(32).slice(0, 32);
const page1 = {
  data: [
    { seq: 1, type: "NORMAL", scheduleDate: "2026-10-27 11:00:00", scheduleTitle: "아침 <방송>", channel: { channelId: CH("a"), channelName: "채널A", openLive: true } },
    { seq: 2, type: "MATCH", scheduleDate: "2026-10-27 18:00:00", scheduleTitle: "LCK 결승", meta: { homeTeamName: "T1", awayTeamName: "GEN" }, channel: { channelId: CH("b"), channelName: "채널B", openLive: true } },
    { seq: 3, type: "NORMAL", scheduleDate: "2026-10-28 09:00:00", scheduleTitle: "내일 방송", channel: { channelId: CH("c"), channelName: "채널C", openLive: false } },
    { seq: 4, type: "NORMAL", scheduleDate: "2026-10-27 13:00:00", scheduleTitle: "잘못된 채널", channel: { channelId: "nope", channelName: "X" } },
    ...Array.from({ length: 12 }, (_, i) => ({ seq: 100 + i, type: "NORMAL", scheduleDate: `2026-10-28 1${i % 10}:00:00`, scheduleTitle: `채움 ${i}`, channel: { channelId: CH("f"), channelName: "채널F" } })),
  ],
  page: { next: { scheduleDate: "2026-10-28 09:00:00", seq: 3 } },
};
const page2 = {
  data: [{ seq: 5, type: "NORMAL", scheduleDate: "2026-10-30 20:00:00", scheduleTitle: "주말 방송", channel: { channelId: CH("d"), channelName: "채널D" } }],
  page: { next: null },
};
const esports = { data: [{ seq: 9, type: "NORMAL", scheduleDate: "2026-10-27 15:00:00", scheduleTitle: "e스포츠만", channel: { channelId: CH("e"), channelName: "채널E" } }], page: {} };
const filters = { programScheduleFilters: [{ filterId: "esports", filterTitle: "e스포츠" }, { filterId: "sports", filterTitle: "스포츠" }] };

const harness = `(() => {
  const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
  document.body.style.margin = '0';
  document.body.innerHTML = '<aside id="sidebar" style="position:fixed;left:0;top:0;width:240px;height:100vh">' +
    '<a href="/lives" id="lives" style="display:block;height:40px">라이브</a>' +
    '<a href="/schedule" id="sched" style="display:block;height:40px;margin-top:200px">편성표</a>' +
    '<div id="cheese-custom-follow"><a href="/schedule" id="ours" style="display:block;height:40px">우리 링크</a></div></aside>' +
    '<main id="main" style="margin-left:240px;height:100vh">본문</main>';
  const realNow = Date.now; Date.now = () => ${NOW};
  window.__fetches = []; window.__nav = []; window.__stored = {};
  // __hold 가 켜져 있으면 응답을 __release() 때까지 붙잡는다(스켈레톤 확인용). __failNext 면 다음 요청 하나 실패.
  window.__hold = false; const held = []; window.__release = () => held.splice(0).forEach((go) => go());
  window.__failNext = false;
  const reply = (body) => {
    if (window.__failNext) { window.__failNext = false; return Promise.resolve({ ok: false, status: 500 }); }
    const res = { ok: true, json: async () => ({ content: body }) };
    return window.__hold ? new Promise((go) => held.push(() => go(res))) : Promise.resolve(res);
  };
  window.fetch = (url) => {
    window.__fetches.push(String(url));
    const u = new URL(url);
    if (u.pathname.endsWith('program-schedule-filters')) return reply(${JSON.stringify(filters)});
    if (u.pathname.endsWith('program-schedule-days')) return reply({ days: u.searchParams.get('filterId') === 'esports' ? ['2026-10-27'] : ['2026-10-27', '2026-10-28', '2026-10-30'] });
    if (u.searchParams.get('filterId') === 'esports') return reply(${JSON.stringify(esports)});
    if (u.searchParams.get('direction') === 'NEXT') return reply(${JSON.stringify(page2)});
    return reply(${JSON.stringify(page1)});
  };
  const listeners = [];
  window.chrome = { storage: { local: {
    get: async () => ({ cheeseSidebarSchedulePopover: false }),
    set: (o) => Object.assign(window.__stored, o),
  }, onChanged: { addListener: (fn) => listeners.push(fn) } } };
  window.__setOn = (on) => listeners.forEach((fn) => fn({ cheeseSidebarSchedulePopover: { newValue: on } }, 'local'));
  const IS_TOP_FRAME = true;
  const CUSTOM_FOLLOW_NAV_ID = 'cheese-custom-follow';
  const spaNavigate = (href) => window.__nav.push(href);
  ${["parsePublishDate", "escapeHtml", "escapeAttribute"].map(fnSrc).join("\n")}
  ${moduleSrc}
})()`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-schedule-"));
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const move = (x, y) => call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
    const click = async (x, y) => {
      await call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
    };
    const center = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const open = () => ev("!!document.getElementById('cheese-schedule-popover')");
    await ev(harness);
    await wait(50);

    const [sx, sy] = await center("#sched");
    await move(sx, sy);
    await wait(800);
    check(!(await open()), "기본 꺼짐: 올려도 열리지 않는다");

    await ev("window.__setOn(true); window.__hold = true;");
    await move(900, 400);
    await move(sx, sy);
    await wait(300);
    check(!(await open()), "0.5초 전에는 열리지 않는다");
    await wait(400);
    check(await open(), "0.5초 머무르면 열린다");
    const skeleton = await ev(`(() => {
      const p = document.getElementById('cheese-schedule-popover');
      const list = p.querySelector('[data-schedule-list]');
      return {
        rows: list.querySelectorAll('.cheese-schedule-skeleton').length,
        busy: list.getAttribute('aria-busy'),
        chips: p.querySelectorAll('.cheese-schedule-bone.is-chip').length,
        anim: getComputedStyle(list.querySelector('.cheese-schedule-bone')).animationName,
        height: p.getBoundingClientRect().height,
        filtersH: p.querySelector('[data-schedule-filters]').getBoundingClientRect().height,
        text: list.textContent.trim(),
      };
    })()`);
    check(skeleton.rows >= 8 && skeleton.busy === "true" && skeleton.anim === "cheese-schedule-shimmer" && skeleton.text === "",
      `불러오는 동안 목록은 스켈레톤 ${JSON.stringify(skeleton)}`);
    check(skeleton.chips === 3, "필터 목록을 받기 전에는 칩 자리도 스켈레톤");
    await ev("window.__hold = false; window.__release()");
    await wait(100);

    const view = await ev(`(() => {
      const p = document.getElementById('cheese-schedule-popover');
      const r = p.getBoundingClientRect(); const cs = getComputedStyle(p);
      return {
        left: r.left, width: r.width, position: cs.position,
        chips: [...p.querySelectorAll('.cheese-schedule-filter')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')),
        days: [...p.querySelectorAll('.cheese-schedule-day')].map((d) => d.textContent),
        dayGap: parseFloat(getComputedStyle(p.querySelectorAll('.cheese-schedule-day-group')[1]).marginTop),
        dayBg: getComputedStyle(p.querySelector('.cheese-schedule-day')).backgroundImage,
        rows: [...p.querySelectorAll('.cheese-schedule-row:not(.cheese-schedule-skeleton)')].map((a) => ({ href: a.getAttribute('href'), live: a.classList.contains('is-live'), text: a.textContent })),
        more: !!p.querySelector('[data-schedule-more] .cheese-schedule-skeleton'),
        listScroll: getComputedStyle(p.querySelector('.cheese-schedule-list')).overflowY,
        height: r.height, filtersH: p.querySelector('[data-schedule-filters]').getBoundingClientRect().height,
        busy: p.querySelector('[data-schedule-list]').hasAttribute('aria-busy'),
        fetches: window.__fetches.length,
        titleHtml: p.querySelector('.cheese-schedule-title').innerHTML,
      };
    })()`);
    check(view.position === "fixed" && view.left >= 248 && view.width > 300, `사이드바 오른쪽에 뜬다 left=${view.left} width=${view.width}`);
    check(JSON.stringify(view.chips) === JSON.stringify(["전체*", "e스포츠", "스포츠"]), `필터 칩 ${JSON.stringify(view.chips)}`);
    check(JSON.stringify(view.days) === JSON.stringify(["10월 27일 (화) 오늘", "10월 28일 (수) 내일"]), `날짜 구분(요일, 오늘·내일 표) ${JSON.stringify(view.days)}`);
    check(view.dayGap >= 12 && view.dayBg !== "none", `날짜 머리는 띠, 두 번째 날부터 위로 띄움 ${view.dayGap}`);
    check(view.height === skeleton.height && Math.abs(view.filtersH - skeleton.filtersH) < 1 && !view.busy,
      `스켈레톤에서 목록으로 바뀌어도 팝오버·칩 줄 높이가 같다 ${skeleton.height}→${view.height}, 칩 ${skeleton.filtersH}→${view.filtersH}`);
    check(view.rows.length === 15 && !view.rows.some((r) => r.text.includes("잘못된 채널")), "채널 id 가 이상한 항목은 뺀다");
    check(view.fetches === 3, `스크롤하기 전에는 다음 묶음을 받지 않는다(필터·일정 있는 날·첫 묶음만) ${view.fetches}`);
    check(view.rows[0].live && view.rows[0].text.startsWith("11:00LIVE") && !view.rows[1].live && !view.rows[2].live,
      "LIVE 는 방송 중이고 시작 시각이 지난 항목만(18시 예정 항목은 같은 채널이 방송 중이어도 아님)");
    check(view.titleHtml.includes("아침 &lt;방송&gt;"), "제목은 이스케이프");
    check(view.rows[1].text.includes("T1 VS GEN"), `경기 대진 ${view.rows[1].text}`);
    check(view.rows[0].href === `/live/${CH("a")}`, "항목은 채널 라이브로");
    check(view.more && view.listScroll === "auto", "다음 묶음이 있으면 목록 끝에 스켈레톤 줄, 목록은 스크롤");

    // 링크 → 팝오버로 옮겨 가도 유지
    const [px, py] = await center(".cheese-schedule-head");
    await move(300, py);
    await move(px, py);
    await wait(400);
    check(await open(), "링크에서 팝오버로 옮겨 가는 사이 닫히지 않는다");

    // 무한 스크롤: 실패하면 다시 불러오기, 끝까지 받으면 꼬리 스켈레톤이 사라진다.
    const [lx, ly] = await center(".cheese-schedule-list");
    await ev("window.__failNext = true");
    await move(lx, ly);
    await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: lx, y: ly, deltaX: 0, deltaY: 3000 }, sessionId);
    await wait(200);
    const failed = await ev(`(() => ({
      rows: document.querySelectorAll('.cheese-schedule-row:not(.cheese-schedule-skeleton)').length,
      retry: !!document.querySelector('[data-schedule-retry="more"]'),
    }))()`);
    check(failed.rows === 15 && failed.retry, `다음 묶음이 실패해도 받은 목록은 두고 '다시 불러오기' ${JSON.stringify(failed)}`);
    const [tx, ty] = await center('[data-schedule-retry="more"]');
    await move(tx, ty);
    await click(tx, ty);
    await wait(200);
    const afterMore = await ev(`(() => ({
      rows: document.querySelectorAll('.cheese-schedule-row:not(.cheese-schedule-skeleton)').length,
      tail: !!document.querySelector('[data-schedule-more], [data-schedule-retry]'),
      scrolled: document.querySelector('.cheese-schedule-list').scrollTop > 0,
      height: document.getElementById('cheese-schedule-popover').getBoundingClientRect().height,
      last: decodeURIComponent(window.__fetches.at(-1)),
    }))()`);
    check(afterMore.rows === 16 && !afterMore.tail && afterMore.scrolled && afterMore.height === view.height,
      `끝 가까이 내리면 다음 묶음을 붙이고(스크롤 위치 유지), 끝이면 꼬리가 사라진다 ${JSON.stringify(afterMore)}`);
    check(/filterId=&direction=NEXT&scheduleDate=2026-10-28 09:00:00&seq=3/.test(afterMore.last.replace(/\+/g, " ")), `다음 묶음 커서 ${afterMore.last}`);

    // 필터
    const [fx, fy] = await center(".cheese-schedule-filter:nth-child(2)");
    await move(fx, fy);
    await ev("window.__hold = true");
    await click(fx, fy);
    await wait(50);
    const switching = await ev(`(() => ({
      skeleton: document.querySelectorAll('[data-schedule-list] .cheese-schedule-skeleton').length,
      top: document.querySelector('[data-schedule-list]').scrollTop,
      height: document.getElementById('cheese-schedule-popover').getBoundingClientRect().height,
    }))()`);
    check(switching.skeleton >= 8 && switching.top === 0 && switching.height === view.height,
      `필터를 바꾸면 맨 위에서 스켈레톤, 높이는 그대로 ${JSON.stringify(switching)}`);
    await ev("window.__hold = false; window.__release()");
    await wait(100);
    const afterFilter = await ev(`(() => ({
      height: document.getElementById('cheese-schedule-popover').getBoundingClientRect().height,
      rows: [...document.querySelectorAll('.cheese-schedule-row')].map((a) => a.textContent),
      active: document.querySelector('.cheese-schedule-filter.is-active').textContent,
      openHref: document.querySelector('[data-schedule-open]').getAttribute('href'),
      stored: window.__stored.cheeseSidebarScheduleFilter,
    }))()`);
    check(afterFilter.rows.length === 1 && afterFilter.rows[0].includes("e스포츠만") && afterFilter.active === "e스포츠",
      "필터를 누르면 그 필터 일정만");
    check(afterFilter.height === view.height, `일정이 1개뿐이어도 팝오버 높이는 같다 ${afterFilter.height}`);
    check(afterFilter.openHref === "/schedule?filterId=esports" && afterFilter.stored === "esports",
      "'편성표 열기'도 그 필터로, 마지막 필터를 기억한다");

    // 1분 캐시
    const fetchesBefore = await ev("window.__fetches.length");
    await move(900, 400);
    await wait(400);
    check(!(await open()), "링크·팝오버 밖으로 나가면 닫힌다");
    await move(sx, sy);
    await wait(700);
    const reopen = await ev(`(() => ({ n: window.__fetches.length, active: document.querySelector('.cheese-schedule-filter.is-active')?.textContent }))()`);
    check(reopen.n === fetchesBefore && reopen.active === "e스포츠", `다시 열면 1분 안은 받아 둔 것을 쓰고 필터는 그대로 ${JSON.stringify(reopen)}`);

    // Esc
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    check(!(await open()), "Esc 로 닫힌다");

    // 항목 클릭 → 이동
    await move(900, 400);
    await move(sx, sy);
    await wait(700);
    const [rx, ry] = await center(".cheese-schedule-row");
    await move(300, ry);
    await move(rx, ry);
    await click(rx, ry);
    await wait(50);
    const nav = await ev("({ nav: window.__nav.slice(), open: !!document.getElementById('cheese-schedule-popover') })");
    check(JSON.stringify(nav.nav) === JSON.stringify([`/live/${CH("e")}`]) && !nav.open, "항목을 누르면 팝오버를 닫고 그 채널 라이브로 이동");

    // 우리 목록 안 '/schedule' 링크는 대상 아님
    const [ox, oy] = await center("#ours");
    await move(ox, oy);
    await wait(700);
    check(!(await open()), "전용 팔로잉 안 링크에는 뜨지 않는다");

    // 끄면 닫힘
    await move(900, 400);
    await move(sx, sy);
    await wait(700);
    await ev("window.__setOn(false)");
    check(!(await open()), "설정을 끄면 바로 닫힌다");

    // 달력: 새로 열어 처음 묶음만 받은 상태에서
    await call("Page.navigate", { url: "about:blank" }, sessionId);
    await wait(200);
    await ev(harness);
    await ev("window.__setOn(true)");
    await wait(50);
    await move(900, 400);
    await move(sx, sy);
    await wait(800);
    const dateBtn = await ev(`document.querySelector('[data-schedule-date]').textContent`);
    check(dateBtn.startsWith("10월 27일 오늘"), `머리줄 날짜 버튼은 목록 맨 위 날짜 ${dateBtn}`);
    const [dx, dy] = await center("[data-schedule-date]");
    await move(dx, dy);
    await click(dx, dy);
    await wait(100);
    const cal = await ev(`(() => {
      const box = document.querySelector('[data-schedule-calendar]');
      const cells = [...box.querySelectorAll('[data-schedule-cal-day]')];
      const pick = (k) => box.querySelector('[data-schedule-cal-day="' + k + '"]');
      const r = box.getBoundingClientRect(), p = document.getElementById('cheese-schedule-popover').getBoundingClientRect();
      return {
        open: !box.hidden && getComputedStyle(box).display !== 'none',
        title: box.querySelector('.cheese-schedule-cal-head strong').textContent,
        first: cells[0].textContent, lead: box.querySelectorAll('.cheese-schedule-cal-cell.is-empty').length,
        last: cells.at(-1).dataset.scheduleCalDay,
        enabled: cells.filter((c) => !c.disabled).map((c) => c.dataset.scheduleCalDay),
        today: pick('2026-10-27').getAttribute('aria-current'),
        sel: pick('2026-10-27').classList.contains('is-selected'),
        dot: getComputedStyle(pick('2026-10-28'), '::after').content, noDot: getComputedStyle(pick('2026-10-29'), '::after').content,
        sun: getComputedStyle(box.querySelector('.cheese-schedule-cal-week')).color,
        inside: r.left >= p.left - 1 && r.right <= p.right + 1 && r.bottom <= p.bottom,
        expanded: document.querySelector('[data-schedule-date]').getAttribute('aria-expanded'),
      };
    })()`);
    check(cal.open && cal.expanded === "true" && cal.title === "10월 27일" && cal.inside, `날짜 버튼을 누르면 팝오버 안에 달력 ${JSON.stringify(cal)}`);
    check(cal.first === "오늘" && cal.today === "date" && cal.sel && cal.lead === 2 && cal.last === "2026-10-30",
      "오늘부터 마지막 일정 있는 날까지(오늘 칸은 '오늘', 요일 맞춤 빈칸)");
    check(JSON.stringify(cal.enabled) === JSON.stringify(["2026-10-27", "2026-10-28", "2026-10-30"]) && cal.dot === '""' && cal.noDot === "none",
      `일정 있는 날만 누를 수 있고 초록 점 ${JSON.stringify(cal.enabled)}`);
    check(cal.sun === "rgb(229, 72, 77)", "일요일은 빨간색");

    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    const escCal = await ev(`({ cal: document.querySelector('[data-schedule-calendar]').hidden, pop: !!document.getElementById('cheese-schedule-popover') })`);
    check(escCal.cal && escCal.pop, "Esc 는 달력만 닫는다");

    // 아직 안 받은 날(10-30) → 이어 받고 그 위치로 부드럽게 스크롤
    await click(dx, dy);
    await wait(50);
    await ev(`document.querySelector('[data-schedule-cal-day="2026-10-29"]').click()`);
    check(await ev(`!document.querySelector('[data-schedule-calendar]').hidden`), "일정 없는 날은 눌러도 반응하지 않는다");
    const [cx, cy] = await center('[data-schedule-cal-day="2026-10-30"]');
    await move(cx, cy);
    await click(cx, cy);
    await wait(80);
    const mid = await ev(`(() => { const l = document.querySelector('[data-schedule-list]'); return { top: l.scrollTop, label: document.querySelector('[data-schedule-date-label]').textContent }; })()`);
    await wait(1200);
    const jumped = await ev(`(() => {
      const l = document.querySelector('[data-schedule-list]');
      const g = l.querySelector('[data-schedule-day="2026-10-30"]');
      return { has: !!g, top: l.scrollTop, target: g && g.offsetTop, max: l.scrollHeight - l.clientHeight,
        cal: document.querySelector('[data-schedule-calendar]').hidden,
        label: document.querySelector('[data-schedule-date-label]').textContent,
        next: window.__fetches.some((u) => u.includes('direction=NEXT')) };
    })()`);
    check(jumped.has && jumped.next && jumped.cal, `고른 날이 아직 없으면 다음 묶음을 받아 붙인다 ${JSON.stringify(jumped)}`);
    check(mid.top < jumped.top && Math.abs(jumped.top - Math.min(jumped.target, jumped.max)) <= 1,
      `그날 위치로 부드럽게 스크롤(중간 ${mid.top} → ${jumped.top}, 목표 ${jumped.target})`);
    check(mid.label === "10월 30일" && jumped.label === "10월 30일", `날짜 버튼은 고른 날 ${mid.label}`);

    // 직접 위로 올리면(휠) 날짜 버튼이 다시 맨 위 날짜를 따라간다
    const [lx2, ly2] = await center(".cheese-schedule-list");
    await move(lx2, ly2);
    await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: lx2, y: ly2, deltaX: 0, deltaY: -5000 }, sessionId);
    await wait(300);
    check((await ev(`document.querySelector('[data-schedule-date-label]').textContent`)) === "10월 27일 오늘", "스크롤하면 날짜 버튼이 맨 위 날짜를 따라간다");

    // 사이드바가 오른쪽이면 왼쪽으로
    await ev(`(() => { const s = document.getElementById('sidebar'); s.style.left = 'auto'; s.style.right = '0'; })()`);
    await ev("window.__setOn(true)");
    const [rsx, rsy] = await center("#sched");
    await move(400, 400);
    await move(rsx, rsy);
    await wait(700);
    const rightSide = await ev(`(() => { const r = document.getElementById('cheese-schedule-popover').getBoundingClientRect(); return { right: r.right, left: r.left }; })()`);
    check(rightSide.right <= 1280 - 240 && rightSide.left >= 8, `오른쪽 사이드바면 왼쪽에 뜬다 ${JSON.stringify(rightSide)}`);
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
