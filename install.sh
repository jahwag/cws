#!/bin/bash
# Claude Workspace installer
set -e

# Parse arguments
LOCAL_DEV=false
while [ $# -gt 0 ]; do
  case $1 in
    --local)
      LOCAL_DEV=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --local       Use local docker-compose.yml for development"
      echo "  -h, --help    Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "🚀 Installing Claude Workspace..."

# Create necessary directories with proper permissions
if [ -d ~/.claude-workspace ] && [ ! -w ~/.claude-workspace ]; then
  echo "🔐 Fixing permissions for existing ~/.claude-workspace directory..."
  sudo chown -R $USER:$USER ~/.claude-workspace
fi

mkdir -p ~/.claude-workspace
mkdir -p ~/.claude-workspace/users

if [ "$LOCAL_DEV" = true ]; then
  # Get the directory where this script is located
  SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
  if [ -f "$SCRIPT_DIR/docker/docker-compose.yml" ]; then
    echo "📁 Using local docker-compose.yml..."
    cp "$SCRIPT_DIR/docker/docker-compose.yml" ~/.claude-workspace/docker-compose.yml
  else
    echo "❌ Error: docker/docker-compose.yml not found in $SCRIPT_DIR"
    exit 1
  fi
else
  echo "📥 Downloading docker-compose.yml..."
  curl -fsSL https://raw.githubusercontent.com/jahwag/cws/main/docker/docker-compose.yml > ~/.claude-workspace/docker-compose.yml
fi


# Create .env file template if it doesn't exist
if [ ! -f ~/.claude-workspace/.env ]; then
  cat > ~/.claude-workspace/.env << 'EOF'
# OAuth Configuration (optional)
# Uncomment and configure to enable OAuth authentication
# OIDC_ENABLED=true
# OIDC_CLIENT_ID=your-client-id
# OIDC_CLIENT_SECRET=your-client-secret
# OIDC_ISSUER=https://your-oidc-provider.com
# OIDC_REDIRECT_URI=http://localhost:8080/auth/callback
EOF
  echo "📝 Created .env template at ~/.claude-workspace/.env"
fi

# Get network information
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
PUBLIC_IP=$(curl -s https://api.ipify.org 2>/dev/null || echo "unknown")

# Start the service
echo "🚀 Starting Claude Workspace..."
if [ "$LOCAL_DEV" = true ]; then
  export CWS_IMAGE=cws:local
else
  export CWS_IMAGE=ghcr.io/jahwag/cws:latest
fi

# Use docker-compose or docker compose depending on what's available
if command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
else
  DOCKER_COMPOSE="docker compose"
fi

cd ~/.claude-workspace && $DOCKER_COMPOSE up -d

# Wait for service to be ready
echo "⏳ Waiting for service to start..."
for i in {1..30}; do
  if curl -s http://localhost:8080/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
echo "✅ Claude Workspace is running!"
echo ""
echo "🌐 Access URLs:"
echo "   Local:    http://localhost:8080"
if [ "$LOCAL_IP" != "unknown" ]; then
  echo "   Network:  http://$LOCAL_IP:8080"
fi
if [ "$PUBLIC_IP" != "unknown" ]; then
  echo "   Public:   http://$PUBLIC_IP:8080 (requires port forwarding)"
fi
echo ""
echo "📋 Commands:"
if command -v docker-compose >/dev/null 2>&1; then
  echo "   Stop:     cd ~/.claude-workspace && docker-compose down"
  echo "   Start:    cd ~/.claude-workspace && docker-compose up -d"
  echo "   Logs:     cd ~/.claude-workspace && docker-compose logs -f"
else
  echo "   Stop:     cd ~/.claude-workspace && docker compose down"
  echo "   Start:    cd ~/.claude-workspace && docker compose up -d"
  echo "   Logs:     cd ~/.claude-workspace && docker compose logs -f"
fi
echo "   Config:   nano ~/.claude-workspace/.env"