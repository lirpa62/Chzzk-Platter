#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "chatRecap.js"),
  "utf8",
);
const mergeStart = source.indexOf("  async function mergeIntoStore(");
const crossSourceCall = source.indexOf(
  "const crossSourceAt = findCrossSourceHistoryMatch(items, r)",
  mergeStart,
);
const slotFallback = source.indexOf("const slotMatches = slot", crossSourceCall);
assert(
  mergeStart >= 0 && crossSourceCall > mergeStart && slotFallback > crossSourceCall,
  "history rows are reconciled across sources before the ordinary slot fallback",
);
const start = source.indexOf("  function crossSourceHistoryMatchScore(");
const end = source.indexOf("  function sameRecapStoredRow(", start);
assert(start >= 0 && end > start, "cross-source history matching helpers exist");
const helpers = source.slice(start, end);
const api = new Function(
  "normalizeDonationMatchText",
  `${helpers}\nreturn { crossSourceHistoryMatchScore, findCrossSourceHistoryMatch, mergeDonationHistoryRow };`,
)(
  (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim(),
);

const history = (t, d, m = "") => ({ t, m, d: { ...d, src: "history" } });
const chat = (t, d, m = "") => ({ t, m, d: { ...d, src: "chat" } });

assert.equal(
  api.findCrossSourceHistoryMatch(
    [
      chat(
        1_000_000_000_000,
        { kind: "DONATION", type: "CHAT", amount: 1000 },
        "고마워요",
      ),
    ],
    history(
      1_000_000_001_000,
      { kind: "DONATION", type: "CHAT", amount: 1000 },
      "고마워요",
    ),
  ),
  0,
  "same donation one second apart is matched",
);

assert.equal(
  api.findCrossSourceHistoryMatch(
    [
      chat(
        1_000_000_000_000,
        { kind: "DONATION", type: "CHAT", amount: 1000 },
        "A",
      ),
    ],
    history(
      1_000_000_001_000,
      { kind: "DONATION", type: "CHAT", amount: 1000 },
      "B",
    ),
  ),
  -1,
  "different donation text is not matched",
);

assert.equal(
  api.findCrossSourceHistoryMatch(
    [
      chat(1_000_000_000_000, {
        kind: "DONATION",
        type: "CHAT",
        amount: 1000,
      }),
    ],
    history(1_000_000_001_000, {
      kind: "DONATION",
      type: "VIDEO",
      amount: 1000,
    }),
  ),
  -1,
  "different donation types are not matched",
);

assert.equal(
  api.findCrossSourceHistoryMatch(
    [
      chat(1_000_000_000_000, {
        kind: "SUBSCRIPTION",
        tier: 2,
        month: 3,
      }),
    ],
    history(1_000_000_001_000, {
      kind: "GIFT_RECEIVED",
      tier: 2,
      month: 3,
    }),
  ),
  0,
  "a subscription chat and corresponding gift history are matched",
);

assert.equal(
  api.findCrossSourceHistoryMatch(
    [
      chat(1_000_000_000_000, {
        kind: "SUBSCRIPTION",
        tier: 1,
        month: 3,
      }),
    ],
    history(1_000_000_001_000, {
      kind: "GIFT_SENT",
      tier: 2,
      month: 3,
    }),
  ),
  -1,
  "different subscription tiers are not matched",
);

assert.equal(
  api.findCrossSourceHistoryMatch(
    [
      chat(1_000_000_000_000, {
        kind: "DONATION",
        type: "CHAT",
        amount: 1000,
      }),
      chat(1_000_000_002_000, {
        kind: "DONATION",
        type: "CHAT",
        amount: 1000,
      }),
    ],
    history(1_000_000_001_000, {
      kind: "DONATION",
      type: "CHAT",
      amount: 1000,
    }),
  ),
  -1,
  "ambiguous nearby records are not merged",
);

const merged = api.mergeDonationHistoryRow(
  chat(
    1_000_000_000_000,
    { kind: "SUBSCRIPTION", tier: 2, month: 3 },
    "채팅 본문",
  ),
  history(1_000_000_001_000, {
    kind: "GIFT_RECEIVED",
    tier: 2,
    month: 3,
  }),
);
assert.equal(merged.t, 1_000_000_001_000, "history timestamp is canonical");
assert.equal(merged.m, "채팅 본문", "empty history text preserves chat content");
assert.equal(merged.d.kind, "GIFT_RECEIVED", "history event kind is retained");
assert.equal(merged.d.src, "history", "history source is recorded");

console.log("chat recap history dedupe tests passed");
