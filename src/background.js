const SERVICE_API_BASE = "https://api.chzzk.naver.com/service/v1";
const API_BASE = `${SERVICE_API_BASE}/channels`;
const MANAGE_API_BASE = "https://api.chzzk.naver.com/manage/v1";
const CREATORHUB_API_BASE = "https://creatorhub-api.naver.com/api/v5.0";
const CREATORHUB_CLIP_CARD_API_BASE =
  "https://creatorhub-api.naver.com/api/v7.0";
const COMMENT_API_BASE = "https://apis.naver.com/nng_main/nng_comment_api/v1";
const CLIP_LIKE_API_BASE =
  "https://apis.naver.com/clip-viewer-web/like/v1/services/CHZZK/contents";
const CACHE_TTL_MS = 1 * 60 * 60 * 1000;
const COMMENT_TIMESTAMP_CACHE_TTL_MS = 30 * 60 * 1000;
const COMMENT_TIMESTAMP_CACHE_VERSION = 4;
const SORT_METRIC_CACHE_TTL_MS = 30 * 60 * 1000;
const PAGE_SIZE = 50;
const CLIP_PAGE_SIZE = 50;
const COMMENT_TIMESTAMP_PAGE_SIZE = 30;
const COMMENT_TIMESTAMP_MAX_PAGES = 5;
const COMMENT_TIMESTAMP_CLUSTER_RANGE_SECONDS = 3;
const SEARCH_CHANNEL_PAGE_SIZE = 33;
const MAX_CONCURRENT_PAGE_REQUESTS = 3;
const MAX_CONCURRENT_COLLECTION_TASKS = 2;
const MAKE_CLIP_PAGE_SIZE = 50;
const CHANNEL_SEARCH_COOLDOWN_MS = 900;
const FETCH_RETRY_DELAYS_MS = [500, 1200, 2500];
const CLIP_MISSING_CONFIRMATION_COUNT = 2;
const CLIP_PAGE_THROTTLE_MS = 50;
const SORT_METRIC_CONCURRENCY = 6;
const CLIP_REACTION_TIMEOUT_MS = 3500;
const CLIP_REACTION_FAILURE_LIMIT = 12;
const CLIP_TAG_ENRICH_LIMIT = 24;
const CLIP_TAG_FETCH_CONCURRENCY = 6;
const CLIP_TAG_FETCH_TIMEOUT_MS = 4000;
const CLIP_TAG_CACHE_TTL_MS = 30 * 60 * 1000;
const CLIP_TAG_FAILURE_CACHE_TTL_MS = 2 * 60 * 1000;
const CLIP_TAG_CACHE_MAX = 2000;
const CLIP_VAULT_METRIC_CACHE_TTL_MS = 30 * 60 * 1000;
const CLIP_VAULT_METRIC_FAILURE_CACHE_TTL_MS = 2 * 60 * 1000;
const CLIP_VAULT_METRIC_CACHE_MAX = 2000;
const CLIP_VAULT_METRIC_BATCH_MAX = 60;
const CLIP_VAULT_METRIC_CONCURRENCY = 4;
const CLIP_VAULT_METRIC_FETCH_TIMEOUT_MS = 8000;
const CLIP_VAULT_FOLLOWING_IMPORT_CHANNEL_BATCH = 5;
const CLIP_VAULT_FOLLOWING_IMPORT_CANDIDATE_MAX = 100;
const CLIP_VAULT_FOLLOWING_IMPORT_PAGE_BATCH_MAX = 4;
const CLIP_VAULT_FOLLOWING_IMPORT_REACTION_CONCURRENCY = 4;
const CLIP_VAULT_FOLLOWING_IMPORT_FETCH_TIMEOUT_MS = 10000;
const CLIP_VAULT_FOLLOWING_IMPORT_CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;

const CACHE_STORAGE_PREFIX = "cache:";
const CHANNEL_SEARCH_STORAGE_PREFIX = "channelSearch:";
const CACHE_CHUNK_SEPARATOR = "#chunk:";
const CACHE_CHUNK_SIZE = 1000;
const UPDATE_NOTICE_ENABLED_KEY = "cheeseUpdateNoticeEnabled";
const UPDATE_NOTICE_MODE_KEY = "cheeseUpdateNoticeMode";
const UPDATE_NOTICE_DURATION_KEY = "cheeseUpdateNoticeDurationSec";
const UPDATE_NOTICE_TOAST_POSITION_KEY = "cheeseUpdateNoticeToastPosition";
const UPDATE_NOTICE_DEFAULT_MODE = "fixed";
const UPDATE_NOTICE_DEFAULT_DURATION_SEC = 3;
const UPDATE_NOTICE_DEFAULT_TOAST_POSITION = "top-center";
const CHAT_HISTORY_ENABLED_KEY = "cheeseChatHistory";
const CHAT_HISTORY_STORAGE_PREFIX = "cheeseChatHistory:";
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
const MASTER_ENABLED_KEY = "cheeseMasterEnabled";
const LIVE_TAG_FILTER_BUTTON_KEY = "cheeseLiveTagFilterButton";
const SETTINGS_NEW_FEATURE_BASELINE_KEY =
  "cheeseSettingsNewFeatureBaselinePending";
const SETTINGS_NEW_FEATURE_UPDATE_KEY = "cheeseSettingsNewFeatureUpdatePending";
const REFRESH_NOTICE_URLS = [
  "https://chzzk.naver.com/*",
  "https://studio.chzzk.naver.com/*",
  "https://m.naver.com/shorts/*",
  "https://cafe.naver.com/*",
  "https://*.cafe.naver.com/*",
  "https://game.naver.com/profile*",
];
let masterEnabled = true;

const masterStateReady = chrome.storage.local
  .get(MASTER_ENABLED_KEY)
  .then((data) => {
    masterEnabled = data?.[MASTER_ENABLED_KEY] !== false;
    return masterEnabled;
  })
  .catch(() => true);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[MASTER_ENABLED_KEY]) {
    masterEnabled = changes[MASTER_ENABLED_KEY].newValue !== false;
  }
  if (
    area === "local" &&
    changes[CHAT_HISTORY_ENABLED_KEY]?.newValue === true
  ) {
    void disableChatHistory();
  }
});

async function showRefreshNoticeOnExtensionTabs(reason) {
  const preferences = await chrome.storage.local.get([
    UPDATE_NOTICE_MODE_KEY,
    UPDATE_NOTICE_DURATION_KEY,
    UPDATE_NOTICE_TOAST_POSITION_KEY,
  ]);
  const storedMode = preferences?.[UPDATE_NOTICE_MODE_KEY];
  const noticeMode = UPDATE_NOTICE_MODES.has(storedMode)
    ? storedMode
    : UPDATE_NOTICE_DEFAULT_MODE;
  const storedDuration = Number(preferences?.[UPDATE_NOTICE_DURATION_KEY]);
  const durationSec = UPDATE_NOTICE_DURATIONS.has(storedDuration)
    ? storedDuration
    : UPDATE_NOTICE_DEFAULT_DURATION_SEC;
  const storedToastPosition = preferences?.[UPDATE_NOTICE_TOAST_POSITION_KEY];
  const toastPosition = UPDATE_NOTICE_TOAST_POSITIONS.has(storedToastPosition)
    ? storedToastPosition
    : UPDATE_NOTICE_DEFAULT_TOAST_POSITION;
  const tabs = await chrome.tabs.query({ url: REFRESH_NOTICE_URLS });
  const version = chrome.runtime.getManifest().version;
  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showUpdateNotificationBanner,
          args: [version, reason, noticeMode, toastPosition, durationSec],
        }),
      ),
  );
  return tabs.length;
}

const cache = new Map();
const inFlightFetches = new Map();
const channelSearchCache = new Map();
const categoryInfoCache = new Map();
const categoryInfoInFlight = new Map();
const commentTimestampCache = new Map();
const videoCommentCountCache = new Map();
const clipTagCache = new Map();
const clipTagInFlight = new Map();
const clipVaultFollowingImportControllers = new Map();
const collectionTaskQueue = [];
let activeCollectionTaskCount = 0;
let channelSearchQueue = Promise.resolve();
let lastChannelSearchStartedAt = 0;

const persistentStorage =
  chrome.storage && chrome.storage.local ? chrome.storage.local : null;

if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(handleMakeClipDeleteCompleted, {
    urls: [`${MANAGE_API_BASE}/channels/*/clips/*`],
    types: ["xmlhttprequest"],
  });
}

// storage.session 을 사용하는 기능을 콘텐츠 스크립트에서도 읽고 쓸 수 있게 한다.
// 서비스 워커는 수시로 깨었다 죽으므로 최초 실행 시점에 매번 호출한다.
try {
  chrome.storage.session
    .setAccessLevel?.({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch(() => {});
} catch {}

async function disableChatHistory(clearRecords = false) {
  try {
    const state = await chrome.storage.local.get(CHAT_HISTORY_ENABLED_KEY);
    if (state?.[CHAT_HISTORY_ENABLED_KEY] !== false) {
      await chrome.storage.local.set({ [CHAT_HISTORY_ENABLED_KEY]: false });
    }
  } catch {}
  if (!clearRecords) return;
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((key) =>
      key.startsWith(CHAT_HISTORY_STORAGE_PREFIX),
    );
    if (keys.length) await chrome.storage.local.remove(keys);
  } catch {}
  try {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all || {}).filter((key) =>
      key.startsWith(CHAT_HISTORY_STORAGE_PREFIX),
    );
    if (keys.length) await chrome.storage.session.remove(keys);
  } catch {}
}

// 채팅 이어보기는 복원 순서와 중복 문제가 해결될 때까지 노출하지 않는다. 이전에 기능을
// 켠 사용자도 서비스 워커 시작과 확장 업데이트에서 끄고 남은 기록을 함께 정리한다.
void disableChatHistory();
chrome.runtime.onStartup.addListener(() => {
  void disableChatHistory(true);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  // 설치 직후에는 항상, 업데이트 때는 사용자 설정에 따라 안내를 띄운다. 이미 열려 있던
  // 치지직 탭에는 새 콘텐츠 스크립트가 주입되지 않아 새로고침해야 최신 코드가 동작한다.
  if (details.reason !== "install" && details.reason !== "update") return;

  await disableChatHistory(true);

  // 신규 설치에서는 현재 기능을 모두 기준점으로 삼아 NEW를 표시하지 않는다. 업데이트는
  // 설정 페이지가 data-new-feature로 선언한 기능 중 아직 확인하지 않은 항목만 표시한다.
  // 설치 직후 설정을 열지 않은 채 업데이트된 경우에도 신규 설치 기준점을 유지한다.
  try {
    if (details.reason === "install") {
      await chrome.storage.local.set({
        [SETTINGS_NEW_FEATURE_BASELINE_KEY]: true,
      });
      await chrome.storage.local.remove(SETTINGS_NEW_FEATURE_UPDATE_KEY);
    } else {
      const state = await chrome.storage.local.get(
        SETTINGS_NEW_FEATURE_BASELINE_KEY,
      );
      if (state?.[SETTINGS_NEW_FEATURE_BASELINE_KEY] !== true) {
        await chrome.storage.local.set({
          [SETTINGS_NEW_FEATURE_UPDATE_KEY]: true,
        });
      }
    }
  } catch (error) {
    console.warn("새 기능 표시 상태를 기록하지 못했습니다.", error);
  }

  // 예전 버전은 제외 필터 버튼의 미설정 기본값이 ON이었다. 저장값이 없는 기존 사용자는
  // 종전 상태를 유지하고, 신규 설치만 OFF로 시작한다. 명시된 사용자 값은 덮어쓰지 않는다.
  try {
    const stored = await chrome.storage.local.get(LIVE_TAG_FILTER_BUTTON_KEY);
    if (
      !Object.prototype.hasOwnProperty.call(
        stored || {},
        LIVE_TAG_FILTER_BUTTON_KEY,
      )
    ) {
      await chrome.storage.local.set({
        [LIVE_TAG_FILTER_BUTTON_KEY]: details.reason === "update",
      });
    }
  } catch (error) {
    console.warn("제외 필터 버튼 기본값을 초기화하지 못했습니다.", error);
  }

  try {
    if ((await masterStateReady) === false) return;
    let noticeMode = UPDATE_NOTICE_DEFAULT_MODE;
    let durationSec = UPDATE_NOTICE_DEFAULT_DURATION_SEC;
    let toastPosition = UPDATE_NOTICE_DEFAULT_TOAST_POSITION;
    if (details.reason === "update") {
      const preferences = await chrome.storage.local.get([
        UPDATE_NOTICE_ENABLED_KEY,
        UPDATE_NOTICE_MODE_KEY,
        UPDATE_NOTICE_DURATION_KEY,
        UPDATE_NOTICE_TOAST_POSITION_KEY,
      ]);
      if (preferences?.[UPDATE_NOTICE_ENABLED_KEY] === false) return;
      const storedMode = preferences?.[UPDATE_NOTICE_MODE_KEY];
      if (UPDATE_NOTICE_MODES.has(storedMode)) noticeMode = storedMode;
      const storedDuration = Number(preferences?.[UPDATE_NOTICE_DURATION_KEY]);
      if (UPDATE_NOTICE_DURATIONS.has(storedDuration)) {
        durationSec = storedDuration;
      }
      const storedToastPosition =
        preferences?.[UPDATE_NOTICE_TOAST_POSITION_KEY];
      if (UPDATE_NOTICE_TOAST_POSITIONS.has(storedToastPosition)) {
        toastPosition = storedToastPosition;
      }
    }

    const tabs = await chrome.tabs.query({
      url: ["https://chzzk.naver.com/*", "https://studio.chzzk.naver.com/*"],
    });
    const version = chrome.runtime.getManifest().version;

    await Promise.allSettled(
      tabs
        .filter((tab) => Number.isInteger(tab.id))
        .map((tab) =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: showUpdateNotificationBanner,
            args: [
              version,
              details.reason,
              noticeMode,
              toastPosition,
              durationSec,
            ],
          }),
        ),
    );
  } catch (error) {
    console.warn("안내 배너를 표시하지 못했습니다.", error);
  }
});

