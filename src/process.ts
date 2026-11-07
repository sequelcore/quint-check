/**
 * Runs one child process to completion under a deadline and an AbortSignal, and settles only once the
 * child is gone.
 *
 * - POSIX: the child leads its own process group, and every termination signals the whole group, so
 *   a descendant can't outlive it or hold its pipes open. After the child exits, the group gets
 *   SIGKILL too, for any descendant still running.
 * - Windows: the child is ended with TerminateProcess. A Node child's descendants share the job object
 *   libuv gives it, which ends them when the child ends; quint-ts's own children start no descendants.
 *
 * A stop sends SIGTERM, then SIGKILL after GRACE_MS. After the child exits, its pipes get DRAIN_MS to
 * close before they're destroyed, so a descendant holding them can't keep the run from settling.
 */
import { spawn, type ChildProcess } from "node:child_process";

/** The largest delay a Node timer holds: past it a timer fires after 1 ms. */
export const MAX_TIMEOUT_MS: number = 2 ** 31 - 1;
const GRACE_MS = 2_000;
const DRAIN_MS = 500;
/** The end of stderr kept for diagnostics. */
const STDERR_KEPT = 64 * 1024;

export type ProcessOutcome =
  /** The child exited on its own with this code. */
  | { readonly kind: "exited"; readonly code: number; readonly stderr: string }
  /** A signal quint-ts didn't send ended the child (POSIX only; Windows reports an exit code). */
  | { readonly kind: "signaled"; readonly signal: string; readonly stderr: string }
  /** The deadline passed; the child, if it had started, was stopped and is gone. */
  | { readonly kind: "time-limit" }
  /** The child couldn't start. */
  | { readonly kind: "spawn-failed"; readonly message: string };

export interface ProcessOptions {
  readonly cwd?: string;
  /** Where the child's stdout goes: a file descriptor, or nowhere. */
  readonly stdout: number | "ignore";
  /** The time, in `performance.now()` milliseconds, by which the child must be done. */
  readonly deadline: number;
  readonly signal?: AbortSignal | undefined;
}

const posix = process.platform !== "win32";

/**
 * Run `command` with `args`. Resolves with how the child ended; rejects with `signal.reason` when the
 * caller aborts before the child exits on its own. Settles only after the child has exited, or never
 * started. The child's stdin is a pipe quint-ts never writes to and keeps open while it runs.
 */
export function runProcess(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessOutcome> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  const remaining = options.deadline - performance.now();
  if (remaining <= 0) return Promise.resolve({ kind: "time-limit" });

  return new Promise<ProcessOutcome>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", options.stdout, "pipe"], detached: posix, windowsHide: true });
    } catch (err) {
      resolve({ kind: "spawn-failed", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    let stderr = "";
    let stop: "time-limit" | "abort" | undefined;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let settled = false;
    let grace: NodeJS.Timeout | undefined;
    let drain: NodeJS.Timeout | undefined;

    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEPT);
    });
    // A child that dies first can make writes and reads on its pipes fail; those failures change nothing.
    for (const stream of [child.stdin, child.stderr]) stream?.on("error", () => {});

    const signalChild = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        if (posix) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        // Already gone.
      }
    };
    const terminate = (why: "time-limit" | "abort"): void => {
      if (exit !== undefined) return;
      // The caller's abort wins over a time limit already being enforced.
      if (stop === undefined || why === "abort") stop = why;
      if (grace !== undefined) return;
      signalChild("SIGTERM");
      grace = setTimeout(() => signalChild("SIGKILL"), GRACE_MS);
    };
    const timer = setTimeout(() => terminate("time-limit"), Math.min(remaining, MAX_TIMEOUT_MS));
    const onAbort = (): void => terminate("abort");
    signal?.addEventListener("abort", onAbort, { once: true });

    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      clearTimeout(drain);
      signal?.removeEventListener("abort", onAbort);
      for (const stream of [child.stdin, child.stderr]) stream?.destroy();
      if (exit === undefined) return; // spawn failure, resolved already
      if (stop === "abort") reject(signal?.reason);
      else if (stop === "time-limit") resolve({ kind: "time-limit" });
      else if (exit.code !== null) resolve({ kind: "exited", code: exit.code, stderr });
      else resolve({ kind: "signaled", signal: exit.signal ?? "unknown", stderr });
    };

    child.once("error", (err) => {
      // A child that never started emits "error" and may emit nothing else.
      if (child.pid !== undefined || settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ kind: "spawn-failed", message: err.message });
    });
    child.once("exit", (code, sig) => {
      exit = { code, signal: sig };
      clearTimeout(grace);
      // Any descendant left in the group goes too, so it can't hold the pipes.
      if (posix) signalChild("SIGKILL");
      drain = setTimeout(settle, DRAIN_MS);
    });
    child.once("close", settle);
  });
}

/** Whether a process with this id exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, owned by someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
