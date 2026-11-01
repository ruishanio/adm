import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdbService } from '../../src/main/adb';
import type { Runner } from '../../src/main/process';
import type { Apk } from '../../src/shared/contracts';
const device = { serial: 'emulator-5570', transportId: '42' },
  admin = 'com.example.app/com.example.app.Admin';
const apk: Apk = {
  id: 'fixture',
  fileName: 'test.apk',
  packageName: 'com.example.app',
  versionName: '1.0',
  versionCode: '42',
  minimumSdk: '23',
  size: 123,
  admins: [admin],
};
function fake() {
  const calls: string[][] = [];
  let owner = '';
  let users = 'UserInfo{0:Owner:13}',
    accounts = 'Accounts: 0',
    transport = '42',
    version = '42';
  const runner: Runner = async (_exe, args) => {
    calls.push(args);
    let stdout = '';
    if (args[0] === 'devices') stdout = `emulator-5570 device model:SDK transport_id:${transport}`;
    else if (args.includes('device_policy'))
      stdout =
        'Device Policy Manager state:\n' + (owner ? ` Device Owner:\n admin=ComponentInfo{${owner}}` : '');
    else if (args.includes('path')) stdout = 'package:/data/app/test/base.apk';
    else if (args.includes('query-receivers')) stdout = admin;
    else if (args.includes('users')) stdout = users;
    else if (args.includes('account')) stdout = accounts;
    else if (args.includes('set-device-owner')) {
      owner = args.at(-1)!;
      stdout = 'Success: Device owner set';
    } else if (args.includes('install')) stdout = 'Success\n';
    else if (args.includes('package')) stdout = 'versionCode=' + version;
    else if (args[0] === 'connect') stdout = 'failed to connect';
    else if (args.includes('getprop'))
      stdout = '[ro.build.version.release]: [10]\n[ro.product.model]: [SDK]\n';
    return { stdout, stderr: '', code: 0 };
  };
  return {
    service: new AdbService(() => '/adb', runner),
    calls,
    runner,
    state: (values: {
      owner?: string;
      users?: string;
      accounts?: string;
      transport?: string;
      version?: string;
    }) => {
      owner = values.owner ?? owner;
      users = values.users ?? users;
      accounts = values.accounts ?? accounts;
      transport = values.transport ?? transport;
      version = values.version ?? version;
    },
  };
}
describe('目标设备与安装', () => {
  it('重连后拒绝旧会话，不安装到新连接', async () => {
    const f = fake();
    f.state({ transport: '99' });
    await expect(f.service.install(device, apk, '/tmp/test.apk', false)).rejects.toThrow('重连');
    expect(f.calls.some((a) => a.includes('install'))).toBe(false);
  });
  it('安装绑定传输并回读版本，支持 testOnly', async () => {
    const f = fake();
    await f.service.install(device, apk, '/tmp/test.apk', true);
    expect(f.calls).toContainEqual(['-t', '42', 'install', '-r', '-t', '--user', '0', '/tmp/test.apk']);
    f.state({ version: '41' });
    await expect(f.service.install(device, apk, '/tmp/test.apk', false)).rejects.toThrow('回读版本不一致');
  });
  it('connect 退出码 0 但失败必须报错', async () => {
    await expect(fake().service.connect('localhost:5555')).rejects.toThrow();
  });
  it('配对码由 stdin 提交', async () => {
    const runner: Runner = async (_exe, args, opts) => {
      expect(args).toEqual(['pair', 'localhost:5555']);
      expect(opts?.input).toBe('123456');
      return { stdout: 'Successfully paired to localhost', stderr: '', code: 0 };
    };
    await new AdbService(() => '/adb', runner).pair('localhost:5555', '123456');
  });
});
describe('设备所有者', () => {
  it('设置重新检查并回读，重复操作幂等', async () => {
    const f = fake();
    expect((await f.service.checkOwner(device, admin)).canSet).toBe(true);
    await f.service.setOwner(device, admin);
    await f.service.setOwner(device, admin);
    expect(f.calls.filter((a) => a.includes('set-device-owner'))).toHaveLength(1);
  });
  it.each([
    { accounts: 'Accounts: 1' },
    { accounts: 'unknown' },
    { users: 'UserInfo{0:Owner:13}\nUserInfo{10:Work:1}' },
    { owner: 'com.other.app/com.other.app.Admin' },
  ])('账号、用户和已有所有者阻断设置 %j', async (state) => {
    const f = fake();
    f.state(state);
    await expect(f.service.setOwner(device, admin)).rejects.toThrow();
    expect(f.calls.some((a) => a.includes('set-device-owner'))).toBe(false);
  });
  it('预检查后状态变化仍会阻断', async () => {
    const f = fake();
    expect((await f.service.checkOwner(device, admin)).canSet).toBe(true);
    f.state({ accounts: 'Accounts: 1' });
    await expect(f.service.setOwner(device, admin)).rejects.toThrow('账号');
  });
});
it('下载失败保留已有文件，成功后原子替换', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'android-tool-transfer-')),
    local = join(dir, 'file.txt');
  try {
    await writeFile(local, 'old');
    const f = fake();
    let fail = true;
    const runner: Runner = async (exe, args, options) => {
      if (args.includes('pull')) {
        await writeFile(args.at(-1)!, 'new');
        if (fail) throw new Error('cancelled');
        return { stdout: '', stderr: '', code: 0 };
      }
      return f.runner(exe, args, options);
    };
    const service = new AdbService(() => '/adb', runner);
    await expect(service.download(device, '/sdcard/file.txt', local)).rejects.toThrow();
    expect(await readFile(local, 'utf8')).toBe('old');
    fail = false;
    await service.download(device, '/sdcard/file.txt', local);
    expect(await readFile(local, 'utf8')).toBe('new');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('上传同名冲突不会 push 或覆盖', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'android-tool-upload-')),
    local = join(dir, 'file.txt');
  await writeFile(local, 'test');
  try {
    const f = fake();
    const runner: Runner = async (exe, args, options) => {
      if (args.includes('sh')) return { stdout: '', stderr: '同名文件已存在', code: 1 };
      return f.runner(exe, args, options);
    };
    await expect(new AdbService(() => '/adb', runner).upload(device, local, '/sdcard')).rejects.toThrow(
      '同名',
    );
    expect(f.calls.some((a) => a.includes('push'))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
