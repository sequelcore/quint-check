// retry_idempotent with a planted fault: the server remembers which
// messages it applied, not which requests, so a retried copy of a request
// it already applied is applied again.
module retry_idempotent_bug {
  pure val IDS = Set(1, 2)
  pure val MAX_ATTEMPTS = 2
  pure val MESSAGES = tuples(IDS, 1.to(MAX_ATTEMPTS))

  // Copies sent and not yet delivered, as (id, attempt).
  var inflight: Set[(int, int)]
  var attempts: int -> int
  // The copies that were applied, as (id, attempt).
  var applied: Set[(int, int)]

  action init = all {
    inflight' = Set(),
    attempts' = IDS.mapBy(_ => 0),
    applied' = Set(),
  }

  action send(id: int): bool = all {
    attempts.get(id) < MAX_ATTEMPTS,
    val msg = (id, attempts.get(id) + 1)
    all {
      inflight' = inflight.union(Set(msg)),
      attempts' = attempts.set(id, msg._2),
      applied' = applied,
    },
  }

  action deliver = all {
    inflight != Set(),
    nondet msg = inflight.oneOf()
    all {
      inflight' = inflight.exclude(Set(msg)),
      applied' = if (applied.contains(msg)) applied else applied.union(Set(msg)),
      attempts' = attempts,
    },
  }

  action step = any {
    { nondet id = IDS.oneOf() send(id) },
    deliver,
  }

  // Each request is applied at most once.
  val atMostOnce = IDS.forall(id => applied.filter(((i, _)) => i == id).size() <= 1)
  // Every copy in flight or applied was sent.
  val onlySent = inflight.union(applied).forall(((id, attempt)) => attempt >= 1 and attempt <= attempts.get(id))
  val wellFormed = inflight.union(applied).subseteq(MESSAGES)
  val inv = atMostOnce and onlySent and wellFormed
}
