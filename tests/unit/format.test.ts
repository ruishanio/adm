import { expect, it } from 'vitest';
import { sizeLabel, deviceBytes, performanceBytes, rateLabel, percentLabel } from '@/shared/utils/format';
it('二进制边界使用准确单位，零值和缺失值严格区分', () => {
  expect(sizeLabel(0)).toBe('0 B');
  expect(sizeLabel(1023)).toBe('1023 B');
  expect(sizeLabel(1024)).toBe('1.0 KiB');
  expect(sizeLabel(1024 ** 2)).toBe('1.0 MiB');
  expect(sizeLabel(1024 ** 4)).toBe('1.0 TiB');
  for (const value of [undefined, null, NaN, Infinity, -1]) expect(sizeLabel(value)).toBe('—');
  expect(deviceBytes(0)).toBe('0 MiB');
  expect(deviceBytes(1024 ** 3)).toBe('1.0 GiB');
  expect(performanceBytes(1024 ** 3)).toBe('1.00 GiB');
  expect(rateLabel(0)).toBe('0.0 KiB/s');
  expect(rateLabel(null)).toBe('—');
  expect(percentLabel(0)).toBe('0.0%');
  expect(percentLabel(null)).toBe('—');
});
