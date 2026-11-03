<p align="center">
  <img src="../../../src-tauri/icons/icon.png" width="112" height="112" alt="ADM アプリアイコン">
</p>

<h1 align="center">ADM</h1>
<p align="center"><strong>Device manager for Android</strong></p>
<p align="center">Android デバイス、アプリ、ファイル、ログをひとつのデスクトップで管理。</p>

<p align="center">
  <a href="../../../README.md" lang="en">English</a> |
  <a href="README.zh-CN.md" lang="zh-CN">简体中文</a> |
  <a href="README.zh-TW.md" lang="zh-TW">繁體中文</a> |
  <strong>日本語</strong> |
  <a href="README.fr.md" lang="fr">Français</a> |
  <a href="README.de.md" lang="de">Deutsch</a> |
  <a href="README.es.md" lang="es">Español</a> |
  <a href="README.ru.md" lang="ru">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/releases/latest">ADM をダウンロード</a> |
  <a href="#機能">機能</a> |
  <a href="#はじめに">はじめに</a> |
  <a href="../../../CONTRIBUTING.md">開発に参加</a> |
  <a href="https://github.com/ruishanio/adm/issues">不具合の報告</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/actions/workflows/ci.yml"><img src="https://github.com/ruishanio/adm/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI"></a>
  <a href="../../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

ADM は、ADB を利用するオープンソースのデスクトップツールです。macOS Apple Silicon と Windows x64 に対応しています。スマートフォン、タブレット、エミュレーターを接続して、アプリやファイルの管理、画面操作、パフォーマンスとログの確認ができます。配布パッケージには ADB が含まれています。表示言語は英語、簡体字中国語、繁体字中国語、日本語、フランス語、ドイツ語、スペイン語、ロシア語に対応しています。「設定 → 一般」で切り替えると、すぐに反映され保存されます。

![ADM のワークスペース：デバイス一覧、デバイス情報、6 つの機能タブ](../../../resources/readme/en/workbench.jpg)

<p align="center"><sub>スクリーンショットは現在の英語 UI とデモデータを使用しています。</sub></p>

## 機能

- **デバイス情報** — システム、ハードウェア、ストレージ、バッテリーの情報を表示し、デバイスオーナーを確認・設定できます。
- **パフォーマンス** — CPU、メモリ、ネットワークのリアルタイムグラフと、アプリの描画 FPS、ジャンク率、PSS メモリ使用量を表示します。
- **デバイス操作** — 縦画面・横画面のミラーリング、マウスとキーボードによる操作、スクリーンショット、録画、テキスト入力、回転、再起動、電源オフに対応します。
- **アプリ管理** — アプリ名やパッケージ名で検索し、アイコン、バージョン、APK サイズ、実行状態を確認できます。インストール、起動、強制停止、データ消去、アンインストールが可能です。
- **ファイル管理** — ディレクトリの閲覧、ファイルやフォルダーのアップロード、ファイルのダウンロード、フォルダー作成、名前変更、削除に対応します。
- **デバイスログ** — Logcat をリアルタイムで表示し、アプリ、レベル、キーワード、クラッシュで絞り込めます。自動スクロールの一時停止とログのエクスポートも可能です。

USB・ネットワーク接続、複数デバイスの切り替え、サイドバーと表の列幅の調整に対応しています。

<details>
<summary>その他のスクリーンショット</summary>

**アプリ管理**

![アプリ管理：検索、アイコン、バージョン、APK サイズ、実行状態](../../../resources/readme/en/apps.jpg)

**ファイル管理**

![ファイル管理：パスの移動、ファイル操作、一覧表示](../../../resources/readme/en/files.jpg)

</details>

## ダウンロード

