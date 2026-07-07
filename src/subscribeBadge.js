// 치즈 플래터 - 구독 배지 진행 강화 (ISOLATED content script)
// 치지직 '구독권 관리' 팝업의 '내 구독 배지' 영역에 다음 배지까지 남은 기간 텍스트와
// 게이지 눈금(tick), 다음 배지 잠금 오버레이를 추가한다. 남은 기간이 12시간 이하면
// 1분마다 실시간 갱신한다. 데이터는 치지직 구독 API(credentials 포함)에서 읽는다.
//
// React 안전 원칙: 팝업 내부는 React 가 관리하므로 기존 노드를 innerHTML 로 교체하거나
// DOM 이동하지 않는다. 우리가 만든 노드만 append/insertBefore(자체 생성 래퍼 대상)한다.
// 팝업/버튼은 좁은 감시로만 찾고, 무한 주입을 막기 위해 우리 요소엔 data-* 마커를 둔다.
(() => {
  "use strict";
  if (window.__cheeseSubscribeBadgeLoaded) return;
  window.__cheeseSubscribeBadgeLoaded = true;

  const FEATURE_KEY = "cheeseSubscribeBadgeProgress"; // 기본 ON
  let enabled = true;

  // ── 페이지 컨텍스트 & 채널ID ────────────────────────────────────────────────
  function getContext() {
    const p = location.pathname;
    if (/^\/live\//.test(p)) return "live";
    if (/^\/video\//.test(p)) return "video";
    if (/^\/[a-f0-9]{32}(?:\/.*)?$/i.test(p)) return "channel";
    return null;
  }

  // 열린 구독 팝업 안 배지/이모티콘 이미지 URL 에서 채널ID(32자 hex)를 추출한다.
  // 배지 URL 형태: .../glive/subscription/badge/<channelId>/<tier>/<month>_...png
  // URL 에 채널ID 가 없는 페이지(예: /following)에서도 팝업만 있으면 동작한다.
  function channelIdFromPopup(popup) {
    if (!popup) return null;
    const imgs = popup.querySelectorAll(
      "[class*='_image_62f6x_'], [class*='_emoticon_'] img, [class*='_badge_'] img",
    );
    for (const el of imgs) {
      const url =
        el.src ||
        (el.style?.backgroundImage || "").replace(/^url\(["']?|["']?\)$/g, "");
      const m = url.match(/\/subscription\/(?:badge|emoji)\/([a-f0-9]{32})\//i);
      if (m) return m[1];
    }
    return null;
  }

  // 채널ID 를 구한다. 우선 URL(live/channel/video) 기반, 없으면(/following 등) 넘겨받은
  // 팝업 DOM 의 배지 이미지 URL 에서 추출한다.
  async function getChannelId(popup) {
    const ctx = getContext();
    if (ctx === "live") {
      const id = location.href.match(/\/live\/([a-f0-9]{32})/i)?.[1];
      if (id) return id;
    }
    if (ctx === "channel") {
      const id = location.pathname.match(/^\/([a-f0-9]{32})/i)?.[1];
      if (id) return id;
    }
    if (ctx === "video") {
      const vid = location.pathname.match(/\/video\/(\d+)/)?.[1];
      if (vid) {
        try {
          const r = await fetch(
            `https://api.chzzk.naver.com/service/v3/videos/${vid}`,
            { credentials: "include" },
          );
          const id = (await r.json())?.content?.channel?.channelId;
          if (id) return id;
        } catch {}
      }
    }
    // URL 로 못 구하면 팝업 DOM 에서(모든 페이지 공통 폴백).
    return channelIdFromPopup(popup || findSubscribePopup());
  }

  // ── 구독 정보 API ──────────────────────────────────────────────────────────
  async function fetchSubscribeInfo(channelId) {
    try {
      const r = await fetch(
        `https://api.chzzk.naver.com/commercial/v1/subscribe/channels/${channelId}`,
        { credentials: "include" },
      );
      if (!r.ok) return null;
      return (await r.json())?.content?.info ?? null;
    } catch {
      return null;
    }
  }

  // 전체 티어/배지 목록. content.subscriptionTierInfoList 반환.
  async function fetchTiers(channelId) {
    try {
      const r = await fetch(
        `https://api.chzzk.naver.com/commercial/v1/channels/${channelId}/subscription/tiers`,
        { credentials: "include" },
      );
      if (!r.ok) return null;
      const list = (await r.json())?.content?.subscriptionTierInfoList;
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  }

  // ── 남은 기간 계산 ──────────────────────────────────────────────────────────
  function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  // spanMonths(배지 사이 개월)로 게이지 눈금 개수 산출.
  function calcTickSteps(spanMonths) {
    if (!spanMonths || spanMonths <= 0) return 0;
    return spanMonths <= 6 ? spanMonths * 2 : spanMonths;
  }

  // 구독 info → 게이지 %, 남은 시간(ms/월일/세부), spanMonths.
  // nextPublishYmdt 는 '다음 배지 지급일'이 아니라 '현재 구독권 만료일'이다(화면의
  // "구독권 만료일"과 동일 확인). 정확한 배지 지급일 필드는 API 에 없으므로:
  //  - 다음 배지 지급일 ≈ 만료일 + (nextBadgeMonth - totalMonth - 1) × publishPeriod개월
  //    (매 주기마다 totalMonth 가 1 오르고, 만료일에 이번 주기가 끝난다고 보는 추정)
  //  - 게이지 진행: 직전 배지(lastBadgeMonth)~다음 배지(nextBadgeMonth) 구간에서
  //    현재(totalMonth + 이번 주기 경과분)가 얼마나 왔는지.
  function calcGauge(info) {
    const {
      lastBadgeMonth,
      nextBadgeMonth,
      nextPublishYmdt,
      totalMonth,
      publishPeriod,
    } = info;
    if (!nextPublishYmdt) return null;

    const spanMonths = nextBadgeMonth - lastBadgeMonth;
    if (spanMonths <= 0) return null;

    const now = new Date();
    // "2026-07-10 23:59:59" (KST) → Date. 이번 구독 주기의 끝(만료일).
    const expiryDate = new Date(nextPublishYmdt.replace(" ", "T") + "+09:00");
    const period = publishPeriod > 0 ? publishPeriod : 1; // 주기(개월)

    // 다음 배지까지 남은 주기 수. 이번 주기 끝(만료일)에 totalMonth 가 +period 되어
    // 다음 배지 개월에 도달하려면 몇 주기가 더 필요한지.
    const monthsToNextBadge = Math.max(0, nextBadgeMonth - totalMonth);
    const periodsLeft = Math.max(1, Math.ceil(monthsToNextBadge / period));
    // 다음 배지 지급일 ≈ 만료일 + (periodsLeft - 1) 주기.
    const nextBadgeDate = addMonths(expiryDate, (periodsLeft - 1) * period);

    const daysToNextBadge = Math.max(
      0,
      Math.ceil((nextBadgeDate - now) / (1000 * 60 * 60 * 24)),
    );
    const daysToExpiry = Math.max(
      0,
      Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
    );

    // 게이지 %: 직전 배지 지급 시점(추정)부터 다음 배지 지급일까지의 진행.
    // 직전 배지 지급일 ≈ 다음 배지 지급일 - spanMonths개월.
    const lastBadgeDate = addMonths(nextBadgeDate, -spanMonths);
    const periodMs = nextBadgeDate - lastBadgeDate;
    const elapsedMs = now - lastBadgeDate;
    const percent =
      periodMs > 0
        ? Math.min(100, Math.max(0, +((elapsedMs / periodMs) * 100).toFixed(2)))
        : 0;

    return {
      percent,
      spanMonths,
      daysToNextBadge,
      daysToExpiry,
      nextBadgeDate,
      expiryDate,
      lastBadgeMonth,
      nextBadgeMonth,
      totalMonth,
      renewalType: info.renewalType,
    };
  }

  // 남은 일수를 사람이 읽는 문자열로(1일 미만이면 시간, 그 미만이면 분/곧).
  function daysToText(ms) {
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    if (ms <= 0) return "곧";
    if (ms >= DAY) return `${Math.ceil(ms / DAY)}일`;
    if (ms >= HOUR) return `${Math.ceil(ms / HOUR)}시간`;
    return `${Math.max(1, Math.ceil(ms / (60 * 1000)))}분`;
  }

  // 게이지 라벨: "다음 배지까지 33일 남음 (구독 만료 3일 전)"
  function formatGaugeLabel(gauge) {
    const now = new Date();
    const nextMs = gauge.nextBadgeDate - now;
    const expiryMs = gauge.expiryDate - now;

    const head =
      nextMs <= 0
        ? "다음 배지 지급 임박"
        : `다음 배지까지 ${daysToText(nextMs)} 남음`;
    const expiryPart =
      expiryMs <= 0 ? "구독 만료됨" : `구독 만료 ${daysToText(expiryMs)} 전`;
    return `${head} (${expiryPart})`;
  }

  // ── 팝업 탐색 ──────────────────────────────────────────────────────────────
  // 제목이 '구독권 관리'/'구독 관리' 인 alertdialog 컨테이너.
  function findSubscribePopup() {
    const dialogs = document.querySelectorAll(
      "[role='alertdialog'], [class*='_container_1aj24_']",
    );
    for (const el of dialogs) {
      const title = el
        .querySelector("strong[class*='_title_'], [class*='_title_']")
        ?.textContent?.trim();
      if (title && /구독(권)?\s*관리/.test(title)) return el;
    }
    return null;
  }

  // '내 구독 배지' 영역(_area_) 반환: 내부 제목 strong 이 '내 구독 배지'.
  function findBadgeArea(popup) {
    const areas = popup.querySelectorAll("[class*='_area_62f6x_']");
    for (const a of areas) {
      const t = a
        .querySelector("[class*='_text_'] strong, [class*='_title_']")
        ?.textContent?.trim();
      if (t === "내 구독 배지") return a;
    }
    return null;
  }

  const LOCK_SVG = `
    <path d="M0.5 5.5001C0.5 4.7269 1.1268 4.1001 1.9 4.1001H6.1C6.8732 4.1001 7.5 4.7269 7.5 5.5001V8.1001C7.5 8.87329 6.8732 9.5001 6.1 9.5001H1.9C1.1268 9.5001 0.5 8.8733 0.5 8.1001V5.5001Z" fill="white"></path>
    <path d="M1.8998 3.2C1.8998 2.0402 2.84001 1.1 3.9998 1.1C5.1596 1.1 6.0998 2.0402 6.0998 3.2V5.9H1.8998V3.2Z" stroke="white" stroke-width="1.2"></path>`;

  // ── 전체 배지 보기 레이어 ───────────────────────────────────────────────────
  // 우리 자체 스타일의 body-fixed 레이어(React 트리 밖). 치지직 팝업 클래스를 재사용하지
  // 않아 클래스 변경에 안 깨진다. 티어별 전체 배지를 그리고, 현재 티어의 배지 중
  // totalMonth 이하는 획득(밝게), 초과는 잠금(흐리게+자물쇠)으로 표시한다.
  const OVERLAY_ID = "cheese-subbadge-overlay";

  function closeAllBadgeOverlay() {
    const el = document.getElementById(OVERLAY_ID);
    if (el?._reposition) window.removeEventListener("resize", el._reposition);
    el?.remove();
    document.removeEventListener("keydown", onOverlayEsc, true);
  }
  function onOverlayEsc(e) {
    if (e.key === "Escape") closeAllBadgeOverlay();
  }

  function lockSvgEl(size) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("width", String(size));
    s.setAttribute("height", String(Math.round(size * 1.25)));
    s.setAttribute("viewBox", "0 0 8 10");
    s.setAttribute("fill", "none");
    s.innerHTML = LOCK_SVG;
    return s;
  }

  function openAllBadgeOverlay(tiers, info, popup) {
    closeAllBadgeOverlay();

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483000",
      background: "var(--Surface-Neutral-Weaker)",
      color: "var(--Content-Neutral-Warm-Stronger)",
      borderRadius: "12px",
      boxShadow: "0 8px 28px rgba(0,0,0,.45)",
      padding: "16px",
      overflowY: "auto",
      scrollbarWidth: "thin",
      boxSizing: "border-box",
    });

    // 오버레이는 body 에 붙이되, 팝업의 화면상 좌표(getBoundingClientRect)에 맞춰
    // position:fixed 로 팝업 영역 위에 겹친다. 이렇게 하면 팝업 내부의 offset parent /
    // overflow:hidden 에 영향받지 않아 항상 팝업 영역 안에 정확히 표시된다.
    // (팝업 내부에 absolute 로 넣으면 _contents_ 의 overflow 나 잘못된 offset parent
    //  때문에 헤더만 보이거나 밖으로 삐져나가던 문제를 회피.)
    // 실제로 맞출 팝업 박스: role=alertdialog(진짜 다이얼로그) 또는 #popup_contents 의
    // 다이얼로그 조상. 넘겨받은 popup 이 레이어 래퍼 등 엉뚱한 요소일 수 있으므로,
    // 팝업 내부의 콘텐츠 영역(#popup_contents)을 기준으로 삼는 게 가장 정확하다.
    function resolvePopupBox() {
      // 다이얼로그의 '제목'은 헤더 안 _title_ 요소로 판정한다(콘텐츠 안 채널명 등 다른
      // strong 을 제목으로 오인하지 않게).
      const isSubscribeDialog = (d) => {
        const title =
          d.querySelector("[class*='_title_']")?.textContent?.trim() || "";
        return /구독(권)?\s*관리/.test(title);
      };
      // 1) 넘겨받은 popup 이 다이얼로그면 그것, 아니면 조상 다이얼로그.
      let dialog = null;
      if (popup && document.body.contains(popup)) {
        dialog = popup.matches?.("[role='alertdialog']")
          ? popup
          : popup.closest?.("[role='alertdialog']");
      }
      // 2) 없으면 열린 alertdialog 중 구독 관리 제목을 가진 것.
      if (!dialog) {
        dialog = [...document.querySelectorAll("[role='alertdialog']")].find(
          isSubscribeDialog,
        );
      }
      // 3) 그래도 없으면 #popup_contents 의 다이얼로그 조상(또는 콘텐츠 자체).
      if (!dialog) {
        const contents = document.getElementById("popup_contents");
        dialog =
          contents?.closest("[role='alertdialog']") || contents || null;
      }
      return dialog && document.body.contains(dialog) ? dialog : null;
    }

    function positionToPopup() {
      const box = resolvePopupBox();
      if (box) {
        const r = box.getBoundingClientRect();
        const pad = 12;
        // 가로는 팝업 박스 기준(안쪽 여백 pad). 세로는 헤더/프로필을 제외하고 첫 콘텐츠
        // 영역(_area_ 첫 번째, "1개월 구독권 만료일")부터 팝업 하단까지만 덮는다.
        const firstArea = box.querySelector("[class*='_area_62f6x_']");
        const topPx = firstArea
          ? firstArea.getBoundingClientRect().top
          : r.top + pad;
        overlay.style.left = `${r.left + pad}px`;
        overlay.style.width = `${Math.max(0, r.width - pad * 2)}px`;
        overlay.style.top = `${topPx}px`;
        overlay.style.height = `${Math.max(0, r.bottom - pad - topPx)}px`;
        overlay.style.maxHeight = "none";
        overlay.style.transform = "";
      } else {
        // 팝업을 못 찾으면 화면 중앙 폴백.
        overlay.style.top = "50%";
        overlay.style.left = "50%";
        overlay.style.transform = "translate(-50%, -50%)";
        overlay.style.width = "min(420px, 92vw)";
        overlay.style.height = "auto";
        overlay.style.maxHeight = "min(70vh, 640px)";
      }
    }
    positionToPopup();
    // 팝업이 리사이즈/스크롤로 움직이면 오버레이 위치도 따라가게 한다.
    overlay._reposition = positionToPopup;
    window.addEventListener("resize", positionToPopup);

    // 헤더
    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "12px",
    });
    const h = document.createElement("strong");
    h.textContent = "전체 구독 배지";
    h.className = "_title_10ysp_69";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "닫기");
    Object.assign(close.style, {
      appearance: "none",
      background: "none",
      border: "none",
      color: "inherit",
      cursor: "pointer",
      fontSize: "18px",
      lineHeight: "1",
      padding: "4px",
    });
    close.textContent = "✕";
    close.addEventListener("click", closeAllBadgeOverlay);
    header.append(h, close);
    overlay.appendChild(header);

    const totalMonth = Number(info?.totalMonth) || 0;
    const currentTierNo = info?.tierNo ?? null;

    // 현재 티어를 맨 앞으로 정렬, 나머지는 tier 내림차순.
    const sorted = [...tiers].sort((a, b) => {
      if (a.tier === currentTierNo) return -1;
      if (b.tier === currentTierNo) return 1;
      return b.tier - a.tier;
    });

    sorted.forEach((tier, ti) => {
      const isCurrent = currentTierNo != null && tier.tier === currentTierNo;

      const section = document.createElement("div");
      section.style.padding = "8px 0";

      const title = document.createElement("p");
      title.style.margin = "0 0 8px";
      title.style.fontSize = "13px";
      const name = document.createElement("em");
      name.textContent = tier.brandName || `티어 ${tier.tier}`;
      name.style.fontStyle = "normal";
      name.style.fontWeight = "700";
      if (!isCurrent) name.style.opacity = ".6";
      const suffix = document.createElement("span");
      suffix.textContent = isCurrent ? " (현재 티어)" : "";
      suffix.style.opacity = ".6";
      suffix.style.fontSize = "12px";
      title.append(name, suffix);
      section.appendChild(title);

      const grid = document.createElement("div");
      Object.assign(grid.style, {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
        gap: "10px",
        opacity: isCurrent ? "1" : ".55",
      });

      (tier.subscriptionBadgeList || []).forEach((badge) => {
        // 획득 여부: 현재 티어에서 badge.month <= totalMonth 이면 획득.
        const reached = isCurrent && badge.month <= totalMonth;
        const cell = document.createElement("div");
        Object.assign(cell.style, {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "3px",
        });

        const thumb = document.createElement("div");
        Object.assign(thumb.style, {
          position: "relative",
          width: "36px",
          height: "36px",
        });
        const img = document.createElement("img");
        img.src = badge.imageUrl;
        img.width = 36;
        img.height = 36;
        img.alt = "";
        img.loading = "lazy";
        img.style.display = "block";
        if (isCurrent && !reached) img.style.opacity = ".4";
        thumb.appendChild(img);
        // 현재 티어에서 미획득이면 자물쇠 오버레이.
        if (isCurrent && !reached) {
          const lk = lockSvgEl(10);
          Object.assign(lk.style, {
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            filter: "drop-shadow(0 0 1px rgba(0,0,0,.7))",
            pointerEvents: "none",
          });
          thumb.appendChild(lk);
        }

        const label = document.createElement("p");
        label.textContent = `${badge.month}개월`;
        label.style.margin = "0";
        label.style.fontSize = "11px";
        label.style.opacity = ".8";

        cell.append(thumb, label);
        grid.appendChild(cell);
      });

      section.appendChild(grid);
      overlay.appendChild(section);

      if (ti !== sorted.length - 1) {
        const divider = document.createElement("div");
        Object.assign(divider.style, {
          height: "1px",
          background: "rgba(255,255,255,.1)",
          margin: "4px 0",
        });
        overlay.appendChild(divider);
      }
    });

    document.body.appendChild(overlay);
    // append 후 레이아웃이 확정된 상태로 한 번 더 위치를 맞춘다(안전).
    positionToPopup();
    document.addEventListener("keydown", onOverlayEsc, true);
    // 바깥 클릭 시 닫기(다음 tick 에 등록해 여는 클릭이 바로 닫지 않게).
    setTimeout(() => {
      document.addEventListener(
        "pointerdown",
        function outside(e) {
          if (!overlay.contains(e.target)) {
            closeAllBadgeOverlay();
            document.removeEventListener("pointerdown", outside, true);
          }
        },
        true,
      );
    }, 0);
  }

  // '내 구독 배지' 영역에 '전체보기' 버튼을 추가한다(이미 있으면 스킵).
  async function ensureViewAllButton(area, info) {
    const box = area.querySelector("[class*='_box_62f6x_']");
    if (!box || box.querySelector("[data-cheese-view-all]")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.cheeseViewAll = "1";
    btn.textContent = "전체보기";
    Object.assign(btn.style, {
      appearance: "none",
      background: "none",
      border: "none",
      color: "var(--Content-Neutral-Cool-Weak, rgba(0,0,0,.42))",
      fontSize: "12px",
      padding: "2px 0",
      marginLeft: "8px",
      textDecoration: "underline",
      cursor: "pointer",
    });
    // box 를 space-between 으로 두고 버튼을 오른쪽에(우리 스타일만 부여, 노드 이동 없음).
    if (getComputedStyle(box).display !== "flex") {
      box.style.display = "flex";
      box.style.alignItems = "center";
      box.style.justifyContent = "space-between";
    }
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      // 오버레이를 얹을 팝업 컨테이너(버튼 조상에서 탐색, 없으면 현재 열린 팝업).
      const popup =
        btn.closest("[role='alertdialog']") ||
        btn.closest("[class*='_container_1aj24_']") ||
        findSubscribePopup();
      const channelId = await getChannelId(popup);
      if (!channelId) return;
      const tiers = await fetchTiers(channelId);
      if (!tiers) return;
      openAllBadgeOverlay(tiers, info, popup);
    });
    box.appendChild(btn);
  }

  // '내 구독 배지' 게이지에 남은 기간 텍스트 + 눈금 + 다음 배지 잠금 오버레이 추가.
  function enhanceBadgeArea(area, info) {
    if (!area || !info) return;

    // '전체보기' 버튼(게이지 유무와 무관하게 추가).
    void ensureViewAllButton(area, info);

    const gauge = calcGauge(info);
    if (!gauge) return;

    const progress = area.querySelector("[class*='_progress_62f6x_']");
    if (!progress) return;

    // ① 다음 배지(두 번째 _badge_) 이미지 흐리게 + 잠금 오버레이.
    // React 안전: img 를 이동/래핑하지 않는다. nextBadge 를 relative 로 두고 자물쇠
    // SVG 를 절대배치 오버레이로 '추가'만 한다(마커 data-cheese-lock). 제거 시 자물쇠만
    // 걷어내고 opacity 만 원복하면 되므로 React 노드는 그대로 유지된다.
    const badges = progress.querySelectorAll("[class*='_badge_62f6x_']");
    const nextBadge = badges[1];
    if (nextBadge && !nextBadge.querySelector("[data-cheese-lock]")) {
      const img = nextBadge.querySelector("[class*='_image_62f6x_']");
      if (img) {
        img.style.opacity = ".5";
        if (getComputedStyle(nextBadge).position === "static") {
          nextBadge.style.position = "relative";
        }
        const lock = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        lock.dataset.cheeseLock = "1";
        lock.setAttribute("width", "10");
        lock.setAttribute("height", "12");
        lock.setAttribute("viewBox", "0 0 8 10");
        lock.setAttribute("fill", "none");
        Object.assign(lock.style, {
          position: "absolute",
          left: "50%",
          // 이미지(배지) 중앙에 오도록. 배지 라벨(개월수)이 아래에 있으므로 살짝 위로.
          top: "38%",
          transform: "translate(-50%, -50%)",
          filter: "drop-shadow(0 0 1px rgba(0,0,0,.6))",
          pointerEvents: "none",
          zIndex: "1",
        });
        lock.innerHTML = LOCK_SVG;
        nextBadge.appendChild(lock);
      }
    }

    // ② 게이지 % 반영(치지직이 이미 값을 넣지만, 우리 계산으로 보정).
    const gaugeEl = progress.querySelector("[class*='_gauge_62f6x_']");
    if (gaugeEl) gaugeEl.style.width = `${gauge.percent}%`;

    const bar = progress.querySelector("[class*='_bar_62f6x_']");
    if (!bar) return;

    // ③ 남은 기간 라벨(우리 노드). 이미 있으면 텍스트만 갱신.
    let label = bar.querySelector("[data-cheese-remaining]");
    if (!label) {
      label = document.createElement("p");
      label.dataset.cheeseRemaining = "1";
      Object.assign(label.style, {
        marginTop: "12px",
        textAlign: "center",
        fontSize: "12px",
        color: "var(--Content-Neutral-Cool-Weak, rgba(0,0,0,.42))",
        lineHeight: "1.2",
      });
      bar.appendChild(label);
    }
    label.textContent = formatGaugeLabel(gauge);

    // ④ 12시간 이하면 1분마다 실시간 갱신(중복 타이머 방지). info 를 다시 계산.
    const HALF_DAY = 12 * 60 * 60 * 1000;
    if (gauge.remainingMs <= HALF_DAY && !label._cheeseTimer) {
      label._cheeseTimer = setInterval(() => {
        // 라벨이 DOM 에서 떨어졌으면(팝업 닫힘) 타이머 정리.
        if (!label.isConnected) {
          clearInterval(label._cheeseTimer);
          label._cheeseTimer = 0;
          return;
        }
        const g = calcGauge(info);
        if (!g) return;
        label.textContent = formatGaugeLabel(g);
        if (gaugeEl) gaugeEl.style.width = `${g.percent}%`;
      }, 60 * 1000);
    }

    // ⑤ 눈금(tick). 배지 구간(예: 6→9개월)을 개월 단위로 균등 분할하는 등분선.
    // 게이지 채움과 무관하게 '구간'을 나눈다. 각 눈금을 left:% 로 명시 배치해
    // 정확히 균등하게 둔다(flex space-between 은 양끝 spacer 때문에 위치가 어긋났다).
    if (getComputedStyle(bar).position === "static") {
      bar.style.position = "relative";
    }
    let ticks = bar.querySelector("[data-cheese-ticks]");
    const steps = calcTickSteps(gauge.spanMonths);
    if (!ticks) {
      ticks = document.createElement("div");
      ticks.dataset.cheeseTicks = "1";
      Object.assign(ticks.style, {
        position: "absolute",
        left: "0",
        right: "0",
        top: "-3px",
        height: "calc(100% + 6px)", // 바보다 살짝 위아래로 튀어나오게(가시성)
        pointerEvents: "none",
      });
      bar.appendChild(ticks);
    }
    ticks.textContent = ""; // reset
    // steps 등분 → 내부 분할선 (steps-1)개. i/steps 위치(%)에 세로선.
    for (let i = 1; i < steps; i++) {
      const t = document.createElement("span");
      Object.assign(t.style, {
        position: "absolute",
        left: `${(i / steps) * 100}%`,
        top: "0",
        bottom: "0",
        width: "1px",
        transform: "translateX(-0.5px)",
        background: "var(--color-bg-overlay-01, rgba(255,255,255,.28))",
      });
      ticks.appendChild(t);
    }
  }

  // ── 팝업 감지 & 처리 ────────────────────────────────────────────────────────
  let processing = false;
  async function tryEnhance() {
    if (!enabled || processing) return;
    // 지원 페이지(라이브/다시보기/채널 홈)에서만 동작. following 등 팝업 구조가 달라
    // 정상 동작하지 않는 페이지는 명시적으로 스킵한다(URL 로 채널 컨텍스트가 없으면 제외).
    if (!getContext()) return;
    const popup = findSubscribePopup();
    if (!popup) return;
    const area = findBadgeArea(popup);
    if (!area) return;
    // 이미 처리했으면(전체보기 버튼 존재) 스킵. 게이지 라벨은 게이지가 없는 채널에선
    // 안 생기므로, 항상 생기는 '전체보기' 버튼을 처리 완료 표식으로 쓴다.
    if (area.querySelector("[data-cheese-view-all]")) return;

    processing = true;
    try {
      const channelId = await getChannelId(popup);
      if (!channelId) return;
      const info = await fetchSubscribeInfo(channelId);
      // 팝업이 그새 닫혔으면 중단.
      if (!info || !document.body.contains(popup)) return;
      enhanceBadgeArea(area, info);
    } finally {
      processing = false;
    }
  }

  // 우리가 추가한 요소를 걷어내고 건드린 스타일을 원복(토글 OFF 즉시 반영용).
  function removeEnhancements() {
    // 라벨(+타이머)
    document.querySelectorAll("[data-cheese-remaining]").forEach((el) => {
      if (el._cheeseTimer) {
        clearInterval(el._cheeseTimer);
        el._cheeseTimer = 0;
      }
      el.remove();
    });
    // 눈금
    document
      .querySelectorAll("[data-cheese-ticks]")
      .forEach((el) => el.remove());
    // 잠금 오버레이: 자물쇠 SVG 제거 + 흐리게 한 배지 이미지 opacity 원복.
    document.querySelectorAll("[data-cheese-lock]").forEach((lock) => {
      const badge = lock.closest("[class*='_badge_62f6x_']");
      const img = badge?.querySelector("[class*='_image_62f6x_']");
      if (img) img.style.opacity = "";
      lock.remove();
    });
    // 전체보기 버튼 + 열려 있는 전체 배지 레이어.
    document
      .querySelectorAll("[data-cheese-view-all]")
      .forEach((el) => el.remove());
    closeAllBadgeOverlay();
  }

  // 좁은 부트스트랩 옵저버: body 하위 변화 시 팝업 등장을 감지해 강화 시도.
  // rAF 디바운스로 프레임당 1회만 실행(대량 mutation 폭주 방지). 기능이 꺼져 있으면
  // 아예 붙이지 않아 상시 부하를 없앤다(토글 켜질 때 부착, 꺼질 때 해제).
  let scheduled = false;
  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        void tryEnhance();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  // ── 기능 토글 로드 & 반영 ───────────────────────────────────────────────────
  function applyEnabled(next) {
    enabled = next;
    if (enabled) {
      startObserver();
      void tryEnhance();
    } else {
      stopObserver();
      removeEnhancements(); // 즉시 반영: 열려 있는 팝업에서 우리 요소 제거
    }
  }
  function loadEnabled() {
    if (!chrome.storage?.local) {
      applyEnabled(true);
      return;
    }
    chrome.storage.local.get(FEATURE_KEY, (data) => {
      applyEnabled(data?.[FEATURE_KEY] !== false); // 미설정/true = ON
    });
  }
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && FEATURE_KEY in changes) {
      applyEnabled(changes[FEATURE_KEY].newValue !== false);
    }
  });

  loadEnabled();
})();
