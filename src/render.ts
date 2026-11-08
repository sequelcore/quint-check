/**
 * The CLI's human output for a check result: the result on stdout, with the verdict on the last line,
 * and the next command, when there is one, on stderr. `--json` prints the result itself instead.
 */

import type { CheckResult } from "./check.js";
import type { ItfValue } from "./itf.js";

/** What the check was asked, to name it in the output and build the next command. */
export interface Request {
  readonly file: string;
  readonly main?: string;
  readonly init?: string;
  readonly step?: string;
  readonly invariants: readonly string[];
  /** As given; the check's default applies when it is undefined. */
  readonly timeoutMs?: number;
}

/** The time limit `check` uses when none is given. */
const DEFAULT_TIMEOUT_MS = 60_000;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** An argument as a shell reads it back: plain when it has nothing a shell would split or expand. */
const arg = (a: string): string => /^[\w./:=@+,-]+$/.test(a) ? a : JSON.stringify(a);

/** `value` as the Quint expression that builds it. A `{ tag, value }` object reads as a variant, as Quint's tools read ITF. */
export function quintValue(value: ItfValue): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if ("#bigint" in value) return value["#bigint"] as string;
  if ("#set" in value) return `Set(${(value["#set"] as readonly ItfValue[]).map(quintValue).join(", ")})`;
  if ("#map" in value) return `Map(${(value["#map"] as readonly (readonly [ItfValue, ItfValue])[]).map(([k, v]) => `${quintValue(k)} -> ${quintValue(v)}`).join(", ")})`;
  if ("#tup" in value) return `(${(value["#tup"] as readonly ItfValue[]).map(quintValue).join(", ")})`;
  const fields = value as Readonly<Record<string, ItfValue>>;
  const keys = Object.keys(fields);
  const tag = fields["tag"];
  const payload = fields["value"];
  if (keys.length === 2 && typeof tag === "string" && payload !== undefined) {
    const unit = typeof payload === "object" && "#tup" in payload && (payload["#tup"] as readonly ItfValue[]).length === 0;
    return unit ? tag : `${tag}(${quintValue(payload)})`;
  }
  return `{ ${keys.map((k) => `${k}: ${quintValue(fields[k] as ItfValue)}`).join(", ")} }`;
}

/** The arguments of `quint-ts check` for `request`, with `timeoutMs` in place of the request's. */
function checkCommand(request: Request, timeoutMs: number): string {
  const options = [
    ...request.main === undefined ? [] : ["--main", request.main],
    ...request.init === undefined ? [] : ["--init", request.init],
    ...request.step === undefined ? [] : ["--step", request.step],
    ...request.invariants.flatMap((i) => ["--invariant", i]),
    "--timeout-ms", String(timeoutMs),
  ];
  return ["quint-ts", "check", request.file, ...options].map(arg).join(" ");
}

/** `quint verify --backend=tlc` for `request`, which checks the whole language with Java. */
function verifyCommand(request: Request): string {
  const options = [
    ...request.main === undefined ? [] : [`--main=${request.main}`],
    ...request.init === undefined ? [] : [`--init=${request.init}`],
    ...request.step === undefined ? [] : [`--step=${request.step}`],
    ...request.invariants.map((i) => `--invariant=${i}`),
  ];
  return ["quint", "verify", "--backend=tlc", request.file, ...options]
    .map((a) => { const eq = a.indexOf("="); return eq > 0 && a.startsWith("--") ? `${a.slice(0, eq + 1)}${arg(a.slice(eq + 1))}` : arg(a); })
    .join(" ");
}

const lines = (...ls: readonly string[]): string => ls.map((l) => `${l}\n`).join("");

/** The human output for `result`, a check of `request`. */
export function render(result: CheckResult, request: Request): { readonly stdout: string; readonly stderr: string } {
  const tools = `checked with ${result.guarantee.frontend.name} ${result.guarantee.frontend.version} and ${result.guarantee.checker.name} ${result.guarantee.checker.version}`;
  switch (result.status) {
    case "passed": {
      const { initialStates, distinctStates } = result.search;
      const which = request.invariants.length === 1 ? `${request.invariants[0]} holds` : `each of the ${request.invariants.length} invariants holds`;
      const where = distinctStates === 1 ? "the 1 reachable state" : `all ${distinctStates} reachable states`;
      return {
        stdout: lines(`search: complete, ${plural(distinctStates, "distinct state")} from ${plural(initialStates, "initial state")}; deadlock not checked`,
          tools, `passed: ${which} in ${where}`),
        stderr: "",
      };
    }
    case "violated": {
      const { trace, search } = result;
      // After the first state, only the variables a step changed: the whole states are in --json and --out-itf.
      // ITF sorts sets and maps, so equal values have equal JSON text.
      const states = trace.states.flatMap((s, k) => {
        const previous = trace.states[k - 1];
        const changed = trace.vars.filter((v) => previous === undefined || JSON.stringify(s[v]) !== JSON.stringify(previous[v]));
        return [
          `  state ${s["#meta"].index}, ${s["#meta"].action}`,
          ...changed.length === 0 ? ["    no change"] : changed.map((v) => `    ${v} = ${quintValue(s[v] as ItfValue)}`),
        ];
      });
      return {
        stdout: lines("trace (each state after the first shows only what changed):", ...states,
          `search: stopped at the first violation, ${plural(search.distinctStates, "distinct state")}, ${search.queuedStates} still queued; deadlock not checked`,
          tools, `violated: ${result.invariant} breaks in state ${trace.states.length - 1} of the trace above`),
        stderr: "",
      };
    }
    case "unsupported": {
      const found = result.where === "translation" ? "found during translation); nothing was checked" : "a reachable state needs it); nothing was proved";
      return {
        stdout: lines(`unsupported: ${result.reason}, outside quint-ts's subset (${found}`),
        stderr: lines(`${verifyCommand(request)} checks the whole language (needs Java)`),
      };
    }
    case "inconclusive": {
      if (result.reason === "no-initial-state") {
        const init = request.init ?? "init";
        return { stdout: lines(`inconclusive: ${init} has no satisfying state, so nothing was checked`), stderr: lines(`check that ${init} can assign every state variable`) };
      }
      const limit = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const when = result.guarantee.scope === "none" ? "before the search began" : "during the search";
      return {
        stdout: lines(`inconclusive: the ${limit} ms time limit ran out ${when}; nothing was proved`),
        stderr: lines(`rerun with more time: ${checkCommand(request, Math.min(limit * 2, 2 ** 31 - 1))}`),
      };
    }
    case "error": {
      const output = result.output.trimEnd();
      const stages: Readonly<Record<typeof result.stage, readonly [string, string]>> = {
        frontend: ["Quint's frontend rejected the model", "fix what Quint reports, then run the same command again"],
        translation: ["the checker couldn't read quint-ts's translation", "this is a quint-ts defect; open an issue in sequelcore/quint-ts with the model and this command"],
        checker: ["the checker failed", "run the same command once more; if it fails again, open an issue with the output above"],
      };
      const [what, next] = stages[result.stage];
      return { stdout: lines(...output === "" ? [] : [output], `error: ${what}${output === "" ? "" : " (above)"}`), stderr: lines(next) };
    }
  }
}