**[最新リリース](https://github.com/ruishanio/adm/releases/latest)** の **Assets** から、お使いのシステム用のパッケージをダウンロードしてください。

| プラットフォーム | 動作要件                       | インストーラー                    |
| ---------------- | ------------------------------ | --------------------------------- |
| macOS            | Apple Silicon、macOS 13.3 以降 | `ADM-<version>-mac-arm64.dmg`     |
| Windows          | x64、Windows 10 / 11           | `ADM-<version>-win-x64-setup.exe` |

- **macOS**：DMG を開き、ADM を Applications にドラッグします。
- **Windows**：インストーラーを実行します。WebView2 がない場合は、インストーラーがダウンロードします。
- 両プラットフォーム向けに ZIP も提供しています。Windows の ZIP 版は WebView2 の事前インストールが必要です。展開後に `adm.exe` を実行してください。`Source code` はソースコードであり、インストーラーではありません。

macOS 版は未公証、Windows 版はコード署名なしのため、初回起動時にシステムのセキュリティ警告が表示される場合があります。現在、ビルド済みパッケージは上記の 2 つの環境向けに提供しています。

## はじめに

1. Android の開発者向けオプションで **USB デバッグ**を有効にし、データ転送対応ケーブルで接続して、デバイス上でデバッグを許可します。
2. ADM を開き、左側で接続済みのデバイスを選択します。
3. 必要なタブを開きます。たとえば **Apps → Install app** を選ぶか、APK をウィンドウにドラッグするとインストールを開始できます。

無線接続には左下の **Connect device** を使用します。Android 11 以降ではワイヤレスデバッグのペア設定が可能です。**ペア設定用と接続用のアドレスは異なります**。ペア設定後は接続用ポートで接続してください。ネットワークデバッグが有効なデバイスには `IP:ポート` を直接入力できます。

ADM の実行に Android Studio、Java、FFmpeg、scrcpy のデスクトップクライアントを別途インストールする必要はありません。

## よくある質問

<details>
<summary>デバイスに接続できない、またはミラーリング画面が黒くなる場合は？</summary>

まずデバイスのロックを解除し、USB デバッグを許可してください。無線接続ではネットワークの疎通とアドレス・ポートを確認します。ミラーリングには、デバイス側の正常に動作する H.264 エンコーダーと、システム WebView の WebCodecs 対応が必要です。古いエミュレーターではエンコードできない場合があり、画面キャプチャが保護された画面も黒くなることがあります。通常の画面に戻り、**Reconnect** を試してください。

</details>

<details>
<summary>録画とクリップボードにはどのような制限がありますか？</summary>

現在、ミラーリングと録画に音声は含まれません。画面の向きやサイズが変わった場合、デバイスを切り替えた場合、または操作タブを離れた場合は、録画を終了して保存します。クリップボードは自動で双方向同期されません。**Enter text** を実行したときだけ、指定したテキストをデバイスのクリップボードに書き込み、貼り付けます。

</details>

<details>
<summary>アプリ、パフォーマンス、ログのデータはどう解釈すればよいですか？</summary>

- **Running** にはバックグラウンドやキャッシュ済みプロセスも含まれ、アプリが前面にあることを意味しません。**APK size** にアプリデータやキャッシュは含まれません。
- アプリのフレームレートは HWUI の統計に基づき、取得できる範囲は描画方式によって異なります。PSS はプロセスのメモリ使用量です。
- **Pause scrolling** 中もログの受信は続きます。エクスポートでは現在のフィルターに一致するキャッシュ済みログを保存します。キャッシュには容量制限があります。

</details>

<details>
<summary>アプリのインストール、ファイルアクセス、デバイスオーナーの設定にはどのような制限がありますか？</summary>

アプリ管理の対象はプライマリユーザー（ユーザー 0）です。単一の完全な APK のインストールに対応し、AAB、APKS、分割 APK のインストールには対応していません。システムアプリは閲覧専用です。現在のデバイスオーナーアプリを ADM から強制停止、データ消去、アンインストールすることはできません。

ファイルアクセスは ADB の権限によって制限されます。デバイスオーナーの設定には、Android のユーザー、アカウント、管理コンポーネントに関する条件を満たす必要があります。ADM がアカウント、仕事用プロファイル、既存のオーナーを自動削除したり、初期化したりすることはありません。

</details>

## コントリビューション

不具合や改善案は [Issues](https://github.com/ruishanio/adm/issues) にお寄せください。ADM のバージョン、PC の OS、Android のバージョン、接続方法、再現手順を記載してください。ログやスクリーンショットを共有する前に、個人情報を削除してください。

ADM は **Tauri 2、Vue 3、TypeScript、Rust** を使用しています。開発環境、起動方法、チェック、パッケージ作成については [貢献ガイド（英語）](../../../CONTRIBUTING.md) を参照してください。

## ライセンスと謝辞

ADM 独自のコードは [MIT ライセンス](../../../LICENSE) で公開しています。サードパーティのコンポーネントやリソースには、それぞれのライセンスが適用されます。

[Tauri](https://tauri.app/)、[Vue](https://vuejs.org/)、[shadcn-vue](https://www.shadcn-vue.com/)、[Tailwind CSS](https://tailwindcss.com/)、[Lucide](https://lucide.dev/)、[Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)、[scrcpy](https://github.com/Genymobile/scrcpy) に感謝します。

デバイス操作のデスクトップクライアントは Rust で実装し、Android 側には公式の scrcpy サーバーを使用しています。入手元とライセンスは [サーバーの説明（簡体字中国語）](../../../src-tauri/resources/scrcpy/README.md) を参照してください。配布パッケージには ADB の NOTICE と scrcpy サーバーの Apache-2.0 ライセンスを同梱しています。

Android is a trademark of Google LLC.

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/). ADM ではロボットの色とデバイスドック上の配置を変更しています。
