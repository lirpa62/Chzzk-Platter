// 멀티뷰 라이브 칸에서 광고(입장·중간) 동안 치지직이 강제로 펼친 채팅이 광고 자리를
// 다 차지하지 않는지 잰다(헤드리스 크롬 + 실제 content.css).
//
// 2026-10-02 실측 구조를 흉내 낸다: 플레이어 열(_contents_)은 width:100%·flex 0 1 auto,
// 채팅(aside#aside-chatting)은 353px·flex 0 0 auto 라 354px 칸에서 플레이어 열이 0.5px 였다.
// 중간광고 때 원래 방송(#live_player_layout.miniplayer)은 플레이어 열 안(_player_ > _container_ >
// _wrapper_)에서 fixed 353×198 로 채팅 열 위에 뜨고, 뒤에 오는 채팅 요소에 가려질 수 있다.
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "mv-ad-chat-"));
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
  // wrapperZ: 미니플레이어 조상이 쌓임 맥락(z-index)을 만드는 경우도 본다.
  const measure = async (width, height, { frameClass, folded, mini, vod = false, wrapperZ = false }) => {
    await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    return ev(`(()=>{
      document.documentElement.className=${JSON.stringify(frameClass ? "cheese-popup-player-frame cheese-multiview-frame" + (vod ? " cheese-multiview-vod-frame" : "") : "")};
      document.body.innerHTML='<style>'+
        'html,body{margin:0;overflow:hidden}'+
        '._container_x{display:flex;width:100vw;height:100vh}'+
        '._contents_x{display:flex;flex:0 1 auto;width:100%}'+
        '._player_jwedy_23{display:flex;position:relative;width:100%}'+
        '._container_10lql_1{position:relative;width:100%}'+
        '._wrapper_10lql_11{position:absolute;inset:0${wrapperZ ? ";z-index:1" : ""}}'+
        '._container_b8csn_2{display:flex;flex:0 0 auto;width:353px;position:relative}'+
        '._is_folded_b8csn_10{display:none}'+
        '._input_x{position:absolute;inset:0;z-index:5;background:#222}'+
        '#live_player_layout{width:100%;height:100%}'+
        '#live_player_layout.miniplayer{position:fixed;top:44px;right:0;width:353px;height:198px}'+
        '</style>'+
        '<section class="_container_x"><div class="_contents_x"><div class="_player_jwedy_23">'+
        '<div class="_container_10lql_1"><div class="_wrapper_10lql_11">'+
        '<div id="live_player_layout" class="chzzk_player type_live${mini ? " miniplayer" : ""}"><div class="pzp-pc__video"></div></div>'+
        '</div></div></div></div>'+
        '<aside id="aside-chatting" class="_container_b8csn_2 _is_large_b8csn_31${folded ? " _is_folded_b8csn_10" : ""}"><div class="_input_x">chat</div></aside></section>';
      if(!document.getElementById('cheese-css')){const s=document.createElement('style');s.id='cheese-css';s.textContent=${JSON.stringify(css)};document.head.append(s);}
      const r=(sel)=>{const b=document.querySelector(sel).getBoundingClientRect();return {w:+b.width.toFixed(1),h:+b.height.toFixed(1),x:+b.left.toFixed(1),y:+b.top.toFixed(1)};};
      const m=document.getElementById('live_player_layout').getBoundingClientRect();
      const at=(x,y)=>{const el=document.elementFromPoint(x,y);return el?.closest('#live_player_layout')?'mini':el?.closest('aside')?'chat':el?.closest('._contents_x')?'player':'none';};
      return {player:r('._contents_x'),aside:r('#aside-chatting'),mini:r('#live_player_layout'),video:r('.pzp-pc__video'),
        top:at(m.left+m.width/2,m.top+m.height/2),below:at(m.left+m.width/2,Math.min(innerHeight-2,m.bottom+8))};
    })()`);
  };

  // 실측 재현: 우리 규칙이 없으면(멀티뷰 칸이 아니면) 작은 칸의 광고 자리는 0 에 가깝다.
  const before = await measure(354, 198, { frameClass: false, folded: false, mini: true });
  check(before.player.w < 2 && before.aside.w === 353, `재현: 354px 칸에서 광고 자리 ${before.player.w}px`);
  check(before.top === "chat", "재현: 채팅(입력창)이 미니플레이어를 덮는다");

  for (const [w, h] of [[354, 198], [709, 399], [1200, 675]]) {
    const ad = await measure(w, h, { frameClass: true, folded: false, mini: true });
    const chatW = Math.min(353, w * 0.4);
    check(Math.abs(ad.aside.w - chatW) <= 1 && Math.abs(ad.player.w - (w - chatW)) <= 1,
      `${w}px 칸 광고 중: 채팅 ${ad.aside.w}px · 광고 자리 ${ad.player.w}px (60% 이상)`);
    check(Math.abs(ad.mini.w - chatW) <= 1 && Math.abs(ad.mini.h - chatW * 9 / 16) <= 1 &&
      Math.abs(ad.mini.x - (w - chatW)) <= 1 && ad.video.w === ad.mini.w,
      `${w}px 칸: 원래 방송(미니플레이어)도 채팅 폭·16:9 (${ad.mini.w}×${ad.mini.h})`);
    check(ad.mini.y + ad.mini.h <= h, `${w}px 칸: 미니플레이어가 칸 아래로 잘리지 않는다`);
    check(ad.top === "mini" && ad.below === "chat",
      `${w}px 칸: 미니플레이어가 채팅 위에 보이고, 그 아래는 채팅 그대로`);
    const stacked = await measure(w, h, { frameClass: true, folded: false, mini: true, wrapperZ: true });
    check(stacked.top === "mini", `${w}px 칸: 조상이 쌓임 맥락을 만들어도 미니플레이어가 위에 보인다`);
  }
  {
    const normal = await measure(709, 399, { frameClass: true, folded: true, mini: false });
    check(normal.player.w === 709 && normal.aside.w === 0,
      "광고가 끝나 채팅이 접히면 플레이어가 칸 전체를 쓴다(규칙이 끼어들지 않는다)");
  }
  {
    const vod = await measure(354, 198, { frameClass: true, vod: true, folded: false, mini: false });
    check(vod.aside.w === 353, "다시보기 칸에는 적용하지 않는다");
  }
  {
    const content = readFileSync(join(ROOT, "src/content.js"), "utf8");
    check(/const enabled =\s*!IS_MULTIVIEW_FRAME &&\s*chatFeatureActive\("chatWidthResize"\)/.test(content),
      "멀티뷰 칸에서는 채팅 너비 조절(인라인 !important 폭)을 걸지 않는다");
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})()
  .catch((e) => { console.error("FAIL", e.message); process.exitCode = 1; })
  .finally(() => { browser.kill("SIGTERM"); try { rmSync(dir, { recursive: true, force: true }); } catch {} });
