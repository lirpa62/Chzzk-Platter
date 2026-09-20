// 멀티뷰 화면 정리(채팅 접기 + 넓은 화면) 수렴 규칙.
//
// 증상이었던 것: 멀티뷰를 켜면 '화면 정리를 완료하지 못했습니다' 가 뜨고 재적용을
// 두세 번 눌러야 됐다. 원인은 '한 번에 끝나는 절차' 로 다뤄 치지직 DOM 이 늦게 뜬
// 것까지 실패로 판정한 것이었다. 지금은 목표 상태로 계속 수렴시키기만 한다.
//
// ⚠ 이 파일은 content.js / audioMixer.js 의 규칙을 '복제' 한다. 원본을 고치면 여기도
//   함께 고쳐야 한다(브라우저 DOM 에 묶여 있어 Node 에서 그대로 못 부른다).

let fails = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    fails += 1;
  }
};

const FOLD_COOLDOWN = 700;
const WIDE_COOLDOWN = 1200;

// content.js 의 ensureMultiviewChatFold 와 같은 규칙.
function makeChat({
  aside = false,
  folded = false,
  button = false,
  ad = false,
} = {}) {
  let clicks = 0;
  let lastClickAt = -100000;
  let now = 0;
  const state = { aside, folded, button, ad };
  return {
    state,
    get clicks() {
      return clicks;
    },
    tick(ms) {
      now += ms;
    },
    ensure() {
      if (!state.aside) return false; // 채팅 DOM 이 아직 없다
      if (state.folded) return true;
      if (state.ad) return false; // 광고 중에는 억지로 누르지 않는다
      if (!state.button) return false; // 버튼이 아직 없다
      if (now - lastClickAt < FOLD_COOLDOWN) return false;
      clicks += 1;
      lastClickAt = now;
      state.folded = true; // 클릭이 먹었다고 본다
      return false; // 반영은 다음 확인에서
    },
  };
}

// audioMixer.js 의 ensureMultiviewWide 와 같은 규칙.
function makeWide({ button = false, wide = false, wanted = true } = {}) {
  let clicks = 0;
  let lastClickAt = -100000;
  let now = 0;
  const state = { button, wide, wanted };
  return {
    state,
    get clicks() {
      return clicks;
    },
    tick(ms) {
      now += ms;
    },
    ensure() {
      if (!state.wanted) return true;
      if (!state.button) return false; // viewmode 버튼이 아직 없다
      if (state.wide) return true; // ⚠ 이미 넓으면 절대 다시 누르지 않는다
      if (now - lastClickAt < WIDE_COOLDOWN) return false;
      clicks += 1;
      lastClickAt = now;
      state.wide = true;
      return false;
    },
  };
}

console.log("[늦은 DOM] 늦게 생겨도 생기는 즉시 맞춘다(오류 아님)");
{
  const chat = makeChat({ aside: false, button: false });
  const wide = makeWide({ button: false });
  // 0초: 아무것도 없다 — '아직' 일 뿐이다.
  ok(chat.ensure() === false, "채팅 DOM 이 없으면 아직(false)");
  ok(wide.ensure() === false, "viewmode 버튼이 없으면 아직(false)");
  ok(chat.clicks === 0 && wide.clicks === 0, "없는 것을 누르지 않는다");

  // 5초: 채팅 DOM 이 생긴다.
  chat.tick(5000);
  wide.tick(5000);
  chat.state.aside = true;
  chat.state.button = true;
  chat.ensure();
  ok(chat.state.folded === true, "채팅이 생기면 바로 접는다");

  // 9초: viewmode 버튼이 생긴다.
  chat.tick(4000);
  wide.tick(4000);
  wide.state.button = true;
  wide.ensure();
  ok(wide.state.wide === true, "버튼이 생기면 바로 넓은 화면으로");
  ok(
    chat.ensure() === true && wide.ensure() === true,
    "둘 다 목표 상태가 된다",
  );
}

