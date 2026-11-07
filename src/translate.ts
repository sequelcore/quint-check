/**
 * Quint IR, as `quint compile --target json` writes it after flattening, to
 * plain TLA+ that TLC and tla-ts check. Fail-closed: a construct outside
 * `SUPPORTED_OPCODES` throws `Unsupported`; an operation whose result Quint
 * leaves undefined, or on which Quint's documentation and evaluators
 * disagree, stops the check at the state that reaches it (`MARKER`).
 */

/** A construct the translator can't translate faithfully. */
export class Unsupported extends Error {}

/** The text a reached unsupported operation fails with, so the check reports it as unsupported, never as a violation. */
export const MARKER = "quint-ts-unsupported:";

/**
 * The operators translated, each with a conformance case (`conformance/operators.ts`).
 * An operator joins this list only with a case that passes.
 */
export const SUPPORTED_OPCODES: readonly string[] = [
  "eq", "neq", "iff", "implies", "not", "and", "or",
  "iadd", "isub", "imul", "idiv", "imod", "ilt", "igt", "ilte", "igte", "iuminus",
  "Set", "in", "contains", "union", "intersect", "exclude", "subseteq", "size", "to",
  "exists", "forall", "filter", "map", "fold",
  "Map", "mapBy", "get", "set", "keys", "put", "setBy", "setOfMaps",
  "ite", "assign", "actionAll", "actionAny",
  "variant", "matchVariant",
];

// The IR is JSON; its shapes are checked where they are read.
type Ex = any;
type Def = any;

/**
 * A Quint name as a TLA+ identifier. TLA+ requires a letter in every
 * identifier, and Quint names a `_` parameter `_15`, so a name with no letter
 * gets the reserved prefix (which no translated name may have).
 */
const mangle = (name: string): string => {
  const flat = name.replace(/::/g, "_");
  return /[A-Za-z]/.test(flat) ? flat : `QTS__${flat}`;
};

interface Ctx {
  readonly defs: Map<string, Def>;
  readonly vars: Set<string>;
  readonly mode: "init" | "action" | "state";
  readonly helpers: string[];
  readonly counter: { n: number };
  /** Names bound in scope: parameters, quantified and nondet variables. */
  readonly locals: Set<string>;
}

const infix: Record<string, string> = {
  eq: "=", neq: "#", iff: "<=>", implies: "=>", iadd: "+", isub: "-", imul: "*",
  ilt: "<", igt: ">", ilte: "<=", igte: ">=", in: "\\in",
  union: "\\union", intersect: "\\intersect", exclude: "\\", subseteq: "\\subseteq", to: "..",
};

function lambdaOf(ex: Ex, arity: number): { params: string[]; body: Ex } {
  if (ex?.kind !== "lambda" || ex.params.length !== arity) throw new Unsupported(`an operator argument that isn't a lambda of arity ${arity}`);
  return { params: ex.params.map((p: Ex) => p.name), body: ex.expr };
}

function freeLocals(ex: Ex, ctx: Ctx, bound: Set<string>, out: Set<string>): void {
  if (ex === null || typeof ex !== "object") return;
  if (ex.kind === "name" && ctx.locals.has(ex.name) && !bound.has(ex.name)) out.add(ex.name);
  if (ex.kind === "lambda") {
    freeLocals(ex.expr, ctx, new Set([...bound, ...ex.params.map((p: Ex) => p.name)]), out);
    return;
  }
  if (ex.kind === "let") {
    freeLocals(ex.opdef.expr, ctx, bound, out);
    freeLocals(ex.expr, ctx, new Set([...bound, ex.opdef.name]), out);
    return;
  }
  for (const arg of ex.args ?? []) freeLocals(arg, ctx, bound, out);
}

const withLocals = (ctx: Ctx, names: readonly string[]): Ctx => ({ ...ctx, locals: new Set([...ctx.locals, ...names]) });

