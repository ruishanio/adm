import { createApp } from 'vue';
import App from '@/app/App.vue';
import '@/shared/styles/index.css';
import { initializeLanguage } from '@/shared/i18n/index';
// Portal 弹窗挂载到 body，平台密度须放在根节点才能与主窗口一致。
document.documentElement.dataset.platform = /Mac/.test(navigator.platform) ? 'darwin' : 'win32';
initializeLanguage();
// 自定义菜单仍由组件处理；阻止空白区域和普通控件弹出 WebView 的 Reload 等浏览器菜单。
document.addEventListener('contextmenu', (event) => event.preventDefault());
createApp(App).mount('#app');
