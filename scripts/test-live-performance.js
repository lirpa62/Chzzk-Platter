#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Run the production functions without starting extension bridges or a live stream.
const content = readFileSync(resolve(__dirname, "../src/content.js"), "utf8");
const mixer = readFileSync(resolve(__dirname, "../src/audioMixer.js"), "utf8");
const filter = readFileSync(resolve(__dirname, "../src/videoFilter.js"), "utf8");
const chat = readFileSync(resolve(__dirname, "../src/chatTimestamp.js"), "utf8");
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

function clockContext(values) {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();
  const microtasks = [];
  const schedule = (fn, delay = 0) => {
    const id = ++nextId;
    tasks.set(id, { fn, at: now + delay });
    return id;
  };
  const context = vm.createContext({
    ...values,
    Date: { now: () => now },
    performance: { now: () => now },
    setTimeout: schedule,
    clearTimeout: (id) => tasks.delete(id),
    requestAnimationFrame: (fn) => schedule(fn, 16),
    cancelAnimationFrame: (id) => tasks.delete(id),
    queueMicrotask: (fn) => microtasks.push(fn),
  });
  context.window = context;
  const flushMicrotasks = () => {
    while (microtasks.length) microtasks.shift()();
  };
  return {
    context,
    tasks,
    advance(ms) {
      const end = now + ms;
      flushMicrotasks();
      let steps = 0;
      while (tasks.size) {
        const [id, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
        if (task.at > end) break;
        assert.ok(++steps < 10000, "Timer loop failed to settle");
        now = task.at;
        tasks.delete(id);
        task.fn();
        flushMicrotasks();
      }
      now = end;
    },
  };
}

class FakeElement {
  constructor(parent = null, isRow = false) {
    this.parentElement = parent;
    this.isRow = isRow;
    this.isConnected = true;
    this.children = [];
    this.scans = 0;
    parent?.children.push(this);
  }
  closest() {
    return this.isRow ? this : this.parentElement?.closest() || null;
  }
  contains(node) {
    return node === this || Boolean(node?.parentElement && this.contains(node.parentElement));
  }
  querySelectorAll() {
    this.scans += 1;
    return this.children.flatMap((child) => [
      ...(child.isRow ? [child] : []),
      ...child.querySelectorAll(),
    ]);
  }
}

function historyHarness() {
  const parent = new FakeElement();
  const captures = [];
  const clock = clockContext({
    Element: FakeElement,
    document: { hidden: false },
    chatHistoryContextInvalidated: false,
    chatHistoryOn: true,
    chatHistoryPendingCaptureRows: new Set(),
    chatHistoryFullCapturePending: false,
    chatHistoryNativeScrollActiveUntil: 0,
    chatHistoryCaptureDelayTimer: 0,
    chatHistoryCaptureFrame: 0,
    chatHistoryObservedRowParent: parent,
    captureChatHistoryRows: (rows) => captures.push(Array.from(rows)),
    captureRenderedChatHistoryRows: () => captures.push("full"),
  });
  vm.runInContext(section(content,
    "  function scheduleChatHistoryCaptureSnapshot(",
    "  function mergeChatHistorySequences("), clock.context);
  vm.runInContext(section(content,
    "  function collectChangedChatHistoryRows(",
    "  function ensureChatHistory("), clock.context);
  return { ...clock, parent, captures };
}

test("visible chat bursts drain once instead of rescheduling forever", () => {
  const h = historyHarness();
  const rows = Array.from({ length: 100 }, () => new FakeElement(h.parent, true));
  rows.forEach((row) => h.context.scheduleChatHistoryCaptureSnapshot(h.parent, new Set([row])));
  h.advance(1000);
  assert.equal(h.captures.length, 1);
  assert.deepEqual(h.captures[0], rows);
  assert.equal(h.context.chatHistoryPendingCaptureRows.size, 0);
  assert.equal(h.tasks.size, 0);
});

test("scroll deferral follows the latest deadline and eventually drains", () => {
  const h = historyHarness();
  const row = new FakeElement(h.parent, true);
  h.context.chatHistoryNativeScrollActiveUntil = 200;
  h.context.scheduleChatHistoryCaptureSnapshot(h.parent, new Set([row]));
  h.advance(100);
  h.context.chatHistoryNativeScrollActiveUntil = 400;
  h.advance(250);
  assert.equal(h.captures.length, 0);
  h.advance(100);
  assert.deepEqual(h.captures, [[row]]);
  assert.equal(h.tasks.size, 0);
});

test("hidden tabs drain pending frames through a microtask without duplicate capture", () => {
  const h = historyHarness();
  const row = new FakeElement(h.parent, true);
  h.context.scheduleChatHistoryCaptureSnapshot(h.parent, new Set([row]));
  h.advance(80);
  h.context.document.hidden = true;
  h.context.scheduleChatHistoryCaptureSnapshot(h.parent, new Set([row]));
  h.advance(0);
  assert.deepEqual(h.captures, [[row]]);
  h.advance(1000);
  assert.equal(h.captures.length, 1);
  assert.equal(h.tasks.size, 0);
});

test("queued capture rejects replaced lists and disabled features", () => {
  for (const change of [
    (ctx) => { ctx.chatHistoryObservedRowParent = new FakeElement(); },
    (ctx) => { ctx.chatHistoryOn = false; },
  ]) {
    const h = historyHarness();
    h.context.scheduleChatHistoryCaptureSnapshot(h.parent);
    change(h.context);
    h.advance(100);
    assert.equal(h.captures.length, 0);
    assert.equal(h.tasks.size, 0);
  }
});

test("full initial capture runs once; an empty incremental queue does not rescan", () => {
  const h = historyHarness();
  h.context.scheduleChatHistoryCaptureSnapshot(h.parent);
  h.advance(100);
  h.context.scheduleChatHistoryCaptureSnapshot(h.parent, new Set());
  h.advance(1000);
  assert.deepEqual(h.captures, ["full"]);
});

test("one appended chat among 500 rows only queues the new row", () => {
  const h = historyHarness();
  Array.from({ length: 500 }, () => new FakeElement(h.parent, true));
  const row = new FakeElement(h.parent, true);
  const changed = h.context.collectChangedChatHistoryRows([
    { target: h.parent, addedNodes: [row] },
  ], h.parent);
  assert.deepEqual(Array.from(changed), [row]);
  assert.equal(h.parent.scans, 0);
  h.context.scheduleChatHistoryCaptureSnapshot(h.parent, changed);
  h.advance(100);
  assert.deepEqual(h.captures, [[row]]);
});

test("reused rows and newly added wrappers are still captured", () => {
  const h = historyHarness();
  const row = new FakeElement(h.parent, true);
  const textParent = new FakeElement(row);
  const wrapper = new FakeElement(h.parent);
  const wrapped = new FakeElement(wrapper, true);
  const changed = h.context.collectChangedChatHistoryRows([
    { target: textParent, addedNodes: [{ parentElement: textParent }] },
    { target: row, addedNodes: [] },
    { target: h.parent, addedNodes: [wrapper] },
  ], h.parent);
  assert.deepEqual(Array.from(changed), [row, wrapped]);
  assert.equal(h.parent.scans, 0);
});

function syncHarness() {
  const video = { playbackRate: 1, isConnected: true, paused: false, readyState: 4 };
  let latency = 5;
  let reads = 0;
  let writes = 0;
  let text = "";
  const tip = {
    get textContent() { return text; },
    set textContent(value) { writes += 1; text = value; },
  };
  const btn = { querySelector: () => tip };
  const clock = clockContext({
    document: { hidden: false, querySelector: () => btn },
    syncCatchUp: null,
    syncIntendedRate: 0,
    syncCfg: { enable: 3, target: 2 },
    SYNC_MODE: "rate",
    SYNC_RATE: 1.5,
    SYNC_BUTTON_CLASS: "cheese-live-sync-button",
    findCorePlayer: () => ({}),
    findVideo: () => video,
    findPlayer: () => ({}),
    getLiveLatencySeconds: () => { reads += 1; return latency; },
    setPlaybackRate: (_core, target, rate) => { target.playbackRate = rate; },
    keepControlsVisible() {},
    releaseControlsVisible() {},
    updateSyncButtonState() {},
  });
  const constants = mixer.match(/^  const SYNC_(?:CATCH_UP_CHECK_MS|MAX_DURATION_MS|NO_PROGRESS_MS|PROGRESS_EPS_S|JUMP_LATENCY_S) = .*$/gm);
  vm.runInContext(constants.join("\n"), clock.context);
  vm.runInContext(section(mixer, "  function setSyncTooltip(", "  function updateSyncButtonState("), clock.context);
  vm.runInContext(section(mixer, "  function startSyncCatchUp(", "  // 되감기/앞으로 버튼:"), clock.context);
  return { ...clock, video, btn, setLatency: (n) => { latency = n; }, reads: () => reads, writes: () => writes };
}

test("catch-up checks at 4Hz and identical tooltip text is not rewritten", () => {
  const h = syncHarness();
  h.context.startSyncCatchUp();
  h.advance(1000);
  assert.equal(h.reads(), 5); // Initial measurement plus four checks.
  assert.equal(h.writes(), 1);
  h.context.stopSyncCatchUp();
  assert.equal(h.video.playbackRate, 1);
  h.advance(1000);
  assert.equal(h.tasks.size, 0);
});

test("catch-up reaches target in a hidden tab without waiting for an animation frame", () => {
  const h = syncHarness();
  h.context.requestAnimationFrame = () => { throw Error("Hidden frame cannot run"); };
  h.context.document.hidden = true;
  h.context.startSyncCatchUp();
  h.setLatency(1.9);
  h.advance(250);
  assert.equal(h.video.playbackRate, 1);
  assert.equal(h.context.syncCatchUp, null);
  assert.equal(h.writes(), 0);
});

test("catch-up stops on a paused, seeking, buffering, or detached video", () => {
  for (const change of [
    (v) => { v.paused = true; },
    (v) => { v.seeking = true; },
    (v) => { v.readyState = 2; },
    (v) => { v.isConnected = false; },
  ]) {
    const h = syncHarness();
    h.context.startSyncCatchUp();
    change(h.video);
    h.advance(250);
    assert.equal(h.video.playbackRate, 1);
    assert.equal(h.context.syncCatchUp, null);
  }
});

test("catch-up never starts while paused, seeking, or buffering", () => {
  for (const state of [{ paused: true }, { seeking: true }, { readyState: 2 }]) {
    const h = syncHarness();
    Object.assign(h.video, state);
    h.context.startSyncCatchUp();
    assert.equal(h.video.playbackRate, 1);
    assert.equal(h.context.syncCatchUp, null);
    assert.equal(h.tasks.size, 0);
  }
});

test("repeated starts do not duplicate catch-up loops; stalled playback exits", () => {
  const h = syncHarness();
  h.context.startSyncCatchUp();
  h.context.startSyncCatchUp();
  assert.equal(h.tasks.size, 1);
  h.advance(4500);
  assert.equal(h.context.syncCatchUp, null);
  assert.equal(h.video.playbackRate, 1);
  assert.equal(h.tasks.size, 0);
});

function sidebarHarness(pathname = "/live/channel") {
  const styles = new Map();
  const properties = new Map();
  let reads = 0;
  let writes = 0;
  const sidebar = { expanded: true, width: 240,
    getBoundingClientRect() { reads += 1; return { width: this.width }; },
  };
  const clock = clockContext({
    location: { pathname },
    featureFlags: { sidebarPush: true, sidebarRight: true },
    document: {
      documentElement: { style: {
        getPropertyValue: (name) => properties.get(name) || "",
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      } },
      getElementById: (id) => id === "sidebar" ? sidebar : styles.get(id),
      createElement: () => {
        let text = "";
        return {
          get textContent() { return text; },
          set textContent(value) { text = value; writes += 1; },
        };
      },
      head: { appendChild: (element) => styles.set(element.id, element) },
    },
    isSidebarExpanded: () => sidebar.expanded,
    scheduleSearchSectionTopFabSync() {},
  });
  vm.runInContext(section(content, '  const SIDEBAR_PUSH_STYLE_ID =', '  // ── 헤더 자동 숨김'), clock.context);
  return { ...clock, sidebar, styles, reads: () => reads, writes: () => writes };
}

test("player sidebar responds before settling and preserves its transition", () => {
  for (const pathname of ["/live/channel", "/video/123"]) {
    const h = sidebarHarness(pathname);
    h.context.scheduleSidebarPushSettle();
    h.advance(79);
    assert.equal(h.reads(), 0);
    h.context.scheduleSidebarPushSettle();
    h.advance(1);
    assert.equal(h.reads(), 1);
    const style = h.styles.get("cheese-sidebar-push-style");
    assert.match(style.textContent, /padding-right: 240px/);
    assert.match(style.textContent, /transition: padding 0.2s ease/);
    h.sidebar.width = 220;
    h.advance(80);
    assert.match(style.textContent, /padding-right: 220px/);
    h.advance(160);
    assert.equal(h.reads(), 4);
    assert.equal(h.writes(), 2);
    assert.equal(h.tasks.size, 0);
    h.sidebar.expanded = false;
    h.context.applySidebarPush();
    assert.doesNotMatch(style.textContent, /padding-right/);
    assert.equal(style.textContent, "");
    h.sidebar.expanded = true;
    h.context.applySidebarPush();
    assert.match(style.textContent, /padding-right: 220px/);
    h.context.featureFlags.sidebarPush = false;
    h.context.applySidebarPush();
    assert.equal(style.textContent, "");
  }
});

test("non-player pages retain animated sidebar push", () => {
  const h = sidebarHarness("/following");
  h.context.applySidebarPush();
  assert.equal(h.reads(), 1);
  assert.match(h.styles.get("cheese-sidebar-push-style").textContent, /transition: padding 0.2s ease/);
});

test("chat and sidebar scrolling do not schedule header layout reads", () => {
  class ScrollTarget {
    constructor(selector) { this.selector = selector; }
    closest(selectors) { return selectors.split(", ").includes(this.selector) ? this : null; }
  }
  let updates = 0;
  const h = clockContext({ Element: ScrollTarget, headerScrollRaf: 0,
    updateStickyShift: () => { updates += 1; },
  });
  vm.runInContext(section(content, "  function onHeaderScroll(", "  function bindHeaderAutoHide("), h.context);
  for (const selector of ["aside#sidebar", "aside#aside-chatting", "aside#vod-aside"]) {
    h.context.onHeaderScroll({ target: new ScrollTarget(selector) });
  }
  h.advance(20);
  assert.equal(updates, 0);
  h.context.onHeaderScroll({ target: new ScrollTarget("main") });
  h.advance(20);
  assert.equal(updates, 1);
});

test("header peek keeps fill-screen height anchored to the hidden layout", () => {
  class Box {}
  const firstBox = new Box();
  const replacementBox = new Box();
  let box = firstBox;
  let top = 100;
  firstBox.id = "live_player_layout";
  replacementBox.id = "live_player_layout";
  firstBox.getBoundingClientRect = () => ({ top });
  replacementBox.getBoundingClientRect = () => ({ top });
  const h = clockContext({
    HTMLElement: Box,
    featureFlags: { headerAutoHide: true },
    headerOffsetPx: 0,
    getFillScreenTarget: () => ({ box }),
    location: { pathname: "/live/channel-id" },
    document: {},
  });
  vm.runInContext(section(content,
    '  let fillScreenTopReferenceKey = "";',
    "  function captureInlineStyleProperties("), h.context);

  assert.equal(h.context.getStableFillScreenTop(firstBox), 100);
  h.context.lockFillScreenTopForHeaderTransition();
  top = 160;
  assert.equal(h.context.getStableFillScreenTop(firstBox), 100);
  // 호버 중 치지직이 플레이어 DOM을 교체해도 peek로 밀린 좌표를 새 기준으로 삼지 않는다.
  box = replacementBox;
  assert.equal(h.context.getStableFillScreenTop(replacementBox), 100);
  // 헤더가 다시 숨겨진 뒤에도 같은 페이지의 일시적인 좌표는 기준을 바꾸지 않는다.
  h.context.lockFillScreenTopForHeaderTransition();
  top = 135;
  assert.equal(h.context.getStableFillScreenTop(replacementBox), 100);
  // 페이지 또는 헤더 배너 기준이 바뀌면 새 레이아웃을 다시 측정한다.
  h.context.headerOffsetPx = 51;
  assert.equal(h.context.getStableFillScreenTop(replacementBox), 135);
});

test("fill-screen top follows real layout changes when header auto-hide is off", () => {
  class Box {}
  const box = new Box();
  let top = 80;
  box.getBoundingClientRect = () => ({ top });
  const h = clockContext({
    HTMLElement: Box,
    featureFlags: { headerAutoHide: false },
    HEADER_PEEK_TRANSITION_MS: 200,
    getFillScreenTarget: () => ({ box }),
    document: { querySelector: () => null },
    applyFillScreen() {},
  });
  vm.runInContext(section(content,
    '  let fillScreenTopReferenceKey = "";',
    "  function captureInlineStyleProperties("), h.context);
  assert.equal(h.context.getStableFillScreenTop(box), 80);
  top = 140;
  assert.equal(h.context.getStableFillScreenTop(box), 140);
});

test("managed fill-screen height is not mistaken for fullscreen after resize", () => {
  class Box {
    matches() { return false; }
    closest() { return null; }
    querySelector() { return null; }
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 1360, bottom: 800 };
    }
  }
  const box = new Box();
  const context = vm.createContext({
    HTMLElement: Box,
    fillScreenStyledEl: box,
    window: { innerWidth: 1360, innerHeight: 768 },
    document: {
      fullscreenElement: null,
      webkitFullscreenElement: null,
      webkitIsFullScreen: false,
      documentElement: { clientWidth: 1360, clientHeight: 768 },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    playerControlName: () => "",
  });
  vm.runInContext(section(content,
    "  function isPlayerFullscreenModeOn(",
    "  // ── 리방/오류 시 자동 새로고침"), context);

  assert.equal(context.isPlayerFullscreenModeOn({ box, el: box }), false);
  context.fillScreenStyledEl = null;
  assert.equal(context.isPlayerFullscreenModeOn({ box, el: box }), true);
});

