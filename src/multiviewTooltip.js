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
  document.addEventListener("focusin", (event) => {
    const target = tooltipTarget(event.target);
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
