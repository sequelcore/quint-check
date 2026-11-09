/**
 * The folder tla-ts keeps its compile cache in between checks.
 *
 * Node keeps tla-ts's compiled code in a compile cache inside this folder:
 * the checker child enables it before loading tla-ts, as tla-ts's own CLI does
 * with the folder it gets as `-Djava.io.tmpdir` (tla-ts `src/cli.ts`,
 * `enableCompileCache`). The cache holds code of tla-ts, never anything about
 * a model or a check, so reusing it can't change a result; a check's own files
 * stay in its own run folder.
 *
 * The folder is per user, under the platform's cache location, and
 * separate for each tla-ts version, runtime, platform and architecture.
 * `QUINT_CHECK_CACHE=off` turns it off, and `QUINT_CHECK_CACHE_DIR` moves it. When
 * it can't be created or written, checks run without it, as when it's off.
 */
import { accessSync, constants, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

/** Where quint-check keeps its caches: QUINT_CHECK_CACHE_DIR, else the platform's per-user cache folder. */
export function cacheRoot(env: Env = process.env): string {
  const set = env["QUINT_CHECK_CACHE_DIR"];
  if (set !== undefined && set !== "") return set;
  if (process.platform === "win32") return join(env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "quint-check", "cache");
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "quint-check");
  return join(env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "quint-check");
}

/** The runtime that runs tla-ts, as `bun-1.4.4` or `node-24.22.1`. */
function runtime(): string {
  const bun = process.versions["bun"];
  return bun !== undefined ? `bun-${bun}` : `node-${process.versions.node}`;
}

/**
 * The checker cache folder for this tla-ts version, created if needed with
 * access for the user only, or undefined when caching is off or the folder
 * can't be written.
 */
export function checkerCache(tlaTsVersion: string, env: Env = process.env): string | undefined {
  if (env["QUINT_CHECK_CACHE"] === "off") return undefined;
  const dir = join(cacheRoot(env), `tla-ts-${tlaTsVersion}`, `${runtime()}-${process.platform}-${process.arch}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    accessSync(dir, constants.R_OK | constants.W_OK);
    return dir;
  } catch {
    return undefined;
  }
}

/** Remove every checker cache under the cache root; they are rebuilt on the next check. */
export function clearCaches(env: Env = process.env): string[] {
  const root = cacheRoot(env);
  let names: string[] = [];
  try { names = readdirSync(root).filter((name) => name.startsWith("tla-ts-")); } catch { return []; }
  for (const name of names) rmSync(join(root, name), { recursive: true, force: true });
  return names.map((name) => join(root, name));
}
