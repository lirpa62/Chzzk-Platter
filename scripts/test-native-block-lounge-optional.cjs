// 다시보기·클립에서 "치지직 사용자 차단도 같이하기" 가 조용히 건너뛰던 문제.
//
// 증상: "치지직 차단은 채널 정보를 못 찾아 건너뛰었습니다(로컬 차단만 적용)."
//   토스트가 뜨고 네이티브 차단이 실행되지 않았다.
//
// 원인: blockCommentUser 가 getCommentBlockChannelId() 결과를 '필수 조건' 으로
//   보고, 비어 있으면 요청 자체를 하지 않았다. 커뮤니티는 URL 에 채널 ID 가
//   있어 대체로 성공하지만, /video/<no> 와 /clips/<uid> 는 URL 에 없고 DOM
//   폴백은 a[href="/<32hex>"] 만 봐서(다시보기 채널 링크는 /live/<32hex>)
//   못 찾는 경우가 있었다.
//
// 고침: loungeId 는 '있으면 함께 보내는 페이지 맥락' 으로 취급한다. 빈
//   loungeId 로도 실제 차단·해제가 적용되는 것이 실측으로 확인됐으므로,
//   채널 ID 가 없어도 요청은 그대로 보낸다.
//
// ⚠ 채널 ID 를 얻으려고 다시보기/클립 상세 API 를 새로 부르지 않는다.
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);

let failed = 0;
const ok = (c, l) => {
  console.log((c ? "  PASS " : "  FAIL ") + l);
  if (!c) failed += 1;
};

