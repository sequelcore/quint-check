// An unbounded counter: explicit-state search never finishes.
module unbounded {
  var x: int
  action init = x' = 0
  action step = x' = x + 1
  val inv = x >= 0
}
