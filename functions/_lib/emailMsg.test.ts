import { describe, expect, it } from 'vitest'
import { montarEmail, montarEmailTeste, type DadosEmail } from './emailMsg.ts'

const base: DadosEmail = {
  codigo: '2026-0123', orgao: 'Prefeitura de X', status: 'Go', torre: 'ITS', linha_servico: 'Infraestrutura', uf: 'SP',
  data_pregao_dt: '2026-11-05', analista: 'Ana', orcamento: 1234567, orcamento_sigiloso: false, criado_por: 'joao@ctctech.com.br',
}

describe('montarEmail', () => {
  it('monta assunto, texto e html com os campos principais', () => {
    const m = montarEmail(base, 'https://radar.test')
    expect(m.assunto).toBe('[Radar] Nova oportunidade 2026-0123 — Prefeitura de X (Go)')
    expect(m.texto).toContain('Data do pregão: 05/11/2026')
    expect(m.texto).toContain('Orçamento: R$')
    expect(m.html).toContain('href="https://radar.test"')
  })
  it('orçamento sigiloso não mostra valor', () => {
    const m = montarEmail({ ...base, orcamento_sigiloso: true }, 'https://radar.test')
    expect(m.texto).toContain('Orçamento: Sigiloso')
    expect(m.texto).not.toContain('1.234.567')
  })
  it('escapa HTML e impede quebra de linha no assunto', () => {
    const m = montarEmail({ ...base, orgao: 'X<script>alert(1)</script>\r\nBcc: alguem@x.com', analista: '"><img src=x>' }, 'https://radar.test')
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<img')
    expect(m.assunto).not.toMatch(/[\r\n]/)
  })
  it('campos vazios viram traço', () => {
    const m = montarEmail({ ...base, torre: null, orcamento: null, data_pregao_dt: null }, 'https://radar.test')
    expect(m.texto).toContain('Torre: —')
    expect(m.texto).toContain('Orçamento: —')
    expect(m.texto).toContain('Data do pregão: —')
  })
})

describe('montarEmailTeste', () => {
  it('tem assunto fixo e link', () => {
    const m = montarEmailTeste('https://radar.test')
    expect(m.assunto).toBe('[Radar] E-mail de teste')
    expect(m.texto).toContain('https://radar.test')
  })
})
