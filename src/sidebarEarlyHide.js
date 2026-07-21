// document_start 조기 실행(ISOLATED). 저장된 설정(cheeseFeatureHidden)을 즉시 읽어
// '사이드바 숨김' 핵심 CSS 를 최대한 일찍 <style> 로 주입한다. content.js 는 document_idle
// 에 도는데(약 0.5~0.8s 지연), 그 사이 사이드바가 먼저 렌더되면 숨겨야 할 메뉴·섹션·원본
// 팔로우 목록이 잠깐 보였다 사라지는 깜빡임이 났다. 이 스크립트가 그 지연 구간을 메운다.
// content.js 가 나중에 완전한 규칙으로 같은 <style> id 를 덮으므로 충돌하지 않는다.
(() => {
  "use strict";
  // content.js 의 SIDEBAR_HIDE_STYLE_ID 와 동일해야 나중에 자연스럽게 대체된다.
  const STYLE_ID = "cheese-sidebar-hide-style";
  const FEATURE_KEY = "cheeseFeatureHidden";
  // content.js featureFlags 기본값과 의미 일치(true=숨김). 조기 단계라 '명시적으로 숨김
  // (true)'인 것만 처리하고, 기본 표시 항목은 건드리지 않는다.
  const MENU_HREFS = {
    "/lives": "sbLives",
    "/clips": "sbClips",
    "/category": "sbCategory",
    "/schedule": "sbSchedule",
    "/following": "sbFollowing",
    "/cheezefarm": "sbCheezefarm",
    "/partner": "sbPartner",
  };

  function buildRules(f) {
    const rules = [];
    if (!f || typeof f !== "object") return rules;
    // 0) 라벨 기반 섹션 숨김 마커(cheese-sb-hide)의 display:none 규칙. 이 규칙은 content.js
    //    가 늦게 주입하므로, 조기 옵저버가 붙인 클래스가 바로 먹도록 여기서 함께 넣는다.
    rules.push(`aside#sidebar .cheese-sb-hide{display:none!important}`);
    // 1) 사이드바 전체 숨김.
    if (f.sidebar === true) {
      rules.push(
        `aside#sidebar{display:none!important}div#layout-body{padding-left:0!important;padding-right:0!important}`,
        `header#header button[aria-controls="navigation"]{display:none!important}`,
      );
      return rules; // 전체 숨김이면 세부 규칙 불필요.
    }
    // 2) 메뉴 항목 숨김(href 기반). :has 로 즉시 가려 깜빡임 없음. 파트너 등은 li 가 아니라
    //    nav 섹션일 수 있어, li·nav 조상을 모두 대상으로 한다(구조와 무관하게 숨김).
    const sel = [];
    Object.entries(MENU_HREFS)
      .filter(([, flag]) => f[flag] === true)
      .forEach(([href]) => {
        sel.push(`aside#sidebar li:has(> a[href="${href}"])`);
        sel.push(`aside#sidebar nav:has(> a[href="${href}"])`);
        sel.push(`aside#sidebar nav[class*="_section_"]:has(a[href="${href}"])`);
      });
    if (sel.length) rules.push(`${sel.join(",")}{display:none!important}`);
    // 3) 전용 팔로잉 목록 ON 이면 원본 팔로우 목록(ul)/더보기를 즉시 숨김.
    //    (content.js 의 html.cheese-cf-on 규칙과 동일 효과를, 클래스 없이 nav 범위로.)
    if (f.sbFollowCustom === true) {
      rules.push(
        `#sidebar nav:has(#cheese-custom-follow) ul[class*="_list_"]:not(.cheese-cf-list){display:none!important}`,
      );
    }
    return rules;
  }

  function inject(css) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.dataset.cheeseEarly = "1"; // content.js 가 덮기 전 임시본 표시
      (document.head || document.documentElement).appendChild(style);
    }
    // 이미 content.js 가 완전판을 넣었으면(early 마커 없음) 건드리지 않는다.
    if (style.dataset.cheeseEarly !== "1") return;
    style.textContent = css;
  }

  // ── 라벨 기반 섹션 숨김(인기카테고리/방송일정/서비스바로가기/파트너 등) ──────────
  // 이 섹션들은 고정 href 가 없어 CSS 로 못 잡고, content.js 는 제목 텍스트를 읽어
  // 'cheese-sb-hide'(content.css 에 display:none 정적 규칙 있음) 클래스를 붙인다. 그런데
  // content.js(document_idle)가 늦어 사이드바가 먼저 뜨면 잠깐 보인다. 여기서 사이드바
  // nav 가 나타나는 즉시 라벨을 검사해 같은 클래스를 조기 부여한다(정적 CSS 라 즉시 숨김).
  const HIDE_CLASS = "cheese-sb-hide";
  // [라벨 부분일치 키워드, featureFlag] — content.js applySidebarSections 와 동일 기준.
  const LABEL_RULES = [
    ["인기카테고리", "sbPopularCategory"],
    ["방송일정", "sbBroadcastSchedule"],
    ["파트너", "sbPartner"],
    ["서비스바로가기", "sbServices"],
  ];
  let labelFlags = null; // 숨겨야 할 키워드 목록(설정 로드 후 채움)

  function navLabel(nav) {
    const title = nav.querySelector('[class*="_title_"]');
    const titleText = title ? title.textContent || "" : "";
    let blind = "";
    nav.querySelectorAll(".blind").forEach((el) => {
      blind += " " + (el.textContent || "");
    });
    return (titleText + " " + blind).replace(/\s+/g, "");
  }

  // 사이드바 nav 를 하나라도 처리했으면 true(→ 옵저버 조기 해제 신호).
  function applyLabelHide() {
    if (!labelFlags || !labelFlags.length) return false;
    const sb = document.getElementById("sidebar");
    if (!sb) return false;
    const navs = sb.querySelectorAll('nav[class*="_section_"]');
    navs.forEach((nav) => {
      const label = navLabel(nav);
      for (const kw of labelFlags) {
        if (label.includes(kw)) {
          nav.classList.add(HIDE_CLASS);
          break;
        }
      }
    });
    return navs.length > 0; // 섹션이 실제로 존재하면 처리 완료로 간주
  }

  let labelObserver = null;
  let labelTimer = 0;
  function stopLabelObserver() {
    if (labelObserver) {
      labelObserver.disconnect();
      labelObserver = null;
    }
    if (labelTimer) {
      clearTimeout(labelTimer);
      labelTimer = 0;
    }
  }
  function startLabelObserver() {
    if (!labelFlags || !labelFlags.length) return;
    applyLabelHide(); // 이미 있으면 즉시 1회 적용
    // ⚠ 첫 처리 후 바로 해제하면 안 된다 — 치지직 SPA 가 사이드바 nav 를 '재렌더'하면 새
    // nav 엔 클래스가 없어 다시 깜빡인다. content.js(document_idle)가 관리를 넘겨받을 때까지
    // (넉넉히 8초) 옵저버를 유지해 재렌더도 계속 잡는다. 콜백은 nav 등장 시에만 도는 가벼운
    // 처리라 부담이 작다. 8초 뒤엔 content.js 의 옵저버가 이어받으므로 해제한다.
    labelObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (
            node.matches?.('nav[class*="_section_"]') ||
            node.querySelector?.('nav[class*="_section_"]')
          ) {
            applyLabelHide(); // 재렌더 대응(해제하지 않고 계속 감시)
            return; // 이 batch 는 처리했으니 나머지 mutation 은 건너뜀
          }
        }
      }
    });
    labelObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    // content.js 가 이어받는 시점(넉넉히 8초) 뒤 해제(무한 관찰 방지). pagehide 로도 해제.
    labelTimer = setTimeout(stopLabelObserver, 8000);
  }
  // 탭이 로드 중 닫히거나 이탈해도 확실히 정리(누수 방지).
  window.addEventListener("pagehide", stopLabelObserver, { once: true });

  try {
    chrome.storage.local.get([FEATURE_KEY], (data) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      const f = data && data[FEATURE_KEY];
      const rules = buildRules(f);
      if (rules.length) inject(rules.join("\n"));
      // 라벨 기반 숨김 대상 키워드 수집 후 옵저버 시작.
      if (f && typeof f === "object") {
        labelFlags = LABEL_RULES.filter(([, flag]) => f[flag] === true).map(
          ([kw]) => kw,
        );
        if (labelFlags.length) startLabelObserver();
      }
    });
  } catch {
    /* storage 접근 실패 시 조용히 포기(content.js 가 결국 처리) */
  }
})();
