/**
 * Segurança da API, aplicada a TODAS as rotas de functions/api (descobertas automaticamente: uma rota nova entra
 * nestas verificações sem ninguém precisar lembrar). Banco e Cloudflare Access são simulados; o que se testa é o
 * comportamento da camada HTTP: autenticação, CSRF, autorização, validação de entrada e vazamento de informação.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@neondatabase/serverless', () => ({ neon: () => sqlMock }))
const verifyId = vi.fn()
const verifyJwt = vi.fn()
vi.mock('../_lib/access', () => ({
  verifyAccessIdentity: (...a: unknown[]) => verifyId(...a),
  verifyAccessJwt: (...a: unknown[]) => verifyJwt(...a),
}))

type Rota = (c: { request: Request; env: Record<string, string | undefined>; params: Record<string, string | string[] | undefined> }) => Promise<Response>
const modulos = import.meta.glob<{ onRequest: Rota }>(['./**/*.ts', '!./**/*.test.ts', '!./**/*.perf.ts'], { eager: true })
const rotas = Object.entries(modulos)
  .filter(([arquivo]) => !arquivo.endsWith('.test.ts'))
  .map(([arquivo, m]) => ({ arquivo, onRequest: m.onRequest }))

/** Rotas da API externa: chamadas servidor a servidor com chave de API (o Cloudflare Access tem Bypass só neste caminho). */
const EXTERNAS = ['./externo/campos.ts', './externo/oportunidades.ts']
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
  sqlMock.mockReset()
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
      './email-config.ts',
      './email-config/teste.ts',
      './externo/campos.ts',
      './externo/oportunidades.ts',
      './me.ts',
      './opcoes.ts',
      './oportunidades/[id].ts',
      './oportunidades/[id]/arquivar.ts',
      './oportunidades/[id]/historico.ts',
      './oportunidades/[id]/restaurar.ts',
      './oportunidades/index.ts',
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
    sqlMock.mockResolvedValue([{ nome: null }])
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
    sqlMock.mockResolvedValue([{ nome: 'sistema-x' }])
    const ruim = await chamarExt(externa('oportunidades'), { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: JSON.stringify({ orcamento: 'abc' }) })
    expect(ruim.status).toBe(422)
    expect(sqlMock).toHaveBeenCalledTimes(1) // só a autenticação da chave; nada foi gravado
    const naoObjeto = await chamarExt(externa('oportunidades'), { method: 'POST', headers: { authorization: `Bearer ${CHAVE}` }, body: '[]' })
    expect(naoObjeto.status).toBe(400)
  })

  it('a autoria vem da chave (nunca do corpo) e o solicitante e a Idempotency-Key chegam ao banco', async () => {
    sqlMock.mockResolvedValueOnce([{ nome: 'sistema-x' }]).mockResolvedValue([{ o: { id: 1, codigo: '2026-0001' } }])
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

describe('CSRF: escritas só do próprio site', () => {
  const escritas = [
    ['./oportunidades/index.ts', 'POST'],
    ['./oportunidades/[id].ts', 'PUT'],
    ['./oportunidades/[id]/arquivar.ts', 'POST'],
    ['./oportunidades/[id]/restaurar.ts', 'POST'],
    ['./usuarios.ts', 'PUT'],
    ['./opcoes.ts', 'PUT'],
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
