import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      // 仅为本地开发热更新的内联脚本生成逐次 nonce；发布页面继续禁止内联脚本。
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          const nonce = randomBytes(18).toString('base64');
          return html
            .replace(/<script\b/g, `<script nonce="${nonce}"`)
            .replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
            .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5178");
        },
      },
    },
  ],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
  },
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
});