function showUpdateNotificationBanner(
  version,
  reason,
  requestedMode,
  requestedToastPosition,
  requestedDurationSec,
) {
  const bannerId = "cheese-search-ext-update-banner";
  document.getElementById(bannerId)?.remove();

  const requestedDuration = Number(requestedDurationSec);
  const transientDurationSec = [3, 5, 10, 15].includes(requestedDuration)
    ? requestedDuration
    : 3;
  const transientMs = transientDurationSec * 1000;
  const mode =
    reason === "install" ||
    !["fixed", "temporary", "toast"].includes(requestedMode)
      ? "fixed"
      : requestedMode;
  const isToast = mode === "toast";
  const isTransient = mode !== "fixed";
  const toastPositions = new Set([
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
  const toastPosition = toastPositions.has(requestedToastPosition)
    ? requestedToastPosition
    : "top-center";
  const [toastRow, toastColumn] = toastPosition.split("-");
  const toastPositionStyles = [
    toastRow === "top"
      ? "top:20px"
      : toastRow === "middle"
        ? "top:50%"
        : "bottom:20px",
    toastColumn === "left"
      ? "left:20px"
      : toastColumn === "center"
        ? "left:50%"
        : "right:20px",
  ];
  const toastAnchorTransform = [
    toastColumn === "center" ? "translateX(-50%)" : "",
    toastRow === "middle" ? "translateY(-50%)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const toastHiddenOffset =
    toastRow === "top" ? "translateY(-16px)" : "translateY(16px)";
  const toastVisibleTransform = `${toastAnchorTransform} scale(1)`.trim();
  const toastHiddenTransform =
    `${toastAnchorTransform} ${toastHiddenOffset} scale(.98)`.trim();
  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.style.cssText = isToast
    ? [
        "position:fixed",
        ...toastPositionStyles,
        "z-index:2147483647",
        "box-sizing:border-box",
        "width:min(440px,calc(100vw - 32px))",
        "padding:14px",
        "border:1px solid rgba(255,255,255,.14)",
        "border-radius:8px",
        "background:#24272d",
        "color:#fff",
        "font-family:Arial,sans-serif",
        "font-size:14px",
        "font-weight:600",
        "line-height:20px",
        "text-align:left",
        "box-shadow:0 8px 28px rgba(0,0,0,.34)",
        "opacity:0",
        `transform:${toastHiddenTransform}`,
        "transition:opacity .25s ease,transform .25s ease",
      ].join(";")
    : [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "z-index:2147483647",
        "box-sizing:border-box",
        "padding:11px 16px",
        "background:linear-gradient(90deg,#e4ce00,#168f5c,#4e41db)",
        "color:#fff",
        "font-family:Arial,sans-serif",
        "font-size:14px",
        "font-weight:600",
        "line-height:20px",
        "text-align:center",
        "box-shadow:0 2px 8px rgba(0,0,0,.2)",
        "transform:translateY(-100%)",
        "transition:transform .3s ease",
      ].join(";");

  const messageByReason = {
    install: `치즈 플래터(v${version})가 설치되었습니다. 정상적인 사용을 위해 페이지를 새로고침해 주세요.`,
    update: `치즈 플래터가 v${version}으로 업데이트되었습니다. 정상적인 사용을 위해 페이지를 새로고침해 주세요.`,
    "master-enabled":
      "치즈 플래터 사용을 켰습니다. 이 페이지에 기능을 적용하려면 새로고침해 주세요.",
    "master-disabled":
      "치즈 플래터 사용을 중지했습니다. 이 페이지에서 기존 기능을 정리하려면 새로고침해 주세요.",
    "settings-import":
      "치즈 플래터 설정을 불러왔습니다. 이 페이지에 새 설정을 적용하려면 새로고침해 주세요.",
  };
  const message =
    messageByReason[reason] ||
    "치즈 플래터 설정이 변경되었습니다. 이 페이지에 적용하려면 새로고침해 주세요.";
  const closeLabel =
    reason === "install"
      ? "설치 안내 닫기"
      : reason === "update"
        ? "업데이트 안내 닫기"
        : "설정 변경 안내 닫기";

  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:${isToast ? "flex-start" : "center"};gap:10px 12px;flex-wrap:${isToast ? "nowrap" : "wrap"}">
      <span style="${isToast ? "flex:1;min-width:0" : ""}">${message}</span>
      <button type="button" data-cheese-search-update-refresh style="border:0;border-radius:5px;padding:5px 10px;background:#fff;color:#087b2b;font-size:13px;font-weight:700;line-height:18px;cursor:pointer">새로고침</button>
      <button type="button" data-cheese-search-update-close aria-label="${closeLabel}" style="display:inline-flex;align-items:center;justify-content:center;border:0;padding:4px;background:transparent;color:#fff;line-height:1;cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
        </svg>
      </button>
    </div>
  `;

  const root = document.body || document.documentElement;
  root.appendChild(banner);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.style.transform = isToast
        ? toastVisibleTransform
        : "translateY(0)";
      if (isToast) banner.style.opacity = "1";
    });
  });

  const refreshButton = banner.querySelector(
    "[data-cheese-search-update-refresh]",
  );
  const closeButton = banner.querySelector("[data-cheese-search-update-close]");
  let dismissTimer = 0;

  function clearDismissTimer() {
    if (!dismissTimer) return;
    clearTimeout(dismissTimer);
    dismissTimer = 0;
  }

  function dismiss() {
    clearDismissTimer();
    if (!banner.isConnected) return;
    if (isToast) {
      banner.style.opacity = "0";
      banner.style.transform = toastHiddenTransform;
    } else {
      banner.style.transform = "translateY(-100%)";
    }
    setTimeout(() => banner.remove(), 300);
  }

  function scheduleDismiss() {
    if (!isTransient || !banner.isConnected) return;
    clearDismissTimer();
    dismissTimer = setTimeout(dismiss, transientMs);
  }

  refreshButton.addEventListener("click", () => {
    clearDismissTimer();
    refreshButton.disabled = true;
    refreshButton.textContent = "새로고침 중...";
    location.reload();
  });

  closeButton.addEventListener("click", dismiss);

  if (isTransient) {
    banner.addEventListener("mouseenter", clearDismissTimer);
    banner.addEventListener("mouseleave", scheduleDismiss);
    banner.addEventListener("focusin", clearDismissTimer);
    banner.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!banner.contains(document.activeElement)) scheduleDismiss();
      }, 0);
    });
    scheduleDismiss();
  }
}

const cacheHydration = hydrateCachesFromStorage();

async function hydrateCachesFromStorage() {
  if (!persistentStorage) return;
  try {
    const all = await persistentStorage.get(null);
    const now = Date.now();
    const chunks = new Map();
    const expiredKeysToRemove = [];

    for (const [storageKey, entry] of Object.entries(all || {})) {
      if (!entry || typeof entry !== "object") continue;
      if (storageKey.startsWith(CHANNEL_SEARCH_STORAGE_PREFIX)) {
        channelSearchCache.set(
          storageKey.slice(CHANNEL_SEARCH_STORAGE_PREFIX.length),
          entry,
        );
        continue;
      }
      if (!storageKey.startsWith(CACHE_STORAGE_PREFIX)) continue;
      const rawKey = storageKey.slice(CACHE_STORAGE_PREFIX.length);
      const separatorIndex = rawKey.indexOf(CACHE_CHUNK_SEPARATOR);
      if (separatorIndex < 0) {
        const createdAt = Number(entry?.createdAt || 0);
        if (createdAt && now - createdAt >= CACHE_TTL_MS) {
          expiredKeysToRemove.push(storageKey);
          continue;
        }
        cache.set(rawKey, entry);
        continue;
      }
      const baseKey = rawKey.slice(0, separatorIndex);
      const chunkIndex = Number(
        rawKey.slice(separatorIndex + CACHE_CHUNK_SEPARATOR.length),
      );
      if (!chunks.has(baseKey)) chunks.set(baseKey, []);
      chunks.get(baseKey).push({ chunkIndex, entry, storageKey });
    }

    for (const [baseKey, parts] of chunks.entries()) {
      const meta = cache.get(baseKey);
      const chunkStorageKeys = parts.map((p) => p.storageKey);
      if (!meta?.value || !Number.isInteger(meta.value.__chunkCount)) {
        expiredKeysToRemove.push(...chunkStorageKeys);
        continue;
      }
      parts.sort((a, b) => a.chunkIndex - b.chunkIndex);
      if (parts.length !== meta.value.__chunkCount) {
        cache.delete(baseKey);
        expiredKeysToRemove.push(
          `${CACHE_STORAGE_PREFIX}${baseKey}`,
          ...chunkStorageKeys,
        );
        continue;
      }
      const field = meta.value.__chunkField || "clips";
      const merged = [];
      for (const part of parts) {
        const chunk = part.entry?.value?.[field];
        if (Array.isArray(chunk)) merged.push(...chunk);
      }
      const { __chunkCount: _c, __chunkField: _f, ...rest } = meta.value;
      cache.set(baseKey, {
        ...meta,
        value: { ...rest, [field]: merged },
      });
    }

    if (expiredKeysToRemove.length) {
      try {
        await persistentStorage.remove(expiredKeysToRemove);
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.warn("[CheeseSearch] cache hydration failed", error);
  }
}

async function readCache(key) {
  const hit = cache.get(key);
  if (hit) return hit;
  await cacheHydration;
  return cache.get(key) || null;
}

const CLIP_PERSIST_FIELDS = [
  "clipUID",
  "clipTitle",
  "clipCategory",
  "clipCategoryValue",
  "categoryValue",
  "categoryType",
  "ownerChannelId",
  "thumbnailImageUrl",
  "readCount",
  "duration",
  "publishDateAt",
  "publishDate",
  "createdDate",
  "commentCount",
  "commentCountFetchedAt",
  "likeCount",
  "likeCountFetchedAt",
  "deletedAt",
  "missingCount",
];

const VIDEO_PERSIST_FIELDS = [
  "videoNo",
  "videoTitle",
  "videoCategory",
  "videoCategoryValue",
  "categoryType",
  "thumbnailImageUrl",
  "duration",
  "readCount",
  "viewCount",
  "commentCount",
  "commentCountFetchedAt",
  "livePv",
  "publishDateAt",
  "publishDate",
  "videoType",
  "adult",
  "tags",
  "watchTimeline",
];

function pickFields(item, fields) {
  if (!item || typeof item !== "object") return item;
  const result = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function slimEntryForPersist(entry) {
  if (!entry?.value) return entry;
  const value = entry.value;
  const slimValue = { ...value };
  if (Array.isArray(value.clips)) {
    slimValue.clips = value.clips.map((clip) =>
      pickFields(clip, CLIP_PERSIST_FIELDS),
    );
  }
  if (Array.isArray(value.allClips)) {
    slimValue.allClips = value.allClips.map((clip) =>
      pickFields(clip, CLIP_PERSIST_FIELDS),
    );
  }
  if (Array.isArray(value.videos)) {
    slimValue.videos = value.videos.map((video) => {
      const slim = pickFields(video, VIDEO_PERSIST_FIELDS);
      const channelObj = video?.channel;
      const channelMeta = channelObj?.channelName
        ? {
            channelId: channelObj.channelId,
            channelName: channelObj.channelName,
            channelImageUrl: channelObj.channelImageUrl,
            verifiedMark: channelObj.verifiedMark,
          }
        : null;
      if (channelMeta) slim.channel = channelMeta;
      return slim;
    });
  }
  return { ...entry, value: slimValue };
}

async function writeCache(key, entry) {
  cache.set(key, entry);
  if (!persistentStorage) return;
  await persistCacheEntry(key, entry);
}

async function persistCacheEntry(key, entry) {
  if (!persistentStorage) return;
  const slimEntry = slimEntryForPersist(entry);

  await removeChunkedStorageEntries(key);
  const writePlan = buildPersistWritePlan(key, slimEntry);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeStoragePlan(writePlan);
      return;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (!/quota/i.test(message)) {
        console.warn("[CheeseSearch] cache persist failed", error);
        await removeChunkedStorageEntries(key);
        return;
      }
      const evicted = await evictOldestCacheEntry(key);
      if (!evicted) {
        console.info(
          "[CheeseSearch] storage quota exhausted — keeping cache in memory only",
        );
        await removeChunkedStorageEntries(key);
        try {
          await persistentStorage.remove(`${CACHE_STORAGE_PREFIX}${key}`);
        } catch {
          // ignore
        }
        return;
      }
    }
  }
}

function buildPersistWritePlan(key, slimEntry) {
  const baseStorageKey = `${CACHE_STORAGE_PREFIX}${key}`;
  const value = slimEntry?.value;
  if (!value) return [{ [baseStorageKey]: slimEntry }];

  const chunkField = Array.isArray(value.clips)
    ? "clips"
    : Array.isArray(value.videos)
      ? "videos"
      : null;
  const list = chunkField ? value[chunkField] : null;
  if (!chunkField || !list || list.length <= CACHE_CHUNK_SIZE) {
    return [{ [baseStorageKey]: slimEntry }];
  }

  const chunks = [];
  for (let i = 0; i < list.length; i += CACHE_CHUNK_SIZE) {
    chunks.push(list.slice(i, i + CACHE_CHUNK_SIZE));
  }
  const { allClips: _allClips, ...metaValueRest } = value;
  const metaValue = {
    ...metaValueRest,
    [chunkField]: [],
    __chunkCount: chunks.length,
    __chunkField: chunkField,
  };
  const writes = [{ [baseStorageKey]: { ...slimEntry, value: metaValue } }];
  chunks.forEach((chunk, index) => {
    const chunkKey = `${baseStorageKey}${CACHE_CHUNK_SEPARATOR}${index}`;
    writes.push({
      [chunkKey]: {
        createdAt: slimEntry.createdAt,
        value: { [chunkField]: chunk },
      },
    });
  });
  return writes;
}

async function writeStoragePlan(writes) {
  for (const write of writes) {
    await persistentStorage.set(write);
  }
}

async function removeChunkedStorageEntries(key) {
  if (!persistentStorage) return;
  const baseStorageKey = `${CACHE_STORAGE_PREFIX}${key}`;
  const prefix = `${baseStorageKey}${CACHE_CHUNK_SEPARATOR}`;
  let all;
  try {
    all = await persistentStorage.get(null);
  } catch {
    return;
  }
  const toRemove = Object.keys(all || {}).filter((storageKey) =>
    storageKey.startsWith(prefix),
  );
  if (!toRemove.length) return;
  try {
    await persistentStorage.remove(toRemove);
  } catch {
    // ignore
  }
}

async function evictOldestCacheEntry(skipKey) {
  if (!persistentStorage) return false;
  let all;
  try {
    all = await persistentStorage.get(null);
  } catch {
    return false;
  }
  let oldestBaseKey = null;
  let oldestCreatedAt = Infinity;
  for (const [storageKey, entry] of Object.entries(all || {})) {
    if (!storageKey.startsWith(CACHE_STORAGE_PREFIX)) continue;
    const rawKey = storageKey.slice(CACHE_STORAGE_PREFIX.length);
    const separatorIndex = rawKey.indexOf(CACHE_CHUNK_SEPARATOR);
    if (separatorIndex >= 0) continue;
    if (rawKey === skipKey) continue;
    const createdAt = Number(entry?.createdAt || 0);
    if (createdAt < oldestCreatedAt) {
      oldestCreatedAt = createdAt;
      oldestBaseKey = rawKey;
    }
  }
  if (!oldestBaseKey) return false;
  const baseStorageKey = `${CACHE_STORAGE_PREFIX}${oldestBaseKey}`;
  const chunkPrefix = `${baseStorageKey}${CACHE_CHUNK_SEPARATOR}`;
  const toRemove = [baseStorageKey];
  for (const storageKey of Object.keys(all)) {
    if (storageKey.startsWith(chunkPrefix)) toRemove.push(storageKey);
  }
  try {
    await persistentStorage.remove(toRemove);
    cache.delete(oldestBaseKey);
    return true;
  } catch {
    return false;
  }
}

async function readChannelSearchCache(key) {
  const hit = channelSearchCache.get(key);
  if (hit) return hit;
  await cacheHydration;
  return channelSearchCache.get(key) || null;
}

function writeChannelSearchCache(key, value) {
  channelSearchCache.set(key, value);
  if (!persistentStorage) return;
  persistentStorage
    .set({ [`${CHANNEL_SEARCH_STORAGE_PREFIX}${key}`]: value })
    .catch((error) => {
      console.warn("[CheeseSearch] channel cache persist failed", error);
    });
}

function cacheKey({ channelId, videoType = "", sortType = "LATEST" }) {
  return `${channelId}:${videoType}:${sortType}`;
}

function clipCacheKey({ channelId, filterType = "ALL", orderType = "RECENT" }) {
  return `clips:${channelId}:${filterType}:${orderType}`;
}

function inFlightKey(request) {
  const metricSort = getSortMetricType(request.sort);
  const metricSuffix = metricSort ? `:${metricSort}` : "";
  if (request.contentType === "clips") {
    return `${clipCacheKey(request)}${metricSuffix}:${request.forceRefresh ? "force" : "normal"}`;
  }
  return `videos:${cacheKey(request)}${metricSuffix}:${request.forceRefresh ? "force" : "normal"}`;
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeChannelName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function createAbortError() {
  const error = new Error("검색이 중지되었습니다.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function fetchVideoPage(request) {
  let lastError = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(request.signal);
      return await fetchVideoPageOnce(request);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt >= FETCH_RETRY_DELAYS_MS.length) break;
      await sleep(FETCH_RETRY_DELAYS_MS[attempt], request.signal);
    }
  }

  throw lastError;
}

async function fetchVideoPageOnce({
  channelId,
  page,
  videoType = "",
  sortType = "LATEST",
  signal,
}) {
  const url = new URL(`${API_BASE}/${channelId}/videos`);
  url.searchParams.set("sortType", sortType);
  url.searchParams.set("pagingType", "PAGE");
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("publishDateAt", "");
  url.searchParams.set("videoType", videoType);

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`CHZZK API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.code !== 200 || !payload.content) {
    throw new Error(payload.message || "CHZZK API 응답을 읽을 수 없습니다.");
  }

  return payload.content;
}

async function fetchClipPage(request) {
  let lastError = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(request.signal);
      return await fetchClipPageOnce(request);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt >= FETCH_RETRY_DELAYS_MS.length) break;
      await sleep(FETCH_RETRY_DELAYS_MS[attempt], request.signal);
    }
  }

  throw lastError;
}

async function fetchClipPageOnce({
  channelId,
  cursor = {},
  filterType = "ALL",
  orderType = "RECENT",
  signal,
}) {
  const url = new URL(`${API_BASE}/${channelId}/clips`);
  url.searchParams.set("clipUID", String(cursor.clipUID || ""));
  url.searchParams.set("filterType", normalizeClipFilterType(filterType));
  url.searchParams.set("orderType", normalizeClipOrderType(orderType));
  url.searchParams.set("size", String(CLIP_PAGE_SIZE));
  url.searchParams.set("readCount", String(cursor.readCount ?? ""));

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`CHZZK 클립 API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) {
    throw new Error(
      payload?.message || "CHZZK 클립 API 응답을 읽을 수 없습니다.",
    );
  }

  return payload.content;
}

async function fetchMakeClipPage({
  channelId,
  page,
  dateFilter = "ALL",
  orderFilter = "LATEST",
  signal,
}) {
  const url = new URL(
    `${MANAGE_API_BASE}/channels/${encodeURIComponent(channelId)}/clips/make-clips`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(MAKE_CLIP_PAGE_SIZE));
  url.searchParams.set("dateFilter", normalizeMakeClipDateFilter(dateFilter));
  url.searchParams.set(
    "orderFilter",
    normalizeMakeClipOrderFilter(orderFilter),
  );

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(
      `CHZZK 내가 만든 클립 API 요청 실패: HTTP ${response.status}`,
    );
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) {
    throw new Error(
      payload?.message || "CHZZK 내가 만든 클립 응답을 읽을 수 없습니다.",
    );
  }
  return payload.content;
}

async function deleteMakeClip({ channelId, clipUID }) {
  const normalizedChannelId = String(channelId || "").trim();
  const normalizedClipUID = String(clipUID || "").trim();
  if (!normalizedChannelId) throw new Error("채널 ID를 확인할 수 없습니다.");
  if (!normalizedClipUID) throw new Error("클립 ID를 확인할 수 없습니다.");

  const response = await fetch(
    `${MANAGE_API_BASE}/channels/${encodeURIComponent(normalizedChannelId)}/clips/${encodeURIComponent(normalizedClipUID)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`CHZZK 클립 삭제 요청 실패: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (text) {
    const payload = JSON.parse(text);
    if (Number(payload?.code) !== 200) {
      throw new Error(
        payload?.message || "CHZZK 클립 삭제 응답을 읽을 수 없습니다.",
      );
    }
  }

  return { channelId: normalizedChannelId, clipUID: normalizedClipUID };
}

async function fetchAllMakeClips(request) {
  const channelId = String(request?.channelId || "").trim();
  if (!channelId) throw new Error("채널 ID를 확인할 수 없습니다.");

  const firstPage = await fetchMakeClipPage({
    ...request,
    channelId,
    page: 0,
  });
  const totalPages = Math.max(1, Number(firstPage.totalPages || 1));
  const firstData = Array.isArray(firstPage.data) ? firstPage.data : [];
  const pageNumbers = Array.from(
    { length: Math.max(0, totalPages - 1) },
    (_, index) => index + 1,
  );
  const pages = await mapWithConcurrency(
    pageNumbers,
    MAX_CONCURRENT_PAGE_REQUESTS,
    (page) => fetchMakeClipPage({ ...request, channelId, page }),
  );
  const clips = firstData.concat(
    pages.flatMap((page) => (Array.isArray(page.data) ? page.data : [])),
  );

  return {
    channelId,
    contentType: "makeClips",
    totalCount: Number(firstPage.totalCount || clips.length),
    totalPages,
    fetchedAt: Date.now(),
    clips,
  };
}

function hasResolvedClipCategoryValue(clip) {
  const categoryValue = String(
    clip?.clipCategoryValue || clip?.categoryValue || "",
  ).trim();
  const categoryId = String(clip?.clipCategory || "").trim();
  return Boolean(
    categoryValue && (!categoryId || categoryValue !== categoryId),
  );
}

async function enrichClipsWithCategoryValues(clips, signal) {
  if (!Array.isArray(clips) || !clips.length) return [];

  const uniqueCategoryKeys = new Set();
  clips.forEach((clip) => {
    if (hasResolvedClipCategoryValue(clip)) return;
    const key = getClipCategoryKey(clip);
    if (key && !categoryInfoCache.has(key)) uniqueCategoryKeys.add(key);
  });

  for (const key of uniqueCategoryKeys) {
    try {
      await fetchCategoryInfoByKey(key, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }

  return clips.map((clip) => {
    if (hasResolvedClipCategoryValue(clip)) return clip;
    const key = getClipCategoryKey(clip);
    const categoryInfo = key ? categoryInfoCache.get(key) : null;
    const categoryValue = String(categoryInfo?.categoryValue || "").trim();
    if (!categoryValue) return clip;
    return {
      ...clip,
      clipCategoryValue: categoryValue,
      categoryValue,
    };
  });
}

async function enrichClipCategoryDescriptors(descriptors) {
  const unique = new Map();
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    const categoryType = String(descriptor?.categoryType || "").trim();
    const clipCategory = String(descriptor?.clipCategory || "").trim();
    if (!categoryType || !clipCategory) continue;
    const key = `${categoryType}:${clipCategory}`;
    if (!unique.has(key)) {
      unique.set(key, { categoryType, clipCategory });
    }
    if (unique.size >= 500) break;
  }
  const enriched = await enrichClipsWithCategoryValues([...unique.values()]);
  return enriched
    .map((clip) => {
      const categoryValue = String(
        clip?.clipCategoryValue || clip?.categoryValue || "",
      ).trim();
      if (!categoryValue) return null;
      return {
        categoryType: String(clip.categoryType || "").trim(),
        clipCategory: String(clip.clipCategory || "").trim(),
        categoryValue,
      };
    })
    .filter(Boolean);
}

function extractCreatorHubClipTags(description) {
  const tags = [];
  const seen = new Set();
  for (const match of String(description || "").matchAll(
    /#([\p{L}\p{N}_]+)/gu,
  )) {
    const tag = String(match[1] || "").trim();
    const key = tag.toLocaleLowerCase("ko-KR");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function setClipTagCache(key, value, ttlMs) {
  if (clipTagCache.has(key)) clipTagCache.delete(key);
  clipTagCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  while (clipTagCache.size > CLIP_TAG_CACHE_MAX) {
    const oldestKey = clipTagCache.keys().next().value;
    if (oldestKey === undefined) break;
    clipTagCache.delete(oldestKey);
  }
}

async function fetchCreatorHubClipTags(descriptor) {
  const clipUID = String(descriptor?.clipUID || "").trim();
  const videoId = String(descriptor?.videoId || "").trim();
  if (!clipUID || !videoId) return null;
  const cacheKey = `${clipUID}:${videoId}`;
  const cached = clipTagCache.get(cacheKey);
  if (cached && Number(cached.expiresAt || 0) > Date.now()) {
    return cached.value;
  }
  if (cached) clipTagCache.delete(cacheKey);

  const inFlight = clipTagInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const url = new URL(`${CREATORHUB_API_BASE}/clipviewer/card`);
    url.searchParams.set("userInteraction", "false");
    url.searchParams.set("seedType", "SPECIFIC");
    url.searchParams.set("serviceType", "CHZZK");
    url.searchParams.set("seedMediaId", videoId);
    url.searchParams.set("mediaType", "SHORT_FORM");
    url.searchParams.set("panelType", "sdk_chzzk");
    url.searchParams.set(
      "referer",
      `https://chzzk.naver.com/clips/${encodeURIComponent(clipUID)}`,
    );
    url.searchParams.set("recType", "CHZZK");
    url.searchParams.set(
      "recId",
      JSON.stringify({
        seedClipUID: clipUID,
        fromType: "GLOBAL",
        listType: "RECOMMEND",
      }),
    );
    url.searchParams.set("enableReverse", "false");
    url.searchParams.set("adAllowed", "false");
    url.searchParams.set("clickNsc", "chzzk_url_clip");
    url.searchParams.set("clickArea", "clip_item");
    url.searchParams.set("deviceType", "html5_mo");
    url.searchParams.set("profileOverride", "false");

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CLIP_TAG_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
        signal: controller.signal,
        headers: { accept: "application/json, text/plain, */*" },
      });
      if (!response.ok) {
        throw new Error(`클립 태그 API 요청 실패: HTTP ${response.status}`);
      }
      const payload = await response.json();
      const content = payload?.body?.card?.content;
      if (
        Number(payload?.header?.code) !== 0 ||
        String(content?.contentId || "").trim() !== clipUID
      ) {
        throw new Error("클립 태그 API 응답을 확인할 수 없습니다.");
      }
      const value = {
        clipUID,
        tags: extractCreatorHubClipTags(content.description),
        resolved: true,
      };
      setClipTagCache(cacheKey, value, CLIP_TAG_CACHE_TTL_MS);
      return value;
    } catch {
      setClipTagCache(cacheKey, null, CLIP_TAG_FAILURE_CACHE_TTL_MS);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  })().finally(() => {
    clipTagInFlight.delete(cacheKey);
  });
  clipTagInFlight.set(cacheKey, promise);
  return promise;
}

