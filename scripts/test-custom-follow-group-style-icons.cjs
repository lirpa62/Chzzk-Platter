// 전용 팔로잉 그룹: 구분 모양(세로줄·상자·구분선), 늘린 기본 아이콘, 이미지 아이콘.
// 그룹 구분이 왼쪽 세로줄 하나뿐이라 상자·가로선으로 확실히 나누고 싶다는 의견과, 아이콘을
// SVG 붙여넣기 말고 이미지로도 넣고 싶다는 의견을 반영했다(채팅 작성 기기 아이콘과 같은 방식).
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const content = readFileSync(path.join(ROOT, "src/content.js"), "utf8");
const css = readFileSync(path.join(ROOT, "src/content.css"), "utf8");
const settingsHtml = readFileSync(path.join(ROOT, "settings.html"), "utf8");
const settingsJs = readFileSync(path.join(ROOT, "src/settings.js"), "utf8");
const sliceFn = (name) => {
  const at = content.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const sliceConst = (name, endMark) => {
  const at = content.indexOf(`  const ${name} = `);
  assert.ok(at >= 0, name);
  return content.slice(at, content.indexOf(endMark, at) + endMark.length);
};

// 기본 아이콘은 모두 이름이 있다.
{
  const paths = sliceConst("CUSTOM_FOLLOW_GROUP_ICON_PATHS", "\n  });\n");
  const labels = sliceConst("CUSTOM_FOLLOW_GROUP_ICON_LABELS", "\n  });\n");
  const ctx = {};
  require("node:vm").runInNewContext(paths + labels + "\nthis.p=CUSTOM_FOLLOW_GROUP_ICON_PATHS;this.l=CUSTOM_FOLLOW_GROUP_ICON_LABELS;", ctx);
  const keys = Object.keys(ctx.p);
  assert.ok(keys.length >= 25, "기본 아이콘을 늘렸다: " + keys.length);
  assert.deepEqual(keys.filter((k) => !ctx.l[k]), [], "이름 없는 아이콘이 없다");
}

const FIXTURE = (style) => `
<div id="sidebar" class="_is_expanded_x" style="width:240px;background:#141517;color:#fff;font:13px sans-serif;padding:8px">
  <div id="cheese-custom-follow"><div class="cheese-cf-groups"><div class="cheese-cf-group-body">
    ${["#ff5c67", "#3ea6ff"].map((color, i) => `
    <section class="cheese-cf-group${i ? " is-collapsed" : ""}" data-cf-group-order-key="g${i}" style="--cheese-cf-group-color:${color}">
      <div class="cheese-cf-group-header"><span class="cheese-cf-group-drag-handle"></span><button class="cheese-cf-group-toggle"><span class="cheese-cf-group-symbol"><svg width="16" height="16"></svg></span><span class="cheese-cf-group-name">그룹 ${i + 1}</span><span class="cheese-cf-group-count">3</span><svg class="cheese-cf-group-chevron" width="18" height="18"></svg></button></div>
      ${i ? "" : '<ul class="cheese-cf-group-list"><li style="height:28px">채널</li><li style="height:28px">채널</li></ul>'}
    </section>`).join("")}
    <section class="cheese-cf-group is-collapsed" data-cf-group-order-key="g2" style="--cheese-cf-group-color:#ffd166">
      <div class="cheese-cf-group-header"><span class="cheese-cf-group-drag-handle"></span><button class="cheese-cf-group-toggle"><span class="cheese-cf-group-symbol"><svg width="16" height="16"></svg></span><span class="cheese-cf-group-name">그룹 3</span><span class="cheese-cf-group-count">5</span></button></div>
    </section>
  </div></div></div>
</div>`;

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-cfs-"));
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
    await ev(`(() => { const st = document.createElement('style'); st.textContent = ${JSON.stringify(css)}; document.head.append(st); return true; })()`);
    const measure = (style) => ev(`(() => {
      document.documentElement.dataset.cheeseCfGroupStyle = ${JSON.stringify(style)};
      document.body.innerHTML = ${JSON.stringify(FIXTURE(style))};
      const g = getComputedStyle(document.querySelector('.cheese-cf-group'));
      return { left: g.borderLeftWidth, top: g.borderTopWidth, right: g.borderRightWidth, radius: g.borderTopLeftRadius,
        topColor: g.borderTopColor, bg: g.backgroundColor,
        name: getComputedStyle(document.querySelector('.cheese-cf-group-name')).color };
    })()`);
    const line = await measure("line");
    assert.ok(line.left === "2px" && line.top === "0px", "세로줄(기본): 왼쪽 선만 " + JSON.stringify(line));
    const box = await measure("box");
    assert.ok(box.left === "1px" && box.right === "1px" && box.top === "1px" && box.radius === "10px" && box.bg !== "rgba(0, 0, 0, 0)",
      "상자: 네 변 테두리·둥근 모서리·옅은 배경 " + JSON.stringify(box));
    const divider = await measure("divider");
    assert.ok(divider.left === "0px" && divider.top === "1px" && divider.name === "rgb(255, 92, 103)",
      "구분선: 왼쪽 선 없이 위 가로선, 그룹 이름은 그룹 색 " + JSON.stringify(divider));
    // 접힌 사이드바는 모양 설정과 상관없이 세로줄.
    // 펼친 사이드바 상자: 접힌 그룹은 2열 폴더 카드, 펼친 그룹은 한 줄을 다 쓴다.
    const grid = await ev(`(() => {
      document.documentElement.dataset.cheeseCfGroupStyle = 'box';
      document.body.innerHTML = ${JSON.stringify(FIXTURE("box"))};
      const [open, a, b] = [...document.querySelectorAll('.cheese-cf-group')].map((g) => g.getBoundingClientRect());
      const card = document.querySelectorAll('.cheese-cf-group')[1];
      return { body: getComputedStyle(document.querySelector('.cheese-cf-group-body')).gridTemplateColumns.split(' ').length === 2 ? 'grid' : 'one',
        openFull: Math.round(open.width), aW: Math.round(a.width), sameRow: Math.round(a.top) === Math.round(b.top), side: b.left > a.left,
        chevron: getComputedStyle(document.querySelector('.cheese-cf-group:not(.is-collapsed) .cheese-cf-group-chevron')).display,
        cardText: getComputedStyle(card.querySelector('.cheese-cf-group-toggle')).textAlign,
        cardH: Math.round(card.getBoundingClientRect().height), handle: getComputedStyle(card.querySelector('.cheese-cf-group-drag-handle')).opacity };
    })()`);
    assert.ok(grid.body === "grid" && grid.sameRow && grid.side && grid.aW < grid.openFull / 2 + 4 && grid.cardText === "center" &&
      grid.cardH >= 70 && grid.handle === "0" && grid.chevron !== "none",
      "상자(펼친 사이드바): 접힌 그룹은 2열 폴더 카드, 펼친 그룹은 전체 폭 " + JSON.stringify(grid));
    // 접힌 사이드바에도 고른 모양을 좁게 적용한다.
    const collapsed = await ev(`(() => {
      const read = (style) => {
        document.documentElement.dataset.cheeseCfGroupStyle = style;
        document.getElementById('sidebar').className = '_is_collapsed_x';
        const el = document.querySelector('.cheese-cf-group');
        const g = getComputedStyle(el);
        return [g.borderLeftWidth, g.borderTopWidth, g.borderRightWidth, g.borderTopLeftRadius,
          getComputedStyle(document.querySelector('.cheese-cf-group-body')).gridTemplateColumns.split(' ').length].join('/');
      };
      return { box: read('box'), divider: read('divider'), line: read('line') };
    })()`);
    assert.equal(collapsed.box, "1px/1px/1px/8px/1", "접힌 사이드바 상자: 테두리 상자(격자 아님)");
    assert.equal(collapsed.divider, "0px/1px/0px/0px/1", "접힌 사이드바 구분선: 위 가로선");
    assert.equal(collapsed.line, "2px/0px/0px/0px/1", "접힌 사이드바 세로줄");
    // 접힌 사이드바에서 네이티브 버튼 숨김 표시(data-cf-native-btn)가 우리 그룹 토글에 붙어도
    // 그룹 헤더는 보인다(예전에는 헤더가 숨어 상자 테두리 2px 만 남았다).
    const toggleShown = await ev(`(() => {
      document.documentElement.dataset.cheeseCfGroupStyle = 'box';
      const t = document.querySelector('#cheese-custom-follow .cheese-cf-group-toggle');
      t.dataset.cfNativeBtn = '1';
      const native = document.createElement('button'); native.dataset.cfNativeBtn = '1';
      document.getElementById('sidebar').prepend(native);
      return [getComputedStyle(t).display, document.querySelector('.cheese-cf-group').offsetHeight > 20, getComputedStyle(native).display].join('/');
    })()`);
    assert.equal(toggleShown, "grid/true/none", "우리 목록 안 버튼은 네이티브 숨김 규칙에서 빠지고, 네이티브 버튼은 숨는다");
    if (process.env.CF_SHOT) {
      for (const style of ["line", "box", "divider"]) {
        for (const side of ["expanded", "collapsed"]) {
          await measure(style);
          if (side === "collapsed") await ev(`document.getElementById('sidebar').className = '_is_collapsed_x'; document.getElementById('sidebar').style.width = '42px'; true`);
          const shot = await call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 260, height: 260, scale: 1 } }, sessionId);
          writeFileSync(path.join(process.env.CF_SHOT, `cf-group-${style}-${side}.png`), Buffer.from(shot.data, "base64"));
        }
      }
    }

    // 이미지 아이콘: PNG → 64px WebP data URL, 저장값 정리, 표시는 <img>.
    const image = await ev(`(async () => {
      const CUSTOM_FOLLOW_GROUP_CUSTOM_ICON_MAX = 10;
      const escapeAttribute = (v) => String(v).replace(/"/g, '&quot;');
      const sanitizeCustomFollowSvg = () => null;
      let customFollowGroupCustomIcons = [];
      const CUSTOM_FOLLOW_GROUP_ICON_PATHS = { folder: '<path d="M0 0"/>' };
      const CUSTOM_FOLLOW_ACTION_ICON_PATHS = {};
      ${sliceConst("CUSTOM_FOLLOW_ICON_IMAGE_SOURCE_MAX_BYTES", ";\n")}
      ${sliceConst("CUSTOM_FOLLOW_ICON_IMAGE_MAX_BYTES", ";\n")}
      ${sliceConst("CUSTOM_FOLLOW_ICON_IMAGE_SIZE", ";\n")}
      ${["sanitizeCustomFollowIconImage", "encodeCustomFollowIconImage", "sanitizeCustomFollowGroupCustomIcons",
        "getCustomFollowGroupCustomIcon", "customFollowLucideIcon"].map(sliceFn).join("\n")}
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 150;
      const c = canvas.getContext('2d'); c.fillStyle = '#e33'; c.fillRect(0, 0, 300, 150);
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const data = await encodeCustomFollowIconImage(new File([png], 'a.png', { type: 'image/png' }));
      const img = new Image(); img.src = data; await img.decode();
      let rejected = '';
      try { await encodeCustomFollowIconImage(new File(['x'], 'a.gif', { type: 'image/gif' })); } catch (e) { rejected = e.message; }
      const icons = sanitizeCustomFollowGroupCustomIcons([
        { id: 'ok', image: data },
        { id: 'bad', image: 'data:image/png;base64,AAAA' },
        { id: 'big', image: 'data:image/webp;base64,' + 'A'.repeat(60000) },
      ]);
      customFollowGroupCustomIcons = icons;
      const html = customFollowLucideIcon('user:ok', 16, 'x');
      return { prefix: data.slice(0, 23), w: img.naturalWidth, h: img.naturalHeight, rejected,
        ids: icons.map((i) => i.id), html: html.slice(0, 100) };
    })()`);
    assert.equal(image.prefix, "data:image/webp;base64,");
    assert.ok(image.w === 64 && image.h === 64, "64px 정사각으로 바꾼다");
    assert.ok(image.rejected.includes("PNG, JPG 또는 WebP"), "다른 형식은 거절");
    assert.deepEqual(image.ids, ["ok"], "WebP data URL·크기 한도만 남긴다");
    assert.ok(image.html.startsWith('<img class="cheese-cf-user-icon cheese-cf-user-image x" src="data:image/webp'), image.html);
  } finally {
    browser.kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  // 그룹 편집 창 오른쪽 '선택한 채널': 순서·직접 정렬.
  {
    const vm = require("node:vm");
    const ctx = {
      customFollowItems: [
        { channelId: "a", name: "가", live: false, viewers: 1 },
        { channelId: "b", name: "나", live: true, viewers: 9 },
        { channelId: "c", name: "다", live: false, viewers: 5 },
      ],
    };
    vm.createContext(ctx);
    vm.runInContext(sliceFn("customFollowGroupModalPickedItems") + "\nthis.f=customFollowGroupModalPickedItems;", ctx);
    const ids = (state) => ctx.f(state).map((i) => i.channelId).join("");
    assert.equal(ids({ selected: new Set(["a", "c", "b", "z"]), manualOrder: false }), "acbz", "고정 전이어도 고른 순서 그대로(먼저 고른 채널이 위)");
    assert.equal(ids({ selected: new Set(["a", "z", "c"]), manualOrder: true }), "azc", "직접 정한 순서도 고른 순서 그대로");
    assert.equal(ctx.f({ selected: new Set(["z"]), manualOrder: false })[0].missing, true, "목록에 없는 채널도 자리에 남는다");
  }
  assert.ok(content.includes("manualOrder: group?.manualOrder === true,") && content.includes("manualOrder: state.manualOrder === true,"),
    "편집 창에서 저장해도 직접 정렬을 지킨다");
  assert.ok(content.includes('<aside class="cheese-cf-group-modal-picked" data-cf-modal-picked'), "오른쪽 칸");
  assert.match(content, /function setCustomFollowGroupModalPickedOrder\(order\) \{[\s\S]*?state\.manualOrder = true;/, "옮기면 직접 정한 순서");
  assert.ok(content.includes("if (getComputedStyle(body).gridTemplateColumns.trim().split(/\\s+/).length > 1) {"), "폴더 격자(2열)에서만 읽는 순서로 끌어 옮기기");
  assert.ok(settingsHtml.includes('data-settings-summary="플레이어에서 화질을 바로 바꾸는 버튼을 둡니다(기본 꺼짐)."'), "화질 버튼 설명은 (i) 로");
  assert.match(settingsHtml, /data-cf-group-style\s+role="radiogroup"\s+aria-label="그룹 구분 모양"\s+style="margin-top: 6px; width: 100%"/,
    "그룹 구분 모양은 오디오 믹서 자동 활성화와 같은 배치");

  assert.ok(content.includes("if (b.closest(`#${CUSTOM_FOLLOW_NAV_ID}, .${CUSTOM_FOLLOW_CTRL_CLASS}`)) return;"),
    "접힌 사이드바에서 네이티브 버튼을 찾을 때 우리 목록·컨트롤은 건너뛴다");

  // 저장·설정 연결.
  assert.ok(content.includes("image ? { id, image } : { id, svg },"), "이미지 아이콘도 저장한다");
  assert.ok(content.includes("data-cf-modal-image-add") && content.includes("void addCustomFollowGroupImageIcon(file);"), "모달의 이미지 버튼");
  assert.ok(content.includes('const CUSTOM_FOLLOW_GROUP_STYLE_KEY = "cheeseFollowGroupStyle";') &&
    content.includes("document.documentElement.dataset.cheeseCfGroupStyle = style;"), "모양 설정은 문서 속성으로 건다");
  assert.ok(settingsHtml.includes("data-cf-group-style-value=\"box\"") && settingsJs.includes('"cheeseFollowGroupStyle",\n    ["line", "box", "divider"],'),
    "설정 화면 그룹 구분 모양");
  assert.ok(settingsJs.includes('    "cheeseFollowGroupStyle",\n') && settingsJs.includes('    "cheeseAutoSyncChannels",\n'), "백업 대상");
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
