import { expect, test } from "bun:test";
import { check, frontend } from "../src/check.ts";

const model = (name: string): string => `conformance/models/${name}.qnt`;

test("the frontend's output arrives whole when it exceeds 64 KiB", () => {
  // On Linux a pipe kept only the first 64 KiB, because Quint exits right after writing.
  const front = frontend("bench/models/stock.qnt", { main: "stock_large", invariants: ["inv"] });
  expect(front.ok).toBe(true);
  if (front.ok) expect(JSON.stringify(front.ir).length).toBeGreaterThan(65_536);
}, 60_000);

test("a `_` parameter, which Quint names without a letter, becomes a valid TLA+ name", async () => {
  // mapBy(_ => 0) in a top-level module: Quint names the parameter _N, which TLA+ rejects as an identifier.
  const result = await check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"] });
  expect(result.status).toBe("passed");
  if (result.status === "passed") expect(result.states).toBe(20);
}, 60_000);

test("a model variable that shares a name with a generated parameter still translates", async () => {
  // booleans.qnt has a variable b; the prelude's operators once had parameters named a and b.
  const result = await check("conformance/public/booleans_check.qnt", { main: "booleans_holds", invariants: ["inv"] });
  expect(result.status).toBe("passed");
}, 60_000);

test("a safe model passes after a complete search", async () => {
  const result = await check(model("reserve"), { main: "reserve3", invariants: ["inv"] });
  expect(result.status).toBe("passed");
  if (result.status !== "passed") return;
  expect(result.states).toBe(20);
  expect(result.guarantee.scope).toBe("complete");
  expect(result.guarantee.deadlock).toBe("not-checked");
}, 60_000);

test("a planted fault is violated, with its counterexample as ITF in Quint's names", async () => {
  const result = await check(model("reserve_overdraw"), { main: "reserve_overdraw3", invariants: ["inv"] });
  expect(result.status).toBe("violated");
  if (result.status !== "violated") return;
  expect(result.trace.vars).toEqual(["reserve_overdraw3::reserve_overdraw::stock", "reserve_overdraw3::reserve_overdraw::held"]);
  expect(result.trace.states[0]?.["#meta"]).toEqual({ index: 0, action: "init" });
  expect(result.trace.states.at(-1)?.["reserve_overdraw3::reserve_overdraw::stock"]).toEqual({ "#bigint": "-1" });
}, 60_000);

test("a reached operation Quint's sources disagree on is unsupported, never passed", async () => {
  const result = await check(model("div_negative"), { main: "div_negative", invariants: ["inv"] });
  expect(result.status).toBe("unsupported");
  if (result.status !== "unsupported") return;
  expect(result.where).toBe("reached-state");
  expect(result.guarantee.scope).not.toBe("complete");
}, 60_000);

test("an init that reads a state variable is unsupported, in either order and through definitions", async () => {
  // Quint's evaluators reject each of these with QNT502; TLC would solve the first as an equation and pass it.
  for (const main of ["init_reads_after", "init_reads_before", "init_reads_definition", "init_reads_nondet", "init_reads_any"]) {
    const result = await check(model("init_reads"), { main, invariants: ["inv"] });
    expect({ main, status: result.status }).toEqual({ main, status: "unsupported" });
    if (result.status === "unsupported") expect(result.reason).toContain("init reads the state variable x");
  }
}, 120_000);

test("an init that only assigns, or reads in a branch it never takes, still passes", async () => {
  for (const main of ["init_assigns", "init_unreached_read"]) {
    const result = await check(model("init_reads"), { main, invariants: ["inv"] });
    expect({ main, status: result.status }).toEqual({ main, status: "passed" });
  }
}, 120_000);
test("Quint names that would become one TLA+ name are unsupported at translation, naming both", async () => {
  const cases = [
    ["collisions_instances", "a::b_c", "a_b::c", "a_b_c"],
    ["collisions_variable", "a::x", "a_x", "a_x"],
    ["collisions_generated", "q_step", "q::step", "q_step"],
    ["collisions_invariant", "q_inv_1", "invariant number 1", "q_inv_1"],
  ] as const;
  for (const [main, one, other, tla] of cases) {
    const result = await check(model("collisions"), { main, invariants: ["inv"] });
    expect({ main, status: result.status, where: "where" in result ? result.where : undefined })
      .toEqual({ main, status: "unsupported", where: "translation" });
    if (result.status !== "unsupported") continue;
    for (const part of [one, other, `TLA+ name ${tla}`]) expect(result.reason).toContain(part);
  }
}, 120_000);

