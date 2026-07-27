// 치지직 클립 에디터 정밀 구간 조정(MAIN world).
// 0.1초 조정은 React 상태 디스패처를 우선 사용하고, 찾지 못하면 기존 드래그
// 핸들에 마우스 이벤트를 전달해 치지직의 구간 제한 로직을 그대로 따른다.
(() => {
  "use strict";

  if (window.top !== window || !location.pathname.startsWith("/clip-editor")) {
    return;
  }
  if (window.__cheeseClipEditorEnhancerLoaded) return;
  window.__cheeseClipEditorEnhancerLoaded = true;

  const FEATURE_MESSAGE = "cheese-feature-flags";
  const FEATURE_REQUEST = "cheese-feature-flags-request";
  const TIMELINE_INNER_PADDING = 14;
  const MIN_CLIP_SECONDS = 10;
  const MAX_CLIP_SECONDS = 120;
  const MAX_EDITOR_SECONDS = 180;
  const EPSILON = 0.001;
  const REACT_STATE_TOLERANCE = 0.075;

  let enabled = false;
  let flagsReceived = false;
  let flagRequestTimer = 0;
  let flagRequestCount = 0;
  let documentObserver = null;
  let ensureFrame = 0;
  let binding = null;
  let mediaElement = null;
  let editorWindowExpansion = null;
  let arrowSeekStep = 5;
  let shiftArrowSeekStep = 0.1;
  let boundaryInnerStep = 0.1;
  let boundaryOuterStep = 1;

  function requestFlags() {
    window.postMessage({ source: FEATURE_REQUEST }, location.origin);
  }

  function stopFlagRequests() {
    if (flagRequestTimer) clearInterval(flagRequestTimer);
    flagRequestTimer = 0;
  }

  function startFlagRequests() {
    requestFlags();
    flagRequestTimer = window.setInterval(() => {
      if (flagsReceived || flagRequestCount >= 20) {
        stopFlagRequests();
        return;
      }
      flagRequestCount += 1;
      requestFlags();
    }, 250);
  }

  function setEnabled(next) {
    if (enabled === next) return;
    enabled = next;
    if (enabled) {
      startDocumentObserver();
      scheduleEnsure();
    } else {
      stopDocumentObserver();
      unmount();
    }
  }

  function normalizeArrowSeekStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(5, Math.max(1, Math.round(number)))
      : 5;
  }

  function normalizeShiftArrowSeekStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(0.9, Math.max(0.1, Math.round(number * 10) / 10))
      : 0.1;
  }

  function normalizeBoundaryInnerStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(1, Math.max(0.1, Math.round(number * 10) / 10))
      : 0.1;
  }

  function normalizeBoundaryOuterStep(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(10, Math.max(1, Math.round(number)))
      : 1;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== FEATURE_MESSAGE) {
      return;
    }
    flagsReceived = true;
    stopFlagRequests();
    arrowSeekStep = normalizeArrowSeekStep(
      event.data?.clipEditorArrowStep,
    );
    shiftArrowSeekStep = normalizeShiftArrowSeekStep(
      event.data?.clipEditorShiftArrowStep,
    );
    setBoundarySteps(
      event.data?.clipEditorBoundaryStep,
      event.data?.clipEditorBoundaryOuterStep,
    );
    setEnabled(event.data?.flags?.clipEditorPrecision === true);
  });

  function bindingIsIntact() {
    return Boolean(
      binding?.root?.isConnected &&
        binding.panel?.isConnected &&
        binding.seeker?.isConnected &&
        binding.seekerTime?.isConnected &&
        binding.rangeText?.isConnected &&
        binding.edges?.every((edge) => edge.isConnected),
    );
  }

  function startDocumentObserver() {
    if (documentObserver || !document.documentElement) return;
    documentObserver = new MutationObserver((mutations) => {
      if (binding) {
        const mountedNodes = [
          binding.root,
          binding.panel,
          binding.seeker,
          binding.seekerTime,
          binding.rangeText,
          ...binding.edges,
        ];
        const mountedNodeWasRemoved = mutations.some((mutation) =>
          Array.from(mutation.removedNodes).some((removed) =>
            mountedNodes.some(
              (mounted) =>
                removed === mounted ||
                (removed instanceof Element && removed.contains(mounted)),
            ),
          ),
        );
        if (!mountedNodeWasRemoved) return;
      }
      scheduleEnsure();
    });
    documentObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function stopDocumentObserver() {
    documentObserver?.disconnect();
    documentObserver = null;
    if (ensureFrame) cancelAnimationFrame(ensureFrame);
    ensureFrame = 0;
  }

  function scheduleEnsure() {
    if (!enabled || ensureFrame) return;
    ensureFrame = requestAnimationFrame(() => {
      ensureFrame = 0;
      ensureMounted();
    });
  }

  function findTimeline() {
    const rulers = document.querySelectorAll('ol[class*="_ruler_"]');
    for (const ruler of rulers) {
      const root = ruler.parentElement;
      if (!root) continue;
      const edges = Array.from(
        root.querySelectorAll(':scope > span[class*="_edge_"]'),
      );
      const play = root.querySelector(':scope > span[class*="_play_"]');
      const seeker = root.querySelector(':scope > div[class*="_seeker_"]');
      const rangeText = play?.querySelector('[class*="_time_"]');
      if (edges.length === 2 && play && seeker && rangeText) {
        return {
          root,
          ruler,
          edges,
          play,
          seeker,
          rangeText,
        };
      }
    }
    return null;
  }

  function ensureMounted() {
    if (!enabled) return;
    const timeline = findTimeline();
    if (!timeline) return;
    if (binding?.root === timeline.root && bindingIsIntact()) {
      syncFromNative();
      return;
    }
    mount(timeline);
  }

  function parseClock(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const parts = text.split(":");
    if (parts.length > 3) return null;
    let seconds = 0;
    for (const part of parts) {
      const number = Number(part);
      if (!Number.isFinite(number) || number < 0) return null;
      seconds = seconds * 60 + number;
    }
    return seconds;
  }

  function parseNativeRange(text) {
    const match = String(text || "").match(
      /(\d+:\d{2}(?:\.\d+)?)\s*~\s*(\d+:\d{2}(?:\.\d+)?)/,
    );
    if (!match) return null;
    const start = parseClock(match[1]);
    const end = parseClock(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }
    return { start, end };
  }

  function formatClock(seconds, forceHours = true) {
    const safe = Math.max(0, Number(seconds) || 0);
    const tenths = Math.round(safe * 10);
    const hours = Math.floor(tenths / 36000);
    const minutes = Math.floor((tenths % 36000) / 600);
    const secs = Math.floor((tenths % 600) / 10);
    const decimal = tenths % 10;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(secs).padStart(2, "0");
    if (forceHours || hours > 0) {
      return `${String(hours).padStart(2, "0")}:${mm}:${ss}.${decimal}`;
    }
    return `${minutes}:${ss}.${decimal}`;
  }

  function findMediaDeep(root = document) {
    const direct = root.querySelector?.("video");
    if (direct) return direct;
    const elements = root.querySelectorAll?.("*") || [];
    for (const element of elements) {
      if (!element.shadowRoot) continue;
      const nested = findMediaDeep(element.shadowRoot);
      if (nested) return nested;
    }
    return null;
  }

  function getMedia() {
    const clipPlayer = window.clipPlayer;
    if (
      clipPlayer &&
      typeof clipPlayer.pause === "function" &&
      "currentTime" in clipPlayer
    ) {
      return clipPlayer;
    }
    if (mediaElement?.isConnected) return mediaElement;
    const localRoot =
      binding?.root?.parentElement?.parentElement || document.body;
    mediaElement = findMediaDeep(localRoot) || findMediaDeep(document);
    return mediaElement;
  }

  function inferOuterDuration(range) {
    const params = new URLSearchParams(location.search);
    const contentType = params.get("contentType");
    const offset = Math.max(0, Number(params.get("offsetTime")) || 0);
    if (contentType === "video") {
      return Math.min(MAX_EDITOR_SECONDS, offset);
    }
    const media = getMedia();
    if (contentType === "live" && Number.isFinite(media?.duration)) {
      return Math.min(
        MAX_EDITOR_SECONDS,
        Math.max(0, media.duration - offset),
      );
    }
    return Math.min(
      MAX_EDITOR_SECONDS,
      Math.max(range?.end || 0, binding?.outerDuration || 0),
    );
  }

  function formatStepValue(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function syncStepButton(button) {
    const direction = Number(button.dataset.stepDirection);
    if (!Number.isFinite(direction)) return;
    const amount =
      button.dataset.stepKind === "outer"
        ? boundaryOuterStep
        : boundaryInnerStep;
    const delta = Math.round(amount * direction * 10) / 10;
    button.dataset.delta = String(delta);
    button.textContent = `${delta < 0 ? "−" : "+"}${formatStepValue(
      Math.abs(delta),
    )}`;
    const directionLabel = delta < 0 ? "앞으로" : "뒤로";
    const boundary =
      button.dataset.boundary === "start" ? "시작" : "종료";
    button.title = `${boundary} 시각을 ${formatStepValue(
      Math.abs(delta),
    )}초 ${directionLabel} 이동`;
    button.setAttribute("aria-label", button.title);
  }

  function syncBoundaryStepButtons() {
    binding?.panel
      ?.querySelectorAll(".cheese-clip-editor-step")
      .forEach(syncStepButton);
  }

  function setBoundarySteps(innerValue, outerValue) {
    boundaryInnerStep = normalizeBoundaryInnerStep(innerValue);
    boundaryOuterStep = normalizeBoundaryOuterStep(outerValue);
    syncBoundaryStepButtons();
  }

  function createStepButton(boundary, stepKind, direction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cheese-clip-editor-step";
    button.dataset.boundary = boundary;
    button.dataset.stepKind = stepKind;
    button.dataset.stepDirection = String(direction);
    syncStepButton(button);
    return button;
  }

  function createBoundaryControl(kind, label) {
    const row = document.createElement("div");
    row.className = "cheese-clip-editor-boundary";
    row.dataset.boundaryRow = kind;

    const name = document.createElement("span");
    name.className = "cheese-clip-editor-boundary-label";
    name.textContent = label;

    const controls = document.createElement("div");
    controls.className = "cheese-clip-editor-boundary-controls";
    controls.append(
      createStepButton(kind, "outer", -1),
      createStepButton(kind, "inner", -1),
    );

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cheese-clip-editor-time-input";
    input.dataset.boundaryInput = kind;
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${label} 시각`);
    controls.append(input);

    controls.append(
      createStepButton(kind, "inner", 1),
      createStepButton(kind, "outer", 1),
    );
    row.append(name, controls);
    return row;
  }

  function createSeekerActions() {
    const row = document.createElement("div");
    row.className = "cheese-clip-editor-seeker-actions";

    const current = document.createElement("span");
    current.className = "cheese-clip-editor-current-time";
    current.append("현재 ");
    const output = document.createElement("output");
    output.dataset.currentSeekerTime = "";
    output.textContent = "0:00.0";
    current.append(output);

    const actions = document.createElement("div");
    actions.className = "cheese-clip-editor-seeker-action-buttons";
    for (const [kind, label] of [
      ["start", "시작에 입력"],
      ["end", "종료에 입력"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cheese-clip-editor-seeker-action";
      button.dataset.applySeekerTo = kind;
      button.textContent = label;
      actions.append(button);
    }

    row.append(current, actions);
    return row;
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.className = "cheese-clip-editor-precision";
    panel.setAttribute("aria-label", "클립 구간 정밀 조정");

    const head = document.createElement("div");
    head.className = "cheese-clip-editor-precision-head";
    const title = document.createElement("strong");
    title.textContent = "정밀 구간 조정";
    const headActions = document.createElement("div");
    headActions.className = "cheese-clip-editor-precision-head-actions";
    const basis = document.createElement("span");
    basis.className = "cheese-clip-editor-time-basis";
    basis.dataset.timeBasis = "";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "cheese-clip-editor-reset";
    reset.dataset.resetRange = "";
    reset.title = "구간 초기화";
    reset.setAttribute("aria-label", "구간 초기화");
    reset.disabled = true;
    reset.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M3 12a9 9 0 1 0 3-7.7L3 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '<path d="M3 3v4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
      "</svg>";
    headActions.append(basis, reset);
    head.append(title, headActions);

    const body = document.createElement("div");
    body.className = "cheese-clip-editor-precision-body";
    body.append(
      createBoundaryControl("start", "시작"),
      createBoundaryControl("end", "종료"),
      createSeekerActions(),
    );

    const duration = document.createElement("output");
    duration.className = "cheese-clip-editor-duration";
    duration.dataset.duration = "";
    duration.setAttribute("aria-live", "polite");
    body.append(duration);

    panel.append(head, body);
    return panel;
  }

  function createRulerLabels() {
    const labels = document.createElement("div");
    labels.className = "cheese-clip-editor-ruler-labels";
    labels.setAttribute("aria-hidden", "true");
    return labels;
  }

  function createSeekerTime() {
    const output = document.createElement("output");
    output.className = "cheese-clip-editor-seeker-time";
    output.setAttribute("aria-hidden", "true");
    output.title = "현재 재생 시각";
    return output;
  }

  function getSeekerMetrics() {
    if (!binding?.outerDuration) return null;
    const rootRect = binding.root.getBoundingClientRect();
    const seekerRect = binding.seeker.getBoundingClientRect();
    const usableWidth = rootRect.width - TIMELINE_INNER_PADDING * 2;
    if (usableWidth <= 0) return null;
    const centerInViewport = seekerRect.left + seekerRect.width / 2;
    const position = Math.min(
      usableWidth,
      Math.max(
        0,
        centerInViewport - rootRect.left - TIMELINE_INNER_PADDING,
      ),
    );
    return {
      time: (position / usableWidth) * binding.outerDuration,
      center: centerInViewport - rootRect.left,
      rootWidth: rootRect.width,
    };
  }

  function getSeekerRelativeTime() {
    return getSeekerMetrics()?.time ?? null;
  }

  function syncSeekerTime() {
    if (
      !binding?.seekerTime?.isConnected ||
      document.visibilityState === "hidden"
    ) {
      return;
    }
    const metrics = getSeekerMetrics();
    const time = metrics?.time;
    if (!Number.isFinite(time)) return;
    const text = formatClock(time, false);
    const changed = binding.lastSeekerTimeText !== text;
    if (changed) {
      binding.seekerTime.textContent = text;
      const panelOutput = binding.panel.querySelector(
        "[data-current-seeker-time]",
      );
      if (panelOutput) panelOutput.textContent = text;
      binding.lastSeekerTimeText = text;
    }
    binding.currentSeekerTime = time;

    if (!changed) return;
    binding.seekerTime.classList.toggle("is-near-start", metrics.center < 34);
    binding.seekerTime.classList.toggle(
      "is-near-end",
      metrics.rootWidth - metrics.center < 34,
    );
  }

  function shouldPollSeekerTime() {
    if (binding?.root?.classList.contains("is-seeker-dragging")) return true;
    if (mediaElement && !mediaElement.isConnected) mediaElement = null;
    const media = window.clipPlayer || mediaElement;
    return !media || media.paused !== true;
  }

  function stopPlaybackTimer() {
    if (!binding?.playbackTimer) return;
    clearInterval(binding.playbackTimer);
    binding.playbackTimer = 0;
  }

  function startPlaybackTimer() {
    if (
      !binding ||
      binding.playbackTimer ||
      document.visibilityState === "hidden"
    ) {
      return;
    }
    binding.playbackTimer = window.setInterval(() => {
      if (shouldPollSeekerTime()) syncSeekerTime();
    }, 125);
  }

  function onDocumentVisibilityChange() {
    if (document.visibilityState === "hidden") {
      stopPlaybackTimer();
      return;
    }
    startPlaybackTimer();
    syncSeekerTime();
  }

  function renderRulerLabels() {
    if (!binding?.labels || !binding.outerDuration) return;
    const duration = binding.outerDuration;
    const interval = duration <= 90 ? 15 : 30;
    const values = [];
    for (let value = 0; value < duration; value += interval) {
      values.push(value);
    }
    values.push(duration);
    const signature = `${Math.round(duration * 10)}:${interval}:${values.length}`;
    if (
      binding.rulerSignature === signature &&
      binding.labels.childElementCount === values.length
    ) {
      return;
    }
    binding.rulerSignature = signature;
    binding.labels.replaceChildren(
      ...values.map((value) => {
        const label = document.createElement("span");
        label.style.left = `${(value / duration) * 100}%`;
        label.textContent = formatClock(value, false);
        return label;
      }),
    );
  }

  function scheduleNativeSync() {
    if (!binding || binding.nativeSyncFrame) return;
    const mountedBinding = binding;
    mountedBinding.nativeSyncFrame = requestAnimationFrame(() => {
      mountedBinding.nativeSyncFrame = 0;
      if (binding === mountedBinding) syncFromNative();
    });
  }

  function updateBoundaryAria() {
    if (!binding?.range) return;
    const { start, end } = binding.range;
    const values = [start, end];
    binding.edges.forEach((edge, index) => {
      edge.setAttribute("aria-valuemin", "0");
      edge.setAttribute(
        "aria-valuemax",
        String(Math.round(binding.outerDuration * 10) / 10),
      );
      edge.setAttribute(
        "aria-valuenow",
        String(Math.round(values[index] * 10) / 10),
      );
      edge.setAttribute(
        "aria-valuetext",
        formatClock(values[index], false),
      );
    });
  }

  function syncResetButtonState() {
    const button = binding?.panel?.querySelector("[data-reset-range]");
    const initial = binding?.initialRange;
    const current = binding?.range;
    if (!button) return;
    button.disabled =
      !initial ||
      !current ||
      (Math.abs(initial.start - current.start) < EPSILON &&
        Math.abs(initial.end - current.end) < EPSILON);
  }

  function syncFromNative() {
    if (!binding?.root?.isConnected) {
      scheduleEnsure();
      return;
    }
    const range = parseNativeRange(binding.rangeText.textContent);
    if (!range) return;
    const outerDuration = inferOuterDuration(range);
    if (outerDuration > 0) binding.outerDuration = outerDuration;
    binding.range = {
      start: Math.min(binding.outerDuration, Math.max(0, range.start)),
      end: Math.min(binding.outerDuration, Math.max(0, range.end)),
    };
    if (!binding.initialRange) {
      binding.initialRange = { ...binding.range };
    }

    for (const kind of ["start", "end"]) {
      const input = binding.panel.querySelector(
        `[data-boundary-input="${kind}"]`,
      );
      if (input && document.activeElement !== input) {
        input.value = formatClock(binding.range[kind], false);
        input.classList.remove("is-invalid");
      }
    }
    const duration = Math.max(0, binding.range.end - binding.range.start);
    const output = binding.panel.querySelector("[data-duration]");
    if (output) output.textContent = `길이 ${duration.toFixed(1)}초`;
    const basis = binding.panel.querySelector("[data-time-basis]");
    if (basis) basis.textContent = "편집 구간 기준";
    updateBoundaryAria();
    syncResetButtonState();
    renderRulerLabels();
    syncSeekerTime();
  }

  function clampBoundary(kind, value) {
    const { start, end } = binding.range;
    if (kind === "start") {
      return Math.min(
        end - MIN_CLIP_SECONDS,
        Math.max(0, Math.max(end - MAX_CLIP_SECONDS, value)),
      );
    }
    return Math.max(
      start + MIN_CLIP_SECONDS,
      Math.min(
        binding.outerDuration,
        Math.min(start + MAX_CLIP_SECONDS, value),
      ),
    );
  }

  function getReactFiber(element) {
    if (!element) return null;
    const key = Object.getOwnPropertyNames(element).find(
      (name) =>
        name.startsWith("__reactFiber$") ||
        name.startsWith("__reactInternalInstance$"),
    );
    return key ? element[key] : null;
  }

  function inspectBoundaryHooks(fiber) {
    if (!fiber?.memoizedState || !binding?.range) return null;
    const stateHooks = [];
    let hook = fiber.memoizedState;
    for (let index = 0; hook && index < 40; index += 1) {
      const value = Number(hook.memoizedState);
      if (
        Number.isFinite(value) &&
        typeof hook.queue?.dispatch === "function"
      ) {
        stateHooks.push({ hook, value, index });
      }
      hook = hook.next;
    }
    const selectedDuration = binding.range.end - binding.range.start;
    let best = null;
    for (const startState of stateHooks) {
      for (const endState of stateHooks) {
        if (endState.index <= startState.index) continue;
        if (
          Math.abs(
            endState.value - startState.value - selectedDuration,
          ) > REACT_STATE_TOLERANCE
        ) {
          continue;
        }
        const startBase = startState.value - binding.range.start;
        const endBase = endState.value - binding.range.end;
        if (Math.abs(startBase - endBase) > REACT_STATE_TOLERANCE) {
          continue;
        }
        const score = endState.index - startState.index;
        if (!best || score < best.score) {
          best = {
            startHook: startState.hook,
            endHook: endState.hook,
            base: (startBase + endBase) / 2,
            score,
          };
        }
      }
    }
    return best;
  }

  function findReactBoundaryController() {
    let fiber = getReactFiber(binding?.root);
    for (let depth = 0; fiber && depth < 12; depth += 1) {
      const current = inspectBoundaryHooks(fiber);
      if (current) return current;
      const alternate = inspectBoundaryHooks(fiber.alternate);
      if (alternate) return alternate;
      fiber = fiber.return;
    }
    return null;
  }

  function dispatchMouse(target, type, x, y, buttons) {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons,
        clientX: x,
        clientY: y,
      }),
    );
  }

  function moveBoundary(kind, requested) {
    if (!binding?.range || !binding.outerDuration) return;
    const current = binding.range[kind];
    const target = clampBoundary(kind, requested);
    if (!Number.isFinite(target) || Math.abs(target - current) < EPSILON) {
      syncFromNative();
      return;
    }
    const controller = findReactBoundaryController();
    if (controller) {
      binding.playerBase = controller.base;
      const hook =
        kind === "start" ? controller.startHook : controller.endHook;
      hook.queue.dispatch(controller.base + target);
      setTimeout(syncFromNative, 30);
      return;
    }

    const edge = binding.edges[kind === "start" ? 0 : 1];
    const timelineRect = binding.root.getBoundingClientRect();
    const edgeRect = edge.getBoundingClientRect();
    const usableWidth = timelineRect.width - TIMELINE_INNER_PADDING * 2;
    if (usableWidth <= 0) return;

    const pixelsPerSecond = usableWidth / binding.outerDuration;
    const x = edgeRect.left + edgeRect.width / 2;
    const y = edgeRect.top + edgeRect.height / 2;
    const targetX = x + (target - current) * pixelsPerSecond;
    dispatchMouse(edge, "mousedown", x, y, 1);
    dispatchMouse(document, "mousemove", targetX, y, 1);
    // edge에서 mouseup을 시작해야 원본 컴포넌트의 로컬 onMouseUp까지 거친 뒤
    // document/window 리스너로 전파돼 드래그 상태가 남지 않는다.
    dispatchMouse(edge, "mouseup", targetX, y, 0);
    setTimeout(syncFromNative, 0);
  }

  function resetBoundaryRange() {
    if (!binding?.range || !binding.initialRange) return;
    const target = { ...binding.initialRange };
    const controller = findReactBoundaryController();
    const resetButton = binding.panel.querySelector("[data-reset-range]");
    if (resetButton) resetButton.disabled = true;

    if (controller) {
      binding.playerBase = controller.base;
      controller.startHook.queue.dispatch(controller.base + target.start);
      controller.endHook.queue.dispatch(controller.base + target.end);
      setTimeout(syncFromNative, 30);
      setTimeout(syncFromNative, 100);
      return;
    }

    const startMustMoveFirst =
      target.end < binding.range.start + MIN_CLIP_SECONDS;
    const order = startMustMoveFirst
      ? [
          ["start", target.start],
          ["end", target.end],
        ]
      : [
          ["end", target.end],
          ["start", target.start],
        ];
    moveBoundary(order[0][0], order[0][1]);
    setTimeout(() => {
      syncFromNative();
      moveBoundary(order[1][0], order[1][1]);
      setTimeout(syncFromNative, 50);
    }, 50);
  }

  function nudgeBoundary(kind, delta) {
    if (!binding?.range) return;
    moveBoundary(kind, binding.range[kind] + delta);
  }

  function commitInput(input) {
    const kind = input.dataset.boundaryInput;
    if (!kind || !binding?.range) return;
    const value = parseClock(input.value);
    if (!Number.isFinite(value)) {
      input.classList.add("is-invalid");
      return;
    }
    input.classList.remove("is-invalid");
    moveBoundary(kind, value);
  }

  function onPanelClick(event) {
    const resetButton = event.target.closest("[data-reset-range]");
    if (resetButton) {
      resetBoundaryRange();
      releasePrecisionActionFocus(resetButton);
      return;
    }
    const applyButton = event.target.closest("[data-apply-seeker-to]");
    if (applyButton) {
      const time = getSeekerRelativeTime();
      if (Number.isFinite(time)) {
        moveBoundary(applyButton.dataset.applySeekerTo, time);
      }
      releasePrecisionActionFocus(applyButton);
      return;
    }
    const button = event.target.closest("[data-boundary][data-delta]");
    if (!button) return;
    nudgeBoundary(button.dataset.boundary, Number(button.dataset.delta));
    releasePrecisionActionFocus(button);
  }

  function releasePrecisionActionFocus(control) {
    control?.blur();
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (binding?.panel?.contains(active) ||
          binding?.edges?.includes(active))
      ) {
        active.blur();
      }
    });
  }

  function onPanelKeyDown(event) {
    const input = event.target.closest("[data-boundary-input]");
    if (!input || event.key !== "Enter") return;
    event.preventDefault();
    input.blur();
  }

  function onPanelFocusOut(event) {
    const input = event.target.closest("[data-boundary-input]");
    if (input) commitInput(input);
  }

  function boundaryForEdge(edge) {
    if (!binding) return null;
    const index = binding.edges.indexOf(edge);
    return index === 0 ? "start" : index === 1 ? "end" : null;
  }

  function seekPlaybackBy(delta) {
    const media = getMedia();
    const current = Number(media?.currentTime);
    if (!media || !Number.isFinite(current)) return false;
    let minimum = 0;
    let maximum = Number(media.duration);
    const seekable = media.seekable;
    if (seekable?.length) {
      minimum = seekable.start(0);
      maximum = seekable.end(seekable.length - 1);
    }
    if (!Number.isFinite(maximum)) maximum = current + Math.abs(delta);
    const next = Math.min(maximum, Math.max(minimum, current + delta));
    if (Math.abs(next - current) < EPSILON) return true;
    try {
      media.currentTime = next;
    } catch {
      return false;
    }
    const relative = getSeekerRelativeTime();
    if (Number.isFinite(relative)) {
      binding.currentSeekerTime = Math.min(
        binding.outerDuration,
        Math.max(0, relative + (next - current)),
      );
      const text = formatClock(binding.currentSeekerTime, false);
      binding.seekerTime.textContent = text;
      const panelOutput = binding.panel.querySelector(
        "[data-current-seeker-time]",
      );
      if (panelOutput) panelOutput.textContent = text;
      binding.lastSeekerTimeText = text;
    }
    requestAnimationFrame(syncSeekerTime);
    setTimeout(syncSeekerTime, 60);
    return true;
  }

  function onEditorKeyDown(event) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight"
    ) {
      return;
    }
    const edge = event.target.closest('span[class*="_edge_"]');
    const kind = edge ? boundaryForEdge(edge) : null;
    if (kind) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const amount = event.shiftKey ? 1 : 0.1;
      nudgeBoundary(kind, event.key === "ArrowLeft" ? -amount : amount);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const control = event.target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="slider"]',
    );
    if (control && !binding?.seeker?.contains(control)) return;
    const amount = event.shiftKey ? shiftArrowSeekStep : arrowSeekStep;
    const delta = event.key === "ArrowLeft" ? -amount : amount;
    if (!seekPlaybackBy(delta)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function onTimelineMouseDown(event) {
    if (!event.isTrusted || event.button !== 0) return;
    const edge = event.target.closest('span[class*="_edge_"]');
    const play = event.target.closest('span[class*="_play_"]');
    const seeker = event.target.closest('div[class*="_seeker_"]');
    if (seeker) {
      binding.root.classList.add("is-seeker-dragging");
      const finish = () => {
        binding?.root?.classList.remove("is-seeker-dragging");
        document.removeEventListener("mouseup", finish, true);
        window.removeEventListener("blur", finish);
        syncSeekerTime();
      };
      document.addEventListener("mouseup", finish, {
        capture: true,
        signal: binding.abort.signal,
      });
      window.addEventListener("blur", finish, {
        signal: binding.abort.signal,
      });
      return;
    }
    if (play && !edge) {
      const finish = () => {
        document.removeEventListener("mouseup", finish, true);
        window.removeEventListener("blur", finish);
        setTimeout(syncFromNative, 0);
        requestAnimationFrame(syncSeekerTime);
        setTimeout(syncSeekerTime, 60);
      };

      document.addEventListener("mouseup", finish, {
        capture: true,
        signal: binding.abort.signal,
      });
      window.addEventListener("blur", finish, {
        signal: binding.abort.signal,
      });
      return;
    }

    const kind = edge ? boundaryForEdge(edge) : null;
    if (!kind) return;
    const finish = () => {
      document.removeEventListener("mouseup", finish, true);
      window.removeEventListener("blur", finish);
      setTimeout(syncFromNative, 0);
    };
    document.addEventListener("mouseup", finish, {
      capture: true,
      signal: binding.abort.signal,
    });
    window.addEventListener("blur", finish, {
      signal: binding.abort.signal,
    });
  }

  function isCompactEditorWindow() {
    const width = Number(window.outerWidth);
    const height = Number(window.outerHeight);
    const availableWidth = Number(window.screen?.availWidth);
    if (!(width > 0 && height > 0)) return false;
    if (window.opener) return true;
    if (width > 780) return false;
    return Boolean(
      !Number.isFinite(availableWidth) ||
        width < availableWidth * 0.85,
    );
  }

  function expandEditorWindow(panel) {
    if (
      editorWindowExpansion ||
      !panel?.isConnected ||
      !isCompactEditorWindow()
    ) {
      return;
    }
    const style = getComputedStyle(panel);
    const panelHeight =
      panel.getBoundingClientRect().height +
      (Number.parseFloat(style.marginTop) || 0) +
      (Number.parseFloat(style.marginBottom) || 0);
    const originalHeight = window.outerHeight;
    const originalWidth = window.outerWidth;
    const availableHeight = Number(window.screen?.availHeight);
    const maximumGrowth = Number.isFinite(availableHeight)
      ? Math.max(0, availableHeight - originalHeight)
      : panelHeight;
    const requestedGrowth = Math.ceil(
      Math.min(panelHeight, maximumGrowth),
    );
    if (requestedGrowth < 2) return;

    try {
      window.resizeBy(0, requestedGrowth);
    } catch {
      return;
    }
    const recordAppliedGrowth = () => {
      const appliedGrowth = Math.max(
        0,
        window.outerHeight - originalHeight,
      );
      if (appliedGrowth < 2 || editorWindowExpansion) return false;
      editorWindowExpansion = {
        originalWidth,
        originalHeight,
        expandedHeight: window.outerHeight,
        appliedGrowth,
      };
      return true;
    };
    if (!recordAppliedGrowth() && binding) {
      binding.windowResizeMeasureTimer = window.setTimeout(
        recordAppliedGrowth,
        80,
      );
    }
  }

  function scheduleEditorWindowExpansion(panel) {
    if (!binding || editorWindowExpansion) return;
    binding.windowResizeFrame = requestAnimationFrame(() => {
      binding.windowResizeFrame = requestAnimationFrame(() => {
        binding.windowResizeFrame = 0;
        expandEditorWindow(panel);
      });
    });
  }

  function restoreEditorWindowSize() {
    const state = editorWindowExpansion;
    editorWindowExpansion = null;
    if (!state) return;
    const windowWasNotManuallyResized =
      Math.abs(window.outerWidth - state.originalWidth) <= 2 &&
      Math.abs(window.outerHeight - state.expandedHeight) <= 4;
    if (!windowWasNotManuallyResized) return;
    try {
      window.resizeBy(0, -state.appliedGrowth);
    } catch {}
  }

  function mount(timeline) {
    unmount({ restoreWindow: false });
    const panel = createPanel();
    const labels = createRulerLabels();
    const seekerTime = createSeekerTime();
    const form = timeline.root.parentElement;
    if (!form) return;

    timeline.root.classList.add("cheese-clip-editor-timeline");
    timeline.root.append(labels);
    timeline.seeker.append(seekerTime);
    form.insertAdjacentElement("afterend", panel);

    const abort = new AbortController();
    panel.addEventListener("click", onPanelClick, { signal: abort.signal });
    panel.addEventListener("keydown", onPanelKeyDown, {
      signal: abort.signal,
    });
    panel.addEventListener("focusout", onPanelFocusOut, {
      signal: abort.signal,
    });
    document.addEventListener("keydown", onEditorKeyDown, {
      capture: true,
      signal: abort.signal,
    });
    timeline.root.addEventListener("mousedown", onTimelineMouseDown, {
      capture: true,
      signal: abort.signal,
    });
    document.addEventListener("visibilitychange", onDocumentVisibilityChange, {
      signal: abort.signal,
    });

    timeline.edges.forEach((edge, index) => {
      edge.dataset.cheesePreviousTabindex =
        edge.getAttribute("tabindex") ?? "";
      edge.dataset.cheesePreviousRole = edge.getAttribute("role") ?? "";
      edge.tabIndex = 0;
      edge.setAttribute("role", "slider");
      edge.setAttribute(
        "aria-label",
        index === 0 ? "클립 시작 시각" : "클립 종료 시각",
      );
    });

    const rangeObserver = new MutationObserver(scheduleNativeSync);
    rangeObserver.observe(timeline.rangeText, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const resizeObserver = new ResizeObserver(() => {
      // 시각 텍스트가 그대로여도 폭이 바뀌면 시커 라벨의 가장자리 판정이 달라진다.
      // syncSeekerTime 은 텍스트가 바뀔 때만 측정하므로 여기서 한 번 강제한다.
      if (binding) binding.lastSeekerTimeText = "";
      syncSeekerTime();
    });
    resizeObserver.observe(timeline.root);

    binding = {
      ...timeline,
      panel,
      labels,
      seekerTime,
      abort,
      rangeObserver,
      resizeObserver,
      playbackTimer: 0,
      nativeSyncFrame: 0,
      windowResizeFrame: 0,
      windowResizeMeasureTimer: 0,
      rulerSignature: "",
      lastSeekerTimeText: "",
      currentSeekerTime: 0,
      range: null,
      initialRange: null,
      outerDuration: 0,
      playerBase: null,
    };
    getMedia();
    startPlaybackTimer();
    syncFromNative();
    scheduleEditorWindowExpansion(panel);
  }

  function restoreEdgeAttributes(edge) {
    const previousTabindex = edge.dataset.cheesePreviousTabindex;
    const previousRole = edge.dataset.cheesePreviousRole;
    if (previousTabindex) edge.setAttribute("tabindex", previousTabindex);
    else edge.removeAttribute("tabindex");
    if (previousRole) edge.setAttribute("role", previousRole);
    else edge.removeAttribute("role");
    edge.removeAttribute("aria-label");
    edge.removeAttribute("aria-valuemin");
    edge.removeAttribute("aria-valuemax");
    edge.removeAttribute("aria-valuenow");
    edge.removeAttribute("aria-valuetext");
    delete edge.dataset.cheesePreviousTabindex;
    delete edge.dataset.cheesePreviousRole;
  }

  function unmount({ restoreWindow = true } = {}) {
    if (!binding) {
      if (restoreWindow) restoreEditorWindowSize();
      return;
    }
    binding.abort.abort();
    binding.rangeObserver.disconnect();
    binding.resizeObserver.disconnect();
    stopPlaybackTimer();
    if (binding.nativeSyncFrame) {
      cancelAnimationFrame(binding.nativeSyncFrame);
    }
    if (binding.windowResizeFrame) {
      cancelAnimationFrame(binding.windowResizeFrame);
    }
    clearTimeout(binding.windowResizeMeasureTimer);
    binding.root.classList.remove(
      "cheese-clip-editor-timeline",
      "is-seeker-dragging",
    );
    binding.edges.forEach(restoreEdgeAttributes);
    binding.labels.remove();
    binding.seekerTime.remove();
    binding.panel.remove();
    binding = null;
    mediaElement = null;
    if (restoreWindow) restoreEditorWindowSize();
  }

  startFlagRequests();
})();
