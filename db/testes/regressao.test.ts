/**
 * Regressão do banco: regras de negócio e bugs já corrigidos, contra um Postgres criado do zero com as migrações.
 * Se uma migração futura quebrar uma regra daqui, este arquivo falha antes de chegar à produção.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, EDITOR, VISUALIZADOR, atualizar, camposComErro, criar, criarBanco, falha, migracoes, aplicarMigracao, opp, type Db } from './banco.ts'

let db: Db
beforeAll(async () => {
  db = await criarBanco()
}, 120_000)

const um = async <T = unknown>(sql: string, p: unknown[] = []) => (await db.query<Record<string, T>>(sql, p)).rows[0]

describe('migrações', () => {
  it('aplicam do zero, na ordem, e deixam as peças principais', async () => {
    const f = await db.query<{ proname: string }>(`select proname from pg_proc where proname in
      ('criar_oportunidade','atualizar_oportunidade','arquivar_oportunidade','sincronizar_planilha','salvar_usuario','salvar_opcao','salvar_email_config','enfileirar_email_teste','eh_admin','eh_somente_leitura','torre_da_linha','proximo_codigo')`)
    expect(new Set(f.rows.map((r) => r.proname)).size).toBe(12)
    const t = await db.query<{ tgname: string }>(`select tgname from pg_trigger where not tgisinternal and tgname like 'oportunidades_%'`)
    expect(t.rows.map((r) => r.tgname).sort()).toEqual(
      ['oportunidades_auditar_tg', 'oportunidades_codigo_tg', 'oportunidades_derivar_tg', 'oportunidades_email_tg', 'oportunidades_torre_tg'],
    )
  })
  it('reaplicar qualquer migração é inofensivo (idempotência)', async () => {
    for (const f of migracoes()) await aplicarMigracao(db, f)
    const c = await um<string>('select count(*)::text as n from email_config')
    expect(c.n).toBe('1')
  }, 60_000)
})

describe('código AAAA-NNNN', () => {
  it('numera por ano da data do pregão, em sequência, sem repetir', async () => {
    const a = await criar(db, opp({ data_pregao_dt: '2041-01-10' }))
    const b = await criar(db, opp({ data_pregao_dt: '2041-06-10' }))
    const c = await criar(db, opp({ data_pregao_dt: '2042-01-10' }))
    expect(a.codigo).toBe('2041-0001')
    expect(b.codigo).toBe('2041-0002')
    expect(c.codigo).toBe('2042-0001')
  })
  it('é imutável: editar a oportunidade (inclusive a data) não muda o código', async () => {
    const a = await criar(db, opp({ data_pregao_dt: '2043-02-01' }))
    const b = await atualizar(db, a.id, a.versao, opp({ data_pregao_dt: '2044-05-05', observacoes: 'x' }))
    expect(b.codigo).toBe(a.codigo)
  })
  it('o código não entra no histórico como edição do usuário', async () => {
    const a = await criar(db, opp({ data_pregao_dt: '2045-02-01' }))
    const h = await db.query<{ alteracoes: Record<string, unknown> }>('select alteracoes from oportunidades_historico where oportunidade_id = $1', [a.id])
    expect(h.rows.every((r) => !('codigo' in r.alteracoes))).toBe(true)
  })
})

describe('torre calculada pela linha de serviço', () => {
  it.each([
    ['Software Development', 'DIGITAL'],
    ['Lya Gov', 'HEALTH'],
    ['Linha qualquer', 'ITS'],
  ])('%s -> %s, mesmo que o cliente mande outra torre', async (linha, torre) => {
    await db.query(`insert into opcoes (lista, valor) values ('linha_servico', $1) on conflict do nothing`, [linha])
    const o = await criar(db, opp({ linha_servico: linha, torre: torre === 'HEALTH' ? 'ITS' : 'HEALTH' }))
    expect(o.torre).toBe(torre)
  })
})

describe('validação (espelho das regras de negócio)', () => {
  it('campos obrigatórios', async () => {
    const f = await falha(criar(db, { status: 'Go' }))
    expect(f?.code).toBe('P0422')
    expect(camposComErro(f)).toEqual(expect.arrayContaining(['data_pregao_dt', 'orgao', 'descritivo']))
  })
  it('status fora da lista é recusado', async () => {
    expect(camposComErro(await falha(criar(db, opp({ status: 'Inventado' }))))).toContain('status')
  })
  it('descritivo: até 50 caracteres ao criar ou alterar; registro antigo mais longo segue salvando se o texto não mudar', async () => {
    expect(String((await criar(db, opp({ descritivo: 'x'.repeat(50) }))).descritivo)).toHaveLength(50)
    expect(camposComErro(await falha(criar(db, opp({ descritivo: 'x'.repeat(51) }))))).toContain('descritivo')
    // Registro vindo da planilha (carga não passa pela validação) com descritivo longo:
    const velho = await criar(db, opp({ descritivo: 'curto' }))
    await db.query(`update oportunidades set descritivo = $1 where id = $2`, ['y'.repeat(900), velho.id])
    const lido = (await db.query<{ versao: number }>(`select versao from oportunidades where id = $1`, [velho.id])).rows[0]
    const ok = await atualizar(db, velho.id, lido.versao, opp({ descritivo: 'y'.repeat(900), observacoes: 'só isto' }))
    expect(String(ok.descritivo)).toHaveLength(900)
    expect(camposComErro(await falha(atualizar(db, velho.id, ok.versao, opp({ descritivo: 'z'.repeat(60) }))))).toContain('descritivo')
  })
  it('No Go exige motivo; Lost exige motivo; Win exige Valor CTC', async () => {
    expect(camposComErro(await falha(criar(db, opp({ status: 'No Go' }))))).toContain('motivo_no_go')
    expect(camposComErro(await falha(criar(db, opp({ status: 'Lost' }))))).toContain('motivo_lost')
    expect(camposComErro(await falha(criar(db, opp({ status: 'Win' }))))).toContain('valor_ctc')
    await db.query(`insert into opcoes (lista, valor) values ('motivo_no_go','Risco') on conflict do nothing`)
    expect((await criar(db, opp({ status: 'No Go', motivo_no_go: 'Risco' }))).status).toBe('No Go')
    expect((await criar(db, opp({ status: 'Win', valor_ctc: 1000 }))).status).toBe('Win')
  })
  it('orçamento sigiloso não tem valor; valores não são negativos', async () => {
    expect(camposComErro(await falha(criar(db, opp({ orcamento_sigiloso: true, orcamento: 10 }))))).toContain('orcamento')
    expect(camposComErro(await falha(criar(db, opp({ orcamento: -1 }))))).toContain('valores')
  })
  it('pregão não pode ser anterior à distribuição', async () => {
    expect(camposComErro(await falha(criar(db, opp({ data_distribuicao: '2026-05-01', data_pregao_dt: '2026-04-01' }))))).toContain('data_pregao_dt')
  })
  it('margens e impostos: faixas válidas', async () => {
    expect(camposComErro(await falha(criar(db, opp({ mc_ctc: 1.5 }))))).toContain('mc_ctc')
    expect(camposComErro(await falha(criar(db, opp({ simulacao_mc_arrematante: -2 }))))).toContain('simulacao_mc_arrematante')
    expect(camposComErro(await falha(criar(db, opp({ impostos: 1.01 }))))).toContain('impostos')
    expect(camposComErro(await falha(criar(db, opp({ impostos: -0.01 }))))).toContain('impostos')
  })
  it('impostos: guarda duas casas no percentual (fração com 4 casas) e aceita vazio', async () => {
    const a = await criar(db, opp({ impostos: 0.0865 }))
    expect(Number(a.impostos)).toBeCloseTo(0.0865, 6)
    const b = await criar(db, opp())
    expect(b.impostos).toBeNull()
    const r = await um<string>('select impostos::text as i from oportunidades where id = $1', [a.id])
    expect(r.i).toBe('0.0865')
  })
  it('CNPJ da empresa vencedora precisa ter 14 dígitos; sem CNPJ some razão social e tipo', async () => {
    expect(camposComErro(await falha(criar(db, opp({ empresa_vencedora_cnpj: '123' }))))).toContain('empresa_vencedora_cnpj')
    const o = await criar(db, opp({ empresa_vencedora_cnpj: null, empresa_vencedora_razao: 'LIXO', empresa_vencedora_tipo: 'Matriz' }))
    expect(o.empresa_vencedora_razao).toBeNull()
    const ok = await criar(db, opp({ empresa_vencedora_cnpj: '00000000000191', empresa_vencedora_razao: 'BANCO', empresa_vencedora_tipo: 'Matriz' }))
    expect(ok.empresa_vencedora_cnpj).toBe('00000000000191')
  })
  it('unidade de fornecimento é lista fechada', async () => {
    expect(camposComErro(await falha(criar(db, opp({ unidade_fornecimento: 'Inventada' }))))).toContain('unidade_fornecimento')
    expect((await criar(db, opp({ unidade_fornecimento: 'Serviço (valor fixo)' }))).unidade_fornecimento).toBe('Serviço (valor fixo)')
    expect(camposComErro(await falha(criar(db, opp({ unidade_fornecimento: 'Hora' }))))).toContain('unidade_fornecimento') // inativa
  })
  it('pré-vendas precisa estar na lista de pré-vendas ativos', async () => {
    expect(camposComErro(await falha(criar(db, opp({ analista: 'Fulano Qualquer' }))))).toContain('analista')
    expect((await criar(db, opp({ analista: 'Editor' }))).analista).toBe('Editor')
  })
  it('sigla: até 8 caracteres, opcional, em branco por padrão; some espaços das pontas', async () => {
    expect((await criar(db, opp({ sigla: ' IBGE ' }))).sigla).toBe('IBGE')
    expect((await criar(db, opp({ sigla: '12345678' }))).sigla).toBe('12345678')
    expect((await criar(db, opp())).sigla).toBeNull()
    expect(camposComErro(await falha(criar(db, opp({ sigla: '123456789' }))))).toContain('sigla')
    const a = await criar(db, opp({ sigla: 'ABC' }))
    expect((await atualizar(db, a.id, a.versao, opp({ sigla: 'XYZ' }))).sigla).toBe('XYZ')
  })
  it('aceita mais de um pré-vendas (separados por vírgula); um nome fora da lista recusa o conjunto', async () => {
    await db.exec("INSERT INTO usuarios (nome, email, admin, pre_vendas, ativo, somente_leitura) VALUES ('Segundo PV', 'segundo@x.test', false, true, true, false) ON CONFLICT (nome) DO NOTHING")
    expect((await criar(db, opp({ analista: 'Editor, Segundo PV' }))).analista).toBe('Editor, Segundo PV')
    expect(camposComErro(await falha(criar(db, opp({ analista: 'Editor, Fulano Qualquer' }))))).toContain('analista')
  })
})

describe('edição concorrente (versão otimista)', () => {
  it('editar com versão velha dá conflito P0409 com a versão atual', async () => {
    const a = await criar(db, opp())
    const b = await atualizar(db, a.id, a.versao, opp({ observacoes: 'primeira' }))
    expect(b.versao).toBe(a.versao + 1)
    const f = await falha(atualizar(db, a.id, a.versao, opp({ observacoes: 'segunda' })))
    expect(f?.code).toBe('P0409')
    expect(JSON.parse(f!.message).versao_atual).toBe(b.versao)
  })
  it('oportunidade inexistente ou arquivada: P0404', async () => {
    expect((await falha(atualizar(db, 999999, 1, opp())))?.code).toBe('P0404')
    const a = await criar(db, opp())
    await db.query('select arquivar_oportunidade($1::bigint, $2, false)', [a.id, ADMIN])
    expect((await falha(atualizar(db, a.id, a.versao, opp())))?.code).toBe('P0404')
  })
})

describe('perfis de acesso', () => {
  it('visualizador não cria nem edita; editor e administrador sim', async () => {
    expect((await falha(criar(db, opp(), VISUALIZADOR)))?.code).toBe('P0403')
    const a = await criar(db, opp(), EDITOR)
    expect((await falha(atualizar(db, a.id, a.versao, opp(), VISUALIZADOR)))?.code).toBe('P0403')
    expect((await atualizar(db, a.id, a.versao, opp({ observacoes: 'ok' }), ADMIN)).versao).toBe(a.versao + 1)
  })
  it('quem não está na lista de usuários trabalha como editor (comportamento padrão)', async () => {
    expect((await criar(db, opp(), 'novato@ctctech.com.br')).criado_por).toBe('novato@ctctech.com.br')
  })
  it('só administrador arquiva e restaura', async () => {
    const a = await criar(db, opp(), EDITOR)
    expect((await falha(db.query('select arquivar_oportunidade($1::bigint, $2, false)', [a.id, EDITOR])))?.code).toBe('P0403')
    const arq = await db.query<{ o: { arquivado_em: string | null } }>('select arquivar_oportunidade($1::bigint, $2, false) as o', [a.id, ADMIN])
    expect(arq.rows[0].o.arquivado_em).not.toBeNull()
    const res = await db.query<{ o: { arquivado_em: string | null } }>('select arquivar_oportunidade($1::bigint, $2, true) as o', [a.id, ADMIN])
    expect(res.rows[0].o.arquivado_em).toBeNull()
  })
  it('e-mail do usuário é tratado sem diferenciar maiúsculas', async () => {
    expect((await um<boolean>(`select eh_admin('ADMIN@CTCTECH.COM.BR') as v`)).v).toBe(true)
  })
})

describe('usuários', () => {
  it('só administrador gerencia usuários e listas', async () => {
    expect((await falha(db.query(`select salvar_usuario('X','x@x.com',false,false,true,$1,false)`, [EDITOR])))?.code).toBe('P0403')
    expect((await falha(db.query(`select salvar_opcao('status','Novo',true,1,$1)`, [EDITOR])))?.code).toBe('P0403')
  })
  it('administrador não pode ser somente leitura; visualizador exige e-mail', async () => {
    expect((await falha(db.query(`select salvar_usuario('Y','y@x.com',true,false,true,$1,true)`, [ADMIN])))?.code).toBe('P0422')
    expect((await falha(db.query(`select salvar_usuario('Z',null,false,false,true,$1,true)`, [ADMIN])))?.code).toBe('P0422')
  })
  it('o administrador não rebaixa nem desativa a si mesmo (e o sistema nunca fica sem administrador)', async () => {
    expect((await falha(db.query(`select salvar_usuario('Admin',$1,false,false,true,$1,false)`, [ADMIN])))?.code).toBe('P0422')
    expect((await falha(db.query(`select salvar_usuario('Admin',$1,true,false,false,$1,false)`, [ADMIN])))?.code).toBe('P0422')
  })
})

describe('histórico (auditoria)', () => {
  it('registra criação e edição com quem e o que mudou', async () => {
    const a = await criar(db, opp({ orgao: 'Antes' }), EDITOR)
    await atualizar(db, a.id, a.versao, opp({ orgao: 'Depois' }), EDITOR)
    const h = await db.query<{ acao: string; por: string; alteracoes: Record<string, [unknown, unknown]> }>(
      'select acao, por, alteracoes from oportunidades_historico where oportunidade_id = $1 order by id', [a.id])
    expect(h.rows.map((r) => r.acao)).toEqual(['criou', 'editou'])
    expect(h.rows[1].por).toBe(EDITOR)
    expect(h.rows[1].alteracoes.orgao).toEqual(['Antes', 'Depois'])
  })
  it('arquivar aparece como "arquivou" e restaurar como "restaurou"', async () => {
    const a = await criar(db, opp())
    await db.query('select arquivar_oportunidade($1::bigint, $2, false)', [a.id, ADMIN])
    await db.query('select arquivar_oportunidade($1::bigint, $2, true)', [a.id, ADMIN])
    const h = await db.query<{ acao: string }>('select acao from oportunidades_historico where oportunidade_id = $1 order by id', [a.id])
    expect(h.rows.map((r) => r.acao)).toEqual(['criou', 'arquivou', 'restaurou'])
  })
})

describe('carga da planilha (merge)', () => {
  const linha = (chave: string, extra: Record<string, unknown> = {}) => ({
    chave_planilha: chave, status: 'Go', orgao: `Planilha ${chave}`, descritivo: 'x', torre: 'ITS', data_pregao_dt: '2026-04-01', ...extra,
  })
  const sync = async (rows: unknown[]) =>
    (await db.query<{ r: Record<string, number> }>(`select sincronizar_planilha($1::jsonb, 'teste', false) as r`, [JSON.stringify(rows)])).rows[0].r

  it('insere, é idempotente e marca como ausente o que sumiu (sem apagar)', async () => {
    const r1 = await sync([linha('s1'), linha('s2')])
    expect(r1).toMatchObject({ inseridas: 2, atualizadas: 0 })
    const r2 = await sync([linha('s1'), linha('s2')])
    expect(r2).toMatchObject({ inseridas: 0, atualizadas: 0 })
    const r3 = await sync([linha('s1')])
    expect(r3.marcadas_ausentes).toBe(1)
    expect((await um<boolean>(`select ausente_na_planilha as a from oportunidades where chave_planilha = 's2'`)).a).toBe(true)
    await sync([linha('s1'), linha('s2')])
    expect((await um<boolean>(`select ausente_na_planilha as a from oportunidades where chave_planilha = 's2'`)).a).toBe(false)
  })
  it('nunca sobrescreve o que foi editado na web', async () => {
    await sync([linha('web1', { orgao: 'Original' })])
    const o = await um<number>(`select id, versao from oportunidades where chave_planilha = 'web1'`)
    await atualizar(db, o.id as number, o.versao as number, opp({ orgao: 'Editado na web' }))
    const r = await sync([linha('web1', { orgao: 'Mudou na planilha' })])
    expect(r.protegidas_edicao_web).toBeGreaterThanOrEqual(1)
    expect((await um<string>(`select orgao from oportunidades where chave_planilha = 'web1'`)).orgao).toBe('Editado na web')
  })
  it('recusa entrada vazia e linha sem chave', async () => {
    expect(await falha(db.query(`select sincronizar_planilha('[]'::jsonb, 'x', false)`))).not.toBeNull()
    expect(await falha(db.query(`select sincronizar_planilha('[{"orgao":"sem chave"}]'::jsonb, 'x', false)`))).not.toBeNull()
  })
  it('a carga antiga que apagava tudo está revogada do escritor (migração 002)', async () => {
    const r = await um<boolean>(`select has_function_privilege('radar_escritor', 'carregar_oportunidades(jsonb,text)', 'EXECUTE') as v`)
    expect(r.v).toBe(false)
  })
  it('a carga não mexe no campo Impostos', async () => {
    await sync([linha('imp1')])
    await db.query(`update oportunidades set impostos = 0.1 where chave_planilha = 'imp1'`)
    await sync([linha('imp1', { orgao: 'Outro nome' })])
    expect((await um<string>(`select impostos::text as i from oportunidades where chave_planilha = 'imp1'`)).i).toBe('0.1000')
  })
})

describe('e-mail de nova oportunidade', () => {
  const config = (ativo: boolean, status: string[], dest: unknown[] = [{ email: 'a@x.com' }], avisar = false) =>
    db.query('select salvar_email_config($1, $2::text[], $3::jsonb, $4, $5)', [ativo, status, JSON.stringify(dest), ADMIN, avisar])
  const naFila = async (id: number) => Number((await um<string>(`select count(*)::text as n from email_fila where oportunidade_id = $1`, [id])).n)

  it('nasce desligado e vazio', async () => {
    const fresco = await criarBanco()
    const c = await fresco.query<{ ativo: boolean; status_gatilho: string[] }>('select ativo, status_gatilho from email_config')
    expect(c.rows[0]).toMatchObject({ ativo: false, status_gatilho: [] })
    const o = await criar(fresco, opp())
    expect(Number((await fresco.query<{ n: string }>('select count(*)::text as n from email_fila')).rows[0].n)).toBe(0)
    expect(o.id).toBeGreaterThan(0)
  }, 60_000)
  it('só entra na fila: web + ligado + status marcado', async () => {
    await config(true, ['Go'])
    expect(await naFila((await criar(db, opp({ status: 'Go' }))).id)).toBe(1)
    expect(await naFila((await criar(db, opp({ status: 'Prospect' }))).id)).toBe(0)
    await config(false, ['Go'])
    expect(await naFila((await criar(db, opp({ status: 'Go' }))).id)).toBe(0)
  })
  it('editar não gera novo pedido; carga da planilha nunca enfileira', async () => {
    await config(true, ['Go'])
    const a = await criar(db, opp({ status: 'Go' }))
    await atualizar(db, a.id, a.versao, opp({ observacoes: 'edit' }))
    expect(await naFila(a.id)).toBe(1)
    await db.query(`select sincronizar_planilha('[{"chave_planilha":"em1","status":"Go","orgao":"P","descritivo":"x","torre":"ITS","data_pregao_dt":"2026-04-01"}]'::jsonb,'t',false)`)
    const p = await um<number>(`select id from oportunidades where chave_planilha = 'em1'`)
    expect(await naFila(p.id as number)).toBe(0)
  })
  it('regras de configuração: só administrador, status da lista, e-mails válidos, mínimos para ligar', async () => {
    expect((await falha(db.query(`select salvar_email_config(false, '{}', '[]', $1, false)`, [EDITOR])))?.code).toBe('P0403')
    expect((await falha(config(true, ['Inventado'])))?.code).toBe('P0422')
    expect((await falha(config(true, ['Go'], [{ email: 'invalido' }])))?.code).toBe('P0422')
    expect((await falha(config(true, [])))?.code).toBe('P0422')
    expect((await falha(config(true, ['Go'], [])))?.code).toBe('P0422')
    expect(await falha(config(true, ['Go'], [], true))).toBeNull() // com aviso ao pré-vendas a lista pode ficar vazia
  })
  it('e-mails são normalizados e sem duplicidade', async () => {
    await config(false, [], [{ email: ' Dup@X.com ' }, { email: 'dup@x.com', tipo: 'cc' }])
    expect((await um<string>('select count(*)::text as n from email_destinatarios')).n).toBe('1')
  })
  it('e-mail de teste: só administrador e sem repetir enquanto houver um aguardando', async () => {
    expect((await falha(db.query('select enfileirar_email_teste($1)', [EDITOR])))?.code).toBe('P0403')
    await db.query('select enfileirar_email_teste($1)', [ADMIN])
    expect((await falha(db.query('select enfileirar_email_teste($1)', [ADMIN])))?.code).toBe('P0422')
  })
  it('falha no gatilho de e-mail nunca derruba o cadastro', async () => {
    await config(true, ['Go'])
    await db.exec(`ALTER TABLE email_fila ADD CONSTRAINT trava_teste CHECK (false) NOT VALID`)
    try {
      const o = await criar(db, opp({ status: 'Go' }))
      expect(o.id).toBeGreaterThan(0)
    } finally {
      await db.exec('ALTER TABLE email_fila DROP CONSTRAINT trava_teste')
    }
  })
})

describe('objeto e hora do pregão', () => {
  it('guardam e devolvem; em branco ficam nulos (nada muda para quem não preencher)', async () => {
    const com = await criar(db, opp({ objeto: 'Link dedicado de 1 Gbps', hora_pregao: '15:30' }))
    expect(com).toMatchObject({ objeto: 'Link dedicado de 1 Gbps', hora_pregao: '15:30:00' })
    const sem = await criar(db, opp())
    expect(sem.objeto).toBeNull()
    expect(sem.hora_pregao).toBeNull()
  })
  it('a data continua sendo a data (código por ano e SLA intactos) e a hora é só um complemento', async () => {
    const o = await criar(db, opp({ data_pregao_dt: '2061-02-03', hora_pregao: '23:59' }))
    expect(o.codigo).toMatch(/^2061-/)
    expect(o.data_pregao).toBe('03/02/2061')
    expect(o.hora_pregao).toBe('23:59:00')
  })
  it('hora inválida é recusada pelo banco (formato inválido) e 00:00 vale', async () => {
    const f = await falha(criar(db, opp({ hora_pregao: '25:00' })))
    expect(f?.code).toBe('22008') // hora fora da faixa; a API traduz este código em 422
    expect((await falha(criar(db, opp({ hora_pregao: 'abc' }))))?.code).toBe('22007') // formato inválido; idem
    expect((await criar(db, opp({ hora_pregao: '00:00' }))).hora_pregao).toBe('00:00:00')
  })
  it('objeto acima de 5000 caracteres é recusado, apontando o campo', async () => {
    expect(camposComErro(await falha(criar(db, opp({ objeto: 'x'.repeat(5001) }))))).toContain('objeto')
    expect((await criar(db, opp({ objeto: 'x'.repeat(5000) }))).objeto).toHaveLength(5000)
  })
  it('editar registra no histórico (de → para) e sem mexer mantém o valor', async () => {
    const a = await criar(db, opp({ objeto: 'Antes', hora_pregao: '09:00' }))
    const b = await atualizar(db, a.id, a.versao, opp({ objeto: 'Depois', hora_pregao: '10:15' }))
    expect(b).toMatchObject({ objeto: 'Depois', hora_pregao: '10:15:00' })
    const h = await db.query<{ alteracoes: Record<string, [unknown, unknown]> }>(`select alteracoes from oportunidades_historico where oportunidade_id = $1 and acao = 'editou'`, [a.id])
    expect(h.rows[0].alteracoes.objeto).toEqual(['Antes', 'Depois'])
    expect(h.rows[0].alteracoes.hora_pregao).toEqual(['09:00:00', '10:15:00'])
    const c = await atualizar(db, b.id, b.versao, opp({ objeto: 'Depois', hora_pregao: '10:15', observacoes: 'só isto' }))
    expect(c).toMatchObject({ objeto: 'Depois', hora_pregao: '10:15:00' })
  })
  it('o que vem da planilha fica em branco e a carga por merge NÃO apaga o que alguém preencheu depois', async () => {
    const linha = (extra: Record<string, unknown> = {}) => ({ chave_planilha: 'obj-1', status: 'Go', orgao: 'Da planilha', descritivo: 'x', torre: 'ITS', data_pregao_dt: '2026-04-01', ...extra })
    const sync = (rows: unknown[]) => db.query(`select sincronizar_planilha($1::jsonb, 't', false)`, [JSON.stringify(rows)])
    const ler = async () => (await db.query<{ objeto: string | null; hora_pregao: string | null }>(`select objeto, hora_pregao from oportunidades where chave_planilha = 'obj-1'`)).rows[0]
    await sync([linha()])
    expect(await ler()).toEqual({ objeto: null, hora_pregao: null })
    await db.query(`update oportunidades set objeto = 'Preenchido', hora_pregao = '10:00' where chave_planilha = 'obj-1'`)
    await sync([linha({ orgao: 'Mudou na planilha' })])
    expect(await ler()).toEqual({ objeto: 'Preenchido', hora_pregao: '10:00:00' })
    expect((await db.query<{ orgao: string }>(`select orgao from oportunidades where chave_planilha = 'obj-1'`)).rows[0].orgao).toBe('Mudou na planilha') // a carga seguiu atualizando o resto
  })
})