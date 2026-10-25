import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Testes de carga e desempenho (`npm run test:carga`): fora do `npm test`, porque levam alguns minutos e medem tempo. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['db/**/*.perf.ts', 'functions/**/*.perf.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false, // um arquivo por vez: tempos comparáveis, sem concorrência entre as medições
  },
})
