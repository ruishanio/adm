import { messages } from './i18n.js';
import { createLanguagePicker } from './language-picker.js';
import { localeFromUrl, localizedUrl, seoHead } from './seo.js';

const languagePicker = createLanguagePicker(document.querySelector('.language-control'), changeLanguage);
const previewImage = document.querySelector('#preview-image');
const previewPanel = document.querySelector('#preview-panel');
const previewTabs = [...document.querySelectorAll('[data-view]')];
const viewLabels = {
  workbench: 'features.0.title', control: 'features.1.title',
  apps: 'features.2.title', files: 'features.3.title',
};
let currentView = 'workbench';
let language = 'en';
let heroController;

function textAt(locale, key) {
  return key.split('.').reduce((value, part) => value?.[part], messages[locale]);
}

function updatePreview() {
  const imageLocale = language.startsWith('zh') ? 'zh-CN' : 'en';
  const imagePath = `/assets/${imageLocale}-${currentView}.jpg`;
  const label = textAt(language, viewLabels[currentView]);
  previewImage.src = imagePath;
  previewImage.alt = `ADM — ${label}`;
  previewTabs.forEach((tab) => {
    const selected = tab.dataset.view === currentView;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) previewPanel.setAttribute('aria-labelledby', tab.id);
  });
}

function setLanguage(locale) {
  language = Object.hasOwn(messages, locale) ? locale : 'en';
  document.documentElement.lang = language;
  languagePicker.setValue(language);
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = textAt(language, element.dataset.i18n) ?? textAt('en', element.dataset.i18n);
  });
  // 元信息与可见正文同步，分享当前语言时不残留上一种语言的标题或规范网址。
  const version = document.querySelector('.download-version').textContent.trim().replace(/^v/, '');
  document.head.querySelectorAll('[data-seo]').forEach(element => element.remove());
  document.head.insertAdjacentHTML('beforeend', seoHead(language, version));
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', textAt(language, element.dataset.i18nAria));
  });
  updatePreview();
  heroController?.refreshLabels();
}

function changeLanguage(locale) {
  setLanguage(locale);
  history.pushState(null, '', localizedUrl(location.href, language));
}

previewTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    currentView = tab.dataset.view;
    updatePreview();
  });
  // 左侧功能列表是唯一切换入口；上下方向键循环选择，横向键兼容窄屏排列。
  tab.addEventListener('keydown', (event) => {
    const targets = {
      ArrowDown: (index + 1) % previewTabs.length,
      ArrowUp: (index - 1 + previewTabs.length) % previewTabs.length,
      ArrowRight: (index + 1) % previewTabs.length,
      ArrowLeft: (index - 1 + previewTabs.length) % previewTabs.length,
      Home: 0,
      End: previewTabs.length - 1,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    const next = previewTabs[targets[event.key]];
    currentView = next.dataset.view;
    updatePreview();
    next.focus();
  });
});

setLanguage(localeFromUrl(new URL(location.href)));
// 旧查询参数链接仍能访问，并保留锚点和推广参数；新链接直接使用可预渲染的语言路径。
history.replaceState(null, '', localizedUrl(location.href, language));
window.addEventListener('popstate', () => setLanguage(localeFromUrl(new URL(location.href))));

// 模型独立异步加载，导航与正文始终可用；失败时保留透明背景的静态模型。
import('./hero-scene.js')
  .then(({ createHeroScene }) =>
    createHeroScene(document.querySelector('#brand-scene'), (key) => textAt(language, key)),
  )
  .then((controller) => {
    heroController = controller;
    heroController.refreshLabels();
  })
  .catch(() => {
    document.querySelector('#brand-scene').dataset.sceneState = 'fallback';
  });
