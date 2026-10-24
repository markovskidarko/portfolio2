/**
 * TWS Live Data Service
 * Connects to Interactive Brokers Trader Workstation (TWS) or Gateway
 * Provides real-time account data without overwriting database records
 * 
 * Uses native socket connection to IBKR API (compatible with Windows)
 */

import { loadEnv } from './env';
loadEnv();

import { Socket } from 'net';
import { EventEmitter } from 'events';
import { getDatabase, navQueries } from './database';

interface AccountSummary {
  accountId: string;
  netLiquidation: number;
  unrealizedPnl: number;
  totalCashValue: number;
  lastUpdate: Date;
}

interface Position {
  accountId: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
}

interface TWSConnectionState {
  connected: boolean;
  accounts: string[];
  accountSummaries: Map<string, AccountSummary>;
  positions: Position[];
  lastUpdate: Date | null;
  error: string | null;
}

/**
 * Simple IBKR API Message Builder/Parser
 * Implements minimal protocol needed for account summary and positions
 */
class IBKRProtocol extends EventEmitter {
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private requestId: number = 1;
  private connected: boolean = false;

  async connect(host: string, port: number, clientId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        if (this.socket) {
          this.socket.destroy();
          this.socket = null;
        }
        const timeoutMsg = `Connection timeout after 5 seconds. TWS may not be responding on ${host}:${port}. Check if TWS/Gateway is running and API is enabled.`;
        console.error('[TWS]', timeoutMsg);
        this.connected = false;
        this.emit('error', new Error(timeoutMsg));
        reject(new Error(timeoutMsg));
      }, 5000);

      this.socket = new Socket();
      
      this.socket.on('connect', () => {
        console.log('[TWS] Socket connected successfully to', `${host}:${port}`);
        clearTimeout(connectionTimeout);
        this.connected = true;
        
        // Send client ID
        try {
          this.sendStartApi(clientId);
          console.log('[TWS] Sent START_API with clientId:', clientId);
        } catch (error) {
          console.error('[TWS] Error sending START_API:', error);
        }
        
        // Wait a bit for TWS to process and respond
        setTimeout(() => {
          // Check if we're still connected
          if (this.connected && this.socket) {
            console.log('[TWS] Protocol handshake complete');
            this.emit('connected');
            resolve();
          } else {
            const err = new Error('Connection lost during handshake');
            console.error('[TWS]', err.message);
            reject(err);
          }
        }, 2000);
      });

      this.socket.on('data', (data: Buffer) => {
        console.log('[TWS] Received data:', data.length, 'bytes');
        this.buffer = Buffer.concat([this.buffer, data]);
        this.processBuffer();
      });

      this.socket.on('error', (error: Error) => {
        clearTimeout(connectionTimeout);
        const errorMsg = `Socket connection error: ${error.message}. Make sure TWS/Gateway is running and API is enabled on port ${port}. Error code: ${(error as any).code || 'unknown'}`;
        console.error('[TWS]', errorMsg);
        console.error('[TWS] Error details:', error);
        this.connected = false;
        this.emit('error', new Error(errorMsg));
        reject(new Error(errorMsg));
      });

      this.socket.on('close', () => {
        clearTimeout(connectionTimeout);
        console.log('[TWS] Socket closed');
        this.connected = false;
        this.emit('disconnected');
      });

      console.log(`[TWS] Attempting to connect to ${host}:${port}...`);
      try {
        this.socket.connect(port, host, () => {
          console.log(`[TWS] Socket connection callback triggered`);
        });
      } catch (error) {
        clearTimeout(connectionTimeout);
        const errMsg = `Failed to initiate connection: ${error instanceof Error ? error.message : String(error)}`;
        console.error('[TWS]', errMsg);
        reject(new Error(errMsg));
      }
    });
  }

  private sendStartApi(clientId: number): void {
    // IBKR API: START_API message
    const msg = Buffer.alloc(4);
    msg.writeInt32BE(71, 0); // START_API message ID
    this.sendMessage(msg);
    
    // Send version
    const version = Buffer.alloc(4);
    version.writeInt32BE(2, 0);
    this.sendMessage(version);
    
    // Send client ID
    const clientIdBuf = Buffer.alloc(4);
    clientIdBuf.writeInt32BE(clientId, 0);
    this.sendMessage(clientIdBuf);
  }

  private sendMessage(data: Buffer): void {
    if (!this.socket) return;
    
    const length = Buffer.alloc(4);
    length.writeInt32BE(data.length, 0);
    this.socket.write(length);
    this.socket.write(data);
  }

  private processBuffer(): void {
    // IBKR protocol: messages start with 4-byte length header
    while (this.buffer.length >= 4) {
      const msgLength = this.buffer.readInt32BE(0);
      
      if (this.buffer.length < 4 + msgLength) {
        // Wait for more data
        break;
      }

      const message = this.buffer.slice(4, 4 + msgLength);
      this.buffer = this.buffer.slice(4 + msgLength);
      
      this.processMessage(message);
    }
  }

  private processMessage(msg: Buffer): void {
    if (msg.length < 4) {
      console.log('[TWS] Received message too short:', msg.length, 'bytes');
      return;
    }
    
    const msgId = msg.readInt32BE(0);
    console.log('[TWS] Received message ID:', msgId, 'length:', msg.length);
    
    // Handle different message types
    switch (msgId) {
      case 53: // MANAGED_ACCOUNTS
        console.log('[TWS] Processing MANAGED_ACCOUNTS message');
        this.handleManagedAccounts(msg);
        break;
      case 15: // ACCOUNT_SUMMARY
        console.log('[TWS] Processing ACCOUNT_SUMMARY message');
        this.handleAccountSummary(msg);
        break;
      case 61: // ACCOUNT_SUMMARY_END
        console.log('[TWS] ACCOUNT_SUMMARY_END received');
        break;
      case 47: // POSITION
        console.log('[TWS] Processing POSITION message');
        this.handlePosition(msg);
        break;
      case 49: // POSITION_END
        console.log('[TWS] POSITION_END received');
        break;
      case 1: // TICK_PRICE (common message)
        console.log('[TWS] TICK_PRICE message (ignored)');
        break;
      case 2: // TICK_SIZE (common message)
        console.log('[TWS] TICK_SIZE message (ignored)');
        break;
      default:
        console.log('[TWS] Unknown message ID:', msgId, '- ignoring');
        break;
    }
  }

  private handleManagedAccounts(msg: Buffer): void {
    let offset = 4; // Skip message ID
    const accountList = this.readString(msg, offset);
    const accounts = accountList.split(',').filter(Boolean);
    this.emit('managedAccounts', accounts);
  }

  private handleAccountSummary(msg: Buffer): void {
    let offset = 4; // Skip message ID
    const reqId = msg.readInt32BE(offset); offset += 4;
    const account = this.readString(msg, offset); offset += 4 + account.length;
    const tag = this.readString(msg, offset); offset += 4 + tag.length;
    const value = this.readString(msg, offset); offset += 4 + value.length;
    const currency = this.readString(msg, offset);
    
    this.emit('accountSummary', { reqId, account, tag, value, currency });
  }

  private handlePosition(msg: Buffer): void {
    let offset = 4; // Skip message ID
    const account = this.readString(msg, offset); offset += 4 + account.length;
    // Contract details would follow, but for simplicity, we'll use a simplified version
    // In a full implementation, you'd parse the full contract structure
    this.emit('position', { account });
  }

  private readString(msg: Buffer, offset: number): string {
    if (offset + 4 > msg.length) return '';
    const length = msg.readInt32BE(offset);
    if (offset + 4 + length > msg.length) return '';
    return msg.slice(offset + 4, offset + 4 + length).toString('utf8');
  }

  isConnected(): boolean {
    return this.connected && this.socket !== null;
  }

  async requestManagedAccounts(): Promise<void> {
    if (!this.socket) return;
    
    const reqId = this.requestId++;
    const msg = Buffer.alloc(4);
    msg.writeInt32BE(62, 0); // REQ_MANAGED_ACCOUNTS
    this.sendMessage(msg);
  }

  async requestAccountSummary(group: string, tags: string[]): Promise<void> {
    if (!this.socket) return;
    
    const reqId = this.requestId++;
    const msg = Buffer.alloc(4);
    msg.writeInt32BE(58, 0); // REQ_ACCOUNT_SUMMARY
    this.sendMessage(msg);
    
    // Send request ID
    const reqIdBuf = Buffer.alloc(4);
    reqIdBuf.writeInt32BE(reqId, 0);
    this.sendMessage(reqIdBuf);
    
    // Send group
    const groupBuf = Buffer.from(group, 'utf8');
    const groupLen = Buffer.alloc(4);
    groupLen.writeInt32BE(groupBuf.length, 0);
    this.sendMessage(groupLen);
    this.sendMessage(groupBuf);
    
    // Send tags (comma-separated)
    const tagsStr = tags.join(',');
    const tagsBuf = Buffer.from(tagsStr, 'utf8');
    const tagsLen = Buffer.alloc(4);
    tagsLen.writeInt32BE(tagsBuf.length, 0);
    this.sendMessage(tagsLen);
    this.sendMessage(tagsBuf);
  }

  async requestPositions(): Promise<void> {
    if (!this.socket) return;
    
    const msg = Buffer.alloc(4);
    msg.writeInt32BE(61, 0); // REQ_POSITIONS
    this.sendMessage(msg);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connected = false;
  }
}

