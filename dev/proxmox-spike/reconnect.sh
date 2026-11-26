#!/usr/bin/env bash
set -u
CFG=$1 H=$2
ssh -F "$CFG" "$H" 'sleep 100' </dev/null >/dev/null 2>&1 &
SSH=$!
sleep 15
PROXY=$(pgrep -P "$SSH" -f serial-mux-proxy || pgrep -f "serial-mux-proxy.mjs termproxy" | head -1)
kill -9 "$PROXY"; wait "$SSH"; echo "old session rc=$?"
a=$(date +%s%N)
SERIAL_PROXY_DEBUG=1 timeout 100 ssh -F "$CFG" "$H" 'echo reconnect-ok; pgrep -c -x sshd' </dev/null 2>&1
echo "reconnect $(( ($(date +%s%N) - a) / 1000000 )) ms"
