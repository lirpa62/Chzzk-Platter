const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/multiviewVodChat.js", "utf8");
const badgeSource = fs.readFileSync("src/achievementBadgeMap.js", "utf8");
const context = { AbortController, DOMException, URL, setTimeout, clearTimeout, Date, Math };
context.globalThis = context;
vm.runInNewContext(badgeSource, context);
vm.runInNewContext(source, context);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const response = (content, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ content }),
});

async function main() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    const cursor = Number(parsed.searchParams.get("playerMessageTime"));
    calls.push({ parsed, options, cursor });
    if (cursor === 0) {
      return response({
        videoChats: [
          { messageId: "a", playerMessageTime: 8000, messageTime: 1790279186543, profile: JSON.stringify({ nickname: "가", userRoleCode: "streamer", verifiedMark: true, badge: { imageUrl: "https://nng-phinf.pstatic.net/badge.png", name: "방송 배지" }, activityBadges: [{ badge: { imageUrl: "https://nng-phinf.pstatic.net/activity.png", badgeId: "활동" } }], viewerBadges: [{ badge: { imageUrl: "https://nng-phinf.pstatic.net/viewer.png", badgeId: "시청자" } }], streamingProperty: { nicknameColor: { colorCode: "4659CF" }, subscription: { badge: { imageUrl: "https://nng-phinf.pstatic.net/subscription.png" } }, activatedAchievementBadgeIds: ["2026chzzkopencup_1"] } }), content: "먼저" },
          { messageId: "b", playerMessageTime: 9000, messageTime: 1790279187543, profile: JSON.stringify({ nickname: "나", userRoleCode: "manager" }), extras: JSON.stringify({ emojis: { d_42: "https://nng-phinf.pstatic.net/emoji.png" } }), content: "재생 중 {:d_42:}" },
          { messageId: "b", playerMessageTime: 9000, messageTime: 1790279187543, profile: JSON.stringify({ nickname: "나", userRoleCode: "manager" }), content: "재생 중 {:d_42:}" },
          { messageId: "private", playerMessageTime: 9500, content: "숨김", privateUserBlock: true },
          { messageId: "future", playerMessageTime: 11000, content: "조금 뒤" },
        ],
        nextPlayerMessageTime: 12000,
      });
    }
    if (cursor === 15000) {
      return response({
        videoChats: [
          { messageId: "seek-a", playerMessageTime: 59000, content: "이동한 곳" },
          { messageId: "seek-b", playerMessageTime: 60000, content: "현재" },
        ],
        nextPlayerMessageTime: 62000,
      });
    }
    return response({ videoChats: [], nextPlayerMessageTime: cursor });
  };

  const session = context.CheeseMultiviewVodChat.createSession({ fetchImpl });
  assert.equal(session.start("12345", 10), true);
  await wait(240);

  assert.equal(calls[0].parsed.pathname, "/service/v1/videos/12345/chats");
  assert.equal(calls[0].parsed.searchParams.get("playerMessageTime"), "0");
  assert.equal(calls[0].parsed.searchParams.get("previousVideoChatSize"), "50");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(session.visible(10).some((item) => item.text === "조금 뒤"), false);
  assert.equal(session.visible(10).some((item) => item.text === "숨김"), false);
  assert.equal(session.visible(10).filter((item) => item.id === "b").length, 1);
  const streamer = session.visible(10).find((item) => item.id === "a");
  assert.equal(streamer.nickname, "가", "JSON 문자열 profile에서 닉네임을 읽는다");
  assert.deepEqual(Array.from(streamer.roles), ["streamer", "partner"]);
  assert.equal(streamer.badges[0].url, "https://nng-phinf.pstatic.net/badge.png");
  assert.equal(streamer.nicknameColor, "#4659CF");
  assert.deepEqual(Array.from(streamer.badges, (badge) => badge.label), [
    "방장", "활동", "구독 배지", "시청자", "파트너", "업적 배지",
  ]);
  assert.equal(streamer.badges.at(-2).position, "after");
  assert.equal(streamer.badges.at(-1).url, context.CheeseAchievementBadgeMap["2026chzzkopencup_1"]);
  assert.equal("titleName" in streamer, false, "닉네임 옆 제목 칩에 쓰던 데이터는 제거");
  const manager = session.visible(10).find((item) => item.id === "b");
  assert.equal(manager.nickname, "나");
  assert.deepEqual(Array.from(manager.roles), ["manager"]);
  assert.equal(manager.emojis.d_42, "https://nng-phinf.pstatic.net/emoji.png");
  assert.equal(session.broadcastTimeAt(9), 1790279187543);
  assert.equal(session.hasBroadcastTimes(), true);
  assert.equal(session.visible(11).some((item) => item.text === "조금 뒤"), true);
  const formatTime = context.CheeseMultiviewVodChat.formatBroadcastTime;
  const localTime = new Date(2024, 0, 1, 13, 5).getTime();
  assert.equal(formatTime(localTime, "24h"), "13:05");
  assert.equal(formatTime(localTime, "12h-en"), "PM 1:05");
  assert.equal(formatTime(localTime, "12h-ko", true), "2024.01.01 오후 1:05");

  const quietSession = context.CheeseMultiviewVodChat.createSession({
    fetchImpl: async (url) => {
      const cursor = Number(new URL(url).searchParams.get("playerMessageTime"));
      if (cursor === 11000) {
        return response({
          videoChats: [
            { messageId: "quiet-old", playerMessageTime: 1000, content: "오래된 채팅" },
            { messageId: "quiet-new", playerMessageTime: 55000, content: "최근 채팅" },
          ],
          nextPlayerMessageTime: 60000,
        });
      }
      return response({ videoChats: [], nextPlayerMessageTime: cursor });
    },
  });
  quietSession.start("77777", 56);
  await wait(240);
  for (let second = 70; second <= 370; second += 25)
    quietSession.updatePlayback(second);
  const quietVisible = quietSession.visible(370);
  assert.deepEqual(Array.from(quietVisible, (item) => item.id), ["quiet-old", "quiet-new"],
    "새 채팅이 없는 동안 오래된 줄은 재생 시간만으로 제거하지 않는다");
  assert.deepEqual(Array.from(quietSession.visible(370, 1), (item) => item.id), ["quiet-new"],
    "새 채팅이 쌓일 때는 표시 개수 제한으로 가장 오래된 줄부터 밀려난다");
  quietSession.stop();

  const normalize = context.CheeseMultiviewVodChat.normalizeMessage;
  assert.equal(context.CheeseMultiviewVodChat.setNicknameColorCodes({
    content: [{ code: "NICK_BLUE", colorCode: "#4659CF" }, { code: "NICK_GREEN", color: "23815A" }, { code: "NICK_RGB", color: "rgb(70, 89, 207)" }],
  }), true);
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("NICK_BLUE"), "#4659CF");
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("NICK_GREEN"), "#23815A");
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("NICK_RGB"), "rgb(70, 89, 207)");
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("CC000"), "");
  const codedNickname = normalize({
    playerMessageTime: 1000,
    profile: JSON.stringify({ nickname: "컬러", streamingProperty: { nicknameColor: { colorCode: "NICK_BLUE" } } }),
    content: "테스트",
  });
  assert.equal(codedNickname.nicknameColor, "#4659CF");
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor(codedNickname.nicknameColorCode), "#4659CF");
  const fallbackColorNickname = normalize({
    playerMessageTime: 1000,
    profile: JSON.stringify({ nickname: "대체 색", nicknameColor: { colorCode: "NICK_GREEN" } }),
    content: "테스트",
  });
  assert.equal(fallbackColorNickname.nicknameColor, "#23815A");
  assert.equal(context.CheeseMultiviewVodChat.setNicknameColorCodes({
    codeList: [{
      code: "CC004",
      darkRgbValue: "#EA723D",
      lightRgbValue: "#EA642F",
      availableScope: "CHEATKEY",
    }],
  }), true);
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("CC004"), "#EA642F");
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("CC004", "dark"), "#EA723D");
  assert.equal(context.CheeseMultiviewVodChat.setNicknameColorCodes({
    codeList: [
      {
        code: "CC004",
        darkRgbValue: "#EA723D",
        lightRgbValue: "#EA642F",
        availableScope: "CHEATKEY",
      },
      {
        code: "SH003",
        darkRgbValue: "#C9CEDC",
        lightRgbValue: "#2E3033",
        effectType: "HIGHLIGHT",
        effectValue: {
          darkRgbBackgroundValue: "#11411B",
          lightRgbBackgroundValue: "#D5EDD9",
        },
      },
      {
        code: "SG003",
        darkRgbValue: "#6BE5AA",
        lightRgbValue: "#05D771",
        effectType: "GRADATION",
        effectValue: {
          direction: "RIGHT",
          darkRgbEndValue: "#5DA8EC",
          lightRgbEndValue: "#3596ED",
        },
      },
      {
        code: "SS001",
        darkRgbValue: "#00000000",
        lightRgbValue: "#FFFFFF00",
        effectType: "STEALTH",
      },
    ],
  }), true);
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameStyle("SH003", "light"),
    "color:#2E3033;background-color:#D5EDD9;border-radius:3px;padding:0 2px;");
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameStyle("SH003", "dark"),
    "color:#C9CEDC;background-color:#11411B;border-radius:3px;padding:0 2px;");
  assert.match(context.CheeseMultiviewVodChat.resolveNicknameStyle("SG003", "light"),
    /linear-gradient\(to right, #05D771, #3596ED\)/);
  assert.match(context.CheeseMultiviewVodChat.resolveNicknameStyle("SG003", "dark"),
    /linear-gradient\(to right, #6BE5AA, #5DA8EC\)/);
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("SS001"), "#FFFFFF00",
    "투명도가 포함된 8자리 API 색상도 보존");
  const chzzkColorNickname = normalize({
    playerMessageTime: 1000,
    profile: JSON.stringify({
      nickname: "실제 색상 코드",
      streamingProperty: { nicknameColor: { colorCode: "CC004" } },
    }),
    content: "테스트",
  });
  assert.equal(chzzkColorNickname.nicknameColorCode, "CC004");
  assert.equal(chzzkColorNickname.nicknameColor, "#EA642F");
  const managerWithTitleColor = normalize({
    playerMessageTime: 1000,
    profile: JSON.stringify({
      nickname: "관리자",
      userRoleCode: "streaming_chat_manager",
      title: { color: "#749FFE" },
      streamingProperty: { nicknameColor: { colorCode: "SG003" } },
    }),
    content: "일반 채팅",
  });
  assert.equal(managerWithTitleColor.nicknameTitleColor, "#749FFE",
    "관리자는 profile title color를 닉네임 색상으로 사용");
  assert.equal(managerWithTitleColor.nicknameMessageColor, "#749FFE",
    "매니저 닉네임의 title 색상을 채팅 내용에도 전달");
  const streamerWithTitleColor = normalize({
    playerMessageTime: 1000,
    profile: JSON.stringify({ nickname: "방장", userRoleCode: "streamer", title: { color: "#2269D0" } }),
    content: "방송 중",
  });
  assert.equal(streamerWithTitleColor.nicknameMessageColor, "#2269D0",
    "방장 닉네임의 title 색상을 채팅 내용에도 전달");
  const nonManagerTitle = normalize({
    playerMessageTime: 1000,
    profile: JSON.stringify({ nickname: "시청자", title: { color: "#749FFE" } }),
    content: "일반 채팅",
  });
  assert.equal(nonManagerTitle.nicknameTitleColor, "", "일반 시청자의 title 색상은 사용하지 않음");
  assert.equal(nonManagerTitle.nicknameMessageColor, "", "일반 시청자 메시지에는 역할 색상을 전달하지 않음");

  const defaultPalette = [
    "#2269d0", "#4659cf", "#842eaa", "#5ca314", "#b44ba2",
    "#b44ba2", "#6433c2", "#2a9b12", "#0b9f82", "#9836b8",
    "#de355c", "#10a391", "#e84e2d", "#d73181", "#219fc7",
  ];
  const paletteRows = [{
    messageId: "special-cc000",
    playerMessageTime: 1000,
    messageTypeCode: 11,
    profile: JSON.stringify({ nickname: "특수 메시지", streamingProperty: { nicknameColor: { colorCode: "CC000" } } }),
    extras: JSON.stringify({ month: 1, tierNo: 1 }),
  }];
  for (let index = 0; index < 17; index += 1) {
    paletteRows.push({
      messageId: `palette-${index}`,
      playerMessageTime: 1000,
      profile: JSON.stringify({ nickname: `기본색${index}`, streamingProperty: { nicknameColor: { colorCode: "CC000" } } }),
      content: "일반 채팅",
    });
  }
  paletteRows.push({
    messageId: "palette-repeat",
    playerMessageTime: 1000,
    profile: JSON.stringify({ nickname: "기본색0", streamingProperty: { nicknameColor: { colorCode: "CC000" } } }),
    content: "같은 닉네임 재등장",
  });
  const paletteSession = context.CheeseMultiviewVodChat.createSession({
    fetchImpl: async (url) => {
      const cursor = Number(new URL(url).searchParams.get("playerMessageTime"));
      if (cursor === 0) return response({ videoChats: paletteRows, nextPlayerMessageTime: 2000 });
      if (cursor === 15000) return response({
        videoChats: [
          {
            messageId: "palette-seek-existing",
            playerMessageTime: 60000,
            profile: JSON.stringify({ nickname: "기본색0", streamingProperty: { nicknameColor: { colorCode: "CC000" } } }),
            content: "시킹 후 기존 닉네임",
          },
          {
            messageId: "palette-seek-new",
            playerMessageTime: 60000,
            profile: JSON.stringify({ nickname: "시킹 후 신규", streamingProperty: { nicknameColor: { colorCode: "CC000" } } }),
            content: "시킹 후 새 닉네임",
          },
        ],
        nextPlayerMessageTime: 62000,
      });
      return response({ videoChats: [], nextPlayerMessageTime: cursor });
    },
  });
  paletteSession.start("88888", 1);
  await wait(260);
  let paletteVisible = paletteSession.visible(2);
  assert.equal(paletteVisible.find((item) => item.id === "palette-0").nicknameFallbackColor, defaultPalette[0]);
  assert.equal(paletteVisible.find((item) => item.id === "palette-14").nicknameFallbackColor, defaultPalette[14]);
  assert.equal(paletteVisible.find((item) => item.id === "palette-15").nicknameFallbackColor, defaultPalette[0],
    "팔레트를 모두 사용하면 첫 색부터 순환");
  assert.equal(paletteVisible.find((item) => item.id === "palette-16").nicknameFallbackColor, defaultPalette[1]);
  assert.equal(paletteVisible.find((item) => item.id === "palette-repeat").nicknameFallbackColor, defaultPalette[0],
    "같은 다시보기의 같은 닉네임은 재등장해도 배정 색을 유지");
  assert.equal(paletteVisible.find((item) => item.id === "special-cc000").nicknameFallbackColor, "",
    "특수 채팅은 기본 색상 팔레트 인덱스를 소비하지 않음");
  paletteSession.updatePlayback(60, { seeking: true });
  paletteSession.updatePlayback(60);
  await wait(260);
  paletteVisible = paletteSession.visible(60);
  assert.equal(paletteVisible.find((item) => item.id === "palette-seek-existing").nicknameFallbackColor, defaultPalette[0],
    "시킹 후에도 기존 닉네임 색을 유지");
  assert.equal(paletteVisible.find((item) => item.id === "palette-seek-new").nicknameFallbackColor, defaultPalette[2],
    "시킹 후 새 닉네임에는 다음 순번 색을 배정");
  paletteSession.stop();
  paletteSession.start("88888", 60);
  await wait(260);
  paletteVisible = paletteSession.visible(60);
  assert.equal(paletteVisible.find((item) => item.id === "palette-seek-existing").nicknameFallbackColor, defaultPalette[0],
    "같은 다시보기의 채팅을 다시 선택해도 기존 닉네임 색을 유지");
  assert.equal(paletteVisible.find((item) => item.id === "palette-seek-new").nicknameFallbackColor, defaultPalette[2]);
  paletteSession.start("99999", 60);
  await wait(260);
  paletteVisible = paletteSession.visible(60);
  assert.equal(paletteVisible.find((item) => item.id === "palette-seek-existing").nicknameFallbackColor, defaultPalette[0],
    "다른 다시보기는 별도의 색상 배정 순서로 시작");
  assert.equal(paletteVisible.find((item) => item.id === "palette-seek-new").nicknameFallbackColor, defaultPalette[1]);
  paletteSession.stop();
  assert.equal(context.CheeseMultiviewVodChat.setNicknameColorCodes({
    content: { NICK_RED: { color: "#f00" } },
  }), true);
  assert.equal(context.CheeseMultiviewVodChat.resolveNicknameColor("NICK_RED"), "#f00");
  const subscription = normalize({
    playerMessageTime: 1000,
    messageTypeCode: 11,
    profile: JSON.stringify({ nickname: "구독자" }),
    extras: JSON.stringify({ month: 3, tierNo: 2, tierName: "꽁하" }),
  });
  assert.deepEqual({ ...subscription.donation }, {
    kind: "subscription", month: 3, tier: 2, tierName: "꽁하",
  });
  const gift = normalize({
    playerMessageTime: 1000,
    messageTypeCode: 12,
    profile: JSON.stringify({ nickname: "선물자" }),
    extras: JSON.stringify({ giftTierNo: 2, giftTierName: "아코", quantity: 3, receiverNickname: "받는이" }),
  });
  assert.deepEqual({ ...gift.donation }, {
    kind: "gift", tier: 2, tierName: "아코", quantity: 3, receiverNickname: "받는이",
  });
  assert.equal(normalize({
    playerMessageTime: 1000,
    messageTypeCode: 10,
    uid: "anonymous",
    extras: JSON.stringify({ donationType: "CHAT", payAmount: 1000 }),
  }).nickname, "익명의 후원자");
  const mission = normalize({
    playerMessageTime: 1000,
    messageTypeCode: 10,
    profile: JSON.stringify({ nickname: "후원자" }),
    extras: JSON.stringify({ donationType: "MISSION_PARTICIPATION", payAmount: 5000 }),
  });
  assert.equal(mission.donation.kind, "mission");
  assert.equal(mission.donation.amount, 5000);
  assert.equal(mission.donation.tone, "violet");
  assert.equal(normalize({
    playerMessageTime: 1000,
    messageTypeCode: 10,
    extras: JSON.stringify({ donationType: "CHAT", payAmount: 100000 }),
    content: "고액 후원",
  }).donation.tone, "green");
  for (const [amount, tone] of [[0, "neutral"], [10000, "cyan"], [500000, "camel"], [1000000, "brick"]]) {
    const event = normalize({
      playerMessageTime: 1000,
      messageTypeCode: 10,
      extras: JSON.stringify({ donationType: "CHAT", payAmount: amount }),
      content: "후원",
    });
    assert.equal(event.donation.tone, tone, `${amount} 치즈는 ${tone} 등급`);
  }
  assert.equal(normalize({
    playerMessageTime: 1000,
    messageTypeCode: 10,
    extras: JSON.stringify({ donationType: "CHAT", payAmount: 1000 }),
  }).text, "", "본문이 없어도 후원 이벤트는 표시한다");

  session.updatePlayback(60, { seeking: true });
  session.updatePlayback(60);
  await wait(240);
  assert.ok(calls.some((call) => call.cursor === 15000), "seek 이후 새 재생 위치의 커서를 요청");
  assert.equal(session.visible(60).some((item) => item.text === "현재"), true);
  assert.equal(session.visible(60).some((item) => item.text === "재생 중"), false);

  session.stop();
  assert.equal(session.snapshot().status, "idle");

  const unauthorized = context.CheeseMultiviewVodChat.createSession({
    fetchImpl: async () => response({}, 401),
  });
  unauthorized.start("987", 0);
  await wait(10);
  assert.match(unauthorized.snapshot().error, /로그인/);
  unauthorized.stop();

  const deferred = [];
  const staleSafe = context.CheeseMultiviewVodChat.createSession({
    fetchImpl: async (url) => new Promise((resolve) => {
      deferred.push({ cursor: Number(new URL(url).searchParams.get("playerMessageTime")), resolve });
    }),
  });
  staleSafe.start("555", 100);
  await wait(10);
  staleSafe.updatePlayback(200, { seeking: true });
  staleSafe.updatePlayback(200);
  await wait(220);
  assert.equal(deferred.length, 2, "seek가 새 요청 세대를 시작");
  deferred[0].resolve(response({ videoChats: [
    { messageId: "stale", playerMessageTime: 100000, content: "이전 위치" },
  ], nextPlayerMessageTime: 101000 }));
  deferred[1].resolve(response({ videoChats: [
    { messageId: "fresh", playerMessageTime: 200000, content: "이동한 위치" },
  ], nextPlayerMessageTime: 201000 }));
  await wait(10);
  assert.equal(staleSafe.visible(200).some((item) => item.text === "이전 위치"), false);
  assert.equal(staleSafe.visible(200).some((item) => item.text === "이동한 위치"), true);
  staleSafe.stop();

  console.log("멀티뷰 다시보기 채팅 세션 테스트 통과");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
