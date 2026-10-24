"use client";

import { useState, useEffect, useRef } from 'react';

// Client-side connection logger
class ClientConnectionLogger {
  private logEntries: Array<{ timestamp: string; event: string; details?: any }> = [];
  private maxEntries = 500;

  log(event: string, details?: any) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      details,
    };
    
    this.logEntries.push(entry);
    if (this.logEntries.length > this.maxEntries) {
      this.logEntries.shift();
    }
    
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[ClientConnectionLogger] [${entry.timestamp}] ${event}`, details || '');
    }
  }

  getRecentLogs(count: number = 50) {
    return this.logEntries.slice(-count);
  }

  exportLogs() {
    return JSON.stringify(this.logEntries, null, 2);
  }
}

const clientLogger = new ClientConnectionLogger();

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
  timestamp: string;
}

export interface UseStreamingMetricsResult {
  metrics: StreamingMetrics | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
}

/**
 * Hook to consume Server-Sent Events stream for real-time portfolio metrics
 */
export function useStreamingMetrics(): UseStreamingMetricsResult {
  const [metrics, setMetrics] = useState<StreamingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastPingTimeRef = useRef<number>(Date.now());
  const pingCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    console.log('[useStreamingMetrics] Hook initialized, setting up connection');
    let mounted = true;

    const connect = () => {
      const connectionAttemptId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const connectionStartTime = Date.now();
      
      clientLogger.log('Connection attempt started', {
        connectionAttemptId,
        reconnectAttempt: reconnectAttemptsRef.current,
        url: '/api/ws/all-metrics',
      });

      // Clean up existing connection
      if (eventSourceRef.current) {
        clientLogger.log('Closing existing connection before new attempt', {
          connectionAttemptId,
          readyState: eventSourceRef.current.readyState,
        });
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Clear any pending reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      try {
        const streamUrl = '/api/ws/all-metrics';
        const fullUrl = `${window.location.origin}${streamUrl}`;
        
        console.log(`[Streaming] ===== Creating EventSource =====`);
        console.log(`[Streaming] Relative URL: ${streamUrl}`);
        console.log(`[Streaming] Full URL: ${fullUrl}`);
        console.log(`[Streaming] Current window location: ${window.location.href}`);
        console.log(`[Streaming] Window origin: ${window.location.origin}`);
        const navConnection = (navigator as any).connection;
        console.log(`[Streaming] Network type: ${navConnection ? navConnection.effectiveType || 'unknown' : 'unknown'}`);
        console.log(`[Streaming] OnLine status: ${navigator.onLine}`);
        
        // Add timeout detection for mobile networks
        const connectionTimeout = setTimeout(() => {
          if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.CONNECTING) {
            console.error(`[Streaming] ⚠️ Connection timeout after 10 seconds (readyState: ${eventSourceRef.current.readyState})`);
            console.error(`[Streaming] This might be a mobile network blocking SSE connections`);
            clientLogger.log('Connection timeout - possible mobile network blocking', {
              connectionAttemptId,
              readyState: eventSourceRef.current.readyState,
              timeout: '10s',
            });
          }
        }, 10000); // 10 second timeout
        
        const eventSource = new EventSource(streamUrl);
        eventSourceRef.current = eventSource;
        
        // Clear timeout when connection opens
        eventSource.onopen = () => {
          clearTimeout(connectionTimeout);
        };
        
        console.log(`[Streaming] EventSource created, readyState: ${eventSource.readyState}`);
        console.log(`[Streaming] EventSource URL: ${eventSource.url}`);
        console.log(`[Streaming] EventSource withCredentials: ${(eventSource as any).withCredentials || 'not set'}`);
        
        clientLogger.log('EventSource created', {
          connectionAttemptId,
          readyState: eventSource.readyState,
          url: eventSource.url,
          windowLocation: window.location.href,
        });

        eventSource.onopen = () => {
          const connectionTime = Date.now() - connectionStartTime;
          clientLogger.log('EventSource onopen fired', {
            connectionAttemptId,
            connectionTime: `${connectionTime}ms`,
            readyState: eventSource.readyState,
          });
          
          if (mounted) {
            setConnected(true);
            setLoading(false);
            setError(null);
            reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
            lastPingTimeRef.current = Date.now();
            
            clientLogger.log('Connection state updated - connected', {
              connectionAttemptId,
              totalTime: `${connectionTime}ms`,
            });
            
            console.log('[Streaming] Connected to metrics stream');
          }
        };

        eventSource.addEventListener('connected', (event) => {
          const connectionTime = Date.now() - connectionStartTime;
          clientLogger.log('Received connected event from server', {
            connectionAttemptId,
            connectionTime: `${connectionTime}ms`,
            eventData: (event as any).data,
          });
          
          if (mounted) {
            setConnected(true);
            setLoading(false);
            reconnectAttemptsRef.current = 0;
            lastPingTimeRef.current = Date.now();
            
            clientLogger.log('Stream started - state updated', {
              connectionAttemptId,
            });
            
            console.log('[Streaming] Stream started');
          }
        });

        // Handle ping/heartbeat messages
        eventSource.addEventListener('ping', (event) => {
          const pingEvent = event as MessageEvent;
          clientLogger.log('Received ping/heartbeat', {
            connectionAttemptId,
            timestamp: pingEvent.data ? JSON.parse(pingEvent.data).timestamp : undefined,
          });
          
          if (mounted) {
            lastPingTimeRef.current = Date.now();
            // Connection is alive
          }
        });

        eventSource.addEventListener('metrics', (event) => {
          const timeSinceConnection = Date.now() - connectionStartTime;
          const metricsEvent = event as MessageEvent;
          
          clientLogger.log('Received metrics event', {
            connectionAttemptId,
            timeSinceConnection: `${timeSinceConnection}ms`,
            dataLength: metricsEvent.data?.length || 0,
          });
          
          if (mounted) {
            try {
              const data = JSON.parse(metricsEvent.data);
              if (data.type === 'metrics' && data.data) {
                setMetrics(data.data);
                setError(null);
                lastPingTimeRef.current = Date.now(); // Update last activity time
                
                clientLogger.log('Metrics parsed and state updated', {
                  connectionAttemptId,
                  totalWealth: data.data.totalWealth,
                  timestamp: data.data.timestamp,
                });
              }
            } catch (err) {
              clientLogger.log('Error parsing metrics', {
                connectionAttemptId,
                error: err instanceof Error ? err.message : String(err),
                data: metricsEvent.data?.substring(0, 200),
              });
              
              console.error('[Streaming] Error parsing metrics:', err);
              if (mounted) {
                setError('Failed to parse metrics data');
              }
            }
          }
        });

        eventSource.addEventListener('error', (event) => {
          const errorEvent = event as MessageEvent;
          clientLogger.log('Received error event from server', {
            connectionAttemptId,
            data: errorEvent.data,
          });
          
          if (mounted) {
            try {
              const data = JSON.parse(errorEvent.data);
              if (data.type === 'error') {
                setError(data.message || 'Unknown error');
              }
            } catch (err) {
              // Connection error - handled by onerror
            }
          }
        });

        eventSource.onerror = (err) => {
          const readyState = eventSource.readyState;
          const timeSinceConnection = Date.now() - connectionStartTime;
          
          console.error(`[Streaming] EventSource error! readyState: ${readyState}, time: ${timeSinceConnection}ms`);
          console.error(`[Streaming] Error details:`, err);
          console.error(`[Streaming] EventSource URL: ${eventSource.url}`);
          console.error(`[Streaming] EventSource withCredentials: ${(eventSource as any).withCredentials}`);
          
          clientLogger.log('EventSource onerror fired', {
            connectionAttemptId,
            readyState,
            timeSinceConnection: `${timeSinceConnection}ms`,
            error: err instanceof Error ? err.message : String(err),
            eventSourceUrl: eventSource.url,
          });
          
          if (mounted) {
            if (readyState === EventSource.CLOSED || readyState === EventSource.CONNECTING) {
              setConnected(false);
              
              // Exponential backoff: 1s, 2s, 4s, 8s, max 10s
              const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
              reconnectAttemptsRef.current++;
              
              clientLogger.log('Connection lost - scheduling reconnect', {
                connectionAttemptId,
                readyState,
                reconnectAttempt: reconnectAttemptsRef.current,
                delay: `${delay}ms`,
                connectionDuration: `${timeSinceConnection}ms`,
              });
              
              console.log(`[Streaming] Connection lost. Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})...`);
              setError(`Connection lost. Reconnecting... (attempt ${reconnectAttemptsRef.current})`);
              
              reconnectTimeoutRef.current = setTimeout(() => {
                if (mounted) {
                  connect();
                }
              }, delay);
            }
          }
        };
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to connect to stream');
          setLoading(false);
          
          // Retry connection with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectAttemptsRef.current++;
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mounted) {
              connect();
            }
          }, delay);
        }
      }
    };

    // Monitor connection health - check if we haven't received ping/metrics in 30 seconds
    pingCheckIntervalRef.current = setInterval(() => {
      if (mounted && eventSourceRef.current) {
        const timeSinceLastPing = Date.now() - lastPingTimeRef.current;
        const maxSilenceTime = 30000; // 30 seconds
        
        if (timeSinceLastPing > maxSilenceTime && eventSourceRef.current.readyState === EventSource.OPEN) {
          console.warn('[Streaming] No activity for 30s, reconnecting...');
          setConnected(false);
          eventSourceRef.current.close();
          connect();
        }
      }
    }, 15000); // Check every 15 seconds

    // Handle visibility change (mobile browser tab switching)
    const handleVisibilityChange = () => {
      if (mounted && document.visibilityState === 'visible') {
        // Tab became visible - check connection and reconnect if needed
        if (!eventSourceRef.current || eventSourceRef.current.readyState !== EventSource.OPEN) {
          console.log('[Streaming] Tab visible, reconnecting...');
          connect();
        } else {
          // Connection is open, just update last ping time
          lastPingTimeRef.current = Date.now();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Handle page focus (mobile browser)
    const handleFocus = () => {
      if (mounted) {
        if (!eventSourceRef.current || eventSourceRef.current.readyState !== EventSource.OPEN) {
          console.log('[Streaming] Page focused, reconnecting...');
          connect();
        }
      }
    };

    window.addEventListener('focus', handleFocus);

    connect();

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingCheckIntervalRef.current) {
        clearInterval(pingCheckIntervalRef.current);
        pingCheckIntervalRef.current = null;
      }
    };
  }, []);

  return { metrics, loading, error, connected };
}
