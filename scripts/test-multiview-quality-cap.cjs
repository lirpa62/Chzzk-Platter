// 멀티뷰 화질 상한 선택 로직 검증.
//
// audioMixer.js 의 applyMaxQuality 안에서 '어떤 트랙을 고를지' 정하는 부분만
// 떼어내 검증한다. 플레이어/DOM 에 의존하는 나머지(안전 게이트, 메뉴 클릭)는
// 실측으로만 확인 가능하므로 여기서는 순수 선택 규칙만 다룬다.
//
// 규칙:
//  - 상한 0  → 가장 높은 트랙(기존 '최대 화질 고정' 동작 그대로)
//  - 상한 N  → N 이하 중 가장 높은 트랙
//  - 상한 N 인데 N 이하가 없으면 → 가장 낮은 트랙(상한을 넘겨 트는 것보다 낫다)

const assert = require("assert");
const fs = require("node:fs");
const path = require("node:path");

// applyMaxQuality 의 선택부와 같은 규칙.
function pickTrack(heights, cap) {
  const fixed = heights.filter((h) => h > 0);
  if (!fixed.length) return 0;
  let best = null;
  for (const h of fixed) {
    if (cap > 0 && h > cap) continue;
    if (best === null || h > best) best = h;
  }
  if (best === null && cap > 0) {
    for (const h of fixed) if (best === null || h < best) best = h;
  }
  return best;
}

const CHZZK = [144, 360, 480, 720, 1080];
const tests = [
  ["상한 없음이면 최고 화질", CHZZK, 0, 1080],
  ["480 상한이면 480", CHZZK, 480, 480],
  ["상한과 정확히 같은 트랙이 있으면 그것", CHZZK, 720, 720],
  ["상한 사이 값이면 그 아래 중 최고", CHZZK, 600, 480],
  ["상한이 최저보다 낮으면 최저 트랙", CHZZK, 100, 144],
  ["트랙이 하나뿐이면 상한과 무관하게 그것", [1080], 480, 1080],
  ["상한이 최고보다 높으면 최고", CHZZK, 2160, 1080],
];

let failed = 0;
for (const [label, heights, cap, expected] of tests) {
  const got = pickTrack(heights, cap);
  try {
    assert.strictEqual(got, expected);
    console.log(`  PASS ${label} (상한 ${cap} → ${got}p)`);
  } catch {
    failed += 1;
    console.log(`  FAIL ${label}: 기대 ${expected}, 실제 ${got}`);
  }
}

// 멱등 판정: 상한이 있으면 '더 높아도 통과'하면 안 된다. 상한 아래로 내려야 하므로
// 동등 비교여야 한다(상한 없을 때는 기존대로 '이상이면 통과').
function isSatisfied(selectedH, targetH, cap) {
  return cap > 0 ? selectedH === targetH : selectedH >= targetH;
}
const idempotent = [
  [
    "상한 있음: 1080 선택 상태는 480 목표를 만족하지 않는다",
    1080,
    480,
    480,
    false,
  ],
  ["상한 있음: 480 선택 상태는 만족", 480, 480, 480, true],
  ["상한 없음: 더 높으면 만족", 1080, 720, 0, true],
];
for (const [label, sel, target, cap, expected] of idempotent) {
  const got = isSatisfied(sel, target, cap);
  try {
    assert.strictEqual(got, expected);
    console.log(`  PASS ${label}`);
  } catch {
    failed += 1;
    console.log(`  FAIL ${label}: 기대 ${expected}, 실제 ${got}`);
  }
}