test("unchanged custom following skips sorting and grouping; changed inputs render", () => {
  let sorts = 0;
  let groups = 0;
  let writes = 0;
  let version = 1;
  let expanded = "_is_expanded_native_";
  const nav = { dataset: {}, closest: () => ({}),
    set innerHTML(value) { writes += 1; },
  };
  const items = [{ channelId: "one" }, { channelId: "two" }];
  const context = vm.createContext({
    customFollowItems: items,
    customFollowShown: 50,
    customFollowFavShown: 50,
    customFollowInitial: 50,
    customFollowFavInitial: 50,
    customFollowDataReady: true,
    customFollowGroupPlacement: "groups-first",
    CUSTOM_FOLLOW_SECTION_ORDERS: { "groups-first": ["groups", "favorites", "following"] },
    featureFlags: { sbFollowGroupEnabled: true, sbFollowGroupExclusive: true },
    customFollowFavorites: new Set(),
    getCustomFollowExpandedNow: () => expanded,
    customFollowSig: () => String(version),
    getCustomFollowVisibleItems: () => { sorts += 1; return items; },
    getCustomFollowGroupVisibleItems: () => items,
    buildCustomFollowDisplayGroups: () => { groups += 1; return [{ items }]; },
    isCustomFollowAutoExpandActive: () => false,
    isCustomFollowFavAutoExpandActive: () => false,
    renderCustomFollowGroups: () => "groups",
    renderCustomFollowChannelSection: () => "channels",
    renderCustomFollowAffinity: () => "",
    ensurePopupPlayerDraggable() {},
  });
  vm.runInContext(section(content, "  function renderCustomFollowList(", "  // 우리 목록 컨테이너에 위임 클릭"), context);
  for (let i = 0; i < 25; i++) context.renderCustomFollowList(nav, {});
  assert.equal(sorts, 1);
  assert.equal(groups, 1);
  assert.equal(writes, 1);
  version += 1;
  context.renderCustomFollowList(nav, {});
  expanded = "";
  context.renderCustomFollowList(nav, {});
  assert.equal(sorts, 3);
  assert.equal(groups, 3);
  assert.equal(writes, 3);
});

