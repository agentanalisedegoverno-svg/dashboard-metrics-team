// Mede o CPU que o driver `postgres` gasta para entregar o painel (809 linhas): caminho ANTIGO (o driver decodifica linha a linha e o
// Worker serializa de novo) contra o NOVO (o Postgres devolve o JSON pronto e o Worker só repassa o texto). Ver functions/_lib/painel.ts.
//
// Como funciona: este mesmo arquivo sobe, em outro processo, um servidor mínimo do protocolo do Postgres (só responde o que o teste
// pergunta) e mede o CPU do CLIENTE com o driver `postgres` de verdade. Não precisa de banco nem de Docker.
// Uso: npm run medir:painel     (use também ao trocar a versão do driver: foi o salto para a v4 que causou o 503 de 23/11/2026)
//
// Limites: é o CPU do Node, não o do Cloudflare Workers, e a conexão aqui não usa TLS (o custo é igual nos dois caminhos). Serve para
// comparar caminhos e versões do driver, não para prever milissegundos em produção: para isso, veja "CPU time" nas métricas do projeto
// no Cloudflare (Workers & Pages) e o cabeçalho Server-Timing de /api/rows.
import { spawn } from 'node:child_process'
import net from 'node:net'
import postgres from 'postgres'

const PORTA = 5599
const N = 809

// ---------------------------------------------------------------- servidor falso (processo separado)
function servidor() {
  const texto = (i, n) => {
    let s = ''
    for (let k = 0; s.length < n; k++) s += `Contratação de serviços de TI ${i} item ${k} órgão público; `
    return s.slice(0, n)
  }
  const linhas = Array.from({ length: N }, (_, i) => ({
    ano: '2026', mes: String((i % 12) + 1).padStart(2, '0'), status: ['Go', 'Win', 'Prospect', 'Lost'][i % 4], uf: ['DF', 'SP', 'GO', 'MG'][i % 4], torre: 'ITS',
    linhaServico: 'Service Desk', vistoria: 'Não', analista: 'Maria Silva', motivoNoGo: null, motivoLost: null, contaVinculada: null,
    orcamento: 100000 + i * 1234.56, valorCtc: i % 3 ? 90000 + i * 99.9 : null, valorVencedor: null, sla: i % 5 ? 12.5 : null,
    processo: `PE ${i}/2026`, orgao: `Prefeitura Municipal de Cidade ${i}`, descritivo: texto(i, 240), dataPregao: '10/03/2026', acaoIA: null,
  }))
  const COLS = Object.keys(linhas[0])
  const OID = { orcamento: 701, valorCtc: 701, valorVencedor: 701, sla: 701, acaoIA: 3802 }
  const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
  const i16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b }
  const msg = (t, ...p) => { const corpo = Buffer.concat(p); return Buffer.concat([Buffer.from(t), i32(corpo.length + 4), corpo]) }
  const campo = (nome, oid) => Buffer.concat([Buffer.from(nome + '\0'), i32(0), i16(0), i32(oid), i16(-1), i32(-1), i16(0)])
  const descricao = (cols) => msg('T', i16(cols.length), ...cols.map(([n, o]) => campo(n, o)))
  const linhaDados = (vals) => msg('D', i16(vals.length), ...vals.map((v) => (v === null ? i32(-1) : Buffer.concat([i32(Buffer.byteLength(String(v))), Buffer.from(String(v))]))))
  const R = {
    antiga: { desc: descricao(COLS.map((c) => [c, OID[c] || 25])), dados: Buffer.concat(linhas.map((l) => linhaDados(COLS.map((c) => l[c])))), n: N },
    nova: { desc: descricao([['atualizado_em', 25], ['total', 23], ['linhas', 25]]), dados: linhaDados(['2026-11-23T20:00:00.000Z', N, JSON.stringify(linhas)]), n: 1 },
    minima: { desc: descricao([['x', 25]]), dados: linhaDados(['x']), n: 1 },
  }
  const qual = (sql) => (sql.includes('tiny') ? R.minima : sql.includes('with base as') ? R.nova : R.antiga)

  net.createServer((s) => {
    let buf = Buffer.alloc(0), iniciou = false, sql = ''
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      for (;;) {
        if (!iniciou) {
          if (buf.length < 4) return
          const len = buf.readInt32BE(0)
          if (buf.length < len) return
          const codigo = buf.readInt32BE(4)
          buf = buf.subarray(len)
          if (codigo === 80877103) { s.write('N'); continue } // pedido de SSL: recusa
          iniciou = true
          s.write(Buffer.concat([msg('R', i32(0)), msg('S', Buffer.from('client_encoding\0UTF8\0')), msg('S', Buffer.from('server_encoding\0UTF8\0')), msg('S', Buffer.from('integer_datetimes\0on\0')), msg('K', i32(1), i32(2)), msg('Z', Buffer.from('I'))]))
          continue
        }
        if (buf.length < 5) return
        const t = String.fromCharCode(buf[0]), len = buf.readInt32BE(1)
        if (buf.length < len + 1) return
        const corpo = buf.subarray(5, len + 1)
        buf = buf.subarray(len + 1)
        if (t === 'X') return s.end()
        if (t === 'P') { const ini = corpo.indexOf(0) + 1; sql = corpo.toString('utf8', ini, corpo.indexOf(0, ini)); s.write(msg('1')) }
        else if (t === 'B') s.write(msg('2'))
        else if (t === 'D') { if (String.fromCharCode(corpo[0]) === 'S') s.write(msg('t', i16(0))); s.write(qual(sql).desc) }
        else if (t === 'E') s.write(Buffer.concat([qual(sql).dados, msg('C', Buffer.from(`SELECT ${qual(sql).n}\0`))]))
        else if (t === 'S') s.write(msg('Z', Buffer.from('I')))
      }
    })
    s.on('error', () => {})
  }).listen(PORTA, '127.0.0.1', () => process.send?.('pronto'))
}

