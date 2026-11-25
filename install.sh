#!/usr/bin/env bash
# dsh-bots installer: sets up this Host for bot VMs and installs the plugins into DSH.
#
#   curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash
#
# Safe to run again: every step checks what is done and continues from there.
# Environment (all optional):
#   DSH_BOTS_REF        tag (or branch) whose tree a piped run installs (default: the latest release)
#   DSH_BOTS_SOURCE     a checkout to use instead of downloading one
#   DSH_BOTS_PROFILE    DSH profile to install into (default: the only one, else asked, else web)
#   DSH_BOTS_YES=1      answer yes to every question (third-party Incus repository)
#   DSH_BOTS_NONINTERACTIVE=1  never read the terminal (for agents): questions stop with what to set
#   DSH_BOTS_NPM_REGISTRY  npm registry for the plugins (e.g. a local Verdaccio)
#   DSH_BOTS_PACKAGE    what to pass to "dsh plugin add" instead of @1outres/dsh-bots@<version>
#   DSH_BOTS_IMAGE_URL  where manifest.txt and the image parts are (default: the GitHub release)
#   DSH_BOTS_IMAGE_MANIFEST_SHA256  with DSH_BOTS_IMAGE_URL: that manifest's sha256
#   DSH_BOTS_SKIP_VM_CHECK=1  skip the last step (starting a test VM)
#   POOL, POOL_SIZE     Incus storage pool name and size (default dsh, 80GiB; infra/vm/host-setup.sh)
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
TOTAL=9
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
  elif ((NIXOS_PENDING)); then
    close_line "${C_DIM}paused${C_OFF}"
    report_failure
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
  exit "$( ((NIXOS_PENDING)) && echo 3 || echo 1)"
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
  local why="  Root access is needed to install packages and set up Incus, the firewall and a mount (sudo)."
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

as_root() { "${SUDO[@]}" "$@"; }

host_setup() {
  local tunables=() name
  for name in POOL POOL_SIZE; do [[ -z ${!name:-} ]] || tunables+=("$name=${!name}"); done
  as_root env DSH_USER="$USER" DSH_BOTS_REPORT="$REPORT_FILE" DSH_BOTS_NOTE="$NOTE_FILE" \
    DSH_BOTS_THIRD_PARTY="${THIRD_PARTY:-no}" "${tunables[@]}" bash "$TREE/infra/vm/host-setup.sh" "$@"
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
  [[ $(uname -m) == x86_64 ]] || stop "This is a $(uname -m) machine; dsh-bots runs on x86_64 only." "Use an x86_64 Host."
  detect_os
  [[ $OS_FAMILY != unsupported ]] || stop "This OS is not supported: $OS_WHY." "Use a supported system (README: Requirements)."
  if [[ ! -d /run/systemd/system ]]; then
    if ((IS_WSL)); then
      stop "systemd is not running in this WSL distribution." \
        "Add \"[boot]\" and \"systemd=true\" to /etc/wsl.conf, run wsl.exe --shutdown in Windows, then run this again."
    fi
    stop "systemd is not the init system." "dsh-bots needs systemd (it runs Incus and a mount unit)."
  fi
  if [[ ! -e /dev/kvm ]]; then
    if ((IS_WSL)); then
      stop "/dev/kvm is missing: WSL does not offer nested virtualization." \
        "On Windows 11 add \"[wsl2]\" and \"nestedVirtualization=true\" to %UserProfile%\\.wslconfig, run wsl.exe --shutdown, then run this again."
    fi
    stop "/dev/kvm is missing: KVM is not available." "Turn on virtualization (VT-x / AMD-V) in the firmware, or nested virtualization for a VM, then run this again."
  fi
  local free
  free=$(df -Pk /var/lib | awk 'NR == 2 {print int($4 / 1048576)}')
  ((free >= 20)) || stop "/var/lib has ${free} GiB free; the base image and bot VMs need at least 20 GiB." "Free space on that file system."
  note "${OS_NAME:-$OS_ID}$( ((IS_WSL)) && echo ' (WSL2)'), KVM"
}

profile_json() { # profile_json <expression on p, the profile package.json>
  node -e 'const fs=require("fs");const f=process.argv[1];const p=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};process.stdout.write(String((0,eval)("(p)=>"+process.argv[2])(p)))' \
    "$PROFILE_DIR/package.json" "$1"
}