test("native following refresh skips frames, hidden tabs, busy buttons and custom lists", () => {
  let clicks = 0;
  let busy = false;
  const button = {
    disabled: false,
    getAttribute: () => busy ? "true" : null,
    click: () => clicks++,
  };
  const context = vm.createContext({
    IS_TOP_FRAME: true,
    document: { hidden: false },
    featureFlags: {},
    sectionRefreshCategory: false,
    sectionRefreshSchedule: false,
    findFollowNavForRefresh: () => ({ querySelector: () => button }),
  });
  vm.runInContext(section(content, "  function clickFollowRefresh()", "  function findFollowNavForRefresh()"), context);
  context.clickFollowRefresh();
  assert.equal(clicks, 1);
  button.disabled = true;
  context.clickFollowRefresh();
  button.disabled = false;
  busy = true;
  context.clickFollowRefresh();
  busy = false;
  context.document.hidden = true;
  context.clickFollowRefresh();
  context.document.hidden = false;
  context.IS_TOP_FRAME = false;
  context.clickFollowRefresh();
  context.IS_TOP_FRAME = true;
  context.featureFlags.sbFollowCustom = true;
  context.clickFollowRefresh();
  assert.equal(clicks, 1);
  context.featureFlags.sbFollowCustom = false;
  context.clickFollowRefresh();
  assert.equal(clicks, 2);
});