async function enrichClipTagDescriptors(descriptors) {
  const unique = new Map();
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    const clipUID = String(descriptor?.clipUID || "").trim();
    const videoId = String(descriptor?.videoId || "").trim();
    if (!clipUID || !videoId || unique.has(clipUID)) continue;
    unique.set(clipUID, { clipUID, videoId });
    if (unique.size >= CLIP_TAG_ENRICH_LIMIT) break;
  }
  if (!unique.size) return [];
  const results = await mapWithConcurrency(
    [...unique.values()],
    CLIP_TAG_FETCH_CONCURRENCY,
    fetchCreatorHubClipTags,
  );
  return results.filter(Boolean);
}

function getClipCategoryKey(clip) {
  const categoryType = String(clip?.categoryType || "").trim();
  const categoryId = String(clip?.clipCategory || "").trim();
  if (!categoryType || !categoryId) return "";
  return `${categoryType}:${categoryId}`;
}

async function fetchCategoryInfoByKey(key, signal) {
  const cached = categoryInfoCache.get(key);
  if (cached !== undefined) return cached;

  const inFlight = categoryInfoInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = fetchCategoryInfo(key, signal)
    .then((info) => {
      categoryInfoCache.set(key, info);
      return info;
    })
    .catch((error) => {
      if (isAbortError(error)) throw error;
      categoryInfoCache.set(key, null);
      return null;
    })
    .finally(() => {
      categoryInfoInFlight.delete(key);
    });
  categoryInfoInFlight.set(key, promise);
  return promise;
}

async function fetchCategoryInfo(key, signal) {
  const [categoryType, categoryId] = String(key || "").split(":");
  if (!categoryType || !categoryId) return null;

  throwIfAborted(signal);
  const url = new URL(
    `${SERVICE_API_BASE}/categories/${encodeURIComponent(categoryType)}/${encodeURIComponent(categoryId)}/info`,
  );
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) return null;

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) return null;
  return payload.content;
}

async function fetchCommentTimestamps(videoNo) {
  const normalizedVideoNo = String(videoNo || "").trim();
  if (!/^\d+$/.test(normalizedVideoNo)) {
    throw new Error("동영상 번호를 확인할 수 없습니다.");
  }

  const cached = commentTimestampCache.get(normalizedVideoNo);
  if (
    cached &&
    cached.version === COMMENT_TIMESTAMP_CACHE_VERSION &&
    Date.now() - Number(cached.createdAt || 0) < COMMENT_TIMESTAMP_CACHE_TTL_MS
  ) {
    return cached.value;
  }

  const entries = [];
  let totalCount = 0;
  for (let page = 0; page < COMMENT_TIMESTAMP_MAX_PAGES; page += 1) {
    const offset = page * COMMENT_TIMESTAMP_PAGE_SIZE;
    const content = await fetchCommentPage(normalizedVideoNo, offset);
    if (!content) break;

    if (page === 0) {
      entries.push(...collectCommentEntries(content.bestComments, "best"));
    }
    entries.push(...collectCommentEntries(content.comments?.data, "comment"));
    totalCount = Number(content.comments?.totalCount || totalCount || 0);

    const fetchedCount = offset + COMMENT_TIMESTAMP_PAGE_SIZE;
    const hasNextPage =
      Array.isArray(content.comments?.data) &&
      content.comments.data.length >= COMMENT_TIMESTAMP_PAGE_SIZE &&
      (!totalCount || fetchedCount < totalCount);
    if (!hasNextPage) break;
  }

  const markers = buildTimestampMarkers(entries);
  const value = {
    videoNo: normalizedVideoNo,
    markers,
    scannedCommentCount: entries.length,
    fetchedAt: Date.now(),
  };
  commentTimestampCache.set(normalizedVideoNo, {
    createdAt: Date.now(),
    version: COMMENT_TIMESTAMP_CACHE_VERSION,
    value,
  });
  return value;
}

