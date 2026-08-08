// 프로필 '내 클립' 페이지 크기 확장 (MAIN world)
// game.naver.com/profile#clip 은 클립 목록을 size=10 으로 부른다. 우리가 표를 다시
// 그려서 검색·정렬을 붙이면 '관리'(SPA 편집 화면 전환)·'더보기'(React 팝오버) 버튼이
// 죽는다 — 두 동작은 치지직 React 상태에 묶여 있어 외부에서 재현할 수 없다.
//
// 그래서 행은 건드리지 않고, 요청의 size 만 키운다. 치지직이 스스로 더 많은 행을
// 그리므로 버튼은 그대로 살아 있고, 한 화면에 더 많은 클립이 놓여 검색·정렬 대상이
// 넓어진다. 실제 필터링은 content.js(격리 월드)가 DOM 으로 처리한다.
//
// ⚠ 이 페이지는 fetch 가 아니라 XHR 을 쓴다(실측 확인).
(() => {
  "use strict";

  const MAX_SIZE = 50; // API 허용 상한(그 이상은 400)
  const TARGET = /\/service\/v\d+\/clips\/make-clips/;

  function widenSize(url) {
    try {
      // 상대 경로도 받도록 base 를 준다.
      const u = new URL(String(url), location.origin);
      if (!TARGET.test(u.pathname)) return url;
      const current = Number(u.searchParams.get("size"));
      if (Number.isFinite(current) && current >= MAX_SIZE) return url;
      u.searchParams.set("size", String(MAX_SIZE));
      return u.toString();
    } catch {
      return url;
    }
  }

  const XHR = window.XMLHttpRequest;
  if (typeof XHR !== "function") return;
  const open = XHR.prototype.open;
  XHR.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, widenSize(url), ...rest);
  };

  // fetch 로 바뀔 가능성에도 대비한다(현재는 XHR 이지만 치지직이 바꿀 수 있다).
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") {
          return originalFetch.call(this, widenSize(input), init);
        }
        if (input instanceof Request && TARGET.test(new URL(input.url).pathname)) {
          return originalFetch.call(this, new Request(widenSize(input.url), input), init);
        }
      } catch {}
      return originalFetch.apply(this, arguments);
    };
  }
})();
