// 치즈 서치 - 기능 설정 팝업
// 확장 아이콘 클릭 시 뜨는 전용 설정 페이지. 8개 기능의 표시/숨김을 전역
// (chrome.storage.local `cheeseFeatureHidden`)으로 저장한다. content.js가
// storage.onChanged로 즉시 반영하므로 열린 치지직 탭에 바로 적용된다.
(() => {
  "use strict";

  // ── 테마(검색 팝업과 localStorage 키 공유) ────────────────────────────────
  const THEME_STORAGE_KEY = "cheeseSearchTheme";
  const themeToggle = document.getElementById("themeToggleButton");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle?.setAttribute("aria-pressed", String(isDark));
    themeToggle?.setAttribute(
      "aria-label",
      isDark ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    applyTheme(next);
  }

  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light");
  themeToggle?.addEventListener("click", toggleTheme);

  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  // 미설정 시 기본 체크(숨김)인 항목. clipLiveButton은 기본적으로 숨긴다.
  const DEFAULT_HIDDEN = new Set(["clipLiveButton"]);
  const inputs = Array.from(document.querySelectorAll("[data-feature]"));

  async function load() {
    let saved = {};
    try {
      const data = await chrome.storage?.local?.get(FEATURE_HIDDEN_KEY);
      const value = data?.[FEATURE_HIDDEN_KEY];
      if (value && typeof value === "object") saved = value;
    } catch {
      // 로드 실패 시 기본값으로 둔다.
    }
    inputs.forEach((input) => {
      const key = input.dataset.feature;
      const v = saved[key];
      input.checked = typeof v === "boolean" ? v : DEFAULT_HIDDEN.has(key);
    });
  }

  function save() {
    const flags = {};
    inputs.forEach((input) => {
      flags[input.dataset.feature] = input.checked;
    });
    try {
      chrome.storage?.local?.set({ [FEATURE_HIDDEN_KEY]: flags });
    } catch {
      // 저장 실패는 무시(다음 변경 때 재시도됨).
    }
  }

  inputs.forEach((input) => input.addEventListener("change", save));
  load();

  // ── 실시간 따라잡기 민감도 프리셋 ─────────────────────────────────────────
  const SYNC_PRESET_KEY = "cheeseSyncPreset";
  const syncButtons = Array.from(
    document.querySelectorAll("[data-sync-preset]"),
  );

  function reflectSyncPreset(value) {
    const preset =
      value === "low" || value === "normal" || value === "high"
        ? value
        : "normal";
    syncButtons.forEach((btn) => {
      const active = btn.dataset.syncPreset === preset;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
  }

  async function loadSyncPreset() {
    let value = "normal";
    try {
      const data = await chrome.storage?.local?.get(SYNC_PRESET_KEY);
      if (data?.[SYNC_PRESET_KEY]) value = data[SYNC_PRESET_KEY];
    } catch {}
    reflectSyncPreset(value);
  }

  syncButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.syncPreset;
      reflectSyncPreset(value);
      try {
        chrome.storage?.local?.set({ [SYNC_PRESET_KEY]: value });
      } catch {}
    });
  });
  loadSyncPreset();
})();
