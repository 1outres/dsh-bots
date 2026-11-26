#!/bin/bash
cd /tmp/dsh-spike || exit
ts() { date +%s.%N; }
for a in spk-a spk-a-local spk-a-vsock; do
  (bin/ssh $a 'while true; do date +%s; sleep 1; done' > live2-$a.log 2>&1; echo "exit=$? at $(date +%s.%N)" >> live2-$a.log) &
done
sleep 4
T0=$(ts); echo "restart issued at $T0"
( sudo -n systemctl restart incus.service; echo "systemctl restart returned after $(awk "BEGIN{print $(ts)-$T0}")s" ) &
for i in $(seq 1 400); do
  s=$(systemctl is-active incus.service)
  if [ "$s" != "$last" ]; then echo "t+$(awk "BEGIN{print $(ts)-$T0}")s incus.service=$s"; last=$s; fi
  if [ $((i % 10)) = 0 ] && [ "$s" = deactivating ]; then r=$(timeout 5 incus list --project dsh-spike -f csv -c n 2>&1 | head -1); echo "t+$(awk "BEGIN{print $(ts)-$T0}")s api during stop: $r"; timeout 8 bin/ssh spk-a-local true 2>/dev/null && echo "  new exec ssh during stop: ok" || echo "  new exec ssh during stop: failed"; fi
  [ "$s" = active ] && [ "$i" -gt 3 ] && break
  sleep 1
done
for a in spk-a spk-a-local spk-a-vsock; do
  ( for i in $(seq 1 120); do if timeout 10 bin/ssh $a true 2>/dev/null; then echo "$a new connection ok at t+$(awk "BEGIN{print $(ts)-$T0}")s"; break; fi; sleep 0.5; done ) &
done
sleep 20
for a in spk-a spk-a-local spk-a-vsock; do echo "== $a live session"; tail -1 live2-$a.log; done
incus list --all-projects -f csv -c nsS
pkill -f '[w]hile true; do date' ; true
