// 전역 기본 프리셋이 '기본' 으로 시작하던 load race.
//
// 증상: 전역 기본 프리셋을 '저챗·라디오'(voice)로 켜 뒀는데 대부분의 채널이
//       '기본'(default)으로 시작했다.
//
// 원인(실행으로 재현): saveState 가 함수 첫 줄에서 조건 없이
//   pendingUserEdit / userEditedDuringLoad 를 세웠다. 그런데 저장은 사용자
//   조작이 아닌 경로에서도 불린다. 특히 EQ 대역을 'ISO' 로 쓰는 사람은 페이지가
//   뜰 때마다 설정 동기화로 applyEqBandMode() 가 참을 돌려주고 saveState() 가
//   따라 불린다. 그러면
//     채널 resolve 전 저장 → pendingUserEdit=true
//     → resolve 직후 강제 저장 → userEditedDuringLoad=true
//     → load 응답에서 locallyEditedState 가 만들어짐
//     → applyConfiguredGlobalDefaults() 가 통째로 건너뛰어짐
//   결과적으로 손댄 적 없는 채널이 DEFAULT_STATE(기본)로 남는다.
//
// ⚠ 이 버그는 '이벤트 순서' 가 핵심이라 판정 함수 하나만 떼어 보면 잡히지 않는다.
//   아래는 실제 saveState 본문을 원본에서 떼어 와 순서대로 돌린다.

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "audioMixer.js"),
  "utf8",
);

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

// saveState 의 판정 부분을 원본 그대로 떼어 온다(패킷을 만들기 직전까지).
// ⚠ 여기 규칙을 손으로 베껴 두면 원본이 바뀌어도 통과한다.
function saveStateHead() {
  const at = SRC.indexOf("  function saveState(opts) {");
  if (at < 0) throw Error("saveState 를 찾지 못했다");
  const end = SRC.indexOf("    const packet = {", at);
  if (end < at) throw Error("saveState 판정 구간을 찾지 못했다");
  const head = SRC.slice(at, end);
  if (!/userEditedDuringLoad/.test(head) || !/pendingUserEdit/.test(head)) {
    throw Error("떼어 낸 구간이 판정부가 아니다");
  }
  return head;
}

// 런타임 변수를 밖에서 들고 순서를 재현한다.
function createRuntime() {
  const ctx = {
    currentMediaId: null,
    stateLoaded: false,
    pendingUserEdit: false,
    userEditedDuringLoad: false,
    nextSaveIsUserEdit: false,
    mixerBaseSource: "default",
    userDisabled: false,
  };
  const body = saveStateHead()
    .replace("  function saveState(opts) {", "")
    .replace(/currentMediaId/g, "ctx.currentMediaId")
    .replace(/stateLoaded/g, "ctx.stateLoaded")
    .replace(/pendingUserEdit/g, "ctx.pendingUserEdit")
    .replace(/userEditedDuringLoad/g, "ctx.userEditedDuringLoad")
    .replace(/nextSaveIsUserEdit/g, "ctx.nextSaveIsUserEdit")
    .replace(/mixerBaseSource/g, "ctx.mixerBaseSource")
    .replace(/state\.userDisabled/g, "ctx.userDisabled");
  // eslint-disable-next-line no-new-func
  const fn = new Function("ctx", "opts", body + "\n return true;");
  return {
    ctx,
    save: (opts) => fn(ctx, opts),
    // 채널 id 가 잡히는 순간의 실제 처리(resolveAndLoadChannel 와 같은 규칙).
    resolveChannel(id) {
      ctx.currentMediaId = id;
      if (ctx.pendingUserEdit) {
        ctx.pendingUserEdit = false;
        fn(ctx, { forcePresets: true });
      }
    },
    // load 응답에서 전역 기본값을 적용하는지.
    appliesGlobalDefaults() {
      return !ctx.userEditedDuringLoad;
    },
  };
}

console.log("[B] 채널 id 확보 전 EQ 대역 동기화 — 전역 기본값이 살아남는다");
{
  // ISO 사용자의 매 페이지 진입에서 실제로 일어나는 순서다.
  const r = createRuntime();
  r.save(); // feature flags → applyEqBandMode → 자동 저장(사용자 조작 아님)
  ok(
    r.ctx.pendingUserEdit === false,
    "시스템 저장은 대기 표시를 남기지 않는다",
  );
  r.resolveChannel("abc123");
  ok(
    r.ctx.userEditedDuringLoad === false,
    "로드 중 사용자 편집으로 잡히지 않는다",
  );
  ok(r.appliesGlobalDefaults(), "전역 기본 프리셋이 적용된다");
}

console.log("\n[C] 채널 id 확보 후·로드 응답 전 동기화 — 마찬가지");
{
  const r = createRuntime();
  r.ctx.currentMediaId = "abc123";
  r.save();
  ok(
    r.ctx.userEditedDuringLoad === false,
    "시스템 저장은 표시를 세우지 않는다",
  );
  ok(r.appliesGlobalDefaults(), "전역 기본 프리셋이 적용된다");
}

