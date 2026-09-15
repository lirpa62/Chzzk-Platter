// 멀티뷰 담아두기(스테이징) 규칙.
//
// 배경 스크립트가 정본을 들고 여러 치지직 탭의 추가·삭제·순서 변경을 받는다.
// ⚠ 이 파일은 background.js 의 규칙을 '복제' 한다. 원본을 고치면 여기도 고쳐야 한다
//   (background.js 는 서비스 워커 전역에 묶여 있어 Node 에서 그대로 부를 수 없다).

const MULTIVIEW_STAGED_MAX = 6;
const MULTIVIEW_CHANNEL_RE = /^[0-9a-f]{32}$/i;

// 세션 저장소 흉내(값 복제로 실제 storage 처럼 참조를 끊는다).
let store = {};
const session = {
  get: async (key) => ({ [key]: structuredClone(store[key]) }),
  set: async (obj) => {
    Object.assign(store, structuredClone(obj));
  },
};
const KEY = "cheeseMultiviewStaged";

let stagedWriteQueue = Promise.resolve();
function enqueueStagedWrite(task) {
  const result = stagedWriteQueue.then(task, task);
  stagedWriteQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

function sanitizeStagedItem(raw) {
  const channelId = String(raw?.channelId || "").toLowerCase();
  if (!MULTIVIEW_CHANNEL_RE.test(channelId)) return null;
  return {
    channelId,
    channelName: String(raw?.channelName ?? "").slice(0, 60),
    channelImageUrl: String(raw?.channelImageUrl ?? "").slice(0, 500),
  };
}

async function readStaged() {
  const rows = (await session.get(KEY))?.[KEY];
  if (!Array.isArray(rows)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    const item = sanitizeStagedItem(raw);
    if (!item || seen.has(item.channelId)) continue;
    seen.add(item.channelId);
    out.push(item);
    if (out.length >= MULTIVIEW_STAGED_MAX) break;
  }
  return out;
}

async function writeStaged(items) {
  await session.set({ [KEY]: items });
  return items;
}

async function handleStagedMessage(message) {
  const op = String(message?.op || "");
  if (op === "GET") return readStaged();
  return enqueueStagedWrite(async () => {
    const current = await readStaged();
    if (op === "ADD") {
      const item = sanitizeStagedItem(message.item);
      if (!item) throw new Error("invalid-channel");
      if (current.some((c) => c.channelId === item.channelId)) return current;
      if (current.length >= MULTIVIEW_STAGED_MAX) {
        const error = new Error("full");
        error.items = current;
        throw error;
      }
      return writeStaged([...current, item]);
    }
    if (op === "REMOVE") {
      const channelId = String(message.channelId || "").toLowerCase();
      return writeStaged(current.filter((c) => c.channelId !== channelId));
    }
    if (op === "CLEAR") return writeStaged([]);
    if (op === "REORDER") {
      const order = Array.isArray(message.order) ? message.order : [];
      const byId = new Map(current.map((c) => [c.channelId, c]));
      const next = [];
      for (const raw of order) {
        const id = String(raw || "").toLowerCase();
        const item = byId.get(id);
        if (!item) continue;
        byId.delete(id);
        next.push(item);
      }
      for (const leftover of byId.values()) next.push(leftover);
      return writeStaged(next);
    }
    throw new Error("unknown-op");
  });
}

const id = (n) => String(n).repeat(32).slice(0, 32);
const ch = (n, name) => ({ channelId: id(n), channelName: name || `채널${n}` });

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};
const reset = () => {
  store = {};
};

