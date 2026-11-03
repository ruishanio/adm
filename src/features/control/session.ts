import { reactive } from 'vue';
import type { Api, ControlInput, ControlStatus, Target } from '@/shared/api/types';
import { t } from '@/shared/i18n';
import { createDecoder } from './decoder';

/** 页面持有唯一控制会话；迟到的连接和对话框结果只允许清理自身，不能覆盖新设备。 */
export function createControl(api: Api, canvas: () => HTMLCanvasElement | undefined) {
  const state = reactive({
    loading: false,
    ready: false,
    error: '',
    notice: '',
    recording: false,
    width: 0,
    height: 0,
    busy: false,
    elapsed: 0,
  });
  let id = '',
    epoch = 0,
    disposed = false,
    target: Target | undefined,
    maxSize = 1600;
  let timer: ReturnType<typeof setTimeout> | undefined, decoder: ReturnType<typeof createDecoder> | undefined;
  let startChain = Promise.resolve(),
    inputChain = Promise.resolve(),
    recordedAt = 0;
  const inputs: ControlInput[] = [];
  let sending = false,
    lastNotice = '';
  let firstFrameTimer: ReturnType<typeof setTimeout> | undefined;
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const stop = (session: string) => {
    if (session) void api.stopControl(session).catch(() => {});
  };
  function invalidate() {
    epoch++;
    clearTimeout(timer);
    clearTimeout(firstFrameTimer);
    decoder?.dispose();
    decoder = undefined;
    stop(id);
    id = '';
    inputs.length = 0;
    state.loading = false;
    state.ready = false;
    state.recording = false;
    state.width = 0;
    state.height = 0;
  }
  function status(next: ControlStatus) {
    if (next.recording && !state.recording) recordedAt = Date.now();
    state.recording = next.recording;
    state.elapsed = next.recording ? Math.floor((Date.now() - recordedAt) / 1000) : 0;
    if (next.recordingNotice && next.recordingNotice !== lastNotice) {
      lastNotice = next.recordingNotice;
      state.notice = next.recordingNotice;
    }
    if (!next.running) {
      state.loading = false;
      state.ready = false;
      state.error = next.error || t('设备控制连接已结束。');
    }
  }
  async function poll(session: string, version: number) {
    try {
      const next = await api.controlStatus(session);
      if (version !== epoch || disposed) return;
      status(next);
      if (next.running) timer = setTimeout(() => void poll(session, version), 1000);
      else invalidate();
    } catch (error) {
      if (version === epoch && !disposed) {
        state.error = message(error);
        state.ready = false;
      }
    }
  }
  function start(next?: Target, size = maxSize) {
    invalidate();
    target = next ? { ...next } : undefined;
    maxSize = size;
    state.error = '';
    state.notice = '';
    lastNotice = '';
    if (!target || disposed) return;
    if (typeof VideoDecoder === 'undefined') {
      state.error = t('当前系统不支持视频解码，请更新 macOS 或 Windows WebView2 后重试。');
      return;
    }
    state.loading = true;
    const version = epoch,
      selected = target;
    // 序列化连接请求，设备快速切换时旧请求不会晚于新请求创建原生会话。
    startChain = startChain
      .catch(() => {})
      .then(async () => {
        if (version !== epoch || disposed) return;
        let session = '',
          pendingAck = 0;
        decoder = createDecoder(
          canvas,
          (width, height) => {
            if (version !== epoch || disposed) return;
            clearTimeout(firstFrameTimer);
            state.width = width;
            state.height = height;
            state.ready = true;
            state.loading = false;
          },
          (error) => {
            if (version === epoch) {
              invalidate();
              state.error = error;
            }
          },
        );
        try {
          session = await api.startControl(selected, size, (packet) => {
            if (version !== epoch || disposed) return;
            try {
              pendingAck = decoder!.receive(packet);
              if (session) void api.controlAck(session, pendingAck).catch(() => {});
            } catch (error) {
              state.error = message(error);
            }
          });
          if (version !== epoch || disposed) {
            stop(session);
            return;
          }
          id = session;
          if (!state.ready)
            firstFrameTimer = setTimeout(() => {
              if (version === epoch && !state.ready) {
                invalidate();
                state.error = t('未收到可解码画面，请重新连接或降低清晰度。');
              }
            }, 10000);
          if (pendingAck) void api.controlAck(id, pendingAck).catch(() => {});
          void poll(id, version);
        } catch (error) {
          if (version === epoch) {
            state.error = message(error);
            state.loading = false;
          }
        }
      });
  }
  function input(value: ControlInput) {
    if (!id || !state.ready || disposed) return;
    const previous = inputs.at(-1);
    // 合并尚未发送的移动事件，按下/松开顺序仍完整保留，避免拖拽在 IPC 队列中积压。
    if (value.kind === 'touch' && value.action === 2 && previous?.kind === 'touch' && previous.action === 2)
      inputs[inputs.length - 1] = value;
    else inputs.push(value);
    flushInputs();
  }
  function flushInputs() {
    if (sending || !inputs.length || !id || disposed) return;
    sending = true;
    const session = id,
      version = epoch;
    inputChain = inputChain
      .catch(() => {})
      .then(async () => {
        try {
          while (inputs.length && version === epoch) await api.controlInput(session, inputs.shift()!);
        } catch (error) {
          if (version === epoch) state.error = message(error);
        } finally {
          sending = false;
          flushInputs();
        }
      });
  }
  function key(keyCode: number) {
    input({ kind: 'key', action: 0, keyCode, meta: 0 });
    input({ kind: 'key', action: 1, keyCode, meta: 0 });
  }
  async function action(kind: 'screenshot' | 'record' | 'reboot' | 'shutdown') {
    if (!id || state.busy) return;
    const session = id,
      version = epoch;
    state.busy = true;
    state.error = '';
    state.notice = '';
    try {
      if (kind === 'screenshot') {
        const saved = await api.controlScreenshot(session);
        if (saved && version === epoch) state.notice = t('截图已保存');
      } else if (kind === 'record') {
        const result = state.recording
          ? await api.controlStopRecording(session)
          : await api.controlRecord(session);
        if (version === epoch && result)
          status(typeof result === 'boolean' ? await api.controlStatus(session) : result);
      } else {
        await api.controlPower(session, kind, true);
        if (version === epoch) {
          invalidate();
          state.notice = t('电源操作已发送');
        }
      }
    } catch (error) {
      if (version === epoch) state.error = message(error);
    } finally {
      state.busy = false;
    }
  }
  return {
    state,
    start,
    input,
    key,
    action,
    reconnect() {
      start(target);
    },
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
