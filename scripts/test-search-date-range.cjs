// 검색 기간 직접 선택 달력(src/searchDateRange.js) — 재생목록·멀티뷰 다시보기/클립 검색 공용.
// 치지직 검색 화면의 달력과 같게: 날짜 표(일요일·오늘·앞뒤 달과 미래는 막힘), 연도 보기(2023년 12월부터),
// 시작·종료일, 초기화·적용. 기간 → API startDate·endDate(KST) 계산도 본다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "src/searchDateRange.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

require("../src/searchDateRange.js");
const R = globalThis.CheeseSearchDateRange;
{
  const now = Date.UTC(2026, 9, 29, 7, 30, 0); // KST 10-29 16:30
  check(JSON.stringify(R.apiRange("DAY", "", "", now)) === JSON.stringify({ startDate: "2026-10-28 16:30:00", endDate: "2026-10-29 16:30:00" }),
    "1일 = 지금부터 24시간(KST)");
  check(R.apiRange("HALF_YEAR", "", "", now).startDate === "2026-04-30 16:30:00", "6개월 = 182일");
  check(JSON.stringify(R.apiRange("CUSTOM", "2026-09-01", "2026-09-30", now)) === JSON.stringify({ startDate: "2026-09-01 00:00:00", endDate: "2026-09-30 23:59:59" }),
    "직접 고른 날짜는 그날 0시~끝");
  check(R.apiRange("CUSTOM", "2026-10-01", "2026-10-29", now).endDate === "2026-10-29 16:30:00", "끝이 오늘이면 지금까지");
  check(R.apiRange("ALL", "", "", now) === null && R.apiRange("CUSTOM", "", "", now) === null, "전체 기간·날짜 없음은 넘기지 않는다");
  check(R.shortRange("2026-09-01", "2026-10-29") === "26.09.01~26.10.29" && R.longLabel("2026-09-01") === "26년 9월 1일", "표시");
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheese-date-range-"));
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
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => { ${source}
      document.body.innerHTML = '<button id="anchor" style="margin:40px 400px">기간</button>';
      window.applied = []; window.closedLog = [];
      return true; })()`);
    const open = (opts = "{}") => ev(`(() => { CheeseSearchDateRange.open(document.getElementById('anchor'), Object.assign({ onApply: (s, e) => applied.push([s, e]), onClose: (a) => closedLog.push(a) }, ${opts})); return true; })()`);
    await open(`{ start: "2026-09-01", end: "2026-09-10" }`);
    const first = await ev(`(() => { const d = document.querySelector('.cheese-date-range'); const today = CheeseSearchDateRange.kstToday();
      const r = d.getBoundingClientRect(), a = document.getElementById('anchor').getBoundingClientRect();
      return { month: d.querySelector('.cheese-dr-month strong').textContent, year: d.querySelector('[data-dr-years]').textContent,
        start: d.querySelector('[data-dr-start-label]').textContent, end: d.querySelector('[data-dr-end-label]').textContent,
        band: d.querySelectorAll('.cheese-dr-cell.in-range').length, sun: getComputedStyle(d.querySelector('.cheese-dr-week span')).color,
        outMonthDisabled: [...d.querySelectorAll('[data-dr-day]')].filter((c) => !c.dataset.drDay.startsWith('2026-09')).every((c) => c.disabled),
        below: r.top >= a.bottom, fixed: getComputedStyle(d).position }; })()`);
    check(first.month === "9월" && first.year === "2026년" && first.start === "26년 9월 1일" && first.end === "26년 9월 10일" && first.band === 8,
      `고른 기간이 있으면 그 달을 열고 시작·종료와 사이 띠를 보인다 ${JSON.stringify(first)}`);
    // 날짜에 마우스를 올리면 밑줄이 아니라 칸 모양의 둥근 배경(치지직 달력과 같다)
    const cellBox = await ev(`(() => { const c = document.querySelector('.cheese-date-range [data-dr-day="2026-09-14"]').getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; })()`);
    await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: cellBox[0], y: cellBox[1] }, sessionId);
    const hover = await ev(`(() => { const c = document.querySelector('.cheese-date-range [data-dr-day="2026-09-14"]'); const b = getComputedStyle(c, '::before');
      return { bg: b.backgroundColor, radius: b.borderTopLeftRadius, underline: getComputedStyle(c.querySelector('span')).textDecorationLine }; })()`);
    check(hover.bg !== "rgba(0, 0, 0, 0)" && hover.radius === "8px" && hover.underline === "none",
      `날짜에 올리면 둥근 배경(밑줄 없음) ${JSON.stringify(hover)}`);
    check(first.sun === "rgb(229, 72, 77)" && first.outMonthDisabled && first.below && first.fixed === "fixed",
      `일요일 빨강, 앞뒤 달 날짜는 막힘, 버튼 아래에 뜬다 ${JSON.stringify(first)}`);
    // 연도 보기: 2023년 1~11월은 막히고 12월부터
    await ev("document.querySelector('[data-dr-years]').click(); true");
    const years = await ev(`(() => { const d = document.querySelector('.cheese-date-range');
      const m = (k) => d.querySelector('[data-dr-month="' + k + '"]');
      return { y23: [...d.querySelectorAll('[data-dr-year-block="2023"] [data-dr-month]')].map((b) => b.disabled ? 0 : 1).join(''),
        current: d.querySelector('.is-current')?.dataset.drMonth, expanded: d.querySelector('[data-dr-years]').getAttribute('aria-expanded') }; })()`);
    check(years.y23 === "000000000001" && years.current === "2026-09" && years.expanded === "true",
      `연도 보기: 2023년 12월부터(서비스 시작) 고를 수 있고 지금 달을 표시 ${JSON.stringify(years)}`);
    await ev("document.querySelector('[data-dr-month=\"2024-02\"]').click(); true");
    const feb = await ev(`(() => { const d = document.querySelector('.cheese-date-range'); return { month: d.querySelector('.cheese-dr-month strong').textContent, year: d.querySelector('[data-dr-years]').textContent, days: [...d.querySelectorAll('[data-dr-day]:not(:disabled)')].length }; })()`);
    check(feb.month === "2월" && feb.year === "2024년" && feb.days === 29, `달을 누르면 그 달 날짜 표로(2024년 2월 29일까지) ${JSON.stringify(feb)}`);
    // 새로 고르기: 첫 클릭 시작, 두 번째가 앞 날짜면 서로 바꾼다. 초기화, 적용
    await ev("document.querySelector('[data-dr-day=\"2024-02-20\"]').click(); true");
    const one = await ev("({ start: document.querySelector('[data-dr-start-label]').textContent, end: document.querySelector('[data-dr-end-label]').textContent, apply: document.querySelector('[data-dr-apply]').disabled })");
    await ev("document.querySelector('[data-dr-day=\"2024-02-05\"]').click(); true");
    await ev("document.querySelector('[data-dr-apply]').click(); true");
    const result = await ev("({ applied, closed: closedLog, open: !!document.querySelector('.cheese-date-range') })");
    check(one.start === "24년 2월 20일" && one.end === "선택해 주세요" && !one.apply &&
      JSON.stringify(result.applied) === JSON.stringify([["2024-02-05", "2024-02-20"]]) && JSON.stringify(result.closed) === "[true]" && !result.open,
      `시작을 누른 뒤 앞 날짜를 누르면 순서를 맞추고, 적용하면 알리고 닫는다 ${JSON.stringify({ one, result })}`);
    // 초기화·이전/다음 달 한계·Esc·바깥 클릭
    await open();
    const edge = await ev(`(() => { const d = document.querySelector('.cheese-date-range');
      return { next: d.querySelector('[data-dr-next]').disabled, apply: d.querySelector('[data-dr-apply]').disabled, reset: d.querySelector('[data-dr-reset]').disabled,
        today: d.querySelector('.cheese-dr-cell.is-today')?.textContent.startsWith('오늘') }; })()`);
    check(edge.next && edge.apply && edge.reset && edge.today, `날짜를 안 골랐으면 이번 달·오늘 표시, 다음 달·초기화·적용은 막힘 ${JSON.stringify(edge)}`);
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, sessionId);
    check(!(await ev("!!document.querySelector('.cheese-date-range')")) && JSON.stringify(await ev("closedLog")) === "[true,false]", "Esc 로 닫고(적용 안 함) 알린다");
    await open();
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 }, sessionId);
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 5, button: "left", clickCount: 1 }, sessionId);
    check(!(await ev("!!document.querySelector('.cheese-date-range')")), "바깥을 누르면 닫는다");
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
