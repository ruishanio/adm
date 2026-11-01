import { AdbService } from '../src/main/adb';
import { readApk } from '../src/main/apk';
import { findAdb } from '../src/main/settings';
import { runProcess } from '../src/main/process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const [serial, apkPath] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '') || !apkPath)
  throw new Error(
    '用法：npm run smoke:device -- emulator-5570 artifacts/test-fixture/android-tool-fixture.apk',
  );
const adb = new AdbService(() => findAdb('', join(process.cwd(), 'resources')));
// 只允许专用测试模拟器和固定 testOnly 夹具，绝不选择现有业务设备执行写操作。
if (!(await adb.run(['-s', serial, 'emu', 'avd', 'name'])).startsWith('AndroidToolSmoke_'))
  throw new Error('仅允许 AndroidToolSmoke_ 专用模拟器。');
const apk = await readApk(apkPath);
if (apk.info.packageName !== 'com.ruinext.androidtool.fixture' || apk.info.admins.length !== 1)
  throw new Error('仅允许独立测试 APK。');
const device = (await adb.devices()).find((d) => d.serial === serial && d.state === 'device');
if (!device) throw new Error('模拟器尚未就绪。');
if ((await adb.details(device)).owner) throw new Error('专用模拟器已有所有者，拒绝更改。');
// pm path 对未安装的包返回 1，属于预期的“夹具不存在”，不是 ADB 传输失败。
const existing = await runProcess(findAdb('', join(process.cwd(), 'resources')), [
  '-s',
  serial,
  'shell',
  'pm',
  'path',
  apk.info.packageName,
]);
if (existing.stdout.includes('package:')) throw new Error('夹具已存在，请确认上次测试状态后再执行。');
if (existing.stderr.trim()) throw new Error('无法确认夹具安装状态：' + existing.stderr);
const directory = '.android-tool-electron-' + randomUUID(),
  remote = '/sdcard/' + directory;
const local = await mkdtemp(join(tmpdir(), 'android-tool-electron-'));
const endpoint = '127.0.0.1:' + (Number(serial.slice(9)) + 1);
const hadNetwork = (await adb.devices()).some((d) => d.serial === endpoint);
let installed = false,
  remoteCreated = false;
try {
  installed = true;
  await adb.install(device, apk.info, apk.path, true);
  console.log('通过：安装 APK 并回读版本');
  assert.equal((await adb.checkOwner(device, apk.info.admins[0])).canSet, true);
  await adb.setOwner(device, apk.info.admins[0]);
  await adb.setOwner(device, apk.info.admins[0]);
  assert.equal((await adb.details(device)).owner, apk.info.admins[0]);
  console.log('通过：设备所有者预检查、设置、回读、重复设置');
  await adb.connect(endpoint);
  const network = (await adb.devices()).find((d) => d.serial === endpoint)!;
  await adb.install(network, apk.info, apk.path, true);
  console.log('通过：TCP 连接和覆盖安装');
  await adb.mkdir(device, '/sdcard', directory);
  remoteCreated = true;
  const name = "中文 ' $ file.txt",
    source = join(local, name),
    downloaded = join(local, 'downloaded.txt');
  const content = 'Electron + React + TypeScript\n中文文件传输\n';
  await writeFile(source, content);
  await adb.upload(device, source, remote);
  assert.equal((await adb.listFiles(device, remote))[0].name, name);
  await assert.rejects(() => adb.upload(device, source, remote), /同名/);
  await adb.download(device, remote + '/' + name, downloaded);
  assert.equal(await readFile(downloaded, 'utf8'), content);
  console.log('通过：目录创建、特殊文件名、上传同名保护、下载内容比对');
} finally {
  if (remoteCreated) await adb.shell(device, ['rm', '-rf', remote]);
  if (installed) {
    await adb.shell(device, ['dpm', 'remove-active-admin', apk.info.admins[0]]);
    await adb.run(['-s', serial, 'uninstall', apk.info.packageName]);
  }
  if (!hadNetwork) await adb.run(['disconnect', endpoint]);
  await rm(local, { recursive: true, force: true });
  assert.equal((await adb.details(device)).owner, null);
  console.log('通过：测试所有者、安装包、临时文件及临时连接清理');
}
