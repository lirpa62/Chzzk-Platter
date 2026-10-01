// 라이브 지연 자동 따라잡기 기준 시간(2~8초) 설정과, 치지직 자체 따라잡기 배속(1.03×)을
// 사용자 배속으로 치지 않는지 검증.
//
// 지연 6~7초 칸은 버퍼가 4초 안팎이라 치지직 플레이어가 1.03× 와 1× 를 오간다. 이것을
// 사용자 배속으로 보면 스트림 정보 패널이 '배속 사용 중' 과 '보정 불필요' 를 오가고,
// 그동안 따라잡기·자동 싱크에서도 빠진다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const S = require("../src/multiviewSync.js");
const watch = read("src/multiviewWatch.js");
const content = read("src/content.js");
const settingsHtml = read("settings.html");
const settingsJs = read("src/settings.js");
const watchHtml = read("multiviewWatch.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

// ── 치지직 자체 따라잡기 배속 ──────────────────────────────────────────────
check(S.isUserRate(1.03) === false, "치지직 자체 따라잡기(1.03×)는 사용자 배속이 아니다");
check(S.isUserRate(1) === false && S.isUserRate(null) === false, "1× 와 측정값 없음은 사용자 배속이 아니다");
check([1.25, 1.5, 2, 0.75, 0.5, 1.1].every((rate) => S.isUserRate(rate)),
  "치지직 배속 메뉴 값은 사용자 배속이다");
check(S.isUserRate(1.04) && S.isUserRate(1.02),
  "1.03 과 정확히 같지 않으면(자동 싱크 1.04 포함) 따로 판단한다");
check(S.rateOwnership(false, 1, 1.03).userOverride === false,
  "1.03× 로 바뀌어도 '배속 사용 중' 플래그가 서지 않는다");
check(S.rateOwnership(false, 1, 1.5).userOverride === true, "직접 고른 배속은 그대로 잡는다");
check(S.rateOwnership(true, 1.04, 1.04).owned === true, "자동 싱크가 건 배속 소유권은 그대로다");
{
  // 지연 6~7초 칸의 1초 측정 흐름: 치지직이 1.03 ↔ 1 을 오가도 상태가 바뀌지 않는다.
  const flags = [1, 1.03, 1.03, 1, 1.03, 1].map((rate) => S.rateOwnership(false, 1, rate).userOverride);
  check(flags.every((flag) => flag === false), "1.03 ↔ 1 을 오가도 패널 상태가 흔들리지 않는다");
}
check(/\(!syncRateOwned && MULTIVIEW_SYNC\.isUserRate\(video\.playbackRate\)\)/.test(content),
  "프레임: 치지직 1.03× 중에도 자동 싱크 배속 명령을 받는다");
check((watch.match(/SYNC\.isUserRate\(/g) || []).length >= 3 &&
  !/Math\.abs\([^)]*playbackRate[^)]*- 1\) >\s*SYNC\.LIMITS\.userRateEpsilon/.test(watch),
  "시청 화면: 싱크 라벨·자동 싱크 판단이 같은 기준을 쓴다");

// ── 기준 시간 ─────────────────────────────────────────────────────────────
check(S.CATCH_UP.limitSec === 8 && S.CATCH_UP.minLimitSec === 2, "기준 시간은 2~8초, 기본 8초");
check(S.catchUpLimit(undefined) === 8 && S.catchUpLimit(null) === 8 && S.catchUpLimit("x") === 8,
  "저장값이 없거나 이상하면 기본 8초");
check(S.catchUpLimit(1) === 2 && S.catchUpLimit(20) === 8 && S.catchUpLimit(4.4) === 4 &&
  S.catchUpLimit("5") === 5, "범위 밖은 자르고 정수로 맞춘다");
check(S.catchUpTarget(8) === 3 && S.catchUpTarget(4) === 3 && S.catchUpTarget(3) === 2 &&
  S.catchUpTarget(2) === 1.5, "목표 지연: 4초 이상은 3초, 그 아래는 기준보다 1초 앞(하한 1.5초)");
for (let limit = 2; limit <= 8; limit++) {
  check(S.catchUpTarget(limit) < limit, `기준 ${limit}초의 목표는 기준보다 작다`);
}
assert.deepEqual(S.catchUpTargets([{ id: "a", delaySec: 7 }], 8), []);
assert.deepEqual(S.catchUpTargets([{ id: "a", delaySec: 7 }], 5), [{ id: "a", targetDelaySec: 3 }]);
checks.push("같은 지연 7초도 기준 8초면 두고, 기준 5초면 옮긴다");
assert.deepEqual(S.catchUpTargets([{ id: "a", delaySec: 2.4 }], 2), [{ id: "a", targetDelaySec: 1.5 }]);
checks.push("기준 2초면 목표 1.5초로 옮긴다");
assert.deepEqual(S.catchUpTargets([{ id: "a", delaySec: 7.9 }]), []);
assert.deepEqual(S.catchUpTargets([{ id: "a", delaySec: 14.8 }]), [{ id: "a", targetDelaySec: 3 }]);
checks.push("기준을 넘기지 않으면 기존 동작(8초/3초) 그대로");
for (let limit = 2; limit <= 8; limit++) {
  for (const members of [
    [{ id: "a", delaySec: 30 }],
    [{ id: "a", delaySec: limit }, { id: "b", delaySec: limit + 9 }],
  ]) {
    for (const t of S.catchUpTargets(members, limit)) {
      check(t.targetDelaySec >= S.CATCH_UP.minTargetSec && t.targetDelaySec <= S.CATCH_UP.limitSec,
        `기준 ${limit}초 목표 ${t.targetDelaySec}초는 프레임 검증 범위 안이다`);
    }
  }
}
check(/data\.targetDelaySec < MULTIVIEW_SYNC\.CATCH_UP\.minTargetSec \|\|\s*data\.targetDelaySec > MULTIVIEW_SYNC\.CATCH_UP\.limitSec/.test(content),
  "프레임은 낮은 기준의 목표(1.5초~)도 받는다");

