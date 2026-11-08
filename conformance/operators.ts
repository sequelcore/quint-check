/**
 * Operator conformance cases. Each is a Quint boolean expression, checked as
 * the initial value of `ok` with the invariant `ok`, so every route answers
 * the same question: passed (true), violated (false), error or unsupported.
 *
 * `semantics` says what Quint's documentation establishes for the case:
 * - defined: the documentation gives the value, and the expression is true by it;
 * - undefined: the documentation says the behavior is undefined;
 * - contested: Quint's own sources disagree on the value;
 * - unspecified: the documentation doesn't say.
 * Only a defined case may pass in quint-ts; every other must be unsupported.
 */

export type Semantics = "defined" | "undefined" | "contested" | "unspecified";

export interface OperatorCase {
  readonly id: string;
  /** The IR opcodes the case exercises; the harness checks they appear in its IR. */
  readonly ops: readonly string[];
  readonly expr: string;
  /** Declarations the expression needs, such as a sum type, placed before it in the case's module. */
  readonly decls?: string;
  readonly semantics: Semantics;
  /** Where the documentation says it, from the Quint repository at the pinned version. */
  readonly source: string;
  /** quint-ts's expected outcome when a defined case is outside what its backend can check; with why. */
  readonly quintTs?: "unsupported";
  readonly quintTsWhy?: string;
  /** Other routes' outcomes already explained, by route; any other difference fails the run. */
  readonly known?: Readonly<Record<string, { outcome: string; why: string }>>;
}

const BUILTIN = "quint/src/builtin.qnt";
const LANG_DIV = "docs/content/docs/lang.md:1401 (\"integer division, lik m \\div n in TLA+\"), :1406 (\"like m % n in TLA+\")";
const LESSON_DIV = "docs/content/docs/lessons/integers.md:242 (\"compute the integer part and the remainder\")";
const RECORDS = "docs/content/docs/lang.md:1195 (Records)";
const EVALUATORS_TRUNCATE = "Quint's evaluators truncate: quint/src/runtime/impl/builtins.ts:377 (BigInt /, %), evaluator/src/builtins.rs:371 (i64::checked_div, checked_rem)";

