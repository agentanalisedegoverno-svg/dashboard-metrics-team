/**
 * O envio de e-mail pode rodar em dois lugares ao mesmo tempo (a rotina de 5 em 5 minutos da máquina do time e o GitHub
 * Actions). Com o SQL de verdade, dois processadores simultâneos nunca enviam o mesmo pedido duas vezes.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from '../../functions/_lib/cadastro.ts'
import { processarFila, type Envio } from '../../functions/_lib/emailFila.ts'
import { ADMIN, criar, criarBanco, opp, type Db } from './banco.ts'

const sqlDe = (db: Db): Sql => (async (strings: TemplateStringsArray, ...valores: unknown[]) => {
  const texto = strings.reduce((a, s, i) => a + s + (i < valores.length ? `$${i + 1}` : ''), '')
  return (await db.query(texto, valores)).rows
}) as unknown as Sql

let db: Db
beforeAll(async () => {
  db = await criarBanco()
  await db.query(`select salvar_email_config(true, ARRAY['Go'], '[{"email":"time@ctctech.com.br"}]'::jsonb, $1, false)`, [ADMIN])
}, 120_000)

describe('envio de e-mail em dois processos ao mesmo tempo', () => {
  it('cada pedido sai UMA vez, mesmo com dois processadores disputando a mesma fila', async () => {
    for (let i = 0; i < 6; i++) await criar(db, opp({ orgao: `Órgão ${i}`, status: 'Go' }))
    const enviados: Envio[] = []
    const enviar = async (e: Envio) => {
      await new Promise((r) => setImmediate(r)) // cede o turno: o outro processador avança no meio do envio
      enviados.push(e)
    }
    const [a, b] = await Promise.all([processarFila(sqlDe(db), enviar, { url: 'u' }), processarFila(sqlDe(db), enviar, { url: 'u' })])

    expect(enviados).toHaveLength(6)
    expect(new Set(enviados.map((e) => e.assunto)).size).toBe(6) // nenhum assunto (um por oportunidade) repetido
    expect(a.enviados + b.enviados).toBe(6)
    expect(a.emOutroProcesso + b.emOutroProcesso).toBeGreaterThan(0) // houve disputa de verdade
    const estado = await db.query<{ situacao: string; tentativas: number }>(`select situacao, tentativas from email_fila`)
    expect(estado.rows.every((r) => r.situacao === 'enviado' && r.tentativas === 1)).toBe(true)
  })

  it('o pedido que falhou volta para a fila e o outro processador não o pega enquanto a tentativa não for contada', async () => {
    await criar(db, opp({ orgao: 'Vai falhar', status: 'Go' }))
    let n = 0
    const falhaUmaVez = async () => {
      if (++n === 1) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    }
    const r1 = await processarFila(sqlDe(db), falhaUmaVez, { url: 'u' })
    expect(r1.novaTentativa).toBe(1)
    const r2 = await processarFila(sqlDe(db), falhaUmaVez, { url: 'u' })
    expect(r2.enviados).toBe(1)
    const linha = await db.query<{ situacao: string; tentativas: number }>(`select situacao, tentativas from email_fila order by id desc limit 1`)
    expect(linha.rows[0]).toEqual({ situacao: 'enviado', tentativas: 2 })
  })
})
