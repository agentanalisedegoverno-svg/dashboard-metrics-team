/**
 * Segurança do banco. Os papéis (radar_*) têm credenciais que vivem em segredos do GitHub, no Cloudflare e na máquina
 * da carga: se uma vazar, o estrago precisa ficar limitado ao que aquele papel deveria poder fazer.
 * Estes testes fixam, com privilégios reais do Postgres, o que cada papel pode e não pode.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN, EDITOR, como, criar, criarBanco, falha, opp, type Db } from './banco.ts'

let db: Db
beforeAll(async () => {
  db = await criarBanco()
}, 120_000)

const PAPEIS = ['radar_leitor', 'radar_escritor', 'radar_app', 'radar_planner', 'radar_email'] as const
const TABELAS = [
  'oportunidades', 'oportunidades_historico', 'opcoes', 'usuarios', 'carga_status', 'linhas_torre', 'codigo_sequencia',
  'planner_marco', 'planner_exportacao', 'planner_auto_estado', 'email_config', 'email_destinatarios', 'email_fila', 'api_clientes', 'api_idempotencia',
  'monitor_licitacoes', 'monitor_licitacoes_coletas', 'monitor_licitacoes_snapshots', 'monitor_licitacoes_eventos', 'monitor_licitacoes_alertas', 'monitor_licitacoes_auditoria',
] as const

/** Tabelas do monitor de licitações (migração 021): a API do cadastro (radar_app) lê e grava; o painel (radar_leitor) só lê. */
const MONITOR = ['monitor_licitacoes', 'monitor_licitacoes_coletas', 'monitor_licitacoes_snapshots', 'monitor_licitacoes_eventos', 'monitor_licitacoes_alertas']
const monitor = (acoes: string[]) => Object.fromEntries(MONITOR.map((t) => [t, acoes]))
const ACOES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const

/** Privilégios de TABELA permitidos por papel (tudo que não está aqui é proibido). */
const TABELA_PERMITIDA: Record<string, Record<string, string[]>> = {
  radar_leitor: {
    oportunidades: ['SELECT'], carga_status: ['SELECT'], opcoes: ['SELECT'], usuarios: ['SELECT'], linhas_torre: ['SELECT'], ...monitor(['SELECT']), monitor_licitacoes_auditoria: ['SELECT'],
  },
  radar_escritor: {},
  radar_app: {
    // ATENÇÃO: a migração 021 (monitor de licitações) deu INSERT direto em oportunidades_historico e escrita nas tabelas do monitor ao radar_app.
    // O INSERT no histórico permite à aplicação gravar linhas de auditoria (antes só o gatilho gravava): revisar se é mesmo necessário.
    oportunidades: ['SELECT'], oportunidades_historico: ['SELECT', 'INSERT'], opcoes: ['SELECT'], usuarios: ['SELECT'], carga_status: ['SELECT'],
    linhas_torre: ['SELECT'], email_config: ['SELECT'], email_destinatarios: ['SELECT'], email_fila: ['SELECT'], ...monitor(['SELECT', 'INSERT', 'UPDATE']), monitor_licitacoes_auditoria: ['SELECT', 'INSERT'],
  },
  radar_planner: {
    oportunidades: ['SELECT'], usuarios: ['SELECT'], planner_marco: ['SELECT', 'UPDATE'], planner_exportacao: ['SELECT', 'INSERT', 'UPDATE'],
    planner_auto_estado: ['SELECT', 'INSERT', 'UPDATE'],
  },
  radar_email: {
    oportunidades: ['SELECT'], email_config: ['SELECT'], email_destinatarios: ['SELECT'], email_fila: ['SELECT', 'UPDATE'],
  },
}

