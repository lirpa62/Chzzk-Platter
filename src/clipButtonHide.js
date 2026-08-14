// 치즈 서치 - 클립 라이브 버튼 숨김 (MAIN world, document_start)
// 치지직 클립(/clips) 페이지의 "클릭하여 라이브 시청" 플로팅 버튼을 숨기고,
// 이전/다음 네비게이션 버튼은 호버했을 때만 보이게 한다(시청 몰입 방해 최소화).
// 버튼이 그려지기 전에 숨겨 깜빡임을 막으려고 document_start + MAIN world로 주입한다.
(async function () {
  "use strict";

  try {
    const data = await chrome.storage.local.get("cheeseMasterEnabled");
    if (data?.cheeseMasterEnabled === false) return;
  } catch {}

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
        applyClipHideFlag(
          v && typeof v === "object" ? v.clipLiveButton : undefined,
        );
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
        applyClipHideFlag(
          v && typeof v === "object" ? v.clipLiveButton : undefined,
        );
      }
    });
  } catch {}

  const CLIPS_ORIGIN = "https://chzzk.naver.com";
  const CLIPS_BASE_PATH = "/clips";
  const CLIP_EDITOR_PATH = "/clip-editor";

  const LIVE_WRAP_SELECTOR = 'div[class*="FloatingButtonView-module__wrap__"]';
  const LIVE_LINK_SELECTOR = 'a[class*="FloatingButtonView-module__link__"]';
  const CONTROL_WRAP_SELECTOR =
    'div[class*="ControlAreaView-module__touch_wrap__"]';

  const NAV_BUTTON_SELECTOR = [
    'button[class*="NavigationLayerView-module__btn_prev__"]',
    'button[class*="NavigationLayerView-module__btn_next__"]',
  ].join(", ");
  const NAV_BOX_SELECTOR =
    'div[class*="NavigationLayerView-module__nav_box__"]';
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

  // 클립 만들기(클립 에디터)인지. 이 페이지는 우리가 숨길 대상(라이브 시청 버튼·클립
  // 네비게이션)이 아예 없는데, 클립 목록에서 열면 document.referrer 가 /clips 라
  // isClipsContext() 가 true 로 잡혔다. 그러면 seeker 가 매 프레임 class 를 바꿀 때마다
  // applyUiState() 의 전체 문서 querySelectorAll 이 돌아 영상이 무한 버퍼링처럼 멈춘다.
  function isClipEditorUrl(url) {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      return (
        parsed.origin === CLIPS_ORIGIN &&
        parsed.pathname.startsWith(CLIP_EDITOR_PATH)
      );
    } catch {
      return false;
    }
  }

  function isClipEditorContext() {
    if (isClipEditorUrl(window.location.href)) return true;

    try {
      return isClipEditorUrl(window.top.location.href);
    } catch {
      // 교차 출처 접근 오류는 무시한다.
    }

    return false;
  }

  function isClipsContext() {
    // 클립 에디터에서는 referrer 가 /clips 여도 개입하지 않는다.
    if (isClipEditorContext()) return false;

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

  // ── 새 탭 클립 자동재생(부모 요청) ─────────────────────────────────────────
  // 치지직 /clips 의 플레이어는 m.naver.com/shorts iframe(교차 출처) 안에 있어서,
  // 부모(chzzk) 문서에서는 video 를 만질 수 없다. 부모가 postMessage 로 요청을 보내면
  // 이 프레임에서 재생을 시도한다. 이 스크립트는 shorts 프레임에도 주입된다.
  const AUTOPLAY_MESSAGE = "cheese-clip-page-autoplay";
  const AUTOPLAY_TIMEOUT_MS = 20000;
  let autoplayRequested = false;
  let autoplayDone = false;
  let autoplayDeadline = 0;
  let autoplayTimer = 0;
  let autoplayPending = false;
  let autoplayUnmuteButton = null;
  let autoUnmuteTimers = []; // 소리 복구 재시도 타이머(아래 recovery 함수들이 사용)

  function stopClipAutoplay() {
    if (autoplayTimer) clearTimeout(autoplayTimer);
    autoplayTimer = 0;
    clearClipAutoUnmuteRecovery(); // 소리 복구 재시도 타이머도 함께 정리
    autoplayUnmuteButton?.remove();
    autoplayUnmuteButton = null;
  }

  function showClipAutoplayUnmuteButton(video) {
    if (
      !(video instanceof HTMLVideoElement) ||
      !video.muted ||
      autoplayUnmuteButton?.isConnected
    ) {
      return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "클립 소리 켜기");
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17"
        viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4z"></path>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
      </svg>
      <span>소리 켜기</span>`;
    button.style.cssText = [
      "position:fixed",
      "top:12px",
      "right:12px",
      "z-index:2147483647",
      "height:34px",
      "padding:0 12px",
      "border:1px solid rgba(255,255,255,.3)",
      "border-radius:6px",
      "background:rgba(20,20,20,.86)",
      "box-shadow:0 2px 8px rgba(0,0,0,.28)",
      "color:#fff",
      "font:600 13px/1 system-ui,sans-serif",
      "display:inline-flex",
      "align-items:center",
      "gap:6px",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", () => {
      video.muted = false;
      video.defaultMuted = false;
      if (video.volume <= 0) video.volume = 0.5;
      try {
        const result = video.play();
        Promise.resolve(result).then(
          () => {
            window.setTimeout(() => {
              if (video.paused || video.muted) {
                video.muted = true;
                video.defaultMuted = true;
                return;
              }
              autoplayDone = true;
              notifyClipAutoplayResult(false);
              button.remove();
              if (autoplayUnmuteButton === button) {
                autoplayUnmuteButton = null;
              }
            }, 120);
          },
          () => {
            video.muted = true;
            video.defaultMuted = true;
          },
        );
      } catch {
        video.muted = true;
        video.defaultMuted = true;
      }
    });
    autoplayUnmuteButton = button;
    (document.body || document.documentElement).appendChild(button);
  }

  function notifyClipAutoplayResult(muted) {
    try {
      window.parent?.postMessage(
        {
          source: AUTOPLAY_MESSAGE,
          event: "playing",
          muted: muted === true,
        },
        "https://chzzk.naver.com",
      );
    } catch {}
  }

  function scheduleClipAutoplayRetry(delay = 300) {
    if (
      autoplayTimer ||
      autoplayPending ||
      autoplayDone ||
      !autoplayRequested ||
      Date.now() > autoplayDeadline
    ) {
      return;
    }
    autoplayTimer = window.setTimeout(tryClipAutoplay, delay);
  }

  function playClipMuted(video) {
    video.muted = true;
    video.defaultMuted = true;
    let result;
    try {
      result = video.play();
    } catch {
      autoplayPending = false;
      scheduleClipAutoplayRetry();
      return;
    }
    Promise.resolve(result).then(
      () => {
        autoplayPending = false;
        autoplayDone = true;
        notifyClipAutoplayResult(true);
        showClipAutoplayUnmuteButton(video);
        // 음소거로 붙은 뒤 소리를 되살릴 수 있는지 몇 번 더 시도한다. 첫 unmuted
        // play() 는 프레임이 막 뜬 시점이라 거부되지만, 재생이 안정된 뒤에는 통과하는
        // 경우가 있다(사이트 소리 허용 설정 등). 통합검색 인라인에서 같은 방식으로
        // 해결됐다. 실패해도 '소리 켜기' 버튼이 남아 사용자가 켤 수 있다.
        scheduleClipAutoUnmuteRecovery(video);
      },
      () => {
        autoplayPending = false;
        scheduleClipAutoplayRetry();
      },
    );
  }

  // 음소거 재생 뒤 소리 복구 재시도(성공하면 즉시 중단하고 버튼도 치운다).
  function clearClipAutoUnmuteRecovery() {
    autoUnmuteTimers.forEach(clearTimeout);
    autoUnmuteTimers = [];
  }
  function scheduleClipAutoUnmuteRecovery(video) {
    clearClipAutoUnmuteRecovery();
    [150, 400, 900, 1800].forEach((delay) => {
      autoUnmuteTimers.push(
        window.setTimeout(() => {
          if (!(video instanceof HTMLVideoElement) || !video.isConnected)
            return;
          if (!video.muted || video.paused) return;
          // ⚠ 사용자 제스처 없이 음소거를 풀면 크롬은 실패로 끝내지 않고 '재생을
          // 일시정지'시킨다("Unmuting failed and the element was paused instead").
          // 그러면 자동재생 자체가 멈춰 더 나빠지므로, 이 문서에 실제 활성화가 있을
          // 때만 시도한다. 없으면 '소리 켜기' 버튼에 맡긴다(버튼 클릭은 진짜 제스처).
          if (navigator.userActivation?.hasBeenActive !== true) return;
          video.muted = false;
          video.defaultMuted = false;
          if (video.volume <= 0) video.volume = 0.5;
          window.setTimeout(() => {
            // 음소거 해제 때문에 멈췄으면 즉시 원복해 재생을 되살린다.
            if (video.paused) {
              video.muted = true;
              video.defaultMuted = true;
              try {
                video.play()?.catch?.(() => {});
              } catch {}
              return;
            }
            if (video.muted) return; // 플레이어가 되돌림 → 다음 회차에서 재시도
            clearClipAutoUnmuteRecovery();
            autoplayUnmuteButton?.remove();
            autoplayUnmuteButton = null;
          }, 120);
        }, delay),
      );
    });
  }

  function tryClipAutoplay() {
    autoplayTimer = 0;
    if (autoplayDone || autoplayPending || !autoplayRequested) return;
    if (Date.now() > autoplayDeadline) {
      autoplayRequested = false;
      return;
    }
    const video = document.querySelector("video");
    if (video instanceof HTMLVideoElement) {
      if (!video.paused && !video.muted) {
        autoplayDone = true;
        notifyClipAutoplayResult(false);
        return;
      }
      // 새 탭 플레이어는 초기 muted 상태일 수 있다. 네이티브 /clips 내부 클릭과
      // 동일하게 먼저 소리 있는 재생을 명시적으로 시도하고, 정책상 거부될 때만
      // 음소거로 폴백한다.
      autoplayPending = true;
      // ⚠ 이미 재생 중인 요소의 음소거를 제스처 없이 풀면 크롬이 '일시정지'시킨다.
      // 아직 멈춰 있을 때(=play 전)는 그 규칙이 적용되지 않고 play() 가 거부될 뿐이라
      // 안전하다. 재생 중이라면 건드리지 말고 복구 경로에 맡긴다.
      if (video.paused) {
        video.muted = false;
        video.defaultMuted = false;
      }
      try {
        Promise.resolve(video.play()).then(
          () => {
            window.setTimeout(() => {
              autoplayPending = false;
              if (!video.paused && !video.muted) {
                autoplayDone = true;
                notifyClipAutoplayResult(false);
                return;
              }
              // 재생은 붙었는데 플레이어가 음소거로 되돌린 경우: 여기서 곧바로
              // playClipMuted 로 확정하면 소리가 영영 안 켜진다(autoplayDone 고정).
              // 재생 중이면 복구 재시도에 맡긴다.
              if (!video.paused) {
                autoplayDone = true;
                notifyClipAutoplayResult(true);
                showClipAutoplayUnmuteButton(video);
                scheduleClipAutoUnmuteRecovery(video);
                return;
              }
              playClipMuted(video);
            }, 120);
          },
          () => {
            playClipMuted(video);
          },
        );
      } catch {
        playClipMuted(video);
      }
      return;
    }
    scheduleClipAutoplayRetry();
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      event.data?.source !== AUTOPLAY_MESSAGE
    ) {
      return;
    }
    try {
      if (new URL(event.origin).hostname !== "chzzk.naver.com") return;
    } catch {
      return;
    }
    if (autoplayDone) return;
    // 부모는 재시도마다 다시 보낸다 — 이미 진행 중이면 중복 시작하지 않는다.
    autoplayDeadline = Date.now() + AUTOPLAY_TIMEOUT_MS;
    if (autoplayRequested) return;
    autoplayRequested = true;
    tryClipAutoplay();
  });
  window.addEventListener("pagehide", stopClipAutoplay, { once: true });

  const observer = new MutationObserver(onMutations);
  let observing = false;

  // 클립 에디터에서는 옵저버 자체를 뗀다. onMutations 안에서 걸러도 seeker 가 매 프레임
  // 만드는 class 변이가 전부 콜백까지 올라와(문서 전체 subtree) 재생이 끊겼다.
  const syncObserver = () => {
    if (!document.documentElement) return;

    const want = !isClipEditorContext();
    if (want === observing) return;

    if (want) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-hidden", "class"],
      });
    } else {
      observer.disconnect();
    }
    observing = want;
  };

  if (document.documentElement) {
    syncObserver();
  } else {
    document.addEventListener("DOMContentLoaded", syncObserver, { once: true });
  }

  // SPA 라우팅으로 클립 에디터에 들어가거나 빠져나올 때 옵저버를 붙였다 뗀다.
  // history API 는 popstate 를 쏘지 않으므로 pushState/replaceState 도 감싼다.
  const onUrlChange = () => {
    syncObserver();
    applyUiState();
  };

  // ── 클립 재생 화면의 즐겨찾기 버튼 ─────────────────────────────────────────
  // 좋아요 버튼 바로 위에 같은 모양으로 넣는다. 스타일은 치지직 것을 harvest 한다
  // (클래스가 해시가 아니라 webpack 모듈명이라 접두어 매칭이 안정적이다).
  //
  // ⚠ uid 를 이 프레임에서는 알 수 없다(실측: 카드 DOM 에 uid 없음, video 는 blob,
  // 썸네일은 날짜 파일명). 대신 상위 페이지 URL 이 /clips/<uid> 로 바뀌므로, 상위
  // (content.js)에서 uid·메타를 postMessage 로 받아 쓴다. 그래서 버튼은 '지금 보고
  // 있는 클립' 하나에만 단다 — 여러 카드에 달면 어느 uid 인지 모호해진다.
  // 보관함 기능 on/off. 즐겨찾기 버튼과 좋아요 수집이 함께 쓴다.
  // ⚠ 선언을 사용처보다 앞에 둔다 — let 은 호이스팅되지 않아 순서가 뒤바뀌면 TDZ 다.
  let clipVaultOn = false;

  const CLIP_FAV_BTN_CLASS = "cheese-clip-fav-btn";
  const CLIP_FAV_MSG = "cheese-clip-fav";
  const CLIP_FRAME_ACTIVITY_MSG = "cheese-platter-clip-frame-activity";
  const CLIP_VAULT_ACCOUNT_KEY_PREFIX = "cheeseClipVault:";
  let clipFavCurrent = null; // { uid, title, thumb, channelName, isFav }
  let clipVaultAccountId = "";

  function normalizeClipVaultAccountId(value) {
    const id = String(value || "").trim().toLowerCase();
    return /^[0-9a-f]{32}$/.test(id) ? id : "";
  }

  function clipVaultAccountStorageKey(accountId = clipVaultAccountId) {
    const normalized = normalizeClipVaultAccountId(accountId);
    return normalized ? `${CLIP_VAULT_ACCOUNT_KEY_PREFIX}${normalized}` : "";
  }

  function clipFavStarSvg(filled) {
    return (
      '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" ' +
      'fill="' +
      (filled ? "currentColor" : "none") +
      '" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 ' +
      "1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 " +
      "1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 " +
      "0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879" +
      'L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>' +
      "</svg>"
    );
  }

  // 화면 중앙에 걸린 카드가 '지금 보는 클립'이다.
  function currentClipCard() {
    const cards = [
      ...document.querySelectorAll('[data-testid="ContentCardPlayer"]'),
    ];
    const mid = window.innerHeight / 2;
    return (
      cards.find((c) => {
        const r = c.getBoundingClientRect();
        return r.top <= mid && r.bottom >= mid;
      }) || null
    );
  }

  function ensureClipFavButton() {
    if (!clipVaultOn || !clipFavCurrent || !clipVaultAccountId) {
      document
        .querySelectorAll(`.${CLIP_FAV_BTN_CLASS}`)
        .forEach((b) => b.remove());
      return;
    }
    const card = currentClipCard();
    if (!card) return;
    const like = card.querySelector('[class*="type_like"]');
    const likeBox = like?.parentElement;
    if (!likeBox || !likeBox.parentElement) return;

    let slot = likeBox.parentElement.querySelector(
      `.${CLIP_FAV_BTN_CLASS}-slot`,
    );
    if (!slot) {
      // 다른 카드에 남아 있던 버튼은 정리(중앙 카드에만 둔다).
      document
        .querySelectorAll(`.${CLIP_FAV_BTN_CLASS}-slot`)
        .forEach((n) => n.remove());
      slot = document.createElement("div");
      slot.className = `${likeBox.className} ${CLIP_FAV_BTN_CLASS}-slot`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${like.className.replace(/\S*type_like\S*/g, "").trim()} ${CLIP_FAV_BTN_CLASS}`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!clipFavCurrent) return;
        const next = !clipFavCurrent.isFav;
        clipFavCurrent.isFav = next;
        paintClipFavButton();
        // 실제 저장은 상위(content.js)가 한다(uid 를 그쪽만 안다). 채널명·채널ID·재생수는
        // 이 프레임에만 있으므로 함께 보낸다(상위 og 메타에는 제목·썸네일뿐).
        try {
          window.parent.postMessage(
            {
              type: CLIP_FAV_MSG,
              action: next ? "add" : "remove",
              accountId: clipVaultAccountId,
              ...readClipFrameMeta(),
            },
            "https://chzzk.naver.com",
          );
        } catch {}
      });
      slot.appendChild(btn);
      likeBox.parentElement.insertBefore(slot, likeBox);
    }
    paintClipFavButton();
  }

  // 재생 화면에서 얻을 수 있는 메타. 클래스는 webpack 모듈명이라 접두어로 매칭한다.
  //   채널명  strong[class*="ProfileView-module__name"]
  //   채널ID  a[class*="ProfileView-module__channel"] href=.../<32hex>
  //   재생수  span[class*="DescriptionAreaView-module__sub"] 중 '재생수' 로 시작하는 것
  function readClipFrameMeta() {
    const card = currentClipCard() || document;
    const name = card
      .querySelector('strong[class*="ProfileView-module__name"]')
      ?.textContent?.trim();
    const href =
      card
        .querySelector('a[class*="ProfileView-module__channel"]')
        ?.getAttribute("href") || "";
    const channelId = (href.match(/([0-9a-f]{32})/i) || [])[1] || "";
    let playCount = "";
    card
      .querySelectorAll('span[class*="DescriptionAreaView-module__sub"]')
      .forEach((el) => {
        const t = (el.textContent || "").trim();
        // "재생수 76" → 숫자·단위만 남긴다("1.4만" 같은 축약도 그대로 보존).
        if (!playCount && /^재생\s*수/.test(t)) {
          playCount = t.replace(/^재생\s*수\s*/, "");
        }
      });
    const likeRoot = card.querySelector('[class*="type_like"]')?.parentElement;
    const likeCount = String(likeRoot?.textContent || "")
      .replace(/좋아요/gi, "")
      .trim()
      .slice(0, 20);
    const now = Date.now();
    return {
      channelName: (name || "").slice(0, 100),
      channelId,
      playCount: playCount.slice(0, 20),
      playCountFetchedAt: playCount ? now : 0,
      likeCount,
      likeCountFetchedAt: likeCount ? now : 0,
    };
  }

  function paintClipFavButton() {
    const btn = document.querySelector(`.${CLIP_FAV_BTN_CLASS}`);
    if (!btn || !clipFavCurrent) return;
    const on = clipFavCurrent.isFav === true;
    if (btn.dataset.on === String(on)) return; // 멱등(노드 교체로 클릭 유실 방지)
    btn.dataset.on = String(on);
    btn.setAttribute("aria-label", on ? "즐겨찾기 해제" : "즐겨찾기");
    btn.title = on ? "즐겨찾기 해제" : "즐겨찾기";
    btn.style.color = on ? "#ffcc33" : "";
    btn.innerHTML = clipFavStarSvg(on);
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== "https://chzzk.naver.com") return;
    const d = e.data;
    if (!d) return;
    if (d.source === CLIP_FRAME_ACTIVITY_MSG) {
      clipVaultAccountId = normalizeClipVaultAccountId(d.accountId);
      ensureClipFavButton();
      return;
    }
    if (d.type === `${CLIP_FAV_MSG}-state`) {
      clipFavCurrent = d.clip || null;
      clipVaultAccountId = normalizeClipVaultAccountId(
        d.accountId || d.clip?.accountId,
      );
      ensureClipFavButton();
    }
  });

  setInterval(ensureClipFavButton, 700);

  // ── 좋아요한 클립 수집 ─────────────────────────────────────────────────────
  // 치지직에는 '내가 좋아요한 클립 목록' API 가 없다. 그래서 좋아요하는 순간을 잡아
  // 우리가 직접 모은다.
  //
  // ⚠ 좋아요는 fetch/XHR 이 아니라 JSONP 로 나간다(실측). 즉 <script> 태그가 삽입되고
  // URL 에 _method=POST(설정) / DELETE(해제) 가 실려 있다. 그래서 네트워크 후킹 대신
  // '스크립트 태그 삽입'을 감시한다 — 격리 월드에서도 잡힌다(실측 확인).
  //
  //   .../like/v1/services/CHZZK/contents/clip_<uid>?...&_method=POST&callback=...
  //
  // 버튼 클릭 감지(A-2)는 쓰지 않는다. 실측에서 좋아요 버튼에 aria-label·클래스로
  // 식별할 단서가 없었고, 요청 감지만으로 '실제로 반영된 좋아요'를 정확히 잡을 수 있다.
  const CLIP_VAULT_LIMIT_KEY = "cheeseClipVaultLimit";
  const FEATURE_KEY = "cheeseFeatureHidden";
  const LIKE_RE =
    /\/like\/v1\/services\/CHZZK\/contents\/clip_([^/?#&]+)[^]*?_method=(POST|DELETE)/i;

  try {
    chrome.storage?.local?.get(FEATURE_KEY, (d) => {
      clipVaultOn = d?.[FEATURE_KEY]?.clipVault === true;
    });
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local" || !changes[FEATURE_KEY]) return;
      clipVaultOn = changes[FEATURE_KEY].newValue?.clipVault === true;
    });
  } catch {}

  // 클립 메타(제목·썸네일·채널)는 이 프레임에서 얻기 어렵다. uid 와 시각만 남기고,
  // 목록을 그릴 때 content.js 가 부족한 필드를 보강한다.
  function recordClipLike(uid, remove) {
    const accountId = clipVaultAccountId;
    const accountKey = clipVaultAccountStorageKey(accountId);
    if (!uid || !accountKey) return;
    try {
      chrome.storage?.local?.get(
        [accountKey, CLIP_VAULT_LIMIT_KEY],
        (data) => {
          const vault = data?.[accountKey] || {};
          const list = Array.isArray(vault.like) ? vault.like : [];
          const next = list.filter((it) => it && it.uid !== uid);
          if (!remove) {
            next.unshift({ uid, ...readClipFrameMeta(), at: Date.now() });
            const rawLimit = Number(data?.[CLIP_VAULT_LIMIT_KEY]);
            const limit = Number.isFinite(rawLimit) ? rawLimit : 500;
            if (next.length > limit) next.length = limit;
          }
          if (next.length === list.length && !remove) return; // 이미 있음
          chrome.storage.local.set({
            [accountKey]: { ...vault, like: next },
          });
        },
      );
    } catch {}
  }

  function inspectLikeScript(node) {
    if (!clipVaultOn || !clipVaultAccountId) return;
    if (!node || node.tagName !== "SCRIPT") return;
    const m = LIKE_RE.exec(String(node.src || ""));
    if (!m) return;
    recordClipLike(m[1], m[2].toUpperCase() === "DELETE");
  }

  new MutationObserver((muts) => {
    for (const mut of muts) {
      mut.addedNodes.forEach(inspectLikeScript);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("popstate", onUrlChange);

  try {
    const wrapHistory = (name) => {
      const original = history[name];
      if (typeof original !== "function") return;
      history[name] = function (...args) {
        const result = original.apply(this, args);
        try {
          onUrlChange();
        } catch {}
        return result;
      };
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
  } catch {}
})();