async function fetchCommentPage(videoNo, offset) {
  const url = new URL(
    `${COMMENT_API_BASE}/type/STREAMING_VIDEO/id/${encodeURIComponent(videoNo)}/comments`,
  );
  url.searchParams.set("limit", String(COMMENT_TIMESTAMP_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("orderType", "POPULAR");
  url.searchParams.set("pagingType", "PAGE");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`댓글 API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) {
    throw new Error(payload?.message || "댓글 API 응답을 읽을 수 없습니다.");
  }
  return payload.content;
}

function getSortMetricType(sort) {
  if (sort === "comments") return "comments";
  if (sort === "likes") return "likes";
  return "";
}

function hasOwnMetric(item, field) {
  return Object.prototype.hasOwnProperty.call(item || {}, field);
}

function hasMetricForEveryItem(items, field) {
  return (Array.isArray(items) ? items : []).every((item) =>
    hasOwnMetric(item, field),
  );
}

async function enrichVideosWithSortMetrics(videos, sort, signal) {
  if (getSortMetricType(sort) !== "comments") return videos;
  if (!Array.isArray(videos) || !videos.length) return [];

  return mapWithConcurrency(videos, SORT_METRIC_CONCURRENCY, async (video) => {
    throwIfAborted(signal);
    if (hasOwnMetric(video, "commentCount") && video?.commentCountFetchedAt) {
      return video;
    }
    const videoNo = String(video?.videoNo || "").trim();
    if (!videoNo) {
      return {
        ...video,
        commentCount: 0,
        commentCountFetchedAt: Date.now(),
      };
    }
    try {
      const commentCount = await fetchVideoCommentCount(videoNo, signal);
      return {
        ...video,
        commentCount,
        commentCountFetchedAt: Date.now(),
      };
    } catch {
      return {
        ...video,
        commentCount: 0,
        commentCountFetchedAt: Date.now(),
      };
    }
  });
}

async function fetchVideoCommentCount(videoNo, signal) {
  const cacheKey = String(videoNo || "").trim();
  const cached = videoCommentCountCache.get(cacheKey);
  if (
    cached &&
    Date.now() - Number(cached.createdAt || 0) < SORT_METRIC_CACHE_TTL_MS
  ) {
    return Number(cached.value || 0);
  }

  const url = new URL(
    `${COMMENT_API_BASE}/type/STREAMING_VIDEO/id/${encodeURIComponent(cacheKey)}/comments`,
  );
  url.searchParams.set("limit", "30");
  url.searchParams.set("offset", "0");
  url.searchParams.set("orderType", "POPULAR");
  url.searchParams.set("pagingType", "PAGE");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`댓글 API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) {
    throw new Error(payload?.message || "댓글 API 응답을 읽을 수 없습니다.");
  }

  const comments = payload.content.comments || {};
  const count = Number(comments.totalCount ?? comments.commentCount ?? 0);
  const value = Number.isFinite(count) ? count : 0;
  videoCommentCountCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

async function enrichClipsWithSortMetrics(clips, sort, signal) {
  return enrichClipsWithSortMetricsAndReport(clips, sort, signal);
}

function createClipLikeFetchState() {
  return { reactionFailureCount: 0, reactionDisabled: false };
}

async function enrichClipWithLikeCount(clip, signal, state) {
  throwIfAborted(signal);
  if (hasOwnMetric(clip, "likeCount") && clip?.likeCountFetchedAt) {
    return clip;
  }

  const clipUID = String(clip?.clipUID || "").trim();
  if (!clipUID || state.reactionDisabled) {
    return { ...clip, likeCount: 0, likeCountFetchedAt: Date.now() };
  }

  try {
    const likeCount = await fetchClipLikeCount(clip, signal);
    return { ...clip, likeCount, likeCountFetchedAt: Date.now() };
  } catch {
    if (signal?.aborted) throw createAbortError();
    state.reactionFailureCount += 1;
    if (state.reactionFailureCount >= CLIP_REACTION_FAILURE_LIMIT) {
      state.reactionDisabled = true;
    }
    return { ...clip, likeCount: 0, likeCountFetchedAt: Date.now() };
  }
}

async function enrichClipsWithSortMetricsAndReport(
  clips,
  sort,
  signal,
  onMetricClip,
) {
  if (getSortMetricType(sort) !== "likes") return clips;
  if (!Array.isArray(clips) || !clips.length) return [];

  const state = createClipLikeFetchState();

  return mapWithConcurrency(clips, SORT_METRIC_CONCURRENCY, async (clip) => {
    const enrichedClip = await enrichClipWithLikeCount(clip, signal, state);
    onMetricClip?.(enrichedClip);
    return enrichedClip;
  });
}

/**
 * 페이지 수집과 좋아요 수 조회를 겹쳐 처리하기 위한 스트리밍 풀.
 * 페이지가 도착하는 즉시 push로 클립을 넣으면, 전역 동시성 한도 내에서
 * 좋아요 조회를 곧바로 시작한다. drain()으로 모든 조회 완료를 기다린다.
 */
function createClipLikePipeline(signal, onMetricClip) {
  const state = createClipLikeFetchState();
  const enrichedByUID = new Map();
  const pending = new Set();
  let activeCount = 0;
  let pipelineError = null;
  const waiters = [];

  function releaseWaiters() {
    while (waiters.length) waiters.shift()();
  }

  function run(clip) {
    activeCount += 1;
    const task = (async () => {
      const enrichedClip = await enrichClipWithLikeCount(clip, signal, state);
      const uid = String(enrichedClip?.clipUID || "").trim();
      if (uid) enrichedByUID.set(uid, enrichedClip);
      onMetricClip?.(enrichedClip);
    })()
      .catch((error) => {
        pipelineError = pipelineError || error;
      })
      .finally(() => {
        activeCount -= 1;
        pending.delete(task);
        releaseWaiters();
      });
    pending.add(task);
  }

  async function push(clips) {
    if (!Array.isArray(clips)) return;
    for (const clip of clips) {
      if (pipelineError) return;
      while (activeCount >= SORT_METRIC_CONCURRENCY && !pipelineError) {
        await new Promise((resolve) => waiters.push(resolve));
      }
      if (pipelineError) return;
      run(clip);
    }
  }

  async function drain() {
    while (pending.size) {
      await Promise.race(pending);
    }
    if (pipelineError) throw pipelineError;
  }

  return { push, drain, enrichedByUID };
}

function applyLikePipelineResults(clips, enrichedByUID) {
  if (!Array.isArray(clips)) return clips;
  return clips.map((clip) => {
    const uid = String(clip?.clipUID || "").trim();
    const enriched = uid ? enrichedByUID.get(uid) : null;
    return enriched || clip;
  });
}

function handleMakeClipDeleteCompleted(details) {
  if (details.method !== "DELETE") return;
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;
  if (
    Number(details.statusCode || 0) < 200 ||
    Number(details.statusCode || 0) >= 300
  ) {
    return;
  }

  const parsed = parseMakeClipDeleteUrl(details.url);
  if (!parsed) return;

  chrome.tabs.sendMessage(
    details.tabId,
    {
      type: "CHEESE_SEARCH_STUDIO_MAKE_CLIP_DELETED",
      payload: parsed,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
}

function parseMakeClipDeleteUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== "https://api.chzzk.naver.com") return null;
    const match = parsedUrl.pathname.match(
      /^\/manage\/v1\/channels\/([^/]+)\/clips\/([^/]+)$/i,
    );
    if (!match) return null;
    return {
      channelId: decodeURIComponent(match[1]),
      clipUID: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

async function fetchClipLikeCount(clip, signal) {
  const reaction = await fetchClipLikeReaction(clip, signal);
  return reaction.count;
}

async function fetchClipLikeReaction(clip, signal) {
  const clipUID = String(clip?.clipUID || "").trim();
  if (!clipUID) return { count: 0, isReacted: false, isLogin: null };

  // 좋아요 카운트만 주는 경량 엔드포인트. clipviewer/card는 VOD 매니페스트까지
  // 통째로 내려줘 요청당 페이로드가 수 KB였으나, 이 API는 수백 바이트뿐이다.
  const url = new URL(
    `${CLIP_LIKE_API_BASE}/${encodeURIComponent(`clip_${clipUID}`)}`,
  );
  url.searchParams.set("reactionType", "like");
  url.searchParams.set("categoryId", "clip");
  url.searchParams.set("displayId", "VIEWER_SHORTFORM");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "GET",
      credentials: "include",
      signal,
      headers: {
        accept: "application/json, text/plain, */*",
      },
    },
    CLIP_REACTION_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`클립 반응 API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return extractClipLikeReaction(payload);
}

function extractClipLikeReaction(payload) {
  const visited = new Set();
  const stack = [payload];
  let inspected = 0;
  let isLogin = null;

  while (stack.length && inspected < 500) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    inspected += 1;
    if (typeof value.isLogin === "boolean") isLogin = value.isLogin;

    const reactions = value.reactions;
    if (Array.isArray(reactions)) {
      const likeReaction =
        reactions.find((item) => item?.reactionType === "like") ?? reactions[0];
      const reactionsCount = Number(
        likeReaction?.count ?? likeReaction?.reactionCount,
      );
      if (likeReaction) {
        return {
          count: Number.isFinite(reactionsCount) ? reactionsCount : 0,
          isReacted: likeReaction.isReacted === true,
          isLogin,
        };
      }
    }

    const reaction = value.reaction;
    if (reaction && typeof reaction === "object") {
      const reactionCount = Number(reaction.count ?? reaction.reactionCount);
      if (Number.isFinite(reactionCount)) {
        return {
          count: reactionCount,
          isReacted: reaction.isReacted === true,
          isLogin,
        };
      }
    }

    const directCount = Number(value.reactionCount ?? value.likeCount);
    if (Number.isFinite(directCount)) {
      return {
        count: directCount,
        isReacted: value.isReacted === true,
        isLogin,
      };
    }

    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") stack.push(child);
    });
  }

  return { count: 0, isReacted: false, isLogin };
}

function extractClipLikeCount(payload) {
  return extractClipLikeReaction(payload).count;
}

let clipVaultFollowingChannelsCache = null;
async function fetchClipVaultFollowingChannels() {
  const now = Date.now();
  if (
    clipVaultFollowingChannelsCache?.channels?.length &&
    now - clipVaultFollowingChannelsCache.at <
      CLIP_VAULT_FOLLOWING_IMPORT_CHANNEL_CACHE_TTL_MS
  ) {
    return clipVaultFollowingChannelsCache.channels;
  }
  const pageSize = 505;
  const fetchPage = async (page) => {
    const url = new URL(
      "https://api.chzzk.naver.com/service/v1/channels/followings",
    );
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(pageSize));
    url.searchParams.set("sortType", "FOLLOW");
    const response = await fetchWithTimeout(
      url.toString(),
      {
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" },
      },
      CLIP_VAULT_FOLLOWING_IMPORT_FETCH_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`팔로잉 채널 요청 실패: HTTP ${response.status}`);
    }
    const payload = await response.json();
    return {
      list: Array.isArray(payload?.content?.followingList)
        ? payload.content.followingList
        : [],
      totalPage: Number(payload?.content?.totalPage),
    };
  };

  const first = await fetchPage(0);
  const totalPage = Number.isFinite(first.totalPage)
    ? Math.max(1, Math.floor(first.totalPage))
    : 1;
  const pages =
    totalPage > 1
      ? await mapWithConcurrency(
          Array.from({ length: totalPage - 1 }, (_, index) => index + 1),
          3,
          fetchPage,
        )
      : [];
  const seen = new Set();
  const channels = [first, ...pages]
    .flatMap((page) => page.list)
    .map((item) => {
      const channel = item?.channel || item;
      const channelId = String(
        channel?.channelId || item?.channelId || "",
      ).trim();
      if (!channelId || seen.has(channelId)) return null;
      seen.add(channelId);
      return {
        channelId,
        channelName: String(channel?.channelName || "").trim(),
      };
    })
    .filter(Boolean);
  clipVaultFollowingChannelsCache = { at: now, channels };
  return channels;
}

function normalizeClipVaultFollowingImportCursor(raw) {
  const clipUID = String(raw?.clipUID || "").trim();
  return clipUID
    ? { clipUID, readCount: raw?.readCount ?? "" }
    : { clipUID: "", readCount: "" };
}

function clipVaultFollowingImportCursorKey(cursor) {
  return `${String(cursor?.clipUID || "").trim()}:${String(cursor?.readCount ?? "")}`;
}

function normalizeClipVaultFollowingClip(clip, channel) {
  const owner = clip?.ownerChannel || {};
  const playCount = Number(clip?.readCount ?? clip?.viewCount);
  return {
    uid: String(clip?.clipUID || "").trim(),
    title: String(clip?.clipTitle || clip?.contentTitle || "").trim(),
    thumb: String(clip?.thumbnailImageUrl || clip?.thumbnailUrl || "").trim(),
    channelName: String(
      owner?.channelName || clip?.ownerChannelName || channel.channelName,
    ).trim(),
    channelId: String(
      clip?.ownerChannelId || owner?.channelId || channel.channelId,
    ).trim(),
    videoId: String(clip?.videoId || "").trim(),
    adult:
      clip?.adult === true ||
      String(clip?.adult || "").toLowerCase() === "true",
    adultKnown: true,
    ...(Number.isFinite(playCount)
      ? {
          playCount: Math.max(0, Math.round(playCount)),
          playCountKnown: true,
          playCountFetchedAt: Date.now(),
        }
      : {}),
  };
}

async function fetchClipVaultFollowingChannelClipPageOnce(
  channel,
  cursor,
  signal,
) {
  const url = new URL(
    `https://api.chzzk.naver.com/service/v1/channels/${encodeURIComponent(channel.channelId)}/clips`,
  );
  url.searchParams.set("clipUID", String(cursor?.clipUID || ""));
  url.searchParams.set("filterType", "ALL");
  url.searchParams.set("orderType", "RECENT");
  url.searchParams.set("size", String(CLIP_PAGE_SIZE));
  url.searchParams.set("readCount", String(cursor?.readCount ?? ""));
  const response = await fetchWithTimeout(
    url.toString(),
    {
      credentials: "include",
      signal,
      headers: { accept: "application/json, text/plain, */*" },
    },
    CLIP_VAULT_FOLLOWING_IMPORT_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`채널 클립 요청 실패: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const clips = Array.isArray(payload?.content?.data)
    ? payload.content.data
    : [];
  const next = normalizeClipVaultFollowingImportCursor(
    payload?.content?.page?.next,
  );
  return {
    items: clips.map((clip) => normalizeClipVaultFollowingClip(clip, channel)),
    next: next.clipUID ? next : null,
  };
}

async function fetchClipVaultFollowingChannelClipPage(channel, cursor, signal) {
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(signal);
      return await fetchClipVaultFollowingChannelClipPageOnce(
        channel,
        cursor,
        signal,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt >= FETCH_RETRY_DELAYS_MS.length) break;
      await sleep(FETCH_RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError;
}

async function checkClipVaultFollowingLikeCandidates(
  rawItems,
  maxAttempts = 3,
  signal,
) {
  let pending = (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const uid = String(item?.uid || item?.clipUID || "").trim();
      return /^[\w-]{6,64}$/.test(uid) ? { ...item, uid } : null;
    })
    .filter(Boolean);
  const likedItems = [];
  let checkedCount = 0;
  let retryRequestCount = 0;
  let loginTrueCount = 0;
  let loginFalseCount = 0;
  const attempts = Math.max(1, Math.min(6, Math.floor(maxAttempts) || 1));

  for (let attempt = 0; attempt < attempts && pending.length; attempt += 1) {
    throwIfAborted(signal);
    if (attempt > 0) {
      retryRequestCount += pending.length;
      await sleep(
        FETCH_RETRY_DELAYS_MS[
          Math.min(attempt - 1, FETCH_RETRY_DELAYS_MS.length - 1)
        ],
        signal,
      );
    }
    const results = await mapWithConcurrency(
      pending,
      CLIP_VAULT_FOLLOWING_IMPORT_REACTION_CONCURRENCY,
      async (item) => {
        try {
          const reaction = await fetchClipLikeReaction(
            { clipUID: item.uid },
            signal,
          );
          return { item, reaction };
        } catch (error) {
          if (isAbortError(error)) throw error;
          return { item, reaction: null };
        }
      },
    );
    throwIfAborted(signal);
    const failed = [];
    for (const result of results) {
      if (!result.reaction) {
        failed.push(result.item);
        continue;
      }
      checkedCount += 1;
      if (result.reaction.isLogin === true) loginTrueCount += 1;
      if (result.reaction.isLogin === false) loginFalseCount += 1;
      if (!result.reaction.isReacted) continue;
      likedItems.push({
        ...result.item,
        likeCount: Math.max(0, Number(result.reaction.count) || 0),
        likeCountKnown: true,
        likeCountFetchedAt: Date.now(),
      });
    }
    pending = failed;
  }

  if (loginFalseCount > 0 && loginTrueCount === 0) {
    throw new Error(
      "치지직 로그인 상태를 확인할 수 없습니다. 로그인 후 다시 시도해 주세요.",
    );
  }
  return {
    items: likedItems,
    failedItems: pending,
    checkedCount,
    retryRequestCount,
  };
}

async function importClipVaultFollowingLikes(
  rawKnownUIDs,
  rawStartChannelIndex = 0,
  rawStartClipCursor = null,
  signal,
) {
  throwIfAborted(signal);
  const knownUIDs = new Set(
    (Array.isArray(rawKnownUIDs) ? rawKnownUIDs : [])
      .map((uid) => String(uid || "").trim())
      .filter((uid) => /^[\w-]{6,64}$/.test(uid))
      .slice(0, 100000),
  );
  const channels = await fetchClipVaultFollowingChannels();
  throwIfAborted(signal);
  if (!channels.length) {
    return {
      items: [],
      followedChannelCount: 0,
      scannedChannelCount: 0,
      startChannelIndex: 0,
      nextChannelIndex: 0,
      nextClipCursor: null,
      candidateCount: 0,
      checkedCount: 0,
      failedCount: 0,
      hasMoreChannels: false,
    };
  }

  const requestedStartIndex = Number(rawStartChannelIndex);
  const startIndex = Number.isFinite(requestedStartIndex)
    ? Math.min(channels.length, Math.max(0, Math.floor(requestedStartIndex)))
    : 0;
  let nextChannelIndex = startIndex;
  let nextClipCursor =
    normalizeClipVaultFollowingImportCursor(rawStartClipCursor);
  let scannedChannelCount = 0;
  let fetchedPageCount = 0;
  const candidates = [];
  const seenUIDs = new Set(knownUIDs);
  const requestedCursors = new Set();

  while (
    nextChannelIndex < channels.length &&
    scannedChannelCount < CLIP_VAULT_FOLLOWING_IMPORT_CHANNEL_BATCH &&
    fetchedPageCount < CLIP_VAULT_FOLLOWING_IMPORT_PAGE_BATCH_MAX &&
    candidates.length < CLIP_VAULT_FOLLOWING_IMPORT_CANDIDATE_MAX
  ) {
    throwIfAborted(signal);
    const channel = channels[nextChannelIndex];
    const positionKey = `${nextChannelIndex}:${clipVaultFollowingImportCursorKey(nextClipCursor)}`;
    if (requestedCursors.has(positionKey)) {
      throw new Error(
        `${channel.channelName || "팔로잉 채널"}의 클립 페이지 커서가 반복되었습니다.`,
      );
    }
    requestedCursors.add(positionKey);

    let page;
    try {
      page = await fetchClipVaultFollowingChannelClipPage(
        channel,
        nextClipCursor,
        signal,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(
        `${channel.channelName || "팔로잉 채널"}의 전체 클립을 불러오지 못했습니다: ${normalizeError(error)}`,
      );
    }
    fetchedPageCount += 1;
    for (const item of page.items) {
      if (!item.uid || seenUIDs.has(item.uid)) continue;
      seenUIDs.add(item.uid);
      candidates.push(item);
    }

    if (page.next) {
      const currentCursorKey =
        clipVaultFollowingImportCursorKey(nextClipCursor);
      const nextCursorKey = clipVaultFollowingImportCursorKey(page.next);
      if (nextCursorKey === currentCursorKey) {
        throw new Error(
          `${channel.channelName || "팔로잉 채널"}의 다음 클립 페이지를 확인하지 못했습니다.`,
        );
      } else {
        nextClipCursor = page.next;
      }
    } else {
      nextChannelIndex += 1;
      nextClipCursor = { clipUID: "", readCount: "" };
      scannedChannelCount += 1;
    }
  }
  const now = Date.now();
  const checked = await checkClipVaultFollowingLikeCandidates(
    candidates,
    3,
    signal,
  );
  return {
    items: checked.items.map((item, index) => ({
      ...item,
      at: now - index,
    })),
    failedItems: checked.failedItems,
    followedChannelCount: channels.length,
    scannedChannelCount,
    startChannelIndex: startIndex,
    nextChannelIndex,
    nextClipCursor: nextClipCursor.clipUID ? nextClipCursor : null,
    candidateCount: candidates.length,
    fetchedPageCount,
    checkedCount: checked.checkedCount,
    retryRequestCount: checked.retryRequestCount,
    failedCount: checked.failedItems.length,
    hasMoreChannels: nextChannelIndex < channels.length,
  };
}

async function retryClipVaultFollowingLikes(rawItems, signal) {
  const now = Date.now();
  const checked = await checkClipVaultFollowingLikeCandidates(
    rawItems,
    3,
    signal,
  );
  return {
    items: checked.items.map((item, index) => ({
      ...item,
      at: now - index,
    })),
    failedItems: checked.failedItems,
    checkedCount: checked.checkedCount,
    retryRequestCount: checked.retryRequestCount,
    failedCount: checked.failedItems.length,
  };
}

function normalizeClipVaultFollowingImportJobId(value) {
  const jobId = String(value || "").trim();
  return /^[\w:.-]{8,120}$/.test(jobId) ? jobId : "";
}

function runClipVaultFollowingImportJob(rawJobId, task) {
  const jobId =
    normalizeClipVaultFollowingImportJobId(rawJobId) ||
    `legacy:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  clipVaultFollowingImportControllers.get(jobId)?.abort();
  const controller = new AbortController();
  clipVaultFollowingImportControllers.set(jobId, controller);
  return Promise.resolve()
    .then(() => task(controller.signal))
    .finally(() => {
      if (clipVaultFollowingImportControllers.get(jobId) === controller) {
        clipVaultFollowingImportControllers.delete(jobId);
      }
    });
}

function cancelClipVaultFollowingImportJob(rawJobId) {
  const jobId = normalizeClipVaultFollowingImportJobId(rawJobId);
  if (!jobId) return false;
  const controller = clipVaultFollowingImportControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  clipVaultFollowingImportControllers.delete(jobId);
  return true;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const parentSignal = options.signal;
  throwIfAborted(parentSignal);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  parentSignal?.addEventListener?.("abort", abort, { once: true });

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener?.("abort", abort);
  }
}

function collectCommentEntries(items, sourceType = "comment") {
  if (!Array.isArray(items)) return [];
  const entries = [];
  items.forEach((item) => {
    const entry = toCommentEntry(item, sourceType);
    if (entry) entries.push(entry);
    entries.push(...collectCommentEntries(item?.replyComments, "reply"));
  });
  return entries;
}

function toCommentEntry(item, sourceType = "comment") {
  const comment = item?.comment;
  if (!comment || comment.deleted || comment.hideByCleanBot) return null;
  const content = String(comment.content || "").trim();
  if (!content) return null;
  return {
    commentId: String(comment.commentId || ""),
    content,
    nickname: String(item?.user?.userNickname || "익명").trim() || "익명",
    buffCount: Number(item?.buffNerf?.buffCount || 0),
    createdDate: String(comment.createdDate || ""),
    sourceType,
  };
}

function buildTimestampMarkers(entries) {
  const candidates = [];
  entries.forEach((entry) => {
    extractTimestampDescriptions(entry.content).forEach((item) => {
      const seconds = item.seconds;
      if (!Number.isFinite(seconds) || seconds < 0) return;
      const description = normalizeTimestampDescription(item.description);
      candidates.push({
        seconds,
        description,
        nickname: entry.nickname,
        commentId: entry.commentId,
        buffCount: entry.buffCount,
        sourceType: entry.sourceType,
        hasDescription: Boolean(description),
      });
    });
  });

  const clusters = clusterTimestampCandidates(candidates);
  return clusters
    .map(buildTimestampMarkerFromCluster)
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 80);
}

function clusterTimestampCandidates(candidates) {
  const sorted = candidates
    .filter((candidate) => Number.isFinite(candidate.seconds))
    .sort((a, b) => a.seconds - b.seconds);
  const clusters = [];
  sorted.forEach((candidate) => {
    const cluster = clusters.find((item) =>
      item.some(
        (existing) =>
          Math.abs(existing.seconds - candidate.seconds) <=
          COMMENT_TIMESTAMP_CLUSTER_RANGE_SECONDS,
      ),
    );
    if (cluster) {
      cluster.push(candidate);
      return;
    }
    clusters.push([candidate]);
  });
  return clusters;
}

function buildTimestampMarkerFromCluster(cluster) {
  const primarySorted = [...cluster].sort(compareTimestampCandidatePriority);
  const displaySorted = [...cluster].sort(compareTimestampCandidateDisplay);
  const primary = primarySorted[0];
  const descriptionKeys = new Set();
  const comments = [];
  displaySorted.forEach((candidate) => {
    const descriptionKey =
      normalizeSearchText(candidate.description) ||
      `__empty__:${candidate.sourceType}:${candidate.commentId}:${candidate.seconds}`;
    if (descriptionKeys.has(descriptionKey)) return;
    descriptionKeys.add(descriptionKey);
    comments.push({
      description: candidate.description,
      nickname: candidate.nickname,
      commentId: candidate.commentId,
      buffCount: candidate.buffCount,
      sourceType: candidate.sourceType,
    });
  });

  return {
    seconds: primary.seconds,
    timeLabel: formatTimestamp(primary.seconds),
    comments: comments.slice(0, 4),
    sourceCount: cluster.length,
    score: primarySorted.reduce(
      (total, candidate) =>
        total +
        getTimestampCandidatePriority(candidate) +
        Number(candidate.buffCount || 0),
      0,
    ),
  };
}

function compareTimestampCandidatePriority(a, b) {
  return (
    getTimestampCandidatePriority(b) - getTimestampCandidatePriority(a) ||
    Number(b.buffCount || 0) - Number(a.buffCount || 0) ||
    a.seconds - b.seconds
  );
}

function compareTimestampCandidateDisplay(a, b) {
  return (
    Number(Boolean(b.hasDescription)) - Number(Boolean(a.hasDescription)) ||
    getTimestampCandidatePriority(b) - getTimestampCandidatePriority(a) ||
    Number(b.buffCount || 0) - Number(a.buffCount || 0) ||
    a.seconds - b.seconds
  );
}

function getTimestampCandidatePriority(candidate) {
  const sourceScore =
    candidate.sourceType === "best"
      ? 100
      : candidate.sourceType === "comment"
        ? 40
        : 10;
  const descriptionScore = candidate.hasDescription ? 35 : 0;
  return sourceScore + descriptionScore;
}

function extractTimestampDescriptions(content) {
  return String(content || "")
    .split(/\r?\n/)
    .flatMap((line) => extractTimestampDescriptionsFromLine(line));
}

function extractTimestampDescriptionsFromLine(line) {
  const trimmedLine = String(line || "").trim();
  if (!trimmedLine) return [];

  const timestampMatches = Array.from(
    trimmedLine.matchAll(/(?:\d{1,2}:)?\d{1,2}:\d{2}/g),
  );
  if (!timestampMatches.length) return [];

  if (timestampMatches.length > 1 && isTimestampListLine(trimmedLine)) {
    return timestampMatches.map((match) => ({
      seconds: parseTimestamp(match[0]),
      description: "",
    }));
  }

  // 설명이 타임스탬프 '뒤'(02:22 오프닝)인지 '앞'(오프닝스킵 02:22)인지 줄 단위로
  // 판정한다. 첫 타임스탬프 앞에 텍스트가 있고 마지막 타임스탬프 뒤가 비어 있으면
  // '레이블 먼저' 형식으로 보고 각 타임스탬프의 앞 세그먼트를 레이블로 쓴다. 그 외엔
  // 기존대로 뒤 세그먼트를 쓴다(대부분의 "02:22 설명" 형식).
  const segmentBounds = timestampMatches.map((match, index) => {
    const start = Number(match.index || 0);
    const end = start + match[0].length;
    const prevEnd =
      index > 0
        ? Number(timestampMatches[index - 1].index || 0) +
          timestampMatches[index - 1][0].length
        : 0;
    const nextStart =
      index + 1 < timestampMatches.length
        ? Number(timestampMatches[index + 1].index || trimmedLine.length)
        : trimmedLine.length;
    return { start, end, prevEnd, nextStart };
  });

  const firstPrefix = trimTimestampPrefixDescription(
    trimmedLine,
    segmentBounds[0].prevEnd,
    segmentBounds[0].start,
  );
  const last = segmentBounds[segmentBounds.length - 1];
  const lastSuffix = trimTimestampSegmentDescription(
    trimmedLine,
    last.start,
    last.end - last.start,
    last.nextStart,
  );
  const labelBefore = Boolean(firstPrefix) && !lastSuffix;

  return timestampMatches.map((match, index) => {
    const timestamp = match[0];
    const { start, end, prevEnd, nextStart } = segmentBounds[index];
    const description = labelBefore
      ? trimTimestampPrefixDescription(trimmedLine, prevEnd, start)
      : trimTimestampSegmentDescription(
          trimmedLine,
          start,
          end - start,
          nextStart,
        );

    return {
      seconds: parseTimestamp(timestamp),
      description,
    };
  });
}

// 타임스탬프 '앞'에 오는 레이블(오프닝스킵 02:22)을 추출한다. 이전 타임스탬프 끝
// (prevEnd)부터 이 타임스탬프 시작(timestampIndex)까지의 텍스트에서 앞뒤 구분자를
// 정리한다.
function trimTimestampPrefixDescription(line, prevEnd, timestampIndex) {
  let description = line.slice(prevEnd, timestampIndex);
  // 앞쪽 구분자/여는 괄호 제거, 뒤쪽(타임스탬프 바로 앞) 구분자 제거.
  return description
    .replace(/^[\s\-–—_:|/.,~·▶▷([{<〈《「『【（［｛]+/u, "")
    .replace(/[\s\-–—_:|/.,~·)\]}>〉》」』】）］｝]+$/u, "");
}

function isTimestampListLine(line) {
  return !String(line || "")
    .replace(/(?:\d{1,2}:)?\d{1,2}:\d{2}/g, "")
    .replace(/[\s,/|·ㆍ・‧•\-–—_()[\]{}]+/g, "")
    .trim();
}

function trimTimestampSegmentDescription(
  line,
  timestampIndex,
  timestampLength,
  nextTimestampIndex,
) {
  const prefix = line.slice(0, timestampIndex).trimEnd();
  const opening = prefix[prefix.length - 1] || "";
  const closingMap = {
    "(": ")",
    "[": "]",
    "{": "}",
    "<": ">",
    "〈": "〉",
    "《": "》",
    "「": "」",
    "『": "』",
    "【": "】",
    "（": "）",
    "［": "］",
    "｛": "｝",
  };
  const closing = closingMap[opening];
  let description = line.slice(
    timestampIndex + timestampLength,
    nextTimestampIndex,
  );
  if (closing && description.trimEnd().endsWith(closing)) {
    description = description.trimEnd().slice(0, -closing.length);
  }
  return description.replace(/[\s\-–—_:|/.,~·▶▷([{<〈《「『【（［｛]+$/u, "");
}

function normalizeTimestampDescription(description) {
  const text = String(description || "")
    .replace(
      /^[\s\-–—_:|/.,~·▶▷\])}>\u3009\u300b\u300d\u300f\u3011\uff09\uff3d\uff5d]+/u,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const withoutTimestamps = text
    .replace(/(?:\d{1,2}:)?\d{1,2}:\d{2}/g, "")
    .replace(/[\s\-–—_:|/.,~·()[\]{}<>〈〉《》「」『』【】（）［］｛｝]+/g, "")
    .trim();
  return withoutTimestamps ? text : "";
}

function parseTimestamp(timestamp) {
  const parts = String(timestamp || "")
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds > 59) return NaN;
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (minutes > 59 || seconds > 59) return NaN;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return NaN;
}

function formatTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

function normalizeSearchText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function createProgressReporter(sender, requestId) {
  if (!requestId) return () => {};

  return (progress) => {
    const message = {
      type: "CHEESE_SEARCH_FETCH_PROGRESS",
      requestId,
      progress,
    };

    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, message, () => {
        void chrome.runtime.lastError;
      });
      return;
    }

    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  };
}

function addProgressSubscriber(entry, requestId, progressReporter) {
  if (requestId) {
    const existing = entry.requestSubscribers.get(requestId);
    if (existing) {
      entry.progressReporters.delete(existing);
    }
    entry.requestSubscribers.set(requestId, progressReporter);
  }
  entry.progressReporters.add(progressReporter);
}

function removeProgressSubscriber(entry, requestId) {
  const progressReporter = entry.requestSubscribers.get(requestId);
  if (!progressReporter) return false;
  entry.requestSubscribers.delete(requestId);
  entry.progressReporters.delete(progressReporter);
  return true;
}

