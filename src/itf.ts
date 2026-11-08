/**
 * Counterexamples as ITF, the Informal Trace Format (https://apalache-mc.org/docs/adr/015adr-trace.html)
 * that `quint run --out-itf` writes and Quint's tools read. The checker child reports each value's
 * structure (`Dump`); this module turns it into ITF by the variable's Quint type, which tells apart what
 * TLA+ prints alike: a map with one string key and a variant, a map on 1..n and a tuple. Quint's own
 * writer is the reference: a unit payload is `{"#tup":[]}`, and the elements of a set and the entries of
 * a map are sorted, so one trace gives one text.
 */

import type { Value } from "tla-ts";

/** A value as ITF encodes it. Integers are always `#bigint`; a record is a JSON object. */
export type ItfValue =
  | boolean
  | string
  | { readonly "#bigint": string }
  | { readonly "#set": readonly ItfValue[] }
  | { readonly "#map": readonly (readonly [ItfValue, ItfValue])[] }
  | { readonly "#tup": readonly ItfValue[] }
  | { readonly tag: string; readonly value: ItfValue }
  | { readonly [field: string]: ItfValue };

/** One state: the action that reached it (`init` for the first), and each variable by its full Quint name. */
export interface ItfState {
  readonly "#meta": { readonly index: number; readonly action: string };
  readonly [variable: string]: ItfValue | { readonly index: number; readonly action: string };
}

/** A counterexample: every state from an initial one to the first that breaks the invariant. */
export interface ItfTrace {
  readonly "#meta": {
    readonly format: "ITF";
    readonly "format-description": string;
    /** The model file, as it was given to `check`. */
    readonly source: string;
    readonly status: "violation";
    readonly description: string;
  };
  /** The state variables' full Quint names, in declaration order. */
  readonly vars: readonly string[];
  readonly states: readonly ItfState[];
}

/** A value's structure as the checker child reports it: sets and functions enumerated, integers as numbers. */
export type Dump = boolean | number | string | { readonly set: readonly Dump[] } | { readonly fn: readonly (readonly [Dump, Dump])[] };

/** A Quint type from the IR's `types` table; only the kinds below have an ITF encoding here. */
export type QuintType =
  | { readonly kind: "bool" | "int" | "str" }
  | { readonly kind: "set"; readonly elem: QuintType }
  | { readonly kind: "fun"; readonly arg: QuintType; readonly res: QuintType }
  | { readonly kind: "rec" | "tup" | "sum"; readonly fields: Row };

interface Row {
  readonly kind: "row";
  readonly fields: readonly { readonly fieldName: string; readonly fieldType: QuintType }[];
  readonly other: { readonly kind: string };
}

/** A value whose structure doesn't fit its type: a quint-ts defect, never a counterexample. */
export class EncodingError extends Error {}

const isUnit = (t: QuintType): boolean => t.kind === "tup" && t.fields.fields.length === 0;

/**
 * Why a value of type `t` can't be written as ITF, or undefined when it can. Called at translation, so a
 * model whose counterexample couldn't be reported is refused before it is checked. `t` is the IR's JSON.
 */
export function typeProblem(t: unknown, inPayload = false): string | undefined {
  const type = t as { kind?: unknown; elem?: unknown; arg?: unknown; res?: unknown; fields?: { kind?: unknown; fields?: unknown; other?: { kind?: unknown } } };
  switch (type?.kind) {
    case "bool": case "int": case "str": return undefined;
    case "set": return typeProblem(type.elem);
    case "fun": return typeProblem(type.arg) ?? typeProblem(type.res);
    case "rec": case "tup": case "sum": {
      const row = type.fields;
      if (row?.kind !== "row" || !Array.isArray(row.fields) || row.other?.kind !== "empty") return `a ${type.kind} type with an open row`;
      const fields = row.fields as { fieldName?: unknown; fieldType?: unknown }[];
      if (type.kind === "tup" && fields.length === 0 && !inPayload) return "the unit type outside a variant";
      if (type.kind === "tup" && fields.some((f, k) => f.fieldName !== String(k))) return "a tuple type whose items aren't numbered from 0";
      for (const f of fields) {
        if (typeof f.fieldName !== "string") return `a ${type.kind} type with an unnamed field`;
        const problem = typeProblem(f.fieldType, type.kind === "sum");
        if (problem !== undefined) return problem;
      }
      return undefined;
    }
    default: return t === undefined ? "none in Quint's IR, or a polymorphic one" : `the type ${typeof type?.kind === "string" ? type.kind : JSON.stringify(t)}`;
  }
}

