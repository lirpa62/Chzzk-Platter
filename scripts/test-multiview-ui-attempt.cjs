// 멀티뷰 화면 정리(채팅 접기 + 넓은 화면) 시도 번호 규칙.
//
// 증상: 멀티뷰를 켜면 '화면 정리를 완료하지 못했습니다' 가 뜨고, 다시 적용을 두세
// 번 눌러야 정상이 됐다. 원인은 재적용할 때 이미 성공한 쪽까지 다시 기다리게 만든
// 것과, 늦게 온 결과가 어느 시도의 것인지 구분하지 못한 것이었다.
//
// ⚠ 이 파일은 content.js / multiviewWatch.js 의 규칙을 '복제' 한다. 원본을 고치면
//   여기도 함께 고쳐야 한다(브라우저 DOM 에 묶여 있어 Node 에서 그대로 못 부른다).

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};

// ── 프레임 쪽 규칙(content.js) ─────────────────────────────────────────────
function makeFrame({ foldedAtStart = false, wideAtStart = false } = {}) {
  const sent = []; // 부모로 보낸 신호
  const wideRequests = []; // MAIN world 로 보낸 요청
  let folded = foldedAtStart;
  let wide = wideAtStart;
  let chatReady = false;
  let wideReady = false;
  let active = 0;
  let settled = 0;
  let pendingChat = null; // 진행 중인 접기 감시의 시도 번호

  const isId = (v) => Number.isSafeInteger(v) && v > 0;

  function maybeReady(attemptId) {
    if (attemptId !== active) return;
    if (!chatReady || !wideReady) return;
    if (settled === attemptId) return;
    settled = attemptId;
    sent.push({ type: "FRAME_UI_READY", attemptId });
  }
  function fail(attemptId, reason) {
    if (attemptId !== active) return;
    if (settled === attemptId) return;
    settled = attemptId;
    sent.push({ type: "FRAME_UI_FAILED", attemptId, reason });
  }

  return {
    sent,
    wideRequests,
    get state() {
      return { chatReady, wideReady, active, folded, wide };
    },
    setFolded(v) {
      folded = v;
    },
    setWide(v) {
      wide = v;
    },
    apply(attemptId) {
      if (!isId(attemptId)) return;
      active = attemptId;
      // 채팅: 지금 실제로 접혀 있으면 즉시 완료로 본다(엔진을 다시 돌리지 않는다).
      if (folded) {
        chatReady = true;
        pendingChat = null;
      } else {
        chatReady = false;
        pendingChat = attemptId;
      }
      // 넓은 화면: 항상 물어본다(이미 넓으면 MAIN 이 즉시 답한다).
      wideReady = false;
      wideRequests.push(attemptId);
      maybeReady(attemptId);
    },
    // 접기 감시가 끝났다.
    chatSettled(attemptId, nowFolded) {
      if (attemptId !== pendingChat) return; // 지난 시도의 결과
      folded = nowFolded;
      if (attemptId !== active) return;
      if (!nowFolded) {
        fail(attemptId, "chat-fold");
        return;
      }
      chatReady = true;
      maybeReady(attemptId);
    },
    // MAIN world 의 넓은 화면 답.
    wideAck(attemptId, okFlag, reason) {
      if (!isId(attemptId) || attemptId !== active) return; // 지난 시도
      if (okFlag === false) {
        fail(attemptId, reason || "wide-screen");
        return;
      }
      wide = true;
      wideReady = true;
      maybeReady(attemptId);
    },
  };
}

// ── MAIN world 쪽 규칙(audioMixer.js) ──────────────────────────────────────
function makeWide({ alreadyWide = false, settingsLoaded = true } = {}) {
  const acks = [];
  let polling = false;
  let pendingId = 0;
  return {
    acks,
    get polling() {
      return polling;
    },
    request(attemptId) {
      pendingId = attemptId;
      if (alreadyWide) {
        acks.push({ attemptId, ok: true, immediate: true });
        return;
      }
      if (!settingsLoaded) return; // 설정을 기다린다(여기서는 답하지 않는다)
      if (polling) return; // 이미 돌고 있다 — 되돌리지 않는다
      polling = true;
    },
    finishPolling(okFlag = true) {
      if (!polling) return;
      polling = false;
      acks.push({ attemptId: pendingId, ok: okFlag });
    },
  };
}

// ── 부모 쪽 규칙(multiviewWatch.js) ────────────────────────────────────────
function makeParent() {
  const attempts = new Map();
  const status = new Map();
  return {
    status,
    next(channelId) {
      const n = (attempts.get(channelId) || 0) + 1;
      attempts.set(channelId, n);
      status.set(channelId, "initializing-ui");
      return n;
    },
    current: (channelId) => attempts.get(channelId) || 0,
    invalidate(channelId) {
      attempts.set(channelId, (attempts.get(channelId) || 0) + 1);
    },
    onSignal(channelId, type, attemptId) {
      if (status.get(channelId) === "ended") return; // 종료가 최우선
      if (!Number.isSafeInteger(attemptId) || attemptId <= 0) return;
      if ((attempts.get(channelId) || 0) !== attemptId) return; // 지난 시도
      status.set(channelId, type === "FRAME_UI_READY" ? "ready" : "ui-error");
    },
    onTimeout(channelId, attemptId) {
      if ((attempts.get(channelId) || 0) !== attemptId) return;
      if (status.get(channelId) !== "initializing-ui") return;
      status.set(channelId, "ui-error");
    },
    onEnded(channelId) {
      this.invalidate(channelId);
      status.set(channelId, "ended");
    },
  };
}

