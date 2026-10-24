/**
 * Script to generate PWA icons (192x192 and 512x512)
 * Creates black square icons with a green 'P' in the center
 * 
 * Usage: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

// Check if canvas is available, if not, we'll use a simple approach
let canvas;
try {
  canvas = require('canvas');
} catch (e) {
  console.log('Canvas not available, using fallback method...');
}

function generateIconWithCanvas(size) {
  const { createCanvas } = canvas;
  const imgCanvas = createCanvas(size, size);
  const ctx = imgCanvas.getContext('2d');

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  // Green 'P' in the center
  ctx.fillStyle = '#00FF00';
  ctx.font = `bold ${size * 0.6}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', size / 2, size / 2);

  // Convert to buffer
  const buffer = imgCanvas.toBuffer('image/png');
  return buffer;
}

function generateIconFallback(size) {
  // Create a minimal valid PNG using base64 encoding
  // This is a simple black square (1x1) PNG that we'll need to scale
  // For a proper implementation, we'd need canvas or sharp, but for now
  // we'll create a simple black PNG and note that the user should replace it
  
  // Minimal valid PNG header (black 1x1 pixel)
  // This is a placeholder - real implementation should use canvas/sharp
  console.warn(`⚠️  Canvas library not available. Generating minimal placeholder for ${size}x${size} icon.`);
  console.warn(`   Please install 'canvas' package for better icon generation: npm install canvas`);
  
  // Create a minimal black PNG (this is a 1x1 black pixel PNG in base64)
  const minimalBlackPNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  
  return minimalBlackPNG;
}

async function generateIcons() {
  const publicDir = path.join(process.cwd(), 'public');
  
  // Ensure public directory exists
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
    console.log('✅ Created public directory');
  }

  const sizes = [192, 512];
  
  for (const size of sizes) {
    const iconPath = path.join(publicDir, `icon-${size}.png`);
    
    let buffer;
    if (canvas) {
      buffer = generateIconWithCanvas(size);
      console.log(`✅ Generated icon-${size}.png using canvas`);
    } else {
      buffer = generateIconFallback(size);
      console.log(`⚠️  Generated placeholder icon-${size}.png (please replace with proper icon)`);
    }
    
    fs.writeFileSync(iconPath, buffer);
  }
  
  console.log('\n✨ Icon generation complete!');
  if (!canvas) {
    console.log('\n📝 Note: Install canvas package for better icon generation:');
    console.log('   npm install canvas');
  }
}

generateIcons().catch(console.error);
















