import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'resources/branding/adm-icon.png');
const destination = join(root, 'src-tauri/icons');
const temporary = await mkdtemp(join(tmpdir(), 'adm-icons-'));
const desktopIcons = ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.icns', 'icon.ico'];

try {
  // 使用锁定版本的 Tauri CLI，从 3D 场景渲染的透明 PNG 统一导出两平台图标。
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', source, '--output', temporary],
    { cwd: root, encoding: 'utf8', shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`图标生成失败：${result.stderr || result.stdout || result.status}`);
  }

  // 默认导出还包含移动平台资源；仅同步 ADM 实际支持的桌面格式。
  await mkdir(destination, { recursive: true });
  for (const name of desktopIcons) {
    await copyFile(join(temporary, name), join(destination, name));
  }
  // 清除旧流程遗留的 SVG 副本，避免把过时图标当成仍在使用的设计源。
  await rm(join(destination, 'icon.svg'), { force: true });
  console.log('已从 3D 渲染 PNG 更新 macOS ICNS、Windows ICO 和各尺寸 PNG。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
