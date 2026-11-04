// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { parseVideoPacket, h264Codec, createDecoder } from '@/features/control/decoder';
import { computed, ref, reactive } from 'vue';
import ControlPage from '@/features/control/ControlPage.vue';
import { workspaceKey } from '@/shared/composables/workspace';
import { createControl } from '@/features/control/session';
import type { Api, ControlStatus } from '@/shared/api/types';
import { setLanguage } from '@/shared/i18n';
beforeEach(() => setLanguage('zh-CN'));
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((f) => f());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const target = { serial: 'emulator-5554', transportId: '1' };
const status: ControlStatus = {
  running: true,
  width: 540,
  height: 1080,
  recording: false,
  compatibility: false,
  recordingNotice: '',
  error: '',
};
function packet(key = true, config = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f])) {
  const bytes = new Uint8Array(32 + config.length + 6),
    view = new DataView(bytes.buffer);
  view.setBigUint64(0, 5n);
  view.setBigUint64(8, 1234n);
  view.setUint32(16, 540);
  view.setUint32(20, 1080);
  view.setUint32(24, key ? 1 : 0);
  view.setUint32(28, config.length);
  bytes.set(config, 32);
  bytes.set([0, 0, 0, 1, key ? 0x65 : 0x41, 1], 32 + config.length);
  return bytes.buffer;
}
it('解析二进制包的端序、旋转尺寸与 Annex B 配置，拒绝越界包', () => {
  const p = parseVideoPacket(packet());
  expect(p).toMatchObject({ sequence: 5, timestamp: 1234, width: 540, height: 1080, key: true });
  expect(h264Codec(p.config)).toBe('avc1.42c01f');
  expect(() => parseVideoPacket(new ArrayBuffer(16))).toThrow();
  const invalid = packet();
  new DataView(invalid).setUint32(28, 9000);
  expect(() => parseVideoPacket(invalid)).toThrow();
});
it('连接迟到时关闭旧会话，快速切换只把最后的设备交给原生层', async () => {
  vi.stubGlobal('VideoDecoder', class {});
  let finish!: (id: string) => void;
  const api = {
    startControl: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue('latest'),
    stopControl: vi.fn(async () => {}),
    controlStatus: vi.fn(async () => status),
  } as unknown as Api;
  const control = createControl(api, () => undefined);
  cleanup.push(control.dispose);
  control.start(target);
  await flushPromises();
  control.start({ ...target, transportId: '2' });
  control.start({ ...target, transportId: '3' });
  finish('stale');
  await flushPromises();
  expect(api.stopControl).toHaveBeenCalledWith('stale');
  expect(api.startControl).toHaveBeenCalledTimes(2);
  expect(api.startControl).toHaveBeenLastCalledWith(
    { ...target, transportId: '3' },
    1600,
    expect.any(Function),
  );
  control.dispose();
  expect(api.stopControl).toHaveBeenCalledWith('latest');
});
it('设备切换后丢弃截图对话框的迟到结果，不污染新设备提示', async () => {
  vi.stubGlobal('VideoDecoder', class {});
  let finish!: (saved: boolean) => void;
  const api = {
    startControl: vi.fn(async () => 'one'),
    stopControl: vi.fn(async () => {}),
    controlStatus: vi.fn(async () => status),
    controlScreenshot: vi.fn(
      () =>
        new Promise<boolean>((r) => {
          finish = r;
        }),
    ),
  } as unknown as Api;
  const control = createControl(api, () => undefined);
  cleanup.push(control.dispose);
  control.start(target);
  await flushPromises();
  const action = control.action('screenshot');
  control.start(undefined);
  finish(true);
  await action;
  expect(control.state.notice).toBe('');
  expect(control.state.ready).toBe(false);
});
it('解码队列拥堵时等待关键帧，不累积旧画面；释放每一帧', () => {
  const frames: { close: ReturnType<typeof vi.fn> }[] = [],
    decoders: FakeDecoder[] = [];
  class FakeDecoder {
    state = 'unconfigured';
    decodeQueueSize = 0;
    decoded = 0;
    constructor(private options: VideoDecoderInit) {
      decoders.push(this);
    }
    configure() {
      this.state = 'configured';
    }
    close() {
      this.state = 'closed';
    }
    decode() {
      this.decoded++;
      const frame = { displayWidth: 540, displayHeight: 1080, close: vi.fn() };
      frames.push(frame);
      this.options.output(frame as unknown as VideoFrame);
    }
  }
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal('EncodedVideoChunk', class {});
  const context = { drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  const decoder = createDecoder(() => canvas, vi.fn(), vi.fn());
  cleanup.push(decoder.dispose);
  decoder.receive(packet());
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(frames[0]!.close).toHaveBeenCalledOnce();
  decoders[0]!.decodeQueueSize = 4;
  decoder.receive(packet(false, new Uint8Array()));
  expect(decoders[0]!.state).toBe('closed');
  decoder.receive(packet(false, new Uint8Array()));
  expect(decoders).toHaveLength(1);
  decoder.receive(packet());
  expect(decoders).toHaveLength(2);
  expect(context.drawImage).toHaveBeenCalledTimes(2);
});

it('设备自动刷新对象时保留控制连接，transportId 变化才重建', async () => {
  vi.stubGlobal('VideoDecoder', class {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const device = ref({ ...target, state: 'device', model: 'Phone' });
  const api = {
    startControl: vi.fn(async () => 'session'),
    stopControl: vi.fn(async () => {}),
    controlStatus: vi.fn(async () => status),
  } as unknown as Api;
  const page = mount(ControlPage, {
    global: {
      provide: {
        [workspaceKey as symbol]: {
          api,
          device: computed(() => device.value),
          online: computed(() => true),
          title: computed(() => 'Phone'),
          state: reactive({ busy: '' }),
        },
      },
    },
  });
  cleanup.push(() => page.unmount());
  await flushPromises();
  device.value = { ...device.value };
  await flushPromises();
  expect(api.startControl).toHaveBeenCalledTimes(1);
  device.value = { ...device.value, transportId: '9' };
  await flushPromises();
  expect(api.startControl).toHaveBeenCalledTimes(2);
});
it('没有首帧时超时关闭连接，不无限显示加载状态', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('VideoDecoder', class {});
  const api = {
    startControl: vi.fn(async () => 'session'),
    stopControl: vi.fn(async () => {}),
    controlStatus: vi.fn(async () => status),
  } as unknown as Api;
  const control = createControl(api, () => undefined);
  cleanup.push(control.dispose);
  control.start(target);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(10001);
  expect(control.state.loading).toBe(false);
  expect(control.state.error).toContain('未收到可解码画面');
  expect(api.stopControl).toHaveBeenCalledWith('session');
});
it('关闭录像通知后，状态轮询不会反复弹出同一条通知', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('VideoDecoder', class {});
  const api = {
    startControl: vi.fn(async () => 'session'),
    stopControl: vi.fn(async () => {}),
    controlStatus: vi.fn(async () => ({ ...status, recordingNotice: '录像已保存：test.mp4' })),
  } as unknown as Api;
  const control = createControl(api, () => undefined);
  cleanup.push(control.dispose);
  control.start(target);
  await flushPromises();
  expect(control.state.notice).toContain('test.mp4');
  control.state.notice = '';
  await vi.advanceTimersByTimeAsync(1001);
  expect(control.state.notice).toBe('');
});
