/**
 * Script to generate VAPID keys for Web Push Notifications
 * 
 * Usage: node scripts/generate-vapid-keys.js
 * 
 * Add the output to your .env.local file:
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public-key>
 * VAPID_PRIVATE_KEY=<private-key>
 * VAPID_SUBJECT=mailto:your-email@example.com
 */

const webpush = require('web-push');

console.log('Generating VAPID keys for Web Push Notifications...\n');

const vapidKeys = webpush.generateVAPIDKeys();

console.log('✅ VAPID Keys Generated!\n');
console.log('Add these to your .env.local file:\n');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:your-email@example.com\n`);
console.log('Note: Replace "your-email@example.com" with your actual email address.');
















