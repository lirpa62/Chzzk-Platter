// 나만의 재생목록 편집 화면(playlist.html): 만들기·이름·주소로 추가(정보 채우기)·순서(키보드·끌기)·
// 시작 시간·삭제(되돌리기·선택 삭제 확인 모달)·재생 요청·공유 코드/파일 내보내기·불러오기·목록 삭제·다른 탭 변경 반영.
// 확장 저장소·배경 메시지는 가짜로 둔다.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 120000).unref();

const ROOT = path.join(__dirname, "..");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-playlist-page-"));
  const browser = spawn(
    process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files",
      "--remote-debugging-pipe", `--user-data-dir=${dir}`],
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
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (expression, label, tries = 50) => {
      for (let i = 0; i < tries; i++) {
        if (await ev(expression).catch(() => false)) return true;
        await wait(60);
      }
      throw new Error(`기다림 실패: ${label}`);
    };
    await call("Page.enable", {}, sessionId);
    await call("DOM.enable", {}, sessionId);
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message) + ' @' + e.filename + ':' + e.lineno));
      window.__local = {
        cheeseClipVaultActiveAccount: '${"d".repeat(32)}',
        ['cheeseClipVault:${"d".repeat(32)}']: { fav: [{ uid: 'favClip01', title: '즐겨찾기 클립', channelName: '즐찾채널', channelId: '${"f".repeat(32)}' }], like: [] },
        cheeseVideoVaultActiveAccount: '${"d".repeat(32)}',
        ['cheeseVideoVault:${"d".repeat(32)}']: [{ videoNo: '401', title: '보관한 다시보기', channelId: '${"f".repeat(32)}', channelName: '보관채널' }],
      };
      window.__sent = [];
      window.__img = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').fillRect(0, 0, w, h); return c.toDataURL(); };
      window.__listeners = [];
      window.__downloads = [];
      window.confirm = () => { throw new Error('브라우저 confirm 을 쓰면 안 된다'); };
      const META = {
        'video:15679779': { title: '합방 다시보기', channelName: '치즈채널', channelId: '${"a".repeat(32)}', duration: 20000, thumb: 'https://livecloud-thumb.akamaized.net/v.jpg', adult: true },
        'clip:clipUid01': { title: '클립 제목', channelName: '클립채널', duration: 45 },
      };
      window.chrome = {
        storage: {
          local: {
            get: async (keys) => {
              const list = Array.isArray(keys) ? keys : [keys];
              return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in window.__local).map((k) => [k, window.__local[k]]))));
            },
            set: async (values) => {
              const changes = {};
              for (const [k, v] of Object.entries(values)) changes[k] = { oldValue: window.__local[k], newValue: v };
              Object.assign(window.__local, JSON.parse(JSON.stringify(values)));
              window.__listeners.forEach((fn) => fn(changes, 'local'));
            },
          },
          onChanged: { addListener(fn) { window.__listeners.push(fn); } },
        },
        runtime: {
          lastError: null,
          getURL: (file) => 'chrome-extension://test/' + file,
          sendMessage: (message, cb) => {
            window.__sent.push(JSON.parse(JSON.stringify(message)));
            let reply = { ok: true };
            if (message.type === 'PLAYLIST_META') {
              reply = { ok: true, results: message.items.map((item) => META[item.type === 'video' ? 'video:' + item.videoNo : 'clip:' + item.clipUID] || null) };
            }
            if (message.type === 'MULTIVIEW_API') {
              const url = new URL(message.url);
              window.__api = (window.__api || []).concat(url.pathname + url.search);
              const p = url.pathname;
              const ch = (id, name) => ({ channelId: id.repeat(32), channelName: name, verifiedMark: id === 'c', channelImageUrl: 'https://nng-phinf.pstatic.net/' + id + '.png' });
              let content = null;
              if (p === '/service/v2/home/following/videos') content = { data: [{ videoNo: 201, videoTitle: '팔로잉 다시보기', thumbnailImageUrl: 'https://example.com/f.jpg', duration: 1800, readCount: 12345, publishDateAt: Date.now() - 3 * 86400000, channel: ch('b', '팔로잉채널') }], page: { next: null } };
              else if (p === '/service/v1/search/videos') content = { data: [
                { videoNo: 301, videoTitle: url.searchParams.get('keyword') + ' 검색 결과', duration: 600, readCount: 10, publishDateAt: Date.now() - 1000, channel: ch('b', '검색채널') },
                { videoNo: 302, videoTitle: url.searchParams.get('keyword') + ' 인기 결과', duration: 600, readCount: 99999, publishDateAt: Date.now() - 400 * 86400000, channel: ch('b', '검색채널') },
              ], page: { next: null } };
              else if (p === '/service/v1/channels/' + 'c'.repeat(32) + '/videos') content = { data: [{ videoNo: 501, videoTitle: '채널 다시보기', duration: 900, readCount: 5, channel: ch('c', '클립채널') }], totalPages: 1 };
              else if (p === '/service/v1/search/channels') content = { data: [{ channel: { ...ch('c', '클립채널'), channelImageUrl: '' } }] };
              else if (p === '/service/v1/channels/' + 'c'.repeat(32) + '/clips') {
                content = url.searchParams.get('clipUID') === ''
                  ? { data: [{ clipUID: 'chanClip1', clipTitle: '채널 클립 1', duration: 40, readCount: 2500, createdDate: '2026-10-01 12:00:00', thumbnailImageUrl: window.__img(320, 180) }, { clipUID: 'chanClip2', clipTitle: '채널 클립 2', duration: 50, thumbnailImageUrl: window.__img(180, 320) }], page: { next: { clipUID: 'chanClip2', readCount: 7 } } }
                  : { data: [{ clipUID: 'chanClip3', clipTitle: '채널 클립 3', duration: 60 }], page: { next: null } };
              }
              else if (p === '/service/v1/channels/' + 'f'.repeat(32)) content = { channelId: 'f'.repeat(32), channelName: '보관채널', channelImageUrl: 'https://nng-phinf.pstatic.net/f.png', verifiedMark: true };
              reply = { ok: true, content };
            }
            cb && cb(reply);
            return Promise.resolve(reply);
          },
        },
      };
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__lastBlob = blob; return origCreate(blob); };
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push({ name: this.download, blob: window.__lastBlob }); };
    ` }, sessionId);
    await call("Page.navigate", { url: `file://${path.join(ROOT, "playlist.html")}` }, sessionId);
    await until("!!window.CheesePlaylistStore && document.getElementById('plNoLists') && !document.getElementById('plNoLists').hidden", "빈 화면").catch(async (e) => {
      throw new Error(e.message + " " + await ev("JSON.stringify(window.__errors || [])"));
    });

    check(await ev("document.getElementById('plDetail').hidden && document.getElementById('plAdd').hidden"),
      "목록이 없으면 안내만 보이고 상세·추가 칸은 숨긴다");

    // ── 만들기·이름 ──
    await ev("document.getElementById('plNewList').click(); true");
    await until("document.activeElement === document.getElementById('plName')", "이름 칸 포커스");
    await ev(`(() => { const i = document.getElementById('plName'); i.value = '합방 모음'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await until("window.__local.cheesePlaylists?.lists?.[0]?.name === '합방 모음'", "이름 저장");
    check(await ev("document.querySelector('#plListNav [aria-selected=\"true\"] strong').textContent === '합방 모음'"),
      "새 재생목록을 만들면 이름 칸에 바로 들어가고, Enter 로 이름이 저장된다");

    // ── 주소로 추가 + 정보 채우기 ──
    await ev(`(() => {
      document.getElementById('plUrls').value = 'https://chzzk.naver.com/video/15679779?currentTime=10674\\nhttps://example.com/nope\\nhttps://chzzk.naver.com/clips/clipUid01\\nhttps://chzzk.naver.com/video/404';
      document.getElementById('plAddUrls').click(); return true; })()`);
    await until("document.querySelectorAll('#plItems .pl-item').length === 3 && document.querySelector('#plItems .pl-item-title').textContent === '합방 다시보기'", "추가·정보");
    const added = await ev(`({
      status: document.getElementById('plUrlStatus').textContent,
      left: document.getElementById('plUrls').value,
      titles: [...document.querySelectorAll('#plItems .pl-item-title')].map((a) => a.textContent),
      starts: [...document.querySelectorAll('#plItems [data-start]')].map((i) => i.value),
      badges: [...document.querySelectorAll('#plItems .pl-badge')].map((b) => b.textContent),
      href: document.querySelector('#plItems .pl-item-title').getAttribute('href'),
      meta: document.getElementById('plMeta').textContent,
      metaAsked: window.__sent.filter((m) => m.type === 'PLAYLIST_META').length,
      adultThumb: (() => { const t = document.querySelector('#plItems .pl-thumb'); return { img: t.querySelector('img')?.getAttribute('src'), adult: t.classList.contains('is-adult'),
        mark: getComputedStyle(t, '::before').backgroundImage.includes('age_restriction') }; })(),
    })`);
    check(added.adultThumb.img === "https://livecloud-thumb.akamaized.net/v.jpg" && added.adultThumb.adult && added.adultThumb.mark,
      `19세 항목도 썸네일을 그대로 보이고 연령 제한 표시를 덮는다(검색 결과 카드와 같다) ${JSON.stringify(added.adultThumb)}`);
    check(added.status.startsWith("3개 추가") && added.status.includes("1줄은 치지직 주소가 아니라 남겨 둠") && added.left === "https://example.com/nope",
      `치지직 주소만 추가하고, 아닌 줄은 칸에 남겨 알린다 ${JSON.stringify(added.status)}`);
    check(JSON.stringify(added.titles) === JSON.stringify(["합방 다시보기", "클립 제목", "다시보기 404 (정보 없음)"]) &&
      JSON.stringify(added.badges) === JSON.stringify(["다시보기", "클립", "다시보기"]),
      `제목·채널·길이는 배경(PLAYLIST_META)에서 받아 채우고, 못 받으면 '정보 없음' ${JSON.stringify(added.titles)}`);
    check(JSON.stringify(added.starts) === JSON.stringify(["2:57:54", ""]) &&
      await ev("document.querySelectorAll('#plItems [data-start]')[1].placeholder === '0:00'") && added.href === "https://chzzk.naver.com/video/15679779?currentTime=10674",
      "currentTime 은 시작 시간 칸·링크에 그대로, 0 이면 칸을 비우고 '0:00'은 자리표시자로(클립에는 시작 칸이 없다)");
    check(added.meta.includes("다시보기 2 · 클립 1") && added.meta.includes("총 "), `머리 요약 ${added.meta}`);
    const navCard = await ev(`(() => { const b = document.querySelector('#plListNav [aria-selected="true"]'); const t = b.querySelector('.pl-nav-thumb');
      return { count: b.querySelector('.pl-nav-count')?.textContent, name: b.querySelector('strong').textContent, meta: b.querySelector('small').textContent,
        stack: getComputedStyle(t, '::after').content !== 'none' && getComputedStyle(t, '::before').content !== 'none', outline: getComputedStyle(t).outlineStyle,
        shadow: getComputedStyle(b).boxShadow, cover: t.querySelector('img')?.getAttribute('src'),
        adultMark: getComputedStyle(t.querySelector('.pl-nav-adult') || document.body).backgroundImage.includes('age_restriction'),
        countOnTop: Number(getComputedStyle(b.querySelector('.pl-nav-count')).zIndex) > Number(getComputedStyle(t.querySelector('.pl-nav-adult') || document.body).zIndex) }; })()`);
    check(navCard.cover === "https://livecloud-thumb.akamaized.net/v.jpg" && navCard.adultMark && navCard.countOnTop,
      `재생목록 카드 표지가 19세 항목이어도 썸네일을 비우지 않고 연령 제한 표시를 덮는다(개수는 그 위) ${JSON.stringify(navCard)}`);
    check(navCard.count === "3개" && navCard.name === "합방 모음" && navCard.meta.startsWith("최근 업데이트됨") && navCard.stack && navCard.outline === "solid" && navCard.shadow === "none",
      `재생목록 카드: 썸네일(뒤에 겹친 판)·오른쪽 아래 개수·이름·업데이트, 고른 목록은 테두리(그림자 없음) ${JSON.stringify(navCard)}`);
    await ev("document.getElementById('plUrls').value = ''; true");

    // ── 주소 미리보기·시작 시간 바꾸기 ──
    await ev(`(() => { const t = document.getElementById('plUrls');
      t.value = 'https://chzzk.naver.com/video/15679779?currentTime=10674\\nhttps://chzzk.naver.com/clips/clipUid01\\n아무 글';
      t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await until("document.querySelectorAll('#plUrlPreview > li').length === 3 && document.querySelector('#plUrlPreview .pl-card-title')?.textContent === '합방 다시보기'", "미리보기");
    const preview = await ev(`(() => { const cards = [...document.querySelectorAll('#plUrlPreview .pl-url-card')];
      return { titles: cards.map((c) => c.querySelector('.pl-card-title').textContent), names: cards.map((c) => c.querySelector('.pl-card-name')?.textContent),
        duration: cards[0].querySelector('.pl-card-duration')?.textContent, start: cards[0].querySelector('[data-url-start]').value,
        hint: cards[0].querySelector('[data-url-time]').textContent, clipStart: !!cards[1].querySelector('[data-url-start]'),
        bad: document.querySelector('#plUrlPreview .pl-url-bad')?.textContent }; })()`);
    check(JSON.stringify(preview.titles) === JSON.stringify(["합방 다시보기", "클립 제목"]) && preview.names[0] === "치즈채널" && preview.duration === "5:33:20" &&
      preview.start === "2:57:54" && preview.hint === "currentTime=10674" && !preview.clipStart && preview.bad?.includes("아무 글"),
      `주소를 넣으면 아래에 썸네일·채널·제목·길이 미리보기, 다시보기는 시작 시간(시:분:초) 칸 ${JSON.stringify(preview)}`);
    const rewrite = async (value) => ev(`(() => { const i = document.querySelector('#plUrlPreview [data-url-start]'); i.focus(); i.value = ${JSON.stringify(value)};
      i.dispatchEvent(new Event('input', { bubbles: true })); const hint = i.closest('.pl-url-start').querySelector('[data-url-time]').textContent;
      i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); return { hint, line: document.getElementById('plUrls').value.split('\\n')[0] }; })()`);
    const r1 = await rewrite("1:00:00");
    const r2 = await rewrite("");
    check(r1.hint === "currentTime=3600" && r1.line === "https://chzzk.naver.com/video/15679779?currentTime=3600" &&
      r2.line === "https://chzzk.naver.com/video/15679779",
      `시작 시간을 시:분:초로 고치면 그 줄 주소의 currentTime 으로 바꿔 쓴다(비우면 지운다) ${JSON.stringify([r1, r2])}`);
    await ev("document.getElementById('plUrls').value = ''; document.getElementById('plUrls').dispatchEvent(new Event('input', { bubbles: true })); true");
    await until("document.getElementById('plUrlPreview').hidden", "미리보기 비움");

    // ── 순서: 키보드 ──
    const order = () => ev("[...document.querySelectorAll('#plItems .pl-item-title')].map((a) => a.textContent).join('|')");
    await ev(`(() => { const h = document.querySelector('#plItems .pl-item [data-handle]'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); return true; })()`);
    await until("document.querySelectorAll('#plItems .pl-item-title')[1].textContent === '합방 다시보기'", "키보드 이동");
    check(await order() === "클립 제목|합방 다시보기|다시보기 404 (정보 없음)" &&
      await ev("document.activeElement === document.querySelectorAll('#plItems [data-handle]')[1]"),
      "손잡이에서 ↓ 로 한 칸 내리고, 포커스는 옮겨 간 손잡이를 따라간다");

    // ── 순서: 끌기(실제 마우스) ──
    const rects = await ev(`[...document.querySelectorAll('#plItems .pl-item')].map((li) => { const h = li.querySelector('[data-handle]').getBoundingClientRect(); const r = li.getBoundingClientRect(); return { hx: h.x + h.width / 2, hy: h.y + h.height / 2, top: r.top, bottom: r.bottom }; })`);
    const mouse = (type, x, y, buttons = 1) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 }, sessionId);
    await mouse("mousePressed", rects[2].hx, rects[2].hy);
    await mouse("mouseMoved", rects[2].hx, (rects[1].top + rects[1].bottom) / 2 + 5);
    await mouse("mouseMoved", rects[2].hx, rects[0].top + 4);
    const mark = await ev(`(() => { const d = document.getElementById('plDropDivider'); const first = document.querySelector('#plItems .pl-item').getBoundingClientRect();
      const r = d.getBoundingClientRect(); const rows = [...document.querySelectorAll('#plItems .pl-item')].map((li) => getComputedStyle(li).boxShadow);
      return !d.hidden && Math.abs(r.top + 1 - (first.top - 2)) < 3 && Math.abs(r.width - first.width) < 2 && rows.every((x) => x === 'none'); })()`);
    await mouse("mouseReleased", rects[2].hx, rects[0].top + 4, 0);
    await until("document.querySelector('#plItems .pl-item-title').textContent.startsWith('다시보기 404')", "끌기");
    check(mark && await order() === "다시보기 404 (정보 없음)|클립 제목|합방 다시보기",
      "손잡이를 끌어 맨 위로 옮긴다(놓을 자리는 줄 그림자가 아니라 줄 사이 구분선)");
    check(await ev("document.getElementById('plDropDivider').hidden"), "놓으면 구분선을 숨긴다");

    // ── 시작 시간 ──
    const setStart = (index, value) => ev(`(() => { const i = document.querySelectorAll('#plItems [data-start]')[${index}]; i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('change', { bubbles: true })); return i.getAttribute('aria-invalid'); })()`);
    check(await setStart(0, "abc") === "true" && await ev("window.__local.cheesePlaylists.lists[0].items[0].start === 0"),
      "틀린 시간은 칸만 빨갛게 하고 저장하지 않는다");
    check(await setStart(1, "9:00:00") === "true", "영상 길이보다 긴 시작 시간도 받지 않는다");
    await setStart(1, "1:00:05");
    await until("window.__local.cheesePlaylists.lists[0].items[2].start === 3605", "시작 저장");
    check(await ev("document.querySelectorAll('#plItems [data-start]')[1].value === '1:00:05'"), "시작 시간을 고치면 저장하고 다시 그린다");

    // ── 삭제·되돌리기 ──
    await ev("document.querySelectorAll('#plItems [data-remove]')[1].click(); true");
    await until("document.querySelectorAll('#plItems .pl-item').length === 2 && !document.getElementById('plToast').hidden", "삭제");
    const undoLook = await ev(`(() => { const b = document.querySelector('#plToast [data-toast-action]'); const t = document.getElementById('plToast');
      return { bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, toastColor: getComputedStyle(t).color, text: b.textContent }; })()`);
    check(undoLook.bg === "rgba(0, 0, 0, 0)" && undoLook.color === undoLook.toastColor && undoLook.text === "되돌리기",
      `알림의 '되돌리기'는 알림 바탕에 맞춰 글자가 보이는 테두리 버튼 ${JSON.stringify(undoLook)}`);
    await ev("document.querySelector('#plToast [data-toast-action]').click(); true");
    await until("document.querySelectorAll('#plItems .pl-item').length === 3", "되돌리기");
    check(await order() === "다시보기 404 (정보 없음)|클립 제목|합방 다시보기", "삭제는 바로 하고, 알림의 '되돌리기'로 같은 자리에 돌려놓는다");

    // ── 선택 삭제(확인 모달) ──
    await ev("document.querySelector('#plItems .pl-item [data-check]').click(); true");
    check(await ev("!document.getElementById('plSelectBar').hidden && document.getElementById('plSelectCount').textContent === '1개 선택'"), "고르면 선택 막대가 나온다");
    await ev("document.getElementById('plDeleteSelected').click(); true");
    await until("!!document.querySelector('.crm-overlay [data-crm-ok]')", "확인 모달");
    check(await ev("document.activeElement?.hasAttribute('data-crm-cancel')"), "선택 삭제는 확인 모달(처음 포커스는 취소)");
    await ev("document.querySelector('.crm-overlay [data-crm-ok]').click(); true");
    await until("document.querySelectorAll('#plItems .pl-item').length === 2", "선택 삭제");
    check(await order() === "클립 제목|합방 다시보기" && await ev("document.getElementById('plSelectBar').hidden"), "확인하면 고른 항목을 지운다");

    // ── 재생 ──
    await ev("document.querySelectorAll('#plItems [data-play]')[1].click(); document.getElementById('plPlay').click(); true");
    const plays = await ev("window.__sent.filter((m) => m.type === 'PLAYLIST_PLAY').map((m) => [m.listId === window.__local.cheesePlaylists.lists[0].id, m.index])");
    check(JSON.stringify(plays) === "[[true,1],[true,0]]", `'여기부터 재생'·'처음부터 재생'은 배경에 목록·순번을 보낸다 ${JSON.stringify(plays)}`);

    // ── 공유 코드 내보내기 → 불러오기 ──
    await ev("document.getElementById('plExport').click(); document.querySelector('[data-export=\"code\"]').click(); true");
    await until("!!document.querySelector('.pl-dialog textarea')?.value.startsWith('CPL1:')", "공유 코드");
    const code = await ev("document.querySelector('.pl-dialog textarea').value");
    await ev("document.querySelector('.pl-dialog [data-dialog-close]').click(); true");
    await ev("document.getElementById('plImport').click(); true");
    await until("!!document.querySelector('.pl-dialog textarea')", "불러오기 창");
    await ev(`(() => { document.querySelector('.pl-dialog textarea').value = 'CPL1:망가진코드'; document.querySelector('.pl-dialog [data-import-run]').click(); return true; })()`);
    await until("document.querySelector('.pl-dialog [data-import-error]')?.textContent.length > 0", "오류 표시");
    await ev(`(() => { document.querySelector('.pl-dialog textarea').value = ${JSON.stringify(`받은 코드: ${code}`)}; document.querySelector('.pl-dialog [data-import-run]').click(); return true; })()`);
    await until("window.__local.cheesePlaylists.lists.length === 2 && document.querySelector('#plItems .pl-item-title')?.textContent === '클립 제목'", "코드 불러오기");
    const imported = await ev(`({
      name: document.getElementById('plName').value,
      starts: window.__local.cheesePlaylists.lists[1].items.map((i) => i.start ?? null),
      titles: window.__local.cheesePlaylists.lists[1].items.map((i) => i.title),
    })`);
    check(code.length < 200 && imported.name === "합방 모음 (가져옴)" && JSON.stringify(imported.starts) === "[null,3605]" &&
      JSON.stringify(imported.titles) === JSON.stringify(["클립 제목", "합방 다시보기"]),
    `공유 코드로 불러오면 새 목록('(가져옴)')·시작 시간 유지·제목은 다시 받는다 ${JSON.stringify(imported)}`);

    // ── 파일 내보내기 → 불러오기 ──
    await ev("document.getElementById('plExport').click(); document.querySelector('[data-export=\"all\"]').click(); true");
    const file = await ev("(async () => ({ name: window.__downloads.at(-1)?.name, text: await window.__downloads.at(-1)?.blob.text() }))()");
    const parsed = JSON.parse(file.text);
    check(/^치즈플래터_재생목록_전체_\d{8}\.json$/.test(file.name) && parsed.format === "cheese-platter-playlist" && parsed.lists.length === 2,
      `모든 재생목록을 파일 하나로 저장 ${file.name}`);
    const jsonPath = path.join(dir, "import.json");
    writeFileSync(jsonPath, JSON.stringify({ ...parsed, lists: [parsed.lists[0]] }));
    await ev("document.getElementById('plImport').click(); true");
    await until("!!document.querySelector('.pl-dialog [data-import-tab=\"file\"]')", "불러오기 창");
    await ev("document.querySelector('.pl-dialog [data-import-tab=\"file\"]').click(); document.querySelector('.pl-dialog [data-pick-file]').click(); true");
    const { root } = await call("DOM.getDocument", {}, sessionId);
    const { nodeId } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "#plFileInput" }, sessionId);
    await call("DOM.setFileInputFiles", { nodeId, files: [jsonPath] }, sessionId);
    await until("window.__local.cheesePlaylists.lists.length === 3", "파일 불러오기");
    check(await ev("window.__local.cheesePlaylists.lists[2].name === '합방 모음 (가져옴) 2' && window.__local.cheesePlaylists.lists[2].items.length === 2 && !document.querySelector('.pl-dialog')"),
      "파일로 불러오면 이름이 겹치지 않게 새 목록으로 추가하고 창을 닫는다");

    // ── 다른 탭 변경 반영 ──
    await ev(`(() => { const data = JSON.parse(JSON.stringify(window.__local.cheesePlaylists)); data.lists[0].name = '다른 탭에서 바꿈'; chrome.storage.local.set({ cheesePlaylists: data }); return true; })()`);
    await until("[...document.querySelectorAll('#plListNav strong')].some((s) => s.textContent === '다른 탭에서 바꿈')", "다른 탭 반영");
    check(true, "치지직에서 담는 등 다른 곳에서 바꾸면 목록을 다시 읽는다");

    // ── 추가: 다시보기 탭(멀티뷰 소스) ──
    const itemsOf = (name) => `window.__local.cheesePlaylists.lists.find((l) => l.id === document.querySelector('#plListNav [aria-selected="true"]').dataset.listId).items`;
    await ev("document.querySelector('[data-add-tab=\"video\"]').click(); true");
    await until("document.querySelector('#plVideoResults .pl-card-title')?.textContent === '팔로잉 다시보기'", "팔로잉 다시보기");
    check(await ev("document.querySelector('[data-add-body=\"video\"]').hidden === false && document.querySelector('[data-add-body=\"url\"]').hidden && document.getElementById('plVideoStatus').textContent === '1개'"),
      "다시보기 탭은 처음에 팔로잉 다시보기를 배경 중계로 불러온다");
    await ev("document.querySelector('#plVideoResults [data-result]').click(); true");
    await until(`${itemsOf()}.some((i) => i.videoNo === '201' && i.title === '팔로잉 다시보기' && i.duration === 1800)`, "결과 추가");
    const card = await ev(`(() => { const c = document.querySelector('#plVideoResults [data-result]'); const t = c.querySelector('.pl-card-thumb');
      return { pressed: c.getAttribute('aria-pressed'), picked: c.querySelector('.pl-card-picked')?.textContent, duration: c.querySelector('.pl-card-duration')?.textContent,
        name: c.querySelector('.pl-card-name').textContent, avatar: !!c.querySelector('img.pl-card-avatar'), outline: getComputedStyle(t).outlineStyle,
        shadow: getComputedStyle(c).boxShadow + '|' + getComputedStyle(t).boxShadow + '|' + getComputedStyle(c.querySelector('.pl-card-picked')).boxShadow,
        add: !!document.querySelector('.pl-result-add') }; })()`);
    check(card.pressed === "true" && card.picked === "담김" && card.duration === "30:00" && card.name === "팔로잉채널" && card.avatar &&
      card.outline === "solid" && card.shadow === "none|none|none" && !card.add,
      `결과 카드(멀티뷰 모양: 썸네일 위 길이·채널 프로필·채널명)를 누르면 담기고 '담김' 표시(그림자 없음) ${JSON.stringify(card)}`);
    await ev("document.querySelector('#plVideoResults [data-result]').click(); true");
    await until(`!${itemsOf()}.some((i) => i.videoNo === '201') && document.querySelector('#plVideoResults [data-result]').getAttribute('aria-pressed') === 'false'`, "토글 빼기");
    check(true, "담긴 카드를 다시 누르면 지금 목록에서 뺀다(토글)");
    check(await ev("document.querySelector('#plVideoResults .pl-card-info')?.textContent === '조회수 1.2만회 · ' + (() => { const d = new Date(Date.now() - 3 * 86400000); return String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0'); })()"),
      "다시보기 카드에 조회수·날짜(멀티뷰와 같은 표기)");
    check(await ev("[...document.querySelectorAll('#plVideoView button')].every((b) => b.querySelector('svg') && !b.textContent.trim() && b.getAttribute('aria-label'))"),
      "그리드/목록 전환은 글자 대신 lucide 아이콘(이름은 aria-label)");
    await ev("document.querySelector('#plVideoView [data-result-view=\"list\"]').click(); true");
    const listView = await ev(`(() => { const c = document.querySelector('#plVideoResults .pl-card'); const t = c.querySelector('.pl-card-thumb').getBoundingClientRect();
      return { list: document.getElementById('plVideoResults').classList.contains('is-list'), dir: getComputedStyle(c).flexDirection, w: Math.round(t.width), saved: localStorage.getItem('cheesePlaylistResultView') }; })()`);
    check(listView.list && listView.dir === "row" && listView.w === 150 && listView.saved === '{"video":"list"}',
      `다시보기 결과를 목록형으로 바꾸면 썸네일 왼쪽·글자 오른쪽, 기억한다 ${JSON.stringify(listView)}`);
    check(await ev("!document.getElementById('plClipView') && !document.querySelector('[data-add-body=\"clip\"] [data-result-view]')"), "클립 탭에는 그리드/목록 전환이 없다(그리드만)");
    await ev("document.querySelector('#plVideoView [data-result-view=\"grid\"]').click(); true");
    await ev("document.querySelector('[data-video-source=\"vault\"]').click(); true");
    await until("document.querySelector('#plVideoResults .pl-card-title')?.textContent === '보관한 다시보기' && !!document.querySelector('#plVideoResults .pl-card-verified')", "보관함 채널 정보");
    check(await ev("document.querySelector('#plVideoResults img.pl-card-avatar').getAttribute('src').includes('pstatic.net/f') && window.__api.filter((u) => u === '/service/v1/channels/' + 'f'.repeat(32)).length === 1"),
      "보관함 항목에 빠진 채널 프로필·파트너 배지는 채널 정보로 채운다(채널마다 한 번)");
    // 입력하면 채널 제안 → 고르면 그 채널 다시보기
    await ev("(() => { const i = document.querySelector('#plVideoSearch input'); i.value = '클립'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    await until("!document.getElementById('plVideoChannelPopover').hidden && !!document.querySelector('#plVideoChannelPopover [data-pl-channel]')", "채널 제안");
    check(await ev("document.querySelector('#plVideoChannelPopover .mv-video-channel-option-name').textContent === '클립채널' && !!document.querySelector('#plVideoChannelPopover .pl-card-verified') && !!document.querySelector('#plVideoChannelPopover [data-pl-keyword]')"),
      "다시보기 검색칸에 입력하면 채널을 제안한다(파트너 배지, 키워드 검색 항목)");
    await ev("document.querySelector('#plVideoChannelPopover [data-pl-channel]').click(); true");
    await until("document.querySelector('#plVideoResults .pl-card-title')?.textContent === '채널 다시보기'", "채널 다시보기");
    check(await ev("document.getElementById('plVideoScopeText').textContent === '채널: 클립채널 다시보기' && document.getElementById('plVideoRerank').hidden && document.getElementById('plVideoChannelPopover').hidden"),
      "채널을 고르면 그 채널의 다시보기를 보이고 범위를 표시한다(재정렬은 검색어일 때만)");
    await ev("document.getElementById('plVideoScopeClear').click(); true");
    await until("document.getElementById('plVideoScope').hidden && document.querySelector('#plVideoResults .pl-card-title')?.textContent === '보관한 다시보기'", "범위 지우기");
    await ev("(() => { const f = document.getElementById('plVideoSearch'); f.querySelector('input').value = '합방'; f.requestSubmit(); return true; })()");
    await until("document.querySelectorAll('#plVideoResults .pl-card').length === 2", "검색");
    const resultOrder = () => ev("[...document.querySelectorAll('#plVideoResults .pl-card-title')].map((t) => t.textContent).join('|')");
    check(await ev("!document.getElementById('plVideoRerank').hidden && document.getElementById('plVideoScopeText').textContent === '검색: \"합방\"' && !!document.querySelector('#plVideoRerank [data-video-rerank-sort-trigger]')"),
      "다시보기 검색이면 멀티뷰와 같은 치즈 플래터 재정렬(정렬·설정)을 보인다");
    const sortBy = async (value) => {
      await ev(`(() => { document.querySelector('#plVideoRerank [data-video-rerank-sort-trigger]').click(); document.querySelector('#plVideoRerank [data-video-rerank-sort="${value}"]').click(); return true; })()`);
      await wait(150);
      return resultOrder();
    };
    const byRecent = await sortBy("recent");
    const byRead = await sortBy("read");
    if (process.env.PLAYLIST_SHOT) {
      const r = await ev("(() => { const b = document.getElementById('plAdd').getBoundingClientRect(); return { x: b.left - 4, y: b.top - 4, width: b.width + 8, height: Math.min(b.height + 8, 700) }; })()");
      const shot = await call("Page.captureScreenshot", { format: "png", clip: { ...r, scale: 1 } }, sessionId);
      writeFileSync(path.join(process.env.PLAYLIST_SHOT, "playlist-video-search.png"), Buffer.from(shot.data, "base64"));
    }
    check(await ev("getComputedStyle(document.getElementById('plVideoMore')).display === 'none'"), "다음 쪽이 없으면 '더 보기'를 숨긴다");
    check(byRecent === "합방 검색 결과|합방 인기 결과" && byRead === "합방 인기 결과|합방 검색 결과",
      `검색 결과를 최신순·인기순 등으로 다시 정렬한다 ${JSON.stringify({ byRecent, byRead })}`);
    check(await ev("window.__api.some((u) => u.startsWith('/service/v1/search/videos?keyword=%ED%95%A9%EB%B0%A9'))"), "검색어로 다시보기를 찾는다");

    // ── 추가: 클립 탭(보관함·채널 클립) ──
    await ev("document.querySelector('[data-add-tab=\"clip\"]').click(); true");
    await until("document.querySelector('#plClipResults .pl-card-title')?.textContent === '즐겨찾기 클립'", "클립 보관함");
    await until("!!document.querySelector('#plClipResults .pl-card-verified')", "클립 보관함 채널");
    check(true, "클립 탭은 처음에 클립 보관함(즐겨찾기)을 보이고, 빠진 채널 프로필·파트너 배지를 채운다");
    await ev("document.querySelector('[data-clip-source=\"channel\"]').click(); true");
    await ev("(() => { const f = document.getElementById('plClipChannelSearch'); f.querySelector('input').value = '클립'; f.requestSubmit(); return true; })()");
    await until("!!document.querySelector('#plClipChannels [data-channel]')", "채널 찾기");
    await ev("document.querySelector('#plClipChannels [data-channel]').click(); true");
    await until("document.querySelectorAll('#plClipResults .pl-card').length === 2 && !document.getElementById('plClipMore').hidden", "채널 클립");
    await ev("document.getElementById('plClipMore').click(); true");
    await until("document.querySelectorAll('#plClipResults .pl-card').length === 3 && document.getElementById('plClipMore').hidden", "더 보기");
    const clipApi = await ev("window.__api.filter((u) => u.includes('/clips?'))");
    check(clipApi.length === 2 && clipApi[1].includes("clipUID=chanClip2") && clipApi[1].includes("readCount=7") && clipApi[0].includes("orderType=RECENT"),
      `채널을 찾아 고르면 그 채널 클립을 불러오고, '더 보기'는 다음 커서로 이어 받는다 ${JSON.stringify(clipApi)}`);
    check(await ev("document.querySelector('#plClipResults [data-uid=\"chanClip1\"]').closest('.pl-card').querySelector('.pl-card-info').textContent === '조회수 2,500회 · 10.01'"),
      "클립 카드에도 조회수·날짜");
    await ev("document.querySelector('#plClipResults [data-result=\"2\"]').click(); true");
    check(await ev("(() => { const c = document.querySelector('#plClipResults [data-result=\"2\"]'); const r = c.querySelector('.pl-card-thumb').getBoundingClientRect(); return c.classList.contains('is-clip') && r.height > r.width * 1.5 && !!c.querySelector('.pl-card-verified') && document.querySelectorAll('#plClipResults .pl-card').length === 3 && getComputedStyle(document.getElementById('plClipResults')).display === 'grid'; })()"),
      "클립은 세로 썸네일 그리드, 파트너 채널이면 배지");
    await until("document.querySelector('#plClipResults [data-uid=\"chanClip1\"]')?.classList.contains('is-landscape')", "가로 클립");
    const orient = await ev(`(() => { const a = document.querySelector('#plClipResults [data-uid="chanClip1"]'); const b = document.querySelector('#plClipResults [data-uid="chanClip2"]');
      return { aFit: getComputedStyle(a.querySelector('img')).objectFit, bLand: b.classList.contains('is-landscape'), bFit: getComputedStyle(b.querySelector('img')).objectFit }; })()`);
    check(orient.aFit === "contain" && !orient.bLand && orient.bFit === "cover", `가로 클립 썸네일은 자르지 않고(클립 검색과 같이) 세로 클립은 꽉 채운다 ${JSON.stringify(orient)}`);
    await until(`${itemsOf()}.some((i) => i.clipUID === 'chanClip3' && i.channelName === '클립채널')`, "클립 추가");
    await ev("document.querySelector('[data-clip-order=\"POPULAR\"]').click(); true");
    await until("window.__api.at(-1).includes('orderType=POPULAR')", "정렬");
    check(true, "클립을 담으면 채널 이름도 함께 담고, 인기순으로 다시 불러올 수 있다");

    // ── 목록 삭제 ──
    await ev("document.getElementById('plDeleteList').click(); true");
    await until("!!document.querySelector('.crm-overlay [data-crm-ok]')", "삭제 모달");
    check(await ev("document.querySelector('.crm-overlay .crm-message').textContent.includes('되돌릴 수 없습니다')"), "목록 삭제는 확인 모달");
    await ev("document.querySelector('.crm-overlay [data-crm-ok]').click(); true");
    await until("window.__local.cheesePlaylists.lists.length === 2", "목록 삭제");
    check(await ev("!!document.querySelector('#plListNav [aria-selected=\"true\"]')"), "지운 뒤에는 남은 첫 목록을 보여 준다");

    if (process.env.PLAYLIST_SHOT) {
      await ev("document.querySelector('#plListNav button').click(); true");
      await wait(200);
      const shot = await call("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(path.join(process.env.PLAYLIST_SHOT, "playlist-page.png"), Buffer.from(shot.data, "base64"));
    }
  } finally {
    await new Promise((resolve) => {
      browser.once("exit", resolve);
      browser.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
