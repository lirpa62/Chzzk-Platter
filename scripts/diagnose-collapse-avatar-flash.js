// 전용 팔로잉 + 프로필 모서리에서 '접을 때 프로필 이미지가 순간 크게 보이는' 문제.
//
// 무엇을 재는가
//   접힘 애니메이션이 도는 동안 아바타 크기를 매 프레임 기록한다. 순간적으로
//   커진다면 어느 프레임에서, 어떤 크기로, 그때 어떤 CSS 규칙이 빠져 있었는지를
//   함께 남긴다.
//
// 왜 필요한가(코드에서 확인한 것)
//   전용 팔로잉 목록의 크기 규칙은 대부분 사이드바의 펼침 클래스
//   (_is_expanded_)에 걸려 있다. 접는 순간 그 클래스가 먼저 빠지고 우리 목록이
//   다시 그려지기 전까지는 '펼침 규칙도, 접힘 규칙도' 안 걸리는 프레임이 생길 수
//   있다. 그 틈에 원본 이미지 크기가 잠깐 드러나면 커 보인다.
//   ⚠ 다만 이건 코드를 읽고 세운 가설일 뿐이라, 실제 값을 봐야 확정할 수 있다.
//      추측으로 CSS 를 고치지 않기 위한 스니펫이다.
//
// 쓰는 법
//  1. 치지직에서 사이드바를 '펼친' 상태로 둔다(전용 팔로잉이 보이는 상태).
//  2. F12 → Console. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  3. 안내가 뜨면 사이드바 '접기' 버튼을 누른다.
//  4. 2초 뒤 출력되는 내용을 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 화면이나 설정을 바꾸지 않는다.
(() => {
  "use strict";

  const sidebar = document.getElementById("sidebar");
  const list = document.getElementById("cheese-custom-follow");
  if (!sidebar) {
    console.log(
      "%c[치즈 플래터] 사이드바를 찾지 못했습니다. 치지직 페이지에서 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }
  if (!list) {
    console.log(
      "%c[치즈 플래터] 전용 팔로잉 목록이 없습니다. 설정에서 '전용 팔로잉 목록'을 켜고 사이드바를 펼친 뒤 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const expanded = () => /(^|\s|_)is_expanded(_|\s|$)/.test(sidebar.className);
  if (!expanded()) {
    console.log(
      "%c[치즈 플래터] 지금은 접힌 상태입니다. 먼저 사이드바를 펼친 뒤 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  // 관찰 대상: 전용 목록의 첫 아바타(래퍼와 그 안의 이미지).
  const pickAvatar = () => {
    const wrap =
      list.querySelector(".cheese-channel-profile-radius-target:not(a)") ||
      list.querySelector(".cheese-cf-profile") ||
      list.querySelector("img")?.parentElement;
    const img = wrap?.querySelector("img") || list.querySelector("img");
    return { wrap, img };
  };
  const first = pickAvatar();
  if (!first.wrap && !first.img) {
    console.log(
      "%c[치즈 플래터] 목록에서 프로필 이미지를 찾지 못했습니다. 팔로우한 채널이 보이는 상태에서 다시 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const t0 = performance.now();
  const at = () => +(performance.now() - t0).toFixed(0);
  const size = (el) => {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const desc = (el) => {
    if (!el) return "(없음)";
    const cls = (el.className || "").toString().trim().split(/\s+/)[0] || "";
    return `${el.tagName}${cls ? "." + cls : ""}`;
  };

  // 한 프레임의 상태. 커지는 순간에 무엇이 달랐는지 보려고 CSS 도 함께 남긴다.
  const sample = (label) => {
    const { wrap, img } = pickAvatar();
    const wrapCs = wrap ? getComputedStyle(wrap) : null;
    const imgCs = img ? getComputedStyle(img) : null;
    return {
      t: at(),
      label,
      expanded: expanded(),
      wrap: size(wrap),
      img: size(img),
      // ⚠ 커지는 프레임에서 이 값들이 비어 있으면 '규칙이 안 걸린 틈' 이다.
      wrapAspect: wrapCs ? wrapCs.aspectRatio : "",
      wrapWidthCss: wrapCs ? wrapCs.width : "",
      wrapHeightCss: wrapCs ? wrapCs.height : "",
      wrapOverflow: wrapCs ? wrapCs.overflow : "",
      wrapRadius: wrapCs ? wrapCs.borderRadius : "",
      imgMaxH: imgCs ? imgCs.maxHeight : "",
      imgObjectFit: imgCs ? imgCs.objectFit : "",
      imgNatural: img ? `${img.naturalWidth}x${img.naturalHeight}` : "",
      // 목록이 다시 그려졌는지(노드가 바뀌면 교체된 것이다).
      sameWrapNode: wrap === first.wrap,
      sameImgNode: img === first.img,
    };
  };

  const frames = [sample("시작(펼침)")];
  let rafId = 0;
  let running = true;
  const loop = () => {
    if (!running) return;
    frames.push(sample(""));
    rafId = requestAnimationFrame(loop);
  };

  // 접힘이 시작되는 순간을 놓치지 않게 클래스 변화도 따로 표시한다.
  const marks = [];
  const mo = new MutationObserver(() => {
    marks.push({
      t: at(),
      expanded: expanded(),
      cls: sidebar.className.slice(0, 80),
    });
  });
  mo.observe(sidebar, { attributes: true, attributeFilter: ["class"] });

  // 우리 목록이 다시 그려지는 순간도 표시한다(DOM 교체 여부).
  const listMo = new MutationObserver(() => {
    marks.push({ t: at(), expanded: expanded(), cls: "(전용 목록 DOM 변경)" });
  });
  listMo.observe(list, { childList: true, subtree: true });

  rafId = requestAnimationFrame(loop);

  console.log(
    "%c[치즈 플래터] 접힘 시 프로필 크기 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log(
    `관찰 대상: 래퍼 ${desc(first.wrap)} / 이미지 ${desc(first.img)}\n` +
      `시작 크기: 래퍼 ${JSON.stringify(size(first.wrap))} 이미지 ${JSON.stringify(size(first.img))}\n\n` +
      "이제 사이드바 '접기' 버튼을 눌러 주세요. 2초 뒤 결과가 나옵니다…",
  );

  setTimeout(() => {
    running = false;
    cancelAnimationFrame(rafId);
    mo.disconnect();
    listMo.disconnect();

    const start = frames[0];
    const baseW = start.wrap?.w || start.img?.w || 0;
    const baseH = start.wrap?.h || start.img?.h || 0;
    // 시작보다 눈에 띄게 커진 프레임(가로 또는 세로 20% 이상).
    const spikes = frames.filter((f) => {
      const w = f.wrap?.w || f.img?.w || 0;
      const h = f.wrap?.h || f.img?.h || 0;
      return (baseW > 0 && w > baseW * 1.2) || (baseH > 0 && h > baseH * 1.2);
    });
    const biggest = frames.reduce((best, f) => {
      const h = f.wrap?.h || f.img?.h || 0;
      const bh = best ? best.wrap?.h || best.img?.h || 0 : 0;
      return h > bh ? f : best;
    }, null);

    console.log("%c[avatar-summary]", "font-weight:bold;color:#00c07f", {
      시작_래퍼: start.wrap,
      시작_이미지: start.img,
      // ⚠ 이 값이 핵심이다. 0 이면 이 환경에서는 커지지 않았다는 뜻.
      커진_프레임수: spikes.length,
      가장_큰_프레임: biggest
        ? {
            t: biggest.t,
            expanded: biggest.expanded,
            wrap: biggest.wrap,
            img: biggest.img,
            wrapAspect: biggest.wrapAspect,
            wrapHeightCss: biggest.wrapHeightCss,
            imgMaxH: biggest.imgMaxH,
            imgNatural: biggest.imgNatural,
            목록이_교체됐나: !biggest.sameWrapNode,
          }
        : null,
      최종_래퍼: frames[frames.length - 1]?.wrap,
      최종_이미지: frames[frames.length - 1]?.img,
      기록한_프레임: frames.length,
    });

    console.log("[avatar-marks] 클래스·DOM 변화 시점");
    console.table(marks);

    // 크기가 '변한' 프레임만 추린다(같은 값이 수십 줄 나오지 않게).
    const changed = [];
    let prev = "";
    for (const f of frames) {
      const key = `${f.expanded}|${f.wrap?.w}x${f.wrap?.h}|${f.img?.w}x${f.img?.h}`;
      if (key === prev) continue;
      prev = key;
      changed.push(f);
    }
    console.log("[avatar-frames] 크기가 바뀐 프레임만");
    console.table(changed.slice(0, 40));
    console.log(
      "위 세 출력을 그대로 보내 주세요.\n" +
        "⚠ 커진_프레임수 가 0 이면 이 환경에서는 재현되지 않은 것입니다. 그때도 알려 주세요.",
    );
  }, 2000);
})();
