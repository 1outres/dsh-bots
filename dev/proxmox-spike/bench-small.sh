#!/usr/bin/env bash
set -u
CFG=$1 H=$2; shift 2
CTL=$(mktemp -u /tmp/pvectl.XXXX)
ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
a=$(date +%s%N); ssh -F "$CFG" -M -S "$CTL" -o ControlPersist=no -fN "$H" </dev/null >/dev/null 2>&1; echo "master $(ms "$a") ms"
for _ in 1 2 3; do a=$(date +%s%N); ssh -F "$CFG" -S "$CTL" "$H" true; echo "mux true $(ms "$a") ms"; done
for n in "$@"; do
  a=$(date +%s%N); c=$(timeout 600 ssh -F "$CFG" -S "$CTL" "$H" "head -c $((n * 1024)) /dev/urandom" | wc -c); t=$(ms "$a")
  echo "down ${n}KiB bytes=$c $t ms $(awk -v k="$n" -v t="$t" 'BEGIN{printf "%.1f", k*1000/t}') KiB/s"
  a=$(date +%s%N); c=$(head -c $((n * 1024)) /dev/urandom | timeout 600 ssh -F "$CFG" -S "$CTL" "$H" "wc -c"); t=$(ms "$a")
  echo "up ${n}KiB bytes=$c $t ms $(awk -v k="$n" -v t="$t" 'BEGIN{printf "%.1f", k*1000/t}') KiB/s"
done
ssh -F "$CFG" -S "$CTL" -O exit "$H" 2>/dev/null
