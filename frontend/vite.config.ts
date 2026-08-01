import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3457,
    proxy: {
      '/api': process.env.VITE_API_PROXY || 'http://127.0.0.1:3458',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
