// A counter that stops at 5, with invariants that break at different states: for the order in
// which a result names the invariant that failed.
module invariants {
  var x: int

  action init = x' = 0
  action step = x' = if (x < 5) x + 1 else x

  val nonNegative = x >= 0
  val atMostFive = x <= 5
  // Both break at x = 2, the first violating state.
  val below2 = x < 2
  val doubleBelow4 = 2 * x < 4
  // below3 breaks at x = 3 and below4 at x = 4.
  val below3 = x < 3
  val below4 = x < 4
}
