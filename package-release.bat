@echo off
setlocal EnableExtensions DisableDelayedExpansion

cd /d "%~dp0"
set "exit_code=0"
set "RELEASE_OUTPUT=%~dp0release-output"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found on PATH.
  echo Install pnpm or enable Corepack, then run this file again.
  set "exit_code=1"
  goto :finish
)

if /i "%~1"=="windows" goto :run_windows_arg
if /i "%~1"=="android-debug-apk" goto :run_android_debug_arg
if /i "%~1"=="android-release-apk" goto :run_android_release_arg
if /i "%~1"=="android-release-aab" goto :run_android_aab_arg
if /i "%~1"=="all" goto :run_all_arg

:run_windows_arg
if /i not "%~1"=="windows" goto :run_android_debug_arg
call :build_windows
set "exit_code=%errorlevel%"
goto :finish

:run_android_debug_arg
if /i not "%~1"=="android-debug-apk" goto :run_android_release_arg
call :build_android_debug_apk
set "exit_code=%errorlevel%"
goto :finish

:run_android_release_arg
if /i not "%~1"=="android-release-apk" goto :run_android_aab_arg
call :build_android_release_apk
set "exit_code=%errorlevel%"
goto :finish

:run_android_aab_arg
if /i not "%~1"=="android-release-aab" goto :run_all_arg
call :build_android_release_aab
set "exit_code=%errorlevel%"
goto :finish

:run_all_arg
if /i not "%~1"=="all" goto :menu
call :build_all
set "exit_code=%errorlevel%"
goto :finish

:menu
echo.
echo TaskDock release builder
echo =======================
echo 1. Windows installer
echo 2. Android debug APK (four ABIs)
echo 3. Android release APK
echo 4. Android release AAB
echo 5. Build all targets (debug + release)
echo 0. Exit
echo.
set "choice="
set /p "choice=Select a target: "
if errorlevel 1 goto :finish

if "%choice%"=="1" goto :run_windows_menu
if "%choice%"=="2" goto :run_android_debug_menu
if "%choice%"=="3" goto :run_android_release_menu
if "%choice%"=="4" goto :run_android_aab_menu
if "%choice%"=="5" goto :run_all_menu
if "%choice%"=="0" goto :finish

echo Invalid choice.
goto :menu

:run_windows_menu
call :build_windows
set "exit_code=%errorlevel%"
goto :finish

:run_android_debug_menu
call :build_android_debug_apk
set "exit_code=%errorlevel%"
goto :finish

:run_android_release_menu
call :build_android_release_apk
set "exit_code=%errorlevel%"
goto :finish

:run_android_aab_menu
call :build_android_release_aab
set "exit_code=%errorlevel%"
goto :finish

:run_all_menu
call :build_all
set "exit_code=%errorlevel%"
goto :finish

:build_windows
echo.
echo [Windows] Cleaning build cache...
call :clean_build_cache
if errorlevel 1 exit /b 1

echo [Windows] Building installer...
call pnpm tauri build
set "build_code=%errorlevel%"
if not "%build_code%"=="0" (
  echo [Windows] Build failed with exit code %build_code%.
  exit /b %build_code%
)

echo [Windows] Build completed.
call :archive_windows
if errorlevel 1 exit /b 1
echo Archived installers: %RELEASE_OUTPUT%\windows\
exit /b 0

:build_android_debug_apk
call :prepare_android
if errorlevel 1 exit /b 1

echo.
echo [Android debug APK] Cleaning build cache...
call :clean_build_cache
if errorlevel 1 exit /b 1

echo [Android debug APK] Building...
call pnpm tauri android build --debug --target aarch64 armv7 i686 x86_64 --split-per-abi --apk
set "build_code=%errorlevel%"
if not "%build_code%"=="0" (
  echo [Android debug APK] Build failed with exit code %build_code%.
  echo If the error mentions symbolic links, see docs\android-build.md.
  exit /b %build_code%
)

