// 멀티뷰 다시보기 그룹 싱크 검증.
//
// 다시보기끼리 묶은 그룹을 실제 방송 시각(liveOpenDate + 재생 위치)으로 맞춘다.
// 기준은 사용자가 마지막으로 직접 움직인 칸이고, 다른 칸은 seek·재생·일시정지로 따라간다.
// 1) 판단 모듈(multiviewVodSync.js), 2) 시청 화면 블록을 가짜 프레임으로 실제로 돌리고,
// 3) 프레임(content.js)·로딩 경로를 정적으로 확인한다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const V = require("../src/multiviewVodSync.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

const OPEN_A = Date.UTC(2026, 5, 22, 4, 0, 0); // A 방송 시작
const OPEN_B = OPEN_A + 300_000; // B 는 5분 늦게 시작
const NOW = 2_000_000_000_000;
const raw = (extra = {}) => ({
  currentTime: 100, duration: 7200, paused: false, seeking: false, readyState: 4,
  playbackRate: 1, liveOpenAt: OPEN_A, adPlaying: false, userActionAt: 0, userAction: null,
  sampledAt: NOW, ...extra,
});
const stats = (extra = {}, receivedAt = NOW) => V.normalize(raw(extra), receivedAt);

// ── 측정값 정리 ──────────────────────────────────────────────────────────
check(V.normalize(null) === null && V.normalize(raw({ paused: "no" })) === null &&
  V.normalize(raw({ currentTime: -1 })) === null && V.normalize(raw({ currentTime: null })) === null,
  "형식이 틀리거나 재생 위치가 없으면 버린다");
check(stats({ liveOpenAt: 0 }).liveOpenAt === 0 && stats({ userAction: "drag" }).userAction === null,
  "업로드 영상(방송 시각 없음)·모르는 조작 이름은 비운다");
check(stats({ sampledAt: NOW - 5000 }).sampledAt === NOW,
  "기기 시계가 크게 어긋난 측정 시각은 받은 시각으로 바꾼다");

// ── 지금 위치 외삽 ─────────────────────────────────────────────────────────
{
  const st = stats();
  check(Math.abs(V.positionAt(st, NOW + 1500) - 101.5) < 1e-9, "재생 중이면 측정 뒤 흐른 시간만큼 나아간 것으로 본다");
  check(V.positionAt(stats({ paused: true }), NOW + 1500) === 100, "일시정지면 그대로");
  check(V.positionAt(stats({ readyState: 2 }), NOW + 1500) === 100, "버퍼링 중(readyState<3)이면 그대로");
  check(V.broadcastClock(st, NOW) === OPEN_A + 100_000, "방송 시각 = 시작 시각 + 재생 위치");
}

// ── 기준 고르기 ──────────────────────────────────────────────────────────
{
  const byId = new Map([["video:1", stats()], ["video:2", stats({ userActionAt: NOW - 100 })], ["video:3", stats()]]);
  const ids = ["video:1", "video:2", "video:3"];
  let r = V.chooseLeader(ids, byId, "video:1", new Map(), "video:1");
  check(r.leaderId === "video:2" && r.byUser && r.handled.get("video:2") === NOW - 100,
    "사용자가 직접 움직인 칸이 기준이 된다");
  r = V.chooseLeader(ids, byId, "video:1", r.handled, "video:1");
  check(r.leaderId === "video:1" && !r.byUser, "이미 반영한 조작으로는 기준을 다시 바꾸지 않는다");
  byId.set("video:3", stats({ userActionAt: NOW }));
  byId.set("video:1", stats({ userActionAt: NOW - 50 }));
  r = V.chooseLeader(ids, byId, "video:2", new Map([["video:2", NOW - 100]]), null);
  check(r.leaderId === "video:3", "여러 칸을 움직였으면 가장 최근 칸");
  check(V.chooseLeader(ids, new Map(), null, new Map(), "video:2").leaderId === "video:2" &&
    V.chooseLeader(ids, new Map(), null, new Map(), "live").leaderId === "video:1",
    "처음에는 메인(그룹에 있으면), 없으면 첫 칸");
}