console.log("\n[이미 목표 상태] 아무것도 누르지 않는다");
{
  const chat = makeChat({ aside: true, folded: true, button: true });
  const wide = makeWide({ button: true, wide: true });
  ok(chat.ensure() === true && chat.clicks === 0, "이미 접혀 있으면 안 누른다");
  ok(wide.ensure() === true && wide.clicks === 0, "이미 넓으면 안 누른다");
  // 여러 번 불러도 마찬가지(토글이라 다시 누르면 좁아진다).
  for (let i = 0; i < 5; i += 1) {
    chat.tick(1000);
    wide.tick(1000);
    chat.ensure();
    wide.ensure();
  }
  ok(chat.clicks === 0, "반복 호출해도 채팅을 왕복시키지 않는다");
  ok(
    wide.clicks === 0 && wide.state.wide === true,
    "반복 호출해도 좁아지지 않는다",
  );
}

console.log("\n[되돌려짐] 치지직이 UI 를 다시 만들면 다시 맞춘다");
{
  const chat = makeChat({ aside: true, folded: true, button: true });
  const wide = makeWide({ button: true, wide: true });
  chat.tick(30000);
  wide.tick(30000);
  // 치지직이 플레이어·채팅을 다시 만들었다.
  chat.state.folded = false;
  wide.state.wide = false;
  chat.ensure();
  wide.ensure();
  ok(chat.state.folded === true, "다시 펼쳐지면 다시 접는다");
  ok(wide.state.wide === true, "좁아지면 다시 넓힌다");
  ok(chat.clicks === 1 && wide.clicks === 1, "필요할 때만 한 번씩 누른다");
}

console.log("\n[연타 방지] 쿨다운 안에는 다시 누르지 않는다");
{
  const chat = makeChat({ aside: true, button: true });
  chat.ensure(); // 한 번 누른다
  ok(chat.clicks === 1, "처음에는 누른다");
  chat.state.folded = false; // 아직 반영되지 않았다고 가정
  chat.tick(100);
  chat.ensure();
  ok(chat.clicks === 1, "쿨다운 안에는 다시 누르지 않는다");
  chat.tick(FOLD_COOLDOWN);
  chat.ensure();
  ok(chat.clicks === 2, "쿨다운이 지나면 다시 시도한다");
}

console.log("\n[광고] 광고 중에는 억지로 누르지 않는다");
{
  const chat = makeChat({ aside: true, button: true, ad: true });
  for (let i = 0; i < 5; i += 1) {
    chat.tick(1000);
    chat.ensure();
  }
  ok(chat.clicks === 0, "광고 중에는 한 번도 누르지 않는다");
  chat.state.ad = false; // 광고가 끝났다
  chat.ensure();
  ok(chat.clicks === 1 && chat.state.folded === true, "광고가 끝나면 접는다");
}

console.log("\n[끄면 그대로] 넓은 화면을 원하지 않으면 손대지 않는다");
{
  const wide = makeWide({ button: true, wide: false, wanted: false });
  ok(wide.ensure() === true, "원하지 않으면 목표 달성으로 본다");
  ok(wide.clicks === 0, "누르지 않는다");
}

console.log("\n[6칸] 각자 다른 시점에 독립적으로 수렴한다");
{
  // 칸마다 viewmode 버튼이 생기는 시각이 다르다.
  const readyAt = { A: 2000, B: 8000, C: 4000, D: 11000, E: 5000, F: 6000 };
  const frames = {};
  for (const id of Object.keys(readyAt))
    frames[id] = makeWide({ button: false });
  // 400ms 간격으로 확인한다(초기 수렴).
  for (let t = 0; t <= 15000; t += 400) {
    for (const [id, w] of Object.entries(frames)) {
      w.tick(400);
      if (t >= readyAt[id]) w.state.button = true;
      w.ensure();
    }
  }
  const done = Object.entries(frames).filter(([, w]) => w.state.wide);
  ok(done.length === 6, `6칸 모두 넓은 화면(${done.length}칸)`);
  ok(
    Object.values(frames).every((w) => w.clicks === 1),
    "칸마다 한 번씩만 눌렀다",
  );
}

console.log(fails ? `\n실패 ${fails}건` : "\n전부 통과");
process.exit(fails ? 1 : 0);
