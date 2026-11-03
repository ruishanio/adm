import { messages } from './i18n.js';

const languageSelect = document.querySelector('#language');
const previewImage = document.querySelector('#preview-image');
const previewPanel = document.querySelector('#preview-panel');
const previewTabs = [...document.querySelectorAll('[data-view]')];
const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightbox-image');
const viewLabels = { workbench: 'tabDevice', apps: 'tabApps', files: 'tabFiles' };
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
  lightboxImage.src = imagePath;
  lightboxImage.alt = previewImage.alt;
  document.querySelector('#lightbox-title').textContent = label;
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
  languageSelect.value = language;
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

languageSelect.addEventListener('change', () => {
  setLanguage(languageSelect.value);
  const url = new URL(location.href);
  url.searchParams.set('lang', language);
  history.replaceState(null, '', url);
  try {
    localStorage.setItem('adm-website-language', language);
  } catch {
    /* 保留本次选择即可。 */
  }
});

previewTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    currentView = tab.dataset.view;
    updatePreview();
  });
  // 标签页采用单一 Tab 停靠点，方向键循环切换，Home/End 跳到两端。
  tab.addEventListener('keydown', (event) => {
    const targets = {
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

document.querySelector('#zoom').addEventListener('click', () => lightbox.showModal());
document.querySelector('#close-lightbox').addEventListener('click', () => lightbox.close());
// 原生 dialog 提供 Esc 与焦点返回；仅点击遮罩时关闭，避免点图片误退出。
lightbox.addEventListener('click', (event) => {
  const rect = lightbox.getBoundingClientRect();
  if (
    event.target === lightbox &&
    (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  )
    lightbox.close();
});

setLanguage(initialLanguage());

// 先显示正文与静态图标，3D 模块异步加载；失败时保留可用页面及静态品牌图。
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
    document.documentElement.dataset.intro = 'complete';
  });
