import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkerCache } from "./cache.js";
import { JOB_FILE, RESULT_FILE, parseCheckerResult, type CheckerJob, type CheckerResult } from "./checker-result.js";
import { MAX_TIMEOUT_MS, runProcess } from "./process.js";
import { MARKER, translate, type Translation, Unsupported } from "./translate.js";
import { makeRunDir, removeRunDir, sweepStaleRunDirs } from "./workdir.js";

const require = createRequire(import.meta.url);
const quintPackage = require.resolve("@informalsystems/quint/package.json");
const tlaTsPackage = require.resolve("tla-ts/package.json");

/** Quint's CLI, which the frontend runs, and tla-ts's, which the harness and benchmarks run, at the versions the lockfile pins. */
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

/** What the frontend and the translation take; a translation may have no invariant. */
export interface TranslateOptions {
  readonly main?: string;
  /** The invariant expressions, as `quint compile --invariant` takes them; combined with `and`. */
  readonly invariants: readonly string[];
  readonly init?: string;
  readonly step?: string;
}

export interface CheckOptions extends TranslateOptions {
  /** At least one, none blank or `true`: a check with nothing to check would pass vacuously. */
  readonly invariants: readonly [string, ...string[]];
  /** The time limit for the whole check, frontend included: whole milliseconds from 1 to 2147483647 (60 000 by default). */
  readonly timeoutMs?: number;
  /** Aborting it stops the check: the promise rejects with the signal's reason once every process the check started is gone. */
  readonly signal?: AbortSignal;
}

/**
 * Why `invariants` can't be checked, or undefined when it can. An empty list, a blank entry
 * and `true` (which Quint drops) each check nothing, so a complete search would `pass` without
 * having checked a property. Quint reads an entry's commas as arguments of `and`, so an entry
 * whose comma-separated pieces are all blank or `true` checks nothing either; one with a real
 * piece, such as `inRange(x, 3)`, is kept. A tautology written some other way isn't detected.
 */
export function invariantProblem(invariants: readonly string[]): string | undefined {
  if (invariants.length === 0) return "a check needs at least one invariant";
  const empty = invariants.find((i) => i.split(",").every((piece) => piece.trim() === "" || piece.trim() === "true"));
  if (empty !== undefined) return `invariant ${JSON.stringify(empty)} checks nothing; give an invariant of the model`;
  return undefined;
}

/** Node, which runs Quint's CLI: this process when it is Node, else `node` from PATH (under Bun, in development). */
const nodeExecutable: string = process.versions["bun"] === undefined ? process.execPath : "node";

/** Quint's CLI and its arguments for the frontend: the IR of `file`, flattened, with q::init, q::step and q::inv added. */
function frontendArgs(file: string, options: TranslateOptions): string[] {
  return [tools.quintCli, "compile", "--target", "json",
    ...options.main === undefined ? [] : ["--main", options.main],
    ...options.init === undefined ? [] : ["--init", options.init],
    ...options.step === undefined ? [] : ["--step", options.step],
    ...options.invariants.length === 0 ? [] : [`--invariant=${options.invariants.join(",")}`], file];
}

type FrontendOutput = { ok: true; ir: unknown } | { ok: false; output: string };

/** What Quint's frontend produced, from its exit code and outputs. */
function readFrontend(status: number | null, stdout: string, stderr: string): FrontendOutput {
  if (status !== 0) return { ok: false, output: `${stderr}${stdout}`.trim() };
  try {
    return { ok: true, ir: JSON.parse(stdout) };
  } catch {
    return { ok: false, output: `Quint's frontend exited 0 but its output isn't JSON: ${stdout.slice(0, 200)}` };
  }
}

type Translated =
  | { kind: "translated"; translation: Translation }
  | { kind: "unsupported"; reason: string }
  | { kind: "frontend-error"; output: string };

function translated(front: FrontendOutput, options: TranslateOptions): Translated {
  if (!front.ok) return { kind: "frontend-error", output: front.output };
  try {
    return { kind: "translated", translation: translate(front.ir, options.invariants.length > 0) };
  } catch (err) {
    if (err instanceof Unsupported) return { kind: "unsupported", reason: err.message };
    throw err;
  }
}

/**
 * Run Quint's CLI with `args`, synchronously, for the conformance harness and the benchmarks. Its
 * standard output goes to a file, not a pipe: Quint calls `process.exit` after writing, and on Linux a
 * pipe then keeps only the first 64 KiB of a larger output.
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

/** The IR the official Quint frontend produces for `file`, synchronously, for the harness and the translate command. */
export function frontend(file: string, options: TranslateOptions): FrontendOutput {
  const ran = runQuint(frontendArgs(file, options).slice(1));
  return readFrontend(ran.status, ran.stdout, ran.stderr);
}

/** The TLA+ translation of `file`, or why there is none, synchronously, for the harness and the translate command. */
export function translateFile(file: string, options: TranslateOptions): Translated {
  return translated(frontend(file, options), options);
}

