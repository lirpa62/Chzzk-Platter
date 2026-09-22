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
  sliceFn(CONTENT, "resolveLiveRewindPolicy"),
].join("\n");

// ⚠ 여기서 판정 '내용' 을 확인하면, 규칙이 느슨해졌을 때 검사가 돌기도 전에
//   throw 되어 사보타주가 '실패 0건' 으로 보인다(실제로 그랬다). 구조만 본다.
if (!/timeMachineActive/.test(HELPERS) || !/adTag/.test(HELPERS)) {
  throw Error("떼어 낸 구간이 정책 판정부가 아니다");
}

// eslint-disable-next-line no-new-func
const api = new Function(
  HELPERS +
    "\nreturn { hasSpecialLiveCampaignTag, isLiveRewindRestrictedByPolicy," +
    " resolveLiveRewindPolicy };",
)();
const {
  hasSpecialLiveCampaignTag,
  isLiveRewindRestrictedByPolicy,
  resolveLiveRewindPolicy,
} = api;

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

console.log("\n[실제 샘플] 아시안게임 live-status 로 제한이 확정된다");
{
  // 제보로 받은 실제 응답 모양 그대로.
  const restrictedStatus = {
    code: 200,
    content: {
      status: "OPEN",
      channelId: "0dc9b1e1f0d5c2a3b4c5d6e7f8091a2b",
      openDate: "2026-09-22 09:49:58",
      clipActive: true,
      watchPartyNo: 520,
      watchPartyTag: "2026아시안게임",
      watchPartyType: "RS",
      adParameter: { tag: "asiangames" },
      timeMachineActive: false,
      tvAppViewingPolicyType: "DENIED",
    },
  };
  const r = resolveLiveRewindPolicy(restrictedStatus.content);
  ok(r.known === true, "세 필드가 모두 있으므로 확정(known)");
  ok(r.restricted === true, `제한으로 판정한다 (restricted=${r.restricted})`);

  // watchPartyNo 가 없고 clipActive 가 다른 방송도 동일해야 한다.
  const other = resolveLiveRewindPolicy({
    ...restrictedStatus.content,
    clipActive: false,
    watchPartyNo: null,
    watchPartyTag: null,
    watchPartyType: null,
  });
  ok(other.restricted === true, "watchPartyNo/clipActive 와 무관하게 제한");

  // ⚠ 이 둘을 조건에 몰래 넣지 않았는지 고정한다.
  const fn = sliceFn(CONTENT, "isLiveRewindRestrictedByPolicy");
  const resolver = sliceFn(CONTENT, "resolveLiveRewindPolicy");
  ok(!/clipActive/.test(fn + resolver), "clipActive 를 판정에 넣지 않는다");
  ok(!/watchParty/.test(fn + resolver), "watchParty 값을 판정에 넣지 않는다");
}

console.log("\n[known / unknown] 불완전한 응답을 '정상' 으로 확정하지 않는다");
{
  // 필드가 하나라도 없으면 unknown — 나중에 다시 확인해야 한다.
  for (const [label, c] of [
    ["빈 객체", {}],
    [
      "태그 없음",
      { timeMachineActive: false, tvAppViewingPolicyType: "DENIED" },
    ],
    [
      "tv 정책 없음",
      { timeMachineActive: false, adParameter: { tag: "asiangames" } },
    ],
    [
      "타임머신 값 없음",
      {
        tvAppViewingPolicyType: "DENIED",
        adParameter: { tag: "asiangames" },
      },
    ],
    ["content 없음", undefined],
    ["null", null],
  ]) {
    const r = resolveLiveRewindPolicy(c);
    ok(r.known === false, `${label} → 확정하지 않음(known=false)`);
    ok(r.restricted === false, `${label} → 사용자에겐 제한 없음`);
  }
  // ⚠ tag "none" 은 '값이 있는' 경우다. 확정된 '제한 없음' 이라 unknown 이 아니다.
  const none = resolveLiveRewindPolicy({
    timeMachineActive: false,
    tvAppViewingPolicyType: "DENIED",
    adParameter: { tag: "none" },
  });
  ok(none.known === true, 'tag "none" 은 확정된 값이다');
  ok(none.restricted === false, 'tag "none" 은 제한하지 않는다');
}

