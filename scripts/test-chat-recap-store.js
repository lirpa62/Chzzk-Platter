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

  console.log("chatRecapStore tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
