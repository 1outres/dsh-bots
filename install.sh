#!/usr/bin/env bash
# dsh-bots VM host installer: prepares this machine to run the bots' Incus VMs.
# DSH itself needs no installer: add the plugin in DSH and choose this VM host in the
# dsh-bots settings.
#
#   curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash
#
# For an Incus server that already runs other things, its administrator creates the
# project instead (infra/incus/create-project.sh; no root):
#
#   curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash -s -- incus-project --help
#
# Safe to run again: every step checks what is done and continues from there.
# Environment (all optional):
#   DSH_BOTS_ACCESS     local (DSH runs on this machine) or remote (DSH runs on another one); else asked
#   DSH_BOTS_REF        tag (or branch) whose tree a piped run uses (default: the latest release)
#   DSH_BOTS_SOURCE     a checkout to use instead of downloading one
#   DSH_BOTS_YES=1      answer yes to every question (third-party Incus repository)
#   DSH_BOTS_NONINTERACTIVE=1  never read the terminal (for agents): questions stop with what to set
#   POOL, POOL_SIZE, PROJECT, LIMIT_VMS, LIMIT_CPU, LIMIT_MEMORY, LIMIT_DISK,
#   HTTPS_ADDRESS, CLIENT_NAME  passed to infra/vm/host-setup.sh (defaults there)
set -euo pipefail

REPO=1outres/dsh-bots
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/dsh-bots

