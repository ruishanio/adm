# Contributing to ADM

**English** | [简体中文](resources/readme/translations/CONTRIBUTING.zh-CN.md)

[Back to README](README.md)

Read [AGENTS.md](AGENTS.md) before making changes. This guide covers the development environment, project structure, and validation workflow.

The frontend uses **Vue 3, TypeScript, Tailwind CSS 4, and shadcn-vue**, with **Tauri 2** as the desktop framework. The Rust backend handles ADB, device operations, and local resources. The interface uses the system WebView and does not bundle Chromium or a Node.js runtime.

For device control, Rust implements sessions, the protocol, input, and MP4 muxing; the frontend decodes video with WebCodecs. The Android side reuses the official scrcpy server. See the [server notes](src-tauri/resources/scrcpy/README.md) for the pinned version, source, and license.

## Local development

Install Node.js 24, Python 3.10+, rustup, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). The Rust toolchain and components are pinned in [rust-toolchain.toml](rust-toolchain.toml). macOS requires Xcode Command Line Tools; Windows requires MSVC C++ build tools and WebView2.

```sh
git clone https://github.com/ruishanio/adm.git
cd adm
npm ci
```

Prepare ADB resources by running the command for your platform. The script downloads a pinned version from Google's official source and verifies its SHA-256, then also checks the scrcpy server bundled in the repository.

**macOS Apple Silicon**

```sh
python3 scripts/package_ci.py prepare mac arm64
```

**Windows x64**

```sh
python scripts/package_ci.py prepare win x64
```

Start the desktop app:

```sh
npm run dev
```

`npm run dev` launches the full Tauri application. `npm run dev:web` only starts the frontend development server; a regular browser cannot execute ADB operations directly.

## Checks and packaging

```sh
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
python3 -m unittest discover -s tests/release -v
```

Use `python` instead of `python3` on Windows. `npm run build` checks module boundaries and TypeScript types, then builds the frontend. It does not create a desktop installer.

Build packages on their respective operating systems. Installers and application ZIPs are written to `release/`.

| Platform            | Command               |
| ------------------- | --------------------- |
| macOS Apple Silicon | `npm run package:mac` |
| Windows x64         | `npm run package:win` |

The packaging script prepares resources, builds the application, and verifies the distribution files. The macOS DMG window, icon positions, and English installation instructions are configured in [layout.json](resources/dmg/layout.json). DMG build tools are isolated in `artifacts/dmg-tools/` and are not distributed with the app.

[CI](.github/workflows/ci.yml) runs checks and tests on macOS and Windows. [Package](.github/workflows/package.yml) builds both platforms when a version tag is pushed. A release is published only after both platforms pass distribution and installation verification. Public assets contain an installer and ZIP for each platform. Build records and checksums are stored in the `release-records-<tag>` Actions artifact.

## Project structure

| Path                            | Responsibility                                                            |
| ------------------------------- | ------------------------------------------------------------------------- |
| `src/app/`                      | Root layout, dependency injection, and coordination across features       |
| `src/features/`                 | Devices, performance, control, apps, files, logs, and settings            |
| `src/shared/`                   | Shared UI, styles, utilities, and communication contracts                 |
| `src-tauri/src/commands/`       | IPC entry points and parameter validation                                 |
| `src-tauri/src/adb/`            | ADB discovery, execution, and process management                          |
| `src-tauri/src/` domain modules | Device, app, file, log, performance, and control operations               |
| `src-tauri/src/state.rs`        | Session, task, and resource lifecycles                                    |
| `src-tauri/resources/`          | ADB and scrcpy server resources included in packages                      |
| `resources/`                    | Icon source assets, DMG configuration, and README images and translations |
| `scripts/`                      | Development, build, packaging, and release scripts                        |
| `tests/`                        | Frontend and release tests, plus APK fixtures                             |

See [AGENTS.md](AGENTS.md) for module boundaries and project conventions.

## Submitting changes

- Respect feature boundaries. Write new comments for key logic in Simplified Chinese.
- Use Conventional Commits with an English type and a Chinese subject, for example `fix(apps): 修复应用列表刷新`.
- Write PR titles and descriptions in Chinese. Explain the problem, resulting behavior, and validation. For breaking changes, describe the impact and migration steps.
- For UI changes, check the default and minimum window sizes, keyboard interaction, long text, and disabled states. Verify all six tabs as required by [AGENTS.md](AGENTS.md), and distinguish tested platforms from untested ones.

README screenshots should use the actual app components and identify demo data. Do not expose real device identifiers, internal network addresses, or personal files.

The root English README is the source of truth; translations live in `resources/readme/translations/`. Update each language when changing feature documentation, and keep the English and Simplified Chinese contribution guides in sync.
