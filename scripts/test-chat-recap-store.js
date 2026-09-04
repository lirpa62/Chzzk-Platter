#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
require("../src/chatRecapStore.js");

const api = globalThis.CheeseChatRecapStore;
const values = Object.create(null);
const storage = {
  async get(keys) {
    const list =
      keys == null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      list
        .filter((key) => key in values)
        .map((key) => [key, structuredClone(values[key])]),
    );
  },
  async set(next) {
    Object.assign(values, structuredClone(next));
  },
  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
  },
};

const baseKey = `chatRecap:${"a".repeat(32)}:${"b".repeat(32)}:2026-08`;

async function appendRows(rows) {
  const state = await api.readForMerge(storage, baseKey, rows);
  state.items.push(...rows);
  await api.writeMerged(storage, state, state.items);
}

(async () => {
  // 기존 v1 단일 청크를 그대로 읽고, 처음 초과할 때만 v2 파트로 확장한다.
  values[baseKey] = {
    v: 1,
    at: 1,
    items: Array.from({ length: 5000 }, (_, index) => ({
      t: index + 1,
      m: `m${index + 1}`,
    })),
  };
  await appendRows([{ t: 5001, m: "m5001" }]);
  assert.equal(values[baseKey].v, 2);
  assert.equal(values[baseKey].parts, 1);
  assert.equal((await api.loadMonth(storage, baseKey)).length, 5001);

  // 여러 번 추가해도 파트 순서와 전체 건수를 유지한다.
  for (let batch = 0; batch < 7; batch += 1) {
    const start = 5002 + batch * 1000;
    await appendRows(
      Array.from({ length: 1000 }, (_, index) => ({
        t: start + index,
        m: `m${start + index}`,
      })),
    );
  }
  let rows = await api.loadMonth(storage, baseKey);
  assert.equal(rows.length, 12001);
  assert.equal(rows[0].t, 1);
  assert.equal(rows.at(-1).t, 12001);

  // 오래된 다시보기 보강은 모든 파트를 읽어 중복 행을 갱신한다.
  const historical = [{ t: 500, m: "m500", v: 7 }];
  const state = await api.readForMerge(storage, baseKey, historical);
  assert.equal(state.full, true);
  const target = state.items.find((row) => row.t === 500 && row.m === "m500");
  target.v = 7;
  await api.writeMerged(storage, state, state.items);
  rows = await api.loadMonth(storage, baseKey);
  assert.equal(rows.length, 12001);
  assert.equal(rows.find((row) => row.t === 500)?.v, 7);

  // 보관 기간 정리에 쓰는 키 파서가 파트에서도 원래 월을 복원한다.
  assert.deepEqual(api.parseKey(`${baseKey}:part:2`), {
    accountId: "a".repeat(32),
    channelId: "b".repeat(32),
    month: "2026-08",
    part: 2,
  });

  // 대량 가져오기에서도 입력 시각 탐색이 호출 스택 크기에 의존하지 않는다.
  const largeIncoming = Array.from({ length: 100_000 }, (_, index) => ({
    t: 20_000 + index,
    m: `large${index}`,
  }));
  const largeState = await api.readForMerge(storage, baseKey, largeIncoming);
  assert.equal(largeState.full, false);

  // 예전 다시보기 행은 재수집할 때 절대 시각이 조금 달라져도 영상·재생 위치·
  // 본문이 같으면 한 행으로 정리한다.
  const legacyVod = api.compactVodRows([
    { t: 1000, m: "같은 채팅", n: "123", v: 17 },
    { t: 1900, m: "같은 채팅", n: "123", v: 17 },
    { t: 2400, m: "같은 채팅", n: "123", v: 17, i: "id:one" },
  ]);
  assert.equal(legacyVod.changed, true);
  assert.equal(legacyVod.items.length, 1);
  assert.equal(legacyVod.items[0].i, "id:one");

  // 서버 메시지 ID가 서로 다르면 같은 초에 같은 문구를 보냈어도 보존한다.
  const distinctVod = api.compactVodRows([
    { t: 3000, m: "반복", n: "123", v: 20, i: "id:a" },
    { t: 3100, m: "반복", n: "123", v: 20, i: "id:b" },
  ]);
  assert.equal(distinctVod.changed, false);
  assert.equal(distinctVod.items.length, 2);

  // 완료된 영상을 다시 읽을 때 서버 ID가 달라져도 같은 위치의 행은 일대일로
  // 교체한다. 과거 재수집으로 불어난 행은 줄이되 실제 연속 입력 두 건은 보존한다.
  const reconciledVod = api.reconcileCompleteVodRows(
    [
      { t: 3000, m: "반복", n: "123", v: 20, i: "id:old-a" },
      { t: 3100, m: "반복", n: "123", v: 20, i: "id:old-b" },
      { t: 3200, m: "반복", n: "123", v: 20, i: "id:stale-a" },
      { t: 3300, m: "반복", n: "123", v: 20, i: "id:stale-b" },
      { t: 4000, m: "다른 영상", n: "456", v: 20, i: "id:other" },
    ],
    [
      { t: 3050, m: "반복", n: "123", v: 20, i: "id:new-a" },
      { t: 3150, m: "반복", n: "123", v: 20, i: "id:new-b" },
    ],
    "123",
  );
  assert.equal(reconciledVod.items.length, 3);
  assert.equal(
    reconciledVod.items.filter((row) => row.n === "123").length,
    2,
  );
  assert.deepEqual(
    reconciledVod.items
      .filter((row) => row.n === "123")
      .map((row) => row.i),
    ["id:new-a", "id:new-b"],
  );
  assert.equal(reconciledVod.added, 0);

  const repeatedReconcile = api.reconcileCompleteVodRows(
    reconciledVod.items,
    [
      { t: 3050, m: "반복", n: "123", v: 20, i: "id:new-a" },
      { t: 3150, m: "반복", n: "123", v: 20, i: "id:new-b" },
    ],
    "123",
  );
  assert.equal(repeatedReconcile.items.length, 3);
  assert.equal(repeatedReconcile.added, 0);

  // 다시보기와 연결된 결제 내역이 새 응답에서 빠지더라도 내역은 지우지 않고
  // 영상 연결만 해제한다.
  const preservedDonation = api.reconcileCompleteVodRows(
    [
      {
        t: 5000,
        m: "후원",
        n: "123",
        v: 30,
        i: "id:donation",
        d: { kind: "DONATION", src: "history", amount: 1000 },
      },
    ],
    [],
    "123",
  );
  assert.equal(preservedDonation.items.length, 1);
  assert.equal(preservedDonation.items[0].n, undefined);
  assert.equal(preservedDonation.items[0].d.amount, 1000);

  // 방장·매니저의 제목 변경 명령은 같은 제목의 성공 안내까지 확인된 경우만
  // 저장한다. API 페이지가 역순으로 들어와도 재생 위치순으로 판정해야 한다.
  const titleTracker = api.createVodTitleChangeTracker();
  titleTracker.add({
    content: "방송 제목이 변경되었습니다: [배그] 오늘도 치킨",
    playerMessageTime: 105_000,
    messageTime: 1_105_000,
  });
  titleTracker.add({
    content: "!방제변경 [배그]  오늘도 치킨",
    playerMessageTime: 100_000,
    messageTime: 1_100_000,
    profile: JSON.stringify({ userRoleCode: "streaming_channel_manager" }),
  });
  titleTracker.add({
    content: "!제목변경 실패할 제목",
    playerMessageTime: 200_000,
    messageTime: 1_200_000,
    profile: { userRoleCode: "streamer" },
  });
  titleTracker.add({
    content: "방송 제목이 변경되었습니다: 실패할 제목",
    playerMessageTime: 261_001,
    messageTime: 1_261_001,
  });
  titleTracker.add({
    content: "!방송제목변경 일반 시청자 제목",
    playerMessageTime: 300_000,
    messageTime: 1_300_000,
    profile: { userRoleCode: "common_user" },
  });
  titleTracker.add({
    content: "방송 제목이 변경되었습니다: 일반 시청자 제목",
    playerMessageTime: 301_000,
    messageTime: 1_301_000,
  });
  titleTracker.add({
    content: "방송 제목이 변경되었습니다: 같은 시각 제목",
    playerMessageTime: 400_000,
  });
  titleTracker.add({
    content: "!방재변경 같은 시각 제목",
    playerMessageTime: 400_000,
    profile: { userRoleCode: "streamer" },
  });
  assert.deepEqual(titleTracker.finish(), [
    { v: 105, t: 1_105_000, title: "[배그] 오늘도 치킨" },
    { v: 400, t: 0, title: "같은 시각 제목" },
  ]);

  await api.saveVodTitleChanges(storage, "123", titleTracker.finish());
  assert.deepEqual(await api.loadVodTitleChanges(storage, "123"), {
    complete: true,
    items: [
      { v: 105, t: 1_105_000, title: "[배그] 오늘도 치킨" },
      { v: 400, t: 0, title: "같은 시각 제목" },
    ],
  });

  console.log("chatRecapStore tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
