#!/usr/bin/env node
"use strict";
const fs = require("fs"),
  path = require("path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "settings.js"),
  "utf8",
);
const i = src.indexOf('  recapManageDelete?.addEventListener("click"');
const j = src.indexOf("  recapManageClear?.addEventListener", i);
const handler = src.slice(i, j);
if (i < 0 || j < 0 || !handler.trim()) throw new Error("핸들러 추출 실패");

function mkBtn() {
  const b = { disabled: false, _fn: null };
  b.addEventListener = (t, f) => {
    b._fn = f;
  };
  b.fire = () => b._fn();
  return b;
}
let fails = 0;
const ok = (c, m) => {
  console.log((c ? "  PASS " : "  FAIL ") + m);
  if (!c) fails++;
};

function makeRow(id) {
  const cls = new Set();
  return {
    id,
    removed: false,
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      has: (c) => cls.has(c),
    },
    remove() {
      this.removed = true;
    },
    _cls: cls,
  };
}
async function run({ fail = false } = {}) {
  const rows = new Map([
    ["A", makeRow("A")],
    ["B", makeRow("B")],
    ["C", makeRow("C")],
  ]);
  const checked = [{ value: "A" }, { value: "C" }];
  const channels = new Map([
    ["A", {}],
    ["B", {}],
    ["C", {}],
  ]);
  const log = [];
  let renderCalls = 0;
  const list = {
    innerHTML: "",
    querySelectorAll: () => checked,
    querySelector: (sel) => {
      const m = sel.match(/data-recap-row="(\w+)"/);
      return m ? rows.get(m[1]) : null;
    },
  };
  const sandbox = {
    recapManageList: list,
    recapManageDelete: mkBtn(),
    recapManageClear: { disabled: false },
    recapManageChannels: channels,
    removeRecapChannels: async (ids) => {
      log.push(ids.join(","));
      if (fail) throw new Error("boom");
    },
    syncRecapManageButtons: () => {},
    settingsToast: (m) => log.push("toast:" + m),
    renderRecapManage: () => {
      renderCalls++;
    },
    CSS: { escape: (v) => v },
  };
  const names = Object.keys(sandbox);
  new Function(...names, handler)(...names.map((n) => sandbox[n]));
  await sandbox.recapManageDelete.fire();
  return { rows, channels, log, renderCalls, list };
}

(async () => {
  console.log("[정상 삭제]");
  let r = await run();
  ok(
    r.rows.get("A").removed && r.rows.get("C").removed,
    "고른 행(A,C)만 제거된다",
  );
  ok(!r.rows.get("B").removed, "고르지 않은 행(B)은 그대로 남는다");
  ok(r.renderCalls === 0, `전체 재렌더를 하지 않는다 (${r.renderCalls}회)`);
  ok(
    !r.channels.has("A") && !r.channels.has("C") && r.channels.has("B"),
    "내부 목록에서도 고른 것만 빠진다",
  );
  ok(
    r.log.some((x) => x.startsWith("toast:")),
    "완료 안내가 나온다",
  );

  console.log("[삭제 중 표시]");
  r = await run({ fail: true });
  ok(!r.rows.get("A").removed, "실패하면 행을 없애지 않는다");
  ok(!r.rows.get("A")._cls.has("is-removing"), "숨김 표시를 되돌린다");
  ok(r.channels.has("A") && r.channels.has("C"), "내부 목록도 유지된다");
  ok(
    r.log.some((x) => x.includes("삭제하지 못했")),
    "실패를 알린다",
  );
  ok(r.renderCalls === 0, "실패해도 전체 재렌더는 안 한다");

  console.log("[전부 지웠을 때]");
  const rows = new Map([["A", makeRow("A")]]);
  const sandbox2 = {
    recapManageList: {
      innerHTML: "",
      querySelectorAll: () => [{ value: "A" }],
      querySelector: () => rows.get("A"),
    },
    recapManageDelete: mkBtn(),
    recapManageClear: { disabled: false },
    recapManageChannels: new Map([["A", {}]]),
    removeRecapChannels: async () => {},
    syncRecapManageButtons: () => {},
    settingsToast: () => {},
    renderRecapManage: () => {},
    CSS: { escape: (v) => v },
  };
  const n2 = Object.keys(sandbox2);
  new Function(...n2, handler)(...n2.map((k) => sandbox2[k]));
  await sandbox2.recapManageDelete.fire();
  ok(
    sandbox2.recapManageList.innerHTML.includes("저장된 채팅 기록이 없습니다"),
    "마지막 채널을 지우면 빈 안내로 바뀐다",
  );
  ok(
    sandbox2.recapManageClear.disabled === true,
    "전체 삭제 버튼이 비활성화된다",
  );

  console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
  process.exit(fails ? 1 : 0);
})();
