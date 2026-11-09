/**
 * Public Quint models (conformance/public/, from Quint's examples) that
 * quint-check can't give a complete verdict on. The supported ones are in
 * models.ts, compared as whole graphs. See conformance/public/README.md.
 */

/** Translated, but no complete verdict is possible: must be inconclusive, never passed. */
export const PUBLIC_PARTIAL: readonly { id: string; file: string; main: string; timeoutMs: number; why: string }[] = [
  { id: "instances", file: "conformance/public/instances.qnt", main: "instances", timeoutMs: 8_000,
    why: "its counters grow without bound, so an explicit-state search never finishes" },
];

/** Accepted by Quint's frontend, refused by quint-check at translation, naming the construct; Quint's examples, and the demo's model with a list. */
export const PUBLIC_REFUSED: readonly { id: string; file: string; main: string; reason: string }[] = [
  { id: "weakFairness", file: "conformance/public/weakFairness.qnt", main: "weakFairness", reason: "operator leadsTo" },
  { id: "coin", file: "conformance/public/coin.qnt", main: "coin", reason: "operator ipow" },
  { id: "ewd840", file: "conformance/public/ewd840.qnt", main: "ewd840_3", reason: "unresolved name Bool" },
  { id: "prisoners", file: "conformance/public/prisoners.qnt", main: "prisoners3", reason: "unresolved name Bool" },
  { id: "two_phase_commit", file: "conformance/public/two_phase_commit.qnt", main: "two_phase_commit_3", reason: "operator then" },
  { id: "tictactoe", file: "conformance/public/tictactoe.qnt", main: "tictactoe", reason: "operator eventually" },
  { id: "BinSearch", file: "conformance/public/BinSearch.qnt", main: "BinSearch10", reason: "operator List" },
  { id: "generate", file: "conformance/public/generate.qnt", main: "gen", reason: "operator apalache::generate" },
  { id: "counters", file: "conformance/public/counters.qnt", main: "counters", reason: "operator then" },
  { id: "bakery", file: "conformance/public/bakery.qnt", main: "understanding", reason: "unresolved name Nat" },
  { id: "demo-mutex-list", file: "demo/mutex_list.qnt", main: "mutex_list", reason: "operator List" },
];
