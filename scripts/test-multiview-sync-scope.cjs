// 싱크 범위(전체/선택)에서 '보정 대상' 이 실제로 좁혀지는지.
//
// 브라우저 픽스처로는 자동 보정 중인 채널을 만들기가 까다로워(자동 모드가
// 아니면 들어온 syncRateOwned 를 즉시 해제한다), 여기서는 watch 레이어의
// 실제 함수 본문을 떼어 와 런타임 값을 직접 넣고 돌린다.
//
// ⚠ 로직을 손으로 베끼지 않는다. 원본에서 추출해 실행한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "multiviewWatch.js"),
  "utf8",
);

function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

const PIECES = [
  sliceFn("syncScopeIds"),
  sliceFn("inSyncScope"),
  sliceFn("syncActiveIds"),
  sliceFn("syncGroupTooSmall"),
  sliceFn("releaseSyncOwnership"),
].join("\n");

// 구조만 확인한다(내용을 보면 규칙이 느슨해졌을 때 검사 전에 throw 된다).
assert.match(
  PIECES,
  /selectedChannelIds/,
  "떼어 낸 구간이 범위 계산부가 아니다",
);

function build({ scope = "all", selected = [], chosen, eligible }) {
  const calls = { resetRate: [], cancel: [] };
  const state = {
    chosen: chosen.map((id) => ({ channelId: id })),
    sync: { scope, selectedChannelIds: [...selected] },
  };
  const body =
    PIECES +
    "\nreturn { syncScopeIds, inSyncScope, syncActiveIds, syncGroupTooSmall," +
    " releaseSyncOwnership };";
  // eslint-disable-next-line no-new-func
  const api = new Function(
    "state",
    "syncEligibleIds",
    "resetSyncRate",
    "cancelPendingSync",
    body,
  )(
    state,
    () => eligible,
    (id) => calls.resetRate.push(id),
    (id) => calls.cancel.push(id),
  );
  return { api, state, calls };
}

const ALL = ["a", "b", "c", "d"];

// 1) 기본(전체)은 지금까지와 같다.
{
  const { api } = build({ chosen: ALL, eligible: ALL });
  assert.deepEqual(api.syncScopeIds(), ALL, "전체 범위가 전체 채널이 아니다");
  assert.deepEqual(api.syncActiveIds(), ALL, "전체 범위의 보정 대상이 다르다");
  assert.equal(api.inSyncScope("c"), true);
  assert.equal(
    api.syncGroupTooSmall(),
    false,
    "전체 범위는 최소 채널 제한이 없다",
  );
}

// 2) 선택 범위는 고른 채널만 남긴다.
{
  const { api } = build({
    scope: "selected",
    selected: ["a", "b"],
    chosen: ALL,
    eligible: ALL,
  });
  assert.deepEqual(
    api.syncScopeIds(),
    ["a", "b"],
    "선택 범위가 좁혀지지 않았다",
  );
  assert.deepEqual(
    api.syncActiveIds(),
    ["a", "b"],
    "보정 대상이 좁혀지지 않았다",
  );
  assert.equal(api.inSyncScope("c"), false, "제외 채널이 범위 안으로 들어왔다");
  assert.equal(api.inSyncScope("a"), true);
}

// 3) 범위 ∩ eligible: 측정 불가 채널은 보정 대상에서 빠진다.
{
  const { api } = build({
    scope: "selected",
    selected: ["a", "b", "c"],
    chosen: ALL,
    eligible: ["a", "c"], // b 는 아직 측정 불가
  });
  assert.deepEqual(api.syncActiveIds(), ["a", "c"], "eligible 교집합이 아니다");
  // 범위 자체에는 b 가 남아 있어야 한다(체크는 되어 있다).
  assert.deepEqual(api.syncScopeIds(), ["a", "b", "c"]);
}

// 4) 선택이 없거나 하나뿐이면 그룹이 성립하지 않는다.
{
  for (const selected of [[], ["a"]]) {
    const { api } = build({
      scope: "selected",
      selected,
      chosen: ALL,
      eligible: ALL,
    });
    assert.equal(
      api.syncGroupTooSmall(),
      true,
      `선택 ${selected.length}개인데 그룹이 성립한다고 본다`,
    );
  }
  const { api } = build({
    scope: "selected",
    selected: ["a", "b"],
    chosen: ALL,
    eligible: ALL,
  });
  assert.equal(api.syncGroupTooSmall(), false, "2개면 그룹이 성립해야 한다");
}

