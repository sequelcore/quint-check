// Tokens move between owners, one per move, for at most three moves.
module tokens {
  pure val OWNERS = Set("a", "b", "c")
  pure val TOKENS = 1.to(4)
  pure val START = Map(1 -> "a", 2 -> "a", 3 -> "b", 4 -> "c")
  pure val LIMIT = 3

  var owner: int -> str
  var moves: int

  def held(o: str): Set[int] = TOKENS.filter(t => owner.get(t) == o)
  val changed = TOKENS.filter(t => owner.get(t) != START.get(t)).size()

  action init = all {
    owner' = START,
    moves' = 0,
  }

  action transfer(t: int, o: str): bool = all {
    moves < LIMIT,
    owner.get(t) != o,
    owner' = owner.set(t, o),
    moves' = moves + 1,
  }

  action idle = all {
    moves >= LIMIT,
    owner' = owner,
    moves' = moves,
  }

  action step = any {
    nondet t = oneOf(TOKENS)
    nondet o = oneOf(OWNERS.exclude(Set(owner.get(t))))
    transfer(t, o),
    idle,
  }

  val conserved = owner.keys() == TOKENS and OWNERS.fold(0, (sum, o) => sum + held(o).size()) == TOKENS.size()
  val counted = changed <= moves and (moves / 2) * 2 + moves % 2 == moves
  val sizes = OWNERS.map(o => held(o).size()).subseteq(0.to(4)) and OWNERS.exists(o => held(o).size() >= 1)
  val startsAtStart = ((moves == 0) implies (owner == START and changed == 0)) and ((moves >= LIMIT) iff not(moves < LIMIT))
  val bounded = (if (moves <= LIMIT) true else false) and moves >= 0 and not(moves > LIMIT)
  val inv = conserved and counted and sizes and startsAtStart and bounded
}
