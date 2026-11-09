/**
 * bun run conformance [--no-official]
 *
 * Runs every operator case, unsupported case and model through every route,
 * writes conformance/results/<platform>-<arch>.json and conformance/MATRIX.md, and exits
 * non-zero when a result breaks its expectation or two routes disagree in a
 * way no case explains.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, frontend, tlaStates, tools, translateFile } from "../src/check.ts";
import { sourceChanged } from "./source-changed.ts";
import { compare, graphs, traceInGraph } from "./graph.ts";
import { controls, itfChecks, shortNamesControl } from "./itf.ts";
import { MODEL_CASES } from "./models.ts";
import { OPERATOR_CASES, UNSUPPORTED_CASES } from "./operators.ts";
import { PUBLIC_PARTIAL, PUBLIC_REFUSED } from "./public.ts";
import { APALACHE_VERSION, apalacheJar, evaluator, javaAvailable, official, quintCheck, startApalache, stopApalache, type RouteRun } from "./routes.ts";

const withOfficial = !process.argv.includes("--no-official") && javaAvailable();
const failures: string[] = [];
const fail = (what: string): void => { failures.push(what); console.log(`  FAIL ${what}`); };

/** Quint's built-in sets, which the IR holds as names, not applications; a case lists them as it lists opcodes. */
const BUILTIN_SETS = new Set(["Bool", "Int", "Nat"]);

function opcodes(ex: unknown, out: Set<string>): Set<string> {
  if (ex === null || typeof ex !== "object") return out;
  const node = ex as Record<string, unknown>;
  if (typeof node["opcode"] === "string") out.add(node["opcode"]);
  if (node["kind"] === "name" && typeof node["name"] === "string" && BUILTIN_SETS.has(node["name"])) out.add(node["name"]);
  for (const value of Object.values(node)) opcodes(value, out);
  return out;
}

function irOpcodes(file: string, main: string, invariant = "inv"): Set<string> {
  const front = frontend(file, { main, invariants: [invariant] });
  return front.ok ? opcodes(front.ir, new Set()) : new Set();
}

const scratch = mkdtempSync(join(tmpdir(), "quint-check-conformance-"));
function caseFile(id: string, body: string): string {
  const file = join(scratch, `${id.replaceAll("-", "_")}.qnt`);
  writeFileSync(file, `module ${id.replaceAll("-", "_")} {\n${body}\n}\n`);
  return file;
}

const environment = {
  date: new Date().toISOString(),
  platform: `${process.platform} ${process.arch}`,
  bun: process.versions["bun"] ?? "",
  node: spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim(),
  quint: tools.quintVersion,
  tlaTs: tools.tlaTsVersion,
  java: withOfficial ? (spawnSync("java", ["-version"], { encoding: "utf8" }).stderr.split(/\r?\n/)[0] ?? "") : "not used",
  apalache: withOfficial ? APALACHE_VERSION : "not used",
  apalacheJarSha256: withOfficial && existsSync(apalacheJar) ? createHash("sha256").update(readFileSync(apalacheJar)).digest("hex") : "",
  commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || "uncommitted",
  dirty: sourceChanged("."),
};

/** A model's ITF checks in a cell of the matrix. */
function itfCell(itf: any): string {
  if (itf === undefined) return "—";
  const quint = ["replay", "violation", "transitions"].every((k) => itf[k] === "ok") ? "Quint accepts it" : "rejected: see JSON";
  const apalache = itf.apalacheKnown !== undefined ? `Apalache: ${itf.apalacheKnown}` : itf.apalache === "ok" ? "Apalache: same shape" : `Apalache: ${itf.apalache}`;
  const controls = Object.values(itf.controls ?? {}) as string[];
  return `${quint}; ${apalache}${controls.length === 0 ? "" : `; ${controls.filter((c) => c.startsWith("caught")).length}/${controls.length} controls caught`}`.replaceAll("|", "\\|");
}

