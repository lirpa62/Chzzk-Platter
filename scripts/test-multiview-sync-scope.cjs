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

  // ⚠ 부동소수점 오차로 방향이 뒤집히면 안 된다. 다만 '표시값이 1.00× 인 경우'
  //   에만 기본이다 — 0.99 처럼 화면에 다르게 보이는 값은 방향이 있어야 한다.
  for (const near of [0.999999, 1.000001, 1, 0.9999, 1.0001]) {
    const out = at(near);
    assert.match(
      out.text,
      /재생 속도 1\.00×/,
      `${near} 의 표시가 1.00× 가 아니다`,
    );
    assert.match(
      out.text,
      /기본/,
      `표시가 1.00× 인데(${near}) 방향이 기본이 아니다`,
    );
  }

  // 엔진이 실제로 만드는 배속(±0.01/0.03/0.05)이 모두 방향을 갖는다.
  // ⚠ 예전에는 userRateEpsilon(0.02) 으로 판정해 0.99/1.01 이 '기본' 으로 떴다.
  //   같은 줄의 '자동 보정 중' 과 모순이었다.
  for (const [rate, want] of [
    [0.95, "느리게"],
    [0.97, "느리게"],
    [0.99, "느리게"],
    [1.01, "빠르게"],
    [1.03, "빠르게"],
    [1.05, "빠르게"],
  ]) {
    const out = at(rate, { syncRateOwned: true });
    assert.match(
      out.text,
      new RegExp(`재생 속도 ${rate.toFixed(2)}×`),
      `${rate} 의 표시 숫자가 다르다`,
    );
    assert.match(
      out.text,
      new RegExp(want),
      `${rate} 가 ${want} 로 표시되지 않는다`,
    );
    assert.doesNotMatch(out.text, /기본/, `${rate} 가 기본으로 표시된다`);
  }

  // 표시 숫자와 방향이 어긋나지 않는다(1.00× 인데 느리게 같은 모순 금지).
  for (const rate of [0.95, 0.99, 0.999999, 1, 1.000001, 1.01, 1.05]) {
    const out = at(rate);
    const shown = Number(out.text.match(/재생 속도 ([0-9.]+)×/)[1]);
    const dir = /느리게/.test(out.text)
      ? "느리게"
      : /빠르게/.test(out.text)
        ? "빠르게"
        : "기본";
    const expected = shown < 1 ? "느리게" : shown > 1 ? "빠르게" : "기본";
    assert.equal(
      dir,
      expected,
      `표시 ${shown}× 와 방향 '${dir}' 이 어긋난다(기대 '${expected}')`,
    );
  }

  // 엔진 출력과 UI 의미가 맞물리는지(정책을 복제하지 않고 실제 rateFor 를 쓴다).
  const SYNC_MOD = require("../src/multiviewSync.js");
  for (const [error, want] of [
    [3, "느리게"],
    [-3, "빠르게"],
  ]) {
    const engineRate = SYNC_MOD.rateFor(error, true);
    assert.notEqual(engineRate, 1, `rateFor(${error}) 가 배속을 만들지 않았다`);
    assert.match(
      at(engineRate, { syncRateOwned: true }).text,
      new RegExp(want),
      `rateFor(${error})=${engineRate} 가 ${want} 로 표시되지 않는다`,
    );
  }

  // userRateEpsilon 은 소유권 판정용으로 남아 있어야 한다(값 변경 금지).
  assert.equal(LIMITS.userRateEpsilon, 0.02, "userRateEpsilon 값이 바뀌었다");
  // ⚠ 주석에는 왜 안 쓰는지 적혀 있을 수 있다. 실제 코드 줄만 본다.
  const rateCode = sliceFn("syncRateText")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.doesNotMatch(
    rateCode,
    /userRateEpsilon/,
    "방향 판정에 다시 userRateEpsilon 을 쓴다",
  );
  assert.match(rateCode, /toFixed\(2\)/, "표시 숫자를 만들지 않는다");

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

