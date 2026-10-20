// '사용 중인 프로필' 팝업 안 시청 시간 표(cheese-watch-time-table)가 채팅창이 좁아져도 잘리지 않는다.
// 원인: 칸마다 white-space:nowrap 이라 표가 276px 아래로 줄지 않았다. 채팅창 최소 폭(220px)이면
// 팝업 안쪽은 160px(팝업 = 채팅 폭 - 20, 좌우 padding 20)까지 준다.
// 실제 content.css 로 160~360px 안쪽 폭마다 표 폭이 안쪽을 넘지 않는지, 넓을 때는 한 줄인지 본다.
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

const css = fs.readFileSync(path.join(__dirname, "..", "src", "content.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const dir = mkdtempSync(path.join(tmpdir(), "cheese-watch-time-table-"));
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

// showWatchTimeInDialog 와 같은 표. 값은 formatDuration 모양("1,246시간 48분").
const table = (values) => {
  const [a, b, c, d, e, f] = values;
  return '<table class="cheese-watch-time-table"><thead><tr><th scope="col"></th><th scope="col">로그인</th><th scope="col">비로그인</th><th scope="col">합계</th></tr></thead><tbody>' +
    `<tr><th scope="row">다시보기</th><td>${a}</td><td>${b}</td><td>${c}</td></tr>` +
    `<tr><th scope="row">라디오</th><td>-</td><td>-</td><td>-</td></tr>` +
    `<tr class="is-total"><th scope="row">합계</th><td>${d}</td><td>${e}</td><td>${f}</td></tr></tbody></table>`;
};
const CASES = {
  "아주 큰 값": ["123시간 45분", "12시간 3분", "135시간 48분", "1,234시간 45분", "12시간 3분", "1,246시간 48분"],
  "흔한 값": ["23시간 45분", "45분", "24시간 30분", "48시간 5분", "12분", "48시간 17분"],
};

(async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(css)}; document.head.append(st); return true; })()`);
    for (const [name, values] of Object.entries(CASES)) {
      const result = await ev(`(() => {
        const out = {};
        for (const w of [160, 180, 200, 220, 244, 270, 290, 320, 360]) {
          document.body.innerHTML = '<div style="width:' + w + 'px;overflow:hidden;font-family:sans-serif">' +
            '<div class="cheese-recap-dialog-view cheese-watch-time-view">' + ${JSON.stringify(table(values))} + '</div></div>';
          const t = document.querySelector("table");
          const cells = [...t.querySelectorAll("td, th")];
          out[w] = {
            table: Math.round(t.getBoundingClientRect().width),
            // 칸 안 글자가 칸 밖으로 넘치는지(잘림)
            spill: cells.some((cell) => cell.scrollWidth > cell.clientWidth + 1),
            // 값이 두 줄로 나뉘었는지
            wrapped: cells.some((cell) => cell.getClientRects().length && cell.getBoundingClientRect().height > 30),
            // 이름 칸은 한 줄이어야 한다(줄 높이로 본다)
            brokenLabel: [...t.querySelectorAll("th")].some((cell) => {
              const range = document.createRange();
              range.selectNodeContents(cell);
              return range.getClientRects().length > 1;
            }),
          };
        }
        if (${JSON.stringify(process.env.WATCH_TIME_TABLE_SHOT || "")}) {
          document.body.innerHTML = [160, 244, 320].map((w) => '<div style="width:' + w + 'px;margin:8px;padding:0 4px;background:#141517;color:#fff;font-family:sans-serif;outline:1px solid #f0f">' +
            '<div class="cheese-recap-dialog-view cheese-watch-time-view">' + ${JSON.stringify(table(values))} + '</div></div>').join("");
        }
        return out;
      })()`);
      if (process.env.WATCH_TIME_TABLE_SHOT) {
        const shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 360, height: 400, scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(process.env.WATCH_TIME_TABLE_SHOT, `watch-time-table-${name === "아주 큰 값" ? "big" : "typical"}.png`), Buffer.from(shot.data, "base64"));
      }
      const over = Object.entries(result).filter(([w, r]) => r.table > Number(w) || r.spill);
      check(over.length === 0, `${name}: 안쪽 160~360px 어디서도 표가 넘치거나 칸 글자가 잘리지 않는다 ${JSON.stringify(over)}`);
      check(!result[320].wrapped && !result[360].wrapped, `${name}: 넓을 때(320px↑)는 값이 한 줄 그대로 ${JSON.stringify(result[320])}`);
      check(Object.values(result).every((r) => !r.brokenLabel), `${name}: 이름 칸('비로그인'·'다시보기')은 쪼개지지 않는다 ${JSON.stringify(result[160])}`);
      if (name === "흔한 값") {
        check(!result[220].wrapped && !result[244].wrapped, `${name}: 기본 채팅 폭(안쪽 244px)·220px 에서도 한 줄 ${JSON.stringify({ 220: result[220], 244: result[244] })}`);
      }
    }
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
