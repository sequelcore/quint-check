/**
 * The routes a conformance case runs through, each reduced to one outcome:
 *
 * - quint-ts: this package.
 * - evaluator-ts, evaluator-rust: Quint's own simulators (`quint run`). They
 *   execute Quint's semantics but sample behaviors, so on a case with one
 *   behavior they are exact and on a model they are not exhaustive.
 * - official: `quint verify --backend=tlc`, Apalache's translation run by the
 *   TLC in Apalache's jar. Exhaustive, but its translation is under test too.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { check, runQuint } from "../src/check.ts";

export type Outcome = "passed" | "violated" | "error" | "unsupported" | "inconclusive" | "not-run";

export interface RouteRun {
  readonly outcome: Outcome;
  /** The line that decided the outcome, kept so a disagreement can be read without rerunning. */
  readonly detail: string;
  /** For a violation the simulator reports: every invariant the violating state breaks, in the order given. */
  readonly broken?: readonly string[];
}

export interface Target {
  readonly file: string;
  readonly main: string;
  readonly invariant: string;
  /** The invariants as separate entries, when there are several; `invariant` is then their conjunction. */
  readonly invariants?: readonly [string, ...string[]];
}

export const APALACHE_VERSION = "0.62.4";
export const apalacheHome: string = join(homedir(), ".quint", `apalache-dist-${APALACHE_VERSION}`, "apalache");
export const apalacheJar: string = join(apalacheHome, "lib", "apalache.jar");

export function javaAvailable(): boolean {
  return spawnSync("java", ["-version"], { encoding: "utf8" }).status === 0;
}

const quint = (args: readonly string[], timeoutMs = 120_000) => runQuint(args, { timeoutMs });

const firstLine = (text: string, pattern: RegExp): string => text.split(/\r?\n/).find((l) => pattern.test(l))?.trim() ?? "";

export async function quintTs(t: Target, timeoutMs = 60_000): Promise<RouteRun> {
  const result = await check(t.file, { main: t.main, invariants: [t.invariant], timeoutMs });
  const detail = result.status === "unsupported" || result.status === "inconclusive" ? result.reason
    : result.status === "error" ? `${result.stage}: ${result.output.split("\n").find((l) => /Error|error/.test(l)) ?? ""}`
      : `${result.search.distinctStates} states`;
  return { outcome: result.status, detail };
}

/** `quint run` with one sample of `steps` steps: exact on a case with a single behavior. */
export function evaluator(t: Target, backend: "typescript" | "rust", steps = 1, samples = 1): RouteRun {
  const ran = quint(["run", `--backend=${backend}`, `--main=${t.main}`,
    ...t.invariants === undefined ? [`--invariant=${t.invariant}`] : ["--invariants", ...t.invariants],
    `--max-samples=${samples}`, `--max-steps=${steps}`, "--seed=0x1", t.file]);
  const out = `${ran.stdout}${ran.stderr}`;
  if (/^\[ok\]/m.test(out)) return { outcome: "passed", detail: firstLine(out, /^\[ok\]/) };
  if (/^\[violation\]/m.test(out)) {
    return { outcome: "violated", detail: firstLine(out, /^\[violation\]/), broken: [...out.matchAll(/^\s*❌ (.+?)\s*$/gmu)].map((m) => m[1] ?? "") };
  }
  return { outcome: "error", detail: firstLine(out, /Error \[QNT|^error|Error/) };
}

export function official(t: Target): RouteRun {
  if (!javaAvailable()) return { outcome: "not-run", detail: "java is not on PATH" };
  const ran = quint(["verify", "--backend=tlc", `--main=${t.main}`, `--invariant=${t.invariant}`, t.file], 300_000);
  const out = `${ran.stdout}${ran.stderr}`;
  if (/^\[ok\]/m.test(out)) return { outcome: "passed", detail: firstLine(out, /^\[ok\]/) };
  if (/^\[violation\]/m.test(out)) return { outcome: "violated", detail: firstLine(out, /^Error: Invariant|^\[violation\]/) };
  return { outcome: "error", detail: firstLine(out, /^Error|^error|Error \[QNT/) };
}

/**
 * One Apalache server for a whole harness run, so each official check
 * connects to it instead of starting its own. Undefined when it can't start;
 * then each check starts one, which is slower but the same.
 */
export async function startApalache(): Promise<ChildProcess | undefined> {
  if (!javaAvailable() || !existsSync(apalacheJar)) return undefined;
  const bin = join(apalacheHome, "bin", process.platform === "win32" ? "apalache-mc.bat" : "apalache-mc");
  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", `"${bin}" server --port=8822`], { stdio: "ignore", windowsVerbatimArguments: true })
    : spawn(bin, ["server", "--port=8822"], { stdio: "ignore" });
  for (let k = 0; k < 60; k += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const probe = spawnSync(process.platform === "win32" ? "powershell" : "sh",
      process.platform === "win32" ? ["-NoProfile", "-Command", "(Test-NetConnection -ComputerName localhost -Port 8822 -WarningAction SilentlyContinue).TcpTestSucceeded"]
        : ["-c", "nc -z localhost 8822 && echo True"], { encoding: "utf8" });
    if (probe.stdout.includes("True")) return child;
  }
  stopApalache(child);
  return undefined;
}

export function stopApalache(child: ChildProcess | undefined): void {
  if (child?.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
  else child.kill();
}
