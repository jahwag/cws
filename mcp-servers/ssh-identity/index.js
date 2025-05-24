#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

const SSH_DIR = path.join(os.homedir(), '.ssh');
const IDENTITIES_DIR = path.join(SSH_DIR, 'identities');

class SSHIdentityServer {
  constructor() {
    this.server = new Server(
      {
        name: 'ssh-identity',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'show_current_identity',
          description: 'Show current SSH identity (OPKSSH-based from OAuth)',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'regenerate_opkssh_key',
          description: 'Regenerate SSH key from current OAuth token',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'show_git_config',
          description: 'Show current Git configuration',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'test_ssh_key',
          description: 'Test SSH key with GitHub',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'show_current_identity':
            return await this.showCurrentIdentity();
          case 'regenerate_opkssh_key':
            return await this.regenerateOPKSSHKey();
          case 'show_git_config':
            return await this.showGitConfig();
          case 'test_ssh_key':
            return await this.testSSHKey();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
        };
      }
    });
  }

  async showCurrentIdentity() {
    try {
      await fs.access(SSH_DIR);
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'SSH directory not found. No SSH identity configured.',
          },
        ],
      };
    }

    const files = await fs.readdir(SSH_DIR);
    const opksshKey = files.find(f => f.startsWith('id_opkssh'));
    
    if (!opksshKey) {
      return {
        content: [
          {
            type: 'text',
            text: 'No OPKSSH identity found. Your SSH key should be automatically generated from OAuth.',
          },
        ],
      };
    }

    try {
      const pubKeyPath = path.join(SSH_DIR, `${opksshKey}.pub`);
      const pubKey = await fs.readFile(pubKeyPath, 'utf8');
      const fingerprint = await this.getKeyFingerprint(pubKeyPath);
      
      // Get Git config
      const { stdout: gitUser } = await execAsync('git config --global user.name').catch(() => ({ stdout: 'Not configured' }));
      const { stdout: gitEmail } = await execAsync('git config --global user.email').catch(() => ({ stdout: 'Not configured' }));

      return {
        content: [
          {
            type: 'text',
            text: `**Current SSH Identity (OPKSSH-based)**

**SSH Key:** ${opksshKey}
**Fingerprint:** ${fingerprint}
**Public Key:** ${pubKey.trim()}

**Git Configuration:**
- Name: ${gitUser.trim()}
- Email: ${gitEmail.trim()}

**Source:** Generated from OAuth ID token
**Security:** Key expires with your OAuth session (24h default)`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Found OPKSSH key but couldn't read details: ${error.message}`,
          },
        ],
      };
    }
  }

  async regenerateOPKSSHKey() {
    return {
      content: [
        {
          type: 'text',
          text: `**SSH Key Regeneration**

OPKSSH keys are automatically regenerated when you log in via OAuth. 

To get a fresh key:
1. Logout from the system
2. Login again via SSO
3. A new SSH key will be generated from your fresh OAuth token

**Note:** Keys automatically expire with your OAuth session for security.`,
        },
      ],
    };
  }

  async showGitConfig() {
    try {
      const { stdout: gitUser } = await execAsync('git config --global user.name').catch(() => ({ stdout: 'Not configured' }));
      const { stdout: gitEmail } = await execAsync('git config --global user.email').catch(() => ({ stdout: 'Not configured' }));
      const { stdout: gitSigningKey } = await execAsync('git config --global user.signingkey').catch(() => ({ stdout: 'Not configured' }));
      const { stdout: gitGpgFormat } = await execAsync('git config --global gpg.format').catch(() => ({ stdout: 'Not configured' }));

      return {
        content: [
          {
            type: 'text',
            text: `**Git Configuration**

**User Identity:**
- Name: ${gitUser.trim()}
- Email: ${gitEmail.trim()}

**Signing Configuration:**
- Signing Key: ${gitSigningKey.trim()}
- GPG Format: ${gitGpgFormat.trim()}

**Note:** Git identity is automatically configured from your OAuth profile.`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reading Git configuration: ${error.message}`,
          },
        ],
      };
    }
  }

  async testSSHKey() {
    try {
      const opksshKeyPath = path.join(SSH_DIR, 'id_opkssh');
      
      // Check if OPKSSH key exists
      await fs.access(opksshKeyPath);
      
      // Test SSH connection to GitHub
      const { stdout, stderr } = await execAsync(
        `ssh -i ${opksshKeyPath} -T git@github.com -o StrictHostKeyChecking=no -o ConnectTimeout=10`,
        { timeout: 15000 }
      ).catch(err => {
        // SSH to GitHub returns exit code 1 even on success
        return { stdout: err.stdout || '', stderr: err.stderr || '' };
      });

      const output = stdout + stderr;
      
      if (output.includes('successfully authenticated')) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ **SSH Key Test Successful**

${output.trim()}

Your OPKSSH key is working correctly with GitHub!`,
            },
          ],
        };
      } else if (output.includes('Permission denied')) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ **SSH Key Test Failed**

${output.trim()}

Your OPKSSH key is not authorized with GitHub. You may need to:
1. Add the public key to your GitHub account
2. Ensure your OAuth token has the correct permissions`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `🔍 **SSH Key Test Result**

${output.trim()}

Connection established but result unclear.`,
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error testing SSH key: ${error.message}`,
          },
        ],
      };
    }
  }

  async getKeyFingerprint(keyPath) {
    try {
      const { stdout } = await execAsync(`ssh-keygen -lf ${keyPath}`);
      return stdout.trim();
    } catch {
      return 'Unable to generate fingerprint';
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new SSHIdentityServer();
server.run().catch(console.error);