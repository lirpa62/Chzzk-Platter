// Settings presentation only: feature flags and their stored polarity stay unchanged.
(() => {
  "use strict";
  const LAST_TAB_KEY = "cheeseSettingsLastTab";
  const EXPANDED_KEY = "cheeseSettingsExpandedFeatures";
  const DISCLOSURES = [
    ["update-notice", "[data-update-notice-enabled]"],
    ["wheel-volume", "[data-wheel-volume]"],
    ["action-overlay", "[data-action-overlay]"],
    ["mixer-exclusions", "[data-mixer-always-on]"],
    ["mixer-default", "[data-mixer-global-default-enabled]"],
    ["mixer-gain", "[data-mixer-global-gain-default-enabled]"],
    ["filter-exclusions", "[data-video-filter-always-on]"],
    ["vod-activity", "[data-vod-chat-graph]"],
    ["vod-role-chat", "[data-vod-role-chat]"],
    ["chat-time", '[data-feature="chatShowTime"]'],
    ["chat-device", '[data-feature="chatShowOsIcon"]'],
    ["popup-player", "[data-popup-player]"],
    ["preview-colors", "[data-settings-preview-colors]"],
    ["clip-precision", '[data-feature="clipEditorPrecision"]'],
  ];
  // Explicit ownership, not inferred from row order or the decorative branch character.
  const FAMILIES = [
    ["[data-update-notice-enabled]", "[data-update-notice-mode], [data-update-notice-duration], [data-update-notice-toast-position]"],
    ["[data-max-quality]", "[data-max-quality-respect]"],
    ["[data-live-seek-bar]", "[data-live-seek-bar-bottom]"],
    ["[data-wheel-volume]", "[data-wheel-volume-scope], [data-wheel-volume-rightclick], [data-wheel-volume-step]"],
    ["[data-action-overlay]", "[data-osd-group]"],
    ["[data-ad-mini-unmute]", "[data-ad-mini-keep-muted]"],
    ["[data-auto-reload-on-relive]", "#autoReliveMaxHours"],
    ["[data-mixer-always-on]", "[data-mixer-exclude-item]"],
    ["[data-mixer-global-default-enabled]", "[data-mixer-global-default-mode]"],
    ["[data-mixer-global-gain-default-enabled]", "[data-mixer-global-gain-default-mode]"],
    ["[data-video-filter-always-on]", "[data-video-filter-exclude-item]"],
    ["[data-video-filter-global-default-enabled]", "[data-video-filter-global-default-mode]"],
    ["[data-vod-chat-graph]", "[data-vod-chat-graph-auto], [data-vod-chat-graph-colors]"],
    ["[data-vod-chat-graph-auto]", "[data-vod-chat-graph-auto-collect]"],
    ["[data-vod-role-chat]", "[data-role-bot-row]"],
    ['[data-feature="vodSeekButtons"]', '[data-feature="vodGlobalArrowSeek"]'],
    ['[data-feature="commentTimestamp"]', "#commentTsClickAction"],
    ["#commentTsClickAction", "[data-comment-ts-click-delay]"],
    ["[data-chat-recap-player-button-hidden]", "#chatRecapClickAction"],
    ["#chatRecapClickAction", "[data-chat-recap-click-delay]"],
    ["[data-category-video-filter]", "[data-category-video-candidate-picker]"],
    ["[data-search-live-rerank]", "#searchLiveRerankDefaultSort, [data-search-live-rerank-w-rel]"],
    ["[data-search-rerank]", "#searchRerankDefaultSort, [data-search-rerank-w-rel], [data-search-rerank-pool], [data-search-rerank-more-step]"],
    ['[data-feature="loungeNews"]', '[data-feature="loungeNewsDot"], #loungeRefresh'],
    ['[data-feature="inboxCommunityNews"]', '[data-feature="inboxCommunityNewsDot"], [data-inbox-community-new-tab], #inboxCommunityRefresh'],
    ['[data-feature="inboxLogPower"]', '[data-feature="inboxLogPowerDot"]'],
    ['[data-feature="sbFollowFavEnabled"]', "[data-cf-fav-initial], [data-cf-fav-more]"],
    ['[data-feature="sbFollowGroupTags"]', "[data-cf-group-tag-hide-offline]"],
    ["[data-affinity-on]", "[data-affinity-hide-offline], [data-affinity-initial], [data-affinity-more], [data-settings-affinity-weights]"],
    ["[data-follow-preview-card-layout]", "#followPreviewBadgePos"],
    ["[data-settings-preview-colors]", "[data-fp-color-enabled]"],
    ["[data-popup-player]", "[data-popup-player-audio], [data-popup-player-size], [data-popup-player-wide], [data-popup-player-start-without-chat], [data-popup-player-scroll], [data-popup-player-maxq]"],
    ["[data-popup-player-size]", "[data-popup-player-size-w]"],
    ["[data-popup-player-start-without-chat]", "[data-popup-player-start-without-chat-16-9]"],
    ["[data-card-live-preview]", "#cardLivePreviewPosition"],
    ["[data-card-preview-audio]", "[data-card-preview-default-volume], [data-card-preview-wheel-delay]"],
    ["[data-channel-live-button]", "[data-channel-live-button-end]"],
    ["[data-channel-profile-radius-enabled]", "[data-channel-profile-radius]"],
    ["[data-channel-live-profile-custom]", "[data-channel-live-profile-angle]"],
    ["[data-root-to-following]", "#rootToFollowingLogoMode"],
    ['[data-feature="chatShowTime"]', "[data-chat-time-format], [data-chat-time-color-enabled]"],
    ['[data-feature="chatShowOsIcon"]', "[data-chat-os-position], [data-chat-os-image-input]"],
    ["[data-chat-history]", "[data-chat-history-limit]"],
    ["[data-chat-recap-enabled]", "[data-chat-recap-retention]"],
    ['[data-feature="chatEmoticonAltClick"]', "[data-emoticon-block-input]"],
    ['[data-feature="clipVault"]', "[data-clip-vault-limit]"],
    ["[data-clip-audio-mixer-enabled]", "[data-clip-audio-mixer-always-on], [data-settings-clip-mixer-preset]"],
    ["[data-clip-video-filter-enabled]", "[data-clip-video-filter-always-on], [data-settings-clip-filter-preset]"],
    ['[data-feature="clipEditorPrecision"]', "[data-clip-editor-step-picker]"],
    ["[data-cafe-now]", "[data-cafe-now-autoplay]"],
    ["[data-cafe-now-autoplay]", "[data-cafe-now-autoplay-muted]"],
    ["[data-embed-clip-mixer-always-on]", "[data-settings-embed-mixer-preset], [data-embed-clip-default-gain-range]"],
    ["[data-chat-font-scale]", "[data-chat-font-scale-special]"],
  ];

  function readLastTab(storage, validTabs, requested) {
    if (validTabs.includes(requested)) return requested;
    try {
      const saved = storage.getItem(LAST_TAB_KEY);
      if (validTabs.includes(saved)) return saved;
    } catch {}
    return "all";
  }

  function rememberTab(storage, tab) {
    try { storage.setItem(LAST_TAB_KEY, tab); } catch {}
  }

  function plainName(element) {
    const copy = element?.cloneNode(true);
    copy?.querySelectorAll("button, .settings-search-path").forEach((node) => node.remove());
    return (copy?.textContent || "").replace(/^[\s└─]+/, "").replace(/\s+/g, " ").trim();
  }

  function checkedFromStored(input, stored) {
    return input.hasAttribute("data-feature-inverted") ? !stored : stored;
  }

  function storedFromChecked(input) {
    return checkedFromStored(input, input.checked);
  }

  function createParents(root) {
    const parents = new Map();
    for (const [parentSelector, childrenSelector] of FAMILIES) {
      const parent = root.querySelector(parentSelector)?.closest(".settings-item");
      if (!parent) continue;
      root.querySelectorAll(childrenSelector).forEach((control) => {
        const child = control.closest(".settings-item");
        if (child && child !== parent) parents.set(child, parent);
      });
    }
    return parents;
  }

  function ancestorRows(row, parents) {
    const chain = [], seen = new Set([row]);
    for (let parent = parents.get(row); parent && !seen.has(parent); parent = parents.get(parent)) {
      chain.unshift(parent); seen.add(parent);
    }
    return chain;
  }

  // 부모-자식 관계를 클래스로 남긴다. 예전에는 이름 앞의 '└' 문자만으로 계층을
  // 표현해 CSS 가 자식을 구분할 수 없었다(들여쓰기·연결선을 줄 수 없었다).
  // ⚠ 마크업은 그대로 두고 클래스만 얹는다 — 검색·접기 로직이 .settings-item 을
  //   평평한 목록으로 보는 전제를 깨지 않는다.
  // 이름 맨 앞의 '└'(및 뒤따르는 공백)만 <span> 으로 감싼다. 그 글자는 검색이
  // 계층을 검증하는 데 쓰여 지울 수 없어, 감싼 뒤 CSS 로 투명하게 만든다.
  // ⚠ 이름은 대개 텍스트 노드 하나라 이름 전체를 투명하게 하면 제목까지 사라진다.
  function wrapBranchMark(row) {
    const name = row.querySelector(".settings-item-name");
    if (!name || name.querySelector(".settings-branch-mark")) return;
    for (const node of [...name.childNodes]) {
      if (node.nodeType !== 3) continue;
      const m = node.textContent.match(/^(\s*(?:&nbsp;|\u00a0|\s)*└\s?)/);
      if (!m) continue;
      const mark = name.ownerDocument.createElement("span");
      mark.className = "settings-branch-mark";
      mark.textContent = m[1];
      node.textContent = node.textContent.slice(m[1].length);
      node.parentNode.insertBefore(mark, node);
      return;
    }
  }

  function markHierarchy(root, parents) {
    for (const [row, parent] of parents) {
      const depth = ancestorRows(row, parents).length;
      row.classList.add("settings-item-child");
      row.dataset.settingsDepth = String(Math.min(depth, 3));
      wrapBranchMark(row);
      parent.classList.add("settings-item-parent");
    }
    // 같은 부모의 마지막 자식을 표시한다(연결선을 거기서 끊기 위해).
    const byParent = new Map();
    for (const [row, parent] of parents) {
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(row);
    }
    for (const rows of byParent.values()) {
      rows.forEach((row) => row.classList.remove("is-last-child"));
      rows[rows.length - 1]?.classList.add("is-last-child");
    }
  }

  function createDisclosures(root, storage) {
    const parents = createParents(root);
    markHierarchy(root, parents);
    const expanded = new Set();
    try {
      const saved = JSON.parse(storage.getItem(EXPANDED_KEY));
      if (Array.isArray(saved)) saved.forEach((id) => {
        if (DISCLOSURES.some(([key]) => key === id)) expanded.add(id);
      });
    } catch {}
    const groups = [];
    let searchRows = null;
    for (const [id, selector] of DISCLOSURES) {
      const parent = root.querySelector(selector)?.closest(".settings-item");
      const name = parent?.querySelector(".settings-item-name");
      if (!name) continue;
      const members = [...parents.keys()].filter((row) => ancestorRows(row, parents).includes(parent));
      if (!members.length) continue;
      const button = root.createElement("button");
      button.type = "button";
      button.className = "settings-disclosure-button";
      button.dataset.settingsDisclosure = id;
      const label = plainName(name);
      // Lucide chevron-down, matching the repository's inline Lucide icons.
      button.innerHTML = '<svg class="lucide lucide-chevron-down" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';
      members.forEach((row, index) => {
        if (!row.id) row.id = `settings-detail-${id}-${index}`;
      });
      button.setAttribute("aria-controls", members.map((row) => row.id).join(" "));
      name.append(button);
      groups.push({ id, button, label, members });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (searchRows) return;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        try { storage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])); } catch {}
        render();
      });
    }
    function refreshBadges() {
      groups.forEach(({ button, label, members }) => {
        const hasNew = members.some((row) => row.matches(".is-new-feature") || row.querySelector(".is-new-feature"));
        button.classList.toggle("has-new-setting", hasNew);
        const action = button.getAttribute("aria-expanded") === "true" ? "세부 설정 접기" : "세부 설정 펼치기";
        button.setAttribute("aria-label", `${label} ${action}${hasNew ? " (새 설정 있음)" : ""}`);
        button.title = searchRows ? "검색 중에는 세부 설정을 펼쳐서 표시합니다" : `${action}${hasNew ? " (새 설정 있음)" : ""}`;
      });
    }
    function render() {
      groups.forEach(({ id, button, label, members }) => {
        const open = expanded.has(id) || Boolean(searchRows && members.some((row) => searchRows.has(row)));
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", `${label} 세부 설정 ${open ? "접기" : "펼치기"}`);
        button.disabled = Boolean(searchRows);
        members.forEach((row) => row.classList.toggle("is-feature-collapsed", !open));
      });
      refreshBadges();
    }
    render();
    return {
      refreshBadges,
      search: (rows) => { searchRows = rows; render(); },
    };
  }

  function createSearch(root, disclosures) {
    const rows = [...root.querySelectorAll(".settings-item")];
    const groups = [...root.querySelectorAll(".settings-group")];
    const parents = createParents(root);
    const ancestors = (row) => ancestorRows(row, parents);
    const paths = new Map();
    rows.forEach((row) => {
      const name = row.querySelector(".settings-item-name");
      if (!name || name.closest(".settings-item") !== row) return;
      const group = row.closest(".settings-group");
      const tab = [...root.querySelectorAll("[data-tab]")].find((el) => el.dataset.tab === group?.dataset.panel);
      const chain = ancestors(row).map((parent) => plainName(parent.querySelector(".settings-item-name")));
      const heading = [...(group?.querySelectorAll(".settings-group-title, .settings-subgroup-title") || [])]
        .filter((el) => el.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
      const parts = [tab?.textContent.trim(), chain.length ? null : heading?.textContent.trim(), ...chain].filter(Boolean);
      const path = root.createElement("span");
      path.className = "settings-search-path";
      path.dataset.settingsParent = chain.join(" > ");
      path.textContent = [...new Set(parts)].join(" > ");
      path.hidden = true;
      name.prepend(path);
      paths.set(row, path);
    });

    const revealed = new Map();
    root.addEventListener("click", (event) => {
      const key = event.target.closest?.("[data-settings-info]")?.dataset.settingsInfo;
      if (!key) return;
      root.querySelectorAll("[data-settings-info-panel]").forEach((panel) => {
        if (panel.dataset.settingsInfoPanel === key) revealed.delete(panel);
      });
    });

    function setInfoOpen(panel, open) {
      panel.hidden = !open;
      root.querySelectorAll("[data-settings-info]").forEach((button) => {
        if (button.dataset.settingsInfo === panel.dataset.settingsInfoPanel) button.setAttribute("aria-expanded", String(open));
      });
    }

    function clear() {
      disclosures?.search(null);
      root.querySelectorAll("mark.settings-search-mark").forEach((mark) => {
        const parent = mark.parentNode;
        mark.replaceWith(root.createTextNode(mark.textContent));
        parent.normalize();
      });
      for (const [panel, wasOpen] of revealed) setInfoOpen(panel, wasOpen);
      revealed.clear();
      paths.forEach((path) => { path.hidden = true; });
      rows.forEach((row) => { row.classList.remove("is-search-hidden", "is-search-context"); });
    }

    function highlight(element, query) {
      const walker = root.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.closest("button, .settings-search-path")) nodes.push(walker.currentNode);
      }
      nodes.forEach((node) => {
        const text = node.textContent, lower = text.toLowerCase();
        let at = lower.indexOf(query), start = 0;
        if (at < 0) return;
        const fragment = root.createDocumentFragment();
        while (at >= 0) {
          fragment.append(root.createTextNode(text.slice(start, at)));
          const mark = root.createElement("mark");
          mark.className = "settings-search-mark"; mark.textContent = text.slice(at, at + query.length);
          fragment.append(mark); start = at + query.length; at = lower.indexOf(query, start);
        }
        fragment.append(root.createTextNode(text.slice(start))); node.replaceWith(fragment);
      });
    }

    function apply(rawQuery) {
      clear();
      const query = rawQuery.trim().toLowerCase();
      if (!query) return 0;
      const matches = new Set();
      rows.forEach((row) => {
        if (row.hidden) return;
        const text = [row.dataset.settingsSearchAliases || "", paths.get(row)?.textContent || ""];
        row.querySelectorAll("[data-settings-search-aliases]").forEach((el) => text.push(el.dataset.settingsSearchAliases));
        row.querySelectorAll(".settings-item-name, .settings-item-desc, .settings-info-panel").forEach((el) => {
          if (el.closest(".settings-item") === row) text.push(el.textContent);
        });
        if (text.join(" ").replace(/\s+/g, " ").toLowerCase().includes(query)) matches.add(row);
      });
      const visible = new Set(matches);
      matches.forEach((row) => {
        ancestors(row).forEach((parent) => visible.add(parent));
        // A nested color row also needs its structural container to stay visible.
        for (let outer = row.parentElement.closest(".settings-item"); outer; outer = outer.parentElement.closest(".settings-item")) visible.add(outer);
      });
      disclosures?.search(visible);
      rows.forEach((row) => {
        row.classList.toggle("is-search-hidden", !visible.has(row));
        row.classList.toggle("is-search-context", visible.has(row) && !matches.has(row));
        const path = paths.get(row);
        if (path) path.hidden = !visible.has(row);
      });
      groups.forEach((group) => { group.hidden = !rows.some((row) => visible.has(row) && !row.hidden && row.closest(".settings-group") === group); });
      root.querySelectorAll(".settings-info-panel").forEach((panel) => {
        if (visible.has(panel.closest(".settings-item")) && panel.textContent.replace(/\s+/g, " ").toLowerCase().includes(query) && panel.hidden) {
          revealed.set(panel, false); setInfoOpen(panel, true);
        }
      });
      root.querySelectorAll(".settings-item-name, .settings-item-desc, .settings-info-panel").forEach((el) => {
        if (visible.has(el.closest(".settings-item"))) highlight(el, query);
      });
      return matches.size;
    }
    return { apply, clear };
  }

  function prepareHelp(root) {
    const template = root.querySelector("button.settings-info-button");
    if (!template) return;
    root.querySelectorAll(".settings-item-desc[data-settings-summary]").forEach((panel, index) => {
      const name = panel.closest(".settings-item")?.querySelector(".settings-item-name");
      if (!name) return;
      const key = `setting-detail-${index}`;
      const summary = root.createElement("span");
      summary.className = "settings-item-desc";
      summary.textContent = panel.dataset.settingsSummary;
      panel.before(summary);
      panel.classList.replace("settings-item-desc", "settings-info-panel");
      panel.dataset.settingsInfoPanel = key;
      panel.id = key;
      panel.hidden = true;
      const button = template.cloneNode(true);
      button.removeAttribute("id");
      button.dataset.settingsInfo = key;
      button.setAttribute("aria-label", `${plainName(name)} 상세 설명`);
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", key);
      button.title = "상세 설명";
      name.append(button);
    });
  }

  // ── 왼쪽 탭 아래 그룹 목차(아코디언) ──────────────────────────────────────
  // 탭을 폴더처럼 쓰되 '한 단계 더 클릭'을 강요하지 않는다. 탭을 누르면 예전처럼
  // 오른쪽에 탭 전체가 뜨고, 그 아래 하위 그룹이 펼쳐진다. 그룹을 누르면 해당
  // 위치로 스크롤 + 잠깐 강조한다 — 긴 탭에서 빠르게 점프하는 목차 역할이다.
  //
  // ⚠ 그룹이 하나뿐인 탭에는 목차를 만들지 않는다. 항목이 곧 그룹이라 클릭만
  //   늘고 얻는 게 없다(측정: 19개 탭 중 6개가 그룹 1개).
  // ⚠ 그룹 링크는 HTML 에 적지 않고 DOM 에서 만든다. 그래야 그룹을 추가·분할해도
  //   목차가 자동으로 따라오고, 마크업이 두 곳으로 갈라지지 않는다.
  const GROUP_FLASH_MS = 1200;

  // ⚠ 그룹 제목이 '섹션마다 하나'인 탭과 '한 섹션 안에 여러 개'인 탭이 섞여 있다
  //   (예: 플레이어는 섹션 분리, 전용 팔로잉·검색은 한 섹션에 제목 5개).
  //   그래서 섹션이 아니라 '제목'을 기준으로 모은다 — 두 형태를 모두 잡는다.
  function tabGroups(root, tab) {
    const out = [];
    for (const section of root.querySelectorAll(
      `section.settings-group[data-panel="${tab}"]`,
    )) {
      if (!section.querySelector("li.settings-item")) continue;
      const titles = [...section.querySelectorAll(".settings-group-title")];
      if (titles.length <= 1) out.push({ title: titles[0] || null, target: section });
      else for (const title of titles) out.push({ title, target: title });
    }
    return out.filter((entry) => entry.title);
  }

  function createTabOutline(root, tabsNav, onJump) {
    if (!tabsNav) return { sync() {} };
    // ⚠ 멱등. 두 번 불려도 목차가 겹쳐 생기지 않게 이전 것을 먼저 지운다.
    tabsNav.querySelectorAll(".settings-tab-outline").forEach((el) => el.remove());
    const listByTab = new Map();

    for (const button of [...tabsNav.querySelectorAll("[data-tab]")]) {
      const tab = button.dataset.tab;
      if (!tab || tab === "all") continue;
      const groups = tabGroups(root, tab);
      if (groups.length < 2) continue; // 그룹 1개 = 목차가 의미 없다

      const list = root.createElement("div");
      list.className = "settings-tab-outline";
      list.hidden = true;
      groups.forEach(({ title, target }, index) => {
        if (!target.id) target.id = `settings-group-${tab}-${index}`;
        const link = root.createElement("button");
        link.type = "button";
        link.className = "settings-tab-outline-item";
        link.dataset.settingsGroupLink = target.id;
        link.textContent = plainName(title);
        list.append(link);
      });
      if (!list.children.length) continue;
      button.after(list);
      button.setAttribute("aria-expanded", "false");
      listByTab.set(tab, list);
    }

    tabsNav.addEventListener("click", (event) => {
      const link = event.target.closest?.("[data-settings-group-link]");
      if (!link) return;
      const section = root.getElementById(link.dataset.settingsGroupLink);
      if (!section) return;
      // 오른쪽 목록을 바꾸지 않는다. 해당 그룹으로 이동만 한다.
      section.scrollIntoView({ block: "start", behavior: "smooth" });
      const flash = section.classList.contains("settings-group-title")
        ? section
        : section.querySelector(".settings-group-title") || section;
      flash.classList.add("is-group-flash");
      root.defaultView?.setTimeout(
        () => flash.classList.remove("is-group-flash"),
        GROUP_FLASH_MS,
      );
      for (const other of tabsNav.querySelectorAll(".settings-tab-outline-item")) {
        other.classList.toggle("is-active", other === link);
      }
      onJump?.(section);
    });

    return {
      sync(activeTab) {
        for (const [tab, list] of listByTab) {
          const open = tab === activeTab;
          list.hidden = !open;
          const button = tabsNav.querySelector(`[data-tab="${tab}"]`);
          button?.setAttribute("aria-expanded", String(open));
          if (!open) {
            list.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
          }
        }
      },
    };
  }

  globalThis.CheeseSettingsUi = {
    readLastTab, rememberTab, createSearch, prepareHelp, createDisclosures,
    createTabOutline,
    checkedFromStored, storedFromChecked,
  };
})();
