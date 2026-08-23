document.documentElement.dataset.theme =
  localStorage.getItem("cheeseSearchTheme") === "dark" ? "dark" : "light";

if (window.location.pathname.endsWith("/settings.html")) {
  const isTabView =
    new URLSearchParams(window.location.search).get("view") === "tab";
  if (isTabView) {
    document.documentElement.classList.add("settings-tab-view");
  } else {
    // ⚠ 저장된 팝업 폭을 첫 페인트 전에 적용한다. settings.js 는 </body> 끝에서
    //   실행돼 이미 기본 폭으로 그려진 뒤라, 거기서 바꾸면 창이 한 번 튄다.
    //   정본은 chrome.storage 이고 여기서 읽는 localStorage 는 그 사본이다.
    try {
      const saved = Number(localStorage.getItem("cheeseSettingsPopupWidth"));
      if (Number.isFinite(saved) && saved > 0) {
        const w = Math.min(800, Math.max(420, Math.round(saved)));
        document.documentElement.style.setProperty(
          "--settings-popup-w",
          w + "px",
        );
      }
    } catch {}
  }
}
