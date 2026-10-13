// 채팅 입력창 도구(설정 - 채팅).
//
// 1) '채팅 입력창 안내 문구 숨김' > '지연 시간 표시': 숨긴 안내 문구 자리에 '지연 n.n초'.
// 2) 후원 도구: '후원하기' 문구 숨김 / 후원 아이콘 버튼 숨김 중 하나.
// 3) 후원 도구 줄(_donation_) 첫 자식으로 지금 시청자 수.
// 마크업은 치지직 실제 채팅 입력창(2026-10-09)에서 줄였다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const content = read("src/content.js");
const contentCss = read("src/content.css");
const mixer = read("src/audioMixer.js");
const settingsHtml = read("settings.html");
const settingsUi = read("src/settingsUi.js");
const settings = read("src/settings.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `${start} 를 찾지 못했다`);
  const stop = source.indexOf(end, at);
  assert.ok(stop > at, `${end} 를 찾지 못했다`);
  return source.slice(at, stop);
};
const sliceFn = (source, name) => {
  const at = source.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return source.slice(at, source.indexOf("\n  }\n", at) + 4);
};

// ── 1) 지연 안내 문구(audioMixer.js, MAIN) ─────────────────────────────────
{
  class HTMLTextAreaElement {
    constructor() { this.attrs = new Map(); this.placeholder = "채팅을 입력해주세요 (J)"; }
    hasAttribute(name) { return this.attrs.has(name); }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    removeAttribute(name) { this.attrs.delete(name); }
  }
  let textarea = new HTMLTextAreaElement();
  textarea.value = "";
  let latency = 6.34;
  let measures = 0;
  const intervals = [];
  const ctx = {
    HTMLTextAreaElement,
    location: { pathname: "/live/abc" },
    document: {
      hidden: false,
      querySelector: (sel) => (sel === "aside#aside-chatting textarea" ? textarea : null),
      querySelectorAll: () => (textarea.hasAttribute("data-cheese-latency-placeholder") ? [textarea] : []),
    },
    window: { setInterval: (fn) => intervals.push(fn) && intervals.length, clearInterval: () => intervals.splice(0) },
    getLiveLatencySeconds: () => { measures++; return latency; },
    multiviewSlotId: "",
    lastLiveLatencyValue: null,
    lastLiveLatencyAt: 0,
  };
  vm.runInNewContext(
    `${sliceFn(mixer, "formatLatency")}
     ${between(mixer, "  const LATENCY_PLACEHOLDER_ATTR", "  // 라이브 엣지로 즉시 점프")}
     this.set = (on) => { latencyPlaceholderOn = on; applyLatencyPlaceholder(); };
     this.tick = updateLatencyPlaceholder;`,
    vm.createContext(ctx),
  );
  ctx.set(true);
  check(textarea.placeholder === "지연 6.3초" &&
    textarea.getAttribute("data-cheese-latency-placeholder") === "채팅을 입력해주세요 (J)" && intervals.length === 1,
    "켜면 안내 문구 자리에 '지연 n.n초'를 두고 원래 문구는 보관한다(1초마다 갱신)");
  latency = 12.06;
  ctx.tick();
  check(textarea.placeholder === "지연 12.1초", "지연이 바뀌면 문구도 바뀐다");
  textarea = new HTMLTextAreaElement(); // 치지직이 입력창을 새로 만든다
  textarea.value = "";
  ctx.tick();
  check(textarea.placeholder === "지연 12.1초", "치지직이 입력창을 새로 만들어도 다음 갱신에 다시 건다");
  latency = null;
  ctx.tick();
  check(textarea.placeholder === "채팅을 입력해주세요 (J)" && !textarea.hasAttribute("data-cheese-latency-placeholder"),
    "지연을 못 재면(채팅 전용 화면 등) 원래 문구로 돌려 둔다(부모 옵션이 숨긴다)");
  latency = 3;
  ctx.tick();
  // 비용: 따라잡기 버튼이 막 잰 값은 다시 재지 않는다 / 글을 쓰는 중에는 재지 않는다 /
  // 멀티뷰 영상 칸(채팅 접힘)에서는 하지 않는다.
  measures = 0;
  ctx.lastLiveLatencyValue = 2.04;
  ctx.lastLiveLatencyAt = Date.now();
  ctx.tick();
  check(measures === 0 && textarea.placeholder === "지연 2.0초", "따라잡기 버튼이 1.5초 안에 잰 값을 그대로 쓴다");
  ctx.lastLiveLatencyAt = 0;
  textarea.value = "쓰는 중";
  ctx.tick();
  check(measures === 0, "글을 쓰는 중(안내 문구가 안 보임)에는 재지 않는다");
  textarea.value = "";
  ctx.multiviewSlotId = "a".repeat(32);
  ctx.tick();
  check(measures === 0 && !textarea.hasAttribute("data-cheese-latency-placeholder"),
    "멀티뷰 영상 칸에서는 하지 않는다(원래 문구로 둔다)");
  ctx.multiviewSlotId = "";
  ctx.tick();
  ctx.set(false);
  check(textarea.placeholder === "채팅을 입력해주세요 (J)" && !textarea.hasAttribute("data-cheese-latency-placeholder") &&
    intervals.length === 0, "끄면 원래 문구로 되돌리고 갱신을 멈춘다");
}
check(/latencyPlaceholderOn =\s*f\.chatHideInputPlaceholder === true && f\.chatInputLatencyPlaceholder === true;\s*applyLatencyPlaceholder\(\);/.test(mixer),
  "부모 옵션(안내 문구 숨김)이 꺼져 있으면 지연을 띄우지 않는다");
