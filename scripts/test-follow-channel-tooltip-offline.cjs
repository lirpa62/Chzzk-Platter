// 사이드바 팔로잉·전용 팔로잉 목록의 오프라인 채널 '채널 호버 정보 툴팁'.
//
// 전용 목록은 라이브 미리보기가 켜져 있으면 오프라인 채널까지 툴팁을 생략해 아무것도 뜨지
// 않았다(오프라인은 미리보기가 없다). 일반 사이드바 팔로잉 목록은 대상이 아니었다.
// 이제 두 목록 모두 오프라인 채널에 정보 툴팁을 띄우고, 라이브 채널은 지금처럼 미리보기가
// 켜져 있으면 미리보기에 맡긴다. 오프라인 항목은 채널 홈(/<채널ID>) 링크에서 id 를 읽는다.
// 함께: 펼친 사이드바의 전용 목록 프로필 사진이 호버 때 밀리지 않게 링 가운데에 둔다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/content.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const D = "d".repeat(32);
const FIXTURE = `
<aside id="sidebar">
  <nav class="_section_x" aria-label="팔로우">
    <ul>
      <li id="live"><a href="/live/${A}"><div class="_profile_x _is_live_x"></div><span class="blind">LIVE</span></a></li>
      <li id="offline"><a href="/${B}"><div class="_profile_x"></div><span class="blind">오프라인</span><span id="offline-name">채널B</span></a></li>
      <li id="holder"><div id="cheese-custom-follow">
        <span id="cf-header">전용 팔로잉</span>
        <div class="cheese-cf-item" data-channel-id="${C}" data-live="0" id="cf-off"><span id="cf-off-name">C</span></div>
        <div class="cheese-cf-item" data-channel-id="${D}" data-live="1" id="cf-live"></div>
      </div></li>
    </ul>
  </nav>
  <nav class="_section_y" aria-label="추천"><ul><li id="other"><a href="/${B}"><div class="_profile_x"></div></a></li></ul></nav>
</aside>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-fct-"));
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
    const result = await ev(`(() => {
      document.body.innerHTML = ${JSON.stringify(FIXTURE)};
      let followPreviewOn = true;
      let followPreviewHideHeader = false;
      const customFollowGroupSortKey = "";
      const isFollowingChannelPage = () => false;
      const getChannelHomeId = () => "";
      ${["isCustomFollowSortingTarget", "getSidebarNavLabel", "isOfflineFollowItem", "getFollowItemChannelId",
        "isLiveFollowItem", "getFollowTooltipChannelIdFromAnchor", "findFollowingChannelTooltipAnchor",
        "findChannelHomeTooltipAnchor", "followChannelAnchorFromTarget"].map(sliceFn).join("\n")}
      const pick = (id) => {
        const found = followChannelAnchorFromTarget(document.getElementById(id));
        return found ? found.anchor.id + ':' + found.channelId.slice(0, 1) + ':' + found.cfLive : null;
      };
      const out = { on: {}, off: {} };
      for (const id of ['cf-off-name', 'cf-live', 'cf-header', 'offline-name', 'live', 'other']) out.on[id] = pick(id);
      followPreviewOn = false;
      for (const id of ['cf-off-name', 'cf-live', 'offline-name', 'live']) out.off[id] = pick(id);
      return out;
    })()`);
    check(result.on["cf-off-name"] === "cf-off:c:false" && result.off["cf-off-name"] === "cf-off:c:false",
      "전용 목록 오프라인 채널: 라이브 미리보기가 켜져 있어도 정보 툴팁");
    check(result.on["cf-live"] === null && result.off["cf-live"] === "cf-live:d:true",
      "전용 목록 라이브 채널: 미리보기가 켜져 있으면 미리보기에 맡기고, 꺼져 있으면 라이브 툴팁");
    check(result.on["cf-header"] === null, "전용 목록의 항목이 아닌 곳(제목 등)은 대상이 아니다");
    check(result.on["offline-name"] === "offline:b:false" && result.off["offline-name"] === "offline:b:false",
      "사이드바 팔로잉 오프라인 채널: 채널 홈 링크에서 id 를 읽어 정보 툴팁");
    check(result.on.live === null && result.off.live === null && result.on.other === null,
      "사이드바 팔로잉 라이브 채널·다른 섹션(추천 등)은 대상이 아니다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  const position = sliceFn("positionFollowChannelTooltip");
  check(/const nativeTip = sidebar && !anchor\.classList\?\.contains\("cheese-cf-item"\)[\s\S]{0,300}top = nativeRect\.bottom \+ 6;/.test(position),
    "접힌 사이드바에서 치지직 이름 툴팁이 떠 있으면 그 아래에 붙인다");
  check(/#sidebar\[class\*="_is_expanded_"\]\s*#cheese-custom-follow\s*\.cheese-cf-avatar:not\(\.cheese-cf-profile\)\s*> img \{[^}]*position: absolute !important;[^}]*top: 3px !important;[^}]*left: 3px !important;[^}]*width: calc\(100% - 6px\) !important;/.test(css),
    "펼친 사이드바의 전용 목록 프로필 사진은 링 가운데에 둔다(호버 때 테두리가 바뀌어도 밀리지 않음)");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