class TWSService {
  private protocol: IBKRProtocol | null = null;
  private state: TWSConnectionState = {
    connected: false,
    accounts: [],
    accountSummaries: new Map(),
    positions: [],
    lastUpdate: null,
    error: null,
  };
  private listeners: Set<(state: TWSConnectionState) => void> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  /**
   * Start TWS connection and subscribe to live data
   */
  async connect(): Promise<void> {
    try {
      const host = process.env.TWS_HOST || '127.0.0.1';
      const port = parseInt(process.env.TWS_PORT || '7497', 10);
      const clientId = parseInt(process.env.TWS_CLIENT_ID || '1', 10);

      console.log(`[TWS] Connecting to ${host}:${port}...`);

      this.protocol = new IBKRProtocol();
      
      // Set up event handlers
      this.protocol.on('connected', () => {
        console.log('[TWS] Connected successfully');
        this.state.connected = true;
        this.state.error = null;
        this.notifyListeners();
        this.discoverAccounts();
      });

      this.protocol.on('error', (error: Error) => {
        console.error('[TWS] Error:', error.message);
        this.state.error = error.message;
        this.state.connected = false;
        this.notifyListeners();
        this.scheduleReconnect();
      });

      this.protocol.on('disconnected', () => {
        console.log('[TWS] Disconnected');
        this.state.connected = false;
        this.notifyListeners();
        this.scheduleReconnect();
      });

      this.protocol.on('managedAccounts', (accounts: string[]) => {
        console.log('[TWS] Discovered accounts:', accounts);
        this.handleManagedAccounts(accounts);
      });

      this.protocol.on('accountSummary', (data: { reqId: number; account: string; tag: string; value: string; currency: string }) => {
        this.handleAccountSummary(data);
      });

      this.protocol.on('position', (data: { account: string }) => {
        // Handle position updates
        // Full implementation would parse full position data
      });

      // Connect to TWS/Gateway
      await this.protocol.connect(host, port, clientId);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detailedMessage = `Failed to connect to TWS at ${process.env.TWS_HOST || '127.0.0.1'}:${process.env.TWS_PORT || '7497'}. ${message}. Please ensure TWS/Gateway is running and API is enabled.`;
      console.error('[TWS] Connection failed:', detailedMessage);
      console.error('[TWS] Connection error details:', error);
      this.state.error = detailedMessage;
      this.state.connected = false;
      this.notifyListeners();
      this.scheduleReconnect();
    }
  }

