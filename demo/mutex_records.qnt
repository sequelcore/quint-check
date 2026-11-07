// The correct model with the lock kept as a record. Quint accepts it, but
// records are outside quint-ts's subset, so quint-ts answers unsupported
// instead of a verdict.
module mutex_records {
  type Phase = Idle | Waiting | Critical

  pure val PROCS = Set("p1", "p2", "p3")

  var state: str -> Phase
  var lock: { free: bool, owner: str }

  action init = all {
    state' = PROCS.mapBy(_ => Idle),
    lock' = { free: true, owner: "" },
  }

  action request(p: str): bool = all {
    state.get(p) == Idle,
    state' = state.set(p, Waiting),
    lock' = lock,
  }

  action enter(p: str): bool = all {
    state.get(p) == Waiting,
    lock.free,
    state' = state.set(p, Critical),
    lock' = { free: false, owner: p },
  }

  action leave(p: str): bool = all {
    state.get(p) == Critical,
    state' = state.set(p, Idle),
    lock' = { free: true, owner: "" },
  }

  action step = {
    nondet p = oneOf(PROCS)
    any { request(p), enter(p), leave(p) }
  }

  // At most one process is in the critical section.
  val inv = PROCS.filter(p => state.get(p) == Critical).size() <= 1
}
