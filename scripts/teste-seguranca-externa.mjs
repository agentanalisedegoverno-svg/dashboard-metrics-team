// Sondagem de segurança do site em produção, SEM credenciais: o que um desconhecido na internet consegue ver ou fazer.
// Só faz requisições leves e de leitura (mais alguns POST/PUT vazios, que devem ser barrados antes de qualquer efeito).
//
// Uso: node scripts/teste-seguranca-externa.mjs [https://radar-prevendas.pages.dev]
//      (ou RADAR_URL no ambiente). Sai com código 1 se algo estiver exposto.
const BASE = (process.argv[2] || process.env.RADAR_URL || 'https://radar-prevendas.pages.dev').replace(/\/$/, '')
const falhas = []
const ok = []
const registrar = (cond, descricao, detalhe = '') => (cond ? ok : falhas).push(`${descricao}${detalhe ? ` — ${detalhe}` : ''}`)

const buscar = (url, init = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init })
/** Barrado = redireciona para o login do Access, ou responde 401/403 (nunca 200 com conteúdo). */
const barrado = (r) => [301, 302, 303, 307, 308, 401, 403].includes(r.status)
const paraLogin = (r) => /cloudflareaccess\.com/.test(r.headers.get('location') || '')

// 1) Páginas e dados: nada sem login
for (const caminho of ['/', '/index.html', '/data.json', '/api/rows', '/api/status', '/api/me', '/api/opcoes', '/api/oportunidades', '/api/oportunidades/1', '/api/oportunidades/1/historico', '/api/usuarios', '/api/email-config', '/api/cnpj/00000000000191']) {
  const r = await buscar(`${BASE}${caminho}`)
  registrar(barrado(r), `GET ${caminho} sem login é barrado`, `HTTP ${r.status}${paraLogin(r) ? ' → login do Access' : ''}`)
}

// 2) Escritas sem login: barradas antes de qualquer efeito
for (const [metodo, caminho] of [['POST', '/api/oportunidades'], ['PUT', '/api/oportunidades/1'], ['POST', '/api/oportunidades/1/arquivar'], ['PUT', '/api/usuarios'], ['PUT', '/api/opcoes'], ['PUT', '/api/email-config'], ['POST', '/api/email-config/teste']]) {
  const r = await buscar(`${BASE}${caminho}`, { method: metodo, headers: { 'content-type': 'application/json', 'x-radar-csrf': '1' }, body: '{}' })
  registrar(barrado(r), `${metodo} ${caminho} sem login é barrado`, `HTTP ${r.status}`)
}

// 3) Cabeçalho do Access forjado não vale (o JWT é validado com as chaves do Access)
const jwtFalso = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"email":"admin@ctctech.com.br","aud":["x"],"exp":9999999999}').toString('base64url')}.`
for (const caminho of ['/api/me', '/api/oportunidades', '/api/email-config']) {
  const r = await buscar(`${BASE}${caminho}`, { headers: { 'cf-access-jwt-assertion': jwtFalso, 'cf-access-authenticated-user-email': 'admin@ctctech.com.br' } })
  registrar(barrado(r), `JWT forjado (alg none) e e-mail forjado em ${caminho} não passam`, `HTTP ${r.status}`)
}

// 4) Arquivos que nunca devem existir publicamente
for (const caminho of ['/.git/config', '/.git/HEAD', '/.env', '/.dev.vars', '/wrangler.toml', '/package.json', '/db/schema.sql', '/db/migrations/001_cadastro_oportunidades.sql', '/functions/api/me.ts', '/assets/index.js.map', '/BaseLicitacao.xlsx']) {
  const r = await buscar(`${BASE}${caminho}`)
  const corpo = r.status === 200 ? (await r.text()).slice(0, 200) : ''
  const exposto = r.status === 200 && !/<!doctype html|<html/i.test(corpo) // 200 com HTML = fallback da SPA, sem o arquivo
  registrar(!exposto, `${caminho} não está exposto`, `HTTP ${r.status}`)
}

// 5) Transporte: HTTP redireciona para HTTPS
try {
  const http = await buscar(BASE.replace(/^https:/, 'http:'))
  registrar([301, 302, 307, 308].includes(http.status) && /^https:/.test(http.headers.get('location') || ''), 'HTTP puro redireciona para HTTPS', `HTTP ${http.status}`)
} catch {
  registrar(true, 'HTTP puro não aceita conexão (só HTTPS)')
}

// 6) CORS: nenhuma origem estranha é autorizada
for (const caminho of ['/api/me', '/api/oportunidades']) {
  const r = await buscar(`${BASE}${caminho}`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } })
  const acao = r.headers.get('access-control-allow-origin')
  registrar(acao !== '*' && acao !== 'https://evil.example', `CORS em ${caminho} não libera origens externas`, `allow-origin: ${acao ?? '(ausente)'}`)
}

// 7) Métodos perigosos
for (const metodo of ['TRACE', 'CONNECT']) {
  try {
    const r = await buscar(`${BASE}/`, { method: metodo })
    registrar(r.status !== 200, `método ${metodo} não é aceito`, `HTTP ${r.status}`)
  } catch {
    registrar(true, `método ${metodo} não é aceito`)
  }
}

console.log(`Sondagem de ${BASE}\n`)
for (const l of ok) console.log(`  ok    ${l}`)
for (const l of falhas) console.log(`  FALHA ${l}`)
console.log(`\n${ok.length} verificações ok, ${falhas.length} falha(s)`)
if (falhas.length) process.exit(1)
