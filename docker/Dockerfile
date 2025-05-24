# Claude's Development Environment with Web UI
# A containerized workspace with web-based access to Claude CLI
# Version: 1.0.1

# Build stage for Nuxt frontend
FROM node:20-alpine AS node-builder
WORKDIR /build
COPY web/client/package.json ./
RUN npm install
COPY web/client/ ./
RUN npm run generate

# Final runtime image
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    nodejs \
    npm \
    python3 \
    py3-pip \
    openjdk21-jre \
    git \
    curl \
    bash \
    zsh \
    openssh-client \
    file \
    && rm -rf /var/cache/apk/*

# Create npm directory outside of /home to avoid volume mount conflicts
RUN mkdir -p /opt/claude/.npm-global

# Install build dependencies for node-pty
RUN apk add --no-cache make g++ python3-dev

# Install server dependencies
WORKDIR /claude-workspace/web/server
COPY web/server/package.json ./
RUN npm install --production
COPY web/server/server.js ./

# Remove build dependencies
RUN apk del make g++ python3

# Create workspace directory
WORKDIR /claude-workspace

# Copy built artifacts
COPY --from=node-builder /build/.output/public /claude-workspace/web/client/dist

# Copy MCP servers
COPY mcp-servers /claude-workspace/mcp-servers

# Set up git configuration
RUN git config --global init.defaultBranch main

# Add GitHub to known hosts
RUN mkdir -p /root/.ssh && \
    ssh-keyscan -H github.com >> /root/.ssh/known_hosts

# Create system directories with proper permissions
RUN mkdir -p /var/lib/claude && \
    chmod 700 /var/lib/claude && \
    # Public config directory for non-sensitive files
    mkdir -p /etc/claude && \
    chmod 755 /etc/claude

# Mount workspace guidelines from host if provided
# Guidelines can be placed at ~/.config/claude-workspace/CLAUDE.md

# Install shadow for proper su command and sudo
RUN apk add --no-cache shadow sudo && \
    # Fix su permissions
    chmod u+s /bin/su

# Create a template user for development/fallback only
RUN if [ -z "$OIDC_ENABLED" ] || [ "$OIDC_ENABLED" != "true" ]; then \
        adduser -D -s /bin/zsh claude && \
        echo "claude:claude123" | chpasswd; \
    fi

# Copy MCP configuration template
COPY docker/mcp-config.json /tmp/mcp-config.json

# Stay as root for user switching capability
# USER claude
# Configure npm to use directory outside of /home mount
ENV NPM_CONFIG_PREFIX=/opt/claude/.npm-global
ENV PATH=/opt/claude/.npm-global/bin:$PATH

# Install Claude CLI with explicit prefix configuration
RUN npm config set prefix /opt/claude/.npm-global && \
    npm install -g @anthropic-ai/claude-code && \
    # Verify installation
    ls -la /opt/claude/.npm-global/lib/node_modules/@anthropic-ai/claude-code/ && \
    # Check if cli.js exists
    test -f /opt/claude/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js || \
    (echo "ERROR: Claude Code cli.js not found after installation" && exit 1)

# Default working directory
WORKDIR /home

# Fix Claude CLI shebang for Alpine Linux
RUN sed -i '1s|.*|#!/usr/bin/node --no-warnings --enable-source-maps|' /opt/claude/.npm-global/bin/claude && \
    chmod 755 /opt/claude/.npm-global/bin/claude && \
    # Make Claude accessible to all users
    chmod -R 755 /opt/claude/.npm-global && \
    # Ensure all files are readable
    find /opt/claude/.npm-global -type f -exec chmod 644 {} \; && \
    find /opt/claude/.npm-global -type d -exec chmod 755 {} \;

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose web UI port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start with entrypoint to initialize firewall
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]