// ── 시청 화면 반영 ────────────────────────────────────────────────────────
check(/const LIVE_CATCH_UP_LIMIT_KEY = "cheeseMultiviewLiveCatchUpLimit";/.test(watch) &&
  /applyLiveCatchUpLimit\(data\[LIVE_CATCH_UP_LIMIT_KEY\]\)/.test(watch) &&
  /applyLiveCatchUpLimit\(changes\[LIVE_CATCH_UP_LIMIT_KEY\]\.newValue\)/.test(watch),
  "시청 화면은 기준 시간을 읽고, 바뀌면 바로 반영한다");
const tick = watch.slice(watch.indexOf("function tickLiveCatchUp("),
  watch.indexOf("function applySyncAlignDelays("));
check(/const limitSec = liveCatchUpLimitSec;/.test(tick) &&
  /SYNC\.catchUpTargets\([\s\S]*?limitSec,\s*\)/.test(tick),
  "판단 루프와 목표 계산이 설정한 기준을 쓴다");
check(/stats\.nativeDelaySec < liveCatchUpLimitSec\s*\) \{\s*catchUpHeld\.delete/.test(watch),
  "되감기 보류 해제도 같은 기준을 쓴다");
check(/if \(stats\.nativeDelaySec < liveCatchUpLimitSec\) return "보정 불필요";/.test(watch) &&
  (watch.match(/SYNC\.CATCH_UP\.limitSec/g) || []).length === 1 &&
  /let liveCatchUpLimitSec = SYNC\.CATCH_UP\.limitSec;/.test(watch),
  "스트림 정보 패널도 같은 기준으로 표시한다");
check(/id="mvStatsCatchUpLabel"/.test(watchHtml) &&
  /toggleLabel\.textContent = `자동 따라잡기 · \$\{liveCatchUpLimitSec\}초 이상`;/.test(watch),
  "패널 스위치 옆에 지금 기준을 보여 준다");

// ── 설정 화면 ─────────────────────────────────────────────────────────────
{
  const toggleAt = settingsHtml.indexOf("data-multiview-live-catch-up />");
  const limitAt = settingsHtml.indexOf("data-multiview-live-catch-up-limit-item");
  const nextAt = settingsHtml.indexOf('data-new-feature="multiview-sync-diagnostics"');
  check(toggleAt > 0 && limitAt > toggleAt && limitAt < nextAt,
    "설정 - 멀티뷰: 자동 따라잡기 바로 아래 하위 옵션으로 둔다");
  const item = settingsHtml.slice(limitAt, nextAt);
  check(/type="range"\s+min="2"\s+max="8"\s+step="1"\s+data-multiview-live-catch-up-limit\b/.test(item) &&
    /type="number"\s+min="2"\s+max="8"\s+step="1"/.test(item) &&
    /data-multiview-live-catch-up-limit-reset/.test(item),
    "슬라이더·숫자 입력·기본값 버튼(2~8초)");
}
check(/SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseMultiviewLiveCatchUpLimit"/.test(settingsJs) &&
  /if \(key === MULTIVIEW_CATCH_UP_LIMIT_KEY\) \{/.test(settingsJs),
  "설정 내보내기·불러오기에 들어가고 범위를 다시 자른다");
check(/cachedStorageSet\(\{ \[MULTIVIEW_CATCH_UP_LIMIT_KEY\]: v \}\);/.test(settingsJs) &&
  /classList\.toggle\("is-locked", off\)/.test(settingsJs),
  "바꾸면 저장하고, 따라잡기가 꺼져 있으면 잠근다");
{
  // 설정 화면의 자르기와 시청 화면의 자르기가 같다.
  const start = settingsJs.indexOf("  function normalizeCatchUpLimit(");
  const end = settingsJs.indexOf("\n  }\n", start);
  // eslint-disable-next-line no-new-func
  const normalize = new Function(
    "CATCH_UP_LIMIT_DEFAULT", "CATCH_UP_LIMIT_MIN", "CATCH_UP_LIMIT_MAX",
    `${settingsJs.slice(start, end + 4)}\nreturn normalizeCatchUpLimit;`,
  )(8, 2, 8);
  const samples = [undefined, null, "", "x", 0, 1, 2, 2.5, 3.4, 5, "6", 8, 9, 100, -3];
  check(samples.every((value) => normalize(value) === S.catchUpLimit(value)),
    "설정 화면과 시청 화면이 같은 값으로 자른다");
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