describe('privilégios de tabela por papel (matriz completa)', () => {
  for (const papel of PAPEIS) {
    it(`${papel}: exatamente o que deve, nada além`, async () => {
      const obtido: Record<string, string[]> = {}
      for (const t of TABELAS) {
        const acoes: string[] = []
        for (const a of ACOES) {
          const r = await db.query<{ v: boolean }>('select has_table_privilege($1, $2, $3) as v', [papel, t, a])
          if (r.rows[0].v) acoes.push(a)
        }
        if (acoes.length) obtido[t] = acoes
      }
      expect(obtido).toEqual(TABELA_PERMITIDA[papel])
    })
  }
  it('nenhum papel da aplicação apaga ou trunca nada, em nenhuma tabela', async () => {
    for (const papel of PAPEIS) {
      for (const t of TABELAS) {
        for (const a of ['DELETE', 'TRUNCATE']) {
          const r = await db.query<{ v: boolean }>('select has_table_privilege($1, $2, $3) as v', [papel, t, a])
          expect(r.rows[0].v, `${papel} ${a} ${t}`).toBe(false)
        }
      }
    }
  })
  it('radar_email lê só nome, e-mail e ativo dos usuários (não vê quem é administrador)', async () => {
    const col = async (c: string) => (await db.query<{ v: boolean }>(`select has_column_privilege('radar_email', 'usuarios', $1, 'SELECT') as v`, [c])).rows[0].v
    expect([await col('nome'), await col('email'), await col('ativo')]).toEqual([true, true, true])
    expect([await col('admin'), await col('somente_leitura'), await col('pre_vendas')]).toEqual([false, false, false])
  })
  it('o esquema public não aceita criação de objetos por qualquer um', async () => {
    const r = await db.query<{ v: boolean }>(`select has_schema_privilege('public', 'public', 'CREATE') as v`)
    expect(r.rows[0].v).toBe(false)
  })
})

/** Quem pode executar cada função (nome sem argumentos). 'PUBLIC' = qualquer papel, aceitável só para funções inofensivas. */
const FUNCAO_PERMITIDA: Record<string, string[] | 'PUBLIC'> = {
  criar_oportunidade: ['radar_app'],
  atualizar_oportunidade: ['radar_app'],
  arquivar_oportunidade: ['radar_app'],
  salvar_opcao: ['radar_app'],
  salvar_linha_torre: ['radar_app'],
  salvar_usuario: ['radar_app'],
  salvar_email_config: ['radar_app'],
  enfileirar_email_teste: ['radar_app'],
  autenticar_api_cliente: ['radar_app'],
  criar_oportunidade_api: ['radar_app'],
  simular_oportunidade_api: ['radar_app'],
  listar_api_clientes: ['radar_app'],
  criar_api_cliente: ['radar_app'],
  revogar_api_cliente: ['radar_app'],
  eh_admin: ['radar_app'],
  eh_somente_leitura: [],
  proximo_codigo: [],
  carregar_oportunidades: [],
  validar_oportunidade: [],
  _lista_ok: [],
  sincronizar_planilha: ['radar_escritor'],
  torre_da_linha: 'PUBLIC', // só traduz linha -> torre
  _carga_total_permitida: 'PUBLIC', // só levanta erro; sem efeito
}

describe('execução de funções', () => {
  it('cada função só é executável por quem deve (funções que aceitam a identidade como parâmetro nunca por PUBLIC)', async () => {
    const r = await db.query<{ nome: string; assinatura: string; publico: boolean }>(`
      select p.proname as nome, p.oid::regprocedure::text as assinatura, has_function_privilege('public', p.oid, 'EXECUTE') as publico
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype order by 1, 2`)
    const desconhecidas = r.rows.filter((f) => !(f.nome in FUNCAO_PERMITIDA)).map((f) => f.assinatura)
    expect(desconhecidas, 'função nova sem política de execução definida neste teste').toEqual([])
    const erros: string[] = []
    for (const f of r.rows) {
      const regra = FUNCAO_PERMITIDA[f.nome]
      if (regra === 'PUBLIC') continue
      if (f.publico) {
        erros.push(`${f.assinatura} é executável por PUBLIC (qualquer papel de banco poderia chamá-la)`)
        continue
      }
      const com: string[] = []
      for (const papel of PAPEIS) {
        const v = await db.query<{ v: boolean }>('select has_function_privilege($1, $2::regprocedure, $3) as v', [papel, f.assinatura, 'EXECUTE'])
        if (v.rows[0].v) com.push(papel)
      }
      if (JSON.stringify(com) !== JSON.stringify([...regra].sort((a, b) => PAPEIS.indexOf(a as never) - PAPEIS.indexOf(b as never)))) {
        erros.push(`${f.assinatura}: executável por [${com.join(', ')}], esperado [${regra.join(', ')}]`)
      }
    }
    expect(erros).toEqual([])
  })

  it('toda função SECURITY DEFINER fixa o search_path (impede sequestro de objetos por outro esquema)', async () => {
    const r = await db.query<{ assinatura: string }>(`
      select p.oid::regprocedure::text as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path%', false)`)
    expect(r.rows.map((x) => x.assinatura)).toEqual([])
  })
})

