// 전용 팔로잉 그룹 추가·수정 창: 채널 목록(cheese-cf-group-modal-channel-list)이 남는 높이 안에서 스크롤한다.
//
// 1.61.0 에서 편집 창을 '고른 순서' 패널과 나란히 두면서 바깥 상자(editor-wrap)를 격자로 바꿨는데 행 높이를
// 정하지 않아, 행이 내용만큼 늘어났다. 그러면 편집 영역 마지막 행(1fr)의 채널 목록도 제한 없이 길어지고, 본문은
// overflow:hidden 이라 잘리기만 하고 스크롤이 사라졌다. 실제 content.css 로 창을 만들어 잰다.
// 이어서: 아이콘 27개·내 아이콘이 위를 차지해 목록이 맨 아래에 작게 남아, 아이콘 고르기를 이름 줄의 팝오버로 접었다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const css = readFileSync(path.join(__dirname, "..", "src/content.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const channels = Array.from({ length: 80 }, (_, i) => `<button class="cheese-cf-group-modal-channel">채널 ${i}</button>`).join("");
const pickedItems = (n) => Array.from({ length: n }, (_, i) => `<li class="cheese-cf-group-modal-picked-item">고른 채널 ${i}</li>`).join("");
const modal = (n) => `<div class="cheese-cf-group-modal"><div class="cheese-cf-group-modal-dialog is-editor">` +
  `<div class="cheese-cf-group-modal-head">그룹 수정</div><div class="cheese-cf-group-modal-body">` +
  `<div class="cheese-cf-group-modal-editor-wrap"><form class="cheese-cf-group-modal-editor">` +
  `<div class="cheese-cf-group-modal-fields"><label>이름<input></label><label>색<input></label>` +
  `<div class="cheese-cf-group-modal-icon-field"><span>아이콘</span><button class="cheese-cf-group-modal-icon-trigger" data-cf-modal-icon-toggle>★</button></div>` +
  `<div class="cheese-cf-group-modal-icon-popover" id="popover" data-cf-modal-icon-popover hidden>` +
  `<fieldset class="cheese-cf-group-modal-icons"><legend>아이콘</legend>${"<button>a</button>".repeat(27)}</fieldset>` +
  `<section class="cheese-cf-group-modal-custom-icons"><div>내 아이콘</div><p>없음</p><textarea rows="2"></textarea></section></div></div>` +
  `<div class="cheese-cf-group-modal-sources"><div>자동 그룹</div><div><button>구독</button></div></div>` +
  `<div class="cheese-cf-group-modal-channel-tools"><input type="search"><button>선택</button><button>해제</button></div>` +
  `<p class="cheese-cf-group-modal-channel-count">80개</p>` +
  `<div class="cheese-cf-group-modal-channel-list" id="list">${channels}</div></form>` +
  `<aside class="cheese-cf-group-modal-picked"><div>고른 채널</div><div>순서</div><p>안내</p><ol class="cheese-cf-group-modal-picked-list" id="picked">${pickedItems(n)}</ol></aside>` +
  `</div></div></div></div>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-cf-modal-"));
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
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const ev2 = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const run = async (width, height, n) => {
      await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      return ev(`(() => {
        document.head.querySelector('style')?.remove();
        const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
        document.body.innerHTML = ${JSON.stringify(modal(0))};
        document.getElementById('picked').innerHTML = ${JSON.stringify(pickedItems(1))}.repeat(${n});
        const list = document.getElementById('list');
        const picked = document.getElementById('picked');
        const body = document.querySelector('.cheese-cf-group-modal-body');
        const lr = list.getBoundingClientRect(), br = body.getBoundingClientRect(), pr = picked.getBoundingClientRect();
        return { listH: Math.round(lr.height), listScrolls: list.scrollHeight > list.clientHeight + 1, listInside: lr.bottom <= br.bottom + 1,
          pickedScrollsOrFits: picked.scrollHeight <= picked.clientHeight + 1 || getComputedStyle(picked).overflowY !== 'visible', pickedInside: pr.bottom <= br.bottom + 1 };
      })()`);
    };
    for (const [w, h, n, label] of [[1400, 900, 3, "넓은 화면·고른 채널 3개"], [1400, 900, 60, "넓은 화면·고른 채널 60개"], [1400, 700, 60, "높이 700"]]) {
      const r = await run(w, h, n);
      check(r.listScrolls && r.listInside && r.listH >= 80, `${label}: 채널 목록이 창 안에서 스크롤한다 ${JSON.stringify(r)}`);
      check(r.pickedInside, `${label}: 고른 순서 목록도 창 밖으로 넘치지 않는다 ${JSON.stringify(r)}`);
    }
    // 오른쪽 패널이 없는 중간 폭, 본문이 스크롤하는 낮은 높이에서도 목록 자체는 스크롤한다.
    for (const [w, h, label] of [[800, 900, "폭 800(고른 순서 패널 없음)"], [1400, 600, "높이 600(본문 스크롤)"]]) {
      const r = await run(w, h, 3);
      check(r.listScrolls && r.listH >= 80, `${label}: 채널 목록이 스크롤한다 ${JSON.stringify(r)}`);
    }
    // 아이콘은 팝오버로 접혀 채널 목록이 위로 올라오고, 팝오버를 열어도 목록 자리는 그대로(위에 겹침).
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const pop = await ev(`(() => {
      document.head.querySelector('style')?.remove();
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      document.body.innerHTML = ${JSON.stringify(modal(3))};
      const list = document.getElementById('list'), body = document.querySelector('.cheese-cf-group-modal-body');
      const closedTop = Math.round(list.getBoundingClientRect().top - body.getBoundingClientRect().top);
      const closedH = Math.round(list.getBoundingClientRect().height);
      document.getElementById('popover').hidden = false;
      const p = document.getElementById('popover').getBoundingClientRect();
      const openTop = Math.round(list.getBoundingClientRect().top - body.getBoundingClientRect().top);
      const hit = document.elementFromPoint(p.left + 20, p.top + 20);
      return { closedTop, closedH, openTop, popoverOnTop: !!hit?.closest('#popover'), popoverInside: p.bottom <= body.getBoundingClientRect().bottom + 1 };
    })()`);
    check(pop.closedTop < 260 && pop.closedH > 330, `아이콘을 접어 채널 목록이 위로 올라오고 길어진다 ${JSON.stringify(pop)}`);
    check(pop.openTop === pop.closedTop && pop.popoverOnTop && pop.popoverInside, `팝오버를 열어도 목록 자리는 그대로고 팝오버가 위에 보인다 ${JSON.stringify(pop)}`);

    // 채널이 적어도 칸 높이는 같다(목록이 남는 높이를 채워도 줄이 늘어나지 않는다).
    await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const heights = [];
    for (const count of [1, 2, 3, 4, 5, 80]) {
      heights.push(await ev(`(() => {
        document.head.querySelector('style')?.remove();
        const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
        document.body.innerHTML = ${JSON.stringify(modal(3))};
        const list = document.getElementById('list');
        list.innerHTML = Array.from({ length: ${count} }, (_, i) => '<button class="cheese-cf-group-modal-channel">채널 ' + i + '</button>').join('');
        return Math.round(list.firstElementChild.getBoundingClientRect().height);
      })()`));
    }
    check(heights.every((h) => h === heights[heights.length - 1]), `채널 1·2·3·4·5개와 많을 때 칸 높이가 같다 ${JSON.stringify(heights)}`);
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
