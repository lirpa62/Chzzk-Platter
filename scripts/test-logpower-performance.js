#!/usr/bin/env node
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const content = readFileSync(resolve(__dirname, "../src/content.js"), "utf8");
const background = readFileSync(resolve(__dirname, "../src/background.js"), "utf8");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const part = (start, end) => section(content, start, end);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const reward = (id = "hour") => ({
  claimId: id, state: "COMPLIED", saveType: "ACTIVE", amount: 120,
  claimType: "WATCH_1_HOUR",
});
const cappedMap = part("  function mapSetCapped(", "  function sendMessage(");

function claimHarness() {
  let channel = "A", live = true, radio = false;
  let getCount = 0;
  const puts = [], logs = [], timers = [], toasts = [];
  const context = vm.createContext({
    featureFlags: { chatLogPowerAuto: true, chatLogPower: false, chatLogPowerToast: false },
    getLogPowerChannelId: () => channel,
    getCurrentLiveChannelId: () => live ? channel : "",
    isRadioModeActive: () => radio,
    fetchLogPowerClaims: async () => { getCount++; return [reward()]; },
    putLogPowerClaim: async (id, claim) => { puts.push([id, claim]); return { ok: true, status: 200 }; },
    resolveChannelMeta: async (id) => ({ channelName: id }),
    resolveChannelName: async (id) => id,
    fetchLogPowerUnits: async () => ({ hour: 100 }),
    appendLogPowerLog: (log) => logs.push(log),
    startWatchHourTimer: (id) => timers.push(id),
    fetchLogPowerBalance: async () => 1000,
    showLogPowerToast: (...args) => toasts.push(args),
    refreshLogPowerBadge: () => {},
    LOGPOWER_OTHER_CLAIM_TYPES: new Set(["FOLLOW"]),
    window: { clearInterval() {} },
  });
  vm.runInContext(cappedMap + part("  const LOGPOWER_CLAIM_POLL_MS", "  async function fetchLogPowerClaims(") +
    part("  function canClaimLogPower(", "  // 토글/페이지 전환에 따라 자동 획득 폴링") +
    part("  function stopLogPowerClaimTimer()", "  // ══ 통나무파워 적립 추적"), context);
  return { context, puts, logs, timers, toasts, getCount: () => getCount,
    run: () => context.claimLogPowerForCurrentChannel(),
    channel: (id) => { channel = id; }, live: (value) => { live = value; },
    radio: (value) => { radio = value; },
    read: (expression) => vm.runInContext(expression, context),
  };
}

test("100 concurrent triggers share a claim run and record the reward once", async () => {
  const h = claimHarness();
  const gate = deferred();
  let reads = 0;
  h.context.fetchLogPowerClaims = () => { reads++; return gate.promise; };
  const first = h.run();
  for (let i = 0; i < 100; i++) assert.equal(h.run(), first);
  gate.resolve([reward(), reward()]);
  await first;
  assert.equal(reads, 1);
  assert.equal(h.puts.length, 1);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].boost, 1.2);
  assert.equal(h.logs[0].fiveMinAmount, 0);
  assert.equal(h.read("logPowerClaimRequests.size"), 0);
  await h.run();
  assert.equal(h.puts.length, 1);
});

for (const change of ["off", "radio", "channel", "stop-and-reenable"]) {
  test(`pending claims cannot start PUT after ${change}`, async () => {
    const h = claimHarness();
    const gate = deferred();
    h.context.fetchLogPowerClaims = () => gate.promise;
    const request = h.run();
    if (change === "off") h.context.featureFlags.chatLogPowerAuto = false;
    if (change === "radio") h.radio(true);
    if (change === "channel") h.channel("B");
    if (change === "stop-and-reenable") h.context.stopLogPowerClaimTimer();
    gate.resolve([reward()]);
    await request;
    assert.equal(h.puts.length, 0);
    assert.equal(h.logs.length, 0);
    assert.equal(h.read("logPowerClaimRequests.size"), 0);
  });
}

