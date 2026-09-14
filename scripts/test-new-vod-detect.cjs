#!/usr/bin/env node
"use strict";
// 새 다시보기 탐지: 이미 가져온 영상이 목록 맨 위에 있어도 그 아래 새 영상을 찾는지.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "chatRecap.js"),
  "utf8",
);
const start = src.indexOf(
  "  async function fetchNewVideos(channelId, knownVideos) {",
);
const end =
  src.indexOf("\n  }\n", src.indexOf("return { ok: true, videos };", start)) +
  4;
const block = src.slice(start, end);
if (!block.trim()) throw new Error("fetchNewVideos 추출 실패");

let fails = 0;
const ok = (cond, message) => {
  console.log((cond ? "  PASS " : "  FAIL ") + message);
  if (!cond) fails++;
};

async function run(pages, known) {
  let calls = 0;
  const sandbox = {
    API_BASE: "https://x",
    VIDEO_PAGE_MAX: 100,
    NEW_VOD_SCAN_MAX: 500,
    yieldToUi: async () => {},
    fetch: async (url) => {
      calls += 1;
      const page = Number(new URL(url).searchParams.get("page"));
      const data = (pages[page] || []).map((no) => ({
        videoNo: no,
        videoType: "REPLAY",
      }));
      return {
        ok: true,
        json: async () => ({
          content: { data, totalPages: pages.length },
        }),
      };
    },
  };
  const names = Object.keys(sandbox);
  const fn = new Function(...names, `${block}\n return fetchNewVideos;`);
  const result = await fn(...names.map((name) => sandbox[name]))("ch", known);
  return { ...result, calls };
}

(async () => {
  console.log("[맨 위가 이미 가져온 영상일 때] 그 아래를 놓치지 않는다");
  // 최신 다시보기만 먼저 가져온 채널의 실제 목록 모양.
  const listed = [15171626, 15162182, 15156518, 15139705, 15092343, 15077013];
  const known = new Set(["15171626", "15139705"]);
  let result = await run([listed], known);
  ok(result.ok, "응답 ok");
  ok(result.videos.length === 4, `새 영상 4개 (${result.videos.length}개)`);
  for (const no of ["15162182", "15156518", "15092343", "15077013"]) {
    ok(result.videos.includes(no), `${no} 포함`);
  }
  ok(
    !result.videos.includes("15171626") && !result.videos.includes("15139705"),
    "이미 가져온 영상은 빠진다",
  );

  console.log("\n[요청 수] 페이지를 과도하게 넘기지 않는다");
  const full = (base) => Array.from({ length: 50 }, (_, k) => base + k);
  result = await run(
    [
      [1, 2, 3],
      [4, 5, 6],
    ],
    new Set(["2"]),
  );
  ok(
    result.calls === 1,
    `아는 영상을 만나면 다음 페이지로 안 넘어간다 (${result.calls}회)`,
  );
  ok(
    JSON.stringify(result.videos) === JSON.stringify(["1", "3"]),
    `같은 페이지는 끝까지 본다 (${result.videos})`,
  );
  result = await run([full(100), full(200), [300, 301]], new Set(["99"]));
  ok(result.calls === 3, `가득 찬 페이지는 계속 넘긴다 (${result.calls}회)`);
  result = await run([full(100), [200, 201]], new Set(["99"]));
  ok(result.calls === 2, `덜 찬 페이지에서 멈춘다 (${result.calls}회)`);
  result = await run(
    [
      [1, 2],
      [3, 4],
    ],
    new Set(),
  );
  ok(
    result.calls === 1,
    `아는 영상 목록이 비면 첫 페이지만 (${result.calls}회)`,
  );

  console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
  process.exit(fails ? 1 : 0);
})();
