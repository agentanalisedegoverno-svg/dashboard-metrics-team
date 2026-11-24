/**
 * Segurança da API, aplicada a TODAS as rotas de functions/api (descobertas automaticamente: uma rota nova entra
 * nestas verificações sem ninguém precisar lembrar). Banco e Cloudflare Access são simulados; o que se testa é o
 * comportamento da camada HTTP: autenticação, CSRF, autorização, validação de entrada e vazamento de informação.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reiniciarLimites } from '../_lib/apiExterna.ts'

const sqlMock = vi.fn()
/** Conexão do papel radar_leitor (DATABASE_URL): só as consultas da API de leitura passam por ela. */
const sqlLeitor = vi.fn()
vi.mock('../_lib/banco', () => ({ conectar: (url: string) => (url.includes('leitor') ? sqlLeitor : sqlMock) }))
const verifyId = vi.fn()
const verifyJwt = vi.fn()
vi.mock('../_lib/access', () => ({
  verifyAccessIdentity: (...a: unknown[]) => verifyId(...a),
  verifyAccessJwt: (...a: unknown[]) => verifyJwt(...a),
}))

type Rota = (c: { request: Request; env: Record<string, string | undefined>; params: Record<string, string | string[] | undefined> }) => Promise<Response>
// _middleware.ts não é uma rota (envolve todas); tem teste próprio em functions/_lib/diagnostico.test.ts.
const modulos = import.meta.glob<{ onRequest: Rota }>(['./**/*.ts', '!./**/*.test.ts', '!./**/*.perf.ts', '!./**/_middleware.ts'], { eager: true })
const rotas = Object.entries(modulos)
  .filter(([arquivo]) => !arquivo.endsWith('.test.ts'))
  .map(([arquivo, m]) => ({ arquivo, onRequest: m.onRequest }))

/** Rotas da API externa: chamadas servidor a servidor com chave de API (o Cloudflare Access tem Bypass só neste caminho). */
const EXTERNAS = ['./externo/campos.ts', './externo/mcp.ts', './externo/oportunidades.ts', './externo/oportunidades/[codigo].ts']
const protegidas = rotas.filter((r) => !EXTERNAS.includes(r.arquivo))
const externas = rotas.filter((r) => EXTERNAS.includes(r.arquivo))

const ENV = {
  DATABASE_URL: 'postgres://leitor@h/db',
  DATABASE_URL_APP: 'postgres://app@h/db',
  CF_ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud',
}
const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** Parâmetros de rota a partir do nome do arquivo: [id] -> {id}, [cnpj] -> {cnpj}, [[path]] -> {path}. */
const paramsDe = (arquivo: string) => {
  const p: Record<string, string> = {}
  for (const m of arquivo.matchAll(/\[\[?(\w+)\]?\]/g)) p[m[1]] = m[1] === 'path' ? 'rows' : m[1] === 'cnpj' ? '00000000000191' : '1'
  return p
}

type Opc = { method?: string; headers?: Record<string, string>; body?: string; env?: Record<string, string | undefined>; params?: Record<string, string> }
const chamar = (r: (typeof rotas)[number], o: Opc = {}) =>
  r.onRequest({
    request: new Request('https://radar.test/api/x', {
      method: o.method ?? 'GET',
      headers: { 'cf-access-jwt-assertion': 'jwt', ...(o.headers ?? {}) },
      body: o.body,
    }),
    env: o.env ?? ENV,
    params: o.params ?? paramsDe(r.arquivo),
  })

const rotaDe = (trecho: string) => {
  const r = rotas.find((x) => x.arquivo.includes(trecho))
  if (!r) throw new Error(`rota não encontrada: ${trecho}`)
  return r
}

