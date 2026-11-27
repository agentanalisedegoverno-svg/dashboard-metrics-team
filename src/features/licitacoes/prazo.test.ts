import { describe, expect, it } from 'vitest'
import { corDoPrazo, diasUteisAte, ehDiaUtil, feriadosDoAno } from './prazo'

const iso = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))

describe('dias úteis até o pregão', () => {
  it('Páscoa e os feriados móveis de 2026 e 2027 batem com o calendário oficial', () => {
    const f26 = feriadosDoAno(2026)
    for (const d of ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04']) expect(f26.has(iso(d)), d).toBe(true) // Carnaval seg/ter, Sexta Santa, Corpus Christi
    const f27 = feriadosDoAno(2027)
    for (const d of ['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27']) expect(f27.has(iso(d)), d).toBe(true)
  })

  it('feriados nacionais fixos, inclusive 20/11 (Consciência Negra)', () => {
    for (const d of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25']) expect(ehDiaUtil(iso(d)), d).toBe(false)
    expect(ehDiaUtil(iso('2026-11-23'))).toBe(true)
  })

  it('fim de semana não é dia útil', () => {
    expect(ehDiaUtil(iso('2026-10-31'))).toBe(false) // sábado
    expect(ehDiaUtil(iso('2026-11-01'))).toBe(false) // domingo
    expect(ehDiaUtil(iso('2026-10-30'))).toBe(true) // sexta
  })

  it('conta de amanhã até o pregão (hoje não conta; o dia do pregão conta se for útil)', () => {
    const quinta = new Date(2026, 9, 29, 23, 59)
    expect(diasUteisAte('2026-10-30', quinta)).toBe(1)
    expect(diasUteisAte('2026-11-03', quinta)).toBe(2) // sáb, dom e 02/11 (Finados) não contam
    expect(diasUteisAte('2026-11-06', quinta)).toBe(5)
    expect(diasUteisAte('2026-11-09', quinta)).toBe(6)
  })

  it('hoje, passado e data inválida', () => {
    const hoje = new Date(2026, 9, 29, 8, 0)
    expect(diasUteisAte('2026-10-29', hoje)).toBe(0)
    expect(diasUteisAte('2026-10-20', hoje)).toBe(0)
    expect(diasUteisAte(null, hoje)).toBeNull()
    expect(diasUteisAte('29/10/2026', hoje)).toBeNull()
    expect(diasUteisAte('2026-11-04T09:30:00', hoje)).toBe(3) // hora no texto não muda o dia
  })

  it('travessia de ano e data muito distante não travam', () => {
    expect(diasUteisAte('2027-01-05', new Date(2026, 11, 28))).toBe(5) // 29, 30, 31 (úteis), 01/01 feriado, 04, 05
    expect(diasUteisAte('2099-01-01', new Date(2026, 9, 29))).toBeGreaterThan(366)
  })

  it('cores: vermelho até 3, amarelo até 5, sem cor acima disso ou sem data', () => {
    expect([0, 1, 3].map(corDoPrazo)).toEqual(['vermelho', 'vermelho', 'vermelho'])
    expect([4, 5].map(corDoPrazo)).toEqual(['amarelo', 'amarelo'])
    expect([6, 20, null].map(corDoPrazo)).toEqual([null, null, null])
  })
})
