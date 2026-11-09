// A queue between a sender and a receiver: the sender appends 0, 1 and 2 in
// order, and the receiver takes from the front, so it receives them in order.
module fifo {
  var queue: List[int]
  var sent: int
  var received: List[int]

  action init = all { queue' = [], sent' = 0, received' = [] }

  action send = all {
    sent < 3,
    queue' = queue.append(sent),
    sent' = sent + 1,
    received' = received,
  }

  action receive = all {
    queue.length() > 0,
    queue' = queue.tail(),
    received' = received.append(queue.head()),
    sent' = sent,
  }

  action step = any { send, receive }

  // What was received is 0, 1, ... in order, and the queue holds the next ones.
  val inv = and {
    received.indices().forall(i => received[i] == i),
    queue.indices().forall(i => queue[i] == received.length() + i),
    received.length() + queue.length() == sent,
  }
}

// A planted fault: the receiver takes from the back of the queue.
module fifo_back {
  var queue: List[int]
  var sent: int
  var received: List[int]

  action init = all { queue' = [], sent' = 0, received' = [] }

  action send = all {
    sent < 3,
    queue' = queue.append(sent),
    sent' = sent + 1,
    received' = received,
  }

  action receive = all {
    queue.length() > 0,
    queue' = queue.concat([]).tail(),
    received' = received.append(queue[queue.length() - 1]),
    sent' = sent,
  }

  action step = any { send, receive }

  val inv = received.indices().forall(i => received[i] == i)
}
