const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const profile = mkdtempSync(join(tmpdir(), "cheese-embed-mixer-"));
const browser = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);

let buffer = "";
let sequence = 0;
let stderr = "";
const pending = new Map();

browser.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-2000);
});
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\0")) >= 0; ) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    const job = pending.get(message.id);
    if (!job) continue;
    pending.delete(message.id);
    if (message.error) job.reject(Error(JSON.stringify(message.error)));
    else job.resolve(message.result);
  }
});

function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      `${JSON.stringify({ id, method, params, sessionId })}\0`,
    );
  });
}

const deadline = setTimeout(() => browser.kill("SIGTERM"), 30000);

(async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const command = (method, params) => call(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await command("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw Error(JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    };

    await evaluate(`
      document.body.innerHTML = '<div class="pzp-pc pzp-pc--controls"><video></video><div class="pzp-pc__bottom-buttons-right"><div class="pzp-pc__volume-control"></div></div></div>';
      Element.prototype.getBoundingClientRect = function () {
        if (this.classList?.contains('cheese-embed-clip-mixer-button')) {
          return { width: 36, height: 36, left: 120, right: 156, top: 300, bottom: 336 };
        }
        if (this.classList?.contains('cheese-embed-clip-mixer-panel')) {
          return { width: 224, height: 220, left: 0, right: 224, top: 0, bottom: 220 };
        }
        return { width: 640, height: 360, left: 0, right: 640, top: 0, bottom: 360 };
      };
      window.filters = [];
      const param = value => ({ value, setTargetAtTime(next) { this.value = next; } });
      const node = extra => ({ connect() {}, disconnect() {}, ...extra });
      window.AudioContext = class {
        constructor() { this.state = 'running'; this.currentTime = 0; this.destination = node(); }
        resume() { return Promise.resolve(); }
        createMediaElementSource() { return node(); }
        createGain() { return node({ gain: param(1) }); }
        createAnalyser() { return node({ fftSize: 0, smoothingTimeConstant: 0, getFloatTimeDomainData() {} }); }
        createBiquadFilter() {
          const filter = node({ type: '', frequency: param(0), Q: param(0), gain: param(0) });
          filters.push(filter);
          return filter;
        }
        createDynamicsCompressor() {
          return node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) });
        }
      };
      window.saved = {
        cheeseMasterEnabled: true,
        cheeseEmbedClipMixerAlwaysOn: false,
        cheeseEmbedClipMixerDefaultOn: false,
        cheeseEmbedClipMixerDefaultPresetEnabled: true,
        cheeseEmbedClipMixerDefaultGainEnabled: true,
        cheeseEmbedClipMixerEqBandMode: 'chzzk',
        'audioMixer:presets': [{
          id: 'voice', name: '<보컬 & 선명>', eqType: 'iso',
          snapshot: { gain: 1.2, eq: [0, 1, 2, 3, 4, 3, 2, 1, 0, -1] }
        }]
      };
      window.writes = [];
      window.storageListener = null;
      window.chrome = {
        storage: {
          local: {
            get: async () => structuredClone(saved),
            set: async value => {
              writes.push(structuredClone(value));
              Object.assign(saved, value);
              storageListener?.(Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { newValue }])), 'local');
            }
          },
          onChanged: { addListener(listener) { storageListener = listener; } }
        }
      };
    `);

    const css = readFileSync("src/embedClipMixer.css", "utf8");
    await evaluate(`
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(css)};
      document.head.appendChild(style);
    `);

    const source = readFileSync("src/embedClipMixer.js", "utf8").replace(
      "if (!isEmbedClipFrame()) return;",
      "if (false) return;",
    );
    await evaluate(source);
    await evaluate("new Promise(resolve => setTimeout(resolve, 150))");

    assert.equal(
      await evaluate("Boolean(document.querySelector('.cheese-embed-clip-mixer-button'))"),
      true,
    );
    await evaluate(`document.querySelector('.cheese-embed-clip-mixer-button').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-panel').textContent.includes('ISO 10밴드')"),
      true,
    );
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-panel-list').classList.contains('is-builtin')"),
      true,
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.cheese-embed-clip-mixer-panel-list [data-preset-key]').length"),
      5,
    );
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.cheese-embed-clip-mixer-panel-list')).overflowY"),
      "visible",
    );
    assert.equal(
      await evaluate(`{
        const list = document.querySelector('.cheese-embed-clip-mixer-panel-list');
        list.scrollHeight <= list.clientHeight;
      }`),
      true,
    );
    await evaluate("document.querySelector('[data-eq-info=iso]').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-panel-mode-info').textContent.includes('표준 1옥타브 간격')"),
      true,
    );
    assert.equal(
      await evaluate("document.querySelector('[data-eq-info=iso]').getAttribute('aria-expanded')"),
      "true",
    );
    await evaluate("document.querySelector('[data-panel-tab=custom]').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-panel-list').classList.contains('is-custom')"),
      true,
    );
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.cheese-embed-clip-mixer-panel-list')).overflowY"),
      "auto",
    );
    assert.equal(
      await evaluate("getComputedStyle(document.querySelector('.cheese-embed-clip-mixer-panel-list')).scrollbarWidth"),
      "thin",
    );
    assert.equal(
      await evaluate("document.querySelector('[data-preset-key=\"custom:voice\"] .cheese-embed-clip-mixer-panel-name').textContent"),
      "<보컬 & 선명>",
    );
    await evaluate("document.querySelector('[data-eq-mode=iso]').click()");
    assert.equal(
      await evaluate("writes.at(-1).cheeseEmbedClipMixerEqBandMode"),
      "iso",
    );
    await evaluate("new Promise(resolve => setTimeout(resolve, 0))");
    await evaluate("document.querySelector('[data-preset-key=\"custom:voice\"]').click()");
    assert.equal(
      await evaluate("Boolean(document.querySelector('.cheese-embed-clip-mixer-panel'))"),
      true,
    );
    assert.equal(
      await evaluate("document.querySelector('[data-preset-key=\"custom:voice\"]').classList.contains('is-on')"),
      true,
    );
    assert.equal(
      await evaluate("Boolean(document.querySelector('[data-panel-close] .lucide-x'))"),
      true,
    );
    await evaluate("document.querySelector('[data-panel-close]').click()");
    assert.equal(
      await evaluate("Boolean(document.querySelector('.cheese-embed-clip-mixer-panel'))"),
      false,
    );
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    assert.equal(await evaluate("filters.length"), 10);
    assert.deepEqual(
      await evaluate("filters.map(filter => filter.frequency.value)"),
      [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
    );
    assert.deepEqual(
      await evaluate("filters.map(filter => filter.gain.value)"),
      [0, 1, 2, 3, 4, 3, 2, 1, 0, -1],
    );
    await evaluate("Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.querySelector('.pzp-pc') })");
    await evaluate(`document.querySelector('.cheese-embed-clip-mixer-button').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`);
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-panel').parentElement === document.fullscreenElement"),
      true,
    );
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-control').classList.contains('is-open')"),
      false,
    );
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-control').dispatchEvent(new Event('pointerenter'))");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-control').classList.contains('is-open')"),
      true,
    );
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-control').dispatchEvent(new Event('pointerleave'))");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-control').classList.contains('is-open')"),
      false,
    );
    assert.equal(
      await evaluate("Boolean(document.querySelector('.cheese-embed-clip-mixer-panel'))"),
      true,
    );
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-panel').style.left"),
      "120px",
    );
    await evaluate("document.querySelector('[data-panel-tab=builtin]').click()");
    await evaluate("document.querySelector('[data-preset-key=musicRich]').click()");
    assert.equal(
      await evaluate("Boolean(document.querySelector('.cheese-embed-clip-mixer-panel'))"),
      true,
    );
    assert.deepEqual(
      await evaluate("filters.map(filter => filter.gain.value)"),
      [1.5, 1.5, 1, 0, -0.5, 0, 0.5, 1, 1.5, 0.8],
    );

    await evaluate("document.querySelector('[data-panel-close]').click()");
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-pressed')"),
      "false",
    );
    await evaluate("chrome.storage.local.set({ cheeseEmbedClipMixerAlwaysOn: false, cheeseEmbedClipMixerDefaultOn: true })");
    await evaluate("new Promise(resolve => setTimeout(resolve, 20))");
    await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-pressed')"),
      "true",
    );
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-pressed')"),
      "false",
    );
    await evaluate("chrome.storage.local.set({ cheeseEmbedClipMixerAlwaysOn: false, cheeseEmbedClipMixerDefaultOn: false })");
    await evaluate("new Promise(resolve => setTimeout(resolve, 20))");
    await evaluate("chrome.storage.local.set({ cheeseEmbedClipMixerAlwaysOn: true, cheeseEmbedClipMixerDefaultOn: false })");
    await evaluate("new Promise(resolve => setTimeout(resolve, 20))");
    await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-pressed')"),
      "true",
    );
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-pressed')"),
      "false",
    );

    await evaluate(`chrome.storage.local.set({
      cheeseEmbedClipMixerDefaultPresetEnabled: false,
      cheeseEmbedClipMixerDefaultGainEnabled: false,
      cheeseEmbedClipMixerPreset: 'bassBoost',
      cheeseEmbedClipMixerGain: 1.37
    })`);
    await evaluate("new Promise(resolve => setTimeout(resolve, 20))");
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-label')"),
      "오디오 믹서 (저음 강화 · 137%)",
    );
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    await evaluate(`chrome.storage.local.set({
      cheeseEmbedClipMixerDefaultPresetEnabled: true,
      cheeseEmbedClipMixerDefaultGainEnabled: true,
      cheeseEmbedClipMixerDefaultPreset: 'vocalBoost',
      cheeseEmbedClipMixerDefaultGain: 1.2
    })`);
    await evaluate("new Promise(resolve => setTimeout(resolve, 20))");
    await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').click()");
    assert.equal(
      await evaluate("document.querySelector('.cheese-embed-clip-mixer-button').getAttribute('aria-label')"),
      "오디오 믹서 (보컬 강조 · 120%)",
    );
    await evaluate(`document.querySelector('.cheese-embed-clip-mixer-gain').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    )`);
    await evaluate("new Promise(resolve => setTimeout(resolve, 160))");
    assert.equal(await evaluate("saved.cheeseEmbedClipMixerGain"), 1.25);

    console.log("embed clip mixer UI test passed");
  } finally {
    clearTimeout(deadline);
    browser.kill("SIGTERM");
    rmSync(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
