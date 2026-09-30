const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../src/multiviewSync.js");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const watch = read("src/multiviewWatch.js");
const content = read("src/content.js");
const settingsHtml = read("settings.html");
const settingsJs = read("src/settings.js");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

// ── 판단 함수 ───────────────────────────────────────────────────────────
const { limitSec, targetSec } = S.CATCH_UP;
check(limitSec === 8 && targetSec === 3, "상한 8초, 목표 3초");

check(S.catchUpTargets([{ id: "a", delaySec: 7.9 }]).length === 0,
  "상한 미만이면 옮기지 않는다");
assert.deepEqual(S.catchUpTargets([{ id: "a", delaySec: 14.8 }]),
  [{ id: "a", targetDelaySec: 3 }]);
checks.push("단독 칸은 목표 지연으로 옮긴다");

// 자동 싱크로 맞춰진 묶음: 간격을 유지한 채 가장 빠른 칸이 목표에 온다.
assert.deepEqual(
  S.catchUpTargets([
    { id: "a", delaySec: 8.4 },
    { id: "b", delaySec: 8.1 },
    { id: "c", delaySec: 8.6 },
  ]),
  [
    { id: "a", targetDelaySec: 3.3 },
    { id: "b", targetDelaySec: 3 },
    { id: "c", targetDelaySec: 3.5 },
  ],
);
checks.push("싱크 묶음은 서로의 간격을 유지한다");

// 간격이 큰 묶음: 느린 칸은 상한 - 2초에서 자르고, 이미 목표 근처인 칸은 뺀다.
assert.deepEqual(
  S.catchUpTargets([
    { id: "fast", delaySec: 3.2 },
    { id: "slow", delaySec: 9 },
  ]),
  [{ id: "slow", targetDelaySec: 6 }],
);
checks.push("간격이 큰 묶음은 느린 칸만 상한 아래로 옮긴다");
check(S.catchUpTargets([{ id: "a", delaySec: null }, { id: "b", delaySec: NaN }]).length === 0,
  "측정값이 없으면 옮기지 않는다");
for (const members of [
  [{ id: "a", delaySec: 30 }],
  [{ id: "a", delaySec: 8 }, { id: "b", delaySec: 40 }],
]) {
  for (const t of S.catchUpTargets(members)) {
    check(t.targetDelaySec >= targetSec && t.targetDelaySec <= limitSec,
      `목표 지연 ${t.targetDelaySec}초는 프레임 검증 범위 안이다`);
  }
}

// 되감기 판정.
const sample = (delay, receivedAt, generation = 1) =>
  ({ nativeDelaySec: delay, receivedAt, generation });
check(S.isRewind(sample(4, 1000), sample(15, 2000)), "한 샘플 사이 크게 늘면 되감기");
check(!S.isRewind(sample(4, 1000), sample(4.07, 2000)), "재생 밀림(초당 0.07초)은 되감기가 아니다");
check(!S.isRewind(sample(4, 1000), sample(8, 2000)),
  "자동 싱크 seek(최대 4초)는 되감기가 아니다");
check(!S.isRewind(sample(4, 1000, 1), sample(31, 2000, 2)),
  "플레이어 재초기화(generation 변경)는 되감기가 아니다");
check(!S.isRewind(sample(4, 1000), sample(34, 31000)),
  "탭이 가려져 샘플이 끊긴 사이의 증가는 되감기가 아니다");
check(!S.isRewind(sample(4, 1000), sample(15, 2000), 2500),
  "우리가 옮긴 직후의 변화는 판정하지 않는다");
check(!S.isRewind(null, sample(15, 2000)), "이전 샘플이 없으면 판정하지 않는다");

