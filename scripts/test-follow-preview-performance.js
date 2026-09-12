#!/usr/bin/env node
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const source = readFileSync(resolve(__dirname, "../src/content.js"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function drain() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function classes() {
  const set = new Set();
  return { add: (...keys) => keys.forEach((key) => set.add(key)),
    remove: (...keys) => keys.forEach((key) => set.delete(key)),
    toggle: (key, on) => on ? set.add(key) : set.delete(key) };
}
function mediaHarness() {
  const instances = [];
  class Video extends EventTarget {
    pauseCount = 0;
    pause() { this.pauseCount++; }
    load() {}
    play() { return Promise.resolve(); }
    removeAttribute(name) { delete this[name]; }
  }
  class Hls {
    static Events = { ERROR: "error", MANIFEST_PARSED: "manifest", LEVEL_LOADED: "level" };
    static isSupported() { return true; }
    handlers = new Map(); destroyed = 0;
    constructor(config) { this.config = config; instances.push(this); }
    on(key, callback) { this.handlers.set(key, callback); }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; }
    destroy() { this.destroyed++; this.handlers.clear(); this.video = null; }
  }
  const video = new Video();
  const el = { isConnected: true, classList: classes(),
    querySelector: (selector) => selector.includes("video") ? video : null,
    remove() { this.isConnected = false; } };
  const state = { session: 1, mediaGeneration: 0, currentChannelId: "A", playbackCache: new Map() };
  const context = vm.createContext({ Hls, followPreviewState: state,
    followPreviewGuardVideos: new WeakSet(), followPreviewUserAudioTouched: false,
    followPreviewLastPointerAt: 0, followPreviewVolumeGuard: false,
    followPreviewMuted: true, followPreviewVolume: 0.5, followPreviewLiveEdge: false,
    makeFreshFollowPreviewThumbUrl: (url) => url, ensureHlsLoaded: async () => true,
    fetchLivePreviewData: async () => null, showFollowPreviewThumb: () => {}, renderFollowPreviewMeta: () => {},
    document: { getElementById: () => el.isConnected ? el : null }, FOLLOW_PREVIEW_ID: "preview",
  });
  for (const name of ["restoreNativeCardPreviewAudio", "clearFollowPreviewOpenTimer", "clearFollowPreviewCloseTimer",
    "clearFollowPreviewTooltipPositionTimer", "abortFollowPreviewFetch", "stopFollowPreviewElapsedTimer",
    "stopFollowPreviewViewersTimer", "stopFollowPreviewMaxLifeTimer"]) context[name] = () => {};
  vm.runInContext(section("  function attachFollowPreviewSource(", "  // 잠깐의 유예 후 닫기"), context);
  return { context, state, el, video, instances,
    attach: () => context.attachFollowPreviewSource(el, "fixture.m3u8", state.currentChannelId, "thumb"),
  };
}

test("100 media replacements do not accumulate one-shot listeners or HLS instances", async () => {
  const h = mediaHarness();
  for (let i = 0; i < 100; i++) {
    h.state.currentChannelId = String(i);
    h.attach(); await drain();
    assert.equal(getEventListeners(h.video, "error").length, 1);
    assert.equal(getEventListeners(h.video, "loadeddata").length, 1);
    assert.equal(getEventListeners(h.video, "volumechange").length, 1);
    assert.equal(getEventListeners(h.video, "pointerdown").length, 1);
    assert.equal(h.instances.filter((instance) => !instance.destroyed).length, 1);
  }
  h.context.closeFollowPreview();
  assert.equal(getEventListeners(h.video, "error").length, 0);
  assert.equal(getEventListeners(h.video, "loadeddata").length, 0);
  assert.equal(h.state.mediaVideo, null);
  assert.equal(h.state.mediaCleanup, null);
  assert.equal(h.state.hls, null);
  assert.ok(h.instances.every((instance) => instance.destroyed === 1));
});

test("late video/HLS errors from an old channel cannot tear down the new stream", async () => {
  const h = mediaHarness();
  h.attach(); await drain();
  const staleVideoError = getEventListeners(h.video, "error")[0];
  const staleHlsError = h.instances[0].handlers.get("error");
  const staleManifest = h.instances[0].handlers.get("manifest");
  h.state.currentChannelId = "B";
  h.attach(); await drain();
  staleVideoError(); staleHlsError(null, { fatal: true }); staleManifest(null, { levels: [] });
  await drain();
  assert.equal(h.state.hls, h.instances[1]);
  assert.equal(h.instances[1].destroyed, 0);
  assert.equal(h.state.retried, undefined);
});

test("same-channel reattachment while HLS loads only creates the latest player", async () => {
  const h = mediaHarness(), gate = deferred();
  h.context.ensureHlsLoaded = () => gate.promise;
  h.attach(); h.attach();
  gate.resolve(true); await drain();
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].config.backBufferLength, 30);
});