describe('papéis em ação (privilégios reais)', () => {
  it('a aplicação (radar_app) cadastra pelas funções, mas não escreve direto nas tabelas', async () => {
    const o = await como(db, 'radar_app', () => criar(db, opp({ orgao: 'via função' }), EDITOR))
    expect(o.id).toBeGreaterThan(0)
    for (const sql of [
      `insert into oportunidades (status, orgao, descritivo, torre) values ('Go','x','x','ITS')`,
      `update oportunidades set orgao = 'hack'`,
      `delete from oportunidades`,
      `update usuarios set admin = true`,
      `delete from oportunidades_historico`,
      `update email_config set ativo = true`,
      `insert into email_destinatarios (email) values ('x@x.com')`,
    ]) {
      const f = await como(db, 'radar_app', () => falha(db.query(sql)))
      expect(f?.message, sql).toMatch(/permission denied/i)
    }
  })

  it('o papel de leitura (usado pelo painel) só lê: sem e-mail, sem histórico, sem escrita', async () => {
    for (const sql of [`select * from email_config`, `select * from email_fila`, `select * from oportunidades_historico`, `update oportunidades set orgao = 'x'`]) {
      const f = await como(db, 'radar_leitor', () => falha(db.query(sql)))
      expect(f?.message, sql).toMatch(/permission denied/i)
    }
    const ok = await como(db, 'radar_leitor', () => db.query('select count(*)::int as n from oportunidades'))
    expect(ok.rows[0]).toBeTruthy()
  })

  it('o papel de envio de e-mail só atualiza a fila e não consegue alterar oportunidades, usuários nem regras', async () => {
    await db.query(`select salvar_email_config(true, ARRAY['Go'], '[{"email":"a@x.com"}]'::jsonb, $1, false)`, [ADMIN])
    await criar(db, opp({ status: 'Go' }))
    const fila = await como(db, 'radar_email', () => db.query<{ id: number }>('select id from email_fila limit 1'))
    expect(fila.rows.length).toBe(1)
    await como(db, 'radar_email', () => db.query(`update email_fila set situacao = 'enviado' where id = $1`, [fila.rows[0].id]))
    for (const sql of [
      `update oportunidades set orgao = 'x'`, `delete from email_fila`, `insert into email_fila (tipo, destino_teste) values ('teste','x@x.com')`,
      `update email_config set ativo = false`, `update usuarios set admin = true`, `select admin from usuarios`,
    ]) {
      const f = await como(db, 'radar_email', () => falha(db.query(sql)))
      expect(f?.message, sql).toMatch(/permission denied/i)
    }
  })

  it('a carga (radar_escritor) só executa o merge: nem lê tabelas, nem usa a carga total antiga', async () => {
    for (const sql of [`select * from oportunidades`, `select carregar_oportunidades('[{"orgao":"x"}]'::jsonb, 'x')`, `delete from oportunidades`]) {
      const f = await como(db, 'radar_escritor', () => falha(db.query(sql)))
      expect(f?.message, sql).toMatch(/permission denied/i)
    }
    const ok = await como(db, 'radar_escritor', () =>
      db.query(`select sincronizar_planilha('[{"chave_planilha":"seg1","status":"Go","orgao":"x","descritivo":"x","torre":"ITS","data_pregao_dt":"2026-04-01"}]'::jsonb, 't', false)`))
    expect(ok.rows.length).toBe(1)
  })

  it('escalonamento: nenhum papel de banco consegue se promover a administrador chamando as funções com a identidade de um administrador', async () => {
    const tentativas = [
      `select salvar_usuario('Intruso', 'intruso@x.com', true, false, true, '${ADMIN}', false)`,
      `select salvar_opcao('status', 'Hack', true, 1, '${ADMIN}')`,
      `select arquivar_oportunidade(1, '${ADMIN}', false)`,
      `select salvar_email_config(true, ARRAY['Go'], '[{"email":"a@x.com"}]'::jsonb, '${ADMIN}', false)`,
      `select enfileirar_email_teste('${ADMIN}')`,
      `select eh_admin('${ADMIN}')`,
      `select criar_api_cliente('intruso', '${'c'.repeat(64)}', '${ADMIN}')`,
      `select listar_api_clientes('${ADMIN}')`,
      `select criar_oportunidade_api('{}'::jsonb, 'sistema-x', null, null)`,
      `select simular_oportunidade_api('{}'::jsonb, 'sistema-x', null)`,
      `select autenticar_api_cliente('${'c'.repeat(64)}')`,
    ]
    for (const papel of ['radar_leitor', 'radar_escritor', 'radar_planner', 'radar_email']) {
      for (const sql of tentativas) {
        const f = await como(db, papel, () => falha(db.query(sql)))
        expect(f?.message, `${papel}: ${sql}`).toMatch(/permission denied/i)
      }
    }
    const intruso = await db.query(`select 1 from usuarios where nome = 'Intruso'`)
    expect(intruso.rows.length).toBe(0)
  })
})

