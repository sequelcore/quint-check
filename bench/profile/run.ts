/**
 * bun bench/profile/run.ts [--runs N]
 *
 * Splits quint-ts's latency into stages, each timed in fresh processes and
 * repeated, so a stage's cost doesn't hide inside another's:
 *
 * - process startup: an empty Node and an empty Bun;
 * - loading Quint: its CLI to `--version`, its whole CLI module, and only
 *   the modules the frontend needs (parser, analyzer, flattener);
 * - Quint's work: read, parse, typecheck, flatten and serialize, in one
 *   process (quint-stages.cjs), first run;
 * - the translation: JSON.parse of the IR and translate(), in this process;
 * - tla-ts: an empty spec (startup), then the model's translation;
 * - quint-ts end to end, for the total.
 *
 * Measures only; nothing in src/ depends on Quint's internal modules this
 * uses. Writes bench/profile/results/<platform>-<arch>-<machine>.json.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { frontend, runQuint, tools } from "../../src/check.ts";
import { translate } from "../../src/translate.ts";

const runsFlag = process.argv.indexOf("--runs");
const RUNS = runsFlag === -1 ? 5 : Number(process.argv[runsFlag + 1]);
const root = resolve(import.meta.dir, "..", "..");
const quintDir = resolve(tools.quintCli, "..", "..", "..");
const models = [
  { id: "tokens", file: join(root, "conformance/models/tokens.qnt"), main: "tokens" },
  { id: "stock-large", file: join(root, "bench/models/stock.qnt"), main: "stock_large" },
];

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Median wall time of a command over fresh processes, after one warm-up. */
function wall(command: readonly string[], cwd = root): number {
  const run = (): number => {
    const t = performance.now();
    const ran = spawnSync(command[0] ?? "", command.slice(1), { cwd, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    if (ran.status !== 0) throw new Error(`${command.join(" ")}: exit ${ran.status}: ${ran.stderr.slice(0, 300)}`);
    return performance.now() - t;
  };
  run();
  return median(Array.from({ length: RUNS }, run));
}

const requireTime = (runtime: string, modules: readonly string[]): number => {
  const code = `const {performance}=require("node:perf_hooks");const t=performance.now();` +
    `${modules.map((m) => `require(${JSON.stringify(join(quintDir, "dist", "src", m))});`).join("")}` +
    `process.stderr.write(String(performance.now()-t));`;
  const one = (): number => Number(spawnSync(runtime, ["-e", code], { encoding: "utf8" }).stderr);
  one();
  return median(Array.from({ length: RUNS }, one));
};

const frontendModules = ["parsing/quintParserFrontend.js", "quintAnalyzer.js", "flattening/fullFlattener.js"];

const results = models.map((m) => {
  console.log(`- ${m.id}`);
  const work = mkdtempSync(join(tmpdir(), "quint-ts-profile-"));
  try {
    const stages = (runtime: string) => {
      const one = () => JSON.parse(spawnSync(runtime, [join(root, "bench", "profile", "quint-stages.cjs"), quintDir, m.file, m.main, "inv", "1"],
        { encoding: "utf8" }).stdout) as { loadModulesMs: number; firstRun: Record<string, number> };
      one();
      const all = Array.from({ length: RUNS }, one);
      return Object.fromEntries(["read", "parse", "typecheck", "flatten", "serialize"].map((k) => [k, median(all.map((x) => x.firstRun[k] ?? 0))]));
    };
    // The translation, in this process: parse the IR's JSON, then translate.
    const ir = runQuint(["compile", "--target", "json", `--main=${m.main}`, "--invariant=inv", m.file]).stdout;
    const translateOnce = () => {
      const t = performance.now();
      const parsed: unknown = JSON.parse(ir);
      const t1 = performance.now();
      translate(parsed, true);
      return { parseJson: t1 - t, translate: performance.now() - t1 };
    };
    translateOnce();
    const tr = Array.from({ length: RUNS }, translateOnce);
    const front = frontend(m.file, { main: m.main, invariants: ["inv"] });
    if (!front.ok) throw new Error(front.output);
    const translation = translate(front.ir, true);
    writeFileSync(join(work, "Q.tla"), translation.tla);
    writeFileSync(join(work, "Q.cfg"), translation.cfg);
    writeFileSync(join(work, "E.tla"), "---- MODULE E ----\nVARIABLE x\nInit == x = 0\nNext == x' = x\n====\n");
    writeFileSync(join(work, "E.cfg"), "INIT Init\nNEXT Next\n");
    const tlaTs = (module: string) => wall([process.execPath, tools.tlaTsCli, `-Djava.io.tmpdir=${work}`, "tlc2.TLC", "-workers", "1", "-deadlock",
      "-metadir", join(work, `states-${module}`), "-config", `${module}.cfg`, `${module}.tla`], work);
    return {
      id: m.id,
      irBytes: ir.length,
      quintCliCompile: wall(["node", tools.quintCli, "compile", "--target", "json", `--main=${m.main}`, "--invariant=inv", m.file]),
      quintStagesNode: stages("node"),
      quintStagesBun: stages(process.execPath),
      parseIrJson: median(tr.map((x) => x.parseJson)),
      translate: median(tr.map((x) => x.translate)),
      tlaTsEmptySpec: tlaTs("E"),
      tlaTsModel: tlaTs("Q"),
      quintTsEndToEnd: wall([process.execPath, join(root, "src", "cli.ts"), "check", m.file, "--main", m.main, "--invariant", "inv"]),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

const common = {
  nodeEmpty: wall(["node", "-e", "0"]),
  bunEmpty: wall([process.execPath, "-e", "0"]),
  quintVersion: wall(["node", tools.quintCli, "--version"]),
  requireCliNode: requireTime("node", ["cliCommands.js"]),
  requireFrontendNode: requireTime("node", frontendModules),
  requireCliBun: requireTime(process.execPath, ["cliCommands.js"]),
  requireFrontendBun: requireTime(process.execPath, frontendModules),
};

const machine = (process.env["QUINT_TS_MACHINE"] ?? cpus()[0]?.model ?? "unknown").toLowerCase().replace(/\(r\)|\(tm\)/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const environment = { date: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, machine, runs: RUNS,
  bun: process.versions["bun"] ?? "", node: spawnSync("node", ["--version"], { encoding: "utf8" }).stdout.trim(),
  quint: tools.quintVersion, tlaTs: tools.tlaTsVersion,
  commit: spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: root }).stdout.trim() };
mkdirSync(join(root, "bench", "profile", "results"), { recursive: true });
const out = join(root, "bench", "profile", "results", `${environment.platform}-${machine}.json`);
writeFileSync(out, `${JSON.stringify({ environment, common, results }, null, 2)}\n`);
console.log(JSON.stringify({ common, results }, null, 2));