test("mixer teardown disconnects all effect nodes including partial builds, preserving bypass", () => {
  for (const connected of [true, false]) {
    let disconnected = 0;
    let restored = 0;
    const node = () => ({ disconnect: () => disconnected++ });
    const audio = { connected, source: {}, ctx: {}, eqFilters: Array.from({ length: 10 }, node) };
    const keys = ["masterGain", "analyser", "normGain", "comp", "limiter", "outputGain", "muteGain"];
    keys.forEach((key) => { audio[key] = node(); });
    const context = vm.createContext({ audio,
      unbindMuteMirror() {}, stopNormalizerLoop() {},
      restoreSourceToDestination: () => restored++,
    });
    const source = audio.source;
    const ctx = audio.ctx;
    vm.runInContext(section(mixer, "  function teardownGraph()", "  // 플레이어 음소거"), context);
    context.teardownGraph();
    assert.equal(disconnected, 17);
    assert.equal(restored, 1);
    assert.equal(audio.connected, false);
    assert.equal(audio.eqFilters.length, 0);
    keys.forEach((key) => assert.equal(audio[key], null));
    assert.equal(audio.source, source);
    assert.equal(audio.ctx, ctx);
    context.teardownGraph();
    assert.equal(disconnected, 17);
    assert.equal(restored, 1, "repeated cleanup must not interrupt bypass playback");
  }
});

