<p align="center">
  <img src="../../../src-tauri/icons/icon.png" width="112" height="112" alt="Icono de ADM">
</p>

<h1 align="center">ADM</h1>
<p align="center"><strong>Device manager for Android</strong></p>
<p align="center">Gestiona dispositivos Android, aplicaciones, archivos y registros desde un único espacio de trabajo.</p>

<p align="center">
  <a href="../../../README.md" lang="en">English</a> |
  <a href="README.zh-CN.md" lang="zh-CN">简体中文</a> |
  <a href="README.zh-TW.md" lang="zh-TW">繁體中文</a> |
  <a href="README.ja.md" lang="ja">日本語</a> |
  <a href="README.fr.md" lang="fr">Français</a> |
  <a href="README.de.md" lang="de">Deutsch</a> |
  <strong>Español</strong> |
  <a href="README.ru.md" lang="ru">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/releases/latest">Descargar ADM</a> |
  <a href="#funciones">Funciones</a> |
  <a href="#primeros-pasos">Primeros pasos</a> |
  <a href="../../../CONTRIBUTING.md">Contribuir</a> |
  <a href="https://github.com/ruishanio/adm/issues">Informar de un problema</a>
</p>

<p align="center">
  <a href="https://github.com/ruishanio/adm/actions/workflows/ci.yml"><img src="https://github.com/ruishanio/adm/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI"></a>
  <a href="../../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

ADM es una herramienta de escritorio de código abierto basada en ADB para macOS Apple Silicon y Windows x64. Conecta un teléfono, una tableta o un emulador para gestionar aplicaciones y archivos, controlar la pantalla y consultar el rendimiento y los registros. Los paquetes de distribución incluyen ADB. La interfaz está disponible en inglés, chino simplificado, chino tradicional, japonés, francés, alemán, español y ruso. Elija el idioma en Ajustes → General; se guarda y se aplica al instante.

![Espacio de trabajo de ADM con la lista de dispositivos, su información y seis pestañas de funciones](../../../resources/readme/en/workbench.jpg)

<p align="center"><sub>Las capturas utilizan la interfaz actual en inglés y datos de demostración.</sub></p>

## Funciones

- **Información del dispositivo** — Consulta el sistema, el hardware, el almacenamiento y la batería; comprueba y configura el propietario del dispositivo (Device Owner).
- **Rendimiento** — Gráficas de CPU, memoria y red en tiempo real, además de FPS de renderizado, tasa de fotogramas con retraso y memoria PSS de las aplicaciones.
- **Control del dispositivo** — Duplicación de pantalla en vertical y horizontal, control con ratón y teclado, capturas, grabación, entrada de texto, rotación, reinicio y apagado.
- **Aplicaciones** — Busca por nombre o paquete; consulta iconos, versiones, tamaños de APK y estado de ejecución; instala, abre, fuerza la detención, borra datos y desinstala.
- **Archivos** — Explora directorios, sube archivos o carpetas, descarga archivos, crea carpetas, cambia nombres y elimina elementos.
- **Registros del dispositivo** — Logcat en directo con filtros por aplicación, nivel, palabra clave y fallos; pausa del desplazamiento y exportación de registros.

Admite conexiones USB y de red, cambio entre varios dispositivos y ajuste del ancho de la barra lateral y de las columnas.

<details>
<summary>Más capturas</summary>

**Aplicaciones**

![Aplicaciones: búsqueda, iconos, versiones, tamaños de APK y estado de ejecución](../../../resources/readme/en/apps.jpg)

**Archivos**

![Archivos: navegación por rutas, operaciones y listado](../../../resources/readme/en/files.jpg)

</details>

## Descarga

