#!/bin/bash
set -e

# Start the web server
echo "🚀 Starting Claude Workspace server..."
cd /claude-workspace/web/server
exec node --no-warnings --enable-source-maps server.js