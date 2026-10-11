import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.BLUEMANTA_API_TARGET;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 设计变量只有 docs/design/tokens.css 一份，网页直接引用，不复制。
      '@design': fileURLToPath(new URL('../../docs/design', import.meta.url)),
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 服务按文件名里的哈希判断能否长缓存（packages/server 的 isHashedAsset）。
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    host: '127.0.0.1',
    strictPort: false,
    proxy: apiTarget
      ? {
          // changeOrigin 让 Host 头变成服务自己的地址，通过服务的 Host 校验。
          '/api': { target: apiTarget, changeOrigin: true },
        }
      : undefined,
  },
});
