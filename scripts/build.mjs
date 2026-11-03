import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { messages } from '../i18n.js';
import { build } from 'vite';
import { parse, parseFragment, serialize } from 'parse5';
import { locales, localePath, seoHead, SITE_URL } from '../seo.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const keys = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((match) => match[1]);
keys.push('sceneDevices.0', 'sceneDevices.1', 'sceneDevices.2', 'sceneLifted', 'sceneRestored', 'scenePaused', 'sceneRotating');
// 独立构建仍检查全部语言，避免迁移后漏译或静默混用英文。
for (const [locale, translations] of Object.entries(messages)) {
  for (const key of keys) {
    const value = key.split('.').reduce((entry, part) => entry?.[part], translations);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`官网文案缺失：${locale}.${key}`);
  }
}
// 模型、图标与截图全部位于本分支，构建不读取桌面应用工作目录。
await build({ root, configFile: false, base: '/', build: { chunkSizeWarningLimit: 700 } });
console.log(`文案检查通过：${Object.keys(messages).length} 种语言。`);

function walk(node, visit) {
  visit(node);
  node.childNodes?.forEach(child => walk(child, visit));
}
const attr = (node, name) => node.attrs?.find(entry => entry.name === name)?.value;
function setAttr(node, name, value) {
  const current = node.attrs.find(entry => entry.name === name);
  if (current) current.value = value;
  else node.attrs.push({ name, value });
}
function setText(node, text) {
  node.childNodes = [{ nodeName: '#text', value: text, parentNode: node }];
}

/**
 * 将 Vite 产物预渲染为指定语言。输入完整 HTML 和 locale，返回含正文与 SEO 元信息的静态 HTML。
 * 不依赖抓取器执行 JavaScript，也不按爬虫身份输出不同内容。
 */
function renderLocale(template, locale) {
  const document = parse(template);
  let head, version;
  walk(document, node => {
    if (node.tagName === 'html') setAttr(node, 'lang', locale);
    if (node.tagName === 'head') head = node;
    if (attr(node, 'class') === 'download-version') version = node.childNodes[0].value.trim().replace(/^v/, '');
    for (const attribute of ['data-i18n', 'data-i18n-aria']) {
      const key = attr(node, attribute);
      if (!key) continue;
      const text = key.split('.').reduce((entry, part) => entry[part], messages[locale]);
      if (attribute === 'data-i18n') setText(node, text);
      else setAttr(node, 'aria-label', text);
    }
    if (attr(node, 'data-locale')) setAttr(node, 'aria-selected', String(attr(node, 'data-locale') === locale));
    if (attr(node, 'id') === 'language-current') {
      setAttr(node, 'lang', locale);
      const names = { en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', ja: '日本語', fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский' };
      setText(node, names[locale]);
    }
    if (attr(node, 'id') === 'preview-image') {
      setAttr(node, 'src', `/assets/${locale.startsWith('zh') ? 'zh-CN' : 'en'}-workbench.jpg`);
      setAttr(node, 'alt', `ADM — ${messages[locale].features[0].title}`);
    }
  });
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('下载区域缺少有效版本号');
  head.childNodes = head.childNodes.filter(node => attr(node, 'data-seo') === undefined);
  const metadata = parseFragment(seoHead(locale, version)).childNodes;
  metadata.forEach(node => { node.parentNode = head; });
  head.childNodes.push(...metadata);
  return serialize(document);
}

const output = new URL('../dist/', import.meta.url);
const template = await readFile(new URL('index.html', output), 'utf8');
for (const locale of locales) {
  const directory = new URL(`.${localePath(locale)}`, output);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('index.html', directory), renderLocale(template, locale));
}
// 只列出真实生成的规范页面；不使用每次构建都会变化的虚假 lastmod 时间。
await writeFile(new URL('sitemap.xml', output), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locales.map(locale => `  <url><loc>${SITE_URL}${localePath(locale)}</loc></url>`).join('\n')}\n</urlset>\n`);
// 普通搜索与 AI 搜索使用相同公开内容；不阻止页面、脚本、样式或模型资源抓取。
await writeFile(new URL('robots.txt', output), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
await import('./check-seo.mjs');
