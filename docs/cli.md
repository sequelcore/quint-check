# Command line

The `quint-check` command has three subcommands: `check`, `translate` and
`cache`. `quint-check --help`, `quint-check <command> --help` and
`quint-check --version` print help and the version, and exit 0. `--help` is
read anywhere on the line before a `--`.

## `quint-check check`

Checks that each invariant holds in every reachable state of a model.

```text
quint-check check <file.qnt> --invariant <expr> [--invariant <expr>...] [options]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--invariant <expr>` | required | A definition name or an expression of the model, as `quint compile --invariant` takes it. Repeat for more; each is checked and named separately. |
| `--main <module>` | Quint's choice, from the file name | The module to check. |
| `--init <action>` | `init` | The initializer action. |
| `--step <action>` | `step` | The step action. |
| `--timeout-ms <ms>` | `60000` | The time limit for the whole check, Quint's frontend included: a whole number from 1 to 2147483647. |
| `--out-itf <file>` | none | On a violation, also write the counterexample to `<file>` as [ITF](counterexamples.md). |
| `--json` | off | Print the result as JSON instead of the summary. |

### Output

By default, `check` prints a summary on stdout, with the verdict on the last
line: the search, the tools, and for a violation the
[trace](counterexamples.md#in-the-summary). When there is a next command, such
as the same check with twice the time after a timeout, it goes to stderr.
When stderr is a terminal, one line on stderr says the check started.

With `--json`, stdout holds one JSON document, the
[`CheckResult`](api.md#checkresult) that `check()` returns, with the same exit
code. The JSON has no timestamps. An `error`'s `output` can name the check's
temporary folder, whose name differs from run to run.

### `--out-itf`

- On a violation, the file gets the counterexample, written whole: a partial
  file is renamed into place only once it's complete.
- On any other result, nothing is written, and an existing file is left as
  it was. stderr says so.
- The file's folder must exist; `check` checks it before the search and
  reports a usage error if it doesn't.
- If the file can't be written after a violation, `check` still prints the
  result and exits 23.
- `{seq}` and `{test}` in the name are kept as written, unlike in `quint run
  --out-itf`; `check` warns about them.

### Usage errors

These print the usage line and the problem on stderr, print nothing on
stdout, and exit 2:

- no `--invariant`, or one that is blank or `true`, which checks nothing;
- an unknown option, or one missing its value;
- a single-value option given twice, such as `--main`;
- `--timeout`, which isn't an alias: the message names `--timeout-ms`;
- a `--timeout-ms` that isn't a whole number from 1 to 2147483647;
- no model file, or more than one.

## `quint-check translate`

Prints the TLA+ module and configuration that `check` would run, with the
configuration as TLA+ comments after the module. `check` also adds
`CHECK_DEADLOCK FALSE` to that configuration; without it, a checker run on the
printed files reports deadlock, which `check` doesn't check.

```text
quint-check translate <file.qnt> [--invariant <expr>...] [options]
```

It takes `--invariant`, `--main`, `--init` and `--step` as `check` does;
`--invariant` is optional here. It takes no `--json`, `--timeout-ms` or
`--out-itf`. A model outside the subset prints the reason on stderr and exits
21; a model Quint's frontend rejects prints Quint's errors on stderr and
exits 23.

## `quint-check cache`

```text
quint-check cache path|clear
```

`path` prints the folder of the checker's compile cache. `clear` removes the
cache folders, prints each one it removed, and exits 0 even when there was
none. See [the checker cache](operations.md#the-checker-cache).

## Exit codes

| Code | `check` | `translate` | `cache` |
| --- | --- | --- | --- |
| 0 | `passed` | translated | done |
| 20 | `violated` | | |
| 21 | `unsupported` | outside the subset | |
| 22 | `inconclusive` | | |
| 23 | `error`, or the `--out-itf` file couldn't be written | Quint's frontend rejected the model | |
| 2 | usage error | usage error | usage error |
| 1 | crash | crash | crash |
| 130 | interrupted (SIGINT) | | |
| 143 | terminated (SIGTERM) | | |

Ctrl-C and SIGTERM stop the check and every process it started before
`check` exits; see [Processes, files and the cache](operations.md).

## Environment variables

| Variable | Effect |
| --- | --- |
| `QUINT_CHECK_CACHE=off` | Turns the checker's compile cache off. |
| `QUINT_CHECK_CACHE_DIR` | Moves the cache to this folder. |
