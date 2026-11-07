module setkey {
  var m: int -> int
  action init = m' = Map(1 -> 0)
  // Quint's builtin.qnt: "If `k` is not a key in `m`, this operator has undefined behavior."
  action step = m' = m.set(2, 5)
  val inv = true
}
