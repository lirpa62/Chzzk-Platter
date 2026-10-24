// 라이브·다시보기 오디오 믹서·비디오 필터 버튼 툴팁의 휠(둘째 줄)·우클릭(셋째 줄) 안내.
//
// 버튼 위 휠이 하는 일이 툴팁에 없어 기능을 알기 어려웠다. 둘째 줄에 알린다.
//   - 오디오 믹서: 설정 '믹서 버튼 위 휠 동작'에 따라 '휠: 프리셋 전환' / '휠: 게인 조절'. 프리셋 전환은
//     꺼져 있어도 동작하고, 게인 조절은 꺼져 있으면 켜라고 안내하므로 늘 보인다. 설정을 바꾸면 바로 바뀐다.
//   - 비디오 필터: 꺼져 있어도 프리셋을 바꾸므로 늘 '휠: 프리셋 전환'.
//   - 셋째 줄 '우클릭: 설정 패널 열기'(우클릭은 클릭 옵션과 상관없이 늘 패널을 여닫는다). 한 줄에 이으면
//     가로로 길어져 줄을 나눈다.
//   - 치지직 툴팁은 한 줄(nowrap)이라 white-space: pre !important 로 줄바꿈을 보인다.
//   - aria-label 에는 안내를 넣지 않는다(화면 낭독은 기존 이름만).
// 원본 함수를 떼어 가짜 버튼으로 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const mixer = read("src/audioMixer.js");
const filter = read("src/videoFilter.js");
const mixerCss = read("src/audioMixer.css");
const filterCss = read("src/videoFilter.css");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

const fakeButton = () => {
  const attrs = {};
  const tip = { textContent: "" };
  return {
    tip,
    attrs,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    querySelector: (sel) => (sel === ".pzp-button__tooltip" ? tip : null),
  };
};

// 오디오 믹서
{
  const button = fakeButton();
  const ctx = vm.createContext({ document: { querySelector: () => button } });
  vm.runInContext(`
    const BUTTON_CLASS = "cheese-audio-mixer-button";
    let mixerWheelAction = "preset"; let label = "오디오 믹서 (기본)";
    const mixerButtonLabel = () => label;
    ${sliceFn(mixer, "syncMixerButtonLabel")}
    this.run = (action, nextLabel) => { mixerWheelAction = action; label = nextLabel; syncMixerButtonLabel(); };
  `, ctx);
  ctx.run("preset", "오디오 믹서 (Shift+A)");
  check(button.tip.textContent === "오디오 믹서 (Shift+A)\n휠: 프리셋 전환\n우클릭: 설정 패널 열기" && button.attrs["aria-label"] === "오디오 믹서 (Shift+A)",
    `믹서(꺼짐·프리셋 전환): 둘째 줄에 '휠: 프리셋 전환', aria-label 은 이름만 ${JSON.stringify(button.tip.textContent)}`);
  ctx.run("gain", "오디오 믹서 (기본)");
  check(button.tip.textContent === "오디오 믹서 (기본)\n휠: 게인 조절\n우클릭: 설정 패널 열기", `믹서(게인 조절 설정): '휠: 게인 조절' ${JSON.stringify(button.tip.textContent)}`);
}
check(/mixerWheelAction = e\.data\.mixerWheelAction === "gain" \? "gain" : "preset";\s*syncMixerButtonLabel\(\);/.test(mixer),
  "믹서: 설정에서 휠 동작을 바꾸면 툴팁 안내도 바로 바뀐다");

// 비디오 필터
{
  const button = fakeButton();
  const ctx = vm.createContext({ document: { querySelector: () => button } });
  vm.runInContext(`
    const BUTTON_CLASS = "cheese-video-filter-button";
    const filterButtonLabel = () => "비디오 필터 (Shift+V)";
    ${sliceFn(filter, "syncButtonLabel")}
    syncButtonLabel();
  `, ctx);
  check(button.tip.textContent === "비디오 필터 (Shift+V)\n휠: 프리셋 전환\n우클릭: 설정 패널 열기" && button.attrs["aria-label"] === "비디오 필터 (Shift+V)",
    `필터: 둘째 줄에 '휠: 프리셋 전환', aria-label 은 이름만 ${JSON.stringify(button.tip.textContent)}`);
}

check(/\.cheese-audio-mixer-button \.pzp-button__tooltip \{\s*white-space: pre !important;/.test(mixerCss) &&
  /\.cheese-video-filter-button \.pzp-button__tooltip \{\s*white-space: pre !important;/.test(filterCss),
  "치지직 한 줄 툴팁을 덮어 둘째 줄을 보인다(white-space: pre !important)");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
