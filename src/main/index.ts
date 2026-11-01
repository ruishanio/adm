import { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, session } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { AdbService } from './adb';
import { readApk, fileHash, type ApkRecord } from './apk';
import { SettingsStore, findAdb } from './settings';
import type { Device, Result, Snapshot } from '../shared/contracts';
import { APP_NAME } from '../shared/app-info';

let window: BrowserWindow | null = null;
let controller: AbortController | null = null;
let devices: Device[] = [];
let trustedPage = '';
const target = z.object({ serial: z.string().min(1).max(512), transportId: z.string().regex(/^[1-9]\d*$/) });
const serial = z.string().min(1).max(512),
  text = z.string().max(4096);
const schemas = {
  refresh: z.tuple([]),
  details: z.tuple([target]),
  connect: z.tuple([text]),
  pair: z.tuple([text, z.string().regex(/^\d{6}$/)]),
  chooseApk: z.tuple([]),
  inspectApk: z.tuple([text.min(1)]),
  install: z.tuple([target, z.string().uuid(), z.boolean()]),
  checkOwner: z.tuple([target, text]),
  setOwner: z.tuple([target, text, z.literal(true)]),
  listFiles: z.tuple([target, text]),
  upload: z.tuple([target, text]),
  download: z.tuple([target, text]),
  mkdir: z.tuple([target, text, z.string().min(1).max(255)]),
  deviceMenu: z.tuple([z.object({ serial, transportId: z.string().max(32) })]),
  rename: z.tuple([serial, z.string().max(80)]),
  hide: z.tuple([serial]),
  restore: z.tuple([]),
  chooseAdb: z.tuple([]),
  resetAdb: z.tuple([]),
  sidebarWidth: z.tuple([z.number().finite().min(220).max(3000)]),
  cancel: z.tuple([]),
};
type Method = keyof typeof schemas;
async function task<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (controller) throw new Error('另一项操作正在执行，请等待完成。');
  const current = new AbortController();
  controller = current;
  try {
    return await work(current.signal);
  } finally {
    if (controller === current) controller = null;
  }
}
function register<K extends Method>(name: K, handler: (...args: z.infer<(typeof schemas)[K]>) => unknown) {
  ipcMain.handle('tool:' + name, async (event, ...args): Promise<Result<unknown>> => {
    try {
      // 只接受本窗口顶层页面的白名单请求；渲染层不能访问 Node 或传入任意 shell 命令。
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== trustedPage
      )
        throw new Error('请求来源无效。');
      const parsed = schemas[name].parse(args) as z.infer<(typeof schemas)[K]>;
      return { ok: true, value: await handler(...parsed) };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof z.ZodError
            ? '请求参数不正确，请重新选择设备或文件。'
            : error instanceof Error
              ? error.message
              : '操作失败，请重试。',
      };
    }
  });
}

