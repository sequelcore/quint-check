/**
 * The temporary folder each check works in. Its name carries the id of the process that made it, so a
 * folder left behind by a process that died (killed, or the machine lost power) can be recognised and
 * removed by a later check. Removal never throws: a failure is reported as a process warning.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAlive } from "./process.js";

const PREFIX = "quint-ts-run-";
const OWNER = /^quint-ts-run-(\d+)-/;

/** A new folder for one check, owned by this process. */
export function makeRunDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), `${PREFIX}${process.pid}-`));
}

/** Remove `dir`; when that fails, emit a warning instead of throwing. */
export async function removeRunDir(dir: string): Promise<void> {
  try {
    // Retries cover a file another program, such as an antivirus scanner, holds open for a moment.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    process.emitWarning(`quint-ts couldn't remove its temporary folder ${dir}: ${(err as Error).message}`, { code: "QUINT_TS_CLEANUP" });
  }
}

/**
 * Remove the folders of checks whose process no longer exists. A folder whose owner's id was reused
 * by another process stays until that process ends too. Best effort: failures are left for next time.
 */
export async function sweepStaleRunDirs(root: string = tmpdir()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const stale = names.filter((name) => {
    const owner = OWNER.exec(name)?.[1];
    return owner !== undefined && Number(owner) !== process.pid && !isAlive(Number(owner));
  });
  const removed: string[] = [];
  for (const name of stale) {
    try {
      await rm(join(root, name), { recursive: true, force: true });
      removed.push(join(root, name));
    } catch {
      // Left for a later sweep.
    }
  }
  return removed;
}
