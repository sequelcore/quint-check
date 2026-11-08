import { expect, test } from "bun:test";
import type { Value } from "tla-ts";
import { type Dump, dump, EncodingError, type QuintType, toItf, typeProblem } from "../src/itf.ts";

const int: QuintType = { kind: "int" };
const str: QuintType = { kind: "str" };
const bool: QuintType = { kind: "bool" };
const row = (fields: [string, QuintType][]) => ({ kind: "row" as const, fields: fields.map(([fieldName, fieldType]) => ({ fieldName, fieldType })), other: { kind: "empty" } });
const unitType: QuintType = { kind: "tup", fields: row([]) };
const sum = (fields: [string, QuintType][]): QuintType => ({ kind: "sum", fields: row(fields) });
const unitPayload: Dump = { fn: [["tag", "UNIT"]] };

test("the same structure is a map, a variant, a record or a tuple by its type", () => {
  // TLA+ prints all four of these alike.
  const oneStringKey: Dump = { fn: [["A", 1]] };
  expect(toItf(oneStringKey, { kind: "fun", arg: str, res: int })).toEqual({ "#map": [["A", { "#bigint": "1" }]] });
  expect(toItf(oneStringKey, sum([["A", int], ["B", unitType]]))).toEqual({ tag: "A", value: { "#bigint": "1" } });
  expect(toItf(oneStringKey, { kind: "rec", fields: row([["A", int]]) })).toEqual({ A: { "#bigint": "1" } });
  const onTwo: Dump = { fn: [[1, "x"], [2, "y"]] };
  expect(toItf(onTwo, { kind: "fun", arg: int, res: str })).toEqual({ "#map": [[{ "#bigint": "1" }, "x"], [{ "#bigint": "2" }, "y"]] });
  expect(toItf(onTwo, { kind: "tup", fields: row([["0", str], ["1", str]]) })).toEqual({ "#tup": ["x", "y"] });
});

test("scalars, sets and a unit variant are written as Quint's own writer writes them", () => {
  expect(toItf(true, bool)).toBe(true);
  expect(toItf("café", str)).toBe("café");
  expect(toItf(-2147483648, int)).toEqual({ "#bigint": "-2147483648" });
  expect(toItf({ set: [] }, { kind: "set", elem: int })).toEqual({ "#set": [] });
  expect(toItf({ fn: [] }, { kind: "fun", arg: str, res: int })).toEqual({ "#map": [] });
  expect(toItf({ fn: [["Idle", unitPayload]] }, sum([["Idle", unitType]]))).toEqual({ tag: "Idle", value: { "#tup": [] } });
});

test("set elements and map entries are sorted, so one value gives one text", () => {
  const set = { kind: "set", elem: int } as const;
  expect(toItf({ set: [3, 1, 2] }, set)).toEqual(toItf({ set: [2, 3, 1] }, set));
  const map = { kind: "fun", arg: str, res: int } as const;
  expect(JSON.stringify(toItf({ fn: [["b", 1], ["a", 2]] }, map))).toBe(JSON.stringify(toItf({ fn: [["a", 2], ["b", 1]] }, map)));
});

test("a structure that doesn't fit its type is an encoding error, never a value", () => {
  const wrong: [Dump, QuintType][] = [
    ["1", int],
    [1.5, int],
    [1, bool],
    [true, str],
    [{ fn: [] }, { kind: "set", elem: int }],
    [{ set: [] }, { kind: "fun", arg: str, res: int }],
    // A variant has exactly one label, of its type, and a unit payload is [tag |-> "UNIT"].
    [{ fn: [["A", 1], ["B", unitPayload]] }, sum([["A", int], ["B", unitType]])],
    [{ fn: [["C", 1]] }, sum([["A", int]])],
    [{ fn: [["B", { fn: [["tag", "OTHER"]] }]] }, sum([["B", unitType]])],
    [{ fn: [["B", 0]] }, sum([["B", unitType]])],
    // A record has exactly its type's fields; a tuple exactly the indexes 1..n.
    [{ fn: [["a", 1]] }, { kind: "rec", fields: row([["a", int], ["b", int]]) }],
    [{ fn: [["a", 1], ["c", 2]] }, { kind: "rec", fields: row([["a", int], ["b", int]]) }],
    [{ fn: [[1, 1], [3, 2]] }, { kind: "tup", fields: row([["0", int], ["1", int]]) }],
    [{ fn: [[1, 1], [1, 2]] }, { kind: "tup", fields: row([["0", int], ["1", int]]) }],
    [unitPayload, unitType],
  ];
  for (const [d, t] of wrong) expect(() => toItf(d, t), JSON.stringify([d, t])).toThrow(EncodingError);
});

test("a variable whose type has no encoding here is named at translation", () => {
  expect(typeProblem({ kind: "list", elem: int })).toBe("the type list");
  expect(typeProblem({ kind: "set", elem: { kind: "var", name: "a" } })).toBe("the type var");
  expect(typeProblem(undefined)).toBe("none in Quint's IR, or a polymorphic one");
  expect(typeProblem(unitType)).toBe("the unit type outside a variant");
  expect(typeProblem({ kind: "rec", fields: { ...row([["a", int]]), other: { kind: "var", name: "r" } } })).toBe("a rec type with an open row");
  expect(typeProblem(sum([["Idle", unitType], ["Busy", { kind: "tup", fields: row([["0", int], ["1", unitType]]) }]]))).toBe("the unit type outside a variant");
  for (const ok of [int, str, bool, sum([["Idle", unitType], ["Job", int]]), { kind: "fun", arg: str, res: { kind: "rec", fields: row([["a", { kind: "set", elem: int }]]) } }]) {
    expect(typeProblem(ok), JSON.stringify(ok)).toBeUndefined();
  }
});

// tla-ts values, built by hand with only the fields dump reads.
const set = (elements: Value[]): Value => ({ kind: "Set", elements } as unknown as Value);
const fn = (domain: Value[], range: Value[]): Value => ({ kind: "Function", domain, range } as unknown as Value);

test("lazy sets a variable can hold are enumerated", () => {
  expect(dump({ kind: "Interval", low: 2, high: 4 })).toEqual({ set: [2, 3, 4] });
  expect(dump({ kind: "Interval", low: 1, high: 0 })).toEqual({ set: [] });
  expect(dump({ kind: "FunctionSet", domain: set([1, 2]), range: set([true, false]) } as unknown as Value)).toEqual({ set: [
    { fn: [[1, true], [2, true]] }, { fn: [[1, true], [2, false]] }, { fn: [[1, false], [2, true]] }, { fn: [[1, false], [2, false]] },
  ] });
  expect(dump({ kind: "ProductSet", factors: [set([1, 2]), set(["x"])] } as unknown as Value)).toEqual({ set: [
    { fn: [[1, 1], [2, "x"]] }, { fn: [[1, 2], [2, "x"]] },
  ] });
  expect(dump(set([fn(["a"], [{ kind: "Interval", low: 1, high: 2 } as Value])]))).toEqual({ set: [{ fn: [["a", { set: [1, 2] }]] }] });
});

test("a value dump can't enumerate is refused, never guessed", () => {
  const refused: Value[] = [
    { kind: "InfiniteSet", name: "Int" },
    { kind: "Subset", base: set([1]) } as unknown as Value,
    { kind: "Interval", low: 1, high: 200_000 },
    { kind: "FunctionSet", domain: { kind: "Interval", low: 1, high: 20 }, range: set([true, false]) } as unknown as Value,
  ];
  for (const v of refused) expect(() => dump(v), JSON.stringify(v)).toThrow("quint-ts can't report the counterexample");
});
