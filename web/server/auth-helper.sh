#!/bin/sh
# Simple authentication helper for Alpine Linux
# Usage: auth-helper.sh <username> <password>

USERNAME="$1"
PASSWORD="$2"

# Check if user exists
if ! id "$USERNAME" >/dev/null 2>&1; then
    exit 1
fi

# For demo purposes, check against known passwords
# In production, this should use proper PAM or shadow
case "$USERNAME" in
    claude)
        [ "$PASSWORD" = "claude123" ] && exit 0
        ;;
    alice)
        [ "$PASSWORD" = "alice123" ] && exit 0
        ;;
    bob)
        [ "$PASSWORD" = "bob123" ] && exit 0
        ;;
esac

exit 1