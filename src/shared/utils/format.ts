// 文件/APK 使用自动量级；设备与性能指标保留各自精度，所有单位统一按 1024 计算。
function binarySize(value: number | null | undefined, minimum: number, precision: (unit: number) => number) {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  const unit = Math.max(minimum, Math.min(4, value > 0 ? Math.floor(Math.log(value) / Math.log(1024)) : 0));
  return `${(value / 1024 ** unit).toFixed(precision(unit))} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
export const sizeLabel = (value?: number | null) => binarySize(value, 0, (unit) => (unit === 0 ? 0 : 1));
export const deviceBytes = (value?: number | null) => binarySize(value, 2, (unit) => (unit === 2 ? 0 : 1));
export const performanceBytes = (value?: number | null) =>
  binarySize(value, 2, (unit) => (unit === 2 ? 1 : 2));
export const rateLabel = (value?: number | null) => {
  const text = binarySize(value, 1, () => 1);
  return text === '—' ? text : `${text}/s`;
};
export const percentLabel = (value?: number | null) =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
export const parentPath = (path: string) =>
  path.replace(/\/+$/, '').slice(0, path.replace(/\/+$/, '').lastIndexOf('/')) || '/';
export const displayPath = (path: string) => path.replace(/[\x00-\x1f\x7f]/g, ' ');
