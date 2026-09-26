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
  await test("401 응답만 로그인 필요로 구분한다", async () => {
    assert.equal(SOURCES.isLoginRequiredError(new Error("HTTP 401")), true);
    assert.equal(SOURCES.isLoginRequiredError(new Error("HTTP 403")), false);
    assert.equal(SOURCES.isLoginRequiredError(new Error("HTTP 500")), false);
  });

  await test("프로필 이미지는 작은 리사이즈본을 요청한다", async () => {
    const original = "https://nng-phinf.pstatic.net/profile.png?type=f120_120_na&v=1";
    const avatar = new URL(SOURCES.profileThumb(original));
    assert.equal(avatar.searchParams.get("type"), "f60_60_na");
    assert.equal(avatar.searchParams.get("v"), "1");
    assert.equal(new URL(SOURCES.profileThumb(original, 240)).searchParams.get("type"), "f240_240_na");
    assert.equal(SOURCES.profileThumb("javascript:alert(1)"), "");
  });

  await test("다시보기 지표 포맷은 조회수·재생 시간·상대 시각을 처리한다", async () => {
    assert.equal(SOURCES.formatCompactCount(12345), "1.2만");
    assert.equal(SOURCES.formatVideoDuration(28020), "7:47:00");
    assert.equal(SOURCES.formatVideoDuration(466), "7:46");
    assert.equal(SOURCES.formatRelativeTime(1_000_000_000_000, 1_000_000_120_000), "2분 전");
  });

  await test("재정렬 컨트롤은 기존 검색 클래스와 설정 항목을 제공한다", async () => {
    const markup = SOURCES.videoSearchControlsMarkup("setup");
    assert.match(markup, /cheese-search-control cheese-search-sort-trigger/);
    assert.match(markup, /class="cheese-search-options"/);
    assert.match(markup, /data-video-rerank-pool/);
    assert.match(markup, /data-video-rerank-default-sort="score"/);
    assert.match(markup, /라이브 시청자/);
  });

  await test("공용 정렬은 시청자·이름·시작 시각·원본 순서를 구분한다", async () => {
    const rows = [
      { ...row(1), channelName: "가", viewers: 10, openedAt: 200, recommendationRank: 2 },
      { ...row(2), channelName: "다", viewers: 30, openedAt: 100, recommendationRank: 0 },
      { ...row(3), channelName: "나", viewers: 20, openedAt: 0, recommendationRank: 1 },
    ];
    const ids = (mode) => SOURCES.sortRows(rows, mode).map((item) => item.channelId);
    assert.deepEqual(ids("viewers"), [id(2), id(3), id(1)]);
    assert.deepEqual(ids("viewers-asc"), [id(1), id(3), id(2)]);
    assert.deepEqual(ids("name-asc"), [id(1), id(3), id(2)]);
    assert.deepEqual(ids("name-desc"), [id(2), id(3), id(1)]);
    assert.deepEqual(ids("recent"), [id(1), id(2), id(3)]);
    assert.deepEqual(ids("oldest"), [id(2), id(1), id(3)]);
    assert.deepEqual(ids("recommended"), [id(2), id(3), id(1)]);
    assert.deepEqual(ids("custom"), [id(1), id(2), id(3)]);
    assert.deepEqual(rows.map((item) => item.channelId), [id(1), id(2), id(3)]);
    assert.equal(SOURCES.normalize(row(1), { openDate: "2026-09-24 10:30:00" }).openedAt,
      new Date("2026-09-24T10:30:00").getTime());
    assert.equal(SOURCES.normalize(row(1), { openDate: "invalid" }).openedAt, 0);
  });

  await test("저장된 즐겨찾기·그룹 순서가 커스텀 정렬로 제공된다", async () => {
    await withApi((url) => ({ followingList: (url.searchParams.get("sortType") === "OLDEST"
      ? [2, 1, 3] : [1, 2, 3]).map((n) => ({
      channelId: id(n), channel: row(n), streamer: { openLive: true },
      liveInfo: { liveTitle: `방송${n}`, concurrentUserCount: n * 10 },
    })) }), async () => {
      global.chrome.storage = { local: { get: async () => ({
        cheeseFollowFavorites: [id(1), id(2)],
        cheeseFollowFavOrder: [id(2), id(1)],
        cheeseFollowCustomGroups: [{ id: "g1", name: "친구", manualOrder: true,
          channelIds: [id(3)] }],
      }) } };
      const sections = await SOURCES.loadCustomSections();
      assert.deepEqual(sections[0].rows.map((item) => item.channelId), [id(2), id(1)]);
      assert.equal(SOURCES.hasCustomOrder(sections, "fav"), true);
      assert.equal(SOURCES.hasCustomOrder(sections, "group:g1"), true);
      assert.equal(SOURCES.hasCustomOrder(sections, "rest"), false);
      assert.deepEqual(SOURCES.sortSections(sections, "custom")[0].rows,
        sections[0].rows);
      const latest = await SOURCES.loadCustomSections("LATEST");
      assert.deepEqual(SOURCES.sortSections(latest, "recent", true)[0].rows
        .map((item) => item.channelId), [id(1), id(2)],
      "시작 시각이 없어도 API 최신순이 수동 즐겨찾기 순서를 대체해야 한다");
      const oldest = await SOURCES.loadCustomSections("OLDEST");
      assert.deepEqual(SOURCES.sortSections(oldest, "oldest", true)[0].rows
        .map((item) => item.channelId), [id(2), id(1)]);
    });
  });

  await test("친밀도 구역의 점수 순서는 커스텀 정렬로 취급한다", async () => {
    const previousAffinity = global.CheeseChannelAffinity;
    const previousData = global.CheeseChannelAffinityData;
    try {
      global.CheeseChannelAffinity = { scoreChannels: () => [
        { channelId: id(2) }, { channelId: id(1) },
      ] };
      global.CheeseChannelAffinityData = { collectMetrics: async () => ({}) };
      await withApi(() => ({ followingList: [1, 2].map((n) => ({
        channelId: id(n), channel: row(n), streamer: { openLive: true },
        liveInfo: { liveTitle: `방송${n}` },
      })) }), async () => {
        global.chrome.storage = { local: { get: async (keys) =>
          keys === "cheeseFollowAffinityOn" ? { cheeseFollowAffinityOn: true } : {} } };
        const sections = await SOURCES.loadCustomSections();
        const affinity = sections.find((section) => section.id === "affinity");
        assert.ok(affinity);
        assert.equal(SOURCES.hasCustomOrder(sections, "affinity"), true);
        assert.deepEqual(affinity.rows.map((item) => item.channelId), [id(2), id(1)]);
      });
    } finally {
      global.CheeseChannelAffinity = previousAffinity;
      global.CheeseChannelAffinityData = previousData;
    }
  });

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

  await test("정렬별 라이브 요청은 동일한 커서 필드와 정렬값을 유지한다", async () => {
    for (const [mode, sortType] of Object.entries({
      viewers: "POPULAR", "viewers-asc": "UNPOPULAR",
      recent: "LATEST", recommended: "RECOMMEND",
    })) {
      assert.equal(SOURCES.serverSortType("all", mode), sortType);
      assert.equal(SOURCES.serverSortType("live", mode), sortType);
      const url = new URL(SOURCES.livePageUrl({ concurrentUserCount: 787,
        liveId: 21261965 }, sortType));
      assert.equal(url.searchParams.get("sortType"), sortType);
      assert.equal(url.searchParams.get("concurrentUserCount"), "787");
      assert.equal(url.searchParams.get("liveId"), "21261965");
      assert.equal(url.searchParams.get("size"), "40");
      const calls = [];
      await withApi((request) => { calls.push(request); return {
        data: [{ channel: row(1), concurrentUserCount: 10 }],
        page: { next: calls.length === 1
          ? { concurrentUserCount: 787, liveId: 21261965 } : null },
      }; }, async () => {
        const pager = SOURCES.createLivePager({ sortType });
        await pager.loadFirst();
        await pager.loadNext();
        assert.equal(pager.done, true);
      });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].searchParams.get("sortType"), sortType);
      assert.equal(calls[1].searchParams.get("sortType"), sortType);
      assert.equal(calls[1].searchParams.get("liveId"), "21261965");
    }
    assert.equal(SOURCES.serverSortType("all", "oldest"), "POPULAR");
    assert.equal(SOURCES.serverSortType("search", "recent"), null);
    assert.throws(() => SOURCES.livePageUrl(null, "OLDEST"), /invalid-sort/);
  });

  await test("팔로잉 정렬은 API 순서를 그대로 쓰고 허용된 값만 요청한다", async () => {
    for (const [mode, sortType] of Object.entries({
      viewers: "POPULAR", "viewers-asc": "UNPOPULAR", recent: "LATEST",
      oldest: "OLDEST", recommended: "RECOMMEND",
    })) {
      assert.equal(SOURCES.serverSortType("following", mode), sortType);
      await withApi((url) => {
        assert.equal(url.searchParams.get("sortType"), sortType);
        return { followingList: [2, 1].map((n) => ({
          channelId: id(n), channel: row(n), streamer: { openLive: true },
          liveInfo: { liveTitle: `방송${n}`, concurrentUserCount: n * 10 },
        })) };
      }, async () => {
        const rows = await SOURCES.loadFollowing(sortType);
        assert.deepEqual(SOURCES.sortRows(rows, mode, true).map((item) => item.channelId),
          [id(2), id(1)]);
        if (sortType === "POPULAR") {
          assert.deepEqual(SOURCES.sortRows(rows, "viewers").map((item) => item.channelId),
            [id(2), id(1)]);
          assert.deepEqual(SOURCES.sortRows(rows.slice().reverse(), "viewers")
            .map((item) => item.channelId), [id(2), id(1)],
          "전용 팔로잉의 로컬 정렬은 API 행의 원래 순서와 독립적이어야 한다");
        }
      });
    }
    await assert.rejects(SOURCES.loadFollowing("INVALID"), /invalid-sort/);
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

  await test("팔로잉 다시보기는 nextNo 페이지와 영상 단위 중복 제거를 지원한다", async () => {
    const calls = [];
    await withApi((url) => {
      calls.push(url);
      assert.equal(url.pathname, "/service/v2/home/following/videos");
      assert.equal(url.searchParams.get("size"), "50");
      const page = calls.length;
      return {
        data: [1, page === 1 ? 2 : 1].map((n) => ({
          video: { videoNo: String(n), videoTitle: `다시보기${n}`, thumbnailImageUrl: "https://img.test/{type}.jpg" },
          channel: { channelId: id(n), channelName: `채널${n}`, channelImageUrl: `https://img.test/${n}.png` },
        })),
        page: { next: page === 1 ? { nextNo: "2103509840029549570" } : null, prev: null },
      };
    }, async () => {
      const pager = SOURCES.createFollowingVideoPager();
      await pager.loadFirst();
      assert.equal(pager.next, "2103509840029549570");
      await pager.loadNext();
      assert.equal(calls[1].searchParams.get("nextNo"), "2103509840029549570");
      assert.deepEqual(pager.rows.map((item) => item.videoNo), ["1", "2"]);
      assert.equal(pager.rows[0].channelId, "video:1");
      assert.equal(pager.rows[0].ownerChannelId, id(1));
      assert.equal(pager.rows[0].liveImageUrl, "https://img.test/480.jpg");
      assert.equal(pager.done, true);
    });
  });

  await test("전체 다시보기는 인기·최신 정렬과 채널 다시보기 PAGE API를 사용한다", async () => {
    const calls = [];
    await withApi((url) => {
      calls.push(url);
      if (url.pathname === "/service/v1/home/videos") {
        return { data: [{ video: { videoNo: "123", videoTitle: "전체 영상" }, channel: row(1) }] };
      }
      return { data: [{ videoNo: "456", videoTitle: "채널 영상" }] };
    }, async () => {
      for (const sortType of ["POPULAR", "LATEST"]) {
        const pager = SOURCES.createAllVideoPager(sortType);
        await pager.loadFirst();
        assert.equal(calls.at(-1).pathname, "/service/v1/home/videos");
        assert.equal(calls.at(-1).searchParams.get("sortType"), sortType);
        assert.equal(calls.at(-1).searchParams.get("size"), "50");
      }
      const channel = { channelId: id(8), channelName: "채널8", channelImageUrl: "https://img.test/p.png" };
      const pager = SOURCES.createChannelVideoPager(channel);
      await pager.loadFirst();
      const url = calls.at(-1);
      assert.equal(url.pathname, `/service/v1/channels/${id(8)}/videos`);
      assert.equal(url.searchParams.get("sortType"), "LATEST");
      assert.equal(url.searchParams.get("pagingType"), "PAGE");
      assert.equal(url.searchParams.get("size"), "50");
      assert.equal(url.searchParams.get("page"), "0");
      assert.equal(pager.rows[0].ownerChannelId, id(8));
      assert.equal(pager.rows[0].channelName, "채널8");
    });
  });

  await test("인기·최신 다시보기는 복합 커서를 이어 읽고 업로드도 포함한다", async () => {
    const calls = [];
    await withApi((url) => {
      calls.push(url);
      const first = !url.searchParams.has("videoNo") && !url.searchParams.has("nextNo");
      const latest = url.searchParams.get("sortType") === "LATEST";
      if (first) return {
        data: [
          { video: { videoNo: latest ? "11" : "1", videoTitle: "업로드 영상", videoType: "UPLOAD" }, channel: row(1) },
          { video: { videoNo: latest ? "12" : "2", videoTitle: "다시보기", videoType: "REPLAY" }, channel: row(2) },
        ],
        page: { next: latest ? { publishDateAt: "20260925120000", videoNo: "12" } : { readCount: "9000", videoNo: "2" } },
      };
      return { data: [{ video: { videoNo: latest ? "13" : "3", videoTitle: "다음 영상", videoType: "UPLOAD" }, channel: row(3) }], page: { next: null } };
    }, async () => {
      for (const sortType of ["POPULAR", "LATEST"]) {
        const pager = SOURCES.createAllVideoPager(sortType);
        await pager.loadFirst();
        assert.equal(pager.rows.length, 2);
        assert.equal(pager.rows[0].videoType, "UPLOAD");
        await pager.loadNext();
        const second = calls.at(-1);
        assert.equal(second.searchParams.get("sortType"), sortType);
        assert.equal(second.searchParams.get("size"), "50");
        if (sortType === "POPULAR") {
          assert.equal(second.searchParams.get("readCount"), "9000");
          assert.equal(second.searchParams.get("videoNo"), "2");
        } else {
          assert.equal(second.searchParams.get("publishDateAt"), "20260925120000");
          assert.equal(second.searchParams.get("videoNo"), "12");
        }
        assert.equal(pager.rows.length, 3);
        assert.equal(pager.rows.at(-1).videoType, "UPLOAD");
        assert.equal(pager.done, true);
      }
    });
  });

  await test("채널 다시보기 페이지는 업로드 포함 후에도 원본 페이지 기준으로 이어진다", async () => {
    const calls = [];
    await withApi((url) => {
      calls.push(url);
      const page = Number(url.searchParams.get("page"));
      const data = page === 0
        ? Array.from({ length: 50 }, (_, index) => ({
          videoNo: String(index + 1),
          videoTitle: `영상${index + 1}`,
          videoType: index === 0 ? "UPLOAD" : "REPLAY",
        }))
        : [{ videoNo: "51", videoTitle: "마지막 다시보기", videoType: "REPLAY" }];
      return { data, totalPages: 2 };
    }, async () => {
      const channel = { channelId: id(8), channelName: "채널8" };
      const pager = SOURCES.createChannelVideoPager(channel);
      await pager.loadFirst();
      assert.equal(pager.rows.length, 50);
      assert.equal(pager.rows[0].videoType, "UPLOAD");
      assert.equal(pager.next, "1");
      await pager.loadNext();
      assert.equal(calls[1].searchParams.get("page"), "1");
      assert.equal(pager.rows.length, 51);
      assert.equal(pager.rows.at(-1).videoNo, "51");
      assert.equal(pager.done, true);
    });
  });

  await test("채널 검색 및 현재 계정의 다시보기 즐겨찾기를 정규화한다", async () => {
    const previous = global.chrome;
    global.chrome = {
      runtime: { sendMessage: async ({ url }) => ({ ok: true, content: {
        data: [{ channel: { ...row(9), channelImageUrl: "https://img.test/a.png", verifiedMark: true } }],
      } }) },
      storage: { local: { get: async () => ({
        cheeseVideoVaultActiveAccount: id(99),
        [`cheeseVideoVault:${id(99)}`]: [{ videoNo: "789", title: "보관한 다시보기", thumb: "https://img.test/v.jpg", channelId: id(9), channelName: "채널9", channelImageUrl: "https://img.test/p.png", adult: true }],
      }) } },
    };
    try {
      const search = await SOURCES.searchChannelsPage("채널", 0);
      assert.equal(search.rows[0].channelId, id(9));
      assert.equal(search.rows[0].verifiedMark, true);
      const favorites = await SOURCES.loadVideoVaultFavorites();
      assert.equal(favorites[0].channelId, "video:789");
      assert.equal(favorites[0].ownerChannelId, id(9));
      assert.equal(favorites[0].liveTitle, "보관한 다시보기");
      assert.equal(favorites[0].adult, true);
    } finally {
      global.chrome = previous;
    }
  });

  await test("치즈 플래터 재정렬은 기존 가중치 설정과 검색 페이지 API를 사용한다", async () => {
    const previous = global.chrome;
    const requests = [];
    const stored = {};
    global.chrome = {
      runtime: { sendMessage: async ({ url }) => {
        const parsed = new URL(url);
        requests.push(parsed);
        return { ok: true, content: { data: [
          { video: { videoNo: "801", videoTitle: "다른 게임", videoType: "UPLOAD", readCount: 900000 }, channel: row(8) },
          { video: { videoNo: "802", videoTitle: "고양이 모험", videoType: "REPLAY", readCount: 1 }, channel: row(2) },
        ] } };
      } },
      storage: { local: {
        get: async () => ({
          cheeseSearchRerankPoolMax: stored.cheeseSearchRerankPoolMax ?? 50,
          cheeseSearchRerankWeights: stored.cheeseSearchRerankWeights ??
            { rel: 100, channel: 0, read: 0, pv: 0, verified: 0, recent: 0 },
          cheeseSearchRerankDefaultSort: stored.cheeseSearchRerankDefaultSort ?? "score",
        }),
        set: async (values) => Object.assign(stored, values),
      } },
    };
    try {
      const pager = SOURCES.createVideoSearchPager("고양이");
      await pager.loadFirst();
      assert.equal(requests[0].pathname, "/service/v1/search/videos");
      assert.equal(requests[0].searchParams.get("keyword"), "고양이");
      assert.equal(requests[0].searchParams.get("offset"), "0");
      assert.equal(requests[0].searchParams.get("size"), "50");
      assert.deepEqual(pager.rows.map((item) => item.videoNo), ["802", "801"]);
      assert.equal(pager.rows[1].videoType, "UPLOAD");
      assert.equal(pager.done, true);
      await pager.setSort("read");
      assert.equal(pager.sort, "read");
      assert.deepEqual(pager.rows.map((item) => item.videoNo), ["801", "802"]);
      await pager.updateSettings({ weights: { rel: 0, channel: 100 } });
      assert.equal(pager.settings.weights.channel, 100);
      assert.equal(pager.sort, "read");
      const saved = await SOURCES.saveVideoSearchSettings({ poolMax: 225, sort: "pv" });
      assert.equal(saved.poolMax, 225);
      assert.equal(stored.cheeseSearchRerankDefaultSort, "pv");
    } finally {
      global.chrome = previous;
    }
  });

  await test("다시보기 즐겨찾기는 50개씩 페이지네이션한다", async () => {
    const previous = global.chrome;
    const favorites = Array.from({ length: 51 }, (_, index) => ({
      videoNo: String(index + 1),
      title: `보관 다시보기${index + 1}`,
      channelId: id(9),
      channelName: "채널9",
    }));
    global.chrome = {
      storage: { local: { get: async (key) => key === "cheeseVideoVaultActiveAccount"
        ? { cheeseVideoVaultActiveAccount: id(99) }
        : { [`cheeseVideoVault:${id(99)}`]: favorites } } },
    };
    try {
      const pager = SOURCES.createVideoVaultFavoritesPager();
      await pager.loadFirst();
      assert.equal(pager.rows.length, 50);
      assert.equal(pager.next, "50");
      await pager.loadNext();
      assert.equal(pager.rows.length, 51);
      assert.equal(pager.done, true);
    } finally {
      global.chrome = previous;
    }
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

  await test("검색 pager는 상세 조회 묶음과 다음 검색 페이지를 이어 읽는다", async () => {
    const requests = [];
    const liveChannel = (n) => ({
      channelId: id(n),
      channelName: `검색 채널 ${n}`,
      openLive: true,
    });
    await withApi((url) => {
      requests.push(url);
      if (url.pathname === "/service/v1/search/channels") {
        const offset = Number(url.searchParams.get("offset"));
        const count = offset === 0 ? 30 : offset === 30 ? 2 : 0;
        return {
          data: Array.from({ length: count }, (_, index) => ({
            channel: liveChannel(100 + offset + index),
          })),
        };
      }
      if (url.pathname === "/service/v1/tag/lives") return { data: [] };
      const match = url.pathname.match(/\/channels\/([0-9a-f]{32})\/live-detail$/i);
      assert.ok(match, `예상하지 못한 API: ${url}`);
      const channelId = match[1];
      return {
        status: "OPEN",
        channel: { channelId, channelName: `상세 ${channelId.slice(-2)}` },
        liveTitle: "방송",
      };
    }, async () => {
      const pager = SOURCES.createSearchPager("페이지");
      await pager.loadFirst();
      assert.equal(pager.rows.length, 12);
      assert.deepEqual(pager.next, { offset: 0, detailOffset: 12 });

      await pager.loadNext();
      assert.equal(pager.rows.length, 24);
      assert.deepEqual(pager.next, { offset: 0, detailOffset: 24 });

      await pager.loadNext();
      assert.equal(pager.rows.length, 30);
      assert.deepEqual(pager.next, { offset: 30, detailOffset: 0 });

      await pager.loadNext();
      assert.equal(pager.rows.length, 32);
      assert.equal(pager.done, true);
      assert.equal(new Set(pager.rows.map((item) => item.channelId)).size, 32);
    });
    const searchOffsets = requests
      .filter((url) => url.pathname === "/service/v1/search/channels")
      .map((url) => Number(url.searchParams.get("offset")));
    assert.deepEqual(searchOffsets, [0, 0, 0, 30]);
    assert.equal(
      requests.filter((url) => url.pathname === "/service/v1/tag/lives").length,
      1,
      "태그 검색은 첫 검색 페이지에만 요청해야 한다",
    );
  });

  await test("배경 중계는 확인된 라이브 커서 키만 허용한다", async () => {
    const background = fs.readFileSync(path.join(__dirname, "../src/background.js"), "utf8");
    const start = background.indexOf("function validMultiviewApiQuery(url) {");
    const end = background.indexOf("\nasync function fetchMultiviewApi", start);
    assert.ok(start >= 0 && end > start, "멀티뷰 URL 검증 함수를 찾지 못했다");
    const channelVideosDeclaration = background.match(/const MULTIVIEW_CHANNEL_VIDEOS_RE =\s*[^;]+;/)?.[0] || "";
    const helpers = vm.runInNewContext(`${channelVideosDeclaration}\n${background.slice(start, end)}\n({ validMultiviewApiQuery, preserveFollowingVideoNextNoPrecision })`);
    const { validMultiviewApiQuery: valid, preserveFollowingVideoNextNoPrecision: preserveNextNo } = helpers;
    const base = "https://api.chzzk.naver.com/service/v1/lives?size=40";
    assert.equal(valid(new URL(base)), true);
    for (const sortType of ["POPULAR", "UNPOPULAR", "LATEST", "RECOMMEND"]) {
      assert.equal(valid(new URL(`${base}&sortType=${sortType}`)), true);
      assert.equal(valid(new URL(`${base}&sortType=${sortType}&concurrentUserCount=20&liveId=123`)), true);
    }
    for (const sortType of ["OLDEST", "RANDOM", ""]) {
      assert.equal(valid(new URL(`${base}&sortType=${sortType}`)), false);
    }
    assert.equal(valid(new URL(`${base}&sortType=POPULAR&sortType=LATEST`)), false);
    assert.equal(valid(new URL(`${base}&concurrentUserCount=20&liveId=123`)), true);
    assert.equal(valid(new URL(`${base}&unexpected=1`)), false);
    assert.equal(valid(new URL(`${base}&liveId=123`)), false);
    assert.equal(valid(new URL(`${base}&concurrentUserCount=20&liveId=123&liveId=124`)), false);
    assert.equal(valid(new URL(`${base}&concurrentUserCount=20%26x%3D1&liveId=123`)), false);
    const following = "https://api.chzzk.naver.com/service/v1/channels/following-lives";
    for (const sortType of ["POPULAR", "UNPOPULAR", "LATEST", "OLDEST", "RECOMMEND"]) {
      assert.equal(valid(new URL(`${following}?sortType=${sortType}`)), true);
    }
    assert.equal(valid(new URL(`${following}?sortType=RANDOM`)), false);
    assert.equal(valid(new URL(`${following}?sortType=POPULAR&sortType=LATEST`)), false);
    const followingVideos = "https://api.chzzk.naver.com/service/v2/home/following/videos?size=50&nextNo=2103509840029549570";
    assert.equal(valid(new URL(followingVideos)), true);
    assert.equal(valid(new URL(followingVideos.replace("size=50", "size=51"))), false);
    assert.equal(valid(new URL(`${followingVideos}&unexpected=1`)), false);
    assert.equal(valid(new URL(`${followingVideos}&nextNo=123`)), false);
    const cursor = "2103509840029549570";
    const rawFollowingResponse = `{"content":{"data":[{"videoTitle":${JSON.stringify(`literal "nextNo":${cursor}`)}}],"page":{"next":{"nextNo":${cursor}},"prev":null}}}`;
    assert.notEqual(String(JSON.parse(rawFollowingResponse).content.page.next.nextNo), cursor,
      "일반 JSON 숫자 파싱은 커서 정밀도를 잃는 fixture여야 한다");
    const preciseFollowingResponse = JSON.parse(preserveNextNo(rawFollowingResponse));
    assert.equal(preciseFollowingResponse.content.page.next.nextNo, cursor);
    assert.equal(preciseFollowingResponse.content.data[0].videoTitle, `literal "nextNo":${cursor}`,
      "채팅/제목 등 JSON 문자열 안에 있는 nextNo 텍스트는 변형하면 안 된다");
    for (const sortType of ["POPULAR", "LATEST"]) {
      assert.equal(valid(new URL(`https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=${sortType}`)), true);
      assert.equal(valid(new URL(`https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=${sortType}&nextNo=123456`)), true);
    }
    assert.equal(valid(new URL("https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=POPULAR&readCount=9000&videoNo=123")), true);
    assert.equal(valid(new URL("https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=LATEST&publishDateAt=20260925120000&videoNo=123")), true);
    assert.equal(valid(new URL("https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=LATEST&unexpected=1")), false);
    assert.equal(valid(new URL("https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=LATEST&videoNo=123&videoNo=124")), false);
    assert.equal(valid(new URL("https://api.chzzk.naver.com/service/v1/home/videos?size=50&sortType=RECOMMEND")), false);
    const videoSearch = "https://api.chzzk.naver.com/service/v1/search/videos?keyword=%EA%B3%A0%EC%96%91%EC%9D%B4&offset=0&size=50";
    assert.equal(valid(new URL(videoSearch)), true);
    assert.equal(valid(new URL(videoSearch.replace("size=50", "size=100"))), false);
    assert.equal(valid(new URL(videoSearch.replace("&offset=0", ""))), false);
    assert.equal(valid(new URL(`${videoSearch}&unexpected=1`)), false);
    assert.equal(valid(new URL("https://api.chzzk.naver.com/service/v1/search/videos?keyword=&offset=0&size=50")), false);
    const channelVideos = `https://api.chzzk.naver.com/service/v1/channels/${id(1)}/videos?sortType=LATEST&pagingType=PAGE&page=0&size=50&publishDateAt=&videoType=`;
    assert.equal(valid(new URL(channelVideos)), true);
    assert.equal(valid(new URL(`${channelVideos}&unexpected=1`)), false);
    assert.equal(valid(new URL(channelVideos.replace("page=0", "page=-1"))), false);
    const tag = "https://api.chzzk.naver.com/service/v1/tag/lives?size=20&sortType=POPULAR&tags=%EB%B4%89%EB%88%84%EB%8F%84";
    assert.equal(valid(new URL(tag)), true);
    assert.equal(valid(new URL(tag.replace("&tags=", "&unexpected=1&tags="))), false);
    assert.equal(valid(new URL(tag.replace("POPULAR", "LATEST"))), false);
    assert.equal(valid(new URL(tag.replace(/&tags=.*/, ""))), false);
    assert.equal(valid(new URL(`${tag}&tags=duplicate`)), false);
    const nicknameColors = "https://api.chzzk.naver.com/service/v2/nickname/color/codes";
    assert.equal(valid(new URL(nicknameColors)), true);
    assert.equal(valid(new URL(`${nicknameColors}?unexpected=1`)), false);
    assert.match(background, /url\.origin !== MULTIVIEW_API_ORIGIN/);
    assert.match(background, /!MULTIVIEW_API_PATHS\.has\(url\.pathname\)/);
  });

  console.log("\n멀티뷰 라이브 pager 검증 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
