// 새 설치에서만 꺼짐으로 시작하는 옵션(기존 이용자는 그대로):
//   수신함 통나무파워 표시, 통나무파워 지우개, 헤더 바로가기 4개(전체 방송·인기 클립·카테고리·팔로잉).
// 코드의 미설정 기본값(켜짐)은 그대로 두고, 설치 시점에만 꺼짐 값을 저장한다.
// 함께: 채팅 버튼 줄바꿈은 채팅창 너비 조절의 하위, 다시보기·클립 검색은 '표시' 스위치.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const background = read("src/background.js");
const content = read("src/content.js");
const html = read("settings.html");
const settingsUi = read("src/settingsUi.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const start = background.indexOf("const LIVE_SEEK_BUTTONS_HIDDEN_ONCE_KEY =");
const end = background.indexOf("async function clearLegacyChatHistory()", start);
function make(initial) {
  const store = structuredClone(initial);
  const ctx = {
    console,
    chrome: { storage: { local: {
      get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
      set: async (value) => Object.assign(store, structuredClone(value)),
    } } },
  };
  vm.runInNewContext(`${background.slice(start, end)}\nglobalThis.run = applyFreshInstallDefaults;`, Object.assign(ctx, { globalThis: ctx }));
  return { store, run: ctx.run };
}

(async () => {
  {
    const { store, run } = make({});
    await run();
    check(store.cheeseFeatureHidden.inboxLogPower === true, "새 설치: 수신함 통나무파워 표시 꺼짐(숨김 플래그 true)");
    check(store.cheeseLogPowerEraser === false, "새 설치: 통나무파워 지우개 꺼짐");
    check(["hdrLives", "hdrClips", "hdrCategory", "hdrFollowing"].every((k) => store.cheeseHeaderNav[k] === false),
      "새 설치: 헤더 바로가기 전체 방송·인기 클립·카테고리·팔로잉 꺼짐");
  }
  {
    // 이미 값이 있으면(설정 불러오기 등) 그대로 둔다. 다른 기능 플래그도 보존한다.
    const { store, run } = make({
      cheeseFeatureHidden: { inboxLogPower: false, sidebar: true },
      cheeseLogPowerEraser: true,
      cheeseHeaderNav: { hdrLives: true, hdrSchedule: true },
    });
    await run();
    check(store.cheeseFeatureHidden.inboxLogPower === false && store.cheeseFeatureHidden.sidebar === true &&
      store.cheeseLogPowerEraser === true && store.cheeseHeaderNav.hdrLives === true &&
      store.cheeseHeaderNav.hdrSchedule === true && store.cheeseHeaderNav.hdrClips === false,
      "이미 저장된 값은 건드리지 않고 비어 있는 것만 채운다");
  }
  check(/if \(details\.reason === "install"\) \{\s*try \{\s*await applyFreshInstallDefaults\(\);/.test(background),
    "설치(install)일 때만 실행한다 — 업데이트한 기존 이용자는 그대로");
  // 기존 이용자를 위해 코드의 미설정 기본값은 켜짐을 유지한다.
  check(/inboxLogPower: false,/.test(content) && !/"inboxLogPower",/.test(content.slice(content.indexOf("const FEATURE_DEFAULT_TRUE"), content.indexOf("const FEATURE_FLAGS_MESSAGE"))),
    "코드 기본값: 수신함 통나무파워는 여전히 표시(저장값 없는 기존 이용자)");
  check(/on = d\?\.\[LOG_ERASER_KEY\] !== false;/.test(read("src/settings.js")) && /cheeseLogPowerEraser/.test(read("src/logPowerEraser.js")),
    "코드 기본값: 통나무파워 지우개는 여전히 켜짐(저장값 없는 기존 이용자)");

  // 채팅 버튼 줄바꿈: 채팅창 너비 조절 바로 아래 하위 옵션(잠금·검색 경로 포함).
  const widthRow = html.indexOf('data-feature="chatWidthResize"');
  const wrapRow = html.indexOf("data-chat-button-wrap");
  check(wrapRow > widthRow && html.slice(widthRow, wrapRow).includes("└ 채팅 버튼 줄바꿈") &&
    !html.slice(widthRow + 1, wrapRow).includes("data-feature=\""),
    "채팅 버튼 줄바꿈은 채팅창 너비 조절 바로 아래 '└' 하위 옵션");
  check(/\['\[data-feature="chatWidthResize"\]', "\[data-chat-button-wrap\]"\]/.test(settingsUi),
    "채팅 버튼 줄바꿈의 부모를 채팅창 너비 조절로 등록(꺼지면 잠금)");

  // 검색 화면: 다른 버튼처럼 '표시' 스위치(저장은 숨김 플래그 그대로, 화면만 반전).
  for (const [key, label] of [["searchVideos", "다시보기 검색 표시"], ["searchClips", "클립 검색 표시"]]) {
    const at = html.indexOf(`data-feature="${key}"`);
    check(html.slice(at - 600, at).includes(`>${label}</span`) && /^data-feature="\w+"\s+data-feature-inverted/.test(html.slice(at)),
      `${label}: '표시' 이름 + 반전 스위치(예전 이름은 검색 별칭)`);
  }
  check(!/>다시보기 검색 숨김<|>클립 검색 숨김</.test(html), "'숨김' 이름은 화면에 남지 않는다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
