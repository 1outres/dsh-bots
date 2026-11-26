# shellcheck shell=bash

# shellcheck source=../release.env
. "$(dirname "${BASH_SOURCE[0]}")/../release.env"

SYSROOT=${DSH_BOTS_SYSROOT:-}

ONLY_DSH_HOST="DSH runs there with the plugin alone: build the VM host on another machine (Debian 13 or 12, Ubuntu 24.04 or Fedora 42+) from the dsh-bots settings"

# shellcheck disable=SC2034
detect_os() {
  OS_ID="" OS_VERSION="" OS_CODENAME="" OS_NAME="" OS_FAMILY=unsupported OS_WHY="" OS_DSH_HOST_ONLY=0
  if [[ -e $SYSROOT/proc/sys/fs/binfmt_misc/WSLInterop ]] || grep -qi 'microsoft-standard-wsl2' "$SYSROOT/proc/sys/kernel/osrelease" 2>/dev/null; then
    OS_WHY="WSL is not a VM host: it stops when idle and its nested virtualization is not tested; $ONLY_DSH_HOST"
    OS_DSH_HOST_ONLY=1
    return 0
  fi
  if [[ ! -r $SYSROOT/etc/os-release ]]; then
    OS_WHY="/etc/os-release is missing"
    return 0
  fi
  local line key value
  while IFS= read -r line; do
    [[ $line == *=* ]] || continue
    key=${line%%=*}
    value=${line#*=}
    value=${value#\"}
    value=${value%\"}
    case $key in
      ID) OS_ID=$value ;;
      VERSION_ID) OS_VERSION=$value ;;
      VERSION_CODENAME) OS_CODENAME=$value ;;
      PRETTY_NAME) OS_NAME=$value ;;
    esac
  done <"$SYSROOT/etc/os-release"
  case $OS_ID:$OS_VERSION in
    debian:12 | debian:13) OS_FAMILY=debian ;;
    ubuntu:24.04) OS_FAMILY=debian ;;
    rhel:* | rocky:* | almalinux:*)
      OS_WHY="RHEL/Rocky/Alma have no Incus that runs VMs: EPEL has none, and the COPR builds find no QEMU (EL ships /usr/libexec/qemu-kvm, without SPICE; lxc/incus#1301); $ONLY_DSH_HOST"
      OS_DSH_HOST_ONLY=1
      ;;
    fedora:*)
      if ((${OS_VERSION:-0} >= 42)); then OS_FAMILY=fedora; else OS_WHY="Fedora ${OS_VERSION} is older than 42"; fi
      ;;
    arch:* | nixos:*)
      OS_WHY="${OS_NAME:-$OS_ID} is not a tested VM host; $ONLY_DSH_HOST"
      OS_DSH_HOST_ONLY=1
      ;;
    *) OS_WHY="${OS_NAME:-$OS_ID} is not one of the VM hosts Debian 12/13, Ubuntu 24.04, Fedora 42+" ;;
  esac
}

EVENTS=0
EVENT_PHASE=""
PHASE_CHANGED=0
PHASE_NOTE=""
CANCEL_REQUESTED=0
CANCEL_WATCHER=""

