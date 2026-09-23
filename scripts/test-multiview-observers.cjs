const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const source = readFileSync(join(__dirname, "..", "src", "content.js"), "utf8");

function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Observer 구간을 찾지 못했다: ${from}`);
  return source.slice(start, end);
}

function checkObserver(code, kind) {
  const fallback = { name: "fallback" };
  const preferred = { name: "preferred" };
  const live = { parentElement: preferred };
  let livePresent = false;
  const observers = [];
  class MockObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe(host) { this.host = host; }
    disconnect() { this.disconnected = true; }
  }
  const document = {
    body: fallback,
    getElementById: (id) => id === "live_player_layout" && livePresent ? live : null,
    querySelector: () => fallback,
  };
  const observeName = kind === "video" ? "observeVideoHost" : "observeMultiviewUiHost";
  const hostName = kind === "video" ? "videoObserverHost" : "uiObserverHost";
  const observe = new Function(
    "document", "MutationObserver", "syncMultiviewVideo",
    "scheduleMultiviewAdCheck", "scheduleMultiviewUiReconcile",
    `${code}\nreturn { run: ${observeName}, host: () => ${hostName} };`,
  )(document, MockObserver, () => {}, () => {}, () => {});
  observe.run();
  assert.equal(observers.length, 1);
  assert.equal(observers[0].host, fallback);
  observe.run();
  const reused = observers.length === 1;
  livePresent = true;
  observers.at(-1).callback();
  return {
    reused,
    upgraded: observe.host() === preferred ||
      (kind === "video" && observe.host() === live),
    disconnected: observers[0].disconnected,
    observerCount: observers.length,
  };
}

const video = section("    let videoObserver = null;", "    // 사용자가 소리 관련 조작을 하면");
const ui = section("    let uiObserver = null;", "    // 부모가 '지금 바로 다시 맞춰라'");
for (const [kind, code] of [["video", video], ["ui", ui]]) {
  const result = checkObserver(code, kind);
  assert.deepEqual(result, {
    reused: true, upgraded: true, disconnected: true, observerCount: 2,
  }, `${kind} Observer가 fallback을 교체하거나 동일 host를 재사용하지 않았다`);
}

const withoutVideoReuse = video.replace(
  "(host === videoObserverHost && videoObserver)", "false",
);
assert.equal(checkObserver(withoutVideoReuse, "video").reused, false,
  "동일 host 재생성 변조를 테스트가 잡지 못했다");

const withoutUiUpgrade = ui.replace(
  "if (uiObserverHost !== document.getElementById(\"live_player_layout\")?.parentElement)\n          observeMultiviewUiHost();",
  "",
);
assert.equal(checkObserver(withoutUiUpgrade, "ui").upgraded, false,
  "fallback 고정 변조를 테스트가 잡지 못했다");

const hostTimer = section("    const bootstrapTimer = setInterval(() => {", "    // 종료 화면은 방송 중에도");
assert.match(hostTimer, /preferredHost && videoObserverHost === preferredHost/,
  "비디오를 먼저 찾았을 때 전용 host 승격 전에 보조 확인이 끝난다");
assert.doesNotMatch(hostTimer, /if \(currentVideo \|\|/);

console.log("멀티뷰 Observer 재사용·전용 host 승격 및 변조 감지 통과");
