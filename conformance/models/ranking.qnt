// A ranking of four players, kept as a list from first to last. A match lets
// a player overtake the one just above; the leaderboard is the players whose
// score passes a threshold, in rank order.
module ranking {
  pure val PLAYERS = range(0, 4)

  var order: List[int]
  var scores: List[int]

  action init = all { order' = PLAYERS, scores' = PLAYERS.foldl([], (acc, _p) => acc.append(0)) }

  action overtake(i: int): bool = all {
    scores[order[i + 1]] < 2,
    order' = order.replaceAt(i, order[i + 1]).replaceAt(i + 1, order[i]),
    scores' = scores.replaceAt(order[i + 1], scores[order[i + 1]] + 1),
  }

  action step = {
    nondet i = 0.to(2).oneOf()
    overtake(i)
  }

  val leaders = order.select(p => scores[p] >= 1)

  val inv = and {
    // The order is a permutation of the players.
    order.length() == 4,
    PLAYERS.foldl(true, (ok, p) => ok and order.indices().exists(i => order[i] == p)),
    // The leaderboard keeps rank order and holds only players who scored.
    leaders.indices().forall(i => scores[leaders[i]] >= 1),
    order.foldl(0, (n, p) => if (scores[p] >= 1) n + 1 else n) == leaders.length(),
    // The top two are the first two of the order.
    order.slice(0, 2) == [order[0], order[1]],
  }

  // A planted fault: the leaderboard never fills up.
  val fewLeaders = leaders.length() < 4
}
