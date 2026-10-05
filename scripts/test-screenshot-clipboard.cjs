// 스크린샷 클립보드 복사.
//
// 설정 > 플레이어의 '스크린샷 버튼 표시' 아래 '스크린샷 버튼 동작'(파일 저장 기본 / 클립보드 복사)과
// 미리보기 창의 '복사' 버튼. 브라우저는 클릭·키 입력 직후에만 클립보드 쓰기를 허용하므로
// 인코딩을 기다리기 전에 복사를 시작한다(ClipboardItem 에 Promise 를 넘긴다).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("settings.html");
const settings = read("src/settings.js");
const content = read("src/content.js");
const mixer = read("src/audioMixer.js");
const css = read("src/audioMixer.css");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (source, name) => {
  const at = source.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

(async () => {
  // ── 설정 ──
  const button = html.indexOf('data-feature="screenshotButton"');
  const action = html.indexOf("data-screenshot-action\n");
  check(button >= 0 && action > button && action < html.indexOf("data-player-disable-hidden"),
    "'스크린샷 버튼 표시' 바로 아래 하위 옵션");
  const block = html.slice(html.lastIndexOf("<li", action), html.indexOf("</li>", action));
  check(/└ 스크린샷 버튼 동작/.test(block) && /settings-segmented settings-segmented-2/.test(block) &&
    /data-screenshot-action-value="save"[\s\S]*aria-checked="true"[\s\S]*파일 저장/.test(block) &&
    /data-screenshot-action-value="copy"[\s\S]*aria-checked="false"[\s\S]*클립보드 복사/.test(block),
    "파일 저장(기본) / 클립보드 복사 두 칸");
  check(/const SCREENSHOT_ACTION_KEY = "cheeseScreenshotAction";/.test(settings) &&
    /cachedStorageSet\(\{ \[SCREENSHOT_ACTION_KEY\]: action \}\)/.test(settings) &&
    /value === "copy" \? "copy" : "save"/.test(settings),
    "설정 저장: cheeseScreenshotAction, 모르는 값은 저장(save)");

  // ── 치지직 페이지로 전달 ──
  check(/const SCREENSHOT_ACTION_KEY = "cheeseScreenshotAction";/.test(content) &&
    /SCREENSHOT_PREVIEW_KEY,\s*SCREENSHOT_ACTION_KEY,/.test(content) &&
    /screenshotAction = normalizeScreenshotAction\(data\?\.\[SCREENSHOT_ACTION_KEY\]\)/.test(content) &&
    /screenshotAction = normalizeScreenshotAction\(changes\[SCREENSHOT_ACTION_KEY\]\.newValue\)/.test(content) &&
    /changes\[SCREENSHOT_ACTION_KEY\] \|\|/.test(content) &&
    /screenshotAction, \/\/ 스크린샷 버튼 동작/.test(content),
    "content.js: 읽기·변경 감지·플레이어 스크립트로 전달");
  check(/screenshotActionMode = e\.data\.screenshotAction === "copy" \? "copy" : "save";/.test(mixer),
    "플레이어 스크립트가 받는다");

  // ── 버튼 동작 ──
  const take = sliceFn(mixer, "takeScreenshot");
  check(/if \(!preview && screenshotActionMode === "copy"\) \{\s*\/\/[^\n]*\n\s*await copyScreenshot\(encodeScreenshotCanvas\(canvas\)\);\s*return;\s*\}\s*const blob = await encodeScreenshotCanvas\(canvas\);/.test(take),
    "복사 모드: 인코딩을 기다리기 전에 복사를 시작한다(미리보기가 켜져 있으면 미리보기)");
  check(take.indexOf("await") > take.indexOf("ctx.drawImage") && take.indexOf("await") === take.indexOf("await copyScreenshot"),
    "버튼을 누른 뒤 첫 await 전까지 화면을 그린다(클릭 판정 유지)");

  // copyScreenshot 실제 실행
  const run = async ({ promiseOk = true, writeOk = true, supported = true } = {}) => {
    const writes = [];
    const toasts = [];
    class ClipboardItem {
      constructor(items) { this.items = items; }
    }
    const ctx = {
      ClipboardItem: supported ? ClipboardItem : undefined,
      navigator: supported ? {
        clipboard: {
          write: async (items) => {
            const value = items[0].items["image/png"];
            if (value instanceof Promise && !promiseOk) throw new TypeError("promise unsupported");
            if (!writeOk) throw new Error("denied");
            writes.push(await value);
          },
        },
      } : {},
      showScreenshotToast: (ok, message) => toasts.push([ok, message]),
    };
    vm.createContext(ctx);
    vm.runInContext(`${sliceFn(mixer, "copyScreenshot")}\nthis.copyScreenshot = copyScreenshot;`, ctx);
    const ok = await ctx.copyScreenshot(Promise.resolve("PNG"));
    return { ok, writes, toasts };
  };
  const direct = await run();
  check(direct.ok && JSON.stringify(direct.writes) === '["PNG"]' &&
    JSON.stringify(direct.toasts) === '[[true,"클립보드에 복사했어요"]]', "Promise 그대로 image/png 로 복사하고 알린다");
  const fallback = await run({ promiseOk: false });
  check(fallback.ok && JSON.stringify(fallback.writes) === '["PNG"]', "Promise 를 못 받는 브라우저는 Blob 으로 다시 쓴다");
  const denied = await run({ writeOk: false });
  check(!denied.ok && JSON.stringify(denied.toasts) === '[[false,"클립보드에 복사할 수 없어요"]]', "실패하면 알린다");
  const unsupported = await run({ supported: false });
  check(!unsupported.ok && unsupported.toasts[0][1] === "이 브라우저는 이미지 복사를 지원하지 않아요", "지원하지 않으면 알린다");

  // ── 미리보기 창 ──
  const preview = sliceFn(mixer, "openScreenshotPreview");
  check(/class="cheese-screenshot-cancel">취소<\/button>\s*<button type="button" class="cheese-screenshot-copy">복사<\/button>\s*<button type="button" class="cheese-screenshot-save">저장<\/button>/.test(preview),
    "미리보기 창: 취소 · 복사 · 저장");
  check(/copyButton\.textContent = cropEnabled \? "선택 영역 복사" : "복사";/.test(preview) &&
    /output = cropEnabled \? cropScreenshotBlob\(image, crop\) : Promise\.resolve\(blob\);/.test(preview) &&
    /if \(ok\) closeScreenshotPreview\(true\);\s*else copyButton\.disabled = false;/.test(preview),
    "자르기 중이면 선택 영역을 복사, 성공하면 저장처럼 닫는다(취소 안내 없이)");
  check(/\.cheese-screenshot-copy \{[^}]*border-color: rgba\(0, 255, 163, 0\.6\);/.test(css), "복사 버튼은 테두리만 강조(저장이 주 버튼)");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
