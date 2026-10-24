// 설정 '클립·카페' 탭의 보관 개수 칸은 보관함을 다 읽기 전에 채운다.
//
// 예전에는 보관함 전체(계정별 목록, 최대 수만 개)를 읽은 뒤에야 개수 칸과 사용량을 함께 채웠다.
// 그래서 탭을 열어도 칸이 한동안 비어 있었다(헤드리스 실측, 즐겨찾기·좋아요 각 2만 개: 530~680ms,
// 다른 설정은 약 200ms). 지금은 개수는 설정 캐시에서 바로 채우고, 사용량 줄은 자리('…')만 잡아 두었다가
// 보관함을 읽은 뒤 채운다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settings = fs.readFileSync(path.join(__dirname, "..", "src/settings.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = settings.indexOf(`\n  async function ${name}(`) >= 0
    ? settings.indexOf(`\n  async function ${name}(`)
    : settings.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return settings.slice(at, settings.indexOf("\n  }\n", at) + 4);
};

(async () => {
  const log = [];
  let releaseVault;
  const vaultGate = new Promise((resolve) => { releaseVault = resolve; });
  const el = (name) => ({
    set value(v) { log.push(`${name}.value=${v}`); this._v = v; },
    get value() { return this._v; },
    set textContent(v) { log.push(`${name}.text=${v}`); this._t = v; },
    get textContent() { return this._t; },
    hidden: true, dataset: {}, disabled: false,
    closest: () => ({ classList: { toggle() {} } }),
  });
  const cvNum = el("input");
  const cvUsage = el("usage");
  const cvWarning = el("warning");
  const acc = "0123456789abcdef0123456789abcdef";
  const ctx = vm.createContext({
    cvNum, cvUsage, cvWarning, cvReset: null, log,
    document: { querySelector: () => ({ checked: true }) },
    storageCacheData: { cheeseClipVaultLimit: 1000, cheeseClipVaultActiveAccount: acc },
    chrome: { storage: { local: { get: async (key) => { log.push(`get ${key}`); await vaultGate; return { [key]: { fav: [1, 2, 3], like: [1] } }; } } } },
  });
  vm.runInContext(`
    const CLIP_VAULT_LIMIT_KEY = "cheeseClipVaultLimit";
    const CLIP_VAULT_KEY = "cheeseClipVault";
    const CLIP_VAULT_ACCOUNT_KEY_PREFIX = "cheeseClipVault:";
    const CLIP_VAULT_ACTIVE_ACCOUNT_KEY = "cheeseClipVaultActiveAccount";
    const CV_LIMIT_DEFAULT = 500, CV_LIMIT_MIN = 50, CV_LIMIT_MAX = 100000, CV_LARGE_LIMIT_NOTICE = 20000, CV_LIMIT_CAUTION_RATIO = 0.8;
    let cvCurrentVault = null; let cvCurrentAccountId = "";
    const cachedStorageGet = async (keys) => Object.fromEntries(keys.filter((k) => k in storageCacheData).map((k) => [k, storageCacheData[k]]));
    ${["normalizeCvAccountId", "cvAccountStorageKey", "normalizeCvLimit", "setCvLimitInputValue", "reflectCvAvailability", "clipVaultKindCount", "formatCvCount", "updateCvLimitStatus", "showCvUsageLoading", "loadCvVaultUsage"].map(sliceFn).join("\n")}
    this.load = loadCvVaultUsage;
  `, ctx);
  const done = ctx.load();
  await new Promise((resolve) => setTimeout(resolve, 20));
  check(log.includes("input.value=1,000") && log.includes(`get cheeseClipVault:${acc}`) &&
    log.indexOf("input.value=1,000") < log.indexOf(`get cheeseClipVault:${acc}`),
    `보관함을 읽기 전에 개수 칸을 채운다 ${JSON.stringify(log)}`);
  check(cvUsage.textContent === "현재 사용량 · 즐겨찾기 … / 1,000개 · 기록된 좋아요 … / 1,000개",
    `보관함을 읽는 동안 사용량 줄은 자리만 잡는다 ${JSON.stringify(cvUsage.textContent)}`);
  ctx.storageCacheData.cheeseClipVaultLimit = 2000; // 읽는 사이 개수를 바꿈
  releaseVault();
  await done;
  check(cvUsage.textContent === "현재 사용량 · 즐겨찾기 3 / 2,000개 · 기록된 좋아요 1 / 2,000개",
    `다 읽으면 실제 사용량을 채우고, 그사이 바꾼 개수를 쓴다 ${JSON.stringify(cvUsage.textContent)}`);
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
