/**
 * Test Central Bank API for CORS issues
 */

async function testCentralBankCORS() {
  console.log('🧪 Testing Central Bank API for CORS issues...');
  
  const targetDate = '24.01.2026';
  const url = `https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=${targetDate}&EndDate=${targetDate}&format=json`;
  
  console.log(`📡 Testing URL: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    console.log(`📊 Response status: ${response.status} ${response.statusText}`);
    console.log(`📋 Response headers:`, [...response.headers.entries()]);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Data received: ${data.length} entries`);
      
      const usdEntry = data.find(entry => entry.oznaka === 'USD');
      if (usdEntry) {
        console.log(`💰 USD Rate: ${usdEntry.sreden} MKD`);
        return { success: true, rate: usdEntry.sreden };
      } else {
        console.log('❌ USD entry not found');
        return { success: false, error: 'USD entry not found' };
      }
    } else {
      console.log(`❌ HTTP Error: ${response.status}`);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
  } catch (error) {
    console.error('❌ Fetch failed:', error);
    
    if (error.name === 'TypeError' && error.message.includes('CORS')) {
      console.log('🚫 CORS Error detected - Central Bank API blocks browser requests');
      return { success: false, error: 'CORS blocked' };
    }
    
    return { success: false, error: error.message };
  }
}

// Test CurrencyAPI as well
async function testCurrencyAPI() {
  console.log('\n💱 Testing CurrencyAPI...');
  
  try {
    const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    
    if (response.ok) {
      const data = await response.json();
      const rate = data.usd?.mkd;
      console.log(`✅ CurrencyAPI Rate: ${rate} MKD`);
      return { success: true, rate };
    }
  } catch (error) {
    console.error('❌ CurrencyAPI failed:', error);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  const centralBankResult = await testCentralBankCORS();
  const currencyApiResult = await testCurrencyAPI();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST RESULTS:');
  console.log('='.repeat(50));
  console.log(`🏦 Central Bank: ${centralBankResult.success ? '✅ Success' : '❌ Failed'} - ${centralBankResult.success ? centralBankResult.rate + ' MKD' : centralBankResult.error}`);
  console.log(`💱 CurrencyAPI: ${currencyApiResult.success ? '✅ Success' : '❌ Failed'} - ${currencyApiResult.success ? currencyApiResult.rate + ' MKD' : currencyApiResult.error}`);
  
  if (!centralBankResult.success && centralBankResult.error === 'CORS blocked') {
    console.log('\n🔍 DIAGNOSIS: Central Bank API is blocked by CORS in browser');
    console.log('💡 SOLUTION: The exchange rate service needs to run server-side only');
  }
}

runTests();


