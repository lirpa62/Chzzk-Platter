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
  const LOG_KEY = "cheeseLogPowerLog";
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
  async function loadAwaiting() {
    try {
      const v = (await chrome.storage.local.get(AWAITING_KEY))?.[AWAITING_KEY];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  async function saveAwaiting(list) {
    try {
      await chrome.storage.local.set({ [AWAITING_KEY]: list });
    } catch {}
  }

  // ── 내역 기록 ──────────────────────────────────────────────────────────────
  // ⚠ content.js 와 같은 키를 쓰므로 항상 '읽고 → 고치고 → 쓴다'. 화면이 들고
  //   있던 배열을 덮으면 그 사이 들어온 적립이 사라진다.
  // 같은 예측의 베팅은 한 줄로 누적한다.
  // ⚠ 예전엔 회차마다 별도 항목이었다. 그러면 예측에 실패했을 때 정산이
  //   PREDICTION_BET- 접두사를 전부 변환해 '예측 실패'가 3줄씩 남고, 같은 예측
  //   상세(선택지 막대)도 그만큼 반복됐다(제보).
  //   나눠 건 이력은 betHistory 에 남겨 상세에서 보여 준다.
  async function upsertBetLog(entry, added) {
    if (!entry?.id) return;
    try {
      const data = await chrome.storage.local.get(LOG_KEY);
      const list = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];
      const hit = list.find((it) => it?.id === entry.id);
      if (hit) {
        hit.amount = num(hit.amount) - added; // 차감이라 음수로 쌓인다
        hit.at = entry.at;
        hit.betHistory = [
          ...(Array.isArray(hit.betHistory) ? hit.betHistory : []),
          { at: entry.at, amount: added },
        ];
      } else {
        list.unshift({
          ...entry,
          betHistory: [{ at: entry.at, amount: added }],
        });
      }
      list.sort((a, b) => num(b?.at) - num(a?.at));
      await chrome.storage.local.set({ [LOG_KEY]: list });
    } catch {}
  }

  async function appendLog(entry) {
    if (!entry?.id || !entry.amount) return;
    try {
      const data = await chrome.storage.local.get(LOG_KEY);
      const list = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];
      if (list.some((it) => it?.id === entry.id)) return; // 멱등
      list.unshift(entry);
      list.sort((a, b) => num(b?.at) - num(a?.at));
      await chrome.storage.local.set({ [LOG_KEY]: list });
    } catch {}
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
    const awaiting = await loadAwaiting();
    const known = awaiting.find((p) => p.predictionId === predictionId);

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
        await saveAwaiting(awaiting);
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
    const p = known || { predictionId, channelId, ...meta, betAt: at };
    p.title = String(c?.predictionTitle || p.title || "");
    p.selectedOptionNo = num(part.selectedOptionNo);
    p.stake = total; // 정산은 총액 기준으로 판단한다
    p.recorded = total;
    if (!known) awaiting.push(p);
    await saveAwaiting(awaiting);

    // 건 금액은 즉시 차감되므로 바로 음수로 남긴다.
    // ⚠ id 에 총액을 넣지 않는다 — 예측당 한 줄로 누적해야 하므로 고정이어야 한다.
    await upsertBetLog(
      {
        ...logEntry(p, "PREDICTION_BET", -added, at),
        id: `PREDICTION_BET-${predictionId}`,
      },
      added,
    );
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
      const gap = nowTotal - num(p.recorded);
      await upsertBetLog(
        {
          ...logEntry(p, "PREDICTION_BET", -gap, Date.now()),
          id: `PREDICTION_BET-${p.predictionId}`,
        },
        gap,
      );
      p.recorded = nowTotal;
      p.stake = nowTotal;
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
      await appendLog(
        logEntry(p, "PREDICTION_REFUND", num(p.stake), Date.now()),
      );
      return "done";
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
      await markPredictionResult(p, "PREDICTION_LOST", meta);
      return "done";
    }

    // ⚠ 베팅 줄에도 상세는 남기되 '정답'은 넣지 않는다(winningOptionNo 생략).
    //   베팅 시점에는 결과를 몰랐으니, 그 줄에서 정답이 보이면 어색하다.
    //   승패 표시는 아래 PREDICTION_WIN 줄이 담당한다.
    await markPredictionResult(p, "PREDICTION_BET", {
      ...meta,
      winningOptionNo: 0,
    });
    // 이겼는데 winningPowers 가 0/누락으로 오는 경우가 있다(정산 직후 등).
    // 그때는 '건 금액 × 내 선택지 배분율'로 메운다 — 적중 기록이 통째로
    // 빠지는 것보다 낫다. 둘 다 없으면 기록하지 않는다.
    let payout = num(part.winningPowers);
    if (payout <= 0) {
      const mine = stats.find((o) => o.optionNo === selected);
      if (mine?.rate > 0) payout = Math.round(num(p.stake) * mine.rate);
    }
    if (payout > 0) {
      await appendLog({
        ...logEntry(p, "PREDICTION_WIN", payout, Date.now()),
        ...meta,
      });
    }
    return "done";
  }

  // 이 예측으로 남긴 BET 항목들의 종류를 바꾸고 통계를 붙인다.
  // (여러 번 베팅했으면 항목도 여러 개 — 전부 같은 결과를 갖는다.)
  async function markPredictionResult(p, claimType, meta) {
    try {
      const data = await chrome.storage.local.get(LOG_KEY);
      const list = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];
      const prefix = `PREDICTION_BET-${p.predictionId}`;
      // ⚠ startsWith 만 쓰면 predictionId 가 다른 id 의 접두사일 때 남의 기록까지
      //   변환한다(p1 이 p12 에 걸린다). 정확히 같거나 구형식(-총액) 만 인정한다.
      const isMine = (id) => {
        const v = String(id || "");
        return v === prefix || /^-\d+$/.test(v.slice(prefix.length));
      };
      let changed = false;
      // ⚠ 예전 버전은 패배 시 LOST 항목을 '새로 추가'해, 같은 예측에 BET 과 LOST
      //   가 함께 남은 기록이 있다(합계가 두 배로 잡힌다). 변환하기 전에 그런
      //   짝을 정리한다 — 결과 줄만 남기고 옛 BET 줄을 걷어낸다.
      if (claimType === "PREDICTION_LOST") {
        const legacy = list.findIndex(
          (it) => it?.claimType === "PREDICTION_LOST" && isMine(it?.id),
        );
        if (legacy >= 0) {
          const before = list.length;
          for (let i = list.length - 1; i >= 0; i -= 1) {
            const it = list[i];
            if (it?.claimType === "PREDICTION_BET" && isMine(it?.id)) {
              list.splice(i, 1);
            }
          }
          if (list.length !== before) {
            await chrome.storage.local.set({ [LOG_KEY]: list });
          }
          return; // 결과 줄이 이미 있으므로 변환할 것이 없다
        }
      }

      for (const it of list) {
        if (!isMine(it?.id)) continue;
        if (it.claimType !== claimType) {
          it.claimType = claimType;
          changed = true;
        }
        // ⚠ EXPIRED 때 정답 없이(winningOptionNo:0) 먼저 넣어 둔다. 정산 때는
        //   그 값을 덮어써야 정답이 반영된다 — 예전처럼 '없을 때만' 채우면
        //   마감 시 저장된 스냅샷이 그대로 남아 정답이 영영 표시되지 않는다.
        if (!it.optionStats || num(meta?.winningOptionNo) > 0) {
          Object.assign(it, meta);
          changed = true;
        }
      }
      if (changed) await chrome.storage.local.set({ [LOG_KEY]: list });
    } catch {}
  }

  async function pollAwaiting() {
    const awaiting = await loadAwaiting();
    if (!awaiting.length) {
      stopPolling();
      return;
    }
    const keep = [];
    for (const p of awaiting) {
      const r = await resolveOne(p);
      if (r === "keep") keep.push(p);
    }
    if (keep.length !== awaiting.length) await saveAwaiting(keep);
    if (!keep.length) stopPolling();
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
