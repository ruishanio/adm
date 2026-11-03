<p align="center">
  <img src="../../../src-tauri/icons/icon.png" width="112" height="112" alt="Icône de l'application ADM">
</p>

<h1 align="center">ADM</h1>
<p align="center"><strong>Device manager for Android</strong></p>
<p align="center">Gérez vos appareils Android, applications, fichiers et journaux dans un même espace de travail.</p>

<p align="center">
  <a href="../../../README.md" lang="en">English</a> |
  <a href="README.zh-CN.md" lang="zh-CN">简体中文</a> |
  <a href="README.zh-TW.md" lang="zh-TW">繁體中文</a> |
  <a href="README.ja.md" lang="ja">日本語</a> |
  <strong>Français</strong> |
  <a href="README.de.md" lang="de">Deutsch</a> |
  <a href="README.es.md" lang="es">Español</a> |
  <a href="README.ru.md" lang="ru">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/releases/latest">Télécharger ADM</a> |
  <a href="#fonctionnalités">Fonctionnalités</a> |
  <a href="#premiers-pas">Premiers pas</a> |
  <a href="../../../CONTRIBUTING.md">Contribuer</a> |
  <a href="https://github.com/ruishanio/adm/issues">Signaler un problème</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/actions/workflows/ci.yml"><img src="https://github.com/ruishanio/adm/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI"></a>
  <a href="../../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

ADM est un outil de bureau open source basé sur ADB, pour macOS Apple Silicon et Windows x64. Connectez un téléphone, une tablette ou un émulateur pour gérer les applications et les fichiers, contrôler l'écran et consulter les performances et les journaux. ADB est inclus dans les paquets distribués. L'interface de l'application est disponible en anglais et en chinois simplifié.

![Espace de travail ADM : liste des appareils, informations et six onglets de fonctionnalités](../../../resources/readme/en/workbench.jpg)

<p align="center"><sub>Les captures utilisent l'interface actuelle en anglais et des données de démonstration.</sub></p>

## Fonctionnalités

- **Informations sur l'appareil** — Consultez le système, le matériel, le stockage et la batterie ; vérifiez et configurez le propriétaire de l'appareil (Device Owner).
- **Performances** — Graphiques en temps réel du processeur, de la mémoire et du réseau, ainsi que les FPS de rendu, le taux de saccades et la mémoire PSS des applications.
- **Contrôle de l'appareil** — Affichage de l'écran en portrait ou en paysage, contrôle au clavier et à la souris, captures d'écran, enregistrement vidéo, saisie de texte, rotation, redémarrage et extinction.
- **Applications** — Recherchez par nom ou nom de paquet ; consultez les icônes, versions, tailles des APK et états d'exécution ; installez, lancez, forcez l'arrêt, effacez les données ou désinstallez.
- **Fichiers** — Parcourez les dossiers, envoyez des fichiers ou dossiers vers l'appareil, téléchargez des fichiers, créez des dossiers, renommez et supprimez des éléments.
- **Journaux** — Logcat en direct avec des filtres par application, niveau, mot-clé et plantage ; mise en pause du défilement et export des journaux.

Connexion USB ou réseau, basculement entre plusieurs appareils et largeur réglable de la barre latérale et des colonnes.

<details>
<summary>Autres captures d'écran</summary>

**Applications**

