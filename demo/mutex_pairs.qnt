// The mutex, with its invariant stated over every pair of processes, taken
// from `powerset`. `powerset` is outside quint-check's subset, so it refuses
// the model rather than guess.
module mutex_pairs {
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
    lockFree,
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

  // No two processes are in the critical section at once.
  val inv = PROCS.powerset().forall(pair => pair.size() == 2 implies not(pair.forall(p => state.get(p) == Critical)))
}
