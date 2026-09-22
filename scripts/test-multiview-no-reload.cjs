// 멀티뷰 칸이 스스로 페이지를 다시 불러오지 않는지 확인한다.
//
// 칸이 부모 몰래 새로 불러오면 소리·화질·메인 지정이 한꺼번에 흐트러진다. 다시
// 불러오는 일은 부모가 사용자의 조작으로만 해야 한다. 그래서 두 가지를 본다.
//   1. 자동 새로고침 두 기능(오류 시 / 방종 후 뱅온)이 멀티뷰 칸에서는 감시를
//      아예 시작하지 않는다 → location.reload() 가 있는 폴링이 돌지 않는다.
//   2. 없어진 배치 id 가 저장돼 있어도 그 채널 수의 첫 배치로 되돌아간다.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const LAYOUTS = require(path.join(root, "src/multiviewLayouts.js"));

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};

console.log("[자동 새로고침] 멀티뷰 칸에서는 감시를 시작하지 않는다");
{
  // apply*() 안에서 막아야 init 과 storage.onChanged 양쪽이 함께 막힌다.
  // 어느 한쪽에만 두면 설정을 켜는 순간 감시가 되살아난다.
  for (const [fn, flag] of [
    ["applyAutoReloadOnError", "autoReloadOnError"],
    ["applyAutoReloadOnRelive", "autoReloadOnRelive"],
  ]) {
    const start = content.indexOf(`function ${fn}()`);
    ok(start > 0, `${fn} 이 있다`);
    const body = content.slice(start, content.indexOf("}", start));
    ok(
      body.includes(`${flag} && !IS_MULTIVIEW_FRAME`),
      `${fn} 이 멀티뷰 칸을 걸러 낸다`,
    );
  }
}

console.log("\n[reload 경로] location.reload() 는 막아 둔 폴링 안에만 있다");
{
  // 폴링 함수 밖에 reload 가 새로 생기면 여기서 잡힌다.
  const lines = content.split("\n");
  const reloadLines = [];
  lines.forEach((line, i) => {
    if (line.includes("location.reload()")) reloadLines.push(i + 1);
  });
  ok(reloadLines.length === 2, `reload 호출이 2곳이다 (${reloadLines})`);
  for (const at of reloadLines) {
    // 그 줄이 속한 함수를 위로 훑어 찾는다.
    let owner = "";
    for (let i = at - 1; i >= 0 && !owner; i -= 1) {
      const m = /^\s*(?:async\s+)?function\s+(\w+)/.exec(lines[i]);
      if (m) owner = m[1];
    }
    ok(
      owner === "autoReloadPoll" || owner === "autoRelivePoll",
      `${at}행의 reload 는 막아 둔 폴링(${owner}) 안에 있다`,
    );
  }
}

console.log("\n[진단 코드] 임시로 넣었던 추적 코드가 남아 있지 않다");
{
  const watch = fs.readFileSync(
    path.join(root, "src/multiviewWatch.js"),
    "utf8",
  );
  // 원인 분석이 끝나 걷어낸 것들이다. 되살아나면 콘솔이 다시 시끄러워진다.
  for (const [sym, label] of [
    ["cheeseMultiviewTrace", "진단 모드 스위치"],
    ["traceLife", "프레임 생명주기 기록"],
    ["traceLog", "부모 기록 헬퍼"],
    ["frameReadyCounts", "FRAME_READY 횟수 세기"],
    ["returnProbeTimers", "복귀 진단 예약"],
    ["wasDiscarded", "탭 폐기 확인"],
  ]) {
    ok(
      !content.includes(sym) && !watch.includes(sym),
      `${label}(${sym})가 남아 있지 않다`,
    );
  }
  // [mv-*] 콘솔 출력도 없어야 한다.
  for (const tag of ["mv-life", "mv-frame", "mv-quality", "mv-drag"]) {
    ok(
      !content.includes(`"${tag}"`) && !watch.includes(`"${tag}"`),
      `${tag} 로그가 없다`,
    );
  }
}

