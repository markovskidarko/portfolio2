/**
 * Connection Logger - Logs detailed connection information for debugging
 * Mobile device to server connections through Tailscale
 */

import * as fs from 'fs';
import * as path from 'path';

interface ConnectionLogEntry {
  timestamp: string;
  type: 'server' | 'client';
  event: string;
  details: any;
  clientInfo?: {
    ip?: string;
    userAgent?: string;
    headers?: Record<string, string>;
  };
}

class ConnectionLogger {
  private logFile: string;
  private logEntries: ConnectionLogEntry[] = [];
  private maxEntries: number = 1000; // Keep last 1000 entries in memory

  constructor() {
    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(logsDir, `connection-${timestamp}.log`);
    
    // Initialize log file
    this.writeToFile('=== Connection Debug Log Started ===\n');
    this.writeToFile(`Timestamp: ${new Date().toISOString()}\n`);
    this.writeToFile(`Log File: ${this.logFile}\n`);
    this.writeToFile('='.repeat(50) + '\n\n');
  }

  private writeToFile(message: string) {
    try {
      fs.appendFileSync(this.logFile, message, 'utf8');
    } catch (error) {
      console.error('[ConnectionLogger] Failed to write to log file:', error);
    }
  }

  private formatLogEntry(entry: ConnectionLogEntry): string {
    const lines = [
      `[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.event}`,
    ];

    if (entry.clientInfo) {
      lines.push(`  Client IP: ${entry.clientInfo.ip || 'unknown'}`);
      lines.push(`  User-Agent: ${entry.clientInfo.userAgent || 'unknown'}`);
      if (entry.clientInfo.headers) {
        lines.push(`  Headers: ${JSON.stringify(entry.clientInfo.headers, null, 2)}`);
      }
    }

    if (entry.details) {
      if (typeof entry.details === 'object') {
        lines.push(`  Details: ${JSON.stringify(entry.details, null, 2)}`);
      } else {
        lines.push(`  Details: ${entry.details}`);
      }
    }

    lines.push(''); // Empty line for readability
    return lines.join('\n');
  }

  log(type: 'server' | 'client', event: string, details?: any, clientInfo?: ConnectionLogEntry['clientInfo']) {
    const entry: ConnectionLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      event,
      details,
      clientInfo,
    };

    // Add to memory (keep last N entries)
    this.logEntries.push(entry);
    if (this.logEntries.length > this.maxEntries) {
      this.logEntries.shift();
    }

    // Write to file
    const logMessage = this.formatLogEntry(entry);
    this.writeToFile(logMessage);

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[ConnectionLogger] ${logMessage}`);
    }
  }

  logServer(event: string, details?: any, clientInfo?: ConnectionLogEntry['clientInfo']) {
    this.log('server', event, details, clientInfo);
  }

  logClient(event: string, details?: any) {
    this.log('client', event, details);
  }

  getLogFile(): string {
    return this.logFile;
  }

  getRecentLogs(count: number = 50): ConnectionLogEntry[] {
    return this.logEntries.slice(-count);
  }
}

// Singleton instance
let loggerInstance: ConnectionLogger | null = null;

export function getConnectionLogger(): ConnectionLogger {
  if (!loggerInstance) {
    loggerInstance = new ConnectionLogger();
  }
  return loggerInstance;
}

// Export for use in API routes and client code
export { ConnectionLogger };
