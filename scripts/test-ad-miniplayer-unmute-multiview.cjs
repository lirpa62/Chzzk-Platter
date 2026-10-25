// '중간광고 중 방송 음소거 해제' 옵션: 멀티뷰에서는 소리를 맡은 칸만 따른다.
//
// 예전에는 멀티뷰 칸 전체에서 이 기능을 꺼 두어(보조 칸이 광고 중 갑자기 들리지 않게) 메인 칸에서도
// 중간광고 동안 방송이 음소거된 채였다. 지금은 부모가 음소거를 지시한 칸(보조 칸)만 막는다.
//   - 소리를 맡은 칸: 미니플레이어 방송 소리를 켠다(부모가 지시한 크기로)
//   - 보조 칸: 켜지 않는다
//   - 광고 중 메인이 바뀌어 보조 칸이 되면 우리가 켠 소리를 다시 끈다
//   - 한 탭에서 볼 때는 그대로(진입 전 음소거였으면 유지 옵션 포함)
// content.js 의 함수를 떼어 가짜 플레이어로 돌린다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const content = fs.readFileSync(path.join(__dirname, "..", "src/content.js"), "utf8");
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};
const sliceFn = (name) => {
  const at = content.indexOf(`\n  function ${name}(`);
  assert.ok(at >= 0, `${name} 를 찾지 못했다`);
  return content.slice(at, content.indexOf("\n  }\n", at) + 4);
};
const between = (from, to) => {
  const start = content.indexOf(from);
  const end = content.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `구간을 찾지 못했다: ${from.slice(0, 40)}`);
  return content.slice(start, end);
};

check(/multiviewMuted = data\.muted;\s*muteOverriddenByUser = false;\s*syncMultiviewVideo\(\);\s*if \(currentVideo\) applyAudioToVideo\(currentVideo\);\s*\/\/[^\n]*\n\s*remuteAdMiniplayerForMultiview\(\);\s*applyAdMiniplayerUnmute\(\);/.test(content),
  "부모가 소리 주인을 바꾸면 미니플레이어 소리도 다시 맞춘다");

function setup({ multiview, muted = false, volume = 0.4, unmuteOn = true, keepMuted = true }) {
  class FakeVideo {
    constructor() {
      this.muted = false;
      this.volume = 1;
      this.listeners = {};
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    removeEventListener(type) { delete this.listeners[type]; }
    closest(selector) { return selector === "#live_player_layout.miniplayer" && box.mini ? box : null; }
    set(mutedValue) { // 치지직(또는 사용자)이 바꾼다
      this.muted = mutedValue;
      this.listeners.volumechange?.({ currentTarget: this });
    }
  }
  const video = new FakeVideo();
  const box = {
    mini: false,
    classList: { contains: (c) => c === "miniplayer" && box.mini },
    querySelector: (sel) => (sel === "video.webplayer-internal-video" ? video : null),
  };
  const ctx = {
    HTMLElement: Object, HTMLVideoElement: FakeVideo, Date, Math,
    document: { querySelector: (sel) => (sel === "div#layout-body #live_player_layout" ? box : null) },
  };
  vm.createContext(ctx);
  vm.runInContext(`
    const IS_MULTIVIEW_FRAME = ${multiview};
    let multiviewMuted = ${muted};
    let multiviewVolume = ${volume};
    let adMiniplayerUnmute = ${unmuteOn};
    let adMiniplayerKeepMuted = ${keepMuted};
    ${between("  let adUnmuteObservedVideo = null;", "  const AD_UNMUTE_SETTLE_MS")}
    const AD_UNMUTE_SETTLE_MS = 0;
    ${sliceFn("adUnmuteBlockedByMultiview")}
    ${sliceFn("setAdUnmuteMutedFalse")}
    ${sliceFn("remuteAdMiniplayerForMultiview")}
    ${sliceFn("onAdMiniplayerVolumeChange")}
    let adPreMuteState = false;
    ${sliceFn("applyAdMiniplayerUnmute")}
    this.apply = applyAdMiniplayerUnmute;
    this.remute = remuteAdMiniplayerForMultiview;
    this.setMuted = (value) => { multiviewMuted = value; };
  `, ctx);
  // 광고 진입: 치지직이 방송을 미니플레이어로 줄이고 음소거한다.
  const enterAd = () => {
    ctx.apply(); // 광고 전 상태 기록
    box.mini = true;
    video.muted = true;
    ctx.apply();
  };
  return { ctx, video, box, enterAd };
}

// 1) 멀티뷰 메인(소리를 맡은 칸)
{
  const { video, enterAd } = setup({ multiview: true, muted: false, volume: 0.4 });
  enterAd();
  check(video.muted === false && Math.abs(video.volume - 0.4) < 1e-9,
    `멀티뷰 소리를 맡은 칸: 중간광고 미니플레이어 소리를 부모가 지시한 크기로 켠다 ${JSON.stringify({ muted: video.muted, volume: video.volume })}`);
}
// 2) 멀티뷰 보조 칸
{
  const { video, enterAd } = setup({ multiview: true, muted: true });
  enterAd();
  check(video.muted === true, "멀티뷰 보조 칸(부모가 음소거): 켜지 않는다");
}
// 3) 광고 중 메인이 바뀌어 보조 칸이 됨 → 다시 끔, 다시 메인이 되면 켬
{
  const { ctx, video, enterAd } = setup({ multiview: true, muted: false });
  enterAd();
  assert.equal(video.muted, false);
  ctx.setMuted(true);
  ctx.remute();
  ctx.apply();
  check(video.muted === true, "광고 중 보조 칸이 되면 우리가 켠 미니플레이어 소리를 끈다");
  ctx.setMuted(false);
  ctx.remute();
  ctx.apply();
  check(video.muted === false, "다시 소리를 맡으면 옵션대로 켠다");
}
// 4) 옵션 꺼짐
{
  const { video, enterAd } = setup({ multiview: true, muted: false, unmuteOn: false });
  enterAd();
  check(video.muted === true, "옵션이 꺼져 있으면 멀티뷰에서도 그대로 음소거");
}
// 5) 한 탭(멀티뷰 아님)은 예전 그대로
{
  const { video, enterAd } = setup({ multiview: false });
  enterAd();
  check(video.muted === false && video.volume === 1, "한 탭: 소리를 켜고 크기는 건드리지 않는다");
}
{
  const { ctx, video, box } = setup({ multiview: false, keepMuted: true });
  video.muted = true; // 광고 전부터 음소거
  ctx.apply();
  box.mini = true;
  ctx.apply();
  check(video.muted === true, "한 탭: 광고 전 음소거였으면 유지(하위 옵션)");
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
