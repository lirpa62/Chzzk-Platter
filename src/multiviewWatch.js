// 치즈 플래터 - 멀티뷰 시청 화면
// 채널 고르기(multiview.html)에서 넘긴 구성을 받아 실제로 방송을 띄운다.
//
// ⚠ m3u8 을 직접 재생하지 않는다. 중간광고·그리드를 우회하는 셈이 되어 제재
//   사유가 될 수 있다. 치지직 페이지를 그대로 띄워 광고·집계를 정상 동작시킨다.
// ⚠ 교차 출처라 부모에서 프레임 내부 DOM 을 만질 수 없다. 채팅 접기·넓은 화면·
//   화질·음소거는 URL 쿼리로 신호를 주고 프레임 쪽 content.js 가 수행한다.
(() => {
  "use strict";

  const LAYOUTS = globalThis.CheeseMultiviewLayouts;
  const SETUP_PAGE = "multiview.html";
  // 고른 구성을 주소에 담기엔 길다. 세션 저장소로 넘기고 이 키로 읽는다.
  const HANDOFF_KEY = "cheeseMultiviewSetup";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  const state = { chosen: [], layoutId: "", chatChannelId: "", chatSide: "" };

  // 프레임에 줄 URL. 팝업 플레이어와 같은 방식으로 쿼리에 지시를 담는다.
  function frameUrl(channel, isMain, mainHighQuality) {
    const url = new URL(
      `/live/${channel.channelId}`,
      "https://chzzk.naver.com",
    );
    url.searchParams.set("cheeseMulti", "1");
    url.searchParams.set("cheeseMultiMain", isMain ? "1" : "0");
    // 메인만 소리, 나머지는 음소거로 시작한다.
    url.searchParams.set("cheeseMultiMuted", isMain ? "0" : "1");
    // 화질: 기본 480p. 메인만 높은 화질을 쓰도록 골랐으면 메인은 지정하지 않는다
    // (프레임 쪽이 최대 화질 설정을 따른다).
    if (!(isMain && mainHighQuality)) {
      url.searchParams.set("cheeseMultiQuality", "480");
    }
    return url.toString();
  }

  function applyChat(channelId) {
    state.chatChannelId = channelId;
    // 채팅 전용 페이지를 쓴다(/live/<id>/chat). 영상이 없는 화면이라 소리·화질을
    // 따로 억제할 필요가 없고, 라이브 페이지를 통째로 띄우는 것보다 훨씬 가볍다.
    const url = new URL(`/live/${channelId}/chat`, "https://chzzk.naver.com");
    url.searchParams.set("cheeseMultiChat", "1");
    $("mvChatFrame").src = url.toString();
  }

  function render(setup) {
    const layout = LAYOUTS.layoutById(setup.layoutId);
    if (!layout || !Array.isArray(setup.chosen) || setup.chosen.length < 2) {
      $("mvStage").hidden = true;
      $("mvWatchEmpty").hidden = false;
      return;
    }
    state.chosen = setup.chosen;
    state.layoutId = setup.layoutId;

    const frames = $("mvFrames");
    frames.style.gridTemplateColumns = layout.columns;
    frames.style.gridTemplateRows = layout.rows;
    frames.style.gridTemplateAreas = layout.areas.join(" ");
    frames.innerHTML = "";
    setup.chosen.forEach((channel, index) => {
      const cell = document.createElement("div");
      cell.className = "mv-cell" + (index === 0 ? " is-main" : "");
      cell.style.gridArea = LAYOUTS.SLOTS[index];
      cell.dataset.channelId = channel.channelId;
      // 16:9 를 지키기 위한 한 겹. 칸이 어떤 모양이든 이 상자가 비율을 유지한다.
      const box = document.createElement("div");
      box.className = "mv-cell-inner";
      const frame = document.createElement("iframe");
      frame.src = frameUrl(
        channel,
        index === 0,
        setup.mainHighQuality !== false,
      );
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.title = `${channel.channelName} 방송`;
      frame.referrerPolicy = "origin";
      box.appendChild(frame);
      cell.appendChild(box);
      frames.appendChild(cell);
    });

    const { direction, side } = LAYOUTS.stageStyle(layout, setup.chatSide);
    state.chatSide = side;
    const stage = $("mvStage");
    stage.style.flexDirection = direction;
    stage.dataset.chatSide = side;

    const select = $("mvChatChannel");
    select.innerHTML = setup.chosen
      .map(
        (c, i) =>
          `<option value="${esc(c.channelId)}">${esc(c.channelName)}${i === 0 ? " (메인)" : ""}</option>`,
      )
      .join("");
    applyChat(setup.chosen[0].channelId);
  }

  function backToSetup() {
    // ⚠ src 를 비워 프레임을 확실히 내린다. 그냥 이동하면 재생·소켓이 잠깐 더 산다.
    for (const frame of document.querySelectorAll("iframe")) {
      frame.src = "about:blank";
    }
    location.href = chrome.runtime.getURL(SETUP_PAGE);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("#mvBack")) {
      backToSetup();
      return;
    }
    if (event.target.closest?.("#mvChatToggle")) {
      const stage = $("mvStage");
      const folded = stage.classList.toggle("is-chat-folded");
      const button = $("mvChatToggle");
      button.textContent = folded ? "펴기" : "접기";
      button.setAttribute("aria-label", folded ? "채팅 펴기" : "채팅 접기");
    }
  });

  $("mvChatChannel")?.addEventListener("change", (event) => {
    applyChat(event.target.value);
  });

  (async () => {
    let setup = null;
    try {
      const d = await chrome.storage.session.get(HANDOFF_KEY);
      setup = d?.[HANDOFF_KEY] || null;
    } catch {}
    if (!setup) {
      $("mvStage").hidden = true;
      $("mvWatchEmpty").hidden = false;
      return;
    }
    render(setup);
  })();
})();
