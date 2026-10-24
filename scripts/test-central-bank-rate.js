/**
 * Test script for Central Bank of North Macedonia exchange rate
 */

async function getCentralBankRate() {
  console.log('🏦 Testing Central Bank of North Macedonia (NBRM) Exchange Rate');
  console.log('='.repeat(60));
  
  // Look back up to 7 days to find a business day
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - i);
    const dateStr = targetDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    }).replace(/\//g, '.');

    const url = `https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=${dateStr}&EndDate=${dateStr}&format=json`;
    
    console.log(`\n📅 Trying date: ${dateStr}`);
    console.log(`🔗 URL: ${url}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`📊 Data received: ${data.length} entries`);
        
        if (data && Array.isArray(data) && data.length > 0) {
          console.log('💱 Available currencies:');
          data.forEach(entry => {
            console.log(`   ${entry.oznaka}: ${entry.sreden} (${entry.valuta})`);
          });
          
          // Search for USD entry
          const usdEntry = data.find(entry => entry.oznaka === 'USD');
          
          if (usdEntry && usdEntry.sreden) {
            const rate = parseFloat(usdEntry.sreden);
            console.log(`\n✅ SUCCESS: Found USD rate for ${dateStr}`);
            console.log(`💰 Rate: 1 USD = ${rate} MKD`);
            console.log(`📋 Full USD entry:`, usdEntry);
            return { rate, date: dateStr, data: usdEntry };
          } else {
            console.log('❌ USD entry not found in data');
          }
        } else {
          console.log('📭 No data available for this date (likely weekend/holiday)');
        }
      } else {
        console.log(`❌ HTTP Error: ${response.status}`);
      }
    } catch (error) {
      console.log(`💥 Request failed: ${error.message}`);
    }
  }
  
  console.log('\n❌ No exchange rate found in the last 7 days');
  return null;
}

// Test the Central Bank rate
getCentralBankRate()
  .then(result => {
    if (result) {
      console.log('\n' + '='.repeat(60));
      console.log('🎯 FINAL RESULT:');
      console.log(`   Date: ${result.date}`);
      console.log(`   Rate: ${result.rate} MKD`);
      console.log(`   Source: Central Bank of North Macedonia`);
    } else {
      console.log('\n💔 Central Bank test failed - all dates returned no data');
    }
  })
  .catch(error => {
    console.error('Test failed:', error);
  });


