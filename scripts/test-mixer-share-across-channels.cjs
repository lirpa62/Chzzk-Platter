// 채널 간 오디오 믹서 설정 공유(opt-in).
//
// 약속한 것은 두 줄이다.
//   1) 설정을 켠 경우에만, 저장된 설정이 없는 새 채널이 마지막 조절값을 이어받는다.
//   2) 이미 저장된 채널별 설정은 절대 공유값으로 덮어쓰지 않는다.
//
// 적용 우선순위
//   채널 저장값 > 공유 스냅샷 > 전역 기본값 > DEFAULT_STATE
//
// ⚠ 판정 규칙은 audioMixer.js 에서 그대로 떼어 온다. 여기 손으로 베껴 두면 원본이
//   바뀌어도 통과해 버린다(이 저장소에서 여러 번 겪었다).

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "audioMixer.js"),
  "utf8",
);
const CONTENT = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

// audioMixer.js 의 '물려받을지' 판정을 원본에서 떼어 온다.
function inheritRule() {
  const at = SRC.indexOf("        const inherit =");
  if (at < 0) throw Error("공유 적용 판정을 찾지 못했다");
  const end = SRC.indexOf(";", at);
  const expr = SRC.slice(at + "        const inherit =".length, end).trim();
  if (!/shareAcrossChannels/.test(expr)) {
    throw Error("찾은 식이 공유 판정이 아니다");
  }
  // eslint-disable-next-line no-new-func
  return new Function(
    "shareAcrossChannels",
    "hasChannelSaved",
    "locallyEditedState",
    "lastSharedSnapshot",
    `return !!(${expr});`,
  );
}

// ⚠ 끝 지점을 SRC.indexOf 로 그냥 찾으면 안 된다. 같은 문자열이 파일 앞쪽에도
//   있어 시작보다 앞을 가리키면 빈 문자열이 나오고, 검사가 조용히 헛돈다.
function sliceInheritBlock(endMark) {
  const at = SRC.indexOf("        const inherit =");
  if (at < 0) throw Error("공유 적용 블록을 찾지 못했다");
  const end = SRC.indexOf(endMark, at);
  if (end < at) throw Error("블록 끝을 찾지 못했다: " + endMark);
  const out = SRC.slice(at, end);
  if (!out.includes("applySharedSnapshot")) {
    throw Error("잘라 낸 범위가 공유 적용 블록이 아니다");
  }
  return out;
}

const shouldInherit = inheritRule();

console.log("[A] 공유 OFF — 아무것도 물려받지 않는다");
{
  ok(
    !shouldInherit(false, false, null, { gain: 1.5 }),
    "꺼져 있으면 저장값 없는 채널에도 적용하지 않는다",
  );
}

console.log("\n[B] 공유 ON + 저장값 없음 — 물려받는다");
{
  ok(
    shouldInherit(true, false, null, { gain: 1.5 }),
    "처음 방문하는 채널은 마지막 조절값을 받는다",
  );
}

console.log("\n[C] 저장된 채널 설정이 있으면 덮지 않는다");
{
  // ⚠ 이 기능의 핵심 약속이다.
  ok(
    !shouldInherit(true, true, null, { gain: 1.5 }),
    "이미 저장된 채널은 공유값으로 덮지 않는다",
  );
}

console.log("\n[G] 로드 전 사용자가 먼저 만졌으면 그 조작이 우선");
{
  // 느린 storage 응답이 방금 조절한 값을 되돌리면 안 된다(기존 방어 규칙).
  ok(
    !shouldInherit(true, false, { gain: 1.2 }, { gain: 1.5 }),
    "사용자 편집이 먼저면 공유값을 적용하지 않는다",
  );
}

console.log("\n[공유값 없음] 물려줄 것이 없으면 적용하지 않는다");
{
  ok(!shouldInherit(true, false, null, null), "스냅샷이 없으면 그대로 둔다");
}

console.log("\n[소스] 저장 여부를 브리지가 분명히 알려 준다");
{
  // ⚠ merged 는 전역값을 늘 싣고 와서 state 만 보면 '저장값 있음' 과 구분이 안 된다.
  ok(/found: !!saved,/.test(CONTENT), "load 응답에 found 플래그가 있다");
  ok(
    /const hasChannelSaved = e\.data\.found === true;/.test(SRC),
    "MAIN 은 그 플래그로만 판단한다",
  );
  // 예전 브리지(플래그 없음)에서는 적용하지 않는 쪽이 안전하다.
  ok(
    !/e\.data\.found !== false/.test(SRC),
    "플래그가 없으면 '저장값 있음' 으로 보지 않는다(=== true 로만 판단)",
  );
}

console.log("\n[소스] 공유하지 않는 값");
{
  const build = SRC.slice(
    SRC.indexOf("  function buildSharedSnapshot() {"),
    SRC.indexOf("  function applySharedSnapshot("),
  );
  ok(build.length > 0, "공유 스냅샷 생성 함수가 있다");
  for (const forbidden of [
    "enabled",
    "userDisabled",
    "volume",
    "muted",
    "customPresets",
  ]) {
    ok(
      !new RegExp(`\\b${forbidden}\\b`).test(build),
      `${forbidden} 은 공유하지 않는다`,
    );
  }
  for (const field of ["gain", "eq", "comp", "limiter", "normalizer"]) {
    ok(new RegExp(`\\b${field}\\b`).test(build), `${field} 은 공유한다`);
  }
  ok(/eqBandMode,/.test(build), "대역 모드를 함께 담는다(변환에 필요)");
}

