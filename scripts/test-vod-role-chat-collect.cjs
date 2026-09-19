// 다시보기 방장·매니저 채팅 모으기 안정화 검증.
//
// 제보: "진행이 멈추거나 초기화되거나."
//
// 재현으로 확정한 원인(모두 실제 코드 흐름을 옮겨 확인했다):
//  1. 한 페이지가 실패하면(5xx·네트워크) 그대로 중단하고, 모은 것을 통째로
//     버렸다(!result.complete → return). 긴 다시보기는 수백 페이지라 한 번의
//     흔들림으로도 끝났고, 화면에는 0% 로 '초기화' 된 것처럼 보였다.
//  2. 중간에 빈 페이지가 오면 다음 위치가 정상인데도 '완료' 로 끝냈다.
//  3. 재시도가 아예 없었고, 응답을 기다리는 시간 제한도 없었다.
//  4. 늦게 끝난 예전 작업의 finally 가 새 작업의 중단 신호(cancel)까지 지웠다.
//
// ⚠ 페이지 루프는 DOM/fetch 에 묶여 있어 Node 에서 그대로 못 부른다. 그래서
//   원본에서 규칙을 옮겨 검증하되, 아래 [소스] 절에서 원본이 그 규칙을 실제로
//   갖고 있는지 함께 확인한다.

const fs = require("fs");
const path = require("path");

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

const PAGE_RETRY_MAX = 3;
const PAGE_SIZE = 50;

// content.js 의 collectVodRoleChats 와 같은 규칙.
function makeCollector({ fetchImpl, cancelRef, videoNoRef, maxPages = 1500 }) {
  return async function collect(videoNo, onProgress) {
    const items = [];
    const totalMs = 3600 * 1000;
    let cursor = 0;
    let completed = false;
    let aborted = false;
    let failedRun = false;
    let requests = 0;
    for (let page = 0; page < maxPages; page += 1) {
      let content = null;
      let gotPage = false;
      for (let attempt = 0; attempt < PAGE_RETRY_MAX; attempt += 1) {
        if (cancelRef.value || videoNoRef.value !== videoNo) {
          aborted = true;
          break;
        }
        requests += 1;
        try {
          const res = await fetchImpl(cursor);
          if (res.ok) {
            content = (await res.json())?.content;
            gotPage = true;
            break;
          }
          if (res.status === 400) {
            completed = true;
            gotPage = true;
            content = null;
            break;
          }
          if (res.status !== 429 && res.status < 500) break;
        } catch {
          // 다시 시도한다.
        }
      }
      if (aborted) break;
      if (!gotPage) {
        failedRun = true;
        break;
      }
      if (completed) break;
      if (cancelRef.value || videoNoRef.value !== videoNo) {
        aborted = true;
        break;
      }
      const list = Array.isArray(content?.videoChats)
        ? content.videoChats
        : content?.previousVideoChats;
      for (const m of Array.isArray(list) ? list : []) items.push(m);
      const next = Number(content?.nextPlayerMessageTime);
      if (!Number.isFinite(next) || next <= cursor) {
        completed = true;
        break;
      }
      cursor = next;
      onProgress?.(Math.max(0, Math.min(1, cursor / totalMs)));
    }
    const complete =
      completed &&
      !failedRun &&
      !cancelRef.value &&
      videoNoRef.value === videoNo;
    return { complete, failed: failedRun, aborted, items, requests, cursor };
  };
}

const okPage = (cursor, n = PAGE_SIZE) => ({
  ok: true,
  status: 200,
  json: async () => ({
    content: {
      videoChats: Array.from({ length: n }, (_, i) => ({ id: cursor + i })),
      nextPlayerMessageTime: cursor + 60000,
    },
  }),
});
const endPage = () => ({
  ok: true,
  status: 200,
  json: async () => ({ content: { videoChats: [] } }),
});
const refs = () => ({
  cancelRef: { value: false },
  videoNoRef: { value: "1" },
});

