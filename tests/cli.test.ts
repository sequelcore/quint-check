import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAlive } from "../src/process.ts";

const cli = (...args: string[]): { code: number | null; stdout: string; stderr: string } => {
  const ran = spawnSync(process.execPath, ["src/cli.ts", ...args], { encoding: "utf8" });
  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
};

const mutex = ["demo/mutex.qnt", "--main", "mutex"];

test("usage errors exit 2 with a message, and run no check", () => {
  const cases: { args: string[]; says: RegExp }[] = [
    { args: ["check", ...mutex, "--invarient", "inv"], says: /--invarient/ },
    { args: ["check", ...mutex], says: /--invariant/ },
    { args: ["check", ...mutex, "--invariant"], says: /--invariant/ },
    { args: ["check", ...mutex, "--invariant", ""], says: /invariant/ },
    { args: ["check", ...mutex, "--invariant", "true"], says: /true/ },
    { args: ["check", ...mutex, "--invariant", "inv", "--timeout-ms", "abc"], says: /--timeout-ms takes a whole number.*"abc"/ },
    { args: ["check", ...mutex, "--invariant", "inv", "extra"], says: /extra/ },
    { args: ["translate", ...mutex, "--invarient", "inv"], says: /--invarient/ },
  ];
  for (const { args, says } of cases) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(2);
    expect(ran.stdout, args.join(" ")).toBe("");
    expect(ran.stderr, args.join(" ")).toMatch(says);
  }
}, 60_000);

test("a timeout too large for a timer is a usage error, not a crash or a time limit", () => {
  // Node's timers hold at most 2^31 - 1 ms; past that a timer fires after 1 ms, and past 2^53 the number isn't exact.
  for (const timeout of ["9".repeat(400), "9007199254740993", "2147483648"]) {
    const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout-ms", timeout);
    expect(ran.code, timeout.slice(0, 20)).toBe(2);
    expect(ran.stdout, timeout.slice(0, 20)).toBe("");
    expect(ran.stderr, timeout.slice(0, 20)).toMatch(/--timeout-ms/);
    expect(ran.stderr, timeout.slice(0, 20)).not.toMatch(/RangeError|\n\s+at /);
  }
}, 60_000);

test("the largest timeout a timer can hold is accepted", () => {
  const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout-ms", "2147483647");
  expect(ran.code).toBe(0);
  expect(JSON.parse(ran.stdout)).toMatchObject({ status: "passed" });
}, 60_000);

test("a valid check still prints its result and exits 0 when it passed", () => {
  const ran = cli("check", ...mutex, "--invariant", "inv");
  expect(ran.code).toBe(0);
  expect(JSON.parse(ran.stdout)).toMatchObject({ status: "passed", states: 20, guarantee: { scope: "complete" } });
}, 60_000);

test("translate needs no invariant", () => {
  const ran = cli("translate", ...mutex);
  expect(ran.code).toBe(0);
  expect(ran.stdout).toContain("INIT q_init");
  expect(ran.stdout).not.toContain("INVARIANT");
}, 60_000);

const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

test("--help and -h print help on stdout, examples first, and exit 0, anywhere on the line", () => {
  const cases: { args: string[]; usage: string }[] = [
    { args: ["--help"], usage: "Usage: quint-ts <command>" },
    { args: ["-h"], usage: "Usage: quint-ts <command>" },
    { args: ["--help", "--bogus"], usage: "Usage: quint-ts <command>" },
    { args: ["check", "--help"], usage: "Usage: quint-ts check <file.qnt>" },
    { args: ["check", ...mutex, "--invariant", "inv", "-h"], usage: "Usage: quint-ts check <file.qnt>" },
    { args: ["translate", "--help"], usage: "Usage: quint-ts translate <file.qnt>" },
    { args: ["cache", "--help"], usage: "Usage: quint-ts cache path|clear" },
  ];
  for (const { args, usage } of cases) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(0);
    expect(ran.stderr, args.join(" ")).toBe("");
    expect(ran.stdout, args.join(" ")).toContain(usage);
    expect(ran.stdout.indexOf("Examples:"), args.join(" ")).toBeGreaterThanOrEqual(0);
    expect(ran.stdout.indexOf("Examples:"), args.join(" ")).toBeLessThan(ran.stdout.indexOf("Usage:"));
    expect(ran.stdout, args.join(" ")).toContain("Exit codes");
  }
  expect(cli("check", "--help").stdout).toContain("--timeout-ms <ms>");
}, 60_000);

test("--version prints the package version on stdout and exits 0", () => {
  const ran = cli("--version");
  expect(ran.code).toBe(0);
  expect(ran.stdout).toBe(`${packageVersion}\n`);
  expect(ran.stderr).toBe("");
}, 60_000);

test("a missing or unknown command is a usage error that names the next step", () => {
  for (const [args, says] of [[[], /no command given.*quint-ts --help/], [["frobnicate"], /unknown command frobnicate.*quint-ts --help/]] as const) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(2);
    expect(ran.stdout, args.join(" ")).toBe("");
    expect(ran.stderr.startsWith("usage: quint-ts"), args.join(" ")).toBe(true);
    expect(ran.stderr.trimEnd().split("\n").at(-1), args.join(" ")).toMatch(says);
  }
}, 60_000);

