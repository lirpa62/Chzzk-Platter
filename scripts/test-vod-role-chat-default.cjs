// 다시보기 '방장·매니저·파트너 채팅'은 기본 꺼짐. 예전 키(cheeseVodRoleChatOn, 기본 켜짐)를
// 새 키(cheeseVodRoleChatEnabled)로 옮겨, 이미 켜 두었던 사람도 꺼진 상태로 시작한다.
// 예전 키는 폐지된 설정 정리에서 지운다(내보내기 파일에만 따라다니지 않게).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const content = read("src/content.js");
const settings = read("src/settings.js");
const html = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

check(/const ROLE_CHAT_ON_KEY = "cheeseVodRoleChatEnabled";/.test(content) &&
  /const VOD_ROLE_CHAT_KEY = "cheeseVodRoleChatEnabled";/.test(settings),
  "확장과 설정 화면이 같은 새 키를 쓴다");
check(/let vodRoleChatOn = false;/.test(content) &&
  /vodRoleChatOn = data\?\.\[ROLE_CHAT_ON_KEY\] === true;/.test(content) &&
  /vodRoleChatOn = changes\[ROLE_CHAT_ON_KEY\]\.newValue === true;/.test(content),
  "확장: 저장값이 true 일 때만 켠다(없으면 꺼짐)");
check(/let on = false;/.test(settings) && /on = data\?\.\[VOD_ROLE_CHAT_KEY\] === true;/.test(settings),
  "설정 화면: 저장값이 true 일 때만 켜진 스위치");
check(/그대로입니다\(기본 꺼짐\)/.test(html), "설정 설명이 '기본 꺼짐'");
check(/"cheeseVodRoleChatEnabled",/.test(settings) && !/"cheeseVodRoleChatOn",/.test(settings),
  "내보내기·미리 읽기 목록은 새 키만(예전 파일을 불러와도 다시 켜지지 않는다)");

// 예전 키는 정리하고 새 키는 남긴다(원본 함수를 그대로 돌린다).
const start = content.indexOf("  const RETIRED_CLICK_OPTION_KEYS = [");
const end = content.indexOf("  async function loadFeatureFlags()", start);
const store = { cheeseVodRoleChatOn: true, cheeseVodRoleChatEnabled: true, cheeseMixerBeginner: false };
const ctx = {
  chrome: { storage: { local: {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
    remove: async (keys) => { for (const k of keys) delete store[k]; },
  } } },
};
vm.runInNewContext(`${content.slice(start, end)}\nglobalThis.run = dropRetiredClickOptions;`, Object.assign(ctx, { globalThis: ctx }));
ctx.run().then(() => {
  check(!("cheeseVodRoleChatOn" in store) && store.cheeseVodRoleChatEnabled === true,
    "예전 키(켜짐)는 지우고, 새로 켠 값은 그대로 둔다");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
});
