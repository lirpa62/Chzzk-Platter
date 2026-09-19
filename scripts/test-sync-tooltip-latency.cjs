// 실시간 따라잡기 버튼 툴팁에 현재 지연을 보여 준다.
//
// 예전에는 지연이 목표 이하라 버튼이 비활성일 때 툴팁에 지연이 빠졌다(호출부가
// null 을 넘겼다). 정작 누를 수 없을 때야말로 '지금 얼마나 밀렸는지' 가 궁금하다.
//
// ⚠ 이 파일은 audioMixer.js 의 setSyncTooltip 문구 규칙을 '복제' 한다. 원본을
//   고치면 여기도 함께 고쳐야 한다.

const fs = require("fs");
const path = require("path");

let failed = 0;
const ok = (cond, label) => {
  console.log((cond ? "  PASS " : "  FAIL ") + label);
  if (!cond) failed += 1;
};

const SYNC_JUMP_LATENCY_S = 12;

// audioMixer.js 와 같은 규칙.
function tooltipText(
  lat,
  { catching = false, idle = false, mode = "rate" } = {},
  target = 2,
) {
  if (catching) {
    return Number.isFinite(lat)
      ? `지연 ${lat.toFixed(1)}초 · ${target}초까지 따라잡는 중`
      : "따라잡는 중…";
  }
  if (idle) {
    return Number.isFinite(lat)
      ? `지연 ${lat.toFixed(1)}초 · 따라잡기 불필요`
      : "실시간 따라잡기";
  }
  if (Number.isFinite(lat) && (mode === "jump" || lat >= SYNC_JUMP_LATENCY_S)) {
    return `라이브로 이동 (지연 ${lat.toFixed(1)}초)`;
  }
  return Number.isFinite(lat)
    ? `실시간 따라잡기 (지연 ${lat.toFixed(1)}초)`
    : "실시간 따라잡기";
}

console.log("[A] 목표 이하라 누를 수 없을 때도 현재 지연을 보여 준다");
{
  const text = tooltipText(2.8, { idle: true });
  ok(text.includes("2.8초"), `지연이 들어 있다 (${text})`);
  ok(text.includes("불필요"), "따라잡을 필요가 없다고 알린다");
  // 지연을 아직 못 쟀으면 숫자를 지어내지 않는다.
  ok(
    tooltipText(null, { idle: true }) === "실시간 따라잡기",
    "지연을 모르면 숫자를 넣지 않는다",
  );
}

console.log("\n[B] 자동으로 따라잡는 중에도 지연과 목표를 보여 준다");
{
  const text = tooltipText(6.4, { catching: true }, 3);
  ok(text.includes("6.4초"), `현재 지연이 들어 있다 (${text})`);
  ok(text.includes("3초까지"), "목표 지연을 함께 알린다");
}

console.log("\n[기존 동작] 누를 수 있을 때의 문구는 그대로다");
{
  const text = tooltipText(5.2, {});
  ok(text.includes("실시간 따라잡기"), `기존 문구 유지 (${text})`);
  ok(text.includes("5.2초"), "지연도 그대로 보여 준다");
  const jump = tooltipText(20, {});
  ok(jump.includes("라이브로 이동"), `큰 지연은 이동으로 알린다 (${jump})`);
}

console.log("\n[소스] 비활성일 때 지연을 버리지 않는다");
{
  const mixer = fs.readFileSync(
    path.join(__dirname, "..", "src", "audioMixer.js"),
    "utf8",
  );
  ok(
    !/setSyncTooltip\(btn, overThreshold \? lat : null\)/.test(mixer),
    "임계 미만이라고 null 을 넘기지 않는다",
  );
  ok(
    /setSyncTooltip\(btn, lat, \{ idle: !overThreshold \}\)/.test(mixer),
    "지연을 그대로 넘기고 상태만 따로 알린다",
  );
  // ⚠ pointer-events 를 막지 않는 것만으로는 부족했다. disabled 버튼에는 CSS
  //   :hover 자체가 걸리지 않아 치지직 툴팁이 뜨지 않는다(실측).
  //   그래서 JS 로 켜는 클래스에 맞춘 규칙이 필요하다.
  //   자세한 계측은 test-sync-tooltip-disabled.cjs 가 한다.
  const css = fs.readFileSync(
    path.join(__dirname, "..", "src", "audioMixer.css"),
    "utf8",
  );
  ok(
    /\.cheese-live-sync-button\.is-tip-open \.pzp-button__tooltip/.test(css),
    "비활성일 때도 띄울 수 있는 규칙이 있다",
  );
}

console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
process.exit(failed ? 1 : 0);
