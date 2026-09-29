const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const watch = fs.readFileSync(path.join(root, "src/multiviewWatch.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/multiview.css"), "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
const start = watch.indexOf("  function renderQuality() {");
const end = watch.indexOf("\n  }\n", start);
const renderSource = watch.slice(start, end + 4);

// 원본 renderQuality 를 가짜 패널로 돌려 DOM 쓰기 횟수를 센다.
let htmlWrites = 0;
let attrWrites = 0;
let textWrites = 0;
let innerHTML = "";
const panel = {
  hidden: false,
  attrs: {},
  get childElementCount() { return innerHTML ? 1 : 0; },
  get innerHTML() { return innerHTML; },
  set innerHTML(value) { innerHTML = value; htmlWrites += 1; },
  getAttribute(name) { return this.attrs[name] ?? null; },
  setAttribute(name, value) { this.attrs[name] = value; attrWrites += 1; },
};
const valueEl = {
  _text: "",
  get textContent() { return this._text; },
  set textContent(value) { this._text = value; textWrites += 1; },
};
const ctx = {
  $: (id) => (id === "mvQualityPop" ? panel : id === "mvQualityValue" ? valueEl : null),
  state: { chosen: [{ channelId: "a", channelName: "A" }, { channelId: "b", channelName: "B" }] },
  currentStatus: () => "ready",
  qualityRequestByChannel: new Map(),
  qualityPending: new Map(),
  qualityFeedback: new Map(),
  qualityByChannel: new Map([
    ["a", { ready: true, selected: "1080", output: "1920x1080", choices: [
      { value: "1080", label: "1080p" }, { value: "720", label: "720p" }] }],
    ["b", { ready: true, selected: "720", output: "", choices: [
      { value: "1080", label: "1080p" }, { value: "720", label: "720p" }] }],
  ]),
  esc: (value) => String(value),
};
vm.runInNewContext(`let qualityPanelHtml = "";\n${renderSource}\nglobalThis.renderQuality = renderQuality;`,
  Object.assign(ctx, { globalThis: ctx }));

ctx.renderQuality();
check(htmlWrites === 1 && attrWrites === 1 && textWrites === 1, "처음 열 때 한 번 그린다");
for (let i = 0; i < 10; i += 1) ctx.renderQuality();
check(htmlWrites === 1 && attrWrites === 1 && textWrites === 1,
  "폴링·응답으로 여러 번 불려도 내용이 같으면 DOM 을 건드리지 않는다");
ctx.qualityByChannel.get("b").selected = "1080";
ctx.renderQuality();
check(htmlWrites === 2 && /aria-pressed="true"/.test(innerHTML), "화질이 실제로 바뀌면 다시 그린다");
ctx.qualityPending.set("a", {});
ctx.renderQuality();
check(attrWrites === 2 && panel.attrs["aria-busy"] === "true", "변경 중 표시(aria-busy)는 값이 바뀔 때만 쓴다");
innerHTML = "";
ctx.renderQuality();
check(htmlWrites === 4 && innerHTML.length > 0, "다른 곳에서 패널을 비웠으면 같은 내용이어도 다시 그린다");

// 색 토큰을 멀티뷰 어디서든 쓸 수 있다.
check(/:root \{\s*--mv-vod-local-chat-surface-neutral-base: #e1e1e5;[\s\S]*?--mv-vod-local-chat-surface-brand-strongest: #1bb373;\s*--mv-vod-local-chat-content-neutral-inverse: #fff;/.test(css) &&
  /html\[data-theme="dark"\] \{\s*--mv-vod-local-chat-surface-neutral-base: #2e3033;[\s\S]*?--mv-vod-local-chat-surface-brand-strongest: #00ffa3;\s*--mv-vod-local-chat-content-neutral-inverse: #0e0f10;/.test(css),
  "치지직 색 토큰(--mv-vod-local-chat-*)을 페이지 전체(라이트·다크)에 둔다");
check(!/\.mv-vod-chat-feed \{[^}]*--mv-vod-local-chat-/.test(css) && !/\n\.mv-chat-popup-vod \{[^}]*--mv-vod-local-chat-/.test(css),
  "채팅 영역에만 따로 두던 정의는 남기지 않는다(값이 하나로 유지된다)");
check(/\.mv-quality-option\[aria-pressed="true"\] \{\s*background: var\(--mv-vod-local-chat-surface-brand-strongest\);\s*border-color: var\(--mv-vod-local-chat-surface-brand-strongest\);\s*color: var\(--mv-vod-local-chat-content-neutral-inverse\);/.test(css),
  "선택된 화질 버튼은 치지직 브랜드색 배경과 반전 글자색을 쓴다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
