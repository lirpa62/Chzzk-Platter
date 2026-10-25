// 다시보기 '플레이어 포커스 없이 방향키 이동' 은 '되감기·앞으로 버튼' 의 하위 옵션이다.
//
// 상위를 끄면 설정 화면에선 하위가 잠기지만 저장값은 켜진 채 남는다. 방향키 처리가 하위 값만 봐서
// 상위를 꺼도 포커스 없이 방향키 이동이 계속 동작했다. 이제 둘 다 켜져 있어야 동작한다.
// audioMixer.js 의 seekHotkeyAllowed 를 떼어 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mixer = fs.readFileSync(path.join(__dirname, "..", "src/audioMixer.js"), "utf8");
const settingsUi = fs.readFileSync(path.join(__dirname, "..", "src/settingsUi.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = mixer.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return mixer.slice(at, mixer.indexOf("\n  }\n", at) + 4);
};

check(settingsUi.includes(`['[data-feature="vodSeekButtons"]', '[data-feature="vodGlobalArrowSeek"]']`),
  "설정 화면: '플레이어 포커스 없이 방향키 이동' 은 '되감기·앞으로 버튼' 의 하위 옵션");

const ctx = vm.createContext({ Element: class {} });
vm.runInContext(`
  const featureFlags = { vodSeekButtons: false, vodGlobalArrowSeek: false, liveRewind: false };
  let liveSeekBarOn = false;
  const isLiveSeekPage = () => false;
  const isVodSeekPage = () => true;
  const isTypingTarget = () => false;
  const isArrowConsumingTarget = () => false;
  const findPlayer = () => ({});
  const document = { activeElement: null };
  ${sliceFn("seekHotkeyAllowed")}
  this.allowed = (buttons, global) => {
    featureFlags.vodSeekButtons = buttons;
    featureFlags.vodGlobalArrowSeek = global;
    return seekHotkeyAllowed({ target: null });
  };
`, ctx);

check(ctx.allowed(true, true) === true, "버튼 켬 + 포커스 없이 이동 켬: 동작");
check(ctx.allowed(false, true) === false, "버튼 끔 + 포커스 없이 이동 켬(잠긴 저장값): 동작하지 않는다");
check(ctx.allowed(true, false) === false, "버튼 켬 + 포커스 없이 이동 끔: 동작하지 않는다(치지직 기본 방향키만)");
check(ctx.allowed(false, false) === false, "둘 다 끔: 동작하지 않는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