// ⚠ 로직을 손으로 베끼면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(name) {
  let at = SRC.indexOf(`  function ${name}(`);
  if (at < 0) at = SRC.indexOf(`  async function ${name}(`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

const BLOCK_FN = sliceFn("blockCommentUser");
const URL_FN = sliceFn("buildNativeUserBlockUrl");
const CHANNEL_FN = sliceFn("getCommentBlockChannelId");

// 구조만 확인한다(내용을 보면 규칙이 느슨해졌을 때 검사 전에 throw 되어
// 사보타주가 '실패 0건' 으로 보인다).
if (!/loungeId/.test(URL_FN) || !/fetch\(/.test(BLOCK_FN)) {
  throw Error("떼어 낸 구간이 차단 경로가 아니다");
}

// blockCommentUser 를 런타임 의존값과 함께 실행한다.
function runBlock({ channelId = "", native = true, fetchImpl } = {}) {
  const calls = [];
  const toasts = [];
  const commentBlocks = [];
  const env = {
    getCommentBlockChannelId: () => channelId,
    buildNativeUserBlockUrl: new Function(
      "return " + URL_FN.trim().replace(/^function /, "function "),
    )(),
    showCommentBlockToast: (t) => toasts.push(t),
    commentBlocks,
    commentBlockHashSet: new Set(),
    saveCommentBlocks: () => {},
    hideRenderedCommentsOf: () => {},
    hideRenderedChatOf: () => {},
    sweepChatBlocks: () => {},
    rebuildCommentBlockIndex: () => {},
    pushCommentBlocksToMain: () => {},
    collectNicknameHistory: () => [],
    vodNickByHash: new Map(),
    fetch: (url, opts) => {
      calls.push({ url, method: opts?.method });
      return fetchImpl
        ? fetchImpl(url, opts)
        : Promise.resolve({ ok: true, status: 200 });
    },
  };
  const names = Object.keys(env);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, BLOCK_FN + "\nreturn blockCommentUser;")(
    ...names.map((n) => env[n]),
  );
  // 실제 시그니처: (userHash, nickname, reason, native)
  return {
    run: (h, n) => fn(h, n, "", native),
    calls,
    toasts,
    commentBlocks,
  };
}

console.log("[URL] loungeId 는 있으면 넣고 없으면 비운다");
{
  const build = new Function("return " + URL_FN.trim())();
  ok(
    build("hash1", "458f6ec20b034f49e0fc6d03921646d2") ===
      "https://comm-api.game.naver.com/nng_main/v1/privateUserBlocks/hash1" +
        "?loungeId=458f6ec20b034f49e0fc6d03921646d2",
    "채널이 있으면 실제 값을 넣는다",
  );
  ok(
    build("hash1", "") ===
      "https://comm-api.game.naver.com/nng_main/v1/privateUserBlocks/hash1?loungeId=",
    "채널이 없으면 빈 loungeId",
  );
  ok(
    build("hash1") ===
      "https://comm-api.game.naver.com/nng_main/v1/privateUserBlocks/hash1?loungeId=",
    "인자를 생략해도 빈 loungeId",
  );
  ok(
    build("a b/c", "") ===
      "https://comm-api.game.naver.com/nng_main/v1/privateUserBlocks/a%20b%2Fc?loungeId=",
    "userHash 를 이스케이프한다",
  );
  // ⚠ null 이 들어오면 `|| ""` 가 없을 때 loungeId=null 이라는 잘못된 값이 나간다.
  //   기본 인자만으로는 null 을 못 막는다.
  for (const v of [null, undefined]) {
    ok(
      build("hash1", v).endsWith("?loungeId="),
      `${JSON.stringify(v)} 도 빈 loungeId 가 된다 (${build("hash1", v).slice(-20)})`,
    );
  }
}

console.log("\n[A] 채널 ID 가 있을 때 — 기존 동작 그대로");
(async () => {
  {
    const CH = "458f6ec20b034f49e0fc6d03921646d2";
    const t = runBlock({ channelId: CH });
    await t.run("hashA", "닉네임");
    ok(t.calls.length === 1, `POST 1회 (${t.calls.length})`);
    ok(t.calls[0].method === "POST", "POST 로 보낸다");
    ok(t.calls[0].url.includes(`loungeId=${CH}`), "실제 채널 ID 를 보낸다");
    ok(
      t.toasts.includes("차단했습니다(치지직 차단 포함)"),
      `성공 토스트 (${JSON.stringify(t.toasts)})`,
    );
    ok(
      t.commentBlocks[0]?.nativeBlocked === true,
      "nativeBlocked=true 로 기록",
    );
  }

  console.log("\n[B·핵심] 채널 ID 가 없어도 요청을 보낸다");
  {
    // 다시보기/클립에서 DOM 폴백이 실패한 상황.
    const t = runBlock({ channelId: "" });
    await t.run("hashB", "닉네임");
    // ⚠ 고치기 전에는 여기서 POST 가 0회였다.
    ok(t.calls.length === 1, `POST 1회 (${t.calls.length})`);
    ok(
      t.calls[0].url.endsWith("?loungeId="),
      `빈 loungeId 로 보낸다 (${t.calls[0].url.slice(-40)})`,
    );
    ok(
      t.toasts.includes("차단했습니다(치지직 차단 포함)"),
      "성공 토스트가 뜬다",
    );
    ok(
      !t.toasts.some((x) => x.includes("채널 정보를 못 찾아")),
      "'채널 정보를 못 찾아' 토스트가 없다",
    );
    ok(
      t.commentBlocks[0]?.nativeBlocked === true,
      "채널이 없어도 nativeBlocked=true",
    );
  }

  console.log("\n[C] 옵션이 꺼져 있으면 네이티브 요청 없음");
  {
    const t = runBlock({ channelId: "", native: false });
    await t.run("hashC", "닉네임");
    ok(t.calls.length === 0, `네이티브 요청 0회 (${t.calls.length})`);
    ok(t.toasts.includes("차단했습니다."), "로컬 차단 토스트");
    ok(t.commentBlocks[0]?.nativeBlocked !== true, "nativeBlocked 는 false");
    ok(t.commentBlocks.length === 1, "로컬 차단은 그대로 적용된다");
  }

  console.log("\n[D] HTTP 실패 — 로컬 차단은 유지된다");
  {
    for (const status of [403, 500]) {
      const t = runBlock({
        channelId: "",
        fetchImpl: () => Promise.resolve({ ok: false, status }),
      });
      await t.run("hashD", "닉네임");
      ok(t.calls.length === 1, `status ${status}: 요청은 보냈다`);
      ok(
        t.toasts.some(
          (x) => x === `로컬 차단됨. 치지직 차단 실패(status ${status})`,
        ),
        `status ${status}: 실패 토스트`,
      );
      ok(t.commentBlocks.length === 1, `status ${status}: 로컬 차단 유지`);
      ok(
        t.commentBlocks[0]?.nativeBlocked !== true,
        `status ${status}: nativeBlocked 는 false`,
      );
      ok(
        !t.toasts.some((x) => x.includes("채널 정보를 못 찾아")),
        `status ${status}: 채널 토스트 없음`,
      );
    }
  }

  console.log("\n[E] 네트워크 오류 — 로컬 차단은 유지된다");
  {
    const t = runBlock({
      channelId: "",
      fetchImpl: () => Promise.reject(new Error("network")),
    });
    await t.run("hashE", "닉네임");
    ok(t.calls.length === 1, "요청 시도는 있었다");
    ok(
      t.toasts.includes("로컬 차단됨. 치지직 차단 요청에 실패했습니다."),
      "네트워크 실패 토스트",
    );
    ok(t.commentBlocks.length === 1, "로컬 차단 유지");
    ok(t.commentBlocks[0]?.nativeBlocked !== true, "nativeBlocked 는 false");
  }

  console.log("\n[페이지별] 커뮤니티 / 다시보기 / 클립");
  {
    // getCommentBlockChannelId 를 실제로 돌려 본다(경로별 결과 확인).
    const mkChannelFn = (pathname, html) => {
      const anchors = [];
      const re = /href="([^"]+)"/g;
      let m;
      while ((m = re.exec(html || ""))) anchors.push(m[1]);
      const env = {
        location: { pathname },
        document: {
          querySelectorAll: () =>
            anchors.map((h) => ({ getAttribute: () => h })),
        },
      };
      // eslint-disable-next-line no-new-func
      return new Function(
        "location",
        "document",
        CHANNEL_FN + "\nreturn getCommentBlockChannelId;",
      )(env.location, env.document);
    };
    const CH = "458f6ec20b034f49e0fc6d03921646d2";
    ok(
      mkChannelFn(`/${CH}/community/detail/28573760`)() === CH,
      "커뮤니티: URL 에서 채널 ID 를 찾는다",
    );
    // 다시보기·클립: 채널 DOM 이 없으면 빈 문자열.
    const vod = mkChannelFn("/video/15286926", "")();
    ok(vod === "", `다시보기(채널 DOM 없음): 빈 값 (${JSON.stringify(vod)})`);
    const clip = mkChannelFn("/clips/vgvkngHJF1", "")();
    ok(clip === "", `클립(채널 DOM 없음): 빈 값 (${JSON.stringify(clip)})`);

    // ⚠ 그 빈 값으로도 차단이 실행돼야 한다(이번 수정의 핵심).
    for (const [label, pathname] of [
      ["다시보기", "/video/15286926"],
      ["클립", "/clips/vgvkngHJF1"],
    ]) {
      const t = runBlock({ channelId: "" });
      await t.run("hashP", "닉네임");
      ok(t.calls.length === 1, `${label}: 네이티브 차단을 실행한다`);
      ok(t.calls[0].url.endsWith("?loungeId="), `${label}: 빈 loungeId`);
      void pathname;
    }
    // 다시보기 채널 링크가 /live/<id> 인 경우는 현재 폴백이 못 찾는다(알려진 한계).
    const live = mkChannelFn(
      "/video/15286926",
      `<a href="/live/${CH}">채널</a>`,
    )();
    ok(
      live === "",
      "다시보기의 /live/<id> 링크는 여전히 못 찾는다(맥락만 비게 될 뿐 차단은 된다)",
    );
  }

  console.log("\n[소스] 채널 ID 를 필수 조건으로 쓰지 않는다");
  {
    // ⚠ 예전 게이트가 돌아오면 이 검사가 잡는다.
    ok(
      !/채널 정보를 못 찾아/.test(SRC),
      "'채널 정보를 못 찾아' 토스트가 소스에서 사라졌다",
    );
    ok(
      !/if \(!userHash \|\| !channelId\)/.test(SRC),
      "해제 경로가 채널을 필수로 요구하지 않는다",
    );
    ok(!/"no-channel"/.test(SRC), "no-channel 응답 경로가 없다");
    // 세 경로가 같은 helper 로 URL 을 만든다.
    const uses = (SRC.match(/buildNativeUserBlockUrl\(/g) || []).length;
    ok(uses >= 4, `helper 를 공유한다 (정의 1 + 사용 ${uses - 1})`);
    // 차단 경로가 채널을 알아내려고 API 를 부르지 않는다.
    // ⚠ 소스 전체에 videos/clips API 가 있는지로 보면 안 된다. 다른 기능이
    //   이미 쓰고 있어 항상 잡힌다(실제로 오탐했다). 차단 경로 안만 본다.
    const blockPaths =
      BLOCK_FN +
      SRC.slice(
        SRC.indexOf('=== "CHEESE_NATIVE_UNBLOCK_USER"'),
        SRC.indexOf("return false;\n  });"),
      );
    ok(
      !/service\/v2\/videos|clips\/[^"]*\/detail|ownerChannel/.test(blockPaths),
      "차단·해제 경로가 채널 확인용 API 를 부르지 않는다",
    );
    ok(
      (blockPaths.match(/fetch\(/g) || []).length === 3,
      `차단 경로의 요청은 차단/해제뿐이다 (${(blockPaths.match(/fetch\(/g) || []).length})`,
    );
    // 폴링·옵저버도 추가하지 않았다.
    ok(
      !/setInterval|MutationObserver/.test(blockPaths),
      "폴링·옵저버를 추가하지 않는다",
    );
    // ⚠ 네이티브 실패는 로컬 차단을 되돌리지 않는다. 실패 분기에서 목록을
    //   다시 거르면(= 로컬 차단 취소) 사용자는 아무것도 차단하지 못한 채 끝난다.
    //   런타임 주입으로는 재대입이 안 보여서 소스로 고정한다.
    const nativeBranch = BLOCK_FN.slice(
      BLOCK_FN.indexOf("if (native) {"),
      BLOCK_FN.indexOf("} else {\n      showCommentBlockToast"),
    );
    ok(
      !/commentBlocks = /.test(nativeBranch),
      "네이티브 실패 분기가 로컬 차단 목록을 되돌리지 않는다",
    );
    ok(
      /entry\.nativeBlocked = true/.test(nativeBranch),
      "성공했을 때만 nativeBlocked 를 세운다",
    );
    // 해제는 hash 가 없을 때만 막는다.
    const unblockBlock = SRC.slice(
      SRC.indexOf('=== "CHEESE_NATIVE_UNBLOCK_USER"'),
      SRC.indexOf('=== "CHEESE_NATIVE_BLOCK_USER"'),
    );
    ok(
      /if \(!userHash\)/.test(unblockBlock),
      "해제는 userHash 없을 때만 막는다",
    );
    ok(/"no-hash"/.test(unblockBlock), "hash 누락은 no-hash 로 구분한다");
    ok(/method: "DELETE"/.test(unblockBlock), "해제는 DELETE 를 보낸다");
    ok(
      /buildNativeUserBlockUrl\(userHash, channelId\)/.test(unblockBlock),
      "해제도 같은 URL helper 를 쓴다",
    );
  }

  console.log("\n[회귀] 로컬 차단 부수 효과는 그대로다");
  {
    const t = runBlock({ channelId: "" });
    await t.run("hashR", "닉네임");
    ok(t.commentBlocks.length === 1, "로컬 entry 를 만든다");
    ok(t.commentBlocks[0].userIdHash === "hashR", "해시를 기록한다");
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
