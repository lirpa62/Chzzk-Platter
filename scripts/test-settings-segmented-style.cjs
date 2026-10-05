// 설정 세그먼트 버튼 모양.
//
// - 하위 옵션 행의 왼쪽 선·배경(::before)이 버튼 위에 그려져 버튼을 회색으로 물들였다.
//   배경은 행 안에서 내용 뒤로 보낸다(isolation + z-index: -1).
// - 공용 토글 표로 늦게 불러온 상위 옵션은 하위 옵션 잠금을 다시 맞추지 않아, 켜 둔 상위
//   옵션 아래 하위 옵션이 잠긴 채 흐리게 남았다(칸 크기 기억 등).
// - '따라잡기 방식'처럼 설명 아래 넓게 두는 세그먼트: 게인 재방문 동작·시간 표시 형식·
//   기기 아이콘 위치·칸 크기 기억.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const css = read("src/settings.css");
const settings = read("src/settings.js");
const html = read("settings.html");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const block = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} 규칙이 없다`);
  return css.slice(at, css.indexOf("}", at));
};

check(/isolation: isolate;/.test(block(".settings-item-child")) && /z-index: -1;/.test(block(".settings-item-child::before")),
  "하위 옵션 행의 선·배경은 행 안에서 내용 뒤에 그린다(버튼을 물들이지 않는다)");
check(/input\.checked = on;\s*\/\/[^\n]*\n[^\n]*\n\s*settingsDisclosures\?\.refresh\?\.\(\);/.test(settings),
  "공용 토글 표로 저장값을 채우면 하위 옵션 잠금을 다시 맞춘다");

const fullWidth = css.slice(css.indexOf(".settings-segmented[data-live-viewer-count-position],"),
  css.indexOf("width: 100%;", css.indexOf(".settings-segmented[data-live-viewer-count-position],")));
// 설명 오른쪽 아래로 미는(margin-left: auto) 세그먼트 목록.
const pushedAt = css.indexOf("\n.settings-item [data-mixer-global-gain-default],");
const pushedRight = css.slice(css.lastIndexOf("}", pushedAt), css.indexOf("margin-left: auto;", pushedAt));
assert.ok(pushedAt > 0 && pushedRight.includes("[data-chat-recap-retention]"), "오른쪽 정렬 목록을 찾지 못했다");
for (const attr of ["data-mixer-global-default-mode", "data-mixer-global-gain-default-mode", "data-chat-time-format",
  "data-chat-os-position", "data-multiview-track-memory"]) {
  check(fullWidth.includes(`.settings-segmented[${attr}]`) && !pushedRight.includes(`[${attr}]`) &&
    css.includes(`.settings-item:has([${attr}])`),
    `${attr}: 설명 아래 넓게(따라잡기 방식과 같은 모양)`);
}
for (const attr of ["data-mixer-global-default-mode", "data-mixer-global-gain-default-mode"]) {
  const seg = html.slice(html.indexOf(`${attr}\n`), html.indexOf("</div>", html.indexOf(`${attr}\n`)));
  check(!seg.includes("settings-segmented-btn"), `${attr}: 버튼도 따라잡기 방식과 같은 마크업`);
}
check(/\.settings-segmented\[data-multiview-track-memory\] button \{\s*word-break: keep-all;\s*justify-content: center;/.test(css),
  "칸 크기 기억 버튼: 단어 중간에서 줄을 바꾸지 않고 가운데 정렬(배지 클릭 동작과 같게)");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