(async () => {
  console.log("[A] 정상 다시보기 — 끝까지 모은다");
  {
    let n = 0;
    const r = await makeCollector({
      ...refs(),
      fetchImpl: async (c) => (++n > 3 ? endPage() : okPage(c)),
    })("1");
    ok(r.complete && !r.failed, `완료 (메시지 ${r.items.length}개)`);
  }

  console.log("\n[B] 긴 다시보기 — 진행이 계속 올라간다");
  {
    let n = 0;
    const seen = [];
    const r = await makeCollector({
      ...refs(),
      fetchImpl: async (c) => (++n > 300 ? endPage() : okPage(c)),
    })("1", (p) => seen.push(p));
    ok(r.complete, `완료 (페이지 300, 메시지 ${r.items.length}개)`);
    ok(
      seen.every((v, i) => i === 0 || v >= seen[i - 1]),
      "진행률이 뒤로 가지 않는다",
    );
  }

  console.log("\n[C] 한 페이지 일시 실패 — 재시도로 이어 간다");
  {
    let n = 0;
    const r = await makeCollector({
      ...refs(),
      fetchImpl: async (c) => {
        n += 1;
        if (n === 10) return { ok: false, status: 500 };
        return n > 20 ? endPage() : okPage(c);
      },
    })("1");
    ok(r.complete && !r.failed, "일시 오류를 넘기고 완료한다");
    ok(r.items.length > 0, `앞서 모은 것이 남아 있다 (${r.items.length}개)`);
  }

  console.log("\n[D] 계속 실패 — 모은 것은 남기고 실패로 끝낸다");
  {
    let n = 0;
    const r = await makeCollector({
      ...refs(),
      fetchImpl: async (c) => {
        n += 1;
        if (n > 5) return { ok: false, status: 500 };
        return okPage(c);
      },
    })("1");
    ok(r.failed && !r.complete, "실패로 끝난다(무한 로딩이 아니다)");
    ok(
      r.items.length === 5 * PAGE_SIZE,
      `모은 것은 남는다 (${r.items.length}개)`,
    );
    // ⚠ 재시도가 무한이면 안 된다.
    ok(r.requests <= 5 + PAGE_RETRY_MAX, `재시도가 제한된다 (${r.requests}회)`);
  }

  console.log("\n[E] 사용자가 중단 — 오류가 아니다");
  {
    const ref = refs();
    let n = 0;
    const r = await makeCollector({
      ...ref,
      fetchImpl: async (c) => {
        n += 1;
        if (n === 3) ref.cancelRef.value = true;
        return okPage(c);
      },
    })("1");
    ok(r.aborted && !r.failed, "중단은 실패로 보지 않는다");
  }

  console.log("\n[G] 다른 영상으로 이동 — 즉시 멈춘다");
  {
    const ref = refs();
    let n = 0;
    const r = await makeCollector({
      ...ref,
      fetchImpl: async (c) => {
        n += 1;
        if (n === 3) ref.videoNoRef.value = "2";
        return okPage(c);
      },
    })("1");
    ok(r.aborted && !r.complete, "영상이 바뀌면 멈춘다");
  }

  console.log("\n[L] 같은 위치만 주는 API — 무한 루프가 없다");
  {
    const r = await makeCollector({
      ...refs(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: { videoChats: [{ id: 1 }], nextPlayerMessageTime: 0 },
        }),
      }),
    })("1");
    ok(r.requests < 10, `한 번에 끝난다 (${r.requests}회)`);
  }

  console.log("\n[M] 중간 빈 페이지 — 뒤를 잃지 않는다");
  {
    let n = 0;
    const r = await makeCollector({
      ...refs(),
      fetchImpl: async (c) => {
        n += 1;
        if (n === 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              content: { videoChats: [], nextPlayerMessageTime: c + 60000 },
            }),
          };
        }
        return n > 5 ? endPage() : okPage(c);
      },
    })("1");
    // 빈 페이지에서 끝냈다면 1페이지치(50개)만 남는다.
    ok(
      r.items.length > PAGE_SIZE,
      `빈 페이지 뒤도 모은다 (${r.items.length}개)`,
    );
    ok(r.complete, "끝까지 가서 완료한다");
  }

  console.log("\n[F] 늦게 끝난 예전 작업이 새 작업을 망가뜨리지 않는다");
  {
    // content.js 의 finally 규칙과 같다.
    const state = { videoNo: "", loading: false, cancel: false };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ensure = async (videoNo, delay) => {
      if (!videoNo || state.loading) return;
      state.videoNo = videoNo;
      state.loading = true;
      state.cancel = false;
      try {
        await sleep(delay);
      } finally {
        if (state.videoNo === videoNo) {
          state.loading = false;
          state.cancel = false;
        }
      }
    };
    const slow = ensure("100", 60);
    await sleep(10);
    state.videoNo = "200"; // 다른 영상으로 이동
    state.cancel = true; // 새 작업이 중단을 건다
    await slow;
    ok(state.cancel === true, "예전 작업이 새 중단 신호를 지우지 않는다");
    ok(state.loading === true, "예전 작업이 새 작업의 진행 표시를 끄지 않는다");
  }

  console.log("\n[소스] 원본이 실제로 그 규칙을 갖고 있다");
  {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "content.js"),
      "utf8",
    );
    const fn = src.slice(
      src.indexOf("async function collectVodRoleChats"),
      src.indexOf("async function ensureVodRoleChats"),
    );
    ok(/PAGE_RETRY_MAX/.test(fn), "페이지 재시도가 있다");
    ok(/PAGE_TIMEOUT_MS/.test(fn), "응답 대기 시간 제한이 있다");
    ok(/AbortController/.test(fn), "시간 초과를 위해 요청을 끊는다");
    // ⚠ 빈 페이지를 완료로 치면 뒤를 잃는다.
    ok(
      !/if \(!Array\.isArray\(list\) \|\| !list\.length\) \{\s*completed = true;/.test(
        fn,
      ),
      "빈 페이지를 완료로 치지 않는다",
    );
    ok(/failed/.test(fn), "실패를 중단과 구분해 돌려준다");
    const ensure = src.slice(
      src.indexOf("async function ensureVodRoleChats"),
      src.indexOf("function resetRoleChatIfVideoChanged"),
    );
    ok(
      /if \(roleChatState\.videoNo === videoNo\) \{/.test(ensure),
      "finally 가 현재 작업일 때만 상태를 되돌린다",
    );
    ok(
      /roleChatState\.items = result\.items;\s*\}\s*roleChatState\.failed/.test(
        ensure,
      ),
      "끝까지 못 가도 모은 것을 화면에 남긴다",
    );
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  process.exit(failed ? 1 : 0);
})();
