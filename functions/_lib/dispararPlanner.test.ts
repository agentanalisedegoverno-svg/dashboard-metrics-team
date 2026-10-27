import { describe, expect, it, vi } from 'vitest'
import { dispararPlanner } from './dispararPlanner.ts'

describe('dispararPlanner', () => {
  it('sem token não chama a rede', async () => {
    const f = vi.fn()
    expect(await dispararPlanner({}, f as never)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
  it('aciona o workflow do Planner na main, com o token no cabeçalho', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    expect(await dispararPlanner({ GITHUB_DISPATCH_TOKEN: 't' }, f as never)).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/agentanalisedegoverno-svg/dashboard-metrics-team/actions/workflows/planner-integracao.yml/dispatches')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer t')
    expect(JSON.parse(init.body)).toEqual({ ref: 'main' })
  })
  it('GITHUB_REPO inválido volta ao repositório padrão', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    await dispararPlanner({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'sem barra' }, f as never)
    expect(f.mock.calls[0][0]).toContain('/repos/agentanalisedegoverno-svg/dashboard-metrics-team/')
  })
  it('recusa ou falha de rede viram false, sem vazar o token no log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await dispararPlanner({ GITHUB_DISPATCH_TOKEN: 'segredo' }, (async () => ({ ok: false, status: 401 })) as never)).toBe(false)
    expect(await dispararPlanner({ GITHUB_DISPATCH_TOKEN: 'segredo' }, (async () => { throw new Error('x') }) as never)).toBe(false)
    expect(JSON.stringify(erro.mock.calls)).not.toContain('segredo')
    erro.mockRestore()
  })
})
