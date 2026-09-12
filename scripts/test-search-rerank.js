#!/usr/bin/env node
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const source = readFileSync(resolve(__dirname, "../src/content.js"), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness(live) {
  let keyword = "A";
  let mounted = true;
  let renders = 0;
  const requests = [];
  const prefix = live ? "SearchLiveRerank" : "SearchRerank";
  const stateKey = live ? "searchLiveRerankState" : "searchRerankState";
  const state = { keyword: "", fetchedFor: "", items: [], fetching: false, controller: null, sortedCache: null };
  const context = vm.createContext({ AbortController,
    [stateKey]: state,
    searchRerank: true, searchLiveRerank: true,
    SEARCH_RERANK_INITIAL: 6, SEARCH_LIVE_RERANK_INITIAL_FALLBACK: 6,
    SEARCH_RERANK_HIDDEN_CLASS: "hidden", SEARCH_LIVE_RERANK_HIDDEN_CLASS: "hidden-live",
    document: { querySelector: () => null, querySelectorAll: () => [] },
    getSearchRerankKeyword: () => keyword,
    findSearchVideoSection: () => mounted ? { querySelector: () => null } : null,
    findSearchLiveSection: () => mounted ? { querySelector: () => null } : null,
    findSearchLiveNativeList: () => ({ children: { length: 6 } }),
    [`fetch${prefix}Pool`]: (query, signal) => new Promise((resolve, reject) => requests.push({ query, signal, resolve, reject })),
    [`build${prefix}Scores`]: () => {},
    [`render${prefix}`]: () => renders++,
    [`normalize${prefix}Sort`]: (value) => value,
    searchRerankDefaultSort: "score", searchLiveRerankDefaultSort: "score",
  });
  vm.runInContext(section(`  function cleanup${prefix}()`, live ? "  function ensureSearchLiveRerank()" : "  // 피커 라벨"), context);
  vm.runInContext(section(`  function ensure${prefix}()`, live ? "  // ── 통합검색(/search) 클립 결과 보강" : "  // ── 통합검색(/search) 라이브 섹션"), context);
  return { state, requests, context, ensure: () => context[`ensure${prefix}`](),
    keyword: (value) => { keyword = value; }, mounted: (value) => { mounted = value; }, renders: () => renders };
}

for (const live of [false, true]) {
  const type = live ? "live" : "video";
  test(`${type}: A-B-A requests reject stale results and stale failures`, async () => {
    const h = harness(live);
    h.ensure();
    h.keyword("B"); h.ensure();
    assert.equal(h.requests[0].signal.aborted, true);
    h.requests[0].reject(Error("old failure"));
    await drain();
    assert.equal(h.state.fetching, true);
    h.keyword("A"); h.ensure();
    h.keyword("B"); h.ensure();
    h.requests[1].resolve([{ id: "old B" }]);
    h.requests[2].resolve([{ id: "old A" }]);
    await drain();
    assert.equal(h.state.fetching, true);
    assert.equal(h.renders(), 0);
    h.requests[3].resolve([{ id: "current B" }]);
    await drain();
    assert.equal(h.state.items[0].id, "current B");
    assert.equal(h.state.fetching, false);
    assert.equal(h.renders(), 1);
  });
  test(`${type}: empty and failed results do not refetch on every DOM update`, async () => {
    for (const error of [false, true]) {
      const h = harness(live);
      h.ensure(); h.ensure();
      assert.equal(h.requests.length, 1);
      if (error) h.requests[0].reject(Error("network"));
      else h.requests[0].resolve([]);
      await drain();
      for (let i = 0; i < 50; i++) h.ensure();
      assert.equal(h.requests.length, 1);
      assert.equal(h.renders(), 0);
      h.keyword("next"); h.ensure();
      assert.equal(h.requests.length, 2);
    }
  });
  test(`${type}: leaving search or disabling before cards mount aborts the request`, async () => {
    for (const mode of ["missingSection", "off"]) {
      const h = harness(live);
      h.ensure();
      if (mode === "missingSection") h.mounted(false);
      else h.context[live ? "searchLiveRerank" : "searchRerank"] = false;
      h.ensure();
      assert.equal(h.requests[0].signal.aborted, true);
      assert.equal(h.state.controller, null);
      assert.equal(h.state.fetching, false);
      h.requests[0].resolve([{ id: "late" }]);
      await drain();
      assert.equal(h.renders(), 0);
    }
  });
  test(`${type}: pagination passes abort signal and stops subsequent pages`, async () => {
    const controller = new AbortController();
    let calls = 0;
    const context = vm.createContext({
      ensureSearchRerankBlockedUsers: async () => {},
      searchRerankPoolMax: 200, normalizeSearchRerankPoolMax: (value) => value,
      SEARCH_LIVE_RERANK_POOL_MAX: 200, SEARCH_LIVE_RERANK_PAGE_SIZE: 50,
      isSearchRerankBlockedItem: (item) => item.blocked === true,
      normalizeSearchLiveItem: (item) => item,
      fetch: async (_, options) => {
        assert.equal(options.signal, controller.signal);
        calls++;
        return { ok: true, json: async () => {
          controller.abort();
          return { content: { data: [{ video: { videoNo: 1 }, channel: { channelId: "one" }, live: { liveId: 1 } }], page: { next: { offset: 50 } } } };
        } };
      },
    });
    const name = live ? "fetchSearchLiveRerankPool" : "fetchSearchRerankPool";
    vm.runInContext(section(`  async function ${name}(`, live ? "  function scoreSearchLiveRerankItem(" : "  function normalizeSearchRerankText("), context);
    assert.equal((await context[name]("test", controller.signal)).length, 0);
    assert.equal(calls, 1);
    await context[name]("test", controller.signal);
    assert.equal(calls, 1);
  });
  test(`${type}: sorted cache reuses results and invalidates on scores, mode or input`, () => {
    const state = { items: [{ __score: 1, __origIndex: 0 }, { __score: 2, __origIndex: 1 }], sort: "score" };
    const prefix = live ? "SearchLiveRerank" : "SearchRerank";
    const context = vm.createContext({
      [live ? "searchLiveRerankState" : "searchRerankState"]: state,
      normalizeSearchRerankText: (value) => value,
      [`score${prefix}Item`]: (item) => -item.__score,
    });
    vm.runInContext(section(`  function sorted${prefix}Items()`, live ? "  function searchLiveThumbnailUrl(" : "  function formatSearchRerankDuration("), context);
    vm.runInContext(section(`  function build${prefix}Scores(`, live ? "  function sortedSearchLiveRerankItems()" : "  // 재랭킹 정렬 옵션"), context);
    const sorted = context[`sorted${prefix}Items`];
    const first = sorted();
    for (let i = 0; i < 100; i++) assert.equal(sorted(), first);
    context[`build${prefix}Scores`](state.items, "query");
    assert.equal(sorted()[0].__origIndex, 0);
    assert.notEqual(sorted(), first);
    state.sort = "original";
    assert.equal(sorted()[0].__origIndex, 0);
    state.items = [];
    assert.equal(sorted().length, 0);
  });
}

test("more label preserves icons and does not rewrite unchanged text", () => {
  let writes = 0;
  const icon = { nodeType: 1 };
  const button = {
    childNodes: [icon], querySelector: () => icon,
    insertBefore(node, before) {
      writes++;
      const index = this.childNodes.indexOf(before);
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    },
  };
  const context = vm.createContext({ Node: { TEXT_NODE: 3 }, document: {
    createTextNode: (textContent) => ({ nodeType: 3, textContent,
      remove() { writes++; button.childNodes.splice(button.childNodes.indexOf(this), 1); },
    }),
  } });
  vm.runInContext(section("  function setSearchRerankMoreLabel(", "  function updateSearchRerankPicker("), context);
  for (let i = 0; i < 100; i++) context.setSearchRerankMoreLabel(button, "more (10)");
  assert.equal(writes, 1);
  context.setSearchRerankMoreLabel(button, "collapse");
  assert.equal(writes, 3);
  assert.equal(button.childNodes[0].textContent, "collapse");
  assert.equal(button.childNodes[1], icon);
});
