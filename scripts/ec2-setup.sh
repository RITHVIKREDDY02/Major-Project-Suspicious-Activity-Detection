#!/bin/bash
# Run this ONCE on a fresh AWS EC2 instance (Ubuntu 22.04 / 24.04)
# Usage: bash ec2-setup.sh

set -e

REPO_URL="${1:-https://github.com/RITHVIKREDDY02/Major-Project---Suspicious-Activity-Detection.git}"
APP_DIR="/opt/sar-detection"

echo "=========================================="
echo "  SAR Detection — EC2 Setup Script"
echo "=========================================="

# ── 1. System packages ──────────────────────────────────────────────────────
echo ""
echo "==> Installing system packages..."
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates

# ── 2. Docker ────────────────────────────────────────────────────────────────
echo ""
echo "==> Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "    Docker installed. NOTE: You may need to log out and back in for group changes to take effect."
else
  echo "    Docker already installed — skipping."
fi

# ── 3. Docker Compose (plugin) ───────────────────────────────────────────────
echo ""
echo "==> Checking Docker Compose..."
if ! docker compose version &>/dev/null; then
  sudo apt-get install -y docker-compose-plugin
fi
echo "    $(docker compose version)"

# ── 4. Clone the repo ────────────────────────────────────────────────────────
echo ""
echo "==> Cloning repository to $APP_DIR..."
if [ -d "$APP_DIR" ]; then
  echo "    Directory already exists — pulling latest instead."
  cd "$APP_DIR"
  git pull origin main
else
  sudo git clone "$REPO_URL" "$APP_DIR"
  sudo chown -R "$USER:$USER" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 5. Create .env file ──────────────────────────────────────────────────────
echo ""
echo "==> Setting up environment file..."
if [ ! -f "$APP_DIR/.env" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 16)

  cat > "$APP_DIR/.env" <<EOF
DB_PASSWORD=$DB_PASSWORD
SESSION_SECRET=$SESSION_SECRET
COOKIE_SECURE=false
EOF

  echo "    .env file created with random secrets."
  echo ""
  echo "    ⚠️  IMPORTANT: Edit $APP_DIR/.env if you need to customize settings."
  echo "    ⚠️  If your EC2 is behind HTTPS, set COOKIE_SECURE=true"
else
  echo "    .env already exists — skipping."
fi

# ── 6. Build and start ───────────────────────────────────────────────────────
echo ""
echo "==> Building and starting containers (this takes a few minutes first time)..."
cd "$APP_DIR"
docker compose up --build -d

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "  App is running at:  http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')"
echo ""
echo "  Useful commands:"
echo "    cd $APP_DIR"
echo "    docker compose logs -f          # view live logs"
echo "    docker compose ps               # check container status"
echo "    docker compose down             # stop the app"
echo "    docker compose up --build -d    # rebuild and restart"
echo ""
echo "  ⚠️  Open port 80 in your EC2 Security Group if the app is not reachable."
