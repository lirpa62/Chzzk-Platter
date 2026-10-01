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
    // 채널 이미지가 없어 넣어 둔 기본 프로필은 테마에 맞는 것으로 바꾼다.
    const url = globalThis.CheeseMultiviewSources?.defaultProfileUrl?.(isDark ? "dark" : "light");
    if (url) {
      document.querySelectorAll("img[data-mv-default-profile]").forEach((img) => {
        if (img.getAttribute("src") !== url) img.setAttribute("src", url);
      });
    }
  }

  let stored = "light";
  try {
    stored = localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {}
  // 치지직 페이지 위 멀티뷰는 확장 저장소(localStorage)를 읽을 수 없다. 고르기 화면이
  // 넘긴 테마로 시작한다.
  const hostTheme = globalThis.__cheeseMultiviewHost?.theme;
  if (hostTheme === "dark" || hostTheme === "light") stored = hostTheme;
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
