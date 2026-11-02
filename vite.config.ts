import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) } },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    target: ['es2022', 'safari16.4'],
  },
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  clearScreen: false,
});