function mergeAccumulatedClips(entry, clips) {
  if (!Array.isArray(clips) || !clips.length) return;
  if (!entry.accumulatedClipIndexById) {
    entry.accumulatedClipIndexById = new Map();
  }
  clips.forEach((clip) => {
    const clipUID = String(clip?.clipUID || "").trim();
    if (!clipUID) {
      entry.accumulatedClips.push(clip);
      return;
    }
    const existingIndex = entry.accumulatedClipIndexById.get(clipUID);
    if (existingIndex === undefined) {
      entry.accumulatedClipIndexById.set(
        clipUID,
        entry.accumulatedClips.length,
      );
      entry.accumulatedClips.push(clip);
      return;
    }
    entry.accumulatedClips[existingIndex] = {
      ...entry.accumulatedClips[existingIndex],
      ...clip,
    };
  });
}

function subscribeToInFlightFetch(key, requestId, progressReporter) {
  const entry = inFlightFetches.get(key);
  if (!entry) return null;

  addProgressSubscriber(entry, requestId, progressReporter);
  if (entry.lastProgress) {
    progressReporter({
      ...entry.lastProgress,
      clips:
        entry.accumulatedClips.length &&
        entry.lastProgress.contentType === "clips"
          ? entry.accumulatedClips
          : entry.lastProgress.clips,
      shared: true,
    });
  }

  return entry.promise.finally(() => {
    removeProgressSubscriber(entry, requestId);
  });
}

function runFetchWithProgress(key, request, progressReporter) {
  const progressReporters = new Set([progressReporter]);
  const entry = {
    progressReporters,
    requestSubscribers: new Map(),
    accumulatedClips: [],
    accumulatedClipIndexById: new Map(),
    lastProgress: null,
    promise: null,
    channelId: request.channelId,
    contentType: request.contentType || "videos",
    abortController: new AbortController(),
  };
  if (request.requestId) {
    entry.requestSubscribers.set(request.requestId, progressReporter);
  }

  const reportProgress = (rawProgress) => {
    const progress = {
      ...rawProgress,
      channelId: request.channelId,
      contentType: rawProgress.contentType || entry.contentType,
    };
    if (progress.contentType === "clips" && Array.isArray(progress.clips)) {
      mergeAccumulatedClips(entry, progress.clips);
    }
    entry.lastProgress = progress;
    progressReporters.forEach((reporter) => reporter(progress));
  };

  const fetcher =
    request.contentType === "clips" ? fetchAllClips : fetchAllVideos;
  entry.promise = runCollectionTask(
    () =>
      fetcher(
        { ...request, signal: entry.abortController.signal },
        reportProgress,
      ),
    entry.abortController.signal,
    () =>
      reportProgress({
        phase: "queued",
        contentType: request.contentType || "videos",
      }),
  )
    .catch((error) => {
      reportProgress({
        phase: isAbortError(error) ? "cancelled" : "error",
        error: normalizeError(error),
        contentType: request.contentType || "videos",
      });
      throw error;
    })
    .finally(() => {
      if (inFlightFetches.get(key) === entry) {
        inFlightFetches.delete(key);
      }
    });
  inFlightFetches.set(key, entry);
  return entry.promise;
}

function fetchAllVideosShared(request, sender) {
  const key = inFlightKey(request);
  const progressReporter = createProgressReporter(sender, request.requestId);
  const inFlight = subscribeToInFlightFetch(
    key,
    request.requestId,
    progressReporter,
  );
  if (inFlight) return inFlight;
  return runFetchWithProgress(key, request, progressReporter);
}

function tryResubscribeInFlight(request, sender) {
  const key = inFlightKey({ ...request, forceRefresh: false });
  const entry = inFlightFetches.get(key);
  if (!entry) {
    const forceKey = inFlightKey({ ...request, forceRefresh: true });
    const forceEntry = inFlightFetches.get(forceKey);
    if (!forceEntry) return null;
    return attachReporter(forceEntry, request, sender);
  }
  return attachReporter(entry, request, sender);
}

function attachReporter(entry, request, sender) {
  const progressReporter = createProgressReporter(sender, request.requestId);
  addProgressSubscriber(entry, request.requestId, progressReporter);
  if (entry.lastProgress) {
    progressReporter({
      ...entry.lastProgress,
      clips:
        entry.accumulatedClips.length &&
        entry.lastProgress.contentType === "clips"
          ? entry.accumulatedClips
          : entry.lastProgress.clips,
      shared: true,
      resubscribed: true,
    });
  }
  entry.promise
    .finally(() => {
      removeProgressSubscriber(entry, request.requestId);
    })
    .catch(() => {});
  return {
    contentType: request.contentType || "videos",
    accumulatedCount: entry.accumulatedClips.length,
    lastPhase: entry.lastProgress?.phase || "fetching",
  };
}

function cancelFetchSubscription(requestId) {
  if (!requestId) return { matched: false, aborted: false };

  for (const entry of inFlightFetches.values()) {
    if (!removeProgressSubscriber(entry, requestId)) continue;
    const aborted = entry.progressReporters.size === 0;
    if (aborted) {
      console.debug(
        "[CheeseSearch] aborting fetch — last subscriber cancelled",
        requestId,
      );
      entry.abortController.abort();
      for (const [key, currentEntry] of inFlightFetches.entries()) {
        if (currentEntry === entry) {
          inFlightFetches.delete(key);
          break;
        }
      }
    }
    return { matched: true, aborted };
  }

  return { matched: false, aborted: false };
}

async function fetchAllVideos(request, reportProgress = () => {}) {
  const key = cacheKey(request);
  const cached = await readCache(key);
  const now = Date.now();
  reportProgress({
    phase: "start",
    fetchedPages: 0,
    totalPages: 0,
    totalCount: 0,
    pageSize: PAGE_SIZE,
  });

  if (
    cached &&
    now - cached.createdAt < CACHE_TTL_MS &&
    !request.forceRefresh
  ) {
    let firstPage;
    try {
      reportProgress({
        phase: "checking",
        fetchedPages: 0,
        totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalCount: Number(
          cached.value.totalCount || cached.value.videos?.length || 0,
        ),
        pageSize: PAGE_SIZE,
        fromCache: true,
      });
      firstPage = await fetchVideoPage({ ...request, page: 0 });
    } catch (error) {
      const value = await ensureVideoSortMetricsForValue(
        cached.value,
        request,
        cached.createdAt,
        key,
      );
      reportProgress({
        phase: "done",
        fetchedPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalCount: Number(
          cached.value.totalCount || cached.value.videos?.length || 0,
        ),
        pageSize: PAGE_SIZE,
        fromCache: true,
      });
      return { ...value, fromCache: true, freshnessCheckFailed: true };
    }

    const firstData = Array.isArray(firstPage.data) ? firstPage.data : [];
    const latestCachedVideoNo = cached.value.videos?.[0]?.videoNo || null;
    const latestRemoteVideoNo = firstData[0]?.videoNo || null;
    const remoteTotalCount = Number(firstPage.totalCount || firstData.length);
    if (
      remoteTotalCount === cached.value.totalCount &&
      latestRemoteVideoNo === latestCachedVideoNo
    ) {
      reportProgress({
        phase: "done",
        fetchedPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalCount: Number(
          cached.value.totalCount || cached.value.videos?.length || 0,
        ),
        pageSize: PAGE_SIZE,
        fromCache: true,
      });
      const value = await ensureVideoSortMetricsForValue(
        cached.value,
        request,
        cached.createdAt,
        key,
      );
      return { ...value, fromCache: true, checkedFresh: true };
    }

    return fetchAllVideos({ ...request, forceRefresh: true }, reportProgress);
  }

  const firstPage = await fetchVideoPage({ ...request, page: 0 });
  const totalPages = Number(firstPage.totalPages || 0);
  const firstData = Array.isArray(firstPage.data) ? firstPage.data : [];
  reportProgress({
    phase: "fetching",
    fetchedPages: Math.min(1, Math.max(1, totalPages)),
    totalPages: Math.max(1, totalPages),
    totalCount: Number(firstPage.totalCount || firstData.length),
    pageSize: PAGE_SIZE,
  });

  if (totalPages <= 1) {
    const videos = await enrichVideosWithSortMetrics(
      firstData,
      request.sort,
      request.signal,
    );
    const value = {
      channelId: request.channelId,
      videoType: request.videoType || "",
      sortType: request.sortType || "LATEST",
      totalCount: Number(firstPage.totalCount || videos.length),
      totalPages: Math.max(1, totalPages),
      fetchedAt: now,
      videos,
    };
    await writeCache(key, { createdAt: now, value });
    reportProgress({
      phase: "done",
      fetchedPages: 1,
      totalPages: 1,
      totalCount: value.totalCount,
      pageSize: PAGE_SIZE,
    });
    return { ...value, fromCache: false };
  }

  const pageNumbers = Array.from(
    { length: totalPages - 1 },
    (_, index) => index + 1,
  );
  let fetchedPages = 1;
  const pages = await mapWithConcurrency(
    pageNumbers,
    MAX_CONCURRENT_PAGE_REQUESTS,
    (page) =>
      fetchVideoPage({ ...request, page }).then((result) => {
        fetchedPages += 1;
        reportProgress({
          phase: "fetching",
          fetchedPages,
          totalPages,
          totalCount: Number(firstPage.totalCount || 0),
          pageSize: PAGE_SIZE,
        });
        return result;
      }),
  );
  const videos = await enrichVideosWithSortMetrics(
    firstData.concat(
      pages.flatMap((page) => (Array.isArray(page.data) ? page.data : [])),
    ),
    request.sort,
    request.signal,
  );

  const value = {
    channelId: request.channelId,
    videoType: request.videoType || "",
    sortType: request.sortType || "LATEST",
    totalCount: Number(firstPage.totalCount || videos.length),
    totalPages,
    fetchedAt: now,
    videos,
  };

  await writeCache(key, { createdAt: now, value });
  reportProgress({
    phase: "done",
    fetchedPages: totalPages,
    totalPages,
    totalCount: value.totalCount,
    pageSize: PAGE_SIZE,
  });
  return { ...value, fromCache: false };
}

async function ensureVideoSortMetricsForValue(value, request, createdAt, key) {
  if (getSortMetricType(request.sort) !== "comments") return value;
  const videos = await enrichVideosWithSortMetrics(
    Array.isArray(value?.videos) ? value.videos : [],
    request.sort,
    request.signal,
  );
  const nextValue = { ...value, videos };
  await writeCache(key, { createdAt, value: nextValue });
  return nextValue;
}

function createClipMetricProgressBatcher(reportProgress, getBaseProgress) {
  const pendingClips = [];
  const flush = () => {
    if (!pendingClips.length) return;
    const clips = pendingClips.splice(0);
    reportProgress({
      ...getBaseProgress(),
      clips,
    });
  };
  return {
    push(clip) {
      if (!clip) return;
      pendingClips.push(clip);
      if (pendingClips.length >= CLIP_PAGE_SIZE) {
        flush();
      }
    },
    flush,
  };
}

async function fetchAllClips(request, reportProgress = () => {}) {
  const normalizedRequest = {
    ...request,
    filterType: normalizeClipFilterType(request.filterType),
    orderType: normalizeClipOrderType(request.orderType),
  };
  const key = clipCacheKey(normalizedRequest);
  const cached = await readCache(key);
  const now = Date.now();

  reportProgress({
    phase: "start",
    fetchedPages: 0,
    totalPages: 0,
    totalCount: 0,
    pageSize: CLIP_PAGE_SIZE,
    contentType: "clips",
  });

  if (
    cached &&
    now - cached.createdAt < CACHE_TTL_MS &&
    !normalizedRequest.forceRefresh
  ) {
    const cachedTotalPages = Math.max(1, Number(cached.value.totalPages || 1));
    const cachedActiveClips = await enrichClipsWithCategoryValues(
      getActiveClips(cached.value.clips),
      normalizedRequest.signal,
    );
    const metricProgress = createClipMetricProgressBatcher(
      reportProgress,
      () => ({
        phase: "fetching",
        fetchedPages: cachedTotalPages,
        totalPages: cachedTotalPages,
        totalCount: cachedActiveClips.length,
        pageSize: CLIP_PAGE_SIZE,
        contentType: "clips",
        fromCache: true,
      }),
    );
    const activeClips = await enrichClipsWithSortMetricsAndReport(
      cachedActiveClips,
      normalizedRequest.sort,
      normalizedRequest.signal,
      metricProgress.push,
    );
    metricProgress.flush();
    if (getSortMetricType(normalizedRequest.sort) === "likes") {
      await writeCache(key, {
        createdAt: cached.createdAt,
        value: {
          ...cached.value,
          clips: activeClips,
          allClips: mergeClipMetricsIntoAllClips(
            cached.value.allClips || cached.value.clips,
            activeClips,
          ),
        },
      });
    }
    const { allClips: _allClips, ...publicValue } = cached.value;
    reportProgress({
      phase: "done",
      fetchedPages: cachedTotalPages,
      totalPages: cachedTotalPages,
      totalCount: activeClips.length,
      pageSize: CLIP_PAGE_SIZE,
      contentType: "clips",
      fromCache: true,
    });
    return {
      ...publicValue,
      clips: activeClips,
      totalCount: activeClips.length,
      fromCache: true,
    };
  }

  const remoteClips = [];
  const seenClipUIDs = new Set();
  const requestedCursors = new Set();
  let cursor = { clipUID: "", readCount: "" };
  let fetchedPages = 0;

  const wantsLikeMetric = getSortMetricType(normalizedRequest.sort) === "likes";
  const streamingMetricProgress = wantsLikeMetric
    ? createClipMetricProgressBatcher(reportProgress, () => ({
        phase: "fetching",
        fetchedPages: Math.max(1, fetchedPages),
        totalPages: 0,
        totalCount: remoteClips.length,
        pageSize: CLIP_PAGE_SIZE,
        contentType: "clips",
      }))
    : null;
  // 페이지 수집과 좋아요 수 조회를 겹쳐 처리한다: 새 페이지가 도착하는 즉시
  // 해당 클립들의 좋아요 조회를 시작하고, 루프 종료 후 drain으로 마무리한다.
  const likePipeline = wantsLikeMetric
    ? createClipLikePipeline(
        normalizedRequest.signal,
        streamingMetricProgress.push,
      )
    : null;

  // 이전 캐시에 이미 좋아요 수가 있으면 재조회를 건너뛰도록 UID로 미리 묶어둔다.
  const previousClips = Array.isArray(cached?.value?.allClips)
    ? cached.value.allClips
    : Array.isArray(cached?.value?.clips)
      ? cached.value.clips
      : [];
  const previousClipsByUID = new Map();
  if (wantsLikeMetric) {
    previousClips.forEach((clip) => {
      const uid = String(clip?.clipUID || "").trim();
      if (uid) previousClipsByUID.set(uid, clip);
    });
  }

  while (true) {
    const cursorKey = `${cursor.clipUID || ""}:${cursor.readCount ?? ""}`;
    if (requestedCursors.has(cursorKey)) {
      throw new Error("클립 페이지 커서가 반복되어 수집을 중단했습니다.");
    }
    requestedCursors.add(cursorKey);

    const page = await fetchClipPage({
      ...normalizedRequest,
      cursor,
    });
    const pageClips = await enrichClipsWithCategoryValues(
      Array.isArray(page.data) ? page.data : [],
      normalizedRequest.signal,
    );
    const newPageClips = [];

    pageClips.forEach((clip) => {
      const clipUID = String(clip?.clipUID || "").trim();
      if (!clipUID || seenClipUIDs.has(clipUID)) return;
      seenClipUIDs.add(clipUID);
      const normalizedClip = {
        ...clip,
        clipUID,
        deletedAt: null,
        missingCount: 0,
      };
      remoteClips.push(normalizedClip);
      newPageClips.push(normalizedClip);
    });

    fetchedPages += 1;
    reportProgress({
      phase: "fetching",
      fetchedPages,
      totalPages: 0,
      totalCount: remoteClips.length,
      pageSize: CLIP_PAGE_SIZE,
      contentType: "clips",
      clips: newPageClips,
    });

    if (likePipeline) {
      const clipsForLikes = newPageClips.map((clip) => {
        const previous = previousClipsByUID.get(clip.clipUID);
        if (
          previous &&
          hasOwnMetric(previous, "likeCount") &&
          previous.likeCountFetchedAt
        ) {
          return {
            ...clip,
            likeCount: previous.likeCount,
            likeCountFetchedAt: previous.likeCountFetchedAt,
          };
        }
        return clip;
      });
      await likePipeline.push(clipsForLikes);
    }

    const next = page?.page?.next;
    if (!next?.clipUID) break;
    cursor = {
      clipUID: String(next.clipUID || "").trim(),
      readCount: next.readCount ?? "",
    };
    if (CLIP_PAGE_THROTTLE_MS > 0) {
      await sleep(CLIP_PAGE_THROTTLE_MS, normalizedRequest.signal);
    }
  }

  const categorizedAll = await enrichClipsWithCategoryValues(
    reconcileClipCache(previousClips, remoteClips, now),
    normalizedRequest.signal,
  );

  let allClips;
  if (likePipeline) {
    // 페이지 수집과 겹쳐 진행한 좋아요 조회를 마무리하고, 그 결과를
    // 재조정된 전체 목록에 UID 기준으로 병합한다.
    await likePipeline.drain();
    streamingMetricProgress.flush();
    allClips = applyLikePipelineResults(
      categorizedAll,
      likePipeline.enrichedByUID,
    );
  } else {
    allClips = categorizedAll;
  }
  const activeClips = getActiveClips(allClips);
  const deletedCount = allClips.length - activeClips.length;
  const value = {
    channelId: normalizedRequest.channelId,
    contentType: "clips",
    filterType: normalizedRequest.filterType,
    orderType: normalizedRequest.orderType,
    totalCount: activeClips.length,
    totalPages: Math.max(1, fetchedPages),
    fetchedAt: now,
    clips: activeClips,
    allClips,
    deletedCount,
  };

  await writeCache(key, { createdAt: now, value });
  reportProgress({
    phase: "done",
    fetchedPages: Math.max(1, fetchedPages),
    totalPages: Math.max(1, fetchedPages),
    totalCount: activeClips.length,
    pageSize: CLIP_PAGE_SIZE,
    contentType: "clips",
    fetchedAt: value.fetchedAt,
  });

  const { allClips: _allClips, ...publicValue } = value;
  return { ...publicValue, fromCache: false };
}

function mergeClipMetricsIntoAllClips(allClips, enrichedClips) {
  if (!Array.isArray(allClips) || !Array.isArray(enrichedClips)) {
    return Array.isArray(allClips) ? allClips : [];
  }
  const enrichedById = new Map();
  enrichedClips.forEach((clip) => {
    const id = String(clip?.clipUID || "").trim();
    if (id) enrichedById.set(id, clip);
  });
  return allClips.map((clip) => {
    const id = String(clip?.clipUID || "").trim();
    const enriched = id ? enrichedById.get(id) : null;
    if (!enriched) return clip;
    return { ...clip, ...enriched };
  });
}

function reconcileClipCache(previousClips, remoteClips, now) {
  const previousById = new Map();
  previousClips.forEach((clip) => {
    const clipUID = String(clip?.clipUID || "").trim();
    if (clipUID) previousById.set(clipUID, clip);
  });

  const remoteIds = new Set(remoteClips.map((clip) => clip.clipUID));
  const mergedActive = remoteClips.map((clip) => ({
    ...previousById.get(clip.clipUID),
    ...clip,
    deletedAt: null,
    missingCount: 0,
  }));

  const missing = [];
  previousById.forEach((clip, clipUID) => {
    if (remoteIds.has(clipUID)) return;
    const missingCount = Number(clip.missingCount || 0) + 1;
    missing.push({
      ...clip,
      missingCount,
      deletedAt:
        missingCount >= CLIP_MISSING_CONFIRMATION_COUNT
          ? clip.deletedAt || now
          : clip.deletedAt || null,
    });
  });

  return mergedActive.concat(missing);
}

