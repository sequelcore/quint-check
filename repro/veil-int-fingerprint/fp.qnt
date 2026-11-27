module fp {
  var x: int
  action init = x' = 0
  // 2^62. Quint's int is unbounded, so this is a second, distinct state.
  action step = x' = 4611686018427387904
  val inv = x == 0
}