test("closing before HLS load resolves never attaches to the removed video", async () => {
  const h = mediaHarness(), gate = deferred();
  h.context.ensureHlsLoaded = () => gate.promise;
  h.attach(); h.context.closeFollowPreview();
  gate.resolve(true); await drain();
  assert.equal(h.instances.length, 0);
  assert.equal(h.state.mediaVideo, null);
});

test("missing preview DOM still tears down retained media and HLS", async () => {
  const h = mediaHarness();
  h.attach(); await drain();
  const before = h.video.pauseCount;
  h.el.isConnected = false;
  h.context.closeFollowPreview();
  assert.equal(h.instances[0].destroyed, 1);
  assert.ok(h.video.pauseCount > before);
  assert.equal(h.state.mediaVideo, null);
});

test("recreated preview video receives its own audio guard", async () => {
  const h = mediaHarness();
  h.attach(); await drain();
  h.context.closeFollowPreview();
  const replacement = new EventTarget();
  Object.assign(replacement, { pause() {}, load() {}, removeAttribute() {}, play: async () => {} });
  h.el.isConnected = true;
  h.el.querySelector = () => replacement;
  h.state.currentChannelId = "A";
  h.attach(); await drain();
  assert.equal(getEventListeners(replacement, "volumechange").length, 1);
});

test("native HLS fallback also removes pending live-edge and ready handlers", async () => {
  const h = mediaHarness();
  h.context.Hls = undefined;
  h.context.followPreviewLiveEdge = true;
  h.video.canPlayType = () => "probably";
  for (let i = 0; i < 100; i++) {
    h.attach(); await drain();
    assert.equal(getEventListeners(h.video, "loadeddata").length, 2);
    assert.equal(getEventListeners(h.video, "error").length, 1);
  }
  h.context.closeFollowPreview();
  assert.equal(getEventListeners(h.video, "loadeddata").length, 0);
  assert.equal(getEventListeners(h.video, "error").length, 0);
});

test("aborted live-detail responses neither populate cache nor release a newer request", async () => {
  const requests = [], timers = new Map();
  let next = 0;
  const state = { playbackCache: new Map(), fetching: "", fetchController: null };
  const context = vm.createContext({ followPreviewState: state, AbortController,
    pruneFollowPreviewCache: () => {}, parsePublishDate: () => 0,
    setTimeout: (cb) => { timers.set(++next, cb); return next; }, clearTimeout: (id) => timers.delete(id),
    fetch: (url, options) => { const gate = deferred(); requests.push({ ...gate, signal: options.signal }); return gate.promise; },
  });
  vm.runInContext(section("  function abortFollowPreviewFetch()", "  function clearNativeCardMuteTimers()") +
    section("  async function fetchLivePreviewData(", "  // 미리보기 패널 생성/획득"), context);
  const first = context.fetchLivePreviewData("A");
  const second = context.fetchLivePreviewData("B");
  assert.equal(requests[0].signal.aborted, true);
  const response = { ok: true, json: async () => ({ content: { status: "OPEN",
    livePlaybackJson: JSON.stringify({ media: [{ protocol: "HLS", path: "fixture.m3u8" }] }),
  } }) };
  requests[0].resolve(response);
  assert.equal(await first, null);
  assert.equal(state.playbackCache.has("A"), false);
  assert.equal(state.fetchController.signal, requests[1].signal);
  requests[1].resolve(response); await second;
  assert.equal(state.playbackCache.get("B").m3u8, "fixture.m3u8");
  assert.equal(state.fetchController, null);
  assert.equal(timers.size, 0);
});

