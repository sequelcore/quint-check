import { expect, test } from "bun:test";
import { canonValue, violatingStates } from "../conformance/graph.ts";
import type { Translation } from "../src/translate.ts";

test("a record's fields compare in any order, as TLC prints them in its own", () => {
  expect(canonValue("[holding |-> FALSE, job |-> 0, id |-> \"w1\"]")).toBe(canonValue("[id |-> \"w1\", holding |-> FALSE, job |-> 0]"));
});

test("records nested in records, sets and tuples compare in any field order", () => {
  expect(canonValue("{<<[b |-> 1, a |-> [d |-> 2, c |-> 3]]>>}")).toBe(canonValue("{<<[a |-> [c |-> 3, d |-> 2], b |-> 1]>>}"));
});

test("a set's elements compare in any order, since a record's field order can change TLC's order of them", () => {
  expect(canonValue("{[a |-> 2, b |-> 1], [a |-> 1, b |-> 2]}")).toBe(canonValue("{[b |-> 2, a |-> 1], [b |-> 1, a |-> 2]}"));
});

test("different values stay different", () => {
  expect(canonValue("[a |-> 1, b |-> 2]")).not.toBe(canonValue("[a |-> 2, b |-> 1]"));
  expect(canonValue("<<1, 2>>")).not.toBe(canonValue("<<2, 1>>"));
  expect(canonValue("(1 :> 2 @@ 2 :> 1)")).not.toBe(canonValue("(1 :> 1 @@ 2 :> 2)"));
  expect(canonValue("{\"a,b\", \"c\"}")).not.toBe(canonValue("{\"a\", \"b,c\"}"));
  expect(canonValue("[a |-> \"x] , [y\"]")).not.toBe(canonValue("[a |-> \"x]\", b |-> \"[y\"]"));
});

test("whitespace outside string literals means nothing, inside them it does", () => {
  expect(canonValue("[ a |-> 1,\n    b |-> 2 ]")).toBe(canonValue("[a|->1,b|->2]"));
  expect(canonValue("{\"a b\"}")).not.toBe(canonValue("{\"ab\"}"));
});

test("a violation in an initial state counts as violating, as one after a step does", () => {
  const t = { variables: new Map() } as unknown as Translation;
  const output = [
    "Error: Invariant Inv is violated by the initial state:",
    "/\\ x = 1",
    "/\\ y = TRUE",
    "",
    "Error: Invariant Inv is violated.",
    "Error: The behavior up to this point is:",
    "State 1: <Initial predicate>",
    "/\\ x = 0",
    "/\\ y = FALSE",
    "",
    "State 2: <Next line 5>",
    "/\\ x = 2",
    "/\\ y = FALSE",
    "",
  ].join("\n");
  expect([...violatingStates(output, t)].sort()).toEqual(["x = 1; y = TRUE", "x = 2; y = FALSE"]);
});
