const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const html = readFileSync("multiviewWatch.html", "utf8");
const watch = readFileSync("src/multiviewWatch.js", "utf8");
const content = readFileSync("src/content.js", "utf8");
const mixer = readFileSync("src/audioMixer.js", "utf8");

assert.match(html, /id="mvQualityBtn"[\s\S]*?채널별 화질 설정/);
assert.match(html, /id="mvQualityPop"[\s\S]*?aria-busy="false"/);
assert.ok(html.indexOf("id=\"mvStatsBtn\"") < html.indexOf("id=\"mvQualityBtn\"") &&
  html.indexOf("id=\"mvQualityBtn\"") < html.indexOf("id=\"mvSyncBtn\""),
"채널별 화질 버튼은 스트림 정보 옆에 배치된다");

assert.match(watch, /"FRAME_QUALITY_STATE"/);
assert.match(watch, /"FRAME_QUALITY_COMMAND_RESULT"/);
assert.match(watch, /frame\.contentWindow\.postMessage\([\s\S]*?type: "SET_MULTIVIEW_QUALITY"[\s\S]*?CHZZK_ORIGIN/);
assert.match(watch, /event\.origin !== CHZZK_ORIGIN/);
assert.match(watch, /event\.source !== frame\.contentWindow/);
const setQualityStart = watch.indexOf("  function setChannelQuality(");
const setQualityEnd = watch.indexOf("  function startStatsPolling(", setQualityStart);
const setQualitySource = watch.slice(setQualityStart, setQualityEnd);
assert.match(setQualitySource, /type: "SET_MULTIVIEW_QUALITY"/);
assert.match(setQualitySource, /CHZZK_ORIGIN/);
assert.doesNotMatch(setQualitySource, /\.src\s*=/, "화질 변경은 iframe을 다시 로드하지 않는다");
assert.match(content, /event\.origin !== MULTIVIEW_PARENT_ORIGIN/);
assert.match(content, /data\.type === "REQUEST_MULTIVIEW_QUALITY"[\s\S]*?forwardMultiviewQualityCommand/);
assert.match(content, /data\.type === "SET_MULTIVIEW_QUALITY"[\s\S]*?forwardMultiviewQualityCommand/);
assert.match(content, /Number\(value\) >= 144 && Number\(value\) <= 4320/);
assert.match(mixer, /locked: Boolean\(lockedQuality\)/);
assert.match(mixer, /snapshot\.locked && data\.quality !== snapshot\.lockedQuality/);

const cellStatusStart = watch.indexOf("  function setCellStatus(");
const cellStatusEnd = watch.indexOf("  function renderCellOverlay(", cellStatusStart);
const cellStatusSource = watch.slice(cellStatusStart, cellStatusEnd);
assert.match(cellStatusSource, /status === "ended" \|\| status === "error"\)\s*clearQualityChannelActivity\(channelId\)/);
assert.match(cellStatusSource, /updateQualityPolling\(\)/);
assert.match(watch, /function clearQualityChannelActivity\(channelId\)\s*\{[\s\S]*?qualityByChannel\.delete\(channelId\)/);
assert.match(watch, /function hasQualityPollingChannel\(\)\s*\{[\s\S]*?\["ended", "error"\]\.includes\(currentStatus\(channel\.channelId\)\)/);
assert.match(watch, /qualityTimer = window\.setInterval\(\(\) => \{\s*if \(!hasQualityPollingChannel\(\)\) \{\s*stopQualityPolling\(\)/);
assert.match(watch, /function updateQualityPolling\(\)\s*\{[\s\S]*?panel\.hidden \|\| !hasQualityPollingChannel\(\)[\s\S]*?stopQualityPolling\(\);\s*renderQuality\(\)/);
assert.match(watch, /status === "ended" \? "방송 종료"/);

const endedStart = content.indexOf("    const onMultiviewVideoEnded = (");
const endedEnd = content.indexOf("    function checkMultiviewAdTransition", endedStart);
const endedSource = content.slice(endedStart, endedEnd);
assert.match(endedSource, /video\.ended/);
assert.match(endedSource, /!isVod && typeof isAdPlaying === "function" && isAdPlaying\(\)/,
  "라이브 입장 광고의 ended 이벤트는 방송 종료로 오인하지 않는다");
assert.match(endedSource, /notifyParent\("FRAME_ENDED"\)/,
  "실제 종료된 라이브와 다시보기는 부모에 종료 상태를 알린다");
assert.ok(content.includes("#live_player_layout, main [class*=\"_player_\"], #layout-body [class*=\"_player_\"]"),
  "종료 문구를 live player 영역에서 확인한다");
assert.ok(content.includes("characterData: true") && content.includes("scheduleEndedMutationCheck();"),
  "플레이어 내 종료 안내 문구 변경도 다시 확인한다");
assert.match(content, /const scheduleEndedMutationCheck = \(\) => \{[\s\S]*?setTimeout\([\s\S]*?, 150\)/,
  "잦은 플레이어 DOM 변경의 종료 판정은 짧게 합쳐 수행한다");

const helpersStart = mixer.indexOf("  function qualityItemHeight(li)");
const helpersEnd = mixer.indexOf("  // 화질 메뉴에서 목표 화질 항목(li)", helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "화질 메뉴 파서가 있다");
const qualityItems = [
  { prefix: "자동", text: "자동", checked: false },
  { prefix: "1080p", text: "1080p", checked: false },
  { prefix: "720p", text: "720p", checked: true },
];
const fakeList = {
  querySelectorAll: () => qualityItems.map((item) => ({
    textContent: item.text,
    querySelector: () => ({ textContent: item.prefix }),
  })),
};
const helperContext = {
  document: { querySelector: () => fakeList },
};
vm.runInNewContext(
  `${mixer.slice(helpersStart, helpersEnd)}\n` +
    "this.findQuality = findMultiviewQualityMenuItem; this.height = qualityItemHeight;",
  helperContext,
);
assert.equal(helperContext.findQuality("auto")?.textContent, "자동");
assert.equal(helperContext.findQuality("1080")?.textContent, "1080p");
assert.equal(helperContext.findQuality("720")?.textContent, "720p");
assert.equal(helperContext.findQuality("9999"), null);
assert.equal(helperContext.height({
  querySelector: () => ({ textContent: "1080p 원본" }),
}), 1080);

const clickStart = mixer.indexOf("  function clickMultiviewQualityMenuItem(value)");
const clickEnd = mixer.indexOf("  // 화질 메뉴 안에서 일어난 신뢰된 조작만", clickStart);
assert.ok(clickStart >= 0 && clickEnd > clickStart, "네이티브 화질 클릭 경로가 있다");
const clickSource = mixer.slice(clickStart, clickEnd);
assert.match(clickSource, /cloneNode\(true\)/);
assert.match(clickSource, /parent\.replaceChild\(clone, item\)/);
assert.match(clickSource, /item\.click\(\)/);
assert.doesNotMatch(clickSource, /\.selected\s*=/, "트랙 selected 직접 대입을 하지 않는다");

let clicks = 0;
const parent = {
  current: null,
  replaceChild(next, previous) {
    assert.equal(this.current, previous);
    this.current = next;
    next.parentElement = this;
    previous.parentElement = null;
  },
};
const item = {
  classList: { contains: () => false },
  parentElement: parent,
  cloneNode: () => ({ parentElement: parent }),
  click: () => { clicks += 1; },
};
parent.current = item;
const clickContext = {
  findMultiviewQualityMenuItem: () => item,
  maxQualityOwnClickUntil: 0,
  Date,
  requestAnimationFrame: (callback) => callback(),
};
vm.runInNewContext(
  `${clickSource}\nthis.clickQuality = clickMultiviewQualityMenuItem;`,
  clickContext,
);
assert.equal(clickContext.clickQuality("720"), true);
assert.equal(clicks, 1, "치지직 화질 메뉴 항목을 한 번 클릭한다");
assert.equal(parent.current, item, "메뉴 DOM 항목을 원래대로 복구한다");

console.log("멀티뷰 채널별 화질 제어 검증 통과");
