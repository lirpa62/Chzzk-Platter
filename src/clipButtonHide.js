// 치즈 서치 - 클립 라이브 버튼 숨김 (MAIN world, document_start)
// 치지직 클립(/clips) 페이지의 "클릭하여 라이브 시청" 플로팅 버튼을 숨기고,
// 이전/다음 네비게이션 버튼은 호버했을 때만 보이게 한다(시청 몰입 방해 최소화).
// 버튼이 그려지기 전에 숨겨 깜빡임을 막으려고 document_start + MAIN world로 주입한다.
(function () {
  "use strict";

  if (window.__cheeseClipButtonHideLoaded) return;
  window.__cheeseClipButtonHideLoaded = true;

  // 팝업 설정 토글. 기본 true(=숨김). 이 스크립트는 격리 월드라 chrome.storage를
  // 직접 읽는다(버튼이 m.naver.com/shorts iframe 안에 있어 content.js의 postMessage
  // 브리지로는 전달되지 않으므로 storage를 직접 구독해야 한다).
  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  let clipHideEnabled = true;

  function loadClipHideFlag() {
    try {
      chrome.storage?.local?.get(FEATURE_HIDDEN_KEY, (data) => {
        const v = data?.[FEATURE_HIDDEN_KEY];
        applyClipHideFlag(v && typeof v === "object" ? v.clipLiveButton : undefined);
      });
    } catch {
      // 접근 실패 시 기본(숨김) 유지.
    }
  }

  function applyClipHideFlag(value) {
    const next = value !== false; // 미지정/true = 숨김 on
    const changed = next !== clipHideEnabled;
    clipHideEnabled = next;
    if (clipHideEnabled) applyUiState();
    else if (changed) restoreAllClipUi();
  }

  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes[FEATURE_HIDDEN_KEY]) {
        const v = changes[FEATURE_HIDDEN_KEY].newValue;
        applyClipHideFlag(v && typeof v === "object" ? v.clipLiveButton : undefined);
      }
    });
  } catch {}

  const CLIPS_ORIGIN = "https://chzzk.naver.com";
  const CLIPS_BASE_PATH = "/clips";

  const LIVE_WRAP_SELECTOR = 'div[class*="FloatingButtonView-module__wrap__"]';
  const LIVE_LINK_SELECTOR = 'a[class*="FloatingButtonView-module__link__"]';
  const CONTROL_WRAP_SELECTOR =
    'div[class*="ControlAreaView-module__touch_wrap__"]';

  const NAV_BUTTON_SELECTOR = [
    'button[class*="NavigationLayerView-module__btn_prev__"]',
    'button[class*="NavigationLayerView-module__btn_next__"]',
  ].join(", ");
  const NAV_BOX_SELECTOR = 'div[class*="NavigationLayerView-module__nav_box__"]';
  const HOVER_ZONE_SELECTOR = [
    CONTROL_WRAP_SELECTOR,
    NAV_BOX_SELECTOR,
    NAV_BUTTON_SELECTOR,
  ].join(", ");

  let shouldShowControls = false;

  function isClipsUrl(url) {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      return (
        parsed.origin === CLIPS_ORIGIN &&
        (parsed.pathname === CLIPS_BASE_PATH ||
          parsed.pathname.startsWith(`${CLIPS_BASE_PATH}/`))
      );
    } catch {
      return false;
    }
  }

  function isClipsContext() {
    if (isClipsUrl(window.location.href)) return true;

    try {
      return isClipsUrl(window.top.location.href);
    } catch {
      // 교차 출처 접근 오류는 무시한다.
    }

    return isClipsUrl(document.referrer);
  }

  function hideElement(el) {
    if (!el) return;

    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
  }

  function showElement(el) {
    if (!el) return;

    el.style.removeProperty("display");
    el.style.removeProperty("visibility");
    el.style.removeProperty("pointer-events");
  }

  function isTargetLiveLink(link) {
    if (!link) return false;
    if (!link.matches(LIVE_LINK_SELECTOR)) return false;
    if (!link.href.includes("/live/")) return false;

    return (link.textContent || "").includes("클릭하여 라이브 시청");
  }

  function findLiveTargets(root = document) {
    const targets = [];

    const wrappers = root.querySelectorAll(LIVE_WRAP_SELECTOR);
    wrappers.forEach((wrap) => {
      const link = wrap.querySelector('a[href*="/live/"]');
      if (!isTargetLiveLink(link)) return;
      targets.push({ wrap, link });
    });

    const links = root.querySelectorAll('a[href*="/live/"]');
    links.forEach((link) => {
      if (!isTargetLiveLink(link)) return;
      if (link.closest(LIVE_WRAP_SELECTOR)) return;
      targets.push({ wrap: null, link });
    });

    return targets;
  }

  function updateLiveButtonVisibility(root = document) {
    const targets = findLiveTargets(root);

    targets.forEach(({ wrap, link }) => {
      const target = wrap || link;
      hideElement(target);
    });
  }

  function updateNavigationVisibility(root = document) {
    const navBoxes = root.querySelectorAll(NAV_BOX_SELECTOR);
    const navButtons = root.querySelectorAll(NAV_BUTTON_SELECTOR);

    if (shouldShowControls) {
      navBoxes.forEach(showElement);
      navButtons.forEach((button) => {
        const hiddenByAria = button.getAttribute("aria-hidden") === "true";
        if (hiddenByAria) {
          hideElement(button);
        } else {
          showElement(button);
        }
      });
      return;
    }

    navButtons.forEach(hideElement);
    navBoxes.forEach(hideElement);
  }

  function applyUiState(root = document) {
    if (!clipHideEnabled) return; // 토글 off면 아무것도 숨기지 않는다.
    if (!isClipsContext()) return;

    updateNavigationVisibility(root);
    updateLiveButtonVisibility(root);
  }

  // 토글 off 전환 시 우리가 숨긴 요소들만 원래대로 되돌린다.
  function restoreAllClipUi() {
    document
      .querySelectorAll(
        [
          LIVE_WRAP_SELECTOR,
          LIVE_LINK_SELECTOR,
          NAV_BOX_SELECTOR,
          NAV_BUTTON_SELECTOR,
        ].join(","),
      )
      .forEach(showElement);
  }

  function isInHoverZone(node) {
    if (!(node instanceof Node)) return false;

    const el = node instanceof Element ? node : node.parentElement || null;
    if (!el) return false;

    return Boolean(el.closest(HOVER_ZONE_SELECTOR));
  }

  function onMouseOver(event) {
    if (!isClipsContext()) return;
    if (!(event.target instanceof Element)) return;
    if (!isInHoverZone(event.target)) return;

    if (shouldShowControls) return;

    shouldShowControls = true;
    applyUiState();
  }

  function onMouseOut(event) {
    if (!isClipsContext()) return;
    if (!isInHoverZone(event.target)) return;
    if (isInHoverZone(event.relatedTarget)) return;

    if (!shouldShowControls) return;

    shouldShowControls = false;
    applyUiState();
  }

  function onMutations(mutations) {
    if (!isClipsContext()) return;

    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        applyUiState();
        break;
      }

      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        applyUiState();
        break;
      }
    }
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);

  window.addEventListener("blur", () => {
    if (!shouldShowControls) return;

    shouldShowControls = false;
    applyUiState();
  });

  applyUiState();
  loadClipHideFlag();

  const observer = new MutationObserver(onMutations);
  const startObserver = () => {
    if (!document.documentElement) return;

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "class"],
    });
  };

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  }
})();
