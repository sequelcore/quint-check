module mod {
  var x: int
  action init = x' = 0
  action step = x' = (-7) % 2
  // Holds if % takes the dividend's sign (-1); breaks if it is TLA+'s % (1).
  val inv = x == 0 or x == -1
}
