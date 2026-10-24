# Connection Debug Guide

## Overview

This guide explains the connection debugging system for troubleshooting mobile-to-server connections through Tailscale.

## Log Files

Connection logs are automatically saved to:
```
logs/connection-YYYY-MM-DDTHH-MM-SS-sssZ.log
```

Each log file contains:
- Timestamp of each event
- Event type (server/client)
- Event description
- Client information (IP, User-Agent, headers)
- Detailed event data
- Connection timing information

## Viewing Logs

### Option 1: View Log File Directly

Log files are saved in the `logs/` directory in your project root. Open the most recent file to see connection details.

### Option 2: Use API Endpoint

Access recent logs via API:
```
GET /api/debug/connection-logs?count=100
GET /api/debug/connection-logs?count=100&file=true  (includes full file content)
```

### Option 3: Browser Console

In development mode, client-side connection events are logged to the browser console with the prefix `[ClientConnectionLogger]`.

## What Gets Logged

### Server-Side Events:
1. **Connection attempt started** - When a client tries to connect
2. **Stream controller created** - When the SSE stream is initialized
3. **Connection added to active set** - When connection is registered
4. **Initial connection message sent** - First message to client
5. **Starting initial metrics calculation** - Beginning of metrics calculation
6. **Initial metrics calculated** - Metrics calculation completed
7. **Initial metrics sent successfully** - Metrics sent to client
8. **Heartbeat sent** - Keep-alive ping messages
9. **Connection aborted by client** - Client disconnected
10. **Connection closed successfully** - Cleanup completed

### Client-Side Events:
1. **Connection attempt started** - Client initiating connection
2. **EventSource created** - EventSource object created
3. **EventSource onopen fired** - Connection opened
4. **Received connected event from server** - Server confirmed connection
5. **Received metrics event** - Metrics data received
6. **Received ping/heartbeat** - Keep-alive message received
7. **EventSource onerror fired** - Connection error occurred
8. **Connection lost - scheduling reconnect** - Reconnection logic triggered

## Key Metrics Logged

- **Connection timing**: Time from connection start to various milestones
- **Client information**: IP address, User-Agent, request headers
- **Network details**: Connection duration, message sizes
- **Error details**: Full error messages and stack traces
- **Reconnection attempts**: Number of retries and delays

## Debugging Initial Connection Issues

When debugging mobile-to-server connections:

1. **Check the log file** for the connection attempt:
   - Look for "Connection attempt started"
   - Check timing between events
   - Look for errors or timeouts

2. **Compare timing**:
   - Time to establish connection
   - Time to calculate initial metrics
   - Time to send first data

3. **Check client information**:
   - Verify IP address (should be Tailscale IP)
   - Check User-Agent (mobile browser)
   - Review request headers

4. **Look for patterns**:
   - Multiple connection attempts
   - Timeout errors
   - Network errors
   - Reconnection delays

## Example Log Entry

```
[2026-02-01T12:34:56.789Z] [SERVER] Connection attempt started
  Client IP: 100.64.1.2
  User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)...
  Details: {
    "connectionId": "1704110096789-abc123",
    "clientIP": "100.64.1.2",
    "url": "/api/ws/all-metrics"
  }

[2026-02-01T12:34:56.790Z] [SERVER] Stream controller created
  Details: {
    "connectionId": "1704110096789-abc123",
    "timeToEstablish": "1ms"
  }

[2026-02-01T12:34:56.791Z] [SERVER] Initial metrics sent successfully
  Details: {
    "connectionId": "1704110096789-abc123",
    "totalConnectionTime": "2ms",
    "calculationTime": "150ms"
  }
```

## Troubleshooting Tips

1. **If connection takes too long**:
   - Check Tailscale status on both devices
   - Verify network connectivity
   - Check firewall settings

2. **If metrics calculation fails**:
   - Check server logs for database errors
   - Verify Yahoo Finance API access
   - Check exchange rate API availability

3. **If connection drops immediately**:
   - Check for network timeouts
   - Verify Tailscale connection stability
   - Check server resources (CPU/memory)

4. **If reconnection loops**:
   - Check exponential backoff delays
   - Verify server is still running
   - Check for rate limiting

## Log File Location

Logs are saved in: `C:\Users\marko\Portfolio2\logs\connection-*.log`

The most recent log file will have the latest timestamp in its filename.
