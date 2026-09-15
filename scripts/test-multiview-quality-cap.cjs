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

if (failed) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
