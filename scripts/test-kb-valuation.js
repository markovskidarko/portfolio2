/**
 * Test KB Funds calculateValuation function directly
 */

async function testKBValuation() {
  try {
    console.log('🧪 Testing KB Funds calculateValuation...');
    
    // Test the calculateValuation function through API
    const today = new Date().toISOString().split('T')[0]; // 2026-01-24
    const testRate = 52.5453;
    
    console.log(`📅 Testing date: ${today}`);
    console.log(`💱 Testing rate: ${testRate}`);
    
    const response = await fetch(`http://localhost:3000/api/kb-funds?fund=All&includeValuation=true&usdRate=${testRate}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('✅ KB Funds API response received');
    console.log(`📊 Valuations count: ${data.valuations?.length || 0}`);
    
    if (data.valuations && data.valuations.length > 0) {
      // Find Total Portfolio
      const totalPortfolio = data.valuations.find(v => v.fund_name === 'Total Portfolio');
      
      if (totalPortfolio) {
        console.log('🎯 Found Total Portfolio:');
        console.log(`  📅 Date: ${totalPortfolio.date}`);
        console.log(`  💰 Value USD: $${totalPortfolio.value_usd}`);
        console.log(`  💱 Exchange Rate: ${totalPortfolio.usd_rate}`);
      } else {
        console.log('❌ Total Portfolio not found in valuations');
        console.log('Available fund names:', data.valuations.map(v => v.fund_name));
      }
      
      // Show a few sample valuations
      console.log('\n📋 Sample valuations:');
      data.valuations.slice(0, 3).forEach(v => {
        console.log(`  ${v.fund_name}: $${v.value_usd} (${v.date})`);
      });
      
    } else {
      console.log('❌ No valuations returned');
      console.log('Full response:', data);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testKBValuation();


