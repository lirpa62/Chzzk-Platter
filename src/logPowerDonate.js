// 후원·구독 선물로 얻는 통나무파워를 감지한다(MAIN world).
//
// ⚠ 왜 훅이 필요한가
//   시청 보상(WATCH_*)과 팔로우는 log-power 의 claims 배열로 내려와 claimId 로 식별된다.
//   그런데 후원·구독 선물은 claims 에 나타나지 않는다(실측: 후원 직후에도 claims: []).
//   서버가 보유량에 바로 더해 줄 뿐이라 '언제 얼마가 들어왔는지' 알 방법이 없다.
//   → 후원/선물 요청이 성공한 순간을 잡아, 그 전후 보유량 차이로 역산한다.
//
// ⚠ 보수적 규칙
//   증분이 '알려진 조합'과 정확히 맞을 때만 기록한다. 같은 순간 시청 보상이 들어오거나
//   다른 탭/기기에서 적립이 겹치면 증분이 섞이는데, 그걸 후원으로 잘못 귀속하면
//   내역이 조용히 틀어진다. 애매하면 기록하지 않는 편이 낫다.
(function trackLogPowerDonate() {
  const MESSAGE_SOURCE = "cheese-logpower-donate";
  const LOG_POWER_BASE = "https://api.chzzk.naver.com/service/v1/channels";

  // claim-list 실측 단가(모든 채널 동일). 서버가 바꾸면 조합이 안 맞아 기록이
  // 생략될 뿐 잘못된 값이 남지는 않는다.
  const DONATE = 20;
  const DONATE_MONTHLY = 300;
  const GIFT = 50;
  const GIFT_MONTHLY = 500;

  // 증분 → 어떤 적립이었는지. 0(한도 소진)은 기록 대상이 아니다.
  const DONATE_COMBOS = new Map([
    [DONATE, [["DONATE", DONATE]]],
    [
      DONATE + DONATE_MONTHLY,
      [
        ["DONATE", DONATE],
        ["DONATE_MONTHLY", DONATE_MONTHLY],
      ],
    ],
  ]);
  const GIFT_COMBOS = new Map([
    [GIFT, [["SUBSCRIPTION_GIFT", GIFT]]],
    [
      GIFT + GIFT_MONTHLY,
      [
        ["SUBSCRIPTION_GIFT", GIFT],
        ["SUBSCRIPTION_GIFT_MONTHLY", GIFT_MONTHLY],
      ],
    ],
  ]);

  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") return;

  const isDonateUrl = (u) =>
    /\/commercial\/v1\/donate(?:\?|$)/.test(String(u || ""));
  const isGiftUrl = (u) =>
    /\/commercial\/v1\/gift\/subscription\/purchase(?:\?|$)/.test(
      String(u || ""),
    );
  // 팔로우: POST /service/v1/channels/<id>/follow
  const FOLLOW_RE = /\/service\/v1\/channels\/([0-9a-f]{32})\/follow(?:\?|$)/i;

  // 팔로우 보상은 claims 로 정상적으로 내려오고(실측), content.js 폴링이 PUT 한다.
  // 여기서 같은 PUT 을 한 번 더 잡는 이유는 두 가지다.
  //   · 폴링은 최대 1분 지연 — 훅은 즉시 기록한다.
  //   · 치지직 자신이 PUT 하는 경우(우리가 PUT 하기 전에 소비)도 놓치지 않는다.
  // ⚠ 응답의 content.amount 는 지급액이 아니라 '지급 후 보유량'이다. PUT 직전 값을
  // 읽어 차액으로 역산한다. 중복은 claimId 로 걸러진다.
  //
  // claimId = "<TYPE>-<uuid>". TYPE 에 숫자가 섞이므로(WATCH_1_HOUR) [A-Z0-9_] 로
  // 받되, uuid 첫 마디를 전방탐색해 TYPE 이 uuid 를 먹지 않게 끊는다.
  const CLAIM_PUT_RE =
    /\/service\/v1\/channels\/([0-9a-f]{32})\/log-power\/claims\/([A-Z0-9_]+?)-(?=[0-9a-f]{8}-)/i;

  // content.js 의 getLogPowerChannelId 와 같은 범위(라이브·채널 홈·짧은 주소).
  function currentChannelId() {
    const m = location.pathname.match(
      /^\/(?:live\/|channel\/)?([0-9a-f]{32})(?:\/|$)/i,
    );
    return m ? m[1] : "";
  }

  async function readBalance(channelId) {
    try {
      const res = await originalFetch.call(
        window,
        `${LOG_POWER_BASE}/${channelId}/log-power`,
        { credentials: "include" },
      );
      if (!res.ok) return null;
      const amount = (await res.json())?.content?.amount;
      return Number.isFinite(Number(amount)) ? Number(amount) : null;
    } catch {
      return null;
    }
  }

  // 보유량 스냅샷. 후원 요청 '직전' 값을 기준으로 삼는다.
  const balanceBefore = new Map(); // channelId → amount
  const snapshotAt = new Map(); // channelId → 그 값을 읽은 시각
  // 정산(반영 대기) 중인 채널. 이 사이 주기 갱신이 기준값을 덮으면 delta 가 사라진다.
  const settling = new Set();
  // 기준값이 이보다 묵었으면 그 사이 시청 보상이 여러 번 끼었을 수 있어 역산을
  // 포기한다(주기 15초의 여유 배수).
  const STALE_MS = 60000;
  async function snapshot(channelId) {
    if (!channelId || settling.has(channelId)) return;
    const v = await readBalance(channelId);
    if (v != null) {
      balanceBefore.set(channelId, v);
      snapshotAt.set(channelId, Date.now());
    }
  }

  // ⚠ 팔로우하고 곧바로 페이지를 벗어나면 content.js 폴링(최대 60초)이 그 채널을
  //   더 이상 보지 않아 보상을 놓친다(제보). 팔로우 요청을 잡은 즉시 그 채널의
  //   claims 를 훑어 PUT 하면 이탈해도 처리된다.
  async function claimFollowNow(channelId) {
    try {
      const res = await originalFetch.call(
        window,
        `${LOG_POWER_BASE}/${channelId}/log-power`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const claims = (await res.json())?.content?.claims;
      if (!Array.isArray(claims)) return;
      for (const c of claims) {
        const type = String(c?.claimType || "").toUpperCase();
        if (type.startsWith("WATCH_")) continue; // 시청 보상은 폴링 담당
        if (
          !c?.claimId ||
          String(c.state || "").toUpperCase() !== "COMPLIED" ||
          String(c.saveType || "").toUpperCase() !== "ACTIVE"
        ) {
          continue;
        }
        // PUT 은 우리 훅을 다시 타고(window.fetch), 거기서 기록까지 이어진다.
        await window.fetch(
          `${LOG_POWER_BASE}/${channelId}/log-power/claims/${c.claimId}`,
          { method: "PUT", credentials: "include" },
        );
      }
    } catch {}
  }

  function report(channelId, entries) {
    window.postMessage(
      { source: MESSAGE_SOURCE, type: "earned", channelId, entries },
      location.origin,
    );
  }

  // ⚠ 후원과 구독 선물은 시점이 다르다.
  //   · /donate 응답 = 후원 완료 → 보유량이 바로 오른다.
  //   · /gift/subscription/purchase 응답 = 결제 '페이지 URL'. 네이버페이 결제를
  //     마쳐야 선물이 성사되므로 즉시 읽으면 아직 안 올라 있다.
  //   그래서 선물은 잠깐씩 여러 번 확인한다. 결제를 취소하면 끝내 안 오르고,
  //   그때는 아무것도 기록하지 않는다(조합 불일치와 같은 처리).
  // 후원: 실측 ~14초 → 넉넉히 40초까지 훑는다.
  const DONATE_RETRY_MS = [2000, 3000, 3000, 4000, 5000, 8000, 15000];
  // 선물: 네이버페이 결제를 마쳐야 하므로 훨씬 길게 기다린다.
  const GIFT_RETRY_MS = [3000, 8000, 15000, 30000, 60000, 60000];

  // 기준값을 뜬 뒤 후원 전까지 시청 보상이 끼어들 수 있다(5분 10, 1시간 100,
  // 부스팅 시 12/120/200). 그만큼을 빼 보고도 조합에 맞으면 후원분으로 인정한다.
  // 그래도 안 맞으면 기록하지 않는다 — 보수적 규칙은 그대로다.
  const WATCH_NOISE = [0, 10, 12, 20, 100, 120, 200];

  function match(channelId, before, after, combos, kind) {
    const delta = after - before;
    if (delta <= 0) return false; // 일 한도 소진 등 — 적립 없음
    let combo = null;
    for (const noise of WATCH_NOISE) {
      const hit = combos.get(delta - noise);
      if (hit) {
        combo = hit;
        break;
      }
    }
    if (!combo) {
      // 알려진 조합과 다르다 = 다른 적립이 섞였거나 단가가 바뀌었다.
      // 억지로 귀속하지 않고 넘어간다(보수적 규칙).
      return false;
    }
    report(
      channelId,
      combo.map(([claimType, amount]) => ({ claimType, amount, kind })),
    );
    return true;
  }

  // ⚠ 후원은 응답 즉시 반영되지 않는다. 실측(제보): donate 응답과 같은 초에 읽은
  //   log-power 는 268490(미반영), 14초 뒤에야 268510(+20)이 됐다. 그래서 후원도
  //   선물처럼 '오를 때까지' 몇 번 다시 읽어야 한다. 한 번만 읽으면 delta=0 으로
  //   보고 조용히 버리게 된다 — 후원이 전혀 기록되지 않던 원인이다.
  async function settle(channelId, combos, kind, schedule) {
    if (!channelId) return;
    const before = balanceBefore.get(channelId);
    if (before == null) return; // 기준값이 없으면 역산 불가 → 조용히 포기
    // ⚠ visibilitychange 가 안 오는 경우가 있어(치지직 실측 전례) 기준값이 오래
    //   묵었을 수 있다. 그럴 땐 역산해 봐야 잡음만 섞이므로 시도하지 않는다.
    //   대신 지금 값을 새 기준으로 삼아 '다음' 후원은 정상 판정되게 한다.
    if (Date.now() - (snapshotAt.get(channelId) || 0) > STALE_MS) {
      await snapshot(channelId);
      return;
    }
    // 확인하는 동안 주기 갱신이 기준값을 덮어쓰면 delta 가 0 이 된다 → 잠근다.
    settling.add(channelId);
    try {
      for (const wait of schedule) {
        await new Promise((r) => setTimeout(r, wait));
        const after = await readBalance(channelId);
        if (after == null) continue;
        if (after <= before) continue; // 아직 반영 전(선물이면 결제 전) — 더 기다린다
        balanceBefore.set(channelId, after);
        snapshotAt.set(channelId, Date.now());
        match(channelId, before, after, combos, kind);
        return;
      }
      // 끝내 안 올랐다 = 한도 소진 또는 결제 취소/실패. 기록 없음.
    } finally {
      settling.delete(channelId);
    }
  }

  // 기준값 미리 확보. 후원 직전에 읽으면 요청이 그만큼 느려지고, 응답 뒤에 읽으면
  // 이미 적립된 값이라 역산이 불가능하다 → 미리 떠 둔다.
  //
  // ⚠ 채널 진입 때 한 번만 읽으면 안 된다. 라이브를 보는 동안 5분·1시간 시청
  //   보상이 계속 들어와 실제 보유량이 오르는데, 낡은 기준값으로 빼면
  //   delta = 후원분 + 그동안의 시청 보상 → 조합과 안 맞아 전부 버려진다.
  //   그래서 주기적으로 갱신해 '후원 직전 값'에 가깝게 유지한다.
  //
  // 주기 선정: 창에 5분 보상(300초 간격)이 낄 확률 ≈ 주기/300. 15초면 5%이고,
  // 그마저도 WATCH_NOISE 가 1건은 흡수하므로 실질 실패는 거의 없다. 더 줄여도
  // 얻는 게 없다 — 15초 창에 5분 보상이 두 번 들어오는 건 불가능하다.
  const REFRESH_MS = 15000;
  let refreshTimer = 0;
  function stopRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = 0;
    }
  }
  function warmUp() {
    const id = currentChannelId();
    // 채널 페이지가 아니거나 탭이 안 보이면 후원할 수 없다 → 폴링을 멈춘다.
    // (라이브를 켜 두고 다른 탭을 보는 시간이 길어 이 절약이 크다.)
    if (!id || document.hidden) {
      stopRefresh();
      return;
    }
    void snapshot(id);
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        if (document.hidden) return; // 숨김 중에는 건너뛴다
        const cur = currentChannelId();
        if (cur) void snapshot(cur);
      }, REFRESH_MS);
    }
  }
  warmUp();
  // 숨김 동안 기준값이 낡으므로, 다시 보이면 즉시 한 번 읽고 폴링을 재개한다.
  document.addEventListener("visibilitychange", warmUp);
  // SPA 이동 대응(치지직은 pushState 로 채널을 옮긴다).
  window.addEventListener("popstate", warmUp);
  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    warmUp();
  }).observe(document, { childList: true, subtree: true });

  window.fetch = async function (input, init) {
    const url =
      typeof input === "string" ? input : input && input.url ? input.url : "";

    // 팔로우 등 claim PUT — 응답에 실제 지급액이 담겨 온다.
    const claim = CLAIM_PUT_RE.exec(url);
    const method = String(
      init?.method || (typeof input === "object" && input?.method) || "GET",
    ).toUpperCase();
    if (claim && method === "PUT") {
      // ⚠ 응답의 content.amount 는 '지급액'이 아니라 지급 후 보유량이다. 그대로 쓰면
      //   이미 갖고 있던 만큼이 더해져 기록된다(기존 10 + 팔로우 300 → 310, 제보).
      //   그래서 PUT 직전 보유량을 읽어 두고 차액을 지급액으로 삼는다.
      const beforeClaim = await readBalance(claim[1]);
      const response = await originalFetch.apply(this, arguments);
      void (async () => {
        try {
          if (!response.ok) return;
          const after = Number(
            (await response.clone().json())?.content?.amount,
          );
          if (!Number.isFinite(after)) return;
          // 직전 값을 못 읽었으면 역산할 수 없다 — 틀린 값보다 없는 편이 낫다.
          if (!Number.isFinite(Number(beforeClaim))) return;
          const amount = after - Number(beforeClaim);
          if (!Number.isFinite(amount) || amount <= 0) return;
          const claimType = claim[2].toUpperCase();
          // 시청 보상은 기존 폴링 경로가 이미 기록한다 → 중복 방지로 제외.
          if (claimType.startsWith("WATCH_")) return;
          // claimId 가 있으므로 중복 방지 id 로 그대로 넘긴다(분 단위 합성 불필요).
          const claimId = url.slice(url.lastIndexOf("/") + 1).split("?")[0];
          report(claim[1], [{ claimType, amount, kind: "claim", claimId }]);
        } catch {}
      })();
      return response;
    }

    // 팔로우 성공 → 그 채널의 claim 을 즉시 처리(이탈해도 안전).
    const follow = FOLLOW_RE.exec(url);
    if (follow && method === "POST") {
      const response = await originalFetch.apply(this, arguments);
      if (response.ok) void claimFollowNow(follow[1]);
      return response;
    }

    const donate = isDonateUrl(url);
    const gift = isGiftUrl(url);
    if (!donate && !gift) return originalFetch.apply(this, arguments);

    const channelId = currentChannelId();
    // ⚠ 기준값은 후원 요청을 '보내기 전에' 확보돼 있어야 한다. 여기서 await 하면
    //   후원이 그만큼 늦어지므로, 라이브 진입 시 미리 떠 둔 값을 쓴다(warmUp).
    //   기준값이 없으면 역산을 포기한다 — 틀린 기록보다 없는 편이 낫다.
    const response = await originalFetch.apply(this, arguments);
    if (!response.ok) return response;
    // 응답 본문은 건드리지 않는다 — 결제 흐름을 방해하면 안 된다.
    void (async () => {
      try {
        if (donate)
          await settle(channelId, DONATE_COMBOS, "donate", DONATE_RETRY_MS);
        else await settle(channelId, GIFT_COMBOS, "gift", GIFT_RETRY_MS);
      } catch {}
    })();
    return response;
  };

  // ⚠ 치지직이 후원/선물/claim 을 XHR 로 보내는 경우도 있다(commentBlock.js 에도
  //   같은 전례가 있다). fetch 만 감싸면 그때 전부 놓친다 → XHR 도 같이 훅한다.
  const XHR = window.XMLHttpRequest;
  if (typeof XHR === "function") {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      const u = String(url || "");
      this.__cheeseLpDonate = isDonateUrl(u);
      this.__cheeseLpGift = isGiftUrl(u);
      this.__cheeseLpClaim =
        String(method || "").toUpperCase() === "PUT"
          ? CLAIM_PUT_RE.exec(u)
          : null;
      this.__cheeseLpFollow =
        String(method || "").toUpperCase() === "POST"
          ? FOLLOW_RE.exec(u)
          : null;
      this.__cheeseLpUrl = u;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      const donate = this.__cheeseLpDonate;
      const gift = this.__cheeseLpGift;
      const claim = this.__cheeseLpClaim;
      const follow = this.__cheeseLpFollow;
      if (follow) {
        const xhr = this;
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            void claimFollowNow(follow[1]);
          }
        });
      }
      if (donate || gift || claim) {
        const xhr = this;
        // fetch 쪽과 같은 이유로 PUT 직전 보유량이 필요하다(응답 amount 는 잔액).
        // send 는 동기라 await 할 수 없으니 요청과 나란히 읽어 두고 load 에서 쓴다.
        const beforeClaim = claim ? readBalance(claim[1]) : null;
        xhr.addEventListener("load", () => {
          if (xhr.status < 200 || xhr.status >= 300) return;
          if (claim) {
            void (async () => {
              try {
                const after = Number(
                  JSON.parse(xhr.responseText || "{}")?.content?.amount,
                );
                const claimType = claim[2].toUpperCase();
                if (!Number.isFinite(after)) return;
                if (claimType.startsWith("WATCH_")) return;
                const before = Number(await beforeClaim);
                // 직전 값을 못 읽었으면 역산 포기(틀린 값보다 없는 편이 낫다).
                if (!Number.isFinite(before)) return;
                const amount = after - before;
                if (!Number.isFinite(amount) || amount <= 0) return;
                const url = xhr.__cheeseLpUrl || "";
                const claimId = url
                  .slice(url.lastIndexOf("/") + 1)
                  .split("?")[0];
                report(claim[1], [
                  { claimType, amount, kind: "claim", claimId },
                ]);
              } catch {}
            })();
            return;
          }
          const channelId = currentChannelId();
          void (async () => {
            try {
              if (donate)
                await settle(
                  channelId,
                  DONATE_COMBOS,
                  "donate",
                  DONATE_RETRY_MS,
                );
              else await settle(channelId, GIFT_COMBOS, "gift", GIFT_RETRY_MS);
            } catch {}
          })();
        });
      }
      return send.apply(this, arguments);
    };
  }
})();
