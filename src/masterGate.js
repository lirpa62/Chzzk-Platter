// 치즈 플래터 전체 기능 실행 게이트(ISOLATED, document_start).
// MAIN world 스크립트는 chrome.storage에 접근할 수 없으므로 공유 DOM 속성으로
// 전체 기능 활성 상태를 전달한다. 개별 기능 설정은 건드리지 않는다.
(() => {
  "use strict";

  const KEY = "cheeseMasterEnabled";
  const root = document.documentElement;
  if (!root) return;

  const apply = (enabled) => {
    root.dataset.cheesePlatterMasterReady = "1";
    root.toggleAttribute("data-cheese-platter-disabled", !enabled);
  };

  try {
    chrome.storage.local.get(KEY, (data) => {
      if (chrome.runtime?.lastError) {
        apply(true);
        return;
      }
      apply(data?.[KEY] !== false);
    });
  } catch {
    apply(true);
  }
})();
