import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../../src/main/settings';
it('迁移旧版 PascalCase 偏好，保留备注及隐藏设备', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'android-tool-settings-'));
  try {
    const legacy = join(dir, 'legacy.json'),
      next = join(dir, 'next.json');
    const original = JSON.stringify({
      AdbPath: '/sdk/adb',
      Endpoint: 'localhost:5555',
      DeviceNames: { serial: '工位一' },
      HiddenDevices: ['old'],
    });
    await writeFile(legacy, original);
    const store = new SettingsStore(next, [legacy]);
    expect(store.value.deviceNames.serial).toBe('工位一');
    expect(store.value.hiddenDevices).toEqual(['old']);
    store.update({ sidebarWidth: 300 });
    expect(new SettingsStore(next).value.sidebarWidth).toBe(300);
    expect(await readFile(legacy, 'utf8')).toBe(original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
