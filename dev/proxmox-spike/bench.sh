#!/usr/bin/env bash
set -euo pipefail
CFG=$1 H=$2 MIB=${3:-32}
s() { ssh -F "$CFG" "$@"; }
t=0
for i in $(seq 1 10); do a=$(date +%s%N); s "$H" true; b=$(date +%s%N); t=$((t + (b - a) / 1000000)); done
echo "connect+true avg $((t / 10)) ms"
a=$(date +%s%N); s "$H" "head -c $((MIB << 20)) /dev/urandom" | wc -c; b=$(date +%s%N)
echo "down ${MIB}MiB $(((b - a) / 1000000)) ms $(awk -v m=$MIB -v n=$((b - a)) 'BEGIN{printf "%.2f", m*1e9/n}') MiB/s"
a=$(date +%s%N); head -c $((MIB << 20)) /dev/urandom | s "$H" "wc -c"; b=$(date +%s%N)
echo "up ${MIB}MiB $(((b - a) / 1000000)) ms $(awk -v m=$MIB -v n=$((b - a)) 'BEGIN{printf "%.2f", m*1e9/n}') MiB/s"
CTL=$(mktemp -u /tmp/pvebench.XXXX)
s -M -S "$CTL" -o ControlPersist=no -fN "$H"
t=0
for i in $(seq 1 10); do a=$(date +%s%N); s -S "$CTL" "$H" true; b=$(date +%s%N); t=$((t + (b - a) / 1000000)); done
echo "mux true avg $((t / 10)) ms"
a=$(date +%s%N)
for i in 1 2 3 4; do s -S "$CTL" "$H" "sleep 2; echo par$i" & done; wait
b=$(date +%s%N); echo "mux 4 parallel sleep 2: $(((b - a) / 1000000)) ms"
s -S "$CTL" -O exit "$H" 2>/dev/null || true