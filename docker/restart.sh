#!/bin/bash

# Load environment variables from ~/.claude-workspace/.env if it exists
if [ -f "$HOME/.claude-workspace/.env" ]; then
    export $(grep -v '^#' "$HOME/.claude-workspace/.env" | xargs)
fi

docker rm -f claude-workspace
docker compose -f "$(dirname "$0")/docker-compose.yml" down --rmi all --volumes
# Force local build
export CWS_IMAGE=cws:local
docker compose -f "$(dirname "$0")/docker-compose.yml" build --no-cache
docker compose -f "$(dirname "$0")/docker-compose.yml" up -d