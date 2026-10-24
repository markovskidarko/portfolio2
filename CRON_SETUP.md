# Daily Summary Notification CRON Setup

This document explains how to set up the daily summary notification job that sends push notifications at market close.

## Overview

The daily summary notification sends a push notification to all subscribed users at market close (typically 4:00 PM ET) with their portfolio performance for the day.

## API Endpoint

**GET** `/api/push/daily-summary`

This endpoint:
1. Fetches all push notification subscriptions from the database
2. Calculates daily portfolio change (current NAV vs previous day)
3. Sends push notifications to all subscribers

## Authentication

The endpoint requires authentication via a Bearer token in the Authorization header:

```
Authorization: Bearer <CRON_SECRET>
```

Set `CRON_SECRET` in your `.env.local` file.

## Setup Options

### Option 1: Vercel Cron Jobs (Recommended for Vercel deployments)

Create a `vercel.json` file in your project root:

```json
{
  "crons": [
    {
      "path": "/api/push/daily-summary",
      "schedule": "0 20 * * 1-5"
    }
  ]
}
```

This runs at 8:00 PM UTC (4:00 PM ET) on weekdays (Monday-Friday).

**Note:** Vercel Cron requires a Pro plan. For free tier, use Option 2 or 3.

### Option 2: External CRON Service

Use a service like:
- **cron-job.org** (free)
- **EasyCron** (free tier available)
- **GitHub Actions** (free)

Configure it to call:
```
GET https://your-domain.com/api/push/daily-summary
Authorization: Bearer <your-cron-secret>
```

Schedule: `0 20 * * 1-5` (8:00 PM UTC, weekdays)

### Option 3: Server-Side Interval (Development/Testing)

For local development or testing, you can add an interval in your Next.js app. However, this is **not recommended for production** as it requires the server to be running continuously.

Add to `lib/startup.ts` or create a background job:

```typescript
// Only run if CRON_SECRET is set (production)
if (process.env.CRON_SECRET) {
  setInterval(async () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    
    // Check if it's 8:00 PM UTC (4:00 PM ET) on a weekday
    if (hour === 20 && day >= 1 && day <= 5) {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/push/daily-summary`, {
          headers: {
            'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          },
        });
        const result = await response.json();
        console.log('[Daily Summary] Sent:', result);
      } catch (error) {
        console.error('[Daily Summary] Error:', error);
      }
    }
  }, 60000); // Check every minute
}
```

## Environment Variables

Add to `.env.local`:

```env
# VAPID keys for push notifications (already set up)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:your-email@example.com

# CRON authentication
CRON_SECRET=your-random-secret-token-here
```

Generate a secure random token for `CRON_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Testing

Test the endpoint manually:

```bash
curl -X GET https://your-domain.com/api/push/daily-summary \
  -H "Authorization: Bearer your-cron-secret"
```

Or use a tool like Postman/Insomnia.

## Notification Format

The notification will show:
- **Title**: "📈 Portfolio Update" or "📉 Portfolio Update"
- **Body**: "Portfolio Update: Your wealth is up +0.82% ($1,420) today"
- **Icon**: App icon
- **Data**: Includes NAV, change, and changePercent for deep linking

## Troubleshooting

1. **No notifications sent**: Check that users have subscribed via the Settings toggle
2. **401 Unauthorized**: Verify `CRON_SECRET` matches in both the CRON service and `.env.local`
3. **Invalid subscriptions**: The endpoint automatically removes invalid subscriptions (410 Gone)
4. **Wrong time**: Adjust the CRON schedule to match your timezone (market close is typically 4:00 PM ET)