// ---------------------------------------------------------------- medição (cliente)
async function medir() {
  const marca = (t) => Object.assign([t], { raw: [t] }) // chama o `sql` com texto fixo, como o template do código de produção
  const opcoes = {
    max: 1, ssl: false, prepare: false, fetch_types: false, idle_timeout: 5, connect_timeout: 10, max_lifetime: 60, // iguais a functions/_lib/banco.ts (sem TLS)
    types: { json: { to: 114, from: [114, 3802], serialize: (x) => (typeof x === 'string' ? x : JSON.stringify(x)), parse: (x) => JSON.parse(x) } },
  }
  const enc = new TextEncoder()
  const url = `postgres://u:p@127.0.0.1:${PORTA}/db`
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }

  const caminhos = {
    'piso (abrir a conexão e 1 linha minúscula)': async () => {
      const sql = postgres(url, opcoes)
      const [r] = await sql(marca('select tiny'))
      const n = enc.encode(`{"x":"${r.x}"}`).length
      await sql.end({ timeout: 1 })
      return n
    },
    'ANTIGO (driver decodifica as linhas + Worker serializa)': async () => {
      const sql = postgres(url, opcoes)
      const rows = await sql(marca('select ano, mes from oportunidades'))
      const n = enc.encode(JSON.stringify({ rows, updatedAt: '2026-11-23T20:00:00.000Z', isMock: false })).length
      await sql.end({ timeout: 1 })
      return n
    },
    'NOVO (Postgres devolve o JSON, Worker só repassa)': async () => {
      const sql = postgres(url, opcoes)
      const [r] = await sql(marca('with base as (select 1) select 1 from base'))
      const n = enc.encode(`{"rows":${r.linhas},"updatedAt":${JSON.stringify(r.atualizado_em)},"isMock":false}`).length
      await sql.end({ timeout: 1 })
      return n
    },
  }

  // O relógio de CPU do Windows anda em passos de ~15 ms: mede-se um lote inteiro e divide.
  const LOTES = 7, LOTE = 60
  const resultado = {}
  for (const [nome, fn] of Object.entries(caminhos)) {
    for (let i = 0; i < 10; i++) await fn() // aquecimento
    const t = []
    let bytes = 0
    for (let l = 0; l < LOTES; l++) {
      const a = cpu()
      for (let i = 0; i < LOTE; i++) bytes = await fn()
      t.push((cpu() - a) / LOTE)
    }
    t.sort((x, y) => x - y)
    resultado[nome] = t[Math.floor(LOTES / 2)]
    console.log(`${nome.padEnd(58)} ${resultado[nome].toFixed(1).padStart(6)} ms (melhor ${t[0].toFixed(1)}, pior ${t[LOTES - 1].toFixed(1)}) | resposta ${(bytes / 1024).toFixed(0)} KB`)
  }
  const [piso, antigo, novo] = Object.values(resultado)
  console.log(`\nAcima do piso: antigo +${(antigo - piso).toFixed(1)} ms, novo +${(novo - piso).toFixed(1)} ms (${Math.round(100 * (1 - (novo - piso) / (antigo - piso)))}% menos trabalho do driver).`)
  console.log('CPU do Node, sem TLS: compare caminhos e versões do driver; o número de produção vem das métricas do Cloudflare.')
}

if (process.argv.includes('--servidor')) servidor()
else {
  const filho = spawn(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--servidor'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  filho.once('message', async () => {
    try {
      await medir()
    } finally {
      filho.kill()
      process.exit(0)
    }
  })
}