console.log("\n[단일 소스] 정책은 live-status 만으로 판정한다");
{
  const ensure = sliceFn(CONTENT, "ensureLiveRewindPolicy");
  // ⚠ 예전에는 태그만 live-detail 에서 읽어, detail 이 실패하면 제한 방송을
  //   놓쳤다(실행으로 재현). 정책 경로에서 detail 을 부르지 않는다.
  // ⚠ 주석에 'live-detail' 이라는 말이 나올 수 있으므로 주석을 뺀 코드만 본다.
  const ensureCode = ensure
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  ok(
    !/live-detail/.test(ensureCode),
    "정책 경로가 live-detail 을 요청하지 않는다",
  );
  ok(/live-status/.test(ensure), "live-status 를 읽는다");
  ok(
    (ensure.match(/fetch\(/g) || []).length === 1,
    `정책 확인 요청은 1개다 (${(ensure.match(/fetch\(/g) || []).length})`,
  );
  // 태그를 status 응답에서 읽는지(resolver 가 content.adParameter 를 본다).
  const resolver = sliceFn(CONTENT, "resolveLiveRewindPolicy");
  ok(
    /content\.adParameter\?\.tag/.test(resolver),
    "adParameter 를 live-status content 에서 읽는다",
  );
}

console.log("\n[캐시 단위] 채널이 아니라 방송(openDate) 단위다");
{
  const sessionFn = sliceFn(CONTENT, "liveRewindPolicySessionKey");
  // ⚠ channelId 만 쓰면 같은 채널의 '다음 방송' 에 이전 판정이 그대로 붙는다.
  ok(/openDate/.test(sessionFn), "openDate 를 방송 식별자에 쓴다");
  ok(/channelId/.test(sessionFn), "채널도 함께 쓴다");
  // 같은 채널, 다른 방송이면 키가 달라야 한다.
  const mkKey = new Function(
    "currentLiveChannelId",
    sessionFn + "\nreturn liveRewindPolicySessionKey;",
  )(() => "chan1");
  const a = mkKey({ channelId: "chan1", openDate: "2026-09-22 10:00:00" });
  const b = mkKey({ channelId: "chan1", openDate: "2026-09-22 12:00:00" });
  ok(a !== b, `같은 채널 다른 방송은 키가 다르다 (${a} vs ${b})`);
  ok(
    a === mkKey({ channelId: "chan1", openDate: "2026-09-22 10:00:00" }),
    "같은 방송은 같은 키",
  );

  const ensure = sliceFn(CONTENT, "ensureLiveRewindPolicy");
  // ⚠ 늦게 온 응답을 다른 채널에 적용하면 안 된다.
  ok(
    /liveRewindPolicyPageKey\(\) !== key/.test(ensure),
    "응답 적용 전 채널이 바뀌었는지 확인한다(stale guard)",
  );
  ok(/liveRewindPolicyFetching/.test(ensure), "중복 요청을 막는다");
  ok(
    /LIVE_REWIND_POLICY_TTL_MS/.test(ensure),
    "확정된 결과는 TTL 안에서 재사용한다",
  );
  ok(!/setInterval/.test(ensure), "폴링하지 않는다");
  // 확정하지 못한 경우는 짧은 쿨다운만 두고 다시 시도한다.
  ok(
    /if \(!known\)/.test(ensure) && /LIVE_REWIND_POLICY_RETRY_MS/.test(ensure),
    "확정하지 못하면 쿨다운 뒤 재시도한다",
  );
  // ⚠ unknown 을 TTL 캐시에 넣으면 5분간 '정상 방송' 으로 굳는다.
  const unknownBlock = ensure.slice(
    ensure.indexOf("if (!known)"),
    ensure.indexOf("liveRewindPolicyRetryAt.delete"),
  );
  ok(
    !/liveRewindPolicyCache\.set/.test(unknownBlock),
    "확정하지 못한 결과를 캐시에 넣지 않는다",
  );
  // 채널이 바뀌면 이전 판정을 버린다.
  ok(
    /liveRewindPolicyChannel !== channelId/.test(ensure),
    "채널이 바뀌면 이전 방송 판정을 버린다",
  );
  const cur = sliceFn(CONTENT, "currentLiveRewindRestricted");
  ok(
    /liveRewindPolicyChannel !== currentLiveChannelId\(\)/.test(cur),
    "다른 채널에서는 이전 판정을 쓰지 않는다",
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

  // ⚠ 조건은 shouldShowLiveSeekBar() 로 모았다(표시 판정과 안정 판정이 서로
  //   다른 조건을 쓰다가 tick 이 영원히 불안정해진 적이 있다).
  const ensureBar = sliceFn(MIXER, "ensureSeekBar");
  const shouldBar = sliceFn(MIXER, "shouldShowLiveSeekBar");
  ok(
    /liveRewindRestricted/.test(shouldBar),
    "제한 방송에서는 되감기 바를 접는다",
  );
  ok(
    /if \(!shouldShowLiveSeekBar\(\)\)/.test(ensureBar),
    "ensureSeekBar 가 그 판정을 쓴다",
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

console.log("\n[전 구간] fetch → 판정 → 브리지 payload 까지 이어진다");
{
  // ⚠ helper 만 맞아도 이번 버그는 발생했다(태그를 다른 응답에서 읽었다).
  //   실제 ensureLiveRewindPolicy 를 돌려 payload 까지 확인한다.
  const ensureSrc = sliceFn(CONTENT, "ensureLiveRewindPolicy");
  const curSrc = sliceFn(CONTENT, "currentLiveRewindRestricted");
  const pageKeySrc = sliceFn(CONTENT, "liveRewindPolicyPageKey");
  const sessionSrc = sliceFn(CONTENT, "liveRewindPolicySessionKey");

  const ASIAN = {
    code: 200,
    content: {
      status: "OPEN",
      channelId: "chanA",
      openDate: "2026-09-22 09:49:58",
      adParameter: { tag: "asiangames" },
      timeMachineActive: false,
      tvAppViewingPolicyType: "DENIED",
    },
  };

  // 실제 함수들을 그대로 올리고 fetch/채널만 바꿔 끼운다.
  const makeEnv = (channelId) => {
    const env = {
      channel: channelId,
      fetched: [],
      broadcasts: 0,
      now: Date.now(),
      response: ASIAN,
    };
    const body = `
      ${HELPERS}
      ${pageKeySrc}
      ${sessionSrc}
      ${curSrc}
      ${ensureSrc}
      return { ensureLiveRewindPolicy, currentLiveRewindRestricted };
    `;
    const ctx = {
      currentLiveChannelId: () => env.channel,
      liveRewindPolicyCache: new Map(),
      liveRewindPolicyRetryAt: new Map(),
      LIVE_REWIND_POLICY_TTL_MS: 5 * 60 * 1000,
      LIVE_REWIND_POLICY_RETRY_MS: 20 * 1000,
      liveRewindPolicyChannel: "",
      liveRewindPolicyResolved: null,
      liveRewindPolicyFetching: "",
      broadcastFeatureFlags: () => {
        env.broadcasts += 1;
      },
      fetch: (url) => {
        env.fetched.push(url);
        return Promise.resolve({
          ok: env.response !== null,
          json: () => Promise.resolve(env.response),
        });
      },
    };
    // let 바인딩을 밖에서 다루려면 객체 프로퍼티로 바꿔 실행한다.
    let src = body;
    for (const name of [
      "liveRewindPolicyChannel",
      "liveRewindPolicyResolved",
      "liveRewindPolicyFetching",
    ]) {
      src = src.replace(new RegExp(`\\b${name}\\b`, "g"), `S.${name}`);
    }
    const S = {
      liveRewindPolicyChannel: "",
      liveRewindPolicyResolved: null,
      liveRewindPolicyFetching: "",
    };
    const names = Object.keys(ctx);
    // eslint-disable-next-line no-new-func
    const fn = new Function("S", ...names, src);
    env.api = fn(S, ...names.map((n) => ctx[n]));
    env.S = S;
    return env;
  };

  const bridgeChecks = (async () => {
    // 1) 제한 방송 진입
    const env = makeEnv("chanA");
    await env.api.ensureLiveRewindPolicy();
    ok(
      env.fetched.length === 1,
      `정책 확인 요청 1회 (${env.fetched.length}회)`,
    );
    ok(
      env.fetched.every((u) => u.includes("live-status")),
      "live-status 만 요청한다",
    );
    ok(
      !env.fetched.some((u) => u.includes("live-detail")),
      "live-detail 을 요청하지 않는다",
    );
    ok(env.broadcasts === 1, "판정 후 브리지로 알린다");
    // 브리지 payload 가 읽는 값.
    ok(
      env.api.currentLiveRewindRestricted() === true,
      "payload 의 liveRewindRestricted 가 true 다",
    );

    // 2) 같은 방송 재호출 — TTL 안이면 다시 읽지 않는다.
    await env.api.ensureLiveRewindPolicy();
    ok(env.fetched.length === 1, "TTL 안에서는 다시 요청하지 않는다");

    // 3) 같은 채널의 '새 방송'(openDate 변경) — 이전 판정을 재사용하지 않는다.
    env.response = {
      code: 200,
      content: {
        ...ASIAN.content,
        openDate: "2026-09-22 12:00:00",
        adParameter: { tag: "none" },
        tvAppViewingPolicyType: "ALLOWED",
      },
    };
    env.S.liveRewindPolicyResolved = null; // 새 방송 진입(재평가)
    await env.api.ensureLiveRewindPolicy();
    ok(env.fetched.length === 2, "새 방송은 다시 확인한다");
    ok(
      env.api.currentLiveRewindRestricted() === false,
      "같은 채널이어도 새 방송은 새로 판정한다",
    );

    // 4) 응답 실패 — 기존 동작 유지, 그리고 '정상' 으로 확정하지 않는다.
    const env2 = makeEnv("chanB");
    env2.response = null;
    await env2.api.ensureLiveRewindPolicy();
    ok(
      env2.api.currentLiveRewindRestricted() === false,
      "실패 시 되감기를 막지 않는다(fail-open)",
    );
    ok(
      env2.S.liveRewindPolicyResolved === null,
      "실패를 '정상 방송' 으로 확정하지 않는다",
    );
    // 쿨다운 동안에는 폭주하지 않는다.
    await env2.api.ensureLiveRewindPolicy();
    ok(env2.fetched.length === 1, "쿨다운 동안 재요청하지 않는다");

    // 5) 불완전 응답(태그 누락)도 확정하지 않는다.
    const env3 = makeEnv("chanC");
    env3.response = {
      code: 200,
      content: {
        channelId: "chanC",
        openDate: "2026-09-22 09:00:00",
        timeMachineActive: false,
        tvAppViewingPolicyType: "DENIED",
      },
    };
    await env3.api.ensureLiveRewindPolicy();
    ok(
      env3.S.liveRewindPolicyResolved === null,
      "필드가 빠진 응답을 확정하지 않는다",
    );
    ok(env3.broadcasts === 0, "확정하지 못하면 브리지로 알리지 않는다");

    // 6) 늦게 온 응답이 다른 채널에 적용되지 않는다.
    const env4 = makeEnv("chanD");
    let release;
    const gate = new Promise((r) => (release = r));
    env4.apiFetchGate = gate;
    const slow = makeEnv("chanD");
    slow.api = env4.api;
    // chanD 요청 중 chanE 로 이동.
    const p = env4.api.ensureLiveRewindPolicy();
    env4.channel = "chanE";
    await p;
    ok(
      env4.api.currentLiveRewindRestricted() === false,
      "이동한 채널에 이전 응답을 적용하지 않는다",
    );
    void release;
  })();
  globalThis.__bridgeChecks = bridgeChecks;
}

console.log("\n[설정 회귀] 사용자 설정 의미를 뒤집지 않는다");
{
  // liveRewind(버튼 숨김)와 liveSeekBarOn(바 표시)의 기존 판정은 그대로다.
  const ensureButtons = sliceFn(MIXER, "ensureSeekButtons");
  ok(
    /!featureFlags\.liveRewind/.test(ensureButtons),
    "기존 버튼 숨김 설정이 그대로 먼저 적용된다",
  );
  const shouldBar2 = sliceFn(MIXER, "shouldShowLiveSeekBar");
  ok(/liveSeekBarOn/.test(shouldBar2), "바 표시 설정이 그대로 먼저 적용된다");
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

// ⚠ 브리지 검사는 비동기다. 그게 끝난 뒤에 집계해야 결과를 놓치지 않는다.
globalThis.__bridgeChecks
  .then(() => {
    console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
    process.exit(failed ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