  /**
   * Handle discovered managed accounts
   */
  private handleManagedAccounts(managedAccounts: string[]): void {
    // Load portfolio list from env
    const portfolioList = this.getPortfolioListFromEnv();
    
    // Filter to only include accounts in our portfolio list
    const relevantAccounts = managedAccounts.filter(accountId => 
      portfolioList.includes(accountId)
    );

    this.state.accounts = relevantAccounts;
    console.log('[TWS] Subscribing to accounts:', relevantAccounts);

    if (relevantAccounts.length > 0) {
      this.subscribeToAccountData(relevantAccounts);
    }

    this.notifyListeners();
  }

  /**
   * Handle account summary updates
   */
  private handleAccountSummary(data: { reqId: number; account: string; tag: string; value: string; currency: string }): void {
    let summary = this.state.accountSummaries.get(data.account);
    if (!summary) {
      summary = {
        accountId: data.account,
        netLiquidation: 0,
        unrealizedPnl: 0,
        totalCashValue: 0,
        lastUpdate: new Date(),
      };
      this.state.accountSummaries.set(data.account, summary);
    }

    switch (data.tag) {
      case 'NetLiquidation':
        summary.netLiquidation = parseFloat(data.value) || 0;
        break;
      case 'UnrealizedPnL':
        summary.unrealizedPnl = parseFloat(data.value) || 0;
        break;
      case 'TotalCashValue':
        summary.totalCashValue = parseFloat(data.value) || 0;
        break;
    }

    summary.lastUpdate = new Date();
    this.state.lastUpdate = new Date();
    this.notifyListeners();
  }

