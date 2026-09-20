// 치즈 플래터 - 멀티뷰 테마 전환(고르기·시청 화면 공용)
//
// 첫 페인트 전 적용은 themeInit.js 가 한다. 여기서는 버튼으로 바꾸는 부분만 맡는다.
// 저장 키는 다른 확장 페이지와 같은 cheeseSearchTheme 이라 설정 화면에서 고른
// 테마가 멀티뷰에도 그대로 이어진다.
(() => {
  "use strict";

  const KEY = "cheeseSearchTheme";
  const button = document.getElementById("mvTheme");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    button?.setAttribute("aria-pressed", String(isDark));
    button?.setAttribute(
      "aria-label",
      isDark ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  let stored = "light";
  try {
    stored = localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {}
  applyTheme(stored);

  button?.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    applyTheme(next);
  });
})();