test("A-B-A metadata responses only attach the latest session and stop old media immediately", async () => {
  const requests = [], attached = [];
  let stopped = 0;
  const el = { isConnected: true, classList: classes(), dataset: {}, querySelector: () => null };
  const state = { session: 0 };
  const context = vm.createContext({ followPreviewState: state,
    followPreviewOn: true, cardLivePreviewOn: false, document: { hidden: false },
    followPreviewThumbOnly: false, followPreviewFullTitle: false, followPreviewHeaderBottom: false,
    followPreviewCardLayout: false, followPreviewBadgePos: "top", followPreviewOpenSuppressUntil: 0,
    followPreviewNavigationPointer: null, location: { pathname: "/live/current" },
    syncFollowPreviewNavigation: () => {},
    ensureFollowPreviewEl: () => el,
    teardownFollowPreviewMedia: () => stopped++,
    fetchLivePreviewData: (id) => { const gate = deferred(); requests.push({ id, ...gate }); return gate.promise; },
    attachFollowPreviewSource: (...args) => attached.push(args),
    closeFollowPreview: () => assert.fail("stale response closed preview"),
  });
  for (const name of ["abortFollowPreviewFetch", "stopFollowPreviewElapsedTimer", "stopFollowPreviewViewersTimer",
    "muteNativeCardPreviewForCustomPreview", "startFollowPreviewMaxLifeTimer", "applyFollowPreviewHeaderFont",
    "applyFollowPreviewHeaderVisibility", "applyFollowPreviewColors", "applyFollowPreviewHiddenParts",
    "positionFollowPreview", "scheduleFollowPreviewTooltipPosition", "renderFollowPreviewMeta", "startFollowPreviewViewersTimer"])
    context[name] = () => {};
  vm.runInContext(section("  async function openFollowPreview(", "  // 썸네일 모드 표시"), context);
  const runs = [context.openFollowPreview({ isConnected: true }, "A"),
    context.openFollowPreview({ isConnected: true }, "B"), context.openFollowPreview({ isConnected: true }, "A")];
  assert.equal(stopped, 3);
  requests[0].resolve(null); requests[1].resolve({ m3u8: "old" }); requests[2].resolve({ m3u8: "new" });
  for (const run of runs) await run;
  assert.equal(attached.length, 1);
  assert.equal(attached[0][1], "new");
  const moved = context.openFollowPreview({ isConnected: true }, "C");
  context.location.pathname = "/live/elsewhere";
  requests[3].resolve({ m3u8: "stale-route" });
  await moved;
  assert.equal(attached.length, 1);
});

function navigationHarness() {
  const timers = new Map(), opened = [], listeners = [];
  let next = 0, closed = 0, now = 1000;
  const state = { session: 1, currentChannelId: "A", openTimer: 0, pinned: true };
  const context = vm.createContext({ followPreviewState: state,
    followPreviewOn: true, cardLivePreviewOn: false, FOLLOW_PREVIEW_ID: "preview",
    document: { hidden: false, addEventListener: (type, fn, options) => listeners.push({ owner: "document", type, fn, options }) },
    window: { addEventListener: (type, fn, options) => listeners.push({ owner: "window", type, fn, options }) },
    location: { pathname: "/live/start" }, Date: { now: () => now },
    customFollowDragId: "", popupPlayerDragging: false, followPreviewSuppressedChannelId: "",
    followPreviewLastScrollAt: 0, FOLLOW_PREVIEW_SCROLL_QUIET_MS: 100, FOLLOW_PREVIEW_HOVER_DELAY_MS: 100,
    setTimeout: (fn) => { timers.set(++next, fn); return next; },
    clearFollowPreviewOpenTimer: () => { timers.delete(state.openTimer); state.openTimer = 0; },
    clearFollowPreviewCloseTimer: () => {}, onFollowPreviewScroll: () => {}, scheduleCloseFollowPreview: () => {},
    openFollowPreview: (...args) => opened.push(args),
    closeFollowPreview: () => {
      closed++; state.session++; state.currentChannelId = ""; state.pinned = false;
      timers.delete(state.openTimer); state.openTimer = 0;
    },
    getFollowPreviewAnchor: (target) => target?.found || null,
  });
  vm.runInContext(section("  let followPreviewOpenSuppressUntil = 0;", "  function stopFollowPreviewMaxLifeTimer()") +
    section("  function onFollowPreviewMouseOver(", "  // 사이드바(팔로잉 목록 포함) 안에서"), context);
  const target = (id = "A", link = true, inside = false) => ({
    found: id ? { channelId: id, anchor: { isConnected: true }, kind: "following" } : null,
    closest: (selector) => selector === "a[href]" ? (link ? {} : null) : (inside ? {} : null),
  });
  const event = (node = target(), x = 10, y = 20) => ({ target: node, clientX: x, clientY: y, isTrusted: true });
  return { context, state, timers, opened, listeners, target, event, closed: () => closed,
    blocked: () => vm.runInContext("followPreviewNavigationPointer", context),
    advance: () => { now += 10000; },
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
  };
}

