import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
// Portal 弹窗挂载到 body，平台密度须放在根节点才能与主窗口一致。
document.documentElement.dataset.platform = /Mac/.test(navigator.platform) ? 'darwin' : 'win32';
createApp(App).mount('#app');