console.log("\n[따라잡기] 멀티뷰 칸은 기본값에서 따라잡기가 돌지 않는다");
{
  // Alt+Tab 복귀 뒤 보조 화면이 라이브로 끌려가는 증상의 후보 중 하나가 우리
  // '실시간 따라잡기' 다. 기본값에서 그것이 도는지 코드로 확정해 둔다.
  //
  // 흐름: multiviewBtnSync(기본 false) → flags.liveSync = true
  //      → audioMixer 가 removeSyncButton() → stopSyncCheck()
  // 즉 버튼만 숨기는 게 아니라 판정 루프 자체가 멈춘다.
  ok(
    /let multiviewBtnSync = false;/.test(content),
    "멀티뷰 따라잡기 버튼은 기본으로 꺼져 있다",
  );
  ok(
    /if \(!multiviewBtnSync\) flags\.liveSync = true;/.test(content),
    "버튼을 끄면 기능 플래그까지 꺼진다(표시만 숨기지 않는다)",
  );
  const mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
  const gate = mixer.slice(
    mixer.indexOf("if (featureFlags.liveSync) {"),
    mixer.indexOf("if (featureFlags.liveSync) {") + 200,
  );
  ok(
    /removeSyncButton\(\)/.test(gate),
    "플래그가 켜지면 따라잡기 버튼을 없앤다",
  );
  const remove = mixer.slice(
    mixer.indexOf("function removeSyncButton"),
    mixer.indexOf("function removeSyncButton") + 300,
  );
  ok(
    /stopSyncCheck\(\)/.test(remove),
    "버튼을 없앨 때 판정 루프도 멈춘다(숨기기만 하는 게 아니다)",
  );
}

console.log("\n[없어진 배치] 저장된 id 를 못 찾으면 첫 배치로 되돌린다");
{
  // 3채널에서 뺀 L자 배치들이다. 예전 설정에 남아 있어도 화면이 깨지면 안 된다.
  for (const gone of ["right-bottom", "left-bottom", "right-top", "left-top"]) {
    ok(LAYOUTS.layoutById(gone) === null, `${gone} 은 이제 없다`);
  }
  for (let count = 2; count <= 6; count += 1) {
    const allowed = LAYOUTS.layoutsFor(count);
    ok(allowed.length > 0, `${count}채널에 쓸 배치가 있다`);
    const picked = allowed.find((l) => l.id === "right-bottom") || allowed[0];
    ok(
      LAYOUTS.layoutById(picked.id) !== null,
      `${count}채널: 없는 id 대신 ${picked.id} 로 되돌아간다`,
    );
  }
}

console.log("\n[탭 전환] 부모도 프레임도 복귀 시 아무것도 고치지 않는다");
{
  const watch = fs.readFileSync(
    path.join(root, "src/multiviewWatch.js"),
    "utf8",
  );
  // 부모: visibilitychange 에서 기록 말고는 아무것도 하지 않는다.
  ok(
    !/location\.reload|fastSeek/.test(watch),
    "부모에 reload/seek 코드가 아예 없다",
  );
  ok(!/currentTime\s*=[^=]/.test(watch), "부모가 재생 위치를 대입하지 않는다");
  // 프레임: seek 는 명시적으로 검증된 싱크 명령에서만 허용한다.
  const at = content.indexOf("if (IS_MULTIVIEW_FRAME) {");
  ok(at > 0, "멀티뷰 프레임 블록을 찾았다");
  const block = content.slice(at, content.indexOf("// 통계 요청:", at));
  for (const [pat, label] of [
    ["location.reload", "다시 불러오기"],
    ["fastSeek", "seek"],
    ["jumpToLiveEdge", "라이브 엣지 점프"],
  ]) {
    ok(!block.includes(pat), `멀티뷰 칸에 ${label} 가 없다`);
  }
  const syncCommands = block.slice(block.indexOf("const syncCommand = {") + 1);
  ok(
    syncCommands.includes('APPLY_SYNC_SEEK: "seek"') &&
      syncCommands.includes('APPLY_SYNC_NUDGE: "nudge"') &&
      syncCommands.includes("video.currentTime = target") &&
      syncCommands.includes("target < start + 0.05") &&
      syncCommands.includes("target > end - 0.05") &&
      (block.match(/video\.currentTime\s*=[^=]/g) || []).length === 1,
    "재생 위치 변경은 범위를 검증한 싱크 명령에서만 수행한다",
  );
}