function getActiveClips(clips) {
  return (Array.isArray(clips) ? clips : []).filter((clip) => !clip.deletedAt);
}

function normalizeClipFilterType(value) {
  const normalized = String(value || "ALL").toUpperCase();
  const allowed = new Set([
    "ALL",
    "WITHIN_ONE_DAY",
    "WITHIN_SEVEN_DAYS",
    "WITHIN_THIRTY_DAYS",
  ]);
  return allowed.has(normalized) ? normalized : "ALL";
}

function normalizeClipOrderType(value) {
  const normalized = String(value || "RECENT").toUpperCase();
  return normalized === "POPULAR" ? "POPULAR" : "RECENT";
}

function normalizeMakeClipDateFilter(value) {
  const normalized = String(value || "ALL").toUpperCase();
  const allowed = new Set([
    "ALL",
    "WITHIN_ONE_DAY",
    "WITHIN_SEVEN_DAYS",
    "WITHIN_THIRTY_DAYS",
  ]);
  return allowed.has(normalized) ? normalized : "ALL";
}

function normalizeMakeClipOrderFilter(value) {
  const normalized = String(value || "LATEST").toUpperCase();
  return normalized === "POPULAR" ? "POPULAR" : "LATEST";
}

async function runCollectionTask(task, signal, reportQueued) {
  const release = await acquireCollectionTaskSlot(signal, reportQueued);
  try {
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}

function acquireCollectionTaskSlot(signal, reportQueued) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);

    const waiter = {
      signal,
      resolve,
      reject,
      handleAbort: null,
    };
    waiter.handleAbort = () => {
      const index = collectionTaskQueue.indexOf(waiter);
      if (index >= 0) collectionTaskQueue.splice(index, 1);
      reject(createAbortError());
    };

    if (activeCollectionTaskCount < MAX_CONCURRENT_COLLECTION_TASKS) {
      startCollectionTaskWaiter(waiter);
      return;
    }

    collectionTaskQueue.push(waiter);
    signal?.addEventListener("abort", waiter.handleAbort, { once: true });
    reportQueued?.();
  });
}

function startCollectionTaskWaiter(waiter) {
  if (waiter.signal?.aborted) {
    waiter.reject(createAbortError());
    return;
  }

  waiter.signal?.removeEventListener("abort", waiter.handleAbort);
  activeCollectionTaskCount += 1;
  let released = false;
  waiter.resolve(() => {
    if (released) return;
    released = true;
    activeCollectionTaskCount = Math.max(0, activeCollectionTaskCount - 1);
    drainCollectionTaskQueue();
  });
}

function drainCollectionTaskQueue() {
  while (
    activeCollectionTaskCount < MAX_CONCURRENT_COLLECTION_TASKS &&
    collectionTaskQueue.length
  ) {
    const waiter = collectionTaskQueue.shift();
    if (waiter.signal?.aborted) {
      waiter.reject(createAbortError());
      continue;
    }
    startCollectionTaskWaiter(waiter);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchExactChannelByNickname(nickname) {
  const keyword = String(nickname || "").trim();
  if (!keyword) {
    throw new Error("스트리머 닉네임을 입력해 주세요.");
  }

  const cachedExactChannel = await readChannelSearchCache(
    normalizeChannelName(keyword),
  );
  if (isExactCachedChannelMatch(cachedExactChannel, keyword)) {
    return cachedExactChannel;
  }

  const cachedChannel = await findCachedChannelByNickname(keyword);
  if (cachedChannel) {
    writeChannelSearchCache(
      normalizeChannelName(cachedChannel.channelName),
      cachedChannel,
    );
    return cachedChannel;
  }

  const url = new URL(
    `${API_BASE.replace("/service/v1/channels", "")}/service/v1/search/channels`,
  );
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("offset", "0");
  url.searchParams.set("size", String(SEARCH_CHANNEL_PAGE_SIZE));
  url.searchParams.set("withFirstChannelContent", "true");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`채널 검색 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200) {
    throw new Error("채널 검색 응답을 읽을 수 없습니다.");
  }

  const data = Array.isArray(payload?.content?.data)
    ? payload.content.data
    : [];
  if (!data.length) {
    throw new Error("검색 결과가 없습니다. 닉네임을 다시 확인해 주세요.");
  }

  const candidates = data
    .map((item) =>
      item && typeof item.channel === "object" ? item.channel : null,
    )
    .filter((channel) => channel && String(channel.channelId || "").trim())
    .map(normalizeChannelCandidate);
  const target = normalizeChannelName(keyword);
  const exactMatches = candidates.filter(
    (candidate) => normalizeChannelName(candidate.channelName) === target,
  );

  if (exactMatches.length === 1) {
    return validateSearchedChannel(exactMatches[0], keyword);
  }

  if (candidates.length === 1) {
    return validateSearchedChannel(candidates[0], keyword);
  }

  return {
    needsSelection: true,
    keyword,
    candidates,
  };
}

async function fetchExactChannelByNicknameQueued(nickname) {
  const keyword = String(nickname || "").trim();
  if (!keyword) {
    throw new Error("스트리머 닉네임을 입력해 주세요.");
  }

  const cachedExactChannel = await readChannelSearchCache(
    normalizeChannelName(keyword),
  );
  if (isExactCachedChannelMatch(cachedExactChannel, keyword)) {
    return cachedExactChannel;
  }

  const cachedChannel = await findCachedChannelByNickname(keyword);
  if (cachedChannel) {
    writeChannelSearchCache(
      normalizeChannelName(cachedChannel.channelName),
      cachedChannel,
    );
    return cachedChannel;
  }

  const run = async () => {
    await waitForChannelSearchSlot();
    return fetchExactChannelByNickname(keyword);
  };
  const queued = channelSearchQueue.then(run, run);
  channelSearchQueue = queued.catch(() => {});
  return queued;
}

async function waitForChannelSearchSlot() {
  const elapsed = Date.now() - lastChannelSearchStartedAt;
  const delay = Math.max(0, CHANNEL_SEARCH_COOLDOWN_MS - elapsed);
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastChannelSearchStartedAt = Date.now();
}

async function findCachedChannelByNickname(nickname) {
  await cacheHydration;
  const target = normalizeChannelName(nickname);
  for (const entry of cache.values()) {
    const videos = Array.isArray(entry?.value?.videos)
      ? entry.value.videos
      : [];
    const matched = videos.find((video) => {
      const channel =
        video && typeof video.channel === "object" ? video.channel : null;
      return channel && normalizeChannelName(channel.channelName) === target;
    });
    if (!matched?.channel?.channelId) continue;

    return {
      channelId: String(matched.channel.channelId || "").trim(),
      channelName: String(matched.channel.channelName || nickname).trim(),
      channelImageUrl: String(matched.channel.channelImageUrl || "").trim(),
      verifiedMark: matched.channel.verifiedMark === true,
    };
  }
  return null;
}

function normalizeChannelCandidate(channel) {
  return {
    channelId: String(channel?.channelId || "").trim(),
    channelName: String(channel?.channelName || "").trim(),
    channelImageUrl: String(channel?.channelImageUrl || "").trim(),
    verifiedMark: channel?.verifiedMark === true,
  };
}

function isExactCachedChannelMatch(channel, keyword) {
  return (
    channel?.channelId &&
    normalizeChannelName(channel.channelName) === normalizeChannelName(keyword)
  );
}

async function validateSearchedChannel(candidate, keyword = "") {
  const normalizedCandidate = normalizeChannelCandidate(candidate);
  if (!normalizedCandidate.channelId) {
    throw new Error("선택한 채널 정보를 확인할 수 없습니다.");
  }

  const liveStatus = await fetchLiveStatusByChannelId(
    normalizedCandidate.channelId,
  );
  if (!liveStatus.hasStreamingHistory) {
    throw new Error("방송 이력이 있는 스트리머만 검색할 수 있습니다.");
  }

  const result = {
    ...normalizedCandidate,
    channelName:
      normalizedCandidate.channelName || String(keyword || "").trim(),
  };
  if (result.channelName) {
    writeChannelSearchCache(normalizeChannelName(result.channelName), result);
  }
  return result;
}

async function fetchLiveStatusByChannelId(channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!normalizedChannelId) {
    return { hasStreamingHistory: false };
  }

  const url = new URL(
    `${API_BASE}/${encodeURIComponent(normalizedChannelId)}/data`,
  );
  url.searchParams.set("fields", "channelHistory");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`스트리머 확인 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200) {
    throw new Error("스트리머 확인 응답을 읽을 수 없습니다.");
  }

  const history = payload?.content?.channelHistory;
  const firstLiveDate = String(history?.firstLiveDate || "").trim();
  const totalLiveHours = Number(history?.totalLiveHours || 0);
  return {
    hasStreamingHistory: Boolean(firstLiveDate) || totalLiveHours > 0,
  };
}

// ══ 통나무파워 시청 적립 추적(background, con-chzzk 이식) ══════════════════════
// content의 setInterval은 탭이 백그라운드(document.hidden)면 5분 체크가 멈추고 SPA
// 이동 시 상태가 휘발한다. chrome.alarms로 background에서 1분마다 보유량 delta를
// 비교해 '적립 중'을 판정하고, storage.session에 채널별 상태를 저장한다. 표시(배지
// progress 토글)는 content가 broadcast(LOG_POWER_WATCH_REWARD_STATUS)를 받아 한다.
const LP_WATCH_STATE_PREFIX = "logpower_watch_reward_state:";
const LP_WATCH_ALARM_PREFIX = "logpower:watch-reward:";
const LP_WATCH_INTERVAL_MIN = 1;
const LP_WATCH_ACTIVE_TTL_MS = 6 * 60 * 1000; // 적립 활성 6분
const LP_WATCH_MISS_LIMIT = Math.ceil(
  LP_WATCH_ACTIVE_TTL_MS / (LP_WATCH_INTERVAL_MIN * 60 * 1000),
);
const LP_WATCH_MAX_MS = 75 * 60 * 1000; // 최대 추적 75분
const LP_WATCH_AMOUNTS = [10, 12, 20]; // tier0/1/2 시청 보상액
// ⚠ 1시간을 채우는 순간 치지직은 5분 보상과 1시간 보상을 [함께] 준다.
//   그래서 그 주기의 delta 는 10+100=110 처럼 합쳐진 값으로 온다. 예전엔 이 값이
//   targets 에 없어 5분 보상으로 인식되지 않았고, 마지막 12회째가 통째로 누락됐다
//   (제보: 11회 110 만 기록되고 12회째가 사라짐).
//   합계값은 5분 단독(10/12/20)·1시간 단독(100/120/200) 어느 것과도 겹치지 않는다.
const LP_WATCH_COMBO = new Map([
  [110, 10],
  [132, 12],
  [220, 20],
]);
const LP_SUBSCRIBE_URL =
  "https://api.chzzk.naver.com/commercial/v1/subscribe/channels";
const LP_CHANNELS_PREFIX = "https://api.chzzk.naver.com/service/v1/channels";

function lpWatchStateKey(channelId) {
  return `${LP_WATCH_STATE_PREFIX}${channelId}`;
}
function lpWatchAlarmName(channelId) {
  return `${LP_WATCH_ALARM_PREFIX}${channelId}`;
}
function lpChannelIdFromAlarm(name) {
  return String(name || "").startsWith(LP_WATCH_ALARM_PREFIX)
    ? name.slice(LP_WATCH_ALARM_PREFIX.length)
    : "";
}

async function lpGetWatchState(channelId) {
  try {
    const k = lpWatchStateKey(channelId);
    const store = await chrome.storage.session.get(k);
    return store[k] || null;
  } catch {
    return null;
  }
}
async function lpSetWatchState(channelId, state) {
  try {
    await chrome.storage.session.set({ [lpWatchStateKey(channelId)]: state });
  } catch {}
}
async function lpClearWatchState(channelId) {
  try {
    await chrome.storage.session.remove(lpWatchStateKey(channelId));
  } catch {}
  try {
    await chrome.alarms.clear(lpWatchAlarmName(channelId));
  } catch {}
}

// 적립 '표시'만 끄되 추적(state+알람)은 유지한다. 치지직 적립 채널은 동적으로 바뀌므로
// (탭 A=채널X 적립 → 판정이 탭 B=채널Y로 이동), 다른 채널을 완전 삭제하면 나중에 그
// 채널이 실제 적립 채널이 돼도 재추적되지 않아 적립 중이 영영 안 뜬다. 그래서 activeUntil
// 을 0으로(표시 끔), misses 를 리셋하고, lastAmount 는 최신값으로 재기준(다음 delta 가
// 이 채널로 옮겨온 적립을 정확히 잡게). 알람은 유지해 다음 주기에 계속 감지한다.
// broadcast 는 status(active:false)로 — '적립 중' 표시만 끄고 1시간 타이머는 건드리지
// 않는다(LOG_POWER_LIVE_ENDED 는 라이브 종료용이라 1시간 타이머까지 지운다).
async function lpDeactivateWatchState(channelId) {
  const state = await lpGetWatchState(channelId);
  if (!state) return;
  const fresh = await lpFetchAmount(channelId);
  const next = {
    ...state,
    activeUntil: 0,
    misses: 0,
    lastAmount: Number.isFinite(fresh) ? fresh : state.lastAmount,
  };
  await lpSetWatchState(channelId, next);
  try {
    chrome.alarms.create(lpWatchAlarmName(channelId), {
      delayInMinutes: LP_WATCH_INTERVAL_MIN,
      periodInMinutes: LP_WATCH_INTERVAL_MIN,
    });
  } catch {}
  lpBroadcast(lpStateToStatus(next, false)); // 적립 중 표시만 끔(타이머 유지)
}

function lpTierToAmount(tier) {
  const n = Number(tier);
  if (n === 2) return 20;
  if (n === 1) return 12;
  if (n === 0) return 10;
  return null;
}

// 구독 tier로 예상 시청 보상액(없으면 null → [10,12,20] 폴백).
async function lpFetchExpectedAmount(channelId) {
  try {
    const res = await fetch(LP_SUBSCRIBE_URL, { credentials: "include" });
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json?.content) ? json.content : [];
    const item = list.find((x) => String(x?.channelId) === String(channelId));
    if (!item) return null;
    const tierNo = Number(item.tierNo);
    const tier = Number.isFinite(tierNo)
      ? tierNo
      : Number(String(item.tier || "").match(/TIER_(\d+)/i)?.[1] || 0);
    return lpTierToAmount(tier);
  } catch {
    return null;
  }
}

// 현재 보유량(raw). 못 찾으면 undefined(0과 구분 — 오탐 방지).
async function lpFetchAmount(channelId) {
  try {
    const res = await fetch(`${LP_CHANNELS_PREFIX}/${channelId}/log-power`, {
      credentials: "include",
    });
    if (!res.ok) return undefined;
    const json = await res.json();
    const amount = Number(json?.content?.amount);
    return Number.isFinite(amount) ? amount : undefined;
  } catch {
    return undefined;
  }
}

async function lpIsChannelLive(channelId) {
  try {
    // 채널 기본 정보 API 의 content.openLive 로 방송 여부 판단(가볍고 확실).
    // 과거 /live-status 경로는 Not Found 를 반환해 항상 null(불확실)이 나왔다.
    const res = await fetch(`${LP_CHANNELS_PREFIX}/${channelId}`, {
      credentials: "include",
    });
    if (!res.ok) return null; // 불확실
    const json = await res.json();
    const c = json?.content;
    if (!c || typeof c.openLive !== "boolean") return null;
    return c.openLive;
  } catch {
    return null;
  }
}

// content로 적립 상태 broadcast(모든 치지직 탭에). content는 채널 일치 시 표시.
function lpStateToStatus(state, activeOverride) {
  const now = Date.now();
  const active =
    activeOverride != null
      ? activeOverride
      : Number(state?.activeUntil || 0) > now;
  return {
    type: "LOG_POWER_WATCH_REWARD_STATUS",
    channelId: state?.channelId || "",
    active,
    // 적립 활성 만료 시각(ms). content가 이 시각 이후엔 스스로 '적립 중'을 끈다
    // (자연 만료 시 background가 매번 broadcast하지 않으므로).
    activeUntil: active ? Number(state?.activeUntil || 0) : 0,
    expectedAmount: state?.expectedAmount || null,
  };
}
function lpBroadcast(message, exceptTabId) {
  try {
    chrome.tabs.query({ url: "https://chzzk.naver.com/*" }, (tabs) => {
      void chrome.runtime.lastError;
      for (const t of tabs || []) {
        if (t.id != null && t.id !== exceptTabId) {
          chrome.tabs.sendMessage(t.id, message, () => {
            void chrome.runtime.lastError;
          });
        }
      }
    });
  } catch {}
}

// content 요청으로 적립 추적 시작(채널 진입). 이미 추적 중이면 baseline 유지.
async function lpStartTracking({ channelId, initialAmount }) {
  if (!channelId) return null;
  const now = Date.now();
  const existing = await lpGetWatchState(channelId);
  if (existing && now - Number(existing.startedAt || 0) <= LP_WATCH_MAX_MS) {
    // 추적 유지(알람만 보장).
    chrome.alarms.create(lpWatchAlarmName(channelId), {
      delayInMinutes: LP_WATCH_INTERVAL_MIN,
      periodInMinutes: LP_WATCH_INTERVAL_MIN,
    });
    return lpStateToStatus(existing);
  }
  const expected = await lpFetchExpectedAmount(channelId);
  // baseline: content가 보낸 initialAmount 우선, 없으면 raw 조회.
  let baseline = Number(initialAmount);
  if (!Number.isFinite(baseline)) baseline = await lpFetchAmount(channelId);
  if (!Number.isFinite(baseline)) return null;
  const state = {
    channelId,
    startedAt: now,
    lastAmount: baseline,
    expectedAmount: expected,
    activeUntil: 0,
    misses: 0,
  };
  await lpSetWatchState(channelId, state);
  chrome.alarms.create(lpWatchAlarmName(channelId), {
    delayInMinutes: LP_WATCH_INTERVAL_MIN,
    periodInMinutes: LP_WATCH_INTERVAL_MIN,
  });
  return lpStateToStatus(state);
}