export const OPERATOR_CASES: readonly OperatorCase[] = [
  { id: "eq-neq", ops: ["eq", "neq"], expr: "1 == 1 and 1 != 2 and \"a\" != \"b\"", semantics: "defined", source: `${BUILTIN} eq, neq` },
  { id: "boolean", ops: ["iff", "implies", "not", "and", "or"], expr: "(true iff true) and (false implies true) and not(false) and (true or false) and not(true implies false)", semantics: "defined", source: `${BUILTIN} iff, implies, not, and, or` },
  // Each operator false where it should be: a case true only by an operator's true direction lets a translation to TRUE pass.
  { id: "iff-false", ops: ["iff", "not"], expr: "not(true iff false) and not(false iff true) and (false iff false)", semantics: "defined", source: `${BUILTIN} iff` },
  { id: "int-arith", ops: ["iadd", "isub", "imul", "iuminus"], expr: "2 + 3 == 5 and 2 - 3 == -1 and 2 * -3 == -6 and -(2) == 0 - 2", semantics: "defined", source: `${BUILTIN} iadd, isub, imul, iuminus` },
  { id: "int-compare", ops: ["ilt", "igt", "ilte", "igte"], expr: "1 < 2 and 2 > 1 and 2 <= 2 and 2 >= 2 and not(2 < 2)", semantics: "defined", source: `${BUILTIN} ilt, igt, ilte, igte` },
  { id: "big-int", ops: ["imul", "eq"], expr: "4294967296 * 4294967296 == 18446744073709551616", semantics: "defined", source: `${BUILTIN} imul: int is unbounded`,
    quintTs: "unsupported", quintTsWhy: "TLC's and tla-ts's integers are 32-bit",
    known: { "evaluator-rust": { outcome: "error", why: "the Rust evaluator's integers are i64 (QNT600)" }, official: { outcome: "error", why: "TLC's integers are 32-bit" } } },
  { id: "int-overflow", ops: ["imul", "igt"], expr: "1073741824 * 4 > 0", semantics: "defined", source: `${BUILTIN} imul: int is unbounded`,
    quintTs: "unsupported", quintTsWhy: "the product leaves TLC's 32-bit range; TLC and tla-ts stop rather than wrap",
    known: { official: { outcome: "error", why: "TLC reports the overflow" } } },
  { id: "div-nonneg", ops: ["idiv", "imod"], expr: "7 / 2 == 3 and 7 % 2 == 1 and 0 / 5 == 0 and 99 / 2 == 49 and 98 % 2 == 0", semantics: "defined", source: `${LESSON_DIV} examples; truncation and floor agree for a non-negative dividend and positive divisor` },
  { id: "div-neg-dividend", ops: ["idiv"], expr: "(-7) / 2 == -4", semantics: "contested", source: `${LANG_DIV}; ${EVALUATORS_TRUNCATE}` },
  { id: "div-neg-divisor", ops: ["idiv"], expr: "7 / (-2) == -4", semantics: "contested", source: `${LANG_DIV}; ${EVALUATORS_TRUNCATE}` },
  { id: "mod-neg-dividend", ops: ["imod"], expr: "(-7) % 2 == 1", semantics: "contested", source: `${LANG_DIV}; ${EVALUATORS_TRUNCATE}` },
  { id: "mod-neg-divisor", ops: ["imod"], expr: "7 % (-2) == 1", semantics: "contested", source: `${LANG_DIV}; ${EVALUATORS_TRUNCATE}` },
  { id: "div-by-zero", ops: ["idiv"], expr: "1 / 0 == 0", semantics: "unspecified", source: `${BUILTIN} idiv: no rule for a zero divisor; the evaluators raise QNT503` },
  { id: "set-literal", ops: ["Set", "eq"], expr: "Set(1, 2, 2) == Set(2, 1) and Set(1) != Set(2)", semantics: "defined", source: `${BUILTIN} Set` },
  { id: "set-membership", ops: ["in", "contains"], expr: "1.in(Set(1, 2)) and Set(1, 2).contains(2) and not(3.in(Set(1, 2)))", semantics: "defined", source: `${BUILTIN} in, contains` },
  { id: "contains-false", ops: ["contains", "not"], expr: "not(Set(1, 2).contains(3)) and not(Set(1).exclude(Set(1)).contains(1))", semantics: "defined", source: `${BUILTIN} contains` },
  { id: "set-algebra", ops: ["union", "intersect", "exclude", "subseteq"], expr: "Set(1).union(Set(2)) == Set(1, 2) and Set(1, 2).intersect(Set(2, 3)) == Set(2) and Set(1, 2).exclude(Set(2)) == Set(1) and Set(1).subseteq(Set(1, 2)) and not(Set(3).subseteq(Set(1, 2)))", semantics: "defined", source: `${BUILTIN} union, intersect, exclude, subseteq` },
  { id: "set-size-range", ops: ["size", "to"], expr: "Set(1, 2, 3).size() == 3 and 1.to(3) == Set(1, 2, 3) and 3.to(1).size() == 0", semantics: "defined", source: `${BUILTIN} size, to` },
  { id: "quantifiers", ops: ["exists", "forall"], expr: "Set(1, 2).exists(x => x > 1) and Set(1, 2).forall(x => x > 0) and not(Set(1, 2).forall(x => x > 1)) and 3.to(1).forall(x => false)", semantics: "defined", source: `${BUILTIN} exists, forall` },
  { id: "filter-map", ops: ["filter", "map"], expr: "Set(1, 2, 3).filter(x => x > 1) == Set(2, 3) and Set(1, 2, 3).map(x => x % 2) == Set(0, 1)", semantics: "defined", source: `${BUILTIN} filter, map` },
  { id: "fold-sum", ops: ["fold"], expr: "Set(1, 2, 3).fold(0, (acc, x) => acc + x) == 6 and Set(1, 2).fold(10, (acc, x) => acc + x * x) == 15", semantics: "defined", source: `${BUILTIN} fold: a sum is associative and commutative` },
  { id: "fold-empty", ops: ["fold"], expr: "Set(1).exclude(Set(1)).fold(5, (acc, x) => acc + x) == 5", semantics: "defined", source: `${BUILTIN} fold: no element, so the initial value` },
  { id: "fold-order", ops: ["fold"], expr: "Set(1, 2, 3).fold(0, (acc, x) => acc * 10 + x) == 123", semantics: "undefined", source: `${BUILTIN}:182 ("must be associative and commutative or else it has undefined behavior")` },
  { id: "map-literal-get", ops: ["Map", "get"], expr: "Map(1 -> 2, 3 -> 4).get(3) == 4", semantics: "defined", source: `${BUILTIN} Map, get` },
  { id: "map-by-keys", ops: ["mapBy", "keys", "get"], expr: "Set(1, 2).mapBy(x => x * 2).get(2) == 4 and Set(1, 2).mapBy(x => x).keys() == Set(1, 2)", semantics: "defined", source: `${BUILTIN} mapBy, keys` },
  { id: "map-set", ops: ["set", "Map"], expr: "Map(1 -> 0, 2 -> 0).set(1, 5) == Map(1 -> 5, 2 -> 0)", semantics: "defined", source: `${BUILTIN} set (key in the map)` },
  { id: "map-get-missing", ops: ["get"], expr: "Map(1 -> 0).get(2) == 0", semantics: "undefined", source: `${BUILTIN}:290 ("If \`k\` is not in \`m\` then the behavior is undefined")` },
  { id: "map-set-missing", ops: ["set"], expr: "Map(1 -> 0).set(2, 5) == Map(1 -> 0)", semantics: "undefined", source: `${BUILTIN}:348 ("If \`k\` is not a key in \`m\`, this operator has undefined behavior")` },
  { id: "map-repeated-key", ops: ["Map"], expr: "Map(1 -> 0, 1 -> 2).get(1) == 2", semantics: "unspecified", source: `${BUILTIN} Map: no rule for a repeated key` },
  { id: "variant-eq", ops: ["variant", "eq", "neq"], decls: "type P = Idle | Busy(int) | Named(str)\ntype O = None | Some(P)", expr: "Busy(1) == Busy(1) and Busy(1) != Busy(2) and Busy(1) != Named(\"x\") and Idle == Idle and Idle != Busy(1)", semantics: "defined", source: "docs/content/docs/lang.md:1256 (Sum Types: constructors, and match choosing the case of the variant's label)" },
  { id: "match-payload", ops: ["matchVariant", "variant"], decls: "type P = Idle | Busy(int) | Named(str)\ntype O = None | Some(P)", expr: "(match Busy(3) { | Idle => 0 | Busy(n) => n | Named(_) => -1 }) == 3", semantics: "defined", source: "docs/content/docs/lang.md:1256 (Sum Types: constructors, and match choosing the case of the variant's label)" },
  { id: "match-default", ops: ["matchVariant"], decls: "type P = Idle | Busy(int) | Named(str)\ntype O = None | Some(P)", expr: "(match Named(\"x\") { | Busy(n) => n | _ => 7 }) == 7 and (match Busy(2) { | Busy(n) => n | _ => 7 }) == 2", semantics: "defined", source: "docs/content/docs/lang.md:1256 (Sum Types: constructors, and match choosing the case of the variant's label); the default case `_` appears in Quint's examples, such as classic/distributed/Bakery/bakery.qnt" },
  { id: "variant-set", ops: ["variant", "Set", "size"], decls: "type P = Idle | Busy(int) | Named(str)\ntype O = None | Some(P)", expr: "Set(Idle, Busy(1), Busy(1), Named(\"x\")).size() == 3 and Busy(1).in(Set(Idle, Busy(1)))", semantics: "defined", source: "docs/content/docs/lang.md:1256 (Sum Types: constructors, and match choosing the case of the variant's label); lang.md's own example is a set of variants" },
  { id: "variant-map", ops: ["mapBy", "matchVariant", "get"], decls: "type P = Idle | Busy(int) | Named(str)\ntype O = None | Some(P)", expr: "Set(Idle, Busy(2)).mapBy(v => match v { | Idle => 0 | Busy(n) => n | Named(_) => 0 }).get(Busy(2)) == 2", semantics: "defined", source: "docs/content/docs/lang.md:1256 (Sum Types: constructors, and match choosing the case of the variant's label)" },
  { id: "variant-nested", ops: ["matchVariant", "variant"], decls: "type P = Idle | Busy(int) | Named(str)\ntype O = None | Some(P)", expr: "(match Some(Busy(4)) { | None => 0 | Some(p) => match p { | Busy(n) => n | _ => 0 } }) == 4", semantics: "defined", source: "docs/content/docs/lang.md:1256 (Sum Types: constructors, and match choosing the case of the variant's label)" },
  { id: "put-new-key", ops: ["put"], expr: "Map(1 -> true, 2 -> false).put(3, true) == Map(1 -> true, 2 -> false, 3 -> true)", semantics: "defined", source: "quint/src/builtin.qnt:374 (put; the documentation's own example)" },
  { id: "put-existing-key", ops: ["put"], expr: "Map(1 -> true, 2 -> false).put(2, true) == Map(1 -> true, 2 -> true)", semantics: "defined", source: "quint/src/builtin.qnt:374 (put; the documentation's own example)" },
  { id: "put-leaves-the-rest", ops: ["put", "get", "keys"], expr: "Map(1 -> 0).put(2, 5).get(1) == 0 and Map(1 -> 0).put(2, 5).keys() == Set(1, 2) and Map(1 -> 0).put(1, 0) == Map(1 -> 0)", semantics: "defined", source: "quint/src/builtin.qnt:374 (put: the map m but with k mapped to v)" },
  { id: "set-by-existing-key", ops: ["setBy"], expr: "Map(1 -> true, 2 -> false).setBy(2, x => not(x)) == Map(1 -> true, 2 -> true)", semantics: "defined", source: "quint/src/builtin.qnt:360 (setBy; the documentation's own example)" },
  { id: "set-by-current-value", ops: ["setBy", "get"], expr: "Map(1 -> 5, 2 -> 7).setBy(1, x => x * 2).get(1) == 10 and Map(1 -> 5, 2 -> 7).setBy(1, x => x * 2).get(2) == 7", semantics: "defined", source: "quint/src/builtin.qnt:360 (setBy: k set to f(m.get(k)), the other keys unchanged)" },
  { id: "set-by-missing-key", ops: ["setBy"], expr: "Map(1 -> 0).setBy(2, x => x + 1) == Map(1 -> 0)", semantics: "undefined", source: "quint/src/builtin.qnt:362 (\"If `k` is not present in `m`, this operator has undefined behavior\")" },
  { id: "set-of-maps", ops: ["setOfMaps"], expr: "Set(1, 2).setOfMaps(Set(true, false)) == Set(Map(1 -> true, 2 -> true), Map(1 -> true, 2 -> false), Map(1 -> false, 2 -> true), Map(1 -> false, 2 -> false))", semantics: "defined", source: "quint/src/builtin.qnt:331 (setOfMaps; the documentation's own example)" },
  { id: "set-of-maps-size", ops: ["setOfMaps", "size"], expr: "Set(1, 2, 3).setOfMaps(Set(0, 1)).size() == 8 and Map(1 -> 0, 2 -> 1, 3 -> 1).in(Set(1, 2, 3).setOfMaps(Set(0, 1)))", semantics: "defined", source: "quint/src/builtin.qnt:331 (setOfMaps: the set of all maps from keys to values)" },
  { id: "set-of-maps-empty", ops: ["setOfMaps", "size"], expr: "Set(1).exclude(Set(1)).setOfMaps(Set(0, 1)).size() == 1 and Set(1).setOfMaps(Set(1).exclude(Set(1))).size() == 0", semantics: "defined", source: "quint/src/builtin.qnt:331 (setOfMaps: all maps from no keys is the one empty map; to no values, none)" },
  { id: "map-empty", ops: ["Map", "put"], expr: "Map().put(1, 2) == Map(1 -> 2) and Map(1 -> 2).keys().exclude(Set(1)).size() == 0", semantics: "defined", source: "docs/content/docs/lang.md Maps (Map() is the map with no keys)" },
  { id: "ite", ops: ["ite"], expr: "(if (1 < 2) 3 else 4) == 3 and (if (2 < 1) 3 else 4) == 4", semantics: "defined", source: "docs/content/docs/lang.md if-then-else" },
  // Records. Each case also holds the operator false where it should be, so a translation that drops a field, an update or a name can't pass.
  { id: "record-field", ops: ["Rec", "field"], expr: "{ a: 1, b: true }.a == 1 and { a: 1, b: true }.b and { a: 1, b: 2 }.field(\"b\") == 2 and { a: 1, b: 2 }.a != 2 and not({ a: 1, b: false }.b)", semantics: "defined", source: `${RECORDS}; ${BUILTIN}:973 (Rec), :987 (field)` },
  { id: "record-eq", ops: ["Rec", "eq", "neq"], expr: "{ a: 1, b: 2 } == { b: 2, a: 1 } and { a: 1, b: 2 } != { a: 1, b: 3 } and not({ a: 1 } == { a: 2 }) and Rec(\"a\", 1) == { a: 1 }", semantics: "defined", source: `${RECORDS}; ${BUILTIN}:973 (Rec: a record is its fields and their values)` },
  { id: "record-with", ops: ["with", "Rec", "field"], expr: "{ a: 1, b: 2 }.with(\"a\", 3) == { a: 3, b: 2 } and { a: 1, b: 2 }.with(\"a\", 3).b == 2 and { a: 1, b: 2 }.with(\"a\", 3) != { a: 1, b: 2 } and { a: 1, b: 2 }.with(\"a\", 1) == { a: 1, b: 2 }", semantics: "defined", source: `${BUILTIN}:1012 (with; the documentation's own example)` },
  { id: "record-spread", ops: ["with", "Rec"], expr: "{ ...{ a: 1, b: 2, c: 3 }, a: 5, c: 6 } == { a: 5, b: 2, c: 6 } and { ...{ a: 1, b: 2 }, b: 7 }.a == 1 and { ...{ a: 1, b: 2 }, b: 7 } != { a: 1, b: 2 }", semantics: "defined", source: `${RECORDS} ({ f1: e1, fN: eN, ...r } is [r EXCEPT !.f1 = e1, !.fN = eN])` },
  { id: "record-field-names", ops: ["fieldNames", "Rec"], expr: "{ a: 1, b: true }.fieldNames() == Set(\"a\", \"b\") and not({ a: 1, b: true }.fieldNames().contains(\"c\")) and { a: 1 }.with(\"a\", 2).fieldNames() == Set(\"a\")", semantics: "defined", source: `${BUILTIN}:1002 (fieldNames; the documentation's own example)` },
  { id: "record-nested", ops: ["Rec", "field", "with"], expr: "{ a: { b: 1, c: 2 }, d: 3 }.a.c == 2 and { ...{ a: { b: 1, c: 2 }, d: 3 }, a: { ...{ b: 1, c: 2 }, b: 5 } } == { a: { b: 5, c: 2 }, d: 3 } and { a: { b: 1 } } != { a: { b: 2 } }", semantics: "defined", source: `${RECORDS}: a field's value may be a record` },
  { id: "record-set", ops: ["Rec", "Set", "size", "filter", "field"], expr: "Set({ a: 1 }, { a: 1 }, { a: 2 }).size() == 2 and { a: 2 }.in(Set({ a: 1 }, { a: 2 })) and not({ a: 3 }.in(Set({ a: 1 }, { a: 2 }))) and Set({ a: 1, b: 0 }, { a: 2, b: 0 }).filter(r => r.a > 1) == Set({ a: 2, b: 0 })", semantics: "defined", source: `${RECORDS}; ${BUILTIN}:973 (records are values, so sets hold them)` },
  { id: "record-map", ops: ["Rec", "mapBy", "get", "set", "field"], expr: "Set({ a: 1 }, { a: 2 }).mapBy(r => r.a).get({ a: 2 }) == 2 and Set(1, 2).mapBy(k => { n: k, on: false }).set(1, { n: 1, on: true }).get(1).on and not(Set(1, 2).mapBy(k => { n: k, on: false }).get(2).on)", semantics: "defined", source: `${RECORDS}; ${BUILTIN} mapBy, get, set (records as keys and as values)` },
  { id: "record-variant", ops: ["variant", "matchVariant", "Rec", "field"], decls: "type T = A({ x: int, y: bool }) | B", expr: "(match A({ x: 1, y: true }) { | A(r) => r.x | B => 0 }) == 1 and A({ x: 1, y: true }) != A({ x: 1, y: false }) and A({ x: 1, y: true }) == A({ y: true, x: 1 })", semantics: "defined", source: `${RECORDS}; docs/content/docs/lang.md:1256 (Sum Types: a record as a constructor's payload)` },
  { id: "record-odd-names", ops: ["Rec", "field", "with"], expr: "{ Nat: 1, Cardinality: 2, _a: 3, QTS__x: 4 }.Cardinality == 2 and { Nat: 1, Cardinality: 2, _a: 3, QTS__x: 4 }.with(\"Nat\", 5).Nat == 5 and { _a: 3, QTS__x: 4 }.QTS__x == 4", semantics: "defined", source: `${RECORDS}: field names are identifiers, so a TLA+ operator's name or quint-ts's prefix is a field name too` },
  { id: "record-empty", ops: ["Rec"], expr: "Rec() == Rec()", semantics: "unspecified", source: `${RECORDS} ("Warning: n >= 1"): no record without fields` },
  { id: "record-reserved-name", ops: ["Rec", "field"], expr: "{ DOMAIN: 1, IF: 2 }.DOMAIN == 1", semantics: "defined", source: `${RECORDS}: field names are identifiers`,
    quintTs: "unsupported", quintTsWhy: "a TLA+ reserved word can't be a field of a TLA+ record, and Quint's official route rejects it too",
    known: { official: { outcome: "error", why: "Apalache's translation names the field DOMAIN, which TLA+'s parser rejects" } } },
  { id: "record-string-name", ops: ["Rec", "field"], expr: "Rec(\"a b\", 1).field(\"a b\") == 1", semantics: "defined", source: `${BUILTIN}:973 (Rec takes a string for each field name)`,
    quintTs: "unsupported", quintTsWhy: "a field name that isn't an identifier can't be a field of a TLA+ record, and Quint's official route rejects it too",
    known: { official: { outcome: "error", why: "Apalache's translation writes the field a b, which TLA+'s parser rejects" } } },
];