/** Write conformance/MATRIX.md: every platform's last run, and the tables of the run in `resultsFile`. */
// The rows are read back from JSON, so they are typed loosely here; run.ts writes them above.
function writeMatrix(resultsFile: string, data: any): void {
  const environment: any = data.environment;
  const failures: string[] = data.failures;
  const operatorRows: any[] = data.operatorRows;
  const unsupportedRows: any[] = data.unsupportedRows;
  const modelRows: any[] = data.modelRows;
  const publicRows: any[] = data.publicRows ?? [];
  const withOfficial = environment.apalache !== "not used";
  // Every platform's last run, so a matrix written on one platform still shows how the others stand.
  const platforms = readdirSync("conformance/results").filter((f) => f.endsWith(".json")).sort().map((f) => {
    const other = JSON.parse(readFileSync(`conformance/results/${f}`, "utf8")) as { environment: typeof environment; failures: string[] };
    return `| [${f.replace(".json", "")}](results/${f}) | ${other.environment.date} | ${other.environment.commit}${other.environment.dirty ? " (uncommitted changes)" : ""} | ` +
      `${other.failures.length === 0 ? "every expectation held" : `${other.failures.length} failure(s)`} |`;
  });
  const cell = (r: RouteRun | undefined): string => (r === undefined ? "not run" : r.outcome);
  const md = [
    "# Conformance matrix",
    "",
    "Generated by `bun run conformance`; don't edit by hand.",
    "",
    "| Platform | Last run | Commit | Result |",
    "| --- | --- | --- | --- |",
    ...platforms,
    "",
    `The tables below are from the ${environment.platform} run, [results/${resultsFile}](results/${resultsFile}).`,
    "",
    `Run ${environment.date} on ${environment.platform}: Quint ${environment.quint}, tla-ts ${environment.tlaTs}, Bun ${environment.bun}, Node ${environment.node}, ` +
      `${withOfficial ? `Apalache ${environment.apalache}, ${environment.java}` : "official route not run (no Java)"}; commit ${environment.commit}${environment.dirty ? " (uncommitted changes)" : ""}.`,
    "",
    failures.length === 0 ? "**Result: every expectation held.**" : `**Result: ${failures.length} failure(s).**\n\n${failures.map((f) => `- ${f}`).join("\n")}`,
    "",
    "## Operators",
    "",
    "A defined case must pass everywhere; any other must be `unsupported` in quint-check, and the other routes are recorded.",
    "",
    "| Case | Semantics | quint-check | evaluator-ts | evaluator-rust | official (Apalache + TLC) | Source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...operatorRows.map((r) => `| \`${r.id}\` | ${r.semantics} | ${cell(r.routes["quint-check"])} | ${cell(r.routes["evaluator-ts"])} | ${cell(r.routes["evaluator-rust"])} | ${cell(r.routes["official"])} | ${r.source.replaceAll("|", "\\|")} |`),
    "",
    "## Constructs outside the MVP",
    "",
    "| Case | quint-check | Reason |",
    "| --- | --- | --- |",
    ...unsupportedRows.map((r) => `| \`${r.id}\` | ${r.status} | ${r.reason.replaceAll("|", "\\|").replaceAll("\n", " ")} |`),
    "",
    "## Models without a complete verdict",
    "",
    "From Quint's examples ([public/](public/)), and the demo's model with variants. The supported ones are in the models table below.",
    "",
    "| Model | Group | Expected | quint-check | Reason |",
    "| --- | --- | --- | --- | --- |",
    ...publicRows.map((r) => `| \`${r.id}\` | ${r.group} | ${r.expected} | ${r.status} | ${r.reason.replaceAll("|", "\\|").replaceAll("\n", " ")} |`),
    "",
    "## Models",
    "",
    "Graphs are explored completely with `-continue`: initial states, states, transitions and the states that break the invariant are compared as sets.",
    "",
    "A counterexample's ITF is replayed through Quint's simulator, which must write the same ITF and break the invariant at the last state",
    "only, and must reach each state with the model's own init and step; Apalache's counterexample must have the same variables and length.",
    "",
    "| Model | Expected | quint-check | Simulator (300 samples) | Official | qc/tla-ts vs qc/tlc | qc/tlc vs official/tlc | Counterexample | ITF |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...modelRows.map((r) => {
      const eq = (k: string): string => {
        const c = r.comparisons[k] as { equal: boolean; why: string } | undefined;
        return c === undefined ? "not run" : c.equal ? "equal" : `differ (${c.why || "see JSON"})`;
      };
      const graph = r.graphs["qc/tla-ts"] as { states: number; edges: number } | undefined;
      return `| \`${r.id}\` | ${r.expect} | ${r.quintCheck}${graph === undefined ? "" : ` (${graph.states} states, ${graph.edges} transitions)`} | ${r.simulator.outcome} | ${r.official?.outcome ?? "not run"} | ${eq("qc/tla-ts vs qc/tlc")} | ${eq("qc/tlc vs official/tlc")} | ${r.trace === undefined ? "—" : Object.values(r.trace).every((v) => v === "valid") ? `valid in ${Object.keys(r.trace).length} graphs` : "invalid: see JSON"} | ${itfCell(r.itf)} |`;
    }),
    "",
  ].join("\n");
  writeFileSync("conformance/MATRIX.md", md);
}

