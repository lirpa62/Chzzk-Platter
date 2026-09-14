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

console.log("[카탈로그] :part:N 청크를 놓치지 않는다");
const rebuild = src.slice(
  src.indexOf("  async function rebuildRecapCatalog(accountId, all) {"),
  src.indexOf("  const catalogKnown = new Set();"),
);
ok(
  /STORE_API\.parseKey\(key, STORE_PREFIX\)/.test(rebuild),
  "저장소와 같은 규칙으로 키를 읽는다",
);
// 주석에는 원인 설명으로 남아 있으므로 주석을 뺀 코드에서만 확인한다.
const rebuildCode = rebuild.replace(/\/\/[^\n]*/g, "");
ok(
  !/lastIndexOf/.test(rebuildCode),
  "코드에서 lastIndexOf 로 자르지 않는다(월이 '3' 으로 읽히던 원인)",
);

console.log("[목록] 카드 형태로 배치한다");
const css = fs.readFileSync(
  path.join(__dirname, "..", "src", "chatRecap.css"),
  "utf8",
);
ok(
  /\.crc-purge-list \{[^}]*display: grid/.test(css),
  "그리드로 한 줄에 여러 개를 놓는다",
);
ok(
  /grid-template-columns: repeat\(auto-fill, minmax\(92px, 1fr\)\)/.test(css),
  "폭에 따라 3~5개가 자동으로 깔린다",
);
ok(
  /\.crc-purge-list \{[^}]*align-items: start/.test(css),
  "행 높이가 늘어나지 않는다(여백 과다 방지)",
);
ok(
  /\.crc-purge-card \{[^}]*flex-direction: column/.test(css),
  "카드는 세로 배치다",
);
ok(/\.crc-purge-avatar \{/.test(css), "프로필 이미지를 넣는다");
ok(
  /\.crc-purge-detail \{[^}]*white-space: normal/.test(css),
  "개월·채팅 수는 한 줄로 자르지 않고 접는다",
);
ok(
  /\.crc-new-vod-recent \.lps-view-switch \{[^}]*display: flex/.test(css),
  "확인 대상 스위치는 flex 로 내용에 맞춘다",
);
ok(
  /avatar\.className = "crc-purge-avatar"/.test(src),
  "렌더에서 프로필을 만든다",
);
ok(/if \(info\.imageUrl\) \{/.test(src), "조회 결과의 프로필도 반영한다");

console.log("[모달 높이] 관리 탭에 바깥 스크롤이 생기지 않게 한다");
ok(
  /\.crc-import-modal-box \{[^}]*max-height: min\(820px/.test(css),
  "모달 높이를 올렸다(.crc-modal-box 의 680px max-height 를 함께 덮는다)",
);
ok(
  /\.crc-recap-purge \{[^}]*flex: 0 1 auto/.test(css),
  "기록 삭제 패널이 남는 높이를 억지로 차지하지 않는다",
);
ok(
  /\.crc-purge-list \{[^}]*flex: 0 0 auto/.test(css) &&
    !/\.crc-purge-list \{[^}]*min-height/.test(css),
  "목록에 최소 높이를 두지 않는다(카드가 적을 때 아래가 비지 않게)",
);
ok(
  /\.crc-purge-list \{[^}]*max-height: min\(321px, 32vh\)/.test(css),
  "목록은 카드 두세 줄까지 쓰고(화면이 낮으면 줄어든다) 그 이상은 스크롤한다",
);
ok(
  /:has\(\[data-import-panel="import"\]:not\(\[hidden\]\)\) \{[^}]*min\(680px/.test(
    css,
  ),
  "채팅 가져오기 탭 높이는 예전(680px) 그대로다",
);
ok(
  /\.crc-recap-purge \{[^}]*justify-content: flex-start/.test(css),
  "세로 배치에서 설명·목록·버튼이 위아래로 벌어지지 않는다",
);

console.log("[스켈레톤] 불러오는 동안 자리표시자를 깐다");
ok(
  /crc-purge-card is-skeleton/.test(src),
  "실제 카드와 같은 자리의 스켈레톤 카드를 만든다",
);
ok(
  !/list\.textContent = "불러오는 중…"/.test(src),
  "'불러오는 중' 글자 한 줄로 대신하지 않는다",
);
ok(
  /list\.setAttribute\("aria-busy", "true"\)/.test(src) &&
    /list\.removeAttribute\("aria-busy"\)/.test(src),
  "읽는 동안 aria-busy 로 알린다",
);
ok(
  /\.crc-skeleton-box,\s*\n\.crc-skeleton-line \{/.test(css),
  "스켈레톤 스타일이 있다",
);
ok(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?crc-skeleton/.test(css),
  "움직임 최소화 설정에서는 깜빡이지 않는다",
);

console.log("[버튼] 삭제 버튼을 붙여 둔다");
ok(
  /\.crc-purge-actions \{[^}]*gap: 6px/.test(css),
  "선택 삭제·전체 삭제가 붙어 있다",
);
ok(
  /\.crc-new-vod-actions \{[^}]*flex-wrap: wrap/.test(css),
  "확인 대상 줄이 한 줄로 넘치지 않는다",
);

console.log("[후보] 기록 갈래를 가리지 않는다");
const candidates = src.slice(
  src.indexOf("    // ⚠ byChannel 은 '일반 채팅'만 센다(appendRecapChunk)."),
  src.indexOf("    if (newVodRecentDays > 0) {"),
);
ok(
  /lastData\.items/.test(candidates) && /lastData\.donations/.test(candidates),
  "후원만 남긴 채널도 후보에 넣는다(byChannel 은 일반 채팅만 센다)",
);

console.log("[새 다시보기] 확인 대상 기간을 고를 수 있다");
ok(
  /const NEW_VOD_RECENT_DAYS_ALLOWED = \[3, 7, 0\];/.test(src),
  "선택지는 3일·7일·상관없음이다",
);
ok(/let newVodRecentDays = 7;/.test(src), "기본값은 7일이다");
ok(
  /const NEW_VOD_RECENT_KEY = "chatRecapNewVodRecentDays";/.test(src),
  "선택한 기간을 저장한다",
);
for (const value of ["3", "7", "0"]) {
  ok(
    new RegExp(`data-new-vod-recent="${value}"`).test(html),
    `관리 탭에 ${value === "0" ? "기간 없음" : `최근 ${value}일`} 버튼이 있다`,
  );
}
const filter = src.slice(
  src.indexOf("    if (newVodRecentDays > 0) {"),
  src.indexOf("    const channelIds = [...videosByChannel.keys()];"),
);
ok(Boolean(filter.trim()), "기간 필터 블록이 있다");
ok(
  /lastData\.items/.test(filter) && /lastData\.donations/.test(filter),
  "채팅과 후원 기록의 시각을 모두 본다",
);
ok(
  !/knownVideoChannels/.test(filter),
  "아는 영상이 있어도 기간을 벗어나면 뺀다(예외 없음)",
);
ok(
  /videosByChannel\.delete\(channelId\)/.test(filter),
  "기간을 벗어난 채널만 후보에서 뺀다",
);
ok(
  /await loadNewVodRecentDays\(\);/.test(
    src.slice(src.indexOf("    newVodChecking = true;")),
  ),
  "확인 직전에 저장값을 읽는다(첫 확인에도 적용된다)",
);
ok(
  /void checkNewVods\(\{ force: true, silent: true \}\);/.test(src),
  "기간을 바꾸면 캐시를 쓰지 않고 다시 확인한다",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
