import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkerCache } from "./cache.js";
import { MARKER, translate, type Translation, Unsupported } from "./translate.js";

const require = createRequire(import.meta.url);
const quintPackage = require.resolve("@informalsystems/quint/package.json");
const tlaTsPackage = require.resolve("tla-ts/package.json");

/** The Quint CLI and tla-ts CLI this package runs, at the versions its lockfile pins. */
export const tools: { quintCli: string; quintVersion: string; tlaTsCli: string; tlaTsVersion: string } = {
  quintCli: join(dirname(quintPackage), "dist", "src", "cli.js"),
  quintVersion: (require(quintPackage) as { version: string }).version,
  tlaTsCli: join(dirname(tlaTsPackage), "dist", "cli.js"),
  tlaTsVersion: (require(tlaTsPackage) as { version: string }).version,
};

/** What a check covered, stated with every result so a partial check is never read as a complete one. */
export interface Guarantee {
  readonly method: "explicit-state";
  readonly property: "safety-invariant";
  /** Complete only when every reachable state was explored. */
  readonly scope: "complete" | "partial" | "none";
  /** quint verify --backend=tlc doesn't check deadlock; neither does quint-ts. */
  readonly deadlock: "not-checked";
  readonly backend: string;
  readonly frontend: string;
}

export type CheckResult =
  | { readonly status: "passed"; readonly states: number; readonly guarantee: Guarantee }
  | { readonly status: "violated"; readonly states: number; readonly trace: readonly TraceStep[]; readonly guarantee: Guarantee }
  | { readonly status: "unsupported"; readonly reason: string; readonly where: "translation" | "reached-state"; readonly guarantee: Guarantee }
  | { readonly status: "inconclusive"; readonly reason: string; readonly guarantee: Guarantee }
  | { readonly status: "error"; readonly stage: "frontend" | "translation" | "checker"; readonly output: string; readonly guarantee: Guarantee };

/** One state of a counterexample: the action that reached it, and every variable, in Quint's names. */
export interface TraceStep {
  readonly action: string;
  readonly state: Readonly<Record<string, string>>;
}

export interface CheckOptions {
  readonly main?: string;
  /** The invariant expressions, as `quint verify --invariant` takes them; combined with `and`. */
  readonly invariants: readonly string[];
  readonly init?: string;
  readonly step?: string;
  readonly timeoutMs?: number;
}

/** Node, which runs Quint's CLI: this process when it is Node, else `node` from PATH (under Bun, in development). */
const nodeExecutable: string = process.versions["bun"] === undefined ? process.execPath : "node";

/**
 * Run Quint's CLI with `args`. Its standard output goes to a file, not a pipe:
 * Quint calls `process.exit` after writing, and on Linux a pipe then keeps
 * only the first 64 KiB of a larger output.
 */
