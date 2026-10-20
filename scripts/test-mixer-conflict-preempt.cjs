// 오디오 믹서 충돌 시 '새로고침 후 다시 시도'(audioMixer.js).
//
// 증상: 다른 확장이 같은 video 로 createMediaElementSource 를 먼저 만들면(InvalidStateError)
//       믹서를 켤 수 없고, 안내는 '그 확장을 끄고 새로고침'뿐이었다.
// 동작: 충돌 안내의 버튼 → 새로고침(다시보기는 보던 위치) → 새 페이지에서는 자동 활성화 설정과
//       관계없이 연결이 허용되는 가장 이른 때 믹서를 먼저 연결한다.
//   - 사용자가 누를 때만, 같은 탭·같은 영상에서 한 번만 → 새로고침이 반복되지 않는다.
//   - 다시 시도했는데도 충돌이면 상대 확장을 끄는 방법만 안내한다(버튼 없음).
//   - 제스처 전(멈춘 AudioContext)에는 연결하지 않는다(영상 소리가 끊긴다).
// 원본 함수를 그대로 떼어 와 순서대로 돌린다(규칙을 손으로 베끼면 원본이 바뀌어도 통과한다).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "src", "audioMixer.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

function fn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`${name} 를 찾지 못했다`);
  const end = SRC.indexOf("\n  }\n", at);
  return SRC.slice(at, end + 4);
}
function block(startMarker, endMarker) {
  const at = SRC.indexOf(startMarker);
  const end = SRC.indexOf(endMarker, at);
  if (at < 0 || end < at) throw Error(`${startMarker} 구간을 찾지 못했다`);
  return SRC.slice(at, end);
}
const PREEMPT = block("  // ── 충돌 시 '새로고침 후 다시 시도'", "  // 페이지 식별:");
const CODE = [PREEMPT, fn("maybeEnableMixerPreempt"), fn("renderGraphConflictNotice")].join("\n");

// 한 번의 페이지 로드를 흉내 낸다. session 은 탭 단위 저장소(새로고침해도 남는다).
function load({ session, path: pathname = "/video/777", search = "", top = true, multiview = "", now = Date.now() }) {
  const storage = {
    getItem: (key) => (key in session ? session[key] : null),
    setItem: (key, value) => {
      session[key] = String(value);
    },
    removeItem: (key) => {
      delete session[key];
    },
  };
  const ctx = {
    sessionStorage: storage,
    location: {
      pathname,
      href: `https://chzzk.naver.com${pathname}${search}`,
      reload() {
        ctx.navigated = "reload";
      },
      replace(href) {
        ctx.navigated = href;
      },
    },
    URL,
    JSON,
    Number,
    String,
    Boolean,
    Math,
    Date: { now: () => now },
    navigated: "",
    currentPageKey: null,
    multiviewSlotId: multiview,
    featureFlags: { audioMixer: false },
    userGestureSeen: false,
    stateLoaded: true,
    graphConflict: false,
    state: { enabled: false },
    audio: { connected: false },
    video: { currentTime: 3725 },
    enableCalls: 0,
    enableResult: "connected",
  };
  ctx.window = { top: top ? null : {} };
  ctx.window.top = top ? ctx.window : {};
  const helpers = `
    function getPageKey() {
      const vod = location.pathname.match(/^\\/video\\/(\\d+)/);
      if (vod) return "video:" + vod[1];
      const live = location.pathname.match(/^\\/live\\/([0-9a-f]{32})/i);
      return live ? "live:" + live[1] : null;
    }
    function findVideo() { return video; }
    function isElementRendered(v) { return Boolean(v); }
    function setEnabled(on) {
      enableCalls++;
      if (enableResult === "connected") { state.enabled = true; audio.connected = true; }
      else if (enableResult === "conflict") { state.enabled = false; graphConflict = true; }
      else state.enabled = false; // 사용자 활성화 없음 같은 일시 실패
    }
  `;
  vm.createContext(ctx);
  // let 으로 선언된 원본 변수(mixerPreemptPageKey)를 밖에서 보려고 getter 를 단다.
  vm.runInContext(`${helpers}\n${CODE}\nthis.__api = { reloadToPreemptMixer, mixerPreemptActive, mixerConflictRetried,
    maybeEnableMixerPreempt, renderGraphConflictNotice, preemptKey: () => mixerPreemptPageKey };`, ctx);
  return ctx;
}

