/**
 * Whole-state-graph comparison of a model across three routes:
 *
 * - qts/tla-ts: quint-ts's translation, checked by tla-ts.
 * - qts/tlc: the same translation, checked by Java TLC (Apalache's jar), so a
 *   difference from qts/tla-ts is the checker's.
 * - official/tlc: Apalache's translation (`quint compile --target tlaplus`),
 *   checked by the same TLC, so a difference from qts/tlc is the translator's.
 *
 * Each run explores every reachable state with `-continue`, dumps the graph,
 * and lists every state that breaks the invariant. A run that stops early is
 * incomplete, and an incomplete graph is never compared as equal.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseState, runQuint, tools, translateFile } from "../src/check.ts";
import { checkerCache } from "../src/cache.ts";
import type { Translation } from "../src/translate.ts";
import { apalacheJar, javaAvailable, type Target } from "./routes.ts";

export interface Graph {
  readonly complete: boolean;
  readonly why: string;
  readonly init: ReadonlySet<string>;
  readonly states: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
  readonly violating: ReadonlySet<string>;
}

/**
 * A TLA+ value with the whitespace outside its string literals removed. Whitespace there means nothing,
 * and printers differ in it: TLC wraps long values (`[ p1 |-> ...`), tla-ts's `formatValue` doesn't.
 */
const squeeze = (value: string): string =>
  value.split(/("(?:[^"\\]|\\.)*")/).map((part, k) => (k % 2 === 1 ? part : part.replace(/\s+/g, ""))).join("");

const CLOSERS: Readonly<Record<string, string>> = { "[": "]", "{": "}", "(": ")", "<<": ">>" };

/**
 * A TLA+ value as printed, squeezed, with each record's fields and each set's elements sorted, so two
 * printings of one value compare equal. TLC and tla-ts print a record's fields in an order of their own,
 * not the model's, which differs between two translations of one model, and a set's order can follow
 * its records' fields. A tuple's and a function's order is kept.
 */
export function canonValue(value: string): string {
  const s = squeeze(value);
  let i = 0;
  // The elements up to `close` (the end of the text when undefined), split at the commas of this level;
  // each says whether it has a `|->` of its own, as a record's field does.
  const group = (close: string | undefined): { text: string; maps: boolean }[] => {
    const out: { text: string; maps: boolean }[] = [];
    let text = "";
    let maps = false;
    while (i < s.length) {
      if (close !== undefined && s.startsWith(close, i)) {
        i += close.length;
        break;
      }
      const c = s[i] ?? "";
      const literal = c === "\"" ? /^"(?:[^"\\]|\\.)*"/.exec(s.slice(i))?.[0] : undefined;
      const open = s.startsWith("<<", i) ? "<<" : "[{(".includes(c) ? c : undefined;
      if (literal !== undefined) {
        text += literal;
        i += literal.length;
      } else if (open !== undefined) {
        i += open.length;
        const inner = group(CLOSERS[open]);
        const texts = inner.map((e) => e.text);
        const unordered = open === "{" || (open === "[" && inner.every((e) => e.maps));
        text += `${open}${(unordered ? texts.sort() : texts).join(",")}${CLOSERS[open] ?? ""}`;
      } else if (c === ",") {
        out.push({ text, maps });
        text = "";
        maps = false;
        i += 1;
      } else {
        if (s.startsWith("|->", i)) maps = true;
        text += c;
        i += 1;
      }
    }
    out.push({ text, maps });
    return out;
  };
  return group(undefined).map((e) => e.text).join(",");
}

const canon = (state: Record<string, string>): string => Object.keys(state).sort().map((k) => `${k} = ${canonValue(state[k] ?? "")}`).join("; ");

function unescapeDot(label: string): string {
  return label.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c));
}

function parseDot(dot: string, t: Translation): { init: Set<string>; states: Set<string>; edges: Set<string> } {
  const byId = new Map<string, string>();
  const init = new Set<string>();
  for (const m of dot.matchAll(/^(-?\d+) \[label="((?:[^"\\]|\\.)*)"(.*)\];?$/gm)) {
    const state = canon(parseState(unescapeDot(m[2] ?? ""), t));
    byId.set(m[1] ?? "", state);
    if ((m[3] ?? "").includes("style = filled")) init.add(state);
  }
  const edges = new Set<string>();
  for (const m of dot.matchAll(/^(-?\d+) -> (-?\d+)/gm)) {
    const from = byId.get(m[1] ?? "");
    const to = byId.get(m[2] ?? "");
    if (from === undefined || to === undefined) throw new Error(`an edge to an unlabelled node in the dump: ${m[0]}`);
    edges.add(`${from}  ->  ${to}`);
  }
  return { init, states: new Set(byId.values()), edges };
}

/** The last state of every counterexample a `-continue` run printed. */
function violatingStates(output: string, t: Translation): Set<string> {
  const found = new Set<string>();
  for (const block of output.split(/^Error: Invariant \S+ is violated\.?$/m).slice(1)) {
    const states = block.split(/\r?\n(?=State \d+:)/).slice(1).map((b) => b.split(/\r?\n\r?\n/)[0] ?? "");
    const last = states.at(-1);
    if (last !== undefined) found.add(canon(parseState(last.split(/\r?\n/).slice(1).join("\n"), t)));
  }
  return found;
}

