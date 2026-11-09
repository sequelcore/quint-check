// The correct model with the lock kept as a list of its holder, empty when
// free. Quint accepts it, but lists are outside quint-check's subset, so
// quint-check answers unsupported instead of a verdict.
module mutex_list {
  type Phase = Idle | Waiting | Critical

  pure val PROCS = Set("p1", "p2", "p3")

  var state: str -> Phase
  // [] when free, [owner] when held
  var lock: List[str]

  action init = all {
    state' = PROCS.mapBy(_ => Idle),
    lock' = [],
  }

  action request(p: str): bool = all {
    state.get(p) == Idle,
    state' = state.set(p, Waiting),
    lock' = lock,
  }

  action enter(p: str): bool = all {
    state.get(p) == Waiting,
    lock.length() == 0,
    state' = state.set(p, Critical),
    lock' = [p],
  }

  action leave(p: str): bool = all {
    state.get(p) == Critical,
    state' = state.set(p, Idle),
    lock' = [],
  }

  action step = {
    nondet p = oneOf(PROCS)
    any { request(p), enter(p), leave(p) }
  }

  // At most one process is in the critical section.
  val inv = PROCS.filter(p => state.get(p) == Critical).size() <= 1
}
