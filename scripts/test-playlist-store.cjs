// 나만의 재생목록 저장 구조(src/playlistStore.js): 정규화·목록/항목 조작·주소 해석·시간 표기·
// 파일과 공유 코드 내보내기·불러오기·저장 헬퍼.
const assert = require("node:assert/strict");
const path = require("node:path");

const S = require(path.join(__dirname, "..", "src", "playlistStore.js"));
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

(async () => {
  // ── 정규화 ──
  const bad = S.normalize({ lists: [
    { name: "  섞인   목록 ", items: [
      { type: "video", videoNo: "123", start: "90.7", title: "a".repeat(300), thumb: "javascript:alert(1)", channelId: "ABCDEF0123456789ABCDEF0123456789" },
      { type: "video", videoNo: "12a" },
      { type: "clip", clipUID: "<script>" },
      { type: "clip", clipUID: "AbC_12-xyz", start: 30 },
      { type: "live", channelId: "x" },
    ] },
    "문자열",
  ] });
  const [mixed] = bad.lists;
  check(bad.v === 1 && bad.lists.length === 1 && mixed.name === "섞인 목록", "목록이 아닌 값은 버리고 이름 공백을 정리한다");
  check(mixed.items.length === 2 && mixed.items[0].start === 90 && mixed.items[0].title.length === 200 &&
    mixed.items[0].thumb === "" && mixed.items[0].channelId === "abcdef0123456789abcdef0123456789",
  "항목: 잘못된 번호·id·종류는 버리고, 시작은 정수 초, 제목 길이 제한, https 아닌 썸네일 제거, 채널 id 소문자");
  check(mixed.items[1].type === "clip" && mixed.items[1].start === undefined, "클립에는 시작 시간이 없다");

  // ── 목록·항목 조작 ──
  let state = S.normalize(null);
  let r = S.createList(state, "점심 몰아보기");
  state = r.state;
  const listId = r.list.id;
  r = S.createList(state, "점심 몰아보기");
  state = r.state;
  const secondId = r.list.id;
  check(r.list.name === "점심 몰아보기 2", "같은 이름으로 만들면 번호를 붙인다");
  const before = state;
  r = S.addItems(state, listId, [
    { type: "video", videoNo: "15679779", start: 10674, title: "합방", duration: 20000 },
    { type: "clip", clipUID: "clipAAAA", duration: 30 },
    { type: "video", videoNo: "15679779", start: 0, duration: 20000 },
  ]);
  state = r.state;
  let list = S.findList(state, listId);
  check(before.lists[0].items.length === 0, "조작은 받은 상태를 바꾸지 않는다(새 상태를 돌려준다)");
  check(list.items.length === 3 && r.added.length === 3 && new Set(list.items.map((i) => i.id)).size === 3,
    "같은 영상을 다른 시작 시간으로 두 번 담을 수 있다(항목마다 id)");
  check(S.listContains(list, "clip:clipAAAA") && !S.listContains(list, "clip:other"), "담김 확인은 영상·클립 키로");
  check(S.totalDuration(list) === (20000 - 10674) + 30 + 20000, "총 길이는 시작 시간 이후만 센다");
  state = S.moveItem(state, listId, 2, 0).state;
  list = S.findList(state, listId);
  check(list.items[0].start === 0 && list.items[1].start === 10674, "순서 바꾸기");
  state = S.setStart(state, listId, list.items[0].id, 125).state;
  state = S.setStart(state, listId, list.items[2].id, 99).state;
  list = S.findList(state, listId);
  check(list.items[0].start === 125 && list.items[2].start === undefined, "시작 시간은 다시보기에만 들어간다");
  state = S.renameList(state, listId, "  저녁  ").state;
  state = S.renameList(state, listId, "   ").state;
  check(S.findList(state, listId).name === "저녁", "이름 바꾸기(빈 이름은 무시)");
  state = S.removeItems(state, listId, [list.items[2].id]).state;
  check(S.findList(state, listId).items.length === 2, "항목 삭제");
  const meta = S.applyMeta(state, "video:15679779", { title: "새 제목", channelName: "치즈", thumb: "https://x/y.jpg" });
  check(meta.changed && S.findList(meta.state, listId).items.every((i) => i.title === "새 제목" && i.channelName === "치즈"),
    "받은 정보는 같은 영상을 담은 모든 항목에 채운다");
  check(!S.applyMeta(meta.state, "video:15679779", { title: "새 제목" }).changed, "바뀐 게 없으면 상태를 그대로 둔다");
  const stats = S.applyMeta(meta.state, "video:15679779", { title: "새 제목", views: 1819, date: "2025-08-18 21:00:00" });
  check(S.findList(stats.state, listId).items.every((i) => i.views === 1819 && i.date === Date.parse("2025-08-18T21:00:00+09:00")),
    "조회수·올린 날짜도 받는다(날짜는 한국 시각 글자·초·ms 모두 ms 로)");
  check(S.normalizeItem({ type: "video", videoNo: "1", date: 1755518400 }).date === 1755518400000 &&
    !("views" in S.normalizeItem({ type: "video", videoNo: "1", views: -3 })) && !("date" in S.normalizeItem({ type: "video", videoNo: "1", date: "아무거나" })) &&
    !("date" in S.normalizeItem({ type: "video", videoNo: "1", date: Date.now() + 864e5 * 3 })),
    "잘못된 조회수·날짜(음수·글자·먼 미래)는 버리고, 없으면 키를 두지 않는다");
  const many = Array.from({ length: S.LIMITS.items + 5 }, (_, i) => ({ type: "video", videoNo: String(i + 1) }));
  const full = S.addItems(state, listId, many);
  check(S.findList(full.state, listId).items.length === S.LIMITS.items && full.skipped === 7, "목록당 항목 한도를 넘는 것은 담지 않고 개수만 알린다");
  const afterDelete = S.deleteList(state, secondId).state;
  check(afterDelete.lists.length === state.lists.length - 1 && !S.findList(afterDelete, secondId), "목록 삭제");
  state = afterDelete;

  // ── 주소 ──
  check(JSON.stringify(S.parseChzzkUrl("https://chzzk.naver.com/video/15679779?currentTime=10674")) ===
    JSON.stringify({ type: "video", videoNo: "15679779", start: 10674 }), "다시보기 주소의 currentTime 을 시작 시간으로 읽는다");
  check(S.parseChzzkUrl("https://chzzk.naver.com/clips/AbCd1234")?.clipUID === "AbCd1234" &&
    S.parseChzzkUrl("https://chzzk.naver.com/embed/clip/AbCd1234?autoplay=1")?.clipUID === "AbCd1234", "클립 주소(일반·임베드)");
  check(!S.parseChzzkUrl("https://evil.example/video/1") && !S.parseChzzkUrl("http://chzzk.naver.com/video/1") &&
    !S.parseChzzkUrl("https://chzzk.naver.com/live/abc") && !S.parseChzzkUrl("아무 글"), "치지직 다시보기·클립이 아니면 null");
  check(S.itemUrl({ type: "video", videoNo: "1", start: 61 }) === "https://chzzk.naver.com/video/1?currentTime=61" &&
    S.itemUrl({ type: "video", videoNo: "1", start: 0 }) === "https://chzzk.naver.com/video/1" &&
    S.itemUrl({ type: "clip", clipUID: "a_b-c" }) === "https://chzzk.naver.com/clips/a_b-c", "항목 → 재생 주소");
  check(S.matchesLocation({ type: "video", videoNo: "12" }, "/video/12") && !S.matchesLocation({ type: "video", videoNo: "12" }, "/video/123") &&
    S.matchesLocation({ type: "clip", clipUID: "xY" }, "/clips/xY"), "지금 주소가 그 항목인지");

  // ── 시간 ──
  check(S.formatClock(10674) === "2:57:54" && S.formatClock(65) === "1:05" && S.formatClock(0) === "0:00", "시간 표기");
  check(S.parseClock("2:57:54") === 10674 && S.parseClock("83:20") === 5000 && S.parseClock("90") === 90 &&
    S.parseClock("1시간 2분 3초") === 3723 && S.parseClock("") === 0, "시간 입력 읽기(시:분:초·분:초·초·한글)");
  check(S.parseClock("1:75") === null && S.parseClock("abc") === null, "틀린 시간은 null");

  // ── 파일 ──
  const file = S.exportFile(state);
  const json = JSON.stringify(file);
  check(file.format === "cheese-platter-playlist" && !json.includes('"id"') && file.lists[0].items[0].videoNo, "파일에는 내부 id 를 빼고 내용만 담는다");
  const parsed = S.parseFile(json);
  check(parsed.length === state.lists.length && parsed[0].items.length === S.findList(state, listId).items.length &&
    parsed[0].id !== listId && parsed[0].items[0].start === S.findList(state, listId).items[0].start, "파일 왕복(새 id)");
  for (const [input, label] of [["{", "JSON 이 아니면"], [JSON.stringify({ format: "x" }), "형식이 다르면"],
    [JSON.stringify({ format: "cheese-platter-playlist", v: 99, lists: [] }), "더 새 버전이면"],
    [JSON.stringify({ format: "cheese-platter-playlist", v: 1, lists: [] }), "목록이 없으면"]]) {
    let error = "";
    try { S.parseFile(input); } catch (e) { error = e.message; }
    check(Boolean(error), `파일 거절: ${label} (${error})`);
  }

  // ── 공유 코드 ──
  const source = S.findList(state, listId);
  const code = await S.encodeShareCode(source);
  check(code.startsWith("CPL1:") && /^[A-Za-z0-9_-]+$/.test(code.slice(5)), `공유 코드는 CPL1: + 주소에 안전한 글자 (${code.length}자)`);
  const decoded = await S.decodeShareCode(`복사한 글 앞뒤 ${code}\n`);
  check(decoded.name === source.name && decoded.items.length === source.items.length &&
    decoded.items.every((item, i) => S.itemKey(item) === S.itemKey(source.items[i]) && (item.start || 0) === (source.items[i].start || 0)) &&
    decoded.items.every((item) => !item.title), "공유 코드 왕복(종류·번호·시작 시간만, 제목은 다시 받는다)");
  const big = { name: "큰 목록", items: Array.from({ length: 50 }, (_, i) => ({ type: "video", videoNo: String(15000000 + i), start: i * 60 })) };
  const bigCode = await S.encodeShareCode(big);
  check(bigCode.length < 600, `50개 목록도 짧은 코드 (${bigCode.length}자)`);
  for (const [input, label] of [["없음", "접두어 없음"], ["CPL1:!!", "글자 틀림"], ["CPL1:AAAA", "풀 수 없음"]]) {
    let error = "";
    try { await S.decodeShareCode(input); } catch (e) { error = e.message; }
    check(Boolean(error), `코드 거절: ${label} (${error})`);
  }

  // ── 보안: 꾸민 공유 코드·파일 ──
  // 압축 폭탄: 압축은 작지만 풀면 수십 MB. 다 풀기 전에 끊는다.
  const bombJson = `[1,"폭탄",[${'[0,"1"],'.repeat(6000000)}[0,"1"]]]`;
  const bombBytes = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(bombJson)]).stream()
    .pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const bombCode = "CPL1:" + Buffer.from(bombBytes).toString("base64url");
  const bombStart = Date.now();
  let bombError = "";
  try { await S.decodeShareCode(bombCode); } catch (e) { bombError = e.message; }
  check(bombCode.length < 200000 && bombError && Date.now() - bombStart < 3000,
    `압축 폭탄 코드(${(bombJson.length / 1e6).toFixed(0)}MB 로 풀리는 ${bombCode.length}자)는 다 풀기 전에 거절한다 (${bombError})`);
  // 코드 안 목록 이름의 방향 뒤집기·제어 문자는 지운다
  const sneaky = await S.decodeShareCode(await S.encodeShareCode({ name: "정상\u202e엽뒤\u0007 목록", items: [{ type: "video", videoNo: "1" }] }));
  check(sneaky.name === "정상엽뒤 목록", `목록 이름의 글자 방향 뒤집기·제어 문자는 지운다 (${sneaky.name})`);
  // 손으로 고친 파일: 남의 서버 썸네일·거짓 제목·이상한 번호
  const doctored = S.parseFile(JSON.stringify({ format: "cheese-platter-playlist", v: 1, lists: [{ name: "고친 파일", items: [
    { type: "video", videoNo: "123", start: 60, title: "<img src=x onerror=alert(1)>", thumb: "https://evil.example/track.gif", channelName: "가짜" },
    { type: "video", videoNo: "../../api/x" },
    { type: "clip", clipUID: "abcd\"><script>" },
    { type: "clip", clipUID: "goodClip1", thumb: "https://nng-phinf.pstatic.net/a.jpg" },
  ] }] }));
  const kept = doctored[0].items;
  check(kept.length === 2 && kept[0].videoNo === "123" && kept[0].start === 60 && !kept[0].title && !kept[0].thumb && !kept[0].channelName && !kept[1].thumb,
    `파일에서 불러올 때는 종류·번호·시작 시간만 남기고(제목·썸네일·채널은 치지직에서 다시 받는다) 틀린 번호는 버린다 ${JSON.stringify(kept)}`);
  check(S.normalizeItem({ type: "clip", clipUID: "aaaa1", thumb: "https://evil.example/x.jpg" }).thumb === "" &&
    S.normalizeItem({ type: "clip", clipUID: "aaaa1", thumb: "https://user:pw@nng-phinf.pstatic.net/x.jpg" }).thumb === "" &&
    S.normalizeItem({ type: "clip", clipUID: "aaaa1", thumb: "https://pstatic.net.evil.example/x.jpg" }).thumb === "" &&
    S.normalizeItem({ type: "clip", clipUID: "aaaa1", thumb: "https://video-phinf.pstatic.net/x.jpg" }).thumb === "https://video-phinf.pstatic.net/x.jpg" &&
    S.normalizeItem({ type: "video", videoNo: "1", thumb: "https://livecloud-thumb.akamaized.net/chzzk/x.jpg" }).thumb !== "",
  "썸네일은 치지직·네이버 이미지 서버 주소만 받는다(비슷하게 꾸민 도메인·계정 정보가 붙은 주소 거절)");
  const tooMany = S.parseFile(JSON.stringify({ format: "cheese-platter-playlist", v: 1,
    lists: Array.from({ length: 300 }, (_, i) => ({ name: `목록 ${i}`, items: [{ type: "video", videoNo: String(i + 1) }] })) }));
  check(tooMany.length === S.LIMITS.lists, "파일 안 목록 수도 한도까지만 읽는다");

  // ── 불러온 목록 붙이기 ──
  const imported = S.addImportedLists(state, [decoded]);
  check(imported.added[0].name === `${source.name} (가져옴)` && imported.state.lists.length === state.lists.length + 1,
    "같은 이름이 있으면 '(가져옴)' 을 붙여 새 목록으로 추가");

  // ── 저장 헬퍼 ──
  const store = { data: {}, async get(key) { return { [key]: this.data[key] }; }, async set(obj) { Object.assign(this.data, obj); } };
  const created = await S.update((current) => S.createList(current, "저장 시험"), store);
  check(store.data[S.KEY].lists.length === 1 && created.list.name === "저장 시험", "update: 새로 읽고 바꿔 한 키에 쓴다");
  store.data[S.KEY].lists.push({ id: "otherlist01", name: "다른 탭", items: [] });
  await S.update((current) => S.addItems(current, created.list.id, [{ type: "clip", clipUID: "clipBBBB" }]), store);
  check(store.data[S.KEY].lists.length === 2 && store.data[S.KEY].lists[0].items.length === 1, "다른 탭이 쓴 목록을 덮지 않는다");

  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
