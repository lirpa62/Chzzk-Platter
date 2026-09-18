// 멀티뷰 칸 상태 기계.
//
// 6칸은 DOM 이 뜨는 시각이 제각각이라 준비 신호가 뒤죽박죽 온다. 그래도 각 칸이
// 서로에게 영향을 주지 않고 혼자 힘으로 끝까지 가야 한다.
//
// ⚠ 이 파일은 multiviewWatch.js 의 상태 전이 규칙을 '복제' 한다. 원본을 고치면
//   여기도 함께 고쳐야 한다(브라우저 DOM 에 묶여 있어 Node 에서 그대로 못 부른다).

const UI_READY_TIMEOUT_MS = 30000;
const FRAME_READY_TIMEOUT_MS = 20000;

// 가짜 시계. 실제로 30초를 기다리지 않고 시간을 밀어 본다.
function makeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    setTimeout(fn, delay) {
      const id = timers.length;
      timers.push({ at: now + delay, fn, cancelled: false });
      return id;
    },
    clearTimeout(id) {
      if (timers[id]) timers[id].cancelled = true;
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = timers
          .filter((t) => !t.cancelled && t.at <= until)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.cancelled = true;
        now = next.at;
        next.fn();
      }
      now = until;
    },
  };
}

// multiviewWatch.js 와 같은 규칙으로 칸 상태를 관리한다.
function makeStage(channelIds, clock) {
  const states = new Map();
  const frameTimers = new Map();
  const uiTimers = new Map();
  const sent = []; // 프레임으로 나간 지시
  const reloads = [];

  const status = (id) => states.get(id) || "";
  const setStatus = (id, next) => states.set(id, next);

  function armReadyTimeout(id) {
    clock.clearTimeout(frameTimers.get(id));
    frameTimers.set(
      id,
      clock.setTimeout(() => {
        // 이미 준비됐거나 끝난 칸은 건드리지 않는다.
        const now = status(id);
        if (now !== "ready" && now !== "ended" && now !== "initializing-ui") {
          setStatus(id, "error");
        }
      }, FRAME_READY_TIMEOUT_MS),
    );
  }

  function requestUiApply(id) {
    sent.push({ id, type: "APPLY_MULTIVIEW_UI" });
    clock.clearTimeout(uiTimers.get(id));
    uiTimers.set(
      id,
      clock.setTimeout(() => {
        if (status(id) === "initializing-ui") setStatus(id, "ui-error");
      }, UI_READY_TIMEOUT_MS),
    );
  }

  function create(id) {
    setStatus(id, "loading");
    armReadyTimeout(id);
  }

  function onFrameReady(id) {
    clock.clearTimeout(frameTimers.get(id));
    frameTimers.delete(id);
    if (status(id) === "ended") return; // 종료된 칸은 그대로
    setStatus(id, "initializing-ui");
    sent.push({ id, type: "SET_MULTIVIEW_STATE" });
    requestUiApply(id);
  }

  function onUiReady(id) {
    if (status(id) === "ended") return; // 늦게 온 신호가 종료를 덮지 않는다
    clock.clearTimeout(uiTimers.get(id));
    uiTimers.delete(id);
    setStatus(id, "ready");
  }

  function onEnded(id) {
    clock.clearTimeout(frameTimers.get(id));
    frameTimers.delete(id);
    clock.clearTimeout(uiTimers.get(id));
    uiTimers.delete(id);
    setStatus(id, "ended");
  }

  function reapplyUi(id) {
    setStatus(id, "initializing-ui");
    requestUiApply(id);
  }

  function reload(id) {
    reloads.push(id);
    setStatus(id, "loading");
    armReadyTimeout(id);
  }

  for (const id of channelIds) create(id);
  return {
    status,
    states,
    sent,
    reloads,
    onFrameReady,
    onUiReady,
    onEnded,
    reapplyUi,
    reload,
  };
}

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};

const IDS = ["A", "B", "C", "D", "E", "F"];

