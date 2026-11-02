import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidates = [
  process.env.ADM_BLENDER_PATH,
  'blender',
  ...(process.platform === 'darwin' ? [
    '/Applications/Blender.app/Contents/MacOS/Blender',
    join(homedir(), 'Library/Caches/adm-icon-tools/Blender.app/Contents/MacOS/Blender'),
  ] : []),
  ...(process.platform === 'win32'
    ? [join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation', 'Blender 4.5', 'blender.exe')]
    : []),
].filter(Boolean);

// Blender 只用于设计资产，不作为应用运行或 CI 打包依赖。
const executable = candidates.find((candidate) => {
  if (candidate !== 'blender' && !existsSync(candidate)) return false;
  return spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 15_000, shell: false }).status === 0;
});
if (!executable) {
  console.error('未找到 Blender。请安装 Blender 4.5 LTS，或用 ADM_BLENDER_PATH 指定可执行文件。');
  process.exit(1);
}

const result = spawnSync(executable, [
  '--background', '--python-exit-code', '1',
  '--python', join(root, 'scripts/render-icon.py'), '--', ...process.argv.slice(2),
], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
