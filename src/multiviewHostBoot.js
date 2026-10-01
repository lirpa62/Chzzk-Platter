// 치즈 플래터 - 멀티뷰를 치지직 페이지 위에 띄우는 준비(content script, ISOLATED).
//
// 치지직이 응답 헤더 frame-ancestors 로 다른 출처(확장 페이지 포함)가 치지직 페이지를
// iframe 으로 띄우는 것을 막았다. 같은 출처('self')는 허용하므로, 배경 스크립트가 멀티뷰
// 전용 팝업 창에 치지직 라이브 탐색 페이지(/lives)를 열고 그 위에 시청 화면을 그린다.
// 칸은 그 페이지 안의 같은 출처 iframe 이 된다.
//
// 이 파일은 시청 화면 마크업과 스타일만 세운다. 시청 스크립트(multiviewWatch.js 등)는
// 배경 스크립트가 이어서 같은 격리 월드에 넣는다.
(() => {
  "use strict";

  const HOST_ATTR = "data-cheese-multiview-host";
  const OWN_ATTR = "data-cheese-multiview-own";

  // 치지직 스타일을 끈다(화면을 덮고 우리 스타일만 쓴다). 지우지 않고 media 로 끈다 —
  // 숨겨 둔 치지직 앱이 자기 요소를 다시 찾다가 오류를 내지 않게 한다.
  function muteForeignStyle(node) {
    if (!(node instanceof HTMLElement) || node.hasAttribute(OWN_ATTR)) return;
    if (node.matches('link[rel~="stylesheet"], style')) node.media = "not all";
  }

  function mount(html, info) {
    const root = document.documentElement;
    if (!root || root.hasAttribute(HOST_ATTR)) return false;
    if (typeof html !== "string" || !html) return false;
    root.setAttribute(HOST_ATTR, "1");

    const setupId = typeof info?.setupId === "string" ? info.setupId : "";
    const theme = info?.theme === "dark" ? "dark" : "light";
    globalThis.__cheeseMultiviewHost = Object.freeze({ setupId, theme });

    const parsed = new DOMParser().parseFromString(html, "text/html");
    const base = chrome.runtime.getURL("");

    for (const node of document.querySelectorAll('link[rel~="stylesheet"], style')) {
      muteForeignStyle(node);
    }
    // 치지직 앱은 경로마다 스타일을 늦게 붙인다. 새로 붙는 것도 끈다.
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) muteForeignStyle(node);
      }
    }).observe(root, { childList: true, subtree: true });

    for (const link of parsed.head.querySelectorAll('link[rel~="stylesheet"]')) {
      const own = document.createElement("link");
      own.rel = "stylesheet";
      own.href = new URL(link.getAttribute("href") || "", base).href;
      own.setAttribute(OWN_ATTR, "1");
      document.head.appendChild(own);
    }

    // ⚠ body 를 통째로 바꾼다. 시청 화면은 팝업·목록을 document.body 에 붙이므로 치지직
    //   body 를 숨기는 방식으로는 쓸 수 없다. 치지직 앱은 떼어 낸 옛 body 에서 계속
    //   돌지만 화면에는 나오지 않는다.
    const body = document.createElement("body");
    body.className = parsed.body.className;
    for (const node of [...parsed.body.childNodes]) {
      if (node.nodeName === "SCRIPT") continue;
      body.appendChild(document.importNode(node, true));
    }
    // 마크업 안 상대 주소(이미지 등)는 확장 자원으로 바꾼다.
    for (const el of body.querySelectorAll("[src]")) {
      const value = el.getAttribute("src") || "";
      if (value && !/^[a-z]+:/i.test(value)) el.setAttribute("src", new URL(value, base).href);
    }
    if (document.body) root.replaceChild(body, document.body);
    else root.appendChild(body);

    root.dataset.theme = theme;
    document.title = parsed.title || "치즈 플래터 - 멀티뷰 시청";
    return true;
  }

  globalThis.CheeseMultiviewHostBoot = { mount, HOST_ATTR };
})();
