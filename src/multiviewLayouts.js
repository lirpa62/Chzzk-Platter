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
      label: "오른쪽 2+아래 2",
      aux: 4,
      columns: "1fr 1fr 1fr",
      rows: "1fr 1fr 1fr",
      areas: ['"m m a"', '"m m b"', '"c d ."'],
      chat: ["left", "bottom"],
      chatInsetOption: true,
    },
    {
      id: "left2-bottom2",
      label: "왼쪽 2+아래 2",
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
      label: "오른쪽 2+아래 3",
      aux: 5,
      columns: "repeat(3, 1fr)",
      rows: "1fr 1fr 1fr",
      areas: ['"m m a"', '"m m b"', '"c d e"'],
      chat: ["left", "bottom"],
    },
    {
      id: "left2-bottom3",
      label: "왼쪽 2+아래 3",
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

  const SLOTS = ["m", "a", "b", "c", "d", "e"];
  const POSITIONS = ["왼쪽", "가운데", "오른쪽"];
  const VERTICAL_POSITIONS = ["위", "가운데", "아래"];
  const SIDES = { right: "오른쪽", left: "왼쪽", top: "위", bottom: "아래" };
  const areaRow = (cells) => `"${cells.join(" ")}"`;

  // 일반 배치에서 채팅을 놓을 수 있는 자리.
  // ⚠ "top" 은 넣지 않는다. 위쪽 채팅은 영상보다 먼저 읽히는 자리라 시선이 튄다.
  const CHAT_SIDES = ["right", "left", "bottom"];
  // 빈 칸이 직사각형 하나로 남는 배치(chatInsetOption)에서 고를 수 있는 '빈 칸' 자리.
  // 기본값인지는 배치의 chat 순서가 정한다(그리드처럼 빈 칸이 한 칸뿐이면 채팅이
  // 좁아 바깥이 기본이다).
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
      const single = [".", ".", ".", "."];
      single[position] = "m";
      single[position + 1] = "m";
      const pair = ["a", "a", "b", "b"];
      const rows = pairSide === "top" ? [pair, single] : [single, pair];
      // 가운데는 빈 칸이 양쪽으로 갈라져 채팅 한 칸을 만들 수 없다.
      LAYOUTS.push({
        id: `${pairSide}-2-single-${position}`,
        label: `${SIDES[pairSide]} 2 + ${pairSide === "top" ? "아래" : "위"} 1 · ${POSITIONS[position]}`,
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

  // 채팅 열의 첫 행에 마지막 보조 채널을 둔다. x는 그 아래 채팅 패널 자리다.
  // 영상 칸은 언제나 mvFrames 안에 남겨 iframe 재로드 없이 Grid 상에서만 이동한다.
  function addChatTop(base, id = `${base.id}-chat-top`) {
    const videoSlot = SLOTS[base.aux + 1];
    const rows = base.areas.length === 1 ? [base.areas[0], base.areas[0]] : base.areas;
    const areas = rows.map((row, index) => {
      const cells = row.replace(/"/g, "").trim().split(/\s+/);
      return areaRow([...cells, index === 0 ? videoSlot : "x"]);
    });
    LAYOUTS.push({
      id,
      label: `${base.label} + 채팅 위 1`,
      aux: base.aux + 1,
      columns: `${base.columns} 1fr`,
      coreColumns: base.columns,
      rows: rows.length === base.areas.length ? base.rows : "1fr 1fr",
      areas,
      chat: ["right", "left"],
      chatTop: true,
      flexible: true,
    });
  }

  addChatTop({ id: "main", label: "메인", aux: 0, columns: "1fr", rows: "1fr", areas: ['"m"'] });
  for (const id of ["top-2", "bottom-2",
    "grid-2x2", "right-3", "left-3", "top-3", "bottom-3",
    "right-4", "left-4", "top-4", "bottom-4"]) {
    addChatTop(LAYOUTS.find((layout) => layout.id === id));
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
    const areas = layout.areas.map((row, index) => {
      const cells = row.replace(/"/g, "").trim().split(/\s+/);
      const edge = cells.pop();
      const last = hideChat && edge === "x" ? videoSlot : edge;
      const current = areaRow(left ? [last, "z", ...cells] : [...cells, "z", last]);
      if (index !== 0 || hideChat) return [current];
      return [current, areaRow(left ? ["y", "z", ...cells] : [...cells, "z", "y"])];
    }).flat();
    const chatWidth = "minmax(0, min(var(--mv-chat-w, 370px), 60%))";
    return {
      areas: areas.join(" "),
      columns: left
        ? `${chatWidth} 6px ${layout.coreColumns}`
        : `${layout.coreColumns} 6px ${chatWidth}`,
      rows: hideChat ? layout.rows :
        `minmax(0, min(var(--mv-chat-top-h, calc(min(var(--mv-chat-w, 370px), 60vw) * 9 / 16)), calc(100% - 160px))) 6px repeat(${layout.areas.length - 1}, minmax(0, 1fr))`,
    };
  }

  // 빈 칸(. 또는 x)을 채팅 자리로 쓴다. 채팅을 접거나 분리하면 다시 빈 칸이다.
  function chatInsetStageGrid(layout, hideChat = false) {
    if (!layout?.chatInsetOption) return null;
    const slot = hideChat ? "." : "x";
    return {
      areas: layout.areas.map((row) => row.replace(/(?<=["\s])[.x](?=["\s])/g, slot)).join(" "),
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
    if (layout.chatTop) return null;
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

  // 배치 고르기 미리보기. 그 배치의 기본 채팅 자리(빈 칸·채팅 위 영상)를 함께 그린다.
  function previewGrid(layout) {
    const inset = usesChatInset(layout, chatSidesFor(layout)[0]);
    const tracks = inset ? null : solveTracks(layout);
    return {
      columns: tracks ? tracks.columns : layout.columns,
      rows: tracks ? tracks.rows : layout.rows,
      ratio: tracks ? String(tracks.ratio) : "16/9",
      areas: inset ? chatInsetStageGrid(layout).areas : layout.areas.join(" "),
      chat: inset || layout.chatTop === true,
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
    previewGrid,
    layoutsFor,
    layoutById,
    stageStyle,
    chatTopStageGrid,
    chatInsetStageGrid,
    slotSpans,
    solveTracks,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseMultiviewLayouts = api;
})();
