#!/bin/sh
# Runs fp.qnt through Quint 0.35.0's two simulators and its Veil backend
# (explicit-state, then bounded symbolic), then checks which pairs of int
# values Veil tells apart. Needs Linux or macOS: Quint refuses Veil on Windows.
# The first Veil run installs elan, Lean and Veil under ~/.quint (about 5 GB).
# Usage: repro/veil-int-fingerprint/run-veil.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
quint="npx --yes @informalsystems/quint@0.35.0"
echo "\$ quint --version"; $quint --version
echo "\$ node --version"; node --version
for backend in typescript rust; do
  echo
  echo "\$ quint run --backend=$backend --invariant=inv --max-samples=1 --max-steps=1 --seed=0x1 fp.qnt"
  $quint run --backend=$backend --invariant=inv --max-samples=1 --max-steps=1 --seed=0x1 "$here/fp.qnt" 2>&1 | grep -v "^Use --\|^You may\|^$"
done
echo
echo "\$ quint verify --backend=veil --invariant=inv fp.qnt"
$quint verify --backend=veil --invariant=inv "$here/fp.qnt" 2>&1 | grep -v "^Use --\|^$"
echo
echo "\$ quint verify --backend=veil --invariant=inv --verbosity=4 fp.qnt   # last metrics line"
$quint verify --backend=veil --invariant=inv --verbosity=4 "$here/fp.qnt" 2>&1 | grep statesFound | tail -1
echo
echo "\$ quint verify --backend=veil --symbolic --max-steps=1 --invariant=inv fp.qnt"
$quint verify --backend=veil --symbolic --max-steps=1 --invariant=inv "$here/fp.qnt" 2>&1 | grep -v "^Use --\|^$"

# Each pair: init sets x to a, step sets it to b, and inv is x == a, so the
# invariant breaks in the second state whenever Veil explores it.
echo
echo "a -> b: Veil's verdict"
tmp=$(mktemp -d)
for pair in \
  "0 4611686018427387904" "0 9223372036854775808" "0 18446744073709551616" \
  "1 4611686018427387905" "7 4611686018427387911" "-1 -4611686018427387905" \
  "0 2305843009213693952" "0 4611686018427387903" "0 4611686018427387905" \
  "0 9223372036854775807" "1 9223372036854775808" "-2 -4611686018427387905"; do
  set -- $pair
  printf 'module pair {\n  var x: int\n  action init = x'"'"' = %s\n  action step = x'"'"' = %s\n  val inv = x == %s\n}\n' "$1" "$2" "$1" > "$tmp/pair.qnt"
  verdict=$($quint verify --backend=veil --invariant=inv "$tmp/pair.qnt" 2>&1 | grep -o '\[ok\]\|\[violation\]')
  echo "$1 -> $2: $verdict"
done
rm -rf "$tmp"
