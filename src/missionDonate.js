// 미션 후원을 '건 순간'에 잡는다(MAIN world).
//
// 미션 결제 내역의 시각은 성공·실패가 확정된 순간일 수 있다. 따라서 요청 시각을
// 별도로 남겨야 다시보기와 리캡에서 실제 후원 시점을 사용할 수 있다.
(function trackMissionDonate() {
  const MESSAGE_SOURCE = "cheese-mission-donate";
  const originalFetch = window.fetch;
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;

  function isMissionDonateUrl(value) {
    let pathname = "";
    try {
      pathname = new URL(String(value || ""), location.href).pathname;
    } catch {
      pathname = String(value || "").split("?")[0];
    }
    const lower = pathname.toLowerCase();
    return (
      lower.includes("/commercial/v1/") &&
      lower.includes("mission") &&
      lower.includes("donate")
    );
  }

  function urlOf(input) {
    if (typeof input === "string") return input;
    if (typeof Request !== "undefined" && input instanceof Request) {
      return input.url;
    }
    return String(input?.url || input || "");
  }

  function parsePayloadText(text) {
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {}
    try {
      const values = Object.fromEntries(new URLSearchParams(text));
      return Object.keys(values).length ? values : null;
    } catch {
      return null;
    }
  }

  async function parseBodyValue(body) {
    if (!body) return null;
    if (typeof body === "string") return parsePayloadText(body);
    if (
      typeof URLSearchParams !== "undefined" &&
      body instanceof URLSearchParams
    ) {
      return Object.fromEntries(body);
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      return Object.fromEntries(body.entries());
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return parsePayloadText(await body.text());
    }
    return null;
  }

  async function parseFetchBody(input, init) {
    if (init?.body) return parseBodyValue(init.body);
    if (typeof Request !== "undefined" && input instanceof Request) {
      // clone()을 읽으므로 원 요청의 bodyUsed에는 영향을 주지 않는다.
      try {
        const clone = input.clone();
        return parsePayloadText(await clone.text());
      } catch {}
    }
    return null;
  }

  function nestedObjects(root) {
    const values = [];
    const queue = [root];
    const seen = new Set();
    while (queue.length && values.length < 24) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
      for (const key of [
        "data",
        "content",
        "body",
        "request",
        "mission",
        "donation",
      ]) {
        if (value[key] && typeof value[key] === "object") {
          queue.push(value[key]);
        }
      }
    }
    return values;
  }

  function pick(root, keys) {
    for (const value of nestedObjects(root)) {
      for (const key of keys) {
        if (
          value[key] !== undefined &&
          value[key] !== null &&
          value[key] !== ""
        ) {
          return value[key];
        }
      }
    }
    return "";
  }

  function currentChannelId() {
    const match = location.pathname.match(
      /\/(?:live\/)?([0-9a-f]{32})(?:\/|$)/i,
    );
    return String(match?.[1] || "").toLowerCase();
  }

  function normalizeMission(payload, responsePayload) {
    const combined = { request: payload, response: responsePayload };
    const channelId = String(
      pick(combined, ["channelId", "channelIdHash", "channelHash"]) ||
        currentChannelId(),
    ).toLowerCase();
    const amount = Number(
      pick(payload, ["payAmount", "donationAmount", "amount", "cheeseAmount"]),
    );
    const relatedMissionId = String(
      pick(payload, [
        "relatedMissionDonationId",
        "targetMissionDonationId",
        "parentMissionDonationId",
        "missionDonationId",
      ]) || "",
    );
    let donationType = String(
      pick(payload, ["donationType", "missionDonationType", "type"]) || "",
    ).toUpperCase();
    if (!donationType.startsWith("MISSION")) {
      donationType = relatedMissionId
        ? "MISSION_PARTICIPATION"
        : "MISSION_ALONE";
    }
    const missionId = String(
      pick(responsePayload, ["missionDonationId", "donationId", "id"]) ||
        (typeof responsePayload?.content === "string"
          ? responsePayload.content
          : ""),
    );
    return {
      channelId,
      amount,
      donationType,
      missionId,
      relatedMissionId,
      anonymous:
        pick(payload, ["isAnonymous", "anonymous"]) === true ||
        String(pick(payload, ["isAnonymous", "anonymous"])).toLowerCase() ===
          "true",
      liveId: Number(pick(payload, ["liveId", "liveNo", "contentId"])) || 0,
    };
  }

  function report(payload, responsePayload, at) {
    const mission = normalizeMission(payload, responsePayload);
    if (!/^[0-9a-f]{32}$/.test(mission.channelId)) return;
    if (!Number.isFinite(mission.amount) || mission.amount <= 0) return;
    window.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: "mission",
        ...mission,
        at,
      },
      location.origin,
    );
  }

  function responseJson(responseText) {
    if (!responseText) return null;
    if (typeof responseText === "object") return responseText;
    return parsePayloadText(String(responseText));
  }

  if (typeof originalFetch === "function") {
    window.fetch = async function (input, init) {
      const url = urlOf(input);
      if (!isMissionDonateUrl(url)) {
        return originalFetch.apply(this, arguments);
      }
      const at = Date.now();
      // Request body는 원 요청이 시작된 뒤 bodyUsed가 될 수 있으므로 먼저 복제한다.
      const payloadPromise = parseFetchBody(input, init).catch(() => null);
      const response = await originalFetch.apply(this, arguments);
      try {
        if (response.ok) {
          const [payload, json] = await Promise.all([
            payloadPromise,
            response.clone().json().catch(() => null),
          ]);
          const code = Number(json?.code);
          if (payload && (!Number.isFinite(code) || code === 200)) {
            report(payload, json, at);
          }
        }
      } catch {}
      return response;
    };
  }

  // 치지직이 fetch 대신 XHR로 전환해도 대기 시각을 놓치지 않는다.
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__cheeseMissionRequest = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
    };
    return xhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const request = this.__cheeseMissionRequest;
    if (
      !request ||
      request.method === "GET" ||
      !isMissionDonateUrl(request.url)
    ) {
      return xhrSend.apply(this, arguments);
    }
    const at = Date.now();
    const payloadPromise = parseBodyValue(body).catch(() => null);
    this.addEventListener(
      "loadend",
      () => {
        if (this.status < 200 || this.status >= 300) return;
        void payloadPromise.then((payload) => {
          if (!payload) return;
          try {
            const json = responseJson(this.response ?? this.responseText);
            const code = Number(json?.code);
            if (!Number.isFinite(code) || code === 200) {
              report(payload, json, at);
            }
          } catch {}
        });
      },
      { once: true },
    );
    return xhrSend.apply(this, arguments);
  };
})();