beforeEach(() => {
  reiniciarLimites() // o limite de requisições da API externa é por instância; cada teste começa com a contagem zerada
  sqlMock.mockReset()
  sqlLeitor.mockReset()
  verifyId.mockReset().mockResolvedValue({ email: 'jwt@ctctech.com.br' })
  verifyJwt.mockReset().mockResolvedValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('descoberta de rotas', () => {
  it('encontra todas as rotas da API (se este número mudar, revise a política de cada rota nova)', () => {
    expect(rotas.map((r) => r.arquivo).sort()).toEqual([
      './[[path]].ts',
      './api-clientes.ts',
      './api-clientes/[id].ts',
      './cnpj/[cnpj].ts',
      './diagnostico.ts',
      './email-config.ts',
      './email-config/teste.ts',
      './externo/campos.ts',
      './externo/mcp.ts',
      './externo/oportunidades.ts',
      './externo/oportunidades/[codigo].ts',
      './linhas-torre.ts',
      './me.ts',
      './monitor-licitacoes/[id].ts',
      './monitor-licitacoes/alertas/[id].ts',
      './monitor-licitacoes/candidatos/[id].ts',
      './monitor-licitacoes/index.ts',
      './opcoes.ts',
      './oportunidades/[id].ts',
      './oportunidades/[id]/arquivar.ts',
      './oportunidades/[id]/historico.ts',
      './oportunidades/[id]/restaurar.ts',
      './oportunidades/arquivar-lote.ts',
      './oportunidades/index.ts',
      './pncp/[[path]].ts',
      './usuarios.ts',
    ])
  })
})

describe('autenticação: sem identidade válida nada passa (todas as rotas, todos os métodos)', () => {
  it.each(protegidas.map((r) => [r.arquivo, r] as const))('%s: JWT inválido -> 401/405/404, nunca 2xx, e o banco não é tocado', async (_n, r) => {
    verifyId.mockResolvedValue(null)
    verifyJwt.mockResolvedValue(false)
    for (const method of METODOS) {
      const res = await chamar(r, { method, headers: { 'x-radar-csrf': '1' }, body: method === 'GET' ? undefined : '{}' })
      expect([401, 404, 405], `${r.arquivo} ${method}`).toContain(res.status)
    }
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it.each(protegidas.map((r) => [r.arquivo, r] as const))('%s: sem o cabeçalho do Access -> não autorizado', async (_n, r) => {
    verifyId.mockImplementation(async (token: string | null) => (token ? { email: 'a@x.com' } : null))
    verifyJwt.mockImplementation(async (token: string | null) => Boolean(token))
    const req = new Request('https://radar.test/api/x', { method: 'GET' })
    const res = await r.onRequest({ request: req, env: ENV, params: paramsDe(r.arquivo) })
    expect([401, 404, 405]).toContain(res.status)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it.each(protegidas.map((r) => [r.arquivo, r] as const))('%s: falha fechada sem a configuração do Access (503; 405 se o método nem existe)', async (_n, r) => {
    let fechou503 = 0
    for (const method of METODOS) {
      const res = await chamar(r, { method, headers: { 'x-radar-csrf': '1' }, body: method === 'GET' ? undefined : '{}', env: { DATABASE_URL: ENV.DATABASE_URL, DATABASE_URL_APP: ENV.DATABASE_URL_APP } })
      expect([503, 405, 404], `${r.arquivo} ${method}`).toContain(res.status)
      if (res.status === 503) fechou503++
    }
    expect(fechou503).toBeGreaterThan(0)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('token sem e-mail é recusado nas rotas do cadastro (não dá para registrar o autor)', async () => {
    verifyId.mockResolvedValue({ email: null })
    for (const t of ['./me.ts', './opcoes.ts', './oportunidades/index.ts']) {
      expect((await chamar(rotaDe(t))).status).toBe(403)
    }
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('API externa: sem chave válida nada passa (todas as rotas externas, todos os métodos)', () => {
  const CHAVE = 'rdr_' + 'A'.repeat(43)
  const externa = (trecho: string) => externas.find((r) => r.arquivo.includes(trecho))!
  const chamarExt = (r: (typeof externas)[number], o: Opc = {}) =>
    r.onRequest({ request: new Request('https://radar.test/api/externo/x', { method: o.method ?? 'GET', headers: o.headers, body: o.body }), env: o.env ?? ENV, params: {} })

  it.each(externas.map((r) => [r.arquivo, r] as const))('%s: sem chave, ou com chave de formato inválido -> 401/405, nunca 2xx, e o banco não é tocado', async (_n, r) => {
    for (const headers of [{}, { authorization: 'Bearer curta' }, { authorization: 'Basic abc' }, { 'x-api-key': "rdr_'; drop table oportunidades;--" }, { 'cf-access-jwt-assertion': 'jwt' }] as Record<string, string>[]) {
      for (const method of METODOS) {
        const res = await chamarExt(r, { method, headers, body: method === 'GET' ? undefined : '{}' })
        expect([401, 405], `${r.arquivo} ${method} ${JSON.stringify(headers)}`).toContain(res.status)
        expect(res.headers.get('cache-control')).toBe('private, no-store')
      }
    }
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it.each(externas.map((r) => [r.arquivo, r] as const))('%s: chave com formato válido mas desconhecida ou revogada -> 401', async (_n, r) => {
    sqlMock.mockResolvedValue([{ r: null }])
    for (const method of ['GET', 'POST']) {
      const res = await chamarExt(r, { method, headers: { authorization: `Bearer ${CHAVE}` }, body: method === 'GET' ? undefined : '{}' })
      expect([401, 405]).toContain(res.status)
    }
  })

  it('sem o banco do cadastro configurado -> 503 sem detalhes', async () => {
    const res = await chamarExt(externa('oportunidades'), { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: '{}', env: { ...ENV, DATABASE_URL_APP: undefined } })
    expect(res.status).toBe(503)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('chave válida cria sem o cabeçalho CSRF (é servidor a servidor), mas corpo inválido é recusado antes de gravar', async () => {
    sqlMock.mockResolvedValue([{ r: { nome: 'sistema-x', escopo: 'escrita' } }])
    const ruim = await chamarExt(externa('oportunidades'), { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: JSON.stringify({ orcamento: 'abc' }) })
    expect(ruim.status).toBe(422)
    expect(sqlMock).toHaveBeenCalledTimes(1) // só a autenticação da chave; nada foi gravado
    const naoObjeto = await chamarExt(externa('oportunidades'), { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: '[]' })
    expect(naoObjeto.status).toBe(400)
  })

  it('a autoria vem da chave (nunca do corpo) e o solicitante e a Idempotency-Key chegam ao banco', async () => {
    sqlMock.mockResolvedValueOnce([{ r: { nome: 'sistema-x', escopo: 'escrita' } }]).mockResolvedValue([{ o: { id: 1, codigo: '2026-0001' } }])
    const res = await chamarExt(externa('oportunidades'), {
      method: 'POST',
      headers: { authorization: `Bearer ${CHAVE}`, 'idempotency-key': 'pedido-1' },
      body: JSON.stringify({ status: 'Go', orgao: 'X', descritivo: 'D', torre: 'ITS', data_pregao_dt: '2026-03-10', solicitante: 'Maria', criado_por: 'ceo@ctctech.com.br', fonte: 'planilha', versao: 99 }),
    })
    expect(res.status).toBe(201)
    const [, corpoJson, cliente, solicitante, idem] = sqlMock.mock.calls.at(-1)!
    expect([cliente, solicitante, idem]).toEqual(['sistema-x', 'Maria', 'pedido-1'])
    expect(corpoJson).not.toMatch(/ceo@ctctech|criado_por|solicitante|fonte|versao/)
  })

  it('a chave nunca vai para a resposta nem para o log de erro', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    sqlMock.mockRejectedValue(new Error('falha de rede'))
    const res = await chamarExt(externa('campos'), { headers: { authorization: `Bearer ${CHAVE}` } })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(CHAVE)
    expect(JSON.stringify(log.mock.calls)).not.toContain('A'.repeat(43)) // o log guarda só a mensagem do erro, nunca os cabeçalhos
  })
})

describe('API de leitura: escopo da chave, papel só-leitura e parâmetros', () => {
  const CHAVE = 'rdr_' + 'B'.repeat(43)
  const lista = () => externas.find((r) => r.arquivo === './externo/oportunidades.ts')!
  const detalhe = () => externas.find((r) => r.arquivo === './externo/oportunidades/[codigo].ts')!
  const comEscopo = (escopo: 'leitura' | 'escrita') => sqlMock.mockResolvedValue([{ r: { nome: 'agente-x', escopo } }])
  const ler = (rota: ReturnType<typeof lista>, caminho: string, o: { method?: string; env?: Record<string, string | undefined>; params?: Record<string, string> } = {}) =>
    rota.onRequest({ request: new Request(`https://radar.test/api/externo/${caminho}`, { method: o.method ?? 'GET', headers: { authorization: `Bearer ${CHAVE}` }, body: o.method === 'POST' ? '{}' : undefined }), env: o.env ?? ENV, params: o.params ?? {} })

  it('chave de ESCRITA não lê a listagem nem o detalhe (403) e o banco de consulta não é tocado', async () => {
    comEscopo('escrita')
    for (const [rota, caminho, params] of [[lista(), 'oportunidades', {}], [detalhe(), 'oportunidades/2026-0001', { codigo: '2026-0001' }]] as const) {
      const res = await ler(rota, caminho, { params })
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('chave de LEITURA não cria oportunidade (403) e nada é gravado', async () => {
    comEscopo('leitura')
    const res = await ler(lista(), 'oportunidades', { method: 'POST' })
    expect(res.status).toBe(403)
    expect(sqlMock).toHaveBeenCalledTimes(1) // só a autenticação
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('chave de leitura lista pelo papel radar_leitor (nunca pelo radar_app) e devolve total, paginação e itens', async () => {
    comEscopo('leitura')
    sqlLeitor.mockResolvedValue([{ total: 250, itens: [{ id: 1, codigo: '2026-0001', valor_ctc: 123, orcamento_sigiloso: false }] }])
    const res = await ler(lista(), 'oportunidades?status=Go&limite=100&offset=100')
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo).toMatchObject({ total: 250, limite: 100, offset: 100, proximo_offset: 200 })
    expect(corpo.itens[0]).toMatchObject({ codigo: '2026-0001', valor_ctc: 123 }) // todos os campos, inclusive os internos
    expect(sqlLeitor).toHaveBeenCalledTimes(1)
    expect(sqlMock).toHaveBeenCalledTimes(1) // o radar_app só autenticou a chave
    expect(sqlMock.mock.calls[0][0].join('?')).toContain('autenticar_api_chave')
  })

  it('sem o banco de consulta configurado -> 503, sem tocar no banco', async () => {
    comEscopo('leitura')
    const res = await ler(lista(), 'oportunidades', { env: { ...ENV, DATABASE_URL: undefined } })
    expect(res.status).toBe(503)
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it.each([
    ['parâmetro desconhecido (erro de digitação não pode virar "devolva tudo")', 'oportunidades?statos=Go'],
    ['parâmetro repetido', 'oportunidades?status=Go&status=Win'],
    ['limite acima do máximo', 'oportunidades?limite=501'],
    ['limite zero', 'oportunidades?limite=0'],
    ['offset negativo', 'oportunidades?offset=-1'],
    ['data inválida', 'oportunidades?pregao_de=2026-13-45'],
    ['data fora do formato', 'oportunidades?pregao_de=10/12/2026'],
    ['intervalo de datas invertido', 'oportunidades?pregao_de=2026-12-10&pregao_ate=2026-01-01'],
    ['valor com vírgula', 'oportunidades?valor_min=1.500,00'],
    ['faixa de valor invertida', 'oportunidades?valor_min=200&valor_max=100'],
    ['texto longo demais', `oportunidades?q=${'a'.repeat(101)}`],
    ['injeção de SQL no filtro vira só texto, mas lixo em campo numérico é recusado', "oportunidades?limite=1;drop table oportunidades"],
  ])('%s -> 422 e a consulta nem roda', async (_n, caminho) => {
    comEscopo('leitura')
    const res = await ler(lista(), caminho)
    expect(res.status).toBe(422)
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('texto de busca é parâmetro vinculado e os curingas do LIKE são escapados (nada de concatenar no SQL)', async () => {
    comEscopo('leitura')
    sqlLeitor.mockResolvedValue([{ total: 0, itens: [] }])
    const injecao = "x'; drop table oportunidades; --"
    await ler(lista(), `oportunidades?q=${encodeURIComponent('50%_a\\')}&orgao=${encodeURIComponent(injecao)}`)
    const [strings, ...valores] = sqlLeitor.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('?')
    expect(sql).not.toContain('drop table')
    expect(sql).not.toContain('50%')
    expect(valores).toContain('50\\%\\_a\\\\')
    expect(valores).toContain(escaparEsperado(injecao))
    expect(valores.slice(-2)).toEqual([100, 0]) // limite padrão e offset
  })

  it('o SQL da consulta só lê (select) e esconde arquivadas por padrão', async () => {
    comEscopo('leitura')
    sqlLeitor.mockResolvedValue([{ total: 0, itens: [] }])
    await ler(lista(), 'oportunidades')
    const sql = (sqlLeitor.mock.calls[0][0] as TemplateStringsArray).join('?').toLowerCase()
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/)
    expect(sql).toContain('arquivado_em is null')
    sqlLeitor.mockClear()
    await ler(lista(), 'oportunidades?arquivadas=true')
    expect(sqlLeitor.mock.calls[0].slice(1)[0]).toBe(true) // primeiro parâmetro: incluir arquivadas
  })

  it('detalhe: código ou id válidos consultam; formato estranho -> 404 sem tocar no banco; não achou -> 404', async () => {
    comEscopo('leitura')
    sqlLeitor.mockResolvedValueOnce([{ r: { id: 7, codigo: '2026-0007', orcamento: 10 } }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ r: { id: 9 } }])
    expect((await ler(detalhe(), 'oportunidades/2026-0007', { params: { codigo: '2026-0007' } })).status).toBe(200)
    expect((await ler(detalhe(), 'oportunidades/2026-0099', { params: { codigo: '2026-0099' } })).status).toBe(404)
    expect((await ler(detalhe(), 'oportunidades/9', { params: { codigo: '9' } })).status).toBe(200)
    sqlLeitor.mockClear()
    for (const codigo of ["1'; drop table x;--", '../../etc/passwd', '2026-', 'abc', '']) {
      expect((await ler(detalhe(), 'oportunidades/x', { params: { codigo } })).status, codigo).toBe(404)
    }
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('chave revogada ou desconhecida não lê nada (401)', async () => {
    sqlMock.mockResolvedValue([{ r: null }])
    expect((await ler(lista(), 'oportunidades')).status).toBe(401)
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('deploy na frente da migração: chave antiga continua autenticando como escrita (cria) e não lê', async () => {
    const erro = Object.assign(new Error('function autenticar_api_chave does not exist'), { code: '42883' })
    sqlMock.mockRejectedValueOnce(erro).mockResolvedValue([{ nome: 'sistema-antigo' }])
    expect((await ler(lista(), 'oportunidades')).status).toBe(403) // é de escrita: não lê
  })
})

describe('MCP remoto: chave de leitura, papel só-leitura e origem', () => {
  const CHAVE = 'rdr_' + 'C'.repeat(43)
  const mcp = () => externas.find((r) => r.arquivo === './externo/mcp.ts')!
  const comEscopo = (escopo: 'leitura' | 'escrita') => sqlMock.mockResolvedValue([{ r: { nome: 'agente-mcp', escopo } }])
  const rpc = (corpo: unknown, o: { method?: string; headers?: Record<string, string>; env?: Record<string, string | undefined>; chave?: boolean } = {}) =>
    mcp().onRequest({
      request: new Request('https://radar.test/api/externo/mcp', {
        method: o.method ?? 'POST',
        headers: { ...(o.chave === false ? {} : { authorization: `Bearer ${CHAVE}` }), 'content-type': 'application/json', ...(o.headers ?? {}) },
        body: (o.method ?? 'POST') === 'POST' ? JSON.stringify(corpo) : undefined,
      }),
      env: o.env ?? ENV,
      params: {},
    })
  const chamarFerramenta = (name: string, args: unknown = {}) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

  it('sem chave -> 401 e o banco de consulta não é tocado', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { chave: false })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/)
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('chave de ESCRITA não usa o MCP de leitura (403)', async () => {
    comEscopo('escrita')
    const res = await chamarFerramenta('listar_oportunidades')
    expect(res.status).toBe(403)
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('chave de leitura: initialize e tools/list respondem sem consultar o banco; só a autenticação usa o radar_app', async () => {
    comEscopo('leitura')
    const ini = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(ini.status).toBe(200)
    expect((await ini.json()).result.serverInfo.name).toBe('radar-prevendas')
    expect(ini.headers.get('cache-control')).toBe('private, no-store')
    const lista = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect((await lista.json()).result.tools).toHaveLength(3)
    expect(sqlLeitor).not.toHaveBeenCalled()
    expect(sqlMock.mock.calls.every((c) => c[0].join('?').includes('autenticar_api_chave'))).toBe(true)
  })

  it('consulta pelo papel radar_leitor (nunca pelo radar_app) e devolve todos os campos', async () => {
    comEscopo('leitura')
    sqlLeitor.mockResolvedValue([{ total: 1, itens: [{ id: 1, codigo: '2026-0001', valor_ctc: 123 }] }])
    const res = await chamarFerramenta('listar_oportunidades', { status: 'Go' })
    const corpo = await res.json()
    expect(JSON.parse(corpo.result.content[0].text).itens[0]).toMatchObject({ valor_ctc: 123 })
    expect(sqlLeitor).toHaveBeenCalledTimes(1)
    expect(sqlMock).toHaveBeenCalledTimes(1) // só a autenticação
  })

  it('sem o banco de consulta configurado -> 503', async () => {
    comEscopo('leitura')
    const res = await chamarFerramenta('listar_oportunidades', {})
    const sem = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { env: { ...ENV, DATABASE_URL: undefined } })
    expect(res.status).toBe(200)
    expect(sem.status).toBe(503)
  })

  it('requisição de navegador de outro site (Origin) é recusada; GET e DELETE não existem (405)', async () => {
    comEscopo('leitura')
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { origin: 'https://site-malicioso.test' } })).status).toBe(403)
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { origin: 'https://radar.test' } })).status).toBe(200)
    for (const method of ['GET', 'DELETE', 'PUT']) expect((await rpc(null, { method })).status).toBe(405)
    expect(sqlLeitor).not.toHaveBeenCalled()
  })

  it('corpo que não é JSON -> 400; corpo grande demais -> 413', async () => {
    comEscopo('leitura')
    const naoJson = await mcp().onRequest({ request: new Request('https://radar.test/api/externo/mcp', { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: '{oops' }), env: ENV, params: {} })
    expect(naoJson.status).toBe(400)
    const grande = await mcp().onRequest({ request: new Request('https://radar.test/api/externo/mcp', { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: 'x'.repeat(70 * 1024) }), env: ENV, params: {} })
    expect(grande.status).toBe(413)
  })

  it('a chave nunca aparece na resposta', async () => {
    comEscopo('leitura')
    sqlLeitor.mockRejectedValue(new Error(`falha ${CHAVE}`))
    const res = await chamarFerramenta('listar_oportunidades')
    expect(await res.text()).not.toContain(CHAVE)
  })
})

const escaparEsperado = (s: string) => s.replace(/[\\%_]/g, '\\$&')
describe('CSRF: escritas só do próprio site', () => {
  const escritas = [
    ['./oportunidades/index.ts', 'POST'],
    ['./oportunidades/[id].ts', 'PUT'],
    ['./oportunidades/[id]/arquivar.ts', 'POST'],
    ['./oportunidades/[id]/restaurar.ts', 'POST'],
    ['./usuarios.ts', 'PUT'],
    ['./opcoes.ts', 'PUT'],
    ['./linhas-torre.ts', 'PUT'],
    ['./email-config.ts', 'PUT'],
    ['./email-config/teste.ts', 'POST'],
  ] as const

  it.each(escritas)('%s %s sem o cabeçalho x-radar-csrf -> 403', async (t, method) => {
    const res = await chamar(rotaDe(t), { method, body: '{}' })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it.each(escritas)('%s %s de outro site (Origin diferente) -> 403, mesmo com o cabeçalho', async (t, method) => {
    const res = await chamar(rotaDe(t), { method, body: '{}', headers: { 'x-radar-csrf': '1', origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it('cabeçalho com valor errado também é recusado', async () => {
    expect((await chamar(rotaDe('./usuarios.ts'), { method: 'PUT', body: '{}', headers: { 'x-radar-csrf': '0' } })).status).toBe(403)
  })
  it('Origin com o mesmo host passa pela verificação (chega à validação do corpo)', async () => {
    const res = await chamar(rotaDe('./usuarios.ts'), { method: 'PUT', body: '{}', headers: { 'x-radar-csrf': '1', origin: 'https://radar.test' } })
    expect(res.status).toBe(422)
  })
  it('métodos de leitura não exigem o cabeçalho (e não escrevem nada)', async () => {
    sqlMock.mockResolvedValue([{ nome: 'x', admin: false, ativo: true, pre_vendas: false, somente_leitura: false }])
    expect((await chamar(rotaDe('./me.ts'))).status).toBe(200)
  })
})

describe('autorização: rotas de administração', () => {
  const comCsrf = { 'x-radar-csrf': '1' }
  it('configuração de e-mail: não-administrador não lê nada (403) e o banco só é consultado para a checagem', async () => {
    sqlMock.mockResolvedValueOnce([{ admin: false }])
    const res = await chamar(rotaDe('./email-config.ts'))
    expect(res.status).toBe(403)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    expect(await res.text()).not.toMatch(/destinatarios|status_gatilho/)
  })
  it.each([
    ['./usuarios.ts', 'PUT', { nome: 'X', email: 'x@x.com', admin: true }],
    ['./opcoes.ts', 'PUT', { lista: 'status', valor: 'Novo' }],
    ['./linhas-torre.ts', 'PUT', { linha: 'Service Desk', torre: 'ITS' }],
    ['./email-config.ts', 'PUT', { ativo: false, status: [], destinatarios: [] }],
    ['./email-config/teste.ts', 'POST', {}],
    ['./oportunidades/[id]/arquivar.ts', 'POST', {}],
    ['./oportunidades/[id]/restaurar.ts', 'POST', {}],
    ['./api-clientes.ts', 'POST', { nome: 'sistema-x' }],
    ['./api-clientes/[id].ts', 'DELETE', {}],
  ] as const)('%s %s: recusa do banco (P0403) vira 403', async (t, method, corpo) => {
    sqlMock.mockRejectedValue(Object.assign(new Error('Somente administradores'), { code: 'P0403' }))
    const res = await chamar(rotaDe(t), { method, headers: comCsrf, body: JSON.stringify(corpo) })
    expect(res.status).toBe(403)
  })
  it('a identidade usada nas escritas é sempre a do login, nunca a que vem no corpo', async () => {
    sqlMock.mockResolvedValue([{ o: { id: 1 } }])
    const res = await chamar(rotaDe('./oportunidades/index.ts'), {
      method: 'POST',
      headers: comCsrf,
      body: JSON.stringify({ orgao: 'X', email: 'ceo@ctctech.com.br', criado_por: 'ceo@ctctech.com.br', atualizado_por: 'ceo@ctctech.com.br', fonte: 'planilha', versao: 99 }),
    })
    expect(res.status).toBe(201)
    const [, corpoJson, quem] = sqlMock.mock.calls[0]
    expect(quem).toBe('jwt@ctctech.com.br')
    expect(corpoJson).not.toMatch(/ceo@ctctech|criado_por|atualizado_por|fonte|versao/)
  })
})

describe('validação de entrada', () => {
  const cria = (body: string) => chamar(rotaDe('./oportunidades/index.ts'), { method: 'POST', headers: { 'x-radar-csrf': '1' }, body })

  it('JSON inválido -> 400', async () => {
    expect((await cria('{ isto não é json')).status).toBe(400)
    expect((await cria('')).status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it.each(['[]', 'null', '"texto"', '123', 'true'])('corpo que não é objeto (%s) é recusado', async (corpo) => {
    expect((await cria(corpo)).status).toBeGreaterThanOrEqual(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it('textos acima do limite -> 422, sem chegar ao banco', async () => {
    expect((await cria(JSON.stringify({ orgao: 'x'.repeat(10_000) }))).status).toBe(422)
    expect((await cria(JSON.stringify({ descritivo: 'x'.repeat(200_000) }))).status).toBe(422)
    expect((await cria(JSON.stringify({ observacoes: 'x'.repeat(6000) }))).status).toBe(422)
    expect((await cria(JSON.stringify({ pendencias: Array.from({ length: 100 }, () => 'a') }))).status).toBe(422)
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it.each(['abc', '1e999', 'Infinity', '--5', '{}'])('número inválido (%s) -> 422', async (v) => {
    expect((await cria(JSON.stringify({ orcamento: v, impostos: v }))).status).toBe(422)
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it('data inválida e CNPJ com dígitos errados -> 422', async () => {
    expect((await cria(JSON.stringify({ data_pregao_dt: '2026-02-31' }))).status).toBe(422)
    expect((await cria(JSON.stringify({ data_pregao_dt: '31/12/2026' }))).status).toBe(422)
    expect((await cria(JSON.stringify({ empresa_vencedora_cnpj: '11111111111111' }))).status).toBe(422)
  })
  it('poluição de protótipo (__proto__, constructor) não afeta o servidor nem chega ao banco', async () => {
    sqlMock.mockResolvedValue([{ o: { id: 1 } }])
    const res = await cria('{"orgao":"x","__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}')
    expect(res.status).toBe(201)
    expect(({} as Record<string, unknown>).admin).toBeUndefined()
    expect(sqlMock.mock.calls[0][1]).not.toMatch(/__proto__|constructor|admin/)
  })
  it('identificador de rota malformado ou com injeção vira 404, sem consulta ao banco', async () => {
    for (const id of ['abc', '1; drop table oportunidades', "1' or '1'='1", '-1', '99999999999999999999', '1 union select']) {
      for (const [t, method] of [['./oportunidades/[id].ts', 'GET'], ['./oportunidades/[id]/historico.ts', 'GET']] as const) {
        const res = await chamar(rotaDe(t), { method, params: { id } })
        expect(res.status, `${t} ${id}`).toBe(404)
      }
    }
    expect(sqlMock).not.toHaveBeenCalled()
  })
  it('CNPJ malformado ou com injeção é recusado sem nenhuma chamada de rede', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const cnpj of ['abc', '../../etc/passwd', '1'.repeat(14), "0' or '1'='1"]) {
      const res = await chamar(rotaDe('./cnpj/[cnpj].ts'), { params: { cnpj } })
      expect(res.status, cnpj).toBe(422)
    }
    expect(f).not.toHaveBeenCalled()
    // Com lixo em volta de um CNPJ válido, só os 14 dígitos seguem adiante: nada do texto original vai para a URL externa.
    f.mockResolvedValue({ ok: false, status: 503 })
    await chamar(rotaDe('./cnpj/[cnpj].ts'), { params: { cnpj: '00000000000191; rm -rf /' } })
    expect(f).toHaveBeenCalled()
    for (const [url] of f.mock.calls) expect(String(url)).toMatch(/00000000000191$/)
    vi.unstubAllGlobals()
  })
  it('usuário: e-mail inválido e flags de tipo errado -> 422', async () => {
    const put = (c: unknown) => chamar(rotaDe('./usuarios.ts'), { method: 'PUT', headers: { 'x-radar-csrf': '1' }, body: JSON.stringify(c) })
    expect((await put({ nome: 'A', email: 'sem-arroba' })).status).toBe(422)
    expect((await put({ nome: '' })).status).toBe(422)
    expect((await put({ nome: 'A', admin: 'sim' })).status).toBe(422)
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('métodos e respostas', () => {
  it.each([
    ['./oportunidades/index.ts', 'DELETE'], ['./oportunidades/index.ts', 'PUT'], ['./oportunidades/[id].ts', 'DELETE'], ['./me.ts', 'POST'],
    ['./usuarios.ts', 'GET'], ['./usuarios.ts', 'DELETE'], ['./email-config.ts', 'DELETE'], ['./opcoes.ts', 'DELETE'],
    ['./linhas-torre.ts', 'GET'], ['./linhas-torre.ts', 'POST'],
  ] as const)('%s %s -> 405', async (t, method) => {
    const res = await chamar(rotaDe(t), { method, headers: { 'x-radar-csrf': '1' }, body: method === 'GET' ? undefined : '{}' })
    expect(res.status).toBe(405)
  })
  it('toda resposta da API é JSON e não pode ser guardada em cache', async () => {
    sqlMock.mockResolvedValue([{ nome: 'x', admin: false, ativo: true, pre_vendas: false, somente_leitura: false }])
    for (const r of rotas) {
      const res = await chamar(r, { method: 'GET' })
      expect(res.headers.get('cache-control'), r.arquivo).toBe('private, no-store')
      expect(res.headers.get('content-type'), r.arquivo).toMatch(/application\/json/)
    }
  })
})

describe('vazamento de informação em erros', () => {
  it('falha do banco devolve mensagem genérica (sem string de conexão, senha, SQL ou stack)', async () => {
    sqlMock.mockRejectedValue(new Error('connection to postgres://radar_app:SENHA-SECRETA@host/db failed: relation "usuarios" does not exist'))
    for (const t of ['./me.ts', './opcoes.ts', './oportunidades/index.ts', './email-config.ts']) {
      const res = await chamar(rotaDe(t))
      const texto = await res.text()
      expect(res.status, t).toBeGreaterThanOrEqual(500)
      expect(texto, t).not.toMatch(/SENHA-SECRETA|postgres:\/\/|relation|usuarios|stack|at \w+/i)
    }
  })
  it('erro desconhecido do banco em escrita (código inesperado) vira 502 genérico', async () => {
    sqlMock.mockRejectedValue(Object.assign(new Error('boom: internal detail xyz'), { code: 'XX000' }))
    const res = await chamar(rotaDe('./oportunidades/index.ts'), { method: 'POST', headers: { 'x-radar-csrf': '1' }, body: JSON.stringify({ orgao: 'x' }) })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toMatch(/xyz|boom/)
  })
  it('caractere nulo (\\u0000) no texto é tratado como entrada inválida (422), não como falha do servidor', async () => {
    sqlMock.mockRejectedValue(Object.assign(new Error('unsupported Unicode escape sequence'), { code: '22P05' }))
    const res = await chamar(rotaDe('./oportunidades/index.ts'), { method: 'POST', headers: { 'x-radar-csrf': '1' }, body: JSON.stringify({ orgao: 'a\u0000b' }) })
    expect(res.status).toBe(422)
  })
  it('rota sem o banco do cadastro configurado -> 503 sem detalhes', async () => {
    const res = await chamar(rotaDe('./me.ts'), { env: { CF_ACCESS_TEAM_DOMAIN: ENV.CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD: ENV.CF_ACCESS_AUD } })
    expect(res.status).toBe(503)
  })
})
