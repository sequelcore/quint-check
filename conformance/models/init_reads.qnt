// An init that reads a state variable. Quint's evaluators reject the read
// (QNT502, "Variable x not set") whichever order the assignments come in,
// while TLC reads `x = 0 /\ y = x + 1` as equations and solves it, so the
// routes disagree. quint-check refuses a read init evaluates, never passes it.
module init_reads_after {
  var x: int
  var y: int
  action init = all { x' = 0, y' = x + 1 }
  action step = all { x' = x, y' = y }
  val inv = y == 1
}

module init_reads_before {
  var x: int
  var y: int
  action init = all { y' = x + 1, x' = 0 }
  action step = all { x' = x, y' = y }
  val inv = y == 1
}

// The read is two definitions away from init.
module init_reads_definition {
  var x: int
  var y: int
  def plus(a) = a + x
  val following = plus(1)
  action init = all { x' = 0, y' = following }
  action step = all { x' = x, y' = y }
  val inv = y == 1
}

module init_reads_nondet {
  var x: int
  var y: int
  action init = all { x' = 0, nondet v = oneOf(Set(x, 1)) y' = v }
  action step = all { x' = x, y' = y }
  val inv = y >= 0
}

module init_reads_any {
  var x: int
  var y: int
  action init = all { x' = 0, any { y' = 1, y' = x } }
  action step = all { x' = x, y' = y }
  val inv = y >= 0
}

// Only assignments, nondet choices over constants and definitions that read
// no state variable: every route agrees.
module init_assigns {
  var x: int
  var y: int
  val base = 3
  def plus(a) = a + base
  action init = all { x' = 0, nondet v = oneOf(Set(1, plus(2))) y' = v }
  action step = all { x' = x, y' = if (y < 5) y + 1 else y }
  val inv = y >= 1 and y <= 5
}

// A read in a branch init never takes: Quint's evaluators skip it, as TLC
// does, so it is no read and the model passes.
module init_unreached_read {
  var x: int
  var y: int
  action init = all { x' = 0, if (true) y' = 1 else y' = x }
  action step = all { x' = x, y' = y }
  val inv = y == 1
}
