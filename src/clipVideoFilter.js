// 치지직 클립 플레이어용 원클릭 비디오 필터.
// /clips 페이지의 m.naver.com/shorts iframe에서 현재 보이는 video 하나에만
// 선택한 프리셋을 적용하고, 클립 전환 시 이전 video의 필터를 정리한다.
(async function () {
  "use strict";

  if (window.__cheeseClipVideoFilterLoaded) return;
  window.__cheeseClipVideoFilterLoaded = true;

  const MASTER_KEY = "cheeseMasterEnabled";
  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  const PRESETS_KEY = "videoFilter:presets";
  const ENABLED_KEY = "cheeseClipVideoFilterEnabled";
  const ALWAYS_ON_KEY = "cheeseClipVideoFilterAlwaysOn";
  const SELECTED_PRESET_KEY = "cheeseClipVideoFilterPreset";
  const BUTTON_CLASS = "cheese-clip-video-filter-button";
  const SLOT_CLASS = "cheese-clip-video-filter-slot";
  const STACK_CLASS = "cheese-clip-media-tool-stack";
  const TOOLTIP_CLASS = "cheese-clip-video-filter-tooltip";
  const TOOL_LAYOUT_EVENT = "cheese-clip-media-tools-layout";
  const TARGET_CLASS = "cheese-clip-video-filter-target";
  const SVG_ROOT_ID = "cheese-clip-video-filter-svg-root";
  const SVG_FILTER_ID = "cheese-clip-video-filter-svg";
  const STYLE_ID = "cheese-clip-video-filter-style";
  const VOLUME_BUTTON_SELECTOR =
    'button[class*="VolumeButtonView-module__btn_sound__"]';
  const VOLUME_GROUP_SELECTOR =
    'div[class*="VolumeButtonView-module__group_sound__"]';
  const TOOL_TOP_SELECTOR = 'div[class*="ToolWrapper-module__tool_top__"]';
  const AUDIO_SLOT_SELECTOR = ".cheese-clip-audio-mixer-slot";
  const SYNC_DELAY_MS = 100;
  const ROUTE_CHECK_MS = 500;
  const TRANSITION_REVEAL_DELAY_MS = 500;
  const TRANSITION_CHANNEL_NAME =
    "cheese-platter-clip-audio-mixer-transition";
  const FRAME_SAMPLE_INTERVAL_MS = 2000;
  const FRAME_DROP_BAD_RATIO = 0.08;
  const FRAME_DROP_SEVERE_RATIO = 0.2;
  const FRAME_DROP_GOOD_RATIO = 0.02;
  const HEAVY_SHARPNESS = 30;
  const OBSERVER_RELEVANT_SELECTOR = [
    "video",
    VOLUME_BUTTON_SELECTOR,
    VOLUME_GROUP_SELECTOR,
    TOOL_TOP_SELECTOR,
    AUDIO_SLOT_SELECTOR,
    `.${SLOT_CLASS}`,
  ].join(",");

  const PARAMS = {
    brightness: { min: 0.3, max: 1.7, neutral: 1 },
    exposure: { min: 0.3, max: 1.7, neutral: 1 },
    contrast: { min: 0.3, max: 1.7, neutral: 1 },
    saturation: { min: 0, max: 2, neutral: 1 },
    temperature: { min: -100, max: 100, neutral: 0 },
    tint: { min: -100, max: 100, neutral: 0 },
    gamma: { min: 0.4, max: 2.2, neutral: 1 },
    sharpness: { min: 0, max: 100, neutral: 0 },
    shadows: { min: -100, max: 100, neutral: 0 },
    highlights: { min: -100, max: 100, neutral: 0 },
  };
  const PARAM_KEYS = Object.keys(PARAMS);
  const BUILT_IN_PRESETS = {
    default: { label: "원본", filters: {} },
    beginner: {
      label: "화질 향상",
      filters: {
        sharpness: 30,
        contrast: 1.06,
        saturation: 1.08,
        shadows: 15,
        brightness: 1.02,
      },
    },
    fps: {
      label: "FPS 게임",
      filters: {
        shadows: 38,
        gamma: 0.8,
        contrast: 1.08,
        sharpness: 45,
        saturation: 1.05,
      },
    },
    moba: {
      label: "롤·AOS",
      filters: {
        saturation: 1.22,
        contrast: 1.08,
        sharpness: 35,
        brightness: 1.03,
      },
    },
    game: {
      label: "게임 일반",
      filters: {
        saturation: 1.15,
        contrast: 1.06,
        sharpness: 28,
        brightness: 1.02,
      },
    },
    horror: {
      label: "공포 게임",
      filters: {
        shadows: 50,
        gamma: 0.7,
        brightness: 1.06,
        sharpness: 25,
        contrast: 1.05,
      },
    },
    outdoor: {
      label: "야외방송",
      filters: {
        highlights: -28,
        shadows: 26,
        saturation: 1.12,
        contrast: 1.04,
        sharpness: 20,
      },
    },
    sports: {
      label: "스포츠",
      filters: {
        saturation: 1.18,
        contrast: 1.1,
        sharpness: 40,
        temperature: -8,
      },
    },
    food: {
      label: "먹방·쿡방",
      filters: {
        temperature: 28,
        saturation: 1.2,
        brightness: 1.05,
        contrast: 1.04,
      },
    },
    cam: {
      label: "캠방송",
      filters: {
        saturation: 1.06,
        contrast: 0.97,
        temperature: 12,
        shadows: 14,
        highlights: -8,
      },
    },
    vtuber: {
      label: "버츄얼",
      filters: {
        saturation: 1.06,
        sharpness: 12,
        temperature: 6,
        contrast: 0.99,
      },
    },
    anime: {
      label: "애니·2D",
      filters: {
        saturation: 1.18,
        sharpness: 22,
        contrast: 1.05,
        brightness: 1.02,
      },
    },
    night: {
      label: "야간 시청",
      filters: {
        brightness: 0.85,
        contrast: 0.95,
        temperature: 28,
        highlights: -20,
      },
    },
    cinema: {
      label: "시네마틱",
      filters: {
        contrast: 1.18,
        saturation: 0.9,
        shadows: -18,
        highlights: -10,
        temperature: 12,
      },
    },
  };

  let masterEnabled = true;
  let featureHidden = false;
  let featureEnabled = true;
  let alwaysOn = false;
  let enabled = false;
  let autoEnableSuppressed = false;
  let selectedPreset = "beginner";
  let presetLabel = "화질 향상";
  let filters = normalizeFilters(BUILT_IN_PRESETS.beginner.filters);
  let appliedVideo = null;
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
  let transitionHidden = true;
  let transitionChannel = null;
  let layoutRaf = 0;
  let layoutSettleTimer = 0;
  let lastRoute = location.href;
  let lastSvgInner = "";
  let sharpnessScale = 1;
  let frameMonitor = createFrameMonitor();
  const originalFilters = new WeakMap();

  function isChzzkClipFrame() {
    try {
      const current = new URL(location.href);
      if (
        current.origin !== "https://m.naver.com" ||
        !current.pathname.startsWith("/shorts/") ||
        current.searchParams.get("serviceType") !== "CHZZK"
      ) {
        return false;
      }
      const referrer = document.referrer ? new URL(document.referrer) : null;
      return (
        (referrer?.origin === "https://chzzk.naver.com" &&
          (referrer.pathname === "/clips" ||
            referrer.pathname.startsWith("/clips/"))) ||
        current.searchParams.get("embed") === "true"
      );
    } catch {
      return false;
    }
  }

  if (!isChzzkClipFrame()) return;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function normalizeFilters(value) {
    const result = {};
    for (const key of PARAM_KEYS) {
      const param = PARAMS[key];
      const number = finite(value?.[key], param.neutral);
      result[key] = Math.max(param.min, Math.min(param.max, number));
    }
    return result;
  }

  function resolveSelectedPreset(data) {
    const requested = String(data?.[SELECTED_PRESET_KEY] || "beginner");
    const customPresets = Array.isArray(data?.[PRESETS_KEY])
      ? data[PRESETS_KEY]
      : [];
    const custom = customPresets.find(
      (preset) => String(preset?.id || "") === requested,
    );
    if (custom) {
      return {
        key: requested,
        label: String(custom.name || "커스텀"),
        filters: normalizeFilters(custom.filters || custom),
      };
    }
    const builtIn = BUILT_IN_PRESETS[requested] || BUILT_IN_PRESETS.beginner;
    return {
      key: BUILT_IN_PRESETS[requested] ? requested : "beginner",
      label: builtIn.label,
      filters: normalizeFilters(builtIn.filters),
    };
  }

  function applyStoredSettings(data) {
    const previousAlwaysOn = alwaysOn;
    const previousPreset = selectedPreset;
    masterEnabled = data?.[MASTER_KEY] !== false;
    const hidden = data?.[FEATURE_HIDDEN_KEY];
    featureHidden =
      Boolean(hidden && typeof hidden === "object") &&
      hidden.videoFilter === true;
    featureEnabled = data?.[ENABLED_KEY] !== false;
    alwaysOn = data?.[ALWAYS_ON_KEY] === true;
    const preset = resolveSelectedPreset(data);
    selectedPreset = preset.key;
    presetLabel = preset.label;
    filters = preset.filters;
    if (previousPreset !== selectedPreset) sharpnessScale = 1;

    if (!masterEnabled || featureHidden || !featureEnabled) {
      disableFilter();
      removeButton();
      return;
    }
    if (enabled) applyFilter(findActiveVideo());
    if (alwaysOn && !previousAlwaysOn) autoEnableSuppressed = false;
    scheduleSync();
  }

  async function loadSettings() {
    try {
      applyStoredSettings(
        await chrome.storage.local.get([
          MASTER_KEY,
          FEATURE_HIDDEN_KEY,
          PRESETS_KEY,
          ENABLED_KEY,
          ALWAYS_ON_KEY,
          SELECTED_PRESET_KEY,
        ]),
      );
    } catch {
      applyStoredSettings({});
    }
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

  function temperatureMatrix(temperature, tint) {
    const temp = temperature / 100;
    const tone = tint / 100;
    return [
      1 + 0.3 * temp - 0.1 * tone,
      0,
      0,
      0,
      0,
      0,
      1 + 0.15 * tone,
      0,
      0,
      0,
      0,
      0,
      1 - 0.3 * temp - 0.1 * tone,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ].join(" ");
  }

  function toneTable(shadows, highlights) {
    const shadow = shadows / 100;
    const highlight = highlights / 100;
    return [
      0,
      round3(clamp01(0.25 + 0.22 * shadow)),
      round3(clamp01(0.5 + 0.12 * shadow + 0.12 * highlight)),
      round3(clamp01(0.75 + 0.22 * highlight)),
      1,
    ].join(" ");
  }

  function sharpenKernel(amount) {
    const strength = amount / 100;
    const side = round3(-strength);
    return `0 ${side} 0 ${side} ${round3(1 + 4 * strength)} ${side} 0 ${side} 0`;
  }

  function effectiveSharpness() {
    return filters.sharpness * sharpnessScale;
  }

  function needsSvgFilter() {
    return (
      filters.temperature !== 0 ||
      filters.tint !== 0 ||
      filters.gamma !== 1 ||
      filters.shadows !== 0 ||
      filters.highlights !== 0 ||
      effectiveSharpness() > 0
    );
  }

  function ensureSvgFilter() {
    let root = document.getElementById(SVG_ROOT_ID);
    if (root) return root;
    root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    root.id = SVG_ROOT_ID;
    root.setAttribute("width", "0");
    root.setAttribute("height", "0");
    root.style.cssText =
      "position:absolute;width:0;height:0;pointer-events:none";
    root.innerHTML = `<defs><filter id="${SVG_FILTER_ID}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"></filter></defs>`;
    document.body.appendChild(root);
    return root;
  }

  function updateSvgFilter() {
    const filter = ensureSvgFilter().querySelector(`#${SVG_FILTER_ID}`);
    if (!filter) return;
    let inner = "";
    if (filters.temperature !== 0 || filters.tint !== 0) {
      inner += `<feColorMatrix type="matrix" values="${temperatureMatrix(filters.temperature, filters.tint)}"></feColorMatrix>`;
    }
    if (filters.gamma !== 1) {
      const exponent = round3(filters.gamma);
      inner += `<feComponentTransfer><feFuncR type="gamma" exponent="${exponent}"></feFuncR><feFuncG type="gamma" exponent="${exponent}"></feFuncG><feFuncB type="gamma" exponent="${exponent}"></feFuncB></feComponentTransfer>`;
    }
    if (filters.shadows !== 0 || filters.highlights !== 0) {
      const table = toneTable(filters.shadows, filters.highlights);
      inner += `<feComponentTransfer><feFuncR type="table" tableValues="${table}"></feFuncR><feFuncG type="table" tableValues="${table}"></feFuncG><feFuncB type="table" tableValues="${table}"></feFuncB></feComponentTransfer>`;
    }
    if (effectiveSharpness() > 0) {
      inner += `<feConvolveMatrix order="3" edgeMode="duplicate" preserveAlpha="true" kernelMatrix="${sharpenKernel(effectiveSharpness())}"></feConvolveMatrix>`;
    }
    if (inner !== lastSvgInner) {
      filter.innerHTML = inner;
      lastSvgInner = inner;
    }
  }

  function buildCssFilter() {
    const parts = [
      `brightness(${round3(filters.brightness * filters.exposure)})`,
      `contrast(${round3(filters.contrast)})`,
      `saturate(${round3(filters.saturation)})`,
    ];
    if (needsSvgFilter()) parts.push(`url(#${SVG_FILTER_ID})`);
    return parts.join(" ");
  }

  function ensureStyleRule(css) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    const rule = `video.${TARGET_CLASS} { filter: ${css} !important; }`;
    if (style.textContent !== rule) style.textContent = rule;
  }

  function rememberOriginalFilter(video) {
    if (originalFilters.has(video)) return;
    originalFilters.set(video, {
      value: video.style.getPropertyValue("filter"),
      priority: video.style.getPropertyPriority("filter"),
    });
  }

  function clearFilter(video = appliedVideo) {
    if (!(video instanceof HTMLVideoElement)) return;
    video.classList.remove(TARGET_CLASS);
    const original = originalFilters.get(video);
    if (original?.value) {
      video.style.setProperty("filter", original.value, original.priority);
    } else {
      video.style.removeProperty("filter");
    }
    originalFilters.delete(video);
    if (video === appliedVideo) appliedVideo = null;
  }

  function applyFilter(video) {
    if (!(video instanceof HTMLVideoElement) || !enabled) return;
    if (appliedVideo && appliedVideo !== video) clearFilter(appliedVideo);
    rememberOriginalFilter(video);
    if (needsSvgFilter()) updateSvgFilter();
    const css = buildCssFilter();
    video.style.setProperty("filter", css, "important");
    video.classList.add(TARGET_CLASS);
    ensureStyleRule(css);
    appliedVideo = video;
    syncFrameMonitor(video);
  }

  function disableFilter() {
    enabled = false;
    stopFrameMonitor();
    clearFilter();
    updateButton();
  }

  function createFrameMonitor() {
    return {
      timer: 0,
      video: null,
      lastTotal: 0,
      lastDropped: 0,
      badSamples: 0,
      goodSamples: 0,
    };
  }

  function readPlaybackQuality(video) {
    try {
      const quality = video.getVideoPlaybackQuality?.();
      if (!quality) return null;
      return {
        total: finite(quality.totalVideoFrames, 0),
        dropped: finite(quality.droppedVideoFrames, 0),
      };
    } catch {
      return null;
    }
  }

  function stopFrameMonitor() {
    if (frameMonitor.timer) clearInterval(frameMonitor.timer);
    frameMonitor = createFrameMonitor();
  }

  function syncFrameMonitor(video) {
    if (
      document.hidden ||
      !enabled ||
      filters.sharpness < HEAVY_SHARPNESS
    ) {
      stopFrameMonitor();
      return;
    }
    if (frameMonitor.timer && frameMonitor.video === video) return;
    stopFrameMonitor();
    const quality = readPlaybackQuality(video);
    frameMonitor.video = video;
    frameMonitor.lastTotal = quality?.total || 0;
    frameMonitor.lastDropped = quality?.dropped || 0;
    frameMonitor.timer = setInterval(sampleFrameQuality, FRAME_SAMPLE_INTERVAL_MS);
  }

  function sampleFrameQuality() {
    const video = frameMonitor.video;
    if (
      document.hidden ||
      !enabled ||
      video !== appliedVideo ||
      video?.paused
    ) {
      return;
    }
    const quality = readPlaybackQuality(video);
    if (!quality) {
      stopFrameMonitor();
      return;
    }
    const total = quality.total - frameMonitor.lastTotal;
    const dropped = quality.dropped - frameMonitor.lastDropped;
    frameMonitor.lastTotal = quality.total;
    frameMonitor.lastDropped = quality.dropped;
    if (total < 20) return;
    const ratio = Math.max(0, dropped) / total;
    frameMonitor.badSamples =
      ratio >= FRAME_DROP_BAD_RATIO ? frameMonitor.badSamples + 1 : 0;
    frameMonitor.goodSamples =
      ratio <= FRAME_DROP_GOOD_RATIO ? frameMonitor.goodSamples + 1 : 0;
    if (
      (ratio >= FRAME_DROP_SEVERE_RATIO || frameMonitor.badSamples >= 2) &&
      sharpnessScale > 0
    ) {
      sharpnessScale = Math.max(
        0,
        sharpnessScale - (ratio >= FRAME_DROP_SEVERE_RATIO ? 0.5 : 0.25),
      );
      frameMonitor.badSamples = 0;
      applyFilter(video);
    } else if (frameMonitor.goodSamples >= 5 && sharpnessScale < 1) {
      sharpnessScale = Math.min(1, sharpnessScale + 0.25);
      frameMonitor.goodSamples = 0;
      applyFilter(video);
    }
  }

  function filterIcon() {
    return `
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
        xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle class="cheese-clip-video-filter-dot" cx="28" cy="25" r="3"></circle>
        <circle cx="15" cy="14" r="6" stroke="currentColor" stroke-width="2.2"></circle>
        <circle cx="22" cy="20" r="6" stroke="currentColor" stroke-width="2.2"></circle>
        <path d="M9 26h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
      </svg>`;
  }

  function updateButton() {
    if (!button) return;
    tooltip ||= button.querySelector(`.${TOOLTIP_CLASS}`);
    button.classList.toggle("is-active", enabled && Boolean(appliedVideo));
    const action = enabled ? "끄기" : "켜기";
    button.setAttribute("aria-label", `비디오 필터 ${action} (${presetLabel} 프리셋)`);
    button.setAttribute("aria-pressed", String(enabled));
    button.removeAttribute("title");
    if (tooltip) {
      tooltip.innerHTML =
        `<strong class="${TOOLTIP_CLASS}-title"></strong>` +
        `<span class="${TOOLTIP_CLASS}-preset"></span>`;
      tooltip.firstElementChild.textContent = `비디오 필터 ${action}`;
      tooltip.lastElementChild.textContent = `${presetLabel} 프리셋`;
    }
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
    if (document.visibilityState === "hidden") return;
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
    if (document.visibilityState === "hidden") return;
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
      if (document.visibilityState === "hidden") return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = 0;
      sync();
    }, 120);
  }

  function ensureButton() {
    if (!masterEnabled || featureHidden || !featureEnabled) return;
    if (transitionHidden) {
      if (slot) slot.hidden = true;
      return;
    }
    const nativeButton = findVolumeButton();
    const nativeGroup =
      nativeButton?.closest(VOLUME_GROUP_SELECTOR) || nativeButton?.parentElement;
    const toolTop = nativeGroup?.closest(TOOL_TOP_SELECTOR);
    if (!nativeButton || !nativeGroup || !toolTop) {
      if (slot) slot.hidden = true;
      return;
    }
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
      anchorToolTop?.removeAttribute("data-cheese-clip-video-filter-toolbar");
      toolTop.setAttribute("data-cheese-clip-video-filter-toolbar", "");
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
      button.className = BUTTON_CLASS;
      button.innerHTML =
        filterIcon() +
        `<span class="${TOOLTIP_CLASS}" role="tooltip" aria-hidden="true"></span>`;
      tooltip = button.querySelector(`.${TOOLTIP_CLASS}`);
      button.addEventListener("click", onButtonClick);
      slot.appendChild(button);
    }
    updateButton();
  }

  function removeButton() {
    anchorResizeObserver?.disconnect();
    anchorToolTop?.removeAttribute("data-cheese-clip-video-filter-toolbar");
    const stack = slot?.closest(`.${STACK_CLASS}`);
    slot?.remove();
    if (stack && !stack.childElementCount) stack.remove();
    slot = null;
    button = null;
    tooltip = null;
    anchorGroup = null;
    anchorToolTop = null;
    requestSharedToolLayout();
  }

  function onButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (enabled) {
      autoEnableSuppressed = true;
      disableFilter();
      return;
    }
    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    autoEnableSuppressed = false;
    enabled = true;
    applyFilter(video);
    updateButton();
  }

  function revealButtonAfterTransition() {
    transitionRevealTimer = 0;
    transitionHidden = false;
    if (!document.hidden) scheduleSync();
  }

  function hideButtonDuringTransition() {
    transitionHidden = true;
    if (slot) slot.hidden = true;
    if (transitionRevealTimer) clearTimeout(transitionRevealTimer);
    transitionRevealTimer = setTimeout(
      revealButtonAfterTransition,
      TRANSITION_REVEAL_DELAY_MS,
    );
  }

  function startTransitionChannel() {
    if (transitionChannel || typeof BroadcastChannel !== "function") return;
    try {
      transitionChannel = new BroadcastChannel(TRANSITION_CHANNEL_NAME);
      transitionChannel.addEventListener("message", (event) => {
        if (event.data?.type === "transition-start") hideButtonDuringTransition();
      });
    } catch {
      transitionChannel = null;
    }
  }

  function sync() {
    syncTimer = 0;
    if (
      !masterEnabled ||
      featureHidden ||
      !featureEnabled ||
      document.hidden
    ) {
      return;
    }
    ensureButton();
    const video = findActiveVideo();
    if (alwaysOn && !enabled && !autoEnableSuppressed && video) enabled = true;
    if (
      enabled &&
      video instanceof HTMLVideoElement &&
      (video !== appliedVideo || !video.classList.contains(TARGET_CLASS))
    ) {
      applyFilter(video);
    }
    updateButton();
  }

  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(sync, SYNC_DELAY_MS);
  }

  function nodeContainsSyncTarget(node) {
    if (!(node instanceof Element)) return false;
    if (node.matches(OBSERVER_RELEVANT_SELECTOR)) return true;
    return Boolean(node.querySelector(OBSERVER_RELEVANT_SELECTOR));
  }

  function isRelevantMutation(mutation) {
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      nodeContainsSyncTarget,
    );
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      if (!document.hidden && mutations.some(isRelevantMutation)) scheduleSync();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startRouteWatcher() {
    if (routeTimer) return;
    routeTimer = setInterval(() => {
      if (
        document.hidden ||
        !masterEnabled ||
        featureHidden ||
        !featureEnabled
      ) {
        return;
      }
      const routeChanged = location.href !== lastRoute;
      if (routeChanged) lastRoute = location.href;
      if (
        routeChanged ||
        !slot?.isConnected ||
        !anchorGroup?.isConnected ||
        (enabled && !appliedVideo?.isConnected)
      ) {
        scheduleSync();
      }
    }, ROUTE_CHECK_MS);
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      changes[MASTER_KEY] ||
      changes[FEATURE_HIDDEN_KEY] ||
      changes[PRESETS_KEY] ||
      changes[ENABLED_KEY] ||
      changes[ALWAYS_ON_KEY] ||
      changes[SELECTED_PRESET_KEY]
    ) {
      void loadSettings();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopFrameMonitor();
    else scheduleSync();
  });
  window.addEventListener("resize", scheduleSync);
  window.visualViewport?.addEventListener("resize", scheduleSync);
  window.addEventListener(TOOL_LAYOUT_EVENT, scheduleSharedToolLayout);
  window.addEventListener("wheel", hideButtonDuringTransition, {
    capture: true,
    passive: true,
  });
  window.addEventListener("touchmove", hideButtonDuringTransition, {
    capture: true,
    passive: true,
  });

  window.addEventListener("pagehide", (event) => {
    if (syncTimer) clearTimeout(syncTimer);
    if (routeTimer) clearInterval(routeTimer);
    if (transitionRevealTimer) clearTimeout(transitionRevealTimer);
    syncTimer = 0;
    routeTimer = 0;
    transitionRevealTimer = 0;
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = 0;
    if (layoutSettleTimer) clearTimeout(layoutSettleTimer);
    layoutSettleTimer = 0;
    observer?.disconnect();
    observer = null;
    anchorResizeObserver?.disconnect();
    stopFrameMonitor();
    clearFilter();
    removeButton();
    if (!event.persisted) {
      transitionChannel?.close();
      transitionChannel = null;
      document.getElementById(SVG_ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    startTransitionChannel();
    startObserver();
    startRouteWatcher();
    hideButtonDuringTransition();
    scheduleSync();
  });

  startTransitionChannel();
  startObserver();
  startRouteWatcher();
  await loadSettings();
  hideButtonDuringTransition();
  scheduleSync();
})();
