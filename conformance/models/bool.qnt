// Two lights, each on or off, chosen from Bool. A step flips one light, or
// sets the switch to a value chosen from Bool, at most three times.
module bool_lights {
  var lights: int -> bool
  var master: bool
  var flips: int

  action init = all {
    nondet start = Set(1, 2).setOfMaps(Bool).oneOf()
    nondet m = Bool.oneOf()
    all { lights' = start, master' = m, flips' = 0 },
  }

  action flip = nondet i = Set(1, 2).oneOf()
    all { lights' = lights.set(i, not(lights.get(i))), master' = master, flips' = flips + 1 }

  action toggle = nondet m = Bool.oneOf()
    all { lights' = lights, master' = m, flips' = flips + 1 }

  action step = all { flips < 3, any { flip, toggle } }

  // Holds: every value stays in Bool, and the count stays bounded.
  val inv = lights.keys() == Set(1, 2) and Set(1, 2).forall(i => lights.get(i).in(Bool)) and master.in(Bool) and flips <= 3
  // Breaks: a state where both lights are on and the switch is off is reachable.
  val notAllOnWhileOff = not(Set(1, 2).forall(i => lights.get(i)) and not(master))
}
