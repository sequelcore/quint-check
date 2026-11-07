---- MODULE NonRecursive ----
EXTENDS Naturals
\* Control: the same operator parameter without RECURSIVE.
Apply(Op(_, _), a, b) == Op(a, b)
Add(a, b) == a + b
VARIABLE x
Init == x = Apply(Add, 1, 5)
Next == UNCHANGED x
Sum == x = 6
====
