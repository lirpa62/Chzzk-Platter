#!/usr/bin/env node
"use strict";
// 리캡 페이지: 저장된 기록 삭제와 새 다시보기 감지 대상 좁히기 검증.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "src", "chatRecap.js"),
  "utf8",
);
const html = fs.readFileSync(
  path.join(__dirname, "..", "chatRecap.html"),
  "utf8",
);

let fails = 0;
const ok = (cond, message) => {
  console.log((cond ? "  PASS " : "  FAIL ") + message);
  if (!cond) fails++;
};

console.log("[삭제 UI] 관리 탭에 있다");
ok(/id="crcPurgeList"/.test(html), "목록 컨테이너가 있다");
ok(/id="crcPurgeSelected"/.test(html), "선택 삭제 버튼이 있다");
ok(/id="crcPurgeAll"/.test(html), "전체 삭제 버튼이 있다");
const managePanel = html.slice(
  html.indexOf('data-import-panel="manage"'),
  html.indexOf("crc-modal-progress"),
);
ok(/id="crcPurgeList"/.test(managePanel), "다시보기 관리 탭 안에 있다");

console.log("[삭제] 세 갈래를 함께 지운다");
const purge = src.slice(
  src.indexOf("  async function purgeRecapChannels(ids)"),
  src.indexOf("  // ⚠ 선택 삭제는 목록 전체를 다시 그리지 않는다."),
);
ok(
  /chrome\.storage\.local\.remove\(keys\)/.test(purge),
  "본문·통계 키를 지운다",
);
ok(/chatRecapCatalog:\$\{accountId\}/.test(purge), "카탈로그에서도 뺀다");
ok(
  !/try\s*\{\s*await chrome\.storage\.local\.remove\(keys\)/.test(purge),
  "본문 삭제 실패를 삼키지 않는다",
);

console.log("[선택 삭제] 전체를 다시 그리지 않는다");
const handler = src.slice(
  src.indexOf('$("crcPurgeSelected")?.addEventListener'),
  src.indexOf('$("crcPurgeAll")?.addEventListener'),
);
ok(/is-removing/.test(handler), "고른 행만 먼저 흐리게 한다");
ok(
  /rows\.forEach\(\(row\) => row\.remove\(\)\)/.test(handler),
  "그 행만 없앤다",
);
ok(!/renderPurgeList\(\)/.test(handler), "전체 목록을 다시 그리지 않는다");
ok(
  /rows\.forEach\(\(row\) => row\.classList\.remove\("is-removing"\)\)/.test(
    handler,
  ),
  "실패하면 숨김을 되돌린다",
);

console.log("[전체 삭제] 두 번 눌러야 하고 표식까지 비운다");
const clearAll = src.slice(
  src.indexOf('$("crcPurgeAll")?.addEventListener'),
  src.indexOf("  function openImportModal()"),
);
ok(/dataset\.armed/.test(clearAll), "한 번 더 눌러야 실행한다");
ok(/chatRecapImportedVideos/.test(clearAll), "가져오기 완료 표식도 비운다");

console.log("[성능] 관리 탭을 볼 때만 저장소를 훑는다");
ok(
  /if \(importModalTab === "manage"\) void renderPurgeList\(\);/.test(src),
  "모달을 열 때마다 전수 조회하지 않는다",
);

console.log("[새 다시보기] 최근 채팅이 있는 채널만 확인한다");
ok(
  /const NEW_VOD_RECENT_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000;/.test(src),
  "기준이 일주일이다",
);
const check = src.slice(
  src.indexOf(
    "    const recentCutoff = Date.now() - NEW_VOD_RECENT_WINDOW_MS;",
  ),
  src.indexOf("    const channelIds = [...videosByChannel.keys()];"),
);
ok(
  /lastData\.items/.test(check) && /lastData\.donations/.test(check),
  "채팅과 후원 기록의 시각을 모두 본다",
);
ok(
  /knownVideoChannels\.has\(channelId\)\) continue;/.test(check),
  "이미 아는 영상이 있는 채널은 남긴다(가져오다 만 경우)",
);
ok(
  /videosByChannel\.delete\(channelId\)/.test(check),
  "오래된 채널만 후보에서 뺀다",
);
ok(
  /최근 일주일 안에 채팅한 스트리머/.test(html) &&
    /최근 일주일 안에 채팅한 스트리머/.test(src),
  "안내 문구도 기준에 맞췄다",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
