import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { calculateAllMetrics } from './lib/websocket-metrics.js';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Track active WebSocket connections
const wss = new WebSocketServer({ noServer: true });
const connections = new Set();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
// Metrics update interval (2 seconds)
const METRICS_UPDATE_INTERVAL = 2000;

// Heartbeat function - sends ping to all connected clients
function startHeartbeat() {
  setInterval(() => {
    const pingMessage = JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() });
    connections.forEach((ws) => {
      if (ws.isAlive !== false) {
        try {
          ws.send(pingMessage);
        } catch (error) {
          console.error('[WebSocket] Error sending ping:', error);
          ws.terminate();
          connections.delete(ws);
        }
      }
    });
  }, HEARTBEAT_INTERVAL);
}

// Metrics broadcast function
let metricsInterval = null;
function startMetricsBroadcast() {
  if (metricsInterval) return; // Already running
  
  metricsInterval = setInterval(async () => {
    if (connections.size === 0) return; // No connections, skip calculation
    
    try {
      const metrics = await calculateAllMetrics();
      const message = JSON.stringify({
        type: 'metrics',
        data: metrics,
        timestamp: new Date().toISOString(),
      });
      
      // Broadcast to all connected clients
      connections.forEach((ws) => {
        if (ws.isAlive !== false && ws.readyState === 1) { // WebSocket.OPEN
          try {
            ws.send(message);
          } catch (error) {
            console.error('[WebSocket] Error sending metrics:', error);
            ws.terminate();
            connections.delete(ws);
          }
        }
      });
    } catch (error) {
      console.error('[WebSocket] Error calculating metrics:', error);
    }
  }, METRICS_UPDATE_INTERVAL);
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Handle WebSocket upgrade requests
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url, true);
    
    if (pathname === '/api/ws/metrics') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const clientIP = request.headers['x-forwarded-for'] || 
                        request.headers['x-real-ip'] || 
                        request.socket.remoteAddress || 
                        'unknown';
        const userAgent = request.headers['user-agent'] || 'unknown';
        
        console.log('[WebSocket] New connection from', clientIP);
        
        // Mark connection as alive
        ws.isAlive = true;
        connections.add(ws);
        
        // Start metrics broadcast if not already running
        startMetricsBroadcast();
        
        // Send initial metrics immediately
        calculateAllMetrics()
          .then((metrics) => {
            const initialMessage = JSON.stringify({
              type: 'metrics',
              data: metrics,
              timestamp: new Date().toISOString(),
            });
            ws.send(initialMessage);
            console.log('[WebSocket] Initial metrics sent to', clientIP);
          })
          .catch((error) => {
            console.error('[WebSocket] Error sending initial metrics:', error);
          });
        
        // Handle pong (heartbeat response)
        ws.on('pong', () => {
          ws.isAlive = true;
        });
        
        // Handle incoming messages
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            
            if (message.type === 'pong') {
              // Client responded to ping
              ws.isAlive = true;
            } else if (message.type === 'ping') {
              // Client sent ping, respond with pong
              ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            }
          } catch (error) {
            console.error('[WebSocket] Error parsing message:', error);
          }
        });
        
        // Handle connection close
        ws.on('close', () => {
          console.log('[WebSocket] Connection closed from', clientIP);
          connections.delete(ws);
          
          // Stop metrics broadcast if no connections left
          if (connections.size === 0 && metricsInterval) {
            clearInterval(metricsInterval);
            metricsInterval = null;
          }
        });
        
        // Handle errors
        ws.on('error', (error) => {
          console.error('[WebSocket] Error:', error);
          connections.delete(ws);
        });
      });
    } else {
      socket.destroy();
    }
  });

  // Start heartbeat
  startHeartbeat();

  server
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> WebSocket server ready on ws://${hostname}:${port}/api/ws/metrics`);
    });
});
