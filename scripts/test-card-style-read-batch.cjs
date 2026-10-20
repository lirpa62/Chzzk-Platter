// 카드 버튼(재생목록·다시보기 보관함·클립 보관함)이 카드마다 쓰고-읽기를 번갈아 하지 않는지.
// 2026-10-20 CPU 프로필(실제 /videos, 사용자 설정, 스크롤 48초): ensurePlaylistCardButton 자체 시간
// 21.7초 — 카드마다 표시를 붙인(쓰기) 뒤 다음 카드의 getComputedStyle(읽기)을 불러, 읽을 때마다 문서
// 전체 스타일을 다시 계산했다. 위치는 쓰기 전에 한꺼번에(처음 보는 카드만) 읽게 고친 뒤 26초로 줄었다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");
const fn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, name);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};

for (const name of ["ensurePlaylistCardButton", "ensurePlaylistCardButtons", "ensureVideoVaultCardButtons", "ensureClipVaultCardButtons"]) {
  const body = fn(name);
  const calls = (body.match(/getComputedStyle\(/g) || []).length;
  assert.equal(calls, 0, `${name}: 카드마다 getComputedStyle 를 부르지 않는다(readStaticCardLinks 로 한꺼번에)`);
}
for (const name of ["ensurePlaylistCardButtons", "ensureVideoVaultCardButtons", "ensureClipVaultCardButtons"]) {
  const body = fn(name);
  const read = body.indexOf("readStaticCardLinks(");
  assert.ok(read > 0, `${name}: 위치를 한꺼번에 읽는다`);
  const firstWrite = body.search(/classList\.add\(|setAttribute\(|appendChild\(/);
  assert.ok(firstWrite < 0 || read < firstWrite, `${name}: 읽기가 첫 쓰기보다 먼저`);
}

// readStaticCardLinks 는 읽기만 한다.
{
  const src = fn("readStaticCardLinks");
  assert.ok(!/classList|setAttribute|appendChild|style\./.test(src.replace(/getComputedStyle\(link\)\.position/, "")), "읽기만");
  let reads = 0;
  class El {}
  const links = [new El(), new El(), new El()];
  const ctx = { HTMLElement: El, getComputedStyle: (el) => { reads += 1; return { position: el === links[1] ? "relative" : "static" }; } };
  vm.createContext(ctx);
  vm.runInContext(src + "\nthis.f = readStaticCardLinks;", ctx);
  const out = ctx.f(links);
  assert.equal(reads, 3);
  assert.ok(out.has(links[0]) && !out.has(links[1]) && out.has(links[2]));
}
// 다시보기 보관함: 이미 표시한 카드는 다시 읽지 않는다.
assert.ok(fn("ensureVideoVaultCardButtons").includes("cardLinks.filter((link) => !link.hasAttribute(VIDEO_VAULT_CARD_MARK))"));
assert.ok(fn("ensurePlaylistCardButtons").includes("!link.hasAttribute(PLAYLIST_CARD_MARK)"));
console.log("전부 통과");
