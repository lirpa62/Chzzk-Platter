// 멀티뷰 채팅 분리 검증.
// 채팅 분리는 치지직 채팅창(독립 창)으로만 연다. 예전의 '치즈 플래터 팝업'(확장 페이지
// multiviewChatPopup)은 치지직이 다른 출처의 iframe 표시를 막아 치지직 채팅을 띄울 수 없게
// 되어 없앴다. 다시보기 채팅은 시청 화면이 그리는 것이라 분리하지 않는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const parentScript = read("src/multiviewWatch.js");
const tooltipScript = read("src/multiviewTooltip.js");
const contentScript = read("src/content.js");
const watchHtml = read("multiviewWatch.html");
const settingsHtml = read("settings.html");
const setupHtml = read("multiview.html");
const styles = read("src/multiview.css");
const manifest = read("manifest.json");
const chromeBuild = read("scripts/build-chrome-package.sh");
const firefoxBuild = read("scripts/build-firefox-package.sh");

// 치즈 플래터 팝업은 파일·참조 모두 남지 않는다.
for (const file of ["multiviewChatPopup.html", "src/multiviewChatPopup.js", "src/multiviewChatPopup.css"]) {
  assert.ok(!fs.existsSync(path.join(root, file)), `${file} 이 남아 있다`);
}
for (const [source, label] of [[parentScript, "시청 화면"], [manifest, "manifest"],
  [chromeBuild, "크롬 빌드"], [firefoxBuild, "파이어폭스 빌드"], [contentScript, "content.js"]]) {
  assert.doesNotMatch(source, /multiviewChatPopup/, `${label} 에 치즈 플래터 팝업 참조가 남았다`);
}
assert.doesNotMatch(parentScript, /CHAT_POPUP_PAGE|CHAT_POPUP_MESSAGE|chatPopupPost|BroadcastChannel|openChatPopup\(|syncVodChatPopup|"platter"/,
  "시청 화면에 치즈 플래터 팝업 경로가 남았다");
assert.doesNotMatch(parentScript, /cheeseMultiviewChatPopoutMode|CHAT_POPOUT_MODE_KEY|chatPopoutMode/,
  "없앤 분리 채팅 방식 설정을 아직 읽는다");
assert.doesNotMatch(styles, /mv-chat-popup-vod/, "팝업 전용 스타일 선택자가 남았다");
// 분리는 치지직 채팅창으로만, 다시보기 채팅은 분리하지 않고 안내한다.
assert.match(parentScript, /function openChatPopout\(\) \{\s*if \(isVideoChatSource\(state\.chatChannelId\)\) \{\s*showChatPopoutFeedback\("다시보기 채팅은 분리할 수 없습니다\."\);\s*return;\s*\}\s*openNativeChatPopup\(\);\s*\}/);
assert.match(parentScript, /function reflectChatPopoutButton\(\) \{[\s\S]*?"다시보기 채팅은 분리할 수 없습니다\."[\s\S]*?"치지직 채팅창을 엽니다\. 다른 채팅 확장 프로그램을 사용할 수 있습니다\."/);
assert.match(parentScript, /function postChatView\(\) \{\s*if \(detachedChat\) return;/);
assert.match(parentScript, /if \(closePopup\) EXT\.removeWindow\(popup\.windowId\)\.catch/);

assert.match(watchHtml, /id="mvChatPopout"/);
assert.match(setupHtml, /id="mvStartWithoutChat"/);
assert.match(setupHtml, /채팅 없이 시작/);
assert.match(parentScript, /chatEnabled: raw\.chatEnabled !== false/);
assert.match(parentScript, /if \(state\.chatEnabled\) applyChat\(state\.chatChannelId\)/);
assert.match(parentScript, /if \(!folded && !state\.chatEnabled\)/);
assert.match(watchHtml, /id="mvChatPopout"[^>]*aria-label="채팅 분리"/);
assert.doesNotMatch(watchHtml, /mvChatNativePopout/);
// 분리 채팅 방식 설정은 없앴다(치지직 페이지 위 멀티뷰는 치지직 채팅창만 쓸 수 있다).
assert.doesNotMatch(settingsHtml, /data-mv-chat-popout-mode-value/);
assert.match(watchHtml, /id="mvChatPopupReturn"/);
assert.ok(
  watchHtml.indexOf('id="mvChatPanel"') <
    watchHtml.indexOf('id="mvChatFollow"') &&
    watchHtml.indexOf('id="mvChatFollow"') <
      watchHtml.indexOf('id="mvChatExpand"'),
  "메인 따라가기 버튼은 상단바 채팅 버튼 오른쪽에 있어야 한다",
);
assert.ok(
  watchHtml.indexOf('id="mvChatFollow"') < watchHtml.indexOf('class="mv-chat-head"'),
  "메인 따라가기 버튼은 채팅 헤더가 아니라 상단바에 있어야 한다",
);
assert.match(watchHtml, /id="mvChatFollow"[^>]*data-tooltip="메인 채널을 바꾸면 채팅도 같이 바꾼다"/);
assert.match(watchHtml, /id="mvChatPopout"[^>]*data-tooltip=/);
assert.match(watchHtml, /치지직 채팅창을 엽니다\. 다른 채팅 확장 프로그램을 사용할 수 있습니다\./);
assert.doesNotMatch(watchHtml, /id="mvChatFollow"[^>]*\stitle=/);
assert.doesNotMatch(watchHtml, /id="mvChatPopout"[^>]*\stitle=/);
assert.match(watchHtml, /class="mv-chat-popup-status-live"[^>]*role="status"/);
assert.match(watchHtml, /id="mvChatPopupReturn"\s+data-tooltip=/);
assert.doesNotMatch(setupHtml, /\stitle=/);
assert.doesNotMatch(watchHtml.replace(/title="채팅"/, ""), /\stitle=/);
assert.match(setupHtml, /src="src\/multiviewTooltip\.js"/);
assert.match(watchHtml, /src="src\/multiviewTooltip\.js"/);
assert.match(tooltipScript, /pointerover/);
assert.match(tooltipScript, /focusin/);
assert.match(tooltipScript, /getBoundingClientRect/);
assert.match(parentScript, /\.src = "about:blank"/);
assert.match(parentScript, /data\.channelId !== state\.chatChannelId/);
assert.match(parentScript, /data\.generation !== chatGeneration/);
assert.match(parentScript, /function restoreInlineChat/);
assert.match(parentScript, /function openNativeChatPopup/);
assert.match(parentScript, /new URL\(`\/live\/\$\{channelId\}\/chat`, CHZZK_ORIGIN\)/);
// 창 API 는 EXT 를 거친다(확장 페이지는 바로, 치지직 페이지 위에서는 배경 스크립트로).
assert.match(parentScript, /popupWindow = await EXT\.createWindow\(/);
assert.match(parentScript, /EXT\.updateTabUrl\(popup\.tabId, url\)/);
assert.match(parentScript, /EXT\.onWindowRemoved\(\(windowId\) =>/);
assert.match(parentScript, /createWindow: \(options\) => chrome\.windows\.create\(options\)/);
assert.match(parentScript, /updateTabUrl: \(tabId, url\) => chrome\.tabs\.update\(tabId, \{ url \}\)/);
assert.match(parentScript, /onWindowRemoved: \(listener\) => chrome\.windows\.onRemoved\.addListener\(listener\)/);
assert.doesNotMatch(parentScript.match(/const FRAME_MESSAGE_TYPES[\s\S]*?if \(event\.origin !== CHZZK_ORIGIN\)/)?.[0] || "", /if \(detachedChat\) return/);
assert.match(parentScript, /loadChat\(state\.chatChannelId\)/);
assert.match(contentScript, /cheeseMultiChatGeneration/);
assert.match(styles, /\.mv-stage\.is-chat-popped-out \.mv-chat-body/);
assert.match(styles, /--mv-vod-local-chat-surface-neutral-base: #e1e1e5/);
assert.match(styles, /--mv-vod-local-chat-surface-neutral-base: #2e3033/);
assert.match(styles, /--mv-vod-local-chat-surface-brand-strongest: #1bb373/);
assert.match(styles, /--mv-vod-local-chat-surface-brand-strongest: #00ffa3/);
assert.match(styles, /\.mv-vod-chat-row\.is-local/);
assert.match(styles, /\.mv-vod-chat-message \{\s*color: var\(--mv-vod-local-chat-content-neutral-cool-strong\)/);
assert.match(styles, /\.mv-tooltip\s*\{/);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] \.mv-chat-title-wrap/);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] #mvChatPopoutFeedback\s*\{\s*order: 1/s);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] #mvChatPopout\s*\{\s*margin-left: auto;\s*order: 2/s);
assert.match(styles, /\.mv-stage\[data-chat-side="bottom"\] #mvChatToggle\s*\{\s*order: 3/s);
assert.match(parentScript, /function openChatPopout\(\)/);
assert.match(parentScript, /chrome\.storage\.onChanged\.addListener/);
assert.match(parentScript, /button\.dataset\.tooltip = isVideo\s*\?/);

console.log("multiview chat popout tests passed");
