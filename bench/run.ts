/**
 * bun run bench [--runs N] [--routes id,id] [--models id,id] [--out-dir results/ci] [--report-only]
 *
 * Times quint-check against TLC and Quint's own TLC route under the same
 * guarantee: explicit-state search of every reachable state, safety
 * invariants only, deadlock not checked, one worker. Before any time is
 * kept, every route must reach the same verdict and, for a pass, the same
 * number of distinct states; a model where they don't is reported as not
 * comparable, with no timings.
 *
 * Each repetition runs the routes in a rotated order, after one warm-up
 * run each. Writes bench/results/<platform>-<arch>-<machine>.json, where the
 * machine is QUINT_CHECK_MACHINE or the CPU model, and regenerates
 * bench/BASELINE.md from every results file. --report-only skips the
 * measurements and only regenerates BASELINE.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, totalmem, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceChanged } from "../conformance/source-changed.ts";
import { distinctStates, runQuint, tools, translateFile } from "../src/check.ts";
import { APALACHE_VERSION, apalacheJar, javaAvailable } from "../conformance/routes.ts";

const reportOnly = process.argv.includes("--report-only");
const runsFlag = process.argv.indexOf("--runs");
const RUNS = runsFlag === -1 ? 5 : Number(process.argv[runsFlag + 1]);
const listFlag = (name: string): string[] | undefined => {
  const k = process.argv.indexOf(`--${name}`);
  return k === -1 ? undefined : (process.argv[k + 1] ?? "").split(",").filter((x) => x !== "");
};
const onlyRoutes = listFlag("routes");
const onlyModels = listFlag("models");
// A results folder other than the default keeps a different kind of machine, such as a hosted runner, apart from the baseline.
const outDirFlag = process.argv.indexOf("--out-dir");
const outDir = outDirFlag === -1 ? "results" : (process.argv[outDirFlag + 1] ?? "results");
const root = resolve(import.meta.dir, "..");

interface BenchModel { readonly id: string; readonly file: string; readonly main: string; readonly expect: "passed" | "violated" }
const MODELS: readonly BenchModel[] = [
  { id: "stock-small", file: "bench/models/stock.qnt", main: "stock_small", expect: "passed" },
  { id: "stock-large", file: "bench/models/stock.qnt", main: "stock_large", expect: "passed" },
  { id: "stock-deep-fault", file: "bench/models/stock.qnt", main: "stock_deep_fault", expect: "violated" },
  { id: "tokens", file: "conformance/models/tokens.qnt", main: "tokens", expect: "passed" },
];

interface Measured { readonly ms: number; readonly peakBytes: number | null; readonly exit: number; readonly output: string }

/** Wall time, exit code and peak memory of the whole process tree. */
function measure(command: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Measured {
  const dir = mkdtempSync(join(tmpdir(), "quint-check-bench-"));
  try {
    const out = join(dir, "out.txt");
    if (process.platform === "win32") {
      const spec = join(dir, "spec.json");
      writeFileSync(spec, JSON.stringify({ exe: command[0], args: command.slice(1), out }));
      const ran = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "bench", "measure.ps1"), spec],
        { cwd, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, ...env } });
      const result = JSON.parse(ran.stdout.trim().split(/\r?\n/).at(-1) ?? "{}") as { ms?: number; exit?: number; peakBytes?: number; error?: string };
      if (result.error !== undefined || result.ms === undefined) throw new Error(`measure.ps1: ${result.error ?? ran.stderr}`);
      return { ms: result.ms, peakBytes: result.peakBytes ?? null, exit: result.exit ?? -1, output: readFileSync(out, "utf8") };
    }
    // GNU time on Linux (-v, kilobytes) or BSD time on macOS (-l, bytes): the peak resident set of the
    // largest process waited for, not the sum over the tree.
    const flag = process.platform === "darwin" ? "-l" : "-v";
    const started = performance.now();
    const ran = spawnSync("/usr/bin/time", [flag, ...command], { cwd, encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, ...env } });
    const ms = performance.now() - started;
    const err = ran.stderr ?? "";
    const kb = /Maximum resident set size \(kbytes\): (\d+)/.exec(err)?.[1];
    const bytes = /(\d+)\s+maximum resident set size/.exec(err)?.[1];
    return { ms, peakBytes: kb !== undefined ? Number(kb) * 1024 : bytes !== undefined ? Number(bytes) : null, exit: ran.status ?? -1,
      output: `${ran.stdout ?? ""}${err}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Distinct states, from quint-check's JSON or TLC's text. */
function statesOf(output: string): number {
  const json = /"states": (\d+)/.exec(output)?.[1];
  return json !== undefined ? Number(json) : distinctStates(output);
}

/** The counterexample's length in states, from quint-check's JSON trace or TLC's "State n:" lines; 0 when none. */
function traceLength(output: string): number {
  const actions = output.match(/"action": /g)?.length ?? 0;
  if (actions > 0) return actions;
  return Math.max(0, ...[...output.matchAll(/^State (\d+):/gm)].map((x) => Number(x[1])));
}

type Verdict = "passed" | "violated" | "other";
function verdictOf(output: string): Verdict {
  if (/"status": "passed"|^\[ok\]|Model checking completed\. No error has been found/m.test(output)) return "passed";
  if (/"status": "violated"|^\[violation\]|Error: Invariant \S+ is violated/m.test(output)) return "violated";
  return "other";
}

interface Route {
  readonly id: string; readonly what: string; readonly command: readonly string[]; readonly cwd: string; readonly checkerOnly: boolean;
  readonly env?: Readonly<Record<string, string>>;
}

function routesFor(m: BenchModel, work: string, cacheDir: string): Route[] {
  const translated = translateFile(join(root, m.file), { main: m.main, invariants: ["inv"] });
  if (translated.kind !== "translated") throw new Error(`${m.id}: ${translated.kind}`);
  const qc = join(work, "qc");
  mkdirSync(qc, { recursive: true });
  writeFileSync(join(qc, "Q.tla"), translated.translation.tla);
  writeFileSync(join(qc, "Q.cfg"), translated.translation.cfg);
  const tlcArgs = (dir: string, module: string): string[] => ["tlc2.TLC", "-workers", "1", "-deadlock", "-metadir", join(dir, "states"),
    "-config", `${module}.cfg`, `${module}.tla`];
  const check = [process.execPath, join(root, "src", "cli.ts"), "check", join(root, m.file), "--main", m.main, "--invariant", "inv", "--timeout-ms", "1800000"];
  const routes: Route[] = [
    { id: "quint-check", what: "quint-check end to end, tla-ts's compile cache warm", checkerOnly: false, cwd: root, command: check,
      env: { QUINT_CHECK_CACHE_DIR: cacheDir } },
    { id: "quint-check-nocache", what: "quint-check end to end, cache off (QUINT_CHECK_CACHE=off): tla-ts compiles itself on every check", checkerOnly: false,
      cwd: root, command: check, env: { QUINT_CHECK_CACHE: "off" } },
    { id: "tla-ts", what: "tla-ts on quint-check's TLA+", checkerOnly: true, cwd: qc,
      command: [process.execPath, tools.tlaTsCli, `-Djava.io.tmpdir=${qc}`, ...tlcArgs(qc, "Q")] },
  ];
  if (!javaAvailable() || !existsSync(apalacheJar)) return routes;
  routes.push({ id: "tlc-qc", what: "TLC (Apalache's jar) on quint-check's TLA+", checkerOnly: true, cwd: qc,
    command: ["java", "-cp", apalacheJar, ...tlcArgs(qc, "Q")] });
  const official = join(work, "official");
  mkdirSync(official, { recursive: true });
  const compiled = runQuint(["compile", "--target", "tlaplus", `--main=${m.main}`, "--invariant=inv", join(root, m.file)], { cwd: official });
  const module = /^-+ MODULE (\S+) -+/m.exec(compiled.stdout)?.[1];
  if (compiled.status === 0 && module !== undefined) {
    writeFileSync(join(official, `${module}.tla`), compiled.stdout);
    writeFileSync(join(official, `${module}.cfg`), "INIT q_init\nNEXT q_step\nINVARIANT q_inv\n");
    routes.push({ id: "tlc-apalache", what: "TLC on Apalache's TLA+ (the TLA+ quint verify --backend=tlc checks)", checkerOnly: true, cwd: official,
      command: ["java", "-cp", apalacheJar, ...tlcArgs(official, module)] });
  }
  const tlcConfig = join(work, "tlc.json");
  writeFileSync(tlcConfig, JSON.stringify({ workers: 1 }));
  routes.push({ id: "quint-verify-tlc", what: "quint verify --backend=tlc end to end: Apalache's translation (starting its server), then TLC", checkerOnly: false, cwd: official,
    command: ["node", tools.quintCli, "verify", "--backend=tlc", `--main=${m.main}`, "--invariant=inv", `--tlc-config=${tlcConfig}`, join(root, m.file)] });
  return routes;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/** Results are kept per operating system and hardware: timings from one machine say nothing about another. */
const machine = (process.env["QUINT_CHECK_MACHINE"] ?? cpus()[0]?.model ?? "unknown").toLowerCase().replace(/\(r\)|\(tm\)/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const environment = {
  date: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  machine,
  cpu: `${(cpus()[0]?.model ?? "unknown").replace(/\s+/g, " ").trim()} (${cpus().length} logical)`,
  memoryGiB: Math.round(totalmem() / 2 ** 30),
  bun: process.versions["bun"] ?? "",
  node: spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim(),
  java: javaAvailable() ? (spawnSync("java", ["-version"], { encoding: "utf8" }).stderr.split(/\r?\n/)[0] ?? "") : "none",
  quint: tools.quintVersion,
  tlaTs: tools.tlaTsVersion,
  apalache: APALACHE_VERSION,
  commit: spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: root }).stdout.trim(),
  dirty: sourceChanged(root),
  runs: RUNS,
  memoryMeasure: process.platform === "win32" ? "peak committed memory of the process tree (Job Object PeakJobMemoryUsed)"
    : "peak resident set of the largest process (time -v / -l)",
};

function measureAll() {
  return MODELS.filter((m) => onlyModels === undefined || onlyModels.includes(m.id)).map((m) => {
  console.log(`- ${m.id}`);
  const work = mkdtempSync(join(tmpdir(), `quint-check-bench-${m.id}-`));
  try {
    const routes = routesFor(m, work, join(work, "cache")).filter((r) => onlyRoutes === undefined || onlyRoutes.includes(r.id));
    const samples = new Map<string, Measured[]>(routes.map((r) => [r.id, []]));
    // The warm-up runs also fill quint-check's cache, so the timed runs of "quint-check" find it warm.
    for (const r of routes) measure(r.command, r.cwd, r.env);
    for (let k = 0; k < RUNS; k += 1) {
      for (let j = 0; j < routes.length; j += 1) {
        const r = routes[(j + k) % routes.length];
        if (r !== undefined) samples.get(r.id)?.push(measure(r.command, r.cwd, r.env));
      }
    }
    const rows = routes.map((r) => {
      const runs = samples.get(r.id) ?? [];
      const verdicts = [...new Set(runs.map((x) => verdictOf(x.output)))];
      const states = [...new Set(runs.map((x) => statesOf(x.output)))];
      const traces = [...new Set(runs.map((x) => traceLength(x.output)))];
      const ms = runs.map((x) => x.ms);
      const peaks = runs.map((x) => x.peakBytes).filter((x): x is number => x !== null);
      return { id: r.id, what: r.what, checkerOnly: r.checkerOnly, verdicts, states, traces,
        msMedian: median(ms), msMin: Math.min(...ms), msMax: Math.max(...ms),
        // Coefficient of variation: the standard deviation over the mean, a noise measure for the route.
        msCv: Math.sqrt(ms.reduce((a, x) => a + (x - ms.reduce((b, y) => b + y, 0) / ms.length) ** 2, 0) / ms.length) / (ms.reduce((b, y) => b + y, 0) / ms.length),
        peakMiBMedian: peaks.length === 0 ? null : median(peaks) / 2 ** 20 };
    });
    // Comparable only when every route reached the expected verdict in every run and,
    // for a pass, every checker reported the same distinct states.
    const problems: string[] = [];
    for (const row of rows) {
      if (row.verdicts.length !== 1 || row.verdicts[0] !== m.expect) problems.push(`${row.id}: verdicts ${row.verdicts.join(", ")}`);
    }
    if (m.expect === "passed") {
      const counts = new Set(rows.filter((r) => !r.id.startsWith("quint-check")).flatMap((r) => r.states));
      const qc = rows.filter((r) => r.id.startsWith("quint-check")).flatMap((r) => r.states);
      if (counts.size !== 1 || qc.some((s) => !counts.has(s))) problems.push(`distinct states differ: ${rows.map((r) => `${r.id} ${r.states.join("/")}`).join("; ")}`);
    }
    if (m.expect === "violated") {
      // Breadth-first search with one worker finds a shortest counterexample, so every route's has the same length.
      const lengths = new Set(rows.flatMap((r) => r.traces));
      if (lengths.size !== 1) problems.push(`counterexample lengths differ: ${rows.map((r) => `${r.id} ${r.traces.join("/")}`).join("; ")}`);
    }
    return { ...m, comparable: problems.length === 0, problems, rows };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

}
const results = reportOnly ? undefined : measureAll();

mkdirSync(resolve(root, "bench", outDir), { recursive: true });
if (results !== undefined) {
  writeFileSync(resolve(root, "bench", outDir, `${environment.platform}-${machine}.json`), `${JSON.stringify({ environment, results }, null, 2)}\n`);
}
// Results kept apart (--out-dir) get a summary of their own and stay out of BASELINE.md, which is for one machine's baseline.
if (outDir !== "results" && results !== undefined) {
  const lines = [`# ${environment.platform}, ${machine}`, "",
    `${environment.date}: ${environment.cpu}; Bun ${environment.bun}, Node ${environment.node}; commit ${environment.commit}${environment.dirty ? " (uncommitted changes)" : ""}; ` +
      `${RUNS} runs per route in a rotated order after one warm-up. Compare routes within this file only.`, ""];
  for (const r of results) {
    lines.push(`## \`${r.id}\` (${r.expect})`, "");
    if (!r.comparable) { lines.push(`Not comparable: ${r.problems.join("; ")}.`, ""); continue; }
    lines.push("| Route | Median ms | Min–max ms | CV | Peak MiB |", "| --- | --- | --- | --- | --- |",
      ...r.rows.map((x) => `| ${x.id} | ${x.msMedian.toFixed(0)} | ${x.msMin.toFixed(0)}–${x.msMax.toFixed(0)} | ${(x.msCv * 100).toFixed(1)} % | ` +
        `${x.peakMiBMedian === null ? "not measured" : x.peakMiBMedian.toFixed(0)} |`), "");
    const warm = r.rows.find((x) => x.id === "quint-check");
    const off = r.rows.find((x) => x.id === "quint-check-nocache");
    if (warm !== undefined && off !== undefined) lines.push(`Cache warm against cache off: ${(off.msMedian - warm.msMedian).toFixed(0)} ms less at the median.`, "");
  }
  writeFileSync(resolve(root, "bench", outDir, `${environment.platform}-${machine}.md`), lines.join("\n"));
  console.log(lines.join("\n"));
  process.exit(0);
}

