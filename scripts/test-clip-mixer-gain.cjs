// 치지직 클립 페이지 오디오 믹서 게인(clipAudioMixer.js).
//
// 클립 페이지 믹서에는 게인 조절이 없었다. 지금은:
//   - 버튼 오른쪽에 세로 게인 슬라이더(치지직 클립 음량 슬라이더처럼 위아래). 왼쪽은 클립 영상이라
//     오른쪽으로 펼친다(실측: 화면 폭 1117px, 음량 버튼 x1039~1087 → 오른쪽 여유 30px).
//   - 휠: 믹서가 켜져 있고 버튼·슬라이더 위일 때만 가로챈다(클립 전환 막음). 슬라이더 위는 늘 게인,
//     버튼 위는 설정(프리셋 전환/게인 조절). 그 밖의 휠·믹서가 꺼졌을 때는 클립 전환으로 넘긴다.
//   - 게인은 프리셋 게인을 대체하고, 프리셋을 바꾸면 그 프리셋 게인부터. 마지막 게인은 다음 클립에 이어 쓴다.
//   - 색·크기는 치지직 음량 슬라이더(트랙·채움·핸들·판)에서 읽어 그대로 쓴다.
//   - 부모(clipFrameCoordinator)가 활성 상태를 알리는 프레임이면, 휠만으로 버튼을 숨기지 않는다(첫 클립에서
//     위로 굴리는 등 넘어가지 않는 휠에도 0.5초 사라졌다). 실측: 클립 전환은 프레임 하나 안에서 클립 목록
//     (FlickingView)을 스크롤해 넘긴다(프레임은 그대로). 그래서 영상이 든 목록이 실제로 스크롤될 때만 숨긴다
//     (안 그러면 버튼이 음량 버튼을 따라 끌려 다녔다).
// 원본 함수를 떼어 실제 clipAudioMixer.css 위에서 돌린다(스크립트 자체는 shorts 프레임에서만 시작한다).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const mixer = read("src/clipAudioMixer.js");
const css = read("src/clipAudioMixer.css") + read("src/clipVideoFilter.css");
const settings = read("src/settings.js");
const settingsUi = read("src/settingsUi.js");
const html = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = mixer.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return mixer.slice(at, mixer.indexOf("\n  }\n", at) + 4);
};
const constLine = (name) => {
  const m = mixer.match(new RegExp(`const ${name} = [^;]+;`));
  assert.ok(m, `${name} 상수를 찾지 못했다`);
  return m[0];
};

// 소스 규칙.
check(/userGain = null;\s*lastGain = null;[\s\S]{0,200}?\[LAST_GAIN_KEY\]: null/.test(sliceFn("cyclePreset")),
  "프리셋을 바꾸면 그 프리셋 게인부터 시작하고 마지막 게인도 지운다");
check(/audio\.masterGain\.gain\.value = currentGain\(\);/.test(sliceFn("applySnapshot")),
  "그래프에는 프리셋 게인 대신 지금 게인(사용자 값 우선)을 건다");