// 1) 처음 충돌: 버튼이 있고, 누르면 표시를 남기고 보던 위치로 새로고침
{
  const session = {};
  const page = load({ session });
  page.graphConflict = true;
  const html = page.__api.renderGraphConflictNotice();
  check(/data-action="conflict-reload"/.test(html) && /새로고침하면 믹서가 먼저 연결을 시도합니다/.test(html),
    "처음 충돌하면 안내에 '새로고침 후 다시 시도' 버튼");
  page.__api.reloadToPreemptMixer();
  const flag = JSON.parse(session.cheeseMixerPreempt);
  check(page.navigated === "https://chzzk.naver.com/video/777?currentTime=3725" && flag.pageKey === "video:777" &&
    JSON.parse(session.cheeseMixerConflictRetried) === "video:777",
    `다시보기는 보던 위치(currentTime)로 새로고침하고, 탭 저장소에 '먼저 연결'·'다시 시도함' 표시 ${page.navigated}`);

  // 2) 새로고침한 페이지: 표시를 읽고 지운다 → 제스처 전엔 연결하지 않는다
  const next = load({ session, search: "?currentTime=3725" });
  check(next.__api.preemptKey() === "video:777" && !("cheeseMixerPreempt" in session) && next.__api.mixerPreemptActive(),
    "새로고침한 같은 영상에서 '먼저 연결'을 켜고 표시는 바로 지운다(다음 로드에 다시 쓰지 않는다)");
  next.__api.maybeEnableMixerPreempt();
  check(next.enableCalls === 0, "첫 클릭/소리 재생 전(멈춘 AudioContext)에는 연결하지 않는다 — 소리가 끊기지 않게");
  // 일시 실패(활성화 창 놓침)면 다음 기회에 다시
  next.userGestureSeen = true;
  next.enableResult = "transient";
  next.__api.maybeEnableMixerPreempt();
  check(next.enableCalls === 1 && next.__api.mixerPreemptActive(), "일시 실패면 '먼저 연결'을 유지해 다음 제스처에 다시 시도");
  next.enableResult = "connected";
  next.__api.maybeEnableMixerPreempt();
  check(next.enableCalls === 2 && next.audio.connected && !next.__api.mixerPreemptActive(),
    "제스처가 오면 자동 활성화 설정과 관계없이 믹서를 켜고, 연결되면 한 번으로 끝낸다");

  // 3) 그래도 충돌: 버튼 없이 원인 안내, 다시 눌러도 새로고침하지 않는다
  const again = load({ session: { cheeseMixerConflictRetried: JSON.stringify("video:777") } });
  again.graphConflict = true;
  const html2 = again.__api.renderGraphConflictNotice();
  again.__api.reloadToPreemptMixer();
  check(!/conflict-reload/.test(html2) && /페이지를 열 때 바로 오디오를 연결/.test(html2) && /사이트 액세스/.test(html2) && again.navigated === "",
    "이 영상에서 이미 다시 시도했으면 버튼 없이 상대 확장을 끄는 방법만 안내하고, 새로고침도 하지 않는다(반복 없음)");
}

// 4) 다시 충돌하면 '먼저 연결'도 끝낸다
{
  const session = { cheeseMixerPreempt: JSON.stringify({ pageKey: "video:777", at: Date.now() }) };
  const page = load({ session });
  page.userGestureSeen = true;
  page.enableResult = "conflict";
  page.__api.maybeEnableMixerPreempt();
  check(page.graphConflict && !page.__api.mixerPreemptActive(), "새로고침 뒤에도 충돌하면 더 시도하지 않는다");
}

// 5) 표시가 맞지 않으면 쓰지 않는다
{
  const other = load({ session: { cheeseMixerPreempt: JSON.stringify({ pageKey: "video:1", at: Date.now() }) } });
  const stale = load({ session: { cheeseMixerPreempt: JSON.stringify({ pageKey: "video:777", at: Date.now() - 120000 }) } });
  const frameSession = { cheeseMixerPreempt: JSON.stringify({ pageKey: "video:777", at: Date.now() }) };
  const frame = load({ session: frameSession, top: false });
  check(!other.__api.preemptKey() && !stale.__api.preemptKey() && !frame.__api.preemptKey() && "cheeseMixerPreempt" in frameSession,
    "다른 영상·1분 넘은 표시는 쓰지 않고, 같은 탭의 iframe 은 표시를 읽지도 지우지도 않는다");
}

// 6) 라이브는 그냥 새로고침, 멀티뷰 칸은 버튼 없음
{
  const live = load({ session: {}, path: "/live/0123456789abcdef0123456789abcdef" });
  live.__api.reloadToPreemptMixer();
  const cell = load({ session: {}, multiview: "slot-1" });
  cell.graphConflict = true;
  check(live.navigated === "reload" && !/conflict-reload/.test(cell.__api.renderGraphConflictNotice()),
    "라이브는 그대로 새로고침, 멀티뷰 칸 안에서는 버튼을 두지 않는다(칸만 새로고침할 수 없다)");
}

// 7) 연결 경로에 걸려 있는지(원본)
{
  const auto = fn("maybeAutoEnableMixer");
  const wants = fn("wantsAutoEnable");
  check(/if \(mixerPreemptActive\(\)\) \{\s*maybeEnableMixerPreempt\(\);\s*return;/.test(auto) &&
    auto.indexOf("mixerPreemptActive()") < auto.indexOf("if (!mixerAlwaysOn && !mixerDefaultOn) return;"),
    "자동 활성화 판정에서 '먼저 연결'이 설정 검사보다 먼저다");
  check(/if \(mixerPreemptActive\(\)\) return true;/.test(wants) &&
    /if \(mixerAlwaysOn \|\| mixerPreemptActive\(\)\) maybeAutoEnableMixer\(\);/.test(SRC),
    "소리가 나는 재생이 시작되면(자동재생 허용) 클릭 전에도 먼저 연결을 시도한다");
  check(/if \(action === "conflict-reload"\) \{\s*reloadToPreemptMixer\(\);/.test(SRC), "패널 버튼(data-action) 연결");
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
