// 라이브 되감기 바가 보일 때 하단 버튼 툴팁이 바에 가려지지 않아야 한다.
//
// 되감기 바(.cheese-live-seek-bar, z-index 60)는 플레이어(.pzp-pc) 바로 아래 자식이고, 치지직 하단
// 버튼 툴팁(.pzp-button__tooltip)은 z-index 없는 하단 바 안에 있어 바 아래에 그려졌다. 툴팁이 세 줄로
// 늘어 바와 겹치는 일이 잦아졌다.
//   - 바가 있으면 <html data-cheese-live-seek-bar> 를 붙이고, 버튼 줄(.pzp-pc__bottom-buttons)에
//     마우스가 올라 있을 때만 버튼 줄을 z-index 61 로 올린다.
//   - 표시를 플레이어 클래스로 하지 않는다: 치지직이 재생·컨트롤 상태가 바뀔 때 플레이어 className 을
//     통째로 다시 써서 지워졌다(실측: 바는 보이는데 표시 클래스가 없고 버튼 줄 z-index 가 auto).
//   - 늘 올리지 않는다: 바를 낮게 둔 설정(35px~)에서 버튼 줄 상자가 바를 덮어 드래그가 막힌다.
//   - 여러 줄 툴팁은 아래 끝을 맞춰 위로 자라게 한다(치지직은 top 음수라 아래로 자라 버튼을 덮었다).
//   - 전체 화면 큰 크기에서는 버튼 묶음에 transform 이 걸려(쌓임 맥락) 툴팁 z-index 로는 못 빠져나온다.
// 실제 audioMixer.css 와 치지직 하단 바 규칙(player-vendor CSS 에서 옮김)으로 모의 플레이어를 만들어 확인한다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const mixer = readFileSync(path.join(ROOT, "src/audioMixer.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/audioMixer.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

check(/const SEEK_BAR_ROOT_ATTR = "data-cheese-live-seek-bar";/.test(mixer) &&
  /document\.documentElement\.setAttribute\(SEEK_BAR_ROOT_ATTR, ""\)/.test(sliceFn(mixer, "ensureSeekBar")),
  "바를 붙이면 <html> 에 data-cheese-live-seek-bar 를 붙인다");
check(/document\.documentElement\.removeAttribute\(SEEK_BAR_ROOT_ATTR\)/.test(sliceFn(mixer, "removeSeekBar")),
  "바를 지우면 <html> 표시도 뗀다");
check(!/cheese-has-live-seek-bar/.test(mixer + css), "치지직이 다시 쓰는 플레이어 className 에는 표시를 두지 않는다");

