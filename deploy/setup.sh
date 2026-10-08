#!/usr/bin/env bash
# Puts Stockyard on a fresh Ubuntu server: Node 22, the app as a service, Caddy in front for HTTPS.
# Usage, on the server:  bash setup.sh        Run it again at any time to update to the latest code.
#
# The site's name is the server's public address written with dashes under sslip.io
# (13.250.1.2 becomes 13-250-1-2.sslip.io), so HTTPS works without buying a domain.
# To use a real domain, point it at the server and set STOCKYARD_HOST=your.domain first.
#
# The keys are never in the repository. Upload your .env to ~/stockyard.env before running this
# and it is moved into place, readable by this user only.
set -euo pipefail

REPO=${STOCKYARD_REPO:-https://github.com/Glayzz/stockyard.git}
DIR=/opt/stockyard

if [ -z "${STOCKYARD_HOST:-}" ]; then
  token=$(curl -fsS -m 5 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  ip=$(curl -fsS -m 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4)
  STOCKYARD_HOST=${ip//./-}.sslip.io
fi
echo "== Setting up https://$STOCKYARD_HOST"

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

sudo mkdir -p "$DIR"
sudo chown "$USER" "$DIR"
if [ -d "$DIR/.git" ]; then
  # The server only ever runs what is on main; the files it writes itself are not tracked.
  git -C "$DIR" fetch -q --depth 1 origin main
  git -C "$DIR" reset -q --hard origin/main
else
  git clone -q --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

if [ -f "$HOME/stockyard.env" ]; then
  install -m 600 "$HOME/stockyard.env" "$DIR/.env"
  rm "$HOME/stockyard.env"
fi
[ -f "$DIR/.env" ] || echo "!! No .env yet: the site will run on its saved league until the keys are uploaded."

sudo tee /etc/systemd/system/stockyard.service >/dev/null <<UNIT
[Unit]
Description=Stockyard
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
Environment=PORT=4173
Environment=PUBLIC_URL=https://$STOCKYARD_HOST
ExecStart=$(command -v node) server/dev.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable -q stockyard
sudo systemctl restart stockyard

sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$STOCKYARD_HOST {
	encode gzip
	reverse_proxy localhost:4173
}
CADDY
sudo systemctl reload caddy || sudo systemctl restart caddy

for _ in $(seq 1 30); do
  if health=$(curl -fsS -m 5 localhost:4173/api/health 2>/dev/null); then break; fi
  sleep 2
done
echo "== Health: ${health:-the app did not answer; see: journalctl -u stockyard -n 50}"
echo "== Live at https://$STOCKYARD_HOST"
