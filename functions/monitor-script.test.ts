import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('scripts/monitor-licitacoes.mjs', () => {
  it('tem sintaxe válida (o workflow roda o arquivo direto, sem build)', () => {
    expect(() => execFileSync(process.execPath, ['--check', 'scripts/monitor-licitacoes.mjs'], { stdio: 'pipe' })).not.toThrow()
  })
})