if (process.argv.includes("--report-only")) {
  // Rebuild the matrix from the results files, with the tables of --from (default: this platform's file); run nothing.
  const fromFlag = process.argv.indexOf("--from");
  const from = fromFlag === -1 ? `${process.platform}-${process.arch}.json` : (process.argv[fromFlag + 1] ?? "");
  writeMatrix(from, JSON.parse(readFileSync(`conformance/results/${from}`, "utf8")));
  console.log(`conformance/MATRIX.md written from results/${from}`);
  process.exit(0);
}

/** `f` over `items` one at a time, in order, as the harness runs its cases. */
async function mapInOrder<T, R>(items: readonly T[], f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await f(item));
  return out;
}

const server = withOfficial ? await startApalache() : undefined;
try {
  console.log("operator cases");
  const operatorRows = await mapInOrder(OPERATOR_CASES, async (c) => {
    console.log(`- ${c.id}`);
    const file = caseFile(c.id, `${c.decls === undefined ? "" : `${c.decls}\n`}var ok: bool\naction init = ok' = (${c.expr})\naction step = ok' = ok\nval inv = ok`);
    const target = { file, main: c.id.replaceAll("-", "_"), invariant: "inv" };
    const used = irOpcodes(file, target.main);
    for (const op of c.ops) if (!used.has(op)) fail(`${c.id}: declares ${op}, which its IR doesn't use`);
    const routes: Record<string, RouteRun> = {
      "quint-check": await quintCheck(target),
      "evaluator-ts": evaluator(target, "typescript"),
      "evaluator-rust": evaluator(target, "rust"),
      ...withOfficial ? { official: official(target) } : {},
    };
    const expected = c.quintCheck ?? (c.semantics === "defined" ? "passed" : "unsupported");
    if (routes["quint-check"]?.outcome !== expected) fail(`${c.id}: quint-check ${routes["quint-check"]?.outcome} (${routes["quint-check"]?.detail}), expected ${expected}`);
    const verdicts: Record<string, string> = {};
    for (const [route, run] of Object.entries(routes)) {
      if (route === "quint-check") continue;
      const known = c.known?.[route];
      if (c.semantics !== "defined") verdicts[route] = "recorded";
      else if (run.outcome === "passed") verdicts[route] = "agrees";
      else if (known?.outcome === run.outcome) verdicts[route] = `known: ${known.why}`;
      else { verdicts[route] = "UNEXPLAINED"; fail(`${c.id}: ${route} ${run.outcome} (${run.detail}) on a defined case`); }
    }
    return { ...c, routes, verdicts };
  });

  console.log("unsupported cases");
  const unsupportedRows = await mapInOrder(UNSUPPORTED_CASES, async (c) => {
    console.log(`- ${c.id}`);
    const file = caseFile(`u-${c.id}`, c.module);
    const result = await check(file, { main: `u_${c.id.replaceAll("-", "_")}`, invariants: ["inv"] });
    const ok = result.status === "unsupported" && result.where === "translation";
    if (!ok) fail(`unsupported ${c.id}: quint-check ${result.status}${"reason" in result ? ` (${result.reason})` : ""}${"output" in result ? ` (${result.output.slice(0, 200)})` : ""}`);
    return { id: c.id, status: result.status, reason: "reason" in result ? result.reason : "output" in result ? result.output.slice(0, 300) : "" };
  });

  console.log("public models without a complete verdict");
  const publicRows = [
    ...await mapInOrder(PUBLIC_PARTIAL, async (c) => {
      console.log(`- ${c.id}`);
      const result = await check(c.file, { main: c.main, invariants: ["inv"], timeoutMs: c.timeoutMs });
      if (result.status !== "inconclusive") fail(`public ${c.id}: quint-check ${result.status}, expected inconclusive (${c.why})`);
      return { id: c.id, group: "partially supported", expected: "inconclusive", status: result.status, reason: "reason" in result ? result.reason : c.why };
    }),
    ...PUBLIC_REFUSED.map((c) => {
      console.log(`- ${c.id}`);
      // The translation alone, which check runs first: these refusals happen before any invariant matters.
      const t = translateFile(c.file, { main: c.main, invariants: [] });
      const status = t.kind;
      const reason = t.kind === "unsupported" ? t.reason : t.kind === "frontend-error" ? t.output.slice(0, 200) : "";
      if (t.kind !== "unsupported" || reason !== c.reason) fail(`public ${c.id}: quint-check ${status} (${reason}), expected unsupported at translation (${c.reason})`);
      return { id: c.id, group: "refused", expected: `unsupported: ${c.reason}`, status, reason };
    }),
  ];

  console.log("models");
  const modelRows = await mapInOrder(MODEL_CASES, async (m) => {
    console.log(`- ${m.id}`);
    const invariants: readonly [string, ...string[]] = m.invariants ?? [m.invariant ?? "inv"];
    const invariant = invariants.join(",");
    const used = irOpcodes(m.file, m.main, invariant);
    for (const op of m.ops) if (!used.has(op)) fail(`${m.id}: declares ${op}, which its IR doesn't use`);
    const target = { file: m.file, main: m.main, invariant, ...m.invariants === undefined ? {} : { invariants: m.invariants } };
    const result = await check(m.file, { main: m.main, invariants });
    if (result.status !== m.expect) fail(`${m.id}: quint-check ${result.status}, expected ${m.expect}`);
    if (result.status === "violated" && result.invariant !== (m.names ?? (m.invariants === undefined ? invariant : undefined))) {
      fail(`${m.id}: quint-check names ${result.invariant}, expected ${m.names ?? invariant}`);
    }
    const sampled = evaluator(target, "typescript", 6, 300);
    // Quint lists every invariant the violating state breaks, in the order given; the one quint-check names is the first of them.
    if (m.names !== undefined && sampled.broken?.[0] !== m.names) fail(`${m.id}: the simulator reports ${JSON.stringify(sampled.broken)} broken, expected ${m.names} first`);
    // The simulator samples, so its pass proves nothing; its violation contradicts a quint-check pass.
    if (sampled.outcome === "violated" && result.status === "passed") fail(`${m.id}: the simulator finds a violation quint-check doesn't`);
    // A model quint-check gives a verdict on must be one Quint's evaluator runs: one it rejects, such as an init that reads a variable (QNT502), has no verdict to agree with.
    if (m.expect !== "unsupported" && sampled.outcome === "error") fail(`${m.id}: the simulator rejects the model: ${sampled.detail}`);
    const off = withOfficial ? official(target) : undefined;
    const g = graphs(target);
    const comparisons: Record<string, unknown> = {};
    const summary: Record<string, unknown> = {};
    let trace: Record<string, string> | undefined;
    if ("error" in g) {
      if (m.expect !== "unsupported") fail(`${m.id}: no graphs: ${g.error}`);
    } else {
      for (const [route, graph] of Object.entries(g.routes)) {
        summary[route] = { complete: graph.complete, why: graph.why, init: graph.init.size, states: graph.states.size, edges: graph.edges.size, violating: graph.violating.size };
      }
      const pairs: [string, string][] = [["qc/tla-ts", "qc/tlc"], ["qc/tlc", "official/tlc"]];
      for (const [a, b] of pairs) {
        const ga = g.routes[a];
        const gb = g.routes[b];
        if (ga === undefined || gb === undefined) continue;
        const cmp = compare(ga, gb);
        comparisons[`${a} vs ${b}`] = cmp;
        if (m.expect !== "unsupported" && !cmp.equal) fail(`${m.id}: ${a} vs ${b} differ: ${cmp.why || JSON.stringify(cmp.differences)}`);
      }
      if (result.status === "violated") {
        const states = tlaStates.get(result) ?? [];
        trace = Object.fromEntries(Object.entries(g.routes).map(([route, graph]) => [route, traceInGraph(states, graph)]));
        for (const [route, verdict] of Object.entries(trace)) if (verdict !== "valid") fail(`${m.id}: quint-check's counterexample against ${route}: ${verdict}`);
      }
    }
    let itf: Record<string, unknown> | undefined;
    if (result.status === "violated") {
      const checks = itfChecks(target, result.trace, withOfficial);
      for (const [check, verdict] of Object.entries(checks)) {
        if (check === "apalache" && (verdict === "not run" || m.apalacheItf !== undefined)) continue;
        if (verdict !== "ok") fail(`${m.id}: quint-check's ITF, ${check}: ${verdict}`);
      }
      // A known reason that no longer holds is stale: the comparison it excused can be made again.
      if (m.apalacheItf !== undefined && checks.apalache === "ok") fail(`${m.id}: quint verify now gives a counterexample; drop apalacheItf`);
      const controlled = m.itfControls === "values" ? controls(target, result.trace)
        : m.itfControls === "names" ? { "names by their last segment": shortNamesControl(target, result.trace) } : {};
      for (const [what, verdict] of Object.entries(controlled)) if (verdict.startsWith("NOT")) fail(`${m.id}: control ${what} ${verdict}`);
      itf = { ...checks, ...m.apalacheItf === undefined ? {} : { apalacheKnown: m.apalacheItf }, controls: controlled };
    }
    return { ...m, quintCheck: result.status, detail: "reason" in result ? result.reason : "search" in result ? `${result.search.distinctStates} states` : "",
      simulator: sampled, official: off, graphs: summary, comparisons, trace, itf };
  });

  mkdirSync("conformance/results", { recursive: true });
  const resultsFile = `${process.platform}-${process.arch}.json`;
  writeFileSync(`conformance/results/${resultsFile}`, `${JSON.stringify({ environment, failures, operatorRows, unsupportedRows, publicRows, modelRows }, null, 2)}\n`);
  writeMatrix(resultsFile, { environment, failures, operatorRows, unsupportedRows, publicRows, modelRows });
  console.log(failures.length === 0 ? "\nevery expectation held" : `\n${failures.length} failure(s)`);
} finally {
  stopApalache(server);
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(failures.length === 0 ? 0 : 1);
