// 치즈 플래터 - 기능 설정 팝업
// 확장 아이콘 클릭 시 뜨는 전용 설정 페이지. 8개 기능의 표시/숨김을 전역
// (chrome.storage.local `cheeseFeatureHidden`)으로 저장한다. content.js가
// storage.onChanged로 즉시 반영하므로 열린 치지직 탭에 바로 적용된다.
(() => {
  "use strict";

  const settingsPageParams = new URLSearchParams(window.location.search);
  const isSettingsTabView = settingsPageParams.get("view") === "tab";
  document.documentElement.classList.toggle(
    "settings-tab-view",
    isSettingsTabView,
  );

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
    "cheeseSettingsPopupWidth",
    "cheeseChatRecap",
    "cheeseChatRecapRetentionDays",
    "cheeseChatRecapPlayerButtonHidden",
    "cheeseChatRecapChannelColors",
    "cheeseChatRecapChannelColorsCustom",
    "cheeseChatRecapChannelTrendCumulative",
    "cheeseChatRecapChannelView",
    "cheeseChatRecapColorsCollapsed",
    "cheeseChatRecapCumulative",
    "cheeseChatRecapDonScope",
    "cheeseChatRecapGraphPhysics",
    "cheeseChatRecapGraphSpeed",
    "cheeseChatRecapPromptPicks",
    "cheeseChatRecapWordSort",
    "cheeseChatRecapWordType",
    "chatRecapNewVodBadge",
    "cheeseMasterEnabled",
    "cheeseGlobalScrollTopFab",
    "cheeseSettingsKnownFeatures",
    "cheeseSettingsNewFeatureBaselinePending",
    "cheeseSettingsNewFeatureUpdatePending",
    "cheeseFeatureHidden", // 모든 data-feature 토글 통합
    "cheeseSearchTheme",
    "cheeseUpdateNoticeEnabled",
    "cheeseUpdateNoticeMode",
    "cheeseUpdateNoticeDurationSec",
    "cheeseUpdateNoticeToastPosition",
    "cheeseAdMiniplayerKeepMuted",
    "cheeseAdMiniplayerUnmute",
    "cheeseAutoReloadOnError",
    "cheeseAutoReloadOnRelive",
    "cheeseAutoReliveMaxHours",
    "cheeseRootToFollowing",
    "cheeseRootToFollowingLogoMode",
    "cheeseCafeNow",
    "cheeseCafeNowAutoplay",
    "cheeseCafeNowAutoplayMuted",
    "cheeseClipAudioMixerEnabled",
    "cheeseClipAudioMixerAlwaysOn",
    "cheeseClipAudioMixerPreset",
    "cheeseClipVideoFilterEnabled",
    "cheeseClipVideoFilterAlwaysOn",
    "cheeseClipVideoFilterPreset",
    "cheeseClipEditorArrowStepS",
    "cheeseClipEditorShiftArrowStepS",
    "cheeseClipEditorBoundaryStepS",
    "cheeseClipEditorBoundaryOuterStepS",
    "cheeseCardDateTooltip",
    "cheeseVodChapterHide",
    "cheeseHideBlockedComment",
    "cheeseCommentBlocks",
    "cheeseChatProfileBlockButton",
    "cheeseChatWordFilters",
    "cheeseLogPowerLogDays",
    "cheeseLogPowerLogDaysLast",
    "cheeseLogPowerStatsGroup",
    "cheeseLogPowerStatsGroupOrder",
    "cheeseLogPowerStatsViewMode",
    "cheeseLogPowerBarEarnedOnly",
    "cheeseLogPowerLineCumulative",
    "cheeseLogPowerChartColors",
    "cheeseClipVaultAccountIds",
    "cheeseClipVaultActiveAccount",
    "cheeseClipVaultLimit",
    "cheeseClipVaultSort",
    "cheeseClipVaultGroupByStreamer",
    "cheeseClipVaultGroupByDate",
    "cheeseCardLivePreview",
    "cheeseCardLivePreviewPosition",
    "cheeseCardPreviewAudio",
    "cheeseCardPreviewDefaultVolume",
    "cheeseCardPreviewWheelDelaySec",
    "cheeseFollowerExact",
    "cheeseChannelLiveButton",
    "cheeseChannelLiveButtonEnd",
    "cheeseChannelLiveProfileBackground",
    "cheeseChannelProfileRadiusEnabled",
    "cheeseChannelProfileRadius",
    "cheeseChatButtonWrap",
    "cheeseChatFoldPersist",
    "cheeseChatPopupPip",
    "cheesePipChatWidth",
    "cheesePipChatLayout",
    "cheeseChatFontScale",
    "cheeseChatFontScaleSpecial",
    "cheeseChatTimeFormat",
    "cheeseChatTimeColors",
    "cheeseChatOsIcons",
    "cheeseChatOsIconPosition",
    "cheeseChatMoaActive",
    "cheeseFollowChannelTooltip",
    "cheeseFollowingLiveSortRemember",
    "cheesePipDisable",
    "cheeseVodChatGraph",
    "cheeseVodChatGraphColors",
    "cheeseFollowCleanup",
    "cheeseFollowOpenNewTab",
    "cheesePlayerDisableHidden",
    "cheesePopupPlayer",
    "cheesePopupPlayerAudio",
    "cheesePopupPlayerSize",
    "cheesePopupPlayerSizeW",
    "cheesePopupPlayerSizeH",
    "cheesePopupPlayerWide",
    "cheesePopupPlayerScroll",
    "cheesePopupPlayerBtnMixer",
    "cheesePopupPlayerBtnFilter",
    "cheesePopupPlayerBtnSync",
    "cheesePopupPlayerSeekBar",
    "cheesePopupPlayerBtnStats",
    "cheesePopupPlayerBtnScreenshot",
    "cheesePopupPlayerBtnRewind",
    "cheesePopupPlayerBtnForward",
    "cheesePopupPlayerMaxQuality",
    "cheesePopupPlayerDisableHidden",
    "cheeseFollowPreview",
    "cheeseFollowPreviewFullTitle",
    "cheeseFollowPreviewHeaderBottom",
    "cheeseFollowPreviewHideHeader",
    "cheeseFollowPreviewCardLayout",
    "cheeseFollowPreviewBadgePos",
    "cheeseFollowPreviewColors",
    "cheeseFollowPreviewHiddenParts",
    "cheeseFollowPreviewAlwaysViewers",
    "cheeseFollowPreviewAlwaysElapsed",
    "cheeseFollowPreviewHeaderFont",
    "cheeseFollowPreviewLiveEdge",
    "cheeseFollowPreviewMaxLifeSec",
    "cheeseFollowPreviewMuted",
    "cheeseFollowPreviewThumbOnly",
    "cheeseFollowPreviewVolume",
    "cheeseFollowRefreshSec",
    "cheeseLoungeRefreshMin",
    "cheeseInboxCommunityRefreshMin",
    "cheeseInboxCommunityOpenNewTab",
    // 탭별 '읽음' 기준 feedId. 복원하면 다른 기기에서도 읽은 글이 새 글로 뜨지 않는다.
    "cheeseLoungeRead",
    // 라운지 읽음 상태와 같은 성격(마지막으로 본 글 표식)이라 함께 옮긴다.
    "cheeseInboxCommunityReadMap",
    "cheeseFollowCustomSort",
    "cheeseFollowFavSortMode",
    "cheeseFollowFavOrder",
    "cheeseFollowFavMeta",
    "cheeseFollowCustomInitial",
    "cheeseFollowCustomMore",
    "cheeseFollowFavInitial",
    "cheeseFollowFavMore",
    "cheeseFollowGroupInitial",
    "cheeseFollowGroupMore",
    "cheeseFollowCustomRefreshSec",
    "cheeseFollowFavorites",
    "cheeseFollowGroupPlacement",
    "cheeseFollowGroupTagHideOffline",
    "cheeseFollowCustomGroups",
    "cheeseFollowGroupCollapsed",
    "cheeseFollowGroupCustomIcons",
    "cheeseFollowGroupOrder",
    "cheeseFollowGroupExcludedTags",
    "cheeseFollowGroupOfflineOverrides",
    "cheeseFollowPreviewSize",
    "cheeseChatWidth",
    "cheeseChatFoldState",
    "cheeseCommentFeatureEnabled",
    "cheeseCommentMarkersEnabled",
    "cheeseSectionRefreshCategory",
    "cheeseSectionRefreshSchedule",
    "cheeseHeaderFollowCount",
    "cheeseHeaderNav",
    "cheeseLiveSeekBar",
    "cheeseLiveSeekBarBottom",
    "cheeseLiveViewerCountPosition",
    "cheeseLiveViewerCountInline",
    "cheeseLiveViewerCountHidden",
    "cheeseLiveTagFilterButton",
    "cheeseLiveTagFilters",
    "cheeseLogPowerClickAction",
    "cheeseLogPowerEarningColor",
    "cheeseLogPowerPopupLimit",
    "cheeseLogPowerProgressMode",
    "cheeseLogPowerTimerMode",
    "cheeseLogPowerEraser",
    "cheeseMixerAlwaysOn",
    "cheeseAudioMixer.autoSync",
    "cheeseMaxQuality",
    "cheeseMaxQualityRespectManual",
    "cheeseMixerGainMin",
    "cheeseMixerGainMax",
    "cheeseMixerGainStep",
    "cheeseMixerGlobalDefaultMode",
    "cheesePlayerButtonSide",
    "cheeseScreenshotDirectSave",
    "cheeseScreenshotPreview",
    "cheeseSearchClips",
    "cheeseSearchClipDirectPlay",
    "cheeseSearchClipCandidateLimit",
    "cheeseSearchClipCategoryLimit",
    "cheeseSearchClipMoreStep",
    "cheeseSearchClipDateFilter",
    "cheeseSearchClipDefaultSort",
    "cheeseSearchClipMatchMode",
    "cheeseSearchClipSourcePreset",
    "cheeseSearchClipSourceWeights",
    "cheeseSearchClipSourceCustomWeights",
    "cheeseSearchClipWeights",
    "cheeseSearchRerank",
    "cheeseSearchRerankMoreStep",
    "cheeseSearchRerankPoolMax",
    "cheeseSearchRerankWeights",
    "cheeseSearchRerankDefaultSort",
    "cheeseSearchLiveRerank",
    "cheeseSearchLiveRerankDefaultSort",
    "cheeseSearchLiveRerankWeights",
    "cheeseSearchResetOnReturn",
    "cheeseCategoryVideoFilter",
    "cheeseCategoryVideoCandidateLimit",
    "cheeseSeekStepS",
    "cheeseSubscribeBadgeProgress",
    "cheeseSyncCustom",
    "cheeseSyncPreset",
    "cheeseSyncRate",
    "cheeseSyncMode",
    "cheeseSyncCooldownEnabled",
    "cheeseSyncCooldownCustom",
    "cheeseVideoFilterAlwaysOn",
    "cheeseVideoFilter.autoSharpen",
    "cheeseVideoFilterGlobalDefaultMode",
    "cheeseVodAutoplayOff",
    "cheeseVolumePct",
    "cheeseWheelVolume",
    "cheeseWheelVolumeRightClick",
    "cheeseActionOverlay",
    "cheeseActionOverlayPos",
    "cheeseWheelVolumeStep",
    "cheeseCommentTimestampClickAction",
    "cheeseCommentTimestampClickDelay",
    "cheeseChatRecapClickAction",
    "cheeseChatRecapClickDelay",
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

  function cachedStorageRemove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    if (storageCacheData) {
      list.forEach((key) => delete storageCacheData[key]);
    }
    try {
      chrome.storage?.local?.remove(list);
    } catch {}
  }

  // ── 팝업 폭 조절 ──────────────────────────────────────────────────────────
  // 오른쪽 가장자리를 끌어 폭을 바꾸고, 값은 저장해 다음에도 유지한다.
  // ⚠ 브라우저의 800px 팝업 한도에 스크롤바 영역이 포함된다.
  //   789px부터 루트 스크롤이 생길 수 있어 안전한 콘텐츠 폭으로 제한한다.
  const POPUP_WIDTH_KEY = "cheeseSettingsPopupWidth";
  const POPUP_WIDTH_DEFAULT = 500;
  const POPUP_WIDTH_MIN = 420;
  const POPUP_WIDTH_MAX = 788;

  function clampPopupWidth(px) {
    const n = Math.round(Number(px));
    if (!Number.isFinite(n)) return POPUP_WIDTH_DEFAULT;
    return Math.min(POPUP_WIDTH_MAX, Math.max(POPUP_WIDTH_MIN, n));
  }

  // ⚠ chrome.storage 는 비동기라 첫 페인트 뒤에 값이 온다 → 폭이 한 번 튄다.
  //   themeInit.js(head, 페인트 전 실행)가 읽을 수 있도록 localStorage 에도
  //   함께 적는다. 정본은 chrome.storage, 이건 깜빡임 방지용 사본이다.
  const POPUP_WIDTH_MIRROR = "cheeseSettingsPopupWidth";

  function applyPopupWidth(px) {
    document.documentElement.style.setProperty(
      "--settings-popup-w",
      `${clampPopupWidth(px)}px`,
    );
  }

  // 두 저장소에 함께 적는다.
  function savePopupWidth(px) {
    const w = clampPopupWidth(px);
    cachedStorageSet({ [POPUP_WIDTH_KEY]: w });
    try {
      localStorage.setItem(POPUP_WIDTH_MIRROR, String(w));
    } catch {}
  }

  function setupPopupResize() {
    // 탭 모드는 브라우저 창이 폭을 정한다 → 조절하지 않는다.
    if (isSettingsTabView) return;
    const handle = document.querySelector("[data-settings-resizer]");
    if (!handle) return;

    // 저장된 폭을 먼저 적용한다(프리페치 캐시에서 즉시 꺼낸다).
    void (async () => {
      try {
        const saved = (await cachedStorageGet(POPUP_WIDTH_KEY))?.[
          POPUP_WIDTH_KEY
        ];
        if (Number.isFinite(Number(saved))) {
          const normalized = clampPopupWidth(saved);
          applyPopupWidth(normalized);
          try {
            localStorage.setItem(POPUP_WIDTH_MIRROR, String(normalized));
          } catch {}
          // 1.43.0에서 저장된 789~800px 값은 한 번만 안전 상한으로
          // 내린다. 정본도 맞춰 다음 실행에서 다시 보정하지 않게 한다.
          if (Number(saved) !== normalized) {
            cachedStorageSet({ [POPUP_WIDTH_KEY]: normalized });
          }
        }
      } catch {}
    })();

    let startX = 0;
    let startW = 0;
    let pending = 0;
    let applied = 0;
    let pointerId = null;

    function onMove(e) {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      e.preventDefault();
      // 오른쪽으로 끌면 넓어진다.
      const next = clampPopupWidth(startW + (e.clientX - startX));
      pending = next;
      // 상·하한에서 같은 폭을 반복 적용하면 팝업 뷰포트가
      // 루트 스크롤 범위를 다시 계산할 수 있다.
      if (next === applied) return;
      applied = next;
      applyPopupWidth(pending);
    }

    function onUp(e) {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (pointerId !== null && handle.hasPointerCapture?.(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
      pointerId = null;
      handle.classList.remove("is-dragging");
      document.documentElement.classList.remove("settings-resizing");
      if (pending) savePopupWidth(pending);
    }

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startW =
        document.documentElement.getBoundingClientRect().width ||
        POPUP_WIDTH_DEFAULT;
      pending = 0;
      applied = clampPopupWidth(startW);
      pointerId = e.pointerId;
      handle.setPointerCapture?.(pointerId);
      handle.classList.add("is-dragging");
      document.documentElement.classList.add("settings-resizing");
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });

    // 더블클릭하면 기본 폭으로 되돌린다(너무 좁혀 놓고 못 찾는 경우 대비).
    handle.addEventListener("dblclick", () => {
      applyPopupWidth(POPUP_WIDTH_DEFAULT);
      savePopupWidth(POPUP_WIDTH_DEFAULT);
    });
  }

  setupPopupResize();

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
  const openSettingsTabButton = document.getElementById(
    "openSettingsTabButton",
  );

  if (openSettingsTabButton && isSettingsTabView) {
    openSettingsTabButton.hidden = true;
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    try {
      window.Coloris?.set({ themeMode: isDark ? "dark" : "light" });
    } catch {}
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

  // ── 전체 기능 일시 중지 ──────────────────────────────────────────────────
  const MASTER_ENABLED_KEY = "cheeseMasterEnabled";
  const masterEnabledInput = document.querySelector("[data-master-enabled]");

  (async () => {
    let enabled = true;
    try {
      const data = await cachedStorageGet(MASTER_ENABLED_KEY);
      enabled = data?.[MASTER_ENABLED_KEY] !== false;
    } catch {}
    if (masterEnabledInput) masterEnabledInput.checked = enabled;
  })();

  masterEnabledInput?.addEventListener("change", () => {
    const enabled = masterEnabledInput.checked;
    masterEnabledInput.disabled = true;
    cachedStorageSet({ [MASTER_ENABLED_KEY]: enabled });
    try {
      chrome.runtime.sendMessage(
        { type: "CHEESE_MASTER_SET", enabled },
        (response) => {
          const failed = Boolean(chrome.runtime.lastError) || !response?.ok;
          masterEnabledInput.disabled = false;
          if (failed) {
            settingsToast(
              "설정은 저장했지만 새로고침 안내를 표시하지 못했습니다.",
              "error",
            );
            return;
          }
          settingsToast(
            enabled
              ? "치즈 플래터 사용을 켰습니다. 열린 페이지에서 새로고침을 선택해 주세요."
              : "치즈 플래터 사용을 중지했습니다. 열린 페이지에서 새로고침을 선택해 주세요.",
            "ok",
          );
        },
      );
    } catch {
      masterEnabledInput.disabled = false;
      settingsToast(
        "설정은 저장했지만 새로고침 안내를 표시하지 못했습니다.",
        "error",
      );
    }
  });

  const GLOBAL_SCROLL_TOP_FAB_KEY = "cheeseGlobalScrollTopFab";
  const globalScrollTopFabInput = document.querySelector(
    "[data-global-scroll-top-fab]",
  );

  (async () => {
    try {
      const data = await cachedStorageGet(GLOBAL_SCROLL_TOP_FAB_KEY);
      if (globalScrollTopFabInput) {
        globalScrollTopFabInput.checked =
          data?.[GLOBAL_SCROLL_TOP_FAB_KEY] === true;
      }
    } catch {}
  })();

  globalScrollTopFabInput?.addEventListener("change", () => {
    cachedStorageSet({
      [GLOBAL_SCROLL_TOP_FAB_KEY]: globalScrollTopFabInput.checked,
    });
  });

  // ── 업데이트 새로고침 안내 ───────────────────────────────────────────────
  const UPDATE_NOTICE_ENABLED_KEY = "cheeseUpdateNoticeEnabled";
  const UPDATE_NOTICE_MODE_KEY = "cheeseUpdateNoticeMode";
  const UPDATE_NOTICE_DURATION_KEY = "cheeseUpdateNoticeDurationSec";
  const UPDATE_NOTICE_TOAST_POSITION_KEY = "cheeseUpdateNoticeToastPosition";
  const UPDATE_NOTICE_DEFAULT_MODE = "fixed";
  const UPDATE_NOTICE_DEFAULT_DURATION_SEC = 3;
  const UPDATE_NOTICE_DEFAULT_TOAST_POSITION = "top-center";
  const UPDATE_NOTICE_MODES = new Set(["fixed", "temporary", "toast"]);
  const UPDATE_NOTICE_DURATIONS = new Set([3, 5, 10, 15]);
  const UPDATE_NOTICE_TOAST_POSITIONS = new Set([
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "middle-center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
  ]);
  const updateNoticeEnabled = document.querySelector(
    "[data-update-notice-enabled]",
  );
  const updateNoticeModeRow = document.querySelector(
    "[data-update-notice-mode-row]",
  );
  const updateNoticeModeButtons = Array.from(
    document.querySelectorAll("[data-update-notice-mode-value]"),
  );
  const updateNoticeDurationRow = document.querySelector(
    "[data-update-notice-duration-row]",
  );
  const updateNoticeDurationButtons = Array.from(
    document.querySelectorAll("[data-update-notice-duration-value]"),
  );
  const updateNoticeToastPositionRow = document.querySelector(
    "[data-update-notice-toast-position-row]",
  );
  const updateNoticeToastPositionButtons = Array.from(
    document.querySelectorAll("[data-update-notice-toast-position-value]"),
  );
  let currentUpdateNoticeEnabled = true;
  let currentUpdateNoticeMode = UPDATE_NOTICE_DEFAULT_MODE;

  function normalizeUpdateNoticeMode(value) {
    return UPDATE_NOTICE_MODES.has(value) ? value : UPDATE_NOTICE_DEFAULT_MODE;
  }

  function normalizeUpdateNoticeDuration(value) {
    const duration = Number(value);
    return UPDATE_NOTICE_DURATIONS.has(duration)
      ? duration
      : UPDATE_NOTICE_DEFAULT_DURATION_SEC;
  }

  function normalizeUpdateNoticeToastPosition(value) {
    return UPDATE_NOTICE_TOAST_POSITIONS.has(value)
      ? value
      : UPDATE_NOTICE_DEFAULT_TOAST_POSITION;
  }

  function reflectUpdateNoticeToastPosition(positionRaw) {
    const position = normalizeUpdateNoticeToastPosition(positionRaw);
    updateNoticeToastPositionButtons.forEach((button) => {
      const active = button.dataset.updateNoticeToastPositionValue === position;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function reflectUpdateNoticeDuration(durationRaw) {
    const duration = normalizeUpdateNoticeDuration(durationRaw);
    updateNoticeDurationButtons.forEach((button) => {
      const active =
        Number(button.dataset.updateNoticeDurationValue) === duration;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function reflectUpdateNoticeOptionAvailability() {
    const transientMode = currentUpdateNoticeMode !== "fixed";
    const toastMode = currentUpdateNoticeMode === "toast";
    if (updateNoticeDurationRow) {
      updateNoticeDurationRow.hidden = !transientMode;
      updateNoticeDurationRow.classList.toggle(
        "is-locked",
        !currentUpdateNoticeEnabled,
      );
    }
    updateNoticeDurationButtons.forEach((button) => {
      button.disabled = !currentUpdateNoticeEnabled || !transientMode;
    });
    if (updateNoticeToastPositionRow) {
      updateNoticeToastPositionRow.hidden = !toastMode;
      updateNoticeToastPositionRow.classList.toggle(
        "is-locked",
        !currentUpdateNoticeEnabled,
      );
    }
    updateNoticeToastPositionButtons.forEach((button) => {
      button.disabled = !currentUpdateNoticeEnabled || !toastMode;
    });
  }

  function reflectUpdateNoticeMode(modeRaw) {
    const mode = normalizeUpdateNoticeMode(modeRaw);
    currentUpdateNoticeMode = mode;
    updateNoticeModeButtons.forEach((button) => {
      const active = button.dataset.updateNoticeModeValue === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
    reflectUpdateNoticeOptionAvailability();
  }

  function reflectUpdateNoticeEnabled(enabled) {
    currentUpdateNoticeEnabled = enabled;
    if (updateNoticeEnabled) updateNoticeEnabled.checked = enabled;
    updateNoticeModeRow?.classList.toggle("is-locked", !enabled);
    updateNoticeModeButtons.forEach((button) => {
      button.disabled = !enabled;
    });
    reflectUpdateNoticeOptionAvailability();
  }

  (async () => {
    let enabled = true;
    let mode = UPDATE_NOTICE_DEFAULT_MODE;
    let duration = UPDATE_NOTICE_DEFAULT_DURATION_SEC;
    let toastPosition = UPDATE_NOTICE_DEFAULT_TOAST_POSITION;
    try {
      const data = await cachedStorageGet([
        UPDATE_NOTICE_ENABLED_KEY,
        UPDATE_NOTICE_MODE_KEY,
        UPDATE_NOTICE_DURATION_KEY,
        UPDATE_NOTICE_TOAST_POSITION_KEY,
      ]);
      enabled = data?.[UPDATE_NOTICE_ENABLED_KEY] !== false;
      mode = normalizeUpdateNoticeMode(data?.[UPDATE_NOTICE_MODE_KEY]);
      duration = normalizeUpdateNoticeDuration(
        data?.[UPDATE_NOTICE_DURATION_KEY],
      );
      toastPosition = normalizeUpdateNoticeToastPosition(
        data?.[UPDATE_NOTICE_TOAST_POSITION_KEY],
      );
    } catch {}
    reflectUpdateNoticeEnabled(enabled);
    reflectUpdateNoticeMode(mode);
    reflectUpdateNoticeDuration(duration);
    reflectUpdateNoticeToastPosition(toastPosition);
  })();

  updateNoticeEnabled?.addEventListener("change", () => {
    const enabled = updateNoticeEnabled.checked;
    reflectUpdateNoticeEnabled(enabled);
    cachedStorageSet({ [UPDATE_NOTICE_ENABLED_KEY]: enabled });
  });

  updateNoticeModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const mode = normalizeUpdateNoticeMode(
        button.dataset.updateNoticeModeValue,
      );
      reflectUpdateNoticeMode(mode);
      cachedStorageSet({ [UPDATE_NOTICE_MODE_KEY]: mode });
    });
  });

  updateNoticeDurationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const duration = normalizeUpdateNoticeDuration(
        button.dataset.updateNoticeDurationValue,
      );
      reflectUpdateNoticeDuration(duration);
      cachedStorageSet({ [UPDATE_NOTICE_DURATION_KEY]: duration });
    });
  });

  updateNoticeToastPositionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const position = normalizeUpdateNoticeToastPosition(
        button.dataset.updateNoticeToastPositionValue,
      );
      reflectUpdateNoticeToastPosition(position);
      cachedStorageSet({ [UPDATE_NOTICE_TOAST_POSITION_KEY]: position });
    });
  });

  // ── 카테고리 탭(좌측 탭 → 우측 패널 전환) ─────────────────────────────────
  // 팝업을 열 때마다 항상 첫 탭('전체')에서 시작한다(설정 팝업은 예측 가능성이
  // 직전 탭 기억보다 중요 → 마지막 탭을 저장하지 않는다).
  const tabButtons = Array.from(document.querySelectorAll(".settings-tab"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const panelsScroll = document.querySelector(".settings-panels");
  const SETTINGS_KNOWN_FEATURES_KEY = "cheeseSettingsKnownFeatures";
  const SETTINGS_NEW_FEATURE_BASELINE_KEY =
    "cheeseSettingsNewFeatureBaselinePending";
  const SETTINGS_NEW_FEATURE_UPDATE_KEY =
    "cheeseSettingsNewFeatureUpdatePending";
  const newFeatureItems = Array.from(
    document.querySelectorAll(
      ".settings-item[data-new-feature], .settings-group-title[data-new-feature]",
    ),
  );
  const newFeatureState = {
    known: new Set(),
    pending: new Set(),
    ready: false,
  };

  function newFeatureItemId(item) {
    return String(item?.dataset?.newFeature || "").trim();
  }

  function newFeatureItemTab(item) {
    return item?.closest?.("[data-panel]")?.dataset?.panel || "";
  }

  function renderNewFeatureBadges() {
    newFeatureItems.forEach((item) => {
      item.classList.toggle(
        "is-new-feature",
        newFeatureState.pending.has(newFeatureItemId(item)),
      );
    });

    const tabCounts = new Map();
    newFeatureItems.forEach((item) => {
      const id = newFeatureItemId(item);
      const tab = newFeatureItemTab(item);
      if (!id || !tab || !newFeatureState.pending.has(id)) return;
      if (!tabCounts.has(tab)) tabCounts.set(tab, new Set());
      tabCounts.get(tab).add(id);
    });
    const totalCount = newFeatureState.pending.size;

    tabButtons.forEach((button) => {
      button.querySelector(".settings-tab-new-badge")?.remove();
      const tab = button.dataset.tab || "";
      const count = tab === "all" ? totalCount : tabCounts.get(tab)?.size || 0;
      button.classList.toggle("has-new-feature", count > 0);
      if (!count) return;
      const badge = document.createElement("span");
      badge.className = "settings-tab-new-badge";
      badge.textContent = tab === "all" ? `NEW ${count}` : "NEW";
      badge.setAttribute(
        "aria-label",
        tab === "all" ? `새 기능 ${count}개` : "새 기능 있음",
      );
      button.appendChild(badge);
    });
  }

  const newFeatureReady = (async () => {
    const data = await cachedStorageGet([
      SETTINGS_KNOWN_FEATURES_KEY,
      SETTINGS_NEW_FEATURE_BASELINE_KEY,
      SETTINGS_NEW_FEATURE_UPDATE_KEY,
    ]);
    const allIds = new Set(
      newFeatureItems.map(newFeatureItemId).filter(Boolean),
    );
    const storedKnown = Array.isArray(data?.[SETTINGS_KNOWN_FEATURES_KEY])
      ? data[SETTINGS_KNOWN_FEATURES_KEY]
      : [];
    newFeatureState.known = new Set(
      storedKnown.filter((id) => typeof id === "string" && id),
    );

    // 신규 설치의 첫 설정 열기: 현재 선언된 기능을 모두 기준점으로 저장하고 배지는 생략한다.
    if (data?.[SETTINGS_NEW_FEATURE_BASELINE_KEY] === true) {
      allIds.forEach((id) => newFeatureState.known.add(id));
      cachedStorageSet({
        [SETTINGS_KNOWN_FEATURES_KEY]: Array.from(newFeatureState.known),
      });
      cachedStorageRemove([
        SETTINGS_NEW_FEATURE_BASELINE_KEY,
        SETTINGS_NEW_FEATURE_UPDATE_KEY,
      ]);
      newFeatureState.ready = true;
      renderNewFeatureBadges();
      return;
    }

    if (data?.[SETTINGS_NEW_FEATURE_UPDATE_KEY] === true) {
      allIds.forEach((id) => {
        if (!newFeatureState.known.has(id)) newFeatureState.pending.add(id);
      });
    }
    newFeatureState.ready = true;
    renderNewFeatureBadges();
    if (!newFeatureState.pending.size) {
      cachedStorageRemove(SETTINGS_NEW_FEATURE_UPDATE_KEY);
    }
  })();

  function markNewFeatureTabSeen(tab) {
    if (!newFeatureState.ready) {
      void newFeatureReady.then(() => markNewFeatureTabSeen(tab));
      return;
    }
    const ids = new Set(
      newFeatureItems
        .filter((item) => newFeatureItemTab(item) === tab)
        .map(newFeatureItemId)
        .filter((id) => newFeatureState.pending.has(id)),
    );
    if (!ids.size) return;
    ids.forEach((id) => {
      newFeatureState.pending.delete(id);
      newFeatureState.known.add(id);
    });
    cachedStorageSet({
      [SETTINGS_KNOWN_FEATURES_KEY]: Array.from(newFeatureState.known),
    });
    renderNewFeatureBadges();
    if (!newFeatureState.pending.size) {
      cachedStorageRemove(SETTINGS_NEW_FEATURE_UPDATE_KEY);
    }
  }

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
      // 새 탭의 항목 옆 NEW를 실제로 볼 수 있도록, 진입 순간이 아니라 이전 탭을
      // 떠날 때 확인 처리한다. 같은 탭을 다시 누르는 것도 확인 동작으로 본다.
      const previousTab = activeTab;
      // 탭을 누르면 검색을 종료하고 그 탭으로 전환.
      if (searchInput && searchInput.value) {
        searchInput.value = "";
        applySettingsSearch("");
      }
      selectTab(btn.dataset.tab);
      markNewFeatureTabSeen(previousTab);
    }),
  );
  const requestedSettingsTab = isSettingsTabView
    ? settingsPageParams.get("tab")
    : "all";
  selectTab(requestedSettingsTab || "all");

  openSettingsTabButton?.addEventListener("click", () => {
    const settingsUrl = new URL(chrome.runtime.getURL("settings.html"));
    settingsUrl.searchParams.set("view", "tab");
    settingsUrl.searchParams.set("tab", activeTab);
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url: settingsUrl.toString() });
      return;
    }
    window.open(settingsUrl.toString(), "_blank", "noopener");
  });

  // 채팅 리캡을 새 탭으로 연다.
  document.getElementById("openChatRecap")?.addEventListener("click", () => {
    const url = chrome.runtime.getURL("chatRecap.html");
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
    window.open(url, "_blank", "noopener");
  });

  // 통나무파워 획득 내역을 새 탭으로 연다(수신함 탭·채팅 팝업과 같은 페이지).
  document.getElementById("openLogStats")?.addEventListener("click", () => {
    const url = chrome.runtime.getURL("logPowerStats.html");
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
    window.open(url, "_blank", "noopener");
  });

  // 설정 팝업을 닫을 때 마지막으로 보고 있던 탭도 확인 처리한다. storage.set 호출은
  // 동기적으로 큐에 올리고, 실제 저장 완료를 기다리느라 팝업 닫힘을 막지는 않는다.
  window.addEventListener("pagehide", () => {
    markNewFeatureTabSeen(activeTab);
  });

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
  // 미설정 시 기본 체크인 항목. 기존 동작을 유지해야 하는 영역도 여기에 포함한다.
  const DEFAULT_CHECKED = new Set([
    "sbFollowFavEnabled",
    "sbFollowGroupEnabled",
    // 라운지 소식은 기본 숨김(체크=숨김). content.js 의 FEATURE_DEFAULT_TRUE 와 맞춘다.
    "loungeNews",
    // 수신함 커뮤니티 소식도 채널별 요청이 필요하므로 opt-in 으로 둔다.
    "inboxCommunityNews",
  ]);
  const inputs = Array.from(document.querySelectorAll("[data-feature]"));
  const CLIP_EDITOR_ARROW_STEP_KEY = "cheeseClipEditorArrowStepS";
  const CLIP_EDITOR_SHIFT_STEP_KEY = "cheeseClipEditorShiftArrowStepS";
  const CLIP_EDITOR_BOUNDARY_STEP_KEY = "cheeseClipEditorBoundaryStepS";
  const CLIP_EDITOR_BOUNDARY_OUTER_STEP_KEY =
    "cheeseClipEditorBoundaryOuterStepS";
  const clipEditorPrecisionInput = document.querySelector(
    '[data-feature="clipEditorPrecision"]',
  );
  const clipEditorStepPickers = Array.from(
    document.querySelectorAll("[data-clip-editor-step-picker]"),
  );
  const clipEditorArrowStepPicker = document.querySelector(
    '[data-clip-editor-step-picker="arrow"]',
  );
  const clipEditorShiftStepPicker = document.querySelector(
    '[data-clip-editor-step-picker="shift"]',
  );
  const clipEditorBoundaryStepPicker = document.querySelector(
    '[data-clip-editor-step-picker="boundary"]',
  );
  const clipEditorBoundaryOuterStepPicker = document.querySelector(
    '[data-clip-editor-step-picker="boundaryOuter"]',
  );

  function normalizeClipEditorArrowStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(5, Math.max(1, Math.round(number)))
      : 5;
  }

  function normalizeClipEditorShiftStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(0.9, Math.max(0.1, Math.round(number * 10) / 10))
      : 0.1;
  }

  function normalizeClipEditorBoundaryStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(1, Math.max(0.1, Math.round(number * 10) / 10))
      : 0.1;
  }

  function normalizeClipEditorBoundaryOuterStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(10, Math.max(1, Math.round(number)))
      : 1;
  }

  function reflectClipEditorStepAvailability() {
    const disabled = !clipEditorPrecisionInput?.checked;
    clipEditorStepPickers.forEach((picker) => {
      const trigger = picker.querySelector("[data-clip-editor-step-trigger]");
      if (trigger) trigger.disabled = disabled;
      if (disabled) closeClipEditorStepPicker(picker);
    });
  }

  function normalizeClipEditorStepValue(picker, value) {
    const type = picker?.dataset.clipEditorStepPicker;
    if (type === "shift") return normalizeClipEditorShiftStep(value);
    if (type === "boundary") return normalizeClipEditorBoundaryStep(value);
    if (type === "boundaryOuter") {
      return normalizeClipEditorBoundaryOuterStep(value);
    }
    return normalizeClipEditorArrowStep(value);
  }

  function setClipEditorStepValue(picker, value) {
    if (!picker) return;
    const normalized = normalizeClipEditorStepValue(picker, value);
    const stringValue = String(normalized);
    picker.dataset.value = stringValue;
    const trigger = picker.querySelector("[data-clip-editor-step-trigger]");
    const label = picker.querySelector("[data-clip-editor-step-label]");
    if (trigger) trigger.dataset.value = stringValue;
    if (label) label.textContent = `${stringValue}초`;
    picker
      .querySelectorAll("[data-clip-editor-step-list] [role='option']")
      .forEach((option) => {
        option.setAttribute(
          "aria-selected",
          String(option.dataset.value === stringValue),
        );
      });
  }

  function closeClipEditorStepPicker(picker) {
    if (!picker) return;
    const trigger = picker.querySelector("[data-clip-editor-step-trigger]");
    const list = picker.querySelector("[data-clip-editor-step-list]");
    picker.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
    if (list) list.hidden = true;
  }

  function closeAllClipEditorStepPickers(except = null) {
    clipEditorStepPickers.forEach((picker) => {
      if (picker !== except) closeClipEditorStepPicker(picker);
    });
  }

  function positionClipEditorStepList(picker) {
    const trigger = picker?.querySelector("[data-clip-editor-step-trigger]");
    const list = picker?.querySelector("[data-clip-editor-step-list]");
    if (!trigger || !list) return;
    const rect = trigger.getBoundingClientRect();
    list.style.left = `${Math.round(rect.left)}px`;
    list.style.top = `${Math.round(rect.bottom + 4)}px`;
    list.style.minWidth = `${Math.round(rect.width)}px`;
    list.style.maxHeight = `${Math.max(
      120,
      window.innerHeight - rect.bottom - 16,
    )}px`;
  }

  function openClipEditorStepPicker(picker) {
    const trigger = picker?.querySelector("[data-clip-editor-step-trigger]");
    const list = picker?.querySelector("[data-clip-editor-step-list]");
    if (!picker || !trigger || !list || trigger.disabled) return;
    closeAllClipEditorStepPickers(picker);
    picker.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.hidden = false;
    positionClipEditorStepList(picker);
  }

  function saveClipEditorStepValue(picker, rawValue) {
    if (!picker) return;
    const value = normalizeClipEditorStepValue(picker, rawValue);
    const type = picker.dataset.clipEditorStepPicker;
    const key =
      type === "shift"
        ? CLIP_EDITOR_SHIFT_STEP_KEY
        : type === "boundary"
          ? CLIP_EDITOR_BOUNDARY_STEP_KEY
          : type === "boundaryOuter"
            ? CLIP_EDITOR_BOUNDARY_OUTER_STEP_KEY
            : CLIP_EDITOR_ARROW_STEP_KEY;
    setClipEditorStepValue(picker, value);
    try {
      cachedStorageSet({ [key]: value });
    } catch {}
  }

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
      input.checked = typeof v === "boolean" ? v : DEFAULT_CHECKED.has(key);
    });
    reflectClipEditorStepAvailability();
    reflectChatTimeFormatAvailability();
    reflectLoungeRefreshAvailability();
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
  clipEditorPrecisionInput?.addEventListener(
    "change",
    reflectClipEditorStepAvailability,
  );
  load();

  (async () => {
    try {
      const data = await cachedStorageGet([
        CLIP_EDITOR_ARROW_STEP_KEY,
        CLIP_EDITOR_SHIFT_STEP_KEY,
        CLIP_EDITOR_BOUNDARY_STEP_KEY,
        CLIP_EDITOR_BOUNDARY_OUTER_STEP_KEY,
      ]);
      setClipEditorStepValue(
        clipEditorArrowStepPicker,
        data?.[CLIP_EDITOR_ARROW_STEP_KEY],
      );
      setClipEditorStepValue(
        clipEditorShiftStepPicker,
        data?.[CLIP_EDITOR_SHIFT_STEP_KEY],
      );
      setClipEditorStepValue(
        clipEditorBoundaryStepPicker,
        data?.[CLIP_EDITOR_BOUNDARY_STEP_KEY],
      );
      setClipEditorStepValue(
        clipEditorBoundaryOuterStepPicker,
        data?.[CLIP_EDITOR_BOUNDARY_OUTER_STEP_KEY],
      );
    } catch {
      setClipEditorStepValue(clipEditorArrowStepPicker, 5);
      setClipEditorStepValue(clipEditorShiftStepPicker, 0.1);
      setClipEditorStepValue(clipEditorBoundaryStepPicker, 0.1);
      setClipEditorStepValue(clipEditorBoundaryOuterStepPicker, 1);
    }
  })();

  clipEditorStepPickers.forEach((picker) => {
    const trigger = picker.querySelector("[data-clip-editor-step-trigger]");
    const list = picker.querySelector("[data-clip-editor-step-list]");
    trigger?.addEventListener("click", () => {
      if (picker.classList.contains("is-open")) {
        closeClipEditorStepPicker(picker);
      } else {
        openClipEditorStepPicker(picker);
      }
    });
    list?.addEventListener("click", (event) => {
      const option = event.target.closest("[role='option'][data-value]");
      if (!option) return;
      saveClipEditorStepValue(picker, option.dataset.value);
      closeClipEditorStepPicker(picker);
      trigger?.focus();
    });
    list?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeClipEditorStepPicker(picker);
      trigger?.focus();
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-clip-editor-step-picker]")) return;
    closeAllClipEditorStepPickers();
  });
  window.addEventListener("resize", () => closeAllClipEditorStepPickers());
  panelsScroll?.addEventListener("scroll", () =>
    closeAllClipEditorStepPickers(),
  );

  // ── 채팅 시간 표시 형식·테마별 글자 색상 ───────────────────────────────────
  // ── 채팅 리캡(내 채팅 기록) ───────────────────────────────────────────────
  const CHAT_RECAP_ENABLED_KEY = "cheeseChatRecap";
  const CHAT_RECAP_RETENTION_KEY = "cheeseChatRecapRetentionDays";

  function bindChatRecapSettings() {
    const toggle = document.querySelector("[data-chat-recap-enabled]");
    const retentionItem = document.querySelector(
      "[data-chat-recap-retention-item]",
    );
    const retentionButtons = Array.from(
      document.querySelectorAll("[data-chat-recap-retention-value]"),
    );
    if (!toggle) return;

    function reflectRetention(value) {
      const v = String(Number(value) || 0);
      retentionButtons.forEach((button) => {
        const active = button.dataset.chatRecapRetentionValue === v;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
    }

    // 기록이 꺼져 있으면 보관 기간은 의미가 없다 → 잠근다.
    function reflectAvailability() {
      const disabled = !toggle.checked;
      retentionButtons.forEach((button) => {
        button.disabled = disabled;
      });
      retentionItem?.classList.toggle("is-locked", disabled);
    }

    void (async () => {
      const data = await cachedStorageGet([
        CHAT_RECAP_ENABLED_KEY,
        CHAT_RECAP_RETENTION_KEY,
      ]);
      toggle.checked = data?.[CHAT_RECAP_ENABLED_KEY] === true; // 기본 꺼짐
      reflectRetention(data?.[CHAT_RECAP_RETENTION_KEY]);
      reflectAvailability();
    })();

    toggle.addEventListener("change", () => {
      cachedStorageSet({ [CHAT_RECAP_ENABLED_KEY]: toggle.checked });
      reflectAvailability();
    });

    retentionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = Number(button.dataset.chatRecapRetentionValue) || 0;
        cachedStorageSet({ [CHAT_RECAP_RETENTION_KEY]: value });
        reflectRetention(value);
      });
    });
  }

  bindChatRecapSettings();

  const CHAT_TIME_FORMAT_KEY = "cheeseChatTimeFormat";
  const CHAT_TIME_COLORS_KEY = "cheeseChatTimeColors";
  const CHAT_TIME_COLORS_DEFAULT = Object.freeze({
    enabled: false,
    light: "#000000",
    dark: "#ffffff",
  });
  const chatShowTimeInput = document.querySelector(
    '[data-feature="chatShowTime"]',
  );
  const chatTimeFormatItem = document.querySelector(
    "[data-chat-time-format-item]",
  );
  const chatTimeFormatButtons = Array.from(
    document.querySelectorAll("[data-chat-time-format-value]"),
  );
  const chatTimeColorItem = document.querySelector(
    "[data-chat-time-color-item]",
  );
  const chatTimeColorEnabledInput = document.querySelector(
    "[data-chat-time-color-enabled]",
  );
  const chatTimeColorEditor = document.querySelector(
    "[data-chat-time-color-editor]",
  );
  const chatTimeColorLightInput = document.querySelector(
    "[data-chat-time-color-light]",
  );
  const chatTimeColorDarkInput = document.querySelector(
    "[data-chat-time-color-dark]",
  );
  const chatTimeColorReset = document.querySelector(
    "[data-chat-time-color-reset]",
  );
  let chatTimeMoaLocked = false;
  let chatTimeColors = { ...CHAT_TIME_COLORS_DEFAULT };
  let chatTimeColorsSaveTimer = 0;

  function normalizeChatTimeFormat(value) {
    return value === "12h-en" || value === "12h-ko" ? value : "24h";
  }

  function normalizeChatTimeColor(value, fallback) {
    const color = String(value || "")
      .trim()
      .toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
  }

  function normalizeChatTimeColors(value) {
    const config = value && typeof value === "object" ? value : {};
    return {
      enabled: config.enabled === true,
      light: normalizeChatTimeColor(
        config.light,
        CHAT_TIME_COLORS_DEFAULT.light,
      ),
      dark: normalizeChatTimeColor(config.dark, CHAT_TIME_COLORS_DEFAULT.dark),
    };
  }

  function reflectChatTimeFormat(value) {
    const normalized = normalizeChatTimeFormat(value);
    chatTimeFormatButtons.forEach((button) => {
      const active = button.dataset.chatTimeFormatValue === normalized;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }
  function reflectChatTimeFormatAvailability() {
    const disabled = chatTimeMoaLocked || !chatShowTimeInput?.checked;
    chatTimeFormatButtons.forEach((button) => {
      button.disabled = disabled;
    });
    chatTimeFormatItem?.classList.toggle("is-locked", disabled);
    reflectChatTimeColors();
  }

  function reflectChatTimeColorInput(input, color, disabled) {
    if (!input) return;
    const displayColor = color.toUpperCase();
    input.value = displayColor;
    input.disabled = disabled;
    const field = input.closest(".clr-field");
    if (field) {
      field.style.color = displayColor;
      field.classList.toggle("is-disabled", disabled);
      const trigger = field.querySelector("button");
      if (trigger) trigger.disabled = disabled;
    }
  }

  function reflectChatTimeColors() {
    const unavailable = chatTimeMoaLocked || !chatShowTimeInput?.checked;
    const editorDisabled = unavailable || !chatTimeColors.enabled;
    if (chatTimeColorEnabledInput) {
      chatTimeColorEnabledInput.checked = chatTimeColors.enabled;
      chatTimeColorEnabledInput.disabled = unavailable;
    }
    reflectChatTimeColorInput(
      chatTimeColorLightInput,
      chatTimeColors.light,
      editorDisabled,
    );
    reflectChatTimeColorInput(
      chatTimeColorDarkInput,
      chatTimeColors.dark,
      editorDisabled,
    );
    if (chatTimeColorReset) chatTimeColorReset.disabled = editorDisabled;
    chatTimeColorEditor?.setAttribute("aria-disabled", String(editorDisabled));
    chatTimeColorItem?.classList.toggle("is-locked", unavailable);
    chatTimeColorItem?.classList.toggle("is-disabled", editorDisabled);
  }

  function updateChatTimeColors(patch, save = true) {
    chatTimeColors = normalizeChatTimeColors({
      ...chatTimeColors,
      ...patch,
    });
    reflectChatTimeColors();
    if (!save) return;
    clearTimeout(chatTimeColorsSaveTimer);
    chatTimeColorsSaveTimer = 0;
    try {
      cachedStorageSet({ [CHAT_TIME_COLORS_KEY]: chatTimeColors });
    } catch {}
  }

  function scheduleChatTimeColorsSave() {
    clearTimeout(chatTimeColorsSaveTimer);
    chatTimeColorsSaveTimer = window.setTimeout(() => {
      chatTimeColorsSaveTimer = 0;
      try {
        cachedStorageSet({ [CHAT_TIME_COLORS_KEY]: chatTimeColors });
      } catch {}
    }, 120);
  }

  (async () => {
    let format = "24h";
    try {
      const data = await cachedStorageGet(CHAT_TIME_FORMAT_KEY);
      format = normalizeChatTimeFormat(data?.[CHAT_TIME_FORMAT_KEY]);
    } catch {}
    reflectChatTimeFormat(format);
    reflectChatTimeFormatAvailability();
  })();
  (async () => {
    try {
      const data = await cachedStorageGet(CHAT_TIME_COLORS_KEY);
      chatTimeColors = normalizeChatTimeColors(data?.[CHAT_TIME_COLORS_KEY]);
    } catch {
      chatTimeColors = { ...CHAT_TIME_COLORS_DEFAULT };
    }
    reflectChatTimeColors();
  })();
  chatTimeFormatButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const format = normalizeChatTimeFormat(
        button.dataset.chatTimeFormatValue,
      );
      reflectChatTimeFormat(format);
      try {
        cachedStorageSet({ [CHAT_TIME_FORMAT_KEY]: format });
      } catch {}
    });
  });
  chatTimeColorEnabledInput?.addEventListener("change", () => {
    updateChatTimeColors({
      enabled: chatTimeColorEnabledInput.checked,
    });
  });
  function bindChatTimeColorInput(input, key) {
    input?.addEventListener("input", () => {
      const color = normalizeChatTimeColor(input.value, "");
      if (!color) return;
      updateChatTimeColors({ [key]: color }, false);
      scheduleChatTimeColorsSave();
    });
    input?.addEventListener("change", () => {
      const color = normalizeChatTimeColor(input.value, "");
      if (!color) {
        reflectChatTimeColors();
        return;
      }
      updateChatTimeColors({ [key]: color });
    });
  }
  bindChatTimeColorInput(chatTimeColorLightInput, "light");
  bindChatTimeColorInput(chatTimeColorDarkInput, "dark");
  chatTimeColorReset?.addEventListener("click", () => {
    updateChatTimeColors({
      light: CHAT_TIME_COLORS_DEFAULT.light,
      dark: CHAT_TIME_COLORS_DEFAULT.dark,
    });
  });
  chatShowTimeInput?.addEventListener("change", () => {
    reflectChatTimeFormatAvailability();
  });
  reflectChatTimeColors();

  // ── 채팅 작성 기기 아이콘: 시간 앞/뒤 + 사용자 SVG/이미지 ─────────────────
  const CHAT_OS_ICONS_KEY = "cheeseChatOsIcons";
  const CHAT_OS_ICON_POSITION_KEY = "cheeseChatOsIconPosition";
  const CHAT_OS_TYPES = ["PC", "AOS", "IOS"];
  const CHAT_OS_IMAGE_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
  const CHAT_OS_IMAGE_OUTPUT_MAX_BYTES = 50 * 1024;
  const CHAT_OS_IMAGE_SIZE = 64;
  const CHAT_OS_DEFAULT_SVG = Object.freeze({
    PC: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
    AOS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>',
    IOS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.528V3a1 1 0 0 1 1-1h0"/><path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21"/></svg>',
  });
  const CHAT_OS_SVG_TAGS = new Set([
    "circle",
    "ellipse",
    "g",
    "line",
    "path",
    "polygon",
    "polyline",
    "rect",
  ]);
  const CHAT_OS_SVG_ATTRIBUTES = new Set([
    "clip-rule",
    "cx",
    "cy",
    "d",
    "fill",
    "fill-opacity",
    "fill-rule",
    "height",
    "opacity",
    "points",
    "r",
    "rx",
    "ry",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
    "transform",
    "width",
    "x",
    "x1",
    "x2",
    "y",
    "y1",
    "y2",
  ]);
  const CHAT_OS_SVG_ROOT_ATTRIBUTES = new Set([
    "clip-rule",
    "fill",
    "fill-opacity",
    "fill-rule",
    "opacity",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
  ]);
  const chatShowOsIconInput = document.querySelector(
    '[data-feature="chatShowOsIcon"]',
  );
  const chatOsPositionItem = document.querySelector(
    "[data-chat-os-position-item]",
  );
  const chatOsPositionButtons = Array.from(
    document.querySelectorAll("[data-chat-os-position-value]"),
  );
  const chatOsCustomItem = document.querySelector("[data-chat-os-custom-item]");
  const chatOsCustomInputs = new Map(
    CHAT_OS_TYPES.map((type) => [
      type,
      document.querySelector(`[data-chat-os-custom-input="${type}"]`),
    ]),
  );
  const chatOsCustomPreviews = new Map(
    CHAT_OS_TYPES.map((type) => [
      type,
      document.querySelector(`[data-chat-os-custom-preview="${type}"]`),
    ]),
  );
  const chatOsCustomMessages = new Map(
    CHAT_OS_TYPES.map((type) => [
      type,
      document.querySelector(`[data-chat-os-custom-message="${type}"]`),
    ]),
  );
  const chatOsCustomResets = new Map(
    CHAT_OS_TYPES.map((type) => [
      type,
      document.querySelector(`[data-chat-os-custom-reset="${type}"]`),
    ]),
  );
  const chatOsImageButtons = new Map(
    CHAT_OS_TYPES.map((type) => [
      type,
      document.querySelector(`[data-chat-os-image-button="${type}"]`),
    ]),
  );
  const chatOsImageInputs = new Map(
    CHAT_OS_TYPES.map((type) => [
      type,
      document.querySelector(`[data-chat-os-image-input="${type}"]`),
    ]),
  );
  const chatOsSaveTimers = new Map();
  const chatOsImageJobs = new Map();
  let chatOsCustomIcons = {};
  let chatOsIconPosition = "after";

  function normalizeChatOsIconPosition(value) {
    return value === "before" ? "before" : "after";
  }

  function sanitizeChatOsSvg(value) {
    const source = String(value || "").trim();
    if (!source || source.length > 12000) return null;
    try {
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      const root = doc.documentElement;
      if (root?.localName !== "svg" || root.querySelector("parsererror")) {
        return null;
      }
      const viewBoxValues = String(root.getAttribute("viewBox") || "0 0 24 24")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        viewBoxValues.length !== 4 ||
        viewBoxValues.some((number) => !Number.isFinite(number)) ||
        viewBoxValues[2] <= 0 ||
        viewBoxValues[3] <= 0 ||
        viewBoxValues[2] > 10000 ||
        viewBoxValues[3] > 10000
      ) {
        return null;
      }
      const unsafeValue = (raw) =>
        /(?:javascript:|data:|url\s*\(|<|>)/i.test(raw);
      const clean = (node) => {
        for (const child of [...node.childNodes]) {
          if (child.nodeType !== Node.ELEMENT_NODE) {
            child.remove();
            continue;
          }
          const tag = child.localName?.toLowerCase();
          if (!CHAT_OS_SVG_TAGS.has(tag)) {
            child.remove();
            continue;
          }
          for (const attribute of [...child.attributes]) {
            const name = attribute.name.toLowerCase();
            if (
              !CHAT_OS_SVG_ATTRIBUTES.has(name) ||
              unsafeValue(attribute.value)
            ) {
              child.removeAttribute(attribute.name);
            }
          }
          clean(child);
        }
      };
      clean(root);
      if (!root.children.length) return null;
      const serializer = new XMLSerializer();
      const content = [...root.children]
        .map((child) => serializer.serializeToString(child))
        .join("");
      const viewBox = viewBoxValues.join(" ");
      const attributes = [...root.attributes]
        .filter((attribute) => {
          const name = attribute.name.toLowerCase();
          return (
            name !== "viewbox" &&
            CHAT_OS_SVG_ROOT_ATTRIBUTES.has(name) &&
            !unsafeValue(attribute.value)
          );
        })
        .map(
          (attribute) =>
            `${attribute.name.toLowerCase()}="${attribute.value
              .replaceAll("&", "&amp;")
              .replaceAll('"', "&quot;")}"`,
        )
        .join(" ");
      return `<svg viewBox="${viewBox}"${attributes ? ` ${attributes}` : ""} aria-hidden="true">${content}</svg>`;
    } catch {
      return null;
    }
  }

  function normalizeChatOsCustomIcons(value) {
    const source = value && typeof value === "object" ? value : {};
    const output = {};
    CHAT_OS_TYPES.forEach((type) => {
      const raw = source[type];
      // 1.40.0까지 저장한 문자열 SVG도 그대로 불러와 새 구조로 마이그레이션한다.
      const icon = typeof raw === "string" ? { type: "svg", data: raw } : raw;
      if (!icon || typeof icon !== "object") return;
      if (icon.type === "image") {
        const data = sanitizeChatOsImageData(icon.data);
        if (data) output[type] = { type: "image", data };
        return;
      }
      const sanitized = sanitizeChatOsSvg(icon.data);
      if (sanitized) output[type] = { type: "svg", data: sanitized };
    });
    return output;
  }

  function sanitizeChatOsImageData(value) {
    const source = String(value || "").trim();
    const match = source.match(
      /^data:image\/webp;base64,([a-z0-9+/]+={0,2})$/i,
    );
    if (!match) return null;
    const encoded = match[1];
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = Math.floor((encoded.length * 3) / 4) - padding;
    return bytes > 0 && bytes <= CHAT_OS_IMAGE_OUTPUT_MAX_BYTES ? source : null;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () =>
        resolve(String(reader.result || "")),
      );
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(blob);
    });
  }

  async function decodeChatOsImage(file) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
        };
      } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function encodeChatOsImage(file) {
    if (
      !file ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    ) {
      throw new Error("PNG, JPG 또는 WebP 이미지만 선택할 수 있습니다.");
    }
    if (file.size <= 0 || file.size > CHAT_OS_IMAGE_SOURCE_MAX_BYTES) {
      throw new Error("이미지는 2MB 이하만 선택할 수 있습니다.");
    }
    const decoded = await decodeChatOsImage(file);
    try {
      if (!decoded.width || !decoded.height) {
        throw new Error("이미지 크기를 확인할 수 없습니다.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = CHAT_OS_IMAGE_SIZE;
      canvas.height = CHAT_OS_IMAGE_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("이미지를 변환할 수 없습니다.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const scale = Math.min(
        CHAT_OS_IMAGE_SIZE / decoded.width,
        CHAT_OS_IMAGE_SIZE / decoded.height,
      );
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      context.drawImage(
        decoded.source,
        Math.round((CHAT_OS_IMAGE_SIZE - width) / 2),
        Math.round((CHAT_OS_IMAGE_SIZE - height) / 2),
        width,
        height,
      );
      let blob = null;
      for (const quality of [0.92, 0.8, 0.65, 0.5]) {
        blob = await canvasToBlob(canvas, "image/webp", quality);
        if (blob && blob.size <= CHAT_OS_IMAGE_OUTPUT_MAX_BYTES) break;
      }
      if (!blob || blob.type !== "image/webp") {
        throw new Error("이 브라우저에서는 WebP 변환을 지원하지 않습니다.");
      }
      if (blob.size > CHAT_OS_IMAGE_OUTPUT_MAX_BYTES) {
        throw new Error("변환된 이미지가 50KB를 초과합니다.");
      }
      const data = sanitizeChatOsImageData(await blobToDataUrl(blob));
      if (!data) throw new Error("변환된 이미지 형식이 올바르지 않습니다.");
      return data;
    } finally {
      decoded.close();
    }
  }

  function reflectChatOsPosition() {
    chatOsPositionButtons.forEach((button) => {
      const active = button.dataset.chatOsPositionValue === chatOsIconPosition;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function renderChatOsPreview(type) {
    const preview = chatOsCustomPreviews.get(type);
    if (!preview) return;
    const custom = chatOsCustomIcons[type] || null;
    if (custom?.type === "image") {
      const image = document.createElement("img");
      image.src = custom.data;
      image.alt = "";
      image.draggable = false;
      preview.replaceChildren(image);
      return;
    }
    preview.innerHTML = custom?.data || CHAT_OS_DEFAULT_SVG[type];
  }

  function reflectChatOsCustomRow(type, { syncInput = true } = {}) {
    const input = chatOsCustomInputs.get(type);
    const message = chatOsCustomMessages.get(type);
    const reset = chatOsCustomResets.get(type);
    const custom = chatOsCustomIcons[type] || null;
    if (syncInput && input) {
      input.value = custom?.type === "svg" ? custom.data : "";
    }
    renderChatOsPreview(type);
    if (message) {
      message.textContent = custom
        ? custom.type === "image"
          ? "사용자 이미지 적용 중 (64px WebP)"
          : "사용자 SVG 적용 중"
        : "기본 아이콘 사용 중";
      message.classList.remove("is-error");
    }
    if (reset) reset.disabled = !custom || !chatShowOsIconInput?.checked;
  }

  function reflectChatOsAvailability() {
    const disabled =
      !chatShowOsIconInput?.checked || chatShowOsIconInput?.disabled === true;
    chatOsPositionButtons.forEach((button) => {
      button.disabled = disabled;
    });
    chatOsCustomInputs.forEach((input) => {
      if (input) input.disabled = disabled;
    });
    chatOsImageButtons.forEach((button) => {
      if (button) button.disabled = disabled;
    });
    chatOsImageInputs.forEach((input) => {
      if (input) input.disabled = disabled;
    });
    chatOsCustomResets.forEach((reset, type) => {
      if (reset) reset.disabled = disabled || !chatOsCustomIcons[type];
    });
    chatOsPositionItem?.classList.toggle("is-locked", disabled);
    chatOsCustomItem?.classList.toggle("is-locked", disabled);
  }

  function saveChatOsCustomIcons() {
    cachedStorageSet({ [CHAT_OS_ICONS_KEY]: chatOsCustomIcons });
  }

  function commitChatOsCustomInput(type, canonicalize = false) {
    const input = chatOsCustomInputs.get(type);
    const message = chatOsCustomMessages.get(type);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) {
      delete chatOsCustomIcons[type];
      saveChatOsCustomIcons();
      reflectChatOsCustomRow(type);
      reflectChatOsAvailability();
      return;
    }
    const sanitized = sanitizeChatOsSvg(raw);
    if (!sanitized) {
      if (message) {
        message.textContent = "안전한 SVG 도형 코드를 확인해 주세요.";
        message.classList.add("is-error");
      }
      renderChatOsPreview(type);
      return;
    }
    chatOsCustomIcons[type] = { type: "svg", data: sanitized };
    saveChatOsCustomIcons();
    if (canonicalize) input.value = sanitized;
    reflectChatOsCustomRow(type, { syncInput: canonicalize });
    reflectChatOsAvailability();
  }

  (async () => {
    try {
      const data = await cachedStorageGet([
        CHAT_OS_ICONS_KEY,
        CHAT_OS_ICON_POSITION_KEY,
      ]);
      chatOsCustomIcons = normalizeChatOsCustomIcons(data?.[CHAT_OS_ICONS_KEY]);
      chatOsIconPosition = normalizeChatOsIconPosition(
        data?.[CHAT_OS_ICON_POSITION_KEY],
      );
    } catch {
      chatOsCustomIcons = {};
      chatOsIconPosition = "after";
    }
    CHAT_OS_TYPES.forEach((type) => reflectChatOsCustomRow(type));
    reflectChatOsPosition();
    reflectChatOsAvailability();
  })();

  chatOsPositionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      chatOsIconPosition = normalizeChatOsIconPosition(
        button.dataset.chatOsPositionValue,
      );
      reflectChatOsPosition();
      cachedStorageSet({
        [CHAT_OS_ICON_POSITION_KEY]: chatOsIconPosition,
      });
    });
  });
  chatOsCustomInputs.forEach((input, type) => {
    input?.addEventListener("input", () => {
      clearTimeout(chatOsSaveTimers.get(type));
      chatOsSaveTimers.set(
        type,
        window.setTimeout(() => {
          chatOsSaveTimers.delete(type);
          commitChatOsCustomInput(type);
        }, 180),
      );
    });
    input?.addEventListener("change", () => {
      clearTimeout(chatOsSaveTimers.get(type));
      chatOsSaveTimers.delete(type);
      commitChatOsCustomInput(type, true);
    });
  });
  chatOsImageButtons.forEach((button, type) => {
    button?.addEventListener("click", () =>
      chatOsImageInputs.get(type)?.click(),
    );
  });
  chatOsImageInputs.forEach((input, type) => {
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      clearTimeout(chatOsSaveTimers.get(type));
      chatOsSaveTimers.delete(type);
      const job = Symbol(type);
      chatOsImageJobs.set(type, job);
      const message = chatOsCustomMessages.get(type);
      if (message) {
        message.textContent = "이미지를 변환하고 있습니다...";
        message.classList.remove("is-error");
      }
      try {
        const data = await encodeChatOsImage(file);
        if (chatOsImageJobs.get(type) !== job) return;
        chatOsCustomIcons[type] = { type: "image", data };
        saveChatOsCustomIcons();
        reflectChatOsCustomRow(type);
        reflectChatOsAvailability();
      } catch (error) {
        if (chatOsImageJobs.get(type) !== job) return;
        if (message) {
          message.textContent =
            error?.message || "이미지를 불러오지 못했습니다.";
          message.classList.add("is-error");
        }
      } finally {
        if (chatOsImageJobs.get(type) === job) chatOsImageJobs.delete(type);
      }
    });
  });
  chatOsCustomResets.forEach((reset, type) => {
    reset?.addEventListener("click", () => {
      clearTimeout(chatOsSaveTimers.get(type));
      chatOsSaveTimers.delete(type);
      delete chatOsCustomIcons[type];
      saveChatOsCustomIcons();
      reflectChatOsCustomRow(type);
      reflectChatOsAvailability();
    });
  });
  chatShowOsIconInput?.addEventListener("change", reflectChatOsAvailability);

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
    chatTimeMoaLocked = locked.has("chatShowTime");
    reflectChatTimeFormatAvailability();
    if (chatTimeFormatItem) {
      if (chatTimeMoaLocked) {
        chatTimeFormatItem.setAttribute(
          "title",
          "배지 모아 챗이 이 기능을 제어 중입니다",
        );
      } else {
        chatTimeFormatItem.removeAttribute("title");
      }
    }
    if (chatTimeColorItem) {
      if (chatTimeMoaLocked) {
        chatTimeColorItem.setAttribute(
          "title",
          "배지 모아 챗이 이 기능을 제어 중입니다",
        );
      } else {
        chatTimeColorItem.removeAttribute("title");
      }
    }
    reflectChatOsAvailability();
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
        headerStudioInput.checked =
          d?.[FEATURE_HIDDEN_KEY]?.headerStudio === true;
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

  // ── '항상 켜기' 제외 채널 목록(오디오 믹서 / 비디오 필터 공용) ────────────
  // 패널에서 직접 끈 채널은 per-channel 저장값에 userDisabled=true 로 남는다
  // (키: audioMixer:<채널해시> / videoFilter:<채널해시>). 그 채널들을 모아 보여
  // 주고, 여기서 해제하면 다시 '항상 켜기' 대상이 된다.
  function setupAlwaysOnExcludeList({ kind, prefix, label }) {
    const list = document.querySelector(`[data-${kind}-exclude-list]`);
    const item = document.querySelector(`[data-${kind}-exclude-item]`);
    if (!list) return;
    const HASH_RE = /^[0-9a-f]{32}$/i;
    const nameCache = new Map();

    async function fetchChannelName(hash) {
      if (nameCache.has(hash)) return nameCache.get(hash);
      let info = { name: "", imageUrl: "" };
      try {
        const res = await fetch(
          `https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(hash)}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const content = (await res.json())?.content;
          info = {
            name: String(content?.channelName || ""),
            imageUrl: String(content?.channelImageUrl || ""),
          };
        }
      } catch {}
      nameCache.set(hash, info);
      return info;
    }

    async function excludedChannels() {
      // 채팅 리캡처럼 큰 사용자 데이터까지 값으로 읽지 않도록, 지원되는 브라우저에서는
      // 먼저 키만 확인한 뒤 채널 설정만 가져온다. getKeys 미지원 환경만 전체 조회로 폴백한다.
      if (typeof chrome.storage.local.getKeys === "function") {
        const keys = (await chrome.storage.local.getKeys()).filter((key) => {
          if (!key.startsWith(prefix)) return false;
          return HASH_RE.test(key.slice(prefix.length));
        });
        if (!keys.length) return [];
        const stored = await chrome.storage.local.get(keys);
        return keys
          .filter((key) => stored?.[key]?.userDisabled === true)
          .map((key) => key.slice(prefix.length));
      }

      const all = await chrome.storage.local.get(null);
      return Object.entries(all)
        .filter(([key, value]) => {
          if (!key.startsWith(prefix)) return false;
          const hash = key.slice(prefix.length);
          return HASH_RE.test(hash) && value?.userDisabled === true;
        })
        .map(([key]) => key.slice(prefix.length));
    }

    async function unexclude(hash) {
      const key = `${prefix}${hash}`;
      try {
        const stored = (await chrome.storage.local.get(key))?.[key];
        if (!stored || typeof stored !== "object") return;
        await chrome.storage.local.set({
          [key]: { ...stored, userDisabled: false },
        });
      } catch {}
    }

    async function render() {
      let hashes = [];
      try {
        hashes = await excludedChannels();
      } catch {}
      // 목록이 비면 항목 자체를 감춰 설정 화면을 어지럽히지 않는다.
      if (item) item.hidden = hashes.length === 0;
      list.textContent = "";
      if (!hashes.length) {
        const empty = document.createElement("p");
        empty.className = "settings-exclude-empty";
        empty.textContent = "제외된 채널이 없습니다.";
        list.append(empty);
        return;
      }
      // 이름은 뒤늦게 채운다(먼저 행을 그려 두고 조회되는 대로 교체).
      const rows = new Map();
      for (const hash of hashes) {
        const row = document.createElement("div");
        row.className = "settings-exclude-row";
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.hidden = true;
        const name = document.createElement("span");
        name.className = "settings-exclude-name";
        name.textContent = `${hash.slice(0, 8)}…`;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "제외 해제";
        button.addEventListener("click", async () => {
          button.disabled = true;
          await unexclude(hash);
          await render();
        });
        row.append(img, name, button);
        list.append(row);
        rows.set(hash, { img, name });
      }
      // ⚠ 채널 수가 많으면 한 번에 다 요청하지 않는다(동시 6개 워커 풀).
      const CONCURRENCY = 6;
      let cursor = 0;
      const worker = async () => {
        while (cursor < hashes.length) {
          const hash = hashes[cursor++];
          const info = await fetchChannelName(hash);
          const row = rows.get(hash);
          if (!row) continue;
          if (info.name) row.name.textContent = info.name;
          if (info.imageUrl) {
            row.img.src = info.imageUrl;
            row.img.hidden = false;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, hashes.length) }, worker),
      );
    }

    void render();
    // 플레이어에서 끄거나 켜면 즉시 반영한다.
    let renderTimer = 0;
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      const changed = Object.entries(changes).some(([key, value]) => {
        if (!key.startsWith(prefix)) return false;
        const hash = key.slice(prefix.length);
        if (!HASH_RE.test(hash)) return false;
        return (
          value?.oldValue?.userDisabled !== value?.newValue?.userDisabled
        );
      });
      if (!changed) return;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => void render(), 100);
    });
    return { render, label };
  }

  setupAlwaysOnExcludeList({
    kind: "mixer",
    prefix: "audioMixer:",
    label: "오디오 믹서",
  });
  setupAlwaysOnExcludeList({
    kind: "video-filter",
    prefix: "videoFilter:",
    label: "비디오 필터",
  });

  // ── 오디오 믹서 전역 기본값(채널 무관) ────────────────────────────────────
  const AUDIO_MIXER_PRESETS_KEY = "audioMixer:presets";
  const AUDIO_MIXER_GLOBAL_DEFAULT_KEY = "audioMixer:globalDefault";
  const CLIP_AUDIO_MIXER_ENABLED_KEY = "cheeseClipAudioMixerEnabled";
  const CLIP_AUDIO_MIXER_ALWAYS_ON_KEY = "cheeseClipAudioMixerAlwaysOn";
  const CLIP_AUDIO_MIXER_PRESET_KEY = "cheeseClipAudioMixerPreset";
  const CLIP_VIDEO_FILTER_ENABLED_KEY = "cheeseClipVideoFilterEnabled";
  const CLIP_VIDEO_FILTER_ALWAYS_ON_KEY = "cheeseClipVideoFilterAlwaysOn";
  const CLIP_VIDEO_FILTER_PRESET_KEY = "cheeseClipVideoFilterPreset";
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
    ["beginner", "화질 향상"],
    ["fps", "FPS 게임"],
    ["moba", "롤·AOS"],
    ["game", "게임 일반"],
    ["horror", "공포 게임"],
    ["outdoor", "야외방송"],
    ["sports", "스포츠"],
    ["food", "먹방·쿡방"],
    ["cam", "캠방송"],
    ["vtuber", "버츄얼"],
    ["anime", "애니·2D"],
    ["night", "야간 시청"],
    ["cinema", "시네마틱"],
  ];
  const mixerGlobalDefaultEnabledInput = document.querySelector(
    "[data-mixer-global-default-enabled]",
  );
  const videoFilterGlobalDefaultEnabledInput = document.querySelector(
    "[data-video-filter-global-default-enabled]",
  );
  const clipAudioMixerAlwaysOnInput = document.querySelector(
    "[data-clip-audio-mixer-always-on]",
  );
  const clipAudioMixerEnabledInput = document.querySelector(
    "[data-clip-audio-mixer-enabled]",
  );
  const clipVideoFilterAlwaysOnInput = document.querySelector(
    "[data-clip-video-filter-always-on]",
  );
  const clipVideoFilterEnabledInput = document.querySelector(
    "[data-clip-video-filter-enabled]",
  );
  let mixerCustomPresets = [];
  let mixerGlobalDefault = { enabled: false, preset: "default" };
  let videoFilterCustomPresets = [];
  let videoFilterGlobalDefault = { enabled: false, preset: "default" };
  let clipAudioMixerPreset = { enabled: true, preset: "default" };
  let clipVideoFilterPreset = { enabled: true, preset: "beginner" };
  const GLOBAL_DEFAULT_PICKER_TYPES = ["audio", "video", "clip", "clip-video"];

  function normalizeGlobalDefaultConfig(value) {
    const cfg = value && typeof value === "object" ? value : {};
    return {
      enabled: cfg.enabled === true,
      preset: String(cfg.preset || "default"),
    };
  }

  function globalDefaultConfig(type) {
    if (type === "clip") return clipAudioMixerPreset;
    if (type === "clip-video") return clipVideoFilterPreset;
    return type === "video" ? videoFilterGlobalDefault : mixerGlobalDefault;
  }

  function globalDefaultBuiltIns(type) {
    return type === "video" || type === "clip-video"
      ? VIDEO_FILTER_BUILT_IN_PRESETS
      : MIXER_BUILT_IN_PRESETS;
  }

  function globalDefaultCustoms(type) {
    return type === "video" || type === "clip-video"
      ? videoFilterCustomPresets
      : mixerCustomPresets;
  }

  function globalDefaultStorageKey(type) {
    if (type === "clip") return CLIP_AUDIO_MIXER_PRESET_KEY;
    if (type === "clip-video") return CLIP_VIDEO_FILTER_PRESET_KEY;
    return type === "video"
      ? VIDEO_FILTER_GLOBAL_DEFAULT_KEY
      : AUDIO_MIXER_GLOBAL_DEFAULT_KEY;
  }

  function globalDefaultEnabledInput(type) {
    if (type === "clip" || type === "clip-video") return null;
    return type === "video"
      ? videoFilterGlobalDefaultEnabledInput
      : mixerGlobalDefaultEnabledInput;
  }

  function globalDefaultFallback(type) {
    return type === "clip-video"
      ? "beginner"
      : globalDefaultBuiltIns(type)[0][0];
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
    const fallback = globalDefaultBuiltIns(type).find(
      ([key]) => key === globalDefaultFallback(type),
    );
    return custom?.name || fallback?.[1] || globalDefaultBuiltIns(type)[0][1];
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
    GLOBAL_DEFAULT_PICKER_TYPES.forEach((type) => {
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
    list.style.maxHeight = `${Math.max(
      140,
      window.innerHeight - rect.bottom - 16,
    )}px`;
  }

  function renderGlobalDefaultPicker(type) {
    const root = globalDefaultRoot(type);
    if (!root) return;
    const config = globalDefaultConfig(type);
    const fallback = globalDefaultFallback(type);
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
    const isClipPicker = type === "clip" || type === "clip-video";
    if (trigger) trigger.disabled = !isClipPicker && !config.enabled;
    if (!isClipPicker && !config.enabled) closeGlobalDefaultPicker(type);
    renderGlobalDefaultPicker(type);
  }

  function saveGlobalDefault(type) {
    const config = globalDefaultConfig(type);
    const isClipPicker = type === "clip" || type === "clip-video";
    config.enabled = isClipPicker
      ? true
      : globalDefaultEnabledInput(type)?.checked === true;
    // preset은 이미 config.preset에 반영돼 있다(옵션 클릭/로드 시 설정). 트리거의
    // data-value는 render 이후에야 갱신되므로 여기서 읽으면 '이전 선택값'으로
    // 덮어써 방금 고른 프리셋이 무시된다 → config.preset을 신뢰한다.
    config.preset = config.preset || "default";
    renderGlobalDefaultPicker(type);
    syncGlobalDefaultUI(type);
    try {
      cachedStorageSet({
        [globalDefaultStorageKey(type)]: isClipPicker
          ? config.preset
          : { ...config },
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

  GLOBAL_DEFAULT_PICKER_TYPES.forEach((type) => {
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

  clipAudioMixerAlwaysOnInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CLIP_AUDIO_MIXER_ALWAYS_ON_KEY]:
          clipAudioMixerAlwaysOnInput.checked === true,
      });
    } catch {}
  });

  clipAudioMixerEnabledInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CLIP_AUDIO_MIXER_ENABLED_KEY]:
          clipAudioMixerEnabledInput.checked === true,
      });
    } catch {}
  });

  clipVideoFilterAlwaysOnInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CLIP_VIDEO_FILTER_ALWAYS_ON_KEY]:
          clipVideoFilterAlwaysOnInput.checked === true,
      });
    } catch {}
  });

  clipVideoFilterEnabledInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CLIP_VIDEO_FILTER_ENABLED_KEY]:
          clipVideoFilterEnabledInput.checked === true,
      });
    } catch {}
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-global-default-picker]")) return;
    closeAllGlobalDefaultPickers();
  });
  window.addEventListener("resize", () => closeAllGlobalDefaultPickers());
  panelsScroll?.addEventListener("scroll", () =>
    closeAllGlobalDefaultPickers(),
  );

  async function loadGlobalDefaults() {
    try {
      const data = await cachedStorageGet([
        AUDIO_MIXER_PRESETS_KEY,
        AUDIO_MIXER_GLOBAL_DEFAULT_KEY,
        CLIP_AUDIO_MIXER_ENABLED_KEY,
        CLIP_AUDIO_MIXER_ALWAYS_ON_KEY,
        CLIP_AUDIO_MIXER_PRESET_KEY,
        CLIP_VIDEO_FILTER_ENABLED_KEY,
        CLIP_VIDEO_FILTER_ALWAYS_ON_KEY,
        CLIP_VIDEO_FILTER_PRESET_KEY,
        VIDEO_FILTER_PRESETS_KEY,
        VIDEO_FILTER_GLOBAL_DEFAULT_KEY,
      ]);
      mixerCustomPresets = Array.isArray(data?.[AUDIO_MIXER_PRESETS_KEY])
        ? data[AUDIO_MIXER_PRESETS_KEY]
        : [];
      mixerGlobalDefault = normalizeGlobalDefaultConfig(
        data?.[AUDIO_MIXER_GLOBAL_DEFAULT_KEY],
      );
      clipAudioMixerPreset = {
        enabled: true,
        preset: String(data?.[CLIP_AUDIO_MIXER_PRESET_KEY] || "default"),
      };
      clipVideoFilterPreset = {
        enabled: true,
        preset: String(data?.[CLIP_VIDEO_FILTER_PRESET_KEY] || "beginner"),
      };
      if (clipAudioMixerEnabledInput) {
        clipAudioMixerEnabledInput.checked =
          data?.[CLIP_AUDIO_MIXER_ENABLED_KEY] !== false;
      }
      if (clipAudioMixerAlwaysOnInput) {
        clipAudioMixerAlwaysOnInput.checked =
          data?.[CLIP_AUDIO_MIXER_ALWAYS_ON_KEY] === true;
      }
      if (clipVideoFilterEnabledInput) {
        clipVideoFilterEnabledInput.checked =
          data?.[CLIP_VIDEO_FILTER_ENABLED_KEY] !== false;
      }
      if (clipVideoFilterAlwaysOnInput) {
        clipVideoFilterAlwaysOnInput.checked =
          data?.[CLIP_VIDEO_FILTER_ALWAYS_ON_KEY] === true;
      }
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
      clipAudioMixerPreset = { enabled: true, preset: "default" };
      clipVideoFilterPreset = { enabled: true, preset: "beginner" };
      if (clipAudioMixerEnabledInput) {
        clipAudioMixerEnabledInput.checked = true;
      }
      if (clipAudioMixerAlwaysOnInput) {
        clipAudioMixerAlwaysOnInput.checked = false;
      }
      if (clipVideoFilterEnabledInput) {
        clipVideoFilterEnabledInput.checked = true;
      }
      if (clipVideoFilterAlwaysOnInput) {
        clipVideoFilterAlwaysOnInput.checked = false;
      }
    }
    syncGlobalDefaultUI("audio");
    syncGlobalDefaultUI("video");
    syncGlobalDefaultUI("clip");
    syncGlobalDefaultUI("clip-video");
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
      const data = await cachedStorageGet(VIDEO_FILTER_ALWAYS_ON_KEY);
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
    // 체크 상태가 정해진 뒤 하위 항목(위치) 잠금을 다시 평가한다.
    reflectLsbAvailability();
  }
  liveSeekBarInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [LIVE_SEEK_BAR_KEY]: liveSeekBarInput.checked,
      });
    } catch {}
  });
  loadLiveSeekBar();

  // ── 채팅 단어·정규식 필터 ─────────────────────────────────────────────────
  // 저장 형태: [{ pattern, regex }]. 정규식은 추가 시점에 컴파일해 검증한다.
  // ── 클립 보관함 개수 ──────────────────────────────────────────────────────
  const CLIP_VAULT_LIMIT_KEY = "cheeseClipVaultLimit";
  const CLIP_VAULT_KEY = "cheeseClipVault";
  const CLIP_VAULT_ACCOUNT_KEY_PREFIX = "cheeseClipVault:";
  const CLIP_VAULT_ACCOUNT_IDS_KEY = "cheeseClipVaultAccountIds";
  const CLIP_VAULT_ACTIVE_ACCOUNT_KEY = "cheeseClipVaultActiveAccount";
  const CV_LIMIT_DEFAULT = 500;
  const CV_LIMIT_MIN = 50;
  const CV_LIMIT_MAX = 100000;
  const CV_LARGE_LIMIT_NOTICE = 20000;
  const CV_LIMIT_CAUTION_RATIO = 0.8;
  const cvNum = document.querySelector("[data-clip-vault-limit]");
  const cvReset = document.querySelector("[data-clip-vault-limit-reset]");
  const cvUsage = document.querySelector("[data-clip-vault-limit-usage]");
  const cvWarning = document.querySelector("[data-clip-vault-limit-warning]");
  let cvCurrentVault = null;
  let cvCurrentAccountId = "";

  function normalizeCvAccountId(value) {
    const id = String(value || "")
      .trim()
      .toLowerCase();
    return /^[0-9a-f]{32}$/.test(id) ? id : "";
  }

  function cvAccountStorageKey(accountId = cvCurrentAccountId) {
    const id = normalizeCvAccountId(accountId);
    return id ? `${CLIP_VAULT_ACCOUNT_KEY_PREFIX}${id}` : "";
  }

  function normalizeCvLimit(value) {
    if (value == null || value === "") return CV_LIMIT_DEFAULT;
    const n = Math.round(Number(String(value).replaceAll(",", "").trim()));
    if (!Number.isFinite(n)) return CV_LIMIT_DEFAULT;
    return Math.min(CV_LIMIT_MAX, Math.max(CV_LIMIT_MIN, n));
  }

  function setCvLimitInputValue(value) {
    if (!cvNum) return;
    cvNum.value = formatCvCount(value);
  }

  function formatCvLimitInput(value, selectionStart) {
    const raw = String(value ?? "").replace(/[^0-9]/g, "");
    if (!raw) return { value: "", selectionStart: 0 };
    const formatted = formatCvCount(raw);
    if (!Number.isInteger(selectionStart)) {
      return { value: formatted, selectionStart: formatted.length };
    }
    const digitsBeforeCursor = String(value)
      .slice(0, selectionStart)
      .replace(/[^0-9]/g, "").length;
    let cursor = 0;
    let digitsSeen = 0;
    while (cursor < formatted.length && digitsSeen < digitsBeforeCursor) {
      if (/\d/.test(formatted[cursor])) digitsSeen += 1;
      cursor += 1;
    }
    return { value: formatted, selectionStart: cursor };
  }

  function reflectCvAvailability() {
    const off =
      document.querySelector('[data-feature="clipVault"]')?.checked !== true;
    [cvNum, cvReset].forEach((el) => {
      if (el) el.disabled = off;
    });
    cvNum?.closest(".settings-item")?.classList.toggle("is-locked", off);
  }

  function clipVaultKindCount(vault, kind) {
    return Array.isArray(vault?.[kind]) ? vault[kind].length : 0;
  }

  function formatCvCount(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("ko-KR");
  }

  function updateCvLimitStatus(limit, vault) {
    const favCount = clipVaultKindCount(vault, "fav");
    const likeCount = clipVaultKindCount(vault, "like");
    const usage = `현재 사용량 · 즐겨찾기 ${formatCvCount(favCount)} / ${formatCvCount(limit)}개 · 기록된 좋아요 ${formatCvCount(likeCount)} / ${formatCvCount(limit)}개`;
    if (cvUsage) cvUsage.textContent = usage;
    if (!cvWarning) return;

    const fullKinds = [];
    const cautionKinds = [];
    [
      ["즐겨찾기", favCount],
      ["기록된 좋아요", likeCount],
    ].forEach(([label, count]) => {
      if (count >= limit) fullKinds.push(label);
      else if (count >= Math.ceil(limit * CV_LIMIT_CAUTION_RATIO)) {
        cautionKinds.push(label);
      }
    });

    let text = "";
    let level = "notice";
    if (fullKinds.length) {
      text = `${fullKinds.join("·")} 보관함이 설정한 최대 개수에 도달했습니다. 이후 추가되는 클립은 가장 오래된 항목부터 교체됩니다.`;
      level = "danger";
    } else if (cautionKinds.length) {
      text = `${cautionKinds.join("·")} 보관함이 최대 개수의 80% 이상입니다. 상한에 도달하면 새 항목을 위해 오래된 항목이 교체됩니다.`;
      level = "warning";
    } else if (limit >= CV_LARGE_LIMIT_NOTICE) {
      text = `20,000개 이상 보관하면 보관함 열기, 검색·정렬, 좋아요 가져오기와 설정 내보내기에 시간이 더 걸릴 수 있습니다.`;
    }
    cvWarning.hidden = !text;
    cvWarning.dataset.level = level;
    cvWarning.textContent = text;
  }

  function saveCvLimit(value) {
    const v = normalizeCvLimit(value);
    setCvLimitInputValue(v);
    updateCvLimitStatus(v, cvCurrentVault);
    try {
      cachedStorageSet({ [CLIP_VAULT_LIMIT_KEY]: v });
    } catch {}
  }

  cvNum?.addEventListener("input", () => {
    const next = formatCvLimitInput(cvNum.value, cvNum.selectionStart);
    cvNum.value = next.value;
    cvNum.setSelectionRange(next.selectionStart, next.selectionStart);
  });
  cvNum?.addEventListener("change", () => saveCvLimit(cvNum.value));
  cvReset?.addEventListener("click", () => saveCvLimit(CV_LIMIT_DEFAULT));
  document
    .querySelector('[data-feature="clipVault"]')
    ?.addEventListener("change", reflectCvAvailability);
  async function loadCvVaultUsage() {
    let limit = CV_LIMIT_DEFAULT;
    let vault = null;
    try {
      const data = await cachedStorageGet([
        CLIP_VAULT_LIMIT_KEY,
        CLIP_VAULT_ACTIVE_ACCOUNT_KEY,
      ]);
      limit = data?.[CLIP_VAULT_LIMIT_KEY];
      cvCurrentAccountId = normalizeCvAccountId(
        data?.[CLIP_VAULT_ACTIVE_ACCOUNT_KEY],
      );
      const accountKey = cvAccountStorageKey();
      if (accountKey) {
        const accountData = await chrome.storage.local.get(accountKey);
        vault = accountData?.[accountKey] || null;
      }
      if (!vault) {
        const legacyData = await chrome.storage.local.get(CLIP_VAULT_KEY);
        vault = legacyData?.[CLIP_VAULT_KEY] || null;
      }
    } catch {}
    cvCurrentVault = vault;
    const normalizedLimit = normalizeCvLimit(limit);
    setCvLimitInputValue(normalizedLimit);
    updateCvLimitStatus(normalizedLimit, vault);
    reflectCvAvailability();
  }
  void loadCvVaultUsage();
  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      const currentAccountKey = cvAccountStorageKey();
      if (
        area !== "local" ||
        (!changes[CLIP_VAULT_KEY] &&
          !changes[CLIP_VAULT_LIMIT_KEY] &&
          !changes[CLIP_VAULT_ACTIVE_ACCOUNT_KEY] &&
          !(currentAccountKey && changes[currentAccountKey]))
      ) {
        return;
      }
      if (changes[CLIP_VAULT_ACTIVE_ACCOUNT_KEY]) {
        void loadCvVaultUsage();
        return;
      }
      const limit = normalizeCvLimit(
        changes[CLIP_VAULT_LIMIT_KEY]?.newValue ??
          storageCacheData?.[CLIP_VAULT_LIMIT_KEY],
      );
      setCvLimitInputValue(limit);
      if (currentAccountKey && changes[currentAccountKey]) {
        cvCurrentVault = changes[currentAccountKey].newValue || null;
      } else if (changes[CLIP_VAULT_KEY]?.newValue !== undefined) {
        cvCurrentVault = changes[CLIP_VAULT_KEY].newValue;
      }
      updateCvLimitStatus(limit, cvCurrentVault);
    });
  } catch {}

  const CHAT_WORD_FILTER_KEY = "cheeseChatWordFilters";
  const CWF_MAX = 200;
  let chatWordFilters = [];
  const cwfInput = document.querySelector("[data-cwf-input]");
  const cwfRegex = document.querySelector("[data-cwf-regex]");
  const cwfAdd = document.querySelector("[data-cwf-add]");
  const cwfList = document.querySelector("[data-cwf-list]");
  const cwfError = document.querySelector("[data-cwf-error]");

  function cwfShowError(message) {
    if (!cwfError) return;
    cwfError.textContent = message || "";
    cwfError.hidden = !message;
  }

  function cwfRender() {
    if (!cwfList) return;
    if (!chatWordFilters.length) {
      cwfList.innerHTML = `<li class="settings-word-filter-empty">등록된 규칙이 없습니다.</li>`;
      return;
    }
    cwfList.innerHTML = chatWordFilters
      .map(
        (f, i) =>
          `<li class="settings-word-filter-item">` +
          `<span class="settings-word-filter-kind">${f.regex ? ".*" : "가나"}</span>` +
          `<span class="settings-word-filter-pattern">${escapeHtml(f.pattern)}</span>` +
          `<button type="button" data-cwf-remove="${i}" aria-label="삭제">×</button>` +
          `</li>`,
      )
      .join("");
  }

  function cwfSave() {
    try {
      cachedStorageSet({ [CHAT_WORD_FILTER_KEY]: chatWordFilters });
    } catch {}
  }

  function cwfAddCurrent() {
    const pattern = String(cwfInput?.value || "").trim();
    if (!pattern) return;
    const isRegex = cwfRegex?.checked === true;
    if (isRegex) {
      // 잘못된 정규식은 저장하지 않는다 — 런타임에서 조용히 무시되면 원인을 알기 어렵다.
      try {
        new RegExp(pattern);
      } catch (error) {
        cwfShowError(
          `정규식이 올바르지 않습니다: ${error instanceof Error ? error.message : error}`,
        );
        return;
      }
    }
    if (chatWordFilters.length >= CWF_MAX) {
      cwfShowError(`규칙은 최대 ${CWF_MAX}개까지 등록할 수 있습니다.`);
      return;
    }
    const dup = chatWordFilters.some(
      (f) => f.pattern === pattern && f.regex === isRegex,
    );
    if (dup) {
      cwfShowError("이미 등록된 규칙입니다.");
      return;
    }
    chatWordFilters.push({ pattern, regex: isRegex });
    cwfShowError("");
    if (cwfInput) cwfInput.value = "";
    cwfRender();
    cwfSave();
  }

  cwfAdd?.addEventListener("click", cwfAddCurrent);
  cwfInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    // ⚠ 한글 입력 중(조합 중)의 Enter 는 '글자 확정'이지 '추가'가 아니다. 이걸 거르지
    // 않으면 "ㅋㅋㅋ" 확정 Enter 로 한 번, 이어진 Enter 로 남은 조각이 또 추가된다.
    // keyCode 229 는 구형 브라우저·IME 폴백.
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    cwfAddCurrent();
  });
  cwfList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cwf-remove]");
    if (!btn) return;
    const i = Number(btn.dataset.cwfRemove);
    if (!Number.isInteger(i)) return;
    chatWordFilters.splice(i, 1);
    cwfShowError("");
    cwfRender();
    cwfSave();
  });
  (async () => {
    try {
      const data = await cachedStorageGet(CHAT_WORD_FILTER_KEY);
      const list = data?.[CHAT_WORD_FILTER_KEY];
      chatWordFilters = Array.isArray(list)
        ? list
            .map((f) => ({
              pattern: String(f?.pattern ?? "").trim(),
              regex: f?.regex === true,
            }))
            .filter((f) => f.pattern)
        : [];
    } catch {
      chatWordFilters = [];
    }
    cwfRender();
  })();

  // ── 되감기 바 위치(px, 기본 60) ───────────────────────────────────────────
  // 슬라이더와 숫자 입력이 같은 값을 공유한다. 되감기 바 표시가 꺼져 있으면 잠근다.
  const LIVE_SEEK_BAR_BOTTOM_KEY = "cheeseLiveSeekBarBottom";
  const LSB_BOTTOM_DEFAULT = 60;
  const LSB_BOTTOM_MIN = 35;
  const LSB_BOTTOM_MAX = 445;
  const lsbRange = document.querySelector("[data-live-seek-bar-bottom]");
  const lsbNum = document.querySelector("[data-live-seek-bar-bottom-num]");
  const lsbReset = document.querySelector("[data-live-seek-bar-bottom-reset]");
  const lsbItem = document.querySelector("[data-live-seek-bar-bottom-item]");

  function normalizeLsbBottom(value) {
    // ⚠ null/"" 은 Number() 가 0 으로 바꿔 버려 min(35)로 눌린다. 미설정은 기본값으로.
    if (value == null || value === "") return LSB_BOTTOM_DEFAULT;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return LSB_BOTTOM_DEFAULT;
    return Math.min(LSB_BOTTOM_MAX, Math.max(LSB_BOTTOM_MIN, n));
  }

  function reflectLsbBottom(value) {
    const v = normalizeLsbBottom(value);
    if (lsbRange) lsbRange.value = String(v);
    if (lsbNum) lsbNum.value = String(v);
  }

  // 되감기 바가 꺼져 있으면 위치를 바꿀 이유가 없다 — 채팅 시간/형식과 같은 방식.
  function reflectLsbAvailability() {
    // ⚠ loadLiveSeekBar()(위쪽)도 이 함수를 부른다. 그 시점엔 아래 const 들이 아직
    // 초기화 전일 수 있어(TDZ) 캡처 변수 대신 DOM 에서 직접 찾는다.
    const off =
      document.querySelector("[data-live-seek-bar]")?.checked !== true;
    [
      "[data-live-seek-bar-bottom]",
      "[data-live-seek-bar-bottom-num]",
      "[data-live-seek-bar-bottom-reset]",
    ].forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) el.disabled = off;
    });
    document
      .querySelector("[data-live-seek-bar-bottom-item]")
      ?.classList.toggle("is-locked", off);
  }

  function saveLsbBottom(value) {
    const v = normalizeLsbBottom(value);
    reflectLsbBottom(v);
    try {
      cachedStorageSet({ [LIVE_SEEK_BAR_BOTTOM_KEY]: v });
    } catch {}
  }

  lsbRange?.addEventListener("input", () => saveLsbBottom(lsbRange.value));
  lsbNum?.addEventListener("change", () => saveLsbBottom(lsbNum.value));
  lsbReset?.addEventListener("click", () => saveLsbBottom(LSB_BOTTOM_DEFAULT));
  liveSeekBarInput?.addEventListener("change", reflectLsbAvailability);
  (async () => {
    let v = LSB_BOTTOM_DEFAULT;
    try {
      const data = await cachedStorageGet(LIVE_SEEK_BAR_BOTTOM_KEY);
      if (data?.[LIVE_SEEK_BAR_BOTTOM_KEY] != null) {
        v = data[LIVE_SEEK_BAR_BOTTOM_KEY];
      }
    } catch {}
    reflectLsbBottom(v);
    reflectLsbAvailability();
  })();

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

  // ── 휠로 볼륨 조절(전역, 기본 OFF) ────────────────────────────────────────
  const WHEEL_VOLUME_KEY = "cheeseWheelVolume";
  const wheelVolumeInput = document.querySelector("[data-wheel-volume]");
  if (wheelVolumeInput) {
    (async () => {
      let on = false; // 기본 꺼짐
      try {
        const d = await cachedStorageGet(WHEEL_VOLUME_KEY);
        on = d?.[WHEEL_VOLUME_KEY] === true;
      } catch {}
      wheelVolumeInput.checked = on;
    })();
    wheelVolumeInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [WHEEL_VOLUME_KEY]: wheelVolumeInput.checked });
      } catch {}
    });
  }
  // 우클릭 중에만 휠 볼륨 조절(기본 OFF).
  const WHEEL_VOLUME_RIGHTCLICK_KEY = "cheeseWheelVolumeRightClick";
  const wheelVolumeRcInput = document.querySelector(
    "[data-wheel-volume-rightclick]",
  );
  if (wheelVolumeRcInput) {
    (async () => {
      let on = false;
      try {
        const d = await cachedStorageGet(WHEEL_VOLUME_RIGHTCLICK_KEY);
        on = d?.[WHEEL_VOLUME_RIGHTCLICK_KEY] === true;
      } catch {}
      wheelVolumeRcInput.checked = on;
    })();
    wheelVolumeRcInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [WHEEL_VOLUME_RIGHTCLICK_KEY]: wheelVolumeRcInput.checked,
        });
      } catch {}
    });
  }
  // 조작 화면 피드백 오버레이(전역, 기본 ON).
  const ACTION_OVERLAY_KEY = "cheeseActionOverlay";
  const actionOverlayInput = document.querySelector("[data-action-overlay]");
  if (actionOverlayInput) {
    (async () => {
      let on = true; // 기본 켜짐
      try {
        const d = await cachedStorageGet(ACTION_OVERLAY_KEY);
        on = d?.[ACTION_OVERLAY_KEY] !== false;
      } catch {}
      actionOverlayInput.checked = on;
    })();
    actionOverlayInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [ACTION_OVERLAY_KEY]: actionOverlayInput.checked });
      } catch {}
    });
  }

  // ── 조작 OSD 종류별 표시/위치(볼륨/되감기/앞으로) ──────────────────────────
  const ACTION_OVERLAY_POS_KEY = "cheeseActionOverlayPos";
  const OSD_POS_DEFAULT = {
    volume: { on: true, x: 50, y: 50 },
    rewind: { on: true, x: 30, y: 50 },
    forward: { on: true, x: 70, y: 50 },
  };
  const osdPos = JSON.parse(JSON.stringify(OSD_POS_DEFAULT)); // 현재 상태(로드 후 갱신)
  const clampPct = (n) =>
    Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
  function saveOsdPos() {
    try {
      cachedStorageSet({ [ACTION_OVERLAY_POS_KEY]: osdPos });
    } catch {}
  }
  function reflectOsd(kind, axis) {
    const v = osdPos[kind][axis];
    const range = document.querySelector(`[data-osd="${kind}-${axis}"]`);
    const num = document.querySelector(`[data-osd-num="${kind}-${axis}"]`);
    if (range) range.value = String(v);
    if (num) num.value = String(v);
  }
  function bindOsdKind(kind) {
    // on/off 토글
    const onInput = document.querySelector(`[data-osd-on="${kind}"]`);
    if (onInput) {
      onInput.checked = osdPos[kind].on;
      onInput.addEventListener("change", () => {
        osdPos[kind].on = onInput.checked;
        saveOsdPos();
      });
    }
    // x/y 슬라이더 ↔ 숫자 동기화
    for (const axis of ["x", "y"]) {
      reflectOsd(kind, axis);
      const range = document.querySelector(`[data-osd="${kind}-${axis}"]`);
      const num = document.querySelector(`[data-osd-num="${kind}-${axis}"]`);
      const commit = (val) => {
        osdPos[kind][axis] = clampPct(val);
        reflectOsd(kind, axis);
        saveOsdPos();
      };
      range?.addEventListener("input", () => commit(range.value));
      num?.addEventListener("change", () => commit(num.value));
      num?.addEventListener("blur", () => commit(num.value));
    }
    // 초기화: 이 종류만 기본 위치(x/y)로 되돌린다(on/off 는 유지).
    const resetBtn = document.querySelector(`[data-osd-reset="${kind}"]`);
    resetBtn?.addEventListener("click", () => {
      osdPos[kind].x = OSD_POS_DEFAULT[kind].x;
      osdPos[kind].y = OSD_POS_DEFAULT[kind].y;
      reflectOsd(kind, "x");
      reflectOsd(kind, "y");
      saveOsdPos();
    });
  }
  (async () => {
    try {
      const d = await cachedStorageGet(ACTION_OVERLAY_POS_KEY);
      const saved = d?.[ACTION_OVERLAY_POS_KEY];
      if (saved && typeof saved === "object") {
        for (const kind of ["volume", "rewind", "forward"]) {
          const s = saved[kind];
          if (s && typeof s === "object") {
            if (typeof s.on === "boolean") osdPos[kind].on = s.on;
            if (Number.isFinite(Number(s.x))) osdPos[kind].x = clampPct(s.x);
            if (Number.isFinite(Number(s.y))) osdPos[kind].y = clampPct(s.y);
          }
        }
      }
    } catch {}
    ["volume", "rewind", "forward"].forEach(bindOsdKind);
  })();
  // 휠 볼륨 조절 간격(1~10%, 기본 5).
  const WHEEL_VOLUME_STEP_KEY = "cheeseWheelVolumeStep";
  const wheelVolumeStepInput = document.querySelector(
    "[data-wheel-volume-step]",
  );
  function clampWheelVolumeStep(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 5;
    return Math.min(10, Math.max(1, Math.round(n)));
  }
  if (wheelVolumeStepInput) {
    (async () => {
      try {
        const d = await cachedStorageGet(WHEEL_VOLUME_STEP_KEY);
        wheelVolumeStepInput.value = String(
          clampWheelVolumeStep(d?.[WHEEL_VOLUME_STEP_KEY] ?? 5),
        );
      } catch {
        wheelVolumeStepInput.value = "5";
      }
    })();
    const save = () => {
      const v = clampWheelVolumeStep(wheelVolumeStepInput.value);
      wheelVolumeStepInput.value = String(v); // 범위 밖 입력 보정
      try {
        cachedStorageSet({ [WHEEL_VOLUME_STEP_KEY]: v });
      } catch {}
    };
    wheelVolumeStepInput.addEventListener("change", save);
    wheelVolumeStepInput.addEventListener("blur", save);
  }

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

  // ── 팝업 플레이어(사이드바 채널 드래그 → 떠 있는 창) ──────────────────────
  const popupPlayerInput = document.querySelector("[data-popup-player]");
  if (popupPlayerInput) {
    const KEY = "cheesePopupPlayer";
    (async () => {
      let on = false; // 기본 OFF
      try {
        const d = await cachedStorageGet(KEY);
        on = d?.[KEY] === true;
      } catch {}
      popupPlayerInput.checked = on;
    })();
    popupPlayerInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [KEY]: popupPlayerInput.checked });
      } catch {}
    });
  }

  const popupPlayerAudioGroup = document.querySelector(
    "[data-popup-player-audio]",
  );
  if (popupPlayerAudioGroup) {
    const AUDIO_KEY = "cheesePopupPlayerAudio";
    const MODES = ["mute", "first", "all"];
    const audioButtons = Array.from(
      popupPlayerAudioGroup.querySelectorAll("[data-mode-value]"),
    );
    function reflectPopupAudio(mode) {
      const v = MODES.includes(mode) ? mode : "first";
      audioButtons.forEach((btn) => {
        const active = btn.dataset.modeValue === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    }
    (async () => {
      let mode = "first"; // 기본: 첫 팝업만 소리
      try {
        const d = await cachedStorageGet(AUDIO_KEY);
        if (MODES.includes(d?.[AUDIO_KEY])) mode = d[AUDIO_KEY];
      } catch {}
      reflectPopupAudio(mode);
    })();
    audioButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = MODES.includes(btn.dataset.modeValue)
          ? btn.dataset.modeValue
          : "first";
        reflectPopupAudio(mode);
        try {
          cachedStorageSet({ [AUDIO_KEY]: mode });
        } catch {}
      });
    });
  }

  const popupPlayerSizeGroup = document.querySelector(
    "[data-popup-player-size]",
  );
  if (popupPlayerSizeGroup) {
    const SIZE_KEY = "cheesePopupPlayerSize";
    const W_KEY = "cheesePopupPlayerSizeW";
    const H_KEY = "cheesePopupPlayerSizeH";
    const SIZES = ["400", "510", "640", "800", "custom"];
    const sizeButtons = Array.from(
      popupPlayerSizeGroup.querySelectorAll("[data-mode-value]"),
    );
    const customRow = document.querySelector("[data-popup-player-size-custom]");
    const wInput = document.querySelector("[data-popup-player-size-w]");
    const hInput = document.querySelector("[data-popup-player-size-h]");
    const clampPx = (v) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) return 510;
      return Math.min(2000, Math.max(240, n));
    };
    function reflectPopupSize(size) {
      const v = SIZES.includes(String(size)) ? String(size) : "510";
      sizeButtons.forEach((btn) => {
        const active = btn.dataset.modeValue === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
      // '직접 지정'일 때만 가로·세로 입력을 보여준다.
      if (customRow) customRow.hidden = v !== "custom";
    }
    (async () => {
      let size = "510";
      try {
        const d = await cachedStorageGet([SIZE_KEY, W_KEY, H_KEY]);
        if (SIZES.includes(String(d?.[SIZE_KEY]))) size = String(d[SIZE_KEY]);
        if (wInput) wInput.value = String(clampPx(d?.[W_KEY] ?? 510));
        if (hInput) hInput.value = String(clampPx(d?.[H_KEY] ?? 510));
      } catch {}
      reflectPopupSize(size);
    })();
    sizeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const size = SIZES.includes(btn.dataset.modeValue)
          ? btn.dataset.modeValue
          : "510";
        reflectPopupSize(size);
        try {
          cachedStorageSet({
            [SIZE_KEY]: size === "custom" ? "custom" : Number(size),
          });
        } catch {}
      });
    });
    const commitPx = (input, key) => {
      if (!input) return;
      const save = () => {
        const px = clampPx(input.value);
        input.value = String(px);
        try {
          cachedStorageSet({ [key]: px });
        } catch {}
      };
      input.addEventListener("change", save);
      input.addEventListener("blur", save);
    };
    commitPx(wInput, W_KEY);
    commitPx(hInput, H_KEY);
  }

  // 팝업 플레이어의 나머지 체크박스들. [셀렉터, 키, 기본 ON 여부].
  // 좁은 창을 고려해 자주 쓰는 버튼만 기본 ON, 나머지는 기본 OFF.
  [
    ["[data-player-disable-hidden]", "cheesePlayerDisableHidden", true],
    ["[data-popup-player-wide]", "cheesePopupPlayerWide", true],
    ["[data-popup-player-scroll]", "cheesePopupPlayerScroll", false],
    ["[data-popup-player-btn-mixer]", "cheesePopupPlayerBtnMixer", true],
    ["[data-popup-player-btn-filter]", "cheesePopupPlayerBtnFilter", true],
    ["[data-popup-player-btn-sync]", "cheesePopupPlayerBtnSync", true],
    ["[data-popup-player-seekbar]", "cheesePopupPlayerSeekBar", true],
    ["[data-popup-player-btn-stats]", "cheesePopupPlayerBtnStats", false],
    [
      "[data-popup-player-btn-screenshot]",
      "cheesePopupPlayerBtnScreenshot",
      false,
    ],
    ["[data-popup-player-btn-rewind]", "cheesePopupPlayerBtnRewind", false],
    ["[data-popup-player-btn-forward]", "cheesePopupPlayerBtnForward", false],
    ["[data-popup-player-maxq]", "cheesePopupPlayerMaxQuality", false],
    [
      "[data-popup-player-disable-hidden]",
      "cheesePopupPlayerDisableHidden",
      false,
    ],
  ].forEach(([sel, key, defaultOn]) => {
    const input = document.querySelector(sel);
    if (!input) return;
    (async () => {
      let on = defaultOn;
      try {
        const d = await cachedStorageGet(key);
        on = defaultOn ? d?.[key] !== false : d?.[key] === true;
      } catch {}
      input.checked = on;
    })();
    input.addEventListener("change", () => {
      try {
        cachedStorageSet({ [key]: input.checked });
      } catch {}
    });
  });

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

  // 플레이어 빠른 게인과 믹서 패널 게인 슬라이더의 공통 조절 간격(1~10%, 기본 5).
  const MIXER_GAIN_STEP_KEY = "cheeseMixerGainStep";
  const mixerGainStepInput = document.querySelector("[data-mixer-gain-step]");
  function clampMixerGainStep(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 5;
    return Math.min(10, Math.max(1, Math.round(n)));
  }
  if (mixerGainStepInput) {
    (async () => {
      try {
        const data = await cachedStorageGet(MIXER_GAIN_STEP_KEY);
        mixerGainStepInput.value = String(
          clampMixerGainStep(data?.[MIXER_GAIN_STEP_KEY] ?? 5),
        );
      } catch {
        mixerGainStepInput.value = "5";
      }
    })();
    const saveMixerGainStep = () => {
      const value = clampMixerGainStep(mixerGainStepInput.value);
      mixerGainStepInput.value = String(value);
      try {
        cachedStorageSet({ [MIXER_GAIN_STEP_KEY]: value });
      } catch {}
    };
    mixerGainStepInput.addEventListener("change", saveMixerGainStep);
    mixerGainStepInput.addEventListener("blur", saveMixerGainStep);
  }

  // 문자열 값 세그먼티드(정렬 기준 등). bindGainRangeSegmented의 문자열 버전.
  function bindStringSegmented(
    group,
    dataAttr,
    storageKey,
    allowed,
    def,
    onChange,
  ) {
    if (!group) return;
    const buttons = Array.from(group.querySelectorAll(`[data-${dataAttr}]`));
    const toKey = dataAttr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    function reflect(val) {
      const v = allowed.includes(val) ? val : def;
      buttons.forEach((btn) => {
        const active = btn.dataset[toKey] === v;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
      if (typeof onChange === "function") onChange(v);
    }
    (async () => {
      let v = def;
      try {
        const d = await cachedStorageGet(storageKey);
        const s = d?.[storageKey];
        if (allowed.includes(s)) v = s;
      } catch {}
      reflect(v);
    })();
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = btn.dataset[toKey];
        const val = allowed.includes(s) ? s : def;
        reflect(val);
        try {
          cachedStorageSet({ [storageKey]: val });
        } catch {}
      });
    });
  }
  bindStringSegmented(
    document.querySelector("[data-cf-sort]"),
    "cf-sort-value",
    "cheeseFollowCustomSort",
    ["popular", "recent", "oldest", "name-asc", "name-desc"],
    "popular",
  );
  // ── 전용 팔로잉 목록 배치 순서(그룹·즐겨찾기·팔로잉) ──────────────────────
  // 저장 형식은 기존 키(cheeseFollowGroupPlacement)의 문자열 그대로 둔다 — content.js 가
  // 그 값으로 순서를 찾는다. UI 만 '즐겨찾기 순서'와 같은 드래그 목록으로 바꾼다.
  const CF_SECTION_ORDER_KEY = "cheeseFollowGroupPlacement";
  const CF_SECTION_ORDERS = {
    "groups-first": ["groups", "favorites", "following"],
    "favorites-first": ["favorites", "groups", "following"],
    "groups-following-favorites": ["groups", "following", "favorites"],
    "favorites-following-groups": ["favorites", "following", "groups"],
    "following-first-groups": ["following", "groups", "favorites"],
    "following-first-favorites": ["following", "favorites", "groups"],
  };
  const CF_SECTION_LABELS = {
    groups: "그룹",
    favorites: "즐겨찾기",
    following: "팔로잉",
  };
  let cfSectionOrder = CF_SECTION_ORDERS["groups-first"];

  // 순서 배열 → 저장할 키. 6개 조합이 전부 정의돼 있어 항상 하나가 맞는다.
  function cfSectionOrderToKey(order) {
    const joined = order.join(",");
    return (
      Object.keys(CF_SECTION_ORDERS).find(
        (k) => CF_SECTION_ORDERS[k].join(",") === joined,
      ) || "groups-first"
    );
  }

  function renderCfSectionOrder() {
    const listEl = document.getElementById("cfSectionOrderList");
    if (!listEl) return;
    listEl.innerHTML = cfSectionOrder
      .map((key, i) => {
        const last = i === cfSectionOrder.length - 1;
        return (
          `<li class="cf-fav-order-item" draggable="true" data-id="${key}">` +
          `<span class="cf-fav-order-handle" aria-hidden="true">⋮⋮</span>` +
          `<span class="cf-fav-order-name">${CF_SECTION_LABELS[key]}</span>` +
          `<span class="cf-fav-order-btns">` +
          `<button type="button" class="cf-fav-order-up" data-dir="up" aria-label="위로" title="위로"${i === 0 ? " disabled" : ""}>↑</button>` +
          `<button type="button" class="cf-fav-order-down" data-dir="down" aria-label="아래로" title="아래로"${last ? " disabled" : ""}>↓</button>` +
          `</span></li>`
        );
      })
      .join("");
  }

  function saveCfSectionOrder() {
    try {
      cachedStorageSet({
        [CF_SECTION_ORDER_KEY]: cfSectionOrderToKey(cfSectionOrder),
      });
    } catch {}
  }

  function moveCfSection(key, dir) {
    const i = cfSectionOrder.indexOf(key);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= cfSectionOrder.length) return;
    const next = [...cfSectionOrder];
    [next[i], next[j]] = [next[j], next[i]];
    cfSectionOrder = next;
    renderCfSectionOrder();
    saveCfSectionOrder();
  }

  function setupCfSectionOrderEditor() {
    const listEl = document.getElementById("cfSectionOrderList");
    if (!listEl) return;
    listEl.addEventListener("click", (e) => {
      const btn = e.target.closest?.("button[data-dir]");
      if (!btn) return;
      const li = btn.closest(".cf-fav-order-item");
      if (li) moveCfSection(li.dataset.id, btn.dataset.dir);
    });
    // 드래그 정렬 — 즐겨찾기 순서 편집기와 같은 방식(실시간 insertBefore + drop 시 저장).
    let dragEl = null;
    const dragAfter = (y) => {
      const items = [
        ...listEl.querySelectorAll(
          ".cf-fav-order-item:not(.cf-fav-order-dragging)",
        ),
      ];
      let closest = { offset: -Infinity, el: null };
      for (const child of items) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          closest = { offset, el: child };
        }
      }
      return closest.el;
    };
    listEl.addEventListener("dragstart", (e) => {
      const li = e.target.closest?.(".cf-fav-order-item");
      if (!li) return;
      dragEl = li;
      e.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => li.classList.add("cf-fav-order-dragging"));
    });
    listEl.addEventListener("dragover", (e) => {
      if (!dragEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const after = dragAfter(e.clientY);
      if (after == null) listEl.appendChild(dragEl);
      else if (after !== dragEl) listEl.insertBefore(dragEl, after);
    });
    // ⚠ 저장은 drop 이 아니라 dragend 에서 한다. dragover 가 DOM 을 실시간으로 옮기므로
    // 목록은 이미 새 순서인데, 커서를 항목 사이 여백이나 목록 밖에서 놓으면 drop 이
    // 발생하지 않아 저장만 건너뛴다 → 화면과 저장값이 어긋난다(제보).
    // dragend 는 취소(ESC)를 포함해 항상 발생하므로 여기서 현재 DOM 순서를 확정한다.
    const commitCfSectionOrder = () => {
      const next = [...listEl.querySelectorAll(".cf-fav-order-item")].map(
        (li) => li.dataset.id,
      );
      if (next.length !== cfSectionOrder.length) return;
      const changed = next.some((k, i) => k !== cfSectionOrder[i]);
      cfSectionOrder = next;
      renderCfSectionOrder(); // 화살표 비활성 상태 갱신
      if (changed) saveCfSectionOrder();
    };
    listEl.addEventListener("drop", (e) => {
      if (!dragEl) return;
      e.preventDefault(); // 브라우저 기본 동작(링크 열기 등)만 막는다
    });
    listEl.addEventListener("dragend", () => {
      dragEl?.classList.remove("cf-fav-order-dragging");
      dragEl = null;
      commitCfSectionOrder();
    });
  }

  (async () => {
    try {
      const data = await cachedStorageGet(CF_SECTION_ORDER_KEY);
      const stored = data?.[CF_SECTION_ORDER_KEY];
      cfSectionOrder =
        CF_SECTION_ORDERS[stored] || CF_SECTION_ORDERS["groups-first"];
    } catch {}
    renderCfSectionOrder();
    setupCfSectionOrderEditor();
  })();

  const cfTagGroupInput = document.querySelector(
    '[data-feature="sbFollowGroupTags"]',
  );
  const cfTagHideOfflineInput = document.querySelector(
    "[data-cf-group-tag-hide-offline]",
  );
  const CF_TAG_HIDE_OFFLINE_KEY = "cheeseFollowGroupTagHideOffline";
  const reflectCfTagHideOfflineAvailability = () => {
    if (!cfTagHideOfflineInput) return;
    const disabled = !cfTagGroupInput?.checked;
    cfTagHideOfflineInput.disabled = disabled;
    cfTagHideOfflineInput
      .closest(".settings-item")
      ?.classList.toggle("is-locked", disabled);
  };
  if (cfTagHideOfflineInput) {
    (async () => {
      let hideOffline = true;
      try {
        const data = await cachedStorageGet(CF_TAG_HIDE_OFFLINE_KEY);
        hideOffline = data?.[CF_TAG_HIDE_OFFLINE_KEY] !== false;
      } catch {}
      cfTagHideOfflineInput.checked = hideOffline;
      reflectCfTagHideOfflineAvailability();
    })();
    cfTagHideOfflineInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [CF_TAG_HIDE_OFFLINE_KEY]: cfTagHideOfflineInput.checked,
        });
      } catch {}
    });
  }
  cfTagGroupInput?.addEventListener(
    "change",
    reflectCfTagHideOfflineAvailability,
  );
  queueMicrotask(reflectCfTagHideOfflineAvailability);

  // 즐겨찾기 내 별도 정렬 기준 — 'custom' 이면 순서 편집 행을 노출한다.
  const cfFavOrderRow = document.getElementById("cfFavOrderRow");
  bindStringSegmented(
    document.querySelector("[data-cf-fav-sort]"),
    "cf-fav-sort-value",
    "cheeseFollowFavSortMode",
    ["popular", "recent", "oldest", "name-asc", "name-desc", "custom"],
    "popular",
    (val) => {
      if (cfFavOrderRow) cfFavOrderRow.hidden = val !== "custom";
      if (val === "custom") renderCfFavOrderList();
    },
  );
  // setupCfFavOrderEditor() 호출은 cfFavMeta/cfFavOrder(let) 선언 뒤로 옮겼다(TDZ 방지).

  // 전용 팔로잉 목록 초기/더보기 개수(숫자 입력, 1~200).
  function bindCustomFollowCount(selector, storageKey, def, max = 200) {
    const input = document.querySelector(selector);
    if (!input) return;
    const clamp = (n) => Math.min(max, Math.max(1, Math.round(n)));
    (async () => {
      let v = def;
      try {
        const d = await cachedStorageGet(storageKey);
        const n = Number(d?.[storageKey]);
        if (Number.isFinite(n)) v = clamp(n);
      } catch {}
      input.value = String(v);
    })();
    const commit = () => {
      const n = Number(input.value);
      const v = Number.isFinite(n) ? clamp(n) : def;
      input.value = String(v);
      try {
        cachedStorageSet({ [storageKey]: v });
      } catch {}
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  }
  bindCustomFollowCount("[data-cf-initial]", "cheeseFollowCustomInitial", 10);
  bindCustomFollowCount("[data-cf-more]", "cheeseFollowCustomMore", 20);
  bindCustomFollowCount("[data-cf-fav-initial]", "cheeseFollowFavInitial", 10);
  bindCustomFollowCount("[data-cf-fav-more]", "cheeseFollowFavMore", 10);
  bindCustomFollowCount(
    "[data-cf-group-initial]",
    "cheeseFollowGroupInitial",
    5,
    30,
  );
  bindCustomFollowCount("[data-cf-group-more]", "cheeseFollowGroupMore", 5, 30);

  // ── 즐겨찾기 커스텀 순서 편집기(설정 팝업) ──────────────────────────────
  // 저장키: cheeseFollowFavOrder(channelId 배열), cheeseFollowFavMeta({id,name,imageUrl}[]).
  // 사이드바 드래그와 같은 배열을 공유한다. 여기서 드래그/↑↓ 로 편집 → 저장 → content 반영.
  const CF_FAV_ORDER_KEY = "cheeseFollowFavOrder";
  const CF_FAV_META_KEY = "cheeseFollowFavMeta";
  let cfFavOrder = []; // channelId 순서
  let cfFavMeta = []; // {id,name,imageUrl}
  let cfFavDragId = "";

  // meta + order 를 합쳐, order 순서로 정렬된 {id,name,imageUrl} 배열을 만든다.
  function cfFavMerged() {
    const byId = new Map(cfFavMeta.map((m) => [String(m.id), m]));
    const ids = new Set(cfFavMeta.map((m) => String(m.id)));
    const ordered = cfFavOrder.filter((id) => ids.has(id));
    // order 에 없는 즐겨찾기(신규)는 뒤에 이름순으로 붙인다.
    const rest = cfFavMeta
      .map((m) => String(m.id))
      .filter((id) => !cfFavOrder.includes(id))
      .sort((a, b) =>
        (byId.get(a)?.name || "").localeCompare(byId.get(b)?.name || "", "ko"),
      );
    return [...ordered, ...rest].map((id) => byId.get(id) || { id, name: id });
  }

  function saveCfFavOrder(ids) {
    cfFavOrder = ids.slice();
    try {
      cachedStorageSet({ [CF_FAV_ORDER_KEY]: cfFavOrder });
    } catch {}
  }

  const cfEsc = (s) =>
    String(s == null ? "" : s).replace(
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
  function renderCfFavOrderList() {
    const listEl = document.getElementById("cfFavOrderList");
    if (!listEl) return;
    const merged = cfFavMerged();
    if (!merged.length) {
      listEl.innerHTML =
        '<li class="cf-fav-order-empty">즐겨찾기한 채널이 없습니다. 사이드바 목록에서 별표(★)로 지정하세요.</li>';
      return;
    }
    listEl.innerHTML = merged
      .map((m, i) => {
        const img = m.imageUrl
          ? `<img src="${cfEsc(m.imageUrl)}?type=f60_60_na" alt="" width="22" height="22">`
          : '<span class="cf-fav-order-noimg"></span>';
        return (
          `<li class="cf-fav-order-item" draggable="true" data-id="${cfEsc(m.id)}">` +
          `<span class="cf-fav-order-handle" aria-hidden="true">⋮⋮</span>` +
          img +
          `<span class="cf-fav-order-name">${cfEsc(m.name || m.id)}</span>` +
          `<span class="cf-fav-order-btns">` +
          `<button type="button" class="cf-fav-order-up" data-dir="up" aria-label="위로" title="위로"${i === 0 ? " disabled" : ""}>↑</button>` +
          `<button type="button" class="cf-fav-order-down" data-dir="down" aria-label="아래로" title="아래로"${i === merged.length - 1 ? " disabled" : ""}>↓</button>` +
          `</span>` +
          `</li>`
        );
      })
      .join("");
  }
  function moveCfFav(id, dir) {
    const ids = cfFavMerged().map((m) => String(m.id));
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = dir === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    saveCfFavOrder(ids);
    renderCfFavOrderList();
  }

  function setupCfFavOrderEditor() {
    const listEl = document.getElementById("cfFavOrderList");
    if (!listEl) return;
    (async () => {
      try {
        const d = await cachedStorageGet([CF_FAV_ORDER_KEY, CF_FAV_META_KEY]);
        cfFavOrder = Array.isArray(d?.[CF_FAV_ORDER_KEY])
          ? d[CF_FAV_ORDER_KEY].map(String)
          : [];
        cfFavMeta = Array.isArray(d?.[CF_FAV_META_KEY])
          ? d[CF_FAV_META_KEY]
          : [];
      } catch {}
      renderCfFavOrderList();
    })();
    // 다른 곳(사이드바 드래그/즐겨찾기 변경)에서 바뀌면 실시간 반영.
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[CF_FAV_ORDER_KEY])
          cfFavOrder = (changes[CF_FAV_ORDER_KEY].newValue || []).map(String);
        if (changes[CF_FAV_META_KEY])
          cfFavMeta = changes[CF_FAV_META_KEY].newValue || [];
        if (changes[CF_FAV_ORDER_KEY] || changes[CF_FAV_META_KEY])
          renderCfFavOrderList();
      });
    } catch {}
    // ↑↓ 버튼.
    listEl.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-dir]");
      if (!btn) return;
      const li = btn.closest(".cf-fav-order-item");
      if (li) moveCfFav(li.dataset.id, btn.dataset.dir);
    });
    // 드래그 정렬 — 플레이어 버튼 순서와 같은 방식: 드래그 중 실시간으로 DOM 을
    // insertBefore 이동(밀려나는 효과), drop 시 현재 DOM 순서를 읽어 저장한다. 상단 여백
    // 드롭도 after=null(맨 앞) 로 자연히 처리된다.
    let cfDragEl = null;
    // 커서 y 아래에 올 '기준 요소'(그 앞에 dragEl 삽입). 없으면 맨 끝(append).
    const cfDragAfter = (y) => {
      const items = [
        ...listEl.querySelectorAll(
          ".cf-fav-order-item:not(.cf-fav-order-dragging)",
        ),
      ];
      let closest = { offset: -Infinity, el: null };
      for (const child of items) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset)
          closest = { offset, el: child };
      }
      return closest.el;
    };
    listEl.addEventListener("dragstart", (e) => {
      const li = e.target.closest?.(".cf-fav-order-item");
      if (!li) return;
      cfDragEl = li;
      cfFavDragId = li.dataset.id || "";
      e.dataTransfer.effectAllowed = "move";
      // 클래스는 다음 프레임에(드래그 고스트 이미지가 반투명으로 캡처되지 않도록).
      requestAnimationFrame(() => li.classList.add("cf-fav-order-dragging"));
    });
    listEl.addEventListener("dragover", (e) => {
      if (!cfDragEl) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const after = cfDragAfter(e.clientY);
      if (after == null) listEl.appendChild(cfDragEl);
      else if (after !== cfDragEl) listEl.insertBefore(cfDragEl, after);
    });
    // ⚠ 배치 순서 편집기와 같은 이유로 dragend 에서 확정한다. drop 만 믿으면 항목 사이
    // 여백이나 목록 밖에서 놓았을 때 DOM 은 바뀐 채 저장이 누락된다.
    listEl.addEventListener("drop", (e) => {
      if (!cfDragEl) return;
      e.preventDefault();
    });
    listEl.addEventListener("dragend", () => {
      const dragging = !!cfDragEl;
      cfDragEl?.classList.remove("cf-fav-order-dragging");
      cfDragEl = null;
      cfFavDragId = "";
      if (!dragging) return;
      // 현재 DOM 순서를 즐겨찾기 순서로 저장(리렌더는 onChanged/명시 호출로).
      const ids = [...listEl.querySelectorAll(".cf-fav-order-item")].map(
        (li) => li.dataset.id,
      );
      saveCfFavOrder(ids);
      renderCfFavOrderList();
    });
  }
  // 상태 변수(let) 선언 이후에 호출해야 TDZ 에러가 나지 않는다.
  setupCfFavOrderEditor();

  // 전용 팔로잉 목록 자동 갱신 주기 — 끔/30/60/커스텀 세그먼티드(기존 팔로우 갱신과 동일).
  const CF_REFRESH_KEY = "cheeseFollowCustomRefreshSec";
  const CF_REFRESH_PRESETS = [0, 30, 60];
  const CF_REFRESH_CUSTOM_DEFAULT = 30;
  const cfRefreshButtons = Array.from(
    document.querySelectorAll("[data-cf-refresh]"),
  );
  const cfRefreshCustomRow = document.getElementById("cfRefreshCustomRow");
  const cfRefreshCustomSec = document.getElementById("cfRefreshCustomSec");
  if (cfRefreshButtons.length) {
    const clampCustom = (n, def) => {
      const v = Math.round(Number(n));
      return Number.isFinite(v) ? Math.min(600, Math.max(3, v)) : def;
    };
    function reflectCfRefresh(secRaw) {
      let sec = Number(secRaw);
      if (!Number.isFinite(sec) || sec <= 0) sec = 0;
      const activeKey =
        sec === 0
          ? "0"
          : CF_REFRESH_PRESETS.includes(sec)
            ? String(sec)
            : "custom";
      cfRefreshButtons.forEach((btn) => {
        const active = btn.dataset.cfRefresh === activeKey;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
      if (cfRefreshCustomRow)
        cfRefreshCustomRow.hidden = activeKey !== "custom";
    }
    function saveCfCustom() {
      const sec = clampCustom(
        cfRefreshCustomSec?.value,
        CF_REFRESH_CUSTOM_DEFAULT,
      );
      if (cfRefreshCustomSec) cfRefreshCustomSec.value = String(sec);
      try {
        cachedStorageSet({ [CF_REFRESH_KEY]: sec });
      } catch {}
    }
    (async () => {
      let sec = 0;
      try {
        const d = await cachedStorageGet(CF_REFRESH_KEY);
        if (d?.[CF_REFRESH_KEY] != null) sec = d[CF_REFRESH_KEY];
      } catch {}
      const n = Number(sec);
      const customInit =
        Number.isFinite(n) &&
        n >= 3 &&
        n <= 600 &&
        !CF_REFRESH_PRESETS.includes(n)
          ? Math.round(n)
          : CF_REFRESH_CUSTOM_DEFAULT;
      if (cfRefreshCustomSec) cfRefreshCustomSec.value = String(customInit);
      reflectCfRefresh(sec);
    })();
    cfRefreshButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.cfRefresh;
        if (key === "custom") {
          reflectCfRefresh(
            Number(cfRefreshCustomSec?.value) || CF_REFRESH_CUSTOM_DEFAULT,
          );
          saveCfCustom();
        } else {
          const sec = Number(key);
          reflectCfRefresh(sec);
          try {
            cachedStorageSet({ [CF_REFRESH_KEY]: sec });
          } catch {}
        }
      });
    });
    cfRefreshCustomSec?.addEventListener("change", saveCfCustom);
  }

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

  // ── 통나무파워 내역 보관 기간(7~3650일, 기본 90) ─────────────────────────
  // content.js 의 normalizeLogPowerLogDays 와 같은 범위를 쓴다. 값을 바꾸면
  // 다음 기록이 쌓일 때 그 기준으로 오래된 항목이 정리된다.
  // 0 = 제한 없음(content.js normalizeLogPowerLogDays 와 같은 약속).
  const LOG_DAYS_KEY = "cheeseLogPowerLogDays";
  const logDaysInput = document.querySelector("[data-log-days]");
  const logDaysOff = document.querySelector("[data-log-days-off]");
  const LOG_DAYS_LAST_KEY = "cheeseLogPowerLogDaysLast"; // 제한 없음 해제 시 되돌릴 값

  function clampLogDays(v) {
    // ⚠ Number("") 는 0 이라 그냥 clamp 하면 최소값(7일)이 된다. 칸을 비우고
    //   빠져나갔을 뿐인데 보관 기간이 확 줄면 기록이 대량으로 지워진다.
    if (v == null || String(v).trim() === "") return 90;
    const n = Number(v);
    if (!Number.isFinite(n)) return 90;
    return Math.min(3650, Math.max(7, Math.round(n)));
  }

  function reflectLogDays(days) {
    const off = days === 0;
    if (logDaysOff) logDaysOff.checked = off;
    if (logDaysInput) {
      // 제한 없음일 때는 숫자를 못 고치게 막는다(0 을 보여 주면 헷갈린다).
      logDaysInput.disabled = off;
      logDaysInput.closest(".settings-item")?.classList.toggle("is-off", off);
    }
  }

  if (logDaysInput || logDaysOff) {
    (async () => {
      let days = 90;
      let last = 90;
      try {
        const d = await cachedStorageGet([LOG_DAYS_KEY, LOG_DAYS_LAST_KEY]);
        const raw = d?.[LOG_DAYS_KEY];
        days = raw === 0 ? 0 : clampLogDays(raw ?? 90);
        last = clampLogDays(d?.[LOG_DAYS_LAST_KEY] ?? (days || 90));
      } catch {}
      if (logDaysInput) logDaysInput.value = String(days || last);
      reflectLogDays(days);
    })();

    const saveDays = () => {
      if (!logDaysInput || logDaysInput.disabled) return;
      const v = clampLogDays(logDaysInput.value);
      logDaysInput.value = String(v); // 범위 밖 입력 보정
      try {
        cachedStorageSet({ [LOG_DAYS_KEY]: v, [LOG_DAYS_LAST_KEY]: v });
      } catch {}
    };
    logDaysInput?.addEventListener("change", saveDays);
    logDaysInput?.addEventListener("blur", saveDays);

    logDaysOff?.addEventListener("change", () => {
      const off = logDaysOff.checked;
      // 끌 때는 마지막으로 쓰던 일수로 되돌린다(입력칸에 남아 있는 값).
      const back = clampLogDays(logDaysInput?.value ?? 90);
      reflectLogDays(off ? 0 : back);
      try {
        cachedStorageSet(
          off ? { [LOG_DAYS_KEY]: 0 } : { [LOG_DAYS_KEY]: back },
        );
      } catch {}
    });
  }

  function bindSearchMoreStep(selector, storageKey, fallback) {
    const input = document.querySelector(selector);
    if (!input) return;
    const normalize = (value) => {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.min(100, Math.max(1, Math.round(number)))
        : fallback;
    };
    (async () => {
      let value = fallback;
      try {
        const data = await cachedStorageGet(storageKey);
        value = normalize(data?.[storageKey]);
      } catch {}
      input.value = String(value);
    })();
    const save = () => {
      const value = normalize(input.value);
      input.value = String(value);
      try {
        cachedStorageSet({ [storageKey]: value });
      } catch {}
    };
    input.addEventListener("change", save);
    input.addEventListener("blur", save);
  }
  bindSearchMoreStep(
    "[data-search-rerank-more-step]",
    "cheeseSearchRerankMoreStep",
    12,
  );
  bindSearchMoreStep(
    "[data-integrated-search-clips-more-step]",
    "cheeseSearchClipMoreStep",
    8,
  );

  // ── 통합검색 클립 결과 보강(전역, 기본 OFF) ──────────────────────────────
  const SEARCH_CLIPS_KEY = "cheeseSearchClips";
  const integratedSearchClipsInput = document.querySelector(
    "[data-integrated-search-clips]",
  );
  if (integratedSearchClipsInput) {
    (async () => {
      let on = false;
      try {
        const data = await cachedStorageGet(SEARCH_CLIPS_KEY);
        on = data?.[SEARCH_CLIPS_KEY] === true;
      } catch {}
      integratedSearchClipsInput.checked = on;
    })();
    integratedSearchClipsInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [SEARCH_CLIPS_KEY]: integratedSearchClipsInput.checked,
        });
      } catch {}
    });
  }
  // 항목 제목 옆 (i) 버튼 → 같은 키를 가진 안내 패널 토글. 위임 1회 바인딩이라
  // 이후 다른 항목에 같은 마크업을 추가해도 그대로 동작한다.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-settings-info]");
    if (!button) return;
    event.preventDefault();
    const key = button.dataset.settingsInfo;
    const panel = document.querySelector(`[data-settings-info-panel="${key}"]`);
    if (!panel) return;
    const next = panel.hidden;
    panel.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
  });

  const SEARCH_CLIPS_DIRECT_PLAY_KEY = "cheeseSearchClipDirectPlay";
  const integratedSearchClipDirectPlayInput = document.querySelector(
    "[data-integrated-search-clips-direct-play]",
  );
  if (integratedSearchClipDirectPlayInput) {
    (async () => {
      // 기본 OFF(클립 페이지를 새 탭으로 열기). 사용자가 명시적으로 켠 경우에만
      // 검색 화면 위에서 바로 재생한다.
      let on = false;
      try {
        const data = await cachedStorageGet(SEARCH_CLIPS_DIRECT_PLAY_KEY);
        on = data?.[SEARCH_CLIPS_DIRECT_PLAY_KEY] === true;
      } catch {}
      integratedSearchClipDirectPlayInput.checked = on;
    })();
    integratedSearchClipDirectPlayInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [SEARCH_CLIPS_DIRECT_PLAY_KEY]:
            integratedSearchClipDirectPlayInput.checked,
        });
      } catch {}
    });
  }
  const SEARCH_CLIPS_MATCH_MODE_KEY = "cheeseSearchClipMatchMode";
  const integratedSearchClipMatchButtons = Array.from(
    document.querySelectorAll("[data-integrated-search-clips-match]"),
  );
  if (integratedSearchClipMatchButtons.length) {
    const normalizeMatchMode = (value) =>
      ["strict", "balanced", "loose"].includes(value) ? value : "balanced";
    const reflectMatchMode = (value) => {
      const normalized = normalizeMatchMode(value);
      integratedSearchClipMatchButtons.forEach((button) => {
        const active = button.dataset.integratedSearchClipsMatch === normalized;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      return normalized;
    };
    (async () => {
      let value = "balanced";
      try {
        const data = await cachedStorageGet(SEARCH_CLIPS_MATCH_MODE_KEY);
        value = normalizeMatchMode(data?.[SEARCH_CLIPS_MATCH_MODE_KEY]);
      } catch {}
      reflectMatchMode(value);
    })();
    integratedSearchClipMatchButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = reflectMatchMode(
          button.dataset.integratedSearchClipsMatch,
        );
        try {
          cachedStorageSet({ [SEARCH_CLIPS_MATCH_MODE_KEY]: value });
        } catch {}
      });
    });
  }

  const SEARCH_CLIPS_SOURCE_PRESET_KEY = "cheeseSearchClipSourcePreset";
  const SEARCH_CLIPS_SOURCE_WEIGHTS_KEY = "cheeseSearchClipSourceWeights";
  const SEARCH_CLIPS_SOURCE_CUSTOM_WEIGHTS_KEY =
    "cheeseSearchClipSourceCustomWeights";
  const SEARCH_CLIPS_SOURCE_PRESETS = {
    balanced: { recommend: 50, related: 25, tag: 15, following: 10 },
    search: { recommend: 40, related: 30, tag: 25, following: 5 },
    following: { recommend: 40, related: 20, tag: 20, following: 20 },
  };
  const SEARCH_CLIPS_SOURCE_LIMITS = {
    recommend: { min: 40, max: 70 },
    related: { min: 10, max: 35 },
    tag: { min: 0, max: 25 },
    following: { min: 0, max: 20 },
  };
  const sourcePresetButtons = Array.from(
    document.querySelectorAll("[data-integrated-search-clips-source-preset]"),
  );
  const sourceCustom = document.querySelector(
    "[data-integrated-search-clips-source-custom]",
  );
  const sourceEffective = document.querySelector(
    "[data-integrated-search-clips-source-effective]",
  );
  const sourceWeightInputs = Object.fromEntries(
    Object.keys(SEARCH_CLIPS_SOURCE_LIMITS).map((key) => [
      key,
      document.querySelector(
        `[data-integrated-search-clips-source-weight="${key}"]`,
      ),
    ]),
  );
  const sourceWeightSliders = Object.fromEntries(
    Object.keys(SEARCH_CLIPS_SOURCE_LIMITS).map((key) => [
      key,
      document.querySelector(
        `[data-integrated-search-clips-source-slider="${key}"]`,
      ),
    ]),
  );
  const normalizeSourcePreset = (value) =>
    ["balanced", "search", "following", "custom"].includes(value)
      ? value
      : "balanced";
  const normalizeSourceWeights = (value) => {
    const source = value && typeof value === "object" ? value : {};
    return Object.fromEntries(
      Object.entries(SEARCH_CLIPS_SOURCE_LIMITS).map(([key, limits]) => {
        const number = Number(source[key]);
        const fallback = SEARCH_CLIPS_SOURCE_PRESETS.balanced[key];
        return [
          key,
          Number.isFinite(number)
            ? Math.min(limits.max, Math.max(limits.min, Math.round(number)))
            : fallback,
        ];
      }),
    );
  };
  const getEffectiveSourceWeights = (value) => {
    const raw = normalizeSourceWeights(value);
    const allocated = {};
    let freeKeys = Object.keys(raw);
    let remaining = 100;
    while (freeKeys.length) {
      const rawTotal = freeKeys.reduce((sum, key) => sum + raw[key], 0);
      const provisional = Object.fromEntries(
        freeKeys.map((key) => [
          key,
          rawTotal > 0
            ? (remaining * raw[key]) / rawTotal
            : remaining / freeKeys.length,
        ]),
      );
      const constrained = freeKeys.filter((key) => {
        const limits = SEARCH_CLIPS_SOURCE_LIMITS[key];
        return provisional[key] < limits.min || provisional[key] > limits.max;
      });
      if (!constrained.length) {
        freeKeys.forEach((key) => {
          allocated[key] = provisional[key];
        });
        break;
      }
      constrained.forEach((key) => {
        const limits = SEARCH_CLIPS_SOURCE_LIMITS[key];
        const fixed = Math.min(
          limits.max,
          Math.max(limits.min, provisional[key]),
        );
        allocated[key] = fixed;
        remaining -= fixed;
      });
      freeKeys = freeKeys.filter((key) => !constrained.includes(key));
    }
    const normalized = Object.fromEntries(
      Object.entries(allocated).map(([key, number]) => [
        key,
        Math.floor(number),
      ]),
    );
    let remainder =
      100 - Object.values(normalized).reduce((sum, number) => sum + number, 0);
    const byFraction = Object.keys(allocated).sort(
      (a, b) =>
        allocated[b] -
          Math.floor(allocated[b]) -
          (allocated[a] - Math.floor(allocated[a])) || b.localeCompare(a),
    );
    for (const key of byFraction) {
      if (
        remainder <= 0 ||
        normalized[key] >= SEARCH_CLIPS_SOURCE_LIMITS[key].max
      ) {
        continue;
      }
      normalized[key] += 1;
      remainder -= 1;
    }
    return normalized;
  };
  const formatSourceEffective = (weights) => {
    const inputWeights = normalizeSourceWeights(weights);
    const inputTotal = Object.values(inputWeights).reduce(
      (sum, value) => sum + value,
      0,
    );
    const normalized = getEffectiveSourceWeights(weights);
    const format = (key) => String(normalized[key]);
    return `입력 합계 ${inputTotal}\n100% 환산 비율: 추천 ${format("recommend")}% · 관련 채널 ${format("related")}% · 태그 ${format("tag")}% · 팔로잉 ${format("following")}%`;
  };
  let currentSourcePreset = "balanced";
  let currentSourceWeights = {
    ...SEARCH_CLIPS_SOURCE_PRESETS.balanced,
  };
  let currentCustomSourceWeights = {
    ...SEARCH_CLIPS_SOURCE_PRESETS.balanced,
  };
  const reflectSourceAllocation = (preset, weights) => {
    currentSourcePreset = normalizeSourcePreset(preset);
    currentSourceWeights = normalizeSourceWeights(weights);
    sourcePresetButtons.forEach((button) => {
      const active =
        button.dataset.integratedSearchClipsSourcePreset ===
        currentSourcePreset;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
    if (sourceCustom) {
      sourceCustom.hidden = currentSourcePreset !== "custom";
    }
    for (const [key, value] of Object.entries(currentSourceWeights)) {
      if (sourceWeightInputs[key]) {
        sourceWeightInputs[key].value = String(value);
      }
      if (sourceWeightSliders[key]) {
        sourceWeightSliders[key].value = String(value);
      }
    }
    if (sourceEffective) {
      sourceEffective.textContent = formatSourceEffective(currentSourceWeights);
    }
  };
  const saveSourceAllocation = (preset, weights) => {
    const normalizedPreset = normalizeSourcePreset(preset);
    const normalizedWeights = normalizeSourceWeights(
      normalizedPreset === "custom"
        ? weights
        : SEARCH_CLIPS_SOURCE_PRESETS[normalizedPreset],
    );
    if (normalizedPreset === "custom") {
      currentCustomSourceWeights = { ...normalizedWeights };
    }
    reflectSourceAllocation(normalizedPreset, normalizedWeights);
    try {
      const payload = {
        [SEARCH_CLIPS_SOURCE_PRESET_KEY]: normalizedPreset,
        [SEARCH_CLIPS_SOURCE_WEIGHTS_KEY]: normalizedWeights,
      };
      if (normalizedPreset === "custom") {
        payload[SEARCH_CLIPS_SOURCE_CUSTOM_WEIGHTS_KEY] =
          currentCustomSourceWeights;
      }
      cachedStorageSet(payload);
    } catch {}
  };
  if (sourcePresetButtons.length) {
    (async () => {
      let data = {};
      try {
        data = await cachedStorageGet([
          SEARCH_CLIPS_SOURCE_PRESET_KEY,
          SEARCH_CLIPS_SOURCE_WEIGHTS_KEY,
          SEARCH_CLIPS_SOURCE_CUSTOM_WEIGHTS_KEY,
        ]);
      } catch {}
      const preset = normalizeSourcePreset(
        data?.[SEARCH_CLIPS_SOURCE_PRESET_KEY],
      );
      const savedCustomWeights =
        data?.[SEARCH_CLIPS_SOURCE_CUSTOM_WEIGHTS_KEY] ??
        (preset === "custom"
          ? data?.[SEARCH_CLIPS_SOURCE_WEIGHTS_KEY]
          : undefined);
      currentCustomSourceWeights = normalizeSourceWeights(savedCustomWeights);
      reflectSourceAllocation(
        preset,
        preset === "custom"
          ? currentCustomSourceWeights
          : SEARCH_CLIPS_SOURCE_PRESETS[preset],
      );
      if (
        data?.[SEARCH_CLIPS_SOURCE_CUSTOM_WEIGHTS_KEY] == null &&
        preset === "custom" &&
        data?.[SEARCH_CLIPS_SOURCE_WEIGHTS_KEY]
      ) {
        try {
          cachedStorageSet({
            [SEARCH_CLIPS_SOURCE_CUSTOM_WEIGHTS_KEY]:
              currentCustomSourceWeights,
          });
        } catch {}
      }
    })();
    sourcePresetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const preset = normalizeSourcePreset(
          button.dataset.integratedSearchClipsSourcePreset,
        );
        saveSourceAllocation(
          preset,
          preset === "custom"
            ? currentCustomSourceWeights
            : SEARCH_CLIPS_SOURCE_PRESETS[preset],
        );
      });
    });
    const readSourceWeights = () =>
      Object.fromEntries(
        Object.keys(SEARCH_CLIPS_SOURCE_LIMITS).map((key) => [
          key,
          sourceWeightInputs[key]?.value,
        ]),
      );
    for (const key of Object.keys(SEARCH_CLIPS_SOURCE_LIMITS)) {
      sourceWeightSliders[key]?.addEventListener("input", () => {
        if (sourceWeightInputs[key]) {
          sourceWeightInputs[key].value = sourceWeightSliders[key].value;
        }
        currentSourceWeights = normalizeSourceWeights(readSourceWeights());
        if (sourceEffective) {
          sourceEffective.textContent =
            formatSourceEffective(currentSourceWeights);
        }
      });
      sourceWeightSliders[key]?.addEventListener("change", () => {
        saveSourceAllocation("custom", readSourceWeights());
      });
      const saveInput = () => {
        saveSourceAllocation("custom", readSourceWeights());
      };
      sourceWeightInputs[key]?.addEventListener("change", saveInput);
      sourceWeightInputs[key]?.addEventListener("blur", saveInput);
    }
  }

  const SEARCH_CLIPS_DATE_FILTER_KEY = "cheeseSearchClipDateFilter";
  const integratedSearchClipDateButtons = Array.from(
    document.querySelectorAll("[data-integrated-search-clips-date-filter]"),
  );
  if (integratedSearchClipDateButtons.length) {
    const normalizeDateFilter = (value) =>
      ["all", "month", "week", "day"].includes(value) ? value : "all";
    const reflectDateFilter = (value) => {
      const normalized = normalizeDateFilter(value);
      integratedSearchClipDateButtons.forEach((button) => {
        const active =
          button.dataset.integratedSearchClipsDateFilter === normalized;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      return normalized;
    };
    (async () => {
      let value = "all";
      try {
        const data = await cachedStorageGet(SEARCH_CLIPS_DATE_FILTER_KEY);
        value = normalizeDateFilter(data?.[SEARCH_CLIPS_DATE_FILTER_KEY]);
      } catch {}
      reflectDateFilter(value);
    })();
    integratedSearchClipDateButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = reflectDateFilter(
          button.dataset.integratedSearchClipsDateFilter,
        );
        try {
          cachedStorageSet({ [SEARCH_CLIPS_DATE_FILTER_KEY]: value });
        } catch {}
      });
    });
  }

  const SEARCH_CLIPS_DEFAULT_SORT_KEY = "cheeseSearchClipDefaultSort";
  const integratedSearchClipDefaultSortButtons = Array.from(
    document.querySelectorAll("[data-integrated-search-clips-default-sort]"),
  );
  if (integratedSearchClipDefaultSortButtons.length) {
    const normalizeClipSort = (value) =>
      ["relevant", "popular", "recent"].includes(value) ? value : "relevant";
    const reflectClipSort = (value) => {
      const normalized = normalizeClipSort(value);
      integratedSearchClipDefaultSortButtons.forEach((button) => {
        const active =
          button.dataset.integratedSearchClipsDefaultSort === normalized;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      return normalized;
    };
    (async () => {
      let value = "relevant";
      try {
        const data = await cachedStorageGet(SEARCH_CLIPS_DEFAULT_SORT_KEY);
        value = normalizeClipSort(data?.[SEARCH_CLIPS_DEFAULT_SORT_KEY]);
      } catch {}
      reflectClipSort(value);
    })();
    integratedSearchClipDefaultSortButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = reflectClipSort(
          button.dataset.integratedSearchClipsDefaultSort,
        );
        try {
          cachedStorageSet({ [SEARCH_CLIPS_DEFAULT_SORT_KEY]: value });
        } catch {}
      });
    });
  }

  const SEARCH_CLIPS_CANDIDATE_LIMIT_KEY = "cheeseSearchClipCandidateLimit";
  const SEARCH_CLIPS_CATEGORY_LIMIT_KEY = "cheeseSearchClipCategoryLimit";
  const SEARCH_CLIPS_LIMIT_DEFAULT = 1000;
  const SEARCH_CLIPS_LIMIT_MAX = 100000;
  const integratedSearchClipLimitInputs = {
    candidate: document.querySelector(
      "[data-integrated-search-clips-candidate-limit]",
    ),
    category: document.querySelector(
      "[data-integrated-search-clips-category-limit]",
    ),
  };
  const integratedSearchClipLimitSliders = {
    candidate: document.querySelector(
      "[data-integrated-search-clips-candidate-limit-slider]",
    ),
    category: document.querySelector(
      "[data-integrated-search-clips-category-limit-slider]",
    ),
  };
  const normalizeClipLimit = (value, fallback) => {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    const number = Number(raw.replaceAll(",", ""));
    return Number.isFinite(number)
      ? Math.min(SEARCH_CLIPS_LIMIT_MAX, Math.max(50, Math.round(number)))
      : fallback;
  };
  const formatClipLimit = (value) =>
    normalizeClipLimit(value, SEARCH_CLIPS_LIMIT_DEFAULT).toLocaleString(
      "ko-KR",
    );
  if (Object.values(integratedSearchClipLimitInputs).some(Boolean)) {
    const reflectClipLimits = (candidate, category) => {
      const normalized = {
        candidate: normalizeClipLimit(candidate, SEARCH_CLIPS_LIMIT_DEFAULT),
        category: normalizeClipLimit(category, SEARCH_CLIPS_LIMIT_DEFAULT),
      };
      if (integratedSearchClipLimitInputs.candidate) {
        integratedSearchClipLimitInputs.candidate.value = formatClipLimit(
          normalized.candidate,
        );
      }
      if (integratedSearchClipLimitInputs.category) {
        integratedSearchClipLimitInputs.category.value = formatClipLimit(
          normalized.category,
        );
      }
      if (integratedSearchClipLimitSliders.candidate) {
        integratedSearchClipLimitSliders.candidate.value = String(
          normalized.candidate,
        );
      }
      if (integratedSearchClipLimitSliders.category) {
        integratedSearchClipLimitSliders.category.value = String(
          normalized.category,
        );
      }
      return normalized;
    };
    (async () => {
      let data = {};
      try {
        data = await cachedStorageGet([
          SEARCH_CLIPS_CANDIDATE_LIMIT_KEY,
          SEARCH_CLIPS_CATEGORY_LIMIT_KEY,
        ]);
      } catch {}
      reflectClipLimits(
        data?.[SEARCH_CLIPS_CANDIDATE_LIMIT_KEY],
        data?.[SEARCH_CLIPS_CATEGORY_LIMIT_KEY],
      );
    })();
    const saveClipLimits = () => {
      const normalized = reflectClipLimits(
        integratedSearchClipLimitInputs.candidate?.value,
        integratedSearchClipLimitInputs.category?.value,
      );
      try {
        cachedStorageSet({
          [SEARCH_CLIPS_CANDIDATE_LIMIT_KEY]: normalized.candidate,
          [SEARCH_CLIPS_CATEGORY_LIMIT_KEY]: normalized.category,
        });
      } catch {}
    };
    for (const input of Object.values(integratedSearchClipLimitInputs)) {
      input?.addEventListener("change", saveClipLimits);
      input?.addEventListener("blur", saveClipLimits);
    }
    for (const [key, slider] of Object.entries(
      integratedSearchClipLimitSliders,
    )) {
      slider?.addEventListener("input", () => {
        if (integratedSearchClipLimitInputs[key]) {
          integratedSearchClipLimitInputs[key].value = formatClipLimit(
            slider.value,
          );
        }
      });
      slider?.addEventListener("change", saveClipLimits);
    }
  }

  const SEARCH_CLIPS_WEIGHTS_KEY = "cheeseSearchClipWeights";
  const SEARCH_CLIPS_WEIGHT_DEFAULTS = {
    title: 35,
    category: 20,
    channel: 20,
    read: 10,
    verified: 5,
    recent: 10,
  };
  const integratedSearchClipWeightInputs = {
    title: document.querySelector("[data-integrated-search-clips-w-title]"),
    category: document.querySelector(
      "[data-integrated-search-clips-w-category]",
    ),
    channel: document.querySelector("[data-integrated-search-clips-w-channel]"),
    read: document.querySelector("[data-integrated-search-clips-w-read]"),
    verified: document.querySelector(
      "[data-integrated-search-clips-w-verified]",
    ),
    recent: document.querySelector("[data-integrated-search-clips-w-recent]"),
  };
  const normalizeClipWeights = (weights) => {
    const normalized = { ...SEARCH_CLIPS_WEIGHT_DEFAULTS };
    if (weights && typeof weights === "object") {
      for (const key of Object.keys(normalized)) {
        const number = Number(weights[key]);
        if (Number.isFinite(number)) {
          normalized[key] = Math.min(100, Math.max(0, Math.round(number)));
        }
      }
    }
    return Object.values(normalized).every((weight) => weight === 0)
      ? { ...SEARCH_CLIPS_WEIGHT_DEFAULTS }
      : normalized;
  };
  if (Object.values(integratedSearchClipWeightInputs).some(Boolean)) {
    const reflectClipWeights = (weights) => {
      const normalized = normalizeClipWeights(weights);
      for (const [key, input] of Object.entries(
        integratedSearchClipWeightInputs,
      )) {
        if (input) input.value = String(normalized[key]);
      }
      return normalized;
    };
    (async () => {
      let saved = {};
      try {
        const data = await cachedStorageGet(SEARCH_CLIPS_WEIGHTS_KEY);
        saved = data?.[SEARCH_CLIPS_WEIGHTS_KEY] || {};
      } catch {}
      reflectClipWeights(saved);
    })();
    const saveClipWeights = (weights = null) => {
      const raw =
        weights ||
        Object.fromEntries(
          Object.entries(integratedSearchClipWeightInputs).map(
            ([key, input]) => [key, input?.value],
          ),
        );
      const normalized = reflectClipWeights(raw);
      try {
        cachedStorageSet({
          [SEARCH_CLIPS_WEIGHTS_KEY]: normalized,
        });
      } catch {}
    };
    for (const input of Object.values(integratedSearchClipWeightInputs)) {
      input?.addEventListener("change", () => saveClipWeights());
      input?.addEventListener("blur", () => saveClipWeights());
    }
    document
      .querySelector("[data-integrated-search-clips-weights-reset]")
      ?.addEventListener("click", () =>
        saveClipWeights(SEARCH_CLIPS_WEIGHT_DEFAULTS),
      );
  }

  // ── 통합검색 라이브 재정렬(전역, 기본 OFF) ────────────────────────────────
  const SEARCH_LIVE_RERANK_KEY = "cheeseSearchLiveRerank";
  const searchLiveRerankInput = document.querySelector(
    "[data-search-live-rerank]",
  );
  if (searchLiveRerankInput) {
    (async () => {
      let enabled = false;
      try {
        const data = await cachedStorageGet(SEARCH_LIVE_RERANK_KEY);
        enabled = data?.[SEARCH_LIVE_RERANK_KEY] === true;
      } catch {}
      searchLiveRerankInput.checked = enabled;
    })();
    searchLiveRerankInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [SEARCH_LIVE_RERANK_KEY]: searchLiveRerankInput.checked,
        });
      } catch {}
    });
  }
  const SEARCH_LIVE_RERANK_DEFAULT_SORT_KEY =
    "cheeseSearchLiveRerankDefaultSort";
  const searchLiveRerankSortButtons = Array.from(
    document.querySelectorAll("[data-search-live-rerank-sort]"),
  );
  if (searchLiveRerankSortButtons.length) {
    const normalizeLiveSort = (value) =>
      ["score", "viewers", "recent", "original"].includes(value)
        ? value
        : "score";
    const reflectLiveSort = (value) => {
      const normalized = normalizeLiveSort(value);
      searchLiveRerankSortButtons.forEach((button) => {
        const active = button.dataset.searchLiveRerankSort === normalized;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
    };
    (async () => {
      let value = "score";
      try {
        const data = await cachedStorageGet(
          SEARCH_LIVE_RERANK_DEFAULT_SORT_KEY,
        );
        value = normalizeLiveSort(data?.[SEARCH_LIVE_RERANK_DEFAULT_SORT_KEY]);
      } catch {}
      reflectLiveSort(value);
    })();
    searchLiveRerankSortButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const value = normalizeLiveSort(button.dataset.searchLiveRerankSort);
        reflectLiveSort(value);
        try {
          cachedStorageSet({
            [SEARCH_LIVE_RERANK_DEFAULT_SORT_KEY]: value,
          });
        } catch {}
      });
    });
  }
  const SEARCH_LIVE_RERANK_WEIGHTS_KEY = "cheeseSearchLiveRerankWeights";
  const SEARCH_LIVE_RERANK_WEIGHT_DEFAULTS = {
    rel: 45,
    channel: 20,
    viewers: 25,
    verified: 5,
    recent: 5,
  };
  const searchLiveRerankWeightInputs = {
    rel: document.querySelector("[data-search-live-rerank-w-rel]"),
    channel: document.querySelector("[data-search-live-rerank-w-channel]"),
    viewers: document.querySelector("[data-search-live-rerank-w-viewers]"),
    verified: document.querySelector("[data-search-live-rerank-w-verified]"),
    recent: document.querySelector("[data-search-live-rerank-w-recent]"),
  };
  function normalizeLiveRerankWeights(weights) {
    const saved = weights && typeof weights === "object" ? weights : null;
    const normalized = { ...SEARCH_LIVE_RERANK_WEIGHT_DEFAULTS };
    if (saved) {
      for (const key of Object.keys(normalized)) {
        const weight = Number(saved[key]);
        if (Number.isFinite(weight)) {
          normalized[key] = Math.min(100, Math.max(0, Math.round(weight)));
        }
      }
    }
    return Object.values(normalized).every((weight) => weight === 0)
      ? { ...SEARCH_LIVE_RERANK_WEIGHT_DEFAULTS }
      : normalized;
  }
  if (Object.values(searchLiveRerankWeightInputs).some(Boolean)) {
    const reflectLiveWeights = (weights) => {
      const normalized = normalizeLiveRerankWeights(weights);
      for (const [key, input] of Object.entries(searchLiveRerankWeightInputs)) {
        if (input) input.value = String(normalized[key]);
      }
      return normalized;
    };
    (async () => {
      let saved = {};
      try {
        const data = await cachedStorageGet(SEARCH_LIVE_RERANK_WEIGHTS_KEY);
        saved = data?.[SEARCH_LIVE_RERANK_WEIGHTS_KEY] || {};
      } catch {}
      reflectLiveWeights(saved);
    })();
    const saveLiveWeights = (weights = null) => {
      const raw =
        weights ||
        Object.fromEntries(
          Object.entries(searchLiveRerankWeightInputs).map(([key, input]) => [
            key,
            input?.value,
          ]),
        );
      const normalized = reflectLiveWeights(raw);
      try {
        cachedStorageSet({
          [SEARCH_LIVE_RERANK_WEIGHTS_KEY]: normalized,
        });
      } catch {}
    };
    for (const input of Object.values(searchLiveRerankWeightInputs)) {
      input?.addEventListener("change", () => saveLiveWeights());
      input?.addEventListener("blur", () => saveLiveWeights());
    }
    document
      .querySelector("[data-search-live-rerank-weights-reset]")
      ?.addEventListener("click", () =>
        saveLiveWeights(SEARCH_LIVE_RERANK_WEIGHT_DEFAULTS),
      );
  }

  // ── 통합검색 동영상 재정렬(전역, 기본 OFF) ────────────────────────────────
  const SEARCH_RERANK_KEY = "cheeseSearchRerank";
  const searchRerankInput = document.querySelector("[data-search-rerank]");
  if (searchRerankInput) {
    (async () => {
      let on = false; // 기본 꺼짐
      try {
        const d = await cachedStorageGet(SEARCH_RERANK_KEY);
        on = d?.[SEARCH_RERANK_KEY] === true;
      } catch {}
      searchRerankInput.checked = on;
    })();
    searchRerankInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [SEARCH_RERANK_KEY]: searchRerankInput.checked });
      } catch {}
    });
  }
  // 재정렬 최대 개수(50~1000, 기본 200): 슬라이더 + 숫자 입력 동기화.
  const SEARCH_RERANK_POOL_KEY = "cheeseSearchRerankPoolMax";
  const rerankPoolSlider = document.querySelector(
    "[data-search-rerank-pool-slider]",
  );
  const rerankPoolInput = document.querySelector("[data-search-rerank-pool]");
  function clampRerankPool(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 200;
    return Math.min(1000, Math.max(50, Math.round(n)));
  }
  if (rerankPoolSlider || rerankPoolInput) {
    const reflectPool = (v) => {
      const n = clampRerankPool(v);
      if (rerankPoolSlider) rerankPoolSlider.value = String(n);
      if (rerankPoolInput) rerankPoolInput.value = String(n);
      return n;
    };
    (async () => {
      let v = 200;
      try {
        const d = await cachedStorageGet(SEARCH_RERANK_POOL_KEY);
        v = clampRerankPool(d?.[SEARCH_RERANK_POOL_KEY] ?? 200);
      } catch {}
      reflectPool(v);
    })();
    const savePool = (v) => {
      const n = reflectPool(v);
      try {
        cachedStorageSet({ [SEARCH_RERANK_POOL_KEY]: n });
      } catch {}
    };
    rerankPoolSlider?.addEventListener("input", () => {
      // 드래그 중엔 숫자만 따라가고, 놓을 때(change) 저장.
      if (rerankPoolInput) rerankPoolInput.value = rerankPoolSlider.value;
    });
    rerankPoolSlider?.addEventListener("change", () =>
      savePool(rerankPoolSlider.value),
    );
    rerankPoolInput?.addEventListener("change", () =>
      savePool(rerankPoolInput.value),
    );
    rerankPoolInput?.addEventListener("blur", () =>
      savePool(rerankPoolInput.value),
    );
  }
  // 추천순 점수 비중(각 0~100, 기본 35/15/25/10/10/5, 모두 0이면 기본값 폴백).
  const SEARCH_RERANK_WEIGHTS_KEY = "cheeseSearchRerankWeights";
  const RERANK_WEIGHT_DEFAULTS = {
    rel: 35,
    channel: 15,
    read: 25,
    pv: 10,
    verified: 10,
    recent: 5,
  };
  const RERANK_WEIGHT_LEGACY_DEFAULTS = {
    rel: 40,
    read: 30,
    pv: 15,
    verified: 10,
    recent: 5,
  };
  const rerankWeightInputs = {
    rel: document.querySelector("[data-search-rerank-w-rel]"),
    channel: document.querySelector("[data-search-rerank-w-channel]"),
    read: document.querySelector("[data-search-rerank-w-read]"),
    pv: document.querySelector("[data-search-rerank-w-pv]"),
    verified: document.querySelector("[data-search-rerank-w-verified]"),
    recent: document.querySelector("[data-search-rerank-w-recent]"),
  };
  function clampRerankWeight(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(0, Math.round(n)));
  }
  function normalizeRerankWeights(weights) {
    const saved =
      weights &&
      typeof weights === "object" &&
      Object.keys(RERANK_WEIGHT_DEFAULTS).some((key) =>
        Object.prototype.hasOwnProperty.call(weights, key),
      )
        ? weights
        : null;
    const legacyDefault =
      saved &&
      !Object.prototype.hasOwnProperty.call(saved, "channel") &&
      Object.entries(RERANK_WEIGHT_LEGACY_DEFAULTS).every(
        ([key, value]) => Number(saved[key]) === value,
      );
    if (legacyDefault) return { ...RERANK_WEIGHT_DEFAULTS };

    const out = {};
    for (const k of Object.keys(RERANK_WEIGHT_DEFAULTS)) {
      out[k] =
        k === "channel" &&
        saved &&
        !Object.prototype.hasOwnProperty.call(saved, k)
          ? 0
          : clampRerankWeight(saved?.[k], RERANK_WEIGHT_DEFAULTS[k]);
    }
    return Object.values(out).every((weight) => weight === 0)
      ? { ...RERANK_WEIGHT_DEFAULTS }
      : out;
  }
  if (Object.values(rerankWeightInputs).some(Boolean)) {
    const reflectWeights = (weights) => {
      const normalized = normalizeRerankWeights(weights);
      for (const [k, input] of Object.entries(rerankWeightInputs)) {
        if (input) input.value = String(normalized[k]);
      }
      return normalized;
    };
    (async () => {
      let saved = {};
      try {
        const d = await cachedStorageGet(SEARCH_RERANK_WEIGHTS_KEY);
        if (
          d?.[SEARCH_RERANK_WEIGHTS_KEY] &&
          typeof d[SEARCH_RERANK_WEIGHTS_KEY] === "object"
        ) {
          saved = d[SEARCH_RERANK_WEIGHTS_KEY];
        }
      } catch {}
      reflectWeights(saved);
    })();
    const saveWeights = (weights = null) => {
      const raw =
        weights ||
        Object.fromEntries(
          Object.entries(rerankWeightInputs).map(([k, input]) => [
            k,
            input?.value,
          ]),
        );
      const out = reflectWeights(raw); // 범위 밖·모두 0 입력 보정
      try {
        cachedStorageSet({ [SEARCH_RERANK_WEIGHTS_KEY]: out });
      } catch {}
    };
    for (const input of Object.values(rerankWeightInputs)) {
      input?.addEventListener("change", () => saveWeights());
      input?.addEventListener("blur", () => saveWeights());
    }
    document
      .querySelector("[data-search-rerank-weights-reset]")
      ?.addEventListener("click", () => saveWeights(RERANK_WEIGHT_DEFAULTS));
  }
  // 기본 정렬(score|read|pv|recent|original, 기본 score).
  const SEARCH_RERANK_DEFAULT_SORT_KEY = "cheeseSearchRerankDefaultSort";
  const rerankSortButtons = Array.from(
    document.querySelectorAll("[data-search-rerank-sort]"),
  );
  if (rerankSortButtons.length) {
    const reflectSort = (value) => {
      rerankSortButtons.forEach((btn) => {
        const active = btn.dataset.searchRerankSort === value;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-checked", String(active));
      });
    };
    (async () => {
      let v = "score";
      try {
        const d = await cachedStorageGet(SEARCH_RERANK_DEFAULT_SORT_KEY);
        const saved = d?.[SEARCH_RERANK_DEFAULT_SORT_KEY];
        if (["score", "read", "pv", "recent", "original"].includes(saved)) {
          v = saved;
        }
      } catch {}
      reflectSort(v);
    })();
    rerankSortButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.searchRerankSort;
        reflectSort(v);
        try {
          cachedStorageSet({ [SEARCH_RERANK_DEFAULT_SORT_KEY]: v });
        } catch {}
      });
    });
  }

  // ── 카테고리 동영상 필터(전역, 기본 OFF) ──────────────────────────────────
  const CATEGORY_VIDEO_FILTER_KEY = "cheeseCategoryVideoFilter";
  const CATEGORY_VIDEO_CANDIDATE_LIMIT_KEY =
    "cheeseCategoryVideoCandidateLimit";
  const CATEGORY_VIDEO_CANDIDATE_LIMIT_DEFAULT = 2000;
  const CATEGORY_VIDEO_CANDIDATE_LIMITS = new Set([
    500, 1000, 2000, 3000, 5000,
  ]);
  const categoryVideoFilterInput = document.querySelector(
    "[data-category-video-filter]",
  );
  const categoryVideoCandidatePicker = document.querySelector(
    "[data-category-video-candidate-picker]",
  );
  const categoryVideoCandidateTrigger =
    categoryVideoCandidatePicker?.querySelector(
      "[data-category-video-candidate-trigger]",
    );
  const categoryVideoCandidateLabel =
    categoryVideoCandidatePicker?.querySelector(
      "[data-category-video-candidate-label]",
    );
  const categoryVideoCandidateList =
    categoryVideoCandidatePicker?.querySelector(
      "[data-category-video-candidate-list]",
    );
  const normalizeCategoryVideoCandidateLimit = (value) => {
    const number = Number(value);
    return CATEGORY_VIDEO_CANDIDATE_LIMITS.has(number)
      ? number
      : CATEGORY_VIDEO_CANDIDATE_LIMIT_DEFAULT;
  };
  const reflectCategoryVideoCandidateLimit = (value) => {
    const normalized = normalizeCategoryVideoCandidateLimit(value);
    if (categoryVideoCandidatePicker) {
      categoryVideoCandidatePicker.dataset.value = String(normalized);
    }
    if (categoryVideoCandidateLabel) {
      categoryVideoCandidateLabel.textContent = `${normalized.toLocaleString("ko-KR")}개`;
    }
    categoryVideoCandidateList
      ?.querySelectorAll("[role='option'][data-value]")
      .forEach((option) => {
        option.setAttribute(
          "aria-selected",
          String(Number(option.dataset.value) === normalized),
        );
      });
    return normalized;
  };
  const closeCategoryVideoCandidatePicker = () => {
    categoryVideoCandidatePicker?.classList.remove("is-open");
    categoryVideoCandidateTrigger?.setAttribute("aria-expanded", "false");
    if (categoryVideoCandidateList) categoryVideoCandidateList.hidden = true;
  };
  const positionCategoryVideoCandidateList = () => {
    if (!categoryVideoCandidateTrigger || !categoryVideoCandidateList) return;
    const rect = categoryVideoCandidateTrigger.getBoundingClientRect();
    categoryVideoCandidateList.style.left = `${Math.round(rect.left)}px`;
    categoryVideoCandidateList.style.top = `${Math.round(rect.bottom + 4)}px`;
    categoryVideoCandidateList.style.minWidth = `${Math.round(rect.width)}px`;
    categoryVideoCandidateList.style.maxHeight = `${Math.max(
      140,
      window.innerHeight - rect.bottom - 16,
    )}px`;
  };
  const openCategoryVideoCandidatePicker = () => {
    if (
      !categoryVideoCandidatePicker ||
      !categoryVideoCandidateTrigger ||
      !categoryVideoCandidateList
    ) {
      return;
    }
    categoryVideoCandidatePicker.classList.add("is-open");
    categoryVideoCandidateTrigger.setAttribute("aria-expanded", "true");
    categoryVideoCandidateList.hidden = false;
    positionCategoryVideoCandidateList();
  };
  if (categoryVideoFilterInput) {
    (async () => {
      let on = false;
      try {
        const data = await cachedStorageGet(CATEGORY_VIDEO_FILTER_KEY);
        on = data?.[CATEGORY_VIDEO_FILTER_KEY] === true;
      } catch {}
      categoryVideoFilterInput.checked = on;
    })();
    categoryVideoFilterInput.addEventListener("change", () => {
      cachedStorageSet({
        [CATEGORY_VIDEO_FILTER_KEY]: categoryVideoFilterInput.checked,
      });
    });
  }
  if (categoryVideoCandidatePicker) {
    (async () => {
      let value = CATEGORY_VIDEO_CANDIDATE_LIMIT_DEFAULT;
      try {
        const data = await cachedStorageGet(CATEGORY_VIDEO_CANDIDATE_LIMIT_KEY);
        value = normalizeCategoryVideoCandidateLimit(
          data?.[CATEGORY_VIDEO_CANDIDATE_LIMIT_KEY],
        );
      } catch {}
      reflectCategoryVideoCandidateLimit(value);
    })();
    categoryVideoCandidateTrigger?.addEventListener("click", () => {
      if (categoryVideoCandidatePicker.classList.contains("is-open")) {
        closeCategoryVideoCandidatePicker();
      } else {
        openCategoryVideoCandidatePicker();
      }
    });
    categoryVideoCandidateList?.addEventListener("click", (event) => {
      const option = event.target.closest("[role='option'][data-value]");
      if (!option) return;
      const value = reflectCategoryVideoCandidateLimit(option.dataset.value);
      cachedStorageSet({ [CATEGORY_VIDEO_CANDIDATE_LIMIT_KEY]: value });
      closeCategoryVideoCandidatePicker();
      categoryVideoCandidateTrigger?.focus();
    });
    categoryVideoCandidateList?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCategoryVideoCandidatePicker();
      categoryVideoCandidateTrigger?.focus();
    });
    document.addEventListener("click", (event) => {
      if (!categoryVideoCandidatePicker.contains(event.target)) {
        closeCategoryVideoCandidatePicker();
      }
    });
    document.addEventListener(
      "scroll",
      (event) => {
        if (
          categoryVideoCandidatePicker.classList.contains("is-open") &&
          !categoryVideoCandidateList?.contains(event.target)
        ) {
          closeCategoryVideoCandidatePicker();
        }
      },
      true,
    );
    window.addEventListener("resize", closeCategoryVideoCandidatePicker);
  }

  // ── 탭 복귀 시 검색 자동 초기화(전역, 기본 OFF) ───────────────────────────
  const SEARCH_RESET_ON_RETURN_KEY = "cheeseSearchResetOnReturn";
  const searchResetInput = document.querySelector(
    "[data-search-reset-on-return]",
  );
  if (searchResetInput) {
    (async () => {
      let on = false; // 기본 꺼짐
      try {
        const d = await cachedStorageGet(SEARCH_RESET_ON_RETURN_KEY);
        on = d?.[SEARCH_RESET_ON_RETURN_KEY] === true;
      } catch {}
      searchResetInput.checked = on;
    })();
    searchResetInput.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [SEARCH_RESET_ON_RETURN_KEY]: searchResetInput.checked,
        });
      } catch {}
    });
  }

  // ── 채널 라이브 바로가기 버튼(전역, 기본 ON) ──────────────────────────────
  // 체크=표시. 미설정이면 표시(true)가 기본.
  // ── 팔로워 수 정확히 보기(호버 툴팁, 기본 OFF) ────────────────────────────
  const FOLLOWER_EXACT_KEY = "cheeseFollowerExact";
  const followerExactInput = document.querySelector("[data-follower-exact]");
  async function loadFollowerExact() {
    let on = false; // 기본 OFF
    try {
      const data = await cachedStorageGet(FOLLOWER_EXACT_KEY);
      on = data?.[FOLLOWER_EXACT_KEY] === true;
    } catch {}
    if (followerExactInput) followerExactInput.checked = on;
  }
  followerExactInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({ [FOLLOWER_EXACT_KEY]: followerExactInput.checked });
    } catch {}
  });
  loadFollowerExact();

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
      screenshotDirectInput
        .closest(".settings-item")
        ?.classList.add("is-locked");
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

  // 라이브 바로가기 버튼 배치(끝/탭 뒤). 기본 OFF(탭 뒤).
  const CHANNEL_LIVE_BUTTON_END_KEY = "cheeseChannelLiveButtonEnd";
  const channelLiveButtonEndInput = document.querySelector(
    "[data-channel-live-button-end]",
  );

  async function loadChannelLiveButtonEnd() {
    let on = false;
    try {
      const data = await cachedStorageGet(CHANNEL_LIVE_BUTTON_END_KEY);
      on = data?.[CHANNEL_LIVE_BUTTON_END_KEY] === true; // true=끝, 미설정/false=탭 뒤
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

  // ── 채널 프로필 모서리(기본 OFF, 0~50%) ─────────────────────────────────
  const CHANNEL_PROFILE_RADIUS_ENABLED_KEY =
    "cheeseChannelProfileRadiusEnabled";
  const CHANNEL_PROFILE_RADIUS_KEY = "cheeseChannelProfileRadius";
  const channelProfileRadiusEnabledInput = document.querySelector(
    "[data-channel-profile-radius-enabled]",
  );
  const channelProfileRadiusControls = document.querySelector(
    "[data-channel-profile-radius-controls]",
  );
  const channelProfileRadiusSlider = document.querySelector(
    "[data-channel-profile-radius-slider]",
  );
  const channelProfileRadiusInput = document.querySelector(
    "[data-channel-profile-radius]",
  );
  const channelLiveProfilePreview = document.querySelector(
    "[data-channel-live-profile-preview]",
  );
  function clampChannelProfileRadius(value) {
    const radius = Number(value);
    if (!Number.isFinite(radius)) return 50;
    return Math.min(50, Math.max(0, Math.round(radius)));
  }
  function reflectChannelProfileRadius(value) {
    const radius = clampChannelProfileRadius(value);
    if (channelProfileRadiusSlider) {
      channelProfileRadiusSlider.value = String(radius);
    }
    if (channelProfileRadiusInput) {
      channelProfileRadiusInput.value = String(radius);
    }
    channelLiveProfilePreview?.style.setProperty(
      "--channel-profile-preview-radius",
      `${radius}%`,
    );
  }
  function reflectChannelProfileRadiusEnabled(enabled) {
    const on = enabled === true;
    if (channelProfileRadiusEnabledInput) {
      channelProfileRadiusEnabledInput.checked = on;
    }
    if (channelProfileRadiusSlider) channelProfileRadiusSlider.disabled = !on;
    if (channelProfileRadiusInput) channelProfileRadiusInput.disabled = !on;
    channelProfileRadiusControls?.classList.toggle("is-locked", !on);
    channelLiveProfilePreview?.style.setProperty(
      "--channel-profile-preview-radius",
      on
        ? `${clampChannelProfileRadius(
            channelProfileRadiusInput?.value ?? 50,
          )}%`
        : "50%",
    );
  }
  function saveChannelProfileRadius(value) {
    const radius = clampChannelProfileRadius(value);
    reflectChannelProfileRadius(radius);
    try {
      cachedStorageSet({ [CHANNEL_PROFILE_RADIUS_KEY]: radius });
    } catch {}
  }
  (async () => {
    let radius = 50;
    let enabled = false;
    try {
      const data = await cachedStorageGet([
        CHANNEL_PROFILE_RADIUS_ENABLED_KEY,
        CHANNEL_PROFILE_RADIUS_KEY,
      ]);
      const hasStoredRadius = data?.[CHANNEL_PROFILE_RADIUS_KEY] !== undefined;
      enabled =
        data?.[CHANNEL_PROFILE_RADIUS_ENABLED_KEY] === true ||
        (data?.[CHANNEL_PROFILE_RADIUS_ENABLED_KEY] == null && hasStoredRadius);
      radius = clampChannelProfileRadius(
        data?.[CHANNEL_PROFILE_RADIUS_KEY] ?? 50,
      );
      if (
        data?.[CHANNEL_PROFILE_RADIUS_ENABLED_KEY] == null &&
        hasStoredRadius
      ) {
        cachedStorageSet({ [CHANNEL_PROFILE_RADIUS_ENABLED_KEY]: true });
      }
    } catch {}
    reflectChannelProfileRadius(radius);
    reflectChannelProfileRadiusEnabled(enabled);
  })();
  channelProfileRadiusEnabledInput?.addEventListener("change", () => {
    const enabled = channelProfileRadiusEnabledInput.checked;
    reflectChannelProfileRadiusEnabled(enabled);
    try {
      cachedStorageSet({
        [CHANNEL_PROFILE_RADIUS_ENABLED_KEY]: enabled,
        [CHANNEL_PROFILE_RADIUS_KEY]: clampChannelProfileRadius(
          channelProfileRadiusInput?.value ?? 50,
        ),
      });
    } catch {}
  });
  channelProfileRadiusSlider?.addEventListener("input", () => {
    saveChannelProfileRadius(channelProfileRadiusSlider.value);
  });
  channelProfileRadiusInput?.addEventListener("change", () => {
    saveChannelProfileRadius(channelProfileRadiusInput.value);
  });
  channelProfileRadiusInput?.addEventListener("blur", () => {
    saveChannelProfileRadius(channelProfileRadiusInput.value);
  });

  // ── 라이브 프로필 테두리 그라디언트(기본 OFF) ─────────────────────────────
  const CHANNEL_LIVE_PROFILE_BACKGROUND_KEY =
    "cheeseChannelLiveProfileBackground";
  const CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT = Object.freeze({
    enabled: false,
    angle: 180,
    start: "#00ffa3",
    startAlpha: 100,
    end: "#027f80",
    endAlpha: 100,
  });
  const channelLiveProfileCustomInput = document.querySelector(
    "[data-channel-live-profile-custom]",
  );
  const channelLiveProfileEditor = document.querySelector(
    "[data-channel-live-profile-editor]",
  );
  const channelLiveProfileStartInput = document.querySelector(
    "[data-channel-live-profile-start]",
  );
  const channelLiveProfileAngleSlider = document.querySelector(
    "[data-channel-live-profile-angle-slider]",
  );
  const channelLiveProfileAngleInput = document.querySelector(
    "[data-channel-live-profile-angle]",
  );
  const channelLiveProfileEndInput = document.querySelector(
    "[data-channel-live-profile-end]",
  );
  const channelLiveProfileReset = document.querySelector(
    "[data-channel-live-profile-reset]",
  );
  try {
    window.Coloris?.({
      el: "[data-channel-live-profile-color]",
      parent: document.body,
      theme: "default",
      themeMode:
        document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      margin: 6,
      format: "hex",
      alpha: true,
      forceAlpha: true,
      selectInput: true,
      closeLabel: "색상 선택 완료",
      a11y: {
        open: "색상 선택기 열기",
        close: "색상 선택기 닫기",
        clear: "색상 지우기",
        marker: "채도: {s}. 밝기: {v}.",
        hueSlider: "색조",
        alphaSlider: "불투명도",
        input: "HEX 색상값",
        format: "색상 형식",
        swatch: "색상 견본",
        instruction: "방향키로 채도와 밝기를 조절하고 Enter 키로 선택합니다.",
      },
    });
    window.Coloris?.("[data-chat-time-color-picker]");
    window.Coloris?.wrap("[data-chat-time-color-picker]");
    window.Coloris?.setInstance("[data-chat-time-color-picker]", {
      alpha: false,
      forceAlpha: false,
      format: "hex",
      selectInput: true,
    });
    reflectChatTimeColors();
    // 미리보기 카테고리 기준 색도 같은 설정으로 Coloris 를 붙인다.
    window.Coloris?.("[data-vod-chat-graph-color]");
    window.Coloris?.wrap("[data-vod-chat-graph-color]");
    window.Coloris?.setInstance("[data-vod-chat-graph-color]", {
      alpha: false,
      forceAlpha: false,
      format: "hex",
      selectInput: true,
    });
    window.Coloris?.("[data-fp-color-picker]");
    window.Coloris?.wrap("[data-fp-color-picker]");
    window.Coloris?.setInstance("[data-fp-color-picker]", {
      alpha: false,
      forceAlpha: false,
      format: "hex",
      selectInput: true,
    });
  } catch {}
  panelsScroll?.addEventListener(
    "scroll",
    () => {
      try {
        window.Coloris?.close();
      } catch {}
    },
    { passive: true },
  );
  let channelLiveProfileBackground = {
    ...CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT,
  };
  let channelLiveProfileSaveTimer = 0;

  function normalizeChannelLiveProfileColor(value, fallback) {
    const color = String(value || "")
      .trim()
      .toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
  }

  function normalizeChannelLiveProfileNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function channelLiveProfileRgba(color, alphaPercent) {
    const rgb = Number.parseInt(color.slice(1), 16);
    const red = (rgb >> 16) & 255;
    const green = (rgb >> 8) & 255;
    const blue = rgb & 255;
    const alpha = normalizeChannelLiveProfileNumber(alphaPercent, 0, 100, 100);
    return `rgba(${red}, ${green}, ${blue}, ${alpha / 100})`;
  }

  function channelLiveProfileHexa(color, alphaPercent) {
    const alpha = normalizeChannelLiveProfileNumber(alphaPercent, 0, 100, 100);
    const alphaHex = Math.floor((alpha / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${alphaHex}`.toUpperCase();
  }

  function parseChannelLiveProfileHex(value) {
    const match = String(value || "")
      .trim()
      .match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (!match) return null;
    return {
      color: `#${match[1].toLowerCase()}`,
      alpha: match[2]
        ? Math.round((Number.parseInt(match[2], 16) / 255) * 100)
        : 100,
    };
  }

  function reflectChannelLiveProfileColorInput(input, color, alpha, enabled) {
    if (!input) return;
    const value = channelLiveProfileHexa(color, alpha);
    input.value = value;
    input.disabled = !enabled;
    const field = input.closest(".clr-field");
    if (field) {
      field.style.color = value;
      field.classList.toggle("is-disabled", !enabled);
    }
  }

  function normalizeChannelLiveProfileBackground(value) {
    const config = value && typeof value === "object" ? value : {};
    return {
      enabled: config.enabled === true,
      angle: normalizeChannelLiveProfileNumber(
        config.angle,
        0,
        360,
        CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.angle,
      ),
      start: normalizeChannelLiveProfileColor(
        config.start,
        CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.start,
      ),
      startAlpha: normalizeChannelLiveProfileNumber(
        config.startAlpha,
        0,
        100,
        CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.startAlpha,
      ),
      end: normalizeChannelLiveProfileColor(
        config.end,
        CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.end,
      ),
      endAlpha: normalizeChannelLiveProfileNumber(
        config.endAlpha,
        0,
        100,
        CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.endAlpha,
      ),
    };
  }

  function reflectChannelLiveProfileBackground() {
    const config = channelLiveProfileBackground;
    if (channelLiveProfileCustomInput) {
      channelLiveProfileCustomInput.checked = config.enabled;
    }
    reflectChannelLiveProfileColorInput(
      channelLiveProfileStartInput,
      config.start,
      config.startAlpha,
      config.enabled,
    );
    if (channelLiveProfileAngleSlider) {
      channelLiveProfileAngleSlider.value = String(config.angle);
      channelLiveProfileAngleSlider.disabled = !config.enabled;
    }
    if (channelLiveProfileAngleInput) {
      channelLiveProfileAngleInput.value = String(config.angle);
      channelLiveProfileAngleInput.disabled = !config.enabled;
    }
    reflectChannelLiveProfileColorInput(
      channelLiveProfileEndInput,
      config.end,
      config.endAlpha,
      config.enabled,
    );
    if (channelLiveProfileReset) {
      channelLiveProfileReset.disabled = !config.enabled;
    }
    channelLiveProfileEditor?.classList.toggle("is-disabled", !config.enabled);
    channelLiveProfileEditor?.setAttribute(
      "aria-disabled",
      String(!config.enabled),
    );
    channelLiveProfilePreview?.style.setProperty(
      "--channel-profile-preview-angle",
      `${config.angle}deg`,
    );
    channelLiveProfilePreview?.style.setProperty(
      "--channel-profile-preview-start",
      channelLiveProfileRgba(config.start, config.startAlpha),
    );
    channelLiveProfilePreview?.style.setProperty(
      "--channel-profile-preview-end",
      channelLiveProfileRgba(config.end, config.endAlpha),
    );
  }

  function updateChannelLiveProfileBackground(patch, save = true) {
    channelLiveProfileBackground = normalizeChannelLiveProfileBackground({
      ...channelLiveProfileBackground,
      ...patch,
    });
    reflectChannelLiveProfileBackground();
    if (save) {
      clearTimeout(channelLiveProfileSaveTimer);
      channelLiveProfileSaveTimer = 0;
      cachedStorageSet({
        [CHANNEL_LIVE_PROFILE_BACKGROUND_KEY]: channelLiveProfileBackground,
      });
    }
  }

  function scheduleChannelLiveProfileBackgroundSave() {
    clearTimeout(channelLiveProfileSaveTimer);
    channelLiveProfileSaveTimer = window.setTimeout(() => {
      channelLiveProfileSaveTimer = 0;
      cachedStorageSet({
        [CHANNEL_LIVE_PROFILE_BACKGROUND_KEY]: channelLiveProfileBackground,
      });
    }, 120);
  }

  channelLiveProfileCustomInput?.addEventListener("change", () => {
    updateChannelLiveProfileBackground({
      enabled: channelLiveProfileCustomInput.checked,
    });
  });
  function bindChannelLiveProfileRange(slider, input, key) {
    slider?.addEventListener("input", () => {
      updateChannelLiveProfileBackground({ [key]: slider.value }, false);
    });
    slider?.addEventListener("change", () => {
      updateChannelLiveProfileBackground({ [key]: slider.value });
    });
    input?.addEventListener("change", () => {
      updateChannelLiveProfileBackground({ [key]: input.value });
    });
    input?.addEventListener("blur", () => {
      updateChannelLiveProfileBackground({ [key]: input.value });
    });
  }
  bindChannelLiveProfileRange(
    channelLiveProfileAngleSlider,
    channelLiveProfileAngleInput,
    "angle",
  );
  function bindChannelLiveProfileColor(input, colorKey, alphaKey) {
    input?.addEventListener("input", () => {
      const parsed = parseChannelLiveProfileHex(input.value);
      if (!parsed) return;
      updateChannelLiveProfileBackground(
        {
          [colorKey]: parsed.color,
          [alphaKey]: parsed.alpha,
        },
        false,
      );
      scheduleChannelLiveProfileBackgroundSave();
    });
    input?.addEventListener("change", () => {
      const parsed = parseChannelLiveProfileHex(input.value);
      if (!parsed) {
        reflectChannelLiveProfileBackground();
        return;
      }
      updateChannelLiveProfileBackground({
        [colorKey]: parsed.color,
        [alphaKey]: parsed.alpha,
      });
    });
  }
  bindChannelLiveProfileColor(
    channelLiveProfileStartInput,
    "start",
    "startAlpha",
  );
  bindChannelLiveProfileColor(channelLiveProfileEndInput, "end", "endAlpha");
  channelLiveProfileReset?.addEventListener("click", () => {
    updateChannelLiveProfileBackground({
      angle: CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.angle,
      start: CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.start,
      startAlpha: CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.startAlpha,
      end: CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.end,
      endAlpha: CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT.endAlpha,
    });
  });
  reflectChannelLiveProfileBackground();
  (async () => {
    try {
      const data = await cachedStorageGet(CHANNEL_LIVE_PROFILE_BACKGROUND_KEY);
      channelLiveProfileBackground = normalizeChannelLiveProfileBackground(
        data?.[CHANNEL_LIVE_PROFILE_BACKGROUND_KEY],
      );
    } catch {
      channelLiveProfileBackground = {
        ...CHANNEL_LIVE_PROFILE_BACKGROUND_DEFAULT,
      };
    }
    reflectChannelLiveProfileBackground();
  })();

  // ── 방송 시청 중 팔로잉 새 탭으로 열기(전역, 기본 OFF) ──────────────────────
  const FOLLOW_OPEN_NEW_TAB_KEY = "cheeseFollowOpenNewTab";
  const followOpenNewTabInput = document.querySelector(
    "[data-follow-open-new-tab]",
  );
  async function loadFollowOpenNewTab() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(FOLLOW_OPEN_NEW_TAB_KEY);
      on = data?.[FOLLOW_OPEN_NEW_TAB_KEY] === true;
    } catch {}
    if (followOpenNewTabInput) followOpenNewTabInput.checked = on;
  }
  followOpenNewTabInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_OPEN_NEW_TAB_KEY]: followOpenNewTabInput.checked,
      });
    } catch {}
  });
  loadFollowOpenNewTab();

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

  // ── 미리보기 헤더 바 위치(기본 OFF=영상 위, ON=영상 아래) ──────────────────
  const FOLLOW_PREVIEW_HEADER_BOTTOM_KEY = "cheeseFollowPreviewHeaderBottom";
  const followPreviewHeaderBottomInput = document.querySelector(
    "[data-follow-preview-header-bottom]",
  );
  async function loadFollowPreviewHeaderBottom() {
    let on = false; // 기본 위
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_HEADER_BOTTOM_KEY);
      on = data?.[FOLLOW_PREVIEW_HEADER_BOTTOM_KEY] === true;
    } catch {}
    if (followPreviewHeaderBottomInput)
      followPreviewHeaderBottomInput.checked = on;
  }
  followPreviewHeaderBottomInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_HEADER_BOTTOM_KEY]:
          followPreviewHeaderBottomInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewHeaderBottom();

  // ── 미리보기 헤더 전체 숨김(기본 OFF) ────────────────────────────────────
  const FOLLOW_PREVIEW_HIDE_HEADER_KEY = "cheeseFollowPreviewHideHeader";
  const followPreviewHideHeaderInput = document.querySelector(
    "[data-follow-preview-hide-header]",
  );
  async function loadFollowPreviewHideHeader() {
    let on = false;
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_HIDE_HEADER_KEY);
      on = data?.[FOLLOW_PREVIEW_HIDE_HEADER_KEY] === true;
    } catch {}
    if (followPreviewHideHeaderInput) followPreviewHideHeaderInput.checked = on;
  }
  followPreviewHideHeaderInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_HIDE_HEADER_KEY]: followPreviewHideHeaderInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewHideHeader();

  // ── 미리보기 라이브 카드식 헤더 배치(기본 OFF) ────────────────────────────
  const FOLLOW_PREVIEW_CARD_LAYOUT_KEY = "cheeseFollowPreviewCardLayout";
  const followPreviewCardLayoutInput = document.querySelector(
    "[data-follow-preview-card-layout]",
  );
  async function loadFollowPreviewCardLayout() {
    let on = false; // 기본 기존 배치
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_CARD_LAYOUT_KEY);
      on = data?.[FOLLOW_PREVIEW_CARD_LAYOUT_KEY] === true;
    } catch {}
    if (followPreviewCardLayoutInput) followPreviewCardLayoutInput.checked = on;
    // 카드식 배치 체크 상태가 정해진 뒤에 하위 항목 잠금을 다시 평가한다
    // (아래 async 로더가 먼저 끝나면 옛 상태로 잠글 수 있다).
    reflectFpCardDependents();
  }
  followPreviewCardLayoutInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOW_PREVIEW_CARD_LAYOUT_KEY]: followPreviewCardLayoutInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewCardLayout();

  // ── 카드식 배치: 시청자 배지 위치(tl|tr|bl|br, 기본 tl) ────────────────────
  const FP_BADGE_POS_KEY = "cheeseFollowPreviewBadgePos";
  const FP_BADGE_POSITIONS = ["tl", "tr", "bl", "br"];
  const fpBadgeButtons = Array.from(
    document.querySelectorAll("[data-follow-preview-badge-pos]"),
  );
  function reflectFpBadgePos(raw) {
    const pos = FP_BADGE_POSITIONS.includes(raw) ? raw : "tl";
    fpBadgeButtons.forEach((btn) => {
      const active = btn.dataset.followPreviewBadgePos === pos;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }
  // 카드식 배치가 꺼져 있으면 배지 자체가 안 보이므로 잠근다.
  function reflectFpCardDependents() {
    // ⚠ 위쪽 loadFollowPreviewCardLayout() 도 이 함수를 부른다. 그 시점엔 아래 const
    // 들이 아직 초기화 전일 수 있어(TDZ) 캡처 변수 대신 DOM 에서 직접 찾는다.
    const input = document.querySelector("[data-follow-preview-card-layout]");
    const off = input?.checked !== true;
    document
      .querySelectorAll("[data-follow-preview-badge-pos]")
      .forEach((btn) => {
        btn.disabled = off;
      });
    document
      .querySelector("[data-follow-preview-badge-item]")
      ?.classList.toggle("is-locked", off);
  }
  fpBadgeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const pos = btn.dataset.followPreviewBadgePos;
      reflectFpBadgePos(pos);
      try {
        cachedStorageSet({ [FP_BADGE_POS_KEY]: pos });
      } catch {}
    });
  });
  followPreviewCardLayoutInput?.addEventListener(
    "change",
    reflectFpCardDependents,
  );
  (async () => {
    let pos = "tl";
    try {
      const data = await cachedStorageGet(FP_BADGE_POS_KEY);
      if (data?.[FP_BADGE_POS_KEY]) pos = data[FP_BADGE_POS_KEY];
    } catch {}
    reflectFpBadgePos(pos);
    reflectFpCardDependents();
  })();

  // ── 미리보기 헤더 글자 색상(제목·채널명·카테고리·경과시간) ─────────────────
  // 항목별로 { enabled, light, dark } 를 하나의 키에 모아 저장한다. 카테고리는
  // content.js 가 고른 색에서 테두리·배경까지 파생하므로 여기서는 색 하나만 받는다.
  const FP_COLORS_KEY = "cheeseFollowPreviewColors";
  const FP_COLOR_DEFAULTS = Object.freeze({
    title: { light: "#FFFFFF", dark: "#FFFFFF" },
    name: { light: "#17171C", dark: "#FFFFFF" },
    category: { light: "#17171C", dark: "#FFFFFF" },
    elapsed: { light: "#17171C", dark: "#FFFFFF" },
  });
  let fpColors = {};
  function normalizeFpHex(v, fallback) {
    const s = String(v || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
      return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
    }
    return fallback;
  }
  function reflectFpColors() {
    for (const [part, def] of Object.entries(FP_COLOR_DEFAULTS)) {
      const cfg = fpColors[part] || { enabled: false, ...def };
      const toggle = document.querySelector(
        `[data-fp-color-enabled="${part}"]`,
      );
      if (toggle) toggle.checked = cfg.enabled === true;
      const editor = document.querySelector(`[data-fp-color-editor="${part}"]`);
      if (editor) editor.hidden = !cfg.enabled;
      const reset = document.querySelector(`[data-fp-color-reset="${part}"]`);
      if (reset) reset.disabled = !cfg.enabled;
      ["light", "dark"].forEach((mode) => {
        const input = document.querySelector(
          `[data-fp-color="${part}"][data-fp-color-mode="${mode}"]`,
        );
        if (!input) return;
        input.value = cfg[mode];
        input.disabled = !cfg.enabled;
        const field = input.closest(".clr-field");
        if (field) field.style.color = cfg[mode];
      });
    }
  }
  function saveFpColors() {
    try {
      cachedStorageSet({ [FP_COLORS_KEY]: { ...fpColors } });
    } catch {}
  }
  document.querySelectorAll("[data-fp-color-enabled]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const part = toggle.dataset.fpColorEnabled;
      if (!fpColors[part]) fpColors[part] = { ...FP_COLOR_DEFAULTS[part] };
      fpColors[part].enabled = toggle.checked;
      reflectFpColors();
      saveFpColors();
    });
  });
  document.querySelectorAll("[data-fp-color]").forEach((input) => {
    // Coloris 는 input 이벤트로 색을 흘려보낸다(change 까지 기다리면 반영이 늦다).
    input.addEventListener("input", () => {
      const part = input.dataset.fpColor;
      const mode = input.dataset.fpColorMode;
      if (!fpColors[part]) fpColors[part] = { ...FP_COLOR_DEFAULTS[part] };
      fpColors[part][mode] = normalizeFpHex(
        input.value,
        FP_COLOR_DEFAULTS[part][mode],
      );
      const field = input.closest(".clr-field");
      if (field) field.style.color = fpColors[part][mode];
      saveFpColors();
    });
  });
  document.querySelectorAll("[data-fp-color-reset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const part = btn.dataset.fpColorReset;
      fpColors[part] = {
        ...FP_COLOR_DEFAULTS[part],
        enabled: fpColors[part]?.enabled === true,
      };
      reflectFpColors();
      saveFpColors();
    });
  });
  (async () => {
    let saved = null;
    try {
      const data = await cachedStorageGet(FP_COLORS_KEY);
      saved = data?.[FP_COLORS_KEY];
    } catch {}
    for (const [part, def] of Object.entries(FP_COLOR_DEFAULTS)) {
      const v = saved && typeof saved === "object" ? saved[part] : null;
      fpColors[part] = {
        enabled: v?.enabled === true,
        light: normalizeFpHex(v?.light, def.light),
        dark: normalizeFpHex(v?.dark, def.dark),
      };
    }
    reflectFpColors();
  })();

  // 미리보기 헤더에서 숨길 요소(개별 체크=숨김). {title,profile,name,category,viewers,
  // elapsed} 객체 한 키에 모아 저장한다.
  const FOLLOW_PREVIEW_HIDDEN_PARTS_KEY = "cheeseFollowPreviewHiddenParts";
  const followPreviewHidePartInputs = Array.from(
    document.querySelectorAll("[data-follow-preview-hide-part]"),
  );
  function saveFollowPreviewHiddenParts() {
    const parts = {};
    followPreviewHidePartInputs.forEach((el) => {
      if (el.checked) parts[el.dataset.followPreviewHidePart] = true;
    });
    try {
      cachedStorageSet({ [FOLLOW_PREVIEW_HIDDEN_PARTS_KEY]: parts });
    } catch {}
  }
  (async () => {
    let parts = {};
    try {
      const data = await cachedStorageGet(FOLLOW_PREVIEW_HIDDEN_PARTS_KEY);
      const v = data?.[FOLLOW_PREVIEW_HIDDEN_PARTS_KEY];
      if (v && typeof v === "object") parts = v;
    } catch {}
    followPreviewHidePartInputs.forEach((el) => {
      el.checked = parts[el.dataset.followPreviewHidePart] === true;
    });
  })();
  followPreviewHidePartInputs.forEach((el) =>
    el.addEventListener("change", saveFollowPreviewHiddenParts),
  );

  // 미리보기: 시청자 수/방송 시간 항상 표시(창이 좁아도). 각각 기본 OFF.
  function bindFollowPreviewAlwaysToggle(selector, key) {
    const input = document.querySelector(selector);
    if (!input) return;
    (async () => {
      let on = false;
      try {
        const d = await cachedStorageGet(key);
        on = d?.[key] === true;
      } catch {}
      input.checked = on;
    })();
    input.addEventListener("change", () => {
      try {
        cachedStorageSet({ [key]: input.checked });
      } catch {}
    });
  }
  bindFollowPreviewAlwaysToggle(
    "[data-follow-preview-always-viewers]",
    "cheeseFollowPreviewAlwaysViewers",
  );
  bindFollowPreviewAlwaysToggle(
    "[data-follow-preview-always-elapsed]",
    "cheeseFollowPreviewAlwaysElapsed",
  );

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
  const CARD_LIVE_PREVIEW_POSITION_KEY = "cheeseCardLivePreviewPosition";
  const cardLivePreviewInput = document.querySelector(
    "[data-card-live-preview]",
  );
  const cardLivePreviewPositionItem = document.querySelector(
    "[data-card-live-preview-position-item]",
  );
  const cardLivePreviewPositionButtons = Array.from(
    document.querySelectorAll("[data-card-live-preview-position]"),
  );
  function normalizeCardLivePreviewPosition(value) {
    return value === "left" || value === "right" ? value : "auto";
  }
  function reflectCardLivePreviewPosition(value) {
    const position = normalizeCardLivePreviewPosition(value);
    cardLivePreviewPositionButtons.forEach((button) => {
      const active = button.dataset.cardLivePreviewPosition === position;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }
  function reflectCardLivePreviewPositionAvailability() {
    const disabled = !cardLivePreviewInput?.checked;
    cardLivePreviewPositionButtons.forEach((button) => {
      button.disabled = disabled;
    });
    cardLivePreviewPositionItem?.classList.toggle("is-locked", disabled);
  }
  async function loadCardLivePreview() {
    let on = false; // 기본 꺼짐
    let position = "auto";
    try {
      const data = await cachedStorageGet([
        CARD_LIVE_PREVIEW_KEY,
        CARD_LIVE_PREVIEW_POSITION_KEY,
      ]);
      on = data?.[CARD_LIVE_PREVIEW_KEY] === true;
      position = normalizeCardLivePreviewPosition(
        data?.[CARD_LIVE_PREVIEW_POSITION_KEY],
      );
    } catch {}
    if (cardLivePreviewInput) cardLivePreviewInput.checked = on;
    reflectCardLivePreviewPosition(position);
    reflectCardLivePreviewPositionAvailability();
  }
  cardLivePreviewInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CARD_LIVE_PREVIEW_KEY]: cardLivePreviewInput.checked,
      });
    } catch {}
    reflectCardLivePreviewPositionAvailability();
  });
  cardLivePreviewPositionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const position = normalizeCardLivePreviewPosition(
        button.dataset.cardLivePreviewPosition,
      );
      reflectCardLivePreviewPosition(position);
      try {
        cachedStorageSet({ [CARD_LIVE_PREVIEW_POSITION_KEY]: position });
      } catch {}
    });
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

  // PIP 전환 끄기(기본 OFF).
  const PIP_DISABLE_KEY = "cheesePipDisable";
  const pipDisableInput = document.querySelector("[data-pip-disable]");
  async function loadPipDisable() {
    let on = false; // 기본 꺼짐(치지직 기본 동작 유지)
    try {
      const data = await cachedStorageGet(PIP_DISABLE_KEY);
      on = data?.[PIP_DISABLE_KEY] === true;
    } catch {}
    if (pipDisableInput) pipDisableInput.checked = on;
  }
  pipDisableInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({ [PIP_DISABLE_KEY]: pipDisableInput.checked });
    } catch {}
  });
  loadPipDisable();

  // 다시보기 채팅 활성도 그래프(기본 OFF).
  const VOD_CHAT_GRAPH_KEY = "cheeseVodChatGraph";
  const vodChatGraphInput = document.querySelector("[data-vod-chat-graph]");
  async function loadVodChatGraph() {
    let on = false; // 기본 꺼짐 — 켜도 버튼만 생기고, 눌러야 수집한다
    try {
      const data = await cachedStorageGet(VOD_CHAT_GRAPH_KEY);
      on = data?.[VOD_CHAT_GRAPH_KEY] === true;
    } catch {}
    if (vodChatGraphInput) vodChatGraphInput.checked = on;
  }
  vodChatGraphInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({ [VOD_CHAT_GRAPH_KEY]: vodChatGraphInput.checked });
    } catch {}
  });
  loadVodChatGraph();

  // 채팅 활성도 그래프의 후원·구독 색(Coloris). 기본값은 content.css 와 맞춘다.
  const VOD_CHAT_GRAPH_COLORS_KEY = "cheeseVodChatGraphColors";
  const VOD_CHAT_GRAPH_COLORS_DEFAULT = {
    donation: "#F5C518",
    subscription: "#8B5CF6",
  };
  const vodChatGraphColorInputs = document.querySelectorAll(
    "[data-vod-chat-graph-color]",
  );
  const vodChatGraphColorReset = document.querySelector(
    "[data-vod-chat-graph-color-reset]",
  );

  function reflectVodChatGraphColors(colors) {
    vodChatGraphColorInputs.forEach((input) => {
      const key = input.dataset.vodChatGraphColor;
      const v = colors?.[key] || VOD_CHAT_GRAPH_COLORS_DEFAULT[key];
      if (v) {
        input.value = v;
        // Coloris 는 wrap 한 부모의 배경으로 견본을 보여 준다.
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  async function loadVodChatGraphColors() {
    let colors = { ...VOD_CHAT_GRAPH_COLORS_DEFAULT };
    try {
      const data = await cachedStorageGet(VOD_CHAT_GRAPH_COLORS_KEY);
      const saved = data?.[VOD_CHAT_GRAPH_COLORS_KEY];
      if (saved && typeof saved === "object") colors = { ...colors, ...saved };
    } catch {}
    reflectVodChatGraphColors(colors);
  }

  function saveVodChatGraphColors() {
    const colors = { ...VOD_CHAT_GRAPH_COLORS_DEFAULT };
    vodChatGraphColorInputs.forEach((input) => {
      const key = input.dataset.vodChatGraphColor;
      const v = String(input.value || "").trim();
      if (key && /^#[0-9a-f]{6}$/i.test(v)) colors[key] = v.toUpperCase();
    });
    try {
      cachedStorageSet({ [VOD_CHAT_GRAPH_COLORS_KEY]: colors });
    } catch {}
  }

  vodChatGraphColorInputs.forEach((input) => {
    // Coloris 는 input 이벤트로 색을 흘려보낸다(change 까지 기다리면 반영이 늦다).
    input.addEventListener("input", saveVodChatGraphColors);
    input.addEventListener("change", saveVodChatGraphColors);
  });
  vodChatGraphColorReset?.addEventListener("click", () => {
    reflectVodChatGraphColors(VOD_CHAT_GRAPH_COLORS_DEFAULT);
    try {
      cachedStorageSet({
        [VOD_CHAT_GRAPH_COLORS_KEY]: { ...VOD_CHAT_GRAPH_COLORS_DEFAULT },
      });
    } catch {}
  });
  loadVodChatGraphColors();

  // 팔로잉 LIVE 정렬 기억(기본 ON).
  const FOLLOWING_LIVE_SORT_KEY = "cheeseFollowingLiveSortRemember";
  const followingLiveSortInput = document.querySelector(
    "[data-following-live-sort]",
  );
  async function loadFollowingLiveSort() {
    let on = true; // 미설정/true=ON
    try {
      const data = await cachedStorageGet(FOLLOWING_LIVE_SORT_KEY);
      on = data?.[FOLLOWING_LIVE_SORT_KEY] !== false;
    } catch {}
    if (followingLiveSortInput) followingLiveSortInput.checked = on;
  }
  followingLiveSortInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [FOLLOWING_LIVE_SORT_KEY]: followingLiveSortInput.checked,
      });
    } catch {}
  });
  loadFollowingLiveSort();

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

  // 독립 채팅 팝업의 Document Picture-in-Picture 항상 위 버튼(기본 OFF).
  const CHAT_POPUP_PIP_KEY = "cheeseChatPopupPip";
  const chatPopupPipInput = document.querySelector("[data-chat-popup-pip]");
  async function loadChatPopupPip() {
    let on = false;
    try {
      const data = await cachedStorageGet(CHAT_POPUP_PIP_KEY);
      on = data?.[CHAT_POPUP_PIP_KEY] === true;
    } catch {}
    if (chatPopupPipInput) chatPopupPipInput.checked = on;
  }
  chatPopupPipInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CHAT_POPUP_PIP_KEY]: chatPopupPipInput.checked,
      });
    } catch {}
  });
  loadChatPopupPip();

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
    reflectCardPreviewAudioChildrenEnabled();
  }

  // 음소거 해제 기본 음량(1~100%, 저장은 0~1 배율).
  const CARD_PREVIEW_DEFAULT_VOLUME_KEY = "cheeseCardPreviewDefaultVolume";
  const cardDefaultVolumeItem = document.querySelector(
    "[data-card-preview-default-volume-item]",
  );
  const cardDefaultVolumeSlider = document.querySelector(
    "[data-card-preview-default-volume-slider]",
  );
  const cardDefaultVolumeInput = document.querySelector(
    "[data-card-preview-default-volume]",
  );
  function clampCardDefaultVolumePct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(1, Math.round(n)));
  }
  function reflectCardDefaultVolume(pct) {
    const value = clampCardDefaultVolumePct(pct);
    if (cardDefaultVolumeSlider) {
      cardDefaultVolumeSlider.value = String(value);
    }
    if (cardDefaultVolumeInput) {
      cardDefaultVolumeInput.value = String(value);
    }
  }
  async function loadCardDefaultVolume() {
    let pct = 50;
    try {
      const data = await cachedStorageGet(CARD_PREVIEW_DEFAULT_VOLUME_KEY);
      const scale = Number(data?.[CARD_PREVIEW_DEFAULT_VOLUME_KEY]);
      pct = Number.isFinite(scale) ? scale * 100 : 50;
    } catch {}
    reflectCardDefaultVolume(pct);
    reflectCardPreviewAudioChildrenEnabled();
  }
  function saveCardDefaultVolume(pct) {
    const value = clampCardDefaultVolumePct(pct);
    reflectCardDefaultVolume(value);
    try {
      cachedStorageSet({
        [CARD_PREVIEW_DEFAULT_VOLUME_KEY]: value / 100,
      });
    } catch {}
  }
  cardDefaultVolumeSlider?.addEventListener("input", () => {
    saveCardDefaultVolume(cardDefaultVolumeSlider.value);
  });
  cardDefaultVolumeInput?.addEventListener("change", () => {
    saveCardDefaultVolume(cardDefaultVolumeInput.value);
  });
  cardDefaultVolumeInput?.addEventListener("blur", () => {
    saveCardDefaultVolume(cardDefaultVolumeInput.value);
  });

  // 하위 음량 설정. 부모(카드 미리보기 음량)가 꺼져 있으면 모두 비활성화.
  const CARD_PREVIEW_WHEEL_DELAY_KEY = "cheeseCardPreviewWheelDelaySec";
  const cardWheelDelayInput = document.querySelector(
    "[data-card-preview-wheel-delay]",
  );
  function clampCardWheelDelay(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.min(5, Math.max(0, Math.round(n * 2) / 2)); // 0~5, 0.5 단위
  }
  function reflectCardPreviewAudioChildrenEnabled() {
    const parentOn = !!cardPreviewAudioInput?.checked;
    if (cardDefaultVolumeSlider) {
      cardDefaultVolumeSlider.disabled = !parentOn;
    }
    if (cardDefaultVolumeInput) {
      cardDefaultVolumeInput.disabled = !parentOn;
    }
    cardDefaultVolumeItem?.classList.toggle("is-locked", !parentOn);
    if (cardWheelDelayInput) cardWheelDelayInput.disabled = !parentOn;
    cardWheelDelayInput
      ?.closest(".settings-item")
      ?.classList.toggle("is-locked", !parentOn);
  }
  async function loadCardWheelDelay() {
    let v = 1;
    try {
      const d = await cachedStorageGet(CARD_PREVIEW_WHEEL_DELAY_KEY);
      v = clampCardWheelDelay(d?.[CARD_PREVIEW_WHEEL_DELAY_KEY] ?? 1);
    } catch {}
    if (cardWheelDelayInput) cardWheelDelayInput.value = String(v);
    reflectCardPreviewAudioChildrenEnabled();
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
    reflectCardPreviewAudioChildrenEnabled();
  });
  loadCardPreviewAudio();
  loadCardDefaultVolume();
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

  // ── 다시보기 AI 챕터 숨김(전역, 기본 OFF=표시) ───────────────────────────────
  const VOD_CHAPTER_HIDE_KEY = "cheeseVodChapterHide";
  const vodChapterHideInput = document.querySelector("[data-vod-chapter-hide]");

  async function loadVodChapterHide() {
    let on = false; // 기본 꺼짐(챕터 표시)
    try {
      const data = await cachedStorageGet(VOD_CHAPTER_HIDE_KEY);
      on = data?.[VOD_CHAPTER_HIDE_KEY] === true;
    } catch {}
    if (vodChapterHideInput) vodChapterHideInput.checked = on;
  }

  vodChapterHideInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [VOD_CHAPTER_HIDE_KEY]: vodChapterHideInput.checked,
      });
    } catch {}
  });
  loadVodChapterHide();

  // ── 차단 이용자 댓글 안내 숨김(다시보기·커뮤니티, 전역 기본 OFF) ─────────────
  const HIDE_BLOCKED_COMMENT_KEY = "cheeseHideBlockedComment";
  const hideBlockedCommentInput = document.querySelector(
    "[data-hide-blocked-comment]",
  );

  async function loadHideBlockedComment() {
    let on = false; // 기본 꺼짐(안내 표시)
    try {
      const data = await cachedStorageGet(HIDE_BLOCKED_COMMENT_KEY);
      on = data?.[HIDE_BLOCKED_COMMENT_KEY] === true;
    } catch {}
    if (hideBlockedCommentInput) hideBlockedCommentInput.checked = on;
  }

  hideBlockedCommentInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [HIDE_BLOCKED_COMMENT_KEY]: hideBlockedCommentInput.checked,
      });
    } catch {}
  });
  loadHideBlockedComment();

  // ── 채팅 프로필 팝오버의 치즈 플래터 차단 버튼(전역, 기본 OFF) ───────────────
  const CHAT_PROFILE_BLOCK_BUTTON_KEY = "cheeseChatProfileBlockButton";
  const chatProfileBlockButtonInput = document.querySelector(
    "[data-chat-profile-block-button]",
  );

  async function loadChatProfileBlockButton() {
    let on = false;
    try {
      const data = await cachedStorageGet(CHAT_PROFILE_BLOCK_BUTTON_KEY);
      on = data?.[CHAT_PROFILE_BLOCK_BUTTON_KEY] === true;
    } catch {}
    if (chatProfileBlockButtonInput) {
      chatProfileBlockButtonInput.checked = on;
    }
  }

  chatProfileBlockButtonInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [CHAT_PROFILE_BLOCK_BUTTON_KEY]: chatProfileBlockButtonInput.checked,
      });
    } catch {}
  });
  loadChatProfileBlockButton();

  // ── 전체 방송·팔로잉 라이브 제외 필터 ────────────────────────────────────
  const LIVE_TAG_FILTERS_KEY = "cheeseLiveTagFilters";
  const LIVE_TAG_FILTER_BUTTON_KEY = "cheeseLiveTagFilterButton";
  const LIVE_VIEWER_COUNT_POSITION_KEY = "cheeseLiveViewerCountPosition";
  const LIVE_VIEWER_COUNT_INLINE_KEY = "cheeseLiveViewerCountInline";
  const LIVE_VIEWER_COUNT_HIDDEN_KEY = "cheeseLiveViewerCountHidden";
  const liveTagFilterButtonInput = document.querySelector(
    "[data-live-tag-filter-button]",
  );
  const liveViewerCountPositionButtons = Array.from(
    document.querySelectorAll("[data-live-viewer-count-position-value]"),
  );
  const liveTagForm = document.querySelector("[data-live-tag-form]");
  const liveTagInput = document.querySelector("[data-live-tag-input]");
  const liveTagList = document.querySelector("[data-live-tag-list]");
  const liveTagEmpty = document.querySelector("[data-live-tag-empty]");
  const liveTagBulk = document.querySelector("[data-live-tag-bulk]");
  const liveTagSelectAll = document.querySelector("[data-live-tag-select-all]");
  const liveTagSelectedCount = document.querySelector(
    "[data-live-tag-selected-count]",
  );
  const liveTagRemoveSelected = document.querySelector(
    "[data-live-tag-remove-selected]",
  );
  const liveTagRemoveAll = document.querySelector("[data-live-tag-remove-all]");
  let settingsLiveTagFilters = [];
  const settingsLiveTagSelected = new Set();

  const LIVE_VIEWER_COUNT_POSITIONS = new Set([
    "native",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
    "hidden",
  ]);

  function normalizeLiveViewerCountPosition(value) {
    return LIVE_VIEWER_COUNT_POSITIONS.has(value) ? value : "native";
  }

  function legacyLiveViewerCountPosition(data) {
    if (data?.[LIVE_VIEWER_COUNT_HIDDEN_KEY] === true) return "hidden";
    if (data?.[LIVE_VIEWER_COUNT_INLINE_KEY] === true) return "top-left";
    return "native";
  }

  function reflectLiveViewerCountPosition(value) {
    const position = normalizeLiveViewerCountPosition(value);
    liveViewerCountPositionButtons.forEach((button) => {
      const active = button.dataset.liveViewerCountPositionValue === position;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function normalizeLiveTagFilter(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("ko-KR");
  }

  function sanitizeLiveTagFilters(value) {
    const result = [];
    const seen = new Set();
    for (const raw of Array.isArray(value) ? value : []) {
      const display = String(raw || "")
        .normalize("NFKC")
        .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^#+\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      const key = normalizeLiveTagFilter(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(display);
    }
    return result;
  }

  function parseLiveTagFilterInput(value) {
    return sanitizeLiveTagFilters(String(value || "").split(/[,\n]+/));
  }

  function renderSettingsLiveTagFilters() {
    if (!liveTagList) return;
    const existing = new Set(
      settingsLiveTagFilters.map(normalizeLiveTagFilter),
    );
    for (const key of [...settingsLiveTagSelected]) {
      if (!existing.has(key)) settingsLiveTagSelected.delete(key);
    }

    liveTagList.innerHTML = settingsLiveTagFilters
      .map((tag, index) => {
        const key = normalizeLiveTagFilter(tag);
        return `
          <li class="settings-live-tag-row">
            <label>
              <input type="checkbox" data-live-tag-select="${index}" ${
                settingsLiveTagSelected.has(key) ? "checked" : ""
              }>
              <span>${escapeHtml(tag)}</span>
            </label>
            <button type="button" data-live-tag-remove="${index}" aria-label="${escapeHtml(
              tag,
            )} 제외 항목 삭제" title="삭제">
              <svg class="lucide lucide-trash-2" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <path d="M10 11v6"/>
                <path d="M14 11v6"/>
              </svg>
            </button>
          </li>`;
      })
      .join("");

    const count = settingsLiveTagSelected.size;
    const hasItems = settingsLiveTagFilters.length > 0;
    if (liveTagEmpty) liveTagEmpty.hidden = hasItems;
    if (liveTagBulk) liveTagBulk.hidden = !hasItems;
    if (liveTagSelectedCount) {
      liveTagSelectedCount.textContent = count ? `${count}개 선택됨` : "";
    }
    if (liveTagRemoveSelected) liveTagRemoveSelected.disabled = count === 0;
    if (liveTagRemoveAll) liveTagRemoveAll.disabled = !hasItems;
    if (liveTagSelectAll) {
      liveTagSelectAll.checked =
        hasItems && count === settingsLiveTagFilters.length;
      liveTagSelectAll.indeterminate =
        count > 0 && count < settingsLiveTagFilters.length;
    }
  }

  function saveSettingsLiveTagFilters(next) {
    settingsLiveTagFilters = sanitizeLiveTagFilters(next);
    renderSettingsLiveTagFilters();
    cachedStorageSet({ [LIVE_TAG_FILTERS_KEY]: settingsLiveTagFilters });
  }

  liveTagFilterButtonInput?.addEventListener("change", () => {
    cachedStorageSet({
      [LIVE_TAG_FILTER_BUTTON_KEY]: liveTagFilterButtonInput.checked,
    });
  });
  liveViewerCountPositionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const position = normalizeLiveViewerCountPosition(
        button.dataset.liveViewerCountPositionValue,
      );
      reflectLiveViewerCountPosition(position);
      cachedStorageSet({ [LIVE_VIEWER_COUNT_POSITION_KEY]: position });
    });
  });

  liveTagForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const added = parseLiveTagFilterInput(liveTagInput?.value);
    if (!added.length) {
      liveTagInput?.focus();
      return;
    }
    saveSettingsLiveTagFilters([...settingsLiveTagFilters, ...added]);
    if (liveTagInput) liveTagInput.value = "";
    liveTagInput?.focus();
  });

  liveTagList?.addEventListener("change", (event) => {
    const checkbox = event.target.closest?.("[data-live-tag-select]");
    if (!checkbox) return;
    const tag = settingsLiveTagFilters[Number(checkbox.dataset.liveTagSelect)];
    const key = normalizeLiveTagFilter(tag);
    if (!key) return;
    if (checkbox.checked) settingsLiveTagSelected.add(key);
    else settingsLiveTagSelected.delete(key);
    renderSettingsLiveTagFilters();
  });

  liveTagList?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-live-tag-remove]");
    if (!button) return;
    const index = Number(button.dataset.liveTagRemove);
    if (!Number.isInteger(index) || !settingsLiveTagFilters[index]) return;
    const removed = settingsLiveTagFilters[index];
    settingsLiveTagSelected.delete(normalizeLiveTagFilter(removed));
    saveSettingsLiveTagFilters(
      settingsLiveTagFilters.filter((_, itemIndex) => itemIndex !== index),
    );
  });

  liveTagSelectAll?.addEventListener("change", () => {
    settingsLiveTagSelected.clear();
    if (liveTagSelectAll.checked) {
      settingsLiveTagFilters.forEach((tag) =>
        settingsLiveTagSelected.add(normalizeLiveTagFilter(tag)),
      );
    }
    renderSettingsLiveTagFilters();
  });

  liveTagRemoveSelected?.addEventListener("click", () => {
    if (!settingsLiveTagSelected.size) return;
    saveSettingsLiveTagFilters(
      settingsLiveTagFilters.filter(
        (tag) => !settingsLiveTagSelected.has(normalizeLiveTagFilter(tag)),
      ),
    );
    settingsLiveTagSelected.clear();
    renderSettingsLiveTagFilters();
  });

  liveTagRemoveAll?.addEventListener("click", () => {
    if (!settingsLiveTagFilters.length) return;
    openCbmConfirm({
      title: "제외 필터 전체 삭제",
      body: `추가한 제외 항목 ${settingsLiveTagFilters.length}개를 모두 삭제할까요?`,
      confirmLabel: "전체 삭제",
      onConfirm: () => {
        settingsLiveTagSelected.clear();
        saveSettingsLiveTagFilters([]);
      },
    });
  });

  async function loadSettingsLiveTagFilters() {
    try {
      const data = await cachedStorageGet([
        LIVE_TAG_FILTERS_KEY,
        LIVE_TAG_FILTER_BUTTON_KEY,
        LIVE_VIEWER_COUNT_POSITION_KEY,
        LIVE_VIEWER_COUNT_INLINE_KEY,
        LIVE_VIEWER_COUNT_HIDDEN_KEY,
      ]);
      settingsLiveTagFilters = sanitizeLiveTagFilters(
        data?.[LIVE_TAG_FILTERS_KEY],
      );
      if (liveTagFilterButtonInput) {
        liveTagFilterButtonInput.checked =
          data?.[LIVE_TAG_FILTER_BUTTON_KEY] === true;
      }
      const hasStoredPosition = LIVE_VIEWER_COUNT_POSITIONS.has(
        data?.[LIVE_VIEWER_COUNT_POSITION_KEY],
      );
      const position = hasStoredPosition
        ? data[LIVE_VIEWER_COUNT_POSITION_KEY]
        : legacyLiveViewerCountPosition(data);
      reflectLiveViewerCountPosition(position);
      if (!hasStoredPosition) {
        cachedStorageSet({ [LIVE_VIEWER_COUNT_POSITION_KEY]: position });
      }
    } catch {
      settingsLiveTagFilters = [];
      if (liveTagFilterButtonInput) liveTagFilterButtonInput.checked = false;
      reflectLiveViewerCountPosition("native");
    }
    renderSettingsLiveTagFilters();
  }

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[LIVE_TAG_FILTERS_KEY]) {
        settingsLiveTagFilters = sanitizeLiveTagFilters(
          changes[LIVE_TAG_FILTERS_KEY].newValue,
        );
        renderSettingsLiveTagFilters();
      }
      if (changes[LIVE_TAG_FILTER_BUTTON_KEY] && liveTagFilterButtonInput) {
        liveTagFilterButtonInput.checked =
          changes[LIVE_TAG_FILTER_BUTTON_KEY].newValue === true;
      }
      if (changes[LIVE_VIEWER_COUNT_POSITION_KEY]) {
        reflectLiveViewerCountPosition(
          changes[LIVE_VIEWER_COUNT_POSITION_KEY].newValue,
        );
      }
    });
  }
  void loadSettingsLiveTagFilters();

  // ── 사용자 차단 관리 탭(댓글 차단 목록: 닉네임/사유/일시, 검색, 선택/일괄 해제) ──
  const COMMENT_BLOCK_KEY = "cheeseCommentBlocks";
  const cbmSearchInput = document.querySelector("[data-cbm-search]");
  const cbmViewportEl = document.querySelector("[data-cbm-viewport]");
  const cbmSizerEl = document.querySelector("[data-cbm-sizer]");
  const cbmListEl = document.querySelector("[data-cbm-list]");
  const cbmEmptyEl = document.querySelector("[data-cbm-empty]");
  const cbmBulkBar = document.querySelector("[data-cbm-bulk]");
  const cbmSelectAll = document.querySelector("[data-cbm-selectall]");
  const cbmSelCount = document.querySelector("[data-cbm-selcount]");
  const cbmRemoveSelBtn = document.querySelector("[data-cbm-remove-selected]");
  const cbmRemoveAllBtn = document.querySelector("[data-cbm-remove-all]");
  let cbmBlocks = [];
  const cbmSelected = new Set(); // 선택된 userIdHash

  // ── 설정 팝업 토스트(차단/해제 결과 안내) ─────────────────────────────────
  const settingsToastEl = document.querySelector("[data-settings-toast]");
  let settingsToastTimer = 0;
  function settingsToast(text, kind) {
    if (!settingsToastEl || !text) return;
    if (settingsToastTimer) {
      clearTimeout(settingsToastTimer);
      settingsToastTimer = 0;
    }
    settingsToastEl.textContent = text;
    settingsToastEl.dataset.kind = kind || "";
    settingsToastEl.hidden = false;
    // reflow 후 클래스 부여로 트랜지션 발동.
    void settingsToastEl.offsetHeight;
    settingsToastEl.classList.add("is-show");
    settingsToastTimer = setTimeout(() => {
      settingsToastEl.classList.remove("is-show");
      settingsToastTimer = setTimeout(() => {
        settingsToastEl.hidden = true;
        settingsToastTimer = 0;
      }, 200);
    }, 2400);
  }

  // ── 설정 JSON 내보내기·불러오기 ──────────────────────────────────────────
  const SETTINGS_TRANSFER_FORMAT = "chzzk-platter-settings";
  const SETTINGS_TRANSFER_SCHEMA_VERSION = 1;
  // 계정별 클립 보관함을 최대치로 사용하면 백업이 수십 MB가 될 수 있다. 직접 만든
  // 전체 백업도 다시 읽을 수 있게 하되, 손상되거나 지나치게 큰 파일로 설정창이
  // 멈추는 것은 막기 위해 넉넉한 상한만 둔다.
  const SETTINGS_IMPORT_MAX_BYTES = 256 * 1024 * 1024;
  const SETTINGS_TRANSFER_KEYS = new Set(SETTINGS_STORAGE_KEYS);
  const SETTINGS_FULL_DATA_KEYS = new Set([
    "cheeseClipVault", // 계정별 저장 이전의 레거시 보관함
    "cheeseLogPowerLog",
    "cheeseLogPowerReadAt",
    "cheeseLogPowerStatsExplorerKnownIds",
    "cheeseLogPowerStatsExplorerUnreadIds",
    "chatRecapEmojis",
    "chatRecapLockedEmojis",
    "chatRecapImportedVideos",
    "chatRecapVerifiedVideosV2",
    "chatRecapVodEventLinksV3",
    "chatRecapHistoryRevisionV1",
    "cheeseChatRecapPodiumAchievements",
  ]);
  const CHAT_RECAP_FULL_DATA_KEY_PATTERN =
    /^(?:chatRecap:[0-9a-f]{32}:[0-9a-f]{32}:\d{4}-\d{2}(?::part:\d+)?|chatRecapCatalog:[0-9a-f]{32}|chatRecapVodChatStatsV1:[0-9a-f]{32}:[0-9a-f]{32})$/i;
  const isSettingsFullDataKey = (key) =>
    SETTINGS_FULL_DATA_KEYS.has(key) ||
    CHAT_RECAP_FULL_DATA_KEY_PATTERN.test(key);
  const SETTINGS_MEDIA_KEY_PATTERN =
    /^(?:audioMixer|videoFilter):[0-9a-f]{32}$/i;
  // NEW 읽음 상태는 설치별 UI 메타데이터이므로 설정 JSON으로 다른 브라우저에 옮기지 않는다.
  [
    "cheeseSettingsKnownFeatures",
    "cheeseSettingsNewFeatureBaselinePending",
    "cheeseSettingsNewFeatureUpdatePending",
    // 아래 두 값은 설치 환경에서 최근 로그인 계정과 계정별 보관함 키를 찾기 위한
    // 메타데이터다. 보관함 본문은 clipVaultAccounts로 따로 전송한다.
    CLIP_VAULT_ACCOUNT_IDS_KEY,
    CLIP_VAULT_ACTIVE_ACCOUNT_KEY,
  ].forEach((key) => SETTINGS_TRANSFER_KEYS.delete(key));
  const settingsExportButton = document.querySelector("[data-settings-export]");
  const settingsFullExportButton = document.querySelector(
    "[data-settings-export-full]",
  );
  const settingsImportOpenButton = document.querySelector(
    "[data-settings-import-open]",
  );
  const settingsImportFile = document.querySelector(
    "[data-settings-import-file]",
  );

  function downloadSettingsJson(payload, fullBackup = false) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `chzzk-platter-${fullBackup ? "backup" : "settings"}-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function cloneSafeTransferValue(value, depth = 0) {
    if (depth > 24) return undefined;
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "string"
    ) {
      return typeof value === "string" && value.length > 8 * 1024 * 1024
        ? undefined
        : value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }
    if (Array.isArray(value)) {
      if (value.length > 250000) return undefined;
      const output = [];
      for (const item of value) {
        const cloned = cloneSafeTransferValue(item, depth + 1);
        if (cloned === undefined) return undefined;
        output.push(cloned);
      }
      return output;
    }
    if (!value || typeof value !== "object") return undefined;
    const entries = Object.entries(value);
    if (entries.length > 250000) return undefined;
    const output = {};
    for (const [key, item] of entries) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        continue;
      }
      const cloned = cloneSafeTransferValue(item, depth + 1);
      if (cloned === undefined) return undefined;
      output[key] = cloned;
    }
    return output;
  }

  function transferValueKind(value) {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    return typeof value;
  }

  function normalizeImportedSettingValue(key, value) {
    if (key === POPUP_WIDTH_KEY) {
      return Number.isFinite(Number(value))
        ? clampPopupWidth(value)
        : undefined;
    }
    if (key === LIVE_VIEWER_COUNT_POSITION_KEY) {
      return LIVE_VIEWER_COUNT_POSITIONS.has(value) ? value : undefined;
    }
    if (
      key === "cheeseAudioMixer.autoSync" ||
      key === "cheeseVideoFilter.autoSharpen" ||
      key === "cheeseLogPowerBarEarnedOnly" ||
      key === "cheeseLogPowerLineCumulative" ||
      key === "cheeseChatRecapChannelTrendCumulative" ||
      key === "cheeseChatRecapColorsCollapsed" ||
      key === "chatRecapNewVodBadge"
    ) {
      return typeof value === "boolean" ? value : undefined;
    }
    if (key === "cheeseChatRecapChannelView") {
      return value === "card" || value === "list" ? value : undefined;
    }
    if (key === "cheeseChatRecapGraphSpeed") {
      // chatRecap.js 의 CHANNEL_GRAPH_SPEEDS 와 같은 목록.
      return [1, 1.5, 2, 4, 0.5].includes(value) ? value : undefined;
    }
    if (key === "cheeseChatRecapGraphPhysics") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      // 기본값은 drag·loop 켜짐, play·hideIdle 꺼짐이다.
      return {
        drag: value.drag !== false,
        play: value.play === true,
        hideIdle: value.hideIdle === true,
        loop: value.loop !== false,
      };
    }
    if (key === "cheeseLogPowerStatsViewMode") {
      return value === "tree" || value === "explorer" || value === "calendar"
        ? value
        : undefined;
    }
    if (key === "cheeseLogPowerStatsGroupOrder") {
      if (!Array.isArray(value)) return undefined;
      const allowed = new Set(["streamer", "date", "type"]);
      const order = [
        ...new Set(value.map(String).filter((item) => allowed.has(item))),
      ];
      return order.length === 3 ? order : undefined;
    }
    if (key === "cheeseChatRecapPromptPicks") {
      if (!Array.isArray(value)) return undefined;
      // chatRecap.js 의 PROMPT_SECTIONS 와 같은 목록이어야 한다. 빠진 항목은
      // 불러오기에서 조용히 사라지므로 섹션을 추가하면 여기도 같이 고친다.
      const allowed = new Set([
        "basic",
        "channels",
        "time",
        "months",
        "words",
        "donation",
        "graph",
      ]);
      return [
        ...new Set(value.map(String).filter((item) => allowed.has(item))),
      ];
    }
    if (key === "cheeseLogPowerStatsGroup") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      return {
        date: value.date === true,
        streamer: value.streamer === true,
        type: value.type === true,
      };
    }
    if (key === "cheeseLogPowerChartColors") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      const colors = {};
      Object.entries(value)
        .slice(0, 1000)
        .forEach(([name, color]) => {
          const safeName = String(name || "")
            .trim()
            .slice(0, 100);
          const safeColor = String(color || "")
            .trim()
            .slice(0, 40);
          if (safeName && safeColor) colors[safeName] = safeColor;
        });
      return colors;
    }
    const cloned = cloneSafeTransferValue(value);
    if (cloned === undefined) return undefined;
    const current = storageCacheData?.[key];
    if (
      current !== undefined &&
      transferValueKind(current) !== transferValueKind(cloned)
    ) {
      return undefined;
    }
    return cloned;
  }

  function normalizeTransferClipVault(vault) {
    if (!vault || typeof vault !== "object" || Array.isArray(vault))
      return null;
    const output = { fav: [], like: [] };
    for (const kind of ["fav", "like"]) {
      const source = Array.isArray(vault[kind]) ? vault[kind] : [];
      const seen = new Set();
      for (const rawItem of source.slice(0, 100000)) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          continue;
        }
        const uid = String(rawItem.uid || "")
          .trim()
          .slice(0, 100);
        if (!uid || seen.has(uid)) continue;
        const item = cloneSafeTransferValue(rawItem);
        if (!item || typeof item !== "object") continue;
        item.uid = uid;
        seen.add(uid);
        output[kind].push(item);
      }
    }
    return output;
  }

  function normalizeTransferClipVaultAccounts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const accounts = {};
    for (const [rawAccountId, vault] of Object.entries(value)) {
      const accountId = normalizeCvAccountId(rawAccountId);
      const normalizedVault = normalizeTransferClipVault(vault);
      if (!accountId || !normalizedVault) continue;
      accounts[accountId] = normalizedVault;
    }
    return accounts;
  }

  async function readTransferClipVaultAccounts(snapshot = null) {
    const metadata =
      snapshot ||
      (await chrome.storage.local.get([
        CLIP_VAULT_ACCOUNT_IDS_KEY,
        CLIP_VAULT_ACTIVE_ACCOUNT_KEY,
      ]));
    const ids = new Set(
      (Array.isArray(metadata?.[CLIP_VAULT_ACCOUNT_IDS_KEY])
        ? metadata[CLIP_VAULT_ACCOUNT_IDS_KEY]
        : []
      )
        .map(normalizeCvAccountId)
        .filter(Boolean),
    );
    const activeAccountId = normalizeCvAccountId(
      metadata?.[CLIP_VAULT_ACTIVE_ACCOUNT_KEY],
    );
    if (activeAccountId) ids.add(activeAccountId);
    if (snapshot) {
      Object.keys(snapshot).forEach((key) => {
        if (!key.startsWith(CLIP_VAULT_ACCOUNT_KEY_PREFIX)) return;
        const accountId = normalizeCvAccountId(
          key.slice(CLIP_VAULT_ACCOUNT_KEY_PREFIX.length),
        );
        if (accountId) ids.add(accountId);
      });
    }
    if (!ids.size) return {};

    const storageKeys = [...ids].map(
      (accountId) => `${CLIP_VAULT_ACCOUNT_KEY_PREFIX}${accountId}`,
    );
    const stored = snapshot || (await chrome.storage.local.get(storageKeys));
    const accounts = {};
    ids.forEach((accountId) => {
      const vault = stored?.[`${CLIP_VAULT_ACCOUNT_KEY_PREFIX}${accountId}`];
      const normalizedVault = normalizeTransferClipVault(vault);
      if (normalizedVault) accounts[accountId] = normalizedVault;
    });
    return accounts;
  }

  function collectTransferMediaSettings(snapshot) {
    const mediaSettings = {};
    Object.entries(snapshot || {}).forEach(([key, value]) => {
      if (!SETTINGS_MEDIA_KEY_PATTERN.test(key)) return;
      const cloned = cloneSafeTransferValue(value);
      if (cloned && typeof cloned === "object" && !Array.isArray(cloned)) {
        mediaSettings[key] = cloned;
      }
    });
    return mediaSettings;
  }

  async function exportSettings(includeUserData, button) {
    if (button) button.disabled = true;
    try {
      const settings = await chrome.storage.local.get(
        Array.from(SETTINGS_TRANSFER_KEYS),
      );
      const payload = {
        format: SETTINGS_TRANSFER_FORMAT,
        schemaVersion: SETTINGS_TRANSFER_SCHEMA_VERSION,
        scope: includeUserData ? "full" : "settings",
        extensionVersion: chrome.runtime.getManifest().version,
        exportedAt: new Date().toISOString(),
        settings,
        appearance: {
          theme:
            localStorage.getItem(THEME_STORAGE_KEY) === "dark"
              ? "dark"
              : "light",
        },
      };
      if (includeUserData) {
        // 전체 저장소를 읽는 비용은 사용자가 명시적으로 전체 백업을 선택했을 때만
        // 지불한다. cache:* 등 런타임 캐시는 payload에 넣지 않는다.
        const snapshot = await chrome.storage.local.get(null);
        const storage = {};
        Object.entries(snapshot).forEach(([key, value]) => {
          if (!isSettingsFullDataKey(key)) return;
          const cloned = cloneSafeTransferValue(value);
          if (cloned !== undefined) storage[key] = cloned;
        });
        payload.userData = {
          storage,
          clipVaultAccounts: await readTransferClipVaultAccounts(snapshot),
          mediaSettings: collectTransferMediaSettings(snapshot),
        };
      }
      downloadSettingsJson(payload, includeUserData);
      settingsToast(
        includeUserData
          ? "사용자 데이터를 포함한 백업을 내보냈습니다."
          : "설정 파일을 내보냈습니다.",
        "ok",
      );
    } catch {
      settingsToast(
        includeUserData
          ? "사용자 데이터 백업을 내보내지 못했습니다."
          : "설정을 내보내지 못했습니다.",
        "error",
      );
    } finally {
      if (button) button.disabled = false;
    }
  }

  settingsExportButton?.addEventListener("click", () => {
    void exportSettings(false, settingsExportButton);
  });
  settingsFullExportButton?.addEventListener("click", () => {
    void exportSettings(true, settingsFullExportButton);
  });

  settingsImportOpenButton?.addEventListener("click", () => {
    settingsImportFile?.click();
  });

  settingsImportFile?.addEventListener("change", async () => {
    const file = settingsImportFile.files?.[0];
    settingsImportFile.value = "";
    if (!file) return;
    if (file.size > SETTINGS_IMPORT_MAX_BYTES) {
      settingsToast("백업 파일은 256MB 이하만 불러올 수 있습니다.", "error");
      return;
    }

    settingsImportOpenButton.disabled = true;
    try {
      const payload = JSON.parse(await file.text());
      if (
        payload?.format !== SETTINGS_TRANSFER_FORMAT ||
        payload?.schemaVersion !== SETTINGS_TRANSFER_SCHEMA_VERSION ||
        !payload.settings ||
        typeof payload.settings !== "object" ||
        Array.isArray(payload.settings)
      ) {
        throw new Error("invalid-format");
      }

      const imported = {};
      for (const [key, value] of Object.entries(payload.settings)) {
        if (SETTINGS_FULL_DATA_KEYS.has(key)) {
          const normalized =
            key === CLIP_VAULT_KEY
              ? normalizeTransferClipVault(value)
              : cloneSafeTransferValue(value);
          if (normalized !== undefined && normalized !== null) {
            imported[key] = normalized;
          }
          continue;
        }
        if (!SETTINGS_TRANSFER_KEYS.has(key) || value === undefined) continue;
        if (key === CHAT_OS_ICONS_KEY) {
          imported[key] = normalizeChatOsCustomIcons(value);
        } else if (key === CHAT_OS_ICON_POSITION_KEY) {
          imported[key] = normalizeChatOsIconPosition(value);
        } else {
          const normalized = normalizeImportedSettingValue(key, value);
          if (normalized !== undefined) imported[key] = normalized;
        }
      }
      if (
        imported[LIVE_VIEWER_COUNT_POSITION_KEY] === undefined &&
        (imported[LIVE_VIEWER_COUNT_INLINE_KEY] !== undefined ||
          imported[LIVE_VIEWER_COUNT_HIDDEN_KEY] !== undefined)
      ) {
        imported[LIVE_VIEWER_COUNT_POSITION_KEY] =
          legacyLiveViewerCountPosition(imported);
      }
      const userDataStorage = payload?.userData?.storage;
      if (
        userDataStorage &&
        typeof userDataStorage === "object" &&
        !Array.isArray(userDataStorage)
      ) {
        for (const [key, value] of Object.entries(userDataStorage)) {
          if (!isSettingsFullDataKey(key)) continue;
          const normalized =
            key === CLIP_VAULT_KEY
              ? normalizeTransferClipVault(value)
              : cloneSafeTransferValue(value);
          if (normalized !== undefined && normalized !== null) {
            imported[key] = normalized;
          }
        }
      }
      const mediaSettings = payload?.userData?.mediaSettings;
      if (
        mediaSettings &&
        typeof mediaSettings === "object" &&
        !Array.isArray(mediaSettings)
      ) {
        for (const [key, value] of Object.entries(mediaSettings)) {
          if (!SETTINGS_MEDIA_KEY_PATTERN.test(key)) continue;
          const cloned = cloneSafeTransferValue(value);
          if (cloned && typeof cloned === "object" && !Array.isArray(cloned)) {
            imported[key] = cloned;
          }
        }
      }
      const clipVaultAccounts = normalizeTransferClipVaultAccounts(
        payload?.userData?.clipVaultAccounts || payload.clipVaultAccounts,
      );
      if (
        !Object.keys(imported).length &&
        !Object.keys(clipVaultAccounts).length
      ) {
        throw new Error("empty-settings");
      }

      if (Object.keys(clipVaultAccounts).length) {
        const existingMetadata = await chrome.storage.local.get(
          CLIP_VAULT_ACCOUNT_IDS_KEY,
        );
        const accountIds = new Set(
          (Array.isArray(existingMetadata?.[CLIP_VAULT_ACCOUNT_IDS_KEY])
            ? existingMetadata[CLIP_VAULT_ACCOUNT_IDS_KEY]
            : []
          )
            .map(normalizeCvAccountId)
            .filter(Boolean),
        );
        Object.entries(clipVaultAccounts).forEach(([accountId, vault]) => {
          accountIds.add(accountId);
          imported[`${CLIP_VAULT_ACCOUNT_KEY_PREFIX}${accountId}`] = vault;
        });
        imported[CLIP_VAULT_ACCOUNT_IDS_KEY] = [...accountIds];
      }

      // ⚠ 통나무파워 내역은 background 가 단일 작성자다. 여기서 통째로 덮으면
      //   그때 진행 중이던 5분 묶음·예측 기록을 날린다 → 큐로 보낸다.
      const importedLog = imported.cheeseLogPowerLog;
      let logImportOk = null; // null = 불러올 내역이 없었다
      if (Array.isArray(importedLog)) {
        delete imported.cheeseLogPowerLog;
        let logOk = false;
        // 최종 안내에서 쓰려고 바깥 스코프에 남긴다.
        try {
          const res = await chrome.runtime?.sendMessage?.({
            type: "LP_WRITE",
            op: "IMPORT_LOG",
            payload: { entries: importedLog },
          });
          logOk = res?.ok === true;
          logImportOk = logOk;
        } catch {}
        // ⚠ 여기서 토스트를 띄우면 아래 성공 안내가 곧바로 덮는다.
        //   캐시에도 넣지 않는다 — 저장 안 된 내역이 화면에 보이면 안 된다.
        if (!logOk) delete imported.cheeseLogPowerLog;
      }
      await chrome.storage.local.set(imported);
      if (storageCacheData) {
        Object.assign(storageCacheData, imported);
        if (Array.isArray(importedLog) && logImportOk) {
          storageCacheData.cheeseLogPowerLog = importedLog;
        }
      }

      const theme = payload?.appearance?.theme;
      if (theme === "dark" || theme === "light") {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
        applyTheme(theme);
      }

      if (
        Object.prototype.hasOwnProperty.call(imported, MASTER_ENABLED_KEY) &&
        masterEnabledInput
      ) {
        masterEnabledInput.checked = imported[MASTER_ENABLED_KEY] !== false;
      }

      settingsToast(
        logImportOk === false
          ? "설정은 불러왔지만 통나무파워 내역은 저장하지 못했습니다. 다시 시도해 주세요."
          : "설정을 불러왔습니다. 열린 페이지에서 새로고침을 선택해 주세요.",
        logImportOk === false ? "error" : "ok",
      );
      try {
        chrome.runtime.sendMessage({
          type: "CHEESE_SHOW_REFRESH_NOTICE",
          reason: "settings-import",
        });
      } catch {}
    } catch {
      settingsToast("올바른 치즈 플래터 설정 파일이 아닙니다.", "error");
    } finally {
      settingsImportOpenButton.disabled = false;
    }
  });

  function cbmFormatDate(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "";
    try {
      return new Date(n).toLocaleString("ko-KR", {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function cbmEscape(s) {
    return String(s == null ? "" : s).replace(
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

  // 검색 매칭: 닉네임·사유·UID(userIdHash)·이전 닉네임 이력 중 하나라도 포함하면 true.
  function cbmMatchesQuery(b, q) {
    if (!q) return true;
    if (
      String(b.nickname || "")
        .toLowerCase()
        .includes(q)
    )
      return true;
    if (
      String(b.reason || "")
        .toLowerCase()
        .includes(q)
    )
      return true;
    if (
      String(b.userIdHash || "")
        .toLowerCase()
        .includes(q)
    )
      return true;
    const hist = Array.isArray(b.nicknameHistory) ? b.nicknameHistory : [];
    return hist.some((h) =>
      String(h?.nickname || "")
        .toLowerCase()
        .includes(q),
    );
  }

  // 현재 화면에 보이는(검색 필터 통과) 항목 — 위임 핸들러의 selectAll 갱신용.
  let cbmVisibleItems = [];
  let cbmListDelegationBound = false;
  function cbmItemToggle(item) {
    const hash = item.dataset.hash;
    if (!hash) return;
    if (cbmSelected.has(hash)) cbmSelected.delete(hash);
    else cbmSelected.add(hash);
    item.classList.toggle("is-selected", cbmSelected.has(hash));
    item.setAttribute("aria-checked", String(cbmSelected.has(hash)));
    updateCbmSelectionUI(cbmVisibleItems);
  }
  // cbmListEl 에 위임 리스너를 '한 번만' 바인딩. 항목 수와 무관하게 리스너는 상수 개.
  function cbmBindListDelegation() {
    if (cbmListDelegationBound || !cbmListEl) return;
    cbmListDelegationBound = true;
    cbmListEl.addEventListener("click", (e) => {
      // 이력 펼침/접기.
      const histToggle = e.target.closest("[data-hist-toggle]");
      if (histToggle && cbmListEl.contains(histToggle)) {
        e.stopPropagation();
        const box = histToggle.nextElementSibling;
        if (box) box.hidden = !box.hidden;
        return;
      }
      // 해제 버튼.
      const removeBtn = e.target.closest(".settings-cbm-remove");
      if (removeBtn && cbmListEl.contains(removeBtn)) {
        e.stopPropagation();
        const hash = removeBtn.dataset.hash;
        const entry = cbmBlocks.find((b) => b.userIdHash === hash);
        if (entry?.nativeBlocked) openCbmUnblockModal([entry]);
        else removeCbmBlocks([hash], false);
        return;
      }
      // 그 외 항목 클릭 → 선택 토글.
      const item = e.target.closest(".settings-cbm-item");
      if (item && cbmListEl.contains(item)) cbmItemToggle(item);
    });
    cbmListEl.addEventListener("keydown", (e) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const item = e.target.closest(".settings-cbm-item");
      if (item && cbmListEl.contains(item)) {
        e.preventDefault();
        cbmItemToggle(item);
      }
    });
  }
  cbmBindListDelegation();

  // 항목 1개의 HTML(가상 스크롤 창 렌더에 재사용).
  function cbmItemHtml(b) {
    const nick = cbmEscape(b.nickname || "(닉네임 없음)");
    const reason = b.reason
      ? `<div class="settings-cbm-reason">${cbmEscape(b.reason)}</div>`
      : "";
    const date = cbmFormatDate(b.blockedAt);
    const native = b.nativeBlocked
      ? `<div class="settings-cbm-native-row"><span class="settings-cbm-native">치지직 차단</span></div>`
      : "";
    const sel = cbmSelected.has(b.userIdHash) ? " is-selected" : "";
    const hist = Array.isArray(b.nicknameHistory) ? b.nicknameHistory : [];
    const histBlock = hist.length
      ? `<button type="button" class="settings-cbm-hist-toggle" data-hist-toggle>
           이전 닉네임 ${hist.length}개 ▾
         </button>
         <div class="settings-cbm-hist" hidden>
           ${hist
             .slice()
             .reverse()
             .map(
               (h) =>
                 `<div class="settings-cbm-hist-item">${cbmEscape(
                   h.nickname,
                 )}</div>`,
             )
             .join("")}
         </div>`
      : "";
    return `
      <div class="settings-cbm-item${sel}" data-hash="${cbmEscape(
        b.userIdHash,
      )}" role="checkbox" aria-checked="${cbmSelected.has(
        b.userIdHash,
      )}" tabindex="0">
        <div class="settings-cbm-main">
          ${native}
          <div class="settings-cbm-name">${nick}</div>
          ${reason}
          <div class="settings-cbm-date">${cbmEscape(date)}</div>
          ${histBlock}
          <div class="settings-cbm-hash" title="userIdHash">${cbmEscape(
            b.userIdHash,
          )}</div>
        </div>
        <button type="button" class="settings-cbm-remove" data-hash="${cbmEscape(
          b.userIdHash,
        )}">해제</button>
      </div>`;
  }

  // ── 가상 스크롤 상태 ────────────────────────────────────────────────────────
  // 항목 높이는 제각각(배지·사유·이력 유무)이라 '측정된 평균 높이'로 근사한다. 렌더 후
  // 실제 창 높이로 평균을 보정해 다음 렌더가 더 정확해진다. GAP 은 flex gap(8px) 반영.
  const CBM_ROW_GAP = 8;
  let cbmAvgRowH = 96; // 초기 추정(대략적인 한 항목 높이). 렌더하며 실측으로 수렴.
  const CBM_OVERSCAN = 4; // 위/아래로 더 그려둘 여유 항목 수(스크롤 시 빈 칸 방지).
  let cbmFilteredItems = []; // 현재 필터 통과 전체(정렬된) — 스크롤 시 창만 다시 그린다.

  // 스크롤 위치에 맞춰 '보이는 창'만 다시 그린다(전체 재계산 없이).
  function cbmRenderWindow() {
    if (!cbmListEl || !cbmViewportEl || !cbmSizerEl) return;
    const total = cbmFilteredItems.length;
    if (!total) return;
    const rowH = cbmAvgRowH + CBM_ROW_GAP;
    const scrollTop = cbmViewportEl.scrollTop;
    const viewH = cbmViewportEl.clientHeight || 420;
    let start = Math.floor(scrollTop / rowH) - CBM_OVERSCAN;
    if (start < 0) start = 0;
    let visibleCount = Math.ceil(viewH / rowH) + CBM_OVERSCAN * 2;
    let end = start + visibleCount;
    if (end > total) end = total;
    // 창 HTML 생성 + 위치 이동(translateY 로 sizer 안에서 내려앉힘).
    const slice = cbmFilteredItems.slice(start, end);
    cbmListEl.style.transform = `translateY(${start * rowH}px)`;
    cbmListEl.innerHTML = slice.map(cbmItemHtml).join("");
  }

  // 방금 그려진 창의 실제 높이로 평균 행 높이를 1회 보정한다(스크롤 중엔 하지 않아 창이
  // 튀지 않게 한다). 렌더 직후 rAF 로 호출. 평균이 크게 바뀌면 sizer 를 다시 맞추고 재렌더.
  function cbmCalibrateRowHeight() {
    if (!cbmListEl || !cbmSizerEl) return;
    const rows = cbmListEl.children.length;
    if (!rows) return;
    const measured = cbmListEl.offsetHeight / rows - CBM_ROW_GAP;
    if (measured > 20 && Math.abs(measured - cbmAvgRowH) > 3) {
      cbmAvgRowH = measured;
      const total = cbmFilteredItems.length;
      if (total)
        cbmSizerEl.style.height = `${total * (cbmAvgRowH + CBM_ROW_GAP)}px`;
      cbmRenderWindow(); // 새 평균으로 창 위치/개수 재계산
    }
  }

  function renderCbmList() {
    if (!cbmListEl) return;
    const q = (cbmSearchInput?.value || "").trim().toLowerCase();
    const items = cbmBlocks
      .slice()
      .sort((a, b) => Number(b.blockedAt || 0) - Number(a.blockedAt || 0))
      .filter((b) => cbmMatchesQuery(b, q));
    if (!cbmBlocks.length) {
      cbmListEl.classList.add("is-static");
      cbmListEl.innerHTML = "";
      if (cbmSizerEl) cbmSizerEl.style.height = "";
      if (cbmEmptyEl) cbmEmptyEl.hidden = false;
      if (cbmBulkBar) cbmBulkBar.hidden = true;
      cbmFilteredItems = [];
      cbmVisibleItems = [];
      cbmSelected.clear();
      updateCbmSelectionUI([]); // 전체선택 체크/개수/버튼 상태 리셋
      cbmUpdateFab();
      return;
    }
    if (cbmEmptyEl) cbmEmptyEl.hidden = true;
    if (cbmBulkBar) cbmBulkBar.hidden = false;
    // 목록에 없는(=이미 해제된) 선택 항목 정리.
    const existing = new Set(cbmBlocks.map((b) => b.userIdHash));
    [...cbmSelected].forEach((h) => {
      if (!existing.has(h)) cbmSelected.delete(h);
    });
    if (!items.length) {
      // 검색 결과 없음: 가상화 끄고(정적) 안내만.
      cbmListEl.classList.add("is-static");
      cbmListEl.style.transform = "";
      if (cbmSizerEl) cbmSizerEl.style.height = "";
      cbmListEl.innerHTML = `<p class="settings-cbm-noresult">검색 결과가 없습니다.</p>`;
      cbmFilteredItems = [];
      cbmVisibleItems = items;
      updateCbmSelectionUI(items);
      cbmUpdateFab();
      return;
    }
    // ── 가상 스크롤 렌더 ──────────────────────────────────────────────────────
    cbmListEl.classList.remove("is-static");
    cbmFilteredItems = items;
    cbmVisibleItems = items; // 위임 핸들러 selectAll 갱신용(전체 필터 결과)
    // sizer 를 전체 높이로 → 스크롤바가 실제 개수를 반영. 창은 그 안에서만 이동.
    if (cbmSizerEl)
      cbmSizerEl.style.height = `${items.length * (cbmAvgRowH + CBM_ROW_GAP)}px`;
    // 목록이 줄어 현재 스크롤이 범위를 넘으면 맨 위로(빈 화면 방지).
    if (cbmViewportEl && cbmViewportEl.scrollTop > cbmSizerEl.offsetHeight)
      cbmViewportEl.scrollTop = 0;
    cbmRenderWindow();
    // 실측 평균 보정은 렌더 다음 프레임에 1회(레이아웃 확정 후).
    requestAnimationFrame(cbmCalibrateRowHeight);
    updateCbmSelectionUI(items);
    cbmUpdateFab(); // 목록/스크롤 변화에 맞춰 FAB 표시 갱신
  }

  // 스크롤 시 창만 다시 그린다(rAF 로 스로틀 — 스크롤당 1회 렌더).
  let cbmScrollRaf = 0;
  // 최상단 이동 FAB — 일정 이상 내려가면 표시.
  const cbmFabEl = document.querySelector("[data-cbm-fab]");
  const CBM_FAB_SHOW_AT = 240; // 이만큼 스크롤되면 FAB 노출
  function cbmUpdateFab() {
    if (!cbmFabEl || !cbmViewportEl) return;
    const show = cbmViewportEl.scrollTop > CBM_FAB_SHOW_AT;
    if (show) {
      cbmFabEl.hidden = false; // display 복원(트랜지션 가능하게)
      cbmFabEl.classList.add("is-show");
    } else {
      cbmFabEl.classList.remove("is-show");
    }
  }
  cbmFabEl?.addEventListener("click", () => {
    if (!cbmViewportEl) return;
    cbmViewportEl.scrollTo({ top: 0, behavior: "smooth" });
  });

  cbmViewportEl?.addEventListener(
    "scroll",
    () => {
      cbmUpdateFab();
      if (cbmScrollRaf) return;
      cbmScrollRaf = requestAnimationFrame(() => {
        cbmScrollRaf = 0;
        if (cbmFilteredItems.length) cbmRenderWindow();
      });
    },
    { passive: true },
  );

  // 선택 개수/전체선택 체크/버튼 활성 상태 갱신.
  function updateCbmSelectionUI(visibleItems) {
    const n = cbmSelected.size;
    if (cbmSelCount) cbmSelCount.textContent = n ? `${n}명 선택됨` : "";
    if (cbmRemoveSelBtn) cbmRemoveSelBtn.disabled = n === 0;
    if (cbmSelectAll) {
      const vis = visibleItems || [];
      const allSel =
        vis.length > 0 && vis.every((b) => cbmSelected.has(b.userIdHash));
      cbmSelectAll.checked = allSel;
      cbmSelectAll.indeterminate = n > 0 && !allSel;
    }
  }

  // 여러 hash 를 한 번에 해제. alsoNative=true 면 치지직 차단도 함께 해제 요청.
  async function removeCbmBlocks(hashes, alsoNative) {
    const set = new Set(hashes);
    // 치지직 차단 해제가 필요한 대상(선택+native)만 추림(로컬 제거 전 미리).
    const nativeTargets = alsoNative
      ? cbmBlocks
          .filter((b) => set.has(b.userIdHash) && b.nativeBlocked)
          .map((b) => b.userIdHash)
      : [];
    const removedCount = cbmBlocks.filter((b) => set.has(b.userIdHash)).length;
    cbmBlocks = cbmBlocks.filter((b) => !set.has(b.userIdHash));
    hashes.forEach((h) => cbmSelected.delete(h));
    try {
      cachedStorageSet({ [COMMENT_BLOCK_KEY]: cbmBlocks });
    } catch {}
    renderCbmList();
    // 로컬 해제 결과 토스트(즉시). native 해제는 비동기라 결과를 아래에서 별도 안내.
    if (removedCount > 0) {
      settingsToast(
        removedCount === 1
          ? "차단을 해제했습니다."
          : `${removedCount}명의 차단을 해제했습니다.`,
      );
    }
    if (nativeTargets.length) {
      const anyFail = await requestNativeUnblock(nativeTargets);
      if (anyFail) {
        settingsToast(
          "일부 사용자의 치지직 차단 해제는 처리하지 못했습니다. 치지직 페이지를 연 뒤 다시 시도해주세요.",
          "error",
        );
      } else {
        settingsToast("치지직 차단도 함께 해제했습니다.");
      }
    }
  }

  // 치지직 탭(content)에 여러 hash 해제 대행 요청. 실패가 하나라도 있으면 true.
  async function requestNativeUnblock(hashes) {
    let anyFail = false;
    try {
      const tabs = await new Promise((resolve) =>
        chrome.tabs.query({ url: "https://chzzk.naver.com/*" }, resolve),
      );
      for (const hash of hashes) {
        let done = false;
        for (const tab of tabs || []) {
          const res = await new Promise((resolve) =>
            chrome.tabs.sendMessage(
              tab.id,
              { type: "CHEESE_NATIVE_UNBLOCK_USER", userHash: hash },
              (r) => resolve(chrome.runtime.lastError ? null : r),
            ),
          );
          if (res?.ok) {
            done = true;
            break;
          }
        }
        if (!done) anyFail = true;
      }
    } catch {
      anyFail = true;
    }
    return anyFail;
  }

  // 치지직 차단도 함께 해제할지 묻는 커스텀 모달. entries = 해제 대상 중 nativeBlocked
  // 인 항목들(1명이면 단건, 여러 명이면 일괄). '로컬만'/'둘 다'는 이 대상 전체에 적용하고,
  // 대상에 없던(로컬 전용) 나머지는 호출부에서 이미 함께 제거된다.
  function openCbmUnblockModal(entries, allHashes) {
    document.getElementById("cbm-unblock-modal")?.remove();
    // allHashes: 이번 해제 전체 대상(로컬전용 포함). 없으면 native 대상만.
    const all = Array.isArray(allHashes)
      ? allHashes
      : entries.map((e) => e.userIdHash);
    const nativeHashes = entries.map((e) => e.userIdHash);
    const title =
      entries.length === 1
        ? `${cbmEscape(entries[0].nickname || "이 사용자")}님 차단 해제`
        : `${all.length}명 차단 해제`;
    const body =
      entries.length === 1
        ? `이 사용자는 <b>치지직 차단</b>도 함께 되어 있습니다. 치지직 차단도 같이 해제할까요?`
        : `선택한 ${all.length}명 중 <b>${entries.length}명</b>은 치지직 차단도 되어 있습니다. 치지직 차단도 같이 해제할까요?`;
    const back = document.createElement("div");
    back.id = "cbm-unblock-modal";
    back.className = "cbm-modal-backdrop";
    back.innerHTML = `
      <div class="cbm-modal" role="dialog" aria-modal="true">
        <div class="cbm-modal-title">${title}</div>
        <p class="cbm-modal-body">${body}</p>
        <div class="cbm-modal-actions">
          <button type="button" class="cbm-modal-cancel">취소</button>
          <button type="button" class="cbm-modal-local">로컬만 해제</button>
          <button type="button" class="cbm-modal-both">둘 다 해제</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (e) => {
      if (e.target === back) close();
    });
    back.querySelector(".cbm-modal-cancel").addEventListener("click", close);
    back.querySelector(".cbm-modal-local").addEventListener("click", () => {
      removeCbmBlocks(all, false); // 전체 로컬만 해제(치지직 유지)
      close();
    });
    back.querySelector(".cbm-modal-both").addEventListener("click", () => {
      // 전체 로컬 해제 + native 대상은 치지직도 해제.
      removeCbmBlocks(all, true);
      void nativeHashes;
      close();
    });
  }

  // 일괄 해제 진입점: 대상 hash 목록을 받아, native 가 섞였으면 모달로 확인.
  function bulkRemove(hashes) {
    if (!hashes.length) return;
    const set = new Set(hashes);
    const nativeEntries = cbmBlocks.filter(
      (b) => set.has(b.userIdHash) && b.nativeBlocked,
    );
    if (nativeEntries.length) {
      openCbmUnblockModal(nativeEntries, hashes);
    } else {
      removeCbmBlocks(hashes, false);
    }
  }

  // 커스텀 확인 모달(title/body/확인라벨). 확인 시 onConfirm 실행.
  function openCbmConfirm({ title, body, confirmLabel, onConfirm }) {
    document.getElementById("cbm-unblock-modal")?.remove();
    const back = document.createElement("div");
    back.id = "cbm-unblock-modal";
    back.className = "cbm-modal-backdrop";
    back.innerHTML = `
      <div class="cbm-modal" role="dialog" aria-modal="true">
        <div class="cbm-modal-title">${cbmEscape(title)}</div>
        <p class="cbm-modal-body">${cbmEscape(body)}</p>
        <div class="cbm-modal-actions">
          <button type="button" class="cbm-modal-cancel">취소</button>
          <button type="button" class="cbm-modal-both">${cbmEscape(
            confirmLabel || "확인",
          )}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (e) => {
      if (e.target === back) close();
    });
    back.querySelector(".cbm-modal-cancel").addEventListener("click", close);
    back.querySelector(".cbm-modal-both").addEventListener("click", () => {
      close();
      onConfirm();
    });
  }

  async function loadCbmBlocks() {
    try {
      const data = await cachedStorageGet(COMMENT_BLOCK_KEY);
      const list = data?.[COMMENT_BLOCK_KEY];
      cbmBlocks = Array.isArray(list) ? list : [];
    } catch {
      cbmBlocks = [];
    }
    renderCbmList();
    void refreshCbmNicknames(); // 백그라운드로 닉네임 최신화(변경 이력 추적)
  }

  // 차단 유저들의 현재 닉네임을 확인해 변경되었으면 이력에 남기고 저장한다.
  //  1) channels/{userIdHash} 로 각 유저 현재 닉네임(channelName) 병렬 조회.
  //  2) native 차단 유저는 privateUserBlocks 목록으로도 대조(닉네임 보강).
  // 닉네임이 이전과 다르면 nicknameHistory 에 '이전 닉네임'을 push 하고 nickname 을 갱신.
  let cbmRefreshing = false;
  async function refreshCbmNicknames() {
    if (cbmRefreshing || !cbmBlocks.length) return;
    cbmRefreshing = true;
    try {
      // 현재 닉네임 맵 구성: hash → nickname.
      const current = new Map();
      // (2) native 차단 목록 먼저(있으면 API 호출 절감).
      if (cbmBlocks.some((b) => b.nativeBlocked)) {
        try {
          const res = await fetch(
            "https://comm-api.game.naver.com/nng_main/v1/privateUserBlocks?limit=500&offset=0",
            { credentials: "include" },
          );
          if (res.ok) {
            const j = await res.json();
            (j?.content?.blockUsers || []).forEach((u) => {
              if (u?.userIdHash)
                current.set(String(u.userIdHash), String(u.nickname || ""));
            });
          }
        } catch {}
      }
      // (1) 나머지는 channels/{hash} 조회. ⚠ 차단 수가 많으면 한 번에 수백 개를 병렬
      // 발사해 네트워크·CPU 가 순간적으로 튄다 → 동시 6개씩 배치로 제한(워커 풀).
      const need = cbmBlocks.filter((b) => !current.has(b.userIdHash));
      const fetchOne = async (b) => {
        try {
          const res = await fetch(
            `https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(
              b.userIdHash,
            )}`,
            { credentials: "include" },
          );
          if (!res.ok) return;
          const j = await res.json();
          const nn = j?.content?.channelName;
          if (nn) current.set(String(b.userIdHash), String(nn));
        } catch {}
      };
      const CBM_FETCH_CONCURRENCY = 6;
      let cursor = 0;
      const worker = async () => {
        while (cursor < need.length) {
          const idx = cursor++;
          await fetchOne(need[idx]);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(CBM_FETCH_CONCURRENCY, need.length) },
          worker,
        ),
      );
      // 변경 반영.
      let changed = false;
      cbmBlocks = cbmBlocks.map((b) => {
        const now = current.get(b.userIdHash);
        if (!now || now === b.nickname) return b;
        // 닉네임 변경됨 → 이전 닉네임을 이력에 남기고 현재로 갱신.
        const history = Array.isArray(b.nicknameHistory)
          ? b.nicknameHistory.slice()
          : [];
        if (b.nickname) history.push({ nickname: b.nickname, at: Date.now() });
        changed = true;
        return { ...b, nickname: now, nicknameHistory: history };
      });
      if (changed) {
        try {
          cachedStorageSet({ [COMMENT_BLOCK_KEY]: cbmBlocks });
        } catch {}
        renderCbmList();
      }
    } finally {
      cbmRefreshing = false;
    }
  }

  // 검색은 디바운스(차단 수가 많으면 키 입력마다 전체 재렌더는 무겁다). 200ms.
  let cbmSearchTimer = 0;
  cbmSearchInput?.addEventListener("input", () => {
    if (cbmSearchTimer) clearTimeout(cbmSearchTimer);
    cbmSearchTimer = setTimeout(() => {
      cbmSearchTimer = 0;
      renderCbmList();
    }, 200);
  });

  // ── UID(userIdHash) 직접 입력 차단 ──────────────────────────────────────────
  const cbmAddUidInput = document.querySelector("[data-cbm-adduid-input]");
  const cbmAddUidReason = document.querySelector("[data-cbm-adduid-reason]");
  const cbmAddUidBtn = document.querySelector("[data-cbm-adduid-btn]");
  const cbmAddUidNative = document.querySelector("[data-cbm-adduid-native]");
  const cbmAddUidHint = document.querySelector("[data-cbm-adduid-hint]");

  let cbmUidHintTimer = 0;
  function cbmShowUidHint(text, kind) {
    if (!cbmAddUidHint) return;
    if (cbmUidHintTimer) {
      clearTimeout(cbmUidHintTimer);
      cbmUidHintTimer = 0;
    }
    cbmAddUidHint.textContent = text || "";
    cbmAddUidHint.dataset.kind = kind || "";
    // 문구가 표시되면 3초 뒤 자동으로 지운다(빈 문구는 타이머 불필요).
    if (text) {
      cbmUidHintTimer = setTimeout(() => {
        cbmAddUidHint.textContent = "";
        cbmAddUidHint.dataset.kind = "";
        cbmUidHintTimer = 0;
      }, 3000);
    }
  }

  // 치지직 탭(content)에 UID 차단 대행 요청. 성공하면 true.
  async function requestNativeBlock(userHash) {
    try {
      const tabs = await new Promise((resolve) =>
        chrome.tabs.query({ url: "https://chzzk.naver.com/*" }, resolve),
      );
      for (const tab of tabs || []) {
        const res = await new Promise((resolve) =>
          chrome.tabs.sendMessage(
            tab.id,
            { type: "CHEESE_NATIVE_BLOCK_USER", userHash },
            (r) => resolve(chrome.runtime.lastError ? null : r),
          ),
        );
        if (res?.ok) return true;
      }
    } catch {}
    return false;
  }

  // 대상 유저의 현재 닉네임 조회(있으면 목록 표시가 예뻐진다). 실패해도 무방.
  async function fetchChannelNickname(userHash) {
    try {
      const res = await fetch(
        `https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(
          userHash,
        )}`,
        { credentials: "include" },
      );
      if (!res.ok) return "";
      const j = await res.json();
      return String(j?.content?.channelName || "");
    } catch {
      return "";
    }
  }

  async function cbmAddByUid() {
    const raw = (cbmAddUidInput?.value || "").trim();
    // 입력에서 순수 32자리 hex 만 추출(URL 붙여넣기도 허용).
    const m = raw.match(/[0-9a-f]{32}/i);
    const userHash = m ? m[0].toLowerCase() : "";
    if (!userHash) {
      cbmShowUidHint("올바른 UID(32자리 hex)를 입력해주세요.", "error");
      return;
    }
    if (cbmBlocks.some((b) => b.userIdHash === userHash)) {
      cbmShowUidHint("이미 차단 목록에 있는 사용자입니다.", "error");
      return;
    }
    if (cbmAddUidBtn) cbmAddUidBtn.disabled = true;
    cbmShowUidHint("처리 중…", "");

    const reason = (cbmAddUidReason?.value || "").trim();
    const wantNative = !!cbmAddUidNative?.checked;
    let nativeOk = false;
    if (wantNative) nativeOk = await requestNativeBlock(userHash);
    const nickname = await fetchChannelNickname(userHash);

    cbmBlocks.push({
      userIdHash: userHash,
      nickname: nickname || "",
      reason: reason || "",
      blockedAt: Date.now(),
      nativeBlocked: nativeOk,
      nicknameHistory: [],
    });
    try {
      cachedStorageSet({ [COMMENT_BLOCK_KEY]: cbmBlocks });
    } catch {}
    renderCbmList();

    // 입력 폼 초기화(다음 차단을 위해). native 체크·사유는 리셋한다.
    if (cbmAddUidInput) cbmAddUidInput.value = "";
    if (cbmAddUidReason) cbmAddUidReason.value = "";
    if (cbmAddUidNative) cbmAddUidNative.checked = false;
    if (cbmAddUidBtn) cbmAddUidBtn.disabled = false;
    if (wantNative && !nativeOk) {
      cbmShowUidHint(
        "로컬 차단됨. 치지직 차단은 실패했습니다(치지직 탭을 연 뒤 다시 시도)",
        "error",
      );
    } else {
      cbmShowUidHint(
        nativeOk ? "차단했습니다(치지직 차단 포함)" : "차단했습니다(로컬)",
        "ok",
      );
    }
  }

  cbmAddUidBtn?.addEventListener("click", cbmAddByUid);
  const cbmUidEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      cbmAddByUid();
    }
  };
  cbmAddUidInput?.addEventListener("keydown", cbmUidEnter);
  cbmAddUidReason?.addEventListener("keydown", cbmUidEnter);
  // 새 UID 를 입력하기 시작하면 직전 결과 안내를 지운다.
  cbmAddUidInput?.addEventListener("input", () => cbmShowUidHint("", ""));

  // ── 차단 목록 내보내기(JSON / CSV) ─────────────────────────────────────────
  function cbmDownload(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {}
  }

  function cbmExportStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
      d.getHours(),
    )}${p(d.getMinutes())}`;
  }

  // 내보내기 컬럼명(한글)과 각 차단 항목 → 값 매핑을 공유한다(JSON·CSV 동일 구조).
  const CBM_EXPORT_COLUMNS = [
    "UID",
    "닉네임",
    "차단 사유",
    "차단 일시",
    "차단 일시(ISO)",
    "치지직 차단",
    "이전 닉네임 이력",
  ];
  function cbmExportRow(b) {
    const at = Number(b.blockedAt || 0);
    // 변경 시각은 '감지 시점'일 뿐 실제 변경 시각이 아니라 부정확 → 닉네임만 내보낸다.
    const hist = Array.isArray(b.nicknameHistory)
      ? b.nicknameHistory.map((h) => `${h?.nickname || ""}`).join(" | ")
      : "";
    return [
      b.userIdHash || "",
      b.nickname || "",
      b.reason || "",
      at ? cbmFormatDate(at) : "",
      at ? new Date(at).toISOString() : "",
      b.nativeBlocked ? "예" : "아니오",
      hist,
    ];
  }

  document
    .querySelector("[data-cbm-export-json]")
    ?.addEventListener("click", () => {
      if (!cbmBlocks.length) {
        cbmShowUidHint("내보낼 차단 목록이 없습니다.", "error");
        return;
      }
      // 한글 키 객체 배열로 직렬화(원본 구조 대신 사람이 읽기 쉬운 컬럼명).
      const data = cbmBlocks.map((b) => {
        const row = cbmExportRow(b);
        const obj = {};
        CBM_EXPORT_COLUMNS.forEach((k, i) => {
          obj[k] = row[i];
        });
        return obj;
      });
      cbmDownload(
        `치즈플래터-차단목록-${cbmExportStamp()}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
    });

  document
    .querySelector("[data-cbm-export-csv]")
    ?.addEventListener("click", () => {
      if (!cbmBlocks.length) {
        cbmShowUidHint("내보낼 차단 목록이 없습니다.", "error");
        return;
      }
      const csvCell = (v) => {
        const s = String(v == null ? "" : v);
        // 따옴표는 두 번, 특수문자 포함 시 감싸기. CSV 인젝션 방지로 =,+,-,@ 선행은 앞에 '.
        const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
        return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const rows = cbmBlocks.map((b) => cbmExportRow(b).map(csvCell).join(","));
      // Excel 한글 깨짐 방지 BOM.
      const text =
        "﻿" + [CBM_EXPORT_COLUMNS.map(csvCell).join(","), ...rows].join("\r\n");
      cbmDownload(
        `치즈플래터-차단목록-${cbmExportStamp()}.csv`,
        text,
        "text/csv;charset=utf-8",
      );
    });

  // 전체 선택(현재 검색으로 보이는 항목 기준).
  cbmSelectAll?.addEventListener("change", () => {
    const q = (cbmSearchInput?.value || "").trim().toLowerCase();
    const visible = cbmBlocks.filter((b) => cbmMatchesQuery(b, q));
    if (cbmSelectAll.checked) {
      visible.forEach((b) => cbmSelected.add(b.userIdHash));
    } else {
      visible.forEach((b) => cbmSelected.delete(b.userIdHash));
    }
    renderCbmList();
  });
  // 선택 해제.
  cbmRemoveSelBtn?.addEventListener("click", () => {
    bulkRemove([...cbmSelected]);
  });
  // 전체 해제(현재 목록 전부) — 커스텀 확인 모달 후 진행.
  cbmRemoveAllBtn?.addEventListener("click", () => {
    if (!cbmBlocks.length) return;
    openCbmConfirm({
      title: "전체 차단 해제",
      body: `차단한 사용자 ${cbmBlocks.length}명을 모두 해제할까요?`,
      confirmLabel: "전체 해제",
      onConfirm: () => bulkRemove(cbmBlocks.map((b) => b.userIdHash)),
    });
  });
  // 다른 탭/페이지에서 차단 추가·해제 시 실시간 반영.
  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[COMMENT_BLOCK_KEY]) {
        const list = changes[COMMENT_BLOCK_KEY].newValue;
        cbmBlocks = Array.isArray(list) ? list : [];
        renderCbmList();
      }
    });
  }
  loadCbmBlocks();

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

  // ── 방종 후 뱅온 자동 새로고침(기본 OFF) ───────────────────────────────────
  const AUTO_RELOAD_ON_RELIVE_KEY = "cheeseAutoReloadOnRelive";
  const autoReliveInput = document.querySelector(
    "[data-auto-reload-on-relive]",
  );
  async function loadAutoReloadOnRelive() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(AUTO_RELOAD_ON_RELIVE_KEY);
      on = data?.[AUTO_RELOAD_ON_RELIVE_KEY] === true;
    } catch {}
    if (autoReliveInput) autoReliveInput.checked = on;
  }
  autoReliveInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [AUTO_RELOAD_ON_RELIVE_KEY]: autoReliveInput.checked,
      });
    } catch {}
  });
  loadAutoReloadOnRelive();

  // 뱅온 감시 최대 시간(6/12/24시간, 기본 6).
  const AUTO_RELIVE_MAX_HOURS_KEY = "cheeseAutoReliveMaxHours";
  const AUTO_RELIVE_MAX_HOURS_ALLOWED = [6, 12, 24];
  const reliveHoursButtons = Array.from(
    document.querySelectorAll("[data-relive-max-hours]"),
  );
  function reflectReliveHours(h) {
    const v = AUTO_RELIVE_MAX_HOURS_ALLOWED.includes(Number(h)) ? Number(h) : 6;
    reliveHoursButtons.forEach((btn) => {
      const active = Number(btn.dataset.reliveMaxHours) === v;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }
  async function loadReliveHours() {
    let h = 6;
    try {
      const data = await cachedStorageGet(AUTO_RELIVE_MAX_HOURS_KEY);
      const v = Number(data?.[AUTO_RELIVE_MAX_HOURS_KEY]);
      if (AUTO_RELIVE_MAX_HOURS_ALLOWED.includes(v)) h = v;
    } catch {}
    reflectReliveHours(h);
  }
  reliveHoursButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const h = Number(btn.dataset.reliveMaxHours);
      reflectReliveHours(h);
      try {
        cachedStorageSet({ [AUTO_RELIVE_MAX_HOURS_KEY]: h });
      } catch {}
    });
  });
  loadReliveHours();

  // ── 댓글 타임스탬프 클릭 시 팝오버 동작(닫기/유지/지연, 기본 닫기) ──────────
  const COMMENT_TS_CLICK_ACTION_KEY = "cheeseCommentTimestampClickAction";
  const COMMENT_TS_CLICK_DELAY_KEY = "cheeseCommentTimestampClickDelay";
  const COMMENT_TS_CLICK_ACTIONS = ["close", "keep", "delay"];
  const COMMENT_TS_CLICK_DELAY_DEFAULT = 4;
  const commentTsClickButtons = Array.from(
    document.querySelectorAll("[data-comment-ts-click]"),
  );
  const commentTsDelayRow = document.querySelector(
    "[data-comment-ts-delay-row]",
  );
  const commentTsDelayInput = document.querySelector(
    "[data-comment-ts-click-delay]",
  );
  function clampCommentTsDelay(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return COMMENT_TS_CLICK_DELAY_DEFAULT;
    return Math.min(10, Math.max(1, Math.round(n)));
  }
  function reflectCommentTsClick(action) {
    const v = COMMENT_TS_CLICK_ACTIONS.includes(action) ? action : "close";
    commentTsClickButtons.forEach((btn) => {
      const active = btn.dataset.commentTsClick === v;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    // '지연 닫기'일 때만 지연 시간 입력 행을 보인다.
    if (commentTsDelayRow) commentTsDelayRow.hidden = v !== "delay";
  }
  async function loadCommentTsClick() {
    let action = "close";
    let delay = COMMENT_TS_CLICK_DELAY_DEFAULT;
    try {
      const data = await cachedStorageGet([
        COMMENT_TS_CLICK_ACTION_KEY,
        COMMENT_TS_CLICK_DELAY_KEY,
      ]);
      const a = data?.[COMMENT_TS_CLICK_ACTION_KEY];
      if (COMMENT_TS_CLICK_ACTIONS.includes(a)) action = a;
      if (data?.[COMMENT_TS_CLICK_DELAY_KEY] !== undefined) {
        delay = clampCommentTsDelay(data[COMMENT_TS_CLICK_DELAY_KEY]);
      }
    } catch {}
    reflectCommentTsClick(action);
    if (commentTsDelayInput) commentTsDelayInput.value = String(delay);
  }
  commentTsClickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.commentTsClick;
      reflectCommentTsClick(action);
      try {
        cachedStorageSet({ [COMMENT_TS_CLICK_ACTION_KEY]: action });
      } catch {}
    });
  });
  if (commentTsDelayInput) {
    const save = () => {
      const v = clampCommentTsDelay(commentTsDelayInput.value);
      commentTsDelayInput.value = String(v); // 범위 밖 입력 보정
      try {
        cachedStorageSet({ [COMMENT_TS_CLICK_DELAY_KEY]: v });
      } catch {}
    };
    commentTsDelayInput.addEventListener("change", save);
    commentTsDelayInput.addEventListener("blur", save);
  }
  loadCommentTsClick();

  // ── 다시보기 내 채팅 기록 클릭 시 팝오버 동작 ─────────────────────────────
  // 기존 설치에서는 댓글 타임스탬프 설정을 한 번 승계한 뒤 독립적으로 저장한다.
  const CHAT_RECAP_PLAYER_BUTTON_HIDDEN_KEY =
    "cheeseChatRecapPlayerButtonHidden";
  const CHAT_RECAP_CLICK_ACTION_KEY = "cheeseChatRecapClickAction";
  const CHAT_RECAP_CLICK_DELAY_KEY = "cheeseChatRecapClickDelay";
  const chatRecapClickButtons = Array.from(
    document.querySelectorAll("[data-chat-recap-click]"),
  );
  const chatRecapDelayRow = document.querySelector(
    "[data-chat-recap-delay-row]",
  );
  const chatRecapDelayInput = document.querySelector(
    "[data-chat-recap-click-delay]",
  );
  const chatRecapPlayerButtonHiddenInput = document.querySelector(
    "[data-chat-recap-player-button-hidden]",
  );
  function reflectChatRecapClick(action) {
    const value = COMMENT_TS_CLICK_ACTIONS.includes(action) ? action : "close";
    chatRecapClickButtons.forEach((button) => {
      const active = button.dataset.chatRecapClick === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-checked", String(active));
    });
    if (chatRecapDelayRow) chatRecapDelayRow.hidden = value !== "delay";
  }
  async function loadChatRecapClick() {
    let action = "close";
    let delay = COMMENT_TS_CLICK_DELAY_DEFAULT;
    try {
      const data = await cachedStorageGet([
        CHAT_RECAP_PLAYER_BUTTON_HIDDEN_KEY,
        CHAT_RECAP_CLICK_ACTION_KEY,
        CHAT_RECAP_CLICK_DELAY_KEY,
        COMMENT_TS_CLICK_ACTION_KEY,
        COMMENT_TS_CLICK_DELAY_KEY,
      ]);
      if (chatRecapPlayerButtonHiddenInput) {
        chatRecapPlayerButtonHiddenInput.checked =
          data?.[CHAT_RECAP_PLAYER_BUTTON_HIDDEN_KEY] === true;
      }
      const storedAction = data?.[CHAT_RECAP_CLICK_ACTION_KEY];
      const legacyAction = data?.[COMMENT_TS_CLICK_ACTION_KEY];
      action = COMMENT_TS_CLICK_ACTIONS.includes(storedAction)
        ? storedAction
        : COMMENT_TS_CLICK_ACTIONS.includes(legacyAction)
          ? legacyAction
          : "close";
      const storedDelay = data?.[CHAT_RECAP_CLICK_DELAY_KEY];
      const legacyDelay = data?.[COMMENT_TS_CLICK_DELAY_KEY];
      delay = clampCommentTsDelay(
        storedDelay !== undefined ? storedDelay : legacyDelay,
      );
      const migration = {};
      if (storedAction === undefined) {
        migration[CHAT_RECAP_CLICK_ACTION_KEY] = action;
      }
      if (storedDelay === undefined) {
        migration[CHAT_RECAP_CLICK_DELAY_KEY] = delay;
      }
      if (Object.keys(migration).length) cachedStorageSet(migration);
    } catch {}
    reflectChatRecapClick(action);
    if (chatRecapDelayInput) chatRecapDelayInput.value = String(delay);
  }
  chatRecapClickButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.chatRecapClick;
      reflectChatRecapClick(action);
      cachedStorageSet({ [CHAT_RECAP_CLICK_ACTION_KEY]: action });
    });
  });
  chatRecapPlayerButtonHiddenInput?.addEventListener("change", () => {
    cachedStorageSet({
      [CHAT_RECAP_PLAYER_BUTTON_HIDDEN_KEY]:
        chatRecapPlayerButtonHiddenInput.checked,
    });
  });
  if (chatRecapDelayInput) {
    const save = () => {
      const value = clampCommentTsDelay(chatRecapDelayInput.value);
      chatRecapDelayInput.value = String(value);
      cachedStorageSet({ [CHAT_RECAP_CLICK_DELAY_KEY]: value });
    };
    chatRecapDelayInput.addEventListener("change", save);
    chatRecapDelayInput.addEventListener("blur", save);
  }
  loadChatRecapClick();

  // ── 메인 진입 시 팔로우로 이동(기본 OFF) ──────────────────────────────────
  const ROOT_TO_FOLLOWING_KEY = "cheeseRootToFollowing";
  const rootToFollowingInput = document.querySelector(
    "[data-root-to-following]",
  );
  async function loadRootToFollowing() {
    let on = false; // 기본 꺼짐
    try {
      const data = await cachedStorageGet(ROOT_TO_FOLLOWING_KEY);
      on = data?.[ROOT_TO_FOLLOWING_KEY] === true;
    } catch {}
    if (rootToFollowingInput) rootToFollowingInput.checked = on;
  }
  rootToFollowingInput?.addEventListener("change", () => {
    try {
      cachedStorageSet({
        [ROOT_TO_FOLLOWING_KEY]: rootToFollowingInput.checked,
      });
    } catch {}
  });
  loadRootToFollowing();

  // 하위: 로고 클릭 시 이동 모드(포함/제외/단독, 기본 제외).
  const ROOT_TO_FOLLOWING_LOGO_KEY = "cheeseRootToFollowingLogoMode";
  const ROOT_LOGO_MODE_ALLOWED = ["include", "exclude", "only"];
  const rootLogoModeButtons = Array.from(
    document.querySelectorAll("[data-root-logo-mode]"),
  );
  function reflectRootLogoMode(mode) {
    const v = ROOT_LOGO_MODE_ALLOWED.includes(mode) ? mode : "exclude";
    rootLogoModeButtons.forEach((btn) => {
      const active = btn.dataset.rootLogoMode === v;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    // '단독'이면 진입 이동을 무시하므로 상위 '메인 진입 시 이동' 토글을 회색 비활성화한다.
    if (rootToFollowingInput) {
      const lock = v === "only";
      rootToFollowingInput.disabled = lock;
      rootToFollowingInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", lock);
    }
  }
  async function loadRootLogoMode() {
    let mode = "exclude";
    try {
      const data = await cachedStorageGet(ROOT_TO_FOLLOWING_LOGO_KEY);
      const v = data?.[ROOT_TO_FOLLOWING_LOGO_KEY];
      if (ROOT_LOGO_MODE_ALLOWED.includes(v)) mode = v;
    } catch {}
    reflectRootLogoMode(mode);
  }
  rootLogoModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.rootLogoMode;
      reflectRootLogoMode(mode);
      try {
        cachedStorageSet({ [ROOT_TO_FOLLOWING_LOGO_KEY]: mode });
      } catch {}
    });
  });
  loadRootLogoMode();

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
    const listRight = buttonOrderRoot.querySelector(
      '[data-order-list="right"]',
    );
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
      const savedSlot = saved && typeof saved === "object" ? saved.slot : null;
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
      const dragging = !!dragEl;
      dragEl?.classList.remove("is-dragging");
      dragEl = null;
      buttonOrderRoot
        .querySelectorAll(".is-drop-over")
        .forEach((el) => el.classList.remove("is-drop-over"));
      // ⚠ drop 만으로는 부족하다. dragover 가 DOM 을 실시간으로 옮기므로 목록은 이미
      // 새 순서인데, 항목 사이 여백이나 목록 밖에서 놓으면 drop 이 발생하지 않아
      // 저장만 건너뛴다(화면과 저장값 불일치). dragend 는 항상 발생한다.
      if (dragging) saveFromDom();
    });
    // 드롭 지점(항목 위/아래 또는 빈 목록) 계산해 미리 삽입 위치를 잡는다.
    // 오디오 믹서·비디오 필터는 '한 묶음'이라 그 사이에는 놓을 수 없다: 삽입 후보가
    // 묶음 사이(=필터 칩 앞)면 묶음 앞(믹서 칩 앞)으로 스냅한다.
    function dragOverList(ul, e) {
      e.preventDefault();
      if (!dragEl) return;
      let after = getDragAfterElement(ul, e.clientY);
      after = snapPastMixerFilter(ul, after);
      after = snapAfterPlayback(ul, after);
      if (after == null) ul.appendChild(dragEl);
      else ul.insertBefore(dragEl, after);
    }
    // 재생 버튼 앞에는 놓을 수 없다(재생 앞은 무한 깜빡임 위험으로 런타임에서 볼륨/필터
    // 뒤로 강제되므로, UI 도 재생 칩 위 드롭을 막아 표시와 실제 배치를 일치시킨다).
    // 삽입 후보 after 가 '재생 칩'(=재생 앞에 놓임)이면 재생 칩 다음으로 밀어낸다.
    function snapAfterPlayback(ul, after) {
      if (!after || !after.dataset) return after;
      if (after.dataset.nativeAnchor !== "pzp-playback-switch") return after;
      let next = after.nextElementSibling;
      if (next === dragEl) next = next.nextElementSibling;
      return next; // 재생 칩 '뒤'로. next 가 null 이면 append(재생 바로 뒤).
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
        e.preventDefault(); // 저장은 dragend 에서 일괄 처리한다(위 주석 참고)
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
  const CAFE_NOW_AUTOPLAY_KEY = "cheeseCafeNowAutoplay";
  const CAFE_NOW_AUTOPLAY_MUTED_KEY = "cheeseCafeNowAutoplayMuted";
  const cafeNowInput = document.querySelector("[data-cafe-now]");
  const cafeNowAutoplayInput = document.querySelector(
    "[data-cafe-now-autoplay]",
  );
  const cafeNowAutoplayRow = cafeNowAutoplayInput?.closest(".settings-item");
  const cafeNowAutoplayMutedInput = document.querySelector(
    "[data-cafe-now-autoplay-muted]",
  );
  const cafeNowAutoplayMutedRow =
    cafeNowAutoplayMutedInput?.closest(".settings-item");
  const reflectCafeNowAutoplayAvailability = () => {
    const enabled = cafeNowInput?.checked === true;
    if (cafeNowAutoplayInput) cafeNowAutoplayInput.disabled = !enabled;
    cafeNowAutoplayRow?.classList.toggle("is-locked", !enabled);
    const autoplayEnabled = enabled && cafeNowAutoplayInput?.checked === true;
    if (cafeNowAutoplayMutedInput) {
      cafeNowAutoplayMutedInput.disabled = !autoplayEnabled;
    }
    cafeNowAutoplayMutedRow?.classList.toggle("is-locked", !autoplayEnabled);
  };
  if (cafeNowInput) {
    (async () => {
      let on = true; // 기본 ON
      let autoplay = false; // 소리·트래픽이 발생할 수 있어 기본 OFF
      let autoplayMuted = true;
      try {
        const d = await cachedStorageGet([
          CAFE_NOW_KEY,
          CAFE_NOW_AUTOPLAY_KEY,
          CAFE_NOW_AUTOPLAY_MUTED_KEY,
        ]);
        on = d?.[CAFE_NOW_KEY] !== false; // 미설정/true=사용
        autoplay = d?.[CAFE_NOW_AUTOPLAY_KEY] === true;
        autoplayMuted = d?.[CAFE_NOW_AUTOPLAY_MUTED_KEY] !== false;
      } catch {}
      cafeNowInput.checked = on;
      if (cafeNowAutoplayInput) cafeNowAutoplayInput.checked = autoplay;
      if (cafeNowAutoplayMutedInput) {
        cafeNowAutoplayMutedInput.checked = autoplayMuted;
      }
      reflectCafeNowAutoplayAvailability();
    })();
    cafeNowInput.addEventListener("change", () => {
      try {
        cachedStorageSet({ [CAFE_NOW_KEY]: cafeNowInput.checked });
      } catch {}
      reflectCafeNowAutoplayAvailability();
    });
    cafeNowAutoplayInput?.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [CAFE_NOW_AUTOPLAY_KEY]: cafeNowAutoplayInput.checked,
        });
      } catch {}
      reflectCafeNowAutoplayAvailability();
    });
    cafeNowAutoplayMutedInput?.addEventListener("change", () => {
      try {
        cachedStorageSet({
          [CAFE_NOW_AUTOPLAY_MUTED_KEY]: cafeNowAutoplayMutedInput.checked,
        });
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
      const data = await cachedStorageGet([SYNC_PRESET_KEY, SYNC_CUSTOM_KEY]);
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

  // ── 따라잡기 배속(1.2/1.5/2/3, 기본 1.5) ──────────────────────────────────
  // ── 따라잡기 방식(배속 / 즉시 라이브로 이동) ───────────────────────────────
  // 제보: "배속 말고 원클릭으로 맨 앞으로 땡기는 방식도 있으면 좋겠다".
  const SYNC_MODE_KEY = "cheeseSyncMode";
  const SYNC_MODE_ALLOWED = ["rate", "jump"];
  const syncModeButtons = Array.from(
    document.querySelectorAll("[data-sync-mode]"),
  );
  const syncRateRow = document.getElementById("syncRateRow");
  function reflectSyncMode(v) {
    const val = SYNC_MODE_ALLOWED.includes(String(v)) ? String(v) : "rate";
    syncModeButtons.forEach((btn) => {
      const active = btn.dataset.syncMode === val;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    // 즉시 이동 모드에서는 배속 값이 쓰이지 않으므로 배속 설정을 가린다.
    if (syncRateRow) syncRateRow.hidden = val === "jump";
  }
  (async () => {
    let v = "rate";
    try {
      const d = await cachedStorageGet(SYNC_MODE_KEY);
      if (SYNC_MODE_ALLOWED.includes(String(d?.[SYNC_MODE_KEY])))
        v = String(d[SYNC_MODE_KEY]);
    } catch {}
    reflectSyncMode(v);
  })();
  syncModeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.syncMode;
      reflectSyncMode(v);
      try {
        cachedStorageSet({ [SYNC_MODE_KEY]: v });
      } catch {}
    });
  });

  const SYNC_RATE_KEY = "cheeseSyncRate";
  const SYNC_RATE_ALLOWED = ["1.2", "1.5", "2", "3"];
  const syncRateButtons = Array.from(
    document.querySelectorAll("[data-sync-rate]"),
  );
  function reflectSyncRate(v) {
    const val = SYNC_RATE_ALLOWED.includes(String(v)) ? String(v) : "1.5";
    syncRateButtons.forEach((btn) => {
      const active = btn.dataset.syncRate === val;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }
  (async () => {
    let v = "1.5";
    try {
      const d = await cachedStorageGet(SYNC_RATE_KEY);
      if (SYNC_RATE_ALLOWED.includes(String(d?.[SYNC_RATE_KEY])))
        v = String(d[SYNC_RATE_KEY]);
    } catch {}
    reflectSyncRate(v);
  })();
  syncRateButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.syncRate;
      reflectSyncRate(v);
      try {
        cachedStorageSet({ [SYNC_RATE_KEY]: Number(v) });
      } catch {}
    });
  });

  // ── 자동 따라잡기 쿨다운(사용/끔 + 커스텀 base/max 초) ─────────────────────
  const SYNC_CD_ENABLED_KEY = "cheeseSyncCooldownEnabled";
  const SYNC_CD_CUSTOM_KEY = "cheeseSyncCooldownCustom";
  const SYNC_CD_DEFAULT = { base: 15, max: 120 };
  const syncCdButtons = Array.from(
    document.querySelectorAll("[data-sync-cooldown]"),
  );
  const syncCdRow = document.getElementById("syncCooldownRow");
  const syncCdBase = document.getElementById("syncCooldownBase");
  const syncCdMax = document.getElementById("syncCooldownMax");
  function reflectSyncCooldown(enabled) {
    const on = enabled !== false;
    syncCdButtons.forEach((btn) => {
      const active = (btn.dataset.syncCooldown === "on") === on;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    // 끔이면 커스텀 값 입력은 의미 없으니 흐리게(숨기지 않고 비활성).
    if (syncCdRow) syncCdRow.style.opacity = on ? "" : "0.4";
    [syncCdBase, syncCdMax].forEach((el) => {
      if (el) el.disabled = !on;
    });
  }
  function saveSyncCooldownCustom() {
    let base = clamp(syncCdBase?.value, 5, 120, SYNC_CD_DEFAULT.base);
    let max = clamp(syncCdMax?.value, 5, 600, SYNC_CD_DEFAULT.max);
    base = Math.round(base);
    max = Math.round(max);
    if (max < base) max = base;
    if (syncCdBase) syncCdBase.value = String(base);
    if (syncCdMax) syncCdMax.value = String(max);
    try {
      cachedStorageSet({ [SYNC_CD_CUSTOM_KEY]: { base, max } });
    } catch {}
  }
  (async () => {
    let enabled = true;
    let custom = { ...SYNC_CD_DEFAULT };
    try {
      const d = await cachedStorageGet([
        SYNC_CD_ENABLED_KEY,
        SYNC_CD_CUSTOM_KEY,
      ]);
      enabled = d?.[SYNC_CD_ENABLED_KEY] !== false;
      const c = d?.[SYNC_CD_CUSTOM_KEY];
      if (c && typeof c === "object") {
        custom = {
          base: Math.round(clamp(c.base, 5, 120, SYNC_CD_DEFAULT.base)),
          max: Math.round(clamp(c.max, 5, 600, SYNC_CD_DEFAULT.max)),
        };
        if (custom.max < custom.base) custom.max = custom.base;
      }
    } catch {}
    if (syncCdBase) syncCdBase.value = String(custom.base);
    if (syncCdMax) syncCdMax.value = String(custom.max);
    reflectSyncCooldown(enabled);
  })();
  syncCdButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const on = btn.dataset.syncCooldown === "on";
      reflectSyncCooldown(on);
      try {
        cachedStorageSet({ [SYNC_CD_ENABLED_KEY]: on });
      } catch {}
    });
  });
  [syncCdBase, syncCdMax].forEach((el) =>
    el?.addEventListener("change", saveSyncCooldownCustom),
  );

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

  // ── 라운지 소식 새 글 확인 주기(분, 기본 10) ───────────────────────────────
  const LOUNGE_REFRESH_KEY = "cheeseLoungeRefreshMin";
  const INBOX_COMMUNITY_OPEN_NEW_TAB_KEY = "cheeseInboxCommunityOpenNewTab";
  const LOUNGE_REFRESH_PRESETS = [3, 5, 10, 30, 60];
  const LOUNGE_REFRESH_DEFAULT = 10;
  const loungeRefreshButtons = Array.from(
    document.querySelectorAll("[data-lounge-refresh]"),
  );
  const loungeNewsInput = document.querySelector('[data-feature="loungeNews"]');
  const inboxLogPowerInput = document.querySelector(
    '[data-feature="inboxLogPower"]',
  );
  const inboxCommunityNewsInput = document.querySelector(
    '[data-feature="inboxCommunityNews"]',
  );
  const inboxCommunityNewTabInput = document.querySelector(
    "[data-inbox-community-new-tab]",
  );
  // 두 값 모두 '숨김' 플래그다(체크=숨김). 주기 타이머가 각각 따로 돌므로,
  // 각 주기 선택은 '자기 기능'이 숨겨졌을 때만 잠근다.
  function reflectLoungeRefreshAvailability() {
    // ⚠ 기능 플래그 로더(load())도 이 함수를 부른다. 그 시점에 아래쪽 const 들이 아직
    // 초기화 전일 수 있으므로(TDZ) 캡처된 변수를 쓰지 않고 DOM 에서 직접 찾는다.
    const loungeInput = document.querySelector('[data-feature="loungeNews"]');
    const communityInput = document.querySelector(
      '[data-feature="inboxCommunityNews"]',
    );
    const disabled = loungeInput?.checked === true;
    document.querySelectorAll("[data-lounge-refresh]").forEach((btn) => {
      btn.disabled = disabled;
    });
    document
      .getElementById("loungeRefresh")
      ?.closest(".settings-item")
      ?.classList.toggle("is-locked", disabled);
    const loungeDotInput = document.querySelector(
      '[data-feature="loungeNewsDot"]',
    );
    if (loungeDotInput) {
      loungeDotInput.disabled = disabled;
      loungeDotInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", disabled);
    }
    const communityDisabled = communityInput?.checked === true;
    const communityDotInput = document.querySelector(
      '[data-feature="inboxCommunityNewsDot"]',
    );
    if (communityDotInput) {
      communityDotInput.disabled = communityDisabled;
      communityDotInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", communityDisabled);
    }
    document
      .querySelectorAll("[data-inbox-community-refresh]")
      .forEach((btn) => {
        btn.disabled = communityDisabled;
      });
    document
      .getElementById("inboxCommunityRefresh")
      ?.closest(".settings-item")
      ?.classList.toggle("is-locked", communityDisabled);
    const newTabInput = document.querySelector(
      "[data-inbox-community-new-tab]",
    );
    if (newTabInput) {
      newTabInput.disabled = communityDisabled;
      newTabInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", communityDisabled);
    }
    const logPowerDisabled =
      document.querySelector('[data-feature="inboxLogPower"]')?.checked ===
      true;
    const logPowerDotInput = document.querySelector(
      '[data-feature="inboxLogPowerDot"]',
    );
    if (logPowerDotInput) {
      logPowerDotInput.disabled = logPowerDisabled;
      logPowerDotInput
        .closest(".settings-item")
        ?.classList.toggle("is-locked", logPowerDisabled);
    }
  }
  loungeNewsInput?.addEventListener("change", reflectLoungeRefreshAvailability);
  inboxCommunityNewsInput?.addEventListener(
    "change",
    reflectLoungeRefreshAvailability,
  );
  inboxLogPowerInput?.addEventListener(
    "change",
    reflectLoungeRefreshAvailability,
  );
  (async () => {
    let enabled = false;
    try {
      const data = await cachedStorageGet(INBOX_COMMUNITY_OPEN_NEW_TAB_KEY);
      enabled = data?.[INBOX_COMMUNITY_OPEN_NEW_TAB_KEY] === true;
    } catch {}
    if (inboxCommunityNewTabInput) {
      inboxCommunityNewTabInput.checked = enabled;
    }
  })();
  inboxCommunityNewTabInput?.addEventListener("change", () => {
    cachedStorageSet({
      [INBOX_COMMUNITY_OPEN_NEW_TAB_KEY]: inboxCommunityNewTabInput.checked,
    });
  });
  function reflectLoungeRefresh(minRaw) {
    const n = Number(minRaw);
    const min = LOUNGE_REFRESH_PRESETS.includes(n) ? n : LOUNGE_REFRESH_DEFAULT;
    loungeRefreshButtons.forEach((btn) => {
      const active = Number(btn.dataset.loungeRefresh) === min;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }
  async function loadLoungeRefresh() {
    let min = LOUNGE_REFRESH_DEFAULT;
    try {
      const data = await cachedStorageGet(LOUNGE_REFRESH_KEY);
      if (data?.[LOUNGE_REFRESH_KEY] != null) min = data[LOUNGE_REFRESH_KEY];
    } catch {}
    reflectLoungeRefresh(min);
    reflectLoungeRefreshAvailability();
  }
  loungeRefreshButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const min = Number(btn.dataset.loungeRefresh);
      reflectLoungeRefresh(min);
      try {
        cachedStorageSet({ [LOUNGE_REFRESH_KEY]: min });
      } catch {}
    });
  });
  loadLoungeRefresh();

  // ── 커뮤니티 새 글 확인 주기(라운지와 별도) ────────────────────────────────
  // 미설정이면 라운지 값을 그대로 따른다(기존 사용자 동작 유지). 그래서 초기 표시도
  // 라운지 값을 읽어 보여 준다 — 사용자가 한 번 고르면 그때부터 독립한다.
  const INBOX_COMMUNITY_REFRESH_KEY = "cheeseInboxCommunityRefreshMin";
  const inboxCommunityRefreshButtons = Array.from(
    document.querySelectorAll("[data-inbox-community-refresh]"),
  );
  function reflectInboxCommunityRefresh(minRaw) {
    const n = Number(minRaw);
    const min = LOUNGE_REFRESH_PRESETS.includes(n) ? n : LOUNGE_REFRESH_DEFAULT;
    inboxCommunityRefreshButtons.forEach((btn) => {
      const active = Number(btn.dataset.inboxCommunityRefresh) === min;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }
  async function loadInboxCommunityRefresh() {
    let min = LOUNGE_REFRESH_DEFAULT;
    try {
      const data = await cachedStorageGet([
        INBOX_COMMUNITY_REFRESH_KEY,
        LOUNGE_REFRESH_KEY,
      ]);
      const own = data?.[INBOX_COMMUNITY_REFRESH_KEY];
      if (own != null) min = own;
      else if (data?.[LOUNGE_REFRESH_KEY] != null)
        min = data[LOUNGE_REFRESH_KEY];
    } catch {}
    reflectInboxCommunityRefresh(min);
  }
  inboxCommunityRefreshButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const min = Number(btn.dataset.inboxCommunityRefresh);
      reflectInboxCommunityRefresh(min);
      try {
        cachedStorageSet({ [INBOX_COMMUNITY_REFRESH_KEY]: min });
      } catch {}
    });
  });
  loadInboxCommunityRefresh();

  // 인기 카테고리 / 다가오는 방송 일정도 함께 갱신(기본 OFF). 팔로우 갱신 주기에 얹힘.
  function bindSectionRefreshToggle(sel, key) {
    const input = document.querySelector(sel);
    if (!input) return;
    (async () => {
      let on = false;
      try {
        const d = await cachedStorageGet(key);
        on = d?.[key] === true;
      } catch {}
      input.checked = on;
    })();
    input.addEventListener("change", () => {
      try {
        cachedStorageSet({ [key]: input.checked });
      } catch {}
    });
  }
  bindSectionRefreshToggle(
    "[data-section-refresh-category]",
    "cheeseSectionRefreshCategory",
  );
  bindSectionRefreshToggle(
    "[data-section-refresh-schedule]",
    "cheeseSectionRefreshSchedule",
  );

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
