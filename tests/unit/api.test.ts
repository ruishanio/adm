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
