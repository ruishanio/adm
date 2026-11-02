import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = (data) => createHash('sha256').update(data).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** 核对锁文件、原始声明和源码归档；返回清单。仅发布检查会要求关闭人工核对项。 */
export function checkLicenses(root = project, { release = false, frontend = false } = {}) {
  const legal = resolve(root, 'legal');
  const manifest = json(resolve(legal, 'manifest.json'));
  const metadata = json(resolve(root, 'package.json'));
  if (manifest.schema !== 1 || manifest.version !== metadata.version || metadata.license !== 'MIT')
    throw new Error('许可快照版本或 ADM 许可与项目不一致，请重新生成并审阅。');
  // 校验清单不能跨出许可目录或工程目录，也不能静默遗漏后加入的文件。
  function verify(base, entries) {
    for (const [name, digest] of Object.entries(entries)) {
      const path = resolve(base, name);
      const within = relative(base, path);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !within)
        throw new Error(`非法许可路径：${name}`);
      if (hash(readFileSync(path)) !== digest)
        throw new Error(`许可快照已过期或文件损坏：${name}。请更新并审阅 legal/。`);
    }
  }
  verify(root, manifest.inputs);
  verify(legal, manifest.files);
  const actual = readdirSync(legal, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(legal, resolve(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((name) => name !== 'manifest.json')
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort()))
    throw new Error('许可目录与清单不一致。请重新生成快照。');
  for (const name of [
    'LICENSE',
    'catalog.json',
    'THIRD-PARTY-NOTICES.txt',
    'ATTRIBUTION.txt',
    'SOURCE-CODE.md',
    'sources.json',
    'WINDOWS-RUNTIME.txt',
    'release-review.json',
  ]) {
    if (!manifest.files[name]) throw new Error(`缺少必需声明：${name}`);
  }
  const catalog = json(resolve(legal, 'catalog.json'));
  const ids = new Set();
  for (const entry of catalog) {
    if (
      ids.has(entry.id) ||
      !entry.text?.trim() ||
      !entry.license ||
      /UNKNOWN|NOASSERTION|UNLICENSED/i.test(entry.license)
    )
      throw new Error(`第三方许可未确认或条目重复：${entry.id}`);
    ids.add(entry.id);
  }
  const sources = json(resolve(legal, 'sources.json'));
  for (const entry of catalog.filter((e) => e.group === 'native' && e.license.includes('MPL-2.0'))) {
    const source = sources.find((s) => s.name === entry.name && s.version === entry.version);
    if (!source || manifest.files[source.file] !== source.sha256)
      throw new Error(`MPL 对应源码缺失：${entry.id}`);
  }
  if (frontend) {
    const report = readFileSync(resolve(root, 'dist/THIRD-PARTY-LICENSES.md'), 'utf8');
    for (const match of report.matchAll(/^## (.+?) - ([^ ]+) \(/gm)) {
      if (!ids.has(`npm:${match[1]}@${match[2]}`))
        throw new Error(`实际前端产物包含未归档组件：${match[1]}@${match[2]}`);
    }
    if (!report.match(/^## /m)) throw new Error('Vite 未生成有效的第三方许可报告。');
  }
  if (release) {
    const review = json(resolve(legal, 'release-review.json'));
    const completed = review.status === 'ready' && !review.unresolved.length && review.evidence.length;
    // 继续使用官方 ADB 的明确分发决策与“核对完成”分开记录，不能把未决事项伪装成 ready。
    const retainedOfficialAdb = review.status === 'open-review'
      && review.distributionPolicy === 'retain-official-adb'
      && review.unresolved.length > 0 && review.evidence.length > 0;
    if (!completed && !retainedOfficialAdb)
      throw new Error(
        `公开分发核对未完成：\n${review.unresolved.join('\n')}\n本地构建可继续，禁止将此状态当作合规通过。`,
      );
    if (retainedOfficialAdb)
      console.warn('继续官方 ADB 分发方案；以下事项仍未核实，不代表合规审查完成：\n' + review.unresolved.join('\n'));
  }
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const entries = checkLicenses(project, {
      release: process.argv.includes('--release'),
      frontend: process.argv.includes('--frontend'),
    });
    console.log(
      `许可材料完整性校验通过：${entries.length} 项声明；审阅状态见 legal/release-review.json。`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
