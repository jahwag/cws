const express = require('express');
const { WebSocketServer } = require('ws');
const { spawn } = require('node-pty');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { spawn: spawnChild, exec, execSync } = require('child_process');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Session storage
const sessions = new Map();

// OAuth configuration from environment
const OIDC_ENABLED = process.env.OIDC_ENABLED === 'true';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_ISSUER = process.env.OIDC_ISSUER;
const OIDC_REDIRECT_URI = process.env.OIDC_REDIRECT_URI || 'http://localhost:8080/auth/callback';

// OAuth client (initialized if enabled)
let oidcClient = null;

// Generate deterministic username from OIDC sub
function getUsernameFromSub(oidcSub) {
  const hash = crypto.createHash('sha256').update(oidcSub).digest('hex');
  return 'u' + hash.substring(0, 12); // u + first 12 chars of hash
}

// Initialize OIDC client if enabled
let oidcConfiguration = null;
if (OIDC_ENABLED && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET && OIDC_ISSUER) {
  (async () => {
    try {
      const { discovery } = await import('openid-client');
      const config = await discovery(new URL(OIDC_ISSUER), OIDC_CLIENT_ID, OIDC_CLIENT_SECRET);
      oidcConfiguration = config;
      oidcClient = config; // Store for later use
      console.log('OIDC client initialized successfully');
    } catch (err) {
      console.error('Failed to initialize OIDC client:', err);
      // Don't exit on init failure - server can still run without OAuth
    }
  })();
}

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../../web/client/dist')));

// Helper to extract session from request
const getSessionId = (req) => {
  // First check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  // Fall back to cookie
  return req.cookies.session;
};

// Authentication middleware
const authenticate = (req, res, next) => {
  const sessionId = getSessionId(req);
  const session = sessions.get(sessionId);
  
  if (!session || Date.now() - session.createdAt > 24 * 60 * 60 * 1000) { // 24 hour timeout
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  req.session = session;
  req.sessionId = sessionId;
  next();
};

// Check if OAuth is enabled
app.get('/api/auth/config', (req, res) => {
  res.json({ oidcEnabled: OIDC_ENABLED });
});

// OAuth login endpoint - redirects to OIDC provider
app.get('/auth/login', async (req, res) => {
  if (!OIDC_ENABLED || !oidcClient) {
    return res.status(503).json({ error: 'OAuth not configured' });
  }
  
  try {
    const { buildAuthorizationUrl, randomState } = await import('openid-client');
    const state = randomState();
    
    // Store state in session for verification
    const stateSession = crypto.randomUUID();
    sessions.set(stateSession, { state, createdAt: Date.now() });
    res.cookie('oauth_state', stateSession, { httpOnly: true, maxAge: 600000 }); // 10 min
    
    const authorizationUrl = buildAuthorizationUrl(oidcClient, {
      scope: 'openid email',
      state,
      redirect_uri: OIDC_REDIRECT_URI,
    });
    
    res.redirect(authorizationUrl.href);
  } catch (err) {
    console.error('OAuth login error:', err);
    res.status(500).json({ error: 'OAuth login failed' });
  }
});

// OAuth callback endpoint
app.get('/auth/callback', async (req, res) => {
  if (!OIDC_ENABLED || !oidcClient) {
    return res.status(503).json({ error: 'OAuth not configured' });
  }
  
  try {
    const { authorizationCodeGrant, fetchUserInfo } = await import('openid-client');
    
    // Verify state
    const stateSession = req.cookies.oauth_state;
    const stateData = sessions.get(stateSession);
    if (!stateData || req.query.state !== stateData.state) {
      return res.status(400).send('Invalid state');
    }
    sessions.delete(stateSession);
    res.clearCookie('oauth_state');
    
    // Exchange code for tokens
    const currentUrl = new URL(req.url, `${req.protocol}://${req.get('host')}`);
    const tokens = await authorizationCodeGrant(oidcClient, currentUrl, {
      expectedState: stateData.state,
    });
    
    // Get user info
    const userInfo = await fetchUserInfo(oidcClient, tokens.access_token, tokens.claims().sub);
    
    // Generate deterministic username from OIDC sub
    const oidcSub = tokens.claims().sub;
    const username = getUsernameFromSub(oidcSub);
    
    // Check if OS user exists
    let userExists = false;
    try {
      execSync(`id ${username}`, { stdio: 'ignore' });
      userExists = true;
    } catch (err) {
      // User doesn't exist
    }
    
    if (!userExists) {
      
      // Create OS user
      try {
        console.log(`Creating OS user: ${username}`);
        execSync(`useradd -m -s /bin/zsh ${username}`);
        console.log(`User ${username} created successfully`);
        
        // Set up user environment
        execSync(`mkdir -p /home/${username}/.ssh`);
        execSync(`mkdir -p /home/${username}/.claude`);
        execSync(`cp /tmp/mcp-config.json /home/${username}/.claude/mcp-config.json`);
        execSync(`chown -R ${username}:${username} /home/${username}`);
        execSync(`chmod 700 /home/${username}/.ssh`);
        
        console.log(`Created new OS user: ${username}`);
      } catch (err) {
        console.error('Failed to create OS user:', err.message);
        console.error('stderr:', err.stderr?.toString());
        return res.status(500).send('Failed to create user');
      }
    }
    

    // Configure Git identity from OIDC claims
    try {
      console.log(`Configuring Git identity for user ${username}`);
      
      // Set Git user name - use name claim, fallback to email prefix, then username
      let gitName = userInfo.name;
      if (!gitName && userInfo.email) {
        // Extract name from email (e.g., "john.doe@example.com" -> "John Doe")
        gitName = userInfo.email.split('@')[0]
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, char => char.toUpperCase());
      }
      if (!gitName) {
        // Final fallback: use the username
        gitName = username;
      }
      
      execSync(`su - ${username} -c 'git config --global user.name "${gitName}"'`);
      
      if (userInfo.email) {
        execSync(`su - ${username} -c 'git config --global user.email "${userInfo.email}"'`);
      }
      
      // Configure Git - basic settings only
      execSync(`su - ${username} -c 'git config --global init.defaultBranch main'`);
      
      console.log(`Configured Git identity: ${userInfo.name} <${userInfo.email}>`);
    } catch (err) {
      console.error('Failed to configure Git identity:', err.message);
      // Continue - Git config is not critical
    }

    // Note: Users need to authenticate with GitHub separately
    // The OIDC token is only for accessing this Claude Workspace, not GitHub

    // Create session
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      username,
      oidcSub,
      email: userInfo.email,
      name: userInfo.name,
      createdAt: Date.now(),
      ptyProcess: null
    });
    
    console.log(`Created session ${sessionId} for user ${username}`);
    
    // Set cookie for SSO (shared across tabs)
    res.cookie('session', sessionId, {
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    console.log(`Set cookie for session ${sessionId}`);
    
    // Redirect to app (no session in URL needed)
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed');
  }
});

