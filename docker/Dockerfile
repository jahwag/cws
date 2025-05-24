# Ultra-minimal build with aggressive optimization
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend
COPY web/client/package*.json ./
RUN npm install
COPY web/client/ ./
RUN npm run generate

# Stage 2: Build server with optimization
FROM node:20-alpine AS server-builder

WORKDIR /server
# Use virtual packages for build dependencies
RUN apk add --no-cache --virtual .build-deps make g++ python3-dev
COPY web/server/package*.json ./
RUN npm install --only=production && \
    # Remove unnecessary files from node_modules
    find node_modules -type f -name "*.md" -delete && \
    find node_modules -type f -name "*.txt" -delete && \
    find node_modules -type f -name "*.yml" -delete && \
    find node_modules -type f -name "*.yaml" -delete && \
    find node_modules -type f -name ".npmignore" -delete && \
    find node_modules -type f -name ".gitignore" -delete && \
    find node_modules -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "example" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "examples" -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name ".github" -exec rm -rf {} + 2>/dev/null || true && \
    # Remove source maps
    find node_modules -type f -name "*.map" -delete && \
    # Clean up build dependencies
    apk del .build-deps

# Stage 3: Build Claude CLI with optimization
FROM node:20-alpine AS claude-builder

WORKDIR /claude
RUN npm install --prefix /claude @anthropic-ai/claude-code && \
    # Remove unnecessary files from Claude CLI
    find /claude/node_modules -type f -name "*.md" -delete && \
    find /claude/node_modules -type f -name "*.txt" -delete && \
    find /claude/node_modules -type d -name "test" -exec rm -rf {} + 2>/dev/null || true && \
    find /claude/node_modules -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true

# Stage 4: Minimal runtime with precise copying
FROM alpine:3.19

# Install only essential runtime dependencies in one layer
RUN apk add --no-cache \
    nodejs \
    git \
    bash \
    openssh-client \
    ca-certificates \
    # User management
    shadow \
    sudo \
    # Firewall (optional but included for compatibility)
    iptables \
    ipset && \
    # Clean APK cache (though --no-cache should handle this)
    rm -rf /var/cache/apk/* && \
    # Pre-configure git to avoid runtime operations
    git config --global init.defaultBranch main && \
    git config --global user.email "claude@workspace" && \
    git config --global user.name "Claude" && \
    # Pre-create SSH directory and known hosts
    mkdir -p /root/.ssh && \
    ssh-keyscan -t rsa,ed25519 github.com gitlab.com bitbucket.org >> /root/.ssh/known_hosts 2>/dev/null

# Copy only production artifacts with precise paths
COPY --from=server-builder /server/node_modules /claude-workspace/web/server/node_modules
COPY --from=frontend-builder /frontend/.output/public /claude-workspace/web/client/dist
COPY --from=claude-builder /claude/node_modules/@anthropic-ai/claude-code /opt/claude/.npm-global/lib/node_modules/@anthropic-ai/claude-code

# Copy application files
WORKDIR /claude-workspace
COPY web/server/server.js /claude-workspace/web/server/
COPY mcp-servers /claude-workspace/mcp-servers
COPY docker/mcp-config.json /tmp/
COPY docker/entrypoint.sh docker/init-firewall.sh /usr/local/bin/

# Single RUN command for all setup operations
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/init-firewall.sh && \
    # Create required directories including bin
    mkdir -p /var/lib/claude /etc/claude /opt/claude/.npm-global/bin && \
    # Create Claude CLI wrapper
    echo '#!/usr/bin/node' > /opt/claude/.npm-global/bin/claude && \
    echo "require('/opt/claude/.npm-global/lib/node_modules/@anthropic-ai/claude-code/dist/index.js')" >> /opt/claude/.npm-global/bin/claude && \
    chmod 755 /opt/claude/.npm-global/bin/claude && \
    # Setup sudo for firewall script
    echo "ALL ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/firewall && \
    chmod 0440 /etc/sudoers.d/firewall

# Environment variables
ENV NPM_CONFIG_PREFIX=/opt/claude/.npm-global \
    PATH=/opt/claude/.npm-global/bin:$PATH \
    NODE_ENV=production

WORKDIR /home
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]