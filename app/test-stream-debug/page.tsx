"use client";

import React, { useEffect, useState } from "react";

/**
 * Debug page to test EventSource connection directly
 */
export default function TestStreamDebugPage() {
  const [status, setStatus] = useState<string>("Not started");
  const [messages, setMessages] = useState<string[]>([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [origin, setOrigin] = useState<string>("");

  const addMessage = (msg: string) => {
    console.log(`[DebugPage] ${msg}`);
    setMessages(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
    setOrigin(window.location.origin);
    addMessage("Page component mounted");
    addMessage(`Current URL: ${window.location.href}`);
    addMessage(`Will connect to: ${window.location.origin}/api/ws/all-metrics`);

    try {
      addMessage("Creating EventSource...");
      setStatus("Connecting...");
      
      const es = new EventSource('/api/ws/all-metrics');
      setEventSource(es);
      
      addMessage(`EventSource created, readyState: ${es.readyState}`);
      addMessage(`EventSource URL: ${es.url}`);

      es.onopen = () => {
        addMessage(`✅ Connection opened! readyState: ${es.readyState}`);
        setStatus("Connected");
      };

      es.addEventListener('connected', (event) => {
        addMessage(`✅ Received 'connected' event: ${(event as MessageEvent).data}`);
      });

      es.addEventListener('metrics', (event) => {
        const data = (event as MessageEvent).data;
        addMessage(`✅ Received 'metrics' event (${data.length} bytes)`);
        try {
          const parsed = JSON.parse(data);
          addMessage(`Metrics data: totalWealth=${parsed.data?.totalWealth || 'N/A'}`);
        } catch (e) {
          addMessage(`❌ Failed to parse metrics: ${e}`);
        }
      });

      es.addEventListener('ping', (event) => {
        addMessage(`✅ Received 'ping' event`);
      });

      es.onerror = (err) => {
        addMessage(`❌ EventSource error! readyState: ${es.readyState}`);
        addMessage(`Error details: ${JSON.stringify(err)}`);
        setStatus(`Error (readyState: ${es.readyState})`);
      };

    } catch (error) {
      addMessage(`❌ Failed to create EventSource: ${error}`);
      setStatus("Failed to create");
    }

    return () => {
      addMessage("Cleaning up...");
      if (eventSource) {
        eventSource.close();
        addMessage("EventSource closed");
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">EventSource Debug Page</h1>
        
        <div className="mb-4 p-4 bg-card border rounded-lg">
          <div className="font-semibold mb-2">Status: {status}</div>
          <div className="text-sm text-muted-foreground">
            ReadyState: {eventSource?.readyState ?? 'N/A'} (0=CONNECTING, 1=OPEN, 2=CLOSED)
          </div>
        </div>

        <div className="p-4 bg-card border rounded-lg">
          <h2 className="font-semibold mb-2">Connection Log:</h2>
          <div className="space-y-1 text-sm font-mono max-h-96 overflow-y-auto">
            {messages.map((msg, idx) => (
              <div key={idx} className="text-xs">
                {msg}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 p-4 bg-card border rounded-lg">
          <h2 className="font-semibold mb-2">Test URLs:</h2>
          <div className="space-y-2 text-sm">
            <div>
              <strong>Health Check:</strong>{' '}
              <a
                href="/api/health"
                target="_blank"
                className="text-blue-500 underline"
              >
                {origin}/api/health
              </a>
            </div>
            <div>
              <strong>SSE Endpoint:</strong>{' '}
              <a
                href="/api/ws/all-metrics"
                target="_blank"
                className="text-blue-500 underline"
              >
                {origin}/api/ws/all-metrics
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
