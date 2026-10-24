# Tailscale Mobile Setup Guide

## Problem
The Next.js dev server by default only binds to `localhost` (127.0.0.1), which makes it inaccessible from other devices, even through Tailscale.

## Solution

### 1. Update Dev Server to Bind to All Interfaces

The `package.json` has been updated to bind to `0.0.0.0` instead of just localhost:
- `npm run dev` - Now accessible from network (Tailscale)
- `npm run dev:local` - Local only (localhost)

### 2. Find Your Tailscale IP Address

1. Open Tailscale on your computer
2. Find your machine's Tailscale IP (usually starts with `100.x.x.x`)
3. Note this IP address

### 3. Access from Mobile Device

1. **Make sure Tailscale is running on both devices:**
   - Your computer (server)
   - Your mobile device

2. **On your mobile device, open a browser and navigate to:**
   ```
   http://YOUR_TAILSCALE_IP:3000/test-stream
   ```
   Replace `YOUR_TAILSCALE_IP` with your actual Tailscale IP (e.g., `http://100.64.1.2:3000/test-stream`)

### 4. Troubleshooting

#### Issue: Connection Refused / Can't Connect

**Check 1: Is the server running?**
```bash
# On your computer, check if port 3000 is listening
netstat -an | findstr :3000
```

**Check 2: Is the server bound to 0.0.0.0?**
- Make sure you're using `npm run dev` (not `npm run dev:local`)
- Check the console output - it should show:
  ```
  ▲ Next.js 14.2.0
  - Local:        http://localhost:3000
  - Network:      http://0.0.0.0:3000
  ```

**Check 3: Windows Firewall**
- Windows Firewall might be blocking port 3000
- Go to: Windows Defender Firewall → Advanced Settings
- Create an inbound rule for port 3000 (TCP)
- Or temporarily disable firewall to test

**Check 4: Tailscale Status**
- On your computer: Open Tailscale → Check if you're connected
- On your mobile: Open Tailscale app → Check if you're connected
- Both devices should show as "Connected" in Tailscale

**Check 5: Test Connectivity**
- From your mobile device, try pinging your computer's Tailscale IP:
  ```
  ping YOUR_TAILSCALE_IP
  ```
- If ping fails, Tailscale connection might be the issue

#### Issue: Page Loads but Shows Errors

**Check 1: CORS Issues**
- The API routes should work fine, but if you see CORS errors, check browser console

**Check 2: SSE Connection**
- Open browser developer tools on mobile
- Check Network tab for `/api/ws/all-metrics` endpoint
- Should show as "EventStream" type

**Check 3: API Routes**
- Test if API is accessible: `http://YOUR_TAILSCALE_IP:3000/api/portfolio/sidebar`
- Should return JSON data

### 5. Alternative: Use Production Build

If dev server still has issues, use production build:

```bash
npm run build
npm start
```

This will also bind to `0.0.0.0` and be accessible via Tailscale.

### 6. Quick Test Script

Create a test file to verify connectivity:

```bash
# On your mobile device, test if server is reachable
curl http://YOUR_TAILSCALE_IP:3000/api/health
```

Or use a browser to visit:
```
http://YOUR_TAILSCALE_IP:3000/api/health
```

### 7. Common Issues

**Issue: "Connection refused"**
- Server not running
- Server bound to localhost only (use `npm run dev`)
- Firewall blocking port 3000

**Issue: "Connection timeout"**
- Tailscale not connected on both devices
- Wrong Tailscale IP address
- Network routing issue

**Issue: "Page loads but no data"**
- API routes might be failing
- Check browser console for errors
- Verify database is accessible

## Verification Steps

1. ✅ Server is running (`npm run dev`)
2. ✅ Server shows "Network: http://0.0.0.0:3000" in console
3. ✅ Tailscale is connected on both devices
4. ✅ You have the correct Tailscale IP address
5. ✅ Windows Firewall allows port 3000
6. ✅ Can ping Tailscale IP from mobile device
7. ✅ Can access `http://YOUR_TAILSCALE_IP:3000` from mobile browser

If all checks pass, the test-stream page should be accessible!
