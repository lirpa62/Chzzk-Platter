// 멀티뷰 고르기 화면·시청 화면 채널 관리에서 채널 이미지가 없으면 치지직 기본 프로필
// (다시보기 검색 팝업과 같은 주소, 테마별)을 넣고, 테마를 바꾸면 따라 바뀌는지 검증.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const LIGHT = "https://ssl.pstatic.net/static/nng/glive/image/default_profile_light.png";
const DARK = "https://ssl.pstatic.net/static/nng/glive/image/default_profile_dark.png";
const checks = [];
const check = (condition, label) => {
  assert.ok(condition, label);
  checks.push(label);
};

// ── 프로필 <img> 만들기 ───────────────────────────────────────────────────
const SOURCES = require("../src/multiviewSources.js");
const withTheme = (theme, fn) => {
  const previous = globalThis.document;
  globalThis.document = { documentElement: { dataset: { theme } } };
  try { return fn(); } finally { globalThis.document = previous; }
};
check(SOURCES.defaultProfileUrl("dark") === DARK && SOURCES.defaultProfileUrl("light") === LIGHT &&
  SOURCES.defaultProfileUrl(undefined) === LIGHT, "테마별 기본 프로필 주소(모르면 라이트)");
{
  const html = withTheme("dark", () => SOURCES.profileImg(""));
  check(html.includes(`src="${DARK}"`) && html.includes("data-mv-default-profile"),
    "이미지가 없으면 다크 테마에서 다크 기본 프로필을 넣고 표시해 둔다");
  check(withTheme("light", () => SOURCES.profileImg(null)).includes(`src="${LIGHT}"`),
    "라이트 테마에서는 라이트 기본 프로필");
  check(withTheme("dark", () => SOURCES.profileImg("javascript:alert(1)")).includes(`src="${DARK}"`),
    "쓸 수 없는 주소도 기본 프로필로 바꾼다");
}
{
  const url = "https://nng-phinf.pstatic.net/profile.png?v=1";
  const html = withTheme("dark", () => SOURCES.profileImg(url, 'class="mv-card-avatar"'));
  check(html.startsWith('<img class="mv-card-avatar" src="https://nng-phinf.pstatic.net/profile.png?v=1&amp;type=f60_60_na"') &&
    !html.includes("data-mv-default-profile"), "이미지가 있으면 그대로(60px 썸네일) 쓰고 표시하지 않는다");
}

// ── 테마 전환 시 기본 프로필만 바꿔 끼운다 ─────────────────────────────────
{
  const imgs = [
    { attrs: { src: LIGHT, "data-mv-default-profile": "" } },
    { attrs: { src: "https://nng-phinf.pstatic.net/real.png" } },
  ].map((img) => ({
    ...img,
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = value; },
  }));
  let clickHandler = null;
  const documentElement = { dataset: {} };
  const document = {
    documentElement,
    getElementById: () => ({
      setAttribute() {},
      addEventListener: (type, fn) => { clickHandler = fn; },
    }),
    querySelectorAll: (selector) => {
      assert.equal(selector, "img[data-mv-default-profile]");
      return imgs.filter((img) => "data-mv-default-profile" in img.attrs);
    },
  };
  const store = {};
  const ctx = {
    document,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    CheeseMultiviewSources: SOURCES,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("src/multiviewTheme.js"), ctx);
  check(documentElement.dataset.theme === "light", "처음 테마는 라이트");
  clickHandler();
  check(documentElement.dataset.theme === "dark" && imgs[0].attrs.src === DARK,
    "다크로 바꾸면 기본 프로필이 다크로 바뀐다");
  check(imgs[1].attrs.src === "https://nng-phinf.pstatic.net/real.png", "실제 채널 이미지는 건드리지 않는다");
  clickHandler();
  check(imgs[0].attrs.src === LIGHT, "라이트로 돌아가면 다시 라이트 기본 프로필");
}

// ── 고르기 화면·시청 화면 채널 관리가 모두 같은 함수를 쓴다 ─────────────────
{
  const setup = read("src/multiview.js");
  const watch = read("src/multiviewWatch.js");
  check((setup.match(/SOURCES\.profileImg\(/g) || []).length === 3 &&
    /SOURCES\.profileImg\(r\.channelImageUrl, 'class="mv-card-avatar"'\)/.test(setup) &&
    /SOURCES\.profileImg\(c\.channelImageUrl\)/.test(setup) &&
    /SOURCES\.profileImg\(channel\.channelImageUrl\)/.test(setup),
    "고르기 화면: 카드·고른 채널·다시보기 채널 목록");
  check((watch.match(/SOURCES\.profileImg\(/g) || []).length === 2 &&
    /SOURCES\.profileImg\(r\.channelImageUrl, 'class="mv-quick-card-avatar"'\)/.test(watch) &&
    /SOURCES\.profileImg\(channel\.channelImageUrl\)/.test(watch),
    "시청 화면 채널 관리: 카드·다시보기 채널 목록");
  check(!/profileThumb\([^)]*channelImageUrl\)\)\)?}" alt=""/.test(setup + watch) &&
    !/mv-video-channel-option-avatar|mv-quick-card-avatar is-empty/.test(setup + watch),
    "이미지 없을 때 빈 동그라미를 그리던 분기가 남지 않는다");
}

console.log(checks.map((label) => `  PASS ${label}`).join("\n"));
console.log("전부 통과");
