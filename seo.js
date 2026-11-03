import { messages } from './i18n.js';

export const SITE_URL = 'https://adm.ruishanio.com';
export const REPOSITORY_URL = 'https://github.com/ruishanio/adm';
export const locales = Object.keys(messages);

const titles = {
  en: 'ADM — Android Device Manager for macOS & Windows',
  'zh-CN': 'ADM — macOS 与 Windows 上的 Android 设备管理工具',
  'zh-TW': 'ADM — macOS 與 Windows 上的 Android 裝置管理工具',
  ja: 'ADM — macOS・Windows 向け Android デバイス管理ツール',
  fr: 'ADM — Gestionnaire Android pour macOS et Windows',
  de: 'ADM — Android-Geräteverwaltung für macOS und Windows',
  es: 'ADM — Gestor de Android para macOS y Windows',
  ru: 'ADM — Менеджер Android для macOS и Windows',
};
const ogLocales = { en: 'en_US', 'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW', ja: 'ja_JP', fr: 'fr_FR', de: 'de_DE', es: 'es_ES', ru: 'ru_RU' };

export function localePath(locale) {
  return locale === 'en' ? '/' : `/${locale}/`;
}

// 兼容分享过的 ?lang= 链接；同一个规范网址始终对应同一种语言，不受本地存储影响。
export function localeFromUrl(url) {
  const query = url.searchParams.get('lang');
  if (Object.hasOwn(messages, query)) return query;
  const path = url.pathname.split('/')[1];
  return Object.hasOwn(messages, path) ? path : 'en';
}

export function localizedUrl(url, locale) {
  const next = new URL(url);
  next.pathname = localePath(locale);
  next.searchParams.delete('lang');
  return next;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/**
 * 生成静态构建和语言切换共用的元信息。locale 为语言，version 为页面实际显示的版本。
 * 返回可插入 head 的 HTML；结构化信息只描述真实产品，不添加虚构评分或评价。
 */
export function seoHead(locale, version) {
  const url = `${SITE_URL}${localePath(locale)}`;
  const title = titles[locale];
  const description = messages[locale].heroBody;
  const image = `${SITE_URL}/assets/${locale.startsWith('zh') ? 'zh-CN' : 'en'}-workbench.jpg`;
  const meta = (attribute, key, content) => `<meta data-seo ${attribute}="${key}" content="${escapeHtml(content)}">`;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: 'ADM', url: `${SITE_URL}/`, inLanguage: locales },
      {
        '@type': 'WebPage', '@id': `${url}#webpage`, url, name: title, description, inLanguage: locale,
        isPartOf: { '@id': `${SITE_URL}/#website` }, mainEntity: { '@id': `${SITE_URL}/#software` },
      },
      {
        '@type': 'SoftwareApplication', '@id': `${SITE_URL}/#software`, name: 'ADM',
        alternateName: 'Device manager for Android', url: `${SITE_URL}/`, description,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: ['macOS 13.3 or later (Apple Silicon)', 'Windows 10 or 11 (x64)'],
        softwareVersion: version, inLanguage: ['en', 'zh-CN'],
        image: `${SITE_URL}/assets/icon.png`, screenshot: image,
        license: `${REPOSITORY_URL}/blob/master/LICENSE`, sameAs: [REPOSITORY_URL],
        releaseNotes: `${REPOSITORY_URL}/releases/tag/v${version}`,
        featureList: messages[locale].features.map(feature => feature.body),
      },
    ],
  };
  return [
    `<title data-seo>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    meta('name', 'robots', 'index, follow, max-image-preview:large'),
    `<link data-seo rel="canonical" href="${url}">`,
    ...locales.map(language => `<link data-seo rel="alternate" hreflang="${language}" href="${SITE_URL}${localePath(language)}">`),
    `<link data-seo rel="alternate" hreflang="x-default" href="${SITE_URL}/">`,
    meta('property', 'og:type', 'website'), meta('property', 'og:site_name', 'ADM'),
    meta('property', 'og:title', title), meta('property', 'og:description', description),
    meta('property', 'og:url', url), meta('property', 'og:locale', ogLocales[locale]),
    meta('property', 'og:image', image), meta('property', 'og:image:width', '1280'),
    meta('property', 'og:image:height', '720'), meta('property', 'og:image:alt', `ADM — ${messages[locale].features[0].title}`),
    meta('name', 'twitter:card', 'summary_large_image'), meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description), meta('name', 'twitter:image', image),
    `<script data-seo type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`,
  ].join('\n');
}
