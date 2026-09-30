# Android 构建探针

状态：`VERIFIED_WITH_CONCERNS`（2026-09-28）。本机 Android 工具链、Tauri Android 初始化和 arm64 Release APK 打包已验证；开发者模式和符号链接阶段已通过。当前 Release APK 未配置发布签名，APK/模拟器功能验收仍待完成。M7 浏览器状态矩阵和视觉回归已完成，但不替代本页的 APK/模拟器步骤。

## 已验证环境

| 工具               | 实际结果                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| JDK                | Java 17.0.16 LTS                                                                                                   |
| Rust               | rustc 1.98.0、cargo 1.98.0，stable `x86_64-pc-windows-msvc`                                                        |
| Node/pnpm          | Node 24.15.0、pnpm 10.14.0                                                                                         |
| Android SDK        | `D:\soft\android-sdk`                                                                                              |
| ADB                | 显式调用 `D:\soft\android-sdk\platform-tools\adb.exe`，Android Debug Bridge 1.0.41，platform-tools 37.0.1-15733141 |
| SDK Platform       | `platforms;android-29` 已安装                                                                                      |
| Build Tools        | `build-tools;35.0.0` 已安装                                                                                        |
| NDK                | `ndk;27.2.12479018` 已安装                                                                                         |
| Tauri Android 工程 | `pnpm tauri android init` 成功，`src-tauri/gen/android` 已生成                                                     |

生成工程核对结果：`applicationId = io.github.lylyuanliang.taskdock`、`minSdk = 29`、`compileSdk = 36`、`targetSdk = 36`。根配置仍声明 Android 最低版本 29。

## 验证命令

在项目根目录执行：

```powershell
java -version
& 'D:\soft\android-sdk\platform-tools\adb.exe' version
& 'D:\soft\android-sdk\cmdline-tools\latest\bin\sdkmanager.bat' --list
pnpm tauri info
pnpm tauri android init
pnpm tauri android build --debug
```

`sdkmanager --list` 已确认 `platform-tools 37.0.1`、`platforms;android-29`、`build-tools;35.0.0` 和 `ndk;27.2.12479018`。`pnpm tauri android init` 成功生成 Android Studio 工程。此前 debug 探针曾在 JNI `.so` 链接阶段被符号链接权限阻塞；本次通过统一脚本执行 arm64 Release 构建已确认该阶段正常。不要把生成的 `.so` 文件提交到仓库。

## 环境准备与构建

本机 SDK 根目录为 `D:\soft\android-sdk`。若新会话未配置环境变量，可设置：

```powershell
$env:ANDROID_HOME = 'D:\soft\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"
```

### 统一打包脚本

项目根目录的 `package-release.bat` 统一提供 Windows 和 Android 构建入口。双击脚本后选择菜单，也可以在项目根目录直接传入参数：

```powershell
.\package-release.bat windows
.\package-release.bat android-release-apk
.\package-release.bat android-release-aab
.\package-release.bat all
```

菜单第 2 项用于测试的 Debug APK；第 3、4 项分别是 Release APK 和 AAB。`all` 参数会同时构建 Windows、四架构 Debug APK、Release APK 和 AAB，方便一次性取得测试与发布产物：

```powershell
.\package-release.bat android-debug-apk
```

双击脚本时选择 `2` 即可构建 Debug APK；选择 `5` 会执行全量构建。

Release APK 默认只构建 `aarch64`（arm64-v8a）并按 ABI 拆分，适合现代 Android 设备测试和分发；Debug APK 会显式构建 `aarch64`、`armv7`、`i686`、`x86_64` 四个 ABI，并按 ABI 生成四个独立的带调试签名 APK，仅用于诊断和设备验收，体积不能用于判断正式包体积。Android AAB 保留全架构，由应用商店按设备 ABI 分发。

每次目标构建开始前，脚本会清理以下构建缓存和产物目录：

- `dist`
- `src-tauri/target`
- `src-tauri/gen/android/app/build`
- `src-tauri/gen/android/app/.cxx`
- `src-tauri/gen/android/build`
- `src-tauri/gen/android/.gradle`

清理 Android 目录前，脚本会先执行 `gradlew.bat --stop`，释放上一次构建残留的 Gradle 文件锁。

脚本不会清理 `node_modules`、pnpm 全局缓存、应用数据或 `src-tauri/gen/android` 工程目录。Windows 安装包输出在 `src-tauri/target/release/bundle/`；Android APK 和 AAB 输出分别在 `src-tauri/gen/android/app/build/outputs/apk/` 与 `src-tauri/gen/android/app/build/outputs/bundle/`。

构建成功后，脚本会把最终产物统一归档到项目根目录的 `release-output/`，便于查找和交付。内部目录仍由 Tauri/Gradle 使用，不建议手动从中挑选文件：

```text
release-output/
├─ windows/
│  ├─ nsis/       # Windows 安装程序
│  └─ msi/        # MSI 安装程序（若构建生成）
└─ android/
   ├─ apk/
   │  ├─ release/ # Release APK，所有已构建 ABI 平铺在此目录
   │  └─ debug/   # 显式 Debug 构建产物，保留必要目录结构
   └─ aab/
      └─ release/ # Android App Bundle
```

每次对应目标构建成功前，脚本只清理该目标在 `release-output/` 下的归档目录；因此执行 `all` 时，Windows、APK 和 AAB 产物会同时保留。`release-output/` 已加入 Git 忽略规则，不会提交到仓库。

当前未配置发布签名，Release APK 文件名带有 `-unsigned`，适合体积和构建验证，但不能直接作为正常安装验证包或正式发布包；功能验证请使用带调试签名的 Debug APK。正式发布前需要配置 Android 签名密钥并执行签名流程。