/** The distinct states TLC's output reports last, or 0, for the benchmarks, which time TLC's own routes. */
export function distinctStates(output: string): number {
  const found = [...output.matchAll(/([\d,]+) distinct states? found/g)].at(-1)?.[1];
  return found === undefined ? 0 : Number(found.replaceAll(",", ""));
}

/** A TLC state, `/\ var = value` lines, by Quint variable name, for the harness, which reads TLC's state graphs. */
export function parseState(text: string, translation: Translation): Record<string, string> {
  const state: Record<string, string> = {};
  for (const part of text.split(/^\/\\ /m).map((p) => p.trim()).filter((p) => p !== "")) {
    const eq = part.indexOf(" = ");
    const variable = part.slice(0, eq);
    state[translation.variables.get(variable) ?? variable] = part.slice(eq + 3).replace(/\s+/g, " ");
  }
  return state;
}

/** The checker child, next to this file: checker.ts in development, checker.js once built. */
const here = fileURLToPath(import.meta.url);
const checkerScript = join(dirname(here), `checker${extname(here)}`);
/** The largest result file read; a check's result is far smaller. */
const MAX_RESULT_BYTES = 64 * 1024 * 1024;

/** What a result covers, with `scope` saying how much of the state space. */
function guarantee(scope: Guarantee["scope"]): Guarantee {
  return { method: "explicit-state", property: "safety-invariant", scope, deadlock: "not-checked",
    backend: `tla-ts ${tools.tlaTsVersion}`, frontend: `quint ${tools.quintVersion}` };
}

/** Throw a TypeError or a RangeError when `options` can't be checked. */
function validate(options: CheckOptions): void {
  const problem = invariantProblem(options.invariants);
  if (problem !== undefined) throw new TypeError(problem);
  const t = options.timeoutMs;
  if (t !== undefined && !(Number.isSafeInteger(t) && t >= 1 && t <= MAX_TIMEOUT_MS)) {
    throw new RangeError(`timeoutMs must be a whole number of milliseconds from 1 to ${MAX_TIMEOUT_MS}, not ${String(t)}`);
  }
}

/** Run Quint's frontend for `file`, writing in `dir`, by `deadline`. */
async function runFrontend(file: string, options: CheckOptions, dir: string, deadline: number): Promise<FrontendOutput | "time-limit"> {
  const path = join(dir, "frontend.json");
  const out = await open(path, "w");
  let outcome;
  try {
    outcome = await runProcess(nodeExecutable, frontendArgs(file, options), { stdout: out.fd, deadline, signal: options.signal });
  } finally {
    await out.close();
  }
  switch (outcome.kind) {
    case "time-limit": return "time-limit";
    case "spawn-failed": return { ok: false, output: `Quint's frontend couldn't start: ${outcome.message}` };
    case "signaled": return { ok: false, output: `Quint's frontend was ended by ${outcome.signal}. ${outcome.stderr}`.trim() };
    case "exited": {
      // The folder can be removed under a running check (see the README's sweep), and then there is no output to read.
      const stdout = await readFile(path, "utf8").catch((e: unknown) => e instanceof Error ? e : new Error(String(e)));
      return stdout instanceof Error ? { ok: false, output: `Quint's frontend output couldn't be read: ${stdout.message}` }
        : readFrontend(outcome.code, stdout, outcome.stderr);
    }
  }
}

