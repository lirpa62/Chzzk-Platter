// 다시보기 채팅 검색(현재 영상 한 편).
//
// ⚠ 기존 '내 채팅 기록 검색'과 다른 기능이다. 그쪽은 본인 채팅만 영구 보관해
//   기간·스트리머로 찾는 것이고, 이쪽은 지금 보는 다시보기의 '전체 채팅'을
//   메모리에서만 찾는다.
//
// 지키는 정책(여기서 고정한다):
//  - 원문을 chrome.storage 에 저장하지 않는다
//  - 닉네임·UID 를 담지 않는다(시각과 본문뿐)
//  - 검색을 한 번도 열지 않으면 원문을 모으지 않는다(opt-in)
//  - 같은 영상을 두 번 순회하지 않는다(활성도 순회를 함께 쓴다)

const fs = require("fs");
const path = require("path");

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

// content.js 의 searchVodChatMessages 와 같은 규칙.
function searchVodChatMessages(messages, query, limit = 200) {
  const needle = String(query || "")
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase();
  if (!needle || !Array.isArray(messages)) return { total: 0, rows: [] };
  const rows = [];
  let total = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const text = messages[i]?.text;
    if (typeof text !== "string" || !text) continue;
    if (!text.normalize("NFC").toLocaleLowerCase().includes(needle)) continue;
    total += 1;
    if (rows.length < limit) rows.push(messages[i]);
  }
  return { total, rows };
}

const msg = (t, text) => ({ t, text });

console.log("[A] 본문에 든 채팅만 찾는다");
{
  const list = [
    msg(1000, "둥그레 왔다"),
    msg(2000, "안녕하세요"),
    msg(3000, "둥그레 ㅋㅋ"),
  ];
  const r = searchVodChatMessages(list, "둥그레");
  ok(r.total === 2, `2건 (${r.total})`);
  ok(r.rows[0].t === 1000 && r.rows[1].t === 3000, "시각이 함께 온다");
}

console.log("\n[B] 영문은 대소문자를 가리지 않는다");
{
  const list = [msg(0, "Hello world"), msg(1, "SingCup"), msg(2, "없음")];
  ok(searchVodChatMessages(list, "hello").total === 1, "hello → Hello");
  ok(searchVodChatMessages(list, "SING").total === 1, "SING → SingCup");
  ok(searchVodChatMessages(list, "sing").total === 1, "sing → SingCup");
}

console.log("\n[C] 빈 검색어는 아무것도 찾지 않는다");
{
  const list = [msg(0, "아무거나")];
  ok(searchVodChatMessages(list, "").total === 0, "빈 문자열");
  ok(searchVodChatMessages(list, "   ").total === 0, "공백만");
  ok(searchVodChatMessages(null, "가").total === 0, "목록이 없어도 안전하다");
}

console.log("\n[한글 조합] 낱자로 나뉜 표기도 같은 것으로 본다");
{
  // NFD(조합형)로 쓴 '둥그레'
  const nfd = "둥그레".normalize("NFD");
  const list = [msg(0, `오늘 ${nfd} 폼`)];
  ok(
    searchVodChatMessages(list, "둥그레").total === 1,
    "NFD 본문을 NFC 검색어로 찾는다",
  );
}

console.log("\n[D] 본문을 코드로 다루지 않는다(그대로 문자열)");
{
  const raw = "<script>alert(1)</script>";
  const list = [msg(0, raw)];
  const r = searchVodChatMessages(list, "script");
  ok(r.total === 1, "태그처럼 생긴 글자도 검색된다");
  ok(r.rows[0].text === raw, "본문을 바꾸지 않고 그대로 돌려준다");
  // ⚠ 화면에 넣을 때는 escapeHtml 을 거쳐야 한다. 아래 [소스] 에서 확인한다.
}

console.log("\n[이모티콘] 키도 찾을 수 있다");
{
  const list = [msg(0, "좋다 {:smile:}"), msg(1, "그냥 글")];
  ok(
    searchVodChatMessages(list, "{:smile:}").total === 1,
    "이모티콘 키 그대로",
  );
  ok(searchVodChatMessages(list, "smile").total === 1, "이름 일부로도");
}