![Applications : recherche, icônes, versions, tailles des APK et états d'exécution](../../../resources/readme/en/apps.jpg)

**Fichiers**

![Fichiers : navigation, actions et liste des éléments](../../../resources/readme/en/files.jpg)

</details>

## Téléchargement

Ouvrez la **[dernière version](https://github.com/ruishanio/adm/releases/latest)** et téléchargez le paquet adapté à votre système dans **Assets**.

| Plateforme | Configuration requise                  | Programme d'installation          |
| ---------- | -------------------------------------- | --------------------------------- |
| macOS      | Apple Silicon, macOS 13.3 ou ultérieur | `ADM-<version>-mac-arm64.dmg`     |
| Windows    | x64, Windows 10 / 11                   | `ADM-<version>-win-x64-setup.exe` |

- **macOS** : ouvrez le DMG et faites glisser ADM dans Applications.
- **Windows** : lancez le programme d'installation. Il télécharge WebView2 si nécessaire.
- Des archives ZIP sont également disponibles pour les deux plateformes. La version ZIP pour Windows nécessite WebView2 : décompressez l'archive et lancez `adm.exe`. Les archives `Source code` ne sont pas des programmes d'installation.

La version macOS n'est pas notariée et la version Windows ne possède pas de signature de code. Un avertissement de sécurité peut donc apparaître au premier lancement. Les paquets précompilés ciblent actuellement les deux plateformes indiquées ci-dessus.

## Premiers pas

1. Activez le **débogage USB** dans les options pour les développeurs d'Android, branchez l'appareil avec un câble de données et acceptez la demande d'autorisation sur l'appareil.
2. Ouvrez ADM et sélectionnez l'appareil connecté dans la barre latérale.
3. Choisissez l'onglet souhaité. Par exemple, ouvrez **Apps → Install app**, ou faites glisser un APK dans la fenêtre pour démarrer son installation.

Pour une connexion sans fil, utilisez **Connect device** en bas à gauche. Android 11 et les versions ultérieures prennent en charge l'association pour le débogage sans fil. **Les adresses d'association et de connexion sont différentes** : après l'association, utilisez le port de connexion. Si le débogage réseau est déjà activé, saisissez directement `IP:port`.

Il n'est pas nécessaire d'installer Android Studio, Java, FFmpeg ou le client de bureau scrcpy pour utiliser ADM.

## Questions fréquentes

<details>
<summary>Pourquoi l'appareil ne se connecte-t-il pas, ou pourquoi son écran est-il noir ?</summary>

Déverrouillez d'abord l'appareil et autorisez le débogage USB. En connexion sans fil, vérifiez que les appareils peuvent communiquer sur le réseau, ainsi que l'adresse et le port. L'affichage de l'écran nécessite un encodeur H.264 fonctionnel sur l'appareil et la prise en charge de WebCodecs par la WebView du système. Certains anciens émulateurs ne peuvent pas encoder la vidéo, et les écrans protégés contre la capture peuvent rester noirs. Revenez à un écran non protégé et essayez **Reconnect**.

</details>

<details>
<summary>Quelles sont les limites de l'enregistrement et du presse-papiers ?</summary>

L'affichage et l'enregistrement de l'écran n'incluent pas l'audio pour le moment. L'enregistrement s'arrête et est sauvegardé lorsque l'orientation ou les dimensions de l'écran changent, lorsque vous changez d'appareil ou lorsque vous quittez l'onglet de contrôle. Le presse-papiers ne se synchronise pas automatiquement dans les deux sens. **Enter text** copie le texte indiqué dans le presse-papiers de l'appareil, puis le colle.

</details>

<details>
<summary>Comment interpréter les données des applications, des performances et des journaux ?</summary>

- **Running** inclut les processus en arrière-plan et en cache ; cela ne signifie pas que l'application est au premier plan. **APK size** exclut les données et le cache de l'application.
- La fréquence d'images provient des statistiques HWUI, dont la couverture dépend du mode de rendu de l'application. PSS mesure l'utilisation de la mémoire des processus.
- **Pause scrolling** n'arrête pas la réception des journaux. L'export enregistre les journaux en cache correspondant aux filtres actifs ; la capacité du cache est limitée.

</details>

<details>
<summary>Quelles sont les limites de l'installation, de l'accès aux fichiers et de la configuration du propriétaire de l'appareil ?</summary>

La gestion des applications concerne l'utilisateur principal (utilisateur 0). L'installation accepte un APK complet unique, mais pas les formats AAB, APKS ni l'installation d'APK fractionnés. Les applications système sont consultables uniquement. ADM ne permet pas de forcer l'arrêt, d'effacer les données ou de désinstaller l'application actuellement propriétaire de l'appareil.

L'accès aux fichiers dépend des permissions ADB. La configuration d'un propriétaire de l'appareil doit respecter les conditions d'Android concernant les utilisateurs, les comptes et les composants d'administration. ADM ne supprime pas automatiquement les comptes, profils professionnels ou propriétaires existants, et n'effectue pas de réinitialisation d'usine.

</details>

## Contribuer

Signalez les problèmes et proposez des améliorations dans les [Issues](https://github.com/ruishanio/adm/issues). Indiquez la version d'ADM, le système de l'ordinateur, la version d'Android, le mode de connexion et les étapes de reproduction. Retirez les données privées avant de partager des journaux ou des captures.

ADM utilise **Tauri 2, Vue 3, TypeScript et Rust**. Consultez le [guide de contribution en anglais](../../../CONTRIBUTING.md) pour l'environnement de développement, les vérifications et la création des paquets.

## Licence et remerciements

Le code propre à ADM est distribué sous [licence MIT](../../../LICENSE). Les composants et ressources tiers conservent leurs licences respectives.

Merci à [Tauri](https://tauri.app/), [Vue](https://vuejs.org/), [shadcn-vue](https://www.shadcn-vue.com/), [Tailwind CSS](https://tailwindcss.com/), [Lucide](https://lucide.dev/), [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) et [scrcpy](https://github.com/Genymobile/scrcpy).

Le client de contrôle sur ordinateur est implémenté en Rust ; la partie Android réutilise le serveur officiel scrcpy. Sa provenance et sa licence figurent dans les [notes du serveur en chinois simplifié](../../../src-tauri/resources/scrcpy/README.md). Les paquets distribués conservent le fichier NOTICE d'ADB et la licence Apache-2.0 du serveur scrcpy.

Android is a trademark of Google LLC.

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/). ADM modifie la couleur du robot et sa position sur le socle des appareils.