// 8) 같은 자리 교체: 선택 여부만 물려받고 보정값·보류 명령은 남기지 않는다.
{
  // clearChannelSync 를 원본 그대로 돌린다(교체·제거가 모두 이 경로를 쓴다).
  const calls = { resetRate: [], cancel: [] };
  const state = {
    chosen: [{ channelId: "a" }, { channelId: "b" }, { channelId: "c" }],
    sync: {
      scope: "selected",
      selectedChannelIds: ["a", "b"],
      manualOffsets: { a: 0, b: 1.2 },
      referenceChannelId: "b",
    },
  };
  const maps = {
    syncStats: new Map([["b", {}]]),
    syncReadyAt: new Map([["b", 1]]),
    syncGeneration: new Map([["b", 1]]),
    syncSeekAt: new Map([["b", 1]]),
    syncRetryAt: new Map([["b:seek", 1]]),
    syncRates: new Map([["b", 0.97]]),
  };
  const body = sliceFn("clearChannelSync") + "\nreturn clearChannelSync;";
  // eslint-disable-next-line no-new-func
  const clearChannelSync = new Function(
    "state",
    "resetSyncRate",
    "cancelPendingSync",
    "syncStats",
    "syncReadyAt",
    "syncGeneration",
    "syncSeekAt",
    "syncRetryAt",
    "syncRates",
    body,
  )(
    state,
    (id) => calls.resetRate.push(id),
    (id) => calls.cancel.push(id),
    maps.syncStats,
    maps.syncReadyAt,
    maps.syncGeneration,
    maps.syncSeekAt,
    maps.syncRetryAt,
    maps.syncRates,
  );

  // replaceChannel 이 교체 직전에 하는 판정(원본과 같은 식).
  const inheritSelected =
    state.sync.selectedChannelIds.includes("b") &&
    state.sync.scope === "selected";
  assert.equal(
    inheritSelected,
    true,
    "선택된 채널의 교체를 계승 대상으로 보지 않는다",
  );

  clearChannelSync("b", true);

  // 옛 채널의 흔적이 남지 않는다.
  assert.deepEqual(calls.resetRate, ["b"], "옛 채널의 속도를 되돌리지 않았다");
  assert.deepEqual(calls.cancel, ["b"], "옛 채널의 보류 명령을 버리지 않았다");
  assert.equal(maps.syncRates.has("b"), false, "syncRates 에 옛 채널이 남았다");
  assert.equal(maps.syncStats.has("b"), false, "syncStats 에 옛 채널이 남았다");
  assert.equal(
    state.sync.selectedChannelIds.includes("b"),
    false,
    "선택 목록에 옛 채널이 남았다",
  );
  assert.equal(
    "b" in state.sync.manualOffsets,
    false,
    "옛 채널의 보정값이 남았다(새 방송에 물려주면 안 된다)",
  );
  assert.equal(
    state.sync.referenceChannelId,
    null,
    "옛 채널이 기준으로 남았다",
  );

  // 새 채널이 같은 자리에 들어오고 선택 상태만 계승한다.
  state.chosen = state.chosen.map((c) =>
    c.channelId === "b" ? { channelId: "d" } : c,
  );
  if (inheritSelected && !state.sync.selectedChannelIds.includes("d")) {
    state.sync.selectedChannelIds = [...state.sync.selectedChannelIds, "d"];
  }
  assert.deepEqual(
    state.chosen.map((c) => c.channelId),
    ["a", "d", "c"],
    "새 채널이 같은 자리에 들어오지 않았다",
  );
  assert.equal(
    state.sync.selectedChannelIds.includes("d"),
    true,
    "새 채널이 선택 상태를 물려받지 못했다",
  );
  assert.equal(
    state.sync.manualOffsets.d ?? 0,
    0,
    "새 채널의 보정값이 0 이 아니다",
  );
  assert.equal(
    state.sync.referenceChannelId,
    null,
    "stats 준비 전에 새 채널을 기준으로 지정했다",
  );

  // 미선택 채널을 교체하면 새 채널도 미선택이다.
  const inheritOff =
    state.sync.selectedChannelIds.includes("c") &&
    state.sync.scope === "selected";
  assert.equal(inheritOff, false, "미선택 채널이 계승 대상으로 잡혔다");

  // 소스: 교체가 실제로 이 판정과 정리를 쓴다.
  const replaceFn = sliceFn("replaceChannel");
  assert.match(
    replaceFn,
    /clearChannelSync\(oldChannelId, true\)/,
    "교체가 옛 채널의 보정값을 지우지 않는다",
  );
  assert.match(
    replaceFn,
    /inSyncScope\(oldChannelId\)/,
    "교체가 선택 여부를 보지 않는다",
  );
  assert.doesNotMatch(
    replaceFn,
    /manualOffsets\[id\] =/,
    "교체가 새 채널에 보정값을 물려준다",
  );
}

