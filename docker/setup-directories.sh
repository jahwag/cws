#!/bin/bash
# Setup script to ensure directories exist on host before container starts
# This prevents Docker overlay filesystem issues

set -e

# Get the user's home directory path from environment or use default
USERS_DIR="${CLAUDE_USERS_HOME:-$HOME/.claude-workspace/users}"

# Create base directory if it doesn't exist
mkdir -p "$USERS_DIR"

# Function to setup user directory structure
setup_user_dir() {
    local username="$1"
    local user_home="$USERS_DIR/$username"
    
    echo "Setting up directory structure for user: $username"
    
    # Create user home directory
    mkdir -p "$user_home"
    
    # Create essential subdirectories
    mkdir -p "$user_home/.ssh"
    mkdir -p "$user_home/.claude"
    mkdir -p "$user_home/.npm"
    
    # Set appropriate permissions
    chmod 755 "$user_home"
    chmod 700 "$user_home/.ssh"
    chmod 755 "$user_home/.claude"
    chmod 755 "$user_home/.npm"
    
    echo "✓ Directory structure created for $username"
}

# If running with a specific username, set it up
if [ -n "$1" ]; then
    setup_user_dir "$1"
else
    echo "Usage: $0 <username>"
    echo "This script sets up the directory structure for a specific user"
fi