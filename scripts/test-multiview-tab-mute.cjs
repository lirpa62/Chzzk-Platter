// 멀티뷰 시청 화면: 볼륨 패널의 '탭 음소거'.
//
// 브라우저가 이 탭의 소리 출력을 통째로 끈다. '전체 음소거' 와 달리 칸별 음소거·음량을 건드리지 않아
// 풀면 그대로 돌아오고, 광고·칸 재로드 중 소리도 새지 않는다.
//   - 볼륨 패널 맨 위 '탭 음소거' 체크 → 배경(tab.mute set)이 그 멀티뷰 탭만 음소거
//   - 켜져 있으면 헤더 볼륨 버튼 값이 '탭 음소거'(다른 상태보다 먼저 — 탭에 남아 새로고침해도 유지된다)
//   - 브라우저 탭 스피커 아이콘·칸 플레이어 '탭 음소거' 버튼으로 바뀌어도 배경이 알려 패널·헤더가 따라간다
//   - 칸별 음소거 상태(postAllAudio)는 보내지 않는다
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const watch = read("src/multiviewWatch.js");
const background = read("src/background.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const between = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `구간을 찾지 못했다: ${from.slice(0, 40)}`);
  return source.slice(start, end);
};
const sliceFn = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

// ── 시청 화면 ──────────────────────────────────────────────────────────────
check(/`<input type="checkbox" id="mvVolTabMute"\$\{tabMuted \? " checked" : ""\}>` \+\s*`<span>탭 음소거<\/span><\/label>` \+\s*`<p class="mv-vol-focus-note">브라우저 탭 소리를 통째로 끕니다\. 칸 설정은 그대로입니다\.<\/p>` \+\s*`<div class="mv-vol-row is-master">`/.test(watch),
  "볼륨 패널 맨 위(전체 볼륨 앞)에 '탭 음소거' 체크와 설명");
const changeBlock = between(watch, 'if (event.target?.id === "mvVolTabMute") {', "\n    }\n");
check(/void setTabMuted\(event\.target\.checked === true\);\s*return;/.test(changeBlock) && !/postAllAudio/.test(changeBlock),
  "체크를 바꾸면 탭 음소거만 바꾸고 칸별 소리 지시는 보내지 않는다");
check(/getTabMuted: \(\) => hostApi\("tab\.mute", \{ action: "query" \}\)/.test(watch) &&
  /setTabMuted: \(muted\) => hostApi\("tab\.mute", \{ action: "set", muted \}\)/.test(watch) &&
  /message\?\.type === "MULTIVIEW_HOST_TAB_MUTED"\) listener\(message\.muted === true\)/.test(watch),
  "치지직 위 시청 화면은 배경에 탭 음소거를 묻고·바꾸고·변화를 받는다");
check(/try \{\s*EXT\.onTabMutedChanged\(applyTabMuted\);\s*Promise\.resolve\(EXT\.getTabMuted\(\)\)\.then\(applyTabMuted\)/.test(watch) &&
  watch.indexOf("let tabMuted = false;") < watch.indexOf("function volumeButtonState("),
  "열 때 지금 상태를 읽고 바뀌면 따라간다(상태 변수는 첫 렌더보다 앞에 선언)");
{
  const ctx = vm.createContext({});
  vm.runInContext(`
    let tabMuted = false;
    const state = { masterMuted: false, audioFocusMode: false, mainId: "a", masterVolume: 0.8, chosen: [{ channelId: "a" }, { channelId: "b" }] };
    const audio = { a: { muted: false }, b: { muted: true } };
    const audioOf = (id) => audio[id];
    const effectiveMuted = (id) => audio[id].muted;
    const pct = (v) => Math.round(v * 100) + "%";
    ${sliceFn(watch, "volumeButtonState")}
    this.run = (opts) => { tabMuted = !!opts.tab; state.masterMuted = !!opts.master; return volumeButtonState(); };
  `, ctx);
  const tab = ctx.run({ tab: true, master: true });
  check(tab.value === "탭 음소거" && tab.muted === true, `탭 음소거가 켜져 있으면 헤더 값은 '탭 음소거'(전체 음소거보다 먼저) ${JSON.stringify(tab)}`);
  const off = ctx.run({ tab: false });
  check(off.value === "일부 음소거", `끄면 예전 표시 그대로 ${JSON.stringify(off)}`);
}

// ── 배경 ──────────────────────────────────────────────────────────────────
const bgSource = between(background, "// ── 멀티뷰(치지직 페이지 위)", "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {");
(async () => {
  const calls = [];
  const listeners = { updated: [] };
  const session = { cheeseMultiviewHostTabs: { 77: { setupId: "s", theme: "dark", windowId: 1, children: [] } } };
  let muted = false;
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://ext/${p}` },
    extension: { isAllowedIncognitoAccess: async () => true },
    storage: { session: {
      setAccessLevel: () => {},
      get: async (key) => ({ [key]: session[key] }),
      set: async (values) => Object.assign(session, values),
      remove: async () => {},
    } },
    windows: { onRemoved: { addListener: () => {} }, getAll: async () => [] },
    tabs: {
      get: async (id) => ({ id, url: "https://chzzk.naver.com/lives", mutedInfo: { muted } }),
      update: async (id, options) => { calls.push(["tabs.update", id, options]); muted = options.muted; return { id, mutedInfo: { muted } }; },
      sendMessage: async (id, message) => { calls.push(["tabs.sendMessage", id, message]); },
      onUpdated: { addListener: (fn) => listeners.updated.push(fn) },
      onRemoved: { addListener: () => {} },
    },
    scripting: { executeScript: async () => [{ result: true }] },
  };
  const ctx = { chrome, fetch: async () => ({ text: async () => "" }), Number, Array, Object, String, JSON, Error, URL };
  vm.createContext(ctx);
  vm.runInContext(bgSource + "\nthis.out={handleMultiviewHostApi};", ctx);
  const api = (op, args, tabId = 77) => ctx.out.handleMultiviewHostApi({ op, args }, { tab: { id: tabId } });
  check((await api("tab.mute", { action: "query" })).muted === false, "배경: 멀티뷰 탭의 지금 탭 음소거 상태를 알려 준다");
  const set = await api("tab.mute", { action: "set", muted: true });
  check(set.muted === true && calls.some(([n, id, o]) => n === "tabs.update" && id === 77 && o.muted === true),
    "배경: 그 멀티뷰 탭 자신만 음소거한다");
  await assert.rejects(api("tab.mute", { action: "set", muted: true }, 5), /not-multiview-host/);
  checks.push("배경: 멀티뷰 탭이 아니면 거절한다");
  for (const fn of listeners.updated) fn(77, { mutedInfo: { muted: false } });
  for (const fn of listeners.updated) fn(99, { mutedInfo: { muted: true } });
  await new Promise((r) => setTimeout(r, 10));
  const relayed = calls.filter(([n]) => n === "tabs.sendMessage");
  check(relayed.length === 1 && relayed[0][1] === 77 && relayed[0][2].type === "MULTIVIEW_HOST_TAB_MUTED" && relayed[0][2].muted === false,
    `배경: 멀티뷰 탭의 음소거가 바뀌면(브라우저 아이콘·칸 버튼 포함) 그 탭에만 알린다 ${JSON.stringify(relayed)}`);

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
