// 한 칸 크게 보기: 칸(iframe)을 옮기지 않고 영상 영역 위에 겹쳐 띄운다.
//
// 덮는 영역은 영상 영역뿐이다(채팅은 그대로). 일반 배치는 프레임 래퍼 전체, 채팅 위 1 은 채팅 열을
// 뺀 스테이지 Grid, 빈 칸 채팅은 격자 전체(채팅 칸 포함). 소리·화질·재생은 바꾸지 않는다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const L = require("../src/multiviewLayouts.js");
const watch = fs.readFileSync(path.join(__dirname, "../src/multiviewWatch.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/multiview.css"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = watch.indexOf(`  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return watch.slice(at, watch.indexOf("\n  }\n", at) + 4);
};

// 덮는 영역(스테이지 Grid 의 grid-area)
check(L.expandedArea(L.layoutById("grid-2x2"), "right") === null &&
  L.expandedArea(L.layoutById("right-3"), "bottom") === null,
  "일반 배치는 Grid 자리를 쓰지 않는다(프레임 래퍼 전체를 덮는다)");
check(L.expandedArea(L.layoutById("grid-2x2-chat-top"), "right") === "1 / 1 / -1 / 3" &&
  L.expandedArea(L.layoutById("main-chat-top"), "right") === "1 / 1 / -1 / 2" &&
  L.expandedArea(L.layoutById("grid-2-3-chat-top"), "left") === "1 / 3 / -1 / -1",
  "채팅 위 1: 채팅 열과 손잡이를 뺀 격자(좌우 모두)");
check(L.LAYOUTS.filter((l) => l.chatTop).every((layout) => {
  const core = layout.areas[0].replace(/"/g, "").trim().split(/\s+/).length - 1;
  const right = L.chatTopStageGrid(layout, "right").columns;
  // 오른쪽 채팅 Grid 의 열 수 = 격자 열 + 손잡이 + 채팅 열.
  return L.expandedArea(layout, "right") === `1 / 1 / -1 / ${core + 1}` &&
    right.endsWith("6px minmax(0, min(var(--mv-chat-w, 370px), 60%))");
}), "채팅 위 1 모든 배치에서 격자 열 수가 맞다");
check(L.expandedArea(L.layoutById("grid-2x2-chat-top"), "right", true) === "1 / 1 / -1 / -1",
  "채팅 위 1 에서 채팅을 접거나 분리하면 채팅 열의 영상까지 영상 영역이다");
check(L.expandedArea(L.layoutById("grid-3x2-5"), "inset") === "1 / 1 / -1 / -1" &&
  L.expandedArea(L.layoutById("grid-3x2-5"), "right") === null,
  "빈 칸 채팅은 격자 전체, 같은 배치라도 바깥 채팅이면 일반 배치처럼");

// 시청 화면 연결
check(/expand\.dataset\.mvExpand = channel\.channelId;/.test(watch) &&
  /tools\.appendChild\(expand\);\s*tools\.appendChild\(change\);\s*tools\.appendChild\(close\);/.test(watch),
  "칸 도구 모음(오른쪽 위)에 크게 보기 단추가 있다");
// 자리 바꾸기 손잡이는 왼쪽 위 '메인으로' 위에, 사이를 띄워 세로로(끌려다 '메인으로'를 누르지 않게).
check(/lead\.className = "mv-cell-lead";[\s\S]{0,200}lead\.appendChild\(grip\);\s*lead\.appendChild\(promote\);/.test(watch) &&
  /cell\.appendChild\(tools\);\s*cell\.appendChild\(lead\);/.test(watch) &&
  /\.mv-cell-lead \{[^}]*flex-direction: row;[^}]*gap: 10px;[^}]*left: 8px;[^}]*top: 8px;/.test(css) &&
  /@container \(max-width: 240px\) \{\s*\.mv-cell-lead \{\s*align-items: flex-start;\s*flex-direction: column;/.test(css),
  "손잡이는 왼쪽 위 '메인으로' 앞에 10px 띄워 가로로, 좁아서 오른쪽 위 도구와 겹칠 칸(240px 이하)에서만 세로로");
check(/const expand = target\.closest\?\.\("\[data-mv-expand\]"\);\s*if \(expand\) \{\s*const id = expand\.dataset\.mvExpand;\s*setExpanded\(expandedChannelId === id \? "" : id\);/.test(watch),
  "단추를 다시 누르면 원래대로");
check(/applyExpandedCell\(layout, side, hideChat\);\s*stage\.style\.flexDirection/.test(sliceFn("applyLayout")),
  "배치·채팅 자리·채팅 접기가 바뀔 때마다 다시 맞춘다(칸 자리를 정한 뒤)");
{
  const esc = watch.slice(watch.indexOf("// 열린 패널이 있으면 그것만 닫는다."), watch.indexOf("// 열린 패널이 있으면 그것만 닫는다.") + 400);
  check(/const panelOpen = !\$\("mvQuick"\)\.hidden \|\|/.test(esc) &&
    /if \(!panelOpen && expandedChannelId\) setExpanded\(""\);/.test(esc),
    "Esc: 열린 패널이 있으면 패널만 닫고, 없을 때 크게 보기를 푼다");
}

// applyExpandedCell 동작
{
  const mkCell = () => {
    const classes = new Set();
    const attrs = {};
    const button = { dataset: {}, setAttribute: (k, v) => { attrs[k] = v; } };
    return {
      classes, attrs, button,
      style: { gridArea: "a" },
      classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
      querySelector: () => button,
    };
  };
  const cells = new Map([["c1", mkCell()], ["c2", mkCell()]]);
  const stageClasses = new Set();
  const ctx = {
    cells,
    state: { chosen: [{ channelId: "c1" }, { channelId: "c2" }] },
    LAYOUTS: L,
    channelName: (id) => id,
    $: () => ({ classList: { toggle: (name, on) => (on ? stageClasses.add(name) : stageClasses.delete(name)) } }),
    applyLayout: () => ctx.applyExpandedCell(L.layoutById("grid-2x2-chat-top"), "right", false),
  };
  vm.createContext(ctx);
  vm.runInContext(`let expandedChannelId = "";\n${sliceFn("setExpanded")}\n${sliceFn("applyExpandedCell")}
    this.setExpanded = setExpanded; this.applyExpandedCell = applyExpandedCell;
    this.current = () => expandedChannelId;`, ctx);
  ctx.setExpanded("c2");
  const [c1, c2] = [cells.get("c1"), cells.get("c2")];
  check(c2.classes.has("is-expanded") && !c1.classes.has("is-expanded") && stageClasses.has("has-expanded-cell") &&
    c2.style.gridArea === "1 / 1 / -1 / 3" && c1.style.gridArea === "a",
    "고른 칸만 크게, 채팅 위 1 에서는 채팅 열을 뺀 Grid 자리");
  check(c2.attrs["aria-pressed"] === "true" && c2.button.dataset.tooltip === "원래 크기로 (Esc)" &&
    c1.attrs["aria-pressed"] === "false" && c1.button.dataset.tooltip === "크게 보기",
    "단추 표시가 상태를 따른다");
  ctx.state.chosen = [{ channelId: "c1" }];
  ctx.applyLayout();
  check(ctx.current() === "" && !c2.classes.has("is-expanded") && !stageClasses.has("has-expanded-cell"),
    "크게 본 채널이 빠지면 풀린다");
  ctx.setExpanded("없는칸");
  check(ctx.current() === "", "없는 칸은 크게 보지 않는다");
}

// CSS
{
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `${selector} 규칙이 없다`);
    return css.slice(at, css.indexOf("}", at));
  };
  const expanded = rule(".mv-cell.is-expanded");
  const zOf = (block) => Number(/z-index:\s*(\d+)/.exec(block)?.[1]);
  check(/position: absolute;/.test(expanded) && /inset: 0;/.test(expanded),
    "칸을 옮기지 않고 겹쳐 띄운다(absolute)");
  check(zOf(expanded) < zOf(rule(".mv-quick")), "채널 관리 패널은 크게 본 칸 위에 뜬다");
  check(/\n\.mv-frames-fit \{[^}]*position: relative;/.test(css) &&
    /\.mv-stage:is\(\.is-chat-top-layout, \.is-chat-inset-layout\) \.mv-frames-fit,\s*\.mv-stage:is\(\.is-chat-top-layout, \.is-chat-inset-layout\) \.mv-frames \{\s*display: contents;/.test(css),
    "기준: 일반 배치는 프레임 래퍼, 채팅 위 1·빈 칸 채팅은 스테이지 Grid");
  check(/\.mv-frames\.is-exact \.mv-cell\.is-expanded \.mv-cell-inner \{\s*height: min\(100%, \(100cqw \* 9 \/ 16\)\);\s*width: min\(100%, \(100cqh \* 16 \/ 9\)\);/.test(css),
    "정확 배치에서도 크게 본 칸 안 상자는 16:9");
  check(/\.mv-stage\.has-expanded-cell \.mv-cell:not\(\.is-expanded\) > :not\(\.mv-cell-inner\) \{\s*visibility: hidden;/.test(css),
    "가려진 칸은 단추·안내만 숨기고 영상(상자)은 그대로 둔다");
  check(/\.mv-cell\.is-expanded \.mv-cell-grip \{\s*display: none;/.test(css), "크게 보는 동안 자리 바꾸기 손잡이를 숨긴다");
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