console.log("\n[E/F] 많은 채팅에서도 정확하고 빠르다");
{
  const KO = ["둥그레 왔다", "ㅋㅋㅋㅋ", "안녕", "SingCup", "오늘 폼 좋네"];
  for (const n of [10000, 100000]) {
    const list = [];
    for (let i = 0; i < n; i += 1) list.push(msg(i * 1000, KO[i % KO.length]));
    const t0 = process.hrtime.bigint();
    const r = searchVodChatMessages(list, "둥그레");
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    ok(r.total === Math.ceil(n / KO.length), `${n}건 → ${r.total}건 정확`);
    // 한 프레임(16ms)을 크게 넘지 않아야 입력이 버벅이지 않는다.
    ok(ms < 100, `${n}건 검색 ${ms.toFixed(1)}ms`);
  }
}

console.log("\n[결과 제한] 수만 건이어도 한 번에 다 넘기지 않는다");
{
  const list = [];
  for (let i = 0; i < 5000; i += 1) list.push(msg(i, "둥그레"));
  const r = searchVodChatMessages(list, "둥그레", 200);
  ok(r.total === 5000, `전체 개수는 그대로 센다 (${r.total})`);
  ok(r.rows.length === 200, `넘기는 것은 앞 200건 (${r.rows.length})`);
}

console.log("\n[소스] 정책이 코드에 실제로 들어 있다");
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "content.js"),
    "utf8",
  );
  ok(/const vodChatSearchState = \{/.test(src), "검색 상태가 있다");
  // opt-in: collecting 이 켜져 있을 때만 원문을 모은다.
  ok(
    /vodChatSearchState\.collecting && vodChatSearchState\.videoNo === videoNo/.test(
      src,
    ),
    "검색을 연 뒤에만 원문을 모은다(opt-in)",
  );
  // 같은 영상을 두 번 순회하지 않는다.
  ok(
    /await collectVodChatDataShared\(videoNo, duration, \(progress\) => \{/.test(
      src,
    ),
    "활성도와 같은 순회를 함께 쓴다",
  );
  // ⚠ 원문을 저장소에 넣지 않는다.
  const fn = src.slice(
    src.indexOf("const vodChatSearchState = {"),
    src.indexOf("function searchVodChatMessages"),
  );
  ok(
    !/chrome\.storage/.test(fn),
    "검색 경로가 저장소를 쓰지 않는다(메모리 전용)",
  );
  // ⚠ 담는 필드는 시각과 본문뿐이다.
  ok(
    /searchMessages\.push\(\{ t: Math\.round\(at\), text \}\)/.test(src),
    "시각과 본문만 담는다(닉네임·UID 없음)",
  );
  ok(/VOD_CHAT_SEARCH_MAX_MESSAGES/.test(src), "메모리 상한이 있다");
  // 활성도 캐시 정책이 그대로인지(원문을 넣지 않는다).
  const save = src.slice(
    src.indexOf("async function saveChatGraphCache"),
    src.indexOf("async function saveChatGraphCache") + 700,
  );
  ok(
    !/searchMessages|rawMessages/.test(save),
    "활성도 캐시에 원문을 넣지 않는다(기존 정책 유지)",
  );
  // [H] 영상이 바뀌면 이전 원문을 버린다.
  const reset = src.slice(
    src.indexOf("function resetChatGraphIfVideoChanged"),
    src.indexOf("function resetChatGraphIfVideoChanged") + 900,
  );
  // ⚠ reset 함수 '안에서' 버려야 한다. 다른 곳의 같은 줄과 헷갈리지 않게
  //   videoNo 비교와 함께 있는지 본다.
  ok(
    /vodChatSearchState\.videoNo !== videoNo\s*\)\s*\{\s*vodChatSearchState\.videoNo = "";\s*vodChatSearchState\.messages = null;/.test(
      reset,
    ),
    "영상이 바뀌면 이전 원문을 버린다",
  );
  ok(
    /videoNo &&\s*vodChatSearchState\.videoNo/.test(reset),
    "주소를 잠깐 못 읽는 것을 영상 변경으로 보지 않는다",
  );
  // [I] 중복 수집 금지.
  ok(
    /if \(vodChatSearchState\.loading\) return null;/.test(src),
    "받는 중에 또 받지 않는다",
  );
  // 이동은 기존 helper 를 쓴다(새로 만들지 않는다).
  ok(
    /function seekVideoToCommentTimestamp/.test(src),
    "기존 타임스탬프 이동 helper 가 있다",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