function explore(tla: string, moduleName: string, cfg: string, t: Translation, checker: "tla-ts" | "tlc"): Graph {
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-graph-"));
  try {
    writeFileSync(join(dir, `${moduleName}.tla`), tla);
    writeFileSync(join(dir, `${moduleName}.cfg`), cfg);
    const dot = join(dir, "graph.dot");
    const args = ["tlc2.TLC", "-workers", "1", "-deadlock", "-continue", "-metadir", join(dir, "states"),
      "-dump", "dot,actionlabels", dot, "-config", `${moduleName}.cfg`, `${moduleName}.tla`];
    const ran = checker === "tla-ts"
      ? spawnSync(process.execPath, [tools.tlaTsCli, `-Djava.io.tmpdir=${checkerCache(tools.tlaTsVersion) ?? dir}`, ...args], { cwd: dir, encoding: "utf8", timeout: 300_000, maxBuffer: 1 << 28 })
      // Java writes stdout in the console's code page unless told otherwise, and strings outside ASCII are read back from it.
      : spawnSync("java", [`-Djava.io.tmpdir=${dir}`, "-Dstdout.encoding=UTF-8", "-cp", apalacheJar, ...args], { cwd: dir, encoding: "utf8", timeout: 300_000, maxBuffer: 1 << 28 });
    const output = `${ran.stdout ?? ""}${ran.stderr ?? ""}`;
    const finished = /Model checking completed|states left on queue/.test(output) && /\b0 states left on queue/.test(output);
    const evalError = /Error: The error occurred when TLC was evaluating|Assert evaluated to FALSE|Error: Parsing or semantic/.test(output);
    const complete = ran.error === undefined && ran.signal === null && finished && !evalError;
    const why = complete ? "" : ran.error !== undefined || ran.signal !== null ? "the checker was stopped"
      : evalError ? (output.split(/\r?\n/).find((l) => /quint-ts-unsupported|^Error:/.test(l)) ?? "an evaluation error") : "the search didn't finish";
    let parsed = { init: new Set<string>(), states: new Set<string>(), edges: new Set<string>() };
    let dumpProblem = "";
    try { parsed = parseDot(readFileSync(dot, "utf8").replace(/\r\n/g, "\n"), t); } catch (err) { dumpProblem = `no readable dump: ${String(err)}`; }
    // An empty or unreadable dump says nothing about the graph, so it is never complete.
    if (dumpProblem === "" && (parsed.states.size === 0 || parsed.init.size === 0)) dumpProblem = "the dump holds no states";
    return { complete: complete && dumpProblem === "", why: dumpProblem !== "" ? dumpProblem : why, ...parsed,
      violating: violatingStates(output.replace(/\r\n/g, "\n"), t) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface GraphRoutes {
  readonly translation: Translation;
  readonly routes: Record<string, Graph>;
}

/** Apalache's translation defines one invariant, q_inv: the conjunction of those given. */
const officialCfg = "INIT q_init\nNEXT q_step\nINVARIANT q_inv\n";

export function graphs(t: Target): GraphRoutes | { error: string } {
  const translated = translateFile(t.file, { main: t.main, invariants: t.invariants ?? [t.invariant] });
  if (translated.kind !== "translated") return { error: `${translated.kind}: ${"reason" in translated ? translated.reason : translated.output}` };
  const translation = translated.translation;
  const cfg = `${translation.cfg}\n`;
  const routes: Record<string, Graph> = { "qts/tla-ts": explore(translation.tla, "Q", cfg, translation, "tla-ts") };
  if (javaAvailable()) {
    routes["qts/tlc"] = explore(translation.tla, "Q", cfg, translation, "tlc");
    const compiled = runQuint(["compile", "--target", "tlaplus", `--main=${t.main}`, `--invariant=${t.invariant}`, t.file], { timeoutMs: 300_000 });
    const moduleName = /^-+ MODULE (\S+) -+/m.exec(compiled.stdout)?.[1];
    routes["official/tlc"] = compiled.status === 0 && moduleName !== undefined
      ? explore(compiled.stdout, moduleName, officialCfg, translation, "tlc")
      : { complete: false, why: `Apalache's translation failed: ${compiled.stderr.split("\n").find((l) => /error|Error/.test(l)) ?? ""}`,
        init: new Set(), states: new Set(), edges: new Set(), violating: new Set() };
  }
  return { translation, routes };
}

export interface Comparison {
  readonly equal: boolean;
  readonly why: string;
  readonly differences: Record<string, { onlyA: string[]; onlyB: string[] }>;
}

export function compare(a: Graph, b: Graph): Comparison {
  if (!a.complete || !b.complete) return { equal: false, why: `incomplete: ${[a.why, b.why].filter((w) => w !== "").join("; ")}`, differences: {} };
  const differences: Comparison["differences"] = {};
  for (const key of ["init", "states", "edges", "violating"] as const) {
    const onlyA = [...a[key]].filter((x) => !b[key].has(x));
    const onlyB = [...b[key]].filter((x) => !a[key].has(x));
    if (onlyA.length + onlyB.length > 0) differences[key] = { onlyA: onlyA.slice(0, 3), onlyB: onlyB.slice(0, 3) };
  }
  return { equal: Object.keys(differences).length === 0, why: "", differences };
}

/** Whether a counterexample, as TLC prints its states, is a real path of `g`: from an initial state, along its edges, to its first violating state. */
export function traceInGraph(trace: readonly Readonly<Record<string, string>>[], g: Graph): string {
  const states = trace.map((s) => canon({ ...s }));
  if (states.length === 0) return "no trace";
  if (!g.init.has(states[0] ?? "")) return "starts outside the initial states";
  for (let k = 1; k < states.length; k += 1) {
    if (!g.edges.has(`${states[k - 1]}  ->  ${states[k]}`)) return `step ${k} isn't a transition of the graph`;
  }
  if (!g.violating.has(states.at(-1) ?? "")) return "ends in a state that doesn't break the invariant";
  if (states.slice(0, -1).some((s) => g.violating.has(s))) return "passes through an earlier violating state";
  return "valid";
}
