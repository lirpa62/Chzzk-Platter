// 설정 페이지가 읽는 저장 키는 모두 미리 읽기 목록(SETTINGS_STORAGE_KEYS)에 있어야 한다.
//
// cachedStorageGet 은 미리 읽은 캐시에서만 값을 꺼낸다. 목록에 없는 키는 빈 값이 돼
// 저장은 되는데 설정을 다시 열면 기본값으로 보였다(스크린샷 파일 이름·스크린샷 버튼 동작·
// 제외 필터 켜기/끄기). 켜기/끄기는 그 상태로 목록을 저장하면 꺼 둔 기록까지 지워졌다.
// 이 목록은 설정 내보내기·가져오기(SETTINGS_TRANSFER_KEYS)에도 쓰인다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/settings.js"), "utf8");
const listStart = source.indexOf("const SETTINGS_STORAGE_KEYS = [");
assert.ok(listStart >= 0, "SETTINGS_STORAGE_KEYS 를 찾지 못했다");
const listed = new Set(
  [...source.slice(listStart, source.indexOf("];", listStart)).matchAll(/"([^"]+)"/g)].map((m) => m[1]),
);
const constants = new Map();
for (const m of source.matchAll(/const ([A-Z0-9_]+) =\s*"([^"]+)";/g)) constants.set(m[1], m[2]);

const read = [];
for (const m of source.matchAll(/cachedStorageGet\(\s*(\[[\s\S]*?\]|[A-Za-z0-9_."]+)\s*\)/g)) {
  const arg = m[1];
  const items = arg.startsWith("[")
    ? arg.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean)
    : [arg];
  for (const item of items) {
    if (/^".*"$/.test(item)) read.push([item, item.slice(1, -1)]);
    else if (constants.has(item)) read.push([item, constants.get(item)]);
    // 그 밖(실행 중에 정해지는 변수)은 여기서 따지지 않는다.
  }
}
const missing = [...new Set(read.filter(([, key]) => !listed.has(key)).map(([name, key]) => `${name}=${key}`))];
assert.ok(read.length > 50, `읽는 키를 너무 적게 찾았다(${read.length}) — 검사식이 깨졌다`);
assert.deepEqual(missing, [], `미리 읽기 목록에 없는 키: ${missing.join(", ")}`);
for (const key of ["cheeseScreenshotNameFormat", "cheeseScreenshotAction", "cheeseLiveTagFiltersDisabled"]) {
  assert.ok(listed.has(key), `${key} 가 목록에 없다`);
}
console.log(`  PASS 설정 페이지가 읽는 저장 키 ${new Set(read.map(([, key]) => key)).size}개가 모두 미리 읽기 목록에 있다`);
console.log("전부 통과");
