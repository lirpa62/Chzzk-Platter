#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
require("../src/chatActivityAnalysis.js");

const api = globalThis.CheeseChatActivityAnalysis;

function analyze(buckets, options = {}) {
  const messages = buckets.flatMap((texts, bucketIndex) =>
    texts.map((entry) => ({
      bucketIndex,
      text: typeof entry === "string" ? entry : entry.text,
      emojis: typeof entry === "string" ? null : entry.emojis,
      analyzable: typeof entry === "string" ? true : entry.analyzable !== false,
    })),
  );
  return api.analyzeReplayChat(messages, {
    bucketCount: buckets.length,
    ...options,
  });
}

// A/B. 모든 구간의 공통어는 특징어에서 빠지고 한 구간에 집중된 단어가 남는다.
const corpus = analyze(
  [
    Array.from({ length: 10 }, (_, index) =>
      index < 4 ? "공통 갑툭튀" : "ㅋㅋㅋㅋ",
    ),
    Array.from({ length: 10 }, (_, index) =>
      index < 4 ? "공통 평범한말" : "ㅋㅋㅋㅋ",
    ),
    Array.from({ length: 10 }, (_, index) =>
      index < 4 ? "공통 또다른말" : "ㅋㅋㅋㅋ",
    ),
  ],
  { excludeTopKeywordCount: 0 },
);
const firstFeatures = corpus.buckets[0].tfidfKeywords;
assert.equal(firstFeatures.some((row) => row.term === "공통"), false);
assert.equal(firstFeatures.some((row) => row.term === "갑툭튀"), true);

// C. 한 메시지에서만 등장한 희귀어는 최소 출현 조건으로 특징어에서 빠진다.
const rare = analyze([
  ["희귀단어", ...Array.from({ length: 9 }, () => "반복단어")],
  Array.from({ length: 10 }, () => "다른구간"),
]);
assert.equal(
  rare.buckets[0].tfidfKeywords.some((row) => row.term === "희귀단어"),
  false,
);

// D. 한 메시지 안에서 같은 키워드를 반복해도 메시지 빈도는 1만 오른다.
const repeated = analyze([["갑툭튀 갑툭튀 갑툭튀", "갑툭튀 등장"]]);
assert.equal(
  repeated.buckets[0].topKeywords.find((row) => row.term === "갑툭튀")
    ?.count,
  2,
);

// E. 이모티콘은 메시지 빈도가 아니라 실제 토큰 등장 횟수대로 정렬한다.
const emoticons = analyze([
  [
    { text: "{:d_1:}{:d_1:}{:d_2:}", emojis: { d_1: "one", d_2: "two" } },
    { text: "{:d_2:}{:d_3:}", emojis: { d_2: "two", d_3: "three" } },
  ],
]);
assert.deepEqual(
  emoticons.buckets[0].topEmoticons.map((row) => [row.id, row.count]),
  [
    ["d_1", 2],
    ["d_2", 2],
    ["d_3", 1],
  ],
);
assert.equal(emoticons.emojiUrls.d_2, "two");

// F. 채팅이 없어도 bucket과 빈 결과를 안전하게 돌려준다.
const empty = analyze([[], [], []]);
assert.equal(empty.buckets.length, 3);
assert.deepEqual(empty.buckets[0].topKeywords, []);
assert.deepEqual(empty.buckets[0].tfidfKeywords, []);

// G. 반복 반응 문자는 키워드 순위에서 제외한다.
const noise = analyze([["ㅋㅋㅋㅋ", "ㅎㅎㅎㅎ", "ㅠㅠㅠ", "의미있는말"]]);
assert.deepEqual(
  noise.buckets[0].topKeywords.map((row) => row.term),
  ["의미있는말"],
);

// H. NFKC, 영문 소문자화, URL 제거와 한글/영문 혼합 집계를 적용한다.
const mixed = analyze([
  ["ＡＢＣ 테스트 https://example.com", "abc 테스트", "12345"],
]);
assert.equal(
  mixed.buckets[0].topKeywords.find((row) => row.term === "abc")?.count,
  2,
);
assert.equal(
  mixed.buckets[0].topKeywords.find((row) => row.term === "테스트")?.count,
  2,
);
assert.equal(
  mixed.buckets[0].topKeywords.some((row) => row.term === "12345"),
  false,
);

