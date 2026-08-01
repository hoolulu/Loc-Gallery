import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const appPort = Number(process.env.LOC_GALLERY_APP_PORT || 3460)
const apiPort = Number(process.env.LOC_GALLERY_API_PORT || 3461)

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: appPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
