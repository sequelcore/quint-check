import { expect, test } from "bun:test";
import type { CheckResult, Guarantee } from "../src/check.ts";
import type { ItfTrace } from "../src/itf.ts";
import { quintValue, render, type Request } from "../src/render.ts";

const tools = { frontend: { name: "quint", version: "0.33.1" }, checker: { name: "tla-ts", version: "0.0.8" } } as const;
const guarantee = <S extends Guarantee["scope"]>(scope: S): Guarantee<S> =>
  ({ method: "explicit-state", property: "safety-invariant", scope, deadlock: "not-checked", ...tools });
const request: Request = { file: "spec.qnt", main: "spec", invariants: ["inv"] };

test("a passed result ends with the verdict, after the search and the tools", () => {
  const passed: CheckResult = { status: "passed", search: { initialStates: 1, distinctStates: 20, queuedStates: 0 }, guarantee: guarantee("complete") };
  expect(render(passed, request)).toEqual({
    stdout: "search: complete, 20 distinct states from 1 initial state; deadlock not checked\n" +
      "checked with quint 0.33.1 and tla-ts 0.0.8\n" +
      "passed: inv holds in all 20 reachable states\n",
    stderr: "",
  });
  const several = render({ ...passed, search: { initialStates: 2, distinctStates: 1, queuedStates: 0 } }, { ...request, invariants: ["a", "x >= 0, x <= 5"] });
  expect(several.stdout).toContain("search: complete, 1 distinct state from 2 initial states;");
  expect(several.stdout).toEndWith("passed: each of the 2 invariants holds in the 1 reachable state\n");
});

test("a violated result prints the first state whole, then what each step changed, then the search and which invariant broke where", () => {
  const trace: ItfTrace = {
    "#meta": { format: "ITF", "format-description": "https://apalache-mc.org/docs/adr/015adr-trace.html", source: "spec.qnt", status: "violation", description: "Created by quint-check 0.0.0" },
    vars: ["phase", "n"],
    states: [
      { "#meta": { index: 0, action: "init" }, phase: { tag: "Idle", value: { "#tup": [] } }, n: { "#bigint": "0" } },
      { "#meta": { index: 1, action: "step" }, phase: { tag: "Busy", value: { "#bigint": "-2" } }, n: { "#bigint": "0" } },
      { "#meta": { index: 2, action: "wait" }, phase: { tag: "Busy", value: { "#bigint": "-2" } }, n: { "#bigint": "0" } },
      { "#meta": { index: 3, action: "step" }, phase: { tag: "Busy", value: { "#bigint": "-2" } }, n: { "#bigint": "1" } },
    ],
  };
  const violated: CheckResult = { status: "violated", invariant: "n < 1", trace, search: { initialStates: 1, distinctStates: 2, queuedStates: 3 }, guarantee: guarantee("partial") };
  expect(render(violated, request)).toEqual({
    stdout: "trace (each state after the first shows only what changed):\n" +
      "  state 0, init\n    phase = Idle\n    n = 0\n" +
      "  state 1, step\n    phase = Busy(-2)\n" +
      "  state 2, wait\n    no change\n" +
      "  state 3, step\n    n = 1\n" +
      "search: stopped at the first violation, 2 distinct states, 3 still queued; deadlock not checked\n" +
      "checked with quint 0.33.1 and tla-ts 0.0.8\n" +
      "violated: n < 1 breaks in state 3 of the trace above\n",
    stderr: "",
  });
});

