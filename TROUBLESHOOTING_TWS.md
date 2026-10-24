# TWS Connection Troubleshooting Guide

If you're seeing "Offline mode" even though TWS/Gateway is running, follow these steps:

## 1. Check TWS/Gateway is Running

- Open TWS or IB Gateway
- Verify it's logged in and connected
- Look for the green "Connected" indicator in TWS

## 2. Verify API Settings in TWS

1. In TWS, go to: **File > Global Configuration > API > Settings**
2. Verify these settings:
   - ✅ **Enable ActiveX and Socket Clients** is checked
   - ✅ **Socket Port** is set to `7497` (paper) or `7496` (live)
   - ✅ **Allow connections from localhost only** is checked
   - ✅ **Read-Only API** can be checked or unchecked
   - ✅ Click **OK** to save

## 3. Check Environment Variables

Verify your `.env.local` file has:
```env
TWS_HOST=127.0.0.1
TWS_PORT=7497
TWS_CLIENT_ID=1
```

## 4. Test Connection Manually

### Option A: Quick Port Scan
Visit this endpoint to test multiple ports automatically:
```
http://localhost:3000/api/tws/test-connection
```

This will test ports 7497, 7496, 4001, and 4002 to find which one TWS is actually using.

### Option B: Detailed Diagnostics
Visit the diagnostic endpoint:
```
http://localhost:3000/api/tws/diagnostics
```

This will show:
- Whether the service initialized
- Connection test results
- Specific error messages
- Environment configuration

## 5. Check Server Logs

Look at your Next.js server console for TWS connection logs:
- `[TWS] Attempting to connect...`
- `[TWS] Socket connected successfully`
- `[TWS] Socket connection error: ...`

## Common Issues:

### Issue: "Connection timeout"
**Solution**: TWS is not responding. Check:
- TWS is actually running (not just installed)
- Port number matches TWS settings (7497/7496)
- Firewall is not blocking localhost connections

### Issue: "ECONNREFUSED" or "Connection refused"
**Solution**: 
- TWS/Gateway is not running
- API is not enabled in TWS settings
- Wrong port number in `.env.local`

### Issue: Socket connects but shows "Offline"
**Solution**: Protocol handshake may be failing. This could mean:
- IBKR API version mismatch
- Protocol implementation needs refinement
- Check server logs for protocol errors

## 6. Verify Port Accessibility

On Windows, test if the port is open:
```powershell
Test-NetConnection -ComputerName localhost -Port 7497
```

Should show `TcpTestSucceeded: True`

## 7. Check for Multiple TWS Instances

Only one instance of TWS/Gateway can use the API port. Make sure:
- Only one TWS/Gateway is running
- No other applications are using port 7497/7496

## 8. Restart Everything

If all else fails:
1. Close TWS/Gateway completely
2. Restart TWS/Gateway
3. Restart your Next.js development server
4. Wait 10-15 seconds for connection to establish

## Getting Help

If the diagnostic endpoint shows connection issues, check:
1. Server console logs for detailed error messages
2. Browser console (F12) for frontend errors
3. TWS Logs (File > Global Configuration > Logging)

The diagnostic endpoint URL will provide specific error codes that can help identify the exact issue.

