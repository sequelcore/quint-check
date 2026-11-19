// An init that no state satisfies: for a check that must not claim more than an empty search shows.
module no_init {
  var x: int
  val impossible = 1 > 2
  action init = all { impossible, x' = 0 }
  action step = x' = x
  val nonNegative = x >= 0
}
