@echo off
echo ========================================
echo Building Portfolio Tracker APK
echo ========================================
echo.

REM Check if Java is installed
java -version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Java is not installed or not in PATH
    echo Please install Java JDK 17 or higher
    echo Download from: https://adoptium.net/
    pause
    exit /b 1
)

echo Java found!
echo.

REM Check if Android SDK is set
if "%ANDROID_HOME%"=="" (
    echo WARNING: ANDROID_HOME is not set
    echo.
    echo You have two options:
    echo 1. Install Android Studio and build from there (Recommended)
    echo 2. Set ANDROID_HOME to your Android SDK path
    echo.
    echo For option 1:
    echo   - Download Android Studio from: https://developer.android.com/studio
    echo   - Open the android-app folder in Android Studio
    echo   - Go to Build ^> Build Bundle(s) / APK(s) ^> Build APK(s)
    echo   - APK will be in: app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo For option 2:
    echo   - Set ANDROID_HOME environment variable
    echo   - Example: set ANDROID_HOME=C:\Users\YourName\AppData\Local\Android\Sdk
    echo.
    pause
    exit /b 1
)

echo Android SDK found at: %ANDROID_HOME%
echo.

REM Create gradle wrapper if it doesn't exist
if not exist "gradle\wrapper\gradle-wrapper.jar" (
    echo Creating Gradle wrapper...
    call gradle wrapper --gradle-version 8.2
)

REM Build the APK
echo Building APK...
echo.

if exist "gradlew.bat" (
    call gradlew.bat assembleDebug
) else (
    echo ERROR: gradlew.bat not found
    echo Please run this script from the android-app directory
    pause
    exit /b 1
)

if %ERRORLEVEL% equ 0 (
    echo.
    echo ========================================
    echo APK built successfully!
    echo ========================================
    echo.
    echo APK location:
    echo   app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo You can now transfer this file to your Android device and install it.
    echo.
) else (
    echo.
    echo ========================================
    echo Build failed!
    echo ========================================
    echo.
    echo Please check the error messages above.
    echo.
    echo Alternative: Use Android Studio to build the APK
    echo   1. Open android-app folder in Android Studio
    echo   2. Build ^> Build Bundle(s) / APK(s) ^> Build APK(s)
    echo.
)

pause



