// Shared controls for the setup page and the watch-page channel manager.
(() => {
  "use strict";

  const SOURCES = globalThis.CheeseMultiviewSources;

  function attach(host, scope, onChange = () => {}) {
    if (!host || !SOURCES) return { setPager() {}, ready: Promise.resolve() };
    host.innerHTML = SOURCES.videoSearchControlsMarkup(scope);
    const root = host.firstElementChild;
    let settings = null;
    let pager = null;
    let sortOverride = null;

    function sync() {
      if (!settings || !root) return;
      const sort = sortOverride || pager?.sort || settings.sort;
      const option = SOURCES.VIDEO_SEARCH_SORTS.find((item) => item.value === sort) || SOURCES.VIDEO_SEARCH_SORTS[0];
      root.querySelector("[data-video-rerank-sort-label]").textContent = option.label;
      root.querySelectorAll("[data-video-rerank-sort]").forEach((button) => {
        button.setAttribute("aria-selected", String(button.dataset.videoRerankSort === sort));
      });
      root.querySelectorAll("[data-video-rerank-default-sort]").forEach((button) => {
        const active = button.dataset.videoRerankDefaultSort === settings.sort;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      const pool = root.querySelector("[data-video-rerank-pool]");
      const poolSlider = root.querySelector("[data-video-rerank-pool-slider]");
      if (document.activeElement !== pool) pool.value = String(settings.poolMax);
      if (document.activeElement !== poolSlider) poolSlider.value = String(settings.poolMax);
      root.querySelectorAll("[data-video-rerank-weight]").forEach((input) => {
        if (document.activeElement !== input) input.value = String(settings.weights[input.dataset.videoRerankWeight]);
      });
    }

    async function save(patch, poolChanged = false, updatePager = true) {
      settings = await SOURCES.saveVideoSearchSettings(patch);
      if (pager && !poolChanged && updatePager) {
        await pager.updateSettings(settings);
        if (sortOverride) await pager.setSort(sortOverride);
      }
      sync();
      onChange({ settings, pager, poolChanged, updatePager });
    }

    function closeMenus() {
      const sortMenu = root.querySelector(".cheese-search-sort-menu");
      const sortTrigger = root.querySelector("[data-video-rerank-sort-trigger]");
      const popover = root.querySelector(".cheese-search-options-popover");
      const optionsTrigger = root.querySelector("[data-video-rerank-options-trigger]");
      sortMenu.hidden = true;
      sortTrigger.setAttribute("aria-expanded", "false");
      popover.hidden = true;
      optionsTrigger.setAttribute("aria-expanded", "false");
    }

    root.addEventListener("click", (event) => {
      const sortTrigger = event.target.closest("[data-video-rerank-sort-trigger]");
      if (sortTrigger) {
        const menu = root.querySelector(".cheese-search-sort-menu");
        const open = menu.hidden;
        root.querySelector(".cheese-search-options-popover").hidden = true;
        root.querySelector("[data-video-rerank-options-trigger]").setAttribute("aria-expanded", "false");
        menu.hidden = !open;
        sortTrigger.setAttribute("aria-expanded", String(open));
        return;
      }
      const sortOption = event.target.closest("[data-video-rerank-sort]");
      if (sortOption) {
        sortOverride = sortOption.dataset.videoRerankSort;
        void pager?.setSort(sortOverride);
        closeMenus();
        sync();
        onChange({ settings, pager, poolChanged: false });
        return;
      }
      const optionsTrigger = event.target.closest("[data-video-rerank-options-trigger]");
      if (optionsTrigger) {
        const popover = root.querySelector(".cheese-search-options-popover");
        const open = popover.hidden;
        root.querySelector(".cheese-search-sort-menu").hidden = true;
        root.querySelector("[data-video-rerank-sort-trigger]").setAttribute("aria-expanded", "false");
        popover.hidden = !open;
        optionsTrigger.setAttribute("aria-expanded", String(open));
        return;
      }
      if (event.target.closest("[data-video-rerank-options-close]")) {
        closeMenus();
        return;
      }
      const defaultSort = event.target.closest("[data-video-rerank-default-sort]");
      if (defaultSort) {
        const value = defaultSort.dataset.videoRerankDefaultSort;
        void save({ sort: value }, false, false);
        return;
      }
      if (event.target.closest("[data-video-rerank-reset]")) {
        void save({ weights: { ...SOURCES.VIDEO_SEARCH_DEFAULTS.weights } });
      }
    });

    root.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches("[data-video-rerank-pool], [data-video-rerank-pool-slider]")) {
        const value = Number(target.value);
        const poolMax = Math.min(1000, Math.max(50, Math.round(value)));
        if (Number.isFinite(poolMax)) void save({ poolMax }, true);
        return;
      }
      if (target.matches("[data-video-rerank-weight]")) {
        const weights = {
          ...(settings?.weights || SOURCES.VIDEO_SEARCH_DEFAULTS.weights),
          [target.dataset.videoRerankWeight]: Number(target.value),
        };
        void save({ weights });
      }
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (target.matches("[data-video-rerank-pool]")) {
        root.querySelector("[data-video-rerank-pool-slider]").value = target.value;
      } else if (target.matches("[data-video-rerank-pool-slider]")) {
        root.querySelector("[data-video-rerank-pool]").value = target.value;
      }
    });

    document.addEventListener("click", (event) => {
      if (!root.contains(event.target)) closeMenus();
    });

    return {
      ready: SOURCES.loadVideoSearchSettings().then((value) => { settings = value; sync(); }),
      setPager(value) {
        pager = value || null;
        if (pager && sortOverride) void pager.setSort(sortOverride);
        sync();
      },
      get sort() { return sortOverride || pager?.sort || settings?.sort || "score"; },
    };
  }

  globalThis.CheeseMultiviewVideoSearchControls = { attach };
})();
