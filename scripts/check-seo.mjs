import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { parse } from 'parse5';
import { messages } from '../i18n.js';
import { locales, localeFromUrl, localePath, localizedUrl, REPOSITORY_URL, SITE_URL } from '../seo.js';

const output = new URL('../dist/', import.meta.url);
const attr = (node, key) => node.attrs?.find(entry => entry.name === key)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
function elements(node) {
  return [node, ...(node.childNodes ?? []).flatMap(elements)];
}

// 直接检查构建 HTML，不执行浏览器脚本，覆盖不会渲染 JavaScript 的抓取器。
for (const locale of locales) {
  const canonical = `${SITE_URL}${localePath(locale)}`;
  const html = await readFile(new URL(`.${localePath(locale)}index.html`, output), 'utf8');
  const nodes = elements(parse(html));
  const find = (name, value) => nodes.find(node => attr(node, name) === value);
  assert.equal(attr(nodes.find(node => node.tagName === 'html'), 'lang'), locale);
  assert.equal(nodes.filter(node => node.tagName === 'title').length, 1, `${locale} 只有一个标题`);
  assert.match(text(nodes.find(node => node.tagName === 'title')), /ADM.*Android/);
  assert.equal(attr(find('name', 'description'), 'content'), messages[locale].heroBody);
  assert.equal(attr(find('rel', 'canonical'), 'href'), canonical);
  assert.equal(attr(find('property', 'og:url'), 'content'), canonical);
  assert.equal(attr(find('property', 'og:description'), 'content'), messages[locale].heroBody);
  assert.equal(attr(find('name', 'twitter:card'), 'content'), 'summary_large_image');
  assert.doesNotMatch(attr(find('name', 'robots'), 'content'), /noindex|nosnippet|nofollow/);

  for (const node of nodes) {
    for (const attribute of ['data-i18n', 'data-i18n-aria']) {
      const key = attr(node, attribute);
      if (!key) continue;
      const expected = key.split('.').reduce((value, part) => value[part], messages[locale]);
      assert.equal(attribute === 'data-i18n' ? text(node) : attr(node, 'aria-label'), expected, `${locale}.${key} 无脚本即可读取`);
    }
    // 语言子目录必须引用根目录下的实际资源，避免上线后模型或截图返回 404。
    for (const attribute of ['src', 'href']) {
      const value = attr(node, attribute);
      if (value?.startsWith('/assets/')) await access(new URL(value.slice(1), output));
      assert.ok(!value?.startsWith('./assets/'), `${locale} 不使用错误的目录相对资源`);
    }
  }

  const alternates = nodes.filter(node => node.tagName === 'link' && attr(node, 'rel') === 'alternate');
  assert.equal(alternates.length, locales.length + 1);
  for (const alternate of [...locales, 'x-default']) {
    assert.equal(attr(alternates.find(node => attr(node, 'hreflang') === alternate), 'href'), `${SITE_URL}${localePath(alternate === 'x-default' ? 'en' : alternate)}`);
  }
  const languageLinks = nodes.filter(node => attr(node, 'data-locale'));
  assert.equal(languageLinks.length, locales.length);
  for (const link of languageLinks) {
    assert.equal(link.tagName, 'a', '语言入口必须有真实链接');
    assert.equal(attr(link, 'href'), localePath(attr(link, 'data-locale')));
    assert.equal(attr(link, 'aria-selected'), String(attr(link, 'data-locale') === locale));
  }
  const data = JSON.parse(text(find('type', 'application/ld+json')));
  const software = data['@graph'].find(node => node['@type'] === 'SoftwareApplication');
  assert.equal(software.softwareVersion, text(find('class', 'download-version')).replace(/^v/, ''));
  assert.deepEqual(software.inLanguage, ['en', 'zh-CN', 'zh-TW', 'ja', 'fr', 'de', 'es', 'ru']);
  // 可见版本号、发行说明和两个安装包必须指向同一版本。
  const tag = `v${software.softwareVersion}`;
  assert.equal(software.releaseNotes, `${REPOSITORY_URL}/releases/tag/${tag}`);
  assert.equal(attr(find('class', 'download-version'), 'href'), software.releaseNotes);
  for (const [platform, suffix] of [['mac', 'mac-arm64.dmg'], ['windows', 'win-x64-setup.exe']]) {
    assert.equal(attr(find('data-download', platform), 'href'),
      `${REPOSITORY_URL}/releases/download/${tag}/ADM-${software.softwareVersion}-${suffix}`);
  }
  assert.deepEqual(software.featureList, messages[locale].features.map(feature => feature.body));
  assert.equal(software.aggregateRating, undefined, '不虚构评分');
  assert.equal(software.review, undefined, '不虚构评价');
  assert.equal(software.description, text(find('data-i18n', 'heroBody')));
}

const sitemap = await readFile(new URL('sitemap.xml', output), 'utf8');
assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort(), locales.map(locale => `${SITE_URL}${localePath(locale)}`).sort());
const robots = await readFile(new URL('robots.txt', output), 'utf8');
assert.match(robots, /User-agent: \*\nAllow: \/\n/);
assert.match(robots, /Sitemap: https:\/\/adm\.ruishanio\.com\/sitemap\.xml/);
assert.doesNotMatch(robots, /Disallow:/);

// 旧链接、推广参数、页内锚点与浏览器后退必须保留准确的语言语义。
const legacy = new URL(`${SITE_URL}/?lang=ja&utm_source=chatgpt.com#download`);
assert.equal(localeFromUrl(legacy), 'ja');
assert.equal(localizedUrl(legacy, 'ja').href, `${SITE_URL}/ja/?utm_source=chatgpt.com#download`);
assert.equal(localeFromUrl(new URL(`${SITE_URL}/zh-CN/`)), 'zh-CN');
assert.equal(localeFromUrl(new URL(`${SITE_URL}/?lang=__proto__`)), 'en');
assert.equal(localizedUrl(`${SITE_URL}/ja/#features`, 'en').href, `${SITE_URL}/#features`);
console.log(`SEO 检查通过：${locales.length} 个静态语言页面、互链、元信息、结构化数据、资源与站点地图。`);
