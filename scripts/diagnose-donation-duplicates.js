// 후원 기록이 두 행으로 남는지 확인하고, 그 두 행이 '어디서 왔는지' 를 본다.
//
// 코드만으로 확인한 것(아직 실제 중복 쌍은 없다)
//   미션 후원은 두 경로로 들어온다.
//     1) 미션 요청 훅  t=건 순간,   m="",            d.src="mission", missionId 있음
//     2) 결제 내역     t=확정 순간, m=본문 있을 수 있음, d.src="history", missionId 없음
//   두 행은 t·m·v 가 모두 달라 지금의 중복 제거 키(vodIdentityKey /
//   vodFallbackKey / t|m|matchKey)에 하나도 걸리지 않는다. missionId 는
//   어느 키에도 들어가지 않는다.
//
// ⚠ 그래서 '미션 후원' 이 가장 유력하지만, 실제 저장된 쌍을 보기 전에는
//   고치지 않는다. 정상적으로 같은 금액을 두 번 후원한 경우와 구분해야 한다.
//
// 쓰는 법
//  1. 후원 기록이 중복으로 보이는 채널의 치지직 페이지를 연다.
//  2. F12 → Console. 이 파일 내용을 통째로 붙여 넣고 실행한다.
//  3. 출력 전체를 그대로 보내 준다.
//
// ⚠ 값만 읽는다. 아무것도 지우거나 합치지 않는다.
// ⚠ 닉네임·본문 전문은 출력하지 않는다(길이와 지문만).
(async () => {
  "use strict";

  const store = chrome?.storage?.local;
  if (!store) {
    console.log(
      "%c[치즈 플래터] 확장 저장소에 접근할 수 없습니다. 치지직 탭에서 실행해 주세요.",
      "color:#ff6b6b;font-weight:bold",
    );
    return;
  }

  const all = await store.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("chatRecap:"));
  if (!keys.length) {
    console.log("%c[치즈 플래터] 채팅 기록이 없습니다.", "color:#ff6b6b");
    return;
  }

  // 본문은 그대로 내보내지 않는다. 길이 + 아주 짧은 지문만.
  const fingerprint = (s) => {
    const t = String(s || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return "";
    let h = 0;
    for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
    return `len${t.length}#${(h >>> 0).toString(36)}`;
  };

  const rows = [];
  for (const key of keys) {
    const value = all[key];
    const items = Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value)
        ? value
        : [];
    for (const it of items) {
      if (!it?.d) continue; // 후원·구독만 본다
      rows.push({ key, ...it });
    }
  }

  if (!rows.length) {
    console.log("%c[치즈 플래터] 후원 기록이 없습니다.", "color:#ff6b6b");
    return;
  }

  // 저장소 기준 요약(§19 — storage 중복인지부터 가른다).
  const bySrc = {};
  for (const r of rows) {
    const s = String(r.d?.src || "(없음)");
    bySrc[s] = (bySrc[s] || 0) + 1;
  }

  // 근접 쌍 탐지. 자동으로 합치지 않는다 — 출력만 한다.
  const sorted = [...rows].sort((a, b) => (a.t || 0) - (b.t || 0));
  const pairs = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      const delta = (Number(b.t) || 0) - (Number(a.t) || 0);
      if (delta > 120000) break; // 2분 밖은 본다고 보기 어렵다
      if (a.key !== b.key) continue;
      const da = a.d || {};
      const db = b.d || {};
      if (String(da.kind) !== String(db.kind)) continue;
      if ((Number(da.amount) || 0) !== (Number(db.amount) || 0)) continue;
      if (String(da.type || "") !== String(db.type || "")) continue;
      pairs.push({
        deltaMs: delta,
        // ⚠ 이 두 값이 핵심이다. 서로 다른 경로에서 온 같은 후원인지.
        srcA: String(da.src || ""),
        srcB: String(db.src || ""),
        kind: String(da.kind || ""),
        type: String(da.type || ""),
        amount: Number(da.amount) || 0,
        // 안정적인 식별자가 양쪽에 있는지(있으면 확실하게 합칠 수 있다).
        missionIdA: String(da.missionId || ""),
        missionIdB: String(db.missionId || ""),
        relatedA: String(da.relatedMissionId || ""),
        relatedB: String(db.relatedMissionId || ""),
        partyNoA: Number(da.partyNo) || 0,
        partyNoB: Number(db.partyNo) || 0,
        identityA: String(a.i || ""),
        identityB: String(b.i || ""),
        textA: fingerprint(a.m),
        textB: fingerprint(b.m),
        sameText: fingerprint(a.m) === fingerprint(b.m),
        videoA: String(a.n || ""),
        videoB: String(b.n || ""),
        offsetA: a.v ?? null,
        offsetB: b.v ?? null,
      });
    }
  }

  console.log(
    "%c[치즈 플래터] 후원 중복 진단",
    "font-weight:bold;color:#00c07f",
  );
  console.log("%c[donation-summary]", "font-weight:bold;color:#00c07f", {
    저장된_후원행: rows.length,
    출처별: bySrc,
    근접_후보쌍: pairs.length,
  });

  if (!pairs.length) {
    console.log(
      "저장소에서는 중복 후보를 찾지 못했습니다.\n" +
        "→ 화면에만 두 번 보이는 것일 수 있습니다(§19). 그 화면을 캡처해 주세요.",
    );
    return;
  }

  console.log("[donation-possible-duplicates]");
  console.table(pairs.slice(0, 40));
  console.log(
    "위 표에서 특히 srcA/srcB, missionIdA/B, deltaMs 를 함께 보내 주세요.\n" +
      "⚠ 정상적으로 같은 금액을 두 번 후원한 경우도 여기 잡힐 수 있습니다.",
  );
})();