console.log("[6칸] 준비 순서가 뒤섞여도 각자 끝까지 간다");
{
  const clock = makeClock();
  const stage = makeStage(IDS, clock);
  // 준비 신호가 제각각 온다.
  const readyAt = { A: 100, B: 500, C: 1800, D: 800, E: 3000, F: 1300 };
  // 화면 정리 완료는 또 다른 순서로 온다.
  const uiAt = { A: 2500, B: 900, C: 4000, D: 3500, E: 3200, F: 6000 };
  const events = [
    ...IDS.map((id) => ({ at: readyAt[id], id, kind: "ready" })),
    ...IDS.map((id) => ({ at: uiAt[id], id, kind: "ui" })),
  ].sort((a, b) => a.at - b.at);
  let last = 0;
  for (const event of events) {
    clock.advance(event.at - last);
    last = event.at;
    if (event.kind === "ready") stage.onFrameReady(event.id);
    else stage.onUiReady(event.id);
  }
  clock.advance(60000); // 타임아웃이 남아 있었다면 여기서 터진다
  ok(
    IDS.every((id) => stage.status(id) === "ready"),
    `6칸 모두 ready (${IDS.map((id) => stage.status(id)).join(",")})`,
  );
  ok(
    stage.sent.filter((m) => m.type === "APPLY_MULTIVIEW_UI").length === 6,
    "칸마다 화면 정리 지시가 한 번씩 갔다",
  );
  ok(stage.reloads.length === 0, "정상 흐름에서는 다시 로드하지 않는다");
}

console.log("\n[한 칸 실패] 다른 칸에 영향을 주지 않는다");
{
  const clock = makeClock();
  const stage = makeStage(IDS, clock);
  for (const id of IDS) stage.onFrameReady(id);
  // C 만 화면 정리를 끝내지 못한다.
  for (const id of IDS.filter((x) => x !== "C")) stage.onUiReady(id);
  clock.advance(UI_READY_TIMEOUT_MS + 1000);
  ok(stage.status("C") === "ui-error", "C 는 화면 정리 실패로 남는다");
  ok(
    IDS.filter((x) => x !== "C").every((id) => stage.status(id) === "ready"),
    "나머지 5칸은 그대로 ready",
  );
  ok(stage.reloads.length === 0, "정리 실패로 프레임을 다시 로드하지 않는다");

  // C 만 다시 적용한다.
  const before = stage.sent.length;
  stage.reapplyUi("C");
  ok(stage.status("C") === "initializing-ui", "다시 적용하면 준비 중으로 간다");
  const added = stage.sent.slice(before);
  ok(
    added.length === 1 && added[0].id === "C",
    "다시 적용 지시는 C 에게만 간다",
  );
  stage.onUiReady("C");
  ok(stage.status("C") === "ready", "다시 적용 후 ready 가 된다");
  ok(stage.reloads.length === 0, "다시 적용은 프레임을 다시 로드하지 않는다");
}

console.log("\n[FRAME_READY 만] 덮개를 걷지 않고 정리 실패로 간다");
{
  const clock = makeClock();
  const stage = makeStage(["A"], clock);
  stage.onFrameReady("A");
  ok(
    stage.status("A") === "initializing-ui",
    "준비 신호만으로는 ready 가 아니다",
  );
  ok(
    stage.sent.some((m) => m.type === "SET_MULTIVIEW_STATE"),
    "소리·화질 상태를 다시 내려 준다",
  );
  clock.advance(UI_READY_TIMEOUT_MS + 1000);
  ok(stage.status("A") === "ui-error", "시간이 지나면 정리 실패로 바뀐다");
  ok(stage.reloads.length === 0, "그래도 프레임은 다시 로드하지 않는다");
}

console.log("\n[늦은 신호] 종료 상태를 덮지 않는다");
{
  const clock = makeClock();
  const stage = makeStage(["A"], clock);
  stage.onFrameReady("A");
  stage.onEnded("A");
  ok(stage.status("A") === "ended", "종료로 바뀐다");
  // 늦게 도착한 신호들.
  stage.onUiReady("A");
  ok(stage.status("A") === "ended", "늦은 UI 준비 신호가 종료를 덮지 않는다");
  stage.onFrameReady("A");
  ok(stage.status("A") === "ended", "늦은 프레임 준비 신호도 덮지 않는다");
  clock.advance(60000);
  ok(stage.status("A") === "ended", "타임아웃도 종료를 덮지 않는다");
  // 사용자가 직접 다시 불러오면 그때만 로드한다.
  stage.reload("A");
  ok(
    stage.status("A") === "loading" && stage.reloads.length === 1,
    "사용자 재시도만 로드한다",
  );
}

