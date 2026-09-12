#!/usr/bin/env node
"use strict";

// Synthetic production-function profiling, not a logged-in Chzzk playback trace.
const { spawn } = require("node:child_process");
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { tmpdir } = require("node:os");
const output = resolve(process.argv[2] || join(tmpdir(), "cheese-performance-profile"));
mkdirSync(output, { recursive: true });
const content = readFileSync(resolve(__dirname, "../src/content.js"), "utf8");
const mixer = readFileSync(resolve(__dirname, "../src/audioMixer.js"), "utf8");
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw Error(`Missing source: ${start}`);
  return source.slice(from, to);
}
const sortSource = section(content, "  function customFollowModeCmp(", '  // "YYYY-MM-DD HH:MM:SS"');
const seekSource = section(mixer, "  function renderSeekBar(", "  function removeSeekBar()");
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--disable-background-networking", "--no-first-run",
  "--remote-debugging-pipe", `--user-data-dir=${mkdtempSync(join(tmpdir(), "cheese-profile-"))}`,
], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let buffer = "";
let stderr = "";
let nextId = 0;
let snapshot = null;
const pending = new Map();
chrome.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.method === "HeapProfiler.addHeapSnapshotChunk") snapshot?.push(message.params.chunk);
    const task = pending.get(message.id);
    if (!task) continue;
    pending.delete(message.id);
    if (message.error) task.reject(Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  }
});
function call(method, params = {}, sessionId) {
  return new Promise((resolveCall, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveCall, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
}
function failPending(error) {
  for (const task of pending.values()) task.reject(error);
  pending.clear();
}
chrome.on("error", failPending);
const closed = new Promise((done) => chrome.on("close", () => {
  failPending(Error(`Browser closed: ${stderr}`)); done();
}));
const timeout = setTimeout(() => {
  failPending(Error("Profiling timed out")); chrome.kill("SIGTERM");
}, 90000);

(async () => {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => call(method, params, sessionId);
  async function evaluate(expression) {
    const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  await evaluate(`window.runWorkload = (() => {
    let customFollowFavOrder = [];
    let customFollowFavorites = new Set();
    const featureFlags = {sbFollowFavEnabled:true, sbFollowFavSort:true, sbFollowFavLiveFirst:false};
    let customFollowFavSort = 'custom';
    ${sortSource}
    const SEEK_BAR_CLASS = 'fixture-seek';
    let seekBarDragging = false, seekBarLiveEdgeVisual = false, seekBarLastVisualP = NaN;
    const getSeekWindow = () => ({start:0,end:7200,video:{currentTime:7200}});
    const getSeekBarLiveSnapThresholds = () => ({enter:2,exit:3});
    ${seekSource}
    return (iterations = 40) => {
      const sorting = [];
      for (const count of [300,1000]) {
        const items = Array.from({length:count}, (_,i) => ({channelId:'channel-'+i,name:'name-'+i,live:i%2===0}));
        customFollowFavOrder = items.map(item => item.channelId);
        customFollowFavorites = new Set(customFollowFavOrder);
        let seed = 42;
        for (let i=items.length-1;i>0;i--) { seed=(Math.imul(seed,1664525)+1013904223)>>>0; const j=seed%(i+1); [items[i],items[j]]=[items[j],items[i]]; }
        for(let i=0;i<5;i++) sortCustomFollow(items,'popular');
        const start=performance.now();
        let sorted;
        for(let i=0;i<iterations;i++) sorted=sortCustomFollow(items,'popular');
        const elapsed=performance.now()-start;
        if(sorted.some((item,i)=>item.channelId!==customFollowFavOrder[i])) throw Error('Incorrect sort');
        sorting.push({count,iterations,totalMs:elapsed,perSortMs:elapsed/iterations});
      }
      const bar = document.createElement('div');
      bar.className='fixture-seek is-visible';
      bar.innerHTML='<div class="fixture-seek__range"></div><div class="fixture-seek__playhead"></div>';
      document.body.appendChild(bar);
      seekBarLiveEdgeVisual=false; seekBarLastVisualP=NaN;
      const observer=new MutationObserver(()=>{});
      observer.observe(bar,{attributes:true,subtree:true});
      const start=performance.now();
      for(let i=0;i<5000;i++) renderSeekBar();
      const seek={calls:5000,totalMs:performance.now()-start,mutations:observer.takeRecords().length};
      observer.disconnect(); bar.remove();
      return {sorting,seek};
    };
  })();`);
  await evaluate("runWorkload(5)");
  await command("HeapProfiler.enable");
  async function heap(label) {
    await command("HeapProfiler.collectGarbage");
    const usage = await command("Runtime.getHeapUsage");
    snapshot = [];
    await command("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    writeFileSync(join(output, `${label}.heapsnapshot`), snapshot.join(""));
    snapshot = null;
    return usage;
  }
  const before = await heap("before");
  await command("Profiler.enable");
  await command("Profiler.start");
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await evaluate("runWorkload()"));
  const { profile } = await command("Profiler.stop");
  writeFileSync(join(output, "workload.cpuprofile"), JSON.stringify(profile));
  const after = await heap("after");
  const metrics = { scope: "Synthetic extracted production functions; no live stream or extension bootstrap", runs, heap: { before, after } };
  writeFileSync(join(output, "metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout); chrome.kill("SIGTERM"); await closed;
});
