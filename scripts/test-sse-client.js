/**
 * Simple Node.js SSE client for testing the /api/ws/all-metrics endpoint
 * Run with: node scripts/test-sse-client.js
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ENDPOINT = '/api/ws/all-metrics';

function connectSSE() {
  const url = new URL(BASE_URL + ENDPOINT);
  const protocol = url.protocol === 'https:' ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  };

  console.log(`[SSE Client] Connecting to ${BASE_URL}${ENDPOINT}...`);
  
  const req = protocol.request(options, (res) => {
    if (res.statusCode !== 200) {
      console.error(`[SSE Client] Error: HTTP ${res.statusCode}`);
      res.on('data', (chunk) => {
        console.error(`[SSE Client] Response:`, chunk.toString());
      });
      return;
    }

    console.log(`[SSE Client] ✓ Connected! Status: ${res.statusCode}`);
    console.log(`[SSE Client] Headers:`, res.headers);
    console.log(`\n[SSE Client] Listening for messages...\n`);

    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      
      // Process complete SSE messages (lines ending with \n\n)
      const messages = buffer.split('\n\n');
      buffer = messages.pop() || ''; // Keep incomplete message in buffer
      
      for (const message of messages) {
        if (message.trim()) {
          processSSEMessage(message);
        }
      }
    });

    res.on('end', () => {
      console.log(`[SSE Client] Connection closed by server`);
      console.log(`[SSE Client] Reconnecting in 3 seconds...`);
      setTimeout(connectSSE, 3000);
    });

    res.on('error', (error) => {
      console.error(`[SSE Client] Response error:`, error);
      console.log(`[SSE Client] Reconnecting in 3 seconds...`);
      setTimeout(connectSSE, 3000);
    });
  });

  req.on('error', (error) => {
    console.error(`[SSE Client] Request error:`, error.message);
    console.log(`[SSE Client] Reconnecting in 3 seconds...`);
    setTimeout(connectSSE, 3000);
  });

  req.end();
}

function processSSEMessage(message) {
  const lines = message.split('\n');
  const data = {};
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try {
        const jsonData = JSON.parse(line.substring(6));
        
        if (jsonData.type === 'connected') {
          console.log(`[SSE Client] ✓ ${jsonData.message}`);
        } else if (jsonData.type === 'metrics') {
          const m = jsonData.data;
          const timestamp = new Date(m.timestamp).toLocaleTimeString();
          
          console.log(`\n${'='.repeat(80)}`);
          console.log(`[${timestamp}] Metrics Update`);
          console.log(`${'='.repeat(80)}`);
          
          console.log(`\n📊 Total Wealth: ${formatCurrency(m.totalWealth)}`);
          console.log(`   YTD: ${formatCurrency(m.totalWealthYTD)} (${formatPercent(m.totalWealthYTDPercent)})`);
          console.log(`   Today: ${formatCurrency(m.totalWealthToday)} (${formatPercent(m.totalWealthTodayPercent)})`);
          
          console.log(`\n📈 Stock Market: ${formatCurrency(m.stockMarketTotal)}`);
          console.log(`   YTD: ${formatCurrency(m.stockMarketYTD)} (${formatPercent(m.stockMarketYTDPercent)})`);
          console.log(`   Today: ${formatCurrency(m.stockMarketToday)} (${formatPercent(m.stockMarketTodayPercent)})`);
          
          console.log(`\n💰 KB Funds: ${formatCurrency(m.kbFundsCurrentValue)}`);
          console.log(`   YTD: ${formatCurrency(m.kbFundsYTD)} (${formatPercent(m.kbFundsYTDPercent)})`);
          console.log(`   Today: ${formatCurrency(m.kbFundsToday)} (${formatPercent(m.kbFundsTodayPercent)})`);
          
          if (m.stockPortfolios && m.stockPortfolios.length > 0) {
            console.log(`\n📋 Stock Portfolios (${m.stockPortfolios.length}):`);
            for (const portfolio of m.stockPortfolios) {
              console.log(`   ${portfolio.accountAlias} (${portfolio.accountId}):`);
              console.log(`     Value: ${formatCurrency(portfolio.currentValue)}`);
              console.log(`     YTD: ${formatCurrency(portfolio.ytdChange)} (${formatPercent(portfolio.ytdChangePercent)})`);
              console.log(`     Today: ${formatCurrency(portfolio.todayChange)} (${formatPercent(portfolio.todayChangePercent)})`);
            }
          }
          
          console.log(`\n${'='.repeat(80)}\n`);
        } else if (jsonData.type === 'error') {
          console.error(`[SSE Client] Error: ${jsonData.message}`);
        }
      } catch (error) {
        console.error(`[SSE Client] Error parsing JSON:`, error);
        console.error(`[SSE Client] Raw message:`, line.substring(6));
      }
    }
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// Start connection
connectSSE();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n[SSE Client] Shutting down...`);
  process.exit(0);
});

