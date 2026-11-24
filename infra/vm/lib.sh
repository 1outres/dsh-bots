# shellcheck shell=bash
# Shared by install.sh and the scripts in infra/vm: OS facts and the failure report.

# The release this tree installs (DSH_BOTS_VERSION, DSH_VERSION, IMAGE_TAG, IMAGE_MANIFEST_SHA256).
# shellcheck source=../release.env
. "$(dirname "${BASH_SOURCE[0]}")/../release.env"

# Sets OS_ID, OS_VERSION, OS_NAME, OS_FAMILY (debian | fedora | arch | nixos |
# unsupported), OS_WHY (why unsupported) and IS_WSL (0/1), for the scripts that source this.
# shellcheck disable=SC2034
detect_os() {
  OS_ID="" OS_VERSION="" OS_NAME="" OS_FAMILY=unsupported OS_WHY="" IS_WSL=0
  if [[ -e /proc/sys/fs/binfmt_misc/WSLInterop ]] || grep -qi 'microsoft-standard-wsl2' /proc/sys/kernel/osrelease 2>/dev/null; then
    IS_WSL=1
  fi
  if [[ ! -r /etc/os-release ]]; then
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
      PRETTY_NAME) OS_NAME=$value ;;
    esac
  done </etc/os-release
  case $OS_ID:$OS_VERSION in
    debian:12 | debian:13) OS_FAMILY=debian ;;
    ubuntu:24.04) OS_FAMILY=debian ;;
    rhel:* | rocky:* | almalinux:*)
      OS_WHY="RHEL/Rocky/Alma have no Incus that runs VMs: EPEL has none, and the COPR builds find no QEMU (EL ships /usr/libexec/qemu-kvm, without SPICE; lxc/incus#1301)"
      ;;
    fedora:*)
      if ((${OS_VERSION:-0} >= 42)); then OS_FAMILY=fedora; else OS_WHY="Fedora ${OS_VERSION} is older than 42"; fi
      ;;
    arch:*) OS_FAMILY=arch ;;
    nixos:*) OS_FAMILY=nixos ;;
    *) OS_WHY="${OS_NAME:-$OS_ID} is not one of Debian 12/13, Ubuntu 24.04, Fedora 42+, Arch Linux, NixOS" ;;
  esac
}

# fail <what happened and why> <how to fix it>: report, then exit 1.
# With DSH_BOTS_REPORT set (install.sh), the two lines also go to that file.
fail() {
  if [[ -n ${DSH_BOTS_REPORT:-} ]]; then printf '%s\n%s\n' "$1" "$2" >"$DSH_BOTS_REPORT"; fi
  printf 'error: %s\n  fix: %s\n' "$1" "$2" >&2
  exit 1
}

# on_error: report the command that failed (set -e scripts: trap on_error ERR).
on_error() {
  # A command substitution's failure is reported once, by the command around it.
  ((BASH_SUBSHELL == 0)) || exit 1
  fail "This command failed: $BASH_COMMAND (${BASH_SOURCE[1]##*/}, line ${BASH_LINENO[0]})." "See the log just above it, fix the cause, then run this again."
}

# note <text>: a one-line summary of what a step did (install.sh shows it after the check mark).
note() {
  if [[ -n ${DSH_BOTS_NOTE:-} ]]; then printf '%s\n' "$*" >"$DSH_BOTS_NOTE"; fi
  printf '%s\n' "$*"
}

log() { printf '\n==> %s\n' "$*"; }

# alias_target <alias>: the fingerprint an Incus image alias points at (from the API's
# JSON), empty when there is no such alias.
alias_target() {
  { incus query "/1.0/images/aliases/$1" 2>/dev/null || true; } |
    sed -n 's/^[[:space:]]*"target": "\([0-9a-f]\{64\}\)".*/\1/p'
}

# aliases_of <fingerprint>: the aliases naming that image, one per line.
aliases_of() {
  incus image alias list -f csv | awk -F, -v fp="$1" 'index(fp, $2) == 1 {print $1}'
}

# version_ge <a> <b>: whether dotted version a >= b.
version_ge() {
  [[ $(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1) == "$2" ]]
}
