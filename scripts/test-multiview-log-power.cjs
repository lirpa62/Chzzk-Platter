// 멀티뷰 시청 화면 헤더의 '적립 중인 통나무파워'.
//
// 라이브 칸의 content.js 가 그 채널의 적립 상태(적립 중·적립 만료·보유량·1시간 타이머 종료
// 시각)를 FRAME_LOG_POWER 로 보내고, 시청 화면은 적립 중인 채널 하나만 헤더에 보인다.
// 적립 중인 채널이 없으면 숨긴다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const content = read("src/content.js");
const watch = read("src/multiviewWatch.js");
const html = read("multiviewWatch.html");
const css = read("src/multiview.css");
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

// ── 칸(content.js): 상태가 바뀔 때만 시청 화면에 보낸다 ─────────────────────
{
  const sent = [];
  const ctx = {
    IS_MULTIVIEW_FRAME: true,
    multiviewLiveChannelId: "a".repeat(32),
    MULTIVIEW_MESSAGE: "cheese-platter-multiview",
    MULTIVIEW_CHANNEL_ID: "a".repeat(32),
    MULTIVIEW_TOKEN: "tok",
    MULTIVIEW_PARENT_ORIGIN: "https://chzzk.naver.com",
    featureFlags: { chatLogPower: true },
    logPowerRadioPaused: false,
    logPowerWatchActive: true,
    logPowerWatchActiveChannelId: "a".repeat(32),
    logPowerWatchActiveUntil: Date.now() + 60000,
    logPowerHourChannelId: "",
    logPowerHourEndsAt: 0,
    logPowerCachedAmount: 12345,
    logPowerCacheHref: "https://chzzk.naver.com/live/" + "a".repeat(32),
    location: { href: "https://chzzk.naver.com/live/" + "a".repeat(32) },
    getCurrentLiveChannelId: () => "a".repeat(32),
  };
  ctx.window = { parent: { postMessage: (message, origin) => sent.push({ message, origin }) } };
  vm.runInNewContext(
    `${between(content, "  let multiviewLogPowerSent", "  function updateLogPowerIndicators()")}
     this.report = reportMultiviewLogPower;`,
    vm.createContext(ctx),
  );
  // 칸 상태는 content.js 의 let 변수라, 테스트에서는 같은 이름의 전역을 바꾼다.
  ctx.report();
  check(sent.length === 1 && sent[0].origin === "https://chzzk.naver.com" &&
    sent[0].message.type === "FRAME_LOG_POWER" && sent[0].message.token === "tok" &&
    sent[0].message.logPower.active === true && sent[0].message.logPower.amount === 12345,
    "칸: 적립 중·보유량을 멀티뷰 화면 출처로만 보낸다");
  ctx.report();
  check(sent.length === 1, "칸: 같은 상태는 다시 보내지 않는다(1시간 타이머가 매초 부른다)");
  ctx.logPowerHourChannelId = "a".repeat(32);
  ctx.logPowerHourEndsAt = Date.now() + 30 * 60000;
  ctx.report();
  check(sent.length === 2 && sent[1].message.logPower.hourEndsAt === ctx.logPowerHourEndsAt,
    "칸: 1시간 타이머가 시작되면 종료 시각을 보낸다");
  ctx.logPowerRadioPaused = true;
  ctx.report();
  check(sent.length === 3 && sent[2].message.logPower.active === false && sent[2].message.logPower.hourEndsAt === 0,
    "칸: 라디오 모드면 적립이 아니라고 보낸다");
  ctx.logPowerRadioPaused = false;
  ctx.report();
  check(sent.length === 4 && sent[3].message.logPower.active === true, "칸: 라디오 모드를 풀면 다시 적립 중");
  ctx.featureFlags.chatLogPower = false;
  ctx.report();
  check(sent.length === 5 && sent[4].message.logPower.active === false && sent[4].message.logPower.amount === null,
    "칸: 통나무파워 표시를 끄면 적립이 아니라고 보낸다");
  ctx.IS_MULTIVIEW_FRAME = false;
  ctx.featureFlags.chatLogPower = true;
  ctx.report();
  check(sent.length === 5, "멀티뷰 칸이 아니면 보내지 않는다");
}
check(/function updateLogPowerIndicators\(\) \{\s*reportMultiviewLogPower\(\);\s*const badge/.test(content),
  "칸: 채팅이 접혀 배지가 없어도 상태를 보낸다(배지 확인보다 먼저)");
check(/removeLogPowerBadge\(\);\s*logPowerChannelId = "";\s*reportMultiviewLogPower\(\);\s*return;/.test(content),
  "칸: 표시를 끄면 그 상태도 알린다");

// ── 시청 화면: 적립 중인 채널 하나만 헤더에 ─────────────────────────────────
{
  const el = () => ({ hidden: true, textContent: "", dataset: {} });
  const nodes = { mvLogPower: el(), mvLogPowerName: el(), mvLogPowerAmount: el(), mvLogPowerState: el() };
  const A = "a".repeat(32);
  const B = "b".repeat(32);
  const V = "c".repeat(32);
  let now = 1_000_000;
  let interval = 0;
  const ctx = {
    $: (id) => nodes[id],
    cells: new Map([[A, {}], [B, {}], [V, {}]]),
    isVideoSlot: (id) => id === V,
    channelName: (id) => ({ [A]: "채널A", [B]: "채널B", [V]: "다시보기" })[id],
    Date: { now: () => now },
    setInterval: () => ++interval,
    clearInterval: () => {},
    // 설정 '헤더에 통나무파워 적립 표시'(기본 켬). 바꾸면 onChanged 로 반영한다.
    chrome: { storage: {
      local: { get: () => Promise.resolve({}) },
      onChanged: { addListener: (fn) => { ctx.storageChanged = fn; } },
    } },
  };
  vm.runInNewContext(
    `${between(watch, "  const logPowerByChannel = new Map();", "  // 프레임이 보내는 상태 신호.")}
     this.set = (id, raw) => { const v = normalizeLogPower(raw); if (v) logPowerByChannel.set(id, v); renderLogPower(); };
     this.clear = clearChannelLogPower;
     this.render = renderLogPower;
     this.ticking = () => logPowerTicker;`,
    vm.createContext(ctx),
  );
  ctx.set(A, { active: false, activeUntil: 0, amount: 500, hourEndsAt: 0 });
  check(nodes.mvLogPower.hidden === true, "적립 중인 채널이 없으면 숨긴다");
  ctx.set(A, { active: true, activeUntil: now + 6 * 60000, amount: 12345, hourEndsAt: 0 });
  check(nodes.mvLogPower.hidden === false && nodes.mvLogPowerName.textContent === "채널A" &&
    nodes.mvLogPowerAmount.textContent === "1.2만" && nodes.mvLogPowerState.textContent === "적립 중" &&
    nodes.mvLogPower.dataset.tooltip === "채널A 통나무파워 적립 중\n보유 12,345",
    "적립 중인 채널의 이름·보유량(채팅창 배지처럼 축약, 툴팁에 정확한 값)을 보인다");
  ctx.set(A, { active: true, activeUntil: now + 6 * 60000, amount: 12345, hourEndsAt: now + (42 * 60 + 10) * 1000 });
  check(nodes.mvLogPowerState.textContent === "42:10" && /다음 1시간 보상까지 42:10/.test(nodes.mvLogPower.dataset.tooltip),
    "1시간 보상 타이머가 돌면 '적립 중' 대신 남은 시간");
  now += 1000;
  ctx.render();
  check(nodes.mvLogPowerState.textContent === "42:09" && ctx.ticking() > 0, "남은 시간은 1초마다 줄어든다");
  ctx.set(B, { active: true, activeUntil: now + 6 * 60000 + 5000, amount: 800, hourEndsAt: 0 });
  check(nodes.mvLogPowerName.textContent === "채널B", "둘이 적립 중이면 가장 최근에 확인된(만료가 늦은) 채널");
  ctx.set(V, { active: true, activeUntil: now + 9 * 60000, amount: 1, hourEndsAt: 0 });
  check(nodes.mvLogPowerName.textContent === "채널B", "다시보기 칸은 보지 않는다");
  ctx.clear(B);
  check(nodes.mvLogPowerName.textContent === "채널A", "칸을 빼면 그 채널 상태를 버린다");
  now += 6 * 60000;
  ctx.render();
  check(nodes.mvLogPower.hidden === true, "적립 만료 시각이 지나면 스스로 숨긴다");
  check(ctx.set(A, { active: "yes" }) === undefined && nodes.mvLogPower.hidden === true,
    "형식이 맞지 않는 상태는 버린다");
  ctx.set(A, { active: true, activeUntil: now + 60000, amount: 10, hourEndsAt: 0 });
  check(nodes.mvLogPower.hidden === false, "(다시 적립 중)");
  ctx.storageChanged({ cheeseMultiviewLogPower: { newValue: false } }, "local");
  check(nodes.mvLogPower.hidden === true, "설정에서 '헤더에 통나무파워 적립 표시'를 끄면 숨긴다");
  ctx.storageChanged({ cheeseMultiviewLogPower: { newValue: true } }, "local");
  check(nodes.mvLogPower.hidden === false, "다시 켜면 보인다");
}

check(/"FRAME_LOG_POWER",\s*\]\);/.test(watch) &&
  /if \(data\.type === "FRAME_LOG_POWER"\) \{\s*if \(isVideoSlot\(channelId\)\) return;\s*const logPower = normalizeLogPower\(data\.logPower\);/.test(watch),
  "시청 화면: 검증을 거친 칸 메시지로만 받는다(다시보기 칸 제외)");
check(/clearChannelSync\(channelId, true\);\s*clearChannelLogPower\(channelId\);/.test(watch),
  "시청 화면: 칸을 빼거나 바꾸면 상태를 지운다");
check(/id="mvLogPower"[\s\S]{0,200}hidden[\s\S]{0,200}<mask id="mvLogPowerMask"[\s\S]*?id="mvLogPowerName"[\s\S]*?id="mvLogPowerAmount"[\s\S]*?id="mvLogPowerState"[\s\S]*?<button type="button" class="mv-topbar-back" id="mvBack"/.test(html),
  "헤더: '채널 관리' 앞에 처음에는 숨긴 채로 둔다");
check(/\.mv-logpower \{[^}]*margin-left: auto;/.test(css) &&
  /\.mv-logpower:not\(\[hidden\]\) \+ \.mv-topbar-back \{\s*margin-left: 0;/.test(css),
  "헤더: 보이면 칩이 '채널 관리'와 함께 오른쪽에 붙는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