test("navigation during PUT keeps the successful log but stops further claims and old timer", async () => {
  const h = claimHarness();
  const gate = deferred();
  let writes = 0;
  h.context.fetchLogPowerClaims = async () => [reward(), reward("next")];
  h.context.putLogPowerClaim = () => { writes++; return gate.promise; };
  const request = h.run();
  await drain();
  assert.equal(writes, 1);
  h.channel("B");
  gate.resolve({ ok: true, status: 200 });
  await request;
  assert.equal(writes, 1);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].channelId, "A");
  assert.equal(h.timers.length, 0);
});

test("hidden tabs and channel-home FOLLOW rewards remain eligible, disabled and radio live do not", async () => {
  const h = claimHarness();
  h.context.document = { hidden: true };
  await h.run();
  assert.equal(h.puts.length, 1);
  h.channel("B"); h.live(false); h.radio(true);
  h.context.fetchLogPowerClaims = async () => [{ ...reward("follow"), claimType: "FOLLOW", amount: 100 }];
  await h.run();
  assert.equal(h.logs[1].claimType, "FOLLOW");
  h.channel("C"); h.live(true);
  await h.run();
  h.radio(false); h.context.featureFlags.chatLogPowerAuto = false;
  await h.run();
  assert.equal(h.puts.length, 2);
});

test("transient failures retry next poll, permanent failures stay seen", async () => {
  for (const status of [0, 408, 429, 500, 403, 404]) {
    const h = claimHarness();
    let writes = 0;
    h.context.putLogPowerClaim = async () => { writes++; return { ok: false, status }; };
    await h.run(); await h.run();
    assert.equal(writes, [403, 404].includes(status) ? 1 : 2, String(status));
    assert.equal(h.logs.length, 0);
  }
});

test("claim locks are released even when an unexpected task error occurs", async () => {
  const h = claimHarness();
  h.context.fetchLogPowerClaims = async () => { throw Error("fixture"); };
  await h.run();
  assert.equal(h.read("logPowerClaimRequests.size"), 0);
  h.context.fetchLogPowerClaims = async () => [reward()];
  await h.run();
  assert.equal(h.logs.length, 1);
});

test("seen claim memory is bounded per channel and across channel navigation", async () => {
  const h = claimHarness();
  h.context.fetchLogPowerClaims = async () => Array.from({ length: 300 }, (_, i) => reward(String(i)));
  await h.run();
  assert.equal(h.read("logPowerSeenClaims.get('A').size"), 256);
  h.context.fetchLogPowerClaims = async () => [];
  for (let i = 0; i < 130; i++) { h.channel(String(i)); await h.run(); }
  assert.equal(h.read("logPowerSeenClaims.size"), 100);
});

test("reward-unit cache is bounded without changing parsed unit amounts", async () => {
  const context = vm.createContext({
    LOGPOWER_CLAIM_BASE: "https://fixture.invalid", LOGPOWER_CACHE_CHANNEL_LIMIT: 100,
    fetchLogPowerResponse: async () => ({ content: { claimList: [
      { claimType: "WATCH_1_HOUR", amount: 100 },
      { claimType: "WATCH_5_MIN", amount: 10 },
    ] } }),
  });
  vm.runInContext(cappedMap + part("  const logPowerUnitCache", "  // 적격 claim PUT"), context);
  for (let i = 0; i < 150; i++) assert.equal((await context.fetchLogPowerUnits(String(i))).hour, 100);
  assert.equal(vm.runInContext("logPowerUnitCache.size", context), 100);
});

test("balance and eligibility GET share only the in-flight response, then refetch fresh data", async () => {
  const gate = deferred();
  let reads = 0;
  const context = vm.createContext({
    LOGPOWER_CHANNEL_BASE: "https://fixture.invalid",
    fetchLogPowerResponse: () => { reads++; return gate.promise; },
  });
  vm.runInContext("const logPowerContentRequests = new Map();" +
    part("  function fetchChannelLogPowerContent(", "  // 채널이 라이브 중인지") +
    part("  async function fetchLogPowerClaims(", "  // 채널별 보상 단가"), context);
  const first = context.fetchChannelLogPowerContent("A");
  const claims = context.fetchLogPowerClaims("A");
  gate.resolve({ content: { amount: 123, claims: [reward()] } });
  assert.equal((await first).amount, 123);
  assert.equal((await claims).length, 1);
  assert.equal(reads, 1);
  assert.equal(vm.runInContext("logPowerContentRequests.size", context), 0);
  await context.fetchChannelLogPowerContent("A");
  assert.equal(reads, 2);
});

