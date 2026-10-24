/**
 * Simple test for SSE endpoint to check KB Funds values
 */

async function testSSE() {
  try {
    console.log('🧪 Testing SSE endpoint...');
    
    const response = await fetch('http://localhost:3000/api/ws/all-metrics');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    console.log('📡 Reading SSE stream...');
    
    // Read first few chunks
    for (let i = 0; i < 3; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      console.log(`\n📦 Chunk ${i + 1}:`);
      console.log(chunk);
      
      // Try to parse the JSON data
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.substring(6);
            const data = JSON.parse(jsonStr);
            
            if (data.type === 'metrics') {
              const metrics = data.data;
              console.log(`\n💰 KB Funds Current Value: $${metrics.kbFundsCurrentValue}`);
              console.log(`📈 KB Funds YTD: $${metrics.kbFundsYTD}`);
              console.log(`📊 KB Funds Today: $${metrics.kbFundsToday}`);
              
              if (metrics.kbFundsCurrentValue === 0) {
                console.log('❌ KB Funds is showing 0 - there\'s an issue!');
              } else {
                console.log('✅ KB Funds values look good!');
              }
            }
          } catch (parseError) {
            // Ignore parse errors for partial chunks
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ SSE test failed:', error);
  }
}

testSSE();


