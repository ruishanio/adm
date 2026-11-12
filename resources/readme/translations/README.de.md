<p align="center">
  <img src="../../../src-tauri/icons/icon.png" width="112" height="112" alt="ADM-App-Symbol">
</p>

<h1 align="center">ADM</h1>
<p align="center"><strong>Device manager for Android</strong></p>
<p align="center">Android-Geräte, Apps, Dateien und Protokolle in einem Desktop-Arbeitsbereich verwalten.</p>

<p align="center">
  <a href="../../../README.md" lang="en">English</a> |
  <a href="README.zh-CN.md" lang="zh-CN">简体中文</a> |
  <a href="README.zh-TW.md" lang="zh-TW">繁體中文</a> |
  <a href="README.ja.md" lang="ja">日本語</a> |
  <a href="README.ko.md" lang="ko">한국어</a> |
  <a href="README.fr.md" lang="fr">Français</a> |
  <strong>Deutsch</strong> |
  <a href="README.es.md" lang="es">Español</a> |
  <a href="README.ru.md" lang="ru">Русский</a>
</p>

<p align="center">
  <a href="https://adm.ruishanio.com">Website</a> |
  <a href="https://github.com/ruishanio/adm/releases/latest">ADM herunterladen</a> |
  <a href="#funktionen">Funktionen</a> |
  <a href="#erste-schritte">Erste Schritte</a> |
  <a href="../../../CONTRIBUTING.md">Mitwirken</a> |
  <a href="https://github.com/ruishanio/adm/issues">Fehler melden</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/actions/workflows/ci.yml"><img src="https://github.com/ruishanio/adm/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI"></a>
  <a href="../../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

ADM ist ein quelloffenes Desktop-Werkzeug auf Basis von ADB für macOS Apple Silicon und Windows x64. Verbinde ein Smartphone, Tablet oder einen Emulator, um Apps und Dateien zu verwalten, den Bildschirm zu steuern sowie Leistung und Protokolle zu prüfen. ADB ist in den veröffentlichten Paketen enthalten. Die Oberfläche unterstützt Englisch, vereinfachtes und traditionelles Chinesisch, Japanisch, Koreanisch, Französisch, Deutsch, Spanisch und Russisch. Unter Einstellungen → Allgemein wird die Sprache sofort übernommen und gespeichert.

![ADM-Arbeitsbereich mit Geräteliste, Geräteinformationen und sechs Funktionsreitern](../../../resources/readme/en/workbench.jpg)

<p align="center"><sub>Die Bildschirmfotos zeigen die aktuelle englische Oberfläche mit Beispieldaten.</sub></p>

## Funktionen

- **Geräteinformationen** — System, Hardware, Speicher und Akku anzeigen sowie den Geräteeigentümer (Device Owner) prüfen und einrichten.
- **Leistung** — Live-Diagramme für CPU, Arbeitsspeicher und Netzwerk sowie Rendering-FPS, Ruckelrate und PSS-Speichernutzung von Apps.
- **Gerätesteuerung** — Bildschirmübertragung im Hoch- und Querformat, Maus- und Tastaturbedienung, Bildschirmfotos, Videoaufzeichnung, Texteingabe, Drehung, Neustart und Ausschalten.
- **Apps** — Nach App- oder Paketname suchen; Symbole, Versionen, APK-Größen und Ausführungsstatus anzeigen; installieren, starten, Beenden erzwingen, Daten löschen und deinstallieren.
- **Dateien** — Verzeichnisse durchsuchen, Dateien oder Ordner hochladen, Dateien herunterladen, Ordner erstellen sowie Einträge umbenennen und löschen.
- **Geräteprotokolle** — Live-Logcat mit Filtern für App, Stufe, Suchbegriff und Absturz; automatisches Scrollen pausieren und Protokolle exportieren.

USB- und Netzwerkverbindungen, Wechsel zwischen mehreren Geräten sowie anpassbare Breiten für Seitenleiste und Tabellenspalten werden unterstützt.

