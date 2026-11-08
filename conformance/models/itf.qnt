// Counterexamples whose values TLA+ prints alike but Quint's ITF tells apart. Each module breaks its
// invariant after one step, so its counterexample holds every value below twice, and stays finite,
// so its whole state graph can be compared.

// A map with one string key prints as the variant with that label; a map with keys 1..n as a sequence;
// the empty map as the empty sequence.
module itf_maps {
  type V = A(int) | B
  var m: str -> int
  var o: V
  var seqLike: int -> str
  var empty: str -> int
  var unit: V
  action init = all {
    m' = Map("A" -> 1),
    o' = A(1),
    seqLike' = 1.to(3).mapBy(i => "b"),
    empty' = Map(),
    unit' = B,
  }
  action step = all { m' = m.put("A", 2), o' = A(2), seqLike' = seqLike, empty' = empty, unit' = unit }
  val inv = m.get("A") == 1
}

// Empty sets, sets of sets, and sets the checker holds lazily: an interval, a set of maps, a product.
module itf_sets {
  var none: Set[int]
  var nested: Set[Set[int]]
  var interval: Set[int]
  var maps: Set[int -> bool]
  var pairs: Set[(int, str)]
  var n: int
  action init = all {
    none' = Set(),
    nested' = Set(Set(), Set(1, 2), Set(3)),
    interval' = 1.to(3),
    maps' = Set(1, 2).setOfMaps(Set(true, false)),
    pairs' = tuples(Set(1, 2), Set("x", "y")),
    n' = 0,
  }
  action step = all { none' = none, nested' = nested, interval' = interval, maps' = maps, pairs' = pairs, n' = if (n < 1) n + 1 else n }
  val inv = n == 0
}

// Integers at the ends of the checker's 32-bit range, and a negative payload.
module itf_ints {
  type P = Debt(int) | Clear
  var big: int
  var small: int
  var p: P
  action init = all { big' = 2147483646, small' = -2147483647, p' = Debt(-5) }
  action step = all {
    big' = if (big < 2147483647) big + 1 else big,
    small' = if (small > -2147483647) small - 1 else small,
    p' = Clear,
  }
  val inv = big < 2147483647
}

// Strings outside ASCII, and one with an apostrophe. Quint's string literals have no escapes.
module itf_strings {
  var s: str
  var names: str -> int
  action init = all { s' = "it's", names' = Map("café" -> 1, "日本" -> 2) }
  action step = all { s' = "ünïcode ✓", names' = names }
  val inv = s == "it's"
}

// Records, tuples and a variant with a record payload, nested in a map.
module itf_structures {
  type Msg = Req({ id: int, from: str }) | Ack(int)
  var r: { a: int, b: Set[str] }
  var t: (int, str, bool)
  var inbox: str -> Msg
  action init = all { r' = { a: 1, b: Set("x") }, t' = (1, "one", true), inbox' = Map("p" -> Req({ id: 1, from: "q" })) }
  action step = all { r' = r.with("a", 2), t' = (2, "two", false), inbox' = inbox.set("p", Ack(1)) }
  val inv = r.a == 1
}

module itf_counter {
  const LIMIT: int
  var x: int
  action init = x' = 0
  action step = x' = if (x < LIMIT) x + 1 else x
  val small = x < LIMIT
}

// Two instances of one module: each has its own x, which a counterexample keeps apart by its full name.
module itf_instances {
  import itf_counter(LIMIT = 1) as a
  import itf_counter(LIMIT = 5) as b
  action init = all { a::init, b::init }
  action step = all { a::step, b::step }
  val inv = a::small and b::small
}