test("a local beside a definition of the same flattened name is checked: the frontend renames locals", async () => {
  const result = await check(model("collisions"), { main: "collisions_bound", invariants: ["inv"] });
  expect(result.status).toBe("passed");
}, 60_000);

test("a search stopped by the time limit is inconclusive and partial", async () => {
  const result = await check("tests/fixtures/unbounded.qnt", { main: "unbounded", invariants: ["inv"], timeoutMs: 3_000 });
  expect(result.status).toBe("inconclusive");
  expect(result.guarantee.scope).toBe("partial");
}, 60_000);

test("a check without an invariant is rejected, never passed", async () => {
  // With no invariant the search explores every state and has nothing to check: a `passed` would claim a proof of nothing.
  const none: readonly string[] = [];
  // @ts-expect-error: the type requires at least one invariant; a JavaScript caller can still pass an empty list.
  await expect(check("demo/mutex.qnt", { main: "mutex", invariants: none })).rejects.toThrow(TypeError);
});

test("a blank invariant or a literal `true` is rejected, never passed", async () => {
  // Each one checks nothing: Quint drops `true`, a blank entry names no property, and Quint reads commas
  // as the arguments of `and`, so pieces that are all blank or `true` check nothing either.
  for (const entry of ["", " ", "true", " true ", ",", " , ", "true,"]) {
    await expect(check("demo/mutex.qnt", { main: "mutex", invariants: ["inv", entry] }), JSON.stringify(entry)).rejects.toThrow(TypeError);
  }
});

test("an invariant whose commas belong to an expression is still accepted", async () => {
  // `inRange(x, 3)`'s comma separates arguments of a call, not invariants: the check must run.
  const result = await check("tests/fixtures/in_range.qnt", { main: "in_range", invariants: ["inRange(x, 3)"] });
  expect(result.status).toBe("passed");
}, 60_000);

test("a construct outside the subset is unsupported at translation", async () => {
  const result = await check("tests/fixtures/temporal.qnt", { main: "temp", invariants: ["inv"] });
  expect(result.status).toBe("unsupported");
  if (result.status === "unsupported") expect(result.where).toBe("translation");
}, 60_000);

const invariantsModel = (invariants: readonly [string, ...string[]]) => check(model("invariants"), { main: "invariants", invariants });

test("a violation names the first invariant given that the first violating state breaks", async () => {
  // Both break at x = 2, so the order given decides.
  const both = await invariantsModel(["below2", "doubleBelow4"]);
  expect(both).toMatchObject({ status: "violated", invariant: "below2" });
  expect(await invariantsModel(["doubleBelow4", "below2"])).toMatchObject({ status: "violated", invariant: "doubleBelow4" });
  // Only the second breaks.
  expect(await invariantsModel(["nonNegative", "below3"])).toMatchObject({ status: "violated", invariant: "below3" });
  // The first given breaks later (x = 4) than the second (x = 2): the search stops at x = 2, so the second is named.
  expect(await invariantsModel(["below4", "below2"])).toMatchObject({ status: "violated", invariant: "below2" });
}, 120_000);

test("several invariants that hold pass, and an entry with a comma is one invariant", async () => {
  const result = await invariantsModel(["nonNegative", "atMostFive", "x >= 0, x <= 5"]);
  expect(result).toMatchObject({ status: "passed", states: 6 });
  // The entry's comma joins its pieces, as in `quint compile --invariant`; the entry is named whole.
  expect(await invariantsModel(["nonNegative", "x >= 0, x < 3"])).toMatchObject({ status: "violated", invariant: "x >= 0, x < 3" });
}, 60_000);

test("an entry that would change the number of invariants is never checked", async () => {
  // The parentheses close the wrapper early, so Quint would read two invariants where one was given.
  const result = await invariantsModel(["nonNegative", "x >= 0), and(x < 3"]);
  expect(result).toMatchObject({ status: "unsupported", where: "translation" });
}, 60_000);