test("normalizer skips paused, ended, detached or suspended audio without stopping background playback", () => {
  let sample;
  let reads = 0;
  const audio = {
    connected: true, normTimer: 0,
    video: { isConnected: true, paused: false, ended: false },
    ctx: { state: "running" },
    analyser: { fftSize: 1024, getFloatTimeDomainData: () => reads++ },
  };
  const context = vm.createContext({ audio, state: { normalizer: { enabled: true } },
    document: { hidden: true },
    setInterval: (fn) => { sample = fn; return 1; },
    clearInterval() {},
    stopNormalizerLoop() { audio.normTimer = 0; },
  });
  vm.runInContext(section(mixer, "  function startNormalizerLoop()", "  function stopNormalizerLoop()"), context);
  context.startNormalizerLoop();
  sample();
  assert.equal(reads, 1);
  for (const key of ["paused", "ended"]) {
    audio.video[key] = true;
    sample();
    audio.video[key] = false;
  }
  audio.video.isConnected = false;
  sample();
  audio.video.isConnected = true;
  audio.ctx.state = "suspended";
  sample();
  assert.equal(reads, 1);
  audio.ctx.state = "running";
  sample();
  assert.equal(reads, 2);
});

test("seek bar frame loop stops after removal, hiding, disabling or leaving live", () => {
  for (const mode of ["removed", "hiddenControls", "hiddenTab", "disabled", "route"]) {
    let bar = { classList: { contains: () => true } };
    let renders = 0;
    const h = clockContext({
      document: { hidden: false, querySelector: () => bar },
      location: { pathname: "/live/test" },
      SEEK_BAR_CLASS: "seek", seekBarRaf: 0, seekBarDragging: false, liveSeekBarOn: true,
      renderSeekBar: () => renders++,
    });
    vm.runInContext(section(mixer, "  function startSeekBarRender()", "  function renderSeekBar()"), h.context);
    h.context.startSeekBarRender();
    h.context.startSeekBarRender();
    h.advance(16);
    assert.equal(renders, 1);
    if (mode === "removed") bar = null;
    if (mode === "hiddenControls") bar.classList.contains = () => false;
    if (mode === "hiddenTab") h.context.document.hidden = true;
    if (mode === "disabled") h.context.liveSeekBarOn = false;
    if (mode === "route") h.context.location.pathname = "/video/123";
    h.advance(1000);
    assert.equal(renders, 1, mode);
    assert.equal(h.tasks.size, 0, mode);
    assert.equal(h.context.seekBarRaf, 0, mode);
  }
});

