// Planted fault: reserving allows stock down to -1, so stock goes negative.
module reserve_overdraw {
  const STOCK: int
  pure val CLIENTS = Set("a", "b", "c")

  var stock: int
  var held: str -> int

  action init = all {
    stock' = STOCK,
    held' = CLIENTS.mapBy(_ => 0),
  }

  action doReserve(c: str): bool = all {
    stock > -2,
    stock' = stock - 1,
    held' = held.set(c, held.get(c) + 1),
  }

  action doRelease(c: str): bool = all {
    held.get(c) > 0,
    stock' = stock + 1,
    held' = held.set(c, held.get(c) - 1),
  }

  action step = {
    nondet c = oneOf(CLIENTS)
    any {
      doReserve(c),
      doRelease(c),
    }
  }

  val conserved = stock + CLIENTS.fold(0, (sum, c) => sum + held.get(c)) == STOCK
  val neverNegative = stock >= 0 and CLIENTS.forall(c => held.get(c) >= 0)
  val inv = conserved and neverNegative
}

module reserve_overdraw3 {
  import reserve_overdraw(STOCK = 3).*
}
