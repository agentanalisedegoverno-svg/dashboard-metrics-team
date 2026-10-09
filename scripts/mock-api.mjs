import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const dataPath = resolve('public/data.json')
const port = Number(process.env.API_PORT || 8000)
let lastSyncAt = null

async function readDataset() {
  const [contents, fileStats] = await Promise.all([readFile(dataPath, 'utf8'), stat(dataPath)])
  const value = JSON.parse(contents)
  const rows = Array.isArray(value) ? value : value?.rows
  if (!Array.isArray(rows)) throw new Error('O mock precisa conter um array JSON de linhas.')
  lastSyncAt = lastSyncAt || fileStats.mtime.toISOString()
  return rows
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-data-source': 'mock',
  })
  response.end(JSON.stringify(body))
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://127.0.0.1').pathname

  try {
    if (request.method === 'GET' && path === '/api/rows') {
      const rows = await readDataset()
      sendJson(response, 200, { rows, updatedAt: lastSyncAt, isMock: true })
      return
    }

    if (request.method === 'GET' && path === '/api/status') {
      const rows = await readDataset()
      sendJson(response, 200, { lastSyncAt, rowCount: rows.length, error: null, isMock: true })
      return
    }

    if (request.method === 'POST' && path === '/api/sync') {
      const rows = await readDataset()
      lastSyncAt = new Date().toISOString()
      sendJson(response, 200, { lastSyncAt, rowCount: rows.length, error: null, isMock: true })
      return
    }

    sendJson(response, 404, { error: 'Rota não encontrada.' })
  } catch (error) {
    console.error('Erro no mock da API:', error)
    sendJson(response, 500, { error: 'Não foi possível ler o dataset local.' })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock API somente local: http://127.0.0.1:${port}/api`)
})