// ── 싱크 중에 새로 들어온 칸 ─────────────────────────────────────────────────
{
  const ids = ["video:1", "video:2", "video:3"];
  const aligned = new Set(["video:1", "video:2"]);
  // video:3 은 막 들어와 자동 재생 중 사용자가 클릭(소리 켜기 등)했다.
  const byId = new Map([["video:3", stats({ userActionAt: NOW, userAction: "play" })]]);
  let r = V.chooseLeader(ids, byId, "video:1", new Map(), "video:1", aligned);
  check(r.leaderId === "video:1" && !r.byUser && r.handled.get("video:3") === NOW,
    "새 칸의 조작으로는 기준이 바뀌지 않는다(반영한 것으로만 치고 넘긴다)");
  // 기준 칸을 새 다시보기로 교체했다(새 칸이 메인 자리를 물려받음).
  r = V.chooseLeader(["video:2", "video:4"], new Map(), null, new Map(), "video:4", aligned);
  check(r.leaderId === "video:2", "기준이 빠지면 새 칸(메인이라도)이 아니라 맞춰져 있던 칸이 기준이 된다");
  r = V.chooseLeader(ids, new Map(), null, new Map(), "video:3", new Set());
  check(r.leaderId === "video:3", "처음 시작(맞춰진 칸 없음)은 이전처럼 메인부터");
  const loading = V.plan({
    memberIds: ["a", "b"], leaderId: "a", now: NOW,
    statsById: new Map([["a", stats({ currentTime: 400 })], ["b", stats({ liveOpenAt: OPEN_B, currentTime: 0, readyState: 0 })]]),
  });
  check(loading.rows.get("b").status === "재생 준비 중" && loading.actions.length === 0,
    "영상 정보를 읽기 전인 칸은 옮기지 않는다(이어보기 이동이 덮어쓴다)");
  check(["기준", "맞춤", "방송 시작 전", "방송 끝난 뒤"].every((status) => V.ALIGNED_STATUSES.includes(status)) &&
    !V.ALIGNED_STATUSES.includes("맞추는 중"), "맞춰진 상태 목록");
}

// ── 맞추기 계획 ──────────────────────────────────────────────────────────
const planFor = (a, b, opts = {}) => V.plan({
  memberIds: ["a", "b"], statsById: new Map([["a", a], ["b", b]]), leaderId: "a", now: NOW, ...opts,
});
{
  // A 100초 = 실제 04:01:40. 같은 시각의 B 위치는 100 - 300 = 음수 → 시작 전.
  const { rows, actions } = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, currentTime: 100 }));
  check(rows.get("a").status === "기준" && rows.get("b").status === "맞춤" && rows.get("b").deltaSec === 0 &&
    actions.length === 0, "같은 방송 시각이면 아무것도 보내지 않는다");
}
{
  const { rows, actions } = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, currentTime: 95 }));
  check(rows.get("b").status === "맞추는 중" && rows.get("b").deltaSec === -5, "B 가 5초 늦다");
  assert.deepEqual(actions, [{ id: "b", action: "seek", currentTime: 100.25 }]);
  checks.push("1초 이상 차이는 기준 시각으로 옮긴다(재생 중이면 0.25초 앞으로)");
}
{
  const { actions } = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, currentTime: 99.5 }));
  check(actions.length === 0, "1초 미만 차이는 자동으로는 옮기지 않는다");
  const precise = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, currentTime: 99.5 }),
    { threshold: V.LIMITS.manualThresholdSec });
  check(precise.actions.length === 1 && precise.actions[0].currentTime === 100.25,
    "버튼으로 맞출 때는 작은 차이도 옮긴다");
}
{
  const paused = planFor(stats({ currentTime: 400, paused: true }), stats({ liveOpenAt: OPEN_B, currentTime: 90 }));
  assert.deepEqual(paused.actions, [
    { id: "b", action: "seek", currentTime: 100 },
    { id: "b", action: "pause" },
  ]);
  checks.push("기준이 멈춰 있으면 앞당김 없이 옮기고 같이 멈춘다");
  const resume = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, currentTime: 100, paused: true }));
  assert.deepEqual(resume.actions, [{ id: "b", action: "play" }]);
  checks.push("기준이 재생 중이면 멈춘 칸을 재생한다");
}
{
  const before = planFor(stats({ currentTime: 200 }), stats({ liveOpenAt: OPEN_B, currentTime: 30 }));
  check(before.rows.get("b").status === "방송 시작 전", "기준 시각에 아직 시작 전인 방송");
  assert.deepEqual(before.actions, [{ id: "b", action: "seek", currentTime: 0 }, { id: "b", action: "pause" }]);
  checks.push("시작 전이면 처음에서 멈춰 기다린다");
  const after = planFor(stats({ currentTime: 7000 }), stats({ liveOpenAt: OPEN_B, duration: 3600, currentTime: 3500 }));
  check(after.rows.get("b").status === "방송 끝난 뒤" &&
    JSON.stringify(after.actions) === JSON.stringify([{ id: "b", action: "pause" }]),
    "이미 끝난 시각이면 끝으로 보내지 않고 그 자리에서 멈춘다");
}
{
  const upload = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: 0 }));
  check(upload.rows.get("b").status === "방송 시각 없음" && upload.actions.length === 0, "업로드 영상은 맞추지 않는다");
  const ad = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, adPlaying: true }));
  check(ad.rows.get("b").status === "광고 중" && ad.actions.length === 0, "광고 중인 칸은 건드리지 않는다");
  const leaderAd = planFor(stats({ adPlaying: true }), stats({ liveOpenAt: OPEN_B }));
  check(leaderAd.rows.get("b").status === "기준 대기" && leaderAd.actions.length === 0, "기준이 광고 중이면 기다린다");
  const stale = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B }, NOW - 5000));
  check(stale.rows.get("b").status === "측정 대기" && stale.actions.length === 0, "오래된 측정값으로는 움직이지 않는다");
  const seeking = planFor(stats({ currentTime: 400, seeking: true }), stats({ liveOpenAt: OPEN_B, currentTime: 50 }));
  check(seeking.actions.length === 0, "기준이 옮겨지는 중이면 다음 측정을 기다린다");
}
{
  // 보정 +2초 = B 를 기준보다 2초 과거 장면에 둔다(라이브 싱크와 같은 뜻).
  const { actions } = planFor(stats({ currentTime: 400, paused: true }), stats({ liveOpenAt: OPEN_B, currentTime: 100, paused: true }),
    { offsets: { b: 2 } });
  assert.deepEqual(actions, [{ id: "b", action: "seek", currentTime: 98 }]);
  checks.push("칸별 보정(양수)은 그만큼 과거 장면으로 맞춘다");
  const only = planFor(stats({ currentTime: 400 }), stats({ liveOpenAt: OPEN_B, currentTime: 50 }), { onlyIds: [] });
  check(only.actions.length === 0 && only.rows.get("b").status === "맞추는 중", "표시만 할 때는 명령을 만들지 않는다");
}

