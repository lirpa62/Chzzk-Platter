// 일부 특수/캠페인 LIVE 에서 관측되는 제한 신호 조합일 때만 우리 되감기 기능을
// 접는다.
//
// 관측된 신호(공식 보장 아님):
//   timeMachineActive: false
//   tvAppViewingPolicyType: "DENIED"
//   adParameter.tag: "none" 이 아닌 캠페인 태그
//
// ⚠ 세 조건을 모두 AND 로 본다. 하나만으로 막으면 일반 방송까지 되감기를 잃는다
//   (timeMachineActive=false 는 일반 방송에서도 관측된다).
// ⚠ adParameter.tag 는 '같이보기+ 전용 필드' 로 보장된 값이 아니다. 보조 신호로만
//   쓰고 단독 판정에 쓰지 않는다. 특정 캠페인명을 하드코딩하지도 않는다.
// ⚠ 값이 없거나 불명확하면 제한하지 않는다(fail-open).
const fs = require("node:fs");
const path = require("node:path");

const CONTENT = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);
const MIXER = fs.readFileSync(
  path.join(__dirname, "..", "src", "audioMixer.js"),
  "utf8",
);

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

// ⚠ 규칙을 손으로 베껴 두면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(src, name) {
  let at = src.indexOf(`  function ${name}(`);
  if (at < 0) at = src.indexOf(`  async function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = src.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return src.slice(at, end + 4);
}

const HELPERS = [
  CONTENT.slice(
    CONTENT.indexOf("  const LIVE_CAMPAIGN_TAG_NONE"),
    CONTENT.indexOf("\n", CONTENT.indexOf("  const LIVE_CAMPAIGN_TAG_NONE")),
  ),
  sliceFn(CONTENT, "hasSpecialLiveCampaignTag"),
  sliceFn(CONTENT, "isLiveRewindRestrictedByPolicy"),
].join("\n");

// ⚠ 여기서 판정 '내용' 을 확인하면, 규칙이 느슨해졌을 때 검사가 돌기도 전에
//   throw 되어 사보타주가 '실패 0건' 으로 보인다(실제로 그랬다). 구조만 본다.
if (!/timeMachineActive/.test(HELPERS) || !/adTag/.test(HELPERS)) {
  throw Error("떼어 낸 구간이 정책 판정부가 아니다");
}

// eslint-disable-next-line no-new-func
const api = new Function(
  HELPERS +
    "\nreturn { hasSpecialLiveCampaignTag, isLiveRewindRestrictedByPolicy };",
)();
const { hasSpecialLiveCampaignTag, isLiveRewindRestrictedByPolicy } = api;

// API 응답 모양 그대로 정규화(실제 코드가 하는 것과 같은 추출).
const policyOf = (status, detail) => ({
  timeMachineActive: status?.timeMachineActive,
  tvAppViewingPolicyType: status?.tvAppViewingPolicyType,
  adTag: detail?.adParameter?.tag,
});

console.log("[샘플] 관측된 조합");
{
  const NORMAL = policyOf(
    { timeMachineActive: false, tvAppViewingPolicyType: "ALLOWED" },
    { adParameter: { tag: "none" } },
  );
  ok(isLiveRewindRestrictedByPolicy(NORMAL) === false, "일반 LIVE → 제한 없음");

  const TV_DENIED_ONLY = policyOf(
    { timeMachineActive: true, tvAppViewingPolicyType: "DENIED" },
    { adParameter: { tag: "none" } },
  );
  ok(
    isLiveRewindRestrictedByPolicy(TV_DENIED_ONLY) === false,
    "TV DENIED 만으로는 제한하지 않는다",
  );

  const SPECIAL_TAG_ONLY = policyOf(
    { timeMachineActive: true, tvAppViewingPolicyType: "ALLOWED" },
    { adParameter: { tag: "asiangames" } },
  );
  ok(
    isLiveRewindRestrictedByPolicy(SPECIAL_TAG_ONLY) === false,
    "캠페인 태그만으로는 제한하지 않는다",
  );

  const TIMEMACHINE_OFF_ONLY = policyOf(
    { timeMachineActive: false, tvAppViewingPolicyType: "ALLOWED" },
    { adParameter: { tag: "none" } },
  );
  ok(
    isLiveRewindRestrictedByPolicy(TIMEMACHINE_OFF_ONLY) === false,
    "timeMachineActive=false 만으로는 제한하지 않는다",
  );

  const OBSERVED = policyOf(
    { timeMachineActive: false, tvAppViewingPolicyType: "DENIED" },
    { adParameter: { tag: "asiangames" } },
  );
  ok(
    isLiveRewindRestrictedByPolicy(OBSERVED) === true,
    "세 신호가 모두 명확할 때만 제한한다",
  );
}

console.log("\n[진리표] 8가지 조합");
{
  const rows = [
    [true, "ALLOWED", "none", false],
    [false, "ALLOWED", "none", false],
    [true, "DENIED", "none", false],
    [false, "DENIED", "none", false],
    [true, "DENIED", "asiangames", false],
    [false, "ALLOWED", "asiangames", false],
    [true, "ALLOWED", "asiangames", false],
    [false, "DENIED", "asiangames", true],
  ];
  for (const [tm, tv, tag, want] of rows) {
    const got = isLiveRewindRestrictedByPolicy({
      timeMachineActive: tm,
      tvAppViewingPolicyType: tv,
      adTag: tag,
    });
    ok(got === want, `${tm} | ${tv} | ${tag} → ${got} (기대 ${want})`);
  }
}

console.log("\n[불명확] 필드가 없거나 모르면 제한하지 않는다");
{
  ok(isLiveRewindRestrictedByPolicy({}) === false, "빈 객체 → false");
  ok(isLiveRewindRestrictedByPolicy(null) === false, "null → false");
  ok(isLiveRewindRestrictedByPolicy(undefined) === false, "undefined → false");
  // ⚠ !timeMachineActive 로 바꾸면 여기가 true 가 되어 일반 방송을 막는다.
  ok(
    isLiveRewindRestrictedByPolicy({
      timeMachineActive: undefined,
      tvAppViewingPolicyType: "DENIED",
      adTag: "asiangames",
    }) === false,
    "timeMachineActive 누락 → false",
  );
  ok(
    isLiveRewindRestrictedByPolicy({
      timeMachineActive: null,
      tvAppViewingPolicyType: "DENIED",
      adTag: "asiangames",
    }) === false,
    "timeMachineActive=null → false",
  );
  ok(
    isLiveRewindRestrictedByPolicy({
      timeMachineActive: false,
      tvAppViewingPolicyType: undefined,
      adTag: "asiangames",
    }) === false,
    "tvAppViewingPolicyType 누락 → false",
  );
  ok(
    isLiveRewindRestrictedByPolicy({
      timeMachineActive: false,
      tvAppViewingPolicyType: "DENIED",
    }) === false,
    "adParameter 없음 → false",
  );
  // fetch 실패로 아무 값도 못 받은 경우와 같은 모양.
  ok(
    isLiveRewindRestrictedByPolicy(policyOf(null, null)) === false,
    "두 API 모두 실패 → false(기존 동작 유지)",
  );
}

console.log("\n[태그 정규화]");
{
  for (const v of [undefined, null, "", "   ", "none", "NONE", " None "]) {
    ok(
      hasSpecialLiveCampaignTag(v) === false,
      `${JSON.stringify(v)} → 특수 태그 아님`,
    );
  }
  for (const v of ["asiangames", "lck", "special-event", "campaign_2026"]) {
    ok(
      hasSpecialLiveCampaignTag(v) === true,
      `${JSON.stringify(v)} → 특수 태그`,
    );
  }
  // 숫자·객체 등 비문자열
  ok(hasSpecialLiveCampaignTag(123) === false, "숫자 → 특수 태그 아님");
  ok(hasSpecialLiveCampaignTag({}) === false, "객체 → 특수 태그 아님");
}

console.log("\n[소스] 판정 규칙이 느슨해지지 않았다");
{
  const fn = sliceFn(CONTENT, "isLiveRewindRestrictedByPolicy");
  ok(/=== false/.test(fn), "timeMachineActive 를 === false 로 본다");
  // ⚠ truthy 판정으로 바뀌면 필드 누락을 '제한' 으로 오판한다.
  ok(
    !/!policy\.timeMachineActive/.test(fn),
    "truthy 판정(!timeMachineActive)을 쓰지 않는다",
  );
  ok(/"DENIED"/.test(fn), "tvAppViewingPolicyType 를 함께 본다");
  ok(/hasSpecialLiveCampaignTag/.test(fn), "캠페인 태그를 함께 본다");
  // 세 조건이 모두 AND 로 묶였는지(느슨해지면 진리표가 깨진다).
  const ret = fn.slice(fn.indexOf("return ("));
  ok(
    (ret.match(/&&/g) || []).length >= 2 && !/\|\|/.test(ret),
    "세 조건을 AND 로 묶는다",
  );
  // 특정 캠페인명을 하드코딩하지 않는다.
  ok(
    !/asiangames/i.test(CONTENT),
    "특정 캠페인명을 소스에 하드코딩하지 않는다",
  );
  // 제목/카테고리 텍스트 heuristic 금지.
  const tagFn = sliceFn(CONTENT, "hasSpecialLiveCampaignTag");
  ok(
    !/같이보기|watch ?party/i.test(tagFn),
    "방송 제목·문자열 heuristic 을 쓰지 않는다",
  );
}

console.log("\n[저장 금지] 정책을 storage 에 남기지 않는다");
{
  // ⚠ 방송별 동적 값이라 저장하면 다음 방송에 잘못 적용된다.
  ok(
    !/rewindRestricted["']?\s*:/.test(
      CONTENT.replace(/liveRewindRestricted/g, ""),
    ),
    "storage 키로 저장하지 않는다",
  );
  const cacheDecl = CONTENT.slice(
    CONTENT.indexOf("const liveRewindPolicyCache"),
    CONTENT.indexOf("const liveRewindPolicyCache") + 200,
  );
  ok(/new Map\(\)/.test(cacheDecl), "런타임 Map 캐시만 쓴다");
}

console.log("\n[캐시 단위] 채널이 아니라 방송 단위다");
{
  const keyFn = sliceFn(CONTENT, "liveRewindPolicyPageKey");
  ok(/live:/.test(keyFn), "live:<id> 를 키로 쓴다");
  const ensure = sliceFn(CONTENT, "ensureLiveRewindPolicy");
  // ⚠ 늦게 온 응답을 다른 방송에 적용하면 안 된다.
  ok(
    /liveRewindPolicyPageKey\(\) !== key/.test(ensure),
    "응답 적용 전 방송이 바뀌었는지 확인한다(stale guard)",
  );
  ok(/liveRewindPolicyFetching/.test(ensure), "중복 요청을 막는다");
  ok(
    /LIVE_REWIND_POLICY_TTL_MS/.test(ensure),
    "캐시 TTL 안에서는 다시 요청하지 않는다",
  );
  ok(!/setInterval/.test(ensure), "폴링하지 않는다");
  ok(
    /if \(!status && !detail\) return;/.test(ensure),
    "두 응답 모두 실패하면 아무것도 바꾸지 않는다",
  );
}

console.log("\n[MAIN world] 되감기만 막고 앞으로·따라잡기는 두다");
{
  const seekBy = sliceFn(MIXER, "seekBy");
  ok(
    /if \(!forward && w\.mode === "live" && liveRewindRestricted\) return;/.test(
      seekBy,
    ),
    "실행 지점에서 과거 이동만 막는다",
  );
  // ⚠ forward 까지 막으면 이미 과거에 있는 사용자가 현재로 못 돌아온다.
  ok(
    !/if \(liveRewindRestricted\) return;/.test(seekBy),
    "방향 구분 없이 막지 않는다",
  );

  const barSeek = sliceFn(MIXER, "seekBarSeekTo");
  ok(
    /back && w\.mode === "live" && liveRewindRestricted/.test(barSeek),
    "바 드래그의 과거 이동도 막는다",
  );

  const ensureBar = sliceFn(MIXER, "ensureSeekBar");
  ok(
    /liveRewindRestricted/.test(ensureBar),
    "제한 방송에서는 되감기 바를 접는다",
  );
  ok(/removeSeekBar\(\)/.test(ensureBar), "기존 제거 경로를 재사용한다");

  const ensureButtons = sliceFn(MIXER, "ensureSeekButtons");
  ok(/hideRewind/.test(ensureButtons), "제한 방송에서는 되감기 버튼을 뺀다");
  ok(/FORWARD_BUTTON_CLASS/.test(ensureButtons), "앞으로 버튼은 그대로 만든다");
  // ⚠ 따라잡기(Live Sync)는 이번 제한 대상이 아니다.
  const syncFn = MIXER.slice(
    MIXER.indexOf("function ensureSyncButton"),
    MIXER.indexOf("function ensureSyncButton") + 1200,
  );
  ok(
    !/liveRewindRestricted/.test(syncFn),
    "따라잡기 버튼은 정책 영향을 받지 않는다",
  );

  // 멈춤 복구는 '되감기 capability' 와 다른 문제다(방송 종료·버퍼 복구).
  const stall = MIXER.slice(
    MIXER.indexOf("function recoverFromStall"),
    MIXER.indexOf("function recoverFromStall") + 1500,
  );
  ok(!/liveRewindRestricted/.test(stall), "멈춤 복구에는 정책을 섞지 않는다");

  // 네이티브 플레이어 UI 는 건드리지 않는다.
  ok(
    !/pzp-pc__seek|timemachine/i.test(ensureBar + ensureButtons) ||
      /hasChzzkTimemachine/.test(ensureBar),
    "치지직 네이티브 UI 를 새로 숨기지 않는다",
  );
}

console.log("\n[설정 회귀] 사용자 설정 의미를 뒤집지 않는다");
{
  // liveRewind(버튼 숨김)와 liveSeekBarOn(바 표시)의 기존 판정은 그대로다.
  const ensureButtons = sliceFn(MIXER, "ensureSeekButtons");
  ok(
    /!featureFlags\.liveRewind/.test(ensureButtons),
    "기존 버튼 숨김 설정이 그대로 먼저 적용된다",
  );
  const ensureBar = sliceFn(MIXER, "ensureSeekBar");
  ok(
    /if \(!liveSeekBarOn\)/.test(ensureBar),
    "바 표시 설정이 그대로 먼저 적용된다",
  );
  // 정책은 설정값을 덮어쓰지 않는다(별도 변수).
  ok(
    /let liveRewindRestricted = false;/.test(MIXER),
    "정책을 featureFlags 와 분리된 런타임 값으로 둔다",
  );
  ok(
    !/featureFlags\.liveRewind = .*liveRewindRestricted/.test(MIXER),
    "정책이 사용자 설정값을 덮어쓰지 않는다",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
