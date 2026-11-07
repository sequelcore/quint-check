import { expect, test } from "bun:test";
import { check, frontend } from "../src/check.ts";

const model = (name: string): string => `conformance/models/${name}.qnt`;

test("the frontend's output arrives whole when it exceeds 64 KiB", () => {
  // On Linux a pipe kept only the first 64 KiB, because Quint exits right after writing.
  const front = frontend("bench/models/stock.qnt", { main: "stock_large", invariants: ["inv"] });
  expect(front.ok).toBe(true);
  if (front.ok) expect(JSON.stringify(front.ir).length).toBeGreaterThan(65_536);
}, 60_000);

test("a `_` parameter, which Quint names without a letter, becomes a valid TLA+ name", () => {
  // mapBy(_ => 0) in a top-level module: Quint names the parameter _N, which TLA+ rejects as an identifier.
  const result = check("demo/mutex.qnt", { main: "mutex", invariants: ["inv"] });
  expect(result.status).toBe("passed");
  if (result.status === "passed") expect(result.states).toBe(20);
}, 60_000);

test("a model variable that shares a name with a generated parameter still translates", () => {
  // booleans.qnt has a variable b; the prelude's operators once had parameters named a and b.
  const result = check("conformance/public/booleans_check.qnt", { main: "booleans_holds", invariants: ["inv"] });
  expect(result.status).toBe("passed");
}, 60_000);

test("a safe model passes after a complete search", () => {
  const result = check(model("reserve"), { main: "reserve3", invariants: ["inv"] });
  expect(result.status).toBe("passed");
  if (result.status !== "passed") return;
  expect(result.states).toBe(20);
  expect(result.guarantee.scope).toBe("complete");
  expect(result.guarantee.deadlock).toBe("not-checked");
}, 60_000);

test("a planted fault is violated, with a trace in Quint's names", () => {
  const result = check(model("reserve_overdraw"), { main: "reserve_overdraw3", invariants: ["inv"] });
  expect(result.status).toBe("violated");
  if (result.status !== "violated") return;
  expect(result.trace[0]?.action).toBe("init");
  expect(result.trace.at(-1)?.state["stock"]).toBe("-1");
}, 60_000);

test("a reached operation Quint's sources disagree on is unsupported, never passed", () => {
  const result = check(model("div_negative"), { main: "div_negative", invariants: ["inv"] });
  expect(result.status).toBe("unsupported");
  if (result.status !== "unsupported") return;
  expect(result.where).toBe("reached-state");
  expect(result.guarantee.scope).not.toBe("complete");
}, 60_000);

test("a search stopped by the time limit is inconclusive and partial", () => {
  const result = check("tests/fixtures/unbounded.qnt", { main: "unbounded", invariants: ["inv"], timeoutMs: 3_000 });
  expect(result.status).toBe("inconclusive");
  expect(result.guarantee.scope).toBe("partial");
}, 60_000);

test("a check without an invariant is rejected, never passed", () => {
  // With no invariant the search explores every state and has nothing to check: a `passed` would claim a proof of nothing.
  const none: readonly string[] = [];
  // @ts-expect-error: the type requires at least one invariant; a JavaScript caller can still pass an empty list.
  expect(() => check("demo/mutex.qnt", { main: "mutex", invariants: none })).toThrow(TypeError);
});

test("a blank invariant or a literal `true` is rejected, never passed", () => {
  // Each one checks nothing: Quint drops `true`, a blank entry names no property, and Quint reads commas
  // as the arguments of `and`, so pieces that are all blank or `true` check nothing either.
  for (const entry of ["", " ", "true", " true ", ",", " , ", "true,"]) {
    expect(() => check("demo/mutex.qnt", { main: "mutex", invariants: ["inv", entry] }), JSON.stringify(entry)).toThrow(TypeError);
  }
});

test("an invariant whose commas belong to an expression is still accepted", () => {
  // `inRange(x, 3)`'s comma separates arguments of a call, not invariants: the check must run.
  const result = check("tests/fixtures/in_range.qnt", { main: "in_range", invariants: ["inRange(x, 3)"] });
  expect(result.status).toBe("passed");
}, 60_000);

test("a construct outside the subset is unsupported at translation", () => {
  const result = check("tests/fixtures/temporal.qnt", { main: "temp", invariants: ["inv"] });
  expect(result.status).toBe("unsupported");
  if (result.status === "unsupported") expect(result.where).toBe("translation");
}, 60_000);