console.log("\n[J] EQ 대역 모드가 다르면 주파수 기준으로 옮긴다");
{
  const apply = SRC.slice(
    SRC.indexOf("  function applySharedSnapshot("),
    SRC.indexOf("  function serializeState("),
  );
  ok(
    /convertEqBetweenModes\(/.test(apply),
    "기존 변환 헬퍼를 그대로 쓴다(인덱스 복사 금지)",
  );
  ok(
    /normalizeEqBandMode\(snapshot\.eqBandMode\)/.test(apply),
    "저장 당시 모드에서 지금 모드로 옮긴다",
  );
}

console.log("\n[I] 지워진 커스텀 프리셋 id 는 칩으로 세우지 않는다");
{
  const apply = SRC.slice(
    SRC.indexOf("  function applySharedSnapshot("),
    SRC.indexOf("  function serializeState("),
  );
  ok(/presetExists/.test(apply), "프리셋이 아직 있는지 확인한다");
  ok(
    /state\.preset = presetExists \? preset : "custom";/.test(apply),
    "없으면 '사용자 설정' 으로 떨어뜨린다(값은 그대로 적용)",
  );
}

console.log("\n[F] 공유값을 적용한 것 자체는 다시 스냅샷을 갱신하지 않는다");
{
  const save = SRC.slice(
    SRC.indexOf("  function saveState(opts) {"),
    SRC.indexOf("  // 현재 state에서 '채널이 저장할 프리셋/값' 부분만 스냅샷."),
  );
  ok(
    /if \(shareAcrossChannels && userEdit\)/.test(save),
    "사용자 조절일 때만 스냅샷을 갱신한다",
  );
  // ⚠ 자동 적용이 스냅샷을 갱신하면 값이 순환하며 떠돈다.
  const commit = SRC.slice(
    SRC.indexOf("  function commitUserEditToChannelBase() {"),
    SRC.indexOf("  function commitUserEditToChannelBase() {") + 700,
  );
  ok(
    /nextSaveIsUserEdit = true;/.test(commit),
    "DSP 를 직접 만진 경로에서만 표시를 세운다",
  );
  // 물려받기만 한 상태에서는 표시가 서지 않아야 한다.
  const loaded = sliceInheritBlock("        channelBaseState =");
  ok(
    !/nextSaveIsUserEdit = true/.test(loaded),
    "공유값을 물려받는 자리에서는 표시를 세우지 않는다",
  );
}

console.log("\n[13] 물려받은 상태는 '이 채널에서 직접 고름' 이 아니다");
{
  const loaded = sliceInheritBlock("        channelBaseState =");
  ok(
    /state\.userPickedPreset = false;/.test(loaded),
    "userPickedPreset 을 세우지 않는다",
  );
  ok(
    /state\.userPickedGain = false;/.test(loaded),
    "userPickedGain 도 세우지 않는다",
  );
  ok(
    /inheritedSharedState = true;/.test(loaded),
    "'물려받음' 은 런타임 표시로만 둔다",
  );
  ok(
    !/inheritedSharedState/.test(
      SRC.slice(
        SRC.indexOf("  function serializeState(opts) {"),
        SRC.indexOf("  function requestState("),
      ),
    ),
    "그 표시를 저장하지 않는다",
  );
}

console.log("\n[10] 물려받기만 했다고 그 채널에 바로 저장하지 않는다");
{
  // ⚠ 공유를 한 번 켰다고 수백 채널의 저장소가 자동으로 생기면 안 된다.
  const loaded = sliceInheritBlock("        if (state.userDisabled");
  ok(!/saveState\(/.test(loaded), "적용 직후 저장을 부르지 않는다");
}

console.log("\n[12] 전역 기본값과의 우선순위");
{
  const loaded = sliceInheritBlock("        if (state.userDisabled");
  ok(
    /if \(!locallyEditedState && !inheritedSharedState\) \{\s*\n\s*applyConfiguredGlobalDefaults\(\);/.test(
      loaded,
    ),
    "물려받았으면 전역 기본값으로 다시 덮지 않는다",
  );
}

console.log("\n[저장 분리] 공유 스냅샷이 채널 저장에 섞이지 않는다");
{
  ok(
    /sharedSnapshot,\n\s*\.\.\.perMedia\n\s*\} = incoming;/.test(CONTENT),
    "per-media 저장에서 공유 스냅샷을 떼어 낸다",
  );
  ok(
    /toSet\[AUDIO_MIXER_SHARED_STATE_KEY\] = sharedSnapshot;/.test(CONTENT),
    "공유 스냅샷은 전역 키에 따로 저장한다",
  );
  ok(
    /const AUDIO_MIXER_SHARED_STATE_KEY = "audioMixer:lastSharedState";/.test(
      CONTENT,
    ),
    "스냅샷 키는 하나뿐이다(채널별 복제본을 만들지 않는다)",
  );
}

console.log("\n[25] 브리지 보안 규칙을 그대로 지킨다");
{
  // postMessage 대상 origin 을 넓히지 않았는지.
  const near = CONTENT.slice(
    CONTENT.indexOf('type: "share-across-channels-changed"') - 400,
    CONTENT.indexOf('type: "share-across-channels-changed"') + 400,
  );
  ok(/BRIDGE_ORIGIN/.test(near), "기존 BRIDGE_ORIGIN 을 그대로 쓴다");
  ok(!/"\*"/.test(near), "targetOrigin 을 * 로 넓히지 않는다");
}

console.log("\n[기본값] 켜지 않으면 동작하지 않는다");
{
  ok(/let shareAcrossChannels = false;/.test(SRC), "기본값은 꺼짐(opt-in)");
  ok(
    /data\?\.\[AUDIO_MIXER_SHARE_KEY\] === true/.test(
      fs.readFileSync(path.join(__dirname, "..", "src", "settings.js"), "utf8"),
    ),
    "설정 화면도 === true 일 때만 켠다",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
