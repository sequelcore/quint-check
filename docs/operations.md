# Processes, files and the cache

What a check runs, what it writes, and what it can leave behind.

## Child processes and temporary folders

A check runs two child processes, one after the other: Quint's frontend,
then the checker, which runs tla-ts in a Worker thread. Each check works in
its own folder under the system's temporary directory, named
`quint-check-run-<pid>-...` after the process that made it.

When a check settles, every process it started has exited and its folder is
gone. That holds when it passes, fails, times out or is cancelled. A folder
that can't be removed, for example because another program holds a file in
it, is reported as a process warning with the code `QUINT_CHECK_CLEANUP`,
never thrown.

## Stopping a check

Stopping sends SIGTERM and, 2 seconds later, SIGKILL.

- **On Linux and macOS**, it signals the child's whole process group, so
  nothing the child started outlives it.
- **On Windows**, the child is ended with TerminateProcess. Processes a Node
  child starts without `detached` end with it, through the job object libuv
  puts every Node process in; processes started with `detached` leave that
  job and don't. quint-check's own children start none.

The CLI turns Ctrl-C (SIGINT) and SIGTERM into a cancel: the check stops
every process it started, and `quint-check` exits with 130 or 143. On Linux
and macOS the children run in their own process group, so the terminal's
signal reaches only the CLI.

## If the calling process dies

If the process running `check` is killed (SIGKILL, a crash, the operating
system ending it), the checker notices that its standard input has closed
and exits within moments. Quint's frontend has no such check: on Linux and
macOS, where it runs in its own process group, it keeps running until its
compile finishes and then exits. Either way the folder stays behind. A power
failure leaves the folder and nothing running.

The next check in any process removes the folders of processes that no
longer exist. That sweep tells a stale folder by its owner's process id, so
processes in different PID namespaces, such as containers, that share one
temporary folder can remove each other's live folders. A check whose folder
is removed fails closed: it reports `error` from the stage that lost its
output, and never reports `passed`.

## The time limit

`timeoutMs`, or `--timeout-ms`, covers the whole check, Quint's frontend
included, from creating the check's folder on. Removing the folder happens
after it, and can add a little time to a check that ran up to its limit. Reading Quint's output
(`frontend.json`) and translating it run in the process that called `check`.
Neither `timeoutMs` nor the signal interrupts them, and the check stops only
once they finish.

## The checker cache

tla-ts compiles its own JavaScript on first use, and quint-check keeps the
compiled code between checks. The cache holds tla-ts's code only, never
anything about a model or a result: a result is the same with the cache off,
empty, warm or corrupted (`tests/cache.test.ts`). On a hosted Windows runner,
a warm cache took 178 to 315 ms off the median check of each of four models
([bench/results/ci](https://github.com/sequelcore/quint-check/blob/main/bench/results/ci/win32-x64-github-windows-2025-x64.md)).

| | |
| --- | --- |
| Where | `QUINT_CHECK_CACHE_DIR`, else `%LOCALAPPDATA%\quint-check\cache` (Windows), `~/Library/Caches/quint-check` (macOS), `$XDG_CACHE_HOME/quint-check` or `~/.cache/quint-check` (Linux) |
| Layout | one folder per tla-ts version, and inside it per runtime, platform and architecture |
| Off | `QUINT_CHECK_CACHE=off`; also off when the folder can't be created or written |
| Clear | `npx quint-check cache clear`; `npx quint-check cache path` prints the folder |