// 9) 그룹 부족으로 자동 싱크를 끝낼 때 혼잡 상태를 즉시 비운다.
{
  const SYNC_MOD = require("../src/multiviewSync.js");
  const calls = { reset: 0, cancel: [], polling: 0, diag: [] };
  const state = {
    chosen: [{ channelId: "a" }, { channelId: "b" }],
    sync: {
      mode: "auto",
      scope: "selected",
      selectedChannelIds: ["a"], // 이미 1개로 줄어든 상태
      congested: true,
    },
  };
  // ⚠ 혼잡에 막 들어간 직후(since=0)가 문제다. 이때 빈 그룹으로 한 번 부르면
  //   SYNC.congestion 은 since 만 잡고 active 를 유지한다(5초 hysteresis).
  const box = { syncCongestion: { active: true, since: 0 }, syncNotice: "" };

  // 원본 함수를 그대로 쓰되, 모듈 스코프 변수만 box 로 바꿔 관찰한다.
  const src =
    sliceFn("syncScopeIds") +
    sliceFn("syncGroupTooSmall") +
    sliceFn("stopAutoSyncIfGroupTooSmall");
  const wired = src
    .replace(/\bsyncCongestion\b/g, "box.syncCongestion")
    .replace(/\bsyncNotice\b/g, "box.syncNotice");
  // eslint-disable-next-line no-new-func
  const stop = new Function(
    "state",
    "SYNC",
    "box",
    "resetAllSyncRates",
    "cancelPendingSync",
    "recordCongestionChange",
    "updateSyncPolling",
    wired + "\nreturn stopAutoSyncIfGroupTooSmall;",
  )(
    state,
    SYNC_MOD,
    box,
    () => {
      calls.reset += 1;
    },
    (id) => calls.cancel.push(id),
    (active) => calls.diag.push(active),
    () => {
      calls.polling += 1;
    },
  );

  const stopped = stop();
  assert.equal(stopped, true, "그룹이 1개인데 자동 싱크를 끝내지 않았다");
  assert.equal(state.sync.mode, "off", "자동 싱크가 꺼지지 않았다");
  assert.equal(state.sync.congested, false, "표시용 혼잡 상태가 남았다");
  assert.equal(box.syncCongestion.active, false, "내부 혼잡 상태가 남았다");
  assert.equal(
    box.syncCongestion.since,
    0,
    "혼잡 since 가 남았다(다음 세션에 샌다)",
  );
  assert.equal(calls.reset, 1, "속도를 되돌리지 않았다");
  assert.deepEqual(calls.cancel, ["a", "b"], "보류 명령을 버리지 않았다");
  assert.deepEqual(
    calls.diag,
    [false],
    "혼잡 해제를 진단에 한 번만 기록해야 한다",
  );
  assert.match(box.syncNotice, /2개 이상/, "안내 문구가 없다");

  // 재진입: 이전 세션의 혼잡이 새 세션을 막지 않는다.
  const fresh = SYNC_MOD.congestion(
    box.syncCongestion,
    new Map(),
    ["a", "b"],
    50000,
  );
  assert.equal(fresh.active, false, "이전 혼잡이 새 세션으로 이어졌다");
}

// 10) 일반 혼잡 해제의 hysteresis 는 그대로다(직접 초기화가 정책을 바꾸지 않는다).
{
  const SYNC_MOD = require("../src/multiviewSync.js");
  assert.equal(
    SYNC_MOD.LIMITS.congestionExitMs,
    5000,
    "혼잡 해제 기준이 바뀌었다",
  );
  // 혼잡 직후에는 한 번 불러도 풀리지 않는다.
  const step1 = SYNC_MOD.congestion(
    { active: true, since: 0 },
    new Map(),
    [],
    10000,
  );
  assert.equal(
    step1.active,
    true,
    "일반 경로에서 혼잡이 즉시 풀렸다(정책 변경)",
  );
  // 5초가 지나야 풀린다.
  const step2 = SYNC_MOD.congestion(step1, new Map(), [], 15000);
  assert.equal(step2.active, false, "5초 뒤에도 혼잡이 안 풀린다");
}

console.log("  PASS 멀티뷰 싱크 범위(전체/선택) 계산과 정리");
console.log("  PASS 재생 속도 표시(느리게/기본/빠르게)와 시간 보정 구분");
console.log("  PASS 같은 자리 교체의 선택 계승과 보정값 초기화");
