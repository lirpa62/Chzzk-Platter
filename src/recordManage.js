// 치즈 플래터 - '기록 관리' 공용 도구. 설정·시청 시간·통나무파워 내역·채팅 리캡 화면이 함께 쓴다.
//   confirm      : 브라우저 confirm 대신 페이지 스타일 확인 모달
//   openManager  : 채널 목록에서 골라 지우거나 전체를 지우는 모달
//   chatRecap    : 내 채팅 기록을 채널별로 모으고 지운다(저장 키 + 카탈로그)
//   logPower     : 통나무파워 내역을 채널별로 모으고 지운다(배경의 단일 작성자에 맡긴다)
// 색은 popup.css 의 테마 변수를 쓴다(recordManage.css).
(() => {
  "use strict";
  if (globalThis.CheeseRecordManage) return;

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let uid = 0;
  const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

  function openOverlay(className) {
    const overlay = document.createElement("div");
    overlay.className = `crm-overlay ${className}`;
    document.body.append(overlay);
    return overlay;
  }

  // Esc 로 닫고, Tab 은 모달 안에서만 돈다. ⚠ 페이지의 Esc 처리(상세 창 닫기 등)까지
  // 가지 않게 여기서 멈춘다.
  function bindKeys(overlay, onEscape) {
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...overlay.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  // 되돌릴 수 없는 작업이라 처음 포커스는 '취소'에 둔다.
  function confirmDialog({ title = "삭제할까요?", message = "", confirmLabel = "삭제", cancelLabel = "취소", danger = true } = {}) {
    return new Promise((resolve) => {
      const previous = document.activeElement;
      const id = `crmConfirm${++uid}`;
      const overlay = openOverlay("crm-confirm");
      overlay.innerHTML =
        `<div class="crm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="${id}Title" aria-describedby="${id}Message">` +
        `<h2 id="${id}Title">${esc(title)}</h2>` +
        `<p class="crm-message" id="${id}Message">${esc(message)}</p>` +
        `<div class="crm-actions"><span class="crm-spacer"></span>` +
        `<button type="button" class="crm-button" data-crm-cancel>${esc(cancelLabel)}</button>` +
        `<button type="button" class="crm-button ${danger ? "is-danger" : "is-primary"}" data-crm-ok>${esc(confirmLabel)}</button>` +
        `</div></div>`;
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        overlay.remove();
        if (previous?.isConnected) previous.focus?.({ preventScroll: true });
        resolve(value);
      };
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-crm-cancel]")) done(false);
        else if (event.target.closest("[data-crm-ok]")) done(true);
      });
      bindKeys(overlay, () => done(false));
      overlay.querySelector("[data-crm-cancel]").focus();
    });
  }

  const CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // groups: [{ id, name, image, detail }]. remove(groups) / removeAll() 은 실패하면 throw.
  // enrich(group) 가 있으면 이름이 비어 있는 채널을 그려 둔 뒤 채운다({ name, image }).
  function openManager({ title, description = "", noun = "기록", emptyText = "저장된 기록이 없습니다.", load, remove, removeAll, enrich, onChanged } = {}) {
    const previous = document.activeElement;
    const id = `crmManager${++uid}`;
    const overlay = openOverlay("crm-manager");
    overlay.innerHTML =
      `<div class="crm-dialog crm-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}Title">` +
      `<div class="crm-head"><h2 id="${id}Title">${esc(title)}</h2>` +
      `<button type="button" class="crm-icon-button" data-crm-close aria-label="닫기">${CLOSE_ICON}</button></div>` +
      (description ? `<p class="crm-desc">${esc(description)}</p>` : "") +
      `<label class="crm-select-all"><input type="checkbox" data-crm-all /><span>전체 선택</span></label>` +
      `<div class="crm-list" role="group" aria-label="채널 목록"></div>` +
      `<p class="crm-error" role="alert" hidden></p>` +
      `<div class="crm-actions">` +
      `<button type="button" class="crm-button is-danger-ghost" data-crm-clear>전체 삭제</button>` +
      `<span class="crm-spacer"></span>` +
      `<button type="button" class="crm-button is-danger" data-crm-delete disabled>선택 삭제</button>` +
      `</div></div>`;
    const dialog = overlay.querySelector(".crm-dialog");
    const list = overlay.querySelector(".crm-list");
    const all = overlay.querySelector("[data-crm-all]");
    const deleteButton = overlay.querySelector("[data-crm-delete]");
    const clearButton = overlay.querySelector("[data-crm-clear]");
    const error = overlay.querySelector(".crm-error");
    let groups = [];
    let busy = false;

    const checked = () => [...list.querySelectorAll("input[type=checkbox]:checked")];
    const sync = () => {
      const count = checked().length;
      const total = list.querySelectorAll("input[type=checkbox]").length;
      deleteButton.disabled = busy || count === 0;
      deleteButton.textContent = count ? `선택 삭제 (${count})` : "선택 삭제";
      clearButton.disabled = busy || total === 0;
      all.disabled = busy || total === 0;
      all.checked = total > 0 && count === total;
      all.indeterminate = count > 0 && count < total;
    };
    const showError = (text) => {
      error.textContent = text;
      error.hidden = !text;
    };
    const avatar = (group) => (group.image
      ? `<img class="crm-avatar" src="${esc(group.image)}" alt="" loading="lazy" />`
      : '<span class="crm-avatar"></span>');
    const row = (group) =>
      `<label class="crm-row" data-crm-row="${esc(group.id)}"><input type="checkbox" value="${esc(group.id)}" />` +
      `${avatar(group)}<span class="crm-name">${esc(group.name || group.id)}</span>` +
      `<small class="crm-detail">${esc(group.detail || "")}</small></label>`;

    async function render() {
      list.innerHTML = '<p class="crm-empty">불러오는 중…</p>';
      try {
        groups = (await load()) || [];
      } catch {
        groups = [];
        showError("기록을 불러오지 못했습니다.");
      }
      list.innerHTML = groups.length ? groups.map(row).join("") : `<p class="crm-empty">${esc(emptyText)}</p>`;
      sync();
      if (typeof enrich !== "function") return;
      for (const group of groups.filter((g) => !g.name)) {
        try {
          const info = await enrich(group);
          if (!overlay.isConnected) return;
          const el = list.querySelector(`[data-crm-row="${CSS.escape(group.id)}"]`);
          if (!el || !info) continue;
          if (info.name) {
            group.name = info.name;
            el.querySelector(".crm-name").textContent = info.name;
          }
          if (info.image) el.querySelector(".crm-avatar").outerHTML = avatar({ image: info.image });
        } catch {}
      }
    }

    async function run(task, failText) {
      busy = true;
      showError("");
      sync();
      overlay.classList.add("is-busy");
      try {
        await task();
        onChanged?.();
      } catch {
        showError(failText);
      } finally {
        busy = false;
        overlay.classList.remove("is-busy");
        await render();
      }
    }

    const close = () => {
      overlay.remove();
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-crm-close]")) close();
    });
    list.addEventListener("change", sync);
    all.addEventListener("change", () => {
      for (const input of list.querySelectorAll("input[type=checkbox]")) input.checked = all.checked;
      sync();
    });
    deleteButton.addEventListener("click", async () => {
      const ids = new Set(checked().map((input) => input.value));
      const picked = groups.filter((group) => ids.has(group.id));
      if (!picked.length) return;
      const ok = await confirmDialog({
        title: `${noun} 선택 삭제`,
        message: `선택한 ${picked.length.toLocaleString("ko-KR")}개 채널의 ${noun}을 지웁니다.\n지운 기록은 되돌릴 수 없습니다.`,
      });
      if (ok) await run(() => remove(picked), `${noun}을 지우지 못했습니다.`);
    });
    clearButton.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `${noun} 전체 삭제`,
        message: `저장된 ${noun}을 모두 지웁니다.\n지운 기록은 되돌릴 수 없습니다.`,
        confirmLabel: "전체 삭제",
      });
      if (ok) await run(() => removeAll(), `${noun}을 지우지 못했습니다.`);
    });
    bindKeys(overlay, close);
    dialog.querySelector("[data-crm-close]").focus();
    void render();
    return { close };
  }

  // ── 내 채팅 기록 ──────────────────────────────────────────────────────────
  // 본문(월별 행·다시보기 통계)은 계정·채널마다 키가 따로 있고, 채널 목록은 계정별
  // 카탈로그에 있다. 둘 다 지워야 목록에 다시 살아나지 않는다.
  const RECAP_ROW_RE = /^chatRecap:([0-9a-f]{32}):([0-9a-f]{32}):(\d{4}-\d{2})(?::part:\d+)?$/i;
  const RECAP_STATS_RE = /^chatRecapVodChatStatsV1:([0-9a-f]{32}):([0-9a-f]{32})$/i;
  // 전체 삭제 때 함께 비우는 가져오기 완료 표식(다시보기를 처음부터 다시 모을 수 있게).
  const RECAP_RESET_KEYS = [
    "chatRecapImportedVideos",
    "chatRecapVerifiedVideosV2",
    "chatRecapVodEventLinksV3",
    "chatRecapHistoryRevisionV1",
    "chatRecapNewVideosV1",
  ];

  const chatRecap = Object.freeze({
    RESET_KEYS: RECAP_RESET_KEYS,
    // [{ id: "계정:채널", accountId, channelId, keys, months, rows, detail }] (채팅 많은 순)
    async collect() {
      const snapshot = (await chrome.storage.local.get(null)) || {};
      const byChannel = new Map();
      for (const key of Object.keys(snapshot)) {
        const match = RECAP_ROW_RE.exec(key) || RECAP_STATS_RE.exec(key);
        if (!match) continue;
        const accountId = match[1].toLowerCase();
        const channelId = match[2].toLowerCase();
        const id = `${accountId}:${channelId}`;
        if (!byChannel.has(id)) byChannel.set(id, { id, accountId, channelId, keys: [], monthSet: new Set(), rows: 0, name: "", image: "" });
        const entry = byChannel.get(id);
        entry.keys.push(key);
        if (match[3]) {
          entry.monthSet.add(match[3]);
          const items = snapshot[key]?.items;
          entry.rows += Array.isArray(items) ? items.length : 0;
        }
      }
      return [...byChannel.values()]
        .map(({ monthSet, ...entry }) => ({
          ...entry,
          months: monthSet.size,
          detail: monthSet.size
            ? `${monthSet.size}개월 · 채팅 ${entry.rows.toLocaleString("ko-KR")}개`
            : "다시보기 통계만",
        }))
        .sort((a, b) => b.rows - a.rows);
    },
    // ⚠ 본문 삭제 실패는 던진다. 호출부가 화면을 되돌려야 한다(지워지지 않았는데 행만 사라지면
    //   화면과 저장소가 어긋난다). 카탈로그 정리는 실패해도 다음 열람 때 정리된다.
    async remove(groups) {
      const keys = [];
      const byAccount = new Map();
      for (const group of groups || []) {
        if (!group?.keys?.length) continue;
        keys.push(...group.keys);
        if (!byAccount.has(group.accountId)) byAccount.set(group.accountId, []);
        byAccount.get(group.accountId).push(group.channelId);
      }
      if (!keys.length) return;
      await chrome.storage.local.remove(keys);
      for (const [accountId, channels] of byAccount) {
        const catalogKey = `chatRecapCatalog:${accountId}`;
        try {
          const stored = (await chrome.storage.local.get(catalogKey))?.[catalogKey];
          if (!stored || typeof stored !== "object") continue;
          const next = { ...stored, channels: { ...(stored.channels || {}) } };
          for (const channelId of channels) delete next.channels[channelId];
          if (Object.keys(next.channels).length) await chrome.storage.local.set({ [catalogKey]: next });
          else await chrome.storage.local.remove(catalogKey);
        } catch {}
      }
    },
    async clearAll() {
      await chatRecap.remove(await chatRecap.collect());
      // 기록 없이 이름만 남은 카탈로그 항목까지 비운다(전체 삭제 뒤 목록에 다시 나타나지 않게).
      try {
        const keys = Object.keys((await chrome.storage.local.get(null)) || {})
          .filter((key) => key.startsWith("chatRecapCatalog:"));
        await chrome.storage.local.remove([...keys, ...RECAP_RESET_KEYS]);
      } catch {}
    },
  });

  // 채널 이름·사진(치지직 채널 정보). 채팅 기록에는 이름이 저장돼 있지 않다.
  async function fetchChannelInfo(channelId) {
    if (!/^[0-9a-f]{32}$/i.test(String(channelId || ""))) return null;
    const res = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${channelId}`);
    if (!res.ok) return null;
    const content = (await res.json())?.content;
    if (!content) return null;
    const image = String(content.channelImageUrl || "");
    return {
      name: String(content.channelName || ""),
      image: image && !/[?&]type=/.test(image) ? `${image}${image.includes("?") ? "&" : "?"}type=f120_120_na` : image,
    };
  }

  // ── 통나무파워 내역 ───────────────────────────────────────────────────────
  // ⚠ 직접 고쳐 쓰지 않는다. 배경의 단일 작성자(LP_WRITE)가 지우고 보유량 비교 기준도 함께
  //   초기화한다(그대로 두면 지운 금액이 '기타 적립'으로 다시 채워진다).
  const LOG_POWER_KEY = "cheeseLogPowerLog";
  const formatAmount = (n) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}`;

  async function sendLogPowerDelete(payload) {
    const res = await chrome.runtime.sendMessage({ type: "LP_WRITE", op: "DELETE_CHANNELS", payload });
    if (!res?.ok) throw new Error(res?.reason || "delete-failed");
  }

  const logPower = Object.freeze({
    // [{ id: channelId, channelId, name, image, count, gained, used, detail }] (기록 많은 순)
    // channelId "" = 채널 없는 기록(기타 적립 등).
    async collect() {
      const list = (await chrome.storage.local.get(LOG_POWER_KEY))?.[LOG_POWER_KEY];
      const byChannel = new Map();
      for (const entry of Array.isArray(list) ? list : []) {
        const channelId = String(entry?.channelId || "");
        if (!byChannel.has(channelId)) {
          byChannel.set(channelId, { id: channelId || "(none)", channelId, name: "", image: "", count: 0, gained: 0, used: 0, lastAt: 0 });
        }
        const group = byChannel.get(channelId);
        const at = Number(entry?.at) || 0;
        const amount = Number(entry?.amount) || 0;
        group.count += 1;
        if (amount > 0) group.gained += amount;
        else group.used += amount;
        // 이름·사진은 가장 최근 기록의 것을 쓴다(개명했을 수 있다).
        if (at >= group.lastAt) {
          group.lastAt = at;
          if (entry?.channelName) group.name = String(entry.channelName);
          if (entry?.channelImageUrl) group.image = String(entry.channelImageUrl);
        }
      }
      return [...byChannel.values()]
        .map((group) => ({
          ...group,
          name: group.channelId ? group.name : "채널 없는 기록(기타 적립 등)",
          detail: `${group.count.toLocaleString("ko-KR")}건 · ${[group.gained ? formatAmount(group.gained) : "", group.used ? formatAmount(group.used) : ""].filter(Boolean).join(" / ") || "0"}`,
        }))
        .sort((a, b) => b.count - a.count);
    },
    remove(groups) {
      return sendLogPowerDelete({ channelIds: (groups || []).map((group) => group.channelId) });
    },
    clearAll() {
      return sendLogPowerDelete({ all: true });
    },
  });

  globalThis.CheeseRecordManage = Object.freeze({
    confirm: confirmDialog,
    openManager,
    chatRecap,
    logPower,
    fetchChannelInfo,
  });
})();
