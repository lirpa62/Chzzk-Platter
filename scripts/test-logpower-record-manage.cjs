// 통나무파워 내역 기록 끄기·채널별 삭제와 '기록 관리' 공용 도구.
//   - 내역 기록을 끄면 새 기록(적립·5분 묶음·예측·자동 감지)을 남기지 않는다. 직접 추가·삭제는 그대로.
//   - 다시 켜거나 채널 기록을 지우면 보유량 비교 기준을 지운다(지운 금액이 기타 적립으로 다시 차지 않게).
//   - 채널별·전체 삭제는 배경의 단일 작성자(LP_WRITE DELETE_CHANNELS)가 한다.
//   - recordManage.js: 채널별로 모으기, 확인 모달, 기록 관리 모달.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const background = read("src/background.js");
const manageSource = read("src/recordManage.js");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

// ── 배경: 원본 코드를 떼어 가짜 저장소로 돌린다 ──────────────────────────────
function makeBackground(initial) {
  const store = structuredClone(initial);
  const listeners = [];
  const ctx = {
    console,
    structuredClone,
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
            return structuredClone(Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]])));
          },
          set: async (value) => Object.assign(store, structuredClone(value)),
          remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
    },
    LP_SNAP_KEY: "cheeseLogPowerBalanceSnapshotsV2",
  };
  const start = background.indexOf("// content.js 의 appendLogPowerLog 와 같은 규칙으로 내역에 남긴다.");
  const end = background.indexOf("// ── 연속 5분 보상 묶기");
  assert.ok(start > 0 && end > start, "배경 통나무파워 구간을 찾지 못했다");
  vm.runInNewContext(
    `${background.slice(background.indexOf("function verifiedMarkFields("), background.indexOf("\n}\n", background.indexOf("function verifiedMarkFields(")) + 3)}
    ${background.slice(start, end).replace(/^const LP_SNAP_KEY = .*$/m, "")}
    globalThis.api = { LP_WRITE_OPS, lpMutateLog, lpEnqueueWrite, lpAppendLog, lpLogRecordingOn };`,
    Object.assign(ctx, { globalThis: ctx }),
  );
  const change = async (key, newValue) => {
    const oldValue = store[key];
    store[key] = newValue;
    for (const fn of listeners) fn({ [key]: { oldValue, newValue } }, "local");
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { store, api: ctx.api, change };
}

const entry = (id, channelId, amount = 100) => ({ id, channelId, channelName: `채널${channelId}`, amount, at: Date.now() });
const ACC = "a".repeat(32);

