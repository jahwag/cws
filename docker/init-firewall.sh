#!/bin/bash
set -euo pipefail # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t' # Stricter word splitting

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "ERROR: This script must be run as root (current EUID: $EUID)"
    exit 1
fi

# Wait for network to be fully ready
echo "Waiting for network connectivity..."
for i in {1..30}; do
    if ping -c 1 -W 1 8.8.8.8 >/dev/null 2>&1; then
        break
    fi
    sleep 1
done


# Save Docker's NAT rules before flushing
echo "Saving Docker NAT rules..."
iptables-save -t nat > /tmp/docker-nat-rules.txt

# Flush existing rules and delete existing ipsets (but not NAT)
iptables -F
iptables -X
# Don't flush NAT rules - Docker needs them for DNS
# iptables -t nat -F
# iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# IMPORTANT: Don't restrict anything yet - we need network access to fetch the allowed IPs
# Keep default ACCEPT policies while we fetch the allowed domains
iptables -P INPUT ACCEPT
iptables -P OUTPUT ACCEPT
iptables -P FORWARD ACCEPT

# Create ipset with CIDR support
ipset create allowed-domains hash:net

# Function to resolve domain to IPs and add to ipset
add_domain_ips() {
    local domain=$1
    local ips
    
    # Try to resolve the domain - use external DNS if Docker DNS fails
    if grep -q "127.0.0.11" /etc/resolv.conf; then
        ips=$(dig +short @8.8.8.8 "$domain" A 2>/dev/null | grep -E '^[0-9.]+$' || true)
    else
        ips=$(dig +short "$domain" A 2>/dev/null | grep -E '^[0-9.]+$' || true)
    fi
    
    if [ -z "$ips" ]; then
        echo "WARNING: Could not resolve IPs for $domain"
        return 1
    fi
    
    # Add each IP to the ipset
    while read -r ip; do
        if [ -n "$ip" ]; then
            ipset add allowed-domains "$ip/32" 2>/dev/null || true
        fi
    done <<< "$ips"
}

# Fetch GitHub meta information and add their IP ranges
echo "Fetching GitHub IP ranges..."
if ! command -v curl &> /dev/null; then
    echo "ERROR: curl command not found"
    exit 1
fi

# First test basic connectivity
if ! ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
    echo "ERROR: No network connectivity (cannot ping 8.8.8.8)"
    exit 1
fi

# Update CA certificates first
update-ca-certificates >/dev/null 2>&1 || true

# Get GitHub IP first using external DNS if needed
if grep -q "127.0.0.11" /etc/resolv.conf; then
    GITHUB_IP=$(dig +short @8.8.8.8 api.github.com | head -1)
else
    GITHUB_IP=$(dig +short api.github.com | head -1)
fi

if [ -z "$GITHUB_IP" ]; then
    echo "ERROR: Failed to resolve api.github.com"
    exit 1
fi

gh_ranges=$(curl -s --connect-timeout 10 --resolve "api.github.com:443:$GITHUB_IP" https://api.github.com/meta)
curl_exit_code=$?

if [ $curl_exit_code -ne 0 ]; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

if [ -z "$gh_ranges" ]; then
    echo "ERROR: Empty response from GitHub API"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "ERROR: jq command not found"
    exit 1
fi

if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null 2>&1; then
    echo "ERROR: Invalid GitHub API response"
    exit 1
fi

# Add all GitHub IP ranges
for field in web api git; do
    while read -r cidr; do
        if [[ "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
            ipset add allowed-domains "$cidr" 2>/dev/null || true
        fi
    done < <(echo "$gh_ranges" | jq -r ".${field}[]" 2>/dev/null || true)
done

# Add OAuth issuer domain if configured
if [ -n "${OIDC_ISSUER:-}" ]; then
    # Extract domain from OAuth issuer URL
    oauth_domain=$(echo "$OIDC_ISSUER" | sed -E 's|^https?://([^/]+).*|\1|' | sed -E 's|:[0-9]+$||')
    if [ -n "$oauth_domain" ]; then
        add_domain_ips "$oauth_domain"
        
        # For AWS Cognito, also add the regional endpoint and CDN domains
        if [[ "$oauth_domain" =~ cognito-idp\.[^.]+\.amazonaws\.com ]]; then
            # Extract region from the domain
            region=$(echo "$oauth_domain" | sed -E 's/cognito-idp\.([^.]+)\.amazonaws\.com/\1/')
            
            # Add various AWS endpoints that Cognito uses
            add_domain_ips "cognito-identity.$region.amazonaws.com" || true
            add_domain_ips "cognito-sync.$region.amazonaws.com" || true
            add_domain_ips "$region.amazoncognito.com" || true
            
            # Add CloudFront CDN ranges for Cognito assets
            # Fetch AWS IP ranges
            aws_ranges=$(curl -s --connect-timeout 10 https://ip-ranges.amazonaws.com/ip-ranges.json 2>/dev/null || true)
            if [ -n "$aws_ranges" ]; then
                # Add CloudFront ranges
                echo "$aws_ranges" | jq -r '.prefixes[] | select(.service=="CLOUDFRONT") | .ip_prefix' 2>/dev/null | head -20 | while read -r cidr; do
                    if [ -n "$cidr" ]; then
                        ipset add allowed-domains "$cidr" 2>/dev/null || true
                    fi
                done
            fi
        fi
    fi
fi

# Add Alpine package repositories
add_domain_ips "dl-cdn.alpinelinux.org"

# Add npm registry
add_domain_ips "registry.npmjs.org"

# Add PyPI
add_domain_ips "pypi.org"
add_domain_ips "files.pythonhosted.org"

# Add Docker Hub
add_domain_ips "registry-1.docker.io"
add_domain_ips "auth.docker.io"
add_domain_ips "production.cloudflare.docker.com"

# Now apply the actual firewall rules

# Clear any existing rules before applying new ones
iptables -F
iptables -X

# First, set up the basic allows
# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS (including Docker's internal DNS at 127.0.0.11)
# CRITICAL: Allow ALL localhost traffic - Docker DNS requires this
iptables -I INPUT 1 -i lo -j ACCEPT
iptables -I OUTPUT 1 -o lo -j ACCEPT
# Also allow any localhost to localhost traffic
iptables -I OUTPUT 1 -s 127.0.0.0/8 -d 127.0.0.0/8 -j ACCEPT
iptables -I INPUT 1 -s 127.0.0.0/8 -d 127.0.0.0/8 -j ACCEPT
# General DNS rules
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT
iptables -A INPUT -p tcp --sport 53 -j ACCEPT

# Allow SSH
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT

# Allow incoming connections to web UI port 8080
iptables -A INPUT -p tcp --dport 8080 -j ACCEPT

# Allow connections to allowed domains
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Drop everything else
iptables -A OUTPUT -j DROP

# Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

echo "✅ Firewall rules applied"