// 통나무파워 적립은 계정당 한 번에 '한 채널'에서만 가능하다. 그래서 어떤 채널에서
// 적립이 감지되면(활성 채널 확정), 다른 채널들의 적립 추적 state와 1시간 타이머를
// 모두 정리하고 각 탭에 LOG_POWER_LIVE_ENDED를 보내 표시를 지운다(다른 채널의
// 적립 중·1시간 타이머가 남아 사용자를 헷갈리게 하지 않도록).
// 채널 표시 정보(이름/프로필). 기록에 남겨야 통계에서 id 대신 이름이 보인다.
async function lpFetchChannelMeta(channelId) {
  try {
    const res = await fetch(`${LP_CHANNELS_PREFIX}/${channelId}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const c = (await res.json())?.content;
    if (!c) return null;
    return {
      channelName: String(c.channelName || ""),
      channelImageUrl: String(c.channelImageUrl || ""),
      verifiedMark: c.verifiedMark === true,
    };
  } catch {
    return null;
  }
}

// content.js 의 appendLogPowerLog 와 같은 규칙으로 내역에 남긴다.
// ⚠ background 에서 직접 써야 한다. flush 시점(채널 이동·적립 중단)에 치지직 탭이
//   열려 있다는 보장이 없다.
const LP_LOG_KEY = "cheeseLogPowerLog";
const LP_LOG_DAYS_KEY = "cheeseLogPowerLogDays";
const LP_LOG_DAYS_DEFAULT = 90;
const LP_LOG_DAYS_MIN = 7;
const LP_LOG_DAYS_MAX = 3650;

function lpNormalizeLogDays(value) {
  if (value == null || value === "") return LP_LOG_DAYS_DEFAULT;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return LP_LOG_DAYS_DEFAULT;
  if (n === 0) return 0; // 제한 없음
  return Math.min(LP_LOG_DAYS_MAX, Math.max(LP_LOG_DAYS_MIN, n));
}

async function lpAppendLog(entry) {
  const id = String(entry?.id || "").trim();
  const amount = Number(entry?.amount) || 0;
  if (!id || !Number.isFinite(amount) || amount === 0) return;
  try {
    const data = await chrome.storage.local.get([LP_LOG_KEY, LP_LOG_DAYS_KEY]);
    const days = lpNormalizeLogDays(data?.[LP_LOG_DAYS_KEY]);
    const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
    const list = Array.isArray(data?.[LP_LOG_KEY]) ? data[LP_LOG_KEY] : [];
    // 같은 id 가 이미 있으면 중복 기록하지 않는다(재시도·다중 탭 대비).
    if (list.some((it) => it?.id === id)) return;
    const next = [
      {
        id,
        at: Number(entry?.at) || Date.now(),
        channelId: String(entry?.channelId || ""),
        channelName: String(entry?.channelName || "").slice(0, 100),
        channelImageUrl: String(entry?.channelImageUrl || "").slice(0, 300),
        verifiedMark: entry?.verifiedMark === true,
        amount,
        fiveMinAmount: Number(entry?.fiveMinAmount) || 0,
        boost: Number(entry?.boost) || 1,
        claimType: String(entry?.claimType || "WATCH_1_HOUR").toUpperCase(),
        // 5분 묶음의 회차 수(있을 때만).
        ...(Number(entry?.watchCount) > 0
          ? { watchCount: Number(entry.watchCount) }
          : {}),
      },
      ...list.filter((it) => (Number(it?.at) || 0) >= cutoff),
    ];
    await chrome.storage.local.set({ [LP_LOG_KEY]: next });
  } catch {}
}

// ── 연속 5분 보상 묶기 ──────────────────────────────────────────────────────
// 1시간을 채우면 WATCH_1_HOUR 한 건(+fiveMinAmount 12회분)으로 기록되지만, 중간에
// 채널을 옮기거나 시청을 멈추면 그때까지 받은 5분 보상이 어디에도 안 남아 '기타
// 적립'으로 샜다(제보). 그렇다고 5분마다 한 건씩 남기면 기록이 12배가 된다.
//
// 그래서 (prev, curr, cnt) 로 '같은 채널에서 연속으로 받은 횟수'만 세어 두고,
// 흐름이 끊길 때 한 건으로 묶어 기록한다.
//   (null,null,0) → (null,A,1) → (A,A,2) → (A,B,1) 이 순간 A×2 를 기록
//
// ⚠ local 에 둔다. session 은 브라우저 세션이 끝나면 비고, 그보다 먼저 서비스
//   워커가 잠들었다 깨는 사이에도 유실될 수 있다. 실제로 session 에 두었더니
//   5분마다 run 이 초기화돼 보상이 낱개로 기록됐다(제보: 엘시v +10 이 55건).
//   watch state 는 매 폴링마다 다시 쓰여서 티가 안 났지만, run 은 누적값이라
//   한 번만 사라져도 묶임이 깨진다.
const LP_RUN_KEY = "cheeseLogPowerFiveMinRun";

async function lpGetRun() {
  try {
    const v = (await chrome.storage.local.get(LP_RUN_KEY))?.[LP_RUN_KEY];
    if (v && typeof v === "object") return v;
  } catch {}
  return { prev: null, curr: null, cnt: 0, amount: 0, at: 0 };
}

async function lpSetRun(run) {
  try {
    await chrome.storage.local.set({ [LP_RUN_KEY]: run });
  } catch {}
}

// 쌓인 연속분을 WATCH_5_MIN 한 건으로 남긴다. 남길 게 없으면 아무것도 안 한다.
async function lpFlushRun() {
  const run = await lpGetRun();
  if (!run?.curr || !(run.cnt > 0) || !(run.amount > 0)) {
    if (run?.curr || run?.cnt) {
      await lpSetRun({
        prev: run?.curr || null,
        curr: null,
        cnt: 0,
        amount: 0,
        at: 0,
      });
    }
    return;
  }
  const channelId = run.curr;
  const meta = await lpFetchChannelMeta(channelId);
  // 부스팅 배수 = 실제 단가 / 기본 단가(10). 통계에서 '1티어 구독 ×1.2' 로 쓴다.
  const unit = run.amount / run.cnt;
  await lpAppendLog({
    // 같은 묶음을 두 번 저장하지 않도록 채널+시작시각으로 고정한다.
    id: `WATCH5RUN-${channelId}-${run.at}`,
    at: run.at || Date.now(),
    channelId,
    channelName: meta?.channelName || "",
    channelImageUrl: meta?.channelImageUrl || "",
    verifiedMark: meta?.verifiedMark === true,
    amount: run.amount,
    fiveMinAmount: 0,
    boost: Number((unit / 10).toFixed(2)) || 1,
    claimType: "WATCH_5_MIN",
    // 몇 회분이 묶였는지. 12회면 1시간을 채운 것, 그보다 적으면 중간에 끊긴 것.
    watchCount: run.cnt,
  });
  await lpSetRun({ prev: channelId, curr: null, cnt: 0, amount: 0, at: 0 });
}

// 5분 보상 1회 감지. 같은 채널이면 누적, 채널이 바뀌면 이전 채널을 먼저 확정한다.
async function lpNoteFiveMin(channelId, amount) {
  const run = await lpGetRun();
  if (run.curr && run.curr !== channelId) await lpFlushRun();
  const cur = await lpGetRun();
  const same = cur.curr === channelId;
  await lpSetRun({
    prev: cur.prev ?? null,
    curr: channelId,
    cnt: (same ? cur.cnt : 0) + 1,
    amount: (same ? cur.amount : 0) + amount,
    at: same && cur.at ? cur.at : Date.now(),
  });
}

const LP_HOUR_TIMER_PREFIX = "cheeseLogPowerHourTimer:";
async function lpClearOtherChannels(activeChannelId) {
  try {
    // 1) 다른 채널의 적립 '표시'만 끄고 추적은 유지한다(삭제하면 판정이 이 채널로
    //    옮겨와도 재추적되지 않음). LOG_POWER_LIVE_ENDED 로 현재 떠 있는 적립 중 표시를
    //    지우되, background 추적/알람은 살려 다음 주기에 이 채널의 적립을 계속 감지한다.
    const sess = await chrome.storage.session.get(null);
    const others = [];
    for (const key of Object.keys(sess || {})) {
      if (!key.startsWith(LP_WATCH_STATE_PREFIX)) continue;
      const cid = key.slice(LP_WATCH_STATE_PREFIX.length);
      if (!cid || cid === activeChannelId) continue;
      others.push(cid);
      await lpDeactivateWatchState(cid); // 내부에서 status(active:false) broadcast
    }
    // 2) 다른 채널의 1시간 타이머는 '일시정지'한다.
    //    ⚠ 예전엔 키를 지웠는데, 그러면 잠깐 다른 채널을 보고 돌아와도 타이머가
    //      처음부터 다시 시작됐다. 치지직은 시청 시간을 누적으로 세므로(실측: 채널을
    //      옮겼다 돌아오면 이어서 1시간이 찬다) 남은 시간을 보존해야 맞다(제보).
    //      leftAt 을 찍어 두면 content 의 restoreWatchHourTimer 가 그 시점부터 재개한다.
    //    ⚠ 예전엔 storage.local 전체(get(null))를 읽었다. 이 함수는 5분 보상마다
    //      호출되는데 local 에는 통나무파워 내역이 통째로 들어 있어, 기록이 쌓일수록
    //      5분마다 수 MB 를 직렬화하게 된다. 추적 중인 채널의 키만 콕 집어 읽는다.
    //      (others 는 위에서 이미 activeChannelId 를 뺀 목록이다.)
    if (!others.length) return;
    const timerKeys = others.map((cid) => `${LP_HOUR_TIMER_PREFIX}${cid}`);
    const loc = await chrome.storage.local.get(timerKeys);
    const paused = {};
    const now = Date.now();
    for (const key of timerKeys) {
      const cur = loc?.[key];
      if (cur == null) continue;
      const cid = key.slice(LP_HOUR_TIMER_PREFIX.length);
      const obj =
        cur && typeof cur === "object" ? cur : { endsAt: Number(cur) };
      const endsAt = Number(obj.endsAt) || 0;
      // 이미 일시정지된 것은 leftAt 을 덮지 않는다(이탈 시간이 초기화된다).
      if (!endsAt || Number(obj.leftAt) > 0) continue;
      if (endsAt <= now) continue; // 만료된 키는 그대로 둔다(복원 때 정리)
      paused[key] = { endsAt, leftAt: now };
      lpBroadcast({ type: "LOG_POWER_LIVE_ENDED", channelId: cid });
    }
    if (Object.keys(paused).length) await chrome.storage.local.set(paused);
  } catch {}
}

// 주기 알람 — 보유량 delta로 적립 판정.
async function lpCheckProgress(channelId) {
  const state = await lpGetWatchState(channelId);
  if (!state) {
    try {
      await chrome.alarms.clear(lpWatchAlarmName(channelId));
    } catch {}
    return;
  }
  const now = Date.now();
  // 라이브 종료면 정리(null=불확실은 계속 진행).
  const live = await lpIsChannelLive(channelId);
  if (live === false) {
    await lpClearWatchState(channelId);
    await lpFlushRun(); // 방송이 끝났다 → 쌓인 연속분 확정
    lpBroadcast({ type: "LOG_POWER_LIVE_ENDED", channelId });
    return;
  }
  // 라이브가 살아있으면(true) 추적 상한(startedAt)을 리셋한다. LP_WATCH_MAX_MS 는
  // '라이브 종료를 못 감지한 채 무한 추적'을 막는 안전장치일 뿐인데, 라이브가 계속
  // 켜져 있으면 실제 시청 중이므로 끊으면 안 된다(75분 넘게 보면 적립 추적이 세션에서
  // 사라지던 원인). live===null(불확실)일 때만 상한을 유지해, 라이브 상태를 계속
  // 확인 못 하는 상황에서만 최대 75분 뒤 정리한다.
  if (live === true) {
    if (now - Number(state.startedAt || now) > LP_WATCH_MAX_MS / 2) {
      // 상한의 절반이 지나면 startedAt 을 당겨(리셋) 라이브 동안엔 안 끊기게.
      state.startedAt = now;
      await lpSetWatchState(channelId, state);
    }
  } else if (now - Number(state.startedAt || now) > LP_WATCH_MAX_MS) {
    // live 불확실(null)한 상태로 상한 초과 → 안전상 정리.
    await lpClearWatchState(channelId);
    await lpFlushRun();
    lpBroadcast(lpStateToStatus(state, false));
    return;
  }
  const amount = await lpFetchAmount(channelId);
  if (!Number.isFinite(amount)) return; // 누락 → 판정 스킵
  const delta = amount - Number(state.lastAmount || 0);
  const targets = state.expectedAmount
    ? [state.expectedAmount]
    : LP_WATCH_AMOUNTS;
  const wasActive = Number(state.activeUntil || 0) > now;
  const next = { ...state, lastAmount: amount };
  // 1시간 달성 주기: 5분+1시간이 한꺼번에 들어온다. 5분분만 run 에 넣고,
  // 1시간 보상은 content.js 가 claims 로 따로 기록한다(여기서 세면 이중 계상).
  const comboFive = LP_WATCH_COMBO.get(delta);
  if (comboFive != null) {
    next.activeUntil = now + LP_WATCH_ACTIVE_TTL_MS;
    next.misses = 0;
    await lpSetWatchState(channelId, next);
    await lpNoteFiveMin(channelId, comboFive);
    // 1시간이 찼으니 여기서 한 묶음이 끝난다 → 쌓인 5분분을 확정한다.
    await lpFlushRun();
    await lpClearOtherChannels(channelId);
    lpBroadcast(lpStateToStatus(next, true));
    return;
  }
  if (targets.includes(delta)) {
    next.activeUntil = now + LP_WATCH_ACTIVE_TTL_MS;
    next.misses = 0;
    await lpSetWatchState(channelId, next);
    // 연속 5분 보상 누적. 채널이 바뀌면 여기서 이전 채널분이 확정된다.
    await lpNoteFiveMin(channelId, delta);
    // 이 채널이 활성 적립 채널로 확정됨 → 다른 채널의 적립·1시간 타이머 정리.
    await lpClearOtherChannels(channelId);
    lpBroadcast(lpStateToStatus(next, true));
    return;
  }
  // ⚠ 절전·잠자기에서 깨면 그 사이 폴링이 멈춰 있어 보상이 여러 번 쌓인 채로
  //   온다(제보: 27분 자고 나니 delta 72 = 6회분). 단일 값·콤보만 보던 예전에는
  //   이 delta 를 놓쳐 '기타 적립'으로 샜다. 단가의 배수면 그 횟수만큼 인정한다.
  //   ⚠ 콤보(132 등)는 위에서 이미 처리했다 — 순서를 바꾸면 안 된다.
  const unit = state.expectedAmount || 0;
  // 자는 동안 1시간이 차면 '1시간 보상 + 5분 n회'가 한꺼번에 온다.
  // 1시간분을 떼어내고 남는 게 단가의 배수면 그만큼을 5분 보상으로 인정한다
  // (1시간 보상 자체는 content.js 가 claims 로 따로 기록한다).
  const hourUnit = unit > 0 ? unit * 10 : 0;
  if (hourUnit > 0 && delta > hourUnit) {
    const rest = delta - hourUnit;
    if (rest > 0 && rest % unit === 0 && rest / unit <= 12) {
      next.activeUntil = now + LP_WATCH_ACTIVE_TTL_MS;
      next.misses = 0;
      await lpSetWatchState(channelId, next);
      await lpNoteFiveMin(channelId, rest);
      await lpFlushRun(); // 1시간이 찼으니 한 묶음이 끝난다
      await lpClearOtherChannels(channelId);
      lpBroadcast(lpStateToStatus(next, true));
      return;
    }
  }
  if (unit > 0 && delta > 0 && delta % unit === 0) {
    const ticks = delta / unit;
    // 1시간(12회)까지만 인정한다. 그 이상이면 다른 적립이 섞였다고 본다.
    // ⚠ 미구독(단가 10)에서는 후원 20·구독선물 50 도 배수라 시청 보상으로 보일 수
    //   있다. 다만 그 둘은 logPowerDonate.js 가 요청을 직접 잡아 따로 기록하므로
    //   여기서 겹쳐도 중복이 되지는 않는다(보유량 차액이 이미 설명된 상태).
    if (ticks <= 12) {
      next.activeUntil = now + LP_WATCH_ACTIVE_TTL_MS;
      next.misses = 0;
      await lpSetWatchState(channelId, next);
      await lpNoteFiveMin(channelId, delta);
      await lpClearOtherChannels(channelId);
      lpBroadcast(lpStateToStatus(next, true));
      return;
    }
  }
  next.misses = Number(state.misses || 0) + 1;
  if (next.misses >= LP_WATCH_MISS_LIMIT) next.activeUntil = 0;
  await lpSetWatchState(channelId, next);
  if (wasActive && Number(next.activeUntil || 0) <= now) {
    // 적립이 끊겼다 → 쌓인 연속분을 확정한다. 여기서 안 하면 다른 채널을 볼
    // 때까지(며칠 뒤일 수도) 기록이 안 남는다.
    await lpFlushRun();
    lpBroadcast(lpStateToStatus(next, false));
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!masterEnabled) return;
  const channelId = lpChannelIdFromAlarm(alarm?.name);
  if (channelId) void lpCheckProgress(channelId);
});

// ── 카페 나우: 치지직 클립 메타데이터(스트리머/제목/썸네일) ─────────────────────
// cafe.naver.com 게시글의 클립 링크를 인라인 재생할 때, 오글링크 제목/썸네일 보정용
// 메타를 받아온다(치즈 카페 나우 이식). content 는 확장 도메인이 달라 직접 fetch 대신
// background 로 요청한다.
const CAFE_CLIP_PLAY_INFO_PREFIX =
  "https://api.chzzk.naver.com/service/v1/play-info/clip/";
const CAFE_CLIP_DETAIL_PREFIX = "https://api.chzzk.naver.com/service/v1/clips/";
const clipVaultMetricCache = new Map();

function setClipVaultMetricCache(clipUID, value) {
  if (clipVaultMetricCache.has(clipUID)) {
    clipVaultMetricCache.delete(clipUID);
  }
  clipVaultMetricCache.set(clipUID, value);
  while (clipVaultMetricCache.size > CLIP_VAULT_METRIC_CACHE_MAX) {
    const oldest = clipVaultMetricCache.keys().next().value;
    if (oldest === undefined) break;
    clipVaultMetricCache.delete(oldest);
  }
}

async function fetchClipVaultPlayInfo(clipUID) {
  const response = await fetchWithTimeout(
    `${CAFE_CLIP_PLAY_INFO_PREFIX}${encodeURIComponent(clipUID)}`,
    {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" },
    },
    CLIP_VAULT_METRIC_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`클립 상세 API 요청 실패: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const content = payload?.content;
  if (Number(payload?.code) !== 200 || !content) {
    throw new Error(payload?.message || "클립 상세 정보를 읽을 수 없습니다.");
  }
  const contentId = String(content.contentId || "").trim();
  if (contentId && contentId !== clipUID) {
    throw new Error("클립 재생 정보가 요청한 클립과 다릅니다.");
  }
  const videoId = String(content.videoId || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(videoId)) {
    throw new Error("클립 미디어 ID를 읽을 수 없습니다.");
  }
  const playCount = Number(content.readCount ?? content.viewCount);
  return {
    videoId,
    ...(Number.isFinite(playCount)
      ? { playCount: Math.max(0, Math.round(playCount)) }
      : {}),
  };
}

async function fetchClipVaultCreatorMetric(clipUID, videoId) {
  const url = new URL(`${CREATORHUB_CLIP_CARD_API_BASE}/clipviewer/card`);
  url.searchParams.set("userInteraction", "false");
  url.searchParams.set("seedType", "SPECIFIC");
  url.searchParams.set("serviceType", "CHZZK");
  url.searchParams.set("seedMediaId", videoId);
  url.searchParams.set("mediaType", "SHORT_FORM");
  url.searchParams.set("panelType", "sdk_chzzk");
  url.searchParams.set(
    "referer",
    `https://chzzk.naver.com/clips/${encodeURIComponent(clipUID)}`,
  );
  url.searchParams.set("recType", "CHZZK");
  url.searchParams.set(
    "recId",
    JSON.stringify({
      seedClipUID: clipUID,
      fromType: "GLOBAL",
      listType: "RECOMMEND",
    }),
  );
  url.searchParams.set("enableReverse", "false");
  url.searchParams.set("adAllowed", "false");
  url.searchParams.set("clickNsc", "chzzk_url_clip");
  url.searchParams.set("clickArea", "clip_item");
  url.searchParams.set("deviceType", "html5_mo");
  url.searchParams.set("profileOverride", "false");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      credentials: "include",
      headers: { accept: "application/json, text/plain, */*" },
    },
    CLIP_VAULT_METRIC_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`CreatorHub 클립 요청 실패: HTTP ${response.status}`);
  }
  const payload = await response.json();
  const content = payload?.body?.card?.content;
  if (
    Number(payload?.header?.code) !== 0 ||
    String(content?.contentId || "").trim() !== clipUID
  ) {
    throw new Error("CreatorHub 클립 응답을 확인할 수 없습니다.");
  }
  const playCount = Number(content.count ?? content.vod?.count);
  if (!Number.isFinite(playCount)) {
    throw new Error("정확한 클립 재생 수를 읽을 수 없습니다.");
  }
  const likeReaction = Array.isArray(content?.interaction?.like?.reactions)
    ? content.interaction.like.reactions.find(
        (reaction) => reaction?.reactionType === "like",
      )
    : null;
  const likeCount = Number(likeReaction?.count);
  return {
    videoId,
    playCount: Math.max(0, Math.round(playCount)),
    ...(Number.isFinite(likeCount)
      ? { likeCount: Math.max(0, Math.round(likeCount)) }
      : {}),
  };
}

