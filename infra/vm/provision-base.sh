#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
NODE_MAJOR=${NODE_MAJOR:-24}
BOT_USER=${BOT_USER:-bot}
BOT_UID=1001
DSH_VERSION=${DSH_VERSION:?DSH_VERSION required}
HELPER_SHA256=${HELPER_SHA256:-}
read -ra desktop_packages <<<"${DESKTOP_PACKAGES:?DESKTOP_PACKAGES required}"
BROWSER_MCP_STAGE=${BROWSER_MCP_STAGE:?BROWSER_MCP_STAGE required}
BROWSER_MCP_DIR=${BROWSER_MCP_DIR:?BROWSER_MCP_DIR required}
BROWSER_HELPER_STAGE=${BROWSER_HELPER_STAGE:?BROWSER_HELPER_STAGE required}
BROWSER_HELPER_DIR=${BROWSER_HELPER_DIR:?BROWSER_HELPER_DIR required}

apt-get update -q
apt-get full-upgrade -y -q
apt-get install -y -q --no-install-recommends \
  openssh-server ca-certificates curl git ripgrep python3 python3-venv \
  build-essential pkg-config make jq less unzip xz-utils zstd file procps \
  iproute2 netbase locales tzdata sudo qemu-guest-agent

apt-get install -y -q --no-install-recommends "${desktop_packages[@]}"

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  -o /etc/apt/keyrings/nodesource.asc
cat >/etc/apt/sources.list.d/nodesource.sources <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${NODE_MAJOR}.x
Suites: nodistro
Components: main
Signed-By: /etc/apt/keyrings/nodesource.asc
EOF
cat >/etc/apt/preferences.d/nodejs <<'EOF'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF
apt-get update -q
apt-get install -y -q nodejs
rg --version | head -1

HELPER_DIR=/opt/dsh-ssh-helper
install -d -m 0755 -o root -g root "$HELPER_DIR"
npm install --prefix "$HELPER_DIR" --no-fund --no-audit "@deepseek-ai/dsh-ssh@${DSH_VERSION}"
HELPER_JS=$HELPER_DIR/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js
actual=$(sha256sum "$HELPER_JS" | cut -d' ' -f1)
if [[ -n ${HELPER_SHA256:-} && $actual != "$HELPER_SHA256" ]]; then
  echo "helper.js sha256 mismatch: got $actual, want $HELPER_SHA256" >&2
  exit 1
fi
echo "helper.js sha256 $actual"
chown -R root:root "$HELPER_DIR"
chmod -R go-w "$HELPER_DIR"
npm cache clean --force >/dev/null 2>&1 || true

sh "$BROWSER_MCP_STAGE/install-mcp.sh" "$BROWSER_MCP_STAGE" "$BROWSER_MCP_DIR"
rm -rf "$BROWSER_MCP_STAGE"
sh "$BROWSER_HELPER_STAGE/install-helper.sh" "$BROWSER_HELPER_STAGE" "$BROWSER_HELPER_DIR"
rm -rf "$BROWSER_HELPER_STAGE"
rm -rf /root/.npm

if id debian >/dev/null 2>&1; then
  userdel --remove debian
  rm -f /etc/sudoers.d/90-cloud-init-users
fi
if ! id "$BOT_USER" >/dev/null 2>&1; then
  groupadd --gid "$BOT_UID" "$BOT_USER"
  useradd --uid "$BOT_UID" --gid "$BOT_UID" --create-home --shell /bin/bash "$BOT_USER"
fi
[[ $(id -u "$BOT_USER"):$(id -g "$BOT_USER") == "$BOT_UID:$BOT_UID" ]] ||
  { echo "$BOT_USER is $(id -u "$BOT_USER"):$(id -g "$BOT_USER"), not $BOT_UID:$BOT_UID" >&2; exit 1; }
