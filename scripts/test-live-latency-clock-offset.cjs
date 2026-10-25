// 라이브 지연: PC 시계 차이 보정.
//
// 치지직 _getLiveLatency() = PC 시계(Date.now) − 수신 서버가 그 장면을 받은 서버 시각(ingest-utc) 이다
// (player-vendor 번들: be()() = core-js Date.now). PC 시계가 서버보다 빠르면 지연이 그만큼 크게 나와, 실제
// 화면·채팅 차이는 1.5~3초인데 숫자는 날마다 9~12초 → 2~3초 → 6.5~7.5초로 바뀌었고 따라잡기 기준이 밀렸다.
// 같은 출처 HEAD 응답의 Date 헤더(초 단위)로 PC 시계 차이를 재서 뺀다. 여러 번 재 구간을 겹쳐 오차를 줄인다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const mixer = fs.readFileSync(path.join(__dirname, "..", "src/audioMixer.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const block = mixer.slice(mixer.indexOf("  const CLOCK_SAMPLE_COUNT = 4;"), mixer.indexOf("  // 라이브 지연(초). _getLiveLatency()는 ms를 반환한다"));
assert.ok(block.includes("function measureClockOffset"), "보정 구간을 찾지 못했다");

// 가짜 시간: real = 서버 기준 실제 시각, PC 시계 = real + pcAhead. fetch 는 rtt 동안 걸린다.
async function measure({ pcAhead, rtt = 40, startReal = 1_700_000_000_250 }) {
  let real = startReal;
  const requests = [];
  const ctx = {
    location: { origin: "https://chzzk.naver.com" },
    Date: { now: () => real + pcAhead, parse: (v) => Date.parse(v) },
    Math, Number, Promise,
    setTimeout: (fn, ms) => { real += ms; fn(); },
    fetch: async (url, options) => {
      requests.push([url, options]);
      real += rtt / 2; // 서버가 응답을 만드는 순간
      const header = new Date(Math.floor(real / 1000) * 1000).toUTCString();
      real += rtt / 2;
      return { headers: { get: (k) => (k === "date" ? header : null) } };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(block + "\nthis.measure=measureClockOffset;this.correct=correctLiveLatencyMs;this.offset=()=>clockOffsetMs;this.next=()=>clockNextAt;", ctx);
  await ctx.measure();
  return { offset: ctx.offset(), requests, ctx };
}

(async () => {
  const fast = await measure({ pcAhead: 5000 });
  check(Math.abs(fast.offset - 5000) <= 300, `PC 시계가 5초 빠르면 약 +5초로 잰다(±0.3초) → ${fast.offset}ms`);
  check(fast.requests.length === 4 && fast.requests.every(([url, o]) => url === "https://chzzk.naver.com/" && o.method === "HEAD" && o.cache === "no-store"),
    "같은 출처(chzzk.naver.com) HEAD 4번, 캐시 없이");
  check(fast.ctx.correct(9200) === 9200 - fast.offset, "치지직 지연에서 PC 시계 차이를 뺀다(9.2초 → 약 4.2초)");

  const slow = await measure({ pcAhead: -3200, startReal: 1_700_000_000_900 });
  check(Math.abs(slow.offset + 3200) <= 300, `PC 시계가 3.2초 느려도 잰다 → ${slow.offset}ms`);

  const ok = await measure({ pcAhead: 200 });
  check(ok.offset === 0, `차이가 0.5초 미만이면 보정하지 않는다(측정 오차 수준) → ${ok.offset}`);

  const laggy = await measure({ pcAhead: 5000, rtt: 2500 });
  check(laggy.offset === 0, "응답이 느려 구간이 넓으면 믿지 않고 보정하지 않는다");
  check(laggy.ctx.next() > 0, "못 잰 경우에도 다음 측정 시각을 정해 매번 다시 재지 않는다");
})().then(() => {
  // 연결: 따라잡기·채팅 입력창·스트림 정보가 모두 보정된 값을 쓴다.
  check(/const ms = correctLiveLatencyMs\(c\?\.srcObject\?\._getLiveLatency\?\.\(\)\);/.test(mixer),
    "getLiveLatencySeconds(따라잡기·입력창 지연·스크린샷 시각)가 보정된 값을 쓴다");
  check(/const lat = correctLiveLatencyMs\(core\.srcObject\._getLiveLatency\(\)\);[\s\S]{0,400}?PC 시계 \$\{clockOffsetMs > 0 \? "\+" : "−"\}/.test(mixer),
    "스트림 정보 레이턴시도 보정하고, 보정했으면 얼마나 뺐는지 보인다");
  const raw = mixer.split("\n").filter((line) => !/^\s*\/\//.test(line) &&
    /srcObject(\?)?\._getLiveLatency(\?\.)?\(\)/.test(line)).length;
  check(raw === 2, `치지직 지연을 직접 읽는 곳은 보정을 거치는 두 곳뿐(${raw})`);
  console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
  console.log("전부 통과");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
