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
  assert.match(tick, /syncGroupTooSmall\(\)/, "최소 채널 처리가 없다");
  assert.match(tick, /state\.sync\.mode = "off";/, "자동 싱크를 끄지 않는다");

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

console.log("  PASS 멀티뷰 싱크 범위(전체/선택) 계산과 정리");
