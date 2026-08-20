// 치즈 플래터 - 통나무파워 내역 페이지(확장 내부 탭)
// content.js 가 1시간 시청 보상을 획득할 때 남긴 기록(cheeseLogPowerLog)을 집계해 보여 준다.
// 치지직에는 획득 내역 API 가 없어서, 우리가 모은 것이 유일한 원본이다.
(() => {
  "use strict";

  const LOG_KEY = "cheeseLogPowerLog";

  /** 기간 경계는 달력 기준이다(오늘 00:00, 이번 주 월요일, 이번 달 1일). */
  function periodStarts(now = new Date()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const week = new Date(today);
    // getDay(): 0=일요일. 월요일 시작으로 맞추려면 일요일을 6일 전으로 본다.
    week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    return { today: +today, week: +week, month: +month };
  }

  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
  // 부호가 있는 값(예측 베팅/적중). 양수에도 +를 붙여 손익을 한눈에 구분한다.
  const fmtSigned = (n) => (Number(n) > 0 ? `+${fmt(n)}` : fmt(n));
  // 음수로 기록되는 종류(차감). 획득량 칸의 최소값을 풀어 줘야 한다.
  const isLossClaim = (t) =>
    t === "PREDICTION_BET" || t === "PREDICTION_LOST" || t === "OTHER_LOSS";

  const escapeHtml = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  function formatWhen(ms) {
    const d = new Date(Number(ms) || 0);
    if (!+d) return "";
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // 한 건의 실제 획득량 = 1시간 보상 + 같은 시간 동안의 5분 보상 합계.
  const entryTotal = (e) => (e.amount || 0) + (e.fiveMinAmount || 0);

  let entries = [];
  // 세 기준을 함께 켜면 스트리머 > 날짜 > 종류 순서로 묶는다.
  const GROUP_KEY = "cheeseLogPowerStatsGroup";
  const GROUP_ORDER_KEY = "cheeseLogPowerStatsGroupOrder";
  const VIEW_MODE_KEY = "cheeseLogPowerStatsViewMode";
  const EXPLORER_KNOWN_IDS_KEY = "cheeseLogPowerStatsExplorerKnownIds";
  const EXPLORER_UNREAD_IDS_KEY = "cheeseLogPowerStatsExplorerUnreadIds";
  const DEFAULT_GROUP_ORDER = ["streamer", "date", "type"];
  // 막대 차트를 '적립분만'으로 볼지. 보유량이 크면 적립분이 눌려 안 보인다.
  const BAR_ONLY_KEY = "cheeseLogPowerBarEarnedOnly";
  let barEarnedOnly = false;
  let barHasLoss = false; // 설명 문구용(renderBarChart 가 갱신)
  // 날짜별 추이를 '그때까지의 합'으로 볼지. 면적 채우기와 별개 옵션이다.
  const LINE_CUMULATIVE_KEY = "cheeseLogPowerLineCumulative";
  let lineCumulative = false;
  let groupByDate = false;
  let groupByStreamer = false;
  let groupByType = false;
  let groupOrder = DEFAULT_GROUP_ORDER.slice();
  let viewMode = "tree";
  let explorerPath = [];
  const nowForCalendar = new Date();
  let calendarMonth = +new Date(
    nowForCalendar.getFullYear(),
    nowForCalendar.getMonth(),
    1,
  );
  let calendarPopoverTrigger = null;
  // 새 기록의 미확인 상태는 ID로 저장하고, 현재 그룹 순서에 맞는 폴더 경로는
  // 화면에서 다시 만든다. 마지막 폴더를 열면 그 경로의 ID를 읽음 처리한다.
  const explorerUnreadIds = new Set();
  const explorerUnreadByFolderPath = new Map();
  let draggedGroupOrderId = "";
  // 접어 둔 그룹(화면 상태라 저장하지 않는다).
  const collapsed = new Set();
  let sort = "recent";
  let query = "";
  let fromMs = 0; // 0 = 제한 없음
  let toMs = 0;

  const SORT_LABELS = {
    recent: "최근 획득순",
    oldest: "오래된 순",
    "amount-desc": "많은 순",
    "amount-asc": "적은 순",
  };

  // 검색·기간을 적용한 목록. 카드 집계는 '기간 카드' 자체가 기간을 뜻하므로
  // 검색만 반영하고, 목록은 검색+기간을 모두 반영한다.
  function searched() {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => e.channelName.toLowerCase().includes(q));
  }

  function visible() {
    return searched().filter(
      (e) => (!fromMs || e.at >= fromMs) && (!toMs || e.at <= toMs),
    );
  }

  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((it) => ({
        id: String(it?.id || ""),
        at: Number(it?.at) || 0,
        channelId: String(it?.channelId || ""),
        channelName: String(it?.channelName || "").slice(0, 100),
        channelImageUrl: String(it?.channelImageUrl || ""),
        verifiedMark: it?.verifiedMark === true,
        amount: Number(it?.amount) || 0,
        fiveMinAmount: Number(it?.fiveMinAmount) || 0,
        boost: Number(it?.boost) || 1,
        claimType: String(it?.claimType || "WATCH_1_HOUR").toUpperCase(),
        // 5분 묶음의 회차 수(12회면 1시간을 채운 것).
        watchCount: Number(it?.watchCount) || 0,
        // 승부예측 마감 시 저장한 선택지 통계(있을 때만).
        optionStats: Array.isArray(it?.optionStats) ? it.optionStats : null,
        // 나눠 건 이력(누적 한 줄로 합치면서 회차 정보를 여기 남긴다).
        betHistory: Array.isArray(it?.betHistory) ? it.betHistory : null,
        selectedOptionNo: Number(it?.selectedOptionNo) || 0,
        winningOptionNo: Number(it?.winningOptionNo) || 0,
        predictionTitle: String(it?.predictionTitle || ""),
      }))
      .filter((it) => it.id && it.amount !== 0);
  }

  async function load() {
    try {
      const data = await chrome.storage.local.get(LOG_KEY);
      entries = normalize(data?.[LOG_KEY]);
    } catch {
      entries = [];
    }
  }

  // ── 직접 추가/수정/삭제 ────────────────────────────────────────────────────
  // 자동 감지는 서버 반영 지연·한도·결제 취소 등으로 놓칠 수 있다. 손으로 채워
  // 넣을 수 있어야 내역이 실제와 맞는다.
  //
  // ⚠ 저장은 항상 '읽고 → 고치고 → 쓴다'. content.js 가 같은 키에 계속 append
  //   하므로, 화면에 들고 있던 entries 를 그대로 덮으면 그 사이 들어온 적립이
  //   사라진다.
  const MANUAL_PREFIX = "MANUAL-";

  async function mutateLog(fn) {
    const data = await chrome.storage.local.get(LOG_KEY);
    const list = Array.isArray(data?.[LOG_KEY]) ? data[LOG_KEY] : [];
    const next = fn(list.slice());
    if (!next) return false;
    await chrome.storage.local.set({ [LOG_KEY]: next });
    return true;
  }

  // 5분 묶음의 회차 수를 금액에서 역산한다. 5분 보상이 아니거나 단가로 안
  // 나눠떨어지면 0 — 표시하지 않는다.
  function watchCountFor(claimType, amount, boost) {
    if (claimType !== "WATCH_5_MIN") return 0;
    const unit = Math.round((Number(boost) || 1) * 10);
    if (!(unit > 0) || !(amount > 0)) return 0;
    const n = amount / unit;
    return Number.isInteger(n) && n >= 1 ? n : 0;
  }

  function upsertEntry(entry) {
    return mutateLog((list) => {
      const i = list.findIndex((it) => it?.id === entry.id);
      if (i >= 0) list[i] = { ...list[i], ...entry };
      else list.unshift(entry);
      // 저장 순서는 최신순을 유지한다(다른 화면이 그렇게 가정한다).
      list.sort((a, b) => (Number(b?.at) || 0) - (Number(a?.at) || 0));
      return list;
    });
  }

  function deleteEntry(id) {
    return mutateLog((list) => list.filter((it) => it?.id !== id));
  }

  const mmdd = (ms) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}.${d.getDate()}`;
  };

  // ── 카드 상세(채널·종류 비율) ──────────────────────────────────────────────
  // ⚠ 비율은 '적립분(양수)'만으로 낸다. 예측 베팅 같은 음수를 섞으면 합이
  //   100%를 넘고 막대가 뒤집힌다(실측: -54% 같은 값이 나온다).
  //   손실은 비율에서 빼고 아래에 총액만 따로 적는다.
  const BREAKDOWN_TOP = 5; // 이보다 많으면 나머지를 '기타'로 묶는다

  // 종류별 고정색. 채널색(colorFor)과 달리 종류는 목록이 정해져 있으므로
  // 의미가 통하는 색을 박아 둔다 — 시청은 초록, 후원은 치즈색, 예측은 보라 계열.
  // 같은 계열 안에서 월별 보너스·적중은 한 톤 밝게 해 형제 관계가 보이게 한다.
  const TYPE_COLORS = {
    WATCH_1_HOUR: "#168f5c",
    WATCH_5_MIN: "#5cbb8f",
    FOLLOW: "#e0603a",
    DONATE: "#d99a1c",
    DONATE_MONTHLY: "#eec052",
    SUBSCRIPTION_GIFT: "#3596ed",
    SUBSCRIPTION_GIFT_MONTHLY: "#79b9f5",
    PREDICTION_BET: "#8a63d2",
    // 적중은 '벌었다'는 뜻이라 초록 계열로 둔다(베팅 보라와 대비된다).
    PREDICTION_WIN: "#2e9e63",
    // 취소는 '되돌려 받음'이라 적중(초록)과 헷갈리지 않게 청록 계열로 둔다.
    PREDICTION_REFUND: "#2ba3a3",
    PREDICTION_LOST: "#d1495b",
    OTHER_GAIN: "#7a8b99",
    OTHER_LOSS: "#c2497f",
  };

  // 목록에 없는 종류(직접 입력분)는 이름 해시로 팔레트에서 고른다.
  function typeColor(type) {
    return TYPE_COLORS[type] || fallbackColor(String(type || ""));
  }

  function breakdown(list, keyOf, labelOf) {
    const map = new Map();
    for (const e of list) {
      const v = entryTotal(e);
      if (v <= 0) continue; // 손실은 비율 대상이 아니다
      const k = keyOf(e);
      if (!map.has(k)) map.set(k, { key: k, label: labelOf(e, k), sum: 0 });
      map.get(k).sum += v;
    }
    const rows = [...map.values()].sort((a, b) => b.sum - a.sum);
    const total = rows.reduce((n, r) => n + r.sum, 0);
    if (!total) return { rows: [], total: 0 };
    // 채널이 많으면 잘게 쪼개져 읽기 어렵다 → 상위 N + 기타.
    if (rows.length > BREAKDOWN_TOP + 1) {
      const head = rows.slice(0, BREAKDOWN_TOP);
      const rest = rows.slice(BREAKDOWN_TOP);
      head.push({
        label: "기타",
        sum: rest.reduce((n, r) => n + r.sum, 0),
        muted: true,
      });
      return { rows: head, total };
    }
    return { rows, total };
  }

  function barHtml(title, data, colorOf) {
    if (!data.total) return "";
    const seg = data.rows
      .map((r) => {
        const pct = (r.sum / data.total) * 100;
        const color = r.muted ? "var(--popup-muted)" : colorOf(r.key, r.label);
        return (
          `<span style="width:${pct.toFixed(2)}%;background:${color}"` +
          ` title="${escapeHtml(r.label)} ${fmt(r.sum)} (${pct.toFixed(1)}%)"></span>`
        );
      })
      .join("");
    const legend = data.rows
      .map((r) => {
        const pct = (r.sum / data.total) * 100;
        const color = r.muted ? "var(--popup-muted)" : colorOf(r.key, r.label);
        return (
          `<li><i style="background:${color}"></i>` +
          `${escapeHtml(r.label)} <b>${pct.toFixed(0)}%</b></li>`
        );
      })
      .join("");
    return (
      `<div class="lps-bd">` +
      `<span class="lps-bd-title">${escapeHtml(title)}</span>` +
      `<div class="lps-bd-bar">${seg}</div>` +
      `<ul class="lps-bd-legend">${legend}</ul>` +
      `</div>`
    );
  }

  // ── 승부예측 전적 ─────────────────────────────────────────────────────────
  // 한 예측이 남기는 흔적은 결과에 따라 다르다.
  //   성공: BET(-) + WIN(+)   실패: LOST(-)   취소: BET(-) + REFUND(+)
  // id 에 predictionId 가 들어 있어 예측 단위로 묶을 수 있다.
  // 나간 금액이 되돌아오는 종류(취소 환급·적중 배당). '손실'에서 상계해야
  // 실제로 얼마를 잃었는지가 나온다.
  const RECOVER_TYPES = new Set(["PREDICTION_WIN", "PREDICTION_REFUND"]);

  const PRED_TYPES = new Set([
    "PREDICTION_BET",
    "PREDICTION_WIN",
    "PREDICTION_LOST",
    "PREDICTION_REFUND",
  ]);

  const predIdOf = (e) => String(e?.id || "").split("-")[1] || "";

  function predictionStats(list) {
    const games = new Map();
    for (const e of list) {
      if (!PRED_TYPES.has(e.claimType)) continue;
      const pid = predIdOf(e);
      if (!pid) continue;
      if (!games.has(pid)) {
        games.set(pid, {
          net: 0,
          stake: 0,
          kinds: new Set(),
          rate: 0,
          channel: "",
        });
      }
      const g = games.get(pid);
      const v = entryTotal(e);
      g.net += v;
      if (v < 0) g.stake += -v; // 실제로 넣은 금액
      g.kinds.add(e.claimType);
      g.channel = g.channel || e.channelName || "채널";
      // 배당율은 결과 줄(WIN/LOST)의 통계에서 내 선택지를 찾는다.
      if (!g.rate && e.optionStats?.length) {
        const mine = e.optionStats.find(
          (o) => o.optionNo === e.selectedOptionNo,
        );
        if (mine?.rate) g.rate = mine.rate;
      }
    }
    if (!games.size) return null;

    let win = 0;
    let loss = 0;
    let cancel = 0;
    let net = 0;
    let bestRate = 0;
    let bestGain = 0;
    let worstLoss = 0;
    // 수익률 계산용: 결과가 난 예측에 실제로 넣은 금액(음수 항목의 절댓값 합).
    let staked = 0;
    let settledNet = 0;
    for (const g of games.values()) {
      net += g.net;
      if (g.kinds.has("PREDICTION_REFUND")) {
        cancel += 1; // 이긴 것도 진 것도 아니다 → 성공률·수익률 분모에서 뺀다
        continue;
      }
      const decidedGame =
        g.kinds.has("PREDICTION_WIN") || g.kinds.has("PREDICTION_LOST");
      if (decidedGame) {
        staked += g.stake;
        settledNet += g.net;
      }
      if (g.kinds.has("PREDICTION_WIN")) {
        win += 1;
        if (g.rate > bestRate) bestRate = g.rate;
        if (g.net > bestGain) bestGain = g.net;
      } else if (g.kinds.has("PREDICTION_LOST")) {
        loss += 1;
        if (g.net < worstLoss) worstLoss = g.net;
      }
      // BET 만 있는 건 = 아직 정산 전 → 전적·수익률에 넣지 않는다.
    }
    const decided = win + loss;
    return {
      net,
      win,
      loss,
      cancel,
      decided,
      rate: decided ? Math.round((win / decided) * 100) : 0,
      // 수익률 = 정산된 예측의 순손익 / 그 예측들에 넣은 금액.
      // 미정산·취소는 분모에서 빼야 값이 흔들리지 않는다.
      roi: staked ? Math.round((settledNet / staked) * 100) : null,
      bestRate,
      bestGain,
      worstLoss,
    };
  }

  const netClass = (n) =>
    n > 0 ? "lps-pnl-plus" : n < 0 ? "lps-pnl-minus" : "lps-pnl-zero";

  // 수익률은 부호를 붙여야 손익 방향이 바로 읽힌다.
  const fmtRoi = (n) => `${n > 0 ? "+" : ""}${n}%`;

  // 카드 요약(순수익 + 전적 한 줄).
  function predictionSummaryHtml(list) {
    const st = predictionStats(list);
    // ⚠ 기간마다 따로 판단한다. 오늘은 없어도 전체에는 있을 수 있다.
    if (!st) return "";
    const parts = [`${fmt(st.win)}승 ${fmt(st.loss)}패`];
    if (st.cancel) parts.push(`취소 ${fmt(st.cancel)}`);
    if (st.decided) parts.push(`${st.rate}%`);
    if (st.bestRate) parts.push(`최고 ×${st.bestRate}`);
    return (
      `<div class="lps-pnl">` +
      `<span class="lps-pnl-label">예측 순수익</span>` +
      `<b class="${netClass(st.net)}">${fmtSigned(st.net)}</b>` +
      (st.roi === null
        ? ""
        : `<span class="lps-pnl-roi ${netClass(st.roi)}">${fmtRoi(st.roi)}</span>`) +
      `<span class="lps-pnl-sub">${escapeHtml(parts.join(" · "))}</span>` +
      `</div>`
    );
  }

  // 펼쳤을 때: 채널별 전적.
  function predictionByChannelHtml(list) {
    const byCh = new Map();
    for (const e of list) {
      if (!PRED_TYPES.has(e.claimType)) continue;
      const k = e.channelId || e.channelName || "채널";
      if (!byCh.has(k)) byCh.set(k, []);
      byCh.get(k).push(e);
    }
    if (!byCh.size) return "";
    const rows = [...byCh.values()]
      .map((items) => ({
        name: items[0].channelName || "채널",
        st: predictionStats(items),
      }))
      .filter((r) => r.st)
      .sort((a, b) => b.st.net - a.st.net)
      .map((r) => {
        const st = r.st;
        // ⚠ 카드 하나가 250px 남짓이라 한 줄로는 다 안 들어간다(제보).
        //   1행: 채널명 + 순수익, 2행: 지표를 라벨/값 쌍으로 흘려 넣는다.
        const chips = [
          [
            `${fmt(st.win)}승 ${fmt(st.loss)}패`,
            st.decided ? `${st.rate}%` : "",
          ],
          // 수익률은 손익 방향이 바로 보이도록 부호색을 입힌다.
          st.roi === null ? null : ["수익률", fmtRoi(st.roi), netClass(st.roi)],
          st.cancel ? ["취소", fmt(st.cancel)] : null,
          st.bestRate ? ["최고 배당", `×${st.bestRate}`] : null,
          st.bestGain ? ["최대 수익", fmtSigned(st.bestGain)] : null,
          st.worstLoss ? ["최대 손실", fmtSigned(st.worstLoss)] : null,
        ]
          .filter(Boolean)
          .map(([label, value, cls]) => {
            const attr = cls ? ` class="${cls}"` : "";
            return value
              ? `<span${attr}><i>${escapeHtml(label)}</i>${escapeHtml(String(value))}</span>`
              : `<span${attr}>${escapeHtml(label)}</span>`;
          })
          .join("");
        return (
          `<li>` +
          `<div class="lps-pnl-head">` +
          `<b style="color:${colorFor(r.name)}">${escapeHtml(r.name)}</b>` +
          `<em class="${netClass(st.net)}">${fmtSigned(st.net)}</em>` +
          `</div>` +
          `<div class="lps-pnl-chips">${chips}</div>` +
          `</li>`
        );
      })
      .join("");
    if (!rows) return "";
    return (
      `<div class="lps-bd">` +
      `<span class="lps-bd-title">채널별 예측 전적</span>` +
      `<ul class="lps-pnl-list">${rows}</ul>` +
      `</div>`
    );
  }

  function renderCardBody(key, list) {
    const box = document.querySelector(`[data-card-body="${key}"]`);
    if (!box || box.hidden) return; // 접혀 있으면 계산도 하지 않는다
    if (!list.length) {
      box.innerHTML = `<p class="lps-bd-empty">이 기간에는 기록이 없습니다.</p>`;
      return;
    }
    const byCh = breakdown(
      list,
      (e) => e.channelId || e.channelName,
      (e) => e.channelName || "채널",
    );
    // ⚠ 구형식 기록은 1시간 보상 한 줄에 5분 합계(fiveMinAmount)가 함께 들어 있다.
    //   그대로 종류별로 묶으면 그 5분분까지 '1시간 시청'으로 잡힌다(제보).
    //   집계 전에 두 몫으로 쪼갠다 — 저장된 기록은 건드리지 않는다.
    const typeList = [];
    for (const e of list) {
      if (e.fiveMinAmount > 0) {
        typeList.push({ ...e, fiveMinAmount: 0 });
        typeList.push({
          ...e,
          claimType: "WATCH_5_MIN",
          amount: e.fiveMinAmount,
          fiveMinAmount: 0,
        });
      } else {
        typeList.push(e);
      }
    }
    const byType = breakdown(
      typeList,
      (e) => e.claimType || "WATCH_1_HOUR",
      (e, k) => CLAIM_LABELS[k] || claimFallbackLabel(k),
    );
    // 손실은 비율에서 뺐으므로 총액만 따로 알린다.
    // ⚠ 이 값은 '나간 금액의 합'이지 순손익이 아니다. 예측 취소 환급이나 적중
    //   배당 같은 되돌아온 금액은 빠져 있어, 그것만 보면 실제보다 많이 잃은 것처럼
    //   보인다(제보: 베팅 합 -280 인데 취소·적중을 더하면 실제는 -37).
    //   그래서 되돌아온 금액이 있으면 순손익을 함께 보여 준다.
    let loss = 0;
    let regain = 0;
    for (const e of list) {
      const v = entryTotal(e);
      if (v < 0) loss += v;
      else if (RECOVER_TYPES.has(e.claimType)) regain += v;
    }
    const netLoss = loss + regain;

    const html =
      barHtml("채널", byCh, (key, label) => colorFor(label)) +
      barHtml("종류", byType, (key) => typeColor(key)) +
      predictionByChannelHtml(list) +
      (loss
        ? `<p class="lps-bd-flow lps-pnl-minus">나간 통나무파워 <b>${fmt(loss)}</b></p>` +
          (regain
            ? `<p class="lps-bd-flow lps-pnl-plus">되돌아온 통나무파워 <b>${fmt(regain)}</b></p>` +
              `<p class="lps-bd-flow ${netClass(netLoss)}">실제 손익 <b>${fmtSigned(netLoss)}</b></p>`
            : "")
        : "");
    box.innerHTML =
      html || `<p class="lps-bd-empty">표시할 적립이 없습니다.</p>`;
  }

  function renderCards() {
    const s = periodStarts();
    const src = searched(); // 검색어가 있으면 그 채널 기준으로 집계한다
    const buckets = {
      today: { sum: 0, count: 0, ch: new Set(), items: [] },
      week: { sum: 0, count: 0, ch: new Set(), items: [] },
      month: { sum: 0, count: 0, ch: new Set(), items: [] },
      all: { sum: 0, count: 0, ch: new Set(), items: [] },
    };
    const add = (b, e) => {
      b.sum += entryTotal(e);
      b.count += 1;
      b.ch.add(e.channelId || e.channelName);
      b.items.push(e); // 펼쳤을 때 비율을 내는 데 쓴다
    };
    for (const e of src) {
      add(buckets.all, e);
      if (e.at >= s.month) add(buckets.month, e);
      if (e.at >= s.week) add(buckets.week, e);
      if (e.at >= s.today) add(buckets.today, e);
    }
    for (const [key, b] of Object.entries(buckets)) {
      const sumEl = document.querySelector(`[data-sum="${key}"]`);
      const cntEl = document.querySelector(`[data-count="${key}"]`);
      const chEl = document.querySelector(`[data-channels="${key}"]`);
      if (sumEl) sumEl.textContent = fmt(b.sum);
      if (cntEl) cntEl.textContent = `${fmt(b.count)}회`;
      if (chEl) chEl.textContent = `${fmt(b.ch.size)}개 채널`;
      // 예측 순수익 줄. 그 기간에 예측 기록이 없으면 비워 둔다(기간별 판단).
      const pnl = document.querySelector(`[data-pnl="${key}"]`);
      if (pnl) {
        const html = predictionSummaryHtml(b.items);
        pnl.innerHTML = html;
        pnl.hidden = !html;
      }
      renderCardBody(key, b.items);
    }

    // 카드 제목 옆에 실제 날짜를 병기한다(오늘이 며칠인지 바로 보이도록).
    const now = Date.now();
    const oldest = src.length ? Math.min(...src.map((e) => e.at)) : 0;
    const ranges = {
      today: mmdd(s.today),
      week: `${mmdd(s.week)}~${mmdd(now)}`,
      month: `${mmdd(s.month)}~${mmdd(now)}`,
      all: oldest ? `${mmdd(oldest)}~${mmdd(now)}` : "",
    };
    for (const [key, text] of Object.entries(ranges)) {
      const el = document.querySelector(`[data-range="${key}"]`);
      if (el) el.textContent = text;
    }
  }

  function sortEntries(list) {
    const copy = [...list];
    if (sort === "recent") copy.sort((a, b) => b.at - a.at);
    else if (sort === "oldest") copy.sort((a, b) => a.at - b.at);
    else if (sort === "amount-desc")
      copy.sort((a, b) => entryTotal(b) - entryTotal(a));
    else if (sort === "amount-asc")
      copy.sort((a, b) => entryTotal(a) - entryTotal(b));
    return copy;
  }

  function profileImg(e, extraClass = "") {
    const src = e.channelImageUrl;
    const className = `lps-avatar${extraClass ? ` ${extraClass}` : ""}`;
    if (!src)
      return `<span class="${className} is-empty" aria-hidden="true"></span>`;
    return `<img class="${className}" src="${escapeHtml(src)}" alt="" width="32" height="32" loading="lazy">`;
  }

  // 적립 종류 라벨. 시청 보상은 기존 표기를 쓰므로 시청 외 유형만 담는다.
  const CLAIM_LABELS = {
    // 시청 보상은 항목 줄에서 '1시간 / 5분 합계'로 따로 그리지만,
    // 종류별 묶음의 머리글에는 이름이 필요하다.
    WATCH_1_HOUR: "1시간 시청",
    WATCH_5_MIN: "5분 시청",
    FOLLOW: "팔로우",
    DONATE: "후원",
    DONATE_MONTHLY: "월별 첫 후원",
    SUBSCRIPTION_GIFT: "구독 선물",
    SUBSCRIPTION_GIFT_MONTHLY: "월별 첫 구독 선물",
    PREDICTION_BET: "예측 베팅",
    PREDICTION_WIN: "예측 적중",
    PREDICTION_REFUND: "예측 취소",
    PREDICTION_LOST: "예측 실패",
    OTHER_GAIN: "기타 적립",
    OTHER_LOSS: "기타 사용",
  };
  const isWatchClaim = (t) => !t || t.startsWith("WATCH_");
  // 1시간 보상만 '5분 합계'를 함께 갖는다(그 1시간 동안의 5분 보상 12회).
  const isHourClaim = (t) => !t || t === "WATCH_1_HOUR";

  // 목록에 없는 종류(직접 입력분)는 그대로 보여 준다. "EVENT_BONUS" → "Event bonus".
  function claimFallbackLabel(type) {
    const raw = String(type || "").trim();
    if (!raw) return "적립";
    return raw
      .split("_")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" ");
  }

  // 부스팅 배수 → 구독 티어. 실측값: 미구독 100, 티어1 120(×1.2), 티어2 200(×2).
  // 아는 배수만 티어를 붙이고, 모르는 값은 배수만 표기한다(수신함 탭과 동일).
  function boostLabel(boost) {
    const tier = boost === 2 ? 2 : boost === 1.2 ? 1 : 0;
    return tier ? `${tier}티어 구독 ×${boost}` : `구독 ×${boost}`;
  }

  const markHtml = (on) =>
    on
      ? `<i class="lps-mark" aria-hidden="true"></i><span class="lps-a11y">인증 마크</span>`
      : "";

  // 이 이상 걸리면 '명승부' 배지를 붙인다(100만 파워).
  const POT_BADGE_MIN = 1000000;

  // 큰 수를 짧게: 1억 이상은 억, 1만 이상은 만 단위로.
  function compactPower(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) {
      return `${(v / 100000000).toFixed(1).replace(/\.0$/, "")}억`;
    }
    if (v >= 10000) return `${Math.round(v / 10000).toLocaleString("ko-KR")}만`;
    return fmt(v);
  }

  // 금액 글자색. 예측은 종류별로 색을 맞춰 상세의 막대와 이어 보이게 한다.
  function amountClass(e) {
    if (e.claimType === "PREDICTION_BET") return "lps-amt-bet";
    if (e.claimType === "PREDICTION_WIN") return "lps-amt-win";
    return e.amount < 0 ? "lps-neg" : "";
  }

  // 베팅 줄에 '맞혔다면 얼마' 를 덧붙인다.
  // ⚠ 통계는 정산(COMPLETED) 후에 저장하므로 배분율은 이미 확정값이다
  //   (EXPIRED 부터 추가 베팅이 막혀 비율이 더 변하지 않는다).
  //   따라서 '예상'이 아니라 확정 배당 기준 금액이다.
  function expectedWinHtml(e) {
    if (e.claimType !== "PREDICTION_BET") return "";
    const mine = e.optionStats?.find((o) => o.optionNo === e.selectedOptionNo);
    if (!mine?.rate) return "";
    const payout = Math.round(Math.abs(e.amount) * mine.rate);
    return (
      `<span class="lps-amt-expect" title="확정 배분율 ×${mine.rate} 기준">` +
      `적중 시 ${fmt(payout)}</span>`
    );
  }

  // 선택지 <li> 들. 펼칠 때만 만든다.
  function predictionRowsHtml(e) {
    if (!e?.optionStats?.length) return "";
    // con-chzzk 팝업과 같은 '비율만큼 채워지는 막대' 형태. 표보다 한눈에 읽힌다.
    return e.optionStats
      .map((o) => {
        const mine = o.optionNo === e.selectedOptionNo;
        const win = o.optionNo === e.winningOptionNo;
        const cls = [
          "lps-pred-item",
          mine ? "is-mine" : "",
          win ? "is-win" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // 색·테두리로만 구분하므로 스크린리더용 설명을 남긴다.
        const note = win ? "정답" : mine ? "내 선택" : "";
        return (
          `<li class="${cls}"${note ? ` title="${note}"` : ""}>` +
          (note ? `<span class="lps-a11y">${note}</span>` : "") +
          `<span class="lps-pred-bar" style="width:${Math.max(0, Math.min(100, o.percentage))}%"></span>` +
          `<span class="lps-pred-row">` +
          `<b>${escapeHtml(o.text || "-")}</b>` +
          `<span class="lps-pred-meta">` +
          `${fmt(o.participants)}명 · ${fmt(o.powers)} · ×${o.rate}` +
          `</span>` +
          `<em>${fmt(o.percentage)}%</em>` +
          `</span>` +
          `</li>`
        );
      })
      .join("");
  }

  // 나눠 건 이력. 한 번에 건 경우(1회)는 보여 줄 게 없다.
  function betHistoryHtml(e) {
    const h = e?.betHistory;
    if (!Array.isArray(h) || h.length < 2) return "";
    const items = h
      .map(
        (b) =>
          `<li><span>${escapeHtml(formatWhen(Number(b?.at) || 0))}</span>` +
          `<b>${fmtSigned(-(Number(b?.amount) || 0))}</b></li>`,
      )
      .join("");
    return (
      `<div class="lps-pred-hist">` +
      `<span class="lps-pred-hist-title">나눠 건 이력 ${fmt(h.length)}회</span>` +
      `<ul>${items}</ul>` +
      `</div>`
    );
  }

  // 마감된 예측의 선택지 통계. 내가 고른 것과 정답을 표시한다.
  function predictionStatsHtml(e) {
    if (!e.optionStats?.length) return "";
    const ended = e.winningOptionNo > 0 ? " is-ended" : "";
    // 내가 맞혔는지 — 배경색을 다르게 준다(적중 민트 / 실패 회색).
    const hit = ended && e.selectedOptionNo === e.winningOptionNo;
    const state = ended ? (hit ? " is-hit" : " is-miss") : "";
    // 판돈 규모. 크게 걸린 판은 따로 알려 준다.
    const pot = e.optionStats.reduce((n, o) => n + o.powers, 0);
    const badge =
      pot >= POT_BADGE_MIN
        ? `<span class="lps-pred-pot">${escapeHtml(compactPower(pot))} 파워가 걸린 명승부</span>`
        : "";
    // ⚠ 접혀 있어도 <ul> 을 채워 두면 선택지 막대가 목록의 예측 수만큼 DOM 에
    //   쌓인다. 펼칠 때 id 로 다시 만든다(아래 bindPredToggles).
    return (
      `<details class="lps-pred${ended}${state}" data-pred-for="${escapeHtml(e.id)}">` +
      `<summary>예측 상세${e.predictionTitle ? ` · ${escapeHtml(e.predictionTitle)}` : ""}${badge}</summary>` +
      `<ul class="lps-pred-list"></ul>` +
      `</details>`
    );
  }

  function rowHtml(e, { tree = false } = {}) {
    const treeClass = tree ? " lps-tree-file" : "";
    const leading = profileImg(e, tree ? "lps-tree-file-icon" : "");
    return (
      `<li class="lps-row${treeClass}" data-entry-id="${escapeHtml(e.id)}" tabindex="0" role="button">` +
      leading +
      `<div class="lps-row-main">` +
      `<div class="lps-row-top">` +
      `<strong>${escapeHtml(e.channelName || "채널")}${markHtml(e.verifiedMark)}</strong>` +
      `<span class="lps-when">${escapeHtml(formatWhen(e.at))}</span>` +
      `</div>` +
      `<div class="lps-row-sub">` +
      // 시청 보상은 '1시간 + 5분 합계', 그 외는 유형 이름 한 줄.
      // ⚠ '1시간 + 5분 합계' 두 줄은 1시간 보상 전용이다. isWatchClaim 은
      //   WATCH_5_MIN 도 참이라 그대로 쓰면 5분 기록이 '1시간'으로 표시된다(제보).
      (isHourClaim(e.claimType)
        ? `<span>1시간 <b>${fmt(e.amount)}</b></span>` +
          (e.fiveMinAmount
            ? `<span>5분 합계 <b>${fmt(e.fiveMinAmount)}</b></span>`
            : "")
        : `<span class="${amountClass(e)}">${escapeHtml(
            CLAIM_LABELS[e.claimType] || claimFallbackLabel(e.claimType),
          )} <b>${fmtSigned(e.amount)}</b></span>${expectedWinHtml(e)}` +
          // 묶인 회차 수. 12회면 1시간을 채운 것, 적으면 중간에 끊긴 것.
          (e.claimType === "WATCH_5_MIN" && e.watchCount > 0
            ? `<span class="lps-watch-count">${fmt(e.watchCount)}회</span>`
            : "")) +
      (e.boost > 1
        ? `<span class="lps-boost">${escapeHtml(boostLabel(e.boost))}</span>`
        : "") +
      `</div>` +
      predictionStatsHtml(e) +
      `</div>` +
      `<span class="lps-total${entryTotal(e) < 0 ? " lps-neg" : ""}">${
        e.amount < 0 ? fmtSigned(entryTotal(e)) : fmt(entryTotal(e))
      }</span>` +
      `</li>`
    );
  }

  function renderRangeNote() {
    const note = document.getElementById("lpsRangeNote");
    if (!note) return;
    note.textContent = fromMs || toMs ? `${fmt(visible().length)}건` : "";
  }

  function renderGroupPath() {
    const path = document.querySelector("[data-group-path]");
    if (!path) return;
    const labels = orderedGroupLevels()
      .filter((level) => level.on())
      .map((level) => level.label);
    path.hidden = labels.length === 0;
    path.textContent = labels.length ? `표시 순서 · ${labels.join(" → ")}` : "";
  }

  function renderLogBody() {
    const body = document.getElementById("lpsBody");
    if (!body) return;
    renderGroupPath();
    renderViewModeControls();
    if (!entries.length) {
      body.innerHTML =
        `<p class="lps-empty" role="status">아직 기록된 획득이 없습니다.<br>` +
        `설정에서 <b>통나무파워 자동 획득</b>을 켜 두면 1시간 시청 보상을 받을 때마다 쌓입니다.</p>`;
      updateGroupCollapseControls(body);
      scheduleFabUpdate();
      return;
    }
    const rows = visible();
    if (!rows.length) {
      body.innerHTML = `<p class="lps-empty" role="status">조건에 맞는 기록이 없습니다.</p>`;
      updateGroupCollapseControls(body);
      scheduleFabUpdate();
      return;
    }
    const sortedRows = sortEntries(rows);
    const mode = effectiveViewMode();
    body.innerHTML =
      mode === "calendar"
        ? renderCalendar(sortedRows)
        : mode === "explorer"
          ? renderExplorer(sortedRows)
          : renderRows(sortedRows);
    bindGroupToggles(body);
    bindPredToggles(body);
    updateGroupCollapseControls(body);
    // 목록 길이가 바뀌면 '직접 추가' 버튼의 화면 안 여부도 달라진다.
    scheduleFabUpdate();
  }

  function render() {
    renderCards();
    renderRangeNote();
    // ⚠ 막대 차트도 기간을 반영하므로 함께 다시 그린다(예전엔 라인만 갱신해
    //   기간을 바꿔도 막대가 그대로였다 — 제보).
    // ⚠ 라인을 먼저 그린다. 라인이 상위 N 채널의 기본색을 순서대로 정해 두면
    //   막대가 같은 색을 쓴다(반대 순서면 첫 그림에서 색이 어긋난다).
    renderLineChart();
    renderBarChart();
    renderLogBody();
  }

  // 날짜 머리글용 키/라벨.
  const dayKeyOf = (ms) => dateKey(new Date(ms));
  function dayLabel(key) {
    const [y, m, d] = key.split("-");
    const today = dateKey(new Date());
    if (key === today) return `오늘 (${m}.${d})`;
    return `${y}.${m}.${d}`;
  }

  const CALENDAR_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  function calendarMonthDate() {
    const value = new Date(calendarMonth);
    if (!+value) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return new Date(value.getFullYear(), value.getMonth(), 1);
  }

  function setCalendarMonth(value) {
    const date = new Date(value);
    if (!+date) return;
    calendarMonth = +new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function ensureCalendarMonthForRange() {
    if (!fromMs && !toMs) return;
    const month = calendarMonthDate();
    const start = +month;
    const end = +new Date(month.getFullYear(), month.getMonth() + 1, 1) - 1;
    if ((!fromMs || end >= fromMs) && (!toMs || start <= toMs)) return;
    setCalendarMonth(fromMs || toMs);
  }

  function calendarDateLabel(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return `${year}년 ${month}월 ${day}일 (${CALENDAR_WEEKDAYS[date.getDay()]})`;
  }

  function calendarStats(list) {
    let gain = 0;
    let loss = 0;
    for (const entry of list) {
      const amount = entryTotal(entry);
      if (amount > 0) gain += amount;
      else if (amount < 0) loss += Math.abs(amount);
    }
    return { gain, loss, net: gain - loss };
  }

  function calendarProfiles(list) {
    const profiles = new Map();
    for (const entry of list) {
      const name = String(entry.channelName || "채널").trim() || "채널";
      const key = entry.channelId || normalizedChannelName(name) || entry.id;
      if (!profiles.has(key)) {
        profiles.set(key, {
          name,
          imageUrl: String(entry.channelImageUrl || ""),
          weight: 0,
          latest: 0,
        });
      }
      const profile = profiles.get(key);
      if (!profile.imageUrl && entry.channelImageUrl) {
        profile.imageUrl = String(entry.channelImageUrl);
      }
      profile.weight += Math.abs(entryTotal(entry));
      profile.latest = Math.max(profile.latest, Number(entry.at) || 0);
    }
    return [...profiles.values()].sort(
      (a, b) => b.weight - a.weight || b.latest - a.latest,
    );
  }

  function calendarProfileStack(list, limit = 4) {
    const profiles = calendarProfiles(list);
    if (!profiles.length) return "";
    const visibleProfiles = profiles.slice(0, limit);
    const avatars = visibleProfiles
      .map((profile) => {
        const title = escapeHtml(profile.name);
        const color = escapeHtml(colorFor(profile.name));
        if (!profile.imageUrl) {
          return `<span class="lps-calendar-avatar is-empty" title="${title}" style="--lps-calendar-avatar-color:${color}" aria-hidden="true">${escapeHtml(profile.name.charAt(0))}</span>`;
        }
        return `<span class="lps-calendar-avatar" title="${title}" style="--lps-calendar-avatar-color:${color}" aria-hidden="true"><img src="${escapeHtml(profile.imageUrl)}" alt="" loading="lazy"></span>`;
      })
      .join("");
    const rest = profiles.length - visibleProfiles.length;
    return (
      `<span class="lps-calendar-profiles" role="img" aria-label="관련 채널 ${fmt(profiles.length)}개">` +
      avatars +
      (rest > 0
        ? `<span class="lps-calendar-profile-more" aria-hidden="true">+${fmt(rest)}</span>`
        : "") +
      `</span>`
    );
  }

  function compactSignedPower(value) {
    const amount = Number(value) || 0;
    if (amount > 0) return `+${compactPower(amount)}`;
    if (amount < 0) return `-${compactPower(Math.abs(amount))}`;
    return "0";
  }

  const fmtCalendarGain = (value) =>
    Number(value) > 0 ? `+${fmt(value)}` : "0";
  const fmtCalendarLoss = (value) =>
    Number(value) > 0 ? `-${fmt(value)}` : "0";

  function calendarDayHtml(date, currentMonth, list) {
    const key = dateKey(date);
    const stats = calendarStats(list);
    const dayStart = +new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const dayEnd = +new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    ) - 1;
    const outsideRange =
      (fromMs && dayEnd < fromMs) || (toMs && dayStart > toMs);
    const classes = [
      "lps-calendar-day",
      date.getMonth() !== currentMonth ? "is-outside-month" : "",
      key === dateKey(new Date()) ? "is-today" : "",
      outsideRange ? "is-outside-range" : "",
      list.length ? "has-records" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const label = list.length
      ? `${calendarDateLabel(key)}, 획득 ${fmt(stats.gain)}, 사용 ${fmt(stats.loss)}, 순변동 ${fmtSigned(stats.net)}, ${fmt(list.length)}건`
      : `${calendarDateLabel(key)}, 기록 없음`;
    return (
      `<button type="button" class="${classes}" role="gridcell" aria-label="${escapeHtml(label)}" ` +
      (list.length
        ? `data-calendar-day="${key}" aria-expanded="false" aria-controls="lpsCalendarPopover"`
        : "disabled") +
      `>` +
      `<span class="lps-calendar-day-number">${date.getDate()}</span>` +
      (list.length
        ? `<span class="lps-calendar-day-count">${fmt(list.length)}건</span>` +
          `<span class="lps-calendar-day-stats">` +
          (stats.gain
            ? `<span class="is-gain"><small>획득</small> +${compactPower(stats.gain)}</span>`
            : "") +
          (stats.loss
            ? `<span class="is-loss"><small>사용</small> -${compactPower(stats.loss)}</span>`
            : "") +
          `<span class="${netClass(stats.net)}"><small>순변동</small> ${compactSignedPower(stats.net)}</span>` +
          `</span>` +
          calendarProfileStack(list)
        : "") +
      `</button>`
    );
  }

  function renderCalendar(rows) {
    calendarPopoverTrigger = null;
    const month = calendarMonthDate();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const byDay = new Map();
    for (const entry of rows) {
      const key = dayKeyOf(entry.at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(entry);
    }
    const monthRows = rows.filter((entry) => {
      const date = new Date(entry.at);
      return date.getFullYear() === year && date.getMonth() === monthIndex;
    });
    const monthStats = calendarStats(monthRows);
    const gridStart = new Date(year, monthIndex, 1 - month.getDay());
    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return calendarDayHtml(date, monthIndex, byDay.get(dateKey(date)) || []);
    }).join("");
    const weekdayHeaders = CALENDAR_WEEKDAYS.map(
      (weekday, index) =>
        `<span class="lps-calendar-weekday${index === 0 ? " is-sunday" : index === 6 ? " is-saturday" : ""}" role="columnheader">${weekday}</span>`,
    ).join("");
    return (
      `<section class="lps-calendar" aria-label="${year}년 ${monthIndex + 1}월 통나무파워 달력">` +
      `<header class="lps-calendar-head">` +
      `<div class="lps-calendar-nav">` +
      `<button type="button" data-calendar-nav="prev" aria-label="이전 달" title="이전 달">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>` +
      `<button type="button" class="lps-calendar-today" data-calendar-nav="today">오늘</button>` +
      `<button type="button" data-calendar-nav="next" aria-label="다음 달" title="다음 달">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>` +
      `</div>` +
      `<div class="lps-calendar-heading"><h3 aria-live="polite">${year}년 ${monthIndex + 1}월</h3>` +
      `<p>${fmt(monthRows.length)}건 · 획득 <b class="lps-pnl-plus">${fmtCalendarGain(monthStats.gain)}</b> · 사용 <b class="lps-pnl-minus">${fmtCalendarLoss(monthStats.loss)}</b> · 순변동 <b class="${netClass(monthStats.net)}">${fmtSigned(monthStats.net)}</b></p></div>` +
      `</header>` +
      `<div class="lps-calendar-weekdays" role="row">${weekdayHeaders}</div>` +
      `<div class="lps-calendar-grid" role="grid">${days}</div>` +
      `<aside class="lps-calendar-popover" id="lpsCalendarPopover" role="dialog" aria-modal="false" aria-label="날짜 상세 내역" hidden></aside>` +
      `</section>`
    );
  }

  function closeCalendarPopover({ restoreFocus = false } = {}) {
    const popover = document.getElementById("lpsCalendarPopover");
    if (!popover || popover.hidden) return false;
    popover.hidden = true;
    popover.textContent = "";
    document
      .querySelectorAll('[data-calendar-day][aria-expanded="true"]')
      .forEach((button) => button.setAttribute("aria-expanded", "false"));
    const trigger = calendarPopoverTrigger;
    calendarPopoverTrigger = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
    return true;
  }

  function positionCalendarPopover(popover, trigger) {
    const calendar = trigger.closest(".lps-calendar");
    if (!calendar) return;
    popover.style.left = "8px";
    popover.style.top = "8px";
    popover.style.visibility = "hidden";
    popover.hidden = false;
    const calendarRect = calendar.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const maxLeft = Math.max(8, calendar.clientWidth - width - 8);
    const centered =
      triggerRect.left - calendarRect.left + triggerRect.width / 2 - width / 2;
    const left = Math.max(8, Math.min(maxLeft, centered));
    const availableBelow = window.innerHeight - triggerRect.bottom;
    const availableAbove = triggerRect.top;
    let top = triggerRect.bottom - calendarRect.top + 8;
    if (
      availableBelow < Math.min(height, 360) &&
      availableAbove > availableBelow
    ) {
      top = triggerRect.top - calendarRect.top - height - 8;
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.max(8, Math.round(top))}px`;
    popover.style.visibility = "";
  }

  function openCalendarDay(key, trigger) {
    const popover = document.getElementById("lpsCalendarPopover");
    if (!popover) return;
    if (
      calendarPopoverTrigger === trigger &&
      trigger.getAttribute("aria-expanded") === "true"
    ) {
      closeCalendarPopover();
      return;
    }
    const list = sortEntries(
      visible().filter((entry) => dayKeyOf(entry.at) === key),
    );
    if (!list.length) return;
    closeCalendarPopover();
    const stats = calendarStats(list);
    popover.innerHTML =
      `<header class="lps-calendar-popover-head"><div><small>날짜 상세</small>` +
      `<h3>${escapeHtml(calendarDateLabel(key))}</h3></div>` +
      `<button type="button" data-calendar-popover-close aria-label="날짜 상세 닫기" title="닫기">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header>` +
      `<div class="lps-calendar-popover-summary">` +
      `<span class="lps-pnl-plus"><small>획득</small><b>${fmtCalendarGain(stats.gain)}</b></span>` +
      `<span class="lps-pnl-minus"><small>사용</small><b>${fmtCalendarLoss(stats.loss)}</b></span>` +
      `<span class="${netClass(stats.net)}"><small>순변동</small><b>${fmtSigned(stats.net)}</b></span>` +
      `</div><div class="lps-calendar-popover-list">${plainList(list)}</div>`;
    document
      .querySelectorAll('[data-calendar-day][aria-expanded="true"]')
      .forEach((button) => button.setAttribute("aria-expanded", "false"));
    trigger.setAttribute("aria-expanded", "true");
    calendarPopoverTrigger = trigger;
    bindPredToggles(popover);
    positionCalendarPopover(popover, trigger);
  }

  function groupBy(list, keyOf, context) {
    const map = new Map();
    for (const e of list) {
      const k = keyOf(e, context);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return [...map.entries()];
  }

  const sumOf = (list) => list.reduce((n, e) => n + entryTotal(e), 0);

  // <details> 한 덩어리. 접힘 상태는 key 로 기억한다.
  function detailsHtml(key, label, list, inner, tint = "") {
    // 스트리머·종류 그룹은 각자의 색을 옅게 깐다(차트·비율 막대와 색을 맞춘다).
    // ⚠ CSS 변수는 상속된다. 색이 없는 단계(날짜)가 그냥 두면 바깥 단계의 틴트를
    //   물려받아 같은 색이 겹친다 → 명시적으로 중립값으로 덮어쓴다.
    const style = ` style="--lps-group-tint:${tint || "var(--popup-soft-bg)"}"`;
    return (
      `<li class="lps-group">` +
      `<details data-group-key="${escapeHtml(key)}"${collapsed.has(key) ? "" : " open"}${style}>` +
      `<summary><span>${escapeHtml(label)}</span>` +
      `<small>${fmt(list.length)}건 · ${fmt(sumOf(list))}</small>` +
      `</summary>${inner}</details></li>`
    );
  }

  function plainList(list, { tree = false } = {}) {
    return (
      `<ul class="lps-list${tree ? " lps-tree-file-list" : ""}">` +
      `${list.map((entry) => rowHtml(entry, { tree })).join("")}</ul>`
    );
  }

  function normalizedChannelName(value) {
    return String(value || "")
      .trim()
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR");
  }

  function groupContext(list) {
    const idsByName = new Map();
    for (const entry of list) {
      const name = normalizedChannelName(entry.channelName);
      const id = String(entry.channelId || "").trim();
      if (!name || !id) continue;
      if (!idsByName.has(name)) idsByName.set(name, new Set());
      idsByName.get(name).add(id);
    }
    const uniqueIdByName = new Map();
    idsByName.forEach((ids, name) => {
      if (ids.size === 1) uniqueIdByName.set(name, ids.values().next().value);
    });
    return { uniqueIdByName };
  }

  function subgroupHtml(
    key,
    label,
    list,
    inner,
    tint = "",
    color = "",
    depth = 1,
  ) {
    const style =
      ` style="--lps-subgroup-tint:${tint || "var(--popup-soft-bg)"};` +
      `--lps-folder-color:${color || "var(--popup-muted)"}"`;
    const open = !collapsed.has(key);
    return (
      `<li class="lps-subgroup" data-group-depth="${depth}">` +
      `<button type="button" class="lps-subgroup-head" data-subgroup-toggle ` +
      `data-group-key="${escapeHtml(key)}" aria-expanded="${open}"${style}>` +
      `<span class="lps-subgroup-title">` +
      `<span class="lps-folder-icon" aria-hidden="true"></span>` +
      `<span>${escapeHtml(label)}</span></span>` +
      `<small>${fmt(list.length)}건 · ${fmt(sumOf(list))}</small>` +
      `</button><div class="lps-subgroup-content"${open ? "" : " hidden"}>` +
      `${inner}</div></li>`
    );
  }

  // 묶음 단계 정의. 켜진 기준을 사용자가 정한 순서로 적용한다.
  // 최상위는 details, 하위는 평평한 접이식 소제목으로 표현한다.
  // ⚠ 조합마다 분기를 쓰면 토글이 하나 늘 때마다 경우의 수가 배로 늘어난다.
  //   단계를 배열로 두고 재귀로 감싸면 어떤 조합이든 같은 코드로 처리된다.
  const GROUP_LEVELS = [
    {
      id: "streamer",
      on: () => groupByStreamer,
      label: "스트리머",
      prefix: "ch",
      keyOf: (e, context) => {
        const name = normalizedChannelName(e.channelName);
        const id =
          String(e.channelId || "").trim() ||
          context.uniqueIdByName.get(name) ||
          "";
        return id ? `id:${id}` : `name:${name || "unknown"}`;
      },
      labelOf: (items) =>
        items.find((item) => item.channelName)?.channelName || "채널",
      // 스트리머 단계만 채널색을 옅게 깐다(차트와 색을 맞춘다).
      tintOf: (items) =>
        withAlpha(colorFor(items[0].channelName || "채널"), 0.16),
      colorOf: (items) => colorFor(items[0].channelName || "채널"),
    },
    {
      id: "date",
      on: () => groupByDate,
      label: "날짜",
      prefix: "date",
      keyOf: (e) => dayKeyOf(e.at),
      labelOf: (items, key) => dayLabel(key),
      colorOf: () => "var(--popup-muted)",
    },
    {
      id: "type",
      on: () => groupByType,
      label: "종류",
      prefix: "type",
      keyOf: (e) => e.claimType || "WATCH_1_HOUR",
      labelOf: (items, key) => CLAIM_LABELS[key] || claimFallbackLabel(key),
      // 비율 막대와 같은 종류색을 옅게 깐다(위아래가 같은 색으로 이어진다).
      tintOf: (items, key) => withAlpha(typeColor(key), 0.16),
      colorOf: (items, key) => typeColor(key),
    },
  ];

  function normalizeGroupOrder(value) {
    const allowed = new Set(DEFAULT_GROUP_ORDER);
    const next = [];
    for (const id of Array.isArray(value) ? value : []) {
      if (allowed.has(id) && !next.includes(id)) next.push(id);
    }
    for (const id of DEFAULT_GROUP_ORDER) {
      if (!next.includes(id)) next.push(id);
    }
    return next;
  }

  function orderedGroupLevels() {
    return normalizeGroupOrder(groupOrder)
      .map((id) => GROUP_LEVELS.find((level) => level.id === id))
      .filter(Boolean);
  }

  function activeGroupLevels() {
    return orderedGroupLevels().filter((level) => level.on());
  }

  function effectiveViewMode() {
    if (viewMode === "calendar") return "calendar";
    return viewMode === "explorer" && activeGroupLevels().length
      ? "explorer"
      : "tree";
  }

  function renderViewModeControls() {
    const active = activeGroupLevels().length > 0;
    const effective = effectiveViewMode();
    document.querySelectorAll("[data-view-mode]").forEach((button) => {
      const mode = button.dataset.viewMode;
      button.setAttribute("aria-pressed", String(mode === effective));
      if (mode === "explorer") {
        button.disabled = !active;
        button.title = active
          ? "폴더를 하나씩 열어 내역을 탐색합니다"
          : "모아보기를 하나 이상 켜면 사용할 수 있습니다";
      }
    });
    const collapseActions = document.querySelector(
      ".lps-group-collapse-actions",
    );
    if (collapseActions) collapseActions.hidden = effective !== "tree";
    const orderRow = document.querySelector(".lps-group-order-row");
    if (orderRow) orderRow.hidden = effective === "calendar";
  }

  function renderGroupOrderControls() {
    const list = document.querySelector("[data-group-order-list]");
    if (!list) return;
    const items = new Map(
      [...list.querySelectorAll("[data-group-order-item]")].map((item) => [
        item.dataset.groupOrderItem,
        item,
      ]),
    );
    orderedGroupLevels().forEach((level, index, levels) => {
      const item = items.get(level.id);
      if (!item) return;
      item.classList.toggle("is-active", level.on());
      item.dataset.enabled = String(level.on());
      item.title = level.on()
        ? `${level.label} 기준 사용 중`
        : `${level.label}별 모아보기를 켜면 적용됩니다`;
      const up = item.querySelector('[data-group-move="up"]');
      const down = item.querySelector('[data-group-move="down"]');
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === levels.length - 1;
      list.append(item);
    });
  }

  function applyGroupOrder(value, { persist = true } = {}) {
    const next = normalizeGroupOrder(value);
    const changed = next.some((id, index) => id !== groupOrder[index]);
    groupOrder = next;
    renderGroupOrderControls();
    if (!changed) return;
    collapsed.clear();
    explorerPath = [];
    rebuildExplorerUnreadPaths();
    if (persist) {
      try {
        void chrome.storage.local.set({ [GROUP_ORDER_KEY]: groupOrder });
      } catch {}
    }
    renderLogBody();
  }

  function moveGroupOrder(id, offset) {
    const next = normalizeGroupOrder(groupOrder);
    const from = next.indexOf(id);
    const to = Math.max(0, Math.min(next.length - 1, from + offset));
    if (from < 0 || from === to) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    applyGroupOrder(next);
  }

  function dropGroupOrder(sourceId, targetId, after) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const next = normalizeGroupOrder(groupOrder).filter(
      (id) => id !== sourceId,
    );
    const targetIndex = next.indexOf(targetId);
    if (targetIndex < 0) return;
    next.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
    applyGroupOrder(next);
  }

  function nestSubgroups(list, levels, prefix, context, depth = 1) {
    if (!levels.length) return plainList(list, { tree: true });
    const [level, ...rest] = levels;
    return (
      `<ul class="lps-subgroup-list" data-group-depth="${depth}">` +
      groupBy(list, level.keyOf, context)
        .map(([key, items]) => {
          const id = `${prefix}${level.prefix}:${key}`;
          return subgroupHtml(
            id,
            level.labelOf(items, key),
            items,
            nestSubgroups(items, rest, `${id}|`, context, depth + 1),
            level.tintOf ? level.tintOf(items, key) : "",
            level.colorOf ? level.colorOf(items, key) : "",
            depth,
          );
        })
        .join("") +
      `</ul>`
    );
  }

  function renderRows(rows) {
    const levels = activeGroupLevels();
    if (!levels.length) return plainList(rows);
    const context = groupContext(rows);
    const [outer, ...rest] = levels;
    return (
      `<ul class="lps-list lps-group-list">` +
      groupBy(rows, outer.keyOf, context)
        .map(([key, items]) => {
          const id = `${outer.prefix}:${key}`;
          return detailsHtml(
            id,
            outer.labelOf(items, key),
            items,
            nestSubgroups(items, rest, `${id}|`, context),
            outer.tintOf ? outer.tintOf(items, key) : "",
          );
        })
        .join("") +
      `</ul>`
    );
  }

  function explorerFolderGroups(list, level, context) {
    return groupBy(list, level.keyOf, context).map(([key, items]) => ({
      key: String(key),
      items,
      label: level.labelOf(items, key),
      tint: level.tintOf ? level.tintOf(items, key) : "",
      color: level.colorOf ? level.colorOf(items, key) : "",
    }));
  }

  function explorerFolderPathKey(path) {
    return JSON.stringify(
      path.map((segment) => [segment.levelId, String(segment.key)]),
    );
  }

  function explorerUnreadCount(path) {
    return (
      explorerUnreadByFolderPath.get(explorerFolderPathKey(path))?.size || 0
    );
  }

  function explorerUnreadTotal() {
    return explorerUnreadIds.size;
  }

  function explorerUnreadBadge(count, extraClass = "") {
    if (!count) return "";
    const label = `새 내역 ${fmt(count)}건`;
    return (
      `<span class="lps-explorer-new-badge${extraClass ? ` ${extraClass}` : ""}" ` +
      `aria-label="${label}" title="${label}">${count > 99 ? "99+" : fmt(count)}</span>`
    );
  }

  function markExplorerFolderRead(path) {
    const ids = explorerUnreadByFolderPath.get(explorerFolderPathKey(path));
    if (!ids?.size) return;
    ids.forEach((id) => explorerUnreadIds.delete(id));
    rebuildExplorerUnreadPaths();
    persistExplorerUnreadState();
  }

  function rebuildExplorerUnreadPaths(list = entries) {
    explorerUnreadByFolderPath.clear();
    const levels = activeGroupLevels();
    if (!levels.length) return;
    const entryById = new Map(list.map((entry) => [entry.id, entry]));
    const context = groupContext(list);
    for (const id of [...explorerUnreadIds]) {
      const entry = entryById.get(id);
      if (!entry) {
        explorerUnreadIds.delete(id);
        continue;
      }
      const entryPath = levels.map((level) => ({
        levelId: level.id,
        key: String(level.keyOf(entry, context)),
      }));
      const path = [];
      for (const segment of entryPath) {
        path.push(segment);
        const pathKey = explorerFolderPathKey(path);
        if (!explorerUnreadByFolderPath.has(pathKey)) {
          explorerUnreadByFolderPath.set(pathKey, new Set());
        }
        explorerUnreadByFolderPath.get(pathKey).add(id);
      }
    }
  }

  function persistExplorerUnreadState(list = entries) {
    try {
      void chrome.storage.local
        .set({
          [EXPLORER_KNOWN_IDS_KEY]: list.map((entry) => entry.id),
          [EXPLORER_UNREAD_IDS_KEY]: [...explorerUnreadIds],
        })
        .catch(() => {});
    } catch {}
  }

  function replaceExplorerUnreadIds(value, validIds = null) {
    explorerUnreadIds.clear();
    if (!Array.isArray(value)) return;
    value.forEach((valueId) => {
      const id = String(valueId || "");
      if (id && (!validIds || validIds.has(id))) explorerUnreadIds.add(id);
    });
  }

  async function loadExplorerUnreadState() {
    const currentIds = new Set(entries.map((entry) => entry.id));
    try {
      const saved = await chrome.storage.local.get([
        EXPLORER_KNOWN_IDS_KEY,
        EXPLORER_UNREAD_IDS_KEY,
      ]);
      const known = saved?.[EXPLORER_KNOWN_IDS_KEY];
      replaceExplorerUnreadIds(saved?.[EXPLORER_UNREAD_IDS_KEY], currentIds);
      if (Array.isArray(known)) {
        const knownIds = new Set(known.map((id) => String(id || "")));
        currentIds.forEach((id) => {
          if (!knownIds.has(id)) explorerUnreadIds.add(id);
        });
      }
    } catch {
      explorerUnreadIds.clear();
    }
    rebuildExplorerUnreadPaths();
    persistExplorerUnreadState();
  }

  function rememberExplorerNewEntries(oldValue, newValue) {
    const levels = activeGroupLevels();
    const previousIds = new Set(normalize(oldValue).map((entry) => entry.id));
    const nextEntries = normalize(newValue);
    const nextIds = new Set(nextEntries.map((entry) => entry.id));
    for (const id of [...explorerUnreadIds]) {
      if (!nextIds.has(id)) explorerUnreadIds.delete(id);
    }
    const context = levels.length ? groupContext(nextEntries) : null;
    nextEntries.forEach((entry) => {
      if (previousIds.has(entry.id)) return;
      const entryPath = levels.map((level) => ({
        levelId: level.id,
        key: String(level.keyOf(entry, context)),
      }));
      const alreadyVisible =
        effectiveViewMode() === "explorer" &&
        entryPath.length > 0 &&
        explorerPath.length === entryPath.length &&
        explorerPath.every(
          (segment, index) =>
            segment.levelId === entryPath[index].levelId &&
            segment.key === entryPath[index].key,
        );
      if (!alreadyVisible) explorerUnreadIds.add(entry.id);
    });
    rebuildExplorerUnreadPaths(nextEntries);
  }

  function explorerFolderPath(folder, level, depth) {
    return [
      ...explorerPath.slice(0, depth),
      { levelId: level.id, key: folder.key },
    ];
  }

  function resolveExplorerPath(rows, levels, context) {
    let items = rows;
    const resolved = [];
    for (let depth = 0; depth < levels.length; depth += 1) {
      const segment = explorerPath[depth];
      const level = levels[depth];
      if (!segment || segment.levelId !== level.id) break;
      const siblings = explorerFolderGroups(items, level, context);
      const folder = siblings.find((item) => item.key === segment.key);
      if (!folder) break;
      resolved.push({ ...folder, level, depth, siblings });
      items = folder.items;
    }
    explorerPath = resolved.map((item) => ({
      levelId: item.level.id,
      key: item.key,
    }));
    return { resolved, items };
  }

  function explorerFolderButton(folder, level, depth, extraClass = "") {
    const unread = explorerUnreadCount(
      explorerFolderPath(folder, level, depth),
    );
    const style =
      ` style="--lps-folder-color:${escapeHtml(folder.color || "var(--popup-muted)")};` +
      `--lps-explorer-tint:${escapeHtml(folder.tint || "var(--popup-soft-bg)")}"`;
    return (
      `<button type="button" class="lps-explorer-folder${extraClass ? ` ${extraClass}` : ""}" ` +
      `data-explorer-folder data-explorer-depth="${depth}" ` +
      `data-explorer-level="${escapeHtml(level.id)}" ` +
      `data-explorer-key="${escapeHtml(folder.key)}"${style}>` +
      `<span class="lps-explorer-folder-icon"><span class="lps-folder-icon" aria-hidden="true"></span></span>` +
      `<span class="lps-explorer-folder-copy"><strong>${escapeHtml(folder.label)}</strong>` +
      `<small>${escapeHtml(level.label)} · ${fmt(folder.items.length)}건 · ${fmt(sumOf(folder.items))}</small></span>` +
      `<span class="lps-explorer-folder-end">` +
      explorerUnreadBadge(unread) +
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="m9 18 6-6-6-6" /></svg></span></button>`
    );
  }

  function explorerFolderGrid(folders, level, depth, extraClass = "") {
    return (
      `<div class="lps-explorer-folder-grid">` +
      folders
        .map((folder) => explorerFolderButton(folder, level, depth, extraClass))
        .join("") +
      `</div>`
    );
  }

  function explorerBreadcrumb(resolved) {
    const totalUnread = explorerUnreadTotal();
    const crumbs = resolved
      .map((folder, index) => {
        const path = resolved.slice(0, index + 1).map((item) => ({
          levelId: item.level.id,
          key: item.key,
        }));
        return (
          `<span class="lps-explorer-crumb-sep" aria-hidden="true">/</span>` +
          `<button type="button" data-explorer-crumb="${index}"${
            index === resolved.length - 1 ? ' aria-current="page"' : ""
          }>${escapeHtml(folder.label)}${explorerUnreadBadge(
            explorerUnreadCount(path),
            "is-breadcrumb",
          )}</button>`
        );
      })
      .join("");
    return (
      `<nav class="lps-explorer-breadcrumb" aria-label="현재 폴더">` +
      `<button type="button" data-explorer-root${resolved.length ? "" : ' aria-current="page"'}>` +
      `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M3 5h18v14H3z"/><path d="M3 9h18"/></svg>전체${
        resolved.length
          ? explorerUnreadBadge(totalUnread, "is-breadcrumb is-total")
          : ""
      }</button>${crumbs}</nav>`
    );
  }

  function explorerSectionHeading(title, meta = "") {
    return (
      `<div class="lps-explorer-section-heading"><strong>${escapeHtml(title)}</strong>` +
      (meta ? `<small>${escapeHtml(meta)}</small>` : "") +
      `</div>`
    );
  }

  function renderExplorer(rows) {
    const levels = activeGroupLevels();
    if (!levels.length) return plainList(rows);
    const context = groupContext(rows);
    const { resolved, items } = resolveExplorerPath(rows, levels, context);
    const depth = resolved.length;
    const breadcrumb = explorerBreadcrumb(resolved);

    if (!depth) {
      const folders = explorerFolderGroups(rows, levels[0], context);
      const unread = explorerUnreadTotal();
      return (
        `<div class="lps-explorer">${breadcrumb}` +
        (unread
          ? `<span class="lps-a11y" role="status">새 내역 ${fmt(unread)}건이 있습니다.</span>`
          : "") +
        `<section class="lps-explorer-folders" aria-label="${escapeHtml(levels[0].label)} 폴더">` +
        explorerSectionHeading(
          `${levels[0].label} 폴더`,
          `${fmt(folders.length)}개${unread ? ` · 새 내역 ${fmt(unread)}건` : ""}`,
        ) +
        explorerFolderGrid(folders, levels[0], 0) +
        `</section></div>`
      );
    }

    const current = resolved[depth - 1];
    const nextLevel = levels[depth];
    const childFolders = nextLevel
      ? explorerFolderGroups(items, nextLevel, context)
      : [];
    const otherFolders = current.siblings.filter(
      (folder) => folder.key !== current.key,
    );
    const currentStyle =
      ` style="--lps-folder-color:${escapeHtml(current.color || "var(--popup-muted)")};` +
      `--lps-explorer-tint:${escapeHtml(current.tint || "var(--popup-soft-bg)")}"`;
    const contents = nextLevel
      ? explorerSectionHeading(
          `${nextLevel.label} 폴더`,
          `${fmt(childFolders.length)}개`,
        ) + explorerFolderGrid(childFolders, nextLevel, depth)
      : `<div class="lps-explorer-files">${plainList(items)}</div>`;
    const others = otherFolders.length
      ? `<section class="lps-explorer-others" aria-label="다른 ${escapeHtml(current.level.label)} 폴더">` +
        explorerSectionHeading(
          `다른 ${current.level.label} 폴더`,
          `${fmt(otherFolders.length)}개`,
        ) +
        explorerFolderGrid(
          otherFolders,
          current.level,
          current.depth,
          "is-sibling",
        ) +
        `</section>`
      : "";

    return (
      `<div class="lps-explorer">${breadcrumb}` +
      `<section class="lps-explorer-open" aria-label="열린 폴더"${currentStyle}>` +
      `<header class="lps-explorer-open-head">` +
      `<button type="button" class="lps-explorer-up" data-explorer-up ` +
      `aria-label="상위 폴더로 이동" title="상위 폴더로 이동">` +
      `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="m15 18-6-6 6-6"/></svg></button>` +
      `<span class="lps-folder-icon is-open" aria-hidden="true"></span>` +
      `<span class="lps-explorer-open-copy"><small>${escapeHtml(current.level.label)} 폴더</small>` +
      `<strong>${escapeHtml(current.label)}</strong></span>` +
      `<span class="lps-explorer-open-meta">${fmt(items.length)}건 · ${fmt(sumOf(items))}</span>` +
      `</header><div class="lps-explorer-open-body">${contents}</div></section>` +
      others +
      `</div>`
    );
  }

  // 예측 상세는 펼칠 때 채운다(접힌 채로 두면 막대가 DOM 에 쌓인다).
  function bindPredToggles(root) {
    root.querySelectorAll("details.lps-pred[data-pred-for]").forEach((el) => {
      el.addEventListener("toggle", () => {
        if (!el.open) return;
        const ul = el.querySelector(".lps-pred-list");
        if (!ul || ul.dataset.filled === "1") return;
        const hit = entries.find((x) => String(x?.id) === el.dataset.predFor);
        if (!hit) return;
        ul.innerHTML = predictionRowsHtml(hit);
        ul.dataset.filled = "1";
        const hist = betHistoryHtml(hit);
        if (hist) ul.insertAdjacentHTML("afterend", hist);
      });
    });
  }

  // 접힘 상태 기억(다시 그려도 유지된다).
  function bindGroupToggles(root) {
    root.querySelectorAll("details[data-group-key]").forEach((el) => {
      el.addEventListener("toggle", () => {
        const k = el.dataset.groupKey;
        if (el.open) collapsed.delete(k);
        else collapsed.add(k);
        updateGroupCollapseControls(root);
      });
    });
    root.querySelectorAll("[data-subgroup-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.groupKey;
        const content = button.nextElementSibling;
        const open = button.getAttribute("aria-expanded") !== "true";
        button.setAttribute("aria-expanded", String(open));
        if (content?.classList.contains("lps-subgroup-content")) {
          content.hidden = !open;
        }
        if (open) collapsed.delete(key);
        else collapsed.add(key);
        updateGroupCollapseControls(root);
      });
    });
  }

  function groupToggleStates(root = document.getElementById("lpsBody")) {
    if (!root) return [];
    return [
      ...[...root.querySelectorAll("details[data-group-key]")].map((el) => ({
        key: el.dataset.groupKey,
        open: el.open,
        apply(open) {
          el.open = open;
        },
      })),
      ...[...root.querySelectorAll("[data-subgroup-toggle]")].map((button) => ({
        key: button.dataset.groupKey,
        open: button.getAttribute("aria-expanded") === "true",
        apply(open) {
          button.setAttribute("aria-expanded", String(open));
          const content = button.nextElementSibling;
          if (content?.classList.contains("lps-subgroup-content")) {
            content.hidden = !open;
          }
        },
      })),
    ];
  }

  function updateGroupCollapseControls(root) {
    const states = groupToggleStates(root);
    const expand = document.querySelector("[data-groups-expand-all]");
    const collapse = document.querySelector("[data-groups-collapse-all]");
    if (expand)
      expand.disabled = !states.length || states.every((it) => it.open);
    if (collapse) {
      collapse.disabled = !states.length || states.every((it) => !it.open);
    }
  }

  function setAllGroupsExpanded(open) {
    const root = document.getElementById("lpsBody");
    const states = groupToggleStates(root);
    for (const state of states) {
      state.apply(open);
      if (open) collapsed.delete(state.key);
      else collapsed.add(state.key);
    }
    updateGroupCollapseControls(root);
  }

  // ── 채널 선택(자동완성) ────────────────────────────────────────────────────
  // ⚠ 채널명을 문자열로만 받으면 기존 집계와 합쳐지지 않는다. 집계는 channelId
  //   우선으로 묶이므로 후보에서 골라 id 까지 저장해야 한다.
  const SEARCH_URL = "https://api.chzzk.naver.com/service/v1/search/channels";
  let picked = null; // {channelId, channelName, channelImageUrl, verifiedMark}
  let searchSeq = 0;
  let channelChoices = [];

  // 이미 내역에 있는 채널을 먼저 보여 준다(대부분 여기서 끝난다 + 오프라인 동작).
  function localChannelMatches(q) {
    const key = q.trim().toLowerCase();
    const seen = new Set();
    const out = [];
    for (const e of entries) {
      if (!e.channelName || seen.has(e.channelId || e.channelName)) continue;
      if (key && !e.channelName.toLowerCase().includes(key)) continue;
      seen.add(e.channelId || e.channelName);
      out.push({
        channelId: e.channelId,
        channelName: e.channelName,
        channelImageUrl: e.channelImageUrl,
        verifiedMark: e.verifiedMark,
        local: true,
      });
      if (out.length >= 8) break;
    }
    return out;
  }

  async function searchChannels(q) {
    try {
      const url = new URL(SEARCH_URL);
      url.searchParams.set("keyword", q);
      url.searchParams.set("offset", "0");
      url.searchParams.set("size", "10");
      const res = await fetch(url, {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
      });
      if (!res.ok) return [];
      const rows = (await res.json())?.content?.data;
      if (!Array.isArray(rows)) return [];
      return rows
        .map((it) => it?.channel)
        .filter((c) => c && String(c.channelId || "").trim())
        .map((c) => ({
          channelId: String(c.channelId).trim(),
          channelName: String(c.channelName || "").trim(),
          channelImageUrl: String(c.channelImageUrl || "").trim(),
          verifiedMark: c.verifiedMark === true,
        }));
    } catch {
      return [];
    }
  }

  function renderChannelList(items) {
    const list = document.getElementById("lpsChannelList");
    const input = document.getElementById("lpsFieldName");
    if (!list) return;
    if (!items.length) {
      list.hidden = true;
      list.innerHTML = "";
      input?.setAttribute("aria-expanded", "false");
      return;
    }
    list.innerHTML = items
      .map(
        (c, i) =>
          `<li role="option" data-ch-index="${i}" tabindex="-1">` +
          (c.channelImageUrl
            ? `<img src="${escapeHtml(c.channelImageUrl)}" alt="" width="24" height="24" loading="lazy">`
            : `<span class="lps-ch-blank" aria-hidden="true"></span>`) +
          `<b>${escapeHtml(c.channelName || "채널")}</b>` +
          (c.local ? `<em>내역</em>` : "") +
          `</li>`,
      )
      .join("");
    list.hidden = false;
    input?.setAttribute("aria-expanded", "true");
    channelChoices = items;
  }

  function setPicked(c) {
    picked = c || null;
    const box = document.getElementById("lpsChannelPicked");
    const input = document.getElementById("lpsFieldName");
    if (!box) return;
    if (!picked) {
      box.hidden = true;
      return;
    }
    const img = document.getElementById("lpsChannelPickedImg");
    if (img) {
      img.src = picked.channelImageUrl || "";
      img.hidden = !picked.channelImageUrl;
    }
    document.getElementById("lpsChannelPickedName").textContent =
      picked.channelName || "채널";
    box.hidden = false;
    if (input) input.value = "";
    renderChannelList([]);

    // 구독 티어를 확인해 시청 보상 단가에 부스팅을 반영한다.
    const id = picked.channelId;
    if (!id) {
      pickedTier = 0;
      showTierNote();
      return;
    }
    // 저장이 이 조회를 기다릴 수 있게 약속을 들고 있는다(티어 미확정 저장 방지).
    tierPending = fetchTier(id).then((tier) => {
      if (picked?.channelId !== id) return; // 그새 다른 채널을 골랐다
      pickedTier = tier;
      showTierNote();
      // 이미 고른 종류가 시청 보상이면 배수를 반영해 다시 채운다.
      // ⚠ 수정 중에는 건드리지 않는다. 저장된 금액(예: 5분 시청 48 = 12×4회)을
      //   단가로 덮어써 기존 값이 사라진다(제보).
      if (!editingId && isWatchClaim(currentType())) {
        spinWrite($f("lpsFieldAmount"), unitFor(currentType()));
        if (currentType() === "WATCH_1_HOUR") {
          spinWrite($f("lpsFieldFive"), unitFor("WATCH_5_MIN") * 12);
        }
      }
    });
  }

  // 부스팅이 걸렸음을 알려 준다(값이 왜 100 이 아닌지 보이게).
  function showTierNote() {
    const el = document.getElementById("lpsTierNote");
    if (!el) return;
    const boost = TIER_BOOST[pickedTier];
    const on = pickedTier > 0 && boost > 1;
    el.hidden = !on;
    if (on) el.textContent = `티어 ${pickedTier} 구독 — 시청 보상 ×${boost}`;
  }

  async function onChannelInput(q) {
    const seq = ++searchSeq;
    const local = localChannelMatches(q);
    renderChannelList(local);
    if (q.trim().length < 2) return;
    const remote = await searchChannels(q.trim());
    if (seq !== searchSeq) return; // 더 최근 입력이 있다 → 이 결과는 버린다
    // 내역에 이미 있는 채널은 중복으로 넣지 않는다.
    const have = new Set(local.map((c) => c.channelId).filter(Boolean));
    renderChannelList([
      ...local,
      ...remote.filter((c) => !have.has(c.channelId)),
    ]);
  }

  // ── 우하단 FAB ─────────────────────────────────────────────────────────────
  // '맨 위로'는 어느 정도 내려갔을 때, '직접 추가'는 원본 버튼이 화면 밖으로
  // 나갔을 때만 띄운다(둘 다 보이면 같은 기능이 두 개라 헷갈린다).
  const FAB_TOP_MIN = 400; // 이만큼 내려가야 '맨 위로'가 나온다

  // 숨김은 즉시 display:none 이 아니라 흐려진 뒤 클릭만 막는다(전환용).
  function setFabShown(el, shown) {
    if (!el) return;
    el.hidden = false; // 초기 hidden 속성을 걷어낸다(이후엔 클래스로만 제어)
    el.classList.toggle("is-shown", shown);
    // ⚠ aria-hidden 을 쓰면 안 된다. '맨 위로'를 누른 뒤 스크롤이 0 이 되면
    //   포커스를 가진 채로 숨겨지는데, 브라우저가 그 조합을 차단한다(제보).
    //   inert 는 포커스까지 막고 접근성 트리에서도 빼며, 안에 포커스가 있으면
    //   알아서 해제한다 — 경고문이 직접 권하는 속성이다.
    if (shown) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
    // inert 미지원 브라우저(Chrome 102 미만) 폴백: Tab 으로 못 닿게 한다.
    // ⚠ 포커스를 가진 채로 -1 을 주면 포커스가 남으므로 먼저 놓아 준다.
    if (!shown && document.activeElement === el) el.blur();
    el.tabIndex = shown ? 0 : -1;
  }

  function updateFabs() {
    const top = document.getElementById("lpsFabTop");
    const add = document.getElementById("lpsFabAdd");
    const scrolled = window.scrollY || document.documentElement.scrollTop || 0;
    // ⚠ hidden 을 토글하면 display 가 즉시 바뀌어 전환이 안 먹는다.
    //   클래스로 표시 여부를 정하고 CSS 가 흐림/이동을 맡는다.
    setFabShown(top, scrolled >= FAB_TOP_MIN);
    if (add) {
      const src = document.getElementById("lpsAdd");
      // 원본 버튼이 뷰포트 안에 조금이라도 걸쳐 있으면 FAB 는 숨긴다.
      const r = src?.getBoundingClientRect();
      const visible = !!r && r.bottom > 0 && r.top < window.innerHeight;
      setFabShown(add, !visible);
    }
  }

  // 스크롤마다 레이아웃을 재는 건 비싸다 → rAF 로 한 프레임에 한 번만.
  let fabFrame = 0;
  function scheduleFabUpdate() {
    if (fabFrame) return;
    fabFrame = requestAnimationFrame(() => {
      fabFrame = 0;
      updateFabs();
    });
  }

  // ── 차트 확대(라이트박스) ──────────────────────────────────────────────────
  // ⚠ 차트를 새로 만들지 않는다. 같은 canvas 를 두 번 그리면 Chart.js 인스턴스가
  //   충돌하고 색·툴팁 상태도 따로 논다 → 원본 wrap 을 통째로 옮겼다가 닫을 때
  //   제자리(placeholder)로 되돌린다.
  let zoomFor = ""; // "bar" | "line" | ""
  let zoomHome = null; // 원래 자리를 잡아 둘 주석 노드
  let quickHome = null; // 빠른 기간 버튼의 원래 자리

  const chartOf = (which) => (which === "bar" ? barChart : lineChart);

  function openZoom(which) {
    if (zoomFor) closeZoom();
    const wrap = document.querySelector(`[data-chart-wrap="${which}"]`);
    const box = document.getElementById("lpsZoom");
    const body = document.getElementById("lpsZoomBody");
    if (!wrap || !box || !body) return;

    const title = wrap
      .closest(".lps-chart-box")
      ?.querySelector("h2")?.textContent;
    document.getElementById("lpsZoomTitle").textContent = title || "차트";

    // 돌아갈 자리를 표시해 둔다(형제 순서가 바뀌어도 안전하다).
    zoomHome = document.createComment("lps-zoom-home");
    wrap.parentNode.insertBefore(zoomHome, wrap);
    body.appendChild(wrap);
    wrap.classList.add("is-zoomed");

    // 라인 차트는 '빠른 기간 변경'을 같이 쓴다 → 확대 창 머리글로 옮겨 온다.
    // (차트만 크게 띄우면 기간을 바꾸려고 매번 닫아야 한다.)
    const quick = document.querySelector(".lps-line-tools");
    if (which === "line" && quick) {
      quickHome = document.createComment("lps-quick-home");
      quick.parentNode.insertBefore(quickHome, quick);
      document.getElementById("lpsZoomTools")?.appendChild(quick);
    }

    box.hidden = false;
    zoomFor = which;
    // 라인 차트는 확대 여부에 따라 그리는 계열 수가 달라진다 → 다시 그린다.
    // 막대는 계열이 고정이라 크기만 맞추면 된다.
    if (which === "line") renderLineChart();
    else chartOf(which)?.resize();
  }

  function closeZoom() {
    if (!zoomFor) return;
    const wrap = document.querySelector(`[data-chart-wrap="${zoomFor}"]`);
    const box = document.getElementById("lpsZoom");
    if (wrap && zoomHome?.parentNode) {
      wrap.classList.remove("is-zoomed");
      zoomHome.parentNode.insertBefore(wrap, zoomHome);
      zoomHome.remove();
    }
    const quick = document.querySelector(".lps-line-tools");
    if (quick && quickHome?.parentNode) {
      quickHome.parentNode.insertBefore(quick, quickHome);
      quickHome.remove();
    }
    quickHome = null;
    if (box) box.hidden = true;
    const which = zoomFor;
    zoomFor = "";
    zoomHome = null;
    // Chart.js 가 canvas 에 남긴 인라인 크기를 지운다. wrap 쪽 고리는 CSS 에서
    // 끊었지만(height:0), 확대 때 쓰인 큰 값이 남아 있으면 첫 프레임이 어긋난다.
    const canvas = wrap?.querySelector("canvas");
    if (canvas) {
      canvas.style.width = "";
      canvas.style.height = "";
    }
    // 레이아웃이 원래 크기로 다시 잡힌 뒤에 재계산해야 한다.
    requestAnimationFrame(() => {
      if (which === "line")
        renderLineChart(); // 계열 수를 5개로 되돌린다
      else chartOf(which)?.resize();
    });
  }

  // ── 추가/수정 대화상자 ─────────────────────────────────────────────────────
  let editingId = ""; // 빈 문자열이면 '새로 추가'

  const dlg = () => document.getElementById("lpsDialog");
  const $f = (id) => document.getElementById(id);

  function showDialogError(msg) {
    const el = $f("lpsDialogError");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  // 종류 팝오버(커스텀). select 대신 목록에서 고른 값을 여기에 들고 있는다.
  let typeChoice = "WATCH_1_HOUR";

  // 구독 티어 → 시청 보상 배수(claim-list 의 BOOSTING_* 실측).
  const TIER_BOOST = { 0: 1, 1: 1.2, 2: 2 };
  const SUBSCRIBE_URL =
    "https://api.chzzk.naver.com/commercial/v1/subscribe/channels";
  // 고른 채널의 구독 티어(0 = 미구독). 채널을 고를 때 갱신한다.
  let pickedTier = 0;
  let tierPending = null; // 진행 중인 티어 조회

  // ⚠ 부스팅은 시청 보상(5분·1시간)에만 붙는다. 팔로우·후원·구독선물은 정액이다.
  async function fetchTier(channelId) {
    if (!channelId) return 0;
    try {
      const res = await fetch(SUBSCRIBE_URL, { credentials: "include" });
      if (!res.ok) return 0;
      const list = (await res.json())?.content;
      if (!Array.isArray(list)) return 0;
      const item = list.find((x) => String(x?.channelId) === String(channelId));
      if (!item) return 0;
      const n = Number(item.tierNo);
      return Number.isFinite(n)
        ? n
        : Number(String(item.tier || "").match(/TIER_(\d+)/i)?.[1] || 0);
    } catch {
      return 0;
    }
  }

  // 종류별 기본 획득량(claim-list 실측 단가, 모든 채널 동일).
  // 시청 보상만 구독 티어 배수를 곱해 실제 지급액에 맞춘다.
  const TYPE_AMOUNTS = {
    WATCH_1_HOUR: 100,
    WATCH_5_MIN: 10,
    FOLLOW: 300,
    DONATE: 20,
    DONATE_MONTHLY: 300,
    SUBSCRIPTION_GIFT: 50,
    SUBSCRIPTION_GIFT_MONTHLY: 500,
  };

  // 일 한도(claim-list caption 실측). 월별 보너스에는 한도 표기가 없고, 실제로도
  // 월 첫 후원 시 +320(20+300)이 한 번에 들어와 한도를 넘는다 → 한도 대상이 아니다.
  const DAILY_CAPS = { DONATE: 100, SUBSCRIPTION_GIFT: 250 };
  // 월 1회만 받을 수 있는 유형.
  const MONTHLY_ONCE = new Set(["DONATE_MONTHLY", "SUBSCRIPTION_GIFT_MONTHLY"]);

  const sameDay = (a, b) => dateKey(new Date(a)) === dateKey(new Date(b));
  const sameMonth = (a, b) => {
    const x = new Date(a);
    const y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
  };

  // 수동 추가/수정이 실제 규칙을 넘지 않는지 확인한다. 넘으면 안내 문구를 돌려준다.
  // ⚠ 한도는 채널별로 본다(claim-list 가 채널마다 같은 값을 내려준다).
  function capViolation(type, amount, at, selfId, channelId) {
    if (MONTHLY_ONCE.has(type)) {
      const dup = entries.find(
        (e) =>
          e.id !== selfId &&
          e.claimType === type &&
          e.channelId === channelId &&
          sameMonth(e.at, at),
      );
      if (!dup) return "";
      const label = CLAIM_LABELS[type] || type;
      return `${label}은 한 달에 한 번만 받을 수 있습니다. 이미 이번 달에 기록이 있습니다.`;
    }

    const cap = DAILY_CAPS[type];
    if (!cap) return "";
    const used = entries
      .filter(
        (e) =>
          e.id !== selfId &&
          e.claimType === type &&
          e.channelId === channelId &&
          sameDay(e.at, at),
      )
      .reduce((n, e) => n + (Number(e.amount) || 0), 0);
    if (used + amount <= cap) return "";
    const label = CLAIM_LABELS[type] || type;
    const left = Math.max(0, cap - used);
    return left
      ? `${label}은 하루 최대 ${fmt(cap)}입니다. 이 날은 ${fmt(left)}까지만 추가할 수 있습니다(이미 ${fmt(used)}).`
      : `${label}은 하루 최대 ${fmt(cap)}입니다. 이 날은 이미 한도를 채웠습니다.`;
  }

  function typeLabelOf(value) {
    const li = document.querySelector(`#lpsTypeList [data-type="${value}"]`);
    return li ? li.textContent.trim() : value;
  }

  // 구독 배수를 정한다. 시청 보상에만 붙는다.
  //
  // ⚠ 금액에서 역산하면 안 된다. 5분 시청은 여러 회차의 합이라(20분 = 4회)
  //   티어1 이면 48, 티어2 면 80 이 되어 단가로 나눈 값이 4.8·8 이 된다.
  //   게다가 합계는 티어끼리 겹친다(20 = 1배×2회 = 2배×1회) → 판별 불가.
  //   → 채널의 실제 구독 티어(pickedTier)를 쓴다. 아직 조회 전이면 기존 값 유지.
  function boostOf(type, prevBoost) {
    if (!isWatchClaim(type)) return 1;
    if (pickedTier > 0) return TIER_BOOST[pickedTier] || 1;
    // 티어 조회가 끝나지 않았을 때: 이미 기록돼 있던 배수를 존중한다.
    const prev = Number(prevBoost);
    return [1.2, 2].includes(prev) ? prev : 1;
  }

  // 티어 배수를 반영한 단가. 시청 보상만 곱한다.
  function unitFor(type) {
    const base = TYPE_AMOUNTS[type];
    if (!base) return 0;
    if (!isWatchClaim(type)) return base;
    return Math.round(base * (TIER_BOOST[pickedTier] || 1));
  }

  // fill=true 면 그 종류의 기본 단가를 획득량에 채운다(사용자가 고른 순간에만).
  function setTypeChoice(value, { fill = false } = {}) {
    typeChoice = value;
    const label = document.querySelector("[data-type-label]");
    if (label) label.textContent = typeLabelOf(value);
    document.querySelectorAll("#lpsTypeList [data-type]").forEach((li) => {
      li.setAttribute("aria-selected", String(li.dataset.type === value));
    });
    if (fill && TYPE_AMOUNTS[value]) {
      spinWrite($f("lpsFieldAmount"), unitFor(value));
      // 1시간 시청은 그 사이 5분 보상 12회도 함께 받은 것이라 같이 채운다.
      if (value === "WATCH_1_HOUR") {
        spinWrite($f("lpsFieldFive"), unitFor("WATCH_5_MIN") * 12);
      } else if (isWatchClaim(value)) {
        spinWrite($f("lpsFieldFive"), 0);
      }
    }
    syncFiveVisibility();
  }

  function closeTypeList() {
    const list = document.getElementById("lpsTypeList");
    if (list) list.hidden = true;
    document
      .getElementById("lpsTypeButton")
      ?.setAttribute("aria-expanded", "false");
  }

  // 현재 고른 종류(직접 입력이면 그 값). 저장·표시 모두 이 값을 쓴다.
  function currentType() {
    if (typeChoice !== "__custom") return typeChoice;
    return String($f("lpsFieldTypeCustom")?.value || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
  }

  // ── 숫자 스피너 ────────────────────────────────────────────────────────────
  // type=number 의 기본 화살표는 브라우저마다 모양이 달라 통일이 안 된다.
  // text + 직접 만든 버튼으로 바꾸고, 값 정규화도 여기서 한다.
  function spinRead(input) {
    const n = parseInt(String(input.value).replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function spinWrite(input, n) {
    const min = input.dataset.spinMin ? Number(input.dataset.spinMin) : null;
    const max = input.dataset.spinMax ? Number(input.dataset.spinMax) : null;
    let v = n;
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    const pad = Number(input.dataset.spinPad || 0);
    input.value = pad ? String(v).padStart(pad, "0") : String(v);
    updateSpinDisabled(input);
  }

  // 한계에 닿으면 해당 버튼을 비활성화한다(참고 마크업의 disabled 동작).
  function updateSpinDisabled(input) {
    const wrap = input.closest(".lps-spin");
    if (!wrap) return;
    const n = spinRead(input);
    const min = input.dataset.spinMin ? Number(input.dataset.spinMin) : null;
    const max = input.dataset.spinMax ? Number(input.dataset.spinMax) : null;
    const up = wrap.querySelector('[data-spin="up"]');
    const down = wrap.querySelector('[data-spin="down"]');
    if (up) up.disabled = n != null && max != null && n >= max;
    if (down) down.disabled = n != null && min != null && n <= min;
  }

  function spinStep(id, dir) {
    const input = document.getElementById(id);
    if (!input) return;
    const cur = spinRead(input);
    const min = input.dataset.spinMin ? Number(input.dataset.spinMin) : 0;
    spinWrite(input, cur == null ? min : cur + dir);
  }

  // 시청 보상일 때만 '5분 합계'가 의미 있다. '직접 입력'이면 이름 칸을 연다.
  // 손실 종류면 음수 입력을 허용한다(기본은 1 이상이라 음수가 막혔다 — 제보).
  function syncAmountSign() {
    const el = $f("lpsFieldAmount");
    if (!el) return;
    const loss = isLossClaim(currentType());
    el.dataset.spinMin = loss ? "-99999999" : "1";
    const cur = spinRead(el);
    // 종류를 바꿨는데 부호가 안 맞으면 뒤집어 준다(값 자체는 유지).
    if (cur != null && cur !== 0) {
      if (loss && cur > 0) spinWrite(el, -cur);
      else if (!loss && cur < 0) spinWrite(el, -cur);
      else updateSpinDisabled(el);
    }
  }

  function syncFiveVisibility() {
    const customRow = $f("lpsFieldTypeCustomRow");
    if (customRow) customRow.hidden = typeChoice !== "__custom";
    const row = $f("lpsFieldFiveRow");
    // 5분 합계는 1시간 보상에만 딸린 값이다(5분 기록 자체에는 없다).
    if (row) row.hidden = !isHourClaim(currentType());
    syncAmountSign();
  }

  function openDialog(entry) {
    const box = dlg();
    if (!box) return;
    editingId = entry?.id || "";
    pickedTier = 0;
    tierPending = null;
    showTierNote();
    $f("lpsDialogTitle").textContent = editingId ? "적립 수정" : "적립 추가";
    $f("lpsFieldName").value = "";
    renderChannelList([]);
    setPicked(
      entry
        ? {
            channelId: entry.channelId,
            channelName: entry.channelName,
            channelImageUrl: entry.channelImageUrl,
            verifiedMark: entry.verifiedMark,
          }
        : null,
    );
    // 목록에 없는 종류(직접 입력분)면 '직접 입력'으로 열어 값을 채운다.
    const type = entry?.claimType || "WATCH_1_HOUR";
    const known = !!document.querySelector(
      `#lpsTypeList [data-type="${type}"]`,
    );
    $f("lpsFieldTypeCustom").value = known ? "" : type;
    setTypeChoice(known ? type : "__custom");
    closeTypeList();

    // 새로 추가할 때는 고른 종류의 기본 단가로 시작한다(수정이면 저장값 유지).
    spinWrite(
      $f("lpsFieldAmount"),
      entry?.amount || TYPE_AMOUNTS[typeChoice] || 1,
    );
    spinWrite(
      $f("lpsFieldFive"),
      entry?.fiveMinAmount ??
        (typeChoice === "WATCH_1_HOUR" ? TYPE_AMOUNTS.WATCH_5_MIN * 12 : 0),
    );

    // 날짜는 달력 피커, 시·분은 스피너가 나눠 들고 있다.
    const when = new Date(entry?.at || Date.now());
    pickerValues.at = dateKey(when);
    pickerMonths.at = monthStart(when);
    renderPicker("at");
    spinWrite($f("lpsFieldHour"), when.getHours());
    spinWrite($f("lpsFieldMinute"), when.getMinutes());
    spinWrite($f("lpsFieldSecond"), when.getSeconds());
    $f("lpsDialogDelete").hidden = !editingId;
    showDialogError("");
    syncFiveVisibility();
    box.hidden = false;
    $f("lpsFieldName").focus();
  }

  function closeDialog() {
    const box = dlg();
    if (box) box.hidden = true;
    editingId = "";
  }

  async function saveDialog() {
    // 후보에서 고른 채널이 우선. 못 골랐으면 입력한 문자열이라도 쓴다(id 없음).
    const typedName = String($f("lpsFieldName").value || "").trim();
    const name = picked?.channelName || typedName;
    const type = currentType();
    const amount = spinRead($f("lpsFieldAmount"));
    const five = isHourClaim(type) ? spinRead($f("lpsFieldFive")) || 0 : 0;
    if (!name) return showDialogError("채널을 선택하거나 입력해 주세요.");
    // ⚠ 후보에서 고르지 않으면 channelId 가 없어 기존 집계와 따로 논다.
    //   같은 이름이 내역에 이미 있으면 그 id 를 물려받아 합쳐지게 한다.
    if (!picked && !editingId) {
      const known = entries.find((e) => e.channelName === name && e.channelId);
      if (known) {
        picked = {
          channelId: known.channelId,
          channelName: known.channelName,
          channelImageUrl: known.channelImageUrl,
          verifiedMark: known.verifiedMark,
        };
      }
    }
    if (!type) return showDialogError("종류 이름을 입력해 주세요.");
    // 손실 종류(예측 베팅·기타 사용)는 음수여야 한다. 0 만 언제나 막는다.
    if (!Number.isFinite(amount) || amount === 0) {
      return showDialogError("획득량을 입력해 주세요(0은 저장할 수 없습니다).");
    }
    if (isLossClaim(type) && amount > 0) {
      return showDialogError(
        `${CLAIM_LABELS[type] || type}은 차감이라 음수로 입력해 주세요.`,
      );
    }
    if (!isLossClaim(type) && amount < 0) {
      return showDialogError("이 종류는 0보다 큰 값이어야 합니다.");
    }
    // 날짜(달력) + 시·분(스피너)을 합쳐 로컬 시각으로 만든다.
    const hh = spinRead($f("lpsFieldHour")) ?? 0;
    const mm = spinRead($f("lpsFieldMinute")) ?? 0;
    const ss = spinRead($f("lpsFieldSecond")) ?? 0;
    const at = pickerValues.at
      ? +new Date(`${pickerValues.at}T00:00:00`) +
        (hh * 3600 + mm * 60 + ss) * 1000
      : NaN;
    if (!Number.isFinite(at)) return showDialogError("날짜를 선택해 주세요.");

    // 티어 조회가 진행 중이면 끝날 때까지 기다린다(부스팅 배지 누락 방지).
    if (tierPending) await tierPending.catch(() => {});

    // 기존 항목이면 채널 정보(프로필·인증)를 보존한다.
    const prev = entries.find((e) => e.id === editingId);

    // ⚠ 치지직이 막는 값은 우리도 막는다. 하루 한도를 넘거나 월 1회 보너스를
    //   두 번 넣으면 내역이 실제와 어긋난다.
    const violation = capViolation(
      type,
      Math.round(amount),
      at,
      editingId,
      picked?.channelId || prev?.channelId || "",
    );
    if (violation) return showDialogError(violation);

    const ok = await upsertEntry({
      id: editingId || `${MANUAL_PREFIX}${Date.now()}`,
      at,
      // ⚠ channelId 가 있어야 기존 집계·차트에서 같은 채널로 묶인다.
      channelId: picked?.channelId || prev?.channelId || "",
      channelName: name.slice(0, 100),
      channelImageUrl: picked?.channelImageUrl || prev?.channelImageUrl || "",
      verifiedMark: (picked?.verifiedMark ?? prev?.verifiedMark) === true,
      amount: Math.round(amount),
      fiveMinAmount: Math.round(five),
      // ⚠ 부스팅은 시청 보상에만 붙는다. 종류를 바꿔 저장하면 예전 값(기타=1)이
      //   그대로 남아 배지가 안 뜬다(제보).
      //   티어 상태(pickedTier)는 조회가 늦으면 아직 0 일 수 있으므로, 실제로
      //   저장하는 금액에서 역산한다 — 배지와 숫자가 항상 서로 맞는다.
      boost: boostOf(type, prev?.boost),
      claimType: type,
      // ⚠ 5분 묶음의 회차 수는 금액에서 다시 센다. 그대로 두면 금액만 고쳤을 때
      //   예전 회차가 남아 '+60 인데 12회'처럼 어긋난다(제보).
      //   단가로 안 나눠떨어지면(임의 입력) 회차를 지운다.
      watchCount: watchCountFor(
        type,
        Math.round(amount),
        boostOf(type, prev?.boost),
      ),
    });
    if (!ok) return showDialogError("저장하지 못했습니다.");
    closeDialog();
  }

  async function removeCurrent() {
    if (!editingId) return;
    await deleteEntry(editingId);
    closeDialog();
  }

  // ── 커스텀 데이트 피커 ─────────────────────────────────────────────────────
  // popup.html 의 달력 마크업·CSS(popup-calendar-*)를 그대로 쓰되, 로직은 여기서
  // 자체 구현한다. popup.js 쪽은 elements.dateFrom/dateTo 전역에 묶여 있어 재사용이
  // 불가능하다(그 파일은 검색 팝업 전용 상태를 참조한다).
  const pickerMonths = {
    from: monthStart(new Date()),
    to: monthStart(new Date()),
    at: monthStart(new Date()), // 추가/수정 대화상자의 '획득 시각'
  };
  const pickerValues = { from: "", to: "", at: "" };

  function monthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function dateKey(d) {
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function calendarDates(month) {
    const first = monthStart(month);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }

  function renderPicker(key) {
    const root = document.querySelector(`[data-date-picker="${key}"]`);
    if (!root) return;
    const month = pickerMonths[key];
    const title = root.querySelector("[data-calendar-title]");
    const grid = root.querySelector("[data-calendar-grid]");
    const label = root.querySelector(`[data-date-label="${key}"]`);
    if (label) {
      label.textContent =
        pickerValues[key] || (key === "at" ? "날짜 선택" : "선택 안 함");
    }
    if (title) {
      title.textContent = new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
      }).format(month);
    }
    if (!grid) return;
    const today = dateKey(new Date());
    grid.innerHTML = calendarDates(month)
      .map((d) => {
        const k = dateKey(d);
        const cls = [
          "popup-calendar-day",
          d.getMonth() !== month.getMonth() ? "is-outside" : "",
          k === today ? "is-today" : "",
          k === pickerValues[key] ? "is-selected" : "",
          // 시작~종료 사이는 범위로 표시(양쪽이 다 정해졌을 때만).
          // 'at' 은 단일 날짜라 범위 표시가 없다.
          key !== "at" &&
          pickerValues.from &&
          pickerValues.to &&
          k > pickerValues.from &&
          k < pickerValues.to
            ? "is-range"
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<button type="button" class="${cls}" data-date="${k}">${d.getDate()}</button>`;
      })
      .join("");
  }

  // 빠른 기간 선택. 검색 팝업(popup.js applyRangePreset)과 같은 기준으로 맞춘다.
  function applyRangePreset(preset) {
    const today = new Date();
    const start = new Date(today);
    if (preset === "week") start.setDate(today.getDate() - 7);
    else if (preset === "month1") start.setMonth(today.getMonth() - 1);
    else if (preset === "month3") start.setMonth(today.getMonth() - 3);
    else if (preset === "month6") start.setMonth(today.getMonth() - 6);
    else if (preset === "year1") start.setFullYear(today.getFullYear() - 1);
    else return;
    pickerValues.from = dateKey(start);
    pickerValues.to = dateKey(today);
    pickerMonths.from = monthStart(start);
    pickerMonths.to = monthStart(today);
  }

  function closePickers(except) {
    document.querySelectorAll("[data-date-picker]").forEach((root) => {
      if (root === except) return;
      root.querySelector(".popup-calendar")?.setAttribute("hidden", "");
      root
        .querySelector("[data-action='date-toggle']")
        ?.setAttribute("aria-expanded", "false");
    });
  }

  // 선택값 → 필터 범위(ms). 종료일은 그날 끝까지 포함해야 직관에 맞는다.
  function syncRangeFromPickers() {
    fromMs = pickerValues.from ? +new Date(`${pickerValues.from}T00:00:00`) : 0;
    toMs = pickerValues.to ? +new Date(`${pickerValues.to}T23:59:59.999`) : 0;
  }

  // ── 테마 토글 ──────────────────────────────────────────────────────────────
  // themeInit.js 가 localStorage 의 cheeseSearchTheme 로 초기 테마를 정한다.
  // 같은 키를 쓰면 설정·검색 팝업과 테마가 함께 움직인다.
  const THEME_KEY = "cheeseSearchTheme";

  function paintThemeButton() {
    const btn = document.getElementById("lpsTheme");
    if (!btn) return;
    const dark = document.documentElement.dataset.theme === "dark";
    btn.innerHTML = dark
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
    btn.title = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
  }

  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    try {
      window.Coloris?.({
        el: "[data-color-for]",
        parent: document.body,
        theme: "default",
        themeMode:
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        format: "hex",
        alpha: false,
        selectInput: true,
        closeLabel: "색상 선택 완료",
      });
    } catch {}

    // 색을 고르면 저장하고 즉시 다시 그린다.
    document.addEventListener("change", (e) => {
      const input = e.target.closest?.("[data-color-for]");
      if (!input) return;
      const name = input.dataset.colorFor;
      const value = String(input.value || "").trim();
      if (!name) return;
      channelColors.set(name, value);
      saveChannelColorPrefs();
      // 색은 두 차트가 공유하므로 함께 다시 그린다.
      renderBarChart();
      renderLineChart();
    });

    paintThemeButton();
  }

  // ── 차트 ───────────────────────────────────────────────────────────────────
  const BALANCES_URL =
    "https://api.chzzk.naver.com/service/v1/log-power/balances";
  const API_CHANNELS = "https://api.chzzk.naver.com/service/v1/channels";
  const TOP_N = 10;
  let balances = null; // null = 아직/실패, [] = 정상 조회했으나 비어 있음
  // 채널명 → 선 색. 사용자가 직접 고르거나 프로필에서 추출한 값을 저장한다.
  // 비어 있으면 기본 팔레트를 쓴다.
  const COLOR_KEY = "cheeseLogPowerChartColors";
  const channelColors = new Map();

  async function loadChannelColorPrefs() {
    try {
      const data = await chrome.storage.local.get(COLOR_KEY);
      const obj = data?.[COLOR_KEY];
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" && v) channelColors.set(k, v);
        }
      }
    } catch {}
  }

  function saveChannelColorPrefs() {
    try {
      chrome.storage.local.set({
        [COLOR_KEY]: Object.fromEntries(
          [...channelColors.entries()].filter(([, v]) => v),
        ),
      });
    } catch {}
  }
  let barChart = null;
  let lineChart = null;

  const css = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback;

  // ── 확장 밖 변동('기타') ───────────────────────────────────────────────────
  // 다른 PC·모바일에서 적립하거나, 1시간을 못 채우고 나가 5분 보상만 받은 경우는
  // 우리가 관측하지 못한다. 그렇다고 '보유량 − 우리기록' 을 통째로 쓰면 확장 설치
  // 전 보유분과 보관 기간이 지나 지워진 기록까지 섞여 기타만 거대해진다.
  //   → 스냅샷을 남기고 '그 이후의 변화'만 본다.
  //       기타 = (현재 보유 − 스냅샷 보유) − 그 사이 우리가 기록한 적립
  const SNAP_KEY = "cheeseLogPowerBalanceSnapshot";
  // 반올림·표시 지연으로 생기는 미세 차이는 무시한다.
  const SNAP_NOISE = 5;

  // background 가 누적 중인 5분 보상(아직 내역에 없다).
  // ⚠ flush 전에는 보유량만 올라 있고 기록이 없어, 보유량 맞추기가 그 분량을
  //   '설명되지 않는 변동'으로 보고 기타 적립에 넣었다(제보: 기타 +72 가
  //   5분 시청 +72 와 중복). 차액에서 빼 준다.
  const RUN_KEY = "cheeseLogPowerFiveMinRun";

  async function pendingRun() {
    try {
      const v = (await chrome.storage.local.get(RUN_KEY))?.[RUN_KEY];
      if (v && typeof v === "object" && v.curr && Number(v.amount) > 0) {
        return { channelId: String(v.curr), amount: Number(v.amount) };
      }
    } catch {}
    return null;
  }

  async function loadSnapshot() {
    try {
      const v = (await chrome.storage.local.get(SNAP_KEY))?.[SNAP_KEY];
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  }

  // 적립이 끝난 뒤에도 잠깐은 제외해 둔다. 마지막 5분 보상이 들어온 직후 방송이
  // 끝나면 우리 기록보다 보유량이 먼저 오르는데, 그 틈에 비교하면 정상 시청 보상이
  // 기타로 잡힌다(제보).
  const SNAP_SETTLE_MS = 10 * 60 * 1000;

  // ⚠ 적립이 진행 중인 채널은 스냅샷에서 제외한다. 5분 보상이 들어오는 도중이거나
  //   1시간 타이머가 도는 채널은 '곧 우리가 기록할' 분량이라, 지금 찍어 두면
  //   다음 비교에서 기타로 오인된다.
  // ⚠ 단 '키가 있다'만으로 제외하면 안 된다. 다른 채널로 옮기면 이전 채널의 state 는
  //   activeUntil=0 으로 비활성화될 뿐 남아 있어서, 계속 제외되는 바람에 그 채널의
  //   미기록 5분 보상이 영영 안 잡혔다(제보). 아직 유효한 것만 센다.
  async function activeChannelIds() {
    const now = Date.now();
    const ids = new Set();
    try {
      const sess = await chrome.storage.session.get(null);
      for (const [k, v] of Object.entries(sess || {})) {
        if (!k.startsWith("logpower_watch_reward_state:")) continue;
        // activeUntil 이 지났어도 SNAP_SETTLE_MS 동안은 유예한다.
        const until = Number(v?.activeUntil) || 0;
        if (until + SNAP_SETTLE_MS <= now) continue;
        ids.add(k.slice("logpower_watch_reward_state:".length));
      }
    } catch {}
    try {
      const loc = await chrome.storage.local.get(null);
      for (const [k, v] of Object.entries(loc || {})) {
        if (!k.startsWith("cheeseLogPowerHourTimer:")) continue;
        // 타이머는 끝난 뒤에도 보상이 늦게 들어올 수 있어 같은 유예를 준다.
        // leftAt(자리 비움)은 남은 시간이 보존된 상태라 그대로 제외 대상이다.
        const endsAt = Number(v?.endsAt) || 0;
        if (!(Number(v?.leftAt) > 0) && endsAt + SNAP_SETTLE_MS <= now)
          continue;
        ids.add(k.slice("cheeseLogPowerHourTimer:".length));
      }
    } catch {}
    // 방송이 끝나면 state·타이머 키가 통째로 지워져서 위 두 경로로는 유예를 줄 수
    // 없다. 그 순간이 하필 마지막 5분 보상이 들어온 직후라, 종료 직후에 비교하면
    // 정상 시청 보상이 기타로 잡혔다(제보). 최근에 시청 보상을 받은 채널은
    // 내역만 보고도 알 수 있으니 그걸로 유예를 준다.
    for (const e of entries) {
      if (!e.channelId || !isWatchClaim(e.claimType)) continue;
      if (Number(e.at) + SNAP_SETTLE_MS > now) ids.add(e.channelId);
    }
    ids.delete("");
    return ids;
  }

  // 지금 적립 중이거나 1시간 타이머가 도는 채널을 훑는다(제목 옆 배지용).
  // ⚠ activeChannelIds 와 달리 '만료되지 않은 것'만 남긴다. 스냅샷 제외는
  //   넉넉히 걸러도 되지만, 배지는 지난 상태를 보여 주면 거짓말이 된다.
  async function activeWatchInfo() {
    const now = Date.now();
    const out = [];
    try {
      const sess = await chrome.storage.session.get(null);
      for (const [k, v] of Object.entries(sess || {})) {
        if (!k.startsWith("logpower_watch_reward_state:")) continue;
        if (!(Number(v?.activeUntil) > now)) continue;
        out.push({
          channelId: k.slice("logpower_watch_reward_state:".length),
          kind: "accruing",
        });
      }
    } catch {}
    try {
      const loc = await chrome.storage.local.get(null);
      for (const [k, v] of Object.entries(loc || {})) {
        if (!k.startsWith("cheeseLogPowerHourTimer:")) continue;
        // leftAt > 0 = 페이지를 떠나 일시정지된 상태. 남은 시간은 보존되지만
        // 지금 도는 건 아니므로 배지에는 넣지 않는다.
        if (Number(v?.leftAt) > 0) continue;
        if (!(Number(v?.endsAt) > now)) continue;
        const id = k.slice("cheeseLogPowerHourTimer:".length);
        if (out.some((x) => x.channelId === id)) continue;
        out.push({ channelId: id, kind: "timer", endsAt: Number(v.endsAt) });
      }
    } catch {}
    return out.filter((x) => x.channelId);
  }

  // 채널명은 내역·보유량에서 먼저 찾는다. 둘 다 없으면(처음 보는 채널) API 로
  // 물어보고 캐시한다 — id 가 그대로 노출되면 무슨 채널인지 알 수 없다.
  const nameCache = new Map();

  function channelNameOf(id) {
    const hit =
      entries.find((e) => e.channelId === id && e.channelName) ||
      (balances || []).find(
        (b) => String(b?.channelId) === id && b?.channelName,
      );
    return hit?.channelName || nameCache.get(id) || "";
  }

  async function resolveChannelName(id) {
    if (channelNameOf(id)) return;
    if (nameCache.has(id)) return;
    nameCache.set(id, ""); // 중복 요청 방지
    try {
      const res = await fetch(`${API_CHANNELS}/${id}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const name = (await res.json())?.content?.channelName;
      if (name) nameCache.set(id, String(name));
    } catch {}
  }

  async function renderActiveBadge() {
    const box = document.getElementById("lpsActive");
    if (!box) return;
    const rows = await activeWatchInfo();
    if (!rows.length) {
      box.hidden = true;
      box.textContent = "";
      return;
    }
    // 이름을 모르는 채널이 있으면 받아 온 뒤 다시 그린다.
    const unknown = rows.filter((r) => !channelNameOf(r.channelId));
    if (unknown.length) {
      await Promise.all(unknown.map((r) => resolveChannelName(r.channelId)));
    }
    const first = channelNameOf(rows[0].channelId) || "채널";
    const more = rows.length > 1 ? ` 외 ${rows.length - 1}` : "";
    box.textContent = `${first}${more} 채널에서 적립 중`;
    box.hidden = false;
  }

  // baseAt: 기준 시각을 직접 지정한다. 방금 기록한 내역과 같은 시각을 써야
  // 경계(at === since)에서 그 내역이 다시 세어지지 않는다.
  async function saveSnapshot(baseAt) {
    if (!Array.isArray(balances)) return false;
    const skip = await activeChannelIds();
    const prevSnap = await loadSnapshot();
    const prev = prevSnap?.map || {};
    const prevAt = prevSnap?.atMap || {};
    const now = Number(baseAt) || Date.now();
    const map = {};
    // 채널별 기준 시각. 보유량과 '언제부터 센 내역인지'는 반드시 같이 움직여야 한다.
    // 하나만 갱신하면 이미 반영된 내역을 또 빼서 유령 차액이 생긴다.
    const atMap = {};
    for (const b of balances) {
      const id = String(b?.channelId || "");
      if (!id) continue;
      // 적립 중인 채널은 '지금 값'을 찍으면 진행 중인 보상이 기준에 섞인다.
      // 그렇다고 빼 버리면 기준 자체가 사라져, 적립이 끝난 뒤에도 비교 대상이
      // 없어 그 채널의 미기록분이 영영 안 잡힌다(제보). 이전 기준을 넘겨 둔다.
      if (skip.has(id)) {
        if (id in prev) {
          map[id] = Number(prev[id]) || 0;
          // 기준을 물려받으면 시각도 함께 물려받는다. 전역 at 으로 비교하면
          // 그 사이에 우리가 기록한 적립이 '스냅샷 이전'으로 밀려 빠지고,
          // 그만큼이 기타로 둔갑한다.
          atMap[id] = Number(prevAt[id]) || Number(prevSnap?.at) || now;
        } else {
          // 기준이 아예 없던 채널(적립 중일 때 처음 본 경우). 여기서 남겨 두지
          // 않으면 적립이 끝난 뒤에도 비교 대상이 없어 미기록분을 못 잡는다.
          // 지금 값을 기준 삼되 내역도 지금부터 세면 진행 중인 보상은 상쇄된다.
          map[id] = Number(b.amount) || 0;
          atMap[id] = now;
        }
        continue;
      }
      // 지금 값으로 다시 기준을 잡았으니, 내역도 지금부터 다시 센다.
      map[id] = Number(b.amount) || 0;
      atMap[id] = now;
    }
    try {
      await chrome.storage.local.set({
        [SNAP_KEY]: { at: now, map, atMap },
      });
      return true;
    } catch {
      return false;
    }
  }

  // 한 채널이 기준 시각 이후 우리 내역에 남긴 합계.
  function recordedSinceFor(channelId, sinceMs) {
    let sum = 0;
    for (const e of entries) {
      // at === sinceMs 는 기준을 잡던 순간 이미 보유량에 반영된 내역이다.
      // 포함하면 한 번 더 빼서 유령 차액(-N)이 생긴다.
      if (e.channelId !== channelId || e.at <= sinceMs) continue;
      sum += entryTotal(e);
    }
    return sum;
  }

  // 스냅샷과 현재를 비교해 설명되지 않는 변동을 채널별로 돌려준다.
  async function computeOther() {
    const snap = await loadSnapshot();
    if (!snap?.map || !Array.isArray(balances)) return [];
    const skip = await activeChannelIds();
    const pending = await pendingRun();
    const out = [];
    for (const b of balances) {
      const id = String(b?.channelId || "");
      // 스냅샷에 없던 채널은 기준이 없어 판단할 수 없다.
      if (!id || skip.has(id) || !(id in snap.map)) continue;
      // 기준 시각은 채널마다 다를 수 있다(적립 중이라 기준을 물려받은 채널).
      const since = Number(snap.atMap?.[id]) || Number(snap.at) || 0;
      const delta = (Number(b.amount) || 0) - Number(snap.map[id] || 0);
      // 아직 기록되지 않은 누적분도 '설명된 것'으로 친다.
      const pend = pending?.channelId === id ? pending.amount : 0;
      const other = delta - recordedSinceFor(id, since) - pend;
      if (Math.abs(other) <= SNAP_NOISE) continue;
      out.push({
        channelId: id,
        channelName: b.channelName || "채널",
        channelImageUrl: b.channelImageUrl || "",
        verifiedMark: b.verifiedMark === true,
        amount: other,
      });
    }
    return out;
  }

  // 기타 변동을 내역에 남기고 스냅샷을 지금 값으로 갱신한다.
  // (기록과 스냅샷 갱신은 한 묶음이어야 같은 변동을 두 번 세지 않는다.)
  async function commitOther() {
    const rows = await computeOther();
    const now = Date.now();
    for (const r of rows) {
      await upsertEntry({
        // 같은 순간 같은 채널이면 한 건 — 반복 저장해도 중복되지 않는다.
        id: `OTHER-${r.channelId}-${now}`,
        at: now,
        channelId: r.channelId,
        channelName: r.channelName,
        channelImageUrl: r.channelImageUrl,
        verifiedMark: r.verifiedMark,
        amount: r.amount,
        fiveMinAmount: 0,
        boost: 1,
        claimType: r.amount < 0 ? "OTHER_LOSS" : "OTHER_GAIN",
      });
    }
    // 방금 기록한 내역과 같은 시각으로 기준을 잡는다(이중 차감 방지).
    await saveSnapshot(now);
    return rows.length;
  }

  async function loadBalances() {
    try {
      const res = await fetch(BALANCES_URL, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json())?.content?.data;
      balances = Array.isArray(rows) ? rows : [];
      return { ok: true };
    } catch (e) {
      balances = null;
      return { ok: false, message: String(e?.message || e) };
    }
  }

  // 채널별 적립 합계. 기간 필터를 반영한다.
  // ⚠ 막대의 전체 길이는 balances 가 주는 '현재 보유량'이라 과거로 되돌릴 수 없다
  //   (서버가 시점별 스냅샷을 주지 않는다). 그래서 진한 칸(적립분)만 기간을 따르고,
  //   연한 칸은 '현재 보유 − 그 기간 적립분' = 그 기간이 시작될 때의 보유량이 된다.
  function earnedByChannel() {
    const map = new Map();
    for (const e of inRange()) {
      const key = e.channelId || e.channelName;
      map.set(key, (map.get(key) || 0) + entryTotal(e));
    }
    return map;
  }

  // 기간만 적용(채널 검색어는 막대 차트와 무관 — 상위 10 은 전 채널 기준).
  function inRange() {
    return entries.filter(
      (e) => (!fromMs || e.at >= fromMs) && (!toMs || e.at <= toMs),
    );
  }

  // 막대 차트 설명. 고른 기간을 그대로 문구에 반영한다
  // ('이번 달'처럼 단정하면 임의 기간을 골랐을 때 틀린 설명이 된다).
  function barCaption() {
    // 손실이 섞여 있으면 발산형으로 그려진다는 걸 알려 준다.
    const lossNote = barHasLoss ? " 붉은 칸은 0 축 왼쪽의 손실입니다." : "";
    if (barEarnedOnly) {
      if (!fromMs && !toMs)
        return `확장을 켠 뒤 적립한 분량만 표시합니다.${lossNote}`;
      return `${rangeSpan()} 적립한 분량만 표시합니다.${lossNote}`;
    }
    if (!fromMs && !toMs)
      return `채널색 진한 칸이 확장을 켠 뒤 적립한 분량입니다.${lossNote}`;
    return `채널색 진한 칸이 ${rangeSpan()} 적립한 분량입니다.${lossNote}`;
  }

  // 고른 기간을 짧게. 같은 날이면 '08.17~08.17' 대신 '08.17'.
  function rangeSpan() {
    const from = fromMs ? mmdd(fromMs) : "";
    const to = toMs ? mmdd(toMs) : mmdd(Date.now());
    return !from ? `~${to}` : from === to ? from : `${from}~${to}`;
  }

  // ── 채널 프로필 대표색 ─────────────────────────────────────────────────────
  // 프로필 이미지에는 CORS 헤더가 없어 <img> 로 그리면 캔버스가 오염돼 getImageData 가
  // 막힌다. 확장 페이지는 host_permissions 가 있으므로 fetch 로 바이트를 직접 받아
  // blob → ImageBitmap 으로 그린다.
  //
  // 대표색은 '가장 흔한 색'이 아니라 '채도가 있는 색 중 가장 흔한 것'을 쓴다.
  // 프로필은 배경이 흰색·검정인 경우가 많아 최빈색을 쓰면 전부 회색이 된다.
  async function pickProfileColor(url) {
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) return "";
      const bmp = await createImageBitmap(await res.blob());
      const size = 48; // 48x48 로 훑는다(24 는 표본이 너무 적어 색이 흔들렸다)
      const cv = new OffscreenCanvas(size, size);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) return "";
      ctx.drawImage(bmp, 0, 0, size, size);
      bmp.close?.();
      const { data } = ctx.getImageData(0, 0, size, size);

      // 후보 픽셀만 추려 둔다(투명·무채색·너무 어두운 색 제외).
      const px = [];
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 200) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const v = max / 255;
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat < 0.18 || v < 0.25) continue;
        const d = max - min;
        let h = 0;
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        px.push({ r, g, b, h: h * 60, sat, v });
      }
      if (!px.length) return "";

      // ⚠ 색조를 고정 칸으로 나누면(15° 단위) 한 덩어리 색이 칸 경계에 걸쳐
      //    반토막 난다. 실제로 청록 머리카락이 두 칸으로 갈려 면적이 더 넓은
      //    분홍(얼굴+볼터치)에게 밀렸다 → 각 픽셀을 중심으로 ±20° 창을 훑는다.
      //
      // ⚠ 캐릭터 프로필은 얼굴 살구색이 넓게 잡혀 머리·의상의 '실제 대표색'을
      //    이긴다. 붉은 계열의 옅고 밝은 색(=피부/볼)은 가중치를 낮춘다.
      //    선명한 빨강(로고 등)은 채도가 높아 이 조건에 걸리지 않는다.
      const weigh = (p) => {
        const w = p.sat * p.v;
        const fleshy = (p.h >= 330 || p.h <= 45) && p.sat < 0.45 && p.v > 0.55;
        return fleshy ? w * 0.3 : w;
      };

      let best = null;
      for (const c of px) {
        let w = 0;
        const mem = [];
        for (const p of px) {
          const raw = Math.abs(p.h - c.h);
          if (Math.min(raw, 360 - raw) > 20) continue;
          w += weigh(p);
          mem.push(p);
        }
        if (w > 0 && (!best || w > best.w)) best = { w, mem };
      }
      if (!best) return "";

      // ⚠ 뽑힌 무리를 통째로 평균 내면 그늘진 픽셀까지 섞여 탁해진다.
      //    선명한 1/3 만 남겨 눈에 보이는 색에 가깝게 만든다.
      const mem = best.mem
        .slice()
        .sort((a, b) => b.sat * b.v - a.sat * a.v)
        .slice(0, Math.max(1, Math.round(best.mem.length / 3)));
      let tw = 0;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      for (const p of mem) {
        const w = p.sat * p.v;
        tw += w;
        rr += p.r * w;
        gg += p.g * w;
        bb += p.b * w;
      }
      if (!tw) return "";
      // ⚠ hex 로 돌려준다. Coloris 를 format:"hex" 로 쓰는데 rgb() 문자열을 넣으면
      // 입력칸이 좁아 값이 잘려 보인다(제보). 저장 형식도 hex 로 통일한다.
      const to = (x) => Math.min(255, Math.max(0, Math.round(x / tw)));
      const hex = (x) => to(x).toString(16).padStart(2, "0");
      return `#${hex(rr)}${hex(gg)}${hex(bb)}`;
    } catch {
      return "";
    }
  }

  // 라인 차트에 쓸 채널만 색을 뽑는다(전부 훑으면 낭비).
  // ⚠ 프로필 이미지 호스트는 optional_host_permissions 다. 사용자가 '프로필에서 색
  // 추출'을 누를 때만 권한을 요청하고, 거부하면 기본 팔레트를 그대로 쓴다.
  async function loadChannelColors(names, { force = false } = {}) {
    const todo = names.filter((n) => n && (force || !channelColors.has(n)));
    if (!todo.length) return { changed: false, ok: 0, fail: 0 };

    // ⚠ 이미지 출처를 entries 로만 잡으면 '보유는 있는데 최근 적립이 없는' 채널
    //    (막대 차트에만 나오는 채널)은 URL 을 못 찾아 항상 추출에 실패한다.
    //    balances 에도 프로필 URL 이 오므로 두 곳을 합쳐서 찾는다.
    const byName = new Map();
    const addSrc = (name, url) => {
      if (name && url && !byName.has(name)) byName.set(name, url);
    };
    for (const e of entries) addSrc(e.channelName, e.channelImageUrl);
    for (const b of balances || []) addSrc(b?.channelName, b?.channelImageUrl);

    let changed = false;
    let ok = 0;
    let fail = 0;
    await Promise.all(
      todo.map(async (name) => {
        const url = byName.get(name);
        const color = url ? await pickProfileColor(url) : "";
        if (color) {
          channelColors.set(name, color);
          changed = true;
          ok += 1;
        } else {
          // ⚠ 실패를 '' 로 캐시하지 않는다. 넣어 두면 colorFor 가 기본색으로
          //    떨어뜨려 '추출됐는데 색이 틀렸다'처럼 보이고, 나중에 URL 이
          //    생겨도 다시 시도하지 않는다.
          channelColors.delete(name);
          fail += 1;
        }
      }),
    );
    return { changed, ok, fail };
  }

  // 두 차트가 같은 채널을 같은 색으로 그려야 하므로 팔레트와 해석기를 공유한다.
  // ⚠ 확대하면 계열이 최대 12개까지 늘어난다. 5색만으로는 색이 겹쳐 구분이
  //   안 되므로 색상환을 고르게 도는 12색을 쓴다(앞 5색은 기존 값 유지 —
  //   이미 그 색으로 익숙해진 채널의 기본색이 바뀌지 않도록).
  const PALETTE = [
    "#168f5c",
    "#3596ed",
    "#b7726f",
    "#8a63d2",
    "#d99a1c",
    "#e0603a",
    "#2ba3a3",
    "#c2497f",
    "#6b8e23",
    "#4a6fd4",
    "#a0522d",
    "#7b5ea7",
  ];

  // 기본색은 '목록에서의 위치'가 아니라 채널명 해시로 정한다. 위치 기반이면
  // 막대(보유순)와 라인(적립순)의 정렬이 달라 같은 채널이 서로 다른 색이 된다.
  function fallbackColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i += 1)
      h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // 기본색 배정을 '순서'로 덮어쓰기 위한 맵(라인 차트가 채운다).
  // 해시만 쓰면 채널이 많을 때 색이 겹쳐 선을 구분할 수 없다.
  const orderedFallback = new Map();

  function colorFor(name) {
    return (
      channelColors.get(name) ||
      orderedFallback.get(name) ||
      fallbackColor(name)
    );
  }

  // #rrggbb → rgba(). 기존 보유분을 같은 색의 연한 톤으로 깔기 위해 쓴다.
  function withAlpha(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // 색 목록은 두 차트에 등장하는 채널의 합집합으로 만든다. 막대에만 있는 채널
  // (상위 10위권이지만 최근 적립이 없는 채널)도 직접 색을 고를 수 있어야 한다.
  let lineNames = [];
  let barNames = [];
  function allColorNames() {
    return [...new Set([...barNames, ...lineNames])].filter(Boolean);
  }

  // 버튼을 '처리 중'으로 바꾼다. 라벨을 3-dot pulse 로 갈아 끼우고 되돌린다.
  // ⚠ 최소 표시 시간을 둔다. 응답이 빠르면 점이 깜빡이지도 않아 눌렀는지
  //   알 수 없다(제보). 짧게라도 보여야 동작했다는 게 전달된다.
  const BUSY_MIN_MS = 400;

  async function withBusy(btn, run) {
    if (!btn || btn.dataset.busy === "1") return;
    const label = btn.innerHTML;
    const started = Date.now();
    // 라벨을 점으로 바꾸면 폭이 줄어 버튼이 들썩인다 → 지금 폭을 고정한다.
    btn.style.minWidth = `${btn.getBoundingClientRect().width}px`;
    btn.dataset.busy = "1";
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML =
      '<span class="lps-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    try {
      return await run();
    } finally {
      const left = BUSY_MIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      btn.innerHTML = label;
      btn.style.minWidth = "";
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      delete btn.dataset.busy;
    }
  }

  // 맞추기 결과를 잠깐 알려 준다(조용히 끝나면 눌렸는지 알 수 없다).
  let syncNoteTimer = 0;
  function setSyncNote(text) {
    const el = document.getElementById("lpsSyncNote");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    clearTimeout(syncNoteTimer);
    if (text) syncNoteTimer = window.setTimeout(() => setSyncNote(""), 5000);
  }

  function setColorNote(text) {
    const el = document.getElementById("lpsColorNote");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

  // 노드를 새로 만들지 않고 색 값만 반영한다(Coloris 스와치는 input 값을 따른다).
  function syncColorInputs() {
    document.querySelectorAll("[data-color-for]").forEach((input) => {
      const next = colorFor(input.dataset.colorFor);
      if (input.value !== next) {
        input.value = next;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  // 채널별 색 목록(직접 선택용). Coloris 를 붙여 클릭하면 색상 선택기가 열린다.
  let lastColorNames = [];
  let colorListSig = "";
  function renderColorList(names) {
    lastColorNames = names;
    const list = document.getElementById("lpsColorList");
    if (!list) return;

    // ⚠ innerHTML 로 갈아끼우면 Coloris 가 물고 있던 input 이 사라진다. 색을 고르는
    //   중(=change 로 여기까지 온 경우)에 노드가 교체되면 선택기가 닫히거나 클릭이
    //   먹히지 않는다 → 목록과 색이 그대로면 다시 그리지 않는다.
    //   시그니처에 색은 넣지 않는다. 색만 바뀐 경우 Coloris 가 스와치를 알아서
    //   갱신하므로, 여기서 다시 그리면 오히려 조작 중인 input 을 날리게 된다.
    const sig = names.join("|");
    if (sig === colorListSig) {
      // 목록은 그대로고 색만 바뀐 경우(추출/기본색) → 값만 제자리에서 맞춘다.
      syncColorInputs();
      return;
    }
    colorListSig = sig;

    list.innerHTML = names
      .map((name) => {
        const color = colorFor(name);
        return (
          `<li>` +
          `<input type="text" class="lps-color-input" data-color-for="${escapeHtml(name)}" ` +
          `value="${escapeHtml(color)}" aria-label="${escapeHtml(name)} 색상">` +
          `<span class="lps-color-name">${escapeHtml(name)}</span>` +
          `</li>`
        );
      })
      .join("");
    try {
      window.Coloris?.("[data-color-for]");
      window.Coloris?.wrap("[data-color-for]");
    } catch {}
  }

  function showOverlay(which, text) {
    const box = document.querySelector(`[data-overlay="${which}"]`);
    if (!box) return;
    box.hidden = !text;
    const p = box.querySelector("[data-overlay-text]");
    if (p && text) p.textContent = text;
  }

  function renderBarChart() {
    const canvas = document.getElementById("lpsBarChart");
    if (!canvas || typeof Chart === "undefined") return;
    const earned = earnedByChannel();

    // 조회 실패 시에는 '예시 차트'를 그려 두고 그 위를 오버레이로 가린다.
    // 영역을 통째로 숨기면 레이아웃이 흔들리고 복구 방법도 안 보인다.
    const sample = !balances;
    const rows = sample
      ? Array.from({ length: 6 }, (_, i) => ({
          channelName: "───",
          amount: 900 - i * 120,
          earned: 200 - i * 20,
        }))
      : (() => {
          const earnedOf = (x) =>
            earned.get(x.channelId) || earned.get(x.channelName) || 0;
          // '적립분만' 이면 보유량이 아니라 적립분 기준으로 줄 세운다.
          // (보유 순으로 두면 적립 0 인 채널이 위를 채워 빈 막대만 보인다.)
          const sorted = barEarnedOnly
            ? [...balances]
                .filter((x) => earnedOf(x) > 0)
                .sort((a, b) => earnedOf(b) - earnedOf(a))
            : [...balances].sort((a, b) => (b.amount || 0) - (a.amount || 0));
          const top = sorted.slice(0, TOP_N).map((x) => ({
            channelName: x.channelName || "채널",
            amount: Number(x.amount) || 0,
            earned: earned.get(x.channelId) || earned.get(x.channelName) || 0,
          }));
          // 말 그대로 상위 10 만 보여 준다. 그 밖의 적립은 날짜별 추이에서 확인한다.
          return top;
        })();

    const brand = css("--popup-brand-strong", "#168f5c");
    const line = css("--popup-border", "#d8dade");
    const text = css("--popup-text", "#26262c");
    const muted = css("--popup-muted", "#7e7f85");

    // ⚠ 적립분은 이미 보유량에 포함돼 있다. 그대로 더해 쌓으면 이중 계산이 되므로
    // '이전분(보유-적립)' + '적립분' 으로 나눠 합이 총 보유와 맞게 한다.
    if (!sample) {
      barNames = rows.map((r) => r.channelName);
      renderColorList(allColorNames());
    }

    // '적립분만' 이면 기존 보유 칸을 0 으로 만들어 적립분만 남긴다. 축이 적립분
    // 규모에 맞춰 다시 잡히므로 작은 값도 비교할 수 있다.
    // ⚠ 예측 손실로 earned 가 음수면 prior = 보유 - (-x) 가 되어 막대가 실제
    //   보유보다 길어진다. 손실분은 0 축 왼쪽으로 따로 빼서(발산형) 총합이
    //   보유와 맞도록 한다.
    const hasLoss = rows.some((r) => r.earned < 0);
    barHasLoss = hasLoss;
    // ⚠ 문구는 hasLoss 를 쓰므로 반드시 계산 뒤에 갱신한다.
    const cap = document.getElementById("lpsBarCaption");
    if (cap) cap.textContent = barCaption();
    const prior = barEarnedOnly
      ? rows.map(() => 0)
      : rows.map((r) => Math.max(0, r.amount - Math.max(0, r.earned)));
    // ⚠ 쌓기 모드에서는 '적립분 ≤ 보유'로 잘라야 합이 총 보유와 맞는다. 하지만
    //   '적립분만' 은 보유와 무관하게 우리가 기록한 값을 그대로 보여야 한다.
    //   (승부예측 손실 등으로 보유가 적립분보다 적어지면 잘못 눌린다.)
    const gained = barEarnedOnly
      ? rows.map((r) => r.earned)
      : rows.map((r) => Math.max(0, Math.min(r.amount, r.earned)));
    // 손실분(음수)은 별도 계열로 0 축 왼쪽에 그린다.
    const lost = rows.map((r) => Math.min(0, r.earned));

    barChart?.destroy();
    barChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.channelName),
        datasets: [
          {
            label: "기존 보유",
            data: prior,
            // 채널색의 연한 톤. 같은 색 계열이라 어느 막대가 어느 채널인지
            // 축 라벨을 따라가지 않아도 보이고, 라인 차트와도 색이 맞는다.
            backgroundColor: sample
              ? line
              : rows.map((r) => withAlpha(colorFor(r.channelName), 0.45)),
            borderWidth: 0,
          },
          {
            label: "적립분",
            data: gained,
            // 적립분은 원색 그대로 → 같은 채널 안에서 연함/진함으로 구분된다.
            backgroundColor: sample
              ? muted
              : rows.map((r) => colorFor(r.channelName)),
            borderWidth: 0,
          },
          // 손실 계열은 값이 있을 때만 붙인다(없으면 범례·축이 괜히 넓어진다).
          ...(hasLoss
            ? [
                {
                  label: "손실",
                  data: lost,
                  backgroundColor: "#e02020",
                  borderWidth: 0,
                },
              ]
            : []),
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            stacked: true,
            ticks: { color: muted },
            // 손실이 있으면 0 이 손익 경계가 되므로 그 선만 진하게.
            grid: {
              color: (ctx) => (hasLoss && ctx.tick?.value === 0 ? text : line),
              lineWidth: (ctx) => (hasLoss && ctx.tick?.value === 0 ? 2 : 1),
            },
          },
          y: {
            stacked: true,
            ticks: { color: text },
            grid: { display: false },
          },
        },
        plugins: {
          // 막대를 채널색으로 칠하면서 범례의 색 견본이 의미를 잃었다(채널마다
          // 색이 다름) → 실제 데이터에서는 감추고, 구분은 툴팁으로 안내한다.
          legend: {
            display: sample,
            labels: { color: text, boxWidth: 12 },
          },
          tooltip: {
            callbacks: {
              // 범례를 감췄으므로 각 구간이 무엇인지 툴팁에서 밝힌다.
              label: (item) => {
                const which = ["기존 보유", "적립분", "손실"][
                  item.datasetIndex
                ];
                const v = item.parsed.x || 0;
                return `${which || "값"} ${v < 0 ? fmt(v) : fmt(v)}`;
              },
              // 막대 끝 라벨 대신 툴팁에 '총 보유(+적립)' 를 보여 준다.
              afterBody: (items) => {
                const r = rows[items[0].dataIndex];
                if (!r) return "";
                if (!r.earned) return `총 보유 ${fmt(r.amount)}`;
                // 손실이면 부호가 그대로 보이게 한다(+ 를 붙이지 않는다).
                const sign = r.earned > 0 ? `+${fmt(r.earned)}` : fmt(r.earned);
                return `총 보유 ${fmt(r.amount)} (${sign})`;
              },
            },
          },
        },
      },
    });
  }

  // 선택 기간이 '하루'면 날짜 축이 점 하나뿐이라 추이가 안 보인다 → 시간축으로 바꾼다.
  function isSingleDay() {
    if (!fromMs || !toMs) return false;
    const a = new Date(fromMs);
    const b = new Date(toMs);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function renderLineChart() {
    const canvas = document.getElementById("lpsLineChart");
    if (!canvas || typeof Chart === "undefined") return;
    const rows = visible();
    const hourly = isSingleDay();

    // 축 키: 하루면 0~23시, 아니면 기록이 있는 날짜만(시청 안 한 날의 0 이 길게
    // 이어지면 읽기 어렵다).
    const keys = hourly
      ? Array.from({ length: 24 }, (_, h) => `${h}시`)
      : [...new Set(rows.map((e) => dateKey(new Date(e.at))))].sort();
    const keyOf = (e) =>
      hourly ? `${new Date(e.at).getHours()}시` : dateKey(new Date(e.at));

    // 채널이 많으면 선이 얽힌다 → 상위 몇 개만 그리고 나머지는 '기타'로 묶는다.
    // 확대 중에는 캔버스가 훨씬 넓어 선이 겹칠 여지가 적으므로 한도를 늘린다.
    const byCh = new Map();
    for (const e of rows) {
      const k = e.channelName || "채널";
      byCh.set(k, (byCh.get(k) || 0) + entryTotal(e));
    }
    const topNames = [...byCh.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, zoomFor === "line" ? 12 : 5)
      .map(([k]) => k);

    // 상위 N 은 순서가 정해져 있으므로 팔레트를 앞에서부터 겹치지 않게 배정한다.
    // (사용자가 직접 고른 색은 colorFor 에서 우선하므로 영향받지 않는다.)
    orderedFallback.clear();
    topNames.forEach((n, i) =>
      orderedFallback.set(n, PALETTE[i % PALETTE.length]),
    );

    const series = new Map(topNames.map((n) => [n, keys.map(() => 0)]));
    const other = keys.map(() => 0);
    for (const e of rows) {
      const i = keys.indexOf(keyOf(e));
      if (i < 0) continue;
      const name = e.channelName || "채널";
      if (series.has(name)) series.get(name)[i] += entryTotal(e);
      else other[i] += entryTotal(e);
    }

    const text = css("--popup-text", "#26262c");
    const muted = css("--popup-muted", "#7e7f85");
    const line = css("--popup-border", "#d8dade");
    // 0 기준선은 손익 경계라 더 진하게 그린다.
    const zeroLine = css("--popup-muted", "#7e7f85");

    // 시간축(오늘)은 24칸 중 대부분이 0 이라, 0 을 전부 그리면 바닥에 붙은 선과
    // 점이 가득 차 읽기 어렵다. 그렇다고 0 을 전부 지우면 값이 어느 시각에서
    // 시작해 어느 시각에 끝났는지가 사라진다 → 실제 값에 '맞닿은' 0 만 남긴다.
    //   예) 15시에만 값 → 14·15·16시가 그려지고 이어짐
    //       17·18시에 값 → 16·17·18·19시가 그려지고 이어짐
    // 나머지 0 은 null 로 두어 건너뛴다(Chart.js 는 null 을 '데이터 없음'으로 본다).
    const sparse = (arr) => {
      if (!hourly) return arr;
      // ⚠ 배열 밖은 undefined 다. `!== 0` 으로 비교하면 참이 되어 0시·23시에
      //   엉뚱한 점이 찍힌다(제보) → 실제 값이 있는 칸인지로 판정한다.
      const has = (x) => typeof x === "number" && x !== 0;
      return arr.map((v, i) => {
        if (v !== 0) return v; // 음수(예측 손실)도 실제 값이다
        // 양옆 중 하나라도 실제 값이면 이 0 은 구간의 시작/끝을 나타내므로 남긴다.
        if (has(arr[i - 1]) || has(arr[i + 1])) return 0;
        return null;
      });
    };

    // 누적 보기: 각 칸을 '그때까지의 합'으로 바꾼다.
    // ⚠ 누적은 값이 없는 칸도 직전 합계를 이어가야 한다(0 으로 떨어지면 안 된다).
    //   그래서 sparse(null 로 비우기)를 적용하지 않고 전 구간을 채워 그린다.
    const cumulate = (arr) => {
      let acc = 0;
      return arr.map((v) => (acc += v || 0));
    };
    // 손실이 섞이면 누적선이 내려가기도 한다 — 그게 실제 잔액 흐름이라 맞다.
    const shape = (arr) => (lineCumulative ? cumulate(arr) : sparse(arr));

    // 계열이 하나뿐이면(검색으로 채널을 좁힌 경우) 면적을 채운다. 가릴 상대가
    // 없어 부작용이 없고 적립량이 한눈에 들어온다.
    // ⚠ 음수(예측 손실)가 섞이면 면적이 0 축을 넘나들어 오히려 읽기 어렵다
    //   → 그런 경우엔 선만 그린다.
    const singleSeries = series.size === 1 && !other.some((v) => v !== 0);
    const hasNegative = [...series.values()].some((arr) =>
      arr.some((v) => v < 0),
    );
    // 누적 보기에서는 계열이 하나면 면적이 '쌓인 총량'을 정확히 나타낸다.
    // (음수가 있어도 누적선은 잔액 흐름이라 면적이 뒤집히지 않는다.)
    const fillArea = singleSeries && (lineCumulative || !hasNegative);

    const datasets = [...series.entries()].map(([name, data]) => {
      const color = colorFor(name);
      return {
        label: name,
        data: shape(data),
        borderColor: color,
        backgroundColor: fillArea ? withAlpha(color, 0.18) : color,
        fill: fillArea ? "origin" : false,
        tension: 0.25,
        pointRadius: 3,
        // 0 앵커가 구간의 시작·끝을 이미 표시하므로 gap 을 잇지 않는다.
        // 켜 두면 멀리 떨어진 구간까지 직선으로 연결돼 없는 적립이 있어 보인다.
        // (누적 보기는 빈 칸이 없으므로 이 설정이 의미가 없다.)
        spanGaps: false,
      };
    });
    if (other.some((v) => v > 0)) {
      datasets.push({
        label: "기타",
        data: shape(other),
        borderColor: muted,
        backgroundColor: muted,
        borderDash: [4, 4],
        tension: 0.25,
        pointRadius: 3,
      });
    }

    // 누적/개별에 따라 읽는 법이 달라지므로 설명도 바꾼다.
    const lineCap = document.getElementById("lpsLineCaption");
    if (lineCap) {
      lineCap.textContent = lineCumulative
        ? "그때까지 쌓인 합계입니다. 위에서 고른 기간·채널이 반영됩니다."
        : "위에서 고른 기간·채널이 반영됩니다.";
    }

    lineChart?.destroy();
    lineChart = new Chart(canvas, {
      type: "line",
      data: { labels: keys, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: muted }, grid: { color: line } },
          y: {
            // 손실(예측 베팅)이 있으면 0 을 기준으로 위아래를 함께 보여 준다.
            beginAtZero: true,
            ticks: { color: muted },
            grid: {
              color: (ctx) => (ctx.tick?.value === 0 ? zeroLine : line),
              lineWidth: (ctx) => (ctx.tick?.value === 0 ? 2 : 1),
            },
          },
        },
        plugins: { legend: { labels: { color: text, boxWidth: 12 } } },
      },
    });

    lineNames = topNames;
    renderColorList(allColorNames());
  }

  async function refreshBalances() {
    showOverlay("bar", "");
    const r = await loadBalances();
    if (!r.ok) {
      showOverlay(
        "bar",
        `보유 통나무파워를 불러오지 못했습니다. (${r.message})\n로그인 상태와 네트워크를 확인해 주세요.`,
      );
    }
    renderBarChart();
  }

  function closeSortMenu() {
    const list = document.querySelector(".lps-sort-list");
    const btn = document.getElementById("lpsSortButton");
    if (list) list.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
  }

  document.addEventListener("click", (e) => {
    if (
      calendarPopoverTrigger &&
      !e.target.closest?.(".lps-calendar-popover") &&
      !e.target.closest?.("[data-calendar-day]")
    ) {
      closeCalendarPopover();
    }
    if (e.target.closest?.("#lpsFabTop")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (e.target.closest?.("#lpsFabAdd")) {
      openDialog(null);
      return;
    }

    const cardBtn = e.target.closest?.("[data-card-toggle]");
    if (cardBtn) {
      const key = cardBtn.dataset.cardToggle;
      const body = document.querySelector(`[data-card-body="${key}"]`);
      if (!body) return;
      const open = body.hidden;
      body.hidden = !open;
      cardBtn.setAttribute("aria-expanded", String(open));
      // 펼칠 때 계산한다(접힌 카드까지 매번 그리면 낭비다).
      if (open) renderCards();
      return;
    }

    const zoomBtn = e.target.closest?.("[data-chart-zoom]");
    if (zoomBtn) {
      openZoom(zoomBtn.dataset.chartZoom);
      return;
    }
    if (e.target.closest?.("[data-zoom-close]")) {
      closeZoom();
      return;
    }

    if (e.target.closest?.("[data-bar-earned-only]")) {
      barEarnedOnly = !!document.querySelector("[data-bar-earned-only]")
        ?.checked;
      try {
        void chrome.storage.local.set({ [BAR_ONLY_KEY]: barEarnedOnly });
      } catch {}
      renderBarChart();
      return;
    }

    if (e.target.closest?.("[data-groups-expand-all]")) {
      setAllGroupsExpanded(true);
      return;
    }
    if (e.target.closest?.("[data-groups-collapse-all]")) {
      setAllGroupsExpanded(false);
      return;
    }

    if (e.target.closest?.("[data-calendar-popover-close]")) {
      closeCalendarPopover({ restoreFocus: true });
      return;
    }

    const calendarNav = e.target.closest?.("[data-calendar-nav]");
    if (calendarNav) {
      const action = calendarNav.dataset.calendarNav;
      if (action === "today") {
        setCalendarMonth(new Date());
      } else {
        const current = calendarMonthDate();
        setCalendarMonth(
          new Date(
            current.getFullYear(),
            current.getMonth() + (action === "prev" ? -1 : 1),
            1,
          ),
        );
      }
      renderLogBody();
      document
        .querySelector(`[data-calendar-nav="${action}"]`)
        ?.focus({ preventScroll: true });
      return;
    }

    const calendarDay = e.target.closest?.("[data-calendar-day]");
    if (calendarDay) {
      openCalendarDay(calendarDay.dataset.calendarDay, calendarDay);
      return;
    }

    const viewButton = e.target.closest?.("[data-view-mode]");
    if (viewButton && !viewButton.disabled) {
      const next = viewButton.dataset.viewMode;
      if (next !== "tree" && next !== "explorer" && next !== "calendar") {
        return;
      }
      viewMode = next;
      if (viewMode === "calendar") ensureCalendarMonthForRange();
      try {
        void chrome.storage.local.set({ [VIEW_MODE_KEY]: viewMode });
      } catch {}
      renderLogBody();
      return;
    }

    if (e.target.closest?.("[data-explorer-root]")) {
      explorerPath = [];
      renderLogBody();
      return;
    }
    const crumb = e.target.closest?.("[data-explorer-crumb]");
    if (crumb) {
      const depth = Number(crumb.dataset.explorerCrumb);
      const nextPath = explorerPath.slice(
        0,
        Number.isFinite(depth) ? depth + 1 : 0,
      );
      if (nextPath.length === activeGroupLevels().length) {
        markExplorerFolderRead(nextPath);
      }
      explorerPath = nextPath;
      renderLogBody();
      return;
    }
    if (e.target.closest?.("[data-explorer-up]")) {
      explorerPath = explorerPath.slice(0, -1);
      renderLogBody();
      return;
    }
    const folder = e.target.closest?.("[data-explorer-folder]");
    if (folder) {
      const depth = Number(folder.dataset.explorerDepth);
      const levelId = folder.dataset.explorerLevel || "";
      const key = folder.dataset.explorerKey || "";
      if (!Number.isInteger(depth) || depth < 0 || !levelId || !key) return;
      const nextPath = explorerPath.slice(0, depth);
      nextPath.push({ levelId, key });
      if (nextPath.length === activeGroupLevels().length) {
        markExplorerFolderRead(nextPath);
      }
      explorerPath = nextPath;
      renderLogBody();
      document.getElementById("lpsBody")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    const groupMove = e.target.closest?.("[data-group-move]");
    if (groupMove) {
      const item = groupMove.closest("[data-group-order-item]");
      if (!item) return;
      moveGroupOrder(
        item.dataset.groupOrderItem,
        groupMove.dataset.groupMove === "up" ? -1 : 1,
      );
      return;
    }

    const groupBox = e.target.closest?.(
      "[data-group-date], [data-group-streamer], [data-group-type]",
    );
    if (groupBox) {
      groupByDate = !!document.querySelector("[data-group-date]")?.checked;
      groupByStreamer = !!document.querySelector("[data-group-streamer]")
        ?.checked;
      groupByType = !!document.querySelector("[data-group-type]")?.checked;
      // 묶는 방식이 바뀌면 예전 접힘 상태는 의미가 없다.
      collapsed.clear();
      explorerPath = [];
      rebuildExplorerUnreadPaths();
      try {
        void chrome.storage.local.set({
          [GROUP_KEY]: {
            date: groupByDate,
            streamer: groupByStreamer,
            type: groupByType,
          },
        });
      } catch {}
      renderGroupOrderControls();
      renderLogBody();
      return;
    }

    // 커스텀 정렬 팝오버(기본 select 대신 — 설정 화면과 톤을 맞춘다).
    if (e.target.closest?.("#lpsSortButton")) {
      const list = document.querySelector(".lps-sort-list");
      const btn = document.getElementById("lpsSortButton");
      if (!list || !btn) return;
      const open = list.hidden;
      list.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      return;
    }
    const opt = e.target.closest?.(".lps-sort-list [data-sort]");
    if (opt) {
      sort = opt.getAttribute("data-sort") || "recent";
      document
        .querySelectorAll(".lps-sort-list [data-sort]")
        .forEach((li) =>
          li.setAttribute(
            "aria-selected",
            String(li.getAttribute("data-sort") === sort),
          ),
        );
      const label = document.querySelector("[data-sort-label]");
      if (label) label.textContent = SORT_LABELS[sort] || "";
      closeSortMenu();
      renderLogBody();
      return;
    }
    // 바깥을 누르면 닫는다.
    if (!e.target.closest?.("[data-sort-menu]")) closeSortMenu();

    if (e.target.closest?.("#lpsRangeClear")) {
      pickerValues.from = "";
      pickerValues.to = "";
      syncRangeFromPickers();
      renderPicker("from");
      renderPicker("to");
      render();
      return;
    }

    if (e.target.closest?.("#lpsTheme")) {
      toggleTheme();
      // 차트 색은 CSS 변수에서 읽어 굳어 있으므로 다시 그린다.
      renderBarChart();
      renderLineChart();
      return;
    }

    if (e.target.closest?.("[data-retry='bar']")) {
      void refreshBalances();
      return;
    }

    if (e.target.closest?.("#lpsColorAuto")) {
      const btn = e.target.closest("#lpsColorAuto");
      // ⚠ permissions.request 는 사용자 제스처 안에서 '동기적으로' 불러야 한다.
      // await 를 먼저 걸면 제스처가 끊겨 조용히 거부된다 → 콜백 형태로 호출한다.
      chrome.permissions.request(
        {
          origins: [
            "https://nng-phinf.pstatic.net/*",
            "https://ssl.pstatic.net/*",
          ],
        },
        (granted) => {
          if (!granted) {
            setColorNote("권한을 허용해야 프로필에서 색을 뽑을 수 있습니다.");
            return;
          }
          btn.disabled = true;
          btn.textContent = "추출 중…";
          setColorNote("");
          // force: 이미 값이 있어도 프로필 기준으로 다시 뽑는다.
          void loadChannelColors(lastColorNames, { force: true }).then(
            ({ ok, fail }) => {
              saveChannelColorPrefs();
              renderBarChart();
              renderLineChart();
              btn.disabled = false;
              btn.textContent = "프로필에서 색 추출";
              // 조용히 실패하면 '추출했는데 색이 이상하다'로 오해하게 된다.
              if (!ok && fail) {
                setColorNote(
                  "프로필 이미지를 불러오지 못해 기본색을 유지합니다.",
                );
              } else if (fail) {
                setColorNote(`${ok}개 적용, ${fail}개는 이미지가 없어 기본색.`);
              } else {
                setColorNote("");
              }
            },
          );
        },
      );
      return;
    }

    // 종류 팝오버
    if (e.target.closest?.("#lpsTypeButton")) {
      const list = document.getElementById("lpsTypeList");
      const btn = document.getElementById("lpsTypeButton");
      if (!list || !btn) return;
      const open = list.hidden;
      list.hidden = !open;
      btn.setAttribute("aria-expanded", String(open));
      return;
    }
    const typeOpt = e.target.closest?.("#lpsTypeList [data-type]");
    if (typeOpt) {
      // ⚠ 수정 중에는 금액을 덮지 않는다. 이미 들어 있는 실제 값(기타 적립 500 등)이
      //   종류 단가로 바뀌면 다시 입력해야 한다(제보). 새로 추가할 때만 채운다.
      setTypeChoice(typeOpt.dataset.type, { fill: !editingId });
      closeTypeList();
      if (typeChoice === "__custom") $f("lpsFieldTypeCustom")?.focus();
      return;
    }
    if (!e.target.closest?.(".lps-type")) closeTypeList();

    // 숫자 스피너
    const spin = e.target.closest?.("[data-spin]");
    if (spin) {
      spinStep(spin.dataset.spinFor, spin.dataset.spin === "up" ? 1 : -1);
      return;
    }

    // 채널 후보 선택
    const chItem = e.target.closest?.("#lpsChannelList [data-ch-index]");
    if (chItem) {
      setPicked(channelChoices[Number(chItem.dataset.chIndex)]);
      return;
    }
    if (e.target.closest?.("#lpsChannelClear")) {
      setPicked(null);
      document.getElementById("lpsFieldName")?.focus();
      return;
    }

    if (e.target.closest?.("#lpsSyncOther")) {
      const btn = e.target.closest("#lpsSyncOther");
      void withBusy(btn, async () => {
        // 최신 보유량을 받아 비교한다(열어 둔 지 오래됐을 수 있다).
        await loadBalances();
        const n = await commitOther();
        await load();
        render();
        await refreshBalances();
        setSyncNote(
          n
            ? `${n}개 채널의 차이를 '기타'로 기록했습니다.`
            : "차이가 없습니다.",
        );
      });
      return;
    }

    if (e.target.closest?.("#lpsAdd")) {
      openDialog(null);
      return;
    }
    if (e.target.closest?.("[data-dialog-close]")) {
      closeDialog();
      return;
    }
    if (e.target.closest?.("#lpsDialogSave")) {
      void saveDialog();
      return;
    }
    if (e.target.closest?.("#lpsDialogDelete")) {
      void removeCurrent();
      return;
    }
    // 목록 행을 누르면 그 항목을 수정한다(채널 묶음 보기에서는 개별 항목이 없다).
    // ⚠ 행 안의 '예측 상세'(details/summary)는 제외한다. 펼치려고 눌렀는데
    //   수정 팝업까지 뜬다(제보).
    if (e.target.closest?.(".lps-pred")) return;
    const row = e.target.closest?.(".lps-row[data-entry-id]");
    if (row) {
      const entry = entries.find((x) => x.id === row.dataset.entryId);
      if (entry) openDialog(entry);
      return;
    }

    if (e.target.closest?.("#lpsColorReset")) {
      channelColors.clear();
      saveChannelColorPrefs();
      renderBarChart();
      renderLineChart();
      return;
    }

    // 라인 차트 빠른 기간 변경. 위쪽 데이트 피커와 같은 상태를 쓰므로 서로 동기화된다.
    if (e.target.closest?.("[data-line-cumulative]")) {
      lineCumulative = !!document.querySelector("[data-line-cumulative]")
        ?.checked;
      void chrome.storage.local
        .set({ [LINE_CUMULATIVE_KEY]: lineCumulative })
        .catch(() => {});
      renderLineChart();
      return;
    }

    const quick = e.target.closest?.("[data-quick]");
    if (quick) {
      const kind = quick.dataset.quick;
      const p = periodStarts();
      const now = new Date();
      if (kind === "all") {
        pickerValues.from = "";
        pickerValues.to = "";
      } else if (kind === "yesterday") {
        // ⚠ 다른 항목과 달리 끝도 '어제'다(오늘까지 잡으면 어제가 아니다).
        const y = new Date(p.today - 86400000);
        pickerValues.from = dateKey(y);
        pickerValues.to = dateKey(y);
        pickerMonths.from = monthStart(y);
        pickerMonths.to = monthStart(y);
      } else {
        const startMs =
          kind === "today" ? p.today : kind === "week" ? p.week : p.month;
        pickerValues.from = dateKey(new Date(startMs));
        pickerValues.to = dateKey(now);
        pickerMonths.from = monthStart(new Date(startMs));
        pickerMonths.to = monthStart(now);
      }
      syncRangeFromPickers();
      document
        .querySelectorAll("[data-quick]")
        .forEach((b) =>
          b.setAttribute("aria-pressed", String(b.dataset.quick === kind)),
        );
      renderPicker("from");
      renderPicker("to");
      render();
      return;
    }

    // ── 데이트 피커 ──
    const toggle = e.target.closest?.("[data-action='date-toggle']");
    if (toggle) {
      const root = toggle.closest("[data-date-picker]");
      const cal = root?.querySelector(".popup-calendar");
      if (!cal) return;
      const open = cal.hidden;
      closePickers(root);
      cal.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) renderPicker(root.dataset.datePicker);
      return;
    }
    const preset = e.target.closest?.("[data-range-preset]");
    if (preset) {
      applyRangePreset(preset.dataset.rangePreset);
      syncRangeFromPickers();
      closePickers(null);
      renderPicker("from");
      renderPicker("to");
      render();
      return;
    }

    const nav = e.target.closest?.("[data-calendar-action]");
    if (nav) {
      const root = nav.closest("[data-date-picker]");
      const key = root?.dataset.datePicker;
      if (!key) return;
      const act = nav.dataset.calendarAction;
      if (key === "at") {
        if (act === "prev" || act === "next") {
          const m = pickerMonths.at;
          pickerMonths.at = new Date(
            m.getFullYear(),
            m.getMonth() + (act === "prev" ? -1 : 1),
            1,
          );
        } else if (act === "today" || act === "yesterday") {
          const now = new Date();
          if (act === "yesterday") now.setDate(now.getDate() - 1);
          pickerValues.at = dateKey(now);
          pickerMonths.at = monthStart(now);
          closePickers(null);
        } else if (act === "close") {
          closePickers(null);
        }
        renderPicker("at");
        return;
      }
      if (act === "prev" || act === "next") {
        const m = pickerMonths[key];
        const dir = act === "prev" ? -1 : 1;
        pickerMonths[key] = new Date(m.getFullYear(), m.getMonth() + dir, 1);
        renderPicker(key);
        return;
      }
      if (act === "today" || act === "yesterday") {
        const now = new Date();
        if (act === "yesterday") now.setDate(now.getDate() - 1);
        pickerValues[key] = dateKey(now);
        pickerMonths[key] = monthStart(now);
      } else if (act === "clear") {
        // 이 피커의 값만 지운다(반대쪽은 유지 — '기간 해제'가 둘 다 지우는 역할).
        pickerValues[key] = "";
      }
      // today/clear/close 모두 여기서 마무리한다.
      if (act !== "close") {
        // 뒤집힌 범위가 되면 결과가 항상 0건이라 반대쪽을 맞춘다.
        if (
          pickerValues.from &&
          pickerValues.to &&
          pickerValues.from > pickerValues.to
        ) {
          if (key === "from") pickerValues.to = pickerValues.from;
          else pickerValues.from = pickerValues.to;
        }
        syncRangeFromPickers();
      }
      closePickers(null);
      renderPicker("from");
      renderPicker("to");
      render();
      return;
    }
    const day = e.target.closest?.(".popup-calendar-day");
    if (day) {
      const root = day.closest("[data-date-picker]");
      const key = root?.dataset.datePicker;
      if (!key) return;
      pickerValues[key] = day.dataset.date || "";
      if (key === "at") {
        // 대화상자 전용 — 기간 필터·목록과 무관하다.
        closePickers(null);
        renderPicker("at");
        return;
      }
      // 시작 > 종료가 되면 뒤집힌 범위라 결과가 항상 0건이다 → 반대쪽을 맞춰 준다.
      if (
        pickerValues.from &&
        pickerValues.to &&
        pickerValues.from > pickerValues.to
      ) {
        if (key === "from") pickerValues.to = pickerValues.from;
        else pickerValues.from = pickerValues.to;
      }
      syncRangeFromPickers();
      closePickers(null);
      renderPicker("from");
      renderPicker("to");
      render();
      return;
    }
    if (!e.target.closest?.("[data-date-picker]")) closePickers(null);

    if (e.target.closest?.("#lpsRefresh")) {
      const btn = e.target.closest("#lpsRefresh");
      // 보유량 조회까지 끝나야 '새로고침 완료'다 → refreshBalances 도 기다린다.
      void withBusy(btn, async () => {
        await load();
        render();
        await refreshBalances();
      });
    }
  });

  const groupOrderList = document.querySelector("[data-group-order-list]");
  groupOrderList?.addEventListener("dragstart", (e) => {
    const handle = e.target.closest?.("[data-group-drag]");
    const item = handle?.closest?.("[data-group-order-item]");
    if (!item) {
      e.preventDefault();
      return;
    }
    draggedGroupOrderId = item.dataset.groupOrderItem || "";
    item.classList.add("is-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", draggedGroupOrderId);
    }
  });

  groupOrderList?.addEventListener("dragover", (e) => {
    const item = e.target.closest?.("[data-group-order-item]");
    if (!draggedGroupOrderId || !item) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    groupOrderList
      .querySelectorAll(".is-drop-target")
      .forEach((el) => el.classList.remove("is-drop-target"));
    item.classList.add("is-drop-target");
  });

  groupOrderList?.addEventListener("drop", (e) => {
    const item = e.target.closest?.("[data-group-order-item]");
    if (!item || !draggedGroupOrderId) return;
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    dropGroupOrder(
      draggedGroupOrderId,
      item.dataset.groupOrderItem,
      e.clientX >= rect.left + rect.width / 2,
    );
  });

  groupOrderList?.addEventListener("dragend", () => {
    draggedGroupOrderId = "";
    groupOrderList
      .querySelectorAll(".is-dragging, .is-drop-target")
      .forEach((el) => el.classList.remove("is-dragging", "is-drop-target"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeSortMenu();
    closePickers(null);
  });

  document
    .getElementById("lpsFieldTypeCustom")
    ?.addEventListener("input", syncFiveVisibility);

  // 스피너 칸에 직접 친 값도 범위 안으로 맞춘다(포커스가 빠질 때).
  [
    "lpsFieldAmount",
    "lpsFieldFive",
    "lpsFieldHour",
    "lpsFieldMinute",
    "lpsFieldSecond",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => updateSpinDisabled(el));
    el.addEventListener("blur", () => {
      const n = spinRead(el);
      spinWrite(el, n == null ? Number(el.dataset.spinMin || 0) : n);
    });
  });

  // 채널 검색 입력(디바운스 — 글자마다 API 를 부르지 않는다).
  let channelTimer = 0;
  document.getElementById("lpsFieldName")?.addEventListener("input", (e) => {
    const q = e.target.value;
    clearTimeout(channelTimer);
    channelTimer = window.setTimeout(() => void onChannelInput(q), 200);
  });

  document.addEventListener("keydown", (e) => {
    if (zoomFor && e.key === "Escape") {
      e.preventDefault();
      closeZoom();
      return;
    }
    const box = dlg();
    if (box && !box.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDialog();
      } else if (e.key === "Enter" && e.target?.tagName !== "SELECT") {
        e.preventDefault();
        // 채널 후보가 떠 있으면 Enter 는 '첫 후보 선택'으로 쓴다(저장 아님).
        const list = document.getElementById("lpsChannelList");
        if (
          e.target?.id === "lpsFieldName" &&
          list &&
          !list.hidden &&
          channelChoices.length
        ) {
          setPicked(channelChoices[0]);
          return;
        }
        void saveDialog();
      }
      return;
    }
    if (e.key === "Escape" && closeCalendarPopover({ restoreFocus: true })) {
      e.preventDefault();
      return;
    }
    // 목록 행에서 Enter/Space 로도 수정 열기(마우스 없이 쓰는 경우).
    // 예측 상세 토글에 포커스가 있을 때는 펼치기가 우선이다.
    if (e.target?.closest?.(".lps-pred")) return;
    const row = e.target?.closest?.(".lps-row[data-entry-id]");
    if (row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      const entry = entries.find((x) => x.id === row.dataset.entryId);
      if (entry) openDialog(entry);
    }
  });

  document.getElementById("lpsSearch")?.addEventListener("input", (e) => {
    query = String(e.target.value || "").trim();
    render();
  });

  // 다른 탭에서 새로 획득하면 즉시 반영한다.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[LOG_KEY]) {
      const change = changes[LOG_KEY];
      rememberExplorerNewEntries(change.oldValue, change.newValue);
      entries = normalize(change.newValue);
      persistExplorerUnreadState();
      render();
      return;
    }
    if (changes[EXPLORER_UNREAD_IDS_KEY]) {
      const validIds = new Set(entries.map((entry) => entry.id));
      replaceExplorerUnreadIds(
        changes[EXPLORER_UNREAD_IDS_KEY].newValue,
        validIds,
      );
      rebuildExplorerUnreadPaths();
      renderLogBody();
    }
  });

  paintThemeButton();
  renderPicker("from");
  renderPicker("to");
  // 묶음 토글 상태 복원(체크박스에도 반영한 뒤 그린다).
  async function loadGroupPrefs() {
    try {
      const saved = await chrome.storage.local.get([
        GROUP_KEY,
        GROUP_ORDER_KEY,
        VIEW_MODE_KEY,
        BAR_ONLY_KEY,
        LINE_CUMULATIVE_KEY,
      ]);
      const v = saved?.[GROUP_KEY];
      groupByDate = v?.date === true;
      groupByStreamer = v?.streamer === true;
      groupByType = v?.type === true;
      groupOrder = normalizeGroupOrder(saved?.[GROUP_ORDER_KEY]);
      viewMode = ["tree", "explorer", "calendar"].includes(
        saved?.[VIEW_MODE_KEY],
      )
        ? saved[VIEW_MODE_KEY]
        : "tree";
      barEarnedOnly = saved?.[BAR_ONLY_KEY] === true;
      lineCumulative = saved?.[LINE_CUMULATIVE_KEY] === true;
    } catch {}
    const only = document.querySelector("[data-bar-earned-only]");
    if (only) only.checked = barEarnedOnly;
    const cumulative = document.querySelector("[data-line-cumulative]");
    if (cumulative) cumulative.checked = lineCumulative;
    const d = document.querySelector("[data-group-date]");
    const st = document.querySelector("[data-group-streamer]");
    const ty = document.querySelector("[data-group-type]");
    if (d) d.checked = groupByDate;
    if (st) st.checked = groupByStreamer;
    if (ty) ty.checked = groupByType;
    renderGroupOrderControls();
    renderViewModeControls();
  }

  void loadChannelColorPrefs().then(() =>
    loadGroupPrefs().then(() =>
      load().then(() =>
        loadExplorerUnreadState().then(() => {
          render();
          void renderActiveBadge();
          void refreshBalances().then(async () => {
            // 페이지를 열 때 한 번 맞춘다. 기준이 없으면(첫 실행) 기록 없이
            // 스냅샷만 남긴다 — 설치 전 보유분이 기타로 잡히면 안 된다.
            const snap = await loadSnapshot();
            if (!snap?.map) {
              await saveSnapshot();
              return;
            }
            const n = await commitOther();
            if (n) {
              await load();
              rebuildExplorerUnreadPaths();
              persistExplorerUnreadState();
              render();
            }
            // 보유량이 들어오면 채널명을 더 많이 알 수 있다 → 배지를 다시 그린다.
            void renderActiveBadge();
          });
        }),
      ),
    ),
  );

  // 적립 중 배지: 상태가 storage 로 오가므로 변경을 구독하고, 타이머 만료는
  // 이벤트가 없어 30초마다 한 번 더 확인한다.
  // ⚠ 첫 렌더는 load() 뒤에 한다. 곧바로 부르면 entries 가 비어 있어 채널명을
  //   못 찾고 id 가 잠깐 보인다(제보).
  setInterval(() => void renderActiveBadge(), 30000);
  chrome.storage?.onChanged?.addListener((changes, area) => {
    const hit = Object.keys(changes || {}).some(
      (k) =>
        k.startsWith("logpower_watch_reward_state:") ||
        k.startsWith("cheeseLogPowerHourTimer:"),
    );
    if (hit && (area === "session" || area === "local")) {
      void renderActiveBadge();
    }
  });

  // FAB: 스크롤·리사이즈에 따라 노출을 갱신한다(초기화 시 1회 등록).
  window.addEventListener("scroll", scheduleFabUpdate, { passive: true });
  window.addEventListener(
    "resize",
    () => {
      closeCalendarPopover();
      scheduleFabUpdate();
    },
    { passive: true },
  );
  updateFabs();
})();
