// Ponta a ponta do MCP REMOTO: o cliente MCP oficial (Streamable HTTP) conversa com o handler de functions/_lib/mcpRemoto.ts
// servido por um HTTP local, com um "banco" falso. Garante que a negociação do protocolo (initialize, tools/list, tools/call)
// funciona com o SDK de verdade. A autenticação/escopo da rota é testada em functions/api/seguranca.test.ts.
// Só roda se as dependências do pacote mcp/ estiverem instaladas (cd mcp && npm ci).
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tratarMcp } from '../functions/_lib/mcpRemoto.ts'

const instalado = existsSync(fileURLToPath(new URL('./node_modules/@modelcontextprotocol/sdk', import.meta.url)))

describe.skipIf(!instalado)('MCP remoto (Streamable HTTP) com o cliente oficial', () => {
  let http, client
  const consultas = []
  const sqlFalso = (strings, ...valores) => {
    consultas.push({ sql: strings.join('?'), valores })
    const sql = strings.join('?')
    if (sql.includes('from opcoes')) return Promise.resolve([{ lista: 'status', valor: 'Go', ativo: true }])
    if (sql.includes('where o.codigo')) return Promise.resolve([{ r: { id: 1, codigo: '2026-0001', valor_ctc: 10 } }])
    return Promise.resolve([{ total: 1, itens: [{ id: 1, codigo: '2026-0001' }] }])
  }

  beforeAll(async () => {
    http = createServer(async (req, res) => {
      if (req.method !== 'POST') return res.writeHead(405).end()
      let texto = ''
      for await (const parte of req) texto += parte
      const r = await tratarMcp(JSON.parse(texto), sqlFalso)
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(r.status === 202 ? undefined : await r.text())
    })
    await new Promise((ok) => http.listen(0, '127.0.0.1', ok))
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    client = new Client({ name: 'teste', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/api/externo/mcp`)))
  }, 30_000)

  afterAll(async () => {
    await client?.close()
    await new Promise((ok) => http?.close(ok))
  })

  it('negocia o protocolo e lista só ferramentas de leitura', async () => {
    expect(client.getServerVersion()?.name).toBe('radar-prevendas')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['listar_campos', 'listar_oportunidades', 'ver_oportunidade'])
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })

  it('lista, vê uma e consulta os campos; tudo só com SELECT', async () => {
    const lista = await client.callTool({ name: 'listar_oportunidades', arguments: { status: 'Go', limite: 5 } })
    expect(JSON.parse(lista.content[0].text)).toMatchObject({ total: 1, retornadas: 1, itens: [{ codigo: '2026-0001' }] })
    const uma = await client.callTool({ name: 'ver_oportunidade', arguments: { codigo: '2026-0001' } })
    expect(JSON.parse(uma.content[0].text)).toMatchObject({ valor_ctc: 10 })
    const campos = await client.callTool({ name: 'listar_campos', arguments: {} })
    expect(Array.isArray(JSON.parse(campos.content[0].text).campos)).toBe(true)
    expect(consultas.length).toBe(3)
    for (const c of consultas) expect(c.sql.toLowerCase()).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/)
  })

  it('filtro inválido e código inválido chegam como erro claro, sem consultar o banco', async () => {
    const antes = consultas.length
    const filtro = await client.callTool({ name: 'listar_oportunidades', arguments: { statos: 'Go' } })
    expect(filtro.isError).toBe(true)
    const codigo = await client.callTool({ name: 'ver_oportunidade', arguments: { codigo: '../x' } })
    expect(codigo.isError).toBe(true)
    expect(consultas.length).toBe(antes)
  })
})