function normalizeClipVaultMetricDescriptor(raw) {
  const clipUID = String(
    typeof raw === "string" ? raw : raw?.clipUID || raw?.uid || "",
  ).trim();
  if (!/^[\w-]{6,64}$/.test(clipUID)) return null;
  const rawVideoId = String(
    typeof raw === "object" ? raw?.videoId || "" : "",
  ).trim();
  const rawPlayCount = Number(
    typeof raw === "object" ? raw?.apiPlayCount : NaN,
  );
  return {
    clipUID,
    videoId: /^[0-9a-f]{40}$/i.test(rawVideoId) ? rawVideoId : "",
    ...(Number.isFinite(rawPlayCount)
      ? { apiPlayCount: Math.max(0, Math.round(rawPlayCount)) }
      : {}),
  };
}

function clipVaultMetricResult(clipUID, cached, now) {
  return {
    clipUID,
    ...(/^[0-9a-f]{40}$/i.test(String(cached.videoId || ""))
      ? { videoId: cached.videoId }
      : {}),
    ...(Number.isFinite(cached.playCount)
      ? {
          playCount: cached.playCount,
          playCountFetchedAt: cached.playCountFetchedAt,
        }
      : {}),
    ...(Number.isFinite(cached.likeCount)
      ? {
          likeCount: cached.likeCount,
          likeCountFetchedAt: cached.likeCountFetchedAt,
        }
      : {}),
    nextRetryAt: Math.min(
      Number(cached.playExpiresAt || now),
      Number(cached.likeExpiresAt || now),
    ),
  };
}

async function fetchClipVaultMetric(descriptor, forceRefresh = false) {
  const clipUID = descriptor.clipUID;
  const now = Date.now();
  const cached = clipVaultMetricCache.get(clipUID) || {};
  if (descriptor.videoId) cached.videoId = descriptor.videoId;
  const playFresh = !forceRefresh && Number(cached.playExpiresAt || 0) > now;
  const likeFresh = !forceRefresh && Number(cached.likeExpiresAt || 0) > now;
  if (playFresh && likeFresh) {
    return clipVaultMetricResult(clipUID, cached, now);
  }

  const next = { ...cached };
  let playInfoMetric = null;
  let creatorMetric = null;
  try {
    if (!next.videoId) {
      playInfoMetric = await fetchClipVaultPlayInfo(clipUID);
      next.videoId = playInfoMetric.videoId;
    }
    creatorMetric = await fetchClipVaultCreatorMetric(clipUID, next.videoId);
  } catch {}

  const resolvedPlayCount = Number.isFinite(creatorMetric?.playCount)
    ? creatorMetric.playCount
    : Number.isFinite(playInfoMetric?.playCount)
      ? playInfoMetric.playCount
      : descriptor.apiPlayCount;
  if (Number.isFinite(resolvedPlayCount)) {
    next.playCount = resolvedPlayCount;
    next.playCountFetchedAt = now;
    next.playExpiresAt = now + CLIP_VAULT_METRIC_CACHE_TTL_MS;
  } else if (!playFresh) {
    next.playExpiresAt = now + CLIP_VAULT_METRIC_FAILURE_CACHE_TTL_MS;
  }

  if (Number.isFinite(creatorMetric?.likeCount)) {
    next.likeCount = creatorMetric.likeCount;
    next.likeCountFetchedAt = now;
    next.likeExpiresAt = now + CLIP_VAULT_METRIC_CACHE_TTL_MS;
  } else if (!likeFresh) {
    try {
      next.likeCount = await fetchClipLikeCount({ clipUID });
      next.likeCountFetchedAt = now;
      next.likeExpiresAt = now + CLIP_VAULT_METRIC_CACHE_TTL_MS;
    } catch {
      next.likeExpiresAt = now + CLIP_VAULT_METRIC_FAILURE_CACHE_TTL_MS;
    }
  }
  setClipVaultMetricCache(clipUID, next);
  return clipVaultMetricResult(clipUID, next, now);
}

async function fetchClipVaultMetrics(rawDescriptors, forceRefresh = false) {
  const descriptors = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawDescriptors) ? rawDescriptors : []) {
    const descriptor = normalizeClipVaultMetricDescriptor(raw);
    if (!descriptor || seen.has(descriptor.clipUID)) continue;
    seen.add(descriptor.clipUID);
    descriptors.push(descriptor);
    if (descriptors.length >= CLIP_VAULT_METRIC_BATCH_MAX) break;
  }
  return mapWithConcurrency(
    descriptors,
    CLIP_VAULT_METRIC_CONCURRENCY,
    (descriptor) => fetchClipVaultMetric(descriptor, forceRefresh),
  );
}

function cafeNormalizeClipPlayInfo(payload) {
  const content = payload?.content;
  if (Number(payload?.code) !== 200 || !content) return null;
  const ownerChannel = content.ownerChannel || {};
  const channelName = String(ownerChannel.channelName || "").trim();
  return {
    streamerName: channelName,
    channelName,
    channelId: String(ownerChannel.channelId || "").trim(),
    title: String(content.contentTitle || "").trim(),
    adult:
      content.adult === true ||
      String(content.adult || "").toLowerCase() === "true",
    adultKnown: true,
  };
}
function cafeNormalizeClipDetail(payload) {
  const content = payload?.content;
  if (Number(payload?.code) !== 200 || !content) return null;
  return {
    thumbnailImageUrl: String(content.thumbnailImageUrl || "").trim(),
    title: String(content.clipTitle || "").trim(),
    adult:
      content.adult === true ||
      String(content.adult || "").toLowerCase() === "true",
    adultKnown: true,
  };
}
async function cafeFetchClipPlayInfo(clipId) {
  const res = await fetch(
    `${CAFE_CLIP_PLAY_INFO_PREFIX}${encodeURIComponent(clipId)}`,
    { credentials: "include", headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`clip play-info HTTP ${res.status}`);
  return cafeNormalizeClipPlayInfo(await res.json());
}
async function cafeFetchClipDetail(clipId) {
  const res = await fetch(
    `${CAFE_CLIP_DETAIL_PREFIX}${encodeURIComponent(clipId)}/detail`,
    { credentials: "include", headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`clip detail HTTP ${res.status}`);
  return cafeNormalizeClipDetail(await res.json());
}
async function cafeFetchClipMetadata(clipId) {
  const [playInfo, detail] = await Promise.allSettled([
    cafeFetchClipPlayInfo(clipId),
    cafeFetchClipDetail(clipId),
  ]);
  const p = playInfo.status === "fulfilled" ? playInfo.value : null;
  const d = detail.status === "fulfilled" ? detail.value : null;
  if (!p && !d) return null;
  return {
    streamerName: p?.streamerName || "",
    channelName: p?.channelName || p?.streamerName || "",
    channelId: p?.channelId || "",
    title: p?.title || d?.title || "",
    thumbnailImageUrl: d?.thumbnailImageUrl || "",
    adult: p?.adult === true || d?.adult === true,
    // 상세 정보 요청이 성공했다면 adult 필드가 생략된 응답도 일반 클립으로 취급한다.
    adultKnown: true,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  // chrome:// URL 은 페이지에서 열 수 없다(링크·window.open 모두 차단). 확장에서만
  // chrome.tabs.create 로 열 수 있어, 콘텐츠 스크립트의 요청을 여기서 대신 처리한다.
  // 안전을 위해 미리 허용한 설정 페이지만 연다(임의 URL 열기 방지).
  if (message.type === "CHEESE_OPEN_SETTINGS_PAGE") {
    const ALLOWED = new Set(["chrome://settings/content/sound"]);
    const url = String(message.url || "");
    if (!ALLOWED.has(url)) {
      sendResponse?.({ ok: false });
      return false;
    }
    chrome.tabs.create({ url }).then(
      () => sendResponse?.({ ok: true }),
      () => sendResponse?.({ ok: false }),
    );
    return true; // 비동기 응답
  }

  if (message.type === "CHEESE_MASTER_SET") {
    masterEnabled = message.enabled !== false;
    chrome.storage.local
      .set({ [MASTER_ENABLED_KEY]: masterEnabled })
      .then(() =>
        showRefreshNoticeOnExtensionTabs(
          masterEnabled ? "master-enabled" : "master-disabled",
        ),
      )
      .then((notified) => sendResponse({ ok: true, notified }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "CHEESE_SHOW_REFRESH_NOTICE") {
    showRefreshNoticeOnExtensionTabs(message.reason || "settings")
      .then((notified) => sendResponse({ ok: true, notified }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (!masterEnabled) {
    sendResponse({ ok: false, disabled: true });
    return false;
  }

  // 팔로우 미리보기가 hls.js 를 처음 필요로 할 때 요청. 이 탭의 ISOLATED world 에
  // 지연 주입한다(상시 로드 안 해 모든 페이지 LCP 개선). content.js 스코프에 Hls 정의됨.
  if (message.type === "CHEESE_LOAD_HLS") {
    const tabId = sender?.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.scripting
      .executeScript({
        target: { tabId },
        files: ["src/hls.min.js"],
        world: "ISOLATED",
      })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // 비동기 응답
  }

  if (message.type === "CHZZK_CAFE_NOW_GET_CLIP_METADATA") {
    const clipId = message.clipId || message.mediaId || "";
    if (!clipId) {
      sendResponse({ metadata: null });
      return false;
    }
    cafeFetchClipMetadata(clipId)
      .then((metadata) => sendResponse({ metadata }))
      .catch(() => sendResponse({ metadata: null }));
    return true; // 비동기 응답
  }

  if (message.type === "CHEESE_CLIP_VAULT_GET_METADATA") {
    const clipUID = String(message.clipUID || "").trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(clipUID)) {
      sendResponse({ ok: false, error: "올바르지 않은 클립 ID입니다." });
      return false;
    }
    cafeFetchClipMetadata(clipUID)
      .then((metadata) => {
        if (!metadata) {
          sendResponse({ ok: false, error: "클립 정보를 찾지 못했습니다." });
          return;
        }
        sendResponse({ ok: true, result: metadata });
      })
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_CLIP_VAULT_REFRESH_METRICS") {
    fetchClipVaultMetrics(
      message.clipItems || message.clipUIDs,
      message.forceRefresh === true,
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_CLIP_VAULT_IMPORT_FOLLOWING_LIKES") {
    runClipVaultFollowingImportJob(message.jobId, (signal) =>
      importClipVaultFollowingLikes(
        message.knownClipUIDs,
        message.startChannelIndex,
        message.startClipCursor,
        signal,
      ),
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_CLIP_VAULT_RETRY_FOLLOWING_LIKES") {
    runClipVaultFollowingImportJob(message.jobId, (signal) =>
      retryClipVaultFollowingLikes(message.clipItems, signal),
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_CLIP_VAULT_CANCEL_FOLLOWING_LIKES") {
    sendResponse({
      ok: true,
      result: {
        cancelled: cancelClipVaultFollowingImportJob(message.jobId),
      },
    });
    return false;
  }

  // 통나무 파워 지우개(game.naver.com/profile): 전체 보유 목록을 background 로 fetch.
  // content 는 game.naver.com 도메인이라 api.chzzk.naver.com 직접 fetch 대신 위임한다.
  if (message.type === "GET_LOG_POWER_BALANCES") {
    fetch("https://api.chzzk.naver.com/service/v1/log-power/balances", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => sendResponse({ success: true, data }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true; // 비동기 응답
  }

  if (message.type === "START_LOG_POWER_WATCH_REWARD_TRACKING") {
    lpStartTracking({
      channelId: message.channelId,
      initialAmount: message.initialAmount,
    })
      .then((status) => sendResponse({ status }))
      .catch(() => sendResponse({ status: null }));
    return true;
  }

  if (message.type === "GET_LOG_POWER_WATCH_REWARD_STATUS") {
    lpGetWatchState(message.channelId)
      .then((state) =>
        sendResponse({ status: state ? lpStateToStatus(state) : null }),
      )
      .catch(() => sendResponse({ status: null }));
    return true;
  }

  // 통나무파워 1시간 획득을 다른 치지직 탭에도 알린다. 획득한 탭(sender)은 이미 자기
  // 토스트를 띄웠으므로 제외하고, 나머지 탭에 broadcast한다(수신 탭이 '보이는 탭 +
  // claimId 처음'일 때만 실제로 띄운다).
  if (message.type === "CHEESE_LOG_POWER_CLAIMED") {
    lpBroadcast(
      {
        type: "LOG_POWER_CLAIMED_TOAST",
        claimId: message.claimId,
        amount: message.amount,
        channelName: message.channelName,
      },
      sender?.tab?.id,
    );
    return false;
  }

  // 탭 음소거 토글/조회 — 콘텐츠는 chrome.tabs.update를 못 쓰므로 background에서
  // sender.tab.id로 처리한다. action: "toggle" | "query". muted 상태를 응답.
  if (message.type === "CHEESE_TAB_MUTE") {
    const tabId = sender?.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false });
      return false;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ ok: false });
        return;
      }
      const current = Boolean(tab.mutedInfo?.muted);
      if (message.action === "query") {
        sendResponse({ ok: true, muted: current });
        return;
      }
      const next = !current;
      chrome.tabs.update(tabId, { muted: next }, () => {
        sendResponse({ ok: !chrome.runtime.lastError, muted: next });
      });
    });
    return true; // 비동기 응답
  }

  // 스크린샷 저장 — 콘텐츠/MAIN은 chrome.downloads를 못 쓰므로 background에서 처리한다.
  // saveAs:false 로 브라우저 '저장 위치 확인' 설정과 무관하게 바로 저장하고, 실제
  // 완료/취소(state)를 downloads.onChanged로 감지해 정확히 응답한다.
  if (message.type === "CHEESE_SCREENSHOT_SAVE") {
    const { url, filename } = message;
    const saveAs = message.saveAs === true; // 기본 false=바로 저장
    // data:(바로 저장용) 또는 blob:(대화상자용, content가 변환) URL만 허용.
    if (
      typeof url !== "string" ||
      !(url.startsWith("data:image") || url.startsWith("blob:"))
    ) {
      sendResponse({ ok: false, reason: "invalid" });
      return false;
    }
    try {
      chrome.downloads.download({ url, filename, saveAs }, (downloadId) => {
        if (chrome.runtime.lastError || downloadId == null) {
          sendResponse({ ok: false, reason: "start-failed" });
          return;
        }
        // 완료/중단(취소)까지 기다렸다가 결과를 알려준다.
        let settled = false;
        const onChanged = (delta) => {
          if (delta.id !== downloadId || !delta.state) return;
          const s = delta.state.current;
          if (s === "complete") {
            finish({ ok: true, saved: true });
          } else if (s === "interrupted") {
            finish({ ok: true, saved: false }); // 사용자가 취소 등
          }
        };
        const finish = (result) => {
          if (settled) return;
          settled = true;
          chrome.downloads.onChanged.removeListener(onChanged);
          sendResponse(result);
        };
        chrome.downloads.onChanged.addListener(onChanged);
        // 혹시 onChanged가 안 오는 환경 대비 타임아웃. saveAs(대화상자)는 사용자가
        // 오래 열어둘 수 있어 넉넉히(5분), 바로 저장은 짧게(15초). 타임아웃 응답은
        // '시작됨'만 알 뿐 저장 확정이 아니므로 saved는 단정하지 않고 미상 처리.
        const timeoutMs = saveAs ? 300000 : 15000;
        setTimeout(() => finish({ ok: true, saved: true }), timeoutMs);
      });
    } catch {
      sendResponse({ ok: false, reason: "exception" });
    }
    return true; // 비동기 응답
  }

  if (message.type === "CHEESE_SEARCH_FETCH_VIDEOS") {
    fetchAllVideosShared(message.payload, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_FETCH_CLIPS") {
    const request = { ...(message.payload || {}), contentType: "clips" };
    handleFetchClipsMessage(request, sender, sendResponse);
    return true;
  }

  if (message.type === "CHEESE_SEARCH_ENRICH_CLIP_CATEGORIES") {
    enrichClipCategoryDescriptors(message.payload?.categories)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_ENRICH_CLIP_TAGS") {
    enrichClipTagDescriptors(message.payload?.clips)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_FETCH_MAKE_CLIPS") {
    const abortController = new AbortController();
    fetchAllMakeClips({
      ...(message.payload || {}),
      signal: abortController.signal,
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_DELETE_MAKE_CLIP") {
    deleteMakeClip(message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_FIND_CHANNEL") {
    fetchExactChannelByNicknameQueued(message.payload?.nickname)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_VALIDATE_CHANNEL") {
    validateSearchedChannel(
      message.payload?.candidate,
      message.payload?.keyword,
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_RESUBSCRIBE") {
    const payload = message.payload || {};
    const request = {
      ...payload,
      contentType: payload.contentType || "videos",
    };
    const result = tryResubscribeInFlight(request, sender);
    sendResponse({ ok: true, result });
    return false;
  }

  if (message.type === "CHEESE_SEARCH_CANCEL_FETCH") {
    const result = cancelFetchSubscription(message.payload?.requestId);
    sendResponse({ ok: true, result });
    return false;
  }

  if (message.type === "CHEESE_SEARCH_PEEK_CACHE") {
    const payload = message.payload || {};
    peekCacheValue(payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_FETCH_COMMENT_TIMESTAMPS") {
    fetchCommentTimestamps(message.payload?.videoNo)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  return false;
});

async function handleFetchClipsMessage(request, sender, sendResponse) {
  if (!request.forceRefresh) {
    try {
      const cachedResult = await peekCacheValue({
        contentType: "clips",
        channelId: request.channelId,
        filterType: request.filterType,
        orderType: request.orderType,
        sort: request.sort,
      });
      if (cachedResult) {
        sendResponse({ ok: true, result: cachedResult });
        return;
      }
    } catch {
      // fall through to async fetch
    }
  }
  fetchAllVideosShared(request, sender).catch(() => {});
  sendResponse({
    ok: true,
    result: {
      accepted: true,
      contentType: "clips",
      requestId: request.requestId || "",
    },
  });
}

async function peekCacheValue(payload) {
  const isClipSearch = payload.contentType === "clips";
  const key = isClipSearch
    ? clipCacheKey({
        channelId: payload.channelId,
        filterType: payload.filterType,
        orderType: payload.orderType,
      })
    : cacheKey({
        channelId: payload.channelId,
        contentType: payload.contentType,
        videoType: payload.videoType,
        sortType: payload.sortType,
      });
  const cached = await readCache(key);
  if (!cached?.value) return null;
  const now = Date.now();
  if (now - cached.createdAt >= CACHE_TTL_MS) return null;
  if (isClipSearch) {
    // peek must stay lightweight — category enrichment already happened at
    // fetch time and is persisted via CLIP_PERSIST_FIELDS, so we just read.
    const activeClips = getActiveClips(cached.value.clips);
    if (!activeClips.length) return null;
    if (
      getSortMetricType(payload.sort) === "likes" &&
      !hasMetricForEveryItem(activeClips, "likeCount")
    ) {
      return null;
    }
    const { allClips: _allClips, ...publicValue } = cached.value;
    return { ...publicValue, clips: activeClips, fromCache: true };
  }
  if (!Array.isArray(cached.value.videos) || !cached.value.videos.length) {
    return null;
  }
  if (
    getSortMetricType(payload.sort) === "comments" &&
    !hasMetricForEveryItem(cached.value.videos, "commentCount")
  ) {
    return null;
  }
  return { ...cached.value, fromCache: true };
}
