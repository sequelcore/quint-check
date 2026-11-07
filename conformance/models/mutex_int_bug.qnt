// The same model with a deliberate bug: enter doesn't check that the lock is free.
module mutex_int_bug {
  pure val PROCS = Set("p1", "p2", "p3")

  // 0: idle, 1: waiting, 2: in the critical section
  var state: str -> int
  var lockFree: bool

  action init = all {
    state' = PROCS.mapBy(_ => 0),
    lockFree' = true,
  }

  action request(p: str): bool = all {
    state.get(p) == 0,
    state' = state.set(p, 1),
    lockFree' = lockFree,
  }

  action enter(p: str): bool = all {
    state.get(p) == 1,
    state' = state.set(p, 2),
    lockFree' = false,
  }

  action leave(p: str): bool = all {
    state.get(p) == 2,
    state' = state.set(p, 0),
    lockFree' = true,
  }

  action step = {
    nondet p = oneOf(PROCS)
    any { request(p), enter(p), leave(p) }
  }

  // At most one process is in the critical section.
  val inv = PROCS.filter(p => state.get(p) == 2).size() <= 1
}
