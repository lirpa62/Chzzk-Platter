// 팝업 플레이어 버튼 설정이 일반 플레이어 설정을 상속하던 문제.
//
// 증상: 일반 라이브/다시보기에서 오디오 믹서·비디오 필터를 '숨김' 으로 두면,
//   팝업 플레이어 설정에서 그 버튼을 '표시' 로 켜도 팝업에 버튼이 없었다.
//
// 원인: getEffectiveFeatureFlags 의 팝업 분기가
//   1) '기능도 끄기' 가 꺼져 있으면 전역 플래그를 그대로 돌려주고
//   2) 켜져 있어도 '끄기'(true)만 더할 뿐, 표시로 둔 기능을 false 로
//      되살리지 않았다.
//   featureFlags[key] === true 는 '숨김/비활성' 이므로, 전역 숨김이 그대로
//   남아 MAIN world 가 버튼을 만들지 않았다.
//
// 고침: 팝업이 관리하는 기능은 전역 숨김을 상속하지 않고 팝업 설정만으로
//   정한다(표시로 둔 기능은 반드시 false 로 되살린다).
//
// ⚠ 멀티뷰 칸은 팝업과 다른 기능이다. 멀티뷰 전용 설정을 따르는 기존 분기를
//   깨지 않는지도 함께 검사한다.
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "content.js"),
  "utf8",
);

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

// ⚠ 규칙을 손으로 베껴 두면 원본이 바뀌어도 통과한다. 원본에서 떼어 온다.
function sliceFn(name) {
  const at = SRC.indexOf(`  function ${name}() {`);
  if (at < 0) throw Error(`함수를 찾지 못했다: ${name}`);
  const end = SRC.indexOf("\n  }\n", at);
  if (end < at) throw Error(`함수 끝을 찾지 못했다: ${name}`);
  return SRC.slice(at, end + 4);
}

const FN = sliceFn("getEffectiveFeatureFlags");
if (!/IS_POPUP_PLAYER_FRAME/.test(FN) || !/popupPlayerDisableHidden/.test(FN)) {
  throw Error("떼어 낸 구간이 플래그 계산 함수가 아니다");
}

// PLAYER_HIDE_ONLY_FLAGS 도 원본에서(일반 플레이어 분기가 참조한다).
const HIDE_ONLY = (() => {
  const at = SRC.indexOf("  const PLAYER_HIDE_ONLY_FLAGS = [");
  const end = SRC.indexOf("];", at);
  return SRC.slice(at, end + 2);
})();

// 런타임 변수를 밖에서 주입해 실제 함수를 돌린다.
function evaluate(ctx) {
  const body = `
    ${HIDE_ONLY}
    ${FN}
    return getEffectiveFeatureFlags();
  `;
  const names = Object.keys(ctx);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...names, body);
  return fn(...names.map((n) => ctx[n]));
}

const base = (over = {}) => ({
  featureFlags: {},
  IS_MULTIVIEW_CHAT_FRAME: false,
  IS_MULTIVIEW_FRAME: false,
  IS_POPUP_PLAYER_FRAME: false,
  multiviewBtnMixer: false,
  multiviewBtnFilter: false,
  multiviewBtnSync: false,
  multiviewBtnStats: false,
  multiviewBtnScreenshot: false,
  multiviewBtnRewind: false,
  multiviewBtnForward: false,
  popupPlayerBtnMixer: false,
  popupPlayerBtnFilter: false,
  popupPlayerBtnSync: false,
  popupPlayerBtnStats: false,
  popupPlayerBtnScreenshot: false,
  popupPlayerBtnRewind: false,
  popupPlayerBtnForward: false,
  popupPlayerDisableHidden: false,
  playerDisableHidden: true,
  ...over,
});

// 일반 플레이어에서 모두 숨겨 둔 상태(문제가 나던 조건).
const ALL_HIDDEN = {
  audioMixer: true,
  videoFilter: true,
  liveSync: true,
  streamStats: true,
  screenshotButton: true,
  liveRewind: true,
};

const popup = (over) =>
  evaluate(base({ IS_POPUP_PLAYER_FRAME: true, ...over }));

console.log("[A] 일반 숨김 + 팝업 표시 + 기능도끄기 OFF — 기능이 살아난다");
{
  const f = popup({
    featureFlags: { ...ALL_HIDDEN },
    popupPlayerBtnMixer: true,
    popupPlayerBtnFilter: true,
  });
  // ⚠ 고치기 전에는 여기서 전역 숨김(true)이 그대로 남았다.
  ok(f.audioMixer === false, `믹서 기능 ON (audioMixer=${f.audioMixer})`);
  ok(f.videoFilter === false, `필터 기능 ON (videoFilter=${f.videoFilter})`);
}