function expr(ex: Ex, ctx: Ctx): string {
  switch (ex.kind) {
    case "int": return BigInt(ex.value) < 0n ? `(${ex.value})` : String(ex.value);
    case "bool": return ex.value ? "TRUE" : "FALSE";
    case "str": return JSON.stringify(ex.value);
    case "name": return name(ex.name, ctx);
    case "app": return app(ex, ctx);
    case "let": {
      const d = ex.opdef;
      if (d.qualifier === "nondet") {
        const rhs = d.expr;
        if (rhs.kind !== "app" || rhs.opcode !== "oneOf" || rhs.args.length !== 1) throw new Unsupported("nondet other than oneOf(S)");
        if (ctx.mode === "state") throw new Unsupported("nondet outside an action");
        return `(\\E ${mangle(d.name)} \\in ${expr(rhs.args[0], ctx)} : ${expr(ex.expr, withLocals(ctx, [d.name]))})`;
      }
      if (d.expr.kind === "lambda") throw new Unsupported("a let-bound operator with parameters");
      if (d.qualifier !== "val" && d.qualifier !== "pureval") throw new Unsupported(`let with qualifier ${d.qualifier}`);
      return `(LET ${mangle(d.name)} == ${expr(d.expr, ctx)} IN ${expr(ex.expr, withLocals(ctx, [d.name]))})`;
    }
    default: throw new Unsupported(`expression kind ${ex.kind}`);
  }
}

function name(n: string, ctx: Ctx): string {
  if (ctx.locals.has(n) || ctx.vars.has(n)) return mangle(n);
  const def = ctx.defs.get(n);
  if (def === undefined) throw new Unsupported(`unresolved name ${n}`);
  if (def.qualifier === "action" && ctx.mode === "init") return `(${initBody(def, [], ctx)})`;
  if (def.qualifier === "action" && ctx.mode === "state") throw new Unsupported(`action ${n} used in a state expression`);
  return mangle(n);
}

/** Init reads assignments as equalities: the init action's body, inlined, its parameters bound by LET. */
function initBody(def: Def, args: readonly string[], ctx: Ctx): string {
  if (def.expr.kind !== "lambda") return expr(def.expr, ctx);
  const { params, body } = lambdaOf(def.expr, args.length);
  if (params.length === 0) return expr(body, ctx);
  return `LET ${params.map((p, k) => `${mangle(p)} == ${args[k]}`).join("\n    ")} IN ${expr(body, withLocals(ctx, params))}`;
}

