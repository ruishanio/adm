import type { Device, DeviceFile } from '../shared/contracts';
export const packagePattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
export function parseDevices(text: string): Device[] {
  return text.split('\n').flatMap((line) => {
    const m = /^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no)(?:\s|$)/.exec(
      line.trim(),
    );
    return m
      ? [
          {
            serial: m[1],
            state: m[2],
            model: /\bmodel:(\S+)/.exec(line)?.[1] ?? '',
            transportId: /\btransport_id:(\d+)/.exec(line)?.[1] ?? '',
          },
        ]
      : [];
  });
}
export function endpoint(value: string): string {
  value = value.trim();
  if (
    !/^(?:\[[0-9a-fA-F:%.]+\]|[a-zA-Z0-9][a-zA-Z0-9.\-]*):[0-9]{1,5}$/.test(value) ||
    Number(value.slice(value.lastIndexOf(':') + 1)) < 1 ||
    Number(value.slice(value.lastIndexOf(':') + 1)) > 65535
  )
    throw new Error('请输入有效地址，例如 192.168.1.100:5555；IPv6 使用 [地址]:端口。');
  return value;
}
export function component(value: string): string {
  const [pkg, receiver, extra] = value.trim().split('/');
  if (
    extra !== undefined ||
    !packagePattern.test(pkg) ||
    !receiver ||
    !/^\.?[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(receiver)
  )
    throw new Error('管理组件格式应为 包名/.Receiver类名。');
  return `${pkg}/${receiver.startsWith('.') ? pkg + receiver : receiver.includes('.') ? receiver : pkg + '.' + receiver}`;
}
// adb shell 会重新拼接参数；必须在远端 shell 层转义空格、单引号和内部类名中的 $。
export const shellArg = (value: string) =>
  /^[A-Za-z0-9_./:=\-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
export function parseOwner(text: string): string | null {
  if (!/Device Policy Manager/i.test(text))
    throw new Error('无法读取设备管理状态，系统输出不受支持或权限不足。');
  const match = /Device Owner:\s*\r?\n\s*admin=ComponentInfo\{([^}]+)\}/i.exec(text);
  if (match) return component(match[1]);
  if (/\bDevice Owner\b/i.test(text))
    throw new Error('检测到设备所有者，但无法识别组件，请核对设备系统版本。');
  return null;
}
export function remotePath(value: string): string {
  if (!value.startsWith('/') || value.includes('\0')) throw new Error('请输入以 / 开头的设备路径。');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
}
export function childPath(directory: string, name: string): string {
  if (!name || name === '.' || name === '..' || /[/\0]/.test(name))
    throw new Error('文件名不能为空，不能包含 / 或父目录引用。');
  return remotePath(directory).replace(/\/$/, '') + '/' + name;
}
export function parseFiles(directory: string, output: string): DeviceFile[] {
  const fields = output.split('\0');
  if (
    fields.length < 3 ||
    fields[0] !== 'ATF1' ||
    fields.at(-2) !== 'END' ||
    fields.at(-1) !== '' ||
    fields.length % 2 !== 1
  )
    throw new Error('目录内容不完整，请缩小目录范围后重试。');
  const files: DeviceFile[] = [];
  for (let i = 1; i < fields.length - 2; i += 2) {
    const m = /^([0-9a-f]+) (\d+) (-?\d+)$/i.exec(fields[i]);
    if (!m) throw new Error('无法识别文件元数据。');
    const size = Number(m[2]),
      modified = Number(m[3]),
      mode = parseInt(m[1], 16) & 0xf000;
    if (
      !Number.isSafeInteger(size) ||
      !Number.isSafeInteger(modified) ||
      modified < -62135596800 ||
      modified > 253402300799
    )
      throw new Error('文件元数据超出范围。');
    files.push({
      name: fields[i + 1],
      path: childPath(directory, fields[i + 1]),
      size,
      modified,
      type: mode === 0x4000 ? 'directory' : mode === 0x8000 ? 'file' : mode === 0xa000 ? 'link' : 'other',
    });
  }
  return files.sort(
    (a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name),
  );
}
export function friendlyError(text: string): string {
  const hints: Record<string, string> = {
    INSTALL_FAILED_UPDATE_INCOMPATIBLE: '应用签名不一致，无法覆盖安装。',
    INSTALL_FAILED_VERSION_DOWNGRADE: '系统拒绝降级，请使用更新版本。',
    INSTALL_FAILED_INSUFFICIENT_STORAGE: '设备空间不足。',
    INSTALL_FAILED_NO_MATCHING_ABIS: 'APK 不支持目标设备的 CPU 架构。',
    INSTALL_FAILED_OLDER_SDK: 'Android 版本低于 APK 要求。',
    INSTALL_FAILED_TEST_ONLY: '请在安装选项中允许测试包。',
    INSTALL_FAILED_USER_RESTRICTED: '设备限制阻止安装，请检查设备提示。',
    unauthorized: '请在设备上确认调试授权。',
    offline: '设备已离线，请检查连接。',
    'already some accounts': '设备仍有账号，无法设置设备所有者。',
    'already several users': '设备存在多个用户。',
    'already set-up': '设备已完成初始化，当前系统不允许设置设备所有者。',
    'Unknown admin': '未找到设备管理组件。',
  };
  const hint = Object.entries(hints).find(([token]) => text.toLowerCase().includes(token.toLowerCase()))?.[1];
  return (hint ? hint + '\n' : 'ADB 操作失败：') + text.trim().slice(-1600);
}
