import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, runChecker, verdict, type CheckResult } from "../src/check.ts";
import { parseCheckerResult, type CheckerResult } from "../src/checker-result.ts";
import { isAlive } from "../src/process.ts";
import { removeRunDir, sweepStaleRunDirs } from "../src/workdir.ts";

const posix = process.platform !== "win32";
const unbounded = { main: "unbounded", invariants: ["inv"] as [string] };

/** This process's run folders that still exist. */
const myRunDirs = (owner = process.pid): string[] => readdirSync(tmpdir()).filter((n) => n.startsWith(`quint-ts-run-${owner}-`)).map((n) => join(tmpdir(), n));

/** The checker child's pid, once one of `owner`'s run folders records it. */
async function checkerPid(owner: number, ms = 30_000): Promise<number> {
  for (const end = performance.now() + ms; performance.now() < end; await Bun.sleep(50)) {
    for (const dir of myRunDirs(owner)) {
      const file = join(dir, "checker.pid");
      if (existsSync(file)) {
        const pid = Number(readFileSync(file, "utf8"));
        if (pid > 0) return pid;
      }
    }
  }
  throw new Error(`no checker started for ${owner}`);
}

async function gone(pid: number, ms = 5_000): Promise<boolean> {
  for (const end = performance.now() + ms; performance.now() < end; await Bun.sleep(50)) if (!isAlive(pid)) return true;
  return !isAlive(pid);
}

test("aborting a real check rejects with the reason, ends the checker and leaves no folder", async () => {
  const ac = new AbortController();
  const pending = check("tests/fixtures/unbounded.qnt", { ...unbounded, timeoutMs: 120_000, signal: ac.signal });
  const pid = await checkerPid(process.pid);
  ac.abort(new Error("stop now"));
  await expect(pending).rejects.toThrow("stop now");
  expect(isAlive(pid)).toBe(false);
  expect(myRunDirs()).toEqual([]);
}, 60_000);

test("the time limit covers Quint's frontend: a limit it can't meet is inconclusive, with nothing explored", async () => {
  const result = await check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"], timeoutMs: 1 });
  expect(result.status).toBe("inconclusive");
  expect(result.guarantee.scope).toBe("none");
  expect(myRunDirs()).toEqual([]);
}, 60_000);

