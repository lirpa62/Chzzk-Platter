// 멀티뷰 시청 화면의 setup 검증 규칙.
//
// 세션 저장소에서 읽은 값을 그대로 믿으면 안 된다(다른 탭·이전 버전·손상된 값).
// multiviewWatch.js 의 validateSetup 과 같은 규칙을 여기서 검증한다.
//
// ⚠ 이 파일은 규칙을 '복제' 한다. 원본을 고치면 여기도 함께 고쳐야 한다.
//   (multiviewWatch.js 는 DOM 에 묶인 IIFE 라 Node 에서 그대로 부를 수 없다.)

const assert = require("node:assert/strict");
const L = require("../src/multiviewLayouts.js");

const HASH_RE = /^[0-9a-f]{32}$/i;

function validateSetup(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seen = new Set();
  const chosen = (Array.isArray(raw.chosen) ? raw.chosen : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      channelId: String(c.channelId || "").toLowerCase(),
      channelName: String(c.channelName ?? ""),
      channelImageUrl: String(c.channelImageUrl ?? ""),
    }))
    .filter((c) => {
      if (!HASH_RE.test(c.channelId) || seen.has(c.channelId)) return false;
      seen.add(c.channelId);
      return true;
    })
    .slice(0, 6);
  if (chosen.length < 2) return null;
  const allowed = L.layoutsFor(chosen.length);
  if (!allowed.length) return null;
  const layout = allowed.find((l) => l.id === raw.layoutId) || allowed[0];
  const chatSide = L.CHAT_SIDES.includes(raw.chatSide)
    ? raw.chatSide
    : layout.chat?.[0] || "right";
  return {
    chosen,
    layoutId: layout.id,
    chatSide,
    mainHighQuality: raw.mainHighQuality !== false,
  };
}

const id = (n) => String(n).repeat(32).slice(0, 32);
const A = id(1);
const B = id(2);
const C = id(3);
const ch = (channelId, channelName = "채널") => ({ channelId, channelName });

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};

console.log("[깨진 입력] 빈 화면 안내로 떨어져야 한다");
for (const [label, value] of [
  ["null", null],
  ["문자열", "설정"],
  ["빈 객체", {}],
  ["chosen 이 배열이 아님", { chosen: "AB" }],
  ["채널 1개", { chosen: [ch(A)] }],
  ["잘못된 channelId", { chosen: [ch("짧다"), ch("zzzz")] }],
  ["중복 제거 후 1개", { chosen: [ch(A), ch(A)] }],
]) {
  ok(validateSetup(value) === null, `${label} → null`);
}

console.log("\n[정상 입력] 값을 정리해 돌려준다");
const two = validateSetup({
  chosen: [ch(A, "가"), ch(B, "나")],
  layoutId: "right-1",
  chatSide: "left",
  mainHighQuality: false,
});
ok(two?.chosen.length === 2, "2채널을 그대로 받는다");
ok(two?.layoutId === "right-1", "허용되는 배치는 유지한다");
ok(two?.chatSide === "left", "허용되는 채팅 자리는 유지한다");
ok(two?.mainHighQuality === false, "mainHighQuality false 를 지킨다");
ok(
  validateSetup({ chosen: [ch(A), ch(B)] })?.mainHighQuality === true,
  "값이 없으면 고화질 시작이 기본",
);

console.log("\n[어긋난 값] 안전한 기본값으로 고친다");
const wrongLayout = validateSetup({
  chosen: [ch(A), ch(B)],
  layoutId: "grid-3x2", // 6채널용 배치를 2채널에 준 경우
});
ok(
  wrongLayout && L.layoutsFor(2).some((l) => l.id === wrongLayout.layoutId),
  `채널 수에 안 맞는 배치는 허용 목록의 첫 배치로(${wrongLayout?.layoutId})`,
);
const wrongSide = validateSetup({
  chosen: [ch(A), ch(B)],
  layoutId: "right-1",
  chatSide: "top", // 위쪽은 제공하지 않는다
});
ok(
  wrongSide && L.CHAT_SIDES.includes(wrongSide.chatSide),
  `허용 안 되는 채팅 자리는 기본값으로(${wrongSide?.chatSide})`,
);
// 배치와 무관하게 셋 다 받아야 한다.
for (const side of L.CHAT_SIDES) {
  const got = validateSetup({
    chosen: [ch(A), ch(B)],
    layoutId: "right-1",
    chatSide: side,
  });
  ok(got?.chatSide === side, `right-1 에서도 채팅 ${side} 를 그대로 받는다`);
}

console.log("\n[정리] 중복·초과를 걸러낸다");
const dup = validateSetup({ chosen: [ch(A), ch(A), ch(B), ch(C)] });
ok(dup?.chosen.length === 3, "중복 channelId 를 하나만 남긴다");
const many = validateSetup({
  chosen: Array.from({ length: 9 }, (_, i) => ch(id(i))),
});
ok(many === null || many.chosen.length <= 6, "6개를 넘지 않는다");
const upper = validateSetup({
  chosen: [ch(A.toUpperCase()), ch(B)],
});
ok(upper?.chosen[0].channelId === A, "대문자 channelId 를 소문자로 맞춘다");
ok(
  validateSetup({ chosen: [ch(A), { channelId: B, channelName: null }] })
    ?.chosen[1].channelName === "",
  "channelName 이 문자열이 아니면 빈 문자열로",
);

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
