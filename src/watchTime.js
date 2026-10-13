// 치즈 플래터 - 시청 시간 기록 화면(watchTime.html).
// 저장 형식·모아 보기는 watchTimeStore.js 가 맡는다. 여기서는 기간·계정·종류로 걸러
// 요약·날짜별 그래프·채널별 표·채널 상세를 그린다. 주소의 ?channel=<id> 는 그 채널
// 상세를 열어 둔다('사용 중인 프로필' 팝업의 '통계' 단추).
(() => {
  "use strict";

  const STORE = globalThis.CheeseWatchTimeStore;
  const META_KEY = "cheeseWatchTimeChannels"; // 채널 이름·사진 캐시
  const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const THEME_KEY = "cheeseSearchTheme";
  const MODES = ["live", "vod", "radio"];
  const $ = (id) => document.getElementById(id);
  const fmt = (seconds) => STORE.formatDuration(seconds);
  const fmtOrDash = (seconds) => (seconds > 0 ? fmt(seconds) : "-");
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const state = {
    range: "30",
    from: "",
    to: "",
    login: "all",
    modes: [...MODES],
    channelId: "",
    shards: {},
    allDays: [],
    meta: {},
    enabled: true,
  };

  const pad = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function addDays(date, days) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }

  // 고른 기간 → { from, to } (포함, 비우면 끝없음)
  function rangeBounds() {
    const today = dateKey(new Date());
    switch (state.range) {
      case "today": return { from: today, to: today };
      case "7": return { from: addDays(today, -6), to: today };
      case "30": return { from: addDays(today, -29), to: today };
      case "month": return { from: `${today.slice(0, 7)}-01`, to: today };
      case "year": return { from: `${today.slice(0, 4)}-01-01`, to: today };
      case "custom": return { from: state.from, to: state.to };
      default: return { from: "", to: "" };
    }
  }

  async function load() {
    const get = (keys) => chrome.storage.local.get(keys);
    const [shards, data] = await Promise.all([
      STORE.loadShards(get),
      get([META_KEY, STORE.ENABLED_KEY]),
    ]);
    state.shards = shards;
    state.allDays = Object.keys(shards).sort();
    state.meta = data?.[META_KEY] && typeof data[META_KEY] === "object" ? data[META_KEY] : {};
    state.enabled = data?.[STORE.ENABLED_KEY] === true;
    render();
    void fetchMissingMeta();
  }

  function filter(extra = {}) {
    return { ...rangeBounds(), login: state.login, modes: state.modes, ...extra };
  }

  function channelName(id) {
    return state.meta[id]?.name || `${id.slice(0, 8)}…`;
  }
  // 프로필 이미지는 치지직 리사이즈 썸네일로 받는다(채팅 리캡 profileThumb 과 같다).
  // ⚠ 원본은 수백 KB 라 채널이 많으면 눈에 띄게 늦게 뜬다.
  function channelImage(id) {
    const url = String(state.meta[id]?.image || "");
    if (!url || /[?&]type=/.test(url)) return url;
    return `${url}${url.includes("?") ? "&" : "?"}type=f120_120_na`;
  }
  // 이름 + 파트너 인증 마크(통나무파워 내역과 같은 아이콘).
  function channelNameHtml(id) {
    return `<span class="wt-name">${esc(channelName(id))}</span>` +
      (state.meta[id]?.verified ? '<i class="wt-mark" aria-hidden="true"></i><span class="wt-a11y">인증 마크</span>' : "");
  }

  // scale: 0~1, 막대 길이(날짜별 상세에서 가장 많이 본 날 대비).
  function stackBar(totals, scale = 1) {
    const sum = MODES.reduce((acc, mode) => acc + totals[mode], 0);
    if (!sum) return '<span class="wt-stack"></span>';
    return `<span class="wt-stack" style="width:${Math.max(4, scale * 100)}%">${MODES.map((mode) => totals[mode]
      ? `<i class="is-${mode}" style="width:${(totals[mode] / sum) * 100}%" title="${STORE.MODE_LABELS[mode]} ${fmt(totals[mode])}"></i>`
      : "").join("")}</span>`;
  }

  function render() {
    $("wtDisabled").hidden = state.enabled;
    for (const button of document.querySelectorAll("#wtRange [data-range]")) {
      const on = button.dataset.range === state.range;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", String(on));
    }
    $("wtCustomRange").hidden = state.range !== "custom";
    for (const button of document.querySelectorAll("#wtLogin [data-login]")) {
      const on = button.dataset.login === state.login;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-checked", String(on));
    }

    const result = STORE.aggregate(state.shards, filter());
    const channels = Object.entries(result.byChannel).sort((a, b) => b[1].total - a[1].total);
    const days = Object.keys(result.byDay);
    $("wtTotal").textContent = fmt(result.total);
    $("wtTotalSplit").textContent = [
      result.login ? `로그인 ${fmt(result.login)}` : "",
      result.guest ? `비로그인 ${fmt(result.guest)}` : "",
    ].filter(Boolean).join(" · ");
    $("wtChannels").textContent = `${channels.length.toLocaleString("ko-KR")}개`;
    $("wtAverage").textContent = days.length ? fmt(result.total / days.length) : "-";
    $("wtDays").textContent = days.length ? `${days.length.toLocaleString("ko-KR")}일 기록` : "";
    $("wtTop").innerHTML = channels.length ? channelNameHtml(channels[0][0]) : "-";
    $("wtTopTime").textContent = channels.length ? fmt(channels[0][1].total) : "";

    state.chartDays = result.byDay;
    state.chartChannels = channels;
    drawMainChart();
    $("wtChannelRows").innerHTML = channels.map(([id, totals], index) => `
      <tr data-channel="${esc(id)}" class="${id === state.channelId ? "is-selected" : ""}" tabindex="0">
        <td>${index + 1}</td>
        <td class="wt-channel-cell">${channelImage(id) ? `<img class="wt-avatar" src="${esc(channelImage(id))}" alt="" loading="lazy" />` : '<span class="wt-avatar"></span>'}<span class="wt-name-wrap">${channelNameHtml(id)}</span></td>
        <td><b>${fmt(totals.total)}</b><small>${result.total ? Math.round((totals.total / result.total) * 1000) / 10 : 0}%</small></td>
        <td>${stackBar(totals)}</td>
        <td>${fmtOrDash(totals.login)}</td>
        <td>${fmtOrDash(totals.guest)}</td>
      </tr>`).join("");
    $("wtEmpty").hidden = channels.length > 0;
    renderDetail();
  }

  // 날짜별 막대(종류별로 쌓는다). 막대 단위는 그래프의 실제 폭으로 정한다: 날마다 막대가
  // 들어가면 일, 아니면 주, 그래도 많으면 달. 날짜 글자는 겹치지 않을 만큼 걸러 보인다.
  // ⚠ 막대 수로만 정하면(예전 92일 기준) 창을 줄였을 때 막대는 그대로 많고 글자가 겹쳤다.
  const BAR_MIN_PX = 10; // 막대 하나(+간격)의 최소 폭
  const LABEL_PX = 40; // 날짜 글자 하나가 차지하는 폭
  const MONTH_DAYS = 31;

  function weekStart(date) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일
    return dateKey(d);
  }
  function nextMonth(month) {
    const [y, m] = month.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  }

  // result.byDay → [label, totals][] (빈 구간 포함)
  function chartBuckets(byDay, from, to, width) {
    const spanDays = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
    const capacity = Math.max(4, Math.floor(width / BAR_MIN_PX));
    const unit = spanDays <= capacity ? "day" : Math.ceil(spanDays / 7) <= capacity ? "week" : "month";
    const keyOf = unit === "day" ? (d) => d : unit === "week" ? weekStart : (d) => d.slice(0, 7);
    const buckets = new Map();
    if (unit === "month") {
      for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
        buckets.set(month, { live: 0, vod: 0, radio: 0, total: 0 });
      }
    } else {
      for (let date = keyOf(from); date <= to; date = addDays(date, unit === "day" ? 1 : 7)) {
        buckets.set(date, { live: 0, vod: 0, radio: 0, total: 0 });
      }
    }
    for (const [date, totals] of Object.entries(byDay)) {
      if (date < from || date > to) continue;
      const bucket = buckets.get(keyOf(date));
      if (!bucket) continue;
      for (const mode of MODES) bucket[mode] += totals[mode];
      bucket.total += totals.total;
    }
    return { unit, buckets };
  }

  function bucketLabel(unit, key) {
    if (unit === "month") return key.slice(2).replace("-", ".");
    return key.slice(5).replace("-", ".") + (unit === "week" ? "~" : "");
  }

  // 그래프 범위(기간을 고르지 않았으면 기록이 있는 날까지)와 안쪽 폭.
  function chartFrame(chart, byDay, range) {
    const recorded = Object.keys(byDay).sort();
    const from = range.from || recorded[0] || "";
    const to = range.to || recorded.at(-1) || "";
    const style = getComputedStyle(chart);
    // 아직 그려지지 않았으면 넉넉히 본다.
    const width = (chart.clientWidth || 800) -
      (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    return { from, to, width, empty: !from || !to || from > to };
  }

  // 막대/꺾은선 공용 정리. 꺾은선 차트(Chart.js)는 다시 그리기 전에 치운다.
  const lineCharts = new WeakMap();
  function clearChart(chart) {
    lineCharts.get(chart)?.destroy();
    lineCharts.delete(chart);
    chart.classList.remove("is-line");
  }

  function renderChart(chart, byDay, range = rangeBounds()) {
    if (!chart) return;
    clearChart(chart);
    const { from, to, width, empty } = chartFrame(chart, byDay, range);
    if (empty) {
      chart.innerHTML = '<p class="wt-empty">기록이 없습니다.</p>';
      return;
    }
    const { unit, buckets } = chartBuckets(byDay, from, to, width);
    const max = Math.max(1, ...[...buckets.values()].map((b) => b.total));
    const every = Math.max(1, Math.ceil(LABEL_PX / Math.max(1, width / buckets.size)));
    chart.dataset.unit = unit;
    chart.innerHTML = [...buckets].map(([key, b], index) => {
      const label = bucketLabel(unit, key);
      const title = `${unit === "week" ? `${key} 주` : key} · ${fmt(b.total)}` +
        (b.total ? `\n${MODES.filter((m) => b[m]).map((m) => `${STORE.MODE_LABELS[m]} ${fmt(b[m])}`).join("\n")}` : "");
      return `
      <div class="wt-bar${index % every ? " is-quiet" : ""}" title="${esc(title)}">
        <span class="wt-bar-fill">${MODES.map((mode) => b[mode]
          ? `<i class="is-${mode}" style="height:${(b[mode] / max) * 100}%"></i>` : "").join("")}</span>
        <span class="wt-bar-label">${esc(label)}</span>
      </div>`;
    }).join("");
  }

  // ── 꺾은선(Chart.js, 채팅 리캡·통나무파워 내역과 같은 라이브러리) ──
  // series: [{ label, byDay, field, color, bold }] — 같은 기간·같은 단위(일/주/달)로 맞춘다.
  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const LINE_COLORS = ["--wt-line-1", "--wt-line-2", "--wt-line-3", "--wt-line-4", "--wt-line-5"];

  function renderLineChart(chart, byDay, series, range = rangeBounds()) {
    if (!chart) return;
    if (typeof Chart !== "function") {
      renderChart(chart, byDay, range); // 라이브러리를 못 불렀으면 막대로
      return;
    }
    clearChart(chart);
    const { from, to, width, empty } = chartFrame(chart, byDay, range);
    if (empty || !series.length) {
      chart.innerHTML = '<p class="wt-empty">기록이 없습니다.</p>';
      return;
    }
    const prepared = series.map((item) => ({ ...item, ...chartBuckets(item.byDay, from, to, width) }));
    const { unit, buckets } = prepared[0];
    chart.dataset.unit = unit;
    chart.classList.add("is-line");
    chart.innerHTML = '<canvas role="img"></canvas>';
    const canvas = chart.querySelector("canvas");
    canvas.setAttribute("aria-label", `${series.map((item) => item.label).join(", ")} 시청 시간 추세`);
    const max = Math.max(1, ...prepared.flatMap((item) => [...item.buckets.values()].map((b) => b[item.field])));
    const inHours = max >= 3600;
    // 눈금은 딱 떨어지는 값으로: 시간 단위면 30분의 배수, 아니면 5분의 배수(4칸 안팎).
    const unitStep = inHours ? 1800 : 300;
    const stepSize = Math.max(unitStep, Math.ceil(max / 4 / unitStep) * unitStep);
    const grid = cssVar("--popup-border", "#d8dade");
    const muted = cssVar("--popup-muted", "#7e7f85");
    const text = cssVar("--popup-text", "#26262c");
    lineCharts.set(chart, new Chart(canvas, {
      type: "line",
      data: {
        labels: [...buckets.keys()].map((key) => bucketLabel(unit, key)),
        datasets: prepared.map((item) => ({
          label: item.label,
          data: [...item.buckets.values()].map((b) => b[item.field]),
          borderColor: item.color,
          backgroundColor: item.color,
          borderWidth: item.bold ? 3 : 2,
          borderDash: item.dash ? [5, 4] : [],
          // monotone: 곡선이 0 아래로 내려갔다 오지 않게 한다.
          cubicInterpolationMode: "monotone",
          pointRadius: buckets.size > 31 ? 0 : 2,
          pointHoverRadius: 4,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { ticks: { color: muted, autoSkip: true, maxRotation: 0 }, grid: { color: grid } },
          y: {
            beginAtZero: true,
            ticks: {
              color: muted,
              stepSize,
              callback: (value) => (inHours ? `${Math.round((value / 3600) * 10) / 10}시간` : `${Math.round(value / 60)}분`),
              // (30분 배수라 소수점은 .5 만 나온다)
            },
            grid: { color: grid },
          },
        },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, boxHeight: 2 } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const key = [...buckets.keys()][items[0]?.dataIndex] || "";
                return unit === "week" ? `${key} 주` : key;
              },
              label: (item) => ` ${item.dataset.label} ${fmt(Number(item.parsed.y) || 0)}`,
            },
          },
        },
      },
    }));
  }

  // 그래프 모양(막대/꺾은선). 위쪽과 채널 상세를 따로 기억한다(기본 막대).
  const CHART_TYPE_KEY = "cheeseWatchTimeChartType";
  const chartType = { main: "bar", detail: "bar" };
  try {
    const saved = JSON.parse(localStorage.getItem(CHART_TYPE_KEY) || "{}");
    for (const key of ["main", "detail"]) if (saved?.[key] === "line") chartType[key] = "line";
  } catch {}

  function paintChartTypes() {
    for (const group of document.querySelectorAll("[data-chart-type]")) {
      for (const button of group.querySelectorAll("[data-chart-type-value]")) {
        const on = button.dataset.chartTypeValue === chartType[group.dataset.chartType];
        button.classList.toggle("is-active", on);
        button.setAttribute("aria-checked", String(on));
      }
    }
    $("wtChartNote").hidden = chartType.main !== "line";
  }

  // 위쪽: 막대는 종류별로 쌓고, 꺾은선은 많이 본 채널 5개 + 전체 합계.
  function drawMainChart() {
    const chart = $("wtChart");
    const byDay = state.chartDays || {};
    if (chartType.main !== "line") {
      renderChart(chart, byDay);
      return;
    }
    const range = rangeBounds();
    const top = (state.chartChannels || []).slice(0, 5);
    renderLineChart(chart, byDay, [
      { label: "전체", byDay, field: "total", color: cssVar("--popup-text", "#26262c"), bold: true, dash: true },
      ...top.map(([id], index) => ({
        label: channelName(id),
        byDay: STORE.aggregate(state.shards, filter({ channelId: id })).byDay,
        field: "total",
        color: cssVar(LINE_COLORS[index], "#888"),
      })),
    ], range);
  }

  // 채널 상세: 막대는 종류별로 쌓고, 꺾은선은 라이브·다시보기·라디오 + 합계.
  function drawDetailChart() {
    const chart = $("wtDetailChart");
    const byDay = state.detailDays || {};
    if (chartType.detail !== "line") {
      renderChart(chart, byDay);
      return;
    }
    renderLineChart(chart, byDay, [
      { label: "합계", byDay, field: "total", color: cssVar("--popup-text", "#26262c"), bold: true, dash: true },
      ...state.modes.map((mode) => ({
        label: STORE.MODE_LABELS[mode], byDay, field: mode, color: cssVar(`--wt-${mode}`, "#888"),
      })),
    ]);
  }

  function renderDetail() {
    const panel = $("wtDetail");
    const id = state.channelId;
    if (!id) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    $("wtDetailTitle").innerHTML = channelNameHtml(id);
    const avatar = $("wtDetailAvatar");
    if (channelImage(id)) avatar.src = channelImage(id);
    else avatar.removeAttribute("src");
    const range = rangeBounds();
    const cell = (login, mode) =>
      STORE.aggregate(state.shards, { ...range, channelId: id, login, modes: mode ? [mode] : MODES }).total;
    $("wtDetailSplit").innerHTML = [...MODES, ""].map((mode) => {
      const login = cell("login", mode);
      const guest = cell("guest", mode);
      return `<tr class="${mode ? "" : "is-total"}"><th scope="row">${mode ? STORE.MODE_LABELS[mode] : "합계"}</th>` +
        `<td>${fmtOrDash(login)}</td><td>${fmtOrDash(guest)}</td><td>${fmtOrDash(login + guest)}</td></tr>`;
    }).join("");
    const result = STORE.aggregate(state.shards, filter({ channelId: id }));
    state.detailDays = result.byDay;
    drawDetailChart();
    const days = Object.keys(result.byDay).sort().reverse();
    const longest = Math.max(1, ...days.map((date) => result.byDay[date].total));
    $("wtDetailDays").innerHTML = days.length
      ? days.map((date) => `<li><span>${esc(date)}</span><span class="wt-stack-track">${stackBar(result.byDay[date], result.byDay[date].total / longest)}</span><b>${fmt(result.byDay[date].total)}</b></li>`).join("")
      : '<li class="wt-empty">이 조건에 맞는 기록이 없습니다.</li>';
  }

  // 채널 이름·사진은 치지직 채널 정보로 채운다(7일 캐시). 한 번에 4개씩.
  async function fetchMissingMeta() {
    const now = Date.now();
    const ids = new Set();
    for (const shard of Object.values(state.shards)) {
      for (const key of Object.keys(shard)) ids.add(String(key).split("|")[1]);
    }
    // 인증 마크를 저장하기 전에 받아 둔 항목(verified 없음)도 다시 묻는다.
    const missing = [...ids].filter((id) => /^[0-9a-f]{32}$/.test(id) &&
      !(state.meta[id] && typeof state.meta[id].verified === "boolean" &&
        now - (state.meta[id].at || 0) < META_TTL_MS));
    if (!missing.length) return;
    let changed = false;
    const queue = [...missing];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const res = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${id}`);
          if (!res.ok) continue;
          const content = (await res.json())?.content;
          if (!content) continue;
          state.meta[id] = {
            name: String(content.channelName || ""),
            image: String(content.channelImageUrl || ""),
            verified: content.verifiedMark === true,
            at: Date.now(),
          };
          changed = true;
        } catch {}
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (!changed) return;
    try {
      await chrome.storage.local.set({ [META_KEY]: state.meta });
    } catch {}
    render();
  }

  function deleteRecords(channelId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CHEESE_WATCH_TIME_DELETE", channelId: channelId || "" }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  function paintThemeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    $("wtTheme").innerHTML = dark
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    $("wtTheme").title = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
  }

  // ── 이벤트 ──
  $("wtRange").addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) return;
    state.range = button.dataset.range;
    if (state.range === "custom" && !state.from) {
      const today = dateKey(new Date());
      state.from = addDays(today, -29);
      state.to = today;
      pickerMonths.from = monthOf(state.from);
      pickerMonths.to = monthOf(state.to);
    }
    renderPickers();
    render();
  });

  // ── 직접 기간: 달력 ──
  // 검색 팝업·통나무파워 내역과 같은 달력(popup.css 의 popup-date-picker/popup-calendar).
  const pickerMonths = { from: "", to: "" };
  const monthOf = (date) => String(date || dateKey(new Date())).slice(0, 7);
  const CHEVRON = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

  function renderPicker(key) {
    const root = document.querySelector(`[data-wt-picker="${key}"]`);
    if (!root) return;
    const open = root.querySelector(".popup-calendar") && !root.querySelector(".popup-calendar").hidden;
    const month = pickerMonths[key] || monthOf(state[key]);
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const today = dateKey(new Date());
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dateKey(d);
      const cls = ["popup-calendar-day",
        d.getMonth() !== m - 1 ? "is-outside" : "",
        k === today ? "is-today" : "",
        k === state[key] ? "is-selected" : "",
        state.from && state.to && k > state.from && k < state.to ? "is-range" : "",
      ].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-date="${k}">${d.getDate()}</button>`;
    }).join("");
    root.innerHTML = `
      <button type="button" class="popup-date-trigger" data-wt-picker-toggle aria-haspopup="dialog" aria-expanded="${open}">
        <span data-date-label>${esc(state[key] || "선택 안 함")}</span>
      </button>
      <div class="popup-calendar" role="dialog" aria-label="${key === "from" ? "시작일" : "종료일"} 선택"${open ? "" : " hidden"}>
        <div class="popup-calendar-head">
          <button type="button" class="popup-calendar-nav" data-wt-calendar="prev" aria-label="이전 달">${CHEVRON("M15 5l-6 7 6 7")}</button>
          <strong>${y}년 ${m}월</strong>
          <button type="button" class="popup-calendar-nav" data-wt-calendar="next" aria-label="다음 달">${CHEVRON("M9 5l6 7-6 7")}</button>
        </div>
        <div class="popup-calendar-weekdays" aria-hidden="true"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>
        <div class="popup-calendar-grid">${days}</div>
        <div class="popup-calendar-actions">
          <button type="button" data-wt-calendar="today">오늘</button>
          <button type="button" data-wt-calendar="close">닫기</button>
        </div>
      </div>`;
  }
  function renderPickers() {
    renderPicker("from");
    renderPicker("to");
  }
  function closePickers(except) {
    for (const root of document.querySelectorAll("[data-wt-picker]")) {
      if (root === except) continue;
      root.querySelector(".popup-calendar")?.setAttribute("hidden", "");
      root.querySelector("[data-wt-picker-toggle]")?.setAttribute("aria-expanded", "false");
    }
  }
  // 날짜를 고르면 반대쪽이 뒤집히지 않게 맞춘다(뒤집히면 결과가 늘 0건이다).
  function pickDate(key, date) {
    state[key] = date;
    pickerMonths[key] = monthOf(date);
    if (state.from && state.to && state.from > state.to) {
      const other = key === "from" ? "to" : "from";
      state[other] = date;
      pickerMonths[other] = monthOf(date);
    }
    closePickers(null);
    renderPickers();
    render();
  }
  $("wtCustomRange").addEventListener("click", (event) => {
    const root = event.target.closest("[data-wt-picker]");
    if (!root) return;
    const key = root.dataset.wtPicker;
    if (event.target.closest("[data-wt-picker-toggle]")) {
      const calendar = root.querySelector(".popup-calendar");
      const open = calendar.hidden;
      closePickers(root);
      calendar.hidden = !open;
      root.querySelector("[data-wt-picker-toggle]").setAttribute("aria-expanded", String(open));
      return;
    }
    const day = event.target.closest(".popup-calendar-day");
    if (day) {
      pickDate(key, day.dataset.date);
      return;
    }
    const action = event.target.closest("[data-wt-calendar]")?.dataset.wtCalendar;
    if (action === "prev" || action === "next") {
      const [y, m] = (pickerMonths[key] || monthOf(state[key])).split("-").map(Number);
      const d = new Date(y, m - 1 + (action === "prev" ? -1 : 1), 1);
      pickerMonths[key] = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      renderPicker(key);
    } else if (action === "today") {
      pickDate(key, dateKey(new Date()));
    } else if (action === "close") {
      closePickers(null);
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("[data-wt-picker]")) closePickers(null);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePickers(null);
  });
  $("wtLogin").addEventListener("click", (event) => {
    const button = event.target.closest("[data-login]");
    if (!button) return;
    state.login = button.dataset.login;
    render();
  });
  $("wtModes").addEventListener("change", () => {
    state.modes = [...document.querySelectorAll("#wtModes [data-mode]:checked")].map((el) => el.dataset.mode);
    render();
  });
  const pickRow = (event) => {
    const row = event.target.closest("tr[data-channel]");
    if (!row) return;
    state.channelId = row.dataset.channel === state.channelId ? "" : row.dataset.channel;
    render();
    if (state.channelId) $("wtDetail").scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  $("wtChannelRows").addEventListener("click", pickRow);
  $("wtChannelRows").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickRow(event);
    }
  });
  $("wtDetailClose").addEventListener("click", () => {
    state.channelId = "";
    render();
  });
  $("wtDetailDelete").addEventListener("click", async () => {
    const id = state.channelId;
    if (!id || !confirm(`'${channelName(id)}' 채널의 시청 시간 기록을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
    await deleteRecords(id);
    state.channelId = "";
    await load();
  });
  $("wtClearAll").addEventListener("click", async () => {
    if (!confirm("시청 시간 기록을 모두 지울까요? 되돌릴 수 없습니다.")) return;
    await deleteRecords("");
    await load();
  });
  // 처리 중 표시(통나무파워 내역 withBusy 와 같은 3-dot pulse). 너무 빨리 끝나도 눌린 걸
  // 알 수 있게 잠깐은 보인다.
  const BUSY_MIN_MS = 400;
  async function withBusy(button, run) {
    if (!button || button.dataset.busy === "1") return;
    const label = button.innerHTML;
    const started = Date.now();
    // 점으로 바꾸면 폭이 줄어 버튼이 들썩인다 → 지금 폭을 고정한다.
    button.style.minWidth = `${button.getBoundingClientRect().width}px`;
    button.dataset.busy = "1";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = '<span class="wt-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    try {
      return await run();
    } finally {
      const left = BUSY_MIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
      button.innerHTML = label;
      button.style.minWidth = "";
      button.disabled = false;
      button.removeAttribute("aria-busy");
      delete button.dataset.busy;
    }
  }
  $("wtRefresh").addEventListener("click", () => void withBusy($("wtRefresh"), load));
  $("wtTheme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    paintThemeButton();
    // 꺾은선 색은 테마 변수에서 읽는다 → 다시 그린다.
    if (state.chartDays) drawMainChart();
    if (state.channelId && state.detailDays) drawDetailChart();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-chart-type-value]");
    if (!button) return;
    const key = button.closest("[data-chart-type]")?.dataset.chartType;
    if (!key) return;
    chartType[key] = button.dataset.chartTypeValue === "line" ? "line" : "bar";
    try {
      localStorage.setItem(CHART_TYPE_KEY, JSON.stringify(chartType));
    } catch {}
    paintChartTypes();
    if (key === "main") drawMainChart();
    else drawDetailChart();
  });

  // 창 폭이 바뀌면 그래프만 다시 그린다(막대 단위·날짜 글자 간격이 폭을 따른다).
  if (typeof ResizeObserver === "function") {
    let frame = 0;
    const widths = new WeakMap();
    const observer = new ResizeObserver((entries) => {
      if (!entries.some((entry) => {
        const width = Math.round(entry.contentRect.width);
        const changed = widths.get(entry.target) !== width;
        widths.set(entry.target, width);
        return changed;
      })) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (state.chartDays) drawMainChart();
        if (state.channelId && state.detailDays) drawDetailChart();
      });
    });
    observer.observe($("wtChart"));
    observer.observe($("wtDetailChart"));
  }

  // 보는 동안 쌓이는 기록을 따라간다(배경이 몇 초마다 묶어 쓴다).
  let reloadTimer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!Object.keys(changes).some((key) => key.startsWith(STORE.SHARD_PREFIX) || key === STORE.ENABLED_KEY)) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void load(), 1500);
  });

  const params = new URLSearchParams(location.search);
  const requested = String(params.get("channel") || "").toLowerCase();
  if (/^[0-9a-f]{32}$/.test(requested)) {
    state.channelId = requested;
    state.range = "all";
  }
  paintThemeButton();
  paintChartTypes();
  renderPickers();
  void load();
})();