// ── 시청 화면 블록을 가짜 프레임으로 돌린다 ─────────────────────────────────
const watch = read("src/multiviewWatch.js");
{
  const start = watch.indexOf("  // ── 다시보기 그룹 싱크");
  const end = watch.indexOf("  function handleGroupSyncClick(target) {");
  assert.ok(start > 0 && end > start, "시청 화면 다시보기 싱크 블록을 찾지 못했다");
  const block = watch.slice(start, end);
  const posted = [];
  const timers = [];
  const cells = new Map(["video:1", "video:2", "abc"].map((id) => [id, {
    querySelector: () => ({ contentWindow: { postMessage: (msg) => posted.push(msg) } }),
  }]));
  const group = { id: "a", channelIds: ["video:1", "video:2"], mode: "auto", referenceChannelId: null, manualOffsets: {} };
  const ctx = {
    globalThis: { CheeseMultiviewVodSync: V },
    state: { sync: { scope: "groups", groups: [group] }, mainId: "video:1" },
    cells,
    isVideoSlot: (id) => id.startsWith("video:"),
    currentStatus: () => "ready",
    MULTIVIEW_MESSAGE: "mv",
    FRAME_TOKEN_FIELD: { token: "t" },
    CHZZK_ORIGIN: "https://chzzk.naver.com",
    syncNotice: "",
    refreshSyncPanel: () => {},
    window: { setTimeout: (fn) => { timers.push(fn); return timers.length; } },
    clearTimeout: () => {},
    Date,
  };
  vm.createContext(ctx);
  const api = vm.runInContext(`${block}\n({ requestVodSyncStats, tickVodSyncGroups, handleVodSyncStats, finishVodSyncAction, alignVodGroup, getVodGroupRowViewState, groupMediaKind, vodSyncStats })`, ctx);
  const now = Date.now();
  const sent = () => posted.filter((m) => m.type === "APPLY_VOD_SYNC");
  api.requestVodSyncStats();
  check(posted.filter((m) => m.type === "REQUEST_FRAME_VOD_SYNC_STATS").map((m) => m.channelId).join() === "video:1,video:2" &&
    posted.every((m) => m.source === "mv" && m.token === "t"), "다시보기 그룹 칸에만 측정을 요청한다(세션 토큰 포함)");
  const st = (extra) => V.normalize(raw({ sampledAt: now, ...extra }), now);
  api.vodSyncStats.set("video:1", st({ currentTime: 400 }));
  api.vodSyncStats.set("video:2", st({ liveOpenAt: OPEN_B, currentTime: 95 }));
  api.tickVodSyncGroups(now);

  check(group.referenceChannelId === "video:1", "처음 기준은 메인");
  const first = sent();
  check(first.length === 1 && first[0].channelId === "video:2" && first[0].action === "seek" &&
    Math.abs(first[0].currentTime - 100.25) < 0.01, "자동 싱크: 늦은 칸을 기준 방송 시각으로 옮긴다");
  api.tickVodSyncGroups(now + 100);
  check(sent().length === 1, "응답 전에는 같은 명령을 다시 보내지 않는다");
  api.finishVodSyncAction("video:2", { commandId: first[0].commandId, action: "seek" });
  api.tickVodSyncGroups(now + 200);
  check(sent().length === 1, "응답 뒤에도 쿨다운 동안은 다시 보내지 않는다");
  // 옮긴 뒤 측정: B 가 기준 타임라인에 맞춰졌다.
  api.vodSyncStats.set("video:2", st({ liveOpenAt: OPEN_B, currentTime: 100 }));
  api.tickVodSyncGroups(now + 250);
  // 사용자가 B 를 직접 앞으로 옮겼다 → B 가 기준, A 가 따라간다(쿨다운 무시).
  api.handleVodSyncStats("video:2", st({ liveOpenAt: OPEN_B, currentTime: 600, userActionAt: now + 300, userAction: "seek" }));
  const follow = sent().at(-1);
  check(group.referenceChannelId === "video:2" && follow.channelId === "video:1" && follow.action === "seek" &&
    follow.currentTime > 899 && follow.currentTime < 902,
    "사용자가 움직인 칸이 기준이 되고 나머지가 바로 따라간다");
  const view = api.getVodGroupRowViewState(group, "video:1", now);
  check(/^방송 시각 \d{2}:\d{2}:\d{2}$/.test(view.metrics.delay) && /^기준 대비 [+-]\d+\.\d초$/.test(view.metrics.buffer) &&
    view.rate.text === "재생 중", "행에 방송 시각·기준 대비 차이·재생 상태를 보여 준다");
  group.mode = "off";
  const before = sent().length;
  const later = now + 10000;
  api.vodSyncStats.set("video:1", V.normalize(raw({ sampledAt: later, currentTime: 10 }), later));
  api.vodSyncStats.set("video:2", V.normalize(raw({ sampledAt: later, liveOpenAt: OPEN_B, currentTime: 600 }), later));
  api.tickVodSyncGroups(later);
  check(sent().length === before && api.getVodGroupRowViewState(group, "video:1", later).status === "싱크 꺼짐",
    "자동 싱크가 꺼져 있으면 표시만 하고 움직이지 않는다");
  group.channelIds.push("abc");
  check(api.groupMediaKind(group) === "mixed", "라이브와 섞이면 mixed");
  posted.length = 0;
  api.requestVodSyncStats();
  group.mode = "auto";
  api.tickVodSyncGroups(now + 20000);
  check(posted.length === 0, "라이브와 섞인 그룹은 맞추지 않는다");
}

