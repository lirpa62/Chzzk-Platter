const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/audioMixer.js"), "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
const start = source.indexOf("  const multiviewMixerIsVideo =");
const end = source.indexOf("\n  }\n", start);
assert.ok(start > 0 && end > start, "준비 판정 구간을 찾지 못했다");
const readySource = source.slice(start, end + 4);

// 칸 id·설정 키·로드 상태를 바꿔 가며 원본 판정을 돌린다.
function ready({ slot, mediaId, loaded }) {
  const ctx = { multiviewMixerChannelId: slot, currentMediaId: mediaId, stateLoaded: loaded };
  vm.runInNewContext(`${readySource}\nglobalThis.result = multiviewMixerReady();`,
    Object.assign(ctx, { globalThis: ctx }));
  return ctx.result;
}
const LIVE = "a".repeat(32);
const OWNER = "b".repeat(32);
check(ready({ slot: LIVE, mediaId: LIVE, loaded: true }) === true, "라이브 칸: 자기 채널 설정을 불러오면 준비됨");
check(ready({ slot: LIVE, mediaId: OWNER, loaded: true }) === false, "라이브 칸: 다른 채널 설정이면 준비 안 됨(이전 판정 유지)");
check(ready({ slot: LIVE, mediaId: LIVE, loaded: false }) === false, "라이브 칸: 불러오는 중이면 준비 안 됨");
check(ready({ slot: "video:123", mediaId: OWNER, loaded: true }) === true,
  "다시보기 칸: 칸 id(video:번호)와 설정 키(채널 id)가 달라도 불러오면 준비됨");
check(ready({ slot: "video:123", mediaId: null, loaded: true }) === true,
  "다시보기 칸: 채널 id 를 못 얻어 기본 설정으로 동작해도 준비됨");
check(ready({ slot: "video:123", mediaId: OWNER, loaded: false }) === false,
  "다시보기 칸: 불러오는 중이면 준비 안 됨");

// 칸 id: 믹서도 다시보기 칸을 'video:<번호>' 로 알아야 상태를 보내고 명령을 받는다.
{
  // 칸 설정 읽기(iframe 이름 → 예전 방식 주소 쿼리) 함수부터 함께 떼어 온다.
  const slotStart = source.indexOf("  // 멀티뷰 칸 설정. 치지직 페이지 위 멀티뷰는");
  const slotEnd = source.indexOf("  const multiviewQualityChannelId = multiviewSlotId;");
  assert.ok(slotStart > 0 && slotEnd > slotStart, "칸 id 계산 구간을 찾지 못했다");
  const slotSource = source.slice(slotStart, slotEnd);
  const slotFor = (pathname, search, name = "") => {
    const location = { pathname, search };
    const ctx = { location, URLSearchParams, window: { location, name, top: {},
      sessionStorage: { getItem: () => null } } };
    vm.runInNewContext(`${slotSource}\nglobalThis.result = multiviewMixerChannelId;`,
      Object.assign(ctx, { globalThis: ctx }));
    return ctx.result;
  };
  check(slotFor(`/live/${LIVE}`, "?cheeseMulti=1") === LIVE, "라이브 칸: 믹서 칸 id 는 채널 id");
  check(slotFor("/video/123", "?cheeseMulti=1&cheeseMultiChannelId=video:123") === "video:123",
    "다시보기 칸: 믹서 칸 id 는 video:번호(예전에는 빈 값이라 상태를 보내지 않았다)");
  check(slotFor("/video/123", "?cheeseMulti=1&cheeseMultiChannelId=video:999") === "",
    "다시보기 칸: 주소와 다른 칸 id 는 받지 않는다");
  check(slotFor(`/live/${LIVE}`, "") === "", "멀티뷰 칸이 아니면 비운다");
  check(slotFor("/video/123", "", "cheese-multiview:" + JSON.stringify({
    cheeseMulti: "1", cheeseMultiChannelId: "video:123",
  })) === "video:123", "칸 설정을 iframe 이름으로 받아도 같은 칸 id 를 쓴다");
  check(/const multiviewMixerChannelId = multiviewSlotId;/.test(source) &&
    /const multiviewQualityChannelId = multiviewSlotId;/.test(source),
    "믹서와 화질이 같은 칸 id 를 쓴다");
}

// 다시보기 칸은 채널 id(믹서 설정 키)를 주소로 받아 영상 API 를 기다리지 않는다.
{
  const watch = fs.readFileSync(path.join(__dirname, "..", "src/multiviewWatch.js"), "utf8");
  check(/if \(HASH_RE\.test\(String\(channel\.ownerChannelId \|\| ""\)\)\)\s*url\.searchParams\.set\("cheeseMultiOwnerChannelId", channel\.ownerChannelId\);/.test(watch),
    "부모: 다시보기 칸 주소에 채널 id 를 넘긴다(검증된 값만)");
  const start = source.indexOf("  async function resolveChannelId(pageKey) {");
  const end = source.indexOf("\n  }\n", start);
  const resolveSource = source.slice(start, end + 4);
  const resolve = async (pageKey, search, slot) => {
    const calls = [];
    const ctx = {
      location: { search }, URLSearchParams, multiviewSlotId: slot,
      multiviewFrameParams: () => new URLSearchParams(search),
      videoChannelCache: new Map(),
      fetchChannelIdFromApi: async (no) => { calls.push(no); return "c".repeat(32); },
    };
    vm.runInNewContext(`${resolveSource}\nglobalThis.run = resolveChannelId;`,
      Object.assign(ctx, { globalThis: ctx }));
    return { id: await ctx.run(pageKey), calls };
  };
  return (async () => {
    let r = await resolve("video:123", `?cheeseMulti=1&cheeseMultiChannelId=video:123&cheeseMultiOwnerChannelId=${OWNER}`, "video:123");
    check(r.id === OWNER && r.calls.length === 0, "믹서: 주소의 채널 id 를 바로 쓰고 영상 API 를 부르지 않는다");
    r = await resolve("video:123", "?cheeseMulti=1&cheeseMultiChannelId=video:123", "video:123");
    check(r.id === "c".repeat(32) && r.calls.length === 1, "믹서: 채널 id 가 없으면 예전처럼 영상 API 로 알아낸다");
    r = await resolve("video:123", "?cheeseMultiOwnerChannelId=" + OWNER, "");
    check(r.calls.length === 1, "믹서: 멀티뷰 칸이 아니면 주소 값을 믿지 않는다");
    finish();
  })();
}
function finish() {
check(/ready: multiviewMixerReady\(\),/.test(source) &&
  /if \(!multiviewMixerReady\(\)\) reason = "not-ready";/.test(source) &&
  !/currentMediaId === multiviewMixerChannelId,/.test(source.replace(readySource, "")),
  "상태 보고와 조작 명령이 같은 판정을 쓴다(다시보기 칸 조작도 받는다)");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
}
