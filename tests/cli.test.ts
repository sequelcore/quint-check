import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/check.ts";
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
  const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout-ms", "2147483647", "--json");
  expect(ran.code).toBe(0);
  expect(JSON.parse(ran.stdout)).toMatchObject({ status: "passed" });
}, 60_000);

test("a valid check prints a summary with the verdict last, nothing on stderr off a terminal, and exits 0 when it passed", () => {
  const ran = cli("check", ...mutex, "--invariant", "inv");
  expect(ran.code).toBe(0);
  expect(ran.stdout).toStartWith("search: complete, 20 distinct states from 1 initial state; deadlock not checked\n");
  expect(ran.stdout).toEndWith("\npassed: inv holds in all 20 reachable states\n");
  expect(ran.stderr).toBe("");
}, 60_000);

test("--json prints the result the check() API returns, and nothing else", async () => {
  const ran = cli("check", ...mutexBug, "--json");
  expect(ran.code).toBe(20);
  expect(JSON.parse(ran.stdout)).toEqual(await check("demo/mutex_bug.qnt", { main: "mutex_bug", invariants: ["inv"] }));
  expect(ran.stderr).toBe("");
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
    { args: ["--help"], usage: "Usage: quint-check <command>" },
    { args: ["-h"], usage: "Usage: quint-check <command>" },
    { args: ["--help", "--bogus"], usage: "Usage: quint-check <command>" },
    { args: ["check", "--help"], usage: "Usage: quint-check check <file.qnt>" },
    { args: ["check", ...mutex, "--invariant", "inv", "-h"], usage: "Usage: quint-check check <file.qnt>" },
    { args: ["translate", "--help"], usage: "Usage: quint-check translate <file.qnt>" },
    { args: ["cache", "--help"], usage: "Usage: quint-check cache path|clear" },
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
  for (const [args, says] of [[[], /no command given.*quint-check --help/], [["frobnicate"], /unknown command frobnicate.*quint-check --help/]] as const) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(2);
    expect(ran.stdout, args.join(" ")).toBe("");
    expect(ran.stderr.startsWith("usage: quint-check"), args.join(" ")).toBe(true);
    expect(ran.stderr.trimEnd().split("\n").at(-1), args.join(" ")).toMatch(says);
  }
}, 60_000);

test("--timeout is refused with a hint to --timeout-ms, and is not an alias", () => {
  const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout", "5000");
  expect(ran.code).toBe(2);
  expect(ran.stdout).toBe("");
  expect(ran.stderr.trimEnd().split("\n").at(-1)).toBe("quint-check: unknown option --timeout; the time limit is --timeout-ms <ms>");
}, 60_000);

test("a single-value flag given twice is a usage error", () => {
  const base = ["check", "demo/mutex.qnt", "--invariant", "inv"];
  for (const [flag, first, second] of [["--main", "mutex", "mutex"], ["--init", "init", "init"], ["--step", "step", "step"], ["--timeout-ms", "5000", "6000"],
    ["--out-itf", "a.itf.json", "b.itf.json"]]) {
    const ran = cli(...base, flag ?? "", first ?? "", flag ?? "", second ?? "");
    expect(ran.code, flag).toBe(2);
    expect(ran.stdout, flag).toBe("");
    expect(ran.stderr.trimEnd().split("\n").at(-1), flag).toBe(`quint-check: ${flag} given twice; give it once`);
  }
}, 60_000);

test("check exits with a code per status, in the summary and with --json alike", () => {
  const cases: { args: string[]; code: number; status: string }[] = [
    { args: ["check", ...mutex, "--invariant", "inv"], code: 0, status: "passed" },
    { args: ["check", "demo/mutex_bug.qnt", "--main", "mutex_bug", "--invariant", "inv"], code: 20, status: "violated" },
    { args: ["check", "demo/mutex_pairs.qnt", "--main", "mutex_pairs", "--invariant", "inv"], code: 21, status: "unsupported" },
    { args: ["check", ...mutex, "--invariant", "inv", "--timeout-ms", "1"], code: 22, status: "inconclusive" },
    { args: ["check", ...mutex, "--invariant", "nope"], code: 23, status: "error" },
  ];
  for (const { args, code, status } of cases) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(code);
    expect(ran.stdout.trimEnd().split("\n").at(-1), args.join(" ")).toStartWith(`${status}: `);
    const json = cli(...args, "--json");
    expect(json.code, args.join(" ")).toBe(code);
    expect(JSON.parse(json.stdout), args.join(" ")).toMatchObject({ status });
  }
}, 120_000);

