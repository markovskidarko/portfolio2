# Quick APK Build Guide

## Easiest Method: Android Studio

1. **Download Android Studio** (if not installed)
   - https://developer.android.com/studio
   - Install it (includes everything needed)

2. **Open Project**
   - Launch Android Studio
   - Click "Open" → Select the `android-app` folder
   - Wait for Gradle sync (first time takes 5-10 minutes)

3. **Build APK**
   - Menu: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
   - Wait for "Build finished" notification
   - Click "locate" in notification

4. **APK Location**
   ```
   android-app/app/build/outputs/apk/debug/app-debug.apk
   ```

5. **Transfer to Phone**
   - Copy APK to phone (USB, email, cloud, etc.)
   - On phone: Settings → Security → Enable "Install Unknown Apps"
   - Open APK file and install

## That's it! 

The APK file is ready to install on your Android device.



