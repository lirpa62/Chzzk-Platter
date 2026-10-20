// 치즈 플래터 - 멀티뷰 배치 정의
// 메인 1개 + 보조 최대 5개. 각 배치는 CSS grid 로 표현한다.
//
// 일반 배치는 채팅을 프레임 격자 바깥에 둔다. chatTop 배치는 채팅 열 위에
// 마지막 보조 영상을 올리고, chatInsetOption 배치는 '빈 칸' 을 고르면 격자의 빈 칸에
// 채팅을 둔다. 둘 다 프레임 DOM은 그대로 둔 채 스테이지 Grid로 배치한다.
(() => {
  "use strict";

  // areas: grid-template-areas 문자열. m=메인, a~e=보조.
  // chat: 채팅 기본 자리(앞에 오는 것이 기본값). 일반 배치는 CHAT_SIDES 전체,
  //   chatTop 배치는 영상이 채팅 열 위에 있어야 하므로 좌/우만 허용한다.
  //   chatInsetOption 배치는 여기에 '빈 칸'(CHAT_INSET_SIDE)이 더해진다.
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
      // ⚠ 메인을 세로로 눌러 담는 L자 배치(오른쪽+아래 등)는 16:9 해가 없어
      //   어떤 칸이든 레터박스가 생긴다. 같은 3채널을 레터박스 없이 담는
      //   아래 2 / 위 2 로 대신한다.
      id: "bottom-2",
      label: "아래 2",
      aux: 2,
      columns: "1fr 1fr",
      rows: "1fr 1fr 1fr",
      // ⚠ 메인이 보조 열 수만큼 행을 차지해야 모든 칸이 16:9 가 된다. 한 행만
      //   차지하면 메인이 가로로 두 배라 세로도 두 배여야 해서 해가 없다.
      areas: ['"m m"', '"m m"', '"a b"'],
      chat: ["right", "left"],
    },
    {
      id: "top-2",
      label: "위 2",
      aux: 2,
      columns: "1fr 1fr",
      rows: "1fr 1fr 1fr",
      areas: ['"a b"', '"m m"', '"m m"'],
      chat: ["right", "left"],
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
      id: "bottom-3",
      label: "아래 3",
      aux: 3,
      columns: "repeat(3, 1fr)",
      rows: "repeat(4, 1fr)",
      areas: ['"m m m"', '"m m m"', '"m m m"', '"a b c"'],
      chat: ["right", "left"],
    },
    {
      id: "top-3",
      label: "위 3",
      aux: 3,
      columns: "repeat(3, 1fr)",
      rows: "repeat(4, 1fr)",
      areas: ['"a b c"', '"m m m"', '"m m m"', '"m m m"'],
      chat: ["right", "left"],
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
      // 메인을 옆 2 와 아래 2 로 두른다.
      id: "right2-bottom2",
      label: "오른쪽 2 + 아래 2",
      aux: 4,
      columns: "1fr 1fr 1fr",
      rows: "1fr 1fr 1fr",
      areas: ['"m m a"', '"m m b"', '"c d ."'],
      chat: ["left", "bottom"],
      chatInsetOption: true,
    },
    {
      id: "left2-bottom2",
      label: "왼쪽 2 + 아래 2",
      aux: 4,
      columns: "1fr 1fr 1fr",
      rows: "1fr 1fr 1fr",
      areas: ['"a m m"', '"b m m"', '". c d"'],
      chat: ["right", "bottom"],
      chatInsetOption: true,
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
      chatInsetOption: true,
    },
    {
      // 메인을 크게 두고 보조를 오른쪽 2 + 아래 3 으로 두른다.
      id: "right2-bottom3",
      label: "오른쪽 2 + 아래 3",
      aux: 5,
      columns: "repeat(3, 1fr)",
      rows: "1fr 1fr 1fr",
      areas: ['"m m a"', '"m m b"', '"c d e"'],
      chat: ["left", "bottom"],
    },
    {
      id: "left2-bottom3",
      label: "왼쪽 2 + 아래 3",
      aux: 5,
      columns: "repeat(3, 1fr)",
      rows: "1fr 1fr 1fr",
      areas: ['"a m m"', '"b m m"', '"c d e"'],
      chat: ["right", "bottom"],
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
      // 6채널인데 왼쪽 대칭이 빠져 있었다(right-5 만 있었다).
      id: "left-5",
      label: "왼쪽 5",
      aux: 5,
      columns: "1fr 3fr",
      rows: "repeat(5, 1fr)",
      areas: ['"a m"', '"b m"', '"c m"', '"d m"', '"e m"'],
      chat: ["right"],
    },
    {
      // 메인 하나를 크게 두고 보조 넷을 한쪽에 2×2 로 모은다.
      id: "right-2x2",
      label: "오른쪽 2×2",
      aux: 4,
      columns: "2fr 1fr 1fr",
      rows: "1fr 1fr",
      areas: ['"m a b"', '"m c d"'],
      chat: ["left", "bottom"],
    },
    {
      id: "left-2x2",
      label: "왼쪽 2×2",
      aux: 4,
      columns: "1fr 1fr 2fr",
      rows: "1fr 1fr",
      areas: ['"a b m"', '"c d m"'],
      chat: ["right", "bottom"],
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
  ];

  // 메인 + 보조. 기본 배치는 9채널(m·a~h)까지, 내 배치는 16채널(… i~l·n~p)까지.
  // x·y·z 는 채팅·손잡이 자리라 슬롯으로 쓰지 않는다.
  const SLOTS = ["m", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "n", "o", "p"];
  const MAX_CHANNELS_BUILTIN = 9;
  const MAX_CHANNELS_CUSTOM = 16;
  const POSITIONS = ["왼쪽", "가운데", "오른쪽"];
  const VERTICAL_POSITIONS = ["위", "가운데", "아래"];
  const SIDES = { right: "오른쪽", left: "왼쪽", top: "위", bottom: "아래" };
  const areaRow = (cells) => `"${cells.join(" ")}"`;

  // 일반 배치에서 채팅을 놓을 수 있는 자리.
  // ⚠ "top" 은 넣지 않는다. 위쪽 채팅은 영상보다 먼저 읽히는 자리라 시선이 튄다.
  const CHAT_SIDES = ["right", "left", "bottom"];
  // 빈 칸이 직사각형 하나로 남는 배치(chatInsetOption)에서 고를 수 있는 '빈 칸' 자리.
  // 기본값인지는 배치의 chat 순서가 정한다(앞에 오면 기본).
  const CHAT_INSET_SIDE = "inset";


  // 빈 칸(.)에 채팅을 기본으로 두는 배치. 바깥 자리(좌/우/아래)도 고를 수 있고,
  // 바깥을 고르면 빈 칸이 붙은 쪽 가장자리를 먼저 권한다.
  // ⚠ 빈 칸이 직사각형 하나로 모인 배치에만 쓴다(grid-template-areas 규칙).
  function chatInsetLayout(rows) {
    const cols = rows[0].length;
    const right = rows.some((row) => row[cols - 1] === ".");
    return {
      areas: rows.map(areaRow),
      chat: [CHAT_INSET_SIDE, right ? "right" : "left", right ? "left" : "right", "bottom"],
      chatInsetOption: true,
    };
  }

  // 작은 화면 한 칸의 위치를 세 가지로 고르는 2채널 배치.
  for (const side of ["right", "left", "top", "bottom"]) {
    for (let position = 0; position < 3; position += 1) {
      if (side === "top" || (side === "bottom" && position === 1) ||
          ((side === "right" || side === "left") && position !== 0)) continue;
      const grid = side === "right" || side === "left"
        ? Array.from({ length: 3 }, (_, row) =>
            side === "right"
              ? ["m", "m", row === position ? "a" : "."]
              : [row === position ? "a" : ".", "m", "m"],
          )
        : [
            Array.from({ length: 3 }, (_, col) =>
              side === "top" && col === position ? "a" : side === "top" ? "." : "m",
            ),
            ["m", "m", "m"],
            Array.from({ length: 3 }, (_, col) =>
              side === "bottom" && col === position ? "a" : side === "bottom" ? "." : "m",
            ),
          ];
      // 위/아래는 메인이 차지하는 두 행만 남긴다.
      const areas = side === "top" ? grid.slice(0, 2) : side === "bottom" ? grid.slice(1) : grid;
      LAYOUTS.push({
        id: `${side}-1-${position}`,
        label: `${SIDES[side]} 1 · ${(side === "right" || side === "left" ? VERTICAL_POSITIONS : POSITIONS)[position]}`,
        aux: 1,
        columns: "repeat(3, 1fr)",
        rows: `repeat(${areas.length}, 1fr)`,
        ...chatInsetLayout(areas),
        flexible: true,
      });
    }
  }

  // 두 화면이 한 줄에 있고, 셋째 화면의 가로 위치를 고르는 3채널 배치.
  for (const pairSide of ["top", "bottom"]) {
    for (let position = 0; position < 3; position += 1) {
      // '아래 2 · 메인 왼쪽/오른쪽' 은 지웠다(대신 '메인 위/아래 + 채팅 위 1').
      if (pairSide === "bottom" && position !== 1) continue;
      const single = [".", ".", ".", "."];
      single[position] = "m";
      single[position + 1] = "m";
      const pair = ["a", "a", "b", "b"];
      const rows = pairSide === "top" ? [pair, single] : [single, pair];
      // 가운데는 빈 칸이 양쪽으로 갈라져 채팅 한 칸을 만들 수 없다.
      LAYOUTS.push({
        id: `${pairSide}-2-single-${position}`,
        label: `${SIDES[pairSide]} 2 · 메인 ${POSITIONS[position]}`,
        aux: 2,
        columns: "repeat(4, 1fr)",
        rows: "1fr 1fr",
        ...(position === 1
          ? { areas: rows.map(areaRow), chat: ["right", "left"] }
          : chatInsetLayout(rows)),
        flexible: true,
      });
    }
  }

  // 메인을 위 한쪽 모서리에, 보조 두 칸을 반대쪽 열에 쌓고, 메인 아래 빈 칸에 채팅을 두는
  // 3채널 배치. 세 칸이 모두 16:9 이려면 2×2 같은 크기 칸일 수밖에 없다.
  for (const [id, label, rows] of [
    ["tl-1-right-2", "오른쪽 2 · 메인 위", [["m", "a"], [".", "b"]]],
    ["tr-1-left-2", "왼쪽 2 · 메인 위", [["a", "m"], ["b", "."]]],
  ]) {
    LAYOUTS.push({
      id,
      label,
      aux: 2,
      columns: "1fr 1fr",
      rows: "1fr 1fr",
      ...chatInsetLayout(rows),
      flexible: true,
    });
  }

  // 메인 옆에 두 칸, 위/아래에 한 칸을 두는 4채널 배치.
  for (const side of ["right", "left"]) {
    for (const edge of ["top", "bottom"]) {
      for (let position = 0; position < 3; position += 1) {
        if (edge === "top" || position === 1) continue;
        const strip = [".", ".", "."];
        strip[position] = "c";
        const body = side === "right"
          ? [["m", "m", "a"], ["m", "m", "b"]]
          : [["a", "m", "m"], ["b", "m", "m"]];
        const rows = edge === "top" ? [strip, ...body] : [...body, strip];
        LAYOUTS.push({
          id: `${side}-2-${edge}-1-${position}`,
          label: `${SIDES[side]} 2 + ${SIDES[edge]} 1 · ${POSITIONS[position]}`,
          aux: 3,
          columns: "repeat(3, 1fr)",
          rows: "repeat(3, 1fr)",
          ...chatInsetLayout(rows),
          flexible: true,
        });
      }
    }
  }

  // 위/아래 보조 화면을 한 줄로 놓고 메인은 나머지 높이를 쓴다.
  for (const count of [4, 5]) {
    const strip = SLOTS.slice(1, count + 1);
    const main = Array(count).fill("m");
    for (const edge of ["top", "bottom"]) {
      const body = Array.from({ length: count }, () => main);
      LAYOUTS.push({
        id: `${edge}-${count}`,
        label: `${SIDES[edge]} ${count}`,
        aux: count,
        columns: `repeat(${count}, 1fr)`,
        rows: `repeat(${count + 1}, 1fr)`,
        areas: (edge === "top" ? [strip, ...body] : [...body, strip]).map(areaRow),
        chat: ["right", "left"],
      });
    }
  }

  LAYOUTS.push(
    { id: "grid-2x3-5", label: "그리드 2×3", aux: 4,
      columns: "1fr 1fr", rows: "repeat(3, 1fr)",
      areas: ['"m a"', '"b c"', '"d ."'], chat: ["right", "left"], chatInsetOption: true,
      flexible: true },
    { id: "grid-2x3-6", label: "그리드 2×3", aux: 5,
      columns: "1fr 1fr", rows: "repeat(3, 1fr)",
      areas: ['"m a"', '"b c"', '"d e"'], chat: ["right", "left"] },
  );

  // 7~9채널 그리드.
  // 3×2·2×3 아래 줄 한 칸(왼쪽/오른쪽) + 남는 칸에 채팅(빈 칸 채팅).
  // ⚠ 7채널 '그리드 2×4 + 빈 칸 채팅' 은 '그리드 2×3 + 아래 1 · 왼쪽' 과 같은 모양이라 따로 두지 않는다.
  // '그리드 2×3 + 아래 1 · 오른쪽' 은 지웠다.
  for (const [base, rows, positions] of [
    ["3x2", [["m", "a", "b"], ["c", "d", "e"]], [0, 2]],
    ["2x3", [["m", "a"], ["b", "c"], ["d", "e"]], [0]],
  ]) {
    for (const position of positions) {
      const strip = Array(rows[0].length).fill(".");
      strip[position === 0 ? 0 : strip.length - 1] = "f";
      const grid = [...rows, strip];
      LAYOUTS.push({
        id: `grid-${base}-bottom-1-${position}`,
        label: `그리드 ${base.replace("x", "×")} + 아래 1 · ${POSITIONS[position]}`,
        aux: 6,
        columns: `repeat(${grid[0].length}, 1fr)`,
        rows: `repeat(${grid.length}, 1fr)`,
        ...chatInsetLayout(grid),
        flexible: true,
      });
    }
  }
  LAYOUTS.push(
    { id: "grid-3x3-8", label: "그리드 3×3", aux: 7,
      columns: "repeat(3, 1fr)", rows: "repeat(3, 1fr)",
      ...chatInsetLayout([["m", "a", "b"], ["c", "d", "e"], ["f", "g", "."]]), flexible: true },
    { id: "grid-2x4", label: "그리드 2×4", aux: 7,
      columns: "1fr 1fr", rows: "repeat(4, 1fr)",
      areas: ['"m a"', '"b c"', '"d e"', '"f g"'], chat: ["right", "left"] },
    { id: "grid-3x3", label: "그리드 3×3", aux: 8,
      columns: "repeat(3, 1fr)", rows: "repeat(3, 1fr)",
      areas: ['"m a b"', '"c d e"', '"f g h"'], chat: ["right", "left"] },
  );

  // ── 세로 화면(창 높이 > 너비, 세로로 돌린 모니터 등) 배치 ──
  // portrait: 세로 화면에서만 목록에 보인다. 채팅은 아래가 기본(세로 화면은 아래가 넓다).
  // portraitFit: 가로용이지만 세로 화면 묶음에도 넣는 기존 배치(지금은 없다). 세로
  //   화면에서는 이 둘을 '세로 화면' 묶음으로 목록 맨 위에 올린다(layoutsFor). 방향이
  //   바뀌어도 쓰던 배치는 그대로 둔다 — 목록만 바뀐다.
  // 칸 비율: 전체 폭 칸과 절반 폭 칸의 높이를 2:1 로 두면 모두 16:9 다.
  const PORTRAIT_CHAT = ["bottom", "right", "left"];
  LAYOUTS.push(
    { id: "portrait-2", label: "세로 2단", aux: 1, portrait: true,
      columns: "1fr", rows: "1fr 1fr", areas: ['"m"', '"a"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-3", label: "세로 3단", aux: 2, portrait: true,
      columns: "1fr", rows: "repeat(3, 1fr)", areas: ['"m"', '"a"', '"b"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-2-bottom-2", label: "세로 2단 + 아래 2", aux: 3, portrait: true,
      columns: "1fr 1fr", rows: "2fr 2fr 1fr", areas: ['"m m"', '"a a"', '"b c"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-4", label: "세로 4단", aux: 3, portrait: true,
      columns: "1fr", rows: "repeat(4, 1fr)", areas: ['"m"', '"a"', '"b"', '"c"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-main-2x2", label: "세로 메인 + 그리드 2×2", aux: 4, portrait: true,
      columns: "1fr 1fr", rows: "2fr 1fr 1fr", areas: ['"m m"', '"a b"', '"c d"'], chat: PORTRAIT_CHAT, flexible: true },
    // 아래 3칸(1/3 폭)은 전체 폭 줄과 높이 3:1, 절반 폭 칸은 2:1 이면 모든 칸이 16:9 다.
    { id: "portrait-2-bottom-3", label: "세로 2단 + 아래 3", aux: 4, portrait: true,
      columns: "repeat(3, 1fr)", rows: "3fr 3fr 1fr", areas: ['"m m m"', '"a a a"', '"b c d"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-3-bottom-2", label: "세로 3단 + 아래 2", aux: 4, portrait: true,
      columns: "1fr 1fr", rows: "2fr 2fr 2fr 1fr", areas: ['"m m"', '"a a"', '"b b"', '"c d"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-2-grid-2x2", label: "세로 2단 + 그리드 2×2", aux: 5, portrait: true,
      columns: "1fr 1fr", rows: "2fr 2fr 1fr 1fr", areas: ['"m m"', '"a a"', '"b c"', '"d e"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-3-bottom-3", label: "세로 3단 + 아래 3", aux: 5, portrait: true,
      columns: "repeat(3, 1fr)", rows: "3fr 3fr 3fr 1fr", areas: ['"m m m"', '"a a a"', '"b b b"', '"c d e"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-4-bottom-2", label: "세로 4단 + 아래 2", aux: 5, portrait: true,
      columns: "1fr 1fr", rows: "2fr 2fr 2fr 2fr 1fr", areas: ['"m m"', '"a a"', '"b b"', '"c c"', '"d e"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-main-2x3", label: "세로 메인 + 그리드 2×3", aux: 6, portrait: true,
      columns: "1fr 1fr", rows: "2fr 1fr 1fr 1fr", areas: ['"m m"', '"a b"', '"c d"', '"e f"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-3-grid-2x2", label: "세로 3단 + 그리드 2×2", aux: 6, portrait: true,
      columns: "1fr 1fr", rows: "2fr 2fr 2fr 1fr 1fr", areas: ['"m m"', '"a a"', '"b b"', '"c d"', '"e f"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-2-grid-2x3", label: "세로 2단 + 그리드 2×3", aux: 7, portrait: true,
      columns: "1fr 1fr", rows: "2fr 2fr 1fr 1fr 1fr", areas: ['"m m"', '"a a"', '"b c"', '"d e"', '"f g"'], chat: PORTRAIT_CHAT, flexible: true },
    { id: "portrait-main-2x4", label: "세로 메인 + 그리드 2×4", aux: 8, portrait: true,
      columns: "1fr 1fr", rows: "2fr 1fr 1fr 1fr 1fr", areas: ['"m m"', '"a b"', '"c d"', '"e f"', '"g h"'], chat: PORTRAIT_CHAT, flexible: true },
  );
  // 세로 화면 묶음의 순서(채널 수별, 사용자 승인 표). 앞의 것이 세로 화면에서 채널 수를 바꿀 때의
  // 기본 배치다. 세로 전용이 아닌 것(그리드 2×4)은 portraitFit 으로 표시한다.
  const PORTRAIT_ORDER = [
    "portrait-2",
    "portrait-3",
    "portrait-2-bottom-2", "portrait-4",
    "portrait-main-2x2", "portrait-2-bottom-3", "portrait-3-bottom-2",
    "portrait-2-grid-2x2", "portrait-3-bottom-3", "portrait-4-bottom-2",
    "portrait-main-2x3", "portrait-3-grid-2x2",
    "portrait-2-grid-2x3",
    "portrait-main-2x4",
  ];
  for (const id of PORTRAIT_ORDER) {
    const layout = LAYOUTS.find((item) => item.id === id);
    if (layout && !layout.portrait) layout.portraitFit = true;
  }

  // 채팅 열의 첫 행에 마지막 보조 채널을 둔다. x는 그 아래 채팅 패널 자리다.
  // 영상 칸은 언제나 mvFrames 안에 남겨 iframe 재로드 없이 Grid 상에서만 이동한다.
  // 줄 크기 목록(fr 숫자). "repeat(4, 1fr)" 도 풀어 쓴다.
  function trackFractions(tracks) {
    return tracks
      .replace(/repeat\((\d+),\s*([^)]+)\)/g, (_, n, track) => Array(Number(n)).fill(track.trim()).join(" "))
      .trim().split(/\s+/).map((value) => parseFloat(value));
  }

  // 격자의 실제 줄. 칸 경계가 없는 이웃 줄(모든 칸이 두 줄에 걸친다)은 하나로 합친다.
  // share: 전체 높이에 대한 비율. dropLast: 마지막 열(채팅 열)은 빼고 본다.
  function macroRows(areas, rows, dropLast = false) {
    const fr = trackFractions(rows);
    const merged = [];
    areas.forEach((row, index) => {
      const cells = row.replace(/"/g, "").trim().split(/\s+/);
      if (dropLast) cells.pop();
      const last = merged[merged.length - 1];
      if (last && last.cells.join(" ") === cells.join(" ")) last.fr += fr[index];
      else merged.push({ cells, fr: fr[index] });
    });
    const total = merged.reduce((sum, row) => sum + row.fr, 0);
    return merged.map((row) => ({ cells: row.cells, share: row.fr / total }));
  }

  // 줄 경계에 extra(0~1) 경계를 더해 나눈 구간들. 각 구간: 그 자리의 칸, 시작·끝 비율.
  function splitRows(macro, extra) {
    const round = (value) => Math.round(value * 1e6) / 1e6;
    const lines = [0];
    for (const row of macro) lines.push(round(lines[lines.length - 1] + row.share));
    const all = [...new Set([...lines, ...extra.map(round)])].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i + 1 < all.length; i += 1) {
      const mid = (all[i] + all[i + 1]) / 2;
      const at = lines.findIndex((line, index) => index > 0 && mid < line) - 1;
      parts.push({ cells: macro[at].cells, start: all[i], end: all[i + 1] });
    }
    return parts;
  }

  // 비율 → fr(12 를 곱해 1/2·1/3·1/4·1/6 이 정수로 나온다).
  const fraction = (share) => `${Math.round(share * 12 * 1e4) / 1e4}fr`;

  // videos: 채팅 열 위에 쌓는 영상 수(1 또는 2).
  // 영상이 둘이면 미리보기용 격자(areas/rows)는 격자 줄에 1/4·1/2 경계를 더해 채팅 열을
  // [영상 1/4][영상 1/4][채팅 1/2]로 그린다. 실제 화면은 chatTopStageGrid 가 따로 짠다.
  // 채팅 열 위에 영상을 얹은 배치 정의(기본 배치·내 배치 공용). 목록에 넣는 건 addChatTop.
  function buildChatTop(base, id = null, videos = 1) {
    id ||= `${base.id}-chat-top${videos > 1 ? `-${videos}` : ""}`;
    const videoSlots = SLOTS.slice(base.aux + 1, base.aux + 1 + videos);
    let rows = base.areas.length === 1 ? [base.areas[0], base.areas[0]] : base.areas;
    let tracks = rows.length === base.areas.length ? base.rows : "1fr 1fr";
    let areas = rows.map((row, index) => {
      const cells = row.replace(/"/g, "").trim().split(/\s+/);
      return areaRow([...cells, videoSlots[index] || "x"]);
    });
    if (videos === 2) {
      const parts = splitRows(macroRows(base.areas, base.rows), [0.25, 0.5]);
      areas = parts.map((part) =>
        areaRow([...part.cells, part.end <= 0.25 ? videoSlots[0] : part.end <= 0.5 ? videoSlots[1] : "x"]));
      tracks = parts.map((part) => fraction(part.end - part.start)).join(" ");
    }
    return {
      id,
      label: `${base.label} + 채팅 위 ${videos}`,
      aux: base.aux + videos,
      ...(videos > 1 ? { chatTopVideos: videos } : {}),
      columns: `${base.columns} 1fr`,
      coreColumns: base.columns,
      rows: tracks,
      areas,
      chat: ["right", "left"],
      chatTop: true,
      // 격자 줄을 채팅 열 위 영상 높이와 함께 쓰지 않는 배치(chatTopStageGrid 참고).
      ...(base.split ? { chatTopSplit: true } : {}),
      flexible: true,
    };
  }
  function addChatTop(base, id = null, videos = 1) {
    LAYOUTS.push(buildChatTop(base, id, videos));
  }

  addChatTop({ id: "main", label: "메인", aux: 0, columns: "1fr", rows: "1fr", areas: ['"m"'] });
  // 3채널: 왼쪽 열을 메인과 보조 1 이 위아래로 나누고, 채팅 열 위에 보조 2.
  // ⚠ 다른 '채팅 위 1' 처럼 첫 줄을 채팅 위 영상 높이로 두면 '메인 위' 의 메인이 그 낮은 줄에
  //   갇힌다(실측: 1600×900 에서 메인 208px, 보조 1 이 나머지). 두 칸이 같은 크기가 되게
  //   왼쪽 열은 반으로 나누고 채팅 열의 위 영상 높이는 따로 둔다(chatTopSplit).
  addChatTop({ id: "main-top", label: "메인 위", aux: 1, columns: "1fr", rows: "1fr 1fr", areas: ['"m"', '"a"'], split: true });
  addChatTop({ id: "main-bottom", label: "메인 아래", aux: 1, columns: "1fr", rows: "1fr 1fr", areas: ['"a"', '"m"'], split: true });
  for (const id of ["top-2", "bottom-2",
    "grid-2x2", "right-3", "left-3", "top-3", "bottom-3",
    "right-4", "left-4", "top-4", "bottom-4"]) {
    // 그리드 2×2 도 첫 줄(메인·보조 1)이 채팅 위 영상 높이에 갇히므로 줄을 따로 둔다.
    addChatTop({ ...LAYOUTS.find((layout) => layout.id === id), split: id === "grid-2x2" });
  }
  // 6채널: 한 열은 메인·보조 1 을 반씩, 다른 열은 보조 3 을 3등분, 채팅 열 위에 보조 1.
  // 줄 2:1:1:2 로 두 열의 경계(1/2, 1/3·2/3)를 모두 담는다. 열 3:2 면 칸이 16:9 에 가깝다.
  const grid23 = { id: "grid-2-3", label: "그리드 2·3", aux: 4, columns: "3fr 2fr",
    rows: "2fr 1fr 1fr 2fr", areas: ['"m a"', '"m c"', '"b c"', '"b d"'], split: true };
  const grid32 = { id: "grid-3-2", label: "그리드 3·2", aux: 4, columns: "2fr 3fr",
    rows: "2fr 1fr 1fr 2fr", areas: ['"a m"', '"c m"', '"c b"', '"d b"'], split: true };
  addChatTop(grid23);
  addChatTop(grid32);
  // 5채널: 같은 격자(한 열 2칸·다른 열 3칸)를 채팅 열 없이. 두 열의 칸 비율이 같아(열 3:2,
  // 칸 높이 1/2·1/3) 무대가 넓으면 다섯 칸 모두 16:9 에 가깝다.
  for (const grid of [grid23, grid32]) {
    const { split, ...layout } = grid;
    LAYOUTS.push({ ...layout, chat: ["right", "left"], flexible: true });
  }
  // 7채널: 그리드 3×2 / 3·3(두 열에 3칸씩) + 채팅 위 1. 8채널: 그리드 3·3 + 채팅 위 2.
  addChatTop({ ...LAYOUTS.find((layout) => layout.id === "grid-3x2"), split: true });
  const grid33 = { id: "grid-3-3", label: "그리드 3·3", aux: 5, columns: "1fr 1fr",
    rows: "1fr 1fr 1fr", areas: ['"m a"', '"b c"', '"d e"'], split: true };
  addChatTop(grid33);
  addChatTop(grid33, "grid-3-3-chat-top-2", 2);
  // 채팅 열 위에 영상 둘(4~7채널).
  for (const id of ["bottom-1", "right-2", "left-2", "bottom-2", "top-2",
    "right-3", "left-3", "bottom-3", "top-3", "grid-2x2"]) {
    addChatTop(LAYOUTS.find((layout) => layout.id === id), null, 2);
  }
  addChatTop(grid23, null, 2);
  addChatTop(grid32, null, 2);

  // 빈 칸이 한 칸 남는 5채널 배치도 빈 칸 채팅이 기본이다(바깥 자리는 채팅 위치 메뉴에서 고른다).
  // 빈 칸 채팅 배치에서 채널을 늘려 이 배치로 오면 빈 칸이 이어지고, 미리보기도 기본 자리를
  // 그리므로 기본값을 빈 칸으로 맞춘다.
  for (const id of ["right2-bottom2", "left2-bottom2", "grid-3x2-5", "grid-2x3-5"]) {
    const layout = LAYOUTS.find((item) => item.id === id);
    layout.chat = [CHAT_INSET_SIDE, ...layout.chat];
  }

  // 배치 고르기 목록의 순서(채널 수별). 보조가 있는 쪽으로 묶어 오른쪽 → 왼쪽 → 아래 → 위 →
  // 그리드 → 채팅 위 1 순서로 두고, 묶음 안에서는 기본형 뒤에 변형을 둔다.
  // ⚠ 각 채널 수의 첫 배치는 채널 수가 바뀔 때 고르는 기본 배치다. 함부로 바꾸지 않는다.
  // ⚠ 새 배치를 넣으면 여기에도 넣는다(빠지면 그 채널 수 목록의 맨 뒤로 간다).
  const LAYOUT_ORDER = [
    // 2채널
    "right-1", "right-1-0", "left-1", "left-1-0", "bottom-1", "bottom-1-0", "bottom-1-2",
    "top-1", "main-chat-top", "portrait-2",
    // 3채널
    "right-2", "tl-1-right-2", "left-2", "tr-1-left-2",
    "bottom-2", "bottom-2-single-1",
    "top-2", "top-2-single-0", "top-2-single-1", "top-2-single-2",
    "main-top-chat-top", "main-bottom-chat-top", "portrait-3",
    // 4채널
    "right-3", "right-2-bottom-1-0", "right-2-bottom-1-2",
    "left-3", "left-2-bottom-1-0", "left-2-bottom-1-2",
    "bottom-3", "top-3", "grid-2x2", "bottom-2-chat-top", "top-2-chat-top", "bottom-1-chat-top-2",
    "portrait-2-bottom-2", "portrait-4",
    // 5채널
    "right2-bottom2", "right-2x2", "right-4", "left2-bottom2", "left-2x2", "left-4",
    "bottom-4", "top-4", "grid-3x2-5", "grid-2x3-5", "grid-2-3", "grid-3-2",
    "right-3-chat-top", "left-3-chat-top", "bottom-3-chat-top", "top-3-chat-top", "grid-2x2-chat-top",
    "right-2-chat-top-2", "left-2-chat-top-2", "bottom-2-chat-top-2", "top-2-chat-top-2",
    "portrait-main-2x2", "portrait-2-bottom-3", "portrait-3-bottom-2",
    // 6채널
    "right2-bottom3", "right-5", "left2-bottom3", "left-5", "bottom-5", "top-5",
    "grid-3x2", "grid-2x3-6",
    "right-4-chat-top", "left-4-chat-top", "bottom-4-chat-top", "top-4-chat-top",
    "grid-2-3-chat-top", "grid-3-2-chat-top",
    "right-3-chat-top-2", "left-3-chat-top-2", "bottom-3-chat-top-2", "top-3-chat-top-2", "grid-2x2-chat-top-2",
    "portrait-2-grid-2x2", "portrait-3-bottom-3", "portrait-4-bottom-2",
    // 7채널
    "grid-3x2-bottom-1-0", "grid-3x2-bottom-1-2", "grid-2x3-bottom-1-0",
    "grid-3-3-chat-top", "grid-3x2-chat-top", "grid-2-3-chat-top-2", "grid-3-2-chat-top-2",
    "portrait-main-2x3", "portrait-3-grid-2x2",
    // 8채널
    "grid-3x3-8", "grid-2x4", "grid-3-3-chat-top-2", "portrait-2-grid-2x3",
    // 9채널
    "grid-3x3", "portrait-main-2x4",
  ];
  {
    const rank = new Map(LAYOUT_ORDER.map((id, index) => [id, index]));
    const fallback = LAYOUT_ORDER.length;
    LAYOUTS.sort((a, b) => (rank.get(a.id) ?? fallback) - (rank.get(b.id) ?? fallback));
  }


  // ── 내 배치(사용자가 만든 배치) ──
  // 저장값(cheeseMultiviewCustomLayouts): [{ id, name, rows, cols, cells: [[칸 이름…]…], chat }]
  //   cells: 'm'(메인)·'a'~(보조, 만든 순서)·채팅 칸('x'·'q'·'r'·'s' = 채팅 1~4, 격자 안 채팅일 때만)
  //   또는 '.'(빈 칸). 칸마다 직사각형 하나. 채팅 2~4 는 시청 화면이 채팅 칸마다 따로 띄운다.
  //   chat: 'right'|'left'|'bottom'|'inset'(격자 안 채팅 칸 x 에). 격자는 12×12 까지.
  //   예전 저장값('inset' + 빈 칸이 직사각형 하나)은 그 빈 칸을 채팅 칸으로 읽는다.
  // 기본 배치와 같은 모양(columns·rows·areas·chat)으로 바꿔 LAYOUTS 에 더한다 → 시청 화면·미리보기·
  // 16:9 트랙 계산(solveTracks)·경계 크기 조절을 그대로 쓴다. 16:9 가 풀리지 않는 모양은 균등 칸이다.
  const CUSTOM_ID_RE = /^custom-[a-z0-9]{4,24}$/;
  // 12 는 2·3·4·6 으로 나뉘어 메인 2/3 폭·위 2 + 아래 3 같은 비율을 정확히 만든다.
  const CUSTOM_GRID_MAX = 12;
  const CUSTOM_MAX = 30;
  const CUSTOM_CHATS = ["right", "left", "bottom", CHAT_INSET_SIDE];
  // 격자 안 채팅 칸 이름(채팅 1~4). x 는 기존 채팅 하나(스테이지 격자의 채팅 자리), q·r·s 는 추가 채팅.
  const CHAT_CELLS = ["x", "q", "r", "s"];
  const isChatCell = (cell) => CHAT_CELLS.includes(cell);

  // 빈 칸(.)이 직사각형 하나로 모였는가(빈 칸 채팅을 쓸 수 있는가).
  function emptyIsRectangle(cells) {
    let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1, count = 0;
    cells.forEach((row, r) => row.forEach((cell, c) => {
      if (cell !== ".") return;
      count += 1;
      r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }));
    return count > 0 && count === (r1 - r0 + 1) * (c1 - c0 + 1);
  }

  // 칸 배치표 검사. { ok, slots(개수), reason }
  // minSlots: 격자 칸 최소 수(채팅 위 영상이 있으면 메인 하나여도 된다).
  function checkCustomCells(cells, { minSlots = 2 } = {}) {
    if (!Array.isArray(cells) || !cells.length || cells.length > CUSTOM_GRID_MAX) return { ok: false, reason: "격자 크기가 맞지 않습니다." };
    const cols = Array.isArray(cells[0]) ? cells[0].length : 0;
    if (!cols || cols > CUSTOM_GRID_MAX || cells.some((row) => !Array.isArray(row) || row.length !== cols))
      return { ok: false, reason: "격자 크기가 맞지 않습니다." };
    const boxes = new Map();
    const chats = new Map();
    for (let r = 0; r < cells.length; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cell = cells[r][c];
        if (cell === ".") continue;
        if (isChatCell(cell)) {
          const chat = chats.get(cell);
          chats.set(cell, chat
            ? { r0: Math.min(chat.r0, r), r1: Math.max(chat.r1, r), c0: Math.min(chat.c0, c), c1: Math.max(chat.c1, c), count: chat.count + 1 }
            : { r0: r, r1: r, c0: c, c1: c, count: 1 });
          continue;
        }
        if (!SLOTS.includes(cell)) return { ok: false, reason: "알 수 없는 칸이 있습니다." };
        const box = boxes.get(cell) || { r0: r, r1: r, c0: c, c1: c, count: 0 };
        box.r0 = Math.min(box.r0, r); box.r1 = Math.max(box.r1, r);
        box.c0 = Math.min(box.c0, c); box.c1 = Math.max(box.c1, c);
        box.count += 1;
        boxes.set(cell, box);
      }
    }
    const slots = boxes.size;
    if (slots < minSlots) return { ok: false, slots, reason: minSlots > 1 ? "화면 칸을 2개 이상 만드세요." : "메인 화면 칸을 만드세요." };
    if (!boxes.has("m")) return { ok: false, slots, reason: "메인 화면 칸을 만드세요." };
    if (!SLOTS.slice(0, slots).every((slot) => boxes.has(slot))) return { ok: false, slots, reason: "칸 이름이 차례대로가 아닙니다." };
    for (const box of [...boxes.values(), ...chats.values()]) {
      if (box.count !== (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)) return { ok: false, slots, reason: "칸은 직사각형이어야 합니다." };
    }
    if (!CHAT_CELLS.slice(0, chats.size).every((name) => chats.has(name))) return { ok: false, slots, reason: "채팅 칸 이름이 차례대로가 아닙니다." };
    return { ok: true, slots, chatCell: chats.has("x"), chatCells: CHAT_CELLS.slice(0, chats.size) };
  }

  // 저장값 정리. 맞지 않으면 null.
  function normalizeCustomLayout(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id || "");
    if (!CUSTOM_ID_RE.test(id)) return null;
    let cells = Array.isArray(raw.cells) ? raw.cells.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : [])) : [];
    let chat = CUSTOM_CHATS.includes(raw.chat) ? raw.chat : "right";
    const hasChatCell = cells.some((row) => row.some(isChatCell));
    if (chat === CHAT_INSET_SIDE && !hasChatCell && emptyIsRectangle(cells)) {
      cells = cells.map((row) => row.map((cell) => (cell === "." ? "x" : cell))); // 예전 저장값
    } else if (chat !== CHAT_INSET_SIDE && hasChatCell) {
      cells = cells.map((row) => row.map((cell) => (isChatCell(cell) ? "." : cell))); // 바깥 채팅이면 채팅 칸은 빈 칸
    }
    // 채팅 위 영상(0~2): 바깥 채팅이 오른쪽·왼쪽일 때만(아래 normalize 에서 다시 확인).
    const wantTop = Math.max(0, Math.min(2, Math.floor(Number(raw.chatTopVideos) || 0)));
    const check = checkCustomCells(cells, { minSlots: wantTop && (chat === "right" || chat === "left") ? 1 : 2 });
    if (!check.ok) return null;
    if (chat === CHAT_INSET_SIDE && !check.chatCell) chat = "right";
    const name = String(raw.name || "").replace(/\s+/g, " ").trim().slice(0, 30) || "내 배치";
    // 채팅 열 위 영상(0~2): 바깥 채팅이 오른쪽·왼쪽일 때만. 칸 수와 합쳐 16채널을 넘지 않는다.
    let chatTopVideos = wantTop;
    if (chat !== "right" && chat !== "left") chatTopVideos = 0;
    if (check.slots + chatTopVideos > SLOTS.length || check.slots + chatTopVideos < 2) return null;
    return { id, name, rows: cells.length, cols: cells[0].length, cells, chat, ...(chatTopVideos ? { chatTopVideos } : {}) };
  }

  // 같은 줄·같은 열이 이어지면 하나로 합친다(채팅 위 배치는 첫 줄 높이가 위 영상의 한계라, 12×12 처럼
  // 잘게 나눈 격자도 실제 칸 경계만 남겨야 영상이 작아지지 않는다).
  function compactCells(cells) {
    const rows = [];
    const rowFr = [];
    for (const row of cells) {
      if (rows.length && rows[rows.length - 1].join(" ") === row.join(" ")) rowFr[rowFr.length - 1] += 1;
      else {
        rows.push(row);
        rowFr.push(1);
      }
    }
    const keep = [];
    const colFr = [];
    for (let c = 0; c < rows[0].length; c += 1) {
      const prev = keep[keep.length - 1];
      if (keep.length && rows.every((row) => row[c] === row[prev])) colFr[colFr.length - 1] += 1;
      else {
        keep.push(c);
        colFr.push(1);
      }
    }
    // 비율은 가장 작은 정수로(2fr 2fr → 1fr 1fr).
    const gcd = (x, y) => (y ? gcd(y, x % y) : x);
    const reduce = (list) => {
      const g = list.reduce(gcd);
      return list.map((n) => n / g);
    };
    return { cells: rows.map((row) => keep.map((c) => row[c])), rowFr: reduce(rowFr), colFr: reduce(colFr) };
  }

  // 저장값 → 배치(LAYOUTS 항목 모양).
  function customLayoutDef(custom) {
    if (custom.chatTopVideos && (custom.chat === "right" || custom.chat === "left")) {
      // 채팅 열 위 영상: 기본 '채팅 위' 배치와 같은 정의(채팅 폭·위 영상 높이 손잡이가 그대로 동작한다).
      // 1개면 격자 줄 비율을 그대로 두고 첫 줄 안에서 나눈다(chatTopSplit), 2개는 일반화된 경계 계산.
      const core = compactCells(custom.cells);
      const base = {
        id: custom.id,
        label: custom.name,
        aux: checkCustomCells(custom.cells, { minSlots: 1 }).slots - 1,
        columns: core.colFr.map((n) => `${n}fr`).join(" "),
        rows: core.rowFr.map((n) => `${n}fr`).join(" "),
        areas: core.cells.map(areaRow),
        split: custom.chatTopVideos === 1,
      };
      const def = buildChatTop(base, custom.id, custom.chatTopVideos);
      return {
        ...def,
        label: custom.name,
        chat: custom.chat === "left" ? ["left", "right"] : ["right", "left"],
        extraChats: [],
        custom: true,
        source: custom,
      };
    }
    const inset = custom.chat === CHAT_INSET_SIDE && custom.cells.some((row) => row.includes("x"));
    const chatCells = inset ? CHAT_CELLS.filter((name) => custom.cells.some((row) => row.includes(name))) : [];
    const outside = ["right", "left", "bottom"];
    const first = inset ? CHAT_INSET_SIDE : custom.chat === CHAT_INSET_SIDE ? "right" : custom.chat;
    return {
      id: custom.id,
      label: custom.name,
      aux: checkCustomCells(custom.cells).slots - 1,
      columns: `repeat(${custom.cols}, 1fr)`,
      rows: `repeat(${custom.rows}, 1fr)`,
      areas: custom.cells.map(areaRow),
      chat: [first, ...outside.filter((side) => side !== first)],
      ...(inset ? { chatInsetOption: true } : {}),
      // 채팅 2~4 칸(시청 화면이 칸마다 채팅을 따로 띄운다).
      extraChats: chatCells.slice(1),
      custom: true,
      flexible: true,
      // 시작 구성에 함께 담아 시청 화면이 같은 모양을 그리게 한다(registerCustomLayout).
      source: custom,
    };
  }

  // 내 배치 목록을 LAYOUTS 에 다시 건다(기본 배치 뒤). keepId: 목록에서 지워졌어도 지금 쓰는 배치는
  // 남긴다(시청 중인 화면이 기본 배치로 튀지 않게). 돌려주는 값: 건 배치들.
  function setCustomLayouts(list, { keepId = "" } = {}) {
    const kept = keepId ? LAYOUTS.find((l) => l.custom && l.id === keepId) : null;
    for (let i = LAYOUTS.length - 1; i >= 0; i -= 1) if (LAYOUTS[i].custom) LAYOUTS.splice(i, 1);
    const seen = new Set();
    const defs = [];
    for (const raw of (Array.isArray(list) ? list : []).slice(0, CUSTOM_MAX)) {
      const custom = normalizeCustomLayout(raw);
      if (!custom || seen.has(custom.id)) continue;
      seen.add(custom.id);
      defs.push(customLayoutDef(custom));
    }
    if (kept && !seen.has(kept.id)) defs.push(kept);
    LAYOUTS.push(...defs);
    return defs;
  }

  // 시작 구성에 담겨 온 내 배치 하나를 건다(저장값이 그사이 바뀌어도 그 멀티뷰는 그 모양으로 연다).
  function registerCustomLayout(raw) {
    const custom = normalizeCustomLayout(raw);
    if (!custom) return null;
    const def = customLayoutDef(custom);
    const at = LAYOUTS.findIndex((l) => l.id === def.id);
    if (at >= 0) LAYOUTS.splice(at, 1, def);
    else LAYOUTS.push(def);
    return def;
  }

  // 지금 고를 수 있는 최대 채널 수: 기본 9, 10칸 이상 내 배치가 있으면 그 칸 수까지(16 한도).
  function maxChannels() {
    let max = MAX_CHANNELS_BUILTIN;
    for (const layout of LAYOUTS) if (layout.custom) max = Math.max(max, layout.aux + 1);
    return Math.min(max, MAX_CHANNELS_CUSTOM);
  }

  // 이 채널 수를 담을 배치가 있는가(10개 이상은 그 칸 수의 내 배치가 있어야 한다).
  function hasLayoutFor(count) {
    return count >= 1 && count <= MAX_CHANNELS_CUSTOM && LAYOUTS.some((layout) => layout.aux === count - 1);
  }

  function newCustomLayoutId() {
    return `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  // 이 배치에서 고를 수 있는 채팅 자리. 앞의 것이 기본값이다.
  function chatSidesFor(layout) {
    // 채팅 위 영상 배치는 영상이 채팅 열 위에 있어야 하므로 좌/우만.
    if (layout?.chatTop) return ["right", "left"];
    const allowed = layout?.chatInsetOption ? [...CHAT_SIDES, CHAT_INSET_SIDE] : CHAT_SIDES;
    const sides = (layout?.chat || []).filter((side) => allowed.includes(side));
    for (const side of allowed) if (!sides.includes(side)) sides.push(side);
    return sides;
  }

  // 채팅이 격자 안 빈 칸(x)에 들어가는가.
  function usesChatInset(layout, side) {
    return layout?.chatInsetOption === true && side === CHAT_INSET_SIDE;
  }

  // 배치를 바꿀 때의 채팅 자리. 빈 칸이 기본인 배치로 가면 빈 칸에 넣는다.
  // 그 밖에는 지금 자리를 쓸 수 있으면 그대로 둔다.
  function chatSideForSwitch(layout, current) {
    const sides = chatSidesFor(layout);
    if (sides[0] === CHAT_INSET_SIDE) return CHAT_INSET_SIDE;
    return sides.includes(current) ? current : sides[0] || "right";
  }

  // 사용자가 마지막으로 고른 채팅 자리(cheeseMultiviewChatSide)를 새 멀티뷰에도 쓴다.
  // 그 배치에서 쓸 수 없는 자리이거나, 빈 칸(inset)이 기본인 배치(빈 칸이 남지 않게)면 지금 자리를 둔다.
  function preferredChatSide(layout, preferred, current) {
    const sides = chatSidesFor(layout);
    if (!preferred || !sides.includes(preferred)) return current;
    if (sides[0] === CHAT_INSET_SIDE && preferred !== CHAT_INSET_SIDE) return current;
    return preferred;
  }

  // ── 배치 설정(고르기 화면 '기본 배치 설정', 저장 키 cheeseMultiviewLayoutPrefs) ──
  // hidden: 목록에서 숨긴 기본 제공 배치 id(내 배치는 숨기지 않고 지운다).
  // defaults: { 채널 수: 배치 id } — 그 채널 수가 되면 '비슷한 배치' 대신 먼저 고른다.
  //   내 배치 id 도 된다(내 배치는 나중에 등록되므로 쓸 때 확인한다).
  const LAYOUT_PREFS_KEY = "cheeseMultiviewLayoutPrefs";
  let layoutPrefs = { hidden: new Set(), defaults: {} };
  function normalizeLayoutPrefs(raw) {
    const builtin = new Set(LAYOUTS.filter((l) => !l.custom).map((l) => l.id));
    const hidden = [...new Set((Array.isArray(raw?.hidden) ? raw.hidden : [])
      .filter((id) => typeof id === "string" && builtin.has(id)))];
    const defaults = {};
    if (raw?.defaults && typeof raw.defaults === "object" && !Array.isArray(raw.defaults)) {
      for (const [key, id] of Object.entries(raw.defaults)) {
        const count = Number(key);
        if (Number.isInteger(count) && count >= 2 && count <= SLOTS.length &&
            typeof id === "string" && /^[a-z0-9-]{1,60}$/i.test(id) && !hidden.includes(id)) {
          defaults[count] = id;
        }
      }
    }
    return { hidden, defaults };
  }
  function setLayoutPrefs(raw) {
    const prefs = normalizeLayoutPrefs(raw);
    layoutPrefs = { hidden: new Set(prefs.hidden), defaults: prefs.defaults };
    return prefs;
  }
  function getLayoutPrefs() {
    return { hidden: [...layoutPrefs.hidden], defaults: { ...layoutPrefs.defaults } };
  }
  const isLayoutHidden = (id) => layoutPrefs.hidden.has(id);
  // 이 채널 수의 기본 배치(정해 두었고, 지금 있고, 숨기지 않았을 때만).
  function defaultLayoutFor(count) {
    const id = layoutPrefs.defaults[count];
    const layout = id ? LAYOUTS.find((l) => l.id === id) : null;
    return layout && layout.aux === count - 1 && !layoutPrefs.hidden.has(layout.id) ? layout : null;
  }

  // 고른 채널 수(메인 포함)에 맞는 배치만 돌려준다.
  // portrait: 세로 화면이면 '세로 화면' 묶음(PORTRAIT_ORDER 순)을 맨 앞에 두고 나머지를 잇는다.
  //   가로 화면에서는 세로 전용 배치를 뺀다(지금 쓰는 배치 keepId 는 남긴다).
  // all: 방향과 상관없이 그 채널 수의 모든 배치(저장값 복원·채널 수 변경에 쓴다).
  function layoutsFor(count, { portrait = false, keepId = "", all = false } = {}) {
    const aux = Math.max(0, Number(count) - 1);
    const every = LAYOUTS.filter((l) => l.aux === aux);
    if (all) return every;
    // 숨긴 배치는 뺀다(지금 쓰는 배치는 남긴다). 다 숨겨졌으면 그대로 둔다.
    const shown = every.filter((l) => !layoutPrefs.hidden.has(l.id) || l.id === keepId);
    const list = shown.length ? shown : every;
    if (!portrait) return list.filter((l) => !l.portrait || l.id === keepId);
    const rank = new Map(PORTRAIT_ORDER.map((id, index) => [id, index]));
    const group = list.filter((l) => rank.has(l.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    return [...group, ...list.filter((l) => !rank.has(l.id))];
  }

  // 세로 화면 묶음인가(목록에서 '세로 화면' 머리말을 붙일 때).
  function isPortraitGroup(layout) {
    return Boolean(layout?.portrait || layout?.portraitFit);
  }

  function layoutById(id) {
    return LAYOUTS.find((l) => l.id === id) || null;
  }

  // 채널 수가 하나 바뀔 때 갈 비슷한 배치. 배치: [채널 −1, 채널 +1].
  // 보조가 있는 쪽·채팅 방식(옆/빈 칸/채팅 위 1)·메인 위치가 이어지는 배치를 고른다.
  // ⚠ 새 배치를 넣으면 여기에도 넣는다(빠지면 채널 수가 바뀔 때 첫 배치로 간다).
  const COUNT_NEIGHBORS = {
    // 2채널
    "right-1": [null, "right-2"],
    "right-1-0": [null, "tl-1-right-2"],
    "left-1": [null, "left-2"],
    "left-1-0": [null, "tr-1-left-2"],
    "bottom-1": [null, "bottom-2"],
    "bottom-1-0": [null, "bottom-2"],
    "bottom-1-2": [null, "bottom-2"],
    "top-1": [null, "top-2"],
    "main-chat-top": [null, "main-top-chat-top"],
    // 3채널
    "right-2": ["right-1", "right-3"],
    "tl-1-right-2": ["right-1-0", "grid-2x2"],
    "left-2": ["left-1", "left-3"],
    "tr-1-left-2": ["left-1-0", "grid-2x2"],
    "bottom-2": ["bottom-1", "bottom-3"],
    "bottom-2-single-1": ["bottom-1", "bottom-3"],
    "top-2": ["top-1", "top-3"],
    "top-2-single-0": ["top-1", "top-3"],
    "top-2-single-1": ["top-1", "top-3"],
    "top-2-single-2": ["top-1", "top-3"],
    "main-top-chat-top": ["main-chat-top", "bottom-2-chat-top"],
    "main-bottom-chat-top": ["main-chat-top", "top-2-chat-top"],
    // 4채널
    "right-3": ["right-2", "right-4"],
    "right-2-bottom-1-0": ["right-2", "right2-bottom2"],
    "right-2-bottom-1-2": ["right-2", "right2-bottom2"],
    "left-3": ["left-2", "left-4"],
    "left-2-bottom-1-0": ["left-2", "left2-bottom2"],
    "left-2-bottom-1-2": ["left-2", "left2-bottom2"],
    "bottom-3": ["bottom-2", "bottom-4"],
    "top-3": ["top-2", "top-4"],
    // 같은 2×2 칸에서 빈 칸에 채팅.
    "grid-2x2": ["tl-1-right-2", "grid-3x2-5"],
    "bottom-2-chat-top": ["main-top-chat-top", "bottom-3-chat-top"],
    "top-2-chat-top": ["main-bottom-chat-top", "top-3-chat-top"],
    // 5채널. 빈 칸이 같은 자리에 남는 배치로 줄인다.
    "right2-bottom2": ["right-2-bottom-1-0", "right2-bottom3"],
    "left2-bottom2": ["left-2-bottom-1-2", "left2-bottom3"],
    "right-2x2": ["right-3", "right2-bottom3"],
    "left-2x2": ["left-3", "left2-bottom3"],
    "right-4": ["right-3", "right-5"],
    "left-4": ["left-3", "left-5"],
    "bottom-4": ["bottom-3", "bottom-5"],
    "top-4": ["top-3", "top-5"],
    "grid-3x2-5": ["grid-2x2", "grid-3x2"],
    "grid-2x3-5": ["grid-2x2", "grid-2x3-6"],
    // 세로 전용 배치(가로 화면에서도 쓰던 배치를 이을 때). 세로 화면에서는 PORTRAIT_NEIGHBORS.
    "portrait-2": [null, "portrait-3"],
    "portrait-3": ["portrait-2", "portrait-4"],
    "portrait-2-bottom-2": ["portrait-3", "portrait-2-bottom-3"],
    "portrait-4": ["portrait-3", "portrait-main-2x2"],
    "portrait-main-2x2": ["portrait-2-bottom-2", "portrait-2-grid-2x2"],
    "portrait-2-bottom-3": ["portrait-2-bottom-2", "portrait-3-bottom-3"],
    "portrait-3-bottom-2": ["portrait-2-bottom-2", "portrait-4-bottom-2"],
    "portrait-2-grid-2x2": ["portrait-main-2x2", "portrait-main-2x3"],
    "portrait-3-bottom-3": ["portrait-2-bottom-3", "portrait-3-grid-2x2"],
    "portrait-4-bottom-2": ["portrait-3-bottom-2", "portrait-3-grid-2x2"],
    "portrait-main-2x3": ["portrait-2-grid-2x2", "portrait-2-grid-2x3"],
    "portrait-3-grid-2x2": ["portrait-3-bottom-3", "portrait-2-grid-2x3"],
    "portrait-2-grid-2x3": ["portrait-main-2x3", "portrait-main-2x4"],
    "portrait-main-2x4": ["portrait-2-grid-2x3", null],
    // 다섯 칸을 그대로 두고 새 채널을 채팅 위에 올린다.
    "grid-2-3": ["grid-2x2", "grid-2-3-chat-top"],
    "grid-3-2": ["grid-2x2", "grid-3-2-chat-top"],
    "right-3-chat-top": ["bottom-2-chat-top", "right-4-chat-top"],
    "left-3-chat-top": ["top-2-chat-top", "left-4-chat-top"],
    "bottom-3-chat-top": ["bottom-2-chat-top", "bottom-4-chat-top"],
    "top-3-chat-top": ["top-2-chat-top", "top-4-chat-top"],
    "grid-2x2-chat-top": ["grid-2x2", "grid-2-3-chat-top"],
    // 6채널. 7채널부터는 그리드뿐이라 보조가 있는 쪽 대신 빈 칸·채팅 방식을 잇는다.
    "right2-bottom3": ["right2-bottom2", "grid-3x2-bottom-1-0"],
    "left2-bottom3": ["left2-bottom2", "grid-3x2-bottom-1-2"],
    "right-5": ["right-4", "grid-3x2-bottom-1-0"],
    "left-5": ["left-4", "grid-3x2-bottom-1-2"],
    "bottom-5": ["bottom-4", "grid-3x2-bottom-1-0"],
    "top-5": ["top-4", "grid-3x2-bottom-1-0"],
    // 그리드 3×2·2×3 은 여섯 칸을 그대로 두고 새 채널을 채팅 위에 올린다.
    "grid-3x2": ["grid-3x2-5", "grid-3x2-chat-top"],
    "grid-2x3-6": ["grid-2x3-5", "grid-3-3-chat-top"],
    "right-4-chat-top": ["right-3-chat-top", "grid-3-3-chat-top"],
    "left-4-chat-top": ["left-3-chat-top", "grid-3-3-chat-top"],
    "bottom-4-chat-top": ["bottom-3-chat-top", "grid-3x2-chat-top"],
    "top-4-chat-top": ["top-3-chat-top", "grid-3x2-chat-top"],
    "grid-2-3-chat-top": ["grid-2x2-chat-top", "grid-3-3-chat-top"],
    "grid-3-2-chat-top": ["grid-2x2-chat-top", "grid-3-3-chat-top"],
    // 7채널
    "grid-3x2-bottom-1-0": ["grid-3x2", "grid-3x3-8"],
    "grid-3x2-bottom-1-2": ["grid-3x2", "grid-3x3-8"],
    "grid-2x3-bottom-1-0": ["grid-2x3-6", "grid-2x4"],
    "grid-3-3-chat-top": ["grid-2-3-chat-top", "grid-3-3-chat-top-2"],
    "grid-3x2-chat-top": ["grid-3x2", "grid-3x3-8"],
    // 8채널. 3×3 에서 줄이면 빈 칸이 같은 오른쪽 아래에 남는다.
    "grid-3x3-8": ["grid-3x2-bottom-1-0", "grid-3x3"],
    "grid-2x4": ["grid-2x3-bottom-1-0", "grid-3x3"],
    "grid-3-3-chat-top-2": ["grid-3-3-chat-top", "grid-3x3"],
    // 9채널
    "grid-3x3": ["grid-3x3-8", null],
    // 채팅 위 2. 줄이면 채팅 열 영상 하나를 빼고(격자는 그대로) 채팅 위 1 로 간다.
    // '오른쪽·왼쪽 2 + 채팅 위 1' 은 지웠으므로 그 둘은 채팅 위 2 를 지키는 '아래 1 + 채팅 위 2' 로.
    "bottom-1-chat-top-2": ["main-top-chat-top", "bottom-2-chat-top-2"],
    "right-2-chat-top-2": ["bottom-1-chat-top-2", "right-3-chat-top-2"],
    "left-2-chat-top-2": ["bottom-1-chat-top-2", "left-3-chat-top-2"],
    "bottom-2-chat-top-2": ["bottom-2-chat-top", "bottom-3-chat-top-2"],
    "top-2-chat-top-2": ["top-2-chat-top", "top-3-chat-top-2"],
    // 늘리면 보조 3 열이 같은 쪽에 남는 그리드 2·3 / 3·2 로.
    "right-3-chat-top-2": ["right-3-chat-top", "grid-2-3-chat-top-2"],
    "left-3-chat-top-2": ["left-3-chat-top", "grid-3-2-chat-top-2"],
    "bottom-3-chat-top-2": ["bottom-3-chat-top", "grid-3x2-chat-top"],
    "top-3-chat-top-2": ["top-3-chat-top", "grid-3x2-chat-top"],
    "grid-2x2-chat-top-2": ["grid-2x2-chat-top", "grid-2-3-chat-top-2"],
    "grid-2-3-chat-top-2": ["grid-2-3-chat-top", "grid-3-3-chat-top-2"],
    "grid-3-2-chat-top-2": ["grid-3-2-chat-top", "grid-3-3-chat-top-2"],
  };

  // 세로 화면에서 채널 수가 바뀔 때 갈 배치. [채널 −1, 채널 +1]. 세로 화면 묶음끼리 잇는다.
  const PORTRAIT_NEIGHBORS = {
    "portrait-2": [null, "portrait-3"],
    "portrait-3": ["portrait-2", "portrait-4"],
    "portrait-2-bottom-2": ["portrait-3", "portrait-2-bottom-3"],
    "portrait-4": ["portrait-3", "portrait-main-2x2"],
    "portrait-main-2x2": ["portrait-2-bottom-2", "portrait-2-grid-2x2"],
    "portrait-2-bottom-3": ["portrait-2-bottom-2", "portrait-3-bottom-3"],
    "portrait-3-bottom-2": ["portrait-2-bottom-2", "portrait-4-bottom-2"],
    "portrait-2-grid-2x2": ["portrait-main-2x2", "portrait-main-2x3"],
    "portrait-3-bottom-3": ["portrait-2-bottom-3", "portrait-3-grid-2x2"],
    "portrait-4-bottom-2": ["portrait-3-bottom-2", "portrait-3-grid-2x2"],
    "portrait-main-2x3": ["portrait-2-grid-2x2", "portrait-2-grid-2x3"],
    "portrait-3-grid-2x2": ["portrait-3-bottom-3", "portrait-2-grid-2x3"],
    "portrait-2-grid-2x3": ["portrait-main-2x3", "portrait-main-2x4"],
    "portrait-main-2x4": ["portrait-2-grid-2x3", null],
  };

  // 채널 수가 바뀌었을 때 갈 배치와 채팅 자리. 바꿀 필요가 없거나 갈 배치가 없으면 null.
  // back: 자동으로 바꾼 기록(부르는 쪽이 들고 있는 Map). 바뀐 배치를 그대로 둔 채 채널 수를
  //   되돌리면 원래 배치·채팅 자리로 돌아간다. 그 밖에는 COUNT_NEIGHBORS 를 한 칸씩 따라간다.
  function layoutForCount(currentId, count, chatSide, back = null, { portrait = false } = {}) {
    // 세로 전용 배치도 갈 수 있다(쓰던 배치가 세로 전용이면 방향과 상관없이 잇는다).
    const every = layoutsFor(count, { all: true });
    if (!every.length) return null;
    const from = layoutById(currentId);
    if (from && from.aux === every[0].aux) return null;
    // 숨긴 배치로는 가지 않는다(다 숨겨졌으면 전부).
    const visible = every.filter((l) => !layoutPrefs.hidden.has(l.id));
    const allowed = visible.length ? visible : every;
    let target = null;
    let side = null;
    const memo = from ? back?.get(`${from.id}>${count}`) : null;
    const remembered = memo && allowed.find((l) => l.id === memo.layoutId);
    // 이 채널 수의 기본 배치를 정해 두었으면 '비슷한 배치' 보다 먼저 쓴다.
    // ⚠ 자동으로 바꾼 기록(되돌리면 원래 배치로)은 그보다 앞선다 — 채널 하나 넣었다 뺐을 때
    //   쓰던 배치로 돌아오는 게 자연스럽다.
    const preferred = remembered ? null : defaultLayoutFor(count);
    if (remembered) {
      target = remembered;
      side = chatSidesFor(target).includes(memo.chatSide) ? memo.chatSide : null;
    } else if (preferred) {
      target = preferred;
    } else if (from) {
      // 세로 화면이거나 세로 전용 배치를 쓰는 중이면 세로 배치끼리 잇는다.
      const portraitWalk = portrait || from.portrait === true;
      let id = from.id;
      for (let aux = from.aux; id && aux !== allowed[0].aux; aux += aux < allowed[0].aux ? 1 : -1) {
        const step = aux < allowed[0].aux ? 1 : 0;
        id = (portraitWalk && PORTRAIT_NEIGHBORS[id]?.[step]) || COUNT_NEIGHBORS[id]?.[step] || null;
      }
      target = allowed.find((l) => l.id === id) || null;
      // 가로 화면에서 세로 전용 배치로 넘어가는 건 쓰던 배치가 세로 전용일 때뿐이다.
      if (target?.portrait && !portraitWalk) target = null;
    }
    target ||= layoutsFor(count, { portrait })[0];
    side ||= chatSideForSwitch(target, chatSide);
    if (back && from) back.set(`${target.id}>${from.aux + 1}`, { layoutId: from.id, chatSide });
    return { layoutId: target.id, chatSide: side };
  }

  // 배치 + 채팅 위치 → 바깥 컨테이너에 줄 스타일.
  // ⚠ 채팅을 grid 안에 넣지 않는다. 프레임 격자는 그대로 두고 바깥에서
  //   flex 로 감싸야 채팅을 접었다 폈을 때 격자가 다시 계산되지 않는다.
  function stageStyle(layout, chatSide) {
    // 고른 자리가 유효하면 그대로 쓰고, 없으면 이 배치의 기본 자리로 되돌린다.
    const sides = chatSidesFor(layout);
    const side = sides.includes(chatSide) ? chatSide : sides[0] || "right";
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

  function chatTopStageGrid(layout, side, hideChat = false) {
    if (!layout?.chatTop) return null;
    const videoSlot = SLOTS[layout.aux];
    const left = side === "left";
    const chatWidth = "minmax(0, min(var(--mv-chat-w, 370px), 60%))";
    const columns = left
      ? `${chatWidth} 6px ${layout.coreColumns}`
      : `${layout.coreColumns} 6px ${chatWidth}`;
    if (layout.chatTopVideos === 2) {
      // 채팅 열: [영상 f][영상 g][손잡이][채팅]. 영상 높이 T 는 손잡이로 정하고 둘이 같다.
      // 격자 줄(칸 경계가 있는 줄만)과 채팅 열 경계가 섞여도 순서가 바뀌지 않게 T 를 묶는다.
      //  · 첫 줄이 40% 이상이면 영상 둘·손잡이를 첫 줄 안에 둔다: T ≤ (첫 줄 − 12px) / 2.
      //  · 아니면 g 가 첫 줄 경계를 넘어 둘째 줄 안에서 끝난다:
      //    첫 줄 / 2 ≤ T ≤ min(첫 줄 − 8px, (두 줄 − 12px) / 2).
      // 줄 간격(2px)·손잡이(6px)를 빼서 맞춘다.
      const [first, second] = SLOTS.slice(layout.aux - 1, layout.aux + 1);
      const macro = macroRows(layout.areas, layout.rows, true);
      const row = (cells, edge) => areaRow(left ? [edge, "z", ...cells] : [...cells, "z", edge]);
      const pct = (share) => `${Math.round(share * 1e6) / 1e4}%`;
      const rest = (rows) => rows.map((item) => `minmax(0, ${fraction(item.share)})`);
      if (hideChat) {
        // 채팅 열을 영상 둘이 반씩 쓴다(격자 줄에 1/2 경계를 더한다).
        const parts = splitRows(macro, [0.5]);
        return {
          areas: parts.map((part) => row(part.cells, part.end <= 0.5 ? first : second)).join(" "),
          columns,
          rows: parts.map((part) => `minmax(0, ${fraction(part.end - part.start)})`).join(" "),
        };
      }
      const height = "var(--mv-chat-top-h, calc(min(var(--mv-chat-w, 370px), 60vw) * 9 / 16))";
      const s1 = pct(macro[0].share);
      if (macro[0].share >= 0.4) {
        const top = `min(${height}, calc((${s1} - 12px) / 2))`;
        const after = rest(macro.slice(1));
        return {
          areas: [row(macro[0].cells, first), row(macro[0].cells, second), row(macro[0].cells, "y"),
            row(macro[0].cells, "x"), ...macro.slice(1).map((item) => row(item.cells, "x"))].join(" "),
          columns,
          rows: [`minmax(0, ${top})`, `minmax(0, ${top})`, "6px",
            after.length ? `minmax(0, calc(${s1} - 2 * ${top} - 12px))` : "minmax(0, 1fr)", ...after].join(" "),
        };
      }
      const s12 = pct(macro[0].share + macro[1].share);
      const top = `clamp(calc(${s1} / 2), ${height}, min(calc(${s1} - 8px), calc((${s12} - 12px) / 2)))`;
      const after = rest(macro.slice(2));
      return {
        areas: [row(macro[0].cells, first), row(macro[0].cells, second), row(macro[1].cells, second),
          row(macro[1].cells, "y"), row(macro[1].cells, "x"), ...macro.slice(2).map((item) => row(item.cells, "x"))].join(" "),
        columns,
        rows: [`minmax(0, ${top})`, `minmax(0, calc(${s1} - ${top} - 2px))`, `minmax(0, calc(2 * ${top} - ${s1}))`,
          "6px", after.length ? `minmax(0, calc(${s12} - 2 * ${top} - 10px))` : "minmax(0, 1fr)", ...after].join(" "),
      };
    }
    if (layout.chatTopSplit) {
      // 격자 줄은 배치 비율 그대로 두고, 채팅 열의 위 영상(높이 조절)은 격자 첫 줄 안에서만
      // 나눈다. 줄: [위 영상] [손잡이] [첫 줄 나머지] [나머지 격자 줄...]. 위 영상은 첫 줄을
      // 넘지 않는다.
      const fr = layout.rows.split(/\s+/).map((value) => parseFloat(value));
      const share = `${Math.round((fr[0] / fr.reduce((sum, value) => sum + value, 0)) * 1e6) / 1e4}%`;
      const cores = layout.areas.map((row) => row.replace(/"/g, "").trim().split(/\s+/).slice(0, -1));
      const row = (cells, edge) => areaRow(left ? [edge, "z", ...cells] : [...cells, "z", edge]);
      if (hideChat) {
        return { areas: cores.map((cells) => row(cells, videoSlot)).join(" "), columns, rows: layout.rows };
      }
      const [first, ...rest] = cores;
      const top = `min(var(--mv-chat-top-h, calc(min(var(--mv-chat-w, 370px), 60vw) * 9 / 16)), calc(${share} - 8px))`;
      return {
        areas: [row(first, videoSlot), row(first, "y"), row(first, "x"), ...rest.map((cells) => row(cells, "x"))].join(" "),
        columns,
        rows: [`minmax(0, ${top}) 6px minmax(0, calc(${share} - ${top} - 8px))`,
          ...fr.slice(1).map((value) => `minmax(0, ${value}fr)`)].join(" "),
      };
    }
    const areas = layout.areas.map((row, index) => {
      const cells = row.replace(/"/g, "").trim().split(/\s+/);
      const edge = cells.pop();
      const last = hideChat && edge === "x" ? videoSlot : edge;
      const current = areaRow(left ? [last, "z", ...cells] : [...cells, "z", last]);
      if (index !== 0 || hideChat) return [current];
      return [current, areaRow(left ? ["y", "z", ...cells] : [...cells, "z", "y"])];
    }).flat();
    return {
      areas: areas.join(" "),
      columns,
      rows: hideChat ? layout.rows :
        `minmax(0, min(var(--mv-chat-top-h, calc(min(var(--mv-chat-w, 370px), 60vw) * 9 / 16)), calc(100% - 160px))) 6px repeat(${layout.areas.length - 1}, minmax(0, 1fr))`,
    };
  }

  // 한 칸 크게 보기가 덮을 영상 영역(스테이지 Grid 의 grid-area). 채팅은 덮지 않는다.
  // 일반 배치는 null — 칸이 프레임 래퍼(mvFramesFit) 전체를 덮는다(Grid 밖 기준).
  // 채팅 위 1 은 채팅 열(손잡이 z 포함)을 뺀 격자, 채팅을 접거나 분리하면 채팅 열의 영상까지.
  // 빈 칸 채팅은 채팅이 격자 안에 있어 격자 전체를 덮는다.
  function expandedArea(layout, side, hideChat = false) {
    if (!layout?.chatTop && !usesChatInset(layout, side)) return null;
    if (!layout.chatTop || hideChat) return "1 / 1 / -1 / -1";
    const core = layout.areas[0].replace(/"/g, "").trim().split(/\s+/).length - 1;
    return side === "left" ? "1 / 3 / -1 / -1" : `1 / 1 / -1 / ${core + 1}`;
  }

  // ── 칸 크기 조절(경계 끌기) ──
  // 조절하는 격자: 일반 배치는 프레임 격자의 열·행, 빈 칸 채팅은 스테이지 격자의 열·행,
  // 채팅 위 배치는 채팅 열을 뺀 격자 열만(행은 채팅 열 위 영상 높이와 맞물려 있다).
  function resizableAxes(layout) {
    if (!layout) return [];
    return layout.chatTop ? ["columns"] : ["columns", "rows"];
  }

  // 크기를 조절할 격자의 칸 배치표(행마다 칸 이름 배열). 채팅 위 배치는 채팅 열을 뺀다.
  // inset: 빈 칸 채팅을 쓰는지, hideChat: 채팅을 접었거나 분리했는지.
  function resizeGrid(layout, inset = false, hideChat = false) {
    const rows = inset ? chatInsetStageGrid(layout, hideChat).areas.split(/(?<=")\s+(?=")/) : layout.areas;
    return rows.map((row) => {
      const cells = row.replace(/"/g, "").trim().split(/\s+/);
      return layout.chatTop ? cells.slice(0, -1) : cells;
    });
  }

  // 끌 수 있는 경계. 이웃한 두 열(행) 사이에서 칸이 바뀌는 곳만 경계다.
  // 반환: [{ index(앞 트랙 번호), edges: [{ line(가로지르는 행·열 번호), a, b(양쪽 칸 이름) }] }]
  // 빈 칸('.')끼리 맞닿은 곳은 경계가 아니다.
  function trackBoundaries(grid, axis) {
    const rows = grid.length;
    const cols = grid[0]?.length || 0;
    const tracks = axis === "columns" ? cols : rows;
    const lines = axis === "columns" ? rows : cols;
    const at = (track, line) => (axis === "columns" ? grid[line][track] : grid[track][line]);
    const out = [];
    for (let index = 0; index + 1 < tracks; index += 1) {
      const edges = [];
      for (let line = 0; line < lines; line += 1) {
        const a = at(index, line);
        const b = at(index + 1, line);
        if (a !== b && !(a === "." && b === ".")) edges.push({ line, a, b });
      }
      if (edges.length) out.push({ index, edges });
    }
    return out;
  }

  // 사용자 크기(fr 비율 배열) → grid-template 값.
  function trackTemplate(sizes) {
    return sizes.map((value) => `minmax(0, ${Math.round(value * 1e4) / 1e4}fr)`).join(" ");
  }

  // 빈 칸(. 또는 x)을 채팅 자리로 쓴다. 채팅을 접거나 분리하면 다시 빈 칸이다.
  function chatInsetStageGrid(layout, hideChat = false) {
    if (!layout?.chatInsetOption) return null;
    const slot = hideChat ? "." : "x";
    // 내 배치는 채팅 칸(x)이 따로 있다 — 다른 빈 칸(.)까지 채팅으로 바꾸면 떨어진 x 들로 격자가 깨진다.
    const target = layout.custom ? /(?<=["\s])x(?=["\s])/g : /(?<=["\s])[.x](?=["\s])/g;
    return {
      areas: layout.areas.map((row) => row.replace(target, slot)).join(" "),
      columns: layout.columns,
      rows: layout.rows,
    };
  }

  // 배치의 areas 를 읽어 각 슬롯이 차지하는 행·열 범위를 구한다.
  function slotSpans(layout) {
    const grid = layout.areas.map((row) =>
      row.replace(/"/g, "").trim().split(/\s+/),
    );
    const spans = {};
    grid.forEach((row, ri) =>
      row.forEach((slot, ci) => {
        if (slot === "." || slot === "x") return;
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
    // ⚠ 세로 전용 배치는 칸 안에서 16:9 로 맞춘다(격자 비율을 풀지 않는다). 한 열로 쌓는
    //   배치(세로 2·3·4단)는 풀 수는 있지만 줄 사이 간격을 빼지 않은 비율이라, 줄이 늘수록
    //   칸이 16:9 에서 벗어났다(실측 4단 1.786).
    if (layout.chatTop || layout.portrait) return null;
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
    if (widths.some((w) => w === null)) {
      // 내 배치: 한 열짜리 칸이 없는 열(대칭 모양의 빈 칸 열 등)이 있으면, 열을 모두 같은 너비로 두고
      // 모든 칸이 16:9 가 되는지 본다(칸마다 너비 = 16/9 × 행 수 ÷ 열 수 가 같아야 한다).
      if (!layout.custom) return null;
      const spansList = Object.values(spans);
      const unit = R * (spansList[0].r1 - spansList[0].r0 + 1) / (spansList[0].c1 - spansList[0].c0 + 1);
      if (!spansList.every((span) => Math.abs(R * (span.r1 - span.r0 + 1) / (span.c1 - span.c0 + 1) - unit) < 1e-6)) return null;
      widths.fill(unit);
    }
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

  // 배치 고르기 미리보기. 그 배치의 기본 채팅 자리(빈 칸·채팅 위 영상)를 함께 그린다.
  // '채팅 위 1' 은 빈 칸이 아니라 영상 격자 옆에 따로 붙는 채팅 열이다(너비 조절 가능).
  // 빈 칸 채팅과 구분되게 격자와 채팅 열 사이에 손잡이(z)를 그린다(실제 화면의 손잡이 자리).
  function previewGrid(layout) {
    if (layout?.chatTop) {
      const areas = layout.areas.map((row) => {
        const cells = row.replace(/"/g, "").trim().split(/\s+/);
        const edge = cells.pop();
        return areaRow([...cells, "z", edge]);
      });
      return {
        columns: `${layout.coreColumns} 2px 1fr`,
        rows: layout.rows,
        ratio: "16/9",
        areas: areas.join(" "),
        chat: true,
        handle: true,
      };
    }
    const inset = usesChatInset(layout, chatSidesFor(layout)[0]);
    const tracks = inset ? null : solveTracks(layout);
    return {
      columns: tracks ? tracks.columns : layout.columns,
      rows: tracks ? tracks.rows : layout.rows,
      ratio: tracks ? String(tracks.ratio) : "16/9",
      areas: inset ? chatInsetStageGrid(layout).areas : layout.areas.join(" "),
      chat: inset,
      handle: false,
    };
  }

  const api = {
    LAYOUTS,
    SLOTS,
    CHAT_SIDES,
    CHAT_INSET_SIDE,
    chatSidesFor,
    usesChatInset,
    chatSideForSwitch,
    preferredChatSide,
    previewGrid,
    layoutsFor,
    isPortraitGroup,
    PORTRAIT_ORDER,
    layoutById,
    COUNT_NEIGHBORS,
    layoutForCount,
    stageStyle,
    chatTopStageGrid,
    chatInsetStageGrid,
    expandedArea,
    resizableAxes,
    resizeGrid,
    trackBoundaries,
    trackTemplate,
    slotSpans,
    solveTracks,
    CUSTOM_GRID_MAX,
    CUSTOM_MAX,
    CHAT_CELLS,
    isChatCell,
    MAX_CHANNELS_BUILTIN,
    MAX_CHANNELS_CUSTOM,
    maxChannels,
    hasLayoutFor,
    emptyIsRectangle,
    checkCustomCells,
    normalizeCustomLayout,
    compactCells,
    LAYOUT_PREFS_KEY,
    normalizeLayoutPrefs,
    setLayoutPrefs,
    getLayoutPrefs,
    isLayoutHidden,
    defaultLayoutFor,
    customLayoutDef,
    setCustomLayouts,
    registerCustomLayout,
    newCustomLayoutId,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewLayouts = api;
})();
