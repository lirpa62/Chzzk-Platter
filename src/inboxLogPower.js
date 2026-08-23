// 치즈 플래터 - 수신함 '통나무파워' 탭
// 치지직은 통나무파워를 언제 얼마나 받았는지 볼 방법을 주지 않는다(제보). content.js 가
// 1시간 시청 보상을 획득하는 순간 storage 에 남겨 둔 기록을, 여기서 수신함 탭으로 보여 준다.
//
// ⚠ 커뮤니티 소식 탭(inboxCommunity.js)과 같은 문서에서 함께 돈다. 서로의 DOM 을 건드리지
// 않도록 탭/섹션 id 를 분리하고, 활성 탭 전환은 각자 자기 것만 책임진다.
(() => {
  "use strict";

  if (
    location.hostname !== "game.naver.com" ||
    location.pathname !== "/notify"
  ) {
    return;
  }

  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  const MASTER_ENABLED_KEY = "cheeseMasterEnabled";
  const LOG_KEY = "cheeseLogPowerLog";
  // 탭을 마지막으로 연 시점(가장 최근 적립의 at). 이보다 새 적립이 있으면 붉은 점.
  const READ_KEY = "cheeseLogPowerReadAt";
  const TAB_ID = "cheese-inbox-logpower-tab";
  const SECTION_ID = "cheese-inbox-logpower-section";
  // 프로필이 없거나 불러오지 못하면 치지직 기본 이미지를 쓴다(테마별로 다르다).
  const DEFAULT_PROFILE_LIGHT =
    "https://ssl.pstatic.net/static/nng/glive/image/default_profile_light.png";
  const DEFAULT_PROFILE_DARK =
    "https://ssl.pstatic.net/static/nng/glive/image/default_profile_dark.png";

  const isDark = new URLSearchParams(location.search).get("theme") === "dark";

  let enabled = false;
  // 비로그인이면 통나무파워 자체가 없다 → 탭을 아예 만들지 않는다.
  let loggedIn = false;
  let active = false;
  let entries = [];
  let readAt = 0;
  // 요약 막대의 기간 필터. 통계 페이지의 빠른 기간 버튼과 같은 기준을 쓴다.
  let range = "all";
  let observer = null;
  let ensureTimer = 0;
  let lastSignature = "";

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );

  const formatCount = (n) => Number(n || 0).toLocaleString("ko-KR");
  // 예측 베팅은 음수다. 양수에도 +를 붙여 손익을 구분한다.
  const formatSigned = (n) =>
    Number(n) > 0 ? `+${formatCount(n)}` : formatCount(n);

  function formatWhen(ms) {
    const t = Number(ms) || 0;
    if (!t) return "";
    const d = new Date(t);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (sameDay) return `오늘 ${hh}:${mm}`;
    return `${d.getMonth() + 1}.${d.getDate()} ${hh}:${mm}`;
  }

  function normalizeEntries(raw) {
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
        accountId: String(it?.accountId || ""),
        watchCount: Number(it?.watchCount) || 0,
        autoDetected: it?.autoDetected === true,
        // ⚠ 예측 상세용 필드. 여기서 안 옮기면 저장소에 있어도 화면에서 사라진다
        //   (제보: 수신함에서 예측 상세가 안 보임).
        predictionTitle: String(it?.predictionTitle || ""),
        selectedOptionNo: Number(it?.selectedOptionNo) || 0,
        winningOptionNo: Number(it?.winningOptionNo) || 0,
        betHistory: Array.isArray(it?.betHistory)
          ? it.betHistory.map((b) => ({
              at: Number(b?.at) || 0,
              amount: Number(b?.amount) || 0,
            }))
          : null,
        optionStats: Array.isArray(it?.optionStats)
          ? it.optionStats.map((o) => ({
              optionNo: Number(o?.optionNo) || 0,
              text: String(o?.text || ""),
              participants: Number(o?.participants) || 0,
              powers: Number(o?.powers) || 0,
              percentage: Number(o?.percentage) || 0,
              rate: Number(o?.rate) || 0,
            }))
          : null,
      }))
      .filter((it) => it.id && it.amount !== 0)
      .sort((a, b) => b.at - a.at);
  }

  // ⚠ 이 스크립트는 game.naver.com 에서 돈다. 치지직 origin 의 localStorage 는
  //   읽을 수 없으므로, 아래 로그인 확인에서 받은 userIdHash 를 보관해 쓴다.
  let accountId = "";

  // 계정을 아직 모르면(확인 전·실패) 전체를 보여 준다 — 빈 화면보다 낫다.
  function filterByAccount(list) {
    if (!accountId) return list;
    return list.filter((e) => !e.accountId || e.accountId === accountId);
  }

  async function loadEntries() {
    try {
      const data = await chrome.storage.local.get(LOG_KEY);
      const all = normalizeEntries(data?.[LOG_KEY]);
      // ⚠ 다른 계정 기록이 섞이면 합계가 틀린다. 계정 도입 전 기록(accountId
      //   없음)은 포함한다 — 대부분 단일 계정이라 빼면 과거가 사라져 보인다.
      entries = filterByAccount(all);
    } catch {
      entries = [];
    }
  }

  // ⚠ 읽음 시각을 계정마다 따로 둔다. 하나로 공유하면 A 계정에서 읽었을 때
  //   B 계정의 새 적립까지 읽은 것이 돼 점이 사라진다.
  //   저장 형태: { [accountId]: at }. 옛 버전은 숫자 하나였다 → 현재 계정 것으로
  //   물려받는다(마이그레이션).
  function readMapOf(raw) {
    if (raw && typeof raw === "object") return { ...raw };
    const legacy = Number(raw) || 0;
    return legacy && accountId ? { [accountId]: legacy } : {};
  }

  function readAtFor(raw) {
    const map = readMapOf(raw);
    return Number(map[accountId || ""]) || 0;
  }

  async function saveReadAt(at) {
    try {
      const raw = (await chrome.storage.local.get(READ_KEY))?.[READ_KEY];
      const map = readMapOf(raw);
      map[accountId || ""] = at;
      await chrome.storage.local.set({ [READ_KEY]: map });
    } catch {}
  }

  async function loadReadAt() {
    try {
      const data = await chrome.storage.local.get(READ_KEY);
      const saved = readAtFor(data?.[READ_KEY]);
      if (saved) {
        readAt = saved;
        return;
      }
      // ⚠ 처음 쓰는 경우(기준 없음)에는 기존 적립 전부가 '새 것'으로 잡혀
      //    점이 켜진 채 시작한다 → 현재 최신 적립을 기준으로 삼아 조용히 시작.
      readAt = latestAt();
      if (readAt) void saveReadAt(readAt);
    } catch {
      readAt = 0;
    }
  }

  // entries 는 최신순 정렬이므로 첫 항목이 가장 최근 적립이다.
  function latestAt() {
    return entries.length ? Number(entries[0].at) || 0 : 0;
  }

  function hasUnread() {
    return latestAt() > readAt;
  }

  // 탭을 열면 그 시점의 최신 적립까지 '읽음'으로 표시한다.
  function markRead() {
    const at = latestAt();
    if (!at || at <= readAt) return;
    readAt = at;
    void saveReadAt(at);
  }

  // 커뮤니티 소식 탭과 같은 방식: 노드를 붙이지 않고 has-new 클래스 + ::after.
  function syncTabDot() {
    // 탭이 열려 있는 동안에는 점을 띄우지 않는다(이미 보고 있는 내용이다).
    const show = enabled && !active && hasUnread();
    document.getElementById(TAB_ID)?.classList.toggle("has-new", show);
  }

  // 통계 페이지(logPowerStats.js)의 periodStarts 와 같은 기준 — 주는 월요일 시작.
  function periodStarts(now = new Date()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const week = new Date(today);
    week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    return { today: +today, week: +week, month: +month };
  }

  function rangeStart(kind = range) {
    if (kind === "all") return 0;
    const p = periodStarts();
    return p[kind] || 0;
  }

  function visibleEntries() {
    const from = rangeStart();
    return from ? entries.filter((it) => it.at >= from) : entries;
  }

  const RANGES = [
    ["today", "오늘"],
    ["week", "이번 주"],
    ["month", "이번 달"],
    ["all", "전체"],
  ];

  function rangeButtonsHtml() {
    return (
      `<div class="cheese-inbox-logpower-range" role="group" aria-label="기간 선택">` +
      RANGES.map(
        ([key, label]) =>
          `<button type="button" data-range="${key}"` +
          `${key === range ? ' aria-pressed="true"' : ' aria-pressed="false"'}>` +
          `${label}</button>`,
      ).join("") +
      `</div>`
    );
  }

  // 치지직 수신함은 항목을 '오늘/최근 일주일/…' 로 묶고 <strong class="_timestamp_…">
  // 머리글을 단다. 클래스 해시는 배포마다 바뀌므로 접두사로 찾아 실물에서 걷어 온다.
  // 못 찾으면 우리 클래스만 남고 자체 CSS 가 적용된다.
  function harvestTimestampClass() {
    const el = document.querySelector(
      "#root [class*='_timestamp_'], #root strong[class*='timestamp']",
    );
    return el?.className || "";
  }

  // 머리글 글꼴을 수신함 탭과 맞춘다. 폰트는 클래스를 걷어 와도 따라오지 않는
  // 경우가 있어(탭 전용 규칙) 계산된 font-family 를 읽어 변수로 넘긴다.
  function harvestTabFont(section) {
    if (!section) return;
    // 우리가 주입한 탭이 아니라 치지직 원본 탭에서 읽는다(순환 방지).
    const tab = document.querySelector(
      "#root [role='tab']:not(#cheese-inbox-logpower-tab)",
    );
    if (!tab) return;
    const font = getComputedStyle(tab).fontFamily;
    if (font) section.style.setProperty("--cheese-inbox-tab-font", font);
  }

  // 적립 종류 라벨(claim-list 의 title 과 같은 뜻). 시청 보상은 기존 표기를 쓰므로
  // 여기서는 시청 외 유형만 다룬다.
  const CLAIM_LABELS = {
    FOLLOW: "팔로우 보상",
    DONATE: "후원 보상",
    DONATE_MONTHLY: "월별 첫 후원 보상",
    SUBSCRIPTION_GIFT: "구독 선물 보상",
    SUBSCRIPTION_GIFT_MONTHLY: "월별 첫 구독 선물 보상",
    PREDICTION_BET: "승부예측 베팅",
    PREDICTION_WIN: "승부예측 적중",
    PREDICTION_REFUND: "승부예측 취소",
    PREDICTION_LOST: "승부예측 실패",
    OTHER_GAIN: "기타 적립",
    OTHER_LOSS: "기타 사용",
    WATCH_5_MIN: "5분 시청 보상",
  };
  // ⚠ '1시간 + 5분 합계' 두 줄은 1시간 보상에만 해당한다. WATCH_ 접두사로 묶으면
  //   WATCH_5_MIN 까지 걸려 5분 보상이 '1시간 보상'으로 표시된다(제보).
  const isHourClaim = (t) => !t || t === "WATCH_1_HOUR";
  const PRED_TYPES = new Set([
    "PREDICTION_BET",
    "PREDICTION_WIN",
    "PREDICTION_LOST",
    "PREDICTION_REFUND",
  ]);

  // 베팅 줄에 '맞혔다면 얼마' 를 덧붙인다.
  // ⚠ 마감(EXPIRED)부터 추가 베팅이 막혀 배분율이 확정되므로, optionStats 가
  //   있으면 '예상'이 아니라 확정 배당 기준 금액이다.
  function expectedWinHtml(it) {
    if (it.claimType !== "PREDICTION_BET") return "";
    const mine = it.optionStats?.find(
      (o) => o.optionNo === it.selectedOptionNo,
    );
    if (!mine?.rate) return "";
    const payout = Math.round(Math.abs(it.amount) * mine.rate);
    return (
      `<span class="cheese-inbox-logpower-expect" title="확정 배분율 ×${escapeHtml(String(mine.rate))} 기준">` +
      `적중 시 ${formatCount(payout)}</span>`
    );
  }

  // 선택지 막대. 통계 페이지와 같은 형태로 그린다.
  // ⚠ 마감 전(winningOptionNo 0)에는 정답이 없다 — 내 선택만 표시한다.
  function predictionStatsHtml(it) {
    const stats = it.optionStats;
    if (!Array.isArray(stats) || !stats.length) return "";
    const rows = stats
      .map((o) => {
        const mine = o.optionNo === it.selectedOptionNo;
        const win = it.winningOptionNo > 0 && o.optionNo === it.winningOptionNo;
        const cls = ["cheese-inbox-logpower-pred-item"];
        if (mine) cls.push("is-mine");
        if (win) cls.push("is-win");
        const pct = Math.max(0, Math.min(100, Number(o.percentage) || 0));
        return (
          `<li class="${cls.join(" ")}">` +
          `<span class="cheese-inbox-logpower-pred-bar" style="width:${pct}%"></span>` +
          `<span class="cheese-inbox-logpower-pred-row">` +
          `<b>${escapeHtml(o.text || "-")}</b>` +
          `<span>${formatCount(o.participants)}명 · ${formatCount(o.powers)} · ×${o.rate}</span>` +
          `<em>${formatCount(pct)}%</em>` +
          `</span>` +
          `</li>`
        );
      })
      .join("");
    const title = it.predictionTitle
      ? `<p class="cheese-inbox-logpower-pred-title">${escapeHtml(it.predictionTitle)}</p>`
      : "";
    const pending =
      it.winningOptionNo > 0
        ? ""
        : `<p class="cheese-inbox-logpower-pred-note">정산 대기 중</p>`;
    // 나눠 건 이력(2회 이상일 때만).
    const h = it.betHistory;
    const hist =
      Array.isArray(h) && h.length >= 2
        ? `<div class="cheese-inbox-logpower-pred-hist">` +
          `<span>나눠 건 이력 ${formatCount(h.length)}회</span>` +
          `<ul>` +
          h
            .map(
              (b) =>
                `<li><span>${escapeHtml(formatWhen(b.at))}</span>` +
                `<b>${formatSigned(-b.amount)}</b></li>`,
            )
            .join("") +
          `</ul></div>`
        : "";
    return (
      title +
      `<ul class="cheese-inbox-logpower-pred-list">${rows}</ul>` +
      hist +
      pending
    );
  }

  // 금액 줄 색상. 예측은 종류별로 달리한다(베팅=주황, 적중=초록).
  // ⚠ 라벨과 숫자를 한 span 에 넣으므로 색이 문구까지 함께 적용된다.
  function amountClass(it) {
    if (it.claimType === "PREDICTION_BET") return " is-bet";
    if (it.claimType === "PREDICTION_WIN") return " is-win";
    return it.amount < 0 ? " is-neg" : "";
  }

  // 부스팅 배수 → 구독 티어. 실측값: 미구독 100, 티어1 120(×1.2), 티어2 200(×2).
  // boost 는 '실지급액 / 기본단가'로 계산한 값이라 티어를 직접 받지 않는다.
  // 아는 배수만 티어를 붙이고, 모르는 값은 배수만 표기해 틀린 정보를 만들지 않는다.
  function boostLabel(boost) {
    const tier = boost === 2 ? 2 : boost === 1.2 ? 1 : 0;
    return tier ? `${tier}티어 구독 ×${boost}` : `구독 ×${boost}`;
  }

  // 항목을 시간대 구간으로 나눈다. 경계는 치지직 표기와 같은 뜻으로 맞춘다.
  const GROUPS = [
    ["오늘", (at, p) => at >= p.today],
    ["최근 일주일", (at, p) => at >= p.week7],
    ["최근 한달", (at, p) => at >= p.month30],
    ["이전 활동", () => true],
  ];

  function groupEntries(list) {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const p = {
      today: +today,
      week7: +today - 6 * 86400000, // 오늘 포함 7일
      month30: +today - 29 * 86400000, // 오늘 포함 30일
    };
    const out = GROUPS.map(([label]) => ({ label, items: [] }));
    for (const it of list) {
      const idx = GROUPS.findIndex(([, test]) => test(it.at, p));
      out[idx === -1 ? out.length - 1 : idx].items.push(it);
    }
    return out.filter((g) => g.items.length);
  }

  function getNativeNodes() {
    const tabList = document.querySelector("#root [role='tablist']");
    if (!tabList) return {};
    const nativeTab = tabList.querySelector("button[role='tab']");
    let nativeSection = tabList.nextElementSibling;
    if (nativeSection?.tagName !== "SECTION") {
      nativeSection = tabList.parentElement?.querySelector(":scope > section");
    }
    return { tabList, nativeTab, nativeSection };
  }

  function renderSection() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    const sig = `${entries.length}|${entries[0]?.id || ""}|${range}`;
    if (sig === lastSignature) return; // 멱등(불필요한 노드 교체 방지)
    lastSignature = sig;

    // 변수는 섹션에 두므로 어느 분기로 그려지든 한 번만 걷어 오면 된다.
    harvestTabFont(section);

    const openBtn =
      `<button type="button" class="cheese-inbox-logpower-open" ` +
      `title="새 탭에서 자세히 보기" aria-label="새 탭에서 자세히 보기">` +
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="M15 3h6v6"/><path d="M10 14 21 3"/>` +
      `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>` +
      `</button>`;

    if (!entries.length) {
      section.innerHTML =
        `<div class="cheese-inbox-logpower-summary"><span>기록 없음</span>${openBtn}</div>` +
        `<p class="cheese-inbox-logpower-empty">아직 기록된 통나무파워 획득이 없습니다.` +
        `<br>설정에서 <b>통나무파워 자동 획득</b>을 켜 두면 1시간 시청 보상을 받을 때마다 여기에 쌓입니다.</p>`;
      return;
    }

    const shown = visibleEntries();
    const total = shown.reduce(
      (sum, it) => sum + it.amount + (it.fiveMinAmount || 0),
      0,
    );
    const summary =
      `<div class="cheese-inbox-logpower-summary">` +
      `<span>기록 ${formatCount(shown.length)}건</span>` +
      `<strong>합계 ${formatCount(total)}</strong>` +
      openBtn +
      `</div>` +
      rangeButtonsHtml();

    // 기록은 있지만 고른 기간에만 없는 경우 — 버튼은 남겨야 다른 기간으로 옮길 수 있다.
    if (!shown.length) {
      section.innerHTML =
        summary +
        `<p class="cheese-inbox-logpower-empty">이 기간에는 획득 기록이 없습니다.</p>`;
      return;
    }

    const itemHtml = (it) => {
      // 같은 시간 동안 받은 5분 보상 합계(기록 시점에 실제 단가로 계산해 둔 값).
      const fiveMin = it.fiveMinAmount;
      const fallback = isDark ? DEFAULT_PROFILE_DARK : DEFAULT_PROFILE_LIGHT;
      const profile =
        `<img class="cheese-inbox-logpower-profile" src="${escapeHtml(it.channelImageUrl || fallback)}" ` +
        `data-fallback="${escapeHtml(fallback)}" alt="" width="28" height="28" loading="lazy">`;
      // 파트너(인증) 배지 — 치지직 공식 아이콘을 CSS 배경으로 붙인다.
      const mark = it.verifiedMark
        ? `<i class="cheese-inbox-logpower-mark" aria-hidden="true"></i><span class="cheese-inbox-logpower-a11y">인증 마크</span>`
        : "";
      // 예측 상세는 접어 둔다. ⚠ 목록에 있는 모든 예측을 미리 그리면 선택지
      //   막대가 수십 개씩 쌓인다 — 펼칠 때 채운다(아래 toggle 위임).
      const pred =
        PRED_TYPES.has(it.claimType) && it.optionStats?.length
          ? `<details class="cheese-inbox-logpower-pred" data-pred-id="${escapeHtml(String(it.id || ""))}">` +
            `<summary>예측 상세</summary>` +
            `<div class="cheese-inbox-logpower-pred-body"></div>` +
            `</details>`
          : "";
      return (
        `<li>` +
        `<div class="cheese-inbox-logpower-row">` +
        profile +
        `<strong>${escapeHtml(it.channelName || "채널")}${mark}</strong>` +
        `<span class="cheese-inbox-logpower-when">${escapeHtml(formatWhen(it.at))}</span>` +
        `</div>` +
        `<div class="cheese-inbox-logpower-amounts">` +
        // 시청 보상은 '1시간 + 5분 합계' 두 줄, 그 외(팔로우/후원/구독선물)는
        // 유형 이름과 금액 한 줄로 보여 준다.
        (isHourClaim(it.claimType)
          ? `<span class="cheese-inbox-logpower-hour">1시간 보상 <b>${formatCount(it.amount)}</b></span>` +
            (fiveMin
              ? `<span class="cheese-inbox-logpower-five">5분 보상 합계 <b>${formatCount(fiveMin)}</b></span>`
              : "")
          : `<span class="cheese-inbox-logpower-hour${amountClass(it)}">${escapeHtml(
              CLAIM_LABELS[it.claimType] || "적립",
            )} <b>${formatSigned(it.amount)}</b></span>` +
            (it.autoDetected
              ? `<span class="cheese-inbox-logpower-auto" title="보유량 비교로 찾은 적립입니다. 시각은 감지한 때입니다.">자동 감지</span>`
              : "") +
            (it.claimType === "WATCH_5_MIN" && it.watchCount > 0
              ? `<span class="cheese-inbox-logpower-count">${formatCount(it.watchCount)}회</span>`
              : "") +
            expectedWinHtml(it)) +
        // 구독 부스팅이 걸린 획득이면 배수를 함께 보여 준다(1배는 생략).
        (it.boost > 1
          ? `<span class="cheese-inbox-logpower-boost">${escapeHtml(boostLabel(it.boost))}</span>`
          : "") +
        `</div>` +
        pred +
        `</li>`
      );
    };

    // 치지직 수신함과 같은 시간대 머리글로 묶는다.
    const tsClass = harvestTimestampClass();
    const headClass = tsClass
      ? `${tsClass} cheese-inbox-logpower-timestamp`
      : "cheese-inbox-logpower-timestamp";
    section.innerHTML =
      summary +
      groupEntries(shown)
        .map(
          (g) =>
            `<strong class="${escapeHtml(headClass)}">${escapeHtml(g.label)}</strong>` +
            `<ul class="cheese-inbox-logpower-list">` +
            g.items.map(itemHtml).join("") +
            `</ul>`,
        )
        .join("");

    // 예측 상세는 펼칠 때 채운다(미리 그리면 목록 전체에 막대가 쌓인다).
    section
      .querySelectorAll(".cheese-inbox-logpower-pred[data-pred-id]")
      .forEach((el) => {
        el.addEventListener("toggle", () => {
          if (!el.open) return;
          const body = el.querySelector(".cheese-inbox-logpower-pred-body");
          if (!body || body.dataset.filled === "1") return;
          const hit = shown.find(
            (x) => String(x?.id || "") === el.dataset.predId,
          );
          if (!hit) return;
          body.innerHTML = predictionStatsHtml(hit);
          body.dataset.filled = "1";
        });
      });

    // 링크가 만료된 프로필은 로드에 실패한다 → 기본 이미지로 되돌린다.
    section.querySelectorAll("img[data-fallback]").forEach((image) => {
      image.addEventListener(
        "error",
        () => {
          if (image.src !== image.dataset.fallback) {
            image.src = image.dataset.fallback;
          }
        },
        { once: true },
      );
    });
  }

  // 커뮤니티 소식 탭도 같은 문서에서 자기 섹션을 관리한다. 우리가 활성화될 때
  // 그쪽 탭이 켜져 있으면 꺼 줘야 두 패널이 겹치지 않는다(반대 방향은 그쪽에서
  // 우리 탭 클릭을 감지해 처리한다 — 아래 document 클릭 리스너).
  const COMMUNITY_TAB_ID = "cheese-inbox-community-tab";
  const COMMUNITY_SECTION_ID = "cheese-inbox-community-section";

  function deactivateCommunityTab() {
    const cTab = document.getElementById(COMMUNITY_TAB_ID);
    const cSection = document.getElementById(COMMUNITY_SECTION_ID);
    if (cTab) cTab.setAttribute("aria-selected", "false");
    if (cSection) {
      cSection.classList.remove("is-active");
      cSection.setAttribute("aria-hidden", "true");
    }
    document.documentElement.classList.remove("cheese-inbox-community-active");
    // 커뮤니티 탭이 숨겨 둔 치지직 원래 섹션을 되살린다.
    document
      .querySelectorAll(".cheese-inbox-community-native-hidden")
      .forEach((n) =>
        n.classList.remove("cheese-inbox-community-native-hidden"),
      );
  }

  // 새 탭 열기 버튼은 위임으로 처리한다. 목록이 다시 그려져도 유지되고,
  // once 를 쓰면 재렌더 뒤 버튼이 죽는다.
  // 기간 버튼. 섹션이 통째로 다시 그려지므로 위임으로 받는다.
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(
      ".cheese-inbox-logpower-range [data-range]",
    );
    if (!btn) return;
    e.preventDefault();
    const next = btn.dataset.range;
    if (!next || next === range) return;
    range = next;
    lastSignature = ""; // 멱등 검사를 풀어 강제로 다시 그린다
    renderSection();
  });

  document.addEventListener("click", (e) => {
    if (!e.target?.closest?.(".cheese-inbox-logpower-open")) return;
    e.preventDefault();
    // 확장 내부 페이지라 chrome-extension:// URL 로 연다.
    window.open(chrome.runtime.getURL("logPowerStats.html"), "_blank");
  });

  function applyActiveState() {
    const tab = document.getElementById(TAB_ID);
    const section = document.getElementById(SECTION_ID);
    if (!tab || !section) return;
    const { tabList, nativeSection } = getNativeNodes();
    if (active) deactivateCommunityTab();
    // 우리 탭이 활성이면 다른 탭의 aria 를 내린다(치지직 상태는 React 가 복구한다).
    tabList?.querySelectorAll("button[role='tab']").forEach((btn) => {
      if (btn !== tab && active) btn.setAttribute("aria-selected", "false");
    });
    tab.setAttribute("aria-selected", String(active));
    section.setAttribute("aria-hidden", String(!active));
    section.classList.toggle("is-active", active);
    // 우리 탭이 활성인 동안에는 치지직 원래 섹션을 숨긴다(커뮤니티 탭과 같은 방식).
    nativeSection?.classList.toggle(
      "cheese-inbox-logpower-native-hidden",
      active,
    );
    document.documentElement.classList.toggle(
      "cheese-inbox-logpower-active",
      active,
    );
    syncTabDot();
  }

  // 다른 탭(치지직 기본 또는 커뮤니티 소식)을 누르면 우리 탭을 내린다.
  document.addEventListener(
    "click",
    (e) => {
      if (!enabled || !active) return;
      const btn = e.target?.closest?.("button[role='tab']");
      if (!btn || btn.id === TAB_ID) return;
      active = false;
      const section = document.getElementById(SECTION_ID);
      if (section) {
        section.classList.remove("is-active");
        section.setAttribute("aria-hidden", "true");
      }
      document.getElementById(TAB_ID)?.setAttribute("aria-selected", "false");
      document
        .querySelectorAll(".cheese-inbox-logpower-native-hidden")
        .forEach((n) =>
          n.classList.remove("cheese-inbox-logpower-native-hidden"),
        );
      document.documentElement.classList.remove("cheese-inbox-logpower-active");
      syncTabDot();
    },
    true,
  );

  function ensureUi() {
    if (!enabled) {
      cleanupUi();
      return;
    }
    const { tabList, nativeTab, nativeSection } = getNativeNodes();
    if (!tabList || !nativeTab || !nativeSection) return;

    let tab = document.getElementById(TAB_ID);
    if (!tab || !tabList.contains(tab)) {
      const item = document.createElement("li");
      item.className = nativeTab.parentElement?.className || "";
      item.setAttribute("role", "presentation");
      tab = document.createElement("button");
      tab.id = TAB_ID;
      tab.type = "button";
      tab.className = nativeTab.className;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.textContent = "통나무파워";
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        active = true;
        markRead();
        applyActiveState();
      });
      item.appendChild(tab);
      // 커뮤니티 소식 탭이 있으면 그 뒤, 없으면 마지막 자식으로.
      tabList.appendChild(item);
    }

    let section = document.getElementById(SECTION_ID);
    if (!section || section.parentElement !== nativeSection.parentElement) {
      section?.remove();
      section = document.createElement("section");
      section.id = SECTION_ID;
      section.className =
        `${nativeSection.className} cheese-inbox-logpower-section${
          isDark ? " is-dark" : ""
        }`.trim();
      section.setAttribute("role", "tabpanel");
      section.setAttribute("aria-labelledby", TAB_ID);
      nativeSection.parentElement.appendChild(section);
      lastSignature = "";
    }
    renderSection();
    applyActiveState();
  }

  function cleanupUi() {
    active = false;
    document.documentElement.classList.remove("cheese-inbox-logpower-active");
    document.getElementById(TAB_ID)?.parentElement?.remove();
    document.getElementById(SECTION_ID)?.remove();
    document
      .querySelectorAll(".cheese-inbox-logpower-native-hidden")
      .forEach((n) =>
        n.classList.remove("cheese-inbox-logpower-native-hidden"),
      );
    lastSignature = "";
  }

  function scheduleEnsure() {
    if (ensureTimer) return;
    ensureTimer = window.setTimeout(() => {
      ensureTimer = 0;
      ensureUi();
    }, 120);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  async function applyFlags() {
    let master = true;
    let hidden = null;
    try {
      const data = await chrome.storage.local.get([
        MASTER_ENABLED_KEY,
        FEATURE_HIDDEN_KEY,
      ]);
      master = data?.[MASTER_ENABLED_KEY] !== false;
      hidden = data?.[FEATURE_HIDDEN_KEY];
    } catch {}
    // ⚠ 전용 숨김 플래그를 쓴다. 예전엔 chatLogPower(채팅창 배지 표시)를 함께 봤는데,
    // 그건 '채팅창에 배지를 띄울지'를 정하는 값이라 수신함 탭까지 좌우하는 건 맞지 않다.
    const next = master && hidden?.inboxLogPower !== true && loggedIn;
    if (next === enabled) return;
    enabled = next;
    if (enabled) {
      // ⚠ 순서 중요: loadReadAt 은 기준이 없을 때 latestAt() 을 쓰므로
      //    entries 가 먼저 채워져 있어야 한다.
      await loadEntries();
      await loadReadAt();
      startObserver();
      scheduleEnsure();
    } else {
      stopObserver();
      cleanupUi();
    }
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[MASTER_ENABLED_KEY] || changes[FEATURE_HIDDEN_KEY]) {
      void applyFlags();
    }
    if (changes[LOG_KEY]) {
      // ⚠ 여기서 전체를 대입하면 계정 필터가 풀린다.
      entries = filterByAccount(normalizeEntries(changes[LOG_KEY].newValue));
      lastSignature = "";
      renderSection();
      // 탭을 보고 있는 중이면 방금 들어온 적립까지 읽은 것으로 친다.
      if (active) markRead();
      syncTabDot();
    }
    if (changes[READ_KEY]) {
      // 다른 탭(창)에서 읽었으면 여기서도 점을 내린다(내 계정 값만).
      readAt = readAtFor(changes[READ_KEY].newValue);
      syncTabDot();
    }
  });

  // 로그인 여부를 먼저 확인한 뒤 탭을 붙일지 정한다.
  (async () => {
    try {
      const res = await fetch(
        "https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus",
        { credentials: "include" },
      );
      const json = res.ok ? await res.json() : null;
      const hash = String(json?.content?.userIdHash || "")
        .trim()
        .toLowerCase();
      loggedIn = /^[0-9a-f]{32}$/.test(hash);
      // 계정 필터에 쓴다(로컬스토리지를 못 읽는 origin 이라 이 값이 유일하다).
      if (loggedIn) {
        accountId = hash;
        await loadEntries(); // 계정을 알게 됐으니 다시 걸러 담는다
      }
    } catch {
      loggedIn = false;
    }
    void applyFlags();
  })();
})();
