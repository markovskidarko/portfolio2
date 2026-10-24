# Portfolio Tracker Android App

Android app that connects to the Next.js SSE endpoint and displays real-time portfolio metrics.

## Features

- Real-time streaming of portfolio metrics via Server-Sent Events (SSE)
- Configurable server settings (Tailscale IP and port)
- Displays:
  - Total Wealth (with YTD and Today changes)
  - Stock Market totals
  - KB Funds totals
  - Individual stock portfolios
- Auto-reconnection on connection loss
- Dark theme UI matching the web dashboard

## Setup

1. Open the project in Android Studio
2. Sync Gradle files
3. Build and run on your device/emulator

## Configuration

1. Open the app
2. Tap the Settings icon (top right)
3. Enter your Tailscale IP address (e.g., `100.x.x.x`)
4. Enter the port (default: `3000`)
5. Tap "Save Settings"
6. Restart the app to connect

## Requirements

- Android 7.0 (API 24) or higher
- Network access to your Next.js server via Tailscale

## Building

```bash
cd android-app
./gradlew assembleDebug
```

The APK will be in `app/build/outputs/apk/debug/app-debug.apk`

## Notes

- The app uses HTTP (not HTTPS) for local network connections
- Make sure your Next.js server is accessible via Tailscale
- The app will automatically reconnect if the connection is lost



