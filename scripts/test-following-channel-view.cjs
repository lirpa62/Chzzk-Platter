// 팔로잉 채널 탭(?tab=CHANNEL) 정렬·상태 필터.
// 2026-10-30 실측 구조: ul._list_._flex_wrap_._type_channel_ > li._item_(최근 팔로우 순, 30개씩), 목록 바로 뒤 높이 0
// 빈 div 가 다음 묶음 감지 지점. 알림 버튼 숨김 글자 '알림 끄기'(켜짐)/'알림 켜기'(꺼짐), 구독 버튼 '구독중'/'구독'(없을 수 있음).
// 실제 DOM(헤드리스 Chrome)에서 보이는 순서·숨김·남은 묶음 불러오기·바뀐 카드만 고치는지를 본다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/content.css"), "utf8");
const settingsHtml = readFileSync(path.join(ROOT, "settings.html"), "utf8");
const settingsJs = readFileSync(path.join(ROOT, "src/settings.js"), "utf8");
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const sliceConsts = () => {
  const from = content.indexOf("  const FOLLOWING_CHANNEL_VIEW_KEY =");
  const to = content.indexOf("  function normalizeFollowingChannelView(");
  assert.ok(from > 0 && to > from);
  return content.slice(from, to);
};

const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

check(/function followingGroupFilterChannelIds\(\) \{\s*if \(isFollowingChannelPage\(\)\) return null;/.test(content),
  "채널 탭은 제외 필터(매번 모두 풀었다 다시 숨김) 대신 채널 탭 전용 처리가 맡는다");
check(content.includes("applyFollowingChannelView(); // 팔로잉 채널 탭 정렬·상태 필터(바뀐 카드만)"), "틱마다 적용");
check(settingsHtml.includes("data-following-channel-tools") &&
  settingsJs.includes('["[data-following-channel-tools]", "cheeseFollowingChannelTools", true]') &&
  settingsJs.includes('    "cheeseFollowingChannelView",'), "설정 스위치(기본 켬)·백업 키");

const card = (id, name, { alarm = false, sub = null } = {}) =>
  `<li class="_item_x"><div class="_container_c"><a class="_thumbnail_c" href="/${id}"><img width="60" height="60"><span class="blind">${name} 채널로 이동</span></a>` +
  `<a class="_wrapper_c" href="/${id}"><strong class="_channel_c"><span class="_ellipsis_e"><span class="_text_e">${name}</span></span></strong><p>팔로워 1명</p></a>` +
  `<div class="_control_c"><div class="_follow_c"><button type="button"><svg></svg><span class="blind">${name}</span>팔로잉</button></div>` +
  `<button type="button" class="_alarm_c"><div><svg></svg></div><span class="blind">${alarm ? "알림 끄기" : "알림 켜기"}</span></button>` +
  (sub === null ? "" : `<button type="button"><svg></svg>${sub ? "구독중" : "구독"}</button>`) +
  `</div></div></li>`;
const hex = (n) => n.toString(16).padStart(32, "0");
// 최근 팔로우 순(치지직 순서)
const CHANNELS = [
  [1, "나비", { alarm: true, sub: true }],
  [2, "가람", { sub: false }],
  [3, "Zed", { alarm: true }],
  [4, "다온", { sub: true }],
  [5, "apple", {}],
  [6, "라온", { alarm: true, sub: false }],
];
const FIXTURE = `<style>._list_x{display:flex;flex-wrap:wrap;gap:10px;width:900px;margin:0;padding:0;list-style:none}._item_x{width:280px;height:60px}
._container_c{display:flex;align-items:center;gap:4px;height:60px;overflow:hidden;font-size:11px}._container_c img{width:20px;height:20px}
._wrapper_c p{display:none}._control_c,._follow_c{display:flex;gap:2px}._control_c button{font-size:10px;padding:0 2px}</style>
<div id="layout-body"><section><ul class="_list_x _flex_wrap_x _type_channel_x">${CHANNELS.map(([n, name, o]) => card(hex(n), name, o)).join("")}</ul><div></div></section>
<span data-cf-channel-count></span></div>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-fcv-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let buf = "", seq = 0;
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
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => {
      const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st);
      document.body.innerHTML = ${JSON.stringify(FIXTURE)};
      window.__groupIds = null;
      const isFollowingChannelPage = () => true;
      const followingGroupSelectedIds = () => window.__groupIds;
      ${sliceConsts()}
      ${["followingCardChannelId", "normalizeFollowingChannelView", "findFollowingChannelList", "followingChannelCardInfo",
        "sortFollowingChannelInfos", "matchFollowingChannel", "clearFollowingChannelView", "applyFollowingChannelView",
        "setFollowingChannelCount", "followingChannelSentinel", "stopFollowingChannelLoadAll",
        "ensureFollowingChannelLoadAll"].map(sliceFn).join("\n")}
      window.api = {
        set(view) { followingChannelView = normalizeFollowingChannelView(view); applyFollowingChannelView(); },
        apply: applyFollowingChannelView,
        state: () => followingChannelLoad,
      };
      return true;
    })()`);
    const frames = "await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));";
    const look = (view, groupIds = null) => ev(`(async () => {
      window.__groupIds = ${groupIds ? `new Set(${JSON.stringify(groupIds)})` : "null"};
      api.set(${JSON.stringify(view)});
      ${frames}
      const list = document.querySelector('ul._list_x');
      const visible = [...list.children].filter((li) => !li.hasAttribute('data-cheese-channel-hidden'));
      visible.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.top - rb.top || ra.left - rb.left; });
      return { names: visible.map((li) => li.querySelector('._text_e').textContent).join(','),
        marked: list.hasAttribute('data-cheese-channel-view'), count: document.querySelector('[data-cf-channel-count]').textContent };
    })()`);

    const base = await look({});
    check(base.names === "나비,가람,Zed,다온,apple,라온" && !base.marked && base.count === "", "기본(최근 팔로우)은 치지직 그대로, 표시도 안 남긴다");
    const oldest = await look({ sort: "oldest" });
    check(oldest.names === "라온,apple,다온,Zed,가람,나비" && oldest.marked, "오래된 팔로우 = 치지직 순서를 뒤집는다 " + oldest.names);
    const asc = await look({ sort: "name-asc" });
    check(asc.names === "가람,나비,다온,라온,apple,Zed", "이름 오름차순(한글 가나다 다음 영문, 대소문자 무시) " + asc.names);
    const desc = await look({ sort: "name-desc" });
    check(desc.names === "Zed,apple,라온,다온,나비,가람", "이름 내림차순 " + desc.names);
    const subOn = await look({ sub: "on" });
    check(subOn.names === "나비,다온", "구독 중(버튼 '구독중') " + subOn.names);
    const subOff = await look({ sub: "off" });
    check(subOff.names === "가람,Zed,apple,라온", "구독 안 함(버튼 '구독' 또는 구독 버튼 없음) " + subOff.names);
    const alarmOn = await look({ alarm: "on", sort: "name-asc" });
    check(alarmOn.names === "나비,라온,Zed", "알림 켬('알림 끄기' 버튼) + 이름순 " + alarmOn.names);
    const both = await look({ alarm: "off", sub: "off" });
    check(both.names === "가람,apple", "구독 안 함 + 알림 끔 함께 " + both.names);
    const group = await look({ sort: "name-asc" }, [hex(1), hex(5), hex(6)]);
    check(group.names === "나비,라온,apple", "전용 팔로잉 그룹과 함께 " + group.names);

    // 숨긴 카드는 display:none 이 아니라 배치에서만 뺀다(아이콘 그라디언트 id 참조가 끊기지 않게) — 자리를 차지하지 않는다.
    const hiddenBox = await ev(`(async () => {
      window.__groupIds = null;
      api.set({ sub: 'on' }); ${frames}
      const list = document.querySelector('ul._list_x');
      const hidden = [...list.children].find((li) => li.hasAttribute('data-cheese-channel-hidden'));
      const shown = [...list.children].filter((li) => !li.hasAttribute('data-cheese-channel-hidden'));
      const cs = getComputedStyle(hidden), r = hidden.getBoundingClientRect();
      return { display: cs.display, position: cs.position, w: r.width, h: r.height, pointer: cs.pointerEvents,
        firstTwoSameRow: Math.round(shown[0].getBoundingClientRect().top) === Math.round(shown[1].getBoundingClientRect().top),
        listHeight: Math.round(list.getBoundingClientRect().height) };
    })()`);
    check(hiddenBox.display !== "none" && hiddenBox.position === "absolute" && hiddenBox.w <= 1 && hiddenBox.h <= 1 &&
      hiddenBox.pointer === "none" && hiddenBox.firstTwoSameRow && hiddenBox.listHeight === 60,
      "숨긴 카드는 display:none 이 아니고(아이콘 id 참조 유지) 자리·클릭을 차지하지 않는다 " + JSON.stringify(hiddenBox));

    // 마우스를 올린 카드는 버튼 글자가 바뀌어도(구독중 → 다른 글자) 마지막 상태로 둔다(깜빡임 방지).
    const hover = await ev(`(async () => {
      const li = [...document.querySelectorAll('ul._list_x > li')].find((x) => x.querySelector('._text_e').textContent === '나비');
      const button = [...li.querySelectorAll('button')].find((x) => /구독중/.test(x.textContent));
      button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      button.lastChild.textContent = '구독 관리'; // 마우스를 올리면 바뀌는 글자 흉내
      api.apply(); ${frames}
      return { whileHover: !li.hasAttribute('data-cheese-channel-hidden') };
    })()`);
    // 옆 카드로 옮기는 순간(포인터 이벤트가 먼저 와서 버튼은 아직 호버 글자) 다시 읽지 않고, 치지직이 버튼을
    // 돌려놓은 뒤(0.4초) 읽는다. 해지했으면 그때 숨긴다.
    const left = await ev(`(async () => {
      const find = (name) => [...document.querySelectorAll('ul._list_x > li')].find((x) => x.querySelector('._text_e').textContent === name);
      const li = find('나비');
      const subButton = () => [...li.querySelectorAll('button')].find((x) => /^구독/.test(x.lastChild.textContent));
      find('다온').querySelector('._text_e').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); // 오른쪽 카드로
      api.apply();
      const atLeave = !li.hasAttribute('data-cheese-channel-hidden'); // 아직 '구독 관리' 글자
      subButton().lastChild.textContent = '구독중'; // 치지직이 마우스가 떠난 뒤 돌려놓음
      await new Promise((r) => setTimeout(r, 500));
      const settled = !li.hasAttribute('data-cheese-channel-hidden');
      // 해지: 올려 두고 '구독'으로 바뀐 뒤 떠나면, 잠시 뒤 숨긴다.
      subButton().dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      subButton().lastChild.textContent = '구독';
      find('다온').querySelector('._text_e').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      api.apply();
      const heldAfterUnsub = !li.hasAttribute('data-cheese-channel-hidden');
      await new Promise((r) => setTimeout(r, 500));
      const hiddenAfterUnsub = li.hasAttribute('data-cheese-channel-hidden');
      subButton().lastChild.textContent = '구독중';
      document.querySelector('[data-cf-channel-count]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      api.apply();
      return { atLeave, settled, heldAfterUnsub, hiddenAfterUnsub, back: !li.hasAttribute('data-cheese-channel-hidden') };
    })()`);
    check(hover.whileHover, "마우스를 올린 카드는 버튼 글자가 바뀌어도 숨기지 않는다(뒤 카드가 당겨 올라오며 깜빡이던 문제)");
    check(left.atLeave && left.settled,
      "구독중 버튼에 올렸다가 옆 카드로 옮겨도(버튼이 아직 호버 글자) 숨기지 않는다 " + JSON.stringify(left));
    check(left.heldAfterUnsub && left.hiddenAfterUnsub && left.back, "해지하고 떠나면 잠시 뒤 숨기고, 다시 구독하면 보인다");

    // 바뀐 것이 없으면 카드 속성을 건드리지 않는다(틱마다 목록 전체를 다시 계산하지 않게).
    const writes = await ev(`(async () => {
      window.__groupIds = null;
      api.set({ sort: 'name-asc', sub: 'off' }); ${frames}
      let n = 0;
      const mo = new MutationObserver((records) => { n += records.filter((r) => r.target.tagName === 'LI').length; });
      mo.observe(document.querySelector('ul._list_x'), { attributes: true, subtree: true });
      for (let i = 0; i < 5; i += 1) api.apply();
      await new Promise((r) => setTimeout(r, 0));
      mo.disconnect();
      return n;
    })()`);
    check(writes === 0, "같은 상태로 다시 적용해도 카드 속성을 고치지 않는다 " + writes);

    // 남은 묶음 불러오기: 감지 지점을 화면 가운데 1px 에 붙이고, 목록이 늘면 떼었다 다시 붙인다. 감지 지점이 사라지면 끝.
    const load = await ev(`(async () => {
      const list = document.querySelector('ul._list_x');
      const sentinel = list.nextElementSibling;
      window.__groupIds = null;
      api.set({ sort: 'name-asc' }); ${frames}
      const pinned = sentinel.hasAttribute('data-cheese-channel-loadall') && getComputedStyle(sentinel).position === 'fixed';
      const loading = document.querySelector('[data-cf-channel-count]').textContent;
      list.insertAdjacentHTML('beforeend', ${JSON.stringify(card(hex(7), "바다", { sub: true }))});
      api.apply();
      const detached = !sentinel.hasAttribute('data-cheese-channel-loadall');
      ${frames}
      const repinned = sentinel.hasAttribute('data-cheese-channel-loadall');
      const names = [...list.children].filter((li) => !li.hasAttribute('data-cheese-channel-hidden'))
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map((li) => li.querySelector('._text_e').textContent).join(',');
      sentinel.remove(); // 마지막 묶음 뒤 치지직이 감지 지점을 없앤다
      api.apply();
      const done = document.querySelector('[data-cf-channel-count]').textContent;
      api.set({}); ${frames}
      const cleared = !list.hasAttribute('data-cheese-channel-view') && [...list.children].every((li) => !li.style.order && !li.hasAttribute('data-cheese-channel-hidden'));
      return { pinned, loading, detached, repinned, names, done, cleared };
    })()`);
    check(load.pinned && /모두 불러오는 중… 6개/.test(load.loading), "정렬을 고르면 감지 지점을 화면에 붙여 남은 묶음을 부른다 " + JSON.stringify(load));
    check(load.detached && load.repinned, "새 묶음이 붙으면 떼었다 두 프레임 뒤 다시 붙인다(같은 요소가 남는 감지 지점)");
    check(load.names === "가람,나비,다온,라온,바다,apple,Zed", "새로 붙은 카드도 정렬에 들어간다 " + load.names);
    check(load.done === "7개 중 7개", "감지 지점이 사라지면 다 불러온 것으로 본다 " + load.done);
    check(load.cleared, "기본으로 돌리면 순서·숨김 표시를 모두 걷는다");
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
