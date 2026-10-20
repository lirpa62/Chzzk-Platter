// 채팅 폰트 크기 > '후원·구독 등 메시지도 조절'(특수 메시지 카드).
//
// 예전 chatFontScale.css 는 카드 루트를 `[class*="_container_"]:has(역할)` 로 골랐다. 그 :has 는
// class 에 _container_ 가 든 조상(채팅을 감싸는 section 등)까지 검사 대상으로 만들어, 채팅 한 줄이
// 들어올 때마다 채팅 전체의 스타일을 다시 계산했다(실측: 라이브 30초에 3초, 끄면 0.07초).
// 지금은 content.js 가 같은 조건으로 카드 루트에 표식을 달고 CSS 는 표식만 본다.
//
// 1) 같은 마크업에 1.60.0 CSS(:has)와 지금 CSS+표식을 각각 입혀 모든 요소의 크기 값이 같은지.
// 2) 카드 안이 나중에 채워지거나 역할이 빠지면 표식이 따라가는지, 끄면 걷히는지.
// 3) 채팅 줄을 계속 넣을 때 스타일 재계산이 예전보다 크게 줄었는지.
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const newCss = readFileSync(path.join(ROOT, "src/chatFontScale.css"), "utf8");
// 비교 기준: :has 로 고르던 1.60.0 의 CSS.
const oldCss = execFileSync("git", ["show", "3fec7e1:src/chatFontScale.css"], { cwd: ROOT, encoding: "utf8" });
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `${start} 를 찾지 못했다`);
  const stop = source.indexOf(end, at);
  assert.ok(stop > at, `${end} 를 찾지 못했다`);
  return source.slice(at, stop);
};

check(/let chatSpecialCardObserver = null;\s*let chatSpecialCardAsides = new WeakSet\(\);/.test(content.slice(0, content.indexOf("function applyChatFontScale()"))),
  "표식 감시 상태는 applyChatFontScale 보다 앞에 선언한다(일찍 불려도 선언 전 접근이 없다)");