console.log("\n[N] 그래프 실패·자동 켜기 같은 시스템 저장도 오염시키지 않는다");
{
  const r = createRuntime();
  r.ctx.currentMediaId = "abc123";
  r.save(); // handleGraphBuildFailure / setEnabled 경로
  r.save();
  ok(r.appliesGlobalDefaults(), "몇 번을 불러도 전역 기본값이 살아남는다");
}

console.log("\n[E] 로드가 늦는 동안 실제 DSP 조절 — 사용자 값이 이긴다");
{
  // ⚠ 이 검사가 깨지면 수정 실패다. 늦은 응답이 방금 만진 값을 덮으면 안 된다.
  const r = createRuntime();
  r.ctx.currentMediaId = "abc123";
  r.ctx.nextSaveIsUserEdit = true; // commitUserEditToChannelBase 가 세우는 표시
  r.save();
  ok(r.ctx.userEditedDuringLoad === true, "사용자 편집으로 잡힌다");
  ok(!r.appliesGlobalDefaults(), "전역 기본값이 사용자 값을 덮지 않는다");
}

console.log("\n[F] 로드 중 프리셋 직접 선택도 사용자 편집이다");
{
  const r = createRuntime();
  r.ctx.currentMediaId = "abc123";
  r.save({ userEdit: true });
  ok(r.ctx.userEditedDuringLoad === true, "사용자 편집으로 잡힌다");
}

console.log("\n[G] 로드 중 opt-out — 사용자 의사가 유지된다");
{
  const r = createRuntime();
  r.ctx.currentMediaId = "abc123";
  r.ctx.userDisabled = true;
  r.save({ userIntent: true });
  ok(r.ctx.userEditedDuringLoad === true, "값 편집이 아니어도 의사는 남긴다");
  ok(!r.appliesGlobalDefaults(), "늦은 로드가 opt-out 을 되돌리지 않는다");
}

console.log("\n[H] 로드 중 커스텀 프리셋 편집 — 유실되지 않는다");
{
  const r = createRuntime();
  r.ctx.currentMediaId = "abc123";
  r.save({ forcePresets: true });
  ok(r.ctx.userEditedDuringLoad === true, "커스텀 편집은 사용자 의사다");
}

console.log("\n[채널 전] 사용자 의사는 채널 id 확보 전에도 남는다");
{
  // 채널이 아직 없을 때 커스텀을 편집하면 그 값은 반드시 살아남아야 한다.
  const r = createRuntime();
  r.save({ forcePresets: true });
  ok(r.ctx.pendingUserEdit === true, "대기 표시를 남긴다");
  r.resolveChannel("abc123");
  ok(
    r.ctx.userEditedDuringLoad === true,
    "채널이 잡히면 사용자 편집으로 잇는다",
  );
}

console.log("\n[소스] 판정이 저장보다 먼저다");
{
  const head = saveStateHead();
  // ⚠ 예전처럼 첫 줄에서 조건 없이 세우면 이 버그가 그대로 돌아온다.
  ok(
    !/^\s*if \(!stateLoaded\) userEditedDuringLoad = true;/m.test(head),
    "조건 없이 로드 중 편집으로 세우지 않는다",
  );
  ok(
    /if \(!stateLoaded && userIntent\) userEditedDuringLoad = true;/.test(head),
    "사용자 의사일 때만 세운다",
  );
  ok(
    /if \(userIntent\) pendingUserEdit = true;/.test(head),
    "채널 id 가 없을 때도 사용자 의사일 때만 대기로 남긴다",
  );
  ok(
    head.indexOf("const userIntent") < head.indexOf("pendingUserEdit = true"),
    "판정을 먼저 하고 그 뒤에 표시를 세운다",
  );
}

console.log("\n[10/11] 설정에서 내려온 EQ 동기화와 패널 조작을 구분한다");
{
  // 설정 → feature flags 로 내려오는 동기화(시스템)
  const sync = SRC.slice(
    SRC.indexOf('if (typeof e.data.eqBandMode === "string") {'),
    SRC.indexOf('if (typeof e.data.eqBandMode === "string") {') + 300,
  );
  ok(
    /saveState\(\);/.test(sync) && !/userIntent/.test(sync),
    "설정에서 내려온 동기화는 사용자 의사로 보지 않는다",
  );
  // 패널에서 직접 바꾼 경우(사용자)
  const panel = SRC.slice(
    SRC.indexOf('if (action === "eq-band-mode") {'),
    SRC.indexOf('if (action === "eq-band-mode") {') + 300,
  );
  ok(
    /saveState\(\{ userIntent: true \}\)/.test(panel),
    "패널에서 직접 바꾼 것은 사용자 의사로 남긴다",
  );
}

console.log("\n[19] 자동 활성화는 사용자 편집이 아니다");
{
  const setEnabled = SRC.slice(
    SRC.indexOf("  function setEnabled(enabled) {"),
    SRC.indexOf("  function setEnabled(enabled) {") + 900,
  );
  ok(
    /saveState\(\);/.test(setEnabled) &&
      !/userEdit|userIntent/.test(setEnabled),
    "켜기/끄기 자체는 표시를 세우지 않는다(호출부가 의사를 붙인다)",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
