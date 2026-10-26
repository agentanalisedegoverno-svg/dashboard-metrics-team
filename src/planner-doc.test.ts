/**
 * A documentação da regra de atualização no Planner (docs/INTEGRACAO-PLANNER.md) não pode divergir do que roda:
 * a tabela status -> bucket/progresso precisa bater com config/planner-mapa.json, e a página precisa trazer as partes
 * que o time consulta (princípios, campos, cenários, exemplo, erros, testes).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type Plano = { nome: string; buckets: Record<string, string> }
const mapa = JSON.parse(readFileSync('config/planner-mapa.json', 'utf8')) as { planos: Record<string, Plano>; progresso: Record<string, number> }
const doc = readFileSync('docs/INTEGRACAO-PLANNER.md', 'utf8').replace(/\r/g, '')

const secao = (titulo: string) => {
  const ini = doc.indexOf(`\n## ${titulo}`)
  expect(ini, `seção "${titulo}" não encontrada`).toBeGreaterThan(-1)
  const resto = doc.slice(ini + 1)
  const fim = resto.indexOf('\n## ', 3)
  return fim === -1 ? resto : resto.slice(0, fim)
}

describe('docs/INTEGRACAO-PLANNER.md', () => {
  it('a tabela status → bucket bate com config/planner-mapa.json (colunas e progresso)', () => {
    const linhas = secao('Mapeamento status → bucket')
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|\s*(Radar|---)/.test(l))
      .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    expect(linhas.length).toBeGreaterThanOrEqual(9)
    const [its, dh] = [mapa.planos.its, mapa.planos.digital_health]
    for (const [radar, bucketIts, bucketDh, progresso] of linhas) {
      const status = radar.startsWith('Validar') ? 'Validar' : radar
      expect(bucketIts, `${radar}: bucket ITS`).toBe(its.buckets[status])
      expect(bucketDh, `${radar}: bucket Digital e Health`).toBe(dh.buckets[status])
      expect(progresso, `${radar}: progresso`).toBe(`${mapa.progresso[status]}%`)
    }
    // todo status do mapa aparece na tabela
    const statusDoc = new Set(linhas.map((l) => (l[0].startsWith('Validar') ? 'Validar' : l[0])))
    for (const s of Object.keys(its.buckets).filter((k) => k !== '_sem_status')) expect(statusDoc.has(s), `status ${s} falta na tabela`).toBe(true)
  })

  it('traz a regra de atualização completa: princípios, quando envia, cada campo, cenários, exemplo, erros, testes e como mudar', () => {
    const s = secao('Regra de atualização: o que acontece no cartão')
    for (const trecho of [
      '### Os cinco princípios',
      '### O caminho, em um desenho',
      '### 1. Quando o Radar envia uma atualização',
      '### 2. O que acontece em cada campo do cartão',
      '### 3. O que acontece quando...',
      '### 4. Exemplo de ponta a ponta',
      '### 5. Quando algo dá errado',
      '### 6. Onde a regra está implementada e como é testada',
      '### 7. Como mudar a regra',
    ]) expect(s, trecho).toContain(trecho)
    expect(s).toMatch(/```mermaid\nflowchart TB/)
  })

  it('cita os quatro campos sobrescritos e os três acrescentados, os que o código realmente trata', () => {
    const s = secao('Regra de atualização: o que acontece no cartão')
    for (const campo of ['Título', 'Coluna (bucket)', 'Progresso', 'Prazo', 'Rótulos', 'Responsáveis', 'Anotações', 'Checklist']) expect(s, campo).toContain(`**${campo}**`)
    // o código: planner_auto.py sobrescreve exatamente estes campos na atualização
    const py = readFileSync('planner-auto/planner_auto.py', 'utf8')
    expect(py).toMatch(/corpo = \{"title": p\["titulo"\], "bucketId": p\["bucket_id"\], "percentComplete": p\["progresso"\]\}/)
  })

  it('cada limitação conhecida da regra tem teste que a descreve (o Python documenta o comportamento atual)', () => {
    const py = readFileSync('planner-auto/tests/test_planner_auto.py', 'utf8')
    for (const t of [
      'test_mudar_a_torre_cria_cartao_no_outro_plano_e_o_antigo_fica',
      'test_tirar_o_codigo_do_titulo_faz_o_integrador_nao_achar_o_cartao_e_criar_outro',
      'test_cartao_apagado_no_planner_e_recriado_na_proxima_atualizacao_sem_checklist',
      'test_anotacoes_passam_do_limite_de_30000_caracteres_e_o_fim_e_cortado',
      'test_o_que_o_time_mexeu_a_mao_em_bucket_e_progresso_e_refeito_na_proxima_atualizacao',
    ]) expect(py, t).toContain(`def ${t}`)
    const lim = secao('Limitações conhecidas (comportamento atual)')
    for (const c of ['Mudar a torre', 'Arquivar', 'Apagar o cartão', '`[código]` do título', '`erros\\`', 'Anotações']) expect(lim, c).toContain(c)
  })
})
