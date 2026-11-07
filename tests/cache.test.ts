import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkerCache } from "../src/cache.ts";
import { tools } from "../src/check.ts";

const cli = join(import.meta.dir, "..", "src", "cli.ts");
const models = [
  { file: "conformance/models/reserve.qnt", main: "reserve3" },
  { file: "conformance/models/reserve_overdraw.qnt", main: "reserve_overdraw3" },
];

/** A check through the CLI with the given cache settings: its exit code and printed result. */
function run(model: { file: string; main: string }, env: Record<string, string>): { code: number | null; out: string } {
  const ran = spawnSync(process.execPath, [cli, "check", model.file, "--main", model.main, "--invariant", "inv"],
    { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: ran.status, out: ran.stdout };
}

const fresh = (): string => mkdtempSync(join(tmpdir(), "quint-ts-cache-test-"));

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => join(d.parentPath, d.name));
}

test("the cache folder is per tla-ts version, runtime, platform and architecture", () => {
  const root = fresh();
  try {
    const dir = checkerCache("9.9.9", { QUINT_TS_CACHE_DIR: root });
    expect(dir).toBe(join(root, "tla-ts-9.9.9", `bun-${process.versions["bun"]}-${process.platform}-${process.arch}`));
    expect(statSync(dir ?? "").isDirectory()).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("QUINT_TS_CACHE=off turns the cache off", () => {
  expect(checkerCache(tools.tlaTsVersion, { QUINT_TS_CACHE: "off" })).toBeUndefined();
});

test("a cache root that can't be created turns the cache off", () => {
  const root = fresh();
  try {
    const blocker = join(root, "a-file");
    writeFileSync(blocker, "");
    expect(checkerCache(tools.tlaTsVersion, { QUINT_TS_CACHE_DIR: join(blocker, "cache") })).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a result is the same with the cache off, cold and warm, and the cache holds only tla-ts's compile cache", () => {
  const root = fresh();
  try {
    for (const model of models) {
      const off = run(model, { QUINT_TS_CACHE: "off" });
      const cold = run(model, { QUINT_TS_CACHE_DIR: root });
      const warm = run(model, { QUINT_TS_CACHE_DIR: root });
      expect(off.out.length).toBeGreaterThan(0);
      expect(cold).toEqual(off);
      expect(warm).toEqual(off);
    }
    const dir = checkerCache(tools.tlaTsVersion, { QUINT_TS_CACHE_DIR: root }) ?? "";
    expect(readdirSync(dir)).toEqual(["node-compile-cache"]);
    expect(files(dir).filter((f) => /\.(tla|cfg|dot)$|states/.test(f))).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);

test("a corrupted cache doesn't change a result", () => {
  const root = fresh();
  try {
    const model = models[1] ?? models[0]!;
    const expected = run(model, { QUINT_TS_CACHE: "off" });
    run(model, { QUINT_TS_CACHE_DIR: root });
    const cached = files(checkerCache(tools.tlaTsVersion, { QUINT_TS_CACHE_DIR: root }) ?? "");
    expect(cached.length).toBeGreaterThan(0);
    for (const f of cached) writeFileSync(f, Buffer.from(readFileSync(f).map((b, k) => (k % 7 === 0 ? b ^ 0xff : b))));
    expect(run(model, { QUINT_TS_CACHE_DIR: root })).toEqual(expected);
    for (const f of cached) writeFileSync(f, "");
    expect(run(model, { QUINT_TS_CACHE_DIR: root })).toEqual(expected);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);

test("checks that start together on one new cache all give the same result", async () => {
  const root = fresh();
  try {
    const model = models[0]!;
    const expected = run(model, { QUINT_TS_CACHE: "off" });
    const runs = Array.from({ length: 4 }, () => Bun.spawn([process.execPath, cli, "check", model.file, "--main", model.main, "--invariant", "inv"],
      { env: { ...process.env, QUINT_TS_CACHE_DIR: root }, stdout: "pipe" }));
    const results: { code: number | null; out: string }[] = await Promise.all(runs.map(async (p) => ({ code: await p.exited, out: await new Response(p.stdout).text() })));
    for (const r of results) expect(r).toEqual(expected);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
