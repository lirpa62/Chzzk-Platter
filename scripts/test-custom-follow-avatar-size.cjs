// 접을 때 전용 팔로잉 프로필이 32px 에서 126px 까지 커지던 문제.
//
// 원인(실사용자 진단 + 픽스처 재현으로 확정):
//   렌더러가 네이티브 프로필 클래스를 harvest 하면 폴백 클래스
//   cheese-cf-profile 이 '붙지 않는다'. 그런데 우리 크기 규칙은 전부 그
//   폴백 클래스에 걸려 있었다. 즉 harvest 가 성공하는 실제 환경에서는
//   아바타 크기를 우리가 전혀 소유하지 않았다.
//   네이티브 _profile_ 의 크기 규칙은 펼침 상태에서만 걸리는 경우가 있어,
//   접히는 순간 래퍼가 크기를 잃고 블록으로 늘어나 접힘 레일 폭까지 커진다.
//   모서리 옵션이 켜져 있으면 이미지도 max-height:100% 를 따라 함께 커진다.
//
// ⚠ 모서리 옵션(cheese-channel-profile-radius-enabled)은 OFF 인 환경에서
//   제보됐다. 모서리 기능 문제가 아니므로 그 기능을 고쳐서 우회하지 않는다.
//
// 고침: harvest 성공 여부와 무관하게 항상 붙는 cheese-cf-avatar 로
//   크기만 고정한다(모양·링·모서리는 네이티브/기존 규칙 그대로).
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const SRC = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");
const CSS = readFileSync(join(__dirname, "..", "src", "content.css"), "utf8");

// ⚠ 렌더러를 손으로 베껴 두면 원본에서 클래스가 빠져도 이 검사가 통과한다.
//   반드시 원본에서 떼어 온다.
function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  const body = SRC.slice(at, end + 4);
  if (body.length < 80) throw Error(`떼어 낸 구간이 너무 짧다: ${name}`);
  return body;
}

const RENDERER = sliceFn("createCustomFollowItemHtml");
if (!/profileCls/.test(RENDERER)) {
  throw Error("떼어 낸 구간이 렌더러가 아니다");
}

// 렌더러가 쓰는 상수도 원본에서 떼어 온다(빈 값으로 스텁하면 실제 마크업과 달라진다).
function sliceConst(name) {
  const at = SRC.indexOf(`  const ${name} = `);
  if (at < 0) throw Error(`상수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n", at);
  if (end < at) throw Error(`상수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end);
}
const STAR_ICON = sliceConst("LUCIDE_STAR_ICON");

const dir = mkdtempSync(join(tmpdir(), "cheese-cfav-"));
const b = spawn(
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
let buf = "",
  seq = 0;
const pend = new Map();
b.stdio[4].on("data", (c) => {
  buf += c;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
    if (!raw) continue;
    const m = JSON.parse(raw),
      j = pend.get(m.id);
    if (!j) continue;
    pend.delete(m.id);
    m.error ? j.reject(Error(JSON.stringify(m.error))) : j.resolve(m.result);
  }
});
const call = (m, p = {}, s) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { resolve: res, reject: rej });
    b.stdio[3].write(
      JSON.stringify({ id, method: m, params: p, sessionId: s }) + "\0",
    );
  });