echo [Android debug APK] Build completed.
call :archive_android_debug
if errorlevel 1 exit /b 1
echo Archived APKs: %RELEASE_OUTPUT%\android\apk\debug\
exit /b 0

:build_android_release_apk
call :prepare_android
if errorlevel 1 exit /b 1

echo.
echo [Android release APK] Cleaning build cache...
call :clean_build_cache
if errorlevel 1 exit /b 1

echo [Android release APK] Building...
call pnpm tauri android build --target aarch64 --split-per-abi --apk
set "build_code=%errorlevel%"
if not "%build_code%"=="0" (
  echo [Android release APK] Build failed with exit code %build_code%.
  echo If the error mentions symbolic links, see docs\android-build.md.
  exit /b %build_code%
)

echo [Android release APK] Build completed.
call :archive_android_release_apk
if errorlevel 1 exit /b 1
echo Archived APKs: %RELEASE_OUTPUT%\android\apk\release\
exit /b 0

:build_android_release_aab
call :prepare_android
if errorlevel 1 exit /b 1

echo.
echo [Android release AAB] Cleaning build cache...
call :clean_build_cache
if errorlevel 1 exit /b 1

echo [Android release AAB] Building...
call pnpm tauri android build --aab
set "build_code=%errorlevel%"
if not "%build_code%"=="0" (
  echo [Android release AAB] Build failed with exit code %build_code%.
  echo If the error mentions symbolic links, see docs\android-build.md.
  exit /b %build_code%
)

echo [Android release AAB] Build completed.
call :archive_android_release_aab
if errorlevel 1 exit /b 1
echo Archived AABs: %RELEASE_OUTPUT%\android\aab\release\
exit /b 0

:build_all
set "overall_code=0"
call :build_windows
if errorlevel 1 set "overall_code=1"
call :build_android_debug_apk
if errorlevel 1 set "overall_code=1"
call :build_android_release_apk
if errorlevel 1 set "overall_code=1"
call :build_android_release_aab
if errorlevel 1 set "overall_code=1"
exit /b %overall_code%

:prepare_android
if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if not defined ANDROID_HOME set "ANDROID_HOME=D:\soft\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"

if not exist "%ANDROID_HOME%\platform-tools" (
  echo Android SDK platform-tools was not found at "%ANDROID_HOME%\platform-tools".
  echo Set ANDROID_HOME to the Android SDK root and try again.
  exit /b 1
)
if not exist "%ANDROID_HOME%\platforms" (
  echo Android SDK platforms directory was not found at "%ANDROID_HOME%\platforms".
  echo Install an Android platform package and try again.
  exit /b 1
)
where java >nul 2>&1
if errorlevel 1 (
  echo Java was not found on PATH.
  echo Install JDK 17 or add its bin directory to PATH, then try again.
  exit /b 1
)

set "PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"
exit /b 0

:clean_build_cache
if exist "%~dp0src-tauri\gen\android\gradlew.bat" pushd "%~dp0src-tauri\gen\android"
if exist "%~dp0src-tauri\gen\android\gradlew.bat" cmd /d /c gradlew.bat --stop >nul 2>&1
if exist "%~dp0src-tauri\gen\android\gradlew.bat" popd

for %%D in (
  "%~dp0dist"
  "%~dp0src-tauri\target"
  "%~dp0src-tauri\gen\android\app\build"
  "%~dp0src-tauri\gen\android\app\.cxx"
  "%~dp0src-tauri\gen\android\build"
  "%~dp0src-tauri\gen\android\.gradle"
) do (
  for /l %%I in (1,1,3) do (
    if exist "%%~D" rmdir /s /q "%%~D" 2>nul
    if exist "%%~D" timeout /t 1 /nobreak >nul
  )
  if exist "%%~D" (
    echo Failed to remove "%%~D".
    echo Close Android Studio, Gradle or other programs using this directory and try again.
    exit /b 1
  )
)
exit /b 0

