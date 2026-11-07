// The runner's fault scenarios, each through a stand-in child (tests/fixtures/fake-child.mjs). Written
// with node:test so the same file runs under Bun (`bun test`) and under Node, which runs quint-ts once
// installed (`node --test tests/process.test.ts`).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isAlive, runProcess, type ProcessOutcome } from "../src/process.ts";

const fake = join(import.meta.dirname, "fixtures", "fake-child.mjs");
const posix = process.platform !== "win32";
// The runner's own bounds: SIGKILL 2 s after SIGTERM, and 0.5 s for the pipes after the child exits.
const GRACE_MS = 2_000;
const DRAIN_MS = 500;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Recorded { pid: number; grandchild?: number }
interface Run { outcome?: ProcessOutcome; rejected?: unknown; ms: number; recorded: Recorded | undefined }

const recorded = (file: string): Recorded | undefined => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Recorded : undefined);

/** Run the stand-in in `mode`; return how it ended, or why it was rejected, and the pids it recorded. */
async function run(mode: string, options: { timeoutMs?: number; signal?: AbortSignal; command?: string; args?: string[]; onPidFile?: (file: string) => void } = {}): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-process-test-"));
  const pidFile = join(dir, "pids.json");
  options.onPidFile?.(pidFile);
  const start = performance.now();
  try {
    const outcome = await runProcess(options.command ?? process.execPath, options.args ?? [fake, mode, pidFile],
      { stdout: "ignore", deadline: start + (options.timeoutMs ?? 30_000), signal: options.signal });
    return { outcome, ms: performance.now() - start, recorded: recorded(pidFile) };
  } catch (rejected) {
    return { rejected, ms: performance.now() - start, recorded: recorded(pidFile) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether `pid` is gone within `ms`; the OS may take a moment to reap a killed process. */
async function gone(pid: number | undefined, ms = 2_000): Promise<boolean> {
  if (pid === undefined) return true;
  for (const end = performance.now() + ms; performance.now() < end; await sleep(50)) if (!isAlive(pid)) return true;
  return !isAlive(pid);
}

/** Whether every file in `files` holds a recorded pid within `ms`. */
async function allRecorded(files: string[], ms: number): Promise<boolean> {
  const written = (file: string): boolean => { try { return recorded(file) !== undefined; } catch { return false; } };
  for (const end = performance.now() + ms; performance.now() < end; await sleep(50)) if (files.every(written)) return true;
  return files.every(written);
}

/** The child it recorded is gone; a run that never recorded one fails the test. */
function childGone(r: Run): void {
  assert.ok(r.recorded !== undefined, "the child recorded its pid");
  assert.equal(isAlive(r.recorded.pid), false, "the child is gone when the run settles");
}

const reason = (r: Run): string => (r.rejected instanceof Error ? r.rejected.message : `not rejected: ${JSON.stringify(r.outcome)}`);

test("1. a child that exits 0 resolves exited 0, and is gone", async () => {
  const r = await run("ok");
  assert.equal(r.outcome?.kind, "exited");
  assert.equal(r.outcome.kind === "exited" && r.outcome.code, 0);
  childGone(r);
});

test("2. a crash resolves its exit code, with what it wrote to stderr", async () => {
  const r = await run("crash");
  assert.deepEqual(r.outcome, { kind: "exited", code: 3, stderr: "partial output" });
  childGone(r);
});

test("3. the caller's abort rejects with its reason, and the child is gone when it settles", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error("cancelled by the caller")), 500);
  const r = await run("hang", { signal: ac.signal });
  assert.equal(reason(r), "cancelled by the caller");
  childGone(r);
});

test("4. an already aborted signal rejects without starting the child", async () => {
  const r = await run("ok", { signal: AbortSignal.abort(new Error("before")) });
  assert.equal(reason(r), "before");
  assert.equal(r.recorded, undefined);
});

