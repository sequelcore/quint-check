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