test("mixer UI observer and pending timers are released across repeated visibility cycles", () => {
  let active = 0;
  let idleCancelled = 0;
  const h = clockContext({
    document: { hidden: false, documentElement: {} },
    scheduleTick() {}, tickTimer: 0, tickIdleHandle: 0,
    MutationObserver: class {
      observe() { active++; }
      disconnect() { active--; }
    },
    cancelIdleCallback: () => idleCancelled++,
  });
  vm.runInContext(section(mixer, "  let observer = null;", "  window.addEventListener(\"pagehide\""), h.context);
  for (let i = 0; i < 100; i++) {
    h.context.startMixerObserver();
    h.context.startMixerObserver();
    assert.equal(active, 1);
    h.context.tickTimer = h.context.setTimeout(() => assert.fail("cancelled timer ran"), 250);
    h.context.tickIdleHandle = 1;
    h.context.document.hidden = true;
    h.context.stopMixerObserver();
    h.context.stopMixerObserver();
    h.context.startMixerObserver();
    assert.equal(active, 0);
    assert.equal(h.tasks.size, 0);
    h.context.document.hidden = false;
  }
  assert.equal(idleCancelled, 100);
});

test("video filter frame sampling releases missing or detached video", () => {
  for (const video of [null, { isConnected: false }]) {
    let stopped = 0;
    const context = vm.createContext({
      appliedVideo: video, findVideo: () => null,
      stopFrameMonitor: () => stopped++,
      scheduleNextFrameSample: () => assert.fail("must not requeue a detached video"),
    });
    vm.runInContext(section(filter, "  function sampleVideoFrameQuality()", "  function evaluateFrameDropRatio("), context);
    context.sampleVideoFrameQuality();
    assert.equal(stopped, 1);
  }
});

