# claude workspace

claude in a box - a web-based interface for Claude CLI.

```bash
curl -sSL https://raw.githubusercontent.com/jahwag/cws/main/install.sh | bash
```

Access at http://localhost:8080

## Configuration

Optional OAuth authentication can be configured in `~/.claude-workspace/.env`:

```env
OIDC_ENABLED=true
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_ISSUER=https://your-oidc-provider.com
OIDC_REDIRECT_URI=http://localhost:8080/auth/callback
```

### Network Restrictions

Enable network access restrictions to limit outbound connections:

```env
ENABLE_NETWORK_RESTRICTIONS=true
```

When enabled, only the following connections are allowed:
- DNS queries
- GitHub API and repositories
- npm registry
- PyPI (Python packages)
- Docker Hub
- Your OAuth provider (if configured)
- Local connections (localhost)

Restart after changes: `cd ~/.claude-workspace && docker compose restart`