test("translate failures are text on stderr: exit 21 when unsupported, 23 on a frontend error", () => {
  const unsupported = cli("translate", "demo/mutex_pairs.qnt", "--main", "mutex_pairs");
  expect(unsupported.code).toBe(21);
  expect(unsupported.stdout).toBe("");
  expect(unsupported.stderr).toMatch(/^quint-check: unsupported: .*operator powerset/m);
  expect(unsupported.stderr).not.toMatch(/^\s*[{[]/);
  const rejected = cli("translate", ...mutex, "--invariant", "nope");
  expect(rejected.code).toBe(23);
  expect(rejected.stdout).toBe("");
  expect(rejected.stderr).toContain("QNT404");
  expect(rejected.stderr.trimEnd().split("\n").at(-1)).toMatch(/^quint-check: error: Quint's frontend rejected the model/);
}, 120_000);

test("usage errors lead with the usage line and end with the problem", () => {
  const ran = cli("check", ...mutex, "--invarient", "inv");
  expect(ran.stderr.startsWith("usage: quint-check check <file.qnt> --invariant <expr>")).toBe(true);
  expect(ran.stderr.trimEnd().split("\n").at(-1)).toBe("quint-check: unknown option --invarient; run quint-check check --help for the options");
  expect(cli("check", ...mutex).stderr.trimEnd().split("\n").at(-1)).toBe("quint-check: check needs at least one --invariant, such as --invariant inv");
  expect(cli("check", ...mutex, "--invariant", "true").stderr.trimEnd().split("\n").at(-1))
    .toBe('quint-check: --invariant "true" checks nothing; give an invariant of the model, such as --invariant inv');
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
      expect(readdirSync(tmpdir()).filter((n) => n.startsWith(`quint-check-run-${pid}-`))).toEqual([]);
    } finally {
      run.kill("SIGKILL");
      if (frontend !== undefined) try { process.kill(-frontend, "SIGKILL"); } catch { /* gone */ }
    }
  }, 60_000);
}

const mutexBug = ["demo/mutex_bug.qnt", "--main", "mutex_bug", "--invariant", "inv"];

test("--out-itf writes a violation's counterexample, the same ITF as the result's trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "quint-check-out-itf-"));
  try {
    const out = join(dir, "cex.itf.json");
    const ran = cli("check", ...mutexBug, "--out-itf", out, "--json");
    expect(ran.code).toBe(20);
    const written = JSON.parse(readFileSync(out, "utf8"));
    expect(written).toEqual(JSON.parse(ran.stdout).trace);
    expect(written["#meta"]).toMatchObject({ format: "ITF", status: "violation" });
    expect(readdirSync(dir)).toEqual(["cex.itf.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("--out-itf writes nothing, and keeps an existing file, when there is no violation", () => {
  const dir = mkdtempSync(join(tmpdir(), "quint-check-out-itf-"));
  try {
    const out = join(dir, "cex.itf.json");
    writeFileSync(out, "earlier");
    const ran = cli("check", ...mutex, "--invariant", "inv", "--out-itf", out);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toEndWith("passed: inv holds in all 20 reachable states\n");
    expect(ran.stderr.trimEnd()).toBe(`quint-check: no counterexample; nothing written to ${out}`);
    expect(readFileSync(out, "utf8")).toBe("earlier");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("--out-itf in a missing folder, empty or - is a usage error before any check; translate doesn't take it", () => {
  const missing = join(tmpdir(), "quint-check-no-such-folder", "cex.itf.json");
  for (const [args, says] of [
    [["check", ...mutexBug, "--out-itf", missing], /the folder .*quint-check-no-such-folder doesn't exist/],
    [["check", ...mutexBug, "--out-itf", "-"], /--out-itf takes a file/],
    [["check", ...mutexBug, "--out-itf="], /--out-itf takes a file/],
    [["translate", ...mutex, "--out-itf", "x.json"], /unknown option --out-itf/],
    [["translate", ...mutex, "--json"], /unknown option --json/],
    [["check", ...mutexBug, "--json", "--json"], /--json given twice; give it once/],
  ] as const) {
    const ran = cli(...args);
    expect(ran.code, args.join(" ")).toBe(2);
    expect(ran.stdout, args.join(" ")).toBe("");
    expect(ran.stderr.trimEnd().split("\n").at(-1), args.join(" ")).toMatch(says);
  }
  expect(existsSync(missing)).toBe(false);
}, 60_000);

test("a counterexample that can't be written exits 23, with the result still printed", () => {
  const dir = mkdtempSync(join(tmpdir(), "quint-check-out-itf-"));
  try {
    // A folder where the file should go: the rename onto it fails.
    const out = join(dir, "taken");
    mkdirSync(out);
    const ran = cli("check", ...mutexBug, "--out-itf", out);
    expect(ran.code).toBe(23);
    expect(ran.stdout).toEndWith("violated: inv breaks in state 4 of the trace above\n");
    expect(ran.stderr).toContain(`quint-check: error: the counterexample couldn't be written to ${out}`);
    expect(readdirSync(dir)).toEqual(["taken"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
