#!/bin/sh
{ printf '\nDSH-SSH-START a\n'; cat; } | socat - UNIX-CONNECT:"$1"
