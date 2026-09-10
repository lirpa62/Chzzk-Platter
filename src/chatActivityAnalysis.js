// 치즈 플래터 - 다시보기 채팅 구간별 통계 분석
// 원본 채팅은 저장하지 않고, 호출자가 정한 기존 활성도 bucket에 집계만 남긴다.
(() => {
  "use strict";

  const SCHEMA_VERSION = 4;
  const EMOTICON_TOKEN_RE = /\{:([^:}]+):\}/g;
  const URL_RE = /(?:https?:\/\/|www\.)\S+/giu;
  const TOKEN_RE = /[\p{L}\p{N}]+/gu;
  // NFKC 뒤의 호환 자모(ㅋ/ㅎ/ㅠ)는 U+1100~11FF 자모로 바뀔 수 있다.
  const REACTION_ONLY_RE = /^[ㅋㅎㅠㅜㅡ\u1100-\u11ff]+$/u;
  const NUMBER_ONLY_RE = /^\p{N}+$/u;
  const COMPARISON_SUFFIX_RE =
    /(에서|에게|한테|으로|부터|까지|처럼|보다|하고|이며|이고|은|는|이|가|을|를|의|에|로|와|과|도|만|야|아)$/u;
  const TRAILING_SENTENCE_MARKS_RE = /[.!?,;~…。！？、，；]+$/u;
  const DEFAULT_STOPWORDS = new Set([
    "ㅋㅋ",
    "ㅋㅋㅋ",
    "ㅎㅎ",
    "ㅎㅎㅎ",
    "ㅠㅠ",
    "ㅠㅠㅠ",
    "ㅜㅜ",
    "ㅜㅜㅜ",
    "아니",
    "진짜",
    "그냥",
    "근데",
    "이거",
    "저거",
  ]);
  const DEFAULT_CONFIG = Object.freeze({
    topLimit: 8,
    minTokenLength: 2,
    minPhraseLength: 2,
    maxPhraseLength: 60,
    minRepeatUnit: 3,
    minTfidfCount: 2,
    minTfidfBucketMessages: 10,
    maxTfidfDocumentShare: 0.6,
    excludeTopKeywordCount: 3,
  });

  function mergeConfig(options) {
    return { ...DEFAULT_CONFIG, ...(options || {}) };
  }

  function codePointLength(value) {
    return [...String(value || "")].length;
  }

  function foldRepeatedPhrase(text, minUnit = DEFAULT_CONFIG.minRepeatUnit) {
    const chars = [...String(text || "")];
    const length = chars.length;
    for (let size = minUnit; size < length; size += 1) {
      let repeated = true;
      for (let index = size; index < length; index += 1) {
        if (chars[index] !== chars[index - size]) {
          repeated = false;
          break;
        }
      }
      if (!repeated) continue;
      const unit = chars.slice(0, size).join("").trim();
      const unitLength = codePointLength(unit);
      if (unitLength < minUnit || length < size + unitLength) continue;
      return unit;
    }
    return chars.join("");
  }

  function normalizePhrase(raw, options) {
    const config = mergeConfig(options);
    let value = String(raw || "");
    try {
      // 화면에 보여 주는 문장은 호환 자모 모양을 유지하고 조합형만 정리한다.
      value = value.normalize("NFC");
    } catch {}
    value = value.replace(/\s+/g, " ").trim();
    value = value.replace(/(\{:[^:}]+:\})\s+(?=\{:)/g, "$1");
    value = foldRepeatedPhrase(value, config.minRepeatUnit);
    value = value.replace(/([\u3131-\u318e])\1{2,}/g, "$1$1$1");
    return value.trim();
  }

  function phraseDisplayValue(phrase) {
    return String(phrase || "")
      .replace(TRAILING_SENTENCE_MARKS_RE, "")
      .trim();
  }

  function phraseComparisonKey(phrase) {
    let value = phraseDisplayValue(phrase);
    try {
      value = value.normalize("NFKC");
    } catch {}
    return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
  }

  function normalizeChatText(raw) {
    let value = String(raw || "");
    try {
      value = value.normalize("NFKC");
    } catch {}
    return value
      .toLocaleLowerCase("ko-KR")
      .replace(EMOTICON_TOKEN_RE, " ")
      .replace(URL_RE, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractKeywordTokens(raw, options) {
    const config = mergeConfig(options);
    const stopwords =
      options?.stopwords instanceof Set ? options.stopwords : DEFAULT_STOPWORDS;
    const normalized = normalizeChatText(raw);
    const matches = normalized.match(TOKEN_RE) || [];
    return [
      ...new Set(
        matches.filter((token) => {
          if (codePointLength(token) < config.minTokenLength) return false;
          if (stopwords.has(token)) return false;
          if (REACTION_ONLY_RE.test(token)) return false;
          return !NUMBER_ONLY_RE.test(token);
        }),
      ),
    ];
  }

  function extractEmoticons(raw, emojiMap) {
    const source = String(raw || "");
    const metadata =
      emojiMap && typeof emojiMap === "object" ? emojiMap : Object.create(null);
    const rows = [];
    EMOTICON_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = EMOTICON_TOKEN_RE.exec(source))) {
      const id = String(match[1] || "").trim();
      if (!id) continue;
      const imageUrl =
        typeof metadata[id] === "string" && metadata[id] ? metadata[id] : "";
      rows.push({ id, name: id, imageUrl });
    }
    return rows;
  }

  function createCounterBucket() {
    return {
      messageCount: 0,
      phraseCounts: new Map(),
      keywordCounts: new Map(),
      emoticonCounts: new Map(),
    };
  }

  function createAccumulator(bucketCount, options) {
    const count = Math.max(1, Math.floor(Number(bucketCount) || 1));
    return {
      config: mergeConfig(options),
      buckets: Array.from({ length: count }, createCounterBucket),
      overall: createCounterBucket(),
      emojiUrls: new Map(),
      totalMessages: 0,
      startedAt: Date.now(),
    };
  }

  function increment(map, key, amount = 1) {
    map.set(key, (map.get(key) || 0) + amount);
  }

  function incrementPhrase(map, phrase) {
    const term = phraseDisplayValue(phrase);
    const key = phraseComparisonKey(term);
    if (!term || !key) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, { key, term, count: 1, termCount: 1, variants: null });
      return;
    }

    current.count += 1;
    if (term === current.term && !current.variants) {
      current.termCount += 1;
      return;
    }
    if (!current.variants) {
      current.variants = new Map([[current.term, current.termCount]]);
    }
    const termCount = (current.variants.get(term) || 0) + 1;
    current.variants.set(term, termCount);
    if (
      termCount > current.termCount ||
      (termCount === current.termCount &&
        term.localeCompare(current.term, "ko") < 0)
    ) {
      current.term = term;
      current.termCount = termCount;
    }
  }

  function addChatMessage(accumulator, input) {
    if (!accumulator || input?.analyzable === false) return false;
    const bucketIndex = Math.floor(Number(input?.bucketIndex));
    const bucket = accumulator.buckets?.[bucketIndex];
    if (!bucket) return false;
    const raw = String(input?.text || "");
    if (!raw.trim()) return false;

    bucket.messageCount += 1;
    accumulator.overall.messageCount += 1;
    accumulator.totalMessages += 1;

    const keywordTokens = extractKeywordTokens(raw, accumulator.config);
    const phrase = normalizePhrase(raw, accumulator.config);
    const phraseLength = codePointLength(phrase);
    const sourcePhraseLength = codePointLength(
      String(raw || "").replace(/\s+/g, " ").trim(),
    );
    if (
      keywordTokens.length >= 2 &&
      phraseLength >= accumulator.config.minPhraseLength &&
      phraseLength <= accumulator.config.maxPhraseLength &&
      sourcePhraseLength <= accumulator.config.maxPhraseLength
    ) {
      incrementPhrase(bucket.phraseCounts, phrase);
      incrementPhrase(accumulator.overall.phraseCounts, phrase);
    }

    // 같은 메시지 안의 반복 단어는 extractKeywordTokens의 Set에서 한 번만 남는다.
    for (const token of keywordTokens) {
      increment(bucket.keywordCounts, token);
      increment(accumulator.overall.keywordCounts, token);
    }

    // 이모티콘은 키워드와 달리 실제 등장 횟수를 센다.
    for (const emoticon of extractEmoticons(raw, input?.emojis)) {
      increment(bucket.emoticonCounts, emoticon.id);
      increment(accumulator.overall.emoticonCounts, emoticon.id);
      if (emoticon.imageUrl && !accumulator.emojiUrls.has(emoticon.id)) {
        accumulator.emojiUrls.set(emoticon.id, emoticon.imageUrl);
      }
    }
    return true;
  }

  function compareRows(a, b) {
    return (
      b.count - a.count ||
      String(a.term || a.id || "").localeCompare(
        String(b.term || b.id || ""),
        "ko",
      )
    );
  }

  function topTerms(map, limit) {
    return [...map.entries()]
      .map(([term, count]) => ({ term, key: term, count }))
      .sort(compareRows)
      .slice(0, limit);
  }

  function topEmoticons(map, limit) {
    return [...map.entries()]
      .map(([id, count]) => ({
        id,
        key: id,
        name: id,
        count,
      }))
      .sort(compareRows)
      .slice(0, limit);
  }

  function phraseRows(map) {
    return [...map.values()].map((row) => ({
      term: row.term,
      key: row.key,
      count: row.count,
    }));
  }

  function topPhraseTerms(map, limit) {
    return phraseRows(map).sort(compareRows).slice(0, limit);
  }

  function topPhrases(map, overallMap, bucketShare, limit) {
    return phraseRows(map)
      .map(({ term, key, count }) => {
        const expected = Math.max(
          1e-6,
          (overallMap.get(key)?.count || count) * bucketShare,
        );
        return {
          term,
          key,
          count,
          score: count * Math.log2(1 + count / expected),
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score || b.count - a.count || compareRows(a, b),
      )
      .slice(0, limit);
  }

  function comparisonTermKey(term) {
    const value = String(term || "");
    const match = value.match(COMPARISON_SUFFIX_RE);
    if (!match) return value;
    const base = value.slice(0, -match[1].length);
    // 한 글자 단어는 조사와 어휘 자체를 구분하기 어려워 그대로 둔다.
    return codePointLength(base) >= 2 ? base : value;
  }

  function buildDocumentFrequency(buckets) {
    const frequency = new Map();
    let documentCount = 0;
    for (const bucket of buckets) {
      if (!bucket.keywordCounts.size) continue;
      documentCount += 1;
      for (const term of bucket.keywordCounts.keys()) increment(frequency, term);
    }
    return { documentCount, frequency };
  }

  // 한 구간의 고빈도 단어가 특징어까지 독점하지 않도록 sublinear TF를 사용한다.
  // IDF는 log((N + 1) / (df + 1)) + 1이며, 너무 많은 구간에 걸친 단어와 이미
  // 빈도 키워드로 보여 주는 단어는 특징어 후보에서 제외한다.
  function tfidfTerms(bucket, corpus, config) {
    if (
      bucket.messageCount < config.minTfidfBucketMessages ||
      !corpus.documentCount
    ) {
      return [];
    }
    const rows = [];
    for (const [term, count] of bucket.keywordCounts) {
      if (count < config.minTfidfCount) continue;
      const documentFrequency = corpus.frequency.get(term) || 0;
      if (
        documentFrequency / corpus.documentCount >
        config.maxTfidfDocumentShare
      ) {
        continue;
      }
      const tf = 1 + Math.log(count);
      const idf =
        Math.log((corpus.documentCount + 1) / (documentFrequency + 1)) + 1;
      rows.push({ term, key: term, count, score: tf * idf });
    }
    return rows
      .sort(
        (a, b) =>
          b.score - a.score || b.count - a.count || compareRows(a, b),
      );
  }

  function finalizeBucket(accumulator, bucket, corpus) {
    const { config, overall, buckets } = accumulator;
    const topKeywords = topTerms(bucket.keywordCounts, config.topLimit);
    const excludedFeatureTerms = new Set(
      topKeywords
        .slice(0, config.excludeTopKeywordCount)
        .map((row) => comparisonTermKey(row.term)),
    );
    return {
      messageCount: bucket.messageCount,
      phrases: topPhrases(
        bucket.phraseCounts,
        overall.phraseCounts,
        1 / buckets.length,
        config.topLimit,
      ),
      topKeywords,
      topEmoticons: topEmoticons(
        bucket.emoticonCounts,
        config.topLimit,
      ),
      tfidfKeywords: tfidfTerms(bucket, corpus, config)
        .filter(
          (row) => !excludedFeatureTerms.has(comparisonTermKey(row.term)),
        )
        .slice(0, config.topLimit),
    };
  }

  function finalizeAccumulator(accumulator) {
    const startedAt = Date.now();
    const corpus = buildDocumentFrequency(accumulator.buckets);
    const buckets = accumulator.buckets.map((bucket) =>
      finalizeBucket(accumulator, bucket, corpus),
    );
    const { config, overall, emojiUrls } = accumulator;
    return {
      schemaVersion: SCHEMA_VERSION,
      buckets,
      overall: {
        messageCount: overall.messageCount,
        phrases: topPhraseTerms(overall.phraseCounts, config.topLimit),
        topKeywords: topTerms(overall.keywordCounts, config.topLimit),
        topEmoticons: topEmoticons(
          overall.emoticonCounts,
          config.topLimit,
        ),
      },
      emojiUrls: Object.fromEntries(emojiUrls),
      metrics: {
        totalMessages: accumulator.totalMessages,
        bucketCount: accumulator.buckets.length,
        uniqueKeywordCount: overall.keywordCounts.size,
        processingMs: Date.now() - (accumulator.startedAt || startedAt),
      },
    };
  }

  async function finalizeAccumulatorAsync(
    accumulator,
    { yieldEvery = 24, shouldCancel } = {},
  ) {
    const startedAt = Date.now();
    const corpus = buildDocumentFrequency(accumulator.buckets);
    const buckets = [];
    const step = Math.max(1, Math.floor(Number(yieldEvery) || 24));
    for (let index = 0; index < accumulator.buckets.length; index += 1) {
      if (shouldCancel?.()) return null;
      buckets.push(
        finalizeBucket(accumulator, accumulator.buckets[index], corpus),
      );
      if ((index + 1) % step === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const { config, overall, emojiUrls } = accumulator;
    return {
      schemaVersion: SCHEMA_VERSION,
      buckets,
      overall: {
        messageCount: overall.messageCount,
        phrases: topPhraseTerms(overall.phraseCounts, config.topLimit),
        topKeywords: topTerms(overall.keywordCounts, config.topLimit),
        topEmoticons: topEmoticons(
          overall.emoticonCounts,
          config.topLimit,
        ),
      },
      emojiUrls: Object.fromEntries(emojiUrls),
      metrics: {
        totalMessages: accumulator.totalMessages,
        bucketCount: accumulator.buckets.length,
        uniqueKeywordCount: overall.keywordCounts.size,
        processingMs: Date.now() - (accumulator.startedAt || startedAt),
      },
    };
  }

  function analyzeReplayChat(messages, options = {}) {
    const bucketCount = Math.max(1, Math.floor(Number(options.bucketCount) || 1));
    const accumulator = createAccumulator(bucketCount, options);
    for (const message of messages || []) {
      addChatMessage(accumulator, message);
    }
    return finalizeAccumulator(accumulator);
  }

  globalThis.CheeseChatActivityAnalysis = Object.freeze({
    DEFAULT_CONFIG,
    DEFAULT_STOPWORDS,
    SCHEMA_VERSION,
    addChatMessage,
    analyzeReplayChat,
    createAccumulator,
    extractEmoticons,
    extractKeywordTokens,
    finalizeAccumulator,
    finalizeAccumulatorAsync,
    foldRepeatedPhrase,
    comparisonTermKey,
    normalizeChatText,
    normalizePhrase,
    phraseComparisonKey,
  });
})();
