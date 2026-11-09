/**
 * quint-check's counterexamples as ITF, checked by Quint itself. Each check uses only Quint's frontend,
 * its simulator and its own ITF writer, with the variables' types from Quint's IR, never quint-check's
 * converter:
 *
 * - replay (C1): the states, as Quint literals, are replayed through `quint run --init/--step`, and the
 *   ITF Quint writes for the replay must equal quint-check's, with sets and maps sorted and `#meta` set
 *   aside. Proves each value is a well-typed value of its variable, encoded as Quint encodes it; not
 *   that the values are the right ones.
 * - violation (C2): the replay reports the violation at the last state and no earlier.
 * - transitions (C3): Quint's simulator, from each state with the model's own step, reaches the next one;
 *   and the model's own init reaches the first. A miss is a failure to look at: the simulator samples.
 * - apalache (C5): `quint verify --out-itf` has the same variables and the same length.
 *
 * A green result says these traces are ones Quint's evaluator accepts, encoded as Quint encodes them.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontend, runQuint } from "../src/check.ts";
import type { ItfTrace, ItfValue } from "../src/itf.ts";
import type { Target } from "./routes.ts";

// Quint's IR types, read where they are used.
type Type = any;

export interface ItfChecks {
  readonly replay: string;
  readonly violation: string;
  readonly transitions: string;
  readonly apalache: string;
}

const quint = (args: readonly string[], timeoutMs = 300_000) => runQuint(args, { timeoutMs });
const invariantArgs = (t: Target): string[] => t.invariants === undefined ? [`--invariant=${t.invariant}`] : ["--invariants", ...t.invariants];

/** Each state variable's full Quint name to its type, from Quint's IR for `t`. */
function variableTypes(t: Target): Map<string, Type> {
  const front = frontend(t.file, { main: t.main, invariants: [] });
  if (!front.ok) throw new Error(front.output);
  const ir = front.ir as Type;
  const main = ir.modules.find((m: Type) => m.name === ir.main);
  return new Map(main.declarations.filter((d: Type) => d.kind === "var").map((d: Type) => [d.name, ir.types[d.id].type]));
}

/** `x`, a value of Quint type `t`, as a Quint expression. */
function literal(x: ItfValue, t: Type): string {
  const v = x as Record<string, any>;
  switch (t.kind) {
    case "bool": return String(x);
    case "str": return JSON.stringify(x);
    case "int": return `(${v["#bigint"]})`;
    case "set": return `Set(${(v["#set"] as ItfValue[]).map((e) => literal(e, t.elem)).join(", ")})`;
    case "fun": return `Map(${(v["#map"] as [ItfValue, ItfValue][]).map(([k, y]) => `${literal(k, t.arg)} -> ${literal(y, t.res)}`).join(", ")})`;
    case "tup": return `(${(v["#tup"] as ItfValue[]).map((e, k) => literal(e, t.fields.fields[k].fieldType)).join(", ")})`;
    case "rec": return `{ ${t.fields.fields.map((f: Type) => `${f.fieldName}: ${literal(v[f.fieldName], f.fieldType)}`).join(", ")} }`;
    case "sum": {
      if (typeof v["tag"] !== "string" || !("value" in v)) throw new Error(`a variant written as ${JSON.stringify(x).slice(0, 60)}`);
      const field = t.fields.fields.find((f: Type) => f.fieldName === v["tag"]);
      if (field === undefined) throw new Error(`no constructor ${v["tag"]} in its type`);
      return field.fieldType.kind === "tup" && field.fieldType.fields.fields.length === 0 ? v["tag"] : `${v["tag"]}(${literal(v["value"], field.fieldType)})`;
    }
    default: throw new Error(`no literal for type ${t.kind}`);
  }
}

/** Sets and maps sorted, `#meta` set aside, record fields in order: two encodings of one value become one text. */
export function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (x === null || typeof x !== "object") return x;
  const o = x as Record<string, unknown>;
  const sortedBy = (items: unknown[]): unknown[] => items.map(canonical).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  if ("#set" in o) return { "#set": sortedBy(o["#set"] as unknown[]) };
  if ("#map" in o) return { "#map": sortedBy(o["#map"] as unknown[]) };
  return Object.fromEntries(Object.keys(o).filter((k) => k !== "#meta").sort().map((k) => [k, canonical(o[k])]));
}

/**
 * The name `t.main` refers to a variable by: its full name without the main module's prefix (`a::x` for an
 * instance imported `as a`), or its last segment when the instance was imported with `.*`.
 */
