// 멀티뷰 칸이 스스로 페이지를 다시 불러오지 않는지 확인한다.
//
// 칸이 부모 몰래 새로 불러오면 소리·화질·메인 지정이 한꺼번에 흐트러진다. 다시
// 불러오는 일은 부모가 사용자의 조작으로만 해야 한다. 그래서 두 가지를 본다.
//   1. 자동 새로고침 두 기능(오류 시 / 방종 후 뱅온)이 멀티뷰 칸에서는 감시를
//      아예 시작하지 않는다 → location.reload() 가 있는 폴링이 돌지 않는다.
//   2. 없어진 배치 id 가 저장돼 있어도 그 채널 수의 첫 배치로 되돌아간다.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const LAYOUTS = require(path.join(root, "src/multiviewLayouts.js"));

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};

console.log("[자동 새로고침] 멀티뷰 칸에서는 감시를 시작하지 않는다");
{
  // apply*() 안에서 막아야 init 과 storage.onChanged 양쪽이 함께 막힌다.
  // 어느 한쪽에만 두면 설정을 켜는 순간 감시가 되살아난다.
  for (const [fn, flag] of [
    ["applyAutoReloadOnError", "autoReloadOnError"],
    ["applyAutoReloadOnRelive", "autoReloadOnRelive"],
  ]) {
    const start = content.indexOf(`function ${fn}()`);
    ok(start > 0, `${fn} 이 있다`);
    const body = content.slice(start, content.indexOf("}", start));
    ok(
      body.includes(`${flag} && !IS_MULTIVIEW_FRAME`),
      `${fn} 이 멀티뷰 칸을 걸러 낸다`,
    );
  }
}

console.log("\n[reload 경로] location.reload() 는 막아 둔 폴링 안에만 있다");
{
  // 폴링 함수 밖에 reload 가 새로 생기면 여기서 잡힌다.
  const lines = content.split("\n");
  const reloadLines = [];
  lines.forEach((line, i) => {
    if (line.includes("location.reload()")) reloadLines.push(i + 1);
  });
  ok(reloadLines.length === 2, `reload 호출이 2곳이다 (${reloadLines})`);
  for (const at of reloadLines) {
    // 그 줄이 속한 함수를 위로 훑어 찾는다.
    let owner = "";
    for (let i = at - 1; i >= 0 && !owner; i -= 1) {
      const m = /^\s*(?:async\s+)?function\s+(\w+)/.exec(lines[i]);
      if (m) owner = m[1];
    }
    ok(
      owner === "autoReloadPoll" || owner === "autoRelivePoll",
      `${at}행의 reload 는 막아 둔 폴링(${owner}) 안에 있다`,
    );
  }
}

console.log("\n[탭 전환] visibilitychange 로 다시 불러오지 않는다");
{
  // 진단 기록은 남겨도 되지만, 거기서 reload 하거나 play() 를 억지로 부르면 안 된다.
  const start = content.indexOf("const traceLife =");
  ok(start > 0, "탭 전환 진단 기록이 있다");
  // 기록 블록만 본다(그 뒤의 소리 처리 코드까지 넘어가면 엉뚱한 것을 잡는다).
  const end = content.indexOf("let muteOverriddenByUser", start);
  ok(end > start, "진단 기록 블록의 끝을 찾았다");
  const block = content.slice(start, end);
  ok(!block.includes("location.reload"), "진단 기록이 다시 불러오지 않는다");
  ok(!/\.play\(\)/.test(block), "진단 기록이 재생을 억지로 부르지 않는다");
}

console.log("\n[없어진 배치] 저장된 id 를 못 찾으면 첫 배치로 되돌린다");
{
  // 3채널에서 뺀 L자 배치들이다. 예전 설정에 남아 있어도 화면이 깨지면 안 된다.
  for (const gone of ["right-bottom", "left-bottom", "right-top", "left-top"]) {
    ok(LAYOUTS.layoutById(gone) === null, `${gone} 은 이제 없다`);
  }
  for (let count = 2; count <= 6; count += 1) {
    const allowed = LAYOUTS.layoutsFor(count);
    ok(allowed.length > 0, `${count}채널에 쓸 배치가 있다`);
    const picked = allowed.find((l) => l.id === "right-bottom") || allowed[0];
    ok(
      LAYOUTS.layoutById(picked.id) !== null,
      `${count}채널: 없는 id 대신 ${picked.id} 로 되돌아간다`,
    );
  }
}

console.log("\n[모든 배치] 레터박스 없는 해가 있다");
{
  for (const layout of LAYOUTS.LAYOUTS) {
    ok(LAYOUTS.solveTracks(layout) !== null, `${layout.id}: 16:9 해가 있다`);
  }
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
