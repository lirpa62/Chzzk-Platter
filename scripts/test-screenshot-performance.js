#!/usr/bin/env node
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const mixer = readFileSync(resolve(__dirname, "../src/audioMixer.js"), "utf8");
const content = readFileSync(resolve(__dirname, "../src/content.js"), "utf8");
const background = readFileSync(resolve(__dirname, "../src/background.js"), "utf8");
function section(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
function encoderHarness() {
  const blobs = [], canvases = [], draws = [];
  const context = vm.createContext({ document: { createElement: () => {
    const canvas = { width: 0, height: 0,
      getContext: () => ({ drawImage: (...args) => draws.push(args) }),
      toDataURL: () => assert.fail("synchronous PNG encoding"),
      toBlob: (callback, type) => { assert.equal(type, "image/png"); blobs.push(callback); },
    };
    canvases.push(canvas); return canvas;
  } } });
  vm.runInContext(section(mixer, "  function encodeScreenshotCanvas(", "  let screenshotCaptureBusy") +
    section(mixer, "  function cropScreenshotBlob(", "  function openScreenshotPreview("), context);
  return { context, blobs, canvases, draws };
}

test("crop uses original pixels and asynchronous PNG encoding, then releases canvas", async () => {
  const h = encoderHarness();
  const image = { naturalWidth: 3840, naturalHeight: 2160 };
  const result = h.context.cropScreenshotBlob(image, { x: .25, y: .25, w: .5, h: .5 });
  assert.equal(h.canvases[0].width, 1920);
  assert.equal(h.canvases[0].height, 1080);
  assert.deepEqual(h.draws[0].slice(1), [960, 540, 1920, 1080, 0, 0, 1920, 1080]);
  const png = new Blob(["fixture"], { type: "image/png" });
  h.blobs[0](png);
  assert.equal(await result, png);
  assert.equal(h.canvases[0].width, 0);
  assert.equal(h.canvases[0].height, 0);
});

test("failed or tainted canvas encoding releases pixel storage", async () => {
  const h = encoderHarness();
  for (const throws of [false, true]) {
    const canvas = { width: 1920, height: 1080, toBlob(cb) {
      if (throws) throw Error("tainted"); else cb(null);
    } };
    await assert.rejects(h.context.encodeScreenshotCanvas(canvas));
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  }
});

test("capture snapshots the frame and name once, ignores busy clicks, and passes a Blob", async () => {
  const h = encoderHarness();
  class Video { videoWidth = 1920; videoHeight = 1080; }
  const video = new Video(), downloads = [];
  let name = "first";
  Object.assign(h.context, { HTMLVideoElement: Video, screenshotPreviewOn: false,
    screenshotBaseName: () => name, showScreenshotToast: () => assert.fail("unexpected toast"),
    downloadScreenshot: (...args) => downloads.push(args), onScreenshotSaved: () => {},
  });
  h.context.document.querySelector = () => video;
  vm.runInContext(section(mixer, "  let screenshotCaptureBusy", "  // 실패 사유"), h.context);
  const first = h.context.takeScreenshot();
  await h.context.takeScreenshot();
  assert.equal(h.draws.length, 1);
  assert.equal(h.canvases[0].width, 1920);
  name = "after navigation";
  const png = new Blob(["fixture"], { type: "image/png" });
  h.blobs[0](png); await first;
  assert.equal(downloads[0][0], png);
  assert.equal(downloads[0][1], "first");
  assert.equal(vm.runInContext("screenshotCaptureBusy", h.context), false);
});

test("save result clears callback timer immediately and transports no Base64 string", () => {
  const timers = new Map(), sent = [], replies = [];
  let listener, next = 0;
  const window = { addEventListener: (event, callback) => { listener = callback; },
    setTimeout: (callback) => { timers.set(++next, callback); return next; }, clearTimeout: (id) => timers.delete(id),
    postMessage: (payload) => sent.push(payload),
  };
  const context = vm.createContext({ window, BRIDGE_ORIGIN: "https://chzzk.naver.com" });
  vm.runInContext(section(mixer, "  const screenshotSaveCallbacks", "  // 파일명 때문에 실패했는가"), context);
  const png = new Blob(["fixture"], { type: "image/png" });
  context.downloadScreenshot(png, "name", (result) => replies.push(result));
  assert.equal(sent[0].blob, png);
  assert.equal("dataURL" in sent[0], false);
  listener({ source: window, data: { source: "cheese-screenshot-save-result", reqId: sent[0].reqId, ok: true, saved: true } });
  assert.equal(timers.size, 0);
  assert.equal(replies.length, 1);
  assert.equal(vm.runInContext("screenshotSaveCallbacks.size", context), 0);
});

test("unanswered save releases callback at its deadline", () => {
  let expire, calls = 0;
  const context = vm.createContext({ BRIDGE_ORIGIN: "fixture", window: {
    addEventListener() {}, postMessage() {}, clearTimeout() {},
    setTimeout: (cb) => { expire = cb; return 1; },
  } });
  vm.runInContext(section(mixer, "  const screenshotSaveCallbacks", "  // 파일명 때문에 실패했는가"), context);
  context.downloadScreenshot(new Blob(), "name", (result) => { calls++; assert.equal(result.timeout, true); });
  expire(); expire();
  assert.equal(calls, 1);
  assert.equal(vm.runInContext("screenshotSaveCallbacks.size", context), 0);
});

test("Chromium content bridge forwards only a Blob URL and revokes it on completion", () => {
  const marker = content.indexOf('if (!data || data.source !== "cheese-screenshot-save")');
  const from = content.lastIndexOf('  window.addEventListener("message", (event) => {', marker);
  const to = content.indexOf("\n  });", marker) + 6;
  let listener, callback, request;
  const revoked = [], timers = new Map();
  let next = 0;
  const window = { addEventListener: (event, cb) => { listener = cb; }, postMessage() {} };
  const context = vm.createContext({ window, Blob, screenshotDirectSave: true, BRIDGE_ORIGIN: "fixture",
    isFirefoxExtensionRuntime: () => false, downloadScreenshotWithAnchor: () => false,
    URL: { createObjectURL: (blob) => { assert.equal(blob.type, "image/png"); return "blob:fixture"; }, revokeObjectURL: (url) => revoked.push(url) },
    chrome: { runtime: { sendMessage: (payload, cb) => { request = payload; callback = cb; } } },
    setTimeout: (cb) => { timers.set(++next, cb); return next; }, clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(content.slice(from, to), context);
  listener({ source: window, data: { source: "cheese-screenshot-save", reqId: 1, filename: "test.png",
    blob: new Blob(["fixture"], { type: "image/png" }) } });
  assert.equal(request.url, "blob:fixture");
  assert.equal(request.saveAs, false);
  assert.equal("blob" in request, false);
  callback({ ok: true, saved: true });
  assert.deepEqual(revoked, ["blob:fixture"]);
  assert.equal(timers.size, 0);
});

test("Firefox content bridge converts a Blob to a data URL", async () => {
  const marker = content.indexOf('if (!data || data.source !== "cheese-screenshot-save")');
  const from = content.lastIndexOf('  window.addEventListener("message", (event) => {', marker);
  const to = content.indexOf("\n  });", marker) + 6;
  let listener, request;
  const window = { addEventListener: (event, cb) => { listener = cb; }, postMessage() {} };
  const context = vm.createContext({ window, Blob, screenshotDirectSave: true, BRIDGE_ORIGIN: "fixture",
    isFirefoxExtensionRuntime: () => true,
    screenshotBlobToDataURL: async () => "data:image/png;base64,ZmlyZWZveA==",
    downloadScreenshotWithAnchor: () => false,
    chrome: { runtime: { sendMessage: (payload) => { request = payload; } } },
    setTimeout: () => 1, clearTimeout() {}, URL: { revokeObjectURL() {} },
  });
  vm.runInContext(content.slice(from, to), context);
  listener({ source: window, data: { source: "cheese-screenshot-save", reqId: 1, filename: "test.png",
    blob: new Blob(["fixture"], { type: "image/png" }) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(request.url, "data:image/png;base64,ZmlyZWZveA==");
  assert.equal(request.saveAs, false);
});

for (const outcome of ["complete", "timeout", "interrupted"]) {
  test(`background ${outcome} releases its listener/timer and reports truthful status`, () => {
    const timers = new Map(), listeners = new Set(), replies = [];
    let next = 0;
    const context = vm.createContext({
      isFirefoxDownloadRuntime: () => false,
      screenshotDataURLToBlob: () => null,
      startScreenshotDownload: (options, done) => done(null, 42),
      chrome: { runtime: {}, downloads: {
        download: (options, callback) => callback(42),
        onChanged: { addListener: (cb) => listeners.add(cb), removeListener: (cb) => listeners.delete(cb) },
      } },
      setTimeout: (cb) => { timers.set(++next, cb); return next; }, clearTimeout: (id) => timers.delete(id),
    });
    vm.runInContext("function save(message, sendResponse) {" +
      section(background, '  if (message.type === "CHEESE_SCREENSHOT_SAVE")', '  if (message.type === "CHEESE_SEARCH_FETCH_VIDEOS")') + "}", context);
    context.save({ type: "CHEESE_SCREENSHOT_SAVE", url: "blob:fixture", filename: "test.png" }, (result) => replies.push(result));
    if (outcome === "timeout") { for (const expire of timers.values()) expire(); }
    else { for (const listener of listeners) listener({ id: 42, state: { current: outcome }, error: { current: "USER_CANCELED" } }); }
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].saved, outcome === "complete");
    if (outcome === "timeout") assert.equal(replies[0].reason, "timeout");
  });
}
