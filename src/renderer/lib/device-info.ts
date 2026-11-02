import { deviceBytes as bytes } from './format';
import type { Details } from '../../shared/contracts';
import { t, type MessageKey } from '../../shared/i18n';

type Property = { label: string; value: string; wide?: boolean };
const row = (label: MessageKey, value?: string | null, wide = false): Property => ({
  label: t(label),
  value: value || '—',
  wide,
});

// 0 是有效读数；缺失总量或可用量时只呈现已知部分，不推算使用率。
function capacity(total?: number | null, available?: number | null): string {
  if (total == null) return '—';
  return available == null
    ? bytes(total)
    : t('{available} 可用 / {total}', { available: bytes(available), total: bytes(total) });
}
function uptime(seconds?: number | null): string {
  if (seconds == null) return '—';
  return t('{days} 天 {hours} 小时 {minutes} 分钟', {
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
  });
}
function displayValue(physical?: string | number | null, override?: string | number | null): string {
  if (override != null && override !== '') {
    return t('{current}（原始 {physical}）', { current: override, physical: physical || '—' });
  }
  return physical ? String(physical) : '—';
}
const states: Record<number, MessageKey> = { 1: '未知', 2: '充电中', 3: '放电中', 4: '未充电', 5: '已充满' };
const health: Record<number, MessageKey> = {
  1: '未知',
  2: '良好',
  3: '过热',
  4: '失效',
  5: '电压过高',
  6: '故障',
  7: '过冷',
};
const power: Record<string, MessageKey> = {
  AC: '交流电',
  USB: 'USB 供电',
  wireless: '无线供电',
  dock: '底座供电',
};

/** 将一次设备采样组织为可翻译分组；保留原始/覆盖屏幕值，构建指纹单独占满整行。 */
export function deviceInfoGroups(details?: Details) {
  const system = details?.system,
    runtime = system?.runtime,
    battery = runtime?.battery;
  return [
    {
      id: 'device',
      title: t('设备与系统'),
      rows: [
        row('品牌', system?.brand),
        row('制造商', details?.manufacturer),
        row('型号', details?.model),
        row('设备代号', system?.device),
        row('Android 版本', details ? `${details.android || '—'} (API ${details.api || '—'})` : ''),
        row('安全补丁', details?.patch),
        row('设备序列号', details?.serial),
        row('产品名称', system?.product),
      ],
    },
    {
      id: 'hardware',
      title: t('硬件与存储'),
      rows: [
        row('处理器架构', details?.architecture),
        row('芯片 / 硬件', system?.soc || system?.hardware),
        row('CPU 逻辑核心', runtime?.cpuCores != null ? t('{count} 核', { count: runtime.cpuCores }) : ''),
        row('内核版本', runtime?.kernel),
        row('运行内存', capacity(runtime?.memoryTotal, runtime?.memoryAvailable)),
        row('数据分区', capacity(runtime?.storageTotal, runtime?.storageAvailable)),
        row('屏幕分辨率', displayValue(runtime?.physicalSize, runtime?.overrideSize)),
        row(
          '显示密度',
          displayValue(
            runtime?.physicalDensity ? `${runtime.physicalDensity} dpi` : '',
            runtime?.overrideDensity ? `${runtime.overrideDensity} dpi` : '',
          ),
        ),
      ],
    },
    {
      id: 'runtime',
      title: t('运行状态'),
      rows: [
        row(
          '电池电量',
          battery?.present === false
            ? t('无电池')
            : battery?.percent != null
              ? `${Math.round(battery.percent)}%`
              : '',
        ),
        row('充电状态', battery?.status && states[battery.status] ? t(states[battery.status]) : ''),
        row('电池温度', battery?.temperature != null ? `${battery.temperature.toFixed(1)} °C` : ''),
        row('电池健康', battery?.health && health[battery.health] ? t(health[battery.health]) : ''),
        row('电池电压', battery?.voltage != null ? `${battery.voltage.toFixed(2)} V` : ''),
        row('供电来源', battery?.power.map((v) => (power[v] ? t(power[v]) : v)).join('\n')),
        row('运行时长', uptime(runtime?.uptimeSeconds)),
        row('IPv4 地址', runtime?.addresses.join('\n')),
      ],
    },
  ];
}

/** 概览仅摘取已采样的常用状态；精确时长和其他原始字段仍保留在展开明细中。 */
export function overviewMetrics(details?: Details) {
  const runtime = details?.system?.runtime,
    battery = runtime?.battery;
  const seconds = runtime?.uptimeSeconds;
  const duration =
    seconds == null
      ? '—'
      : seconds >= 86400
        ? t('{days} 天 {hours} 小时', {
            days: Math.floor(seconds / 86400),
            hours: Math.floor(seconds / 3600) % 24,
          })
        : t('{hours} 小时 {minutes} 分钟', {
            hours: Math.floor(seconds / 3600),
            minutes: Math.floor(seconds / 60) % 60,
          });
  const available = (value?: number | null) =>
    value == null ? '—' : t('可用 {size}', { size: bytes(value) });
  return [
    {
      id: 'memory',
      label: t('运行内存'),
      value: runtime?.memoryTotal == null ? '—' : bytes(runtime.memoryTotal),
      detail: available(runtime?.memoryAvailable),
    },
    {
      id: 'storage',
      label: t('数据分区'),
      value: runtime?.storageTotal == null ? '—' : bytes(runtime.storageTotal),
      detail: available(runtime?.storageAvailable),
    },
    {
      id: 'battery',
      label: t('电池电量'),
      value:
        battery?.present === false
          ? t('无电池')
          : battery?.percent == null
            ? '—'
            : `${Math.round(battery.percent)}%`,
      detail: battery?.status && states[battery.status] ? t(states[battery.status]) : '—',
    },
    { id: 'uptime', label: t('运行时长'), value: duration, detail: t('开机至今') },
  ];
}
export function buildProperties(details?: Details): Property[] {
  const system = details?.system;
  return [
    row('构建标识', system?.buildId),
    row('构建版本', system?.buildNumber),
    row('构建类型', system?.buildType),
    row('硬件平台', system?.hardware),
    row('Bootloader', system?.bootloader),
    row('基带版本', system?.baseband),
    row('验证启动状态', system?.verifiedBoot),
    row('加密状态', system?.encryption),
    row('构建指纹', system?.fingerprint, true),
  ];
}