# ------------------------------------------------------------- the tree
# The tag of the latest dsh-bots release (v<version>); image-* releases are never marked latest.
latest_release() {
  local url="https://api.github.com/repos/$REPO/releases/latest" tag
  tag=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$url" 2>/dev/null |
    sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p') || tag=""
  if [[ -z $tag ]]; then
    printf 'dsh-bots: cannot read the latest release from %s\n  Fix: check the network (GitHub allows 60 API requests an hour without a token), or set DSH_BOTS_REF to a release tag such as v<version>.\n' "$url" >&2
    exit 1
  fi
  if [[ ! $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    printf 'dsh-bots: the latest release of %s is %s, not a dsh-bots release (v<version>).\n  Fix: set DSH_BOTS_REF to a release tag such as v<version>.\n' "$REPO" "$tag" >&2
    exit 1
  fi
  printf '%s' "$tag"
}

# Piped into bash, this file has no tree around it: fetch the release's tree and run its install.sh.
locate_tree() {
  if [[ -n ${DSH_BOTS_SOURCE:-} ]]; then
    TREE=$(cd "$DSH_BOTS_SOURCE" && pwd)
  elif [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
    TREE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  else
    local ref=${DSH_BOTS_REF:-}
    [[ -n $ref ]] || ref=$(latest_release)
    TREE=$STATE/source/$ref
    rm -rf "$TREE.new"
    mkdir -p "$TREE.new"
    local url="https://codeload.github.com/$REPO/tar.gz/$ref"
    if ! { curl -fsSL "$url" 2>/dev/null | tar -xz --strip-components=1 -C "$TREE.new" 2>/dev/null; }; then
      printf 'dsh-bots: cannot download %s\n  Fix: check the network and DSH_BOTS_REF (%s), or set DSH_BOTS_SOURCE to a checkout.\n' "$url" "$ref" >&2
      rm -rf "$TREE.new"
      exit 1
    fi
    rm -rf "$TREE"
    mv "$TREE.new" "$TREE"
    [[ -f $TREE/install.sh ]] || { printf 'dsh-bots: %s has no install.sh.\n' "$ref" >&2; exit 1; }
    DSH_BOTS_SOURCE=$TREE exec bash "$TREE/install.sh" "$@"
  fi
  [[ -f $TREE/infra/vm/host-setup.sh ]] || { printf 'dsh-bots: %s is not a dsh-bots tree.\n' "$TREE" >&2; exit 1; }
}

# ------------------------------------------------------------- output
TOTAL=6
STEP=0
LINE_OPEN=0
if [[ -t 1 && ${TERM:-dumb} != dumb ]]; then
  C_DIM=$'\e[2m' C_OK=$'\e[32m' C_ERR=$'\e[31m' C_BOLD=$'\e[1m' C_OFF=$'\e[0m' TTY_OUT=1
else
  C_DIM="" C_OK="" C_ERR="" C_BOLD="" C_OFF="" TTY_OUT=0
fi
HAVE_TTY=0
if [[ ${DSH_BOTS_NONINTERACTIVE:-} != 1 ]] && { : </dev/tty; } 2>/dev/null; then HAVE_TTY=1; fi

step_label() {
  local title="[$STEP/$TOTAL] $1 "
  local dots=$((37 - ${#title}))
  printf '%s%s%s' "$title" "$C_DIM" "$(printf '%*s' "$((dots > 2 ? dots : 2))" '' | tr ' ' '.')"
  printf '%s ' "$C_OFF"
}

# step <title> <function>: one line; details go to the log. The function runs in a
# subshell with errexit, so any failing command ends the step; what later steps
# need it hands back with keep.
step() {
  STEP=$((STEP + 1))
  local title=$1 fn=$2 note rc
  CURRENT_TITLE=$title
  : >"$NOTE_FILE"
  : >"$REPORT_FILE"
  : >"$KEEP_FILE"
  step_label "$title"
  if ((TTY_OUT)); then printf '…'; fi
  LINE_OPEN=1
  printf '\n### [%s/%s] %s\n' "$STEP" "$TOTAL" "$title" >>"$LOG"
  set +e
  (
    set -e
    "$fn"
  ) >>"$LOG" 2>&1
  rc=$?
  set -e
  # shellcheck disable=SC1090
  . "$KEEP_FILE"
  if ((rc == 0)); then
    note=$(head -n1 "$NOTE_FILE")
    close_line "${C_OK}✓${C_OFF}${note:+ $note}"
  else
    close_line "${C_ERR}✗${C_OFF}"
    report_failure
  fi
}

# keep <name> <value>: hand a variable from a step back to the installer.
keep() { printf '%s=%q\n' "$1" "$2" >>"$KEEP_FILE"; }

close_line() {
  if ((TTY_OUT)); then printf '\r\e[K'; step_label "$CURRENT_TITLE"; fi
  printf '%s\n' "$1"
  LINE_OPEN=0
}

report_failure() {
  local what fix
  what=$(sed -n 1p "$REPORT_FILE")
  fix=$(sed -n 2p "$REPORT_FILE")
  if [[ -z $what ]]; then
    what="Something failed in \"$CURRENT_TITLE\"."
    fix="Read the end of the log, fix what it shows, then run this again."
  fi
  printf '\n  %s\n  %sFix:%s %s\n  %sLog: %s%s\n' "$what" "$C_BOLD" "$C_OFF" "$fix" "$C_DIM" "$LOG" "$C_OFF" >&2
  exit 1
}

# stop <what> <fix>: fail the current step (inside a step function).
stop() {
  printf '%s\n%s\n' "$1" "$2" >"$REPORT_FILE"
  printf 'error: %s\n  fix: %s\n' "$1" "$2"
  exit 1
}

# ask <question> <default y|n>: yes/no from the terminal; without one the default,
# or DSH_BOTS_YES=1 for yes.
ask() {
  local answer
  if [[ ${DSH_BOTS_YES:-} == 1 ]]; then return 0; fi
  if ((!HAVE_TTY)); then [[ $2 == y ]]; return; fi
  ((LINE_OPEN)) && printf '\n' >/dev/tty
  printf '  %s [%s] ' "$1" "$([[ $2 == y ]] && echo Y/n || echo y/N)" >/dev/tty
  read -r answer </dev/tty || answer=""
  answer=${answer:-$2}
  ((LINE_OPEN)) && step_label "$CURRENT_TITLE" >/dev/tty
  [[ $answer == [yY]* ]]
}

# choose <question> <default> <options...>: one of the options, from the terminal (HAVE_TTY).
choose() {
  local question=$1 default=$2 answer
  shift 2
  ((LINE_OPEN)) && printf '\n' >/dev/tty
  printf '  %s (%s) [%s] ' "$question" "$*" "$default" >/dev/tty
  read -r answer </dev/tty || answer=""
  answer=${answer:-$default}
  ((LINE_OPEN)) && step_label "$CURRENT_TITLE" >/dev/tty
  printf '%s' "$answer"
}

# ------------------------------------------------------------- root
SUDO=()
SUDO_KEEPALIVE=""
# Once, before the first step that needs it: say why, then ask sudo.
acquire_root() {
  ((EUID == 0)) && return 0
  local why="  Root access is needed to install packages and set up Incus and the firewall (sudo)."
  if ! command -v sudo >/dev/null; then
    printf '%s\n  sudo is not installed: install it and allow %s to use it, then run this again.\n' "$why" "$USER" >&2
    exit 1
  fi
  if ! sudo -n true 2>/dev/null; then
    if ((!HAVE_TTY)); then
      printf '%s\n  sudo asks for a password and there is no terminal: run this from a terminal, or allow %s passwordless sudo while it runs.\n' "$why" "$USER" >&2
      exit 1
    fi
    printf '%s\n' "$why"
    # shellcheck disable=SC2024 # sudo reads the password from the terminal itself
    sudo -v </dev/tty || { printf '  sudo did not grant root access.\n' >&2; exit 1; }
  fi
  SUDO=(sudo)
  (while sleep 50; do sudo -n -v 2>/dev/null || exit; done) >/dev/null 2>&1 &
  SUDO_KEEPALIVE=$!
}

host_setup() {
  local settings=() name
  for name in POOL POOL_SIZE PROJECT LIMIT_VMS LIMIT_CPU LIMIT_MEMORY LIMIT_DISK HTTPS_ADDRESS CLIENT_NAME; do
    [[ -z ${!name:-} ]] || settings+=("$name=${!name}")
  done
  "${SUDO[@]}" env DSH_BOTS_REPORT="$REPORT_FILE" DSH_BOTS_NOTE="$NOTE_FILE" "${settings[@]}" "$@"
}

# ------------------------------------------------------------- state
save_choice() { # save_choice <key> <value>
  local file=$STATE/install.env
  touch "$file"
  grep -v "^$1=" "$file" >"$file.tmp" || true
  printf '%s=%q\n' "$1" "$2" >>"$file.tmp"
  mv "$file.tmp" "$file"
}

saved_choice() {
  [[ -f $STATE/install.env ]] || return 0
  sed -n "s/^$1=//p" "$STATE/install.env" | tail -n1
}

# ------------------------------------------------------------- steps
step_system() {
  [[ $(uname -m) == x86_64 ]] || stop "This is a $(uname -m) machine; dsh-bots VM hosts are x86_64 only." "Use an x86_64 machine as the VM host."
  detect_os
  [[ $OS_FAMILY != unsupported ]] || stop "This machine cannot be a VM host: $OS_WHY." "Run this on a VM host (README)."
  [[ -d /run/systemd/system ]] || stop "systemd is not the init system." "dsh-bots needs systemd (it runs Incus)."
  [[ -e /dev/kvm ]] || stop "/dev/kvm is missing: KVM is not available." \
    "Turn on virtualization (VT-x / AMD-V) in the firmware, or nested virtualization for a VM, then run this again."
  local free
  free=$(df -Pk /var/lib | awk 'NR == 2 {print int($4 / 1048576)}')
  ((free >= 20)) || stop "/var/lib has ${free} GiB free; the base image and bot VMs need at least 20 GiB." "Free space on that file system."
  note "${OS_NAME:-$OS_ID}, KVM"
}

step_access() {
  local access=${DSH_BOTS_ACCESS:-$(saved_choice access)}
  if [[ -z $access ]]; then
    ((HAVE_TTY)) || stop "DSH_BOTS_ACCESS is not set and there is no terminal to ask where DSH runs." \
      "Set DSH_BOTS_ACCESS=local (DSH runs on this machine) or remote (DSH runs on another machine), then run this again."
    access=$(choose "Where does DSH run? local: on this machine, remote: on another machine" local local remote)
  fi
  case $access in
    local)
      ((EUID != 0)) || stop "DSH cannot use this machine's Incus as root." "Run this as the user that runs DSH (it uses sudo), or set DSH_BOTS_ACCESS=remote."
      note "DSH on this machine, as $USER"
      ;;
    remote) note "DSH on another machine, over HTTPS" ;;
    *) stop "\"$access\" is neither local nor remote." "Set DSH_BOTS_ACCESS=local or DSH_BOTS_ACCESS=remote." ;;
  esac
  save_choice access "$access"
  keep ACCESS "$access"
}

step_packages() {
  local third_party=no
  case $OS_ID:$OS_VERSION in
    debian:12 | ubuntu:24.04)
      ask "Incus for $OS_NAME comes from Zabbly (pkgs.zabbly.com), a third-party repository of the Incus maintainers. Add it?" n ||
        stop "Incus for $OS_NAME needs the Zabbly repository, which was not allowed." "Run this again and allow it (or set DSH_BOTS_YES=1)."
      third_party=yes
      ;;
  esac
  host_setup DSH_BOTS_THIRD_PARTY=$third_party bash "$TREE/infra/vm/host-setup.sh" packages
}

step_incus() { host_setup bash "$TREE/infra/vm/host-setup.sh" incus; }
step_firewall() { host_setup bash "$TREE/infra/vm/host-setup.sh" firewall; }

step_grant() {
  if [[ $ACCESS == local ]]; then
    id -nG "$USER" | tr ' ' '\n' | grep -qx incus-admin || keep GROUP_ADDED 1
    host_setup DSH_USER="$USER" bash "$TREE/infra/vm/host-setup.sh" local
  else
    host_setup DSH_BOTS_TOKEN_FILE="$TOKEN_FILE" bash "$TREE/infra/vm/host-setup.sh" remote
  fi
}

# ------------------------------------------------------------- main
finish() {
  [[ -z $SUDO_KEEPALIVE ]] || kill "$SUDO_KEEPALIVE" 2>/dev/null || true
  rm -f "$NOTE_FILE" "$REPORT_FILE" "$KEEP_FILE" "$TOKEN_FILE"
}

done_local() {
  printf '\n%sDone.%s This machine is a VM host for the DSH of %s.\n' "$C_OK" "$C_OFF" "$USER"
  if ((GROUP_ADDED)); then
    printf 'Restart DSH so that it runs in the group incus-admin (log out and back in first if you start it from a shell).\n'
  fi
  printf 'In DSH: add the plugin (dsh plugin --profile <profile> add @1outres/dsh-bots@%s, or Plugins), then\n' "$DSH_BOTS_VERSION"
  printf 'dsh-bots settings → VM host → This machine.\n'
}

done_remote() {
  printf '\n%sDone.%s Paste this trust token in DSH: dsh-bots settings → VM host → Another machine.\n\n' "$C_OK" "$C_OFF"
  printf '%s%s%s\n\n' "$C_BOLD" "$(cat "$TOKEN_FILE")" "$C_OFF"
  printf '%sIt pairs one DSH, once. Run this again for a new token (it replaces an unused one).%s\n' "$C_DIM" "$C_OFF"
}

main() {
  locate_tree "$@"
  if [[ ${1:-} == incus-project ]]; then
    shift
    exec bash "$TREE/infra/incus/create-project.sh" "$@"
  fi
  (($# == 0)) || { printf 'dsh-bots: unknown argument %s (the only one is incus-project).\n' "$1" >&2; exit 1; }
  # shellcheck source=infra/vm/lib.sh
  . "$TREE/infra/vm/lib.sh"
  detect_os
  mkdir -p "$STATE/logs"
  LOG=$STATE/logs/install-$(date +%Y%m%d-%H%M%S).log
  # Not in /tmp: root (sudo) may not write another user's file in a sticky directory (protected_regular).
  NOTE_FILE=$(mktemp -p "$STATE" .note.XXXXXX)
  REPORT_FILE=$(mktemp -p "$STATE" .report.XXXXXX)
  KEEP_FILE=$(mktemp -p "$STATE" .keep.XXXXXX)
  TOKEN_FILE=$(mktemp -p "$STATE" .token.XXXXXX)
  export DSH_BOTS_NOTE=$NOTE_FILE DSH_BOTS_REPORT=$REPORT_FILE
  trap finish EXIT
  GROUP_ADDED=0 ACCESS=""
  printf '%sdsh-bots VM host installer %s%s\n' "$C_BOLD" "$DSH_BOTS_VERSION" "$C_OFF"
  step "Checking system" step_system
  step "Choosing where DSH runs" step_access
  acquire_root
  step "Installing packages" step_packages
  step "Configuring Incus" step_incus
  step "Checking the firewall" step_firewall
  if [[ $ACCESS == local ]]; then
    step "Letting DSH use Incus" step_grant
    done_local
  else
    step "Issuing a trust token" step_grant
    done_remote
  fi
}

main "$@"