json_quote() {
  local s=$2 code hex char escaped
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  if [[ $s =~ [[:cntrl:]] ]]; then
    for ((code = 1; code < 32; code++)); do
      printf -v hex '%02x' "$code"
      printf -v char '%b' "\\x$hex"
      printf -v escaped '\\u%04x' "$code"
      s=${s//"$char"/$escaped}
    done
  fi
  printf -v "$1" '"%s"' "$s"
}

event() {
  ((EVENTS)) || return 0
  local line field key value
  json_quote value "$1"
  line="{\"v\":1,\"type\":$value"
  shift
  for field in "$@"; do
    if [[ $field =~ ^([a-z]+):=(true|false|-?[0-9]+)$ ]]; then
      key=${BASH_REMATCH[1]} value=${BASH_REMATCH[2]}
    elif [[ $field =~ ^([a-z]+)= ]]; then
      key=${BASH_REMATCH[1]}
      json_quote value "${field#*=}"
    else
      printf 'host-setup: bad event field %s\n' "$field" >&2
      exit 70
    fi
    line+=",\"$key\":$value"
  done
  printf '%s}\n' "$line" >&3
}

fact() { event fact "key=$1" "value=$2"; }

mark_changed() { PHASE_CHANGED=1; }

check() {
  local id=$1 state=$2 value=$3 code=${4:-} what=${5:-} fix=${6:-}
  printf '  %-12s %-8s %s\n' "$id" "$state" "$value"
  [[ -z $what ]] || printf '    %s\n' "$what"
  [[ -z $fix ]] || printf '    fix: %s\n' "$fix"
  event check "id=$id" "state=$state" "value=$value" ${code:+"code=$code"} ${what:+"what=$what"} ${fix:+"fix=$fix"}
}

fail() {
  trap '' USR1
  local code=$1 what=$2 fix=$3
  shift 3
  printf 'error: %s\n  fix: %s\n' "$what" "$fix" >&2
  if ((EVENTS)); then
    [[ -z $EVENT_PHASE ]] || event phase-failed "phase=$EVENT_PHASE" "code=$code" "what=$what" "fix=$fix" "$@"
    event end ok:=false
  fi
  exit 1
}

on_error() {
  local status=$?
  ((BASH_SUBSHELL == 0)) || exit "$status"
  local location="${BASH_SOURCE[1]##*/}:${BASH_LINENO[0]}"
  fail command-failed "This command failed: $BASH_COMMAND (${BASH_SOURCE[1]##*/}, line ${BASH_LINENO[0]})." \
    "See the log just above it, fix the cause, then run this again." \
    "command=$BASH_COMMAND" "location=$location" "exit:=$status"
}

note() {
  PHASE_NOTE=$*
  printf '%s\n' "$*"
}

log() { printf '\n==> %s\n' "$*"; }

events_start() {
  EVENTS=1
  exec 3>&1 1>&2 4<&0 0</dev/null
  trap on_cancel USR1
  (
    exec 3>&- 1>/dev/null 2>&1
    while IFS= read -r line <&4; do [[ $line != cancel ]] || break; done
    kill -USR1 "$$"
  ) &
  CANCEL_WATCHER=$!
  exec 4<&-
  trap events_stop EXIT
  event hello "version=$DSH_BOTS_VERSION" "uid:=$(id -u)"
}

events_stop() { kill "$CANCEL_WATCHER" 2>/dev/null || true; }

on_cancel() {
  CANCEL_REQUESTED=1
  [[ -z $EVENT_PHASE ]] || fail cancelled "The setup was cancelled." "Run it again to continue where it stopped."
}

phase_begin() {
  EVENT_PHASE=$1 PHASE_CHANGED=0 PHASE_NOTE=""
  event phase-start "phase=$1"
  ((!CANCEL_REQUESTED)) || fail cancelled "The setup was cancelled." "Run it again to continue where it stopped."
}

phase_end() {
  local phase=$EVENT_PHASE changed=false
  EVENT_PHASE=""
  ((!PHASE_CHANGED)) || changed=true
  event phase-done "phase=$phase" "changed:=$changed" ${PHASE_NOTE:+"note=$PHASE_NOTE"}
}

events_end() { event end ok:=true; }

alias_target() {
  { incus query "/1.0/images/aliases/$2?project=$1" 2>/dev/null || true; } |
    sed -n 's/^[[:space:]]*"target": "\([0-9a-f]\{64\}\)".*/\1/p'
}

aliases_of() {
  incus image alias list --project "$1" -f csv | awk -F, -v fp="$2" 'index(fp, $2) == 1 {print $1}'
}

version_ge() {
  [[ $(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1) == "$2" ]]
}