  /**
   * Get portfolio list from environment variables
   */
  private getPortfolioListFromEnv(): string[] {
    const count = parseInt(process.env.PORTFOLIO_COUNT || '0', 10);
    const accounts: string[] = [];

    for (let i = 1; i <= count; i++) {
      const accountId = process.env[`P${i}_ACCOUNT_ID`];
      if (accountId) {
        accounts.push(accountId);
      }
    }

    return accounts;
  }

  /**
   * Subscribe to account summary and positions for discovered accounts
   */
  private async subscribeToAccountData(accountIds: string[]): Promise<void> {
    if (!this.protocol || !this.protocol.isConnected()) {
      return;
    }

    try {
      // Request account summary for all accounts
      await this.protocol.requestAccountSummary('All', [
        'NetLiquidation',
        'UnrealizedPnL',
        'TotalCashValue',
      ]);

      // Request positions for all accounts
      await this.protocol.requestPositions();

      // Start periodic updates
      this.startUpdateInterval();

    } catch (error) {
      console.error('[TWS] Failed to subscribe to account data:', error);
      this.state.error = error instanceof Error ? error.message : String(error);
      this.notifyListeners();
    }
  }

  /**
   * Discover managed accounts from TWS
   */
  private async discoverAccounts(): Promise<void> {
    if (!this.protocol || !this.protocol.isConnected()) {
      return;
    }

    try {
      await this.protocol.requestManagedAccounts();
    } catch (error) {
      console.error('[TWS] Failed to discover accounts:', error);
      this.state.error = error instanceof Error ? error.message : String(error);
      this.notifyListeners();
    }
  }

  /**
   * Start periodic update interval
   */
  private startUpdateInterval(): void {
    // Clear existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Request updates every 5 seconds
    this.updateInterval = setInterval(() => {
      if (this.protocol && this.protocol.isConnected() && this.state.accounts.length > 0) {
        // Re-request account summary
        this.protocol.requestAccountSummary('All', [
          'NetLiquidation',
          'UnrealizedPnL',
          'TotalCashValue',
        ]).catch(err => {
          console.error('[TWS] Update error:', err);
        });

        // Re-request positions
        this.protocol.requestPositions().catch(err => {
          console.error('[TWS] Positions update error:', err);
        });
      }
    }, 5000);
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Try to reconnect after 10 seconds
    this.reconnectTimeout = setTimeout(() => {
      if (!this.state.connected) {
        console.log('[TWS] Attempting to reconnect...');
        this.connect().catch(err => {
          console.error('[TWS] Reconnection failed:', err);
        });
      }
    }, 10000);
  }

  /**
   * Get current connection state
   */
  getState(): TWSConnectionState {
    return { ...this.state };
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: TWSConnectionState) => void): () => void {
    this.listeners.add(listener);
    // Immediately send current state
    listener(this.state);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[TWS] Listener error:', error);
      }
    });
  }

  /**
   * Disconnect from TWS
   */
  async disconnect(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.protocol) {
      this.protocol.disconnect();
      this.protocol = null;
    }

    this.state.connected = false;
    this.notifyListeners();
  }

  /**
   * Get total NAV from live data
   */
  getTotalNAV(): number {
    let total = 0;
    for (const summary of this.state.accountSummaries.values()) {
      total += summary.netLiquidation;
    }
    return total;
  }

  /**
   * Get total unrealized P&L
   */
  getTotalUnrealizedPnl(): number {
    let total = 0;
    for (const summary of this.state.accountSummaries.values()) {
      total += summary.unrealizedPnl;
    }
    return total;
  }

  /**
   * Calculate live Simple Return using database cost basis
   */
  async getLiveSimpleReturn(): Promise<number> {
    // Get total invested from database
    // This would need to calculate from Transactions table
    // For now, use a placeholder that could be enhanced
    
    // TODO: Calculate total invested from database
    // For now, we'll need to get this from the existing aggregator logic
    const totalNAV = this.getTotalNAV();
    const totalInvested = 0; // Should come from database calculation
    
    if (totalInvested > 0) {
      return ((totalNAV - totalInvested) / totalInvested) * 100;
    }
    
    return 0;
  }
}

// Singleton instance
let twsServiceInstance: TWSService | null = null;

export function getTWSService(): TWSService {
  if (!twsServiceInstance) {
    twsServiceInstance = new TWSService();
    // Auto-connect on first access
    twsServiceInstance.connect().catch(err => {
      console.error('[TWS] Initial connection failed:', err);
    });
  }
  return twsServiceInstance;
}

export type { TWSConnectionState, AccountSummary, Position };