console.log("\n[B] 일반 숨김 + 팝업 표시 + 기능도끄기 ON — 기능이 살아난다");
{
  const f = popup({
    featureFlags: { ...ALL_HIDDEN },
    popupPlayerDisableHidden: true,
    popupPlayerBtnMixer: true,
    popupPlayerBtnFilter: true,
  });
  ok(f.audioMixer === false, `믹서 기능 ON (audioMixer=${f.audioMixer})`);
  ok(f.videoFilter === false, `필터 기능 ON (videoFilter=${f.videoFilter})`);
}

console.log("\n[C] 일반 표시 + 팝업 숨김 + 기능도끄기 OFF — 기능은 남는다");
{
  const f = popup({
    featureFlags: {},
    popupPlayerBtnMixer: false,
    popupPlayerBtnFilter: false,
  });
  // 표시는 CSS(cheese-popup-btn-*)가 담당하므로 기능 자체는 살아 있어야 한다.
  ok(f.audioMixer === false, `믹서 기능 유지 (audioMixer=${f.audioMixer})`);
  ok(f.videoFilter === false, `필터 기능 유지 (videoFilter=${f.videoFilter})`);
}

console.log("\n[D] 일반 표시 + 팝업 숨김 + 기능도끄기 ON — 기능이 꺼진다");
{
  const f = popup({
    featureFlags: {},
    popupPlayerDisableHidden: true,
    popupPlayerBtnMixer: false,
    popupPlayerBtnFilter: false,
  });
  ok(f.audioMixer === true, `믹서 기능 OFF (audioMixer=${f.audioMixer})`);
  ok(f.videoFilter === true, `필터 기능 OFF (videoFilter=${f.videoFilter})`);
}

console.log("\n[전 항목] sync/stats/screenshot 도 같은 규칙을 따른다");
{
  for (const [flag, btn] of [
    ["liveSync", "popupPlayerBtnSync"],
    ["streamStats", "popupPlayerBtnStats"],
    ["screenshotButton", "popupPlayerBtnScreenshot"],
  ]) {
    const on = popup({ featureFlags: { ...ALL_HIDDEN }, [btn]: true });
    ok(on[flag] === false, `${flag}: 일반 숨김이어도 팝업 표시면 ON`);
    const offKeep = popup({ featureFlags: {}, [btn]: false });
    ok(offKeep[flag] === false, `${flag}: 팝업 숨김 + 기능도끄기 OFF 면 유지`);
    const offKill = popup({
      featureFlags: {},
      popupPlayerDisableHidden: true,
      [btn]: false,
    });
    ok(offKill[flag] === true, `${flag}: 팝업 숨김 + 기능도끄기 ON 이면 OFF`);
  }
}

console.log("\n[되감기] 한 쌍 정책 — 하나라도 표시면 기능은 살아 있다");
{
  const hiddenGlobal = { featureFlags: { ...ALL_HIDDEN } };
  ok(
    popup({ ...hiddenGlobal, popupPlayerBtnRewind: true }).liveRewind === false,
    "되감기만 표시해도 기능 ON",
  );
  ok(
    popup({ ...hiddenGlobal, popupPlayerBtnForward: true }).liveRewind ===
      false,
    "앞으로만 표시해도 기능 ON",
  );
  ok(
    popup({
      featureFlags: {},
      popupPlayerDisableHidden: true,
      popupPlayerBtnRewind: false,
      popupPlayerBtnForward: false,
    }).liveRewind === true,
    "둘 다 숨김 + 기능도끄기 ON 이면 기능 OFF",
  );
  ok(
    popup({
      featureFlags: {},
      popupPlayerDisableHidden: true,
      popupPlayerBtnRewind: true,
      popupPlayerBtnForward: false,
    }).liveRewind === false,
    "한쪽만 표시면 기능 ON(기능도끄기 ON 이어도)",
  );
  ok(
    popup({
      featureFlags: { ...ALL_HIDDEN },
      popupPlayerBtnRewind: false,
      popupPlayerBtnForward: false,
    }).liveRewind === false,
    "둘 다 숨김이어도 기능도끄기 OFF 면 기능 유지",
  );
}

console.log("\n[독립성] 일반 플레이어 설정이 팝업 결과를 바꾸지 않는다");
{
  // ⚠ 핵심 성질: 같은 팝업 설정이면 전역 숨김 상태와 무관하게 결과가 같아야 한다.
  for (const disableHidden of [false, true]) {
    for (const visible of [false, true]) {
      const withHidden = popup({
        featureFlags: { ...ALL_HIDDEN },
        popupPlayerDisableHidden: disableHidden,
        popupPlayerBtnMixer: visible,
      });
      const withVisible = popup({
        featureFlags: {},
        popupPlayerDisableHidden: disableHidden,
        popupPlayerBtnMixer: visible,
      });
      ok(
        withHidden.audioMixer === withVisible.audioMixer,
        `기능도끄기=${disableHidden} 표시=${visible} 일 때 전역과 무관 ` +
          `(${withHidden.audioMixer} === ${withVisible.audioMixer})`,
      );
    }
  }
}

