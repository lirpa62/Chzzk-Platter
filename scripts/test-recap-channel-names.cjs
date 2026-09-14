#!/usr/bin/env node
"use strict";
// 저장된 기록 목록의 채널명 채우기(상세 API → 팔로잉·구독 폴백) 검증.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "settings.js"),
  "utf8",
);
const i = src.indexOf("  // 채널 상세 API 가 이름을 주지 않는 채널이 있다");
const j = src.indexOf("  async function removeRecapChannels(ids)");
const block = src.slice(i, j);

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "  PASS " : "  FAIL ") + m);
  if (!c) fails++;
};
const A = "a".repeat(32),
  B = "b".repeat(32),
  C = "c".repeat(32),
  D = "d".repeat(32);

function run({ detail, followings = [], subs = [], expired = [] }) {
  const painted = new Map();
  const calls = [];
  const spans = new Map([
    [A, {}],
    [B, {}],
    [C, {}],
    [D, {}],
  ]);
  const list = {
    isConnected: true,
    querySelector: (sel) => {
      const m = sel.match(/input\[value="acc:([a-f]+)"\]/);
      if (!m) return null;
      const id = m[1];
      return {
        parentElement: {
          querySelector: () => ({
            set textContent(v) {
              painted.set(id, v);
            },
            get textContent() {
              return painted.get(id) || "";
            },
          }),
        },
      };
    },
  };
  const sandbox = {
    recapManageList: list,
    CSS: { escape: (v) => v },
    fetch: async (url) => {
      calls.push(url);
      const dm = url.match(/service\/v1\/channels\/([0-9a-f]{32})$/);
      if (dm)
        return {
          ok: true,
          json: async () => ({ content: { channelName: detail[dm[1]] || "" } }),
        };
      if (url.includes("channels/followings"))
        return {
          ok: true,
          json: async () => ({
            content: {
              totalPage: 1,
              followingList: followings.map(([id, name]) => ({
                channel: { channelId: id, channelName: name },
              })),
            },
          }),
        };
      if (url.includes("subscribe/channels/expired"))
        return {
          ok: true,
          json: async () => ({
            content: expired.map(([id, name]) => ({
              channelId: id,
              channelName: name,
            })),
          }),
        };
      if (url.includes("subscribe/channels"))
        return {
          ok: true,
          json: async () => ({
            content: subs.map(([id, name]) => ({
              channelId: id,
              channelName: name,
            })),
          }),
        };
      return { ok: false };
    },
  };
  const names = Object.keys(sandbox);
  const fn = new Function(
    ...names,
    `${block}\n return decorateRecapManageNames;`,
  );
  const groups = [
    [`acc:${A}`, { channelId: A }],
    [`acc:${B}`, { channelId: B }],
    [`acc:${C}`, { channelId: C }],
    [`acc:${D}`, { channelId: D }],
  ];
  return fn(...names.map((n) => sandbox[n]))(groups).then(() => ({
    painted,
    calls,
  }));
}

(async () => {
  console.log("[상세 API 가 전부 답할 때]");
  let r = await run({
    detail: { [A]: "가나다", [B]: "라마바", [C]: "사아자", [D]: "차카타" },
  });
  ok(
    r.painted.get(A) === "가나다" && r.painted.get(D) === "차카타",
    "네 채널 모두 이름이 채워진다",
  );
  ok(
    !r.calls.some((u) => u.includes("followings")),
    "폴백 목록은 부르지 않는다",
  );

  console.log("[일부 채널이 이름을 안 줄 때]");
  r = await run({
    detail: { [A]: "가나다", [B]: "", [C]: "", [D]: "" },
    followings: [[B, "팔로잉이름"]],
    subs: [[C, "구독이름"]],
    expired: [[D, "과거구독이름"]],
  });
  ok(r.painted.get(A) === "가나다", "상세 API 성공분은 그대로");
  ok(r.painted.get(B) === "팔로잉이름", "팔로잉 목록으로 메운다");
  ok(r.painted.get(C) === "구독이름", "구독 목록으로 메운다");
  ok(r.painted.get(D) === "과거구독이름", "과거 구독 목록으로 메운다");

  console.log("[어디에도 없으면]");
  r = await run({ detail: { [A]: "" }, followings: [], subs: [], expired: [] });
  ok(!r.painted.get(A), "이름을 덮어쓰지 않는다(해시 표기 유지)");

  console.log("[개수 제한]");
  const many = Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [[A, B, C, D][i], "이름" + i]),
  );
  r = await run({ detail: many });
  ok(r.painted.size === 4, `40개 상한 없이 모두 처리 (${r.painted.size})`);

  console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
  process.exit(fails ? 1 : 0);
})();
