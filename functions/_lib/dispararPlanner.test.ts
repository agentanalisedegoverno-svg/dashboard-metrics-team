import { describe, expect, it, vi } from 'vitest'
import { dispararPlanner } from './dispararPlanner.ts'

describe('dispararPlanner', () => {
  it('sem chave ou sem id (ou id inválido) não chama a rede', async () => {
    const f = vi.fn()
    expect(await dispararPlanner({}, f as never)).toBe(false)
    expect(await dispararPlanner({ RENDER_API_KEY: 'k' }, f as never)).toBe(false)
    expect(await dispararPlanner({ RENDER_API_KEY: 'k', RENDER_PLANNER_CRON_ID: '../x' }, f as never)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
  it('aciona a execução do cron job com a chave no cabeçalho', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    expect(await dispararPlanner({ RENDER_API_KEY: 'k', RENDER_PLANNER_CRON_ID: 'crn-abc123' }, f as never)).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.render.com/v1/cron-jobs/crn-abc123/runs')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer k')
  })
  it('recusa ou falha de rede viram false, sem estourar', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await dispararPlanner({ RENDER_API_KEY: 'k', RENDER_PLANNER_CRON_ID: 'crn-a' }, (async () => ({ ok: false, status: 401 })) as never)).toBe(false)
    expect(await dispararPlanner({ RENDER_API_KEY: 'k', RENDER_PLANNER_CRON_ID: 'crn-a' }, (async () => { throw new Error('x') }) as never)).toBe(false)
    expect(JSON.stringify(erro.mock.calls)).not.toContain('"k"')
    erro.mockRestore()
  })
})
