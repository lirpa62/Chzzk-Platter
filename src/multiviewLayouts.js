// 치즈 플래터 - 멀티뷰 배치 정의
// 메인 1개 + 보조 최대 5개. 각 배치는 CSS grid 로 표현한다.
//
// ⚠ 채팅은 '레이아웃의 반대편'에 둔다. 보조 화면이 오른쪽에 있으면 채팅은
//   왼쪽(또는 아래), 왼쪽에 있으면 오른쪽(또는 아래)이다. 보조 화면과 채팅이
//   같은 쪽에 몰리면 메인이 한쪽으로 심하게 밀린다.
(() => {
  "use strict";

  // areas: grid-template-areas 문자열. m=메인, a~e=보조.
  // chat: 채팅을 놓을 수 있는 자리(앞에 오는 것이 기본값).
  const LAYOUTS = [
    {
      id: "right-1",
      label: "오른쪽 1",
      aux: 1,
      columns: "3fr 1fr",
      rows: "1fr",
      areas: ['"m a"'],
      chat: ["left", "bottom"],
    },
    {
      id: "left-1",
      label: "왼쪽 1",
      aux: 1,
      columns: "1fr 3fr",
      rows: "1fr",
      areas: ['"a m"'],
      chat: ["right", "bottom"],
    },
    {
      id: "bottom-1",
      label: "아래 1",
      aux: 1,
      columns: "1fr",
      rows: "3fr 1fr",
      areas: ['"m"', '"a"'],
      chat: ["right", "left"],
    },
    {
      id: "top-1",
      label: "위 1",
      aux: 1,
      columns: "1fr",
      rows: "1fr 3fr",
      areas: ['"a"', '"m"'],
      chat: ["right", "left"],
    },
    {
      id: "right-2",
      label: "오른쪽 2",
      aux: 2,
      columns: "3fr 1fr",
      rows: "1fr 1fr",
      areas: ['"m a"', '"m b"'],
      chat: ["left", "bottom"],
    },
    {
      id: "left-2",
      label: "왼쪽 2",
      aux: 2,
      columns: "1fr 3fr",
      rows: "1fr 1fr",
      areas: ['"a m"', '"b m"'],
      chat: ["right", "bottom"],
    },
    {
      id: "right-bottom",
      label: "오른쪽+아래",
      aux: 2,
      columns: "3fr 1fr",
      rows: "3fr 1fr",
      areas: ['"m a"', '"b b"'],
      chat: ["left"],
    },
    {
      id: "left-bottom",
      label: "왼쪽+아래",
      aux: 2,
      columns: "1fr 3fr",
      rows: "3fr 1fr",
      areas: ['"a m"', '"b b"'],
      chat: ["right"],
    },
    {
      id: "right-top",
      label: "오른쪽+위",
      aux: 2,
      columns: "3fr 1fr",
      rows: "1fr 3fr",
      areas: ['"b b"', '"m a"'],
      chat: ["left"],
    },
    {
      id: "left-top",
      label: "왼쪽+위",
      aux: 2,
      columns: "1fr 3fr",
      rows: "1fr 3fr",
      areas: ['"b b"', '"a m"'],
      chat: ["right"],
    },
    {
      id: "right-3",
      label: "오른쪽 3",
      aux: 3,
      columns: "3fr 1fr",
      rows: "1fr 1fr 1fr",
      areas: ['"m a"', '"m b"', '"m c"'],
      chat: ["left", "bottom"],
    },
    {
      id: "left-3",
      label: "왼쪽 3",
      aux: 3,
      columns: "1fr 3fr",
      rows: "1fr 1fr 1fr",
      areas: ['"a m"', '"b m"', '"c m"'],
      chat: ["right", "bottom"],
    },
    {
      id: "grid-2x2",
      label: "그리드 2×2",
      aux: 3,
      even: true,
      columns: "1fr 1fr",
      rows: "1fr 1fr",
      areas: ['"m a"', '"b c"'],
      chat: ["right", "left"],
    },
    {
      id: "right-4",
      label: "오른쪽 4",
      aux: 4,
      columns: "3fr 1fr",
      rows: "repeat(4, 1fr)",
      areas: ['"m a"', '"m b"', '"m c"', '"m d"'],
      chat: ["left"],
    },
    {
      id: "left-4",
      label: "왼쪽 4",
      aux: 4,
      columns: "1fr 3fr",
      rows: "repeat(4, 1fr)",
      areas: ['"a m"', '"b m"', '"c m"', '"d m"'],
      chat: ["right"],
    },
    {
      id: "grid-3x2-5",
      label: "그리드 3×2",
      aux: 4,
      even: true,
      columns: "repeat(3, 1fr)",
      rows: "1fr 1fr",
      areas: ['"m a b"', '"c d ."'],
      chat: ["right", "left"],
    },
    {
      id: "right-5",
      label: "오른쪽 5",
      aux: 5,
      columns: "3fr 1fr",
      rows: "repeat(5, 1fr)",
      areas: ['"m a"', '"m b"', '"m c"', '"m d"', '"m e"'],
      chat: ["left"],
    },
    {
      id: "grid-3x2",
      label: "그리드 3×2",
      aux: 5,
      even: true,
      columns: "repeat(3, 1fr)",
      rows: "1fr 1fr",
      areas: ['"m a b"', '"c d e"'],
      chat: ["right", "left"],
    },
  ];

  const SLOTS = ["m", "a", "b", "c", "d", "e"];

  // 고른 채널 수(메인 포함)에 맞는 배치만 돌려준다.
  function layoutsFor(count) {
    const aux = Math.max(0, Number(count) - 1);
    return LAYOUTS.filter((l) => l.aux === aux);
  }

  function layoutById(id) {
    return LAYOUTS.find((l) => l.id === id) || null;
  }

  // 배치 + 채팅 위치 → 바깥 컨테이너에 줄 스타일.
  // ⚠ 채팅을 grid 안에 넣지 않는다. 프레임 격자는 그대로 두고 바깥에서
  //   flex 로 감싸야 채팅을 접었다 폈을 때 격자가 다시 계산되지 않는다.
  function stageStyle(layout, chatSide) {
    const side = layout?.chat?.includes(chatSide)
      ? chatSide
      : layout?.chat?.[0];
    const direction =
      side === "left"
        ? "row-reverse"
        : side === "bottom"
          ? "column"
          : side === "top"
            ? "column-reverse"
            : "row";
    return { direction, side: side || "right" };
  }

  const api = { LAYOUTS, SLOTS, layoutsFor, layoutById, stageStyle };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewLayouts = api;
})();
