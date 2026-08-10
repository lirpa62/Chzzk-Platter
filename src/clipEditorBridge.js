// 클립 에디터 전용 설정 브리지(ISOLATED world).
// 일반 content.js를 클립 에디터에서 완전히 제외해도 정밀 구간 조정 설정만 MAIN world의
// clipEditorEnhancer.js에 전달할 수 있도록 필요한 저장값만 읽는다.
(() => {
  "use strict";

  if (window.top !== window || !location.pathname.startsWith("/clip-editor")) {
    return;
  }

  const FEATURE_MESSAGE = "cheese-feature-flags";
  const FEATURE_REQUEST = "cheese-feature-flags-request";
  const MASTER_KEY = "cheeseMasterEnabled";
  const FEATURE_KEY = "cheeseFeatureHidden";
  const ARROW_STEP_KEY = "cheeseClipEditorArrowStepS";
  const SHIFT_ARROW_STEP_KEY = "cheeseClipEditorShiftArrowStepS";
  const BOUNDARY_STEP_KEY = "cheeseClipEditorBoundaryStepS";
  const BOUNDARY_OUTER_STEP_KEY = "cheeseClipEditorBoundaryOuterStepS";
  const STORAGE_KEYS = [
    MASTER_KEY,
    FEATURE_KEY,
    ARROW_STEP_KEY,
    SHIFT_ARROW_STEP_KEY,
    BOUNDARY_STEP_KEY,
    BOUNDARY_OUTER_STEP_KEY,
  ];

  let payload = {
    source: FEATURE_MESSAGE,
    flags: { clipEditorPrecision: false },
    clipEditorArrowStep: 5,
    clipEditorShiftArrowStep: 0.1,
    clipEditorBoundaryStep: 0.1,
    clipEditorBoundaryOuterStep: 1,
  };

  function normalize(value, fallback, min, max, precision = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    const scale = 10 ** precision;
    return Math.min(
      max,
      Math.max(min, Math.round(number * scale) / scale),
    );
  }

  function broadcast() {
    window.postMessage(payload, location.origin);
  }

  async function loadAndBroadcast() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEYS);
      const masterEnabled = data?.[MASTER_KEY] !== false;
      const features =
        data?.[FEATURE_KEY] && typeof data[FEATURE_KEY] === "object"
          ? data[FEATURE_KEY]
          : {};
      payload = {
        source: FEATURE_MESSAGE,
        flags: {
          clipEditorPrecision:
            masterEnabled && features.clipEditorPrecision === true,
        },
        clipEditorArrowStep: normalize(data?.[ARROW_STEP_KEY], 5, 1, 5),
        clipEditorShiftArrowStep: normalize(
          data?.[SHIFT_ARROW_STEP_KEY],
          0.1,
          0.1,
          0.9,
          1,
        ),
        clipEditorBoundaryStep: normalize(
          data?.[BOUNDARY_STEP_KEY],
          0.1,
          0.1,
          1,
          1,
        ),
        clipEditorBoundaryOuterStep: normalize(
          data?.[BOUNDARY_OUTER_STEP_KEY],
          1,
          1,
          10,
        ),
      };
    } catch {
      // 저장소 접근 실패 시 기본값(정밀 조정 OFF)을 유지한다.
    }
    broadcast();
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== FEATURE_REQUEST) {
      return;
    }
    broadcast();
  });

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !STORAGE_KEYS.some((key) => changes[key])) return;
    void loadAndBroadcast();
  });

  void loadAndBroadcast();
})();