passwd -l "$BOT_USER" >/dev/null
install -d -m 0755 -o "$BOT_USER" -g "$BOT_USER" "/home/$BOT_USER/workspace"
install -d -m 0700 -o "$BOT_USER" -g "$BOT_USER" "/home/$BOT_USER/.ssh"
: >"/home/$BOT_USER/.ssh/authorized_keys"
chown "$BOT_USER:$BOT_USER" "/home/$BOT_USER/.ssh/authorized_keys"
chmod 0600 "/home/$BOT_USER/.ssh/authorized_keys"

cat >/etc/sudoers.d/90-dsh-bot <<EOF
$BOT_USER ALL=(ALL) NOPASSWD:ALL
EOF
chown root:root /etc/sudoers.d/90-dsh-bot
chmod 0440 /etc/sudoers.d/90-dsh-bot
visudo -c -q

cat >/etc/ssh/sshd_config.d/10-dsh-bot.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers $BOT_USER
X11Forwarding no
AllowAgentForwarding no
# dsh-ssh talks to its helper over a forwarded Unix socket.
AllowStreamLocalForwarding yes
EOF
cat >/etc/modules-load.d/dsh-vsock.conf <<'EOF2'
vmw_vsock_virtio_transport
EOF2
cat >/etc/systemd/system/sshd-vsock.socket <<'EOF2'
[Unit]
Description=OpenSSH Server Socket (AF_VSOCK, dsh)
Before=sockets.target
After=systemd-modules-load.service
ConditionPathExists=!/etc/ssh/sshd_not_to_be_run

[Socket]
ListenStream=vsock::22
Accept=yes
PollLimitIntervalSec=30s
PollLimitBurst=50

[Install]
WantedBy=sockets.target
EOF2
cat >/etc/systemd/system/sshd-vsock@.service <<'EOF2'
[Unit]
Description=OpenSSH per-connection server (AF_VSOCK, dsh)
Documentation=man:sshd(8)
After=nss-user-lookup.target sshd-keygen.service

[Service]
EnvironmentFile=-/etc/default/ssh
# Host keys normally come from cloud-init (injected by the host); fallback.
ExecStartPre=/bin/sh -c '[ -e /etc/ssh/ssh_host_ed25519_key ] || /usr/bin/ssh-keygen -A'
ExecStart=-/usr/sbin/sshd -i $SSHD_OPTS
StandardInput=socket
StandardError=journal
RuntimeDirectory=sshd
RuntimeDirectoryPreserve=yes
RuntimeDirectoryMode=0755
EOF2
rm -rf /etc/systemd/system/ssh.service.d
systemctl disable ssh.service ssh.socket 2>/dev/null || true
systemctl mask ssh.service ssh.socket
systemctl enable sshd-vsock.socket

cat >/etc/systemd/system/dsh-cloud-seed-perms.service <<'EOF2'
[Unit]
Description=Restrict cloud-init seed permissions (dsh)
DefaultDependencies=no
After=incus-agent.service local-fs.target
Before=cloud-init-local.service sysinit.target sshd-vsock.socket

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'install -d -m 0700 /var/lib/cloud/seed; chmod -R go-rwx /var/lib/cloud/seed'

[Install]
WantedBy=sysinit.target
EOF2
systemctl enable dsh-cloud-seed-perms.service

cat >/etc/cloud/cloud.cfg.d/90-dsh-bot.cfg <<EOF
users: []
disable_root: true
ssh_pwauth: false
ssh_deletekeys: true
ssh_genkeytypes: [ed25519, ecdsa, rsa]
package_update: false
package_upgrade: false
EOF

systemctl disable --now apt-daily.timer apt-daily-upgrade.timer man-db.timer \
  e2scrub_all.timer 2>/dev/null || true
if [[ -f /etc/default/grub ]]; then
  sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=0/' /etc/default/grub
  update-grub >/dev/null 2>&1 || true
fi

apt-get autoremove -y -q
apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -f /etc/ssh/ssh_host_*
rm -f /root/.bash_history "/home/$BOT_USER/.bash_history"
journalctl --rotate >/dev/null 2>&1 || true
journalctl --vacuum-time=1s >/dev/null 2>&1 || true
cloud-init clean --logs --seed --machine-id
fstrim -av || true
echo "node $(node --version) / npm $(npm --version) / rg $(rg --version | head -1)"
