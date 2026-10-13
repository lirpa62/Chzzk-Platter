// 실시간 따라잡기·라이브 되감기/앞으로 버튼: 업데이트한 기존 이용자 중 버튼 순서·위치를 바꾼
// 적이 없는 사람만 한 번 숨김으로 바꾼다. 한 번만 하고, 새 설치는 표시만 남긴다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "src/background.js"), "utf8");
const start = source.indexOf('const LIVE_SEEK_BUTTONS_HIDDEN_ONCE_KEY =');
const end = source.indexOf("async function clearLegacyChatHistory()", start);
assert.ok(start >= 0 && end > start, "hideLiveSeekButtonsOnce 를 찾지 못했다");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

function make(initial) {
  const store = structuredClone(initial);
  const ctx = {
    chrome: { storage: { local: {
      get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
      set: async (value) => Object.assign(store, structuredClone(value)),
    } } },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.run = hideLiveSeekButtonsOnce;`, Object.assign(ctx, { globalThis: ctx }));
  return { store, run: ctx.run };
}

(async () => {
  // 1) 순서를 바꾼 적 없는 기존 이용자(예전 기본값 '표시'가 저장됨) → 숨김, 다른 설정은 그대로.
  {
    const { store, run } = make({ cheeseFeatureHidden: { liveSync: false, liveRewind: false, sidebar: true } });
    await run("update");
    check(store.cheeseFeatureHidden.liveSync === true && store.cheeseFeatureHidden.liveRewind === true &&
      store.cheeseFeatureHidden.sidebar === true && store.cheeseLiveSeekButtonsHiddenOnce === true,
      "순서·위치를 안 바꾼 기존 이용자: 따라잡기·되감기/앞으로를 숨기고 다른 설정은 그대로");
    // 그 뒤 다시 켜면 다음 업데이트에서 끄지 않는다.
    store.cheeseFeatureHidden.liveSync = false;
    await run("update");
    check(store.cheeseFeatureHidden.liveSync === false, "한 번만 한다(다시 켠 버튼은 다음 업데이트에서도 유지)");
  }
  // 2) 순서·위치를 바꾼 이용자 → 그대로.
  {
    const { store, run } = make({
      cheeseFeatureHidden: { liveSync: false, liveRewind: false },
      cheesePlayerButtonSide: { side: { rewind: "left" } },
    });
    await run("update");
    check(store.cheeseFeatureHidden.liveSync === false && store.cheeseFeatureHidden.liveRewind === false &&
      store.cheeseLiveSeekButtonsHiddenOnce === true,
      "버튼 순서·위치를 바꾼 이용자는 그대로 둔다(표시만 남김)");
  }
  // 3) 기능 설정을 한 번도 저장하지 않은 기존 이용자 → 숨김 값만 채운다.
  {
    const { store, run } = make({});
    await run("update");
    check(store.cheeseFeatureHidden.liveSync === true && store.cheeseFeatureHidden.liveRewind === true,
      "저장된 기능 설정이 없어도 숨김으로 둔다");
  }
  // 4) 새 설치 → 이미 기본 숨김. 표시만 남겨, 설치 후 켠 버튼을 다음 업데이트에서 끄지 않는다.
  {
    const { store, run } = make({});
    await run("install");
    check(store.cheeseFeatureHidden === undefined && store.cheeseLiveSeekButtonsHiddenOnce === true,
      "새 설치는 설정을 건드리지 않고 표시만 남긴다");
    store.cheeseFeatureHidden = { liveSync: false };
    await run("update");
    check(store.cheeseFeatureHidden.liveSync === false, "새 설치 후 켠 버튼은 업데이트해도 유지된다");
  }
  check(/await hideLiveSeekButtonsOnce\(details\.reason\);/.test(source), "설치·업데이트 때 실행한다");
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
