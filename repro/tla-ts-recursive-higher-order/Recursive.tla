---- MODULE Recursive ----
EXTENDS Naturals
\* A recursive operator with an operator parameter, as Apalache's Apalache.tla defines ApaFoldSet.
RECURSIVE Fold(_, _, _)
Fold(Op(_, _), v, S) ==
  IF S = {} THEN v ELSE LET w == CHOOSE x \in S : TRUE IN Fold(Op, Op(v, w), S \ {w})
Add(a, b) == a + b
VARIABLE x
Init == x = Fold(Add, 0, {1, 2, 3})
Next == UNCHANGED x
Sum == x = 6
====
