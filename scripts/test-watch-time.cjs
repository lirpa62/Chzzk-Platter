// 시청 시간 기록: 저장 형식(watchTimeStore.js), 세는 조건(content.js), 배경 쓰기·지우기(background.js).
//
// 세는 조건: 영상이 실제로 나아가고 탭이 보이거나 소리가 날 때(음소거여도 보이면). 라이브·
// 다시보기·라디오, 로그인·비로그인을 따로 센다. 숨긴 탭은 타이머가 1분까지 늦어지므로 그
// 사이 실제로 나아간 재생 시간(배속 감안)과 흐른 시간 중 작은 쪽만 센다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const storeSrc = read("src/watchTimeStore.js");
const content = read("src/content.js");
const background = read("src/background.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `${start} 를 찾지 못했다`);
  const stop = source.indexOf(end, at);
  assert.ok(stop > at, `${end} 를 찾지 못했다`);
  return source.slice(at, stop);
};
const A = "a".repeat(32);
const B = "b".repeat(32);

(async () => {
  // ── 저장 형식 ──────────────────────────────────────────────────────────
  const storeCtx = vm.createContext({});
  vm.runInContext(storeSrc, storeCtx);
  const S = storeCtx.CheeseWatchTimeStore;
  const at = new Date(2026, 9, 7, 21, 30).getTime();
  const login = S.bucket({ at, accountId: "ABCDEF0123456789XYZ", channelId: A.toUpperCase(), mode: "live" });
  check(login.shard === "cheeseWatchTime:2026-10-07" && login.key === `abcdef0123|${A}|l`,
    `하루 키에 계정(해시 앞 10자)·채널·종류로 담는다 ${JSON.stringify(login)}`);
  const guest = S.bucket({ at, accountId: "", channelId: A, mode: "radio" });
  check(guest.key === `-|${A}|r`, "비로그인은 '-' 로 따로 담는다");
  check(S.bucket({ at, channelId: "nope", mode: "live" }) === null &&
    S.bucket({ at, channelId: A, mode: "clip" }) === null, "잘못된 채널·종류는 담지 않는다");

  const shards = {
    "2026-10-06": { [`abcdef0123|${A}|l`]: 3600, [`-|${A}|v`]: 600 },
    "2026-10-07": { [`abcdef0123|${A}|r`]: 120, [`-|${B}|l`]: 1800, broken: 9 },
  };
  const all = S.aggregate(shards);
  check(all.total === 6120 && all.byChannel[A].total === 4320 && all.byChannel[B].total === 1800 &&
    all.login === 3720 && all.guest === 2400 && all.live === 5400 && all.vod === 600 && all.radio === 120,
    "모두 합쳐 보기(채널·종류·로그인별 합계, 잘못된 키는 건너뜀)");
  check(S.aggregate(shards, { login: "guest" }).total === 2400 && S.aggregate(shards, { login: "login" }).total === 3720,
    "로그인·비로그인만 보기");
  check(S.aggregate(shards, { modes: ["vod", "radio"] }).total === 720, "종류 골라 보기");
  check(S.aggregate(shards, { from: "2026-10-07", to: "2026-10-07" }).total === 1920 &&
    Object.keys(S.aggregate(shards, { from: "2026-10-07" }).byDay).join() === "2026-10-07", "기간으로 보기");
  check(S.aggregate(shards, { channelId: A }).total === 4320, "한 채널만 보기");
  check(S.formatDuration(3725) === "1시간 2분" && S.formatDuration(3600) === "1시간" &&
    S.formatDuration(125) === "2분" && S.formatDuration(40) === "40초" && S.formatDuration(360000) === "100시간",
    "시간 표기");
  const storage = { cheeseWatchTimeDays: ["2026-10-06", "2026-10-07"], "cheeseWatchTime:2026-10-06": shards["2026-10-06"],
    "cheeseWatchTime:2026-10-07": shards["2026-10-07"], cheeseOther: { big: true } };
  const asked = [];
  const get = async (keys) => {
    asked.push(keys);
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in storage).map((k) => [k, storage[k]]));
  };
  const loaded = await S.loadShards(get, { from: "2026-10-07" });
  check(Object.keys(loaded).join() === "2026-10-07" && asked.every((keys) => keys !== null),
    "날짜 목록으로 필요한 날짜만 읽는다(저장소 전체를 읽지 않는다)");

  // ── 세는 조건(content.js) ──────────────────────────────────────────────
  class Video {
    constructor() {
      Object.assign(this, { paused: false, ended: false, readyState: 4, muted: true, volume: 1,
        currentTime: 100, playbackRate: 1, videoWidth: 1920 });
    }
  }
  const sent = [];
  let now = at;
  const ctx = {
    WATCH_TIME_STORE: S,
    HTMLVideoElement: Video,
    Date: { now: () => now },
    location: { hostname: "chzzk.naver.com", pathname: `/live/${A}` },
    document: { visibilityState: "visible", querySelector: () => video },
    window: { setInterval: () => 1, clearInterval() {} },
    chrome: { runtime: { sendMessage: (message, cb) => { sent.push(message); cb?.(); }, lastError: null } },
    currentLiveChannelId: () => (ctx.location.pathname.match(/^\/live\/([0-9a-f]{32})/i) || [])[1] || "",
    getCurrentVideoNo: () => (ctx.location.pathname.match(/^\/video\/(\d+)/) || [])[1] || "",
    recapVodChannel: { videoNo: "", channelId: "" },
    ensureRecapVodChannel: () => { ctx.recapVodChannel = { videoNo: "77", channelId: B }; },
    currentClipVaultAccountId: () => "abcdef0123456789",
  };
  let video = new Video();
  vm.runInNewContext(`
    ${between(content, "  const WATCH_TIME_TICK_MS", "  // 탭을 숨기거나 떠날 때")}
    this.tick = tickWatchTime;
    this.flush = flushWatchTime;
    this.on = () => { watchTimeOn = true; applyWatchTime(); };
    this.pending = () => Object.fromEntries(watchTimePending);
    this.clear = () => watchTimePending.clear();
  `, vm.createContext(ctx));
  // 아직 모아 둔 것 + 이미 배경에 보낸 것(1분마다 보낸다).
  const pendingFor = (mode, account = "abcdef0123", channel = A) => {
    const key = `${account}|${channel}|${mode}`;
    const flushed = sent.flatMap((m) => m.entries).filter((e) => e.key === key)
      .reduce((sum, e) => sum + e.seconds, 0);
    return flushed + (ctx.pending()[`cheeseWatchTime:2026-10-07\n${key}`] || 0);
  };
  const step = (seconds, media = seconds) => {
    now += seconds * 1000;
    video.currentTime += media;
    ctx.tick();
  };
  ctx.on();
  ctx.tick();
  step(1); step(1); step(1);
  check(Math.abs(pendingFor("l") - 3) < 1e-9, "보이는 탭에서 재생되면 음소거여도 1초씩 센다(라이브·로그인)");
  video.paused = true;
  step(1, 0); step(1, 0);
  video.paused = false;
  step(1, 0);
  step(1);
  check(Math.abs(pendingFor("l") - 4) < 1e-9, "멈춘 동안과 다시 재생된 첫 순간은 세지 않는다");
  step(1, 0);
  step(1);
  check(Math.abs(pendingFor("l") - 5) < 1e-9, "버퍼링(재생 위치가 안 나아감)은 세지 않는다");
  ctx.document.visibilityState = "hidden";
  step(1);
  check(Math.abs(pendingFor("l") - 5) < 1e-9, "탭이 숨고 음소거면 세지 않는다");
  video.muted = false;
  ctx.tick();
  step(60);
  check(Math.abs(pendingFor("l") - 65) < 1e-9, "탭이 숨어도 소리가 나면 센다(타이머가 1분 늦어져도 그만큼)");
  step(300, 3);
  check(Math.abs(pendingFor("l") - 65) < 1e-9, "70초 넘게 비면(잠자기 등) 그 사이는 세지 않는다");
  step(10, 2);
  check(Math.abs(pendingFor("l") - 67) < 1e-9, "흐른 시간보다 재생이 덜 나아갔으면 나아간 만큼만 센다");
  video.playbackRate = 2;
  step(1, 2);
  check(Math.abs(pendingFor("l") - 68) < 1e-9, "배속이어도 흐른 시간만큼 센다");
  video.playbackRate = 1;
  ctx.document.visibilityState = "visible";
  video.videoWidth = 0;
  ctx.tick();
  step(2);
  check(Math.abs(pendingFor("r") - 2) < 1e-9, "라디오(소리만)는 따로 센다");
  video.videoWidth = 1920;
  ctx.location.pathname = "/video/77";
  ctx.tick(); // 다시보기 채널을 아직 모르면 조회하고 넘어간다
  ctx.tick();
  step(3);
  check(Math.abs(pendingFor("v", "abcdef0123", B) - 3) < 1e-9, "다시보기는 그 영상의 채널로 따로 센다");
  ctx.currentClipVaultAccountId = () => "";
  step(2);
  check(Math.abs(pendingFor("v", "-", B) - 2) < 1e-9, "비로그인은 따로 센다");
  video = new Video();
  step(1);
  check(Math.abs(pendingFor("v", "-", B) - 2) < 1e-9, "플레이어가 바뀐 첫 순간은 세지 않는다");
  const before = sent.length;
  now += 60000;
  ctx.tick();
  check(before >= 1 && sent.length === before + 1 && sent.every((m) => m.type === "CHEESE_WATCH_TIME_ADD") &&
    sent.at(-1).entries.some((e) => e.shard === "cheeseWatchTime:2026-10-07" && e.key === `-|${B}|v` && e.seconds === 2) &&
    Object.keys(ctx.pending()).length === 0, "1분마다 모은 것을 배경에 보낸다");
  check(/document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(watchTimeOn && document\.visibilityState === "hidden"\) flushWatchTime\(\);/.test(content) &&
    /window\.addEventListener\("pagehide", \(\) => \{\s*if \(watchTimeOn\) flushWatchTime\(\);/.test(content),
    "탭을 숨기거나 떠날 때 바로 보낸다");
  check(/return document\.querySelector\("#live_player_layout video, #player_layout video"\);/.test(content),
    "본 플레이어만 센다(카드·팔로잉 미리보기 영상은 세지 않는다)");

  // ── 배경: 모아 쓰기·날짜 목록·지우기 ──────────────────────────────────────
  const local = {};
  const bgCtx = {
    chrome: { storage: { local: {
      get: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in local).map((k) => [k, local[k]]))));
      },
      set: async (values) => Object.assign(local, JSON.parse(JSON.stringify(values))),
      remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete local[k]),
    } } },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  vm.runInNewContext(`
    ${between(background, "const WATCH_TIME_SHARD_RE", "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {")}
    this.add = addWatchTime;
    this.flush = flushWatchTime;
    this.remove = deleteWatchTime;
  `, vm.createContext(bgCtx));
  const day = "cheeseWatchTime:2026-10-07";
  check(bgCtx.add([{ shard: day, key: `-|${A}|l`, seconds: 30 }, { shard: day, key: `-|${A}|l`, seconds: 12.5 },
    { shard: day, key: `abcdef0123|${B}|v`, seconds: 5 }, { shard: "cheeseOther", key: "x", seconds: 1 },
    { shard: day, key: `-|${A}|l`, seconds: 99999 }]) === 3, "모양이 맞는 것만 받는다(다른 키·지나친 값은 버린다)");
  await bgCtx.flush();
  check(local[day][`-|${A}|l`] === 42.5 && local[day][`abcdef0123|${B}|v`] === 5 &&
    JSON.stringify(local.cheeseWatchTimeDays) === '["2026-10-07"]', "모아서 한 번에 더하고 날짜 목록에 올린다");
  bgCtx.add([{ shard: day, key: `-|${A}|l`, seconds: 7.5 }]);
  await bgCtx.flush();
  check(local[day][`-|${A}|l`] === 50, "이미 있는 값에 더한다");
  bgCtx.add([{ shard: day, key: `-|${A}|l`, seconds: 3 }, { shard: day, key: `abcdef0123|${B}|v`, seconds: 4 }]);
  await bgCtx.remove(A);
  await bgCtx.flush();
  check(!(`-|${A}|l` in local[day]) && local[day][`abcdef0123|${B}|v`] === 9,
    "한 채널만 지우면 그 채널만 사라지고(아직 안 쓴 것까지), 다른 채널은 남는다");
  await bgCtx.remove("");
  check(!(day in local) && !("cheeseWatchTimeDays" in local), "전체 지우기");

  check(/if \(message\.type === "CHEESE_WATCH_TIME_ADD"\) \{\s*\/\/[^\n]*\n\s*if \(!\/\^https:\\\/\\\/chzzk\\\.naver\\\.com\\\/\/\.test/.test(background) &&
    /if \(message\.type === "CHEESE_WATCH_TIME_DELETE"\) \{[\s\S]{0,200}startsWith\(chrome\.runtime\.getURL\(""\)\)\) return false;/.test(background),
    "쓰기는 치지직 페이지에서만, 지우기는 확장 화면에서만 받는다");

  // 설정: 플레이어 탭 '시청 기록' 묶음 + 왼쪽 탭 목록 바로가기.
  const html = read("settings.html");
  const ui = read("src/settingsUi.js");
  const sectionAt = html.indexOf('aria-label="시청 기록"');
  const section = html.slice(html.lastIndexOf("<section", sectionAt), html.indexOf("</section>", sectionAt));
  check(/data-panel="player"/.test(section) && section.includes("data-watch-time-enabled") &&
    /id="openWatchTime"[\s\S]*시청 시간[\s\S]*열기\s*<\/button>/.test(section) &&
    (html.match(/data-watch-time-enabled/g) || []).length === 1,
    "설정: 시청 시간 기록은 플레이어 탭 '시청 기록' 묶음에 있다(채팅 탭에서 옮김)");
  check(/\["player", "#openWatchTime"\]/.test(ui),
    "설정: 왼쪽 플레이어 탭 아래에 시청 시간 통계 바로가기(채팅 리캡 열기와 같은 방식)");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
