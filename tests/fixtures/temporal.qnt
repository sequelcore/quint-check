// A temporal property: outside the MVP.
module temp {
  var x: int
  action init = x' = 0
  action step = x' = if (x < 3) x + 1 else x
  val inv = x <= 3
  temporal reaches = eventually(x == 3)
}
