// Negative integer division: Quint's evaluators truncate toward zero (-3);
// its language reference says `/` is TLA+'s \div, which floors (-4).
module div_negative {
  var x: int
  action init = x' = 0
  action step = x' = (-7) / 2
  val inv = x == 0 or x == -3
}