console.log("\n[준비 실패] 프레임 자체가 안 오면 오류로 간다");
{
  const clock = makeClock();
  const stage = makeStage(["A"], clock);
  clock.advance(FRAME_READY_TIMEOUT_MS + 1000);
  ok(stage.status("A") === "error", "준비 신호가 없으면 오류");
  ok(stage.reloads.length === 0, "자동으로 다시 로드하지 않는다");
}

console.log("\n[채팅 접기 콜백] 이미 감시 중이어도 결과를 받는다");
{
  // ⚠ 실제로 났던 버그: 일반 채팅 복원이 이미 돌고 있으면 멀티뷰가 건 콜백이
  //   등록조차 되지 않아, 모든 칸이 '화면 정리를 완료하지 못했습니다' 로 끝났다.
  //   content.js 의 startChatFoldEnforce 와 같은 규칙으로 검증한다.
  function makeEngine() {
    let timer = 0;
    let callbacks = [];
    return {
      start({ onSettle } = {}) {
        if (onSettle) callbacks.push(onSettle);
        if (timer) return; // 이미 돌고 있다 — 위에서 콜백만 얹었다
        timer = 1;
      },
      finish(ok) {
        const cbs = callbacks;
        callbacks = [];
        timer = 0;
        for (const cb of cbs) cb(ok);
      },
    };
  }
  const engine = makeEngine();
  let got = null;
  engine.start(); // 일반 채팅 복원이 먼저 돌고 있다
  engine.start({ onSettle: (ok) => (got = ok) }); // 멀티뷰가 뒤늦게 붙는다
  engine.finish(true);
  ok(got === true, "이미 감시 중일 때 붙인 콜백도 불린다");

  // 여러 번 붙어도 모두 받아야 한다.
  const engine2 = makeEngine();
  const results = [];
  engine2.start({ onSettle: (v) => results.push(v) });
  engine2.start({ onSettle: (v) => results.push(v) });
  engine2.finish(false);
  ok(results.length === 2, `콜백 여러 개가 모두 불린다(${results.length}개)`);
  // 한 번 부른 콜백은 다시 부르지 않는다.
  engine2.finish(true);
  ok(results.length === 2, "이미 끝난 콜백을 다시 부르지 않는다");
}

console.log("\n[넓은 화면] 설정이 늦게 와도 한 번에 끝난다");
{
  // ⚠ 실제로 났던 증상: '화면 다시 적용' 을 두 번 눌러야 됐다.
  //   설정 브리지가 아직 안 온 상태에서 첫 지시가 오면 예전 코드는 아무 말 없이
  //   돌아가(완료 신호 없음) 부모가 계속 기다렸다. 두 번째 누를 때쯤 설정이
  //   도착해 그제서야 동작한 것이다.
  function run(waitsForSettings, settingsAt) {
    let now = 0;
    let settingsLoaded = false;
    let notified = 0;
    let waitUntil = 0;
    let pending = false;
    const tick = (ms) => {
      now += ms;
      if (now >= settingsAt) settingsLoaded = true;
    };
    const apply = () => {
      if (!settingsLoaded) {
        // 기다리지 않는 예전 방식은 여기서 그냥 끝난다(신호 없음).
        if (!waitsForSettings) return;
        if (now < waitUntil) {
          pending = true;
          return;
        }
        notified += 1; // 기한 초과 — 붙잡지 않고 알린다
        return;
      }
      notified += 1;
    };
    const press = () => {
      waitUntil = now + 15000;
      apply();
    };
    press();
    // 기한(15초)을 넘길 만큼 충분히 돌린다.
    for (let i = 0; i < 70; i += 1) {
      tick(300);
      if (pending) {
        pending = false;
        apply();
      }
    }
    return notified;
  }
  ok(
    run(false, 2000) === 0,
    "기다리지 않으면 첫 지시에서 완료 신호가 없다(옛 증상)",
  );
  ok(run(true, 2000) === 1, "설정을 기다리면 첫 지시만으로 완료 신호가 온다");
  ok(run(true, 999999) === 1, "설정이 끝내 안 와도 기한 뒤 한 번은 알린다");
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
