/**
 * Test the new exchange rate API endpoint
 */

async function testExchangeRateAPI() {
  try {
    console.log('🧪 Testing Exchange Rate API endpoint...');
    
    const response = await fetch('http://localhost:3000/api/exchange-rate');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('✅ API Response:', data);
    
    if (data.success) {
      console.log(`📅 Date: ${data.date}`);
      console.log(`💰 Rate: 1 USD = ${data.rate} MKD`);
      console.log(`🏛️ Source: ${data.source}`);
      
      // Check if it's the Central Bank rate
      if (data.source === 'Central Bank of North Macedonia') {
        console.log('🎯 SUCCESS: Using Central Bank as expected!');
      } else {
        console.log('⚠️ WARNING: Using fallback source instead of Central Bank');
      }
    } else {
      console.log('❌ API returned error:', data.error);
    }
    
    return data;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

testExchangeRateAPI()
  .then(result => {
    console.log('\n🎉 Test completed successfully!');
  })
  .catch(error => {
    console.error('💥 Test failed:', error);
  });