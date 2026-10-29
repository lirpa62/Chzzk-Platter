// 채널 인증 마크(파트너·챌린저·공식) 판단을 한곳에 모은다.
//
// 2026-11 개편: 응답의 verifiedMarkType 이 "PARTNER" | "CHALLENGER" | "OFFICIAL" 이고, 치지직 화면은 이 값으로만
// 마크를 그린다(Oee·kee 표, 클래스 is_partner/is_challenger/is_official). 아이콘도 바뀌어 초록 파트너 마크는
// icon_partner_mark.png, 예전 파트너 주소 icon_official_mark.png 는 파란 '공식' 마크가 됐다.
// 타입이 없는 예전 저장값(verifiedMark:true 만)은 개편 전 파트너로 본다.
//
// 그리는 곳은 kind() 결과를 data-cheese-mark 로 달고(CSS 배경 마크), <img> 는 icon() 을 쓴다.
// 데이터를 만드는 곳은 fields() 로 verifiedMark·verifiedMarkType 을 함께 옮긴다.
(() => {
  if (globalThis.CheeseVerifiedMark) return;

  const ICONS = Object.freeze({
    partner: "https://ssl.pstatic.net/static/nng/glive/image/icon_partner_mark.png",
    challenger: "https://ssl.pstatic.net/static/nng/glive/image/icon_challenger_mark.png",
    official: "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png",
  });
  const LABELS = Object.freeze({ partner: "파트너", challenger: "챌린저", official: "공식" });
  // verifiedMarkType 값(대문자) → 종류. 치지직 화면의 표(Oee)와 같다.
  const TYPE_KINDS = Object.freeze({ PARTNER: "partner", CHALLENGER: "challenger", OFFICIAL: "official" });

  // 여러 출처(채널·프로필·저장값 등) 중 처음 나오는 타입 문자열. 없으면 null.
  function typeOf(...sources) {
    for (const source of sources) {
      const type = source?.verifiedMarkType;
      if (typeof type === "string" && type) return type.slice(0, 40);
    }
    return null;
  }

  // 마크가 있는지: verifiedMark:true 이거나 아는 타입(치지직은 타입만 보고 그린다).
  function hasMark(...sources) {
    return sources.some((source) =>
      source?.verifiedMark === true ||
      (typeof source?.verifiedMarkType === "string" && Boolean(TYPE_KINDS[source.verifiedMarkType.toUpperCase()])));
  }

  // 저장·전달용 필드 묶음. 객체 리터럴에 펼쳐 쓴다: { ...CheeseVerifiedMark.fields(channel) }
  // 타입은 있을 때만 붙인다(저장 기록이 줄마다 null 로 늘지 않게, 지금 저장 모양 그대로).
  function fields(...sources) {
    const type = typeOf(...sources);
    const verifiedMark = hasMark(...sources);
    return type ? { verifiedMark, verifiedMarkType: type } : { verifiedMark };
  }

  // "partner" | "challenger" | "official" | "" (마크 없음)
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
