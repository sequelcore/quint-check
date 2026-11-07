module div {
  var x: int
  action init = x' = 0
  action step = x' = (-7) / 2
  // Holds if / truncates toward zero (-3); breaks if it floors like TLA+'s \div (-4).
  val inv = x == 0 or x == -3
}