function app(ex: Ex, ctx: Ctx): string {
  const a: Ex[] = ex.args;
  const e = (k: number): string => expr(a[k], ctx);
  const op: string = ex.opcode;
  const builtin = SUPPORTED_OPCODES.includes(op);
  if (!builtin && !ctx.defs.has(op)) throw new Unsupported(`operator ${op}`);
  if (builtin && infix[op] !== undefined) {
    if (a.length !== 2) throw new Unsupported(`${op} with ${a.length} arguments`);
    return `(${e(0)} ${infix[op]} ${e(1)})`;
  }
  switch (op) {
    case "not": return `(~${e(0)})`;
    case "iuminus": return `(-${e(0)})`;
    case "and": case "actionAll": return a.length === 0 ? "TRUE" : `(${a.map((x) => expr(x, ctx)).join(" /\\ ")})`;
    case "or": case "actionAny": return a.length === 0 ? "FALSE" : `(${a.map((x) => expr(x, ctx)).join(" \\/ ")})`;
    case "idiv": return `QTS__div(${e(0)}, ${e(1)})`;
    case "imod": return `QTS__mod(${e(0)}, ${e(1)})`;
    case "ite": return `(IF ${e(0)} THEN ${e(1)} ELSE ${e(2)})`;
    case "contains": return `(${e(1)} \\in ${e(0)})`;
    case "Set": return `{${a.map((x) => expr(x, ctx)).join(", ")}}`;
    case "size": return `Cardinality(${e(0)})`;
    case "exists": case "forall": case "filter": case "map": case "mapBy": {
      const { params, body } = lambdaOf(a[1], 1);
      const inner = expr(body, withLocals(ctx, params));
      const v = mangle(params[0] ?? "");
      if (op === "exists") return `(\\E ${v} \\in ${e(0)} : ${inner})`;
      if (op === "forall") return `(\\A ${v} \\in ${e(0)} : ${inner})`;
      if (op === "filter") return `{${v} \\in ${e(0)} : ${inner}}`;
      if (op === "map") return `{${inner} : ${v} \\in ${e(0)}}`;
      return `[${v} \\in ${e(0)} |-> ${inner}]`;
    }
    case "fold": return fold(a, ctx);
    case "variant": return variant(a, ctx);
    case "matchVariant": return matchVariant(a, ctx);
    case "Map": return mapLiteral(a, ctx);
    case "get": return `QTS__get(${e(0)}, ${e(1)})`;
    case "keys": return `DOMAIN ${e(0)}`;
    case "set": return `QTS__set(${e(0)}, ${e(1)}, ${e(2)})`;
    case "put": return `QTS__put(${e(0)}, ${e(1)}, ${e(2)})`;
    // keys.setOfMaps(values): every map from keys to values, which is TLA+'s function set.
    case "setOfMaps": return `[${e(0)} -> ${e(1)}]`;
    case "setBy": return setBy(a, ctx);
    case "assign": {
      if (a[0]?.kind !== "name" || !ctx.vars.has(a[0].name)) throw new Unsupported("an assignment to something other than a state variable");
      if (ctx.mode === "state") throw new Unsupported("an assignment in a state expression");
      return ctx.mode === "init" ? `(${mangle(a[0].name)} = ${e(1)})` : `(${mangle(a[0].name)}' = ${e(1)})`;
    }
    default: {
      const def = ctx.defs.get(op);
      const args = a.map((x) => expr(x, ctx));
      if (def.qualifier === "action" && ctx.mode === "init") return `(${initBody(def, args, ctx)})`;
      if (def.qualifier === "action" && ctx.mode === "state") throw new Unsupported(`action ${op} used in a state expression`);
      return `${mangle(op)}(${args.join(", ")})`;
    }
  }
}

/**
 * A variant as Apalache's Variants module encodes it for TLC: a function
 * whose only key is the label, `[t \in {"L"} |-> payload]`, with
 * `[tag |-> "UNIT"]` as the payload of a constructor without one. The same
 * encoding as Quint's official route, so states print the same in both.
 */
function variant(a: Ex[], ctx: Ctx): string {
  if (a[0]?.kind !== "str") throw new Unsupported("a variant whose label isn't a literal");
  const payload = a[1]?.kind === "app" && a[1].opcode === "Tup" && a[1].args.length === 0 ? `[tag |-> "UNIT"]` : expr(a[1], ctx);
  return `[QTS__t \\in {${JSON.stringify(a[0].value)}} |-> ${payload}]`;
}

/**
 * match: the case whose label is the variant's, with its parameter bound to
 * the payload; `_` is the default and binds nothing. With no case for the
 * label and no default, TLC fails evaluating the CASE, so the check is an
 * error, never a pass.
 */
