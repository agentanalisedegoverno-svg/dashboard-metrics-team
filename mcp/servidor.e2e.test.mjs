// Ponta a ponta: sobe o servidor MCP de verdade (stdio), conecta um cliente MCP e uma "API" falsa local.
// Só roda se as dependências do pacote mcp/ estiverem instaladas (cd mcp && npm ci); no CI padrão é pulado.
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const instalado = existsSync(fileURLToPath(new URL('./node_modules/@modelcontextprotocol/sdk', import.meta.url)))
const CHAVE = 'rdr_' + 'M'.repeat(43)

describe.skipIf(!instalado)('servidor MCP (stdio) contra uma API falsa', () => {
  let api, client
  const pedidos = []

  beforeAll(async () => {
    api = createServer((req, res) => {
      pedidos.push({ metodo: req.method, url: req.url, auth: req.headers.authorization })
      res.setHeader('content-type', 'application/json')
      if (req.headers.authorization !== `Bearer ${CHAVE}`) return res.writeHead(401).end('{"error":"x"}')
      if (req.url.startsWith('/api/externo/oportunidades/2026-0001')) return res.end(JSON.stringify({ id: 1, codigo: '2026-0001', valor_ctc: 10 }))
      if (req.url.startsWith('/api/externo/oportunidades/2099-9999')) return res.writeHead(404).end('{"error":"x"}')
      if (req.url.startsWith('/api/externo/oportunidades')) return res.end(JSON.stringify({ total: 1, limite: 25, offset: 0, proximo_offset: null, itens: [{ id: 1, codigo: '2026-0001' }] }))
      if (req.url.startsWith('/api/externo/campos')) return res.end('{"campos":[{"nome":"status"}]}')
      res.writeHead(404).end('{}')
    })
    await new Promise((ok) => api.listen(0, '127.0.0.1', ok))
    const porta = api.address().port
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', RADAR_API_KEY: CHAVE, RADAR_API_URL: `http://127.0.0.1:${porta}/api/externo` },
    })
    client = new Client({ name: 'teste', version: '1.0.0' })
    await client.connect(transport)
  }, 60_000) // subir um processo Node sob carga (suíte inteira, CI) às vezes passa de 30 s

  afterAll(async () => {
    await client?.close()
    await new Promise((ok) => api?.close(ok))
  })

  it('expõe só ferramentas de leitura, todas marcadas como somente leitura', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['listar_campos', 'listar_oportunidades', 'ver_oportunidade'])
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })

  it('lista, vê uma e consulta os campos; a API só recebeu GET com a chave', async () => {
    const lista = await client.callTool({ name: 'listar_oportunidades', arguments: { status: 'Go', limite: 5 } })
    expect(JSON.parse(lista.content[0].text)).toMatchObject({ total: 1, retornadas: 1, itens: [{ codigo: '2026-0001' }] })
    const uma = await client.callTool({ name: 'ver_oportunidade', arguments: { codigo: '2026-0001' } })
    expect(JSON.parse(uma.content[0].text)).toMatchObject({ valor_ctc: 10 })
    const campos = await client.callTool({ name: 'listar_campos', arguments: {} })
    expect(JSON.parse(campos.content[0].text).campos[0].nome).toBe('status')
    expect(pedidos.length).toBeGreaterThanOrEqual(3)
    expect(pedidos.every((p) => p.metodo === 'GET' && p.auth === `Bearer ${CHAVE}`)).toBe(true)
    expect(pedidos.find((p) => p.url.includes('status=Go'))?.url).toContain('limite=5')
  })

  it('erros chegam como isError com mensagem clara; código inválido nem chega à API', async () => {
    const naoAchou = await client.callTool({ name: 'ver_oportunidade', arguments: { codigo: '2099-9999' } })
    expect(naoAchou.isError).toBe(true)
    expect(naoAchou.content[0].text).toMatch(/não encontrada/)
    const antes = pedidos.length
    const ruim = await client.callTool({ name: 'ver_oportunidade', arguments: { codigo: '../x' } })
    expect(ruim.isError).toBe(true)
    expect(pedidos.length).toBe(antes)
  })
})