// ── 시청 화면: 싱크 중에 다시보기가 추가·교체될 때 ─────────────────────────────
{
  const start = watch.indexOf("  // ── 다시보기 그룹 싱크");
  const end = watch.indexOf("  function handleGroupSyncClick(target) {");
  const block = watch.slice(start, end);
  const posted = [];
  const cells = new Map(["video:1", "video:2", "video:3", "video:4"].map((id) => [id, {
    querySelector: () => ({ contentWindow: { postMessage: (msg) => posted.push(msg) } }),
  }]));
  const group = { id: "a", channelIds: ["video:1", "video:2"], mode: "auto", referenceChannelId: null, manualOffsets: {} };
  const state = { sync: { scope: "groups", groups: [group] }, mainId: "video:1" };
  const ctx = {
    globalThis: { CheeseMultiviewVodSync: V }, state, cells,
    isVideoSlot: (id) => id.startsWith("video:"), currentStatus: () => "ready",
    MULTIVIEW_MESSAGE: "mv", FRAME_TOKEN_FIELD: {}, CHZZK_ORIGIN: "", syncNotice: "",
    refreshSyncPanel: () => {}, window: { setTimeout: () => 1 }, clearTimeout: () => {}, Date,
  };
  vm.createContext(ctx);
  const api = vm.runInContext(`${block}\n({ tickVodSyncGroups, handleVodSyncStats, resetVodSync, vodSyncStats })`, ctx);
  const at = (t) => (extra) => V.normalize(raw({ sampledAt: t, ...extra }), t);
  let now = Date.now();
  // 두 칸이 맞춰진 채로 싱크 중(기준 video:1, 방송 시각 04:06:40).
  api.vodSyncStats.set("video:1", at(now)({ currentTime: 400 }));
  api.vodSyncStats.set("video:2", at(now)({ liveOpenAt: OPEN_B, currentTime: 100 }));
  api.tickVodSyncGroups(now);
  check(group.referenceChannelId === "video:1" && !posted.some((m) => m.type === "APPLY_VOD_SYNC"), "두 칸이 맞춰진 채 싱크 중");
  // 새 다시보기(같은 날 04:00 시작, 처음부터 자동 재생)를 그룹에 넣었고, 사용자가 그 칸을 클릭했다.
  now += 1000;
  group.channelIds.push("video:3");
  api.vodSyncStats.set("video:1", at(now)({ currentTime: 401 }));
  api.vodSyncStats.set("video:2", at(now)({ liveOpenAt: OPEN_B, currentTime: 101 }));
  api.handleVodSyncStats("video:3", at(now)({ currentTime: 0, userActionAt: now, userAction: "play" }));
  api.tickVodSyncGroups(now);
  const toNew = posted.filter((m) => m.type === "APPLY_VOD_SYNC" && m.channelId === "video:3");
  check(group.referenceChannelId === "video:1" &&
    !posted.some((m) => m.type === "APPLY_VOD_SYNC" && m.channelId !== "video:3"),
    "새 다시보기가 기준이 되어 기존 칸을 끌고 가지 않는다");
  check(toNew.length === 1 && toNew[0].action === "seek" && Math.abs(toNew[0].currentTime - 401.25) < 0.01,
    "새 다시보기를 싱크 중인 타임라인(기준 방송 시각)으로 옮긴다");
  // 맞춰진 뒤에는 그 칸도 기준이 될 수 있다.
  now += 3000;
  api.vodSyncStats.set("video:1", at(now)({ currentTime: 404 }));
  api.vodSyncStats.set("video:2", at(now)({ liveOpenAt: OPEN_B, currentTime: 104 }));
  api.vodSyncStats.set("video:3", at(now)({ currentTime: 404 }));
  api.tickVodSyncGroups(now);
  api.handleVodSyncStats("video:3", at(now + 10)({ currentTime: 900, userActionAt: now + 10, userAction: "seek" }));
  check(group.referenceChannelId === "video:3", "맞춰진 뒤에는 새로 들어온 칸도 직접 움직이면 기준이 된다");
  // 기준 칸을 새 다시보기로 교체: 새 칸이 메인 자리를 물려받아도 기준은 맞춰져 있던 칸.
  posted.length = 0;
  api.resetVodSync("video:3");
  group.channelIds = ["video:1", "video:2", "video:4"];
  group.referenceChannelId = null;
  state.mainId = "video:4";
  now += 1000;
  api.vodSyncStats.set("video:1", at(now)({ currentTime: 900 }));
  api.vodSyncStats.set("video:2", at(now)({ liveOpenAt: OPEN_B, currentTime: 600 }));
  api.vodSyncStats.set("video:4", at(now)({ currentTime: 30 }));
  api.tickVodSyncGroups(now);
  const seeks = posted.filter((m) => m.type === "APPLY_VOD_SYNC");
  check(group.referenceChannelId !== "video:4" && seeks.length === 1 && seeks[0].channelId === "video:4" &&
    Math.abs(seeks[0].currentTime - 900.25) < 0.01,
    "기준을 교체해도 새 다시보기가 아니라 기존 타임라인을 따른다");
}

