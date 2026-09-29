const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const watch = read("src/multiviewWatch.js");
const content = read("src/content.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
const sliceFn = (source, name) => {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(start >= 0 && end > start, `${name} 를 찾지 못했다`);
  return source.slice(start, end + 4);
};

// 부모의 원본 함수(audioOf·effectiveMuted·adoptFrameUserMute)를 그대로 돌린다.
function makeParent({ masterMuted = false, audioFocusMode = false, audio = {} } = {}) {
  const posted = [];
  const ctx = {
    state: {
      mainId: "main",
      masterMuted,
      audioFocusMode,
      startMainVolume: 1,
      chosen: [{ channelId: "main" }, { channelId: "sub1" }, { channelId: "sub2" }],
    },
    channelAudio: new Map(Object.entries(audio)),
    postState: (id) => posted.push(id),
    clearAudioNotice() {},
    renderVolume() {},
    syncAllVolumeButtons() {},
  };
  ctx.postAllAudio = () => ctx.state.chosen.forEach((c) => posted.push(c.channelId));
  vm.runInNewContext(
    [sliceFn(watch, "audioOf"), sliceFn(watch, "effectiveMuted"), sliceFn(watch, "adoptFrameUserMute")].join("\n") +
    "\nglobalThis.api = { audioOf, effectiveMuted, adoptFrameUserMute };",
    Object.assign(ctx, { globalThis: ctx }),
  );
  return { ...ctx.api, state: ctx.state, posted };
}

// 1) 보통: 보조 칸을 플레이어에서 풀면 패널도 풀린다.
{
  const p = makeParent();
  check(p.effectiveMuted("sub1") === true, "보조 칸은 처음에 음소거");
  p.adoptFrameUserMute("sub1", false);
  check(p.effectiveMuted("sub1") === false && p.audioOf("sub1").muteTouched === true,
    "플레이어에서 음소거를 풀면 볼륨 패널도 풀린 상태가 된다");
  check(p.effectiveMuted("sub2") === true, "다른 보조 칸은 그대로 음소거");
  p.adoptFrameUserMute("sub1", true);
  check(p.effectiveMuted("sub1") === true, "플레이어에서 다시 음소거하면 패널도 음소거");
}

// 2) 메인만 듣기: 보조 칸을 풀면 볼륨 슬라이더를 올릴 때처럼 모드를 끈다.
{
  const p = makeParent({ audioFocusMode: true });
  p.adoptFrameUserMute("sub1", false);
  check(p.state.audioFocusMode === false && p.effectiveMuted("sub1") === false,
    "메인만 듣기 중 보조 칸을 풀면 모드를 끄고 그 칸을 푼다");
  check(p.effectiveMuted("sub2") === true, "다른 보조 칸은 계속 조용하다");
  check(p.posted.length === 3, "모든 칸에 새 상태를 보낸다");
}

// 3) 전체 음소거: 한 칸만 풀리고 다른 칸은 갑자기 소리 나지 않는다.
{
  const p = makeParent({
    masterMuted: true,
    audio: { main: { volume: 1, muted: false, muteTouched: true } },
  });
  p.adoptFrameUserMute("sub1", false);
  check(p.state.masterMuted === false && p.effectiveMuted("sub1") === false,
    "전체 음소거 중 한 칸을 풀면 전체 음소거를 끄고 그 칸을 푼다");
  check(p.effectiveMuted("main") === true && p.effectiveMuted("sub2") === true,
    "원래 소리가 켜져 있던 메인을 포함해 다른 칸은 계속 조용하다");
}

// 4) 이미 같은 상태면 아무 일도 하지 않는다(부모 지시가 되돌아온 경우).
{
  const p = makeParent();
  p.adoptFrameUserMute("main", false);
  p.adoptFrameUserMute("sub1", true);
  check(p.posted.length === 0, "부모 상태와 같으면 다시 보내지 않는다");
}

// 5) 음량 0 에서 풀면 들리게 올린다(패널 음소거 버튼과 같다).
{
  const p = makeParent({ audio: { sub1: { volume: 0, muted: true, muteTouched: false } } });
  p.adoptFrameUserMute("sub1", false);
  check(p.audioOf("sub1").volume === 1, "음량이 0 이면 풀 때 100% 로 올린다");
}

// ── 프레임: 사용자 조작 직후의 음소거 변화만 알린다 ─────────────────────
check(/let lastTrustedAudioInputAt = 0;/.test(content) &&
  /const TRUSTED_AUDIO_INPUT_WINDOW_MS = 2000;/.test(content),
  "프레임이 마지막 사용자 소리 조작 시각을 기록한다");
check(/muteOverriddenByUser = true;\s*lastTrustedAudioInputAt = Date\.now\(\);/.test(content),
  "플레이어 볼륨·음소거 버튼 클릭(신뢰된 입력)을 기록한다");
check(/event\.code === "KeyM" \|\| event\.code === "ArrowUp" \|\| event\.code === "ArrowDown"\) \{\s*lastTrustedAudioInputAt = Date\.now\(\);/.test(content),
  "M·위·아래 키(신뢰된 입력)를 기록한다");
check(/video\.muted !== multiviewMuted &&\s*Date\.now\(\) - lastTrustedAudioInputAt < TRUSTED_AUDIO_INPUT_WINDOW_MS[\s\S]{0,40}\) \{\s*notifyParent\("FRAME_USER_MUTE", \{ muted: video\.muted \}\);/.test(content),
  "지시와 다르게, 사용자 조작 직후에 바뀐 음소거만 알린다(치지직 자체 변경은 제외)");
check(/"FRAME_USER_MUTE",/.test(watch) &&
  /data\.type === "FRAME_USER_MUTE"\) \{\s*if \(currentStatus\(channelId\) !== "ready" \|\| typeof data\.muted !== "boolean"\) return;\s*adoptFrameUserMute\(channelId, data\.muted\);/.test(watch),
  "부모가 준비된 칸의 불리언 값만 받는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
