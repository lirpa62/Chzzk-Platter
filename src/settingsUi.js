// Settings presentation only: feature flags and their stored polarity stay unchanged.
(() => {
  "use strict";
  const LAST_TAB_KEY = "cheeseSettingsLastTab";
  // 마지막 탭·펼침 상태를 '기억할지' 여부. 둘 다 기본 꺼짐(열 때마다 초기화).
  // ⚠ chrome.storage 는 비동기라 첫 페인트 뒤에 값이 온다. 복원은 그 전에
  //   일어나야 해서 localStorage 사본을 읽는다(팝업 폭과 같은 방식).
  //   정본은 chrome.storage 이고 settings.js 가 두 곳에 함께 적는다.
  const REMEMBER_TAB_KEY = "cheeseSettingsRememberTab";
  const REMEMBER_EXPANDED_KEY = "cheeseSettingsRememberExpanded";

  function readFlag(storage, key) {
    try {
      return storage.getItem(key) === "1";
    } catch {
      return false;
    }
  }
  const EXPANDED_KEY = "cheeseSettingsExpandedFeatures";
  const DISCLOSURES = [
    ["update-notice", "[data-update-notice-enabled]"],
    ["wheel-volume", "[data-wheel-volume]"],
    ["action-overlay", "[data-action-overlay]"],
    ["mixer-exclusions", "[data-mixer-auto-enable]"],
    ["mixer-default", "[data-mixer-global-default-enabled]"],
    ["mixer-gain", "[data-mixer-global-gain-default-enabled]"],
    ["filter-exclusions", "[data-video-filter-auto-enable]"],
    ["affinity", "[data-affinity-on]"],
    ["vod-activity", "[data-vod-chat-graph]"],
    ["vod-role-chat", "[data-vod-role-chat]"],
    ["logpower-toast", '[data-feature="chatLogPowerToast"]'],
    ["page-favorite", '[data-feature="sbFollowPageFavoriteButton"]'],
    ["fav-enabled", '[data-feature="sbFollowFavEnabled"]'],
    ["group-enabled", '[data-feature="sbFollowGroupEnabled"]'],
    ["lounge-news", '[data-feature="loungeNews"]'],
    ["inbox-community", '[data-feature="inboxCommunityNews"]'],
    ["inbox-logpower", '[data-feature="inboxLogPower"]'],
    ["chat-time", '[data-feature="chatShowTime"]'],
    ["chat-device", '[data-feature="chatShowOsIcon"]'],
    ["popup-player", "[data-popup-player]"],
    ["preview-colors", "[data-settings-preview-colors]"],
    ["clip-precision", '[data-feature="clipEditorPrecision"]'],
    ["chat-recap", "[data-chat-recap-enabled]"],
    // 자식이 여럿인데 접기 버튼이 없던 상위 옵션들. 하위가 길게 이어져 그룹의
    // 경계가 보이지 않았다.
    ["search-live-rerank", "[data-search-live-rerank]"],
    ["search-rerank", "[data-search-rerank]"],
    ["search-clips", "[data-integrated-search-clips]"],
    ["card-preview-audio", "[data-card-preview-audio]"],
    ["clip-mixer", "[data-clip-audio-mixer-enabled]"],
    ["clip-filter", "[data-clip-video-filter-enabled]"],
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
    ["[data-mixer-auto-enable]", "[data-mixer-exclude-item]"],
    ["[data-mixer-global-default-enabled]", "[data-mixer-global-default-mode]"],
    ["[data-mixer-global-gain-default-enabled]", "[data-mixer-global-gain-default-mode]"],
    ["[data-video-filter-auto-enable]", "[data-video-filter-exclude-item]"],
    ["[data-video-filter-global-default-enabled]", "[data-video-filter-global-default-mode]"],
    // 다른 탭 알림은 토스트를 끄면 애초에 뜰 곳이 없다 → 부모가 꺼지면 잠근다.
    ['[data-feature="chatLogPowerToast"]', '[data-feature="chatLogPowerToastOtherTabs"]'],
    ['[data-feature="sbFollowPageFavoriteButton"]', '[data-feature="sbFollowPageFavLive"], [data-feature="sbFollowPageFavVideo"], [data-feature="sbFollowPageFavChannel"], [data-feature="sbFollowPageFavSearch"]'],
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
    // 통합검색 라이브·동영상과 같은 구성: 결과 표시가 꺼지면 나머지는 쓰이지 않는다.
    ["[data-integrated-search-clips]", "[data-integrated-search-clips-direct-play], #integratedSearchClipMatchMode, [data-integrated-search-clips-source-preset], #integratedSearchClipDateFilter, #integratedSearchClipDefaultSort, [data-integrated-search-clips-candidate-limit-slider], [data-integrated-search-clips-more-step], [data-integrated-search-clips-w-title]"],
    ['[data-feature="loungeNews"]', '[data-feature="loungeNewsDot"], #loungeRefresh'],
    ['[data-feature="inboxCommunityNews"]', '[data-feature="inboxCommunityNewsDot"], [data-inbox-community-new-tab], #inboxCommunityRefresh'],
    ['[data-feature="inboxLogPower"]', '[data-feature="inboxLogPowerDot"]'],
    // ⚠ 자동 펼치기도 즐겨찾기 사용의 하위다. 예전에는 두 개수 옵션 '사이에'
    //   끼어 있어 화면상으로는 자동 펼치기의 하위처럼 보였다(잠기지 않는다는
    //   문제의 원인). 개수는 자동 펼치기를 꺼야 비로소 쓰이므로 그 하위가 아니다.
    ['[data-feature="sbFollowFavEnabled"]', '[data-cf-fav-initial], [data-cf-fav-more], [data-feature="sbFollowFavAutoExpand"]'],
    // 즐겨찾기와 같은 구성: 사용 → (개수 둘, 자동 펼치기).
    ['[data-feature="sbFollowGroupEnabled"]', '[data-cf-group-initial], [data-cf-group-more], [data-feature="sbFollowGroupAutoExpand"]'],
    ['[data-feature="sbFollowGroupTags"]', "[data-cf-group-tag-hide-offline]"],
    ["[data-affinity-on]", "[data-affinity-hide-offline], [data-affinity-initial], [data-affinity-more], [data-settings-affinity-weights]"],
    ["[data-follow-preview-card-layout]", "#followPreviewBadgePos"],
    ["[data-settings-preview-colors]", "[data-fp-color-enabled]"],
    ["[data-popup-player]", "[data-popup-player-audio], [data-popup-player-size], [data-popup-player-wide], [data-popup-player-start-without-chat], [data-popup-player-scroll], [data-popup-player-maxq]"],
    ["[data-popup-player-size]", "[data-popup-player-size-w]"],
    ["[data-popup-player-start-without-chat]", "[data-popup-player-start-without-chat-16-9]"],
    ["[data-card-live-preview]", "#cardLivePreviewPosition"],
    ["[data-card-preview-audio]", "[data-card-preview-default-volume], [data-card-preview-wheel-mode], [data-card-preview-wheel-delay]"],
    ["[data-channel-live-button]", "[data-channel-live-button-end]"],
    ["[data-channel-profile-radius-enabled]", "[data-channel-profile-radius]"],
    ["[data-channel-live-profile-custom]", "[data-channel-live-profile-angle]"],
    ["[data-root-to-following]", "#rootToFollowingLogoMode"],
    ['[data-feature="chatShowTime"]', "[data-chat-time-format], [data-chat-time-color-enabled]"],
    ['[data-feature="chatShowOsIcon"]', "[data-chat-os-position], [data-chat-os-image-input]"],
    ["[data-chat-history]", "[data-chat-history-limit]"],
    ["[data-chat-recap-enabled]", "[data-chat-recap-retention], [data-recap-manage-list]"],
    ['[data-feature="chatEmoticonAltClick"]', "[data-emoticon-block-input]"],
    ['[data-feature="clipVault"]', "[data-clip-vault-limit]"],
    ["[data-clip-audio-mixer-enabled]", "[data-clip-audio-mixer-always-on], [data-settings-clip-mixer-preset]"],
    ["[data-clip-video-filter-enabled]", "[data-clip-video-filter-always-on], [data-settings-clip-filter-preset]"],
    ["[data-embed-clip-default-preset-enabled]", '[data-global-default-picker="embed"]'],
    ["[data-embed-clip-default-gain-enabled]", "[data-embed-clip-default-gain]"],
    ['[data-feature="clipEditorPrecision"]', "[data-clip-editor-step-picker]"],
    ["[data-cafe-now]", "[data-cafe-now-autoplay]"],
    ["[data-cafe-now-autoplay]", "[data-cafe-now-autoplay-muted]"],
    ["[data-chat-font-scale]", "[data-chat-font-scale-special]"],
  ];

  function readLastTab(storage, validTabs, requested) {
    // URL 로 탭을 지정한 경우(새 탭으로 열기)는 옵션과 무관하게 그 탭을 연다.
    if (validTabs.includes(requested)) return requested;
    if (!readFlag(storage, REMEMBER_TAB_KEY)) return "all";
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

  // 상위 옵션이 꺼져 있으면 하위 옵션을 잠근다(.is-locked + 컨트롤 disabled).
  // 예전에는 기능마다 settings.js 가 따로 처리해, 빠뜨린 곳에서는 상위를 꺼도
  // 하위를 그대로 조작할 수 있었다(실측: 토글 부모 36쌍 중 12쌍).
  // 여기서 부모-자식 관계를 이미 알고 있으므로 한 곳에서 일괄 처리한다.
  //
  // ⚠ 부모가 on/off 토글(체크박스)일 때만 적용한다. 부모가 선택지(라디오·피커)면
  //   '꺼짐'이라는 상태가 없어 잠글 근거가 없다.
  // ⚠ 조상 중 하나라도 꺼져 있으면 잠근다. 2단계 자식은 부모가 켜져 있어도
  //   조부모가 꺼져 있으면 어차피 동작하지 않는다.
  // ⚠ 이미 다른 이유로 disabled 인 컨트롤을 우리가 풀어 주면 안 된다. 우리가 끈
  //   것만 되돌리도록 표시해 둔다.
  const LOCK_OWNED = "cheeseLockOwned";

  function parentToggleOff(row, parents) {
    for (let parent = parents.get(row); parent; parent = parents.get(parent)) {
      const input = parent.querySelector('input[type="checkbox"]');
      if (input && !input.checked) return true;
    }
    return false;
  }

  function applyLocks(root, parents) {
    for (const row of parents.keys()) {
      const locked = parentToggleOff(row, parents);
      row.classList.toggle("is-locked", locked);
      for (const control of row.querySelectorAll("input, select, button, textarea")) {
        if (locked) {
          if (!control.disabled) {
            control.disabled = true;
            control.dataset[LOCK_OWNED] = "1";
          }
        } else if (control.dataset[LOCK_OWNED]) {
          control.disabled = false;
          delete control.dataset[LOCK_OWNED];
        }
      }
    }
  }

  function createDisclosures(root, storage) {
    const parents = createParents(root);
    markHierarchy(root, parents);
    const expanded = new Set();
    // 기억 옵션이 꺼져 있으면 저장값을 읽지 않는다(항상 접힌 채로 시작).
    if (readFlag(storage, REMEMBER_EXPANDED_KEY)) {
      try {
        const saved = JSON.parse(storage.getItem(EXPANDED_KEY));
        if (Array.isArray(saved)) saved.forEach((id) => {
          if (DISCLOSURES.some(([key]) => key === id)) expanded.add(id);
        });
      } catch {}
    }
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
    // 펼쳐도 보여 줄 게 없으면(모든 자식이 다른 이유로 숨겨져 있으면) 버튼 자체를
    // 감춘다. 예: '자동 활성화 제외 채널'은 제외된 채널이 없으면 settings.js 가 행을
    // 숨기는데, 그때 펼치기 버튼만 남아 눌러도 아무 일이 없었다.
    // ⚠ is-feature-collapsed 는 '우리가 접어서' 숨긴 것이라 제외하고 판단한다.
    //   그걸 세면 접혀 있을 때마다 버튼이 사라져 다시 펼칠 수 없다.
    function hasVisibleMember(members) {
      return members.some(
        (row) => !row.hidden && !row.classList.contains("is-search-hidden"),
      );
    }
    function render() {
      groups.forEach(({ id, button, label, members }) => {
        const usable = hasVisibleMember(members);
        button.hidden = !usable;
        const open =
          usable &&
          (expanded.has(id) || Boolean(searchRows && members.some((row) => searchRows.has(row))));
        button.setAttribute("aria-expanded", String(open));
        button.setAttribute("aria-label", `${label} 세부 설정 ${open ? "접기" : "펼치기"}`);
        button.disabled = Boolean(searchRows);
        members.forEach((row) => row.classList.toggle("is-feature-collapsed", !open));
      });
      applyLocks(root, parents);
      refreshBadges();
    }
    render();
    // 부모 토글이 바뀌면 즉시 잠금을 다시 계산한다(설정 저장과 무관하게 화면만).
    root.addEventListener("change", (event) => {
      if (!event.target?.matches?.('input[type="checkbox"]')) return;
      applyLocks(root, parents);
    });
    return {
      refreshBadges,
      // 자식 행이 나중에 숨겨지거나 다시 나타나면(예: 제외 채널 목록이 비거나
      // 채워지면) 다시 불러 펼치기 버튼 표시를 맞춘다.
      refresh: render,
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

  // 목차 맨 아래에 두는 '바로 실행' 항목. 그룹으로 이동하는 게 아니라 버튼을
  // 대신 눌러 준다(채팅 리캡·통나무파워 내역처럼 별도 화면을 여는 것).
  const TAB_ACTIONS = [
    ["chat", "#openChatRecap"],
    ["logpower", "#openLogStats"],
  ];

  // ⚠ 그룹 제목이 '섹션마다 하나'인 탭과 '한 섹션 안에 여러 개'인 탭이 섞여 있다
  //   (예: 플레이어는 섹션 분리, 전용 팔로잉·검색은 한 섹션에 제목 5개).
  //   그래서 섹션이 아니라 '제목'을 기준으로 모은다 — 두 형태를 모두 잡는다.
  function tabGroups(root, tab) {
    const out = [];
    for (const section of root.querySelectorAll(
      `section.settings-group[data-panel="${tab}"]`,
    )) {
      // ⚠ '항목이 있는가'를 li.settings-item 으로만 보면 안 된다. 설정 이동,
      //   실시간 따라잡기 민감도, 헤더 팔로우처럼 li 없이 버튼·슬라이더로만
      //   이루어진 그룹이 목차에서 통째로 빠진다(일반 탭에 '설정 이동'
      //   이 없다). 조작할 게 하나라도 있으면 그룹으로 센다.
      if (!section.querySelector("li.settings-item, button, input, select, textarea")) {
        continue;
      }
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
      for (const [actionTab, selector] of TAB_ACTIONS) {
        if (actionTab !== tab) continue;
        const source = root.querySelector(selector);
        if (!source) continue;
        const link = root.createElement("button");
        link.type = "button";
        link.className = "settings-tab-outline-item is-action";
        link.dataset.settingsActionLink = selector;
        link.textContent = plainName(source);
        list.append(link);
      }
      if (!list.children.length) continue;
      button.after(list);
      button.setAttribute("aria-expanded", "false");
      listByTab.set(tab, list);
    }

    tabsNav.addEventListener("click", (event) => {
      // '바로 실행' 항목은 원래 버튼을 대신 누른다(스크롤하지 않는다).
      const action = event.target.closest?.("[data-settings-action-link]");
      if (action) {
        root.querySelector(action.dataset.settingsActionLink)?.click();
        return;
      }
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
