// 전용 팔로잉 목록 '내 활동순' 점수.
// 통나무파워·후원 횟수·내 채팅 수·구독 개월 네 지표를 등수로 환산해 합산한다.
//
// ⚠ 값 비율이 아니라 '등수'로 점수를 준다. 통나무파워는 채널 간 500배까지 벌어져
//   비율로 환산하면 1등만 10점이고 나머지는 0.2 이하로 뭉개진다(실측 모델).
//   등수 기반이면 2~10등도 9~1점으로 살아나 가중치 조절이 예측 가능해진다.
(() => {
  "use strict";

  const METRICS = Object.freeze([
    ["logPower", "통나무파워"],
    ["donation", "후원 횟수"],
    ["chat", "내 채팅"],
    ["subscribe", "구독 개월"],
  ]);

  // 등수 점수 상한. 1등 10점 → 10등 1점, 그 아래는 1점.
  const TOP_SCORE = 10;

  // 후원 횟수는 최근 N개월만 센다. 전체 이력은 월 단위 API 라 가입 개월 수만큼
  //   요청이 필요해(3년이면 36회+) 목록을 그릴 때마다 돌릴 수 없다.
  const DONATION_MONTHS = 3;

  // 값 → 등수 점수. 같은 값은 같은 점수(공동 등수), 0 이하는 0점.
  // ⚠ 0 점과 1 점을 구분해야 한다. '기록이 없는 채널'과 '꼴찌지만 기록이 있는
  //   채널'은 다르다 — 전자는 순위에 끼지 않아야 한다.
  function rankScores(values) {
    const unique = [...new Set(values.filter((v) => v > 0))].sort(
      (a, b) => b - a,
    );
    const byValue = new Map();
    unique.forEach((v, i) => byValue.set(v, Math.max(1, TOP_SCORE - i)));
    return values.map((v) => (v > 0 ? byValue.get(v) || 1 : 0));
  }

  // 사용자가 매긴 순서(1위가 가장 중요) → 가중치. 4개면 4·3·2·1.
  // ⚠ 순서에 없는 지표는 0 을 준다(그 지표를 빼고 싶을 때 쓴다).
  function weightsFromOrder(order, keys) {
    const list = Array.isArray(order) ? order : [];
    const out = {};
    for (const key of keys) {
      const i = list.indexOf(key);
      out[key] = i >= 0 ? list.length - i : 0;
    }
    return out;
  }

  // 채널별 지표 → 최종 점수·세부 내역.
  // metrics: { channelId: { logPower, donation, chat, subscribe } }
  // options.order: 가중치 순서(배열), options.skip: 제외할 지표 키 배열
  function scoreChannels(metrics, options = {}) {
    const skip = new Set(options.skip || []);
    const keys = METRICS.map(([k]) => k).filter((k) => !skip.has(k));
    const ids = Object.keys(metrics || {});
    if (!ids.length || !keys.length) return [];

    const weights = weightsFromOrder(options.order, keys);
    // 지표마다 등수 점수를 따로 낸다.
    const scoreByKey = {};
    for (const key of keys) {
      const values = ids.map((id) => Number(metrics[id]?.[key]) || 0);
      const scores = rankScores(values);
      scoreByKey[key] = new Map(ids.map((id, i) => [id, scores[i]]));
    }

    return (
      ids
        .map((channelId) => {
          const parts = {};
          let total = 0;
          for (const key of keys) {
            const score = scoreByKey[key].get(channelId) || 0;
            const weighted = score * (weights[key] || 0);
            parts[key] = { score, weight: weights[key] || 0, weighted };
            total += weighted;
          }
          return { channelId, total, parts };
        })
        // 점수가 0 인 채널은 '내 활동 기록이 전혀 없는' 채널이라 제외한다.
        .filter((row) => row.total > 0)
        .sort((a, b) => b.total - a.total)
    );
  }

  // 방송 중 top 5 / 나머지(전체 top 10 에서 위 5개를 뺀 것).
  // ⚠ 'all' 을 그냥 상위 10개로 자르면 방송 중 목록에 이미 나온 채널이 다시 들어가
  //   같은 채널이 화면에 두 번 보인다(제보). 위에서 보여 준 건 빼고 채운다.
  //   ⚠ allMax 는 '두 목록을 합친 개수'다. 5개를 보여 줬으면 나머지는 5개까지.
  function pickTop(scored, isLive, { liveMax = 5, allMax = 10 } = {}) {
    const live = [];
    for (const row of scored) {
      if (live.length >= liveMax) break;
      if (isLive(row.channelId)) live.push(row);
    }
    const shown = new Set(live.map((row) => row.channelId));
    const rest = [];
    for (const row of scored) {
      if (live.length + rest.length >= allMax) break;
      if (shown.has(row.channelId)) continue;
      rest.push(row);
    }
    return { live, rest, all: [...live, ...rest] };
  }

  globalThis.CheeseChannelAffinity = Object.freeze({
    METRICS,
    TOP_SCORE,
    DONATION_MONTHS,
    rankScores,
    weightsFromOrder,
    scoreChannels,
    pickTop,
  });
})();
