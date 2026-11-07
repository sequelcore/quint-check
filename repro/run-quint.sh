#!/bin/sh
# Runs one model through Quint's two simulators and `quint verify --backend=tlc`
# (Apalache's translation, then TLC), with the versions this repository pins.
# Usage: repro/run-quint.sh <file.qnt> [invariant]
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
quint="node $here/node_modules/@informalsystems/quint/dist/src/cli.js"
file=$1
inv=${2:-inv}
echo "\$ quint --version"; $quint --version
echo "\$ node --version"; node --version
echo "\$ java -version"; java -version 2>&1 | head -1
for backend in typescript rust; do
  echo
  echo "\$ quint run --backend=$backend --invariant=$inv --max-samples=1 --max-steps=1 --seed=0x1 $(basename "$file")"
  $quint run --backend=$backend --invariant=$inv --max-samples=1 --max-steps=1 --seed=0x1 "$file" 2>&1 | grep -v "^Use --\|^You may\|^$"
done
echo
echo "\$ quint verify --backend=tlc --invariant=$inv $(basename "$file")   # Apalache 0.62.4 translation, TLC from apalache.jar"
$quint verify --backend=tlc --invariant=$inv "$file" 2>&1 | grep -E "^\[|^Error|^State|= |^error|Compiling|Running TLC"
echo
echo "\$ quint verify --invariant=$inv $(basename "$file")   # Apalache 0.62.4, symbolic (SMT), its default backend"
$quint verify --invariant=$inv "$file" 2>&1 | grep -E "^\[|^error|State [0-9]|x: |m: "
