import { messages } from './i18n.js';
import { createLanguagePicker } from './language-picker.js';

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

// 只读取明确支持的语言。存储不可用时仍可通过 URL 分享与切换语言。
function initialLanguage() {
  const query = new URL(location.href).searchParams.get('lang');
  if (Object.hasOwn(messages, query)) return query;
  try {
    const saved = localStorage.getItem('adm-website-language');
    if (Object.hasOwn(messages, saved)) return saved;
  } catch {
    /* 隐私模式或存储限制不影响页面使用。 */
  }
  return 'en';
}

function updatePreview() {
  const imageLocale = language.startsWith('zh') ? 'zh-CN' : 'en';
  const imagePath = `./assets/${imageLocale}-${currentView}.jpg`;
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
  document.querySelector('meta[name="description"]').content = messages[language].heroBody;
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', textAt(language, element.dataset.i18nAria));
  });
  updatePreview();
  heroController?.refreshLabels();
}

function changeLanguage(locale) {
  setLanguage(locale);
  const url = new URL(location.href);
  url.searchParams.set('lang', language);
  history.replaceState(null, '', url);
  try {
    localStorage.setItem('adm-website-language', language);
  } catch {
    /* 保留本次选择即可。 */
  }
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

setLanguage(initialLanguage());

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
