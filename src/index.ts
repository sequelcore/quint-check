/**
 * quint-ts's programmatic API: check a Quint model and read what the result
 * establishes. Kept small on purpose; anything else in src/ is internal.
 */
export { check } from "./check.js";
export type { CheckOptions, CheckResult, Guarantee } from "./check.js";
export type { ItfState, ItfTrace, ItfValue } from "./itf.js";