test("each ITF value prints as the Quint expression that builds it", () => {
  expect(quintValue(true)).toBe("true");
  expect(quintValue("héllo, it's")).toBe(`"héllo, it's"`);
  expect(quintValue({ "#bigint": "-2147483648" })).toBe("-2147483648");
  expect(quintValue({ "#set": [] })).toBe("Set()");
  expect(quintValue({ "#set": [{ "#bigint": "1" }, { "#bigint": "2" }] })).toBe("Set(1, 2)");
  expect(quintValue({ "#map": [] })).toBe("Map()");
  expect(quintValue({ "#map": [["a", true], ["b", false]] })).toBe(`Map("a" -> true, "b" -> false)`);
  expect(quintValue({ "#tup": [{ "#bigint": "1" }, "x"] })).toBe(`(1, "x")`);
  expect(quintValue({ "#tup": [] })).toBe("()");
  expect(quintValue([])).toBe("[]");
  expect(quintValue([{ "#bigint": "1" }, ["x"]])).toBe(`[1, ["x"]]`);
  expect(quintValue({ a: { "#bigint": "1" }, b: { "#set": [] } })).toBe("{ a: 1, b: Set() }");
  expect(quintValue({ tag: "Some", value: { x: true } })).toBe("Some({ x: true })");
  expect(quintValue({ tag: "None", value: { "#tup": [] } })).toBe("None");
});

test("unsupported points to Quint's own route, which checks the whole language", () => {
  const atTranslation: CheckResult = { status: "unsupported", reason: "operator List", where: "translation", guarantee: guarantee("none") };
  expect(render(atTranslation, { ...request, invariants: ["inv", "x >= 0"] })).toEqual({
    stdout: "unsupported: operator List, outside quint-check's subset (found during translation); nothing was checked\n",
    stderr: `quint verify --backend=tlc spec.qnt --main=spec --invariant=inv --invariant="x >= 0" checks the whole language (needs Java)\n`,
  });
  const reached: CheckResult = { ...atTranslation, where: "reached-state", guarantee: guarantee("partial") };
  expect(render(reached, request).stdout).toBe("unsupported: operator List, outside quint-check's subset (a reachable state needs it); nothing was proved\n");
});

test("a timeout suggests the same command with twice the time; no initial state names init", () => {
  const before: CheckResult = { status: "inconclusive", reason: "timeout", guarantee: guarantee("none") };
  expect(render(before, { ...request, timeoutMs: 1 })).toEqual({
    stdout: "inconclusive: the 1 ms time limit ran out before the search began; nothing was proved\n",
    stderr: "rerun with more time: quint-check check spec.qnt --main spec --invariant inv --timeout-ms 2\n",
  });
  const during = render({ ...before, guarantee: guarantee("partial") }, request);
  expect(during.stdout).toBe("inconclusive: the 60000 ms time limit ran out during the search; nothing was proved\n");
  expect(during.stderr).toBe("rerun with more time: quint-check check spec.qnt --main spec --invariant inv --timeout-ms 120000\n");
  const noInit: CheckResult = { status: "inconclusive", reason: "no-initial-state", guarantee: guarantee("none") };
  expect(render(noInit, { ...request, init: "start" })).toEqual({
    stdout: "inconclusive: start has no satisfying state, so nothing was checked\n",
    stderr: "check that start can assign every state variable\n",
  });
});

test("each error stage says what failed and what to do next", () => {
  const frontend: CheckResult = { status: "error", stage: "frontend", output: "error: [QNT404] Name 'nope' not found\n", guarantee: guarantee("none") };
  expect(render(frontend, request)).toEqual({
    stdout: "error: [QNT404] Name 'nope' not found\nerror: Quint's frontend rejected the model (above)\n",
    stderr: "fix what Quint reports, then run the same command again\n",
  });
  const translation = render({ ...frontend, stage: "translation", output: "Parse error at line 3" }, request);
  expect(translation.stdout).toBe("Parse error at line 3\nerror: the checker couldn't read quint-check's translation (above)\n");
  expect(translation.stderr).toBe("this is a quint-check defect; open an issue in sequelcore/quint-check with the model and this command\n");
  const checker = render({ ...frontend, stage: "checker", output: "the checker exited with code 3." }, request);
  expect(checker.stdout).toBe("the checker exited with code 3.\nerror: the checker failed (above)\n");
  expect(checker.stderr).toBe("run the same command once more; if it fails again, open an issue with the output above\n");
});
