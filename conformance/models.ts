/** The model corpus: each checked by quint-ts, compared as whole state graphs, and its counterexample checked against the graphs. */
export interface ModelCase {
  readonly id: string;
  readonly file: string;
  readonly main: string;
  readonly expect: "passed" | "violated" | "unsupported";
  /** The invariant to check; `inv` when unset. */
  readonly invariant?: string;
  /** Several invariants, in the order given, instead of `invariant`; the official route checks their conjunction. */
  readonly invariants?: readonly [string, ...string[]];
  /** For a violated case with `invariants`: the one the result names, which the simulator must also report as broken. */
  readonly names?: string;
  /** The IR opcodes the model exercises; the harness checks they appear in its IR. */
  readonly ops: readonly string[];
  readonly note: string;
}

export const MODEL_CASES: readonly ModelCase[] = [
  { id: "reserve", file: "conformance/models/reserve.qnt", main: "reserve3", expect: "passed",
    ops: ["assign", "actionAll", "actionAny", "mapBy", "get", "set", "fold", "forall", "igt", "igte"], note: "nondet client, two actions, instance with a constant" },
  { id: "reserve-overdraw", file: "conformance/models/reserve_overdraw.qnt", main: "reserve_overdraw3", expect: "violated",
    ops: ["assign", "actionAll", "actionAny"], note: "planted fault: the stock check allows -1" },
  { id: "tokens", file: "conformance/models/tokens.qnt", main: "tokens", expect: "passed",
    ops: ["assign", "actionAll", "actionAny", "filter", "map", "exists", "keys", "exclude", "subseteq", "size", "to", "implies", "iff", "ite", "idiv", "imod", "neq", "Map"],
    note: "two nondet choices, the second depending on the first; parameterized action" },
  { id: "tokens-double", file: "conformance/models/tokens_double.qnt", main: "tokens_double", expect: "violated",
    ops: ["assign", "ite", "set"], note: "planted fault: one transfer moves two tokens" },
  { id: "div-negative", file: "conformance/models/div_negative.qnt", main: "div_negative", expect: "unsupported",
    ops: ["idiv"], note: "reaches (-7) / 2, whose value Quint's sources disagree on" },
  // The mutex with integers for the phases; it also guards the translation of a `_` parameter, which Quint names without a letter.
  { id: "mutex-int", file: "conformance/models/mutex_int.qnt", main: "mutex_int", expect: "passed",
    ops: ["mapBy", "get", "set", "filter", "size", "ilte", "eq"], note: "three processes, one lock" },
  { id: "mutex-int-bug", file: "conformance/models/mutex_int_bug.qnt", main: "mutex_int_bug", expect: "violated",
    ops: ["mapBy", "get", "set"], note: "planted fault: enter doesn't check the lock" },
  // The demo (demo/): the same mutex with a sum type for the phases.
  { id: "demo-mutex", file: "demo/mutex.qnt", main: "mutex", expect: "passed",
    ops: ["variant", "mapBy", "get", "set", "filter", "size", "eq"], note: "variants without payload, compared and stored in a map" },
  { id: "demo-mutex-bug", file: "demo/mutex_bug.qnt", main: "mutex_bug", expect: "violated",
    ops: ["variant", "set"], note: "planted fault: enter doesn't check the lock" },
  // Quint's public play_rock_paper_scissors.qnt, with the invariant it declares, and a violation added by an importing module.
  { id: "public-rock-paper-scissors", file: "conformance/public/play_rock_paper_scissors.qnt", main: "play_rock_paper_scissors", invariant: "winInv",
    expect: "passed", ops: ["variant", "ite", "eq", "implies"], note: "Quint's examples: variants with and without payload, compared with ==; its own invariant" },
  // Quint's public ewd426.qnt and ewd426_3.qnt (Dijkstra's self-stabilizing token rings), with their authors' tokenInv.
  { id: "public-ewd426", file: "conformance/public/ewd426.qnt", main: "ewd426", invariant: "tokenInv", expect: "passed",
    ops: ["setOfMaps", "get", "set", "ite"], note: "Quint's examples: N = 5, K = 7; 117,649 states" },
  { id: "public-broken-ewd426", file: "conformance/public/ewd426.qnt", main: "broken_ewd426", invariant: "tokenInv", expect: "passed",
    ops: ["setOfMaps"], note: "Quint's examples: N = 3, K = 2; tokenInv still holds there" },
  { id: "public-ewd426-3", file: "conformance/public/ewd426_3.qnt", main: "ewd426_3", invariant: "tokenInv", expect: "passed",
    ops: ["setOfMaps", "get"], note: "Quint's examples: the three-state ring, N = 5" },
  // Quint's public secret_santa.qnt with its author's inv, which Quint's own route also finds broken.
  { id: "public-secret-santa", file: "conformance/public/games/secret-santa/secret_santa.qnt", main: "quint_team_secret_santa", invariant: "inv",
    expect: "violated", ops: ["put", "Map", "variant", "matchVariant"], note: "Quint's examples: imports spells/basicSpells.qnt; a self-assignment is reachable" },
  { id: "public-rock-paper-scissors-draw", file: "conformance/public/play_rock_paper_scissors_check.qnt", main: "rps_no_draw", expect: "violated",
    ops: ["variant", "neq"], note: "Quint's examples: a draw is reachable" },
  // Quint's public booleans.qnt, unchanged, with invariants added by an importing module (conformance/public/).
  { id: "public-booleans-holds", file: "conformance/public/booleans_check.qnt", main: "booleans_holds", expect: "passed",
    ops: ["or", "and", "implies", "iff", "eq", "neq", "not", "assign", "actionAll"], note: "Quint's examples: booleans.qnt; b or not(b) holds" },
  { id: "public-booleans-flips", file: "conformance/public/booleans_check.qnt", main: "booleans_flips", expect: "violated",
    ops: ["not", "assign", "actionAll"], note: "Quint's examples: booleans.qnt; b breaks after the first step" },
  // Several invariants: a result names the first one, in the order given, that the first violating state breaks.
  { id: "invariants-same-state", file: "conformance/models/invariants.qnt", main: "invariants", invariants: ["below2", "doubleBelow4"], names: "below2",
    expect: "violated", ops: ["ilt"], note: "both invariants break at x = 2: the first given is named" },
  { id: "invariants-same-state-reversed", file: "conformance/models/invariants.qnt", main: "invariants", invariants: ["doubleBelow4", "below2"], names: "doubleBelow4",
    expect: "violated", ops: ["ilt"], note: "the same state with the order reversed: the other one is named" },
  { id: "invariants-only-second", file: "conformance/models/invariants.qnt", main: "invariants", invariants: ["nonNegative", "below3"], names: "below3",
    expect: "violated", ops: ["ilt"], note: "only the second breaks" },
  { id: "invariants-first-fails-later", file: "conformance/models/invariants.qnt", main: "invariants", invariants: ["below4", "below2"], names: "below2",
    expect: "violated", ops: ["ilt"], note: "the first given breaks later (x = 4) than the second (x = 2): the one at the first violating state is named" },
  { id: "invariants-all-hold", file: "conformance/models/invariants.qnt", main: "invariants", invariants: ["nonNegative", "atMostFive", "x >= 0 and x <= 5"], expect: "passed",
    ops: ["ilte", "igte", "and"], note: "three invariants, all hold in every state" },
  // An init that reads a state variable: Quint's evaluators reject the read (QNT502), TLC solves it as an equation.
  { id: "init-reads-after", file: "conformance/models/init_reads.qnt", main: "init_reads_after", expect: "unsupported",
    ops: ["assign", "actionAll", "iadd"], note: "x is read after its assignment" },
  { id: "init-reads-before", file: "conformance/models/init_reads.qnt", main: "init_reads_before", expect: "unsupported",
    ops: ["assign", "actionAll", "iadd"], note: "x is read before its assignment" },
  { id: "init-reads-definition", file: "conformance/models/init_reads.qnt", main: "init_reads_definition", expect: "unsupported",
    ops: ["assign", "actionAll", "plus"], note: "x is read through two definitions" },
  { id: "init-reads-nondet", file: "conformance/models/init_reads.qnt", main: "init_reads_nondet", expect: "unsupported",
    ops: ["assign", "actionAll", "Set"], note: "x is read in a nondet choice" },
  { id: "init-reads-any", file: "conformance/models/init_reads.qnt", main: "init_reads_any", expect: "unsupported",
    ops: ["assign", "actionAny"], note: "x is read in a branch of any; Quint's evaluators disagree on it" },
  { id: "init-assigns", file: "conformance/models/init_reads.qnt", main: "init_assigns", expect: "passed",
    ops: ["assign", "actionAll", "Set", "iadd", "ite"], note: "only assignments and nondet choices over constants" },
  { id: "init-unreached-read", file: "conformance/models/init_reads.qnt", main: "init_unreached_read", expect: "passed",
    ops: ["assign", "ite"], note: "a read in a branch init never takes, which Quint's evaluators skip too" },
  // Distinct Quint names that would become one TLA+ name, since `::` becomes `_`: refused at translation.
  { id: "collisions-instances", file: "conformance/models/collisions.qnt", main: "collisions_instances", expect: "unsupported",
    ops: ["assign", "actionAll"], note: "a::b_c and a_b::c" },
  { id: "collisions-variable", file: "conformance/models/collisions.qnt", main: "collisions_variable", expect: "unsupported",
    ops: ["assign", "actionAll"], note: "the instance's a::x and the module's a_x" },
  { id: "collisions-generated", file: "conformance/models/collisions.qnt", main: "collisions_generated", expect: "unsupported",
    ops: ["assign"], note: "the model's q_step and the generated q::step" },
  { id: "collisions-invariant", file: "conformance/models/collisions.qnt", main: "collisions_invariant", expect: "unsupported",
    ops: ["assign"], note: "the model's q_inv_1 and the first invariant's name" },
  { id: "collisions-bound", file: "conformance/models/collisions.qnt", main: "collisions_bound", expect: "passed",
    ops: ["exists", "or", "igte"], note: "a bound a_lim beside a::lim: Quint's flattener renames the local, so nothing collides" },
];