// 5) 범위에서 빠진 채널은 속도 소유권과 보류 명령을 놓는다.
//    ⚠ 이게 없으면 사용자가 뺀 채널이 0.97x 로 남는다.
{
  const { api, calls } = build({
    scope: "selected",
    selected: ["a", "b"],
    chosen: ALL,
    eligible: ALL,
  });
  api.releaseSyncOwnership(["c", "d"]);
  assert.deepEqual(
    calls.resetRate,
    ["c", "d"],
    "뺀 채널의 속도를 되돌리지 않았다",
  );
  assert.deepEqual(
    calls.cancel,
    ["c", "d"],
    "뺀 채널의 보류 명령을 버리지 않았다",
  );
}

// 6) 소스 확인: 자동 보정 루프와 혼잡 판정이 범위를 본다.
{
  const tick = sliceFn("syncTick");
  assert.match(
    tick,
    /if \(!inSyncScope\(id\)\) \{\s*\n\s*resetSyncRate\(id\);/,
    "자동 보정 루프가 범위 밖 채널의 속도를 놓지 않는다",
  );
  // 혼잡 판정에 쓰는 목록이 범위 기준이어야 한다.
  assert.match(
    tick,
    /const settledIds = syncActiveIds\(now, true\);/,
    "혼잡 판정이 범위를 보지 않는다(제외 채널 때문에 그룹이 멈출 수 있다)",
  );
  assert.doesNotMatch(
    tick,
    /const settledIds = syncEligibleIds\(now, true\);/,
    "혼잡 판정이 전체 eligible 기준으로 남아 있다",
  );
  // 최소 2채널이면 자동 싱크를 실제로 끈다(UI 만 막지 않는다).
  // ⚠ 종료 로직은 공용 helper 로 모았다. tick 은 그 helper 를 부른다.
  assert.match(
    tick,
    /stopAutoSyncIfGroupTooSmall\(\)/,
    "tick 이 최소 채널 종료를 호출하지 않는다",
  );
  const stopFn = sliceFn("stopAutoSyncIfGroupTooSmall");
  assert.match(stopFn, /syncGroupTooSmall\(\)/, "최소 채널 판정이 없다");
  assert.match(stopFn, /state\.sync\.mode = "off";/, "자동 싱크를 끄지 않는다");
  assert.match(stopFn, /resetAllSyncRates\(\)/, "속도를 되돌리지 않는다");
  assert.match(stopFn, /cancelPendingSync/, "보류 명령을 버리지 않는다");
  // ⚠ 판정 기준이 '고른 수' 여야 한다. activeIds(=eligible 교집합) 로 바꾸면
  //   한 채널이 잠시 stale 인 것만으로 자동 싱크가 꺼진다.
  const tooSmall = sliceFn("syncGroupTooSmall");
  assert.match(
    tooSmall,
    /syncScopeIds\(\)\.length < 2/,
    "판정이 선택 수 기준이 아니다",
  );
  assert.doesNotMatch(
    tooSmall,
    /syncActiveIds/,
    "판정이 eligible 기준으로 바뀌었다(일시적 stale 로 자동이 꺼진다)",
  );
  // 선택/범위 변경 직후에도 즉시 끝낸다(다음 tick 을 기다리지 않는다).
  for (const name of ["setSyncSelected", "setSyncScope"]) {
    assert.match(
      sliceFn(name),
      /stopAutoSyncIfGroupTooSmall\(\)/,
      `${name} 이 즉시 종료를 부르지 않는다`,
    );
  }

  // 기준은 범위 안에서 고른다.
  const ref = sliceFn("selectSyncReference");
  assert.match(
    ref,
    /const ids = syncActiveIds\(now\);/,
    "기준 후보가 범위가 아니다",
  );
  // 보정값 rebase 는 전체 채널을 대상으로 한다(상대 기준 보존).
  assert.match(
    ref,
    /SYNC\.rebaseOffsets\([\s\S]{0,120}state\.chosen\.map/,
    "rebase 대상이 전체 채널이 아니다",
  );

  // 선택 해제 시 기준을 놓는다.
  const setSel = sliceFn("setSyncSelected");
  assert.match(
    setSel,
    /releaseSyncOwnership\(\[channelId\]\)/,
    "소유권을 놓지 않는다",
  );
  assert.match(
    setSel,
    /state\.sync\.referenceChannelId = null;/,
    "뺀 채널이 기준으로 남는다",
  );

  // 측정은 범위와 무관하게 계속한다.
  const stats = sliceFn("requestSyncStats");
  assert.doesNotMatch(
    stats,
    /inSyncScope|syncScopeIds|syncActiveIds/,
    "측정까지 범위로 좁혔다(제외 채널의 지연을 못 본다)",
  );
}

// 7) 재생 속도 표시: 0.97× 는 '느리게 재생 중' 이라는 뜻이다.
{
  const LIMITS = require("../src/multiviewSync.js").LIMITS;
  // eslint-disable-next-line no-new-func
  const rateText = new Function(
    "SYNC",
    sliceFn("syncRateText") + "\nreturn syncRateText;",
  )({ LIMITS });

  const at = (playbackRate, extra = {}) =>
    rateText({
      playbackRate,
      syncRateOwned: false,
      userRateOverride: false,
      ...extra,
    });

  // 자동 보정으로 느리게
  const slow = at(0.97, { syncRateOwned: true });
  assert.match(slow.text, /재생 속도 0\.97×/, "배속 값이 없다");
  assert.match(slow.text, /느리게/, "0.97× 를 느리게로 표시하지 않는다");
  assert.doesNotMatch(slow.text, /빠르게/, "0.97× 를 빠르게로 표시한다");
  assert.match(slow.hint, /자동 싱크/, "자동 보정임을 설명하지 않는다");

  // 기본 속도
  const base = at(1);
  assert.match(base.text, /재생 속도 1\.00×/);
  assert.match(base.text, /기본/, "1.00× 를 기본으로 표시하지 않는다");

  // 자동 보정으로 빠르게
  const fast = at(1.03, { syncRateOwned: true });
  assert.match(fast.text, /재생 속도 1\.03×/);
  assert.match(fast.text, /빠르게/, "1.03× 를 빠르게로 표시하지 않는다");
  assert.doesNotMatch(fast.text, /느리게/, "1.03× 를 느리게로 표시한다");

  // 사용자가 직접 바꾼 배속은 '자동 보정' 으로 설명하지 않는다.
  const manual = at(1.25, { userRateOverride: true });
  assert.match(manual.text, /빠르게/, "수동 배속도 방향은 보여 줘야 한다");
  assert.doesNotMatch(
    manual.hint,
    /자동 싱크/,
    "수동 배속을 자동 보정으로 설명한다",
  );

  // 값이 없을 때
  assert.equal(at(null).text, "재생 속도 -", "값이 없을 때 표시가 다르다");
  assert.equal(at(undefined).text, "재생 속도 -");

  // ⚠ 부동소수점 오차로 방향이 뒤집히면 안 된다.
  for (const near of [0.999999, 1.000001, 1 - LIMITS.userRateEpsilon / 2]) {
    assert.match(
      at(near).text,
      /기본/,
      `1× 근처(${near})가 느리게/빠르게로 표시된다`,
    );
  }

  // 색·화살표만으로 방향을 표현하지 않는다(글자가 반드시 있다).
  for (const r of [0.95, 1.05]) {
    assert.match(at(r).text, /(느리게|빠르게)/, "방향 글자가 없다");
  }

  // 소스: 시간 보정 output 과 재생 속도를 구분해 설명한다.
  const render = SRC.slice(SRC.indexOf("function renderSync"));
  assert.match(
    render,
    /시간 위치 보정/,
    "시간 보정 값에 의미 설명이 없다(재생 속도와 혼동된다)",
  );
  assert.match(
    render,
    /재생 속도는 현재 영상의 배속입니다/,
    "안내 문구가 없다",
  );
}

console.log("  PASS 멀티뷰 싱크 범위(전체/선택) 계산과 정리");
console.log("  PASS 재생 속도 표시(느리게/기본/빠르게)와 시간 보정 구분");
