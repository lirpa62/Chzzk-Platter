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

console.log("\n[탭 전환] visibilitychange 로 다시 불러오지 않는다");
{
  // 진단 기록은 남겨도 되지만, 거기서 reload 하거나 play() 를 억지로 부르면 안 된다.
  const start = content.indexOf("const traceLife =");
  ok(start > 0, "탭 전환 진단 기록이 있다");
  // 기록 블록만 본다(그 뒤의 소리 처리 코드까지 넘어가면 엉뚱한 것을 잡는다).
  const end = content.indexOf("let muteOverriddenByUser", start);
  ok(end > start, "진단 기록 블록의 끝을 찾았다");
  const block = content.slice(start, end);
  ok(!block.includes("location.reload"), "진단 기록이 다시 불러오지 않는다");
  ok(!/\.play\(\)/.test(block), "진단 기록이 재생을 억지로 부르지 않는다");
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
  // 프레임(멀티뷰 블록): 같은 확인.
  const at = content.indexOf("if (IS_MULTIVIEW_FRAME) {");
  ok(at > 0, "멀티뷰 프레임 블록을 찾았다");
  const block = content.slice(at, at + 14000);
  for (const [pat, label] of [
    ["location.reload", "다시 불러오기"],
    ["currentTime =", "재생 위치 대입"],
    ["fastSeek", "seek"],
    ["jumpToLiveEdge", "라이브 엣지 점프"],
  ]) {
    ok(!block.includes(pat), `멀티뷰 칸에 ${label} 가 없다`);
  }
}

console.log("\n[진단] 평상시에는 아무 로그도 내지 않는다");
{
  const watch = fs.readFileSync(
    path.join(root, "src/multiviewWatch.js"),
    "utf8",
  );
  // mvTrace 가 꺼져 있으면 traceLog 는 바로 돌아간다.
  const fn = watch.slice(
    watch.indexOf("const traceLog ="),
    watch.indexOf("const traceLog =") + 160,
  );
  ok(/if \(!mvTrace\) return;/.test(fn), "traceLog 는 진단 모드에서만 찍는다");
  ok(
    /localStorage\.getItem\("cheeseMultiviewTrace"\)/.test(watch),
    "진단 모드는 cheeseMultiviewTrace 로 켠다",
  );
  // FRAME_READY 카운터는 진단용이고, 이 값으로 무엇을 자동으로 고치지 않는다.
  ok(/frameReadyCounts/.test(watch), "FRAME_READY 횟수를 센다");
  const uses = watch.split("frameReadyCounts").length - 1;
  ok(uses <= 5, `카운터 사용처가 진단 범위다(${uses}곳)`);
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
