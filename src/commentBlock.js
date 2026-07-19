// 댓글 사용자 차단 — MAIN world 인젝트.
// 치지직 댓글 API(/comments, nng_comment_api) 응답을 가로채:
//  1) 차단된 userIdHash 의 댓글(및 대댓글)을 응답에서 제거해 페이지가 아예 안 그리게 한다
//     (DOM 필터보다 견고: 렌더 타이밍 무관, '내가 차단한 이용자의 댓글입니다' 도 안 뜸).
//  2) commentId → {userIdHash, nickname} 맵을 content.js(격리 월드)로 postMessage 한다
//     ('사용자 차단' 버튼 주입·팝오버에서 어떤 유저인지 알기 위함).
// content.js 로부터 차단 userIdHash 목록을 postMessage 로 받아 유지한다.
//
// ⚠ MAIN world 라 chrome.storage 직접 접근 불가 → 차단 목록은 content.js 가 보내준다.
(() => {
  if (window.__cheeseCommentBlockLoaded) return;
  window.__cheeseCommentBlockLoaded = true;

  const originalFetch = window.fetch;
  const originalJSONParse = JSON.parse;

  // 댓글 응답 제거용 차단 집합(로컬 전용; nativeBlocked 는 치지직이 플레이스홀더 처리).
  let blockedHashes = new Set();
  // 채팅 메시지 필터용 차단 집합(전체; native 포함 — 채팅에선 무조건 안 보이게).
  let chatBlockedHashes = new Set();

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "cheese-comment-block") return;
    if (d.type === "set-blocked") {
      if (Array.isArray(d.hashes)) blockedHashes = new Set(d.hashes);
      if (Array.isArray(d.chatHashes))
        chatBlockedHashes = new Set(d.chatHashes);
    }
  });

  function isCommentApiUrl(url) {
    const u = String(url || "");
    return u.includes("/comments") && u.includes("nng_comment_api");
  }

  // 채팅 닉네임 클릭 시 뜨는 프로필 카드 API. 응답의 userIdHash/nickname 을 content.js 로
  // 보내, 채팅 프로필 팝오버에 '사용자 차단' 항목을 주입할 때 대상 유저를 식별한다.
  function isProfileCardUrl(url) {
    return String(url || "").includes("/profile-card");
  }
  function emitProfile(data) {
    const c = data?.content;
    if (!c || !c.userIdHash) return;
    window.postMessage(
      {
        source: "cheese-comment-block",
        type: "profile",
        userIdHash: String(c.userIdHash),
        nickname: String(c.nickname || ""),
      },
      "*",
    );
  }

  // ── 채팅 메시지 필터(라이브 WebSocket + VOD 채팅) ─────────────────────────
  // 라이브 채팅은 WebSocket 텍스트라 네트워크 훅으로 못 잡고, 페이지가 그 텍스트를
  // JSON.parse 로 해석하는 지점을 가로채 차단 유저 메시지를 배열에서 제거한다(치지직
  // 실측 방식). VOD 채팅은 /videos/{no}/chats HTTP 응답이라 fetch/XHR 훅에서 처리.
  JSON.parse = function (text, reviver) {
    const data = originalJSONParse(text, reviver);
    try {
      if (data && typeof data === "object") {
        // 실시간 채팅(cmd 93101): bdy 배열, msg.uid = userIdHash.
        if (
          chatBlockedHashes.size &&
          data.cmd === 93101 &&
          Array.isArray(data.bdy)
        ) {
          data.bdy = data.bdy.filter((m) => !chatBlockedHashes.has(m?.uid));
        }
        // 과거 채팅 내역(cmd 15101): bdy.messageList, msg.userId 또는 profile 내 userIdHash.
        else if (
          chatBlockedHashes.size &&
          data.cmd === 15101 &&
          data.bdy &&
          Array.isArray(data.bdy.messageList)
        ) {
          data.bdy.messageList = data.bdy.messageList.filter((m) => {
            let uid = m?.userId;
            if (!uid && m?.profile) {
              try {
                uid = originalJSONParse(m.profile).userIdHash;
              } catch {}
            }
            return !chatBlockedHashes.has(uid);
          });
        }
        // 다시보기 채팅(/videos/{no}/chats) 응답. ⚠ 플레이어가 fetch/XHR 원본을 캡처해
        // 네트워크 훅을 우회하지만(실측: XHR getter 교체까지 해도 화면 그대로),
        // responseType='' 이라 텍스트를 직접 JSON.parse 하는 순간은 못 피한다 — 여기서
        // 페이로드 형태(content.videoChats/previousVideoChats)로 감지해 필터한다.
        // hash→'녹화 당시 닉네임' 쌍은 차단 여부와 무관하게 항상 수집한다(나중에 차단할
        // 때 이미 렌더/버퍼된 메시지를 녹화 닉네임으로 숨기기 위함 — 닉네임 변경 유저 대응).
        else if (
          data.content &&
          (Array.isArray(data.content.videoChats) ||
            Array.isArray(data.content.previousVideoChats))
        ) {
          collectVodNicks(data.content);
          if (chatBlockedHashes.size) filterVodChat(data);
        }
      }
    } catch {
      // 실패 시 원본 유지.
    }
    return data;
  };

  // VOD 채팅 응답에서 hash→녹화 닉네임 쌍을 수집해 content.js 로 보낸다(중복 전송 방지).
  const sentVodNickKeys = new Set();
  function collectVodNicks(c) {
    const pairs = [];
    const scan = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const m of arr) {
        const h = vodChatHash(m);
        if (!h) continue;
        let nick = "";
        if (m?.profile) {
          try {
            const p =
              typeof m.profile === "string"
                ? originalJSONParse(m.profile)
                : m.profile;
            nick = String(p?.nickname || "").trim();
          } catch {}
        }
        if (!nick) continue;
        const key = h + "\n" + nick;
        if (sentVodNickKeys.has(key)) continue;
        sentVodNickKeys.add(key);
        pairs.push([h, nick]);
      }
    };
    scan(c.videoChats);
    scan(c.previousVideoChats);
    if (pairs.length) {
      window.postMessage(
        { source: "cheese-comment-block", type: "vod-nicks", pairs },
        "*",
      );
    }
  }

  // VOD 채팅 응답(/videos/{no}/chats) 필터. content.js 응답을 새로 만들지 여부(changed) 반환.
  const VOD_CHAT_URL_RE =
    /^https:\/\/api\.chzzk\.naver\.com\/service\/v\d+\/videos\/\d+\/chats(?:[/?#]|$)/i;
  function isVodChatUrl(url) {
    return VOD_CHAT_URL_RE.test(String(url || ""));
  }
  // VOD 채팅 메시지의 userIdHash 추출. ⚠ 실측(vod.js): hash 는 m.userIdHash 가 아니라
  // m.profile(JSON 문자열) 안의 userIdHash 에 있는 경우가 많다. profile 우선, 없으면
  // m.userIdHash 폴백.
  function vodChatHash(m) {
    if (m?.profile) {
      try {
        const p =
          typeof m.profile === "string"
            ? originalJSONParse(m.profile)
            : m.profile;
        if (p?.userIdHash) return String(p.userIdHash);
      } catch {}
    }
    return m?.userIdHash ? String(m.userIdHash) : "";
  }
  function filterVodChat(data) {
    let changed = false;
    const c = data?.content;
    if (!c || typeof c !== "object") return false;
    if (Array.isArray(c.previousVideoChats)) {
      const before = c.previousVideoChats.length;
      c.previousVideoChats = c.previousVideoChats.filter(
        (m) => m && !chatBlockedHashes.has(vodChatHash(m)),
      );
      if (c.previousVideoChats.length !== before) changed = true;
    }
    if (Array.isArray(c.videoChats)) {
      const before = c.videoChats.length;
      c.videoChats = c.videoChats.filter(
        (m) => m && !chatBlockedHashes.has(vodChatHash(m)),
      );
      if (c.videoChats.length !== before) changed = true;
    }
    return changed;
  }

  // 댓글 응답에서 (a) 차단 유저 댓글 제거 (b) commentId→user 맵 수집.
  // 반환: { changed, map:[{commentId,userIdHash,nickname}] }
  function processCommentPayload(payload) {
    const map = [];
    let changed = false;

    const walk = (arr) => {
      if (!Array.isArray(arr)) return arr;
      const kept = [];
      for (const item of arr) {
        const user = item?.user;
        const comment = item?.comment;
        const hash = user?.userIdHash;
        const commentId = comment?.commentId;
        if (hash && commentId != null) {
          map.push({
            commentId: String(commentId),
            userIdHash: String(hash),
            nickname: String(user?.userNickname || "").trim(),
            // 치지직 자체 차단 여부. true 면 content.js 가 그 댓글 DOM 을 '내가 차단한
            // 이용자' 플레이스홀더로 교체한다(다시보기는 치지직 프론트가 그리지만
            // 커뮤니티는 안 그려 원본이 노출됐다 → 양쪽 일관되게 우리가 처리).
            privateUserBlock: !!user?.privateUserBlock,
          });
        }
        // 차단 유저면 제거(대댓글 통째로 사라짐 — 원 댓글이 차단이면 스레드 제거).
        if (hash && blockedHashes.has(String(hash))) {
          changed = true;
          continue;
        }
        // 대댓글 재귀 필터.
        if (Array.isArray(item?.replyComments)) {
          const before = item.replyComments.length;
          item.replyComments = walk(item.replyComments);
          if (item.replyComments.length !== before) changed = true;
        }
        kept.push(item);
      }
      return kept;
    };

    const content = payload?.content;
    if (content) {
      if (Array.isArray(content.comments?.data)) {
        content.comments.data = walk(content.comments.data);
      }
      if (Array.isArray(content.bestComments)) {
        content.bestComments = walk(content.bestComments);
      }
    }
    return { changed, map };
  }

  function emitMap(map) {
    if (!map.length) return;
    window.postMessage(
      { source: "cheese-comment-block", type: "comment-map", map },
      "*",
    );
  }

  // fetch 훅.
  window.fetch = async function (input, init) {
    const url =
      typeof input === "string"
        ? input
        : input && input.url
          ? input.url
          : "";
    const response = await originalFetch.apply(this, arguments);
    // 프로필 카드: 응답은 안 건드리고 데이터만 흘려보낸다.
    if (isProfileCardUrl(url)) {
      try {
        const data = originalJSONParse(await response.clone().text());
        emitProfile(data);
      } catch {}
      return response;
    }
    // VOD 채팅(fetch 경로): 차단 유저 메시지 제거 후 반환.
    if (isVodChatUrl(url) && chatBlockedHashes.size) {
      try {
        const data = originalJSONParse(await response.clone().text());
        if (filterVodChat(data)) {
          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } catch {}
      return response;
    }
    if (!isCommentApiUrl(url)) return response;
    try {
      const clone = response.clone();
      const text = await clone.text();
      const data = originalJSONParse(text);
      const { changed, map } = processCommentPayload(data);
      emitMap(map);
      if (changed) {
        const body = JSON.stringify(data);
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } catch {
      // 파싱 실패 시 원본 응답 그대로.
    }
    return response;
  };

  // XHR 훅(페이지가 XHR 로 댓글을 부를 수도 있음).
  const XHR = window.XMLHttpRequest;
  if (typeof XHR === "function") {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    // 네이티브 responseText/response getter(원본 응답 읽기용).
    const rtDesc = Object.getOwnPropertyDescriptor(
      XHR.prototype,
      "responseText",
    );
    const rDesc = Object.getOwnPropertyDescriptor(XHR.prototype, "response");
    XHR.prototype.open = function (method, url) {
      this.__cheeseCommentUrl = isCommentApiUrl(url) ? String(url) : "";
      this.__cheeseProfileUrl = isProfileCardUrl(url) ? String(url) : "";
      this.__cheeseVodChatUrl = isVodChatUrl(url) ? String(url) : "";
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      if (this.__cheeseProfileUrl) {
        const xhr = this;
        xhr.addEventListener("load", function () {
          try {
            if (xhr.responseText) emitProfile(originalJSONParse(xhr.responseText));
          } catch {}
        });
      }
      if (this.__cheeseVodChatUrl) {
        // ⚠ addEventListener("load") 로 응답을 교체하면, 페이지 핸들러가 먼저 실행돼 원본을
        // 읽어버려 소용없다(실측: 필터 changed:true 인데도 화면엔 그대로). 대신 이 인스턴스의
        // responseText/response getter 를 '미리' 지연 필터 방식으로 교체한다 — 누가 언제
        // 읽든 최초 접근 시 원본을 읽어 필터한 값을 캐시해 반환한다.
        const xhr = this;
        let cachedText = null; // 필터된 응답 문자열 캐시(1회 계산).
        let cachedData = null;
        const computeFiltered = () => {
          if (cachedText !== null) return;
          try {
            const raw = rtDesc.get.call(xhr); // 원본 responseText
            if (!raw) return;
            const data = originalJSONParse(raw);
            if (chatBlockedHashes.size && filterVodChat(data)) {
              cachedData = data;
              cachedText = JSON.stringify(data);
            } else {
              cachedText = raw; // 변경 없음 → 원본 그대로
              cachedData = data;
            }
          } catch {
            cachedText = ""; // 실패 시 빈 값 방지: 원본으로 폴백
            try {
              cachedText = rtDesc.get.call(xhr);
            } catch {}
          }
        };
        Object.defineProperty(xhr, "responseText", {
          configurable: true,
          get() {
            if (xhr.readyState !== 4) return rtDesc.get.call(xhr);
            computeFiltered();
            return cachedText != null ? cachedText : rtDesc.get.call(xhr);
          },
        });
        Object.defineProperty(xhr, "response", {
          configurable: true,
          get() {
            if (xhr.readyState !== 4) return rDesc.get.call(xhr);
            // responseType 이 "json" 이면 객체, 아니면 문자열.
            if (xhr.responseType === "json") {
              computeFiltered();
              return cachedData != null ? cachedData : rDesc.get.call(xhr);
            }
            computeFiltered();
            return cachedText != null ? cachedText : rDesc.get.call(xhr);
          },
        });
      }
      if (this.__cheeseCommentUrl) {
        const xhr = this;
        xhr.addEventListener("load", function () {
          try {
            const raw = xhr.responseText;
            if (!raw) return;
            const data = originalJSONParse(raw);
            const { changed, map } = processCommentPayload(data);
            emitMap(map);
            if (changed) {
              const filtered = JSON.stringify(data);
              Object.defineProperty(xhr, "responseText", {
                configurable: true,
                get: () => filtered,
              });
              Object.defineProperty(xhr, "response", {
                configurable: true,
                get: () => (xhr.responseType === "json" ? data : filtered),
              });
            }
          } catch {
            // 원본 응답 유지.
          }
        });
      }
      return send.apply(this, arguments);
    };
  }

  // 로드 완료를 알려 content.js 가 초기 차단 목록을 보내게 한다.
  window.postMessage({ source: "cheese-comment-block", type: "ready" }, "*");
})();
