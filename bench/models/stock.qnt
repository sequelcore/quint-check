// Stock reservation, scaled by its constants. Benchmarks only: the shape of
// conformance/models/reserve.qnt with the clients a constant too.
module stock {
  const STOCK: int
  const CLIENTS: Set[str]
  // How low reserving may take the stock: 0 is correct, below 0 plants the fault.
  const FLOOR: int

  var stock: int
  var held: str -> int

  action init = all {
    stock' = STOCK,
    held' = CLIENTS.mapBy(_ => 0),
  }

  action doReserve(c: str): bool = all {
    stock > FLOOR,
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

// About 1.8 thousand states.
module stock_small {
  import stock(STOCK = 12, CLIENTS = Set("a", "b", "c", "d"), FLOOR = 0).*
}

// About 46 thousand states.
module stock_large {
  import stock(STOCK = 30, CLIENTS = Set("a", "b", "c", "d"), FLOOR = 0).*
}

// The fault 31 steps deep: the stock reaches -1 only after every unit is reserved.
module stock_deep_fault {
  import stock(STOCK = 30, CLIENTS = Set("a", "b", "c", "d"), FLOOR = -2).*
}
