// Invariants for Quint's public tuples.qnt, which declares none. Not part of Quint's examples:
// written for quint-check's conformance, importing tuples.qnt unchanged.

// The step keeps myTup's first item and takes the second from (1, "world"), and the
// definitions unpack tuples, so this holds in both reachable states.
module tuples_holds {
  import tuples.* from "./tuples"
  val inv = and {
    myTup._1 == 0,
    myTup._2.in(Set("hello", "world")),
    combined == (true, 2),
    a == Set(5),
    m.get((1, 3)) == 4 and m.get((3, 1)) == 4 and m.keys().size() == 9,
    n.get((1, 2, 3)) == 6 and n.keys().size() == 27,
  }
}

// The first step replaces "hello" with "world", so this breaks in the second state.
module tuples_changes {
  import tuples.* from "./tuples"
  val inv = myTup == (0, "hello")
}
