/**
 * Test the new exchange rate service
 */

// Since this is a Node.js script, we need to use dynamic import for ES modules
async function testExchangeService() {
  try {
    // Import the exchange rate service
    const { getExchangeRate } = await import('../lib/exchange-rate.js');
    
    console.log('🧪 Testing New Exchange Rate Service');
    console.log('='.repeat(50));
    
    const result = await getExchangeRate();
    
    console.log('✅ SUCCESS!');
    console.log(`📅 Date: ${result.date}`);
    console.log(`💰 Rate: 1 USD = ${result.rate} MKD`);
    console.log(`🏛️  Source: ${result.source}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

testExchangeService()
  .then(result => {
    console.log('\n' + '='.repeat(50));
    console.log('🎯 Test completed successfully!');
  })
  .catch(error => {
    console.error('💥 Test failed:', error);
    process.exit(1);
  });


