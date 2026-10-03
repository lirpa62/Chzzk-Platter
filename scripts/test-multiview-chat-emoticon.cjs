// 멀티뷰 채팅 칸이 낮을 때(빈 칸 배치) 이모티콘 창이 보이는지 잰다(헤드리스 크롬 + 실제 content.css).
//
// 2026-10-04 실측: 치지직은 이모티콘 창(_area_ 바로 아래 _container_ _emoticon_) 최대 높이를
// '채팅 화면 높이 − 260px' 로 잡는다. 873px 채팅 → 613px, 빈 칸 263px 채팅 → 3px(안 보임).
// 창은 입력 영역(_area_, 263px 칸에서 높이 105) 바로 위에 붙고 안쪽 목록이 스크롤한다.
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "mv-emoticon-"));
const browser = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buffer = "",
  seq = 0;
const pending = new Map();
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\0")) >= 0;) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const msg = JSON.parse(raw),
      job = pending.get(msg.id);
    if (!job) continue;
    pending.delete(msg.id);
    msg.error
      ? job.reject(Error(JSON.stringify(msg.error)))
      : job.resolve(msg.result);
  }
});
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });

const assert = require("node:assert/strict");
const checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };

(async () => {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (m, p) => call(m, p, sessionId);
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const css = readFileSync(join(ROOT, "src/content.css"), "utf8");
  // 2026-10-04 [EMOJI2] 실측 구조: 창(위 여백 20) > 제목(20) + #popup_contents(flex column,
  // overflow auto, 아래 여백 11) > 카테고리 메뉴(52) + #emoji_area(flex 1 1 0%, overflow auto, 내용 142).
  // 창 자체 높이는 298px(873px 채팅 실측)이고 치지직이 max-height 로 자른다.
  const measure = async (width, height, frameClass, areaHeight = 105) => {
    await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return ev(`(()=>{
      document.documentElement.className=${JSON.stringify(frameClass ? "cheese-popup-player-frame cheese-multiview-chat-frame" : "")};
      document.body.innerHTML='<style>'+
        'html,body{margin:0;overflow:hidden}'+
        '#aside-chatting{display:flex;flex-direction:column;height:100vh;position:relative}'+
        '.list{flex:1 1 auto}'+
        '.size-buttons{position:absolute;left:0;right:0;top:0;bottom:0;z-index:1500}'+
        '._area_b8csn_49{position:relative;z-index:1000;height:${areaHeight}px;flex:none}'+
        '.input{height:40px;background:#333;position:relative;z-index:500}'+
        '._emoticon_b8csn_75{position:absolute;left:10px;right:10px;bottom:100%;z-index:100;display:flex;flex-direction:column;'+
          'box-sizing:border-box;padding-top:20px;height:298px;max-height:calc(100vh - 260px);background:#222}'+
        '._header_jao35_63{height:20px;flex:none}'+
        '#popup_contents{display:flex;flex-direction:column;flex:1 1 0%;overflow:auto;padding-bottom:11px}'+
        '._menu_ley17_17{height:52px}'+
        '#emoji_area{flex:1 1 0%;overflow:auto}'+
        '._group_ley17_120{height:122px}'+
        '</style>'+
        '<aside id="aside-chatting" class="_container_b8csn_2 _is_popup_chat_b8csn_13"><div class="list"></div>'+
        '<div class="size-buttons"></div>'+
        '<div class="_area_b8csn_49"><div class="input"></div><div class="_container_jao35_20 _emoticon_b8csn_75"><div class="_header_jao35_63"></div>'+
        '<div id="popup_contents" class="_contents_jao35_54"><div class="_menu_ley17_17"></div><div id="emoji_area" class="_area_ley17_101">'+
        '<div class="_group_ley17_120"><button class="_emoticon_ley17_179">e</button></div></div></div></div></div></aside>';
      if(!document.getElementById('cheese-css')){const s=document.createElement('style');s.id='cheese-css';s.textContent=${JSON.stringify(css)};document.head.append(s);}
      const r=(sel)=>{const b=document.querySelector(sel).getBoundingClientRect();return {h:Math.round(b.height),top:Math.round(b.top),bottom:Math.round(b.bottom)};};
      const pop=document.querySelector('._emoticon_b8csn_75');
      return {popup:r('._emoticon_b8csn_75'),list:r('#emoji_area'),area:r('._area_b8csn_49'),
        maxH:getComputedStyle(pop).maxHeight, z:getComputedStyle(pop).zIndex,
        areaZ:getComputedStyle(document.querySelector('._area_b8csn_49')).zIndex,
        popupOnTop:(()=>{const b=pop.getBoundingClientRect();
          return !!document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('._emoticon_b8csn_75');})(),
        inputCovered:(()=>{const b=document.querySelector('.input').getBoundingClientRect();
          const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
          return !!hit?.closest('._emoticon_b8csn_75');})(),
        emojiButtonMax:getComputedStyle(document.querySelector('button._emoticon_ley17_179')).maxHeight};
    })()`);
  };

  const before = await measure(453, 263, false);
  check(before.popup.h === 20 && before.list.h === 0,
    `재현(치지직 그대로): 263px 채팅에서 창 ${before.popup.h}px(여백만)·목록 ${before.list.h}px — 첫 실측과 같다`);

  const small = await measure(453, 263, true);
  check(small.list.h >= 120, `빈 칸(263px): 이모티콘 목록 칸 ${small.list.h}px(실측 문제 때 20px)`);
  check(small.popup.top >= 0 && small.popup.bottom <= 263, "창이 채팅 화면 안에 다 들어온다");
  check(small.popup.bottom > small.area.top, "아주 낮은 채팅에서는 입력 영역까지 덮어 공간을 쓴다");
  check(small.areaZ === "2000" && small.popupOnTop,
    "창이 열려 있으면 입력 영역째 z-index 2000: 바깥의 채팅 크기 조절 버튼(z-index 1500)이 창 위로 비치지 않는다");
  check(before.areaZ === "1000", "멀티뷰가 아닌 채팅은 입력 영역 z-index 를 건드리지 않는다");
  check(small.z === "2000" && small.inputCovered,
    "창 z-index 2000: 입력 영역 안의 입력창·도구(z-index 500)가 창 위로 비치지 않는다");
  const narrow = await measure(259, 263, true, 133);
  check(narrow.popup.top >= 0 && narrow.list.h >= 120, "입력 영역이 높은 좁은 채팅에서도 목록이 보인다");

  const mid = await measure(453, 400, true);
  check(mid.maxH === "260px" && mid.popup.top >= 0 && mid.popup.bottom <= mid.area.top + 1 && mid.list.h >= 120,
    `중간(400px)은 입력창 위 공간까지만(${mid.maxH}, 목록 ${mid.list.h}px)`);
  const tall = await measure(259, 873, true);
  check(tall.maxH === "613px" && tall.popup.h === 298 && tall.popup.bottom <= tall.area.top + 1,
    `높은 채팅은 치지직 그대로(${tall.maxH}, 창 ${tall.popup.h}px, 입력창 위)`);
  check(small.emojiButtonMax === "none", "이모티콘 버튼 등 다른 _emoticon_ 요소는 건드리지 않는다");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})()
  .catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(() => { browser.kill("SIGTERM"); try { rmSync(dir, { recursive: true, force: true }); } catch {} });
