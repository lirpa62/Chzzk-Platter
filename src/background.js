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
    console.warn("[치즈 플래터] cache hydration failed", error);
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
        console.warn("[치즈 플래터] cache persist failed", error);
        await removeChunkedStorageEntries(key);
        return;
      }
      const evicted = await evictOldestCacheEntry(key);
      if (!evicted) {
        console.info(
          "[치즈 플래터] storage quota exhausted — keeping cache in memory only",
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
      console.warn("[치즈 플래터] channel cache persist failed", error);
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
        "[치즈 플래터] aborting fetch — last subscriber cancelled",
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
// ⚠ 저장 실패를 삼키면 lastAmount 가 안 올라가 다음 주기에 같은 차액을 또
//   적립으로 센다. 성공 여부를 돌려준다.
async function lpSetWatchState(channelId, state) {
  try {
    await chrome.storage.session.set({ [lpWatchStateKey(channelId)]: state });
    return true;
  } catch {
    return false;
  }
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
async function lpStartTracking({ channelId, initialAmount, accountHint }) {
  if (!channelId) return null;
  const now = Date.now();
  // ⚠ 힌트가 캐시와 다르면 계정이 바뀐 것이다(캐시는 최대 5분 묵는다).
  const { accountId: me } = await lpAccountFor(accountHint);
  const existing = await lpGetWatchState(channelId);
  const existingOwner = String(existing?.accountId || "");
  // ⚠ 소유자가 분명한 상태가 있는데 지금 계정을 확인하지 못했다면 아무것도 하지
  //   않는다. 그대로 진행하면 accountId: null 로 덮어써 '누구 기준인지 모르는'
  //   상태가 되고, 이후 적립이 엉뚱한 계정에 귀속된다(모르면 미룬다).
  if (!me && LP_ACCOUNT_RE.test(existingOwner)) {
    return lpStateToStatus(existing);
  }
  // 다른 계정이 만든 상태는 재사용하지 않는다 — lastAmount·단가가 남의 기준이다.
  // ⚠ 계정 구분 전(업데이트 직후 남은 세션 상태)은 accountId 가 비어 있다. 누가
  //   만든 기준인지 알 수 없으므로, 지금 계정을 아는 경우엔 물려받지 말고 한 번
  //   다시 기준을 잡는다(남의 lastAmount 를 쓰면 차액이 통째로 어긋난다).
  const sameOwner = me ? existingOwner === me : !existingOwner;
  if (
    existing &&
    sameOwner &&
    now - Number(existing.startedAt || 0) <= LP_WATCH_MAX_MS
  ) {
    // 추적 유지(알람만 보장).
    chrome.alarms.create(lpWatchAlarmName(channelId), {
      delayInMinutes: LP_WATCH_INTERVAL_MIN,
      periodInMinutes: LP_WATCH_INTERVAL_MIN,
    });
    return lpStateToStatus(existing);
  }
  // ⚠ 계정을 모르면 새 상태도 만들지 않는다(accountId: null 상태가 남는다).
  //   기존 상태가 없으면 다음 시작 요청에서 다시 시도한다.
  if (!me) return existing ? lpStateToStatus(existing) : null;
  const expected = await lpFetchExpectedAmount(channelId);
  // baseline: content가 보낸 initialAmount 우선, 없으면 raw 조회.
  // ⚠ 재기준(소유자 불일치)인데 보유량을 못 읽으면 기존 상태를 그대로 둔다 —
  //   남의 기준을 지우기만 하고 새 기준을 못 세우면 판정이 통째로 어긋난다.
  let baseline = Number(initialAmount);
  if (!Number.isFinite(baseline)) baseline = await lpFetchAmount(channelId);
  if (!Number.isFinite(baseline)) {
    return existing ? lpStateToStatus(existing) : null;
  }
  const state = {
    channelId,
    startedAt: now,
    lastAmount: baseline,
    expectedAmount: expected,
    activeUntil: 0,
    misses: 0,
    // 추적을 시작한 계정. 로그인이 바뀌면 lastAmount·expectedAmount 가 남의
    // 계정 기준이 되어 적립 판정이 계속 어긋난다 → 불일치 시 폐기하고 재기준.
    accountId: me,
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

// ── 통나무파워 내역: 단일 작성자 ────────────────────────────────────────────
// ⚠ 예전에는 content·prediction·stats·settings 가 각자 read-modify-write 로
//   같은 키를 고쳤다. 실행 컨텍스트가 달라 락이 없어 동시에 쓰면 나중 것이 앞의
//   것을 덮는다(lost update). 모든 변경을 여기 큐로 모아 직렬화한다.
let lpWriteTail = Promise.resolve();

// 로그 또는 예측 대기 목록이 바뀔 때마다 오른다. 보정(reconcile)은 보유량을 큐
// 밖에서 읽으므로, 읽은 뒤 판정 근거가 바뀌면 차액이 이중으로 계산될 수 있다.
// 세대가 달라졌으면 이번 보정을 건너뛰고 다음 주기에 다시 읽는다.
let lpLogGeneration = 0;

// ⚠ 세대만으로는 부족하다. LP_WRITE 가 도착해 계정을 확인하는 동안에는 아직
//   저장 전이라 세대가 안 오른다. 그런데 그 기록은 '이미 일어난 일'이라 보유량엔
//   벌써 반영돼 있다 → 그 틈에 보정하면 기타 적립으로 오검출된다.
//   요청을 받은 순간부터 저장이 끝날 때까지를 '처리 중'으로 센다.
let lpWriteInFlight = 0;

function lpBeginWrite() {
  lpWriteInFlight += 1;
}

function lpEndWrite() {
  if (lpWriteInFlight > 0) lpWriteInFlight -= 1;
}

// 보정이 보유량을 읽은 뒤 기록이 끼어들었는지 판단한다.
// ⚠ 처리 중 요청은 '늘었는지'가 아니라 '하나라도 있는지'로 봐야 한다. 보정보다
//   먼저 도착해 계정을 확인 중인 요청은 증가분으로는 안 잡히는데, 그 기록은
//   보유량엔 이미 반영돼 있어 그대로 두면 기타 적립으로 오검출된다.
function lpLogMoved(gen0) {
  return lpLogGeneration !== gen0 || lpWriteInFlight > 0;
}

function lpEnqueueWrite(task) {
  const result = lpWriteTail.then(task);
  // 꼬리는 항상 정상 상태로 되돌린다(한 번 실패해도 다음 작업이 막히지 않게).
  lpWriteTail = result.catch(() => {});
  // 호출자는 자기 작업의 실패를 그대로 받는다.
  return result;
}

// 계정 식별. 확인 실패면 null — 호출자가 힌트를 주면 그걸 검증해 쓴다.
const LP_ACCOUNT_RE = /^[0-9a-f]{32}$/i;
const LP_USER_STATUS_URL =
  "https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus";

// ⚠ lpCheckProgress 가 채널마다 1분 주기로 부른다. 계정은 자주 바뀌지 않으므로
//   캐시한다(안 하면 추적 3채널 기준 4,320회/일).
let lpAccountCache = { id: null, at: 0 };
const LP_ACCOUNT_TTL_MS = 5 * 60 * 1000;
// 시청 판정은 보유량과 직접 대조하므로 더 신선한 계정 값이 필요하다.
// (전환 직후 A 로 판단하며 B 의 보유량을 읽는 창을 30초로 줄인다.)
const LP_ACCOUNT_WATCH_TTL_MS = 30 * 1000;

// ⚠ 채널마다 1분 알람이 동시에 깨면 각자 API 를 부른다. 진행 중인 요청을
//   공유해 한 번만 나가게 한다.
let lpAccountInFlight = null;
// ⚠ 공유 요청에는 세대를 붙인다. 요청이 나간 뒤 '계정이 바뀌었다'는 신호(다른
//   힌트)가 오면 그 요청의 결과는 이미 낡은 것이다. 세대가 밀린 응답은 캐시에
//   쓰지 않고 버려, A 요청 결과가 B 작업에 쓰이는 것을 막는다.
let lpAccountGen = 0;
// 콘텐츠가 마지막으로 알려 준 계정. 캐시가 비어 있어도 진행 중 요청보다 새로운
// 힌트가 들어왔는지 판별하는 데 쓴다.
let lpAccountHintSignal = "";
// ⚠ 로그아웃·API 장애 때는 캐시에 넣을 값이 없어 매분 재시도한다. 실패도 짧게
//   기억해 반복 호출을 막는다(짧게 두어 로그인 직후 복구가 늦지 않게).
let lpAccountFailAt = 0;
const LP_ACCOUNT_FAIL_TTL_MS = 30 * 1000;

// 캐시·진행 중 요청·실패 기록을 한꺼번에 무효화한다(계정이 바뀐 신호를 받았을 때).
function lpInvalidateAccount() {
  lpAccountCache = { id: null, at: 0 };
  lpAccountFailAt = 0;
  lpAccountGen += 1;
  lpAccountInFlight = null; // 진행 중 요청의 결과는 세대 검사로 버려진다
}

async function lpFetchAccountId() {
  const now = Date.now();
  if (lpAccountCache.id && now - lpAccountCache.at < LP_ACCOUNT_TTL_MS) {
    return lpAccountCache.id;
  }
  if (now - lpAccountFailAt < LP_ACCOUNT_FAIL_TTL_MS) return null;
  if (lpAccountInFlight) return lpAccountInFlight;
  const gen = lpAccountGen;
  lpAccountInFlight = (async () => {
    try {
      const res = await fetch(LP_USER_STATUS_URL, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const hash = String((await res.json())?.content?.userIdHash || "").trim();
      if (!LP_ACCOUNT_RE.test(hash)) throw new Error("no-hash");
      // ⚠ 요청 도중 계정 전환 신호가 왔다 → 이 결과는 낡았다. 캐시에 넣지 않고
      //   버린다(호출부는 null 을 받아 '모르면 미룬다'로 처리한다).
      if (gen !== lpAccountGen) return null;
      lpAccountCache = { id: hash, at: Date.now() };
      lpAccountFailAt = 0;
      return hash;
    } catch {
      if (gen === lpAccountGen) lpAccountFailAt = Date.now();
      return null;
    } finally {
      if (gen === lpAccountGen) lpAccountInFlight = null;
    }
  })();
  return lpAccountInFlight;
}

// 계정을 정하지 못한 작업은 내역에 넣지 않고 보류한다.
// ⚠ accountId 없이 기록하면 나중에 스냅샷 비교가 그 기록을 '설명된 변동'으로
//   세지 못해 같은 적립이 기타로 한 번 더 기록된다(이중 계상).
const LP_PENDING_WRITES_KEY = "cheeseLogPowerPendingWrites";
// 대상을 못 찾은 보류 작업을 언제까지 다시 시도할지(예측 대기 TTL 과 맞춘다).
// 무한 재시도는 큐에 영영 남는 작업을 만든다.
const LP_PENDING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// 보류돼 있으면 보유량 비교를 막아야 하는 op — '내역에 아직 없는 금액'을 만드는
// 것들이다. MARK_PREDICTION_RESULT(종류만 변경)·DELETE_MANUAL_ENTRY 는 금액
// 합계를 바꾸지 않으므로, 이것 때문에 보정을 멈추면 이중 계상을 막기는커녕
// 자동 감지만 며칠 마비된다.
const LP_PENDING_BLOCKING_OPS = new Set([
  "APPEND_CLAIM",
  "UPSERT_PREDICTION_BET",
  "APPEND_PREDICTION_RESULT",
  "UPSERT_MANUAL_ENTRY",
  "APPEND_AUTO_BATCH",
]);

async function lpAccountFor(hint) {
  const h = String(hint || "")
    .trim()
    .toLowerCase();
  const hinted = LP_ACCOUNT_RE.test(h) ? h : "";
  if (hinted) {
    const hintChanged =
      !!lpAccountHintSignal && lpAccountHintSignal !== hinted;
    // 계정 정보 없이 시작한 요청이 도는 중 처음 힌트를 받았다면, 그 요청은 힌트
    // 이전 쿠키로 전송됐을 수 있다. 결과가 같을 가능성보다 계정 오귀속 방지가
    // 중요하므로 새 세대로 다시 확인한다.
    const unscopedRequest = !lpAccountHintSignal && !!lpAccountInFlight;
    const cacheMismatch =
      !!lpAccountCache.id && lpAccountCache.id !== hinted;
    lpAccountHintSignal = hinted;
    if (hintChanged || unscopedRequest || cacheMismatch) {
      lpInvalidateAccount();
    }
  }
  // ⚠ 힌트는 치지직 페이지가 방금 읽은 값이라 캐시보다 최신이다. 캐시가 다르면
  //   계정이 바뀐 것이므로 캐시·진행 중 요청을 모두 버리고 다시 확인한다
  //   (전환 직후 기록이 이전 계정으로 저장되던 문제).
  const requestGen = lpAccountGen;
  const id = await lpFetchAccountId();
  // 기다리는 동안 다른 계정 힌트가 들어왔다. 이미 받아 둔 id 도 새 호출에 쓰면
  // 안 된다. fetch 쪽 캐시 세대 검사와 별도로 각 대기자도 자기 세대를 확인한다.
  if (requestGen !== lpAccountGen) {
    return { accountId: null, verified: false, mismatch: !!hinted };
  }
  if (id) {
    // ⚠ API 결과와 힌트가 다르다 = 확인 도중 계정이 바뀌었거나 둘 중 하나가
    //   낡았다. 어느 쪽이 맞는지 알 수 없으므로 어느 계정으로도 쓰지 않는다.
    //   다음 확인을 위해 캐시를 버리고 보류로 답한다(모르면 미룬다).
    if (hinted && hinted !== id) {
      lpInvalidateAccount();
      // mismatch: 호출부가 사유를 구분하고 싶을 때 쓴다(현재는 accountId=null
      // 만으로 '보류'가 되므로 모든 호출부가 자동으로 안전하게 동작한다).
      return { accountId: null, verified: false, mismatch: true };
    }
    return { accountId: id, verified: true };
  }
  if (hinted) return { accountId: hinted, verified: false };
  return { accountId: null, verified: false };
}

// 큐 안에서 쓰는 공통 헬퍼: 목록 읽기 → 적용 → 보관기간 정리 → 한 번 저장.
// keepAll: 백업 불러오기처럼 보관기간 정리를 적용하면 안 되는 경우.
// ⚠ 1년 전 백업을 90일 설정으로 불러오면 저장 직후 절반이 지워진다.
async function lpMutateLog(apply, keepAll) {
  const data = await chrome.storage.local.get([LP_LOG_KEY, LP_LOG_DAYS_KEY]);
  const days = keepAll ? 0 : lpNormalizeLogDays(data?.[LP_LOG_DAYS_KEY]);
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const list = Array.isArray(data?.[LP_LOG_KEY]) ? [...data[LP_LOG_KEY]] : [];
  const changed = apply(list);
  if (!changed) return false;
  const next = list
    .filter((it) => (Number(it?.at) || 0) >= cutoff)
    .sort((a, b) => (Number(b?.at) || 0) - (Number(a?.at) || 0));
  await chrome.storage.local.set({ [LP_LOG_KEY]: next });
  lpLogGeneration += 1;
  return true;
}

// 같은 기록인지: 계정까지 봐야 다계정에서 섞이지 않는다.
function lpSameEntry(it, accountId, id) {
  return (
    it?.id === id && String(it?.accountId || "") === String(accountId || "")
  );
}

// 사용자가 직접 고치거나 지우는 경우에 쓴다.
// ⚠ 계정 도입 전 기록은 accountId 가 비어 있다. 엄격히 비교하면 못 찾아서
//   수정이 '새 항목 추가'가 된다(제보: 기타 적립과 5분 시청이 둘 다 남음).
//   같은 id 면 레거시도 같은 기록으로 보고, 수정하면서 현재 계정에 귀속시킨다.
function lpSameOrLegacy(it, accountId, id) {
  if (it?.id !== id) return false;
  const owner = String(it?.accountId || "");
  return owner === String(accountId || "") || owner === "";
}

// 계정을 못 정한 작업은 보류했다가 계정 확인이 복구되면 반영한다.
// ⚠ enqueue 와 drain 이 각자 읽고 덮으면 drain 중 추가된 작업이 사라진다.
//   보류 큐 조작도 직렬화한다.
// 같은 작업인지 판단하는 키. 기록 id 나 예측 총액으로 구분한다.
function lpPendingKey(op, payload, accountId) {
  if (!op) return "";
  const acc = String(accountId || "");
  const id = String(payload?.entry?.id || payload?.id || "");
  if (id) return `${op}:${acc}:${id}`;
  if (payload?.predictionId) {
    return `${op}:${acc}:${payload.predictionId}:${payload.totalBetAmount ?? ""}`;
  }
  return "";
}

let lpPendingTail = Promise.resolve();

function lpWithPendingLock(task) {
  const result = lpPendingTail.then(task);
  lpPendingTail = result.catch(() => {});
  return result;
}

async function lpQueuePending(op, payload, accountHint) {
  return lpWithPendingLock(async () => {
    try {
      const cur = (await chrome.storage.local.get(LP_PENDING_WRITES_KEY))?.[
        LP_PENDING_WRITES_KEY
      ];
      const list = Array.isArray(cur) ? cur : [];
      // ⚠ 계정을 함께 남긴다. 없으면 나중에 로그인한 계정으로 반영된다.
      //   힌트도 없으면 그때 확인되는 계정을 쓸 수밖에 없다.
      const h = String(accountHint || "").toLowerCase();
      const acc = LP_ACCOUNT_RE.test(h) ? h : "";
      // ⚠ 호출부가 최대 세 번 재시도하므로 같은 작업이 여러 번 들어온다.
      //   200개 상한에 걸리면 진짜 오래된 기록이 밀려나므로 중복을 없앤다.
      const key = lpPendingKey(op, payload, acc);
      const next = key
        ? list.filter(
            (j) => lpPendingKey(j?.op, j?.payload, j?.accountId) !== key,
          )
        : list;
      next.push({ op, payload, at: Date.now(), accountId: acc });
      const list2 = next;
      // 무한히 쌓이지 않게 상한을 둔다(오래된 것부터 버린다).
      await chrome.storage.local.set({
        [LP_PENDING_WRITES_KEY]: list2.slice(-200),
      });
    } catch {}
  });
}

// 보류된 작업을 계정이 확인되면 반영한다.
// ⚠ 이게 없으면 보류가 곧 영구 유실이다. 계정 확인 실패가 잠깐이어도
//   그 사이 기록이 영영 안 들어간다.
async function lpDrainPending() {
  return lpWithPendingLock(async () => {
    try {
      const cur = (await chrome.storage.local.get(LP_PENDING_WRITES_KEY))?.[
        LP_PENDING_WRITES_KEY
      ];
      const list = Array.isArray(cur) ? cur : [];
      if (!list.length) return { ok: true, applied: 0, left: 0 };
      const rest = [];
      let done = 0;
      // 소유자를 아는데 아직 못 넣은 작업 수. 보정을 막을지 판단하는 기준이다.
      // ⚠ 소유자 미상 작업은 세지 않는다. 그건 영영 반영되지 않으므로 세면
      //   보정이 TTL(3일) 내내 멈춘다 — 오히려 보유량 비교로 기타 적립에
      //   잡히는 것이 그 금액의 유일한 복구 경로다.
      let blocking = 0;
      for (const job of list) {
        const run = LP_WRITE_OPS[job?.op];
        if (!run) continue; // 모르는 op 는 버린다
        // ⚠ 저장된 계정으로만 반영한다. 소유자를 모르는 작업을 '지금 로그인한
        //   계정'에 넣으면, 그 사이 계정을 바꿨을 때 A 의 기록이 B 에 들어간다.
        //   경과 시간은 소유자를 증명하지 못하므로 시간으로 허용하지 않는다.
        //   (모르면 미룬다 — 다만 영원히 쌓이지 않게 TTL 이 지나면 버린다.)
        const acc = LP_ACCOUNT_RE.test(String(job.accountId || ""))
          ? String(job.accountId)
          : "";
        if (!acc) {
          // 소유자 미상. 되살아날 방법이 없으므로 TTL 이 지나면 폐기한다.
          if (Date.now() - Number(job.at || 0) < LP_PENDING_TTL_MS) {
            rest.push(job); // blocking 에는 세지 않는다
          }
          continue;
        }
        try {
          // ⚠ 정산(MARK_PREDICTION_RESULT)은 대상 BET 줄이 아직 안 들어왔으면
          //   아무것도 못 고치고 끝난다. 그걸 완료로 처리하면 정산 결과가 영영
          //   반영되지 않는다 → 대상을 못 찾았으면 다시 보류한다.
          const ctx = { matched: true };
          // eslint-disable-next-line no-await-in-loop
          await lpEnqueueWrite(() =>
            lpMutateLog((l) => run(l, job.payload || {}, acc, ctx)),
          );
          if (
            ctx.matched === false &&
            Date.now() - Number(job.at || 0) < LP_PENDING_TTL_MS
          ) {
            rest.push(job); // 베팅 기록이 늦게 붙는 중 → 다음 기회에
            if (LP_PENDING_BLOCKING_OPS.has(job.op)) blocking += 1;
            continue;
          }
          done += 1;
        } catch {
          rest.push(job); // 실패한 건 다음 기회에 다시
          if (LP_PENDING_BLOCKING_OPS.has(job.op)) blocking += 1;
        }
      }
      await chrome.storage.local.set({ [LP_PENDING_WRITES_KEY]: rest });
      // ⚠ 남은 작업 수를 함께 돌려준다. 실제 적립이 보류된 채로 보유량을 비교하면
      //   그 금액이 '설명되지 않는 변동'이 되어 기타 적립으로 이중 계상된다.
      return { ok: true, applied: done, left: blocking };
    } catch (error) {
      return {
        ok: false,
        applied: 0,
        left: -1,
        reason: String(error?.message || error),
      };
    }
  });
}

// 내역 항목 정규화. 저장 형태를 한 곳에서만 정한다.
function lpNormalizeEntry(entry, accountId) {
  const amount = Number(entry?.amount) || 0;
  return {
    id: String(entry?.id || "").trim(),
    accountId: String(accountId || ""),
    at: Number(entry?.at) || Date.now(),
    channelId: String(entry?.channelId || ""),
    channelName: String(entry?.channelName || "").slice(0, 100),
    channelImageUrl: String(entry?.channelImageUrl || "").slice(0, 300),
    verifiedMark: entry?.verifiedMark === true,
    amount,
    fiveMinAmount: Number(entry?.fiveMinAmount) || 0,
    boost: Number(entry?.boost) || 1,
    claimType: String(entry?.claimType || "WATCH_1_HOUR").toUpperCase(),
    ...(Number(entry?.watchCount) > 0
      ? { watchCount: Number(entry.watchCount) }
      : {}),
    // ⚠ 5분 묶음은 at(시작)과 실제 적립 시점이 최대 1시간 벌어진다. 보정이
    //   기준 시각과 대조할 때 at 을 쓰면 '기준 이후에 들어온 기록'을 못 세어
    //   같은 금액을 기타 적립으로 또 잡는다(제보: 둥그레 기타 +96).
    //   묶음이 끝난 시각을 함께 남겨 그쪽으로 판정한다.
    ...(Number(entry?.endAt) > 0 ? { endAt: Number(entry.endAt) } : {}),
    // 보유량 비교로 찾아낸 기록. 실제 획득 시각이 아니라 '감지 시각'이라
    // 화면에서 구분해 보여 준다.
    ...(entry?.autoDetected === true ? { autoDetected: true } : {}),
  };
}

// op 별 실제 적용. 전부 큐 안에서 실행된다.
const LP_WRITE_OPS = {
  APPEND_CLAIM(list, p, accountId) {
    const e = lpNormalizeEntry(p.entry, accountId);
    if (!e.id || e.amount === 0) return false;
    if (list.some((it) => lpSameEntry(it, accountId, e.id))) return false;
    list.unshift(e);
    return true;
  },

  // 5분 누적 묶음. 총액(run.amount)을 그대로 반영한다 → 같은 묶음을 다시
  // 저장해도 두 줄이 되지 않고, 초기화 실패로 금액이 더 붙은 경우에도 그
  // 최종 금액으로 맞춰진다(APPEND 였다면 중복으로 무시돼 차액이 사라졌다).
  UPSERT_WATCH_RUN(list, p, accountId) {
    const e = lpNormalizeEntry(p.entry, accountId);
    if (!e.id || e.amount === 0) return false;
    const i = list.findIndex((it) => lpSameEntry(it, accountId, e.id));
    if (i < 0) {
      list.unshift(e);
      return true;
    }
    // 금액·회차가 그대로면 바꿀 것이 없다(불필요한 저장·렌더를 막는다).
    if (
      Number(list[i].amount) === e.amount &&
      Number(list[i].watchCount || 0) === Number(e.watchCount || 0)
    ) {
      return false;
    }
    list[i] = { ...list[i], ...e };
    return true;
  },

  // 총액을 받아 맞춘다 → 재시도해도 두 번 차감되지 않는다.
  UPSERT_PREDICTION_BET(list, p, accountId) {
    const id = `PREDICTION_BET-${p.predictionId}`;
    const total = Number(p.totalBetAmount) || 0;
    if (!p.predictionId || !(total > 0)) return false;
    const hit = list.find((it) => lpSameEntry(it, accountId, id));
    if (!hit) {
      const e = lpNormalizeEntry(
        { ...p.meta, id, amount: -total, at: p.observedAt },
        accountId,
      );
      e.betHistory = [{ at: e.at, amount: total }];
      list.unshift(e);
      return true;
    }
    const prev = Math.abs(Number(hit.amount) || 0);
    if (total <= prev) return false; // 재시도·순서 역전 → 무시
    hit.amount = -total;
    hit.at = Number(p.observedAt) || hit.at;
    hit.betHistory = [
      ...(Array.isArray(hit.betHistory) ? hit.betHistory : []),
      { at: hit.at, amount: total - prev },
    ];
    return true;
  },

  // 예측 결과(적중·취소) 한 건. id 로 멱등.
  APPEND_PREDICTION_RESULT(list, p, accountId) {
    const e = lpNormalizeEntry(p.entry, accountId);
    if (!e.id || e.amount === 0) return false;
    if (list.some((it) => lpSameEntry(it, accountId, e.id))) return false;
    // 예측 상세는 정규화 대상이 아니라 그대로 옮긴다.
    for (const k of [
      "optionStats",
      "selectedOptionNo",
      "winningOptionNo",
      "predictionTitle",
    ]) {
      if (p.entry?.[k] != null) e[k] = p.entry[k];
    }
    list.unshift(e);
    return true;
  },

  // ⚠ '대상을 찾았는지'(matched)는 ctx 로 돌려준다. 전역에 담으면 동시 요청이
  //   서로의 값을 덮어써, 대상 없는 정산이 성공으로 보고될 수 있다.
  MARK_PREDICTION_RESULT(list, p, accountId, ctx) {
    const prefix = `PREDICTION_BET-${p.predictionId}`;
    // ⚠ 계정 도입 전에 남은 베팅도 정산해야 한다(그때 기록은 accountId 가 없다).
    const mine = (it) => {
      const owner = String(it?.accountId || "");
      if (owner !== String(accountId || "") && owner !== "") return false;
      return (
        it?.id === prefix ||
        /^-\d+$/.test(String(it?.id || "").slice(prefix.length))
      );
    };
    // ⚠ 예전 버전은 패배 시 LOST 를 '새로 추가'해, 같은 예측에 BET 과 LOST 가
    //   함께 남은 기록이 있다(합계가 두 배). 변환 전에 그 짝을 정리한다.
    if (p.claimType === "PREDICTION_LOST") {
      const hasLegacy = list.some(
        (it) => it?.claimType === "PREDICTION_LOST" && mine(it),
      );
      if (hasLegacy) {
        const before = list.length;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (list[i]?.claimType === "PREDICTION_BET" && mine(list[i])) {
            list.splice(i, 1);
          }
        }
        return list.length !== before; // 결과 줄은 이미 있으므로 변환은 생략
      }
    }
    // ⚠ 대상 베팅이 하나도 없으면 정산이 반영되지 않은 것이다. changed 만
    //   돌려주면 호출부가 성공으로 보고 대기 목록에서 지워, 미정산 BET 만 남는다.
    let matched = false;
    let changed = false;
    for (const it of list) {
      if (!mine(it)) continue;
      matched = true;
      if (it.claimType !== p.claimType) {
        it.claimType = p.claimType;
        changed = true;
      }
      if (!it.optionStats || Number(p.meta?.winningOptionNo) > 0) {
        Object.assign(it, p.meta);
        changed = true;
      }
    }
    if (ctx) ctx.matched = matched;
    return changed;
  },

  UPSERT_MANUAL_ENTRY(list, p, accountId) {
    const e = lpNormalizeEntry(p.entry, accountId);
    if (!e.id || e.amount === 0) return false;
    const i = list.findIndex((it) => lpSameOrLegacy(it, accountId, e.id));
    if (i >= 0) list[i] = { ...list[i], ...e };
    else list.unshift(e);
    return true;
  },

  // 보유량 맞추기가 찾은 '설명되지 않는 변동' 여러 건. 자동 감지라 실패해도
  // 다음 비교에서 다시 잡히므로 조용히 보류한다.
  APPEND_AUTO_BATCH(list, p, accountId) {
    const rows = Array.isArray(p.entries) ? p.entries : [];
    let changed = false;
    for (const raw of rows) {
      const e = lpNormalizeEntry(raw, accountId);
      if (!e.id || e.amount === 0) continue;
      if (list.some((it) => lpSameEntry(it, accountId, e.id))) continue;
      list.unshift(e);
      changed = true;
    }
    return changed;
  },

  // 백업 불러오기: 목록을 통째로 교체한다.
  // ⚠ 큐 밖에서 storage 를 직접 덮으면 진행 중인 쓰기를 날린다 → 여기로 모은다.
  //   불러온 기록의 계정 정보는 보존한다(다른 계정 백업일 수 있다).
  //   accountId 가 없는 항목은 '계정 구분 전' 레거시로 남긴다.
  IMPORT_LOG(list, p) {
    const rows = Array.isArray(p.entries) ? p.entries : [];
    list.length = 0;
    for (const raw of rows) {
      const e = lpNormalizeEntry(raw, String(raw?.accountId || ""));
      if (!e.id || e.amount === 0) continue;
      for (const k of [
        "optionStats",
        "selectedOptionNo",
        "winningOptionNo",
        "predictionTitle",
        "betHistory",
      ]) {
        if (raw?.[k] != null) e[k] = raw[k];
      }
      list.push(e);
    }
    return true;
  },

  DELETE_MANUAL_ENTRY(list, p, accountId) {
    const i = list.findIndex((it) => lpSameOrLegacy(it, accountId, p.id));
    if (i < 0) return false; // 이미 없다 → no-op 성공
    list.splice(i, 1);
    return true;
  },
};

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

// ⚠ run 은 읽기 → (네트워크·저장) → 초기화 사이가 길어 그 틈에 새 적립이
//   더해지면 먼저 시작한 flush 가 그것까지 지운다. 조작 전체를 직렬화한다.
let lpRunTail = Promise.resolve();

function lpWithRunLock(task) {
  const result = lpRunTail.then(task);
  lpRunTail = result.catch(() => {});
  return result;
}

// 묶음 id 의 꼬리표. 같은 ms 에 새 묶음이 연달아 생겨도 id 가 겹치지 않게 한다.
let lpRunSeqN = 0;
function lpRunSeq() {
  lpRunSeqN = (lpRunSeqN + 1) % 100000;
  return lpRunSeqN;
}

async function lpGetRun() {
  try {
    const v = (await chrome.storage.local.get(LP_RUN_KEY))?.[LP_RUN_KEY];
    if (v && typeof v === "object") return v;
  } catch {}
  return { prev: null, curr: null, cnt: 0, amount: 0, at: 0, accountId: null };
}

// ⚠ 저장 실패를 삼키면 호출부가 '누적됨'으로 보고 넘어가 그 회차가 사라진다.
//   성공 여부를 돌려준다.
async function lpSetRun(run) {
  try {
    await chrome.storage.local.set({ [LP_RUN_KEY]: run });
    return true;
  } catch {
    return false;
  }
}

// 쌓인 연속분을 WATCH_5_MIN 한 건으로 남긴다. 남길 게 없으면 아무것도 안 한다.
// onlyChannelId: 그 채널의 묶음일 때만 확정한다.
// ⚠ 채널을 가리지 않으면 '다른 채널의 종료 처리'가 지금 쌓이는 묶음을 밀어낸다.
//   실측(제보): 둥그레(구독) 라이브가 끝나고 서새봄(미구독)으로 적립이 넘어갔는데,
//   둥그레 알람이 살아 있어 주기적으로 flush 를 유발해 서새봄 보상이 5분마다
//   1회씩 낱개로 기록됐다.
async function lpFlushRun(onlyChannelId) {
  return lpWithRunLock(() => lpFlushRunLocked(onlyChannelId));
}

// 반환: 이 묶음이 '해소'됐는지(로그에 확정되고 run 이 비었거나, 애초에 비어 있음).
// ⚠ false 면 아직 기록되지 않은 금액이 run 에 남아 있다는 뜻이다. 호출부는 그
//   상태에서 새 묶음을 시작하면 안 된다(덮어쓰면 그 금액이 통째로 사라진다).
async function lpFlushRunLocked(onlyChannelId) {
  const run = await lpGetRun();
  // ⚠ 다른 채널의 묶음이면 이 채널 기준으로는 확정할 것이 없다 = 해소됨(true).
  //   false 로 돌리면 방송 종료 정리가 영영 막혀 알람이 무한히 남는다.
  //   (그 묶음은 자기 채널의 flush 가 따로 확정한다.)
  if (onlyChannelId && run?.curr && run.curr !== onlyChannelId) return true;
  // ⚠ 이미 로그에 확정됐고 초기화만 실패한 묶음이다. 다시 기록하면 같은 id 라
  //   무시되므로, 초기화만 다시 시도한다(성공하면 정상 상태로 돌아온다).
  if (run?.flushedId) {
    // 이미 로그에 있다 → 초기화만 성공하면 해소된다. 실패해도 금액은 안전하다.
    await lpSetRun({
      prev: run.curr || null,
      curr: null,
      cnt: 0,
      amount: 0,
      at: 0,
      accountId: run.accountId ?? null,
    });
    return true;
  }
  if (!run?.curr || !(run.cnt > 0) || !(run.amount > 0)) {
    if (run?.curr || run?.cnt) {
      // 기록할 금액이 없는 잔여 상태 → 비우기만 하면 해소다.
      return lpSetRun({
        prev: run?.curr || null,
        curr: null,
        cnt: 0,
        amount: 0,
        at: 0,
        accountId: run?.accountId ?? null,
      });
    }
    return true; // 비어 있음
  }
  const channelId = run.curr;
  const meta = await lpFetchChannelMeta(channelId);
  // 부스팅 배수 = 실제 단가 / 기본 단가(10). 통계에서 '1티어 구독 ×1.2' 로 쓴다.
  const unit = run.amount / run.cnt;
  // ⚠ 누적을 시작한 계정으로 기록해야 한다. lpAccountFor 는 '현재' 계정을
  //   우선하므로, A 계정 run 을 B 로 로그인한 뒤 flush 하면 B 것이 된다.
  //   run 에 담긴 계정이 있으면 그것을 그대로 쓴다.
  const owner = String(run.accountId || "");
  const accountId = LP_ACCOUNT_RE.test(owner)
    ? owner
    : (await lpAccountFor()).accountId;
  const entry = {
    // 같은 묶음을 두 번 저장하지 않도록 묶음 고유 id 로 고정한다(멱등).
    // ⚠ runId 가 없는 건 이 변경 이전에 시작된 묶음이다 → 예전 형식을 유지해야
    //   이미 저장된 기록과 중복되지 않는다.
    id: run.runId
      ? `WATCH5RUN-${run.runId}`
      : `WATCH5RUN-${channelId}-${run.at}`,
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
    // 묶음이 확정된 시각(마지막 적립 시점에 해당). 보정의 기준 비교에 쓴다.
    endAt: Date.now(),
  };
  if (!accountId) {
    // ⚠ 보류 큐에 넣으면서 run 도 남기면 나중에 둘 다 반영돼 이중 계상된다.
    //   run 은 그대로 두고 보류는 하지 않는다 — 계정이 확인되면 그때 flush 된다.
    return false; // 미해소: 금액이 아직 run 에만 있다
  }
  // ⚠ 저장이 끝난 뒤에 run 을 비운다. 먼저 비우면 저장 실패 시 묶음이 사라진다.
  //   UPSERT_WATCH_RUN 은 총액을 그대로 맞추므로(멱등) 재시도해도 두 줄이 되지
  //   않고, 초기화 실패로 금액이 더 붙은 경우에도 최종 금액으로 정정된다.
  try {
    await lpEnqueueWrite(() =>
      lpMutateLog((list) =>
        LP_WRITE_OPS.UPSERT_WATCH_RUN(list, { entry }, accountId),
      ),
    );
  } catch {
    return false; // 로그 저장 실패 → run 을 그대로 두고 다음 기회에 다시 flush
  }
  // 여기까지 왔으면 로그에는 이 묶음의 최종 금액이 들어 있다(새로 넣었든,
  // 이미 있던 줄을 맞췄든). 이제 run 을 비운다.
  const cleared = await lpSetRun({
    prev: channelId,
    curr: null,
    cnt: 0,
    amount: 0,
    at: 0,
    accountId,
  });
  if (cleared) return true;
  // ⚠ 초기화 저장이 실패했다. run 에는 아직 확정된 묶음이 남아 있어, 다음 5분
  //   보상이 이 묶음에 합쳐지면 회차·금액이 뒤섞인다. '확정됨' 표식을 남겨
  //   다음 누적이 이 묶음에 붙지 않고 새 run 으로 시작하게 한다.
  await lpSetRun({ ...run, flushedId: entry.id, flushedAt: Date.now() });
  // 로그에는 확정됐다 → 금액은 안전하다. 표식이 남았으면 다음 누적이 새 묶음으로
  // 시작하므로 해소로 본다(표식 저장까지 실패해도 upsert 가 총액을 맞춘다).
  return true;
}

// 5분 보상 1회 감지. 같은 채널이면 누적, 채널이 바뀌면 이전 채널을 먼저 확정한다.
async function lpNoteFiveMin(channelId, amount, accountHint, seen) {
  return lpWithRunLock(() =>
    lpNoteFiveMinLocked(channelId, amount, accountHint, seen),
  );
}

// 시청 상태 저장이 확인됐다 → 임시 기준(seen)을 더 쓰지 않는다.
// 채널만 비교하면 먼저 시작한 주기가 뒤 주기의 최신 seen까지 승인할 수 있으므로,
// lpNoteFiveMin이 돌려준 묶음 id와 관측값이 모두 같을 때만 해제한다.
async function lpConfirmRunSeen(channelId, token) {
  if (!token) return false;
  return lpWithRunLock(async () => {
    const run = await lpGetRun();
    if (
      run.curr !== channelId ||
      run.seenPending !== true ||
      String(run.runId || "") !== String(token.runId || "") ||
      Number(run.seen) !== Number(token.seen)
    ) {
      return false;
    }
    return lpSetRun({ ...run, seenPending: false });
  });
}

// 반환: 저장한 묶음의 승인 토큰. 실패하면 null/false이며 호출부가 lastAmount를
// 올리면 안 된다.
async function lpNoteFiveMinLocked(channelId, amount, accountHint, seen) {
  const run = await lpGetRun();
  // ⚠ 같은 보유량을 두 번 반영하지 않는다. 누적은 성공했는데 시청 상태 저장이
  //   실패하면 lastAmount 가 그대로라 다음 주기에 같은 delta 가 다시 들어온다.
  //   '어디까지 반영했는지'를 run 에 남겨 두면 그 재진입을 걸러낸다.
  if (
    Number.isFinite(seen) &&
    run.curr === channelId &&
    Number(run.seen) === seen &&
    run.seenPending === true
  ) {
    return { runId: String(run.runId || ""), seen };
  }
  // ⚠ 락 안이므로 lpFlushRun(락 획득)을 부르면 교착된다 → Locked 판을 부른다.
  // ⚠ 선행 flush 가 실패하면(계정 미확인·로그 저장 실패) 이전 묶음이 기록되지
  //   않은 채 run 에 남는다. 그 위에 새 묶음을 쓰면 그 금액이 통째로 사라진다
  //   → 해소되지 않았으면 이번 회차를 포기하고 다음 주기에 다시 시도한다.
  //   (호출부가 lastAmount 를 올리지 않으므로 차액은 그대로 보존된다.)
  if (run.curr && run.curr !== channelId) {
    if (!(await lpFlushRunLocked())) return false;
  }
  // ⚠ 계정이 바뀌면 이전 계정 묶음을 먼저 확정한다. 안 그러면 A 계정 분량이
  //   B 계정 기록으로 넘어간다.
  const { accountId } = await lpAccountFor(accountHint);
  const mid = await lpGetRun();
  if (mid.curr && accountId && mid.accountId && mid.accountId !== accountId) {
    if (!(await lpFlushRunLocked())) return false;
  }
  const cur = await lpGetRun();
  // ⚠ flushedId 가 있으면 이 묶음은 이미 로그에 확정됐고 초기화만 실패한 상태다.
  //   여기에 더하면 같은 id 로 다시 기록하려다 무시돼 금액이 사라진다.
  //   확정된 묶음은 이어받지 않고 새 묶음으로 시작한다.
  const same = cur.curr === channelId && !cur.flushedId;
  const at = same && cur.at ? cur.at : Date.now();
  const nextRun = {
    prev: cur.prev ?? null,
    curr: channelId,
    cnt: (same ? cur.cnt : 0) + 1,
    amount: (same ? cur.amount : 0) + amount,
    at,
    // ⚠ 묶음 고유 id. 예전에는 flush 때 at 으로 만들었는데, 초기화가 실패해
    //   같은 at 이 재사용되면 id 가 겹쳐 뒤 금액이 통째로 무시됐다. 누적을
    //   시작할 때 한 번 정하고, 새 묶음이면 반드시 새 값을 쓴다.
    runId: same && cur.runId ? cur.runId : `${channelId}-${at}-${lpRunSeq()}`,
    // 이 묶음에 마지막으로 반영한 보유량(중복 반영 차단용).
    // seenPending: 시청 상태(lastAmount) 저장이 아직 확인되지 않았다는 표시.
    // 저장이 확인되면 lpConfirmRunSeen 이 꺼서, 이후에는 lastAmount 를 기준으로
    // 쓴다(잔액이 정상적으로 줄어도 판정이 막히지 않게).
    ...(Number.isFinite(seen) ? { seen, seenPending: true } : {}),
    // 누적 시작 시점의 계정. flush 때 이 값으로 기록한다.
    accountId: same && cur.accountId ? cur.accountId : accountId || null,
  };
  if (!(await lpSetRun(nextRun))) return null;
  return {
    runId: String(nextRun.runId || ""),
    seen: Number(nextRun.seen),
  };
}

// ── 예측 대기 목록: 단일 작성자 ──────────────────────────────────────────
// ⚠ 탭마다 전체 목록을 읽고 덮어써서, 두 탭이 동시에 베팅·정산하면 한쪽 항목이
//   유실되거나 되살아난다. 여기로 모아 직렬화한다.
const LP_AWAITING_KEY = "cheeseLogPowerPredictionAwaiting";
let lpAwaitingTail = Promise.resolve();

function lpWithAwaitingLock(task) {
  const result = lpAwaitingTail.then(task);
  lpAwaitingTail = result.catch(() => {});
  return result;
}

// ⚠ '바뀐 게 없음'과 '저장 실패'를 모두 false 로 돌려주면 호출부가 구분하지
//   못해 실패를 성공으로 응답한다(정산 추적 항목 유실). 둘을 나눠 돌려준다.
async function lpMutateAwaiting(apply) {
  return lpWithAwaitingLock(async () => {
    try {
      const cur = (await chrome.storage.local.get(LP_AWAITING_KEY))?.[
        LP_AWAITING_KEY
      ];
      const list = Array.isArray(cur) ? [...cur] : [];
      const changed = apply(list);
      if (!changed) return { ok: true, changed: false };
      await chrome.storage.local.set({ [LP_AWAITING_KEY]: list });
      // 자동 보정은 대기 목록도 판정 근거로 읽는다. 보유량을 읽는 사이 목록이
      // 바뀌었다면 같은 세대로 감지해 이번 비교를 다시 하게 한다.
      lpLogGeneration += 1;
      return { ok: true, changed: true };
    } catch (error) {
      return {
        ok: false,
        changed: false,
        reason: String(error?.message || error),
      };
    }
  });
}

// 대기 항목을 넣거나 고친다(계정 + predictionId 로 찾는다).
function lpUpsertAwaiting(list, p, accountId) {
  const i = list.findIndex((x) => {
    if (x?.predictionId !== p.predictionId) return false;
    const owner = String(x?.accountId || "");
    return owner === accountId || owner === "";
  });
  if (i >= 0) list[i] = { ...list[i], ...p, accountId };
  else list.push({ ...p, accountId });
  return true;
}

// 정산이 끝난 항목을 뺀다.
function lpRemoveAwaiting(list, predictionId, accountId) {
  const i = list.findIndex((x) => {
    if (x?.predictionId !== predictionId) return false;
    const owner = String(x?.accountId || "");
    return owner === accountId || owner === "";
  });
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

// ── 보유량 맞추기(자동 조정) ────────────────────────────────────────────────
// ⚠ 통계 페이지에도 같은 로직이 있었다. 두 곳에 두면 이번 세션에만 네 번 고친
//   규칙(atMap, pendingRun, 유예, 계정 경계)이 갈라진다 → background 만 소유한다.
const LP_SNAP_KEY = "cheeseLogPowerBalanceSnapshotsV2";
const LP_SNAP_NOISE = 5;
const LP_SNAP_SETTLE_MS = 10 * 60 * 1000;
const LP_HOUR_AWAY_LIMIT_MS = 60 * 60 * 1000;
const LP_BALANCES_URL =
  "https://api.chzzk.naver.com/service/v1/log-power/balances";

async function lpFetchBalances() {
  try {
    const res = await fetch(LP_BALANCES_URL, { credentials: "include" });
    if (!res.ok) return null;
    const rows = (await res.json())?.content?.data;
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

async function lpLoadSnapshot(accountId) {
  try {
    const all = (await chrome.storage.local.get(LP_SNAP_KEY))?.[LP_SNAP_KEY];
    const v = all && typeof all === "object" ? all[accountId] : null;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

async function lpSaveSnapshot(accountId, snap) {
  try {
    const all = (await chrome.storage.local.get(LP_SNAP_KEY))?.[LP_SNAP_KEY];
    const next = all && typeof all === "object" ? { ...all } : {};
    next[accountId] = snap;
    await chrome.storage.local.set({ [LP_SNAP_KEY]: next });
    return true;
  } catch {
    return false;
  }
}

// 지금 적립 중이라 '곧 우리가 기록할' 채널. 기준을 찍거나 차액을 잡으면 안 된다.
async function lpActiveChannelIds(balances, log, accountId) {
  const now = Date.now();
  const ids = new Set();
  try {
    const sess = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(sess || {})) {
      if (!k.startsWith(LP_WATCH_STATE_PREFIX)) continue;
      // ⚠ activeUntil 이 지나도 알람은 살아 있어 그 채널의 보상이 계속 들어올 수
      //   있다. 그런데 PC 가 다른 채널을 보고 있으면 delta 판정이 늦어, 그 사이
      //   보유량만 오른 상태를 '설명 안 됨'으로 잡았다(제보: 카린 기타 +24).
      //   추적 state 가 남아 있는 채널은 계정이 같으면 전부 제외한다.
      if (accountId && v?.accountId && v.accountId !== accountId) continue;
      ids.add(k.slice(LP_WATCH_STATE_PREFIX.length));
    }
  } catch {}
  try {
    const keys = (balances || [])
      .map((b) => `${LP_HOUR_TIMER_PREFIX}${String(b?.channelId || "")}`)
      .filter((k) => k.length > LP_HOUR_TIMER_PREFIX.length);
    const loc = keys.length ? await chrome.storage.local.get(keys) : {};
    for (const [k, v] of Object.entries(loc || {})) {
      const raw = v && typeof v === "object" ? v : { endsAt: Number(v) };
      const endsAt = Number(raw.endsAt) || 0;
      const leftAt = Number(raw.leftAt) || 0;
      if (leftAt > 0) {
        // 자리를 비운 지 오래면 복원 때 종료된다 → 더 이상 제외하지 않는다.
        if (now - leftAt > LP_HOUR_AWAY_LIMIT_MS) continue;
        if (endsAt - leftAt <= 0) continue;
      } else if (endsAt + LP_SNAP_SETTLE_MS <= now) {
        continue;
      }
      // 다른 계정 타이머 때문에 이 계정의 감지가 막히면 안 된다.
      if (accountId && raw.accountId && raw.accountId !== accountId) continue;
      ids.add(k.slice(LP_HOUR_TIMER_PREFIX.length));
    }
  } catch {}
  // 방금 시청 보상을 받은 채널은 키가 지워졌어도 잠깐 유예한다.
  for (const e of log) {
    const t = String(e?.claimType || "");
    if (!e?.channelId || !(!t || t.startsWith("WATCH_"))) continue;
    // ⚠ 묶음(WATCH_5_MIN)의 at 은 '시작' 시각이라 한 시간 전일 수 있다.
    //   끝난 시각으로 유예를 재야 방금 확정된 묶음이 제외 대상에 들어간다.
    const eAt = Number(e.endAt) || Number(e.at);
    if (eAt + LP_SNAP_SETTLE_MS > now) ids.add(e.channelId);
  }
  ids.delete("");
  return ids;
}

// 스냅샷과 현재 보유량을 비교해 설명되지 않는 변동을 기록한다.
// 반환: { ok, applied, reason }
// ⚠ 동시에 두 번 돌면 같은 차액을 두 번 기록한다(탭 진입 + 수동 버튼 + 알람).
let lpReconcileInFlight = null;

function lpReconcileOnce() {
  if (lpReconcileInFlight) return lpReconcileInFlight;
  lpReconcileInFlight = lpReconcile().finally(() => {
    lpReconcileInFlight = null;
  });
  return lpReconcileInFlight;
}

async function lpReconcile() {
  // ⚠ 캐시된 계정으로 비교하면 전환 직후 이전 계정 기준과 대조해 큰 허위 기록이
  //   생긴다. 보정 전에는 항상 새로 확인한다.
  // 사용자가 요청한 보정은 캐시·실패 기록을 모두 건너뛰고 새로 확인한다.
  lpInvalidateAccount();
  const accountId = await lpFetchAccountId();
  // 계정을 모르면 비교하지 않는다 — 남의 계정 기준과 대조하면 허위 기록이 된다.
  if (!accountId) return { ok: false, reason: "account-unknown" };

  // ⚠ 보류분을 먼저 내역에 넣는다. 안 그러면 그 적립이 '설명되지 않는 변동'으로
  //   기타 적립에 기록되고, 나중에 보류가 풀리면서 같은 금액이 한 번 더 들어온다.
  //   (예약 실행 경로에만 있던 처리 → 수동·페이지 진입도 같은 함수를 쓰므로
  //    여기로 옮겨 모든 진입점이 동일하게 동작하게 한다.)
  const drained = await lpDrainPending();
  // ⚠ 보류가 남아 있으면 비교하지 않는다. 그 기록은 보유량엔 이미 반영돼 있고
  //   내역엔 없으므로, 지금 비교하면 기타 적립으로 한 번 더 기록된다(이중 계상).
  if (!drained?.ok) return { ok: false, reason: "pending-failed" };
  if (drained.left > 0) return { ok: false, reason: "pending-left" };

  // ⚠ 보유량은 이 시점의 서버 상태다. 이 뒤로 로그가 바뀌면 둘의 기준 시각이
  //   어긋난다 — 큐 안에서 세대를 대조해 걸러낸다.
  const gen0 = lpLogGeneration;
  const balances = await lpFetchBalances();
  if (!balances) return { ok: false, reason: "balances-failed" };

  const snap = await lpLoadSnapshot(accountId);
  // 제외 판정은 로그와 무관한 상태(추적·타이머)만 본다 → 큐 밖에서 준비한다.
  const skip = await lpActiveChannelIds(balances, [], accountId);
  const run = await lpGetRun();
  // ⚠ 누적 중인 run 이 있는 채널은 기준을 갱신하면 안 된다. 차액 계산에서 빼도
  //   기준에는 run 이 포함된 보유량이 저장돼, 나중에 flush 로 내역에 들어오면
  //   같은 금액이 한 번 더 빠진다(제보: 둥그레 기타 사용 -36).
  // 다른 계정의 run 때문에 이 계정 감지가 막히면 안 된다.
  // ⚠ flushedId 가 있는 묶음은 이미 내역에 들어가 있다(초기화만 실패한 상태).
  //   그 채널까지 제외하면 실제 다른 기기 적립을 계속 못 잡는다 — 제외는
  //   '아직 기록되지 않은 금액'을 보호하기 위한 것이다.
  if (
    run?.curr &&
    Number(run.amount) > 0 &&
    !run.flushedId &&
    (!run.accountId || run.accountId === accountId)
  ) {
    skip.add(String(run.curr));
  }
  // ⚠ 예측 베팅은 보유량이 먼저 줄고 기록이 몇십 초 뒤에 붙는다. 그 틈에 비교하면
  //   베팅이 '기타 사용'으로 잡히고, 뒤이어 진짜 기록이 들어와 되돌리는 보정까지
  //   생긴다(제보: 큐베 -50 → 예측 베팅 -50 → +50).
  //   정산 대기 중인 예측이 있는 채널은 건드리지 않는다.
  try {
    const aw = (
      await chrome.storage.local.get("cheeseLogPowerPredictionAwaiting")
    )?.cheeseLogPowerPredictionAwaiting;
    for (const p of Array.isArray(aw) ? aw : []) {
      // 현재 계정(또는 계정 도입 전) 대기 건만 제외 대상이다.
      const owner = String(p?.accountId || "");
      if (owner && owner !== accountId) continue;
      if (p?.channelId) skip.add(String(p.channelId));
    }
  } catch {}
  const now = Date.now();

  // 기준이 없으면(첫 실행·계정 추가) 기록 없이 기준만 남긴다.
  // ⚠ 기준을 만드는 동안 들어온 기록은 보유량에 이미 포함돼 기준으로 굳는다.
  //   큐 안에서 확인해 그런 경우 다음 주기로 미룬다.
  if (!snap?.map) {
    // ⚠ '세대 변경'과 '저장 실패'를 한 값으로 합치면 저장소 오류가 5분 재시도로
    //   분류돼 백오프가 안 걸리고 진단도 틀린다. 이유를 따로 돌려준다.
    let why = "";
    await lpEnqueueWrite(async () => {
      if (lpLogMoved(gen0)) {
        why = "log-changed";
        return false;
      }
      const ok = await lpWriteSnapshot(accountId, balances, skip, null, now);
      if (!ok) why = "snapshot-failed";
      return ok;
    });
    if (why) return { ok: false, reason: why };
    return { ok: true, applied: 0, reason: "baseline-created" };
  }

  // ⚠ 로그 읽기·차액 계산·기록을 한 큐 작업 안에서 한다. 밖에서 계산하면
  //   그 사이 들어온 실제 적립을 못 보고 같은 변동을 한 번 더 기록한다.
  let count = 0;
  let stale = false;
  let saved = false;
  let failed = "";
  // 기준 저장에서 제외할 채널(큐 안에서 계산한 유예 채널까지 합친다).
  const skipForSnapshot = new Set(skip);
  await lpEnqueueWrite(async () => {
    // 보유량을 읽은 뒤 로그가 바뀌었다 → 그 기록이 보유량에도 이미 반영돼 있어
    // 지금 빼면 이중 계산이 된다. 이번은 포기하고 다음 주기에 새로 읽는다.
    if (lpLogMoved(gen0)) {
      stale = true;
      return false;
    }
    const wrote = await lpMutateLog((list) => {
      // 차액 계산에는 현재 계정 기록만 센다(레거시를 섞으면 남의 기록을 차감).
      const mine = list.filter((e) => String(e?.accountId || "") === accountId);
      // 방금 시청 보상을 받은 채널은 키가 지워졌어도 잠깐 유예한다.
      const hot = new Set(skip);
      for (const e of mine) {
        const t = String(e?.claimType || "");
        if (!e?.channelId || !(!t || t.startsWith("WATCH_"))) continue;
        // 묶음은 끝난 시각 기준으로 유예를 준다(시작 시각은 한참 전일 수 있다).
        const eAt = Number(e.endAt) || Number(e.at);
        if (eAt + LP_SNAP_SETTLE_MS > now) hot.add(e.channelId);
      }
      const rows = [];
      for (const b of balances) {
        const id = String(b?.channelId || "");
        if (!id || hot.has(id) || !(id in snap.map)) continue;
        const since = Number(snap.atMap?.[id]) || Number(snap.at) || 0;
        let recorded = 0;
        for (const e of mine) {
          if (e.channelId !== id) continue;
          // ⚠ 묶음(WATCH_5_MIN)은 at 이 '시작' 시각이라 기준보다 이전일 수 있다.
          //   실제로는 기준 이후에 적립·기록된 금액이므로 endAt 으로 판정한다.
          const eAt = Number(e.endAt) || Number(e.at);
          if (eAt <= since) continue;
          recorded += (Number(e.amount) || 0) + (Number(e.fiveMinAmount) || 0);
        }
        const other =
          (Number(b.amount) || 0) - Number(snap.map[id] || 0) - recorded;
        if (Math.abs(other) <= LP_SNAP_NOISE) continue;
        rows.push({
          id: `OTHER-${id}-${now}`,
          at: now,
          channelId: id,
          channelName: b.channelName || "채널",
          channelImageUrl: b.channelImageUrl || "",
          verifiedMark: b.verifiedMark === true,
          amount: other,
          fiveMinAmount: 0,
          boost: 1,
          claimType: other < 0 ? "OTHER_LOSS" : "OTHER_GAIN",
          autoDetected: true, // 화면에서 '자동 감지'로 구분한다
        });
      }
      count = rows.length;
      // ⚠ 유예 중인 채널은 기준도 갱신하지 않는다. 갱신하면 묶음 도중의 보유량이
      //   기준으로 굳어, 나중에 그 묶음이 확정될 때 이미 기준에 포함된 몫이
      //   중복으로 계산된다(제보: 둥그레 기타 +96).
      for (const id of hot) skipForSnapshot.add(id);
      if (!rows.length) return false;
      return LP_WRITE_OPS.APPEND_AUTO_BATCH(list, { entries: rows }, accountId);
    });
    // ⚠ 기준 저장까지 같은 큐 작업 안에서 끝낸다. 큐를 나온 뒤 저장하면 그 틈에
    //   들어온 기록이 기준에 흡수돼 다음 보정에서 영영 안 잡힌다(누락).
    if (count && !wrote) {
      failed = "write-failed"; // 기록 실패 → 기준을 옮기지 않는다
      return wrote;
    }
    saved = await lpWriteSnapshot(
      accountId,
      balances,
      skipForSnapshot,
      snap,
      now,
    );
    if (!saved) failed = "snapshot-failed";
    return wrote;
  });
  // 보유량이 낡았다 → 기준도 옮기지 않는다(옮기면 그 변동을 영영 놓친다).
  if (stale) return { ok: false, reason: "log-changed" };
  if (failed) return { ok: false, reason: failed, applied: count };
  return { ok: true, applied: count };
}

// 기준 저장. 적립 중인 채널은 이전 기준을 물려받는다(진행 중 보상이 섞이지 않게).
async function lpWriteSnapshot(accountId, balances, skip, prevSnap, now) {
  const prev = prevSnap?.map || {};
  const prevAt = prevSnap?.atMap || {};
  const map = {};
  const atMap = {};
  for (const b of balances) {
    const id = String(b?.channelId || "");
    if (!id) continue;
    if (skip.has(id)) {
      if (id in prev) {
        map[id] = Number(prev[id]) || 0;
        atMap[id] = Number(prevAt[id]) || Number(prevSnap?.at) || now;
      } else {
        map[id] = Number(b.amount) || 0;
        atMap[id] = now;
      }
      continue;
    }
    map[id] = Number(b.amount) || 0;
    atMap[id] = now;
  }
  return lpSaveSnapshot(accountId, { at: now, map, atMap });
}

const LP_HOUR_TIMER_PREFIX = "cheeseLogPowerHourTimer:";
async function lpClearOtherChannels(activeChannelId, ownerHint) {
  try {
    // 1) 다른 채널의 적립 '표시'만 끄고 추적은 유지한다(삭제하면 판정이 이 채널로
    //    옮겨와도 재추적되지 않음). LOG_POWER_LIVE_ENDED 로 현재 떠 있는 적립 중 표시를
    //    지우되, background 추적/알람은 살려 다음 주기에 이 채널의 적립을 계속 감지한다.
    // ⚠ 다른 계정의 추적 상태까지 비활성화하면 그 계정으로 돌아갔을 때 감지가
    //   끊긴다. 지금 계정 것만 정리한다.
    // ⚠ 계정을 모른 채 진행하면 필터가 풀려 다른 계정의 추적 상태까지 비활성화하고
    //   타이머를 일시정지한다. 호출부가 아는 소유자를 받아 쓰고, 그래도 모르면
    //   정리를 아예 하지 않는다(안 하는 쪽이 남의 기준을 망치는 것보다 낫다).
    const { accountId: me } = await lpAccountFor(ownerHint);
    if (!me) return;
    const sess = await chrome.storage.session.get(null);
    const others = [];
    for (const [key, v] of Object.entries(sess || {})) {
      if (!key.startsWith(LP_WATCH_STATE_PREFIX)) continue;
      const cid = key.slice(LP_WATCH_STATE_PREFIX.length);
      if (!cid || cid === activeChannelId) continue;
      if (v?.accountId && v.accountId !== me) continue;
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
      // 타이머의 소유 계정을 유지한다(누락하면 다른 계정이 이어받는다).
      paused[key] = {
        endsAt,
        leftAt: now,
        accountId: String(obj.accountId || ""),
      };
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
    // ⚠ 확정을 먼저 한다. state·알람을 먼저 지우면 flush 가 실패했을 때 다시
    //   시도할 알람이 없어 그 묶음이 영영 기록되지 않는다(자동 보정도 이 채널을
    //   run 때문에 계속 제외한다). 확정에 성공했을 때만 추적을 정리한다.
    const flushed = await lpFlushRun(channelId); // 쌓인 연속분 확정
    if (!flushed) {
      // 다음 알람에서 다시 시도한다 — 추적 상태·알람을 남겨 둔다.
      lpBroadcast({ type: "LOG_POWER_LIVE_ENDED", channelId });
      return;
    }
    await lpClearWatchState(channelId);
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
    // ⚠ 여기서도 확정이 먼저다(실패하면 알람을 남겨 다음 주기에 재시도).
    if (!(await lpFlushRun(channelId))) {
      lpBroadcast(lpStateToStatus(state, false));
      return;
    }
    await lpClearWatchState(channelId);
    lpBroadcast(lpStateToStatus(state, false));
    return;
  }
  // ⚠ 계정이 바뀌었으면 lastAmount·expectedAmount 가 이전 계정 기준이라
  //   delta 가 엉뚱하게 나온다(실측 추정: 25795 → 300 이면 -25495).
  //   그 상태로 두면 새 계정의 적립을 계속 놓치므로 기준을 다시 잡는다.
  // ⚠ 캐시(최대 5분)를 쓰면 전환 직후 A 를 현재 계정으로 판단하면서 보유량은
  //   B 것을 읽는다. 판정은 보유량과 직접 엮이므로 더 신선한 값이 필요하다.
  //   매번 무효화하면 이 함수가 채널마다 1분 주기라 하루 수천 회가 되므로
  //   (캐시를 넣은 이유가 그것이다) 이 경로에만 짧은 TTL 을 적용한다.
  // ⚠ 전환 '신호'가 아니라 단순 신선도 문제다 → 진행 중 요청까지 버리면 채널마다
  //   새 요청이 나간다. 캐시 나이만 비워 공유 요청은 그대로 쓴다.
  if (Date.now() - lpAccountCache.at > LP_ACCOUNT_WATCH_TTL_MS) {
    lpAccountCache = { id: null, at: 0 };
  }
  const { accountId: nowAccount } = await lpAccountFor();
  // ⚠ 계정을 확인하지 못하면 이번 주기는 판정하지 않는다.
  //   보유량(lpFetchAmount)은 '지금 로그인한 계정' 기준인데, 계정이 바뀌었는지
  //   모르는 상태다. state.accountId 를 소유자로 삼아 진행하면 B 의 보유량을
  //   A 의 기준과 비교하고 그 적립을 A 내역에 넣게 된다.
  //   추적 상태는 그대로 두므로 다음 주기(1분 뒤)에 복구되면 이어서 감지한다.
  if (!nowAccount) return;
  const owner = nowAccount; // 이 지점 이후 소유 계정은 항상 확정돼 있다
  // ⚠ 소유자가 비어 있는 상태(계정 미확인 중에 만들어진 것)도 재기준 대상이다.
  //   그냥 두면 누구 기준인지 모르는 lastAmount 로 계속 판정한다.
  if (state.accountId !== nowAccount) {
    // ⚠ 이전 계정 묶음이 확정되지 않았는데 기준을 새 계정으로 옮기면, 그 금액이
    //   기록되지 못한 채 남고 이후 판정에서 새 계정 차액과 섞인다.
    //   해소될 때까지 재기준을 미룬다(다음 주기에 다시 시도).
    if (!(await lpFlushRun(channelId))) return;
    const fresh = await lpFetchAmount(channelId);
    // ⚠ 새 보유량을 못 읽었으면 상태를 건드리지 않는다. 계정만 새 것으로 바꾸고
    //   lastAmount 는 이전 계정 값을 남기면, 다음 주기에 '계정 일치'로 판단해
    //   A 의 보유량과 B 의 보유량을 비교한다(허위 delta).
    if (!Number.isFinite(fresh)) return; // 다음 주기에 다시 시도
    await lpSetWatchState(channelId, {
      ...state,
      accountId: nowAccount,
      lastAmount: fresh,
      expectedAmount: await lpFetchExpectedAmount(channelId),
      activeUntil: 0,
      misses: 0,
    });
    return; // 이번 주기는 기준만 다시 잡고 끝낸다
  }
  // 계정 확인이 복구됐으면 보류분을 먼저 반영한다.
  void lpDrainPending();
  const amount = await lpFetchAmount(channelId);
  if (!Number.isFinite(amount)) return; // 누락 → 판정 스킵
  // ⚠ 시청 상태 저장이 실패하면 lastAmount 가 뒤처진 채 남는다. 그 값으로 차액을
  //   내면 이미 run 에 넣은 몫까지 다시 세게 된다.
  //   ⚠ 크기 비교(seen > lastAmount)로 판단하면 안 된다 — 예측 베팅 등으로 잔액이
  //     정상적으로 줄면 seen 이 계속 커 보여서 이후 적립을 전부 놓친다.
  //     '상태 저장이 아직 확인되지 않았다'는 사실만 토큰(seenPending)으로 본다.
  const runNow = await lpGetRun();
  const pendingSeenToken =
    runNow.curr === channelId &&
    runNow.seenPending === true &&
    Number.isFinite(Number(runNow.seen))
      ? {
          runId: String(runNow.runId || ""),
          seen: Number(runNow.seen),
        }
      : null;
  const baseline = pendingSeenToken
    ? pendingSeenToken.seen
    : Number(state.lastAmount || 0);
  const delta = amount - baseline;
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
    // ⚠ 누적 저장이 먼저다. lastAmount 를 올린 뒤 저장에 실패하면 그 회차의
    //   차액이 이미 소비돼 영영 사라진다. 실패하면 기준을 그대로 두고 다음
    //   주기에 같은 차액으로 다시 시도한다.
    const note = await lpNoteFiveMin(channelId, comboFive, owner, amount);
    if (!note) return;
    // ⚠ 상태 저장이 실패했는데 flush 하면 seen 도 run 과 함께 사라져, 다음
    //   알람이 같은 delta 를 또 처리한다(중복). 저장이 확인된 뒤에 확정한다.
    if (!(await lpSetWatchState(channelId, next))) return;
    await lpConfirmRunSeen(channelId, note);
    // 1시간이 찼으니 여기서 한 묶음이 끝난다 → 쌓인 5분분을 확정한다.
    await lpFlushRun(channelId);
    await lpClearOtherChannels(channelId, owner);
    lpBroadcast(lpStateToStatus(next, true));
    return;
  }
  if (targets.includes(delta)) {
    next.activeUntil = now + LP_WATCH_ACTIVE_TTL_MS;
    next.misses = 0;
    // 연속 5분 보상 누적. 채널이 바뀌면 여기서 이전 채널분이 확정된다.
    const note = await lpNoteFiveMin(channelId, delta, owner, amount);
    if (!note) return;
    // 저장이 확인돼야 임시 기준(seen)을 놓는다.
    if (await lpSetWatchState(channelId, next)) {
      await lpConfirmRunSeen(channelId, note);
    }
    // 이 채널이 활성 적립 채널로 확정됨 → 다른 채널의 적립·1시간 타이머 정리.
    await lpClearOtherChannels(channelId, owner);
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
      const note = await lpNoteFiveMin(channelId, rest, owner, amount);
      if (!note) return;
      // ⚠ 위와 같다 — 저장 확인 전에는 flush 하지 않는다.
      if (!(await lpSetWatchState(channelId, next))) return;
      await lpConfirmRunSeen(channelId, note);
      await lpFlushRun(channelId); // 1시간이 찼으니 한 묶음이 끝난다
      await lpClearOtherChannels(channelId, owner);
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
      const note = await lpNoteFiveMin(channelId, delta, owner, amount);
      if (!note) return;
      if (await lpSetWatchState(channelId, next)) {
        await lpConfirmRunSeen(channelId, note);
      }
      await lpClearOtherChannels(channelId, owner);
      lpBroadcast(lpStateToStatus(next, true));
      return;
    }
  }
  next.misses = Number(state.misses || 0) + 1;
  if (next.misses >= LP_WATCH_MISS_LIMIT) next.activeUntil = 0;
  const stateSaved = await lpSetWatchState(channelId, next);
  // 앞 주기에서 run 저장만 성공하고 시청 상태 저장이 실패한 경우, 이번 주기의
  // 일반 경로에서 lastAmount가 복구돼도 pending을 놓지 않으면 과거 seen이 계속
  // 기준이 된다. 캡처한 토큰이 그대로일 때만 승인해 더 최신 관측은 건드리지 않는다.
  if (stateSaved && pendingSeenToken) {
    await lpConfirmRunSeen(channelId, pendingSeenToken);
  }
  if (wasActive && Number(next.activeUntil || 0) <= now) {
    // 적립이 끊겼다 → 쌓인 연속분을 확정한다. 여기서 안 하면 다른 채널을 볼
    // 때까지(며칠 뒤일 수도) 기록이 안 남는다.
    await lpFlushRun(channelId);
    lpBroadcast(lpStateToStatus(next, false));
  }
}

// ── 다른 기기 적립 자동 감지(60분) ──────────────────────────────────────────
// ⚠ 모바일 시청분은 PC 확장이 감지할 수 없다(제보: 모라라·아오토라). 내역 탭을
//   열 때만 맞추면 며칠치가 한 건으로 뭉치므로, 주기적으로 확인한다.
//   치지직 탭 유무는 보지 않는다 — 모바일로 볼 때 PC 탭이 열려 있을 이유가 없다.
const LP_RECONCILE_ALARM = "logpower:reconcile";
const LP_RECONCILE_PERIOD_MIN = 60;
const LP_RECONCILE_STATE_KEY = "cheeseLogPowerReconcileState";
// 실패가 이어지면(로그아웃·네트워크) 간격을 늘린다. 로그아웃은 오류가 아니다.
const LP_RECONCILE_BACKOFF_MIN = [60, 180, 360];
// 로그가 바뀌어 건너뛴 경우의 재시도 간격(고장이 아니므로 짧게).
const LP_RECONCILE_RETRY_MIN = 5;

async function lpReconcileState() {
  try {
    const v = (await chrome.storage.local.get(LP_RECONCILE_STATE_KEY))?.[
      LP_RECONCILE_STATE_KEY
    ];
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function lpEnsureReconcileAlarm(delayMin) {
  try {
    chrome.alarms.create(LP_RECONCILE_ALARM, {
      delayInMinutes: delayMin ?? LP_RECONCILE_PERIOD_MIN,
      periodInMinutes: LP_RECONCILE_PERIOD_MIN,
    });
  } catch {}
}

async function lpRunScheduledReconcile() {
  // 보류분 반영은 lpReconcile 안에서 한다(모든 진입점 공통).
  const state = await lpReconcileState();
  const res = await lpReconcileOnce();
  const now = Date.now();
  const next = { ...state, lastAttemptAt: now };
  if (res?.ok) {
    next.lastSuccessAt = now;
    next.consecutiveFailures = 0;
    delete next.reason;
  } else if (res?.reason === "account-unknown") {
    // 로그인 안 한 상태는 실패로 세지 않는다(경고를 띄우면 잘못된 신호다).
    next.reason = res.reason;
  } else if (res?.reason === "log-changed" || res?.reason === "pending-left") {
    // 고장이 아니라 '읽는 사이에 실제 기록이 들어왔다' 또는 '아직 넣지 못한
    // 기록이 남았다'는 뜻이다. 실패로 세면 정상 적립 중에 backoff 가 걸려
    // 보정 주기가 6시간까지 벌어진다 → 짧게 재시도한다.
    next.reason = res.reason;
    await lpEnsureReconcileAlarm(LP_RECONCILE_RETRY_MIN);
  } else {
    next.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
    next.reason = res?.reason || "unknown";
    const i = Math.min(
      next.consecutiveFailures - 1,
      LP_RECONCILE_BACKOFF_MIN.length - 1,
    );
    await lpEnsureReconcileAlarm(LP_RECONCILE_BACKOFF_MIN[i]);
  }
  try {
    await chrome.storage.local.set({ [LP_RECONCILE_STATE_KEY]: next });
  } catch {}
  return res;
}

// 알람 등록 + 놓친 주기 보정.
// ⚠ 절전·브라우저 종료 중에는 알람이 안 돈다. 시작할 때 마지막 성공으로부터
//   한 주기가 지났으면 바로 한 번 맞춘다.
async function lpBootReconcile() {
  // ⚠ 전체 기능 OFF 면 아무것도 하지 않는다. 설정 로딩을 기다리지 않으면
  //   꺼 둔 상태에서도 API 호출과 자동 기록이 일어난다.
  await masterStateReady.catch(() => true);
  if (!masterEnabled) return;
  // ⚠ 이미 예약된 알람이 있으면 덮지 않는다. 덮으면 백오프가 60분으로 풀린다.
  let alarm = null;
  try {
    alarm = await chrome.alarms.get(LP_RECONCILE_ALARM);
  } catch {}
  if (!alarm) await lpEnsureReconcileAlarm();
  const state = await lpReconcileState();
  const now = Date.now();
  // ⚠ 워커가 깰 때마다 즉시 호출하면 백오프가 무의미해진다. 예약된 알람이
  //   아직 안 왔거나, 마지막 시도가 한 주기 안이면 기다린다.
  if (alarm && Number(alarm.scheduledTime) > now) return;
  const lastAttempt = Number(state.lastAttemptAt || 0);
  if (now - lastAttempt < LP_RECONCILE_PERIOD_MIN * 60 * 1000) return;
  const last = Number(state.lastSuccessAt || 0);
  if (now - last >= LP_RECONCILE_PERIOD_MIN * 60 * 1000) {
    void lpRunScheduledReconcile();
  }
}

void lpBootReconcile();
chrome.runtime.onStartup.addListener(() => {
  void lpBootReconcile();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!masterEnabled) return;
  if (alarm?.name === LP_RECONCILE_ALARM) {
    void lpRunScheduledReconcile();
    return;
  }
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

// 채팅 리캡은 채널·월별 키로 나뉜다. storage API에는 prefix 조회가 없어 리캡
// 페이지가 매번 get(null)로 클립 캐시까지 읽지 않도록 계정별 카탈로그를 둔다.
// content와 리캡 페이지가 동시에 쓰더라도 한 서비스 워커 큐에서 합쳐 유실을 막는다.
const CHAT_RECAP_CATALOG_PREFIX = "chatRecapCatalog:";
const CHAT_RECAP_ACCOUNT_RE = /^[0-9a-f]{32}$/i;
const CHAT_RECAP_MONTH_RE = /^\d{4}-\d{2}$/;
let chatRecapCatalogTail = Promise.resolve();

function normalizeChatRecapCatalog(value) {
  const channels = {};
  const raw = value?.channels;
  if (raw && typeof raw === "object") {
    for (const [channelId, months] of Object.entries(raw)) {
      if (!CHAT_RECAP_ACCOUNT_RE.test(channelId) || !Array.isArray(months)) {
        continue;
      }
      channels[channelId.toLowerCase()] = [
        ...new Set(months.map(String).filter((m) => CHAT_RECAP_MONTH_RE.test(m))),
      ].sort();
    }
  }
  return { v: 1, complete: value?.complete === true, channels };
}

function mutateChatRecapCatalog(accountId, apply) {
  const task = chatRecapCatalogTail.catch(() => {}).then(async () => {
    const key = `${CHAT_RECAP_CATALOG_PREFIX}${accountId}`;
    const stored = (await chrome.storage.local.get(key))?.[key];
    const catalog = normalizeChatRecapCatalog(stored);
    const changed = apply(catalog);
    if (changed === false) return catalog;
    await chrome.storage.local.set({ [key]: catalog });
    return catalog;
  });
  chatRecapCatalogTail = task.catch(() => {});
  return task;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "CHAT_RECAP_CATALOG") {
    const accountId = String(message.accountId || "").toLowerCase();
    if (!CHAT_RECAP_ACCOUNT_RE.test(accountId)) {
      sendResponse?.({ ok: false, reason: "invalid-account" });
      return false;
    }
    void mutateChatRecapCatalog(accountId, (catalog) => {
      if (message.op === "REBUILD") {
        const incoming = message.channels;
        if (incoming && typeof incoming === "object") {
          for (const [channelId, months] of Object.entries(incoming)) {
            if (
              !CHAT_RECAP_ACCOUNT_RE.test(channelId) ||
              !Array.isArray(months)
            ) {
              continue;
            }
            const current = catalog.channels[channelId.toLowerCase()] || [];
            catalog.channels[channelId.toLowerCase()] = [
              ...new Set([
                ...current,
                ...months
                  .map(String)
                  .filter((month) => CHAT_RECAP_MONTH_RE.test(month)),
              ]),
            ].sort();
          }
        }
        catalog.complete = true;
        return true;
      }
      if (message.op !== "ADD") throw new Error("unknown-op");
      const channelId = String(message.channelId || "").toLowerCase();
      if (!CHAT_RECAP_ACCOUNT_RE.test(channelId)) {
        throw new Error("invalid-channel");
      }
      const months = Array.isArray(message.months)
        ? message.months
            .map(String)
            .filter((month) => CHAT_RECAP_MONTH_RE.test(month))
        : [];
      const current = catalog.channels[channelId] || [];
      const next = [...new Set([...current, ...months])].sort();
      if (
        next.length === current.length &&
        next.every((month, index) => month === current[index])
      ) {
        return false;
      }
      catalog.channels[channelId] = next;
      return true;
    })
      .then(() => sendResponse?.({ ok: true }))
      .catch((error) =>
        sendResponse?.({ ok: false, reason: String(error?.message || error) }),
      );
    return true;
  }

  // 예측 대기 목록 변경(다중 탭 경합 방지).
  if (message.type === "LP_AWAITING") {
    // 베팅은 보유량에 먼저 반영되고 대기 목록·내역은 뒤따라 저장된다. 이 구간을
    // 자동 보정이 통과하면 같은 베팅을 '기타 사용'으로 먼저 기록할 수 있다.
    lpBeginWrite();
    void (async () => {
      try {
        const { accountId, mismatch } = await lpAccountFor(message.accountHint);
        if (!accountId) {
          // 불일치는 사유를 구분해 알린다(호출부는 둘 다 재시도한다).
          sendResponse?.({
            ok: false,
            reason: mismatch ? "account-mismatch" : "account-unknown",
          });
          return;
        }
        const p = message.payload || {};
        const res = await lpMutateAwaiting((list) =>
          message.op === "REMOVE"
            ? lpRemoveAwaiting(list, p.predictionId, accountId)
            : lpUpsertAwaiting(list, p.entry || {}, accountId),
        );
        sendResponse?.(
          res.ok
            ? { ok: true, changed: res.changed }
            : { ok: false, reason: res.reason || "awaiting-write-failed" },
        );
      } catch (error) {
        sendResponse?.({ ok: false, reason: String(error?.message || error) });
      } finally {
        lpEndWrite();
      }
    })();
    return true;
  }

  // 보유량 맞추기. 내역 페이지 진입·수동 버튼·알람이 모두 이 하나를 쓴다.
  if (message.type === "LP_RECONCILE") {
    void (async () => {
      try {
        sendResponse?.(await lpReconcileOnce());
      } catch (error) {
        sendResponse?.({ ok: false, reason: String(error?.message || error) });
      }
    })();
    return true;
  }

  // 통나무파워 내역 변경은 전부 여기로 모인다(단일 작성자).
  // ⚠ 계정을 정하지 못하면 기록하지 않고 보류한다 — accountId 없이 넣으면
  //   나중에 스냅샷 비교가 그 기록을 못 세어 같은 적립이 두 번 잡힌다.
  if (message.type === "LP_WRITE") {
    const op = String(message.op || "");
    const run = LP_WRITE_OPS[op];
    if (!run) {
      sendResponse?.({ ok: false, reason: "unknown-op" });
      return false;
    }
    // 계정 확인 전부터 '처리 중'으로 센다(보정이 이 틈에 끼어들지 않게).
    lpBeginWrite();
    void (async () => {
      try {
        const { accountId, verified, mismatch } = await lpAccountFor(
          message.accountHint,
        );
        // 백업 불러오기는 파일에 담긴 계정 정보를 그대로 쓴다 → 계정 확인 불필요.
        if (op === "IMPORT_LOG") {
          const applied = await lpEnqueueWrite(() =>
            lpMutateLog((list) => run(list, message.payload || {}, ""), true),
          );
          sendResponse?.({ ok: true, applied });
          return;
        }
        if (!accountId) {
          // ⚠ 불일치는 '계정을 모른다'와 다르다. 힌트가 API 와 어긋났으므로 그
          //   힌트를 소유자로 박아 보류하면, 나중에 drain 이 검증 없이 그 계정에
          //   기록한다 — 어느 계정에도 저장하지 않는다는 방침이 깨진다.
          //   보류를 만들지 않고 호출부가 다시 시도하게 한다(재시도는 멱등).
          if (mismatch) {
            sendResponse?.({ ok: false, reason: "account-mismatch" });
            return;
          }
          // 수동 작업은 사용자가 다시 시도할 수 있으므로 실패를 알린다.
          if (op === "UPSERT_MANUAL_ENTRY" || op === "DELETE_MANUAL_ENTRY") {
            sendResponse?.({ ok: false, reason: "account-unknown" });
            return;
          }
          await lpQueuePending(op, message.payload, message.accountHint);
          // ⚠ 성공으로 답하면 안 된다. 호출부가 '기록됨'으로 확정해 버려서
          //   보류분이 영영 반영되지 않는다(예측 recorded, 스냅샷 이동).
          sendResponse?.({
            ok: false,
            reason: "account-pending",
            pending: true,
          });
          return;
        }
        // 이 요청 전용 컨텍스트. 동시 요청끼리 섞이지 않는다.
        const ctx = { matched: true };
        const applied = await lpEnqueueWrite(() =>
          lpMutateLog((list) =>
            run(list, message.payload || {}, accountId, ctx),
          ),
        );
        // matched=false 면 대상이 없었다는 뜻 → 호출부가 재시도해야 한다.
        sendResponse?.({
          ok: ctx.matched,
          applied,
          verified,
          matched: ctx.matched,
          ...(ctx.matched ? {} : { reason: "no-target" }),
        });
      } catch (error) {
        sendResponse?.({ ok: false, reason: String(error?.message || error) });
      } finally {
        lpEndWrite();
      }
    })();
    return true; // 비동기 응답
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
    // ⚠ 꺼진 상태로 워커가 시작했으면 자동 보정 알람이 아예 없다. 다시 켤 때
    //   복구하지 않으면 워커·브라우저를 재시작할 때까지 60분 감지가 멈춘다.
    if (masterEnabled) void lpBootReconcile().catch(() => {});
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
      accountHint: message.accountHint,
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
