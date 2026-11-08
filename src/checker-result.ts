/**
 * What the checker child reads and writes in its run folder. The parent writes `job.json`; the child
 * writes `result.json` whole, by renaming a finished file, or not at all. The parent accepts a result
 * only if it parses into exactly this shape: anything missing, partial or malformed is rejected, so it
 * can't become a verdict.
 */

import type { Dump } from "./itf.js";

export const JOB_FILE = "job.json";
export const RESULT_FILE = "result.json";

export interface CheckerJob {
  readonly source: string;
  readonly config: string;
  /** The checker cache folder, or absent when caching is off. */
  readonly cacheDir?: string;
}

export interface CheckerTraceStep {
  /** tla-ts's `TraceStep.label`, as TLC prints it (`step line 65, col 24 to ...`); null for an initial state. */
  readonly label: string | null;
  /** Each TLA+ variable's value, as tla-ts's `formatValue` prints it; the conformance harness compares it with TLC's graphs. */
  readonly state: Readonly<Record<string, string>>;
  /** Each TLA+ variable's value as a structure, which the parent encodes as ITF. */
  readonly values: Readonly<Record<string, Dump>>;
}

export type CheckerResult =
  | {
    readonly kind: "checked";
    /** tla-ts's `CheckResult.status`. */
    readonly status: string;
    readonly distinctStates: number;
    readonly queuedStates: number;
    /** Distinct initial states, from `CheckResult.initialStates`. */
    readonly initialStates: number;
    readonly violation?: { readonly name: string; readonly trace: readonly CheckerTraceStep[] };
    /** `CheckResult.failure.message`, when the check failed while evaluating. */
    readonly failure?: string;
  }
  /** tla-ts threw: `syntax` and `config` mean it rejected the translation. */
  | { readonly kind: "threw"; readonly error: "syntax" | "config" | "other"; readonly message: string };

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isDump(v: unknown): v is Dump {
  if (typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isSafeInteger(v);
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 1) return false;
  if (keys[0] === "set") return Array.isArray(v["set"]) && v["set"].every(isDump);
  return keys[0] === "fn" && Array.isArray(v["fn"])
    && v["fn"].every((e: unknown) => Array.isArray(e) && e.length === 2 && isDump(e[0]) && isDump(e[1]));
}

function isStep(v: unknown): v is CheckerTraceStep {
  return isObject(v) && (v["label"] === null || typeof v["label"] === "string") && isObject(v["state"]) && isObject(v["values"])
    && Object.values(v["state"]).every((x) => typeof x === "string") && Object.values(v["values"]).every(isDump);
}

/** The result in `text`, or undefined unless it is complete and well formed. */
export function parseCheckerResult(text: string): CheckerResult | undefined {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(v)) return undefined;
  if (v["kind"] === "threw") {
    const error = v["error"];
    if ((error !== "syntax" && error !== "config" && error !== "other") || typeof v["message"] !== "string") return undefined;
    return { kind: "threw", error, message: v["message"] };
  }
  if (v["kind"] !== "checked" || typeof v["status"] !== "string") return undefined;
  if (!isCount(v["distinctStates"]) || !isCount(v["queuedStates"]) || !isCount(v["initialStates"])) return undefined;
  const violation = v["violation"];
  if (violation !== undefined
    && !(isObject(violation) && typeof violation["name"] === "string" && Array.isArray(violation["trace"]) && violation["trace"].every(isStep))) {
    return undefined;
  }
  if (v["failure"] !== undefined && typeof v["failure"] !== "string") return undefined;
  return {
    kind: "checked",
    status: v["status"],
    distinctStates: v["distinctStates"],
    queuedStates: v["queuedStates"],
    initialStates: v["initialStates"],
    ...violation === undefined ? {} : { violation: violation as { name: string; trace: CheckerTraceStep[] } },
    ...typeof v["failure"] === "string" ? { failure: v["failure"] } : {},
  };
}