// ── 전체·선택 범위(다시보기만 있을 때) ───────────────────────────────────────
{
  const start = watch.indexOf("  // ── 다시보기 그룹 싱크");
  const end = watch.indexOf("  function handleGroupSyncClick(target) {");
  const block = watch.slice(start, end);
  const make = (chosenIds, sync) => {
    const posted = [];
    const cells = new Map(chosenIds.map((id) => [id, {
      querySelector: () => ({ contentWindow: { postMessage: (msg) => posted.push(msg) } }),
    }]));
    const state = {
      chosen: chosenIds.map((channelId) => ({ channelId })),
      mainId: chosenIds[0],
      sync: { groups: [], selectedChannelIds: [], referenceChannelId: null, manualOffsets: {}, ...sync },
    };
    const ctx = {
      globalThis: { CheeseMultiviewVodSync: V }, state, cells,
      isVideoSlot: (id) => id.startsWith("video:"), currentStatus: () => "ready",
      MULTIVIEW_MESSAGE: "mv", FRAME_TOKEN_FIELD: {}, CHZZK_ORIGIN: "https://chzzk.naver.com",
      syncNotice: "", refreshSyncPanel: () => {},
      window: { setTimeout: () => 1 }, clearTimeout: () => {}, Date,
    };
    vm.createContext(ctx);
    const api = vm.runInContext(`${block}\n({ vodScopeIds, syncScopeMixed, vodScopeContext, requestVodSyncStats, tickVodSyncGroups, vodSyncStats })`, ctx);
    return { api, state, posted, ctx };
  };
  const now = Date.now();
  const st = (extra) => V.normalize(raw({ sampledAt: now, ...extra }), now);
  {
    const { api, state, posted } = make(["video:1", "video:2"], { scope: "all", mode: "auto" });
    check(api.vodScopeIds().join() === "video:1,video:2" && !api.syncScopeMixed(),
      "전체: 다시보기만 있으면 다시보기 싱크 범위가 된다");
    api.requestVodSyncStats();
    check(posted.filter((m) => m.type === "REQUEST_FRAME_VOD_SYNC_STATS").length === 2, "전체: 두 칸 모두 측정을 요청한다");
    api.vodSyncStats.set("video:1", st({ currentTime: 400 }));
    api.vodSyncStats.set("video:2", st({ liveOpenAt: OPEN_B, currentTime: 95 }));
    state.sync.manualOffsets["video:2"] = 1;
    api.tickVodSyncGroups(now);
    const seek = posted.find((m) => m.type === "APPLY_VOD_SYNC");
    check(state.sync.referenceChannelId === "video:1" && seek?.channelId === "video:2" &&
      Math.abs(seek.currentTime - 99.25) < 0.01,
      "전체: 기준·보정은 state.sync 를 그대로 쓰고 자동이면 맞춘다");
    state.sync.mode = "manual";
    const before = posted.length;
    api.tickVodSyncGroups(now + 5000);
    check(posted.length === before, "전체: 수동 모드에서는 틱이 움직이지 않는다(버튼으로만)");
  }
  {
    const { api } = make(["abc", "video:1", "video:2"], { scope: "all", mode: "auto" });
    check(!api.vodScopeIds().length && api.syncScopeMixed() && api.vodScopeContext() === null,
      "전체에 라이브가 섞이면 다시보기 싱크를 하지 않고 섞였다고 알린다");
  }
  {
    const { api, posted } = make(["abc", "video:1", "video:2"],
      { scope: "selected", mode: "auto", selectedChannelIds: ["video:1", "video:2"] });
    check(api.vodScopeIds().join() === "video:1,video:2" && !api.syncScopeMixed(),
      "선택: 다시보기만 고르면 그 칸들로 다시보기 싱크");
    api.requestVodSyncStats();
    check(posted.every((m) => m.channelId !== "abc"), "선택하지 않은 라이브 칸에는 요청하지 않는다");
  }
  {
    const { api } = make(["abc", "video:1", "video:2"],
      { scope: "selected", mode: "auto", selectedChannelIds: ["abc", "video:1"] });
    check(!api.vodScopeIds().length && api.syncScopeMixed(), "선택에 라이브가 섞이면 섞였다고 알린다");
    const one = make(["abc", "video:1", "video:2"], { scope: "selected", selectedChannelIds: ["video:1"] });
    check(!one.api.vodScopeIds().length, "다시보기 하나만 고르면 성립하지 않는다");
  }
}