/** A total order on ITF values, by their JSON text; the same for every run. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sorted<T>(items: readonly T[], key: (item: T) => ItfValue): T[] {
  return items.map((item) => [JSON.stringify(key(item)), item] as const).sort(([a], [b]) => byText(a, b)).map(([, item]) => item);
}

const isObject = (d: Dump): d is Exclude<Dump, boolean | number | string> => typeof d === "object" && d !== null;
const fnOf = (d: Dump, what: string): readonly (readonly [Dump, Dump])[] => {
  if (!isObject(d) || !("fn" in d)) throw new EncodingError(`${what} that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
  return d.fn;
};

/** `d` as ITF, by its Quint type `t`. Throws an EncodingError when the structure doesn't fit the type. */
export function toItf(d: Dump, t: QuintType): ItfValue {
  switch (t.kind) {
    case "bool":
      if (typeof d !== "boolean") throw new EncodingError(`a bool that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
      return d;
    case "str":
      if (typeof d !== "string") throw new EncodingError(`a str that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
      return d;
    case "int":
      if (typeof d !== "number" || !Number.isSafeInteger(d)) throw new EncodingError(`an int that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
      return { "#bigint": String(d) };
    case "set": {
      if (!isObject(d) || !("set" in d)) throw new EncodingError(`a set that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
      return { "#set": sorted(d.set.map((e) => toItf(e, t.elem)), (e) => e) };
    }
    case "fun":
      return { "#map": sorted(fnOf(d, "a map").map(([k, v]) => [toItf(k, t.arg), toItf(v, t.res)] as const), ([k]) => k) };
    case "rec": {
      // Field names and tuple indexes are strings and numbers, so a Map finds them by value.
      const byKey = new Map(fnOf(d, "a record"));
      const names = t.fields.fields.map((f) => f.fieldName);
      if (byKey.size !== names.length || !names.every((n) => byKey.has(n))) {
        throw new EncodingError(`a record with the fields ${JSON.stringify([...byKey.keys()])} where its type has ${JSON.stringify(names)}`);
      }
      return Object.fromEntries(t.fields.fields.map((f) => [f.fieldName, toItf(byKey.get(f.fieldName) as Dump, f.fieldType)]));
    }
    case "tup": {
      const byKey = new Map(fnOf(d, "a tuple"));
      const n = t.fields.fields.length;
      if (n === 0 || byKey.size !== n || !t.fields.fields.every((_, k) => byKey.has(k + 1))) {
        throw new EncodingError(`a tuple of ${n} items that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
      }
      return { "#tup": t.fields.fields.map((f, k) => toItf(byKey.get(k + 1) as Dump, f.fieldType)) };
    }
    case "sum": {
      const entries = fnOf(d, "a variant");
      const [label, payload] = entries[0] ?? [];
      const field = t.fields.fields.find((f) => f.fieldName === label);
      if (entries.length !== 1 || typeof label !== "string" || field === undefined || payload === undefined) {
        throw new EncodingError(`a variant that the checker holds as ${JSON.stringify(d).slice(0, 80)}`);
      }
      if (!isUnit(field.fieldType)) return { tag: label, value: toItf(payload, field.fieldType) };
      // The translation writes a payload-less constructor's payload as [tag |-> "UNIT"], as Quint's official route does.
      const unit = isObject(payload) && "fn" in payload ? payload.fn : undefined;
      if (unit?.length !== 1 || unit[0]?.[0] !== "tag" || unit[0][1] !== "UNIT") {
        throw new EncodingError(`the payload of ${label}, which has none, held as ${JSON.stringify(payload).slice(0, 80)}`);
      }
      return { tag: label, value: { "#tup": [] } };
    }
  }
}

const unreportable = (what: string): Error => new Error(`quint-ts can't report the counterexample: ${what}`);

/** The most elements quint-ts enumerates in one set the checker holds lazily. */
const MAX_ENUMERATED = 100_000;

/**
 * A tla-ts value's structure, for the parent to encode as ITF. A set the checker holds lazily is
 * enumerated: an interval (`1.to(3)`), a function set (`setOfMaps`) and a product (`tuples`), which a
 * variable can hold. Any other kind throws, so a counterexample is never reported with a value guessed.
 */
export function dump(v: Value): Dump {
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (v.kind === "Function") return { fn: v.domain.map((k, i) => [dump(k), dump(v.range[i] as Value)] as const) };
  if (v.kind === "LazyFunction" && v.enumerated !== undefined) return dump(v.enumerated);
  return { set: elements(v) };
}

/** The elements of a set value, enumerated when the checker holds it lazily. */
function elements(v: Value): Dump[] {
  if (typeof v === "object" && "enumerated" in v && v.enumerated !== undefined) return elements(v.enumerated);
  if (typeof v !== "object") throw unreportable(`a set that the checker holds as ${String(v)}`);
  const limited = (n: number): number => {
    if (n > MAX_ENUMERATED) throw unreportable(`a set of ${n} elements in a state, more than the ${MAX_ENUMERATED} quint-ts enumerates`);
    return n;
  };
  switch (v.kind) {
    case "Set": return v.elements.map(dump);
    case "Interval": return Array.from({ length: limited(Math.max(0, v.high - v.low + 1)) }, (_, k) => v.low + k);
    case "FunctionSet": {
      const domain = elements(v.domain);
      const range = elements(v.range);
      limited(range.length ** domain.length);
      let out: (readonly [Dump, Dump])[][] = [[]];
      for (const k of domain) out = out.flatMap((f) => range.map((r) => [...f, [k, r] as const]));
      return out.map((fn) => ({ fn }));
    }
    case "ProductSet": {
      const factors = v.factors.map(elements);
      limited(factors.reduce((n, f) => n * f.length, 1));
      let out: Dump[][] = [[]];
      for (const f of factors) out = out.flatMap((t) => f.map((x) => [...t, x]));
      return out.map((t) => ({ fn: t.map((x, i) => [i + 1, x] as const) }));
    }
    default: throw unreportable(`a set that the checker holds as ${v.kind}, which quint-ts doesn't enumerate`);
  }
}
