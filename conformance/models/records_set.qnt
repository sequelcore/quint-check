// Records in a set and in a variant's payload, so states hold sets whose order follows their records' fields.
module records_set {
  type Msg = { src: str, n: int }
  type Event = Sent({ to: str, n: int }) | Idle
  var msgs: Set[Msg]
  var last: Event

  action init = all {
    msgs' = Set(),
    last' = Idle,
  }
  action send(s: str, k: int): bool = all {
    msgs.size() < 3,
    msgs' = msgs.union(Set({ src: s, n: k })),
    last' = Sent({ to: s, n: k }),
  }
  action step = {
    nondet s = Set("a", "b").oneOf()
    nondet k = 1.to(2).oneOf()
    send(s, k)
  }

  val wellFormed = msgs.forall(m => m.fieldNames() == Set("src", "n") and m.n >= 1)
    and (match last { | Sent(e) => { src: e.to, n: e.n }.in(msgs) | Idle => msgs == Set() })
  val inv = wellFormed
  // Broken once a sends twice.
  val atMostOneFromA = msgs.filter(m => m.src == "a").size() <= 1
}
