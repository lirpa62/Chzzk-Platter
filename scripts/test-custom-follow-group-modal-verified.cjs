// 전용 팔로잉 그룹 창(추가·수정): 채널 목록과 고른 채널 목록에도 인증 마크.
//
// 사이드바 전용 팔로잉에는 인증 마크가 붙는데, 그룹 창의 채널 목록·고른 채널 목록은 이름만 그려 마크가 없었다.
// 같은 아이콘(.cheese-cf-official, 종류는 CheeseVerifiedMark)을 이름 뒤에 붙이고, 이름이 길면 이름만 말줄임해
// 마크가 잘리지 않게 한다. 실제 content.css 로 좁은 줄에서 잰다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const content = read("src/content.js");
const css = read("src/content.css");
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

check(/customFollowGroupModalNameHtml\(channel, "cheese-cf-group-modal-channel-name"\)/.test(fnSrc("renderCustomFollowGroupModalChannels")),
  "채널 목록은 이름 + 마크 함수를 쓴다");
check(/customFollowGroupModalNameHtml\(item, "cheese-cf-group-modal-picked-name"\)/.test(fnSrc("renderCustomFollowGroupModalPicked")),
  "고른 채널 목록도");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheese-cf-modal-mark-"));
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
    const r = await call("Runtime.evaluate", {
      expression: `(() => {
        ${read("src/verifiedMark.js")}
        ${fnSrc("escapeHtml")}
        ${fnSrc("customFollowGroupModalNameHtml")}
        const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
        const long = '아주아주긴채널이름이라서줄이넘치는채널이름입니다아주아주길다';
        document.body.innerHTML =
          '<div style="width:260px">' +
          '<label class="cheese-cf-group-modal-channel" id="row"><input type="checkbox"><span class="cheese-cf-group-modal-profile"></span>' +
          '<span class="cheese-cf-group-modal-channel-copy">' + customFollowGroupModalNameHtml({ name: long, verifiedMark: true }, 'cheese-cf-group-modal-channel-name') + '</span></label>' +
          '<label class="cheese-cf-group-modal-channel" id="plain"><input type="checkbox"><span class="cheese-cf-group-modal-profile"></span>' +
          '<span class="cheese-cf-group-modal-channel-copy">' + customFollowGroupModalNameHtml({ name: '짧음<b>', verifiedMark: false }, 'cheese-cf-group-modal-channel-name') + '</span></label>' +
          '<ul><li class="cheese-cf-group-modal-picked-item" id="picked"><span></span><span>1</span><span class="cheese-cf-group-modal-profile"></span>' +
          customFollowGroupModalNameHtml({ name: long, verifiedMark: true }, 'cheese-cf-group-modal-picked-name') + '<button>x</button></li></ul></div>';
        const measure = (id) => {
          const row = document.getElementById(id);
          const mark = row.querySelector('.cheese-cf-official');
          const text = row.querySelector('.cheese-cf-group-modal-name-text');
          const copy = row.querySelector('.cheese-cf-group-modal-name').getBoundingClientRect();
          const m = mark && mark.getBoundingClientRect();
          return {
            mark: !!mark, kind: mark && mark.dataset.cheeseMark,
            bg: mark && getComputedStyle(mark).backgroundImage,
            w: m && m.width, inside: m ? m.right <= copy.right + 0.5 && m.left >= copy.left : null,
            ellipsis: text.scrollWidth > text.clientWidth && getComputedStyle(text).textOverflow === 'ellipsis',
            text: text.textContent,
          };
        };
        return { row: measure('row'), plain: measure('plain'), picked: measure('picked') };
      })()`,
      returnByValue: true,
    }, sessionId);
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    const v = r.result.value;
    for (const [key, label] of [["row", "채널 목록"], ["picked", "고른 채널 목록"]]) {
      const m = v[key];
      check(m.mark && m.kind === "partner" && /icon_official_mark/.test(m.bg) && m.w === 13,
        `${label}: 파트너 채널 이름 뒤에 13px 인증 마크 ${JSON.stringify(m)}`);
      check(m.inside && m.ellipsis, `${label}: 이름이 길어도 이름만 말줄임, 마크는 줄 안에 남는다`);
    }
    check(!v.plain.mark && v.plain.text === "짧음<b>", "마크 없는 채널은 이름만(이름은 이스케이프)");
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
