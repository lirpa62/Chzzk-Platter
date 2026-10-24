// 치지직 클립 플레이어용 원클릭 오디오 믹서.
// /clips 페이지의 영상은 m.naver.com/shorts iframe 안에 있으므로 이 프레임에서
// 직접 video를 찾아 선택한 프리셋을 원클릭으로 켜고 끈다.
(async function () {
  "use strict";

  if (window.__cheeseClipAudioMixerLoaded) return;
  window.__cheeseClipAudioMixerLoaded = true;

  const MASTER_KEY = "cheeseMasterEnabled";
  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  const PRESETS_KEY = "audioMixer:presets";
  const DEFAULT_CUSTOM_KEY = "audioMixer:defaultCustomId";
  const ENABLED_KEY = "cheeseClipAudioMixerEnabled";
  const ALWAYS_ON_KEY = "cheeseClipAudioMixerAlwaysOn";
  const SELECTED_PRESET_KEY = "cheeseClipAudioMixerPreset";
  // 게인(클립 페이지 전용 키 — 라이브·임베드 믹서와 따로 정한다).
  const LAST_GAIN_KEY = "cheeseClipAudioMixerGain"; // 마지막으로 조절한 게인(null = 프리셋 값)
  const WHEEL_ACTION_KEY = "cheeseClipAudioMixerWheelAction"; // preset | gain
  const GAIN_MIN_KEY = "cheeseClipAudioMixerGainMin";
  const GAIN_MAX_KEY = "cheeseClipAudioMixerGainMax";
  const GAIN_STEP_KEY = "cheeseClipAudioMixerGainStep";
  const GAIN_MIN_ALLOWED = [0.5, 0.25, 0.1, 0];
  const GAIN_MAX_ALLOWED = [2, 3];
  const GAIN_SLIDER_CLASS = "cheese-clip-gain-slider";
  const GAIN_SLIDER_WIDTH = 26;
  const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const BUTTON_CLASS = "cheese-clip-audio-mixer-button";
  const SLOT_CLASS = "cheese-clip-audio-mixer-slot";
  const STACK_CLASS = "cheese-clip-media-tool-stack";
  const TOOLTIP_CLASS = "cheese-clip-audio-mixer-tooltip";
  const TOOL_LAYOUT_EVENT = "cheese-clip-media-tools-layout";
  const VOLUME_BUTTON_SELECTOR =
    'button[class*="VolumeButtonView-module__btn_sound__"]';
  const VOLUME_GROUP_SELECTOR =
    'div[class*="VolumeButtonView-module__group_sound__"]';
  const TOOL_TOP_SELECTOR = 'div[class*="ToolWrapper-module__tool_top__"]';
  const OBSERVER_RELEVANT_SELECTOR = [
    "video",
    VOLUME_BUTTON_SELECTOR,
    VOLUME_GROUP_SELECTOR,
    TOOL_TOP_SELECTOR,
    `.${SLOT_CLASS}`,
  ].join(",");
  const SYNC_DELAY_MS = 100;
  const ROUTE_CHECK_MS = 500;
  const NORM_INTERVAL_MS = 100;
  const TRANSITION_REVEAL_DELAY_MS = 500;
  const TRANSITION_BROADCAST_INTERVAL_MS = 80;
  const TRANSITION_CHANNEL_NAME = "cheese-platter-clip-audio-mixer-transition";
  const FRAME_ACTIVITY_MESSAGE = "cheese-platter-clip-frame-activity";
  const FRAME_ACTIVITY_FALLBACK_MS = 1500;

  const DEFAULT_SNAPSHOT = {
    gain: 1,
    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    comp: {
      enabled: true,
      threshold: -24,
      knee: 24,
      ratio: 4,
      attack: 0.003,
      release: 0.25,
      makeup: 8,
    },
    limiter: { enabled: true, threshold: -1 },
    normalizer: { enabled: false, target: 0.12 },
  };

  const BUILT_IN_PRESETS = {
    default: { label: "기본", ...DEFAULT_SNAPSHOT },
    voice: {
      label: "저챗·라디오",
      gain: 1,
      eq: [-2, -1.5, -0.5, 1.5, 2, 2.5, 2, 1, 0, -1],
      normalizer: true,
      targetLevel: 0.1,
      comp: {
        enabled: true,
        threshold: -22,
        knee: 30,
        ratio: 3,
        attack: 0.005,
        release: 0.2,
        makeup: 1.5,
      },
      limiter: -1,
    },
    game: {
      label: "게임 방송",
      gain: 1,
      eq: [2, 1.6, 1, 0, 1, 2, 2, 1.6, 1, 0.5],
      normalizer: true,
      targetLevel: 0.11,
      comp: {
        enabled: true,
        threshold: -22,
        knee: 24,
        ratio: 6,
        attack: 0.003,
        release: 0.18,
        makeup: 4,
      },
      limiter: -1,
    },
    outdoor: {
      label: "야외방송",
      gain: 1.1,
      eq: [-4, -3, -1.5, 1, 3, 2.5, 1.5, 0.5, -0.5, -1],
      normalizer: true,
      targetLevel: 0.13,
      comp: {
        enabled: true,
        threshold: -28,
        knee: 28,
        ratio: 6,
        attack: 0.004,
        release: 0.22,
        makeup: 5,
      },
      limiter: -1,
    },
    music: {
      label: "노래 방송",
      gain: 1,
      eq: [3, 2.4, 1.5, -0.5, 0, 1, 2, 3, 2.4, 1.5],
      normalizer: true,
      targetLevel: 0.09,
      comp: {
        enabled: false,
        threshold: -18,
        knee: 20,
        ratio: 3,
        attack: 0.01,
        release: 0.25,
        makeup: 0,
      },
      limiter: -0.8,
    },
    classical: {
      label: "클래식·재즈",
      gain: 1,
      eq: [1.5, 1, 0.5, 0, 0, 0.5, 1, 2, 1.5, 1],
      normalizer: true,
      targetLevel: 0.08,
      comp: {
        enabled: false,
        threshold: -18,
        knee: 24,
        ratio: 2,
        attack: 0.02,
        release: 0.4,
        makeup: 0,
      },
      limiter: -1.5,
    },
    movie: {
      label: "영화·드라마",
      gain: 1.1,
      eq: [3, 2, 1, 1.5, 2, 1.5, 1, 1.6, 1, 0.5],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -28,
        knee: 30,
        ratio: 6,
        attack: 0.004,
        release: 0.3,
        makeup: 4,
      },
      limiter: -1,
    },
    anime: {
      label: "애니",
      gain: 1.05,
      eq: [1, 0.5, 0, 1, 2, 1.5, 1, 1.5, 1.5, 1],
      normalizer: true,
      targetLevel: 0.11,
      comp: {
        enabled: true,
        threshold: -26,
        knee: 28,
        ratio: 4,
        attack: 0.005,
        release: 0.25,
        makeup: 3,
      },
      limiter: -1,
    },
    sports: {
      label: "스포츠",
      gain: 1,
      eq: [0.5, 0, 0, 1.5, 2.5, 2, 1.5, 1, 0.5, 0],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -24,
        knee: 26,
        ratio: 6,
        attack: 0.003,
        release: 0.2,
        makeup: 4,
      },
      limiter: -1,
    },
    asmr: {
      label: "ASMR",
      gain: 1.3,
      eq: [-3, -2.4, -1, 1, 2, 3, 4, 4.8, 4, 3],
      normalizer: true,
      targetLevel: 0.07,
      comp: {
        enabled: true,
        threshold: -36,
        knee: 36,
        ratio: 8,
        attack: 0.006,
        release: 0.25,
        makeup: 6,
      },
      limiter: -1.5,
    },
  };

  const audio = {
    ctx: null,
    source: null,
    masterGain: null, // 최종 음량(컴프레서·makeup 뒤)
    normGain: null,
    analyser: null,
    eqFilters: [],
    comp: null,
    outputGain: null,
    limiter: null,
    video: null,
    connected: false,
    normTimer: 0,
    normalizerVideo: null,
  };
  const mediaSourceCache = new WeakMap();

  let masterEnabled = true;
  let featureHidden = false;
  let featureEnabled = true;
  let alwaysOn = false;
  let selectedPreset = "default";
  let presetLabel = "기본";
  let presetSnapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
  let presetOptions = [];
  let enabled = false;
  let autoEnableArmed = false;
  let autoEnableSuppressed = false;
  let autoResumePromise = null;
  let button = null;
  let tooltip = null;
  let slot = null;
  let anchorGroup = null;
  let anchorToolTop = null;
  let anchorResizeObserver = null;
  let observer = null;
  let syncTimer = 0;
  let routeTimer = 0;
  let transitionRevealTimer = 0;
  let transitionBroadcastTimer = 0;
  let layoutRaf = 0;
  let layoutSettleTimer = 0;
  let lastTransitionBroadcastAt = 0;
  let transitionHidden = true;
  let transitionChannel = null;
  let lastRoute = location.href;
  let graphError = "";
  let frameActive = false;
  // 사용자가 조절한 게인. 프리셋 gain 위에 곱하지 않고 대체한다(라이브·임베드 믹서와 같은 규약).
  // 프리셋을 바꾸면 그 프리셋의 게인부터 다시 시작한다. 클립을 넘겨도 마지막 값을 이어 쓴다.
  let userGain = null;
  let lastGain = null;
  let lastGainSaveTimer = 0;
  let wheelAction = "preset";
  let gainMin = 0.1;
  let gainMax = 2;
  let gainStep = 5; // %
  let gainSlider = null;
  let gainOpen = false;
  let gainDragging = false;
  let gainHideTimer = 0;
  let frameActivityKnown = false;
  let frameActivityFallbackTimer = 0;

  function isChzzkClipFrame() {
    try {
      const current = new URL(location.href);
      if (
        current.origin !== "https://m.naver.com" ||
        !current.pathname.startsWith("/shorts/")
      ) {
        return false;
      }
      if (current.searchParams.get("serviceType") !== "CHZZK") return false;

      const referrer = document.referrer ? new URL(document.referrer) : null;
      const fromClipPage =
        referrer?.origin === "https://chzzk.naver.com" &&
        (referrer.pathname === "/clips" ||
          referrer.pathname.startsWith("/clips/"));
      return fromClipPage || current.searchParams.get("embed") === "true";
    } catch {
      return false;
    }
  }

  if (!isChzzkClipFrame()) return;

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
        ? {
            enabled: source.normalizer,
            target: source.targetLevel,
          }
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

  function resolveSelectedPreset(data) {
    const presets = Array.isArray(data?.[PRESETS_KEY]) ? data[PRESETS_KEY] : [];
    const requested = String(data?.[SELECTED_PRESET_KEY] || "default");
    const selectedCustom = presets.find(
      (preset) => String(preset?.id || "") === requested,
    );
    if (selectedCustom) {
      return {
        key: requested,
        label: String(selectedCustom.name || "커스텀"),
        snapshot: cloneSnapshot(selectedCustom.snapshot),
      };
    }

    const defaultCustomId = String(data?.[DEFAULT_CUSTOM_KEY] || "");
    const defaultCustom =
      requested === "default"
        ? presets.find((preset) => String(preset?.id || "") === defaultCustomId)
        : null;
    if (defaultCustom) {
      return {
        key: "default",
        label: String(defaultCustom.name || "기본"),
        snapshot: cloneSnapshot(defaultCustom.snapshot),
      };
    }

    const builtIn = BUILT_IN_PRESETS[requested] || BUILT_IN_PRESETS.default;
    return {
      key: BUILT_IN_PRESETS[requested] ? requested : "default",
      label: builtIn.label,
      snapshot: cloneSnapshot(builtIn),
    };
  }

  function buildPresetOptions(data) {
    const customPresets = Array.isArray(data?.[PRESETS_KEY])
      ? data[PRESETS_KEY].filter(
          (preset) => preset && String(preset.id || "").trim(),
        )
      : [];
    const defaultCustomId = String(data?.[DEFAULT_CUSTOM_KEY] || "");
    const defaultCustom = customPresets.find(
      (preset) => String(preset.id || "") === defaultCustomId,
    );
    return [
      ...Object.entries(BUILT_IN_PRESETS).map(([key, preset]) => {
        if (key === "default" && defaultCustom) {
          return {
            key,
            label: String(defaultCustom.name || preset.label),
            snapshot: cloneSnapshot(defaultCustom.snapshot),
          };
        }
        return {
          key,
          label: preset.label,
          snapshot: cloneSnapshot(preset),
        };
      }),
      ...customPresets.map((preset) => ({
        key: String(preset.id),
        label: String(preset.name || "커스텀"),
        snapshot: cloneSnapshot(preset.snapshot),
      })),
    ];
  }

  function cyclePreset(direction) {
    if (!presetOptions.length || !direction) return;
    const currentIndex = presetOptions.findIndex(
      (preset) => preset.key === selectedPreset,
    );
    const baseIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex =
      (((baseIndex + direction) % presetOptions.length) +
        presetOptions.length) %
      presetOptions.length;
    const nextPreset = presetOptions[nextIndex];
    if (!nextPreset) return;
    selectedPreset = nextPreset.key;
    presetLabel = nextPreset.label;
    presetSnapshot = cloneSnapshot(nextPreset.snapshot);
    // 프리셋을 바꾸면 그 프리셋의 게인부터 시작한다(마지막 게인도 지운다).
    userGain = null;
    lastGain = null;
    if (lastGainSaveTimer) {
      clearTimeout(lastGainSaveTimer);
      lastGainSaveTimer = 0;
    }
    try {
      void chrome.storage.local.set({ [LAST_GAIN_KEY]: null });
    } catch {}
    applySnapshot();
    syncGainSlider();
    updateButton();
  }

  function applyStoredSettings(data) {
    const previousAlwaysOn = alwaysOn;
    masterEnabled = data?.[MASTER_KEY] !== false;
    const hidden = data?.[FEATURE_HIDDEN_KEY];
    featureHidden =
      Boolean(hidden && typeof hidden === "object") &&
      hidden.audioMixer === true;
    featureEnabled = data?.[ENABLED_KEY] !== false;
    alwaysOn = data?.[ALWAYS_ON_KEY] === true;
    wheelAction = data?.[WHEEL_ACTION_KEY] === "gain" ? "gain" : "preset";
    gainMin = GAIN_MIN_ALLOWED.includes(Number(data?.[GAIN_MIN_KEY]))
      ? Number(data[GAIN_MIN_KEY])
      : 0.1;
    gainMax = GAIN_MAX_ALLOWED.includes(Number(data?.[GAIN_MAX_KEY]))
      ? Number(data[GAIN_MAX_KEY])
      : 2;
    gainStep = Math.min(10, Math.max(1, Math.round(finite(data?.[GAIN_STEP_KEY], 5))));
    const storedGain = data?.[LAST_GAIN_KEY];
    lastGain = typeof storedGain === "number" && Number.isFinite(storedGain) ? storedGain : null;
    if (!enabled) userGain = lastGain;
    presetOptions = buildPresetOptions(data);
    const preset = resolveSelectedPreset(data);
    selectedPreset = preset.key;
    presetLabel = preset.label;
    presetSnapshot = preset.snapshot;

    if (!masterEnabled || featureHidden || !featureEnabled) {
      disarmAutoEnable();
      disableMixer();
      removeButton();
      return;
    }

    if (frameActive && enabled && audio.connected) applySnapshot();
    if (alwaysOn && !previousAlwaysOn) autoEnableSuppressed = false;
    if (frameActive && alwaysOn && !enabled && !autoEnableSuppressed) {
      armAutoEnable();
    } else if (!alwaysOn) disarmAutoEnable();
    if (frameActive) scheduleSync();
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get([
        MASTER_KEY,
        FEATURE_HIDDEN_KEY,
        PRESETS_KEY,
        DEFAULT_CUSTOM_KEY,
        ENABLED_KEY,
        ALWAYS_ON_KEY,
        SELECTED_PRESET_KEY,
        LAST_GAIN_KEY,
        WHEEL_ACTION_KEY,
        GAIN_MIN_KEY,
        GAIN_MAX_KEY,
        GAIN_STEP_KEY,
      ]);
      applyStoredSettings(data);
    } catch {
      applyStoredSettings({});
    }
  }

  function mixerIcon() {
    return `
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle class="cheese-clip-audio-mixer-dot" cx="28" cy="25" r="3"></circle>
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
    tooltip ||= button.querySelector(`.${TOOLTIP_CLASS}`);
    button.classList.toggle("is-active", enabled && audio.connected);
    button.classList.toggle("is-error", Boolean(graphError));
    button.removeAttribute("title");
    if (graphError) {
      button.setAttribute("aria-label", graphError);
      button.setAttribute("aria-pressed", "false");
      if (tooltip) {
        tooltip.innerHTML = `<span class="${TOOLTIP_CLASS}-message"></span>`;
        tooltip.firstElementChild.textContent = graphError;
      }
      return;
    }
    const action = enabled && audio.connected ? "끄기" : "켜기";
    const label = `오디오 믹서 ${action} (${presetLabel} 프리셋)`;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(enabled && audio.connected));
    if (tooltip) {
      tooltip.innerHTML =
        `<strong class="${TOOLTIP_CLASS}-title"></strong>` +
        `<span class="${TOOLTIP_CLASS}-preset"></span>`;
      tooltip.firstElementChild.textContent = `오디오 믹서 ${action}`;
      tooltip.lastElementChild.textContent =
        enabled && audio.connected
          ? `${presetLabel} 프리셋 · 게인 ${Math.round(currentGain() * 100)}%`
          : `${presetLabel} 프리셋`;
      // 버튼 위 휠은 믹서가 켜져 있을 때만 동작한다(꺼져 있으면 클립 전환으로 넘긴다).
      if (enabled && audio.connected) {
        const hint = document.createElement("span");
        hint.className = `${TOOLTIP_CLASS}-hint`;
        hint.textContent = wheelAction === "gain" ? "휠: 게인 조절" : "휠: 프리셋 전환";
        tooltip.appendChild(hint);
      }
    }
    syncGainSlider();
  }

  // ── 게인 슬라이더(세로) ─────────────────────────────────────────────────────
  // 치지직 클립 음량 슬라이더처럼 위아래로 조절한다. 버튼 왼쪽은 클립 영상이라 오른쪽으로 펼친다
  // (실측: 음량 버튼 오른쪽에 약 30px). 믹서가 켜져 있고 버튼·슬라이더에 마우스가 있을 때만 보인다.
  function ensureGainSlider() {
    if (!slot) return null;
    if (gainSlider?.isConnected && gainSlider.parentElement === slot) return gainSlider;
    gainSlider = document.createElement("div");
    gainSlider.className = GAIN_SLIDER_CLASS;
    gainSlider.setAttribute("role", "slider");
    gainSlider.setAttribute("aria-orientation", "vertical");
    gainSlider.setAttribute("aria-label", "오디오 믹서 게인");
    gainSlider.tabIndex = 0;
    gainSlider.innerHTML =
      `<span class="${GAIN_SLIDER_CLASS}-track"><span class="${GAIN_SLIDER_CLASS}-fill"></span>` +
      `<span class="${GAIN_SLIDER_CLASS}-handle"></span></span>`;
    gainSlider.addEventListener("pointerdown", onGainPointerDown);
    gainSlider.addEventListener("keydown", onGainKeydown);
    gainSlider.addEventListener("click", (event) => event.stopPropagation());
    slot.appendChild(gainSlider);
    if (!slot.dataset.cheeseGainBound) {
      slot.dataset.cheeseGainBound = "1";
      slot.addEventListener("pointerenter", () => setGainOpen(true));
      slot.addEventListener("pointerleave", () => setGainOpen(false));
      slot.addEventListener("focusin", () => setGainOpen(true));
      slot.addEventListener("focusout", () => setGainOpen(false));
    }
    return gainSlider;
  }

  function setGainOpen(open) {
    if (gainHideTimer) {
      clearTimeout(gainHideTimer);
      gainHideTimer = 0;
    }
    if (open) {
      gainOpen = true;
      syncGainSlider();
      return;
    }
    // 버튼과 슬라이더 사이 틈을 지나는 동안 닫히지 않게 잠깐 기다린다.
    gainHideTimer = setTimeout(() => {
      gainHideTimer = 0;
      if (gainDragging) return;
      gainOpen = false;
      syncGainSlider();
    }, 250);
  }

  // 치지직 음량 슬라이더의 색·크기를 그대로 따른다(테마마다 다르므로 보일 때마다 읽는다).
  // 실측 구조: btn_box(판) > control_wrap > volumebar(트랙) > current(채움) + slider_range > slider(핸들).
  const NATIVE_SLIDER_PARTS = {
    box: '[class*="VolumeButtonView-module__btn_box__"]',
    track: '[class*="VolumeButtonView-module__volumebar__"]',
    fill: '[class*="VolumeButtonView-module__current__"]',
    handle: '[class*="VolumeButtonView-module__slider__"]',
  };
  function harvestNativeSliderStyle(slider) {
    const group = anchorGroup?.isConnected ? anchorGroup : null;
    if (!group) return;
    const css = (selector) => {
      const el = group.querySelector(selector);
      return el ? getComputedStyle(el) : null;
    };
    const px = (value, fallback) => (/^\d+(\.\d+)?px$/.test(String(value)) ? value : fallback);
    const box = css(NATIVE_SLIDER_PARTS.box);
    const track = css(NATIVE_SLIDER_PARTS.track);
    const fill = css(NATIVE_SLIDER_PARTS.fill);
    const handle = css(NATIVE_SLIDER_PARTS.handle);
    const set = (name, value) => {
      if (value && slider.style.getPropertyValue(name) !== value) slider.style.setProperty(name, value);
    };
    set("--cheese-clip-gain-panel-bg", box?.backgroundColor);
    set("--cheese-clip-gain-track-bg", track?.backgroundColor);
    set("--cheese-clip-gain-track-radius", track?.borderRadius);
    set("--cheese-clip-gain-track-width", px(track?.width, ""));
    set("--cheese-clip-gain-fill-bg", fill?.backgroundColor);
    set("--cheese-clip-gain-handle-bg", handle?.backgroundColor);
    set("--cheese-clip-gain-handle-size", px(handle?.width, ""));
    set("--cheese-clip-gain-handle-shadow", handle?.boxShadow === "none" ? "none" : handle?.boxShadow);
  }

  function syncGainSlider() {
    if (!slot) return;
    const active = enabled && audio.connected && !graphError;
    const slider = active ? ensureGainSlider() : gainSlider;
    if (!slider) return;
    const show = active && (gainOpen || gainDragging);
    slot.classList.toggle("is-gain-open", show);
    if (!show) return;
    harvestNativeSliderStyle(slider);
    const gain = currentGain();
    const ratio = gainMax > gainMin ? (gain - gainMin) / (gainMax - gainMin) : 0;
    slider.style.setProperty("--cheese-clip-gain-ratio", String(Math.max(0, Math.min(1, ratio))));
    // 오른쪽 공간이 슬라이더보다 좁으면 그만큼 안쪽으로 당겨 화면 밖으로 나가지 않게 한다.
    const right = slot.getBoundingClientRect().right;
    const room = innerWidth - right - 2;
    slider.style.setProperty("--cheese-clip-gain-shift", `${Math.min(0, room - GAIN_SLIDER_WIDTH)}px`);
    slider.setAttribute("aria-valuemin", String(Math.round(gainMin * 100)));
    slider.setAttribute("aria-valuemax", String(Math.round(gainMax * 100)));
    slider.setAttribute("aria-valuenow", String(Math.round(gain * 100)));
    slider.setAttribute("aria-valuetext", `${Math.round(gain * 100)}%`);
  }

  function gainFromPointer(event) {
    const track = gainSlider?.querySelector(`.${GAIN_SLIDER_CLASS}-track`);
    if (!track) return currentGain();
    const rect = track.getBoundingClientRect();
    const ratio = rect.height > 0 ? (rect.bottom - event.clientY) / rect.height : 0;
    return gainMin + Math.max(0, Math.min(1, ratio)) * (gainMax - gainMin);
  }

  function onGainPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    gainDragging = true;
    try {
      gainSlider.setPointerCapture(event.pointerId);
    } catch {}
    setGain(gainFromPointer(event));
    // 캡처가 풀려도(프레임 경계 등) 끌기가 끊기지 않게 창 전체에서 받는다.
    const move = (moveEvent) => {
      moveEvent.preventDefault();
      setGain(gainFromPointer(moveEvent));
    };
    const end = () => {
      gainDragging = false;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      if (!slot?.matches(":hover")) setGainOpen(false);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  function onGainKeydown(event) {
    const keys = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
    };
    if (event.key in keys) nudgeGain(keys[event.key]);
    else if (event.key === "Home") setGain(gainMin);
    else if (event.key === "End") setGain(gainMax);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function showGraphError(error) {
    enabled = false;
    graphError =
      error?.name === "InvalidStateError"
        ? "다른 기능이 이 영상의 오디오를 사용 중이라 믹서를 켤 수 없습니다."
        : "오디오 믹서를 켤 수 없습니다. 잠시 후 다시 시도해 주세요.";
    updateButton();
    console.warn("[치즈 플래터 클립 오디오 믹서] 그래프 구성 실패:", error);
  }

  function visibleArea(element) {
    if (!(element instanceof Element) || !element.isConnected) return 0;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return 0;
    }
    const rect = element.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(rect.right, innerWidth) - Math.max(rect.left, 0),
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0),
    );
    return width * height;
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

  function findVolumeButton() {
    return (
      Array.from(document.querySelectorAll(VOLUME_BUTTON_SELECTOR))
        .filter((candidate) => visibleArea(candidate) > 0)
        .sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null
    );
  }

  function ensureToolStack() {
    let stack = document.querySelector(`.${STACK_CLASS}`);
    if (stack) return stack;
    stack = document.createElement("div");
    stack.className = STACK_CLASS;
    document.body.appendChild(stack);
    return stack;
  }

  function requestSharedToolLayout() {
    if (!frameActive || document.visibilityState === "hidden") return;
    document
      .querySelector(`.${STACK_CLASS}`)
      ?.classList.add("is-layout-pending");
    window.dispatchEvent(new Event(TOOL_LAYOUT_EVENT));
  }

  function positionButtonSlot(nativeButton, nativeGroup, toolTop) {
    const stack = slot?.closest(`.${STACK_CLASS}`);
    if (!slot || !stack) return;
    const buttonRect = nativeButton.getBoundingClientRect();
    const groupRect = nativeGroup.getBoundingClientRect();
    const toolStyle = getComputedStyle(toolTop);
    const gap = finite(parseFloat(toolStyle.rowGap || toolStyle.gap), 16);
    const toolCount = Math.max(1, stack.children.length);
    const stackHeight = toolCount * 48 + (toolCount - 1) * gap;
    const fitsAbove = groupRect.top - gap - stackHeight >= 0;
    stack.style.setProperty("--cheese-clip-media-tool-gap", `${gap}px`);
    stack.style.left = `${Math.round(
      buttonRect.left + (buttonRect.width - 48) / 2,
    )}px`;
    stack.style.top = `${Math.round(
      fitsAbove ? groupRect.top - gap : groupRect.bottom + gap,
    )}px`;
    stack.dataset.placement = fitsAbove ? "above" : "below";
    stack.classList.remove("is-layout-pending");
  }

  function scheduleSharedToolLayout() {
    if (!frameActive || document.visibilityState === "hidden") return;
    document
      .querySelector(`.${STACK_CLASS}`)
      ?.classList.add("is-layout-pending");
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = 0;
      sync();
    });
    if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
    layoutSettleTimer = setTimeout(() => {
      layoutSettleTimer = 0;
      if (!frameActive || document.visibilityState === "hidden") return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = 0;
      sync();
    }, 120);
  }

  function revealButtonAfterTransition() {
    transitionRevealTimer = 0;
    if (!frameActive) return;
    transitionHidden = false;
    if (!document.hidden) scheduleSync();
  }

  function hideButtonDuringTransition() {
    transitionHidden = true;
    if (slot) slot.hidden = true;
    if (transitionRevealTimer) clearTimeout(transitionRevealTimer);
    transitionRevealTimer = 0;
    if (!frameActive) return;
    transitionRevealTimer = setTimeout(
      revealButtonAfterTransition,
      TRANSITION_REVEAL_DELAY_MS,
    );
  }

  function postTransitionStart() {
    transitionBroadcastTimer = 0;
    lastTransitionBroadcastAt = Date.now();
    try {
      transitionChannel?.postMessage({ type: "transition-start" });
    } catch {}
  }

  function isMediaToolGesture(event) {
    const target = event?.target;
    return (
      target instanceof Element && Boolean(target.closest(`.${STACK_CLASS}`))
    );
  }

  function broadcastTransitionStart(event) {
    // 버튼 위 휠도 클립 전환 제스처로 간주하면 공용 도구 스택이 잠시 숨었다가
    // 다시 배치된다. 확장 도구를 조작하는 동안에는 현재 클립을 유지한다.
    if (isMediaToolGesture(event)) return;
    // 치지직 클립 화면은 실제로 스크롤이 시작될 때 부모(clipFrameCoordinator.js)가 transition-start 를
    // 보낸다. 그 알림을 받는 프레임이면 휠·터치·방향키만으로 미리 숨기지 않는다 — 첫 클립에서 위로
    // 굴리거나 음량·좋아요 버튼 사이 빈 곳에서 굴려 넘어가지 않을 때도 버튼이 0.5초 사라졌다.
    if (frameActivityKnown) return;
    hideButtonDuringTransition();
    const wait =
      TRANSITION_BROADCAST_INTERVAL_MS -
      (Date.now() - lastTransitionBroadcastAt);
    if (wait <= 0) {
      if (transitionBroadcastTimer) {
        clearTimeout(transitionBroadcastTimer);
        transitionBroadcastTimer = 0;
      }
      postTransitionStart();
    } else if (!transitionBroadcastTimer) {
      transitionBroadcastTimer = setTimeout(postTransitionStart, wait);
    }
  }

  function handleTransitionKeydown(event) {
    if (
      !["ArrowUp", "ArrowDown", "PageUp", "PageDown", " "].includes(
        event.key,
      ) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target?.isContentEditable
    ) {
      return;
    }
    broadcastTransitionStart(event);
  }

  // ── 클립 전환 감지 ──────────────────────────────────────────────────────────
  // 치지직 클립은 플레이어 프레임 하나 안에서 클립 목록(FlickingView)을 스크롤해 넘긴다(실측: 프레임은
  // 그대로이고 음량 버튼이 83 → -31 → -294 로 밀린 뒤 새 클립의 버튼이 83 에 나타난다). 우리 버튼은 음량
  // 버튼 위치를 따라가므로 이 스크롤 동안 숨겨야 끌려 다니지 않는다. 휠만 보면 넘어가지 않는 휠(첫 클립에서
  // 위로 등)에도 사라지므로, 영상이 든 목록이 실제로 스크롤될 때만 숨긴다.
  let transitionScrollWatching = false;
  function onClipListScroll(event) {
    const target = event.target;
    if (!(target instanceof Element) || !frameActive) return;
    if (target.closest(`.${STACK_CLASS}`)) return;
    if (!target.querySelector("video")) return;
    hideButtonDuringTransition();
  }
  function startMotionWatch() {
    if (transitionScrollWatching) return;
    transitionScrollWatching = true;
    document.addEventListener("scroll", onClipListScroll, { capture: true, passive: true });
  }

  function startTransitionChannel() {
    if (transitionChannel || typeof BroadcastChannel !== "function") return;
    try {
      transitionChannel = new BroadcastChannel(TRANSITION_CHANNEL_NAME);
      transitionChannel.addEventListener("message", (event) => {
        if (event.data?.type === "transition-start") {
          hideButtonDuringTransition();
        }
      });
    } catch {
      transitionChannel = null;
    }
  }

  function ensureButton() {
    if (!masterEnabled || featureHidden || !featureEnabled) return;
    if (transitionHidden) {
      if (slot) slot.hidden = true;
      return;
    }

    const nativeButton = findVolumeButton();
    const nativeGroup =
      nativeButton?.closest(VOLUME_GROUP_SELECTOR) ||
      nativeButton?.parentElement;
    const toolTop = nativeGroup?.closest(TOOL_TOP_SELECTOR);
    if (!nativeButton || !nativeGroup || !toolTop) {
      if (slot) slot.hidden = true;
      return;
    }

    // 치지직 React가 관리하는 toolTop 안에 외부 노드를 넣으면 렌더 때마다 슬롯을
    // 제거해 확장과 재삽입 경쟁이 발생한다. 공용 body 포털 스택을 볼륨 좌표에
    // 고정해 DOM 소유권 충돌 없이 필터 버튼과 함께 정렬한다.
    const stack = ensureToolStack();
    if (!slot?.isConnected || slot.parentElement !== stack) {
      slot?.remove();
      slot = document.createElement("div");
      slot.className = SLOT_CLASS;
      stack.appendChild(slot);
      button = null;
      requestSharedToolLayout();
    }
    slot.hidden = false;
    if (anchorToolTop !== toolTop) {
      anchorToolTop?.removeAttribute("data-cheese-clip-audio-mixer-toolbar");
      toolTop.setAttribute("data-cheese-clip-audio-mixer-toolbar", "");
      anchorToolTop = toolTop;
    }
    if (anchorGroup !== nativeGroup) {
      anchorResizeObserver?.disconnect();
      anchorResizeObserver ||= new ResizeObserver(scheduleSync);
      anchorResizeObserver.observe(nativeGroup);
      anchorGroup = nativeGroup;
    }
    positionButtonSlot(nativeButton, nativeGroup, toolTop);

    if (!button?.isConnected) {
      button = document.createElement("button");
      button.type = "button";
      // 네이티브 볼륨 버튼 클래스에는 컨트롤 표시 상태에 따른 opacity가 포함될 수
      // 있다. 이를 복사하면 클립 전환 직후 아이콘이 숨고 호버할 때만 나타나므로,
      // 위치만 네이티브 버튼에서 계산하고 시각 상태는 전용 클래스로 관리한다.
      button.className = BUTTON_CLASS;
      button.innerHTML =
        mixerIcon() +
        `<span class="${TOOLTIP_CLASS}" role="tooltip" aria-hidden="true"></span>`;
      tooltip = button.querySelector(`.${TOOLTIP_CLASS}`);
      button.addEventListener("click", onButtonClick);
      slot.appendChild(button);
    } else {
      tooltip ||= button.querySelector(`.${TOOLTIP_CLASS}`);
    }
    updateButton();
  }

  function removeButton() {
    anchorResizeObserver?.disconnect();
    anchorToolTop?.removeAttribute("data-cheese-clip-audio-mixer-toolbar");
    const stack = slot?.closest(`.${STACK_CLASS}`);
    slot?.remove();
    if (stack && !stack.childElementCount) stack.remove();
    slot = null;
    button = null;
    tooltip = null;
    gainSlider = null;
    gainOpen = false;
    gainDragging = false;
    anchorGroup = null;
    anchorToolTop = null;
    requestSharedToolLayout();
  }

  function getMediaSource(video) {
    const cached = mediaSourceCache.get(video);
    if (cached) return cached;
    const source = audio.ctx.createMediaElementSource(video);
    mediaSourceCache.set(video, source);
    return source;
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
      frameActive &&
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
      !frameActive ||
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
        !frameActive ||
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

  // 지금 적용할 게인. 만진 적 없으면 프리셋 값.
  function currentGain() {
    const base = userGain === null ? presetSnapshot.gain : userGain;
    return Math.min(gainMax, Math.max(gainMin, finite(base, 1)));
  }

  // 100%(원본 음량)를 기준점으로 간격에 맞춘다. 양 끝은 범위 끝을 그대로 허용한다.
  function quantizeGain(value) {
    const g = Math.min(gainMax, Math.max(gainMin, finite(value, 1)));
    if (g <= gainMin || g >= gainMax) return g;
    const step = gainStep / 100;
    const q = 1 + Math.round((g - 1) / step) * step;
    return Math.round(Math.min(gainMax, Math.max(gainMin, q)) * 100) / 100;
  }

  function setGain(value) {
    const next = quantizeGain(value);
    if (userGain !== null && Math.abs(next - userGain) < 0.0001) return;
    userGain = next;
    lastGain = next;
    if (audio.connected) audio.masterGain.gain.value = currentGain();
    syncGainSlider();
    updateButton();
    // 드래그 중 저장이 몰리지 않게 묶는다. 다른 클립 프레임은 이 값을 이어받는다.
    if (lastGainSaveTimer) clearTimeout(lastGainSaveTimer);
    lastGainSaveTimer = setTimeout(() => {
      lastGainSaveTimer = 0;
      try {
        void chrome.storage.local.set({ [LAST_GAIN_KEY]: lastGain });
      } catch {}
    }, 250);
  }

  function nudgeGain(direction) {
    setGain(currentGain() + (direction * gainStep) / 100);
  }

  function applySnapshot() {
    if (!audio.connected) return;

    audio.masterGain.gain.value = currentGain();
    presetSnapshot.eq.forEach((gain, index) => {
      if (audio.eqFilters[index]) audio.eqFilters[index].gain.value = gain;
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

  function suspendMixerGraph() {
    if (audio.connected || audio.source) {
      restoreOriginalAudio({
        restoreSource: false,
        preserveSource: true,
      });
    } else {
      stopNormalizer();
    }
    updateButton();
  }

  // AudioContext 생성(라이브 믹서와 동일 정책).
  // ⚠ 옵션 없이 만들면 아주 작은 버퍼를 잡아, CPU 가 바쁠 때 언더런으로 소리가 튄다.
  //   시청 용도라 "playback" 으로 버퍼를 키운다(지연은 체감되지 않는다).
  function createAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("AudioContext unsupported");
    try {
      return new Ctx({ latencyHint: "playback" });
    } catch {
      return new Ctx();
    }
  }

  function connectGraph(video) {
    if (!frameActive) return false;
    try {
      graphError = "";
      audio.ctx ||= createAudioContext();
      if (audio.ctx.state !== "running") {
        audio.ctx.resume().catch(() => {});
      }

      if (audio.connected || audio.source) {
        // 이전 클립의 처리 그래프만 끊고 새 영상에 재사용할 source를 가져온다.
        // 제거된 video/blob을 destination에 다시 연결하면 노드가 남을 수 있다.
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
      // ⚠ 마스터 게인은 컴프레서 뒤에 둔다(라이브 믹서와 동일). 압축기 앞에서 키우면
      //   키운 만큼을 압축기가 도로 깎아 음량이 안 커지고 소리만 먹먹해진다.
      //   노멀라이저 측정은 게인이 실리지 않은 원본 신호를 본다.
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
      !frameActive ||
      !alwaysOn ||
      enabled ||
      autoEnableSuppressed ||
      !masterEnabled ||
      featureHidden ||
      !featureEnabled
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

  function tryAutoEnableWithoutGesture() {
    if (
      !frameActive ||
      !alwaysOn ||
      enabled ||
      autoEnableSuppressed ||
      !masterEnabled ||
      featureHidden ||
      !featureEnabled
    ) {
      return;
    }

    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) {
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

    // 실행이 허용되지 않은 AudioContext에 video를 먼저 연결하면 사용자가 조작할
    // 때까지 원음까지 끊길 수 있다. running 상태가 확인된 뒤에만 그래프를 구성한다.
    if (audio.ctx.state !== "running") {
      armAutoEnable();
      if (!autoResumePromise) {
        const pendingContext = audio.ctx;
        autoResumePromise = pendingContext
          .resume()
          .catch(() => {})
          .finally(() => {
            autoResumePromise = null;
            if (
              pendingContext === audio.ctx &&
              pendingContext.state === "running" &&
              alwaysOn &&
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

    userGain = lastGain; // 다른 클립에서 조절한 게인을 이어 쓴다
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

  function onAutoEnableGesture(event) {
    if (event.target?.closest?.(`.${BUTTON_CLASS}`)) return;
    if (
      !frameActive ||
      !alwaysOn ||
      !masterEnabled ||
      featureHidden ||
      !featureEnabled
    ) {
      disarmAutoEnable();
      return;
    }

    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    userGain = lastGain; // 다른 클립에서 조절한 게인을 이어 쓴다
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

    if (enabled) {
      autoEnableSuppressed = true;
      disarmAutoEnable();
      disableMixer();
      return;
    }

    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    autoEnableSuppressed = false;
    userGain = lastGain;
    enabled = true;
    if (!connectGraph(video)) return;
    disarmAutoEnable();
    updateButton();
  }

  function onButtonWheel(event) {
    const onSlider = Boolean(event.target?.closest?.(`.${GAIN_SLIDER_CLASS}`));
    if ((!onSlider && !event.target?.closest?.(`.${BUTTON_CLASS}`)) || event.deltaY === 0) {
      return;
    }
    if (
      !frameActive ||
      !masterEnabled ||
      featureHidden ||
      !featureEnabled ||
      graphError ||
      !(enabled && audio.connected)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    // 슬라이더 위 휠은 늘 게인, 버튼 위 휠은 설정(프리셋 전환/게인 조절)을 따른다.
    // ⚠ 여기서 막지 않으면 휠이 클립 전환으로 넘어간다. 그 밖의 휠은 건드리지 않는다.
    if (onSlider || wheelAction === "gain") {
      nudgeGain(event.deltaY < 0 ? 1 : -1);
      return;
    }
    // 설정의 시작 기본값은 유지하고 현재 클립 프레임에만 즉시 적용한다.
    cyclePreset(event.deltaY < 0 ? -1 : 1);
  }

  function sync() {
    syncTimer = 0;
    if (!frameActive || !masterEnabled || featureHidden || !featureEnabled) {
      return;
    }

    ensureButton();
    const video = findActiveVideo();
    if (
      enabled &&
      video instanceof HTMLVideoElement &&
      (!audio.connected || video !== audio.video)
    ) {
      connectGraph(video);
    }
    if (alwaysOn && !enabled && !autoEnableSuppressed) {
      tryAutoEnableWithoutGesture();
    }
  }

  function scheduleSync() {
    if (!frameActive || syncTimer) return;
    syncTimer = setTimeout(sync, SYNC_DELAY_MS);
  }

  function nodeContainsSyncTarget(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches(OBSERVER_RELEVANT_SELECTOR)) return true;
    return Boolean(node.querySelector(OBSERVER_RELEVANT_SELECTOR));
  }

  function isRelevantMutation(mutation) {
    const target = mutation.target;
    if (target instanceof Element && target.matches("video")) {
      return true;
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      nodeContainsSyncTarget,
    );
  }

  function startObserver() {
    if (!frameActive || observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (document.hidden) return;
      if (mutations.some(isRelevantMutation)) scheduleSync();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function startRouteWatcher() {
    if (!frameActive || routeTimer) return;
    routeTimer = setInterval(() => {
      if (!frameActive) return;
      const routeChanged = location.href !== lastRoute;
      if (routeChanged) {
        lastRoute = location.href;
        graphError = "";
        if (alwaysOn && !enabled && !autoEnableSuppressed) armAutoEnable();
      }
      if (
        document.hidden ||
        !masterEnabled ||
        featureHidden ||
        !featureEnabled
      ) {
        return;
      }
      if (routeChanged || !slot?.isConnected || !anchorGroup?.isConnected) {
        scheduleSync();
      }
    }, ROUTE_CHECK_MS);
  }

  function stopActiveFrameWork() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = 0;
    if (routeTimer) clearInterval(routeTimer);
    routeTimer = 0;
    if (transitionRevealTimer) clearTimeout(transitionRevealTimer);
    transitionRevealTimer = 0;
    if (transitionBroadcastTimer) clearTimeout(transitionBroadcastTimer);
    transitionBroadcastTimer = 0;
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = 0;
    if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
    layoutSettleTimer = 0;
    disarmAutoEnable();
    observer?.disconnect();
    observer = null;
    anchorResizeObserver?.disconnect();
    anchorGroup = null;
    transitionHidden = true;
    if (slot) slot.hidden = true;
    suspendMixerGraph();
  }

  function setFrameActive(active) {
    const next = active === true;
    if (next === frameActive) return;
    frameActive = next;
    if (!frameActive) {
      stopActiveFrameWork();
      return;
    }
    startObserver();
    startRouteWatcher();
    // 다른 클립에서 조절한 게인을 이어 쓴다(이 클립에서 프리셋만 바꾼 상태가 아니면).
    if (!enabled) userGain = lastGain;
    if (alwaysOn && !enabled && !autoEnableSuppressed) armAutoEnable();
    hideButtonDuringTransition();
  }

  function handleFrameActivity(event) {
    if (
      event.source !== window.parent ||
      event.origin !== "https://chzzk.naver.com" ||
      event.data?.source !== FRAME_ACTIVITY_MESSAGE
    ) {
      return;
    }
    if (event.data.event === "transition-start") {
      hideButtonDuringTransition();
      return;
    }
    if (typeof event.data.active !== "boolean") return;
    frameActivityKnown = true;
    if (frameActivityFallbackTimer) {
      clearTimeout(frameActivityFallbackTimer);
      frameActivityFallbackTimer = 0;
    }
    setFrameActive(event.data.active === true);
  }

  function requestFrameActivity() {
    try {
      window.parent?.postMessage(
        { source: FRAME_ACTIVITY_MESSAGE, event: "ready" },
        "https://chzzk.naver.com",
      );
    } catch {}
    if (frameActivityFallbackTimer) return;
    frameActivityFallbackTimer = setTimeout(() => {
      frameActivityFallbackTimer = 0;
      if (!frameActivityKnown) setFrameActive(true);
    }, FRAME_ACTIVITY_FALLBACK_MS);
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    // 마지막 게인은 값만 받아 둔다. 설정 전체를 다시 읽으면 휠로 바꾼 현재 클립의 프리셋이
    // 저장된 시작 프리셋으로 되돌아간다. 지금 켜져 있는 클립은 자기 게인을 그대로 둔다.
    if (changes[LAST_GAIN_KEY]) {
      const value = changes[LAST_GAIN_KEY].newValue;
      lastGain = typeof value === "number" && Number.isFinite(value) ? value : null;
      if (!enabled) userGain = lastGain;
    }
    if (
      !changes[WHEEL_ACTION_KEY] &&
      !changes[GAIN_MIN_KEY] &&
      !changes[GAIN_MAX_KEY] &&
      !changes[GAIN_STEP_KEY] &&
      !changes[MASTER_KEY] &&
      !changes[FEATURE_HIDDEN_KEY] &&
      !changes[PRESETS_KEY] &&
      !changes[DEFAULT_CUSTOM_KEY] &&
      !changes[ENABLED_KEY] &&
      !changes[ALWAYS_ON_KEY] &&
      !changes[SELECTED_PRESET_KEY]
    ) {
      return;
    }
    void loadSettings();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && frameActive) {
      syncNormalizerActivity();
      scheduleSync();
    } else if (audio.video?.paused) {
      stopNormalizer();
    }
  });
  window.addEventListener("resize", scheduleSync);
  window.visualViewport?.addEventListener("resize", scheduleSync);
  window.addEventListener(TOOL_LAYOUT_EVENT, scheduleSharedToolLayout);
  document.addEventListener("wheel", onButtonWheel, {
    capture: true,
    passive: false,
  });
  window.addEventListener("wheel", broadcastTransitionStart, {
    capture: true,
    passive: true,
  });
  window.addEventListener("touchmove", broadcastTransitionStart, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", handleTransitionKeydown, true);

  window.addEventListener("pagehide", (event) => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = 0;
    if (transitionRevealTimer) clearTimeout(transitionRevealTimer);
    transitionRevealTimer = 0;
    if (transitionBroadcastTimer) clearTimeout(transitionBroadcastTimer);
    transitionBroadcastTimer = 0;
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = 0;
    if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
    layoutSettleTimer = 0;
    if (frameActivityFallbackTimer) clearTimeout(frameActivityFallbackTimer);
    frameActivityFallbackTimer = 0;
    if (routeTimer) clearInterval(routeTimer);
    routeTimer = 0;
    disarmAutoEnable();
    observer?.disconnect();
    observer = null;
    anchorResizeObserver?.disconnect();
    anchorGroup = null;
    anchorToolTop?.removeAttribute("data-cheese-clip-audio-mixer-toolbar");
    anchorToolTop = null;
    disableMixer();
    if (!event.persisted && audio.ctx) {
      audio.ctx.close().catch(() => {});
      audio.ctx = null;
    }
    if (!event.persisted) {
      transitionChannel?.close();
      transitionChannel = null;
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    startTransitionChannel();
    startMotionWatch();
    requestFrameActivity();
    if (frameActive) {
      hideButtonDuringTransition();
      startObserver();
      startRouteWatcher();
      if (alwaysOn && !autoEnableSuppressed) armAutoEnable();
    }
  });

  window.addEventListener("message", handleFrameActivity);
  startTransitionChannel();
  startMotionWatch();
  await loadSettings();
  requestFrameActivity();
})();
