module repeated {
  var x: int
  // Quint's documentation gives no rule for a key that appears twice in a Map literal.
  action init = x' = Map(1 -> 0, 1 -> 2).get(1)
  action step = x' = x
  val inv = x == 2
}
