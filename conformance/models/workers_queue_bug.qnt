// The same model with a deliberate bug: acquire doesn't check that the lock is free.
module workers_queue_bug {
  type Worker = { id: str, holding: bool, job: int }
  val WORKERS = Set("w1", "w2")
  val JOBS = Set(1, 2, 3)
  var queue: Set[int]
  var lock: str
  var workers: str -> Worker
  var done: Set[int]

  action init = all {
    queue' = JOBS,
    lock' = "",
    workers' = WORKERS.mapBy(w => { id: w, holding: false, job: 0 }),
    done' = Set(),
  }
  action acquire(w) = all {
    queue != Set(),
    nondet j = queue.oneOf()
    all {
      lock' = w,
      queue' = queue.exclude(Set(j)),
      workers' = workers.set(w, { ...workers.get(w), holding: true, job: j }),
      done' = done,
    }
  }
  action finish(w) = all {
    lock == w,
    workers.get(w).holding,
    lock' = "",
    done' = done.union(Set(workers.get(w).job)),
    workers' = workers.set(w, { ...workers.get(w), holding: false, job: 0 }),
    queue' = queue,
  }
  action step = { nondet w = WORKERS.oneOf() any { acquire(w), finish(w) } }
  val mutualExclusion = WORKERS.filter(w => workers.get(w).holding).size() <= 1
  val noLostJob = queue.union(done).union(WORKERS.map(w => workers.get(w).job).exclude(Set(0))) == JOBS
  val inv = mutualExclusion and noLostJob
}