// ── 프레임 명령 ─────────────────────────────────────────────────────────
check(/APPLY_LIVE_CATCH_UP: "catch-up"/.test(content), "프레임이 따라잡기 명령을 받는다");
check(/syncCommand === "catch-up" &&[\s\S]*?data\.targetDelaySec < MULTIVIEW_SYNC\.CATCH_UP\.targetSec[\s\S]*?data\.targetDelaySec > MULTIVIEW_SYNC\.CATCH_UP\.limitSec\)\) return;/.test(content),
  "프레임은 목표 지연 범위를 검증한다");
check(/syncCommand !== "catch-up" && Date\.now\(\) - syncSeekAt/.test(content),
  "따라잡기는 싱크 seek 쿨다운에 막히지 않는다");
check(/syncCommand === "catch-up"\s*\?\s*\(end === null \? NaN : end - data\.targetDelaySec\)/.test(content),
  "프레임은 지금의 라이브 끝에서 목표 지연을 뺀 위치로 옮긴다");
check(/syncCommand === "catch-up" && target < video\.currentTime \+ 0\.5\) reason = "range"/.test(content),
  "라이브 쪽으로만 옮긴다");
const frameCommand = content.slice(
  content.indexOf('APPLY_LIVE_CATCH_UP: "catch-up"'),
  content.indexOf('notifyParent("FRAME_SYNC_COMMAND_RESULT"'),
);
check(/video\.paused\) reason = "paused"/.test(frameCommand) &&
  /isAdPlaying\(\)\) reason = "ad"/.test(frameCommand) &&
  /video\.seeking\) reason = "seeking"/.test(frameCommand),
  "일시정지·광고·seek 중에는 옮기지 않는다");

// ── 부모 판단 루프 ──────────────────────────────────────────────────────
check(/const LIVE_CATCH_UP_KEY = "cheeseMultiviewLiveCatchUp";/.test(watch) &&
  /liveCatchUpEnabled = data\[LIVE_CATCH_UP_KEY\] !== false;/.test(watch) &&
  /liveCatchUpEnabled = changes\[LIVE_CATCH_UP_KEY\]\.newValue !== false;/.test(watch),
  "설정은 기본 켜짐이고 바뀌면 바로 반영한다");
check(/state\.sync\.diagnosticsEnabled \|\|\s*liveCatchUpWanted\(\)\);/.test(watch),
  "싱크 패널이 닫혀 있어도 측정을 계속한다");
check(/frameStates\.set\(channelId, status\);\s*refreshSyncPanel\(\);[\s\S]{0,120}updateSyncPolling\(\);/.test(watch),
  "칸이 준비되면 측정을 시작한다");
check(/requestSyncStats\(\);[\s\S]{0,120}tickLiveCatchUp\(now\);\s*if \(state\.sync\.scope === "groups"\)/.test(watch),
  "그룹 범위에서도 따라잡기를 판단한다");
const candidate = watch.slice(watch.indexOf("function catchUpCandidate("),
  watch.indexOf("function tickLiveCatchUp("));
check(/!catchUpHeld\.has\(id\)/.test(candidate) &&
  /SYNC\.eligible\(st, syncReadyAt\.get\(id\), now, true\)/.test(candidate) &&
  /st\.bufferAheadSec !== null/.test(candidate) &&
  /!st\.userRateOverride/.test(candidate),
  "되감은 칸·안정화 중·버퍼 없는 재초기화·사용자 배속 칸은 옮기지 않는다");
const tick = watch.slice(watch.indexOf("function tickLiveCatchUp("),
  watch.indexOf("function syncGroupForChannel("));
check(/if \(urgent \|\| \(confirmed && cooled\)\) due = true;/.test(tick),
  "평소에는 확인 시간과 쿨다운을 지키고, 탭 복귀 첫 판단만 예외다");
check(/for \(const id of members\) catchUpUrgent\.delete\(id\);/.test(tick),
  "탭 복귀 특례는 한 번만 쓴다");
