const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const watch = fs.readFileSync(path.join(root, "src/multiviewWatch.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/multiview.css"), "utf8");
const mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

const adTransition = content.slice(
  content.indexOf("function checkMultiviewAdTransition()"),
  content.indexOf("function scheduleMultiviewAdCheck()"),
);
check(/previous && !next[\s\S]*?scheduleMultiviewUiReconcile\(250\)/.test(adTransition),
  "광고 종료 후 넓은 화면과 채팅 UI를 다시 맞춘다");
check(/reportMultiviewAdState\(\)/.test(adTransition) &&
  /notifyParent\("FRAME_AD_STATUS"/.test(content),
  "광고와 넓은 화면 상태를 해당 부모 프레임에 전달한다");
check(/lastReportedMultiviewAdState/.test(content),
  "광고 UI 상태가 바뀔 때만 부모에 알린다");

check(/"FRAME_AD_STATUS"/.test(watch), "부모가 광고 상태 메시지를 허용한다");
check(/data\.type === "FRAME_AD_STATUS"[\s\S]*?typeof data\.adPlaying !== "boolean"[\s\S]*?typeof data\.wideScreenOn !== "boolean"/.test(watch),
  "부모가 두 상태 필드를 boolean으로 검증한다");
check(/prompt\.hidden = currentStatus\(channelId\) !== "ready" \|\|[\s\S]*?cell\.dataset\.widePromptPending !== "true" \|\|[\s\S]*?cell\.dataset\.wideScreenOn === "true"/.test(watch) &&
  /if \(data\.wideScreenOn\)[\s\S]*?widePromptPending = "false"[\s\S]*?else if \(data\.adPlaying\)[\s\S]*?widePromptPending = "true"/.test(watch),
  "광고 중 지연이 감지되면 넓은 화면 적용을 확인할 때까지 fallback을 유지한다");

const wideApply = watch.slice(
  watch.indexOf('const wideApply = target.closest?.("[data-mv-wide-apply]")'),
  watch.indexOf('const recheck = target.closest?.("[data-mv-recheck]")'),
);
check(/requestMultiviewWideApply\(channelId\)/.test(wideApply) &&
  /contentWindow\?\.focus\(\)/.test(wideApply),
  "버튼이 넓은 화면 강제 재적용을 요청하고 T 키 입력용 포커스를 준다");
check(!wideApply.includes(".src ="), "fallback에서 iframe src를 바꾸지 않는다");
check(/event\.source !== window\.parent[\s\S]*?event\.origin !== MULTIVIEW_PARENT_ORIGIN[\s\S]*?MULTIVIEW_CHANNEL_ID/.test(content) &&
  /data\.type === "APPLY_MULTIVIEW_WIDE"[\s\S]*?source: "cheese-apply-multiview-wide"/.test(content),
  "frame이 검증된 요청만 MAIN world의 명시적 적용 명령으로 전달한다");
check(/function ensureMultiviewWide\(force = false\)[\s\S]*?!force && now - lastMultiviewWideClickAt/.test(mixer) &&
  /function ensureMultiviewWide\(force = false\)\s*\{\s*if \(!wideScreenAuto && !force\)/.test(mixer) &&
  /startMultiviewWideReconcile\(true\)/.test(mixer),
  "명시적 버튼 적용은 자동 설정 검사와 재시도 쿨다운을 우회한다");
const shortcut = mixer.slice(
  mixer.indexOf("function applyWideByShortcut()"),
  mixer.indexOf("function ensureMultiviewWide(force = false)"),
);
check(/WIDE_LAYOUT_ANCHOR_SELECTOR =[\s\S]*?\.vod_player_wrap[\s\S]*?adVideoContainerEl/.test(mixer) &&
  /function isWideScreenOn\(btn\)\s*\{\s*if \(isWideLayoutOn\(\)\) return true;/.test(mixer),
  "광고 중에도 광고 래퍼 조상의 _is_large_ 로 넓은 화면을 판정한다");
check(/if \(isWideLayoutOn\(\)\) return true;/.test(shortcut) &&
  /if \(!document\.querySelector\(WIDE_LAYOUT_ANCHOR_SELECTOR\)\) return false;/.test(shortcut) &&
  /if \(!document\.hasFocus\(\)\) return false;/.test(shortcut) &&
  /lastMultiviewWideShortcutAt < MULTIVIEW_WIDE_CLICK_COOLDOWN_MS/.test(shortcut) &&
  /new KeyboardEvent\("keydown", \{[\s\S]*?key: "t",[\s\S]*?code: "KeyT",[\s\S]*?bubbles: true/.test(shortcut) &&
  /\(document\.body \|\| document\.documentElement\)\.dispatchEvent/.test(shortcut),
  "광고 중 T 단축키는 판정 가능·포커스·쿨다운을 확인한 뒤 body 에서 보낸다(토글 오작동 방지)");
check(/if \(!isViewModeButtonReady\(button\)\) \{[\s\S]*?return force \? applyWideByShortcut\(\) : false;/.test(mixer),
  "단축키 경로는 수동 요청(force)에서만 쓴다");
check(/div#layout-body \.vod_player_wrap, div#layout-body \[data-role='adVideoContainerEl'\]/.test(content) &&
  /Array\.from\(layoutAnchors\)\.some\(\(el\) => el\.closest\('\[class\*="_is_large_"\]'\)\)/.test(content),
  "부모에 보고하는 넓은 화면 상태도 광고 중 판정을 포함한다");
check(/다시 적용 <kbd>T<\/kbd>/.test(watch), "오버레이에 적용 버튼과 T 안내가 있다");
check(/\.mv-cell-wide-prompt\[hidden\][\s\S]*?display: none/.test(css),
  "숨긴 fallback 오버레이가 레이아웃을 가리지 않는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
