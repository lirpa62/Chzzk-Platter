const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const badgeChat = require("../src/multiviewBadgeChat.js");
const source = read("src/multiviewBadgeChat.js");
const css = read("src/multiview.css");
const watch = read("src/multiviewWatch.js");
const watchHtml = read("multiviewWatch.html");
const popupHtml = read("multiviewChatPopup.html");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

const PARTNER = "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png";
const sub = { src: "https://nng-phinf.pstatic.net/sub.png", alt: "구독", position: "before" };
const achievement = { src: "https://nng-phinf.pstatic.net/cup.png", alt: "", position: "after" };

// ── 파트너 마크(원본: 파트너면 닉네임 뒤 맨 앞) ──────────────────────────
let split = badgeChat.splitDisplayBadges({ role: "partner", roles: ["partner"], badges: [sub, achievement] });
check(split.before.length === 1 && split.before[0].src === sub.src, "닉네임 앞 배지는 그대로 둔다");
check(split.after[0].src === PARTNER && split.after[1].src === achievement.src,
  "채팅창에 마크 이미지가 없어도 파트너면 닉네임 뒤 맨 앞에 파트너 마크, 그다음 업적 배지");
split = badgeChat.splitDisplayBadges({ roles: ["manager"],
  badges: [{ src: `${PARTNER}?type=f40`, alt: "", position: "before" }, sub] });
check(split.before.every((badge) => badge.src !== `${PARTNER}?type=f40`) &&
  split.after.length === 1 && split.after[0].src === `${PARTNER}?type=f40`,
  "앞쪽에 잡힌 파트너 마크는 닉네임 뒤로 옮기고 한 번만 그린다");
split = badgeChat.splitDisplayBadges({ roles: ["streamer"], badges: [sub, achievement] });
check(split.after.length === 1 && split.after[0].src === achievement.src,
  "파트너가 아니면 파트너 마크를 붙이지 않는다");

// ── 닉네임 뒤 배지 14px × 글자 배율 ────────────────────────────────────
check(/group\.className = `cheese-mv-badge-chat-badge-group is-\$\{position\}`;/.test(source) &&
  /image\.width = position === "after" \? 14 : 18;/.test(source),
  "라이브 모아보기: 닉네임 앞·뒤 배지 묶음을 구분한다");
check(/\.cheese-mv-badge-chat-badge-group\.is-after img \{ height:calc\(14px \* var\(--mv-badge-chat-font-scale, 1\)\);`\s*\+\s*`width:calc\(14px \* var\(--mv-badge-chat-font-scale, 1\)\);\}/.test(source),
  "라이브 모아보기: 닉네임 뒤 배지는 14px × 글자 배율(원본과 같다)");
check(/mv-vod-chat-profile-badge-group is-\$\{position\}/.test(watch) &&
  /\.mv-badge-chat-list\s+\.mv-vod-chat-profile-badge-group\.is-after\s+\.mv-vod-chat-profile-badge \{\s*height: calc\(14px \* var\(--mv-vod-chat-scale, 1\)\);\s*width: calc\(14px \* var\(--mv-vod-chat-scale, 1\)\);/.test(css),
  "다시보기 모아보기: 닉네임 뒤 배지도 14px × 글자 배율");

// ── 글자 크기 조절 UI(원본 chzzk-badge-moa-popup-font-scale) ───────────
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { this.listeners.click?.(); }
}
const controls = badgeChat.createFontScaleControls({
  doc: { createElement: (tag) => new Node(tag), createElementNS: (_ns, tag) => new Node(tag) },
  classPrefix: "cheese-mv-badge-chat",
});
const [down, value, up] = controls.element.children;
check(down.className === "cheese-mv-badge-chat-font-scale-button cheese-mv-badge-chat-font-scale-down" &&
  up.className === "cheese-mv-badge-chat-font-scale-button cheese-mv-badge-chat-font-scale-up",
  "버튼은 원본처럼 공용 버튼 클래스를 가진다");
const icon = (button) => button.children[0];
check(icon(down).tag === "svg" && icon(down).attributes.viewBox === "0 0 14 14" &&
  icon(down).attributes.width === "14" && icon(up).children[0].attributes.d.startsWith("M7.759 1.954"),
  "원본과 같은 14px −/+ 아이콘");
check(down.attributes["aria-label"] === "모아보기 글자 크기 줄이기" &&
  up.attributes["aria-label"] === "모아보기 글자 크기 늘리기" &&
  controls.element.attributes["aria-label"] === "모아보기 글자 크기",
  "원본과 같은 접근성 이름");

const liveRule = source.slice(source.indexOf("`.cheese-mv-badge-chat-font-scale {"),
  source.indexOf("`.cheese-mv-badge-chat-close {"));
check(/height:28px;/.test(liveRule) && /border-radius:7px;/.test(liveRule) &&
  /border:1px solid var\(--sem-color-border-neutral-weaker, var\(--cmv-fs-border\)\);/.test(liveRule) &&
  /background:var\(--sem-color-surface-neutral-weaker, var\(--cmv-fs-bg\)\);/.test(liveRule) &&
  /flex:0 0 28px;/.test(liveRule) && /width:28px;/.test(liveRule) &&
  /font-size:12px;/.test(liveRule) && /font-weight:600;/.test(liveRule) && /min-width:38px;/.test(liveRule) &&
  /opacity:\.35;/.test(liveRule),
  "라이브 모아보기: 28px 묶음·1px 테두리·7px 모서리·28px 버튼·12px 굵은 숫자(원본 수치)");
check(/--cmv-fs-border:rgba\(0,0,0,\.08\); --cmv-fs-bg:#fff;/.test(liveRule) &&
  /--cmv-fs-border:rgba\(255,255,255,\.12\); --cmv-fs-bg:#1c1d1f; --cmv-fs-hover:#4a5161; --cmv-fs-color:#dfe2ea;/.test(liveRule),
  "라이브 모아보기: 원본의 라이트·다크 기본색");

const vodRule = css.slice(css.indexOf(":is(.mv-vod-chat-font-scale, .mv-badge-chat-font-scale) {"));
check(/height: 28px;/.test(vodRule) && /border-radius: 7px;/.test(vodRule) &&
  /border: 1px solid var\(--mv-font-scale-border\);/.test(vodRule) &&
  /flex: 0 0 28px;/.test(vodRule) && /font-size: 12px;/.test(vodRule) && /font-weight: 600;/.test(vodRule),
  "다시보기: 채팅 크기 조절과 배지 모아보기 조절이 같은 원본 스타일");
check(!/\.mv-vod-chat-scale > button/.test(css) && !/\n\.mv-badge-chat-font-scale button \{/.test(css),
  "예전 흩어진 버튼 규칙이 남지 않는다");
for (const [html, prefix, label] of [
  [watchHtml, "mvVodChatScale", "시청 페이지"],
  [popupHtml, "mvChatPopupVodScale", "분리 채팅 팝업"],
]) {
  check(new RegExp(`<div class="mv-vod-chat-font-scale" role="group" aria-label="채팅 글자 크기">\\s*` +
    `<button type="button" id="${prefix}Down"[\\s\\S]*?id="${prefix}Value"[\\s\\S]*?id="${prefix}Up"[\\s\\S]*?</button>\\s*</div>`).test(html),
    `${label}: −·값·+ 를 한 묶음으로 감싼다`);
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