// 시스템/후원 등 호출자가 제외한 메시지는 집계 입력 자체에서 무시한다.
const excluded = analyze([[{ text: "시스템 안내", analyzable: false }]]);
assert.equal(excluded.buckets[0].messageCount, 0);

// 반복 문장은 반응 문자·숫자·단일 단어·지나치게 긴 도배를 제외한다.
const phrases = analyze([
  [
    ...Array.from({ length: 5 }, () => "ㅋㅋㅋㅋ"),
    ...Array.from({ length: 5 }, () => "111"),
    ...Array.from({ length: 5 }, () => "단일단어"),
    ...Array.from({ length: 5 }, () => "의미 있는 문장"),
    ...Array.from({ length: 5 }, () => "아주 긴 문장 ".repeat(20)),
  ],
]);
assert.deepEqual(
  phrases.buckets[0].phrases.map((row) => row.term),
  ["의미 있는 문장"],
);

// 문장의 공백과 끝 문장부호 차이는 합치고 가장 많이 쓰인 표기를 보여 준다.
const phraseVariants = analyze([
  [
    ...Array.from({ length: 3 }, () => "캣파이트👊 미야오🐈"),
    ...Array.from({ length: 2 }, () => "캣파이트👊미야오🐈"),
    ...Array.from({ length: 4 }, () => "레나 우승"),
    ...Array.from({ length: 2 }, () => "레나 우승!"),
    ...Array.from({ length: 2 }, () => "캣파이트 미야오"),
  ],
]);
assert.deepEqual(
  phraseVariants.buckets[0].phrases.map((row) => [row.term, row.count]),
  [
    ["레나 우승", 6],
    ["캣파이트👊 미야오🐈", 5],
    ["캣파이트 미야오", 2],
  ],
);

// 특징어는 화면에 먼저 노출할 상위 빈도 키워드와 중복되지 않는다.
const complementary = analyze([
  [
    ...Array.from({ length: 10 }, () => "빈도일 빈도이 빈도삼 특징하나"),
    ...Array.from({ length: 3 }, () => "특징둘 특징셋"),
  ],
  Array.from({ length: 10 }, () => "다른 구간 공통"),
]);
const frequentTerms = new Set(
  complementary.buckets[0].topKeywords.slice(0, 3).map((row) => row.term),
);
assert.equal(
  complementary.buckets[0].tfidfKeywords.some((row) =>
    frequentTerms.has(row.term),
  ),
  false,
);

// 조사만 다른 형태도 집계값은 유지하되 빈도·특징어 사이에서는 중복으로 본다.
const inflections = analyze([
  [
    ...Array.from({ length: 8 }, () => "레나 다른말 세번째"),
    ...Array.from({ length: 3 }, () => "레나의 별도특징"),
  ],
  Array.from({ length: 10 }, () => "다른 구간 공통"),
]);
assert.equal(
  inflections.buckets[0].tfidfKeywords.some((row) => row.term === "레나의"),
  false,
);

// sublinear TF로 횟수 차이를 완화해 구간 고유성이 순위에 반영된다.
const sublinear = analyze(
  [
    [
      ...Array.from({ length: 8 }, () => "넓은단어"),
      ...Array.from({ length: 3 }, () => "고유단어"),
    ],
    ...Array.from({ length: 4 }, () => ["넓은단어"]),
    ...Array.from({ length: 5 }, () => ["별도단어"]),
  ],
  { excludeTopKeywordCount: 0 },
);
const sublinearFeatures = sublinear.buckets[0].tfidfKeywords;
assert.ok(
  sublinearFeatures.findIndex((row) => row.term === "고유단어") <
    sublinearFeatures.findIndex((row) => row.term === "넓은단어"),
);

console.log("chat activity analysis tests passed");