// ── 부모가 내리는 화질 정책 ───────────────────────────────────────────────
// 옵션이 켜져도 부모는 이후 역할 변경 때 고정 정책을 반복하지 않는다.
console.log("\n[정책] 메인 고화질 옵션은 iframe 시작 목표로만 전달한다");
{
  // multiviewWatch.js 의 initialQualityForChannel / qualityForChannel 과 같은 규칙.
  const initialQuality = (isMain, high, isVideo) =>
    !high ? "" : isMain ? "highest" : isVideo ? "cap-720" : "cap-480";
  const postQuality = (isMain, high, isVideo) =>
    high ? "native" : isVideo ? "cap-720" : isMain ? "native" : "cap-480";

  const cases = [
    ["라이브 · 켜짐 · 메인", true, true, false, "highest", "native"],
    ["라이브 · 켜짐 · 보조", false, true, false, "cap-480", "native"],
    ["라이브 · 꺼짐 · 메인", true, false, false, "", "native"],
    ["라이브 · 꺼짐 · 보조", false, false, false, "", "cap-480"],
    ["다시보기 · 켜짐 · 메인", true, true, true, "highest", "native"],
    ["다시보기 · 켜짐 · 보조", false, true, true, "cap-720", "native"],
    ["다시보기 · 꺼짐 · 메인", true, false, true, "", "cap-720"],
    ["다시보기 · 꺼짐 · 보조", false, false, true, "", "cap-720"],
  ];
  for (const [label, isMain, high, isVideo, wantInitial, wantPost] of cases) {
    const initial = initialQuality(isMain, high, isVideo);
    const q = postQuality(isMain, high, isVideo);
    try {
      assert.strictEqual(initial, wantInitial);
      assert.strictEqual(q, wantPost);
      console.log(`  PASS ${label}: 초기=${initial || "없음"} 이후=${q}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${label}: 초기=${initial} 이후=${q}`);
    }
  }
}

// ── 수동 화질 존중의 오판 ─────────────────────────────────────────────────
// 상한이 걸린 칸에서 '선택 트랙이 우리가 고정한 값과 다르다' 만으로 수동 변경으로
// 보면, 치지직이 스스로 ABR·재연결로 되돌린 것까지 사용자 선택으로 오해한다.
// 그러면 그 미디어 동안 상한 재적용이 영구히 멈춰 보조 칸이 1080p 로 남는다.
console.log("\n[수동 존중] 신뢰된 조작이 있을 때만 사용자 선택으로 본다");
{
  // audioMixer.js 의 판정과 같은 규칙.
  const isManual = (policy, cap, selH, setH, userTouched) => {
    const deviated = cap > 0 ? selH !== setH : selH < setH;
    const userChose = policy !== "none" || cap > 0 ? userTouched : true;
    return setH > 0 && selH > 0 && deviated && userChose;
  };

  const cases = [
    // [설명, 상한, 선택높이, 우리가고정한높이, 신뢰된조작, 기대]
    [
      "상한 480 · 치지직이 1080 으로 되돌림(조작 없음)",
      "cap-480", 480,
      1080,
      480,
      false,
      false,
    ],
    ["상한 480 · 사용자가 메뉴에서 1080 선택", "cap-480", 480, 1080, 480, true, true],
    ["상한 480 · 그대로 480", "cap-480", 480, 480, 480, false, false],
    ["멀티뷰 최고 · 플레이어가 480으로 복귀(조작 없음)", "highest", 0, 480, 1080, false, false],
    ["멀티뷰 최고 · 사용자가 720 선택", "highest", 0, 720, 1080, true, true],
    ["일반 상한 없음 · 더 낮아짐(기존 규칙 유지)", "none", 0, 480, 1080, false, true],
    ["일반 상한 없음 · 더 높아짐(우리 동작)", "none", 0, 1080, 720, false, false],
  ];
  for (const [label, policy, cap, selH, setH, touched, expected] of cases) {
    const got = isManual(policy, cap, selH, setH, touched);
    try {
      assert.strictEqual(got, expected);
      console.log(`  PASS ${label}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${label}: 기대 ${expected}, 실제 ${got}`);
    }
  }
}

