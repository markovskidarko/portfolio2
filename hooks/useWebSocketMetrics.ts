"use client";

import { useState, useEffect, useRef } from 'react';

export interface AccountSidebarMetrics {
  accountId: string;
  accountAlias: string;
  nav: number;
  ytdValue: number | null;
  ytdReturn: number | null;
  mtdValue: number | null;
  mtdReturn: number | null;
  todayGainLoss: number | null;
  todayGainLossPercent: number | null;
}

export interface StreamingMetrics {
  // Total Wealth
  totalWealth: number;
  totalWealthYtd: number | null;
  totalWealthYtdPercent: number | null;
  totalWealthMtd: number | null;
  totalWealthMtdPercent: number | null;
  totalWealthToday: number | null;
  totalWealthTodayPercent: number | null;
  // Stock Market
  stockMarketTotal: number;
  stockMarketYtd: number | null;
  stockMarketYtdPercent: number | null;
  stockMarketMtd: number | null;
  stockMarketMtdPercent: number | null;
  stockMarketToday: number | null;
  stockMarketTodayPercent: number | null;
  // KB Funds
  kbFundsTotal: number;
  kbFundsYtd: number | null;
  kbFundsYtdPercent: number | null;
  kbFundsMtd: number | null;
  kbFundsMtdPercent: number | null;
  kbFundsToday: number | null;
  kbFundsTodayPercent: number | null;
  accounts: AccountSidebarMetrics[];
  timestamp: string;
}

export function useWebSocketMetrics() {
  const [metrics, setMetrics] = useState<StreamingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastPongTimeRef = useRef<number>(Date.now());
  const mountedRef = useRef(true);
  
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 10000]; // Exponential backoff, max 10s
  const HEARTBEAT_TIMEOUT = 60000; // 60 seconds - if no pong received, reconnect
  const HEARTBEAT_INTERVAL = 30000; // Send ping every 30 seconds

  useEffect(() => {
    // Only connect if we're in the browser (client-side)
    if (typeof window === 'undefined') {
      console.log('[WebSocket] Skipping connection - not in browser environment');
      setLoading(false);
      setError('WebSocket requires browser environment');
      return;
    }
    
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, []); // Empty dependency array - only run once on mount

  const connect = () => {
    if (!mountedRef.current) return;
    if (typeof window === 'undefined') {
      console.warn('[WebSocket] Cannot connect - not in browser environment');
      return;
    }
    
    // Clear any existing reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Don't reconnect if max attempts reached
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocket] Max reconnection attempts reached');
      if (mountedRef.current) {
        setError('Failed to connect after multiple attempts. Please refresh the page.');
        setLoading(false);
      }
      return;
    }

    try {
      // Determine WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws/metrics`;
      
      console.log('[WebSocket] Connecting to:', wsUrl);
      
      if (mountedRef.current) {
        setLoading(true);
        setError(null);
      }

      console.log('[WebSocket] Creating WebSocket instance...');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      console.log('[WebSocket] WebSocket created, readyState:', ws.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');

      ws.onopen = (event) => {
        console.log('[WebSocket] ✅ Connection opened!');
        console.log('[WebSocket] Event:', event);
        console.log('[WebSocket] ReadyState:', ws.readyState);
        reconnectAttemptsRef.current = 0; // Reset on successful connection
        lastPongTimeRef.current = Date.now();
        
        if (mountedRef.current) {
          setConnected(true);
          setLoading(false);
          setError(null);
        }

        // Start heartbeat - send ping every HEARTBEAT_INTERVAL
        startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'ping') {
            // Server sent ping, respond with pong
            console.log('[WebSocket] Received ping, sending pong');
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            lastPongTimeRef.current = Date.now();
          } else if (message.type === 'pong') {
            // Server responded to our ping
            console.log('[WebSocket] Received pong');
            lastPongTimeRef.current = Date.now();
          } else if (message.type === 'metrics') {
            // Received metrics data
            if (mountedRef.current) {
              setMetrics(message.data);
              setError(null);
            }
          }
        } catch (err) {
          console.error('[WebSocket] Error parsing message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[WebSocket] ❌ Connection error:', err);
        console.error('[WebSocket] Error event:', err);
        if (mountedRef.current) {
          setError('WebSocket connection error. Make sure the server is running with WebSocket support (npm run dev)');
        }
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Connection closed', {
          code: event.code,
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean,
        });
        
        // Log close code meanings
        const closeCodeMeanings: Record<number, string> = {
          1000: 'Normal closure',
          1001: 'Going away',
          1002: 'Protocol error',
          1003: 'Unsupported data',
          1006: 'Abnormal closure (no close frame)',
          1011: 'Internal server error',
          1012: 'Service restart',
          1013: 'Try again later',
          1014: 'Bad gateway',
          1015: 'TLS handshake failure',
        };
        console.log('[WebSocket] Close code meaning:', closeCodeMeanings[event.code] || 'Unknown');
        
        if (mountedRef.current) {
          setConnected(false);
        }

        // Stop heartbeat
        stopHeartbeat();

        // Provide helpful error message for common close codes
        if (event.code === 1006) {
          // Abnormal closure - connection lost
          console.error('[WebSocket] Connection lost (1006). Server may not be running with WebSocket support.');
          if (mountedRef.current) {
            setError('Connection lost. Make sure server is running with: npm run dev');
            setLoading(false);
          }
        } else if (event.code === 1002 || event.code === 1003) {
          console.error('[WebSocket] Protocol error. Check server WebSocket implementation.');
          if (mountedRef.current) {
            setError('WebSocket protocol error. Check server logs.');
            setLoading(false);
          }
        }

        // Attempt to reconnect if not a clean close and component is still mounted
        if (mountedRef.current && event.code !== 1000) {
          const delay = RECONNECT_DELAYS[Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS.length - 1)];
          reconnectAttemptsRef.current++;
          
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else if (event.code === 1000) {
          // Clean close - don't reconnect
          console.log('[WebSocket] Clean close, not reconnecting');
        }
      };
    } catch (err) {
      console.error('[WebSocket] Error creating connection:', err);
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to create WebSocket connection');
        setLoading(false);
      }
    }
  };

  const disconnect = () => {
    stopHeartbeat();
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Component unmounting');
      wsRef.current = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat(); // Clear any existing interval
    
    // Check if we've received a pong recently
    const checkHeartbeat = () => {
      const timeSinceLastPong = Date.now() - lastPongTimeRef.current;
      
      if (timeSinceLastPong > HEARTBEAT_TIMEOUT) {
        console.warn('[WebSocket] ⚠️ Heartbeat timeout - no pong received for', timeSinceLastPong, 'ms');
        // Connection might be dead, close and reconnect
        if (wsRef.current) {
          wsRef.current.close();
        }
        return;
      }

      // Send ping if connection is open
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
          console.log('[WebSocket] Sent ping');
        } catch (err) {
          console.error('[WebSocket] Error sending ping:', err);
        }
      }
    };

    // Send initial ping immediately
    checkHeartbeat();
    
    // Then check/send ping every HEARTBEAT_INTERVAL
    heartbeatIntervalRef.current = setInterval(checkHeartbeat, HEARTBEAT_INTERVAL);
  };

  const stopHeartbeat = () => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  };

  return {
    metrics,
    loading,
    error,
    connected,
  };
}
