# Building the APK File

## Option 1: Using Android Studio (Recommended - Easiest)

1. **Download and Install Android Studio**
   - Download from: https://developer.android.com/studio
   - Install it following the setup wizard

2. **Open the Project**
   - Open Android Studio
   - Click "Open" and select the `android-app` folder
   - Wait for Gradle sync to complete

3. **Build the APK**
   - Go to: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
   - Wait for the build to complete
   - Click "locate" in the notification, or find the APK at:
     ```
     android-app/app/build/outputs/apk/debug/app-debug.apk
     ```

4. **Transfer to Your Phone**
   - Copy `app-debug.apk` to your phone
   - On your phone, enable "Install from Unknown Sources" in Settings
   - Open the APK file and install

## Option 2: Using Command Line (Advanced)

### Prerequisites:
- Java JDK 17 or higher
- Android SDK installed
- Set `ANDROID_HOME` environment variable

### Steps:

1. **Install Java JDK**
   - Download from: https://adoptium.net/
   - Install and add to PATH

2. **Install Android SDK**
   - Download Android Studio (even if you don't use it)
   - Or use command-line tools: https://developer.android.com/studio#command-tools
   - Set `ANDROID_HOME` environment variable:
     ```
     set ANDROID_HOME=C:\Users\YourName\AppData\Local\Android\Sdk
     ```

3. **Build the APK**
   ```bash
   cd android-app
   .\build-apk.bat
   ```

   Or manually:
   ```bash
   cd android-app
   gradlew.bat assembleDebug
   ```

4. **Find the APK**
   - Location: `android-app/app/build/outputs/apk/debug/app-debug.apk`

## Option 3: Using GitHub Actions (If you have a GitHub repo)

You can set up automated builds, but for a single APK, Option 1 is easiest.

## Installing on Your Phone

1. **Transfer the APK**
   - Use USB, email, cloud storage, or ADB
   - Copy `app-debug.apk` to your phone

2. **Enable Unknown Sources**
   - Go to Settings → Security
   - Enable "Install from Unknown Sources" or "Install Unknown Apps"
   - (Location varies by Android version)

3. **Install**
   - Open the APK file on your phone
   - Tap "Install"
   - Once installed, open the app and configure your Tailscale IP and port

## Troubleshooting

### "Gradle sync failed"
- Make sure you have internet connection
- Try: File → Invalidate Caches → Invalidate and Restart

### "SDK not found"
- In Android Studio: Tools → SDK Manager
- Install Android SDK Platform 34 and Build Tools

### "Java not found"
- Install Java JDK 17 or higher
- Set JAVA_HOME environment variable

### Build takes too long
- First build downloads dependencies (can take 5-10 minutes)
- Subsequent builds are much faster