for (const mode of ["content", "background"]) {
  test(`${mode}: request deadline includes stalled JSON body and cleans the timer`, async () => {
    let expire, cleared = 0;
    const context = vm.createContext({ AbortController,
      setTimeout: (callback, ms) => { assert.equal(ms, 15000); expire = callback; return 1; },
      clearTimeout: () => cleared++,
      fetch: async (url, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
      }) }),
    });
    vm.runInContext(mode === "content"
      ? part("  async function fetchLogPowerResponse(", "  // 배지와 자동 획득")
      : section(background, "async function lpFetchJson(", "function lpWatchStateKey("), context);
    const request = mode === "content" ? context.fetchLogPowerResponse("fixture") : context.lpFetchJson("fixture");
    await drain();
    expire();
    await assert.rejects(request, /aborted/);
    assert.equal(cleared, 1);
  });
}

test("PUT wrapper preserves success/status without reading its response body", async () => {
  let cleared = 0, method;
  const context = vm.createContext({ AbortController,
    setTimeout: () => 1, clearTimeout: () => cleared++, LOGPOWER_CLAIM_BASE: "https://fixture.invalid",
    logPowerContentRequests: new Map([["A", "old GET"]]),
    fetch: async (url, options) => { method = options.method; return { ok: true, status: 204, json: () => assert.fail("body read") }; },
  });
  vm.runInContext(part("  async function fetchLogPowerResponse(", "  // 배지와 자동 획득") +
    part("  async function putLogPowerClaim(", "  // 1시간 시청 보상(통나무 파워 배달)"), context);
  const result = await context.putLogPowerClaim("A", "id");
  assert.equal(result.status, 204);
  assert.equal(result.ok, true);
  assert.equal(method, "PUT");
  assert.equal(cleared, 1);
  assert.equal(context.logPowerContentRequests.has("A"), false);
});

test("post-claim GET stays registered when an invalidated older GET completes", async () => {
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const context = vm.createContext({ LOGPOWER_CHANNEL_BASE: "https://fixture.invalid",
    fetchLogPowerResponse: () => ++calls === 1 ? old.promise : fresh.promise,
  });
  vm.runInContext("const logPowerContentRequests = new Map();" +
    part("  function fetchChannelLogPowerContent(", "  // 채널이 라이브 중인지"), context);
  const first = context.fetchChannelLogPowerContent("A");
  vm.runInContext("logPowerContentRequests.delete('A')", context);
  const second = context.fetchChannelLogPowerContent("A");
  old.resolve({ content: { amount: 100 } }); await first;
  assert.equal(context.fetchChannelLogPowerContent("A"), second);
  fresh.resolve({ content: { amount: 220 } });
  assert.equal((await second).amount, 220);
  assert.equal(calls, 2);
  assert.equal(vm.runInContext("logPowerContentRequests.size", context), 0);
});

test("background alarms share a pending channel inspection and release it on error", async () => {
  let calls = 0;
  let gate = deferred();
  const context = vm.createContext({ lpCollectProgress: () => { calls++; return gate.promise; } });
  vm.runInContext(section(background, "const lpProgressRequests", "async function lpCollectProgress("), context);
  const first = context.lpCheckProgress("A");
  for (let i = 0; i < 100; i++) assert.equal(context.lpCheckProgress("A"), first);
  assert.equal(calls, 1);
  gate.reject(Error("fixture")); await first;
  assert.equal(vm.runInContext("lpProgressRequests.size", context), 0);
  gate = deferred();
  const next = context.lpCheckProgress("A");
  assert.equal(calls, 2);
  gate.resolve(); await next;
});