function names(t: Target, trace: ItfTrace, qualified: boolean): Map<string, string> {
  const prefix = `${t.main}::`;
  return new Map(trace.vars.map((v) => {
    const relative = v.startsWith(prefix) ? v.slice(prefix.length) : v;
    return [v, qualified ? relative : relative.split("::").at(-1) ?? relative];
  }));
}

/** Check `trace`, quint-check's counterexample for `t`, against Quint. `apalache` runs the comparison with `quint verify`. */
export function itfChecks(t: Target, trace: ItfTrace, apalache: boolean): ItfChecks {
  const types = variableTypes(t);
  if (JSON.stringify([...types.keys()].sort()) !== JSON.stringify([...trace.vars].sort())) {
    return { replay: `variables ${JSON.stringify(trace.vars)}, the model's ${JSON.stringify([...types.keys()])}`, violation: "not run", transitions: "not run", apalache: "not run" };
  }
  const dir = mkdtempSync(join(tmpdir(), "quint-check-itf-"));
  try {
    let replay = "";
    let violation = "";
    let transitions = "";
    // Qualified names first; Quint rejects them (QNT404) when an instance was imported with `.*`.
    for (const qualified of [true, false]) {
      const ref = names(t, trace, qualified);
      const lit = (s: ItfTrace["states"][number], v: string): string => literal(s[v] as ItfValue, types.get(v));
      const assign = (s: ItfTrace["states"][number]): string => `all { ${trace.vars.map((v) => `${ref.get(v)}' = ${lit(s, v)}`).join(", ")} }`;
      const equal = (s: ItfTrace["states"][number]): string => `all { ${trace.vars.map((v) => `${ref.get(v)} == ${lit(s, v)}`).join(", ")} }`;
      const { states } = trace;
      const first = states[0];
      if (first === undefined) return { replay: "no states", violation: "no states", transitions: "no states", apalache: "not run" };
      let init: string;
      let step: string;
      try {
        init = assign(first);
        step = states.length === 1 ? assign(first) : `any { ${states.slice(1).map((s, k) => `all { ${equal(states[k] ?? first)}, ${assign(s)} }`).join(", ")} }`;
      } catch (err) {
        return { replay: `no Quint literal: ${(err as Error).message}`, violation: "not run", transitions: "not run", apalache: "not run" };
      }
      const out = join(dir, "replay.itf.json");
      const ran = quint(["run", t.file, `--main=${t.main}`, "--init", init, "--step", step, ...invariantArgs(t),
        `--max-steps=${states.length - 1}`, "--max-samples=1", "--seed=1", "--out-itf", out]);
      if (qualified && /QNT404/.test(`${ran.stdout}${ran.stderr}`)) continue;
      let q: ItfTrace;
      try {
        q = JSON.parse(readFileSync(out, "utf8")) as ItfTrace;
      } catch {
        const why = `${ran.stdout}${ran.stderr}`.split(/\r?\n/).find((l) => /error|Error/.test(l)) ?? `exit ${ran.status}`;
        return { replay: `Quint wrote no replay: ${why}`, violation: "not run", transitions: "not run", apalache: "not run" };
      }
      // Quint names the replay's variables by their full names, as quint-check must.
      const sameVars = JSON.stringify([...q.vars].sort()) === JSON.stringify([...trace.vars].sort());
      replay = !sameVars ? `variables ${JSON.stringify(trace.vars)}, Quint's ${JSON.stringify(q.vars)}`
        : JSON.stringify(canonical(q.states)) === JSON.stringify(canonical(states.slice(0, q.states.length))) ? "ok" : "a state differs from Quint's encoding";
      violation = q["#meta"].status === "violation" && q.states.length === states.length ? "ok"
        : `Quint reports ${q["#meta"].status} after ${q.states.length} of ${states.length} states`;
      // C3: Quint's own init reaches the first state, and its own step each next one.
      const missed: string[] = [];
      const reaches = (from: string[], target: ItfTrace["states"][number], what: string): void => {
        const w = quint(["run", t.file, `--main=${t.main}`, ...from, `--invariant=not(${equal(target)})`, "--max-samples=1000", "--seed=1"]);
        if (!(w.status === 1 && /^\[violation\]/m.test(w.stdout))) missed.push(what);
      };
      reaches(["--max-steps=0"], first, "init");
      states.slice(1).forEach((s, k) => reaches(["--init", assign(states[k] ?? first), "--max-steps=1"], s, `step ${k + 1}`));
      transitions = missed.length === 0 ? "ok" : `the simulator didn't reach ${missed.join(", ")}`;
      break;
    }
    return { replay, violation, transitions, apalache: apalache ? againstApalache(t, trace, dir) : "not run" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** C5: Quint's own checker, through Apalache, finds a counterexample with the same variables and as many states. */
function againstApalache(t: Target, trace: ItfTrace, dir: string): string {
  const out = join(dir, "verify.itf.json");
  const ran = quint(["verify", t.file, `--main=${t.main}`, `--invariant=${t.invariant}`, "--out-itf", out]);
  let a: ItfTrace;
  try {
    a = JSON.parse(readFileSync(out, "utf8")) as ItfTrace;
  } catch {
    return `quint verify wrote no counterexample (exit ${ran.status})`;
  }
  if (JSON.stringify([...a.vars].sort()) !== JSON.stringify([...trace.vars].sort())) return `Apalache's variables are ${JSON.stringify(a.vars)}`;
  return a.states.length === trace.states.length ? "ok" : `Apalache's counterexample has ${a.states.length} states, quint-check's ${trace.states.length}`;
}

/** A copy of `trace` with `f` applied to every value, for the negative controls. */
function mapValues(trace: ItfTrace, f: (x: ItfValue) => ItfValue): ItfTrace {
  const walk = (x: ItfValue): ItfValue => {
    const y = f(x);
    if (Array.isArray(y)) return y.map(walk) as unknown as ItfValue;
    if (y === null || typeof y !== "object") return y;
    return Object.fromEntries(Object.entries(y).map(([k, v]) => [k, walk(v as ItfValue)])) as ItfValue;
  };
  return { ...trace, states: trace.states.map((s) => ({ ...Object.fromEntries(trace.vars.map((v) => [v, walk(s[v] as ItfValue)])), "#meta": s["#meta"] })) };
}

/**
 * C6: traces broken on purpose, each of which a named check must reject; a control that passes means
 * the checks can't see that defect. `trace` must hold a unit variant and a variant with a payload.
 */
export function controls(t: Target, trace: ItfTrace): Record<string, string> {
  const isVariant = (x: ItfValue): x is { tag: string; value: ItfValue } => typeof x === "object" && x !== null && "tag" in x && "value" in x;
  const isUnit = (x: ItfValue): boolean => isVariant(x) && JSON.stringify(x.value) === JSON.stringify({ "#tup": [] });
  const flipped = structuredClone(trace) as { states: Record<string, ItfValue>[] } & ItfTrace;
  const int = trace.vars.find((v) => typeof flipped.states[0]?.[v] === "object" && "#bigint" in (flipped.states[0]?.[v] as object));
  if (int !== undefined && flipped.states[0] !== undefined) flipped.states[0][int] = { "#bigint": "1000" };
  const cases: [string, ItfTrace, keyof ItfChecks][] = [
    // A wrong value of the right type: well typed, so only the transitions see it.
    ["a changed value", flipped, "transitions"],
    // Apalache's encoding of a unit payload, which Quint's writer doesn't produce.
    ["Apalache's unit", mapValues(trace, (x) => isUnit(x) ? { tag: (x as { tag: string }).tag, value: { tag: "UNIT" } } : x), "replay"],
    // A variant written as the map TLA+ prints it as.
    ["a variant as a map", mapValues(trace, (x) => isVariant(x) && !isUnit(x) ? { "#map": [[x.tag, x.value]] } : x), "replay"],
  ];
  return Object.fromEntries(cases.map(([what, broken, check]) => {
    let verdict: string;
    try {
      verdict = itfChecks(t, broken, false)[check];
    } catch (err) {
      verdict = `threw: ${(err as Error).message}`;
    }
    return [what, verdict === "ok" ? `NOT caught by ${check}` : `caught by ${check}: ${verdict}`];
  }));
}

/** C6 for names: a trace with each variable by its last name segment, as quint-check reported them before, must fail the replay. */
export function shortNamesControl(t: Target, trace: ItfTrace): string {
  const short = (v: string): string => v.split("::").at(-1) ?? v;
  const renamed: ItfTrace = { ...trace, vars: trace.vars.map(short),
    states: trace.states.map((s) => ({ ...Object.fromEntries(trace.vars.map((v) => [short(v), s[v]])), "#meta": s["#meta"] }) as ItfTrace["states"][number]) };
  let verdict: string;
  try {
    verdict = itfChecks(t, renamed, false).replay;
  } catch (err) {
    verdict = `threw: ${(err as Error).message}`;
  }
  return verdict === "ok" ? "NOT caught by replay" : `caught by replay: ${verdict}`;
}