function matchVariant(a: Ex[], ctx: Ctx): string {
  const m = `QTS__m${++ctx.counter.n}`;
  const arms: string[] = [];
  let fallback: string | undefined;
  const seen = new Set<string>();
  for (let k = 1; k < a.length; k += 2) {
    const label = a[k];
    if (label?.kind !== "str") throw new Unsupported("a match case whose label isn't a literal");
    if (seen.has(label.value)) throw new Unsupported(`a match with two cases for ${label.value}`);
    seen.add(label.value);
    const { params, body } = lambdaOf(a[k + 1], 1);
    const param = params[0] ?? "";
    if (label.value === "_") {
      if (k + 2 < a.length) throw new Unsupported("a match whose default case isn't the last");
      // Quint's default case binds nothing; Apalache's translation passes it {}, so a body that read it would differ.
      if (JSON.stringify(body).includes(`"name":${JSON.stringify(param)}`)) throw new Unsupported("a match default case that reads its parameter");
      fallback = expr(body, ctx);
      continue;
    }
    arms.push(`${JSON.stringify(label.value)} \\in DOMAIN ${m} -> (LET ${mangle(param)} == ${m}[${JSON.stringify(label.value)}] IN ${expr(body, withLocals(ctx, [param]))})`);
  }
  if (arms.length === 0) throw new Unsupported("a match with only a default case");
  return `(LET ${m} == ${expr(a[0], ctx)} IN CASE ${[...arms, ...fallback === undefined ? [] : [`OTHER -> ${fallback}`]].join(" [] ")})`;
}

/**
 * m.setBy(k, f): m with k mapped to f(m.get(k)). Quint leaves it undefined
 * when k isn't a key of m, so a state that reaches that is unsupported.
 */
function setBy(a: Ex[], ctx: Ctx): string {
  const { params, body } = lambdaOf(a[2], 1);
  const n = ++ctx.counter.n;
  const m = `QTS__sbm${n}`;
  const k = `QTS__sbk${n}`;
  const value = `(LET ${mangle(params[0] ?? "")} == ${m}[${k}] IN ${expr(body, withLocals(ctx, params))})`;
  return `(LET ${m} == ${expr(a[0], ctx)}\n      ${k} == ${expr(a[1], ctx)}\n  IN IF ${k} \\in DOMAIN ${m} THEN [${m} EXCEPT ![${k}] = ${value}] ` +
    `ELSE QTS__unsupported("setBy with a key the map lacks"))`;
}

/** Only literal, distinct keys: Quint's rule for a repeated key isn't established. */
function mapLiteral(a: Ex[], ctx: Ctx): string {
  // Map(): the map with no keys, the function on the empty set.
  if (a.length === 0) return "[QTS__k \\in {} |-> TRUE]";
  const pairs = a.map((p) => {
    if (p.kind !== "app" || p.opcode !== "Tup" || p.args.length !== 2 || !["int", "str", "bool"].includes(p.args[0].kind)) {
      throw new Unsupported("a Map literal with a key that isn't a literal");
    }
    return [expr(p.args[0], ctx), expr(p.args[1], ctx)] as const;
  });
  if (new Set(pairs.map(([k]) => k)).size !== pairs.length) throw new Unsupported("a Map literal with a repeated key");
  return `[QTS__k \\in {${pairs.map(([k]) => k).join(", ")}} |-> CASE ${pairs.map(([k, v]) => `QTS__k = ${k} -> ${v}`).join(" [] ")}]`;
}

/**
 * fold over a set, only as `acc + f(x)`. Quint leaves a fold whose operator
 * isn't associative and commutative undefined; a sum is both.
 */
function fold(a: Ex[], ctx: Ctx): string {
  const { params, body } = lambdaOf(a[2], 2);
  const [acc = "", x = ""] = params;
  const mentionsAcc = (t: Ex): boolean => JSON.stringify(t).includes(`"name":${JSON.stringify(acc)}`);
  if (body.kind !== "app" || body.opcode !== "iadd" || body.args[0]?.kind !== "name" || body.args[0].name !== acc || mentionsAcc(body.args[1])) {
    throw new Unsupported("a fold whose operator isn't `acc + f(x)`: Quint leaves other folds undefined unless associative and commutative");
  }
  const captured = new Set<string>();
  freeLocals(body.args[1], ctx, new Set([acc, x]), captured);
  const extra = [...captured].map(mangle);
  const id = `QTS__fold${++ctx.counter.n}`;
  const term = expr(body.args[1], withLocals(ctx, [x]));
  const params2 = ["QTS__acc", "QTS__s", ...extra];
  ctx.helpers.push(`RECURSIVE ${id}(${params2.map(() => "_").join(", ")})\n${id}(${params2.join(", ")}) ==\n` +
    `  IF QTS__s = {} THEN QTS__acc ELSE\n    LET ${mangle(x)} == CHOOSE QTS__x \\in QTS__s : TRUE IN\n` +
    `    ${id}(QTS__acc + ${term}, QTS__s \\ {${mangle(x)}}${extra.map((v) => `, ${v}`).join("")})`);
  return `${id}(${expr(a[1], ctx)}, ${expr(a[0], ctx)}${extra.map((v) => `, ${v}`).join("")})`;
}

