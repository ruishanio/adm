import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const platform = process.argv[2];
if (!['mac', 'win'].includes(platform) || process.argv.length !== 3)
  throw new Error('用法：node scripts/package.mjs mac|win（macOS ARM64 / Windows x64）');
if (process.platform !== (platform === 'mac' ? 'darwin' : 'win32'))
  throw new Error('安装包须在对应系统构建；跨平台构建请使用 GitHub Actions。');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 失败，退出码 ${result.status}`);
}
const python = process.platform === 'win32' ? 'python' : 'python3';
run(python, ['scripts/package_ci.py', 'prepare', platform, platform === 'mac' ? 'arm64' : 'x64']);
const target = platform === 'mac' ? 'aarch64-apple-darwin' : 'x86_64-pc-windows-msvc';
// 通过已安装 CLI 的 JS 入口调用，不经 shell，兼容带空格的工程路径和 Windows .cmd。
run(process.execPath, [
  'node_modules/@tauri-apps/cli/tauri.js',
  'build',
  '--target',
  target,
  '--bundles',
  platform === 'mac' ? 'app' : 'nsis',
  '--ci',
  // 更新器直接识别 NSIS 安装包；保留相同主程序，通过便携包独有的标记区分安装方式。
  ...(platform === 'win' ? ['--no-binary-patching'] : []),
]);
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const build = resolve('src-tauri/target', target, 'release');
const destination = resolve('release', platform === 'mac' ? 'mac-arm64' : 'win-unpacked');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
let installer;
if (platform === 'mac') {
  const app = `${metadata.productName}.app`;
  await cp(join(build, 'bundle/macos', app), join(destination, app), {
    recursive: true,
    verbatimSymlinks: true,
  });
  installer = join(
    build,
    'bundle/dmg',
    // 改名后旧包可能仍在构建目录，只选择本次产品名和版本的产物。
    `${metadata.productName}_${metadata.version}_aarch64.dmg`,
  );
  // 直接写入 Finder 布局元数据，避免 Tauri 在 CI 中跳过 DMG 背景与图标排版。
  run(python, ['scripts/package_dmg.py', 'build', join(destination, app), installer]);
  const zip = resolve('release', `${metadata.shortName}-${metadata.version}-mac-arm64.zip`);
  await rm(zip, { force: true });
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', join(destination, app), zip]);
} else {
  await writeFile(join(destination, 'ADM-portable.txt'), 'ADM portable for Windows x64\n');
  await cp(join(build, 'adm.exe'), join(destination, 'adm.exe'));
  await cp('src-tauri/resources/platform-tools', join(destination, 'platform-tools'), { recursive: true });
  await cp('src-tauri/resources/scrcpy', join(destination, 'scrcpy'), { recursive: true });
  await cp('README.md', join(destination, 'README.md'));
  installer = join(build, 'bundle/nsis', `${metadata.productName}_${metadata.version}_x64-setup.exe`);
  run(python, [
    '-c',
    'import shutil; shutil.make_archive("release/ADM-' +
      metadata.version +
      '-win-x64", "zip", "release/win-unpacked")',
  ]);
}
await cp(
  installer,
  resolve(
    'release',
    `${metadata.shortName}-${metadata.version}-${platform}-${platform === 'mac' ? 'arm64.dmg' : 'x64-setup.exe'}`,
  ),
);
run(python, ['scripts/package_ci.py', 'verify', platform, platform === 'mac' ? 'arm64' : 'x64']);
