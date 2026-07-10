// 치즈 서치 - 기능 설정 팝업
// 확장 아이콘 클릭 시 뜨는 전용 설정 페이지. 8개 기능의 표시/숨김을 전역
// (chrome.storage.local `cheeseFeatureHidden`)으로 저장한다. content.js가
// storage.onChanged로 즉시 반영하므로 열린 치지직 탭에 바로 적용된다.
(() => {
  "use strict";

  // ── storage 일괄 프리페치 + 캐시 ──────────────────────────────────────────
  // 예전엔 각 옵션이 chrome.storage.local.get(단일키) 를 개별 호출해, 팝업을 열 때
  // 수십 번의 IPC 가 몰려 콜드 스타트에서 렌더가 버벅였다. 팝업 시작 시 get(null) 로
  // 전체를 1회만 읽어 캐시하고, 각 옵션의 로드는 이 캐시에서 즉시 값을 꺼낸다.
  // set 시 캐시도 함께 갱신하고, 외부 변경(onChanged)은 캐시에 반영한다.
  // 설정 팝업이 쓰는 키만 프리페치한다. get(null) 로 전체를 읽으면 background 가 저장한
  // 대용량 캐시(cache:* 청크 등)까지 역직렬화해 팝업이 오히려 느려진다(캐시가 쌓일수록
  // 심해짐). 아래 목록은 설정 관련 키(cheese*/audioMixer:*/videoFilter:*)만 담는다.
  // 새 옵션을 추가하면 이 배열에도 그 키를 넣어야 로드된다(누락 시 그 옵션만 기본값으로
  // 뜰 뿐, 다른 값은 안전).
  const SETTINGS_STORAGE_KEYS = [
    "cheeseFeatureHidden", // 모든 data-feature 토글 통합
    "cheeseSearchTheme",
    "cheeseAdMiniplayerKeepMuted",
    "cheeseAdMiniplayerUnmute",
    "cheeseAutoReloadOnError",
    "cheeseCafeNow",
    "cheeseCardDateTooltip",
    "cheeseCardLivePreview",
    "cheeseCardPreviewAudio",
    "cheeseCardPreviewWheelDelaySec",
    "cheeseChannelLiveButton",
    "cheeseChannelLiveButtonEnd",
    "cheeseChatButtonWrap",
    "cheeseChatFoldPersist",
    "cheeseChatFontScale",
    "cheeseChatFontScaleSpecial",
    "cheeseChatMoaActive",
    "cheeseFollowChannelTooltip",
    "cheeseFollowCleanup",
    "cheeseFollowPreview",
    "cheeseFollowPreviewFullTitle",
    "cheeseFollowPreviewHeaderFont",
    "cheeseFollowPreviewLiveEdge",
    "cheeseFollowPreviewMaxLifeSec",
    "cheeseFollowPreviewMuted",
    "cheeseFollowPreviewThumbOnly",
    "cheeseFollowPreviewVolume",
    "cheeseFollowRefreshSec",
    "cheeseHeaderFollowCount",
    "cheeseHeaderNav",
    "cheeseLiveSeekBar",
    "cheeseLogPowerClickAction",
    "cheeseLogPowerEarningColor",
    "cheeseLogPowerPopupLimit",
    "cheeseLogPowerProgressMode",
    "cheeseLogPowerTimerMode",
    "cheeseLogPowerEraser",
    "cheeseMixerAlwaysOn",
    "cheeseMaxQuality",
    "cheeseMaxQualityRespectManual",
    "cheeseMixerBeginner",
    "cheeseMixerClickActivate",
    "cheeseMixerClickNoPanel",
    "cheeseMixerGainMin",
    "cheeseMixerGainMax",
    "cheeseMixerGlobalDefaultMode",
    "cheesePlayerButtonSide",
    "cheeseScreenshotDirectSave",
    "cheeseScreenshotPreview",
    "cheeseSeekStepS",
    "cheeseSubscribeBadgeProgress",
    "cheeseSyncCustom",
    "cheeseSyncPreset",
    "cheeseVideoFilterAlwaysOn",
    "cheeseVideoFilterBeginner",
    "cheeseVideoFilterClickActivate",
    "cheeseVideoFilterClickNoPanel",
    "cheeseVideoFilterGlobalDefaultMode",
    "cheeseVodAutoplayOff",
    "cheeseVolumePct",
    "cheeseGainPct",
    "cheeseWideScreenAuto",
    "audioMixer:presets",
    "audioMixer:globalDefault",
    "audioMixer:defaultCustomId",
    "videoFilter:presets",
    "videoFilter:globalDefault",
    "hiddenChannels",
  ];
  let storageCacheData = null;
  const storagePrefetch = (async () => {
    try {
      // 반드시 실제 IPC(chrome.storage.local.get)로 필요한 키만 읽는다.
      // (cachedStorageGet 을 쓰면 자기 자신 Promise 를 await 해 데드락에 빠진다.)
      storageCacheData =
        (await chrome.storage?.local?.get(SETTINGS_STORAGE_KEYS)) || {};
    } catch {
      storageCacheData = {};
    }
    return storageCacheData;
  })();

  // chrome.storage.local.get 대체: 키(문자열/배열)만 지원(옵션 로드용). 프리페치가
  // 끝났으면 IPC 없이 캐시에서, 아직이면 프리페치를 기다린 뒤 캐시에서 반환한다.
  async function cachedStorageGet(keys) {
    const data = storageCacheData || (await storagePrefetch) || {};
    if (keys == null) return { ...data };
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const k of list) {
      if (k in data) out[k] = data[k];
    }
    return out;
  }

  // set 래퍼: 실제 저장 + 로컬 캐시 동기화(이후 재조회가 최신값을 보게).
  function cachedStorageSet(obj) {
    if (storageCacheData) Object.assign(storageCacheData, obj);
    try {
      chrome.storage?.local?.set(obj);
    } catch {}
  }

  // 요소를 강제 잠금/해제(초보자 원클릭 기준). 원래 disabled 값을 dataset 에 보관했다가
  // 해제 시 복원해 항상 켜기 등 기존 잠금과 공존한다.
  function setBeginnerLock(el, on) {
    if (!el) return;
    const item = el.closest(".settings-item");
    if (on) {
      if (el.dataset.preBeginnerDisabled === undefined) {
        el.dataset.preBeginnerDisabled = el.disabled ? "1" : "0";
      }
      el.disabled = true;
      item?.classList.add("is-locked", "is-beginner-locked");
    } else {
      if (el.dataset.preBeginnerDisabled !== undefined) {
        el.disabled = el.dataset.preBeginnerDisabled === "1";
        delete el.dataset.preBeginnerDisabled;
      }
      item?.classList.remove("is-beginner-locked");
      if (!el.disabled) item?.classList.remove("is-locked");
    }
  }

  // '초보자용 원클릭' 토글 바인딩: 로드/저장 + 켜지면 관련 세부 옵션(lockSels)을 잠근다.
  // exclusiveSel(항상 켜기)과는 상호 배타 — 초보자 ON 이면 항상 켜기를 끄고 잠그고,
  // 항상 켜기 ON 이면 초보자를 끄고 잠근다(둘 다 켜면 패널을 못 여는 충돌 방지).
  function bindBeginnerOneClick({
    inputSel,
    key,
    lockSels,
    exclusiveSel,
    exclusiveKey,
  }) {
    const input = document.querySelector(inputSel);
    if (!input) return;
    const lockEls = lockSels
      .map((s) => document.querySelector(s))
      .filter(Boolean);
    const exclusiveEl = exclusiveSel
      ? document.querySelector(exclusiveSel)
      : null;

    // 초보자 ON → 하위 옵션 + 항상 켜기 잠금.
    function applyBeginnerLock(on) {
      lockEls.forEach((el) => setBeginnerLock(el, on));
      if (exclusiveEl) setBeginnerLock(exclusiveEl, on);
    }
    (async () => {
      let on = false; // 기본 OFF
      let alwaysOn = false;
      try {
        const d = await cachedStorageGet([key, exclusiveKey].filter(Boolean));
        on = d?.[key] === true;
        alwaysOn = exclusiveKey ? d?.[exclusiveKey] === true : false;
      } catch {}
      // 상호 배타: 항상 켜기가 이미 켜져 있으면 초보자는 강제로 꺼진 상태 + 잠금.
      // (과거에 둘 다 켜둔 사용자 정리 — storage 에도 off 를 반영해 MAIN 과 일치.)
      if (alwaysOn && on) {
        on = false;
        try {
          cachedStorageSet({ [key]: false });
        } catch {}
      }
      input.checked = on;
      applyBeginnerLock(on);
      if (exclusiveEl) setBeginnerLock(input, alwaysOn); // 항상 켜기 ON → 초보자 잠금
    })();
    input.addEventListener("change", () => {
      try {
        cachedStorageSet({ [key]: input.checked });
      } catch {}
      applyBeginnerLock(input.checked);
    });

    // 반대 방향: 항상 켜기 ON → 초보자 원클릭을 끄고 잠근다. 항상 켜기 OFF → 초보자 잠금 해제.
    if (exclusiveEl) {
      exclusiveEl.addEventListener("change", () => {
        const alwaysOn = !!exclusiveEl.checked;
        if (alwaysOn && input.checked) {
          input.checked = false;
          try {
            cachedStorageSet({ [key]: false });
          } catch {}
          applyBeginnerLock(false); // 초보자 꺼짐 → 하위 잠금 해제
        }
        setBeginnerLock(input, alwaysOn);
      });
    }
  }

  // 외부(치지직 탭 등)에서 값이 바뀌면 캐시에 반영.
  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !storageCacheData) return;
      for (const [k, { newValue }] of Object.entries(changes)) {
        if (newValue === undefined) delete storageCacheData[k];
        else storageCacheData[k] = newValue;
      }
    });
  } catch {}

  // ── 테마(검색 팝업과 localStorage 키 공유) ────────────────────────────────
  const THEME_STORAGE_KEY = "cheeseSearchTheme";
  const themeToggle = document.getElementById("themeToggleButton");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle?.setAttribute("aria-pressed", String(isDark));
    themeToggle?.setAttribute(
      "aria-label",
      isDark ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    applyTheme(next);
  }

  applyTheme(
    localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light",
  );
  themeToggle?.addEventListener("click", toggleTheme);

  // ── 카테고리 탭(좌측 탭 → 우측 패널 전환) ─────────────────────────────────
  // 팝업을 열 때마다 항상 첫 탭('전체')에서 시작한다(설정 팝업은 예측 가능성이
  // 직전 탭 기억보다 중요 → 마지막 탭을 저장하지 않는다).
  const tabButtons = Array.from(document.querySelectorAll(".settings-tab"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const panelsScroll = document.querySelector(".settings-panels");

  let activeTab = "all"; // 검색 종료 시 복귀할 현재 탭
  function selectTab(tab) {
    const valid = tabButtons.some((b) => b.dataset.tab === tab);
    const active = valid ? tab : "all";
    activeTab = active;
    tabButtons.forEach((btn) => {
      const on = btn.dataset.tab === active;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    panels.forEach((panel) => {
      // '전체'는 모든 패널 표시. 그 외엔 일치하는 패널만.
      panel.hidden = active !== "all" && panel.dataset.panel !== active;
    });
    // 탭 전환 시 우측 패널 스크롤을 최상단으로(이전 위치 잔류 방지).
    if (panelsScroll) panelsScroll.scrollTop = 0;
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      // 탭을 누르면 검색을 종료하고 그 탭으로 전환.
      if (searchInput && searchInput.value) {
        searchInput.value = "";
        applySettingsSearch("");
      }
      selectTab(btn.dataset.tab);
    }),
  );
  selectTab("all");

  // ── 설정 검색: 이름+설명 텍스트로 항목을 필터링(검색 중엔 전체 탭에서 찾는다). ──
  const searchInput = document.querySelector("[data-settings-search]");
  const searchClear = document.querySelector("[data-settings-search-clear]");
  const searchEmpty = document.querySelector("[data-settings-search-empty]");
  const searchItems = Array.from(document.querySelectorAll(".settings-item"));
  const searchGroups = Array.from(document.querySelectorAll(".settings-group"));
  // 하이라이트 대상: 각 항목의 이름/설명 요소. 원본 텍스트를 보존해 검색 종료 시 복원.
  const searchHighlightEls = Array.from(
    document.querySelectorAll(".settings-item-name, .settings-item-desc"),
  ).map((el) => ({ el, text: el.textContent || "" }));

  function escapeHtml(s) {
    return s.replace(
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
  }
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  // 요소 텍스트에서 q(대소문자 무시) 매칭 부분을 <mark>로 감싼다(원본은 이스케이프).
  function highlightEl(el, original, q) {
    if (!q) {
      el.textContent = original;
      return;
    }
    const re = new RegExp(escapeRegExp(q), "gi");
    el.innerHTML = escapeHtml(original).replace(
      re,
      (m) => `<mark class="settings-search-mark">${m}</mark>`,
    );
  }
  function clearHighlights() {
    searchHighlightEls.forEach(({ el, text }) => {
      el.textContent = text;
    });
  }

  function applySettingsSearch(rawQuery) {
    const q = rawQuery.trim().toLowerCase();
    if (searchClear) searchClear.hidden = q === "";
    if (q === "") {
      // 검색 종료: 하이라이트 제거 + 항목/그룹 표시 원복 + 현재 탭 필터 복귀.
      clearHighlights();
      searchItems.forEach((el) => (el.hidden = false));
      if (searchEmpty) searchEmpty.hidden = true;
      selectTab(activeTab);
      return;
    }
    // 검색 중: 탭바는 모두 비활성, 매칭 항목만 표시.
    tabButtons.forEach((btn) => {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-selected", "false");
    });
    let anyMatch = false;
    searchItems.forEach((item) => {
      const text = (item.textContent || "").toLowerCase();
      const hit = text.includes(q);
      item.hidden = !hit;
      if (hit) anyMatch = true;
    });
    // 이름/설명에 하이라이트 적용(보이는 항목만; 숨긴 항목은 원본 유지).
    searchHighlightEls.forEach(({ el, text }) => {
      const inHidden = el.closest(".settings-item")?.hidden;
      highlightEl(el, text, inHidden ? "" : q);
    });
    // 항목이 하나도 안 남은 그룹(그리고 그 그룹 제목)은 통째로 숨긴다.
    searchGroups.forEach((group) => {
      const hasVisible = group.querySelector(".settings-item:not([hidden])");
      group.hidden = !hasVisible;
    });
    if (searchEmpty) searchEmpty.hidden = anyMatch;
    if (panelsScroll) panelsScroll.scrollTop = 0;
  }

  searchInput?.addEventListener("input", () =>
    applySettingsSearch(searchInput.value),
  );
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchInput.value) {
      e.preventDefault();
      searchInput.value = "";
      applySettingsSearch("");
    }
  });
  searchClear?.addEventListener("click", () => {
    if (!searchInput) return;
    searchInput.value = "";
    applySettingsSearch("");
    searchInput.focus();
  });

  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  // 미설정 시 기본 체크(숨김)인 항목. clipLiveButton은 기본적으로 숨긴다.
  const DEFAULT_HIDDEN = new Set(["clipLiveButton"]);
  const inputs = Array.from(document.querySelectorAll("[data-feature]"));

  // 로드가 성공적으로 끝나기 전엔 save() 로 전체(cheeseFeatureHidden)를 덮어쓰지 않는다.
  // 로드 실패/미완료 상태에서 저장하면 모든 토글이 기본값(unchecked)으로 확정돼 기존
  // 설정 전체가 유실되기 때문이다(과거 이 사고가 있었다). 로드가 확실히 끝난 뒤에만 true.
  let featureFlagsLoaded = false;
  async function load() {
    let saved = {};
    let ok = false;
    try {
      const data = await cachedStorageGet(FEATURE_HIDDEN_KEY);
      ok = true; // get 이 예외 없이 완료됨 = 저장값을 정상적으로 읽음(값 없으면 {}).
      const value = data?.[FEATURE_HIDDEN_KEY];
      if (value && typeof value === "object") saved = value;
    } catch {
      // 로드 실패 → ok=false 로 저장을 잠근다(전체 덮어쓰기 사고 방지).
    }
    inputs.forEach((input) => {
      const key = input.dataset.feature;
      const v = saved[key];
      input.checked = typeof v === "boolean" ? v : DEFAULT_HIDDEN.has(key);
    });
    if (ok) featureFlagsLoaded = true;
  }

  function save() {
    // 로드 완료 전에는 저장하지 않는다(기본값 전체 덮어쓰기 사고 방지).
    if (!featureFlagsLoaded) return;
    const flags = {};
    inputs.forEach((input) => {
      flags[input.dataset.feature] = input.checked;
    });
    try {
      cachedStorageSet({ [FEATURE_HIDDEN_KEY]: flags });
    } catch {
      // 저장 실패는 무시(다음 변경 때 재시도됨).
    }
  }

  inputs.forEach((input) => input.addEventListener("change", save));
  load();

  // ── 채팅 폰트 크기: 커스텀 팝오버 드롭다운(0.8~2, 기본 1) ──────────────────
  const CHAT_FONT_SCALE_KEY = "cheeseChatFontScale";
  // 입력은 퍼센트(80~200), 저장값은 배율(0.8~2.0).
  const chatFontScaleInput = document.querySelector("[data-chat-font-scale]");
  function clampChatFontPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 100;
    return Math.min(200, Math.max(80, Math.round(n / 5) * 5));
  }
  if (chatFontScaleInput) {
    (async () => {
      try {
        const d = await cachedStorageGet(CHAT_FONT_SCALE_KEY);
        const scale = Number(d?.[CHAT_FONT_SCALE_KEY]);
        const pct = Number.isFinite(scale) && scale > 0 ? scale * 100 : 100;
        chatFontScaleInput.value = String(clampChatFontPct(pct));
      } catch {
        chatFontScaleInput.value = "100";
      }
    })();
    const saveChatFontScale = () => {
      const pct = clampChatFontPct(chatFontScaleInput.value);
      chatFontScaleInput.value = String(pct);
      try {
        cachedStorageSet({ [CHAT_FONT_SCALE_KEY]: pct / 100 });
      } catch {}
    };
    chatFontScaleInput.addEventListener("change", saveChatFontScale);
    chatFontScaleInput.addEventListener("blur", saveChatFontScale);
  }

  // ── 후원·구독 등 특수 메시지도 폰트 크기 조절(기본 OFF) ─────────────────────
  const CHAT_FONT_SCALE_SPECIAL_KEY = "cheeseChatFontScaleSpecial";
  const chatFontScaleSpecialInput = document.querySelector(
    "[data-chat-font-scale-special]",
  );
  if (chatFontScaleSpecialInput) {
    (async () => {
      let on = false;
      try {
        const d = await cachedStorageGet(CHAT_FONT_SCALE_SPECIAL_KEY);
        on = d?.[CHAT_FONT_SCALE_SPECIAL_KEY] === true;
      } catch {}
      chatFontScaleSpecialInput.checked = on;
    })();
    chatFontScaleSpecialInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [CHAT_FONT_SCALE_SPECIAL_KEY]: chatFontScaleSpecialInput.checked,
        });
      } catch {}
    });
  }

  // ── 채팅 버튼 줄바꿈(너비 조절 시 도구/후원 줄 wrap, 기본 ON) ───────────────
  const CHAT_BUTTON_WRAP_KEY = "cheeseChatButtonWrap";
  const chatButtonWrapInput = document.querySelector("[data-chat-button-wrap]");
  if (chatButtonWrapInput) {
    (async () => {
      let on = true; // 기본 ON
      try {
        const d = await cachedStorageGet(CHAT_BUTTON_WRAP_KEY);
        on = d?.[CHAT_BUTTON_WRAP_KEY] !== false; // 미설정/true=사용
      } catch {}
      chatButtonWrapInput.checked = on;
    })();
    chatButtonWrapInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [CHAT_BUTTON_WRAP_KEY]: chatButtonWrapInput.checked,
        });
      } catch {}
    });
  }

  // ── 채팅 기능: 배지 모아 챗이 제어 중이면 해당 토글/셀렉트를 비활성화 ─────────
  // content.js가 페이지에서 moa 제어 상태를 cheeseChatMoaActive(배열)로 기록한다.
  const CHAT_MOA_ACTIVE_KEY = "cheeseChatMoaActive";
  function applyChatMoaLock(activeKeys) {
    const locked = new Set(Array.isArray(activeKeys) ? activeKeys : []);
    inputs.forEach((input) => {
      const key = input.dataset.feature;
      if (!key || !key.startsWith("chat")) return;
      const item = input.closest(".settings-item");
      if (locked.has(key)) {
        input.disabled = true;
        item?.classList.add("is-locked");
        item?.setAttribute("title", "배지 모아 챗이 이 기능을 제어 중입니다");
      } else {
        input.disabled = false;
        item?.classList.remove("is-locked");
        item?.removeAttribute("title");
      }
    });
    // 폰트 크기 입력도 moa가 폰트 스케일을 제어 중이면 잠근다.
    if (chatFontScaleInput) {
      const item = chatFontScaleInput.closest(".settings-item");
      if (locked.has("chatFontScale")) {
        chatFontScaleInput.disabled = true;
        item?.classList.add("is-locked");
        item?.setAttribute("title", "배지 모아 챗이 이 기능을 제어 중입니다");
      } else {
        chatFontScaleInput.disabled = false;
        item?.classList.remove("is-locked");
        item?.removeAttribute("title");
      }
    }
  }
  (async () => {
    try {
      const d = await cachedStorageGet(CHAT_MOA_ACTIVE_KEY);
      applyChatMoaLock(d?.[CHAT_MOA_ACTIVE_KEY]);
    } catch {}
  })();
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[CHAT_MOA_ACTIVE_KEY]) {
      applyChatMoaLock(changes[CHAT_MOA_ACTIVE_KEY].newValue);
    }
  });

  // ── 헤더 바로가기(사이드바 숨김 시 헤더 미니 네비 표시 항목) ───────────────
  // data-feature와 의미가 반대: 체크=표시. 미설정 시 기본 표시 항목은 아래 집합.
  const HEADER_NAV_KEY = "cheeseHeaderNav";
  const HEADER_NAV_DEFAULT_SHOWN = new Set([
    "hdrLives",
    "hdrClips",
    "hdrCategory",
    "hdrFollowing",
  ]);
  const headerNavInputs = Array.from(
    document.querySelectorAll("[data-header-nav]"),
  );

  async function loadHeaderNav() {
    let saved = {};
    try {
      const data = await cachedStorageGet(HEADER_NAV_KEY);
      const value = data?.[HEADER_NAV_KEY];
      if (value && typeof value === "object") saved = value;
    } catch {}
    headerNavInputs.forEach((input) => {
      const key = input.dataset.headerNav;
      const v = saved[key];
      input.checked =
        typeof v === "boolean" ? v : HEADER_NAV_DEFAULT_SHOWN.has(key);
    });
  }

  function saveHeaderNav() {
    const cfg = {};
    headerNavInputs.forEach((input) => {
      cfg[input.dataset.headerNav] = input.checked;
    });
    try {
      cachedStorageSet({ [HEADER_NAV_KEY]: cfg });
    } catch {}
  }

  // ── 헤더 바로가기 3개 제한(스튜디오 버튼을 숨기지 않을 때) ──────────────────
  // 스튜디오 버튼이 보이면 헤더 우측 공간이 좁아 바로가기를 3개까지만 허용한다.
  // 3개가 켜지면 나머지(체크 안 된 것)를 비활성화하고 안내를 표시한다. 이미 3개
  // 초과가 저장돼 있어도 그 값은 건드리지 않고, 추가로 더 켜는 것만 막는다.
  const HEADER_NAV_MAX_WITH_STUDIO = 3;
  const headerStudioInput = document.querySelector(
    '[data-feature="headerStudio"]',
  );
  const headerNavList = headerNavInputs[0]?.closest(".settings-list") || null;
  const headerNavGroupDesc =
    headerNavList?.parentElement?.querySelector(".settings-group-desc") || null;

  // 스튜디오 버튼이 '보이는' 상태인지(체크=숨김이므로 !checked=보임). data-feature
  // 체크박스는 loadHeaderNav 시점엔 아직 로드 전일 수 있어 storage에서 직접 읽는다.
  function isStudioVisible() {
    return !(headerStudioInput && headerStudioInput.checked);
  }

  function showHeaderNavLimitNotice(show) {
    let el = document.getElementById("headerNavLimitNotice");
    if (!show) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("p");
      el.id = "headerNavLimitNotice";
      el.className = "settings-notice";
      if (headerNavGroupDesc) {
        headerNavGroupDesc.insertAdjacentElement("beforebegin", el);
      } else {
        headerNavList?.insertAdjacentElement("afterend", el);
      }
    }
    el.textContent =
      "‘스튜디오 버튼 숨김’이 꺼져 있어 헤더 공간이 좁습니다. 바로가기는 최대 3개까지만 선택할 수 있어요(스튜디오 버튼을 숨기면 제한이 풀립니다).";
  }

  function refreshHeaderNavLimit() {
    const limited = isStudioVisible();
    const checkedCount = headerNavInputs.filter((i) => i.checked).length;
    const atMax = checkedCount >= HEADER_NAV_MAX_WITH_STUDIO;
    headerNavInputs.forEach((input) => {
      // 스튜디오 보임 + 이미 3개 이상 체크 시, 체크 안 된 항목만 비활성화(끄기는 허용).
      const disable = limited && atMax && !input.checked;
      input.disabled = disable;
      input.closest(".settings-item")?.classList.toggle("is-locked", disable);
    });
    // 안내는 '제한 활성(스튜디오 보임)'일 때만 표시.
    showHeaderNavLimitNotice(limited);
  }

  headerNavInputs.forEach((input) =>
    input.addEventListener("change", () => {
      saveHeaderNav();
      refreshHeaderNavLimit();
    }),
  );
  // 스튜디오 버튼 숨김 토글을 바꾸면 제한 상태도 즉시 갱신.
  headerStudioInput?.addEventListener("change", refreshHeaderNavLimit);
  // 초기: 저장값 로드 후 제한 상태를 확정한다(체크박스 상태가 채워진 뒤).
  (async () => {
    await loadHeaderNav();
    // headerStudio 체크박스 초기 상태를 storage에서 직접 읽어 확정.
    try {
      const d = await cachedStorageGet(FEATURE_HIDDEN_KEY);
      if (headerStudioInput) {
        headerStudioInput.checked = d?.[FEATURE_HIDDEN_KEY]?.headerStudio === true;
      }
    } catch {}
    refreshHeaderNavLimit();
  })();

  // ── 오디오 믹서 항상 켜기(전역) ───────────────────────────────────────────
  // data-feature와 별개 키. 체크=항상 켜기(첫 제스처 후 자동 활성화).
  const MIXER_ALWAYS_ON_KEY = "cheeseMixerAlwaysOn";
  const mixerAlwaysOnInput = document.querySelector("[data-mixer-always-on]");

  async function loadMixerAlwaysOn() {
    let on = false;
    try {
      const data = await cachedStorageGet(MIXER_ALWAYS_ON_KEY);
      on = data?.[MIXER_ALWAYS_ON_KEY] === true;
    } catch {}
    if (mixerAlwaysOnInput) mixerAlwaysOnInput.checked = on;
  }

  mixerAlwaysOnInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [MIXER_ALWAYS_ON_KEY]: mixerAlwaysOnInput.checked,
      });
    } catch {}
  });
  loadMixerAlwaysOn();

  // ── 오디오 믹서 전역 기본값(채널 무관) ────────────────────────────────────
  const AUDIO_MIXER_PRESETS_KEY = "audioMixer:presets";
  const AUDIO_MIXER_GLOBAL_DEFAULT_KEY = "audioMixer:globalDefault";
  const VIDEO_FILTER_PRESETS_KEY = "videoFilter:presets";
  const VIDEO_FILTER_GLOBAL_DEFAULT_KEY = "videoFilter:globalDefault";
  const MIXER_BUILT_IN_PRESETS = [
    ["default", "기본"],
    ["voice", "저챗·라디오"],
    ["game", "게임 방송"],
    ["outdoor", "야외방송"],
    ["music", "노래 방송"],
    ["classical", "클래식·재즈"],
    ["movie", "영화·드라마"],
    ["anime", "애니"],
    ["sports", "스포츠"],
    ["asmr", "ASMR"],
  ];
  const VIDEO_FILTER_BUILT_IN_PRESETS = [
    ["default", "원본"],
    ["fps", "FPS 게임"],
    ["moba", "롤·AOS"],
    ["game", "게임 일반"],
    ["horror", "공포 게임"],
    ["outdoor", "야외방송"],
    ["sports", "스포츠"],
    ["food", "먹방·쿡방"],
    ["cam", "캠방송"],
    ["vtuber", "버츄얼"],
    ["night", "야간 시청"],
    ["cinema", "시네마틱"],
  ];
  const mixerGlobalDefaultEnabledInput = document.querySelector(
    "[data-mixer-global-default-enabled]",
  );
  const videoFilterGlobalDefaultEnabledInput = document.querySelector(
    "[data-video-filter-global-default-enabled]",
  );
  let mixerCustomPresets = [];
  let mixerGlobalDefault = { enabled: false, preset: "default" };
  let videoFilterCustomPresets = [];
  let videoFilterGlobalDefault = { enabled: false, preset: "default" };

  function normalizeGlobalDefaultConfig(value) {
    const cfg = value && typeof value === "object" ? value : {};
    return {
      enabled: cfg.enabled === true,
      preset: String(cfg.preset || "default"),
    };
  }

  function globalDefaultConfig(type) {
    return type === "video" ? videoFilterGlobalDefault : mixerGlobalDefault;
  }

  function globalDefaultBuiltIns(type) {
    return type === "video"
      ? VIDEO_FILTER_BUILT_IN_PRESETS
      : MIXER_BUILT_IN_PRESETS;
  }

  function globalDefaultCustoms(type) {
    return type === "video" ? videoFilterCustomPresets : mixerCustomPresets;
  }

  function globalDefaultStorageKey(type) {
    return type === "video"
      ? VIDEO_FILTER_GLOBAL_DEFAULT_KEY
      : AUDIO_MIXER_GLOBAL_DEFAULT_KEY;
  }

  function globalDefaultEnabledInput(type) {
    return type === "video"
      ? videoFilterGlobalDefaultEnabledInput
      : mixerGlobalDefaultEnabledInput;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function globalDefaultRoot(type) {
    return document.querySelector(`[data-global-default-picker="${type}"]`);
  }

  function globalDefaultOptionExists(type, value) {
    if (globalDefaultBuiltIns(type).some(([key]) => key === value)) return true;
    return globalDefaultCustoms(type).some((preset) => preset?.id === value);
  }

  function globalDefaultOptionLabel(type, value) {
    const builtIn = globalDefaultBuiltIns(type).find(([key]) => key === value);
    if (builtIn) return builtIn[1];
    const custom = globalDefaultCustoms(type).find(
      (preset) => preset?.id === value,
    );
    return custom?.name || globalDefaultBuiltIns(type)[0][1];
  }

  function closeGlobalDefaultPicker(type) {
    const root = globalDefaultRoot(type);
    if (!root) return;
    const list = root.querySelector("[data-global-default-list]");
    const trigger = root.querySelector("[data-global-default-trigger]");
    root.classList.remove("is-open");
    if (list) list.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  }

  function closeAllGlobalDefaultPickers(exceptType = "") {
    ["audio", "video"].forEach((type) => {
      if (type !== exceptType) closeGlobalDefaultPicker(type);
    });
  }

  function positionGlobalDefaultList(root) {
    const trigger = root.querySelector("[data-global-default-trigger]");
    const list = root.querySelector("[data-global-default-list]");
    if (!trigger || !list) return;
    const rect = trigger.getBoundingClientRect();
    list.style.left = `${Math.round(rect.left)}px`;
    list.style.top = `${Math.round(rect.bottom + 4)}px`;
    list.style.minWidth = `${Math.round(rect.width)}px`;
    list.style.maxHeight = `${
      Math.max(140, window.innerHeight - rect.bottom - 16)
    }px`;
  }

  function renderGlobalDefaultPicker(type) {
    const root = globalDefaultRoot(type);
    if (!root) return;
    const config = globalDefaultConfig(type);
    const fallback = globalDefaultBuiltIns(type)[0][0];
    const selected = globalDefaultOptionExists(type, config.preset)
      ? config.preset
      : fallback;
    config.preset = selected;
    const label = root.querySelector("[data-global-default-label]");
    const list = root.querySelector("[data-global-default-list]");
    const trigger = root.querySelector("[data-global-default-trigger]");
    if (label) label.textContent = globalDefaultOptionLabel(type, selected);
    if (!list) return;
    const optionButton = (value, text, group) => {
      const selectedAttr = value === selected ? "true" : "false";
      return (
        `<li role="presentation"><button type="button" role="option" ` +
        `aria-selected="${selectedAttr}" ` +
        `data-global-default-option="${escapeHtml(value)}" ` +
        `data-global-default-group="${escapeHtml(group)}">` +
        `${escapeHtml(text)}</button></li>`
      );
    };
    const builtIns = globalDefaultBuiltIns(type)
      .map(([value, text]) => optionButton(value, text, "built-in"))
      .join("");
    const customs = globalDefaultCustoms(type)
      .filter((preset) => preset?.id && preset?.name)
      .map((preset) =>
        optionButton(String(preset.id), String(preset.name), "custom"),
      )
      .join("");
    list.innerHTML =
      `<li class="settings-popover-group" role="presentation">기본 프리셋</li>${builtIns}` +
      (customs
        ? `<li class="settings-popover-group" role="presentation">커스텀 프리셋</li>${customs}`
        : "");
    trigger?.setAttribute("data-value", selected);
    if (root.classList.contains("is-open")) positionGlobalDefaultList(root);
  }

  function syncGlobalDefaultUI(type) {
    const config = globalDefaultConfig(type);
    const input = globalDefaultEnabledInput(type);
    const root = globalDefaultRoot(type);
    const trigger = root?.querySelector("[data-global-default-trigger]");
    if (input) input.checked = config.enabled;
    if (trigger) trigger.disabled = !config.enabled;
    if (!config.enabled) closeGlobalDefaultPicker(type);
    renderGlobalDefaultPicker(type);
  }

  function saveGlobalDefault(type) {
    const config = globalDefaultConfig(type);
    config.enabled = globalDefaultEnabledInput(type)?.checked === true;
    // preset은 이미 config.preset에 반영돼 있다(옵션 클릭/로드 시 설정). 트리거의
    // data-value는 render 이후에야 갱신되므로 여기서 읽으면 '이전 선택값'으로
    // 덮어써 방금 고른 프리셋이 무시된다 → config.preset을 신뢰한다.
    config.preset = config.preset || "default";
    renderGlobalDefaultPicker(type);
    syncGlobalDefaultUI(type);
    try {
      cachedStorageSet({
        [globalDefaultStorageKey(type)]: { ...config },
      });
    } catch {}
  }

  function openGlobalDefaultPicker(type) {
    const root = globalDefaultRoot(type);
    const trigger = root?.querySelector("[data-global-default-trigger]");
    const list = root?.querySelector("[data-global-default-list]");
    if (!root || !trigger || !list || trigger.disabled) return;
    closeAllGlobalDefaultPickers(type);
    renderGlobalDefaultPicker(type);
    root.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.hidden = false;
    positionGlobalDefaultList(root);
  }

  ["audio", "video"].forEach((type) => {
    const root = globalDefaultRoot(type);
    root
      ?.querySelector("[data-global-default-trigger]")
      ?.addEventListener("click", () => {
        if (root.classList.contains("is-open")) closeGlobalDefaultPicker(type);
        else openGlobalDefaultPicker(type);
      });
    root
      ?.querySelector("[data-global-default-list]")
      ?.addEventListener("click", (event) => {
        const option = event.target.closest("[data-global-default-option]");
        if (!option) return;
        const config = globalDefaultConfig(type);
        config.preset = option.dataset.globalDefaultOption || "default";
        closeGlobalDefaultPicker(type);
        saveGlobalDefault(type);
      });
    globalDefaultEnabledInput(type)?.addEventListener("change", () =>
      saveGlobalDefault(type),
    );
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-global-default-picker]")) return;
    closeAllGlobalDefaultPickers();
  });
  window.addEventListener("resize", () => closeAllGlobalDefaultPickers());
  panelsScroll?.addEventListener("scroll", () => closeAllGlobalDefaultPickers());

  async function loadGlobalDefaults() {
    try {
      const data = await cachedStorageGet([
        AUDIO_MIXER_PRESETS_KEY,
        AUDIO_MIXER_GLOBAL_DEFAULT_KEY,
        VIDEO_FILTER_PRESETS_KEY,
        VIDEO_FILTER_GLOBAL_DEFAULT_KEY,
      ]);
      mixerCustomPresets = Array.isArray(data?.[AUDIO_MIXER_PRESETS_KEY])
        ? data[AUDIO_MIXER_PRESETS_KEY]
        : [];
      mixerGlobalDefault = normalizeGlobalDefaultConfig(
        data?.[AUDIO_MIXER_GLOBAL_DEFAULT_KEY],
      );
      videoFilterCustomPresets = Array.isArray(data?.[VIDEO_FILTER_PRESETS_KEY])
        ? data[VIDEO_FILTER_PRESETS_KEY]
        : [];
      videoFilterGlobalDefault = normalizeGlobalDefaultConfig(
        data?.[VIDEO_FILTER_GLOBAL_DEFAULT_KEY],
      );
    } catch {
      mixerCustomPresets = [];
      videoFilterCustomPresets = [];
      mixerGlobalDefault = { enabled: false, preset: "default" };
      videoFilterGlobalDefault = { enabled: false, preset: "default" };
    }
    syncGlobalDefaultUI("audio");
    syncGlobalDefaultUI("video");
  }

  loadGlobalDefaults();

  // ── 통나무파워 배지 클릭 동작(popup | navigate | none, 기본 popup) ──────────
  const LOGPOWER_CLICK_ACTION_KEY = "cheeseLogPowerClickAction";
  const logPowerClickButtons = Array.from(
    document.querySelectorAll("[data-logpower-click]"),
  );
  function normalizeLpClick(v) {
    return v === "navigate" || v === "none" ? v : "popup";
  }
  function reflectLpClick(action) {
    const v = normalizeLpClick(action);
    logPowerClickButtons.forEach((btn) => {
      const active = btn.dataset.logpowerClick === v;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }
  (async () => {
    let action = "popup";
    try {
      const d = await cachedStorageGet(LOGPOWER_CLICK_ACTION_KEY);
      action = normalizeLpClick(d?.[LOGPOWER_CLICK_ACTION_KEY]);
    } catch {}
    reflectLpClick(action);
  })();
  logPowerClickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = normalizeLpClick(btn.dataset.logpowerClick);
      reflectLpClick(action);
      try {
        cachedStorageSet({ [LOGPOWER_CLICK_ACTION_KEY]: action });
      } catch {}
    });
  });

  // ── 배지 '적립 중'/'1시간 타이머' 표시 위치(끔|배지|툴팁) + 적립 중 색 변경 ────
  // group: [data-*] 컨테이너, btnAttr: 버튼 data-* 키(camelCase), key: storage 키,
  // onChange: 값 반영 후 콜백. 반환: { group, get, set }.
  function bindLogPowerModeSeg(groupSel, btnAttr, key, onChange) {
    const group = document.querySelector(groupSel);
    if (!group) return null;
    const buttons = Array.from(group.querySelectorAll(`[data-${btnAttr}]`));
    const norm = (v) => (v === "off" || v === "tooltip" ? v : "badge");
    function reflect(mode) {
      const v = norm(mode);
      buttons.forEach((btn) => {
        const active = btn.dataset[toCamel(btnAttr)] === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    }
    (async () => {
      let mode = "badge";
      try {
        const d = await cachedStorageGet(key);
        mode = norm(d?.[key]);
      } catch {}
      reflect(mode);
      onChange?.();
    })();
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const mode = norm(btn.dataset[toCamel(btnAttr)]);
        reflect(mode);
        try {
          cachedStorageSet({ [key]: mode });
        } catch {}
        onChange?.();
      });
    });
    return {
      group,
      get: () => {
        const on = buttons.find((b) => b.classList.contains("is-active"));
        return on ? norm(on.dataset[toCamel(btnAttr)]) : "badge";
      },
      set: (mode) => {
        reflect(mode);
        try {
          cachedStorageSet({ [key]: norm(mode) });
        } catch {}
      },
      // 특정 모드 버튼(예: "badge")만 비활성화한다. 그룹 전체 잠금(is-locked)은
      // 걸지 않아 나머지 버튼은 계속 고를 수 있다.
      setModeDisabled: (modeValue, disabled) => {
        const v = norm(modeValue);
        buttons.forEach((b) => {
          if (norm(b.dataset[toCamel(btnAttr)]) === v) {
            b.disabled = disabled;
            b.classList.toggle("is-disabled", disabled);
          }
        });
      },
    };
  }
  // data-* kebab → dataset camelCase 키 변환.
  function toCamel(kebab) {
    return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  const lpProgressSeg = bindLogPowerModeSeg(
    "[data-logpower-progress-mode]",
    "lp-progress-mode",
    "cheeseLogPowerProgressMode",
    () => reflectEarningColorLink(),
  );
  bindLogPowerModeSeg(
    "[data-logpower-timer-mode]",
    "lp-timer-mode",
    "cheeseLogPowerTimerMode",
  );

  // '적립 중 색 변경'을 켜면 배지 텍스트 색으로 적립 중을 표현하므로, '적립 중 표시
  // 위치'에서 '배지' 옵션만 비활성화한다(끔/툴팁은 계속 고를 수 있다). 현재 '배지'가
  // 선택돼 있으면 '끔'으로 옮긴다(색과 중복 방지). 색 변경을 끄면 '배지' 잠금 해제.
  function reflectEarningColorLink() {
    const colorOn = !!lpEarningColorInput?.checked;
    if (!lpProgressSeg) return;
    if (colorOn && lpProgressSeg.get() === "badge") {
      lpProgressSeg.set("off"); // 배지 → 끔(색으로 대체). 이후 툴팁 선택 가능.
    }
    lpProgressSeg.setModeDisabled("badge", colorOn);
  }
  const lpEarningColorInput = (() => {
    const input = document.querySelector("[data-logpower-earning-color]");
    if (!input) return null;
    (async () => {
      let on = false;
      try {
        const d = await cachedStorageGet("cheeseLogPowerEarningColor");
        on = d?.cheeseLogPowerEarningColor === true;
      } catch {}
      input.checked = on;
      reflectEarningColorLink();
    })();
    input.addEventListener("change", () => {
      try {
        cachedStorageSet({
          cheeseLogPowerEarningColor: input.checked,
        });
      } catch {}
      reflectEarningColorLink();
    });
    return input;
  })();

  // ── 팝업 표시 개수(5~99, 기본 5) ──────────────────────────────────────────
  const LOGPOWER_POPUP_LIMIT_KEY = "cheeseLogPowerPopupLimit";
  const logPowerPopupLimitInput = document.querySelector(
    "[data-logpower-popup-limit]",
  );
  function clampPopupLimit(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 5;
    return Math.min(99, Math.max(5, Math.floor(n)));
  }
  if (logPowerPopupLimitInput) {
    (async () => {
      try {
        const d = await cachedStorageGet(LOGPOWER_POPUP_LIMIT_KEY);
        logPowerPopupLimitInput.value = String(
          clampPopupLimit(d?.[LOGPOWER_POPUP_LIMIT_KEY] ?? 5),
        );
      } catch {
        logPowerPopupLimitInput.value = "5";
      }
    })();
    const savePopupLimit = () => {
      const v = clampPopupLimit(logPowerPopupLimitInput.value);
      logPowerPopupLimitInput.value = String(v);
      try {
        cachedStorageSet({ [LOGPOWER_POPUP_LIMIT_KEY]: v });
      } catch {}
    };
    logPowerPopupLimitInput.addEventListener("change", savePopupLimit);
    logPowerPopupLimitInput.addEventListener("blur", savePopupLimit);
    // 팝업에서 개수를 바꾸면 이 입력도 동기화.
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !changes[LOGPOWER_POPUP_LIMIT_KEY]) return;
      logPowerPopupLimitInput.value = String(
        clampPopupLimit(changes[LOGPOWER_POPUP_LIMIT_KEY].newValue ?? 5),
      );
    });
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[AUDIO_MIXER_PRESETS_KEY]) {
      mixerCustomPresets = Array.isArray(
        changes[AUDIO_MIXER_PRESETS_KEY].newValue,
      )
        ? changes[AUDIO_MIXER_PRESETS_KEY].newValue
        : [];
      syncGlobalDefaultUI("audio");
    }
    if (changes[AUDIO_MIXER_GLOBAL_DEFAULT_KEY]) {
      mixerGlobalDefault = normalizeGlobalDefaultConfig(
        changes[AUDIO_MIXER_GLOBAL_DEFAULT_KEY].newValue,
      );
      syncGlobalDefaultUI("audio");
    }
    if (changes[VIDEO_FILTER_PRESETS_KEY]) {
      videoFilterCustomPresets = Array.isArray(
        changes[VIDEO_FILTER_PRESETS_KEY].newValue,
      )
        ? changes[VIDEO_FILTER_PRESETS_KEY].newValue
        : [];
      syncGlobalDefaultUI("video");
    }
    if (changes[VIDEO_FILTER_GLOBAL_DEFAULT_KEY]) {
      videoFilterGlobalDefault = normalizeGlobalDefaultConfig(
        changes[VIDEO_FILTER_GLOBAL_DEFAULT_KEY].newValue,
      );
      syncGlobalDefaultUI("video");
    }
  });

  // ── 비디오 필터 항상 켜기(전역) ───────────────────────────────────────────
  // 체크=항상 켜기(채널 진입 시 자동 활성화). 채널별로 직접 끄면 그 채널은 유지.
  const VIDEO_FILTER_ALWAYS_ON_KEY = "cheeseVideoFilterAlwaysOn";
  const videoFilterAlwaysOnInput = document.querySelector(
    "[data-video-filter-always-on]",
  );

  async function loadVideoFilterAlwaysOn() {
    let on = false;
    try {
      const data = await cachedStorageGet(
        VIDEO_FILTER_ALWAYS_ON_KEY,
      );
      on = data?.[VIDEO_FILTER_ALWAYS_ON_KEY] === true;
    } catch {}
    if (videoFilterAlwaysOnInput) videoFilterAlwaysOnInput.checked = on;
  }

  videoFilterAlwaysOnInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [VIDEO_FILTER_ALWAYS_ON_KEY]: videoFilterAlwaysOnInput.checked,
      });
    } catch {}
  });
  loadVideoFilterAlwaysOn();

  // ── 넓은 화면 자동 적용(전역, 진입 시 viewmode 자동 켜기) ──────────────────
  const WIDE_SCREEN_AUTO_KEY = "cheeseWideScreenAuto";
  const wideScreenAutoInput = document.querySelector("[data-wide-screen-auto]");
  async function loadWideScreenAuto() {
    let on = false;
    try {
      const data = await cachedStorageGet(WIDE_SCREEN_AUTO_KEY);
      on = data?.[WIDE_SCREEN_AUTO_KEY] === true;
    } catch {}
    if (wideScreenAutoInput) wideScreenAutoInput.checked = on;
  }
  wideScreenAutoInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [WIDE_SCREEN_AUTO_KEY]: wideScreenAutoInput.checked,
      });
    } catch {}
  });
  loadWideScreenAuto();

  // ── 최대 화질 자동 고정(전역, 기본 OFF) ──────────────────────────────────
  const MAX_QUALITY_KEY = "cheeseMaxQuality";
  const maxQualityInput = document.querySelector("[data-max-quality]");
  async function loadMaxQuality() {
    let on = false;
    try {
      const data = await cachedStorageGet(MAX_QUALITY_KEY);
      on = data?.[MAX_QUALITY_KEY] === true;
    } catch {}
    if (maxQualityInput) maxQualityInput.checked = on;
  }
  // 수동 화질 변경 존중(하위, 기본 ON). 위 최대 화질 고정이 꺼져 있으면 비활성화(흐림).
  const MAX_QUALITY_RESPECT_KEY = "cheeseMaxQualityRespectManual";
  const maxQualityRespectInput = document.querySelector(
    "[data-max-quality-respect]",
  );
  function reflectMaxQualityRespectEnabled() {
    const parentOn = !!maxQualityInput?.checked;
    if (!maxQualityRespectInput) return;
    maxQualityRespectInput.disabled = !parentOn;
    maxQualityRespectInput
      .closest(".settings-item")
      ?.classList.toggle("is-locked", !parentOn);
  }
  async function loadMaxQualityRespect() {
    let on = true;
    try {
      const data = await cachedStorageGet(MAX_QUALITY_RESPECT_KEY);
      on = data?.[MAX_QUALITY_RESPECT_KEY] !== false; // 미설정=기본 ON
    } catch {}
    if (maxQualityRespectInput) maxQualityRespectInput.checked = on;
    reflectMaxQualityRespectEnabled();
  }
  maxQualityRespectInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [MAX_QUALITY_RESPECT_KEY]: maxQualityRespectInput.checked,
      });
    } catch {}
  });
  maxQualityInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({ [MAX_QUALITY_KEY]: maxQualityInput.checked });
    } catch {}
    reflectMaxQualityRespectEnabled(); // 부모 변화 시 하위 활성/비활성 갱신
  });
  loadMaxQuality();
  loadMaxQualityRespect();

  // ── 라이브 되감기 바 표시(전역, 기본 ON) ─────────────────────────────────
  const LIVE_SEEK_BAR_KEY = "cheeseLiveSeekBar";
  const liveSeekBarInput = document.querySelector("[data-live-seek-bar]");
  async function loadLiveSeekBar() {
    let on = true; // 미설정=기본 ON
    try {
      const data = await cachedStorageGet(LIVE_SEEK_BAR_KEY);
      on = data?.[LIVE_SEEK_BAR_KEY] !== false;
    } catch {}
    if (liveSeekBarInput) liveSeekBarInput.checked = on;
  }
  liveSeekBarInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [LIVE_SEEK_BAR_KEY]: liveSeekBarInput.checked,
      });
    } catch {}
  });
  loadLiveSeekBar();

  // ── 볼륨/게인 % 표시(전역, 기본 ON) ───────────────────────────────────────
  // 체크=표시. 미설정 시 ON. 각각 독립.
  function bindPctToggle(selector, key) {
    const input = document.querySelector(selector);
    if (!input) return;
    (async () => {
      let on = true;
      try {
        const d = await cachedStorageGet(key);
        on = d?.[key] !== false;
      } catch {}
      input.checked = on;
    })();
    input.addEventListener("change", () => {
      try {
        cachedStorageSet({ [key]: input.checked });
      } catch {}
    });
  }
  bindPctToggle("[data-volume-pct]", "cheeseVolumePct");
  bindPctToggle("[data-gain-pct]", "cheeseGainPct");

  // ── 믹서 버튼 클릭 시 바로 켜기(전역, 기본 OFF) ───────────────────────────
  const mixerClickActivateInput = document.querySelector(
    "[data-mixer-click-activate]",
  );
  if (mixerClickActivateInput) {
    const KEY = "cheeseMixerClickActivate";
    (async () => {
      let on = false; // 기본 OFF
      try {
        const d = await cachedStorageGet(KEY);
        on = d?.[KEY] === true;
      } catch {}
      mixerClickActivateInput.checked = on;
    })();
    mixerClickActivateInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [KEY]: mixerClickActivateInput.checked });
      } catch {}
    });

    // '오디오 믹서 항상 켜기'가 켜져 있으면 믹서는 이미 자동 활성화되므로 '클릭 시
    // 바로 켜기'는 의미가 없다 → 이 토글을 비활성화(잠금)한다.
    function setMixerClickActivateLock(alwaysOn) {
      mixerClickActivateInput.disabled = alwaysOn;
      mixerClickActivateInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", alwaysOn);
    }
    // 항상 켜기 토글을 이 화면에서 바꾸면 즉시 반영.
    mixerAlwaysOnInput?.addEventListener("change", () =>
      setMixerClickActivateLock(!!mixerAlwaysOnInput.checked),
    );
    // 초기값은 storage에서 직접 읽어 확정(load 비동기 완료 타이밍에 의존하지 않게).
    (async () => {
      let alwaysOn = false;
      try {
        const d = await cachedStorageGet(MIXER_ALWAYS_ON_KEY);
        alwaysOn = d?.[MIXER_ALWAYS_ON_KEY] === true;
      } catch {}
      setMixerClickActivateLock(alwaysOn);
    })();

    // 하위: '패널은 열지 않기'. 부모('클릭 시 바로 켜기')가 켜져 있을 때만 의미 있으므로,
    // 부모가 꺼져 있으면 비활성화한다.
    const noPanelInput = document.querySelector("[data-mixer-click-no-panel]");
    if (noPanelInput) {
      const NP_KEY = "cheeseMixerClickNoPanel";
      function reflectNoPanelEnabled() {
        const parentOn =
          !!mixerClickActivateInput.checked &&
          !mixerClickActivateInput.disabled;
        noPanelInput.disabled = !parentOn;
        noPanelInput
          .closest(".settings-item")
          ?.classList.toggle("is-locked", !parentOn);
      }
      (async () => {
        let on = false;
        try {
          const d = await cachedStorageGet(NP_KEY);
          on = d?.[NP_KEY] === true;
        } catch {}
        noPanelInput.checked = on;
        reflectNoPanelEnabled();
      })();
      noPanelInput.addEventListener("change", () => {
        try {
          cachedStorageSet({ [NP_KEY]: noPanelInput.checked });
        } catch {}
      });
      mixerClickActivateInput.addEventListener("change", reflectNoPanelEnabled);
      mixerAlwaysOnInput?.addEventListener("change", reflectNoPanelEnabled);
    }
  }

  // ── 오디오 믹서 초보자용 원클릭(전역, 기본 OFF) ───────────────────────────
  // 켜지면 관련 세부 옵션(바로 켜기·패널 안 열기·전역 기본값·재방문 동작)을 잠근다.
  bindBeginnerOneClick({
    inputSel: "[data-mixer-beginner]",
    key: "cheeseMixerBeginner",
    lockSels: [
      "[data-mixer-click-activate]",
      "[data-mixer-click-no-panel]",
      "[data-mixer-global-default-enabled]",
      "[data-mixer-global-default-mode]",
    ],
    exclusiveSel: "[data-mixer-always-on]",
    exclusiveKey: "cheeseMixerAlwaysOn",
  });

  // ── 필터 버튼 클릭 시 바로 켜기(전역, 기본 OFF) ───────────────────────────
  const vfClickActivateInput = document.querySelector(
    "[data-video-filter-click-activate]",
  );
  if (vfClickActivateInput) {
    const KEY = "cheeseVideoFilterClickActivate";
    (async () => {
      let on = false; // 기본 OFF
      try {
        const d = await cachedStorageGet(KEY);
        on = d?.[KEY] === true;
      } catch {}
      vfClickActivateInput.checked = on;
    })();
    vfClickActivateInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [KEY]: vfClickActivateInput.checked });
      } catch {}
    });

    // '비디오 필터 항상 켜기'가 켜져 있으면 필터는 이미 자동 활성화되므로 '클릭 시
    // 바로 켜기'는 의미가 없다 → 이 토글을 비활성화(잠금)한다.
    function setVfClickActivateLock(alwaysOn) {
      vfClickActivateInput.disabled = alwaysOn;
      vfClickActivateInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", alwaysOn);
    }
    videoFilterAlwaysOnInput?.addEventListener("change", () =>
      setVfClickActivateLock(!!videoFilterAlwaysOnInput.checked),
    );
    (async () => {
      let alwaysOn = false;
      try {
        const d = await cachedStorageGet(VIDEO_FILTER_ALWAYS_ON_KEY);
        alwaysOn = d?.[VIDEO_FILTER_ALWAYS_ON_KEY] === true;
      } catch {}
      setVfClickActivateLock(alwaysOn);
    })();

    // 하위: '패널은 열지 않기'. 부모가 켜져 있을 때만 활성.
    const vfNoPanelInput = document.querySelector(
      "[data-video-filter-click-no-panel]",
    );
    if (vfNoPanelInput) {
      const NP_KEY = "cheeseVideoFilterClickNoPanel";
      function reflectVfNoPanelEnabled() {
        const parentOn =
          !!vfClickActivateInput.checked && !vfClickActivateInput.disabled;
        vfNoPanelInput.disabled = !parentOn;
        vfNoPanelInput
          .closest(".settings-item")
          ?.classList.toggle("is-locked", !parentOn);
      }
      (async () => {
        let on = false;
        try {
          const d = await cachedStorageGet(NP_KEY);
          on = d?.[NP_KEY] === true;
        } catch {}
        vfNoPanelInput.checked = on;
        reflectVfNoPanelEnabled();
      })();
      vfNoPanelInput.addEventListener("change", () => {
        try {
          cachedStorageSet({ [NP_KEY]: vfNoPanelInput.checked });
        } catch {}
      });
      vfClickActivateInput.addEventListener("change", reflectVfNoPanelEnabled);
      videoFilterAlwaysOnInput?.addEventListener(
        "change",
        reflectVfNoPanelEnabled,
      );
    }
  }

  // ── 비디오 필터 초보자용 원클릭(전역, 기본 OFF) ───────────────────────────
  bindBeginnerOneClick({
    inputSel: "[data-video-filter-beginner]",
    key: "cheeseVideoFilterBeginner",
    lockSels: [
      "[data-video-filter-click-activate]",
      "[data-video-filter-click-no-panel]",
      "[data-video-filter-global-default-enabled]",
      "[data-video-filter-global-default-mode]",
    ],
    exclusiveSel: "[data-video-filter-always-on]",
    exclusiveKey: "cheeseVideoFilterAlwaysOn",
  });

  // ── 전역 기본값 재방문 동작(global=전역값 우선 | channel=직접 선택 우선) ─────
  const mixerGlobalDefaultModeGroup = document.querySelector(
    "[data-mixer-global-default-mode]",
  );
  if (mixerGlobalDefaultModeGroup) {
    const MODE_KEY = "cheeseMixerGlobalDefaultMode";
    const modeButtons = Array.from(
      mixerGlobalDefaultModeGroup.querySelectorAll("[data-mode-value]"),
    );
    function reflectMode(mode) {
      const v = mode === "channel" ? "channel" : "global";
      modeButtons.forEach((btn) => {
        const active = btn.dataset.modeValue === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    }
    (async () => {
      let mode = "global"; // 기본: 전역값 우선
      try {
        const d = await cachedStorageGet(MODE_KEY);
        if (d?.[MODE_KEY] === "channel") mode = "channel";
      } catch {}
      reflectMode(mode);
    })();
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.modeValue === "channel" ? "channel" : "global";
        reflectMode(mode);
        try {
          cachedStorageSet({ [MODE_KEY]: mode });
        } catch {}
      });
    });
  }

  // ── 비디오 필터 전역 기본값 재방문 동작(오디오 믹서와 동일, 별도 키) ──────────
  const vfGlobalDefaultModeGroup = document.querySelector(
    "[data-video-filter-global-default-mode]",
  );
  if (vfGlobalDefaultModeGroup) {
    const MODE_KEY = "cheeseVideoFilterGlobalDefaultMode";
    const modeButtons = Array.from(
      vfGlobalDefaultModeGroup.querySelectorAll("[data-vf-mode-value]"),
    );
    function reflectVfMode(mode) {
      const v = mode === "channel" ? "channel" : "global";
      modeButtons.forEach((btn) => {
        const active = btn.dataset.vfModeValue === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    }
    (async () => {
      let mode = "global"; // 기본: 전역값 우선
      try {
        const d = await cachedStorageGet(MODE_KEY);
        if (d?.[MODE_KEY] === "channel") mode = "channel";
      } catch {}
      reflectVfMode(mode);
    })();
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode =
          btn.dataset.vfModeValue === "channel" ? "channel" : "global";
        reflectVfMode(mode);
        try {
          cachedStorageSet({ [MODE_KEY]: mode });
        } catch {}
      });
    });
  }

  // ── 게인 슬라이더 최소/최대(숫자 세그먼티드, 배율값 저장) ─────────────────────
  // group: [data-*] 컨테이너, dataAttr: 버튼의 data-* 키(camelCase), storageKey,
  // allowed: 허용 배율 목록, def: 기본 배율.
  function bindGainRangeSegmented(group, dataAttr, storageKey, allowed, def) {
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll(`[data-${dataAttr}]`));
    const toKey = dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    function reflect(val) {
      const v = allowed.includes(val) ? val : def;
      buttons.forEach((btn) => {
        const active = Number(btn.dataset[toKey]) === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    }
    (async () => {
      let v = def;
      try {
        const d = await cachedStorageGet(storageKey);
        const n = Number(d?.[storageKey]);
        if (allowed.includes(n)) v = n;
      } catch {}
      reflect(v);
    })();
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = Number(btn.dataset[toKey]);
        const val = allowed.includes(v) ? v : def;
        reflect(val);
        try {
          cachedStorageSet({ [storageKey]: val });
        } catch {}
      });
    });
  }
  bindGainRangeSegmented(
    document.querySelector("[data-mixer-gain-min]"),
    "gain-min-value",
    "cheeseMixerGainMin",
    [0.5, 0.25, 0.1, 0],
    0.5,
  );
  bindGainRangeSegmented(
    document.querySelector("[data-mixer-gain-max]"),
    "gain-max-value",
    "cheeseMixerGainMax",
    [2, 3],
    2,
  );

  // 되감기 바는 '라이브 되감기 숨김'과 독립적으로 표시할 수 있다. 되감기 숨김은
  // 되감기/앞으로 '버튼'만 숨기고, 바(드래그·방향키 seek)는 이 토글만 따른다. 그래서
  // 되감기 숨김이 켜져 있어도 이 토글을 잠그지 않는다(예전에는 잠갔던 것을 해제).

  // ── 되감기·앞으로 간격(3~60초, 기본 10) ──────────────────────────────────
  const SEEK_STEP_KEY = "cheeseSeekStepS";
  const seekStepInput = document.querySelector("[data-seek-step]");
  function clampSeekStep(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 10;
    return Math.min(60, Math.max(3, Math.round(n)));
  }
  if (seekStepInput) {
    (async () => {
      try {
        const d = await cachedStorageGet(SEEK_STEP_KEY);
        seekStepInput.value = String(clampSeekStep(d?.[SEEK_STEP_KEY] ?? 10));
      } catch {
        seekStepInput.value = "10";
      }
    })();
    const save = () => {
      const v = clampSeekStep(seekStepInput.value);
      seekStepInput.value = String(v); // 범위 밖 입력 보정
      try {
        cachedStorageSet({ [SEEK_STEP_KEY]: v });
      } catch {}
    };
    seekStepInput.addEventListener("change", save);
    seekStepInput.addEventListener("blur", save);
  }

  // ── 채널 라이브 바로가기 버튼(전역, 기본 ON) ──────────────────────────────
  // 체크=표시. 미설정이면 표시(true)가 기본.
  const CHANNEL_LIVE_BUTTON_KEY = "cheeseChannelLiveButton";
  const channelLiveButtonInput = document.querySelector(
    "[data-channel-live-button]",
  );

  async function loadChannelLiveButton() {
    let on = true;
    try {
      const data = await cachedStorageGet(CHANNEL_LIVE_BUTTON_KEY);
      on = data?.[CHANNEL_LIVE_BUTTON_KEY] !== false; // 미설정/true=표시
    } catch {}
    if (channelLiveButtonInput) channelLiveButtonInput.checked = on;
  }

  channelLiveButtonInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CHANNEL_LIVE_BUTTON_KEY]: channelLiveButtonInput.checked,
      });
    } catch {}
  });
  loadChannelLiveButton();

  // 중간광고 중 미니플레이어(원래 방송) 음소거 해제. 기본 OFF(광고 소리와 겹칠 수 있음).
  const AD_MINI_UNMUTE_KEY = "cheeseAdMiniplayerUnmute";
  const adMiniUnmuteInput = document.querySelector("[data-ad-mini-unmute]");
  async function loadAdMiniUnmute() {
    let on = false;
    try {
      const data = await cachedStorageGet(AD_MINI_UNMUTE_KEY);
      on = data?.[AD_MINI_UNMUTE_KEY] === true; // 미설정=기본 OFF
    } catch {}
    if (adMiniUnmuteInput) adMiniUnmuteInput.checked = on;
  }
  // '원래 음소거였으면 유지' 하위 옵션(기본 ON). 위 음소거 해제가 꺼져 있으면 의미가
  // 없으므로 비활성화(흐림)한다.
  const AD_MINI_KEEP_MUTED_KEY = "cheeseAdMiniplayerKeepMuted";
  const adMiniKeepMutedInput = document.querySelector(
    "[data-ad-mini-keep-muted]",
  );
  function reflectAdMiniKeepMutedEnabled() {
    const parentOn = !!adMiniUnmuteInput?.checked;
    if (!adMiniKeepMutedInput) return;
    adMiniKeepMutedInput.disabled = !parentOn;
    adMiniKeepMutedInput
      .closest(".settings-item")
      ?.classList.toggle("is-locked", !parentOn);
  }
  async function loadAdMiniKeepMuted() {
    let on = true;
    try {
      const data = await cachedStorageGet(AD_MINI_KEEP_MUTED_KEY);
      on = data?.[AD_MINI_KEEP_MUTED_KEY] !== false; // 미설정=기본 ON
    } catch {}
    if (adMiniKeepMutedInput) adMiniKeepMutedInput.checked = on;
    reflectAdMiniKeepMutedEnabled();
  }
  adMiniKeepMutedInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [AD_MINI_KEEP_MUTED_KEY]: adMiniKeepMutedInput.checked,
      });
    } catch {}
  });

  adMiniUnmuteInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [AD_MINI_UNMUTE_KEY]: adMiniUnmuteInput.checked,
      });
    } catch {}
    reflectAdMiniKeepMutedEnabled(); // 부모 토글 변화 시 하위 활성/비활성 갱신
  });
  loadAdMiniUnmute();
  loadAdMiniKeepMuted();

  // 스크린샷 저장 전 미리보기(저장/취소 확인). 기본 OFF(바로 저장).
  const SCREENSHOT_PREVIEW_KEY = "cheeseScreenshotPreview";
  const screenshotPreviewInput = document.querySelector(
    "[data-screenshot-preview]",
  );
  async function loadScreenshotPreview() {
    let on = false;
    try {
      const data = await cachedStorageGet(SCREENSHOT_PREVIEW_KEY);
      on = data?.[SCREENSHOT_PREVIEW_KEY] === true; // 미설정=기본 OFF
    } catch {}
    if (screenshotPreviewInput) screenshotPreviewInput.checked = on;
  }
  screenshotPreviewInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [SCREENSHOT_PREVIEW_KEY]: screenshotPreviewInput.checked,
      });
    } catch {}
  });
  loadScreenshotPreview();

  // 스크린샷 대화상자 없이 바로 저장(saveAs 반대). 기본 ON. 단 Whale은 자체 다운로드
  // 확인창이 있어 이 옵션으로 못 없애므로, Whale이면 토글을 비활성화하고 안내한다.
  const SCREENSHOT_DIRECT_SAVE_KEY = "cheeseScreenshotDirectSave";
  const screenshotDirectInput = document.querySelector(
    "[data-screenshot-direct-save]",
  );
  const isWhale = /Whale/i.test(navigator.userAgent);
  async function loadScreenshotDirectSave() {
    let on = true;
    try {
      const data = await cachedStorageGet(SCREENSHOT_DIRECT_SAVE_KEY);
      on = data?.[SCREENSHOT_DIRECT_SAVE_KEY] !== false; // 미설정=기본 ON
    } catch {}
    if (screenshotDirectInput) screenshotDirectInput.checked = on;
    if (isWhale && screenshotDirectInput) {
      // Whale: 이 옵션으로 브라우저 확인창을 없앨 수 없으므로 비활성화 + 안내.
      screenshotDirectInput.disabled = true;
      screenshotDirectInput.closest(".settings-item")?.classList.add("is-locked");
      const desc = document.querySelector("[data-screenshot-direct-save-desc]");
      if (desc) {
        desc.textContent =
          "웨일(Whale)은 브라우저 자체 다운로드 확인창이 있어 이 옵션으로 끌 수 없습니다. 웨일 설정 > 다운로드에서 변경하세요.";
      }
    }
  }
  screenshotDirectInput?.addEventListener("change", () => {
    if (isWhale) return; // 비활성 상태
    try {
      cachedStorageSet({
        [SCREENSHOT_DIRECT_SAVE_KEY]: screenshotDirectInput.checked,
      });
    } catch {}
  });
  loadScreenshotDirectSave();

  // 라이브 바로가기 버튼 배치(끝/탭 뒤). 기본 ON(끝).
  const CHANNEL_LIVE_BUTTON_END_KEY = "cheeseChannelLiveButtonEnd";
  const channelLiveButtonEndInput = document.querySelector(
    "[data-channel-live-button-end]",
  );

  async function loadChannelLiveButtonEnd() {
    let on = true;
    try {
      const data = await cachedStorageGet(
        CHANNEL_LIVE_BUTTON_END_KEY,
      );
      on = data?.[CHANNEL_LIVE_BUTTON_END_KEY] !== false; // 미설정/true=끝
    } catch {}
    if (channelLiveButtonEndInput) channelLiveButtonEndInput.checked = on;
  }

  channelLiveButtonEndInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CHANNEL_LIVE_BUTTON_END_KEY]: channelLiveButtonEndInput.checked,
      });
    } catch {}
  });
  loadChannelLiveButtonEnd();

  // ── 팔로잉 라이브 미리보기(전역, 기본 ON) ─────────────────────────────────
  const FOLLOW_PREVIEW_KEY = "cheeseFollowPreview";
  const followPreviewInput = document.querySelector("[data-follow-preview]");

  async function loadFollowPreview() {
    let on = true;
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_KEY);
      on = data?.[FOLLOW_PREVIEW_KEY] !== false; // 미설정/true=표시
    } catch {}
    if (followPreviewInput) followPreviewInput.checked = on;
  }

  followPreviewInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_KEY]: followPreviewInput.checked,
      });
    } catch {}
  });
  loadFollowPreview();

  // ── 미리보기 음소거 고정(체크=항상 음소거, 해제=항상 소리 켬) ───────────────
  const FOLLOW_PREVIEW_MUTED_KEY = "cheeseFollowPreviewMuted";
  const followPreviewMutedInput = document.querySelector(
    "[data-follow-preview-muted]",
  );
  async function loadFollowPreviewMuted() {
    let muted = true; // 기본 음소거
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_MUTED_KEY);
      muted = data?.[FOLLOW_PREVIEW_MUTED_KEY] !== false;
    } catch {}
    if (followPreviewMutedInput) followPreviewMutedInput.checked = muted;
  }
  followPreviewMutedInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_MUTED_KEY]: followPreviewMutedInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewMuted();

  // ── 미리보기 볼륨(0~100%, 저장은 0~1 배율) — 슬라이더 ↔ 숫자 입력 동기화 ─────
  const FOLLOW_PREVIEW_VOLUME_KEY = "cheeseFollowPreviewVolume";
  const followVolumeSlider = document.querySelector(
    "[data-follow-preview-volume-slider]",
  );
  const followVolumeInput = document.querySelector(
    "[data-follow-preview-volume]",
  );
  function clampFollowVolumePct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 100;
    return Math.min(100, Math.max(0, Math.round(n)));
  }
  if (followVolumeSlider || followVolumeInput) {
    const reflect = (pct) => {
      const v = clampFollowVolumePct(pct);
      if (followVolumeSlider) followVolumeSlider.value = String(v);
      if (followVolumeInput) followVolumeInput.value = String(v);
    };
    (async () => {
      let pct = 100;
      try {
        const d = await cachedStorageGet(FOLLOW_PREVIEW_VOLUME_KEY);
        const scale = Number(d?.[FOLLOW_PREVIEW_VOLUME_KEY]);
        pct = Number.isFinite(scale) ? scale * 100 : 100;
      } catch {}
      reflect(pct);
    })();
    const save = (pct) => {
      const v = clampFollowVolumePct(pct);
      reflect(v);
      try {
        cachedStorageSet({ [FOLLOW_PREVIEW_VOLUME_KEY]: v / 100 });
      } catch {}
    };
    // 슬라이더는 드래그 중(input) 실시간 반영, 숫자는 change/blur 시 저장.
    followVolumeSlider?.addEventListener("input", () =>
      save(followVolumeSlider.value),
    );
    followVolumeInput?.addEventListener("change", () =>
      save(followVolumeInput.value),
    );
    followVolumeInput?.addEventListener("blur", () =>
      save(followVolumeInput.value),
    );
  }

  // ── 미리보기 썸네일로만 보기(체크=영상 대신 썸네일 이미지) ─────────────────
  const FOLLOW_PREVIEW_THUMB_KEY = "cheeseFollowPreviewThumbOnly";
  const followPreviewThumbInput = document.querySelector(
    "[data-follow-preview-thumb]",
  );
  async function loadFollowPreviewThumb() {
    let on = false; // 기본 영상
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_THUMB_KEY);
      on = data?.[FOLLOW_PREVIEW_THUMB_KEY] === true;
    } catch {}
    if (followPreviewThumbInput) followPreviewThumbInput.checked = on;
  }
  followPreviewThumbInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_THUMB_KEY]: followPreviewThumbInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewThumb();

  // ── 미리보기 라이브 최신 재생(엣지, 기본 ON) ───────────────────────────────
  const FOLLOW_PREVIEW_LIVE_EDGE_KEY = "cheeseFollowPreviewLiveEdge";
  const followPreviewLiveEdgeInput = document.querySelector(
    "[data-follow-preview-live-edge]",
  );
  async function loadFollowPreviewLiveEdge() {
    let on = true; // 기본 최신 재생
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_LIVE_EDGE_KEY);
      on = data?.[FOLLOW_PREVIEW_LIVE_EDGE_KEY] !== false; // 미설정/true=ON
    } catch {}
    if (followPreviewLiveEdgeInput) followPreviewLiveEdgeInput.checked = on;
  }
  followPreviewLiveEdgeInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_LIVE_EDGE_KEY]: followPreviewLiveEdgeInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewLiveEdge();

  // ── 미리보기 제목 전체 표시(줄바꿈, 기본 OFF) ──────────────────────────────
  const FOLLOW_PREVIEW_FULL_TITLE_KEY = "cheeseFollowPreviewFullTitle";
  const followPreviewFullTitleInput = document.querySelector(
    "[data-follow-preview-full-title]",
  );
  async function loadFollowPreviewFullTitle() {
    let on = false; // 기본 자름
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_FULL_TITLE_KEY);
      on = data?.[FOLLOW_PREVIEW_FULL_TITLE_KEY] === true;
    } catch {}
    if (followPreviewFullTitleInput) followPreviewFullTitleInput.checked = on;
  }
  followPreviewFullTitleInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_FULL_TITLE_KEY]: followPreviewFullTitleInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewFullTitle();

  // ── 미리보기 헤더 폰트 크기(입력 75~175%, 저장 배율 0.75~1.75) ──────────────
  const FOLLOW_PREVIEW_HEADER_FONT_KEY = "cheeseFollowPreviewHeaderFont";
  const followHeaderFontInput = document.querySelector(
    "[data-follow-header-font]",
  );
  function clampHeaderFontPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 100;
    return Math.min(175, Math.max(75, Math.round(n / 5) * 5));
  }
  if (followHeaderFontInput) {
    (async () => {
      try {
        const d = await cachedStorageGet(FOLLOW_PREVIEW_HEADER_FONT_KEY);
        const scale = Number(d?.[FOLLOW_PREVIEW_HEADER_FONT_KEY]);
        const pct = Number.isFinite(scale) && scale > 0 ? scale * 100 : 100;
        followHeaderFontInput.value = String(clampHeaderFontPct(pct));
      } catch {
        followHeaderFontInput.value = "100";
      }
    })();
    const saveHeaderFont = () => {
      const pct = clampHeaderFontPct(followHeaderFontInput.value);
      followHeaderFontInput.value = String(pct);
      try {
        cachedStorageSet({
          [FOLLOW_PREVIEW_HEADER_FONT_KEY]: pct / 100,
        });
      } catch {}
    };
    followHeaderFontInput.addEventListener("change", saveHeaderFont);
    followHeaderFontInput.addEventListener("blur", saveHeaderFont);
  }

  // ── 미리보기 자동 종료 시간(30/60/120/180/300초, 상한 5분) ─────────────────
  const FOLLOW_PREVIEW_MAXLIFE_KEY = "cheeseFollowPreviewMaxLifeSec";
  const FOLLOW_PREVIEW_MAXLIFE_ALLOWED = [30, 60, 120, 180, 300];
  const FOLLOW_PREVIEW_MAXLIFE_DEFAULT = 120;
  // 3분 이상은 '장시간 시청' 소지가 있어 고지(차단은 안 함).
  const FOLLOW_PREVIEW_MAXLIFE_NOTICE_AT = 180;
  const maxLifeButtons = Array.from(
    document.querySelectorAll("[data-follow-maxlife]"),
  );
  const maxLifeGroup = document.getElementById("followPreviewMaxLife");

  function showMaxLifeNotice(sec) {
    let el = document.getElementById("followPreviewMaxLifeNotice");
    if (sec < FOLLOW_PREVIEW_MAXLIFE_NOTICE_AT) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("p");
      el.id = "followPreviewMaxLifeNotice";
      el.className = "settings-notice";
      maxLifeGroup?.insertAdjacentElement("afterend", el);
    }
    const min = Math.round(sec / 60);
    el.textContent = `미리보기는 짧은 확인용입니다. ${min}분처럼 길게 두면 본방 시청 대체가 될 수 있으니 오래 보려면 라이브 채널을 이용해 주세요.`;
  }

  function reflectMaxLife(sec) {
    const v = FOLLOW_PREVIEW_MAXLIFE_ALLOWED.includes(Number(sec))
      ? Number(sec)
      : FOLLOW_PREVIEW_MAXLIFE_DEFAULT;
    maxLifeButtons.forEach((btn) => {
      const active = Number(btn.dataset.followMaxlife) === v;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    showMaxLifeNotice(v);
  }

  async function loadMaxLife() {
    let sec = FOLLOW_PREVIEW_MAXLIFE_DEFAULT;
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_MAXLIFE_KEY);
      const v = Number(data?.[FOLLOW_PREVIEW_MAXLIFE_KEY]);
      if (FOLLOW_PREVIEW_MAXLIFE_ALLOWED.includes(v)) sec = v;
    } catch {}
    reflectMaxLife(sec);
  }

  maxLifeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = Number(btn.dataset.followMaxlife);
      reflectMaxLife(sec);
      try {
        cachedStorageSet({ [FOLLOW_PREVIEW_MAXLIFE_KEY]: sec });
      } catch {}
    });
  });
  loadMaxLife();

  // ── 카드 미리보기 음량(라이브 탐색 카드 호버 video, 전역 기본 ON) ──────────
  // 카드 호버 플레이어 미리보기(팔로잉 미리보기 인프라 재사용, 기본 OFF).
  const CARD_LIVE_PREVIEW_KEY = "cheeseCardLivePreview";
  const cardLivePreviewInput = document.querySelector(
    "[data-card-live-preview]",
  );
  async function loadCardLivePreview() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(CARD_LIVE_PREVIEW_KEY);
      on = data?.[CARD_LIVE_PREVIEW_KEY] === true;
    } catch {}
    if (cardLivePreviewInput) cardLivePreviewInput.checked = on;
  }
  cardLivePreviewInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CARD_LIVE_PREVIEW_KEY]: cardLivePreviewInput.checked,
      });
    } catch {}
  });
  loadCardLivePreview();

  // 팔로잉 채널 호버 정보 툴팁(기본 OFF).
  const FOLLOW_CHANNEL_TOOLTIP_KEY = "cheeseFollowChannelTooltip";
  const followChannelTooltipInput = document.querySelector(
    "[data-follow-channel-tooltip]",
  );
  async function loadFollowChannelTooltip() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(FOLLOW_CHANNEL_TOOLTIP_KEY);
      on = data?.[FOLLOW_CHANNEL_TOOLTIP_KEY] === true;
    } catch {}
    if (followChannelTooltipInput) followChannelTooltipInput.checked = on;
  }
  followChannelTooltipInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_CHANNEL_TOOLTIP_KEY]: followChannelTooltipInput.checked,
      });
    } catch {}
  });
  loadFollowChannelTooltip();

  // 팔로잉 정리 버튼(기본 ON).
  const FOLLOW_CLEANUP_KEY = "cheeseFollowCleanup";
  const followCleanupInput = document.querySelector("[data-follow-cleanup]");
  async function loadFollowCleanup() {
    let on = true; // 미설정/true=ON
    try {
      const data = await cachedStorageGet(FOLLOW_CLEANUP_KEY);
      on = data?.[FOLLOW_CLEANUP_KEY] !== false;
    } catch {}
    if (followCleanupInput) followCleanupInput.checked = on;
  }
  followCleanupInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({ [FOLLOW_CLEANUP_KEY]: followCleanupInput.checked });
    } catch {}
  });
  loadFollowCleanup();

  // 채팅창 접힘 상태 유지(기본 OFF).
  const CHAT_FOLD_PERSIST_KEY = "cheeseChatFoldPersist";
  const chatFoldPersistInput = document.querySelector(
    "[data-chat-fold-persist]",
  );
  async function loadChatFoldPersist() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(CHAT_FOLD_PERSIST_KEY);
      on = data?.[CHAT_FOLD_PERSIST_KEY] === true;
    } catch {}
    if (chatFoldPersistInput) chatFoldPersistInput.checked = on;
  }
  chatFoldPersistInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CHAT_FOLD_PERSIST_KEY]: chatFoldPersistInput.checked,
      });
    } catch {}
  });
  loadChatFoldPersist();

  const CARD_PREVIEW_AUDIO_KEY = "cheeseCardPreviewAudio";
  const cardPreviewAudioInput = document.querySelector(
    "[data-card-preview-audio]",
  );

  async function loadCardPreviewAudio() {
    let on = true;
    try {
      const data = await cachedStorageGet(CARD_PREVIEW_AUDIO_KEY);
      on = data?.[CARD_PREVIEW_AUDIO_KEY] !== false; // 미설정/true=표시
    } catch {}
    if (cardPreviewAudioInput) cardPreviewAudioInput.checked = on;
  }

  // 휠 음량 활성 지연(초). 부모(카드 미리보기 음량)가 꺼져 있으면 비활성화.
  const CARD_PREVIEW_WHEEL_DELAY_KEY = "cheeseCardPreviewWheelDelaySec";
  const cardWheelDelayInput = document.querySelector(
    "[data-card-preview-wheel-delay]",
  );
  function clampCardWheelDelay(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.min(5, Math.max(0, Math.round(n * 2) / 2)); // 0~5, 0.5 단위
  }
  function reflectCardWheelDelayEnabled() {
    const parentOn = !!cardPreviewAudioInput?.checked;
    if (!cardWheelDelayInput) return;
    cardWheelDelayInput.disabled = !parentOn;
    cardWheelDelayInput
      .closest(".settings-item")
      ?.classList.toggle("is-locked", !parentOn);
  }
  async function loadCardWheelDelay() {
    let v = 1;
    try {
      const d = await cachedStorageGet(CARD_PREVIEW_WHEEL_DELAY_KEY);
      v = clampCardWheelDelay(d?.[CARD_PREVIEW_WHEEL_DELAY_KEY] ?? 1);
    } catch {}
    if (cardWheelDelayInput) cardWheelDelayInput.value = String(v);
    reflectCardWheelDelayEnabled();
  }
  if (cardWheelDelayInput) {
    const saveDelay = () => {
      const v = clampCardWheelDelay(cardWheelDelayInput.value);
      cardWheelDelayInput.value = String(v);
      try {
        cachedStorageSet({ [CARD_PREVIEW_WHEEL_DELAY_KEY]: v });
      } catch {}
    };
    cardWheelDelayInput.addEventListener("change", saveDelay);
    cardWheelDelayInput.addEventListener("blur", saveDelay);
  }

  cardPreviewAudioInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CARD_PREVIEW_AUDIO_KEY]: cardPreviewAudioInput.checked,
      });
    } catch {}
    reflectCardWheelDelayEnabled();
  });
  loadCardPreviewAudio();
  loadCardWheelDelay();

  // ── 다시보기 카드 날짜 툴팁(채널 다시보기 목록 카드 호버, 전역 기본 ON) ──────
  const CARD_DATE_TOOLTIP_KEY = "cheeseCardDateTooltip";
  const cardDateTooltipInput = document.querySelector(
    "[data-card-date-tooltip]",
  );

  async function loadCardDateTooltip() {
    let on = true;
    try {
      const data = await cachedStorageGet(CARD_DATE_TOOLTIP_KEY);
      on = data?.[CARD_DATE_TOOLTIP_KEY] !== false; // 미설정/true=사용
    } catch {}
    if (cardDateTooltipInput) cardDateTooltipInput.checked = on;
  }

  cardDateTooltipInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CARD_DATE_TOOLTIP_KEY]: cardDateTooltipInput.checked,
      });
    } catch {}
  });
  loadCardDateTooltip();

  // ── 구독 배지 다음 등급까지 남은 기간(구독권 관리 팝업, 전역 기본 ON) ────────
  const SUBSCRIBE_BADGE_PROGRESS_KEY = "cheeseSubscribeBadgeProgress";
  const subscribeBadgeInput = document.querySelector(
    "[data-subscribe-badge-progress]",
  );

  async function loadSubscribeBadgeProgress() {
    let on = true;
    try {
      const data = await cachedStorageGet(SUBSCRIBE_BADGE_PROGRESS_KEY);
      on = data?.[SUBSCRIBE_BADGE_PROGRESS_KEY] !== false; // 미설정/true=사용
    } catch {}
    if (subscribeBadgeInput) subscribeBadgeInput.checked = on;
  }

  subscribeBadgeInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [SUBSCRIBE_BADGE_PROGRESS_KEY]: subscribeBadgeInput.checked,
      });
    } catch {}
  });
  loadSubscribeBadgeProgress();

  // ── 오류 시 자동 새로고침(리방/네트워크·미디어 오류, 기본 OFF) ─────────────
  const AUTO_RELOAD_ON_ERROR_KEY = "cheeseAutoReloadOnError";
  const autoReloadInput = document.querySelector("[data-auto-reload-on-error]");
  async function loadAutoReloadOnError() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(AUTO_RELOAD_ON_ERROR_KEY);
      on = data?.[AUTO_RELOAD_ON_ERROR_KEY] === true; // 미설정=꺼짐
    } catch {}
    if (autoReloadInput) autoReloadInput.checked = on;
  }
  autoReloadInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [AUTO_RELOAD_ON_ERROR_KEY]: autoReloadInput.checked,
      });
    } catch {}
  });
  loadAutoReloadOnError();

  // ── 플레이어 하단 버튼 좌/우 배치(버튼별 left|right, 기본 right) ────────────
  // ── 플레이어 하단 버튼 순서·위치(좌/우 그룹 + 드래그 순서) ──────────────────
  const PLAYER_BUTTON_SIDE_KEY = "cheesePlayerButtonSide";
  // 배열 순서 = 기본(초기화) 순서: 되감기·따라잡기·앞으로·탭음소거·스크린샷·스트림정보.
  const PLAYER_BTN_KEYS = [
    "rewind",
    "sync",
    "forward",
    "tabMute",
    "screenshot",
    "streamStats",
  ];
  const PLAYER_BTN_LABELS = {
    streamStats: "스트림 정보",
    tabMute: "탭 음소거",
    screenshot: "스크린샷",
    rewind: "되감기",
    forward: "앞으로",
    sync: "실시간 따라잡기",
  };
  // 네이티브(이동 불가) 칩: [클래스, 라벨, noAnchor?]. 우리 버튼을 이 칩들 사이로 끼운다.
  // 믹서/필터는 우리 버튼이지만 볼륨 래핑·좌측 고정이라 이동 불가 칩으로만 노출.
  // 오디오 믹서는 noAnchor=true → 표시만 하고 그 뒤로는 드롭 불가(믹서·필터 사이 배치 금지).
  const PLAYER_BTN_NATIVE = {
    left: [
      ["pzp-playback-switch", "재생"],
      ["pzp-pc__volume-control", "볼륨"],
      ["cheese-audio-mixer-control", "오디오 믹서", true],
      ["cheese-video-filter-control", "비디오 필터"],
      ["live_time", "실시간"],
    ],
    right: [
      ["custom__shop-button", "샵"],
      ["custom__clip-button", "클립"],
      ["pzp-pip-button", "PIP"],
      ["pzp-setting-button", "설정"],
      ["pzp-viewmode-button", "넓은 화면"],
      ["pzp-pc__fullscreen-button", "전체 화면"],
    ],
  };
  const buttonOrderRoot = document.querySelector("[data-player-button-order]");
  if (buttonOrderRoot) {
    const listLeft = buttonOrderRoot.querySelector('[data-order-list="left"]');
    const listRight = buttonOrderRoot.querySelector('[data-order-list="right"]');
    // order: { left:[key...], right:[key...] } — 5 key 를 좌/우로 분배 + 상대순서.
    // slot: { key:{grp,after} } — 각 우리 버튼이 붙는 네이티브 앵커.
    let order = { left: [], right: [...PLAYER_BTN_KEYS] }; // 기본 전부 오른쪽
    let slot = {};
    for (const k of PLAYER_BTN_KEYS) slot[k] = { grp: "right", after: "START" };

    // 그룹의 '앵커로 쓸 수 있는' 네이티브 클래스 화이트리스트(noAnchor 칩 제외).
    function nativeClasses(grp) {
      return PLAYER_BTN_NATIVE[grp].filter((n) => !n[2]).map((n) => n[0]);
    }

    // 구형 seek(되감기+앞으로 통합) key 를 rewind/forward 로 확장.
    function migrateSeek(v) {
      if (!v || typeof v !== "object") return v;
      const out = { ...v };
      const clone = (obj, dup) => {
        const o = { ...obj };
        if (o.seek !== undefined) {
          if (o.rewind === undefined) o.rewind = dup(o.seek);
          if (o.forward === undefined) o.forward = dup(o.seek);
          delete o.seek;
        }
        return o;
      };
      const srcSide = v.side && typeof v.side === "object" ? v.side : null;
      out.side = srcSide ? clone(srcSide, (x) => x) : clone(v, (x) => x);
      if (v.slot && typeof v.slot === "object")
        out.slot = clone(v.slot, (x) =>
          x && typeof x === "object" ? { ...x } : x,
        );
      if (v.order && typeof v.order === "object") {
        const ord = {};
        for (const grp of ["left", "right"]) {
          const arr = Array.isArray(v.order[grp]) ? v.order[grp] : [];
          ord[grp] = arr.flatMap((k) =>
            k === "seek" ? ["rewind", "forward"] : [k],
          );
        }
        out.order = ord;
      }
      return out;
    }

    // 저장값(확장 {side,order,slot} 또는 구형 side-only)을 order/slot 으로 정규화.
    function toState(savedRaw) {
      const saved = migrateSeek(savedRaw);
      const side = {};
      for (const k of PLAYER_BTN_KEYS) side[k] = "right";
      const srcSide =
        saved && typeof saved === "object"
          ? saved.side && typeof saved.side === "object"
            ? saved.side
            : saved
          : null;
      if (srcSide) {
        for (const k of PLAYER_BTN_KEYS) {
          if (srcSide[k] === "left" || srcSide[k] === "right")
            side[k] = srcSide[k];
        }
      }
      const savedOrder =
        saved && typeof saved === "object" ? saved.order : null;
      const outOrder = { left: [], right: [] };
      for (const grp of ["left", "right"]) {
        const wanted = PLAYER_BTN_KEYS.filter((k) => side[k] === grp);
        const arr =
          savedOrder && Array.isArray(savedOrder[grp]) ? savedOrder[grp] : [];
        const seen = new Set();
        for (const k of arr) {
          if (wanted.includes(k) && !seen.has(k)) {
            outOrder[grp].push(k);
            seen.add(k);
          }
        }
        for (const k of wanted) if (!seen.has(k)) outOrder[grp].push(k);
      }
      // slot: 저장값 우선, 없거나 앵커가 그룹 허용 밖이면 기본(우측=샵 뒤, 좌측=START).
      const savedSlot =
        saved && typeof saved === "object" ? saved.slot : null;
      const outSlot = {};
      for (const k of PLAYER_BTN_KEYS) {
        const grp = side[k] === "left" ? "left" : "right";
        let after = grp === "right" ? "custom__shop-button" : "START";
        const sv =
          savedSlot && typeof savedSlot === "object" ? savedSlot[k] : null;
        if (sv && typeof sv === "object" && typeof sv.after === "string") {
          if (sv.after === "START" || nativeClasses(grp).includes(sv.after))
            after = sv.after;
        }
        if (after !== "START" && !nativeClasses(grp).includes(after))
          after = "START";
        outSlot[k] = { grp, after };
      }
      return { order: outOrder, slot: outSlot };
    }

    function makeItem(key) {
      const li = document.createElement("li");
      li.className = "settings-order-item";
      li.draggable = true;
      li.dataset.btnKey = key;
      li.innerHTML =
        `<span class="settings-order-grip" aria-hidden="true">⠿</span>` +
        `<span class="settings-order-label">${PLAYER_BTN_LABELS[key]}</span>`;
      return li;
    }

    // 네이티브 고정 칩(이동 불가). noAnchor 면 표시만 하고 앵커로 쓰지 않는다
    // (data-native-anchor 미부여 → saveFromDom 이 앵커로 인식하지 않음).
    function makeNativeChip(cls, label, noAnchor) {
      const li = document.createElement("li");
      li.className = "settings-order-item settings-order-native";
      li.draggable = false;
      if (noAnchor) li.dataset.nativeNoanchor = cls;
      else li.dataset.nativeAnchor = cls;
      li.setAttribute("aria-disabled", "true");
      li.innerHTML = `<span class="settings-order-label">${label}</span>`;
      return li;
    }

    // 목록 구성: START 위치의 우리 버튼 → [네이티브 칩 → 그 칩 뒤의 우리 버튼]* 순서.
    // noAnchor 칩(믹서) 뒤엔 우리 버튼을 배치하지 않는다(그런 slot 은 정규화에서 배제됨).
    function renderList(ul, grp) {
      ul.innerHTML = "";
      const appendKeysAfter = (anchor) => {
        for (const k of order[grp]) {
          if (slot[k] && slot[k].after === anchor) ul.appendChild(makeItem(k));
        }
      };
      appendKeysAfter("START"); // START 앵커(그룹 맨 앞)에 붙은 우리 버튼
      for (const [cls, label, noAnchor] of PLAYER_BTN_NATIVE[grp]) {
        ul.appendChild(makeNativeChip(cls, label, noAnchor));
        if (!noAnchor) appendKeysAfter(cls);
      }
    }

    function render() {
      renderList(listLeft, "left");
      renderList(listRight, "right");
    }

    // 현재 DOM 순서를 읽어 order/slot 으로 반영 후 저장. 각 우리 버튼의 앵커 =
    // 그 위(앞)에 마지막으로 등장한 네이티브 칩(없으면 START). side 는 그룹에서 유도.
    function saveFromDom() {
      const side = {};
      const newOrder = { left: [], right: [] };
      const newSlot = {};
      for (const grp of ["left", "right"]) {
        const ul = grp === "left" ? listLeft : listRight;
        let lastAnchor = "START";
        for (const li of Array.from(ul.children)) {
          if (li.dataset.nativeAnchor) {
            lastAnchor = li.dataset.nativeAnchor;
            continue;
          }
          const key = li.dataset.btnKey;
          if (!key || !PLAYER_BTN_KEYS.includes(key)) continue;
          newOrder[grp].push(key);
          side[key] = grp;
          newSlot[key] = { grp, after: lastAnchor };
        }
      }
      // 누락 방지(이론상 없음): 5 key 를 모두 채운다.
      for (const k of PLAYER_BTN_KEYS) {
        if (!side[k]) {
          side[k] = "right";
          newOrder.right.push(k);
          newSlot[k] = { grp: "right", after: "START" };
        }
      }
      order = newOrder;
      slot = newSlot;
      try {
        cachedStorageSet({
          [PLAYER_BUTTON_SIDE_KEY]: { side, order, slot },
        });
      } catch {}
    }

    // ── HTML5 드래그: 목록 내 재정렬 + 좌↔우 이동 ──
    let dragEl = null;
    buttonOrderRoot.addEventListener("dragstart", (e) => {
      const li = e.target.closest?.(".settings-order-item");
      // 네이티브 고정 칩은 드래그 불가(우리 버튼만 이동).
      if (!li || li.dataset.nativeAnchor) {
        e.preventDefault?.();
        return;
      }
      dragEl = li;
      li.classList.add("is-dragging");
      try {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", li.dataset.btnKey);
      } catch {}
    });
    buttonOrderRoot.addEventListener("dragend", () => {
      dragEl?.classList.remove("is-dragging");
      dragEl = null;
      buttonOrderRoot
        .querySelectorAll(".is-drop-over")
        .forEach((el) => el.classList.remove("is-drop-over"));
    });
    // 드롭 지점(항목 위/아래 또는 빈 목록) 계산해 미리 삽입 위치를 잡는다.
    // 오디오 믹서·비디오 필터는 '한 묶음'이라 그 사이에는 놓을 수 없다: 삽입 후보가
    // 묶음 사이(=필터 칩 앞)면 묶음 앞(믹서 칩 앞)으로 스냅한다.
    function dragOverList(ul, e) {
      e.preventDefault();
      if (!dragEl) return;
      let after = getDragAfterElement(ul, e.clientY);
      after = snapPastMixerFilter(ul, after);
      if (after == null) ul.appendChild(dragEl);
      else ul.insertBefore(dragEl, after);
    }
    // 삽입 후보 anchor 가 '비디오 필터 칩 바로 앞'(=믹서·필터 사이)이면, 그 묶음 앞
    // (오디오 믹서 칩)으로 당겨 사이 삽입을 막는다. dragEl 자신은 건너뛰고 판정.
    function snapPastMixerFilter(ul, after) {
      if (!after || !after.dataset) return after;
      if (after.dataset.nativeAnchor !== "cheese-video-filter-control")
        return after;
      // 필터 칩의 직전 형제(드래그 중인 dragEl 은 건너뜀)가 믹서 칩이면 사이로 판정.
      let prev = after.previousElementSibling;
      if (prev === dragEl) prev = prev.previousElementSibling;
      const prevIsMixer =
        prev &&
        prev.dataset &&
        prev.dataset.nativeNoanchor === "cheese-audio-mixer-control";
      // 믹서 칩 앞으로 스냅(dragEl 이 믹서와 필터 사이면 믹서 앞으로 이동).
      return prevIsMixer ? prev : after;
    }
    function getDragAfterElement(ul, y) {
      const items = [
        ...ul.querySelectorAll(".settings-order-item:not(.is-dragging)"),
      ];
      let closest = { offset: -Infinity, el: null };
      for (const child of items) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset)
          closest = { offset, el: child };
      }
      return closest.el;
    }
    [listLeft, listRight].forEach((ul) => {
      ul.addEventListener("dragover", (e) => dragOverList(ul, e));
      ul.addEventListener("drop", (e) => {
        e.preventDefault();
        saveFromDom();
      });
    });

    // 위치 초기화: 기본값(전부 오른쪽·샵 뒤)으로 되돌리고 저장·재렌더.
    const resetBtn = buttonOrderRoot.parentElement?.querySelector(
      "[data-player-button-reset]",
    );
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const st = toState(null); // 기본 order/slot
        order = st.order;
        slot = st.slot;
        const side = {};
        for (const k of PLAYER_BTN_KEYS)
          side[k] = slot[k] && slot[k].grp === "left" ? "left" : "right";
        try {
          cachedStorageSet({ [PLAYER_BUTTON_SIDE_KEY]: { side, order, slot } });
        } catch {}
        render();
      });
    }

    // 초기 로드.
    (async () => {
      try {
        const d = await cachedStorageGet(PLAYER_BUTTON_SIDE_KEY);
        const st = toState(d?.[PLAYER_BUTTON_SIDE_KEY]);
        order = st.order;
        slot = st.slot;
      } catch {}
      render();
    })();
  }

  // ── 카페 클립 인라인 재생(네이버 카페, 기본 ON) ───────────────────────────
  const CAFE_NOW_KEY = "cheeseCafeNow";
  const cafeNowInput = document.querySelector("[data-cafe-now]");
  if (cafeNowInput) {
    (async () => {
      let on = true; // 기본 ON
      try {
        const d = await cachedStorageGet(CAFE_NOW_KEY);
        on = d?.[CAFE_NOW_KEY] !== false; // 미설정/true=사용
      } catch {}
      cafeNowInput.checked = on;
    })();
    cafeNowInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [CAFE_NOW_KEY]: cafeNowInput.checked });
      } catch {}
    });
  }

  // ── 통나무 파워 지우개(game.naver.com 통나무파워 관리, 기본 ON) ───────────────
  const LOG_ERASER_KEY = "cheeseLogPowerEraser";
  const logEraserInput = document.querySelector("[data-log-eraser]");
  if (logEraserInput) {
    (async () => {
      let on = true; // 기본 ON
      try {
        const d = await cachedStorageGet(LOG_ERASER_KEY);
        on = d?.[LOG_ERASER_KEY] !== false; // 미설정/true=사용
      } catch {}
      logEraserInput.checked = on;
    })();
    logEraserInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [LOG_ERASER_KEY]: logEraserInput.checked });
      } catch {}
    });
  }

  // ── 다시보기 자동 재생 사용 설정 끄기(체크=끄기, 기본 OFF) ──────────────────
  const VOD_AUTOPLAY_OFF_KEY = "cheeseVodAutoplayOff";
  const vodAutoplayOffInput = document.querySelector("[data-vod-autoplay-off]");
  if (vodAutoplayOffInput) {
    (async () => {
      let on = false; // 기본 OFF
      try {
        const d = await cachedStorageGet(VOD_AUTOPLAY_OFF_KEY);
        on = d?.[VOD_AUTOPLAY_OFF_KEY] === true;
      } catch {}
      vodAutoplayOffInput.checked = on;
    })();
    vodAutoplayOffInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [VOD_AUTOPLAY_OFF_KEY]: vodAutoplayOffInput.checked,
        });
      } catch {}
    });
  }

  // ── 실시간 따라잡기 민감도 프리셋(low/normal/high/custom) ──────────────────
  const SYNC_PRESET_KEY = "cheeseSyncPreset";
  const SYNC_CUSTOM_KEY = "cheeseSyncCustom"; // {enable, target}
  const SYNC_CUSTOM_DEFAULT = { enable: 3, target: 2 };
  const syncButtons = Array.from(
    document.querySelectorAll("[data-sync-preset]"),
  );
  const syncCustomRow = document.getElementById("syncCustomRow");
  const syncCustomEnable = document.getElementById("syncCustomEnable");
  const syncCustomTarget = document.getElementById("syncCustomTarget");

  const clamp = (n, min, max, fallback) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  };

  function reflectSyncPreset(value) {
    const preset =
      value === "low" ||
      value === "normal" ||
      value === "high" ||
      value === "custom"
        ? value
        : "normal";
    syncButtons.forEach((btn) => {
      const active = btn.dataset.syncPreset === preset;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    if (syncCustomRow) syncCustomRow.hidden = preset !== "custom";
  }

  // 커스텀 입력값을 정규화(목표 1~10, 시작 2~30, 시작 > 목표)하고 저장.
  function saveSyncCustom() {
    let target = clamp(
      syncCustomTarget?.value,
      1,
      10,
      SYNC_CUSTOM_DEFAULT.target,
    );
    let enable = clamp(
      syncCustomEnable?.value,
      2,
      30,
      SYNC_CUSTOM_DEFAULT.enable,
    );
    if (enable <= target) enable = Math.min(30, target + 0.5);
    if (syncCustomTarget) syncCustomTarget.value = String(target);
    if (syncCustomEnable) syncCustomEnable.value = String(enable);
    try {
      cachedStorageSet({ [SYNC_CUSTOM_KEY]: { enable, target } });
    } catch {}
  }

  async function loadSyncPreset() {
    let value = "normal";
    let custom = { ...SYNC_CUSTOM_DEFAULT };
    try {
      const data = await cachedStorageGet([
        SYNC_PRESET_KEY,
        SYNC_CUSTOM_KEY,
      ]);
      if (data?.[SYNC_PRESET_KEY]) value = data[SYNC_PRESET_KEY];
      const c = data?.[SYNC_CUSTOM_KEY];
      if (c && typeof c === "object") {
        custom = {
          enable: clamp(c.enable, 2, 30, SYNC_CUSTOM_DEFAULT.enable),
          target: clamp(c.target, 1, 10, SYNC_CUSTOM_DEFAULT.target),
        };
      }
    } catch {}
    if (syncCustomEnable) syncCustomEnable.value = String(custom.enable);
    if (syncCustomTarget) syncCustomTarget.value = String(custom.target);
    reflectSyncPreset(value);
  }

  syncButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.syncPreset;
      reflectSyncPreset(value);
      try {
        cachedStorageSet({ [SYNC_PRESET_KEY]: value });
      } catch {}
      // 커스텀 선택 시 현재 입력값도 함께 저장(이전 값이 없으면 기본값 기록).
      if (value === "custom") saveSyncCustom();
    });
  });
  // 커스텀 입력 변경은 즉시 정규화 후 저장(blur/change 시).
  [syncCustomEnable, syncCustomTarget].forEach((el) =>
    el?.addEventListener("change", saveSyncCustom),
  );
  loadSyncPreset();

  // ── 팔로우 채널 자동 갱신(0=끔/30/60초 프리셋 + 커스텀 3~600초) ────────────
  const FOLLOW_REFRESH_KEY = "cheeseFollowRefreshSec";
  const FOLLOW_PRESETS = [0, 30, 60];
  const FOLLOW_CUSTOM_DEFAULT = 5;
  const followRefreshButtons = Array.from(
    document.querySelectorAll("[data-follow-refresh]"),
  );
  const followCustomRow = document.getElementById("followCustomRow");
  const followCustomSec = document.getElementById("followCustomSec");

  // 저장된 초 값(0 또는 3~600)을 보고 어떤 버튼이 활성인지 결정한다. 프리셋 값과
  // 정확히 같으면 그 프리셋, 아니면(끔 제외) 커스텀.
  function reflectFollowRefresh(secRaw) {
    let sec = Number(secRaw);
    if (!Number.isFinite(sec) || sec <= 0) sec = 0;
    const isPreset = FOLLOW_PRESETS.includes(sec);
    const activeKey = sec === 0 ? "0" : isPreset ? String(sec) : "custom";
    followRefreshButtons.forEach((btn) => {
      const active = btn.dataset.followRefresh === activeKey;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    if (followCustomRow) followCustomRow.hidden = activeKey !== "custom";
  }

  function saveFollowCustom() {
    let sec = clamp(followCustomSec?.value, 3, 600, FOLLOW_CUSTOM_DEFAULT);
    sec = Math.round(sec);
    if (followCustomSec) followCustomSec.value = String(sec);
    try {
      cachedStorageSet({ [FOLLOW_REFRESH_KEY]: sec });
    } catch {}
  }

  async function loadFollowRefresh() {
    let sec = 0;
    try {
      const data = await cachedStorageGet(FOLLOW_REFRESH_KEY);
      if (data?.[FOLLOW_REFRESH_KEY] != null) sec = data[FOLLOW_REFRESH_KEY];
    } catch {}
    // 커스텀 입력칸 초기값: 저장값이 커스텀 범위면 그 값, 아니면 기본.
    const n = Number(sec);
    const customInit =
      Number.isFinite(n) && n >= 3 && n <= 600 && !FOLLOW_PRESETS.includes(n)
        ? Math.round(n)
        : FOLLOW_CUSTOM_DEFAULT;
    if (followCustomSec) followCustomSec.value = String(customInit);
    reflectFollowRefresh(sec);
  }

  followRefreshButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.followRefresh;
      if (key === "custom") {
        reflectFollowRefresh(
          Number(followCustomSec?.value) || FOLLOW_CUSTOM_DEFAULT,
        );
        saveFollowCustom();
      } else {
        const sec = Number(key);
        reflectFollowRefresh(sec);
        try {
          cachedStorageSet({ [FOLLOW_REFRESH_KEY]: sec });
        } catch {}
      }
    });
  });
  followCustomSec?.addEventListener("change", saveFollowCustom);
  loadFollowRefresh();

  // ── 헤더 팔로우 표시 개수(사이드바+주제 탭 숨김 시 헤더 캐러셀) ────────────
  const HEADER_FOLLOW_COUNT_KEY = "cheeseHeaderFollowCount";
  const HEADER_FOLLOW_COUNT_PRESETS = [3, 5, 7];
  const HEADER_FOLLOW_COUNT_DEFAULT = 5;
  const headerFollowCountButtons = Array.from(
    document.querySelectorAll("[data-header-follow-count]"),
  );
  const headerFollowCountCustomRow = document.getElementById(
    "headerFollowCountCustomRow",
  );
  const headerFollowCountCustom = document.getElementById(
    "headerFollowCountCustom",
  );

  function reflectHeaderFollowCount(countRaw) {
    let count = clamp(countRaw, 1, 10, HEADER_FOLLOW_COUNT_DEFAULT);
    count = Math.round(count);
    const isPreset = HEADER_FOLLOW_COUNT_PRESETS.includes(count);
    const activeKey = isPreset ? String(count) : "custom";
    headerFollowCountButtons.forEach((btn) => {
      const active = btn.dataset.headerFollowCount === activeKey;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    if (headerFollowCountCustomRow) {
      headerFollowCountCustomRow.hidden = activeKey !== "custom";
    }
  }

  function saveHeaderFollowCountCustom() {
    let count = clamp(
      headerFollowCountCustom?.value,
      1,
      10,
      HEADER_FOLLOW_COUNT_DEFAULT,
    );
    count = Math.round(count);
    if (headerFollowCountCustom) headerFollowCountCustom.value = String(count);
    try {
      cachedStorageSet({ [HEADER_FOLLOW_COUNT_KEY]: count });
    } catch {}
  }

  async function loadHeaderFollowCount() {
    let count = HEADER_FOLLOW_COUNT_DEFAULT;
    try {
      const data = await cachedStorageGet(HEADER_FOLLOW_COUNT_KEY);
      if (data?.[HEADER_FOLLOW_COUNT_KEY] != null) {
        count = data[HEADER_FOLLOW_COUNT_KEY];
      }
    } catch {}
    const normalized = clamp(count, 1, 10, HEADER_FOLLOW_COUNT_DEFAULT);
    const customInit = HEADER_FOLLOW_COUNT_PRESETS.includes(normalized)
      ? HEADER_FOLLOW_COUNT_DEFAULT
      : Math.round(normalized);
    if (headerFollowCountCustom) {
      headerFollowCountCustom.value = String(customInit);
    }
    reflectHeaderFollowCount(normalized);
  }

  headerFollowCountButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.headerFollowCount;
      if (key === "custom") {
        reflectHeaderFollowCount(
          Number(headerFollowCountCustom?.value) || HEADER_FOLLOW_COUNT_DEFAULT,
        );
        saveHeaderFollowCountCustom();
      } else {
        const count = Number(key);
        reflectHeaderFollowCount(count);
        try {
          cachedStorageSet({ [HEADER_FOLLOW_COUNT_KEY]: count });
        } catch {}
      }
    });
  });
  headerFollowCountCustom?.addEventListener("change", () => {
    saveHeaderFollowCountCustom();
    reflectHeaderFollowCount(headerFollowCountCustom.value);
  });
  loadHeaderFollowCount();
})();
