import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

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
    { args: ["check", ...mutex, "--invariant", "inv", "--timeout", "abc"], says: /--timeout/ },
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
    const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout", timeout);
    expect(ran.code, timeout.slice(0, 20)).toBe(2);
    expect(ran.stdout, timeout.slice(0, 20)).toBe("");
    expect(ran.stderr, timeout.slice(0, 20)).toMatch(/--timeout/);
    expect(ran.stderr, timeout.slice(0, 20)).not.toMatch(/RangeError|\n\s+at /);
  }
}, 60_000);

test("the largest timeout a timer can hold is accepted", () => {
  const ran = cli("check", ...mutex, "--invariant", "inv", "--timeout", "2147483647");
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