check(/sendSyncCommand\(\s*id,\s*"catch-up",\s*"APPLY_LIVE_CATCH_UP",/.test(tick),
  "기존 명령 경로(진단 기록·응답 대기)를 그대로 쓴다");
const clusters = watch.slice(watch.indexOf("function catchUpClusters("),
  watch.indexOf("function catchUpCandidate("));
check(/group\.mode === "auto"/.test(clusters) &&
  /state\.sync\.mode === "auto"\s*\?\s*\[syncScopeIds\(\)\]/.test(clusters) &&
  /c\.mediaType !== "video"/.test(clusters),
  "자동 싱크 범위는 함께 옮기고 다시보기 칸은 뺀다");
check(/entry\.command === "catch-up"\s*\)\s*syncSeekAt\.set\(channelId, Date\.now\(\)\);/.test(watch),
  "옮긴 뒤 자동 싱크가 곧바로 과거로 되돌리지 않는다");
check(/"reset-rate", "catch-up"\]\.includes\(\s*data\.command,?\s*\)/.test(watch),
  "부모가 따라잡기 응답을 받는다");
check(/observeCatchUpSample\(channelId, previousStats, stats\);/.test(watch),
  "새 측정값마다 되감기를 살핀다");
check(/if \(c\.mediaType !== "video"\) catchUpUrgent\.add\(c\.channelId\);/.test(watch) &&
  /syncReadyAt\.set\(c\.channelId, now\);[\s\S]{0,300}catchUpUrgent\.add/.test(watch),
  "탭이 다시 보이면 안정화 뒤 밀린 칸을 바로 옮긴다");
check(/resetLiveCatchUp\(channelId\);/.test(watch) && /resetLiveCatchUp\(\);/.test(watch),
  "채널 교체·페이지 종료 때 상태를 비운다");

