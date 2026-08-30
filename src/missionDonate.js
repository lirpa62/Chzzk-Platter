// 미션 후원을 '건 순간'에 잡는다(MAIN world).
//
// ⚠ 왜 훅이 필요한가
//   미션은 대기 → 성공/실패/거절로 확정된다. 확정되면 purchase/history 로 넘어오는데,
//   거기 남는 시각은 '확정된 순간'이지 내가 후원한 순간이 아니다(제보). 그 시각으로
//   다시보기 재생 위치를 잡으면 엉뚱한 곳으로 간다. 대기 목록(missions/my/active)에는
//   후원 시각이 남지만, 확정되는 순간 사라지므로 그 전에 봐야 한다.
//   → 요청을 건 순간을 직접 잡아 두면 폴링 없이 정확한 시각을 남길 수 있다.
//
// ⚠ 주기 확인을 하지 않는 이유
//   대기 목록을 주기적으로 훑으면 (1) 미션을 걸지 않는 대다수 사용자에게도 상시 비용이
//   들고 (2) 확정이 빠르면 주기 사이에 놓친다. 요청 훅은 비용이 0이고 놓치지도 않는다.
(function trackMissionDonate() {
  const MESSAGE_SOURCE = "cheese-mission-donate";

  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") return;

  // ⚠ 미션을 직접 거는 것(MISSION_ALONE)과 남의 미션에 보태는 것
  //   (MISSION_PARTICIPATION) 모두 같은 경로로 나간다. 구분은 payload 의
  //   donationType 뿐이다(실측).
  const MISSION_URL_RE =
    /\/commercial\/v1\/mission-participation-donate(?:\?|$)/;

  const urlOf = (input) => {
    if (typeof input === "string") return input;
    if (input instanceof Request) return input.url;
    return String(input?.url || input || "");
  };

  function parseBody(init, input) {
    // Request 객체로 온 경우 body 를 여기서 읽으면 원 요청이 소비된다.
    // init.body 만 본다 — 치지직은 fetch(url, {body}) 형태로 보낸다(실측).
    const body = init?.body;
    if (typeof body !== "string") return null;
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function report(payload, at, created) {
    const channelId = String(payload?.channelId || "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(channelId)) return;
    const amount = Number(payload?.payAmount) || 0;
    if (amount <= 0) return;
    // ⚠ 여기서 익명을 걸러내지 않는다. '익명 제외'는 남이 익명으로 한 후원을
    //   내 것으로 오인하지 않기 위한 규칙이고, 이 훅은 내가 보낸 요청만 잡으므로
    //   익명이어도 확실히 내 후원이다(결제 내역도 같은 이유로 내 익명 후원을 남긴다).
    //   표시에만 익명 여부를 남긴다.
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "mission",
        channelId,
        at,
        amount,
        anonymous: payload?.isAnonymous === true,
        donationType: String(payload?.donationType || "MISSION_ALONE"),
        // ⚠ 두 가지 id 를 구분해서 넘긴다.
        //   · missionId: 이 후원 자체의 id. 응답에서 온다(없을 수도 있다).
        //     대기 목록에서 이 건의 상태(취소·거절)를 확인할 때 쓴다.
        //   · relatedMissionId: 상금 쌓기일 때 '보탠 대상' 미션의 id.
        missionId: String(created || ""),
        relatedMissionId: String(payload?.relatedMissionDonationId || ""),
        liveId: Number(payload?.liveId) || 0,
      },
      location.origin,
    );
  }

  window.fetch = async function (input, init) {
    const url = urlOf(input);
    if (!MISSION_URL_RE.test(url)) return originalFetch.apply(this, arguments);
    // 요청 시각을 미리 잡아 둔다. 응답까지의 왕복 시간만큼 늦어지지 않게.
    const at = Date.now();
    const payload = parseBody(init, input);
    const response = await originalFetch.apply(this, arguments);
    try {
      // 성공한 요청만 남긴다. 잔액 부족·미션 종료 등으로 실패하면 후원이 아니다.
      if (response.ok && payload) {
        // 응답 본문을 읽어도 원 응답이 소비되지 않도록 복제해서 확인한다.
        const clone = response.clone();
        const json = await clone.json().catch(() => null);
        const code = Number(json?.code);
        // 응답이 만들어진 후원의 id 를 돌려주면 함께 남긴다. 필드명을 확정하지
        // 못했으므로(실측 자료 없음) 알려진 후보를 훑고, 없으면 빈 값으로 둔다.
        const c = json?.content;
        const created =
          typeof c === "string"
            ? c
            : c?.missionDonationId || c?.donationId || c?.id || "";
        if (!Number.isFinite(code) || code === 200) {
          report(payload, at, created);
        }
      }
    } catch {
      // 판정에 실패하면 기록하지 않는다(잘못된 시각을 남기지 않는다).
    }
    return response;
  };
})();