test("navigation cancels pending hover and blocks replacement nodes of the clicked channel beyond 800ms", () => {
  const h = navigationHarness();
  h.state.pinned = false; h.state.currentChannelId = "";
  h.context.onFollowPreviewMouseOver(h.event());
  assert.equal(h.timers.size, 1);
  h.context.onFollowPreviewDocClick(h.event());
  assert.equal(h.timers.size, 0);
  assert.equal(h.closed(), 1);
  assert.deepEqual(Object.keys(h.blocked()).sort(), ["channelId", "x", "y"]);
  h.advance();
  h.context.onFollowPreviewMouseOver(h.event(h.target("A")));
  h.flush();
  assert.equal(h.opened.length, 0);
});

test("only real movement away from the clicked channel releases navigation suppression", () => {
  const h = navigationHarness();
  h.context.onFollowPreviewDocClick(h.event());
  h.context.onFollowPreviewNavigationPointerMove({ ...h.event(h.target("B"), 40), isTrusted: false });
  h.context.onFollowPreviewNavigationPointerMove(h.event(h.target("B")));
  h.context.onFollowPreviewNavigationPointerMove(h.event(h.target("A"), 40));
  assert.equal(h.blocked().channelId, "A");
  h.context.onFollowPreviewNavigationPointerMove(h.event(h.target("B"), 50));
  assert.equal(h.blocked(), null);
  h.flush();
  assert.equal(h.opened[0][1], "B");
  h.context.onFollowPreviewDocClick(h.event());
  h.context.onFollowPreviewNavigationPointerMove(h.event(h.target(null), 50));
  assert.equal(h.blocked(), null);
});

test("automatic clicks and preview controls do not dismiss or suppress a pinned preview", () => {
  const h = navigationHarness();
  h.context.onFollowPreviewDocClick({ ...h.event(), isTrusted: false });
  h.context.onFollowPreviewDocClick(h.event(h.target(null, false, true)));
  assert.equal(h.closed(), 0);
  h.context.onFollowPreviewDocClick(h.event(h.target("A", false)));
  assert.equal(h.closed(), 1); // Existing outside-click dismissal, not navigation.
  assert.equal(h.blocked(), null);
});

test("SPA route change closes pinned media once and cancels pending hover", () => {
  const h = navigationHarness();
  for (let i = 0; i < 100; i++) h.context.syncFollowPreviewNavigation();
  assert.equal(h.closed(), 0);
  h.context.location.pathname = "/live/next";
  h.context.syncFollowPreviewNavigation();
  assert.equal(h.closed(), 1);
  assert.equal(h.state.currentChannelId, "");
  assert.equal(h.blocked().channelId, "A");
  h.context.syncFollowPreviewNavigation();
  assert.equal(h.closed(), 1);
});

test("pending hover cannot open a detached anchor or survive a route change", () => {
  for (const detach of [true, false]) {
    const h = navigationHarness();
    h.state.pinned = false; h.state.currentChannelId = "";
    const node = h.target();
    h.context.onFollowPreviewMouseOver(h.event(node));
    if (detach) node.found.anchor.isConnected = false;
    else h.context.location.pathname = "/live/next";
    h.flush();
    assert.equal(h.opened.length, 0);
    assert.equal(h.timers.size, 0);
  }
});