test("emoticon URL cache stays bounded while preserving blocked keys", () => {
  const context = vm.createContext({ blockedEmoticons: new Set(["keep"]) });
  vm.runInContext(section(chat, "  const emoticonKeyUrls =", "  function harvestEmoticonKeyUrls("), context);
  context.cacheEmoticonKeyUrl("keep", "blocked-url");
  for (let i = 0; i < 20000; i++) context.cacheEmoticonKeyUrl(`emoji${i}`, `url${i}`);
  assert.equal(vm.runInContext("emoticonKeyUrls.size", context), 4097);
  assert.equal(vm.runInContext("emoticonKeyUrls.get('keep')", context), "blocked-url");
  assert.equal(vm.runInContext("emoticonKeyUrls.has('emoji0')", context), false);
  assert.equal(vm.runInContext("emoticonKeyUrls.get('emoji19999')", context), "url19999");
});

test("cancelled automatic following stops pagination without returning a partial list", async () => {
  const pages = [];
  const context = vm.createContext({
    FOLLOW_CLEANUP_API_BASE: "https://example.test", CUSTOM_FOLLOW_FETCH_TIMEOUT_MS: 1000,
    normalizeFetchedFollowings: (items) => items,
    fetchCustomFollowResponse: async (url) => {
      const page = new URL(url).searchParams.get("page");
      pages.push(Number(page));
      return { ok: true, json: async () => ({ content: { totalPage: 8, followingList: [page] } }) };
    },
  });
  vm.runInContext(section(content, "  async function fetchAllFollowings(", "  // ── 전용 팔로잉 목록 데이터 병합"), context);
  const result = await context.fetchAllFollowings({ shouldContinue: () => pages.length < 4 });
  assert.equal(result, null);
  assert.deepEqual(pages, [0, 1, 2, 3]);
  pages.length = 0;
  const complete = await context.fetchAllFollowings();
  assert.equal(complete.length, 8, "manual cleanup caller retains all pages by default");
});

test("video filter channel lookup cache caps SPA visits without caching failures", async () => {
  let requests = 0;
  const context = vm.createContext({ fetchChannelIdFromApi: async (id) => {
    requests++;
    return id === "missing" ? null : `channel-${id}`;
  } });
  vm.runInContext("const videoChannelCache = new Map();" +
    section(filter, "  async function resolveChannelId(", "  function findPlayer()"), context);
  for (let i = 0; i < 350; i++) await context.resolveChannelId(`video:${i}`);
  assert.equal(vm.runInContext("videoChannelCache.size", context), 300);
  assert.equal(vm.runInContext("videoChannelCache.has('0')", context), false);
  assert.equal(await context.resolveChannelId("video:349"), "channel-349");
  assert.equal(requests, 350);
  assert.equal(await context.resolveChannelId("video:missing"), null);
  assert.equal(vm.runInContext("videoChannelCache.has('missing')", context), false);
  assert.equal(await context.resolveChannelId("live:test"), "test");
  assert.equal(requests, 351);
});

