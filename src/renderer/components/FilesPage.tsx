import { useWorkbench } from '../hooks/useWorkbench';
import { RefreshCw, Upload, Folder, File, FolderPlus, Download, ChevronUp, Home } from 'lucide-react';

import { sizeLabel, parentPath, displayPath } from './format';
export function FilesPage() {
  const {
    api,
    tab,
    busy,
    setNotice,
    setModal,
    setName,
    path,
    pathInput,
    setPathInput,
    files,
    setFiles,
    file,
    setFile,
    device,
    online,
    run,
    loadFiles,
  } = useWorkbench();
  return (
    <>
      {tab === 'files' &&
        (!online ? (
          <div className="empty-state">
            <Folder aria-hidden="true" />
            <h2>选择已连接的设备</h2>
            <p>浏览共享存储、上传和下载文件。</p>
          </div>
        ) : (
          <>
            <div className="file-toolbar">
              <button
                className="icon-button"
                title="共享存储"
                aria-label="共享存储"
                disabled={!!busy}
                onClick={() => void loadFiles('/sdcard')}
              >
                <Home aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                title="上一级"
                aria-label="上一级"
                disabled={!!busy || path === '/'}
                onClick={() => void loadFiles(parentPath(path))}
              >
                <ChevronUp aria-hidden="true" />
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadFiles(pathInput);
                }}
              >
                <input
                  aria-label="设备目录"
                  value={pathInput}
                  disabled={!!busy}
                  onChange={(e) => setPathInput(e.target.value)}
                  spellCheck={false}
                />
              </form>
              <button
                className="icon-button"
                aria-label="刷新目录"
                disabled={!!busy}
                onClick={() => void loadFiles(path)}
              >
                <RefreshCw aria-hidden="true" />
              </button>
            </div>
            <div className="file-actions">
              <button
                disabled={!!busy}
                onClick={() =>
                  void run('上传文件', async () => {
                    if (await api.upload(device!, path)) {
                      setFiles(await api.listFiles(device!, path));
                      setNotice({ text: '上传完成。' });
                    }
                  })
                }
              >
                <Upload className="icon-info" aria-hidden="true" />
                上传文件
              </button>
              <button
                disabled={!!busy || file?.type !== 'file'}
                onClick={() =>
                  void run('下载文件', async () => {
                    if (await api.download(device!, file!.path)) setNotice({ text: '下载完成。' });
                  })
                }
              >
                <Download className="icon-info" aria-hidden="true" />
                下载
              </button>
              <button
                disabled={!!busy}
                onClick={() => {
                  setName('');
                  setModal('folder');
                }}
              >
                <FolderPlus className="icon-files" aria-hidden="true" />
                新建文件夹
              </button>
              <span className="muted">{files.length} 项</span>
            </div>
            <table className="file-table" aria-label="设备文件">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>大小</th>
                  <th>修改时间</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr
                    key={f.path}
                    tabIndex={busy ? -1 : 0}
                    aria-selected={file?.path === f.path}
                    className={file?.path === f.path ? 'selected' : ''}
                    onClick={() => !busy && setFile(f)}
                    onDoubleClick={() => !busy && f.type === 'directory' && void loadFiles(f.path)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && f.type === 'directory') void loadFiles(f.path);
                      if (e.key === ' ') {
                        e.preventDefault();
                        setFile(f);
                      }
                    }}
                  >
                    <td>
                      <span className="file-name">
                        {f.type === 'directory' ? (
                          <Folder aria-hidden="true" className="folder-icon" />
                        ) : (
                          <File aria-hidden="true" />
                        )}
                        <span title={f.name}>{displayPath(f.name)}</span>
                        {f.type === 'link' && <small>链接</small>}
                      </span>
                    </td>
                    <td>{f.type === 'file' ? sizeLabel(f.size) : '—'}</td>
                    <td>
                      {new Date(f.modified * 1000).toLocaleString('zh-CN', {
                        hour12: false,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!files.length && !busy && <div className="empty-directory">此目录为空</div>}
            <p className="field-hint">双击文件夹进入。上传不会覆盖同名文件；链接和特殊文件仅供查看。</p>
          </>
        ))}
    </>
  );
}
