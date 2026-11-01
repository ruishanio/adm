import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const platform = process.argv[2];
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (!['mac', 'win'].includes(platform)) throw new Error('用法：node scripts/package.mjs mac|win [--x64]');
const source = resolve(
  process.env.ADB_DIR ||
    (platform === 'win'
      ? 'vendor/windows/platform-tools'
      : join(homedir(), 'Library/Android/sdk/platform-tools')),
);
const destination = resolve('resources/platform-tools', platform);
const names =
  platform === 'win'
    ? ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'NOTICE.txt', 'source.properties']
    : ['adb', 'NOTICE.txt', 'source.properties'];
await mkdir(destination, { recursive: true });
for (const name of names) {
  await access(join(source, name));
  await cp(join(source, name), join(destination, name));
}
const bytes = await readFile(join(destination, platform === 'win' ? 'adb.exe' : 'adb'));
if (
  platform === 'win'
    ? bytes.toString('ascii', 0, 2) !== 'MZ'
    : !['cafebabe', 'bebafeca', 'cffaedfe', 'feedfacf'].includes(bytes.subarray(0, 4).toString('hex'))
)
  throw new Error('ADB 与目标平台不匹配。');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
await build({
  targets:
    platform === 'mac'
      ? Platform.MAC.createTarget(['dir', 'zip'], process.argv.includes('--x64') ? Arch.x64 : Arch.arm64)
      : Platform.WINDOWS.createTarget(['dir', 'zip'], Arch.x64),
  config: {
    // 保留原应用标识，让操作系统继续识别为同一应用，仅更新展示名称。
    appId: 'com.ruinext.androidtool',
    productName: metadata.productName,
    directories: { output: 'release' },
    files: ['dist/**/*', 'package.json', '!node_modules/**/*'],
    extraResources: [
      { from: destination, to: 'platform-tools' },
      { from: 'README.md', to: 'README.md' },
    ],
    asar: true,
    npmRebuild: false,
    electronDist: process.env.ELECTRON_DIST || undefined,
    mac: {
      category: 'public.app-category.developer-tools',
      identity: '-',
      hardenedRuntime: true,
      artifactName: metadata.shortName + '-${version}-mac-${arch}.${ext}',
    },
    win: {
      artifactName: metadata.shortName + '-${version}-win-${arch}.${ext}',
      // 本地分发暂不签名，但仍写入 Windows 文件属性中的正式产品名与版本。
      signExecutable: false,
    },
  },
});
