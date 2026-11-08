// The correct model with the lock kept as a tuple. Quint accepts it, but
// tuples are outside quint-ts's subset, so quint-ts answers unsupported
// instead of a verdict.
module mutex_tuple {
  type Phase = Idle | Waiting | Critical

  pure val PROCS = Set("p1", "p2", "p3")

  var state: str -> Phase
  // (free, owner)
  var lock: (bool, str)

  action init = all {
    state' = PROCS.mapBy(_ => Idle),
    lock' = (true, ""),
  }

  action request(p: str): bool = all {
    state.get(p) == Idle,
    state' = state.set(p, Waiting),
    lock' = lock,
  }

  action enter(p: str): bool = all {
    state.get(p) == Waiting,
    lock._1,
    state' = state.set(p, Critical),
    lock' = (false, p),
  }

  action leave(p: str): bool = all {
    state.get(p) == Critical,
    state' = state.set(p, Idle),
    lock' = (true, ""),
  }

  action step = {
    nondet p = oneOf(PROCS)
    any { request(p), enter(p), leave(p) }
  }

  // At most one process is in the critical section.
  val inv = PROCS.filter(p => state.get(p) == Critical).size() <= 1
}
