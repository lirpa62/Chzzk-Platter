(() => {
  "use strict";

  const TOOLTIP_ID = "mvTooltip";
  const tooltip = document.createElement("div");
  tooltip.className = "mv-tooltip";
  tooltip.id = TOOLTIP_ID;
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let hovered = null;
  let focused = null;
  let active = null;
  let dismissed = null;
  let addedDescription = false;

  function tooltipAllowed(target) {
    if (!target?.hasAttribute("data-tooltip-icon-only")) return true;
    const label = target.querySelector("[data-tooltip-label]");
    return !label || getComputedStyle(label).display === "none";
  }

  function tooltipTarget(node) {
    const target = node instanceof Element
      ? node.closest("[data-tooltip]")
      : node?.parentElement?.closest("[data-tooltip]") || null;
    return tooltipAllowed(target) ? target : null;
  }

  function removeDescription() {
    if (!active || !addedDescription) return;
    const ids = (active.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== TOOLTIP_ID);
    if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
    else active.removeAttribute("aria-describedby");
    addedDescription = false;
  }

  function hide() {
    removeDescription();
    active = null;
    tooltip.hidden = true;
    tooltip.textContent = "";
  }

  function position(target) {
    const targetRect = target.getBoundingClientRect();
    const side = document.getElementById("mvStage")?.dataset.chatSide;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const bounds = tooltip.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    let left = target.id === "mvChatPopout"
      ? side === "left"
        ? targetRect.left
        : targetRect.right - bounds.width
      : targetRect.left + (targetRect.width - bounds.width) / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - bounds.width - margin));

    let top = targetRect.bottom + margin;
    if (top + bounds.height > viewportHeight - margin) {
      top = targetRect.top - bounds.height - margin;
    }
    top = Math.max(margin, Math.min(top, viewportHeight - bounds.height - margin));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function show(target) {
    const text = target?.getAttribute("data-tooltip")?.trim();
    if (!text || !tooltipAllowed(target)) return hide();
    if (active !== target) {
      removeDescription();
      active = target;
      const ids = (active.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter(Boolean);
      if (!ids.includes(TOOLTIP_ID)) {
        active.setAttribute("aria-describedby", [...ids, TOOLTIP_ID].join(" "));
        addedDescription = true;
      }
    }
    tooltip.textContent = text;
    tooltip.hidden = false;
    position(target);
  }

  function refresh() {
    const target = focused || hovered;
    if (!target?.isConnected || target === dismissed) return hide();
    show(target);
  }

  document.addEventListener("pointerover", (event) => {
    hovered = tooltipTarget(event.target);
    refresh();
  });
  document.addEventListener("pointerout", (event) => {
    const leaving = tooltipTarget(event.target);
    if (leaving && leaving === hovered && !leaving.contains(event.relatedTarget)) {
      hovered = null;
      if (dismissed === leaving) dismissed = null;
      refresh();
    }
  });
  // 키보드로 옮긴 포커스인가(:focus-visible). 마우스로 눌러 생긴 포커스는 호버가 맡는다.
  function keyboardFocus(target) {
    try {
      return target.matches(":focus-visible");
    } catch {
      return true; // 판별할 수 없는 브라우저는 예전처럼 띄운다
    }
  }

  document.addEventListener("focusin", (event) => {
    const target = tooltipTarget(event.target);
    // ⚠ 마우스 포커스에도 띄우면, 칸 플레이어(iframe)에 있던 포커스가 버튼으로 돌아올 때
    //   클릭이 끝난 뒤 focusin 이 한 번 더 와서 닫아 둔(dismissed) 툴팁을 다시 열었다.
    //   크게 보기를 누르면 바뀐 이름('원래 크기로')이 마우스를 치운 뒤에도 남았다.
    if (target && !keyboardFocus(target)) return;
    if (target && target !== focused && target === dismissed) dismissed = null;
    focused = target;
    refresh();
  });
  document.addEventListener("focusout", (event) => {
    const leaving = tooltipTarget(event.target);
    if (leaving && leaving === focused && !leaving.contains(event.relatedTarget)) {
      focused = null;
      if (dismissed === leaving && hovered !== leaving) dismissed = null;
      refresh();
    }
  });
  function dismissFromInteraction(event) {
    const target = tooltipTarget(event.target);
    if (!target || !target.matches("button, a, input, select, [role='button']")) return;
    dismissed = target;
    if (focused === target) focused = null;
    hide();
  }
  document.addEventListener("pointerup", dismissFromInteraction, true);
  document.addEventListener("click", dismissFromInteraction, true);
  document.addEventListener("scroll", () => active && position(active), true);
  window.addEventListener("resize", refresh);

  new MutationObserver((records) => {
    if (records.some((record) => record.target === active)) refresh();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-tooltip"],
    subtree: true,
  });
})();
