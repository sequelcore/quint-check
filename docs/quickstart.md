# Quickstart

In this quickstart, we install quint-check into a new project and check the
three demo models it ships with. Each one gets a different answer: a pass, a
violation with its counterexample, and a refusal.

You need Node 24 or later. You don't need Java or Bun.

## Install the package

Create a project and install quint-check into it:

```sh
mkdir quint-check-demo
cd quint-check-demo
npm init -y
npm install @sequelcore/quint-check@alpha
```

The demo models are in `node_modules/@sequelcore/quint-check/demo/`. In all
three, three processes share one lock, and the invariant `inv` says at most
one process is in the critical section.

## Check the correct model

```sh
npx quint-check check node_modules/@sequelcore/quint-check/demo/mutex.qnt --main mutex --invariant inv
```

quint-check explores every reachable state and finds `inv` true in each:

```text
search: complete, 20 distinct states from 1 initial state; deadlock not checked
checked with quint 0.33.1 and tla-ts 0.0.9
passed: inv holds in all 20 reachable states
```

The command exits with 0. The verdict is always the last line.

## Find the bug in the second model

In `mutex_bug.qnt`, `enter` doesn't check that the lock is free:

```sh
npx quint-check check node_modules/@sequelcore/quint-check/demo/mutex_bug.qnt --main mutex_bug --invariant inv
```

The search stops at the first state that breaks `inv` and prints the shortest
path to it. The first state is shown whole; each later state shows only the
variables that step changed:

```text
trace (each state after the first shows only what changed):
  state 0, init
    lockFree = true
    state = Map("p1" -> Idle, "p2" -> Idle, "p3" -> Idle)
  state 1, request
    state = Map("p1" -> Waiting, "p2" -> Idle, "p3" -> Idle)
  state 2, enter
    lockFree = false
    state = Map("p1" -> Critical, "p2" -> Idle, "p3" -> Idle)
  state 3, request
    state = Map("p1" -> Critical, "p2" -> Waiting, "p3" -> Idle)
  state 4, enter
    state = Map("p1" -> Critical, "p2" -> Critical, "p3" -> Idle)
search: stopped at the first violation, 18 distinct states, 6 still queued; deadlock not checked
checked with quint 0.33.1 and tla-ts 0.0.9
violated: inv breaks in state 4 of the trace above
```

In state 4, `p1` and `p2` are both critical. The command exits with 20. To
keep the trace for Quint's tools, add `--out-itf cex.itf.json`; see
[Counterexamples](counterexamples.md).

## See a refusal

`mutex_list.qnt` is the correct model again, with the lock kept as a list,
which is outside quint-check's subset:

```sh
npx quint-check check node_modules/@sequelcore/quint-check/demo/mutex_list.qnt --main mutex_list --invariant inv
```

quint-check proves nothing rather than guess:

```text
unsupported: operator List, outside quint-check's subset (found during translation); nothing was checked
```

On stderr, it names the command that checks the whole language, with Java:

```text
quint verify --backend=tlc node_modules/@sequelcore/quint-check/demo/mutex_list.qnt --main=mutex_list --invariant=inv checks the whole language (needs Java)
```

The command exits with 21.

## Check your own model

Point `check` at your file, its module and an invariant of the model:

```sh
npx quint-check check spec.qnt --main spec --invariant inv
```

Give `--invariant` again for more invariants. Next:

- [What a result means](results.md), before you rely on a `passed`;
- [The supported subset](subset.md), if your model gets `unsupported`;
- [Command line](cli.md) and [TypeScript API](api.md), for every option.
