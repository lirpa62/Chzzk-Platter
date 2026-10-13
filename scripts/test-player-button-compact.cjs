// 좁은 플레이어에서 '좁을 때 숨김'으로 고른 치즈 플래터 버튼만, 한 줄에 안 들어가는 만큼
// 오른쪽 끝부터 하나씩 숨긴다. 치지직 기본 버튼과 고르지 않은 버튼은 숨기지 않는다.
// 실제 브라우저에서 버튼 줄 폭을 바꿔 가며 잰다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const root = join(__dirname, "..");
const SRC = readFileSync(join(root, "src", "content.js"), "utf8");
const CSS = readFileSync(join(root, "src", "content.css"), "utf8");
const SETTINGS = readFileSync(join(root, "src", "settings.js"), "utf8");
const section = SRC.slice(
  SRC.indexOf("  // ── 좁은 플레이어에서 고른 버튼 숨기기"),
  SRC.indexOf("  // 차단 항목은 두 형태다(MAIN 월드와 같은 규칙)."),
);
if (!/function compactPlayerBar\(/.test(section)) throw Error("버튼 숨기기 구간을 찾지 못했다");

// 치지직 하단 버튼 줄 흉내: 왼쪽·오른쪽 묶음이 flex 로 양끝에 놓이고 버튼은 폭이 고정이다.
const btn = (cls, w = 40) => `<button class="${cls}" style="width:${w}px"></button>`;
const PAGE = `
<style>
  body { margin: 0; }
  .pzp-pc__bottom-buttons { display: flex; justify-content: space-between; width: 900px; padding: 0 10px; box-sizing: border-box; }
  .pzp-pc__bottom-buttons-left, .pzp-pc__bottom-buttons-right { display: flex; flex: none; }
</style>
<div class="pzp-pc__bottom-buttons">
  <div class="pzp-pc__bottom-buttons-left">
    ${btn("pzp-playback-switch")}${btn("pzp-pc__volume-control", 80)}
    <div class="cheese-audio-mixer-control" style="width:40px"></div>
    ${btn("live_time", 60)}
  </div>
  <div class="pzp-pc__bottom-buttons-right">
    ${btn("custom__shop-button")}${btn("cheese-live-rewind-button")}${btn("cheese-live-sync-button")}
    ${btn("cheese-live-forward-button")}${btn("cheese-tab-mute-button")}${btn("cheese-screenshot-button")}
    ${btn("cheese-stream-stats-button")}${btn("custom__clip-button")}${btn("pzp-pip-button")}
    ${btn("pzp-setting-button")}${btn("pzp-pc__fullscreen-button")}
  </div>
</div>`;
// 왼쪽 220(재생 40·볼륨 80·믹서 40·실시간 60) + 오른쪽 440(40 × 11) = 660 이 들어갈 자리: 버튼 줄 폭 - 좌우 여백 20.

const HARNESS = `${section}
  window.api = { compactPlayerControls, ensurePlayerCompactObservers, set keys(v) { playerCompactKeys = normalizePlayerCompactKeys(v); } };`;

const dir = mkdtempSync(join(tmpdir(), "cheese-compact-"));
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  let failed = 0;
  const ok = (condition, label) => {
    console.log(`${condition ? "  PASS" : "  FAIL"} ${label}`);
    if (!condition) failed += 1;
  };
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); true`);
    await ev(`(() => {
      const st = document.createElement("style"); st.textContent = ${JSON.stringify(CSS)}; document.head.append(st);
      const s = document.createElement("script"); s.textContent = ${JSON.stringify(HARNESS)}; document.head.append(s);
      return true; })()`);
    const run = (width, keys) => ev(`(() => {
      ${keys ? `api.keys = ${JSON.stringify(keys)};` : ""}
      document.querySelector(".pzp-pc__bottom-buttons").style.width = "${width}px";
      api.compactPlayerControls();
      return [...document.querySelectorAll(".cheese-player-compact-hidden")].map((el) => el.className.split(" ")[0]);
    })()`);
    const ALL = ["audioMixer", "rewind", "sync", "forward", "tabMute", "screenshot", "streamStats"];

    ok((await run(900, ALL)).length === 0, "자리가 넉넉하면 아무것도 숨기지 않는다");
    ok((await run(680, ALL)).length === 0, "딱 맞으면(660 + 여백 20) 숨기지 않는다");
    let hidden = await run(660, ALL);
    ok(JSON.stringify(hidden) === JSON.stringify(["cheese-stream-stats-button"]),
      `20px 모자라면 오른쪽 끝 하나만(${hidden})`);
    hidden = await run(590, ALL);
    ok(hidden.length === 3 && hidden.includes("cheese-stream-stats-button") && hidden.includes("cheese-screenshot-button") && hidden.includes("cheese-tab-mute-button"),
      `90px 모자라면 오른쪽 끝부터 셋(${hidden})`);
    hidden = await run(590, ["rewind", "streamStats"]);
    ok(hidden.length === 2 && hidden.includes("cheese-live-rewind-button"),
      `고른 버튼만 숨긴다 — 모자라도 고르지 않은 버튼은 남긴다(${hidden})`);
    hidden = await run(420, ALL); // 260 모자람: 오른쪽 여섯(240)으로 모자라 믹서까지
    ok(hidden.includes("cheese-audio-mixer-control") && !hidden.some((c) => /^(pzp|custom__|live_time)/.test(c)),
      `왼쪽 믹서는 오른쪽 버튼을 다 숨긴 뒤에야, 치지직 버튼은 끝까지 숨기지 않는다(${hidden})`);
    ok((await run(900, ALL)).length === 0, "다시 넓어지면 모두 돌아온다");
    ok((await run(500, [])).length === 0, "고른 버튼이 없으면 숨기지 않는다(남은 숨김도 걷는다)");

    // 실제 감시: 버튼 줄 폭이 바뀌면 다음 프레임에 다시 맞춘다.
    await ev(`api.keys = ${JSON.stringify(ALL)}; api.ensurePlayerCompactObservers(); true`);
    await ev(`document.querySelector(".pzp-pc__bottom-buttons").style.width = "660px"; true`);
    await sleep(100);
    ok(await ev(`document.querySelectorAll(".cheese-player-compact-hidden").length`) === 1, "폭이 줄면 저절로 숨긴다(ResizeObserver)");
    await ev(`document.querySelector(".pzp-pc__bottom-buttons-right").insertAdjacentHTML("afterbegin", '<button class="custom__extra" style="width:40px"></button>'); true`);
    await sleep(100);
    ok(await ev(`document.querySelectorAll(".cheese-player-compact-hidden").length`) === 2, "버튼이 늘어나면 하나 더 숨긴다(MutationObserver)");
    await ev(`document.querySelector(".pzp-pc__bottom-buttons").style.width = "1200px"; true`);
    await sleep(100);
    ok(await ev(`document.querySelectorAll(".cheese-player-compact-hidden").length`) === 0, "넓어지면 저절로 돌아온다");

    // 기본값: 저장값이 없으면 오른쪽 그룹에 놓인 내 버튼만 숨김 대상(왼쪽으로 옮긴 버튼·믹서·필터 제외).
    {
      const vm = require("node:vm");
      const ctx = {
        PLAYER_BUTTON_KEYS: ["rewind", "sync", "forward", "speed", "commentTs", "chatRecap", "tabMute", "screenshot", "streamStats"],
        playerButtonSide: { side: { rewind: "left", sync: "right" } },
      };
      vm.runInNewContext(`${section}\nglobalThis.api = {
        load(v) { playerCompactSaved = normalizePlayerCompactKeys(v); refreshPlayerCompactKeys(); return playerCompactKeys; } };`,
        Object.assign(ctx, { globalThis: ctx }));
      const def = ctx.api.load(undefined);
      ok(!def.includes("rewind") && def.includes("sync") && def.includes("streamStats") && !def.includes("audioMixer") && def.length === 8,
        `저장값이 없으면 오른쪽 그룹의 내 버튼이 기본 숨김 대상(${def})`);
      ok(JSON.stringify(ctx.api.load(["audioMixer"])) === JSON.stringify(["audioMixer"]) && ctx.api.load([]).length === 0,
        "한 번 고르면(빈 목록 포함) 저장된 목록만 쓴다");
    }

    // 설정 화면: 치즈 플래터 칩(이동 칩·믹서·필터)에만 '좁을 때 숨김' 토글이 있다.
    ok(/compactToggle\(key, PLAYER_BTN_LABELS\[key\]\)/.test(SETTINGS) &&
      /"cheese-audio-mixer-control": "audioMixer",\s*"cheese-video-filter-control": "videoFilter",/.test(SETTINGS),
      "설정: 내 버튼 칩과 믹서·필터 칩에 토글을 붙인다(치지직 칩에는 없음)");
    ok(/aria-pressed="\$\{!compact\}"/.test(SETTINGS) &&
      /\$\{compact \? PLAYER_COMPACT_ICON_HIDDEN : PLAYER_COMPACT_ICON_SHOWN\}/.test(SETTINGS),
      "설정: 눈 아이콘은 켜짐 = 좁아도 표시, 끄면 눈 가림 아이콘으로 '좁을 때 숨김'");
    ok(/compactIsDefault = !Array\.isArray\(saved\);/.test(SETTINGS) &&
      /PLAYER_BTN_KEYS\.filter\(\(k\) => slot\[k\]\?\.grp !== "left"\)/.test(SETTINGS) &&
      /compactIsDefault = false;/.test(SETTINGS),
      "설정: 저장값이 없으면 오른쪽 그룹 칩의 눈이 꺼져 있고, 한 번 누르면 목록을 저장한다");
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
