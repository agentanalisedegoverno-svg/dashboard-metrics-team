import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { TODOS_CAMPOS } from '../../src/features/oportunidades/campos.ts'
import { oportunidadeInput } from '../../src/domain/oportunidade.ts'

const dispararEmails = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const dispararPlanner = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('./dispararEmails.ts', () => ({ dispararEnvioEmails: dispararEmails }))
vi.mock('./dispararPlanner.ts', () => ({ dispararPlanner }))

const REGISTRO = vi.hoisted(() => ({
  id: 7, codigo: '2026-0001', versao: 1, fonte: 'web', criado_por: 'api:sistema-x', solicitante: 'Maria', status: 'Prospect', orgao: 'Órgão de teste', descritivo: 'Descrição',
  torre: 'ITS', data_pregao_dt: '2026-12-10', orcamento: 1000, orcamento_sigiloso: false, pendencias: [],
}))

// Banco de mentira: o SQL vem como template; reconhecemos pelo texto.
const chamadas = vi.hoisted(() => ({ sql: [] as string[], valores: [] as unknown[][], nomeDaChave: 'sistema-x' as string | null }))
vi.mock('./http.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http.ts')>()),
  bancoApp: (env: { DATABASE_URL_APP?: string }) => !env?.DATABASE_URL_APP ? null : async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = strings.join('?')
    chamadas.sql.push(texto)
    chamadas.valores.push(valores)
    if (texto.includes('autenticar_api_cliente')) return [{ nome: chamadas.nomeDaChave }]
    if (texto.includes('simular_oportunidade_api')) return [{ o: { ...REGISTRO, simulado: true } }]
    if (texto.includes('criar_oportunidade_api')) return [{ o: REGISTRO }]
    return []
  },
}))

import { catalogoCampos, chaveDaRequisicao, chaveIdempotencia, gerarChave, hashChave, openApi, rotaExterna, separarSolicitante } from './apiExterna.ts'
import { criar } from './cadastro.ts'
import { onRequest as rotaOportunidades } from '../api/externo/oportunidades.ts'
import { previa, querSimular } from './apiExterna.ts'

const CHAVE = 'rdr_' + 'A'.repeat(43)
const req = (metodo: string, corpo?: unknown, cab: Record<string, string> = { authorization: `Bearer ${CHAVE}` }) =>
  new Request('https://radar.test/api/externo/oportunidades', { method: metodo, headers: cab, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })

