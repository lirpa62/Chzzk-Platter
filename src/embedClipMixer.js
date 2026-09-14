// 치지직 embed/clip 프레임용 오디오 믹서. shorts 믹서와 오디오 규약은
// 공유하지만 pzp 컨트롤을 직접 사용하므로 별도 UI로 관리한다.
(async function () {
  "use strict";

  if (window.__cheeseEmbedClipMixerLoaded) return;
  window.__cheeseEmbedClipMixerLoaded = true;

  const MASTER_KEY = "cheeseMasterEnabled";
  // 라이브 및 shorts 믹서와 분리된 임베드 전용 설정이다.
  const HIDDEN_KEY = "cheeseEmbedClipMixerHidden";
  const ALWAYS_ON_KEY = "cheeseEmbedClipMixerAlwaysOn";
  const LEGACY_DEFAULT_ON_KEY = "cheeseEmbedClipMixerDefaultOn";
  const SELECTED_PRESET_KEY = "cheeseEmbedClipMixerPreset";
  const DEFAULT_PRESET_KEY = "cheeseEmbedClipMixerDefaultPreset";
  const DEFAULT_PRESET_ENABLED_KEY = "cheeseEmbedClipMixerDefaultPresetEnabled";
  const DEFAULT_GAIN_KEY = "cheeseEmbedClipMixerDefaultGain";
  const DEFAULT_GAIN_ENABLED_KEY = "cheeseEmbedClipMixerDefaultGainEnabled";
  const LAST_GAIN_KEY = "cheeseEmbedClipMixerGain";
  const GAIN_PCT_KEY = "cheeseEmbedClipGainPct";
  const GAIN_STEP_KEY = "cheeseEmbedClipGainStep";
  const GAIN_MIN_KEY = "cheeseEmbedClipGainMin";
  const GAIN_MAX_KEY = "cheeseEmbedClipGainMax";
  const WHEEL_ACTION_KEY = "cheeseEmbedClipMixerWheelAction";
  const EQ_BAND_MODE_KEY = "cheeseEmbedClipMixerEqBandMode";
  const CUSTOM_PRESETS_KEY = "audioMixer:presets";
  const EQ_BAND_SETS = {
    chzzk: [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000],
    iso: [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
  };
  const EQ_BAND_MODE_LABELS = {
    chzzk: "치즈 플래터 기본",
    iso: "표준 ISO 10밴드",
  };
  const EQ_BANDS = EQ_BAND_SETS.chzzk;
  const BUTTON_CLASS = "cheese-embed-clip-mixer-button";
  const ICON_CLASS = "cheese-embed-clip-mixer-button-icon";
  // 네이티브 볼륨 컨트롤의 배치를 공유하되 전용 클래스로 서로 구분한다.
  const CONTROL_CLASS = "cheese-embed-clip-mixer-control";
  const GAIN_SLIDER_CLASS = "cheese-embed-clip-mixer-gain";
  const GAIN_TOOLTIP_CLASS = "cheese-embed-clip-mixer-gain-tooltip";
  const PANEL_CLASS = "cheese-embed-clip-mixer-panel";
  // pzp 는 컨트롤 바가 보이는 동안에만 이 클래스를 붙인다.
  const CONTROLS_CLASS = "pzp-pc--controls";
  const CONTROLS_SELECTOR = ".pzp-pc__bottom-buttons-right";
  const FALLBACK_CONTROLS_SELECTOR = ".pzp-pc__bottom-buttons-left";
  const PLAYER_SELECTOR = ".pzp-pc";
  const SETTING_BUTTON_SELECTOR = ".pzp-pc__setting-button";
  const OBSERVER_RELEVANT_SELECTOR = [
    "video",
    CONTROLS_SELECTOR,
    FALLBACK_CONTROLS_SELECTOR,
    // 볼륨 컨트롤이 다시 그려지면 우리 래퍼의 앵커가 바뀌므로 재배치가 필요하다.
    ".pzp-pc__volume-control",
    `.${BUTTON_CLASS}`,
  ].join(",");
  const SYNC_DELAY_MS = 100;
  const NORM_INTERVAL_MS = 100;

  const DEFAULT_SNAPSHOT = {
    gain: 1.08,

    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

    comp: {
      enabled: true,
      threshold: -24,
      knee: 24,
      ratio: 3,
      attack: 0.005,
      release: 0.22,
      makeup: 0,
    },

    limiter: {
      enabled: true,
      threshold: -1,
    },

    normalizer: {
      enabled: false,
      target: 0.1,
    },
  };

  // 내장 프리셋은 기본 대역과 ISO 대역을 각각 직접 조율한다.
  const PRESETS = {
    default: {
      label: "기본",
      ...DEFAULT_SNAPSHOT,
      eqIso: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    musicOriginal: {
      label: "음악 균형",

      gain: 1.1,

      eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eqIso: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

      comp: {
        enabled: false,
        threshold: -18,
        knee: 20,
        ratio: 2,
        attack: 0.02,
        release: 0.35,
        makeup: 0,
      },

      limiter: {
        enabled: true,
        threshold: -1,
      },

      normalizer: {
        enabled: false,
        target: 0.09,
      },
    },

    musicRich: {
      label: "음악 생동감",

      gain: 1.1,

      eq: [
        1.5, // 60 Hz
        1, // 170 Hz
        0.5, // 310 Hz
        -0.5, // 600 Hz
        0, // 1 kHz
        0.5, // 3 kHz
        1, // 6 kHz
        1.5, // 12 kHz
        1, // 14 kHz
        0.5, // 16 kHz
      ],

      eqIso: [1.5, 1.5, 1, 0, -0.5, 0, 0.5, 1, 1.5, 0.8],

      comp: {
        enabled: true,
        threshold: -20,
        knee: 24,
        ratio: 2,
        attack: 0.015,
        release: 0.3,
        makeup: 0.5,
      },

      limiter: {
        enabled: true,
        threshold: -1,
      },

      normalizer: {
        enabled: false,
        target: 0.09,
      },
    },
    bassBoost: {
      label: "저음 강화",

      gain: 1.06,

      eq: [
        2.5, // 60 Hz  - sub/bass
        2, // 170 Hz - bass body
        0.8, // 310 Hz - warmth
        -0.5, // 600 Hz - muddiness 억제
        0, // 1 kHz
        0, // 3 kHz
        0.3, // 6 kHz
        0.3, // 12 kHz
        0, // 14 kHz
        0, // 16 kHz
      ],

      eqIso: [2, 2.5, 2, 1, -0.5, 0, 0, 0.2, 0.3, 0],

      normalizer: {
        enabled: false,
        target: 0.09,
      },

      comp: {
        enabled: true,
        threshold: -20,
        knee: 24,
        ratio: 2,
        attack: 0.015,
        release: 0.25,
        makeup: 0,
      },

      limiter: {
        enabled: true,
        threshold: -1,
      },
    },
    vocalBoost: {
      label: "보컬 강조",

      gain: 1.08,

      eq: [
        -0.8, // 60 Hz  - 보컬과 직접 관련 적음
        -0.5, // 170 Hz - 저역 마스킹 약간 억제
        0, // 310 Hz - 보컬 body 보존
        0.8, // 600 Hz
        1.5, // 1 kHz
        2, // 3 kHz - presence 핵심
        1.2, // 6 kHz - articulation
        0.5, // 12 kHz - air
        0, // 14 kHz
        0, // 16 kHz
      ],

      eqIso: [-1, -0.8, -0.5, 0, 0.8, 1.5, 2, 1.5, 0.8, 0],

      normalizer: {
        enabled: false,
        target: 0.09,
      },

      comp: {
        enabled: true,
        threshold: -20,
        knee: 24,
        ratio: 1.8,
        attack: 0.02,
        release: 0.3,
        makeup: 0,
      },

      limiter: {
        enabled: true,
        threshold: -1,
      },
    },
  };
  const PRESET_ORDER = Object.keys(PRESETS);

  function isEmbedClipFrame() {
    try {
      const url = new URL(location.href);
      return (
        url.origin === "https://chzzk.naver.com" &&
        url.pathname.startsWith("/embed/clip/")
      );
    } catch {
      return false;
    }
  }

  if (!isEmbedClipFrame()) return;

  let masterEnabled = true;
  let featureHidden = false;
  let autoEnable = false;
  let enabled = false;
  let autoEnableArmed = false;
  let autoEnableSuppressed = false;
  let autoResumePromise = null;
  let selectedPresetKey = "default";
  let presetSelectedWhileDisabled = false;
  let lastPresetKey = "default";
  let lastGain = null;
  let lastGainSaveTimer = 0;
  let defaultPresetKey = "default";
  let defaultPresetEnabled = true;
  // null이면 선택한 프리셋의 자체 gain을 사용한다.
  let defaultGain = null;
  let defaultGainEnabled = true;
  let presetLabel = PRESETS.default.label;
  let presetSnapshot = cloneSnapshot(PRESETS.default);
  let graphError = "";
  let control = null; // 버튼 + 게인 슬라이더 래퍼
  let button = null;
  let gainSlider = null;
  let gainTooltip = null;
  let gainTooltipHideTimer = 0;
  let observer = null;
  let syncTimer = 0;
  // 설정(임베드 전용). 값은 applyStoredSettings 에서 채운다.
  let gainPctOn = true;
  let mixerWheelAction = "preset";
  let customPresets = [];
  let eqBandMode = "chzzk";
  let panel = null;
  let panelAnchorRect = null;
  let panelTab = "builtin";
  let panelInfoMode = "";
  let gainStep = 5; // %
  let gainMin = 0.5;
  let gainMax = 2;
  // 사용자가 슬라이더로 조절한 게인. 프리셋의 gain 위에 곱해지는 게 아니라
  // 프리셋 gain 을 대체한다(네이티브 믹서와 같은 규약).
  let userGain = null;
  let gainDragging = false;
  let gainHovering = false; // 버튼/슬라이더 위에 포인터가 있는가
  let controlsKeepAlive = false;
  let controlsKeepAliveObserver = null;

  const GAIN_MIN_ALLOWED = [0.5, 0.25, 0.1, 0];
  const GAIN_MAX_ALLOWED = [2, 3];

  function clampGainStep(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 5;
    return Math.min(10, Math.max(1, Math.round(n)));
  }

  // 현재 적용할 게인. 사용자가 만진 적 없으면 프리셋 값을 그대로 쓴다.
  function currentGain() {
    const base = userGain === null ? presetSnapshot.gain : userGain;
    return Math.min(gainMax, Math.max(gainMin, base));
  }

  const audio = {
    ctx: null,
    source: null,
    video: null,
    normalizerVideo: null,
    masterGain: null,
    normGain: null,
    analyser: null,
    eqFilters: [],
    comp: null,
    outputGain: null,
    limiter: null,
    normTimer: 0,
    connected: false,
  };

  // ⚠ createMediaElementSource 는 같은 video 로 두 번 호출하면 InvalidStateError 다.
  // 클립이 바뀌어도 video 엘리먼트는 재사용될 수 있어 source 를 캐시해 재사용한다.
  const mediaSourceCache = new WeakMap();

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function cloneSnapshot(value) {
    const source = value && typeof value === "object" ? value : {};
    const limiter =
      typeof source.limiter === "number"
        ? { enabled: true, threshold: source.limiter }
        : source.limiter;
    const normalizer =
      typeof source.normalizer === "boolean"
        ? { enabled: source.normalizer, target: source.targetLevel }
        : source.normalizer;

    return {
      gain: finite(source.gain, DEFAULT_SNAPSHOT.gain),
      eq: DEFAULT_SNAPSHOT.eq.map((fallback, index) =>
        finite(source.eq?.[index], fallback),
      ),
      comp: {
        ...DEFAULT_SNAPSHOT.comp,
        ...(source.comp || {}),
        enabled:
          source.comp?.enabled === undefined
            ? DEFAULT_SNAPSHOT.comp.enabled
            : source.comp.enabled === true,
      },
      limiter: {
        ...DEFAULT_SNAPSHOT.limiter,
        ...(limiter || {}),
        enabled:
          limiter?.enabled === undefined
            ? DEFAULT_SNAPSHOT.limiter.enabled
            : limiter.enabled === true,
        threshold: finite(
          limiter?.threshold,
          DEFAULT_SNAPSHOT.limiter.threshold,
        ),
      },
      normalizer: {
        ...DEFAULT_SNAPSHOT.normalizer,
        ...(normalizer || {}),
        enabled:
          normalizer?.enabled === undefined
            ? DEFAULT_SNAPSHOT.normalizer.enabled
            : normalizer.enabled === true,
        target: finite(normalizer?.target, DEFAULT_SNAPSHOT.normalizer.target),
      },
    };
  }

  function normalizePresetKey(value) {
    const key = String(value || "default");
    return Object.prototype.hasOwnProperty.call(PRESETS, key) ? key : "default";
  }

  const CUSTOM_PREFIX = "custom:";

  function normalizeEqBandMode(value) {
    return value === "iso" ? "iso" : "chzzk";
  }

  function normalizeCustomPresets(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((preset) => {
        if (!preset || typeof preset !== "object") return null;
        const id = String(preset.id || "");
        const name = String(preset.name || "").trim();
        const snapshot = preset.snapshot || preset;
        if (!id || !name || !Array.isArray(snapshot?.eq)) return null;
        return {
          id,
          name,
          eqType: normalizeEqBandMode(preset.eqType),
          snapshot: cloneSnapshot(snapshot),
        };
      })
      .filter(Boolean);
  }

  function customPresetById(id) {
    return customPresets.find((preset) => preset.id === id) || null;
  }

  function convertEqBetweenModes(values, fromMode, toMode) {
    const sourceMode = normalizeEqBandMode(fromMode);
    const targetMode = normalizeEqBandMode(toMode);
    const sourceValues = DEFAULT_SNAPSHOT.eq.map((fallback, index) =>
      finite(values?.[index], fallback),
    );
    if (sourceMode === targetMode) return sourceValues;

    const sourceBands = EQ_BAND_SETS[sourceMode];
    const targetBands = EQ_BAND_SETS[targetMode];
    const sourceLogs = sourceBands.map((frequency) => Math.log2(frequency));
    return targetBands.map((frequency) => {
      const targetLog = Math.log2(frequency);
      let upperIndex = sourceLogs.findIndex((value) => value >= targetLog);
      if (upperIndex < 0) {
        return Math.round(sourceValues[sourceValues.length - 1] * 10) / 10;
      }
      if (upperIndex === 0) return Math.round(sourceValues[0] * 10) / 10;
      const lowerIndex = upperIndex - 1;
      const span = sourceLogs[upperIndex] - sourceLogs[lowerIndex];
      const ratio = span ? (targetLog - sourceLogs[lowerIndex]) / span : 0;
      const interpolated =
        sourceValues[lowerIndex] +
        (sourceValues[upperIndex] - sourceValues[lowerIndex]) * ratio;
      return Math.round(interpolated * 10) / 10;
    });
  }

  function presetSource(value) {
    const raw = String(value || "default");
    if (raw.startsWith(CUSTOM_PREFIX)) {
      const custom = customPresetById(raw.slice(CUSTOM_PREFIX.length));
      if (custom) {
        return {
          key: raw,
          label: custom.name,
          eqType: custom.eqType,
          snapshot: custom.snapshot,
        };
      }
    }
    const key = normalizePresetKey(raw);
    return {
      key,
      label: PRESETS[key].label,
      eqType: "chzzk",
      snapshot: PRESETS[key],
    };
  }

  function snapshotForPreset(value) {
    const source = presetSource(value);
    const snapshot = cloneSnapshot(source.snapshot);
    const builtInIso =
      !source.key.startsWith(CUSTOM_PREFIX) &&
      eqBandMode === "iso" &&
      Array.isArray(source.snapshot.eqIso) &&
      source.snapshot.eqIso.length === EQ_BAND_SETS.iso.length;
    snapshot.eq = builtInIso
      ? source.snapshot.eqIso.map((value, index) =>
          finite(value, DEFAULT_SNAPSHOT.eq[index]),
        )
      : convertEqBetweenModes(snapshot.eq, source.eqType, eqBandMode);
    return { ...source, snapshot };
  }

  function setPresetState(value) {
    const next = snapshotForPreset(value);
    if (next.key === selectedPresetKey) return false;
    selectedPresetKey = next.key;
    presetLabel = next.label;
    presetSnapshot = next.snapshot;
    // 일반 믹서와 마찬가지로 프리셋을 바꾸면 그 프리셋의 기본 게인부터 시작한다.
    userGain = null;
    return true;
  }

  function prepareMixerActivation() {
    const next = snapshotForPreset(
      defaultPresetEnabled ? defaultPresetKey : lastPresetKey,
    );
    selectedPresetKey = next.key;
    presetLabel = next.label;
    presetSnapshot = next.snapshot;
    const activationGain = defaultGainEnabled ? defaultGain : lastGain;
    userGain = Number.isFinite(activationGain)
      ? Math.min(gainMax, Math.max(gainMin, activationGain))
      : null;
    presetSelectedWhileDisabled = false;
  }

  function selectPreset(value) {
    // 저장소 갱신 중에도 비활성 상태에서 방금 고른 프리셋을 유지한다.
    if (!enabled) presetSelectedWhileDisabled = true;
    const changed = setPresetState(value);
    if (changed) {
      if (lastGainSaveTimer) {
        clearTimeout(lastGainSaveTimer);
        lastGainSaveTimer = 0;
      }
      lastPresetKey = selectedPresetKey;
      lastGain = null;
      void chrome.storage.local.set({
        [SELECTED_PRESET_KEY]: lastPresetKey,
        [LAST_GAIN_KEY]: null,
      });
    }
    if (changed && enabled && audio.connected) applySnapshot();
    if (changed) updateButton();
    if (panel) renderPanel();
    return changed;
  }

  function setEqBandMode(value, { persist = true } = {}) {
    const nextMode = normalizeEqBandMode(value);
    if (nextMode === eqBandMode) return false;
    eqBandMode = nextMode;

    const gainOverride = userGain;
    const next = snapshotForPreset(selectedPresetKey);
    selectedPresetKey = next.key;
    presetLabel = next.label;
    presetSnapshot = next.snapshot;
    userGain = gainOverride;

    if (enabled && audio.connected) applySnapshot();
    updateButton();
    if (panel) renderPanel();
    if (persist) {
      void chrome.storage.local.set({ [EQ_BAND_MODE_KEY]: eqBandMode });
    }
    return true;
  }

  function cyclePreset(direction) {
    const currentIndex = PRESET_ORDER.indexOf(selectedPresetKey);
    const baseIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex =
      (((baseIndex + direction) % PRESET_ORDER.length) + PRESET_ORDER.length) %
      PRESET_ORDER.length;
    selectPreset(PRESET_ORDER[nextIndex]);
  }

  function applyStoredSettings(data) {
    const previousAutoEnable = autoEnable;
    masterEnabled = data?.[MASTER_KEY] !== false;
    featureHidden = data?.[HIDDEN_KEY] === true;
    autoEnable =
      data?.[ALWAYS_ON_KEY] === true || data?.[LEGACY_DEFAULT_ON_KEY] === true;
    gainPctOn = data?.[GAIN_PCT_KEY] !== false; // 미설정=표시
    mixerWheelAction = data?.[WHEEL_ACTION_KEY] === "gain" ? "gain" : "preset";
    customPresets = normalizeCustomPresets(data?.[CUSTOM_PRESETS_KEY]);
    eqBandMode = normalizeEqBandMode(data?.[EQ_BAND_MODE_KEY]);
    gainStep = clampGainStep(data?.[GAIN_STEP_KEY]);
    gainMin = GAIN_MIN_ALLOWED.includes(Number(data?.[GAIN_MIN_KEY]))
      ? Number(data[GAIN_MIN_KEY])
      : 0.5;
    gainMax = GAIN_MAX_ALLOWED.includes(Number(data?.[GAIN_MAX_KEY]))
      ? Number(data[GAIN_MAX_KEY])
      : 2;
    lastPresetKey = presetSource(data?.[SELECTED_PRESET_KEY]).key;
    const storedLastGain = data?.[LAST_GAIN_KEY];
    lastGain =
      typeof storedLastGain === "number" && Number.isFinite(storedLastGain)
        ? Math.min(gainMax, Math.max(gainMin, storedLastGain))
        : null;
    defaultPresetKey = normalizePresetKey(
      data?.[DEFAULT_PRESET_KEY] || data?.[SELECTED_PRESET_KEY],
    );
    defaultPresetEnabled = data?.[DEFAULT_PRESET_ENABLED_KEY] !== false;
    const storedDefaultGain = data?.[DEFAULT_GAIN_KEY];
    defaultGain =
      typeof storedDefaultGain === "number" &&
      Number.isFinite(storedDefaultGain)
        ? Math.min(gainMax, Math.max(gainMin, storedDefaultGain))
        : null;
    defaultGainEnabled = data?.[DEFAULT_GAIN_ENABLED_KEY] !== false;
    if (!enabled && !presetSelectedWhileDisabled) {
      prepareMixerActivation();
    } else {
      const gainOverride = userGain;
      const current = snapshotForPreset(selectedPresetKey);
      selectedPresetKey = current.key;
      presetLabel = current.label;
      presetSnapshot = current.snapshot;
      userGain =
        gainOverride === null
          ? null
          : Math.min(gainMax, Math.max(gainMin, gainOverride));
    }
    if (panel) renderPanel();

    if (!masterEnabled || featureHidden) {
      disarmAutoEnable();
      disableMixer();
      removeButton();
      return;
    }

    if (enabled && audio.connected) applySnapshot();
    if (autoEnable && !previousAutoEnable) {
      autoEnableSuppressed = false;
    }
    if (autoEnable && !enabled && !autoEnableSuppressed) armAutoEnable();
    else if (!autoEnable) disarmAutoEnable();
    scheduleSync();
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get([
        MASTER_KEY,
        HIDDEN_KEY,
        GAIN_PCT_KEY,
        GAIN_STEP_KEY,
        GAIN_MIN_KEY,
        GAIN_MAX_KEY,
        ALWAYS_ON_KEY,
        LEGACY_DEFAULT_ON_KEY,
        SELECTED_PRESET_KEY,
        DEFAULT_PRESET_KEY,
        DEFAULT_PRESET_ENABLED_KEY,
        DEFAULT_GAIN_KEY,
        DEFAULT_GAIN_ENABLED_KEY,
        LAST_GAIN_KEY,
        WHEEL_ACTION_KEY,
        EQ_BAND_MODE_KEY,
        CUSTOM_PRESETS_KEY,
      ]);
      applyStoredSettings(data);
    } catch {
      applyStoredSettings({});
    }
  }

  function visibleArea(element) {
    if (!(element instanceof Element)) return 0;
    const rect = element.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function findPlayer() {
    return document.querySelector(PLAYER_SELECTOR);
  }

  function findActiveVideo() {
    const videos = Array.from(document.querySelectorAll("video")).filter(
      (video) => visibleArea(video) > 0,
    );
    if (!videos.length) return null;
    return (
      videos.find((video) => !video.paused && !video.ended) ||
      videos.sort((a, b) => visibleArea(b) - visibleArea(a))[0]
    );
  }

  // 임베드 플레이어의 우측 컨트롤(설정/전체화면)에 붙인다. 우측 그룹이 아직 없으면
  // 좌측(볼륨/시간)으로 폴백한다 — 레이아웃 옵션에 따라 그룹 구성이 달라질 수 있다.
  function findControls() {
    const player = findPlayer();
    if (!player) return null;
    return (
      player.querySelector(CONTROLS_SELECTOR) ||
      player.querySelector(FALLBACK_CONTROLS_SELECTOR)
    );
  }

  function mixerIcon() {
    return `
      <svg width="26" height="26" viewBox="0 0 36 36" fill="none"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle class="cheese-embed-clip-mixer-dot" cx="28" cy="25" r="3"></circle>
        <path d="M12 9v8m0 4v6M18 9v13m0 4v1M24 9v4m0 4v10"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <circle cx="12" cy="19" r="2.5" stroke="currentColor"
          stroke-width="2"></circle>
        <circle cx="18" cy="24" r="2.5" stroke="currentColor"
          stroke-width="2"></circle>
        <circle cx="24" cy="15" r="2.5" stroke="currentColor"
          stroke-width="2"></circle>
      </svg>`;
  }

  function updateButton() {
    if (!button) return;
    const tooltip = button.querySelector(".pzp-button__tooltip");
    const active = enabled && audio.connected;
    button.classList.toggle("is-active", active);
    button.classList.toggle("is-error", Boolean(graphError));
    if (graphError) {
      button.setAttribute("aria-label", graphError);
      button.setAttribute("aria-pressed", "false");
      if (tooltip) tooltip.textContent = graphError;
      return;
    }
    const gainLabel = gainPctOn ? ` · ${Math.round(currentGain() * 100)}%` : "";
    const detail = `${presetLabel}${gainLabel}`;
    const label = active ? `오디오 믹서 (${detail})` : "오디오 믹서 켜기";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(active));
    if (tooltip) tooltip.textContent = label;
    syncGainSlider();
  }

  // 믹서 버튼 + 게인 슬라이더를 감싸는 래퍼. 네이티브 볼륨 컨트롤
  // (.pzp-pc__volume-control)이 '버튼 + 슬라이더'를 한 묶음으로 두는 것과 같은 구조라,
  // 그 바로 오른쪽에 붙이면 임베드 컨트롤 바에 자연스럽게 이어진다.
  function ensureButton() {
    if (!masterEnabled || featureHidden) return;
    const anchor = findVolumeControl();
    // 볼륨 컨트롤이 있으면 그 오른쪽(형제), 없으면 기존처럼 우측 그룹으로 폴백한다.
    const parent = anchor?.parentElement || findControls();
    if (!parent) return;

    if (!control) {
      control = document.createElement("div");
      control.className = `pzp-pc__volume-control ${CONTROL_CLASS}`;
      bindGainHover(control);
    }
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = `pzp-button ${BUTTON_CLASS}`;
      button.innerHTML =
        `<span class="pzp-button__tooltip pzp-button__tooltip--top"></span>` +
        `<span class="pzp-ui-icon ${ICON_CLASS}">${mixerIcon()}</span>`;
      button.addEventListener("click", onButtonClick);
      control.appendChild(button);
    }

    // 재삽입 루프를 막기 위해 앵커 다음 형제인지 직접 확인한다.
    const inPlace = anchor
      ? control.parentElement === parent && anchor.nextSibling === control
      : control.parentElement === parent;
    if (!inPlace) {
      if (anchor) anchor.after(control);
      else {
        const settingButton = parent.querySelector(SETTING_BUTTON_SELECTOR);
        parent.insertBefore(control, settingButton || parent.firstChild);
      }
    }
    ensureGainSlider();
    updateButton();
  }

  // 네이티브 볼륨 컨트롤(우리 래퍼가 아닌 것). 임베드는 좌측 그룹에 있다.
  function findVolumeControl() {
    const player = findPlayer();
    if (!player) return null;
    return (
      Array.from(player.querySelectorAll(".pzp-pc__volume-control")).find(
        (el) => !el.classList.contains(CONTROL_CLASS),
      ) || null
    );
  }

  function removeButton() {
    closePanel();
    // 컨트롤 바를 붙잡고 있었다면 반드시 놓아 준다(옵저버 누수 방지).
    keepControlsAlive(false);
    if (gainTooltipHideTimer) {
      clearTimeout(gainTooltipHideTimer);
      gainTooltipHideTimer = 0;
    }
    gainHovering = false;
    gainDragging = false;
    control?.remove();
    control = null;
    button = null;
    gainSlider = null;
    gainTooltip = null;
  }

  function getMediaSource(video) {
    const cached = mediaSourceCache.get(video);
    if (cached) return cached;
    const source = audio.ctx.createMediaElementSource(video);
    mediaSourceCache.set(video, source);
    return source;
  }

  function showGraphError(error) {
    graphError =
      error?.name === "InvalidStateError"
        ? "다른 확장과 충돌해 믹서를 쓸 수 없습니다"
        : "오디오 믹서를 연결하지 못했습니다";
    updateButton();
  }

  function stopNormalizer() {
    if (audio.normTimer) clearInterval(audio.normTimer);
    audio.normTimer = 0;
    if (audio.normGain && audio.ctx) {
      try {
        audio.normGain.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.1);
      } catch {}
    }
  }

  function syncNormalizerActivity() {
    const shouldRun =
      audio.connected &&
      presetSnapshot.normalizer.enabled &&
      audio.video instanceof HTMLVideoElement &&
      !audio.video.paused &&
      !audio.video.ended;
    if (shouldRun) {
      if (!audio.normTimer) startNormalizer();
    } else if (audio.normTimer) {
      stopNormalizer();
    }
  }

  function bindNormalizerVideo(video) {
    if (audio.normalizerVideo === video) return;
    unbindNormalizerVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    audio.normalizerVideo = video;
    for (const type of ["playing", "pause", "ended", "emptied"]) {
      video.addEventListener(type, syncNormalizerActivity);
    }
  }

  function unbindNormalizerVideo() {
    const video = audio.normalizerVideo;
    if (!(video instanceof HTMLVideoElement)) {
      audio.normalizerVideo = null;
      return;
    }
    for (const type of ["playing", "pause", "ended", "emptied"]) {
      video.removeEventListener(type, syncNormalizerActivity);
    }
    audio.normalizerVideo = null;
  }

  function startNormalizer() {
    stopNormalizer();
    if (
      !audio.connected ||
      !presetSnapshot.normalizer.enabled ||
      !(audio.video instanceof HTMLVideoElement) ||
      audio.video.paused ||
      audio.video.ended
    ) {
      return;
    }

    const buffer = new Float32Array(audio.analyser.fftSize);
    audio.normTimer = setInterval(() => {
      if (
        !audio.connected ||
        !presetSnapshot.normalizer.enabled ||
        audio.video?.paused ||
        audio.video?.ended
      ) {
        stopNormalizer();
        return;
      }
      audio.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      if (rms <= 0.0008) return;

      const desired = Math.min(
        4,
        Math.max(0.25, presetSnapshot.normalizer.target / rms),
      );
      audio.normGain.gain.setTargetAtTime(desired, audio.ctx.currentTime, 0.6);
    }, NORM_INTERVAL_MS);
  }

  function applySnapshot() {
    if (!audio.connected) return;

    audio.masterGain.gain.value = currentGain();
    const bands = EQ_BAND_SETS[eqBandMode];
    presetSnapshot.eq.forEach((gain, index) => {
      const filter = audio.eqFilters[index];
      if (!filter) return;
      if (filter.frequency.value !== bands[index]) {
        filter.frequency.value = bands[index];
      }
      filter.gain.value = gain;
    });

    const comp = presetSnapshot.comp;
    audio.comp.threshold.value = comp.enabled ? finite(comp.threshold, -24) : 0;
    audio.comp.knee.value = finite(comp.knee, 24);
    audio.comp.ratio.value = comp.enabled ? finite(comp.ratio, 4) : 1;
    audio.comp.attack.value = finite(comp.attack, 0.003);
    audio.comp.release.value = finite(comp.release, 0.25);
    audio.outputGain.gain.value = Math.pow(
      10,
      (comp.enabled ? finite(comp.makeup, 0) : 0) / 20,
    );

    const limiter = presetSnapshot.limiter;
    audio.limiter.threshold.value = limiter.enabled
      ? finite(limiter.threshold, -1)
      : 0;
    audio.limiter.ratio.value = limiter.enabled ? 20 : 1;

    if (presetSnapshot.normalizer.enabled) startNormalizer();
    else stopNormalizer();
  }

  function restoreOriginalAudio({
    restoreSource = true,
    preserveSource = false,
  } = {}) {
    stopNormalizer();
    unbindNormalizerVideo();
    const previousSource = audio.source;
    const previousVideo = audio.video;
    try {
      if (audio.source && audio.ctx) {
        audio.source.disconnect();
        if (restoreSource) audio.source.connect(audio.ctx.destination);
      }
    } catch {}
    const nodes = [
      audio.masterGain,
      audio.normGain,
      audio.analyser,
      ...audio.eqFilters,
      audio.comp,
      audio.outputGain,
      audio.limiter,
    ];
    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch {}
    }
    audio.masterGain = null;
    audio.normGain = null;
    audio.analyser = null;
    audio.eqFilters = [];
    audio.comp = null;
    audio.outputGain = null;
    audio.limiter = null;
    audio.source = preserveSource ? previousSource : null;
    audio.video = preserveSource ? previousVideo : null;
    audio.connected = false;
  }

  // 그래프: source → normGain → [EQ peaking ×10] → comp → outputGain(makeup)
  //         → masterGain → limiter → destination
  // 라이브/shorts 믹서와 동일한 순서다. 마스터 게인을 컴프레서 뒤에 두는 이유도 같다.
  function connectGraph(video) {
    try {
      graphError = "";
      audio.ctx ||= createAudioContext();
      if (audio.ctx.state !== "running") audio.ctx.resume().catch(() => {});

      if (audio.connected || audio.source) {
        restoreOriginalAudio({ restoreSource: false });
      }

      audio.source = getMediaSource(video);
      audio.video = video;
      bindNormalizerVideo(video);
      audio.masterGain = audio.ctx.createGain();
      audio.normGain = audio.ctx.createGain();
      audio.analyser = audio.ctx.createAnalyser();
      audio.analyser.fftSize = 1024;
      audio.analyser.smoothingTimeConstant = 0.8;
      audio.eqFilters = EQ_BANDS.map((frequency) => {
        const filter = audio.ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = 1.1;
        return filter;
      });
      audio.comp = audio.ctx.createDynamicsCompressor();
      audio.outputGain = audio.ctx.createGain();
      audio.limiter = audio.ctx.createDynamicsCompressor();
      audio.limiter.knee.value = 0;
      audio.limiter.attack.value = 0.001;
      audio.limiter.release.value = 0.1;

      audio.source.disconnect();
      audio.source.connect(audio.normGain);
      audio.source.connect(audio.analyser);
      let node = audio.normGain;
      for (const filter of audio.eqFilters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(audio.comp);
      audio.comp.connect(audio.outputGain);
      audio.outputGain.connect(audio.masterGain);
      audio.masterGain.connect(audio.limiter);
      audio.limiter.connect(audio.ctx.destination);

      audio.connected = true;
      applySnapshot();
      updateButton();
      return true;
    } catch (error) {
      restoreOriginalAudio();
      showGraphError(error);
      return false;
    }
  }

  // CPU 부하 중 오디오 언더런을 줄이기 위해 명시적인 지연 힌트를 사용한다.
  function createAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("AudioContext unsupported");
    try {
      return new Ctx({ latencyHint: "playback" });
    } catch {
      return new Ctx();
    }
  }

  function disableMixer() {
    enabled = false;
    restoreOriginalAudio();
    updateButton();
  }

  const AUTO_ENABLE_EVENTS = ["pointerdown", "keydown"];

  function disarmAutoEnable() {
    if (!autoEnableArmed) return;
    autoEnableArmed = false;
    for (const type of AUTO_ENABLE_EVENTS) {
      document.removeEventListener(type, onAutoEnableGesture, true);
    }
  }

  function armAutoEnable() {
    if (
      autoEnableArmed ||
      !autoEnable ||
      enabled ||
      autoEnableSuppressed ||
      !masterEnabled ||
      featureHidden
    ) {
      return;
    }
    autoEnableArmed = true;
    for (const type of AUTO_ENABLE_EVENTS) {
      document.addEventListener(type, onAutoEnableGesture, {
        capture: true,
        passive: true,
      });
    }
  }

  // 외부 사이트 임베드는 프레임에 사용자 활성화가 없을 수 있다. running 이 확인되기
  // 전에 video 를 그래프에 물리면 원음까지 끊기므로, 상태를 먼저 본다.
  function tryAutoEnableWithoutGesture() {
    if (
      !autoEnable ||
      enabled ||
      autoEnableSuppressed ||
      !masterEnabled ||
      featureHidden
    ) {
      return;
    }

    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) {
      armAutoEnable();
      return;
    }

    // 활성화 이력이 없으면 AudioContext 를 만들지도 않는다. suspended 컨텍스트를
    // 미리 만들어 봐야 제스처 전엔 못 쓰고, 경고만 유발한다.
    if (!audio.ctx && navigator.userActivation?.hasBeenActive === false) {
      armAutoEnable();
      return;
    }

    try {
      audio.ctx ||= createAudioContext();
    } catch (error) {
      autoEnableSuppressed = true;
      showGraphError(error);
      disarmAutoEnable();
      return;
    }

    if (audio.ctx.state !== "running") {
      armAutoEnable();
      // 사용자 활성화가 없는 프레임에서는 resume을 시도하지 않고 제스처를 기다린다.
      const canResume = navigator.userActivation
        ? navigator.userActivation.hasBeenActive
        : true;
      if (canResume && !autoResumePromise) {
        const pendingContext = audio.ctx;
        autoResumePromise = pendingContext
          .resume()
          .catch(() => {})
          .finally(() => {
            autoResumePromise = null;
            if (
              pendingContext === audio.ctx &&
              pendingContext.state === "running" &&
              autoEnable &&
              !enabled &&
              !autoEnableSuppressed &&
              masterEnabled &&
              !featureHidden
            ) {
              scheduleSync();
            }
          });
      }
      return;
    }

    prepareMixerActivation();
    enabled = true;
    if (!connectGraph(video)) {
      autoEnableSuppressed = true;
      disarmAutoEnable();
      return;
    }
    disarmAutoEnable();
    updateButton();
  }

  function onAutoEnableGesture(event) {
    if (event.target?.closest?.(`.${BUTTON_CLASS}`)) return;
    if (!autoEnable || !masterEnabled || featureHidden) {
      disarmAutoEnable();
      return;
    }

    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    prepareMixerActivation();
    enabled = true;
    if (!connectGraph(video)) {
      autoEnableSuppressed = true;
      disarmAutoEnable();
      return;
    }
    autoEnableSuppressed = false;
    disarmAutoEnable();
    updateButton();
  }

  function onButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    toggleMixer();
  }

  // 키보드 방향키로 게인을 한 단계 올리고/내린다. 설정의 조절 간격(1~10%)을 쓴다.
  function nudgeGain(direction) {
    if (!(enabled && audio.connected)) return;
    const step = gainStep / 100;
    const current = currentGain();
    const next = Math.min(
      gainMax,
      Math.max(gainMin, Math.round((current + direction * step) * 100) / 100),
    );
    if (next === current) return;
    setGain(next);
  }

  function setGain(value) {
    const nextGain = Math.min(gainMax, Math.max(gainMin, Number(value) || 0));
    if (nextGain === userGain) return;
    userGain = nextGain;
    lastGain = userGain;
    if (lastGainSaveTimer) clearTimeout(lastGainSaveTimer);
    lastGainSaveTimer = setTimeout(() => {
      lastGainSaveTimer = 0;
      void chrome.storage.local.set({ [LAST_GAIN_KEY]: lastGain });
    }, 120);
    if (audio.connected && audio.masterGain && audio.ctx) {
      audio.masterGain.gain.setTargetAtTime(
        currentGain(),
        audio.ctx.currentTime,
        0.02,
      );
    }
    updateButton();
  }

  // 게인 조작 중에는 pzp가 컨트롤 표시 클래스를 제거하지 못하게 유지한다.
  function keepControlsAlive(on) {
    const player = findPlayer();
    if (!player) return;
    controlsKeepAlive = on;
    if (!on) {
      controlsKeepAliveObserver?.disconnect();
      controlsKeepAliveObserver = null;
      return;
    }
    if (!player.classList.contains(CONTROLS_CLASS)) {
      player.classList.add(CONTROLS_CLASS);
    }
    if (controlsKeepAliveObserver) return;
    controlsKeepAliveObserver = new MutationObserver(() => {
      if (!controlsKeepAlive) return;
      if (!player.classList.contains(CONTROLS_CLASS)) {
        player.classList.add(CONTROLS_CLASS);
      }
    });
    controlsKeepAliveObserver.observe(player, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // 활성 상태에서 호버하거나 드래그하는 동안만 슬라이더를 펼친다.
  function syncGainVisibility() {
    if (!control) return;
    const active = enabled && audio.connected;
    const open = active && (gainHovering || gainDragging);
    if (control.classList.contains("is-open") !== open) {
      control.classList.toggle("is-open", open);
    }
    // 슬라이더가 펼쳐져 있는 동안에는 컨트롤 바를 붙잡아 둔다.
    const shouldHold = open || Boolean(panel);
    if (shouldHold !== controlsKeepAlive) keepControlsAlive(shouldHold);
  }

  // 래퍼(버튼+슬라이더) 전체를 하나의 호버 영역으로 본다. 버튼에서 슬라이더로
  // 포인터가 옮겨갈 때 중간에 닫히지 않는다.
  function bindGainHover(el) {
    el.addEventListener("pointerenter", () => {
      gainHovering = true;
      syncGainVisibility();
    });
    el.addEventListener("pointerleave", () => {
      gainHovering = false;
      syncGainVisibility();
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    panelAnchorRect = null;
    panelInfoMode = "";
    document.removeEventListener("pointerdown", onPanelOutside, true);
    document.removeEventListener("keydown", onPanelKey, true);
    window.removeEventListener("resize", closePanel);
    document.removeEventListener("fullscreenchange", closePanel);
    document.removeEventListener("webkitfullscreenchange", closePanel);
    syncGainVisibility();
  }

  function onPanelOutside(event) {
    if (!panel || panel.contains(event.target)) return;
    if (event.target?.closest?.(`.${BUTTON_CLASS}`)) return;
    closePanel();
  }

  function onPanelKey(event) {
    if (event.key !== "Escape" || !panel) return;
    event.preventDefault();
    event.stopPropagation();
    closePanel();
    button?.focus?.();
  }

  function presetRowHtml(key, label) {
    const selected = key === selectedPresetKey;
    return (
      `<button type="button" class="${PANEL_CLASS}-item${selected ? " is-on" : ""}" ` +
      `data-preset-key="${escapeAttr(key)}" role="option" ` +
      `aria-selected="${selected}">` +
      `<span class="${PANEL_CLASS}-name">${escapeHtml(label)}</span>` +
      `</button>`
    );
  }

  function renderPanel() {
    if (!panel) return;
    const presets =
      panelTab === "custom"
        ? customPresets.length
          ? customPresets
              .map((preset) =>
                presetRowHtml(`${CUSTOM_PREFIX}${preset.id}`, preset.name),
              )
              .join("")
          : // 이 패널은 고르기만 한다(프리셋 추가는 없다). 어디서 만드는지 알려 준다.
            `<p class="${PANEL_CLASS}-empty">저장된 커스텀 프리셋이 없습니다.` +
            `<span>치지직 라이브·다시보기 플레이어의 오디오 믹서에서 만들면 ` +
            `여기에도 나타납니다.</span></p>`
        : PRESET_ORDER.map((key) =>
            presetRowHtml(key, PRESETS[key].label),
          ).join("");

    const modeInfo = panelInfoMode
      ? `<div class="${PANEL_CLASS}-mode-info" role="note">${
          panelInfoMode === "iso"
            ? "31.5Hz~16kHz를 표준 1옥타브 간격으로 나눠 저음 구간을 더 세밀하게 조절합니다."
            : "60Hz~16kHz의 치즈 플래터 기존 대역으로, 중·고음 구간을 더 세밀하게 조절합니다."
        }</div>`
      : "";

    panel.dataset.activeTab = panelTab;
    panel.innerHTML =
      `<div class="${PANEL_CLASS}-header">` +
      `<strong class="${PANEL_CLASS}-title">오디오 믹서</strong>` +
      `<button type="button" class="${PANEL_CLASS}-close" data-panel-close aria-label="닫기" title="닫기">` +
      `<svg class="lucide lucide-x" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M18 6 6 18M6 6l12 12"></path></svg></button>` +
      `</div>` +
      `<div class="${PANEL_CLASS}-section-label">이퀄라이저 대역</div>` +
      `<div class="${PANEL_CLASS}-modes" role="group" aria-label="이퀄라이저 대역">` +
      Object.entries(EQ_BAND_MODE_LABELS)
        .map(
          ([key, label]) =>
            `<div class="${PANEL_CLASS}-mode-option">` +
            `<button type="button" class="${PANEL_CLASS}-mode${eqBandMode === key ? " is-on" : ""}" ` +
            `data-eq-mode="${key}" aria-pressed="${eqBandMode === key}" title="${escapeAttr(label)}">` +
            `${key === "iso" ? "ISO 10밴드" : "기본"}</button>` +
            `<button type="button" class="${PANEL_CLASS}-info${panelInfoMode === key ? " is-on" : ""}" ` +
            `data-eq-info="${key}" aria-label="${escapeAttr(label)} 설명" ` +
            `aria-expanded="${panelInfoMode === key}" title="${escapeAttr(label)} 설명">` +
            `<svg class="lucide lucide-info" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
            `<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>` +
            `</button></div>`,
        )
        .join("") +
      `</div>` +
      modeInfo +
      `<div class="${PANEL_CLASS}-tabs" role="tablist" aria-label="프리셋 종류">` +
      `<button type="button" class="${PANEL_CLASS}-tab${panelTab === "builtin" ? " is-on" : ""}" ` +
      `data-panel-tab="builtin" role="tab" aria-selected="${panelTab === "builtin"}">기본 프리셋</button>` +
      `<button type="button" class="${PANEL_CLASS}-tab${panelTab === "custom" ? " is-on" : ""}" ` +
      `data-panel-tab="custom" role="tab" aria-selected="${panelTab === "custom"}">커스텀</button>` +
      `</div>` +
      `<div class="${PANEL_CLASS}-list is-${panelTab}" role="listbox">${presets}</div>`;
    positionPanel();
  }

  function positionPanel() {
    if (!panel?.isConnected || !panelAnchorRect) return;
    const margin = 8;
    const gap = 8;
    const panelRect = panel.getBoundingClientRect();
    const maxLeft = Math.max(
      margin,
      window.innerWidth - panelRect.width - margin,
    );
    const left = Math.min(maxLeft, Math.max(margin, panelAnchorRect.left));
    let top = panelAnchorRect.top - panelRect.height - gap;
    if (top < margin) {
      top = Math.min(
        window.innerHeight - panelRect.height - margin,
        panelAnchorRect.bottom + gap,
      );
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.max(margin, Math.round(top))}px`;
  }

  function panelHost() {
    const fullscreen =
      document.fullscreenElement || document.webkitFullscreenElement;
    return fullscreen instanceof Element ? fullscreen : document.body;
  }

  function openPanel() {
    if (!control || !button) return;
    closePanel();
    panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    panel.setAttribute("aria-label", "오디오 믹서 프리셋 선택");
    panelAnchorRect = button.getBoundingClientRect();
    panel.addEventListener("click", (event) => {
      const closeButton = event.target?.closest?.("[data-panel-close]");
      const infoButton = event.target?.closest?.("[data-eq-info]");
      const modeButton = event.target?.closest?.("[data-eq-mode]");
      const tabButton = event.target?.closest?.("[data-panel-tab]");
      const presetButton = event.target?.closest?.("[data-preset-key]");
      if (
        !closeButton &&
        !infoButton &&
        !modeButton &&
        !tabButton &&
        !presetButton
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (closeButton) {
        closePanel();
        button?.focus?.();
        return;
      }
      if (infoButton) {
        const infoMode = infoButton.dataset.eqInfo;
        panelInfoMode = panelInfoMode === infoMode ? "" : infoMode;
        renderPanel();
        panel?.querySelector(`[data-eq-info="${infoMode}"]`)?.focus();
        return;
      }
      if (modeButton) {
        setEqBandMode(modeButton.dataset.eqMode);
        return;
      }
      if (tabButton) {
        panelTab =
          tabButton.dataset.panelTab === "custom" ? "custom" : "builtin";
        renderPanel();
        return;
      }
      const presetKey = presetButton.dataset.presetKey;
      selectPreset(presetKey);
      Array.from(panel?.querySelectorAll("[data-preset-key]") || [])
        .find((item) => item.dataset.presetKey === presetKey)
        ?.focus();
    });
    for (const type of ["pointerdown", "dblclick"]) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    panelHost().appendChild(panel);
    renderPanel();
    document.addEventListener("pointerdown", onPanelOutside, true);
    document.addEventListener("keydown", onPanelKey, true);
    window.addEventListener("resize", closePanel);
    document.addEventListener("fullscreenchange", closePanel);
    document.addEventListener("webkitfullscreenchange", closePanel);
  }

  function togglePanel() {
    if (panel) closePanel();
    else openPanel();
  }

  // 네이티브 볼륨 슬라이더와 같은 마크업/클래스로 만든다. pzp 는 <input type=range>가
  // 아니라 div 구조에 --pzp-ui-progress__scale 변수로 채움을 그리므로, 그대로 흉내내야
  // 임베드 컨트롤 바에서 같은 모양이 된다.
  function ensureGainSlider() {
    if (!control) return null;
    if (gainSlider?.isConnected) {
      ensureGainTooltip();
      return gainSlider;
    }
    gainSlider = document.createElement("div");
    gainSlider.setAttribute("role", "slider");
    gainSlider.setAttribute("tabindex", "0");
    gainSlider.className =
      "pzp-pc-volume-slider pzp-pc__volume-slider pzp-ui-slider " +
      `pzp-volume-slider pzp-ui-slider--volume ${GAIN_SLIDER_CLASS}`;
    gainSlider.setAttribute("aria-label", "오디오 믹서 게인");
    gainSlider.innerHTML =
      `<div class="pzp-ui-slider__wrap">` +
      `<div class="pzp-ui-progress__div pzp-ui-progress pzp-ui-progress__entire-background" style="--pzp-ui-progress__scale: 1;"></div>` +
      `<div class="pzp-ui-progress__div pzp-ui-progress pzp-ui-progress__volume" data-gain-fill style="--pzp-ui-progress__scale: 0;"></div>` +
      `<div class="pzp-ui-slider__handler-wrap" data-gain-handle style="left: 0%;">` +
      `<span role="none presentation" class="pzp-ui-slider__handler"></span>` +
      `</div></div>`;
    bindGainSliderDrag(gainSlider);
    control.appendChild(gainSlider);
    ensureGainTooltip();
    return gainSlider;
  }

  function ensureGainTooltip() {
    if (!control) return null;
    if (gainTooltip?.isConnected) return gainTooltip;
    gainTooltip = document.createElement("span");
    gainTooltip.className = GAIN_TOOLTIP_CLASS;
    gainTooltip.setAttribute("aria-hidden", "true");
    control.appendChild(gainTooltip);
    return gainTooltip;
  }

  function syncGainTooltip() {
    const tooltip = ensureGainTooltip();
    if (!tooltip) return null;
    const text = `게인 ${Math.round(currentGain() * 100)}%`;
    if (tooltip.textContent !== text) tooltip.textContent = text;
    if (!gainPctOn) tooltip.classList.remove("is-visible");
    return tooltip;
  }

  function showGainTooltip() {
    const tooltip = syncGainTooltip();
    if (!tooltip || !gainPctOn) return;
    if (gainTooltipHideTimer) {
      clearTimeout(gainTooltipHideTimer);
      gainTooltipHideTimer = 0;
    }
    tooltip.classList.add("is-visible");
  }

  function hideGainTooltip(delay = 0) {
    if (gainTooltipHideTimer) clearTimeout(gainTooltipHideTimer);
    const hide = () => {
      gainTooltipHideTimer = 0;
      if (!gainDragging) gainTooltip?.classList.remove("is-visible");
    };
    if (delay > 0) gainTooltipHideTimer = setTimeout(hide, delay);
    else hide();
  }

  // 포인터 드래그/클릭으로 게인을 조절한다. 네이티브 슬라이더가 input 이 아니므로
  // 좌표 → 비율 변환을 직접 한다.
  function bindGainSliderDrag(slider) {
    const ratioAt = (clientX) => {
      const rect = slider.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };
    const applyAt = (clientX) => {
      if (!(enabled && audio.connected)) return;
      const raw = gainMin + ratioAt(clientX) * (gainMax - gainMin);
      const step = gainStep / 100;
      // 설정한 간격 단위로 스냅해 휠 조작과 값이 어긋나지 않게 한다.
      setGain(Math.round(raw / step) * step);
    };
    slider.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!(enabled && audio.connected)) return;
      gainDragging = true;
      syncGainVisibility();
      slider.setPointerCapture?.(event.pointerId);
      applyAt(event.clientX);
      showGainTooltip();
    });
    slider.addEventListener("pointermove", (event) => {
      if (!gainDragging) return;
      event.preventDefault();
      applyAt(event.clientX);
      showGainTooltip();
    });
    const end = (event) => {
      if (!gainDragging) return;
      gainDragging = false;
      slider.releasePointerCapture?.(event.pointerId);
      // 드래그를 끝냈을 때 포인터가 이미 래퍼 밖이면 그대로 접는다
      // (pointerleave 는 캡처 중이라 오지 않았을 수 있다).
      if (control && event.clientX !== undefined) {
        const rect = control.getBoundingClientRect();
        gainHovering =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
      }
      syncGainVisibility();
      hideGainTooltip(gainHovering ? 700 : 0);
    };
    slider.addEventListener("pointerup", end);
    slider.addEventListener("pointercancel", end);
    slider.addEventListener("pointerenter", showGainTooltip);
    slider.addEventListener("pointerleave", () => {
      if (!gainDragging) hideGainTooltip(200);
    });
    // 클릭이 플레이어(재생/일시정지)로 새지 않게 막는다.
    for (const type of ["click", "dblclick"]) {
      slider.addEventListener(type, (event) => event.stopPropagation());
    }
    slider.addEventListener("keydown", (event) => {
      const dir =
        event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowDown"
            ? -1
            : 0;
      if (!dir) return;
      event.preventDefault();
      event.stopPropagation();
      nudgeGain(dir);
      showGainTooltip();
      hideGainTooltip(900);
    });
  }

  // 값이 달라질 때만 DOM을 갱신해 MutationObserver 되먹임을 막는다.
  function syncGainSlider() {
    const slider = ensureGainSlider();
    if (!slider) return;
    const gain = currentGain();
    const ratio =
      gainMax > gainMin ? (gain - gainMin) / (gainMax - gainMin) : 0;
    const pct = `${Math.round(gain * 100)}%`;

    const fill = slider.querySelector("[data-gain-fill]");
    const handle = slider.querySelector("[data-gain-handle]");
    const scale = String(Math.round(ratio * 1000) / 1000);
    if (
      fill &&
      fill.style.getPropertyValue("--pzp-ui-progress__scale") !== scale
    ) {
      fill.style.setProperty("--pzp-ui-progress__scale", scale);
    }
    const left = `${Math.round(ratio * 1000) / 10}%`;
    if (handle && handle.style.left !== left) handle.style.left = left;

    const valueText = gainPctOn ? `게인 ${pct}` : "게인";
    if (slider.getAttribute("aria-valuetext") !== valueText) {
      slider.setAttribute("aria-valuemin", String(gainMin));
      slider.setAttribute("aria-valuemax", String(gainMax));
      slider.setAttribute("aria-valuenow", String(gain));
      slider.setAttribute("aria-valuetext", valueText);
    }
    if (gainPctOn) {
      if (slider.title !== `게인 ${pct}`) slider.title = `게인 ${pct}`;
    } else if (slider.title) {
      slider.removeAttribute("title");
    }
    syncGainTooltip();
    // 펼침 여부는 호버/드래그 상태가 정한다(syncGainVisibility).
    syncGainVisibility();
  }

  // 버튼 좌클릭이 호출하는 on/off.
  function toggleMixer() {
    if (enabled) {
      autoEnableSuppressed = true;
      disarmAutoEnable();
      disableMixer();
      return;
    }
    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    autoEnableSuppressed = false;
    if (!presetSelectedWhileDisabled) prepareMixerActivation();
    enabled = true;
    if (!connectGraph(video)) return;
    presetSelectedWhileDisabled = false;
    disarmAutoEnable();
    updateButton();
  }

  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.target?.closest?.(`.${BUTTON_CLASS}`)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!masterEnabled || featureHidden) return;
      togglePanel();
    },
    true,
  );

  // 임베드 위 휠이 부모 페이지 스크롤로 전달되지 않게 캡처 단계에서 처리한다.
  document.addEventListener(
    "wheel",
    (event) => {
      if (!event.target?.closest?.(`.${BUTTON_CLASS}`)) return;
      if (!masterEnabled || featureHidden) return;
      // 버튼의 실제 활성 상태와 같은 기준을 사용한다. 꺼져 있거나 오디오 그래프가
      // 아직 연결되지 않은 동안에는 프리셋을 바꾸거나 페이지 휠을 가로채지 않는다.
      if (!(enabled && audio.connected)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.deltaY === 0) return;
      const direction = event.deltaY < 0 ? 1 : -1;
      if (mixerWheelAction === "gain") nudgeGain(direction);
      else cyclePreset(-direction);
    },
    { capture: true, passive: false },
  );

  function sync() {
    syncTimer = 0;
    if (!masterEnabled || featureHidden) return;

    ensureButton();
    const video = findActiveVideo();
    if (
      enabled &&
      video instanceof HTMLVideoElement &&
      (!audio.connected || video !== audio.video)
    ) {
      connectGraph(video);
    }
    if (autoEnable && !enabled && !autoEnableSuppressed) {
      tryAutoEnableWithoutGesture();
    }
  }

  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(sync, SYNC_DELAY_MS);
  }

  // 직접 삽입한 노드는 MutationObserver의 동기화 대상에서 제외한다.
  function isOurNode(node) {
    return Boolean(
      node instanceof Element &&
      (node.classList.contains(CONTROL_CLASS) ||
        node.closest(`.${CONTROL_CLASS}`)),
    );
  }

  function nodeContainsSyncTarget(node) {
    if (!(node instanceof Element)) return false;
    if (isOurNode(node)) return false;
    if (node.matches(OBSERVER_RELEVANT_SELECTOR)) return true;
    return Boolean(node.querySelector(OBSERVER_RELEVANT_SELECTOR));
  }

  function isRelevantMutation(mutation) {
    if (
      mutation.target instanceof Element &&
      mutation.target.matches("video")
    ) {
      return true;
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      nodeContainsSyncTarget,
    );
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (mutations.some(isRelevantMutation)) scheduleSync();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    const watched = [
      MASTER_KEY,
      HIDDEN_KEY,
      GAIN_PCT_KEY,
      GAIN_STEP_KEY,
      GAIN_MIN_KEY,
      GAIN_MAX_KEY,
      ALWAYS_ON_KEY,
      LEGACY_DEFAULT_ON_KEY,
      SELECTED_PRESET_KEY,
      DEFAULT_PRESET_KEY,
      DEFAULT_PRESET_ENABLED_KEY,
      DEFAULT_GAIN_KEY,
      DEFAULT_GAIN_ENABLED_KEY,
      LAST_GAIN_KEY,
      WHEEL_ACTION_KEY,
      EQ_BAND_MODE_KEY,
      CUSTOM_PRESETS_KEY,
    ];
    if (watched.some((key) => key in changes)) loadSettings();
  });

  await loadSettings();
  startObserver();
  scheduleSync();
  // 컨트롤 바는 호버로 나타나므로 초기 렌더를 놓칠 수 있다. 재생 시작 시 한 번 더.
  document.addEventListener("playing", scheduleSync, true);
})();
