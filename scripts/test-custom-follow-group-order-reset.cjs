// 전용 팔로잉 그룹의 '채널 순서 초기화'. 한 번 직접 정렬한 그룹은 되돌릴 방법이 없어
// 그룹을 지우고 다시 만들어야 했다. 직접 정렬 중인 그룹에만 초기화 버튼(확인 창)을 둔다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};

{
  const saved = [];
  let renders = 0;
  const ctx = {
    customFollowGroups: [
      { id: "g1", name: "A", channelIds: ["c", "a", "b"], manualOrder: true },
      { id: "g2", name: "B", channelIds: ["x"], manualOrder: false },
    ],
    customFollowGroupSortKey: "custom:g1",
    customFollowVersion: 0,
    CUSTOM_FOLLOW_GROUPS_KEY: "groups",
    chrome: { storage: { local: { set: (v) => saved.push(JSON.parse(JSON.stringify(v))) } } },
    ensureCustomFollowList: () => { renders += 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(sliceFn("resetCustomFollowGroupOrder") + "\nthis.reset=resetCustomFollowGroupOrder;", ctx);
  assert.equal(ctx.reset("custom:g1"), true);
  assert.equal(ctx.customFollowGroups[0].manualOrder, false, "직접 정렬을 푼다");
  assert.deepEqual(ctx.customFollowGroups[0].channelIds, ["c", "a", "b"], "그룹 구성원은 그대로 둔다");
  assert.equal(ctx.customFollowGroupSortKey, "", "그 그룹의 순서 편집 중이었으면 끝낸다");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].groups[0].manualOrder, false, "저장한다");
  assert.equal(renders, 1);
  assert.equal(ctx.reset("custom:g2"), false, "직접 정렬이 아닌 그룹은 그대로");
  assert.equal(ctx.reset("live"), false, "자동 그룹은 대상이 아니다");
  assert.equal(saved.length, 1);
}

// 버튼은 직접 정렬 중인 커스텀 그룹에만, 펼친 머리·간단 메뉴 모두에.
assert.match(content, /const canResetOrder = !group\.automatic && group\.manualOrder;/);
assert.match(content, /compactSortAction \+\n\s*compactResetAction \+/);
assert.match(content, /sortAction \+\n\s*resetAction \+/);
// 확인 창은 삭제와 같은 모양, 종류만 다르다.
assert.ok(content.includes('openCustomFollowGroupDeletePopover(groupOrderReset, "reset");'));
assert.ok(content.includes('data-cf-group-confirm-kind="${kind}"'));
assert.match(content, /if \(groupDeleteConfirm\.dataset\.cfGroupConfirmKind === "reset"\) \{\n\s*resetCustomFollowGroupOrder\(key\);/);
assert.ok(content.includes('!e.target.closest?.("[data-cf-group-order-reset]")'), "초기화 버튼을 누를 때 바깥 클릭으로 닫지 않는다");

console.log("전부 통과");