check(!/font-scale-special[\s\S]{0,400}?\[class\*="_container_"\]:has\(/.test(newCss) &&
  (newCss.match(/\[data-cheese-chat-card\]\[data-cheese-chat-card\]/g) || []).length === 2 &&
  (newCss.match(/\[data-cheese-chat-card-mission\]/g) || []).length === 1,
  "특수 메시지 규칙은 :has 대신 표식으로 카드 루트를 고른다(우선순위는 예전 :has 와 같게 표식 두 번)");

const MARKS = between(content, "  // ── 특수 메시지(후원·미션·구독 카드) 표식", "  // <html>에 왼쪽 배치 클래스를 토글");

const row = (i, card) => `<div class="_item_8lqsk_7" id="row${i}">${card}</div>`;
const nick = (role, name) =>
  `<span class="_wrapper_1mc5x_30"><span class="_icon_1mc5x_40"><img src="data:," alt=""></span>` +
  `<span class="_container_1mc5x_2 ${role}"><span class="_nickname_1mc5x_80">${name}</span></span></span>`;
const CARDS = {
  normal: `<div class="_container_w9pvh_1"><div class="_chatting_message_w9pvh_21">${nick("_is_message_1mc5x_5", "보통")}<span class="_text_w9pvh_1">안녕하세요</span></div></div>`,
  donation: `<div class="_container_126f6_1"><div class="_header_126f6_2">${nick("_is_donation_1mc5x_7", "후원자")}<em class="_ellipsis_126f6_3">님</em></div>` +
    `<div class="_row_126f6_4"><span class="_money_126f6_9"><svg width="16" height="16"></svg>1,000</span></div><p class="_text_126f6_5">후원 메시지</p></div>`,
  mission: `<div class="_container_126f6_1"><div class="_header_126f6_2">${nick("_is_mission_1mc5x_8", "미션")}</div>` +
    `<div class="_detail_126f6_6"><span class="_money_126f6_9"><svg width="16" height="16"></svg>5,000</span><span class="_description_126f6_7">미션 내용</span></div></div>`,
  subscription: `<div class="_container_126f6_1"><div class="_header_126f6_2">${nick("_is_subscription_1mc5x_9", "구독자")}</div><p class="_word_126f6_8">3개월 구독</p></div>`,
};
const PAGE = `<section class="_container_wj4te_1"><div class="_container_8lqsk_1"><div class="_wrapper_8lqsk_25">` +
  `<aside id="aside-chatting" class="_container_nu1j9_2"><div role="log" id="log">` +
  Object.entries(CARDS).map(([name, card], i) => row(`${name}`, card)).join("") +
  `</div></aside></div></div></section>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-font-special-"));
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
  const open = async (css, withMarks) => {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Performance.enable", {}, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => {
      const root = document.documentElement;
      root.className = 'cheese-chat-font-scale-enabled cheese-chat-font-scale-ready cheese-chat-font-scale-special';
      root.style.setProperty('--cheese-chat-font-scale', '1.3');
      const st = document.createElement('style');
      st.textContent = ${JSON.stringify(css)} + ' body{margin:0;width:340px}';
      document.head.append(st);
      document.body.innerHTML = ${JSON.stringify(PAGE)};
      window.__card = ${JSON.stringify(CARDS)};
      ${withMarks ? `
        const CHAT_DOM_WATCH_OFF = false;
        let chatSpecialCardObserver = null;
        let chatSpecialCardAsides = new WeakSet();
        ${MARKS}
        window.sync = syncChatSpecialCardMarks;
        sync(true);` : ""}
      return true;
    })()`);
    return { ev, targetId, sessionId };
  };
  // 채팅창 안 모든 요소의 크기 값. ⚠ 페이지는 한 번에 하나만 연다(뒤로 간 탭은 타이머가 1초 단위로 늦어진다).
  const SNAP = `[...document.querySelectorAll('#log *')].map((el, i) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return [i, el.closest('[id^=row]')?.id, el.tagName, String(el.getAttribute('class') || ''), cs.fontSize, cs.lineHeight, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10].join('|');
  })`;
  // 감시자 콜백(마이크로태스크)이 돈 뒤.
  const TICK = "await new Promise((r) => setTimeout(r, 0));";
  // 채팅 줄을 계속 넣는 동안의 스타일 재계산(ms).
  const burst = async (page) => {
    await page.ev(`(() => { const log = document.getElementById('log'); const rows = [];
      for (let i = 0; i < 150; i++) rows.push('<div class="_item_8lqsk_7">' + window.__card[i % 10 ? 'normal' : 'donation'] + '</div>');
      log.insertAdjacentHTML('beforeend', rows.join('')); return true; })()`);
    const metric = async () => (await call("Performance.getMetrics", {}, page.sessionId)).metrics.find((m) => m.name === "RecalcStyleDuration").value;
    const m0 = await metric();
    await page.ev(`new Promise((resolve) => { let i = 0; const log = document.getElementById('log');
      const t = setInterval(() => { log.insertAdjacentHTML('beforeend', '<div class="_item_8lqsk_7">' + window.__card[i % 10 ? 'normal' : 'donation'] + '</div>');
        log.firstElementChild.remove(); if (++i >= 150) { clearInterval(t); resolve(true); } }, 8); })`);
    return ((await metric()) - m0) * 1000;
  };
  try {
    // 1) 예전 :has 와 같은 결과.
    const before = await open(oldCss, false);
    const a = await before.ev(SNAP);
    const oldMs = await burst(before);
    await call("Target.closeTarget", { targetId: before.targetId });

    const after = await open(newCss, true);
    const b = await after.ev(`(async () => { ${TICK} return ${SNAP}; })()`);
    const diff = a.filter((line, i) => line !== b[i]);
    check(a.length === b.length && diff.length === 0,
      `예전 :has CSS 와 표식 CSS 의 크기 값이 요소마다 같다(${a.length}개, 다른 것 ${diff.length}개) ${JSON.stringify(diff.slice(0, 3))}`);
    const sizes = await after.ev(`(() => { const fs = (sel) => getComputedStyle(document.querySelector(sel)).fontSize;
      return { donation: fs('#rowdonation ._text_126f6_5'), subscription: fs('#rowsubscription ._word_126f6_8'),
        missionSvg: getComputedStyle(document.querySelector('#rowmission ._money_126f6_9 > svg')).width,
        normalMarked: document.querySelector('#rownormal > [class*="_container_"]').hasAttribute('data-cheese-chat-card') }; })()`);
    check(sizes.donation === "16.9px" && sizes.subscription === "16.9px" && Math.abs(parseFloat(sizes.missionSvg) - 20.8) < 0.1 && !sizes.normalMarked,
      `특수 메시지 카드는 13px×1.3, 미션 금액 아이콘은 16px×1.3, 보통 채팅에는 표식이 없다 ${JSON.stringify(sizes)}`);

    // 2) 표식이 바뀌는 카드를 따라간다.
    const follow = await after.ev(`(async () => {
      const log = document.getElementById('log');
      // 새 줄: 처음엔 빈 카드, 다음 변이에서 후원 역할이 채워진다.
      log.insertAdjacentHTML('beforeend', '<div class="_item_8lqsk_7" id="rowlate"><div class="_container_126f6_1"><div class="_header_126f6_2"></div></div></div>');
      const late = document.querySelector('#rowlate > div');
      ${TICK}
      const empty = late.hasAttribute('data-cheese-chat-card');
      late.querySelector('._header_126f6_2').insertAdjacentHTML('beforeend', '<span class="_container_1mc5x_2 _is_donation_1mc5x_7">x</span>');
      ${TICK}
      const filled = late.hasAttribute('data-cheese-chat-card');
      late.querySelector('[class*="_is_donation_"]').remove();
      ${TICK}
      const removed = late.hasAttribute('data-cheese-chat-card');
      sync(false);
      const cleared = document.querySelectorAll('[data-cheese-chat-card], [data-cheese-chat-card-mission]').length;
      sync(true);
      return { empty, filled, removed, cleared };
    })()`);
    check(!follow.empty && follow.filled && !follow.removed && follow.cleared === 0,
      `카드 안이 나중에 채워지면 표식을 달고, 역할이 빠지면 떼고, 끄면 모두 걷는다 ${JSON.stringify(follow)}`);

    // 3) 채팅 줄을 계속 넣을 때 스타일 재계산.
    const newMs = await burst(after);
    const keptMarks = await after.ev(`document.querySelectorAll('#log > [class*="_item_"] > [data-cheese-chat-card]').length`);
    check(newMs * 4 < oldMs && keptMarks > 0,
      `채팅 150줄을 넣는 동안 스타일 재계산이 크게 줄었다(예전 ${oldMs.toFixed(0)}ms → ${newMs.toFixed(0)}ms, 새 후원 카드 표식 ${keptMarks}개)`);
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