test("5. an abort right after the child starts still stops it", async () => {
  const ac = new AbortController();
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-process-test-"));
  try {
    const pending = runProcess(process.execPath, [fake, "hang", join(dir, "pids.json")],
      { stdout: "ignore", deadline: performance.now() + 30_000, signal: ac.signal });
    ac.abort(new Error("at once"));
    await assert.rejects(pending, { message: "at once" });
    // The child may not have reached the line that records its pid; if it did, it's gone.
    const pids = recorded(join(dir, "pids.json"));
    assert.ok(pids === undefined || !isAlive(pids.pid));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("6. a CPU-bound child at the time limit resolves time-limit, and is gone", async () => {
  const r = await run("hang", { timeoutMs: 500 });
  assert.deepEqual(r.outcome, { kind: "time-limit" });
  childGone(r);
});

test("7. a deadline already past resolves time-limit without starting the child", async () => {
  const r = await run("ok", { timeoutMs: -1 });
  assert.deepEqual(r.outcome, { kind: "time-limit" });
  assert.equal(r.recorded, undefined);
});

test("8. a command that doesn't exist resolves spawn-failed", async () => {
  const r = await run("", { command: join(tmpdir(), "no-such-program-here"), args: [] });
  assert.equal(r.outcome?.kind, "spawn-failed");
});

test("9. arguments spawn can't take resolve spawn-failed instead of throwing", async () => {
  const r = await run("", { args: [fake, "ok\u0000"] });
  assert.equal(r.outcome?.kind, "spawn-failed");
});

test("10. a child ended by a signal quint-ts didn't send is told apart from a normal exit", async () => {
  const r = await run("selfkill");
  // Windows has no signals: TerminateProcess shows as exit code 1.
  if (posix) assert.equal(r.outcome?.kind === "signaled" && r.outcome.signal, "SIGKILL");
  else assert.equal(r.outcome?.kind === "exited" && r.outcome.code, 1);
  childGone(r);
});

test("11. a flood on stderr keeps only its end, and the run still settles", async () => {
  const r = await run("big-stderr");
  assert.equal(r.outcome?.kind === "exited" && r.outcome.code, 0);
  assert.equal(r.outcome?.kind === "exited" && r.outcome.stderr.length, 64 * 1024);
});

test("12. a child that ignores SIGTERM is killed after the grace period", async () => {
  const r = await run("ignore-term", { timeoutMs: 500 });
  assert.deepEqual(r.outcome, { kind: "time-limit" });
  childGone(r);
  if (posix) assert.ok(r.ms >= 500 + GRACE_MS - 100, `settled after ${Math.round(r.ms)} ms`);
});

test("13. a grandchild detached from the pipes goes with the child at the time limit", async () => {
  const r = await run("grandchild-detached", { timeoutMs: 1_000 });
  assert.deepEqual(r.outcome, { kind: "time-limit" });
  assert.equal(await gone(r.recorded?.grandchild), true, "the grandchild is gone");
});

test("14. a grandchild holding the pipes can't keep a timed-out run from settling", async () => {
  const r = await run("grandchild-pipes", { timeoutMs: 1_000 });
  assert.deepEqual(r.outcome, { kind: "time-limit" });
  assert.ok(r.ms < 1_000 + GRACE_MS + DRAIN_MS + 1_000, `settled after ${Math.round(r.ms)} ms`);
  assert.equal(await gone(r.recorded?.grandchild), true, "the grandchild is gone");
});

test("15. a grandchild holding the pipes can't keep a finished run from settling", async () => {
  const r = await run("grandchild-pipes-exit", { timeoutMs: 10_000 });
  assert.equal(r.outcome?.kind === "exited" && r.outcome.code, 0);
  assert.ok(r.ms < DRAIN_MS + 1_500, `settled after ${Math.round(r.ms)} ms`);
  assert.equal(await gone(r.recorded?.grandchild), true, "the grandchild is gone");
});

test("16. an abort after the child exited doesn't undo its result", async () => {
  const ac = new AbortController();
  const pending = run("grandchild-pipes-exit", { timeoutMs: 10_000, signal: ac.signal });
  setTimeout(() => ac.abort(new Error("too late")), 1_000);
  const r = await pending;
  assert.equal(r.outcome?.kind === "exited" && r.outcome.code, 0);
  assert.equal(await gone(r.recorded?.grandchild), true, "the grandchild is gone");
});

test("17. the caller's abort during the time limit's grace period wins", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error("during grace")), 1_000);
  const r = await run("ignore-term", { timeoutMs: 500, signal: ac.signal });
  // Windows ends the child at once, so there the time limit settles before the abort arrives.
  if (posix) assert.equal(reason(r), "during grace");
  else assert.deepEqual(r.outcome, { kind: "time-limit" });
  childGone(r);
});

test("18. twenty runs sharing one signal all stop on one abort, with no listener warning", async () => {
  const warnings: string[] = [];
  const onWarning = (w: Error): void => { warnings.push(w.name); };
  process.on("warning", onWarning);
  try {
    const ac = new AbortController();
    const pidFiles: string[] = [];
    const runs = Array.from({ length: 20 }, () => run("hang", { signal: ac.signal, onPidFile: (file) => pidFiles.push(file) }));
    // Abort only once every child is running, so each run has a pid whose end the test can check.
    try { assert.ok(await allRecorded(pidFiles, 3_000), "every child recorded its pid before the abort"); }
    finally { ac.abort(new Error("all")); }
    for (const r of await Promise.all(runs)) {
      assert.equal(reason(r), "all");
      childGone(r);
    }
    assert.ok(!warnings.includes("MaxListenersExceededWarning"), warnings.join(", "));
  } finally { process.off("warning", onWarning); }
});

test("Windows: a grandchild that isn't Node goes with the child", { skip: posix }, async () => {
  const r = await run("grandchild-native", { timeoutMs: 1_000 });
  assert.deepEqual(r.outcome, { kind: "time-limit" });
  assert.equal(await gone(r.recorded?.grandchild), true, "the grandchild is gone");
});
