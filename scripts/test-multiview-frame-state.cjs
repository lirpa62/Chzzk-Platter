// 멀티뷰 칸 상태 기계.
//
// 6칸은 DOM 이 뜨는 시각이 제각각이라 준비 신호가 뒤죽박죽 온다. 그래도 각 칸이
// 서로에게 영향을 주지 않고 혼자 힘으로 끝까지 가야 한다.
//
// ⚠ 이 파일은 multiviewWatch.js 의 상태 전이 규칙을 '복제' 한다. 원본을 고치면
//   여기도 함께 고쳐야 한다(브라우저 DOM 에 묶여 있어 Node 에서 그대로 못 부른다).

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
        if (now !== "ready" && now !== "ended") {
          setStatus(id, "error");
        }
      }, FRAME_READY_TIMEOUT_MS),
    );
  }

  function create(id) {
    setStatus(id, "loading");
    armReadyTimeout(id);
  }

  // ⚠ 준비 신호를 받으면 바로 볼 수 있게 한다. 화면 정리(채팅 접기·넓은 화면)는
  //   프레임이 스스로 맞춰 가는 일이라 여기서 기다리지 않는다.
  function onFrameReady(id) {
    clock.clearTimeout(frameTimers.get(id));
    frameTimers.delete(id);
    if (status(id) === "ended") return; // 종료된 칸은 그대로
    sent.push({ id, type: "SET_MULTIVIEW_STATE" });
    setStatus(id, "ready");
  }

  function onEnded(id) {
    clock.clearTimeout(frameTimers.get(id));
    frameTimers.delete(id);
    setStatus(id, "ended");
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
    onEnded,
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

console.log("[6칸] 준비 순서가 뒤섞여도 각자 바로 볼 수 있다");
{
  const clock = makeClock();
  const stage = makeStage(IDS, clock);
  // 준비 신호가 제각각 온다.
  const readyAt = { A: 100, B: 500, C: 1800, D: 800, E: 3000, F: 1300 };
  const events = IDS.map((id) => ({ at: readyAt[id], id })).sort(
    (a, b) => a.at - b.at,
  );
  let last = 0;
  for (const event of events) {
    clock.advance(event.at - last);
    last = event.at;
    stage.onFrameReady(event.id);
  }
  clock.advance(60000); // 남은 타이머가 있었다면 여기서 터진다
  ok(
    IDS.every((id) => stage.status(id) === "ready"),
    `6칸 모두 ready (${IDS.map((id) => stage.status(id)).join(",")})`,
  );
  ok(stage.reloads.length === 0, "정상 흐름에서는 다시 로드하지 않는다");
  // ⚠ 화면 정리(채팅 접기·넓은 화면)를 기다리지 않는다. 치지직 DOM 이 늦게 뜨는 건
  //   오류가 아니라 정상이고, 프레임이 스스로 맞춰 간다.
  ok(
    stage.sent.filter((m) => m.type === "SET_MULTIVIEW_STATE").length === 6,
    "칸마다 소리·화질 상태를 다시 내려 줬다",
  );
}

console.log("\n[한 칸 지연] 다른 칸을 붙잡지 않는다");
{
  const clock = makeClock();
  const stage = makeStage(IDS, clock);
  for (const id of IDS.filter((x) => x !== "C")) stage.onFrameReady(id);
  ok(
    IDS.filter((x) => x !== "C").every((id) => stage.status(id) === "ready"),
    "먼저 준비된 5칸은 바로 ready",
  );
  ok(stage.status("C") === "loading", "늦은 칸만 아직 loading");
  clock.advance(3000);
  stage.onFrameReady("C");
  ok(stage.status("C") === "ready", "늦게 와도 그때 ready 가 된다");
  ok(stage.reloads.length === 0, "늦었다고 다시 로드하지 않는다");
}

console.log("\n[늦은 신호] 종료 상태를 덮지 않는다");
{
  const clock = makeClock();
  const stage = makeStage(["A"], clock);
  stage.onFrameReady("A");
  stage.onEnded("A");
  ok(stage.status("A") === "ended", "종료로 바뀐다");
  stage.onFrameReady("A"); // 늦게 도착한 준비 신호
  ok(stage.status("A") === "ended", "늦은 준비 신호가 종료를 덮지 않는다");
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

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
