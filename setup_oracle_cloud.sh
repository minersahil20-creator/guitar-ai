#!/usr/bin/env bash
set -e

echo "=========================================="
echo " Setting up Guitar AI on Oracle Cloud     "
echo "=========================================="

# 1. Update packages and install Docker + git
sudo apt-get update
sudo apt-get install -y docker.io git curl iptables-persistent

sudo systemctl enable --now docker

# 2. Open HTTP ports in Ubuntu firewall
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8000 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || true

# 3. Clone or pull repository
INSTALL_DIR="$HOME/guitar-ai"
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing repository..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    echo "Cloning repository..."
    git clone https://github.com/minersahil20-creator/guitar-ai.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 4. Build Docker container
echo "Building Guitar AI container..."
sudo docker build -t guitar-ai .

# 5. Stop any existing container
sudo docker stop guitar-ai 2>/dev/null || true
sudo docker rm guitar-ai 2>/dev/null || true

# 6. Run container with auto-restart on boot (24/7)
echo "Starting Guitar AI container..."
sudo docker run -d \
    --name guitar-ai \
    --restart always \
    -p 80:10000 \
    -p 8000:10000 \
    -e PORT=10000 \
    guitar-ai

PUBLIC_IP=$(curl -s https://ifconfig.me || curl -s https://api.ipify.org || echo "YOUR_SERVER_IP")

echo "=========================================="
echo " SUCCESS! Guitar AI is running 24/7!      "
echo " Open in your phone or computer at:       "
echo " http://$PUBLIC_IP                        "
echo "=========================================="
