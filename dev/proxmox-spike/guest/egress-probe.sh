#!/bin/bash
for t in 10.250.77.1:22 10.250.77.1:53 10.250.77.10:8006 10.250.77.10:22 10.250.77.123:22 169.254.169.254:80 1.1.1.1:443 151.101.1.1:443; do h=${t%:*}; p=${t#*:}; if timeout 3 bash -c "</dev/tcp/$h/$p" 2>/dev/null; then echo "$t open"; else echo "$t blocked rc=$?"; fi; done; getent hosts deb.debian.org | head -1
