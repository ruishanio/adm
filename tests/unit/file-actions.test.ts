// @vitest-environment jsdom
import { computed, effectScope, reactive } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { useFileActions } from '@/features/files/actions';
import { filesState } from '@/features/files/state';
import { workspaceState } from '@/shared/composables/workspace';
import { type Api, type DeviceFile } from '@/shared/api/types';
import { targetKey } from '@/shared/utils/device';

const devices = [
  { serial: 'one', transportId: '1', state: 'device', model: 'One' },
  { serial: 'two', transportId: '2', state: 'device', model: 'Two' },
];
const file: DeviceFile = { name: 'old.txt', path: '/sdcard/old.txt', type: 'file', size: 1, modified: 1 };
const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function setup() {
  const state = reactive({ ...workspaceState(), ...filesState(), selected: targetKey(devices[0]) });
  const api = {
    deleteFile: vi.fn(async () => {}),
    renameFile: vi.fn(async () => {}),
    upload: vi.fn(async () => true),
    listFiles: vi.fn(async () => [file]),
  } as unknown as Api;
  const device = computed(() => devices.find((d) => targetKey(d) === state.selected));
  const scope = effectScope();
  scopes.push(scope);
  const actions = scope.run(() =>
    useFileActions(
      {
        state,
        api,
        device,
        online: computed(() => device.value?.state === 'device'),
        run: async <T>(_label: string, work: () => Promise<T>) => work(),
      },
      state,
    ),
  )!;
  return { state, api, ...actions };
}

it('切换设备撤销打开时的文件确认，不能向新设备提交旧文件操作', async () => {
  const w = setup();
  w.fileAction(file, 'file-delete');
  expect(w.pending.value?.target.serial).toBe('one');
  w.state.selected = targetKey(devices[1]);
  await w.submitAction();
  expect(w.state.modal).toBeNull();
  expect(w.pending.value).toBeUndefined();
  expect(w.api.deleteFile).not.toHaveBeenCalled();
});

it('上传后的目录回读迟到，不覆盖切换后的设备列表', async () => {
  const w = setup();
  let finish!: (value: DeviceFile[]) => void;
  vi.mocked(w.api.listFiles).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const uploading = w.upload('files');
  await vi.waitFor(() => expect(w.api.listFiles).toHaveBeenCalled());
  w.state.selected = targetKey(devices[1]);
  const newer = { ...file, name: 'new.txt' };
  w.state.files = [newer];
  finish([file]);
  await uploading;
  expect(w.api.upload).toHaveBeenCalledWith(devices[0], '/sdcard', 'files');
  expect(w.state.files).toEqual([newer]);
});
