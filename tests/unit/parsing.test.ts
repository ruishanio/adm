import { describe, expect, it } from 'vitest';
import {
  component,
  endpoint,
  parseDevices,
  parseFiles,
  parseOwner,
  remotePath,
  childPath,
  shellArg,
} from '../../src/main/parsing';
describe('设备与远端参数', () => {
  it('解析多设备且保留连接会话', () => {
    const list = parseDevices(
      'List of devices attached\nemulator-5570 device product:sdk model:Android_SDK transport_id:42\nabc unauthorized transport_id:43\n10.0.0.1:5555 offline transport_id:44\n* daemon started successfully',
    );
    expect(list.map((d) => [d.serial, d.state, d.transportId])).toEqual([
      ['emulator-5570', 'device', '42'],
      ['abc', 'unauthorized', '43'],
      ['10.0.0.1:5555', 'offline', '44'],
    ]);
  });
  it.each(['x:0', 'x:65536', 'localabstract:adb', 'host;touch:5555', '-x:5555', 'host:abc'])(
    '拒绝无效地址 %s',
    (value) => expect(() => endpoint(value)).toThrow(),
  );
  it('保留 IPv6 与合法主机名', () => {
    expect(endpoint(' [::1]:5555 ')).toBe('[::1]:5555');
    expect(endpoint('android.local:37123')).toBe('android.local:37123');
  });
  it('展开 Receiver 且拒绝 shell 注入', () => {
    expect(component('com.example.app/.Admin$Nested')).toBe('com.example.app/com.example.app.Admin$Nested');
    expect(component('com.example.app/Admin')).toBe('com.example.app/com.example.app.Admin');
    expect(() => component('com.example.app/.Admin;reboot')).toThrow();
    expect(shellArg("a b'c$d")).toBe("'a b'\\''c$d'");
  });
  it('设备所有者未知输出不能误判为空', () => {
    expect(parseOwner('Device Policy Manager state:')).toBeNull();
    expect(
      parseOwner(
        'Device Policy Manager state:\n Device Owner:\n admin=ComponentInfo{com.example.app/.Admin}',
      ),
    ).toBe('com.example.app/com.example.app.Admin');
    expect(() => parseOwner('permission denied')).toThrow();
    expect(() => parseOwner('Device Policy Manager\n Device Owner: unknown')).toThrow();
  });
});
describe('目录协议', () => {
  it('保留复杂文件名并按目录优先排序', () => {
    const files = parseFiles(
      '/sdcard',
      'ATF1\0' + "81a4 12 1730000000\0a 'b\n$.txt\0" + '41ed 4096 1730000001\0目录\0END\0',
    );
    expect(files[0].type).toBe('directory');
    expect(files[1].name).toBe("a 'b\n$.txt");
    expect(files[1].size).toBe(12);
  });
  it.each(['', 'ATF1\0', 'ATF1\0bad\0file\0END\0', 'ATF1\x0081a4 1 0\0../oops\0END\0'])(
    '拒绝截断与无效元数据',
    (output) => expect(() => parseFiles('/sdcard', output)).toThrow(),
  );
  it('归一化绝对路径并拒绝越界名称', () => {
    expect(remotePath('/a/../../b//./c')).toBe('/b/c');
    expect(() => remotePath('relative')).toThrow();
    expect(() => childPath('/a', '../b')).toThrow();
    expect(childPath('/', '.hidden')).toBe('/.hidden');
  });
});