test("navigation listener uses window capture before document channel handlers and binds only once", () => {
  const h = navigationHarness();
  h.context.bindFollowPreviewHover(); h.context.bindFollowPreviewHover();
  const clicks = h.listeners.filter((entry) => entry.type === "click");
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].owner, "window");
  assert.equal(clicks[0].options, true);
  assert.equal(h.listeners.filter((entry) => entry.type === "pointermove").length, 1);
  h.context.location.pathname = "/live/back";
  h.listeners.find((entry) => entry.type === "popstate").fn();
  assert.equal(h.closed(), 1);
});

test("native new-tab navigation explicitly dismisses preview before opening despite propagation stop", () => {
  const h = navigationHarness(), calls = [];
  h.context.followOpenNewTabOn = true;
  h.context.getFollowNavClickChannelId = () => "B";
  h.context.window.open = (url) => {
    assert.equal(h.state.currentChannelId, "");
    calls.push(url);
  };
  vm.runInContext(section("  function onFollowOpenNewTabClick(", "  function bindFollowOpenNewTab("), h.context);
  h.context.onFollowOpenNewTabClick({ ...h.event(h.target("B", false)), button: 0,
    preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => calls.push("stop"),
  });
  assert.deepEqual(calls, ["stop", "/live/B"]);
  assert.equal(h.blocked().channelId, "B");
});

function viewersHarness() {
  const timers = new Map(), requests = [];
  let next = 0, updates = 0;
  const state = { session: 1, currentChannelId: "A", viewersController: null };
  const el = { isConnected: true, querySelectorAll: () => { updates++; return []; }, querySelector: () => null };
  const context = vm.createContext({ followPreviewState: state, AbortController,
    document: { hidden: false },
    setTimeout: (callback) => { timers.set(++next, callback); return next; }, clearTimeout: (id) => timers.delete(id),
    clearInterval: () => {},
    fetch: (url, options) => { const gate = deferred(); requests.push({ ...gate, signal: options.signal }); return gate.promise; },
  });
  vm.runInContext(section("  async function refreshFollowPreviewViewers(", "  // 현재 떠 있는 미리보기 video") +
    section("  function stopFollowPreviewViewersTimer()", "  // 자동 종료 타이머"), context);
  return { context, state, el, timers, requests, updates: () => updates,
    run: () => context.refreshFollowPreviewViewers(el, "A") };
}

test("slow viewer polls stay single-flight and old responses cannot affect a reopened channel", async () => {
  const h = viewersHarness();
  const old = h.run();
  for (let i = 0; i < 100; i++) await h.run();
  assert.equal(h.requests.length, 1);
  h.context.stopFollowPreviewViewersTimer(); h.state.session++;
  assert.equal(h.requests[0].signal.aborted, true);
  const fresh = h.run();
  h.requests[0].resolve({ ok: true, json: async () => ({ content: { concurrentUserCount: 1 } }) });
  await old;
  assert.equal(h.updates(), 0);
  assert.equal(h.state.viewersController.signal, h.requests[1].signal);
  h.requests[1].resolve({ ok: true, json: async () => ({ content: { concurrentUserCount: 2 } }) });
  await fresh;
  assert.equal(h.updates(), 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.state.viewersController, null);
});

test("viewer request deadline also aborts a stalled JSON body", async () => {
  const h = viewersHarness();
  const run = h.run();
  const { signal } = h.requests[0];
  h.requests[0].resolve({ ok: true, json: () => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Error("timeout")), { once: true });
  }) });
  await drain();
  for (const expire of h.timers.values()) expire();
  await run;
  assert.equal(h.state.viewersController, null);
  assert.equal(h.timers.size, 0);
});

test("HLS injection with no reply times out, cleans timers, and permits a later retry", async () => {
  const timers = new Map();
  let next = 0, sends = 0;
  const context = vm.createContext({
    chrome: { runtime: { sendMessage: () => sends++ } },
    setTimeout: (cb) => { timers.set(++next, cb); return next; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => assert.fail("no callback, no polling"), clearInterval: () => {},
  });
  vm.runInContext(section("  let hlsLoadPromise = null;", "  function attachFollowPreviewSource("), context);
  const first = context.ensureHlsLoaded();
  assert.equal(context.ensureHlsLoaded(), first);
  for (const expire of timers.values()) expire();
  assert.equal(await first, false);
  const second = context.ensureHlsLoaded();
  assert.equal(sends, 2);
  for (const expire of timers.values()) expire();
  await second;
  assert.equal(timers.size, 0);
});
