import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import {
  deviceName,
  targetKey,
  type Apk,
  type Details,
  type Device,
  type DeviceFile,
  type OwnerCheck,
  type Snapshot,
} from '../../shared/contracts';
type Tab = 'info' | 'install' | 'files';
type Notice = { text: string; error?: boolean } | null;

export function useWorkbenchState() {
  const api = window.androidTool;
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<Tab>('info');
  const [details, setDetails] = useState<Details>(),
    [apk, setApk] = useState<Apk>(),
    [component, setComponent] = useState('');
  const [ownerCheck, setOwnerCheck] = useState<OwnerCheck>(),
    [consent, setConsent] = useState(false);
  const [allowTest, setAllowTest] = useState(false),
    [ownerAfter, setOwnerAfter] = useState(false),
    [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(''),
    [notice, setNotice] = useState<Notice>(null),
    [query, setQuery] = useState('');
  const [modal, setModal] = useState<'connect' | 'settings' | 'rename' | 'folder' | null>(null),
    [renameDevice, setRenameDevice] = useState<Device>(),
    [name, setName] = useState('');
  const [width, setWidth] = useState(248),
    [viewport, setViewport] = useState(window.innerWidth);
  const [path, setPath] = useState('/sdcard'),
    [pathInput, setPathInput] = useState('/sdcard'),
    [files, setFiles] = useState<DeviceFile[]>([]),
    [file, setFile] = useState<DeviceFile>();
  const activeKey = useRef(selected);
  activeKey.current = selected;
  const busyRef = useRef(false),
    initial = useRef(true),
    refreshPending = useRef(false),
    detailRequest = useRef('');
  const device = snapshot?.devices.find((d) => targetKey(d) === selected),
    online = device?.state === 'device';
  const title = device ? deviceName(device, snapshot?.settings) : '选择一台设备';
  const sidebar = Math.min(width, Math.max(220, viewport - 645));
  // 同一工作台串行执行用户任务，防止连点和切换目标使操作落到另一个设备。
  const run = useCallback(
    async <T>(label: string, work: () => Promise<T>, success?: string): Promise<T | undefined> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(label);
      setNotice(null);
      try {
        const result = await work();
        if (success) setNotice({ text: success });
        return result;
      } catch (error) {
        setNotice({ text: (error as Error).message, error: true });
      } finally {
        busyRef.current = false;
        setBusy('');
      }
    },
    [],
  );
  const refresh = useCallback(async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    try {
      const next = await api.refresh();
      setSnapshot(next);
      if (initial.current) {
        initial.current = false;
        setWidth(next.settings.sidebarWidth);
        const first = next.devices.find((d) => d.state === 'device');
        if (first) setSelected(targetKey(first));
      }
      if (next.error) setNotice({ text: next.error, error: true });
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    } finally {
      refreshPending.current = false;
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!busyRef.current) void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!selected || !online) {
      detailRequest.current = '';
      filesLoaded.current = '';
      setDetails(undefined);
      setOwnerCheck(undefined);
      setConsent(false);
      return;
    }
    if (detailRequest.current === selected) return;
    detailRequest.current = selected;
    // 目录缓存属于传输会话；即使再次选择同一设备，也不能复用其他设备的目录。
    filesLoaded.current = '';
    setDetails(undefined);
    setOwnerCheck(undefined);
    setConsent(false);
    setFiles([]);
    setFile(undefined);
    setPath('/sdcard');
    setPathInput('/sdcard');
    const chosen = device!;
    void run('读取设备信息', async () => {
      const result = await api.details(chosen);
      if (activeKey.current === targetKey(chosen)) setDetails(result);
    });
  }, [selected, online, device, api, run]);
  useEffect(() => {
    setOwnerCheck(undefined);
    setConsent(false);
  }, [component, selected]);
  const loadFiles = useCallback(
    async (directory: string) => {
      if (!device || !online) return;
      const key = selected;
      await run('读取目录', async () => {
        const list = await api.listFiles(device, directory);
        if (activeKey.current === key) {
          setFiles(list);
          setFile(undefined);
          setPath(directory);
          setPathInput(directory);
        }
      });
    },
    [device, online, selected, api, run],
  );
  const filesLoaded = useRef('');
  useEffect(() => {
    if (tab === 'files' && online && !busy && !busyRef.current && filesLoaded.current !== selected) {
      filesLoaded.current = selected;
      void loadFiles('/sdcard');
    }
  }, [tab, online, selected, busy, loadFiles]);
  const chooseApk = useCallback(
    () =>
      run('读取安装包', async () => {
        const next = await api.chooseApk();
        if (next) {
          setApk(next);
          setComponent(next.admins[0] || '');
          setTab('install');
        }
      }),
    [api, run],
  );
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || modal || busyRef.current) return;
      const key = event.key.toLowerCase();
      if (['o', 'r', 'l', ','].includes(key)) event.preventDefault();
      if (key === 'o') void chooseApk();
      if (key === 'r') {
        if (tab === 'files') void loadFiles(path);
        else {
          detailRequest.current = '';
          void refresh();
        }
      }
      if (key === 'l') setModal('connect');
      if (key === ',') setModal('settings');
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [api, modal, tab, path, loadFiles, chooseApk, refresh]);
  function editName(d: Device) {
    setRenameDevice(d);
    setName(snapshot?.settings.deviceNames[d.serial] || '');
    setModal('rename');
  }
  async function contextMenu(d: Device) {
    const action = await api.deviceMenu(d);
    if (action === 'rename') editName(d);
    if (action === 'remove') {
      await api.hide(d.serial);
      await refresh();
    }
  }
  function select(d: Device) {
    if (busyRef.current) return;
    setSelected(targetKey(d));
    setNotice(null);
  }
  async function install() {
    if (!device || !apk) return;
    await run(
      '正在安装到 ' + title,
      async () => {
        await api.install(device, apk.id, allowTest);
        if (ownerAfter) {
          setComponent(apk.admins[0] || component);
          setTab('info');
          setConsent(false);
          setOwnerCheck(undefined);
        }
      },
      ownerAfter
        ? '安装成功并已核对版本。请检查设备所有者条件，并单独确认授权。'
        : '安装成功，已核对设备上的安装版本。',
    );
  }

  return {
    api,
    snapshot,
    setSnapshot,
    selected,
    setSelected,
    tab,
    setTab,
    details,
    setDetails,
    apk,
    setApk,
    component,
    setComponent,
    ownerCheck,
    setOwnerCheck,
    consent,
    setConsent,
    allowTest,
    setAllowTest,
    ownerAfter,
    setOwnerAfter,
    dragging,
    setDragging,
    busy,
    notice,
    setNotice,
    query,
    setQuery,
    modal,
    setModal,
    renameDevice,
    name,
    setName,
    width,
    setWidth,
    viewport,
    sidebar,
    path,
    pathInput,
    setPathInput,
    files,
    setFiles,
    file,
    setFile,
    device,
    online,
    title,
    run,
    refresh,
    loadFiles,
    chooseApk,
    editName,
    contextMenu,
    select,
    install,
    busyRef,
    detailRequest,
  };
}
export type Workbench = ReturnType<typeof useWorkbenchState>;
export const WorkbenchContext = createContext<Workbench | null>(null);
export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error('工作台上下文尚未初始化。');
  return value;
}
