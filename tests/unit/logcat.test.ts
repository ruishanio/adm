// @vitest-environment jsdom
import { computed, effectScope, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLogcat, matchesLog } from '../../src/renderer/composables/logcat';
import { workbenchKey } from '../../src/renderer/composables/workbench';
import DeviceLogsPage from '../../src/renderer/components/DeviceLogsPage.vue';
import type { Api, LogBatch, LogEntry } from '../../src/shared/contracts';
import { setLanguage } from '../../src/shared/i18n';
const target = { serial: 'emulator-5570', transportId: '42' };
const entry = (id: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  id,
  time: '2026-11-02 09:44:00.008',
  uid: '10123',
  pid: '555',
  tid: '556',
  level: 'I',
  tag: 'Test',
  message: `日志 ${id}`,
  raw: `中文 Test 日志 ${id}`,
  crash: false,
  ...extra,
});
const batch = (entries: LogEntry[], extra: Partial<LogBatch> = {}): LogBatch => ({
  entries,
  firstId: 1,
  nextId: entries.at(-1)?.id || 0,
  dropped: 0,
  truncated: 0,
  running: true,
  error: null,
  ...extra,
});
const cleanup: (() => void)[] = [];
beforeEach(() => {
  // jsdom 不实现滚动；可检索选择器切换高亮项时会请求滚动定位。
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers();
  setLanguage('zh-CN');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
function setup() {
  const api = {
    startLogcat: vi.fn(async () => 'session'),
    readLogcat: vi.fn(async (_id, after) => batch([], { nextId: after })),
    stopLogcat: vi.fn(async () => {}),
    logcatApps: vi.fn(async () => [{ packageName: 'com.example.notes', label: '笔记', uid: '10123' }]),
    exportLogcat: vi.fn(async () => true),
  } as unknown as Api;
  const scope = effectScope();
  const logs = scope.run(() => createLogcat(api))!;
  cleanup.push(() => {
    logs.dispose();
    scope.stop();
  });
  return { logs, api };
}
it('UID、最低级别、关键词和仅崩溃可以组合，普通错误不伪装崩溃', () => {
  const filter = { uid: '10123', level: 'W', keyword: ' 中文 ', crashesOnly: true };
  expect(matchesLog(entry(1, { level: 'E', crash: true }), filter)).toBe(true);
  expect(matchesLog(entry(1, { level: 'E' }), filter)).toBe(false);
  expect(matchesLog(entry(1, { level: 'F', crash: true, uid: '10124' }), filter)).toBe(false);
  expect(matchesLog(entry(1, { level: 'D', crash: true }), filter)).toBe(false);
});
it('暂停固定可见日志但持续收集，导出包含新日志且携带筛选与游标', async () => {
  const { logs, api } = setup();
  vi.mocked(api.readLogcat).mockResolvedValueOnce(batch([entry(1)]));
  await logs.start(target);
  await flushPromises();
  logs.state.packageName = 'com.example.notes';
  logs.pause();
  vi.mocked(api.readLogcat).mockResolvedValueOnce(batch([entry(2)]));
  await vi.advanceTimersByTimeAsync(250);
  expect(logs.filtered.value.map((e) => e.id)).toEqual([1]);
  expect(logs.entries.value).toHaveLength(2);
  await logs.exportLogs();
  expect(api.exportLogcat).toHaveBeenCalledWith(
    'session',
    { uid: '10123', level: 'V', keyword: '', crashesOnly: false },
    2,
  );
  logs.resume();
  expect(logs.filtered.value.map((e) => e.id)).toEqual([1, 2]);
});
it('切换设备时回收迟到的启动，忽略旧批次，卸载后停止轮询', async () => {
  const { logs, api } = setup();
  let finish!: (id: string) => void;
  vi.mocked(api.startLogcat).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const oldStart = logs.start(target);
  await logs.start({ ...target, transportId: '43' });
  await flushPromises();
  finish('old-session');
  await oldStart;
  expect(api.stopLogcat).toHaveBeenCalledWith('old-session');
  let late!: (b: LogBatch) => void;
  vi.mocked(api.readLogcat).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        late = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(250);
  await logs.start(undefined);
  late(batch([entry(500)]));
  await flushPromises();
  expect(logs.entries.value).toEqual([]);
  logs.dispose();
  const calls = vi.mocked(api.readLogcat).mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.readLogcat).toHaveBeenCalledTimes(calls);
});
it('批次重叠去重并跟随服务器回收旧条目，失败保留缓存用于导出', async () => {
  const { logs, api } = setup();
  vi.mocked(api.readLogcat).mockResolvedValueOnce(batch([entry(1), entry(2)]));
  await logs.start(target);
  await flushPromises();
  vi.mocked(api.readLogcat).mockResolvedValueOnce(
    batch([entry(2), entry(3)], { firstId: 2, dropped: 1, running: false, error: 'device offline' }),
  );
  await vi.advanceTimersByTimeAsync(250);
  expect(logs.entries.value.map((e) => e.id)).toEqual([2, 3]);
  expect(logs.state.running).toBe(false);
  expect(logs.state.error).toBe('device offline');
  await logs.exportLogs();
  expect(api.exportLogcat).toHaveBeenCalled();
});
it('应用列表迟到时不串设备，失效 UID 不放宽到全部应用', async () => {
  const { logs, api } = setup();
  let finish!: (apps: Awaited<ReturnType<Api['logcatApps']>>) => void;
  vi.mocked(api.logcatApps).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await logs.start(target);
  await logs.start({ ...target, transportId: '43' });
  await flushPromises();
  finish([{ packageName: 'old', label: '旧应用', uid: '99' }]);
  await flushPromises();
  expect(logs.apps.value[0].packageName).toBe('com.example.notes');
  logs.state.packageName = 'missing';
  expect(logs.filter.value.uid).toBe('__missing__');
});
it('保存取消不显示成功，导出失败可以重试', async () => {
  const { logs, api } = setup();
  vi.mocked(api.readLogcat).mockResolvedValueOnce(batch([entry(1)]));
  await logs.start(target);
  await flushPromises();
  vi.mocked(api.exportLogcat).mockResolvedValueOnce(false);
  await logs.exportLogs();
  expect(logs.state.exportNotice).toBe('');
  vi.mocked(api.exportLogcat).mockRejectedValueOnce(new Error('磁盘已满'));
  await logs.exportLogs();
  expect(logs.state.exportNotice).toBe('磁盘已满');
  expect(logs.state.exporting).toBe(false);
  await logs.exportLogs();
  expect(logs.state.exportNotice).toBe('日志已导出。');
});
it('日志页只渲染可见行，显示应用名称，崩溃详情保留完整原文', async () => {
  const { api } = setup();
  const records = Array.from({ length: 500 }, (_, i) => entry(i + 1));
  records[0] = entry(1, {
    crash: true,
    level: 'E',
    raw: 'FATAL EXCEPTION: main\n完整堆栈 <script>非 HTML</script>',
  });
  vi.mocked(api.readLogcat).mockResolvedValueOnce(batch(records));
  const w = {
    api,
    state: { selected: 'device' },
    online: computed(() => true),
    device: computed(() => target),
  };
  const view = mount(DeviceLogsPage, {
    attachTo: document.body,
    global: { provide: { [workbenchKey as symbol]: w } },
  });
  cleanup.push(() => view.unmount());
  await flushPromises();
  await nextTick();
  expect(view.findAll('.log-row').length).toBeLessThan(50);
  await view.get('#log-app').trigger('keydown', { key: 'Enter' });
  await vi.advanceTimersByTimeAsync(50);
  await flushPromises();
  expect(document.body.textContent).toContain('笔记');
  document
    .querySelector('[role=listbox]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flushPromises();
  expect(view.findAll('.log-crash')).toHaveLength(1);
  expect(view.get('.log-crash .log-message').text()).toBe(records[0].message);
  expect(view.find('.log-crash svg').exists()).toBe(false);
  await view.get('.log-crash').trigger('click');
  await flushPromises();
  expect(document.querySelector('.log-detail-text')?.textContent).toBe(records[0].raw);
  expect(document.querySelector('.log-detail-text script')).toBeNull();
  await view.get('#log-keyword').setValue('not found');
  expect(view.text()).toContain('没有匹配的日志');
});
