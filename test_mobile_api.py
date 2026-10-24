"""
Simple test script for mobile API
Run this after starting the FastAPI server to test the endpoint
"""

import requests
import json

def test_portfolio_summary():
    """Test the /api/portfolio-summary endpoint"""
    try:
        response = requests.get("http://localhost:8000/api/portfolio-summary")
        response.raise_for_status()
        
        data = response.json()
        
        print("=" * 80)
        print("PORTFOLIO SUMMARY API TEST")
        print("=" * 80)
        print(f"\nStatus: {response.status_code}")
        print(f"Timestamp: {data.get('timestamp')}")
        
        print("\n" + "=" * 80)
        print("HEADER (Global Summary)")
        print("=" * 80)
        header = data.get('header', {})
        print(f"Current Value: ${header.get('current_value', 0):,.2f}")
        print(f"Today Change: ${header.get('today_change', 0):,.2f} ({header.get('today_change_percent', 0):.2f}%)")
        print(f"YTD Change: ${header.get('ytd_change', 0):,.2f} ({header.get('ytd_change_percent', 0):.2f}%)")
        
        print("\n" + "=" * 80)
        print("STOCK PORTFOLIOS")
        print("=" * 80)
        portfolios = data.get('stock_portfolios', [])
        print(f"Total Portfolios: {len(portfolios)}\n")
        
        for portfolio in portfolios:
            print(f"Account: {portfolio.get('account_alias')} ({portfolio.get('account_id')})")
            print(f"  Current Value: ${portfolio.get('current_value', 0):,.2f}")
            print(f"  Today: ${portfolio.get('today_change', 0):,.2f} ({portfolio.get('today_change_percent', 0):.2f}%)")
            print(f"  YTD: ${portfolio.get('ytd_change', 0):,.2f} ({portfolio.get('ytd_change_percent', 0):.2f}%)")
            print()
        
        print("=" * 80)
        print("KB FUNDS")
        print("=" * 80)
        kb_funds = data.get('kb_funds', {})
        print(f"Current Value: ${kb_funds.get('current_value', 0):,.2f}")
        print(f"Today Change: ${kb_funds.get('today_change', 0):,.2f} ({kb_funds.get('today_change_percent', 0):.2f}%)")
        print(f"YTD Change: ${kb_funds.get('ytd_change', 0):,.2f} ({kb_funds.get('ytd_change_percent', 0):.2f}%)")
        
        print("\n" + "=" * 80)
        print("VERIFICATION")
        print("=" * 80)
        total_stock = sum(p.get('current_value', 0) for p in portfolios)
        kb_value = kb_funds.get('current_value', 0)
        global_value = header.get('current_value', 0)
        print(f"Stock Portfolios Total: ${total_stock:,.2f}")
        print(f"KB Funds Total: ${kb_value:,.2f}")
        print(f"Global Total (Header): ${global_value:,.2f}")
        print(f"Sum Check: ${total_stock + kb_value:,.2f} (should match Global Total)")
        
        if abs((total_stock + kb_value) - global_value) < 0.01:
            print("✅ Sum verification passed!")
        else:
            print("⚠️  Sum verification failed - there may be a calculation issue")
        
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to API. Make sure the server is running on http://localhost:8000")
        print("   Start the server with: python mobile_api.py")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_portfolio_summary()



