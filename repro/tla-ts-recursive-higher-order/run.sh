#!/bin/sh
# Runs both modules with tla-ts (this repository's pinned version) and with TLC.
# TLA2TOOLS_JAR: the path of a tla2tools.jar (TLC 2.19 for the captured output).
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
jar=${TLA2TOOLS_JAR:?set TLA2TOOLS_JAR to the path of a tla2tools.jar}
cd "$here"
echo "tla-ts $(grep -o '"version": *"[^"]*"' "$root/node_modules/tla-ts/package.json" | head -1 | cut -d'"' -f4)"
java -cp "$jar" tlc2.TLC -version 2>&1 | grep -m1 "TLC2 Version"
for m in Recursive NonRecursive; do
  echo
  echo "\$ tla-ts tlc2.TLC -config $m.cfg $m.tla"
  bun "$root/node_modules/tla-ts/dist/cli.js" tlc2.TLC -config $m.cfg $m.tla > tla-ts.out 2>&1; code=$?
  grep -E "^line|requires|^Error|No error|distinct states" tla-ts.out; rm -f tla-ts.out
  echo "exit $code"
  echo "\$ java -cp tla2tools.jar tlc2.TLC -config $m.cfg $m.tla"
  java -cp "$jar" tlc2.TLC -config $m.cfg $m.tla > tlc.out 2>&1; code=$?
  grep -E "^line|requires|^Error|No error|distinct states" tlc.out; rm -rf tlc.out states
  echo "exit $code"
done