let failed = 0;
const ok = (c, l) => {
  console.log((c ? "  PASS " : "  FAIL ") + l);
  if (!c) failed += 1;
};
const cleanup = () => {
  try {
    b.kill();
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
};

// 네이티브 mock. 실제 CHZZK 처럼 '펼침에서만' 프로필 크기를 정해 준다.
// 접힘에서는 크기 규칙이 없어 블록으로 늘어난다 — 이것이 126px 의 정체다.
const NATIVE_CSS = `
  aside#sidebar{position:fixed;left:0;top:0;height:100vh;width:250px;background:#111}
  aside#sidebar:not([class*="_is_expanded_"]){width:136px}
  #cheese-custom-follow{list-style:none;margin:0;padding:2px}
  .cheese-cf-item{display:block}
  aside#sidebar[class*="_is_expanded_"] ._item_x1{display:flex;align-items:center;gap:8px}
  ._item_x1{display:block}
  aside#sidebar[class*="_is_expanded_"] ._profile_x1{width:32px;height:32px;flex:none}
  aside#sidebar[class*="_is_expanded_"] ._profile_x1 img{width:26px;height:26px}
  ._profile_x1{position:relative;padding:1px;box-sizing:border-box;border-radius:50%}
  ._profile_x1 img{display:block}
  ._profile_x1._is_live_x1{background:linear-gradient(#0ff,#027f80)}
  .cheese-cf-item:hover ._profile_x1{padding:4px}
`;

// harvest 성공(네이티브 해시 클래스) / 실패(폴백) 두 경우.
const HARVEST = {
  li: "_li_x1",
  inner: "_item_x1",
  profile: "_profile_x1",
  profileLive: "_profile_x1 _is_live_x1",
  information: "_information_x1",
  name: "_name_x1",
  ellipsis: "_ellipsis_x1",
  text: "_text_x1",
  description: "_desc_x1",
  count: "_count_x1",
  icon: "_icon_x1",
  iconParty: "_party_x1",
  participant: "_participant_x1",
};

(async () => {
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const ev = async (e) => {
    const r = await call(
      "Runtime.evaluate",
      { expression: e, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails)
      throw Error("EXC " + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  // 렌더러와 그 의존 함수를 원본 그대로 올린다.
  await ev(`(()=>{
    window.CHANNEL_PROFILE_RADIUS_TARGET_CLASS = "cheese-channel-profile-radius-target";
    window.CUSTOM_FOLLOW_DEFAULT_PROFILE_LIGHT_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    window.CUSTOM_FOLLOW_DEFAULT_PROFILE_DARK_URL = window.CUSTOM_FOLLOW_DEFAULT_PROFILE_LIGHT_URL;
    window.featureFlags = { sbFollowFavEnabled:true, sbFollowFavSort:false };
    window.customFollowFavorites = new Set();
    window.customFollowSquares = new Map();
    window.customFollowFavSort = "name";
    window.customFollowGroupSortKey = "";
    window.CUSTOM_FOLLOW_FAV_SORT_TARGET = "fav";
    window.escapeHtml = (v)=>String(v).replace(/[&<>"']/g,(m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
    window.escapeAttribute = window.escapeHtml;
    window.customFollowProfileThumb = (u)=> u ? u : "";
    window.customFollowPartyIcon = (cls)=>'<i class="'+cls+'"></i>';
    ${STAR_ICON}
    ${RENDERER}
    window.createCustomFollowItemHtml = createCustomFollowItemHtml;
    return true;
  })()`);

  const IMG =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  // 한 항목을 렌더해 사이드바에 넣는다.
  const build = async (harvest, item, expanded) =>
    ev(`(()=>{
      document.documentElement.className='';
      document.documentElement.innerHTML='<head></head><body></body>';
      const ours=document.createElement('style'); ours.textContent=${JSON.stringify(CSS)};
      document.head.appendChild(ours);
      const nat=document.createElement('style'); nat.textContent=${JSON.stringify(NATIVE_CSS)};
      document.head.appendChild(nat);
      const h = ${harvest ? JSON.stringify(HARVEST) : "null"};
      const html = createCustomFollowItemHtml(${JSON.stringify(item)}, h, ${expanded ? '"_is_expanded_"' : '""'}, {});
      document.body.innerHTML =
        ${JSON.stringify(
          expanded
            ? '<aside id="sidebar" class="_is_expanded_">'
            : '<aside id="sidebar">',
        )}+
        '<ul id="cheese-custom-follow">'+html+'</ul></aside>';
      return true;})()`);

  const measure = () =>
    ev(`(()=>{
      const w=document.querySelector('#cheese-custom-follow .cheese-cf-avatar')
            || document.querySelector('#cheese-custom-follow .cheese-channel-profile-radius-target');
      if(!w) return null;
      const imgs=[...w.querySelectorAll('img')].filter(i=>getComputedStyle(i).display!=='none');
      const i=imgs[0];
      const wr=w.getBoundingClientRect();
      const ir=i?i.getBoundingClientRect():null;
      const cs=getComputedStyle(w);
      return {wrap:[Math.round(wr.width),Math.round(wr.height)],
              img: ir?[Math.round(ir.width),Math.round(ir.height)]:null,
              itemHeight:Math.round(w.closest('.cheese-cf-item').getBoundingClientRect().height),
              gap:ir?[ir.left-wr.left,ir.top-wr.top,wr.right-ir.right,wr.bottom-ir.bottom].map(v=>Math.round(v*10)/10):null,
              imageRadius:i?getComputedStyle(i).borderRadius:null,
              imageOutline:i?getComputedStyle(i).outlineWidth:null,
              imageOutlineStyle:i?getComputedStyle(i).outlineStyle:null,
              radius: cs.borderRadius, overflow: cs.overflow,
              hasStable: w.classList.contains('cheese-cf-avatar'),
              visibleImgs: imgs.length,
              cls: w.className};})()`);

  const OFFLINE = {
    channelId: "ch1",
    name: "채널",
    live: false,
    imageUrl: IMG,
  };
  const LIVE = {
    channelId: "ch2",
    name: "라이브",
    live: true,
    imageUrl: IMG,
    countText: "1,234",
    category: "게임",
  };
  const NOIMG = { channelId: "ch3", name: "기본", live: false, imageUrl: "" };
  const PARTY = {
    channelId: "ch4",
    name: "파티",
    live: true,
    imageUrl: IMG,
    party: { partyNo: 7, others: 2 },
  };

  const inRange = (v, want, tol = 2) => Math.abs(v - want) <= tol;
  const sizeOk = (m, ww, ii, tol = 2) =>
    m &&
    inRange(m.wrap[0], ww, tol) &&
    inRange(m.wrap[1], ww, tol) &&
    (ii == null ||
      (m.img && inRange(m.img[0], ii, tol) && inRange(m.img[1], ii, tol)));

  const collapse = () =>
    ev(`(()=>{document.getElementById('sidebar').className='';
      const inner=document.querySelector('.cheese-cf-inner');
      inner.className=inner.className.replace(/\\s*_is_expanded_/,'');
      return true;})()`);

  console.log("[재현·핵심] harvest 성공 + 모서리 OFF — 접어도 32/26 유지");
  {
    await build(true, OFFLINE, true);
    const exp = await measure();
    ok(
      sizeOk(exp, 32, 26),
      `펼침 32/26 (${JSON.stringify(exp && [exp.wrap, exp.img])})`,
    );
    await collapse();
    const col = await measure();
    // ⚠ 고치기 전에는 여기서 래퍼가 132px 까지 커졌다(제보 126px).
    ok(
      sizeOk(col, 32, 26),
      `접힘 32/26 (${JSON.stringify(col && [col.wrap, col.img])})`,
    );
    ok(
      col && col.wrap[0] < 40,
      `126px 로 커지지 않는다 (${col && col.wrap[0]}px)`,
    );
  }

  console.log("\n[네이티브 img 100%] 이미지 크기도 우리가 고정한다");
  {
    // ⚠ 치지직은 img 에 width/height:100% 를 주는 형태가 흔하다. 그 경우
    //   래퍼만 고정하면 이미지는 래퍼를 꽉 채워(패딩만 뺀) 30px 이 된다.
    //   제보값의 img 124px 도 같은 경로다. 그래서 이미지 크기도 소유한다.
    await ev(`(()=>{const s=document.createElement('style');
      s.id='nat-img-full';
      s.textContent='._profile_x1 img{width:100% !important;height:100% !important}';
      document.head.appendChild(s); return true;})()`);
    const m = await measure();
    ok(
      m && inRange(m.img[0], 26) && inRange(m.img[1], 26),
      `네이티브가 100% 를 줘도 26 유지 (${JSON.stringify(m && m.img)})`,
    );
    await ev(`document.getElementById('nat-img-full')?.remove()`);
  }

  console.log("\n[모서리 ON] 접힘에서도 래퍼가 고정된다");
  {
    await build(true, OFFLINE, true);
    await ev(
      `document.documentElement.classList.add('cheese-channel-profile-radius-enabled')`,
    );
    await collapse();
    const col = await measure();
    // 모서리 ON 은 이미지를 래퍼 100% 로 채우는 기존 설계다(패딩 2px).
    // 래퍼가 고정됐으므로 이미지도 래퍼를 넘지 않는다.
    ok(col && inRange(col.wrap[0], 32), `래퍼 32 유지 (${col && col.wrap[0]})`);
    ok(
      col && col.img[0] <= 34,
      `이미지가 래퍼를 넘지 않는다 (${col && col.img[0]})`,
    );
    ok(col && col.wrap[0] < 40, "126px 로 커지지 않는다");
    ok(col && col.gap.every((v) => inRange(v, 3, 0.2)),
      `사진의 사방 간격이 같다 (${JSON.stringify(col && col.gap)})`);
    const pos = await ev(`(()=>{const r=document.querySelector('.cheese-cf-avatar').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call("Input.dispatchMouseEvent", {type:"mouseMoved",x:pos.x,y:pos.y}, sessionId);
    const hovered = await measure();
    ok(hovered && hovered.gap.every((v) => inRange(v, 3, 0.2)),
      `호버해도 사진 간격이 변하지 않는다 (${JSON.stringify(hovered && hovered.gap)})`);
  }

  console.log("\n[모서리 ON] 펼침도 정상");
  {
    await build(true, OFFLINE, true);
    await ev(
      `document.documentElement.classList.add('cheese-channel-profile-radius-enabled')`,
    );
    const exp = await measure();
    ok(exp && inRange(exp.wrap[0], 32), `펼침 래퍼 32 (${exp && exp.wrap[0]})`);
  }

  console.log("\n[폴백] harvest 실패 시 기존 30px 링 크기를 지킨다");
  {
    // ⚠ 폴백은 자체 링 디자인(30px)이다. 이걸 32 로 바꾸면 기존 모양이 변한다.
    await build(false, OFFLINE, true);
    const exp = await measure();
    ok(
      sizeOk(exp, 30, null),
      `펼침 폴백 30 (${JSON.stringify(exp && exp.wrap)})`,
    );
    await collapse();
    const col = await measure();
    ok(
      sizeOk(col, 30, null),
      `접힘 폴백 30 (${JSON.stringify(col && col.wrap)})`,
    );
    ok(col && col.wrap[0] < 40, "폴백도 커지지 않는다");
  }

  console.log(
    "\n[안정 클래스] harvest 성공/실패 모두 cheese-cf-avatar 가 붙는다",
  );
  {
    await build(true, OFFLINE, true);
    const a = await measure();
    ok(a && a.hasStable, `harvest 성공에도 붙는다 (${a && a.cls})`);
    ok(a && /_profile_x1/.test(a.cls), "네이티브 클래스도 함께 유지한다");
    await build(false, OFFLINE, true);
    const bb = await measure();
    ok(bb && bb.hasStable, "harvest 실패에도 붙는다");
    ok(bb && /cheese-cf-profile/.test(bb.cls), "폴백 클래스도 유지한다");
  }

  console.log("\n[라이브] 링 클래스와 크기 모두 정상");
  {
    await build(true, LIVE, true);
    const exp = await measure();
    ok(exp && /_is_live_x1/.test(exp.cls), "라이브 네이티브 링 클래스 유지");
    ok(
      sizeOk(exp, 32, 26),
      `라이브 펼침 32/26 (${JSON.stringify(exp && [exp.wrap, exp.img])})`,
    );
    await collapse();
    const col = await measure();
    ok(
      sizeOk(col, 32, 26),
      `라이브 접힘 32/26 (${JSON.stringify(col && [col.wrap, col.img])})`,
    );
    // 폴백 라이브도 is-live 가 남아야 링이 그려진다.
    await build(false, LIVE, true);
    const fb = await measure();
    ok(fb && /is-live/.test(fb.cls), "폴백 라이브 링 클래스 유지");
  }

  console.log("\n[기본 프로필] 두 이미지 중 하나만 보이고 크기 정상");
  {
    await build(true, NOIMG, true);
    const exp = await measure();
    ok(
      exp && exp.visibleImgs === 1,
      `보이는 이미지 1개 (${exp && exp.visibleImgs})`,
    );
    ok(
      sizeOk(exp, 32, 26),
      `기본 프로필 32/26 (${JSON.stringify(exp && [exp.wrap, exp.img])})`,
    );
    await collapse();
    const col = await measure();
    ok(
      sizeOk(col, 32, 26),
      `접힘도 32/26 (${JSON.stringify(col && [col.wrap, col.img])})`,
    );
  }

  console.log("\n[파티 배지] 배지가 남고 잘리지 않는다");
  {
    await build(true, PARTY, true);
    const has = await ev(
      `!!document.querySelector('#cheese-custom-follow .cheese-cf-avatar ._party_x1')`,
    );
    ok(has, "파티 아이콘이 래퍼 안에 있다");
    const ov = await measure();
    // ⚠ 우리가 overflow:hidden 을 새로 강제하면 배지가 잘린다. 건드리지 않았는지 본다.
    ok(
      ov && ov.overflow !== "hidden",
      `overflow 를 새로 숨기지 않는다 (${ov && ov.overflow})`,
    );
  }

  console.log("\n[사각 프로필] 크기와 모서리는 별개로 관리된다");
  {
    await ev(
      `customFollowSquares = new Map([["ch1", new Set(["following"])]])`,
    );
    await build(true, OFFLINE, true);
    const m = await measure();
    ok(m && /cheese-cf-square/.test(m.cls), "square 클래스가 붙는다");
    ok(
      sizeOk(m, 32, 26),
      `square 여도 크기 32/26 (${JSON.stringify(m && [m.wrap, m.img])})`,
    );
    await ev(`document.documentElement.classList.add('cheese-channel-profile-radius-enabled')`);
    await collapse();
    const square = await measure();
    ok(square && square.wrap[0]===36 && square.wrap[1]===120 &&
      square.img[0]===30 && square.img[1]===114,
      `접힌 선택 프로필은 세로형 36/120이다 (${JSON.stringify(square && [square.wrap,square.img])})`);
    ok(square && square.itemHeight>=126,
      `세로형 프로필의 행도 높이를 확보한다 (${square && square.itemHeight})`);
    ok(square && square.gap.every((v) => inRange(v, 3, 0.2)),
      `접힌 사각 프로필 사진은 바깥 링에서 3px 떨어진다 (${JSON.stringify(square && square.gap)})`);
    ok(square && square.radius === "0px" && square.imageRadius === "0px",
      `사각 프로필의 링과 사진이 모두 각지다 (${square && square.radius}/${square && square.imageRadius})`);
    await call("Input.dispatchMouseEvent", {type:"mouseMoved",x:500,y:500}, sessionId);
    const idle = await measure();
    ok(idle && idle.imageOutlineStyle === "none", "호버 전에는 강조 테두리가 없다");
    const center = await ev(`(()=>{const r=document.querySelector('.cheese-cf-avatar').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call("Input.dispatchMouseEvent", {type:"mouseMoved",x:center.x,y:center.y}, sessionId);
    const hoveredSquare = await measure();
    ok(hoveredSquare && hoveredSquare.imageOutlineStyle === "solid" &&
      hoveredSquare.imageOutline === "2px" &&
      hoveredSquare.wrap[0]===36 && hoveredSquare.wrap[1]===120,
      `호버 테두리만 선명해지고 크기는 유지된다 (${hoveredSquare && hoveredSquare.imageOutline})`);
    await call("Input.dispatchMouseEvent", {type:"mouseMoved",x:500,y:500}, sessionId);
    await ev(`document.querySelector('.cheese-cf-link').focus()`);
    const focusedSquare = await measure();
    ok(focusedSquare && focusedSquare.imageOutline === "2px",
      "키보드 포커스에서도 강조 테두리가 나타난다");
    await ev(`document.activeElement.blur()`);
    await ev(`document.getElementById('sidebar').className='_is_expanded_';`);
    const expanded = await measure();
    ok(expanded && expanded.radius !== "0px" && expanded.imageRadius !== "0px",
      `펼치면 원래 모서리로 돌아온다 (${expanded && expanded.radius}/${expanded && expanded.imageRadius})`);
    await build(true, OFFLINE, false);
    const groupFit = await ev(`(()=>{
      const sidebar=document.getElementById('sidebar');
      sidebar.style.width='42px';
      const old=document.getElementById('cheese-custom-follow');
      const nav=document.createElement('nav');
      nav.id=old.id;
      const group=document.createElement('div');
      group.className='cheese-cf-group';
      const list=document.createElement('ul');
      list.className='cheese-cf-list cheese-cf-group-list';
      list.appendChild(old.firstElementChild);
      group.appendChild(list);
      nav.appendChild(group);
      old.replaceWith(nav);
      const rail=sidebar.getBoundingClientRect();
      const photo=nav.querySelector('.cheese-cf-avatar').getBoundingClientRect();
      return {left:photo.left-rail.left,right:rail.right-photo.right};
    })()`);
    ok(groupFit && groupFit.left>=0 && groupFit.right>=0,
      `42px 그룹 레일 안에서 잘리지 않는다 (${JSON.stringify(groupFit)})`);
    await ev(`customFollowSquares = new Map()`);
  }

  console.log("\n[좁은/넓은 화면] 폭이 달라도 크기가 같다");
  {
    for (const w of [645, 1199, 1200, 1600]) {
      await call(
        "Emulation.setDeviceMetricsOverride",
        { width: w, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await build(true, OFFLINE, true);
      await collapse();
      const col = await measure();
      ok(
        sizeOk(col, 32, 26),
        `${w}px 에서 접힘 32/26 (${JSON.stringify(col && [col.wrap, col.img])})`,
      );
    }
    await call(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
  }

  console.log("\n[반복] 펼침↔접힘을 5회 반복해도 튀지 않는다");
  {
    await build(true, OFFLINE, true);
    let worst = 0;
    for (let i = 0; i < 5; i += 1) {
      await collapse();
      let m = await measure();
      worst = Math.max(worst, m.wrap[0]);
      await ev(`(()=>{document.getElementById('sidebar').className='_is_expanded_';
        const inner=document.querySelector('.cheese-cf-inner');
        if(!/_is_expanded_/.test(inner.className)) inner.className+=' _is_expanded_';
        return true;})()`);
      m = await measure();
      worst = Math.max(worst, m.wrap[0]);
    }
    ok(worst <= 34, `반복 중 최대 래퍼 폭 ${worst}px (126 으로 튀지 않음)`);
  }

  console.log("\n[범위] 전용 목록 밖 네이티브 아바타는 건드리지 않는다");
  {
    await ev(`(()=>{
      const d=document.createElement('div');
      d.innerHTML='<div class="_profile_x1 cheese-channel-profile-radius-target" id="outside">'+
        '<img width="26" height="26" src="${IMG}"></div>';
      document.body.appendChild(d.firstChild);
      return true;})()`);
    const outside = await ev(`(()=>{const w=document.getElementById('outside');
      const cs=getComputedStyle(w);
      return {w:cs.width,h:cs.height,minW:cs.minWidth,maxW:cs.maxWidth};})()`);
    // 우리 규칙이 새 나가면 여기 32px 이 찍힌다.
    ok(
      outside.minW === "0px" && outside.maxW === "none",
      `바깥 요소에 크기 규칙이 걸리지 않는다 (${JSON.stringify(outside)})`,
    );
  }

  console.log("\n[소스] 안정 클래스가 harvest 와 무관하게 붙는다");
  {
    const at = SRC.indexOf("    const profileCls =");
    const chunk = SRC.slice(at, at + 400);
    ok(
      /"cheese-cf-avatar "/.test(chunk),
      "renderer 가 cheese-cf-avatar 를 항상 붙인다",
    );
    // ⚠ 폴백 안에만 넣으면 harvest 성공 시 다시 사라진다.
    ok(
      !/c\(h\?\.profile,\s*"[^"]*cheese-cf-avatar/.test(chunk),
      "폴백 인자 안에 숨겨 넣지 않는다",
    );
    ok(
      /#cheese-custom-follow \.cheese-cf-avatar \{/.test(CSS),
      "CSS 소유 규칙이 전용 목록으로 한정된다",
    );
    // ⚠ 스코프를 잃으면 사이트 전체 아바타가 32px 이 된다.
    ok(
      !/^\.cheese-cf-avatar\s*\{/m.test(CSS),
      "전역 .cheese-cf-avatar 규칙을 만들지 않는다",
    );
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  await call("Target.closeTarget", { targetId });
  cleanup();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
