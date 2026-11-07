module fold {
  var x: int
  // Quint's builtin.qnt: fold's operator "must be associative and commutative or else it has undefined behavior."
  action init = x' = Set(1, 2, 3).fold(0, (acc, i) => acc * 10 + i)
  action step = x' = x
  val inv = x == 123
}
