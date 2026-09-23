(() => {
  "use strict";

  function attach(selectId) {
    const select = document.getElementById(selectId);
    const root = select.closest(".mv-sort-picker");
    const trigger = root.querySelector(".mv-sort-trigger");
    const value = root.querySelector(".mv-pop-value");
    const panel = root.querySelector(".mv-sort-options");
    document.body.appendChild(panel);

    const close = () => {
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const width = Math.max(158, rect.width);
      const height = Math.min(panel.scrollHeight, 320, window.innerHeight - 16);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      panel.style.top = `${Math.max(8, rect.bottom + 4 + height <= window.innerHeight - 8
        ? rect.bottom + 4 : rect.top - height - 4)}px`;
    };
    const sync = () => {
      const options = [...select.options].filter((option) => !option.hidden && !option.disabled);
      value.textContent = select.selectedOptions[0]?.textContent || "시청자순";
      trigger.disabled = select.disabled || !options.length;
      if (trigger.disabled) close();
      panel.replaceChildren(...options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `mv-pop-option${option.value === select.value ? " is-on" : ""}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(option.value === select.value));
        button.dataset.value = option.value;
        button.textContent = option.textContent;
        return button;
      }));
      if (!panel.hidden) position();
    };
    const open = () => {
      if (trigger.disabled) return;
      sync();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      position();
    };
    trigger.addEventListener("click", () => panel.hidden ? open() : close());
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      if (panel.hidden) open();
      const options = [...panel.querySelectorAll('[role="option"]')];
      const selected = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
      options[Math.max(0, selected)]?.focus({ preventScroll: true });
      event.preventDefault();
    });
    panel.addEventListener("click", (event) => {
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      select.value = option.dataset.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      trigger.focus();
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        trigger.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const options = [...panel.querySelectorAll('[role="option"]')];
        const index = options.indexOf(document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus({ preventScroll: true });
        event.preventDefault();
      }
    });
    document.addEventListener("click", (event) => {
      if (!root.contains(event.target) && !panel.contains(event.target)) close();
    });
    document.addEventListener("focusin", (event) => {
      if (!root.contains(event.target) && !panel.contains(event.target)) close();
    });
    document.addEventListener("scroll", (event) => {
      if (!panel.hidden && !panel.contains(event.target)) close();
    }, true);
    window.addEventListener("resize", close);
    select.addEventListener("change", sync);
    sync();
    return { sync, close };
  }

  globalThis.CheeseMultiviewSort = { attach };
})();