console.log("\n[멀티뷰] 팝업 설정이 멀티뷰 칸에 새지 않는다");
{
  // 멀티뷰는 자기 설정만 따른다. 팝업 버튼을 모두 켜도 영향이 없어야 한다.
  const f = evaluate(
    base({
      IS_MULTIVIEW_FRAME: true,
      featureFlags: {},
      multiviewBtnMixer: false,
      multiviewBtnFilter: false,
      popupPlayerBtnMixer: true,
      popupPlayerBtnFilter: true,
      popupPlayerDisableHidden: true,
    }),
  );
  ok(f.audioMixer === true, "멀티뷰는 멀티뷰 설정대로 믹서 OFF");
  ok(f.videoFilter === true, "멀티뷰는 멀티뷰 설정대로 필터 OFF");
  // ⚠ 멀티뷰는 전역 숨김을 그대로 상속한다(현재 동작). 이번 수정 대상이 아니라
  //   현 상태를 고정만 해 둔다. 팝업 수정이 멀티뷰로 새면 이 값이 바뀐다.
  const on = evaluate(
    base({
      IS_MULTIVIEW_FRAME: true,
      featureFlags: { ...ALL_HIDDEN },
      multiviewBtnMixer: true,
    }),
  );
  ok(on.audioMixer === true, "멀티뷰는 전역 숨김을 그대로 따른다(기존 동작)");
  // 멀티뷰 채팅 칸은 전역 그대로.
  const chat = evaluate(
    base({
      IS_MULTIVIEW_CHAT_FRAME: true,
      featureFlags: { ...ALL_HIDDEN },
      popupPlayerBtnMixer: true,
    }),
  );
  ok(chat.audioMixer === true, "멀티뷰 채팅 칸은 전역 플래그를 그대로 쓴다");
}

console.log("\n[일반 플레이어] 기존 동작이 그대로다");
{
  // 기능도 끄기 ON → 숨김이 기능까지 끈다.
  const kill = evaluate(
    base({ featureFlags: { ...ALL_HIDDEN }, playerDisableHidden: true }),
  );
  ok(kill.audioMixer === true, "기능도끄기 ON 이면 숨김이 기능까지 끈다");
  // 기능도 끄기 OFF → 표시만 숨긴다(기능 유지).
  const keep = evaluate(
    base({ featureFlags: { ...ALL_HIDDEN }, playerDisableHidden: false }),
  );
  ok(keep.audioMixer === false, "기능도끄기 OFF 면 기능은 살아 있다");
  ok(keep.videoFilter === false, "필터도 마찬가지");
  // 팝업 설정은 일반 플레이어에 영향이 없다.
  const withPopup = evaluate(
    base({
      featureFlags: { ...ALL_HIDDEN },
      playerDisableHidden: true,
      popupPlayerBtnMixer: true,
      popupPlayerDisableHidden: true,
    }),
  );
  ok(withPopup.audioMixer === true, "일반 플레이어는 팝업 설정을 보지 않는다");
}

console.log("\n[소스] 팝업 분기가 전역 플래그를 그대로 돌려주지 않는다");
{
  const at = FN.indexOf("if (IS_POPUP_PLAYER_FRAME) {");
  const branch = FN.slice(at, FN.indexOf("return flags;", at) + 13);
  // ⚠ 예전 코드의 조기 반환이 돌아오면 A 케이스가 그대로 재발한다.
  ok(
    !/if \(!popupPlayerDisableHidden\) return flags;/.test(branch),
    "기능도끄기 OFF 에서 조기 반환하지 않는다",
  );
  // 표시로 둔 기능을 되살리는 대입이 있어야 한다.
  ok(
    /flags\.audioMixer = /.test(branch) && /flags\.videoFilter = /.test(branch),
    "표시 기능을 명시적으로 대입한다",
  );
  ok(
    !/if \(!popupPlayerBtnMixer\) flags\.audioMixer = true;/.test(branch),
    "'끄기만 더하는' 예전 형태가 아니다",
  );
  // 멀티뷰 예외는 팝업 분기보다 먼저 있어야 한다.
  ok(
    FN.indexOf("IS_MULTIVIEW_FRAME") < FN.indexOf("IS_POPUP_PLAYER_FRAME"),
    "멀티뷰 분기가 팝업 분기보다 앞에 있다",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