export function runQuint(args: readonly string[], options: { cwd?: string; timeoutMs?: number } = {}):
  { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-out-"));
  const path = join(dir, "stdout");
  const fd = openSync(path, "w");
  try {
    const ran = spawnSync(nodeExecutable, [tools.quintCli, ...args], { cwd: options.cwd, timeout: options.timeoutMs, encoding: "utf8",
      stdio: ["ignore", fd, "pipe"], maxBuffer: 1 << 28 });
    closeSync(fd);
    return { status: ran.status, stdout: readFileSync(path, "utf8"), stderr: ran.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The IR the official Quint frontend produces for `file`, flattened, with q::init, q::step and q::inv added. */
export function frontend(file: string, options: CheckOptions): { ok: true; ir: unknown } | { ok: false; output: string } {
  const ran = runQuint(["compile", "--target", "json",
    ...options.main === undefined ? [] : ["--main", options.main],
    ...options.init === undefined ? [] : ["--init", options.init],
    ...options.step === undefined ? [] : ["--step", options.step],
    ...options.invariants.length === 0 ? [] : [`--invariant=${options.invariants.join(",")}`], file]);
  if (ran.status !== 0) return { ok: false, output: `${ran.stderr}${ran.stdout}`.trim() };
  return { ok: true, ir: JSON.parse(ran.stdout) };
}

/** The TLA+ translation of `file`, or why there is none. */
export function translateFile(file: string, options: CheckOptions):
  { kind: "translated"; translation: Translation } | { kind: "unsupported"; reason: string } | { kind: "frontend-error"; output: string } {
  const front = frontend(file, options);
  if (!front.ok) return { kind: "frontend-error", output: front.output };
  try {
    return { kind: "translated", translation: translate(front.ir, options.invariants.length > 0) };
  } catch (err) {
    if (err instanceof Unsupported) return { kind: "unsupported", reason: err.message };
    throw err;
  }
}

/** Run tla-ts on a translation in a fresh folder, with TLC's arguments; `extra` adds options such as `-dump`. */
export function runTlaTs(translation: Translation, timeoutMs: number, extra: readonly string[] = []):
  { dir: string; status: number | null; timedOut: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-"));
  writeFileSync(join(dir, "Q.tla"), translation.tla);
  writeFileSync(join(dir, "Q.cfg"), translation.cfg);
  // tla-ts keeps only its compile cache in -Djava.io.tmpdir; the check's own files stay in `dir`.
  const cache = checkerCache(tools.tlaTsVersion) ?? dir;
  const ran = spawnSync(process.execPath, [tools.tlaTsCli, `-Djava.io.tmpdir=${cache}`, "tlc2.TLC", "-workers", "1", "-deadlock",
    "-metadir", join(dir, "states"), ...extra, "-config", "Q.cfg", "Q.tla"], { cwd: dir, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1 << 28 });
  return { dir, status: ran.status, timedOut: ran.error !== undefined || ran.signal !== null, output: `${ran.stdout ?? ""}${ran.stderr ?? ""}` };
}

/** Whether the checkout at `root` has changes other than the results the harness and benchmarks generate. */
export function sourceChanged(root: string): boolean {
  const generated = [":!conformance/results", ":!conformance/MATRIX.md", ":!bench/results", ":!bench/BASELINE.md", ":!bench/COMPARISON.md",
    ":!bench/profile/results"];
  return spawnSync("git", ["status", "--porcelain", "--", ".", ...generated], { encoding: "utf8", cwd: root }).stdout.trim() !== "";
}

/** The distinct states TLC's output reports last, or 0. */
export function distinctStates(output: string): number {
  const found = [...output.matchAll(/([\d,]+) distinct states? found/g)].at(-1)?.[1];
  return found === undefined ? 0 : Number(found.replaceAll(",", ""));
}

/** The counterexample in TLC's output, in Quint's names. */
export function parseTrace(output: string, translation: Translation): TraceStep[] {
  const at = output.indexOf("Error: The behavior up to this point is:");
  if (at === -1) return [];
  return output.slice(at).split(/\r?\n(?=State \d+:)/).slice(1).map((block) => {
    const [header = "", ...lines] = block.split(/\r?\n\r?\n/)[0]?.split(/\r?\n/) ?? [];
    const label = /^State \d+: <([^ >(]+)/.exec(header)?.[1] ?? "";
    const action = header.includes("<Initial predicate>") ? "init" : translation.names.get(label) ?? label;
    return { action, state: parseState(lines.join("\n"), translation) };
  });
}

/** A TLC state, `/\ var = value` lines, by Quint variable name. */
export function parseState(text: string, translation: Translation): Record<string, string> {
  const state: Record<string, string> = {};
  for (const part of text.split(/^\/\\ /m).map((p) => p.trim()).filter((p) => p !== "")) {
    const eq = part.indexOf(" = ");
    const variable = part.slice(0, eq);
    state[translation.variables.get(variable) ?? variable] = part.slice(eq + 3).replace(/\s+/g, " ");
  }
  return state;
}

/** Check `file` with `options`: the official Quint frontend, the translation, then tla-ts. */
export function check(file: string, options: CheckOptions): CheckResult {
  const guarantee = (scope: Guarantee["scope"]): Guarantee => ({ method: "explicit-state", property: "safety-invariant", scope,
    deadlock: "not-checked", backend: `tla-ts ${tools.tlaTsVersion}`, frontend: `quint ${tools.quintVersion}` });
  const translated = translateFile(file, options);
  if (translated.kind === "frontend-error") return { status: "error", stage: "frontend", output: translated.output, guarantee: guarantee("none") };
  if (translated.kind === "unsupported") return { status: "unsupported", reason: translated.reason, where: "translation", guarantee: guarantee("none") };
  const { translation } = translated;
  const run = runTlaTs(translation, options.timeoutMs ?? 60_000);
  try {
    const states = distinctStates(run.output);
    if (run.timedOut) return { status: "inconclusive", reason: "the checker stopped at the time limit before exploring every state", guarantee: guarantee("partial") };
    const marker = new RegExp(`"${MARKER} ([^"]*)"`).exec(run.output);
    if (marker !== null) return { status: "unsupported", reason: marker[1] ?? "", where: "reached-state", guarantee: guarantee("partial") };
    // Quint's integers are unbounded; TLC's, and tla-ts's, are 32-bit, and both stop rather than wrap.
    const range = /Overflow when computing [^\r\n]*|TLC can't handle a number this big[^\r\n]*/.exec(run.output);
    if (range !== null) {
      return { status: "unsupported", reason: `an integer outside the checker's 32-bit range (${range[0].trim()}); Quint's integers are unbounded`,
        where: "reached-state", guarantee: guarantee("partial") };
    }
    if (run.status === 0) {
      return states > 0 ? { status: "passed", states, guarantee: guarantee("complete") }
        : { status: "inconclusive", reason: "no initial state, so nothing was checked", guarantee: guarantee("none") };
    }
    if (run.status === 12) return { status: "violated", states, trace: parseTrace(run.output, translation), guarantee: guarantee("partial") };
    // A translation tla-ts can't parse is quint-ts's defect, not the model's.
    const stage = run.status === 150 || run.status === 151 ? "translation" : "checker";
    return { status: "error", stage, output: run.output.split(/\r?\n/).filter((l) => !/^(Parsing|Semantic|Linting)/.test(l)).slice(-20).join("\n"),
      guarantee: guarantee("partial") };
  } finally {
    rmSync(run.dir, { recursive: true, force: true });
  }
}
