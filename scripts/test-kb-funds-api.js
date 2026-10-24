/**
 * Test the KB Funds API endpoint to see what exchange rate it's receiving
 */

async function testKBFundsAPI() {
  try {
    console.log('🧪 Testing KB Funds API...');
    
    const url = 'http://localhost:3000/api/kb-funds?fund=All&includeValuation=true&usdRate=52.5453';
    console.log(`📡 Calling: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('✅ API Response received');
    console.log(`📊 Valuations count: ${data.valuations?.length || 0}`);
    
    if (data.valuations && data.valuations.length > 0) {
      // Check the exchange rate used in the valuations
      const sampleValuation = data.valuations[0];
      console.log(`💱 Exchange rate in response: ${sampleValuation.usd_rate}`);
      console.log(`📅 Sample date: ${sampleValuation.date}`);
      console.log(`💰 Sample value: $${sampleValuation.value_usd}`);
    }
    
    return data;
    
  } catch (error) {
    console.error('❌ API Test failed:', error.message);
    throw error;
  }
}

testKBFundsAPI()
  .then(data => {
    console.log('\n🎯 Test completed successfully!');
  })
  .catch(error => {
    console.error('💥 Test failed:', error);
  });


