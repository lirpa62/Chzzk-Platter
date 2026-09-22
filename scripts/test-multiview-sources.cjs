const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SOURCES = require("../src/multiviewSources.js");

const id = (n) => n.toString(16).padStart(32, "0");
const row = (n) => ({ channelId: id(n), channelName: `채널${n}` });

async function withApi(handler, run) {
  const previous = global.chrome;
  global.chrome = { runtime: { sendMessage: async ({ url }) => {
    const content = await handler(new URL(url));
    return { ok: true, content };
  } } };
  try { return await run(); } finally { global.chrome = previous; }
}

async function test(name, run) {
  await run();
  console.log(`  PASS ${name}`);
}

(async () => {
  await test("첫 페이지와 다음 커서를 저장한다", async () => {
    const pager = SOURCES.createLivePager({
      fetchPage: async () => ({ rows: [row(1), row(2)], next: {
        concurrentUserCount: 20, liveId: 200,
      } }),
    });
    const state = await pager.loadFirst();
    assert.deepEqual(state.rows.map((item) => item.channelId), [id(1), id(2)]);
    assert.deepEqual(pager.next, { concurrentUserCount: "20", liveId: "200" });
    assert.equal(pager.done, false);
  });

  await test("다음 페이지는 순서를 유지하며 channelId 중복을 제거한다", async () => {
    let page = 0;
    const pager = SOURCES.createLivePager({ fetchPage: async (cursor) => {
      page += 1;
      if (!cursor) return { rows: [row(1), row(2)], next: {
        concurrentUserCount: 10, liveId: 100,
      } };
      return { rows: [row(2), row(3)], next: null };
    } });
    await pager.loadFirst();
    await pager.loadNext();
    assert.equal(page, 2);
    assert.deepEqual(pager.rows.map((item) => item.channelId), [id(1), id(2), id(3)]);
    assert.equal(pager.done, true);
    await pager.loadNext();
    assert.equal(page, 2, "마지막 페이지 뒤에 다시 요청했다");
  });

  await test("서버가 같은 커서를 반복하면 추가 요청을 멈춘다", async () => {
    let calls = 0;
    const cursor = { concurrentUserCount: 10, liveId: 100 };
    const pager = SOURCES.createLivePager({ fetchPage: async () => {
      calls += 1;
      return { rows: [row(calls)], next: cursor };
    } });
    await pager.loadFirst();
    await pager.loadNext();
    assert.equal(pager.done, true);
    await pager.loadNext();
    assert.equal(calls, 2);
  });

  await test("빈 첫 페이지도 다음 커서가 있으면 다음 페이지로 간다", async () => {
    const cursors = [];
    const pager = SOURCES.createLivePager({ fetchPage: async (cursor) => {
      cursors.push(cursor);
      return cursor
        ? { rows: [row(1)], next: null }
        : { rows: [], next: { concurrentUserCount: 10, liveId: 100 } };
    } });
    await pager.loadFirst();
    await pager.loadFirst();
    await pager.loadNext();
    assert.deepEqual(cursors, [null, { concurrentUserCount: "10", liveId: "100" }]);
    assert.deepEqual(pager.rows.map((item) => item.channelId), [id(1)]);
  });

  await test("동시에 누른 loadNext는 한 요청만 공유한다", async () => {
    let resolveNext;
    let calls = 0;
    const pager = SOURCES.createLivePager({ fetchPage: async (cursor) => {
      calls += 1;
      if (!cursor) return { rows: [row(1)], next: {
        concurrentUserCount: 9, liveId: 90,
      } };
      return new Promise((resolve) => { resolveNext = resolve; });
    } });
    await pager.loadFirst();
    const one = pager.loadNext();
    const two = pager.loadNext();
    assert.equal(one, two);
    resolveNext({ rows: [row(2)], next: null });
    await Promise.all([one, two]);
    assert.equal(calls, 2);
  });

  await test("stale 응답은 새로 고친 pager를 덮지 않는다", async () => {
    const pending = [];
    const pager = SOURCES.createLivePager({ fetchPage: () =>
      new Promise((resolve) => pending.push(resolve)) });
    const oldRequest = pager.loadFirst();
    const newRequest = pager.loadFirst(true);
    pending[1]({ rows: [row(2)], next: null });
    await newRequest;
    pending[0]({ rows: [row(1)], next: null });
    await oldRequest;
    assert.deepEqual(pager.rows.map((item) => item.channelId), [id(2)]);
  });

  await test("다음 페이지 실패는 기존 목록을 보존하고 재시도할 수 있다", async () => {
    let nextAttempts = 0;
    const pager = SOURCES.createLivePager({ fetchPage: async (cursor) => {
      if (!cursor) return { rows: [row(1)], next: {
        concurrentUserCount: 8, liveId: 80,
      } };
      nextAttempts += 1;
      if (nextAttempts === 1) throw new Error("temporary");
      return { rows: [row(2)], next: null };
    } });
    await pager.loadFirst();
    await pager.loadNext();
    assert.deepEqual(pager.rows.map((item) => item.channelId), [id(1)]);
    assert.match(String(pager.error), /temporary/);
    await pager.loadNext();
    assert.deepEqual(pager.rows.map((item) => item.channelId), [id(1), id(2)]);
  });

  await test("TTL 만료 뒤 첫 페이지를 새로 고친다", async () => {
    let now = 100;
    let calls = 0;
    const pager = SOURCES.createLivePager({ ttlMs: 20, now: () => now,
      fetchPage: async () => ({ rows: [row(++calls)], next: null }) });
    await pager.loadFirst();
    await pager.loadFirst();
    assert.equal(calls, 1);
    now = 121;
    await pager.loadFirst();
    assert.equal(calls, 2);
    assert.deepEqual(pager.rows.map((item) => item.channelId), [id(2)]);
  });

  await test("실제 커서 필드만 URLSearchParams로 이스케이프한다", async () => {
    const url = new URL(SOURCES.livePageUrl({
      concurrentUserCount: "12&unexpected=1",
      liveId: "345",
      ignored: "value",
    }));
    assert.equal(url.searchParams.get("concurrentUserCount"), "12&unexpected=1");
    assert.equal(url.searchParams.get("liveId"), "345");
    assert.equal(url.searchParams.has("unexpected"), false);
    assert.equal(url.searchParams.has("ignored"), false);
  });

  await test("연령 제한 값은 방송 정보와 팔로잉 행 어디에 있어도 보존한다", async () => {
    assert.equal(SOURCES.normalize(row(1), { adult: true }).adult, true);
    assert.equal(SOURCES.normalize(row(1), { adult: "TRUE" }).adult, true);
    assert.equal(SOURCES.normalize(row(1), { adult: false }, { adult: true }).adult, true);
    assert.equal(SOURCES.normalize({ ...row(1), adult: true }, {}).adult, true);
    assert.equal(SOURCES.normalize(row(1), { adult: "false" }).adult, false);
    const following = await withApi(() => ({ followingList: [{
      channelId: id(1), channel: row(1), streamer: { openLive: true },
      adult: true, liveInfo: { liveTitle: "연령 제한 방송", adult: false },
    }] }), () => SOURCES.loadFollowing());
    assert.equal(following[0].adult, true);
    const live = await SOURCES.loadLivePage(null, async () => ({ data: [{
      channel: row(2), liveTitle: "연령 제한 방송", adult: "true",
    }] }));
    assert.equal(live.rows[0].adult, true);
  });

  await test("태그 검색은 # 한 개를 벗기고 첫 20개를 조회한다", async () => {
    const urls = [];
    await withApi((url) => { urls.push(url); return { data: [] }; }, async () => {
      await SOURCES.searchLiveTags("  #봉누도  ");
      await SOURCES.searchLiveTags("#");
    });
    assert.equal(urls.length, 1);
    assert.equal(urls[0].pathname, "/service/v1/tag/lives");
    assert.equal(urls[0].searchParams.get("size"), "20");
    assert.equal(urls[0].searchParams.get("sortType"), "POPULAR");
    assert.equal(urls[0].searchParams.get("tags"), "봉누도");
  });

  await test("태그 라이브 행을 공용 형태로 정규화한다", async () => {
    const found = await withApi(() => ({ data: [{
      channel: { channelId: id(1), channelName: "채널", channelImageUrl: "https://example.com/a" },
      liveTitle: "합방", liveCategoryValue: "게임", tags: ["봉누도", "서버"],
      liveImageUrl: "https://example.com/{type}.jpg", concurrentUserCount: 120,
    }, { channel: { channelId: "invalid" }, liveTitle: "제외" }] }),
    () => SOURCES.searchLiveTags("봉누도"));
    assert.equal(found.length, 1);
    assert.equal(found[0].channelId, id(1));
    assert.equal(found[0].category, "게임");
    assert.deepEqual(found[0].tags, ["봉누도", "서버"]);
    assert.equal(found[0].liveImageUrl, "https://example.com/480.jpg");
  });

  await test("채널 검색 순서를 유지하며 중복 태그 메타데이터를 보완한다", async () => {
    const merged = SOURCES.mergeSearchRows([
      { ...row(1), tags: [], category: "", viewers: 0 },
      { ...row(2), tags: [], category: "" },
    ], [
      { ...row(2), tags: ["봉누도"], category: "게임" },
      { ...row(3), tags: ["합방"] },
    ]);
    assert.deepEqual(merged.map((item) => item.channelId), [id(1), id(2), id(3)]);
    assert.deepEqual(merged[1].tags, ["봉누도"]);
    assert.equal(merged[1].category, "게임");
  });

  await test("한 검색 경로가 실패해도 다른 경로 결과를 보여 준다", async () => {
    const channel = { channelId: id(1), channelName: "채널", openLive: true };
    const tagRow = { channel: { channelId: id(2), channelName: "태그채널" }, liveTitle: "라이브" };
    const run = (failedPath) => withApi((url) => {
      if (url.pathname === failedPath) throw new Error("temporary");
      if (url.pathname === "/service/v1/search/channels") return { data: [{ channel }] };
      if (url.pathname.endsWith("/live-detail")) return { status: "OPEN", channel, liveTitle: "방송" };
      return { data: [tagRow] };
    }, () => SOURCES.searchLive("봉누도"));
    assert.deepEqual((await run("/service/v1/tag/lives")).map((item) => item.channelId), [id(1)]);
    assert.deepEqual((await run("/service/v1/search/channels")).map((item) => item.channelId), [id(2)]);
    await assert.rejects(() => withApi(() => { throw new Error("failed"); },
      () => SOURCES.searchLive("봉누도")), /검색 요청 실패/);
  });

  await test("배경 중계는 확인된 라이브 커서 키만 허용한다", async () => {
    const background = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
    const start = background.indexOf("function validMultiviewApiQuery(url) {");
    const end = background.indexOf("\nasync function fetchMultiviewApi", start);
    assert.ok(start >= 0 && end > start, "멀티뷰 URL 검증 함수를 찾지 못했다");
    const valid = vm.runInNewContext(`${background.slice(start, end)}\nvalidMultiviewApiQuery`);
    const base = "https://api.chzzk.naver.com/service/v1/lives?size=40";
    assert.equal(valid(new URL(base)), true);
    assert.equal(valid(new URL(`${base}&concurrentUserCount=20&liveId=123`)), true);
    assert.equal(valid(new URL(`${base}&unexpected=1`)), false);
    assert.equal(valid(new URL(`${base}&liveId=123`)), false);
    assert.equal(valid(new URL(`${base}&concurrentUserCount=20&liveId=123&liveId=124`)), false);
    assert.equal(valid(new URL(`${base}&concurrentUserCount=20%26x%3D1&liveId=123`)), false);
    const tag = "https://api.chzzk.naver.com/service/v1/tag/lives?size=20&sortType=POPULAR&tags=%EB%B4%89%EB%88%84%EB%8F%84";
    assert.equal(valid(new URL(tag)), true);
    assert.equal(valid(new URL(tag.replace("&tags=", "&unexpected=1&tags="))), false);
    assert.equal(valid(new URL(tag.replace("POPULAR", "LATEST"))), false);
    assert.equal(valid(new URL(tag.replace(/&tags=.*/, ""))), false);
    assert.equal(valid(new URL(`${tag}&tags=duplicate`)), false);
    assert.match(background, /url\.origin !== MULTIVIEW_API_ORIGIN/);
    assert.match(background, /!MULTIVIEW_API_PATHS\.has\(url\.pathname\)/);
  });

  console.log("\n멀티뷰 라이브 pager 검증 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
