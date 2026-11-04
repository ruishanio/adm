<p align="center">
  <img src="src-tauri/icons/icon.png" width="112" height="112" alt="ADM app icon">
</p>

<h1 align="center">ADM</h1>
<p align="center"><strong>Device manager for Android</strong></p>
<p align="center">Manage Android devices, apps, files, and logs in one desktop workspace.</p>

<p align="center">
  <strong>English</strong> |
  <a href="resources/readme/translations/README.zh-CN.md" lang="zh-CN">简体中文</a> |
  <a href="resources/readme/translations/README.zh-TW.md" lang="zh-TW">繁體中文</a> |
  <a href="resources/readme/translations/README.ja.md" lang="ja">日本語</a> |
  <a href="resources/readme/translations/README.fr.md" lang="fr">Français</a> |
  <a href="resources/readme/translations/README.de.md" lang="de">Deutsch</a> |
  <a href="resources/readme/translations/README.es.md" lang="es">Español</a> |
  <a href="resources/readme/translations/README.ru.md" lang="ru">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/releases/latest">Download ADM</a> |
  <a href="#features">Features</a> |
  <a href="#getting-started">Get started</a> |
  <a href="CONTRIBUTING.md">Contribute</a> |
  <a href="https://github.com/ruishanio/adm/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/actions/workflows/ci.yml"><img src="https://github.com/ruishanio/adm/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

ADM is an open-source desktop tool built around ADB for macOS Apple Silicon and Windows x64. Connect a phone, tablet, or emulator to manage apps and files, control its screen, and inspect performance and logs. ADB is included in release packages. The app interface supports English, Simplified Chinese, Traditional Chinese, Japanese, French, German, Spanish, and Russian. Choose a language in Settings → General; it is saved and takes effect immediately.

![ADM workspace with the device list, device information, and six feature tabs](resources/readme/en/workbench.jpg)

<p align="center"><sub>Screenshots use the current app components with demo data.</sub></p>

## Features

- **Device info** — View system, hardware, storage, and battery details; inspect and configure the device owner.
- **Performance** — Live CPU, memory, and network charts, plus app rendering FPS, jank rate, and PSS memory.
- **Device control** — Screen mirroring in portrait and landscape, mouse and keyboard input, screenshots, recording, text input, rotation, reboot, and shutdown.
- **Apps** — Search by name or package; view icons, versions, APK sizes, and running status; install, launch, force-stop, clear data, and uninstall.
- **Files** — Browse directories, upload files or folders, download files, create folders, rename, and delete.
- **Device logs** — Live Logcat with app, level, keyword, and crash filters; pause scrolling and export logs.

Connect over USB or a network, switch between devices, and resize the sidebar and table columns.

<details>
<summary>More screenshots</summary>

**Apps**

![Apps: search, icons, versions, APK sizes, and running status](resources/readme/en/apps.jpg)

**Files**

![Files: path navigation, file actions, and directory listing](resources/readme/en/files.jpg)

</details>

## Download

Open the **[latest release](https://github.com/ruishanio/adm/releases/latest)** and download the package for your system under **Assets**.

| Platform | Requirements               | Installer                         |
| -------- | -------------------------- | --------------------------------- |
| macOS    | Apple Silicon, macOS 13.3+ | `ADM-<version>-mac-arm64.dmg`     |
| Windows  | x64, Windows 10 / 11       | `ADM-<version>-win-x64-setup.exe` |

- **macOS**: Open the DMG and drag ADM into Applications.
- **Windows**: Run the installer. It downloads WebView2 if the runtime is missing.
- ZIP packages are also available for both platforms. The Windows ZIP requires WebView2 to be installed; extract it and run `adm.exe`. `Source code` archives are not installers.

macOS builds are not notarized, and Windows builds are not code-signed, so your system may show a security prompt on first launch. Prebuilt packages currently target the two platforms listed above.

## Getting started

1. Enable **USB debugging** in Android developer options, connect the device with a data cable, and approve the authorization prompt on the device.
2. Open ADM and select the connected device in the sidebar.
3. Open the tab you need. For example, choose **Apps → Install app**, or drag an APK into the window to start installing it.

For wireless connections, use **Connect device** at the bottom left. Android 11+ supports wireless debugging pairing. **Pairing and connection addresses are different**: after pairing, connect using the connection port. If network debugging is already enabled, enter the device's `IP:port` directly.

You do not need to install Android Studio, Java, FFmpeg, or the scrcpy desktop client to run ADM.

## FAQ

<details>
<summary>Why is my device disconnected, or the mirrored screen black?</summary>

Unlock the device and approve USB debugging first. For wireless connections, check network reachability and the address and port. Mirroring also requires a working H.264 encoder on the device and WebCodecs support in the system WebView. Some older emulators cannot encode video, and protected screens may appear black. Return to an unprotected screen and try **Reconnect**.

</details>

<details>
<summary>What are the recording and clipboard limitations?</summary>

Mirroring and recording currently exclude audio. Recording stops and is saved when the screen orientation or dimensions change, when you switch devices, or when you leave the control tab. The clipboard does not sync automatically in both directions. **Enter text** writes the specified text to the device clipboard and pastes it.

</details>

<details>
<summary>How should I interpret app, performance, and log data?</summary>

- **Running** includes background and cached processes; it does not mean the app is in the foreground. **APK size** excludes app data and cache.
- App frame-rate metrics come from HWUI statistics, whose coverage depends on the app's rendering method. PSS measures process memory usage.
- **Pause scrolling** keeps receiving new logs. Export saves cached logs matching the current filters; the cache has a size limit.

</details>

<details>
<summary>What are the limits on app installation, file access, and device owner configuration?</summary>

App management targets the primary user (user 0). Installation supports a single complete APK, not AAB, APKS, or split APK installation. System apps are read-only. The current device owner app cannot be force-stopped, have its data cleared, or be uninstalled through ADM.

File access is limited by ADB permissions. Configuring a device owner requires Android's user, account, and admin component conditions to be met. ADM does not automatically remove accounts, work profiles, or existing owners, or perform a factory reset.

</details>

## Contributing

Report bugs and suggest improvements through [Issues](https://github.com/ruishanio/adm/issues). Include the ADM version, desktop OS, Android version, connection method, and steps to reproduce. Remove private data before sharing logs or screenshots.

ADM uses **Tauri 2, Vue 3, TypeScript, and Rust**. See the [contributing guide](CONTRIBUTING.md) for development setup, checks, and packaging.

## License and acknowledgments

ADM's own code is licensed under [MIT](LICENSE), with a [Simplified Chinese reference translation](LICENSE.zh-CN.md). Third-party components and resources retain their respective licenses.

Thanks to [Tauri](https://tauri.app/), [Vue](https://vuejs.org/), [shadcn-vue](https://www.shadcn-vue.com/), [Tailwind CSS](https://tailwindcss.com/), [Lucide](https://lucide.dev/), [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools), and [scrcpy](https://github.com/Genymobile/scrcpy).

The desktop device-control client is implemented in Rust; the Android side uses an ADM build of the scrcpy server. See the [server notes](src-tauri/resources/scrcpy/README.md) for its source and license. Release packages retain ADB's NOTICE and the scrcpy server's Apache-2.0 license.

Android is a trademark of Google LLC.

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/). ADM modifies the robot's color and its placement on the device dock.