// 치지직 하단 바 규칙(실측 player-vendor CSS 의 해당 부분) + 툴팁 표시를 흉내 낸 규칙.
const nativeCss = `
  body { margin: 0; }
  .pzp-pc { position: relative; width: 800px; height: 450px; background: #000; }
  .pzp-pc .pzp-pc__bottom { pointer-events: none; position: absolute; bottom: 8px; left: 18px; right: 18px; }
  .pzp-pc .pzp-pc__bottom > * { pointer-events: auto; }
  .pzp-pc .pzp-pc__bottom-buttons { pointer-events: none; justify-content: space-between; width: 100%; height: 36px; display: flex; position: relative; }
  .pzp-pc .pzp-pc__bottom-buttons > * { pointer-events: auto; }
  .pzp-pc .pzp-pc__bottom-buttons-left, .pzp-pc .pzp-pc__bottom-buttons-right { align-items: center; display: flex; position: relative; }
  .fs .pzp-pc__bottom-buttons-right { transform-origin: 100% 100%; transform: scale(1.5); }
  .pzp-button { position: relative; width: 36px; height: 36px; padding: 0; border: 0; background: #333; }
  .pzp-button__tooltip { color: #fff; text-align: center; white-space: nowrap; visibility: hidden; background-color: #0009; border-radius: 14px; margin: 0; padding: 6px 12px; font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; font-size: 13px; line-height: normal; position: absolute; top: -27px; left: 50%; transform: translate(-50%); }
  .pzp-button__tooltip--top { top: -40px; }
  .pzp-pc--playing .pzp-button__tooltip--top { top: -52px; }
  .pzp-pc--size-medium .pzp-button__tooltip--top { top: -38px; }
  .pzp-pc--size-small .pzp-button__tooltip--top { top: -33px; }
  .pzp-pc .pzp-pc__bottom-buttons-right > .pzp-button:last-of-type .pzp-button__tooltip { left: auto; right: 0; transform: translate(0); }
  .pzp-button:hover .pzp-button__tooltip { visibility: visible; }
`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-seekbar-tooltip-"));
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
    const move = async (x, y) => {
      await call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    const setup = (opts) => ev(`(() => {
      document.documentElement.style.setProperty('--cheese-live-seek-bar-bottom', '${opts.barBottom}px');
      document.body.className = ${JSON.stringify(opts.fullscreen ? "fs" : "")};
      document.querySelector('.pzp-pc').className = 'pzp-pc pzp-pc--playing';
      document.documentElement.toggleAttribute('data-cheese-live-seek-bar', ${opts.marked ? "true" : "false"});
      const btn = document.getElementById('mixer').getBoundingClientRect();
      const tip = document.querySelector('#mixer .pzp-button__tooltip').getBoundingClientRect();
      const track = document.querySelector('.cheese-live-seek-bar__track').getBoundingClientRect();
      return { btn: { x: btn.left + btn.width / 2, y: btn.top + btn.height / 2, top: btn.top }, tip: { left: tip.left, right: tip.right, top: tip.top, bottom: tip.bottom }, track: { top: track.top, bottom: track.bottom } };
    })()`);
    const hit = (x, y) => ev(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el ? (el.id || el.className) : null; })()`);

    await ev(`(() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(nativeCss)} + ${JSON.stringify(css)};
      document.head.appendChild(style);
      document.body.innerHTML =
        '<div class="pzp-pc"><div class="pzp-pc__bottom"><div class="pzp-pc__bottom-buttons">' +
        '<div class="pzp-pc__bottom-buttons-left"><button class="pzp-button" id="play"></button></div>' +
        '<div class="pzp-pc__bottom-buttons-right"><button class="pzp-button cheese-audio-mixer-button" id="mixer"><span class="pzp-button__tooltip pzp-button__tooltip--top">오디오 믹서 (Shift+A)\\n휠: 프리셋 전환\\n우클릭: 설정 패널 열기</span></button><button class="pzp-button" id="full"></button></div>' +
        '</div></div>' +
        '<div class="cheese-live-seek-bar is-visible"><div class="cheese-live-seek-bar__track"></div></div></div>';
      return true;
    })()`);

    // 0) 위치: 여러 줄 툴팁은 아래 끝이 치지직 한 줄 툴팁과 같은 자리이고 위로 자란다.
    for (const size of ["", " pzp-pc--size-medium", " pzp-pc--size-small", "paused"]) {
      const r = await ev(`(() => {
        const pc = document.querySelector('.pzp-pc');
        pc.className = ${JSON.stringify(size === "paused" ? "pzp-pc" : "pzp-pc pzp-pc--playing")} + ${JSON.stringify(size === "paused" ? "" : size)};
        const host = document.querySelector('.pzp-pc__bottom-buttons-left');
        host.insertAdjacentHTML('beforeend', '<button class="pzp-button" id="native"><span class="pzp-button__tooltip pzp-button__tooltip--top">채팅</span></button><button class="pzp-button cheese-video-filter-button" id="one"><span class="pzp-button__tooltip pzp-button__tooltip--top">비디오 필터</span></button>');
        const rect = (id) => { const t = document.querySelector('#' + id + ' .pzp-button__tooltip').getBoundingClientRect(); return { top: t.top, bottom: t.bottom }; };
        const out = { native: rect('native'), one: rect('one'), multi: rect('mixer'), btnTop: document.getElementById('mixer').getBoundingClientRect().top };
        document.getElementById('native').remove(); document.getElementById('one').remove();
        return out;
      })()`);
      const label = size.trim() || "재생 중";
      check(Math.abs(r.one.bottom - r.native.bottom) <= 2 && Math.abs(r.one.top - r.native.top) <= 2,
        `${label}: 한 줄일 때는 치지직 툴팁과 같은 자리 ${JSON.stringify(r)}`);
      check(Math.abs(r.multi.bottom - r.native.bottom) <= 2 && r.multi.top < r.native.top - 25 && r.multi.bottom < r.btnTop,
        `${label}: 세 줄 툴팁은 아래 끝을 맞추고 위로 자라 버튼을 덮지 않는다`);
    }

    // 1) 대조: 표시가 없으면(예전) 툴팁이 바 아래에 깔린다.
    {
      const box = await setup({ barBottom: 70, marked: false });
      const x = (box.tip.left + box.tip.right) / 2;
      const y = (box.track.top + box.track.bottom) / 2;
      check(box.tip.top < y && box.tip.bottom > y, `모의 배치: 툴팁이 바와 겹친다 ${JSON.stringify(box)}`);
      await move(box.btn.x, box.btn.y);
      check(await hit(x, y) === "cheese-live-seek-bar__track", "대조: 층을 올리지 않으면 툴팁이 되감기 바에 가려진다");
      await move(5, 5);
    }
    // 2) 바가 붙은 플레이어에서 버튼에 마우스를 올리면 툴팁이 바 위에 보인다.
    for (const fullscreen of [false, true]) {
      const box = await setup({ barBottom: fullscreen ? 100 : 70, marked: true, fullscreen });
      const x = (box.tip.left + box.tip.right) / 2;
      const y = (box.track.top + box.track.bottom) / 2;
      check(box.tip.top < y && box.tip.bottom > y, `모의 배치${fullscreen ? "(전체 화면 1.5배)" : ""}: 툴팁이 바와 겹친다`);
      await move(box.btn.x, box.btn.y);
      const top = await hit(x, y);
      check(top .startsWith("pzp-button__tooltip"), `버튼 호버 중에는 툴팁이 되감기 바 위에 보인다${fullscreen ? "(전체 화면 큰 크기, 버튼 묶음 transform)" : ""} (${top})`);
      await move(5, 5);
      check(await hit(x, y) === "cheese-live-seek-bar__track", `버튼에서 벗어나면 바가 다시 맨 위(드래그 가능)${fullscreen ? "(전체 화면)" : ""}`);
    }
    // 3) 바를 낮게 두어 버튼과 겹쳐도, 버튼에 마우스가 없으면 바를 잡을 수 있다.
    {
      const box = await setup({ barBottom: 35, marked: true });
      const y = (box.track.top + box.track.bottom) / 2;
      check(y > box.btn.top, `모의 배치: 바(35px)가 버튼 줄과 겹친다 ${JSON.stringify(box)}`);
      await move(5, 5);
      check(await hit(box.btn.x, y) === "cheese-live-seek-bar__track", "바를 낮게 둬도 버튼 호버가 아니면 겹친 곳에서 바를 잡는다");
    }
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