(async () => {
  {
    const { store, api, change } = makeBackground({ cheeseLogPowerBalanceSnapshotsV2: { x: 1 } });
    await api.lpMutateLog((list) => api.LP_WRITE_OPS.APPEND_CLAIM(list, { entry: entry("e1", "c1") }, ACC));
    check(store.cheeseLogPowerLog?.length === 1, "기록이 켜져 있으면(기본) 적립을 남긴다");

    await change("cheeseLogPowerLogEnabled", false);
    check(!(await api.lpLogRecordingOn()), "설정을 끄면 배경이 바로 따른다");
    const changed = await api.lpMutateLog((list) => api.LP_WRITE_OPS.APPEND_CLAIM(list, { entry: entry("e2", "c1") }, ACC));
    await api.lpMutateLog((list) => api.LP_WRITE_OPS.APPEND_AUTO_BATCH(list, { entries: [entry("e3", "c2")] }, ACC));
    await api.lpAppendLog(entry("e4", "c3"));
    check(changed === false && store.cheeseLogPowerLog.length === 1,
      "끄면 적립·자동 감지·5분 묶음 기록을 남기지 않는다('변경 없음'이라 호출부는 재시도하지 않는다)");
    await api.lpMutateLog((list) => api.LP_WRITE_OPS.UPSERT_MANUAL_ENTRY(list, { entry: entry("m1", "c9", 50) }, ACC));
    check(store.cheeseLogPowerLog.some((it) => it.id === "m1"), "꺼져 있어도 직접 추가는 된다");
    check(store.cheeseLogPowerBalanceSnapshotsV2, "끌 때는 비교 기준을 건드리지 않는다");

    await change("cheeseLogPowerLogEnabled", true);
    check(!("cheeseLogPowerBalanceSnapshotsV2" in store),
      "다시 켜면 비교 기준을 지운다(꺼 둔 동안의 적립이 기타 적립으로 몰려 들어가지 않게)");
  }
  {
    // 시작부터 꺼져 있으면(서비스 워커가 깨어난 직후) 저장값을 읽은 뒤 판단한다.
    const { store, api } = makeBackground({ cheeseLogPowerLogEnabled: false });
    await api.lpMutateLog((list) => api.LP_WRITE_OPS.APPEND_CLAIM(list, { entry: entry("e1", "c1") }, ACC));
    check(!store.cheeseLogPowerLog, "깨어나자마자 온 기록도 저장된 '꺼짐'을 따른다");
  }
  {
    const { store, api } = makeBackground({
      cheeseLogPowerLog: [entry("a", "c1"), entry("b", "c1"), entry("c", "c2"), entry("d", "")],
    });
    const run = (payload) => api.lpMutateLog((list) => api.LP_WRITE_OPS.DELETE_CHANNELS(list, payload));
    await run({ channelIds: ["c1", ""] });
    check(JSON.stringify(store.cheeseLogPowerLog.map((it) => it.id)) === '["c"]', "고른 채널(채널 없는 기록 포함)만 지운다");
    check(await run({ channelIds: [] }) === false, "고른 채널이 없으면 아무것도 하지 않는다");
    await run({ all: true });
    check(store.cheeseLogPowerLog.length === 0, "전체 삭제");
  }
  check(/if \(op === "DELETE_CHANNELS"\) \{[\s\S]{0,400}if \(changed\) await chrome\.storage\.local\.remove\(LP_SNAP_KEY\);/.test(background),
    "채널 기록을 지우면 비교 기준도 지운다(계정 확인 없이 큐에서)");
  check(/if \(!\(await lpLogRecordingOn\(\)\)\) return \{ ok: false, reason: "recording-off" \};/.test(background),
    "기록이 꺼져 있으면 보유량 비교(자동 감지)를 하지 않는다");

  // ── 공용 도구: 모으기 ─────────────────────────────────────────────────────
  {
    const store = {
      cheeseLogPowerLog: [
        { id: "1", channelId: "c1", channelName: "옛이름", amount: 100, at: 1 },
        { id: "2", channelId: "c1", channelName: "새이름", channelImageUrl: "https://x/1.png", amount: -30, at: 5 },
        { id: "3", channelId: "", amount: 7, at: 2 },
      ],
      [`chatRecap:${ACC}:${"b".repeat(32)}:2026-09`]: { items: [1, 2, 3] },
      [`chatRecap:${ACC}:${"b".repeat(32)}:2026-10:part:1`]: { items: [1] },
      [`chatRecapVodChatStatsV1:${ACC}:${"c".repeat(32)}`]: {},
      [`chatRecapCatalog:${ACC}`]: { channels: { ["b".repeat(32)]: {}, ["c".repeat(32)]: {}, ["d".repeat(32)]: {} } },
      chatRecapImportedVideos: [1],
      unrelated: 1,
    };
    const sent = [];
    const ctx = {
      chrome: {
        storage: { local: {
          get: async (keys) => (keys == null ? { ...store } : Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]]))),
          set: async (value) => Object.assign(store, value),
          remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
        } },
        runtime: { sendMessage: async (message) => { sent.push(message); return { ok: true }; } },
      },
    };
    vm.runInNewContext(manageSource, Object.assign(ctx, { globalThis: ctx }));
    const manage = ctx.CheeseRecordManage;
    const lp = await manage.logPower.collect();
    check(lp[0].channelId === "c1" && lp[0].name === "새이름" && lp[0].image === "https://x/1.png" && lp[0].detail === "2건 · +100 / -30" &&
      lp[1].name === "채널 없는 기록(기타 적립 등)",
      `통나무파워: 채널별로 묶고 최근 이름·사진, 건수·적립/사용 합계 ${JSON.stringify(lp.map((g) => [g.name, g.detail]))}`);
    await manage.logPower.remove([lp[0], lp[1]]);
    await manage.logPower.clearAll();
    check(JSON.stringify(sent) === JSON.stringify([
      { type: "LP_WRITE", op: "DELETE_CHANNELS", payload: { channelIds: ["c1", ""] } },
      { type: "LP_WRITE", op: "DELETE_CHANNELS", payload: { all: true } },
    ]), "통나무파워 삭제는 배경에 맡긴다(직접 고쳐 쓰지 않는다)");

    const recap = await manage.chatRecap.collect();
    check(recap.length === 2 && recap[0].channelId === "b".repeat(32) && recap[0].rows === 4 && recap[0].months === 2 &&
      recap[1].detail === "다시보기 통계만", `채팅 기록: 계정·채널별로 묶는다(:part:N 포함) ${JSON.stringify(recap.map((g) => g.detail))}`);
    await manage.chatRecap.remove([recap[0]]);
    check(!Object.keys(store).some((k) => k.includes("b".repeat(32)) && k.startsWith("chatRecap:")) &&
      !store[`chatRecapCatalog:${ACC}`].channels["b".repeat(32)] && store[`chatRecapCatalog:${ACC}`].channels["d".repeat(32)],
      "채팅 기록 선택 삭제: 본문 키와 카탈로그의 그 채널만 지운다");
    await manage.chatRecap.clearAll();
    check(!Object.keys(store).some((k) => k.startsWith("chatRecap")) && store.unrelated === 1,
      "채팅 기록 전체 삭제: 가져오기 표식까지 비우고 다른 설정은 둔다");
  }

  // ── 공용 도구: 모달(실제 브라우저) ─────────────────────────────────────────
  const dir = mkdtempSync(path.join(tmpdir(), "cheese-crm-"));
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
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const ev = async (expression) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await ev(`(() => {
      const st = document.createElement("style"); st.textContent = ${JSON.stringify(read("src/recordManage.css"))}; document.head.append(st);
      const s = document.createElement("script"); s.textContent = ${JSON.stringify(manageSource)}; document.head.append(s);
      return true; })()`);
    const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
    const result = await ev(`(async () => {
      const M = globalThis.CheeseRecordManage;
      let groups = [{ id: "c1", name: "채널1", detail: "3건" }, { id: "c2", name: "", detail: "1건" }, { id: "c3", name: "채널3", detail: "2건" }];
      const removed = [];
      let cleared = 0, changed = 0;
      M.openManager({ title: "통나무파워 내역 관리", noun: "통나무파워 내역",
        load: async () => groups.map((g) => ({ ...g })),
        remove: async (picked) => { removed.push(...picked.map((g) => g.id)); groups = groups.filter((g) => !picked.some((p) => p.id === g.id)); },
        removeAll: async () => { cleared++; groups = []; },
        enrich: async (g) => ({ name: "이름채움" }),
        onChanged: () => changed++ });
      ${wait(50)}
      const overlay = document.querySelector(".crm-manager");
      const out = { rows: overlay.querySelectorAll(".crm-row").length, filled: overlay.querySelector('[data-crm-row="c2"] .crm-name').textContent,
        deleteDisabled: overlay.querySelector("[data-crm-delete]").disabled };
      overlay.querySelector('[data-crm-row="c1"] input').click();
      overlay.querySelector('[data-crm-row="c3"] input').click();
      out.label = overlay.querySelector("[data-crm-delete]").textContent;
      out.indeterminate = overlay.querySelector("[data-crm-all]").indeterminate;
      overlay.querySelector("[data-crm-delete]").click();
      ${wait(30)}
      const confirmBox = document.querySelector(".crm-confirm [role=alertdialog]");
      out.confirmText = confirmBox?.querySelector(".crm-message").textContent;
      // Esc 는 확인 창만 닫는다(관리 창은 남는다).
      confirmBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ${wait(30)}
      out.afterEsc = { confirm: !!document.querySelector(".crm-confirm"), manager: !!document.querySelector(".crm-manager"), removed: removed.length };
      overlay.querySelector("[data-crm-delete]").click();
      ${wait(30)}
      document.querySelector(".crm-confirm [data-crm-ok]").click();
      ${wait(80)}
      out.removed = removed.slice();
      out.rowsAfter = [...overlay.querySelectorAll(".crm-row")].map((r) => r.dataset.crmRow);
      overlay.querySelector("[data-crm-clear]").click();
      ${wait(30)}
      document.querySelector(".crm-confirm [data-crm-ok]").click();
      ${wait(80)}
      out.cleared = cleared;
      out.empty = overlay.querySelector(".crm-empty")?.textContent;
      out.changed = changed;
      out.clearDisabled = overlay.querySelector("[data-crm-clear]").disabled;
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      out.closed = !document.querySelector(".crm-overlay");
      return out;
    })()`);
    check(result.rows === 3 && result.filled === "이름채움" && result.deleteDisabled,
      `기록 관리 모달: 채널 목록(이름 없는 채널은 채운다), 고르기 전엔 선택 삭제 꺼짐 ${JSON.stringify(result)}`);
    check(result.label === "선택 삭제 (2)" && result.indeterminate && /2개 채널의 통나무파워 내역/.test(result.confirmText || ""),
      "고른 수를 보이고, 지우기 전에 확인 모달을 띄운다");
    check(result.afterEsc.manager && !result.afterEsc.confirm && result.afterEsc.removed === 0,
      "확인 창에서 Esc 는 확인 창만 닫고 지우지 않는다");
    check(JSON.stringify(result.removed) === '["c1","c3"]' && JSON.stringify(result.rowsAfter) === '["c2"]',
      "확인하면 고른 채널만 지우고 목록을 다시 그린다");
    check(result.cleared === 1 && result.empty && result.changed === 2 && result.clearDisabled && result.closed,
      "전체 삭제도 확인을 거치고, 지울 때마다 페이지에 알리며, Esc 로 닫는다");
  } finally {
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      chrome.kill();
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  // ── 연결 ───────────────────────────────────────────────────────────────
  const settingsHtml = read("settings.html");
  const settings = read("src/settings.js");
  check(/data-log-power-log-enabled/.test(settingsHtml) && /data-lp-manage-list/.test(settingsHtml) &&
    /"cheeseLogPowerLogEnabled",/.test(settings) && /data\?\.\[LOG_POWER_LOG_ENABLED_KEY\] !== false/.test(settings),
    "설정 > 통나무파워: '내역 기록'(기본 켜짐)과 '저장된 내역'(선택·전체 삭제)");
  check(!/\[data-lp-manage-list\]/.test(read("src/settingsUi.js")),
    "'저장된 내역'은 '내역 기록'을 꺼도 잠기지 않는다(끈 뒤 남은 내역을 지울 수 있어야 한다)");
  for (const page of ["logPowerStats.html", "chatRecap.html", "watchTime.html", "settings.html"]) {
    check(/<script src="src\/recordManage\.js"><\/script>/.test(read(page)), `${page} 가 공용 도구를 불러온다`);
  }
  check(/id="lpsManage"/.test(read("logPowerStats.html")) && /id="crcManage"/.test(read("chatRecap.html")),
    "통나무파워 내역·채팅 리캡 헤더에 '기록 관리'");
  check(!/\bconfirm\(`'/.test(read("src/watchTime.js")) && /CheeseRecordManage\?\.confirm\(options\)/.test(read("src/watchTime.js")),
    "시청 시간 기록 지우기는 브라우저 confirm 대신 확인 모달");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
