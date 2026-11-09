// Invariants for Quint's public booleans.qnt, which declares none. Not part of Quint's examples:
// written for quint-check's conformance, importing booleans.qnt unchanged.

// b alternates between true and false, so this holds in both reachable states.
module booleans_holds {
  import booleans.* from "./booleans"
  val inv = b or not(b)
}

// The first step makes b false, so this breaks in the second state.
module booleans_flips {
  import booleans.* from "./booleans"
  val inv = b
}