console.log("\n[수명주기] 역할·video/source·광고 종료에서만 정책을 다시 확인한다");
{
  const root = path.join(__dirname, "..");
  const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
  const watch = fs.readFileSync(path.join(root, "src/multiviewWatch.js"), "utf8");
  const mixer = fs.readFileSync(path.join(root, "src/audioMixer.js"), "utf8");
  const checks = [
    [content.includes('"highest", "cap-480", "cap-720", "native"'), "라이브/다시보기 기본 화질 정책 값"],
    [/function resolveMaxQualityAuto\(\)[\s\S]*?multiviewInitialQuality !== "none"\s*\?\s*maxQualityAuto/.test(content), "초기 1회 모드 뒤에는 전역 자동 고정 설정을 따른다"],
    [mixer.includes('"highest", "cap-480", "cap-720", "native"'), "MAIN 플레이어가 기본 화질 정책을 수용"],
    [/multiviewPolicyActive = \["highest", "cap-480", "cap-720"\]\.includes/.test(mixer), "기본 화질은 강제 정책으로 취급하지 않음"],
    [/\(multiviewPolicyActive \|\| oneShotQualityActive\) &&\s*Date\.now\(\) - maxQualityMenuClickAt < 1500/.test(mixer), "고정·초기 화질 적용의 메뉴 재시도 간격을 제한"],
    [/if \(multiviewPolicyActive \|\| oneShotQualityActive\) \{[\s\S]*?return;\s*\}/.test(mixer), "멀티뷰 화질은 내부 트랙 직접 선택으로 우회하지 않음"],
    [/attachMultiviewVideo[\s\S]*?reconcileMultiviewQuality\(\)/.test(content), "새 video attach 재확인"],
    [/onMultiviewSourceReady[\s\S]*?syncVideoGeneration \+= 1[\s\S]*?reconcileMultiviewQuality\(\)/.test(content), "같은 video source 변경 재확인"],
    [/function frameUrl\(channel,[\s\S]*?const isVideo = channel\.mediaType === "video";[\s\S]*?const url = new URL\(\s*isVideo \?/.test(watch), "frameUrl 에서 라이브/다시보기 유형을 자체 판별"],
    [/previous && !next\) \{[\s\S]*?reconcileMultiviewQuality\(\)/.test(content), "광고 종료 재확인"],
    [/qualityChanged \|\| forceQualityReconcile\) reconcileMultiviewQuality\(\)/.test(content), "역할/부모 요청 재확인"],
    [/qualityPolicy,/.test(watch), "부모가 명시적 정책 전달"],
    [/multiviewLifecycleChanged[\s\S]*?maxQualitySetHeight = 0/.test(mixer), "기존 역할 고정 정책의 lifecycle 초기화 유지"],
    [/multiviewInitialQualityApplied = true/.test(mixer), "초기 목표 적용 후 재적용을 막는 상태를 기록"],
    [/multiviewInitialQualityApplied &&\s*multiviewInitialGlobalPending &&\s*maxQualityAuto &&\s*maxQualityRespectManual &&\s*maxQualityUserTouchedPage === currentPageKey/.test(mixer), "전역 자동 고정의 수동 화질 존중 설정을 적용"],
    [/multiviewInitialGlobalPending/.test(mixer), "전역 고정 후속 목표가 안정화 전까지 재시도 상태를 유지"],
    [/multiviewInitialQuality !== "none" && maxQualityAuto && maxQualityTarget === "720"/.test(content), "전역 720p 상한이 초기 목표 후 적용될 수 있음"],
    [!/setInterval\([^)]*reconcileMultiviewQuality/.test(content), "화질 전용 반복 polling 없음"],
  ];
  for (const [passed, label] of checks) {
    try {
      assert.ok(passed, label);
      console.log(`  PASS ${label}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${label}`);
    }
  }
}

// ── 비트레이트 단위 ───────────────────────────────────────────────────────
// 치지직은 bps 로 줄 때도 kbps 로 줄 때도 있다. toKbps() 가 그 판정을 하므로
// 반드시 거쳐야 한다. 직접 /1000 하면 이미 kbps 인 값이 1000배 작아진다.
console.log("\n[비트레이트] toKbps 로 단위를 맞춘다");
{
  // audioMixer.js 의 toKbps 와 같다.
  const toKbps = (n) => {
    if (!Number.isFinite(n) || n <= 0) return null;
    return n >= 100000 ? Math.round(n / 1000) : Math.round(n);
  };
  // multiviewWatch.js 의 표시 규칙과 같다.
  const show = (v) => {
    if (!Number.isFinite(v) || v <= 0) return "-";
    return v >= 1000
      ? `${(v / 1000).toFixed(1)} Mbps`
      : `${Math.round(v)} kbps`;
  };

  const cases = [
    ["bps 로 온 8Mbps", 8000000, 8000, "8.0 Mbps"],
    ["bps 로 온 1.5Mbps", 1500000, 1500, "1.5 Mbps"],
    ["이미 kbps 인 1500", 1500, 1500, "1.5 Mbps"],
    ["이미 kbps 인 800", 800, 800, "800 kbps"],
    ["값 없음", 0, null, "-"],
  ];
  for (const [label, raw, wantKbps, wantText] of cases) {
    const kbps = toKbps(raw);
    const text = show(kbps);
    try {
      assert.strictEqual(kbps, wantKbps);
      assert.strictEqual(text, wantText);
      console.log(`  PASS ${label} → ${text}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${label}: kbps=${kbps} 표시=${text}`);
    }
  }
}

if (failed) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
