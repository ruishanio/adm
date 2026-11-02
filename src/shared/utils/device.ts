import { t } from '@/shared/i18n/index';
import type { Target, Device, Settings } from '@/shared/api/types';
export const deviceName = (d: Device, settings?: Settings) =>
  (settings && Object.hasOwn(settings.deviceNames, d.serial) ? settings.deviceNames[d.serial] : '') ||
  d.model.replaceAll('_', ' ') ||
  d.serial;
export const connection = (d: Device) =>
  d.serial.startsWith('emulator-') ? t('模拟器') : d.serial.includes(':') ? t('网络') : 'USB';
export const deviceStatus = (d: Device) =>
  ({ device: t('已连接'), unauthorized: t('等待授权'), offline: t('离线'), no: t('无访问权限') })[d.state] ||
  d.state;
export const targetKey = (d: Target) => `${d.serial}@${d.transportId}`;