// ── 판단 루프 동작(원본 함수를 그대로 돌린다) ─────────────────────────────
{
  const sliceFn = (name) => {
    const start = watch.indexOf(`  function ${name}(`);
    const end = watch.indexOf("\n  }\n", start);
    assert.ok(start >= 0 && end > start, `${name} 를 찾지 못했다`);
    return watch.slice(start, end + 4);
  };
  const body = ["catchUpClusters", "catchUpCandidate", "tickLiveCatchUp", "observeCatchUpSample"]
    .map(sliceFn).join("\n") +
    "\nreturn { tickLiveCatchUp, observeCatchUpSample };";
  const make = (chosen, sync = { scope: "all", mode: "off", groups: [] }) => {
    const env = {
      state: { chosen, sync },
      syncStats: new Map(),
      syncReadyAt: new Map(chosen.map((c) => [c.channelId, 0])),
      sent: [],
      pending: new Set(),
      catchUpOverSince: new Map(),
      catchUpLastAt: new Map(),
      catchUpHeld: new Set(),
      catchUpUrgent: new Set(),
      catchUpQuietUntil: new Map(),
      diagnostics: [],
    };
    // eslint-disable-next-line no-new-func
    const api = new Function(
      "state", "SYNC", "syncStats", "syncReadyAt", "currentStatus", "pendingSync",
      "sendSyncCommand", "syncScopeIds", "liveCatchUpEnabled", "catchUpOverSince",
      "catchUpLastAt", "catchUpHeld", "catchUpUrgent", "catchUpQuietUntil",
      "recordSyncDiagnostic", "syncChannelName", body,
    )(
      env.state, S, env.syncStats, env.syncReadyAt, () => "ready",
      (id, command) => env.pending.has(`${id}:${command}`),
      (id, command, type, extra) => {
        env.sent.push({ id, command, type, ...extra });
        return true;
      },
      () => chosen.filter((c) => c.mediaType !== "video").map((c) => c.channelId),
      true, env.catchUpOverSince, env.catchUpLastAt, env.catchUpHeld,
      env.catchUpUrgent, env.catchUpQuietUntil,
      (type, fields) => env.diagnostics.push({ type, ...fields }), () => "",
    );
    return { env, ...api };
  };
  const st = (delay, receivedAt, extra = {}) => ({
    currentTime: 100, nativeDelaySec: delay, bufferAheadSec: delay, edgeLagSec: 0,
    seekableStart: 0, seekableEnd: 100 + delay, playbackRate: 1, syncRateOwned: false,
    userRateOverride: false, paused: false, readyState: 4, generation: 1, receivedAt, ...extra,
  });
  const live = (id) => ({ channelId: id, mediaType: "live" });

  // 6채널 실측처럼 밀리는 칸: 상한을 넘고 2초가 지나야 한 번 옮긴다.
  {
    const { env, tickLiveCatchUp } = make([live("a"), live("b")]);
    env.syncStats.set("a", st(8.2, 10000));
    env.syncStats.set("b", st(4, 10000));
    tickLiveCatchUp(10000);
    check(env.sent.length === 0, "상한을 막 넘은 첫 판단에서는 옮기지 않는다");
    env.syncStats.set("a", st(8.3, 12000));
    tickLiveCatchUp(12000);
    check(env.sent.length === 1 && env.sent[0].id === "a" &&
      env.sent[0].type === "APPLY_LIVE_CATCH_UP" && env.sent[0].targetDelaySec === 3,
      "2초 넘게 상한 위에 있으면 그 칸만 3초로 옮긴다");
    env.syncStats.set("a", st(9, 20000));
    tickLiveCatchUp(20000);
    tickLiveCatchUp(22500);
    check(env.sent.length === 1, "쿨다운(15초) 안에는 다시 보내지 않는다");
    env.syncStats.set("a", st(9.5, 27500));
    tickLiveCatchUp(27500);
    check(env.sent.length === 2, "쿨다운이 지나도 상한 위면 다시 옮긴다");
  }

  // 탭 복귀 첫 판단은 확인 시간 없이 바로 옮긴다(한 번만).
  {
    const { env, tickLiveCatchUp } = make([live("a")]);
    env.catchUpUrgent.add("a");
    env.syncStats.set("a", st(12, 50000));
    tickLiveCatchUp(50000);
    check(env.sent.length === 1, "탭 복귀 뒤 첫 판단은 바로 옮긴다");
    check(!env.catchUpUrgent.has("a"), "탭 복귀 특례를 소진한다");
  }
  {
    const { env, tickLiveCatchUp } = make([live("a")]);
    env.catchUpUrgent.add("a");
    env.syncStats.set("a", st(3.4, 50000));
    tickLiveCatchUp(50000);
    check(env.sent.length === 0 && !env.catchUpUrgent.has("a"),
      "치지직이 스스로 복귀했으면 옮기지 않고 특례만 소진한다");
  }

  // 되감은 칸은 두고 본다. 상한 아래로 돌아오면 다시 대상이 된다.
  {
    const { env, tickLiveCatchUp, observeCatchUpSample } = make([live("a")]);
    const before = st(4, 1000);
    const after = st(40, 2000);
    env.syncStats.set("a", after);
    observeCatchUpSample("a", before, after);
    check(env.catchUpHeld.has("a"), "되감기를 감지하면 붙잡아 둔다");
    tickLiveCatchUp(2000);
    tickLiveCatchUp(5000);
    check(env.sent.length === 0, "되감은 칸은 옮기지 않는다");
    observeCatchUpSample("a", after, st(3.5, 6000));
    check(!env.catchUpHeld.has("a"), "사용자가 라이브로 돌아오면 다시 대상이 된다");
    check(env.diagnostics.map((d) => d.type).join() === "catch-up-hold,catch-up-release",
      "진단 기록에 보류·해제를 남긴다");
  }

  // 안정화 중·광고(일시정지)·버퍼 없는 재초기화·다시보기 칸은 건드리지 않는다.
  {
    const { env, tickLiveCatchUp } = make([
      live("settling"), live("ad"), live("reinit"), { channelId: "vod", mediaType: "video" },
    ]);
    env.syncReadyAt.set("settling", 9000);
    env.syncStats.set("settling", st(12, 10000));
    env.syncStats.set("ad", st(12, 10000, { paused: true }));
    env.syncStats.set("reinit", st(31, 10000, { bufferAheadSec: null }));
    env.syncStats.set("vod", st(12, 10000));
    tickLiveCatchUp(10000);
    tickLiveCatchUp(13000);
    check(env.sent.length === 0, "안정화 중·광고·재초기화·다시보기 칸은 옮기지 않는다");
  }

  // 자동 싱크 묶음은 함께 옮긴다.
  {
    const { env, tickLiveCatchUp } = make([live("a"), live("b"), live("c")],
      { scope: "all", mode: "auto", groups: [] });
    env.syncStats.set("a", st(8.4, 10000));
    env.syncStats.set("b", st(8.1, 10000));
    env.syncStats.set("c", st(7.9, 10000));
    tickLiveCatchUp(10000);
    tickLiveCatchUp(12000);
    check(env.sent.map((s) => `${s.id}:${s.targetDelaySec}`).sort().join() === "a:3.5,b:3.2,c:3",
      "자동 싱크 묶음은 상한 아래 칸까지 간격을 유지해 함께 옮긴다");
  }

  // 되감은 칸이 싱크 기준으로 남아 있으면 나머지만 따라잡아서는 안 된다.
  {
    const { env, tickLiveCatchUp } = make([live("a"), live("b")],
      { scope: "all", mode: "auto", groups: [] });
    env.catchUpHeld.add("b");
    env.syncStats.set("a", st(9, 10000));
    env.syncStats.set("b", st(15, 10000));
    tickLiveCatchUp(10000);
    tickLiveCatchUp(12000);
    check(env.sent.length === 0,
      "되감은 칸이 있는 자동 싱크 묶음은 다른 칸만 앞으로 보내지 않는다");
    env.catchUpHeld.delete("b");
    env.syncStats.set("a", st(9, 13000));
    env.syncStats.set("b", st(15, 13000));
    tickLiveCatchUp(13000);
    env.syncStats.set("a", st(9, 15000));
    env.syncStats.set("b", st(15, 15000));
    tickLiveCatchUp(15000);
    check(env.sent.some((command) => command.id === "a") &&
      env.sent.some((command) => command.id === "b"),
      "되감기 보류가 풀리면 묶음 전체가 다시 따라잡는다");
  }
}

