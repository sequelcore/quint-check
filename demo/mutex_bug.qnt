// The same model with a deliberate bug: enter doesn't check that the lock is free.
module mutex_bug {
  type Phase = Idle | Waiting | Critical

  pure val PROCS = Set("p1", "p2", "p3")

  var state: str -> Phase
  var lockFree: bool

  action init = all {
    state' = PROCS.mapBy(_ => Idle),
    lockFree' = true,
  }

  action request(p: str): bool = all {
    state.get(p) == Idle,
    state' = state.set(p, Waiting),
    lockFree' = lockFree,
  }

  action enter(p: str): bool = all {
    state.get(p) == Waiting,
    state' = state.set(p, Critical),
    lockFree' = false,
  }

  action leave(p: str): bool = all {
    state.get(p) == Critical,
    state' = state.set(p, Idle),
    lockFree' = true,
  }

  action step = {
    nondet p = oneOf(PROCS)
    any { request(p), enter(p), leave(p) }
  }

  // At most one process is in the critical section.
  val inv = PROCS.filter(p => state.get(p) == Critical).size() <= 1
}