const files = readdirSync(join(root, "bench", "results")).filter((f) => f.endsWith(".json")).sort();
const sections = files.map((f) => {
  const data = JSON.parse(readFileSync(join(root, "bench", "results", f), "utf8")) as { environment: typeof environment; results: ReturnType<typeof measureAll> };
  const e = data.environment;
  const tables = data.results.map((r) => {
    if (!r.comparable) return `### \`${r.id}\` (${r.expect})\n\nNot comparable, so no timings: ${r.problems.join("; ")}.`;
    const states = r.rows.find((x) => x.checkerOnly)?.states[0] ?? 0;
    const length = r.rows[0]?.traces[0] ?? 0;
    return [`### \`${r.id}\` (${r.expect === "violated" ? `violated: a ${length}-state counterexample, after ${states} distinct states in tla-ts` : `passed: ${states} distinct states`})`, "",
      "| Route | Median ms | Min–max ms | States/s (median) | Peak MiB (median) |", "| --- | --- | --- | --- | --- |",
      ...r.rows.map((x) => `| ${x.id}: ${x.what} | ${x.msMedian.toFixed(0)} | ${x.msMin.toFixed(0)}–${x.msMax.toFixed(0)} | ` +
        `${x.checkerOnly && r.expect === "passed" ? Math.round((x.states[0] ?? 0) / (x.msMedian / 1000)).toLocaleString("en-US") : "—"} | ` +
        `${x.peakMiBMedian === null ? "not measured" : x.peakMiBMedian.toFixed(0)} |`)].join("\n");
  });
  return [`## ${e.platform}, ${e.machine ?? "unknown machine"}`, "",
    `${e.date}: ${e.cpu}, ${e.memoryGiB} GiB; Bun ${e.bun}, Node ${e.node}, ${e.java}; Quint ${e.quint}, tla-ts ${e.tlaTs}, Apalache ${e.apalache}; ` +
      `commit ${e.commit}${e.dirty ? " (uncommitted changes)" : ""}; ${e.runs} runs per route after one warm-up. Memory: ${e.memoryMeasure}.`, "",
    ...tables.flatMap((t) => [t, ""])].join("\n");
});
writeFileSync(join(root, "bench", "BASELINE.md"), [
  "# Performance baseline",
  "",
  "Generated by `bun run bench`; don't edit by hand. Every route runs the same guarantee: explicit-state search of every reachable",
  "state, safety invariants only, deadlock not checked, one worker. Times are wall clock and include each tool's startup.",
  "States per second is distinct states over the median wall time, for the checker-only routes of a passing model.",
  "A violated model's time is the time to its counterexample. Numbers describe one machine and aren't a claim about others.",
  "",
  ...sections,
].join("\n"));
console.log("bench/BASELINE.md written");
