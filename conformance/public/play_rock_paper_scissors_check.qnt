// A planted violation for Quint's public play_rock_paper_scissors.qnt. Not
// part of Quint's examples: written for quint-ts's conformance, importing the
// model unchanged. A draw is reachable, so this invariant breaks.
module rps_no_draw {
  import rock_paper_scissors(PLAYER1 = "Mahtab", PLAYER2 = "Gabriela").* from "./play_rock_paper_scissors"
  val inv = status != Draw
}
