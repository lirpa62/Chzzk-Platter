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

  // 배치의 areas 를 읽어 각 슬롯이 차지하는 행·열 범위를 구한다.
  function slotSpans(layout) {
    const grid = layout.areas.map((row) =>
      row.replace(/"/g, "").trim().split(/\s+/),
    );
    const spans = {};
    grid.forEach((row, ri) =>
      row.forEach((slot, ci) => {
        if (slot === ".") return;
        const cur = spans[slot] || { r0: ri, r1: ri, c0: ci, c1: ci };
        cur.r0 = Math.min(cur.r0, ri);
        cur.r1 = Math.max(cur.r1, ri);
        cur.c0 = Math.min(cur.c0, ci);
        cur.c1 = Math.max(cur.c1, ci);
        spans[slot] = cur;
      }),
    );
    return { grid, spans, rows: grid.length, cols: grid[0].length };
  }

  // 모든 칸이 정확히 16:9 가 되는 열 너비 비율을 푼다.
  //
  // ⚠ 레터박스(검은 여백)를 없애려면 '칸 안에 16:9 를 끼워 넣는' 것으로는 안 된다.
  //   칸 자체가 16:9 여야 영상이 칸을 꽉 채운다. 행 높이를 모두 1 로 두고 각 칸의
  //   16:9 조건에서 열 너비를 역산한다. N 행을 병합한 칸은 너비가 (16/9)*N 이다.
  //   해가 없으면 null 을 돌려주고, 부르는 쪽이 기존 fr 값으로 넘어간다.
  function solveTracks(layout) {
    const { spans, rows, cols } = slotSpans(layout);
    const R = 16 / 9;
    const widths = new Array(cols).fill(null);
    // 한 열만 차지하는 칸이 그 열의 너비를 결정한다.
    for (const span of Object.values(spans)) {
      if (span.c0 !== span.c1) continue;
      const need = R * (span.r1 - span.r0 + 1);
      if (widths[span.c0] !== null && Math.abs(widths[span.c0] - need) > 1e-6) {
        return null; // 같은 열에 서로 다른 너비를 요구하는 칸이 있다
      }
      widths[span.c0] = need;
    }
    if (widths.some((w) => w === null)) return null;
    // 여러 열을 병합한 칸도 16:9 인지 확인한다.
    for (const span of Object.values(spans)) {
      if (span.c0 === span.c1) continue;
      let sum = 0;
      for (let c = span.c0; c <= span.c1; c += 1) sum += widths[c];
      if (Math.abs(sum - R * (span.r1 - span.r0 + 1)) > 1e-6) return null;
    }
    return {
      columns: widths.map((w) => `${w.toFixed(6)}fr`).join(" "),
      rows: new Array(rows).fill("1fr").join(" "),
      // 격자 전체가 지켜야 할 가로:세로. 스테이지는 이 비율로 잡아야 칸이 16:9 가 된다.
      ratio: widths.reduce((a, b) => a + b, 0) / rows,
    };
  }

  const api = {
    LAYOUTS,
    SLOTS,
    layoutsFor,
    layoutById,
    stageStyle,
    slotSpans,
    solveTracks,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewLayouts = api;
})();
