/**
 * Test to find the latest KB Funds date in database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'portfolio.db');

function testLatestKBDate() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    
    console.log('🔍 Finding latest KB Funds date...');
    
    db.get('SELECT MAX(date) as latest_date FROM KBFundPrices', (err, row) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
        return;
      }
      
      console.log('✅ Latest KB Funds date:', row?.latest_date || 'No data found');
      
      // Also check how many records we have
      db.get('SELECT COUNT(*) as count FROM KBFundPrices', (err2, countRow) => {
        if (err2) {
          console.error('❌ Count error:', err2);
        } else {
          console.log('📊 Total KB Funds records:', countRow?.count || 0);
        }
        
        db.close();
        resolve(row?.latest_date);
      });
    });
  });
}

testLatestKBDate()
  .then(latestDate => {
    console.log(`\n🎯 Latest date to use for calculations: ${latestDate}`);
  })
  .catch(error => {
    console.error('💥 Test failed:', error);
  });


