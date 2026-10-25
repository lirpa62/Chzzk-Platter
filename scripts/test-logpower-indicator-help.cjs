// 설정 > 통나무파워: '적립 중'·1시간 타이머가 언제 보이는지 안내.
//
// '적립 중'·배지 색이 몇 분 늦게 바뀌고, 1시간 타이머는 표시를 켜 두어도 뜨지 않았다. 둘 다 동작 방식 때문이다.
//   - '적립 중': 치지직은 적립 중인지 알려 주지 않아 1분마다 보유량을 보고 5분 보상이 들어오면 켠다
//     → 시작 후 약 5~6분 뒤에 켜지고, 멈춘 뒤에도 최대 6분 남는다
//   - 1시간 타이머: 자동 획득으로 1시간 보상을 받은 순간부터 센다 → 자동 획득이 꺼져 있으면(기본값) 안 뜬다
// 설명을 (i)로 보강하고, 타이머를 보이게 둔 채 자동 획득이 꺼져 있으면 그 자리에서 알린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const html = read("settings.html");
const settings = read("src/settings.js");
const content = read("src/content.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const itemAfter = (name) => {
  const at = html.indexOf(`<span class="settings-item-name">${name}</span>`);
  assert.ok(at >= 0, `${name} 항목을 찾지 못했다`);
  return html.slice(at, html.indexOf("</li>", at));
};

const progress = itemAfter("‘적립 중’ 표시 위치");
check(/data-settings-summary="적립되는 동안 ‘적립 중’을 어디에 보일지: 끔 \/ 배지\(인라인\) \/ 호버 툴팁"/.test(progress) &&
  /1분마다\s+보유량을 확인/.test(progress) && /약 5~6분이\s+걸리고/.test(progress) && /최대 6분/.test(progress),
  "'적립 중' 표시 위치: 요약은 그대로, (i)에 5분 보상·1분 확인·약 5~6분 지연을 적는다");
const timer = itemAfter("1시간 타이머 표시 위치");
check(/data-settings-summary="1시간 보상까지 남은 시간을 어디에 보일지: 끔 \/ 배지\(인라인\) \/ 호버 툴팁"/.test(timer) &&
  /자동\s+획득’으로 1시간 보상을 받은 순간부터/.test(timer) && /자동 획득이 꺼져 있으면 표시되지 않고/.test(timer) &&
  /첫 1시간 보상을 받기 전에는 표시되지 않습니다/.test(timer),
  "1시간 타이머 표시 위치: (i)에 자동 획득 1시간 보상부터 센다는 조건을 적는다");
check(/data-logpower-timer-auto-note\s+hidden/.test(timer), "타이머 항목에 자동 획득 꺼짐 안내 자리가 있다(기본 숨김)");
const color = itemAfter("적립 중 배지 색 변경");
check(/data-settings-summary="적립 중일 때 배지의 통나무파워 숫자 색을 적립 색으로 강조"/.test(color) && /약 5~6분 뒤에 바뀌고/.test(color),
  "적립 중 배지 색 변경: (i)에 같은 지연을 적는다");

// 안내가 실제 동작과 맞는지(코드 기준).
check(/const LP_WATCH_INTERVAL_MIN = 1;/.test(read("src/background.js")) &&
  /const LP_WATCH_ACTIVE_TTL_MS = 6 \* 60 \* 1000;/.test(read("src/background.js")),
  "안내의 1분 확인·6분 유지는 배경 상수와 같다");
check(/if \(hourRewardAmount > 0\) \{\s*if \(isCurrent\(\)\) startWatchHourTimer\(channelId\);/.test(content) &&
  /featureFlags\.chatLogPowerAuto &&/.test(content),
  "안내대로 타이머는 자동 획득으로 1시간 보상을 받을 때 시작한다");

// 자동 획득 꺼짐 안내 토글.
{
  const note = { hidden: true };
  const auto = { checked: false };
  let mode = "badge";
  const ctx = vm.createContext({
    document: {
      querySelector: (sel) => (sel === "[data-logpower-timer-auto-note]" ? note
        : sel === '[data-feature="chatLogPowerAuto"]' ? auto : null),
    },
  });
  const at = settings.indexOf("\n  function reflectLogPowerTimerAutoNote(");
  const fn = settings.slice(at, settings.indexOf("\n  }\n", at) + 4);
  vm.runInContext(`const lpTimerSeg = { get: () => this.mode() }; ${fn}; this.run = reflectLogPowerTimerAutoNote;`, ctx);
  ctx.mode = () => mode;
  ctx.run();
  check(note.hidden === false, "타이머를 보이게 두고 자동 획득이 꺼져 있으면 안내를 보인다");
  auto.checked = true;
  ctx.run();
  check(note.hidden === true, "자동 획득을 켜면 안내를 숨긴다");
  auto.checked = false;
  mode = "off";
  ctx.run();
  check(note.hidden === true, "타이머 표시가 '끔'이면 안내하지 않는다");
}
check(/syncPrereqLocks\?\.\(\);\s*reflectLogPowerTimerAutoNote\(\);/.test(settings) &&
  /data-feature="chatLogPowerAuto"\]'\)\s*\?\.addEventListener\("change", \(\) => reflectLogPowerTimerAutoNote\(\)\)/.test(settings) &&
  /"cheeseLogPowerTimerMode",\s*\(\) => reflectLogPowerTimerAutoNote\(\),/.test(settings),
  "기능 토글을 읽은 뒤·자동 획득을 바꿀 때·타이머 위치를 바꿀 때 안내를 다시 맞춘다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
