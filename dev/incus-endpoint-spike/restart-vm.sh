#!/bin/bash
cd /tmp/dsh-spike || exit
ts() { date +%s.%N; }
for a in spk-a spk-a-local spk-a-vsock; do
  (bin/ssh $a 'while true; do date +%s; sleep 1; done' > vmr-$a.log 2>&1; echo "exit=$? at $(date +%s)" >> vmr-$a.log) &
done
sleep 4
T0=$(ts); echo "restart at $T0"
incus restart --project dsh-spike spk-a
echo "incus restart returned $(awk "BEGIN{print $(ts)-$T0}")s"
for a in spk-a spk-a-local spk-a-vsock; do
  ( for _ in $(seq 1 240); do if timeout 10 bin/ssh $a true 2>/dev/null; then echo "$a new connection ok after $(awk "BEGIN{print $(ts)-$T0}")s"; break; fi; sleep 0.5; done ) &
done
sleep 100
for a in spk-a spk-a-local spk-a-vsock; do echo "== $a"; tail -1 vmr-$a.log; done
