/**
 * The checker child: `node checker.js <run folder>`, started by `check`. It reads `job.json`, checks it
 * with tla-ts's library, and writes `result.json` (see `checker-result.ts`).
 *
 * tla-ts's `check` runs without yielding to the event loop, so it runs in a Worker: the main thread
 * stays free to notice that the parent is gone. The parent holds this process's stdin open and never
 * writes to it; when stdin ends, the parent has exited or died, and this process exits at once, which
 * ends the Worker and its search.
 */
import { renameSync, readFileSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { isMainThread, Worker, workerData } from "node:worker_threads";
import { JOB_FILE, RESULT_FILE, type CheckerJob, type CheckerResult } from "./checker-result.js";

/** The exit code when stdin ended before the check did. */
const PARENT_GONE = 70;

function writeResult(dir: string, result: CheckerResult): void {
  const partial = join(dir, `${RESULT_FILE}.partial`);
  writeFileSync(partial, JSON.stringify(result));
  renameSync(partial, join(dir, RESULT_FILE));
}

async function runCheck(dir: string): Promise<void> {
  const job = JSON.parse(readFileSync(join(dir, JOB_FILE), "utf8")) as CheckerJob;
  // As tla-ts's own CLI does with -Djava.io.tmpdir: a compile cache for tla-ts's code, enabled before it loads.
  if (job.cacheDir !== undefined) nodeModule.enableCompileCache?.(join(job.cacheDir, "node-compile-cache"));
  const tla = await import("tla-ts");
  let result: CheckerResult;
  try {
    const r = await tla.check({ source: job.source, config: job.config, workers: 1 });
    result = {
      kind: "checked",
      status: r.status,
      distinctStates: r.distinctStates,
      queuedStates: r.queuedStates,
      initialStates: r.initialStates?.distinct ?? 0,
      ...r.violation === undefined ? {} : {
        violation: {
          name: r.violation.name,
          trace: r.violation.trace.map((step) => ({
            label: step.label ?? null,
            state: Object.fromEntries(Object.entries(step.state).map(([name, value]) => [name, tla.formatValue(value)])),
          })),
        },
      },
      ...r.failure === undefined ? {} : { failure: r.failure.message },
    };
  } catch (err) {
    const error = err instanceof tla.TlaSyntaxError ? "syntax" : err instanceof tla.TlaConfigError ? "config" : "other";
    result = { kind: "threw", error, message: err instanceof Error ? err.message : String(err) };
  }
  writeResult(dir, result);
}

if (isMainThread) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("usage: checker <run folder>");
    process.exit(2);
  }
  writeFileSync(join(dir, "checker.pid"), String(process.pid));
  const parentGone = (): never => process.exit(PARENT_GONE);
  process.stdin.on("end", parentGone).on("close", parentGone).on("error", parentGone).resume();
  const worker = new Worker(new URL(import.meta.url), { workerData: { dir } });
  worker.on("error", (err) => console.error(err));
  worker.on("exit", (code) => process.exit(code));
} else {
  await runCheck((workerData as { dir: string }).dir);
}