<details>
<summary>Weitere Bildschirmfotos</summary>

**Apps**

![Apps: Suche, Symbole, Versionen, APK-Größen und Ausführungsstatus](../../../resources/readme/en/apps.jpg)

**Dateien**

![Dateien: Pfadnavigation, Dateiaktionen und Verzeichnisliste](../../../resources/readme/en/files.jpg)

</details>

## Download

Öffne die **[aktuelle Veröffentlichung](https://github.com/ruishanio/adm/releases/latest)** und lade unter **Assets** das passende Paket herunter.

| Plattform | Voraussetzungen                      | Installationspaket                |
| --------- | ------------------------------------ | --------------------------------- |
| macOS     | Apple Silicon, macOS 13.3 oder neuer | `ADM-<version>-mac-arm64.dmg`     |
| Windows   | x64, Windows 10 / 11                 | `ADM-<version>-win-x64-setup.exe` |

- **macOS**: Öffne die DMG-Datei und ziehe ADM in den Ordner Applications.
- **Windows**: Führe das Installationsprogramm aus. Falls WebView2 fehlt, wird es heruntergeladen.
- Für beide Plattformen gibt es auch ZIP-Pakete. Das Windows-ZIP setzt installiertes WebView2 voraus. Entpacke es und starte `adm.exe`. Die Archive unter `Source code` enthalten Quellcode, keine Installationspakete.

Die aktuelle offizielle macOS-Version ist mit Developer ID signiert und von Apple notarisiert. Das Windows-Installationsprogramm besitzt noch keine Authenticode-Signatur; beim Ausführen kann Windows daher eine Sicherheitsmeldung anzeigen. Fertige Pakete werden derzeit für die beiden oben genannten Plattformen angeboten.

## Erste Schritte

1. Aktiviere **USB-Debugging** in den Android-Entwickleroptionen, verbinde das Gerät mit einem Datenkabel und bestätige die Autorisierungsanfrage auf dem Gerät.
2. Öffne ADM und wähle das verbundene Gerät in der Seitenleiste aus.
3. Öffne den gewünschten Reiter. Wähle beispielsweise **Apps → Install app**, oder ziehe eine APK-Datei in das Fenster, um die Installation zu beginnen.

Drahtlose Verbindungen richtest du über **Connect device** unten links ein. Android 11 und neuer unterstützen die Kopplung für drahtloses Debugging. **Kopplungs- und Verbindungsadresse sind unterschiedlich**: Verwende nach der Kopplung den Verbindungsport. Ist Netzwerk-Debugging bereits aktiviert, kannst du `IP:Port` direkt eingeben.

Für ADM musst du Android Studio, Java, FFmpeg oder den scrcpy-Desktop-Client nicht zusätzlich installieren.

## Häufige Fragen

<details>
<summary>Wie aktualisiere ich ADM?</summary>

ADM unterstützt ab Version 0.1.8 Updates in der App. Lade die neueste Version über Einstellungen → Über oder den Hinweis in der Seitenleiste herunter und wähle den Zeitpunkt für Installation und Neustart. Bei älteren Versionen installierst du die neueste Version manuell; für die portable Windows-Version lädst du die neue ZIP-Datei herunter.

</details>

<details>
<summary>Warum wird mein Gerät nicht verbunden oder der Bildschirm schwarz angezeigt?</summary>

Entsperre zuerst das Gerät und erlaube USB-Debugging. Prüfe bei drahtlosen Verbindungen die Erreichbarkeit im Netzwerk sowie Adresse und Port. Die Bildschirmübertragung benötigt WebCodecs-Unterstützung in der System-WebView. Fällt der H.264-Systemencoder auf einem x86_64-Gerät mit Android 6.0 oder neuer aus, wechselt ADM automatisch zum Kompatibilitätsencoder. Geschützte Bildschirminhalte können weiterhin schwarz erscheinen. Wechsle zu einem ungeschützten Bildschirm und versuche **Reconnect**.

</details>

<details>
<summary>Welche Einschränkungen gelten für Aufzeichnung und Zwischenablage?</summary>

Bildschirmübertragung und Aufzeichnung enthalten derzeit keinen Ton. Ändern sich Ausrichtung oder Abmessungen des Bildschirms, wechselst du das Gerät oder verlässt du den Steuerungsreiter, wird die laufende Aufzeichnung beendet und gespeichert. Die Zwischenablage wird nicht automatisch in beide Richtungen synchronisiert. **Enter text** schreibt den angegebenen Text in die Zwischenablage des Geräts und fügt ihn ein.

</details>

<details>
<summary>Wie sind App-, Leistungs- und Protokolldaten zu verstehen?</summary>

- **Running** umfasst auch Hintergrundprozesse und zwischengespeicherte Prozesse; die App muss nicht im Vordergrund sein. **APK size** enthält weder App-Daten noch Cache.
- Die Bildratenwerte stammen aus HWUI-Statistiken. Ihr Umfang hängt von der Rendering-Methode der App ab. PSS beschreibt die Speichernutzung von Prozessen.
- Bei **Pause scrolling** werden weiterhin neue Protokolle empfangen. Der Export speichert zwischengespeicherte Einträge, die den aktuellen Filtern entsprechen; der Zwischenspeicher ist begrenzt.

</details>

<details>
<summary>Welche Grenzen gelten für App-Installation, Dateizugriff und Geräteeigentümer?</summary>

Die App-Verwaltung gilt für den Hauptbenutzer (Benutzer 0). Installiert werden kann eine einzelne vollständige APK, nicht jedoch AAB, APKS oder aufgeteilte APKs. System-Apps können nur angezeigt werden. Bei der aktuellen Geräteeigentümer-App kann ADM weder das Beenden erzwingen noch Daten löschen oder die App deinstallieren.

Der Dateizugriff wird durch ADB-Berechtigungen begrenzt. Für die Einrichtung eines Geräteeigentümers müssen die Android-Voraussetzungen für Benutzer, Konten und Verwaltungskomponenten erfüllt sein. ADM entfernt keine Konten, Arbeitsprofile oder vorhandenen Eigentümer automatisch und setzt das Gerät nicht auf Werkseinstellungen zurück.

</details>

## Mitwirken

Melde Fehler und Verbesserungsvorschläge über [Issues](https://github.com/ruishanio/adm/issues). Gib ADM-Version, Computerbetriebssystem, Android-Version, Verbindungsart und Schritte zur Reproduktion an. Entferne private Daten, bevor du Protokolle oder Bildschirmfotos teilst.

ADM verwendet **Tauri 2, Vue 3, TypeScript und Rust**. Hinweise zur Entwicklungsumgebung, zu Prüfungen und zum Paketbau findest du im [englischen Beitragsleitfaden](../../../CONTRIBUTING.md).

## Lizenz und Danksagung

Der eigene Code von ADM steht unter der [MIT-Lizenz](../../../LICENSE). Komponenten und Ressourcen Dritter behalten ihre jeweiligen Lizenzen.

Vielen Dank an [Tauri](https://tauri.app/), [Vue](https://vuejs.org/), [shadcn-vue](https://www.shadcn-vue.com/), [Tailwind CSS](https://tailwindcss.com/), [Lucide](https://lucide.dev/), [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) und [scrcpy](https://github.com/Genymobile/scrcpy).

Der Desktop-Client für die Gerätesteuerung ist in Rust implementiert; auf Android kommt der von ADM angepasste scrcpy-Server zum Einsatz. Herkunft und Lizenz sind in den [Serverhinweisen auf vereinfachtem Chinesisch](../../../src-tauri/resources/scrcpy/README.md) dokumentiert. Die Pakete enthalten die NOTICE-Datei von ADB und die Apache-2.0-Lizenz des scrcpy-Servers.

Android is a trademark of Google LLC.

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/). ADM verändert die Farbe des Roboters und seine Position auf der Gerätehalterung.
