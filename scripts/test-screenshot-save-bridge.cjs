// 스크린샷 저장 다리(MAIN world → 격리 월드 → background) 검증.
//
// 증상: v1.52.0 에서 저장할 때마다 "저장하지 못했어요 (이미지 형식 문제)".
//
// 원인: 격리 월드가 `data.blob instanceof Blob` 으로 걸렀다. MAIN world 가
// postMessage 로 넘긴 Blob 은 다른 realm 에서 만들어져 이 검사가 false 가 될 수
// 있는데, 그때 보낼 주소가 통째로 사라졌다. MAIN 은 dataURL 을 함께 보내지
// 않으므로 폴백도 없었고, '바로 저장'(기본값)이면 blobURL 조차 만들지 않아
// url 이 빈 값이 되어 reason:"invalid" 로 끝났다.
//
// 여기서는 그 판별·폴백 규칙만 떼어내 확인한다(실제 DOM/다운로드는 수동 확인).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let failed = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  PASS ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failed += 1;
  }
};

// content.js 의 isScreenshotBlobLike 와 같은 규칙.
function isScreenshotBlobLike(value) {
  return (
    !!value &&
    typeof value === "object" &&
    typeof value.size === "number" &&
    value.size > 0 &&
    typeof value.type === "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.slice === "function"
  );
}

// 다른 realm 에서 온 Blob 흉내: 값은 멀쩡하지만 이쪽 Blob 생성자와 무관하다.
function foreignBlob(type, size) {
  return {
    size,
    type,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(size)),
    slice: () => foreignBlob(type, size),
  };
}

console.log("[Blob 판별] realm 이 달라도 값이 멀쩡하면 받아들인다");
{
  const real = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  ok(isScreenshotBlobLike(real), "같은 realm 의 Blob 을 받아들인다");
  ok(
    isScreenshotBlobLike(foreignBlob("image/png", 106)),
    "다른 realm 의 Blob 도 받아들인다(예전에는 여기서 실패했다)",
  );
  // ⚠ instanceof 로만 보면 다른 realm 의 Blob 을 놓친다.
  ok(
    !(foreignBlob("image/png", 106) instanceof Blob),
    "다른 realm Blob 은 instanceof 로는 걸러진다(그래서 쓰지 않는다)",
  );
  ok(!isScreenshotBlobLike(null), "빈 값은 받지 않는다");
  ok(!isScreenshotBlobLike({}), "모양이 다른 객체는 받지 않는다");
  ok(
    !isScreenshotBlobLike(foreignBlob("image/png", 0)),
    "크기가 0 이면 받지 않는다",
  );
}

// content.js 의 다리 로직과 같은 순서로 보낼 주소를 정한다.
async function resolveSaveUrl({
  blob,
  saveAs,
  firefox = false,
  objectUrlWorks = true,
}) {
  const screenshotBlob = isScreenshotBlobLike(blob) ? blob : null;
  if (screenshotBlob && screenshotBlob.type !== "image/png") {
    return {
      url: "",
      reason: "invalid",
      detail: `type=${screenshotBlob.type}`,
    };
  }
  let blobURL = null;
  if (!firefox && screenshotBlob) {
    blobURL = objectUrlWorks ? "blob:fake/1" : null;
  }
  const needDataURL = firefox || !blobURL;
  const dataURL =
    needDataURL && screenshotBlob ? "data:image/png;base64,AAAA" : "";
  if (!firefox && !blobURL && dataURL && saveAs) blobURL = "blob:fake/2";
  const url = firefox ? dataURL : blobURL || dataURL;
  return { url, reason: url ? "" : "invalid" };
}

(async () => {
  console.log("\n[전송 방식] blob: 주소를 service worker 로 넘기지 않는다");
  // ⚠ 콘텐츠 스크립트가 만든 blob: 주소는 그 문서에 묶여 있어 확장 service worker
  //   의 chrome.downloads 가 내려받지 못한다(MV3 제약). 주소 문자열은 만들어지므로
  //   예전에는 '주소가 있다' 로 통과한 뒤 저장만 조용히 실패했다.
  const route = ({ saveAs, firefox = false, hasBlob = true }) => {
    if (!firefox && !saveAs && hasBlob) return { how: "anchor", url: "" };
    return { how: "downloads", url: "data:image/png;base64,AAAA" };
  };
  {
    const cases = [
      ["바로 저장(Chrome)", { saveAs: false }, "anchor", ""],
      ["대화상자(Chrome)", { saveAs: true }, "downloads", "data:"],
      ["파이어폭스", { saveAs: false, firefox: true }, "downloads", "data:"],
    ];
    for (const [label, opts, how, scheme] of cases) {
      const r = route(opts);
      ok(r.how === how, `${label} → ${how}`);
      ok(
        !String(r.url).startsWith("blob:"),
        `${label} → blob: 주소를 보내지 않는다`,
      );
      if (scheme) {
        ok(r.url.startsWith(scheme), `${label} → ${scheme} 로 보낸다`);
      }
    }
  }

  console.log("\n[background 검증] 그 주소를 background 가 받아 준다");
  {
    // background.js 의 검사와 같은 규칙.
    const accepted = (url, firefox = false) =>
      typeof url === "string" &&
      (url.startsWith("data:image") || (!firefox && url.startsWith("blob:")));
    ok(accepted("blob:fake/1"), "객체 URL 을 받는다");
    ok(accepted("data:image/png;base64,AAAA"), "데이터 URL 을 받는다");
    ok(!accepted(""), "빈 주소는 거절한다");
    ok(
      !accepted("blob:fake/1", true),
      "파이어폭스에서는 객체 URL 을 받지 않는다",
    );
  }

  console.log("\n[PNG 아님] 확장자만 바꿔 저장하지 않는다");
  {
    const r = await resolveSaveUrl({
      blob: foreignBlob("image/jpeg", 106),
      saveAs: false,
    });
    ok(r.reason === "invalid", "PNG 가 아니면 저장하지 않는다");
    ok(
      String(r.detail || "").includes("image/jpeg"),
      `사유에 실제 형식을 남긴다 (${r.detail})`,
    );
  }

  console.log("\n[소스 확인] instanceof 로 거르던 코드가 남아 있지 않다");
  {
    const content = fs.readFileSync(
      path.join(__dirname, "..", "src", "content.js"),
      "utf8",
    );
    ok(
      /function isScreenshotBlobLike/.test(content),
      "모양으로 판별하는 함수가 있다",
    );
    ok(
      !/data\.blob instanceof Blob/.test(content),
      "다리에서 instanceof 로 거르지 않는다",
    );
    const bridge = content.slice(
      content.indexOf('if (!data || data.source !== "cheese-screenshot-save")'),
      content.indexOf(
        'if (!data || data.source !== "cheese-screenshot-save")',
      ) + 4200,
    );
    ok(
      /const wantAnchorSave = !firefox && !saveAs && !!screenshotBlob;/.test(
        bridge,
      ),
      "바로 저장은 이 문서에서 직접 내려받는다",
    );
    ok(
      !/blobURL = URL\.createObjectURL\(screenshotBlob\)/.test(bridge),
      "background 로 넘길 blob: 주소를 만들지 않는다",
    );
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  process.exit(failed ? 1 : 0);
})();