check(content.includes("aside#aside-chatting textarea[data-cheese-latency-placeholder]") &&
  content.includes("aside.querySelector(`${NATIVE_CHAT_TEXTAREA}[data-cheese-latency-placeholder]`)") &&
  /!textarea\.hasAttribute\("data-cheese-latency-placeholder"\)\) return;/.test(content),
  "문구에 '채팅'이 없어도 입력창 찾기(통나무파워 배지·입력창 높이 보정)가 알아본다");

// ── 2·3) 브라우저: CSS 와 시청자 수 ────────────────────────────────────────
const MARKUP = `<aside id="aside-chatting"><div class="_input_box_x">
  <textarea class="_input_x" placeholder="채팅을 입력해주세요 (J)"></textarea>
  <textarea class="_input_x" id="latency" data-cheese-latency-placeholder="채팅을 입력해주세요 (J)" placeholder="지연 6.3초"></textarea>
  <div class="_tools_19u4u_125"><div class="_donation_19u4u_132" id="donation">
    <button type="button" class="_donation_text_19u4u_137" id="donationText"><svg width="24" height="24" id="cheeseIcon"></svg>후원하기</button>
    <div class="_action_19u4u_140" id="action"><button class="_donation_button_19u4u_151" style="width:28px;height:28px"></button></div>
  </div><button id="send_chat_or_donate">채팅</button></div>
</div></aside>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-chat-tools-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "";
  let seq = 0;
  const pending = new Map();
  browser.stdio[4].on("data", (chunk) => {
    buf += chunk;
    for (let at; (at = buf.indexOf("\0")) >= 0;) {
      const raw = buf.slice(0, at);
      buf = buf.slice(at + 1);
      if (!raw) continue;
      const msg = JSON.parse(raw);
      const job = pending.get(msg.id);
      if (!job) continue;
      pending.delete(msg.id);
      msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
    }
  });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const cssRules = [
      contentCss.slice(contentCss.indexOf("/* 하위 옵션 '지연 시간 표시'"),
        contentCss.indexOf("}", contentCss.indexOf("/* 하위 옵션 '지연 시간 표시'")) + 1),
      between(contentCss, "/* 채팅 입력창 후원 도구 줄:", "/* 보유 통나무파워 배지"),
    ].join("\n");
    await ev(`(() => {
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(cssRules + contentCss.match(/#cheese-logpower-badge \.tooltip-text,\n#cheese-chat-viewer-count \.tooltip-text \{[^}]*\}/)[0])} +
        ' button{display:inline-flex;align-items:center;gap:4px;font-size:14px;padding:0;border:0} ._donation_19u4u_132{display:flex}';
      document.head.append(style);
      document.body.innerHTML = ${JSON.stringify(MARKUP)};
    })()`);

    const ph = await ev(`(() => {
      const root = document.documentElement;
      root.classList.add('cheese-chat-hide-input-placeholder');
      const [plain, latency] = document.querySelectorAll('textarea');
      return { plain: getComputedStyle(plain, '::placeholder').opacity, latency: getComputedStyle(latency, '::placeholder').opacity };
    })()`);
    check(ph.plain === "0" && ph.latency === "1",
      `안내 문구 숨김은 치지직 문구만 숨기고 지연 문구는 보인다 ${JSON.stringify(ph)}`);

    const tools = (mode) => ev(`(() => {
      const root = document.documentElement;
      // content.js applyChatDonationToolsClass 를 그대로 쓴다.
      const chatDonationTools = ${JSON.stringify(mode)};
      ${sliceFn(content, "applyChatDonationToolsClass")}
      applyChatDonationToolsClass();
      const text = document.getElementById('donationText');
      return {
        textWidth: Math.round(text.getBoundingClientRect().width),
        iconWidth: Math.round(document.getElementById('cheeseIcon').getBoundingClientRect().width),
        textContent: text.textContent,
        action: getComputedStyle(document.getElementById('action')).display,
      };
    })()`);
    const shown = await tools("show");
    const hideText = await tools("hide-text");
    const hideButtons = await tools("hide-buttons");
    const hideAll = await tools("hide-all");
    check(shown.textWidth > 50 && shown.action !== "none", `모두 표시 ${JSON.stringify(shown)}`);
    check(hideText.textWidth === 24 && hideText.iconWidth === 24 && hideText.textContent === "후원하기" &&
      hideText.action !== "none",
      `'후원하기' 문구 숨김: 치즈 아이콘만 남는다(글자 노드는 남아 통나무파워 배지가 자리를 찾는다) ${JSON.stringify(hideText)}`);
    check(hideButtons.textWidth === shown.textWidth && hideButtons.action === "none",
      `후원 버튼 숨김: 아이콘 버튼 묶음만 숨긴다 ${JSON.stringify(hideButtons)}`);
    check(hideAll.textWidth === 24 && hideAll.iconWidth === 24 && hideAll.action === "none",
      `모두 숨김: 문구와 아이콘 버튼 묶음을 함께 숨기고 치즈 아이콘만 남는다 ${JSON.stringify(hideAll)}`);

    // 시청자 수: content.js 의 applyChatViewerCount 를 그대로 돌린다(live-status 는 가짜 응답).
    await ev(`(() => {
      window.__live = { status: 'OPEN', concurrentUserCount: 10227 };
      window.__fetches = 0;
      window.fetch = async () => { window.__fetches++; return { ok: true, json: async () => ({ content: window.__live }) }; };
      window.featureFlags = { chatViewerCount: true };
      window.getCurrentLiveChannelId = () => 'abc';
      window.IS_MULTIVIEW_FRAME = false;
      ${sliceFn(content, "isInsideChatModal")}
      const CHAT_MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"]';
      ${sliceFn(content, "nodeHasDonationHost")}
      ${sliceFn(content, "findLogPowerInputArea")}
      ${sliceFn(content, "findLogPowerHost")}
      const findHost = findLogPowerHost;
      window.__finds = 0;
      findLogPowerHost = (...args) => (window.__finds++, findHost(...args));
      ${between(content, "  const CHAT_VIEWER_COUNT_ID", "  // 토글/페이지 전환에 따라 표시·타이머 보장.")}
      window.applyChatViewerCount = applyChatViewerCount;
      window.refreshChatViewerCount = refreshChatViewerCount;
    })()`);
    const viewer = () => ev(`new Promise((resolve) => setTimeout(() => {
      const badge = document.getElementById('cheese-chat-viewer-count');
      resolve(badge ? { first: badge.parentElement?.firstElementChild === badge, hidden: badge.hidden,
        text: badge.querySelector('.cheese-chat-viewer-count-value')?.textContent, fetches: window.__fetches,
        finds: window.__finds } : null);
    }, 20))`);
    await ev("applyChatViewerCount()");
    const first = await viewer();
    check(first?.first && first.hidden === false && first.text === "10,227" && first.fetches === 1,
      `후원 도구 줄 첫 자식으로 지금 시청자 수를 보인다 ${JSON.stringify(first)}`);
    for (let i = 0; i < 20; i++) await ev("applyChatViewerCount()");
    const repeated = await viewer();
    check(repeated.fetches === 1 && repeated.finds === 1,
      `init 이 자주 돌아도 30초 안에는 다시 묻지 않고, 붙어 있으면 자리를 다시 찾지 않는다 ${JSON.stringify(repeated)}`);
    // 치지직이 입력 영역을 새로 그린다.
    await ev(`(() => { const old = document.getElementById('donation'); const fresh = old.cloneNode(true);
      fresh.querySelector('#cheese-chat-viewer-count')?.remove(); old.replaceWith(fresh); applyChatViewerCount(); })()`);
    const reattached = await viewer();
    check(reattached?.first && reattached.text === "10,227", "입력 영역이 새로 그려지면 다시 붙인다");
    await ev(`window.__live = { status: 'CLOSE', concurrentUserCount: 0 }; refreshChatViewerCount()`);
    check((await viewer())?.hidden === true, "방송이 끝나면 숨긴다");
    await ev(`featureFlags.chatViewerCount = false; applyChatViewerCount()`);
    check((await viewer()) === null, "끄면 뗀다");
    // 채팅을 접어 붙일 곳이 없으면 묻지 않는다.
    await ev(`document.getElementById('donation').remove(); window.__fetches = 0;
      featureFlags.chatViewerCount = true; window.getCurrentLiveChannelId = () => 'def'; applyChatViewerCount()`);
    check(await ev("window.__fetches") === 0, "붙일 곳(후원 도구 줄)이 없으면 시청자 수를 묻지 않는다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // 설정 화면.
  check(/data-feature="chatHideInputPlaceholder"[\s\S]{0,1500}data-feature="chatInputLatencyPlaceholder"/.test(settingsHtml) &&
    settingsUi.includes(`['[data-feature="chatHideInputPlaceholder"]', '[data-feature="chatInputLatencyPlaceholder"]']`),
    "설정: '지연 시간 표시'는 '안내 문구 숨김'의 하위 옵션(부모가 꺼지면 잠긴다)");
  check(["show", "hide-text", "hide-buttons", "hide-all"].every((value) => settingsHtml.includes(`data-chat-donation-tools-value="${value}"`)) &&
    /role="radiogroup"\s*aria-label="채팅 입력창 후원 도구"/.test(settingsHtml) &&
    settings.includes('"cheeseChatDonationTools",') && content.includes("CHAT_DONATION_TOOLS_KEY,"),
    "설정: 후원 도구는 한 줄 세그먼트(모두 표시/'후원하기' 문구 숨김/후원 버튼 숨김/모두 숨김)");
  check(settingsHtml.includes('data-feature="chatViewerCount"') && /chatViewerCount: false,/.test(content),
    "설정: 시청자 수 표시는 기본 꺼짐");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
