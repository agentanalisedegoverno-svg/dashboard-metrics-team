import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  // Keep the Pages build isolated from machine-level PostCSS configuration.
  css: { postcss: { plugins: [] } },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'functions/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/domain/**', 'functions/**'], exclude: ['**/*.test.ts'], reporter: ['text', 'lcov'] } },
})