:archive_windows
call :remove_dir "%RELEASE_OUTPUT%\windows"
if errorlevel 1 exit /b 1
call :copy_optional_artifacts "%~dp0src-tauri\target\release\bundle\nsis" "%RELEASE_OUTPUT%\windows\nsis" "*.exe"
if errorlevel 1 exit /b 1
if not exist "%RELEASE_OUTPUT%\windows\nsis\*.exe" (
  echo No Windows NSIS installer was found to archive.
  exit /b 1
)
call :copy_optional_artifacts "%~dp0src-tauri\target\release\bundle\msi" "%RELEASE_OUTPUT%\windows\msi" "*.msi"
if errorlevel 1 exit /b 1
exit /b 0

:archive_android_debug
call :remove_dir "%RELEASE_OUTPUT%\android\apk\debug"
if errorlevel 1 exit /b 1
call :copy_artifacts "%~dp0src-tauri\gen\android\app\build\outputs\apk" "%RELEASE_OUTPUT%\android\apk\debug" "*.apk"
exit /b %errorlevel%

:archive_android_release_apk
call :remove_dir "%RELEASE_OUTPUT%\android\apk\release"
if errorlevel 1 exit /b 1
call :copy_optional_artifacts "%~dp0src-tauri\gen\android\app\build\outputs\apk\arm64\release" "%RELEASE_OUTPUT%\android\apk\release" "*.apk"
if errorlevel 1 exit /b 1
call :copy_optional_artifacts "%~dp0src-tauri\gen\android\app\build\outputs\apk\arm\release" "%RELEASE_OUTPUT%\android\apk\release" "*.apk"
if errorlevel 1 exit /b 1
call :copy_optional_artifacts "%~dp0src-tauri\gen\android\app\build\outputs\apk\x86\release" "%RELEASE_OUTPUT%\android\apk\release" "*.apk"
if errorlevel 1 exit /b 1
call :copy_optional_artifacts "%~dp0src-tauri\gen\android\app\build\outputs\apk\x86_64\release" "%RELEASE_OUTPUT%\android\apk\release" "*.apk"
if errorlevel 1 exit /b 1
if not exist "%RELEASE_OUTPUT%\android\apk\release\*.apk" (
  echo No Android release APK was found to archive.
  exit /b 1
)
exit /b 0

:archive_android_release_aab
call :remove_dir "%RELEASE_OUTPUT%\android\aab\release"
if errorlevel 1 exit /b 1
call :copy_optional_artifacts "%~dp0src-tauri\gen\android\app\build\outputs\bundle\release" "%RELEASE_OUTPUT%\android\aab\release" "*.aab"
if errorlevel 1 exit /b 1
if not exist "%RELEASE_OUTPUT%\android\aab\release\*.aab" (
  echo No Android release AAB was found to archive.
  exit /b 1
)
exit /b 0

:copy_optional_artifacts
if not exist "%~1" exit /b 0
call :copy_artifacts "%~1" "%~2" "%~3"
exit /b %errorlevel%

:copy_artifacts
if not exist "%~1" (
  echo Artifact source not found: "%~1".
  exit /b 1
)
if not exist "%~2" mkdir "%~2"
robocopy "%~1" "%~2" %~3 /E /COPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS /NP >nul
set "copy_code=%errorlevel%"
if %copy_code% GEQ 8 (
  echo Failed to archive artifacts from "%~1".
  exit /b 1
)
exit /b 0

:remove_dir
if not exist "%~1" exit /b 0
rmdir /s /q "%~1"
if exist "%~1" (
  echo Failed to remove "%~1".
  echo Close programs that may be using this directory and try again.
  exit /b 1
)
exit /b 0

:finish
if not "%~1"=="" goto :finish_no_pause
if "%exit_code%"=="0" (
  echo.
  echo Selected build finished successfully.
) else (
  echo.
  echo Selected build failed with exit code %exit_code%.
)
pause

:finish_no_pause
endlocal & exit /b %exit_code%
