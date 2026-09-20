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

// ── 부모가 내리는 화질 정책 ───────────────────────────────────────────────
// "메인 고화질 · 보조 480p" 가 켜져도 모든 칸이 고화질로 나오던 문제가 있었다.
// 이 정책은 시작할 때만이 아니라 '지금 이 칸의 역할' 에 따라 계속 적용된다.
// 부모가 무엇을 보내는지부터 고정해 둔다.
console.log("\n[정책] 메인만 고화질 설정에 따라 칸마다 다른 지시가 나간다");
{
  // multiviewWatch.js 의 frameUrl / postState 와 같은 규칙.
  const urlQuality = (isMain, high) => (isMain && high ? null : "480");
  const postQuality = (isMain, high) => (isMain && high ? "high" : "480");

  const cases = [
    ["켜짐 · 메인", true, true, null, "high"],
    ["켜짐 · 보조", false, true, "480", "480"],
    ["꺼짐 · 메인", true, false, "480", "480"],
    ["꺼짐 · 보조", false, false, "480", "480"],
  ];
  for (const [label, isMain, high, wantUrl, wantPost] of cases) {
    const u = urlQuality(isMain, high);
    const q = postQuality(isMain, high);
    try {
      assert.strictEqual(u, wantUrl);
      assert.strictEqual(q, wantPost);
      console.log(`  PASS ${label}: 주소=${u ?? "상한없음"} 지시=${q}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${label}: 주소=${u} 지시=${q}`);
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
  const isManual = (cap, selH, setH, userTouched) => {
    const deviated = cap > 0 ? selH !== setH : selH < setH;
    const userChose = cap > 0 ? userTouched : true;
    return setH > 0 && selH > 0 && deviated && userChose;
  };

  const cases = [
    // [설명, 상한, 선택높이, 우리가고정한높이, 신뢰된조작, 기대]
    [
      "상한 480 · 치지직이 1080 으로 되돌림(조작 없음)",
      480,
      1080,
      480,
      false,
      false,
    ],
    ["상한 480 · 사용자가 메뉴에서 1080 선택", 480, 1080, 480, true, true],
    ["상한 480 · 그대로 480", 480, 480, 480, false, false],
    ["상한 없음 · 더 낮아짐(기존 규칙 유지)", 0, 480, 1080, false, true],
    ["상한 없음 · 더 높아짐(우리 동작)", 0, 1080, 720, false, false],
  ];
  for (const [label, cap, selH, setH, touched, expected] of cases) {
    const got = isManual(cap, selH, setH, touched);
    try {
      assert.strictEqual(got, expected);
      console.log(`  PASS ${label}`);
    } catch {
      failed += 1;
      console.log(`  FAIL ${label}: 기대 ${expected}, 실제 ${got}`);
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
