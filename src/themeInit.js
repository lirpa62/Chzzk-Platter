document.documentElement.dataset.theme =
  localStorage.getItem("cheeseSearchTheme") === "dark" ? "dark" : "light";

if (
  window.location.pathname.endsWith("/settings.html") &&
  new URLSearchParams(window.location.search).get("view") === "tab"
) {
  document.documentElement.classList.add("settings-tab-view");
}
