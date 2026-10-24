/**
 * Test script to run in browser console to debug exchange rate
 */

console.log('🧪 Testing Exchange Rate Service in Browser');

// Test the exchange rate service directly
async function testInBrowser() {
  try {
    // Import the exchange rate service
    const { getExchangeRate } = await import('/lib/exchange-rate.js');
    
    console.log('📡 Calling getExchangeRate()...');
    const result = await getExchangeRate();
    
    console.log('✅ Result:', result);
    console.log(`📅 Date: ${result.date}`);
    console.log(`💰 Rate: ${result.rate}`);
    console.log(`🏛️ Source: ${result.source}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Browser test failed:', error);
    
    // Test individual sources
    console.log('🔄 Testing Central Bank directly...');
    
    try {
      const response = await fetch('https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=24.01.2026&EndDate=24.01.2026&format=json', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const data = await response.json();
      console.log('🏦 Central Bank response:', data);
      
      const usdEntry = data.find(entry => entry.oznaka === 'USD');
      console.log('💱 USD entry:', usdEntry);
      
    } catch (err) {
      console.error('❌ Central Bank test failed:', err);
    }
  }
}

testInBrowser();


