// Shared controls for the setup page, the watch-page channel manager and the playlist page.
// 다시보기 검색의 정렬(관련·최신·조회수)·영상 길이·기간을 고른다. 치지직 검색 화면과 같은 값이며 서버가 정렬·거른다.
// 기간의 '직접 선택'은 달력(src/searchDateRange.js)을 띄워 시작·끝 날짜를 고른다.
// 고르면 기억하고 onChange({ options, reload: true }) 로 알린다 — 부르는 쪽이 새 pager 로 처음부터 다시 받는다.
(() => {
  "use strict";

  const SOURCES = globalThis.CheeseMultiviewSources;

  function attach(host, scope, onChange = () => {}) {
    if (!host || !SOURCES) return { setPager() {}, ready: Promise.resolve(), get options() { return {}; } };
    host.innerHTML = SOURCES.videoSearchControlsMarkup(scope);
    const root = host.firstElementChild;
    let options = { ...SOURCES.VIDEO_SEARCH_DEFAULTS };
    const LISTS = { sort: SOURCES.VIDEO_SEARCH_SORTS, time: SOURCES.VIDEO_SEARCH_PLAY_TIMES, period: SOURCES.VIDEO_SEARCH_PERIODS };
    const FIELD = { sort: "sort", time: "playTime", period: "period" };
    const RANGE = globalThis.CheeseSearchDateRange;

    function sync() {
      for (const kind of Object.keys(LISTS)) {
        const value = options[FIELD[kind]];
        const option = LISTS[kind].find((item) => item.value === value) || LISTS[kind][0];
        // 직접 고른 기간은 날짜로(26.09.01~26.10.29)
        root.querySelector(`[data-video-search-label="${kind}"]`).textContent =
          kind === "period" && value === "CUSTOM" ? RANGE?.shortRange(options.start, options.end) || option.label : option.label;
        root.querySelectorAll(`[data-video-search-${kind}]`).forEach((button) => {
          button.setAttribute("aria-selected", String(button.getAttribute(`data-video-search-${kind}`) === value));
        });
        // 기본값이 아니면 표시(걸러 보고 있다는 걸 알 수 있게)
        root.querySelector(`[data-video-search-trigger="${kind}"]`)
          .classList.toggle("is-filtered", value !== SOURCES.VIDEO_SEARCH_DEFAULTS[FIELD[kind]]);
      }
    }

    function apply(next) {
      options = SOURCES.normalizeVideoSearchOptions(next);
      sync();
      // 저장이 끝난 뒤 알린다(새 pager 가 저장된 값을 읽어 묻는다 — 먼저 알리면 예전 값으로 물었다).
      const chosen = { ...options };
      void SOURCES.saveVideoSearchSettings(chosen).then(() => onChange({ options: chosen, reload: true }));
    }

    function closeMenus(except = null) {
      root.querySelectorAll("[data-video-search-picker]").forEach((picker) => {
        if (picker === except) return;
        picker.querySelector(".cheese-search-sort-menu").hidden = true;
        picker.querySelector("[data-video-search-trigger]").setAttribute("aria-expanded", "false");
      });
    }

    root.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-video-search-trigger]");
      if (trigger) {
        const picker = trigger.closest("[data-video-search-picker]");
        const menu = picker.querySelector(".cheese-search-sort-menu");
        const open = menu.hidden;
        closeMenus(picker);
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        return;
      }
      for (const kind of Object.keys(LISTS)) {
        const choice = event.target.closest(`[data-video-search-${kind}]`);
        if (!choice) continue;
        closeMenus();
        const value = choice.getAttribute(`data-video-search-${kind}`);
        if (kind === "period" && value === "CUSTOM") {
          // 달력에서 고른 뒤 적용해야 바뀐다(닫으면 그대로)
          RANGE?.open(root.querySelector('[data-video-search-trigger="period"]'), {
            start: options.start,
            end: options.end,
            // 떠 있는 패널(멀티뷰 시청 화면의 채널 관리) 안이면 그 안에서만 보인다.
            within: root.closest("[data-date-range-bounds]"),
            onApply: (start, end) => apply({ ...options, period: "CUSTOM", start, end }),
          });
          return;
        }
        if (value === options[FIELD[kind]]) return;
        const next = { ...options, [FIELD[kind]]: value };
        if (kind === "period") {
          delete next.start;
          delete next.end;
        }
        apply(next);
        return;
      }
    });

    document.addEventListener("click", (event) => {
      if (!root.contains(event.target)) closeMenus();
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenus();
    });

    return {
      ready: SOURCES.loadVideoSearchSettings().then((value) => { options = value; sync(); }),
      // 예전 이름 호환: pager 를 붙여도 하는 일은 없다(정렬은 서버가 한다).
      setPager() {},
      get options() { return { ...options }; },
    };
  }

  globalThis.CheeseMultiviewVideoSearchControls = { attach };
})();
