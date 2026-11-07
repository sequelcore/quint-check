module in_range {
  var x: int
  pure def inRange(v: int, hi: int): bool = v <= hi
  action init = x' = 0
  action step = x' = if (x < 3) x + 1 else x
}
