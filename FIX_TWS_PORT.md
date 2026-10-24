# Quick Fix: Update TWS Port to 7496

Your TWS is running on **port 7496** (LIVE trading), but the app is trying to connect to port 7497 (paper trading).

## Fix:

1. **Update your `.env.local` file**:
   ```env
   TWS_HOST=127.0.0.1
   TWS_PORT=7496
   TWS_CLIENT_ID=1
   ```

2. **Restart your Next.js development server**:
   - Stop the server (Ctrl+C)
   - Start it again: `npm run dev`

3. **Verify connection**:
   - Visit: `http://localhost:3000/api/tws/diagnostics`
   - Should now show `canConnect: true`

The app should now connect successfully! 🎉

---

**Note**: Your Python script uses `ib_async` which is a well-maintained library. The Node.js implementation uses raw sockets, which should work but may need protocol adjustments if you still see issues after fixing the port.

