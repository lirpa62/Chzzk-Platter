// 채널 관리(Quick) 후보 목록 갱신 규칙.
//
// 열 때마다 첫 페이지를 새로 받고(캐시·이미 받은 목록을 건너뛴다), 열어 둔 동안은 팔로잉
// 목록만 주기적으로 새로 받는다. 같은 목록을 새로 받을 때는 로딩 화면으로 비우지 않는다.
// 다시 열 때 실제로 새 값이 보이는지는 test-multiview-page.cjs(브라우저)가 본다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const watch = fs.readFileSync(path.join(__dirname, "../src/multiviewWatch.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = watch.indexOf(`  function ${name}(`) >= 0
    ? watch.indexOf(`  function ${name}(`)
    : watch.indexOf(`  async function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return watch.slice(at, watch.indexOf("\n  }\n", at) + 4);
};

const open = sliceFn("openQuick");
check(/void loadQuickCandidates\(\{ refresh: true \}\);\s*startQuickRefresh\(\);/.test(open),
  "열 때마다 새로 받고 주기 갱신을 시작한다");
check(/stopQuickRefresh\(\);/.test(sliceFn("closeQuick")), "닫으면 주기 갱신을 멈춘다");

const rows = sliceFn("quickRows");
check((rows.match(/loadFirst\(force\)/g) || []).length === 6 && !/loadFirst\(\)/.test(rows) &&
  /if \(!force && cached && cached\.expiresAt > Date\.now\(\)\) return cached\.value;/.test(rows),
  "새로 받을 때는 모든 원천(팔로잉 캐시·라이브·검색·다시보기)을 건너뛴다");

// 주기 갱신: 팔로잉·전용 팔로잉만, 가려졌거나 받는 중이면 건너뛴다.
{
  const block = watch.slice(watch.indexOf("  const QUICK_REFRESH_MS ="), watch.indexOf("  // 교체 모드를 푼다."));
  let tick = null;
  const loads = [];
  const ctx = {
    window: { setInterval: (fn) => { tick = fn; return 1; } },
    clearInterval: () => { tick = null; },
    document: { hidden: false },
    $: () => ({ hidden: false }),
    quickLoading: false,
    quickSource: "following",
    loadQuickCandidates: (options) => loads.push(options),
  };
  vm.createContext(ctx);
  vm.runInContext(`${block}\nthis.start = startQuickRefresh;`, ctx);
  ctx.start();
  tick();
  check(loads.length === 1 && loads[0].refresh === true, "열어 둔 동안 팔로잉을 새로 받는다");
  for (const source of ["live", "search", "videos"]) {
    ctx.quickSource = source;
    tick();
  }
  check(loads.length === 1, "페이지를 이어 받는 원천(라이브·검색·다시보기)은 주기 갱신하지 않는다");
  ctx.quickSource = "custom";
  ctx.document.hidden = true;
  tick();
  ctx.document.hidden = false;
  ctx.quickLoading = true;
  tick();
  check(loads.length === 1, "탭이 가려졌거나 이미 받는 중이면 건너뛴다");
  ctx.quickLoading = false;
  tick();
  check(loads.length === 2, "전용 팔로잉도 주기 갱신한다");
  ctx.$ = () => ({ hidden: true });
  tick();
  check(tick === null && loads.length === 2, "패널이 닫혀 있으면 타이머를 스스로 멈춘다");
}

const load = sliceFn("loadQuickCandidates");
check(/const keepShown = refresh && quickCandidates !== null && quickCandidatesFor === key;/.test(load) &&
  /if \(!keepShown\) \{\s*quickCandidates = null;/.test(load) &&
  /if \(keepShown && error\) return;/.test(load),
  "같은 목록을 새로 받을 때는 비우지 않고, 실패하면 보이던 목록을 둔다");

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
