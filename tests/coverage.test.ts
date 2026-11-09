import { expect, test } from "bun:test";
import { MODEL_CASES } from "../conformance/models.ts";
import { OPERATOR_CASES } from "../conformance/operators.ts";
import { SUPPORTED_OPCODES } from "../src/translate.ts";

test("every translated operator has a conformance case that expects it to pass", () => {
  const covered = new Set([
    ...OPERATOR_CASES.filter((c) => c.semantics === "defined" && c.quintCheck === undefined).flatMap((c) => c.ops),
    ...MODEL_CASES.filter((m) => m.expect !== "unsupported").flatMap((m) => m.ops),
  ]);
  expect(SUPPORTED_OPCODES.filter((op) => !covered.has(op))).toEqual([]);
});

test("every case exercises only translated operators, or expects quint-check to refuse it", () => {
  const supported = new Set(SUPPORTED_OPCODES);
  const outside = OPERATOR_CASES.filter((c) => c.semantics === "defined" && c.quintCheck === undefined)
    .flatMap((c) => c.ops.filter((op) => !supported.has(op)).map((op) => `${c.id}: ${op}`));
  expect(outside).toEqual([]);
});

test("a case quint-check may pass is defined by Quint's documentation", () => {
  for (const c of OPERATOR_CASES) if (c.semantics !== "defined") expect(c.quintCheck ?? "unsupported").toBe("unsupported");
});
