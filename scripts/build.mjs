import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { messages } from '../i18n.js';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const keys = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]);
// 独立构建仍检查全部语言，避免迁移后漏译或静默混用英文。
for (const [locale, translations] of Object.entries(messages)) {
  for (const key of keys) {
    const value = key.split('.').reduce((entry, part) => entry?.[part], translations);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`官网文案缺失：${locale}.${key}`);
  }
}
// 模型、图标与截图全部位于本分支，构建不读取桌面应用工作目录。
await build({ root, configFile: false, base: './', build: { chunkSizeWarningLimit: 700 } });
console.log(`文案检查通过：${Object.keys(messages).length} 种语言。`);