/** Constructs outside the MVP: quint-ts must answer unsupported, at translation. */
export const UNSUPPORTED_CASES: readonly { id: string; module: string }[] = [
  { id: "temporal", module: "var x: int\naction init = x' = 0\naction step = x' = x\nval inv = true\ntemporal always0 = always(x == 0)" },
  { id: "then", module: "var x: int\naction init = x' = 0\naction inc = x' = x + 1\naction step = inc.then(inc)\nval inv = true" },
  { id: "choose-some", module: "var x: int\naction init = x' = Set(1, 2).chooseSome()\naction step = x' = x\nval inv = true" },
  { id: "tuple", module: "var p: (int, int)\naction init = p' = (0, 1)\naction step = p' = (p._2, p._1)\nval inv = p._1 >= 0" },
  { id: "list", module: "var l: List[int]\naction init = l' = [1, 2]\naction step = l' = l\nval inv = l[0] == 1" },
  { id: "set-to-map", module: "var m: int -> int\naction init = m' = Set((1, 2)).setToMap()\naction step = m' = m\nval inv = true" },
  { id: "reps", module: "var x: int\naction init = x' = 0\naction step = 2.reps(_ => x' = x)\nval inv = true" },
  { id: "powerset", module: "var s: Set[Set[int]]\naction init = s' = Set(1, 2).powerset()\naction step = s' = s\nval inv = true" },
  { id: "fold-order", module: "var x: int\naction init = x' = Set(1, 2).fold(0, (a, i) => a * 10 + i)\naction step = x' = x\nval inv = true" },
  { id: "const", module: "const N: int\nvar x: int\naction init = x' = N\naction step = x' = x\nval inv = true" },
];
