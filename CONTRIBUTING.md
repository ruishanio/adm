# Contributing to ADM

**English** | [简体中文](resources/readme/translations/CONTRIBUTING.zh-CN.md)

[Back to README](README.md)

Read [AGENTS.md](AGENTS.md) before making changes. This guide covers the development environment, project structure, and validation workflow.

The frontend uses **Vue 3, TypeScript, Tailwind CSS 4, and shadcn-vue**, with **Tauri 2** as the desktop framework. The Rust backend handles ADB, device operations, and local resources. The interface uses the system WebView and does not bundle Chromium or a Node.js runtime.

For device control, Rust implements sessions, the protocol, input, and MP4 muxing; the frontend decodes video with WebCodecs. The Android side uses an ADM build of the scrcpy server. See the [server notes](src-tauri/resources/scrcpy/README.md) for the pinned version, source, and license.

## Community and feedback

Follow the [code of conduct](CODE_OF_CONDUCT.md). Use the [issue forms](https://github.com/ruishanio/adm/issues/new/choose) for bugs, feature requests, or accessibility barriers; English and Chinese are both welcome. Search existing issues first and remove private data from any logs or screenshots.

Report security vulnerabilities privately using [SECURITY.md](SECURITY.md), not public issues or pull requests. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for accessibility support, known limitations, and feedback guidance.

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

[CI](.github/workflows/ci.yml) runs checks and tests on macOS and Windows. [Package](.github/workflows/package.yml) builds both platforms when a version tag is pushed. A release is published only after both platforms pass distribution and installation verification. Public assets contain an installer and ZIP for each platform, the macOS updater archive, and the stable update feed (`latest.json`). Build records and checksums are stored in the `release-records-<tag>` Actions artifact.

Package also supports **Run workflow** for a build-only validation. Manual runs upload packages to Actions artifacts and never publish a Release, even when a tag is selected.

### Desktop update signing

The updater reads `https://github.com/ruishanio/adm/releases/latest/download/latest.json`. The release job verifies both platform builds before publishing. Each platform signs its final update with the version from `package.json`. macOS uses the notarized app archive. Windows uses the NSIS installer. Portable Windows users are directed to the versioned ZIP.

Configure the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY` with the private key matching the public key in `src-tauri/tauri.conf.json`. Keep a secure backup of this key for future versions. Its contents are used only by the update-signing step. Each platform verifies the signed artifact locally before upload.

### macOS signing and notarization

Configure these repository **Actions Secrets** before running Package:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12`, including the private key and certificate chain |
| `APPLE_CERTIFICATE_PASSWORD` | Password used to export the `.p12` |
| `APPLE_SIGNING_IDENTITY` | Full `Developer ID Application: Organization (TEAMID)` identity |
| `APPLE_ID` | Apple Account email |
| `APPLE_PASSWORD` | Apple **app-specific password**, not the account password |
| `APPLE_TEAM_ID` | Developer team ID matching the certificate |

The macOS job imports credentials into a temporary keychain, signs ADM and bundled native tools with a secure timestamp and hardened runtime, notarizes the application, and staples its ticket before creating the final ZIP and DMG. The DMG is then signed, notarized, and stapled separately. Gatekeeper, ZIP extraction, and DMG mounting are checked before upload. Missing credentials, rejected submissions, and timeouts fail the job; no unsigned fallback is published. The temporary keychain is removed on exit, and signing material is never included in artifacts. Notarization reports are retained in `notarization-<run-id>-<attempt>` artifacts for diagnosis.

Ordinary CI/PR checks and Windows builds do not receive these secrets. Local `npm run package:mac` still uses ad-hoc signing; to run the release signing stage locally, securely provide the six environment variables above and run `python3 scripts/notarize_macos.py`, then `python3 scripts/package_ci.py verify mac arm64` to refresh checksums. Do not put secrets in shell history, tracked files, or logs. See [Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

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