tools_fix() { # tools_fix <node|pnpm>...: how to get the missing tools on this OS
  local tool packages=() names=()
  for tool in "$@"; do
    case $tool in
      node) packages+=(nixpkgs#nodejs_22) names+=("Node.js 22 or newer") ;;
      pnpm) packages+=(nixpkgs#pnpm) names+=("pnpm (npm install -g pnpm)") ;;
    esac
  done
  if [[ $OS_FAMILY == nixos ]]; then
    printf 'Add %s to environment.systemPackages, or run this again inside nix shell %s.' "${packages[*]#nixpkgs#}" "${packages[*]}"
  else
    local list=${names[0]} name
    for name in "${names[@]:1}"; do list+=" and $name"; done
    printf 'Install %s, then run this again.' "$list"
  fi
}

# shellcheck disable=SC2153 # DSH_VERSION comes from infra/release.env (lib.sh)
step_dsh() {
  command -v dsh >/dev/null || stop "DSH is not installed (no dsh on PATH)." "Install DeepSeek Harness $DSH_VERSION (npm install -g @deepseek-ai/dsh@$DSH_VERSION), then run this again."
  local missing=() tool
  for tool in node pnpm; do command -v "$tool" >/dev/null || missing+=("$tool"); done
  ((${#missing[@]} == 0)) || stop "${missing[*]} not on PATH: the installer reads DSH's profile with node, and dsh plugin installs with pnpm." "$(tools_fix "${missing[@]}")"
  local version
  version=$(dsh --version 2>/dev/null | tail -n1)
  [[ $version == "$DSH_VERSION" ]] ||
    stop "DSH $version is installed; dsh-bots $DSH_BOTS_VERSION needs exactly $DSH_VERSION." "npm install -g @deepseek-ai/dsh@$DSH_VERSION, then run this again."
  DSH_HOME_DIR=${DSH_HOME:-$HOME/.dsh}
  local profiles=() p
  if [[ -d $DSH_HOME_DIR/profiles ]]; then
    for p in "$DSH_HOME_DIR"/profiles/*/; do [[ -d $p ]] && profiles+=("$(basename "$p")"); done
  fi
  PROFILE=${DSH_BOTS_PROFILE:-$(saved_choice profile)}
  if [[ -z $PROFILE ]]; then
    if ((${#profiles[@]} == 1)); then
      PROFILE=${profiles[0]}
    elif ((${#profiles[@]} > 1)); then
      ((HAVE_TTY)) || stop "There are several DSH profiles (${profiles[*]}) and no terminal to ask which one." "Set DSH_BOTS_PROFILE to one of them, then run this again."
      PROFILE=$(choose "Install into which DSH profile?" web "${profiles[@]}")
    else
      PROFILE=web
    fi
  fi
  [[ $PROFILE =~ ^[A-Za-z0-9._-]+$ ]] || stop "\"$PROFILE\" is not a profile name." "Set DSH_BOTS_PROFILE to one of: ${profiles[*]:-web}."
  save_choice profile "$PROFILE"
  PROFILE_DIR=$DSH_HOME_DIR/profiles/$PROFILE
  keep PROFILE "$PROFILE"
  keep PROFILE_DIR "$PROFILE_DIR"
  local own
  own=$(profile_json '((p.dsh&&p.dsh.profile&&p.dsh.profile.bundles)||[]).filter(b=>b.startsWith("@1outres/dsh-bot-")).join(" ")')
  [[ -z $own ]] || stop "Profile $PROFILE already has the bundles $own, which insert the same rows as @1outres/dsh-bots." \
    "Remove them (dsh plugin --profile $PROFILE remove <package>) or choose another profile with DSH_BOTS_PROFILE."
  note "$version, profile $PROFILE"
}

nixos_module() {
  sed -e "s|@DSH_USER@|$USER|g" -e "s|@BOTS_ROOT@|$HOME/.dsh/bots|g" "$TREE/infra/nixos/dsh-bots.nix.in"
}

step_packages() {
  if [[ $OS_FAMILY == nixos ]]; then
    local module=$STATE/nixos/dsh-bots.nix
    mkdir -p "${module%/*}"
    # The bind mount needs its directory at boot, owned by this user.
    mkdir -p "$HOME/.dsh"
    install -d -m 0700 "$HOME/.dsh/bots"
    if [[ ! -f $module ]] || ! cmp -s <(nixos_module) "$module"; then
      nixos_module >"$module"
    fi
    if ! command -v incus >/dev/null || ! command -v socat >/dev/null || ! systemctl is-active --quiet incus.socket; then
      printf '%s\n%s\n' "NixOS is configured declaratively: wrote $module." \
        "Add it to imports in your configuration, run sudo nixos-rebuild switch, then run this again." >"$REPORT_FILE"
      keep NIXOS_PENDING 1
      exit 1
    fi
    note "dsh-bots.nix is active"
    return 0
  fi
  THIRD_PARTY=no
  case $OS_ID:$OS_VERSION in
    debian:12 | ubuntu:24.04)
      ask "Incus for $OS_NAME comes from Zabbly (pkgs.zabbly.com), a third-party repository of the Incus maintainers. Add it?" n ||
        stop "Incus for $OS_NAME needs the Zabbly repository, which was not allowed." "Run this again and allow it (or set DSH_BOTS_YES=1)."
      THIRD_PARTY=yes
      ;;
  esac
  host_setup packages
}

step_incus() {
  local before
  before=$(id -nG "$USER" | tr ' ' '\n' | grep -cx incus-admin || true)
  host_setup incus
  ((before > 0)) || keep GROUP_ADDED 1
}

step_firewall() { host_setup firewall; }
step_workspaces() { host_setup workspaces; }

image_base_url() {
  if [[ -n ${DSH_BOTS_IMAGE_URL:-} ]]; then
    printf '%s' "${DSH_BOTS_IMAGE_URL%/}"
  else
    printf 'https://github.com/%s/releases/download/%s' "$REPO" "$IMAGE_TAG"
  fi
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

step_image() {
  local expected=${DSH_BOTS_IMAGE_MANIFEST_SHA256:-$IMAGE_MANIFEST_SHA256}
  if [[ -n ${DSH_BOTS_IMAGE_URL:-} ]]; then
    [[ -n ${DSH_BOTS_IMAGE_MANIFEST_SHA256:-} ]] || stop "DSH_BOTS_IMAGE_URL is set without DSH_BOTS_IMAGE_MANIFEST_SHA256." "Set both."
  else
    [[ -n $IMAGE_TAG && -n $expected ]] || stop "No base image is published for dsh-bots $DSH_BOTS_VERSION yet." \
      "Build one with infra/vm/build-base-image.sh, or point DSH_BOTS_IMAGE_URL at one."
  fi
  local url dir manifest
  url=$(image_base_url)
  dir=$STATE/downloads/$expected
  manifest=$dir/manifest.txt
  mkdir -p "$dir"
  if [[ ! -f $manifest || $(sha256_of "$manifest") != "$expected" ]]; then
    curl -fsSL "$url/manifest.txt" -o "$manifest" || stop "Downloading $url/manifest.txt failed." "Check the network, then run this again."
  fi
  [[ $(sha256_of "$manifest") == "$expected" ]] || stop "The image manifest's sha256 is not the one this release names." "Run this again; if it persists, report it."
  local format dsh name size fp
  format=$(awk '$1 == "format" {print $2}' "$manifest")
  dsh=$(awk '$1 == "dsh" {print $2}' "$manifest")
  read -r _ name size fp < <(awk '$1 == "image"' "$manifest")
  [[ $format == 1 ]] || stop "The image manifest has format $format, which this installer cannot read." "Use the installer of the same release."
  [[ $dsh == "$DSH_VERSION" ]] || stop "The base image is for DSH $dsh, this release for $DSH_VERSION." "Use the installer of the same release."
  if [[ $(as_root bash -c ". '$TREE/infra/vm/lib.sh'; alias_target dsh-bot-base") == "$fp" ]]; then
    note "up to date"
    return 0
  fi
  local part psize psha
  while read -r _ part psize psha; do
    if [[ -f $dir/$part && $(stat -c %s "$dir/$part") == "$psize" && $(sha256_of "$dir/$part") == "$psha" ]]; then continue; fi
    curl -fL --retry 3 -C - -o "$dir/$part" "$url/$part" || stop "Downloading $part failed." "Check the network, then run this again (it resumes)."
    [[ $(sha256_of "$dir/$part") == "$psha" ]] || { rm -f "$dir/$part"; stop "$part does not have the sha256 the manifest names." "Run this again to download it anew."; }
  done < <(awk '$1 == "part"' "$manifest")
  awk '$1 == "part" {print $2}' "$manifest" | (cd "$dir" && xargs cat) >"$dir/$name"
  [[ $(stat -c %s "$dir/$name") == "$size" && $(sha256_of "$dir/$name") == "$fp" ]] ||
    { rm -f "$dir/$name"; stop "The joined image does not have the sha256 the manifest names." "Run this again."; }
  as_root env DSH_BOTS_REPORT="$REPORT_FILE" DSH_BOTS_NOTE="$NOTE_FILE" bash "$TREE/infra/vm/import-image.sh" "$dir/$name" "$fp"
  rm -rf "$dir"
  note "$(awk -v s="$size" 'BEGIN {printf "%.1f GiB", s / 1073741824}')"
}

step_plugins() {
  local spec=${DSH_BOTS_PACKAGE:-@1outres/dsh-bots@$DSH_BOTS_VERSION}
  local has
  has=$(profile_json '((p.dependencies||{})["@1outres/dsh-bots"]==="'"$DSH_BOTS_VERSION"'")&&((p.dsh&&p.dsh.profile&&p.dsh.profile.bundles)||[]).includes("@1outres/dsh-bots")')
  if [[ -z ${DSH_BOTS_PACKAGE:-} && $has == true ]]; then
    note "@1outres/dsh-bots $DSH_BOTS_VERSION already installed"
    return 0
  fi
  local args=(plugin --profile "$PROFILE" add "$spec")
  [[ -z ${DSH_BOTS_NPM_REGISTRY:-} ]] || args+=(--registry "$DSH_BOTS_NPM_REGISTRY")
  (cd "$HOME" && dsh "${args[@]}") || stop "dsh plugin add $spec failed." "See the log (pnpm's output), fix it, then run this again."
  has=$(profile_json '((p.dsh&&p.dsh.profile&&p.dsh.profile.bundles)||[]).includes("@1outres/dsh-bots")')
  [[ $has == true ]] || stop "The profile $PROFILE does not list the bundle @1outres/dsh-bots after the install." "See the log."
  keep PLUGINS_CHANGED 1
  note "@1outres/dsh-bots $DSH_BOTS_VERSION"
}

step_vm_check() {
  if [[ ${DSH_BOTS_SKIP_VM_CHECK:-} == 1 ]]; then
    note "skipped"
    return 0
  fi
  as_root env DSH_USER="$USER" DSH_BOTS_REPORT="$REPORT_FILE" DSH_BOTS_NOTE="$NOTE_FILE" bash "$TREE/infra/vm/check-vm.sh"
}

# ------------------------------------------------------------- main
finish() {
  [[ -z $SUDO_KEEPALIVE ]] || kill "$SUDO_KEEPALIVE" 2>/dev/null || true
  rm -f "$NOTE_FILE" "$REPORT_FILE" "$KEEP_FILE"
}

main() {
  ((EUID != 0)) || { printf 'dsh-bots: run this as the user that runs DSH, not as root.\n' >&2; exit 1; }
  locate_tree "$@"
  # shellcheck source=infra/vm/lib.sh
  . "$TREE/infra/vm/lib.sh"
  mkdir -p "$STATE/logs"
  LOG=$STATE/logs/install-$(date +%Y%m%d-%H%M%S).log
  # Not in /tmp: root (sudo) may not write another user's file in a sticky directory (protected_regular).
  NOTE_FILE=$(mktemp -p "$STATE" .note.XXXXXX)
  REPORT_FILE=$(mktemp -p "$STATE" .report.XXXXXX)
  KEEP_FILE=$(mktemp -p "$STATE" .keep.XXXXXX)
  export DSH_BOTS_NOTE=$NOTE_FILE DSH_BOTS_REPORT=$REPORT_FILE
  trap finish EXIT
  GROUP_ADDED=0 PLUGINS_CHANGED=0 NIXOS_PENDING=0
  printf '%sdsh-bots installer %s%s\n' "$C_BOLD" "$DSH_BOTS_VERSION" "$C_OFF"
  detect_os
  step "Checking system" step_system
  step "Checking DSH" step_dsh
  # NixOS installs nothing here (dsh-bots.nix does): root only from the next step on.
  if [[ $OS_FAMILY == nixos ]]; then
    step "Installing packages" step_packages
    acquire_root
  else
    acquire_root
    step "Installing packages" step_packages
  fi
  step "Configuring Incus" step_incus
  step "Checking the firewall" step_firewall
  step "Preparing workspaces" step_workspaces
  step "Downloading the base image" step_image
  step "Installing plugins" step_plugins
  step "Testing a VM" step_vm_check
  printf '\n%sDone.%s' "$C_OK" "$C_OFF"
  if ((PLUGINS_CHANGED || GROUP_ADDED)); then
    printf ' Restart DSH to load dsh-bots%s.' "$( ((GROUP_ADDED)) && echo ' (log out and back in first if you start it from a shell: you joined incus-admin)')"
  fi
  printf '\n'
  if ((IS_WSL)); then
    printf '%sWSL stops when idle, and the bot VMs with it: set vmIdleTimeout=-1 in .wslconfig, or keep "wsl.exe --exec sleep infinity" running.%s\n' "$C_DIM" "$C_OFF"
  fi
}

main "$@"