console.log("[1] 정상 — 한 번에 끝난다");
{
  const f = makeFrame();
  f.apply(1);
  f.chatSettled(1, true);
  f.wideAck(1, true);
  ok(
    f.sent.length === 1 && f.sent[0].type === "FRAME_UI_READY",
    "한 번의 시도로 완료 신호 1건",
  );
}

console.log("\n[2] 넓은 화면이 먼저 끝나도 된다");
{
  const f = makeFrame();
  f.apply(1);
  f.wideAck(1, true);
  ok(f.sent.length === 0, "아직 채팅이 남아 완료하지 않는다");
  f.chatSettled(1, true);
  ok(
    f.sent.length === 1 && f.sent[0].type === "FRAME_UI_READY",
    "둘 다 끝나면 완료",
  );
}

console.log("\n[3] 채팅이 먼저 끝나도 된다");
{
  const f = makeFrame();
  f.apply(1);
  f.chatSettled(1, true);
  ok(f.sent.length === 0, "아직 넓은 화면이 남아 완료하지 않는다");
  f.wideAck(1, true);
  ok(f.sent.length === 1, "둘 다 끝나면 완료");
}

console.log("\n[4] 넓은 화면만 실패 → 재적용 때 채팅을 다시 기다리지 않는다");
{
  const f = makeFrame();
  f.apply(1);
  f.chatSettled(1, true); // 채팅 성공
  f.wideAck(1, false, "viewmode-timeout"); // 넓은 화면 실패
  ok(f.sent[0]?.type === "FRAME_UI_FAILED", "1차는 실패로 끝난다");
  // 재적용: 채팅은 이미 접혀 있으므로 즉시 완료여야 한다.
  f.apply(2);
  ok(f.state.chatReady === true, "재적용 때 채팅이 즉시 완료로 잡힌다");
  f.wideAck(2, true);
  ok(
    f.sent.some((m) => m.type === "FRAME_UI_READY" && m.attemptId === 2),
    "넓은 화면만 다시 해서 완료",
  );
}

console.log("\n[5] 채팅만 실패 → 재적용 때 넓은 화면을 다시 기다리지 않는다");
{
  const f = makeFrame();
  const w = makeWide({ alreadyWide: false });
  f.apply(1);
  w.request(1);
  w.finishPolling(true);
  f.wideAck(1, true); // 넓은 화면 성공
  f.chatSettled(1, false); // 채팅 실패
  ok(f.sent[0]?.type === "FRAME_UI_FAILED", "1차는 실패로 끝난다");
  // 재적용: 이미 넓은 화면이므로 MAIN 이 즉시 답해야 한다.
  const w2 = makeWide({ alreadyWide: true });
  f.apply(2);
  w2.request(2);
  ok(
    w2.acks[0]?.immediate === true,
    "이미 넓으면 즉시 답한다(기다리지 않는다)",
  );
  f.wideAck(2, true);
  f.chatSettled(2, true);
  ok(
    f.sent.some((m) => m.type === "FRAME_UI_READY" && m.attemptId === 2),
    "채팅만 다시 해서 완료",
  );
}

console.log("\n[6] 지난 시도의 넓은 화면 답은 버린다");
{
  const f = makeFrame();
  f.apply(1);
  f.apply(2); // 새 시도 시작
  f.wideAck(1, true); // 1차의 늦은 답
  ok(f.state.wideReady === false, "1차 답으로 2차를 완료 처리하지 않는다");
  f.wideAck(2, true);
  ok(f.state.wideReady === true, "2차 답은 받는다");
}

console.log("\n[7] 지난 시도의 채팅 결과는 버린다");
{
  const f = makeFrame();
  f.apply(1);
  f.apply(2);
  f.chatSettled(1, true); // 1차의 늦은 결과
  ok(f.state.chatReady === false, "1차 결과로 2차를 완료 처리하지 않는다");
}

console.log("\n[8] 지난 시도의 시간 초과가 최신 성공을 덮지 않는다");
{
  const p = makeParent();
  const id1 = p.next("A");
  const id2 = p.next("A"); // 재적용
  p.onSignal("A", "FRAME_UI_READY", id2);
  ok(p.status.get("A") === "ready", "2차가 완료됐다");
  p.onTimeout("A", id1); // 1차 타이머가 뒤늦게 터진다
  ok(p.status.get("A") === "ready", "1차 타이머가 완료를 덮지 않는다");
}

console.log("\n[9] 방송 종료가 늦은 완료보다 우선한다");
{
  const p = makeParent();
  const id = p.next("A");
  p.onEnded("A");
  p.onSignal("A", "FRAME_UI_READY", id);
  ok(p.status.get("A") === "ended", "늦은 완료가 종료를 덮지 않는다");
}

console.log("\n[10] 이미 다 정상인 상태에서 재적용하면 바로 끝난다");
{
  const f = makeFrame({ foldedAtStart: true, wideAtStart: true });
  const w = makeWide({ alreadyWide: true });
  f.apply(1);
  w.request(1);
  ok(f.state.chatReady === true, "채팅이 즉시 완료");
  ok(w.acks[0]?.immediate === true, "넓은 화면도 즉시 답");
  f.wideAck(1, true);
  ok(
    f.sent.length === 1 && f.sent[0].type === "FRAME_UI_READY",
    "기다림 없이 바로 완료",
  );
}

console.log("\n[추가] 돌고 있는 넓은 화면 감시를 되돌리지 않는다");
{
  const w = makeWide({ alreadyWide: false });
  w.request(1);
  ok(w.polling === true, "감시가 시작된다");
  w.request(2); // 재적용
  ok(w.polling === true, "이미 돌고 있으면 그대로 둔다");
  w.finishPolling(true);
  ok(w.acks[0]?.attemptId === 2, "끝나면 최신 시도 번호로 답한다");
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
