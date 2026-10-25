// 다시보기 실제 시각(재생바 썸네일·등록일/방송 시작 툴팁)의 표시 시간대.
//
// 표시가 브라우저 시간대(해외에서는 현지 시각)로만 나와, 한국 반응(KST)을 보고 찾아갈 때는 시차를 암산해야
// 했다. 설정 '표시 시간대': 이 컴퓨터 시간(기본) / 한국 시간(KST 를 붙임) / 둘 다(현지 아래 KST 한 줄).
// 이 컴퓨터가 한국 시간대면 어느 쪽이든 같게 보인다. 시간대 계산은 Intl(timeZone: "Asia/Seoul").
// 시간대별로 자식 프로세스(TZ 환경변수)에서 content.js 의 함수를 떼어 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

if (process.argv[2] === "--child") {
  const content = read("src/content.js");
  const fnSrc = (name) => {
    const at = content.indexOf(`\n  function ${name}(`);
    assert.ok(at >= 0, name);
    return content.slice(at, content.indexOf("\n  }\n", at) + 4);
  };
  const ctx = vm.createContext({ Intl, Date, String, Number, document: null });
  vm.runInContext(
    "let vodClockTimeZone = 'local'; let seoulClockFormatter = null;" +
      ["formatKstClock", "formatClockFields", "formatSeoulClock", "normalizeVodClockTimeZone", "vodClockParts", "formatVodClock"].map(fnSrc).join("\n") +
      "\nthis.run = (mode, ms) => { vodClockTimeZone = normalizeVodClockTimeZone(mode); return { parts: vodClockParts(ms), text: formatVodClock(ms) }; };",
    ctx,
  );
  const sameDay = Date.UTC(2026, 5, 22, 4, 49, 59); // KST 06-22 13:49:59
  const nextDay = Date.UTC(2026, 5, 22, 16, 0, 0); // KST 06-23 01:00:00
  const out = {};
  for (const mode of ["local", "kst", "both", "weird"]) {
    out[mode] = { same: ctx.run(mode, sameDay), next: ctx.run(mode, nextDay) };
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const runIn = (tz) => {
  const r = spawnSync(process.execPath, [__filename, "--child"], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

// 뉴욕(6월 EDT, UTC−4)
{
  const ny = runIn("America/New_York");
  check(ny.local.same.text === "26.06.22. 오전 12:49:59", `이 컴퓨터 시간: 현지 시각 그대로 ${ny.local.same.text}`);
  check(ny.kst.same.text === "26.06.22. 오후 1:49:59 KST", `한국 시간: KST 를 붙인다 ${ny.kst.same.text}`);
  check(ny.both.same.parts.label === "26.06.22. 오전 12:49:59" && ny.both.same.parts.extra === "KST 오후 1:49:59",
    `둘 다: 현지 + 'KST 시각'(같은 날이면 날짜 생략) ${JSON.stringify(ny.both.same.parts)}`);
  check(ny.both.next.parts.extra === "KST 26.06.23. 오전 1:00:00" && ny.both.next.text === "26.06.22. 오후 12:00:00 (KST 26.06.23. 오전 1:00:00)",
    `둘 다: 날짜가 다르면 KST 에도 날짜 ${ny.both.next.text}`);
  check(ny.weird.same.text === ny.local.same.text, "알 수 없는 값은 이 컴퓨터 시간");
}
// 서울: 어느 설정이든 같다(KST 표시를 붙이지 않는다).
{
  const seoul = runIn("Asia/Seoul");
  check(["local", "kst", "both"].every((m) => seoul[m].same.text === "26.06.22. 오후 1:49:59" && !seoul[m].same.parts.extra),
    "한국 시간대 컴퓨터는 세 설정 모두 예전과 같게");
}

// 연결
const content = read("src/content.js");
const settingsJs = read("src/settings.js");
const settingsHtml = read("settings.html");
const settingsUi = read("src/settingsUi.js");
check(/vodClockParts\(seekPreviewState\.liveOpenAt \+ seconds \* 1000\)/.test(content) &&
  /setSeekRealtimeContent\(span, label, broadcastTitle, extra\)/.test(content) &&
  /k\.className = "cheese-seek-realtime-time cheese-seek-realtime-kst";/.test(content),
  "재생바 썸네일은 시간대 설정을 따르고, 둘 다면 KST 를 한 줄 더 쓴다");
check((content.match(/formatVodClock\(/g) || []).length >= 5,
  "다시보기 등록일·방송 시작 시각 툴팁(영상 정보·카드)도 같은 설정을 따른다");
check(/const text = `라이브 시작 시간 : \$\{formatKstClock\(liveDetailState\.liveOpenAt\)\}`;/.test(content),
  "라이브 시작 툴팁은 그대로(설정은 다시보기 탭)");
check(/vodClockTimeZone = normalizeVodClockTimeZone\(changes\[VOD_CLOCK_TIME_ZONE_KEY\]\.newValue\);\s*updateSeekPreviewRealtime\(\);/.test(content),
  "설정을 바꾸면 바로 반영한다");
check(/data-vod-clock-time-zone-value="local"[\s\S]{0,300}?이 컴퓨터 시간[\s\S]{0,400}?data-vod-clock-time-zone-value="kst"[\s\S]{0,300}?한국 시간[\s\S]{0,400}?data-vod-clock-time-zone-value="both"/.test(settingsHtml) &&
  /"cheeseVodClockTimeZone",\s*\["local", "kst", "both"\],\s*"local",/.test(settingsJs) &&
  settingsJs.includes('"cheeseVodClockTimeZone",') &&
  settingsUi.includes(`['[data-feature="seekPreviewRealtime"]', "[data-vod-clock-time-zone]"]`),
  "설정 > 다시보기: '└ 표시 시간대'(이 컴퓨터 시간 기본, 실제 시각 표시의 하위 옵션, 백업 포함)");
check(/data-vod-clock-time-zone-same\s+hidden/.test(settingsHtml) && /timeZone \|\| ""[\s\S]{0,200}?zone === "Asia\/Seoul" \|\| new Date\(\)\.getTimezoneOffset\(\) === -540/.test(settingsJs),
  "한국 시간대 컴퓨터면 차이가 없다고 알린다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
