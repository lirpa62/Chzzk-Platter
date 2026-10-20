// 멀티뷰 칸 크기 조절(칸 사이 경계 끌기).
//
// 일반·빈 칸 채팅 배치는 열·행, 채팅 위 배치는 열만 조절한다. 경계 손잡이를 끌면 이웃한
// 두 줄의 크기만 서로 주고받고, 두 번 누르면 원래 비율로 돌아간다. 크기 기억은 설정 >
// 멀티뷰 '칸 크기 기억': 배치 바꾸면 초기화(기본) / 이번 시청 동안만 / 배치별로 기억.
//
// 실제 multiview.css·multiviewLayouts.js 와 시청 화면의 크기 조절 코드를 그대로 올리고,
// applyLayout 은 격자에 필요한 부분만 줄여 쓴다(전체는 test-multiview-page.cjs).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const watch = read("src/multiviewWatch.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const start = watch.indexOf("  // ── 칸 크기 조절(칸 사이 경계 끌기)");
const end = watch.indexOf("  function applyLayout() {");
assert.ok(start > 0 && end > start, "크기 조절 코드를 찾지 못했다");
const trackCode = watch.slice(start, end);

// ── 정적 연결 ──
{
  const apply = watch.slice(end, watch.indexOf("\n  }\n", end));
  check(/applyGridTemplates\(layout, side, inset, hideChat\);/.test(apply) &&
    /scheduleTrackHandles\(\);\s*$/.test(apply.trimEnd() + "\n") || /scheduleTrackHandles\(\);/.test(apply),
    "applyLayout 이 격자를 그리고 손잡이를 다시 놓는다");
  check(/new ResizeObserver\(scheduleTrackHandles\)\.observe\(\$\("mvChat"\)\);/.test(watch),
    "채팅 폭·채팅 위 영상 높이가 바뀌면 손잡이를 다시 놓는다");
}

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-mv-track-"));
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
    await call("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await ev(`(() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(read("src/multiview.css"))} + 'html,body{margin:0;height:100%}';
      document.head.append(style);
      document.body.innerHTML = '<div style="display:flex;flex-direction:column;height:900px">' +
        '<main class="mv-stage" id="mvStage"><div class="mv-frames-fit" id="mvFramesFit">' +
        '<div class="mv-frames" id="mvFrames"></div></div><aside class="mv-chat" id="mvChat"></aside></main></div>';
    })()`);
    await ev(read("src/multiviewLayouts.js"));
    await ev(`(() => {
      window.localStore = {};
      const listeners = [];
      window.chrome = { storage: {
        local: {
          get: async () => ({ ...window.localStore }),
          set: async (values) => {
            const changes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }]));
            Object.assign(window.localStore, values);
            listeners.forEach((fn) => fn(changes, 'local'));
          },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      } };
      const $ = (id) => document.getElementById(id);
      const LAYOUTS = CheeseMultiviewLayouts;
      const state = { layoutId: 'right-3', chatSide: 'left', chosen: [] };
      const cells = new Map();
      // 격자에 필요한 만큼만 줄인 applyLayout(실제와 같은 함수를 부른다).
      function applyLayout() {
        const layout = LAYOUTS.layoutById(state.layoutId);
        const { side, direction } = LAYOUTS.stageStyle(layout, state.chatSide);
        const stage = $('mvStage');
        const inset = LAYOUTS.usesChatInset(layout, side);
        stage.classList.toggle('is-chat-top-layout', layout.chatTop === true);
        stage.classList.toggle('is-chat-inset-layout', inset);
        stage.style.flexDirection = direction;
        stage.dataset.chatSide = side;
        $('mvChat').style.gridArea = inset ? 'x' : '';
        const frames = $('mvFrames');
        while (cells.size > layout.aux + 1) { const [id, cell] = [...cells].pop(); cell.remove(); cells.delete(id); }
        for (let i = 0; i <= layout.aux; i++) {
          let cell = cells.get('c' + i);
          if (!cell) {
            cell = document.createElement('div');
            cell.className = 'mv-cell';
            cell.innerHTML = '<div class="mv-cell-inner"><iframe></iframe></div>';
            frames.appendChild(cell);
            cells.set('c' + i, cell);
          }
          cell.style.gridArea = LAYOUTS.SLOTS[i];
        }
        applyGridTemplates(layout, side, inset, false);
        scheduleTrackHandles();
      }
      // 내 배치의 채팅 2~4 칸(이 시험의 배치에는 없다).
      const extraChats = new Map();
      ${trackCode}
      window.__t = {
        state, cells, applyLayout,
        sizes: () => trackSizes,
        setMode: (mode, stored) => applyTrackMemorySetting(mode, stored),
        render: renderTrackHandles,
      };
      applyLayout();
    })()`);

    const frame = () => ev("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))");
    const rect = (id) => `__t.cells.get('${id}').getBoundingClientRect()`;
    const handles = async () => {
      await frame();
      return ev(`[...document.querySelectorAll('.mv-track-handle')].map((h) => {
        const r = h.getBoundingClientRect();
        return { axis: h.dataset.axis, index: +h.dataset.index, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
          w: Math.round(r.width), h: Math.round(r.height) };
      })`);
    };
    // 손잡이를 끈다(포인터 이벤트). dx/dy 만큼.
    const drag = (axis, index, delta, n = 0) => ev(`(() => {
      const h = [...document.querySelectorAll('.mv-track-handle')].filter((el) => el.dataset.axis === '${axis}' && +el.dataset.index === ${index})[${n}];
      const r = h.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const opts = (dx, dy) => ({ bubbles: true, button: 0, pointerId: 7, clientX: x + dx, clientY: y + dy });
      const d = ${delta};
      h.dispatchEvent(new PointerEvent('pointerdown', opts(0, 0)));
      const resizing = document.getElementById('mvStage').classList.contains('is-track-resizing');
      h.dispatchEvent(new PointerEvent('pointermove', '${axis}' === 'columns' ? opts(d / 2, 0) : opts(0, d / 2)));
      h.dispatchEvent(new PointerEvent('pointermove', '${axis}' === 'columns' ? opts(d, 0) : opts(0, d)));
      h.dispatchEvent(new PointerEvent('pointerup', opts(0, 0)));
      return resizing;
    })()`);

    // ── 일반 배치(오른쪽 3): 열 경계 하나, 보조 칸 사이 행 경계 둘 ──
    let list = await handles();
    const before = await ev(`({ mh: ${rect("c0")}.height, m: ${rect("c0")}.width, a: ${rect("c1")}.width, ah: ${rect("c1")}.height, bh: ${rect("c2")}.height,
      mRight: ${rect("c0")}.right, aLeft: ${rect("c1")}.left, aTop: ${rect("c1")}.top, aLeftX: ${rect("c1")}.left, aRightX: ${rect("c1")}.right })`);
    const col = list.filter((h) => h.axis === "columns");
    const rows = list.filter((h) => h.axis === "rows");
    check(col.length === 1 && Math.abs(col[0].x - (before.mRight + before.aLeft) / 2) <= 1 && Math.abs(col[0].h - before.mh) <= 2 &&
      rows.length === 2 && rows.every((h) => h.x > before.aLeftX && h.x < before.aRightX && h.w < before.aRightX - before.aLeftX + 2),
      "오른쪽 3: 메인|보조 사이 세로 손잡이 하나, 보조 칸 사이에만 가로 손잡이 둘");
    // 끄는 도중(손을 떼기 전)에도 같은 손잡이가 새 경계를 따라온다.
    const midDrag = await ev(`(async () => {
      const h = document.querySelector('.mv-track-handle[data-axis="columns"]');
      const r0 = h.getBoundingClientRect();
      const x = r0.left + r0.width / 2, y = r0.top + r0.height / 2;
      const opts = (dx) => ({ bubbles: true, button: 0, pointerId: 7, clientX: x + dx, clientY: y });
      h.dispatchEvent(new PointerEvent('pointerdown', opts(0)));
      h.dispatchEvent(new PointerEvent('pointermove', opts(60)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const still = document.querySelector('.mv-track-handle[data-axis="columns"]') === h;
      const r1 = h.getBoundingClientRect();
      const m = __t.cells.get('c0').getBoundingClientRect(), a = __t.cells.get('c1').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.mv-track-handle[data-axis="rows"]')].map((el) => el.getBoundingClientRect().left);
      h.dispatchEvent(new PointerEvent('pointerup', opts(60)));
      return { still, moved: (r1.left + r1.width / 2) - x, boundary: (m.right + a.left) / 2 - (r1.left + r1.width / 2),
        rowsFollow: rows.every((left) => Math.abs(left - a.left) <= 1) };
    })()`);
    check(midDrag.still && Math.abs(midDrag.moved - 60) <= 2 && Math.abs(midDrag.boundary) <= 1 && midDrag.rowsFollow,
      "끄는 동안 잡은 손잡이가 경계를 따라오고(같은 요소, 포인터 캡처 유지), 다른 손잡이도 칸을 따라간다");
    await ev(`document.querySelector('.mv-track-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await frame();
    // 한 프레임에 포인터 이벤트가 여러 번 와도 격자는 한 번만 바꾼다(칸 iframe 재배치 비용).
    const throttle = await ev(`(async () => {
      const frames = document.getElementById('mvFrames');
      const h = document.querySelector('.mv-track-handle[data-axis="columns"]');
      const r0 = h.getBoundingClientRect();
      const x = r0.left + r0.width / 2, y = r0.top + r0.height / 2;
      const opts = (dx) => ({ bubbles: true, button: 0, pointerId: 7, clientX: x + dx, clientY: y });
      let writes = 0;
      const mo = new MutationObserver((list) => { writes += list.length; });
      h.dispatchEvent(new PointerEvent('pointerdown', opts(0)));
      mo.observe(frames, { attributes: true, attributeFilter: ['style'] });
      for (let i = 1; i <= 10; i++) h.dispatchEvent(new PointerEvent('pointermove', opts(i * 5)));
      const before = writes;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r));
      const after = writes;
      mo.disconnect();
      const m = __t.cells.get('c0').getBoundingClientRect().width;
      h.dispatchEvent(new PointerEvent('pointerup', opts(50)));
      return { before, after, m };
    })()`);
    check(throttle.before === 0 && throttle.after >= 1 && throttle.after <= 3 && Math.abs(throttle.m - before.m - 50) <= 2,
      "포인터 이벤트 10번이 한 프레임에 와도 격자는 프레임마다 한 번만 바꾸고, 마지막 위치를 쓴다");
    await ev(`document.querySelector('.mv-track-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await frame();
    // 창 밖에서 놓거나 창을 떠나 pointerup 이 안 와도 끝낸다(iframe 포인터·손잡이 복구).
    const abandoned = await ev(`(async () => {
      const stage = document.getElementById('mvStage');
      const h = document.querySelector('.mv-track-handle[data-axis="columns"]');
      const r0 = h.getBoundingClientRect();
      const opts = { bubbles: true, button: 0, pointerId: 7, clientX: r0.left + 5, clientY: r0.top + 5 };
      h.dispatchEvent(new PointerEvent('pointerdown', opts));
      const during = stage.classList.contains('is-track-resizing');
      window.dispatchEvent(new Event('blur'));
      const afterBlur = !stage.classList.contains('is-track-resizing') && !h.classList.contains('is-dragging');
      h.dispatchEvent(new PointerEvent('pointerdown', opts));
      h.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
      const afterLost = !stage.classList.contains('is-track-resizing');
      // 끝난 뒤 배치를 바꾸면 손잡이를 다시 만든다(굳지 않았다).
      __t.state.layoutId = 'left-3'; __t.applyLayout();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rebuilt = document.querySelectorAll('.mv-track-handle[data-axis="rows"]').length === 2;
      __t.state.layoutId = 'right-3'; __t.applyLayout();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { during, afterBlur, afterLost, rebuilt };
    })()`);
    check(abandoned.during && abandoned.afterBlur && abandoned.afterLost && abandoned.rebuilt,
      "창 포커스를 잃거나 포인터 캡처를 잃으면 끄기를 끝내 iframe 포인터와 손잡이를 되돌린다");
    check(await drag("columns", 0, 120), "끄는 동안 iframe 이 포인터를 가로채지 않게 표시한다");
    const after = await ev(`({ m: ${rect("c0")}.width, a: ${rect("c1")}.width, custom: document.getElementById('mvFrames').classList.contains('has-custom-tracks'),
      resizing: document.getElementById('mvStage').classList.contains('is-track-resizing'),
      inner: (() => { const r = __t.cells.get('c1').querySelector('.mv-cell-inner').getBoundingClientRect(); return r.width / r.height; })() })`);
    check(Math.abs(after.m - before.m - 120) <= 2 && Math.abs(before.a - after.a - 120) <= 2 && after.custom && !after.resizing,
      "열 경계를 120px 끌면 메인이 그만큼 넓어지고 보조가 좁아진다");
    check(Math.abs(after.inner - 16 / 9) < 0.02, "16:9 가 아닌 칸에서도 영상 상자는 16:9(남는 자리는 여백)");
    await drag("rows", 0, 80);
    const rowAfter = await ev(`({ ah: ${rect("c1")}.height, bh: ${rect("c2")}.height, m: ${rect("c0")}.height })`);
    check(Math.abs(rowAfter.ah - before.ah - 80) <= 2 && Math.abs(before.bh - rowAfter.bh - 80) <= 2,
      "행 경계를 끌면 맞닿은 두 보조 칸만 높이를 주고받는다(메인은 그대로)");
    await drag("columns", 0, 5000);
    const clamped = await ev(`${rect("c1")}.width`);
    check(clamped >= 48 - 1, "한쪽 칸이 사라지지 않게 최소 크기를 남긴다");
    // 두 번 누르면 원래대로.
    await frame();
    await ev(`document.querySelector('.mv-track-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await frame();
    const reset = await ev(`({ m: ${rect("c0")}.width, custom: document.getElementById('mvFrames').classList.contains('has-custom-tracks') })`);
    check(Math.abs(reset.m - before.m) <= 1 && !reset.custom, "손잡이를 두 번 누르면 원래 비율로 돌아간다");

    // ── 기억 방식 ──
    const widthAfter = async (layoutId, mutate) => {
      await ev(`(() => { __t.state.layoutId = '${layoutId}'; __t.applyLayout(); })()`);
      await handles();
      if (mutate) await drag("columns", 0, 100);
      return ev(`${rect("c0")}.width`);
    };
    const original = await widthAfter("right-3", false);
    const changed = await widthAfter("right-3", true);
    await widthAfter("left-3", false);
    check(Math.abs((await widthAfter("right-3", false)) - original) <= 1 && Object.keys(await ev("Object.fromEntries(__t.sizes())")).length === 0,
      "배치 바꾸면 초기화(기본): 다른 배치에 갔다 오면 원래 비율");
    await ev(`__t.setMode('session')`);
    await widthAfter("right-3", true);
    await widthAfter("left-3", false);
    check(Math.abs((await widthAfter("right-3", false)) - changed) <= 1 && !("cheeseMultiviewTrackSizes" in (await ev("window.localStore"))),
      "이번 시청 동안만: 다른 배치에 갔다 와도 그대로, 저장하지는 않는다");
    await ev(`chrome.storage.local.set({ cheeseMultiviewTrackMemory: 'layout' })`);
    await frame();
    await widthAfter("right-3", true);
    const saved = await ev("window.localStore.cheeseMultiviewTrackSizes");
    check(Array.isArray(saved?.["right-3"]?.columns) && saved["right-3"].columns.length === 2,
      "배치별로 기억: 끈 크기를 배치별로 저장한다");
    // 새로 연 시청 화면처럼: 모드를 다시 읽으면 저장한 크기로 연다.
    await ev(`(() => { __t.sizes().clear(); __t.setMode('layout', window.localStore.cheeseMultiviewTrackSizes); })()`);
    const restored = await widthAfter("right-3", false);
    check(Math.abs(restored - original) > 50, "배치별로 기억: 다시 열면 저장한 크기로");
    await ev(`(() => { __t.sizes().clear(); __t.setMode('layout', { 'right-3': { columns: [1, 2, 3] }, '없는배치': { columns: [1, 1] } }); })()`);
    check(Math.abs((await widthAfter("right-3", false)) - original) <= 1, "트랙 수가 맞지 않는 저장값은 쓰지 않는다");
    await ev(`(() => { __t.sizes().clear(); __t.setMode('reset'); })()`);

    // ── 채팅 위 배치: 격자 열만, 채팅 열 너비는 그대로 ──
    for (const side of ["right", "left"]) {
      await ev(`(() => { __t.state.layoutId = 'grid-2x2-chat-top'; __t.state.chatSide = '${side}'; __t.applyLayout(); })()`);
      list = await handles();
      const chatBefore = await ev(`document.getElementById('mvChat').getBoundingClientRect().width`);
      const mBefore = await ev(`${rect("c0")}.width`);
      await drag("columns", 0, 90);
      const res = await ev(`({ chat: document.getElementById('mvChat').getBoundingClientRect().width, m: ${rect("c0")}.width, a: ${rect("c1")}.width })`);
      check(list.every((h) => h.axis === "columns") && list.length === 1 &&
        Math.abs(res.chat - chatBefore) <= 1 && Math.abs(res.m - mBefore - 90) <= 2,
        `채팅 위 1(${side}): 격자 열 손잡이만, 끌어도 채팅 열 너비는 그대로`);
      await ev(`__t.sizes().clear()`);
    }

    // ── 빈 칸 채팅: 스테이지 격자의 행·열, 채팅 칸 경계도 끈다 ──
    await ev(`(() => { __t.state.layoutId = 'right2-bottom2'; __t.state.chatSide = 'inset'; __t.applyLayout(); })()`);
    list = await handles();
    const chatH = await ev(`document.getElementById('mvChat').getBoundingClientRect().height`);
    await drag("rows", 1, -60, list.filter((h) => h.axis === "rows" && h.index === 1).length - 1);
    const chatH2 = await ev(`document.getElementById('mvChat').getBoundingClientRect().height`);
    check(list.some((h) => h.axis === "columns") && list.some((h) => h.axis === "rows") && Math.abs(chatH2 - chatH - 60) <= 2,
      "빈 칸 채팅: 열·행 손잡이, 채팅 칸과 맞닿은 경계를 끌면 채팅 칸도 커진다");

    // ── 설정 '멀티뷰 칸 사이 크기 조절' 끄기 ──
    await ev(`(() => { __t.state.layoutId = 'right-3'; __t.state.chatSide = 'left'; __t.applyLayout(); })()`);
    await handles();
    await drag("columns", 0, 100);
    const customWidth = await ev(`${rect("c0")}.width`);
    await ev(`chrome.storage.local.set({ cheeseMultiviewTrackResize: false })`);
    const off = { list: await handles(), m: await ev(`${rect("c0")}.width`),
      custom: await ev(`document.getElementById('mvFrames').classList.contains('has-custom-tracks')`) };
    await ev(`chrome.storage.local.set({ cheeseMultiviewTrackResize: true })`);
    const on = { list: await handles(), m: await ev(`${rect("c0")}.width`) };
    check(off.list.length === 0 && Math.abs(off.m - original) <= 1 && !off.custom &&
      on.list.length === 3 && Math.abs(on.m - customWidth) <= 1,
      "옵션을 끄면 손잡이가 없고 기본 비율, 다시 켜면 바꿔 둔 크기로(지우지 않는다)");
    await ev(`__t.sizes().clear()`);

    // ── 크게 보기·칸 옮기기 중에는 손잡이를 숨긴다 ──
    const hidden = await ev(`(() => {
      const stage = document.getElementById('mvStage');
      const box = document.getElementById('mvTrackHandles');
      stage.classList.add('has-expanded-cell');
      const a = getComputedStyle(box).display;
      stage.classList.remove('has-expanded-cell');
      stage.classList.add('is-cell-dragging');
      const b = getComputedStyle(box).display;
      stage.classList.remove('is-cell-dragging');
      return a === 'none' && b === 'none' && getComputedStyle(box).display !== 'none';
    })()`);
    check(hidden, "크게 보기·칸 자리 바꾸기 중에는 손잡이를 숨긴다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // ── 설정 ──
  const html = read("settings.html");
  const settings = read("src/settings.js");
  const block = html.slice(html.indexOf("data-multiview-track-memory\n") - 1500, html.indexOf("data-multiview-track-memory\n") + 1500);
  check(/칸 크기 기억/.test(block) &&
    /data-multiview-track-memory-value="layout"[\s\S]*배치별로 기억/.test(block) &&
    /data-multiview-track-memory-value="session"[\s\S]*이번 시청 동안만/.test(block) &&
    /data-multiview-track-memory-value="reset"\s*role="radio"\s*aria-checked="true"[\s\S]*배치 바꾸면 초기화/.test(block),
    "설정 > 멀티뷰 '칸 크기 기억': 배치별로 기억 / 이번 시청 동안만 / 배치 바꾸면 초기화(기본)");
  const toggle = html.indexOf("data-multiview-track-resize");
  check(toggle > 0 && toggle < html.indexOf("data-multiview-track-memory\n") &&
    /멀티뷰 칸 사이 크기 조절/.test(html.slice(toggle - 1200, toggle)) &&
    /└ 칸 크기 기억/.test(html.slice(toggle, html.indexOf("data-multiview-track-memory\n"))),
    "설정 > 멀티뷰: '멀티뷰 칸 사이 크기 조절' 아래 하위 옵션 '└ 칸 크기 기억'");
  check(/\["\[data-multiview-track-resize\]", "cheeseMultiviewTrackResize", true\]/.test(settings) &&
    /SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseMultiviewTrackResize"/.test(settings) &&
    /\["\[data-multiview-track-resize\]", "\[data-multiview-track-memory\]"\]/.test(read("src/settingsUi.js")),
    "켜기/끄기는 기본 켜짐, 미리 읽기 목록에 있고, 끄면 하위 옵션이 잠긴다(설정 검색 경로도)");
  check(/SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseMultiviewTrackMemory"/.test(settings) &&
    /\["layout", "session", "reset"\]\.includes\(value\) \? value : "reset"/.test(settings),
    "설정값을 미리 읽고, 모르는 값은 기본(초기화)");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
