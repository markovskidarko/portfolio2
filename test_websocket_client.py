"""
Simple WebSocket test client for mobile API
Run this to test the /ws/all-metrics WebSocket endpoint
"""

import asyncio
import websockets
import json
from datetime import datetime

async def test_websocket():
    """Test WebSocket connection and receive metrics"""
    uri = "ws://localhost:8000/ws/all-metrics"
    
    print("=" * 80)
    print("WEBSOCKET CLIENT TEST")
    print("=" * 80)
    print(f"\nConnecting to: {uri}")
    print("Waiting for metrics updates (every 2 seconds)...\n")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("✓ Connected to WebSocket server\n")
            
            # Receive messages
            update_count = 0
            while True:
                try:
                    # Wait for message with timeout
                    message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    update_count += 1
                    
                    # Parse JSON
                    data = json.loads(message)
                    
                    print(f"[Update #{update_count}] {datetime.now().strftime('%H:%M:%S')}")
                    print("-" * 80)
                    
                    # Display header (Global Summary)
                    header = data.get('header', {})
                    print(f"Global Summary:")
                    print(f"  Current Value: ${header.get('current_value', 0):,.2f}")
                    print(f"  Today: ${header.get('today_change', 0):,.2f} ({header.get('today_change_percent', 0):.2f}%)")
                    print(f"  YTD: ${header.get('ytd_change', 0):,.2f} ({header.get('ytd_change_percent', 0):.2f}%)")
                    
                    # Display Stock Portfolios
                    portfolios = data.get('stock_portfolios', [])
                    print(f"\nStock Portfolios ({len(portfolios)} accounts):")
                    for portfolio in portfolios:
                        print(f"  {portfolio.get('account_alias')} ({portfolio.get('account_id')}):")
                        print(f"    Value: ${portfolio.get('current_value', 0):,.2f}")
                        print(f"    Today: ${portfolio.get('today_change', 0):,.2f} ({portfolio.get('today_change_percent', 0):.2f}%)")
                        print(f"    YTD: ${portfolio.get('ytd_change', 0):,.2f} ({portfolio.get('ytd_change_percent', 0):.2f}%)")
                    
                    # Display KB Funds
                    kb_funds = data.get('kb_funds', {})
                    print(f"\nKB Funds:")
                    print(f"  Current Value: ${kb_funds.get('current_value', 0):,.2f}")
                    print(f"  Today: ${kb_funds.get('today_change', 0):,.2f} ({kb_funds.get('today_change_percent', 0):.2f}%)")
                    print(f"  YTD: ${kb_funds.get('ytd_change', 0):,.2f} ({kb_funds.get('ytd_change_percent', 0):.2f}%)")
                    
                    print(f"\nTimestamp: {data.get('timestamp')}")
                    print("=" * 80)
                    print()
                    
                except asyncio.TimeoutError:
                    print("⚠️  No update received in 5 seconds (server may be down)")
                    break
                except KeyboardInterrupt:
                    print("\n\nDisconnecting...")
                    break
                    
    except websockets.exceptions.ConnectionClosed:
        print("✗ Connection closed by server")
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("Starting WebSocket test client...")
    print("Press Ctrl+C to stop\n")
    try:
        asyncio.run(test_websocket())
    except KeyboardInterrupt:
        print("\nTest client stopped")



