// 치즈 플래터 - 멀티뷰 테마 전환(고르기·시청 화면 공용)
//
// 첫 페인트 전 적용은 themeInit.js 가 한다. 여기서는 버튼으로 바꾸는 부분만 맡는다.
// 저장 키는 다른 확장 페이지와 같은 cheeseSearchTheme 이라 설정 화면에서 고른
// 테마가 멀티뷰에도 그대로 이어진다.
(() => {
  "use strict";

  const KEY = "cheeseSearchTheme";
  const button = document.getElementById("mvTheme");

  let current = "light";

  function applyTheme(theme) {
    const isDark = theme === "dark";
    current = isDark ? "dark" : "light";
    document.documentElement.dataset.theme = current;
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

  // ⚠ 치지직 페이지 위 멀티뷰는 <html> 이 치지직 것이라, 화면 밖에 숨겨 둔 치지직 앱도 자기
  //   테마를 같은 data-theme 에 쓴다(다크 "theme_dark", 라이트 "light"). 그래서 다른 탭에서
  //   치지직을 라이트로 바꾸면 멀티뷰도 라이트가 됐고, 다크로 바꾸면 "theme_dark" 라 다크로
  //   보지 못해 그대로였다. 다시보기를 보던 중 다크가 라이트로 돌아가는 일도 같은 덮어쓰기다.
  //   멀티뷰 테마는 이 화면의 테마 단추로만 바꾸고, 다른 값이 들어오면 화면을 그리기 전에
  //   되돌린다.
  //   치지직이 되돌림에 다시 반응해 서로 덮어쓰는 일이 생겨도 화면이 멈추지 않게, 1초에
  //   20번을 넘으면 그 1초 동안은 되돌리지 않는다.
  if (globalThis.__cheeseMultiviewHost) {
    let windowStart = 0;
    let restores = 0;
    new MutationObserver(() => {
      if (document.documentElement.dataset.theme === current) return;
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        restores = 0;
      }
      if (++restores > 20) return;
      applyTheme(current);
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  button?.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    applyTheme(next);
  });
})();
