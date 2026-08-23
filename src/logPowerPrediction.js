// 통나무파워 승부예측 추적(ISOLATED world).
//
// 베팅과 정산을 각각 한 건씩 내역에 남긴다.
//   PREDICTION_BET  : 건 금액(음수)
//   PREDICTION_WIN  : 받은 금액(양수, 이겼을 때만)
// 순손익 = 두 건의 합. 진 경우엔 BET 만 남아 그대로 손실이 된다.
//
// ⚠ 역산이 필요 없다. 치지직이 참여 상세에 실제 금액을 담아 준다.
//     participation.bettingPowers  = 건 금액
//     participation.winningPowers  = 받은 금액
//
// ⚠ 감지는 fetch/XHR 을 덮어쓰지 않고 PerformanceObserver 로 한다. 페이지가
//   보낸 요청의 URL 만 관찰하면 되므로, 다른 확장이 이미 감싼 fetch 와 충돌하지
//   않고 격리 월드에서도 그대로 동작한다.
(function trackLogPowerPrediction() {
  const API = "https://api.chzzk.naver.com/service/v1/channels";
  const AWAITING_KEY = "cheeseLogPowerPredictionAwaiting";
  // 정산은 스트리머가 결과를 확정해야 끝난다. 몇 분~몇십 분까지 걸린다.
  const POLL_MS = 60000;
  // ⚠ 스트리머가 결과를 확정해야 정산이 끝난다. 방송이 끝나고 다음 날 확정하는
  //   경우도 있어 12시간으로는 짧다 — 포기하면 베팅만 남고 결과가 영영 안 붙는다.
  const AWAITING_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3일

  let pollTimer = 0;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  async function api(path) {
    try {
      const res = await fetch(`${API}${path}`, { credentials: "include" });
      if (!res.ok) return null;
      const json = await res.json();
      return Number(json?.code) === 200 ? json.content : null;
    } catch {
      return null;
    }
  }

  const detail = (channelId, predictionId) =>
    api(
      `/${channelId}/log-power/predictions/${predictionId}?fields=participation`,
    );

  // ── 대기 목록 ──────────────────────────────────────────────────────────────
  // 방송을 떠난 뒤 정산되는 경우가 흔하다 → 베팅을 저장해 두고 계속 확인한다.
  // ⚠ 전체 목록을 그대로 돌려준다(저장할 때 다른 계정 것을 지우면 안 된다).
  //   찾을 때는 반드시 mineOf 로 현재 계정 것만 고른다.
  // ⚠ 대기 항목 저장이 실패하면 그 항목은 저장소에도, 폴링이 읽는 목록에도 없다.
  //   폴링은 빈 목록을 보고 멈춰 베팅·정산 추적이 영구 누락된다.
  //   저장될 때까지 메모리에 들고 있다가 폴링 때마다 다시 시도한다.
  //   (탭이 닫히면 사라지지만, 그 경우 재진입 시 API 로 다시 감지된다.)
  const awaitingRetry = new Map(); // accountId:predictionId -> entry

  async function loadAwaiting() {
    try {
      const v = (await chrome.storage.local.get(AWAITING_KEY))?.[AWAITING_KEY];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  // 현재 계정의 대기 건인지. accountId 가 없는 항목은 계정 도입 전 기록이라
  // 현재 계정 것으로 본다(그때는 계정이 하나뿐이었다).
  function ownedBy(p, accountId) {
    const owner = String(p?.accountId || "");
    return owner === accountId || owner === "";
  }

  // 같은 예측에 여러 계정이 참여할 수 있다. predictionId만 쓰면 먼저 저장된
  // 계정의 항목이 현재 계정 항목을 중복으로 제거한다. 레거시는 현재 계정 것으로
  // 취급해 계정 도입 전 대기 건도 한 번만 처리한다.
  function awaitingKey(p, fallbackAccountId = "") {
    const predictionId = String(p?.predictionId || "");
    const owner = String(p?.accountId || fallbackAccountId || "");
    return `${owner}:${predictionId}`;
  }

  // ⚠ 대기 목록도 background 가 단일 작성자다. 탭마다 전체를 덮어쓰면
  //   두 탭이 동시에 베팅·정산할 때 한쪽 항목이 유실된다.
  function upsertAwaiting(entry) {
    return sendAwaiting("UPSERT", { entry });
  }

  function removeAwaiting(predictionId) {
    return sendAwaiting("REMOVE", { predictionId });
  }

  async function sendAwaiting(op, payload) {
    for (let i = 0; i <= WRITE_RETRY_MS.length; i += 1) {
      try {
        const res = await chrome.runtime?.sendMessage?.({
          type: "LP_AWAITING",
          op,
          accountHint: accountHint(),
          payload,
        });
        if (res?.ok) return res;
      } catch {}
      const wait = WRITE_RETRY_MS[i];
      if (wait == null) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    return { ok: false };
  }

  // ── 내역 기록 ──────────────────────────────────────────────────────────────
  // ⚠ content.js 와 같은 키를 쓰므로 항상 '읽고 → 고치고 → 쓴다'. 화면이 들고
  //   있던 배열을 덮으면 그 사이 들어온 적립이 사라진다.
  // 같은 예측의 베팅은 한 줄로 누적한다.
  // ⚠ 예전엔 회차마다 별도 항목이었다. 그러면 예측에 실패했을 때 정산이
  //   PREDICTION_BET- 접두사를 전부 변환해 '예측 실패'가 3줄씩 남고, 같은 예측
  //   상세(선택지 막대)도 그만큼 반복됐다(제보).
  //   나눠 건 이력은 betHistory 에 남겨 상세에서 보여 준다.
  // 내역 변경은 background 가 단일 작성자다(동시 쓰기로 서로 덮어쓰는 것 방지).
  // ⚠ 계정 힌트를 함께 보낸다. 치지직 페이지라 localStorage 에서 읽을 수 있고,
  //   계정 확인 API 가 실패해도 기록이 엉뚱한 계정으로 새지 않는다.
  const WRITE_RETRY_MS = [400, 1500];

  function accountHint() {
    try {
      const v = String(localStorage.getItem("userStatus.idhash") || "")
        .trim()
        .toLowerCase();
      return /^[0-9a-f]{32}$/.test(v) ? v : "";
    } catch {
      return "";
    }
  }

  async function sendWrite(op, payload) {
    for (let i = 0; i <= WRITE_RETRY_MS.length; i += 1) {
      try {
        const res = await chrome.runtime?.sendMessage?.({
          type: "LP_WRITE",
          op,
          accountHint: accountHint(),
          payload,
        });
        if (res?.ok) return res;
      } catch {}
      const wait = WRITE_RETRY_MS[i];
      if (wait == null) break;
      await new Promise((r) => setTimeout(r, wait));
    }
    return { ok: false };
  }

  // 베팅은 증분이 아니라 [누적 총액]을 보낸다. 재시도해도 두 번 차감되지 않는다.
  function upsertBetLog(p, totalBetAmount, observedAt) {
    return sendWrite("UPSERT_PREDICTION_BET", {
      predictionId: p.predictionId,
      totalBetAmount,
      observedAt,
      meta: {
        channelId: p.channelId,
        channelName: p.channelName || "채널",
        channelImageUrl: p.channelImageUrl || "",
        verifiedMark: p.verifiedMark === true,
        claimType: "PREDICTION_BET",
      },
    });
  }

  function appendLog(entry) {
    return sendWrite("APPEND_PREDICTION_RESULT", { entry });
  }

  function logEntry(p, kind, amount, at) {
    return {
      // predictionId 가 고유하므로 그대로 중복 방지에 쓴다.
      id: `${kind}-${p.predictionId}`,
      at,
      channelId: p.channelId,
      channelName: p.channelName || "채널",
      channelImageUrl: p.channelImageUrl || "",
      verifiedMark: p.verifiedMark === true,
      amount,
      fiveMinAmount: 0,
      // 부스팅은 시청 보상 전용 — 예측에는 붙지 않는다.
      boost: 1,
      claimType: kind,
      predictionTitle: p.title || "",
    };
  }

  async function channelMeta(channelId) {
    const c = await api(`/${channelId}`);
    return {
      channelName: String(c?.channelName || "").slice(0, 100),
      channelImageUrl: String(c?.channelImageUrl || ""),
      verifiedMark: c?.verifiedMark === true,
    };
  }

  // ── 베팅 감지 ──────────────────────────────────────────────────────────────
  // ⚠ participation.bettingPowers 는 그 예측에 건 '총합' 이다(실측: 10 을 걸고
  //   더 얹으면 80 으로 바뀐다). 같은 예측에 여러 번 걸 수 있으므로
  //     · 대기 목록에 있다고 그냥 돌아가면 추가 베팅을 놓치고
  //     · 기록 id 를 예측당 하나로 두면 두 번째가 중복으로 걸러진다
  //   → 이미 기록한 금액(recorded)을 들고 있다가 '늘어난 만큼'만 남긴다.
  async function recordBet(channelId, predictionId) {
    const acc = accountHint();
    const awaiting = await loadAwaiting();
    // ⚠ predictionId 만으로 찾으면 다른 계정의 대기 건을 집는다.
    const known = awaiting.find(
      (p) => p.predictionId === predictionId && ownedBy(p, acc),
    );

    const c = await detail(channelId, predictionId);
    const part = c?.participation;
    const total = num(part?.bettingPowers);
    if (!part || total <= 0) return; // 참여하지 않았다(단순 조회)

    const recorded = num(known?.recorded);
    const added = total - recorded;
    if (added <= 0) {
      // 늘어난 게 없다(같은 응답을 두 번 봤다) → 총액만 맞춰 두고 끝낸다.
      if (known && known.stake !== total) {
        known.stake = total;
        await upsertAwaiting(known);
      }
      return;
    }

    const meta = known?.channelName
      ? {
          channelName: known.channelName,
          channelImageUrl: known.channelImageUrl,
          verifiedMark: known.verifiedMark,
        }
      : await channelMeta(channelId);

    const at = Date.now();
    const p = known || {
      predictionId,
      channelId,
      ...meta,
      betAt: at,
      accountId: acc, // 이 베팅의 소유 계정
    };
    if (!p.accountId && acc) p.accountId = acc;
    p.title = String(c?.predictionTitle || p.title || "");
    p.selectedOptionNo = num(part.selectedOptionNo);
    p.stake = total; // 정산은 총액 기준으로 판단한다
    // ⚠ recorded 를 먼저 올리면 안 된다. 저장이 실패했는데 '이미 기록함'이 되어
    //   다음 확인에서 added=0 이 되고 베팅이 영구 누락된다.
    //   pending 으로만 표시해 두고, 저장 성공 뒤에 확정한다.
    p.pendingTotal = total;
    p.pendingAt = at;
    // ⚠ 대기 항목 저장이 실패하면 정산 추적이 사라진다(베팅 줄만 남고 결과가
    //   영영 안 붙는다). 저장에 실패했으면 이번 베팅 기록도 미룬다 — 다음
    //   확인 주기에 같은 총액으로 다시 시도한다(멱등).
    const saved = await upsertAwaiting(p);
    if (saved?.ok === false) {
      // 저장될 때까지 메모리에 보존한다 — 폴링이 이 목록도 함께 훑는다.
      awaitingRetry.set(awaitingKey(p, acc), p);
      startPolling();
      return;
    }
    awaitingRetry.delete(awaitingKey(p, acc));

    // 건 금액은 즉시 차감되므로 바로 음수로 남긴다. 누적 총액을 보내 멱등하게.
    const ok = await upsertBetLog(p, total, at);
    if (ok?.ok) {
      p.recorded = total;
      delete p.pendingTotal;
      delete p.pendingAt;
      await upsertAwaiting(p);
    }
    startPolling();
  }

  // ── 정산 확인 ──────────────────────────────────────────────────────────────
  // 선택지 통계(참여자·총 파워·비율·배분율).
  function optionStatsOf(c) {
    return (Array.isArray(c?.optionList) ? c.optionList : []).map((o) => ({
      optionNo: num(o?.optionNo),
      text: String(o?.optionText ?? ""),
      participants: num(o?.participantCount),
      powers: num(o?.totalLogPowers),
      percentage: num(o?.percentage),
      rate: Number(o?.distributionRate) || 0,
    }));
  }

  async function resolveOne(p) {
    const c = await detail(p.channelId, p.predictionId);
    if (!c) return Date.now() - p.betAt > AWAITING_TTL_MS ? "drop" : "keep";

    // ⚠ 마지막 베팅을 놓쳤을 수 있다(요청 관찰이 한 번이라도 빠지면). 정산 전에
    //   총액을 맞춰 둔다 — 취소 환급·손익 계산이 실제와 어긋나지 않게.
    const nowTotal = num(c.participation?.bettingPowers);
    if (nowTotal > num(p.recorded)) {
      // 여기도 저장 성공 뒤에 recorded 를 확정한다(위 recordBet 과 같은 이유).
      const ok = await upsertBetLog(p, nowTotal, Date.now());
      // 총액 차감이 기록되지 않았는데 취소·정산 처리를 계속하면 환급/적중만
      // 남기고 대기 항목을 지울 수 있다. 베팅 기록부터 확정한 뒤 진행한다.
      if (!ok?.ok) return "keep";
      p.recorded = nowTotal;
      p.stake = nowTotal;
      delete p.pendingTotal;
      delete p.pendingAt;
      // ⚠ 대기 목록에 다시 저장하지 않으면 같은 보정을 1분마다 반복하고,
      //   재시작하면 옛 상태로 돌아간다. 이 저장도 확인돼야 최종 상태로 넘어간다.
      const saved = await upsertAwaiting(p);
      if (!saved?.ok) return "keep";
    }

    const status = String(c.status || "").toUpperCase();
    // ⚠ EXPIRED = 베팅 마감. 추가 베팅이 막혀 비율·배분율이 더 변하지 않으므로
    //   이 시점 통계를 저장해 둔다. 예전엔 COMPLETED 만 기록해서, 마감 후 정산
    //   전까지 상세가 통째로 비어 보였다(제보).
    //   정답(winningOptionNo)은 아직 모르니 0 으로 두고, 정산 때 갱신한다.
    if (status === "EXPIRED") {
      await markPredictionResult(p, "PREDICTION_BET", {
        predictionTitle: p.title || "",
        selectedOptionNo: num(
          c.participation?.selectedOptionNo ?? p.selectedOptionNo,
        ),
        winningOptionNo: 0,
        optionStats: optionStatsOf(c),
      });
      return Date.now() - p.betAt > AWAITING_TTL_MS ? "drop" : "keep";
    }
    // 취소되면 건 금액을 되돌려 받는다 → 차감분을 복구하는 기록을 남긴다.
    if (["CANCELLED", "CANCELED", "VOIDED"].includes(status)) {
      // ⚠ 저장에 실패했는데 done 을 돌려주면 대기 목록에서 빠져 재시도할 수
      //   없다. 성공했을 때만 확정한다.
      const ok = await appendLog(
        logEntry(p, "PREDICTION_REFUND", num(p.stake), Date.now()),
      );
      return ok?.ok ? "done" : "keep";
    }
    if (status !== "COMPLETED") {
      return Date.now() - p.betAt > AWAITING_TTL_MS ? "drop" : "keep";
    }

    const part = c.participation || {};
    const selected = num(part.selectedOptionNo ?? p.selectedOptionNo);
    const winning = num(c.winningOptionNo);
    const won =
      selected === winning || String(part.status || "").toUpperCase() === "WON";
    // 마감 시점의 선택지 통계. 결과를 되짚을 때 쓴다.
    const stats = optionStatsOf(c);
    const meta = {
      predictionTitle: p.title || "",
      selectedOptionNo: selected,
      winningOptionNo: winning,
      optionStats: stats,
    };

    // ⚠ 진 경우에도 결과를 남겨야 한다. 예전엔 아무것도 안 해서 베팅만 있고
    //   결과가 없는 것처럼 보였다(제보) → 이미 남긴 BET 항목의 종류를 바꿔
    //   '실패'로 표시한다. 금액(음수)은 그대로라 합계가 흔들리지 않는다.
    if (!won) {
      // matched=false = 대상 베팅이 없다(보류 큐에 있을 수 있다) → 다시 시도.
      const ok = await markPredictionResult(p, "PREDICTION_LOST", meta);
      return ok?.ok && ok?.matched !== false ? "done" : "keep";
    }

    // ⚠ 베팅 줄에도 상세는 남기되 '정답'은 넣지 않는다(winningOptionNo 생략).
    //   베팅 시점에는 결과를 몰랐으니, 그 줄에서 정답이 보이면 어색하다.
    //   승패 표시는 아래 PREDICTION_WIN 줄이 담당한다.
    // ⚠ 이것도 실패하면 상세가 안 붙는다 → 다음 확인에서 다시 시도한다.
    const marked = await markPredictionResult(p, "PREDICTION_BET", {
      ...meta,
      winningOptionNo: 0,
    });
    if (!marked?.ok || marked?.matched === false) return "keep";
    // 이겼는데 winningPowers 가 0/누락으로 오는 경우가 있다(정산 직후 등).
    // 그때는 '건 금액 × 내 선택지 배분율'로 메운다 — 적중 기록이 통째로
    // 빠지는 것보다 낫다. 둘 다 없으면 기록하지 않는다.
    let payout = num(part.winningPowers);
    if (payout <= 0) {
      const mine = stats.find((o) => o.optionNo === selected);
      if (mine?.rate > 0) payout = Math.round(num(p.stake) * mine.rate);
    }
    if (payout > 0) {
      const ok = await appendLog({
        ...logEntry(p, "PREDICTION_WIN", payout, Date.now()),
        ...meta,
      });
      if (!ok?.ok) return "keep"; // 실패 → 다음 확인에서 재시도
    }
    return "done";
  }

  // 이 예측으로 남긴 BET 항목들의 종류를 바꾸고 통계를 붙인다.
  // (여러 번 베팅했으면 항목도 여러 개 — 전부 같은 결과를 갖는다.)
  // 정산 결과를 기존 베팅 줄에 반영한다(레거시 중복 정리 포함).
  function markPredictionResult(p, claimType, meta) {
    return sendWrite("MARK_PREDICTION_RESULT", {
      predictionId: p.predictionId,
      claimType,
      meta,
    });
  }

  async function pollAwaiting() {
    const acc = accountHint();
    const stored = await loadAwaiting();
    // 저장에 실패해 메모리에만 있는 항목을 다시 저장해 본다.
    let retryLeft = 0;
    // ⚠ 이번 주기에 저장이 성공한 항목은 위에서 읽은 stored 에 아직 없다.
    //   큐에서만 빼고 끝내면 목록이 비어 폴링이 멈추고, 정산이 재진입 전까지
    //   시작되지 않는다 → 이번 주기 목록에 함께 넣는다.
    const justSaved = [];
    for (const [id, entry] of [...awaitingRetry]) {
      const res = await upsertAwaiting(entry);
      if (res?.ok === false) {
        retryLeft += 1;
        continue;
      }
      awaitingRetry.delete(id);
      justSaved.push(entry);
    }
    // 저장된 목록 + 이번에 저장된 항목 + 아직 저장 못 한 항목(중복 제거).
    const storedIds = new Set(stored.map((x) => awaitingKey(x, acc)));
    const extra = [...justSaved, ...awaitingRetry.values()].filter(
      (x) => !storedIds.has(awaitingKey(x, acc)),
    );
    const seenIds = new Set();
    const awaiting = [...stored, ...extra].filter((x) => {
      const id = awaitingKey(x, acc);
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
    if (!awaiting.length) {
      stopPolling();
      return;
    }
    let remaining = retryLeft;
    for (const p of awaiting) {
      // ⚠ 다른 계정 대기 건은 건드리지 않는다. 현재 계정 API·로그로 정산하면
      //   남의 예측이 내 내역에 들어간다. 그대로 보존했다가 그 계정으로
      //   돌아왔을 때 처리한다(TTL 이 3일이라 지우면 추적이 사라진다).
      // ⚠ 계정을 아직 모르면(초기 진입 등 localStorage 미준비) 정산은 미루되
      //   폴링은 살려 둔다. 여기서 remaining 을 안 올리면 폴링이 완전히 멈춰
      //   계정을 알게 돼도 다시 돌지 않는다.
      if (!acc) {
        remaining += 1;
        continue;
      }
      if (!ownedBy(p, acc)) continue; // 다른 계정 건은 그대로 둔다
      const r = await resolveOne(p);
      if (r === "keep") {
        remaining += 1;
        continue;
      }
      // ⚠ 목록 전체를 덮지 않고 끝난 항목만 뺀다. 그래야 다른 탭이 그 사이
      //   추가한 베팅이 되살아나거나 사라지지 않는다.
      // ⚠ 삭제가 실패했는데 완료로 치면 대기 항목이 남은 채 폴링만 멈춘다 →
      //   다음 진입까지 정산 줄이 안 붙는다. 실패하면 폴링을 유지해 다시 시도한다.
      //   (정산 기록은 총액·id 기준 멱등이라 재시도해도 중복되지 않는다.
      //    changed:false = 이미 지워진 항목 → 성공으로 본다.)
      const removed = await removeAwaiting(p.predictionId);
      if (removed?.ok === false) remaining += 1;
      else awaitingRetry.delete(awaitingKey(p, acc));
    }
    if (!remaining) stopPolling();
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(() => void pollAwaiting(), POLL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  // ── 요청 관찰 ──────────────────────────────────────────────────────────────
  // 베팅하면 페이지가 participation 을 부른다. 그 URL 을 보고 상세를 확인한다.
  // (응답이 서버에 반영될 시간을 주려고 잠깐 기다린다.)
  const BET_RE =
    /channels\/([0-9a-f]{32})\/log-power\/predictions\/([^/?#]+)\/participation/i;

  function handleUrl(url) {
    const m = BET_RE.exec(String(url || ""));
    if (!m) return;
    window.setTimeout(() => void recordBet(m[1], m[2]), 3000);
  }

  function start() {
    if (!("PerformanceObserver" in window)) return;
    try {
      const po = new PerformanceObserver((list) =>
        list.getEntries().forEach((e) => handleUrl(e.name)),
      );
      po.observe({ type: "resource", buffered: true });
    } catch {}
    // 남아 있는 대기 건이 있으면(이전 세션에서 베팅) 바로 확인을 시작한다.
    void loadAwaiting().then((list) => {
      if (list.length) {
        void pollAwaiting();
        startPolling();
      }
    });
  }

  start();
})();