Abre la **[última versión](https://github.com/ruishanio/adm/releases/latest)** y descarga el paquete para tu sistema desde **Assets**.

| Plataforma | Requisitos                            | Instalador                        |
| ---------- | ------------------------------------- | --------------------------------- |
| macOS      | Apple Silicon, macOS 13.3 o posterior | `ADM-<version>-mac-arm64.dmg`     |
| Windows    | x64, Windows 10 / 11                  | `ADM-<version>-win-x64-setup.exe` |

- **macOS**: abre el DMG y arrastra ADM a Applications.
- **Windows**: ejecuta el instalador. Si falta WebView2, se descargará durante la instalación.
- También hay paquetes ZIP para ambas plataformas. El ZIP de Windows requiere WebView2 instalado; descomprímelo y ejecuta `adm.exe`. Los archivos `Source code` contienen código fuente, no instaladores.

La versión de macOS no está notarizada y la de Windows no tiene firma de código, por lo que el sistema puede mostrar un aviso de seguridad al iniciarla por primera vez. Actualmente se ofrecen paquetes precompilados para las dos plataformas indicadas.

## Primeros pasos

1. Activa la **depuración USB** en las opciones para desarrolladores de Android, conecta el dispositivo con un cable de datos y acepta la solicitud de autorización en el dispositivo.
2. Abre ADM y selecciona el dispositivo conectado en la barra lateral.
3. Entra en la pestaña que necesites. Por ejemplo, selecciona **Apps → Install app** o arrastra un APK a la ventana para iniciar su instalación.

Para conectarte de forma inalámbrica, usa **Connect device** en la esquina inferior izquierda. Android 11 y posteriores admiten la vinculación para depuración inalámbrica. **Las direcciones de vinculación y conexión son diferentes**: después de vincular, utiliza el puerto de conexión. Si la depuración por red ya está activada, introduce directamente `IP:puerto`.

No necesitas instalar Android Studio, Java, FFmpeg ni el cliente de escritorio de scrcpy para ejecutar ADM.

## Preguntas frecuentes

<details>
<summary>¿Por qué no se conecta el dispositivo o la pantalla aparece en negro?</summary>

Primero desbloquea el dispositivo y autoriza la depuración USB. Para conexiones inalámbricas, comprueba la comunicación de red, la dirección y el puerto. La duplicación de pantalla también necesita un codificador H.264 funcional en el dispositivo y compatibilidad con WebCodecs en el WebView del sistema. Algunos emuladores antiguos no pueden codificar vídeo, y las pantallas protegidas contra capturas pueden verse en negro. Vuelve a una pantalla sin protección y prueba **Reconnect**.

</details>

<details>
<summary>¿Qué limitaciones tienen la grabación y el portapapeles?</summary>

La duplicación y la grabación no incluyen audio por ahora. La grabación se detiene y se guarda cuando cambia la orientación o el tamaño de la pantalla, al cambiar de dispositivo o al salir de la pestaña de control. El portapapeles no se sincroniza automáticamente en ambos sentidos. **Enter text** escribe el texto indicado en el portapapeles del dispositivo y lo pega.

</details>

<details>
<summary>¿Cómo se interpretan los datos de aplicaciones, rendimiento y registros?</summary>

- **Running** incluye procesos en segundo plano y en caché; no significa que la aplicación esté en primer plano. **APK size** excluye los datos y la caché de la aplicación.
- La tasa de fotogramas procede de estadísticas HWUI, cuya cobertura depende del método de renderizado de la aplicación. PSS mide el uso de memoria de los procesos.
- **Pause scrolling** no detiene la recepción de registros. La exportación guarda los registros en caché que coinciden con los filtros actuales; la caché tiene un límite de capacidad.

</details>

<details>
<summary>¿Qué límites tienen la instalación, el acceso a archivos y la configuración del propietario del dispositivo?</summary>

La gestión de aplicaciones se aplica al usuario principal (usuario 0). La instalación admite un único APK completo, no AAB, APKS ni la instalación de APK divididos. Las aplicaciones del sistema son de solo lectura. ADM no permite forzar la detención, borrar los datos ni desinstalar la aplicación que sea el propietario actual del dispositivo.

El acceso a archivos está limitado por los permisos de ADB. Configurar un propietario del dispositivo requiere cumplir las condiciones de Android relativas a usuarios, cuentas y componentes de administración. ADM no elimina automáticamente cuentas, perfiles de trabajo o propietarios existentes, ni restablece el dispositivo de fábrica.

</details>

## Contribuir

Comunica errores y sugerencias mediante [Issues](https://github.com/ruishanio/adm/issues). Incluye la versión de ADM, el sistema del ordenador, la versión de Android, el tipo de conexión y los pasos para reproducir el problema. Elimina los datos privados antes de compartir registros o capturas.

ADM utiliza **Tauri 2, Vue 3, TypeScript y Rust**. Consulta la [guía de contribución en inglés](../../../CONTRIBUTING.md) para preparar el entorno de desarrollo, ejecutar comprobaciones y generar paquetes.

## Licencia y agradecimientos

El código propio de ADM se distribuye bajo la [licencia MIT](../../../LICENSE). Los componentes y recursos de terceros conservan sus respectivas licencias.

Gracias a [Tauri](https://tauri.app/), [Vue](https://vuejs.org/), [shadcn-vue](https://www.shadcn-vue.com/), [Tailwind CSS](https://tailwindcss.com/), [Lucide](https://lucide.dev/), [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) y [scrcpy](https://github.com/Genymobile/scrcpy).

El cliente de escritorio para el control del dispositivo está implementado en Rust; en Android se reutiliza el servidor oficial de scrcpy. Su origen y licencia se describen en las [notas del servidor en chino simplificado](../../../src-tauri/resources/scrcpy/README.md). Los paquetes conservan el archivo NOTICE de ADB y la licencia Apache-2.0 del servidor scrcpy.

Android is a trademark of Google LLC.

The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons 3.0 Attribution License](https://creativecommons.org/licenses/by/3.0/). ADM modifica el color del robot y su posición en la base de los dispositivos.
