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

// audioMixer.js 의 판정 규칙을 원본에서 그대로 떼어 온다.
// ⚠ 손으로 베껴 두면 원본이 바뀌어도 통과해 버린다.
function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

// 무엇을 기준으로 삼을지 정하는 함수.
const resolveSource = new Function(
  `${sliceFn("resolveMixerBaseSource")}; return resolveMixerBaseSource;`,
)();
// 그 기준일 때 전역 기본값을 덮어도 되는지.
function applyGlobals(source) {
  return new Function(
    "mixerBaseSource",
    `${sliceFn("shouldApplyConfiguredGlobals")}; return shouldApplyConfiguredGlobals();`,
  )(source);
}
// 편의: 물려받는 상황인가.
// load 응답에서 공유를 적용하는 블록만 잘라 온다.
// ⚠ 끝 표시를 SRC.indexOf 로 그냥 찾으면 파일 앞쪽의 같은 문자열을 집어 빈 범위가
//   나온다(실제로 그렇게 헛돌았다). 시작 위치부터 찾는다.
function sliceLoadBlock() {
  const at = SRC.indexOf("        const nextSource = resolveMixerBaseSource({");
  if (at < 0) throw Error("공유 적용 블록을 찾지 못했다");
  const end = SRC.indexOf("        channelBaseState =", at);
  if (end < at) throw Error("블록 끝을 찾지 못했다");
  const out = SRC.slice(at, end);
  if (!out.includes("applySharedSnapshot")) {
    throw Error("잘라 낸 범위가 공유 적용 블록이 아니다");
  }
  return out;
}

const shouldInherit = (share, found, locallyEdited, snapshot) =>
  !locallyEdited &&
  resolveSource({
    foundSaved: found,
    shareEnabled: share,
    snapshot,
  }) === "shared";

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
  const save = sliceFn("saveState");
  ok(/if \(userEdit\) \{/.test(save), "사용자 조절일 때만 스냅샷을 갱신한다");
  const commit = sliceFn("commitUserEditToChannelBase");
  ok(
    /nextSaveIsUserEdit = true;/.test(commit),
    "DSP 를 직접 만진 경로에서만 표시를 세운다",
  );
  const loaded = sliceLoadBlock();
  ok(
    !/nextSaveIsUserEdit = true/.test(loaded),
    "공유값을 물려받는 자리에서는 표시를 세우지 않는다",
  );
}

console.log("\n[13] 물려받은 상태는 '이 채널에서 직접 고름' 이 아니다");
{
  const loaded = sliceLoadBlock();
  ok(
    /state\.userPickedPreset = false;/.test(loaded),
    "userPickedPreset 을 세우지 않는다",
  );
  ok(
    /state\.userPickedGain = false;/.test(loaded),
    "userPickedGain 도 세우지 않는다",
  );
  ok(
    /setMixerBaseSource\("shared"\);/.test(loaded),
    "'물려받음' 을 런타임 표시로 남긴다",
  );
  ok(
    !/mixerBaseSource/.test(sliceFn("serializeState")),
    "그 표시를 저장하지 않는다",
  );
}

