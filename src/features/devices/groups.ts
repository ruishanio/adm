import type { Device } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';

export function rowKey(device: Device) {
  // 离线、USB 或无法核实身份的设备都保留独立行，不按型号或备注合并。
  return device.network && device.state === 'device' && device.networkBootId
    ? device.networkBootId
    : targetKey(device);
}

/** 将发现列表按设备分组。成员仍是原始传输，首选可读的 IP 或主机地址展示。 */
export function groupDevices(devices: Device[]) {
  const groups = new Map<string, Device[]>();
  for (const device of devices) {
    const key = rowKey(device);
    const members = groups.get(key);
    if (members) members.push(device);
    else groups.set(key, [device]);
  }
  return [...groups.values()].map((members) => ({
    primary: members.find((d) => d.serial.includes(':')) ?? members[0],
    members,
  }));
}
