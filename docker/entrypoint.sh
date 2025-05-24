#!/bin/bash
set -e

# Function to initialize firewall in background after a delay
init_firewall_delayed() {
    # Wait for DNS to be available
    echo "🔒 Waiting for network to be ready..."
    for i in {1..30}; do
        if nslookup github.com >/dev/null 2>&1; then
            echo "✅ Network is ready"
            break
        fi
        if [ $i -eq 30 ]; then
            echo "⚠️  Network not ready after 30 seconds, skipping firewall"
            return 1
        fi
        sleep 1
    done
    
    echo "🔒 Initializing network restrictions..."
    if /usr/local/bin/init-firewall.sh 2>&1; then
        echo "✅ Network restrictions applied successfully"
    else
        echo "⚠️  Failed to initialize firewall, continuing without restrictions"
    fi
}

# Initialize firewall if requested (in background)
if [ "${ENABLE_NETWORK_RESTRICTIONS:-false}" = "true" ]; then
    init_firewall_delayed &
else
    echo "ℹ️  Network restrictions disabled (set ENABLE_NETWORK_RESTRICTIONS=true to enable)"
fi

# Start the web server
echo "🚀 Starting Claude Workspace server..."
cd /claude-workspace/web/server
exec node --no-warnings --enable-source-maps server.js