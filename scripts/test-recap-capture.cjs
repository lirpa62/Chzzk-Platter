// 다시보기 '내 채팅 기록' PNG 캡처(배지 모아 챗 캡처 방식).
// 같은 공용 컨트롤러를 '구간 요약'(카드 단위, 6개씩)·'방장·매니저·파트너 채팅'·내 채팅 기록 검색 창도 쓴다.
//   - 헤더 카메라 버튼 → 선택 모드: 줄을 누르면 장면 이동 대신 선택, Shift 범위, 전체 선택
//   - 고른 줄을 20개씩 나눠 채널·다시보기 제목·방송 날짜 머리를 붙여 PNG 로 만든다
//   - 미리보기 후 저장(스크린샷과 같은 배경 다운로드). Esc·취소는 저장하지 않는다
// 원본 코드와 실제 html-to-image 를 브라우저에서 돌려, 만들어진 PNG 가 비어 있지 않은지까지 본다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const content = read("src/content.js");
const section = content.slice(
  content.indexOf("  // ── 채팅 PNG 캡처(배지 모아 챗 캡처 방식)"),
  content.indexOf("  function clearChatRecapClickDelayTimer() {"),
);
assert.ok(/function captureRecapSelection\(/.test(section), "캡처 구간을 찾지 못했다");
// 헤드리스 Chrome 응답이 끝내 오지 않으면 전체 스위트가 멈춘다. 멈추지 말고 실패로 끝낸다.
setTimeout(() => {
  console.error("시간 초과: 브라우저 응답이 오지 않았다");
  process.exit(1);
}, 90000).unref();
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

// 이모티콘 자리(빨간 사각형 PNG). 외부 이미지는 받아 data URL 로 넣는다.
const EMOJI = "https://nng-phinf.pstatic.net/glive/emoji/red.png";
const HARNESS = `
  window.sent = [];
  window.anchorSaves = 0;
  const VIDEO_COMMENT_PANEL_CLASS = "cheese-search-comment-timestamp-panel";
  const RECAP_PANEL_CLASS = "cheese-chat-recap-panel";
  const ROLE_CHAT_PANEL_CLASS = "cheese-role-chat-panel";
  const CHAT_PEAK_POPOVER_CLASS = "cheese-chat-peak-popover";
  const getCurrentVideoNo = () => "1234567";
  const parsePublishDate = (v) => (v ? Date.parse(String(v).replace(" ", "T") + "+09:00") : 0);
  const downloadScreenshotWithAnchor = () => { window.anchorSaves++; return true; };
  window.chrome = { runtime: { lastError: null, sendMessage: (message, cb) => {
    window.sent.push(message.type === "CHEESE_SCREENSHOT_SAVE" ? { type: message.type, filename: message.filename, png: message.url.startsWith("data:image/png") } : message);
    if (message.type === "CHEESE_LOAD_CAPTURE_LIB") {
      const s = document.createElement("script"); s.textContent = window.__lib; document.head.append(s);
    }
    setTimeout(() => cb({ ok: true }), 0);
  } } };
  const red = (() => { const c = document.createElement("canvas"); c.width = c.height = 24; const x = c.getContext("2d"); x.fillStyle = "#f00"; x.fillRect(0, 0, 24, 24); return c.toDataURL(); })();
  window.fetch = async (url) => {
    if (String(url).includes("/service/v2/videos/")) {
      return { ok: true, json: async () => ({ content: { videoTitle: "합방 다시보기", channel: { channelName: "치즈채널" }, liveOpenDate: "2026-10-01 20:05:00" } }) };
    }
    if (url === ${JSON.stringify(EMOJI)}) return { ok: true, blob: async () => (await (await window.__origFetch(red)).blob()) };
    return { ok: false };
  };
  ${section}
  window.api = { bindRecapCapture, syncRecapCapture, captureRecapSelection, recapCapture,
    roleCaptureController, peakCaptureController, markPeakCaptureUnits };
`;

const dir = mkdtempSync(path.join(tmpdir(), "cheese-recap-capture-"));
const chrome = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir}`],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
let buf = "";
let seq = 0;
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buf += chunk;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
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
  chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
});

(async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => {
      window.__lib = ${JSON.stringify(read("src/html-to-image.min.js"))};
      window.__origFetch = window.fetch.bind(window);
      const st = document.createElement("style"); st.textContent = ${JSON.stringify(read("src/content.css"))}; document.head.append(st);
      const s = document.createElement("script"); s.textContent = ${JSON.stringify(HARNESS)}; document.head.append(s);
      // 패널(renderChatRecapPanel 과 같은 마크업). 줄을 누르면 원래는 장면을 옮긴다.
      window.seeks = 0;
      const panel = document.createElement("div");
      panel.className = "cheese-search-comment-timestamp-panel cheese-chat-recap-panel";
      panel.style.cssText = "position:absolute;left:20px;top:20px";
      panel.innerHTML = '<div class="cheese-search-comment-panel-head"><strong>내 채팅 기록 25개</strong><div class="cheese-recap-panel-head-actions">' +
        '<button type="button" data-recap-capture aria-pressed="false">cam</button></div></div>';
      const list = document.createElement("ol");
      list.className = "cheese-search-comment-panel-list";
      for (let i = 0; i < 25; i++) {
        const li = document.createElement("li");
        li.innerHTML = '<button type="button" data-recap-seek="' + (i * 10) + '" data-recap-index="' + i + '"><span>0:0' + (i % 10) + '</span>' +
          '<strong>채팅 ' + i + (i === 0 ? ' <img class="cheese-blind-emoji" src="${EMOJI}" alt="">' : '') + '</strong></button>';
        list.append(li);
      }
      panel.append(list);
      document.body.append(panel);
      panel.querySelectorAll("[data-recap-seek]").forEach((b) => b.addEventListener("click", () => window.seeks++));
      api.bindRecapCapture(panel);
      api.syncRecapCapture(panel);
      window.panel = panel;
      return true;
    })()`);

    const select = await ev(`(async () => {
      const row = (i) => panel.querySelector('[data-recap-index="' + i + '"]');
      row(3).click();
      const seekBefore = window.seeks;
      panel.querySelector("[data-recap-capture]").click();
      const active = panel.classList.contains("is-capture-selecting") && !!panel.querySelector("[data-chat-capture-bar]");
      row(0).click();
      row(4).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      const range = api.recapCapture.selected.size;
      const marked = panel.querySelectorAll(".is-capture-selected").length;
      row(2).click();
      const toggled = api.recapCapture.selected.has("2");
      panel.querySelector("[data-chat-capture-all]").click();
      return { seekBefore, seeksInMode: window.seeks - seekBefore, active, range, marked, toggled,
        all: api.recapCapture.selected.size, count: panel.querySelector("[data-chat-capture-count]").textContent };
    })()`);
    check(select.seekBefore === 1, "선택 모드가 아니면 줄을 눌러 장면을 옮긴다");
    check(select.active && select.seeksInMode === 0, `선택 모드에서는 줄을 눌러도 장면을 옮기지 않는다 ${JSON.stringify(select)}`);
    check(select.range === 5 && select.marked === 5 && !select.toggled, "Shift 로 범위 선택, 다시 누르면 해제");
    check(select.all === 25 && select.count === "25개 선택", "전체 선택");

    const made = await ev(`(async () => {
      panel.querySelector("[data-chat-capture-save]").click();
      for (let i = 0; i < 100 && !document.querySelector(".cheese-recap-capture-preview"); i++) await new Promise((r) => setTimeout(r, 100));
      const overlay = document.querySelector(".cheese-recap-capture-preview");
      if (!overlay) return { overlay: false, sent: window.sent, progress: api.recapCapture.progress };
      const img = overlay.querySelector("img");
      await img.decode();
      // 첫 장을 캔버스에 그려 배경이 아닌 화소(글자·이모티콘)가 충분한지, 빨간 이모티콘이 들어갔는지 본다.
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const data = x.getImageData(0, 0, c.width, c.height).data;
      let ink = 0, red = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (Math.abs(r - 0x1f) + Math.abs(g - 0x27) + Math.abs(b - 0x38) > 60) ink++;
        if (r > 200 && g < 60 && b < 60) red++;
      }
      const shown = img.getBoundingClientRect();
      const ratio = Math.abs(shown.width / shown.height - img.naturalWidth / img.naturalHeight);
      return { overlay: true, ratio, page: overlay.querySelector("[data-preview-page]").textContent, file: overlay.querySelector("[data-preview-file]").textContent,
        width: img.naturalWidth, height: img.naturalHeight, ink, red, lib: window.sent.some((m) => m.type === "CHEESE_LOAD_CAPTURE_LIB"),
        png: ${process.env.RECAP_CAPTURE_SHOTS ? "c.toDataURL()" : "''"},
        stageLeft: document.querySelectorAll(".cheese-recap-capture-stage").length };
    })()`);
    if (process.env.RECAP_CAPTURE_SHOTS && made.png) {
      fs.writeFileSync(path.join(process.env.RECAP_CAPTURE_SHOTS, "recap-capture-1.png"), Buffer.from(made.png.split(",")[1], "base64"));
      const shot = await call("Page.captureScreenshot", { format: "png" }, sessionId);
      fs.writeFileSync(path.join(process.env.RECAP_CAPTURE_SHOTS, "recap-capture-preview.png"), Buffer.from(shot.data, "base64"));
    }
    check(made.overlay && made.lib, `html-to-image 를 필요할 때 불러와 미리보기를 띄운다 ${JSON.stringify(made)}`);
    check(made.ratio < 0.02, `미리보기는 이미지 비율을 지킨다(넘치면 스크롤) ${made.ratio}`);
    check(made.page === "1 / 2" && made.file === "내채팅기록_치즈채널_20261001-2005_1.png",
      "25개 → 20개씩 두 장, 파일 이름에 채널·방송 시각");
    check(made.width > 300 && made.ink > 2000 && made.red > 100 && made.stageLeft === 0,
      `PNG 가 비어 있지 않고(글자·이모티콘이 그려짐) 촬영대는 치운다 ${JSON.stringify({ w: made.width, h: made.height, ink: made.ink, red: made.red })}`);

    const saved = await ev(`(async () => {
      // Esc 는 저장하지 않는다 → 다시 만들어 저장.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      const afterEsc = { overlay: !!document.querySelector(".cheese-recap-capture-preview"), saves: window.sent.filter((m) => m.type === "CHEESE_SCREENSHOT_SAVE").length,
        stillSelecting: panel.classList.contains("is-capture-selecting") };
      panel.querySelector("[data-chat-capture-save]").click();
      for (let i = 0; i < 100 && !document.querySelector(".cheese-recap-capture-preview"); i++) await new Promise((r) => setTimeout(r, 100));
      document.querySelector("[data-preview-save]").click();
      for (let i = 0; i < 50 && window.sent.filter((m) => m.type === "CHEESE_SCREENSHOT_SAVE").length < 2; i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 50));
      return { afterEsc, saves: window.sent.filter((m) => m.type === "CHEESE_SCREENSHOT_SAVE"),
        selecting: panel.classList.contains("is-capture-selecting"), anchor: window.anchorSaves };
    })()`);
    check(!saved.afterEsc.overlay && saved.afterEsc.saves === 0 && saved.afterEsc.stillSelecting,
      "미리보기에서 Esc 는 저장하지 않고 선택을 유지한다");
    check(saved.saves.length === 2 && saved.saves.every((m) => m.png) && saved.saves[1].filename.endsWith("_2.png") && saved.anchor === 0,
      `저장하면 두 장을 스크린샷과 같은 배경 다운로드로 보낸다 ${JSON.stringify(saved.saves)}`);
    check(!saved.selecting, "저장하면 선택 모드를 끝낸다");

    // ── 구간 요약: '영상 전체' 덩어리 + 구간 카드 7개. 카드 단위로 고르고 6개씩 나눈다. ──
    const peak = await ev(`(async () => {
      window.peakSeeks = 0;
      const lib = globalThis.htmlToImage;
      if (!lib.__wrapped) {
        const original = lib.toBlob;
        lib.toBlob = (node, opts) => { window.surfaces.push(node.outerHTML); return original(node, opts); };
        lib.__wrapped = true;
      }
      window.surfaces = [];
      const pop = document.createElement("div");
      pop.className = "cheese-search-comment-timestamp-panel cheese-chat-peak-popover";
      pop.style.cssText = "position:absolute;left:520px;top:20px;bottom:auto;right:auto";
      let cards = "";
      for (let i = 0; i < 7; i++) {
        cards += '<li><button type="button" data-peak-seek="' + (i * 60) + '"><time>' + i + ':00 ~ ' + i + ':30</time><small>채팅 ' + (100 - i) + '개</small></button>' +
          '<div class="cheese-peak-items"><span>ㅋㅋㅋ ' + i + '</span></div></li>';
      }
      pop.innerHTML = '<div class="cheese-search-comment-panel-head"><strong>구간 요약</strong><div class="cheese-recap-panel-head-actions">' +
        '<button type="button" data-peak-capture aria-pressed="false">cam</button></div></div>' +
        '<div class="cheese-peak-body"><div class="cheese-peak-section cheese-peak-overall"><h4>영상 전체에서 많이 나온 항목</h4><div class="cheese-peak-items"><span>ㅋㅋ 전체</span></div></div>' +
        '<div class="cheese-peak-section"><h4>채팅이 몰린 구간</h4><ul>' + cards + '</ul></div></div>';
      document.body.append(pop);
      pop.addEventListener("click", (e) => { if (e.target.closest("[data-peak-seek]")) window.peakSeeks++; });
      const c = api.peakCaptureController;
      c.bind(pop);
      api.markPeakCaptureUnits(pop);
      c.sync(pop);
      pop.querySelector("[data-peak-capture]").click();
      const hint = pop.querySelector("[data-chat-capture-count]")?.textContent;
      const card = (i) => pop.querySelectorAll(".cheese-peak-section > ul > li")[i];
      card(1).querySelector("button").click();
      const seeksInMode = window.peakSeeks;
      pop.querySelector("[data-chat-capture-all]").click();
      const units = c.state.selected.size;
      pop.querySelector("[data-chat-capture-save]").click();
      for (let i = 0; i < 100 && !document.querySelector(".cheese-recap-capture-preview"); i++) await new Promise((r) => setTimeout(r, 100));
      const overlay = document.querySelector(".cheese-recap-capture-preview");
      const parse = (html) => new DOMParser().parseFromString(html || "", "text/html").body.firstElementChild;
      const first = parse(window.surfaces[0]);
      const second = parse(window.surfaces[1]);
      const out = { hint, seeksInMode, units, surfaces: window.surfaces.length,
        page: overlay?.querySelector("[data-preview-page]")?.textContent,
        file: overlay?.querySelector("[data-preview-file]")?.textContent,
        heading: first?.querySelector(".cheese-recap-capture-head strong")?.textContent,
        firstOverall: !!first?.querySelector(".cheese-peak-body > .cheese-peak-overall"),
        firstCards: first?.querySelectorAll(".cheese-peak-section > ul > li").length,
        firstTitles: [...(first?.querySelectorAll(".cheese-peak-section > h4") || [])].map((h) => h.textContent),
        secondCards: second?.querySelectorAll(".cheese-peak-section > ul > li").length,
        secondTitle: second?.querySelector(".cheese-peak-section:not(.cheese-peak-overall) > h4")?.textContent,
        leftoverMark: (window.surfaces[0] || "").includes("is-capture-selected") };
      if (overlay) {
        const img = overlay.querySelector("img");
        await img.decode();
        const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const x = cv.getContext("2d"); x.drawImage(img, 0, 0);
        const data = x.getImageData(0, 0, cv.width, cv.height).data;
        let ink = 0;
        for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 0x1f) + Math.abs(data[i + 1] - 0x27) + Math.abs(data[i + 2] - 0x38) > 60) ink++;
        out.ink = ink;
        out.height = img.naturalHeight;
        if (${Boolean(process.env.RECAP_CAPTURE_SHOTS)}) out.png = cv.toDataURL();
      }
      document.querySelector("[data-preview-cancel]")?.click();
      c.reset();
      c.sync(pop);
      out.cleared = !pop.classList.contains("is-capture-selecting") && !pop.querySelector("[data-chat-capture-bar]");
      return out;
    })()`);
    if (process.env.RECAP_CAPTURE_SHOTS && peak.png) {
      fs.writeFileSync(path.join(process.env.RECAP_CAPTURE_SHOTS, "peak-capture-1.png"), Buffer.from(peak.png.split(",")[1], "base64"));
    }
    delete peak.png;
    check(peak.hint === "저장할 구간을 고르세요" && peak.seeksInMode === 0,
      `구간 요약: 선택 모드에서 카드를 눌러도 장면을 옮기지 않는다 ${JSON.stringify(peak)}`);
    check(peak.units === 8 && peak.surfaces === 2 && peak.page === "1 / 2",
      `구간 요약: 카드 단위(영상 전체 1 + 구간 7)로 고르고 6개씩 두 장 ${JSON.stringify(peak)}`);
    check(peak.heading === "구간 요약" && peak.file === "구간요약_치즈채널_20261001-2005_1.png",
      `구간 요약 이미지 머리·파일 이름 ${JSON.stringify(peak)}`);
    check(peak.firstOverall && peak.firstCards === 5 && JSON.stringify(peak.firstTitles) === JSON.stringify(["영상 전체에서 많이 나온 항목", "채팅이 몰린 구간"]) &&
      peak.secondCards === 2 && peak.secondTitle === "채팅이 몰린 구간" && !peak.leftoverMark,
      `구간 요약: 원래 묶음 제목과 함께 다시 짜고, 다음 장에도 구간 제목을 단다 ${JSON.stringify(peak)}`);
    check(peak.ink > 1500 && peak.height > 200 && peak.cleared, `구간 요약 PNG 가 비어 있지 않고, 정리하면 선택 막대가 사라진다 ${JSON.stringify(peak)}`);

    // ── 방장·매니저·파트너 채팅: 내 채팅 기록과 같은 줄 선택 ──
    const role = await ev(`(async () => {
      window.surfaces = [];
      const panel = document.createElement("div");
      panel.className = "cheese-search-comment-timestamp-panel cheese-role-chat-panel";
      panel.style.cssText = "position:absolute;left:20px;top:560px";
      let rows = "";
      for (let i = 0; i < 4; i++) {
        rows += '<li><button type="button" data-recap-seek="' + i + '" data-recap-index="' + i + '"><span>0:0' + i + '</span>' +
          '<em class="cheese-recap-role-who">매니저' + i + '</em><strong>공지 ' + i + '</strong></button></li>';
      }
      panel.innerHTML = '<div class="cheese-search-comment-panel-head"><strong>방장·매니저 채팅</strong><div class="cheese-recap-panel-head-actions">' +
        '<button type="button" data-role-capture aria-pressed="false">cam</button></div></div>' +
        '<ol class="cheese-search-comment-panel-list cheese-recap-role-list">' + rows + '</ol>';
      document.body.append(panel);
      const c = api.roleCaptureController;
      c.bind(panel);
      c.sync(panel);
      panel.querySelector("[data-role-capture]").click();
      const pressed = panel.querySelector("[data-role-capture]").getAttribute("aria-pressed");
      const row = (i) => panel.querySelector('[data-recap-index="' + i + '"]');
      row(1).click();
      row(3).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      const selected = [...c.state.selected].join(",");
      const selectedBg = getComputedStyle(row(2)).borderTopStyle;
      panel.querySelector("[data-chat-capture-save]").click();
      for (let i = 0; i < 100 && !document.querySelector(".cheese-recap-capture-preview"); i++) await new Promise((r) => setTimeout(r, 100));
      const surface = new DOMParser().parseFromString(window.surfaces[0] || "", "text/html").body.firstElementChild;
      const out = { pressed, selected, selectedBg,
        file: document.querySelector("[data-preview-file]")?.textContent,
        page: document.querySelector("[data-preview-page]")?.textContent,
        heading: surface?.querySelector(".cheese-recap-capture-head strong")?.textContent,
        surfaceRole: !!surface?.classList.contains("cheese-role-chat-panel"),
        list: surface?.querySelector("ol")?.className,
        who: [...(surface?.querySelectorAll(".cheese-recap-role-who") || [])].map((el) => el.textContent) };
      document.querySelector("[data-preview-cancel]")?.click();
      return out;
    })()`);
    check(role.pressed === "true" && role.selected === "1,2,3" && role.selectedBg === "dashed",
      `방장 채팅: 카메라로 선택 모드, Shift 범위, 고른 줄 표시 ${JSON.stringify(role)}`);
    check(role.heading === "방장·매니저·파트너 채팅" && role.surfaceRole && role.list === "cheese-search-comment-panel-list cheese-recap-role-list" &&
      JSON.stringify(role.who) === JSON.stringify(["매니저1", "매니저2", "매니저3"]) && role.file === "방장매니저채팅_치즈채널_20261001-2005.png",
      `방장 채팅: 패널 모양 그대로(역할 이름 포함) 머리·파일 이름 ${JSON.stringify(role)}`);
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // ── 내 채팅 기록 검색 창(같은 공용 컨트롤러, 실제 설정을 content.js 에서 떼어 온다) ──
  const searchConfig = content.slice(
    content.indexOf("    const searchCapture = createChatCaptureController("),
    content.indexOf("    searchCapture.bind(windowEl);"),
  );
  check(searchConfig.length > 200, "검색 창 캡처 설정을 찾았다");
  {
    const dir2 = mkdtempSync(path.join(tmpdir(), "cheese-search-capture-"));
    const chrome2 = spawn(process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-pipe", `--user-data-dir=${dir2}`],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    let buf2 = "";
    let seq2 = 0;
    const pending2 = new Map();
    chrome2.stdio[4].on("data", (chunk) => {
      buf2 += chunk;
      for (let e; (e = buf2.indexOf("\0")) >= 0;) {
        const raw = buf2.slice(0, e);
        buf2 = buf2.slice(e + 1);
        if (!raw) continue;
        const msg = JSON.parse(raw);
        const job = pending2.get(msg.id);
        if (!job) continue;
        pending2.delete(msg.id);
        msg.error ? job.reject(Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
      }
    });
    const call2 = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++seq2;
      pending2.set(id, { resolve, reject });
      chrome2.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
    try {
      const { targetId } = await call2("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await call2("Target.attachToTarget", { targetId, flatten: true });
      const ev2 = async (expression) => {
        const r = await call2("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      const SEARCH_HARNESS = `${HARNESS}
        const RECAP_SEARCH_WINDOW_CLASS = "cheese-recap-search-window";
        const dateValues = { recapFrom: "2026-10-01", recapTo: "" };
        const windowEl = document.querySelector(".cheese-recap-search-window");
        ${searchConfig}
        searchCapture.bind(windowEl);
        searchCapture.sync(windowEl);
        window.searchCapture = searchCapture;
        // 실제로 그린 상자를 엿본다(촬영대는 그린 뒤 치운다).
        const lib = () => globalThis.htmlToImage;
        window.__wrapLib = () => { const original = lib().toBlob; lib().toBlob = (node, opts) => { window.lastSurface = node.outerHTML; window.lastBg = opts.backgroundColor; return original(node, opts).then((blob) => { window.lastBlob = blob; return blob; }); }; };`;
      await ev2(`(() => {
        window.__lib = ${JSON.stringify(read("src/html-to-image.min.js"))};
        window.__origFetch = window.fetch.bind(window);
        document.documentElement.style.cssText = "--sem-color-background-neutral-base:#ffffff;--sem-color-content-neutral-primary:#17191c";
        const st = document.createElement("style"); st.textContent = ${JSON.stringify(read("src/content.css"))}; document.head.append(st);
        const win = document.createElement("section");
        win.className = "cheese-recap-search-window";
        win.style.cssText = "position:absolute;left:10px;top:10px;width:420px;height:500px";
        win.innerHTML = '<header class="cheese-recap-search-window-head"><strong>내 채팅 기록 검색</strong><div class="cheese-recap-search-window-head-actions">' +
          '<button type="button" data-recap-search-capture aria-pressed="false">cam</button></div></header>' +
          '<div class="cheese-recap-search-window-filters"><span data-recap-search-channel-label>치즈채널</span><input data-recap-search-keyword value="ㅋㅋ"></div>' +
          '<div class="cheese-recap-search-window-status" data-recap-search-status>3개</div>' +
          '<div class="cheese-recap-search-window-results">' +
          '<div class="cheese-recap-search-window-date">2026.10.14.</div>' +
          '<div class="cheese-recap-search-window-row" data-capture-key="0"><time>21:00</time><span>ㅋㅋ 첫째</span></div>' +
          '<div class="cheese-recap-search-window-row" data-capture-key="1"><time>20:00</time><span>ㅋㅋ 둘째</span></div>' +
          '<div class="cheese-recap-search-window-date">2026.10.13.</div>' +
          '<div class="cheese-recap-search-window-row" data-capture-key="2"><time>19:00</time><span>ㅋㅋ 셋째</span></div></div>';
        document.body.append(win);
        return true; })()`);
      await ev2(`(() => { const s = document.createElement("script"); s.textContent = ${JSON.stringify(SEARCH_HARNESS)}; document.head.append(s); return true; })()`);
      const resultPromise = ev2(`(async () => {
        const win = document.querySelector(".cheese-recap-search-window");
        win.querySelector("[data-recap-search-capture]").click();
        const barEl = win.querySelector(".cheese-recap-search-window-head > [data-chat-capture-bar]");
        const titleHidden = getComputedStyle(win.querySelector(".cheese-recap-search-window-head > strong")).display === "none";
        const saveBox = barEl?.querySelector("[data-chat-capture-save]")?.getBoundingClientRect();
        const head = win.querySelector(".cheese-recap-search-window-head").getBoundingClientRect();
        const bar = !!barEl && titleHidden && saveBox.width > 50 && saveBox.top >= head.top && saveBox.bottom <= head.bottom && saveBox.right <= head.right;
        const rows = win.querySelectorAll(".cheese-recap-search-window-row");
        rows[1].click();
        rows[2].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
        const selected = [...searchCapture.state.selected].join(",");
        if (${Boolean(process.env.RECAP_CAPTURE_SHOTS)}) await new Promise((r) => { window.__shotNow = r; });
        // 라이브러리를 넣는 순간 감싼다.
        const origSend = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = (m, cb) => origSend(m, (r) => { if (m.type === "CHEESE_LOAD_CAPTURE_LIB") window.__wrapLib(); cb(r); });
        win.querySelector("[data-chat-capture-save]").click();
        for (let i = 0; i < 100 && !document.querySelector(".cheese-recap-capture-preview"); i++) await new Promise((r) => setTimeout(r, 100));
        const surface = new DOMParser().parseFromString(window.lastSurface || "", "text/html").body.firstElementChild;
        const out = { bar, selected, preview: !!document.querySelector(".cheese-recap-capture-preview"),
          file: document.querySelector("[data-preview-file]")?.textContent,
          head: [...(surface?.querySelector(".cheese-recap-capture-head")?.children || [])].map((el) => el.textContent),
          order: [...(surface?.querySelector(".cheese-recap-search-window-results")?.children || [])].map((el) => el.textContent),
          bg: window.lastBg };
        if (${Boolean(process.env.RECAP_CAPTURE_SHOTS)} && window.lastBlob) {
          out.png = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(window.lastBlob); });
        }
        document.querySelector("[data-preview-cancel]")?.click();
        return out;
      })()`);
      if (process.env.RECAP_CAPTURE_SHOTS) {
        for (let i = 0; i < 50 && !(await ev2("typeof window.__shotNow === 'function'")); i++) await new Promise((r) => setTimeout(r, 50));
        const shot = await call2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 460, height: 260, scale: 1 } }, sessionId);
        fs.writeFileSync(path.join(process.env.RECAP_CAPTURE_SHOTS, "recap-search-head.png"), Buffer.from(shot.data, "base64"));
        await ev2("window.__shotNow(); true");
      }
      const result = await resultPromise;
      if (process.env.RECAP_CAPTURE_SHOTS && result.png) {
        fs.writeFileSync(path.join(process.env.RECAP_CAPTURE_SHOTS, "recap-search-capture.png"), Buffer.from(result.png.split(",")[1], "base64"));
      }
      delete result.png;
      check(result.bar && result.selected === "1,2", `검색 창: 카메라 버튼으로 선택 모드, 창 머리(제목 자리) 안에 보이는 선택 막대, Shift 범위 ${JSON.stringify(result)}`);
      check(result.preview && /^내채팅검색_치즈채널_\d{8}\.png$/.test(result.file || ""), "검색 창: 미리보기·파일 이름(내채팅검색_스트리머_날짜)");
      check(JSON.stringify(result.head.slice(0, 4)) === JSON.stringify(["내 채팅 기록 검색", "치즈채널", '키워드 "ㅋㅋ"', "기간 2026-10-01 ~ 오늘"]),
        `검색 창 이미지 머리: 스트리머·키워드·기간 ${JSON.stringify(result.head)}`);
      check(JSON.stringify(result.order) === JSON.stringify(["2026.10.14.", "20:00ㅋㅋ 둘째", "2026.10.13.", "19:00ㅋㅋ 셋째"]),
        `고른 줄 사이에 날짜가 바뀌면 날짜 머리도 넣는다 ${JSON.stringify(result.order)}`);
      check(result.bg === "rgb(255, 255, 255)", `검색 창 이미지 배경은 창의 테마 색 ${result.bg}`);
    } finally {
      await new Promise((resolve) => {
        chrome2.once("exit", resolve);
        chrome2.kill();
      });
      rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  const background = read("src/background.js");
  check(/message\.type === "CHEESE_LOAD_CAPTURE_LIB"[\s\S]{0,600}files: \["src\/html-to-image\.min\.js"\]/.test(background) &&
    /frameIds: \[Number\(sender\.frameId\) \|\| 0\]/.test(background),
    "배경: 캡처할 때만 그 탭·프레임에 html-to-image 를 넣는다(모든 페이지에 미리 싣지 않는다)");
  check(/bindRecapCapture\(panel\);/.test(content) && /syncRecapCapture\(panel\);\n  \}/.test(content) && /function closeChatRecapPanel\(\) \{\n    resetRecapCapture\(\);/.test(content),
    "패널을 열 때 연결, 다시 그린 뒤 선택 표시 복원, 닫으면 정리");
  check(/roleCaptureController\.bind\(panel\);/.test(content) &&
    /updateRecapPanelCurrentItemFor\("role", \{ scroll: true \}\);\n    roleCaptureController\.sync\(panel\);/.test(content) &&
    /function closeRoleChatPanel\(\) \{\n    roleCaptureController\.reset\(\);/.test(content),
    "방장 채팅 패널: 열 때 연결, 다시 그린 뒤 복원, 닫으면 정리");
  check(/\(searching \? "" : capture \+ rescan \+ search\)/.test(content) &&
    /host\.innerHTML = body;\n    markPeakCaptureUnits\(panel\);\n    peakCaptureController\.sync\(panel\);/.test(content) &&
    /peakCaptureController\.bind\(el\);/.test(content) &&
    /data-peak-search\]"\)\) \{[\s\S]{0,200}peakCaptureController\.reset\(\);[\s\S]{0,80}openVodChatSearchView\(el\);/.test(content) &&
    /function closeChatPeakPopover\(\) \{\n    peakCaptureController\.reset\(\);/.test(content),
    "구간 요약: 카메라는 요약 화면에만, 본문을 그릴 때 카드 표시, 검색 화면으로 가거나 닫으면 정리");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