// ── 전체·선택 범위 연결 ────────────────────────────────────────────────────
{
  const slice = (name) => {
    const at = watch.indexOf(`  function ${name}(`);
    return watch.slice(at, watch.indexOf("\n  }\n", at));
  };
  check(/syncScopeIds\(\)\.length < 2 &&\s*!vodScopeIds\(\)\.length/.test(slice("syncGroupTooSmall")),
    "다시보기 2개 이상 선택이면 '2개 이상 선택' 경고·자동 종료가 걸리지 않는다");
  check(/if \(vodScopeIds\(\)\.length\) \{\s*requestVodSyncStats\(\);\s*tickVodSyncGroups\(now\);/.test(slice("syncTick")),
    "전체·선택 틱이 다시보기 범위면 다시보기 싱크를 돌리고 라이브 보정은 건너뛴다");
  check(/if \(vodScopeIds\(\)\.length\) return state\.sync\.referenceChannelId;/.test(slice("selectSyncReference")),
    "라이브 기준 선택이 다시보기 기준을 지우지 않는다");
  check(/if \(vodScope && vodScope\.channelIds\.includes\(channelId\)\)\s*return vodScopeRowViewState/.test(slice("getSyncRowViewState")) &&
    /label: separateVod \? "라이브와 따로" : label/.test(slice("getSyncRowViewState")),
    "행: 다시보기 범위면 방송 시각 표시, 라이브와 섞인 다시보기는 '라이브와 따로'");
  const render = slice("renderSync");
  check(/panel\.dataset\.mvSyncKind = vodScope \? "vod" : "live";/.test(render) &&
    /vodScope \? "기준에 맞추기" : "느린 채널에 맞추기"/.test(render) &&
    /data-mv-sync-warning="mixed"/.test(render) &&
    /if \(panel\.dataset\.mvSyncKind !== \(vodScopeIds\(\)\.length \? "vod" : "live"\)\) return false;/.test(slice("patchSyncPanel")),
    "패널: 버튼 이름·섞임 경고, 라이브/다시보기가 바뀌면 다시 그린다");
  const handler = watch.slice(watch.indexOf('const syncRef = target.closest?.("[data-mv-sync-ref]");'),
    watch.indexOf('if (target.closest?.("#mvBack"))'));
  check(/vodReferenceClick\(vodScope, id\)/.test(handler) && /vodOffsetClick\(vodScope, id, step\)/.test(handler) &&
    /vodOffsetClearClick\(vodScope, id\)/.test(handler) && /alignVodGroup\(vodScope\)/.test(handler) &&
    /vodClearAll\(vodScope\)/.test(handler), "전체·선택 패널 버튼(기준·보정·초기화·맞추기)이 다시보기를 처리한다");
}

// ── 전체 범위 패널을 실제로 그린다(다시보기만 있을 때) ─────────────────────────
{
  const sliceFn = (name) => {
    const at = watch.indexOf(`  function ${name}(`);
    assert.ok(at > 0, `${name} 를 찾지 못했다`);
    return watch.slice(at, watch.indexOf("\n  }\n", at) + 4);
  };
  const block = watch.slice(watch.indexOf("  // ── 다시보기 그룹 싱크"), watch.indexOf("  function handleGroupSyncClick(target) {"));
  const pieces = ["renderSync", "getSyncRowViewState", "vodScopeRowViewState", "syncScopeIds", "inSyncScope",
    "syncGroupTooSmall", "syncNudgePending", "syncReadyLabel", "syncRateText", "pendingSync"].map(sliceFn).join("\n");
  const panel = { hidden: false, dataset: {}, innerHTML: "", contains: () => false };
  const now = Date.now();
  const state = {
    chosen: [{ channelId: "video:1", channelName: "가" }, { channelId: "video:2", channelName: "나" }],
    mainId: "video:1",
    sync: { scope: "all", mode: "auto", groups: [], selectedChannelIds: [], referenceChannelId: "video:1",
      manualOffsets: {}, congested: false },
  };
  const ctx = {
    globalThis: { CheeseMultiviewVodSync: V }, state, cells: new Map(), Date, CSS: { escape: (v) => v },
    isVideoSlot: (id) => id.startsWith("video:"), currentStatus: () => "ready",
    MULTIVIEW_MESSAGE: "mv", FRAME_TOKEN_FIELD: {}, CHZZK_ORIGIN: "", syncNotice: "",
    refreshSyncPanel: () => {}, window: { setTimeout: () => 1 }, clearTimeout: () => {},
    $: (id) => (id === "mvSyncPop" ? panel : null), document: { activeElement: null },
    esc: (v) => String(v).replace(/[&<>"]/g, ""), fmtSyncSeconds: (v) => (v == null ? "-" : `${v}초`),
    SYNC: require("../src/multiviewSync.js"), syncStats: new Map(), syncReadyAt: new Map(),
    pendingSyncCommands: new Map(), syncDiagnostics: new Map(), syncDiagnosticsUi: false,
    syncDiagnosticsNotice: "", syncDiagnosticsPhase: "idle",
    syncDiagnosticsStatusText: () => "", syncDiagnosticsControlsHtml: () => "",
  };
  vm.createContext(ctx);
  const api = vm.runInContext(`${block}\n${pieces}\n({ renderSync, vodSyncStats, tickVodSyncGroups })`, ctx);
  api.vodSyncStats.set("video:1", V.normalize(raw({ sampledAt: now, currentTime: 400 }), now));
  api.vodSyncStats.set("video:2", V.normalize(raw({ sampledAt: now, liveOpenAt: OPEN_B, currentTime: 95, paused: true }), now));
  api.tickVodSyncGroups(now);
  api.renderSync(true);
  const html = panel.innerHTML;
  check(panel.dataset.mvSyncKind === "vod" && html.includes("기준에 맞추기") &&
    html.includes("다시보기는 실제 방송 시각") && /방송 시각 \d{2}:\d{2}:\d{2}/.test(html) &&
    html.includes("일시정지") && html.includes("이후 장면 쪽") && !html.includes("지연 -"),
    "전체 범위 패널이 다시보기 행(방송 시각·재생 상태·버튼 설명)으로 그려진다");
  check(/data-mv-sync-warning="group" hidden/.test(html) && /data-mv-sync-warning="mixed" hidden/.test(html),
    "다시보기만 있으면 '2개 이상 선택'·섞임 경고가 숨겨진다");
}

// ── 시청 화면 연결 ─────────────────────────────────────────────────────────
check(/"FRAME_VOD_SYNC_STATS",\s*"FRAME_VOD_SYNC_RESULT",/.test(watch) &&
  /data\.type === "FRAME_VOD_SYNC_STATS"[\s\S]{0,200}VOD_SYNC\.normalize\(data\.stats\)/.test(watch),
  "시청 화면이 다시보기 싱크 메시지를 받아 검증한다");
check(/requestVodSyncStats\(\);\s*tickVodSyncGroups\(now\);\s*tickSyncGroups\(now\);/.test(watch),
  "그룹 범위 틱에서 다시보기 싱크를 함께 돌린다");
check(/if \(isVideoSlot\(channelId\)\) return getVodGroupRowViewState\(group, channelId, now\);/.test(watch) &&
  /"라이브와 다시보기는 한 그룹에서 맞출 수 없습니다\. 그룹을 나눠 주세요\."/.test(watch) &&
  /groupMediaKind\(group\) === "vod" \? "기준에 맞추기" : "느린 채널에 맞추기"/.test(watch),
  "패널: 다시보기 행 표시·섞인 그룹 경고·버튼 이름");
check((watch.match(/groupMediaKind\(group\) === "vod"/g) || []).length >= 6,
  "기준·보정·초기화·맞추기 버튼이 다시보기 그룹을 따로 처리한다");
check(/resetLiveCatchUp\(channelId\);\s*resetVodSync\(channelId\);/.test(watch) &&
  /resetLiveCatchUp\(\);\s*resetVodSync\(\);/.test(watch), "채널 교체·페이지 종료 때 상태를 비운다");

// ── 프레임(content.js) ─────────────────────────────────────────────────────
{
  const content = read("src/content.js");
  check(/data\.type === "REQUEST_FRAME_VOD_SYNC_STATS"[\s\S]{0,60}reportVodSyncStats\(\)/.test(content) &&
    /data\.type === "APPLY_VOD_SYNC"[\s\S]{0,60}applyVodSyncCommand\(data\)/.test(content),
    "프레임이 측정 요청과 명령을 받는다");
  check(/liveOpenAt: vodSyncOpenAt\(\)/.test(content) && /recapVodStartAt\(videoNo\)/.test(content),
    "방송 시작 시각은 기존 recapVodStartAt(캐시) 으로 받는다");
  check(/now < vodSyncCommandUntil \|\| now - vodSyncGestureAt > VOD_SYNC_GESTURE_MS/.test(content) &&
    /for \(const type of \["pointerdown", "pointerup", "keydown"\]\)/.test(content),
    "클릭·키 입력 직후의 조작만 사용자 조작으로 보고, 우리 명령 직후는 뺀다");
  check(/vodSyncCommandUntil = Date\.now\(\) \+ VOD_SYNC_COMMAND_QUIET_MS;/.test(content) &&
    /isAdPlaying\(\)\) return reply\(false, "ad"\)/.test(content), "명령은 광고 중이면 거절하고, 적용 직후 변화는 조작으로 치지 않는다");
  check((content.match(/bindVodSyncVideo\(/g) || []).length >= 4, "영상이 바뀔 때 이벤트를 다시 붙인다");
}

// ── 로딩 경로 ─────────────────────────────────────────────────────────────
check(/<script src="src\/multiviewVodSync\.js"><\/script>/.test(read("multiviewWatch.html")) &&
  /"src\/multiviewVodSync\.js",\s*"src\/multiviewWatch\.js",/.test(read("src/background.js")),
  "확장 페이지·치지직 호스트 양쪽에서 시청 화면보다 먼저 싣는다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