check(/if \(changes\[LAST_GAIN_KEY\]\) \{[\s\S]*?if \(!enabled\) userGain = lastGain;\s*\}\s*if \(\s*!changes\[WHEEL_ACTION_KEY\]/.test(mixer),
  "마지막 게인 변경은 값만 받는다(설정 전체를 다시 읽어 현재 클립 프리셋을 되돌리지 않는다)");
check((mixer.match(/userGain = lastGain;/g) || []).length >= 4,
  "켤 때(클릭·자동)·클립 프레임이 활성화될 때 마지막 게인을 이어 쓴다");
check(settings.includes('"cheeseClipAudioMixerWheelAction",') && settings.includes('"cheeseClipAudioMixerGainMin",') &&
  /"cheeseClipAudioMixerWheelAction",\s*\["preset", "gain"\],\s*"preset",/.test(settings) &&
  /"cheeseClipAudioMixerGainMin",\s*\[0\.5, 0\.25, 0\.1, 0\],\s*0\.1,/.test(settings) &&
  /data-clip-audio-mixer-wheel-action-value="preset"\s*role="radio"\s*aria-checked="true"/.test(html) &&
  settingsUi.includes("[data-clip-audio-mixer-wheel-action], [data-clip-audio-mixer-gain-min], [data-clip-audio-mixer-gain-max], [data-clip-audio-mixer-gain-step]"),
  "설정 > 클립·카페: 휠 동작(기본 프리셋 전환)·게인 최소(기본 10%)·최대·간격, 클립 믹서 하위 옵션으로 묶임");

const filter = read("src/clipVideoFilter.js");
check(/if \(isMediaToolGesture\(event\)\) return;[\s\S]{0,400}?if \(frameActivityKnown\) return;\s*hideButtonDuringTransition\(\);/.test(mixer) &&
  /function handleTransitionGesture\(event\) \{[\s\S]*?if \(frameActivityKnown\) return;\s*hideButtonDuringTransition\(\);/.test(filter),
  "부모가 전환을 알리는 프레임이면 휠·터치·방향키만으로 믹서·필터 버튼을 숨기지 않는다");
{
  // 실제 함수로: 알림을 받는 프레임은 숨기지 않고, 못 받는 프레임은 지금처럼 숨긴다.
  const vm = require("node:vm");
  const run = (known) => {
    const ctx = vm.createContext({ Element: class {}, Date, setTimeout: () => 0, clearTimeout: () => {} });
    vm.runInContext(`
      let frameActivityKnown = ${known}; let hidden = 0; let transitionBroadcastTimer = 0; let lastTransitionBroadcastAt = 0;
      ${constLine("TRANSITION_BROADCAST_INTERVAL_MS")}
      const isMediaToolGesture = () => false; const hideButtonDuringTransition = () => { hidden++; }; const postTransitionStart = () => {};
      ${sliceFn("broadcastTransitionStart")}
      broadcastTransitionStart({ target: null });
      this.hidden = hidden;`, ctx);
    return ctx.hidden;
  };
  check(run(true) === 0 && run(false) === 1, "휠만으로 숨기는 건 부모 알림이 없는 프레임(다른 곳에 붙은 클립)에서만");
}
check(["src/clipAudioMixer.js", "src/clipVideoFilter.js"].every((file) => {
  const src = read(file);
  return /function onClipListScroll\(event\)/.test(src) && /document\.addEventListener\("scroll", onClipListScroll, \{ capture: true, passive: true \}\)/.test(src) &&
    (src.match(/startMotionWatch\(\);/g) || []).length === 2;
}), "믹서·필터 모두 시작할 때(그리고 bfcache 복귀 때) 클립 목록 스크롤 감지를 켠다");
check(/if \(enabled && audio\.connected\) \{[\s\S]{0,200}?wheelAction === "gain" \? "휠: 게인 조절" : "휠: 프리셋 전환"/.test(mixer) &&
  /if \(enabled && appliedVideo\) \{[\s\S]{0,200}?"휠: 프리셋 전환"/.test(filter),
  "켜져 있을 때만 툴팁에 휠 안내(믹서는 설정대로 프리셋 전환/게인 조절, 필터는 프리셋 전환)");
check(/└ 믹서 버튼 위 휠 동작<\/span\s*>\s*<span\s*class="settings-item-desc"\s*data-settings-summary="/.test(html),
  "설정: '믹서 버튼 위 휠 동작' 설명은 짧은 요약 + (i) 상세");

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-clip-gain-"));
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
    await call("Emulation.setDeviceMetricsOverride", { width: 1117, height: 848, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const mouse = async (type, x, y, extra = {}) =>
      call("Input.dispatchMouseEvent", { type, x, y, button: extra.button || "none", buttons: extra.buttons || 0, clickCount: extra.clickCount || 0, deltaX: 0, deltaY: extra.deltaY || 0 }, sessionId);
    await ev(`(() => {
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)} + ' body{margin:0;height:848px;background:#000}'; document.head.append(st);
      // 실측 배치: 도구 열(48px)이 x1039, 믹서 버튼 칸 y41~89.
      document.body.innerHTML = '<div class="VolumeButtonView-module__group_sound__x" id="native" style="position:fixed;left:1023px;top:105px;width:80px;height:150px">' +
        '<div class="VolumeButtonView-module__btn_box__x" style="background:rgba(10, 20, 30, 0.5)"><div class="VolumeButtonView-module__control_wrap__x">' +
        '<div class="VolumeButtonView-module__volumebar__x" style="width:6px;background:rgba(255, 255, 255, 0.3);border-radius:3px">' +
        '<div class="VolumeButtonView-module__current__x" style="background:rgb(255, 0, 0)"></div>' +
        '<div class="VolumeButtonView-module__slider_range__x"><div class="VolumeButtonView-module__slider__x" style="width:10px;height:10px;background:rgb(0, 255, 0)"></div></div>' +
        '</div></div></div></div>' +
        '<div id="video" style="position:fixed;left:0;top:0;width:1000px;height:848px"></div>' +
        '<div class="cheese-clip-media-tool-stack" style="left:1039px;top:89px" data-placement="above"><div class="cheese-clip-audio-mixer-slot" id="slot"><button class="cheese-clip-audio-mixer-button" id="btn"></button></div></div>';
      window.__saved = [];
      window.chrome = { storage: { local: { set: (v) => { window.__saved.push(v); return Promise.resolve(); } } } };
      window.__cycled = [];
      const finite = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
      ${constLine("BUTTON_CLASS")}
      ${constLine("GAIN_SLIDER_CLASS")}
      ${constLine("GAIN_SLIDER_WIDTH")}
      ${constLine("LAST_GAIN_KEY")}
      let slot = document.getElementById('slot');
      let anchorGroup = document.getElementById('native');
      ${mixer.slice(mixer.indexOf("  const NATIVE_SLIDER_PARTS = {"), mixer.indexOf("  };", mixer.indexOf("  const NATIVE_SLIDER_PARTS = {")) + 4)}
      let enabled = true, graphError = '', frameActive = true, masterEnabled = true, featureHidden = false, featureEnabled = true;
      const audio = { connected: true, masterGain: { gain: { value: 1 } } };
      let presetSnapshot = { gain: 1.1 };
      let userGain = null, lastGain = null, lastGainSaveTimer = 0, wheelAction = 'preset';
      let gainMin = 0.1, gainMax = 2, gainStep = 5;
      let gainSlider = null, gainOpen = false, gainDragging = false, gainHideTimer = 0;
      const updateButton = () => {};
      const cyclePreset = (d) => window.__cycled.push(d);
      ${["harvestNativeSliderStyle", "currentGain", "quantizeGain", "setGain", "nudgeGain", "ensureGainSlider", "setGainOpen", "syncGainSlider", "gainFromPointer", "onGainPointerDown", "onGainKeydown", "onButtonWheel"].map(sliceFn).join("\n")}
      document.addEventListener('wheel', onButtonWheel, { capture: true, passive: false });
      window.__wheelPassed = 0;
      window.addEventListener('wheel', (e) => { if (!e.defaultPrevented) window.__wheelPassed++; });
      window.st = () => ({ gain: currentGain(), userGain, master: audio.masterGain.gain.value });
      window.setState = (o) => { if ('enabled' in o) { enabled = o.enabled; audio.connected = o.enabled; } if ('wheelAction' in o) wheelAction = o.wheelAction; if ('userGain' in o) userGain = o.userGain; syncGainSlider(); };
      syncGainSlider();
      return true;
    })()`);
    const rect = (sel) => ev(`(() => { const r = document.querySelector('${sel}')?.getBoundingClientRect(); return r ? { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null; })()`);
    const shown = () => ev(`getComputedStyle(document.querySelector('.cheese-clip-gain-slider')).visibility === 'visible'`);

    // 1) 마우스를 올리면 오른쪽으로 펼친다.
    check(!(await shown()), "평소에는 숨어 있다");
    await mouse("mouseMoved", 1063, 65);
    await new Promise((r) => setTimeout(r, 200));
    const btn = await rect("#btn");
    const slider = await rect(".cheese-clip-gain-slider");
    check(await shown(), "믹서 버튼에 마우스를 올리면 게인 슬라이더가 보인다");
    const look = await ev(`(() => { const q = (sel) => getComputedStyle(document.querySelector(sel));
      return { panel: q('.cheese-clip-gain-slider').backgroundColor, track: q('.cheese-clip-gain-slider-track').backgroundColor,
        trackW: q('.cheese-clip-gain-slider-track').width, fill: q('.cheese-clip-gain-slider-fill').backgroundColor,
        handle: q('.cheese-clip-gain-slider-handle').backgroundColor, handleW: q('.cheese-clip-gain-slider-handle').width }; })()`);
    check(look.panel === "rgba(10, 20, 30, 0.5)" && look.track === "rgba(255, 255, 255, 0.3)" && look.trackW === "6px" &&
      look.fill === "rgb(255, 0, 0)" && look.handle === "rgb(0, 255, 0)" && look.handleW === "10px",
      `판·트랙·채움·핸들의 색과 크기를 치지직 음량 슬라이더에서 그대로 가져온다 ${JSON.stringify(look)}`);
    check(slider.l >= btn.r && slider.r <= 1117 && slider.h > slider.w,
      `버튼 오른쪽(영상 반대편)에 세로로 펼치고 화면 밖으로 나가지 않는다 ${JSON.stringify({ btn, slider })}`);

    // 2) 세로 드래그: 위 = 최대, 아래 = 최소.
    const track = await rect(".cheese-clip-gain-slider-track");
    const x = Math.round((track.l + track.r) / 2);
    await mouse("mouseMoved", x, track.t + 1);
    await mouse("mousePressed", x, track.t + 1, { button: "left", buttons: 1, clickCount: 1 });
    await mouse("mouseMoved", x, track.t - 20, { buttons: 1 });
    const top = await ev("st()");
    await mouse("mouseMoved", x, track.b + 20, { buttons: 1 });
    const bottom = await ev("st()");
    await mouse("mouseReleased", x, track.b + 20, { button: "left", clickCount: 1 });
    check(top.gain === 2 && bottom.gain === 0.1 && bottom.master === 0.1,
      `위로 끌면 최대(200%), 아래로 끌면 최소(10%)이고 그래프에 바로 걸린다 ${JSON.stringify({ top, bottom })}`);
    await new Promise((r) => setTimeout(r, 400));
    const saved = await ev("window.__saved.at(-1)");
    check(saved?.cheeseClipAudioMixerGain === 0.1, `마지막 게인을 저장해 다음 클립에 이어 쓴다 ${JSON.stringify(saved)}`);

    // 3) 휠: 슬라이더 위 = 게인(클립 전환 막음).
    await ev("setState({ userGain: 1 })");
    // 실제 사용처럼 버튼에 올려 펼친 뒤 슬라이더로 옮긴다.
    await mouse("mouseMoved", 1063, 65);
    await new Promise((r) => setTimeout(r, 50));
    await mouse("mouseMoved", x, Math.round((track.t + track.b) / 2));
    await mouse("mouseWheel", x, Math.round((track.t + track.b) / 2), { deltaY: -100 });
    const wheelUp = await ev("({ ...st(), passed: window.__wheelPassed })");
    check(Math.abs(wheelUp.gain - 1.05) < 0.001 && wheelUp.passed === 0,
      `슬라이더 위 휠은 간격(5%)만큼 게인을 올리고 클립 전환으로 넘기지 않는다 ${JSON.stringify(wheelUp)}`);
    // 버튼 위: 기본(프리셋 전환).
    await mouse("mouseMoved", 1063, 65);
    await mouse("mouseWheel", 1063, 65, { deltaY: 100 });
    const presetWheel = await ev("({ cycled: window.__cycled.slice(), passed: window.__wheelPassed, gain: st().gain })");
    check(JSON.stringify(presetWheel.cycled) === "[1]" && presetWheel.passed === 0 && Math.abs(presetWheel.gain - 1.05) < 0.001,
      `버튼 위 휠은 기본값(프리셋 전환)대로 프리셋을 바꾼다 ${JSON.stringify(presetWheel)}`);
    // 버튼 위: '게인 조절' 설정.
    await ev("setState({ wheelAction: 'gain' })");
    await mouse("mouseWheel", 1063, 65, { deltaY: 100 });
    const gainWheel = await ev("({ cycled: window.__cycled.length, gain: st().gain })");
    check(gainWheel.cycled === 1 && Math.abs(gainWheel.gain - 1) < 0.001, `'게인 조절'로 두면 버튼 위 휠이 게인을 내린다 ${JSON.stringify(gainWheel)}`);
    // 영상 위 휠은 그대로 클립 전환으로.
    await mouse("mouseMoved", 500, 400);
    await mouse("mouseWheel", 500, 400, { deltaY: 100 });
    check(await ev("window.__wheelPassed") === 1, "버튼·슬라이더 밖의 휠은 막지 않는다(클립 전환)");
    // 믹서가 꺼져 있으면 버튼 위 휠도 넘긴다.
    await ev("setState({ enabled: false })");
    await mouse("mouseMoved", 1063, 65);
    await mouse("mouseWheel", 1063, 65, { deltaY: 100 });
    await new Promise((r) => setTimeout(r, 200)); // 접히는 전환(0.12초)이 끝난 뒤 본다
    check(await ev("window.__wheelPassed") === 2 && !(await shown()),
      "믹서가 꺼져 있으면 슬라이더를 보이지 않고 버튼 위 휠도 클립 전환으로 넘긴다");

    // 4) 키보드.
    // 키보드: 믹서 버튼에 초점 → 슬라이더가 펼쳐지고 → Tab 으로 슬라이더에 간다.
    await ev("setState({ enabled: true, userGain: 1 }), document.getElementById('btn').focus(), true");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, sessionId);
    check(await ev("document.activeElement?.classList.contains('cheese-clip-gain-slider')"),
      "믹서 버튼에 초점을 두면 슬라이더가 펼쳐지고 Tab 으로 슬라이더에 갈 수 있다");
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 }, sessionId);
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 }, sessionId);
    const keyUp = await ev("st().gain");
    check(Math.abs(keyUp - 1.05) < 0.001, `슬라이더에 초점을 두고 방향키로 조절한다 (${keyUp})`);

    // 5) 클립 전환 감지: 영상이 든 목록이 스크롤될 때만 숨긴다.
    const scrollTest = await ev(`new Promise((resolve) => {
      document.body.innerHTML = '<div id="list" style="height:300px;overflow-y:auto"><div style="height:900px"><video></video></div></div>' +
        '<div id="other" style="height:100px;overflow-y:auto"><div style="height:400px"></div></div>' +
        '<div class="cheese-clip-media-tool-stack"><div id="toolScroll" style="height:50px;overflow-y:auto"><div style="height:200px"><video></video></div></div></div>';
      let frameActive = true; let hidden = 0; let transitionScrollWatching = false;
      const STACK_CLASS = 'cheese-clip-media-tool-stack';
      const hideButtonDuringTransition = () => { hidden++; };
      ${sliceFn("onClipListScroll")}
      ${sliceFn("startMotionWatch")}
      startMotionWatch();
      const out = {};
      const scrollThen = (id, key, next) => { document.getElementById(id).scrollTop += 120; setTimeout(() => { out[key] = hidden; next(); }, 80); };
      scrollThen('other', 'noVideo', () => scrollThen('toolScroll', 'ownTool', () => scrollThen('list', 'list', () => {
        frameActive = false; const before = hidden;
        document.getElementById('list').scrollTop += 120;
        setTimeout(() => { out.inactive = hidden - before; resolve(out); }, 80);
      })));
    })`);
    check(scrollTest.noVideo === 0 && scrollTest.ownTool === 0 && scrollTest.list === 1 && scrollTest.inactive === 0,
      `영상이 든 클립 목록이 스크롤될 때만(활성 클립에서) 숨긴다 ${JSON.stringify(scrollTest)}`);
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
