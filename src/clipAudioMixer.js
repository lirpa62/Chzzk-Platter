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
  const ALWAYS_ON_KEY = "cheeseClipAudioMixerAlwaysOn";
  const SELECTED_PRESET_KEY = "cheeseClipAudioMixerPreset";
  const EQ_BANDS = [
    60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000,
  ];
  const BUTTON_CLASS = "cheese-clip-audio-mixer-button";
  const SLOT_CLASS = "cheese-clip-audio-mixer-slot";
  const TOOLTIP_CLASS = "cheese-clip-audio-mixer-tooltip";
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
  const TRANSITION_CHANNEL_NAME =
    "cheese-platter-clip-audio-mixer-transition";

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
    inputGain: null,
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
  let alwaysOn = false;
  let selectedPreset = "default";
  let presetLabel = "기본";
  let presetSnapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
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
  let lastTransitionBroadcastAt = 0;
  let transitionHidden = true;
  let transitionChannel = null;
  let lastRoute = location.href;
  let graphError = "";

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
        target: finite(
          normalizer?.target,
          DEFAULT_SNAPSHOT.normalizer.target,
        ),
      },
    };
  }

  function resolveSelectedPreset(data) {
    const presets = Array.isArray(data?.[PRESETS_KEY])
      ? data[PRESETS_KEY]
      : [];
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
        ? presets.find(
            (preset) => String(preset?.id || "") === defaultCustomId,
          )
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

  function applyStoredSettings(data) {
    const previousAlwaysOn = alwaysOn;
    masterEnabled = data?.[MASTER_KEY] !== false;
    const hidden = data?.[FEATURE_HIDDEN_KEY];
    featureHidden =
      Boolean(hidden && typeof hidden === "object") &&
      hidden.audioMixer === true;
    alwaysOn = data?.[ALWAYS_ON_KEY] === true;
    const preset = resolveSelectedPreset(data);
    selectedPreset = preset.key;
    presetLabel = preset.label;
    presetSnapshot = preset.snapshot;

    if (!masterEnabled || featureHidden) {
      disarmAutoEnable();
      disableMixer();
      removeButton();
      return;
    }

    if (enabled && audio.connected) applySnapshot();
    if (alwaysOn && !previousAlwaysOn) autoEnableSuppressed = false;
    if (alwaysOn && !enabled && !autoEnableSuppressed) armAutoEnable();
    else if (!alwaysOn) disarmAutoEnable();
    scheduleSync();
  }

  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get([
        MASTER_KEY,
        FEATURE_HIDDEN_KEY,
        PRESETS_KEY,
        DEFAULT_CUSTOM_KEY,
        ALWAYS_ON_KEY,
        SELECTED_PRESET_KEY,
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
    button.setAttribute(
      "aria-pressed",
      String(enabled && audio.connected),
    );
    if (tooltip) {
      tooltip.innerHTML =
        `<strong class="${TOOLTIP_CLASS}-title"></strong>` +
        `<span class="${TOOLTIP_CLASS}-preset"></span>`;
      tooltip.firstElementChild.textContent = `오디오 믹서 ${action}`;
      tooltip.lastElementChild.textContent = `${presetLabel} 프리셋`;
    }
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

  function positionButtonSlot(nativeButton, nativeGroup, toolTop) {
    if (!slot) return;
    const buttonRect = nativeButton.getBoundingClientRect();
    const groupRect = nativeGroup.getBoundingClientRect();
    const toolStyle = getComputedStyle(toolTop);
    const gap = finite(
      parseFloat(toolStyle.rowGap || toolStyle.gap),
      16,
    );
    const slotWidth = 48;
    const slotHeight = 48;
    const aboveTop = groupRect.top - gap - slotHeight;
    slot.style.left = `${Math.round(
      buttonRect.left + (buttonRect.width - slotWidth) / 2,
    )}px`;
    slot.style.top = `${Math.round(
      aboveTop >= 0 ? aboveTop : groupRect.bottom + gap,
    )}px`;
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

  function postTransitionStart() {
    transitionBroadcastTimer = 0;
    lastTransitionBroadcastAt = Date.now();
    try {
      transitionChannel?.postMessage({ type: "transition-start" });
    } catch {}
  }

  function broadcastTransitionStart() {
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
    broadcastTransitionStart();
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
    if (!masterEnabled || featureHidden) return;
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
    // 제거해 확장과 재삽입 경쟁이 발생한다. body 포털에 두고 볼륨 좌표를 따라가면
    // DOM 소유권 충돌 없이 항상 볼륨 바로 아래에 표시할 수 있다.
    if (!slot?.isConnected || slot.parentElement !== document.body) {
      slot?.remove();
      slot = document.createElement("div");
      slot.className = SLOT_CLASS;
      document.body.appendChild(slot);
      button = null;
    }
    slot.hidden = false;
    if (anchorToolTop !== toolTop) {
      anchorToolTop?.removeAttribute(
        "data-cheese-clip-audio-mixer-toolbar",
      );
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
    slot?.remove();
    slot = null;
    button = null;
    tooltip = null;
    anchorGroup = null;
    anchorToolTop = null;
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
      audio.normGain.gain.setTargetAtTime(
        desired,
        audio.ctx.currentTime,
        0.6,
      );
    }, NORM_INTERVAL_MS);
  }

  function applySnapshot() {
    if (!audio.connected) return;

    audio.inputGain.gain.value = presetSnapshot.gain;
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

  function restoreOriginalAudio({ restoreSource = true } = {}) {
    stopNormalizer();
    unbindNormalizerVideo();
    try {
      if (audio.source && audio.ctx) {
        audio.source.disconnect();
        if (restoreSource) audio.source.connect(audio.ctx.destination);
      }
    } catch {}
    const nodes = [
      audio.inputGain,
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
    audio.inputGain = null;
    audio.normGain = null;
    audio.analyser = null;
    audio.eqFilters = [];
    audio.comp = null;
    audio.outputGain = null;
    audio.limiter = null;
    audio.source = null;
    audio.video = null;
    audio.connected = false;
  }

  function connectGraph(video) {
    try {
      graphError = "";
      audio.ctx ||= new AudioContext();
      if (audio.ctx.state !== "running") {
        audio.ctx.resume().catch(() => {});
      }

      if (audio.connected || audio.source) {
        // 같은 영상에서 믹서를 다시 구성할 때만 잠깐 원음으로 복구한다.
        // 다음 클립으로 넘어갈 때 이전 source를 destination에 다시 연결하면
        // 제거된 video/blob과 AudioNode가 그래프에 계속 남을 수 있다.
        restoreOriginalAudio({
          restoreSource: !audio.video || audio.video === video,
        });
      }

      audio.source = getMediaSource(video);
      audio.video = video;
      bindNormalizerVideo(video);
      audio.inputGain = audio.ctx.createGain();
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
      audio.source.connect(audio.inputGain);
      audio.inputGain.connect(audio.normGain);
      audio.inputGain.connect(audio.analyser);
      let node = audio.normGain;
      for (const filter of audio.eqFilters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(audio.comp);
      audio.comp.connect(audio.outputGain);
      audio.outputGain.connect(audio.limiter);
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
      !alwaysOn ||
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

  function tryAutoEnableWithoutGesture() {
    if (
      !alwaysOn ||
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

    try {
      audio.ctx ||= new AudioContext();
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
    if (!alwaysOn || !masterEnabled || featureHidden) {
      disarmAutoEnable();
      return;
    }

    const video = findActiveVideo();
    if (!(video instanceof HTMLVideoElement)) return;
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
    enabled = true;
    if (!connectGraph(video)) return;
    disarmAutoEnable();
    updateButton();
  }

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
    if (alwaysOn && !enabled && !autoEnableSuppressed) {
      tryAutoEnableWithoutGesture();
    }
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
    const target = mutation.target;
    if (target instanceof Element && target.matches("video")) {
      return true;
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some(
      nodeContainsSyncTarget,
    );
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
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
    if (routeTimer) return;
    routeTimer = setInterval(() => {
      const routeChanged = location.href !== lastRoute;
      if (routeChanged) {
        lastRoute = location.href;
        graphError = "";
        if (alwaysOn && !enabled && !autoEnableSuppressed) armAutoEnable();
      }
      if (document.hidden || !masterEnabled || featureHidden) return;
      if (
        routeChanged ||
        !slot?.isConnected ||
        !anchorGroup?.isConnected
      ) {
        scheduleSync();
      }
    }, ROUTE_CHECK_MS);
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      !changes[MASTER_KEY] &&
      !changes[FEATURE_HIDDEN_KEY] &&
      !changes[PRESETS_KEY] &&
      !changes[DEFAULT_CUSTOM_KEY] &&
      !changes[ALWAYS_ON_KEY] &&
      !changes[SELECTED_PRESET_KEY]
    ) {
      return;
    }
    void loadSettings();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncNormalizerActivity();
      scheduleSync();
    } else if (audio.video?.paused) {
      stopNormalizer();
    }
  });
  window.addEventListener("resize", scheduleSync);
  window.visualViewport?.addEventListener("resize", scheduleSync);
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
    hideButtonDuringTransition();
    startObserver();
    startRouteWatcher();
    if (alwaysOn && !autoEnableSuppressed) armAutoEnable();
    scheduleSync();
  });

  startTransitionChannel();
  startObserver();
  startRouteWatcher();
  await loadSettings();
  hideButtonDuringTransition();
  sync();
})();