console.log("\n[Q/17] 물려받기만 한 채널에는 채널 저장값을 만들지 않는다");
{
  // ⚠ 실제 브라우저에서 깨졌던 지점이다. 믹서를 켜기만 해도 saveState 가 돌아
  //   audioMixer:<채널> 이 생겼고, 다음 방문에 found=true 가 되어 공유값 대신
  //   전역 기본값이 적용됐다.
  const save = sliceFn("saveState");
  ok(
    /if \(mixerBaseSource === "shared" && !userEdit && !mustSaveAnyway\) \{\s*\n\s*return;/.test(
      save,
    ),
    "직접 만지지 않았으면 저장을 건너뛴다",
  );
  ok(
    /opts\?\.forcePresets === true \|\| state\.userDisabled === true/.test(
      save,
    ),
    "커스텀 프리셋 편집과 opt-out 은 그래도 저장한다",
  );
  // 표시를 내리는 자리가 return 보다 앞에 있어야 다음 저장으로 새지 않는다.
  // ⚠ 첫 return 은 채널id 확보 전 가드다. '건너뛰기' return 과 비교해야 한다.
  ok(
    save.indexOf("nextSaveIsUserEdit = false;") <
      save.indexOf('if (mixerBaseSource === "shared"'),
    "건너뛰어도 '사용자 조절' 표시를 확실히 내린다(다음 저장에 새지 않게)",
  );
}

console.log("\n[B/19] 재방문에도 다시 물려받는다");
{
  // 저장값이 없는 한 첫 진입이든 재방문이든 결과가 같아야 한다.
  const first = resolveSource({
    foundSaved: false,
    shareEnabled: true,
    snapshot: { gain: 1.5 },
  });
  const revisit = resolveSource({
    foundSaved: false,
    shareEnabled: true,
    snapshot: { gain: 1.5 },
  });
  ok(first === "shared", `첫 진입 → shared (${first})`);
  ok(revisit === "shared", `재방문 → shared (${revisit})`);
  ok(!applyGlobals(revisit), "재방문에도 전역 기본값이 덮지 않는다");
}

console.log("\n[C~F/14] 공유 상태에서 전역값을 바꿔도 지금 소리는 그대로");
{
  const handler = SRC.slice(
    SRC.indexOf('} else if (e.data.type === "globals-changed") {'),
    SRC.indexOf("  // ── UI ─"),
  );
  ok(
    /if \(!shouldApplyConfiguredGlobals\(\)\) return;/.test(handler),
    "물려받은 채널에서는 전역 변경이 지금 값을 덮지 않는다",
  );
  // ⚠ 그 판정이 beginStateLoad 재로드보다 앞에 있어야 한다. 뒤에 있으면
  //   전역을 끌 때 reload 가 먼저 돌아 shared→global→shared 로 튄다.
  ok(
    handler.indexOf("shouldApplyConfiguredGlobals") <
      handler.indexOf("beginStateLoad"),
    "전역 OFF 로 인한 재로드보다 먼저 막는다",
  );
  // 전역 프리셋과 전역 게인을 함께 막는다(반쪽 수정 금지).
  ok(
    !/globalDefaultPreset\.enabled\s*&&\s*applyGlobalDefaultPreset/.test(
      handler,
    ),
    "프리셋만 막고 게인은 놔두는 반쪽 처리가 아니다",
  );
}

console.log("\n[G/H/12] 공유를 끄면 전역·기본 정책으로 돌아간다");
{
  const handler = SRC.slice(
    SRC.indexOf('if (e.data.type === "share-across-channels-changed") {'),
    SRC.indexOf('if (e.data.type === "share-across-channels-changed") {') + 900,
  );
  ok(
    /wasEnabled && !shareAcrossChannels && mixerBaseSource === "shared"/.test(
      handler,
    ),
    "공유를 끈 순간 물려받은 채널만 다시 판단한다",
  );
  ok(/beginStateLoad\(currentMediaId\)/.test(handler), "다시 불러와 적용한다");
  // 켜는 쪽은 지금 화면을 건드리지 않는다(§13 — 새 UX 를 만들지 않는다).
  ok(
    !/!wasEnabled && shareAcrossChannels/.test(handler),
    "켜는 쪽은 보고 있는 채널을 바꾸지 않는다",
  );
  // 공유가 꺼지면 판정은 default 로 떨어져 전역 정책이 살아난다.
  const off = resolveSource({
    foundSaved: false,
    shareEnabled: false,
    snapshot: { gain: 1.5 },
  });
  ok(off === "default", `공유 OFF → default (${off})`);
  ok(applyGlobals(off), "그때는 전역 기본값을 적용한다");
}

console.log("\n[I/15/16] 직접 수정하면 더는 물려받은 채널이 아니다");
{
  const save = sliceFn("saveState");
  ok(
    /setMixerBaseSource\("saved"\);/.test(save),
    "직접 만지면 저장 채널로 전환한다",
  );
  // 전환 뒤에는 전역 정책이 기존 저장 채널과 똑같이 동작해야 한다.
  ok(applyGlobals("saved"), "전환 뒤에는 전역 기본값 정책이 되살아난다");
  // 공유가 꺼져 있어도 전환은 해야 한다.
  const idx = save.indexOf('setMixerBaseSource("saved");');
  const shareIdx = save.indexOf("if (shareAcrossChannels) {");
  ok(
    idx >= 0 && (shareIdx < 0 || idx < shareIdx),
    "공유가 꺼져 있어도 전환한다",
  );
}

console.log("\n[K/L/M/22/23] 기존 저장 채널의 전역 정책은 그대로");
{
  ok(applyGlobals("saved"), "저장된 채널에는 전역 기본값을 적용한다");
  ok(
    applyGlobals("default"),
    "저장값도 공유값도 없으면 전역 기본값을 적용한다",
  );
  ok(!applyGlobals("shared"), "물려받은 채널에만 적용을 막는다");
  // applyConfiguredGlobalDefaults 자체는 건드리지 않았는지(다른 수명주기에서도 쓴다).
  const fn = sliceFn("applyConfiguredGlobalDefaults");
  ok(
    !/mixerBaseSource/.test(fn),
    "전역 적용 함수 자체에는 공유 특례를 넣지 않았다(caller 에서 판단)",
  );
  ok(
    /globalDefaultMode === "channel" && state\.userPickedPreset === true/.test(
      fn,
    ),
    "기존 global/channel 정책이 그대로 남아 있다",
  );
}

console.log("\n[26] 채널이 바뀌면 판정을 초기화한다");
{
  const loaded = SRC.slice(
    SRC.indexOf("      const hasChannelSaved = e.data.found === true;"),
    SRC.indexOf("      const saved = e.data.state;"),
  );
  ok(
    /setMixerBaseSource\("default"\);/.test(loaded),
    "매 로드마다 초기화해 이전 채널 판정이 새지 않는다",
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