test("indexed following sort preserves favorites, offline priority and every sort mode", () => {
  const items = Array.from({ length: 64 }, (_, i) => ({
    channelId: String(i), name: `name-${(i * 13) % 17}`,
    live: i % 3 === 0, openDate: i % 5 ? (i * 17) % 29 : null, countRaw: i % 7,
  }));
  const order = ["17", "3", "17", "44", "8", "0"];
  const favorites = new Set(["0", "3", "8", "17", "44", "53"]);
  const flags = {};
  const context = vm.createContext({ customFollowFavOrder: order,
    customFollowFavorites: favorites, featureFlags: flags, customFollowFavSort: "custom" });
  vm.runInContext(section(content, "  function customFollowModeCmp(", '  // "YYYY-MM-DD HH:MM:SS"'), context);
  const modes = ["custom", "name-asc", "name-desc", "recent", "oldest", "popular"];
  function referenceCompare(a, b, mode) {
    const byName = (a, b) => a.name.localeCompare(b.name, "ko");
    const live = Number(!a.live) - Number(!b.live);
    if (mode === "custom") {
      const rank = (item) => { const index = order.indexOf(item.channelId); return index < 0 ? Infinity : index; };
      return rank(a) - rank(b) || byName(a, b);
    }
    if (mode === "name-asc") return byName(a, b);
    if (mode === "name-desc") return byName(b, a);
    if (mode === "recent") return live || (b.openDate || 0) - (a.openDate || 0) || byName(a, b);
    if (mode === "oldest") return live || (a.openDate || Infinity) - (b.openDate || Infinity) || byName(a, b);
    return live || (b.countRaw || 0) - (a.countRaw || 0) || byName(a, b);
  }
  for (const enabled of [false, true]) for (const liveFirst of [false, true]) {
    for (const separate of [false, true]) for (const favMode of modes) for (const mode of modes) {
      Object.assign(flags, { sbFollowFavEnabled: enabled, sbFollowFavLiveFirst: liveFirst, sbFollowFavSort: separate });
      context.customFollowFavSort = favMode;
      const expected = items.slice().sort((a, b) => {
        const fa = enabled && favorites.has(a.channelId);
        const fb = enabled && favorites.has(b.channelId);
        if (fa !== fb) return fa ? -1 : 1;
        if (fa && liveFirst && a.live !== b.live) return a.live ? -1 : 1;
        return referenceCompare(a, b, fa && separate ? favMode : mode);
      });
      const actual = context.sortCustomFollow(items, mode);
      assert.deepEqual(Array.from(actual, (item) => item.channelId), expected.map((item) => item.channelId));
    }
  }
  order.indexOf = () => assert.fail("custom sort must not scan the order array per comparison");
  context.sortCustomFollow(items, "custom");
  order.splice(0, order.length, "53", "44", "3");
  flags.sbFollowFavEnabled = false;
  assert.equal(context.sortCustomFollow(items, "custom")[0].channelId, "53");
  assert.equal(items[0].channelId, "0", "input order must be preserved");
});

test("stationary seek bar does not rewrite classes; empty and recovered ranges still update", () => {
  let writes = 0;
  const classes = new Set(["is-visible"]);
  const bar = {
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => { classes.add(name); writes++; },
      remove: (name) => { classes.delete(name); writes++; },
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); writes++; },
    },
    querySelector: () => null,
  };
  let window = { start: 0, end: 7200, video: { currentTime: 7200 } };
  const context = vm.createContext({ document: { querySelector: () => bar },
    SEEK_BAR_CLASS: "seek", seekBarDragging: false, seekBarLiveEdgeVisual: false, seekBarLastVisualP: NaN,
    getSeekWindow: () => window, getSeekBarLiveSnapThresholds: () => ({ enter: 2, exit: 3 }),
  });
  vm.runInContext(section(mixer, "  function renderSeekBar(", "  function removeSeekBar()"), context);
  for (let i = 0; i < 5000; i++) context.renderSeekBar();
  assert.equal(writes, 1);
  window = null;
  for (let i = 0; i < 100; i++) context.renderSeekBar();
  assert.equal(writes, 3);
  assert.equal(classes.has("is-empty"), true);
  window = { start: 0, end: 7200, video: { currentTime: 7100 } };
  context.renderSeekBar();
  assert.equal(classes.has("is-empty"), false);
  assert.equal(classes.has("is-live-edge"), false);
  assert.ok(context.seekBarLastVisualP < 1);
});
