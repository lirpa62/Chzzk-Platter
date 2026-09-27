const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const badgeChat = require(path.join(root, "src/multiviewBadgeChat.js"));
const source = fs.readFileSync(path.join(root, "src/multiviewBadgeChat.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const watch = fs.readFileSync(path.join(root, "src/multiviewWatch.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/multiview.css"), "utf8");
const html = fs.readFileSync(path.join(root, "multiviewWatch.html"), "utf8");
const settingsJs = fs.readFileSync(path.join(root, "src/settings.js"), "utf8");
const settingsHtml = fs.readFileSync(path.join(root, "settings.html"), "utf8");

assert.equal(badgeChat.classifyBadgeRole(["https://ssl.pstatic.net/static/nng/glive/icon/streamer.png"]), "streamer");
assert.equal(badgeChat.classifyBadgeRole(["https://ssl.pstatic.net/static/nng/glive/icon/manager.png"]), "manager");
assert.equal(badgeChat.classifyBadgeRole(["https://ssl.pstatic.net/static/nng/glive/icon/owner.png"]), "operator");
assert.equal(badgeChat.classifyBadgeRole(["인증 마크"]), "partner");
class ScaleControlNode {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.disabled = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  click() { this.listeners.click?.(); }
}
const fontScaleChanges = [];
const fontScale = badgeChat.createFontScaleControls({
  doc: { createElement: () => new ScaleControlNode() },
  classPrefix: "test-badge-chat",
  onChange: (percent) => fontScaleChanges.push(percent),
});
const [fontScaleDown, fontScaleValue, fontScaleUp] = fontScale.element.children;
assert.equal(fontScaleValue.textContent, "100%");
assert.equal(fontScaleDown.disabled, true);
fontScaleUp.click();
fontScaleUp.click();
fontScaleUp.click();
assert.equal(fontScaleValue.textContent, "175%");
assert.equal(fontScaleUp.disabled, true);
fontScaleDown.click();
assert.equal(fontScaleValue.textContent, "150%");
assert.deepEqual(fontScaleChanges, [100, 125, 150, 175, 150]);
assert.equal(badgeChat.classifyBadgeRole(["_manager_badge_1"]), "manager");
assert.equal(badgeChat.classifyBadgeRole(["https://example.com/subscription.png"]), "");
assert.equal(badgeChat.classifyBadgeRole(["채널 관리자", "인증 마크"]), "manager");
assert.deepEqual(
  badgeChat.normalizeCapturedMessage({
    role: "partner",
    nickname: "  파트너\n채널 ",
    text: "  안녕\t반가워요  ",
  }),
  { role: "partner", nickname: "파트너 채널", text: "안녕 반가워요" },
);
assert.deepEqual(
  badgeChat.normalizeCapturedMessage({
    role: "manager",
    nickname: "매니저",
    text: "안내",
    badges: [
      { src: "https://example.com/badge.png", alt: "매니저", position: "before" },
      { src: "javascript:alert(1)", alt: "bad", position: "before" },
    ],
    timeText: " 12:34 ",
    nicknameColor: "rgb(34, 89, 207)",
    messageColor: "rgb(20, 30, 40)",
  }),
  {
    role: "manager",
    nickname: "매니저",
    text: "안내",
    badges: [{ src: "https://example.com/badge.png", alt: "매니저", position: "before" }],
    timeText: "12:34",
    nicknameColor: "rgb(34, 89, 207)",
    messageColor: "rgb(20, 30, 40)",
  },
);
assert.equal(badgeChat.normalizeCapturedMessage({ role: "viewer", nickname: "시청자", text: "hi" }), null);
assert.equal(badgeChat.normalizeCapturedMessage({ role: "manager", text: "   " }), null);
assert.deepEqual(
  badgeChat.normalizeCapturedMessage({ role: "manager", nickname: "매니저", text: "안내", special: true }),
  { role: "manager", nickname: "매니저", text: "안내", special: true },
);

const entries = manifest.content_scripts.flatMap((entry) => entry.js || []);
assert.ok(entries.includes("src/multiviewBadgeChat.js"));
const contentEntry = manifest.content_scripts.find((entry) => entry.js?.includes("src/content.js"));
assert.ok(contentEntry.js.includes("src/multiviewBadgeChat.js"));
assert.equal(contentEntry.all_frames, true);
assert.equal(manifest.content_scripts.filter((entry) => entry.js?.includes("src/multiviewBadgeChat.js")).length, 1);
assert.match(source, /params\.get\("cheeseMultiChat"\) !== "1"/);
assert.match(source, /aside#aside-chatting/);
assert.match(source, /\[class\*="manager"\]/);
assert.match(source, /getAttribute\("data-role"\)/);
assert.match(source, /new win\.MutationObserver/);
assert.match(source, /cheese-mv-badge-chat-trigger/);
assert.match(source, /cheese-mv-badge-chat-popover/);
assert.match(source, /CHAT_FONT_SCALE_STEPS = Object\.freeze\(\[100, 125, 150, 175\]\)/);
assert.match(source, /createFontScaleControls\(/);
assert.match(source, /fontScaleControls\?\.element/);
assert.match(source, /--mv-badge-chat-font-scale/);
assert.match(watch, /createFontScaleControls\(/);
assert.match(watch, /vodBadgeChatHeader\.insertBefore\(vodBadgeChatFontScaleControls\.element/);
assert.match(source, /asideRect\?\.width/);
assert.match(source, /asideRect\?\.left/);
assert.match(source, /popoverHeadingParent\.insertBefore\(popoverAnchor, heading\)/);
assert.match(source, /\.cheese-mv-badge-chat-anchor[^`]*position:absolute/);
assert.match(source, /left:10px; top:50%; transform:translateY\(-50%\)/);
assert.doesNotMatch(source, /positionBadgeTrigger|badgeTriggerResizeObserver/);
assert.match(source, /cheese-mv-badge-chat-resize/);
assert.match(source, /pointermove/);
assert.match(source, /resizeStart\.height \+ event\.clientY - resizeStart\.y/);
assert.match(source, /top: Number\.parseFloat\(popover\.style\.top\)/);
assert.match(source, /_is_donation_.*_is_subscription_.*_is_mission_/s);
assert.match(source, /is-message-bg-hidden:not\(\.is-special\)/);
assert.match(source, /is-message-border-hidden/);
assert.match(source, /data-cheese-mv-badge-special/);
assert.match(source, /data-cheese-mv-badge-role="manager"\]:not\(\[data-cheese-mv-badge-special\]\)/);
assert.doesNotMatch(source, /popover\?\.classList\.toggle\("is-(?:bg|border)-hidden"/);
assert.match(source, /lastSeenSequence = nextMessageSequence/);
assert.match(source, /새 채팅 없음/);
assert.match(source, /\.cheese-mv-badge-chat-label \{ max-width:min\(180px,30vw\)/);
assert.match(source, /actor\.roles\.add\(role\)/);
assert.match(source, /pill\.render\(\{\s*actors: collectPillActors\(/);
assert.match(source, /message\.badges \|\| \[\]/);
assert.match(source, /message\.nicknameColor/);
assert.match(source, /message\.messageColor/);
assert.match(source, /cheese-mv-badge-chat-identity/);
assert.match(source, /cheese-mv-badge-chat-time/);
assert.match(source, /appendRoleMessage\(role, captured, row, roles\.length \? roles : \[role\]\)/);
assert.match(source, /handleOutsidePointer/);
assert.match(source, /function watchForAside\(\)[\s\S]*new win\.MutationObserver\(attachAside\)/);
assert.match(source, /if \(next === aside\)[\s\S]*if \(!next\) watchForAside\(\)/);
assert.doesNotMatch(source, /postMessage\(|FRAME_BADGE_CHAT_MESSAGE|parentOrigin|messageSequence/);
assert.match(source, /Array\.from\(messageContainer\?\.children \|\| \[\]\)/);
assert.match(source, /rgba\(94,157,255,\.18\)/);
assert.match(source, /rgba\(34,197,94,\.2\)/);
assert.match(source, /rgba\(0,199,155,\.2\)/);
assert.match(source, /rgba\(255,166,84,\.14\)/);
assert.match(source, /\.cheese-mv-badge-chat-row \{ border:1px solid transparent; border-radius:8px/);
assert.match(source, /cheeseMultiviewBadgeChatHidePopupTime/);
assert.match(source, /cheeseMultiviewBadgeChatHideChatBackground/);
assert.match(source, /cheeseMultiviewBadgeChatHideChatBorder/);
assert.match(source, /badgeSettings\.roleBadgesOnly/);
assert.match(source, /badgeSettings\.keepPopupOpen/);
assert.match(source, /badgeSettings\.pillGlowEnabled/);
assert.match(source, /badgeSettings\.compactPill/);
assert.match(source, /badgeSettings\.hidePillButton/);
assert.match(source, /classifyBadgeRole\(\[badge\.src, badge\.alt\]\)/);
assert.match(source, /triggerAttention\(\)/);
assert.match(source, /closePopover\(force = false\)/);
assert.match(source, /is-compact/);
assert.match(source, /cheese-mv-badge-no-chat-bg/);
assert.match(source, /cheese-mv-badge-no-chat-border/);
assert.match(source, /chrome\?\.storage/);
assert.doesNotMatch(source, /WebSocket|XMLHttpRequest|fetch\(/);
assert.match(watch, /is-badge-\$\{role\}/);
assert.match(watch, /event\.source !== frame\.contentWindow/);
assert.match(watch, /data\.generation !== chatGeneration/);
assert.match(watch, /BADGE_CHAT_LIMIT = 150/);
assert.match(watch, /renderVodBadgeChat\(visible\)/);
assert.match(watch, /CheeseMultiviewBadgeChat\.createBadgePill\(/);
assert.match(watch, /CheeseMultiviewBadgeChat\.createPopoverMotion\(vodBadgeChatPopover\)/);
assert.match(watch, /collectPillActors\(unreadEntries\)/);
assert.match(watch, /unreadEntries = entries\.filter\(\(message\) => !vodBadgeChatSeenIds\.has\(message\.id\)\)/);
assert.match(watch, /cheeseMultiviewBadgeChatHidePopupTime/);
assert.match(watch, /cheeseMultiviewBadgeChatHideChatBackground/);
assert.match(watch, /cheeseMultiviewBadgeChatHideChatBorder/);
assert.match(watch, /vodBadgeChatSettings\.roleBadgesOnly/);
assert.match(watch, /vodBadgeChatSettings\.keepPopupOpen/);
assert.match(watch, /vodBadgeChatSettings\.pillGlowEnabled/);
assert.match(watch, /vodBadgeChatSettings\.compactPill/);
assert.match(watch, /vodBadgeChatSettings\.hidePillButton/);
assert.match(watch, /roleBadgesOnly: vodBadgeChatSettings\.roleBadgesOnly/);
assert.match(watch, /vodBadgeChatPill\?\.attention\(\)/);
assert.match(watch, /closeVodBadgeChatPopover\(force = false\)/);
assert.match(watch, /cheese-mv-badge-no-chat-bg/);
assert.match(watch, /cheese-mv-badge-no-chat-border/);
assert.match(watch, /mvVodBadgeChatResize/);
assert.match(watch, /vodBadgeChatHeight = Math\.max\(120/);
assert.match(watch, /vodBadgeChatResizeStart\.height \+ event\.clientY - vodBadgeChatResizeStart\.y/);
assert.match(watch, /top: Number\.parseFloat\(vodBadgeChatPopover\.style\.top\)/);
assert.match(watch, /hideBackground: vodBadgeChatSettings\.hidePopupBackground/);
assert.match(watch, /hideBorder: vodBadgeChatSettings\.hidePopupBorder/);
assert.doesNotMatch(watch, /vodBadgeChatPopover\?\.classList\.toggle\("is-(?:bg|border)-hidden"/);
assert.match(watch, /vodChatSourceId === source\.id && video\?\.videoNo/);
assert.match(watch, /chatBounds\?\.width/);
assert.match(watch, /new window\.ResizeObserver\(positionVodBadgeChatPopover\)/);
assert.match(watch, /mvVodBadgeChatTrigger/);
assert.doesNotMatch(watch, /FRAME_BADGE_CHAT_MESSAGE|badgeChatMessages|reflectChatFeedMode/);
assert.match(html, /id="mvVodBadgeChatTrigger"/);
assert.match(html, /mv-badge-chat-trigger is-empty/);
assert.match(html, /id="mvVodBadgeChatBadges"/);
assert.match(html, /id="mvVodBadgeChatList"/);
assert.match(html, /id="mvVodBadgeChatResize"/);
assert.match(html, /mvVodBadgeChatAnchor[\s\S]*mvVodChatScaleDown/);
assert.doesNotMatch(html, /mvChatBadgeToggle|mvBadgeChatList/);
assert.match(css, /\.mv-vod-chat-scale > button/);
assert.match(css, /\.mv-badge-chat-trigger\.is-compact/);
assert.match(css, /\.mv-badge-chat-trigger\.is-attention \{[^}]*mv-badge-chat-glow-pulse 1\.45s/);
assert.match(css, /\.mv-badge-chat-trigger\.is-attention::before \{[^}]*mv-badge-chat-glow-aura/);
assert.match(css, /\.mv-badge-chat-popover\.is-locked-open/);
assert.match(css, /--mv-vod-chat-scale:\s*var\(--mv-badge-chat-font-scale, 1\)/);
assert.match(css, /\.mv-badge-chat-font-scale-value/);
assert.match(css, /\.mv-vod-chat-scale > span/);
assert.match(css, /\.mv-badge-chat-trigger \{[\s\S]*height: 32px/);
assert.match(css, /\.mv-badge-chat-badges img \{[\s\S]*height: 16px/);
assert.match(css, /\.mv-badge-chat-count\[hidden\] \{\s*display: none/);
assert.match(css, /\.mv-badge-chat-resize\s*\{[\s\S]*cursor: ns-resize/);
assert.match(css, /\.mv-badge-chat-list \.mv-vod-chat-row\.is-message-bg-hidden:not\(\.is-special\)/);
assert.match(css, /\.mv-badge-chat-list \.mv-vod-chat-row\.is-message-border-hidden/);
assert.doesNotMatch(css, /\.mv-badge-chat-popover\.is-(?:bg|border)-hidden/);
assert.match(css, /\.mv-vod-chat-row\.is-badge-streamer:not\(\.is-special\)/);
assert.match(css, /#mvVodChatList\s+\.mv-vod-chat-row:is\([\s\S]*background: transparent !important/);
assert.match(css, /#mvVodChatList\s+\.mv-vod-chat-row:is\([\s\S]*border-color: transparent !important/);
assert.match(css, /rgba\(94, 157, 255, 0\.18\)/);
assert.match(css, /rgba\(34, 197, 94, 0\.2\)/);
assert.match(css, /rgba\(255, 166, 84, 0\.14\)/);
for (const role of ["streamer", "manager", "operator", "partner"])
  assert.match(css, new RegExp(`\\.mv-vod-chat-row\\.is-badge-${role}`));

for (const key of [
  "cheeseMultiviewBadgeChatButton",
  "cheeseMultiviewBadgeChatHideEmptyButton",
  "cheeseMultiviewBadgeChatHideChatBackground",
  "cheeseMultiviewBadgeChatHideChatBorder",
  "cheeseMultiviewBadgeChatHidePopupBackground",
  "cheeseMultiviewBadgeChatHidePopupBorder",
  "cheeseMultiviewBadgeChatHidePopupTime",
  "cheeseMultiviewBadgeChatRoleBadgesOnly",
  "cheeseMultiviewBadgeChatKeepPopupOpen",
  "cheeseMultiviewBadgeChatPillGlowEnabled",
  "cheeseMultiviewBadgeChatCompactPill",
  "cheeseMultiviewBadgeChatHidePillButton",
]) {
  assert.match(settingsJs, new RegExp(`"${key}"`));
}
for (const selector of [
  "data-multiview-badge-chat-hide-empty-button",
  "data-multiview-badge-chat-hide-chat-background",
  "data-multiview-badge-chat-hide-chat-border",
  "data-multiview-badge-chat-hide-popup-background",
  "data-multiview-badge-chat-hide-popup-border",
  "data-multiview-badge-chat-hide-popup-time",
  "data-multiview-badge-chat-role-badges-only",
  "data-multiview-badge-chat-keep-popup-open",
  "data-multiview-badge-chat-pill-glow",
  "data-multiview-badge-chat-compact-pill",
  "data-multiview-badge-chat-hide-pill-button",
]) assert.ok(settingsHtml.includes(selector), `${selector} 설정 UI가 있음`);
assert.match(settingsHtml, /aria-label="모아보기 팝업"/);
assert.match(settingsHtml, /aria-label="채팅창 표시"/);
assert.match(settingsHtml, /하이라이트 배경색 숨기기[\s\S]*강조 배경만 숨깁니다/);
assert.match(settingsHtml, /하이라이트 테두리선 숨기기[\s\S]*강조 테두리만 숨깁니다/);
assert.equal((settingsHtml.match(/data-new-feature="multiview-badge-chat"/g) || []).length, 2);
assert.match(settingsHtml, /메시지 배경 숨기기[\s\S]*특수 메시지 배경은 유지됩니다/);
assert.match(settingsHtml, /메시지 테두리 숨기기[\s\S]*각 채팅 메시지 카드의 테두리만 숨깁니다/);
assert.match(settingsHtml, /역할 배지만 표시[\s\S]*방장·매니저·운영자·파트너 배지만 표시합니다/);
assert.match(settingsHtml, /항상 펼침[\s\S]*자동으로 열고 닫히지 않게 합니다/);
assert.match(settingsHtml, /새 채팅 반짝임 사용/);
assert.match(settingsHtml, /알림 버튼 간단히 표시/);
assert.match(settingsHtml, /배지 알림 버튼 숨김/);
assert.match(settingsJs, /cheeseMultiviewBadgeChatKeepPopupOpen[\s\S]*cheeseMultiviewBadgeChatHidePillButton/);
assert.match(settingsJs, /cheeseMultiviewBadgeChatButton === false/);
assert.match(settingsJs, /imported\.cheeseMultiviewBadgeChatHidePillButton =\s*imported\.cheeseMultiviewBadgeChatButton === false/);
const settingsKeys = settingsJs.slice(
  settingsJs.indexOf("const SETTINGS_STORAGE_KEYS = ["),
  settingsJs.indexOf("\n  ];", settingsJs.indexOf("const SETTINGS_STORAGE_KEYS = [")),
);
for (const key of [
  "cheeseMultiviewBadgeChatButton",
  "cheeseMultiviewBadgeChatHideEmptyButton",
  "cheeseMultiviewBadgeChatHideChatBackground",
  "cheeseMultiviewBadgeChatHideChatBorder",
  "cheeseMultiviewBadgeChatHidePopupBackground",
  "cheeseMultiviewBadgeChatHidePopupBorder",
  "cheeseMultiviewBadgeChatHidePopupTime",
  "cheeseMultiviewBadgeChatRoleBadgesOnly",
  "cheeseMultiviewBadgeChatKeepPopupOpen",
  "cheeseMultiviewBadgeChatPillGlowEnabled",
  "cheeseMultiviewBadgeChatCompactPill",
  "cheeseMultiviewBadgeChatHidePillButton",
]) assert.ok(settingsKeys.includes(`"${key}"`), `${key}가 백업·복원 키 목록에 포함됨`);

// ── 알림 버튼 순환·강조, 팝업 펼침 애니메이션(원본 배지 모아보기와 같은 동작) ──
const actors = badgeChat.collectPillActors([
  { nickname: "매니저A", roles: ["manager"] },
  { nickname: "파트너B", roles: ["partner"] },
  { nickname: "매니저A", roles: ["manager"] },
  { nickname: "방장", role: "streamer" },
]);
assert.deepEqual(actors.map((actor) => [actor.nickname, actor.count]), [["방장", 1], ["매니저A", 2], ["파트너B", 1]]);
assert.deepEqual([...actors[2].roles], ["partner"]);

function fakeDom() {
  let now = 1000;
  let nextId = 1;
  const timers = new Map();
  const view = {
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) { const id = nextId++; timers.set(id, { callback, at: now + delay, every: delay }); return id; },
    clearInterval(id) { timers.delete(id); },
    matchMedia: () => ({ matches: false }),
  };
  const doc = { defaultView: view };
  const element = (tag = "span") => {
    const classes = new Set();
    const node = {
      tagName: tag, ownerDocument: doc, children: [], attributes: {}, hidden: false, inert: false,
      offsetWidth: 10, className: "", title: "",
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force) => (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
        contains: (name) => classes.has(name),
      },
      append: (...items) => node.children.push(...items),
      replaceChildren: (...items) => { node.children = items; node._text = ""; },
      setAttribute: (name, value) => { node.attributes[name] = String(value); },
      set textContent(value) { node.children = []; node._text = String(value); },
      get textContent() { return node._text || node.children.map((child) => child.textContent || "").join(""); },
    };
    return node;
  };
  doc.createElement = element;
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now || !timers.has(id)) continue;
      if (timer.every) timer.at += timer.every; else timers.delete(id);
      timer.callback();
    }
  };
  return { element, advance, now: () => now, timers };
}

{
  const dom = fakeDom();
  const realNow = Date.now;
  Date.now = dom.now;
  try {
    const trigger = dom.element("button");
    const label = dom.element();
    const count = dom.element();
    const badges = dom.element();
    const pill = badgeChat.createBadgePill({ trigger, badges, label, count, classPrefix: "x" });
    pill.render({ actors, compact: false, glow: true });
    assert.equal(label.textContent, "방장", "가장 최근에 말한 사람을 먼저 표시");
    assert.ok(trigger.classList.contains("is-rotating"), "여러 명이면 순환");
    assert.ok(trigger.classList.contains("is-role-streamer"));
    assert.ok(trigger.classList.contains("has-unseen"));
    assert.equal(count.textContent, "1");
    dom.advance(2400);
    assert.equal(label.textContent, "매니저A", "2.4초마다 다음 사람");
    assert.equal(count.textContent, "2");
    assert.ok(trigger.classList.contains("is-role-manager"));
    pill.attention();
    assert.ok(trigger.classList.contains("is-attention"));
    assert.equal(label.textContent, "방장", "강조 중에는 맨 앞 사람에 고정");
    assert.ok(!trigger.classList.contains("is-rotating"), "강조 중에는 순환 멈춤");
    dom.advance(1400);
    assert.ok(!trigger.classList.contains("is-attention"), "1.4초 뒤 강조 해제");
    assert.ok(trigger.classList.contains("is-rotating"));
    pill.render({ actors: [actors[2]], compact: false, glow: true });
    assert.equal(label.children[1]?.className, "x-partner-mark", "파트너 마크는 닉네임 뒤");
    assert.equal(badges.children.length, 0);
    pill.render({ actors, compact: true, glow: true });
    assert.equal(count.textContent, "4", "간단히 표시는 읽지 않은 전체 수");
    assert.ok(trigger.classList.contains("is-compact") && !trigger.classList.contains("is-rotating"));
    pill.render({ actors: [], compact: false, glow: true });
    assert.equal(label.textContent, "새 채팅 없음");
    assert.ok(trigger.classList.contains("is-empty") && count.hidden);
    assert.equal(dom.timers.size, 0, "읽지 않은 채팅이 없으면 순환 타이머 정리");
    pill.render({ actors, compact: false, glow: false });
    pill.attention();
    assert.ok(!trigger.classList.contains("is-attention"), "반짝임 끄면 강조 안 함");
    pill.dispose();
  } finally {
    Date.now = realNow;
  }
}

{
  const dom = fakeDom();
  const popover = dom.element("section");
  popover.hidden = true;
  const motion = badgeChat.createPopoverMotion(popover);
  motion.open();
  assert.ok(!popover.hidden && popover.classList.contains("is-opening"));
  dom.advance(320);
  assert.ok(!popover.classList.contains("is-opening"));
  motion.close();
  assert.ok(!popover.hidden && popover.classList.contains("is-closing") && popover.inert, "접히는 동안 보이되 클릭 막음");
  motion.open();
  assert.ok(!popover.classList.contains("is-closing") && !popover.inert, "접히는 중 다시 열면 취소");
  motion.close(true);
  assert.ok(popover.hidden && !popover.classList.contains("is-closing"), "즉시 닫기");
}

assert.match(source, /messageSelector =[\s\S]*_chatting_message_/);
assert.match(source, /message\.closest\(rowSelector\)/);
assert.match(source, /image\.closest\('\[class\*="_chatting_message_"\] > \[class\*="_text_"\]'\)/);
assert.doesNotMatch(source, /S-CoreDream|@font-face/);
assert.match(source, /cheese-mv-badge-flow-down \.32s/);
assert.match(source, /popover\.offsetHeight/);
assert.match(watch, /vodBadgeChatPopover\.offsetHeight/);
assert.match(css, /\.mv-badge-chat-popover\.is-opening \{[^}]*mv-badge-chat-flow-down 0\.32s/);
assert.match(css, /\.mv-badge-chat-trigger\.is-rotating\s+>\s+:is\(/);
assert.doesNotMatch(css, /S-CoreDream/);
assert.ok(!manifest.web_accessible_resources.some((entry) =>
  entry.resources.some((resource) => resource.includes("S-CoreDream"))));
assert.ok(html.indexOf("src/multiviewBadgeChat.js") > -1 &&
  html.indexOf("src/multiviewBadgeChat.js") < html.indexOf("src/multiviewWatch.js"));

console.log("멀티뷰 배지 채팅 팝오버 테스트 통과");