// OAuth-only authentication - no legacy login

// Simple auth bypass for non-OAuth mode
if (process.env.OIDC_ENABLED !== 'true') {
  app.post('/api/login-bypass', (req, res) => {
    // Create a default session without authentication
    const username = 'claude';
    const sessionId = crypto.randomUUID();
    
    sessions.set(sessionId, {
      username,
      oidcSub: 'local-user',
      email: 'user@localhost',
      name: 'Local User',
      createdAt: Date.now(),
      ptyProcess: null
    });
    
    res.cookie('session', sessionId, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ success: true });
  });
}

// Session check endpoint
app.get('/api/session', (req, res) => {
  const sessionId = getSessionId(req);
  const session = sessions.get(sessionId);
  
  console.log(`Session check: sessionId=${sessionId}, found=${!!session}, totalSessions=${sessions.size}`);
  console.log(`Cookies:`, req.cookies);
  
  if (session) {
    res.json({ authenticated: true, username: session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// Logout endpoint
app.post('/api/logout', authenticate, (req, res) => {
  const sessionId = req.sessionId;
  const session = sessions.get(sessionId);
  
  if (session?.ptyProcess) {
    session.ptyProcess.kill();
  }
  
  sessions.delete(sessionId);
  res.clearCookie('session'); // Clear cookie if it exists
  res.json({ success: true });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'claude-workspace' });
});

// Diagnostic endpoint for Claude Code installation
app.get('/api/diagnostics', (req, res) => {
  const claudePath = '/home/claude/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js';
  const claudeBin = '/home/claude/.npm-global/bin/claude';
  
  const diagnostics = {
    claudeCodeInstalled: fs.existsSync(claudePath),
    claudeBinExists: fs.existsSync(claudeBin),
    claudePath,
    claudeBin,
    npmPrefix: process.env.NPM_CONFIG_PREFIX,
    path: process.env.PATH,
  };
  
  // Check directory contents if path doesn't exist
  if (!diagnostics.claudeCodeInstalled) {
    try {
      const npmGlobalPath = '/home/claude/.npm-global';
      diagnostics.npmGlobalExists = fs.existsSync(npmGlobalPath);
      
      if (diagnostics.npmGlobalExists) {
        const libPath = path.join(npmGlobalPath, 'lib');
        diagnostics.libExists = fs.existsSync(libPath);
        
        if (diagnostics.libExists) {
          const nodeModulesPath = path.join(libPath, 'node_modules');
          diagnostics.nodeModulesExists = fs.existsSync(nodeModulesPath);
          
          if (diagnostics.nodeModulesExists) {
            diagnostics.nodeModulesContents = fs.readdirSync(nodeModulesPath);
          }
        }
      }
    } catch (err) {
      diagnostics.directoryCheckError = err.message;
    }
  }
  
  res.json(diagnostics);
});

// Restart endpoint
app.post('/api/restart', (req, res) => {
  try {
    // Check if we're running as root (required for container restart)
    if (process.getuid && process.getuid() !== 0) {
      return res.status(403).json({ 
        error: 'Container restart requires root privileges. This container must be running as root to enable restart functionality.' 
      });
    }
    
    res.json({ message: 'Restarting container...' });
    setTimeout(() => {
      process.exit(0); // Container will auto-restart
    }, 1000);
  } catch (error) {
    console.error('Restart error:', error);
    res.status(500).json({ 
      error: 'Failed to restart container: ' + error.message 
    });
  }
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');
  
  // Get session from query params (for WebSocket)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session') || 
    // Fall back to cookies
    req.headers.cookie?.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {})?.session;
  const session = sessions.get(sessionId);
  
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', data: 'Not authenticated' }));
    ws.close(1008, 'Not authenticated');
    return;
  }
  
  console.log(`Authenticated connection for user: ${session.username}`);
  
  // Ensure user home directory exists and set up user environment
  const userHome = `/home/${session.username}`;
  
  try {
    // Check if user exists in passwd, if not create it
    try {
      execSync(`id ${session.username}`, { stdio: 'ignore' });
    } catch (err) {
      console.log(`User ${session.username} doesn't exist, creating...`);
      execSync(`useradd -s /bin/zsh ${session.username}`);
      console.log(`User ${session.username} created successfully`);
    }
    
    // Always ensure home directory exists (since /home is mounted from host)
    if (!fs.existsSync(userHome)) {
      execSync(`mkdir -p ${userHome}`);
      console.log(`Created home directory: ${userHome}`);
    }
    
    // Set up user environment directories
    if (!fs.existsSync(`${userHome}/.ssh`)) {
      execSync(`mkdir -p ${userHome}/.ssh`);
    }
    if (!fs.existsSync(`${userHome}/.claude`)) {
      execSync(`mkdir -p ${userHome}/.claude`);
    }
    
    // Copy MCP config
    execSync(`cp /tmp/mcp-config.json ${userHome}/.claude/mcp-config.json`);
    
    // Set ownership and permissions
    execSync(`chown -R ${session.username}:${session.username} ${userHome}`);
    execSync(`chmod 700 ${userHome}/.ssh`);
    
  } catch (createErr) {
    console.error(`Failed to set up user environment for ${session.username}:`, createErr.message);
    ws.close(1011, 'Failed to create user environment');
    return;
  }
  
  // Check if Claude Code is installed
  const claudePath = '/opt/claude/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js';
  if (!fs.existsSync(claudePath)) {
    console.error(`Claude Code not found at expected path: ${claudePath}`);
    ws.send(JSON.stringify({ 
      type: 'error', 
      data: 'Claude Code is not installed. Please rebuild the Docker image.' 
    }));
    ws.close(1011, 'Claude Code not installed');
    return;
  }
  
  // Start Claude CLI with PTY as the authenticated user
  const startupScript = `
    # Start in user's home directory
    cd ~ && exec node --no-warnings --enable-source-maps ${claudePath} --dangerously-skip-permissions --mcp-config /home/${session.username}/.claude/mcp-config.json
  `;
  
  const ptyProcess = spawn('su', ['-', session.username, '-c', startupScript], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: '/',
    env: {
      ...process.env,
      HOME: `/home/${session.username}`,
      USER: session.username,
      PATH: '/opt/claude/.npm-global/bin:' + process.env.PATH,
    },
  });
  
  // Store PTY process in session
  session.ptyProcess = ptyProcess;

  // Send output to client
  ptyProcess.onData((data) => {
    ws.send(JSON.stringify({ type: 'stdout', data }));
  });

  // Handle input from client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'stdin') {
        ptyProcess.write(data.data);
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    console.log('WebSocket closed');
    ptyProcess.kill();
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`PTY process exited with code ${exitCode}, signal ${signal}`);
    ws.close();
  });

  // Send initial success message
  ws.send(JSON.stringify({ 
    type: 'stdout', 
    data: '\r\n🚀 Connected to Claude Workspace\r\n\r\n' 
  }));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Claude Workspace Web UI listening on port ${PORT}`);
});