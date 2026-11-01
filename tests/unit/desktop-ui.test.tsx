// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeviceInfoPage } from '../../src/renderer/components/DeviceInfoPage';
import { ConnectionDialog } from '../../src/renderer/components/ConnectionDialog';
import { useWorkbench } from '../../src/renderer/hooks/useWorkbench';

vi.mock('../../src/renderer/hooks/useWorkbench', () => ({ useWorkbench: vi.fn() }));
type Workbench = ReturnType<typeof useWorkbench>;
let state: Partial<Workbench>;
beforeEach(() => {
  state = {
    tab: 'info',
    device: { serial: 'test', transportId: '1', state: 'device', model: 'Test' },
    online: true,
    component: '',
    consent: false,
    busy: '',
    details: {
      manufacturer: 'Test',
      model: 'Test',
      android: '10',
      api: '29',
      patch: '',
      architecture: 'arm64',
      serial: 'test',
      owner: null,
    },
    setComponent: vi.fn(),
    setConsent: vi.fn(),
  };
  vi.mocked(useWorkbench).mockImplementation(() => state as Workbench);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

it('安装流程传入管理组件后自动展开，并继续要求检查与明确授权', async () => {
  const view = render(<DeviceInfoPage />);
  expect(screen.queryByRole('textbox', { name: '管理组件' })).toBeNull();
  // 安装包的组件是异步到达的，不能因为初始折叠而丢失后续配置入口。
  state.component = 'com.test/.Admin';
  view.rerender(<DeviceInfoPage />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '管理组件' })).toBeTruthy());
  const action = screen.getByRole('button', { name: '设置设备所有者' }) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  state.ownerCheck = { canSet: true, alreadySet: false, summary: '检查通过' };
  view.rerender(<DeviceInfoPage />);
  expect(action.disabled).toBe(true);
  state.consent = true;
  view.rerender(<DeviceInfoPage />);
  expect(action.disabled).toBe(false);
});

it('连接方式支持方向键导航，关闭弹窗后焦点返回触发按钮', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const view = render(<ConnectionDialog endpoint="" onClose={vi.fn()} connected={vi.fn()} />);
  const network = screen.getByRole('tab', { name: '网络连接' });
  network.focus();
  fireEvent.keyDown(network, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: '无线配对' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('textbox', { name: '配对码' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: '无线配对' }));
  view.unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it('安装后配置未识别出组件时仍展开手动填写入口', () => {
  state.ownerAfter = true;
  render(<DeviceInfoPage />);
  expect(screen.getByRole('textbox', { name: '管理组件' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '设置设备所有者' }) as HTMLButtonElement).disabled).toBe(true);
});