test("detached input observers release their DOM reference before replacement exists", () => {
  let disconnects = 0, waits = 0, clears = 0;
  const context = vm.createContext({
    logPowerBadgeObserver: { disconnect: () => disconnects++ },
    logPowerObservedArea: { isConnected: false }, logPowerAreaWaitTimer: 0,
    featureFlags: { chatLogPowerAuto: true }, getCurrentLiveChannelId: () => "A",
    findLogPowerInputArea: () => null,
    window: { setInterval: () => ++waits }, clearInterval: () => clears++,
  });
  vm.runInContext(part("  function ensureLogPowerBadgeObserver()", "  // 토글/페이지 전환에 따라 표시"), context);
  context.ensureLogPowerBadgeObserver();
  assert.equal(disconnects, 1);
  assert.equal(context.logPowerObservedArea, null);
  for (let i = 0; i < 100; i++) context.ensureLogPowerBadgeObserver();
  assert.equal(waits, 1);
  context.getCurrentLiveChannelId = () => "";
  context.ensureLogPowerBadgeObserver();
  assert.equal(clears, 1);
  assert.equal(context.logPowerAreaWaitTimer, 0);
});

test("disabled badge does not reappear after an outstanding balance request", async () => {
  const gate = deferred();
  let renders = 0;
  const context = vm.createContext({
    featureFlags: { chatLogPower: true }, getCurrentLiveChannelId: () => "A",
    ensureLogPowerBadge: () => {}, removeLogPowerBadge: () => {},
    fetchLogPowerBalanceCached: () => gate.promise,
    renderLogPowerBadge: () => renders++, updateLogPowerIndicators: () => renders++,
  });
  vm.runInContext(part("  async function refreshLogPowerBadge()", "  // 채팅 입력 영역(후원 도구 줄"), context);
  const request = context.refreshLogPowerBadge();
  context.featureFlags.chatLogPower = false;
  gate.resolve(123); await request;
  assert.equal(renders, 0);
});

test("unchanged indicators do not rewrite hidden/class attributes on every timer tick", () => {
  let writes = 0;
  const elements = new Map();
  for (const name of ["progress", "tip-progress", "timer", "tip-timer"]) {
    let hidden = false;
    elements.set(`.cheese-logpower-${name}`, {
      get hidden() { return hidden; }, set hidden(value) { writes++; hidden = value; },
    });
  }
  let earning = false;
  const badge = { querySelector: (key) => elements.get(key), classList: {
    contains: () => earning, toggle: (key, value) => { writes++; earning = value; },
  } };
  const context = vm.createContext({
    document: { getElementById: () => badge }, LOGPOWER_BADGE_ID: "badge",
    getCurrentLiveChannelId: () => "A", logPowerHourChannelId: "A", logPowerHourEndsAt: Date.now() + 60000,
    logPowerWatchActiveUntil: 0, logPowerWatchActive: true, logPowerWatchActiveChannelId: "A",
    logPowerTimerMode: "badge", logPowerProgressMode: "badge", logPowerEarningColor: true,
  });
  vm.runInContext(part("  function updateLogPowerIndicators()", "  // ── 1시간 보상 획득 토스트"), context);
  context.updateLogPowerIndicators();
  const initial = writes;
  for (let i = 0; i < 1000; i++) context.updateLogPowerIndicators();
  assert.equal(writes, initial);
  context.logPowerWatchActive = false;
  context.updateLogPowerIndicators();
  assert.equal(earning, false);
});

test("hidden hour countdown skips DOM work but still expires at its absolute deadline", () => {
  let updates = 0, cleared = 0;
  const context = vm.createContext({
    document: { hidden: true, getElementById: () => ({ querySelector: () => assert.fail("hidden DOM work") }) },
    LOGPOWER_BADGE_ID: "badge", logPowerHourEndsAt: Date.now() + 60000,
    logPowerHourChannelId: "A", getCurrentLiveChannelId: () => "A",
    clearWatchHourTimer: () => cleared++, updateLogPowerIndicators: () => updates++,
    stopWatchHourTimer: () => {},
  });
  vm.runInContext(part("  function renderWatchHourTimer()", "  function stopWatchHourTimer("), context);
  context.renderWatchHourTimer();
  assert.equal(updates, 0);
  context.logPowerHourEndsAt = Date.now() - 1;
  context.renderWatchHourTimer();
  assert.equal(cleared, 1);
});