describe('injeção e entradas hostis', () => {
  it('SQL injection nos campos vira texto, nunca comando', async () => {
    const o = await criar(db, opp({ orgao: `'; DROP TABLE oportunidades; --`, descritivo: `$$ ; select pg_sleep(10); $$`, observacoes: `" OR 1=1 --` }))
    expect(o.orgao).toBe(`'; DROP TABLE oportunidades; --`)
    const t = await db.query(`select to_regclass('public.oportunidades') as t`)
    expect(t.rows[0]).toEqual({ t: 'oportunidades' })
  })
  it('injeção pelo e-mail do usuário não dá privilégio nem quebra a função', async () => {
    const f = await falha(db.query(`select eh_admin($1) as v`, [`x' OR admin = true --`]))
    expect(f).toBeNull()
    const r = await db.query<{ v: boolean }>(`select eh_admin($1) as v`, [`x' OR admin = true --`])
    expect(r.rows[0].v).toBe(false)
  })
  it('campos desconhecidos no JSON são ignorados (sem atribuição em massa de colunas internas)', async () => {
    const o = await criar(db, opp({ versao: 99, arquivado_em: '2020-01-01', editado_na_web: false, fonte: 'planilha', codigo: '9999-9999', criado_por: 'outro@x.com', id: 123456 }))
    expect(o.versao).toBe(1)
    expect(o.arquivado_em).toBeNull()
    expect(o.fonte).toBe('web')
    expect(o.codigo).not.toBe('9999-9999')
    expect(o.criado_por).toBe(ADMIN)
    expect(o.id).not.toBe(123456)
  })
  it('caractere nulo no texto é recusado pelo Postgres com erro específico (a API o traduz em 422)', async () => {
    const f = await falha(db.query('select criar_oportunidade($1::jsonb, $2)', [`{"orgao":"a\\u0000b","status":"Go"}`, ADMIN]))
    expect(f).not.toBeNull()
  })
  it('identidade vazia ou nula é recusada', async () => {
    expect((await falha(db.query('select criar_oportunidade($1::jsonb, $2)', [JSON.stringify(opp()), '']))) ?.code).toBe('P0403')
    expect((await falha(db.query('select criar_oportunidade($1::jsonb, null)', [JSON.stringify(opp())])))?.code).toBe('P0403')
  })
})

describe('integridade do histórico', () => {
  it('o histórico de alterações não pode ser apagado nem reescrito pela aplicação', async () => {
    const o = await criar(db, opp())
    for (const sql of [`delete from oportunidades_historico where oportunidade_id = ${o.id}`, `update oportunidades_historico set por = 'forjado'`]) {
      const f = await como(db, 'radar_app', () => falha(db.query(sql)))
      expect(f?.message, sql).toMatch(/permission denied/i)
    }
  })
})
