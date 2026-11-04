import { messages } from './i18n.js';
import { createLanguagePicker } from './language-picker.js';
import { localeFromUrl, localizedUrl, screenshotPath, seoHead } from './seo.js';

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
  const label = textAt(language, viewLabels[currentView]);
  previewImage.src = screenshotPath(language, currentView);
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
  try {
    localStorage.setItem('adm-website-language', locale);
  } catch {
    // 存储不可用时，语言路径仍能保留本次选择。
  }
  setLanguage(locale);
  const url = localizedUrl(location.href, language);
  if (url.href !== location.href) history.pushState(null, '', url);
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

function applyLocationLanguage() {
  let saved;
  try {
    saved = localStorage.getItem('adm-website-language');
  } catch {
    // 禁用本地存储时，仍可按浏览器语言打开首页。
  }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  setLanguage(localeFromUrl(new URL(location.href), saved, languages));
  // 首页解析和旧链接规范化不增加历史记录，也不覆盖手动偏好。
  const url = localizedUrl(location.href, language);
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}
applyLocationLanguage();
window.addEventListener('popstate', applyLocationLanguage);

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
