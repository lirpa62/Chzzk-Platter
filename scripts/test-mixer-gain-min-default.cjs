// 오디오 믹서·외부 임베드 클립 믹서 '게인 슬라이더 최소' 기본값 50% → 10%.
//
// - 저장값이 없으면 어디서나(설정 화면·content.js·audioMixer.js) 10%를 기본으로 쓴다.
// - 예전 기본값 50%를 그대로 둔 기존 이용자는 업데이트 때 한 번만 10%로 바꾼다(background.js).
//   그 뒤 직접 50%를 고르면 유지한다. 다른 값을 고른 이용자와 신규 설치는 건드리지 않는다.
// - 외부 임베드 클립 믹서의 게인 최소(cheeseEmbedClipGainMin)도 같은 규칙으로 바꾼다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const background = read("src/background.js");
const content = read("src/content.js");
const mixer = read("src/audioMixer.js");
const settings = read("src/settings.js");
const html = read("settings.html");
const embed = read("src/embedClipMixer.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

// 1) 기본값.
check(/let mixerGainMin = 0\.1;/.test(content) &&
  /function normalizeGainMin\(v\) \{[\s\S]*?: 0\.1;\s*\}/.test(content),
  "content.js: 저장값이 없거나 이상하면 게인 최소 10%");
check(/let GAIN_MIN = 0\.1;/.test(mixer) &&
  /min < 0 \|\| min > 1\) min = 0\.1;/.test(mixer) &&
  /if \(max <= min\) \{\s*min = 0\.1;/.test(mixer),
  "audioMixer.js: 범위를 받기 전·이상값일 때 게인 최소 10%");
check(/"cheeseMixerGainMin",\s*\[0\.5, 0\.25, 0\.1, 0\],\s*0\.1,/.test(settings) &&
  /let mixerGlobalGainMinPct = 10;/.test(settings) &&
  /function normalizeMixerGlobalGainBounds[\s\S]{0,200}?: 0\.1;/.test(settings),
  "설정 화면: 게인 최소 선택과 전역 게인 기본값 범위가 10%에서 시작");
const segment = html.slice(html.indexOf("data-mixer-gain-min"), html.indexOf("게인 슬라이더 최대"));
check(/data-gain-min-value="0\.1"\s*role="radio"\s*aria-checked="true"/.test(segment) &&
  /data-gain-min-value="0\.5"\s*role="radio"\s*aria-checked="false"/.test(segment),
  "설정 화면 마크업: 처음 그릴 때 10% 가 선택돼 있다");
check(/let gainMin = 0\.1;/.test(embed) &&
  /gainMin = GAIN_MIN_ALLOWED\.includes\(Number\(data\?\.\[GAIN_MIN_KEY\]\)\)\s*\? Number\(data\[GAIN_MIN_KEY\]\)\s*: 0\.1;/.test(embed),
  "임베드 클립 믹서: 저장값이 없거나 이상하면 게인 최소 10%");
check(/"cheeseEmbedClipGainMin",\s*\[0\.5, 0\.25, 0\.1, 0\],\s*0\.1,/.test(settings) &&
  /let embedClipDefaultGainMinPct = 10;/.test(settings) &&
  /function normalizeEmbedClipDefaultGainBounds[\s\S]{0,200}?: 0\.1;/.test(settings) &&
  /changes\.cheeseEmbedClipGainMin\.newValue\)\s*: 0\.1\) \* 100/.test(settings),
  "설정 화면: 임베드 클립 게인 최소 선택과 기본 게인 범위가 10%에서 시작");
const embedSegment = html.slice(html.indexOf("data-embed-clip-gain-min"), html.indexOf("data-embed-clip-gain-max"));
check(/data-embed-clip-gain-min-value="0\.1"\s*role="radio"\s*aria-checked="true"/.test(embedSegment),
  "설정 화면 마크업: 임베드 클립 게인 최소도 처음 그릴 때 10% 가 선택돼 있다");

// 2) 업데이트 때 한 번만 50% → 10%.
const start = background.indexOf("const MIXER_GAIN_MIN_STORAGE_KEY");
const end = background.indexOf("\n}\n", background.indexOf("async function lowerMixerGainMinOnce")) + 3;
const migration = background.slice(start, end);
const run = async (initial, reason) => {
  const store = { ...initial };
  const chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
    set: async (obj) => Object.assign(store, obj),
  } } };
  const ctx = vm.createContext({ chrome });
  vm.runInContext(`${migration}\nthis.migrate = lowerMixerGainMinOnce;`, ctx);
  await ctx.migrate(reason);
  return store;
};
(async () => {
  const FLAG = "cheeseMixerGainMinDefault10Applied";
  const KEY = "cheeseMixerGainMin";
  const EMBED = "cheeseEmbedClipGainMin";
  const old = await run({ [KEY]: 0.5 }, "update");
  check(old[KEY] === 0.1 && old[FLAG] === true, `예전 기본값 50% 를 둔 이용자는 업데이트 때 10% 로 ${JSON.stringify(old)}`);
  const both = await run({ [KEY]: 0.5, [EMBED]: 0.5 }, "update");
  check(both[KEY] === 0.1 && both[EMBED] === 0.1, `두 믹서 모두 50% 면 함께 10% 로 ${JSON.stringify(both)}`);
  const mixed = await run({ [KEY]: 0.25, [EMBED]: 0.5 }, "update");
  check(mixed[KEY] === 0.25 && mixed[EMBED] === 0.1, `믹서별로 따로 판단한다 ${JSON.stringify(mixed)}`);
  const picked = await run({ [KEY]: 0.25 }, "update");
  check(picked[KEY] === 0.25 && picked[FLAG] === true, `다른 값(25%)을 고른 이용자는 그대로 ${JSON.stringify(picked)}`);
  const zero = await run({ [KEY]: 0 }, "update");
  check(zero[KEY] === 0, "0% 를 고른 이용자도 그대로");
  const unset = await run({}, "update");
  check(!(KEY in unset) && unset[FLAG] === true, `저장값이 없으면 값을 쓰지 않고(코드 기본 10%) 표식만 ${JSON.stringify(unset)}`);
  const again = await run({ [KEY]: 0.5, [FLAG]: true }, "update");
  check(again[KEY] === 0.5, "한 번 바꾼 뒤 직접 50% 를 고르면 다음 업데이트에도 유지");
  const fresh = await run({ [KEY]: 0.5 }, "install");
  check(fresh[KEY] === 0.5 && fresh[FLAG] === true, "새 설치(설정 불러오기 등으로 이미 값이 있음)는 값을 건드리지 않고 표식만");
  check(/await lowerMixerGainMinOnce\(details\.reason\);/.test(background),
    "onInstalled 에서 설치·업데이트마다 부른다(표식으로 한 번만)");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