/** The checker child's result in `dir`, or undefined when it's missing, too large or malformed. */
async function readResult(dir: string): Promise<CheckerResult | undefined> {
  const path = join(dir, RESULT_FILE);
  try {
    if ((await stat(path)).size > MAX_RESULT_BYTES) return undefined;
    return parseCheckerResult(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Check `file` with `options`: the official Quint frontend, the translation, then tla-ts, in a child
 * process quint-ts owns. `timeoutMs` bounds the whole check. Rejects with a TypeError or a RangeError
 * when the options can't be checked (see `invariantProblem`), and with `signal.reason` when
 * `options.signal` aborts. Every process the check started is gone by the time it settles.
 */
export async function check(file: string, options: CheckOptions): Promise<CheckResult> {
  validate(options);
  options.signal?.throwIfAborted();
  const deadline = performance.now() + (options.timeoutMs ?? 60_000);
  // Folders left by checks whose process died. It never rejects, and this check doesn't wait for it.
  void sweepStaleRunDirs();
  const dir = await makeRunDir();
  try {
    const front = await runFrontend(file, options, dir, deadline);
    if (front === "time-limit") {
      return { status: "inconclusive", reason: "the time limit was reached while Quint's frontend ran, before any state was explored",
        guarantee: guarantee("none") };
    }
    const t = translated(front, options);
    if (t.kind === "frontend-error") return { status: "error", stage: "frontend", output: t.output, guarantee: guarantee("none") };
    if (t.kind === "unsupported") return { status: "unsupported", reason: t.reason, where: "translation", guarantee: guarantee("none") };
    options.signal?.throwIfAborted();
    if (performance.now() >= deadline) {
      return { status: "inconclusive", reason: "the time limit was reached before the search began", guarantee: guarantee("none") };
    }
    const { translation } = t;
    const cacheDir = checkerCache(tools.tlaTsVersion);
    // quint verify --backend=tlc doesn't check deadlock, and neither does quint-ts.
    const job: CheckerJob = { source: translation.tla, config: `${translation.cfg}\nCHECK_DEADLOCK FALSE`, ...cacheDir === undefined ? {} : { cacheDir } };
    await writeFile(join(dir, JOB_FILE), JSON.stringify(job));
    return await runChecker(checkerScript, dir, translation, deadline, options.signal);
  } finally {
    await removeRunDir(dir);
  }
}

/**
 * Run the checker child `script` on the job in `dir` by `deadline`, and read what it established. Its
 * result counts only when it exits 0 and leaves a complete, well-formed result. Internal: `check` runs
 * the real checker, and the tests run stand-ins for the paths where a result mustn't count.
 */
export async function runChecker(script: string, dir: string, translation: Translation, deadline: number, signal?: AbortSignal):
  Promise<CheckResult> {
  const outcome = await runProcess(process.execPath, [script, dir], { stdout: "ignore", deadline, signal });
  if (outcome.kind === "time-limit") {
    return { status: "inconclusive", reason: "the checker stopped at the time limit before exploring every state", guarantee: guarantee("partial") };
  }
  if (outcome.kind === "spawn-failed") {
    return { status: "error", stage: "checker", output: `the checker couldn't start: ${outcome.message}`, guarantee: guarantee("none") };
  }
  const result = outcome.kind === "exited" && outcome.code === 0 ? await readResult(dir) : undefined;
  if (result === undefined) {
    const how = outcome.kind === "signaled" ? `was ended by ${outcome.signal}`
      : outcome.code === 0 ? "wrote no complete result" : `exited with code ${outcome.code}`;
    return { status: "error", stage: "checker", output: `the checker ${how}. ${outcome.stderr.split(/\r?\n/).slice(-20).join("\n")}`.trim(),
      guarantee: guarantee("partial") };
  }
  return verdict(result, translation);
}

/** Why a failure the checker reported is quint-ts's `unsupported`, not an error: a marker the translation planted, or 32-bit integers. */
function unsupportedFailure(message: string): string | undefined {
  const marker = new RegExp(`"${MARKER} ([^"]*)"`).exec(message);
  if (marker !== null) return marker[1] ?? "";
  // Quint's integers are unbounded; TLC's, and tla-ts's, are 32-bit, and both stop rather than wrap.
  const range = /Overflow when computing [^\r\n]*|TLC can't handle a number this big[^\r\n]*/.exec(message);
  if (range !== null) return `an integer outside the checker's 32-bit range (${range[0].trim()}); Quint's integers are unbounded`;
  return undefined;
}

/**
 * What a complete checker run establishes. A `passed` needs a finished search from at least one initial
 * state: tla-ts's success, at least one initial and one distinct state, and no state left queued.
 */
export function verdict(r: CheckerResult, translation: Translation): CheckResult {
  // tla-ts reports some failures by throwing (a literal past 32 bits) and others in its result (a computation past them).
  const failure = r.kind === "threw" ? (r.error === "other" ? r.message : undefined) : r.status === "error" ? r.failure ?? "" : undefined;
  const unsupported = failure === undefined ? undefined : unsupportedFailure(failure);
  if (unsupported !== undefined) return { status: "unsupported", reason: unsupported, where: "reached-state", guarantee: guarantee("partial") };
  if (r.kind === "threw") {
    // A translation tla-ts can't parse is quint-ts's defect, not the model's.
    return { status: "error", stage: r.error === "other" ? "checker" : "translation", output: r.message, guarantee: guarantee("partial") };
  }
  if (r.status === "error") {
    return { status: "error", stage: "checker", output: failure === "" ? "the checker failed without a message" : failure ?? "", guarantee: guarantee("partial") };
  }
  if (r.status === "success") {
    if (r.initialStates === 0 || r.distinctStates === 0) {
      return { status: "inconclusive", reason: "no initial state, so nothing was checked", guarantee: guarantee("none") };
    }
    if (r.queuedStates !== 0) {
      return { status: "error", stage: "checker", output: `the checker reported success with ${r.queuedStates} states still queued`,
        guarantee: guarantee("partial") };
    }
    return { status: "passed", states: r.distinctStates, guarantee: guarantee("complete") };
  }
  if (r.status === "invariant-violation" && r.violation?.name === "q_inv" && r.violation.trace.length > 0) {
    const trace = r.violation.trace.map((step, k): TraceStep => {
      // The action TLC names first in its label, as `step line 65, ...` or `request("p1") line 38, ...`.
      const name = step.label === null || k === 0 ? undefined : /^([^ >(]+)/.exec(step.label)?.[1];
      return {
        action: name === undefined ? "init" : translation.names.get(name) ?? name,
        state: Object.fromEntries(Object.entries(step.state).map(([v, x]) => [translation.variables.get(v) ?? v, x.replace(/\s+/g, " ")])),
      };
    });
    return { status: "violated", states: r.distinctStates, trace, guarantee: guarantee("partial") };
  }
  return { status: "error", stage: "checker", output: `the checker returned ${r.status} without a result quint-ts can read`, guarantee: guarantee("partial") };
}