// ── 진단 요약 ───────────────────────────────────────────────────────────
{
  const D = require("../src/multiviewDiagnostics.js");
  const summary = D.summarize([
    { type: "command", channelId: "a", channelName: "러너", command: "catch-up" },
    { type: "command", channelId: "a", command: "catch-up" },
    { type: "catch-up-hold", channelId: "a" },
  ]);
  const channel = summary.channels.find((c) => c.channelId === "a");
  check(channel.catchUpCommandCount === 2 && channel.catchUpHoldCount === 1,
    "진단 요약에 칸별 따라잡기·보류 횟수를 센다");
  check(D.formatSummary(summary).includes("라이브 따라잡기: 2회 (되감기로 보류 1회)"),
    "요약 복사 문구에 따라잡기 횟수가 나온다");
}

// ── 설정 ────────────────────────────────────────────────────────────────
check(settingsHtml.includes("data-multiview-live-catch-up") &&
  settingsHtml.includes("라이브 지연 자동 따라잡기"), "설정 화면에 항목이 있다");
check(/\["\[data-multiview-live-catch-up\]", "cheeseMultiviewLiveCatchUp", true\]/.test(settingsJs),
  "설정 스위치는 기본 켜짐");
check(/SETTINGS_STORAGE_KEYS[\s\S]*?"cheeseMultiviewLiveCatchUp"/.test(settingsJs),
  "설정 내보내기·불러오기에 포함된다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
