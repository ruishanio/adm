import { expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { api } from '../../src/renderer/lib/api';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }));
it('IPC 只传递序列号与传输会话，适配严格 Rust 参数', async () => {
  await api.details(reactive({ serial: 'one', transportId: '42', model: 'Phone', state: 'device' }));
  expect(invoke).toHaveBeenCalledWith('adm_call', {
    method: 'details',
    args: [{ serial: 'one', transportId: '42' }],
  });
});
it('日志接口剥离展示字段并只传筛选和游标，不向前端开放文件路径', async () => {
  const device = reactive({ serial: 'log-device', transportId: '43', model: '日志设备', state: 'device' });
  await api.startLogcat(device);
  expect(invoke).toHaveBeenLastCalledWith('adm_call', {
    method: 'startLogcat',
    args: [{ serial: 'log-device', transportId: '43' }],
  });
  await api.logcatApps(device);
  expect(invoke).toHaveBeenLastCalledWith('adm_call', {
    method: 'logcatApps',
    args: [{ serial: 'log-device', transportId: '43' }],
  });
  await api.exportLogcat(
    'session',
    reactive({ uid: '2000', level: 'W', keyword: '中文', crashesOnly: false }),
    500,
  );
  expect(invoke).toHaveBeenLastCalledWith('adm_call', {
    method: 'exportLogcat',
    args: ['session', { uid: '2000', level: 'W', keyword: '中文', crashesOnly: false }, 500],
  });
});
it('性能接口绑定传输会话，仅发送包名，不开放任意 shell 参数', async () => {
  await api.startPerformance(reactive({ serial: 'perf-device', transportId: '44', model: 'Phone' }));
  expect(invoke).toHaveBeenLastCalledWith('adm_call', {
    method: 'startPerformance',
    args: [{ serial: 'perf-device', transportId: '44' }],
  });
  await api.samplePerformance('session', 'com.test.app');
  expect(invoke).toHaveBeenLastCalledWith('adm_call', {
    method: 'samplePerformance',
    args: ['session', 'com.test.app'],
  });
  await api.stopPerformance('session');
  expect(invoke).toHaveBeenLastCalledWith('adm_call', { method: 'stopPerformance', args: ['session'] });
});