/**
 * The first opcode in `ex` that is neither in `SUPPORTED_OPCODES` nor a
 * definition of the module, or undefined. A Map literal's pairs and a
 * nondet's `oneOf` are part of their construct, so they aren't reported.
 */
function firstUnsupported(ex: Ex, defs: Map<string, Def>): string | undefined {
  if (ex === null || typeof ex !== "object") return undefined;
  if (ex.kind === "app") {
    const op: string = ex.opcode;
    if (op === "variant" && ex.args[1]?.kind === "app" && ex.args[1].opcode === "Tup" && ex.args[1].args.length === 0) return undefined;
    if (!SUPPORTED_OPCODES.includes(op) && !defs.has(op)) return op;
    const children: Ex[] = op === "Map" ? ex.args.flatMap((pair: Ex) => (pair.kind === "app" && pair.opcode === "Tup" ? pair.args : [pair])) : ex.args;
    for (const child of children) {
      const found = firstUnsupported(child, defs);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (ex.kind === "lambda") return firstUnsupported(ex.expr, defs);
  if (ex.kind === "let") {
    const rhs = ex.opdef.expr;
    const bound = ex.opdef.qualifier === "nondet" && rhs?.kind === "app" && rhs.opcode === "oneOf" ? rhs.args : [rhs];
    for (const part of [...bound, ex.expr]) {
      const found = firstUnsupported(part, defs);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The variables an action assigns; every branch must assign the same ones, each once. */
function assigned(ex: Ex, defs: Map<string, Def>, seen: ReadonlySet<string> = new Set()): Set<string> {
  if (ex.kind === "app" && ex.opcode === "assign") return new Set([ex.args[0].name]);
  if (ex.kind === "app" && ex.opcode === "actionAll") {
    const all = new Set<string>();
    for (const arg of ex.args) {
      for (const v of assigned(arg, defs, seen)) {
        if (all.has(v)) throw new Unsupported(`variable ${v} assigned twice`);
        all.add(v);
      }
    }
    return all;
  }
  if (ex.kind === "app" && (ex.opcode === "actionAny" || ex.opcode === "ite" || ex.opcode === "matchVariant")) {
    const arms: Ex[] = ex.opcode === "ite" ? ex.args.slice(1) : ex.opcode === "matchVariant" ? ex.args.filter((_: Ex, k: number) => k > 0 && k % 2 === 0) : ex.args;
    const branches: Set<string>[] = arms.map((b: Ex) => assigned(b, defs, seen));
    const key = (s: Set<string>): string => [...s].sort().join(",");
    if (new Set(branches.map(key)).size > 1) throw new Unsupported("branches that assign different variables");
    return branches[0] ?? new Set();
  }
  if (ex.kind === "let" || ex.kind === "lambda") return assigned(ex.expr, defs, seen);
  const target: string | undefined = ex.kind === "name" ? ex.name : ex.kind === "app" ? ex.opcode : undefined;
  const def = target === undefined ? undefined : defs.get(target);
  if (target !== undefined && def?.qualifier === "action") {
    if (seen.has(target)) throw new Unsupported("a recursive action");
    return assigned(def.expr, defs, new Set([...seen, target]));
  }
  return new Set();
}

/** The TLA+ module and TLC configuration for a Quint main module, and the TLA+ names of its variables and actions in Quint's names. */
export interface Translation {
  readonly tla: string;
  readonly cfg: string;
  readonly variables: ReadonlyMap<string, string>;
  readonly names: ReadonlyMap<string, string>;
  /** Each invariant's TLA+ name, `q_inv_1` and so on, to the entry the caller gave. */
  readonly invariants: ReadonlyMap<string, string>;
}

/** Undefined and contested operations stop the check where a state reaches them. */
const PRELUDE = [
  `QTS__unsupported(QTS__why) == Assert(FALSE, "${MARKER} " \\o QTS__why)`,
  // Quint's language reference says `/` and `%` are TLA+'s \div and %, which floor; its evaluators truncate.
  // The two agree when the dividend is non-negative and the divisor positive.
  `QTS__div(QTS__a, QTS__b) == IF QTS__a >= 0 /\\ QTS__b > 0 THEN QTS__a \\div QTS__b ELSE QTS__unsupported("/ with a negative operand or a zero divisor")`,
  `QTS__mod(QTS__a, QTS__b) == IF QTS__a >= 0 /\\ QTS__b > 0 THEN QTS__a % QTS__b ELSE QTS__unsupported("% with a negative operand or a zero divisor")`,
  `QTS__get(QTS__f, QTS__k) == IF QTS__k \\in DOMAIN QTS__f THEN QTS__f[QTS__k] ELSE QTS__unsupported("get with a key the map lacks")`,
  `QTS__set(QTS__f, QTS__k, QTS__v) == IF QTS__k \\in DOMAIN QTS__f THEN [QTS__f EXCEPT ![QTS__k] = QTS__v] ELSE QTS__unsupported("set with a key the map lacks")`,
  // put sets the key's value, adding the key when the map lacks it.
  `QTS__put(QTS__f, QTS__k, QTS__v) == [QTS__x \\in DOMAIN QTS__f \\cup {QTS__k} |-> IF QTS__x = QTS__k THEN QTS__v ELSE QTS__f[QTS__x]]`,
];

/**
 * Translate `ir`, the JSON of `quint compile --target json`, checking each of `invariants`. The frontend
 * was given each entry as `and(<entry>)`, so `q::inv` is the `and` of one `and` per entry, and each
 * becomes its own definition and its own `INVARIANT` line, which is how the checker names the one that broke.
 */
export function translate(ir: Ex, invariants: readonly string[]): Translation {
  const main = ir.modules.find((m: Ex) => m.name === ir.main) ?? ir.modules[0];
  const vars = new Set<string>();
  const defs = new Map<string, Def>();
  for (const d of main.declarations) {
    if (d.kind === "var") vars.add(d.name);
    else if (d.kind === "const") throw new Unsupported(`the uninstantiated constant ${d.name}`);
    else if (d.kind === "def") defs.set(d.name, d);
    else if (d.kind !== "typedef") throw new Unsupported(`declaration kind ${d.kind}`);
  }
  for (const required of ["q::init", "q::step"]) {
    if (!defs.has(required)) throw new Unsupported(`no ${required}`);
  }
  const entries = invariantEntries(defs.get("q::inv"), invariants);
  if (vars.size === 0) throw new Unsupported("a module with no state variables");
  const reserved = [...vars, ...defs.keys()].find((n) => mangle(n).startsWith("QTS__"));
  if (reserved !== undefined) throw new Unsupported(`the name ${reserved}, whose prefix QTS__ quint-ts reserves for the names it generates`);
  // Name the first operator outside the subset before any other check, so the reason is the construct itself.
  for (const d of defs.values()) {
    const op = firstUnsupported(d.expr, defs);
    if (op !== undefined) throw new Unsupported(`operator ${op}`);
  }
  const step = assigned(defs.get("q::step").expr, defs);
  const missing = [...vars].filter((v) => !step.has(v));
  if (missing.length > 0) throw new Unsupported(`a step that doesn't assign ${missing.join(", ")} in every branch`);
  const counter = { n: 0 };
  const body: string[] = [];
  // Quint's frontend orders definitions so each follows what it uses, as TLA+ requires;
  // a definition's helpers go just before it, after what they use.
  for (const d of main.declarations.filter((x: Ex) => x.kind === "def")) {
    if (d.qualifier === "run" || d.qualifier === "temporal") throw new Unsupported(`the ${d.qualifier} definition ${d.name}`);
    if (d.name === "q::inv") continue;
    const mode = d.name === "q::init" ? "init" : d.qualifier === "action" ? "action" : "state";
    if (d.qualifier === "action" && d.name !== "q::init" && d.name !== "q::step" && onlyInInit(d.name, defs)) continue;
    const helpers: string[] = [];
    const ctx: Ctx = { defs, vars, mode, helpers, counter, locals: new Set() };
    const text = d.expr.kind === "lambda"
      ? `${mangle(d.name)}(${d.expr.params.map((p: Ex) => mangle(p.name)).join(", ")}) ==\n  ${expr(d.expr.expr, withLocals(ctx, d.expr.params.map((p: Ex) => p.name)))}`
      : `${mangle(d.name)} ==\n  ${mode === "init" ? initBody(d, [], ctx) : expr(d.expr, ctx)}`;
    body.push(...helpers, text);
  }
  // After every other definition: an invariant may use any of them.
  entries.forEach((entry, k) => {
    const helpers: string[] = [];
    const ctx: Ctx = { defs, vars, mode: "state", helpers, counter, locals: new Set() };
    const text = `${invariantName(k)} ==\n  ${expr(entry, ctx)}`;
    body.push(...helpers, text);
  });
  const tla = ["---- MODULE Q ----", "EXTENDS Integers, Sequences, FiniteSets, TLC", `VARIABLES ${[...vars].map(mangle).join(", ")}`,
    ...PRELUDE, ...body, "===="].join("\n\n");
  const short = (n: string): string => n.split("::").at(-1) ?? n;
  return {
    tla,
    cfg: ["INIT q_init", "NEXT q_step", ...invariants.map((_, k) => `INVARIANT ${invariantName(k)}`)].join("\n"),
    variables: new Map([...vars].map((v) => [mangle(v), short(v)])),
    names: new Map([...defs.keys()].map((n) => [mangle(n), short(n)])),
    invariants: new Map(invariants.map((entry, k) => [invariantName(k), entry])),
  };
}

/** The TLA+ name of the k-th invariant, counting from 0. */
const invariantName = (k: number): string => `q_inv_${k + 1}`;

/**
 * The expression of each invariant, taken from `q::inv`, which must be the `and` of one `and` per entry.
 * Quint reads an entry's top-level commas as arguments of `and`, so an entry such as `a), and(b` would
 * change the count, and the names with it: nothing is checked then, rather than the wrong invariants.
 */
function invariantEntries(inv: Def | undefined, invariants: readonly string[]): Ex[] {
  if (invariants.length === 0) return [];
  const body = inv?.expr;
  const wrapped: Ex[] | undefined = body?.kind === "app" && body.opcode === "and" ? body.args : undefined;
  if (wrapped === undefined || wrapped.length !== invariants.length || !wrapped.every((a) => a.kind === "app" && a.opcode === "and")) {
    throw new Unsupported(`invariants that Quint reads as ${wrapped?.length ?? 0} where ${invariants.length} were given, so the one that failed couldn't be named`);
  }
  return wrapped;
}

/** An action that only init uses is inlined there and not emitted: as an action it would hold primed equalities. */
function onlyInInit(n: string, defs: Map<string, Def>): boolean {
  const uses = (d: Def): boolean => JSON.stringify(d.expr).includes(JSON.stringify(n));
  const init = defs.get("q::init");
  return init !== undefined && uses(init) && ![...defs].some(([k, d]) => k !== "q::init" && k !== n && uses(d));
}