初始化和 debug 构建：

```powershell
pnpm tauri android init
pnpm tauri android build --debug
```

如果构建在 JNI `.so` 链接阶段提示 `Creation symbolic link is not allowed for this system`，按以下顺序处理：

1. 确认 Windows 设置中的“开发者模式”已打开。
2. 注销当前 Windows 账户或重启电脑，使开发者模式策略对新进程生效。
3. 重新打开 PowerShell，再运行 `package-release.bat android-debug-apk`；必要时使用“以管理员身份运行”的终端复测。
4. 如果仍然失败，在 `secpol.msc` 的“本地策略 > 用户权限分配 > 创建符号链接”中授予当前用户权限，然后注销并重新登录。

“设备门户”和“设备发现”不参与本地 Android 构建，不需要为了这个问题打开。
不要为了绕过错误删除 Android 工程目录或手动复制 JNI `.so` 文件；这些做法会破坏 Tauri 生成工程的一致性。

构建通过后，模拟器和安装命令为：

```powershell
emulator -list-avds
emulator -avd <avd-name>
& 'D:\soft\android-sdk\platform-tools\adb.exe' wait-for-device
& 'D:\soft\android-sdk\platform-tools\adb.exe' install -r src-tauri/gen/android/app/build/outputs/apk/debug/app-debug.apk
```

`<avd-name>` 和 APK 路径需替换为实际值。当前已生成的验证产物为 `src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release-unsigned.apk`；该文件未签名，不能直接作为正式发布包。

## Windows 本机验证 APK

当前开发机已安装 Android SDK 和 ADB，但若 `emulator -list-avds` 没有输出，需要先安装 Emulator 和一个系统镜像。以下命令使用 x86_64 模拟器，适合在 Windows 上验证 Debug 通用包：

```powershell
$androidSdk = 'D:\soft\android-sdk'
$sdkManager = "$androidSdk\cmdline-tools\latest\bin\sdkmanager.bat"
$avdManager = "$androidSdk\cmdline-tools\latest\bin\avdmanager.bat"
$emulator = "$androidSdk\emulator\emulator.exe"
$adb = "$androidSdk\platform-tools\adb.exe"

& $sdkManager --install 'emulator' 'system-images;android-35;google_apis;x86_64'
& $avdManager create avd -n 'taskdock-api35' -k 'system-images;android-35;google_apis;x86_64'
Start-Process $emulator -ArgumentList '-avd', 'taskdock-api35', '-netdelay', 'none', '-netspeed', 'full'
& $adb wait-for-device
```

如果 Emulator 启动失败，确认 BIOS 虚拟化已启用，并在“启用或关闭 Windows 功能”中打开“虚拟机平台”和“Windows 虚拟机监控程序平台”，然后重启 Windows。

当前默认 Release APK 是 `arm64-v8a`，不建议直接拿它安装到 x86_64 模拟器。验证设备时执行显式 Debug 构建，脚本会生成四个按 ABI 拆分且带调试签名的 APK；只安装与设备 ABI 匹配的那个文件：

```powershell
.\package-release.bat android-debug-apk
Get-ChildItem .\release-output\android\apk\debug -Filter '*.apk' -Recurse
& $adb install -r '<上一步找到的 Debug APK 完整路径>'
& $adb shell monkey -p 'io.github.lylyuanliang.taskdock' 1
```

如果要验证当前约 21 MiB 的 arm64 Release APK，需要先配置发布签名；未签名的 `-unsigned` 文件不能直接安装。仅为了在 ARM64 手机上做低体积功能验证，可以构建带调试签名的 arm64 Debug APK：

```powershell
$env:ANDROID_HOME = 'D:\soft\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
pnpm tauri android build --debug --target aarch64 --split-per-abi --apk
$arm64DebugApk = Get-ChildItem '.\src-tauri\gen\android\app\build\outputs\apk\arm64\debug' -Filter '*.apk' | Select-Object -First 1
& $adb devices
& $adb install -r $arm64DebugApk.FullName
& $adb shell monkey -p 'io.github.lylyuanliang.taskdock' 1
```

`adb install -r` 不会清除目标设备已有数据；模拟器数据与 Windows 正式版数据相互隔离。只在确认要重置模拟器时执行 `adb shell pm clear io.github.lylyuanliang.taskdock`。

## M7/M8 验收记录入口

APK 产出后，按以下顺序记录实际结果：

1. `adb install -r` 安装并记录 APK 路径、版本和 SHA-256。
2. 通过应用界面创建、读取、删除任务，结束进程后重启应用复验，再执行 `adb shell pm clear io.github.lylyuanliang.taskdock` 复验清除数据行为。
3. 使用 API 29 模拟器完成 Android Keystore 凭据保存、读取、删除和重启恢复；执行 `adb logcat -c` 后采集相关日志，确认无密码、加密口令和明文密钥。
4. 使用专用测试 WebDAV 账户完成手动同步、认证失败、离线、暂停/恢复和冲突决策；不要把 endpoint、用户名、密码或口令写入报告、截图或仓库。
5. 将命令输出和失败复现条件回填 `docs/known-issues.md`、`docs/handoffs/android-next.md` 和对应 Task 8 报告。

`tests/e2e/mobile_visual_flow.py` 和 `tests/e2e/mobile_flow.py` 的默认模式会自行启动并关闭 loopback Vite。传入 `--base-url` 时，脚本会把该 URL 作为被测地址；调用方必须先启动并负责该外部服务，脚本不会替它关闭。两个脚本均支持显式 `--width` 和 `--height`，截图证据目录已被 Git/Prettier 忽略。

## Windows 前端基线

以下命令已通过，未修改业务逻辑：

```powershell
pnpm lint
pnpm format:check
pnpm build
```