test("--timeout is refused with a hint to --timeout-ms, and is not an alias", () => {
  const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout", "5000");
  expect(ran.code).toBe(2);
  expect(ran.stdout).toBe("");
  expect(ran.stderr.trimEnd().split("\n").at(-1)).toBe("quint-ts: unknown option --timeout; the time limit is --timeout-ms <ms>");
}, 60_000);

test("a single-value flag given twice is a usage error", () => {
  const base = ["check", "demo/mutex.qnt", "--invariant", "inv"];
  for (const [flag, first, second] of [["--main", "mutex", "mutex"], ["--init", "init", "init"], ["--step", "step", "step"], ["--timeout-ms", "5000", "6000"]]) {
    const ran = cli(...base, flag ?? "", first ?? "", flag ?? "", second ?? "");
    expect(ran.code, flag).toBe(2);
    expect(ran.stdout, flag).toBe("");
    expect(ran.stderr.trimEnd().split("\n").at(-1), flag).toBe(`quint-ts: ${flag} given twice; give it once`);
  }
}, 60_000);

test("check exits with a code per status, and still prints the result as JSON", () => {
  const cases: { args: string[]; code: number; status: string }[] = [
    { args: ["check", ...mutex, "--invariant", "inv"], code: 0, status: "passed" },
    { args: ["check", "demo/mutex_bug.qnt", "--main", "mutex_bug", "--invariant", "inv"], code: 20, status: "violated" },
    { args: ["check", "demo/mutex_list.qnt", "--main", "mutex_list", "--invariant", "inv"], code: 21, status: "unsupported" },
    { args: ["check", ...mutex, "--invariant", "inv", "--timeout-ms", "1"], code: 22, status: "inconclusive" },
    { args: ["check", ...mutex, "--invariant", "nope"], code: 23, status: "error" },
  ];
  for (const { args, code, status } of cases) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(code);
    expect(JSON.parse(ran.stdout), args.join(" ")).toMatchObject({ status });
  }
}, 120_000);

test("translate failures are text on stderr: exit 21 when unsupported, 23 on a frontend error", () => {
  const unsupported = cli("translate", "demo/mutex_list.qnt", "--main", "mutex_list");
  expect(unsupported.code).toBe(21);
  expect(unsupported.stdout).toBe("");
  expect(unsupported.stderr).toMatch(/^quint-ts: unsupported: .*operator List/m);
  expect(unsupported.stderr).not.toMatch(/^\s*[{[]/);
  const rejected = cli("translate", ...mutex, "--invariant", "nope");
  expect(rejected.code).toBe(23);
  expect(rejected.stdout).toBe("");
  expect(rejected.stderr).toContain("QNT404");
  expect(rejected.stderr.trimEnd().split("\n").at(-1)).toMatch(/^quint-ts: error: Quint's frontend rejected the model/);
}, 120_000);

test("usage errors lead with the usage line and end with the problem", () => {
  const ran = cli("check", ...mutex, "--invarient", "inv");
  expect(ran.stderr.startsWith("usage: quint-ts check <file.qnt> --invariant <expr>")).toBe(true);
  expect(ran.stderr.trimEnd().split("\n").at(-1)).toBe("quint-ts: unknown option --invarient; run quint-ts check --help for the options");
  expect(cli("check", ...mutex).stderr.trimEnd().split("\n").at(-1)).toBe("quint-ts: check needs at least one --invariant, such as --invariant inv");
  expect(cli("check", ...mutex, "--invariant", "true").stderr.trimEnd().split("\n").at(-1))
    .toBe('quint-ts: --invariant "true" checks nothing; give an invariant of the model, such as --invariant inv');
}, 60_000);

const posix = process.platform !== "win32";

/** The pids of `parent`'s child processes whose command line contains `text`. */
const children = (parent: number, text: string): number[] =>
  spawnSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" }).stdout.split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, ppid, ...args]) => Number(ppid) === parent && args.join(" ").includes(text))
    .map(([pid]) => Number(pid));

// POSIX only: Windows can't send a process SIGINT or SIGTERM. Quint's frontend runs in its own process group
// there, so a signal to the CLI reaches only the CLI, which must stop the frontend itself.
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  test.skipIf(!posix)(`${signal} during Quint's frontend stops it, and the CLI exits ${code}`, async () => {
    const run = spawn(process.execPath, ["src/cli.ts", "check", "bench/models/stock.qnt", "--main", "stock_large", "--invariant", "inv"], { stdio: "ignore" });
    const pid = run.pid ?? 0;
    const exited = new Promise<[number | null, string | null]>((resolve) => run.once("exit", (c, s) => resolve([c, s])));
    let frontend: number | undefined;
    try {
      for (const end = performance.now() + 30_000; frontend === undefined && performance.now() < end; await Bun.sleep(20)) {
        frontend = children(pid, "compile")[0];
      }
      expect(frontend, "Quint's frontend started").toBeDefined();
      run.kill(signal);
      expect(await exited).toEqual([code, null]);
      expect(isAlive(frontend ?? 0), "the frontend is gone").toBe(false);
      expect(readdirSync(tmpdir()).filter((n) => n.startsWith(`quint-ts-run-${pid}-`))).toEqual([]);
    } finally {
      run.kill("SIGKILL");
      if (frontend !== undefined) try { process.kill(-frontend, "SIGKILL"); } catch { /* gone */ }
    }
  }, 60_000);
}
