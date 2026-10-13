// 채팅 너비 조절·왼쪽 배치에서 프로필 팝오버의 '연속 후원중' ⓘ 툴팁을 열면 내용이 좁아지고,
// 닉네임 아래 배지 툴팁이 배지에서 멀리 뜨던 문제(둘 다 같은 원인).
//
// 실측: 툴팁이 열리면 치지직은 #popup_contents 를 좌우로 60px 씩 넓힌다(음수 margin + 같은 만큼
// padding, 333→453px, 안쪽 293px 유지). 우리 max-width:100% 가 넓힌 폭만 막아 늘어난 padding 이
// 안쪽을 깎았다(284px 칸에서 244→124px). 아래 픽스처는 그 넓힘을 같은 방식으로 흉내 낸다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const dir = mkdtempSync(join(tmpdir(), "cheese-profile-tip-"));
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

const NATIVE_CSS = `
  ._container_jao35_20 { position: fixed; top: 0; left: 8px; display: flex; flex-direction: column;
    width: 333px; overflow: visible; background: #fff; }
  ._contents_jao35_54 { flex: 1 1 0%; display: flex; flex-direction: column; padding: 0 20px; }
  /* 툴팁이 열리면 내용 영역을 좌우로 넓힌다(실측 값). */
  ._contents_jao35_54:has([role="tooltip"]) { margin: 0 -60px; padding: 0 80px; }
  ._history_y6scg_23 { position: relative; display: flex; flex-direction: column; }
  ._layer_abx28_11 { position: absolute; top: 32px; left: 11px; white-space: nowrap; }
`;

(async () => {
  let failed = 0;
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await call("Emulation.setDeviceMetricsOverride", { width: 1259, height: 958, deviceScaleFactor: 1, mobile: false }, sessionId);
    await ev(`(() => {
      for (const css of [${JSON.stringify(NATIVE_CSS)}, ${JSON.stringify(readFileSync("src/content.css", "utf8"))}]) {
        const st = document.createElement("style"); st.textContent = css; document.head.append(st);
      }
      return true;
    })()`);
    const measure = (rootClass, open) => ev(`(() => {
      const root = document.documentElement;
      root.className = ${JSON.stringify(rootClass)};
      root.style.setProperty("--cheese-chat-profile-popup-width", "284px");
      const tip = ${open} ? '<div id="continuous-donation-tooltip" role="tooltip" class="_layer_abx28_11">연속해서 후원하면 프로필에 표시돼요</div>' : "";
      document.body.innerHTML =
        '<aside id="aside-chatting" style="width:304px"><div class="_item_8lqsk_7">' +
        '<div class="_container_jao35_20 _container_y6scg_2" role="alertdialog" aria-modal="true">' +
        '<div class="_contents_jao35_54" id="popup_contents">' +
        '<button type="button" class="_information_y6scg_12">검우치</button>' +
        '<div class="_history_y6scg_23"><div class="_row_y6scg_186"><span class="_cell_xwsra_155">4일째 연속 후원중' +
        '<span class="_container_abx28_1"><button type="button" aria-expanded="${open}">i</button>' + tip + '</span></span></div></div>' +
        '</div></div></div></aside>';
      const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
      return { dialog: w('[role="alertdialog"]'), contents: w("#popup_contents"), info: w("._information_y6scg_12"), history: w("._history_y6scg_23") };
    })()`);

    const ok = (condition, label) => {
      console.log(`${condition ? "  PASS" : "  FAIL"} ${label}`);
      if (!condition) failed += 1;
    };
    for (const rootClass of ["cheese-chat-width-resize-enabled", "cheese-chat-left-position",
      "cheese-chat-width-resize-enabled cheese-chat-left-position"]) {
      const closed = await measure(rootClass, false);
      const open = await measure(rootClass, true);
      console.log(`[${rootClass}] 닫힘 ${JSON.stringify(closed)} / 열림 ${JSON.stringify(open)}`);
      ok(closed.dialog === 284 && closed.contents === 284 && closed.info === 244, "툴팁 닫힘: 팝오버 284px, 안쪽 244px");
      ok(open.info === closed.info && open.history === closed.history,
        `툴팁 열림: 안쪽 폭이 그대로(${open.info}px, 예전엔 124px)`);
      ok(open.contents === 404, `툴팁 열림: 치지직처럼 내용 영역만 좌우로 넓어진다(${open.contents}px)`);
    }
    // 배지 툴팁도 처음 한 프레임은 배지 안에 role="tooltip" 으로 그려지고, 치지직은 그 순간 배지 위치를
    // 재서 툴팁을 놓는다. 그때 안쪽이 좁아져 배지가 다음 줄로 밀리면 툴팁이 엉뚱한 곳에 뜬다
    // (실측: 하트 배지 x=116,y=313.5 인데 x=94,y=354.5 로 재서 41px 아래·22px 왼쪽).
    const badge = (open) => ev(`(() => {
      document.body.innerHTML =
        '<aside id="aside-chatting"><div role="alertdialog" class="_container_jao35_20">' +
        '<div class="_contents_jao35_54" id="popup_contents">' +
        '<div class="_information_y6scg_12" style="display:flex;gap:12px"><span style="flex:none;width:54px;height:54px"></span>' +
        // 오른쪽 위 닫기 버튼 자리만큼 비운다(실측: 안쪽이 124px 로 줄면 하트 배지가 다음 줄로 밀렸다).
        '<span style="display:flex;flex-direction:column;flex:1 1 auto;min-width:0;padding-right:24px"><strong>검우치</strong>' +
        '<span class="_badge_y6scg_113" style="display:flex;flex-wrap:wrap;gap:4px">' +
        '<span style="flex:none;width:18px;height:18px"></span>' +
        '<span id="fan" style="position:relative;flex:none;width:18px;height:18px">' +
        (${open} ? '<span role="tooltip" style="position:absolute;top:100%;left:50%;width:max-content">오늘도 입덕 완료</span>' : "") +
        '</span></span></span></div>' +
        '<div class="_history_y6scg_23">1개월 구독중 · 2026년 9월 23일 부터 팔로우</div>' +
        '</div></div></aside>';
      const r = document.getElementById("fan").getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top) };
    })()`);
    const badgeClosed = await badge(false);
    const badgeOpen = await badge(true);
    ok(badgeOpen.x === badgeClosed.x && badgeOpen.y === badgeClosed.y,
      `배지 툴팁이 배지 안에 그려지는 순간에도 배지 위치가 그대로(${JSON.stringify(badgeClosed)} → ${JSON.stringify(badgeOpen)})`);

    // 툴팁이 없는 다이얼로그(후원·클린봇 등)는 여전히 칸 폭을 넘지 않는다.
    const plain = await ev(`(() => {
      document.body.innerHTML = '<aside id="aside-chatting"><div role="alertdialog"><div id="popup_contents" style="width:600px">x</div></div></aside>';
      return Math.round(document.querySelector("#popup_contents").getBoundingClientRect().width);
    })()`);
    ok(plain === 284, `툴팁 없는 다이얼로그 내용은 여전히 칸 폭까지(${plain}px)`);
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