(async () => {
  console.log("[담기] 중복과 잘못된 값을 걸러낸다");
  reset();
  await handleStagedMessage({ op: "ADD", item: ch(1) });
  await handleStagedMessage({ op: "ADD", item: ch(1) }); // 같은 채널
  let items = await handleStagedMessage({ op: "GET" });
  ok(items.length === 1, "같은 채널을 두 번 담아도 하나만 남는다");

  let threw = "";
  try {
    await handleStagedMessage({ op: "ADD", item: { channelId: "짧다" } });
  } catch (error) {
    threw = error.message;
  }
  ok(threw === "invalid-channel", "잘못된 채널 번호는 거부한다");
  items = await handleStagedMessage({ op: "GET" });
  ok(items.length === 1, "거부돼도 기존 목록은 그대로다");

  console.log("\n[상한] 6개를 넘기지 않는다");
  reset();
  for (let i = 1; i <= 6; i += 1) {
    await handleStagedMessage({ op: "ADD", item: ch(i) });
  }
  threw = "";
  try {
    await handleStagedMessage({ op: "ADD", item: ch(7) });
  } catch (error) {
    threw = error.message;
  }
  ok(threw === "full", "7번째는 'full' 로 거부한다");
  items = await handleStagedMessage({ op: "GET" });
  ok(items.length === 6, "거부돼도 기존 6개는 그대로 남는다");
  ok(
    !items.some((c) => c.channelId === id(7)),
    "거부된 채널이 몰래 들어가지 않는다",
  );

  console.log("\n[동시 수정] 여러 탭이 한꺼번에 고쳐도 잃지 않는다");
  reset();
  // ⚠ 읽고-고치고-쓰기 사이가 벌어지면 마지막 쓰기만 남아 나머지가 사라진다.
  //   큐로 직렬화했으므로 동시에 보내도 전부 반영돼야 한다.
  await Promise.all([
    handleStagedMessage({ op: "ADD", item: ch(1) }),
    handleStagedMessage({ op: "ADD", item: ch(2) }),
    handleStagedMessage({ op: "ADD", item: ch(3) }),
    handleStagedMessage({ op: "ADD", item: ch(4) }),
  ]);
  items = await handleStagedMessage({ op: "GET" });
  ok(items.length === 4, `동시 추가 4건이 모두 남는다(실제 ${items.length}건)`);
  ok(
    new Set(items.map((c) => c.channelId)).size === items.length,
    "중복이 생기지 않는다",
  );

  // 추가와 삭제가 섞여도 마찬가지.
  await Promise.all([
    handleStagedMessage({ op: "ADD", item: ch(5) }),
    handleStagedMessage({ op: "REMOVE", channelId: id(2) }),
    handleStagedMessage({ op: "ADD", item: ch(6) }),
  ]);
  items = await handleStagedMessage({ op: "GET" });
  ok(
    items.length === 5 && !items.some((c) => c.channelId === id(2)),
    `추가·삭제가 섞여도 정확하다(${items.map((c) => c.channelName).join(",")})`,
  );

  console.log("\n[순서] channelId 기준으로 바꾼다");
  reset();
  for (const n of [1, 2, 3]) {
    await handleStagedMessage({ op: "ADD", item: ch(n) });
  }
  items = await handleStagedMessage({
    op: "REORDER",
    order: [id(3), id(1), id(2)],
  });
  ok(
    items.map((c) => c.channelId).join() === [id(3), id(1), id(2)].join(),
    "보낸 순서대로 바뀐다",
  );
  // ⚠ 순서를 보내는 사이 다른 탭이 새로 담았을 수 있다. 빠뜨리면 안 된다.
  await handleStagedMessage({ op: "ADD", item: ch(4) });
  items = await handleStagedMessage({
    op: "REORDER",
    order: [id(1), id(3)], // 2·4 는 빠진 옛 순서
  });
  ok(items.length === 4, `빠진 항목도 남는다(${items.length}개)`);
  ok(
    items
      .map((c) => c.channelId)
      .slice(0, 2)
      .join() === [id(1), id(3)].join(),
    "보낸 순서는 앞쪽에 반영된다",
  );

  console.log("\n[비우기]");
  items = await handleStagedMessage({ op: "CLEAR" });
  ok(items.length === 0, "모두 비운다");

  console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
  process.exit(fails ? 1 : 0);
})();
