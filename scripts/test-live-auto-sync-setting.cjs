// 설정 > 실시간 따라잡기 '자동 따라잡기' 켜기/끄기.
//
// 예전에는 플레이어의 실시간 따라잡기 버튼 우클릭 메뉴로만 켜고 끌 수 있어 찾기 어려웠다.
// '실시간 따라잡기 민감도' 위에 스위치를 둔다. 값은 우클릭 메뉴와 같은 확장 저장소 키
// (cheeseAudioMixer.autoSync)라, 어느 쪽에서 바꿔도 열린 치지직 탭과 설정 화면이 함께 맞는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const html = read("settings.html");
const settings = read("src/settings.js");
const content = read("src/content.js");
const mixer = read("src/audioMixer.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const toggle = html.indexOf("data-live-auto-sync");
const sensitivity = html.indexOf("실시간 따라잡기 민감도");
// 사이에는 채널별 자동 따라잡기 목록(자동 따라잡기에 딸린 행)만 둔다.
const channelList = html.indexOf("data-auto-sync-channels-list");
check(toggle > 0 && toggle < sensitivity && toggle < channelList && channelList < sensitivity &&
  sensitivity - channelList < 600 && channelList - toggle < 1200 &&
  /<h2 class="settings-group-title">실시간 따라잡기<\/h2>/.test(html.slice(toggle - 1200, toggle)),
  "설정 > 실시간 따라잡기: '실시간 따라잡기 민감도' 바로 위에 '자동 따라잡기' 스위치(+채널별 목록)");
// 따라잡기 옵션이 많아 플레이어 탭에서 떼어 바로 아래 '실시간 따라잡기' 탭으로 옮겼다.
{
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  const at = html.indexOf('data-panel="catchup"');
  const section = html.slice(at, html.indexOf("</section>", at));
  const titles = [...section.matchAll(/class="settings-group-title"[^>]*>\s*([^<]+?)\s*</g)].map((m) => m[1]);
  check(tabs[tabs.indexOf("player") + 1] === "catchup" &&
    (html.match(/data-panel="catchup"/g) || []).length === 1 &&
    JSON.stringify(titles) === JSON.stringify(["실시간 따라잡기", "실시간 따라잡기 민감도", "따라잡기 방식", "따라잡기 배속", "자동 따라잡기 쿨다운"]) &&
    !/data-panel="player"[\s\S]{0,200}aria-label="실시간 따라잡기"/.test(html),
    `플레이어 탭 바로 아래 '실시간 따라잡기' 탭에 따라잡기·민감도·방식·배속·쿨다운이 모여 있다 ${JSON.stringify(titles)}`);
}
check(/\["\[data-live-auto-sync\]", "cheeseAudioMixer\.autoSync", false\]/.test(settings) &&
  /SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseAudioMixer\.autoSync"/.test(settings),
  "우클릭 메뉴와 같은 키, 기본 꺼짐, 미리 읽기 목록에 있다(다시 열어도 저장한 값)");
check(/if \(changes\[AUDIO_MIXER_AUTO_SYNC_KEY\]\) \{\s*window\.postMessage\(\s*\{\s*source: "cheese-audio-mixer-content",\s*type: "auto-sync-loaded",/.test(content) &&
  /e\.data\.type === "auto-sync-loaded"\) \{\s*if \("channels" in e\.data\) applyAutoSyncChannels\(e\.data\.channels\);\s*setAutoSync\(e\.data\.enabled === true, \{ syncStorage: false \}\);/.test(mixer),
  "설정에서 바꾸면 열린 치지직 탭의 플레이어에 바로 반영된다");
check(/type: "save-auto-sync",/.test(mixer) && /data\.type === "save-auto-sync"/.test(content),
  "우클릭 메뉴로 바꾸면 같은 키에 저장된다(설정 화면에도 반영)");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