describe('chaves', () => {
  it('gera chaves únicas no formato rdr_… e o hash é SHA-256 em hexadecimal', async () => {
    const a = gerarChave()
    expect(a).toMatch(/^rdr_[A-Za-z0-9_-]{43}$/)
    expect(gerarChave()).not.toBe(a)
    expect(await hashChave('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('lê a chave de Authorization: Bearer (ou x-api-key) e recusa formato inválido sem tocar no banco', () => {
    expect(chaveDaRequisicao(req('POST'))).toBe(CHAVE)
    expect(chaveDaRequisicao(req('POST', undefined, { 'x-api-key': CHAVE }))).toBe(CHAVE)
    expect(chaveDaRequisicao(req('POST', undefined, {}))).toBeNull()
    expect(chaveDaRequisicao(req('POST', undefined, { authorization: 'Basic abc' }))).toBeNull()
    expect(chaveDaRequisicao(req('POST', undefined, { authorization: 'Bearer curta' }))).toBeNull()
    expect(chaveDaRequisicao(req('POST', undefined, { authorization: `Bearer ${CHAVE}'; drop table x;--` }))).toBeNull()
  })
})

describe('rotaExterna', () => {
  const env = { DATABASE_URL_APP: 'postgres://x' }
  const rota = rotaExterna({ POST: async ({ corpo, cliente }) => {
    const j = await corpo()
    return j instanceof Response ? j : new Response(JSON.stringify({ cliente, j }), { status: 201 })
  } })
  const ctx = (r: Request) => ({ request: r, env, waitUntil: vi.fn() })

  it('sem chave: 401 com WWW-Authenticate; método não suportado: 405; nunca consulta o corpo', async () => {
    const r = await rota(ctx(req('POST', {}, {})))
    expect(r.status).toBe(401)
    expect(r.headers.get('www-authenticate')).toMatch(/Bearer/)
    expect((await rota(ctx(req('GET')))).status).toBe(405)
  })
  it('chave revogada ou desconhecida: 401', async () => {
    chamadas.nomeDaChave = null
    expect((await rota(ctx(req('POST', {})))).status).toBe(401)
    chamadas.nomeDaChave = 'sistema-x'
  })
  it('chave válida: chama o tratador com o nome do cliente; 201 aciona e-mail e Planner em segundo plano', async () => {
    dispararEmails.mockClear()
    dispararPlanner.mockClear()
    const c = ctx(req('POST', { orgao: 'x' }))
    const r = await rota(c)
    expect(r.status).toBe(201)
    expect(await r.json()).toMatchObject({ cliente: 'sistema-x' })
    expect(dispararEmails).toHaveBeenCalledTimes(1)
    expect(dispararPlanner).toHaveBeenCalledTimes(1)
    expect(c.waitUntil).toHaveBeenCalledTimes(1)
  })
  it('corpo que não é JSON: 400; corpo grande demais: 413', async () => {
    expect((await rota(ctx(req('POST', '{nao e json')))).status).toBe(400)
    expect((await rota(ctx(req('POST', JSON.stringify({ x: 'a'.repeat(70_000) }))))).status).toBe(413)
  })
  it('sem banco configurado: 503', async () => {
    const r = await rota({ request: req('POST', {}), env: {}, waitUntil: vi.fn() })
    expect(r.status).toBe(503)
  })
})

describe('solicitante e Idempotency-Key', () => {
  it('separa o solicitante dos campos e valida', () => {
    expect(separarSolicitante({ orgao: 'x', solicitante: ' Maria ' })).toEqual({ dados: { orgao: 'x' }, solicitante: 'Maria' })
    expect(separarSolicitante({ orgao: 'x' })).toEqual({ dados: { orgao: 'x' }, solicitante: null })
    for (const ruim of [null, [], 'texto', { solicitante: 5 }, { solicitante: 'x'.repeat(121) }]) expect(separarSolicitante(ruim)).toBeInstanceOf(Response)
  })
  it('aceita Idempotency-Key de 1 a 100 caracteres imprimíveis', () => {
    expect(chaveIdempotencia(req('POST'))).toBeNull()
    expect(chaveIdempotencia(req('POST', undefined, { 'idempotency-key': 'pedido-1' }))).toBe('pedido-1')
    for (const ruim of ['', 'com espaço', 'x'.repeat(101)]) expect(chaveIdempotencia(req('POST', undefined, { 'idempotency-key': ruim }))).toBeInstanceOf(Response)
  })
})

describe('criar() pela API usa criar_oportunidade_api; sem a opção, o cadastro manual segue igual', () => {
  const dados = { status: 'Go', orgao: 'Órgão', descritivo: 'Desc', torre: 'ITS', data_pregao_dt: '2026-03-10' }
  it('com externo: chama a função da API com cliente, solicitante e chave; 201', async () => {
    chamadas.sql.length = 0
    chamadas.valores.length = 0
    const r = await criar((await import('./http.ts')).bancoApp({ DATABASE_URL_APP: 'postgres://x' }) as never, 'api:sistema-x', dados, async () => ({ ok: false, motivo: 'indisponivel', mensagem: '' }), { cliente: 'sistema-x', solicitante: 'Maria', idem: 'k1' })
    expect(r.status).toBe(201)
    const i = chamadas.sql.findIndex((t) => t.includes('criar_oportunidade_api'))
    expect(i).toBeGreaterThanOrEqual(0)
    expect(chamadas.valores[i].slice(1)).toEqual(['sistema-x', 'Maria', 'k1'])
  })
})

describe('catálogo de campos e documentação (lembrete: mudou campo, atualize a API)', () => {
  const catalogo = catalogoCampos({ status: [{ valor: 'Go', ativo: true }, { valor: 'Velho', ativo: false }] })
  const doc = readFileSync(new URL('../../docs/API-EXTERNA.md', import.meta.url), 'utf8')

  it('o catálogo traz exatamente os campos do formulário, na ordem, com as opções ativas das listas', () => {
    expect(catalogo.map((c) => c.nome)).toEqual(TODOS_CAMPOS.map((c) => c.nome))
    expect(catalogo.find((c) => c.nome === 'status')?.valores).toEqual(['Go'])
    expect(catalogo.find((c) => c.nome === 'torre')).toMatchObject({ obrigatorio: false, obrigatorio_se_ausente: 'linha_servico' })
    expect(catalogo.find((c) => c.nome === 'motivo_no_go')).toMatchObject({ obrigatorio_se_status: ['No Go'] })
  })
  it('todo campo do formulário está documentado em docs/API-EXTERNA.md (se falhar: atualize a tabela de campos)', () => {
    const faltando = TODOS_CAMPOS.map((c) => c.nome).filter((n) => !doc.includes(`| \`${n}\` |`))
    expect(faltando, 'campos do formulário que faltam na documentação da API').toEqual([])
  })
  it('os campos obrigatórios do catálogo aparecem como obrigatórios na documentação', () => {
    for (const c of catalogo.filter((x) => x.obrigatorio)) {
      const linha = doc.split('\n').find((l) => l.startsWith(`| \`${c.nome}\` |`)) ?? ''
      expect(linha, c.nome).toContain('**sim**')
    }
  })
  it('todo campo aceito pelo esquema (Zod) existe no formulário ou é conhecido como derivado/interno', () => {
    const chavesZod = Object.keys(oportunidadeInput.shape)
    const formulario = new Set(TODOS_CAMPOS.map((c) => c.nome as string))
    const internos = new Set(['pendencias', 'empresa_vencedora_razao', 'empresa_vencedora_tipo', 'empresas_vencedoras'])
    const novos = chavesZod.filter((k) => !formulario.has(k) && !internos.has(k))
    expect(novos, 'campo novo no esquema sem constar no formulário nem na lista de internos (decida: documentar na API ou marcar como interno)').toEqual([])
  })
})

describe('especificação OpenAPI (docs/api-externa.openapi.json)', () => {
  const arquivo = new URL('../../docs/api-externa.openapi.json', import.meta.url)
  const esperado = JSON.stringify(openApi(catalogoCampos({})), null, 2) + '\n'
  it('está em dia com o formulário (se falhar: rode UPDATE_OPENAPI=1 npx vitest run functions/_lib/apiExterna.test.ts e faça commit do arquivo)', () => {
    if (process.env.UPDATE_OPENAPI) writeFileSync(arquivo, esperado, 'utf8')
    expect(readFileSync(arquivo, 'utf8').replace(/\r\n/g, '\n')).toBe(esperado)
  })
  it('exige exatamente os campos obrigatórios do catálogo e aceita todos os campos do formulário', () => {
    const o = openApi(catalogoCampos({})) as { components: { schemas: { Oportunidade: { required: string[]; properties: Record<string, unknown> } } } }
    const esq = o.components.schemas.Oportunidade
    expect(esq.required).toEqual(['status', 'orgao', 'descritivo', 'data_pregao_dt'])
    for (const c of TODOS_CAMPOS) expect(esq.properties, c.nome).toHaveProperty(c.nome)
    expect(esq.properties).toHaveProperty('solicitante')
  })
})

describe('modo de simulação (?simular=true): testa sem gravar, sem e-mail e sem cartão', () => {
  const env = { DATABASE_URL_APP: 'postgres://x' }
  const corpo = { status: 'Prospect', orgao: 'Órgão de teste', descritivo: 'Descrição', torre: 'ITS', data_pregao_dt: '2026-12-10', solicitante: 'Maria' }
  const chamarComUrl = (url: string) =>
    rotaOportunidades({ request: new Request(url, { method: 'POST', headers: { authorization: `Bearer ${CHAVE}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }), env, params: {}, waitUntil: vi.fn() } as never)

  it('reconhece ?simular=true e ?simular=1 (e nada além disso)', () => {
    expect(querSimular(new Request('https://x/api?simular=true'))).toBe(true)
    expect(querSimular(new Request('https://x/api?simular=1'))).toBe(true)
    expect(querSimular(new Request('https://x/api?simular=TRUE'))).toBe(true)
    for (const u of ['https://x/api', 'https://x/api?simular=false', 'https://x/api?simular=0', 'https://x/api?simular=']) expect(querSimular(new Request(u))).toBe(false)
  })

  it('simulação: 200 simulado, usa a função de simulação, devolve a prévia do e-mail e do Planner e NÃO aciona e-mail nem Planner', async () => {
    dispararEmails.mockClear()
    dispararPlanner.mockClear()
    chamadas.sql.length = 0
    const r = await chamarComUrl('https://radar.test/api/externo/oportunidades?simular=true')
    const j = (await r.json()) as { simulado: boolean; codigo: string; previa: { email: { assunto: string; texto: string }; planner: { titulo: string; anotacao: string } } }
    expect(r.status).toBe(200)
    expect(j.simulado).toBe(true)
    expect(j.previa.email.assunto).toContain('2026-0001')
    expect(j.previa.email.texto).toContain('Solicitante (via API): Maria')
    expect(j.previa.email.texto).toContain('Cadastrada por: api:sistema-x')
    expect(j.previa.planner.titulo).toMatch(/^\[RADAR 2026-0001\]/)
    expect(j.previa.planner.anotacao).toContain('Solicitante (via API): Maria')
    expect(chamadas.sql.some((x) => x.includes('simular_oportunidade_api'))).toBe(true)
    expect(chamadas.sql.some((x) => x.includes('criar_oportunidade_api'))).toBe(false)
    expect(dispararEmails).not.toHaveBeenCalled()
    expect(dispararPlanner).not.toHaveBeenCalled()
  })

  it('sem ?simular: cria de verdade (201) e aciona e-mail e Planner', async () => {
    dispararEmails.mockClear()
    dispararPlanner.mockClear()
    const r = await chamarComUrl('https://radar.test/api/externo/oportunidades')
    expect(r.status).toBe(201)
    expect(((await r.json()) as { simulado?: boolean }).simulado).toBeUndefined()
    expect(dispararEmails).toHaveBeenCalledTimes(1)
    expect(dispararPlanner).toHaveBeenCalledTimes(1)
  })

  it('previa() usa os mesmos textos de produção (assunto, anotação do Planner, orçamento sigiloso escondido)', () => {
    const p = previa({ ...REGISTRO, orcamento_sigiloso: true })
    expect(p.email.texto).toContain('Orçamento (R$): Sigiloso')
    expect(p.email.texto).not.toMatch(/1\.000/)
    expect(p.planner.anotacao).toContain('Radar 2026-0001 (v1)')
  })
})