console.log("\n[최초 화질] 상한만 걸린 칸도 스스로 480p 로 수렴한다");
{
  const mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
  const watch = fs.readFileSync(
    path.join(root, "src/multiviewWatch.js"),
    "utf8",
  );
  // 보조 칸은 maxQualityAuto 가 false 다(상한만 쓴다). 예전에는 이 때문에
  // bindMaxQualityEvents 가 첫 줄에서 빠져나가 재시도 리스너가 아예 안 붙었다.
  const bind = mixer.slice(
    mixer.indexOf("function bindMaxQualityEvents"),
    mixer.indexOf("function getLiveLatencySeconds"),
  );
  ok(
    /if \(!maxQualityAuto && !\(maxQualityCap > 0\)\) return;/.test(bind),
    "상한만 걸린 칸에도 재시도 이벤트를 건다",
  );
  ok(
    /if \(maxQualityCap > 0\) \{/.test(bind),
    "상한 모드는 맞을 때까지 재시도한다",
  );
  // 초당 여러 번 오는 timeupdate 에서 fiber 탐색을 반복하면 칸 수만큼 비싸진다.
  ok(/lastCapProgressAt/.test(bind), "상한 재시도는 초당 한 번으로 제한한다");

  // 프레임이 준비됐을 때는 값이 같아도 한 번 다시 확인시킨다.
  ok(
    /reconcileQuality: true/.test(watch),
    "부모가 FRAME_READY 에서 화질 재확인을 요청한다",
  );
  ok(
    /qualityChanged \|\| forceQualityReconcile/.test(content),
    "칸이 값이 같아도 재확인 요청이면 다시 알린다",
  );
  // ⚠ 평상시 지시(볼륨 등)에서는 요청하지 않는다.
  const posts = watch.split("postState(").length - 1;
  const recon = watch.split("reconcileQuality: true").length - 1;
  ok(
    recon === 1,
    `화질 재확인 요청은 FRAME_READY 한 곳뿐이다(${recon}곳 / postState ${posts}회)`,
  );
  const postState = watch.slice(watch.indexOf("function postState("),
    watch.indexOf("function postAllAudio("));
  ok(/frame\.contentWindow\.postMessage/.test(postState) &&
    !/frame\.src\s*=/.test(postState),
    "역할·화질 재확인은 프레임 주소를 바꾸지 않는다");
  // 안전 게이트는 그대로 둔다(로딩 국면에 화질을 바꾸면 플레이어가 죽는다).
  const apply = mixer.slice(
    mixer.indexOf("function applyMaxQuality"),
    mixer.indexOf("function applyMaxQuality") + 2600,
  );
  ok(
    /pzp-pc--beforeplay/.test(apply) && /readyState < 3/.test(apply),
    "플레이어 안정 조건은 그대로 남아 있다",
  );
}

console.log("\n[WebGL] 멀티뷰 통계 경로는 WebGL 컨텍스트를 만들지 않는다");
{
  // 6채널에서 "Too many active WebGL contexts" 경고가 보였다. 우리 코드가
  // 칸마다 컨텍스트를 만드는지부터 확인해 둔다(만들지 않으면 외부 원인이다).
  const mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
  const at = content.indexOf("if (IS_MULTIVIEW_FRAME) {");
  const frameBlock = content.slice(at, at + 14000);
  ok(
    !/getContext\(|webgl|OffscreenCanvas/i.test(frameBlock),
    "멀티뷰 프레임 코드가 컨텍스트를 만들지 않는다",
  );
  // 멀티뷰 통계 스냅샷은 collectStreamInfo 만 쓴다. 하드웨어 가속 표시
  // (gpuAccelLabel → WebGL)는 개별 스트림 정보 패널을 열 때만 탄다.
  const snap = mixer.slice(
    mixer.indexOf("function getStreamStatsSnapshot"),
    mixer.indexOf("function getStreamStatsSnapshot") + 2600,
  );
  ok(
    !/gpuAccelLabel|getGpuAccelInfo/.test(snap),
    "멀티뷰 스냅샷은 하드웨어 가속 조회를 하지 않는다",
  );
  // 그 조회 자체도 1회 캐시 + loseContext 로 정리한다.
  const gpu = mixer.slice(
    mixer.indexOf("function getGpuAccelInfo"),
    mixer.indexOf("function getGpuAccelInfo") + 1400,
  );
  ok(/gpuAccelCache/.test(gpu), "하드웨어 가속 조회는 한 번만 한다");
  ok(/WEBGL_lose_context/.test(gpu), "조회 뒤 컨텍스트를 바로 정리한다");
}

console.log("\n[지연 표시] 화질 전환 중의 0 만 과도 상태로 다룬다");
{
  const watch = fs.readFileSync(
    path.join(root, "src/multiviewWatch.js"),
    "utf8",
  );
  ok(/qualityTransitions/.test(watch), "화질 전환 시각을 기록한다");
  ok(
    /QUALITY_TRANSITION_MAX_MS/.test(watch),
    "전환 상태가 영구히 남지 않도록 시간 제한이 있다",
  );
  const fn = watch.slice(
    watch.indexOf("function latencyText"),
    watch.indexOf("function latencyText") + 1200,
  );
  // ⚠ 지연 0 을 전역으로 무효 처리하면 실제로 0 에 가까운 방송까지 가려진다.
  //   전환 중인 칸에서만 과도 상태로 본다.
  ok(
    /qualityTransitions\.get\(channelId\)/.test(fn),
    "전환 중인 칸에서만 과도 상태로 본다",
  );
  ok(
    /qualityTransitions\.delete\(channelId\)/.test(fn),
    "쓸 수 있는 값이 오면 바로 전환 상태를 푼다",
  );
  ok(/"전환 중"/.test(fn), "전환 중에는 숫자 대신 안내를 보여 준다");
  // 통계 캐시를 통째로 지우면 해상도·비트레이트까지 '대기 중' 으로 깜빡인다.
  ok(
    !/statsByChannel\.delete|statsByChannel\.clear/.test(watch),
    "메인을 바꿔도 통계 캐시를 지우지 않는다",
  );
}

console.log("\n[볼륨 아이콘] 끄는 동안 패널을 다시 그리지 않는다");
{
  const watch = fs.readFileSync(
    path.join(root, "src/multiviewWatch.js"),
    "utf8",
  );
  ok(/function syncVolumeButton/.test(watch), "버튼 하나만 맞추는 함수가 있다");
  const handler = watch.slice(
    watch.indexOf('document.addEventListener("input"'),
    watch.indexOf('document.addEventListener("change"'),
  );
  ok(
    /syncVolumeButton\(channelId\)/.test(handler),
    "채널 슬라이더가 그 칸 아이콘을 바로 맞춘다",
  );
  ok(
    /syncAllVolumeButtons\(\)/.test(handler),
    "전체 볼륨은 모든 아이콘을 맞춘다",
  );
  // ⚠ 끄는 동안 renderVolume() 을 부르면 잡고 있는 range 가 교체돼 드래그가 끊긴다.
  //   포커스 자동 해제 분기(한 번만 일어난다)를 빼면 호출이 없어야 한다.
  const renders = handler.split("renderVolume()").length - 1;
  ok(renders <= 1, `슬라이더 처리에서 전체 재렌더가 없다(${renders}회)`);
}

console.log("\n[볼륨 protocol] 범위를 검증하고 video.volume 에만 건다");
{
  // 부모가 보내는 volume 은 0~1 의 실수여야 한다. 범위를 안 보면 1 보다 큰 값이
  // 그대로 video.volume 에 들어가 예외가 난다.
  ok(
    /data\.volume !== undefined/.test(content),
    "volume 은 없어도 되는 필드로 받는다(옛 형식과 섞여도 깨지지 않는다)",
  );
  ok(
    /!Number\.isFinite\(v\) \|\| v < 0 \|\| v > 1/.test(content),
    "volume 범위를 검증한다",
  );
  ok(
    /video\.volume = multiviewVolume/.test(content),
    "video.volume 에 적용한다",
  );
  // 멀티뷰 칸마다 새 AudioContext 를 만들면 6칸에서 비용이 커진다.
  const frameBlock = content.slice(
    content.indexOf("if (IS_MULTIVIEW_FRAME) {"),
    content.indexOf("if (IS_MULTIVIEW_FRAME) {") + 12000,
  );
  ok(
    !/new AudioContext|new \(window\.AudioContext/.test(frameBlock),
    "멀티뷰 칸에 새 AudioContext 를 만들지 않는다",
  );
}

console.log("\n[통계 protocol] 부모가 계산하지 않고 물어본다");
{
  const mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
  ok(/REQUEST_MULTIVIEW_STATS/.test(content), "칸이 통계 요청을 받는다");
  ok(/function getStreamStatsSnapshot/.test(mixer), "스냅샷 헬퍼가 있다");
  const snap = mixer.slice(mixer.indexOf("function getStreamStatsSnapshot"));
  // ⚠ 측정 방법을 새로 만들지 않는다. 기존 스트림 정보 패널과 같은 함수를 쓴다.
  ok(
    /collectStreamInfo\(\)/.test(snap),
    "기존 collectStreamInfo 를 재사용한다",
  );
  ok(
    /getLiveLatencySeconds\(\)/.test(snap),
    "지연도 기존 정의(_getLiveLatency)를 그대로 쓴다",
  );
  // 부모로 나가는 메시지는 반드시 정확한 출처로 보낸다.
  const relay = content.slice(
    content.indexOf("function requestMultiviewStats"),
    content.indexOf("function notifyParent"),
  );
  ok(
    /location\.origin/.test(relay) && !/"\*"/.test(relay),
    "같은 창 브리지도 * 를 쓰지 않는다",
  );
}

console.log("\n[모든 배치] 레터박스 없는 해가 있다");
{
  for (const layout of LAYOUTS.LAYOUTS) {
    ok(LAYOUTS.solveTracks(layout) !== null, `${layout.id}: 16:9 해가 있다`);
  }
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