app.setName(APP_NAME);
// 产品改名不更换持久化身份；在单实例锁和 ready 之前固定原目录，保留偏好及会话缓存。
const dataDirectory = join(app.getPath('appData'), 'Android Tool');
mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
app.setPath('sessionData', dataDirectory);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
  });
  app.whenReady().then(() => {
    const store = new SettingsStore(join(app.getPath('userData'), 'settings.json'), [
      join(homedir(), '.local/share/AndroidTool/settings.json'),
      join(app.getPath('appData'), 'AndroidTool/settings.json'),
      join(process.env.LOCALAPPDATA || app.getPath('appData'), 'AndroidTool/settings.json'),
    ]);
    const adb = new AdbService(() => findAdb(store.value.adbPath, process.resourcesPath));
    let apk: ApkRecord | undefined;
    const inspect = async (path: string, signal: AbortSignal) => {
      apk = await readApk(path, signal);
      return apk.info;
    };
    register('refresh', async (): Promise<Snapshot> => {
      let error: string | undefined,
        adbPath = '';
      try {
        adbPath = findAdb(store.value.adbPath, process.resourcesPath);
        if (!controller) devices = await adb.devices();
      } catch (e) {
        error = (e as Error).message;
        devices = [];
      }
      return {
        devices: devices.filter((d) => !store.value.hiddenDevices.includes(d.serial)),
        settings: store.value,
        adbPath,
        platform: process.platform,
        version: app.getVersion(),
        error,
      };
    });
    register('details', (d) => task((s) => adb.details(d, s)));
    register('connect', (address) =>
      task(async (s) => {
        await adb.connect(address, s);
        store.update({
          endpoint: address.trim(),
          hiddenDevices: store.value.hiddenDevices.filter((v) => v !== address.trim()),
        });
      }),
    );
    register('pair', (address, code) => task((s) => adb.pair(address, code, s)));
    register('chooseApk', () =>
      task(async (signal) => {
        const result = await dialog.showOpenDialog(window!, {
          title: '选择 APK',
          properties: ['openFile'],
          filters: [{ name: 'Android 安装包', extensions: ['apk'] }],
        });
        return result.canceled ? null : inspect(result.filePaths[0], signal);
      }),
    );
    register('inspectApk', (path) => task((signal) => inspect(path, signal)));
    register('install', (d, id, allowTest) =>
      task(async (s) => {
        const selected = apk;
        if (!selected || selected.info.id !== id) throw new Error('安装包已变化，请重新选择。');
        if ((await fileHash(selected.path, s)) !== selected.hash)
          throw new Error('APK 文件内容已变化，请重新选择并核对。');
        await adb.install(d, selected.info, selected.path, allowTest, s);
      }),
    );
    register('checkOwner', (d, name) => task((s) => adb.checkOwner(d, name, s)));
    register('setOwner', (d, name) => task((s) => adb.setOwner(d, name, s)));
    register('listFiles', (d, path) => task((s) => adb.listFiles(d, path, s)));
    register('mkdir', (d, path, name) => task((s) => adb.mkdir(d, path, name, s)));
    register('upload', (d, path) =>
      task(async (s) => {
        const result = await dialog.showOpenDialog(window!, {
          title: '上传文件到设备',
          properties: ['openFile'],
        });
        if (result.canceled) return false;
        await adb.upload(d, result.filePaths[0], path, s);
        return true;
      }),
    );
    register('download', (d, path) =>
      task(async (s) => {
        const result = await dialog.showSaveDialog(window!, {
          title: '下载设备文件',
          defaultPath: basename(path),
          properties: ['showOverwriteConfirmation', 'createDirectory'],
        });
        if (result.canceled || !result.filePath) return false;
        await adb.download(d, path, result.filePath, s);
        return true;
      }),
    );
    register(
      'deviceMenu',
      (d) =>
        new Promise((resolve) => {
          Menu.buildFromTemplate([
            { label: '备注名称…', enabled: !controller, click: () => resolve('rename') },
            { label: '复制设备标识', click: () => clipboard.writeText(d.serial) },
            { type: 'separator' },
            { label: '从列表移除', enabled: !controller, click: () => resolve('remove') },
          ]).popup({ window: window!, callback: () => resolve(null) });
        }),
    );
    register('rename', (id, name) => {
      const names: Record<string, string> = Object.assign(Object.create(null), store.value.deviceNames);
      if (name.trim()) names[id] = name.trim();
      else delete names[id];
      store.update({ deviceNames: names });
    });
    register('hide', (id) =>
      store.update({ hiddenDevices: [...new Set([...store.value.hiddenDevices, id])] }),
    );
    register('restore', () => store.update({ hiddenDevices: [] }));
    register('sidebarWidth', (width) => store.update({ sidebarWidth: width }));
    register('chooseAdb', () =>
      task(async (s) => {
        const result = await dialog.showOpenDialog(window!, {
          title: '选择 ADB 可执行文件',
          properties: ['openFile'],
          ...(process.platform === 'win32' ? { filters: [{ name: 'ADB', extensions: ['exe'] }] } : {}),
        });
        if (result.canceled) return false;
        const selected = result.filePaths[0];
        if (basename(selected).toLowerCase() !== (process.platform === 'win32' ? 'adb.exe' : 'adb'))
          throw new Error('请选择官方 platform-tools 中的 adb。');
        if (!(await new AdbService(() => selected).run(['version'], s)).includes('Android Debug Bridge'))
          throw new Error('该程序不是有效的 ADB。');
        store.update({ adbPath: selected });
        return true;
      }),
    );
    register('resetAdb', () => store.update({ adbPath: '' }));
    register('cancel', () => controller?.abort());

    session.defaultSession.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const createWindow = () => {
      window = new BrowserWindow({
        width: 1100,
        height: 740,
        minWidth: 920,
        minHeight: 640,
        title: APP_NAME,
        backgroundColor: '#ffffff',
        show: false,
        titleBarStyle: 'hidden',
        ...(process.platform === 'darwin'
          ? { trafficLightPosition: { x: 16, y: 14 } }
          : // 原生 Windows 按钮融入工作区，渲染层在设备摘要右侧避让，保留系统贴靠和可访问语义。
            { titleBarOverlay: { color: '#ffffff', symbolColor: '#28313b', height: 40 } }),
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.once('ready-to-show', () => window?.show());
      window.on('closed', () => {
        controller?.abort();
        window = null;
      });
      const dev = !app.isPackaged && process.env.ANDROID_TOOL_DEV_URL === 'http://127.0.0.1:5178';
      trustedPage = dev
        ? process.env.ANDROID_TOOL_DEV_URL! + '/'
        : pathToFileURL(join(__dirname, '../renderer/index.html')).href;
      void window.loadURL(trustedPage);
    };
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu', label: '编辑' },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
    ];
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(template) : null);
    createWindow();
    app.on('activate', () => {
      if (!window) createWindow();
    });
  });
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => controller?.abort());
