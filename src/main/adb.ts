import { stat, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Apk, Details, OwnerCheck, Target } from '../shared/contracts';
import {
  childPath,
  component,
  endpoint,
  friendlyError,
  packagePattern,
  parseDevices,
  parseFiles,
  parseOwner,
  remotePath,
  shellArg,
} from './parsing';
import { runProcess, type Runner } from './process';

const listScript =
  '[ -d "$1" ] && [ -r "$1" ] && [ -x "$1" ] || { echo "目录不存在或无访问权限" >&2; exit 1; }; ' +
  'cd "$1" || exit 1; printf "ATF1\\000"; for p in ./* ./.[!.]* ./..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; ' +
  'm=$(stat -c "%f %s %Y" "$p") || exit 1; printf "%s\\000%s\\000" "$m" "${p#./}"; done; printf "END\\000"';
const noClobber = '[ ! -e "$1" ] && [ ! -L "$1" ] || { echo "同名文件已存在，请更换文件名" >&2; exit 1; }';

export class AdbService {
  constructor(
    private executable: () => string,
    private runner: Runner = runProcess,
  ) {}
  async run(args: string[], signal?: AbortSignal, timeout = 20000, input?: string) {
    const result = await this.runner(this.executable(), args, { signal, timeout, input });
    if (result.code !== 0) throw new Error(friendlyError(result.stdout + '\n' + result.stderr));
    return result.stdout;
  }
  async devices(signal?: AbortSignal) {
    return parseDevices(await this.run(['devices', '-l'], signal));
  }
  private target(device: Target) {
    if (!/^[1-9]\d*$/.test(device.transportId))
      throw new Error('设备缺少传输标识，请更新 ADB 并重新选择设备。');
    return ['-t', device.transportId];
  }
  async ensureOnline(device: Target, signal?: AbortSignal) {
    if (
      !(await this.devices(signal)).some(
        (d) => d.serial === device.serial && d.transportId === device.transportId && d.state === 'device',
      )
    )
      throw new Error('设备已断开、重连或尚未授权，请刷新并重新选择设备。');
  }
  shell(device: Target, args: string[], signal?: AbortSignal) {
    return this.run([...this.target(device), 'shell', ...args.map(shellArg)], signal);
  }
  private script(device: Target, script: string, args: string[], signal?: AbortSignal) {
    return this.shell(device, ['sh', '-c', script, 'android-tool', ...args], signal);
  }
  async details(device: Target, signal?: AbortSignal): Promise<Details> {
    await this.ensureOnline(device, signal);
    const properties = await this.shell(device, ['getprop'], signal);
    const values = Object.fromEntries(
      [...properties.matchAll(/^\[([^\]]+)\]: \[(.*)\]\r?$/gm)].map((m) => [m[1], m[2]]),
    );
    const get = (key: string) => values[key] || '—';
    return {
      android: get('ro.build.version.release'),
      api: get('ro.build.version.sdk'),
      manufacturer: get('ro.product.manufacturer'),
      model: get('ro.product.model'),
      architecture: get('ro.product.cpu.abilist'),
      patch: get('ro.build.version.security_patch'),
      serial: get('ro.serialno'),
      owner: parseOwner(await this.shell(device, ['dumpsys', 'device_policy'], signal)),
    };
  }
  async connect(address: string, signal?: AbortSignal) {
    address = endpoint(address);
    const output = await this.run(['connect', address], signal);
    if (!/^(?:already )?connected to /m.test(output)) throw new Error(friendlyError(output));
    if (
      !(await this.devices(signal)).some(
        (d) => d.serial.toLowerCase() === address.toLowerCase() && d.state === 'device',
      )
    )
      throw new Error('连接请求已发出，但设备未就绪；请确认调试授权后刷新。');
  }
  async pair(address: string, code: string, signal?: AbortSignal) {
    address = endpoint(address);
    if (!/^\d{6}$/.test(code.trim())) throw new Error('请输入 6 位配对码。');
    // 配对码经 stdin 提交，不出现在进程参数或偏好设置中。
    const output = await this.run(['pair', address], signal, 40000, code.trim());
    if (!output.includes('Successfully paired to'))
      throw new Error('配对失败，请检查地址、配对码和有效期。\n' + output);
  }
  private async installed(device: Target, pkg: string, signal?: AbortSignal) {
    if (!packagePattern.test(pkg)) throw new Error('APK 包名格式不正确。');
    if (!/^package:/m.test(await this.shell(device, ['pm', 'path', '--user', '0', pkg], signal)))
      throw new Error('应用尚未安装到主用户：' + pkg);
  }
  async install(device: Target, apk: Apk, file: string, allowTest: boolean, signal?: AbortSignal) {
    await this.ensureOnline(device, signal);
    const output = await this.run(
      [...this.target(device), 'install', '-r', ...(allowTest ? ['-t'] : []), '--user', '0', file],
      signal,
      300000,
    );
    if (!/^Success\s*$/m.test(output)) throw new Error(friendlyError(output));
    await this.installed(device, apk.packageName, signal);
    const readback = await this.shell(device, ['dumpsys', 'package', apk.packageName], signal);
    if (!new RegExp('\\bversionCode=' + apk.versionCode + '\\b').test(readback))
      throw new Error('系统报告安装成功，但回读版本不一致，请核对结果。');
  }
  /** 检查主用户、账号和 Receiver；未知系统输出阻断设置，不能当作“无所有者”。 */
  async checkOwner(device: Target, name: string, signal?: AbortSignal): Promise<OwnerCheck> {
    name = component(name);
    await this.ensureOnline(device, signal);
    const policy = await this.shell(device, ['dumpsys', 'device_policy'], signal),
      owner = parseOwner(policy);
    const blocked = (summary: string): OwnerCheck => ({ canSet: false, alreadySet: false, summary });
    if (owner === name)
      return { canSet: false, alreadySet: true, summary: '该组件已经是设备所有者，无需重复设置。' };
    if (owner) return blocked('已配置其他设备所有者：' + owner);
    if (/Profile Owner\s*[:(]/i.test(policy)) return blocked('设备已有工作资料管理者。');
    if (policy.includes('mHasFeature=false')) return blocked('此系统未提供设备管理功能。');
    const pkg = name.split('/')[0];
    await this.installed(device, pkg, signal);
    const receivers = await this.shell(
      device,
      [
        'pm',
        'query-receivers',
        '--components',
        '--user',
        '0',
        '-a',
        'android.app.action.DEVICE_ADMIN_ENABLED',
        '-p',
        pkg,
      ],
      signal,
    );
    if (
      !receivers.split('\n').some((line) => {
        try {
          return component(line) === name;
        } catch {
          return false;
        }
      })
    )
      return blocked('未找到已启用的设备管理组件，请核对 Receiver 声明。');
    const users = [
      ...(await this.shell(device, ['pm', 'list', 'users'], signal)).matchAll(/UserInfo\{(\d+):/g),
    ].map((m) => m[1]);
    if (users.length !== 1 || users[0] !== '0')
      return blocked('仅支持单一主用户（用户 0），请处理其他用户或工作资料。');
    const accounts = [
      ...(await this.shell(device, ['dumpsys', 'account'], signal)).matchAll(/Accounts:\s*(\d+)/g),
    ];
    if (!accounts.length) return blocked('无法确认设备账号状态，请检查系统权限限制。');
    if (accounts.some((m) => m[1] !== '0')) return blocked('设备仍有账号，请在设备设置中处理后重试。');
    return {
      canSet: true,
      alreadySet: false,
      summary: '检查通过：组件已安装、单一主用户、无账号且无其他所有者。',
    };
  }
  async setOwner(device: Target, name: string, signal?: AbortSignal) {
    name = component(name);
    // 执行前重新检查，避免复用界面上的过期检查结果。
    const check = await this.checkOwner(device, name, signal);
    if (check.alreadySet) return;
    if (!check.canSet) throw new Error(check.summary);
    const output = await this.shell(device, ['dpm', 'set-device-owner', '--user', '0', name], signal);
    if (!/^Success:/m.test(output)) throw new Error(friendlyError(output));
    if (parseOwner(await this.shell(device, ['dumpsys', 'device_policy'], signal)) !== name)
      throw new Error('命令已提交，但未确认设备所有者，请刷新核对。');
  }
  async listFiles(device: Target, directory: string, signal?: AbortSignal) {
    directory = remotePath(directory);
    await this.ensureOnline(device, signal);
    return parseFiles(directory, await this.script(device, listScript, [directory], signal));
  }
  async mkdir(device: Target, directory: string, name: string, signal?: AbortSignal) {
    if (/[\x00-\x1f\x7f]/.test(name)) throw new Error('文件夹名称不能包含控制字符。');
    const path = childPath(directory, name);
    await this.ensureOnline(device, signal);
    await this.shell(device, ['mkdir', path], signal);
  }
  /** 先上传随机临时文件，再无覆盖提交；取消时只清理本次临时文件。 */
  async upload(device: Target, local: string, directory: string, signal?: AbortSignal) {
    if (!(await stat(local)).isFile()) throw new Error('请选择普通文件。');
    const destination = childPath(directory, basename(local)),
      temporary = childPath(directory, '.android-tool-upload-' + randomUUID());
    await this.ensureOnline(device, signal);
    await this.script(device, noClobber, [destination], signal);
    try {
      await this.run([...this.target(device), 'push', local, temporary], signal, 1800000);
      await this.script(
        device,
        '[ ! -e "$2" ] && [ ! -L "$2" ] || { echo "同名文件已存在" >&2; exit 1; }; mv -n "$1" "$2" || exit 1; [ ! -e "$1" ] && [ -f "$2" ] && [ ! -L "$2" ]',
        [temporary, destination],
        signal,
      );
    } finally {
      try {
        await this.run([...this.target(device), 'shell', 'rm', '-f', shellArg(temporary)], undefined, 3000);
      } catch {
        /* 断连时保留临时文件，不能掩盖原始错误。 */
      }
    }
  }
  /** 下载到独占临时路径；完整成功后替换本地目标，避免取消损坏已有文件。 */
  async download(device: Target, remote: string, local: string, signal?: AbortSignal) {
    remote = remotePath(remote);
    await this.ensureOnline(device, signal);
    await this.script(
      device,
      '[ -f "$1" ] && [ ! -L "$1" ] || { echo "仅支持下载普通文件" >&2; exit 1; }',
      [remote],
      signal,
    );
    const temporary = join(dirname(local), '.android-tool-download-' + randomUUID());
    try {
      await this.run([...this.target(device), 'pull', remote, temporary], signal, 1800000);
      if (!(await stat(temporary)).isFile()) throw new Error('下载结果不是普通文件，请刷新目录。');
      if (signal?.aborted) throw new Error('下载已取消。');
      await rename(temporary, local);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
