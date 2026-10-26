import { describe, expect, it, vi } from 'vitest'
import { dispararEnvioEmails } from './dispararEmails.ts'

describe('dispararEnvioEmails', () => {
  it('sem token não faz nada (nem chama a rede)', async () => {
    const f = vi.fn()
    expect(await dispararEnvioEmails({}, f as unknown as typeof fetch)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
  it('com token aciona o workflow certo, na main, com o token só no cabeçalho', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    expect(await dispararEnvioEmails({ GITHUB_DISPATCH_TOKEN: 'tok' }, f as unknown as typeof fetch)).toBe(true)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/agentanalisedegoverno-svg/dashboard-metrics-team/actions/workflows/enviar-emails.yml/dispatches')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ ref: 'main' })
    expect(String(url) + String(init.body)).not.toContain('tok')
  })
  it('repositório vem da configuração, mas só em formato dono/repo (sem desvio de URL)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true })
    await dispararEnvioEmails({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'org/outro' }, f as unknown as typeof fetch)
    expect(f.mock.calls[0][0]).toContain('/repos/org/outro/')
    await dispararEnvioEmails({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'x/../../evil?y' }, f as unknown as typeof fetch)
    expect(f.mock.calls[1][0]).toContain('/repos/agentanalisedegoverno-svg/dashboard-metrics-team/')
  })
  it('falha de rede ou resposta de erro nunca levanta (o cadastro não pode ser afetado)', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await dispararEnvioEmails({ GITHUB_DISPATCH_TOKEN: 't' }, vi.fn().mockRejectedValue(new Error('rede')) as unknown as typeof fetch)).toBe(false)
    expect(await dispararEnvioEmails({ GITHUB_DISPATCH_TOKEN: 't' }, vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch)).toBe(false)
    erro.mockRestore()
  })
})
