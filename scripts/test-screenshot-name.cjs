// 스크린샷 파일 이름 형식.
//
// 설정 > 플레이어 '└ 스크린샷 파일 이름' 에서 {채널}{제목}{카테고리}{날짜}{시각}{방송시각} 으로
// 형식을 정한다. 값이 없는 항목은 앞의 구분자와 함께 빠진다. 채널·제목·카테고리·방송 시작
// 시각은 치지직 API 로 받고, 못 받으면 제목 자리에 페이지 제목(예전 이름과 같은 값)을 쓴다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const N = require(path.join(ROOT, "src/screenshotName.js"));
const mixer = read("src/audioMixer.js");
const content = read("src/content.js");
const settings = read("src/settings.js");
const html = read("settings.html");
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
  // ── 형식 규칙 ──
  const at = new Date(2026, 9, 5, 21, 30, 15).getTime();
  const broadcastAt = new Date(2026, 9, 3, 23, 4, 5).getTime();
  const full = { channel: "한동숙", title: "좀보 원정대", category: "프로젝트 좀보이드", at, broadcastAt };
  check(N.DEFAULT === "{채널}_{제목}_{날짜}_{시각}" &&
    N.format(N.DEFAULT, full) === "한동숙_좀보 원정대_20261005_213015", "기본 형식: 채널_제목_날짜_시각");
  check(N.format("{제목} [{카테고리}] {방송시각}", full) === "좀보 원정대 [프로젝트 좀보이드] 20261003_230405",
    "방송 시각은 날짜_시각, 사용자가 넣은 글자·구분자는 그대로");
  check(N.format("{채널} - {카테고리} - {방송시각} - {시각}", { channel: "A", at }) === "A - 213015" &&
    N.format("{카테고리}_{채널}", { channel: "A", at }) === "A",
    "값이 없는 항목은 앞의 구분자와 함께 빠지고, 맨 앞·끝 구분자는 지운다");
  check(N.format("", full) === N.format(N.DEFAULT, full) && N.format("고정 이름", full) === N.format(N.DEFAULT, full) &&
    N.normalizeFormat("x".repeat(300) + "{채널}") === N.DEFAULT,
    "비었거나 항목이 없으면(또는 200자에서 잘려 항목이 사라지면) 기본 형식");

  // ── 플레이어 스크립트: 이름 만들기 ──
  const run = async ({ path: pathname, api, latency = 2, currentTime = 0, title = "페이지 제목 - 치지직", format = "" }) => {
    const calls = [];
    const timers = [];
    const ctx = {
      location: { pathname },
      document: { title },
      window: {
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
      },
      fetch: async (url) => {
        calls.push(url);
        if (api === "hang") return new Promise(() => {});
        if (!api) return { ok: false };
        return { ok: true, json: async () => ({ content: api }) };
      },
      getLiveLatencySeconds: () => latency,
      Date: class extends Date { static now() { return at; } },
      globalThis: { CheeseScreenshotName: N },
      encodeURIComponent,
      Number, String, Promise, Map, RegExp,
    };
    ctx.globalThis.CheeseScreenshotName = N;
    vm.createContext(ctx);
    const start = mixer.indexOf("  // ── 스크린샷 파일 이름 ──");
    const end = mixer.indexOf("\n  }\n", mixer.indexOf("  function screenshotBaseName(")) + 4;
    vm.runInContext(`${sliceFn(mixer, "sanitizeScreenshotName")}\nlet screenshotNameFormat = ${JSON.stringify(format)};\n` +
      `${mixer.slice(start, end)}\nthis.name = screenshotBaseName; this.meta = fetchScreenshotMeta;`, ctx);
    const promise = ctx.name({ currentTime });
    if (api === "hang") timers.find((t) => t.ms === 1500).fn();
    return { name: await promise, calls, ctx };
  };
  const live = await run({
    path: "/live/75cbf189b3bb8f9f687d2aca0d0a382b",
    api: { liveTitle: "좀보 원정대 5days", channel: { channelName: "한동숙" }, liveCategoryValue: "프로젝트 좀보이드", openDate: "2026-10-04 20:00:20" },
    format: "{채널}_{제목}_{카테고리}_{방송시각}",
  });
  const liveBroadcast = new Date(at - 2000);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  check(live.calls[0] === "https://api.chzzk.naver.com/service/v3/channels/75cbf189b3bb8f9f687d2aca0d0a382b/live-detail" &&
    live.name === `한동숙_좀보 원정대 5days_프로젝트 좀보이드_${stamp(liveBroadcast)}`,
    "라이브: live-detail 의 채널·제목·카테고리, 방송 시각 = 찍은 시각 − 지연");
  const vod = await run({
    path: "/video/15510175",
    api: { videoTitle: "좀보 원정대 4days", channel: { channelName: "한동숙" }, videoCategoryValue: "프로젝트 좀보이드", liveOpenDate: "2026-10-03 21:28:27" },
    currentTime: 3723,
    format: "{채널}_{제목}_{방송시각}",
  });
  const vodBroadcast = new Date(Date.parse("2026-10-03T21:28:27+09:00") + 3723 * 1000);
  check(vod.calls[0] === "https://api.chzzk.naver.com/service/v2/videos/15510175" &&
    vod.name === `한동숙_좀보 원정대 4days_${stamp(vodBroadcast)}`,
    "다시보기: 영상 정보, 방송 시각 = 라이브 당시 방송 시작(KST) + 재생 위치");
  const upload = await run({
    path: "/video/1", api: { videoTitle: "업로드", channel: { channelName: "A" } }, currentTime: 10,
    format: "{채널}_{제목}_{방송시각}",
  });
  check(upload.name === "A_업로드", "업로드 영상(방송 시작 시각 없음): 방송 시각이 빠진다");
  const failed = await run({ path: "/live/abc", api: null });
  check(failed.name === "페이지 제목_20261005_213015",
    "API 를 못 받으면 제목 자리에 페이지 제목(예전 이름과 같은 값), 채널은 빠진다");
  const hang = await run({ path: "/live/abc", api: "hang" });
  check(hang.name === "페이지 제목_20261005_213015", "1.5초 안에 못 받으면 기다리지 않고 페이지 제목으로");
  {
    // 같은 방송은 1분 동안 다시 받지 않고, 실패는 다음에 다시 받는다.
    const { ctx, calls } = live;
    await ctx.meta({ kind: "live", id: "75cbf189b3bb8f9f687d2aca0d0a382b" });
    check(calls.length === 1, "같은 방송 정보는 다시 받지 않는다");
    await failed.ctx.meta({ kind: "live", id: "abc" });
    check(failed.calls.length === 2, "실패한 정보는 다음 스크린샷 때 다시 받는다");
  }

  // ── 찍는 흐름 ──
  const take = sliceFn(mixer, "takeScreenshot");
  check(/const namePromise = !preview && screenshotActionMode === "copy"\s*\? null\s*: Promise\.resolve\(screenshotBaseName\(video\)\);/.test(take) &&
    take.indexOf("screenshotBaseName(video)") < take.indexOf("await"),
    "이름은 누른 순간의 값으로 만들고(첫 await 전), 복사할 때는 만들지 않는다");
  check(/const blob = await encodeScreenshotCanvas\(canvas\);\s*const name = await namePromise;/.test(take),
    "인코딩과 정보 받기를 함께 기다린다");

  // ── 연결 ──
  const manifest = JSON.parse(read("manifest.json"));
  const mainJs = manifest.content_scripts.find((entry) => entry.js.includes("src/audioMixer.js")).js;
  check(mainJs[0] === "src/screenshotName.js" && mainJs[1] === "src/audioMixer.js", "치지직 페이지: 플레이어 스크립트보다 먼저");
  check(html.indexOf('<script src="src/screenshotName.js"></script>') < html.indexOf('<script src="src/settings.js"></script>') &&
    html.indexOf('<script src="src/screenshotName.js"></script>') > 0, "설정 페이지: settings.js 보다 먼저");
  check(/const SCREENSHOT_NAME_FORMAT_KEY = "cheeseScreenshotNameFormat";/.test(content) &&
    /SCREENSHOT_ACTION_KEY,\s*SCREENSHOT_NAME_FORMAT_KEY,/.test(content) &&
    /changes\[SCREENSHOT_NAME_FORMAT_KEY\] \|\|/.test(content) &&
    /screenshotNameFormat, \/\/ 스크린샷 파일 이름 형식/.test(content) &&
    /screenshotNameFormat = typeof e\.data\.screenshotNameFormat === "string"/.test(mixer),
    "설정값을 읽고 바뀌면 플레이어 스크립트로 보낸다");

  // ── 설정 화면 ──
  const action = html.indexOf("data-screenshot-action\n");
  const nameItem = html.indexOf("data-screenshot-name>");
  check(nameItem > action && nameItem < html.indexOf("data-player-disable-hidden") &&
    /└ 스크린샷 파일 이름/.test(html.slice(action, nameItem)),
    "'스크린샷 버튼 동작' 바로 아래 하위 옵션");
  const tokens = [...html.matchAll(/data-screenshot-name-token="([^"]+)"/g)].map((m) => m[1]);
  check(JSON.stringify(tokens) === JSON.stringify(N.TOKENS), "항목 단추는 규칙의 항목과 같다(채널·제목·카테고리·날짜·시각·방송 시각)");
  check(/\['\[data-feature="screenshotButton"\]', "\[data-screenshot-action\], \[data-screenshot-name-format\]"\]/.test(read("src/settingsUi.js")),
    "설정 검색: '스크린샷 버튼 표시' 의 하위 옵션");
  check(/!screenshotNames \|\| value === screenshotNames\.DEFAULT \? "" : value/.test(settings) &&
    /screenshotNameInput\.value = value\.slice\(0, start\) \+ token \+ value\.slice\(end\);/.test(settings) &&
    /screenshotNameInput\.value = screenshotNames\.DEFAULT;/.test(settings) &&
    /screenshotNames\.format\(screenshotNameInput\?\.value, \{/.test(settings),
    "설정: 기본 형식은 빈 값으로 저장, 단추는 커서 자리에, 기본값 단추, 예시 이름은 같은 규칙");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
