/**
 * Test script to fetch USD/MKD exchange rate from all available sources
 */

const sources = [
  {
    id: 1,
    name: 'ExchangeRate-API',
    url: 'https://api.exchangerate-api.com/v4/latest/USD',
    parser: (data) => data.rates?.MKD,
    description: 'Free tier, no API key required'
  },
  {
    id: 2,
    name: 'Open Exchange Rates API (Free)',
    url: 'https://open.er-api.com/v6/latest/USD',
    parser: (data) => data.rates?.MKD,
    description: 'Alternative free API'
  },
  {
    id: 3,
    name: 'Fixer.io (Free tier)',
    url: 'https://api.fixer.io/latest?base=USD&symbols=MKD',
    parser: (data) => data.rates?.MKD,
    description: 'Popular currency API with free tier'
  },
  {
    id: 4,
    name: 'CDN Currency API',
    url: 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/usd/mkd.json',
    parser: (data) => data.mkd,
    description: 'GitHub-hosted currency data via CDN'
  },
  {
    id: 5,
    name: 'Exchange Rates API (EU)',
    url: 'https://api.exchangerate.host/latest?base=USD&symbols=MKD',
    parser: (data) => data.rates?.MKD,
    description: 'European Central Bank data'
  },
  {
    id: 6,
    name: 'CurrencyAPI (Alternative)',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    parser: (data) => data.usd?.mkd,
    description: 'Alternative CDN-hosted currency API'
  }
];

async function testExchangeRateSource(source) {
  const startTime = Date.now();
  
  try {
    console.log(`\n🔄 Testing: ${source.name}`);
    console.log(`   URL: ${source.url}`);
    console.log(`   Description: ${source.description}`);
    
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const mkdRate = source.parser(data);
    
    // Validate the rate
    if (mkdRate && typeof mkdRate === 'number' && mkdRate > 30 && mkdRate < 100) {
      console.log(`   ✅ SUCCESS: 1 USD = ${mkdRate} MKD`);
      console.log(`   ⏱️  Response time: ${responseTime}ms`);
      return {
        source: source.name,
        rate: mkdRate,
        responseTime,
        status: 'success'
      };
    } else {
      console.log(`   ❌ INVALID RATE: ${mkdRate}`);
      return {
        source: source.name,
        rate: null,
        responseTime,
        status: 'invalid_rate',
        error: `Invalid rate: ${mkdRate}`
      };
    }
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`   ❌ FAILED: ${error.message}`);
    console.log(`   ⏱️  Failed after: ${responseTime}ms`);
    
    return {
      source: source.name,
      rate: null,
      responseTime,
      status: 'error',
      error: error.message
    };
  }
}

async function testAllSources() {
  console.log('🌍 USD/MKD Exchange Rate Test - All Sources');
  console.log('=' .repeat(60));
  console.log(`📅 Test Date: ${new Date().toLocaleString()}`);
  console.log(`🔍 Testing ${sources.length} exchange rate sources...\n`);
  
  const results = [];
  
  // Test all sources
  for (const source of sources) {
    const result = await testExchangeRateSource(source);
    results.push(result);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status !== 'success');
  
  console.log(`✅ Successful sources: ${successful.length}/${sources.length}`);
  console.log(`❌ Failed sources: ${failed.length}/${sources.length}\n`);
  
  if (successful.length > 0) {
    console.log('💰 SUCCESSFUL RATES:');
    successful
      .sort((a, b) => a.responseTime - b.responseTime) // Sort by response time
      .forEach((result, index) => {
        const fastest = index === 0 ? ' 🏆 (FASTEST)' : '';
        console.log(`   ${result.source}: ${result.rate} MKD (${result.responseTime}ms)${fastest}`);
      });
    
    // Calculate statistics
    const rates = successful.map(r => r.rate);
    const avgRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    const minRate = Math.min(...rates);
    const maxRate = Math.max(...rates);
    const avgResponseTime = successful.reduce((sum, r) => sum + r.responseTime, 0) / successful.length;
    
    console.log('\n📈 STATISTICS:');
    console.log(`   Average Rate: ${avgRate.toFixed(4)} MKD`);
    console.log(`   Rate Range: ${minRate.toFixed(4)} - ${maxRate.toFixed(4)} MKD`);
    console.log(`   Rate Variance: ${(maxRate - minRate).toFixed(4)} MKD`);
    console.log(`   Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
    
    // Recommended rate (most common or average)
    console.log(`\n🎯 RECOMMENDED RATE: ${avgRate.toFixed(2)} MKD`);
  }
  
  if (failed.length > 0) {
    console.log('\n💔 FAILED SOURCES:');
    failed.forEach(result => {
      console.log(`   ${result.source}: ${result.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✨ Test completed!');
  
  return {
    successful: successful.length,
    failed: failed.length,
    rates: successful.map(r => ({ source: r.source, rate: r.rate })),
    recommendedRate: successful.length > 0 ? successful.reduce((sum, r) => sum + r.rate, 0) / successful.length : null
  };
}

// Run the test
testAllSources()
  .then(summary => {
    if (summary.recommendedRate) {
      console.log(`\n🏁 FINAL RESULT: Use ${summary.recommendedRate.toFixed(2)} MKD as the current USD/MKD exchange rate`);
    } else {
      console.log('\n💥 CRITICAL: No exchange rate sources are working!');
    }
  })
  .catch(error => {
    console.error('Test failed:', error);
  });