test("a timeoutMs a timer can't hold is a RangeError, before anything runs", async () => {
  for (const timeoutMs of [Infinity, Number.NaN, 0, -1, 1.5, 2 ** 31, Number.MAX_SAFE_INTEGER + 2]) {
    await expect(check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"], timeoutMs }), String(timeoutMs)).rejects.toThrow(RangeError);
  }
  expect(myRunDirs()).toEqual([]);
});

test("an already aborted signal rejects before anything runs", async () => {
  await expect(check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"], signal: AbortSignal.abort(new Error("early")) })).rejects.toThrow("early");
  expect(myRunDirs()).toEqual([]);
});

test("a run folder removed while Quint's frontend runs is an error from the frontend, never a rejection or passed", async () => {
  const pending = check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"] });
  let removed = false;
  for (const end = performance.now() + 30_000; !removed && performance.now() < end; await Bun.sleep(5)) {
    for (const dir of myRunDirs()) {
      const file = join(dir, "frontend.json");
      try {
        if (!existsSync(file)) continue;
        rmSync(file);
        removed = !existsSync(file);
      } catch { /* the frontend still holds it; retry */ }
    }
  }
  expect(removed).toBe(true);
  const result = await pending;
  expect(result.status).toBe("error");
  expect(result.status === "error" && result.stage).toBe("frontend");
  expect(myRunDirs()).toEqual([]);
}, 60_000);

test("every kind of result leaves no run folder behind", async () => {
  const outcomes = [
    await check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"] }),
    await check("demo/mutex_bug.qnt", { main: "mutex_bug", invariants: ["inv"] }),
    await check("demo/mutex_records.qnt", { main: "mutex_records", invariants: ["inv"] }),
    await check("tests/fixtures/no-such-model.qnt", { main: "nothing", invariants: ["inv"] }),
    await check("tests/fixtures/unbounded.qnt", { ...unbounded, timeoutMs: 3_000 }),
  ].map((r) => r.status);
  expect(outcomes).toEqual(["passed", "violated", "unsupported", "error", "inconclusive"]);
  expect(myRunDirs()).toEqual([]);
}, 120_000);

test("when the host dies, its checker exits, and a later sweep removes the folder it left", async () => {
  const host = spawn(process.execPath, [join(import.meta.dir, "fixtures", "host.ts")], { stdio: "ignore" });
  const hostPid = host.pid ?? 0;
  try {
    const pid = await checkerPid(hostPid);
    host.kill("SIGKILL");
    expect(await gone(pid)).toBe(true);
    // SIGKILL leaves the host no chance to remove its folder; the next check's sweep does.
    expect(myRunDirs(hostPid).length).toBe(1);
    await new Promise((resolve) => (host.exitCode === null && host.signalCode === null ? host.once("exit", resolve) : resolve(undefined)));
    await sweepStaleRunDirs();
    expect(myRunDirs(hostPid)).toEqual([]);
  } finally {
    host.kill("SIGKILL");
    for (const dir of myRunDirs(hostPid)) rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);

test("the sweep removes only folders whose owner is gone", async () => {
  const root = mkdtempSync(join(tmpdir(), "quint-ts-sweep-test-"));
  try {
    const ended = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    await new Promise((resolve) => ended.once("exit", resolve));
    const dead = join(root, `quint-ts-run-${ended.pid}-a`);
    const mine = join(root, `quint-ts-run-${process.pid}-b`);
    const other = join(root, "quint-ts-cache-c");
    for (const d of [dead, mine, other]) mkdirSync(d);
    expect(await sweepStaleRunDirs(root)).toEqual([dead]);
    expect([existsSync(dead), existsSync(mine), existsSync(other)]).toEqual([false, true, true]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a run folder that can't be removed is a warning, never a throw", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quint-ts-cleanup-test-"));
  const inner = join(dir, "inner");
  mkdirSync(inner);
  writeFileSync(join(inner, "file"), "x");
  const warnings: { name: string; code?: string }[] = [];
  const onWarning = (w: Error & { code?: string }) => warnings.push({ name: w.name, code: w.code ?? "" });
  process.on("warning", onWarning);
  const cwd = process.cwd();
  try {
    // Windows won't remove a folder that a process is in; POSIX won't remove entries of a read-only folder.
    if (posix) chmodSync(inner, 0o500);
    else process.chdir(inner);
    await removeRunDir(dir);
    await Bun.sleep(10);
    expect(warnings).toContainEqual({ name: "Warning", code: "QUINT_TS_CLEANUP" });
  } finally {
    process.off("warning", onWarning);
    process.chdir(cwd);
    if (posix) chmodSync(inner, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("a result that is missing, partial or malformed is never a result", () => {
  const valid = { kind: "checked", status: "success", distinctStates: 20, queuedStates: 0, initialStates: 1 } as const;
  expect(parseCheckerResult(JSON.stringify(valid))).toEqual(valid);
  const broken = [
    "", "{", JSON.stringify(valid).slice(0, -5), "null", "[]",
    JSON.stringify({ ...valid, kind: "passed" }),
    JSON.stringify({ ...valid, distinctStates: "20" }),
    JSON.stringify({ ...valid, queuedStates: -1 }),
    JSON.stringify({ ...valid, initialStates: 1.5 }),
    JSON.stringify({ kind: "checked", status: "success", distinctStates: 20, queuedStates: 0 }),
    JSON.stringify({ ...valid, violation: { name: "q_inv", trace: [{ label: 3, state: {} }] } }),
    JSON.stringify({ ...valid, violation: { name: "q_inv", trace: [{ label: null, state: { x: 1 } }] } }),
    JSON.stringify({ ...valid, failure: 7 }),
    JSON.stringify({ kind: "threw", error: "fatal", message: "x" }),
  ];
  for (const text of broken) expect(parseCheckerResult(text), text).toBeUndefined();
});

/** A translation with no names to map, for results that don't depend on one. */
const noNames = { tla: "", cfg: "", variables: new Map<string, string>(), names: new Map<string, string>() };
const success: CheckerResult = { kind: "checked", status: "success", distinctStates: 20, queuedStates: 0, initialStates: 1 };

test("a success is passed only with an initial state, a distinct state and no state left queued", () => {
  expect(verdict(success, noNames)).toMatchObject({ status: "passed", states: 20, guarantee: { scope: "complete" } });
  const notPassed: [Partial<CheckerResult>, CheckResult["status"]][] = [
    [{ initialStates: 0 }, "inconclusive"],
    [{ distinctStates: 0 }, "inconclusive"],
    [{ initialStates: 0, distinctStates: 0 }, "inconclusive"],
    [{ queuedStates: 3 }, "error"],
  ];
  for (const [counts, status] of notPassed) {
    const r = verdict({ ...success, ...counts } as CheckerResult, noNames);
    expect(r.status, JSON.stringify(counts)).toBe(status);
    expect(r.guarantee.scope, JSON.stringify(counts)).not.toBe("complete");
  }
});

test("the checker's result counts only when it exits 0 and writes a complete, well-formed one", async () => {
  const fake = join(import.meta.dir, "fixtures", "fake-checker.mjs");
  const noResult = "the checker wrote no complete result.";
  const cases: [string, CheckResult["status"], string?][] = [
    ["pass", "passed"],
    ["exit-3", "error", "the checker exited with code 3."],
    // Windows has no signals: TerminateProcess shows as exit code 1.
    ["killed", "error", posix ? "the checker was ended by SIGKILL." : "the checker exited with code 1."],
    ["no-result", "error", noResult],
    ["partial", "error", noResult],
    ["malformed", "error", noResult],
  ];
  for (const [mode, status, output] of cases) {
    const dir = mkdtempSync(join(tmpdir(), "quint-ts-checker-test-"));
    try {
      writeFileSync(join(dir, "mode"), mode);
      const r = await runChecker(fake, dir, noNames, performance.now() + 30_000);
      expect(r.status, mode).toBe(status);
      if (output !== undefined) expect(r.status === "error" && r.output, mode).toBe(output);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}, 60_000);
