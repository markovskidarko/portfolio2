# Tailscale DNS Troubleshooting Guide

## Issue: DNS Unavailable - Tailscale can't reach configured DNS servers

This error indicates that Tailscale is having trouble resolving DNS queries, which can prevent your mobile device from connecting to your laptop server.

## Quick Fixes

### 1. Check Tailscale Status on Both Devices

**On your laptop (server):**
```powershell
# Check Tailscale status
tailscale status

# Check if Tailscale is running
Get-Service -Name "Tailscale" | Select-Object Status, Name
```

**On your mobile device:**
- Open Tailscale app
- Check if it shows "Connected"
- Note your laptop's Tailscale IP address

### 2. Use IP Address Instead of Hostname

Instead of using a hostname, try connecting directly via Tailscale IP:

1. Find your laptop's Tailscale IP:
   ```powershell
   tailscale ip -4
   ```

2. On your mobile device, use:
   ```
   http://100.x.x.x:3000/test-stream
   ```
   (Replace `100.x.x.x` with your actual Tailscale IP)

### 3. Fix Tailscale DNS Settings

**On Windows (laptop):**

1. Open Tailscale app
2. Go to Settings → DNS
3. Try these options:
   - **Option A:** Use Tailscale's DNS (1.1.1.1 or 8.8.8.8)
   - **Option B:** Disable Tailscale DNS and use your system DNS
   - **Option C:** Add your router's DNS (usually 192.168.1.1 or similar)

4. Restart Tailscale after changing DNS settings

**On Mobile:**

1. Open Tailscale app
2. Go to Settings → DNS
3. Enable "Override local DNS" if available
4. Set DNS to: `1.1.1.1` or `8.8.8.8`

### 4. Test Connectivity

**From mobile device, test these URLs:**

1. Health check (should work even with DNS issues):
   ```
   http://[TAILSCALE_IP]:3000/api/health
   ```

2. Main stream endpoint:
   ```
   http://[TAILSCALE_IP]:3000/api/ws/all-metrics
   ```

3. Test stream page:
   ```
   http://[TAILSCALE_IP]:3000/test-stream
   ```

### 5. Check Windows Firewall

The Next.js server might be blocked by Windows Firewall:

```powershell
# Allow Node.js through firewall (run as Administrator)
New-NetFirewallRule -DisplayName "Node.js Server" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

### 6. Verify Next.js Server is Listening on All Interfaces

Make sure your `package.json` has:
```json
{
  "scripts": {
    "dev": "next dev --hostname 0.0.0.0"
  }
}
```

### 7. Test Direct Connection

**From mobile device, try:**

1. Open a browser
2. Navigate to: `http://[TAILSCALE_IP]:3000/api/health`
3. You should see: `{"status":"ok","timestamp":"...","server":"Portfolio Tracker","clientIP":"..."}`

If this works but `/api/ws/all-metrics` doesn't, the issue is with the SSE endpoint, not connectivity.

## Alternative: Use Tailscale MagicDNS

If MagicDNS is enabled, you can use:
```
http://[your-laptop-name].tailscale-name.ts.net:3000/test-stream
```

To enable MagicDNS:
1. Open Tailscale admin console: https://login.tailscale.com/admin
2. Go to DNS settings
3. Enable "MagicDNS"
4. Wait a few minutes for it to propagate

## Debugging Steps

1. **Check if server is accessible:**
   ```powershell
   # On laptop, check what's listening on port 3000
   netstat -ano | findstr :3000
   ```

2. **Check Tailscale IPs:**
   ```powershell
   # On laptop
   tailscale ip -4
   tailscale ip -6
   ```

3. **Test from laptop itself:**
   ```powershell
   # Should work
   curl http://localhost:3000/api/health
   ```

4. **Test from mobile (using IP):**
   - Use the Tailscale IP from step 2
   - Try: `http://[IP]:3000/api/health`

## Common Issues

1. **"Connection refused"** → Firewall blocking port 3000
2. **"Connection timeout"** → Tailscale not connected or wrong IP
3. **"DNS unavailable"** → Use IP address instead of hostname
4. **"No response"** → Next.js server not running or crashed

## Quick Test Script

On your mobile device, open a browser and try these in order:

1. `http://[TAILSCALE_IP]:3000/api/health` ← Should work immediately
2. `http://[TAILSCALE_IP]:3000/test-stream` ← Should connect and show data
3. Check the log file on laptop: `logs/connection-*.log` ← Should show connection attempts

If #1 works but #2 doesn't, check the logs to see where it's failing.
