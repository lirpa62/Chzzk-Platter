// 채널 인증 마크(파트너·챌린저) 판단을 한곳에 모은다.
//
// 2026-11-01 부터 파트너 마크 외에 챌린저 마크(icon_challenger_mark.png)가 생기며, 채널·프로필 응답에
// verifiedMark 와 함께 verifiedMarkType 이 붙었다. 도입 전 실측: 파트너 = verifiedMark:true, verifiedMarkType:null.
// 파트너·챌린저가 어떤 값으로 오는지는 아직 모르므로 TYPE_KINDS 는 비워 두고 지금처럼 verifiedMark 만 본다
// (verifiedMark:true → 파트너). 실측 후 TYPE_KINDS 만 채우면 마크를 그리는 곳 전부가 따라간다.
//
// 그리는 곳은 kind() 결과를 data-cheese-mark 로 달고(CSS 배경 마크), <img> 는 icon() 을 쓴다.
// 데이터를 만드는 곳은 fields() 로 verifiedMark·verifiedMarkType 을 함께 옮긴다.
(() => {
  if (globalThis.CheeseVerifiedMark) return;

  const ICONS = Object.freeze({
    partner: "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png",
    challenger: "https://ssl.pstatic.net/static/nng/glive/image/icon_challenger_mark.png",
  });
  const LABELS = Object.freeze({ partner: "파트너", challenger: "챌린저" });
  // verifiedMarkType 값(대문자) → "partner" | "challenger". 실측 전이라 비워 둔다.
  const TYPE_KINDS = Object.freeze({});

  // 여러 출처(채널·프로필·저장값 등) 중 처음 나오는 타입 문자열. 없으면 null.
  function typeOf(...sources) {
    for (const source of sources) {
      const type = source?.verifiedMarkType;
      if (typeof type === "string" && type) return type.slice(0, 40);
    }
    return null;
  }

  function hasMark(...sources) {
    return sources.some((source) => source?.verifiedMark === true);
  }

  // 저장·전달용 필드 묶음. 객체 리터럴에 펼쳐 쓴다: { ...CheeseVerifiedMark.fields(channel) }
  // 타입은 있을 때만 붙인다(저장 기록이 줄마다 null 로 늘지 않게, 지금 저장 모양 그대로).
  function fields(...sources) {
    const type = typeOf(...sources);
    const verifiedMark = hasMark(...sources);
    return type ? { verifiedMark, verifiedMarkType: type } : { verifiedMark };
  }

  // "partner" | "challenger" | "" (마크 없음)
  function kind(...sources) {
    const type = typeOf(...sources);
    const known = type ? TYPE_KINDS[type.toUpperCase()] : "";
    if (known) return known;
    return hasMark(...sources) ? "partner" : "";
  }

  globalThis.CheeseVerifiedMark = Object.freeze({
    ICONS,
    LABELS,
    typeOf,
    hasMark,
    fields,
    kind,
    icon: (markKind) => ICONS[markKind] || "",
    label: (markKind) => LABELS[markKind] || "",
  });
})();
