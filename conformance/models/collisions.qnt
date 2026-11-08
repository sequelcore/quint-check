// Distinct Quint names that the translation would flatten into one TLA+
// name, since `::` becomes `_`. Each must be refused at translation.
module collisions_m {
  var b_c: int
  var x: int
  val lim = 5
  action init = all { b_c' = 0, x' = 0 }
  action step = all { b_c' = if (b_c < 3) b_c + 1 else b_c, x' = x }
}

module collisions_n {
  var c: int
  action init = c' = 100
  action step = c' = c
}

// a::b_c and a_b::c both become a_b_c.
module collisions_instances {
  import collisions_m as a
  import collisions_n as a_b
  action init = all { a::init, a_b::init }
  action step = all { a::step, a_b::step }
  val inv = a::b_c < 3 and a_b::c == 100
}

// The instance's a::x and the module's own a_x both become a_x.
module collisions_variable {
  import collisions_m as a
  var a_x: int
  action init = all { a::init, a_x' = 0 }
  action step = all { a::step, a_x' = a_x + 2 }
  val inv = a::x == a_x
}

// The model's q_step and the step quint-ts generates from it, q::step.
module collisions_generated {
  var x: int
  action q_step = x' = x
  action init = x' = 0
  action step = x' = x + 1
  val inv = x < 2
}

// The model's q_inv_1 and the name quint-ts gives the first invariant.
module collisions_invariant {
  var x: int
  val q_inv_1 = x >= 0
  action init = x' = 0
  action step = x' = x + 1
  val inv = x < 2
}

// A bound name, a_lim, beside the instance's definition a::lim: Quint's
// flattener renames every local (a_lim becomes a_lim_<id>), so the two don't
// collide and the model is checked (and passes).
module collisions_bound {
  import collisions_m as a
  var y: int
  action init = all { a::init, y' = 10 }
  action step = all { a::step, y' = y }
  val inv = Set(1).exists(a_lim => a_lim > 3) or y >= a::lim
}
